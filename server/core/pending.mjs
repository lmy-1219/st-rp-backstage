// 事账：把约定、要求、规矩、钱、口袋、去办和等回音折成一处。
// 八条规则分别对应约定、要求、规矩、钱、口袋、去办、等回音和来源关系。
import { createHash } from 'node:crypto';
import { validAwayPlan } from './arrival.mjs';
import { promiseOf, stageOf, settledTwins, settledByDoing, relatedTo, sameOccasion, LAPSED } from './promises.mjs';
import { expiredTodo, timedOut, askedOther } from './recall.mjs';
import { buildLedger, samePerson, sameParty, namedParties } from './money.mjs';
import { entryOf, ifTakenOf, ifSunkOf } from './planner.mjs';
import { settledMatter } from './matters.mjs';
import { settledBy } from './slot.mjs';
import { boardFor, boardLoader } from './board.mjs';
import { lifeSheet } from './life.mjs';
import { awayPlansOf } from './opening.mjs';
import { contactUsed } from './landing.mjs';
import { sameName } from './setup.mjs';
import { scaleOf } from './timescale.mjs';
// timeline.scale：这一局的时间尺度（章程 G2）；"第几天""已等几天"、过期按它（没有就是天）
import { normalizeRelations, personOf } from './relations.mjs';

const arr = value => Array.isArray(value) ? value : value && typeof value === 'object' ? Object.values(value) : [];
const num = value => Number.isFinite(Number(value)) ? Number(value) : null;
const textOf = value => String(value ?? '');
const names = value => arr(value).filter(x => typeof x === 'string' && x.trim());
const dayAt = (timeline, pos) => typeof timeline?.dayOf === 'function' ? timeline.dayOf(pos) : num(timeline?.rows?.find?.(r => r.pos === pos)?.day) ?? num(timeline?.today) ?? 0;
const partAt = (timeline, pos) => typeof timeline?.part === 'function' ? timeline.part(pos) : timeline?.rows?.find?.(r => r.pos === pos)?.part ?? timeline?.part ?? null;
const sourceId = r => r?.id ?? r?.pos;
// 规矩里写的条件（"在门没装上新面板之前""等她能自己端稳枪"）：取那一截的中心词——末两字和末三字都认（"面板"对得上"门禁面板"）
const conditionWords = text => {
    const m = textOf(text).match(/(?:在|等|直到)([^，。；;]{2,12}?)(?:之前|以后|为止|之后|时|$)/);
    if (!m) return [];
    const phrase = m[1];
    return [...new Set([phrase.slice(-2), phrase.slice(-3)])].filter(w => w.length >= 2);
};
const hasWord = (text, words) => words.some(w => textOf(text).includes(w));

function base({ id, kind, text, who = [], with: with_ = [], owner = null, place = null, entry = null, when = null, since = 0, source, status = '排着', statusAt = null, why = '' }) {
    return { id, kind, text: textOf(text), who: names(who), with: names(with_), owner, place: place ?? null, entry: entry ?? null, when: when ?? null, since: num(since) ?? 0, source, status, statusAt: num(statusAt), why: textOf(why) };
}

function promiseItems(records, timeline, same) {
    const visible = records.filter(r => r?.promise);
    const dayOf = pos => dayAt(timeline, pos);
    const part = pos => partAt(timeline, pos);
    const weekdayOf = timeline?.weekdayOf ?? null;
    const timeScale = scaleOf(timeline?.scale);
    const settled = settledBy(records, { dayOf, partAt: part, weekdayOf, timeScale });
    const closed = new Map([...settled].map(([id, r]) => [id, r]));
    const twins = settledTwins(visible, new Map([...settled].map(([id, r]) => [id, r.pos])));
    // 办了没人记了结的（用户 10/8）：办的人名下有一条说的是同一件的"做"
    const doing = settledByDoing(visible.filter(r => !closed.has(r.id) && !twins.has(r.id)), records, { dayOf, same });
    const out = [];
    for (const r of visible) {
        const p = promiseOf(r, { dayOf, partAt: part, weekdayOf, timeScale });
        if (!p) continue;
        const s = stageOf(p, { today: num(timeline?.today) ?? dayOf(records.at(-1)?.pos ?? r.pos), part: timeline?.part ?? part(records.at(-1)?.pos ?? r.pos), timeScale });
        const stageStatus = { later: '排着', open: '排着', cond: '排着', eve: '到了', today: '到了', met: '到了', late: '过了时候', overdue: '过了时候', lapse: '过去了' }[s] ?? '排着';
        const today = num(timeline?.today) ?? dayOf(records.at(-1)?.pos ?? r.pos);
        let status = stageStatus, statusAt = s === 'lapse' ? (records.at(-1)?.pos ?? r.pos) : null, why = s === 'lapse' ? `按${timeScale.ordinal(today)}算的` : '';
        const close = closed.get(r.id);
        if (close) { status = close.outcome === '改了' ? '改了' : close.outcome === '没办成' ? '黄了' : close.outcome === '不做了' ? '黄了' : close.outcome === LAPSED ? '过去了' : '办了'; statusAt = close.pos; why = `${close.outcome ?? '办了'}（#${close.pos}）`; }
        else if (twins.has(r.id)) { status = '办了'; why = '跟着同一件事了结'; }
        else if (doing.has(r.id)) { status = '办了'; statusAt = doing.get(r.id).pos; why = `办了（#${doing.get(r.id).pos} 记着办的）`; }
        out.push(base({ id: `promise:${r.id}`, kind: '约定', text: r.text, who: p.doers, with: p.with, owner: p.doers[0] ?? r.holder_name ?? r.holder, when: p.due, since: r.pos, source: { type: r.type, id: r.id }, status, statusAt, why }));
    }
    return out;
}

function todoItems(records, messages, board, timeline, userName, same, boardAt = null) {
    same ??= (a, b) => a === b;
    const out = [];
    // 提问的人那会儿在不在外头：按提问那条的场面表算（有 boardAt 就用它），不按现在——昨天当面问的，今天他走了也不变成"等回音"
    const peopleAt = pos => arr((typeof boardAt === 'function' ? boardAt(pos) : null)?.people ?? board?.people);
    // 钱、约定、规矩的记录各归各的账，不再当成"要求"（试玩 10/7：一条"把修门的钱划给维修工"既是钱又是要求，一件事两个状态）
    for (const r of records.filter(x => askedOther(x) && !x.money && !x.standing)) {
        const asker = r.holder_name ?? r.holder ?? userName;
        const audience = names(r.audience).filter(n => !same(n, asker));
        const answer = r.closed_by;
        let status = answer ? '有回音' : '等着', statusAt = answer?.pos ?? null;
        const remote = peopleAt(r.pos).find(p => same(p.name, asker) && ['remote', 'away'].includes(p.status));
        if (!answer) {
            const after = messages.filter(m => (m.pos ?? 0) > r.pos);
            // 谁开的口看 name（speaker 是头像文件名）；提问的人在外头时，只认正文里叫到他的那条（发给他的消息、打给他的电话）
            const heard = after.find(m => audience.some(n => same(n, m.name ?? m.speaker)) && (!remote || textOf(m.text).includes(asker)));
            if (heard) { status = '有回音'; statusAt = heard.pos; }
            else if (expiredTodo(r, (num(timeline?.today) ?? 0) - dayAt(timeline, r.pos), scaleOf(timeline?.scale))) { status = '失效'; statusAt = num(timeline?.today) ?? null; }
        }
        out.push(base({ id: `ask:${r.id}`, kind: '要求', text: r.text, who: audience, with: audience, owner: asker, since: r.pos, source: { type: r.type, id: r.id }, status, statusAt, why: status === '有回音' ? `对方 #${statusAt} 回了` : status === '失效' ? '过了时候' : '' }));
        if (remote) out.push(base({ id: `wait:${r.id}`, kind: '等回音', text: r.text, who: [asker], with: audience, owner: asker, since: r.pos, source: { type: r.type, id: r.id }, status, statusAt, why: status === '有回音' ? `第${statusAt}条有回音` : `已等${scaleOf(timeline?.scale).span(Math.max(0, (num(timeline?.today) ?? 0) - dayAt(timeline, r.pos))).replace(' ', '')}` }));
    }
    return out;
}

function ruleItems(records, timeline) {
    const out = [];
    for (const r of records.filter(x => x?.standing)) {
        // 没写条件的规矩一直算数；写了条件的，条件对上了之后的生活现状变化、改变、了结里的中心词就失效
        const words = conditionWords(r.text);
        const later = !words.length ? null : records.filter(x => {
            if (x.pos <= r.pos || !(x.life || x.type === '改变' || x.type === '了结')) return false;
            const lifeText = typeof x.life === 'string' ? x.life : JSON.stringify(x.life ?? '');
            return hasWord(x.text, words) || hasWord(lifeText, words);
        })[0];
        // 只管那一时的（"晚点打电话时走外置信道""今晚别出门"）：过了那个时候就失效；写着以后、别再的照旧一直算数
        const today = num(timeline?.today);
        const timed = !later && !r.superseded_by && today != null && timedOut(r, today - dayAt(timeline, r.pos), scaleOf(timeline?.scale));
        // 只管那一回的规矩（"检查完了把原话发过来"）办了那一回：记账"了结"关上（用户 10/8：这类一直挂着"一直算数"）
        const done = r.closed_by && r.closed_by.kind !== '回答' ? r.closed_by : null;
        const status = done ? '办了' : r.superseded_by || later || timed ? '失效' : '排着';
        const at = done?.pos ?? r.superseded_by?.pos ?? later?.pos ?? null;
        out.push(base({ id: `rule:${r.id}`, kind: '规矩', text: r.text, who: [r.holder_name ?? r.holder], owner: r.holder_name ?? r.holder, since: r.pos, source: { type: r.type, id: r.id }, status, statusAt: at, why: done ? `办了那一回（#${done.pos}）` : later ? `${later.text}（#${later.pos}）` : r.superseded_by ? '被改掉' : timed ? '过了那个时候' : '一直算数' }));
    }
    return out;
}

function moneyItems(records, named = []) {
    const rows = records.filter(r => r.type === '钱' && r.money).sort((a, b) => a.pos - b.pos);
    const ledger = buildLedger(rows, { named });
    const out = [];
    for (const r of rows) {
        const m = r.money;
        // 报价：账本里还挂着才算排着；同两方后面定了、付了、赊了就谈完了（吓回原价的三百关掉一千八的开价）
        if (m.stage === '报价') { const open = ledger.quotes.some(x => x.id === r.id); out.push(base({ id: `money:${r.id}`, kind: '钱', text: r.text, who: [m.from], with: [m.to], owner: m.from, since: r.pos, source: { type: r.type, id: r.id }, status: open ? '排着' : '办了', why: open ? '报价' : '后来定了' })); }
        else if (m.stage === '说定') {
            // 付了就关说定：同两方、数目一样当然关；说定没写数目、或者两条说的是同一件事（去掉人名后有两字以上实词重合）也关
            // （试玩 10/6 的门："寻思等会儿把修门的钱划给维修工"没数目，下面"付了三百给修门的师傅"，账本按数目一样才关，永远关不上）
            const sameParties = x => sameParty(x.money.from, m.from, named) && sameParty(x.money.to, m.to, named);
            const sameMatter = x => sameOccasion(x.text, r.text, [m.from, m.to, x.money.from, x.money.to]);
            // 数目一样就关；数目对不上（或说定没写数目）要说的是同一件事才关——同两方之间别的一笔付款不算（买鞋的钱不因为付了外卖钱就关）
            const paid = ledger.moves.find(x => ['付了', '花了'].includes(x.money?.stage) && x.pos > r.pos
                && ((sameParties(x) && (x.money.amount === m.amount || sameMatter(x))) || (m.amount == null && samePerson(x.money.from, m.from) && sameMatter(x))));
            out.push(base({ id: `money:${r.id}`, kind: '钱', text: r.text, who: [m.from], with: [m.to], owner: m.from, since: r.pos, source: { type: r.type, id: r.id }, status: paid ? '办了' : '等着', statusAt: paid?.pos ?? null, why: paid ? `付了 ${paid.money.amount}（#${paid.pos}）` : '说定了' }));
        } else if (m.stage === '欠着') {
            const debt = ledger.debts.find(x => x.id === r.id);
            // 没写数目的欠账账本算不出还剩多少：之后同两方之间有"还了"才算还清，不然一直欠着（试玩 10/7："先赊着"被当成了还清）
            const repaid = m.amount == null ? ledger.moves.find(x => x.money?.stage === '还了' && x.pos > r.pos && sameParty(x.money.from, m.from, named) && sameParty(x.money.to, m.to, named)) : null;
            const open = debt || (m.amount == null && !repaid);
            out.push(base({ id: `money:${r.id}`, kind: '钱', text: r.text, who: [m.from], with: [m.to], owner: m.from, since: r.pos, source: { type: r.type, id: r.id }, status: open ? '等着' : '办了', statusAt: repaid?.pos ?? null, why: debt ? `欠着 ${debt.left}` : open ? '欠着（数目不明）' : '还清' }));
        }
    }
    return out;
}

function menuItems(menu) {
    const map = { waiting: '排着', pocket: '到了', offered: '递过', shown: '用上了', used: '用上了', sunk: '沉了', sunk_told: '沉了', void: '撤了', expired: '过期了' };
    // next（章程 F2，面板那一格）：沉了的给"没接会怎样"，接了的给"往后"
    const next = m => (/^sunk/.test(m.status) && ifSunkOf(m) ? { label: '没接会怎样', text: ifSunkOf(m) } : ['used', 'shown'].includes(m.status) && ifTakenOf(m) ? { label: '往后', text: ifTakenOf(m) } : null);
    return arr(menu).map(m => withNext(next(m), { id: `pocket:${m.id}`, kind: '口袋', text: m.title ?? m.surface ?? '', who: [m.goer ?? m.who].filter(Boolean), with: m.promise_ref != null ? [`promise:${m.promise_ref}`] : [], owner: m.who ?? m.goer, place: m.place, entry: entryOf(m), when: m.ready_day == null ? null : { day: m.ready_day, end: m.ready_day, part: null, cond: null, soon: false }, since: m.pocket_pos ?? m.pos ?? 0, source: { type: 'menu', id: m.id }, status: map[m.status] ?? '排着', statusAt: m.settled_pos ?? m.pocket_pos ?? null, why: m.why || m.status }));
}
const withNext = (next, fields) => (b => (next ? { ...b, next } : b))(base(fields));

function errandItems(awayPlans, board) {
    const out = [];
    for (const plan of arr(awayPlans)) for (const [i, e] of arr(plan.errands).entries()) {
        const person = plan.who ?? plan.name ?? plan.avatar;
        const p = arr(board?.people).find(x => x.name === person);
        const status = e.done === '办了' ? '办了' : e.done === '没办成' ? '黄了' : p?.status === 'present' ? '办了' : p?.stage === 'due' ? '到了' : '排着';
        out.push(base({ id: `errand:${person}:${i + 1}`, kind: '去办', text: e.text ?? e.title ?? textOf(e), who: [person], owner: person, place: e.place ?? e.where ?? null, entry: '镜头外', when: plan.span ?? null, since: e.pos ?? plan.at ?? 0, source: { type: 'away_plan', id: person }, status, why: e.done ? e.note ?? '' : p?.status === 'present' ? '已经进场' : p?.stage ?? '还在外头' }));
    }
    return out;
}

// 碰上的事（matters.mjs，用户 10/7）：后台排的事真发生了的，正文里有了着落（了结）才算办了
function matterItems(records) {
    return records.filter(r => r?.matter).map(r => base({ id: `matter:${r.id}`, kind: '碰上的事', text: r.text, who: [r.holder_name ?? r.holder], with: r.matter.menu != null ? [`pocket:${r.matter.menu}`] : [], owner: r.holder_name ?? r.holder, since: r.pos, source: { type: r.type, id: r.id }, status: settledMatter(r) ? '办了' : '排着', statusAt: settledMatter(r) ? r.closed_by.pos : null, why: settledMatter(r) ? '有了着落' : '还没下文' }));
}

// 时间结算替在外头的人写下的"要联系"（D-174 第 4 步乙）：排着等旁白递；他接上了（或被"先不"了两回）就用掉；结算那条消息删了就没这回事
// 写下以后他自己进了场（landing.enteredSince：隔离区间、进场记录）也算用掉：anchors、arrivals 不给就只认点了门
function contactItems(contacts, messages, { anchors = null, arrivals = [] } = {}) {
    const out = [];
    for (const c of arr(contacts)) {
        // 用掉那一下挂在哪条上（landing.contactUsed）：那条删了、进场后他那条回复没了，这条联系回来
        if (!c || contactUsed(c, messages, arrivals, { anchors }) || !c.fp || !messages.some(m => m.fp === c.fp)) continue;
        const way = c.way;
        if (!['消息', '电话', '上门'].includes(way) || !c.who) continue;
        out.push(base({ id: `contact:${c.who}:${c.fp}`, kind: '联系', text: c.text, who: [c.who], owner: c.who,
            entry: way === '消息' ? '消息来' : way === '电话' ? '电话来' : '找上门', source: { type: 'settled_contact', id: c.who },
            since: c.at ?? 0, status: '排着', why: way }));
    }
    return out;
}

export function foldPending(input = {}) {
    const same = input.same ?? ((a, b) => a === b);
    const records = [...(input.records ?? [])].sort((a, b) => (a.pos ?? 0) - (b.pos ?? 0));
    const items = [...promiseItems(records, input.timeline ?? {}, same), ...todoItems(records, input.messages ?? [], input.board ?? {}, input.timeline ?? {}, input.userName, same, input.boardAt ?? null), ...ruleItems(records, input.timeline ?? {}), ...moneyItems(records, input.named ?? []), ...menuItems(input.menu), ...errandItems(input.awayPlans, input.board), ...contactItems(input.contacts, input.messages ?? [], { anchors: input.anchors ?? null, arrivals: input.arrivals ?? [] }), ...matterItems(records)];
    const byId = new Map(items.map(item => [item.id, item]));
    // 同一件几处来源：口袋和约定对得上（规划者写明了跟着哪件，或题目、露面、用在和约定说的是一回事），两边互相记着对方的编号
    for (const p of items.filter(x => x.kind === '约定')) for (const row of arr(input.menu)) {
        const m = byId.get(`pocket:${row.id}`);
        if (!m) continue;
        const tied = row.promise_ref != null ? `promise:${row.promise_ref}` === p.id : relatedTo({ doers: p.who, with: p.with, r: { text: p.text } }, row, { same, byPeople: 'named' });
        if (tied) { if (!p.with.includes(m.id)) p.with.push(m.id); if (!m.with.includes(p.id)) m.with.push(p.id); }
    }
    return { items, byId };
}

const pendingCache = new Map();

// 给前台的事账读口：所有输入从同一窗口的只读状态取，失败时由调用方退回旧逻辑。
export function pendingFor(store, records, chatKey, { anchor = null, present = [], recentUser = '', timeline = null } = {}) {
    const chat = store.requireChat(chatKey);
    const all = store.currentMessages(chatKey);
    const visible = records.visible(chatKey);
    const menu = store.menuOf(chatKey);
    const messages = anchor ? (() => {
        const m = /^(\d+):(.+)$/.exec(String(anchor));
        return m && all[Number(m[1]) - 1]?.fp === m[2] ? all.slice(0, Number(m[1])) : all;
    })() : all;
    const meta = {
        // 记下的去向，加上开局单里开场不在场的人（opening.mjs）
        away: JSON.stringify(awayPlansOf(store, chatKey, { messages: all })),
        arrived: store.getMeta?.(`arrived:${chatKey}`) ?? '',
        contacts: JSON.stringify((store.getCast?.(chat.story_id) ?? []).map(c => [c.name, store.getMeta?.(`settled_contact:${chatKey}:${c.name}`) ?? ''])),
        // 他后来自己进了场，结算写的联系就作废（landing.enteredSince）：隔离区间、进场记录变了都要重算
        anchors: chat.anchors ?? '',
        arrivals: store.getMeta?.(`arrivals:${chatKey}`) ?? '',
    };
    // 版本里带上口袋各件的状态（进口袋、用上了是菜单日志变的，条数不变）
    const seqHash = createHash('sha1').update(messages.map(m => `${m.pos}:${m.fp}:${m.boardMark ?? ''}`).join('|')).digest('hex').slice(0, 16);
    const key = JSON.stringify({ chatKey, seqHash, time: [timeline?.today, timeline?.part], records: [visible.length, visible.at(-1)?.id ?? null], menu: menu.map(m => `${m.id}:${m.status}:${m.held_by ?? ''}`).join(','), meta, anchor, present, recentUser });
    if (pendingCache.has(key)) {
        const value = pendingCache.get(key); pendingCache.delete(key); pendingCache.set(key, value); return value;
    }
    const board = boardFor(store, records, chatKey, { anchor, present, recentUser, timeline });
    // 按位置取那会儿的场面表：料装一次、按位置算（以前一条一次全量重读，10/16 提速）
    const loader = boardLoader(store, records, chatKey, { present: [], recentUser: '', timeline });
    const boardAt = pos => loader.atPos(pos);
    let awayPlans = {};
    try { awayPlans = JSON.parse(meta.away) ?? {}; } catch {}
    const userName = [...messages].reverse().find(m => m.is_user)?.name ?? null;
    const rosterNames = (store.getCast?.(chat.story_id) ?? []).map(e => e.name).filter(Boolean);
    const rel = store.relationsOf?.(chat.story_id);
    const relation = rel ? normalizeRelations(rel) : null;
    const same = (a, b) => sameName(a, b, rosterNames) || (!!relation && !!personOf(relation, a, rosterNames) && personOf(relation, a, rosterNames) === personOf(relation, b, rosterNames));
    awayPlans = Object.values(awayPlans).map(p => validAwayPlan(p, messages)).filter(Boolean);
    // 结算写下的"要来联系"：按名册认人——以前有用别名记下的（试玩 10/12：等着没人接那条路写成了短名，名册里是全名，
    // 认不出"他后来自己进了场""这条用掉了"，一条早该作废的消息每轮都挂着）；同一个人有几笔，留最新那笔
    const contacts = [];
    const cast = store.getCast?.(chat.story_id) ?? [];
    const keyed = new Map();
    const prefix = `settled_contact:${chatKey}:`;
    let rows = [];
    try { rows = store.db?.prepare?.('select key, value from meta where key like ?').all(`${prefix}%`) ?? []; } catch {}
    if (!rows.length) rows = cast.map(c => ({ key: `${prefix}${c.name}`, value: store.getMeta(`${prefix}${c.name}`) })).filter(r => r.value);
    for (const r of rows) {
        const name = r.key.slice(prefix.length);
        // 同一个人在名册里有两条（用户建的全名一条、程序早先按旧卡名自动加的短名一条，试玩 10/12）：认用户建的那条
        const c = (list => (l => l.find(x => x.set_by === 'user') ?? l.find(x => Number.isFinite(x.bond)) ?? l[0] ?? list[0])(list.filter(x => x.role !== '不用')))(cast.filter(x => x.name === name || same(x.name, name)));
        if (!c) continue;
        try { const v = JSON.parse(r.value ?? 'null'); if (v && !(keyed.get(c.name)?.at > v.at)) keyed.set(c.name, { ...v, who: c.name, avatar: c.avatar ?? null }); } catch {}
    }
    contacts.push(...keyed.values());
    let anchors = null, arrivals = [];
    try { anchors = meta.anchors ? JSON.parse(meta.anchors) : null; } catch {}
    try { arrivals = JSON.parse(meta.arrivals || '[]') ?? []; } catch {}
    const value = foldPending({ records: visible, menu, awayPlans, contacts, anchors, arrivals, board, boardAt, timeline: timeline ?? {}, messages, userName, rosterNames, named: namedParties(store.getCast?.(chat.story_id) ?? [], userName), same, homes: lifeSheet(visible).homes });
    pendingCache.set(key, value);
    while (pendingCache.size > 32) pendingCache.delete(pendingCache.keys().next().value);
    return value;
}
