// 场次摘要（N-284，用户 10/4："问他昨晚我们都干了什么，组装叙事能不能递上来"）：
// 记账是一笔一笔的事，拼不出"那天干了什么"；这里在它上面加一层——一场戏收尾以后，便宜模型照原文写一段经过
// （哪天什么时候、在哪、谁在场、发生了什么、说了哪些要紧的话、怎么收的）。挂在那几条消息上：那段里删了、改了哪条，这段就作废、重写。
// 只给当时在场的人。问"昨晚""前天""这几天"按剧情日取那几场整段给；问某件事，召回挑中的旧账落在哪场，就把那场的经过一起给。
// 题材无关：时间说法、场的切法都是通用的。
import { createHash } from 'node:crypto';
import { scaleOf, DAY } from './timescale.mjs';

export const EPISODE_SYSTEM = [
    '你在给一部长篇角色扮演整理"场次摘要"：把一段聊天按场分开，每场写一段经过，给角色以后回忆用——以后有人问起"那天都干了什么"，就照这段说。',
    '一场＝同一段时间、同一个地方连着的一段戏。隔了天、跳过了一段时间（"第二天""几个小时后""醒来"）、换了地方，就是新的一场；同一场里说了很多话不用拆。每条消息前的地方标记是判断依据。',
    '每场写：',
    '- "在哪"：几个字。',
    '- "在场"：在场的人名（说了话的、做了事的、在旁边看着的）；只是被提到、人不在的不算。',
    '- "经过"：150～300 字，按先后写发生了什么、谁对谁说了哪些要紧的话（交代的往事、约定、答应和拒绝、数目、名字、地点照原文）、关系有什么变化、这场怎么收的。',
    '只写在场的人看得见、听得见的：括号里的心里话、没说出口的念头不写。不评价、不分析谁的心思、不加原文没有的细节；用名字，不用"你""我"。东西照原文写（料子、牌子、颜色、数目），原文没写的别补（"纯棉"别写成"化纤"，"被褥"别写成"棉被"之外的东西）。',
    '【前情】那几条只帮你接上文，不写进摘要。最后一场要是还没收尾（话说到一半、人还在原地接着来），照样写，标"未完"。',
    '只输出一个 JSON：{"场": [{"从": 消息号, "到": 消息号, "在哪": "", "在场": [""], "经过": "", "未完": false}]}——消息号覆盖要整理的整段，按先后，不重叠。',
].join('\n');

// messages：[{ n, name, when, text }]；before：前情几条（同样的形状）。
export function episodePrompt({ messages, before = [], clean = t => t }) {
    const line = m => `[${m.n}｜${m.when || '时间不明'}${m.where ? `｜${m.where}` : ''}｜${m.name}] ${String(clean(m.text)).replace(/\s+\n/g, '\n').trim().slice(0, 1800)}`;
    return [
        ...(before.length ? ['【前情】（不写进摘要）', ...before.map(line), ''] : []),
        `【要整理的】（消息号 ${messages[0].n}～${messages.at(-1).n}）`, ...messages.map(line),
    ].join('\n');
}

// 模型给的场 → 程序核过的：首尾照要整理的那段接齐、前后相接不重叠；空的、没经过的丢掉。
export function parseEpisodes(text, { from, to }) {
    const m = String(text ?? '').match(/\{[\s\S]*\}/);
    let raw = null;
    try { raw = m ? JSON.parse(m[0]) : null; } catch { raw = null; }
    const list = Array.isArray(raw?.['场']) ? raw['场'] : null;
    if (!list) return null;
    const out = [];
    let next = from;
    for (const x of list) {
        const a = Number(x?.['从']), b = Number(x?.['到']);
        const story = typeof x?.['经过'] === 'string' ? x['经过'].trim() : '';
        if (!Number.isInteger(b) || !story || next > to) continue;
        const end = Math.min(to, Math.max(next, b));
        if (Number.isInteger(a) && a > end) continue;
        out.push({
            from: next, to: end, story: story.slice(0, 600),
            place: typeof x?.['在哪'] === 'string' ? x['在哪'].trim().slice(0, 40) : '',
            present: (Array.isArray(x?.['在场']) ? x['在场'] : []).filter(p => typeof p === 'string' && p.trim()).map(p => p.trim().slice(0, 40)).slice(0, 12),
            open: x?.['未完'] === true,
        });
        next = end + 1;
    }
    if (out.length && out.at(-1).to < to) out.at(-1).to = to;   // 模型漏了尾巴：并进最后一场
    return out;
}

// 这几条消息（按指纹）是不是还是写摘要时那几条：删了、改了、换了哪条就对不上。
export const spanOf = fps => createHash('sha256').update(fps.join('|')).digest('hex').slice(0, 24);

// 存着的场 → 这个窗口此刻还算数的（那几条消息一条没变），按先后、不重叠（同一段有几份的取后写的、用户改过的优先）。
export function liveEpisodes(rows, fps) {
    const ok = rows.filter(r => r.to_pos < fps.length && r.from_pos >= 0 && spanOf(fps.slice(r.from_pos, r.to_pos + 1)) === r.span)
        .sort((a, b) => a.from_pos - b.from_pos || b.edited - a.edited || b.id - a.id);
    const out = [];
    for (const r of ok) if (!out.length || r.from_pos > out.at(-1).to_pos) out.push(r);
    return out;
}

// 从头起连着写好了摘要的到哪一条（中间有一段作废了，就从那里重写）。
export function coveredUpTo(live) {
    let next = 0;
    for (const r of live) { if (r.from_pos > next) break; next = Math.max(next, r.to_pos + 1); }
    return next;
}

// ---------- 按时间问 ----------

const NUM = { 一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
const num = s => (/^\d+$/.test(s) ? Number(s) : NUM[s] ?? null);
const EVENING = ['傍晚', '晚上', '深夜', '凌晨'], MORNING = ['早上', '上午'], AFTERNOON = ['中午', '下午'];
const PART_OF = w => (/晚|夜/.test(w) ? EVENING : /早|上午/.test(w) ? MORNING : /午/.test(w) ? AFTERNOON : null);

// 这句话问的是哪几天、一天里的什么时候：[{ back: 往前几天, parts: 时段 | null }]。没问时间返回 []。
// "那天""上次""之前"不算（不知道是哪天，交给按事挑）。
// timeScale：按年、按月走的局（章程 G2）问的是"去年""上个月""三年前"，时段是开局单写的那几段。
export function timeAsked(text, timeScale = DAY) {
    const t = String(text ?? '');
    const out = [];
    const add = (back, parts = null) => { if (back >= 0 && back <= 60 && !out.some(x => x.back === back && x.parts === parts)) out.push({ back, parts }); };
    const ts = scaleOf(timeScale);
    if (ts.unit !== '天') return unitAsked(t, ts, add, out);
    for (const m of t.matchAll(/(大前天|前天|昨天|昨日|昨|今天|今日|今)(早上|早晨|一早|上午|中午|下午|傍晚|晚上|夜里|半夜|深夜|晚|夜|早)?/g)) {
        const back = m[1] === '大前天' ? 3 : m[1] === '前天' ? 2 : /^昨/.test(m[1]) ? 1 : 0;
        if (m[1] === '昨' && !m[2]) continue;      // 单个"昨"字不算
        if (/^今/.test(m[1]) && !m[2]) continue;   // "今天"太宽（多半在说眼下），要带时段才算
        add(back, m[2] ? PART_OF(m[2]) : null);
    }
    for (const m of t.matchAll(/(\d{1,2}|[一两二三四五六七八九十])\s*天(以)?前/g)) { const n = num(m[1]); if (n) add(n); }
    if (/这几天|这些天|这两天|这阵子/.test(t)) for (const b of [0, 1, 2]) add(b);
    return out;
}

const UNIT_ASK = {
    年: { back: [[/大前年/, 3], [/前年/, 2], [/去年|上一年/, 1], [/今年/, 0]], n: '年', some: /这几年|这些年|这两年|近几年/ },
    月: { back: [[/上上个?月/, 2], [/上个?月/, 1], [/这个?月|本月/, 0]], n: '个?月', some: /这几个?月|这两个?月|近几个?月/ },
    小时: { back: [], n: '个?(?:小时|钟头)', some: /这几个?(?:小时|钟头)/ },
};
function unitAsked(t, ts, add, out) {
    const u = UNIT_ASK[ts.unit];
    const partIn = s => { const p = ts.parts.find(x => s.includes(x)); return p ? [p] : null; };
    for (const [re, back] of u.back) {
        const m = re.exec(t);
        if (!m) continue;
        const parts = partIn(t.slice(m.index + m[0].length, m.index + m[0].length + 4));
        if (back === 0 && !parts) continue;   // "今年"太宽（多半在说眼下），要带时段才算
        add(back, parts);
        break;
    }
    for (const m of t.matchAll(new RegExp(`(\\d{1,2}|[一两二三四五六七八九十])\\s*${u.n}(以)?前`, 'g'))) { const n = num(m[1]); if (n) add(n); }
    if (u.some.test(t)) for (const b of [0, 1, 2]) add(b);
    return out;
}

// 这句话在问以前的事（N-284 第二步：问到了，想起的旧事给多些、组装写全；平常聊天照旧少给）：问了时间，或者"还记得""那次""后来呢""怎么回事"一类。
const PAST_ASK = /你不是说|你说过|第一次.{0,15}(的时候|那回|那次)|(之前|以前|当初)[^，,。！？!?]{0,15}的时候|那会儿|还记得|记不记得|记得吗|记得不|你忘了|忘了吗|那次|那回|上次|上回|那天|那晚|那时候|当时|之前说|以前说|说过的|答应过|后来呢|后来怎么|后来那|怎么回事|发生了什么|干了什么|做了什么|都干了|都做了|去哪了|是怎么.{0,8}的[？?]/;
export const asksPast = (text, timeScale = DAY) => timeAsked(text, timeScale).length > 0 || PAST_ASK.test(String(text ?? ''));

// 给开口的人的那几场：问了时间的按剧情日取；落着召回挑中的旧账的那几场也给（按事问）。
// episodes：liveEpisodes 的结果；dayOf(pos)、partAt(pos)：剧情日和时段；today：今天；knows(scene)：他在不在场；
// hitPos：召回挑中的旧账在哪几条（最相关的在前）；recentFrom：这条以后的前台自己看得见（按事问时不重复给）。
export const EPISODE_CHARS = 2400;
export function episodeLines(episodes, { name, text, dayOf, partAt = () => null, today, knows, hitPos = [], recentFrom = Infinity, when = d => `${d} 天前`, cap = EPISODE_CHARS, count = 2, timeScale = DAY }) {
    const mine = episodes.filter(knows);
    if (!mine.length) return [];
    const asked = timeAsked(text, timeScale);
    const dayIn = e => { const a = dayOf(e.from_pos), b = dayOf(e.to_pos); return d => d >= a && d <= b; };
    const partIn = (e, parts) => !parts || [partAt(e.from_pos), partAt(e.to_pos)].some(p => !p || parts.includes(p));
    const byTime = asked.length ? mine.filter(e => asked.some(q => dayIn(e)(today - q.back) && partIn(e, q.parts))) : [];
    // 按事挑的：落着最相关那几条的两场（hitPos 最相关的在前）；以前取最近两场，一句里说了几件事时，最近那件的两场把要紧的那场挤掉（试玩 10/5）
    const rankOf = e => hitPos.findIndex(p => p >= e.from_pos && p <= e.to_pos);
    const byHit = mine.filter(e => e.to_pos < recentFrom && rankOf(e) >= 0 && !byTime.includes(e)).sort((a, b) => rankOf(a) - rankOf(b)).slice(0, count);
    const picked = [...byTime, ...byHit].sort((a, b) => a.from_pos - b.from_pos);
    if (!picked.length) return [];
    const head = `【场记】${name}记得的那几场经过（只供查：问起、用得上时照这个说，先后、数目、名字以这里为准；这里和上文里都没有的细节，${name}记不清就说记不清，别编）：`;
    const rows = picked.map(e => {
        const d = dayOf(e.from_pos), p = partAt(e.from_pos);
        return `· ${when(today - d)}${p ? p : ''}${e.place ? `，${e.place}` : ''}：${e.text}`;
    });
    // 超了就先丢按事挑来的、再丢最早的（问的那天整段留着）
    let lines = rows;
    const size = ls => ls.reduce((s, l) => s + l.length + 1, head.length);
    while (lines.length > 1 && size(lines) > cap) {
        const i = picked.findIndex((e, k) => lines.includes(rows[k]) && !byTime.includes(e));
        lines = lines.filter(l => l !== rows[i >= 0 ? i : picked.findIndex((_, k) => lines.includes(rows[k]))]);
    }
    return [head, ...lines];
}
