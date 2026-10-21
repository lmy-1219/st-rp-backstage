// 跟后台说话（N-104，白皮书 §3.4）：玩家从戏里切出来，直接跟后台来回说——问记下了的事、商量方向和口味、指出哪件事记错了。
// 不进聊天文件、前台看不到；答的模型带着这一局的设定、此刻的局面、和这句话有关的记录（带编号）。
// 会改东西的（改记录、作废记录、以后一直算数的事、留给规划的话、这阵子的玩法）模型只提议，玩家点"记"才写（用户亲口给的，最高权威，原话留底）。
// 不剧透：幕后排着的事（规划、口袋、各人没说出口的打算）不给它，它也不猜。
// 对话记在后台（每个窗口最近 40 句），面板上能接着聊。题材无关：名字、事都来自这一局的账。
import { briefSection } from './setup.mjs';
import { rankByOverlap } from './recall.mjs';
import { DAY } from './timescale.mjs';

export const TALK_SYSTEM = [
    '你是一部长篇角色扮演的后台，不是故事里的任何角色。玩家从戏里切出来直接跟你说话：问已经发生过、记下了的事，商量接下来的方向和口味，或者指出哪件事记错了、前台写错了。',
    '你看得到：这一局的设定（开局单）、现在几号什么时候、这一局到现在的要事、和玩家这句话有关的记录（带编号）、还开着的事、玩家之前留给规划的话、你们之前说过的几句。',
    '说话：平常的中文，简短，像跟一起写故事的人商量；不演角色，不写正文。',
    '答事实只按给你的记录和设定答；记录里没有的就说没记下，不编，不拿原作或常识补。',
    '不剧透：幕后排着的事（规划、口袋里的、各人没说出口的打算）你看不到，也别猜；玩家想看，告诉他面板"幕后"里能看。',
    '会改东西的你不自己改：先在回复里用一句话复述"我理解为：……"，再在回复最后另起一行写【提议】，后面跟一个 JSON，由玩家点头才算。能提的只有这几种：',
    '- {"做什么": "改记录", "编号": 记录编号, "改成": "改好的一句（照原来的口吻，以人名开头）"}——某条记录记错了；',
    '- {"做什么": "作废记录", "编号": 记录编号, "为什么": "一句"}——某条记录根本不该有；',
    '- {"做什么": "一直算数", "内容": "一句话", "谁知道": ["人名"]}——以后每一轮都要让知道的人带着、前台老是写反的事（谁知道空着＝所有人）；',
    '- {"做什么": "留给规划", "内容": "玩家想要的方向，原话为主"}——想让接下来的剧情往哪边走（规划会按它重排一次）；',
    '- {"做什么": "这阵子这么玩", "内容": "原话"}——这阵子的玩法、口味（换了场面自然退场）。',
    '格式：【提议】{"提议": [ … ]}。只提玩家这句话里要的；没要改什么就不写【提议】。编号只用给你的记录里有的。',
].join('\n');

const HIST = 40, SHOWN = 8;
const KINDS = { 改记录: 'fix', 作废记录: 'void', 一直算数: 'fact', 留给规划: 'plan', 这阵子这么玩: 'play' };

// 玩家这句里点到的消息（"第 230 条"）和记录（"#123"）。
export function pointedAt(text) {
    const t = String(text ?? '');
    return {
        positions: [...t.matchAll(/第\s*(\d{1,5})\s*条/g)].map(m => Number(m[1])),
        ids: [...t.matchAll(/#\s*(\d{1,7})/g)].map(m => Number(m[1])),
    };
}

// 给模型的那一段。s＝storyContext；clock＝{now, weather}；digest＝storyDigest 的 days；history＝之前几句。
// edits：最近改过的消息留下了什么（records.relinkEdited 记的）——玩家说"处理一下刚才的改动"时，照这里提议改、作废后面那几条记录。
export function talkPrompt({ s, setup = null, clock = null, digest = [], notes = [], history = [], text, edits = [] }) {
    const when = r => (s.when ? s.when(r) : '');
    const line = r => `#${r.id}（第 ${r.pos} 条，${when(r)}）${r.holder_name ?? r.holder}：${r.text}`;
    const { positions, ids } = pointedAt(text);
    const pool = s.visible.filter(r => r.type !== '时间');
    const pointed = pool.filter(r => ids.includes(r.id) || positions.some(p => Math.abs(r.pos - p) <= 1));
    const hits = rankByOverlap(pool, text, { textToo: true }).slice(0, 15).map(x => x.r);
    const shown = [...new Map([...pointed, ...hits].map(r => [r.id, r])).values()].sort((a, b) => a.pos - b.pos);
    const open = s.visible.filter(r => s.openIdeaIds?.has(r.id)).slice(-15);
    return [
        ...(setup ? ['', ...briefSection(setup)] : []),
        '', `【现在】剧情${(s.ts ?? DAY).nth(s.today + 1)}（从这个窗口开头算）${clock?.now ? `，${clock.now}` : ''}；共 ${s.lastPos + 1} 条消息。玩家：${s.userName ?? '玩家'}。`,
        ...(digest.length ? ['', '【这一局到现在的要事】（按剧情日）', ...digest.slice(-4).flatMap(d => [`${(s.ts ?? DAY).nth(d.day + 1)}（${d.when}）`, ...d.items.slice(-25).map(r => `· #${r.id} ${r.holder_name ?? r.holder}：${r.text}`)])] : []),
        '', '【和玩家这句话有关的记录】', ...(shown.length ? shown.map(line) : ['（没找到）']),
        ...(open.length ? ['', '【还开着的】', ...open.map(line)] : []),
        ...(notes.length ? ['', '【玩家之前留给规划的话】', ...notes.slice(-5).map(n => `· ${n.text}`)] : []),
        ...(edits.length ? ['', '【最近改过的消息】（玩家回去改了原文；原来记的这几件这回没再记到，后面这几条记录还按原来的说法——玩家要跟着改时，照这里提议）',
            ...edits.slice(-3).flatMap(e => [`第 ${e.pos} 条：不再记到的——${e.gone.join('；')}`, ...e.later.map(r => `  · #${r.id}（第 ${r.pos} 条）${r.text}`)])] : []),
        ...(history.length ? ['', '【你们之前说的】', ...history.slice(-SHOWN).map(t => `${t.role === 'user' ? '玩家' : '你'}：${t.text}`)] : []),
        '', '【玩家这句】', text,
    ].join('\n');
}

// 模型的回答 → 回复正文＋提议（认得的几种，缺格的丢掉）。
export function parseTalk(text) {
    const raw = String(text ?? '');
    const at = raw.indexOf('【提议】');
    const reply = (at >= 0 ? raw.slice(0, at) : raw).trim();
    let list = [];
    if (at >= 0) {
        const m = raw.slice(at).match(/\{[\s\S]*\}/);
        try { list = m ? JSON.parse(m[0])?.['提议'] ?? [] : []; } catch { list = []; }
    }
    const str = v => (typeof v === 'string' ? v.trim() : '');
    const proposals = (Array.isArray(list) ? list : []).map(p => {
        const kind = KINDS[str(p?.['做什么'])];
        const id = Number.parseInt(String(p?.['编号'] ?? '').replace(/^#/, ''), 10);
        const who = (Array.isArray(p?.['谁知道']) ? p['谁知道'] : []).map(x => str(String(x))).filter(x => x && x !== '所有人');
        if (kind === 'fix' && id > 0 && str(p['改成'])) return { kind, id, text: str(p['改成']).slice(0, 200) };
        if (kind === 'void' && id > 0) return { kind, id, why: str(p['为什么']).slice(0, 200) };
        if (kind === 'fact' && str(p['内容'])) return { kind, text: str(p['内容']).slice(0, 300), who };
        if ((kind === 'plan' || kind === 'play') && str(p['内容'])) return { kind, text: str(p['内容']).slice(0, 1000) };
        return null;
    }).filter(Boolean);
    return { reply: reply || (proposals.length ? '我理解为下面这几件，你看记不记：' : '（后台没说什么）'), proposals };
}

// 每条提议给玩家看的一句。
export function proposalText(p, recordOf = () => null) {
    const r = p.id ? recordOf(p.id) : null;
    const old = r ? `「${r.text}」` : `#${p.id}`;
    return {
        fix: () => `把记录 ${old} 改成「${p.text}」`,
        void: () => `作废记录 ${old}${p.why ? `（${p.why}）` : ''}`,
        fact: () => `以后一直算数${p.who?.length ? `（${p.who.join('、')}知道）` : '（所有人知道）'}：${p.text}`,
        plan: () => `留给规划（会按它重排一次）：${p.text}`,
        play: () => `这阵子这么玩：${p.text}`,
    }[p.kind]?.() ?? '';
}

// store：后台库；records：记录；context(chatKey)＝{ s, setup, clock, digest, notes }（main 里拼，用 slot 的 storyContext 等）；
// client()＝{ complete, model, price }；plan(chatKey)＝叫规划者重排一次。
export function createTalk({ store, records, context, client, log = () => {}, plan = () => {} }) {
    const key = chatKey => `talk:${chatKey}`;
    const load = chatKey => { try { return JSON.parse(store.getMeta(key(chatKey)) ?? 'null') ?? { turns: [] }; } catch { return { turns: [] }; } };
    const save = (chatKey, v) => store.setMeta(key(chatKey), JSON.stringify({ ...v, turns: v.turns.slice(-HIST) }));
    const busy = new Map();
    const recordOf = chatKey => id => records.visible(chatKey).find(r => r.id === id) ?? null;
    function view(chatKey) {
        const v = load(chatKey), find = recordOf(chatKey);
        return { turns: v.turns.map(t => ({ ...t, proposals: (t.proposals ?? []).map(p => ({ ...p, say: proposalText(p, find) })) })), pending: busy.has(chatKey), error: v.error ?? null };
    }
    function send(chatKey, text) {
        if (busy.has(chatKey)) return;
        const v = load(chatKey);
        const history = v.turns.slice();
        v.turns.push({ role: 'user', text, at: new Date().toISOString() });
        v.error = null;
        save(chatKey, v);
        const job = (async () => {
            const c = client();
            if (!c) throw new Error('没配"跟后台说话"的模型（面板"设置→各环节的模型"）');
            const started = Date.now();
            const ctx = context(chatKey);
            const r = await c.complete({ system: TALK_SYSTEM, user: talkPrompt({ ...ctx, history, text }) });
            const costUsd = ((r.usage?.input ?? 0) * c.priceInPerM + (r.usage?.output ?? 0) * c.priceOutPerM) / 1e6;
            records.logAssemble?.({ chatKey, speaker: '(跟后台说话)', model: c.model, servedModel: r.servedModel, status: 'done', usage: r.usage, costUsd, ms: Date.now() - started, raw: r.text });
            const ok = new Set(records.visible(chatKey).map(x => x.id));
            const { reply, proposals } = parseTalk(r.text);
            const now = load(chatKey);
            now.turns.push({ role: 'backend', text: reply, proposals: proposals.filter(p => !p.id || ok.has(p.id)).map(p => ({ ...p, status: 'proposed' })), at: new Date().toISOString(), costUsd });
            save(chatKey, now);
        })().catch(error => {
            log(`talk ${chatKey} failed: ${error.message}`);
            const now = load(chatKey);
            save(chatKey, { ...now, error: error.message });
        }).finally(() => busy.delete(chatKey));
        busy.set(chatKey, job);
        return job;
    }
    // 玩家点了"记"或"不记"。turn＝第几句（下标），i＝第几条提议。
    function apply(chatKey, { turn, i, skip = false }) {
        const v = load(chatKey);
        const p = v.turns[turn]?.proposals?.[i];
        if (!p || p.status !== 'proposed') return view(chatKey);
        if (skip) p.status = 'skipped';
        else {
            const chat = store.requireChat(chatKey);
            if (p.kind === 'fix' || p.kind === 'void') {
                if (!recordOf(chatKey)(p.id)) throw Object.assign(new Error('这条记录已经不在了（消息改过或删了）'), { status: 409 });
                records.correct(p.id, p.kind === 'fix' ? p.text : null, p.kind === 'fix' ? '玩家在"跟后台说话"里改的' : `玩家在"跟后台说话"里作废：${p.why ?? ''}`);
            } else if (p.kind === 'fact') {
                const setup = store.setupOf(chat.story_id)?.data;
                if (!setup) throw Object.assign(new Error('这一局还没有开局单，先在面板"开局单"里建一份'), { status: 409 });
                store.confirmSetup({ storyId: chat.story_id, data: { ...setup, 前史: [...(setup.前史 ?? []), { 事: p.text, 谁知道: p.who ?? [], 层: '本局私设', 谁的版本: '', 常驻: true }] } });
            } else if (p.kind === 'plan' || p.kind === 'play') {
                const s = context(chatKey).s;
                store.addNote({ chatKey, kind: p.kind === 'plan' ? '聊' : '玩', text: p.text, storyDay: s.today, pos: s.lastPos });
                if (p.kind === 'plan') plan(chatKey);
            }
            p.status = 'done';
        }
        save(chatKey, v);
        return view(chatKey);
    }
    function clear(chatKey) { save(chatKey, { turns: [] }); return view(chatKey); }
    return { view, send, apply, clear, busy: chatKey => busy.get(chatKey) ?? null };
}
