import { personWord, renderPronouns } from './pronoun.mjs';
// 发言前那一格的真实内容：只从"这个角色当时在场、所以知道"的记录里挑，
// 挑和眼下有关的旧事＋和眼下有关的长期状态＋他自己还开着的事。
// 纯程序，不调模型：renderPlain 直接写成几行（原话片段为主，调研 24 §四-5）；
// 开了叙事组装时再给一批更宽的候选（pool），由 assemble.mjs 请模型串成回忆线。相对时间只认记账里的"时间"记录（§5.6）。
// repeatedPhrases 留着备用，不再放进格子（否定式提醒对前台无效）。

import { elapsedUnits, relativeUnit, scaleOf, DAY } from './timescale.mjs';
import { similar } from './records.mjs';

const RECENT_WINDOW = 30;      // 最近这么多条消息里的事前台自己看得见，不再重复
const MAX_RECALL = 8;
const PLAIN_MAX = 5;          // 纯程序那一格至多给几条旧事（按相关度取前几条）
// 玩家这句在问以前的事（episodes.asksPast，N-284 第二步）：旧事多给些，组装的候选也多些
const MORE = { recall: 14, plain: 10, pool: 36 };
const SENSE_FIRST = 4;        // 按意思（向量）明显对得上的，先占这么多位，剩下的按相关度补（41 句完整流程：3 位 28、4 位 31、5 位 32；留一位给字面直接对上的人名地名）
const MAX_STATE = 4;
const MAX_OPEN = 2;
const TODO_WINDOW = 80;      // 待办只看最近这么多条消息里的
const SOFT_CHARS = 1500;

// "过了多久"换成天数（天尺度）。认法见 timescale.elapsedUnits：以前认得的照旧，另外认得年、季、旬这些大单位（"一走三年"＝1095 天）。
// 留着这个名字给按天写的地方用；按这一局的单位算用 elapsedUnits(text, 尺度)。
export function elapsedDays(text) {
    return elapsedUnits(text, DAY);
}

// 还没记账的消息里明写了时间往前走（"第二天""次日""三天后""过了一周"）：记账记上之前先按这个算，免得新的一天晚一轮才认。
// 只认叙述里的跳转，"明天""下周"这种打算不算；记账记上"时间"以后这条就不再临时算（见 slot.timeMarksFor）。
// 只认叙述（9/27 审计：对白里一句"三天后我们再去一次海边"就让口袋里的事提前沉底）：引号里的对白先去掉；剩下的要在句首
// （开头、句末标点、换行、括号），后面紧跟逗号、句号或"一早""上午"这类——"我第二天就走了"（回忆）、"三天后我们再去"（打算）都不算；
// 逗号后面那一小句是打算（再、要、会、打算、吧……）的也不算。拿不准就不认：记账记上"时间"时自然会算。
const QUOTED = /“[^”]*”|"[^"\n]*"|「[^」]*」|『[^』]*』/g;
// 年、季、旬这些大单位（章程 G2）也认："三年后，""次年开春，"——按年月过的局，跳的是这个。
const SPAN = '[0-9一二两三四五六七八九十百几半]+\\s*(?:天|周|个?星期|个?礼拜|个?月|年|载|个?季度?|旬|个?甲子|个世纪)';
const TIME_OF_DAY = '(?:的)?(?:一大早|一早|清早|早上|早晨|清晨|上午|中午|午后|下午|傍晚|晚上|夜里|深夜|开春|入夏|入秋|入冬|[春夏秋冬][天季]?|[上中下]旬|月初|月中|月底|年初|年中|年底)';
const SKIP = new RegExp(`(?:^|[。！？!?…\\n（(）)】\\]]\\s*)(第二天|次日|隔天|翌日|第[二三四五六七八九十]天|第二年|次年|翌年|来年|次月|${SPAN}(?:之|以)?后|过了\\s*${SPAN})(${TIME_OF_DAY}|\\s*(?:[，,、：:。]|$))([^。！？!?\\n]*)`);
// 逗号、分号后面的一小句（试玩 10/11："这两天没出门，第三天上午才……"认不出）：也认，但后面那半句是打算的（再、要、会……）一律不算。
const SKIP_COMMA = new RegExp(`[，,；;]\\s*(第二天|次日|隔天|翌日|第[二三四五六七八九十]天|第二年|次年|翌年|来年|次月|${SPAN}(?:之|以)?后|过了\\s*${SPAN})(${TIME_OF_DAY}|\\s*(?:[，,、：:。]|$))([^。！？!?\\n]*)`);
const NIGHT = /(一夜过去|天亮了)\s*[。，,！!…]/;
const PLAN = /再|要|会|打算|准备|到时|吧|见|咱们去|我们去/;
export function timeSkipIn(text) {
    const t = String(text ?? '').replace(QUOTED, '');
    const m = SKIP.exec(t);
    if (m && !(/[，,、：:]/.test(m[2]) && PLAN.test(m[3]))) return m[1].replace(/几/g, '三');
    const c = SKIP_COMMA.exec(t);
    // 带上紧跟的时段（"第三天上午"），跨天那条的时段照它
    if (c && !PLAN.test(c[3])) return `${c[1]}${/[，,、：:。]|^\s*$/.test(c[2]) ? '' : c[2].replace(/^的/, '')}`.replace(/几/g, '三');
    const n = NIGHT.exec(t);
    return n ? n[1] : null;
}

// 每条消息位置 → 第几天（从 0 起）。只看看得见的"时间"记录；
// 相隔三条以内的几条"时间"多半说的是同一次（"度过了一夜"＋"第二天早上"），只算一次、取大的。
// 用户离开的那段（absence.mjs 记的，absence: true）之后不远，有人说起"昏了十一天""已经过了十一天"，是在交代那段空白，
// 记账偶尔会记成"时间"（实测一连三条）：天数和离开的差不多的，算那一次，不再加。
// 隔远了也一样（质量窗 9/29：醒来二十多条后他说"你躺的那十一天里"，又被记成过了十一天，剧情日从 20 跳到 31）：
// 天数对得上、原话里又没有"又过了""N 天后"这类往前走的说法，就是在回头说那一段。
const ABSENCE_ECHO = 12;
const FORWARD = /又过|过了|之后|以后|[天周月日年]后|第二天|次日|隔天|翌日|次年|翌年/;
const recalls = m => m.quotes.length > 0 && !FORWARD.test(m.quotes.join(' '));
// 用户在消息上点的（N-265，最高权威）：manual＝"从这条起算新的一天"；setDay＝"这条是第几天"（从开场算起、开场＝0；
// "第六天一早"这种只说第几天的，程序算不出隔了几天）；cancel＝"这里没有跨天"——那条和它后面三条以内
// 系统认的跨天都不算（系统认的跨天落在一组的第一条上，标签也挂在那里）。记账标了"拿不准"（clock.unsure）的不推进，等用户点。
// timeScale：这一局的尺度（timescale.scaleOf；不给就是天）。按单位数；年、月这类尺度下"三个月"记成 0.25 年累加，最后四舍五入。
export function dayIndex(timeRecords, lastPos, timeScale = DAY) {
    const ts = scaleOf(timeScale);
    const took = t => elapsedUnits(t, ts, { exact: true });
    const cancels = timeRecords.filter(r => r.cancel).map(r => r.pos);
    const cancelled = r => !r.manual && !r.absence && cancels.some(p => r.pos >= p && r.pos <= p + 3);
    // 时长那一格没写明、那句话里写了"过了一夜"的也算（试玩 10/6）
    // units：已经折成这一局格数的（此刻的样子报的"第二天·早上"，timeline.noteMarks）
    const raw = timeRecords.filter(r => !r.cancel && !r.clock?.unsure && !cancelled(r))
        .map(r => ({ pos: r.pos, add: Number.isInteger(r.setDay) ? 0 : Number.isFinite(r.units) ? r.units : Math.max(took(r.elapsed ?? r.text), r.elapsed && r.text ? took(r.text) : 0), setDay: Number.isInteger(r.setDay) ? r.setDay : null, absence: !!r.absence, manual: !!r.manual, quotes: Array.isArray(r.quotes) ? r.quotes.map(String) : [] }))
        .filter(m => m.add > 0 || m.setDay != null).sort((a, b) => a.pos - b.pos);
    const marks = [];
    let away = null;
    for (const m of raw) {
        const prev = marks[marks.length - 1];
        // 离开三天以上时差一天也算同一次（"昏了十一天"对上离开十二天）；离开没几天时要一样才算
        // （质量窗 9/28：离开一天后说"两天后的深夜"，被当成交代那一天吞掉了）。
        if (!m.absence && !m.manual && away && Math.abs(m.add - away.add) <= (away.add >= 3 ? 1 : 0) && (m.pos - away.pos <= ABSENCE_ECHO || recalls(m))) continue;
        if (m.absence) away = m;
        // 挨得近的算同一次（用户自己点的两处各算各的）；用户点的那条说了从哪起算，就从那条起
        if (prev && m.pos - prev.pos <= 3 && !(m.manual && prev.manual)) {
            prev.add = Math.max(prev.add, m.add);
            if (m.manual && !prev.manual) Object.assign(prev, { pos: m.pos, manual: true, setDay: m.setDay });
        } else marks.push({ ...m });
    }
    // 定了第几天的：这一处加多少按前面已经算到第几天倒推（系统多算了的也能往回改）
    let running = 0;
    for (const m of marks) { if (m.setDay != null) m.add = m.setDay - running; running += m.add; }
    const sum = pos => marks.reduce((d, m) => (m.pos <= pos ? d + m.add : d), 0);
    return ts.unit === '天' ? sum : pos => Math.round(sum(pos));
}

// 交代、要办的事过没过期（质量窗：联系机会里列着几天前"今晚把车倒进巷子"这种当天的交代）。age＝记下它以来过了几个剧情日。
// 说"今晚、马上、等会儿"的过了当天就不算；说"明天"的过了第二天；别的两周以后不算（按这一局的单位：age 是过了几格，"两周"见 timescale 的 expire）。
const SAME_DAY = /今晚|今天|今早|今夜|天亮前|晚点|晚些|等会|等一下|一会儿|马上|现在就|待会|这就|立刻/;
const NEXT_DAY = /明天|明早|明晚|明儿|天一亮|天亮以后|天亮后/;
// 只管那一时的：说了今晚、半夜、等会儿、明天的，过了那个时候就不算。写着"以后""别再""每次"的是一直照着做的，不按时候过期。
const FOREVER = /以后|今后|往后|从今|[今明]天起|每次|每回|每天|一直|永远|再也|别再|不许再|下次/;
export function timedOut(r, age, timeScale = DAY) {
    if (!(age > 0)) return false;
    const t = String(r?.text ?? '');
    return !FOREVER.test(t) && ((SAME_DAY.test(t) && age >= 1) || (NEXT_DAY.test(t) && age >= 2));
}
export function expiredTodo(r, age, timeScale = DAY) {
    if (!(age > 0)) return false;
    const t = String(r?.text ?? '');
    return (SAME_DAY.test(t) && age >= 1) || (NEXT_DAY.test(t) && age >= 2) || age >= scaleOf(timeScale).expire;
}

// 多久以前怎么说（"昨天""3 天前"；年尺度"去年""5 年前"）。不给尺度就是天，和以前一字不差。
export function relativeDay(delta, timeScale = DAY) {
    return relativeUnit(delta, timeScale);
}

// 中文不分词：按两字组＋三字组算重合（中文关键词多是两个字：发烧、冷汗、医院），
// 出现得太普遍的字组自动降权（类 IDF）。
const grams = text => {
    const s = String(text).replace(/[\s，。！？、；：“”‘’（）()「」…—\-,.!?;:"'【】\[\]<>#0-9A-Za-z]/g, '');
    const out = new Set();
    for (let i = 0; i + 2 <= s.length; i++) out.add(s.slice(i, i + 2));
    for (let i = 0; i + 3 <= s.length; i++) out.add(s.slice(i, i + 3));
    return out;
};

// 虚字：一个字组里虚字占多数（"下来""不下""停不下"）就不拿来比，"不醒""冷汗""发烧"照常。
// 人称和"自己"也算（试玩 10/5：检索词"你就是我自己"拆出来的"我自己"，撞上"我自己在家待着就行"，拿了全场最高分）
const FUNCTION_CHARS = new Set('不了的着得又都就也还很来去下上出过起在是有这那个一把被给让和与或而且就会要能可次第我你他她它们咱自己');
const isContent = gram => [...gram].filter(c => FUNCTION_CHARS.has(c)).length * 2 < gram.length + (gram.length === 2 ? 1 : 0);

// 找和眼下有关的记录：主要看记录的"检索词"有没有出现在眼下这段话里（检索词含同义说法，能跨过换说法），
// 越少见的词分越高；字面重合只作次要参考。没配检索词的旧数据照字面重合算。
// textToo：query 本身就是概念词（模型给用户那句话配的检索词）时，和记录正文字面对上的也算，分数打对折排在后面
// （记录的检索词有时漏了正文里明写的地名物名）。
export function rankByOverlap(candidates, queryText, { textToo = false } = {}) {
    const text = String(queryText ?? '');
    const n = candidates.length;
    if (!n || !text.trim()) return [];
    const literal = rankByGrams(candidates, text);
    if (!candidates.some(r => r.keys?.length)) return literal;
    // 检索词拆成两字组/三字组再和眼下的话比："冒冷汗"能对上"冷汗"，"旧伤发作"能对上"旧伤又犯了"。
    // 检索词都是概念词，拆开也不会有"好不容易"这类填充词来捣乱。
    const q = grams(text);
    // 一个检索词只算一次（取它对上的字组里分最高的那个）：以前每个字组都加，四个字的词（地名）对上一次就顶得上三四个不同的词，
    // 一句话里说了几件事时，字长的那件把别的几件压到底（试玩 10/5：一句里先说了个四字地名、后说到一个老熟人留的保障，那熟人的那几条一条没进前五）。
    const keyGrams = new Map(candidates.map(r => [r, (r.keys ?? []).map(k => [...grams(k)].filter(isContent)).filter(g => g.length)]));
    const df = new Map();
    for (const ks of keyGrams.values()) for (const t of new Set(ks.flat())) if (q.has(t)) df.set(t, (df.get(t) ?? 0) + 1);
    const cap = Math.max(2, n * 0.1);
    const gram = new Map(literal.map(x => [x.r, x.score]));
    const top = literal[0]?.score || 1;
    const weight = t => (q.has(t) && df.get(t) <= cap ? Math.log(1 + n / df.get(t)) * (t.length === 3 ? 1.5 : 1) : 0);
    const scored = candidates.map(r => {
        let keyScore = 0;
        const used = new Set();   // 同一条里两个词对上同一个字组（"码头""码头外"）只算一回
        for (const k of keyGrams.get(r)) {
            const best = k.filter(t => !used.has(t)).reduce((b, t) => (weight(t) > weight(b ?? '') ? t : b), null);
            if (best && weight(best) > 0) { keyScore += weight(best); used.add(best); }
        }
        const g = (gram.get(r) ?? 0) / top;
        return { r, score: keyScore + g, keyScore, g };
    });
    // 有检索词命中就只看命中的（字面重合只作排序参考）；一个都没命中才退回字面重合。
    const hits = scored.filter(x => x.keyScore > 0);
    if (textToo) {
        const floor = Math.min(...hits.map(x => x.score), Infinity);
        const extra = scored.filter(x => !x.keyScore && x.g > 0).map(x => ({ ...x, score: Math.min(x.g * 0.5 * (Number.isFinite(floor) ? floor : 1), floor) }));
        return [...hits, ...extra].sort((a, b) => b.score - a.score);
    }
    return hits.length ? hits.sort((a, b) => b.score - a.score) : literal;
}

function rankByGrams(candidates, queryText) {
    const q = grams(queryText);
    if (!q.size || !candidates.length) return [];
    const docs = candidates.map(r => ({ r, g: grams(`${r.text} ${r.quotes.join(' ')}`) }));
    const df = new Map();
    for (const { g } of docs) for (const t of g) if (q.has(t)) df.set(t, (df.get(t) ?? 0) + 1);
    const n = docs.length;
    const avg = docs.reduce((s, d) => s + d.g.size, 0) / n || 1;
    // 太常见的字组（一成以上的记录都有）不计分；按记录长度归一，免得长记录天然占便宜。
    return docs.map(({ r, g }) => {
        let score = 0;
        for (const t of g) if (q.has(t) && df.get(t) <= Math.max(2, n * 0.1)) score += Math.log(1 + n / df.get(t));
        return { r, score: score / (0.25 + 0.75 * g.size / avg) };
    }).filter(x => x.score > 0).sort((a, b) => b.score - a.score);
}

// 某人最近几条回复里反复出现的说法（4～10 字），给前台一句"不用再说"。
export function repeatedPhrases(texts, { minCount = 3, max = 3 } = {}) {
    const clean = texts.map(t => String(t).replace(/<#[0-9.]+#>|\([A-Za-z][A-Za-z ]{0,24}\)/g, ''));
    const found = new Map();
    for (let len = 10; len >= 4; len--) {
        const counts = new Map();
        clean.forEach((t, i) => {
            const seen = new Set();
            for (let k = 0; k + len <= t.length; k++) {
                const piece = t.slice(k, k + len);
                if (/[\s\n]/.test(piece) || seen.has(piece)) continue;
                seen.add(piece);
                counts.set(piece, (counts.get(piece) ?? 0) + 1);
            }
        });
        for (const [piece, c] of counts) {
            if (c < minCount || /^[，。！？、…—（）()「」“”\s]/.test(piece) || /[（(「“]$/.test(piece)) continue;
            // 和已收的说法大半重叠（只是错开一两个字）的不再收
            if ([...found.keys()].some(p => p.includes(piece) || overlapRatio(p, piece) > 0.5)) continue;
            found.set(piece, c);
        }
    }
    return [...found.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length).slice(0, max).map(([p]) => p);
}

function overlapRatio(a, b) {
    const ga = grams(a), gb = grams(b);
    if (!ga.size || !gb.size) return 0;
    let shared = 0;
    for (const g of gb) if (ga.has(g)) shared++;
    return shared / Math.min(ga.size, gb.size);
}

const knows = (r, name) => r.holder_name === name || (r.audience ?? []).includes(name);
const quote = r => r.quotes.length ? `（原话：「${r.quotes[0]}」）` : '';
const involves = (r, names) => names.some(n => n && ((r.about ?? '').includes(n) || r.text.includes(n) || r.holder_name === n));

// 名字去掉括号里的后缀后相同（同一个人的两个版本）⇒ 算名字相近，前台容易把对方的话当成自己的。
const baseName = n => String(n ?? '').replace(/[（(][^）)]*[）)]s*$/, '').trim();
const similarNames = (a, b) => a && b && a !== b && baseName(a) === baseName(b);

const WIDE_WEIGHT = 1.5;         // 宽说法（大类、场合）对上的分量；用户原话、检索词对上是 2。质量窗 9/27 考题：1.5～3 都比不加强，取偏轻的
const POOL_RELEVANT = 24;      // 给叙事组装的候选：相关的这么多条
const POOL_LITERAL = 6;        // ＋和用户原话字面最接近的这么多条（检索词对不上时按意思挑由模型来）
const POOL_CHANGES = 12;       // ＋沾边的"改变"（人和东西的状态变化）再多给这么多条：状态怎么一步步变过来的，是串线的骨架
const POOL_EPISODE = 10;       // ＋相关记录扎堆的那段戏里的"改变"，每段至多这么多条
const EPISODE_GAP = 25;        // 相关记录前后相隔不超过这么多条消息，算同一段戏
const LESSON_MAX = 2;          // 记住的一回（认过的错、对方受用的一手）：一格至多想起这么多
const LESSON_POOL = 4;         // 给叙事组装的：在场那个人的、最近的这么多回，由模型看眼下像不像
const LESSON_GAP = 2;          // 刚刚那两条里的不算（前台就看得见）
const PIECE_FLOOR = 0.5;      // 用户那句一句一句算时：哪句最对得上的那条，够不上几句里最强那句的这么多，就不往上抬
const PIECE_MAX = 6;
// 用户那句拆成一句一句（句号、问号、叹号、分号、换行；太短的不算一句）
export const piecesOf = text => String(text ?? '').split(/[。！？!?；;\n…]+/).map(s => s.trim()).filter(s => s.replace(/[\s\p{P}]/gu, '').length >= 6).slice(0, PIECE_MAX);

// 记住的一回（extract 的"认错""受用"）：{kind: 错|好, who 学到它的人, with 对方, did, effect, when 情形}。
// 先前记的只有 {with, did, cost}：当成说话人自己认的错。
export const lessonOf = r => {
    const l = r?.lesson;
    if (!l?.with || !l?.did) return null;
    return { kind: l.kind === '好' ? '好' : '错', who: l.who ?? r.holder_name, with: l.with, did: l.did, effect: l.effect ?? l.cost ?? '', when: Array.isArray(l.when) ? l.when : [] };
};
const clip = t => String(t ?? '').replace(/[。．.；;]+$/, '');
export const lessonText = (r, when) => {
    const l = lessonOf(r);
    return `· ${when(r)}，对${l.with}：${clip(l.did)}${l.effect ? `——${clip(l.effect)}` : ''}${l.kind === '错' ? renderPronouns("；〔当事人〕认了这个错", { person: l.who }) : ''}`;
};

// 位置扎堆：相邻两个相隔不超过 EPISODE_GAP 的连成一段；至少两条才算一段。
function clusters(positions) {
    const sorted = [...new Set(positions)].sort((a, b) => a - b);
    const out = [];
    let start = null, prev = null, count = 0;
    for (const p of sorted) {
        if (prev !== null && p - prev <= EPISODE_GAP) { prev = p; count++; continue; }
        if (count >= 2) out.push([start, prev]);
        start = prev = p; count = 1;
    }
    if (count >= 2) out.push([start, prev]);
    return out;
}

// 挑材料（纯程序）。messages＝窗口当前消息（带 pos）；records＝本窗口看得见的记录；recent＝前台刚看到的几句正文。
// 返回分好类的记录；pool＝给叙事组装模型的更宽一批候选（pool: true 时才算）。
// recalled：这个角色最近几格里已经用过的记录（编号 → 几格）。眼下这句话不是正冲着它说的，就不再给，
// 免得同一件旧事轮轮被想起（组装候选里留着但标出来、往后排）。
// timeMarks：记录以外的"过了多久"（用户离开期间剧情里过去的天数，absence.mjs）。
// 记账时认出"和设定不一样"的（质量窗 10/2；N-279，试玩：设定"将近半年陆续划走"，嘴里说成"半个月就抽空"，记账照记、一轮轮喂回去就坐实了）：
// 那是当时有人这么说，不是事实——给的时候带上"以设定为准"。只有和开局单、真触发的世界书对不上才算（用户 10/2：疑罪从无）。
const clashes = r => (Array.isArray(r?.known) ? r.known : []).filter(k => k?.clash);
export const withClash = r => (clashes(r).length ? { ...r, text: `${String(r.text).replace(/[。．.]+$/, '')}（这是当时的说法，和「${clashes(r).map(k => k.title).join('」「')}」对不上，以那条为准）` } : r);

export function selectMaterial({ name, present = [], messages, records: given, openIdeaIds, recent = [], recentUser = '', queryKeys = [], queryWide = [], sense = null, recalled = new Map(), timeMarks = [], timeRecs = null, anchors = null, avatar = null, pool: wantPool = false, skipOpen = null, more = false, scale = 1, timeScale = DAY, tag = null }) {
    // scale：跟着 ST 的上下文大小（slot.roomFit，N-288）：旧事给几条照它放宽、收窄，至少一条
    const n = k => Math.max(1, Math.round(k * (Number(scale) > 0 ? scale : 1)));
    const empty = { name, entry: null, hits: [], state: [], open: [], pool: [], stale: new Set(), when: () => '', who: () => '', more };
    const records = given.map(withClash);
    if (!records.length) return empty;
    const lastPos = messages.length ? messages[messages.length - 1].pos : 0;
    const recentFrom = lastPos - RECENT_WINDOW;
    // 算日子用全部的"时间"记录（timeRecs）：给他看的那份筛过（伤病那道闸拿掉了写着推药的"睡了一夜"），拿它算会少跨几天，
    // 旧事全往近里说（试玩 10/12：第 8 天的场记里第 5、6 天的事成了"昨天""今天早些时候"）
    const toDay = dayIndex([...(timeRecs ?? records.filter(r => r.type === '时间')), ...timeMarks], lastPos, timeScale);
    const today = toDay(lastPos + 0.5);   // 最后一条之后刚离开过（离开记在那条之后半格）：回来先开口的这一轮，今天已经是离开之后
    // tag(第几格, 今天)：场记里说"哪天"的同一种写法（timeline.timeTag）；没给照旧说离今天多远
    const when = r => (tag ? tag(toDay(r.pos), today) : relativeDay(today - toDay(r.pos), timeScale));
    const mine = records.filter(r => knows(r, name));
    // 最近几条里记的不当"旧事"想（聊天里看得见）；后台替他补记的（镜头外自己碰上的、这段时间干了什么、听说的）不在正文里，最近的也算
    // （试玩 10/7：中介那件交给他、他那条没提，下一条被问起时它还在"最近"里，就没想起来）
    // 最近的也只算他看得见的：他的隔离区间只给他在场的那几段，没在场（刚进场前、远程）的那部分他看不见，哪怕在最近几条里也算旧事（章程 #9）。
    // 没记区间的人、旁白（看得见全部）照旧
    const mySegs = name === '旁白' ? null : anchors?.[avatar]?.segments;
    const inSight = r => !Array.isArray(mySegs) || !mySegs.length || mySegs.some(s => r.pos >= s.from && (s.to == null || r.pos < s.to));
    const old = mine.filter(r => r.pos < recentFrom || !inSight(r) || (r.job_id == null && !['了结', '时间'].includes(r.type)));
    const used = new Set();
    // 说这话/做这事的是名字相近的另一个人：写明不是他，免得前台把对方的话当成自己说过的。
    const who = r => similarNames(r.holder_name, name) ? `（这是另一位「${r.holder_name}」的事，不是${name}自己）` : '';

    // 刚进场：他不在场时的事他不知道。
    let entry = null;
    const segs = avatar && anchors?.[avatar]?.segments;
    const current = segs?.find(s => s.to == null);
    if (current && lastPos - current.from <= 3) {
        const lastSeen = [...mine].reverse().find(r => r.pos < current.from);
        entry = lastSeen
            ? `${name}刚到场。${name}上次在场是${when(lastSeen)}；那之后这里发生的事，${name}没看见，除非有人当面告诉过${name}。`
            : `${name}刚到场。进门之前这里发生的事、说过的话，${name}没看见也没听见，除非有人当面告诉过${name}。`;
    }

    // 和眼下有关的旧事：用户刚说的那句加倍算，前面几条只作补充。
    // 碰上了、还没下文的事（matters.mjs）有自己那一块，这里不重复；有了着落以后就是一段普通的记忆
    const candidates = old.filter(r => r.type !== '时间' && r.type !== '余波' && !(r.matter && !r.closed_by));
    // 两边各自按最高分缩到 0～1 再合：长的旧消息分数天然高，不缩的话"加倍"压不住。
    const scoreOf = (q, opts) => {
        const ranked = q ? rankByOverlap(candidates, q, opts) : [];
        const top = ranked[0]?.score || 1;
        return new Map(ranked.map(x => [x.r.id, x.score / top]));
    };
    // queryKeys：模型给用户那句话配的检索词（和记录的检索词同一种说法），能接住字面对不上的换说法。
    const byRest = scoreOf(recent.join('\n')), byKeys = scoreOf(queryKeys.join(' '), { textToo: true });
    // 用户那句里说了几件事（一句一件）：每一句也各按自己最对得上的算，取高的——不然整段一起比，最对得上的那件定了分母，
    // 别的几件都排到它的三成以下，既进不了前几条，也不算"正冲着说的"（试玩 10/5：说到一个老熟人留的保障，他当初那整段经过一条没给）。
    // 只字面沾一点的那句不往上抬：分母至少是几句里最强那句的一半。
    const { byUser, whole, leads } = (() => {
        const whole = scoreOf(recentUser, { textToo: true });
        const parts = piecesOf(recentUser);
        if (parts.length < 2) return { byUser: whole, whole, leads: [] };
        const ranked = parts.map(p => rankByOverlap(candidates, p, { textToo: true }));
        const strongest = Math.max(0, ...ranked.map(rs => rs[0]?.score ?? 0)) || 1;
        const out = new Map(whole), leads = [];
        ranked.forEach((rs, i) => {
            const top = Math.max(rs[0]?.score ?? 0, strongest * PIECE_FLOOR);
            for (const x of rs) out.set(x.r.id, Math.max(out.get(x.r.id) ?? 0, x.score / top));
            if (rs[0] && rs[0].score >= strongest * PIECE_FLOOR && !leads.some(l => l.id === rs[0].r.id)) leads.push({ id: rs[0].r.id, piece: parts[i] });
        });
        return { byUser: out, whole, leads };
    })();
    // 宽一点的说法（大类、场合：记录的 wide，眼下这句的 queryWide）：只在具体的词对不上时帮着接上，分量给得轻。
    const wideOf = new Map(candidates.filter(r => r.wide?.length).map(r => [r.id, r.wide]));
    let byWide = new Map();
    if (queryWide.length && wideOf.size) {
        const ranked = rankByOverlap(candidates.map(r => ({ ...r, keys: [...(r.keys ?? []), ...(wideOf.get(r.id) ?? [])] })), queryWide.join(' '));
        const top = ranked[0]?.score || 1;
        byWide = new Map(ranked.map(x => [x.r.id, x.score / top]));
    }
    // sense：按意思（向量）明显对得上的，0～1（vectors.senseScores）；字面对不上的换说法靠它接住。
    const bySense = id => sense?.get(id) ?? 0;
    const relevance = new Map(candidates.map(r => [r.id, 2 * (byUser.get(r.id) ?? 0) + (byRest.get(r.id) ?? 0) + 2 * (byKeys.get(r.id) ?? 0) + WIDE_WEIGHT * (byWide.get(r.id) ?? 0) + 3 * bySense(r.id)]));
    const ranked = candidates.filter(r => relevance.get(r.id) > 0).sort((a, b) => relevance.get(b.id) - relevance.get(a.id));
    // 正冲着它说的（用户这句话直接对上）照给；否则最近几格用过的算"说过了"。
    // 一句一句算的只认每句最对得上的那条（不然一段话五六句，句句都抬出一串来）
    const direct = new Set(candidates.filter(r => (whole.get(r.id) ?? 0) >= 0.3 || leads.some(l => l.id === r.id) || (byKeys.get(r.id) ?? 0) >= 0.3 || bySense(r.id) >= 0.6).map(r => r.id));
    const isStale = id => recalled.has(id) && !direct.has(id);
    // 有向量时，按意思最对得上的几条先占位：字面打分分不清真相关和撞了词（"合成面"撞上一堆"合成肉排""合成蛋白棒"，
    // 把换了说法的"微波炉罢工"挤出去；9/29 并入质量窗后 41 句的完整流程从 31 掉到 25）。
    const senseFirst = sense?.size ? candidates.filter(r => bySense(r.id) > 0 && !isStale(r.id)).sort((a, b) => bySense(b.id) - bySense(a.id)).slice(0, SENSE_FIRST) : [];
    // 记住的一回（认过的错、对方受用的一手）：不常驻，要用的时候才想起（用户 10/5："这种事越来越多……常驻会干扰剧情，
    // 明明当前跟这个没关系，剧情硬扯上这个。不能做成需要的时候才召回吗"）。在场有那个人，而眼下对得上当时的情形——
    // 对方这句话（又不肯照他的安排）、或者他自己上一条（又放了狠话）——才给。叙事组装那条路上另由模型看像不像（pool）。
    const same = (a, b) => !!a && !!b && baseName(a) === baseName(b);
    const lessonCands = mine.filter(r => { const l = lessonOf(r); return l && same(l.who, name) && present.some(p => same(p, l.with)) && r.pos <= lastPos - LESSON_GAP; });
    let lessons = [];
    if (lessonCands.length) {
        const keyed = lessonCands.map(r => ({ ...r, keys: [...lessonOf(r).when, ...(r.keys ?? [])] }));
        const own = [...messages].reverse().find(m => m.pos > lastPos - 6 && m.text && (m.name === name || (avatar && m.speaker === avatar)))?.text ?? '';
        const hitBy = text => new Set(text?.trim() ? rankByOverlap(keyed, text).filter(x => x.keyScore > 0).map(x => x.r.id) : []);
        const byLine = hitBy(recentUser), byOwn = hitBy(own);
        // 最近几格刚想起过的，除非眼下又对上了（对方这句、或者他上一条又那样做了），不再给
        lessons = lessonCands.filter(r => (byLine.has(r.id) || byOwn.has(r.id) || bySense(r.id) >= 0.6) && (!recalled.has(r.id) || byLine.has(r.id) || byOwn.has(r.id)))
            .sort((a, b) => b.pos - a.pos).slice(0, LESSON_MAX).sort((a, b) => a.pos - b.pos);
        lessons.forEach(r => used.add(r.id));
    }
    // 用户那句里每一件事最对得上的那条，先占位（一件事至少想起一条）
    const leadRecs = leads.map(l => candidates.find(r => r.id === l.id)).filter(r => r && relevance.get(r.id) > 0 && !isStale(r.id) && !used.has(r.id));
    const order = [...new Set([...senseFirst, ...leadRecs, ...ranked.filter(r => !isStale(r.id))])].filter(r => !used.has(r.id));
    const hits = order.slice(0, n(more ? MORE.recall : MAX_RECALL)).sort((a, b) => a.pos - b.pos);
    hits.forEach(r => used.add(r.id));
    // 纯程序那一格少给几条（D-100 起第一个开口的人更常拿到它，得读着顺、不像流水账）：按相关度取前 5 条；原话只给最相关的两条。
    // 不按"够不上最相关那条的几成"筛：字面打的分分不清真相关和撞了词（实测"今晚谁睡沙发"筛掉了四百条前沙发弹簧断了，
    // "排异又犯了"却留下了只沾"神经接口"的芯片）。组装那条路照旧用 hits（候选宽一点，挑由模型来）。
    const firsts = [...new Set([...senseFirst, ...leadRecs])].filter(r => hits.includes(r));
    const byScore = [...firsts, ...hits.filter(r => !firsts.includes(r)).sort((a, b) => relevance.get(b.id) - relevance.get(a.id))];
    const plainHits = byScore.slice(0, n(more ? MORE.plain : PLAIN_MAX)).sort((a, b) => a.pos - b.pos);
    const quoted = new Set(byScore.slice(0, 2).map(r => r.id));

    // 长期或永久的改变：只在和眼下有关、或他刚到场时给。每轮都给会被前台当成每轮都要处理的事
    // （实测：一条医嘱类的持续约束让角色几十轮都围着它转）。
    const lasting = mine.filter(r => r.type === '改变' && ['直到被改变', '永久'].includes(r.duration) && !used.has(r.id) && r.pos < recentFrom);
    const stateRank = r => (relevance.get(r.id) ?? 0) * 10 + (involves(r, [name, ...present]) ? 1 : 0);
    const state = [];
    for (const r of [...lasting].filter(r => (entry || relevance.get(r.id) > 0) && !isStale(r.id)).sort((a, b) => stateRank(b) - stateRank(a) || b.pos - a.pos)) {
        if (state.length >= MAX_STATE) break;
        if (state.some(s => overlapRatio(s.text, r.text) > 0.5)) continue;   // 同一件事记了两条的只给一次
        state.push(r);
    }
    state.sort((a, b) => a.pos - b.pos).forEach(r => used.add(r.id));

    // 他自己还开着的想法和答应过的事（别人的打算、名字相近的另一位的，不放这里）。
    // "想法"等到了结才关；"待办"没人去关，太久以前的（多半早办完或过期了）不再提。
    // 约定（N-268）：了结了才关；今天到时候的、过了没办的另有一块（slot 的"今天说好的"，skipOpen），这里不重复；畅想只在聊到了时想起。
    // 打算里写明只管那一时的（"等天一亮再说""今晚先……"），过了那个时候不再惦记（约定另有到期那一套）
    const openAll = mine.filter(r => ((r.type === '想法' && openIdeaIds.has(r.id) && (r.promise || !timedOut(r, today - toDay(r.pos), timeScale))) || (r.promise && openIdeaIds.has(r.id)) || (r.todo && !r.closed_by && r.type !== '想法' && !r.promise && lastPos - r.pos <= TODO_WINDOW && !expiredTodo(r, today - toDay(r.pos), timeScale)))
        && !(r.promise?.kind === '畅想' && !(relevance.get(r.id) > 0)) && !skipOpen?.has(r.id)
        && !used.has(r.id) && r.holder_name === name && !isStale(r.id));
    const open = [...openAll.filter(r => r.pos < recentFrom), ...openAll.filter(r => r.pos >= recentFrom)].slice(-MAX_OPEN).sort((a, b) => a.pos - b.pos);

    // 给叙事组装的候选：相关的（再用最相关几条的检索词扩一轮，接住换了说法的）、它们前后挨着的、
    // 以及他知道的人和东西的状态变化。模型从里面挑、串成线；这里宽一点，挑由它来。
    let pool = [];
    if (wantPool && ranked.length) {
        const seeds = ranked.slice(0, 6).flatMap(r => r.keys ?? []);
        const expand = seeds.length ? rankByOverlap(candidates, seeds.join(' ')) : [];
        const top2 = expand[0]?.score || 1;
        const more = new Map(expand.map(x => [x.r.id, x.score / top2]));
        const score = r => ((relevance.get(r.id) ?? 0) + 0.5 * (more.get(r.id) ?? 0)) * (isStale(r.id) ? 0.4 : 1);
        const picked = new Map();
        const scored = candidates.filter(r => score(r) > 0).sort((a, b) => score(b) - score(a));
        for (const r of scored.slice(0, more ? MORE.pool : POOL_RELEVANT)) picked.set(r.id, r);
        // 和用户原话字面最接近的几条也放进来：检索词对不上、只在字面沾一点的（"加热器又不转了"和"微波炉罢工"只沾"这破"），
        // 分数排不进前面，可只要在候选里，组装的模型能按意思挑出来（实测三个模型都挑中了）。
        for (const x of rankByGrams(candidates, recentUser).slice(0, POOL_LITERAL)) picked.set(x.r.id, x.r);
        const near = new Set(ranked.slice(0, 8).map(r => r.pos));
        for (const r of old) if ([...near].some(p => Math.abs(r.pos - p) <= 1)) picked.set(r.id, r);
        // "时间"记录有时带着要紧的内容（"醒来发现症状一次比一次轻"），沾边的也给。
        const times = old.filter(r => r.type === '时间');
        if (times.length) for (const x of rankByOverlap(times, [recentUser, ...recent, ...queryKeys, seeds.join(' ')].join('\n')).slice(0, 4)) picked.set(x.r.id, x.r);
        for (const r of scored.filter(r => r.type === '改变').slice(0, POOL_CHANGES)) picked.set(r.id, r);
        // 相关的几条扎堆在同一段（同一场戏）里：这段里的状态变化都给上——
        // 那场戏怎么收场的（比如"当场昏了过去"）往往不含眼下的字眼，却是这条线的一环。
        for (const [from, to] of clusters(ranked.slice(0, 12).map(r => r.pos))) {
            for (const r of candidates.filter(r => r.type === '改变' && r.pos >= from && r.pos <= to).slice(0, POOL_EPISODE)) picked.set(r.id, r);
        }
        for (const r of state) picked.set(r.id, r);
        pool = [...picked.values()].sort((a, b) => a.pos - b.pos || a.id - b.id);
    }
    // 记住的一回：在场那个人的、最近几回都放进组装的候选（标出来），像不像眼下由模型看；字面对上的那几回也在里面
    const lessonPool = wantPool ? [...new Set([...lessons, ...[...lessonCands].sort((a, b) => b.pos - a.pos).slice(0, LESSON_POOL)])] : [];
    if (lessonPool.length) pool = [...new Map([...pool, ...lessonPool].map(r => [r.id, r])).values()].sort((a, b) => a.pos - b.pos || a.id - b.id);
    const stale = new Set(pool.filter(r => isStale(r.id)).map(r => r.id));
    return { name, entry, hits, plainHits, quoted, state, open, pool, stale, when, who, relevance, direct, more, leads, lessons, lessonIds: new Set(lessonPool.map(r => r.id)) };
}

// 眼下对上了的那一回（认过的错、对方受用的一手）：只说他想起来了，怎么做由他
export const lessonLines = ({ name, lessons = [], when }) => (lessons.length
    ? [`眼下的情形，让${name}想起自己以前的一回（${personWord(name)}记得；这回怎么做由${personWord(name)}，不用特意提起）：`, ...lessons.map(r => lessonText(r, when))] : []);

// 纯程序版的一格：按时间顺序给，同一天的并成一行（读着像一段话，不像清单）；原话只挂在最相关的两条上。
export function renderPlain({ name, entry, hits, plainHits = null, quoted = null, state, open, when, who, lessons = [] }) {
    const lines = [];
    if (entry) lines.push(entry);
    lines.push(...lessonLines({ name, lessons, when }));
    const shown = plainHits ?? hits;
    if (shown.length) {
        lines.push(`${name}记得的、和眼下有关的旧事：`);
        const groups = [];
        for (const r of shown) {
            const w = when(r), g = groups.at(-1);
            if (g && g.when === w) g.items.push(r); else groups.push({ when: w, items: [r] });
        }
        for (const g of groups) lines.push(`· ${g.when}：${g.items.map(r => `${String(r.text).replace(/[。．.]+$/, '')}${who(r)}${!quoted || quoted.has(r.id) ? quote(r) : ''}`).join('；')}。`);
    }
    if (state.length) {
        lines.push(`${name}知道的、一直算数的现状：`);
        for (const r of state) lines.push(`· ${r.text}${who(r)}（${when(r)}起）`);
    }
    lines.push(...renderOpen({ name, open, when, who }));
    return finish(name, lines);
}

// 他问过、要过对方、还没回音的（他自己的"待办"里不是约定、不是想法的那些）单列：和他自己要办的混在"挑一件眼下就能做的"里，
// 前台会把"你自己穿还是我替你塞"这种逼人的话当成待办再逼一遍（试玩 10/3）。对方没接话也是一种回答。
export const askedOther = r => !!r.todo && !r.promise && r.type !== '想法';
export function renderOpen({ name, open, when, who }) {
    if (!open.length) return [];
    const line = r => `· ${r.text}${who(r)}（${when(r)}）`;
    const mine = open.filter(r => !askedOther(r)), asked = open.filter(askedOther);
    return [
        ...(mine.length ? [`${name}惦记着、想办的（挑一件眼下就能做或能问的；提不提、什么时候提由${personWord(name)}）：`, ...mine.map(line)] : []),
        ...(asked.length ? [`${name}问过、要过对方，还没回音的（对方没接也是一种回答；要不要再提由${personWord(name)}，别一句句追着要）：`, ...asked.map(line)] : []),
    ];
}

export function finish(name, lines) {
    if (!lines.length) return '';
    const head = `以下是${name}自己知道、此刻可能用得上的事，只供参考：\n`;
    let text = head + lines.join('\n');
    while (text.length > SOFT_CHARS && lines.filter(l => l.startsWith('· ')).length > 1) {
        lines.splice(lines.findIndex(l => l.startsWith('· ')), 1);
        text = head + lines.join('\n');
    }
    return text;
}

export function assembleSlot(args) {
    return renderPlain(selectMaterial(args));
}


// 旁白只按镜头所在的地方和眼前没卡的人召回旧事，避免把个人底子塞进镜头。
// when(行)→"昨天""3 天前"这类说法（行有 pos 或 from_pos）；地方的中心词取末两三字（"廖姐的便利店"看"便利店"）；
// 最近 RECENT_WINDOW 条里的不算旧事（前台自己看得见）
// 眼前没卡的人（旁白演他）：和玩家打过的交道按分量挑，钱和东西、说定的、要办的、他自己说过做过的在前（用户 10/13：
// 旁白演的那个手艺人一直没提订的那件东西用的什么料，写成了普通的——下单那天说的料子、价钱、定金都在账上，只是按"最近四条"挑，挑到的全是这两天催尺寸的话）
const FACE_MAX = 8;
const recallWeight = (r, own) => 1 + (r.money || r.type === '钱' ? 3 : 0) + (r.promise || r.todo ? 2 : 0) + (r.type === '了结' ? 2 : 0) + (own && ['说', '做'].includes(r.type) ? 1 : 0);
export const recordKnownTo = (r, name, same = (a, b) => a === b) => !!name && (same(r.holder_name, name) || (r.audience ?? []).some(n => same(n, name)));

// 旁白演到这个人时，只从他知道的旧账里挑；心里和余波不借旁听扩大到别人。
export function faceRecall({ visible = [], name, same = (a, b) => a === b, lastPos = Infinity, max = 4 } = {}) {
    const own = r => !!r.holder_name && same(r.holder_name, name);
    const candidates = visible.filter(r => (Number(r.pos) || 0) < lastPos - RECENT_WINDOW && r.type !== '时间'
        && recordKnownTo(r, name, same) && (!['心里', '余波'].includes(r.type) || own(r)));
    const picked = [];
    for (const r of candidates.sort((a, b) => recallWeight(b, own(b)) - recallWeight(a, own(a)) || (Number(b.pos) || 0) - (Number(a.pos) || 0))) {
        if (picked.length >= Math.min(4, max)) break;
        if (!picked.some(p => similar(p.text, r.text) >= 0.6)) picked.push(r);
    }
    return picked;
}
export function placeRecall({ visible = [], episodes = [], board = null, faces = [], when = () => '之前', max = 4, lastPos = Infinity, userName = null } = {}) {
    const place = String(board?.camera?.place ?? '').trim();
    if (!place && !faces.some(Boolean)) return [];
    // 中心词先去掉末尾的方位词（"工作台边"取了"台边"，撞上"吧台边"；试玩 10/13），"的"打头的不要
    const base = place.replace(/(?:旁边|边上|门口|外头|里头|附近|跟前|[边前里外旁口上下内中])$/, '') || place;
    const cores = [...new Set([place, base, base.slice(-3), base.slice(-2)])].filter(w => w.length >= 2 && !w.startsWith('的'));
    const names = new Set(faces.filter(Boolean).map(String));
    const hay = row => [row?.text, row?.about, ...(Array.isArray(row?.keys) ? row.keys : [row?.keys])].filter(Boolean).join(' ');
    const atPlace = row => cores.some(w => hay(row).includes(w));
    const old = visible.filter(r => (Number(r.pos) || 0) < lastPos - RECENT_WINDOW && r.type !== '时间'
        // 玩家心里想的、已经作为消息递过来的（场记另有一块"刚收到的消息"）不在这儿重复
        && r.type !== '消息' && r.type !== '余波' && !(r.type === '心里' && userName && r.holder_name === userName));
    const pos = r => Number(r.pos) || 0;
    const by = n => r => r.holder_name === n || String(r.text ?? '').startsWith(n);
    const weight = (r, n) => recallWeight(r, by(n)(r));
    const picked = [];
    for (const n of names) {
        const mine = [];
        for (const r of old.filter(r => by(n)(r) || hay(r).includes(n)).sort((a, b) => weight(b, n) - weight(a, n) || pos(b) - pos(a))) {
            if (mine.length >= FACE_MAX) break;
            if (mine.some(p => similar(p.text, r.text) >= 0.6) || picked.includes(r)) continue;
            mine.push(r);
        }
        picked.push(...mine);
    }
    // 眼前有他演的人、和他打过交道，镜头的地方又只是叙述里随口带的一处（"工作台边""门口"，board 的 fast）：只给这个人的交道，
    // 不按地方名捞（捞来的是别处工作台上的事，试玩 10/13）；地方是正经认下的，照旧给几条，有交道时少给
    const loose = picked.length > 0 && board?.camera?.from === 'fast';
    const here = loose ? [] : old.filter(r => atPlace(r) && !picked.includes(r)).sort((a, b) => pos(b) - pos(a)).slice(0, picked.length ? Math.min(2, max) : max);
    const rows = [...picked, ...here].sort((a, b) => pos(a) - pos(b))
        .map(r => `· ${when(r)}：${String(r.text || r.about).replace(/[。．.]+$/, '')}`);
    const samePlace = e => {
        const ep = String(e?.place ?? '');
        return place && ep && (ep === place || ep.includes(place) || place.includes(ep) || cores.some(w => ep.includes(w)));
    };
    // 场次经过：这地方的，和眼前没卡的人在场的（下单那一场在他的工坊，眼下在他的门店前，地方名对不上）——头一回打交道那场和最近一场
    // 他在场的场次优先（只是被提到一句的排后）
    const withFace = e => [...names].some(n => (e?.present ?? []).includes(n));
    const mentions = e => [...names].some(n => String(e?.text ?? '').includes(n));
    const usable = e => (e.text || e.story) && (Number(e.to_pos) || 0) < lastPos - RECENT_WINDOW;
    const byPos = (a, b) => (Number(a.from_pos) || 0) - (Number(b.from_pos) || 0);
    const met = episodes.filter(e => usable(e) && (withFace(e) || (!loose && samePlace(e)))).sort(byPos);
    const eps = met.length ? met : episodes.filter(e => usable(e) && mentions(e)).sort(byPos);
    const passed = [...new Set([eps[0], eps.at(-1)].filter(Boolean))]
        .map(e => `· ${when(e)}，${samePlace(e) ? '在这儿' : `在${e.place || '别处'}`}：${e.text || e.story}`);
    return [...rows, ...passed];
}
