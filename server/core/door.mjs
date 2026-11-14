// 门只列人选，不替旁白或玩家决定谁此刻进场。
import { createHash } from 'node:crypto';
import { sameIdentity, resolveIdentity } from './cast.mjs';
import { hasCard, callsFor, wayOf, partsBetween } from './arrival.mjs';
import { boardFor } from './board.mjs';
import { pendingFor } from './pending.mjs';
import { entryOf, awaitingExtract, afterBlocked } from './planner.mjs';
import { sameName } from './setup.mjs';
import { normalizeRelations, personOf, leaderOf } from './relations.mjs';
import { absentPeople, pickContact } from './contacts.mjs';
import { sharedMatter } from './matters.mjs';
import { narrationOf, canonicalPart, PARTS } from './timeline.mjs';
// slot.mjs 也 import 这里（旁白那一格读名单）：两边都只在调用时用对方，循环引用没事
import { timelineFor, playModeOf, menuDays, paceFor } from './slot.mjs';
import { enteredSince, emptySegment, arrivalLive } from './landing.mjs';
import { leadReady } from './eventlead.mjs';
import { PER_PART } from './knock.mjs';
import { paceName, MID } from './tempo.mjs';

// 被"引子"挂上门的那几件（活动快到了替它放进口袋，eventlead.eventStep）：按套过日子的菜单（和 eventStep 同一套）判引子自己到点没，
// 没到点标 early——门上不算到时候了。别的进口袋路径（stepPocket、改期、局势当下）一概不动（T073）
export function earlyLeads(store, menu = [], timeline = null, evidence = {}) {
    if (!menu.some(m => m.status === 'pocket' && m.pocket_by === '引子')) return menu;
    const days = menuDays(store, menu, timeline?.firmDayOf ?? timeline?.dayOf ?? null);
    const today = timeline?.firmToday ?? timeline?.today;
    return menu.map((m, i) => m.status === 'pocket' && m.pocket_by === '引子' && !leadReady(days[i], days, today, evidence) ? { ...m, early: true } : m);
}

// 递出去后回复还没记账的口袋件（T081）：门上这一轮先不算 ready，等记账确认是 shown 还是仍 pocket 再按原规则走
// 每件只算一次：算过的（m.awaiting 已是布尔）不再算，doorFor 先标、直接调 doorAt 的由它自己标
export function awaitingPockets(menu = [], { messages = [], isDone = null, record = true, same = (a, b) => a === b } = {}) {
    if (record === false || typeof isDone !== 'function' || !menu.some(m => m.status === 'pocket' && m.held_by && Number.isFinite(m.held_pos) && typeof m.awaiting !== 'boolean')) return menu;
    return menu.map(m => typeof m.awaiting === 'boolean' || m.status !== 'pocket' ? m : awaitingExtract(m, { messages, isDone, record, same }) ? { ...m, awaiting: true } : { ...m, awaiting: false });
}

// 旁白留的记号"（该来：名字／方式）"：方式可缺；不一定在最末（模型常在后面又补一句），几处都有就认最后一个、全剥掉。
// 名字里可以带一层括号（卡名"某某（来访）"，T135：带括号的名字认不出，记号漏到正文里、也没叫人）。扩展 sync.mjs 有同一份，两处一起改（测试核两边一致）
// 空白每处至多 3 个、姓名至多 40 字；括号内也封顶，缺闭括号时不能反复分配成千空白。
const MARK = /[（(]\s{0,3}该来\s{0,3}[:：]\s{0,3}(?!\s)((?:(?!\s{4})[^()（）\r\n/／]|[（(](?:(?!\s{4})[^()（）\r\n/／]){0,38}[）)]){1,40}?)\s{0,3}(?:[/／]\s{0,3}(去找他|他过来|消息|电话)\s{0,3})?[）)]/g;
export function doorMark(text) {
    const s = String(text ?? '');
    const valid = who => who === who.trim() && who.length > 0 && who.length <= 40 && !/\s{4}/.test(who);
    const all = [...s.matchAll(MARK)].filter(m => valid(m[1]));
    if (!all.length) return { who: null, way: null, text: s };
    return { who: all.at(-1)[1].trim(), way: all.at(-1)[2] ?? null, text: s.replace(MARK, (mark, who) => valid(who) ? '' : mark).replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trimEnd() };
}

const list = value => Array.isArray(value) ? value : Object.values(value ?? {});
const read = (store, key, fallback = null) => {
    try { return JSON.parse(store.getMeta?.(key) ?? 'null') ?? fallback; } catch { return fallback; }
};
const remoteWay = text => /电话|来电/.test(text ?? '') ? '电话' : /消息|短讯|短信|发来/.test(text ?? '') ? '消息' : '';
const concrete = place => place && !/^(?:这里|那里|那儿|这儿|外头|别处|不明|未知)$/.test(place);
const priority = { contact: 0, named: 1, promise: 2, errand: 3, pocket: 4, reach: 5 };
// 旁白替他递过的消息、来电（sent）：排在结算的联系之后、玩家点名之前——他刚找过玩家，进来就接着这件说（场记章程 B1）
const rank = c => (c.sent ? 0.5 : priority[c.source.type]);

// 只有当前人的句首动作确实是门上这一项的联系方式，才省掉“方式：内容”。
const surfaceSaysWay = (surface, who, entry, label) => {
    if (!['消息', '电话', '找上门'].includes(entry)) return false;
    let start = String(surface ?? '').trimStart();
    if (start.startsWith(who)) start = start.slice(who.length).trimStart();
    const said = /^(?:发来短讯|发来消息|打来电话|来了|上门)/.exec(start)?.[0];
    return (label === '发来短讯' && ['发来短讯', '发来消息'].includes(said))
        || (label === '来电' && said === '打来电话')
        || (label === '上门' && ['来了', '上门'].includes(said));
};

// input：board、pending、roster、menu、relations、userName、recentUser、holds、timeline、messages、reach、request、anchors（隔离区间）、arrivals（进场记录）、members（群里的卡）。
export function doorAt(input = {}) {
    const { board = {}, pending = {}, roster = [], userName = '玩家', recentUser = '', timeline = {}, messages = [], reach = null, request = null } = input;
    const memory = input.playMode === 'memory';
    const names = roster.map(e => e.name);
    const rel = input.relations ? normalizeRelations(input.relations) : null;
    const same = (a, b) => !!a && !!b && (sameName(a, b, names) || (!!rel && !!personOf(rel, a, names) && personOf(rel, a, names) === personOf(rel, b, names)));
    const menu = awaitingPockets(input.menu ?? [], { messages, isDone: input.isDone, record: input.record !== false, same });
    const last = messages.at(-1)?.pos ?? board.pos ?? 0;
    const rowAt = pos => (timeline.firmRows ?? timeline.rows)?.filter(r => r.pos <= pos).at(-1) ?? { day: timeline.firmToday ?? timeline.today ?? board.time?.day ?? 0, part: timeline.firmPart ?? timeline.part ?? board.time?.part };
    const parts = timeline.parts ?? PARTS, now = rowAt(last);
    const earlyPart = m => {
        const fit = /之前|以前|之后|以后|[前后不别或到]/.test(String(m.fit ?? '')) ? null : canonicalPart(m.fit, timeline.scale);
        return !!fit && (parts.indexOf(now.part) < 0 || (now.day === m.ready_day && parts.indexOf(fit) > parts.indexOf(now.part)));
    };
    const items = [];
    for (const card of roster.filter(e => hasCard(e) && e.name !== '旁白')) {
        const who = card.name;
        const uniqueName = name => resolveIdentity(roster.filter(hasCard), name).person?.avatar === card.avatar;
        const ownIdentity = ref => sameIdentity(ref,card,roster.filter(hasCard));
        const person = list(board.people).find(p => sameIdentity(p, card, roster)) ?? { status: 'never' };
        if (['present', 'remote'].includes(person.status)) continue;
        if ((input.holds ?? []).some(h => same(h.who, who) && h.at <= last && partsBetween(rowAt(h.at), rowAt(last), timeline.parts ?? PARTS) <= 0)) continue;
        const own = list(pending.items).filter(p => p.avatar ? ownIdentity(p) : uniqueName(p.owner) || (p.who ?? []).some(uniqueName));
        const contacts = (memory ? [] : own).filter(p => p.kind === '联系' && !['办了', '用上了', '失效'].includes(p.status));
        // 他牵头、已经拿出来了、后半截还等他自己说的（status shown）也在门上：别人不替他交后半截（slot.menuFor）
        // 拿出来那条以后他自己进了场（landing.enteredSince）：这件门上不再挂——他来过了，后半截他在场时自己说（slot.menuFor 照旧给他）
        const pocketAt = m => (m.status === 'shown' ? m.settled_pos ?? m.pocket_pos : m.pocket_pos);
        const pockets = (memory ? [] : menu).filter(m => ownIdentity(m) && (m.status === 'pocket' || m.status === 'shown') && (m.status === 'shown' || !afterBlocked(m, menu, x => x.status, { visible: input.visible, messages })) && (entryOf(m) === '找上门' || ['消息', '电话'].includes(m.entry))
            && !enteredSince(pocketAt(m), { who, avatar: card.avatar, messages, anchors: input.anchors ?? null, arrivals: input.arrivalHistory ?? input.arrivals ?? [], knockLive: input.knockLive }));
        const reached = !memory && reach && ownIdentity({...reach,who:reach.person ?? reach.who});
        const called = uniqueName(who) && callsFor(narrationOf(recentUser), [who, ...(rel ? personOf(rel, who, names)?.又名 ?? [] : [])]);
        const requestMessage = request && messages.find(m => m.pos === request.at);
        const follower = rel && leaderOf(rel, who, names);
        // 依附者的按钮请求须能核实原指纹；其他人的旧请求行为保留。
        const requestLive = requestMessage && (Object.hasOwn(request, 'fp') ? !!request.fp && requestMessage.fp === request.fp : !follower && !!requestMessage.is_user);
        const requested = request && ownIdentity(request) && requestLive && last >= request.at && last - request.at <= 8;
        // 只跟着别人出现的人（关系表"跟着"）：门上不单独挂他——他不单独上门、发消息、打电话，跟着的那人来了他才在（T135）。玩家点名叫他的照旧
        if (follower && !called && !requested) continue;
        const promises = list(pending.items).filter(p => p.kind === '约定' && ['到了', '排着'].includes(p.status)
            && (person.since == null || p.since >= person.since - 3)
            && [...(p.who ?? []), ...(p.with ?? [])].some(uniqueName)
            && [...(p.who ?? []), ...(p.with ?? [])].some(n => same(n, userName)));
        // 这局从没出场的：后台排了他（口袋、来联系、结算的联系）或者玩家叫他，才进名单
        if (person.status === 'never' && !contacts.length && !pockets.length && !reached && !called && !requested && !(memory && promises.length)) continue;
        const errands = own.filter(p => p.kind === '去办' && uniqueName(p.owner) && (person.since == null || p.since >= person.since - 3));
        const place = person.place || errands.find(e => concrete(e.place))?.place || promises.find(p => concrete(p.place))?.place;
        // 时机由玩家定（D-175）：刚走的、还在外头办事的也给"他过来"；"去找他"只要他在这局出现过（进场那份照他的去向写他在哪），或者知道他在哪
        const defaults = [...(person.status !== 'never' || concrete(place) ? ['去找他'] : []), '他过来', '消息', '电话'];
        // 跟玩家什么关系：只要头一个短语（关系表里这一格常是一大段相处的分寸，那是他自己的底子，旁白要了就又入戏了）
        const tie = String((rel ? personOf(rel, who, names)?.关系?.find(r => same(r.对, userName))?.是 : '') ?? '').split(/[。；;（(\n]/)[0].trim().slice(0, 20);
        const context = [place ? `在${place}` : '', errands.map(e => e.text).join('；'), person.plan?.backLine ? `说过：${person.plan.backLine}` : '', tie ? `和${userName}：${tie}` : ''].filter(Boolean).join('；');
        const candidates = [];
        // at：这一项从哪条起挂着（他的口袋进口袋、拿出来那条；结算写下联系那条）——门上等了多久从这儿算（waiting.mjs）
        const add = (type, id, ready, known, label, reason, way = '', surface = '', at = null, extra = {}) => {
            const remote = remoteWay(way);
            const ways = remote ? [remote] : type === 'contact' ? ['他过来'] : defaults;
            const display = extra.display ?? (type === 'named' ? `玩家点名：${label}` : type === 'promise' ? `约定：${label}` : type === 'errand' ? `可能回来：${label}` : label);
            candidates.push({ who, avatar: card.avatar, known, ready, label, display, lines: known ? [...new Set([context, label].filter(Boolean))].slice(0, 2) : [label], ways, source: { type, id }, reason, ...(Number.isInteger(at) ? { at } : {}), ...extra });
        };
        for (const c of contacts) add('contact', c.source?.id ?? c.id, true, true, c.text, c.text, c.why || c.entry, '', c.since, { ...(c.earlier?.surface ? { earlier: c.earlier } : {}), display: `${c.entry === '电话来' ? '想打电话' : c.entry === '消息来' ? '想发消息' : '可能上门'}：${c.text}` });
        if (called || requested) add('named', request?.at ?? last, true, true, `玩家${called || '叫他过来'}`, `玩家${called || '叫他过来'}`, called);
        for (const p of promises) add('promise', p.source?.id ?? p.id, p.status === '到了', true, p.text, p.text);
        // 给玩家看的那句不带后台用语（排着、到了）：只说他去办什么，办得差不多了说一声
        const errandsDue = errands.every(e => e.status !== '排着') && person.plan?.back !== '不回来' && (['上门', '消息', '电话'].includes(person.plan?.back) || !!person.plan?.backLine);
        if (errands.length) add('errand', errands[0].id, errandsDue, true, `在外头办事：${errands.map(e => e.text).join(' → ')}${errandsDue ? '，差不多办完了' : ''}`, context);
        for (const m of pockets) {
            const way = m.entry === '电话' ? '打来电话' : m.entry === '消息' ? '发来消息' : wayOf(`${m.title ?? ''}${m.surface ?? ''}`);
            // 旁白已经替他把消息、来电递出来了（拿出来了、不是他自己当面拿的）：门上写"发来过消息：露面那句"，方式只给那一种；
            // 进场那份接着这条说（main.arrive 看 sent：露面原文、应答带过去，别重发一遍）（场记章程 B1）
            if (m.status === 'shown' && way && !same(m.settled_by, who)) {
                const phone = way === '打来电话';
                add('pocket', m.id, true, false, `${phone ? '打来过电话' : '发来过消息'}：${String(m.surface || m.title || '').slice(0, 40)}`, [m.title, m.surface].filter(Boolean).join('：'), way, m.surface, pocketAt(m),
                    { display: `${phone ? '打来过电话' : '发来过消息'}：${m.surface || m.title || ''}`, sent: { id: m.id, way: phone ? '电话' : '消息', title: m.title ?? '', surface: m.surface ?? '', respond: m.respond ?? '' } });
                continue;
            }
            const saysArrival = m.entry === '找上门' && surfaceSaysWay(m.surface, who, m.entry, '上门');
            const label = way === '打来电话' ? '来电' : way === '发来消息' ? '发来短讯' : saysArrival || /上门|来找|敲门/.test(`${m.title ?? ''}${m.surface ?? ''}`) ? '上门' : '可能会来';
            // 活动快到了、替它挂上门的引子，引子自己没到点（doorFor 标 early）；或递出后那条回复还没记账（标 awaiting，T081）：门上列着，但不算到时候了（T073/T081）
            // 门上的候选还没有发生：只给方式，不把有卡人的动作、私下打算或亲密原文预先交给镜头。
            const displayWay = label === '来电' ? '想打电话' : label === '发来短讯' ? '想发消息' : label === '上门' ? '可能上门' : '可能来联系';
            const surface = m.surface || m.title || '';
            const alreadySaysWay = surfaceSaysWay(surface, who, m.entry, label);
            add('pocket', m.id, !m.early && !m.awaiting && !earlyPart(m), false, label, [m.title, m.surface].filter(Boolean).join('：'), way, m.surface, pocketAt(m), { display: alreadySaysWay ? surface : `${displayWay}：${surface}` });
        }
        if (reached) add('reach', reach.id ?? who, true, false, reach.matter ? `可能来联系：${reach.matter}` : '可能来联系', [...new Set([reach.matterText, reach.hook, ...(reach.threads ?? []).map(r => r.text)].filter(Boolean))].join('；'));
        candidates.sort((a, b) => Number(b.ready) - Number(a.ready) || rank(a) - rank(b));
        if (candidates[0]) items.push(candidates[0]);
    }
    // 一人一条（试玩 10/10：名册里同一个人有旧卡、现卡两张，门上挂了两条）：按关系表认成同一个人的几张卡只留一条——
    // 能接上的优先；再是在群里的那张、最近进过场的那张；再按由头的先后
    const members = list(input.members);
    const inGroup = i => members.some(m => m && !m.disabled && sameIdentity(i, m, roster)) ? 1 : 0;
    const anchors = input.anchors ?? {};
    // 最近进过场的那张：零长度的封段（拉进来判不在场当场封上，T070）不算进过场（用户 10/15）
    const lastIn = i => Math.max(-1, ...list(input.arrivals).filter(e => e && sameIdentity(i, e, roster)).map(e => Number(e.at)).filter(Number.isFinite),
        ...(i.avatar ? anchors[i.avatar]?.segments ?? [] : []).filter(s => !emptySegment(s)).map(s => Number(s?.from)).filter(Number.isFinite));
    const better = (a, b) => Number(b.ready) - Number(a.ready) || inGroup(b) - inGroup(a) || lastIn(b) - lastIn(a) || rank(a) - rank(b);
    const one = [];
    for (const i of items) {
        const k = one.findIndex(x => sameIdentity(x, i, roster));
        if (k < 0) one.push(i);
        else if (better(i, one[k]) < 0) one[k] = i;
    }
    const ready = one.filter(i => i.ready);
    const itemsReady = [...ready].sort((a, b) => Number(b.ready) - Number(a.ready) || rank(a) - rank(b)).slice(0, 3);
    const allReady = ready.sort((a, b) => rank(a) - rank(b) || (a.at ?? 0) - (b.at ?? 0));
    return { items: itemsReady, allReady };
}

// 只在门对外展示与自动叩门挑人时限量；组格和等待记录仍读 doorFor 的原始 items。
export function capFresh(store, records, chatKey, { present = [], recentUser = '', timeline = null, litWho = null } = {}) {
    const messages = store.currentMessages(chatKey);
    timeline ??= timelineFor(store, records, chatKey, messages);
    const { items, allReady = items } = doorFor(store, records, chatKey, { present, recentUser, timeline });
    const chat = store.requireChat(chatKey), roster = store.getCast?.(chat.story_id) ?? [];
    const names = roster.map(c => c.name), relations = store.relationsOf?.(chat.story_id);
    const rel = relations ? normalizeRelations(relations) : null;
    const same = (a, b) => !!a && !!b && (sameName(a, b, names) || (!!rel && !!personOf(rel, a, names) && personOf(rel, a, names) === personOf(rel, b, names)));
    const knocks = read(store, `knocks:${chatKey}`, []), arrivals = read(store, `arrivals:${chatKey}`, []);
    const entries = [...knocks, ...arrivals];
    let anchors = null;
    try { anchors = JSON.parse(chat.anchors ?? 'null'); } catch {}
    const last = messages.at(-1)?.pos ?? 0, parts = timeline.parts ?? PARTS;
    const rowAt = pos => (timeline.firmRows ?? timeline.rows)?.filter(r => r.pos <= pos).at(-1) ?? { day: timeline.firmToday ?? timeline.today, part: timeline.firmPart ?? timeline.part };
    const now = rowAt(last), came = [];
    for (const e of entries) {
        if (!Number.isFinite(Number(e?.at)) || Number(e.at) > last + 1 || partsBetween(rowAt(Number(e.at)), now, parts) !== 0
            || !arrivalLive(e, messages, entries, anchors) || !e.who || came.some(w => same(w, e.who))) continue;
        came.push(e.who);
    }
    const paceValue = paceFor(store, chatKey);
    const pace = paceName(paceValue?.name ?? paceValue) ?? MID;
    const limit = PER_PART[pace];
    let used = came.length;
    return allReady.map(i => {
        if (!['pocket', 'contact', 'reach'].includes(i.source.type) || i.sent || same(i.who, litWho) || came.some(w => same(w, i.who))) return i;
        if (used >= limit) return { ...i, ready: false };
        used++; return i;
    }).sort((a, b) => Number(b.ready) - Number(a.ready) || rank(a) - rank(b) || (a.at ?? 0) - (b.at ?? 0));
}

const caches = new WeakMap();
export function doorFor(store, records, chatKey, { present = [], recentUser = '', timeline = null, anchor = null, contacts = null, planner = null } = {}) {
    const chat = store.requireChat(chatKey);
    const all = store.currentMessages(chatKey);
    const match = /^(\d+):(.+)$/.exec(anchor ?? '');
    const messages = match && all[Number(match[1]) - 1]?.fp === match[2] ? all.slice(0, Number(match[1])) : all;
    // 没给时间线就自己算：场面表判"到时候了"、"先不"过没过这个时段都要它
    timeline ??= timelineFor(store, records, chatKey, messages);
    const options = { present, recentUser, timeline, anchor };
    const board = boardFor(store, records, chatKey, options);
    const pending = pendingFor(store, records, chatKey, options);
    const roster = store.getCast?.(chat.story_id) ?? [];
    const relations = store.relationsOf?.(chat.story_id) ?? null;
    const names = roster.map(e => e.name);
    const rel = relations ? normalizeRelations(relations) : null;
    const sameWho = (a, b) => sameName(a, b, names) || (!!rel && !!personOf(rel, a, names) && personOf(rel, a, names) === personOf(rel, b, names));
    const isDone = typeof records?.isDone === 'function' ? fp => records.isDone(chat.story_id, fp) : null;
    const visible = records.visible(chatKey).filter(r => r.pos <= messages.at(-1)?.pos);
    const menu = awaitingPockets(earlyLeads(store, store.menuOf?.(chatKey) ?? [], timeline, { visible, messages }), { messages, isDone, record: planner?.record !== false, same: sameWho });
    const holds = read(store, `arrival_hold:${chatKey}`, []);
    const arrivals = read(store, `arrivals:${chatKey}`, []), arrivalHistory = read({ getMeta: store.getRawMeta ?? store.getMeta }, `arrivals:${chatKey}`, []);
    const knocks = read(store, `knocks:${chatKey}`, []);
    let anchors = null, members = [];
    try { anchors = chat.anchors ? JSON.parse(chat.anchors) : null; } catch {}
    try { members = (chat.members ? JSON.parse(chat.members) : []).map(m => ({ avatar: m?.avatar ?? null, name: m?.name ?? null, disabled: !!m?.disabled })); } catch {}
    const request = read(store, `arrival_request:${chatKey}`);
    const userName = [...messages].reverse().find(m => m.is_user)?.name ?? '玩家';
    const dayOf = timeline?.dayOf ?? (pos => timeline?.rows?.filter(r => r.pos <= pos).at(-1)?.day ?? timeline?.today ?? 0);
    const offers = store.contactOffers?.(chatKey) ?? [];
    const lastPos = messages.at(-1)?.pos ?? 0;
    const people = absentPeople({ records: records.visible(chatKey), messages, present, userName, roster, dayOf, openIdeaIds: new Set((records.openIdeas?.(chatKey) ?? []).map(r => r.id)) })
        .filter(p => (!planner?.provider || p.lastPos >= 0) && !(rel && leaderOf(rel, p.person, roster.map(e => e.name))));
    // "可能来联系"得有由头（场记章程 #2）：他和玩家之间有一件碰上了、还没下文的事才挂，label 带那件事的题；没出场过的也一样
    const reachable = people.flatMap(p => {
        // 没出场过的人也一样：门上不随机挑（他该怎么登场由规划、口袋、名册钩子排；旁白那一格里的"此刻可以有这件事"另算）
        const r = sharedMatter(visible, { person: p.person, userName, same: sameWho });
        return r ? [{ ...p, id: r.id, matter: String(r.matter?.title || r.text || '').slice(0, 24), matterText: String(r.text ?? '').slice(0, 80) }] : [];
    });
    const already = offers.find(o => o.round === String(recentUser).slice(-300));
    const justBack = store.absences?.(chatKey)?.at(-1)?.from_pos;
    const reach = contacts?.enabled === false || !recentUser || (justBack != null && lastPos - justBack <= 8) ? null
        : already ? reachable.find(p => p.person === already.person) : pickContact({ people: reachable, dayOf, lastPos, offers, minGap: contacts?.minGap ?? 16 });
    const input = { playMode: playModeOf(store, chatKey), board, pending, roster, relations, menu, visible, holds, request, messages, userName, recentUser, timeline: timeline ?? {}, present, reach, anchors, arrivals, arrivalHistory, knockLive: e => store.knockLive?.(chatKey, e), knocks, members, pace: paceFor(store, chatKey) };
    const key = `${chatKey}:${createHash('sha1').update(JSON.stringify(input)).digest('hex')}`;
    let cache = caches.get(store);
    if (!cache) caches.set(store, cache = new Map());
    if (cache.has(key)) return cache.get(key);
    const value = doorAt(input);
    cache.set(key, value);
    while (cache.size > 32) cache.delete(cache.keys().next().value);
    return value;
}

export function doorLines(items) {
    return !items.length ? [] : [
        '外头的人（有自己的卡，旁白不替他们写话和动作）：',
        ...items.map(item => `· ${item.who}：${item.lines.join('；')}（可选：${item.ways.join('、')}）`),
        '这几位里哪位这会儿顺理成章该出现了（说好的时候到了、玩家正往他那儿去、他该来消息了），就别写他，写到他出现之前那一刻停，末尾单独一行：（该来：名字／去找他、他过来、消息、电话里挑一个）。没到时候就不写这一行。一段最多点一个。',
    ];
}
