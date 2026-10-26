import { personWord } from './pronoun.mjs';
// 主角团的打算（用户 10/12，N-363／N-365；方案 收尾与聚焦 第四节、方案 主角团规划 第二节 4）：
// 用户："角色是活的，有问题自己找办法；规划里那些事没有角色行为，角色没有自己想干的事、没有驱动，和没后台的时候一样。"
// 规划交回的"主角团这一段"（plans.node 的 主角团：谁、想干、下一步、拉她、为她、团里）递到本人身上：
//   · 轮到主角团里的人开口，他那一格带一句他这阵子自己的打算（他自己的事：场面闲了会去办、会提起，不用每轮都提）；
//   · 她眼下有难处（body.herTrouble），再带"会为她做什么——去做，别光说"（关心不是当爹、不是保姆）；
//   · 团里两人这一段之间会出的事（争吵、玩闹、较劲……），对方此刻在场才给；
//   · 他不在场时，换时段的那次结算按他的打算往前推一步（main.settleOnce），每人每格时间至多一次，落成他自己的一条记录，下次露面那一格里带着。
// 都是程序拼的，不调模型；不写题材（D-37）。
// 他心里的打算（用户 10/12，N-368；方案 角色有心思 第四节 3、4）：规划给主角团每人（和至多两个要紧的人）写了"心思"——想要、出发点、打算、瞒着、到哪为止，
// 只私下递给本人（他开口时），别人那一格、旁白那一格都没有；"被识破了"那一格不递（留给规划和后续）。递之前过一道换词（tone.mjs）。
import * as setupAll from './setup.mjs';
import { warmWords } from './tone.mjs';

const tidy = x => String(x ?? '').trim().replace(/[。．.；;，,\s]+$/, '');

// 谁是主角团（K 约定第 7 条）：开局单"主角团"那一格（名字，含玩家的角色）；没填就用最近一份规划"主角团"里出现的名字，加上玩家。
// 开局单那一格和 crewOf 由另一张单在 setup.mjs 里加；那边有就用那边的，没有就用这份同签名的
export function crewFallback(setupData, lastPlanNode, userName) {
    const own = (Array.isArray(setupData?.主角团) ? setupData.主角团 : []).map(tidy).filter(Boolean);
    const fromPlan = (Array.isArray(lastPlanNode?.主角团) ? lastPlanNode.主角团 : []).map(x => tidy(x?.谁)).filter(Boolean);
    return [...new Set([...(own.length ? own : fromPlan), tidy(userName)].filter(Boolean))];
}
export function crewOf(setupData, lastPlanNode, userName) {
    const fn = typeof setupAll.crewOf === 'function' ? setupAll.crewOf : crewFallback;
    const out = fn(setupData, lastPlanNode, userName);
    return Array.isArray(out) ? out : [];
}

// 规划的节点（plans.node 存的 JSON）；读不出就 null
export function planNode(plan) {
    try { const v = JSON.parse(plan?.node ?? 'null'); return v && typeof v === 'object' ? v : null; } catch { return null; }
}
// 这个窗口最新的一份规划和它的节点
export function latestNode(store, chatKey) {
    const plan = store.lastReadyPlan?.(chatKey) ?? (store.readyPlans?.(chatKey) ?? []).at(-1) ?? null;
    return { plan, node: planNode(plan) };
}
// 他那一份（主角团里"谁"是他的那一项）
export function crewEntry(node, who, same = (a, b) => a === b) {
    if (!who) return null;
    return (Array.isArray(node?.主角团) ? node.主角团 : []).find(x => x && typeof x === 'object' && tidy(x.谁) && same(tidy(x.谁), who)) ?? null;
}

// 要紧的人（不在主角团里、规划另写了心思的，至多两个）里他那一项
export function keyPersonEntry(node, who, same = (a, b) => a === b) {
    if (!who) return null;
    return (Array.isArray(node?.要紧的人) ? node.要紧的人 : []).find(x => x && typeof x === 'object' && tidy(x.谁) && same(tidy(x.谁), who)) ?? null;
}

// 他心里想的那一句（只给他本人）。用户 10/12：自己人的心思一写成"利用、拿捏"一类，前台就把他演成反派——所以整句过 warmWords；
// 心思是他手上的料；到哪为止只留在规划，不拼到前台。keep：说她伤病的那一截拿掉（body 的守门）。
// 没到时间点的不递（T073，用户 10/25："提前泄露认知和所有事全让前台在一轮里丢出来都玩得很难受"）：规划写的"打算"那截常带具体日子和步骤
// （"第 5 天一早……"），前台拿到就一轮说完——只递"想……，因为……"；打算、先别让人知道留在规划（他出手的那几拍照样落成事件，到点了才到前台）。
// 小心思（示弱、激将一类）的手法本来就只在"打算"里，这下一律不递，出发点空着也只有"想……"
export function mindLine(mind, { keep = () => true } = {}) {
    if (!mind || typeof mind !== 'object') return null;
    const want = tidy(mind.想要).replace(/^想要?/, ''), why = tidy(mind.出发点).replace(/^因为/, '');
    const body = [want && `想${want}`, why && `因为${why}`].filter(Boolean).join('，');
    if (!body) return null;
    const line = warmWords(`你心里的打算（你自己的事，别说破）：${body}`);
    return keep(line) ? line : null;
}

// 镜头外他按打算办到哪的那条记录（main.settleOnce 记）：开头是这一句，认它用
export const pushHead = who => `${who}这段时间照自己的打算`;
export function pushText(who, entry, { result = '', note = '' } = {}) {
    const step = tidy(entry?.下一步) || tidy(entry?.想干);
    return `${pushHead(who)}去办${step ? `（${step}）` : ''}：${[tidy(result), tidy(note)].filter(Boolean).join('——')}`.slice(0, 240);
}
// 他最近一回按打算办到哪（since 之后记的；一般是最新一份规划挂的那条之后）
export function pushedText(visible = [], { name, same = (a, b) => a === b, since = -1 } = {}) {
    const r = visible.filter(x => x && x.type === '做' && x.job_id == null && same(x.holder_name, name) && String(x.text ?? '').startsWith(pushHead(x.holder_name)) && (x.pos ?? -1) >= since).at(-1);
    return r ? String(r.text) : null;
}

// 他那一格里的那一块。name：开口的人；userName：玩家；entry：他那一份；present：眼下在场的人；trouble：她眼下有难处；
// keep(一截)：说她伤病的那一截拿掉（body 的守门，bodyGuard.lines）——"为她"那一句只在她有难处时给，不过守门；pushed：上面那条记录的正文。
// 返回 own（他自己的打算、她有难时、镜头外办到哪）和 team（团里两人之间的，对方在场才给）
export function crewLines({ name, userName = null, entry = null, present = [], trouble = false, same = (a, b) => a === b, keep = () => true, pushed = null } = {}) {
    if (!name || !entry || (userName && same(name, userName))) return { own: [], team: [] };
    const her = userName ?? '玩家的角色';
    // 只给"想办成"（T073）：接下来想做（下一步）、想拉她一起（拉她）是具体步骤，前台拿到就一轮说完；镜头外推一步照旧读下一步，办过了的由 pushed 那句带到前台
    const segs = [['想办成', tidy(entry.想干)]].filter(([, v]) => v).map(([k, v]) => `${k}——${v}`).filter(s => keep(s));
    const own = [];
    if (segs.length) own.push(`${name}这阵子自己想办成的事（${personWord(name)}自己的事：心里惦记着，场面合适了自然会去办、会提起，不用每轮都提）：${segs.join('；')}`);
    // 心思跟在"这阵子自己想办成的事"后面（数据约定第 2、3 条）
    const mind = mindLine(entry.心思, { keep });
    if (mind) own.push(mind);
    if (trouble && tidy(entry.为她)) own.push(`${her}这会儿有难处：${tidy(entry.为她)}——去做，别光说。`);
    if (pushed) own.push(`（${String(pushed).replace(/[。．.]+$/, '')}——这是${personWord(name)}自己办的事，见了面提不提、说几分由${personWord(name)}）`);
    const team = (Array.isArray(entry.团里) ? entry.团里 : [])
        .filter(x => x && tidy(x.跟谁) && tidy(x.什么) && !same(tidy(x.跟谁), name) && present.some(p => p && same(p, tidy(x.跟谁))))
        .map(x => `这一段你和${tidy(x.跟谁)}之间：${tidy(x.什么)}（遇上了自然带出来，别硬凑）`).filter(l => keep(l));
    // 规划写的打算、团里的事也是递给前台的私下话：同样过一道换词（库里的原文不动）
    return { own: own.map(warmWords), team: team.map(warmWords) };
}

// 镜头外接着办该不该跑（advanceWorld ⑥ 和 main.settleOnce 都用）：他是主角团的人（不是玩家）、最新一份规划里有他的"下一步"、
// 这一格时间里还没替他按打算推过（pushed＝meta 里记的上一回 { day, pos, fp }；那条消息删了就不算推过）。每人每格至多一次，别多花钱
export function crewPushDue({ who, userName = null, crew = [], entry = null, pushed = null, today = 0, messages = [], same = (a, b) => a === b } = {}) {
    if (!who || (userName && same(who, userName))) return false;
    if (!(crew ?? []).some(n => n && same(n, who))) return false;
    if (!tidy(entry?.下一步)) return false;
    const valid = !!pushed && messages.some(m => m.pos === pushed.pos && m.fp === pushed.fp);
    return !(valid && Number(pushed.day) >= today);
}
export const pushKey = (chatKey, who) => `crew_pushed:${chatKey}:${who}`;
export function pushedMeta(store, chatKey, who) {
    try { return JSON.parse(store.getMeta?.(pushKey(chatKey, who)) ?? 'null'); } catch { return null; }
}
