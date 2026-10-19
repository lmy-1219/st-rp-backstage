// 补认约定（N-268）：约定那一格是 10/1 才有的；之前记下的"打算""答应""约好"没有它，到了日子也不会给当事人、不会让路、不会了结。
// 一局只跑一次（或者用户要时）：把还开着的那几条和从最早那条起的原文交给记账那档模型，补认两件事——算不算约定（类、谁办、跟谁、约在），
// 后面的原文里有没有了结（办了、不办了、改了、没办成）。程序照记账那套核：编号得在单子上、了结的引文得逐字出自那条消息。
// 先给预览（几条、多少字、大概多少钱），用户点头才调模型。
import { KINDS, OUTCOMES } from './promises.mjs';

export const RECHECK_SYSTEM = [
    '下面是一部长篇角色扮演里早先记下的几条"打算""答应""约好"（编号、谁说的、内容、出自第几条消息），和从最早那条起的聊天原文（消息号、说话人、正文）。给每一条补认两件事：',
    '一、它算不算约定：有人许下、或者两人说定了一件往后要办的事——说话人自己要办的、"我们""咱们"一起办的、别人开口要他办而他没推掉的。',
    '  算的给 {"类": "眼前|定了日子|有条件|畅想", "谁办": ["名字"], "跟谁": ["名字"], "约在": "照原文抄说到时候的那几个字"}：眼前＝这会儿、等会儿就办；定了日子＝说了哪天、几点、下周这类；有条件＝等某件事成了再办；畅想＝没准日子也没准条件的往后。',
    '  "谁办"写真正去办那件事的人：说的是第三个人会对谁做什么（"明天医生准得给你打针"），哪怕说话的两人到时候也在场，也是预判，不算。',
    '  预判别人会怎样、吓唬人、开玩笑、随口冒的念头、劝别人去做的事、只是交代情况的，都不算，给 null。只是约好几点接人、在哪碰头的，碰头本身算了结，碰头以后要去办的那件事另外看。',
    '二、后面的原文里它有没有了结：办了（结果"做了"）、明说不办了（"不做了"）、改了日子或做法（"改了"）、去办了没成或者到时候错过了（"没办成"）。',
    '  "做了"只算那件事本身办完了：出发了、在路上、来接人了、准备去、说起要去，都还不算——比如约好去某处做检查，人来接了还没到、还没做，就是还没了结，给 null。',
    '  有就给 {"消息号": 数字, "结果": "...", "内容": "一句，以人名开头", "引": "那条消息里逐字的一小段，不超过 30 字"}；没有、还没到时候、拿不准，给 null。',
    '只按原文判断，不猜，不用原作或外部知识补。只输出一个 JSON 数组：[{"编号": 数字, "约定": {...} 或 null, "了结": {...} 或 null}]',
].join('\n');

// 要补认的：看得见的"说""想法"里没有约定那一格、标了待办或者说的是将来的、还没被了结的；最近 200 条以内。
export function recheckCandidates(visible, { lastPos = 0, window = 200 } = {}) {
    const closed = new Set(visible.filter(r => r.type === '了结').map(r => r.idea_ref));
    return visible.filter(r => ['说', '想法'].includes(r.type) && !r.promise && (r.todo || r.tense === '将来') && !closed.has(r.id) && lastPos - r.pos <= window);
}

export function recheckPrompt({ candidates, messages, clean = t => t, perMessage = 500 }) {
    const from = Math.min(...candidates.map(r => r.pos));
    const text = messages.filter(m => m.pos >= from).map(m => `[消息 ${m.pos}] ${m.name ?? m.speaker}：${clean(m.text).replace(/\s+/g, ' ').trim().slice(0, perMessage)}`);
    return ['【早先记下的】', ...candidates.map(r => `#${r.id} ${r.holder_name ?? r.holder}（第 ${r.pos} 条；当时在场：${(r.audience ?? []).join('、') || '不明'}）：${r.text}`), '', '【原文】', ...text].join('\n');
}

const squash = t => String(t ?? '').replace(/\s+/g, '').replace(/[“”"„‟＂]/g, '"').replace(/[‘’'＇]/g, "'");
const names = v => (Array.isArray(v) ? v : typeof v === 'string' ? [v] : []).filter(x => typeof x === 'string' && x.trim()).map(x => x.trim().slice(0, 40)).slice(0, 4);
const WE = /我们|咱们|大家|一起/;

// 模型交回的 → { promises: [{id, promise}], closes: [{id, pos, outcome, text, quote}], dropped }
export function parseRecheck(text, { candidates, messages, clean = t => t }) {
    const body = /\[[\s\S]*\]/.exec(String(text ?? ''))?.[0];
    let raw = null;
    try { raw = JSON.parse(body); } catch { return { promises: [], closes: [], dropped: [{ reason: 'not_json' }] }; }
    const byId = new Map(candidates.map(r => [r.id, r]));
    const byPos = new Map(messages.map(m => [m.pos, m]));
    const promises = [], closes = [], dropped = [];
    for (const x of Array.isArray(raw) ? raw : []) {
        const r = byId.get(Number(x?.['编号']));
        if (!r) { dropped.push({ item: x, reason: `编号不在单子上：${x?.['编号']}` }); continue; }
        const p = x['约定'];
        if (p && typeof p === 'object') {
            const doers = names(p['谁办']), here = [r.holder_name, r.holder, ...(r.audience ?? [])].filter(Boolean);
            const ours = !doers.length || doers.some(d => WE.test(d) || here.some(h => h === d || h.includes(d) || d.includes(h)));
            if (!KINDS.includes(p['类'])) dropped.push({ item: x, reason: `约定的类不认识：${p['类']}` });
            else if (!ours) dropped.push({ item: x, reason: '办的人里没有说话人和在场的人（是预判，不是约定）' });
            else promises.push({ id: r.id, promise: { kind: p['类'], doers: doers.filter(d => !WE.test(d)), with: names(p['跟谁']), when: typeof p['约在'] === 'string' ? p['约在'].trim().slice(0, 40) : '' } });
        }
        const c = x['了结'];
        if (c && typeof c === 'object') {
            const m = byPos.get(Number(c['消息号'])), quote = typeof c['引'] === 'string' ? c['引'].trim().slice(0, 30) : '', what = typeof c['内容'] === 'string' ? c['内容'].trim().slice(0, 200) : '';
            if (r.type === '说' && !r.promise && !promises.some(q => q.id === r.id)) { dropped.push({ item: x, reason: '不是约定的"说"不用了结' }); continue; }
            if (!m || m.pos <= r.pos) { dropped.push({ item: x, reason: `了结的消息号不对：${c['消息号']}` }); continue; }
            if (!OUTCOMES.includes(c['结果'])) { dropped.push({ item: x, reason: `了结的结果不认识：${c['结果']}` }); continue; }
            if (!what) { dropped.push({ item: x, reason: '了结没写内容' }); continue; }
            if (quote.length < 2 || !squash(clean(m.text)).includes(squash(quote))) { dropped.push({ item: x, reason: `了结的引文在那条消息里找不到：${quote}` }); continue; }
            closes.push({ id: r.id, pos: m.pos, fp: m.fp, speaker: m.speaker, name: m.name, outcome: c['结果'], text: what, quote, audience: r.audience ?? [] });
        }
    }
    return { promises, closes, dropped };
}

// 跨天收尾的另一半（用户 10/7："后台一直挂着她受伤的状态的话，会形成棘轮"）：规矩、要求、打算、记着的状况，
// 有不少只是因为一时的状况才有的——人病着时立的"半夜难受了叫我"、伤着时记的"屏障薄得像纸"、为那一晚提的要求。
// 那个状况过去了，没人会特意说一句"那条不算了"，它们就一直递给前台，前台照着又说一遍，记账再记一遍。
// 新的一天把这些交给记账那档看一眼：还成立吗？不成立的记一笔、把那条换下（改掉），所有读的地方都不再拿它。
export const STALE_PART = [
    '【还算不算数】里是早先记下、到现在还一直在算数的规矩、要求、打算和状况。逐条看后面的原文，它现在还成立吗：',
    '  不再成立的给 {"消息号": 数字, "内容": "一句，以人名开头，说清是什么让它不再算数", "引": "那条消息里逐字的一小段，不超过 30 字"}——原文里有一处表明它已经过去了：',
    '  它靠着的那个状况结束了（伤病好了、药劲过了、修好了、找到了、人走了、那件事办完了）；它只管那一时（今晚、半夜、天亮前、等会儿、打那通电话时），那个时候已经过了；说的人自己改口了。"消息号"写表明这一点的那条。',
    '  还成立的、拿不准的、原文里看不出来的，给 null。以后一直照着做的规矩（以后都怎样、别再怎样），只有说的人改口、或者对方明说不认了才算不再成立；人好了不等于两个人之间说好的规矩变了。',
].join('\n');

export const CLOSE_SYSTEM = [
    '下面是一部长篇角色扮演里早先记下、还开着的几条（编号、谁说的、内容、出自第几条消息），和那以后的聊天原文（消息号、说话人、正文）。过了一阵子（换了时段，或者新的一天开始了），把它们核一遍。',
    '【还开着的约定】：后面的原文里有没有了结——办了（结果"做了"）、明说不办了（"不做了"）、改了日子或做法（"改了"）、去办了没成或者到时候错过了（"没办成"）。',
    '  "做了"只算那件事本身办完了：出发了、在路上、来接人了、准备去、说起要去，都还不算。',
    '  有就给 {"消息号": 数字, "结果": "...", "内容": "一句，以人名开头", "引": "那条消息里逐字的一小段，不超过 30 字"}；没有、还没到时候、拿不准，给 null。',
    STALE_PART,
    '只按原文判断，不猜，不用原作或外部知识补。只输出一个 JSON 数组：约定那几条写 {"编号": 数字, "了结": {...} 或 null}，还算不算数那几条写 {"编号": 数字, "不再算数": {...} 或 null}。',
].join('\n');

// 还算不算数的候选：看得见的规矩、没关的要求和打算（不是约定的）、一直算数的和这几天还没过去的改变；新的一天之前记下的，至多 max 条（新的在前）
const LINGERING = ['几天', '几周', '直到被改变', '永久'];
export function staleCandidates(visible, { before, lastPos = 0, window = 200, max = 30 } = {}) {
    // 规矩、状况被人回答过照样算数；打算、要求被了结、回答了就关了
    return visible.filter(r => r.pos < before && !r.superseded_by && !r.promise && (
        r.standing
        || (r.type === '想法' && !r.closed_by && lastPos - r.pos <= window)
        || (r.todo && !r.closed_by && ['说', '做'].includes(r.type) && lastPos - r.pos <= window)
        || (r.type === '改变' && LINGERING.includes(r.duration))))
        .sort((a, b) => b.pos - a.pos).slice(0, max).sort((a, b) => a.pos - b.pos);
}

const kindOf = r => (r.standing ? '规矩' : r.type === '想法' ? '打算' : r.todo ? '要求' : '状况');
export function closePrompt({ promises = [], stale = [], messages, clean = t => t, perMessage = 400 }) {
    const from = Math.min(...[...promises, ...stale].map(r => r.pos));
    const line = (r, tag = '') => `#${r.id} ${tag}${r.holder_name ?? r.holder}（第 ${r.pos} 条；当时在场：${(r.audience ?? []).join('、') || '不明'}）：${r.text}`;
    const text = messages.filter(m => m.pos >= from).map(m => `[消息 ${m.pos}] ${m.name ?? m.speaker}：${clean(m.text).replace(/\s+/g, ' ').trim().slice(0, perMessage)}`);
    return [
        ...(promises.length ? ['【还开着的约定】', ...promises.map(r => line(r))] : []),
        ...(stale.length ? [promises.length ? '' : null, '【还算不算数】', ...stale.map(r => line(r, `［${kindOf(r)}］`))].filter(x => x != null) : []),
        '', '【原文】', ...text,
    ].join('\n');
}

// 模型交回的"不再算数" → [{id, pos, fp, speaker, name, text, quote, audience}]；引文得逐字出自那条消息、那条得在它之后
export function parseStale(text, { candidates, messages, clean = t => t }) {
    const body = /\[[\s\S]*\]/.exec(String(text ?? ''))?.[0];
    let raw = null;
    try { raw = JSON.parse(body); } catch { return { ends: [], dropped: [{ reason: 'not_json' }] }; }
    const byId = new Map(candidates.map(r => [r.id, r]));
    const byPos = new Map(messages.map(m => [m.pos, m]));
    const ends = [], dropped = [];
    for (const x of Array.isArray(raw) ? raw : []) {
        const r = byId.get(Number(x?.['编号']));
        const e = x?.['不再算数'];
        if (!r || !e || typeof e !== 'object') continue;
        const m = byPos.get(Number(e['消息号'])), quote = typeof e['引'] === 'string' ? e['引'].trim().slice(0, 30) : '', what = typeof e['内容'] === 'string' ? e['内容'].trim().slice(0, 200) : '';
        if (!m || m.pos <= r.pos) { dropped.push({ item: x, reason: `不再算数的消息号不对：${e['消息号']}` }); continue; }
        if (!what) { dropped.push({ item: x, reason: '不再算数没写内容' }); continue; }
        if (quote.length < 2 || !squash(clean(m.text)).includes(squash(quote))) { dropped.push({ item: x, reason: `不再算数的引文在那条消息里找不到：${quote}` }); continue; }
        ends.push({ id: r.id, pos: m.pos, fp: m.fp, speaker: m.speaker, name: m.name, text: what, quote, audience: r.audience ?? [] });
    }
    return { ends, dropped };
}
