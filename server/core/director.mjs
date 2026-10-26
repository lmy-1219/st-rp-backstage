// 调度（方案 自动进离场与调度 第二节第 5 条，N-379）：玩家发一句、或者某人答完一条，后台排一次"接下来谁说"。
// 纯程序、不花钱：只读玩家这句、消息序列、场面表的人（当面／远程／不在）、名册和关系表（又名）、每人此刻要说的、最近谁说过、节奏档；
// 旁白要不要补一手直接问 camera-turn.cameraShouldSpeak。输出按顺序的 [{ who, role: '答'|'接'|'插'|'旁白', why, noRepeat? }]：
// 被点名的最先；一句玩家的话之后至多几人按节奏档（慢 1～2、中 2、快 3）；同一人不连着说；第二个人起带 noRepeat（那一格要加一句
// "前一条已经答了的不重复，只接自己的那一截"）；发消息进来的远程的人只在玩家对他说时才排，电话里的人玩家说了引号里的话就可能接；
// 上一条角色回复问了玩家就返回空（停下等玩家）；他点了、问了在场的别人，那人接。
// "这句对谁说"程序先认（addresseeOf：点名、称呼、上一条是谁、问句），认不出返回 null——当场问一次便宜模型是主窗 1b 的事，这里只给钩子。
// 接线（扩展按单子 /trigger、ST 群改手动策略）在 1b、1c。同一个模块以后就是 APK 的轮话逻辑。题材无关。
import { cameraShouldSpeak, callsOf } from './camera-turn.mjs';
import { hasCard } from './arrival.mjs';
import { sameName } from './setup.mjs';
import { normalizeRelations, personOf } from './relations.mjs';
import { paceName, MID } from './tempo.mjs';

const CAMERA = 'narrator';
const CAMERA_NAME = '旁白';
// 一句玩家的话之后至多几手（旁白那一手也算一手）；慢档只排有硬由头的，所以多半是 1、偶尔 2
export const CAP = Object.freeze({ 慢: 2, 中: 2, 快: 3 });
const paceOf = pace => paceName(pace && typeof pace === 'object' ? pace.name : pace) ?? MID;
export const capOf = pace => CAP[paceOf(pace)];
// 角色之间点名、问话连着接，这一句之后至多几手（T071，用户 10/25 定 6）；配置 auto.chain 可改，面板范围 min～max
export const CHAIN = Object.freeze({ default: 6, min: 1, max: 12 });
export const chainOf = v => { const n = Number(v); return v != null && v !== '' && Number.isInteger(n) && n >= CHAIN.min && n <= CHAIN.max ? n : CHAIN.default; };
// 此刻要说的四种由头，排的先后：来意没说 > 口袋到了 > 等回音 > 兴头；慢档只排前两种
const WANT_RANK = { 来意: 0, 口袋: 1, 等回音: 2, 兴头: 3 };
const STRONG = new Set(['来意', '口袋']);
const WANT_WHY = { 来意: '来意还没说', 口袋: '口袋到了', 等回音: '等的回音有了', 兴头: '有兴头' };
const kindOf = w => { const k = String(w?.kind ?? w?.type ?? w?.what ?? ''); return /来意/.test(k) ? '来意' : /口袋/.test(k) ? '口袋' : /回音/.test(k) ? '等回音' : /兴头/.test(k) ? '兴头' : k; };

// 引号里的话：中文双引号、直角引号、英文双引号
const QUOTE = /“[^“”]{1,600}”|「[^「」]{1,600}」|『[^『』]{1,600}』|"[^"\n]{1,600}"/g;
const NEAR = 14;
const CLAUSE = /[，,。！？!?；;：:\n]/;
// 这一小句明说了不理他：点了他的名也不算对他说
const IGNORE = /没理|不理|没搭理|不搭理|无视|背对|懒得|没回(?!头)|不回(?!头)|没接|不接|没看[他她]|不看[他她]/;
// 叙述里冲着他：对他说、问他、给他、看向他、走到他身边……
const DIRECT = '(?:对|冲|朝|跟|向|问|回|给|叫|喊|看着|看向|望着|望向|盯着|瞪着|转向|转头看|回头看|扭头看|拉住|拽住|拍了拍|拍拍|递给|推给|凑到|走到|坐到|靠近|挨着|凑近)';
const NEAR_SUFFIX = '(?:身边|旁边|跟前|面前|身旁|耳边|对面)';
const esc = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const isNarrator = m => !!m && !m.is_user && (m.speaker === CAMERA || m.name === CAMERA_NAME);
const asked = text => /[？?]/.test(String(text ?? ''));
const quotes = text => [...String(text ?? '').matchAll(QUOTE)];
const hasQuote = text => quotes(text).length > 0;
const mentions = (text, calls) => calls.some(c => c && String(text ?? '').includes(c));
const plainOf = text => String(text ?? '').replace(/[\s“”「」『』"（）()。！？!?，,…～~、：:；;—-]/g, '');
const NARR = /（[^）]*）|\([^)]*\)|\*[^*\n]+\*/g;
const spokenOf = text => String(text ?? '').replace(NARR, '');
// 承接的短句（"嗯""好""知道了"）：嘴上说的那截短、不是问句；只有叙述（"（起身去倒水。）"）不算——那不是在接谁的话
export const isBridge = text => { const p = plainOf(spokenOf(text)); return p.length > 0 && p.length <= 12 && !asked(text); };
// 一句小动作或承接：连叙述一起都短、没有问句（叩门的时机认"空当"用）
export const isLull = text => { const p = plainOf(text); return p.length > 0 && p.length <= 12 && !asked(text); };
function clauseAt(s, i) {
    let a = i, b = i;
    while (a > 0 && !CLAUSE.test(s[a - 1])) a--;
    while (b < s.length && !CLAUSE.test(s[b])) b++;
    return s.slice(a, b);
}

// 这句对谁说。candidates：能被说到的人（在场的、远程的、刚走的）；lastSpeaker：玩家这句之前最后一个开口的有卡的人（旁白不算）
// 认法：1. 叙述里冲着他、对他说，或者称呼（引号开头、句首就是他的名字，后面跟着标点）——"不理他"那一小句里的不算；几个人都有就取先写到的
//      2. 没点名：这句是回话（引号里的话、问句、承接的短句），上一条是他说的 → 他
//      3. 认不出 → null
function addressee(text, candidates, lastSpeaker, { rel = null, names = [], userName = null } = {}) {
    const s = String(text ?? '');
    const cands = [...new Set((candidates ?? []).filter(n => n && n !== userName && n !== CAMERA_NAME))]
        .map(n => ({ name: n, calls: callsOf(n, { rel, names }).sort((a, b) => b.length - a.length) }));
    if (!cands.length || !s.trim()) return { who: null, how: null };
    let best = null;
    for (const c of cands) for (const call of c.calls) {
        const n = esc(call);
        const re = new RegExp(`${DIRECT}(?:了|着|向|到)?\\s*${n}|${n}(?:的)?${NEAR_SUFFIX}|(?:^|[“「『"（(\\s，,。！？!?；;：:\\n])${n}\\s*(?:[，,、：:！!。？?”」』"]|你|您|啊|呀|哎|诶|$)`, 'g');
        for (const m of s.matchAll(re)) {
            if (IGNORE.test(clauseAt(s, m.index))) continue;
            if (!best || m.index < best.at) best = { who: c.name, at: m.index };
        }
    }
    if (best) return { who: best.who, how: '点名' };
    const last = lastSpeaker ? cands.find(c => c.name === lastSpeaker || c.calls.includes(lastSpeaker) || sameName(c.name, lastSpeaker, names)) : null;
    if (last && (hasQuote(s) || asked(s) || isBridge(s))) return { who: last.name, how: '接着上一条' };
    return { who: null, how: null };
}

/**
 * 玩家这句对谁说：点名、又名、上一条是谁、问句；认不出返回 null（调便宜模型兜底由主窗 1b 做，这里只给钩子）。
 * names：能被说到的人；lastSpeaker：上一个开口的有卡的人；opts：{ relations（关系表，认又名）, roster（名册全名，认"甲·乙"的前半）, userName }
 */
export function addresseeOf(text, names = [], lastSpeaker = null, opts = {}) {
    const rel = opts.relations ? normalizeRelations(opts.relations) : opts.rel ?? null;
    const all = [...new Set([...(opts.roster ?? []).map(e => (typeof e === 'string' ? e : e?.name)), ...names].filter(Boolean))];
    return addressee(text, names, lastSpeaker, { rel, names: all, userName: opts.userName ?? null }).who;
}

// 某人答完的那条：问了玩家（引号里有问句、前后没带在场别人的名字）→ player；点了、问了在场的别人（引号开头称呼他、问句前后写着他）→ who
function replyTargets(text, { names = [], self = null, rel = null, all = [] } = {}) {
    const s = String(text ?? '');
    const cands = names.filter(n => n && n !== self && n !== CAMERA_NAME).map(n => ({ name: n, calls: callsOf(n, { rel, names: all }) }));
    let who = null, player = false;
    for (const q of quotes(s)) {
        const start = q.index, end = start + q[0].length;
        const inner = q[0].slice(1, -1);
        const near = `${s.slice(Math.max(0, start - NEAR), start).split(CLAUSE).at(-1)}|${s.slice(end, end + NEAR).split(CLAUSE)[0]}`;
        const vocative = cands.find(c => c.calls.some(call => new RegExp(`^\\s*${esc(call)}\\s*(?:[，,、：:！!。？?]|你|您|啊|呀|$)`).test(inner)));
        const named = vocative ?? cands.find(c => mentions(near, c.calls));
        if (named) { who ??= named.name; continue; }
        if (asked(inner)) player = true;
    }
    if (!who) { const a = addressee(s, cands.map(c => c.name), null, { rel, names: all }); if (a.who) who = a.who; }
    return { who, player: player && !who };
}

/**
 * 排一次"接下来谁说"。
 * 输入：text（玩家这句原文；不给就用最近那条玩家消息）、messages（到此刻为止，最后一条可以是玩家的、也可以是某人刚答的）、
 *      board（场面表，people 里 status 当面 present／远程 remote（way 电话／消息）／刚走 away）或 people、roster、relations（又名）、
 *      wants（每人此刻要说的 [{ who, kind: 兴头|口袋|来意|等回音, text? }]）、pace（慢／中／快）、userName、present（群里开着口的，给旁白判定）、stateNotes、cap
 * 输出：{ queue: [{ who, role, why, noRepeat? }], why }，queue 空时 why 说为什么停
 */
export function turnDetail(input = {}) {
    const { text = null, messages = [], roster = [], relations = null, wants = [], pace = null, present = [], stateNotes = [], cap = null, chain = null } = input;
    const userAt = messages.findLastIndex(m => m?.is_user);
    if (userAt < 0) return { queue: [], why: '还没有玩家的话' };
    const userName = input.userName ?? messages[userAt].name ?? null;
    const line = String(text ?? messages[userAt].text ?? '');
    const names = roster.map(e => (typeof e === 'string' ? e : e?.name)).filter(Boolean);
    const rel = relations ? normalizeRelations(relations) : null;
    const same = (a, b) => !!a && !!b && (a === b || sameName(a, b, names) || (!!rel && !!personOf(rel, a, names) && personOf(rel, a, names) === personOf(rel, b, names)));
    const board = input.board ?? (input.people ? { people: input.people } : null);
    const folks = (board?.people ?? []).filter(p => p?.name && p.name !== CAMERA_NAME && !same(p.name, userName)
        && (p.card ?? roster.some(e => hasCard(e) && same(e.name, p.name))));
    const here = folks.filter(p => p.status === 'present').map(p => p.name);
    const phone = folks.filter(p => p.status === 'remote' && /电话/.test(p.way ?? '')).map(p => p.name);
    const texting = folks.filter(p => p.status === 'remote' && !/电话/.test(p.way ?? '')).map(p => p.name);
    // 刚走的（同一时段里，还没走远）：被点名就直接叫回来，不走进场那套
    const justLeft = folks.filter(p => p.status === 'away' && (p.stage == null || p.stage === 'early')).map(p => p.name);
    const paceN = paceOf(pace);
    const limit = cap ?? CAP[paceN];
    const since = messages.slice(userAt + 1);
    const last = messages.at(-1);
    const reply = last && !last.is_user ? last : null;
    // 上一条是某人答的、他点了、问了在场的别人：角色之间连着接，不看节奏档的手数、不看这一句之后说没说过，只看 chain（T071）；
    // 这一手只排被点的那一个，别的由头让路。没点别人的照下面原来的排法
    const r = reply ? replyTargets(reply.text, { names: [...here, ...phone], self: reply.name, rel, all: names }) : null;
    if (r?.who && !same(r.who, reply.name)) {
        const most = chainOf(chain);
        if (since.length >= most) return { queue: [], why: `角色之间已经连着说了 ${since.length} 手，至多 ${most} 手` };
        return { queue: [{ who: r.who, role: '接', why: `${reply.name}那条点了他`, noRepeat: true }], why: '' };
    }
    const room = limit - since.length;
    if (room <= 0) return { queue: [], why: `这一句之后已经说了 ${since.length} 手，${paceN}档至多 ${limit} 手` };
    const spoken = since.filter(m => !isNarrator(m)).map(m => m.name).filter(Boolean);
    const said = who => spoken.some(n => same(n, who));
    const queue = [];
    const add = (who, role, why) => { if (who && !queue.some(q => same(q.who, who)) && !(reply && same(reply.name, who))) queue.push({ who, role, why }); };
    // 上一条是某人答的：问了玩家就停（点了别人的已在上面接走）
    if (r?.player) return { queue: [], why: `${reply.name}那条问了${userName ?? '玩家'}，停下等玩家` };
    // 这句对谁说
    const lastSpeaker = messages.slice(0, userAt).findLast(m => !m.is_user && !isNarrator(m))?.name ?? null;
    const to = addressee(line, [...here, ...phone, ...texting, ...justLeft], lastSpeaker, { rel, names, userName });
    if (to.who && !said(to.who)) {
        if (justLeft.some(n => same(n, to.who))) add(to.who, '答', '刚走的人被点名，直接叫回来');
        else if (to.how === '点名') add(to.who, '答', '玩家点了他的名');
        else add(to.who, '接', '玩家这句接着他上一条说的');
    }
    // 旁白：玩家点名了没卡的人、接着跟上一条旁白里开口的人说话 → 旁白写那人的回应；排在被点名的有卡的人之后（没有就最先）
    const cam = cameraShouldSpeak({ messages, recentUser: line, present, roster, board, stateNotes, relations });
    if (cam.speak) add(CAMERA_NAME, '旁白', cam.why);
    // 电话那头的人：玩家说出口的他听得见，这句没点名冲着屋里别人说就可能接
    if (hasQuote(line) && (!to.who || to.how !== '点名' || phone.some(n => same(n, to.who)))) for (const n of phone) if (!said(n)) add(n, '接', '电话那头听得见玩家说出口的话');
    // 手上有事要说的（来意没说 > 口袋到了 > 等回音 > 兴头）：在场的、电话里的；发消息来的不插话；慢档只排硬由头
    const can = n => here.some(x => same(x, n)) || phone.some(x => same(x, n));
    const list = (wants ?? []).filter(w => w?.who && can(w.who) && !said(w.who) && (paceN !== '慢' || STRONG.has(kindOf(w))))
        .map((w, i) => ({ w, i, rank: WANT_RANK[kindOf(w)] ?? 9 })).sort((a, b) => a.rank - b.rank || a.i - b.i);
    for (const { w } of list) add(w.who, '插', `${WANT_WHY[kindOf(w)] ?? '手上有事'}${w.text ? `：${String(w.text).slice(0, 40)}` : ''}`);
    // 顺着接：玩家点了别人，刚才正说着话的那位（最近四条里开过口）也接一手；慢档不排
    if (paceN !== '慢' && lastSpeaker && to.who && !same(to.who, lastSpeaker) && here.some(n => same(n, lastSpeaker)) && !said(lastSpeaker)
        && messages.slice(Math.max(0, userAt - 4), userAt).some(m => m.name === lastSpeaker)) add(lastSpeaker, '接', '刚才正说着话');
    // 没人该说、这句还没人答过：身边有人就让刚才说话的那位（没有就头一个在场的）接一手；一个人时旁白接
    if (!queue.length && !since.length) {
        if (here.length) add(here.find(n => same(n, lastSpeaker)) ?? here[0], '接', '没人被点名，身边的人顺着接一手');
        else if (!phone.length) add(CAMERA_NAME, '旁白', '身边没有有卡的人，旁白接');
    }
    const out = queue.slice(0, room).map((q, i) => (since.length + i >= 1 ? { ...q, noRepeat: true } : q));
    return { queue: out, why: out.length ? '' : '没人该说，停下' };
}

export function turn(input = {}) { return turnDetail(input).queue; }
