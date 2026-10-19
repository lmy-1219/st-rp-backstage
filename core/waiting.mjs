// 门上等着没人接的（用户 10/9："如果我一直不接来电不回消息，他是不是该直接找上来"；约他的人今天正好也在那个地方，
// 两人约好的见面"有没有可能顺便提前到眼下"）：不在场的有卡的人找过玩家（他发来的消息、打来的电话、结算写的要联系），挂在门上一直没人点——
// 换了时段、或者隔了 WAIT_MSGS 条还没接，替他结算一次（main.settleAway，便宜那档，一次一两美分）：再发一条、改打电话、直接找上门、
// 先放下、还等，照他这个人和事情急不急定。同一回等着至多算 MAX_TRIES 次。
// 找上门照旧挂在门上，旁白写到他出现那一刻停，玩家点了才进场（D-175）。他要去的地方约他的人正好在，可以顺便把约好的事提前到眼下：
// 进场时给那人排一件"人都来了"（main.arrive），挂在他那条回复上。
// 删消息就等于没发生过：开始等的那一刻、每回结算都挂在那时玩家最近说的那条上（场记章程第二节第 10 条：挂在模型那条上，
// 玩家一重生成指纹就变了，这一回丢了、下次折又算一回），那条删了就不算（删回去重新算）。
// 只在他真不在场时算：从等的那条起他自己进了场（打来电话、人到了，landing.enteredSince），这一回等就结束了。题材无关。
import { partsBetween } from './arrival.mjs';
import { PARTS } from './timeline.mjs';

export const WAIT_MSGS = 12;
export const MAX_TRIES = 3;
const ATTEMPT = new Set(['pocket', 'contact']);   // 门上那一项是他主动来找的：他牵头的口袋、结算写的要联系

const alive = (messages, at) => !!at && messages[at.pos]?.fp === at.fp;
// 这一回挂在哪条上：眼下这条之前（含）玩家最近说的那条，不早于 floor；没有就挂在眼下这条
function mark(messages, floor = 0) {
    const last = messages.at(-1);
    for (let i = messages.length - 1; i >= 0 && messages[i].pos >= floor; i--) if (messages[i].is_user) return { pos: messages[i].pos, fp: messages[i].fp };
    return { pos: last.pos, fp: last.fp };
}

// prev：上回记下的 { 名字: { since, tries: [{pos, fp}] } }；door：门的名单（doorAt 的 items，一人一项）；rowAt(pos)→{day, part}；
// entered(who, pos, item)：他在 pos 那条以后自己进过场没有（不给就当没有）。
// 返回 next（存回去的）、due（这回该替他结算的：{ who, avatar, item, since, n, at }，at 是这一回挂的那条）。
// parts：这一局一格里分哪几段（timeline 的 parts；不给就是一天八段）
export function stepWaits({ prev = {}, door = [], messages = [], rowAt = () => ({}), entered = () => false, parts = PARTS }) {
    const last = messages.at(-1);
    if (!last) return { next: {}, due: [] };
    const next = {}, due = [];
    for (const item of door) {
        if (!item?.who || !ATTEMPT.has(item.source?.type)) continue;
        const w = prev[item.who];
        // 从哪条起等：上回记下的还在就照旧；没有就从门上那一项挂上的那条算（他发来、结算写下联系那条），找不到才从眼下算
        const start = Number.isInteger(item.at) && messages[item.at] ? { pos: item.at, fp: messages[item.at].fp } : mark(messages);
        // 从门上这一项挂上以后他自己进了场：这一项过时了，不再等（门上本该已经收起，这里再拦一道）
        if (entered(item.who, start.pos, item)) continue;
        // 上回记下的起点以后进过场（又走了、门上换成了新的一项）：从新的这一项起重新等
        const since = alive(messages, w?.since) && !entered(item.who, w.since.pos, item) ? w.since : start;
        const tries = (w?.tries ?? []).filter(t => alive(messages, t) && t.pos >= since.pos);
        const from = tries.at(-1) ?? since;
        const waited = last.pos - from.pos >= WAIT_MSGS || partsBetween(rowAt(from.pos), rowAt(last.pos), parts) >= 1;
        if (waited && tries.length < MAX_TRIES) {
            const at = mark(messages, since.pos);
            // 玩家那条上已经算过这一回（模型那条重生成了、或者后面只多了模型的话）：不再算
            if (!tries.some(t => t.pos === at.pos && t.fp === at.fp)) {
                tries.push(at);
                due.push({ who: item.who, avatar: item.avatar ?? null, item, since, n: tries.length, at });
            }
        }
        next[item.who] = { since, tries };
    }
    return { next, due };
}

// 结算没调通：这回不算（at：stepWaits 给的 due.at，玩家那条）
export function dropTry(waits, who, at) {
    const w = waits?.[who];
    if (!w) return waits;
    return { ...waits, [who]: { ...w, tries: (w.tries ?? []).filter(t => !(t.pos === at.pos && t.fp === at.fp)) } };
}

// 给结算的那一句：他怎么找的、找的什么事（门上那一项的原话），等了多久
export function unansweredLine(d, { userName = '玩家', span = '' } = {}) {
    const how = d.item?.label === '来电' || /电话|来电|呼叫/.test(d.item?.reason ?? '') ? '打来电话' : d.item?.label === '上门' ? '找上门' : '发来消息';
    return { text: `${d.who}${how}找过${userName}，${userName}一直没接：${String(d.item?.reason || d.item?.label || '').slice(0, 160)}`, elapsed: span || '有一阵了', n: d.n, how };
}

// 他和别人约好、还没办的：给结算看的几行，和对得上原文的那几件（结算交回"顺带·约定"时按原文找回是哪件）。
// 只要有第三个人的（他和玩家两个人之间的小约定不在这儿：要的是"他找过去、约他的那人正好也在"）；
// 别人去向里写着等他、约了他的（试玩 10/9：约他明晚去包厢那件记在约他那人的去向里，不在事账的约定里），也算一件。
export function promisesFor(items = [], { who, userName = '玩家', same = (a, b) => a === b, plans = [] } = {}) {
    const fromLedger = items.filter(p => p.kind === '约定' && ['排着', '到了'].includes(p.status) && [...(p.who ?? []), ...(p.with ?? [])].some(n => same(n, who)))
        .map(p => ({ id: p.source?.id ?? null, text: String(p.text ?? '').slice(0, 160), parties: [...(p.who ?? []), ...(p.with ?? [])].filter(n => !/^[a-z]+:/.test(n) && !same(n, who) && !same(n, userName)) }));   // pocket:12 这类是事账里互相标的编号，不是人
    const fromPlans = plans.filter(p => p?.who && !same(p.who, who)).flatMap(p => [p.doing, ...(p.errands ?? []).map(e => e?.text ?? e)].filter(t => t && String(t).includes(who)).map(t => ({ id: null, text: `${p.who}：${String(t).slice(0, 150)}`, parties: [p.who] })));
    return [...fromLedger, ...fromPlans].filter(p => p.text && p.parties.length);
}
// 玩家此刻在哪：这一天里、上一回"在路上"以后记过的地方（头一处是那个地方，最后一处是在里面哪儿）；没有就用场面表认的
export function placeNow(notes = [], { lastPos = 0, sameDay = () => true, fallback = '' } = {}) {
    const spots = notes.filter(n => n.who === '此地' && n.aspect === '地方' && n.pos <= lastPos && lastPos - n.pos <= 40 && sameDay(n.pos)).sort((a, b) => a.pos - b.pos);
    const here = spots.slice(spots.findLastIndex(n => /路上|往.{1,12}去|出了|离开/.test(n.text)) + 1).map(n => n.text);
    if (!here.length) return fallback;
    return here.length > 1 && here.at(-1) !== here[0] ? `${here[0]}（${here.at(-1)}）` : here[0];
}
// 结算交回的"顺带·约定"是哪一件：原文一样、或者一个包着另一个
export function pullOf(pull, promises = []) {
    if (!pull?.promise) return null;
    const t = String(pull.promise).replace(/\s+/g, '');
    const hit = promises.find(p => { const x = p.text.replace(/\s+/g, ''); return x === t || x.includes(t) || t.includes(x); });
    return hit && hit.parties.length ? { promiseRef: hit.id, text: hit.text, with: hit.parties[0], surface: pull.surface, respond: pull.respond } : null;
}
