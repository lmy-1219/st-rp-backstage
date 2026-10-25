// 记账调度：打开了"后台记账"的窗口，有定稿但没记过的消息就一小窗一小窗地抽；
// 一次只跑一个；当天估算花费到上限就交给窗口（外援，不花 API 的钱；设了 fallback: off 才停）。回填老窗口走同一条路，只是待记的多。
import { planWindows, estimateCost, runWindow, prepareWindow, applyReply, knownItems } from './extract.mjs';
import { isTransient } from './handoff.mjs';
import { extractorReady } from './config.mjs';
import { createModelClient } from './model.mjs';
import { addFaces, facesFromRecords } from './cast.mjs';
import { remoteWayAt } from './arrival.mjs';
import { boardLoader } from './board.mjs';

const MAX_FAILURES = 3;

// 外援（D-73）：API 没响应（超时、断连、5xx）时，这一小窗写成外援包交给 AI 窗口，这个窗口的记账先停着等它交回；
// extractor.provider = 'window' 时一律交给窗口（测试期不走中转）。交回的回答和模型的走同一套核对。
export function createWorker({ store, records, getConfig, clientFactory = createModelClient, log = () => {}, intervalMs = 20000, handoffs = null }) {
    let busy = false, timer = null;
    const lastError = new Map();   // 记账出错提示按窗口记（N-441/D-260）：A 出错不影响 B 的 plan().lastError
    const startedAt = new Date().toISOString();   // 失败次数只算这次启动以后的：改了代码重启后给坏段落一次新机会

    function messagesFor(chatKey) {
        return store.currentMessages(chatKey).map(m => ({ ...m, displayName: m.name || m.speaker }));
    }
    function userName(messages) {
        for (let i = messages.length - 1; i >= 0; i--) if (messages[i].is_user && messages[i].name) return messages[i].name;
        return null;
    }

    // 已知的事（开局单、世界书）：记账时给和这段沾边的几条，角色提起它不当新事记（用户 10/2）。
    const knownOf = (chat, user = null) => knownItems({ setup: store.setupOf?.(chat.story_id)?.data ?? null, lore: store.loreOf?.(chat.story_id) ?? [], userName: user });
    // 隔着电话、消息的人（场记章程第 2 条）：照进场记录、隔离区间算出那条时谁是远程——记账定"谁知道"时他不算当面在场
    const remoteOf = chat => {
        let arrivals = [], anchors = null, members = [];
        try { arrivals = JSON.parse(store.getMeta?.(`arrivals:${chat.key}`) ?? '[]') ?? []; } catch {}
        try { anchors = chat.anchors ? JSON.parse(chat.anchors) : null; } catch {}
        try { members = chat.members ? JSON.parse(chat.members) : []; } catch {}
        if (!anchors || !(Array.isArray(arrivals) ? arrivals : Object.values(arrivals)).length) return () => [];
        const messages = store.currentMessages(chat.key);
        const notes = store.stateNotesOf?.(chat.key) ?? [];
        const memo = new Map();
        return pos => { if (!memo.has(pos)) memo.set(pos, remoteWayAt(pos, { arrivals, anchors, members, messages, notes })); return memo.get(pos); };
    };
    // 口袋里和还排着的事（记账顺带认：角色把哪件拿出来了，D-100；哪件已经不成立了，D-107）；认出来的记在那条消息上，删了那条就回来。
    const pocketOf = chatKey => (store.menuOf?.(chatKey) ?? []).filter(m => m.status === 'pocket' || m.status === 'waiting');
    const facePresentOf = chat => {
        try {
            const allowed = new Set((store.getCast?.(chat.story_id) ?? []).filter(e => e.role !== '不用' && String(e.avatar).startsWith('face:')).map(e => e.avatar));
            const board = boardLoader(store, records, chat.key);
            return pos => { try { return board.atPos(pos).people.filter(p => p.status === 'present' && allowed.has(p.avatar)).map(p => p.name); } catch { return []; } };
        } catch { return () => []; }
    };
    const markShown = (chatKey, shown = [], voided = []) => {
        for (const s of shown) store.updateMenu(chatKey, s.id, { status: 'shown', at: { pos: s.pos, fp: s.fp } });
        for (const v of voided) { store.updateMenu(chatKey, v.id, { status: 'void', why: v.why, at: { pos: v.pos, fp: v.fp } }); log(`menu ${v.id} void at ${v.pos}: ${v.why}`); }
    };

    // 记完一小窗：记账里反复出现（至少 3 条是他说的、做的）、名册里没有的人，记成这一局的新面孔（D-107）。
    const noteFaces = chat => {
        if (!store.getCast) return;
        const messages = store.currentMessages(chat.key);
        const faces = addFaces(store, chat.story_id, facesFromRecords(records.visible(chat.key), { roster: store.getCast(chat.story_id), userName: userName(messages) }));
        if (faces.length) log(`new faces in ${chat.key}: ${faces.join('、')}`);
    };

    // 这个窗口从第几条起自动记（老窗口接入时只记接入以后的；补记旧的＝从 0 起）。
    const fromOf = chat => Math.max(0, chat.extract_from ?? 0);

    function plan({ chatKey }) {
        const chat = store.requireChat(chatKey);
        const config = getConfig();
        const messages = messagesFor(chatKey);
        const done = fp => records.isDone(chat.story_id, fp);
        const windows = planWindows(messages, done, { from: fromOf(chat) });
        const older = fromOf(chat) > 0 ? planWindows(messages.filter(m => m.pos < fromOf(chat)).concat(messages.at(-1) ?? []), done) : [];
        const pending = windows.flat();
        const skipped = (records.skipped?.(chat.story_id) ?? []).map(fp => messages.find(m => m.fp === fp)?.pos).filter(Number.isFinite);
        return {
            configured: ready(config), model: config.extractor.provider === 'window' ? '交给窗口' : config.extractor.model,
            enabled: !!chat.extract, pendingMessages: pending.length,
            oldestPendingAt: pending[0]?.sent_at ?? null,
            estimate: estimateCost(windows, config.extractor),
            // 接入以前的旧消息没记的：补记要多少（面板上由用户点）
            olderMessages: older.reduce((n, w) => n + w.length, 0), olderEstimate: estimateCost(older, config.extractor),
            spentTodayUsd: records.spentToday(), dailyBudgetUsd: config.extractor.dailyBudgetUsd,
            running: busy, lastError: lastError.get(chatKey) ?? null, failing: records.recentFailures?.(chatKey, startedAt) ?? 0, skipped,
        };
    }

    function setEnabled({ chatKey, enabled, backfill = false, fromNow = false }) {
        store.requireChat(chatKey);
        records.setExtract(chatKey, !!enabled);
        if (backfill) store.db.prepare('update chats set extract_from = 0 where key = ?').run(chatKey);   // 补记接入以前的旧消息
        // 从现在开始（用户 10/22：老窗口一开就全补，钱包吃不消）：已有的消息不补，以后面板上"补记接入以前的消息"还能补
        else if (enabled && fromNow) { const last = store.currentMessages(chatKey).at(-1)?.pos; store.db.prepare('update chats set extract_from = ? where key = ?').run(Number.isInteger(last) ? last + 1 : 0, chatKey); }
        if (enabled) kick();
        return { ok: true };
    }

    const ready = config => extractorReady(config) || (config.extractor.provider === 'window' && !!handoffs);
    const waiting = chatKey => !!handoffs && store.pendingHandoffs().some(h => h.kind === 'extract' && h.chat_key === chatKey);

    function handOff({ chat, window, context, names, why, budget = false }) {
        const prepared = prepareWindow({ records, config: getConfig(), chat, window, context, names, pocket: pocketOf(chat.key), known: knownOf(chat, names.user), remoteOf: remoteOf(chat), facePresentOf: facePresentOf(chat) });
        return handoffs.request({
            kind: 'extract', key: `${chat.key}:${window[0].fp}:${window.length}`, chatKey: chat.key, why,
            system: prepared.system, user: prepared.user,
            checks: '原文片段逐字核对、持有人和在场的人由程序定、每条消息最多记几条；不合格的条目会被拦下留痕',
            meta: { chatKey: chat.key, fps: window.map(m => m.fp), ...(budget ? { budget: true } : {}) },
        });
    }
    // 今天的花费到没到上限；到了而且能交给窗口（没设 fallback: off）：记账交给窗口接着记（试玩 10/12：到了上限就停，落了八十多条）
    const overBudget = (config = getConfig()) => records.spentToday() >= config.extractor.dailyBudgetUsd;
    const windowOnBudget = (config = getConfig()) => !!handoffs && config.extractor.fallback !== 'off';
    handoffs?.register('extract', {
        // 要记的那几条消息删了、改了，或者已经记过了 ⇒ 不用再做
        stale: meta => {
            const chat = store.db.prepare('select story_id from chats where key = ?').get(meta.chatKey);
            const have = new Set(store.currentMessages(meta.chatKey).map(m => m.fp));
            return !chat || !meta.fps.every(fp => have.has(fp)) || meta.fps.every(fp => records.isDone(chat.story_id, fp));
        },
        apply: (text, meta) => {
            const chat = store.requireChat(meta.chatKey);
            const messages = messagesFor(meta.chatKey);
            const window = meta.fps.map(fp => messages.find(m => m.fp === fp));
            if (window.some(m => !m)) throw Object.assign(new Error('messages_changed'), { status: 409 });
            const start = messages.indexOf(window[0]);
            const context = messages.slice(Math.max(0, start - 2), start);
            const config = getConfig();
            const prepared = prepareWindow({ records, config, chat, window, context, names: { user: userName(messages) }, pocket: pocketOf(meta.chatKey), known: knownOf(chat, userName(messages)), remoteOf: remoteOf(chat), facePresentOf: facePresentOf(chat) });
            const jobId = records.startJob({ storyId: chat.story_id, chatKey: chat.key, positions: window.map(m => m.pos), model: 'window' });
            try {
                const r = applyReply({ records, config, chat, window, prepared, jobId, raw: text });
                markShown(meta.chatKey, r.shown, r.voided);
                noteFaces(chat);
                kick();
                return { accepted: r.accepted, rejected: r.rejected };
            } catch (error) {
                records.failJob(jobId, error.message, text);
                throw Object.assign(error, { status: 400 });
            }
        },
        // 再走一次 API：收掉这份包，这个窗口的记账接着跑（又没响应会再开一份包）。因为花费到了上限才交出来的，上限还没过就留着包。
        retry: meta => { if (meta?.budget && overBudget()) throw new Error('今天的花费还在上限'); kick(); return 'started'; },
    });

    // 跑某个窗口的若干小窗（最多 maxWindows 个）。
    async function run({ chatKey, maxWindows = 1, client = null }) {
        if (busy) return { ran: 0, busy: true };
        const config = getConfig();
        const byWindow = !client && config.extractor.provider === 'window' && !!handoffs;
        if (!client && !byWindow && !extractorReady(config)) return { ran: 0, error: 'not_configured' };
        if (waiting(chatKey)) return { ran: 0, waiting: true };
        const ownClient = !!client;   // 调用方自己带了模型（测试、补记）：到了上限就停，不交窗口
        // 流式读：中转对长的非流式回答会卡住（D-95）；只要有字进来就不算超时，整件事给足十分钟。
        if (!byWindow) client ??= clientFactory({ ...config.extractor, stream: true, timeoutMs: 600000 });
        busy = true;
        const results = [];
        try {
            for (let i = 0; i < maxWindows; i++) {
                const chat = store.requireChat(chatKey);
                const over = !byWindow && overBudget(config);
                if (over && (ownClient || !windowOnBudget(config))) { results.push({ stopped: 'budget' }); break; }
                const messages = messagesFor(chatKey);
                let [window] = planWindows(messages, fp => records.isDone(chat.story_id, fp), { from: fromOf(chat) });
                if (!window) break;
                // 一段失败两次就对半切（整段送进去会触发中转/模型整段放弃，切小了往往就过了）；
                // 切到单条还失败 MAX_FAILURES 次才跳过并留痕，不无限重试。
                while (window.length > 1 && records.failures(chatKey, window.map(m => m.pos), startedAt) >= 2) {
                    window = window.slice(0, Math.ceil(window.length / 2));
                }
                if (records.failures(chatKey, window.map(m => m.pos), startedAt) >= MAX_FAILURES) {
                    records.skip(chat.story_id, window.map(m => m.fp));
                    log(`skipped ${chatKey} positions ${window[0].pos}-${window.at(-1).pos} after ${MAX_FAILURES} failures`);
                    results.push({ skipped: window.map(m => m.pos) });
                    continue;
                }
                const start = messages.findIndex(m => m.pos === window[0].pos);
                const context = messages.slice(Math.max(0, start - 2), start);
                const names = { user: userName(messages) };
                if (byWindow) { results.push({ handoff: handOff({ chat, window, context, names, why: '设成了把记账交给窗口做（不走 API）' }) }); break; }
                if (over) { results.push({ handoff: handOff({ chat, window, context, names, budget: true, why: `今天的花费到了上限（约 ${records.spentToday().toFixed(2)} / ${config.extractor.dailyBudgetUsd}），这一段交给窗口记` }) }); break; }
                try {
                    const r = await runWindow({ records, client, config, chat, window, context, names, pocket: pocketOf(chatKey), known: knownOf(chat, names.user), remoteOf: remoteOf(chat), facePresentOf: facePresentOf(chat) });
                    markShown(chatKey, r.shown, r.voided);
                    noteFaces(chat);
                    results.push(r);
                } catch (error) {
                    if (!handoffs || config.extractor.fallback === 'off' || !isTransient(error)) throw error;
                    results.push({ handoff: handOff({ chat, window, context, names, why: `调模型没响应（${error.message}）` }) });
                    break;
                }
            }
            lastError.delete(chatKey);
        } catch (error) {
            lastError.set(chatKey, error.message);
            log(`extract failed ${chatKey}: ${error.message}`);
            results.push({ error: error.message });
        } finally {
            busy = false;
        }
        return { ran: results.filter(r => r.jobId).length, results };
    }

    // 后台轮询：挑一个开着记账、有待记消息的窗口跑一小窗。
    async function tick() {
        if (busy || !ready(getConfig())) return;
        const chats = store.db.prepare('select key from chats where extract = 1 and enabled = 1').all();
        for (const { key } of chats) {
            const p = plan({ chatKey: key });
            // 攒几条一起记（D-100：省钱）；攒不够、最早那条又等了一阵，也记。
            const { batch = 1, batchWaitMin = 0 } = getConfig().extractor;
            const waited = p.oldestPendingAt ? (Date.now() - Date.parse(p.oldestPendingAt)) / 60000 : Infinity;
            const due = p.pendingMessages >= batch || !(waited < batchWaitMin);
            const over = !(p.spentTodayUsd < p.dailyBudgetUsd);
            // 花费又有余量了（过了零点、改了上限）：先前因为上限交给窗口、还没人接的那份收回来，照常走 API
            const parked = !over && handoffs ? store.pendingHandoffs().find(h => h.kind === 'extract' && h.chat_key === key && h.payload?.meta?.budget) : null;
            if (parked) { await handoffs.retry(parked.id).catch(() => {}); return; }
            if (p.pendingMessages && due && (!over || windowOnBudget()) && !waiting(key)) {
                const result = await run({ chatKey: key, maxWindows: 1 });
                if (result.ran) kick();   // 还有待记的就接着跑，出错则等下一轮
                return;
            }
        }
    }
    function kick() { setTimeout(() => tick().catch(e => log(`tick: ${e.message}`)), 0); }
    function retrySkipped({ chatKey }) {
        const chat = store.requireChat(chatKey);
        const count = records.unskip?.(chat.story_id, records.skipped?.(chat.story_id) ?? []) ?? 0;
        if (count) kick();
        return { ok: true, count };
    }
    function start() { timer = setInterval(() => tick().catch(e => log(`tick: ${e.message}`)), intervalMs); }
    function stop() { clearInterval(timer); }

    return { plan, setEnabled, run, retrySkipped, tick, kick, start, stop };
}
