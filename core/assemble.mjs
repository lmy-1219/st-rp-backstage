import { renderPronouns } from './pronoun.mjs';
// 叙事组装：发言前，让模型从"这个角色亲身知道的记录"里挑出和眼下有关的，按时间串成一条回忆线。
// 候选由程序按知情范围先过滤（recall.mjs 的 pool），模型看不到他不知道的事；
// 模型每句都要标出依据的记录编号，程序逐句核对：编号不在候选里、没标、引了记录里没有的原话、
// 或者在归纳谁"总是怎样"的句子一律丢掉（白皮书 J-56：组装句必须能回指允许的来源，不扩大知情范围）。
import { renderOpen, finish, lessonOf } from './recall.mjs';
import { createModelClient } from './model.mjs';

export const ASSEMBLER_SYSTEM = [
    "你在帮一位长篇合写小说的作者整理角色的记忆。下一段轮到某个角色开口，作者想知道：此刻〔当事人〕脑子里会浮上来哪些旧事。",
    '你会拿到：眼下刚发生的几句话，和这个角色亲身在场、所以知道的一批旧记录（每条有编号、大约是多久以前、谁说的或做的）。',
    '',
    '从记录里挑出和眼下这件事真正有关的，按时间先后串成一条线，让人看得出事情是怎么一步步走到现在的。',
    '最先找的是：同一种事以前出过几次，每次是什么情形、怎么过去的、前后有没有变轻或变重。其次才是跟它有关的背景（起因、别人说过的话、答应过的事）。一直都在的背景（伤病、身体状况、欠着的钱这类）最多写一句——除非眼下说的就是它；不然每回都提，人物就只会围着它转。',
    '通常三到六句，每句一件事、写短些；和眼下无关的不写。一条都挑不出来，就只回一个字：无。',
    '',
    '写法：',
    '- 每句一件具体的事：什么时候、谁、做了或说了什么、结果怎样。用名字，不用"你""我"。时间照每条前面标的说（"4 天前""昨天"）；记录正文里的"当天""前一天"是相对那条记录那天说的，写的时候换成从现在看的时间。',
    '- 只写过去的事。眼下这一刻正在发生的，大家都看得见，不写。',
    '- 每句末尾用 [编号] 标出依据，几条合成一句就写 [12,15]。只写记录里有的，不补细节，不加形容；记录里没说的先后和程度（"第一次""最重的一回"）也不加。谁做的、谁只是开口要求，照记录分清。',
    '- 别人说的写成"某人说过……"。医嘱、警告、约定也照实写成那天谁说过什么；带着条件、没把握的话（"能……但治不了……""说不准""看情况"），连条件和保留一起写，别写成保证。',
    '- 几件事连起来如果看得出点什么（比如一次比一次轻、某件事之后就变了），可以写一句，写明是这个角色自己的看法。',
    '- 只写发生过的具体事。不概括谁的性格、习惯或"总是怎样"，不评价两人关系，不替任何人分析心思。',
    '- 原话用「」引，一字不改；记不准原话就不引。',
    "- 标着\"最近几轮已经想起过\"的，〔当事人〕刚想过、说过，这次除非眼下说的正是它，不再写。",
    "- 标着\"认过的错\"\"对方受用\"的，是〔当事人〕自己做过的一件事和对方当时的反应。只有眼下又是差不多的情形——同样的分歧、同样的场面，或者〔当事人〕上一段正在那样做——才写进来，照那天的事写（〔当事人〕做了什么、对方怎样、〔当事人〕认没认）；不像就不写，别为了它往上靠。",
    '',
    '第一行先写「眼下：」，用一句话说清眼下这件事是什么（这一行只给你自己理清思路，不会给别人看）；从第二行起写回忆线，每句一行，不加标题、不加说明。',
].join('\n');

// 记录正文里的"今天/昨天"是记下它那天的说法；给模型前换成"当天/前一天"，免得和"从现在看"的时间搅在一起
// （实测：模型把一条"昨天"的记录里的"今天早上"原样抄成了今天）。原话不动。
const DAY_WORDS = [['今天', '当天'], ['今早', '当天早上'], ['今晚', '当晚'], ['昨天', '前一天'], ['昨晚', '前一晚'], ['前天', '两天前'], ['明天', '第二天'], ['明早', '第二天早上']];
export const fromThatDay = text => DAY_WORDS.reduce((t, [a, b]) => t.split(a).join(b), String(text));

// 模型写的一句以"昨天""3 天前"开头，句子里却又冒出"今晚""明天"（照抄了当时的话）：
// 前台会当成今晚（实测：把前天医生说的"今晚最疼"说成了今晚）。引号外的换成"当晚""第二天"，引号里的原话不动。
export function pastDayWords(line) {
    const lead = /^(昨天|前天|约? ?\d+ ?(天|周|个月)前|几天前)/.exec(line)?.[0];
    if (!lead) return line;
    // 模型把"昨天"和记录里的"前一天"叠在一起写成"昨天前一天"：合成一个说法。
    if (/^昨天(前一天|当天)/.test(line)) return pastDayWords(line.replace(/^昨天前一天/, '前天').replace(/^昨天当天/, '昨天'));
    const rest = line.slice(lead.length).split(/(「[^」]*」)/).map(part => part.startsWith('「') ? part : fromThatDay(part)).join('');
    return lead + rest;
}

const RECENT_CLIP = 300;
const QUOTE_CLIP = 30;
const TYPE_LABEL ={ 说: '说', 做: '做', 想法: '想法', 改变: '变化', 了结: '了结' };

export function buildAssemblerPrompt({ name, present = [], recent = [], recentUser = '', material }) {
    const { pool, when } = material;
    const lines = [`轮到开口的角色：${name}`];
    if (present.length) lines.push(`此刻在场：${present.join('、')}`);
    const said = recent.filter(Boolean).map(t => t.trim()).filter(Boolean);
    const user = recentUser.trim();
    if (user && !said.includes(user)) said.push(user);
    // 较早的几段只留结尾（眼下的事多在结尾）；用户那句整段给。
    const clip = t => (t === user || t.length <= RECENT_CLIP ? t : `……${t.slice(-RECENT_CLIP)}`).replace(/\s*\n+\s*/g, ' ');
    lines.push('', '眼下刚发生的（最后一段最新）：', ...said.map(t => `> ${clip(t)}`));
    lines.push('', `${name}亲身知道的旧记录：`);
    for (const r of pool) {
        const q = r.quotes?.[0] ? `（原话：「${r.quotes[0].slice(0, QUOTE_CLIP)}」）` : '';
        const seen = material.stale?.has(r.id) ? '（最近几轮已经想起过）' : '';
        const l = material.lessonIds?.has(r.id) ? lessonOf(r) : null;
        const lesson = l ? `｜${l.kind === '错' ? '认过的错' : `${l.with}受用`}：${fromThatDay(l.did)}${l.effect ? `——${fromThatDay(l.effect)}` : ''}${l.when.length ? `（当时的情形：${l.when.join('、')}）` : ''}` : '';
        lines.push(`[${r.id}] ${when(r)} · ${r.holder_name ?? r.holder} · ${TYPE_LABEL[r.type] ?? r.type}：${fromThatDay(r.text)}${q}${lesson}${seen}`);
    }
    // 玩家这句在问以前的事（N-284 第二步）：问到的那件事前后经过写全
    if (material.more) lines.push('', '（这一次是在问以前的事：把问到的那件事从头到尾按先后写全——起因、经过、谁说了什么、怎么收的，可以写到十句；不相干的照旧不写。）');
    return lines.join('\n');
}

// 归纳行为模式、评价关系的说法：写回给前台会自我强化（角色读到"他总是这样"就继续这样）。
const PATTERN_WORDS = /反复|总是|每次都|一直都|一向|习惯性|屡次|动不动|老是|关系(升温|加深|变得)|感情(升温|加深)/;
// 记录里没说的先后和程度（质量窗，组装的老毛病：实测写出"首次发作"）：依据里没有这个词的，"第一次"一类删掉词留下句子，"最重"一类整句不要。
const FIRST_WORDS = /第一次|首次|头一回|头一次|初次/g;
const MOST_WORDS = /最重|最严重|最厉害|最狠|最凶|最惨/;
// 记住的一回里写的（错在哪、对方怎样，常引着对方那句话）也算依据
const lessonSaid = r => (l => (l ? `${l.did}${l.effect}` : ''))(lessonOf(r));
const norm = s => String(s).replace(/<#[0-9.]+#>|\([A-Za-z][A-Za-z ]{0,24}\)/g, '').replace(/[\s，。！？、；：“”‘’…—,.!?;:"']/g, '');

// 模型输出 → 核对过的句子。sources：id → 记录（只含候选）；messageText：pos → 那条消息的正文（核对原话用）。
export function parseAssembly(text, { sources, messageText = () => '', stale = new Set() }) {
    const raw = String(text ?? '').trim();
    const lines = [], dropped = [];
    let haystack = null;
    if (!raw || /^无[。.]?$/.test(raw)) return { lines, dropped, none: true };
    for (let line of raw.split(/\n+/)) {
        // 去掉行首的列表记号（"· ""- ""1. ""2、"）；"10 天前"这种开头的数字要留着。
        line = line.trim().replace(/^(?:[-·*•]\s*|\d+[.、)）]\s*)+/, '').trim();
        if (!line || /^无[。.]?$/.test(line) || /^眼下[：:]/.test(line)) continue;
        const ids = [...line.matchAll(/\[([\d,，\s]+)\]/g)].flatMap(m => m[1].split(/[,，\s]+/).filter(Boolean).map(Number));
        let body = line.replace(/\s*\[[\d,，\s]+\]\s*/g, '').trim();
        if (!ids.length) { dropped.push({ line, reason: 'no_source' }); continue; }
        const bad = ids.filter(id => !sources.has(id));
        if (bad.length) { dropped.push({ line, reason: `unknown_source:${bad.join(',')}` }); continue; }
        if (PATTERN_WORDS.test(body)) { dropped.push({ line, reason: 'pattern' }); continue; }
        const said = norm(ids.map(id => { const r = sources.get(id); return `${r.text}${(r.quotes ?? []).join('')}${lessonSaid(r)}${messageText(r.pos)}`; }).join('|'));
        const most = body.match(MOST_WORDS)?.[0];
        if (most && !said.includes(most)) { dropped.push({ line, reason: `judgment:${most}` }); continue; }
        body = body.replace(FIRST_WORDS, w => (said.includes(w) ? w : ''));
        // 依据全是他最近几轮刚想起过的：又一遍老话。
        if (ids.every(id => stale.has(id))) { dropped.push({ line, reason: 'repeat' }); continue; }
        // 写的是眼下这一刻（前台自己看得见），不是旧事。
        if (/^(此刻|此时|现在|眼下|这会儿)/.test(body)) { dropped.push({ line, reason: 'present' }); continue; }
        // 原话要在他知道的记录或那几条消息里找得到（标错了编号但原话是真的，不算编）。
        haystack ??= norm([...sources.values()].map(r => `${r.text}${(r.quotes ?? []).join('')}${lessonSaid(r)}${messageText(r.pos)}`).join('|'));
        const fake = [...body.matchAll(/「([^」]+)」/g)].map(m => m[1]).filter(q => !haystack.includes(norm(q)));
        if (fake.length) { dropped.push({ line, reason: `quote_not_found:${fake[0].slice(0, 20)}` }); continue; }
        lines.push({ text: pastDayWords(body), ids: [...new Set(ids)] });
    }
    // 只写了"眼下"那一行、或者回了"无"：没有相关旧事。
    return { lines, dropped, none: !lines.length && !dropped.length };
}

export function renderNarrative(material, lines) {
    const { name, entry } = material;
    const out = [];
    if (entry) out.push(entry);
    if (lines.length) out.push(`${name}此刻可能想起的旧事（按时间）：`, ...lines.map(l => `· ${l.text}`));
    const rest = narrativeState(material, lines);
    if (rest.length) out.push(`${name}知道的、一直算数的现状：`, ...rest.map(r => `· ${r.text}${material.who?.(r) ?? ''}（${material.when(r)}起）`));
    out.push(...renderOpen(material));
    return finish(name, out);
}

// 组装那一格原来只放模型串的回忆线：长期现状模型没挑就丢了（实测用户在常去的酒吧说"老样子"，Q 上两回都没想起登记过的专属酒方，纯程序那一格里有）。
// 和用户这句话直接对上、回忆线里又没用到的，另列出来，至多三条。
export function narrativeState(material, lines) {
    const used = new Set(lines.flatMap(l => l.ids ?? []));
    // 长期改变也可能被程序归在"旧事"里（和眼下有关时先进旧事），一并看
    const lasting = [...(material.state ?? []), ...(material.hits ?? []).filter(r => r.type === '改变' && ['直到被改变', '永久'].includes(r.duration))];
    const seen = new Set();
    return lasting.filter(r => !used.has(r.id) && !seen.has(r.id) && seen.add(r.id) && (material.direct?.has(r.id) ?? false)).slice(0, 3);
}

// 调一次模型组装。client＝createModelClient(...)；返回核对后的句子和用量，出错就抛（调用方回退到纯程序那一格）。
export async function assembleNarrative({ client, name, present, recent, recentUser, material, messageText }) {
    const user = buildAssemblerPrompt({ name, present, recent, recentUser, material });
    const started = Date.now();
    const result = await client.complete({ system: renderPronouns(ASSEMBLER_SYSTEM, { person: name }), user });
    const sources = new Map(material.pool.map(r => [r.id, r]));
    const parsed = parseAssembly(result.text, { sources, messageText, stale: material.stale });
    return { ...parsed, raw: result.text, usage: result.usage, servedModel: result.servedModel, finishReason: result.finishReason, ms: Date.now() - started, prompt: user };
}

// 后台用的组装器：读配置、查预算、调模型、记账。没开或没配好返回 null（调用方用纯程序那一格）。
// 连接层面的失败（中转掐断连接、握手失败）很快就回来，再试一次；模型回了错误码、超时不重试。
export function retryOnce(client) {
    return {
        ...client,
        async complete(args) {
            try { return await client.complete(args); }
            catch (error) {
                if (!/fetch failed|ECONNRESET|socket hang up|other side closed/i.test(String(error?.message))) throw error;
                return client.complete(args);
            }
        },
    };
}

export function createAssembler({ getConfig, records, log = () => {}, makeClient = createModelClient }) {
    const assemble = async ({ chatKey, speaker, anchor, name, present, recent, recentUser, material, messageText }) => {
        const config = getConfig();
        const a = config.assembler;
        const baseUrl = a?.modelBaseUrl ?? a?.baseUrl, apiKey = a?.modelApiKey ?? a?.apiKey;   // 组装模型可以借别的格的钥匙（config: via）
        if (!a?.enabled || !baseUrl || !apiKey || !a.model) return null;
        if (records.spentToday() >= config.extractor.dailyBudgetUsd) { log(`assemble skipped: daily budget reached (${chatKey} ${speaker})`); return null; }
        const client = retryOnce(makeClient({ baseUrl, apiKey, model: a.model, maxOutputTokens: a.maxOutputTokens, timeoutMs: a.timeoutMs, temperature: a.temperature, extraBody: a.extraBody }));
        const started = Date.now();
        try {
            const r = await assembleNarrative({ client, name, present, recent, recentUser, material, messageText });
            const costUsd = ((r.usage?.input ?? 0) * a.priceInPerM + (r.usage?.output ?? 0) * a.priceOutPerM) / 1e6;
            records.logAssemble({ chatKey, speaker, anchor, model: a.model, servedModel: r.servedModel, status: 'done', usage: r.usage, costUsd, ms: r.ms,
                lines: r.lines.length, dropped: r.dropped.length, raw: r.raw });
            if (r.dropped.length) log(`assemble dropped ${r.dropped.length} line(s): ${r.dropped.map(d => d.reason).join(', ')}`);
            return r;
        } catch (error) {
            records.logAssemble({ chatKey, speaker, anchor, model: a.model, status: 'failed', ms: Date.now() - started, error: error.message });
            log(`assemble failed (${chatKey} ${speaker}): ${error.message}`);
            throw error;
        }
    };
    // 这一格最多等组装多久（毫秒；0＝不限）：到点先给纯程序那一格，组装好的留给左滑（D-100）。
    assemble.budgetMs = () => { const a = getConfig().assembler; return a?.enabled ? a.budgetMs : 0; };
    return assemble;
}

// ---------- 眼下这句话的检索词 ----------
// 旧记录的检索词是模型配的概念词（"专属招牌""登记名号"）；用户说的是口语（"用我名字起的那个"），
// 字面对不上。每句用户的话先让模型配一组同样风格的检索词，再拿去和记录的检索词比。一轮里所有角色共用。
export const KEYS_SYSTEM = [
    '你在帮程序从一部长篇角色扮演的旧记录里找和眼下有关的事。旧记录都配了"检索词"：2～6 个字的概念词（事件、症状、地点、物品、关系变化），外加平时说起它的同义、口语说法。',
    '下面是刚说的一段话。给它配 8～14 个检索词：它在说、在想、在问的事，以及它可能牵出来的旧事。同一个意思给两三种说法（口语的、书面的、近义的），因为旧记录里可能用的是另一种。每个 2～6 个字，不写人名；地名、店名、物品名照原样写。',
    '要是后面附了一份"旧记录里用过的检索词"：再从里面挑出和这句话意思相关的（哪怕字面不一样，比如这边说"车坏了"，旧记录里可能记作"引擎熄火"），原样照抄，放在你配的词后面；没有相关的就不挑。',
    '话再短、再没头没尾也照配：按最常见的理解配，不要反问，不要解释（实测"老规矩"这种短句，模型会反过来要背景，一个词都不给）。',
    '只输出两行，词之间用顿号隔开。第一行是上面这些检索词。第二行一定要写，以"宽："开头，写 3～4 个宽一点的说法：这句话说的东西属于哪一大类（比如"止痛片"是"药"，"抚恤金"是"赔偿"，"微波炉"是"家电""厨房"），在什么日常场合（吃饭、睡觉、看病、打架、住处、钱、出行、工作……）；用最平常的说法，每个 2～4 个字。',
].join('\n');

// 模型回的两行：第一行检索词，"宽："那行是宽说法。返回检索词数组，宽说法挂在它的 wide 上
// （下游算价码、关系表时照旧只当检索词数组用；召回时宽说法单独算、分量轻）。
export function parseKeyLines(text, names = []) {
    const lines = String(text ?? '').split('\n').map(s => s.trim()).filter(Boolean);
    const wideLine = lines.find(l => /^宽[：:]/.test(l)) ?? '';
    const keys = parseKeys(lines.filter(l => l !== wideLine).join('、'), names);
    keys.wide = parseKeys(wideLine.replace(/^宽[：:]/, ''), names).filter(k => !keys.includes(k)).slice(0, 4);
    return keys;
}

export function buildKeysPrompt({ recent = [], recentUser = '', vocab = [] }) {
    const user = recentUser.trim();
    // 只给用户这一句：带上前文时模型总会把前文的事也配进来（实测两个模型都这样），冲淡这一句。
    const said = [];
    // 附上旧记录里用过的检索词（质量窗，B 段召回没想起的那例："加热器又不转了"对不上"微波炉罢工"，配的词和记录的词一个字都不重合）。
    const table = vocab.length ? ['', '【旧记录里用过的检索词】', vocab.join('、')] : [];
    return [...said, `> ${user.replace(/\s*\n+\s*/g, ' ')}`, ...table].join('\n');
}

// 这一局看得见的记录里用过的检索词（去重，新的在前，至多 VOCAB_MAX 个）。
const VOCAB_MAX = 1500;
export function keyVocab(visible) {
    const seen = new Set();
    for (const r of [...visible].sort((a, b) => b.pos - a.pos)) for (const k of r.keys ?? []) if (k && !seen.has(k)) seen.add(k);
    return [...seen].slice(0, VOCAB_MAX);
}

export function parseKeys(text, names = []) {
    // 模型没配词、回了一段解释（"我需要更多信息……请提供……"）：一个都不要。
    if (/需要更多|请提供|无法确定|缺乏足够/.test(String(text ?? ''))) return [];
    const raw = String(text ?? '').replace(/[「」"“”\[\]]/g, '').split(/[、,，;；\/|\n·・•\s]+/).map(s => s.trim()).filter(Boolean);
    const out = [];
    for (const k of raw) {
        if (k.length < 2 || k.length > 8 || out.includes(k)) continue;
        if (names.some(n => n && (n.includes(k) || k.includes(n)))) continue;
        out.push(k);
        if (out.length >= 12) break;
    }
    return out;
}

// 后台用：读配置、调模型、记账。没开或没配好返回 null。
export function createKeyMaker({ getConfig, records, log = () => {}, makeClient = createModelClient, vocab = false }) {
    return async ({ chatKey, recent, recentUser, names = [] }) => {
        const config = getConfig();
        const a = config.assembler;
        const k = config.stages?.keys ?? { baseUrl: a?.baseUrl, apiKey: a?.apiKey, model: a?.keysModel || a?.model, priceInPerM: a?.keysPriceInPerM, priceOutPerM: a?.keysPriceOutPerM, extraBody: a?.extraBody };
        if (!a?.enabled || !k.baseUrl || !k.apiKey || !k.model || !recentUser?.trim()) return null;
        if (records.spentToday() >= config.extractor.dailyBudgetUsd) return null;
        const model = k.model;
        const client = retryOnce(makeClient({ baseUrl: k.baseUrl, apiKey: k.apiKey, model, maxOutputTokens: 300, extraBody: k.extraBody }));
        const started = Date.now();
        try {
            const r = await client.complete({ system: KEYS_SYSTEM, user: buildKeysPrompt({ recent, recentUser, vocab: vocab ? keyVocab(records.visible(chatKey)) : [] }) });
            const keys = parseKeyLines(r.text, names);
            const costUsd = ((r.usage?.input ?? 0) * k.priceInPerM + (r.usage?.output ?? 0) * k.priceOutPerM) / 1e6;
            records.logAssemble({ chatKey, speaker: '(检索词)', model, servedModel: r.servedModel, status: 'done', usage: r.usage, costUsd, ms: Date.now() - started, lines: keys.length, raw: r.text });
            return keys;
        } catch (error) {
            records.logAssemble({ chatKey, speaker: '(检索词)', model, status: 'failed', ms: Date.now() - started, error: error.message });
            log(`query keys failed (${chatKey}): ${error.message}`);
            return null;
        }
    };
}
