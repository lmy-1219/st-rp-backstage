// 玩家交代跳过的一段（章程 G1，场记章程第 11 条）：玩家一句"这两天没出门，第三天上午才……"，剧情日一下走了好几天。
// 这段空白不是"他一件件都没理"，要推演：
//   - 认出来：折的时候，最近一次跨天是玩家那句交代的（记账"时间"记录写了过了多久、或叙述里明写了时间往前走），记一段空白，
//     挂在玩家那条上（删了就回来）；
//   - 口袋按空白处理：到现场的过期（这段时间玩家没去那儿）；找上门、消息、电话的当作来过、没人应——沉底，后果照沉底的走；
//     只管当天、只管那场戏的过期；镜头外的、不在空白里的照旧。不把这几件一下子全算成"今天刚到时候"；
//   - 局势补跑：空白几天补几次换天（至多三次；再多就一次，说"过了几天"），每次带上这是空白里第几天、玩家交代了什么；
//   - "这段时间"那一块：空白过后头一个开口的人多一块，纯程序拼——在外头的人办到哪儿、谁找过玩家没人应、外面看得到的动静、
//     到日子没办的约定；至多八行；旁白拿全部，有卡的人只拿他知道的。
// 题材无关：日子、地方、人都来自聊天、记账和规划。
import { elapsedDays, timeSkipIn } from './recall.mjs';
import { entryOf, ttlOf, SCENE_TTL, nearPlace } from './planner.mjs';
import { datedEvent, mainEvent } from './eventlead.mjs';

export const SKIP_WINDOW = 12;     // 跨天那条离最新一条超过这么多条就不认了（头一回启用时不补认早先的跨天）
export const SKIP_RUNS = 3;        // 局势补跑至多几次
export const SKIP_LINES = 8;       // "这段时间"那一块至多几行
const SAID_MAX = 300;
const clip = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n)}…` : t; };
const tidy = t => String(t ?? '').trim().replace(/[。；;，,]+$/, '');

// 这条玩家的话是不是在交代时间往前走了：叙述里明写了（timeSkipIn）；记账在这条上记了"时间"、过了一天以上；
// 记在附近几条上的"时间"引的是这条里的原话；用户在这条上点过"从这条起算新的一天／第几天"。
function toldSkip(m, timeRecs) {
    if (timeSkipIn(m.text)) return true;
    if (/^(?:day|d:\d)/.test(String(m.mark ?? ''))) return true;
    const days = r => Math.max(elapsedDays(r.elapsed ?? ''), elapsedDays(r.text ?? ''));
    return timeRecs.some(r => !r.cancel && days(r) >= 1 && (r.pos === m.pos
        || (r.pos > m.pos && r.pos - m.pos <= 3 && (r.quotes ?? []).some(q => String(q).length >= 2 && String(m.text ?? '').includes(q)))));
}

// 最近一次跨天是不是玩家交代的一段空白。messages＝[{pos, fp, is_user, text, mark}]；dayOf＝记下的日子（不算还没记账的临时认的）；
// marks＝timeMarksFor 给的（离开那段不算玩家交代的）。返回 { pos, fp, crossPos, fromPos, fromDay, toDay, span, said } 或 null。
export function findSkip({ messages = [], timeRecs = [], marks = [], dayOf = null, window = SKIP_WINDOW } = {}) {
    if (!dayOf || messages.length < 2) return null;
    const last = messages.at(-1);
    let i = messages.length - 1;
    while (i > 0 && !(dayOf(messages[i].pos) > dayOf(messages[i - 1].pos))) i--;
    if (i <= 0) return null;
    const cross = messages[i], prev = messages[i - 1];
    if (last.pos - cross.pos > window || dayOf(last.pos) !== dayOf(cross.pos)) return null;
    // 玩家离开（absence）那段：另有离开的推演，不算这一种
    if (marks.some(x => x.absence && x.pos > prev.pos - 1 && x.pos <= cross.pos)) return null;
    const from = dayOf(prev.pos), to = dayOf(cross.pos);
    const user = messages.filter(m => m.is_user && m.pos <= cross.pos && cross.pos - m.pos <= 3 && m.pos > prev.pos - 3).reverse().find(m => toldSkip(m, timeRecs));
    if (!user) return null;
    return { pos: user.pos, fp: user.fp, crossPos: cross.pos, fromPos: Math.min(prev.pos, user.pos - 1), fromDay: from, toDay: to, span: to - from, said: String(user.text ?? '').trim().slice(0, SAID_MAX) };
}

// 记下的几段里还作数的（挂的那条还在）
export function liveSkips(list, messages = []) {
    return (Array.isArray(list) ? list : []).filter(s => s && messages.some(m => m.pos === s.pos && m.fp === s.fp));
}

// 这件在不在空白里：空白里得有整天（走了两天以上）；口袋里放着的（空白之前放进去的）、到日子落在空白里的（还排着的，
// 或者空白那条之后才被临时认的跳转放进口袋的）
export function inSkip(m, skip) {
    if (!skip || !(skip.span >= 2)) return false;
    if (m.status === 'pocket' && (!Number.isFinite(m.pocket_pos) || m.pocket_pos < skip.pos)) return true;
    return (m.status === 'waiting' || m.status === 'pocket') && Number.isFinite(m.ready_day) && m.ready_day < skip.toDay;
}

// 玩家那句交代里写到了那件事的地方（"这两天我天天在某处"）：那就不是"没去那儿"，照旧
const saidThere = (m, said) => !nearPlace(m, '') && nearPlace(m, said);

export const SKIP_MISSED = '玩家交代的这段时间里来过，没人应';
// 口袋按空白处理（settleSkip）：返回 [{ id, status, why }]——过期（expired）静静撤；沉底（sunk）照沉底的后果走。
// keep(m)：跟着一件还没办的约定的，等那件事，不动；blocked(m)：前面那件还没了结的，不动。
// isPlayer(名字)：到现场的那件，去的人（谁去）是别的角色、不是玩家——玩家跳过这段不等于他没去，不算过期，照旧
// spare(m)：有日子的活动（skipEvents 已经照它办了：改期，或者镜头外照常办了）——这里不动
export function settleSkip(menu, skip, { keep = () => false, blocked = () => false, isPlayer = () => false, spare = () => false } = {}) {
    const out = [];
    for (const m of menu) {
        if (!inSkip(m, skip) || keep(m) || spare(m) || (m.status === 'waiting' && blocked(m))) continue;
        const entry = entryOf(m);
        if (entry === '镜头外') continue;
        const t = ttlOf(m);
        if (t?.kind === '当天' || t?.kind === SCENE_TTL) { out.push({ id: m.id, status: 'expired', why: '没赶上：玩家交代跳过的这段时间里，那个时候已经过去了' }); continue; }
        if (entry === '到现场') {
            if (saidThere(m, skip.said)) continue;
            const goer = String(m.goer ?? '').trim();
            if (goer && !/^(?:玩家|主角)/.test(goer) && !isPlayer(goer)) continue;
            out.push({ id: m.id, status: 'expired', why: '没赶上：这段时间玩家没去那儿' });
            continue;
        }
        out.push({ id: m.id, status: 'sunk', why: SKIP_MISSED });
    }
    return out;
}

// 一跳跳过了有日子的现场活动（章程 L1，用户 10/12："跟主线挂钩的尽量不要错过，尤其玩家会随机跳时间"）：
// 活动那一格落在空白里（从跳之前那一格起、到跳到的那一格之前；空白一格也算——那晚就这么跳过去了），还排着、在口袋里——
//   move：用意是主线、或线是节点焦点的，改期到跳后第一格（eventlead.moveEvent），引子算没送到、马上再送；
//   off：别的，照牵头的人在镜头外发生（他那一条经历＋回音，eventlead.echoEvent）。
// 玩家交代里写到了那个地方（这几天就在那儿）的，不算跳过，照旧
export function skipEvents(menu, skip, { node = null } = {}) {
    const move = [], off = [];
    if (!skip || !(skip.span >= 1)) return { move, off };
    for (const m of menu ?? []) {
        if (!(m.status === 'waiting' || m.status === 'pocket') || !datedEvent(m, { node })) continue;
        if (!(m.ready_day >= skip.fromDay && m.ready_day < skip.toDay) || saidThere(m, skip.said)) continue;
        (mainEvent(m, node) ? move : off).push(m);
    }
    return { move, off };
}

// 局势补跑哪几天：空白几天补几次（至多 SKIP_RUNS），再多就一次（lumped：一次把这几天一起推）
export function skipDays(skip) {
    if (!skip || !(skip.span >= 1)) return [];
    if (skip.span > SKIP_RUNS) return [{ day: skip.toDay, nth: 1, of: skip.span, lumped: true }];
    return Array.from({ length: skip.span }, (_, k) => ({ day: skip.fromDay + 1 + k, nth: k + 1, of: skip.span, lumped: false }));
}

// 给局势推演的那一段：这是玩家交代的空白里的第几天、玩家交代了什么
export function skipPromptLines(run, { principal = null } = {}) {
    if (!run?.of) return [];
    const who = principal ?? '主角';
    return ['', run.lumped
        ? `【玩家交代跳过的一段】一下过了 ${run.of} 天，这一次把这几天一起推（各方这几天里的动向、到了日子的托付、传开的话，都按过了 ${run.of} 天来写）。`
        : `【玩家交代跳过的一段】这是那段空白里的第 ${run.nth} 天（共 ${run.of} 天）。`,
    `${who}这边交代的（原话）：${clip(run.said, SAID_MAX)}`,
    `这段时间${who}照交代的过，没交代到的就是没什么事；下面"刚有了结果的事"里写着"没人应"的，是这段时间来找过、没人应的——要是和${who}交代的对不上（比如交代了这段时间就在那儿、见过那人），照交代的算，在"后续"里写它其实怎样了。`];
}

// 空白过后头一个开口的人：从记下这段空白那一折（seen，那条没了就从玩家那条算）起，到他接的那条为止，还没有别人开过口
export function firstAfterSkip(skip, upto = []) {
    if (!skip || !upto.length) return false;
    const at = upto.at(-1).pos;
    const seen = skip.seen && upto.some(m => m.pos === skip.seen.pos && m.fp === skip.seen.fp) ? skip.seen.pos : skip.pos;
    if (at < skip.pos || at - skip.pos > SKIP_WINDOW * 2) return false;
    return !upto.some(m => !m.is_user && m.pos > seen && m.pos <= at);
}

// "这段时间（玩家交代的：……）"那一块。各样都已经按开口的人知道的筛过：
// settled＝在外头的人这段时间办到哪儿（结算记下的）；missed＝来找过、没人应的（沉底那句）；seen＝局势里外面看得到的；overdue＝到日子没办的约定
export function skipLines(skip, { userName = '玩家', settled = [], missed = [], seen = [], overdue = [] } = {}) {
    if (!skip) return [];
    const rows = [
        ...settled.map(r => `· ${clip(tidy(r.text), 120)}`),
        ...missed.map(m => `· ${m.who}找过${userName}${m.surface ? `（${clip(tidy(m.surface), 60)}）` : ''}，没人应${m.sink ? `：${clip(tidy(m.sink), 80)}` : ''}`),
        ...seen.map(s => `· 外面：${clip(tidy(s), 100)}`),
        ...overdue.map(p => `· 说好的：${clip(tidy(p.text), 80)}${p.when ? `（约在：${clip(p.when, 20)}）` : ''}——到日子没办`),
    ].slice(0, SKIP_LINES);
    if (!rows.length) return [];
    return [`这段时间（${userName}交代的：${clip(skip.said, 80)}）——这几天别处是这么过的（只给这一回；照${userName}交代的为准，用得上的带一笔，不用一条条复述）：`, ...rows];
}
