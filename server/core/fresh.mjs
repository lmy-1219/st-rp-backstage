import { personWord, renderPronouns } from './pronoun.mjs';
// 复读（质量窗 Q-4）：Gemini 很会照着上文模仿，同一个比喻、同一句狠话、同一个开头，一轮轮往下抄；
// 抄一回就进了上文，下一轮更想抄，越滚越重。用户在真源里压小上下文上限能压住，但剧情跟着丢，也不自动。
// 这里的做法：每条回复生成完，程序找出和他最近几条回复重样的说法（staleSpans），请便宜模型只把这几处换成新说法（fresh），
// 存进聊天——上文里攒不起复读，别的一个字不动。原文留在消息里，可以撤回。
// 前台的"别再说 X"清单不用：否定式提醒对 Gemini 无效，列出来反而把那几个词又塞进了上文。

import fs from 'node:fs';
import path from 'node:path';
import { repairQuotes } from './extract.mjs';
import { varyLine } from './pace.mjs';

const TAGS = /<#[0-9.]+#>|\([A-Za-z][A-Za-z ]{0,24}\)/g;   // TTS 停顿、语气词：是格式，不算说法
const CJK = /[一-鿿]/g;
const FUNCTION_CHARS = new Set('的了着得地又都就也还很来去下上出过起在是有这那个一把被给让和与或而且会要能可你我他她它们不没吗呢吧啊呀么');

export const PREVIOUS = 4;   // 和他最近这么多条回复比
const MIN = 4;               // 至少这么多个汉字才算"一个说法"
const LONG = 8;              // 这么长的原样照抄，出现过一次就算

const cjkCount = s => (String(s).match(CJK) ?? []).length;
// 一段里实词够不够：虚字占多数的（"了一下""你这个"）不算说法。
const meaty = s => [...String(s).matchAll(CJK)].filter(m => !FUNCTION_CHARS.has(m[0])).length >= 3;

// 新回复里和前几条重样的说法：取最长的公共片段，按在前几条里出现了几条算。
// 算复读的：在前几条里出现过两条以上（第三回用了）；或者够长（LONG 字以上）、前面出现过一回。
// 不算的：人名地名这类专名本身（exclude）；用户最近的话里有的（顺着对方的话说很自然）；实词太少的。
// usual＝他更早的回复（前几条之前的）：在里面也常见的（三条以上），是他一贯的说法、这个世界的叫法，不算新长出来的复读。
export function staleSpans(text, previous, { exclude = [], echo = '', usual = [] } = {}) {
    const plain = String(text).replace(TAGS, '');
    const prevs = previous.map(p => String(p).replace(TAGS, ''));
    const olds = usual.map(p => String(p).replace(TAGS, ''));
    if (!prevs.length || cjkCount(plain) < MIN) return [];
    const covered = new Array(plain.length).fill(false);
    const found = [];
    for (let len = Math.min(40, plain.length); len >= MIN; len--) {
        for (let i = 0; i + len <= plain.length; i++) {
            if (covered[i] || covered[i + len - 1]) continue;
            const span = plain.slice(i, i + len);
            if (cjkCount(span) < MIN || /^[\s，。！？、…—（）()「」“”：；]/.test(span) || /[\s（(「“]$/.test(span)) continue;
            const count = prevs.filter(p => p.includes(span)).length;
            if (!count) continue;
            if (!(count >= 2 || (cjkCount(span) >= LONG && count >= 1))) continue;
            if (!meaty(span) || exclude.some(x => x && (x === span || x.includes(span))) || (echo && echo.includes(span))) continue;
            const core = span.replace(/^[^一-鿿]+|[^一-鿿]+$/g, '');   // 两头的标点不算
            if (olds.filter(p => p.includes(core)).length >= 3) continue;
            if (!String(text).includes(span)) continue;   // 跨过了格式标记，原文里找不到原样的，不动
            for (let k = i; k < i + len; k++) covered[k] = true;
            found.push({ span, count });
        }
    }
    return found;
}

// 一条回复的复读程度（测试和报告用）：重样说法的汉字数占全文汉字数的比例。
export function staleRate(text, previous, opts) {
    const spans = staleSpans(text, previous, opts);
    const total = cjkCount(String(text).replace(TAGS, ''));
    return { spans, rate: total ? spans.reduce((s, x) => s + cjkCount(x.span), 0) / total : 0 };
}

// 原样重复程序找得到；换了几个字的同一个比喻、同一句狠话、同一个意象、同一种开头收尾，程序找不到（实测最扎眼的恰恰是这些），
// 所以每条都请模型看一眼：程序找到的一定换，模型再补上换了说法的同一个套路。
// 换整句，不换几个词：实测只换词，新词和前后文接不上（"破破主机壳""就就给老子"），还把地名换成了不知所云的话。
export const FRESH_SYSTEM = [
    '绑定语料的这一档还照顾两类口吻：条件式威胁和本条里反复套用的固定台词结构，读着像模型惯性、不像这个人。照语料换成这个角色此刻会说的另一种说法，意思和硬事实不变，不照抄语料。第一条回复没有前文可比时，只看这两类；没有就不改。属于这两类的替换在该项标"口吻":true；其余仍按下面的复读证据核对。',
    "下面是一部长篇角色扮演里某个角色刚说的一条回复，和〔当事人〕前面几条回复。写这些回复的模型很爱照着自己的上文抄：同一个比喻、同一个意象、同一句狠话、同一种动作描写、同一种开头和收尾的句式，一轮轮重复，读着像复读。",
    '请找出这条回复里和前几条重样的句子：用⟦⟧括起来的，是程序找到的原样重复，一定要换；换了几个字、但还是同一个比喻、同一个意象、同一句狠话、同一种动作描写、同一种句式的，也算，但它得在前几条里出现过两回以上：把前几条里那两处（或更多处）各逐字抄一小段（至少四五个字）放进"前面"，程序会核对；抄不出两处的，就不是复读，别换。',
    // 用户 10/3：Gemini 的新比喻挺好，被当成复读换成了大白话。头一回出现的不动，换上去的也不能更平
    '这条里头一回出现的比喻、玩笑、具体的人和细节，是这条写得好的地方，不要动。',
    "换的是整句：把那一句重写成新的一句——意思、分量、语气、人称不变，还是〔当事人〕的口吻、〔当事人〕这个人会说会做的；和前后文接得上、读着通顺。",
    "但同一个意思、同一种做法在前几条里已经出现过两回以上的（同一个警告或数落换着说法反复说，同一种\"等你……再……\"\"要是……我就……\"的条件句收尾，每句台词都先拿对方的话反问一句再接），这一条里别只换个说法：换成〔当事人〕此刻会说、会做的另一件事（接眼前刚发生的、说点〔当事人〕自己的、问点别的），和前后文接得上；实在接不上，就删掉那一句（\"新\"写空字符串）。剧情上的事实照旧不能改。",
    '新句子别再用前几条里用过的说法，也别只是换几个同义词：动作就换一个具体的动作或细节，比喻就换一个新的意象，狠话就换一个新的说法，句式就换一种开口。',
    "台词开头先把对方刚说的原话拎出来再接的（\"睡了一觉？\"\"吓着我？\"这种，程序找到的也用⟦⟧括起来了），只去掉复述的那半句（\"原\"只写那半句，\"新\"写空字符串），后面的话一个字不动；一条里挨个回对方好几件事的（\"至于……\"\"至于……\"一件件接），只留〔当事人〕最在意的那一件接得最实，别的带过或不回。",
    '换上去的新句子也别用这种开口：不拿对方的话反问一句再数落、挖苦、顶回去，不用"至于……"起头。',
    "新句子要是〔当事人〕这个人会说的话、带着〔当事人〕的劲儿，别写成只把意思交代清楚的平铺直叙；也不能比原句平淡：原句有比喻，就换一个同样鲜活的新比喻，原句有具体的人和细节，就换成同样具体的，别磨成大白话。要是附了【〔当事人〕本人的说话方式】：照那个口吻写——句子的长短、口头的脏字、打比方和开玩笑的路数、服软和认真时怎么说；但里面一句原话都不许用，也别拼接里面的片段，里面的人名、地名和事情跟这个故事无关，别搬进来。",
    "要是附了【刚才别人说的】：〔当事人〕顺着别人刚用的比喻、意象、句式往下说的，也算，换成〔当事人〕自己的说法（接别人的话头可以，别接别人的比喻）。",
    "不要动的：人名、地名、这个世界的叫法、〔当事人〕一贯对人的称呼和口头禅；顺着对方的话往下接的（但开头原样复述对方原话的那半句要去掉，见上）；有意回扣前面说过的话（\"我前天说的……\"）。剧情上的事实（天数、伤势、地点）不能改，同一个事实可以换个说法。",
    "改动作描写时，〔当事人〕在哪、站着还是坐着、手上拿着什么，要和前后句接得上（原句〔当事人〕靠着站着，新句别让〔当事人〕从椅子里站起来）。",
    '括号里的英文语气词、<#数字#>这类停顿标记原样留着，不要放进要换的句子里。至多换五句（其中删掉的至多两句）；没有复读就输出 []。⟦⟧括起来的和开头复述的，不用填"前面"。',
    "另外，看看〔当事人〕这几条（连同刚说的这条）一再在用的路数：老一套的开口、老一套的收尾（比如每条都用同一种狠话收）、反复出现的同一类比喻、同一个动作。用一句话点出每一种路数，不抄原句，至多三条；没有就空着。",
    '问话、追问不算路数：久别重逢有很多想问的，对方躲着不答时追着问也是常情——以问句、追问收尾的，别点。但先拿对方的话反问一句、再数落挖苦的，算。',
    // N-279（用户 10/2）：前台的补全要用在临时的小事、环境、姿态、念头、对已有的事的看法上，不是把写过的改得前后矛盾。写的时候它不回头核对，这里替它核对一遍。
    "再核对一件事：这条回复里有没有和【前文】【〔当事人〕知道、一直算数的事】【这一轮触发的设定】【此刻的样子】【〔当事人〕这一轮想起的】对不上的硬事实——谁、什么时候、多少、什么东西、在哪（比如前文写〔当事人〕自己开车来的，这条却说叫了车；设定写\"将近半年里陆续\"，这条说\"半个月\"）。只认明明白白写着的：前文和设定都没交代过的细节可以补，不算对不上；〔当事人〕的看法、情绪、夸张的说法、有理由的隐瞒和假话也不算。对得上就不动；对不上的，把那一句改成和写着的一致，改得越少越好，口吻不变，放进\"对\"里，\"依据\"写是哪里写的。",
    '不要写分析和解释，直接只输出 JSON：{"换": [{"原": "回复里原样的一整句", "新": "重写的一句", "前面": ["前几条里一处的原文", "另一处的原文"]}], "对": [{"原": "回复里原样的一整句", "新": "改对了的一句", "依据": "哪里写的"}], "路数": ["……"]}',
].join('\n');

// 程序找到的说法扩到它所在的那一句（不跨过格式标记、括号、换行）。
export function sentenceOf(text, span) {
    const t = String(text), i = t.indexOf(span);
    if (i < 0) return null;
    const START = /[。！？!?…\n（(「“>）)」”]/, END = /[。！？!?…]/, HARD = /[\n（(「“<）)」”]/;
    let a = i, b = i + span.length;
    while (a > 0 && !START.test(t[a - 1])) a--;
    if (!END.test(t[b - 1])) {
        while (b < t.length && !END.test(t[b]) && !HARD.test(t[b])) b++;
        while (b < t.length && END.test(t[b])) b++;
    }
    return t.slice(a, b).trim();
}

// others＝他上一次开口之后、别人说的（群里后开口的人会顺着前一个人的比喻往下说，质量窗老毛病）。
// facts：开局单里他知道、标了常驻的前事（换上的句子别和这些相反：用户 10/1，换句子的模型把她的身体写成"二手货"一类）。
// 核对硬事实（N-279）：context＝这条之前的十来条（谁说的、原文）；lore＝这一轮酒馆真触发的世界书 [{ title, text }]；state＝此刻的样子那几行。
// recall＝这一轮给他的回忆（场记里"想起的"那一块：那几场经过、旧事；N-284 第三步）——说岔了以前的事，照这个改回来。
export function freshPrompt({ name, text, spans, previous = [], others = [], voice = '', facts = [], context = [], lore = [], state = [], recall = '' }) {
    let marked = String(text);
    const sentences = [...new Set(spans.map(x => sentenceOf(text, x.span)).filter(Boolean))];
    for (const one of sentences.sort((a, b) => b.length - a.length)) marked = marked.split(one).join(`⟦${one}⟧`);
    const around = others.length ? ['', renderPronouns("【刚才别人说的】（不是〔当事人〕说的）", { person: name }), ...others.map(o => `${o.name}：${String(o.text).replace(TAGS, '').slice(0, 1200)}`)] : [];
    const own = voice ? [`【${name}本人的说话方式】（原作里${personWord(name)}在各种场面说的话，只学口吻；一句也不许照抄，里面的人和事别搬进来）`, voice, ''] : [];
    const known = facts.length ? [`【${name}知道、一直算数的事】（换上的句子别和这些相反，也别补出相反的细节）`, ...facts.map(f => `· ${f}`), ''] : [];
    const before = context.length ? ['【前文】（这条之前的几条，从早到晚；核对用，里面的句子不要动）', ...context.map(m => `${m.name}：${String(m.text).replace(TAGS, '').slice(0, 600)}`), ''] : [];
    const set = lore.length ? ['【这一轮触发的设定】', ...lore.map(e => `· ${e.title ? `〔${e.title}〕` : ''}${String(e.text).slice(0, 600)}`), ''] : [];
    const now = state.length ? ['【此刻的样子】', ...state, ''] : [];
    const remembered = String(recall ?? '').trim() ? [`【${name}这一轮想起的】（给${personWord(name)}的旧事和那几场经过；核对用。说到以前的事——谁、什么时候、在哪、谁说了什么——和这里对不上的，算对不上）`, String(recall).replace(/【场记】/g, '').trim().slice(0, 3000), ''] : [];
    return [...own, ...known, ...set, ...now, ...remembered, ...before, `【${name}前几条回复】（从早到晚；只拿来比，里面的句子不要动）`, ...previous.map((p, i) => `（${i + 1}）${String(p).replace(TAGS, '').slice(0, 1500)}`),
        ...around, '', `【${name}刚说的这条】（只换这一条里的句子，"原"逐字照抄这里）`, marked.replace(TAGS, '')].join('\n');
}

// 模型给的替换：原文得是这条回复里原样的一句（不含格式标记）；新句子不能空、不能太长、不能又是前几条里的原话。至多六处。
// 模型有时先写一段分析再给 JSON（实测分析里带方括号，按第一个"["切就切坏了）：先找代码块，再找对象，再找"[{"开头的数组（老格式）。
function parseAnswer(raw) {
    const s = String(raw ?? '');
    const block = /```(?:json)?\s*([\s\S]*?)```/i.exec(s)?.[1];
    // 只有"对"、没写"换"的对象也是新格式（不然会被当成老格式的数组，把改事实当成换句子）
    for (const cand of [block, /\{\s*"换"[\s\S]*\}/.exec(s)?.[0], /\{\s*"(?:对|路数)"[\s\S]*\}/.exec(s)?.[0], /\[\s*\{[\s\S]*\}\s*\]/.exec(s)?.[0], /\[\s*\]/.exec(s)?.[0]]) {
        if (!cand) continue;
        try {
            let v;
            try { v = JSON.parse(cand.trim()); } catch { v = JSON.parse(repairQuotes(cand.trim())); }   // 字符串里带了没转义的引号（实测"路数"里常有）
            if (Array.isArray(v)) return { list: v, ways: [], fix: [] };
            if (v && typeof v === 'object') return { list: Array.isArray(v['换']) ? v['换'] : [], ways: Array.isArray(v['路数']) ? v['路数'] : [], fix: Array.isArray(v['对']) ? v['对'] : [] };
        } catch {}
    }
    return null;
}
export const freshAnswerValid = raw => parseAnswer(raw) !== null;

// 真在问的不点；拿对方的话反问一句再数落的，是路数（用户 9/30 在自己的规则里也禁了"先反问、后调侃"）
const ASKING = /询问|追问|问句|提问|发问|问话|问题(作结|收尾|结尾)|以问/;
export const keepWay = w => /反问|复述|原话|至于/.test(String(w ?? '')) || !ASKING.test(String(w ?? ''));
// 路数只点路数本身：去复读顺手写的"换成了……"是它这次怎么改的，转给前台就成了下一条该往哪儿写
// （试玩 10/6："反复用排异药效作为警告的理由，换成了对身体状态的其他具体关切"——前台照着又去关心身体）
export const wayOnly = w => String(w ?? '').replace(/[，,；;]\s*(?:已?换成|已?改成|已?改为|替换成|换作|代之以)[\s\S]*$/, '').trim();
// 在原文里找一句（跳过中间夹着的 TTS 停顿、语气标记）：返回原文里的起止，和夹在里面的标记各在第几句之后。
const ENDS = /[。！？!?…]/;
export function locate(text, from) {
    const src = String(text), want = String(from).replace(TAGS, '');
    const map = [], tags = [];
    let plain = '';
    const re = new RegExp(TAGS.source, 'g');
    let last = 0, m;
    const keep = upto => { for (let i = last; i < upto; i++) { map.push(i); plain += src[i]; } };
    while ((m = re.exec(src))) { keep(m.index); tags.push({ at: plain.length, tag: m[0], index: m.index }); last = m.index + m[0].length; }
    keep(src.length);
    const idx = plain.indexOf(want);
    if (idx < 0 || !want) return null;
    const endPlain = idx + want.length;
    const start = map[idx], end = map[endPlain - 1] + 1;
    const inside = tags.filter(t => t.index > start && t.index < end)
        .map(t => ({ tag: t.tag, after: [...plain.slice(idx, t.at)].filter(c => ENDS.test(c)).length, prev: plain.slice(Math.max(idx, t.at - 3), t.at) }));
    return { start, end, inside };
}
// 停顿标记放回去：新句子里还留着标记前面那几个字的，就放在那几个字后面（改错字、删半句时原样回到原处）；
// 找不到的再按"第几句之后"放（试玩 10/3：按句数放，两个标记挤到了一处）。
export function withTags(to, inside) {
    if (!inside.length) return to;
    let s = String(to), cursor = 0;
    const rest = [];
    for (const t of inside) {
        const k = t.prev ? s.indexOf(t.prev, cursor) : -1;
        if (k < 0) { rest.push(t); continue; }
        const at = k + t.prev.length;
        s = `${s.slice(0, at)}${t.tag}${s.slice(at)}`;
        cursor = at + t.tag.length;
    }
    if (!rest.length) return s;
    const parts = s.split(/(?<=[。！？!?…])/);
    for (const t of [...rest].reverse()) {
        const k = Math.min(t.after, parts.length) ;
        if (k <= 0) parts[0] = `${t.tag}${parts[0]}`;
        else parts[k - 1] = `${parts[k - 1]}${t.tag}`;
    }
    return parts.join('');
}

// 他本人的口吻（用户 9/30：换上来的句子平铺直叙、发沉）：后台数据目录"口吻/"下按名字放的台词选段，换句子时附给模型学口吻。
// 选段是原作的台词，只留在本机数据目录，不进仓。按他的名字、再按头像名找，至多 VOICE_MAX 字。
export const VOICE_MAX = 4000;
export function voiceOf(dir, names = []) {
    try { if (!fs.lstatSync(dir).isDirectory() || fs.lstatSync(dir).isSymbolicLink()) return ''; } catch { return ''; }
    for (const raw of names) {
        const n = String(raw ?? '').replace(/\.(png|webp|jpe?g|gif)$/i, '').replace(/[\\/:*?"<>|]/g, '').trim();
        if (!n) continue;
        for (const ext of ['.md', '.txt']) {
            try { const file = path.join(dir, n + ext), st = fs.lstatSync(file); if (!st.isFile() || st.isSymbolicLink()) continue; const t = fs.readFileSync(file, 'utf8').trim(); if (t) return t.slice(0, VOICE_MAX); } catch {}
        }
    }
    return '';
}

export const voiceName = name => String(name ?? '').replace(/\.(png|webp|jpe?g|gif)$/i, '').replace(/[\\/:*?"<>|]/g, '').trim();

// 沿用旧文件名；只接受数据目录内的普通文件，不跟随目录或文件链接。
export function voiceLibrary(dir) {
    const checkDir = () => { if (fs.existsSync(dir) && (!fs.lstatSync(dir).isDirectory() || fs.lstatSync(dir).isSymbolicLink())) throw new Error('口吻目录不是普通目录'); };
    const files = name => {
        checkDir(); const n = voiceName(name);
        if (!n || n === '.' || n === '..') throw new Error('角色名不能作为口吻文件名');
        return ['.md', '.txt'].map(ext => path.join(dir, n + ext));
    };
    const read = name => {
        for (const file of files(name)) if (fs.existsSync(file)) {
            const st = fs.lstatSync(file); if (!st.isFile() || st.isSymbolicLink()) throw new Error('口吻文件不是普通文件');
            const text = fs.readFileSync(file, 'utf8'); if (text.trim()) return text;
        }
        return '';
    };
    return { read, write(name, text) {
        read(name); if (typeof text !== 'string' || !text.trim() || text.length > 500000) throw new Error('语料不能为空，且最多50万字');
        fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(files(name)[0], text, 'utf8');
        return { warning: [...text].length > 20000 ? '太长了，挑有代表性的几十段就够' : '' };
    }, remove(name) { read(name); for (const file of files(name)) if (fs.existsSync(file)) fs.unlinkSync(file); } };
}

// 只给新增的两类目标放行；普通事实句不能靠一个模型标记绕过复读核对。
export function styleCandidate(text, from) {
    if (!String(text).includes(from)) return false;
    if (/(?:要是|如果|你敢|再)[^。！？!?\n]{1,100}我就[^。！？!?\n]+/.test(from)) return true;
    const sentences = String(text).split(/(?<=[。！？!?])/).map(x => x.trim()).filter(Boolean);
    if (!sentences.includes(from)) return false;
    const head = from.match(/^[一-鿿]{4,}/)?.[0]?.slice(0, 4);
    return !!head && sentences.filter(x => x.startsWith(head)).length >= 2;
}
// 新句子里有连续这么多字和选段一模一样的，算照抄，不收。
const COPY_RUN = 8;
function copies(to, source) {
    const src = String(source ?? '').replace(/\s+/g, '');
    const t = String(to).replace(TAGS, '').replace(/\s+/g, '');
    if (!src || t.length < COPY_RUN) return false;
    for (let i = 0; i + COPY_RUN <= t.length; i++) { const w = t.slice(i, i + COPY_RUN); if (cjkCount(w) >= 6 && src.includes(w)) return true; }
    return false;
}

// 一句开头拿对方的话反问的那半句（"对什么口供？"）：短、带问号，里头的实字一半以上是对方刚说过的。
// 和 pace.echoOpenings 不同，带"什么"的也算——只在模型已经要换这一句时才用，用来把它的改动收窄到这半句。
const ASK_WORDS = new Set('什怎哪谁何几');
const LIGHT_CHARS = new Set('想还就要你我他她的了吗呢吧啊呀么嘛又都也说是这那个');
export function echoHead(from, said) {
    const m = /^([^，。！？!?…；：\n]{1,14}[？?]+)/.exec(String(from ?? '').trim());
    if (!m || !said) return null;
    const core = [...m[1]].filter(c => /[一-鿿]/.test(c) && !LIGHT_CHARS.has(c) && !ASK_WORDS.has(c));
    const src = String(said);
    return core.length >= 2 && core.filter(c => src.includes(c)).length * 2 >= core.length ? m[1] : null;
}
// 去掉复述的那半句，后面的话原样留着（用户 10/3：整句重写，把后半句一个挺好的新比喻也换没了）。
function withoutHead(from, head) {
    const i = from.indexOf(head);
    if (i < 0) return null;
    const rest = from.slice(i + head.length).replace(/^(……|…|[，。、：；！？!?])*\s*/, '');
    return `${from.slice(0, i)}${rest}`.trim();
}
// 换上去的句子让他换了姿势（原句他站着，新句"从椅子里站起来"）：前后句还写着原来的姿势，读着就矛盾了。走动不算。
const POSE = /坐下|坐回|坐到|坐进|坐在|坐着|坐起|坐直|椅子里|站起|站直|起身|直起|躺下|躺回|躺着|蹲下|跪下/g;
export const changesPose = (from, to) => [...String(to).matchAll(POSE)].some(m => !String(from).includes(m[0]));
// 模型说是复读、程序没找到的：得在前几条里真出现过两回以上。模型把那两处抄在"前面"里，程序逐字核对，
// 要落在两条不同的回复里（用户 10/3：这条里头一回出现的比喻被当成复读换成了大白话）。
export function seenTwice(item, prevs) {
    const quotes = (Array.isArray(item?.['前面']) ? item['前面'] : []).map(q => String(q ?? '').replace(TAGS, '').replace(/[⟦⟧]/g, '').trim()).filter(q => cjkCount(q) >= 4);
    const hit = new Set();
    for (const q of quotes) prevs.forEach((p, i) => { if (p.includes(q)) hit.add(i); });
    return hit.size >= 2;
}

export function applyFresh(text, spans, raw, previous = [], { voice = '', said = '', styleOnly = false } = {}) {
    const answer = parseAnswer(raw);
    if (!answer) return { text, changes: [], ways: [], fixed: 0 };
    const list = answer.list;
    // 问话、追问不算路数（试玩 9/30：点了"每条都用询问或追问作结"，前台就不敢问了，五年没见的一场戏没法往下聊）
    const ways = answer.ways.map(w => wayOnly(w).slice(0, 60)).filter(w => w && keepWay(w)).slice(0, 3);
    const prevs = previous.map(p => String(p).replace(TAGS, ''));
    let out = String(text);
    const changes = [];
    const echoes = (spans ?? []).filter(x => x?.echo).map(x => String(x.span)).filter(Boolean);
    const stale = (spans ?? []).filter(x => x && !x.echo).map(x => String(x.span)).filter(Boolean);
    let dropped = 0;
    for (const item of list.slice(0, 6)) {
        const from = String(item?.['原'] ?? '').replace(/[⟦⟧]/g, '').trim();
        let to = String(item?.['新'] ?? '').replace(/[⟦⟧]/g, '').trim();
        if (styleOnly && !(voice && item?.['口吻'] === true && styleCandidate(text, from))) continue;
        // 开头复述对方的话：只去掉那半句，模型写的新句子不用
        const head = echoes.find(e => from.includes(e)) ?? echoes.find(e => e.includes(from)) ?? echoHead(from, said);
        const echo = !!head;
        if (echo) {
            const left = from.includes(head) ? withoutHead(from, head) : '';
            if (left == null) continue;
            to = cjkCount(left) ? left : '';
        }
        if ((cjkCount(from) < 4 && !echo) || cjkCount(from) < 1 || from.length > 300) continue;
        // 程序找到的原样重复一定换；模型自己认的，得在前几条里真出现过两回
        if (!echo && !stale.some(x => from.includes(x) || x.includes(from)) && !seenTwice(item, prevs)
            && !(voice && item?.['口吻'] === true && styleCandidate(text, from))) continue;
        if (!to && !echo && (dropped >= 2 || from.length > 120)) continue;
        if (to === from || to.length > from.length * 2 + 30 || new RegExp(TAGS.source).test(to)) continue;
        if (!echo && changesPose(from, to)) continue;
        if (cjkCount(to) >= LONG && prevs.some(p => p.includes(to))) continue;
        if (voice && copies(to, voice)) continue;   // 照抄了他本人的原话
        const at = locate(out, from);
        if (!at) continue;
        const was = out.slice(at.start, at.end);
        const put = withTags(to, at.inside);
        let next = `${out.slice(0, at.start)}${put}${out.slice(at.end)}`;
        if (!to) {
            next = next.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n');
            if (/（\s*）|\(\s*\)/.test(next) && !/（\s*）|\(\s*\)/.test(out)) continue;   // 删完剩个空括号：动作描写里的不删
            if (!echo) dropped += 1;   // 删复述开头不算在"至多两句"里
        }
        // put＝实际放进去的（带停顿标记），before＝它前面那几个字：面板上一条条撤回时用来找位置
        changes.push({ from: was, to, put, before: out.slice(Math.max(0, at.start - 16), at.start) });
        out = next;
    }
    // 和写着的对不上的硬事实（N-279）：改成一致的说法，改得少；不删句子，不改得比原句长出一截。至多三处
    let fixed = 0;
    for (const item of (styleOnly ? [] : answer.fix ?? []).slice(0, 3)) {
        const from = String(item?.['原'] ?? '').replace(/[⟦⟧]/g, '').trim(), to = String(item?.['新'] ?? '').replace(/[⟦⟧]/g, '').trim();
        if (!from || !to || to === from || cjkCount(from) < 2 || from.length > 300 || to.length > from.length * 1.5 + 20 || new RegExp(TAGS.source).test(to)) continue;
        const at = locate(out, from);
        if (!at) continue;
        if (changesPose(from, to)) continue;
        const was = out.slice(at.start, at.end);
        const put = withTags(to, at.inside);
        changes.push({ from: was, to, put, before: out.slice(Math.max(0, at.start - 16), at.start), fix: true, why: String(item?.['依据'] ?? '').trim().slice(0, 80) });
        out = `${out.slice(0, at.start)}${put}${out.slice(at.end)}`;
        fixed += 1;
    }
    return { text: out, changes, ways, fixed };
}

// 他下一次开口前，那一格末尾提前说一声（第三版在测）：点的是路数，不是具体的词。
// 和"形状"（pace.shape）一起时合成一句，见 pace.varyLine。
export function waysLine({ name, ways }) {
    return ways?.length ? varyLine({ name, ways }) : null;
}
