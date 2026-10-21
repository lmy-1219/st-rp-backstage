// 故事节奏（章程 H2，用户 10/11 定）：开局单"节奏"那一格，快／中／慢三档，一档一组数。不写就是中——中档的数和以前一字不差。
// 程序照数办事的：口袋同时装几份、几格没人碰沉底、一个节点至多几件、口袋里同时几件氛围几件意外、一场戏里至多叠几件；
// 只说给规划者当口味的：一格时间排几件、一个主线节点跨几格、用意偏哪边、留白多少（简报里一行，见 paceNote）。
// 沉底那几个数按这一局的时间尺度换算（timescale.mjs 的 sink／slow 乘这一档相对中档的倍数，至少 1 格）。题材无关。

import { scaleOf, DAY } from './timescale.mjs';

export const PACES = ['快', '中', '慢'];
export const MID = '中';

// 用户、模型写的别的叫法 → 快／中／慢；认不出就是 null（当中档）
export function paceName(v) {
    const s = String(v ?? '').replace(/\s+/g, '').replace(/^节奏[：:是]?/, '').replace(/(档|节奏|一点|一些|些)$/, '');
    if (!s) return null;
    if (/^(快|紧|紧凑|密|急)$/.test(s)) return '快';
    if (/^(慢|松|舒缓|缓|疏|留白多)$/.test(s)) return '慢';
    if (/^(中|适中|正常|一般|默认|均衡)$/.test(s)) return '中';
    return null;
}
// 开局单那一格：只存快、慢；中和认不出的不存（老开局单一个字不变）
export const paceCell = v => { const p = paceName(v); return p && p !== MID ? p : null; };

// 一档一组数（天尺度的数；沉底按尺度换算）：
//   perUnit   一格时间排几件（给规划者的口味）       nodeSpan  一个主线节点跨几格（口味）
//   pocket／pocketMax  口袋平时装几份、积得多时最多几份；backoff：最近放出去的两件接连沉底时收回到几份
//   sink／slow  天尺度下几天没人碰沉底（找上门的／到现场、镜头外的慢沉）；按消息数沉的条数跟着同样的倍数
//   maxEvents  一个节点至多几件    mix  口袋里同时至多几件氛围、几件意外、几件亲密（亲密三档都是一件，D-213）    stack  一场戏里至多叠几件（拿出来还没下文的）
//   recent  规划简报压过时（章程 H4），"这一局到现在"最近几格逐条给（格＝这一局的单位：天尺度是天，年尺度是年）
//   close   收期（用户 10/12，N-362：口袋没有结束点、琐事没完没了）：一件事拿出来、记成"碰上的事"以后，过几格正文里没了结、玩家也没追，
//           程序就替它收（matters.closeDue）。天尺度下慢 3、中 2、快 1 天；别的尺度按"几格没人碰沉底"那一列的比例换算，至少 1 格
const TABLE = {
    慢: { perUnit: [1, 1], nodeSpan: [3, 5], pocket: 2, pocketMax: 2, backoff: 1, sink: 5, slow: 10, maxEvents: 8, mix: { 氛围: 2, 意外: 1, 亲密: 1 }, stack: 1, recent: 5, close: 3 },
    中: { perUnit: [2, 3], nodeSpan: [1, 3], pocket: 3, pocketMax: 5, backoff: 2, sink: 2, slow: 5, maxEvents: 12, mix: { 氛围: 1, 意外: 1, 亲密: 1 }, stack: 2, recent: 3, close: 2 },
    快: { perUnit: [4, 5], nodeSpan: [1, 1], pocket: 4, pocketMax: 5, backoff: 3, sink: 1, slow: 3, maxEvents: 12, mix: { 氛围: 1, 意外: 2, 亲密: 1 }, stack: 3, recent: 2, close: 1 },
};
// 中档按消息数沉的条数（剧情停在同一格时）：找上门的 40 条，慢沉的 100 条
const SINK_MSGS = 40, SLOW_MSGS = 100;

// x：整份开局单（有"节奏"）、"快"／"慢"这样的字、或者已经算好的一档（有 name）；timeScale 不给就按开局单的尺度（不是开局单就是天）。
export function paceOf(x = null, timeScale = null) {
    const name = typeof x === 'string' ? paceName(x) : x && typeof x === 'object' ? paceName(x.name ?? x.节奏) : null;
    const p = TABLE[name ?? MID];
    const ts = scaleOf(timeScale ?? (x && typeof x === 'object' && !x.name ? x : DAY));
    const mid = TABLE[MID];
    const units = (base, k) => (k === 1 ? base : Math.max(1, Math.round(base * k)));
    const kSink = p.sink / mid.sink, kSlow = p.slow / mid.slow;
    return Object.freeze({
        name: name ?? MID, ...p, mix: Object.freeze({ ...p.mix }),
        sink: units(ts.sink, kSink), slow: units(ts.slow, kSlow),
        sinkMsgs: Math.round(SINK_MSGS * kSink), slowMsgs: Math.round(SLOW_MSGS * kSlow),
        // 收期按尺度换算：天尺度照表；小时尺度沉底是天的三倍格数，收期也三倍；月、年沉底只有一格，收期跟着减半（至少 1 格）
        close: Math.max(1, Math.round(p.close * ts.sink / DAY.sink)),
        unit: ts.word,
    });
}

const CN = ['零', '一', '两', '三', '四', '五', '六', '七', '八', '九', '十'];
const span = ([a, b]) => (a === b ? CN[a] ?? String(a) : `${CN[a] ?? a}到${CN[b] ?? b}`);
// 这一局"一格时间"的说法：给了尺度按尺度；给的是算好的一档（paceFor 配过尺度）就用它带的；都没有是天
const unitWord = (pace, timeScale) => (timeScale ? scaleOf(timeScale).word : pace && typeof pace === 'object' && pace.name && pace.unit ? pace.unit : paceOf(pace).unit);

// 规划提示词里"这一份排多少、怎么摊"那一句（章程 H3：上一版"只排前半段最先会发生的"被读成"今天明天"，头两格挤了大半）：
// 按节奏表摊开——这个节点跨几格（nodeSpan）、一格几件（perUnit）、至多几件（maxEvents）；单位词从这一局的时间尺度取。
export function spreadLine(pace = null, timeScale = null) {
    const p = paceOf(pace, timeScale), w = unitWord(pace, timeScale);
    const one = p.nodeSpan[0] === 1 && p.nodeSpan[1] === 1;
    const hint = p.nodeSpan[1] > 2 ? `别都压在头两${w}` : '前后摊开，别都挤在开头';
    return `这一份排到这个节点跨的${span(p.nodeSpan)}${w}里，${one ? '排' : `每${w}`}${span(p.perUnit)}件，${hint}；至多 ${p.maxEvents} 件，排不下的等这些放完了下次再排。`;
}
const SPREAD = /这一份排到这个节点跨的[^；\n]*；至多\s*\d+\s*件，排不下的等这些放完了下次再排。/;
// 规划提示词（planner.PLAN_SYSTEM）里那一句换成这一局的节奏和尺度（中档、按天就是原样）；
// 没有那一句的文字只把"至多 12 件"换成这一档的件数，中档原样
export const paceCap = (note, pace, timeScale = null) => {
    if (SPREAD.test(String(note))) return String(note).replace(SPREAD, () => spreadLine(pace, timeScale));
    const n = paceOf(pace).maxEvents;
    return n === TABLE[MID].maxEvents ? note : String(note).replace(/至多\s*\d+\s*件/, `至多 ${n} 件`);
};
// 规划简报里那一行（中档不加：提示词和以前一字不差）
export function paceNote(pace, timeScale = null) {
    const p = paceOf(pace, timeScale);
    if (p.name === MID) return '';
    const w = p.unit;
    if (p.name === '慢') return `【这局的节奏】慢——一${w}排${span(p.perUnit)}件左右，一个主线节点跨${span(p.nodeSpan)}${w}，这个节点至多 ${p.maxEvents} 件；氛围、关系的事多些，意外少；留白多，没事的时候就让日子空着过。`;
    return `【这局的节奏】快——一${w}排${span(p.perUnit)}件，一个主线节点一${w}之内走完；主线、意外的事多些，氛围少；留白少，事接着事来。`;
}

// 回执、面板上的半句
export const paceWords = name => ({
    慢: '慢——一格时间排一件左右，口袋同时两份，一场戏只叠一件，事情放得久才沉',
    快: '快——一格时间排四五件，口袋同时四五份，一场戏能叠三件，没人碰一格就沉；跳过一段时间会一下子掉下一堆事',
}[paceName(name)] ?? '中——和默认一样');
