import { personWord } from './pronoun.mjs';
// 自动进离场与调度的后台接口层（方案 自动进离场与调度 第七节 1b，N-377～N-379，D-201）。
// 判定都在 director.mjs（谁接话）、knock.mjs（叩门状态机）、leaving.mjs（走了没有）、visibility.mjs（谁看得见）里，这儿只管：
// · 发起叩门：门上到时候了的那一项（doorFor）＋时机（knockTiming）→ 候着的一条（knock_pending），进场那份先理（arrive prepare），扩展叫他写那一条；
// · 他那条落下了 → 记成叩门（knocks），进场那份接上（他从那条起远程、或在门口候着）；
// · 候着 → 玩家回应 → 进场（上门的把去向清掉）；两句没回、换了时段 → 作废（门上那一项回来，等着没人接那条路接着走；他心里记一笔没人理）；
//   认不出是不是在回他的那几句交便宜模型（judge），判了写回 verdicts；快捷按钮（接／不理／让他进来）写 forced；
// · 谁接话：拼 director.turnDetail 要的料（场面表、名册、关系、每人此刻要说的、节奏档）；候着的人只在玩家对他说时才排；
// · 自动离场：场面表上在场、远程的人逐个过一遍 leaving.leftAt，拿得准的交 main.leave 记去向，记下免得重复；删了那条就重新算。
// 存的都挂在消息上（条号＋指纹），删消息＝没发生过（D-185）。题材无关（D-37）。
import { turnDetail } from './director.mjs';
import { knockState, knockTiming, wayOf as knockWayOf } from './knock.mjs';
import { leftAt } from './leaving.mjs';
import { callsOf } from './camera-turn.mjs';
import { normalizeRelations } from './relations.mjs';
import { boardFor } from './board.mjs';
import { doorFor } from './door.mjs';
import { pendingFor } from './pending.mjs';
import { timelineFor, paceFor, playModeOf } from './slot.mjs';
import { isOpenMatter, INTENT, closeIntents } from './matters.mjs';
import { sameName } from './setup.mjs';
import { hasCard } from './arrival.mjs';

export const KNOCKS = chatKey => `knocks:${chatKey}`;
export const PENDING = chatKey => `knock_pending:${chatKey}`;
export const LEFT = chatKey => `auto_left:${chatKey}`;
const KEEP = 40;

const read = (store, key, fallback) => { try { return JSON.parse(store.getMeta?.(key) ?? 'null') ?? fallback; } catch { return fallback; } };
const write = (store, key, value) => store.setMeta?.(key, value == null ? null : JSON.stringify(value));
const num = v => (Number.isFinite(Number(v)) ? Number(v) : null);
const isHis = (m, k) => !!m && !m.is_user && (m.name === k.who || (!!k.avatar && m.speaker === k.avatar));
const userOf = messages => [...messages].reverse().find(m => m.is_user)?.name ?? '玩家';
const live = messages => messages.filter(m => !m.hidden);
const rowsOf = tl => pos => tl.rows.filter(r => r.pos <= pos).at(-1) ?? { day: tl.today, part: tl.part };

export const knocksOf = (store, chatKey) => read(store, KNOCKS(chatKey), []).filter(k => k && k.who && num(k.at) != null);
const blockedKnock = (store, chatKey, k) => playModeOf(store, chatKey) === 'memory' && ['pocket','contact','reach'].includes(k?.source?.type);
export const pendingKnock = (store, chatKey) => { const k=read(store,PENDING(chatKey),null); return blockedKnock(store,chatKey,k) ? null : k; };
export const writeKnocks = (store, chatKey, knocks) => write(store, KNOCKS(chatKey), knocks.slice(-KEEP));

// 门上那一项他怎么来：说好了消息、电话的照说的；约好的、结算写的"他过来"、玩家叫的上门；在外头办事的照他去向里说的回法；其余发消息（最不扰人）
export function wayFor(item, plan = null) {
    // 门上只给了一种方式的才是说好的（doorAt：说好了消息、电话的 ways 只有那一个；默认的那一串里也有消息、电话，不算）
    const ways = item?.ways ?? [];
    if (ways.length === 1 && /消息|电话/.test(ways[0])) return /电话/.test(ways[0]) ? '电话' : '消息';
    const type = item?.source?.type;
    if (type === 'errand') return /上门/.test(plan?.back ?? '') ? '上门' : /电话/.test(plan?.back ?? '') ? '电话' : '消息';
    if (type === 'promise' || type === 'contact' || type === 'named') return '上门';
    return '消息';
}
const modeOf = way => (way === '上门' ? 'come' : 'remote');

function context(store, records, chatKey, { present = [], recentUser = '', timeline = null } = {}) {
    const chat = store.requireChat(chatKey);
    const messages = live(store.currentMessages(chatKey));
    const tl = timeline ?? timelineFor(store, records, chatKey, messages);
    const roster = store.getCast?.(chat.story_id) ?? [];
    const relations = store.relationsOf?.(chat.story_id) ?? null;
    const names = roster.map(e => e.name);
    return { chat, messages, tl, rowAt: rowsOf(tl), roster, relations, names, userName: userOf(messages), present, recentUser,
        board: () => boardFor(store, records, chatKey, { present, recentUser, timeline: tl }) };
}

/**
 * 这会儿该不该叩门、谁、怎么来。返回 { ok, why } 或 { ok: true, who, avatar, way, at, fp, source, label }（还没记下，记下用 beginKnock）。
 * 不叩：关着；已经有一条候着的（pending 或状态机里候着）；时机不到（knockTiming）；门上没人到时候；门上那一项作废过（等结算换一条新的）
 */
// 门上该叩的那一项（不看时机）：到时候了、没作废过的头一项；旁白刚留的记号（door_lit，四条内）指着的优先。返回 { who, avatar, way, mode, source, label } 或 null
export function knockCandidate(store, records, chatKey, { present = [], timeline = null } = {}) {
    const ctx = context(store, records, chatKey, { present, timeline });
    const { messages, tl, names } = ctx;
    const last = messages.at(-1);
    if (!last) return null;
    const knocks = knocksOf(store, chatKey);
    const items = doorFor(store, records, chatKey, { present, timeline: tl }).items.filter(i => i.ready);
    const lapsed = new Set(knocks.filter(k => k.lapsed && k.source).map(k => `${k.source.type}:${k.source.id}`));
    const fresh = items.filter(i => !(i.source && lapsed.has(`${i.source.type}:${i.source.id}`)));
    const lit = read(store, `door_lit:${chatKey}`, null);
    const litOk = lit && num(lit.pos) != null && last.pos - num(lit.pos) <= 4 && messages.find(m => m.pos === num(lit.pos))?.fp === lit.fp;
    const item = (litOk ? fresh.find(i => sameName(i.who, lit.who, names)) : null) ?? fresh[0] ?? null;
    if (!item) return { who: null, why: items.length ? '门上的都叩过了、没人接' : '门上没人到时候' };
    let plan = null;
    try { plan = ctx.board().people.find(p => sameName(p.name, item.who, names))?.plan ?? null; } catch {}
    const way = wayFor(item, plan);
    return { who: item.who, avatar: item.avatar ?? null, way, mode: modeOf(way), source: item.source ?? null, label: item.label ?? '' };
}

export function knockNow(store, records, chatKey, { present = [], timeline = null, config = null } = {}) {
    const auto = config?.auto ?? {};
    if (auto.enabled === false || auto.knock === false) return { ok: false, why: '关着' };
    const ctx = context(store, records, chatKey, { present, timeline });
    const { messages, tl, rowAt, roster, relations, names, userName } = ctx;
    const last = messages.at(-1);
    if (!last) return { ok: false, why: '还没有消息' };
    if (pendingKnock(store, chatKey)) return { ok: false, why: '有一条候着的还没写出来' };
    const knocks = knocksOf(store, chatKey);
    const cards = present.filter(n => roster.some(e => hasCard(e) && sameName(e.name, n, names)));
    const timing = knockTiming({ messages, knocks, pace: paceFor(store, chatKey), present: cards, rowAt, parts: tl.parts, roster, relations, userName, maxTurns: auto.maxTurns });
    if (!timing.ok) return { ok: false, why: timing.why };
    const c = knockCandidate(store, records, chatKey, { present, timeline: tl });
    if (!c?.who) return { ok: false, why: c?.why ?? '门上没人到时候' };
    return { ok: true, ...c, at: last.pos + 1, fp: last.fp };
}

// 叩门时已经按叩门那条接了进场（main.autoTurn：进场那份理好了就先记，他那条写出来时记录已经在）
const knockEntry = (store, chatKey, k) => read(store, `arrivals:${chatKey}`, []).find(e => e?.knock && (e.who === k.who || (!!k.avatar && e.avatar === k.avatar)) && num(e.at) === num(k.at) && e.fp === k.fp) ?? null;
// 候着的那条没写出来（挂的那条没了、那儿换成了别人在说）：叩门时记的那次进场撤掉
function dropKnockArrival(store, chatKey, k) {
    const list = read(store, `arrivals:${chatKey}`, []);
    const kept = list.filter(e => !(e?.knock && (e.who === k.who || (!!k.avatar && e.avatar === k.avatar)) && num(e.at) === num(k.at) && e.fp === k.fp));
    if (kept.length !== list.length) write(store, `arrivals:${chatKey}`, kept);
    const arrived = read(store, `arrived:${chatKey}`, null);
    if (arrived && (arrived.who === k.who || (k.avatar && arrived.avatar === k.avatar)) && num(arrived.at) === num(k.at)) write(store, `arrived:${chatKey}`, null);
}
// 最近作废的（扩展关区间、静音用）：定下作废的那条在最近几条里
export function recentLapsed(store, chatKey, { within = 4 } = {}) {
    const messages = live(store.currentMessages(chatKey)), last = messages.at(-1);
    if (!last) return [];
    return knocksOf(store, chatKey).filter(k => k.lapsed && num(k.lapsed.pos) != null && last.pos - num(k.lapsed.pos) <= within && messages.find(m => m.pos === num(k.lapsed.pos))?.fp === k.lapsed.fp)
        .map(k => ({ who: k.who, avatar: k.avatar ?? null, way: k.way, at: num(k.lapsed.pos) }));
}

// 记下候着的一条（扩展接着叫他写）；进场那份由叫这个的人去先理（main.arrive prepare）
export function beginKnock(store, chatKey, k) {
    const pending = { who: k.who, avatar: k.avatar ?? null, way: k.way, mode: k.mode ?? modeOf(k.way), at: k.at, fp: k.fp, source: k.source ?? null, label: k.label ?? '', since: Date.now() };
    write(store, PENDING(chatKey), pending);
    return pending;
}

// 快捷按钮（方案第二节第 3 条）：接／让他进来＝进场，不理＝作废；写在他这次叩门上，状态机先看它
export function answerKnock(store, chatKey, { who, answer }) {
    const knocks = knocksOf(store, chatKey);
    const k = [...knocks].reverse().find(x => x.who === who && !x.entered && !x.lapsed);
    if (!k) return { ok: false, why: '他没有候着的叩门' };
    const messages = live(store.currentMessages(chatKey)), last = messages.at(-1);
    const forced = /不理|作废|否/.test(answer ?? '') ? '作废' : '进场';
    k.forced = forced;
    k.forcedAt = last ? { pos: last.pos, fp: last.fp } : null;
    writeKnocks(store, chatKey, knocks);
    return { ok: true, forced };
}

// 去向用完（和 main.dropAway 一样：人到场了不删，记下是哪一次进场用掉的）
function dropAwayPlan(store, chatKey, who, by) {
    const plans = read(store, `away_plan:${chatKey}`, {});
    for (const key of Object.keys(plans)) if (plans[key]?.who === who) plans[key] = { ...plans[key], dropped: by };
    write(store, `away_plan:${chatKey}`, plans);
}

// 作废了（他没进过场）：结算写的"要联系"、旁白替他递过的那条回到没用掉——门上那一项回来，等着没人接那条路接着走；
// 他这回的来意过去了；他心里记一笔没人理（只他知道，挂在定下作废的那条上，删了就没这回事）
function lapseKnock(store, records, chatKey, k, { chat, messages, names, userName }) {
    const same = (a, b) => sameName(a, b, names);
    const key = `settled_contact:${chatKey}:${k.who}`;
    const c = read(store, key, null);
    if (c?.usedAt && num(c.usedAt.pos) === k.at - 1 && c.usedAt.fp === k.fp) write(store, key, { ...c, used: false, usedAt: null, missed: (c.missed ?? 0) + 1 });
    if (k.source?.type === 'pocket' && Number.isInteger(k.source.id) && store.updateMenu) {
        const m = (store.menuOf?.(chatKey) ?? []).find(x => x.id === k.source.id);
        if (m && m.status === 'used') store.updateMenu(chatKey, m.id, { status: 'shown', by: k.who, why: '叩门没人接，他发过的那条还挂着' });
    }
    const decided = k.lapsed?.fp ?? messages.at(-1)?.fp ?? null;
    if (decided) {
        try { closeIntents({ records, chatKey, storyId: chat.story_id, who: k.who, fp: decided, same }); } catch {}
        const way = k.way === '电话' ? '打过电话' : k.way === '上门' ? '去找过' : '发过消息';
        if (records?.addDerived) try { records.addDerived({ storyId: chat.story_id, fp: decided, type: '心里', text: `${k.who}${way}${userName}，没人理。`.slice(0, 200), holder: k.avatar ?? `name:${k.who}`, holderName: k.who, audience: [k.who], about: k.who }); } catch {}
    }
    const arrived = read(store, `arrived:${chatKey}`, null);
    if (arrived && (arrived.who === k.who || (k.avatar && arrived.avatar === k.avatar)) && num(arrived.at) === k.at) write(store, `arrived:${chatKey}`, null);
}

/**
 * 同步之后走一遍（main 在 sync 钩子里叫）：候着的那条写出来了没有；每次叩门走到哪一步。
 * deps：arrive（main.arrive，带 anchor、knock）、judge({ who, way, knock, text }) → true/false/null（便宜模型）、config
 * 返回 { finalized, entered: [k], lapsed: [k], gone: [k] }
 */
export async function knockAdvance(store, records, chatKey, { arrive = null, judge = null, config = null, present = [] } = {}) {
    const auto = config?.auto ?? {};
    const out = { finalized: null, entered: [], lapsed: [], gone: [] };
    const rawPending=read(store,PENDING(chatKey),null);
    if (blockedKnock(store,chatKey,rawPending)) { write(store,PENDING(chatKey),null); dropKnockArrival(store,chatKey,rawPending); }
    const ctx = context(store, records, chatKey, { present });
    const { chat, messages, tl, rowAt, roster, relations, names, userName } = ctx;
    let knocks = knocksOf(store, chatKey);
    // 1. 候着的那条写出来了没有：写出来了就记成叩门、进场那份接上（他从那条起远程、或在门口候着）；挂的那条没了、或者那儿换成了别人在说，就没发生过
    const pending = pendingKnock(store, chatKey);
    if (pending) {
        const anchored = messages[pending.at - 1]?.fp === pending.fp;
        const his = isHis(messages[pending.at], pending);
        if (!anchored || (messages.length > pending.at && !his)) { write(store, PENDING(chatKey), null); dropKnockArrival(store, chatKey, pending); }
        else if (his) {
            const k = { who: pending.who, avatar: pending.avatar ?? null, way: pending.way, at: pending.at, fp: pending.fp, source: pending.source ?? null, verdicts: {} };
            knocks = [...knocks, k];
            writeKnocks(store, chatKey, knocks);
            write(store, PENDING(chatKey), null);
            out.finalized = k;
            // 叩门时没来得及接进场的（没有挂在这条上的进场记录）这时接：他从这条起远程、或在门口候着
            if (arrive && !knockEntry(store, chatKey, k)) try { await arrive({ chatKey, who: k.who, avatar: k.avatar, mode: pending.mode ?? modeOf(k.way), way: k.way, anchor: { at: k.at, fp: k.fp }, knock: true }); } catch {}
        }
    }
    if (!knocks.length) return out;
    const opts = { messages, knocks, userName, roster, relations, rowAt, parts: tl.parts, maxTurns: auto.maxTurns };
    const stateOf = k => (k.forced ? { state: k.forced, why: '玩家点了按钮', decided: k.forcedAt ?? { pos: messages.at(-1)?.pos, fp: messages.at(-1)?.fp }, asks: [] } : knockState(k, opts));
    const keep = [];
    for (const k of knocks) {
        if (k.entered || k.lapsed || blockedKnock(store,chatKey,k)) { keep.push(k); continue; }
        let s = stateOf(k);
        // 认不出是不是在回他的那几句：问一次便宜模型，判了写回，状态机再看一遍
        // 两句没回里有认不出的，也先问：第二句其实是在回他，就该进场不该作废
        if (['候着', '作废'].includes(s.state) && s.asks?.length && judge) {
            const knockText = String(messages.find(m => m.pos === s.message?.pos)?.text ?? '');
            let changed = false;
            for (const a of s.asks) {
                const key = `${a.pos}:${a.fp}`;
                if (k.verdicts && Object.prototype.hasOwnProperty.call(k.verdicts, key)) continue;
                let v = null;
                try { v = await judge({ chatKey, who: k.who, way: k.way, knock: knockText, text: a.text }); } catch {}
                if (v === true || v === false) { k.verdicts = { ...(k.verdicts ?? {}), [key]: v }; changed = true; }
            }
            if (changed) s = stateOf(k);
        }
        if (s.state === '进场') {
            k.entered = { pos: s.decided?.pos ?? null, fp: s.decided?.fp ?? null, why: s.why };
            if (k.way === '上门') dropAwayPlan(store, chatKey, k.who, { at: k.at, fp: k.fp, who: k.who, avatar: k.avatar });
            out.entered.push(k);
        } else if (s.state === '作废') {
            k.lapsed = { pos: s.decided?.pos ?? null, fp: s.decided?.fp ?? null, why: s.why };
            lapseKnock(store, records, chatKey, k, ctx);
            out.lapsed.push(k);
        } else if (s.state === '没发生') { out.gone.push(k); continue; }
        keep.push(k);
    }
    writeKnocks(store, chatKey, keep);
    return out;
}

// 此刻候着的那一个（给扩展画快捷按钮）：{ who, avatar, way, at, unanswered } 或 null
export function waitingKnock(store, records, chatKey) {
    const ctx = context(store, records, chatKey);
    const knocks = knocksOf(store, chatKey);
    for (const k of [...knocks].reverse()) {
        if (k.entered || k.lapsed || k.forced || blockedKnock(store,chatKey,k)) continue;
        const s = knockState(k, { messages: ctx.messages, knocks, userName: ctx.userName, roster: ctx.roster, relations: ctx.relations, rowAt: ctx.rowAt, parts: ctx.tl.parts });
        if (s.state === '候着' && s.message) return { who: k.who, avatar: k.avatar ?? null, way: k.way, at: k.at, unanswered: s.unanswered };
    }
    return null;
}

// 每人此刻要说的（给调度排"插"）：来意没说（记账里还开着的来意）、口袋到了（进了口袋还没拿出来）、等的回音有了、兴头（最近三十条里他的想法）
export function wantsFor(store, records, chatKey, { messages = null, timeline = null } = {}) {
    const rows = messages ?? live(store.currentMessages(chatKey));
    const lastPos = rows.at(-1)?.pos ?? 0;
    const out = [];
    for (const r of records?.visible?.(chatKey) ?? []) if (isOpenMatter(r) && r.matter?.kind === INTENT && r.holder_name) out.push({ who: r.holder_name, kind: '来意', text: r.matter.title ?? '' });
    for (const m of store.menuOf?.(chatKey) ?? []) if (m.status === 'pocket' && m.who) out.push({ who: m.who, kind: '口袋', text: m.title ?? '' });
    try { for (const p of pendingFor(store, records, chatKey, { timeline }).items) if (p.kind === '等回音' && p.status === '有回音' && p.owner) out.push({ who: p.owner, kind: '等回音', text: p.text ?? '' }); } catch {}
    for (const r of records?.openIdeas?.(chatKey) ?? []) if (r.type === '想法' && r.holder_name && lastPos - (r.pos ?? 0) <= 30) out.push({ who: r.holder_name, kind: '兴头', text: r.text ?? '' });
    return out;
}

/**
 * 谁接话：拼 director 要的料，返回 { queue: [{ who, avatar, role, why, noRepeat }], why }。
 * 候着的人（门口的）按远程算：只在玩家对他说时才排（和发消息来的一样）
 */
export function turnFor(store, records, chatKey, { present = [], recentUser = '', config = null } = {}) {
    const auto = config?.auto ?? {};
    const ctx = context(store, records, chatKey, { present, recentUser });
    const { messages, roster, relations, names, userName, tl } = ctx;
    if (auto.enabled === false || auto.turn === false) return { queue: [], why: '关着' };
    let board = null;
    try { board = ctx.board(); } catch {}
    const waiting = waitingKnock(store, records, chatKey);
    // 他刚叩的门就是最后一条：停下等玩家，别让屋里的人替玩家接他的话
    if (waiting && waiting.at === messages.at(-1)?.pos) return { queue: [], why: `${waiting.who}刚来联系，等玩家回他` };
    if (board && waiting && waiting.way === '上门') board = { ...board, people: board.people.map(p => (sameName(p.name, waiting.who, names) && p.status === 'present' ? { ...p, status: 'remote', way: '上门' } : p)) };
    const departed=leaveEvents(store,chatKey).filter(e=>e.action==='leave');
    const lastUser=messages.findLast(m=>m.is_user)?.pos ?? -1;
    const excluded=new Set();
    if(board) board={...board,people:board.people.map(p=>{
        const e=departed.filter(e=>(e.avatar&&e.avatar===p.avatar)||e.who===p.name).at(-1);
        if(!e || (p.status==='present'&&Number(p.since)>e.at)) return p;
        excluded.add(p.name);
        if(p.status==='away' && lastUser>e.at) return p; // 场面表已有的离开时长不重置
        return {...p,status:lastUser>e.at?'away':'absent',stage:'early'};
    })};
    present=present.filter(name=>board ? !excluded.has(name) : !departed.some(e=>e.who===name));
    const d = turnDetail({ text: recentUser || null, messages, board, roster, relations, wants: wantsFor(store, records, chatKey, { messages, timeline: tl }), pace: paceFor(store, chatKey), userName, present,
        stateNotes: store.stateNotesOf?.(chatKey) ?? [], cap: Number(auto.cap) > 0 ? Number(auto.cap) : null });   // 没填（null）按节奏档，别算成 0
    const avatarOf = who => roster.find(e => sameName(e.name, who, names))?.avatar ?? null;
    // back：刚走的人被点名，直接叫回来（不走进场那套）——扩展要先取消静音、开区间
    return { queue: d.queue.map(q => ({ who: q.who, avatar: q.who === '旁白' ? null : avatarOf(q.who), role: q.role, why: q.why, noRepeat: !!q.noRepeat, ...(/叫回来/.test(q.why ?? '') ? { back: true } : {}) })), why: d.why };
}

/**
 * 谁走了（场面表上在场、远程的人逐个看；拿得准的才算）：返回还没记过的 [{ who, avatar, how, at, fp, why }]；记过的（markLeft）那条还在就不再报，删了就重新算
 */
export const LEAVE_ASK = chatKey => `leave_ask:${chatKey}`;
export const LEFT_PENDING = chatKey => `auto_left_pending:${chatKey}`;
const squashQuote = t => String(t??'').replace(/[\p{P}\s]/gu,'');
const isOwn = (m,p) => !m.is_user && (m.name===p.name || (!!p.avatar && m.speaker===p.avatar));
function reviewsOf(store, chatKey, messages) {
    return read(store,LEAVE_ASK(chatKey),[]).filter(r => messages.some(m=>m.pos===r.at && m.fp===r.fp)
        && (r.evidenceAt==null || messages.some(m=>m.pos===r.evidenceAt&&m.fp===r.evidenceFp))
        && (r.checkedAt==null || messages.some(m=>m.pos===r.checkedAt && m.fp===r.checkedFp))
        && (!r.basis || r.basis.every(b=>messages.some(m=>m.pos===b.pos && m.fp===b.fp))));
}
function leaveChecks(store, records, chatKey, options) {
    const ctx=context(store,records,chatKey,options), {messages,roster,names,relations,userName}=ctx;
    const people=ctx.board().people.filter(p=>['present','remote'].includes(p.status) && roster.some(e=>hasCard(e)&&sameName(e.name,p.name,names)));
    const asked=reviewsOf(store,chatKey,messages);
    const done=read(store,LEFT(chatKey),[]).filter(d=>messages.some(m=>m.pos===d.at&&m.fp===d.fp));
    return people.map(p=>{
        const avatar=p.avatar??roster.find(e=>sameName(e.name,p.name,names))?.avatar??null;
        const person={...p,avatar};
        const prior=asked.filter(d=>d.who===p.name && (d.since??null)===(p.since??null)).at(-1);
        const since=prior ? Math.max(num(p.since)??0,(prior.checkedAt??prior.at)+1) : num(p.since);
        const r=leftAt(messages,p.name,{avatar,userName,status:p.status,way:p.way??null,since,
            others:people.filter(x=>x.name!==p.name&&x.status==='present').map(x=>x.name),roster,relations,
            remoteNames:people.filter(x=>x.status==='remote').map(x=>x.name),n:options.config?.auto?.remoteQuiet??3});
        const pending=prior?.state==='被打发未动' && !messages.some(m=>m.pos>prior.evidenceAt&&isOwn(m,person));
        const turns=pending?messages.filter(m=>m.is_user && m.pos>prior.evidenceAt):[];
        const expired=pending && turns.length>=2;
        const settled=prior?.state==='走了' && since>messages.at(-1)?.pos;
        return {p:person,r,prior,pending,expired,turns,settled,done,messages,aliases:callsOf(p.name,{rel:relations?normalizeRelations(relations):null,names}),from:since};
    });
}
export function autoLeave(store, records, chatKey, { present = [], config = null } = {}) {
    if(config?.auto?.enabled===false || config?.auto?.leave===false) return [];
    let checks; try {checks=leaveChecks(store,records,chatKey,{present,config});} catch {return [];}
    const out=[];
    for(const {p,r,prior,expired,turns,done,messages} of checks) {
        const event=expired ? {left:true,sure:true,at:turns[1].pos,how:'被打发',why:'被打发后玩家又说两句，他仍未开口或被核实在场'} : r;
        if(event.left!==true || !event.sure) continue;
        const fp=messages.find(m=>m.pos===event.at)?.fp;
        if(done.some(d=>d.who===p.name&&d.at===event.at&&d.fp===fp)) continue;
        out.push({who:p.name,avatar:p.avatar,at:event.at,fp,how:event.how,why:event.why,...(expired?{basis:[{pos:prior.evidenceAt,fp:prior.evidenceFp},...(prior.basis??[]),...turns.slice(0,2).map(m=>({pos:m.pos,fp:m.fp}))]}:{})});
    }
    return out;
}
// 没判和被打发未动都保留复核；只对核过的消息窗口推进游标。
export function leaveDoubts(store, records, chatKey, { present = [], config = null } = {}) {
    if(config?.auto?.enabled===false || config?.auto?.leave===false) return [];
    let checks; try {checks=leaveChecks(store,records,chatKey,{present,config});} catch {return [];}
    const out=[];
    for(const {p,r,prior,pending,expired,settled,done,messages,aliases,from} of checks) {
        if(expired || settled || (!pending && r.left!==null)) continue;
        const at=pending ? prior.at : r.at;
        const fp=messages.find(m=>m.pos===at)?.fp;
        if(at==null || done.some(d=>d.who===p.name && d.at===at && d.fp===fp)) continue;
        const last=messages.at(-1);
        out.push({who:p.name,avatar:p.avatar,at,fp,why:pending?'被打发未动，继续核对是否已在场或离开':r.why,status:p.status,aliases,
            since:p.since??null,from,through:last.pos,throughFp:last.fp,
            ...(pending?{pendingAt:prior.evidenceAt,pendingQuote:prior.quote}:{}),
            basis:messages.filter(m=>m.pos>=(from??at)).slice(-10).map(m=>({pos:m.pos,fp:m.fp}))});
    }
    return out;
}
export function answerLeaves(store, chatKey, doubts, verdicts) {
    const messages=live(store.currentMessages(chatKey)), asked=reviewsOf(store,chatKey,messages), gone=[];
    for(const d of doubts) {
        if(!Object.hasOwn(verdicts??{},d.who) || !messages.some(m=>m.pos===d.at&&m.fp===d.fp)
            || (d.basis && !d.basis.every(b=>messages.some(m=>m.pos===b.pos&&m.fp===b.fp)))) continue;
        const v=verdicts[d.who], legacy=typeof v==='boolean';
        const state=legacy?(v?'走了':'还在'):v?.['结果'];
        if(!['走了','还在','被打发未动'].includes(state)) continue;
        const evidence=legacy?messages.find(m=>m.pos===d.at):messages.find(m=>Number.isInteger(v?.['条'])&&m.pos===v['条']);
        if(!evidence || (!legacy && (typeof v['引']!=='string' || [...v['引']].length>20 || !squashQuote(v['引']) || !squashQuote(evidence.text).includes(squashQuote(v['引']))))) continue;
        // 只收这次给模型的窗口内的依据，不能引用未来或它没有读到的消息。
        const through=d.through??messages.at(-1)?.pos;
        if(evidence.pos>through || (!legacy && evidence.pos<(d.from??d.since??d.at) && !(state==='被打发未动'&&evidence.pos===d.pendingAt))) continue;
        const last=messages.find(m=>m.pos===through);
        if(!last || (d.throughFp && last.fp!==d.throughFp)) continue;
        const old=asked.filter(x=>x.who===d.who&&x.state==='被打发未动'&&(x.since??null)===(d.since??null)).at(-1);
        // 指纹只覆盖实际给出的十条窗口；原始依据与已判末条另有锚点核验。
        const basis=d.basis;
        asked.push({who:d.who,at:d.at,fp:d.fp,since:d.since??null,state,checkedAt:through,checkedFp:last.fp,
            evidenceAt:state==='被打发未动'&&old?old.evidenceAt:evidence.pos,evidenceFp:state==='被打发未动'&&old?old.evidenceFp:evidence.fp,quote:state==='被打发未动'&&old?old.quote:(legacy?null:v['引']),basis});
        if(state==='走了') gone.push({who:d.who,avatar:d.avatar??null,how:'看一眼',at:evidence.pos,fp:evidence.fp,why:'复核依据已核过',basis});
    }
    write(store,LEAVE_ASK(chatKey),asked.slice(-60));
    if(gone.length) {markLeft(store,chatKey,gone);write(store,LEFT_PENDING(chatKey),[...read(store,LEFT_PENDING(chatKey),[]),...gone].slice(-20));}
    return gone;
}
// 离场事件交给扩展，直到收到当前版本的落实确认。
export const LEAVE_EVENTS = chatKey => `auto_leave_events:${chatKey}`;
const eventId = item => encodeURIComponent(item.avatar ?? item.who)+':'+item.fp;
// 同一身份和指纹只有一个事件；撤销和再次出现递增版本，旧确认不能确认新动作。
export function leaveEvents(store, chatKey) {
    const messages=live(store.currentMessages(chatKey));
    const events=read(store,LEAVE_EVENTS(chatKey),[]);
    for(const e of events) {
        const matches=messages.filter(m=>m.fp===e.fp);
        const source=matches.find(m=>m.pos===e.at) ?? (matches.length===1?matches[0]:null);
        const valid=!!source && (!e.basis || e.basis.every(b=>messages.some(m=>m.fp===b.fp&&m.pos===b.pos)));
        const action=valid?'leave':'undo';
        if(e.action!==action) {e.action=action;e.version++;e.state='待落实';}
        if(source) e.at=source.pos;
        if(action==='undo') {
            const plans=read(store,`away_plan:${chatKey}`,{});
            for(const [key,p] of Object.entries(plans)) if(p?.who===e.who&&p.fp===e.fp) delete plans[key];
            write(store,`away_plan:${chatKey}`,plans);
        }
    }
    write(store,LEAVE_EVENTS(chatKey),events);
    return events;
}
export function pendingLeaves(store,chatKey) { return leaveEvents(store,chatKey).filter(e=>e.state==='待落实'); }
export function acknowledgeLeaves(store,chatKey,receipts=[]) {
    const events=leaveEvents(store,chatKey);
    for(const r of receipts) {
        const e=events.find(e=>e.id===r.id&&e.version===r.version&&e.action===r.action);
        if(e) e.state='已落实';
    }
    write(store,LEAVE_EVENTS(chatKey),events);
    return {ok:true,left:pendingLeaves(store,chatKey)};
}
export function takePendingLeft(store, chatKey) {
    const legacy=read(store,LEFT_PENDING(chatKey),[]);
    if(legacy.length) {markLeft(store,chatKey,legacy);write(store,LEFT_PENDING(chatKey),null);}
    return pendingLeaves(store,chatKey);
}
export function markLeft(store, chatKey, items) {
    const messages=live(store.currentMessages(chatKey));
    const done=read(store,LEFT(chatKey),[]).filter(d=>messages.some(m=>m.pos===d.at&&m.fp===d.fp));
    const events=leaveEvents(store,chatKey);
    for(const i of items) {
        if(!messages.some(m=>m.pos===i.at&&m.fp===i.fp)) continue;
        const id=eventId(i);
        if(!events.some(e=>e.id===id)) events.push({...i,id,action:'leave',version:1,state:'待落实'});
        if(!done.some(d=>d.who===i.who&&d.fp===i.fp&&d.at===i.at)) done.push({who:i.who,at:i.at,fp:i.fp,how:i.how});
    }
    write(store,LEFT(chatKey),done.slice(-60));
    write(store,LEAVE_EVENTS(chatKey),events);
}

// 便宜模型判"玩家这句是不是在回他"（叩门状态机认不出的那几句）
export const KNOCK_JUDGE_SYSTEM = "你替一段群聊判一件小事：某人刚联系了玩家（发来消息、打来电话、或者到了门口），玩家接着写了一句。判这一句是不是在回应〔当事人〕——接电话、回消息、开门、让〔当事人〕进来、对〔当事人〕说话、搭〔当事人〕的茬都算；对别人说话、只写自己的动作、明说不理会都不算。只答一个字：是 或 否。";
export function knockJudgePrompt({ who, way, knock, text }) {
    const how = way === '电话' ? '打来电话' : way === '上门' ? '到了门口' : '发来消息';
    return `【${personWord(who)}】${who}（${how}），${personWord(who)}那条：${String(knock ?? '').slice(0, 600)}\n【玩家接着写的】${String(text ?? '').slice(0, 600)}\n玩家这句是不是在回应${personWord(who)}？只答 是 或 否。`;
}
export function parseKnockJudge(text) {
    const s = String(text ?? '').trim().replace(/^[\s"“'（(【\[]+/, '');
    if (/^是/.test(s)) return true;
    if (/^否|^不是|^不/.test(s)) return false;
    return null;
}
