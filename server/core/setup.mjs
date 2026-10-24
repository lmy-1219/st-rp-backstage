import { personWord, genderOf } from './pronoun.mjs';
const setupGender = value => genderOf(value) || (value === '其他' ? value : null);
const secretCell = x => { const targets = names(x?.不让谁知道); return targets.length ? { 不让谁知道: targets } : {}; };
import { CONTENT_TIERS, tierOf } from './prompt-slots.mjs';
// 开局单（白皮书 O-08、开局单设计稿 §四～§七；D-72）：用户把一局的设定交给系统——贴一整段（大纲、开场稿都行）→ 后台模型分格 →
// 用户核对、改、确认。按局存在后台（不写进用户的卡和书），随时能改，从确认那一刻起生效。
// 各格去处：基调／类别／原则／走向／主线／储备线／意向／前史 → 规划简报（幕后）；原则／前史／走向 → 参谋的本局前提；
// 口径 → 当事人开口、对方在场或被提到时递给他；前史里他知道的那几条 → 和眼下的话有关时递给他（只给他知道的那一版）；
// 时间（开场日期、时段、天气）→ 剧情日期（timeline.mjs），每一轮告诉开口的人现在几号、什么时候、天气。
// 节奏（章程 H2）：快／中／慢，一档一组数（tempo.mjs）；不写就是中，中不存。
//   时间里的"尺度"（章程 G2）：这一局一格时间按小时、天、月还是年走，一格里分哪几段（{ 单位, 时段 }）；不写就是天＋早上到凌晨八段。
// 生活现状（开场时住哪、家里什么样、衣服和随身的东西）→ 生活现状那一格的底（life.mjs），聊天里的变化往上改（N-288，用户 10/5）。
// 分格只搬用户写了的，不补、不改意思；每条带一小段原文，程序核对找不找得到，找不到的标 ⚠ 请用户看。

import { parseAmount } from './money.mjs';
import { LIFE_KINDS } from './life.mjs';
import { scaleOf, unitOf, partsOf, DAY_PARTS } from './timescale.mjs';
import { paceCell, paceWords } from './tempo.mjs';
import { HOLD_KEYS, holdOf, isHeld, secretKeepNote } from './held.mjs';

// 主角团（章程 K1）：故事围着转的那几个人（名字，含玩家的角色）→ 规划简报；规划围着他们排（crewOf）
export const SECTIONS = ['基调', '类别', '主角团', '玩家性别', '档位', '玩法', '开场', '时间', '节奏', '钱', '生活现状', '开场状态', '原则', '前史', '走向', '口径', '主线', '储备线', '亲密线', '意向', '其他'];
const LAYERS = ['原作', '本局私设', '某人记得的版本'];

// 人物开场状态（用户 10/9）：开场那一刻"这个人此刻怎么样"，每行：谁｜哪一类｜是什么｜还有谁知道。各类接到哪儿见 opening.mjs。
// 住处、家里、衣服、东西（车和别的资产）归"生活现状"，手上的钱归"钱"：填表时一起填，存的时候各归各的。
export const OPEN_KINDS = ['在哪', '身体', '心事', '手头的事', '约定', '欠账', '名声'];
// 用户、模型写的别的叫法 → 哪一类（先认事、后认钱："欠钱"是欠账，"手上的钱"是钱）
const KIND_WORDS = [
    [/在哪|在干|在做|去向|位置/, '在哪'], [/身体|伤|病/, '身体'], [/心事|情绪|心情|心里/, '心事'], [/手头|手上的事|在办/, '手头的事'],
    [/约定|约好|答应/, '约定'], [/欠|债|借/, '欠账'], [/名声|名气|口碑/, '名声'],
    [/住处|住哪/, '住处'], [/家里/, '家里'], [/衣服|穿着/, '衣服'], [/东西|车|资产|家当|随身/, '东西'], [/钱|现金|存款/, '钱'],
];
export const kindOf = raw => KIND_WORDS.find(([re]) => re.test(String(raw ?? '')))?.[1] ?? null;
// 他知不知道这一条：是他自己的、"还有谁知道"里有他、或写着所有人
export const knowsRow = (x, name, same = (a, b) => a === b) => !!name && (same(x?.谁, name) || (x?.谁知道 ?? []).some(k => k === '所有人' || same(k, name)));

export const SETUP_SYSTEM = [
    '用户交来一份开局稿（大纲、开场稿、设定都可能），要交给一个长篇角色扮演的后台。你的活是把它分到下面这些格子里：',
    '只搬用户写了的，不补、不改意思、不替用户做决定；没写的格留空；同一件事别在两个格子里重复。',
    '每条一两句话说清，别整段照抄；每条带一小段原文（从用户稿里逐字摘，二十字以内），程序会核对。',
    '',
    '- 基调：整体氛围、这一局最看重什么。',
    '- 类别：剧情类别和必含题材（词）。',
    '- 主角团：故事围着转的那几个人，含玩家的角色；原则、基调里写了的照写（名字；只有一个主角就只写这一个）。',
    '- 玩家性别：玩家的角色的性别，稿子写明了才填男、女或其他；没写就留空，不猜。',
    '- 档位：稿子明写了才填 SFW、剧情向NSFW 或纯NSFW；没写就留空，使用全局默认。',
    '- 开场：从哪一幕开始、开场时的要点。',
    '- 时间：开场那一天。日期（稿子里写了年月日才填，写成 YYYY-MM-DD）；架空年号的写连续年份（元年＝1），纪年里写每个年号从哪一年起；时段（早上/上午/中午/下午/傍晚/晚上/深夜/凌晨）；从哪天算第一天、开场是第几天（稿子里写了"某件事之后第几天"才填）；天气、气温（写了才填）。' +
        '尺度：这一局的时间一格按什么走——稿子里明显是一跳几个月、几年地过（"一走三年""又过了十年"）才填，单位写小时/天/月/年，时段写一格里按先后分的几段（按年走的常写春、夏、秋、冬），不写就是按天、一天八段。',
    '- 节奏：稿子里明说了这一局要快（事接着事、紧凑）还是要慢（舒缓、留白多、慢慢过日子）才填，写"快"或"慢"；没说就留空。',
    '- 钱：开场时谁手上有多少钱（稿子里写了才填）：谁、多少（照原文写数）、还有谁知道。',
    '- 生活现状：开场时谁住在哪、住处什么样（格局、家具电器、坏了的、没有的）、衣服和随身的东西、车和别的资产（稿子里写了才填）。一样一条：谁；类（住处／家里／衣服／东西）；是什么；家里的写是哪处住处；还有谁知道。',
    '- 开场状态：开场那一刻某个人此刻怎么样（稿子里写了才填；住处、家当、钱不写在这儿）。一样一条：谁；类——在哪（开场时人在哪、在干什么）／身体（伤病、没好的旧伤、靠什么撑着）／心事（刚出了什么事、心里带着什么情绪）／手头的事（正在办、等着回音的事）／约定（开场前就说好、还没办的事）／欠账（谁欠谁多少）／名声（在哪个圈子里是什么名声）；是什么（照原文的意思，一两句）；还有谁知道（人人都知道写"所有人"）；约定、欠账写上跟谁，欠账写上多少，名声写上是哪个圈子。开场那一刻的状态写在这里，不写进前史。',
    '- 原则：用户定的总规矩。',
    '- 前史：开局前已经发生的事。每条写清：事；谁知道（人名，知道的都列上；人人都知道写"所有人"）；哪一层——原作（原作里确定写过的）／本局私设（用户这一局自己定的）／某人记得的版本（和实际不一样的那种，写明是谁的版本）。同一件事有真相、也有某人记错的版本，拆成两条。知道的人会压着不说的（瞒着别人的秘密、闷在心里的心事、没说出口的心意或坏消息），稿子写了就照填四格：处置（瞒着／闷着／挑时候说／直说）、开口条件（只写看得见的：对方先提起、撞见反证、两人到了哪一步、独处……）、不说时外显（往别处漏的样子）、说的场合（他会挑的时间和场面）；稿子没写就不填。压着不说的事写在前史里，不写进开场状态的心事。',
    '- 走向：原作里取决于玩家当年怎么选、或者没收尾的事，这一局是怎么定的（谁活着、谁死了、哪条线走了哪边）。',
    '- 口径：某个角色对另一个人怎么称呼、是什么态度。只写正面的（怎么叫、什么心情）；用户说"别怎样"的，改写成"应该怎样"。',
    '- 主线：这一局的核心主题（只当主题，不排日程）。',
    '- 储备线：可以发展、可用可不用的线。每条：名；内容；必用还是可选（没说就是可选）；什么条件下才可能出现（只写看得见的条件，不写"前期""后期"）；直说还是只许侧面露；门槛；是不是终局专用；和哪条线拉扯、怎么处理。',
    '- 亲密线：稿子里明写了才填；每条写谁（两个名字）、张力、现在、阶梯（数组）、主动（名字对应一句）、底线（数组）、可加入（数组：可以加进来的第三人，没写就空着）、成年（布尔值）。成年一项只在稿子写明这一条里每个人（两个人和可加入的人）都已成年时填 true（文本是“成年：是”），否则留空，不能推测。',
    '- 意向：长期的关系走向和愿望（只当方向）。',
    '- 其他：放不进上面的。',
    '',
    '只输出一个 JSON：{"基调": "", "类别": [], "主角团": [], "玩家性别": "", "档位": "", "开场": "", "时间": {"日期": "", "纪年": [{"名": "", "起": 0}], "时段": "", "从哪天算": "", "第几天": 0, "天气": "", "气温": "", "尺度": {"单位": "", "时段": []}}, "节奏": "", "钱": [{"谁": "", "多少": "", "谁知道": [], "原文": ""}], "生活现状": [{"谁": "", "类": "住处|家里|衣服|东西", "是": "", "在哪": "", "谁知道": [], "原文": ""}], "开场状态": [{"谁": "", "类": "在哪|身体|心事|手头的事|约定|欠账|名声", "是": "", "谁知道": [], "跟谁": [], "多少": "", "圈子": "", "原文": ""}], "原则": [{"条": "", "原文": ""}], "前史": [{"事": "", "谁知道": [], "层": "原作|本局私设|某人记得的版本", "谁的版本": "", "处置": "瞒着|闷着|挑时候说|直说（稿子写了才填）", "开口条件": "", "不说时外显": "", "说的场合": "", "原文": ""}], ',
    '"走向": [{"事": "", "本局": "", "原文": ""}], "口径": [{"谁": "", "对谁": "", "怎么": "", "原文": ""}], "主线": [{"名": "", "内容": "", "原文": ""}], ',
    '"储备线": [{"名": "", "内容": "", "可选": true, "条件": "", "露法": "", "门槛": "", "终局": false, "拉扯": "", "原文": ""}], "亲密线": [{"谁": [], "张力": "", "现在": "", "阶梯": [], "主动": {}, "底线": [], "可加入": [], "成年": null, "原文": ""}], "意向": [{"条": "", "原文": ""}], "其他": ""}',
].join('\n');

// part＝这一次只分的那一段（整份稿子长时分段分，每段都带上全文作参照，别的段落里的事这次不写）。
export function setupPrompt({ source, names = [], part = null }) {
    return [
        names.length ? `人名尽量用名册里的写法：${names.join('、')}。` : '',
        '', '【用户的开局稿】', source,
        ...(part ? ['', '【这一次只分这一段】（上面全文只作参照；这一段以外的事这次不写，没有的格留空）', part] : []),
    ].join('\n');
}

// 长稿子按空行切段，凑成每份约 max 字的几份；单独一段超长的自成一份。
export function splitSource(source, { max = 2500 } = {}) {
    const paras = String(source).split(/\n\s*\n|\n(?=\S)/).map(p => p.trim()).filter(Boolean);
    const parts = [];
    let buf = '';
    for (const p of paras) {
        if (buf && buf.length + p.length > max) { parts.push(buf); buf = ''; }
        buf += (buf ? '\n' : '') + p;
    }
    if (buf) parts.push(buf);
    return parts;
}

// 几份分格结果合成一份：单段的格接起来，列表的格并起来（同一条去重）。
export function mergeSetups(results) {
    const out = blankSetup();
    for (const { data } of results) {
        for (const k of ['基调', '开场', '其他']) if (data[k]) out[k] = out[k] ? `${out[k]}\n${data[k]}` : data[k];
        out.类别 = [...new Set([...out.类别, ...data.类别])];
        if (data.主角团?.length) out.主角团 = [...new Set([...(out.主角团 ?? []), ...data.主角团])];
        if (!out.玩家性别 && setupGender(data.玩家性别)) out.玩家性别 = data.玩家性别;
        if (!out.档位 && CONTENT_TIERS.includes(data.档位)) out.档位 = data.档位;
        if (!out.玩法 && ['完整','只记忆'].includes(data.玩法)) out.玩法 = data.玩法;
        out.时间 ??= data.时间 ?? null;
        if (!out.节奏 && data.节奏) out.节奏 = data.节奏;
        for (const k of ['钱', '生活现状', '开场状态', '原则', '前史', '走向', '口径', '主线', '储备线', '意向']) {
            if (!Array.isArray(data[k])) continue;
            const seen = new Set(out[k].map(x => JSON.stringify({ ...x, ok: undefined })));
            for (const x of data[k]) if (!seen.has(JSON.stringify({ ...x, ok: undefined }))) out[k].push(x);
        }
        if (data.亲密线?.length) out.亲密线 = [...(out.亲密线 ?? []), ...data.亲密线.filter(x => !(out.亲密线 ?? []).some(y => JSON.stringify(x) === JSON.stringify(y)))];
    }
    const unchecked = SECTIONS.flatMap(s => (Array.isArray(out[s]) && typeof out[s][0] === 'object' ? out[s].filter(x => !x.ok).map(() => s) : []));
    return { data: out, unchecked };
}

const flat = s => String(s ?? '').replace(/[\s"'“”‘’「」『』（）()【】\[\]，,。.！!？?：:；;、…—\-·]/g, '');
const str = v => (typeof v === 'string' ? v.trim() : '');
const list = v => (Array.isArray(v) ? v : []);
const names = v => (Array.isArray(v) ? v : String(v ?? '').split(/[、,，/]/)).map(x => String(x).trim()).filter(Boolean);
// 主角团那一格：名字，去重；写成对象的（{"名": …}、{"谁": …}）也认
const crewCell = v => [...new Set((Array.isArray(v) ? v : names(v)).map(x => (x && typeof x === 'object' ? x.名 ?? x.谁 ?? '' : x)).flatMap(x => names(x)))].slice(0, 12);

// 成年只认布尔 true；名册由调用方带来，玩家的人设名也属于本局名册。
export function intimateRows(data, { names: roster = null } = {}) {
    return list(data?.亲密线).map(raw => {
        const x = { 谁: names(raw?.谁), 张力: str(raw?.张力), 现在: str(raw?.现在), 阶梯: list(raw?.阶梯).map(str).filter(Boolean),
            主动: Object.fromEntries(Object.entries(raw?.主动 && typeof raw.主动 === 'object' && !Array.isArray(raw.主动) ? raw.主动 : {}).map(([k, v]) => [k.trim(), str(v)]).filter(([k]) => k)),
            底线: list(raw?.底线).map(str).filter(Boolean), 成年: raw?.成年 === true, ok: raw?.ok !== false };
        // 可加入（T013）：可以加进来的第三人；和"谁"重复的、自己重复的去掉，不报错
        x.可加入 = [...new Set(names(raw?.可加入))].filter(n => !x.谁.includes(n));
        const missing = roster ? [...x.谁, ...x.可加入].filter(n => !roster.includes(n)) : [];
        const error = x.谁.length !== 2 || new Set(x.谁).size !== 2 ? '亲密线须写两个不同的名字' : !x.成年 ? '未确认成年，不生效' : missing.length ? `名册里没有${missing.join('、')}` : raw?.ok === false ? str(raw.error) : '';
        if (error) { x.ok = false; x.error = error; }
        return x;
    });
}
export const activeIntimate = (data, opts = {}) => tierOf(opts.config, data) === 'SFW' ? [] : intimateRows(data, opts).filter(x => x.ok !== false);
export const checkIntimate = (data, opts = {}) => !data?.亲密线?.length ? data : { ...data, 亲密线: intimateRows(data, opts) };
// 数组里的逗号、顿号是内容时用引号保留，避免文本来回把一条拆成几条。
const intimateListText = rows => rows.some(x => /[、,，/]/.test(x)) ? JSON.stringify(rows) : rows.join('、');
const intimateList = text => { try { const v = JSON.parse(text); if (Array.isArray(v) && v.every(x => typeof x === 'string')) return v; } catch {} return names(text); };

// 天气的几种、各占几份："小雨 3 ｜ 阴 3 ｜ 晴 2"；没写份数的各算一份。
export function kindsOf(v) {
    if (Array.isArray(v)) return v.map(k => ({ 种: str(k?.种), 份: Number(k?.份) > 0 ? Number(k.份) : 1 })).filter(k => k.种);
    return String(v ?? '').split(/\s*[｜|、,，/;；]\s*/).map(p => p.trim()).filter(Boolean).map(p => {
        const m = /^(.+?)\s*[×x*]?\s*(\d+(?:\.\d+)?)\s*(?:份|成)?$/.exec(p);
        return m ? { 种: m[1].trim(), 份: Number(m[2]) } : { 种: p, 份: 1 };
    }).filter(k => k.种 && k.份 > 0);
}
// "尺度"那一小格：{ 单位, 时段 } 或者写成一行"年 ｜ 春、夏、秋、冬"。认不出单位、或者就是默认（天＋八段）的，不留（老开局单一个字不变）。
export function scaleCell(raw) {
    let v = raw;
    if (typeof v === 'string') { const [u, ...rest] = v.split(/\s*[｜|]\s*/); v = { 单位: u, 时段: rest.join('、') }; }
    if (!v || typeof v !== 'object') return null;
    const unit = unitOf(v.单位);
    const parts = partsOf(v.时段);
    if (!unit) return null;
    if (unit === '天' && (!parts.length || parts.join('、') === DAY_PARTS.join('、'))) return null;
    return { 单位: unit, 时段: parts };
}
// 回执、简报里那半句："时间按年走，一年分春、夏、秋、冬"
export function scaleWords(t) {
    const c = scaleCell(t?.尺度);
    if (!c) return '';
    const s = scaleOf({ 尺度: c });
    return `时间按「${s.unit}」走${s.parts.length ? `，一${s.word}分${s.parts.join('、')}` : ''}`;
}
// 开局单的"时间"那一格；什么都没写就是 null。
export function timeOf(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const day = Number.parseInt(String(raw.第几天 ?? ''), 10);
    const scale = scaleCell(raw.尺度);
    const eras = eraCell(raw.纪年);
    const out = {
        日期: /^\d{3,5}-\d{1,2}-\d{1,2}$/.test(String(raw.日期 ?? '').trim()) ? String(raw.日期).trim() : '',
        时段: str(raw.时段), 从哪天算: str(raw.从哪天算), 第几天: day > 0 ? day : null, 天气: kindsOf(raw.天气), 气温: str(raw.气温),
        ...(scale ? { 尺度: scale } : {}),
        ...(eras.length ? { 纪年: eras } : {}),
    };
    return out.日期 || out.时段 || out.从哪天算 || out.第几天 || out.天气.length || out.气温 || out.尺度 || out.纪年 ? out : null;
}
function eraCell(raw) {
    const rows = typeof raw === 'string' ? raw.split(/[｜|]/).map(s => {
        const m = /^\s*(.+?)\s+(\d+)\s*$/.exec(s);
        return m ? { 名: m[1], 起: Number(m[2]) } : null;
    }) : Array.isArray(raw) ? raw : [];
    return rows.map(x => ({ ...x, 起: Number(x?.起) })).filter(x => typeof x?.名 === 'string' && x.名.trim() && Number.isInteger(x.起) && x.起 > 0)
        .map(x => ({ 名: x.名.trim(), 起: x.起 })).sort((a, b) => a.起 - b.起);
}
const TIME_KEYS = ['日期', '时段', '从哪天算', '第几天', '天气', '气温', '尺度', '纪年'];
const scaleText = c => (c ? [c.单位, (c.时段 ?? []).join('、')].filter(Boolean).join(' ｜ ') : '');

// 模型交回的 JSON → 开局单。每条的原文逐字核对（忽略空白与标点），对不上的标出来。
export function parseSetup(text, { source = '', names: roster = null } = {}) {
    const m = String(text).match(/\{[\s\S]*\}/);
    if (!m) throw new Error('setup_bad_json');
    let raw;
    try { raw = JSON.parse(m[0]); } catch { throw new Error('setup_bad_json'); }
    const hay = flat(source);
    const ok = quote => { const q = flat(quote); return q.length >= 3 && hay.includes(q); };
    const item = (x, fields) => {
        const out = { ok: ok(x?.原文) };
        for (const [k, f] of Object.entries(fields)) out[k] = f(x?.[k]);
        return out;
    };
    const data = {
        基调: str(raw.基调), 开场: str(raw.开场), 其他: str(raw.其他), 时间: timeOf(raw.时间),
        ...(paceCell(raw.节奏) ? { 节奏: paceCell(raw.节奏) } : {}),
        类别: names(raw.类别),
        ...(crewCell(raw.主角团).length ? { 主角团: crewCell(raw.主角团) } : {}),   // 写了才有这一格（老开局单一个字不变）
        ...(setupGender(raw.玩家性别) ? { 玩家性别: raw.玩家性别 } : {}),
        ...(CONTENT_TIERS.includes(raw.档位) ? { 档位: raw.档位 } : {}),
        ...(['完整','只记忆'].includes(raw.玩法) ? { 玩法: raw.玩法 } : {}),
        钱: list(raw.钱).map(x => item(x, { 谁: str, 多少: v => parseAmount(v), 谁知道: v => names(v).filter(n => n !== '所有人') })).filter(x => x.谁 && x.多少),
        生活现状: list(raw.生活现状).map(x => item(x, { 谁: str, 类: str, 是: str, 在哪: str, 谁知道: v => names(v).filter(n => n !== '所有人') })).filter(x => x.谁 && x.是 && LIFE_KINDS.includes(x.类)),
        开场状态: list(raw.开场状态).map(x => item(x, { 谁: str, 类: kindOf, 是: str, 谁知道: names, 跟谁: names, 多少: v => parseAmount(v), 圈子: str })).filter(x => x.谁 && x.是 && x.类).map(openExtras),
        原则: list(raw.原则).map(x => item(x, { 条: str })).filter(x => x.条),
        // 心里压着的事（held.mjs，用户 10/16）：写了处置那四格才带上（老开局单一个字不变）
        前史: list(raw.前史).map(x => ({ ...item(x, { 事: str, 谁知道: v => names(v).filter(n => n !== '所有人'), 层: v => (LAYERS.includes(str(v)) ? str(v) : '本局私设'), 谁的版本: str, 常驻: v => v === true }), ...(holdOf(x) ?? {}), ...secretCell(x) })).filter(x => x.事).map(({ 常驻, ...x }) => (常驻 ? { ...x, 常驻 } : x)),
        走向: list(raw.走向).map(x => item(x, { 事: str, 本局: str })).filter(x => x.事 && x.本局),
        口径: list(raw.口径).map(x => item(x, { 谁: str, 对谁: str, 怎么: str })).filter(x => x.谁 && x.对谁 && x.怎么),
        主线: list(raw.主线).map(x => item(x, { 名: str, 内容: str })).filter(x => x.名 || x.内容),
        储备线: list(raw.储备线).map(x => item(x, { 名: str, 内容: str, 可选: v => v !== false, 条件: str, 露法: str, 门槛: str, 终局: v => v === true, 拉扯: str })).filter(x => x.名 || x.内容),
        意向: list(raw.意向).map(x => item(x, { 条: str })).filter(x => x.条),
    };
    if (list(raw.亲密线).length) data.亲密线 = intimateRows({ 亲密线: raw.亲密线.map(x => ({ ...x, ok: ok(x?.原文) })) }, { names: roster });
    routeRows(data);
    const unchecked = SECTIONS.flatMap(s => (Array.isArray(data[s]) && typeof data[s][0] === 'object' ? data[s].filter(x => !x.ok).map(() => s) : []));
    return { data, unchecked };
}

// 开场状态一条：空着的附加格不留（跟谁、多少、圈子写了才有）
function openExtras(x) {
    const out = { ...x };
    if (!out.跟谁?.length) delete out.跟谁;
    if (!out.多少) delete out.多少;
    if (!out.圈子) delete out.圈子;
    return out;
}
// 开场状态里写成了住处、家当、钱的：挪进生活现状、钱那两格（谁知道里的"所有人"那两格不认，照"只有他自己"）
function routeRows(data) {
    const rows = data.开场状态 ?? [];
    data.开场状态 = [];
    for (const x of rows) {
        const knows = (x.谁知道 ?? []).filter(n => n !== '所有人');
        if (LIFE_KINDS.includes(x.类) && x.类 !== '身体') data.生活现状.push({ ...(x.ok !== undefined ? { ok: x.ok } : {}), 谁: x.谁, 类: x.类, 是: x.是, 在哪: x.在哪 ?? '', 谁知道: knows });
        else if (x.类 === '钱') { const n = x.多少 ?? parseAmount(x.是); if (n) data.钱.push({ ...(x.ok !== undefined ? { ok: x.ok } : {}), 谁: x.谁, 多少: n, 谁知道: knows }); }
        else if (OPEN_KINDS.includes(x.类)) data.开场状态.push(x);
    }
    return data;
}

// ---------- 给人看、给人改的文本 ----------

const HINT = {
    主角团: '主要聚焦角色：故事围着转的主角或主角团，玩家的角色也写上；、分隔。只有玩家的角色一个人就是单主角。规划围着他们排',
    前史: '每条：事 ｜ 谁知道（、分隔；人人都知道写"所有人"） ｜ 哪一层（原作／本局私设／某人记得的版本：谁的）；要知道的人每一轮都带着（前台老是补错的事），末尾再加 ｜ 常驻；知道的人压着不说的，可以再加 ｜ 处置：瞒着／闷着／挑时候说／直说 ｜ 开口条件：… ｜ 不说时外显：… ｜ 说的场合：…（写了几格算几格，没写的规划会补成候选）',
    走向: '每条：事 ｜ 这一局怎么定的',
    口径: '每条：谁 → 对谁 ｜ 怎么称呼、什么态度（只写正面的）',
    主线: '只当主题，不排日程。每条：名 ｜ 内容',
    生活现状: '开场时的住处和家当，之后聊天里添了、换了、坏了，系统跟着改。一样一条：谁 ｜ 住处／家里／衣服／东西（车和别的资产也写在东西里） ｜ 是什么 ｜ （家里的）哪处住处 ｜ 还有谁知道（、分隔；不写就只有他自己知道）',
    开场状态: '开场那一刻各人怎么样，之后跟着剧情变。一样一条：谁 ｜ 哪一类（在哪／身体／心事／手头的事／约定／欠账／名声） ｜ 是什么 ｜ 还有谁知道（、分隔；不写就只有他自己知道；人人都知道写"所有人"）；约定、欠账可以再加 ｜ 跟谁：…，欠账加 ｜ 多少：…，名声加 ｜ 圈子：…（不写就照"是什么"里写的认）',
    钱: '开场时谁手上有多少钱（写了才会算"现在还剩多少"）。每条：谁 ｜ 多少 ｜ 还有谁知道（、分隔；不写就只有他自己知道）',
    节奏: '快／中／慢，写一个字。慢：一格时间排一件左右、留白多；中：默认；快：一格时间排四五件、事接着事，跳过一段时间会一下子掉下一堆事',
    时间: '开场那一天；之后按剧情里过了几天往后推。日期写成 2000-01-31；架空年号的写连续年份（元年＝1），纪年里写每个年号从哪一年起（如“年号甲 1 ｜ 年号乙 24”）；时段：早上/上午/中午/下午/傍晚/晚上/深夜/凌晨；从哪天算第一天、开场是第几天（不写就从开场算第 1 天）；天气：这一带这时候常见的几种、各占几份（"小雨 3 ｜ 阴 2 ｜ 晴 2"），每天由程序挑一种，聊天里写到了以聊天为准；气温：一句话；尺度（选填）：这一局一格时间按什么走，写成"年 ｜ 春、夏、秋、冬"或"月 ｜ 上旬、中旬、下旬"（单位：小时/天/月/年），写了以后"第几天"就是第几年、第几个月；不写就是按天、一天八段',
    储备线: '默认可选；条件只写看得见的。每条：名 ｜ 内容 ｜ 必用或可选 ｜ 条件：… ｜ 露法：… ｜ 门槛：… ｜ 终局专用 ｜ 拉扯：…',
    亲密线: '每条：两个人名（、分隔） ｜ 张力：… ｜ 现在：… ｜ 阶梯：一格、下一格 ｜ 主动·名字：一句（每人一格） ｜ 底线：…（、分隔） ｜ 可加入：名字、名字（可以加进来的第三人，没有就不写） ｜ 成年：是（两个人和可加入的人都已成年才写是；否则不生效）',
};
const mark = x => (x.ok === false ? '⚠ ' : '');

export function toText(data) {
    const out = [];
    const block = (name, body) => out.push(`【${name}】${HINT[name] ? `（${HINT[name]}）` : ''}`, ...body, '');
    block('基调', [data.基调 ?? '']);
    out.push(`【类别】${(data.类别 ?? []).join('、')}`, '');
    out.push(`【主角团】（${HINT.主角团}）${(data.主角团 ?? []).join('、')}`, '');
    if (setupGender(data.玩家性别)) out.push(`【玩家性别】${data.玩家性别}`, '');
    if (CONTENT_TIERS.includes(data.档位)) out.push(`【档位】${data.档位}`, '');
    if (['完整','只记忆'].includes(data.玩法)) out.push(`【玩法】${data.玩法}`, '');
    block('开场', [data.开场 ?? '']);
    const t = data.时间 ?? {};
    block('时间', TIME_KEYS.map(k => `${k}：${k === '天气' ? (t.天气 ?? []).map(x => `${x.种} ${x.份}`).join(' ｜ ') : k === '尺度' ? scaleText(t.尺度) : k === '纪年' ? eraCell(t.纪年).map(x => `${x.名} ${x.起}`).join(' ｜ ') : t[k] ?? ''}`));
    out.push(`【节奏】（${HINT.节奏}）${data.节奏 ?? '中'}`, '');
    block('钱', (data.钱 ?? []).map(x => `- ${mark(x)}${x.谁} ｜ ${x.多少} ｜ ${(x.谁知道 ?? []).join('、') || '只有他自己'}`));
    block('生活现状', (data.生活现状 ?? []).map(x => `- ${mark(x)}${x.谁} ｜ ${x.类} ｜ ${x.是}${x.类 === '家里' ? ` ｜ ${x.在哪 || ''}` : ''} ｜ ${(x.谁知道 ?? []).join('、') || '只有他自己'}`));
    block('开场状态', (data.开场状态 ?? []).map(x => `- ${mark(x)}${[x.谁, x.类, x.是, (x.谁知道 ?? []).join('、') || '只有他自己', x.跟谁?.length && `跟谁：${x.跟谁.join('、')}`, x.多少 && `多少：${x.多少}`, x.圈子 && `圈子：${x.圈子}`].filter(Boolean).join(' ｜ ')}`));
    block('原则', (data.原则 ?? []).map(x => `- ${mark(x)}${x.条}`));
    block('前史', (data.前史 ?? []).map(x => `- ${mark(x)}${x.事} ｜ ${x.谁知道.join('、') || '所有人'} ｜ ${x.层}${x.层 === '某人记得的版本' && x.谁的版本 ? `：${x.谁的版本}` : ''}${x.不让谁知道?.length ? ` ｜ 不让：${x.不让谁知道.join('、')}` : ''}${x.常驻 ? ' ｜ 常驻' : ''}${HOLD_KEYS.filter(k => x[k]).map(k => ` ｜ ${k}：${x[k]}`).join('')}`));
    block('走向', (data.走向 ?? []).map(x => `- ${mark(x)}${x.事} ｜ ${x.本局}`));
    block('口径', (data.口径 ?? []).map(x => `- ${mark(x)}${x.谁} → ${x.对谁} ｜ ${x.怎么}`));
    block('主线', (data.主线 ?? []).map(x => `- ${mark(x)}${x.名} ｜ ${x.内容}`));
    block('储备线', (data.储备线 ?? []).map(x => `- ${mark(x)}${[x.名, x.内容, x.可选 ? '可选' : '必用', x.条件 && `条件：${x.条件}`, x.露法 && `露法：${x.露法}`, x.门槛 && `门槛：${x.门槛}`, x.终局 && '终局专用', x.拉扯 && `拉扯：${x.拉扯}`].filter(Boolean).join(' ｜ ')}`));
    block('亲密线', intimateRows(data).map(x => `- ${mark(x)}${[x.谁.join('、'), `张力：${x.张力}`, `现在：${x.现在}`, `阶梯：${intimateListText(x.阶梯)}`, ...Object.entries(x.主动).map(([k, v]) => `主动·${k}：${v}`), `底线：${intimateListText(x.底线)}`, ...(x.可加入.length ? [`可加入：${intimateListText(x.可加入)}`] : []), `成年：${x.成年 ? '是' : '否'}`].join(' ｜ ')}`));
    block('意向', (data.意向 ?? []).map(x => `- ${mark(x)}${x.条}`));
    block('其他', [data.其他 ?? '']);
    return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

// 用户改过的文本 → 开局单（用户确认过的每条都算数）。
export function fromText(text, { names: roster = null } = {}) {
    const data = blankSetup();
    let section = null;
    const time = {};
    const prose = { 基调: [], 开场: [], 其他: [] };
    for (const rawLine of String(text).split(/\r?\n/)) {
        const head = rawLine.match(/^【([^】]+)】(.*)$/);
        if (head && SECTIONS.includes(head[1])) {
            section = head[1];
            if (section === '类别') data.类别 = names(head[2].replace(/^（[^）]*）/, ''));
            if (section === '节奏') setPace(data, head[2].replace(/^（[^）]*）/, ''));
            if (section === '玩家性别') setGender(data, head[2].replace(/^（[^）]*）/, ''));
            if (section === '档位') setContentTier(data, head[2]);
            if (section === '玩法') setPlay(data, head[2]);
            if (section === '主角团') setCrew(data, head[2].replace(/^（[^）]*）/, ''));
            continue;
        }
        if (!section) continue;
        if (section in prose) { prose[section].push(rawLine); continue; }
        if (section === '主角团') { setCrew(data, rawLine.replace(/^\s*[-·•]\s*/, ''), { add: true }); continue; }
        if (section === '玩家性别') { if (rawLine.trim()) setGender(data, rawLine); continue; }
        if (section === '档位') { if (rawLine.trim()) setContentTier(data, rawLine); continue; }
        if (section === '玩法') { if (rawLine.trim()) setPlay(data, rawLine); continue; }
        if (section === '节奏') { if (rawLine.trim()) setPace(data, rawLine); continue; }
        if (section === '时间') {
            const kv = rawLine.match(/^\s*[-·•]?\s*(日期|时段|从哪天算|第几天|天气|气温|尺度|纪年)\s*[：:]\s*(.*)$/);
            if (kv) time[kv[1]] = kv[2].trim();
            continue;
        }
        const line = rawLine.match(/^\s*[-·•]\s*(?:⚠\s*)?(.+)$/)?.[1]?.trim();
        if (!line) continue;
        const parts = line.split(/\s*｜\s*/);
        if (section === '原则' || section === '意向') data[section].push({ 条: line });
        else if (section === '钱') {
            const amount = parseAmount(parts[1]);
            if (parts[0] && amount) data.钱.push({ 谁: parts[0], 多少: amount, 谁知道: names(parts[2]).filter(n => n !== '只有他自己' && n !== '所有人') });
        }
        else if (section === '生活现状') {
            // 谁 ｜ 类 ｜ 是什么 ｜ （家里的）哪处住处 ｜ 还有谁知道；不是"家里"的少一格
            const home = parts[1] === '家里';
            const knows = names(parts[home ? 4 : 3]).filter(n => n !== '只有他自己' && n !== '所有人');
            if (parts[0] && LIFE_KINDS.includes(parts[1]) && parts[2]) data.生活现状.push({ 谁: parts[0], 类: parts[1], 是: parts[2], 在哪: home ? (parts[3] ?? '') : '', 谁知道: knows });
        }
        else if (section === '开场状态') {
            // 谁 ｜ 类 ｜ 是什么 ｜ 还有谁知道 ｜（跟谁：… ｜ 多少：… ｜ 圈子：…）
            const kind = kindOf(parts[1]);
            if (!parts[0] || !kind || !parts[2]) continue;
            const x = { 谁: parts[0], 类: kind, 是: parts[2], 谁知道: names(parts[3]).filter(n => n !== '只有他自己') };
            for (const p of parts.slice(4)) {
                const kv = p.match(/^(跟谁|多少|圈子)[：:]\s*(.*)$/);
                if (kv?.[1] === '跟谁') x.跟谁 = names(kv[2]);
                else if (kv?.[1] === '多少') x.多少 = parseAmount(kv[2]);
                else if (kv?.[1] === '圈子') x.圈子 = kv[2].trim();
            }
            data.开场状态.push(openExtras(x));
        }
        else if (section === '前史') {
            const [layer, whose] = (parts[2] ?? '').split(/[：:]/).map(s => s.trim());
            const kv = Object.fromEntries(parts.slice(3).map(p => p.trim().match(/^(处置|开口条件|不说时外显|说的场合)[：:]\s*(.*)$/)).filter(Boolean).map(m => [m[1], m[2].trim()]));
            data.前史.push({ 事: parts[0], 谁知道: names(parts[1]).filter(n => n !== '所有人'), 层: LAYERS.includes(layer) ? layer : '本局私设', 谁的版本: whose ?? '', ...(parts.slice(3).some(p => p.trim() === '常驻') ? { 常驻: true } : {}), ...(holdOf(kv) ?? {}), ...secretCell({ 不让谁知道: parts.slice(3).map(p => p.trim().match(/^不让[：:]\s*(.*)$/)?.[1]).filter(Boolean).join('、') }) });
        } else if (section === '走向' && parts[1]) data.走向.push({ 事: parts[0], 本局: parts.slice(1).join('｜') });
        else if (section === '口径') {
            const [who, to] = parts[0].split(/\s*(?:→|->)\s*/);
            if (who && to && parts[1]) data.口径.push({ 谁: who.trim(), 对谁: to.trim(), 怎么: parts.slice(1).join('｜') });
        } else if (section === '主线') data.主线.push({ 名: parts[0], 内容: parts.slice(1).join('｜') });
        else if (section === '亲密线') {
            const x = { 谁: names(parts[0]), 主动: {}, 阶梯: [], 底线: [], 可加入: [] };
            for (const p of parts.slice(1)) {
                const kv = p.match(/^(张力|现在|阶梯|底线|可加入|成年|主动·[^：:]+)[：:]\s*(.*)$/);
                if (!kv) continue;
                const [, k, v] = kv;
                if (k.startsWith('主动·')) x.主动[k.slice(3)] = v;
                else x[k] = k === '成年' ? v === '是' : ['阶梯', '底线', '可加入'].includes(k) ? intimateList(v) : v;
            }
            (data.亲密线 ??= []).push(x);
        }
        else if (section === '储备线') {
            const x = { 名: parts[0], 内容: parts[1] ?? '', 可选: true, 条件: '', 露法: '', 门槛: '', 终局: false, 拉扯: '' };
            for (const p of parts.slice(2)) {
                const kv = p.match(/^(条件|露法|门槛|拉扯)[：:]\s*(.*)$/);
                if (kv) x[kv[1]] = kv[2];
                else if (p === '必用') x.可选 = false;
                else if (p === '终局专用') x.终局 = true;
            }
            data.储备线.push(x);
        }
    }
    for (const k of Object.keys(prose)) data[k] = prose[k].join('\n').trim();
    data.时间 = timeOf(time);
    return checkIntimate(routeRows(data), { names: roster });
}

// 节奏那一格：快、慢才存；中、认不出的不存（写了"中"就是改回默认）
function setPace(d, v) {
    const p = paceCell(v);
    if (p) d.节奏 = p; else delete d.节奏;
    return d;
}
// 主角团那一格（章程 K1）：写了名字才存，空着就没有这一格；add＝接在已有的后面（文本里另起一行写的）
function setCrew(d, v, { add = false } = {}) {
    const c = [...new Set([...(add ? d.主角团 ?? [] : []), ...crewCell(v)])];
    if (c.length) d.主角团 = c; else if (!add) delete d.主角团;
    return d;
}

// ---------- 表格填写（开局单设计稿 §四：必填基调和类别，选填五格） ----------
// 表格里填的并进现有那份（没有就新起一份）：基调、类别、时间、其他照表格的；主线、必要剧情、必要情节逐行加进去（已有的不重复）；
// 全剧情必要角色写成一条原则（"这一局必须有的角色：……"，有了就换）。
export const MUST_CAST = '这一局必须有的角色：';
function setGender(data, value) { if (setupGender(value)) data.玩家性别 = value; else delete data.玩家性别; }
function setPlay(data, value) { const v=String(value ?? '').trim(); if (['完整','只记忆'].includes(v)) data.玩法=v; else delete data.玩法; }
function setContentTier(data, value) { const tier = String(value ?? '').replace(/\s/g, ''); if (CONTENT_TIERS.includes(tier)) data.档位 = tier; else delete data.档位; }
const blankSetup = () => ({ 基调: '', 类别: [], 开场: '', 时间: null, 钱: [], 生活现状: [], 开场状态: [], 原则: [], 前史: [], 走向: [], 口径: [], 主线: [], 储备线: [], 意向: [], 其他: '' });
const linesOf = v => String(v ?? '').split(/\r?\n/).map(s => s.replace(/^\s*[-·•]\s*/, '').trim()).filter(Boolean);
// 填表里"人物开场状态"那几行（用户 10/9：多条，可自己加行）：每行 {谁, 类, 是, 谁知道, 原来那条}。表上列的是现有的开场状态、生活现状、钱的全部，
// 所以交上来就整个换掉这三格；"原来那条"是这一行改之前的样子——类和是什么没改，原来带着的附加格（跟谁、多少、圈子、家里是哪处住处）照留。
export function rowsMerge(d, rows) {
    d.开场状态 = []; d.生活现状 = []; d.钱 = [];
    for (const r of rows) {
        const 谁 = String(r?.谁 ?? '').trim(), 是 = String(r?.是 ?? '').trim(), 类 = kindOf(r?.类);
        if (!谁 || !是 || !类) continue;
        const knows = names(r.谁知道).filter(n => n !== '只有他自己');
        const old = r.原来 && typeof r.原来 === 'object' && kindOf(r.原来.类) === 类 && String(r.原来.是 ?? '').trim() === 是 ? r.原来 : {};
        d.开场状态.push(openExtras({ ...old, 谁, 类, 是, 谁知道: knows, ok: undefined }));
    }
    for (const x of d.开场状态) delete x.ok;
    return routeRows(d);
}
export function formMerge(data, form = {}) {
    const d = { ...blankSetup(), ...(data ? JSON.parse(JSON.stringify(data)) : {}) };
    if (String(form.基调 ?? '').trim()) d.基调 = String(form.基调).trim();
    if (Array.isArray(form.类别)) d.类别 = [...new Set(form.类别.map(x => String(x).trim()).filter(Boolean))];
    const t = timeOf(form.时间);
    if (t) d.时间 = t;
    if (form.节奏 !== undefined) setPace(d, form.节奏);   // 表上的下拉框：选"中"就是不存（旧版扩展不带这一格，原样留着）
    // 主角团（章程 K1）：名字数组或"、"隔开的字符串，整个替换；空的＝清空；没带这一格（旧版扩展）＝原样留着
    if (form.玩家性别 !== undefined) setGender(d, form.玩家性别);
    if (form.档位 !== undefined) setContentTier(d, form.档位);
    if (form.玩法 !== undefined) setPlay(d, form.玩法);
    if (form.主角团 !== undefined) setCrew(d, Array.isArray(form.主角团) ? form.主角团 : String(form.主角团 ?? '').replace(/\n/g, '、'));
    const replaceRows = (rows, old) => rows.map(x => typeof x === 'string' ? { 内容: x } : x).filter(x => str(x?.内容)).map(x => {
        const previous = old.find(y => y.内容 === (x.原来 ?? x.内容));
        return { ...(previous ?? x.拆分原格 ?? {}), 名: x.名 === undefined ? previous?.名 ?? '' : str(x.名), 内容: str(x.内容) };
    });
    if (Array.isArray(form.主线)) d.主线 = replaceRows(form.主线, d.主线);
    else for (const l of linesOf(form.主线)) if (!d.主线.some(x => x.内容 === l || x.名 === l)) d.主线.push({ 名: '', 内容: l });
    const must = (l, 名) => { if (!d.储备线.some(x => x.内容 === l)) d.储备线.push({ 名, 内容: l, 可选: false, 条件: '', 露法: '', 门槛: '', 终局: false, 拉扯: '' }); };
    if (Array.isArray(form.必要剧情)) {
        const next = replaceRows(form.必要剧情, d.储备线.filter(x => x.可选 === false)).map(x => ({ ...x, 可选: false }));
        d.储备线 = [...d.储备线.flatMap(x => x.可选 !== false ? [x] : next.length ? [next.shift()] : []), ...next];
    }
    else for (const l of linesOf(form.必要剧情)) must(l, '');
    for (const l of linesOf(form.必要情节)) must(l, '必要情节');
    // 全剧情必要角色：数组（新版表上勾的，整个替换，空数组＝去掉那条）或"、"隔开的字符串（旧版表上填的，空着＝原样留着）
    const cast = Array.isArray(form.必要角色) ? names(form.必要角色) : names(String(form.必要角色 ?? '').replace(/\n/g, '、'));
    if (cast.length || Array.isArray(form.必要角色)) d.原则 = [...d.原则.filter(x => !x.条.startsWith(MUST_CAST)), ...(cast.length ? [{ 条: `${MUST_CAST}${cast.join('、')}` }] : [])];
    if (form.开场 !== undefined) d.开场 = String(form.开场).trim();
    if ((Array.isArray(form.主线) || Array.isArray(form.必要剧情)) && form.其他 !== undefined) d.其他 = String(form.其他).trim();
    else if (String(form.其他 ?? '').trim() && !d.其他.includes(String(form.其他).trim())) d.其他 = [d.其他, String(form.其他).trim()].filter(Boolean).join('\n');
    if (Array.isArray(form.人物)) rowsMerge(d, form.人物);
    if (Array.isArray(form.前史)) {
        const old = d.前史 ?? [];
        d.前史 = form.前史.filter(x => String(x?.事 ?? '').trim()).map(x => {
            const previous = old.find(y => y.事 === x.事) ?? x.拆分原格 ?? {};
            const row = { ...previous, 事: String(x.事).trim(), 谁知道: names(x.谁知道).filter(n => n !== '所有人'), 层: LAYERS.includes(x.层) ? x.层 : '本局私设', 谁的版本: x.层 === '某人记得的版本' ? str(x.谁的版本) : '' };
            delete row.不让谁知道;
            if (x.秘密) { Object.assign(row, secretCell(x)); if (!row.处置) row.处置 = '瞒着'; }
            return row;
        });
    }
    if (Array.isArray(form.亲密线)) {
        const pair = row => JSON.stringify(names(row?.谁).sort());
        const old = d.亲密线 ?? [], seen = new Set();
        d.亲密线 = form.亲密线.filter(row => {
            const key = pair(row); if (seen.has(key)) return false; seen.add(key); return true;
        }).map(row => {
            const previous = old.find(x => pair(x) === pair(row));
            // 表单只更新成年确认；旧校验结果重新计算，其他细节照留。
            const { ok, error, ...details } = previous ?? {};
            return { ...details, 谁: previous?.谁 ?? names(row?.谁), 成年: row?.成年 === true };
        });
    }
    if (Array.isArray(form.拆分补充) && form.拆分补充.length) {
        return mergeSetups([{ data: d }, ...form.拆分补充.map(raw => ({ data: { ...blankSetup(), ...Object.fromEntries(['原则', '口径', '走向', '意向'].map(k => [k, list(raw[k])])), 储备线: list(raw.储备线).filter(x => x.可选 !== false) } }))]).data;
    }
    return d;
}
export function formUnshown(data) {
    const d = data ?? {};
    return [['原则', (d.原则 ?? []).filter(x => !str(x.条).startsWith(MUST_CAST)).length], ['称呼口径', d.口径?.length], ['原作走向', d.走向?.length], ['可选储备线', (d.储备线 ?? []).filter(x => x.可选 !== false).length], ['长期意向', d.意向?.length]].filter(([, n]) => n).map(([label, n]) => `${label} ${n} 条`);
}
// 原则里那条"这一局必须有的角色：……"读回名字（给填表时预先勾上）；没有就是空的
export function mustCastOf(data) {
    const row = (data?.原则 ?? []).find(x => String(x?.条 ?? '').startsWith(MUST_CAST));
    return row ? names(String(row.条).slice(MUST_CAST.length)) : [];
}
// 表上那几行的初值：现有的开场状态、生活现状、钱（钱的"是什么"写数目）
export function formRows(data) {
    if (!data) return [];
    const keep = x => { const { ok, ...rest } = x; return rest; };
    return [
        ...(data.开场状态 ?? []).map(x => ({ 谁: x.谁, 类: x.类, 是: x.是, 谁知道: x.谁知道 ?? [], 原来: keep(x) })),
        ...(data.生活现状 ?? []).map(x => ({ 谁: x.谁, 类: x.类, 是: x.是, 谁知道: x.谁知道 ?? [], 原来: keep(x) })),
        ...(data.钱 ?? []).map(x => ({ 谁: x.谁, 类: '钱', 是: String(x.多少), 谁知道: x.谁知道 ?? [], 原来: { ...keep(x), 是: String(x.多少) } })),
    ];
}
// 表格要的：基调和类别必填。
export function formMissing(form = {}) {
    return [!String(form.基调 ?? '').trim() && '基调', !(Array.isArray(form.类别) && form.类别.some(x => String(x).trim())) && '剧情类别'].filter(Boolean);
}

// 确认后的回执："各段去了哪"（谁看得到、什么时候用）。
export function receiptLines(data) {
    if (!data) return [];
    const n = k => (Array.isArray(data[k]) ? data[k].length : data[k] ? 1 : 0);
    const fixed = (data.前史 ?? []).filter(x => x.常驻).length;
    return [
        n('基调') || n('类别') ? `基调、类别：给规划（幕后），角色看不到。` : '',
        n('主角团') ? `主角团（${data.主角团.join('、')}）：给规划，每个节点围着他们排，各人这一段想干什么、和团里谁怎样都要写到。` : '',
        n('开场') ? '开场：给规划；之后以聊天里发生的为准。' : '',
        data.节奏 ? `节奏：${paceWords(data.节奏)}。口袋、沉底、规划的件数照这一档的数走，规划者把它当口味。` : '',
        data.时间 ? `时间：剧情日期从${data.时间.日期 || '开场'}起算，每一轮告诉开口的人现在几号、什么时候${data.时间.天气?.length ? '、天气' : ''}。${scaleWords(data.时间) ? `${scaleWords(data.时间)}："第几天"就是第几${scaleOf(data.时间).word}，规划、沉底、持续的事、过了多久都按它算。` : ''}` : '',
        n('钱') ? `钱（${n('钱')} 人）：账本按它算"手上还剩多少"，开口的人聊到钱时知道自己（和他知道的人）还剩多少。` : '',
        n('生活现状') ? `生活现状（${n('生活现状')} 条）：开场时的样子；之后聊天里添了、换了、坏了跟着改。知道的人每次开口带着住在哪、衣服、身边的东西，家里的样子镜头在那儿才给。` : '',
        ...openReceipt(data.开场状态 ?? []),
        n('原则') ? `原则（${n('原则')} 条）：给规划和参谋。` : '',
        n('前史') ? `前史（${n('前史')} 条）：只给知道的人——和眼下的话有关时递${fixed ? `；标了常驻的 ${fixed} 条每一轮都递` : ''}；也给规划和参谋。` : '',
        n('走向') ? `原作走向（${n('走向')} 条）：给规划和参谋。` : '',
        n('口径') ? `称呼口径（${n('口径')} 条）：当事人开口、对方在场或被提到时递给他。` : '',
        n('主线') ? `主线（${n('主线')} 条）：给规划，只当主题。` : '',
        n('储备线') ? `储备线（${n('储备线')} 条，其中必用 ${(data.储备线 ?? []).filter(x => !x.可选).length} 条）：给规划，条件对上才用。` : '',
        ...(data.亲密线?.length ? [`亲密线（${activeIntimate(data).length} 条生效）：给规划排进口袋，只给牵头的角色；/停 可暂停这一场。`, ...intimateRows(data).filter(x => x.error).map(x => `${x.谁.join('、')}：${x.error}`)] : []),
        n('意向') ? `长期意向（${n('意向')} 条）：给规划，只当方向。` : '',
        n('其他') ? '其他：给规划。' : '',
    ].filter(Boolean);
}

// 人物开场状态各类去了哪（opening.mjs）
const OPEN_RECEIPT = {
    在哪: '开场不在场的人记成在外头（场面表、去向）：镜头不替他写进这场，门上不挂他；开场那天知道的人带着这一句',
    身体: '并进生活现状：知道的人每次开口都带着，聊天里好了、加重了跟着改',
    心事: '开场那场戏里他心里带着，过了这场戏压在底下、碰到才冒，过两天淡了',
    手头的事: '记成他惦记着的事，正文里有了着落就关上；开场不在场的，时间结算替他推进（办到哪了、回音来了没有）',
    约定: '记成说好的事：到日子给当事人，过了没办会有说法',
    欠账: '记进钱的账：还了才减，聊到钱时欠的人和被欠的人都知道',
    名声: '记成名声：写到那个圈子里的人时照着待他',
};
function openReceipt(rows) {
    const kinds = OPEN_KINDS.filter(k => rows.some(x => x.类 === k));
    return kinds.map(k => `开场状态·${k}（${rows.filter(x => x.类 === k).length} 条）：${OPEN_RECEIPT[k]}。`);
}

// ---------- 各处怎么用 ----------

// 主角团名单（章程 K1，数据约定第 7 条）：开局单"主角团"那一格写了就用它（玩家的角色不在里面就补上）；
// 没写：用最近一份规划 node.主角团 里出现的名字（谁、团里的跟谁）＋玩家；都没有：空的（不认谁是主角团，配比不查）。
export function crewOf(setupData, lastPlanNode, userName) {
    const user = String(userName ?? '').trim();
    const own = crewCell(setupData?.主角团);
    const planned = (Array.isArray(lastPlanNode?.主角团) ? lastPlanNode.主角团 : [])
        .flatMap(p => [p?.谁, ...(Array.isArray(p?.团里) ? p.团里.map(t => t?.跟谁) : [])]).filter(x => typeof x === 'string');
    const base = own.length ? own : crewCell(planned);
    if (!base.length) return [];
    return user && !base.some(n => sameName(n, user, base)) ? [...base, user] : base;
}

// 规划简报里的一段（幕后，全给）。
// open(储备线) → 这条这回给不给全文（规划简报按此刻的账定，见 slot.planBrief；不给就全给，老样子）。
export function briefSection(data, { open = null } = {}) {
    if (!data) return [];
    const out = ['【本局设定】（用户的开局单；照这个来，别改）'];
    if (data.基调) out.push(`基调：${data.基调}`);
    if (data.类别?.length) out.push(`类别：${data.类别.join('、')}`);
    if (data.主角团?.length) out.push(`主角团（故事围着转的这几个人，含玩家的角色）：${data.主角团.join('、')}`);
    if (data.开场) out.push(`开场（这一局从哪里开始、开场时各人是什么状态；之后以聊天里发生的为准）：${data.开场}`);
    const t = data.时间;
    if (t) out.push(`开场时间：${[t.日期, t.时段, t.从哪天算 && `${t.从哪天算}算第一${scaleOf(t).word === '天' ? '天' : scaleOf(t).word}、开场是第 ${t.第几天 ?? 1} ${scaleOf(t).ord}`, t.天气?.length && `这时候的天气多是${t.天气.map(x => x.种).join('、')}`, t.气温, scaleWords(t)].filter(Boolean).join('；')}`);
    const each = (title, rows) => { if (rows.length) out.push(title, ...rows.map(r => `· ${r}`)); };
    each('开场时手上的钱：', (data.钱 ?? []).map(x => `${x.谁}：${x.多少}`));
    each('开场时的住处和家当（之后聊天里变了的以聊天为准）：', (data.生活现状 ?? []).map(x => `${x.谁}·${x.类}：${x.是}${x.在哪 ? `（${x.在哪}）` : ''}`));
    each('开场时各人怎么样（之后聊天里变了的以聊天为准）：', (data.开场状态 ?? []).map(x => `${x.谁}·${x.类}：${x.是}（${(x.谁知道 ?? []).includes('所有人') ? '人人都知道' : x.谁知道?.length ? `${x.谁知道.join('、')}也知道` : `只有${personWord(x.谁)}自己知道`}）`));
    each('原则：', data.原则.map(x => x.条));
    each('前史（谁知道／哪一层；写了处置的是知道的人压着不说的）：', data.前史.map(x => `${x.事}（${x.谁知道.join('、') || '所有人'}／${x.层}${x.谁的版本 ? `：${x.谁的版本}` : ''}${x.不让谁知道?.length ? `；不让谁知道：${x.不让谁知道.join('、')}（被蒙着的人可能起疑、追问、打听，可以拿来排事）` : ''}${x.过时 ? '；开场时如此，聊天里后来已经不成立了' : ''}${!x.过时 && x.处置 ? `；处置：${HOLD_KEYS.filter(k => x[k]).map(k => (k === '处置' ? x[k] : `${k}：${x[k]}`)).join('，')}` : ''}）`));
    each('原作走向，这一局怎么定的：', data.走向.map(x => `${x.事}：${x.本局}`));
    each('主线（只当主题）：', data.主线.map(x => `${x.名}：${x.内容}`));
    // 9/27 审计：储备线每次整份给，规划者看见什么就倾向于用什么，设定满的局会变成推任务。平时只给名字和条件；
    // 开了的（玩家碰到了、转向对得上、手上的线已经在用）才给全文。条件看着已经对上了，可以先起这条线（"线"里写它的名字），下一次给全文。
    const full = x => [`${x.名}：${x.内容}`, x.可选 ? '可选' : '必用', x.条件 && `条件：${x.条件}`, x.露法 && `露法：${x.露法}`, x.门槛 && `门槛：${x.门槛}`, x.终局 && '终局专用', x.拉扯 && `拉扯：${x.拉扯}`].filter(Boolean).join('；');
    const shut = x => [`${x.名}`, x.可选 ? '可选' : '必用', x.条件 ? `条件：${x.条件}` : '条件：没写', x.终局 && '终局专用'].filter(Boolean).join('；');
    const shown = data.储备线.map(x => (!open || open(x) ? full(x) : shut(x)));
    each(open && data.储备线.some(x => !open(x)) ? '储备线（条件对上才用；用不用由你。只写了名字和条件的，条件看着对上了，可以先起这条线——"线"里写它的名字，下一次给你全文）：' : '储备线（条件对上才用；用不用由你）：', shown);
    each('亲密线：', activeIntimate(data).map(x => `${x.谁.join('和')}；张力：${x.张力}；现在：${x.现在}；阶梯：${x.阶梯.join(' → ')}；${Object.entries(x.主动).map(([n, v]) => `${n}主动：${v}`).join('；')}；底线：${x.底线.join('、') || '未填写'}；可加入：${x.可加入.join('、') || '无'}；${x.可加入.length ? '写到的人都已成年' : '双方已成年'}`));
    each('长期意向（只当方向）：', data.意向.map(x => x.条));
    if (data.其他) out.push(`其他：${data.其他}`);
    return out;
}

// 这回哪几条储备线给全文（O-22）：转向对得上的；手上的线（上一个节点的线、菜单里的线）已经在用的；
// 最近的聊天、还开着的想法里碰到了它（名字去掉"线"字，至少两个字）的。
export function reserveOpen(data, { thread = null, lines = [], text = '' } = {}) {
    const core = n => String(n ?? '').replace(/(支线|路线|线)$/, '').trim();
    const hit = n => lines.some(l => l && (l === n || (core(l).length >= 2 && core(l) === core(n))));
    return new Set((data?.储备线 ?? []).filter(x => x.名 && (x.名 === thread || hit(x.名) || (core(x.名).length >= 2 && String(text).includes(core(x.名))))).map(x => x.名));
}

// 参谋的本局前提（程序自动带上，问的人不用再写）。
export function advisorContext(data) {
    if (!data) return '';
    return [
        ...data.原则.map(x => `原则：${x.条}`),
        ...data.走向.map(x => `${x.事}：${x.本局}`),
        ...data.前史.filter(x => x.层 !== '某人记得的版本').map(x => x.事),
    ].join('\n');
}

// 名字对得上：一样；或者开局单里写的是名册里某个名字的前半（"甲乙·丙丁"写成"甲乙"），且名册里只有这一个人是这样。
// 名字归一化缓存（10/16 提速：一轮里几十万次）
const NORM = new Map();
const normName = s => { const k = String(s ?? ''); let v = NORM.get(k); if (v === undefined) { v = k.replace(/\s+/g, '').toLowerCase(); if (NORM.size > 20000) NORM.clear(); NORM.set(k, v); } return v; };
const headName = s => normName(s).split(/[·（(]/)[0];
export function sameName(a, b, roster = []) {
    const n = normName;
    if (!a || !b) return false;
    if (n(a) === n(b)) return true;
    const head = headName;
    const [short, full] = n(a).length < n(b).length ? [a, b] : [b, a];
    if (n(short) !== head(full) || /[（(]/.test(full)) return false;
    return roster.filter(r => head(r) === n(short)).length <= 1;
}

// 角色那一格里的一段：他对在场／被提到的人的口径；他知道的前事里和眼下的话有关的（至多两条）。
// 前史里哪几条和眼下的话有关：中文按两字组、三字组，外文按词；越少见的越算数，太常见的（三成以上的条目都有）不算。
// 前史条目少（几十条），不能照搬记录召回那套"一成以上就不算"，不然一局里反复出现的核心地名、人名全被丢掉。
// 问句和叙述里到处都有的词（"怎么""时候""知道"）不拿来比：碰巧对上一条就会把不相干的挑上来。
// 试玩 9/30：只撞上"东西""出去""年前"、跨词拼出来的"的东""掉了""这五"，就把一条不相干的前事递了上去。
// 所以：到处都有的实词也不算；头尾是虚字的两三字组不算（多半是跨词拼出来的）；只撞上一个两字组的不算有关。
const COMMON = new Set(('怎么 什么 为什么 到底 时候 那时 这时 当时 现在 你们 我们 他们 她们 自己 那个 这个 一个 知道 以为 '
    + '是不是 有没有 然后 已经 还是 就是 不是 没有 可以 因为 所以 如果 但是 只是 这么 那么 一下 一起 这些 那些 之后 之前 后来 怎样 '
    + '东西 出去 出来 进来 回去 过来 起来 年前 以前 以后 地方 事情 样子 感觉 觉得 一样 看看 说话 真的 其实 好像 应该 需要 '
    + '开始 最后 一直 还有 这样 那样 有点 一点 这儿 那儿 这里 那里 一会').split(' '));
const EDGE = new Set('的了着得地是在就也都又还很把被给让和与或不没吗呢吧啊呀么这那个一你我他她它');
function terms(text) {
    const out = new Set();
    const plain = g => !EDGE.has(g[0]) && !EDGE.has(g.at(-1)) && ![...Array(g.length - 1).keys()].some(i => COMMON.has(g.slice(i, i + 2)));
    for (const run of String(text).replace(/[^㐀-鿿]+/g, '|').split('|')) {
        for (let i = 0; i + 2 <= run.length; i++) if (plain(run.slice(i, i + 2))) out.add(run.slice(i, i + 2));
        for (let i = 0; i + 3 <= run.length; i++) if (plain(run.slice(i, i + 3)) && !COMMON.has(run.slice(i, i + 3))) out.add(run.slice(i, i + 3));
    }
    for (const w of String(text).toLowerCase().match(/[a-z][a-z0-9'-]{2,}/g) ?? []) out.add(w);
    return out;
}
// 一条前事拿去转向量、做字面比对的那段话：事情本身＋确认时配的检索词。
export const backstoryText = x => `${x.事}\n${(x.keys ?? []).join(' ')}`;
export function rankBackstory(items, talk) {
    const q = terms(talk);
    // 确认时配的检索词（别人问起这件事会用的说法）一起算：字面对不上的（"怎么死的"对"拦腰打断"）靠它接上。
    const docs = items.map(x => ({ x, t: terms(backstoryText(x)) }));
    const df = new Map();
    for (const { t } of docs) for (const w of t) if (q.has(w)) df.set(w, (df.get(w) ?? 0) + 1);
    const n = docs.length, cap = Math.max(3, n * 0.3);
    const said = String(talk);
    return docs.map(({ x, t }) => {
        const hit = [...t].filter(w => q.has(w) && df.get(w) <= cap);
        // 检索词整个出现在话里（"怎么死"对"是怎么死的"）：就是为这种问法配的，直接算有关
        const keyHits = (x.keys ?? []).filter(k => String(k).length >= 2 && said.includes(k));
        // 只撞上一个两字组：多半是碰巧（"东西""年前"一类），不算有关
        if (!keyHits.length && !(hit.length >= 2 || hit.some(w => w.length >= 3))) return { r: { x }, score: 0 };
        const score = hit.reduce((s, w) => s + Math.log(1 + n / df.get(w)), 0) + keyHits.length * Math.log(1 + n);
        return { r: { x }, score: score / Math.sqrt(1 + x.事.length / 60) };
    }).filter(h => h.score > 0).sort((a, b) => b.score - a.score);
}

// 一条前事里有没有还没弄清的一截：只认字面上的"说不清、不知道为什么、原因不明"一类（不认题材）。
const OPEN = /说不清|没人(说|讲)得(清|准|明白)|说不准|讲不清|不清楚|没人知道|谁也不知道|不知道(为什么|为啥|怎么|是什么|是怎么)|原因不明|还不明|不明原因|没查清|没弄清|没搞清|查不出|弄不明白|是个谜|成谜/;
export const openQuestion = text => OPEN.test(String(text ?? ''));

// 过时的前事（用户 10/3：玩家把自己那几年的经历讲给了角色甲，开局单里"甲不知道她那几年经历了什么"还在一轮轮递给甲）：
// 记账标了"过时"的那条前事，从那条消息起不再成立——给角色的不递，给规划的注明。records＝这个窗口看得见的记账（删回去就跟着回去）。
// 按编号认，编号对不上（开局单后来改过）就按开头那句认。
export function staleBackstory(data, records = [], userName = null) {
    if (!data?.前史?.length) return data;
    const head = s => String(s ?? '').replace(/\{\{user\}\}/g, userName ?? '玩家').replace(/\s+/g, '');
    const at = new Map();
    for (const r of records) for (const k of Array.isArray(r.known) ? r.known : []) {
        const m = k?.stale && /^setup:前史:(\d+)$/.exec(k.key ?? '');
        if (!m) continue;
        const title = head(k.title).slice(0, 12);
        let i = Number(m[1]);
        if (title && !head(data.前史[i]?.事).startsWith(title)) i = data.前史.findIndex(x => head(x.事).startsWith(title));
        if (i >= 0 && data.前史[i] && !(at.get(i)?.pos <= r.pos)) at.set(i, { pos: r.pos, by: r.holder_name ?? null });
    }
    return at.size ? { ...data, 前史: data.前史.map((x, i) => (at.has(i) ? { ...x, 过时: at.get(i) } : x)) } : data;
}

// pick(候选, 眼下的话) → [{ r, score }]；不给就用上面的 rankBackstory。
// only：'base'＝一直挂着的（口径、常驻的前事），'recall'＝和眼下的话有关才想起的那几条前事；不给就都要。
export function slotLines(data, { name, present = [], talk = '', roster = [], pick = null, only = null }) {
    if (!data) return [];
    const same = (a, b) => sameName(a, b, roster);
    const lines = [];
    const around = person => present.some(p => same(p, person)) || String(talk).includes(person);
    const tone = data.口径.filter(x => same(x.谁, name) && around(x.对谁));
    if (tone.length) lines.push(`${name}对眼前这些人的称呼和态度（用户定的）：`, ...tone.map(x => `· 对${x.对谁}：${x.怎么}`));
    // 某人记得的版本：知道这个版本的人都给，注明是谁的说法（本人就是"他记得的样子"）。
    const knows = data.前史.filter(x => !x.过时 && (!x.谁知道.length || x.谁知道.some(p => same(p, name))));
    const whose = x => {
        if (x.层 !== '某人记得的版本') return '';
        const owners = names(x.谁的版本);
        return owners.some(o => same(o, name)) ? `（这是${name}记得的样子）` : `（这是${owners.join('、') || '某人'}的说法）`;
    };
    // 标了常驻的：每一轮都给知道的人（前台老爱按常识补错的事，比如用户 10/1：身体这五年一直有人在用，不存在消瘦、变差）
    // 里面带着"说不清""不知道为什么"的（用户 10/3：她回来以后的毛病"具体为什么没人说得清"，放在"不用特意提起"底下，
    // 前台就当这事定了、不用问——人醒不过来，他连一句"多久了、什么感觉"都不问）：单放一栏，写着的照样算数，没弄清的那截他也想弄明白。
    // 他压着不说的（写了处置、知道的人不是所有人）：不在这几块里，那一格"心里压着的事"另给（heldBackstory，held.mjs）
    const held = x => isHeld(x) && x.谁知道.length > 0;
    const fixed = knows.filter(x => x.常驻 && !held(x) && !openQuestion(x.事));
    const open = knows.filter(x => x.常驻 && !held(x) && openQuestion(x.事));
    if (fixed.length) lines.push(`${name}一直知道、一直算数的事（不用特意提起；写到相关的地方别和这些相反，也别自己补出相反的细节）：`, ...fixed.map(x => `· ${x.事}${whose(x)}${secretKeepNote(x) ? `；${secretKeepNote(x)}` : ''}`));
    if (open.length) lines.push(`${name}知道、但还没弄清的事（写着的照样算数，别和它相反；没弄清的那一截${personWord(name)}也不知道，别替${personWord(name)}补上答案；${personWord(name)}在意的话，会想问、想弄明白）：`, ...open.map(x => `· ${x.事}${whose(x)}`));
    if (only === 'recall') lines.length = 0;
    const rest = knows.filter(x => !x.常驻 && !held(x));
    const hits = only === 'base' || !String(talk).trim() ? []
        : (pick ? pick(rest.map(x => ({ x, text: x.事, quotes: [] })), talk) : rankBackstory(rest, talk)).filter(h => h.score > 0).slice(0, 2);
    // 前史是开场之前的事：里面说的"还没见过面""以为他死了"只对开场那一刻成立，之后以聊天里发生的为准（实测：几百条之后还递"两人还没直接见过面"）。
    if (hits.length) lines.push(`${name}知道的前事（开场之前的事，之后变了的以聊天里发生的为准；和眼下的话有关；只是${name}知道的这一版）：`, ...hits.map(({ r: { x } }) => `· ${x.事}${whose(x)}${secretKeepNote(x) ? `；${secretKeepNote(x)}` : ''}`));
    return lines;
}

// 前史里他压着不说的那几条（写了处置、不是"直说"、他在"谁知道"里、没标过时）→ held.mjs 那一块的条目；对谁＝没写在"谁知道"里的在场的人
export function heldBackstory(data, { name, present = [], roster = [] }) {
    if (!data?.前史?.length) return [];
    const same = (a, b) => sameName(a, b, roster);
    return data.前史.filter(x => !x.过时 && isHeld(x) && x.谁知道.length && x.谁知道.some(p => same(p, name)))
        .map(x => ({ 事: x.事, 对谁: present.filter(p => !same(p, name) && !x.谁知道.some(k => same(k, p))).join('、'), ...holdOf(x), ...secretCell(x) }));
}

// ---------- 分格 ----------

// 调模型把开局稿分格（后台跑，不让用户等在请求上）。getConfig().setup ?? extractor 的模型与钥匙。
// ---------- 前史的检索词（确认时配一次） ----------

export const KEYS_SYSTEM = [
    '下面是一部长篇角色扮演开局前已经发生的事，一条一行、带编号。给每一条配 3～6 个检索词，供程序在角色聊到相关话题时把这条找出来：',
    '人名、地名、物件照原样写；再加 1～2 句别人问起这件事时的大白话问法（比如这件事是某人的死，就加"怎么死的"；是谁做的，就加"是谁干的"）——聊天里的人多半这么问，不会用书面词。',
    '只输出一个 JSON：{"1": ["词", "词"], "2": [...]}',
].join('\n');

export function parseBackstoryKeys(text, count) {
    const m = String(text).match(/\{[\s\S]*\}/);
    if (!m) throw new Error('keys_bad_json');
    let raw;
    try { raw = JSON.parse(m[0]); } catch { throw new Error('keys_bad_json'); }
    return Array.from({ length: count }, (_, i) => names(raw[String(i + 1)]).map(k => k.slice(0, 20)).slice(0, 8));
}

export const withKeys = (data, keys) => ({ ...data, 前史: data.前史.map((x, i) => ({ ...x, keys: keys[i] ?? x.keys ?? [] })) });
export const keysPrompt = data => data.前史.map((x, i) => `${i + 1}. ${x.事}`).join('\n');

// 用检索词那档（assembler.keysModel，快而便宜）配；调不通由调用方交给外援。
export function createKeysMaker({ getConfig, records = null, clientFor }) {
    return async function makeKeys(data, { chatKey = '-' } = {}) {
        const config = getConfig();
        const a = config.assembler;
        const k = config.stages?.setupKeys ?? { baseUrl: a?.baseUrl, apiKey: a?.apiKey, model: a?.keysModel, priceInPerM: a?.keysPriceInPerM, priceOutPerM: a?.keysPriceOutPerM, extraBody: null };
        if (!k.baseUrl || !k.apiKey || !k.model) throw Object.assign(new Error('keys_no_model'), { status: 409 });
        const started = Date.now();
        const r = await clientFor({ baseUrl: k.baseUrl, apiKey: k.apiKey, model: k.model, extraBody: k.extraBody, maxOutputTokens: 6000, timeoutMs: 300000, stream: true }).complete({ system: KEYS_SYSTEM, user: keysPrompt(data) });
        const costUsd = ((r.usage?.input ?? 0) * k.priceInPerM + (r.usage?.output ?? 0) * k.priceOutPerM) / 1e6;
        records?.logAssemble?.({ chatKey, speaker: '(前史检索词)', model: k.model, servedModel: r.servedModel, status: 'done', usage: r.usage, costUsd, ms: Date.now() - started, raw: r.text });
        return parseBackstoryKeys(r.text, data.前史.length);
    };
}

export function createSetupMaker({ getConfig, records = null, log = () => {}, clientFor }) {
    return async function makeSetup({ source, names = [], chatKey = '-' }) {
        const config = getConfig();
        const e = { ...config.extractor, ...(config.stages?.setup ?? {}) };   // 开局单那一环节（D-106）；没另选就是记账那档
        if (!e?.baseUrl || !e.apiKey || !e.model) throw Object.assign(new Error('setup_no_model'), { status: 409 });
        if (records?.spentToday && records.spentToday() >= (e.dailyBudgetUsd ?? 3)) throw Object.assign(new Error('budget_reached'), { status: 429 });
        // 一整份长稿子一口气分，输出长、经中转要五分钟以上，连接会被掐断（2026-09-26 连败两次）⇒ 切成几份，
        // 每份带全文作参照、只分自己那一段，三份同时跑，没成的再试一次，最后合并。
        // 9/27 查漏：切了也全超时（8 次都卡在 280 秒）——是中转对长的非流式回答会卡住（D-95）⇒ 改流式读，有字进来就不算超时。
        const client = clientFor({ ...e, maxOutputTokens: Math.max(e.maxOutputTokens ?? 16000, 16000), timeoutMs: 900000, stream: true });
        const parts = splitSource(source);
        const one = async (part, k) => {
            for (let attempt = 1; ; attempt++) {
                const started = Date.now();
                try {
                    const r = await client.complete({ system: SETUP_SYSTEM, user: setupPrompt({ source, names, part: parts.length > 1 ? part : null }) });
                    if (r.finishReason === 'length') throw new Error('setup_truncated');
                    const costUsd = ((r.usage?.input ?? 0) * e.priceInPerM + (r.usage?.output ?? 0) * e.priceOutPerM) / 1e6;
                    records?.logAssemble?.({ chatKey, speaker: `(开局单·${k + 1}/${parts.length})`, model: e.model, servedModel: r.servedModel, status: 'done', usage: r.usage, costUsd, ms: Date.now() - started, raw: r.text });
                    return { ...parseSetup(r.text, { source, names }), costUsd };
                } catch (error) {
                    records?.logAssemble?.({ chatKey, speaker: `(开局单·${k + 1}/${parts.length})`, model: e.model, status: 'failed', ms: Date.now() - started, error: error.message });
                    log(`setup part ${k + 1}/${parts.length} failed (${attempt}): ${error.message}`);
                    if (attempt >= 2) throw new Error(`第 ${k + 1} 段没分成：${error.message}`);
                }
            }
        };
        const results = new Array(parts.length);
        let next = 0;
        await Promise.all(Array.from({ length: Math.min(3, parts.length) }, async () => {
            while (next < parts.length) { const k = next++; results[k] = await one(parts[k], k); }
        }));
        return { ...mergeSetups(results), costUsd: results.reduce((s, r) => s + r.costUsd, 0) };
    };
}
