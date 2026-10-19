// 有日子的现场活动别让玩家错过（章程 L1，用户 10/12："跟主线挂钩的尽量不要错过，尤其玩家会随机跳时间"）。
// 某处某天有一场活动（规划写成"到现场"）：邀请只靠在场的人"挑时候"递，紧戏里一直没递；海报要她恰好路过——她不知道就直接错过了，
// 玩家一跳好几天更是一下就过去了。所以：
//   一、规划给这种活动配一件找上门的引子（planner.LEAD_NOTE；活动那件的"引子"写引子的题，存 menu.lead）；
//   二、送不到就兜底（折一次时，eventStep）：活动那一格的前一格起，引子还没拿出来——
//       引子是找上门、牵头的人有卡又不在场：挂到门上（把引子放进口袋，门上那条"外头的人来联系"就有它，玩家点了才进）；
//       别的（新闻、路人、传单，或者牵头的人就在场、没有卡）：下一次开口的那一格最前面一句，"这一轮得让她知道，一两句带过"（旁白开口也算，leadNotice）；
//       没写引子、用意是主线（或线是节点焦点）的：程序拼一句通用的风声（"听说某时在某处有某事"），照下一句办；
//   三、跳时间接得住（skip.skipEvents）：一跳跳过了有日子的活动——主线的改期到跳后第一格、引子算没送到、马上照第二条再送；
//       别的照牵头的人在镜头外发生，给回音；
//   四、知道了却没去（引子拿出来过、活动日子过了、她没到场）：牵头的人（或谁去）在镜头外照常办了，记成他自己的一条经历，
//       再排一件很轻的找上门的回音（他自己提起、有人带话、发来照片视频），内容用活动的"没接会怎样"，没有就用题拼一句。
// 记的几笔都挂在消息上（删回那条之前就当没发生，下次折再算）：event_lead（升级过的）、event_moves（改期）、event_echo（回音排过的）。
// 题材无关：地方、日子、谁、题都来自规划。
import { entryOf, WORLD, ifSunkOf } from './planner.mjs';
import { scaleOf, DAY } from './timescale.mjs';
import { hasCard } from './arrival.mjs';
import { sameName } from './setup.mjs';

const DONE = new Set(['shown', 'used']);
const LIVE = new Set(['waiting', 'pocket']);
const tidy = t => String(t ?? '').trim();
const bare = t => { const s = tidy(t); return s.match(/「([^」]+)」/)?.[1].trim() || s; };
const read = (store, key, fallback) => { try { return JSON.parse(store.getMeta?.(key) ?? 'null') ?? fallback; } catch { return fallback; } };
const liveAt = (at, messages = []) => !!at && messages.some(m => m.pos === at.pos && m.fp === at.fp);
export const LEADS_KEY = chatKey => `event_lead:${chatKey}`;
export const MOVES_KEY = chatKey => `event_moves:${chatKey}`;
export const ECHO_KEY = chatKey => `event_echo:${chatKey}`;

// 线是节点焦点：节点的"焦点"那句里写着这条线的名字
export const focusLine = (m, node = null) => { const line = tidy(m?.line), focus = tidy(node?.焦点); return line.length >= 2 && !!focus && focus.includes(line); };
export const mainEvent = (m, node = null) => m?.purpose === '主线' || focusLine(m, node);
// 定了是哪一格：触发写了时间，或者"第几天后"排到了规划那一格之后（said_day＝规划那条消息那一格，slot.menuDays 给）
export const hasDay = m => !!tidy(m?.trigger?.time) || (Number.isFinite(m?.said_day) && Number.isFinite(m?.ready_day) && m.ready_day > m.said_day);
// 有日子的活动：到现场、写了引子（或用意是主线、线是节点焦点，哪怕没写引子）、定了是哪一格
export const datedEvent = (m, { node = null } = {}) => !!m && entryOf(m) === '到现场' && (!!tidy(m.lead) || mainEvent(m, node)) && hasDay(m);
// 引子那件：同一份规划里题对得上的，没有就看别的份
export function leadOf(m, menu = []) {
    const t = bare(m?.lead);
    if (!t) return sameSpotLead(m, menu);
    const hits = menu.filter(x => x.id !== m.id && bare(x.title) === t);
    return hits.find(x => x.plan_id === m.plan_id) ?? hits.at(-1) ?? null;
}
// 没写引子的（老规划、规划者漏了）：找一件找上门的、露面或应答里点到同一处的、日子不晚于活动的，当它的引子
// （试玩 10/12：翻唱夜那几件没写引子，同一份里明明有一件"有人托话约她去那家店"的邀请——程序却自己拼了一句风声，还把规划的题当活动名写了进去）
const spotOf = m => { const p = tidy(m?.place); return p.match(/「([^」]{2,})」/)?.[1] ?? (p.length >= 4 ? p : ''); };
function sameSpotLead(m, menu = []) {
    const spot = spotOf(m);
    if (!spot) return null;
    const hits = menu.filter(x => x.id !== m.id && x.status !== 'void' && entryOf(x) === '找上门' && [x.surface, x.respond, x.fit].join(' ').includes(spot)
        && !(Number.isFinite(x.ready_day) && Number.isFinite(m.ready_day) && x.ready_day > m.ready_day));
    return hits.find(x => x.plan_id === m.plan_id) ?? hits.at(-1) ?? null;
}
const moveOf = (m, moves = []) => m?.moved ?? moves.filter(x => x.id === m?.id).at(-1) ?? null;
// 升级过的那一笔；改期以前记的不算（改了期，引子也算没送到）
const entryFor = (m, done = {}, moves = []) => { const e = done?.[m.id]; const mv = moveOf(m, moves); return e && !(mv && e.at?.pos < mv.at?.pos) ? e : null; };
// 引子拿出来过了没有（改期那一下以前拿出来的不算）
export const leadOut = (lead, move = null) => !!lead && DONE.has(lead.status) && !(move && Number.isFinite(lead.settled_pos) && lead.settled_pos < move.at?.pos);

// 该升级的那几件（折一次时）：活动还排着、在口袋里，到了它那一格的前一格（只有当格的就当格），引子还没拿出来，也还没升级过。
// canDoor(引子)：挂得上门（找上门、牵头的人有卡又不在场）。返回 [{ event, lead, how: 'door'|'line' }]
export function leadSteps(menu = [], { today, node = null, done = {}, moves = [], canDoor = () => false } = {}) {
    const out = [], leads = new Set();
    if (!Number.isFinite(today)) return out;
    for (const m of menu) {
        if (!LIVE.has(m.status) || !datedEvent(m, { node })) continue;
        if (today < m.ready_day - 1 || today > m.ready_day) continue;
        if (entryFor(m, done, moves)) continue;
        const lead = leadOf(m, menu);
        if (leadOut(lead, moveOf(m, moves))) continue;
        if (lead && leads.has(lead.id)) { out.push({ event: m, lead, how: 'shared' }); continue; }   // 几件活动共用一个引子：只送一回，后面几件跟着记成升级过
        if (lead) leads.add(lead.id);
        out.push({ event: m, lead, how: lead && canDoor(lead) ? 'door' : 'line' });
    }
    return out;
}

// 知道了却没去的：活动日子过了、她没到场（没拿出来过、没撤），而她知道——引子拿出来过、门上那件接过了、那一句给过了。回音排过的不再排
export function missedEvents(menu = [], { today, node = null, done = {}, moves = [], echoed = {} } = {}) {
    if (!Number.isFinite(today)) return [];
    return menu.filter(m => {
        if (!datedEvent(m, { node }) || DONE.has(m.status) || m.status === 'void' || echoed?.[m.id] || !(m.ready_day < today)) return false;
        const lead = leadOf(m, menu), e = entryFor(m, done, moves);
        return leadOut(lead, moveOf(m, moves)) || (e?.how === 'door' && !!lead && DONE.has(lead.status)) || (e?.how === 'line' && !!e.given);
    });
}

// 那一格怎么说：今天／明天／几天后，再带上触发里写的时段（天尺度才有）
const PART_RE = /凌晨|早上|上午|中午|下午|傍晚|黄昏|晚上|夜里|半夜|深夜/;
export function whenText(day, today, timeScale = DAY, time = '') {
    const ts = scaleOf(timeScale);
    const d = day - today;
    const unit = d <= 0 ? ts.this : d === 1 ? ts.next : `${d} ${ts.ord}后`;
    return `${unit}${ts.unit === '天' ? String(time ?? '').match(PART_RE)?.[0] ?? '' : ''}`;
}
// 没写引子的主线活动：一句通用的风声
export const rumorText = (m, when) => `听说${when}${tidy(m?.place) ? `${tidy(m.place)}那边` : '有个地方'}有场热闹`;   // 不写规划的题：题是幕后的标签，写出来像个怪名字，还会把后面的戏说破
// 下一次开口那一格最前面的一句
export function noticeLines(rows = [], { userName = '玩家' } = {}) {
    if (!rows.length) return [];
    return [`${rows.length > 1 ? '这几件事' : '这件事'}这一轮得让${userName}知道——一两句带过就行，不用展开；按这一局说得通的样子带出来（捎来的话、来消息、新闻、路人闲聊、传单都行），去不去由${userName}：`,
        ...[...new Map(rows.map(r => [`${r.text}|${r.when}|${r.place ?? ''}`, r])).values()].map(r => `· ${r.text}（${r.when}${r.place ? `，在${r.place}` : ''}${r.moved ? '；原定的日子临时改了期，挪到了这时候' : ''}）`)];
}

// 回音落在谁身上：活动牵头的人；"世界"或她自己牵头的，看谁去；都不是就没有人（回音由"世界"带）
const herName = (n, player = []) => { const s = tidy(n); return !!s && (/^(?:玩家|主角)/.test(s) || player.some(p => p && (p === s || (p.length >= 2 && s.length >= 2 && (p.includes(s) || s.includes(p)))))); };
export function echoHolder(m, player = []) {
    for (const n of [m?.who, m?.goer].map(tidy)) if (n && n !== WORLD && !herName(n, player)) return n;
    return null;
}
// 没去的回音：他自己那一条经历、一件很轻的找上门（内容用"没接会怎样"，没有就用题拼一句）
export function echoParts(m, { userName = '玩家', player = [] } = {}) {
    const holder = echoHolder(m, player);
    const title = tidy(m?.title), place = tidy(m?.place);
    const what = tidy(ifSunkOf(m)).replace(/[。．.]+$/, '') || `${userName}没去的那回「${title}」，照样办完了`;
    return {
        holder,
        record: holder ? `${holder}这段时间照常去了「${title}」${place ? `（在${place}）` : ''}，${userName}没到场，那边照样办完了` : null,
        item: { who: holder ?? WORLD, title: `${title}·回音`.slice(0, 30), surface: holder ? `${holder}提起那回的「${title}」：${what}` : `外头有人说起那回的「${title}」：${what}`, respond: what, sink: null,
            fit: holder ? `${holder}下回露面、来消息时顺口提起，或者托人带句话、发来照片视频；一两句就够` : '有人说起、捎来一句话、照片传开，按这个世界说得通的样子；一两句就够',
            weight: '一句', know: null, origin: null, line: tidy(m?.line) || '后续', after: null, motif: '后续', promiseRef: null, offscreen: false, afterDays: 0,
            entry: '找上门', place: null, goer: null, errand: null, purpose: '关系', trigger: null, ttl: { kind: '三天内' }, premise: `${userName}没去「${title}」`, ifTaken: null, ifSunk: null },
    };
}

// ---------- 记在 meta 里的几笔（挂在消息上，那条没了就不算） ----------
export function movesOf(store, chatKey, messages = null) {
    const list = read(store, MOVES_KEY(chatKey), []);
    if (!Array.isArray(list) || !list.length) return [];
    const msgs = messages ?? store.currentMessages?.(chatKey) ?? [];
    return list.filter(x => x && liveAt(x.at, msgs));
}
// 改期：活动的日子挪到改到的那一格（menuDays 套上；时效按日子算，跟着挪）
export function applyMoves(menu = [], moves = []) {
    if (!moves.length) return menu;
    return menu.map(m => { const mv = moves.filter(x => x.id === m.id).at(-1); return mv ? { ...m, ready_day: mv.to, moved: mv } : m; });
}
const liveMap = (obj, messages) => Object.fromEntries(Object.entries(obj && typeof obj === 'object' ? obj : {}).filter(([, e]) => e && liveAt(e.at, messages)));
const holderOf = (roster, who) => roster.find(e => hasCard(e) && sameName(e.name, who, roster.map(x => x.name)))?.avatar ?? `name:${who}`;

// 他在镜头外照常办了：他那一条经历＋一件回音；活动本身收掉（过期），别再进口袋
export function echoEvent(store, records, chatKey, m, { at, day, roster = [], userName = null, player = [], storyId = null, why = '' } = {}) {
    const { holder, record, item } = echoParts(m, { userName: userName ?? '玩家', player });
    if (holder && record && records?.addDerived && storyId) records.addDerived({ storyId, fp: at.fp, type: '做', text: record.slice(0, 240), holder: holderOf(roster, holder), holderName: holder, audience: [holder], about: holder,
        keys: [m.title, m.place].map(tidy).filter(x => x.length >= 2), matter: { menu: m.id, title: m.title ?? '', entry: '镜头外', who: holder } });
    const plan = store.lastReadyPlan?.(chatKey);
    if (plan && store.appendMenu) store.appendMenu(plan.id, [item], { storyDay: day, at });
    if (LIVE.has(m.status)) store.updateMenu(chatKey, m.id, { status: 'expired', by: '程序', why: why || `${userName ?? '玩家'}没去：${holder ?? '那边'}照常办了`, at });
    store.logEvent?.(chatKey, 'event_echo', { id: m.id, title: m.title, holder, why });
    return { holder, item };
}

// 改期（跳时间跳过了主线的活动）：日子挪到跳后第一格，记一笔；在口袋里的从这一格重新算（"当天"的时效跟着挪）；
// 给牵头的人记一句改期的缘由
export function moveEvent(store, records, chatKey, m, { to, at, roster = [], player = [], storyId = null, timeScale = DAY } = {}) {
    const moves = read(store, MOVES_KEY(chatKey), []);
    store.setMeta?.(MOVES_KEY(chatKey), JSON.stringify([...(Array.isArray(moves) ? moves : []), { id: m.id, from: m.ready_day, to, at }].slice(-40)));
    if (m.status === 'pocket') store.updateMenu(chatKey, m.id, { status: 'pocket', pocket_day: to, by: '改期', why: '跳过的那段里没办成，改了期', at });
    const holder = echoHolder(m, player), ts = scaleOf(timeScale);
    if (holder && records?.addDerived && storyId) records.addDerived({ storyId, fp: at.fp, type: '做', text: `${holder}那边：「${tidy(m.title)}」原定的那${ts.ord}临时没办成，改了期，挪到了${ts.this}`.slice(0, 240),
        holder: holderOf(roster, holder), holderName: holder, audience: [holder], about: holder, keys: [m.title, m.place].map(tidy).filter(x => x.length >= 2) });
    store.logEvent?.(chatKey, 'event_moved', { id: m.id, title: m.title, from: m.ready_day, to });
}

// 折一次时（slot.advanceWorld，口袋走完之后）：该升级的升级，知道了却没去的给回音。menu＝套过日子（menuDays）的菜单；
// today 认引子（临时认的跳转也算：门上、那一句都挂在消息上，删回去就撤）；firmToday 认"日子过了"（回音回不来，只按记下的日子）
export function eventStep(store, records, chatKey, { menu = [], messages = [], today, firmToday = today, here = [], roster = [], userName = null, player = [], node = null } = {}) {
    const last = messages.at(-1);
    if (!last || !menu.length) return { steps: [], echoes: [] };
    const names = roster.map(e => e.name);
    const same = (a, b) => sameName(a, b, names);
    const at = { pos: last.pos, fp: last.fp };
    const moves = movesOf(store, chatKey, messages);
    const done = liveMap(read(store, LEADS_KEY(chatKey), {}), messages);
    const canDoor = lead => entryOf(lead) === '找上门' && !!tidy(lead.who) && lead.who !== WORLD && !herName(lead.who, player)
        && roster.some(e => hasCard(e) && same(e.name, lead.who)) && !here.some(n => same(n, lead.who));
    const steps = leadSteps(menu, { today, node, done, moves, canDoor });
    for (const s of steps) {
        if (s.how === 'door' && s.lead.status !== 'pocket') store.updateMenu(chatKey, s.lead.id, { status: 'pocket', pocket_day: today, by: '引子', why: '有日子的活动快到了，引子还没送到：挂到门上', at });
        done[s.event.id] = { how: s.how, lead: s.lead?.id ?? null, at };
        store.logEvent?.(chatKey, 'event_lead', { id: s.event.id, title: s.event.title, how: s.how, lead: s.lead?.title ?? null });
    }
    if (steps.length) store.setMeta?.(LEADS_KEY(chatKey), JSON.stringify(done));
    const echoed = liveMap(read(store, ECHO_KEY(chatKey), {}), messages);
    const missed = missedEvents(menu, { today: firmToday, node, done, moves, echoed });
    const storyId = store.requireChat?.(chatKey)?.story_id ?? null;
    for (const m of missed) {
        echoEvent(store, records, chatKey, m, { at, day: firmToday, roster, userName, player, storyId, why: `${userName ?? '玩家'}知道了却没去：照常办了` });
        echoed[m.id] = { at };
    }
    if (missed.length) store.setMeta?.(ECHO_KEY(chatKey), JSON.stringify(echoed));
    return { steps, echoes: missed };
}
// 跳时间跳过去的、不是主线的那几件：照牵头的人在镜头外发生，回音照排；记一笔防重复
export function markEchoed(store, chatKey, ids = [], at) {
    if (!ids.length) return;
    const echoed = read(store, ECHO_KEY(chatKey), {});
    for (const id of ids) echoed[id] = { at };
    store.setMeta?.(ECHO_KEY(chatKey), JSON.stringify(echoed));
}

// 组那一格时（slot.extrasFor）：升级成"下一句"、还没给出去的那几件，放在这一格最前面；给了记在被回的那条上（左滑重来照给，删了那条重给）。
// 活动已经过去了、撤了，或者引子在升级以后拿出来了：不再给。retime(文字, 写的那一格)：规划写的"明晚"按今天换说法
export function leadNotice(store, chatKey, { menu = [], messages = [], anchorMsg = null, today, timeScale = DAY, userName = '玩家', record = true, retime = t => t } = {}) {
    const all = read(store, LEADS_KEY(chatKey), {});
    const rows = [];
    let changed = false;
    for (const [id, e] of Object.entries(all && typeof all === 'object' ? all : {})) {
        if (e?.how !== 'line' || !liveAt(e.at, messages)) continue;
        if (e.given && liveAt(e.given, messages) && e.given.pos !== anchorMsg?.pos) continue;
        const m = menu.find(x => String(x.id) === id);
        if (!m || !LIVE.has(m.status) || (Number.isFinite(today) && m.ready_day < today)) continue;
        const lead = e.lead != null ? menu.find(x => x.id === e.lead) : null;
        if (lead && DONE.has(lead.status) && Number.isFinite(lead.settled_pos) && lead.settled_pos >= e.at.pos) continue;
        const when = whenText(m.ready_day, today, timeScale, m.trigger?.time);
        rows.push({ text: (lead ? tidy(retime(lead.surface, lead.said_day)) : '') || rumorText(m, when), when, place: tidy(m.place), title: tidy(m.title), moved: !!m.moved });
        if (record && anchorMsg && !(e.given && e.given.pos === anchorMsg.pos && e.given.fp === anchorMsg.fp)) { all[id] = { ...e, given: { pos: anchorMsg.pos, fp: anchorMsg.fp } }; changed = true; }
    }
    if (changed) store.setMeta?.(LEADS_KEY(chatKey), JSON.stringify(all));
    return noticeLines(rows, { userName });
}
