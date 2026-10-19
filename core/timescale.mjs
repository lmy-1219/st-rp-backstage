// 时间尺度（章程 G2）：这一局"一格时间"是小时、天、月还是年，一格里分哪几段。开局单"时间"那一格的"尺度"写着：
// { 单位: '小时'|'天'|'月'|'年', 时段: ['…'] }；不写就是天＋早上到凌晨八段（老开局单都是这样，行为和以前一字不差）。
// 后台凡是"第几天""今天""过了几天""几天后沉底""持续几周"的，都从这里取：数的是这一局的单位，说法用这一局的词。
// 题材无关：单位、时段都来自开局单；默认的几种分段（早上……、春夏秋冬、上中下旬）是通用的说法。

// 一天里的先后（凌晨排在深夜后面：故事里的"这一天"一般熬到睡下才算完）。
export const DAY_PARTS = ['早上', '上午', '中午', '下午', '傍晚', '晚上', '深夜', '凌晨'];
export const UNITS = ['小时', '天', '月', '年'];

// 各单位的那张表（汇报里的"天"表就是它）：
//   days        一格折多少天（认"过了多久"时换算用）
//   parts       没写时段时的默认分段
//   word        "过了 N ___"、"N ___后"；ord：第 N ___
//   partsWord   一格里那几段叫什么；story：给模型的"剧情日"那个词
//   this／prev／prev2／next：今天／昨天／前天／明天 的说法
//   perWeek     物价、持续的事每隔几格掷一次骰（天＝一周 7 天）
//   planCap     规划"第几天后"最多写到几（天＝60）
//   sink／slow  口袋里放几格没人碰就沉底（天＝2）；慢沉的（天＝5）
//   long        持续一阵的事拖多久 [最短, 最长]（天＝14～42）；fresh：走完多久以内才补一句"过去了"（天＝14）
//   expire      待办记下多久以后不算（天＝14）；lapse：约定过了日子多久没说法就收（天＝2）
const TABLE = {
    小时: { days: 1 / 24, parts: [], word: '小时', ord: '个小时', partsWord: '时段', story: '剧情钟点', this: '这个钟点', prev: '一小时前', prev2: '两小时前', next: '下一个小时', nextText: '一小时后', perWeek: 24, planCap: 72, sink: 6, slow: 12, long: [6, 18], fresh: 24, expire: 72, lapse: 2 },
    天: { days: 1, parts: DAY_PARTS, word: '天', ord: '天', partsWord: '时段', story: '剧情日', this: '今天', prev: '昨天', prev2: '前天', next: '明天', nextText: '第二天', perWeek: 7, planCap: 60, sink: 2, slow: 5, long: [14, 42], fresh: 14, expire: 14, lapse: 2 },
    月: { days: 365 / 12, parts: ['上旬', '中旬', '下旬'], word: '个月', ord: '个月', partsWord: '旬', story: '剧情月', this: '这个月', prev: '上个月', prev2: '上上个月', next: '下个月', nextText: '次月', perWeek: 12, planCap: 24, sink: 1, slow: 3, long: [2, 6], fresh: 3, expire: 3, lapse: 2 },
    年: { days: 365, parts: ['春', '夏', '秋', '冬'], word: '年', ord: '年', partsWord: '季', story: '剧情年', this: '今年', prev: '去年', prev2: '前年', next: '明年', nextText: '次年', perWeek: 10, planCap: 20, sink: 1, slow: 2, long: [2, 6], fresh: 2, expire: 2, lapse: 2 },
};

const cache = new Map();
function build(unit, parts) {
    const key = `${unit}|${parts.join('、')}`;
    if (cache.has(key)) return cache.get(key);
    const t = TABLE[unit];
    const s = Object.freeze({
        ...t, unit, parts: Object.freeze([...parts]),
        isDay: unit === '天' && parts.join('、') === DAY_PARTS.join('、'),
        // span：3 天／3 年／3 个月；ordinal：第3天（标签上的写法）；nth：第 3 天（给模型的写法，带空格）
        unitWord: t.word, span: n => `${n} ${t.word}`, ordinal: n => `第${n}${t.ord}`, nth: n => `第 ${n} ${t.ord}`,
    });
    cache.set(key, s);
    return s;
}
export const DAY = build('天', DAY_PARTS);

// 开局单 → 尺度。x 可以是整份开局单（有"时间"）、"时间"那一格（有"尺度"）、"尺度"本身（有"单位"），或者已经算好的尺度；
// 什么都没写、写的认不出，就是默认的天。时段写成"春、夏、秋、冬"一串也认；没写时段就用那个单位的默认分段。
export function scaleOf(x) {
    if (!x || typeof x !== 'object') return DAY;
    if (typeof x.unit === 'string' && Array.isArray(x.parts) && typeof x.ordinal === 'function') return x;
    let raw = x.单位 != null ? x : x.尺度 !== undefined ? x.尺度 : x.时间?.尺度 ?? null;
    if (typeof raw === 'string') raw = { 单位: raw };
    if (!raw || typeof raw !== 'object') return DAY;
    const unit = unitOf(raw.单位) ?? '天';
    const parts = partsOf(raw.时段);
    return build(unit, parts.length ? parts : TABLE[unit].parts);
}
export const unitOf = v => { const s = String(v ?? '').trim(); return UNITS.find(u => s === u || s === `${u}尺度` || (u === '小时' && /^(钟点|时辰|钟头)$/.test(s)) || (u === '月' && s === '个月') || (u === '年' && s === '载')) ?? null; };
export const partsOf = v => [...new Set((Array.isArray(v) ? v : String(v ?? '').split(/\s*[、,，/｜|;；\s]\s*/)).map(p => String(p ?? '').trim()).filter(Boolean))].slice(0, 12);

// ---------- 认"过了多久" ----------
// 中文数：一二三……十百千万、两、几／数（＝三，"十几"＝十三、"几十"＝三十）、半；阿拉伯数字。认不出 null。
export function cnCount(raw) {
    const s0 = String(raw ?? '').trim();
    if (/^[0-9０-９]+(\.\d+)?$/.test(s0)) return Number(s0.replace(/[０-９]/g, c => String(c.charCodeAt(0) - 0xff10)));
    if (s0 === '半') return 0.5;
    const s = s0.replace(/[几数]/g, '三');
    const D = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
    const M = { 十: 10, 百: 100, 千: 1000 };
    let total = 0, section = 0, num = 0;
    for (const ch of s) {
        if (ch in D) num = D[ch];
        else if (ch in M) { section += (num || 1) * M[ch]; num = 0; }
        else if (ch === '万') { total += (section + num || 1) * 10000; section = 0; num = 0; }
        else return null;
    }
    return total + section + num;
}
// 像年份的数（"2000 年""二〇〇〇年"）：是纪年，不是过了多久
const CALENDAR = /^(?:[0-9０-９]{4,}|[〇零一二三四五六七八九]{3,})$/;
const N = '[0-9０-９零〇一二两三四五六七八九十百千万几数半]+';
const NB = '(?<![第那这哪每去今明前同当本上下次0-9０-９零〇一二两三四五六七八九十百千万几数半])';
// 大单位（天以上、以前不认的）：世纪、甲子、年／载、季、旬，加上"次年""来年""次月"这类。天尺度也认（"一走三年"＝1095 天）。
const BIG = [
    [new RegExp(`${NB}(${N})\\s*个\\s*世纪`), 36500],
    [new RegExp(`${NB}(${N})\\s*(?:个\\s*)?甲子`), 21900],
    [new RegExp(`${NB}(${N})\\s*(?:个\\s*)?(?:年|载)(半)?(?![前来纪级代轻龄份华货画会一])`), 365],
    [new RegExp(`${NB}(${N})\\s*(?:个\\s*)?季(?:度)?(?![如节风报])`), 91.25],
    [new RegExp(`(?<!过)${NB}(${N})\\s*旬(?![老])`), 10],
];
const NEXT_YEAR = /第二年|次年|翌年|来年|隔年|转年|一年过去/;
const NEXT_MONTH = /次月|第二个月|一个月过去/;
// 小一些的单位（非天尺度才这样认；天尺度照老规矩，见 legacyDays）
const SMALL = [
    [new RegExp(`${NB}(${N})\\s*个\\s*月|${NB}(半)\\s*个?\\s*月(?!份)|${NB}(${N})\\s*月(?=之?后|以后|过去|有余|多)`), 365 / 12],
    [new RegExp(`${NB}(${N})\\s*(?:个\\s*)?(?:周|星期|礼拜)(?![围边遭身全一])`), 7],
    [new RegExp(`(?<!第)${NB}(${N})\\s*(?:天|日|晚|夜)(?!黑|亮)`), 1, m => m !== '半'],
    [new RegExp(`${NB}(${N})\\s*个?\\s*(?:小时|钟头)`), 1 / 24],
    [new RegExp(`${NB}(${N})\\s*个?\\s*时辰`), 1 / 12],
];
// 头一个有值的组是数；年那条后面还可能跟一个"半"（"三年半"）
const count = (m, days) => {
    const [raw, ...rest] = m.slice(1).filter(x => x != null);
    if (raw == null || CALENDAR.test(raw)) return null;
    const n = cnCount(raw);
    return n == null ? null : (n + (rest.includes('半') ? 0.5 : 0)) * days;
};
function spanDays(t, list) {
    for (const [re, days, ok = () => true] of list) {
        const m = re.exec(t);
        if (m && ok(m[1])) { const d = count(m, days); if (d != null) return d; }
    }
    return null;
}
function bigDays(t) {
    const d = spanDays(t, BIG);
    if (d != null) return d;
    if (NEXT_YEAR.test(t)) return 365;
    if (NEXT_MONTH.test(t)) return 30;
    return null;
}

const CN_NUM = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 半: 0.5 };
function parseNumber(s) {
    if (/^\d+$/.test(s)) return Number(s);
    if (s === '十') return 10;
    if (s.startsWith('十')) return 10 + (CN_NUM[s[1]] ?? 0);
    if (s.includes('十')) return (CN_NUM[s[0]] ?? 1) * 10 + (CN_NUM[s[2]] ?? 0);
    return CN_NUM[s] ?? 1;
}
// 老规矩（天尺度一直是这样认的，一字没改）："过了多久"换成天数。说得出几天几周几个月的照算；只说了"一夜/第二天/天亮/醒来"的算一天；
// 别的（几个小时、天黑前、约定的时间点）不算跨天。
export function legacyDays(text) {
    const t = String(text ?? '');
    let m;
    if ((m = /([0-9一二两三四五六七八九十半]+)\s*个?月/.exec(t))) return Math.round(parseNumber(m[1]) * 30);
    if ((m = /([0-9一二两三四五六七八九十半]+)\s*(周|星期|礼拜)/.exec(t))) return Math.round(parseNumber(m[1]) * 7);
    // "半天""半夜"不到一天（半夜是时段），不算跨天
    if ((m = /(?<!第)([0-9一二两三四五六七八九十半]+)\s*(天|日|晚|夜)(?!黑|亮)/.exec(t)) && m[1] !== '半') return Math.max(1, Math.round(parseNumber(m[1])));
    return nightDays(t);
}
// 老规矩里没写数的那一半：一夜、第二天、天亮了算一天；同一天里的时段不算。
function nightDays(t) {
    // "深夜""夜里""入夜"只是一天里的时段，不是过了一夜（试玩 10/1：开场那条记成"时间：深夜"，开场就多算了一天）
    // "第三天上午"（玩家交代跳过的一段，"这两天没出门，第三天上午……"）：从那天算起过了两天（试玩 10/11：算成了 0）
    const nth = /(?<![0-9一二两三四五六七八九十百])第\s*([三四五六七八九]|十)\s*[天日](?![0-9])/.exec(t);
    if (nth) return { 三: 2, 四: 3, 五: 4, 六: 5, 七: 6, 八: 7, 九: 8, 十: 9 }[nth[1]];
    if (/一夜|过夜|整夜|通宵|一宿|夜过去|次日|第二天|隔天|翌日|天亮/.test(t)) return 1;
    // "早上""清晨""醒"只在说的是睡到、等到了早上时算过了一夜；"从早上到午后""午睡醒了"是同一天
    // （试玩 10/5：玩家写"已经过了午后"，记成"从早上到午后"，那一格就成了第二天下午，前台跟着说"昨天在诊所"）。
    if (/(从|自)\s*(清晨|早上|早晨|一早)/.test(t)) return 0;
    if (/中午|午后|下午|傍晚|黄昏|晚上|天黑/.test(t) && !/清晨|早上|早晨|一早/.test(t)) return 0;
    if (/(睡|躺|熬|守|坐|等|待|撑|挨)[^，。,；]{0,6}(到|至)[^，。,；]{0,3}(清晨|早上|早晨)|(到了|直到|一直到)\s*(清晨|早上|早晨)|(清晨|早上|早晨)[^，。,；]{0,3}醒|一觉醒来/.test(t)) return 1;
    // 天快亮了（试玩 10/6："从半夜到天光微亮"没认出来，过了一夜还是同一天）
    if (/天(光|色|已|刚|蒙蒙|擦)?[^，。,；还]{0,3}(亮|白)(?!着)|破晓|拂晓|黎明|晨光/.test(t)) return 1;
    return 0;
}

// "过了多久"折成这一局的单位。规则：
//   · 认得：世纪、甲子、年／载、季、个月、旬、周、天／日／晚／夜、小时／钟头、时辰；中文数字、阿拉伯数字、半（"半年""三年半"）、几（＝三）。
//   · 一句里有几个单位，只认最大的那个（"一年零三个月"按一年）。"第三年""那一年""三年前""2000 年"不算过了多久。
//   · 天尺度：年、季、旬、"次年""来年"这些新认的先看；没有就照老规矩（legacyDays）——以前认得的一个字没变。
//   · 别的尺度：按天数折算后四舍五入：不到半格算 0（年尺度下"三个月"＝0.25 → 0），够半格进一（"半年"＝0.5 → 1）。
//   · exact：true 时不取整，给 dayIndex 累加用（四个"三个月"＝一年）。
export function elapsedUnits(text, timeScale = DAY, { exact = false } = {}) {
    const s = scaleOf(timeScale);
    const t = String(text ?? '');
    if (s.unit === '天') {
        const big = bigDays(t);
        return big != null ? Math.round(big) : legacyDays(t);
    }
    const days = bigDays(t) ?? spanDays(t, SMALL) ?? nightDays(t);
    const units = days / s.days;
    return exact ? units : Math.round(units);
}

// 往回说多久以前（天尺度和以前的 relativeDay 一字不差）。
export function relativeUnit(delta, timeScale = DAY) {
    const s = scaleOf(timeScale);
    const d = delta;
    if (s.unit === '天') {
        if (d <= 0) return '今天早些时候';
        if (d === 1) return '昨天';
        if (d === 2) return '前天';
        if (d < 14) return `${d} 天前`;
        if (d < 60) return `约 ${Math.round(d / 7)} 周前`;
        return `约 ${Math.round(d / 30)} 个月前`;
    }
    if (s.unit === '年') {
        if (d <= 0) return '今年早些时候';
        if (d === 1) return '去年';
        if (d === 2) return '前年';
        if (d < 20) return `${d} 年前`;
        if (d < 100) return `约 ${Math.round(d / 10) * 10} 年前`;
        return `约 ${Math.round(d / 100)} 百年前`;
    }
    if (s.unit === '月') {
        if (d <= 0) return '这个月早些时候';
        if (d === 1) return '上个月';
        if (d < 12) return `${d} 个月前`;
        return `约 ${Math.round(d / 12)} 年前`;
    }
    if (d <= 0) return '刚才';
    if (d < 48) return `${d} 小时前`;
    return `约 ${Math.round(d / 24)} 天前`;
}

// 给模型的一句（天尺度不加，提示词一字不变）：这一局按什么单位走，提示词里写"天""剧情日"的地方照这个读。
export function scaleNote(timeScale) {
    const s = scaleOf(timeScale);
    if (s.isDay) return '';
    if (s.unit === '天') return `【这一局的时间】一天分这几段：${s.parts.join('、')}。下面说"时段"的，指的是这几段。`;
    return `【这一局的时间】这一局的时间按「${s.unit}」走：下面凡写"剧情日""第几天""天""当天""今天""明天""三天内""几天后"的，都换成「${s.unit}」读`
        + `（剧情日＝${s.story}，第几天后＝第几${s.word}后、最多 ${s.planCap}，当天＝${s.this}，明天＝${s.next}，三天内＝三${s.word}内，几天后＝几${s.word}后）；`
        + (s.parts.length ? `一${s.word}分这几段：${s.parts.join('、')}，下面说"时段"的，指的是这几段。` : '一格里不分时段。');
}
