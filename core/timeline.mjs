// 剧情日期（白皮书 §5.6，N-117、N-265）：每条消息是第几天、几月几号星期几、一天里的什么时候，今天什么天气。
// 跨天：记账的"时间"记录为主、强线索当哨兵（recall.timeSkipIn）、用户在消息"…"菜单里点的为最高权威
// （存在那条消息的附加字段 extra.rp_day 里，跟着聊天文件走；同步时带过来，见 store.sync）。
// 拿不准的（记账标了"拿不准"、叙述里有强线索但没记成跨天、天黑以后又写到了早上）不推进，挂问号等用户点。
// 时段是软信息：开局单写的开场时段 → 跨天那句写的 → 记账写的"时段" → 此刻的样子报的时段（state.mjs）→ 叙述里写到的（只认叙述、只往后走）。
// 认跨天的权威（章程 I1）：用户手点 > 记账"时间"记录（写明了的）> 此刻的样子报的"第二天·早上"（noteMarks）> 叙述硬词（timeSkipIn）。
// 天气：开局单"时间"那一格给的几种、各占几成，每天由程序掷——同一局同一天怎么重来都一样，连着几天多半一样；聊天里写到了天气，以聊天为准。
// 题材无关：日期、天气、时段都来自开局单和聊天。
// 时间尺度（章程 G2）：开局单"时间"那一格写了"尺度"（按年、按月、按小时走，一格里分哪几段）的，"第几天"就是第几年／第几个月，
// 时段是开局单写的那几段；没写就是天＋下面八段，和以前一字不差。
import { dayIndex, timeSkipIn } from './recall.mjs';
import { scaleOf, DAY_PARTS, relativeUnit } from './timescale.mjs';

// 一天里的先后（凌晨排在深夜后面：故事里的"这一天"一般熬到睡下才算完）。默认尺度的那八段；别的尺度用 scaleOf(开局单).parts。
export const PARTS = DAY_PARTS;
const PART_WORDS = [
    [/凌晨|黎明|破晓/, '凌晨'],
    // 晚上十二点、午夜、零点是深夜那一格（试玩 10/11："到了晚上十二点"标成了晚上）；中午十二点不算
    [/(?:晚上|夜里|夜间|半夜|夜)\s*(?:十二|12|１２)\s*点|零点(?![零〇一二三四五六七八九0-9])|子夜/, '深夜'],
    [/清晨|一大早|一早|早上|早晨|清早|今早|天亮|天刚亮|日出|天光|晨光|天色发白|天蒙蒙亮|天边发白/, '早上'],
    [/上午/, '上午'],
    [/中午|正午|晌午/, '中午'],
    [/午后|下午/, '下午'],
    [/傍晚|黄昏|日落|天擦黑/, '傍晚'],
    [/深夜|半夜|午夜|夜深/, '深夜'],
    [/晚上|夜里|入夜|夜晚|天黑|今晚|夜幕/, '晚上'],
];
// 开局单自己写了时段（不是默认那八段）：时段名照字面认，一句里有几个取最后写到的那个
const custom = timeScale => { const s = scaleOf(timeScale); return s.parts.join('、') === DAY_PARTS.join('、') ? null : s.parts; };
const findCustom = (str, parts) => { let best = null, at = -1; for (const p of parts) { const i = str.lastIndexOf(p); if (i > at) { at = i; best = p; } } return best; };

// 一段话里说的是一天里的什么时候（"第二天早上"→早上）；说不出就 null。
// "从半夜到天光微亮""一直熬到早上"说的是一段时间：现在是那段的末尾（试玩 10/6：取了开头的"半夜"，过完一夜成了第二天深夜）。
// timeScale：这一局的尺度，时段是开局单写的那几段时按字面认（"次年开春"→春）。
export function partOf(text, timeScale = null) {
    const t = String(text ?? '');
    const own = custom(timeScale);
    const find = own ? s => findCustom(s, own) : s => { for (const [re, part] of PART_WORDS) if (re.test(s)) return part; return null; };
    const cut = Math.max(t.lastIndexOf('到'), t.lastIndexOf('至'));
    return (cut >= 0 ? find(t.slice(cut + 1)) : null) ?? find(t);
}
// 开局单、用户写的时段，认得出的换成上面几种之一。
export const canonicalPart = (text, timeScale = null) => (scaleOf(timeScale).parts.includes(String(text ?? '').trim()) ? String(text).trim() : partOf(text, timeScale));

// 叙述：括号里的（这一局的写法：括号里是动作和所见所感、括号外是说出口的话）、*星号*里的；都没有就是引号外的（小说写法）；
// 括号、引号都没有的一句（"早上再说，先睡。"）多半是嘴上说的，不算叙述。
const QUOTED = /“[^”]*”|"[^"\n]*"|「[^」]*」|『[^』]*』/g;
const NARRATION = /（[^）]*）|\([^)]*\)|\*[^*\n]+\*/g;
export function narrationOf(text) {
    const t = String(text ?? '');
    const parts = t.match(NARRATION);
    if (parts?.length) return parts.join('\n');
    const outside = t.replace(QUOTED, '');
    return outside === t ? '' : outside;
}

// 叙述里写到"此刻是一天里的什么时候"：只认句首（开头、标点、换行、括号后）的时段词（"傍晚从码头回来""入夜，雨……"）。
// "早上那会儿他说过""早上的事"（回忆）、"明天早上再说"（打算，不在句首）都不算。
const WORDS = PART_WORDS.map(([re]) => re.source).join('|');
const CUE = new RegExp(`(?:^|[。！？!?…\\n（(*，,；;]\\s*)(?:到了|已经是|已是|此时已是|这时已是|转眼(?:到了)?|直到)?(${WORDS})(?!那|这|的(?!时候))`);
const esc = x => x.replace(/[.*+?^${}()|[\]\\]/g, c => `\\${c}`);
export function clockCue(text, timeScale = null) {
    const own = custom(timeScale);
    if (own) {
        if (!own.length) return null;
        const re = new RegExp(`(?:^|[。！？!?…\\n（(*，,；;]\\s*)(?:到了|已经是|已是|此时已是|这时已是|转眼(?:到了)?|直到)?(${own.map(esc).join('|')})(?!那|这|的(?!时候))`);
        const m = re.exec(narrationOf(text));
        return m ? m[1] : null;
    }
    const m = CUE.exec(narrationOf(text));
    return m ? partOf(m[1]) : null;
}

// 叙述里不在句首、但写到了比现在靠后的时段（"……屋里暗下来，已是深夜""下午的光斜进来"）：当作往后走的线索，只往后不往前
// （试玩 10/11：一整段标"傍晚"，正文里早写到了深夜、晚上）。明天、昨天、改天、每到、等到这类说的不是此刻，"……那会儿""……再说"也不算。
// 只认默认那八段（开局单自己写的时段，像"春""秋"，单字太容易撞上别的词，只认句首的）。current：现在的时段。
// 只认写明"到了这个时候"的：前面是"已是／到了／过了／熬到了……"，或后面跟着"了／已经／时分／的光……"。光是提到不算
// （试玩 10/12：回忆"那个晚上"、打算"惦记我晚上睡哪"、"周三夜里有咸潮"、"从半夜到天光微亮"的"半夜"、比喻"像半夜散场的排练室"、
// 叙述里引的一句"晚上有约"，都被当成了此刻，第二天整个白天标成了"深夜"）。叙述里的引号（引的话）先去掉。
const LATER = /(中午|正午|晌午|午后|下午|傍晚|黄昏|晚上|夜里|入夜(?!色)|天黑了|深夜|半夜|午夜|夜深|夜色|雨夜|夜幕)/g;
// 写景的（"融入夜色""撕裂雨夜"）本身就是此刻，不用"到了"；算晚上
const SCENE = { 天黑了: '晚上', 夜色: '晚上', 雨夜: '晚上', 夜幕: '晚上' };
const NOT_NOW = /(?:明天?|昨天?|前天|后天|改天|每天?|每到|一到|等到?|到时|那天|那个|这个|那|周[一二三四五六日天末]|星期[一二三四五六日天]|礼拜[一二三四五六日天]|像|如|似|仿佛|好像|没到|未到|不到|还没|融)\s*$/;
const ARRIVED = /(?:(?:已经|早已|已|业已)(?:是|到了?|过了|入了?)?|(?<![没未不])(?:到了|过了)|转眼(?:就)?(?:到了|是)?|一?直到|[熬耗拖捱挨磨混坐躺忙聊腾]到了?)\s*$/;
const NOT_NOW_AFTER = /^(?:那|这|再|见|之前|以前|前|茶|饭前|的事|的时候再|才|去|来|有约|要)/;
const SETTLED = /^(?:了(?![解结])|已|时分|将近|将尽|过半|降临|笼罩|渐深|人静|的(?:光|阳光|日光|日头|太阳|天光|天色|夜色|余晖|霞光|月光|街灯|路灯|冷意|凉意|寒气|雨|风))/;
export function laterCue(text, current, timeScale = null) {
    if (custom(timeScale) || !current) return null;
    const rank = p => DAY_PARTS.indexOf(p);
    const nar = narrationOf(text).replace(QUOTED, '');
    let best = null;
    for (const m of nar.matchAll(LATER)) {
        const before = nar.slice(Math.max(0, m.index - 8), m.index), after = nar.slice(m.index + m[0].length, m.index + m[0].length + 8);
        if (NOT_NOW.test(before) || NOT_NOW_AFTER.test(after)) continue;
        if (!(SCENE[m[1]] || ARRIVED.test(before) || SETTLED.test(after))) continue;
        const p = SCENE[m[1]] ?? partOf(m[1]);
        if (p && p !== '凌晨' && rank(p) > rank(current) && (!best || rank(p) > rank(best))) best = p;
    }
    return best;
}

// ---------- "此刻的样子"里报的时段（state.mjs，方面＝时段，谁＝此地）----------
// 写法："早上"（同一格里往后走）、"第二天·早上""过了两天·上午""第三天·下午"（跨了几格）；年尺度"第二年·春"。
// 返回 { units：跨了几格（没跨 0）, part：时段（这一局时段表里的，认不出 null）, word：跨格那半句（去重用） }。
const NUM = '[0-9０-９零〇一二两三四五六七八九十百几]+';
const UNIT_WORD = '(?:天|日|年|载|个?月|旬|个?星期|个?礼拜|周|个?小时|个?钟头)';
const ONE_MORE = /次日|翌日|隔天|隔日|转天|第二天|次年|翌年|来年|隔年|转年|次月/;
const num = s => { const n = /^\d+$/.test(s) ? Number(s) : cnNum(s); return Number.isFinite(n) ? n : null; };
function cnNum(s) {
    const D = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 几: 3 };
    let total = 0, cur = 0;
    for (const ch of String(s)) {
        if (ch in D) cur = D[ch];
        else if (ch === '十') { total += (cur || 1) * 10; cur = 0; }
        else if (ch === '百') { total += (cur || 1) * 100; cur = 0; }
        else return null;
    }
    return total + cur;
}
// 一个单位折几天（换成这一局的格数用）
const unitDays = w => (/年|载/.test(w) ? 365 : /月/.test(w) ? 365 / 12 : /旬/.test(w) ? 10 : /周|星期|礼拜/.test(w) ? 7 : /小时|钟头/.test(w) ? 1 / 24 : 1);
export function noteTime(text, timeScale = null) {
    const ts = scaleOf(timeScale);
    const t = String(text ?? '').trim();
    let n = 0, word = null, m;
    if ((m = new RegExp(`第\\s*(${NUM})\\s*(${UNIT_WORD})`).exec(t)) && num(m[1]) >= 2) { n = (num(m[1]) - 1) * unitDays(m[2]); word = m[0]; }
    else if ((m = new RegExp(`过了\\s*(${NUM})\\s*(${UNIT_WORD})|(${NUM})\\s*(${UNIT_WORD})(?:之|以)?后`).exec(t)) && num(m[1] ?? m[3]) >= 1) { n = num(m[1] ?? m[3]) * unitDays(m[2] ?? m[4]); word = m[0]; }
    else if ((m = ONE_MORE.exec(t))) { n = unitDays(/年/.test(m[0]) ? '年' : /月/.test(m[0]) ? '月' : '天'); word = m[0]; }
    const units = word ? Math.round(n / ts.days) : 0;
    const rest = word ? t.replace(word, ' ') : t;
    const part = canonicalPart(rest.replace(/^[\s·・:：，,、]+|[\s·・:：，,、]+$/g, ''), timeScale) ?? null;
    return { units, part, word };
}

// "时间"记录写明了过了多久（不是"不明""拿不准"）
const UNCLEAR = /不明|不清|不详|未知|拿不准|说不准|不确定|看不出/;
const explicitRec = r => !r.cancel && !r.clock?.unsure && !r.provisional && !r.manual && !r.absence
    && String(r.elapsed ?? '').trim() !== '' && !UNCLEAR.test(String(r.elapsed));

// 此刻的样子报了"跨了几格"的那几条，折成跨天的记号（marks 里的一种，fromNote）。权威排在记账"时间"记录之后、叙述硬词之前：
//   · 前后三条以内有记账写明了过了多久的，以记账为准（对得上不动，对不上照记账；note 的时段照旧在 timeline 里用）；
//   · 挨着的上一条时段报的也是同一个"第二天"、时段没往回走的：还是同一格（模型照抄了前一条的天数），不再算一次。
// notes：stateNotesOf 给的（带 pos）；timeRecs：看得见的"时间"记录。
export function noteMarks(notes = [], timeRecs = [], timeScale = null) {
    const ts = scaleOf(timeScale), rank = p => ts.parts.indexOf(p);
    const list = (notes ?? []).filter(n => n?.aspect === '时段' && n.text && Number.isFinite(n.pos)).sort((a, b) => a.pos - b.pos || (a.id ?? 0) - (b.id ?? 0));
    const out = [];
    let prev = null;
    for (const n of list) {
        const nt = noteTime(n.text, ts);
        const dup = nt.units > 0 && prev?.word && prev.word === nt.word && (nt.part == null || prev.part == null || rank(nt.part) >= rank(prev.part));
        if (nt.units > 0 && !dup && !timeRecs.some(r => explicitRec(r) && Math.abs(r.pos - n.pos) <= 3))
            out.push({ pos: n.pos, units: nt.units, part: nt.part, elapsed: n.text, fromNote: true, provisional: true });
        prev = nt;
    }
    return out;
}
// marks 里换上这几条（可以重复调，先去掉旧的 fromNote）；note 跨了天的，三条以内叙述硬词临时认的跳转让给 note。
export function withNoteMarks(marks = [], notes = [], timeRecs = [], timeScale = null) {
    const nm = noteMarks(notes, timeRecs, timeScale);
    const base = (marks ?? []).filter(m => !m.fromNote && !(m.provisional && !m.manual && !m.absence && nm.some(x => Math.abs(x.pos - m.pos) <= 3)));
    return [...base, ...nm];
}
// 一条消息上报的时段（取最晚记下的那笔）
const notePartAt = (notes, pos, ts) => { const n = (notes ?? []).filter(x => x?.aspect === '时段' && x.pos === pos).at(-1); return n ? noteTime(n.text, ts).part : null; };

// 日期：开局单写的开场日期（YYYY-MM-DD）往后数 day 天。认不出就 null。
export const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
const WEEK = WEEKDAYS;
export function dateOf(start, day = 0, { week = true, month30 = false } = {}) {
    const m = /^(\d{1,5})-(\d{1,2})-(\d{1,2})$/.exec(String(start ?? '').trim());
    if (!m) return null;
    if (month30) {
        const total = (Number(m[1]) * 12 + Number(m[2]) - 1) * 30 + Math.min(Number(m[3]), 30) - 1 + day;
        if (!Number.isFinite(total)) return null;
        const months = Math.floor(total / 30);
        return { y: Math.floor(months / 12), m: ((months % 12) + 12) % 12 + 1, d: ((total % 30) + 30) % 30 + 1, w: null };
    }
    const d = new Date(Date.UTC(Number(m[1]), 0, 1, 12));
    // 先还原 0～99 年，再推进月日，避免 1900 年偏移及闰日、跨年错算。
    d.setUTCFullYear(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + day);
    if (!Number.isFinite(d.getTime())) return null;
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), w: week ? WEEK[d.getUTCDay()] : null };
}

export function hasWeek(start) {
    const year = /^(\d{1,5})-/.exec(String(start?.日期 ?? '').trim())?.[1];
    return !start?.纪年?.length && (year == null || Number(year) >= 1000);
}

export function calendarOf(start) {
    return { week: hasWeek(start), month30: !!start?.纪年?.length };
}

export function weekdayIndex(start, day = 0) {
    const d = dateOf(start?.日期, day, calendarOf(start));
    return d?.w == null ? null : WEEK.indexOf(d.w);
}

const DIGITS = '零一二三四五六七八九';
function chineseNumber(n, leading = true) {
    if (n < 10) return DIGITS[n];
    if (n < 20) return `${leading ? '' : '一'}十${n % 10 ? DIGITS[n % 10] : ''}`;
    const unit = [10000, 1000, 100, 10].find(u => n >= u);
    const word = { 10000: '万', 1000: '千', 100: '百', 10: '十' }[unit];
    const rest = n % unit;
    return `${chineseNumber(Math.floor(n / unit))}${word}${rest ? `${rest < unit / 10 ? '零' : ''}${chineseNumber(rest, false)}` : ''}`;
}

// 按纪年写完整或部分日期；没有纪年时让调用方沿用原来的数字写法。
export function eraDate(start, { y, m = null, d = null }) {
    const eras = (Array.isArray(start?.纪年) ? start.纪年 : []).map(x => ({ ...x, 起: Number(x?.起) })).filter(x => typeof x?.名 === 'string' && x.名.trim() && Number.isInteger(x.起) && x.起 > 0);
    if (!eras.length) return null;
    const era = eras.filter(x => x.起 <= y).sort((a, b) => a.起 - b.起).at(-1);
    if (!era) return `${String(y).padStart(4, '0')}年${m == null ? '' : `${m}月`}${d == null ? '' : `${d}日`}`;
    const year = y - era.起 + 1;
    const month = m == null ? '' : m === 1 ? '正月' : m === 12 ? '腊月' : `${chineseNumber(m)}月`;
    const day = d == null ? '' : d <= 10 ? `初${chineseNumber(d)}` : chineseNumber(d);
    return `${era.名.trim()}${year === 1 ? '元' : chineseNumber(year)}年${month}${day}`;
}

// 天气：开局单给的 [{种, 份}]；每天按"局＋第几天"掷（不用 Math.random：同一天重来、左滑、预览都是同一个）。
// 和前一天一样的机会四成五（天气一般连着几天差不多）。
function rand(seed) {
    let h = 0x811c9dc5;
    for (const ch of String(seed)) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
    h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d) >>> 0; h ^= h >>> 12;
    return (h >>> 0) / 0x100000000;
}
const KEEP = 0.45;
export function weatherOn(kinds, seed, day) {
    const list = (Array.isArray(kinds) ? kinds : []).filter(k => k?.种 && Number(k.份) > 0);
    if (!list.length || !(day >= 0)) return null;
    const total = list.reduce((s, k) => s + Number(k.份), 0);
    const pick = r => { let x = r * total; for (const k of list) { x -= Number(k.份); if (x < 0) return k.种; } return list.at(-1).种; };
    let w = null;
    for (let i = 0; i <= day; i++) w = w && rand(`${seed}:${i}:keep`) < KEEP ? w : pick(rand(`${seed}:${i}`));
    return w;
}

// 每条消息的日子。messages＝[{pos, fp, text, mark}]（mark：用户点的 'day'＝从这条起算新的一天／'same'＝这里没有跨天）；
// timeRecs＝看得见的"时间"记录（带 clock：{part, unsure}）；marks＝slot.timeMarksFor 给的（离开、还没记账的强线索、用户点的）；
// start＝开局单的"时间"那一格；isDone(m)＝这条记过账没有。
// 返回 dayOf(pos)、today、此刻的时段，和每条的 { pos, fp, day, part, crossed, unsure, mark }。
// start 里写了尺度的，"天"就是那个单位，时段是那几段（scaleOf(start)）；返回里带上 scale、parts。
export function timeline({ messages = [], timeRecs = [], marks = [], notes = [], start = null, isDone = () => true } = {}) {
    const ts = scaleOf(start);
    const PARTS = ts.parts, rank = p => PARTS.indexOf(p);
    const partOf_ = t => partOf(t, ts), canonicalPart_ = t => canonicalPart(t, ts);
    const lastPos = messages.at(-1)?.pos ?? 0;
    const inputs = [...timeRecs, ...withNoteMarks(marks, notes, timeRecs, ts)];
    const dayOf = dayIndex(inputs, lastPos, ts);
    const counted = pos => dayOf(pos + 3) > dayOf(pos - 4);   // 前后三条以内算了跨天
    let part = canonicalPart_(start?.时段), prev = 0;
    const rows = [];
    for (const m of messages) {
        const day = dayOf(m.pos);
        const crossed = day !== prev;   // 用户把第几天往回改了也算换了一天
        const recs = timeRecs.filter(r => r.pos === m.pos);
        if (crossed) {
            // 跨天那句写了时段的照它；"一夜过去""天亮了""醒来"这种算早上；"三天后"这种不知道几点
            const said = inputs.filter(r => !r.cancel && Math.abs(r.pos - m.pos) <= 3)
                .map(r => r.clock?.part || r.part || partOf_(r.elapsed) || partOf_(r.text)).find(Boolean);
            part = canonicalPart_(said) ?? (ts.isDay && day - prev === 1 && /一夜|天亮|醒|次日|第二天|翌日|隔天/.test(inputs.filter(r => Math.abs(r.pos - m.pos) <= 3).map(r => `${r.elapsed ?? ''}${r.text ?? ''}`).join('')) ? '早上' : null);
        }
        let unsure = null;
        // 这条上记账写的时段 → 记账"过了多久"里写到的（"次日上午十点"）→ 此刻的样子报的时段 → 叙述里写到的
        const firm = canonicalPart_(recs.find(r => r.clock?.part)?.clock.part) ?? recs.map(r => partOf_(r.elapsed)).find(Boolean) ?? notePartAt(notes, m.pos, ts);
        const cue = firm ?? clockCue(m.text, ts);
        if (cue) {
            if (part == null || rank(cue) >= rank(part)) part = cue;
            // 天黑以后又写到了早上、上午，又没算跨天：多半漏了一天
            else if (!crossed && ts.isDay && rank(part) >= rank('晚上') && rank(cue) <= rank('上午') && !m.mark) unsure = '天黑以后又写到了早上';
            // 别的尺度：写到了更早的那一段（秋天以后又写到了春天），又没算跨过一格
            else if (!crossed && !ts.isDay && !m.mark) unsure = `又写到了${cue}，没算成新的一${ts.word}`;
        }
        // 叙述里不在句首、但比现在靠后的时段词：只往后走。这条上记账、此刻的样子写明了时段的，照它们（权威高过叙述里的词）
        const later = unsure || firm ? null : laterCue(m.text, part, ts);
        if (later) part = later;
        // 用户在这条上手动定的时段（"…@下午"，10/3）：算数，往后照它接着走
        const manual = canonicalPart_(String(m.mark ?? '').split('@')[1] ?? '');
        if (manual) { part = manual; unsure = null; }
        if (!m.mark && recs.some(r => r.clock?.unsure)) unsure = '记账拿不准时间是不是往前走了';
        if (!m.mark && !crossed && !unsure && isDone(m) && timeSkipIn(m.text) && !counted(m.pos)) unsure = `写着时间往前走了，没算成新的一${ts.word}`;
        rows.push({ pos: m.pos, fp: m.fp, day, part, crossed, unsure, mark: m.mark ?? null });
        prev = day;
    }
    const today = dayOf(lastPos + 0.5);
    // 离开以后（记在最后那条之后半格）是新的一天，时段不知道
    return { dayOf, rows, today, part: today > prev ? null : part, scale: ts, parts: ts.parts };
}

// 第 n 格（从开场算 0）那一刻的日期怎么写：天尺度＝年月日＋星期；年尺度只写年份（时段＝季另写）；月尺度写年月；
// 小时尺度写那一天（开场那天往后数 n/24 天）。开局单没写日期就 null。
// calendar：种子筛选需要年/月尺度的数值日期；默认保持这两种尺度原有的返回形状。
export function dateIn(start, n = 0, { calendar = false } = {}) {
    const ts = scaleOf(start);
    const options = calendarOf(start);
    const base = dateOf(start?.日期, 0, options);
    if (!base) return null;
    if (ts.unit === '年') {
        const d = { y: base.y + n, m: null, d: null, w: null };
        const ymd = eraDate(start, d) ?? `${d.y}年`;
        return { ymd, week: ymd, ...(calendar ? { d } : {}) };
    }
    if (ts.unit === '月') {
        const k = base.y * 12 + base.m - 1 + n;
        const d = { y: Math.floor(k / 12), m: ((k % 12) + 12) % 12 + 1, d: null, w: null };
        const ymd = eraDate(start, d) ?? `${d.y}年${d.m}月`;
        return { ymd, week: ymd, ...(calendar ? { d } : {}) };
    }
    const d = dateOf(start.日期, ts.unit === '小时' ? Math.floor(n / 24) : n, options);
    if (!d) return null;
    const ymd = eraDate(start, d) ?? `${d.y}年${d.m}月${d.d}日`;
    return { ymd, week: d.w == null ? ymd : `${ymd} 周${d.w}`, d };
}
// 天气按哪一天掷：小时尺度按那一天，年、月尺度不掷（一年、一个月不止一种天气；聊天里写到了照样用）。
const weatherDay = (ts, n) => (ts.unit === '天' ? n : ts.unit === '小时' ? Math.floor(n / 24) : null);

// 开局单"时间"那一格 → 第几天的说法。base＝开场那天算第几天（开局单写了就照写，没写算第 1 天）。
export function dayNumber(start, day) { return (Number.isInteger(start?.第几天) && start.第几天 > 0 ? start.第几天 : 1) + day; }

// 标签里"第几天"前面的说法（10/3 用户："11月x日，回归第x天"）：开局单"从哪天算"写的"某件事那天"去掉"那天"；
// 没写、或写的是个日期，就只说第几天。
const SINCE_TAIL = /(?:的)?(?:那一?天|当天|那日|之日|这一?天)(?:起|开始|算起)?$/;
export function sinceWord(start) {
    const s = String(start?.从哪天算 ?? '').trim().replace(SINCE_TAIL, '');
    return s.length && s.length <= 10 && !/\d/.test(s) ? s : '';
}

// 标签上的天气：这一天聊天里写到过的（到这条为止最晚的一笔）为准，没写到就是程序给这一天掷的那个（和给开口的人的是同一个）。
const shortWeather = t => { const s = String(t).split(/[，,；;。]/)[0].trim(); return s.length > 12 ? `${s.slice(0, 12)}…` : s; };

// 消息上的小标签（只是界面装饰，不改正文）。10/3 用户：每条都标——开局单有日期就写日期，再写从哪天算的第几天，带上时段和当天天气；
// 跨天、开场的带星期几；拿不准的标"？"，用户点过的带 mark。kind：day／unsure／part（时段变了）／mark（用户点过）／plain。
// notes＝"此刻的样子"的记录（聊天里写到的天气在里面）；seed＝这一局（掷天气用）。
export function labelsOf(tl, start = null, { seed = '', notes = [] } = {}) {
    const out = [];
    const ts = scaleOf(start);
    const since = sinceWord(start);
    const said = notes.filter(n => n.aspect === '天气' && n.text).sort((a, b) => a.pos - b.pos);
    let lastPart = null;
    tl.rows.forEach((r, i) => {
        const first = i === 0;
        const date = dateIn(start, r.day);
        const day = `${since}${ts.ordinal(dayNumber(start, r.day))}`;
        const wrote = said.filter(n => n.pos <= r.pos && tl.dayOf?.(n.pos) === r.day).at(-1)?.text;
        const wd = weatherDay(ts, r.day);
        const weather = wrote ?? (wd == null ? null : weatherOn(start?.天气, seed, wd));
        const join = (d, w) => [d, day, r.part, w].filter(Boolean).join(' · ');
        const ymd = date?.ymd, week = date?.week, brief = weather && shortWeather(weather);
        const full = join(week, weather), short = join(ymd, brief);
        if (first || r.crossed) out.push({ pos: r.pos, fp: r.fp, label: join(week, brief), kind: 'day', mark: r.mark, unsure: r.unsure, full });
        else if (r.unsure) out.push({ pos: r.pos, fp: r.fp, label: `${short} ？`, kind: 'unsure', mark: r.mark, unsure: r.unsure, full });
        else out.push({ pos: r.pos, fp: r.fp, label: short, kind: r.mark ? 'mark' : r.part && r.part !== lastPart ? 'part' : 'plain', mark: r.mark, full });
        lastPart = r.part;
    });
    return out;
}

// 场记里各块说"哪天"的同一种写法（用户 10/14："最大程度避免事件发生的时间错乱……不能出现之前场记里那种昨天前天乱记"）：
// 和"现在"那一行同一本日历——开局单写了日期就写几月几日（年、月尺度写某年、某年某月），写了"从哪天算"再带上第几天，后面跟着离今天多远；
// 开局单没写日期也没写从哪天算（换题材、没给开局时间）：照旧只说离今天多远，和以前一字不差。n＝第几格（dayOf 算出来的），today＝今天是第几格。
export function timeTag(n, { start = null, today = n, timeScale = null } = {}) {
    const ts = timeScale ?? scaleOf(start);
    const rel = relativeUnit(Math.max(0, today - n), ts);
    const date = dateIn(start, n), since = !!String(start?.从哪天算 ?? '').trim();
    if (!date && !since) return rel;
    const now = dateIn(start, today);
    const day = !date ? '' : !start?.纪年?.length && (ts.unit === '天' || ts.unit === '小时') && date.d && now?.d && date.d.y === now.d.y ? `${date.d.m}月${date.d.d}日` : date.ymd;
    const nth = since || !date ? ts.ordinal(dayNumber(start, n)) : '';
    return day ? `${day}（${[nth, rel].filter(Boolean).join('，')}）` : `${nth}（${rel}）`;
}

// 给开口的人的那一行（此刻的样子里）：现在是几月几号星期几、一天里的什么时候；天气（聊天里今天写到过的以聊天为准，由 stateLines 判）。
// 开局单没写时间：只说一天里的什么时候（认得出的话）。
export function clockNow(start, { today = 0, part = null, seed = '' } = {}) {
    if (!start) return part ? { now: part, weather: '' } : null;
    const ts = scaleOf(start);
    const date = dateIn(start, today);
    const when = date ? `${date.ymd}${date.d?.w == null ? '' : `，星期${date.d.w}`}` : '';
    const since = start.从哪天算 ? (ts.unit === '天' ? `${start.从哪天算}算第一天，今天是第 ${dayNumber(start, today)} 天` : `${start.从哪天算}算第一${ts.word}，${ts.this}是第 ${dayNumber(start, today)} ${ts.word}`) : '';
    const now = [when, part].filter(Boolean).join('，');
    const wd = weatherDay(ts, today);
    const weather = wd == null ? null : weatherOn(start.天气, seed, wd);
    return {
        now: now ? `${now}${since ? `（${since}）` : ''}` : since,
        weather: weather ? `${weather}${start.气温 ? `；${start.气温}` : ''}` : (start.气温 || ''),
    };
}
