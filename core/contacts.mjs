// 不在场的人来联系（白皮书 §5 联系/缺席、阶段 3）：程序挑时机和人，前台用这个世界说得通的方式写出来（捎话、来信、登门……）。
// 挑谁：名册里会主动找人的（常联系、或还没出场但给了钩子的）；出场过的要隔至少一个剧情日没露面、
// 手上还挂着和在场的人有关的事（他自己知道的）。路过的、不用的不挑。
// 先后：档位（名册）＋还开着的事多少＋最近有没有来往（用户说：近期联系过、有未了的事、有共同目标、关系近的优先）。
// 多久一次：一轮最多一个；两次之间至少隔几条消息；同一个人一个剧情日最多一次（还没出场的三天一次）。
import { buildLedger, namedParties } from './money.mjs';
import { expiredTodo } from './recall.mjs';
import { roleOf, ROLE_WEIGHT } from './cast.mjs';
import { isOpenMatter, LEAD, INTENT } from './matters.mjs';

const knows = (r, name) => r.holder_name === name || (r.audience ?? []).includes(name);
const mentions = (r, names) => names.some(n => n && (r.holder_name === n || r.text.includes(n) || r.about === n
    || r.money?.from === n || r.money?.to === n));
const QUIET = new Set(['路过', '不用']);

// 每个不在场、会来找人的人：上次露面在哪、他那边还挂着哪些和在场的人有关的事。
// closenessOf(person, entry) → { score }：亲疏分（cast.closeness），给了就用它排先后，没给按档位。
// timeScale：这一局的时间尺度（章程 G2），交代过期按它（天尺度两周）
export function absentPeople({ records, messages, present, userName = null, openIdeaIds = new Set(), roster = [], closenessOf = null, maxThreads = 3, dayOf = null, timeScale = undefined }) {
    const here = new Set([...present, userName].filter(Boolean));
    const lastSpoke = new Map();
    for (const m of messages) if (!m.is_user && m.name) lastSpoke.set(m.name, m.pos);
    const lastPos = messages.at(-1)?.pos ?? 0;
    // 过期的交代（"今晚……"过了当天）不再算他那边还挂着的事（质量窗）
    const today = dayOf ? dayOf(lastPos + 0.5) : 0;
    const stale = r => (dayOf ? expiredTodo(r, today - dayOf(r.pos), timeScale) : false);
    const people = [];
    for (const [person, seenPos] of lastSpoke) {
        if (here.has(person)) continue;
        const entry = roleOf(roster, person);
        if (entry && QUIET.has(entry.role)) continue;
        const seen = records.filter(r => knows(r, person));
        const ledger = buildLedger(records, { knower: person, named: namedParties(roster, userName) });
        const openMoney = new Set([...ledger.debts, ...ledger.deals, ...ledger.quotes].map(r => r.id));
        // 碰上了、还没下文的事，他和在场的人（玩家）都知道的，也算他那边挂着的事（章程 #2：来联系得有这样的由头）
        const sharedOpen = r => isOpenMatter(r) && r.matter.kind !== LEAD && r.matter.kind !== INTENT && (r.audience ?? []).some(a => here.has(a));
        const threads = seen.filter(r => sharedOpen(r) || mentions(r, [...here])).filter(r =>
            sharedOpen(r)
            || (r.type === '想法' && openIdeaIds.has(r.id) && r.holder_name === person)
            || (r.todo && !r.closed_by && r.holder_name === person && !stale(r))
            || (r.type === '说' && r.tense === '将来' && r.holder_name === person && !stale(r))
            || openMoney.has(r.id));
        // "可能登场"的钩子说的是他第一次怎么登场（"还不知道 V 回来了""听到风声才来"）：出过场以后就不对了，不再拿它当来联系的由头、也不递给前台
        const hook = entry?.role === '可能登场' ? null : entry?.hook ?? null;
        if (!threads.length && !hook) continue;
        const role = entry?.role ?? '常联系';
        const base = closenessOf ? closenessOf(person, entry).score : ROLE_WEIGHT[role];
        const score = base + Math.min(threads.length, 3) + (lastPos - seenPos <= 60 ? 1 : 0) + (entry?.priority ? 2 : 0);
        people.push({ person, role, lastPos: seenPos, threads: threads.sort((a, b) => a.pos - b.pos).slice(-maxThreads), hook, score });
    }
    // 新面孔（D-107）：没有卡，不会在聊天里自己开口；按记账里最后一次是他说的、做的算，有挂着的事或者有"是谁"就能来联系
    for (const e of roster) {
        if (e.role !== '新面孔' || here.has(e.name) || lastSpoke.has(e.name)) continue;
        const his = records.filter(r => r.holder_name === e.name);
        const seenPos = his.length ? Math.max(...his.map(r => r.pos)) : -1;
        const threads = his.filter(r => mentions(r, [...here]) && ((r.type === '想法' && openIdeaIds.has(r.id)) || (r.todo && !r.closed_by) || (r.type === '说' && r.tense === '将来')));
        if (!threads.length && !e.hook) continue;
        const base = closenessOf ? closenessOf(e.name, e).score : ROLE_WEIGHT[e.role];
        people.push({ person: e.name, role: e.role, lastPos: seenPos, threads: threads.sort((a, b) => a.pos - b.pos).slice(-maxThreads), hook: e.hook, score: base + Math.min(threads.length, 3) + (lastPos - seenPos <= 60 && seenPos >= 0 ? 1 : 0) + (e.priority ? 2 : 0) });
    }
    // 还没在这个窗口出场、名册里给了钩子的
    for (const e of roster) {
        if (e.role !== '可能登场' || !e.hook || lastSpoke.has(e.name) || here.has(e.name)) continue;
        people.push({ person: e.name, role: e.role, lastPos: -1, threads: [], hook: e.hook, score: (closenessOf ? closenessOf(e.name, e).score : ROLE_WEIGHT[e.role]) + (e.priority ? 2 : 0) });
    }
    return people.sort((a, b) => b.score - a.score || (b.threads.at(-1)?.pos ?? -1) - (a.threads.at(-1)?.pos ?? -1));
}

// 这一轮要不要递一个联系机会、递谁。dayOf：消息位置 → 第几天；offers：这个窗口以前递过的 [{person, day, at}]（at＝当时的消息条数）。
export function pickContact({ people, dayOf, lastPos, offers = [], minGap = 16 }) {
    const today = dayOf(lastPos);
    const last = offers.reduce((m, o) => Math.max(m, o.at), -Infinity);
    if (lastPos - last < minGap) return null;
    const rested = p => {
        const every = p.lastPos < 0 ? 3 : 1;
        return !offers.some(o => o.person === p.person && today - o.day < every);
    };
    return people.find(p => (p.lastPos < 0 ? today >= 1 : today - dayOf(p.lastPos) >= 1) && rested(p)) ?? null;
}

export function contactLines(pick, { when, lastSeen }) {
    const p = pick.person;
    if (pick.lastPos < 0) return [
        '此刻可以有这件事（用不用、怎么用由你定）：',
        `· ${p}还没在这个故事里出现过。${pick.hook}`,
        `· 要写的话，写成${p}捎来话、来信或者找上门（用这个世界里说得通的方式）；${p}只知道外面传开的消息和自己的经历，这个故事里之前发生的事${p}都不在场。`,
    ];
    return [
        '此刻可以有这件事（用不用、怎么用由你定）：',
        `· ${p}有一阵没露面了（上次是${lastSeen}）。${pick.threads.length ? `${p}那边还挂着和在场的人有关的事：` : ''}`,
        ...pick.threads.map(r => `  · ${when(r)}：${r.text}`),
        ...(pick.hook ? [`  · ${pick.hook}`] : []),
        `· 要写的话，写成${p}捎来话、来信或者找上门（用这个世界里说得通的方式）；${p}只知道自己经历过、听说过的事。`,
    ];
}
