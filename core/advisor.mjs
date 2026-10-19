// 参谋（白皮书 §5.7 第四行、J-37、O-25；D-70）：规划者碰到原作／世界层面的问题——某个势力会怎么动、一条情报怎么流转、
// 一件事要成需要哪些人、有哪些用得上的边角人物——就问它，拿回几行备忘。备忘是候选，⛔ 不是事实，也不直接进前台。
// 非扮演口吻；两步走（用户说"先让它推再让它补，否则它就编"）：先只推"需要什么"（不写专名），再开卷往空位里填确实知道的，记不起就留空。
// 开卷资料＝配置里指定的素材目录（题材数据只在那里），程序按问题挑相关的几段递过去；写出的专名过对照表，对不上的标"待核"。
import fs from 'node:fs';
import path from 'node:path';
import { checkYears, yearFlagText } from './years.mjs';

// 素材目录里不拿来读的：说明、核对过程、证据清单、导入校验、目录索引、被弃用的、价表和对照表本身（另有用处）。
const SKIP = /README|核对|证据|校验|来源|回报|弃用|gitkeep|查实题|总目录|索引|物价|专名对照/;
const CHUNK = 3000;

// ---------- 读素材 ----------

function splitLong(title, text) {
    if (text.length <= CHUNK) return [{ title, text }];
    const out = [];
    let buf = '';
    for (const para of text.split(/\n(?=\S)/)) {
        if (buf && buf.length + para.length > CHUNK) { out.push({ title, text: buf }); buf = ''; }
        buf += (buf ? '\n' : '') + para;
    }
    if (buf) out.push({ title, text: buf });
    return out;
}

// Markdown：长的按小标题（## 或【】）切开，每段带上文件的大标题。
function mdChunks(text, name) {
    const head = text.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? name;
    if (text.length <= CHUNK) return [{ title: head, text }];
    // 只列链接的"出处"小节不递（出处看文件名就够）。
    const parts = text.split(/\n(?=##\s|【)/).filter(p => !/^(?:##\s+|【)(?:出处|来源)/.test(p));
    return parts.flatMap(p => splitLong(`${head}｜${p.match(/^(?:##\s+|【)([^\n】]+)/)?.[1]?.trim() ?? ''}`, p.trim())).filter(c => c.text);
}

export function parseCsv(text) {
    const rows = [];
    let row = [], cell = '', quoted = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (quoted) {
            if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
            else if (c === '"') quoted = false;
            else cell += c;
        } else if (c === '"') quoted = true;
        else if (c === ',') { row.push(cell); cell = ''; }
        else if (c === '\n' || c === '\r') {
            if (c === '\r' && text[i + 1] === '\n') i++;
            row.push(cell); cell = '';
            if (row.some(x => x !== '')) rows.push(row);
            row = [];
        } else cell += c;
    }
    row.push(cell);
    if (row.some(x => x !== '')) rows.push(row);
    return rows;
}

// 表格：去掉链接那几列（出处看文件名就够），每 30 行一段，段首带表头。
function csvChunks(text, name) {
    const [header, ...rows] = parseCsv(text.replace(/^﻿/, ''));
    if (!header) return [];
    const keep = header.map((_, i) => !rows.slice(0, 20).some(r => /^https?:\/\//.test(r[i] ?? '')));
    const line = r => r.filter((_, i) => keep[i]).map(x => x.trim()).join(' | ');
    const out = [];
    for (let i = 0; i < rows.length; i += 30) out.push({ title: name, text: [line(header), ...rows.slice(i, i + 30).map(line)].join('\n') });
    return out;
}

// 关系图（nodes＋edges）：一条边一行，"甲 → 乙：关系，说明（时期）"。
function graphChunks(data, name) {
    if (!Array.isArray(data?.nodes) || !Array.isArray(data?.edges)) return [];
    const nameOf = new Map(data.nodes.map(n => [n.id, n.en && n.en !== n.name ? `${n.name}（${n.en}）` : n.name]));
    const lines = data.edges.map(e => `${nameOf.get(e.from) ?? e.from} → ${nameOf.get(e.to) ?? e.to}：${e.type ?? ''}${e.note ? `，${e.note}` : ''}${e.period ? `（${e.period}）` : ''}${e.playerDependent ? '（看玩家当年的选择）' : ''}`);
    const out = [];
    for (let i = 0; i < lines.length; i += 25) out.push({ title: data.meta?.title ?? name, text: lines.slice(i, i + 25).join('\n') });
    return out;
}

// 把素材目录读成一段一段（每段带出处＝相对路径）。
export function loadLibrary(dir) {
    const chunks = [];
    const walk = sub => {
        for (const entry of fs.readdirSync(path.join(dir, sub), { withFileTypes: true })) {
            const rel = sub ? `${sub}/${entry.name}` : entry.name;
            if (entry.name.startsWith('.') || SKIP.test(entry.name)) continue;
            if (entry.isDirectory()) { walk(rel); continue; }
            const text = fs.readFileSync(path.join(dir, rel), 'utf8');
            const name = entry.name.replace(/\.[^.]+$/, '');
            let parts = [];
            if (/\.(md|markdown)$/i.test(entry.name)) parts = mdChunks(text, name);
            else if (/\.txt$/i.test(entry.name)) parts = splitLong(name, text);
            else if (/\.csv$/i.test(entry.name)) parts = csvChunks(text, name);
            else if (/\.json$/i.test(entry.name)) { try { parts = graphChunks(JSON.parse(text), name); } catch {} }
            for (const p of parts) chunks.push({ id: chunks.length, source: rel, ...p });
        }
    };
    walk('');
    return chunks;
}

// ---------- 挑相关的几段 ----------

// 中文按两字组、三字组，外文按词；太普遍的（一成以上的段落都有）不计分。
function terms(text) {
    const s = String(text);
    const out = new Set();
    const cjk = s.replace(/[^㐀-鿿]+/g, '|');
    for (const run of cjk.split('|')) {
        for (let i = 0; i + 2 <= run.length; i++) out.add(run.slice(i, i + 2));
        for (let i = 0; i + 3 <= run.length; i++) out.add(run.slice(i, i + 3));
    }
    for (const w of s.toLowerCase().match(/[a-z][a-z0-9'-]{2,}/g) ?? []) out.add(w);
    return out;
}

export function pickChunks(chunks, query, { budget = 40000 } = {}) {
    const q = terms(query);
    if (!q.size || !chunks.length) return [];
    const docs = chunks.map(c => ({ c, t: terms(`${c.title}\n${c.text}`) }));
    const df = new Map();
    for (const { t } of docs) for (const x of t) if (q.has(x)) df.set(x, (df.get(x) ?? 0) + 1);
    const n = docs.length, cap = Math.max(3, n * 0.1);
    const ranked = docs.map(({ c, t }) => {
        let score = 0;
        for (const x of t) if (q.has(x) && df.get(x) <= cap) score += Math.log(1 + n / df.get(x));
        return { c, score: score / Math.sqrt(1 + c.text.length / CHUNK) };
    }).filter(x => x.score > 0).sort((a, b) => b.score - a.score);
    const out = [];
    let used = 0;
    for (const { c } of ranked) {
        if (used + c.text.length > budget) continue;
        out.push(c);
        used += c.text.length;
    }
    return out;
}

// ---------- 专名核对 ----------

// 对照表（CSV，前两列＝外文名、官方中文名，另有一列"是否官方"：是／否／待核）。
export function loadNameTable(file) {
    const [header, ...rows] = parseCsv(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
    const col = re => header.findIndex(h => re.test(h));
    const off = col(/是否官方|官方与否/);
    return rows.map(r => ({ en: (r[0] ?? '').trim(), zh: (r[1] ?? '').trim(), official: off >= 0 ? (r[off] ?? '').trim() : '' })).filter(r => r.en);
}

// 备忘里的专名，只报两种（错译会被下游原样沿用，调研 25 §二）：
// ① 外文名对照表里没有 ⇒ 待核；② 音译名前半对得上、后半走了样（"甲乙·丙丁"写成"甲乙·丙戊"）⇒ 给出表里的写法。
// 表里标"待核"的译名用到了也提一句。非官方但表里就这么写的，不报。
export function checkNames(text, table, { corpus = null } = {}) {
    if (!table?.length) return [];
    const s = String(text);
    const flags = [];
    const known = table.map(r => r.en.toLowerCase());
    const seen = new Set();
    for (const m of s.match(/[A-Z][A-Za-z'.]*[a-z][A-Za-z'.]*(?: [A-Z][A-Za-z'.]*[a-z][A-Za-z'.]*)*/g) ?? []) {
        const word = m.trim().replace(/\.$/, '');
        if (word.length < 3 || seen.has(word)) continue;
        seen.add(word);
        const w = word.toLowerCase();
        if (!known.some(k => k === w || k.includes(w) || (k.length >= 4 && w.includes(k)))) flags.push(`「${word}」不在专名对照表里，待核`);
    }
    const zh = table.filter(r => r.zh);
    for (const r of zh) {
        const [first, second] = r.zh.split('·');
        if (!second || first.length < 2) continue;
        const re = new RegExp(`${first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}·[\\u3400-\\u9fff]{${second.length}}`, 'g');
        for (const hit of s.match(re) ?? []) {
            if (seen.has(hit) || zh.some(x => x.zh.startsWith(hit))) continue;
            seen.add(hit);
            flags.push(`「${hit}」对照表里写作「${r.zh}」（${r.en}）`);
        }
    }
    for (const r of zh) if (r.official === '待核' && r.zh.length >= 2 && s.includes(r.zh)) flags.push(`「${r.zh}」（${r.en}）这个译名还待核`);
    // ③ 带"·"的音译名，对照表里没有、素材里也从没这么写过 ⇒ 多半是它自己音译的
    if (corpus) {
        const known = x => zh.some(r => r.zh === x) || corpus.includes(x);
        for (const raw of s.match(/[㐀-鿿]{1,8}·[㐀-鿿]{1,8}/g) ?? []) {
            // 中文不分词：先剥掉粘在名字两头的连接词，再看任一种截法在表里或素材里有没有
            const [l, r] = raw.split('·').map((x, i) => i ? x.replace(TAIL, '') : x.replace(HEAD, ''));
            if (!l || !r) continue;
            const hit = `${l}·${r}`;
            if (seen.has(hit)) continue;
            let ok = false;
            for (let i = 0; i <= l.length - 1 && !ok; i++) for (let j = r.length; j >= 1 && !ok; j--) ok = known(`${l.slice(i)}·${r.slice(0, j)}`);
            seen.add(hit);
            if (!ok) flags.push(`「${hit}」对照表和素材里都没有这个写法，可能是自己音译的，待核`);
        }
    }
    return flags;
}
const HEAD = /^(?:(?:或者|还有|以及|或是|比如|例如|包括|其中|找|跟|和|与|及|或|是|在|对|给|让|把|被|由|向|从|若|如|像|派|叫|请|问|等)+)/;
const TAIL = /(?:(?:的人|他们|她们|一起|也会|会来|这些|那些|的|和|与|及|等|是|在|也|会|来|了|说|带|去|们|作|当|为)+)$/;

// 名册写法优先：对照表里的音译和用户名册里同一个人的写法字一样、顺序不同（"甲乙·丙丁"和"丙丁·甲乙"那种），换成名册的写法。
export function preferRoster(texts, table, roster = []) {
    const sorted = s => [...String(s)].filter(c => c !== '·').sort().join('');
    const swaps = [];
    for (const r of roster.filter(n => n.includes('·'))) {
        for (const row of table) if (row.zh && row.zh !== r && row.zh.includes('·') && sorted(row.zh) === sorted(r)) swaps.push([row.zh, r]);
    }
    const out = texts.map(t => swaps.reduce((acc, [from, to]) => acc.split(from).join(to), t));
    const notes = swaps.filter(([from]) => texts.some(t => t.includes(from))).map(([from, to]) => `「${from}」按名册写成了「${to}」`);
    return [...out, notes];
}

// ---------- 两步问 ----------

export const NEEDS_SYSTEM = [
    '你是一部长篇角色扮演的幕后参谋，不扮演任何人，也不写剧情。规划者会问你原作／世界层面的问题：某个势力会怎么动、一条情报怎么流转、',
    '一件事要成需要哪些人、有哪些用得上的边角人物。',
    '这一步只推"需要什么"：这件事要成立，需要哪些位置上的人或势力、什么样的情报或资源、会卡在哪几个环节、谁会反对。',
    '⛔ 这一步除了问题里已经出现的名字，不写任何专有名词（人名、帮派、公司、地名、产品名），只写位置和条件。一行一个空位，几行到十几行。',
].join('\n');

export const FILL_SYSTEM = [
    '你是一部长篇角色扮演的幕后参谋，不扮演任何人，也不写剧情。下面有你上一步推出的空位，和一叠开卷资料（原作资料的整理，每段标了出处）。',
    '往空位里填你确实知道的：',
    '- 资料里有的，优先用资料，行末注明【出处：文件名】；',
    '- 资料里没有、你自己记得的，行末标【凭记忆】；',
    '- 记不起、或者原作里没有合适的，就写"空"，别编。',
    '推演不是你的活，是规划者的：空位里只填有出处的和你确实记得的，别用"可能""推测"去补。',
    '原作里已经有定局的照定局；原作没收尾、或者取决于玩家当年怎么选的，最后另起"这一局可以怎么定"，至多三条，每条说依据。问题里给的本局前提优先于原作。',
    '每个空位一两行，整份不超过四十行。这是写给规划者看的备忘，是候选、不是事实：⛔ 不写剧情段落、不写台词、不替玩家定任何事。',
].join('\n');

export function fillPrompt({ question, context, needs, chunks }) {
    return [
        `【问题】${question}`,
        ...(context ? [`【本局前提】${context}`] : []),
        '', '【你上一步推出的空位】', needs.trim(),
        '', '【开卷资料】',
        ...(chunks.length ? chunks.map(c => `—— ${c.source}｜${c.title}\n${c.text}`) : ['（这回没找到相关的资料，只能凭记忆；记不起就写"空"）']),
    ].join('\n');
}

// getConfig().advisor：{ enabled, baseUrl, apiKey, model, priceInPerM, priceOutPerM, library, nameTable, budgetChars, … }
// clientFor(section) → { complete({ system, user }) }；测试时换成假的。
// packFor(chatKey)：这一局的素材包（资料目录、专名表、年表）；没选包就没有开卷资料（D-104）。
// ownFor(chatKey)：这一局用户自己传的参考资料的目录（materials.mjs；没有就是 null），和素材包一起翻。
export function createAdvisor({ getConfig, records = null, log = () => {}, clientFor, repo = process.cwd(), packFor = null, ownFor = null }) {
    let cache = { key: null, chunks: [], table: [], corpus: '' };
    const materials = (a, own = null) => {
        const dir = a.library ? path.resolve(repo, a.library) : null;
        const tableFile = a.nameTable ? path.resolve(repo, a.nameTable) : null;
        const ownKey = own && fs.existsSync(own) ? `${own}@${fs.readdirSync(own).map(f => `${f}:${fs.statSync(path.join(own, f)).mtimeMs}`).join(',')}` : '';
        const key = `${dir}|${tableFile}|${ownKey}`;
        if (key !== cache.key) {
            cache = {
                key,
                chunks: [...(dir && fs.existsSync(dir) ? loadLibrary(dir) : []), ...(ownKey ? loadLibrary(own).map(c => ({ ...c, source: `本局素材/${c.source}` })) : [])].map((c, id) => ({ ...c, id })),
                table: tableFile && fs.existsSync(tableFile) ? loadNameTable(tableFile) : [],
            };
            cache.corpus = cache.chunks.map(c => c.text).join('\n');
        }
        return cache;
    };
    return {
        ready() { const a = getConfig().advisor; return !!(a?.enabled && a.baseUrl && a.apiKey && a.model); },
        async ask({ question, context = '', chatKey = null, roster = [], year = null }) {
            const config = getConfig();
            const pack = packFor ? packFor(chatKey) : null;
            const a = packFor ? { ...config.advisor, library: pack?.dir ?? null, nameTable: pack?.nameTable ?? null } : config.advisor;
            if (!a?.enabled || !a.model) throw Object.assign(new Error('advisor_off'), { status: 409 });
            const budget = config.extractor?.dailyBudgetUsd ?? 3;
            if (records?.spentToday && records.spentToday() >= budget) throw Object.assign(new Error('budget_reached'), { status: 429 });
            const client = clientFor({ ...a, stream: true });   // 长回答走流式（中转对长的非流式回答会卡住，D-95）
            const { chunks: library, table, corpus } = materials(a, ownFor ? ownFor(chatKey) : null);
            const cost = u => ((u?.input ?? 0) * a.priceInPerM + (u?.output ?? 0) * a.priceOutPerM) / 1e6;
            const call = async (step, system, user) => {
                const started = Date.now();
                try {
                    const r = await client.complete({ system, user });
                    if (r.finishReason === 'length') throw new Error('advisor_truncated');
                    records?.logAssemble?.({ chatKey: chatKey ?? '-', speaker: `(参谋·${step})`, model: a.model, servedModel: r.servedModel, status: 'done', usage: r.usage, costUsd: cost(r.usage), ms: Date.now() - started, raw: r.text });
                    return r;
                } catch (error) {
                    records?.logAssemble?.({ chatKey: chatKey ?? '-', speaker: `(参谋·${step})`, model: a.model, status: 'failed', ms: Date.now() - started, error: error.message });
                    log(`advisor ${step} failed: ${error.message}`);
                    throw error;
                }
            };
            const head = [`【问题】${question}`, ...(context ? [`【本局前提】${context}`] : [])].join('\n');
            const one = await call('推', NEEDS_SYSTEM, head);
            const chunks = pickChunks(library, `${question}\n${context}\n${one.text}`, { budget: a.budgetChars });
            const two = await call('补', FILL_SYSTEM, fillPrompt({ question, context, needs: one.text, chunks }));
            const [needs, memo, renamed] = preferRoster([one.text.trim(), two.text.trim()], table, roster);
            return {
                needs, memo,
                sources: [...new Set(chunks.map(c => c.source))],
                flags: [...renamed, ...checkNames(`${needs}\n${memo}`, table, { corpus }), ...checkYears(memo, pack?.anchors ?? [], { storyYear: year }).map(yearFlagText)],
                costUsd: cost(one.usage) + cost(two.usage),
            };
        },
    };
}
