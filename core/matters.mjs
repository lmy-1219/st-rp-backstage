import { personWord } from './pronoun.mjs';
// 碰上的事（用户 10/7："口袋递出来了，但没成为一件可以被解决/处理的事……只要提起了就可以追查/解决/找源头，而不是出来了就结束了。
// ……后面再问，他可以隐瞒不说但不该不出现在场记里"）：
// 后台排的事真发生了——拿出来了、交出去了、镜头外他自己碰上了——就记成一件"碰上的事"：挂在发生的那条消息上（删了就没这回事），
// 谁知道照当时谁在场（镜头外的只有他自己）。只有他知道的（聊天里没有）：这几天他每次开口都带着；当着玩家发生的聊天里本来就有，
// 玩家这句说到了才带（每轮都带，前台会一遍遍把早就了了的事再拎出来，试玩 10/7 那锅汤）。提不提、瞒不瞒由他，但它在。
// 正文里有了着落（记账"了结"：解决了、弄清了、放下了）就不再带——它还是一段记忆，问起照样想得起。
// 规划写了"来由"（这件事背后是怎么回事）：有人追查时交给镜头一截；规划看得见还没下文的这些，好排后续。
// 局势传到主角这边的消息也算一件（situation.deliverDue 记的时候就标上）。
import { entryOf, reachedFor, weakPair, WORLD, ifSunkOf, ifTakenOf } from './planner.mjs';
import { plainOf } from './promises.mjs';

export const MATTER_FRESH_DAYS = 3;   // 只有他知道的，这几天里他每次开口都带着
const MATTER_MAX = 4, FRESH_MAX = 3, HIT_MAX = 3;
// 头一回启用时只补最近这几条里的（更早拿出来的多半早在正文里了了，补成"还没下文"会把了了的事又拎出来）
const BACKFILL = 10;
const SENSE_HIT = 0.2;
const SETTLED = new Set(['shown', 'used']);
const REMOTE_WAY = /电话|消息|来电|短讯|短信/;
// 有人在追：问为什么、去查、打听来路
export const PURSUE = /查|打听|问问|怎么回事|为什么|为啥|凭什么|谁干的|谁搞的|谁弄的|谁让|源头|弄清|搞清|找出|追究|底细|来路|来历|原因|搞什么鬼/;

// 记成"碰上的事"时的检索词：标题、在哪、用在什么场合、露面、应答、知情里的实词，加上它跟着的那件约定（规划写的标题常是"扫不出来的人"这种，
// 被问起"中介""房子"时对不上；试玩 10/7：她问"你租房子的事怎么说"，那件写的是"公寓中介"，没认出是在说它——"房子"在知情和约定里）
export function matterKeys(m, extra = []) {
    const pieces = [m.fit, m.surface, m.respond, m.know, ...extra].map(x => String(x ?? '')).join(' ').split(/[\s，。、；：！？「」“”‘’（）()…—·,.;:!?a-zA-Z0-9]+|[的了着在把对给被让向从跟和与就也都还又再很他她它们说事]/).map(x => x.trim()).filter(x => x.length >= 2 && x.length <= 12);
    return [...new Set([m.title, m.place, m.motif, ...pieces].filter(x => typeof x === 'string' && x.length >= 2 && !weakPair(x)))].slice(0, 16);
}

export const settledMatter = r => !!r?.closed_by && !r.closed_by.kind;   // 了结关上的（回答、证实带着 kind，不算）
// 他真把这件事讲出来了：这件事（题、经过）和他说的那句，去掉人名后有三处以上两字实词对得上——只碰到一个人名、地名不算
const solid = (t, names) => { const out = new Set(); for (const run of plainOf(t, names.filter(Boolean)).match(/[一-鿿]{2,}/g) ?? []) for (let i = 0; i < run.length - 1; i++) { const g = run.slice(i, i + 2); if (!weakPair(g)) out.add(g); } return out; };
export function toldOf(r, text, names = []) {
    const a = solid(`${r.matter?.title ?? ''} ${r.text}`, names), b = solid(text, names);
    let n = 0;
    for (const g of a) if (b.has(g)) n++;
    return n >= 3;
}
export const isOpenMatter = r => !!r?.matter && !settledMatter(r) && !r.superseded_by;
// 牵头的人自己那一份（用户 10/8：她打电话叫 V 一个人来、别带顶着他脸的那个人，V 到了她却不知道他回来了）：
// 事情是他牵头做的，他人又不在那儿（电话是别人接的、露面是旁白写的）——他做过、说过的，接着要做的，那时他知道的，记成他自己的一件
export const LEAD = '牵头';
// 来意（场记章程第二节第 6 条、B2）：进场时替他理出的"这回来是为了什么"，是他手上还没说出口的事——不是一次性的记忆，
// 留在他的场记里，直到正文里他说了、办了（记账"了结"），或者他离场（closeIntents）。只他知道；他开口一次不算办过（和牵头的不同）
export const INTENT = '来意';
// 没人接（章程 F2）：他排的事一直没人接、沉了——他心里记一笔（只他知道，挂在沉底那条上，删了就没这回事）；
// 这几天他开口都带着（进场也带着），提不提、怎么提由他；正文里有了着落（记账了结）就不再带
export const MISSED = '没人接';
// 只记给他自己、不因为他提起过就算别人知道的那几种（牵头的、来意、没人接）
const PRIVATE = new Set([LEAD, INTENT, MISSED]);
const knows = (r, name, same) => same(r.holder_name, name) || (r.audience ?? []).some(a => same(a, name));

// 进场时那条来由记录（main.arrive 用；挂在他那条回复上，landing.relinkArrivals 跟着挪，删了就没这回事）
export function intentRecord({ storyId, fp, who, how = '', why, holder = null }) {
    const reason = String(why ?? '').trim();
    return { storyId, fp, type: '心里', text: `${who}来这儿${how ? `（${how}）` : ''}：${reason}`.slice(0, 200), holder: holder ?? `name:${who}`, holderName: who, audience: [who],
        keys: matterKeys({ surface: reason }), matter: { kind: INTENT, title: reason.slice(0, 40), who } };
}

// 他离场了（main.leave、隔离区间关上）：这回的来意跟着过去——记一笔"了结"挂在眼下这条上（删回去就回来）。返回关掉的那几条
// before：只收记在这条（含）以前的（每次折时补收用：他上一回在场的区间关在哪，那以前记下的来意都过去了；之后才记的是这回还没进来的）
export function closeIntents({ records, chatKey, storyId, who, fp, same = (a, b) => a === b, before = Infinity }) {
    if (!records?.addDerived || !fp) return [];
    const open = records.visible(chatKey).filter(r => isOpenMatter(r) && r.matter.kind === INTENT && same(r.holder_name, who) && !(r.pos > before));
    for (const r of open) records.addDerived({ storyId, fp, type: '了结', ideaRef: r.id, outcome: '过去了', text: `${who}离场了，这回的来意就过去了：${r.matter.title}`.slice(0, 200), holder: r.holder, holderName: r.holder_name, audience: r.audience ?? [who] });
    return open.map(r => r.id);
}

// 玩家这句说没说到它：题和那一句里的实词对上两个；或者检索词对上一个（三个字以上的认中心词："正规公寓中介"认"中介"，"好房子"认"房子"）
export function talksOf(r, text) {
    const t = String(text ?? '');
    if (!t.trim() || !r) return false;
    if (reachedFor({ title: r.matter?.title ?? '', surface: r.text }, t)) return true;
    return (r.keys ?? []).some(k => typeof k === 'string' && k.length >= 2 && ((!weakPair(k) && t.includes(k)) || (k.length >= 3 && !weakPair(k.slice(-2)) && t.includes(k.slice(-2)))));
}

// 折一次时（slot.advanceWorld）：真发生过、还没记成"碰上的事"的那几件补记上。幂等：按口袋编号认，记过的（了结了的也算）不再记。
// presentAt(pos)：那条消息时在场的人（场面表）；holderOf(name)：记录的主人（有卡的用头像）；player：玩家的几个叫法
// camera：镜头那张卡的名字——它写了这件事，但它不是人，不算知道的人
// placeAt(pos)：那条消息时镜头在哪（场面表）
// remoteAt(pos)：那条消息时隔着电话、消息的人（场面表的 remote；场记章程第 2 条）——他看不见玩家屏幕上的、身边的，不算碰上了；
// 他自己把它拿出来的（settled_by 是他）照样算他知道
// arrivedAt(pos, 名字)：他是不是从这条之后进的场——是就返回进场记录里"怎么来的"（电话、消息、上门……，没写是空串），不是返回 null。
// 他牵头的消息、电话类口袋在他当面进场那一下用掉（场记章程第 11 条，试玩 10/10）：那条消息没发出去过，人直接来了——
// 不记成"他发来过消息"的牵头，改记成他这回的来意（只他知道；说了、办了由记账了结，离场就过去了）
export function settleMatters({ store, records, chatKey, storyId, messages, presentAt = () => [], remoteAt = () => [], placeAt = () => null, arrivedAt = () => null, holderOf = n => `name:${n}`, userName = null, player = [], camera = null, same = (a, b) => a === b }) {
    if (!records?.addDerived) return [];
    // 从启用那一刻起算：那时菜单日志走到哪、最后一条在哪；之后拿出来、交出去的才记（删回去重来的也算之后）
    let since = null;
    try { since = JSON.parse(store.getMeta?.(`matters_since:${chatKey}`) ?? 'null'); } catch {}
    if (!since && store.menuLogMax) {
        since = { log: store.menuLogMax(), pos: (messages.at(-1)?.pos ?? 0) - BACKFILL };
        store.setMeta?.(`matters_since:${chatKey}`, JSON.stringify(since));
    }
    const after = since && store.settledSince ? store.settledSince(since.log) : null;
    const items = store.menuOf?.(chatKey) ?? [];
    const all = records.visible(chatKey, { all: true });
    const promiseText = m => (m.promise_ref != null ? all.find(r => r.id === m.promise_ref)?.text ?? '' : '');
    // 已经记下、还开着的：检索词照现在的算法补齐（早先记的少了知情、约定里的词）
    if (records.setKeys) for (const r of all.filter(isOpenMatter)) {
        const m = items.find(x => x.id === r.matter.menu);
        const keys = m ? matterKeys(m, [promiseText(m)]) : null;
        if (keys && keys.some(k => !(r.keys ?? []).includes(k))) records.setKeys(r.id, [...new Set([...(r.keys ?? []), ...keys])].slice(0, 20));
    }
    const made = [];
    // 沉了（章程 F2）：牵头的人心里记一笔"他排的事没人接：没接会怎样"，挂在沉底那条上。玩家牵头的、"世界"牵头的不记；过期的（时机过了）不是沉底，不记
    for (const m of items.filter(m => /^sunk/.test(m.status) && Number.isFinite(m.settled_pos) && (!since || m.settled_pos >= since.pos))) {
        if (m.who === WORLD || player.includes(m.who) || m.who === camera || !m.who) continue;
        if (all.some(r => r.matter?.menu === m.id && r.matter.kind === MISSED)) continue;
        const at = messages.find(x => x.pos === m.settled_pos);
        if (!at) continue;
        const what = ifSunkOf(m).replace(/[。．.]+$/, '');
        const id = records.addDerived({ storyId, fp: at.fp, type: '心里', text: `${m.who}排的「${m.title ?? ''}」没人接${what ? `：${what}` : ''}`.slice(0, 300),
            holder: holderOf(m.who), holderName: m.who, audience: [m.who], about: m.who, keys: matterKeys(m, [promiseText(m)]),
            matter: { menu: m.id, title: m.title ?? '', entry: entryOf(m), who: m.who, kind: MISSED } });
        made.push({ id, menu: m.id, pos: at.pos, holderName: m.who, audience: [m.who], missed: true });
    }
    const menu = items.filter(m => SETTLED.has(m.status) && Number.isFinite(m.settled_pos) && (!since || m.settled_pos >= since.pos || after?.has(m.id)));
    if (!menu.length) return made;
    const have = new Set(all.filter(r => r.matter?.menu != null && r.matter.kind !== LEAD).map(r => r.matter.menu));
    const led = new Set(all.filter(r => r.matter?.kind === LEAD).map(r => r.matter.menu));
    for (const m of menu) {
        const at = messages.find(x => x.pos === m.settled_pos);
        if (!at) continue;
        const isPlayer = player.includes(m.who);
        // 镜头外：发生在牵头的人身上、玩家不在的时候——只有他知道
        const own = entryOf(m) === '镜头外' && m.who !== WORLD && !isPlayer;
        const by = m.settled_by && m.settled_by !== '程序' && m.settled_by !== camera ? m.settled_by : null;
        // 那条时在场的人，加上把它拿出来的那个人（镜头不算）
        const far = new Set(own ? [] : remoteAt(at.pos) ?? []);
        const here = own ? [] : [...new Set([...presentAt(at.pos).filter(n => !far.has(n)), by].filter(n => n && n !== camera))];
        const lead = m.who === WORLD || isPlayer ? null : m.who;
        // 他自己当面进场那一下用掉的（进场记录不是电话、消息，那一刻他也不在电话那头）：记成他的来意，不记"牵头"、也不替旁人记"碰上了"——
        // 那条消息没发生过，这件事还在他嘴里没说；说出来以后记账会记
        if (lead && !own && m.status === 'used' && m.settled_by && same(m.settled_by, lead)) {
            const how = arrivedAt(at.pos, lead);
            if (how != null && !REMOTE_WAY.test(how) && !(remoteAt(at.pos + 1) ?? []).some(n => same(n, lead))) {
                if (!all.some(r => r.matter?.menu === m.id && r.matter.kind === INTENT)) {
                    const know = String(m.know ?? '').trim().replace(/[。．.]+$/, '');
                    const said = String(m.respond || m.surface || m.title || '').trim().replace(/[。．.]+$/, '');
                    const id = records.addDerived({ storyId, fp: at.fp, type: '心里', text: `${lead}本来要跟${userName ?? '对方'}说的：${said}${know ? `（那时${lead}知道：${know}）` : ''}`.slice(0, 300),
                        holder: holderOf(lead), holderName: lead, audience: [lead], about: lead, keys: matterKeys(m, [promiseText(m)]),
                        matter: { menu: m.id, title: m.title ?? '', entry: entryOf(m), who: m.who, kind: INTENT, ...(m.origin ? { origin: m.origin } : {}) } });
                    made.push({ id, menu: m.id, pos: at.pos, holderName: lead, audience: [lead], intent: true });
                }
                have.add(m.id);
                led.add(m.id);
                continue;
            }
        }
        // 牵头的人那一份：他不在那儿——他做过的、说过的、接着要做的、那时知道的，记成他自己的一件（只他知道，有了着落才了结）；
        // 他就在那儿——事情他当面做了，大家都看见了，只把他那时心里知道的记给他
        if (lead && !own) {
            const know = String(m.know ?? '').trim().replace(/[。．.]+$/, '');
            const where = m.place || placeAt(at.pos) || '';
            const at_ = where ? `（这是在${where}那会儿）` : '';
            if (!here.includes(lead) && !led.has(m.id)) {
                const text = `${lead}牵头的「${m.title}」：${m.surface ?? ''}${m.respond ? `——${m.respond}` : ''}${know ? `（那时${lead}知道：${know}）` : ''}${at_}`.slice(0, 440);
                const id = records.addDerived({ storyId, fp: at.fp, type: '做', text, holder: holderOf(lead), holderName: lead, audience: [lead], about: lead, keys: matterKeys(m, [promiseText(m)]),
                    matter: { menu: m.id, title: m.title ?? '', entry: entryOf(m), who: m.who, kind: LEAD, ...(m.origin ? { origin: m.origin } : {}) } });
                led.add(m.id);
                made.push({ id, menu: m.id, pos: at.pos, holderName: lead, audience: [lead], lead: true });
            } else if (here.includes(lead) && know) {
                const head = `${lead}那时知道的（「${m.title}」${where ? `，在${where}那会儿` : ''}）：`;
                if (!all.some(r => r.holder_name === lead && String(r.text ?? '').startsWith(head))) records.addDerived({ storyId, fp: at.fp, type: '心里', text: `${head}${know}`.slice(0, 300), holder: holderOf(lead), holderName: lead, audience: [lead], about: lead, keys: matterKeys(m, []) });
            }
        }
        if (have.has(m.id)) continue;
        const holderName = own ? m.who : lead && here.includes(lead) ? lead : by && here.includes(by) ? by : userName ?? by ?? lead ?? m.who;
        const audience = own ? [m.who] : [...new Set([...here, holderName, userName].filter(Boolean))];
        const text = (own ? `${m.who}这段时间自己碰上过：${m.surface ?? m.title ?? ''}${m.respond ? `——${m.respond}` : ''}` : `碰上了「${m.title}」：${m.surface ?? ''}`).slice(0, 240);
        // 先前那版替他记的"这段时间自己碰上过"（只当记忆、不算没下文的）作废，换成这一件
        if (own && records.retireDerived) for (const fp of new Set(all.filter(r => r.job_id == null && !r.matter && r.holder_name === m.who && String(r.text ?? '').startsWith(`${m.who}这段时间自己碰上过：`)).map(r => r.fp))) {
            records.retireDerived({ storyId, fp, holderName: m.who, prefixes: [`${m.who}这段时间自己碰上过：`] });
        }
        const id = records.addDerived({ storyId, fp: at.fp, type: '做', text, holder: holderOf(holderName), holderName, audience, about: lead ?? holderName, keys: matterKeys(m, [promiseText(m)]),
            matter: { menu: m.id, title: m.title ?? '', entry: entryOf(m), who: m.who, ...(m.origin ? { origin: m.origin } : {}), ...(own ? {} : m.respond ? { respond: String(m.respond).slice(0, 300) } : {}) } });
        have.add(m.id);
        made.push({ id, menu: m.id, pos: at.pos, holderName, audience });
    }
    return made;
}

// 他牵头的那几件，他后来当面开过口：当面办过了，收起来（用户 10/8：包厢那件一直标着还没下文，她发消息时又从"先辨真假"演起）。
// 每次折都看（场记章程第 11 条，试玩 10/10：原来只在他离场那一下看——那时他开口的那几条常还没进账、牵头的那件也可能离场以后才补记，就一直开着）。
// wide：连他是"谁"、却不是他牵头那份的旁人那几件也看他开过口没有——只在他离场那一下用；他人还在场时这么收，场上刚拿出来的事他一开口就没了
export function closeLed({ records, chatKey, storyId, who, fp, same = (a, b) => a === b, wide = true }) {
    const vis = records.visible(chatKey);
    // 已经有了结记录指着它的（做了、不做了……）不再记第二条：只看 isOpenMatter 不够——了结和原记录的链接可能下一次同步才接上、
    // 也可能先被一条"回答"占了（带 kind 的不算了结），每折一次就多记一条"当面办过了"（三家对比：同一句重复了二十来行）
    const ended = new Set(vis.filter(x => x.type === '了结' && x.idea_ref != null && x.outcome).map(x => x.idea_ref));
    const open = r => isOpenMatter(r) && !ended.has(r.id);
    const acted = r => vis.some(x => x.pos > r.pos && x.job_id != null && same(x.holder_name, who) && ['说', '做'].includes(x.type));
    const done = vis.filter(r => open(r) && r.matter.kind === LEAD && same(r.holder_name, who) && acted(r));
    // 接到这件事的那一边（电话是谁接的、场面是谁看见的）跟着收：他当面把这件事接着办了
    const menus = new Set(done.map(r => r.matter.menu).filter(x => x != null));
    const theirs = vis.filter(r => open(r) && !PRIVATE.has(r.matter.kind) && (menus.has(r.matter.menu) || (wide && same(r.matter.who, who) && acted(r))));
    for (const r of [...done, ...theirs]) records.addDerived({ storyId, fp, type: '了结', ideaRef: r.id, outcome: '做了', text: `${who}当面办过了：「${r.matter.title}」`, holder: r.holder, holderName: r.holder_name, audience: r.audience ?? [who] });
    return [...done, ...theirs].map(r => r.id);
}

// 场上的事（用户 10/8："口袋既然递出来了，在它了结、离开该场景之前，就跟随谁开口就递过去——第一次主动提起，后来的留在场上都不用刻意提起，
// 只看玩家有没有提起"）：拿出来了、还没了结的那件，这场戏里接着开口的每个人（当时在场看见的；镜头照玩家的眼睛）都带着它，连同玩家接了以后怎样。
// 这场戏：同一天、拿出来以后 STAGE_SPAN 条以内。拿出来的那个人这一轮正在交后半截的不重复给。
export const STAGE_SPAN = 20;
export function stageLines({ menu = [], visible = [], name, knower = name, speaker = name, same = (a, b) => a === b, lastPos = 0, dayOf = () => 0, today = 0, userName = '玩家', talk = '', gone = () => false }) {
    // gone(名字)：有卡、已经离场的人——他牵头的那件跟着他离开了这场戏
    const on = menu.filter(m => ['shown', 'used'].includes(m.status) && Number.isFinite(m.settled_pos) && lastPos - m.settled_pos <= STAGE_SPAN && dayOf(m.settled_pos) === today && !gone(m.who)
        && entryOf(m) !== '镜头外' && !(m.status === 'shown' && m.settled_by && same(m.settled_by, speaker)))
        // 他自己那份（牵头的、来意）不算场上的：来意是还没说出口的，不当"已经拿出来了"
        .map(m => ({ m, r: visible.find(x => x.matter?.menu === m.id && !PRIVATE.has(x.matter.kind)) }))
        .filter(({ r }) => r && isOpenMatter(r) && knows(r, knower, same));
    if (!on.length) return { lines: [], menus: new Set() };
    const tidy = t => String(t ?? '').trim().replace(/[。．.]+$/, '');
    return {
        menus: new Set(on.map(({ m }) => m.id)),
        lines: [`场上已经有的事（前面已经拿出来了、还没了结；不用再刻意提起——${userName}接了这茬、问起了，就照下面顺着往下；没接就让它待在那儿）：`,
            ...on.flatMap(({ m, r }) => [`· 「${m.title}」：${tidy(m.surface)}${talksOf(r, talk) ? '（眼下说到的就是这件）' : ''}`, ...(m.respond ? [`  （${userName}接了的话：${tidy(m.respond)}）`] : [])])],
    };
}

// 开口的人知道的、还没下文的：只有他知道的（玩家不知道）这几天的，至多三件；玩家这句说到了的，至多三件
// 后来知道的人也算：知道的人说起过它（记账记下的"说"，对得上这件事），当时听着的人就知道了
// senseOf(id)：按意思（向量）和玩家这句有多近（recall 那一步算的，0～1；没开向量就是 0）——换了说法也认得出在说它
const knowsItFor = (visible, same) => {
    const told = r => visible.filter(x => x.pos > r.pos && x.type === '说' && knows(r, x.holder_name, same) && toldOf(r, x.text, [x.holder_name, ...(x.audience ?? []), ...(r.audience ?? []), r.holder_name, r.matter?.who])).flatMap(x => x.audience ?? []);
    return (r, n) => knows(r, n, same) || (!PRIVATE.has(r.matter?.kind) && told(r).some(a => same(a, n)));
};

// 他和玩家之间有没有一件"碰上了、还没下文"的事（知道的人里同时有他和玩家）：有就返回最近的一件，没有返回 null。
// 不在场的人"可能来联系"得有这样一件事做由头（场记章程 #2：不再随机挑人，没有事由就不挂）
export function sharedMatter(visible, { person, userName, same = (a, b) => a === b }) {
    if (!person || !userName) return null;
    const knowsIt = knowsItFor(visible, same);
    // 他得是亲历的（他牵头的、当时在场的），听说的不算（试玩 10/10：玩家把丙的事讲给了甲，门上就挂了甲"可能来联系"）
    return visible.filter(r => isOpenMatter(r) && !PRIVATE.has(r.matter.kind) && knows(r, person, same) && knowsIt(r, userName)).sort((a, b) => a.pos - b.pos || a.id - b.id).at(-1) ?? null;
}

export function mattersFor(visible, { name, same = (a, b) => a === b, dayOf = () => 0, today = 0, talk = '', userName = null, senseOf = () => 0 }) {
    const knowsIt = knowsItFor(visible, same);
    const all = visible.filter(r => isOpenMatter(r) && knowsIt(r, name)).sort((a, b) => a.pos - b.pos || a.id - b.id);
    // 他的来意：只要还开着就一直带（不按天数、不占那四件的名额），直到他说了、办了、或者离场
    const intent = all.filter(r => r.matter.kind === INTENT && same(r.holder_name, name));
    const mine = all.filter(r => r.matter.kind !== INTENT);
    const own = r => !userName || !knowsIt(r, userName);
    const hits = mine.filter(r => talksOf(r, talk) || senseOf(r.id) >= SENSE_HIT).slice(-HIT_MAX);
    const fresh = mine.filter(r => !hits.includes(r) && own(r) && today - dayOf(r.pos) < MATTER_FRESH_DAYS).slice(-FRESH_MAX);
    return [...intent.map(r => ({ r, hit: talksOf(r, talk) || senseOf(r.id) >= SENSE_HIT })),
        ...[...fresh, ...hits].sort((a, b) => a.pos - b.pos).slice(-MATTER_MAX).map(r => ({ r, hit: hits.includes(r) }))];
}

// 他手上有什么：还开着的来意、别的还没下文的事（"此刻能做的"用，options.mjs）
export function handOf(visible, { name, same = (a, b) => a === b }) {
    const knowsIt = knowsItFor(visible, same);
    const all = visible.filter(r => isOpenMatter(r) && knowsIt(r, name));
    return { intent: all.some(r => r.matter.kind === INTENT && same(r.holder_name, name)), matters: all.some(r => r.matter.kind !== INTENT) };
}

// 那一格里的几行。camera：镜头照玩家的眼睛看——玩家这边还没下文的事；有人在追（这句问为什么、要去查）时，交给镜头那件事的来由
// 玩家这句说到的那几件（hit）单独成一块、放"眼下这一轮"：说得更明白——已经碰上过了，别说成还没去、别再提议去办同一件（试玩 10/7：
// 那件埋在旧事末尾，她问"租房子的事怎么说"，他答"去沃森区那家正经中介验验"——他刚在那儿被扫了三遍）
export function matterLines(items, opts) {
    const mine = items.filter(x => x.r.matter?.kind === LEAD);
    const intent = opts?.camera ? [] : items.filter(x => x.r.matter?.kind === INTENT);
    const missed = opts?.camera ? [] : items.filter(x => x.r.matter?.kind === MISSED);
    return [...intentLines(intent, opts), ...ledLines(mine, opts), ...missedLines(missed, opts), ...metLines(items.filter(x => !mine.includes(x) && ![INTENT, MISSED].includes(x.r.matter?.kind)), opts)];
}
// 他排的事没人接（章程 F2）：他心里记着；提不提、怎么提、记不记恨由他，别当成要讨的说法
function missedLines(items, { name, when = () => '之前' }) {
    if (!items.length) return [];
    return [`${name}心里记着的（${name}排的事一直没人接，就这么沉了；记着就行——提不提、怎么提由${name}，别非要讨个说法）：`,
        ...items.map(({ r, hit }) => `· ${when(r)}：${String(r.text).replace(/[。．.]+$/, '')}${hit ? '（眼下说到的就是这件）' : ''}`)];
}
// 他这回来是为了什么（只给他本人）：还没说出口；什么时候说、说多少由他
export function intentLines(items, { name } = {}) {
    if (!items.length) return [];
    // 记录里是"某某来这儿（怎么来的）：来由"；来由本身写成"他这回来是为了说：……"的（结算替他写的联系），不重复那半句
    const why = r => String(r.text ?? '').replace(/^[^：]*?：/, '').trim().replace(/^他这回来是为了/, '').replace(/^[：:]/, '').replace(/[。．.]+$/, '') || r.matter?.title || '';
    return items.map(({ r }) => `${name}这回来是为了${/^说/.test(why(r)) ? '' : '：'}${why(r)}（还没说出口；什么时候说、说多少由${name}；说了、办了就过去了）`);
}
// 他自己牵头的那几件：做过、说过的照这个，别忘了自己说过什么、交代过谁什么；接着要做的由他挑时候
function ledLines(items, { name, when = () => '之前' }) {
    if (!items.length) return [];
    return [`${name}自己牵头的事（${name}做过、说过的就是这些，那时${name}知道的也在里头——别忘了自己说过什么、交代过谁什么；接着要做的由${name}挑时候，对方怎么回应由对方；已经当面办过的别从头再办一遍）：`,
        ...items.map(({ r, hit }) => `· ${when(r)}：${String(r.text).replace(/[。．.]+$/, '')}${hit ? '（眼下说到的就是这件）' : ''}`)];
}
function metLines(items, { name, when = () => '之前', camera = false, userName = '玩家', pursue = false }) {
    if (!items.length) return [];
    const now = items.every(x => x.hit);
    const head = camera
        ? `${userName}这边碰上了、还没下文的事（真发生过；场面走到了、有人提起，就让它接着有动静——有人回话、事情变了样、找上门，按这个世界说得通的方式；别替${userName}拿主意）：`
        : now ? `${userName}这句说到的事，${name}已经碰上过了、还没下文（真发生过：说不说、说多少、瞒不瞒由${personWord(name)}，但别说成还没碰上、别提议再去办同一件；顺着它往下就行）：`
        : `${name}碰上了、还没下文的事（真发生过、还没有着落；提不提、跟谁说、瞒不瞒由${personWord(name)}——可以不说，但别当没这回事；有人问起、追查，就顺着它往下）：`;
    const out = [head];
    for (const { r, hit } of items) {
        out.push(`· ${when(r)}：${String(r.text).replace(/[。．.]+$/, '')}${hit ? '（眼下说到的就是这件）' : ''}`);
        if (camera && hit && pursue) out.push(r.matter?.origin
            ? `  （有人在追这件事。它背后是：${r.matter.origin}——这是查下去才会知道的：这一轮真去查了（问了对的人、翻了记录、去了那儿）才露出一截，一次一截，别一口气说穿；只是嘴上问一句，就照眼前知道的答）`
            : '  （有人在追这件事；它背后是怎么回事还没定——真去查了，就按这个世界说得通的样子露一截，和已经发生的对得上；露出来的会记下来，往后照它）');
    }
    return out;
}

// 规划简报里的一段：还没下文的（谁知道、来由），规划可以给它排后续
export function matterBrief(visible, { when = () => '之前', max = 12 } = {}) {
    const open = visible.filter(isOpenMatter).slice(-max);
    if (!open.length) return [];
    return ['【碰上了、还没下文的事】（真发生过、还没有着落的；可以给它排后续——查出来是怎么回事、有人因此找上门、变得更糟、有了解决的路子；已经发生的别再排一遍，来由照这里写的）',
        ...open.map(r => `· [${r.id}] ${when(r)} ${String(r.text).replace(/[。．.]+$/, '')}（知道的：${[...new Set([r.holder_name, ...(r.audience ?? [])].filter(Boolean))].join('、')}${r.matter?.origin ? `；来由：${r.matter.origin}` : ''}）`)];
}

// ---------- 收期（用户 10/12，N-362）----------
// 用户："口袋要有后续、有发展变化，也要有结束点；没出意外的口袋也该收……琐事不该没完没了，剧情要有聚焦点。"
// 原来一件事拿出来、记成"碰上的事"以后，只有正文里明确"了结"才算完——没人说"这事完了"它就一直挂在各人那一格的"还没下文"里，
// 三天前的小事还在被一遍遍拎出来。现在每件有个收期（tempo.close，按这一局的节奏和时间单位）：
//   · 收期到了、正文里没了结、玩家这段时间也没追它——程序替它收，记一条"了结"挂在眼下最后一条上（删回去就回来）；
//     之后它只是一段记忆，问起还想得起，不再列进"还没下文"；
//   · 玩家追了（这句里有追问、去查的字样，又说到了这件）——从追的那条起再给一个收期，下一份规划定收还是续；
//   · 规划写了"续"——从那份规划起再给一个收期（restart）。
// 来意（离场就过去）、没人接（他心里记一笔，只带几天）有自己的收法，不归这里管。
export const CLOSE_EXEMPT = new Set([INTENT, MISSED]);
const keyHits = (r, t) => (r.keys ?? []).filter(k => typeof k === 'string' && k.length >= 2 && !weakPair(k) && t.includes(k)).length;
// 玩家这句是在追这件事：有追问、去查的字样，而且说到的就是它（题和经过里的实词对上两处，或者检索词对上两处）
export function chasedBy(r, text) {
    const t = String(text ?? '');
    if (!r?.matter || !t.trim() || !PURSUE.test(t)) return false;
    return reachedFor({ title: r.matter.title ?? '', surface: r.text ?? '' }, t) || keyHits(r, t) >= 2;
}
// 收期从哪条起算：记下它的那条；玩家追过的，从最近追的那条起；restart（规划写了续的那份规划挂在哪条）更晚就从那条起
export function closeFrom(r, { messages = [], restart = null } = {}) {
    let from = r.pos;
    for (const m of messages) if (m?.is_user && m.pos > r.pos && m.pos > from && chasedBy(r, m.text)) from = m.pos;
    return Number.isFinite(restart) && restart > from ? restart : from;
}
// 这件到没到收期：还开着、不是来意和没人接、从起算那条到眼下过了 close 格以上
export function closeDue(r, { messages = [], dayOf = () => 0, today = 0, close = 2, restart = null } = {}) {
    if (!isOpenMatter(r) || CLOSE_EXEMPT.has(r.matter.kind)) return false;
    return today - dayOf(closeFrom(r, { messages, restart })) >= Math.max(1, close);
}
// 一件事完了落下什么：规划写的"收尾"（K1 存的 close_text／closeText）；老件没有这一格的用"接了会怎样"；再没有就只写题
export function endOf(m, r = null) {
    const tidy = x => String(x ?? '').trim().replace(/[。．.]+$/, '');
    return tidy(m?.close_text ?? m?.closeText) || tidy(ifTakenOf(m)) || tidy(r?.matter?.title ?? m?.title);
}
// 替到期的那几件记"了结"（advanceWorld 折一次时调；幂等：已经有了结指着它的不再记）。due(r)：到没到收期；menu：菜单（拿收尾）。返回收掉的编号
export function lapseMatters({ records, chatKey, storyId, fp, menu = [], due = () => false }) {
    if (!records?.addDerived || !fp) return [];
    const vis = records.visible(chatKey);
    const ended = new Set(vis.filter(x => x.type === '了结' && x.idea_ref != null).map(x => x.idea_ref));
    const out = [];
    for (const r of vis.filter(r => !ended.has(r.id) && isOpenMatter(r) && due(r))) {
        const m = r.matter.menu != null ? menu.find(x => x.id === r.matter.menu) : null;
        records.addDerived({ storyId, fp, type: '了结', ideaRef: r.id, outcome: '过去了', text: `没人再提，这件事就这么过去了：${endOf(m, r)}`.slice(0, 200),
            holder: r.holder, holderName: r.holder_name, audience: r.audience ?? [] });
        out.push(r.id);
    }
    return out;
}

// ---------- 上一份规划里的口子：收还是续（K 约定第 4、5 条）----------
// 规划者对还没下文的每件答一句：收（写它怎么落地）或续（再排一拍）。程序照办：收 → 记一条了结；续 → 续的次数＋1、收期从这份规划起重算。
// 一件最多续一次：续过一次又被写续的，当收办，落地用它自己的收尾。
const bareTitle = x => { const t = String(x ?? '').trim(); return (t.match(/「([^」]+)」/)?.[1] ?? t).trim(); };
// 口子的题对上的那几条（同一件拿出来时可能替几个人各记了一条：都算）。先认题一模一样的，没有再认互相包含的（两字以上）
export function gapTargets(gap, visible = [], menu = []) {
    const want = bareTitle(gap?.题 ?? gap?.title);
    if (!want) return [];
    const open = visible.filter(r => isOpenMatter(r) && !CLOSE_EXEMPT.has(r.matter.kind));
    const titleOf = r => bareTitle(r.matter.title || (r.matter.menu != null ? menu.find(m => m.id === r.matter.menu)?.title : ''));
    const exact = open.filter(r => titleOf(r) === want);
    if (exact.length) return exact;
    return want.length >= 2 ? open.filter(r => { const t = titleOf(r); return t.length >= 2 && (t.includes(want) || want.includes(t)); }) : [];
}
// 这一份规划的口子该怎么办（纯函数）：done＝这份规划里已经办过的题；contOf(菜单编号)＝续过几次。
// 返回 [{ title, act: '收'|'续', ids: [记录编号], menus: [菜单编号], text }]——act 收的带 text（了结那句）；对不上的、认不出处理的也返回（ids 空），好记成办过
export function gapSteps(gaps, { visible = [], menu = [], done = new Set(), contOf = () => 0 } = {}) {
    const out = [];
    for (const g of Array.isArray(gaps) ? gaps : []) {
        const title = bareTitle(g?.题 ?? g?.title);
        if (!title || done.has(title) || out.some(x => x.title === title)) continue;
        const how = String(g?.处理 ?? '').trim();
        const hits = gapTargets(g, visible, menu);
        const menus = [...new Set(hits.map(r => r.matter.menu).filter(x => x != null))];
        const m = menus.length ? menu.find(x => x.id === menus[0]) : null;
        const tidy = x => String(x ?? '').trim().replace(/[。．.]+$/, '');
        if (/^收/.test(how)) out.push({ title, act: '收', ids: hits.map(r => r.id), menus, text: tidy(g.落地) || endOf(m, hits[0]) || title });
        else if (/^续/.test(how) && menus.some(id => contOf(id) >= 1)) out.push({ title, act: '收', ids: hits.map(r => r.id), menus, text: endOf(m, hits[0]) || title, again: true });
        else if (/^续/.test(how)) out.push({ title, act: '续', ids: hits.map(r => r.id), menus });
        else out.push({ title, act: null, ids: [], menus: [] });
    }
    return out;
}
