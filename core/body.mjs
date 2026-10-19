import { playerWord } from './pronoun.mjs';
// 她的身子她说了算（用户 10/12，方案 叙事节奏与防棘轮 第二节"什么是棘轮"、第四节"前台这头"）：
// 玩家的角色一病，角色就开始照顾、说她身子弱；记账把这些记成他的态度和规矩，下一轮他带着这些料开口，关心得更重……
// 逐轮叠加，永远好不了。玩家自己写"好多了"也挡不住——各人那一格里还摆着十几条她的读数、用药、叮嘱。
// 前台这头不喂：看玩家最近几条自己写的话——
//   没提身子（closed）：各人那一格里关于她伤病的料一条不给；
//   提了（open）：每人至多两条（留最新的），再加一句"照她自己写的来；心疼、护着可以，要做什么就自己去做，别拦别数落"（用户 10/12：关心不是当爹、不是保姆）；
//   她说好了（healed）：一条不给，只说"她说已经好了，按好了写"。
// 不动的：开局单里用户亲手写的、玩家刚发的那一句、他自己和别的角色的伤病（配角受伤、示弱是好事）。
// 都是程序判断，不调模型；只认通用字眼，不写题材（D-37）。
// 已知误判（字面规则认不出谁是病人，先不改）：她照顾别人（"乙给甲换药"）也算她的伤病；别的女角色的伤只写"她"不写名字时，
// 关系那一行、余波里会被当成她的切掉；余波和离开那段里没写是谁的伤病默认算她的（"托人找的药还没送来"），别人的也会被切；
// 男性玩家角色只写"他"不写名字的，关系那一行里截不掉。
import { bareText } from './records.mjs';

const TAGS = /<#[0-9.]+#>|\([A-Za-z][A-Za-z ]{0,24}\)/g;
const plain = s => String(s ?? '').replace(TAGS, '').trim();

// 不是伤病的词（伤心、针对、炸药、痛快、吐槽……）：先抹掉再认。侧过身子、探出身子是姿势，不是身体状况
const NOT_BODY = /伤心|伤感|悲伤|忧伤|感伤|哀伤|伤神|伤脑筋|中伤|伤和气|伤了心|伤透了?心|毛病|弊病|通病|语病|诟病|病毒|炸药|火药|弹药|后悔药|卖的什么药|卖什么药|针对|方针|指针|针织|针线|针脚|针锋|针孔|指南针|别针|回形针|大头针|绣花针|时针|分针|秒针|插针|心疼|疼爱|疼惜|痛快|痛恨|痛骂|痛哭|痛心|悲痛|沉痛|哀痛|惨痛|痛饮|痛击|痛斥|吐槽|吐露|谈吐|吞吐|吐字|吐气|吐舌|吐烟|吐苦水|吐(?:了|出)?一?口(?:气|烟|浊气|唾沫|口水)|红晕|光晕|晕染|晕开|日晕|月晕|倒胃口|对胃口|身体力行|(?:侧|转|探|直|弯|俯|挺|缩|蜷|扭|歪|欠|翻|挪|背|仰)(?:过|出|起|下|着|了)?身[子体]|(?:听|看|想)[^，。！？!?]{0,12}?犯恶心|心[里口头中尖]?(?:一阵|有点|有些|开始|微微|隐隐|猛地|一)?(?:发|钝|刺|隐|绞)?[疼痛]|脑仁[^，。！？!?]{0,3}?[疼痛]/g;
// 伤病、身体状况的通用字眼
const BODY = /伤|病|药|针|疼|痛|医|诊|复查|读数|体温|发烧|发热|烧退|退烧|吐|晕|虚弱|脉搏|血压|血糖|养伤|休养|静养|疗养|康复|痊愈|身子|身体|手术|绷带|包扎|输液|点滴|注射|打针|吃药|止痛|伤口|抽筋|胃|咳嗽|干咳|感冒|着凉|发炎|过敏|骨折|扭伤|淤青|瘀青|流血|出血|失血|止血|缝针|拆线|住院|出院|挂号|护士|大夫|体检|犯恶心|乏力|贫血|拉肚子|腹泻|呕吐|干呕|做(?:个|了|完)?检查|去检查|检查(?:结果|报告|单|身体|一下身体|伤)|(?:身体|全身|常规|血液|全面)检查/;

// 这句在说伤病、身体状况没有
export function bodyTalk(text) {
    return BODY.test(plain(text).replace(NOT_BODY, '　'));
}

// 玩家说自己好了：好多了、没事了、不疼了、缓过来了、没抽筋……前面带"没""还没""不"的不算（"还没好利索"），问别人的不算（"好多了吗"）
const HEALED = /好多了|好些了|好点了|好一些了|好得差不多|好全了|好利索|利索了|全好|痊愈|没事了|没大碍|没什么大碍|不碍事|不疼了|不痛了|不难受了|不晕了|不烧了|烧退了|退烧了|缓过来了|缓过劲|恢复得(?:挺|很|还|蛮|都)*好|恢复得不错|安生得很|舒服多了|舒服些了|有劲了|精神多了|没再(?:疼|痛|吐|晕|烧|抽筋)|没(?:抽筋|发烧|发热|呕吐|吐过|疼过|痛过|晕过)|(?:已经|早就?|都|全|快|基本|差不多|伤|病|身子|身体|胃|腿|手|我)好了/g;
const healedAt = (t, m) => {
    const before = t.slice(Math.max(0, m.index - 2), m.index);
    const after = t.slice(m.index + m[0].length, m.index + m[0].length + 1);
    return !(/[没不未别]$/.test(before) && !/^[没不]/.test(m[0])) && !/^[吗么？?]/.test(after);
};
export function healedSaid(text) {
    const t = plain(text);
    for (const m of t.matchAll(HEALED)) if (healedAt(t, m)) return true;
    return false;
}
// 没说到伤病字眼、只说"好多了""没事了"的那一截：得是在说她自己（前面没别的主语，或者是"我"）——"这样好多了"说的是别的
const SELF = /^(?:我|人家|俺)?(?:已经|都|早就?|真的?|其实|基本上?|差不多|也|这会儿|现在)*$/;
function selfHealed(text) {
    const t = plain(text).replace(/[（(][^）)]*[）)]/g, '').trim();
    for (const m of t.matchAll(HEALED)) if (healedAt(t, m) && SELF.test(t.slice(0, m.index).trim())) return true;
    return false;
}

// 一段话按句、按逗号切开（分隔符留着，拼回去还是原样）
const CUT = /([，,。！？!?；;…\n]+)/;
const piecesOf = text => {
    const raw = plain(text).split(CUT);
    const out = [];
    for (let i = 0; i < raw.length; i += 2) out.push({ text: raw[i], sep: raw[i + 1] ?? '' });
    return out.filter(p => p.text.trim());
};
const SAID_MAX = 40;
// 玩家自己那条里说的是别人的身子、或者打比方（试玩 10/13：「但某某的身体不能乱搞」「少一具身体」「听到这话就犯恶心」
// 「你身体感觉怎么样」（问别人）都被当成她在说自己的伤病，每个人那一格都收到"她的身子……护着"，一轮比一轮像在管她）：先抹掉再认
const OTHERS_BODY = /(?<![我])(?<!自己)的(?:身体|身子|躯体)|(?:你们|他们|她们|你|他|她|您)(?:这副|那副)?(?:身体|身子|躯体)|[一两二三几每]\s*[具副](?:身体|身子|躯体)|(?:听|看|想)[^，。！？!?]{0,12}?犯恶心/g;
const ownBodyTalk = text => bodyTalk(plain(text).replace(OTHERS_BODY, '　'));
// 这条消息里最后说到身体的那一截：是"好了"就 healed；说的那一小段（连着几截都在说身体就连起来，至多 40 字）
function bodyPart(text) {
    const ps = piecesOf(text);
    const about = p => ownBodyTalk(p.text) || selfHealed(p.text);
    let last = -1;
    ps.forEach((p, i) => { if (about(p)) last = i; });
    if (last < 0) return null;
    let first = last;
    while (first > 0 && about(ps[first - 1]) && ps.slice(first - 1, last + 1).map(p => p.text + p.sep).join('').length <= SAID_MAX) first--;
    let said = ps.slice(first, last + 1).map((p, i, a) => p.text + (i < a.length - 1 ? p.sep : '')).join('').trim();
    if (said.length > SAID_MAX) said = said.slice(0, SAID_MAX);
    return { healed: healedSaid(ps[last].text), said };
}

// 看这个窗口里玩家最近 lookback 条自己发的消息：最近一条说到身体的那条是"好了"→ healed；有说到身体的 → open（said：那一小段）；都没说到 → closed
export const BODY_LOOKBACK = 4;
export function bodyGate({ messages = [], userName = null, lookback = BODY_LOOKBACK } = {}) {
    const mine = messages.filter(m => m?.is_user).slice(-lookback);
    for (let i = mine.length - 1; i >= 0; i--) {
        const hit = bodyPart(mine[i].text);
        if (hit) return { mode: hit.healed ? 'healed' : 'open', said: hit.said };
    }
    return { mode: 'closed', said: '' };
}

// 这一行说的是玩家的角色（含她的名字或别名；别名至少两个字，一个字的太容易撞上别的词）
const herNames = ({ userName = null, aliases = [] } = {}) => [...new Set([userName, ...aliases].filter(n => n && (n === userName || String(n).length >= 2)).map(String))];
export function aboutHer(line, { userName = null, aliases = [] } = {}) {
    const t = String(line ?? '');
    return herNames({ userName, aliases }).some(n => t.includes(n));
}
const isHer = (n, { userName = null, aliases = [], same = (a, b) => a === b } = {}) => !!n && !!userName && (same(n, userName) || aliases.includes(n));

// 一条记录是不是在说她的伤病：记录写明了关于她（about），或者正文里有她的名字（关于别人的那条，要同一截里既有她又说到伤病）；
// 生活现状里她的"身体"那一笔（加上、加重了的；只写"好了、不在了"的不算——那是往好里走）
export function herBodyRecord(r, ctx = {}) {
    if (!r || !ctx.userName) return false;
    const l = r.life;
    if (l) return l.kind === '身体' && isHer(l.who, ctx) && !!String(l.now ?? '').trim();
    const text = [bareText(r.text), r.matter?.title].filter(Boolean).join('；');
    if (!bodyTalk(text)) return false;
    if (isHer(r.about, ctx)) return true;
    if (r.about) return piecesOf(text).some(p => aboutHer(p.text, ctx) && bodyTalk(p.text));
    return aboutHer(text, ctx) || isHer(r.holder_name, ctx);
}
// 此刻的样子里她的身体那一笔
export const herBodyNote = (n, ctx = {}) => !!n && n.aspect === '身体' && isHer(n.who, ctx);
// 只拿得到成句的地方（来联系那几行、兴头）：这一句说到她、又说到伤病
export const herBodyLine = (line, ctx = {}) => aboutHer(line, ctx) && bodyTalk(line);
// 后台排的一件事（口袋）：说到她的伤病，或者是她那边的事又说到伤病
export function herBodyItem(m, ctx = {}) {
    if (!m) return false;
    const t = [m.title, m.surface, m.respond].filter(Boolean).join('；');
    return bodyTalk(t) && (aboutHer(t, ctx) || isHer(m.who, ctx));
}

// 关系那一行"后来："之后的那段（规划、记账写的关系现状）：按逗号、分号切开，只去掉说她伤病的那一截，其余照留。
// 那一截里没写名字、只写"她"的（"先看她身子稳不稳"），在这一局里多半就是她；和她那一对的，没写"他"的也算她的
export function cutHerBody(text, { userName = null, aliases = [], towardHer = false } = {}) {
    const raw = String(text ?? '').split(/([，,；;])/);
    const hers = seg => bodyTalk(seg) && (aboutHer(seg, { userName, aliases }) || /她/.test(seg) || (towardHer && !/他/.test(seg)));
    const out = [];
    for (let i = 0; i < raw.length; i += 2) if (raw[i].trim() && !hers(raw[i])) out.push(raw[i] + (raw[i + 1] ?? ''));
    return out.join('').replace(/^[，,；;\s]+|[，,；;\s]+$/g, '');
}
// 一张关系现状表（relations.currentRelations 的 Map，带 dir）整张过一遍：截完什么都不剩的那对就拿掉（那一行退回表里的底）。
// towardHer(key)：这一对里有没有她
export function cutRelations(current, { towardHer = () => false, ...ctx } = {}) {
    if (!current) return current;
    const fix = map => {
        const out = new Map();
        for (const [k, v] of map) {
            const text = cutHerBody(v?.text, { ...ctx, towardHer: towardHer(k) });
            if (text) out.set(k, text === v.text ? v : { ...v, text });
        }
        return out;
    };
    const out = fix(current);
    if (current.dir) out.dir = fix(current.dir);
    if (current.planDir) out.planDir = fix(current.planDir);   // 每一侧最近一份规划写的（关系那一行的"眼下"）也照样过一遍
    return out;
}

// 一块里的几行逐行过：fix(行, 第几行) 返回改过的这一行，null＝拿掉；标题后面跟着"· "、缩进的几行，底下一行都不剩的标题也拿掉
const CHILD = /^\s+\S|^·/;
export function trimLines(lines, fix) {
    if (!Array.isArray(lines) || !lines.length) return lines ?? [];
    const out = [];
    let head = null, kids = [], had = 0;
    const flush = () => {
        if (head != null) { if (had ? kids.length : head.line != null) out.push(...(head.line != null ? [head.line] : []), ...kids); }
        else out.push(...kids);
        head = null; kids = []; had = 0;
    };
    lines.forEach((l, i) => {
        const fixed = fix(String(l), i);
        if (CHILD.test(String(l))) { had++; if (fixed != null) kids.push(fixed); return; }
        flush();
        head = { line: fixed };
    });
    flush();
    return out;
}
// 说她伤病的那几行整行拿掉
export const dropLines = (lines, hers) => trimLines(lines, l => (hers(l) ? null : l));

// 他心里带着的、离开那几天推出来的（余波、回来那一段）：是转述，句子里常不写她的名字（"药还没送来"）。
// 说到伤病的那一截，写明是他自己的（他、自己、他的名字）就照留，别的都当是她的
export function derivedHers(seg, { userName = null, aliases = [], speaker = null } = {}) {
    if (!bodyTalk(seg)) return false;
    if (aboutHer(seg, { userName, aliases }) || /她/.test(seg)) return true;
    return !(/他|自己/.test(seg) || (!!speaker && String(seg).includes(speaker)));
}
// 按最外层的逗号、分号切开（括号、引号里的不切）
const OPEN = '（(「“『', CLOSE = '）)」”』';
function splitTop(text) {
    const out = [];
    let depth = 0, cur = '';
    for (const ch of String(text)) {
        if (OPEN.includes(ch)) depth++;
        else if (CLOSE.includes(ch)) depth = Math.max(0, depth - 1);
        if (!depth && '，,；;'.includes(ch)) { out.push({ seg: cur, sep: ch }); cur = ''; continue; }
        cur += ch;
    }
    out.push({ seg: cur, sep: '' });
    return out;
}
// 行首的标签（"以为：""还没收尾的：""这些天他做过的（……）："）：最外层第一个冒号之前、中间没有逗号句号的那一截
function labelOf(text) {
    let depth = 0;
    const s = [...String(text)];
    for (let i = 0; i < s.length && i < 48; i++) {
        const ch = s[i];
        if (OPEN.includes(ch)) depth++;
        else if (CLOSE.includes(ch)) depth = Math.max(0, depth - 1);
        else if (!depth && '，,；;。'.includes(ch)) return '';
        else if (!depth && '：:'.includes(ch)) return s.slice(0, i + 1).join('');
    }
    return '';
}
// 一行里按逗号、分号切开，去掉 hers 的那几截（他自己的心事、别的内容照留）；行首的"· "、整行的括号、标签留着。
// 什么都没切返回原样；切完什么都不剩（或标签本身就在说她的伤病）返回 null
export function cutLine(line, hers) {
    const text = String(line ?? '');
    const lead = /^\s*(?:·\s*)?/.exec(text)[0];
    let rest = text.slice(lead.length), open = '', close = '';
    if (/^[（(]/.test(rest) && /[）)]$/.test(rest)) { open = rest[0]; close = rest.at(-1); rest = rest.slice(1, -1); }
    const label = labelOf(rest);
    const parts = splitTop(rest.slice(label.length));
    const kept = parts.filter(p => !(p.seg.trim() && hers(p.seg)));
    if (kept.length === parts.length) return text;
    if (label && hers(label)) return null;
    const body = kept.map(p => p.seg + p.sep).join('').replace(/^[，,；;\s]+|[，,；;\s]+$/g, '');
    return body ? `${lead}${open}${label}${body}${close}` : null;
}

// 那一句（放在那几块之后，一格只加一次）
// soft：预设里开着"收着点"（老模型——一关心就下指令、拿她的样子开涮，要写明平辈、商量的口气）；关着（新模型本来就偏软，
// 再写"心疼、陪着、问她要什么"只会更围着她转）就只说照她写的来、照常相处（用户 10/14："用老模型就开，用新模型就关"）
export function bodyNote(gate, userName, { soft = true, setup = null } = {}) {
    if (!userName || !gate) return null;
    if (gate.mode === 'open' && !soft) return `（${userName}的身子照${playerWord({ setup, name: userName })}自己最近写的来：「${gate.said}」。照常相处，不用围着它转。）`;
    // 用户 10/13："每个人对user的伤病都是一副带着命令的语气，照顾和关心不是下指令让对方服从吧"——前台把"护着""陪着"写成了
    // "滚回屋扎针""我就在门口坐半小时，没动静就踹门"。写明是平辈同伴：她的身子她自己拿主意；关心落在问、递、陪、挡事上，用商量的口气
    if (gate.mode === 'open') return `（${userName}的身子照${playerWord({ setup, name: userName })}自己最近写的来：「${gate.said}」。${playerWord({ setup, name: userName })}是和你平起平坐的同伴，自己的身子自己拿主意。心疼、自责都行，嘴上一句就够；关心落在手上：问${playerWord({ setup, name: userName })}要什么、把东西递过去、陪着、替${playerWord({ setup, name: userName })}把外头的事挡掉。跟${playerWord({ setup, name: userName })}说这些用商量、提议的口气（"要不要……""我去……"），不对${playerWord({ setup, name: userName })}下指令、不给${playerWord({ setup, name: userName })}定时限、不替${playerWord({ setup, name: userName })}安排怎么养；别数落${playerWord({ setup, name: userName })}、别拿${playerWord({ setup, name: userName })}的样子开涮、别说${playerWord({ setup, name: userName })}弱。）`;
    if (gate.mode === 'healed') return `（${userName}自己说已经好了，就按好了写，别再追问、别再叮嘱。）`;
    return null;
}

// 一格的守门：gate＝bodyGate 的结果；records＝这个窗口看得见的记录；notes＝此刻的样子（foldState 过的）；knows(r)＝开口的人知不知道这条；
// derived＝他心里带着的余波、回来那一段（[{ key, pos, text }]，key 是 c:余波的 key、a:离开编号:第几行）；speaker＝开口的人的名字。
// open 时：他知道的、说她伤病的记录、此刻的样子里她的身体、余波和回来那一段里说她伤病的，合起来按先后只留最新的 OPEN_MAX 条
// （同一时候的几条，切完一点不剩的先留——切了还剩别的内容的，切掉那一截照样读得通）；没留下的余波、回来那一段切掉说她伤病的那一截。
// 成句的那几块（口袋、来联系、兴头、关系后半句）是转述、是规划排的，不算她自己写的，一律不给。
// closed、healed：一条不给（余波、回来那一段切掉那一截，其余照留）。没有玩家（新窗口头一句还没同步）就什么都不动。
export const OPEN_MAX = 2;
export function bodyGuard({ setup = null, gate = null, userName = null, aliases = [], same = (a, b) => a === b, records = [], notes = [], knows = () => true, towardHer = () => false, derived = [], speaker = null } = {}) {
    if (!gate || !userName) return { mode: 'off', said: '', keep: () => true, keepNote: () => true, lines: arr => arr, hidesItem: () => false, relations: c => c, carry: c => c, away: arr => arr, note: () => null };
    const ctx = { userName, aliases, same };
    const dctx = { userName, aliases, speaker };
    const memo = new Map();
    const hersR = r => { if (r?.id == null) return herBodyRecord(r, ctx); if (!memo.has(r.id)) memo.set(r.id, herBodyRecord(r, ctx)); return memo.get(r.id); };
    const hersN = n => herBodyNote(n, ctx);
    const hersD = seg => derivedHers(seg, dctx);
    const noteKey = n => `n:${n.id ?? `${n.pos}:${n.who}:${n.aspect}`}`;
    let allowed = new Set();
    if (gate.mode === 'open') {
        const pool = [...records.filter(r => hersR(r) && knows(r)).map(r => ({ key: `r:${r.id}`, pos: r.pos ?? -Infinity, gone: 1, id: r.id ?? 0 })),
            ...notes.filter(hersN).map(n => ({ key: noteKey(n), pos: n.pos ?? -Infinity, gone: 1, id: n.id ?? 0 })),
            ...derived.map((d, i) => ({ ...d, cut: cutLine(d.text, hersD), i })).filter(d => d.cut !== String(d.text ?? ''))
                .map(d => ({ key: d.key, pos: d.pos ?? -Infinity, gone: d.cut == null ? 1 : 0, id: -d.i }))];
        const seen = new Set();
        allowed = new Set(pool.sort((a, b) => b.pos - a.pos || b.gone - a.gone || b.id - a.id).filter(x => !seen.has(x.key) && seen.add(x.key)).slice(0, OPEN_MAX).map(x => x.key));
    }
    return {
        mode: gate.mode, said: gate.said,
        keep: r => !hersR(r) || allowed.has(`r:${r.id}`),
        keepNote: n => !hersN(n) || allowed.has(noteKey(n)),
        lines: arr => dropLines(arr, l => herBodyLine(l, ctx)),
        hidesItem: m => herBodyItem(m, ctx),
        relations: current => cutRelations(current, { userName, aliases, towardHer }),
        // 一条余波（mood.carryParts 的 cut）：留下的照旧，没留下的切掉那一截，整条都是就不给
        carry: c => {
            if (!c?.text || allowed.has(`c:${c.key}`)) return c;
            const text = cutLine(c.text, hersD);
            return text === c.text ? c : text ? { ...c, text } : null;
        },
        // 回来那一段的几行：id＝那次离开的编号（行号和 derived 里的 a:编号:第几行 对上）；没编号的（回来那几句通用的）只切不留
        away: (arr, id = null) => trimLines(arr, (l, i) => (id != null && allowed.has(`a:${id}:${i}`) ? l : cutLine(l, hersD))),
        note: opts => bodyNote(gate, userName, { setup, ...opts }),
    };
}

// 不在场的人结算出来"要联系"（main.settleAway）：来意是问她身子的（说到伤病，又是冲着她来的），而她最近没在说身子（gate 不是 open）——
// 照"刚分开没多久先按下"的做法：记成他心里惦记的，不挂门上（她没提，没人会专为问一句身子上门）
export function bodyAsk(text, { userName = null, aliases = [] } = {}) {
    const t = String(text ?? '');
    return bodyTalk(t) && (aboutHer(t, { userName, aliases }) || /[你她]/.test(t));
}
export function holdBodyContact({ contact = null, gate = null, userName = null, aliases = [] } = {}) {
    return !!contact && !!contact.way && contact.way !== '不' && gate?.mode !== 'open' && bodyAsk(contact.text, { userName, aliases });
}
export function heldContactText({ who, way = '消息', userName = '对方', gate = null }) {
    const verb = way === '上门' ? '过去一趟' : way === '电话' ? '打个电话' : '发条消息';
    return `${who}想过要${verb}问问${userName}身子怎样，${gate?.mode === 'healed' ? `${userName}自己说已经好了` : `${userName}这阵子自己没提`}，就没去打扰`;
}

// 她眼下有难处（用户 10/12，N-363：她受了伤，同伴是心疼、护着，主动去找能让她好起来的办法——找药、找人、把外头的事挡掉；
// 光嘴上关心、手上照料就成了保姆）：她自己最近几条提了身子（gate 是 open），或者此刻的样子里她身上记着伤病那一笔（说的是伤病、不是"好了"）。
// 她说已经好了（healed）就不算。主角团各人那一格据此多给一句"会为她做什么——去做，别光说"（slot.crewLines）
export function herTrouble({ gate = null, notes = [], userName = null, aliases = [], same = (a, b) => a === b } = {}) {
    if (!userName || gate?.mode === 'healed') return false;
    if (gate?.mode === 'open') return true;
    return (notes ?? []).some(n => herBodyNote(n, { userName, aliases, same }) && bodyTalk(n.text) && !healedSaid(n.text));
}
