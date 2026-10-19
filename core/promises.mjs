import { personWord } from './pronoun.mjs';
// 约定（N-268、D-140，用户 10/1）：角色和玩家自己说好要办的事。按类记、按类给、按类收——
//   眼前（这会儿、等会儿就办）／定了日子（明早九点、后天、下周）／有条件（等某件事成了再办）／畅想（没准日子也没准条件的往后）。
// "以后一直照着做"的规矩是另一回事（记账的"说好的"，slot.agreedLines），不在这里。
// 记账给：类、谁办、跟谁、约在（照原文）；程序管：约在折成第几天、什么时段，到了没有、过了没有，给谁、给几回，过了没说法的怎么收。
// 办了、不办了、改了、没办成，由记账的"了结"关上；程序只替"过了好几天没人再提"的记一笔"就这么过去了"。
// 给前台的是素材，不是待办清单：怎么对待（照办、改期、先顾别的、不去了、瞒着）由角色自己选，正文里有个交代就行；谁在意、在意多少看各人。
// 题材无关：日子、时段从约在的原文和剧情日期来。
import { PARTS, partOf } from './timeline.mjs';
import { parseAmount, amountsIn } from './money.mjs';
import { scaleOf, cnCount, DAY } from './timescale.mjs';
// 时间尺度（章程 G2）：按年、按月走的局，"第几天"是第几年／第几个月，"明天"那一格换成"明年""下个月"；时段是开局单写的那几段。
// 不给尺度就是天，和以前一字不差。

export const KINDS = ['眼前', '定了日子', '有条件', '畅想'];
export const OUTCOMES = ['做了', '不做了', '改了', '没办成'];
// 程序替"过了没人再提"的记的结果（不是记账给的）
export const LAPSED = '过去了';

const rank = (p, parts = PARTS) => parts.indexOf(p);
const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
const hourPart = h => (h < 2 ? '深夜' : h < 5 ? '凌晨' : h < 8 ? '早上' : h < 12 ? '上午' : h < 14 ? '中午' : h < 17 ? '下午' : h < 19 ? '傍晚' : h < 23 ? '晚上' : '深夜');

// 约在（照原文）→ { day, end, part, soon }：从说的那天往后数的第几天（end＝最晚哪天还算没过，"下周"这种是一段）、一天里的什么时候、是不是"等会儿就办"。
// 认不出日子就 null（不算定了日子：放着，聊到了再想起）。weekdayOf(第几天)→0～6（周日＝0），开局单没写日期就没有。
export function dueOf(when, { saidDay = 0, weekdayOf = null, timeScale = DAY } = {}) {
    const t = String(when ?? '').trim();
    if (!t) return null;
    if (/等会|等一下|一会儿?|待会|马上|这就|立刻|现在就|过会儿?|回头就/.test(t)) return { day: saidDay, end: saidDay, part: null, soon: true };
    const ts = scaleOf(timeScale);
    if (ts.unit !== '天') return dueInUnits(t, saidDay, ts);
    let day = null, end = null;
    const word = [[/大后天/, 3], [/后天/, 2], [/明早|明晚|明天|明儿|明日|第二天|次日|隔天/, 1], [/今早|今晚|今夜|今天|今儿|今日/, 0]].find(([re]) => re.test(t));
    if (word) day = saidDay + word[1];
    const n = /(\d+|[一二两三四五六七八九十]+)\s*天(?:以?后|之后)|过\s*(\d+|[一二两三四五六七八九十]+)\s*天/.exec(t);
    if (day == null && n) day = saidDay + (parseAmount(n[1] ?? n[2]) ?? 0);
    if (day == null && /过两天|过几天|这两天|这几天|改天|回头/.test(t)) { day = saidDay + 2; end = saidDay + 4; }
    const now = weekdayOf?.(saidDay) ?? null;
    const mon = d => (d + 6) % 7;   // 一周从周一算
    const wk = /(下个?)?(?:周|星期|礼拜)([一二三四五六日天])/.exec(t);
    if (day == null && wk && now != null) {
        const target = wk[2] === '天' ? 0 : WEEK.indexOf(wk[2]);
        // 下周X＝下一个周一起的那个X；只说周X＝这之后最近的那个X（说的当天不算）
        day = saidDay + (wk[1] ? 7 - mon(now) + mon(target) : (target - now + 7) % 7 || 7);
    }
    if (day == null && /周末/.test(t) && now != null) { day = saidDay + ((6 - now + 7) % 7 || 7); end = day + 1; }
    if (day == null && /下个?(?:周|星期|礼拜)(?![一二三四五六日天])/.test(t)) { day = saidDay + (now != null ? 7 - mon(now) : 7); end = day + 6; }
    if (day == null && /下个月|月底|月初|月中/.test(t)) { day = saidDay + 14; end = saidDay + 45; }
    // 一天里的什么时候：钟点（前面写了早晚的照写的，"晚上八点"）；没写钟点的照"明早""下午"这类词
    let part = null;
    const hour = /(\d{1,2}|[一二两三四五六七八九十]{1,3})\s*(?:点|时)/.exec(t);
    if (hour) {
        const before = partOf(t.slice(Math.max(0, hour.index - 3), hour.index));
        let h = parseAmount(hour[1]) ?? 0;
        if (/明晚|今晚|今夜/.test(t) && h < 12) h += 12;
        part = before ?? hourPart(h);
    }
    part ??= /明早|今早|一早/.test(t) ? '早上' : /明晚/.test(t) ? '晚上' : partOf(t);
    if (day == null) { if (!part) return null; day = saidDay; }   // 只说了"晚上""九点"：当天
    return { day, end: end ?? day, part, soon: false };
}

// 不按天走的局：照这一局的单位认"明年""下个月""三年后"；比这一格小的说法（明天、下周）算在这一格里。时段照开局单写的那几段认。
const UNIT_WORDS = {
    年: { words: [[/大后年/, 3], [/后年/, 2], [/明年|来年|第二年|次年|翌年|明春|明夏|明秋|明冬/, 1], [/今年|年内|年底|年初|年中|今春|今夏|今秋|今冬|这一年/, 0]], n: '年', loose: /过两年|过几年|这两年|这几年|改年|过些年/, smaller: /明天|后天|明早|明晚|下周|下个?星期|周末|下个?月|月底|月初|今晚|今天/, bigger: null },
    月: { words: [[/下下个?月/, 2], [/下个?月|次月|第二个月/, 1], [/这个?月|本月|月底|月初|月中|月内/, 0]], n: '个?月', loose: /过两个?月|过几个?月|这两个?月|这几个?月/, smaller: /明天|后天|明早|明晚|下周|下个?星期|周末|今晚|今天/, bigger: [/明年|来年/, 12] },
    小时: { words: [[/大后天/, 72], [/后天/, 48], [/明早|明晚|明天|明儿|明日|第二天|次日|隔天/, 24], [/今早|今晚|今夜|今天|今儿|今日/, 0]], n: '个?(?:小时|钟头)', loose: /过两个?(?:小时|钟头)|过几个?(?:小时|钟头)/, smaller: null, bigger: null },
};
function dueInUnits(t, saidDay, ts) {
    const u = UNIT_WORDS[ts.unit];
    let day = null, end = null;
    const word = u.words.find(([re]) => re.test(t));
    if (word) day = saidDay + word[1];
    const n = new RegExp(`([0-9一二两三四五六七八九十百几]+)\\s*${u.n}(?:以?后|之后)|过\\s*([0-9一二两三四五六七八九十百几]+)\\s*${u.n}`).exec(t);
    if (day == null && n) day = saidDay + (cnCount(n[1] ?? n[2]) ?? 0);
    if (day == null && u.loose.test(t)) { day = saidDay + 2; end = saidDay + 4; }
    if (day == null && u.bigger?.[0].test(t)) day = saidDay + u.bigger[1];
    if (day == null && u.smaller?.test(t)) day = saidDay;
    const part = partOf(t, ts);
    if (day == null) { if (!part) return null; day = saidDay; }
    return { day, end: end ?? day, part, soon: false };
}

// 有条件的：程序查得了的只有钱（"等我赚到五万""攒够两千"）。查不了的（有空、退休、等他找到零件）不查，聊到了再想起。
export function condOf(when) {
    const t = String(when ?? '');
    if (!/赚|攒|凑|挣|存|有了?.{0,6}钱|手上有/.test(t)) return null;
    const amounts = [...amountsIn(t)];
    return amounts.length ? { money: Math.max(...amounts) } : null;
}

// 记录 → 约定（没有"约定"那一格的不算）。dayOf(位置)→第几天；partAt(位置)→那条消息时是一天里的什么时候。
export function promiseOf(r, { dayOf = () => 0, partAt = () => null, weekdayOf = null, timeScale = DAY } = {}) {
    let p = r?.promise;
    if (typeof p === 'string') { try { p = JSON.parse(p); } catch { p = null; } }
    if (!p || !KINDS.includes(p.kind) || !['说', '想法'].includes(r.type)) return null;
    const saidDay = dayOf(r.pos);
    let due = null;
    if (p.kind === '眼前') due = dueOf(p.when, { saidDay, weekdayOf, timeScale }) ?? { day: saidDay, end: saidDay, part: null, soon: true };
    else if (p.kind === '定了日子') due = dueOf(p.when, { saidDay, weekdayOf, timeScale });
    const names = v => (Array.isArray(v) ? v.filter(x => typeof x === 'string' && x.trim()) : []);
    const doers = names(p.doers).length ? names(p.doers) : [r.holder_name ?? r.holder];
    // 跟谁没写：当时在场的别人
    const with_ = names(p.with).length ? names(p.with) : (r.audience ?? []).filter(a => !doers.includes(a));
    return { id: r.id, r, kind: p.kind, when: p.when ?? '', doers, with: with_, saidDay, saidPart: partAt(r.pos), due, cond: p.kind === '有条件' ? condOf(p.when) : null };
}

// 此刻这件约定走到哪一步：
//   later 还早；eve 就是明天（今天傍晚以后提一句）；open 一段时间里哪天都行（"下周""过几天"，还没到最后一天）——不置顶，聊到了再想起；
//   today 今天到时候、还没过；late 今天说好的时段过了；overdue 说好的日子过了；lapse 过了两个剧情日还没说法——记一笔"就这么过去了"，收起来。
//   眼前的：说的那个时段和下一个时段里算 today，再往后 late，跨了天就收（lapse，不另说）。
//   有条件的：cond 还没到；met 到了（钱够了）；查不了的、畅想：open。
export function stageOf(p, { today, part = null, balance = () => null, timeScale = DAY }) {
    const parts = scaleOf(timeScale).parts, rank_ = x => rank(x, parts);
    if (p.kind === '有条件' && p.cond?.money) {
        const have = p.doers.map(balance).find(v => v != null);
        return have != null && have >= p.cond.money ? 'met' : 'cond';
    }
    const d = p.due;
    if (!d) return 'open';
    if (d.soon) {
        if (today > d.day) return 'lapse';
        return part && p.saidPart && rank_(part) - rank_(p.saidPart) >= 2 ? 'late' : 'today';
    }
    if (today < d.day - 1) return 'later';
    if (today === d.day - 1) return 'eve';
    if (today > d.end) return today - d.end >= scaleOf(timeScale).lapse ? 'lapse' : 'overdue';
    if (today < d.end) return 'open';
    return d.part && part && rank_(part) > rank_(d.part) ? 'late' : 'today';
}

// 原文里的"明天""后天"按今天改说法（昨天说的"明天"＝今天）：给前台时省得它自己换算。
const dayWord = (delta, kind) => {
    if (delta === 0) return { 天: '今天', 早: '今早', 晚: '今晚' }[kind];
    if (delta === 1) return { 天: '明天', 早: '明早', 晚: '明晚' }[kind];
    if (delta === -1) return { 天: '昨天', 早: '昨天早上', 晚: '昨晚' }[kind];
    if (delta === -2) return { 天: '前天', 早: '前天早上', 晚: '前天晚上' }[kind];
    if (delta === 2) return { 天: '后天', 早: '后天早上', 晚: '后天晚上' }[kind];
    return { 天: `${Math.abs(delta)} 天${delta < 0 ? '前' : '后'}`, 早: `${Math.abs(delta)} 天${delta < 0 ? '前' : '后'}的早上`, 晚: `${Math.abs(delta)} 天${delta < 0 ? '前' : '后'}的晚上` }[kind];
};
const SAID = { 大后天: [3, '天'], 后天: [2, '天'], 明早: [1, '早'], 明晚: [1, '晚'], 明天: [1, '天'], 明儿: [1, '天'], 明日: [1, '天'], 今早: [0, '早'], 今晚: [0, '晚'], 今夜: [0, '晚'], 今天: [0, '天'], 今儿: [0, '天'] };
// 按年、按月走的局（章程 G2）：换的是"今年／明年／去年""这个月／下个月"
const UNIT_SAID = {
    年: { re: /大后年|后年|明年|来年|今年|去年|前年/g, at: { 大后年: 3, 后年: 2, 明年: 1, 来年: 1, 今年: 0, 去年: -1, 前年: -2 }, say: d => ({ 0: '今年', 1: '明年', 2: '后年', [-1]: '去年', [-2]: '前年' }[d] ?? `${Math.abs(d)} 年${d < 0 ? '前' : '后'}`) },
    月: { re: /下下个月|下个月|这个月|上个月|上上个月/g, at: { 下下个月: 2, 下个月: 1, 这个月: 0, 上个月: -1, 上上个月: -2 }, say: d => ({ 0: '这个月', 1: '下个月', 2: '下下个月', [-1]: '上个月', [-2]: '上上个月' }[d] ?? `${Math.abs(d)} 个月${d < 0 ? '前' : '后'}`) },
};
export function retime(text, saidDay, today, timeScale = DAY) {
    const ts = scaleOf(timeScale);
    if (ts.unit !== '天') {
        const u = UNIT_SAID[ts.unit];
        return u ? String(text ?? '').replace(u.re, w => u.say(saidDay + u.at[w] - today)) : String(text ?? '');
    }
    // 一遍换完（分几遍换会把换出来的"今早"再换一次）
    return String(text ?? '').replace(/大后天|后天|明早|明晚|明天|明儿|明日|今早|今晚|今夜|今天|今儿/g, w => dayWord(saidDay + SAID[w][0] - today, SAID[w][1]));
}

// 和他有关的：他是办的人或跟谁里的一个（same＝认名字，别名也认）。
export const partyOf = (p, name, same = (a, b) => a === b) => [...p.doers, ...p.with].some(x => same(x, name));

// 给开口的人的几行（只给当事人；在场开口时才给）。stages：[{p, stage}]；when(日差)→"昨天"之类。
// 每组至多三条；同一件事记了两条的（说法几乎一样）只给一条。
const HEAD = {
    today: (name, user) => `今天说好的（你们自己定下的事，不是要${name}去提醒谁的清单：照办、顺手改个安排、先顾眼前更要紧的、干脆不去了，都由${name}按自己的性子和眼前的场面来——正文里有个交代就行；改了、没办成，都会被记下，往后有人会提起）：`,
    // 玩家累着、难受时的口气（用户 10/2）：说好的事先放着，别催
    hold: (name, user) => `今天说好的事先放着——${user}这会儿起不来、不想动。改期、等${personWord(user)}、自己先去办、还是先顾${personWord(user)}，由${name}按自己的性子来；别一句句催，正文里有个交代就行：`,
    late: (name, user) => `说好了、还没见办的（过了说好的时候；正文里其实已经办了的就当没看见这一行。补上、改天、还是不了了之，看${name}和${user}，别替${user}拿主意）：`,
    overdue: () => '说好了、到日子没办的（还没个说法。谁在意、在意多少，看各人的性子和两人的关系；可以提，可以不提，不必写成记仇）：',
    met: name => `说好"等到那时候再办"的，那时候到了（办不办、什么时候办，由${personWord(name)}）：`,
    eve: () => '明天说好的（记着就行）：',
    lapse: () => '有件说好的事一直没办、也没人再提，就这么过去了（不用特意提起；谁会在意、在意多少，看各人的性子和关系）：',
};
export const ORDER = ['today', 'late', 'met', 'overdue', 'eve', 'lapse'];
// hold＝玩家眼下累着、难受：今天、过了时候的那两组合成一组"先放着"的口气；hold='drop' 时干脆不给（Q 实测：哪怕写着"先放着"，
// 只要约定还在眼前，他照样倒数、下通牒——他本来就记得，不提才是让路）
export function promiseLines(stages, { name, userName = '对方', today, when = d => `${d} 天前`, same = (a, b) => a === b, hold = false }) {
    const out = [];
    for (const stage of ORDER) {
        if (hold && stage === 'late') continue;
        if (hold === 'drop' && stage === 'today') continue;
        const rows = [];
        for (const { p } of stages.filter(x => (hold && stage === 'today' ? x.stage === 'today' || x.stage === 'late' : x.stage === stage) && partyOf(x.p, name, same))) {
            if (rows.some(q => overlap(q.r.text, p.r.text) > 0.6)) continue;
            rows.push(p);
        }
        if (!rows.length) continue;
        out.push((hold && stage === 'today' ? HEAD.hold : HEAD[stage])(name, userName), ...rows.slice(0, 3).map(p => {
            const at = p.due?.part && ['today', 'late', 'eve'].includes(stage) ? `${p.due.part}：` : '';
            const who = [...new Set([...p.doers, ...p.with])].join('、');
            return `· ${at}${retime(p.r.text, p.saidDay, today).replace(/[。．.]+$/, '')}（${who}；${when(today - p.saidDay)}说的）`;
        }));
    }
    return out;
}

// 两句话字面有多像（同一件事记了两条）：两字组的重合比例，按短的那句算。
function overlap(a, b) {
    const grams = s => { const t = String(s ?? '').replace(/[\s\p{P}]/gu, ''); const out = new Set(); for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2)); return out; };
    const x = grams(a), y = grams(b);
    if (!x.size || !y.size) return 0;
    let n = 0;
    for (const g of x) if (y.has(g)) n++;
    return n / Math.min(x.size, y.size);
}

// 后台排的事和今天的约定是不是一回事：牵头的是约定里的第三个人（当事人或约定里说到的人，names(text)→说到的人；
// 在场的人不算——主角们是几乎每件事的当事人，按人认就全都"有关"了）；或者题目、露面和约定字面很近。
// "用在"（这件事什么场合用）和约定说的是同一种场合：去掉人名后，有一个实在的两字词对得上（"看房""验货"）。
// 试玩 10/5：一件口袋的题目和露面里没有"房"字，"用在"写着"某人出门看房的时候"，和"看完病一起去看房子"判成了无关，口袋一直冻着。
const LIGHT = new Set('的了着过在是不有和与或都也就还很把被让给从到时候们这那个一些么什怎吗呢吧啊去来出上下里后前说要会能想得地他她你我人事回自己以再先又才天今明早晚边旁行');
export const plainOf = (s, names = []) => [...names].filter(Boolean).sort((a, b) => b.length - a.length)
    .reduce((t, n) => t.split(n).join(' '), String(s ?? '')).replace(/[A-Za-z]+/g, ' ');
const solidGrams = (s, names) => {
    const out = new Set();
    for (const run of plainOf(s, names).split(/[\s\p{P}]+/u)) for (let i = 0; i < run.length - 1; i++) {
        const g = run.slice(i, i + 2);
        if (/^[一-鿿]{2}$/.test(g) && !LIGHT.has(g[0]) && !LIGHT.has(g[1])) out.add(g);
    }
    return out;
};
export function sameOccasion(fit, text, names = []) {
    const y = solidGrams(text, names);
    return [...solidGrams(fit, names)].some(g => y.has(g));
}

// byPeople：约定里说到的、不在场的人牵头的事也算跟着它（多半是去办那件事时见到他）。'named'：只认约定里点到的第三个人（"去丁的诊所"之于丁牵头的事），
// 办约定的、约定跟谁的都不算（两个主角几乎件件都有份，按他们挂等于全挂上）——说"是一回事"、事账里两边互记编号这么认；让路时宽着认（true）
// （试玩 10/7：事账按"都是他"把他牵头的每件口袋都挂到他第四天吃过了的烤肉约定上，那一格写着"这件和今天说好的吃烤肉是一回事"）
export function relatedTo(p, item, { same = (a, b) => a === b, names = () => [], present = [], byPeople = true } = {}) {
    if (item.promise_ref != null) return item.promise_ref === p.id;   // 规划者写明了跟着哪件
    const people = (byPeople === 'named' ? names(p.r.text).filter(x => ![...p.doers, ...p.with].some(d => same(d, x))) : [...p.doers, ...p.with, ...names(p.r.text)]).filter(x => !present.some(n => same(n, x)));
    if (byPeople && people.some(x => same(x, item.who))) return true;
    // 字面对得上：人名和英文名先拿掉（短的约定里"某某"几个字就占了一大半，不去掉就件件都"对得上"）
    const who = [...p.doers, ...p.with, item.who].filter(Boolean);
    if (overlap(plainOf(`${item.title ?? ''}${item.surface ?? ''}`, who), plainOf(p.r.text, who)) >= 0.25) return true;
    return !!item.fit && sameOccasion(item.fit, p.r.text, [...present, ...p.doers, ...p.with]);
}

// 办了没人记"了结"（用户 10/8："事账里好像累积了很多事都是排着的状态，但很多都已经了结了"——线上那档记账常常漏掉了结）：
// 眼前的、定了日子的约定，到期前后办的人自己名下有一条"做"（或"说"了办成了）和它说的是同一件（去掉人名后字面重合够多），就算办了。
// list：约定记录；records：看得见的全部记录；dayOf(pos)：第几天。返回 Map(约定编号 → 办了的那条 {id, pos})
export function settledByDoing(list, records, { dayOf = () => 0, same = (a, b) => a === b } = {}) {
    const out = new Map();
    const of = r => { let p = r.promise; if (typeof p === 'string') { try { p = JSON.parse(p); } catch { p = null; } } return p; };
    for (const r of list) {
        const p = of(r);
        if (!p || !['眼前', '定了日子'].includes(p.kind)) continue;
        const doers = Array.isArray(p.doers) && p.doers.length ? p.doers : [r.holder_name ?? r.holder];
        const names = [...doers, ...(Array.isArray(p.with) ? p.with : [])].filter(Boolean);
        const said = dayOf(r.pos);
        const mine = plainOf(r.text, names);
        const done = records.find(x => x.pos > r.pos && x.id !== r.id && ['做', '说'].includes(x.type) && !x.guess && !x.promise && doers.some(d => same(d, x.holder_name))
            && dayOf(x.pos) - said <= 2 && (x.type === '做' ? overlap(plainOf(x.text, names), mine) >= 0.3 || (r.keys ?? []).filter(k => k.length >= 2 && x.text.includes(k)).length >= 2 : /办了|办好了|办完了|做了|做完了|弄好了|搞定了|送到了|付了|签了|拿到了/.test(x.text) && overlap(plainOf(x.text, names), mine) >= 0.4));
        if (done) out.set(r.id, { id: done.id, pos: done.pos });
    }
    return out;
}

// 同一件约定记了好几条（试玩 10/5：四条"明天去老维那儿"，诊所看完了结了一条，另外三条一直挂着"今天要办"）：
// 了结的那条之前说的、同一拨人、字面很像的，跟着算了结。closedAt：被了结的约定编号 → 了结记在哪条消息上。
export function settledTwins(list, closedAt) {
    const of = r => { let p = r.promise; if (typeof p === 'string') { try { p = JSON.parse(p); } catch { p = null; } } return p; };
    const doersOf = r => (Array.isArray(of(r)?.doers) && of(r).doers.length ? of(r).doers : [r.holder_name ?? r.holder]);
    const done = list.filter(r => closedAt.has(r.id));
    const out = new Set();
    for (const r of list) {
        if (closedAt.has(r.id) || !of(r)) continue;
        if (done.some(c => closedAt.get(c.id) > (r.pos ?? 0) && doersOf(c).some(d => doersOf(r).includes(d))
            && overlap(plainOf(c.text), plainOf(r.text)) >= 0.4)) out.add(r.id);
    }
    return out;
}
