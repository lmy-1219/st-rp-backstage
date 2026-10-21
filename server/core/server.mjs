// 本机后台的 HTTP 接口。只听 127.0.0.1；浏览器不直接连它，经 ST 里的转发插件过来（plugin/）。
import http from 'node:http';
import { buildSlot, prefetchDraft, composeSlot, closenessTable, storyContext, requestPlanNow, relationsNow, noteAbsence, firstToSpeak, absenceModeOf, timelineFor, clockFor, cameraCardPrompt, uptoAnchor, advance, intimatePlanOptions, stopIntimate, intimateStopped } from './slot.mjs';
import { labelsOf, sinceWord, dateIn, dayNumber } from './timeline.mjs';
import { validMark, planFailure } from './store.mjs';
import { digests } from './digest.mjs';
import { parsePlan } from './planner.mjs';
import { snapshot, applyPreset } from './presets.mjs';
import { readOpeningPack, installPack, backupStFiles } from './pack-import.mjs';   // 一键导入开局包（_dev/开局包格式-20261017.md）
import { profileHash } from './profile.mjs';
import { toText, fromText, advisorContext, parseSetup, SETUP_SYSTEM, setupPrompt, KEYS_SYSTEM, keysPrompt, parseBackstoryKeys, withKeys, formMerge, formMissing, receiptLines, formRows, mustCastOf, checkIntimate, intimateRows } from './setup.mjs';
import { ensureOpening } from './opening.mjs';
import { relinkArrivals } from './landing.mjs';
import { snapshot as snapshotRewind, checkRewind } from './rewind.mjs';
import { isTransient, renderPrompt } from './handoff.mjs';
import { storyYear } from './world.mjs';
import { planYearFlags, yearFlagText } from './years.mjs';
import { rankByOverlap } from './recall.mjs';
import { moneyLines, balances, balanceText, namedParties } from './money.mjs';
import { talksMoney } from './pricing.mjs';
import { buildLedger } from './money.mjs';
import { autoRoster, mentionedIn, ROLES, addFaces, promotionCandidates } from './cast.mjs';
import { sameName } from './setup.mjs';
import { CAST_PROMOTION_DEFAULTS } from './config.mjs';
import { planRoster, normalizeRelations, toText as relationsText, fromText as relationsFromText, currentLines, personOf } from './relations.mjs';
import { boardFor } from './board.mjs';
import { pendingFor } from './pending.mjs';
import { doorFor } from './door.mjs';
import { cameraShouldSpeak } from './camera-turn.mjs';
import { promptOptionsFor, promptEnvironmentFor, allowedTiers, slotTable, setGlobalPromptPack, DEFAULT_PACK } from './prompt-slots.mjs';
import { planSystem, withIntimate, intimatePair } from './planner.mjs';
import { withTaste, tasteFor } from './taste.mjs';
import { intimateSetup, paceFor, withdrawIntimateForTier, intimateProgressFor } from './slot.mjs';
import { paceCap } from './tempo.mjs';
import { renderPronouns, playerContext } from './pronoun.mjs';

export const VERSION = '0.3.0';
const BODY_LIMIT = 16 * 1024 * 1024;

class BadRequest extends Error { constructor(message) { super(message); this.status = 400; } }
const bad = message => { throw new BadRequest(message); };
const str = (v, name, { optional = false, max = 4096 } = {}) => {
    if (v === undefined || v === null) { if (optional) return null; bad(`${name} required`); }
    if (typeof v !== 'string' || v.length > max) bad(`${name} invalid`);
    return v;
};
const isFp = v => typeof v === 'string' && /^[0-9a-f]{32}$/.test(v);
const strings = (v, maxItems, maxLength) => Array.isArray(v) ? v.filter(x => typeof x === 'string').slice(0, maxItems).map(x => x.slice(-maxLength)) : [];
// 那一格跟着 ST 的上下文走（N-288）：扩展传来这一次能发多长、上一次实际发了多长；只收正数
const roomOf = v => { if (!v || typeof v !== 'object') return null; const n = x => (Number.isFinite(Number(x)) && Number(x) > 0 ? Math.min(Number(x), 5e6) : null); const r = { tokens: n(v.tokens), lastChars: n(v.lastChars), lastTokens: n(v.lastTokens), lastOurs: n(v.lastOurs) }; return r.tokens ? r : null; };

function readSeq(seq) {
    if (!Array.isArray(seq)) bad('seq invalid');
    return seq.map(x => {
        if (!x || !isFp(x.f)) bad('seq entry invalid');
        // k：用户在这条上点的剧情日期（day｜same｜d:N，N-265）
        return { f: x.f, h: !!x.h, d: typeof x.d === 'string' ? x.d.slice(0, 64) : null, ...(Number.isInteger(x.w) && x.w >= 0 && x.w < 10000 ? { w: x.w } : {}), ...(validMark(x.k) ? { k: x.k } : {}), ...(typeof x.b === 'string' && x.b.length <= 4000 ? { b: x.b } : {}) };
    });
}

function readMessages(messages) {
    if (!Array.isArray(messages)) bad('messages invalid');
    return messages.map(m => {
        if (!m || !isFp(m.f) || typeof m.t !== 'string' || typeof m.s !== 'string') bad('message invalid');
        // l：生成这条时酒馆真触发的世界书条目（"书|uid"），记账时这几条给全文
        const l = Array.isArray(m.l) ? m.l.filter(k => typeof k === 'string' && k.length <= 300).slice(0, 60) : null;
        // v：谁看得见（extra.rp_vis，{ from, way, to? }；visibility.mjs）
        const v = m.v && typeof m.v === 'object' && (typeof m.v.from === 'string' || typeof m.v.way === 'string')
            ? { from: typeof m.v.from === 'string' ? m.v.from.slice(0, 80) : null, way: typeof m.v.way === 'string' ? m.v.way.slice(0, 20) : null, ...(typeof m.v.to === 'string' ? { to: m.v.to.slice(0, 80) } : {}) } : null;
        return { f: m.f, u: !!m.u, s: m.s, n: typeof m.n === 'string' ? m.n : null, t: m.t, ...(l?.length ? { l } : {}), ...(v ? { v } : {}) };
    });
}

// settings()＝每次现读的设置；packOf(chatKey)＝这一局的素材包（价表、时事、年表），没选包就是空的（D-104）。
// withPack：把这一局的价表和时事并进给那一格的设置。
export function createRoutes(store, { worker = null, records = null, assembler = null, keyMaker = null, advisor = null, setupMaker = null, keysMaker = null, handoffs = null, settings = () => ({}) } = {}) {
    const contentView = chatKey => {
        const options = promptOptionsFor(store, chatKey), env = promptEnvironmentFor(store);
        const rows = intimateRows(options.setup, { names: setupNames(store.requireChat(chatKey).story_id) });
        const progress = intimateProgressFor(store, records, chatKey);
        return { tier: options.tier, tiers: allowedTiers(options.config), ownTier: options.setup.档位 ?? '', pace: options.setup.节奏 ?? '中',
            selected: options.selected, pack: options.pack, globalPack: options.config.content?.pack ?? DEFAULT_PACK, warning: options.warning,
            ownPack: store.getMeta(`prompt_pack:${store.requireChat(chatKey).story_id}`) ?? '', packs: env?.packs?.list() ?? [], slots: slotTable(options),
            pureIntimateInactive: options.tier === '纯NSFW' && !rows.some(r => r.ok),
            // 纯NSFW 的口味文字在单独的口味包里（D-228）：这一局用的包没给这一段，就和剧情向一样
            pureNoPack: options.tier === '纯NSFW' && typeof options.paragraphs?.['plan.intimate'] !== 'string',
            intimate: rows.map((r, index) => {
                const current = progress.find(p => intimatePair(p.people) === intimatePair(r.谁));
                return { index, people: [...r.谁, ...r.可加入], adult: r.成年, error: options.tier === 'SFW' ? 'SFW 档不用亲密线' : r.error ?? '',
                    ...(current ? { progress: { current: current.current, day: current.day,
                        choices: [...new Set([r.现在, ...r.阶梯.slice(0, r.阶梯.indexOf(current.current) + 1)])] } } : {}) };
            }) };
    };
    const setupNames = storyId => [...store.getCast(storyId).filter(e => e.role !== '不用').map(e => e.name), ...(store.playerNames?.(storyId) ?? [])];
    const withPack = chatKey => { const base = settings?.() ?? {}; const p = base.packOf?.(chatKey) ?? null; return { ...base, economy: { table: p?.table ?? null }, world: { seeds: p?.seeds ?? null, anchors: p?.anchors ?? null, facts: p?.facts ?? null }, factions: { net: p?.factions ?? null } }; };
    // 开局单分格 API 没响应 ⇒ 整份稿子写成外援包交给窗口；交回的和模型答的走同一套核对，进草稿等用户核对。
    handoffs?.register('setup', {
        stale: meta => store.setupDraft(meta.storyId)?.id !== meta.setupId,
        retry: async meta => {
            if (!setupMaker) throw new Error('setup_no_model');
            const d = store.setupDraft(meta.storyId);
            const names = store.getCast(meta.storyId).filter(e => e.role !== '不用').map(e => e.name);
            store.finishSetup(d.id, await setupMaker({ source: d.source, names }));
            return 'done';
        },
        apply: (text, meta) => {
            const d = store.setupDraft(meta.storyId);
            const parsed = parseSetup(text, { source: d.source, names: setupNames(meta.storyId) });
            store.finishSetup(d.id, parsed);
            return { unchecked: parsed.unchecked.length };
        },
    });
    // 确认了一版开局单 ⇒ 给前史配检索词（便宜模型一次）；调不通交给外援。检索词写回那一版，用户不用管。
    handoffs?.register('keys', {
        stale: meta => store.setupOf(meta.storyId)?.id !== meta.setupId,
        retry: async meta => {
            if (!keysMaker) throw new Error('keys_no_model');
            const c = store.setupOf(meta.storyId);
            store.updateSetupData(c.id, withKeys(c.data, await keysMaker(c.data)));
            return 'done';
        },
        apply: (text, meta) => {
            const c = store.setupOf(meta.storyId);
            store.updateSetupData(c.id, withKeys(c.data, parseBackstoryKeys(text, c.data.前史.length)));
            return { entries: c.data.前史.length };
        },
    });
    // 确认了一版开局单 ⇒ 人物开场状态里要记成记录的那几类当场落到这个窗口的第一条消息上（别的窗口下次同步时补）
    const seedOpening = chatKey => { if (records) try { ensureOpening(store, records, chatKey); } catch {} };
    const keysFor = (storyId, chatKey) => {
        const c = store.setupOf(storyId);
        if (!c?.data?.前史?.length) return;
        const packet = why => handoffs?.request({
            kind: 'keys', key: String(c.id), chatKey, why, system: KEYS_SYSTEM, user: keysPrompt(c.data),
            task: '当配检索词的模型：给【输入】里每一条配检索词，只输出它要的那个 JSON', checks: '按编号对上每一条',
            meta: { storyId, setupId: c.id },
        });
        if (!keysMaker) return void packet('给开局单的前史配检索词（这里没接模型）');
        keysMaker(c.data, { chatKey }).then(
            keys => { if (store.setupOf(storyId)?.id === c.id) store.updateSetupData(c.id, withKeys(c.data, keys)); },
            e => (handoffs && isTransient(e) ? packet(`给前史配检索词时模型没响应（${e.message}）`) : null),
        );
    };
    const setupPacket = ({ storyId, id, source, names, chatKey, why }) => {
        const handoffId = handoffs.request({
            kind: 'setup', key: String(id), chatKey, why, system: SETUP_SYSTEM, user: setupPrompt({ source, names }),
            task: '当分格的模型：把【输入】里用户的开局稿按【系统提示】分到各格，只输出它要的那个 JSON',
            checks: '每条的原文片段在用户稿里逐字核对，找不到的标出来请用户看',
            meta: { storyId, setupId: id },
        });
        store.markSetupHandoff(id, handoffId);
        return handoffId;
    };
    // 一整段交给后台分格（贴的、上传的素材里当开局单用的）：后台跑，好了进草稿等用户核对；模型没响应写成外援包。
    const startDraft = (chat, source) => {
        const storyId = chat.story_id;
        const id = store.startSetup({ storyId, source });
        const names = store.getCast(storyId).filter(e => e.role !== '不用').map(e => e.name);
        setupMaker({ source, names, chatKey: chat.key }).then(r => store.finishSetup(id, r), e => {
            if (handoffs && isTransient(e)) setupPacket({ storyId, id, source, names, chatKey: chat.key, why: `调模型分格没响应（${e.message}）` });
            else store.failSetup(id, e.message);
        });
        return id;
    };
    const needWorker = () => worker ?? bad('extraction unavailable');
    return {
        // code：这个进程是用哪个版本的代码起来的（插件开 ST 时拿它和磁盘上的比，D-163）
        'GET /v1/health': () => ({ ok: true, version: VERSION, code: settings().code ?? null }),
        'POST /v1/camera-card': () => cameraCardPrompt(),
        'POST /v1/join': b => {
            const r = store.join({
                stChatId: str(b.stChatId, 'stChatId'), groupId: str(b.groupId, 'groupId', { optional: true }), label: str(b.label, 'label', { optional: true }),
            });
            // 新接入的窗口默认开记账（D-100：不用手动维护记忆）；带着旧聊天接入的，第一次同步时定下只记接入以后的。
            if (r.status === 'joined' && records && settings?.().extract?.auto) { records.setExtract(r.chatKey, true); store.autoExtract(r.chatKey); }
            return r;
        },
        'POST /v1/open': b => store.open({
            chatKey: str(b.chatKey, 'chatKey'), stChatId: str(b.stChatId, 'stChatId'), groupId: str(b.groupId, 'groupId', { optional: true }),
            siblings: Array.isArray(b.siblings) ? b.siblings.filter(x => typeof x === 'string') : null,
            mainChat: str(b.mainChat, 'mainChat', { optional: true }),
        }),
        'POST /v1/enabled': b => store.setEnabled({ chatKey: str(b.chatKey, 'chatKey'), enabled: !!b.enabled }),
        'POST /v1/options': b => store.setOptions({ chatKey: str(b.chatKey, 'chatKey'), testSlot: b.testSlot }),
        'POST /v1/messages': b => store.putMessages({ chatKey: str(b.chatKey, 'chatKey'), messages: readMessages(b.messages) }),
        'POST /v1/sync': b => {
            // 同步前：给眼下的最后一条记一份快照（它当最后一条时最后的样子）；删回到它时拿来对账（rewind.mjs）
            if (records) try { if (store.currentMessages(str(b.chatKey, 'chatKey')).length) snapshotRewind(store, records, b.chatKey); } catch {}
            const result = store.sync({
                chatKey: str(b.chatKey, 'chatKey'), seq: readSeq(b.seq), force: !!b.force,
                members: Array.isArray(b.members) ? b.members : null,
                anchors: b.anchors && typeof b.anchors === 'object' ? b.anchors : null,
            });
            // 开局单"人物开场状态"里要记成记录的那几类（约定、欠账、名声、手头的事）落到第一条消息上；开局单没变就不动（opening.mjs）
            if (result.committed && records) try { ensureOpening(store, records, b.chatKey); } catch {}
            // 进场时替他记的那几笔挂到他那条回复上：删了、换了跟着看不见，又开口了跟着回来（landing.mjs）
            if (result.committed && records) try { relinkArrivals(store, records, b.chatKey); } catch {}
            // 删回去了：重算的和那条当时的快照比，对不上的面板上亮一行（rewind.mjs）
            if (result.committed && records) try { checkRewind(store, records, b.chatKey, result); } catch {}
            // 同步提交了就折一次：不等有人开口，世界也往前走（到日子的传开、口袋进沉、几种检查）
            if (result.committed && records) advance(store, records, b.chatKey, withPack(b.chatKey)).catch(() => {});
            if (result.committed && result.added) worker?.kick();
            // 看一眼（glance）：此刻的样子＋兴头并成一次；面板关了合并就各调各的
            if (result.committed) settings().glance?.run?.({ chatKey: b.chatKey }).catch(() => {});
            if (result.committed) settings().episodes?.run?.({ chatKey: b.chatKey }).catch(() => {});
            if (result.committed) settings().closeCheck?.run?.({ chatKey: b.chatKey }).catch(() => {});
            if (result.committed) settings().drift?.run?.({ chatKey: b.chatKey })?.catch?.(() => {});
            // 自动进离场（方案 自动进离场与调度 1b）：候着的那条写出来了没有、每次叩门走到哪一步、谁走了
            if (result.committed) settings().auto?.run?.({ chatKey: b.chatKey })?.catch?.(() => {});
            return result;
        },
        'POST /v1/extract-plan': b => needWorker().plan({ chatKey: str(b.chatKey, 'chatKey') }),
        'POST /v1/extract-enable': b => needWorker().setEnabled({ chatKey: str(b.chatKey, 'chatKey'), enabled: !!b.enabled, backfill: b.backfill === true }),
        'POST /v1/extract-run': b => needWorker().run({ chatKey: str(b.chatKey, 'chatKey'), maxWindows: Math.min(200, Math.max(1, Number(b.maxWindows) || 1)) }),
        'POST /v1/extract-retry-skipped': b => needWorker().retrySkipped({ chatKey: str(b.chatKey, 'chatKey') }),
        'POST /v1/records': b => {
            if (!records) bad('records unavailable');
            const chatKey = str(b.chatKey, 'chatKey');
            store.requireChat(chatKey);
            // 面板上连被改掉的一起给（带 superseded_by／closed_by，划线显示）
            return { records: records.visible(chatKey, { status: b.rejected ? 'rejected' : 'ok', type: str(b.type, 'type', { optional: true }), all: true }) };
        },
        'POST /v1/content': b => {
            const chatKey = str(b.chatKey, 'chatKey'), storyId = store.requireChat(chatKey).story_id;
            const options = promptOptionsFor(store, chatKey), env = promptEnvironmentFor(store), packs = env?.packs;
            if (b.action === 'progress') {
                const rows = intimateRows(options.setup, { names: setupNames(storyId) });
                const line = Number.isInteger(b.index) ? rows[b.index] : null;
                const current = contentView(chatKey).intimate.find(r => r.index === b.index)?.progress;
                if (!line || !current || !current.choices.includes(b.value)) bad('只能改回这一条已走过的阶梯或开局原文');
                store.putIntimateProgress(chatKey, [{ 谁和谁: line.谁, 现在: b.value, 依据: '用户手动修改' }], { storyDay: storyContext(store, records, chatKey).today, source: 'user' });
            } else if (b.action === 'settings') {
                if (b.tier !== undefined && b.tier !== '' && !allowedTiers(options.config).includes(b.tier)) bad('系统没有开放这个档位');
                if (b.pace !== undefined && !['快', '中', '慢'].includes(b.pace)) bad('节奏要选快、中或慢');
                const current = store.setupOf(storyId);
                if (!current && store.setupDraft(storyId)) bad('请先保存开局单，再改这一局的口味');
                const form = { ...(b.tier !== undefined ? { 档位: b.tier } : {}), ...(b.pace !== undefined ? { 节奏: b.pace } : {}) };
                const data = formMerge(current?.data, form);
                if (b.adult !== undefined) {
                    if (!Number.isInteger(b.adult?.index) || typeof b.adult?.value !== 'boolean' || !data.亲密线?.[b.adult.index]) bad('没有这条亲密线');
                    data.亲密线 = data.亲密线.map((r, i) => {
                        if (i !== b.adult.index) return r;
                        const row = { ...r, 成年: b.adult.value };
                        if (row.error === '未确认成年，不生效' || row.error === 'SFW 档不用亲密线') { delete row.ok; delete row.error; }
                        return row;
                    });
                }
                // 只改快捷设置对应的格，不确认或覆盖用户还没交的草稿。
                if (current) store.updateSetupData(current.id, data); else store.confirmSetup({ storyId, data });
                withdrawIntimateForTier(store, chatKey);
            } else if (b.action === 'select') {
                if (b.id !== '') { if (!packs) bad('口味包目录还没接好'); packs.read(str(b.id, 'id', { max: 64 })); }
                if (b.global === true) setGlobalPromptPack(store, b.id || DEFAULT_PACK);
                else store.setMeta(`prompt_pack:${storyId}`, b.id || null);
            } else if (b.action === 'export') {
                if (!packs) bad('口味包目录还没接好');
                return { bundle: packs.exportPack(b.id || options.pack) };
            } else if (b.action === 'save' || b.action === 'import' || b.action === 'copy') {
                if (!packs) bad('口味包目录还没接好');
                let bundle = b.bundle;
                if (b.action === 'copy') {
                    bundle = packs.exportPack(b.id || options.pack);
                    bundle.清单 = { ...bundle.清单, 名字: str(b.name, 'name', { max: 80 }), 适用档位: [options.tier] };
                }
                const result = packs.write(bundle, { id: b.action === 'save' ? str(b.id, 'id', { max: 64 }) : null, mode: ['overwrite', 'copy'].includes(b.mode) ? b.mode : null });
                if (result.conflict) return result;
                if (b.action === 'copy' || b.select === true) store.setMeta(`prompt_pack:${storyId}`, result.id);
                settings().refreshPlanPackets?.();
                return { ...contentView(chatKey), saved: result.id, warnings: result.warnings ?? [] };
            } else if (b.action === 'preview') {
                const config = options.config, model = config.stages?.plan?.model ?? config.planner?.model ?? null;
                return { system: renderPronouns(withIntimate(withTaste(paceCap(planSystem(options), paceFor(store, chatKey)), { ...options, kind: 'plan', model }), intimateSetup(store, chatKey), options), playerContext(store, chatKey)) };
            } else if (b.action && b.action !== 'view') bad('没有这个口味操作');
            if (b.action === 'settings' || b.action === 'select' || b.action === 'progress') settings().refreshPlanPackets?.();
            return contentView(chatKey);
        },
        'POST /v1/slot': async b => {
            const result = await buildSlot(store, {
            chatKey: str(b.chatKey, 'chatKey'), speaker: str(b.speaker, 'speaker'),
            speakerName: str(b.speakerName, 'speakerName', { optional: true }), anchor: str(b.anchor, 'anchor', { max: 64 }),
            recent: strings(b.recent, 5, 4000), recentUser: typeof b.recentUser === 'string' ? b.recentUser.slice(-4000) : '', present: strings(b.present, 30, 200),
            room: roomOf(b.room), soft: b.soft === false ? false : undefined,   // 预设里"收着点"那条关着（用户 10/14：新模型用）
            }, records, { assembler, keyMaker, ...withPack(b.chatKey) });
            const options = promptOptionsFor(store, b.chatKey);
            const patch = tasteFor({ ...options, kind: b.speaker === 'narrator' ? 'camera' : 'act', model: typeof b.frontModel === 'string' ? b.frontModel.slice(0, 200) : null });
            return patch ? { ...result, rule: [result.rule, patch.text].filter(Boolean).join('\n\n') } : result;
        },
        // 场面表只读接口：面板排查时看同一条消息上的镜头、在场和时间；判断仍由 boardFor 统一完成。
        'POST /v1/board': b => {
            if (!records) bad('records unavailable');
            const chatKey = str(b.chatKey, 'chatKey');
            store.requireChat(chatKey);
            const anchor = str(b.anchor, 'anchor', { optional: true, max: 128 });
            const messages = anchor ? uptoAnchor(store.currentMessages(chatKey), anchor) : store.currentMessages(chatKey);
            return boardFor(store, records, chatKey, {
                anchor,
                present: strings(b.present, 60, 200),
                recentUser: typeof b.recentUser === 'string' ? b.recentUser.slice(-4000) : '',
                timeline: timelineFor(store, records, chatKey, messages),
            });
        },
        'POST /v1/pending': b => {
            if (!records) bad('records unavailable');
            const chatKey = str(b.chatKey, 'chatKey');
            store.requireChat(chatKey);
            const messages = store.currentMessages(chatKey);
            const result = pendingFor(store, records, chatKey, { timeline: timelineFor(store, records, chatKey, messages) });
            return { items: result.items.map(({ id, kind, text, owner, who, with: with_, status, statusAt, why, since, place, entry }) => ({ id, kind, text, owner, who, with: with_, status, statusAt, why, since, place, entry })) };
        },
        'POST /v1/door': b => {
            const chatKey = str(b.chatKey, 'chatKey');
            store.requireChat(chatKey);
            const messages = store.currentMessages(chatKey);
            const items = doorFor(store, records, chatKey, { present: strings(b.present, 60, 200), recentUser: typeof b.recentUser === 'string' ? b.recentUser.slice(-4000) : '', timeline: timelineFor(store, records, chatKey, messages) }).items;
            const last = messages.at(-1);
            let lit = null;
            try { const v = JSON.parse(store.getMeta(`door_lit:${chatKey}`) ?? 'null'); if (v && (last?.pos ?? 0) - v.pos <= 4 && messages.find(m => m.pos === v.pos)?.fp === v.fp && items.some(i => i.who === v.who)) lit = v; } catch {}
            if (!lit) { const first = items.find(i => i.ready && i.known); if (first) lit = { who: first.who, way: first.ways[0] ?? '他过来', by: 'program' }; }
            // 由头（reason，后台排的那件的原话）、他递过的那条的应答（sent）留在后台给进场那份用，扩展只要 label、ways
            return { items: items.map(({ reason, sent, ...item }) => item), lit };
        },
        'POST /v1/door-lit': b => {
            const chatKey = str(b.chatKey, 'chatKey'), who = str(b.who, 'who', { max: 80 }), way = str(b.way ?? '', 'way', { max: 20 }), by = str(b.by ?? 'named', 'by', { max: 20 });
            if (!['narrator', 'named', 'program'].includes(by)) bad('by invalid');
            const messages = store.currentMessages(chatKey), last = messages.at(-1);
            const items = doorFor(store, records, chatKey, { present: [], recentUser: '', timeline: timelineFor(store, records, chatKey, messages) }).items;
            if (!items.some(i => i.who === who) && !(store.getCast?.(store.requireChat(chatKey).story_id) ?? []).some(e => e.name === who)) bad('who invalid');
            // 旁白点的人不在门上（还没到他的时候）：不记（用户 10/8："没到触发剧情的点还是不要提示可以让角色进场了"）
            if (by === 'narrator' && !items.some(i => i.who === who)) return { ok: false, notDue: true };
            store.setMeta(`door_lit:${chatKey}`, JSON.stringify({ who, way, by, pos: last?.pos ?? 0, fp: last?.fp ?? null }));
            return { ok: true };
        },
        // 有卡的人在场时旁白要不要接一手（场记章程 #7、B4）：有卡的人答完以后扩展问一次；纯程序判，不花钱
        'POST /v1/camera-turn': b => {
            const chatKey = str(b.chatKey, 'chatKey');
            const chat = store.requireChat(chatKey);
            const messages = store.currentMessages(chatKey);
            const present = strings(b.present, 60, 200), recentUser = typeof b.recentUser === 'string' ? b.recentUser.slice(-4000) : null;
            let board = null;
            try { board = boardFor(store, records, chatKey, { present, recentUser: recentUser ?? '', timeline: timelineFor(store, records, chatKey, messages) }); } catch {}
            return cameraShouldSpeak({ messages, recentUser, present, roster: store.getCast?.(chat.story_id) ?? [], board, stateNotes: store.stateNotesOf?.(chatKey) ?? [], relations: store.relationsOf?.(chat.story_id) ?? null });
        },
        // 有卡的人进场（N-292）：玩家点名要谁来（/进场），下一段旁白写他出现；cancel＝玩家说先不（递过的、点过的都清掉）
        'POST /v1/arrival-request': b => {
            const chatKey = str(b.chatKey, 'chatKey');
            store.requireChat(chatKey);
            if (b.cancel === true) {
                // 玩家说了"先不"：这个时段里不再递他（D-169）
                let offer = null, holds = [];
                try { offer = JSON.parse(store.getMeta(`arrival_offer:${chatKey}`) ?? 'null'); holds = JSON.parse(store.getMeta(`arrival_hold:${chatKey}`) ?? '[]') ?? []; } catch {}
                if (offer?.who || typeof b.who === 'string') {
                    const target = offer?.who ?? str(b.who, 'who', { max: 80 });
                    const messages = store.currentMessages(chatKey), last = messages.at(-1);
                    // 门上点的"先不"（D-175）：没有旧的 offer，看门的名单里他那一项是不是结算写的联系
                    let from = offer?.from ?? 'user';
                    if (!offer) try { from = doorFor(store, records, chatKey, { timeline: timelineFor(store, records, chatKey, messages) }).items.find(i => i.who === target)?.source?.type === 'contact' ? 'settle' : 'user'; } catch {}
                    // 结算写的联系被"先不"了两回（两个时段）：这条联系用掉，他那边记一笔没人理（D-174 第 4 步乙）
                    const twice = from === 'settle' && holds.some(h => h.who === target && h.from === 'settle');
                    store.setMeta(`arrival_hold:${chatKey}`, JSON.stringify([...holds.slice(-9), { who: target, at: last?.pos ?? 0, from }]));
                    if (twice) {
                        try { const c = JSON.parse(store.getMeta(`settled_contact:${chatKey}:${target}`) ?? 'null'); if (c) store.setMeta(`settled_contact:${chatKey}:${target}`, JSON.stringify({ ...c, used: true, ...(last ? { usedAt: { pos: last.pos, fp: last.fp } } : {}) })); } catch {}
                        const chat = store.requireChat(chatKey);
                        if (last && records?.addDerived) records.addDerived({ storyId: chat.story_id, fp: last.fp, type: '心里', text: `${target}联系过，没人理。`, holder: `name:${target}`, holderName: target, audience: [target], about: target });
                    }
                }
                store.setMeta(`arrival_request:${chatKey}`, null); store.setMeta(`arrival_offer:${chatKey}`, null); store.setMeta(`door_lit:${chatKey}`, null); store.setMeta(`arrival_brief:${chatKey}`, null);
                return { ok: true };
            }
            const who = str(b.who, 'who', { max: 80 });
            const avatar = typeof b.avatar === 'string' && b.avatar.trim() ? b.avatar.trim().slice(0, 200) : null;
            store.setMeta(`arrival_request:${chatKey}`, JSON.stringify({ who, avatar, at: store.currentMessages(chatKey).at(-1)?.pos ?? 0 }));
            return { ok: true };
        },
        // 进场：玩家点了"进场"，替他理一次怎么来的、为什么来、到场那一刻看得见什么（调一次便宜模型）
        'POST /v1/arrive': async b => {
            const arrive = settings().arrive;
            if (!arrive) bad('arrive_unavailable');
            return arrive({ chatKey: str(b.chatKey, 'chatKey'), who: str(b.who, 'who', { max: 80 }), mode: ['go','come','remote'].includes(b.mode) ? b.mode : 'come', way: typeof b.way === 'string' ? b.way : '', avatar: typeof b.avatar === 'string' ? b.avatar.slice(0, 200) : null, prepare: b.prepare === true });
        },
        // 离场（D-169）：照他走前那几句记下去向（要去办的事、大概多久、怎么回来），回来的时机照它（调一次便宜模型）
        'POST /v1/leave': async b => {
            const leave = settings().leave;
            if (!leave) bad('leave_unavailable');
            return leave({ chatKey: str(b.chatKey, 'chatKey'), who: str(b.who, 'who', { max: 80 }), avatar: typeof b.avatar === 'string' ? b.avatar.slice(0, 200) : null });
        },
        // 谁接话（方案 自动进离场与调度 第二节第 5 条）：玩家发了一句、某人答完一条，扩展问一次——按顺序的几个人（答／接／插／旁白）；
        // 顺带：这会儿该叩门就把候着的一条给扩展叫他写（knock）、候着的那一个（waiting，画快捷按钮）、谁走了（left，扩展关区间、静音）
        'POST /v1/turn': async b => {
            const auto = settings().auto;
            if (!auto?.turn) bad('auto_unavailable');
            return auto.turn({ chatKey: str(b.chatKey, 'chatKey'), present: strings(b.present, 60, 200), recentUser: typeof b.recentUser === 'string' ? b.recentUser.slice(-4000) : '', peek: b.peek === true });
        },
        // 快捷按钮：接／让他进来＝进场，不理＝作废
        'POST /v1/leave-ack': b => {
            const chatKey=str(b.chatKey,'chatKey'); store.requireChat(chatKey);
            if(!Array.isArray(b.receipts)||b.receipts.length>100) bad('bad_receipts');
            if(!b.receipts.every(r=>r&&Number.isInteger(r.version)&&r.version>0&&['leave','undo'].includes(r.action))) bad('bad_receipt');
            return settings().auto.acknowledge({chatKey,receipts:b.receipts.map(r=>({id:str(r.id,'id',{max:500}),version:r.version,action:r.action}))});
        },
        'POST /v1/knock-answer': async b => {
            const auto = settings().auto;
            if (!auto?.answer) bad('auto_unavailable');
            return auto.answer({ chatKey: str(b.chatKey, 'chatKey'), who: str(b.who, 'who', { max: 80 }), answer: str(b.answer ?? '接', 'answer', { max: 10 }) });
        },
        // 打字时预跑（D-100）：草稿先配词、替在场的人组装，发出去和草稿一样就直接用上。立刻返回，不等。
        'POST /v1/prefetch': b => {
            const chatKey = str(b.chatKey, 'chatKey'), draft = typeof b.draft === 'string' ? b.draft.slice(-4000) : '', present = strings(b.present, 30, 200);
            // 自动进离场开着：按调度认出这句之后谁会开口，只替他们预跑（以前替在场的人都预跑，试玩三天里预跑占了组装调用的八成）
            let only = null;
            try { only = settings().auto?.predict?.({ chatKey, present, recentUser: draft }) ?? null; } catch {}
            return prefetchDraft(store, records, { assembler, keyMaker }, { chatKey, draft, recent: strings(b.recent, 5, 4000), present, only });
        },
        // 看某个角色此刻会拿到什么，不钉住。默认只看纯程序那一格；assemble: true 才真调模型组装（花钱）。
        'POST /v1/slot-preview': async b => {
            const { text: whole, mode, parts = null } = await composeSlot(store, records, {
                chatKey: str(b.chatKey, 'chatKey'), speaker: str(b.speaker, 'speaker'), speakerName: str(b.speakerName, 'speakerName', { optional: true }),
                recent: strings(b.recent, 5, 4000), recentUser: typeof b.recentUser === 'string' ? b.recentUser.slice(-4000) : '', present: strings(b.present, 30, 200),
            }, { ...(b.assemble === true ? { assembler, keyMaker } : {}), economy: withPack(b.chatKey).economy, contacts: { ...settings().contacts, record: false }, absence: { ...settings().absence, record: false }, world: { ...withPack(b.chatKey).world, record: false }, planner: { ...(settings().planner ?? {}), record: false }, mood: settings().mood, vectors: settings().vectors,
                slot: settings().slot, pace: settings().pace, factions: withPack(b.chatKey).factions, situation: settings().situation ? { ...settings().situation, record: false } : null });
            // 分块放时，预览里标出每一块放在提示词的哪儿
            const s = settings().slot ?? {};
            const where = { world: '开头：角色定义之前（这阵子外面的背景）', base: '角色定义之后、聊天记录之前（底子，后面跟着他心里、手上还挂着的）', mid: `中段：倒数第 ${s.midDepth ?? 4} 条消息之前（口袋）`, recall: (s.recallDepth ?? -1) >= 0 ? `倒数第 ${s.recallDepth} 条消息之前（想起的）` : '聊天记录之前（想起的）', now: `倒数第 ${s.nowDepth ?? 4} 条消息之前（这一轮）` };
            const text = !parts ? whole : ['world', 'base', 'recall', 'mid', 'now'].filter(k => parts[k]).map(k => `〔${where[k]}〕\n${parts[k]}`).join('\n\n');
            return { text, mode, parts };
        },
        // 账本（全窗口，不分谁知道）：面板上看。
        'POST /v1/ledger': b => {
            if (!records) bad('records unavailable');
            const chatKey = str(b.chatKey, 'chatKey');
            store.requireChat(chatKey);
            const userName = [...store.currentMessages(chatKey)].reverse().find(m => m.is_user)?.name ?? null;
            const ledger = buildLedger(records.visible(chatKey), { named: namedParties(store.getCast?.(store.requireChat(chatKey).story_id) ?? [], userName) });
            const row = r => ({ pos: r.pos, text: r.text, ...r.money, left: r.left ?? null });
            const currency = withPack(chatKey).economy.table?.currency ?? '';
            const left = balances(records.visible(chatKey), { start: store.setupOf?.(store.requireChat(chatKey).story_id)?.data?.钱 ?? [], people: [userName] }).map(x => balanceText(x, currency)).filter(Boolean);
            return { currency, left, debts: ledger.debts.map(row), deals: ledger.deals.map(row), quotes: ledger.quotes.map(row), moves: ledger.moves.map(row) };
        },
        // 名册：cards＝ST 里现有的卡（扩展打开窗口时带来，补默认档）；set＝用户改的档位与钩子。
        'POST /v1/cast': b => {
            const chat = store.requireChat(str(b.chatKey, 'chatKey'));
            let need = [];
            if (typeof b.dismissPromotion === 'string' && store.getCast(chat.story_id).some(e => e.avatar === b.dismissPromotion && String(e.avatar).startsWith('face:'))) store.setMeta(`cast_promotion_dismissed:${chat.story_id}:${b.dismissPromotion}`, '1');
            if (Array.isArray(b.cards)) {
                const cards = b.cards.filter(c => c && typeof c.avatar === 'string' && typeof c.name === 'string').slice(0, 2000)
                    .map(c => ({ avatar: c.avatar.slice(0, 300), name: c.name.slice(0, 100), ...(typeof c.gender === 'string' ? { gender: c.gender } : {}), hash: typeof c.hash === 'string' ? c.hash.slice(0, 64) : null }));
                const members = chat.members ? JSON.parse(chat.members) : [];
                const messages = store.currentMessages(chat.key);
                const speakers = new Set(messages.filter(m => !m.is_user && m.name).map(m => m.name));
                // 这一局认得的名字：聊天里、开局单里、关系表里出现过的
                const known = [messages.map(m => m.text).join(' '), JSON.stringify(store.setupOf(chat.story_id)?.data ?? ''), JSON.stringify(store.relationsOf?.(chat.story_id) ?? '')].join(' ');
                const listed = store.getMeta(`roster_listed:${chat.story_id}`) === '1'
                    || store.db.prepare('select set_by from relations where story_id = ?').get(chat.story_id)?.set_by === 'preset';
                store.putCast(chat.story_id, autoRoster({ cards, members, speakers, mentioned: mentionedIn(known), listed }));
                // 这一局用得上的人里，卡还没读过、或者卡改过了的：请扩展把正文交来（D-109）
                const used = new Set(store.getCast(chat.story_id).filter(e => e.role !== '不用').map(e => e.avatar));
                need = cards.filter(c => c.hash && used.has(c.avatar) && store.profileOf(c.avatar)?.card_hash !== c.hash).map(c => c.avatar);
            }
            if (Array.isArray(b.texts)) {
                const make = settings().profile?.make;
                for (const t of b.texts.slice(0, 50)) {
                    if (!t || typeof t.avatar !== 'string' || typeof t.text !== 'string' || typeof t.hash !== 'string') continue;
                    const card = { avatar: t.avatar.slice(0, 300), name: String(t.name ?? '').slice(0, 100), hash: t.hash.slice(0, 64), text: t.text.slice(0, 20000) };
                    store.putCardText(card.avatar, card.name, card.hash, card.text);
                    if (make && store.profileOf(card.avatar)?.hash !== profileHash(card.hash)) make(card).catch(() => {});
                }
            }
            if (Array.isArray(b.set)) {
                const known = new Map(store.getCast(chat.story_id).map(e => [e.avatar, e]));
                const set = b.set.filter(e => e && known.has(e.avatar) && ROLES.includes(e.role))
                    .map(e => ({ avatar: e.avatar, name: known.get(e.avatar).name, ...(typeof e.gender === 'string' ? { gender: e.gender } : {}), role: e.role, hook: typeof e.hook === 'string' && e.hook.trim() ? e.hook.trim().slice(0, 500) : null,
                        priority: e.priority == null ? null : !!e.priority, bond: 'bond' in e ? (e.bond === '' || e.bond == null ? null : Number(e.bond)) : undefined, ...(typeof e.群体 === 'boolean' ? { 群体: e.群体 } : {}) }));
                store.putCast(chat.story_id, set, { byUser: true });
                for (const e of b.set) if (e && known.has(e.avatar) && 'interests' in e) store.setInterests(chat.story_id, e.avatar, typeof e.interests === 'string' ? e.interests : null);
            }
            const near = records ? closenessTable(store, records, chat.key) : new Map();
            const roster = store.getCast(chat.story_id), names = roster.map(e => e.name), rawRel = store.relationsOf(chat.story_id);
            const rel = rawRel ? normalizeRelations(rawRel) : null;
            const same = (a, c) => !!a && !!c && (sameName(a, c, names) || (rel && personOf(rel, a, names) && personOf(rel, a, names) === personOf(rel, c, names)));
            const player = [...store.currentMessages(chat.key)].reverse().find(m => m.is_user)?.name;
            const thresholds = { ...CAST_PROMOTION_DEFAULTS, ...settings().cast };
            const leaves = (store.readyPlans?.(chat.key) ?? []).flatMap(p => { try { return JSON.parse(p.node ?? 'null')?.留下 ?? []; } catch { return []; } });
            const promotions = records ? new Set(promotionCandidates({ roster, records: records.visible(chat.key), leaves, menu: store.menuOf?.(chat.key) ?? [], player, same, recordThreshold: thresholds.promoteRecords, weightThreshold: thresholds.promoteWeight })) : new Set();
            return { roles: ROLES, need, cast: roster.map(e => ({ ...e, closeness: near.get(e.avatar) ?? null, ...(promotions.has(e.avatar) && store.getMeta(`cast_promotion_dismissed:${chat.story_id}:${e.avatar}`) !== '1' ? { promote: true } : {}) })) };
        },
        // 暂停离开计时（全局）：忙一段时间时勾上，世界等你；取消的那一刻起重新计。
        'POST /v1/absence': b => {
            if (typeof b.paused === 'boolean') {
                const was = store.getMeta('absence_paused') === '1';
                store.setMeta('absence_paused', b.paused ? '1' : '0');
                if (was && !b.paused) store.setMeta('absence_resumed_at', Date.now());
            }
            // 这一局离开时怎么过（按局设）：mode＝real｜pause｜''（空＝跟着配置）
            let mode = null;
            if (typeof b.chatKey === 'string' && b.chatKey) {
                const chat = store.requireChat(b.chatKey);
                if (b.mode !== undefined) store.setMeta(`absence_mode:${chat.story_id}`, b.mode === 'pause' || b.mode === 'real' ? b.mode : null);
                mode = { own: store.getMeta(`absence_mode:${chat.story_id}`) || '', now: absenceModeOf(store, b.chatKey, settings().absence) };
            }
            return { paused: store.getMeta('absence_paused') === '1', resumedAt: Number(store.getMeta('absence_resumed_at')) || null, mode };
        },
        // /写 /玩 /聊：用户临时的要求（原话），不进聊天记录。clear＝收回这一类。
        'POST /v1/note': b => {
            const chatKey = str(b.chatKey, 'chatKey');
            const kind = ['写', '玩', '聊'].includes(b.kind) ? b.kind : bad('kind invalid');
            if (b.clear) store.clearNotes(chatKey, kind);
            else {
                const s = storyContext(store, records, chatKey);
                store.addNote({ chatKey, kind, text: str(b.text, 'text', { max: 1000 }), storyDay: s.today, pos: s.lastPos });
                const planner = settings().planner;
                // /聊 是跟规划者商量方向（N-88：改方向才重新规划）；/玩 只影响当天的供料，不叫规划者。
                if (kind === '聊' && planner) requestPlanNow(store, records, chatKey, planner, { reason: 'notes' });
            }
            return { notes: store.notesOf(chatKey) };
        },
        'POST /v1/intimate-stop': b => stopIntimate(store, records, str(b.chatKey, 'chatKey'), { present: strings(b.present, 30, 200) }),
        // 早些的回复换成大意（N-231）：扩展发给前台前，把较早的角色回复换成记账记下的那几件事。
        'POST /v1/digest': b => {
            if (!records) bad('records unavailable');
            const chatKey = str(b.chatKey, 'chatKey');
            const fps = Array.isArray(b.fps) ? b.fps.filter(isFp).slice(0, 2000) : bad('fps invalid');
            return { items: digests(records, { storyId: store.requireChat(chatKey).story_id, chatKey, fps }) };
        },
        // 场次摘要（N-284）：面板上看这个窗口此刻还算数的每一场（哪天什么时候、在哪、谁在场、经过），能改；run＝现在就补写（花几美分）。
        'POST /v1/episodes': async b => {
            const chatKey = str(b.chatKey, 'chatKey');
            store.requireChat(chatKey);
            const ran = b.run === true ? await settings().episodes?.run?.({ chatKey, force: true }) ?? { written: 0, off: true } : null;
            const tl = timelineFor(store, records, chatKey);
            const row = new Map(tl.rows.map(r => [r.pos, r]));
            const label = pos => (r => (r ? [dateIn(tl.start, r.day)?.ymd, tl.scale.ordinal(dayNumber(tl.start, r.day)), r.part].filter(Boolean).join(' · ') : ''))(row.get(pos));
            const list = (store.episodesOf?.(chatKey) ?? []).map(e => ({ id: e.id, from: e.from_pos, to: e.to_pos, when: label(e.from_pos), place: e.place, present: e.present, text: e.text, edited: !!e.edited }));
            return { episodes: list, total: store.currentMessages(chatKey).length, ...(ran ? { ran } : {}) };
        },
        'POST /v1/episode-edit': b => {
            const chatKey = str(b.chatKey, 'chatKey');
            const id = Number(b.id);
            if (!Number.isInteger(id)) bad('id invalid');
            const ok = store.editEpisode(store.requireChat(chatKey).story_id, id, str(b.text, 'text', { max: 1200 }));
            if (!ok) bad('no such episode');
            return { ok: true };
        },
        // 剧情日期的小标签（N-265）：每条都有——日期、从哪天算的第几天、时段、当天天气；拿不准的、用户点过的另标。只是界面装饰，扩展挂在消息名字旁边。
        'POST /v1/timeline': b => {
            const chatKey = str(b.chatKey, 'chatKey');
            const tl = timelineFor(store, records, chatKey);
            // 尺度（章程 G2）：扩展改日期的那个小窗按这一局的单位和时段写（"从这条起算新的一年"、时段选春夏秋冬）
            return { labels: labelsOf(tl, tl.start, { seed: tl.seed, notes: store.stateNotesOf?.(chatKey) ?? [] }), today: tl.today, hasDate: !!tl.start?.日期, since: sinceWord(tl.start),
                scale: { unit: tl.scale.unit, word: tl.scale.word, ord: tl.scale.ord, parts: [...tl.scale.parts] } };
        },
        'POST /v1/boards': b => {
            const chatKey = str(b.chatKey, 'chatKey');
            const all = store.currentMessages(chatKey);
            const from = Number.isInteger(Number(b.from)) ? Math.max(0, Number(b.from)) : Math.max(0, all.length - 20);
            const to = Number.isInteger(Number(b.to)) ? Math.min(all.length, Number(b.to)) : all.length;
            const tl = timelineFor(store, records, chatKey, all);
            return { boards: all.slice(from, to).map(message => {
                const board = boardFor(store, records, chatKey, { anchor: `${message.pos + 1}:${message.fp}`, timeline: tl });
                return { pos: message.pos, fp: message.fp, place: board.camera.place, from: board.camera.from, home: board.camera.home,
                    people: board.people.map(person => ({ name: person.name, status: person.status, way: person.way })),
                    time: { day: board.time.day, part: board.time.part } };
            }) };
        },
        // ST 世界书谁知道（§5.4、N-252）：entries＝扩展这回加载到、后台还没见过的条目（带内容）；set＝玩家改的 [{key, all, who}]。
        // 回给扩展每条的判断（按内容指纹认），扩展据此把开口的人不该知道的条目拿掉。
        'POST /v1/lore': b => {
            const chatKey = str(b.chatKey, 'chatKey');
            const storyId = store.requireChat(chatKey).story_id;
            if (Array.isArray(b.entries)) {
                const entries = b.entries.slice(0, 2000).filter(e => e && typeof e.key === 'string' && typeof e.hash === 'string')
                    .map(e => ({ key: e.key.slice(0, 300), hash: e.hash.slice(0, 64), world: str(e.world ?? '', 'world', { optional: true, max: 300 }), title: String(e.title ?? '').slice(0, 300), text: String(e.text ?? '').slice(0, 20000) }));
                // judge=false：只是让后台认得这几条（记账的【已知的】要用），没开"按开口的人筛"就不花钱判谁知道
                if (store.seeLore(storyId, entries) && b.judge !== false) settings().lore?.run?.({ chatKey }).catch(() => {});
            }
            if (Array.isArray(b.set)) for (const x of b.set) {
                if (!x || typeof x.key !== 'string') continue;
                const who = Array.isArray(x.who) ? x.who.filter(n => typeof n === 'string' && n.trim()).map(n => n.trim().slice(0, 60)) : [];
                store.setLore(storyId, x.key, x.all || !who.length ? { all: true, who: [] } : { all: false, who, why: '玩家定的' }, 'user');
            }
            const rows = store.loreOf(storyId);
            return { verdicts: Object.fromEntries(rows.filter(r => r.verdict).map(r => [r.key, { hash: r.hash, all: r.verdict.all !== false, who: r.verdict.who ?? [], source: r.source }])),
                rows: rows.map(({ text, ...r }) => r), pending: rows.filter(r => !r.verdict).length };
        },
        // 补认约定（N-268）：早先记下的打算、答应补上约定那一格；run 为真才调模型，不然只给预览（几条、大概多少钱）。
        'POST /v1/promises-recheck': async b => {
            const chatKey = str(b.chatKey, 'chatKey');
            store.requireChat(chatKey);
            const fn = settings().recheckPromises;
            if (!fn) bad('recheck unavailable');
            return fn({ chatKey, run: b.run === true });
        },
        // 跟后台说话（N-104）：text＝说一句（后台调模型，好了再来取）；apply＝{turn, i, skip} 记或不记一条提议；clear＝清空；什么都不带＝看现在的。
        'POST /v1/talk': async b => {
            const chatKey = str(b.chatKey, 'chatKey');
            store.requireChat(chatKey);
            const talk = settings().talk;
            if (!talk) bad('talk unavailable');
            if (b.clear) return talk.clear(chatKey);
            if (b.apply && typeof b.apply === 'object') return talk.apply(chatKey, { turn: Number(b.apply.turn), i: Number(b.apply.i), skip: !!b.apply.skip });
            if (typeof b.text === 'string' && b.text.trim()) talk.send(chatKey, str(b.text, 'text', { max: 2000 }).trim());
            return talk.view(chatKey);
        },
        // /账：查已经确立的事（程序查，不调模型；不给幕后的菜单）。
        'POST /v1/ask': b => {
            const chatKey = str(b.chatKey, 'chatKey');
            const q = str(b.q, 'q', { optional: true, max: 500 }) ?? '';
            const s = storyContext(store, records, chatKey);
            const line = r => `${s.when(r)} · ${r.holder_name ?? r.holder}：${r.text}（第 ${r.pos} 条）`;
            let clock = null;
            try { clock = clockFor(store, records, chatKey); } catch {}
            const lines = [`现在是剧情${s.ts.nth(s.today + 1)}（从这个窗口开头算）${clock?.now ? `：${clock.now}` : ''}${clock?.weather ? `；${s.ts.this}的天气：${clock.weather}` : ''}，共 ${s.lastPos + 1} 条消息。`];
            if (q.trim()) {
                const hits = rankByOverlap(s.visible.filter(r => r.type !== '时间'), q, { textToo: true }).slice(0, 12).map(x => x.r).sort((a, c) => a.pos - c.pos);
                lines.push(hits.length ? '跟这个有关的记录：' : '没找到跟这个有关的记录。', ...hits.map(r => `· ${line(r)}`));
            } else {
                const open = s.visible.filter(r => r.type === '想法' && s.openIdeaIds.has(r.id)).slice(-12);
                if (open.length) lines.push('还开着的想法：', ...open.map(r => `· ${line(r)}`));
                const away = s.people();
                if (away.length) lines.push('不在场、有事挂着的人：', ...away.map(p => `· ${p.person}（${p.role}，${s.closenessOf(p.person).level}）${p.lastPos < 0 ? '还没出场' : `上次露面${s.when({ pos: p.lastPos })}`}`));
            }
            const table = withPack(chatKey).economy.table;
            if (!q.trim() || talksMoney(q, table)) {
                const left = balances(s.visible, { start: store.setupOf?.(s.chat.story_id)?.data?.钱 ?? [], people: [s.userName] }).map(x => balanceText(x, table?.currency ?? '')).filter(Boolean);
                if (left.length) lines.push('手上的钱（按记下的进出算）：', ...left.map(l => `· ${l}`));
                lines.push(...moneyLines(buildLedger(s.visible, { named: namedParties(store.getCast?.(s.chat.story_id) ?? [], s.userName) }), { name: '账上', when: s.when, currency: table?.currency ?? '', max: 10 }));
            }
            return { lines };
        },
        // 各环节的钥匙和模型（D-106）：看；存钥匙、删钥匙；换某个环节的钥匙、型号、单价、思考档；恢复成跟着原配置。钥匙本身从不回给浏览器。
        'POST /v1/stages': b => {
            const s = settings().stages;
            if (!s) bad('stages_unavailable');
            if (b.saveKey) return s.saveKey({ name: b.saveKey.name, baseUrl: b.saveKey.baseUrl, apiKey: b.saveKey.apiKey ?? null });
            if (b.removeKey !== undefined) return s.removeKey(str(b.removeKey, 'removeKey', { max: 40 }));
            if (b.set) return s.setStage(str(b.set.id, 'id', { max: 40 }), b.set);
            if (b.reset !== undefined) return s.resetStage(str(b.reset, 'reset', { max: 40 }));
            return s.view();
        },
        // 只有一把钥匙时：它调得了推荐的型号吗（拉型号列表比一比，不花钱）；调不了的几格一键换成同一个它调得了的
        'POST /v1/stages-fit': async b => {
            const s = settings().stages;
            if (!s) bad('stages_unavailable');
            if (b.useModel !== undefined) return s.useModel(str(b.useModel, 'useModel', { max: 200 }));
            return s.fit();
        },
        // 某把钥匙（或某个环节此刻那把）在那个地址上能用哪些型号
        'POST /v1/stage-models': async b => {
            const s = settings().stages;
            if (!s) bad('stages_unavailable');
            return s.models({ stage: str(b.stage, 'stage', { optional: true, max: 40 }), key: str(b.key, 'key', { optional: true, max: 40 }) });
        },
        // 测这一环节此刻的型号经这条线传不传得过去思考档（真调一两次极短的，几分钱）
        'POST /v1/stage-probe': async b => {
            const s = settings().stages;
            if (!s) bad('stages_unavailable');
            return s.probe(str(b.stage, 'stage', { max: 40 }));
        },
        // 跟着正本（D-117）：check＝看有没有新版本（会先拉一下正本）；apply＝更新并重启后台。开发副本（没带 --follow）答 release: false。
        'POST /v1/update': async b => {
            const r = settings().release;
            if (!r) return { release: false, head: settings().code?.slice(0, 7) ?? null };
            return { release: true, ...(b.apply === true ? await r.apply() : await r.check()) };
        },
        // 调参（面板"设置 → 调参"）：看此刻各项的值；set＝改一项（reset: true＝恢复默认）。只收 core/tuning.mjs 那张表里的项。
        'POST /v1/tuning': b => {
            const t = settings().tuning;
            if (!t) bad('tuning_unavailable');
            if (b.set !== undefined) { const view = t.set(str(b.set, 'set', { max: 80 }), b.reset === true ? undefined : b.value); settings().refreshPlanPackets?.(); return view; }
            return t.view();
        },
        // 这一局的素材包（D-104）：看有哪些、这一局用哪个；set＝选一个（空＝不用包）。
        'POST /v1/pack': b => {
            const chatKey = str(b.chatKey, 'chatKey');
            const chat = store.requireChat(chatKey);
            const packs = settings().listPacks?.() ?? [];
            if (b.set !== undefined) {
                const name = typeof b.set === 'string' ? b.set.trim() : '';
                if (name && !packs.includes(name)) bad('没有这个素材包');
                store.setMeta(`pack:${chat.story_id}`, name || null);
            }
            return { packs, pack: store.getMeta(`pack:${chat.story_id}`) || null };
        },
        // 规划：看状态；request＝现在就叫规划者；reveal＝看幕后菜单（会剧透）。
        'POST /v1/plan': b => {
            const chatKey = str(b.chatKey, 'chatKey');
            store.requireChat(chatKey);
            const planner = settings().planner;
            // provider: 'queue'：这一次只出外援包、不调 API（本机工具把写好的规划交回来用；转发插件不传这个）
            if (b.reroll && !planner) bad('规划目前关闭');
            if (b.reroll && planner) requestPlanNow(store, records, chatKey, planner, { reason: 'reroll' });
            if (!b.reroll && b.request && planner) requestPlanNow(store, records, chatKey, planner, { reason: 'user', entry: 'button', ...(b.provider === 'queue' ? { force: 'queue' } : {}) });
            const last = store.lastPlan(chatKey);
            const menu = store.menuOf(chatKey);
            const count = st => menu.filter(m => m.status === st).length;
            return {
                planning: store.planningState(chatKey),
                provider: planner?.provider ?? 'off', last: last ? { id: last.id, status: last.status, reason: last.reason, createdAt: last.created_at, readyAt: last.ready_at } : null,
                counts: { waiting: count('waiting'), pocket: count('pocket'), used: count('used'), sunk: count('sunk') + count('sunk_told'), void: count('void'), expired: count('expired') },
                ...(b.reveal ? (ready => ({ goal: ready?.goal ?? null, node: ready?.node ? JSON.parse(ready.node) : null, menu }))(store.lastReadyPlan(chatKey)) : {}),
            };
        },
        // 交回菜单（本机工具用；转发插件也会转过来（要先过 ST 登录））。
        'POST /v1/plan-submit': b => {
            const plan = store.planById(Number(b.id)) ?? bad('no such plan');
            const attempt = store.beginPlanAttempt(plan.id, { entry: 'handoff', model: 'window', briefChars: plan.brief?.length ?? 0 });
            if (!attempt) throw Object.assign(new Error(store.activePlanAttempt(plan.chat_key, plan.id) ? '正在重新规划' : 'plan_late：迟到作废'), { status: 409 });
            try {
            store.updatePlanAttempt(attempt, { stage: '解析', outputChars: typeof b.text === 'string' ? b.text.length : 0 });
            const chat = store.requireChat(plan.chat_key);
            const parsed = parsePlan(str(b.text, 'text', { max: 100000 }), intimatePlanOptions(store, plan.chat_key, planRoster(store, chat.story_id, { chatKey: plan.chat_key })));
            if (!parsed.items.length) bad(`菜单一条都没过：${parsed.dropped.map(d => d.reason).join('；')}`);
            const anchors = withPack(plan.chat_key).world.anchors;
            const years = anchors ? (setup => planYearFlags(parsed, anchors, storyYear(setup), { setup }))(store.setupOf(chat.story_id)?.data).map(yearFlagText) : [];
            if (years.length) bad(`年份和年表对不上，改了再交：${years.join('；')}`);
            if (!store.ownsPlanAttempt(attempt)) throw Object.assign(new Error('plan_late：迟到作废'), { status: 409 });
            store.updatePlanAttempt(attempt, { stage: '落账' });
            const menu = store.submitPlan(plan.id, { ...parsed, raw: b.text });
            addFaces(store, chat.story_id, parsed.faces);
            handoffs?.settle('plan', String(plan.id));
            // 只提醒、不退件的（章程 H5：头一格太密）和退了的一起回给交的人
            store.finishPlanAttempt(attempt);
            return { goal: parsed.goal, items: parsed.items.length, dropped: [...parsed.dropped, ...(parsed.warnings ?? []).map(reason => ({ reason, kept: true }))], menu };
            } catch (error) { const failure = planFailure(error); store.finishPlanAttempt(attempt, { status: failure === 'late' ? 'late' : 'failed', failure }); throw error; }
        },
        // 问参谋（本机工具用；转发插件也会转过来（要先过 ST 登录））：规划者碰到原作／世界层面的问题时。备忘是候选，不是事实。
        'POST /v1/advise': async b => {
            if (!advisor) bad('参谋没接上');
            const plan = b.planId != null ? store.planById(Number(b.planId)) ?? bad('no such plan') : null;
            const chatKey = plan?.chat_key ?? (b.chatKey ? str(b.chatKey, 'chatKey') : null);
            // 这一局的开局单（原则、走向、前史）自动当本局前提带上，问的人只补眼下这一问的前提。
            const setup = chatKey ? store.setupOf(store.requireChat(chatKey).story_id)?.data : null;
            const context = [advisorContext(setup), b.context ? str(b.context, 'context', { max: 4000 }) : ''].filter(Boolean).join('\n');
            const roster = chatKey ? store.getCast(store.requireChat(chatKey).story_id).map(e => e.name) : [];
            return advisor.ask({ question: str(b.question, 'question', { max: 2000 }), context, chatKey, roster, year: storyYear(setup) });
        },
        // 开局单：看；source＝贴一整段让后台分格（后台跑，隔一会儿再来看）；text＝改过的全文（confirm＝确认生效）；discard＝丢掉草稿。
        'POST /v1/setup': b => {
            const chat = store.requireChat(str(b.chatKey, 'chatKey'));
            const storyId = chat.story_id;
            let receipt = null;
            const view = () => {
                const c = store.setupOf(storyId), d = store.setupDraft(storyId);
                const checked = data => checkIntimate(data, { names: setupNames(storyId) });
                // 填表时"人物开场状态"那几行的初值：和表交上来时并进的是同一份（有草稿就是草稿）
                const base = checked(d?.status === 'draft' ? d.data : c?.data);
                return {
                    ready: !!setupMaker, receipt,
                    intimateWarnings: intimateRows(base).filter(x => x.error).map(x => `${x.谁.join('、')}：${x.error}`),
                    confirmed: c ? { text: toText(checked(c.data)), at: c.created_at, data: checked(c.data) } : null,
                    draft: d ? { status: d.status, text: d.data ? toText(checked(d.data)) : null, unchecked: d.unchecked.length, error: d.error, at: d.updated_at } : null,
                    rows: formRows(base),
                    // 填表时预先填上的（章程 K1）：全剧情必要角色（原则里那条读回的名字）、主角团
                    mustCast: mustCastOf(base), crew: base?.主角团 ?? [],
                };
            };
            if (b.source != null) {
                if (!setupMaker) bad('开局单分格没接上');
                if (['working', 'handoff'].includes(store.setupDraft(storyId)?.status)) return view();
                const source = str(b.source, 'source', { max: 100000 });
                if (source.trim().length < 20) bad('贴的内容太短');
                startDraft(chat, source);
            } else if (b.form && typeof b.form === 'object') {
                // 表格填的（开局单设计稿 §四）：并进现有那份；确认时基调和类别必填
                const missing = formMissing(b.form);
                if (b.confirm === true && missing.length) bad(`还没填：${missing.join('、')}`);
                const base = store.setupDraft(storyId)?.status === 'draft' ? store.setupDraft(storyId).data : store.setupOf(storyId)?.data;
                const data = checkIntimate(formMerge(base, b.form), { names: setupNames(storyId) });
                if (b.confirm === true) { store.confirmSetup({ storyId, data }); keysFor(storyId, chat.key); seedOpening(chat.key); receipt = receiptLines(data); } else store.saveSetupDraft({ storyId, data });
            } else if (b.draft != null) {
                // 别处分好的（测试期中转卡住时由 Claude 子代理分）：同样逐条核对原文，进草稿等用户核对。
                const d = store.setupDraft(storyId);
                if (!d?.source) bad('先贴一段');
                const parsed = parseSetup(str(b.draft, 'draft', { max: 300000 }), { source: d.source, names: setupNames(storyId) });
                store.finishSetup(d.status === 'working' ? store.startSetup({ storyId, source: d.source }) : d.id, parsed);
                handoffs?.settle('setup', String(d.id));
            } else if (b.text != null) {
                const data = fromText(str(b.text, 'text', { max: 200000 }), { names: setupNames(storyId) });
                if (b.confirm === true) { store.confirmSetup({ storyId, data }); keysFor(storyId, chat.key); seedOpening(chat.key); receipt = receiptLines(data); } else store.saveSetupDraft({ storyId, data });
            } else if (b.discard === true) store.discardSetupDraft(storyId);
            else if (b.keys === true) keysFor(storyId, chat.key);
            return view();
        },
        // 上传的剧情素材（materials.mjs）：files＝[{name, text}] 传上来（后台看一眼提用法）；use＝{name, kind} 照这个用法处理；remove＝删。
        'POST /v1/material': b => {
            const chat = store.requireChat(str(b.chatKey, 'chatKey'));
            const m = settings().materials;
            if (!m) bad('materials unavailable');
            let started = null;
            if (Array.isArray(b.files) && b.files.length) {
                m.add(chat.story_id, b.files.slice(0, 20).map(f => ({ name: String(f?.name ?? ''), text: String(f?.text ?? '') })));
                m.look({ chatKey: chat.key }).catch(() => {});
            } else if (b.use && typeof b.use === 'object') {
                const name = str(b.use.name, 'name', { max: 200 }), kind = str(b.use.kind, 'kind', { max: 20 });
                const item = m.list(chat.story_id).find(x => x.name === name) ?? bad('没有这份素材');
                if (kind === '开局单') {
                    if (!setupMaker) bad('开局单分格没接上');
                    if (['working', 'handoff'].includes(store.setupDraft(chat.story_id)?.status)) bad('开局单还在分上一份，等它好了再来');
                    startDraft(chat, m.text(chat.story_id, name).slice(0, 100000));
                    m.update(chat.story_id, name, { kind, status: 'applied' });
                    started = 'setup';
                } else if (kind === '关系表') {
                    if (item.status === 'drafted' && item.draft) return { items: m.list(chat.story_id), draft: item.draft };
                    m.update(chat.story_id, name, { kind, status: 'working', error: null });
                    m.relations({ chatKey: chat.key, name }).catch(() => {});
                    started = 'relations';
                } else if (kind === '参考资料') m.update(chat.story_id, name, { kind, status: 'applied', where: '参考' });
                else bad('kind invalid');
            } else if (typeof b.done === 'string') m.update(chat.story_id, b.done, { status: 'applied' });
            else if (typeof b.remove === 'string') m.remove(chat.story_id, b.remove);
            return { items: m.list(chat.story_id).map(({ draft, ...x }) => ({ ...x, hasDraft: !!draft })), started };
        },
        // 局预设（收口计划第 5 件）：看有哪些；save＝把这一局存成一份；apply＝套到这一局（套之前原来的样子另存一份）；
        // remove＝删；export＝拿整份（面板导出成文件）；import＝导入整份（别的副本导出来的）。
        'POST /v1/preset': b => {
            const p = settings().presets;
            if (!p) bad('presets_unavailable');
            if (b.remove !== undefined) { p.remove(str(b.remove, 'remove', { max: 80 })); return { presets: p.list() }; }
            if (b.export !== undefined) { const one = p.get(str(b.export, 'export', { max: 80 })); if (!one) bad('没有这份预设'); return { preset: one }; }
            if (b.import !== undefined) {
                if (!b.import || typeof b.import !== 'object') bad('import invalid');
                return { saved: p.put(b.import), presets: p.list() };
            }
            const chat = b.chatKey ? store.requireChat(str(b.chatKey, 'chatKey')) : null;
            if (b.save !== undefined) {
                if (!chat) bad('chatKey required');
                const s = snapshot(store, chat.story_id, { name: str(b.save, 'save', { max: 80 }), includeGrownFaces: b.includeGrownFaces === true });
                if (!s.setup && !s.cast.length && !s.relations) bad('这一局还没有开局单、名册、关系表，没什么可存的');
                return { saved: p.put(s), presets: p.list() };
            }
            if (b.apply !== undefined) {
                if (!chat) bad('chatKey required');
                const one = p.get(str(b.apply, 'apply', { max: 80 }));
                if (!one) bad('没有这份预设');
                p.backup(snapshot(store, chat.story_id, { name: `套用前-${chat.story_id}` }));
                const applied = applyPreset(store, chat.story_id, one);
                store.setMeta(`roster_listed:${chat.story_id}`, '1');
                // 前史还没配检索词的（预设是没配完就存的）补一次
                if (one.setup?.前史?.some(x => !x.keys?.length)) keysFor(chat.story_id, chat.key);
                return { applied, presets: p.list() };
            }
            return { presets: p.list() };
        },
        // 开局包（_dev/开局包格式-20261017.md）：path＝本机的局包目录；不带 go 只看一眼（不带正文）；go＝素材包复制进本仓、卡／书／局预设的正文交给扩展往 ST 里导
        'POST /v1/opening-pack': b => {
            const p = str(b.path, 'path', { max: 500 });
            const go = b.go === true;
            const r = readOpeningPack(p, { full: go });
            if (go && r.pack) r.pack.installed = installPack(r.pack.dir, settings().packsDir?.() ?? null, { overwrite: b.overwrite === true });
            // 扩展要覆盖 ST 里的同名卡、书：先备份原件
            if (go && b.backup && typeof b.backup === 'object') r.backedUp = backupStFiles(settings().stRoot ?? null, settings().backupsDir ?? null, { cards: strings(b.backup.cards, 200, 300), books: strings(b.backup.books, 50, 300) });
            return r;
        },
        // 人物关系表（按局存）：看；text＝面板里改过的全文；data＝整份导入（本机工具用）。
        'POST /v1/relations': b => {
            const chat = store.requireChat(str(b.chatKey, 'chatKey'));
            if (b.text != null) store.putRelations(chat.story_id, relationsFromText(str(b.text, 'text', { max: 300000 })));
            else if (b.data != null) store.putRelations(chat.story_id, normalizeRelations(b.data), { by: 'import' });
            const data = store.relationsOf(chat.story_id);
            const d = data ? normalizeRelations(data) : null;
            const now = d && records ? currentLines(relationsNow(store, chat.key, d, records.visible(chat.key), store.getCast(chat.story_id).map(e => e.name))) : [];
            return { text: d ? relationsText(d) : null, people: d?.人.length ?? 0, unsure: d?.人.filter(p => p.待核.length || /待定/.test(p.能用)).map(p => p.名) ?? [], now };
        },
        // 打开窗口时问一声：用户是不是离开很久刚回来。是就记下这次离开、开始推各人这些天（后台跑），并说由谁先开口。
        // 再问一次拿推演的进度（working｜ready｜failed）。离开记在离开前最后那条上：那之后已经有新消息了，就不算"刚回来"。
        // 去复读：他刚说完的这条里和前几条重样的说法换成新的（core/fresh.mjs）。没开就原样返回。
        'POST /v1/fresh': async b => {
            const chatKey = str(b.chatKey, 'chatKey'), speaker = str(b.speaker, 'speaker');
            const text = typeof b.text === 'string' ? b.text.slice(0, 20000) : bad('text');
            store.requireChat(chatKey);
            const fresh = settings?.().fresh;
            // lore：生成这条时酒馆真触发的世界书（"书|uid"），核对硬事实用（N-279）
            const lore = Array.isArray(b.lore) ? b.lore.filter(k => typeof k === 'string' && k.length <= 300).slice(0, 60) : null;
            return fresh?.run ? fresh.run({ chatKey, speaker, text, before: typeof b.before === 'string' ? b.before : null, lore }) : { text, changes: [] };
        },
        'POST /v1/return': b => {
            const chatKey = str(b.chatKey, 'chatKey');
            const absence = settings().absence ?? {};
            if (absenceModeOf(store, chatKey, absence) === 'pause') return { away: false };
            noteAbsence(store, chatKey, absence);
            const lastPos = store.currentMessages(chatKey).at(-1)?.pos;
            const latest = store.absences(chatKey).at(-1);
            if (!latest || latest.from_pos !== lastPos || latest.seen.length) return { away: false };
            if (!latest.story_status && absence.think) absence.think({ chatKey, absenceId: latest.id }).catch(() => {});
            return { away: true, id: latest.id, days: latest.days, status: store.absences(chatKey).at(-1).story_status ?? 'working', first: records ? firstToSpeak(store, records, chatKey) : null };
        },
        // 删回去对账亮出来的那几行：看过了收起（rewind.mjs）
        // 玩家的人设（用户 10/12，N-368；数据约定第 1 条）：扩展把 ST 里眼下这个窗口用的人设（名字＋描述原文）交来，规划攒简报时读它，
        // 好知道玩家的角色是什么脾气、喜欢什么。存 meta persona:<chatKey>；名字和描述都没变就不动（at 记的是最后一次变的时候）
        'POST /v1/persona': b => {
            const chatKey = str(b.chatKey, 'chatKey');
            store.requireChat(chatKey);
            const name = str(b.name ?? '', 'name', { max: 200 }).trim();
            const text = str(b.text ?? '', 'text', { max: 64000 }).trim().slice(0, 4000);
            if (!text) return { ok: true, changed: false };
            let old = null;
            try { old = JSON.parse(store.getMeta(`persona:${chatKey}`) ?? 'null'); } catch {}
            if (old && old.name === name && old.text === text) return { ok: true, changed: false };
            store.setMeta(`persona:${chatKey}`, JSON.stringify({ name, text, at: new Date().toISOString() }));
            return { ok: true, changed: true };
        },
        'POST /v1/drift-clear': b => { const chatKey = str(b.chatKey, 'chatKey'); store.requireChat(chatKey); store.setMeta(`drift:${chatKey}`, null); return { ok: true }; },
        'POST /v1/status': b => {
            const chatKey = str(b.chatKey, 'chatKey');
            const extract = worker ? worker.plan({ chatKey }) : null;
            return { ...store.status({ chatKey }), planning: store.planningState(chatKey), intimateStopped: intimateStopped(store, records, chatKey), extract, leaveUnjudged: settings?.().auto?.unjudged?.({ chatKey }) ?? 0, handoffs: handoffs?.list().length ?? 0, notice: JSON.parse(store.getMeta(`notice:${chatKey}`) ?? 'null'), drift: JSON.parse(store.getMeta(`drift:${chatKey}`) ?? 'null'), cut: settings?.().modelTally?.() ?? null };
        },
        // 外援队列面板：复制题目、贴回答案、再试 API、自动重试开关。
        'POST /v1/handoff-ui': async b => {
            if (b.action === 'prompt' || b.action === 'submit') {
                try {
                    if (!handoffs) throw new Error('no_such_handoff');
                    if (b.action === 'submit') return { ok: true, result: await handoffs.submit(Number(b.id), str(b.text, 'text', { max: 500000 })) };
                    const h = store.handoffById(Number(b.id));
                    if (!h) throw new Error('no_such_handoff');
                    if (h.status !== 'pending') throw new Error('handoff_closed');
                    const listed = handoffs.list().find(x => x.id === h.id);
                    if (!listed) throw new Error('handoff_stale');
                    const prompt = renderPrompt(h);
                    return { id: h.id, kind: h.kind, title: listed.title, prompt, chars: prompt.length };
                } catch (e) {
                    const errors = {
                        no_json_array: '回答里没找到要的那种列表（JSON 数组）。让它只输出 JSON 再试。',
                        not_array: '回答里没找到要的那种列表（JSON 数组）。让它只输出 JSON 再试。',
                        setup_bad_json: '回答里的 JSON 有语法错误。让它只输出 JSON 再试。',
                        keys_bad_json: '回答里的 JSON 有语法错误。让它只输出 JSON 再试。',
                        model_bad_json: '回答里的 JSON 有语法错误。让它只输出 JSON 再试。',
                        messages_changed: '这件活已经不需要了（那几条消息改过、删过，或者已经做完）。',
                        handoff_stale: '这件活已经不需要了（那几条消息改过、删过，或者已经做完）。',
                        handoff_closed: '这件已经交过或放弃了。',
                        no_such_handoff: '没有这一件。',
                    };
                    return { ok: false, error: e.message, why: errors[e.message] ?? `格式不对：${e.message}` };
                }
            }
            if (!handoffs) return { pending: [], auto: false };
            if (b.action === 'retry') handoffs.retry(Number(b.id)).catch(() => {});
            if (b.action === 'auto') store.setMeta('handoff_autoretry', b.on ? '1' : '0');
            return { pending: handoffs.list().map(({ file, ...h }) => ({ ...h, chars: renderPrompt(store.handoffById(h.id)).length })), auto: store.getMeta('handoff_autoretry') === '1' };
        },
        // 外援队列（本机工具用；转发插件也会转过来（要先过 ST 登录））：list 看等着的；submit 交回；drop 放弃（那一步以后照常再试）。
        'POST /v1/handoff': async b => {
            if (!handoffs) bad('外援队列没接上');
            if (b.action === 'submit') return { result: await handoffs.submit(Number(b.id), str(b.text, 'text', { max: 500000 })) };
            if (b.action === 'drop') return { dropped: handoffs.drop(Number(b.id), 'window_gave_up') };
            return { pending: handoffs.list() };
        },
    };
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        let size = 0; const chunks = [];
        req.on('data', chunk => {
            size += chunk.length;
            if (size > BODY_LIMIT) { reject(Object.assign(new Error('too_large'), { status: 413 })); req.destroy(); return; }
            chunks.push(chunk);
        });
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
    });
}

export function createServer(store, { log = () => {}, worker = null, records = null, assembler = null, keyMaker = null, advisor = null, setupMaker = null, keysMaker = null, handoffs = null, settings = () => ({}) } = {}) {
    const routes = createRoutes(store, { worker, records, assembler, keyMaker, advisor, setupMaker, keysMaker, handoffs, settings });
    // 耗时（先量再改）：每个请求后台算了多久，最近 400 笔；超过一秒半的记进日志。GET /v1/timings 给面板
    const timings = [];
    routes['POST /v1/timings'] = () => {
        const by = new Map();
        for (const t of timings) { const s = by.get(t.route) ?? { route: t.route, n: 0, ms: 0, max: 0 }; s.n++; s.ms += t.ms; s.max = Math.max(s.max, t.ms); by.set(t.route, s); }
        return { last: timings.slice(-100), byRoute: [...by.values()].map(s => ({ route: s.route, n: s.n, avg: Math.round(s.ms / s.n), max: s.max })).sort((a, b) => b.avg * b.n - a.avg * a.n) };
    };
    return http.createServer(async (req, res) => {
        const send = (status, value) => {
            res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
            res.end(JSON.stringify(value));
        };
        try {
            const route = routes[`${req.method} ${new URL(req.url, 'http://x').pathname}`];
            if (!route) return send(404, { error: 'not_found' });
            let body = {};
            if (req.method === 'POST') {
                // 只收 JSON：别的网页用表单偷偷往本机端口发请求时会被挡在这里。
                if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) return send(415, { error: 'json_only' });
                const text = await readBody(req);
                try { body = text ? JSON.parse(text) : {}; } catch { bad('bad json'); }
                if (!body || typeof body !== 'object' || Array.isArray(body)) bad('body must be an object');
            }
            const t0 = performance.now();
            const value = await route(body);
            const ms = Math.round(performance.now() - t0);
            const name = `${req.method} ${new URL(req.url, 'http://x').pathname}`;
            if (name !== 'POST /v1/timings') { timings.push({ at: Date.now(), route: name, ms }); if (timings.length > 400) timings.splice(0, timings.length - 400); if (ms > 1500) log(`slow ${name}: ${ms} ms`); }
            send(200, value);
        } catch (error) {
            const status = error.status ?? 500;
            if (status >= 500) log(`error ${req.method} ${req.url}: ${error.stack ?? error}`);
            send(status, { error: error.message });
        }
    });
}
