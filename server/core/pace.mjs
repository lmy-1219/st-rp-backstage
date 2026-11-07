import { personWord } from './pronoun.mjs';
// 往下接（质量窗，B 段交过来的前台复读）：
// - 用户只应一声（"嗯""好""（点头）"），前台没有新话头可接，就回头把用户上一回正经说的那句再答一遍，
//   实测连着三段几乎一字不差地重演"你伸懒腰—我按住你的背—去海边？等你拆了钉子老子给你当司机"。
//   这时给开口的人一句：从他上一段停下的地方往下走（接续点给他上一段的末尾），做下一件事、说下一句话，或者让时间往前走一点。
// - 他上一段问了一个不在场、开不了口的人话（不在这个群里），前台会一轮轮追问、干等。给一句：那人接不了话，别等他答。
// 都是程序判断，不调模型。题材词不进来（D-37）：名字来自名册。
import { bodyTalk, aboutHer } from './body.mjs';

const TAGS = /<#[0-9.]+#>|\([A-Za-z][A-Za-z ]{0,24}\)/g;
const plain = s => String(s ?? '').replace(TAGS, '').trim();
const ACK = 14;   // 去掉标点空白后不超过这么多字，算"只应了一声"

// 用户这句是不是只应了一声：很短，或者只有一个括号动作。
export function acknowledgement(text) {
    const t = plain(text);
    const bare = t.replace(/[\s，。！？、…—～~,.!?「」“”"'：；]/g, '');
    if (!bare) return true;
    if (bare.length <= ACK) return true;
    return /^[（(][^）)]{0,20}[）)]$/.test(t);   // 整句只是一个短的括号动作
}

// 他上一段的末尾（接续点）：最后一句像样的话或动作，至多 40 字。
function tail(text) {
    const lines = plain(text).split('\n').map(l => l.trim()).filter(l => /[一-鿿]/.test(l));
    const last = lines.at(-1) ?? '';
    return last.length > 40 ? `……${last.slice(-40)}` : last;
}

// 用户这阵只回一两个字：程序点出连续短回复和刚才是否有来有往，提醒从上次停点接续；怎样回应由角色与当下情境决定。
// 这一条的范围（用户 10/2，横向生长）：模型闲下来就推剧情——起身、出门、换地方。给它一个能照做的边界，比"不用急"管用：
// 只写眼前这几分钟，停在对方能接的地方；对方没动，场面不挪、时间不跳。肯定句，不写"别急"。
export function scopeLine({ userName = '对方' } = {}) {
    return `（这一条只写眼前这几分钟，写到别人能接话的地方就停。${userName}没起身、没说走，就别替${userName}起身、换地方、跳时间；你自己想换地方、想往后走，可以开口提，跟不跟由${userName}。）`;
}

export function onwardLine({ messages, speaker, name, userName = '对方' }) {
    const last = messages.at(-1);
    if (!last?.is_user || !acknowledgement(last.text)) return null;
    const mine = [...messages].reverse().find(m => !m.is_user && m.speaker === speaker);
    if (!mine) return null;
    // 他上一段之后，用户只是应了几声，没有新话头
    const since = messages.filter(m => m.pos > mine.pos && m.is_user);
    if (!since.every(m => acknowledgement(m.text))) return null;
    const users = messages.filter(m => m.is_user);
    let streak = 0;
    for (let i = users.length - 1; i >= 0 && acknowledgement(users[i].text); i--) streak++;
    const changed = users.slice(0, users.length - streak).slice(-2).some(m => plain(m.text).length > 20);
    const end = tail(mine.text);
    return `（${userName}${streak >= 2 ? '这阵连着几句都只回一两个字' : '这句只回了一两个字'}${changed ? '，刚才还有来有往' : ''}。上一段演过的不用再演一遍${end ? `，从停下的地方（"${end}"）接` : ''}；这一句怎样回应，照${name}的性格和眼前的情境。）`;
}

// 他上一段问了谁话（带问号的那句里点了名），那人不在场、接不了话。names＝名册里的名字；present＝在场、能开口的。
export function absentAskLine({ messages, speaker, name, names = [], present = [] }) {
    const mine = [...messages].reverse().find(m => !m.is_user && m.speaker === speaker);
    if (!mine) return null;
    const here = new Set(present.map(base));
    const asked = plain(mine.text).split(/(?<=[。！？!?\n])/).filter(s => /[？?]/.test(s));
    const who = names.filter(n => n && base(n) !== base(name) && !here.has(base(n)) && asked.some(s => s.includes(base(n))));
    if (!who.length) return null;
    const w = who.map(base).filter((x, i, a) => a.indexOf(x) === i).join('、');
    return `（${name}上一段问了${w}话，可${w}不在这儿，本轮没有${w}的回答；接续时不用重复上一段的追问。）`;
}

const base = n => String(n ?? '').replace(/[（(][^）)]*[）)]\s*$/, '').trim();

// 群聊里同一句话之后第二、第三个开口的（白皮书 §5.7 W2.3 ④）：前面的人已经接了什么（他开头那一句），别再接同一处、别复述，
// 接他们没接到的，或者做他自己这会儿想做的事。只认玩家最近那句之后、别人的回复（实测：三个角色一人接一次同一句话，然后等玩家）。
// 上一条是别人的（用户 10/13："为什么所有的角色发言都是只对user进行了反应，就好像在他之前只有user说过话了一样"）：
// 群聊里别的角色的话在模型那头和它自己写过的同一边，它容易当成"自己刚写的"跳过去，只回玩家那句——点名上一条是谁的、说了什么，可以冲他去。
// 旁白那段里没卡的人说的、做的也算。
// remote：他是发消息、打电话来的（人不在这儿）——这屋里的话他听不见，不给这一句（用户 10/15：发消息来的人被告知"都看见听见了"，写成了人在屋里接话）
export function takenLine({ messages, speaker, name, userName = '对方', remote = false }) {
    if (remote) return null;
    let i = messages.length - 1;
    while (i >= 0 && !messages[i].is_user) i--;
    if (i < 0) return null;
    const seen = new Set();
    const before = messages.slice(i + 1).filter(m => !m.is_user && m.speaker !== speaker && m.speaker !== 'narrator' && !seen.has(m.speaker) && seen.add(m.speaker));
    const last = messages.at(-1);
    const other = last && !last.is_user && last.speaker !== speaker && plain(last.text).trim() ? last : null;
    if (!before.length && !other) return null;
    const head = m => {
        const first = (plain(m.text).split(/(?<=[。！？!?…\n])/).map(s => s.trim()).find(s => /[一-鿿]/.test(s)) ?? '').replace(/^[（(]/, '').replace(/[）)]$/, '');
        return first.length > 24 ? `${first.slice(0, 24)}……` : first;
    };
    const parts = [];
    if (other) {
        const said = other.speaker === 'narrator' ? `聊天里最新的一条是旁白写的场面（开头：「${head(other)}」）：里面的人说的、做的` : `聊天里最新的一条是${base(other.name) || '别人'}的（开头：「${head(other)}」）：${personWord(base(other.name) || '别人')}说的、做的`;
        parts.push(`${said}，${name}都看见听见了，是眼前最近的事。接哪一处由${name}，不用每条都冲着${userName}说`);
    }
    if (before.length) parts.push(`${userName}刚才那句，${before.map(m => `${base(m.name) || '别人'}${other === m ? '' : `（开头：「${head(m)}」）`}`).join('、')}已经接过了：别再接同一处、别复述${userName}的话`);
    return `（${parts.join('。')}。）`;
}

// 形状（收口计划 ③）：Gemini 不只抄词，也抄样子——每条一样长、一样分段、一样开头收尾（实测：括号里一段动作、一句台词，交替七八段，
// 开头先把对方刚做的复述一遍，收在一句台词上，台词前的语气标记也是同一个次序）。程序看他最近两条的样子，一个模子的就在那一格末尾点出来，
// 请这一条挑没用过的。只点他已经写成的样子，不给候选、不写句式（给了候选，下一个模子就是它）。
const CN = '零一二三四五六七八九十';
const cnNum = n => (n <= 10 ? CN[n] : n < 20 ? `十${CN[n - 10]}` : String(n));
const OPEN_ACTION = /^[（(*＊]/, OPEN_QUOTE = /^[“「『"]/;
const leadTag = p => /^\s*(?:<#[0-9.]+#>\s*)*\(([A-Za-z][A-Za-z ]{0,24})\)/.exec(p)?.[1]?.trim().toLowerCase() ?? null;
const cjkOf = s => String(s ?? '').match(/[一-鿿]/g) ?? [];

// 开头是不是把对方刚做的复述了一遍：第一段和对方那句（"我"换成"你"）有五个字以上连着一样。
function echoes(first, said) {
    const a = cjkOf(first).join(''), b = cjkOf(String(said ?? '').replace(/我/g, '你')).join('');
    if (a.length < 5 || b.length < 5) return false;
    for (let i = 0; i + 5 <= b.length; i++) if (a.includes(b.slice(i, i + 5))) return true;
    return false;
}

// 一条回复的样子：多长、分几段、动作和台词怎么排、怎么开头、怎么收尾、台词前的语气标记次序。
export function shapeOf(text, { said = '' } = {}) {
    const paras = String(text ?? '').split(/\n+/).map(p => p.trim()).filter(p => /[一-鿿A-Za-z]/.test(plain(p)));
    if (!paras.length) return null;
    const bracketed = paras.some(p => OPEN_ACTION.test(plain(p)));
    // 动作和旁白（N）、台词（D）：括号、星号里的是动作；引号开头的是台词；都不是的，看这条的写法——有括号动作的，剩下的是台词；否则是旁白
    const kinds = paras.map(p => { const t = plain(p); return OPEN_ACTION.test(t) ? 'N' : OPEN_QUOTE.test(t) ? 'D' : bracketed ? 'D' : 'N'; });
    const seq = kinds.filter((k, i) => k !== kinds[i - 1]).join('');
    const last = plain(paras.at(-1));
    return {
        len: paras.map(plain).join('').replace(/\s/g, '').length, paras: paras.length, seq, bracketed,
        open: kinds[0], echo: echoes(plain(paras[0]), said),
        close: kinds.at(-1), ask: /[？?][”」』"）)…。]*$/.test(last),
        tags: paras.map(leadTag).filter(Boolean),
    };
}

// 两条的样子哪几处一样。
export function sameShape(a, b) {
    if (!a || !b) return [];
    const same = [];
    if (Math.min(a.len, b.len) / Math.max(a.len, b.len) >= 0.75) same.push('len');
    const alternating = s => s.seq.length >= 4;
    if (a.seq === b.seq || (alternating(a) && alternating(b) && a.seq[0] === b.seq[0])) same.push('seq');
    if (a.open === b.open) same.push('open');
    if (a.close === b.close && a.ask === b.ask) same.push('close');
    if (a.tags.length >= 2 && a.tags.join() === b.tags.join()) same.push('tags');
    return same;
}

const MOLD = 3;   // 五处里至少这么多处一样，才算一个模子（先动作后台词、收在台词上，本来就常见，光这两处一样不算）

// 他最近两条回复（和各自回的那句）。返回这两条共同的样子，不是一个模子就 null。
export function moldOf({ messages, speaker }) {
    const mine = [];
    for (let i = messages.length - 1; i >= 0 && mine.length < 2; i--) {
        const m = messages[i];
        if (m.is_user || m.speaker !== speaker) continue;
        const said = [...messages.slice(0, i)].reverse().find(x => x.is_user)?.text ?? '';
        mine.push(shapeOf(m.text, { said }));
    }
    if (mine.length < 2 || mine.some(s => !s)) return null;
    const same = sameShape(mine[0], mine[1]);
    return same.length >= MOLD ? { same, a: mine[0], b: mine[1] } : null;
}

// 把共同的样子说成一句话（只说他写成了什么样）。
export function describeMold(mold, { userName = '对方' } = {}) {
    const { same, a, b } = mold;
    const act = a.bracketed ? '括号里的动作' : '旁白';
    const kind = k => (k === 'N' ? (a.bracketed ? '一段动作' : '一段旁白') : '一句台词');
    const parts = [];
    if (same.includes('len')) {
        const avg = (a.len + b.len) / 2;
        parts.push(avg >= 1000 ? '都在一千字以上' : avg >= 150 ? `都在${cnNum(Math.round(avg / 100))}百字上下` : '都只有短短几句');
    }
    if (same.includes('seq')) {
        const n = Math.round((a.paras + b.paras) / 2);
        parts.push(a.seq.length >= 4 ? `都是${act}和台词一段隔一段地交替，${cnNum(n)}段上下` : a.seq.length === 1 ? `都是一整块${a.seq === 'N' ? act : '台词'}` : `段落都是${[...a.seq].map(k => (k === 'N' ? '动作' : '台词')).join('、')}这么排`);
    }
    if (same.includes('open')) parts.push(a.echo && b.echo ? `开头都先把${userName}刚做的复述一遍` : `都用${kind(a.open)}开头`);
    if (same.includes('close')) parts.push(a.ask ? '都收在一句问话上' : `都收在${kind(a.close)}上`);
    if (same.includes('tags')) parts.push(`台词前的语气标记也是同一个次序（${a.tags.join('→')}）`);
    return parts.join('，');
}

// 复述开头（用户 9/29）：台词先把对方刚说的原话拎出来（"睡了一觉？""吓着我？"）再接，还一条条挨个回——真人回话抓的是自己最在意的那一点，
// 读者也看得懂这句在接哪儿。程序找：他台词里（动作段不算）每句开头那一小截，是对方这句说出口的话里原样有的（"我""你"对调也算）。
const cjkOnly = s => (String(s ?? '').match(/[一-鿿]/g) ?? []).join('');
const swapYouMe = s => String(s).replace(/[我你]/g, c => (c === '我' ? '你' : '我'));
export function echoOpenings(reply, said) {
    const spoken = String(said ?? '').replace(/[（(][^）)]*[）)]/g, '');
    const src = cjkOnly(spoken), swapped = cjkOnly(swapYouMe(spoken));
    const out = [];
    for (const para of String(reply ?? '').split(/\n+/)) {
        const t = plain(para);
        if (!t || OPEN_ACTION.test(t)) continue;
        for (const sent of t.split(/(?<=[。！？!?…])/)) {
            const head = sent.trim().split(/[，。！？!?…、；：\s]/)[0];
            const h = cjkOnly(head);
            if (h.length >= 2 && h.length <= 14 && (src.includes(h) || swapped.includes(h))) out.push(head);
            else if (nearEcho(h, sent, src)) out.push(head);
        }
    }
    return out;
}

// 换了几个字的复述也算（试玩 9/30：对方说"借我"，他回"借钱？"；说"去酒吧"，回"想去酒吧？"；说了没钱、要补货，回"至于钱……""至于补货的钱，……"）：
// 只有几个字的一句反问，或者"至于……"起头的那半句，里头的实字一半以上是对方这句里说过的。
// 带疑问词、带"吗"的（"怎么了？""饿了吗？"）是真在问，不算。
const LIGHT = new Set('想还就要你我他她的了吗呢吧啊呀么嘛又都也说是这那个');
const ASKS = /怎|什么|哪|谁|为何|多少|几|吗/;
function nearEcho(h, sent, src) {
    const topic = h.startsWith('至于');
    const shortAsk = h.length <= 8 && /^[^，。！？!?…]*[？?]+$/.test(String(sent).trim()) && !ASKS.test(h);
    if (!topic && !shortAsk) return false;
    const core = [...h.replace(/^至于/, '')].filter(c => !LIGHT.has(c));
    return core.length >= 1 && core.filter(c => src.includes(c)).length * 2 >= core.length;
}

// 台词一段开头就拿对方的话反问一句（"借钱？""嫌糙？"）、或者"至于……"拎起对方一个话头的：这一小截程序直接去掉，
// 这段剩下的话照旧；整段只有这一句的，整段去掉（用户 9/30 在自己的规则里也禁了"先反问、后调侃"）。
// 只动段首：段中间的交给去复读的模型换。返回去掉以后的正文，和去掉的那几截。
const LEAD = /^(\s*(?:(?:<#[0-9.]+#>|\([A-Za-z][A-Za-z ]{0,24}\))\s*)*)([\s\S]*)$/;
export function dropEchoHeads(reply, said) {
    const heads = [...new Set(echoOpenings(reply, said))].filter(h => cjkOnly(h).length <= 8).sort((a, b) => b.length - a.length);
    const dropped = [];
    if (!heads.length) return { text: String(reply ?? ''), dropped };
    const lines = String(reply ?? '').split('\n').map(line => {
        const [, lead, rest] = LEAD.exec(line);
        if (!rest || OPEN_ACTION.test(rest)) return line;
        for (const h of heads) {
            if (!rest.startsWith(h)) continue;
            const after = rest.slice(h.length);
            const mark = h.startsWith('至于') ? /^(……|…|[，。、：！？!?])?/.exec(after)[0] : /^[？?]+/.exec(after)?.[0];
            if (mark == null) continue;
            dropped.push(`${h}${mark}`);
            const tail = after.slice(mark.length).replace(/^\s*(?:<#[0-9.]+#>\s*)*/, '');
            return cjkOnly(tail) ? `${lead}${tail}` : null;
        }
        return line;
    });
    const text = lines.filter(l => l !== null).join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '');
    return { text, dropped };
}

// 他上一条台词里拿对方原话起头的（至多两处，给那一格点名用）。
export function lastEchoes({ messages, speaker }) {
    for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i];
        if (m.is_user || m.speaker !== speaker) continue;
        const said = [...messages.slice(0, i)].reverse().find(x => x.is_user)?.text ?? '';
        return echoOpenings(m.text, said).slice(0, 2);
    }
    return [];
}

// 一个人别一个话头刷屏（用户 10/12，方案 叙事节奏与防棘轮 第四节）：她一病，他每一条都拐回她的身子上（问疼不疼、叮嘱吃药、说她弱），
// 一轮比一轮重。他最近 last 条里有 min 条以上这样（一句里说到伤病，又说到她——名字、别名，或者冲她说的"你"），就算一再用的路数，
// 交给 varyLine 接上"这些意思他已经说过好几回，接眼前新的事"。动作和台词分开看（他揉自己的旧伤、转头问"你想吃什么"不算）
const turnsToHer = (text, ctx) => plain(text).split(/[。！？!?\n…]+|(?<=[）)」”])/).some(s => bodyTalk(s) && (aboutHer(s, ctx) || /你/.test(s)));
export function bodyHarping({ messages = [], speaker, userName = null, aliases = [], last = 3, min = 2 }) {
    if (!userName) return false;
    const mine = messages.filter(m => !m.is_user && m.speaker === speaker).slice(-last);
    return mine.filter(m => turnsToHer(m.text, { userName, aliases })).length >= min;
}

// 那一格末尾那一句：他一再用的路数（去复读点出来的）、最近两条的样子、上一条的复述开头，合成一句提醒。都没有就 null。
export function varyLine({ name, ways = [], mold = null, userName = '对方', echoes = [] }) {
    const shape = mold ? describeMold(mold, { userName }) : '';
    const echo = echoes.length ? `上一条的台词先把${userName}的原话拎出来再接（${echoes.map(e => `"${e}"`).join('、')}）` : '';
    if (!ways?.length && !shape && !echo) return null;
    const parts = [
        ways?.length && `${name}最近几条里一再用到的路数：${ways.join('；')}`,
        shape && `${ways?.length ? '最近两条的样子也是一个模子' : `${name}最近两条是一个模子`}：${shape}`,
        echo && (ways?.length || shape ? echo : `${name}${echo}`),
    ].filter(Boolean);
    return `（${parts.join('；')}。这一条接眼前的新内容，不必复现上一条的说法和结构。）`;
}

// 同一件过渡琐事／同一段交代一再重复（T078）：看该说话人最近 CHORE_WINDOW 条非玩家回复的台词段，
// 去掉名册人名、玩家名与别名后，至少 CHORE_MIN 条同时出现 >= CHORE_WORDS 个非通用 2～4 字词片（且非玩家当轮话题、非旧常词）。
export const CHORE_WINDOW = 4;
export const CHORE_MIN = 3;
export const CHORE_WORDS = 2;
export const CHORE_USUAL = 2;

const CHORE_FUNC = new Set('的了着得地又都就也还很来去下上出过起在是有这那个一把被给让和与或而且会要能可你我他她它们不没吗呢吧啊呀么从往向到里外中前后左右儿自只再先才更最却但虽因为所以如果只因已正曾将当比跟同及并光单全总刚偏硬早晚多半一二三四五六七八九十百千万两几半每各某另别啥谁哪怎何点声下回次个只条张片块双件套副口手眼头脚身脸心话事人地方时候样子您');
const CHORE_GENERIC = /^(?:今天|明天|昨天|昨晚|今晚|大清早|一会儿|咱俩|咱们|知道|看见|听见|看看|听说|打算|问题|东西|玩意|直接|顺手|干脆|彻底|已经|开始|动静|自己|什么|怎么|觉得|起来|出来|进来|出去|过来|过去|回去|下来|上来|下去|上去|地方|时候|姑娘|小子|混蛋|老子|家伙|神经|倒霉|垃圾|实在|确实|根本|干嘛|到底|反正|简直|居然|难道|偏偏|明明|差不多|不一定|指不定|说不定|保不准|保不齐|至于|关于|根据|建议|标准|常规|分钟|小时|意思|办法|规矩|消息|模样|脾气|力气|功夫|指望|现成)$/;

const spokenOf = s => plain(s).replace(/[（(][^）)]*[）)]/g, '');
function choreWordsOf(text, allNames) {
    let s = spokenOf(text);
    for (const n of allNames) {
        const b = base(n);
        if (b.length >= 2) s = s.replaceAll(b, ' ');
        for (const p of b.split(/[·\s]+/)) if (p.length >= 2) s = s.replaceAll(p, ' ');
    }
    // 词片 → 它在（抹掉人名后的）台词段里出现的起点们；折叠"互相重叠的词片"要用位置
    const out = new Map();
    for (const hit of s.matchAll(/[一-鿿]+/g)) {
        const seg = hit[0];
        for (let len = 2; len <= 4; len++) {
            for (let i = 0; i + len <= seg.length; i++) {
                const w = seg.slice(i, i + len);
                if ([...w].some(c => CHORE_FUNC.has(c)) || CHORE_GENERIC.test(w)) continue;
                if (!out.has(w)) out.set(w, []);
                out.get(w).push(hit.index + i);
            }
        }
    }
    return out;
}

// 两个词片在同一段文字里位置重叠（半开区间 [起, 起+长)）。紧挨着但不重叠的不折：真数据里"甲地乙地"这样连着说的是两件事（回放实测折相邻会丢掉生产局的真命中）
const touching = (aAt, aLen, bAt, bLen) => aAt < bAt + bLen && bAt < aAt + aLen;

export function choreLoop({ messages = [], speaker, names = [], userName = null, aliases = [], last = CHORE_WINDOW, min = CHORE_MIN, minWords = CHORE_WORDS, usual = CHORE_USUAL } = {}) {
    if (!speaker || speaker === 'narrator') return [];
    const allNames = [...names, userName, ...aliases].filter(Boolean);
    const allMine = messages.filter(m => !m?.is_user && m?.speaker === speaker);
    const win = allMine.slice(-last);
    if (win.length < min) return [];
    const older = usual >= 0 ? allMine.slice(0, -last).map(m => spokenOf(m.text)) : [];
    const firstPos = win[0].pos;
    const firstIdx = messages.indexOf(win[0]);
    const userSaid = messages.filter((m, idx) => m?.is_user && (firstPos != null && m.pos != null ? m.pos >= firstPos - 1 : idx >= Math.max(0, firstIdx - 1))).map(m => plain(m.text)).join(' ');
    const counts = new Map();
    const perMsg = [];
    for (const m of win) {
        const words = choreWordsOf(m.text, allNames);
        perMsg.push(words);
        for (const w of words.keys()) {
            if (userSaid.includes(w)) continue;
            if (usual >= 0 && older.filter(o => o.includes(w)).length > usual) continue;
            counts.set(w, (counts.get(w) ?? 0) + 1);
        }
    }
    const shared = [...counts.entries()].filter(([, c]) => c >= min).map(([w]) => w).sort((a, b) => b.length - a.length);
    // 同一段文字里位置重叠的词片是同一个词的不同切法（"管理员办公室"切出的"管理员办""理员办公"…），折成一个、只留最长的；
    // 要至少 minWords 个在原文里互不重叠的词片才算。
    const group = shared.map((_, i) => i);
    const root = i => { while (group[i] !== i) i = group[i] = group[group[i]]; return i; };
    for (const words of perMsg) {
        for (let a = 0; a < shared.length; a++) {
            const aAt = words.get(shared[a]);
            if (!aAt) continue;
            for (let b = a + 1; b < shared.length; b++) {
                const bAt = words.get(shared[b]);
                if (!bAt || !aAt.some(x => bAt.some(y => touching(x, shared[a].length, y, shared[b].length)))) continue;
                const ra = root(a), rb = root(b);
                if (ra !== rb) group[Math.max(ra, rb)] = Math.min(ra, rb);   // 小号（更长）的当组头
            }
        }
    }
    const heads = shared.filter((_, i) => root(i) === i);   // shared 已按长度降序，组里最先出现的就是最长的
    return heads.length >= minWords ? heads.slice(0, 4) : [];
}

// 连着劝玩家休息／回屋／躺下／别动（T078）
export const REST_WINDOW = 3;
export const REST_MIN = 2;
export const REST_RE = /(?:你|先|快|回去|赶紧|乖乖|好好|老实)?(?:回屋|回房|上床|躺下|躺着|歇着|歇会儿|歇会|歇一歇|去歇|去睡|去躺|去休息|休息|睡一觉|睡会儿|睡一会|睡吧|先睡|快睡|该睡|静养|养着|别熬夜|别累着|别动|别乱动|别乱跑|别下床|别起来)/;
// 单看不一定是劝人的词（"他歇着没事干""养着一条狗"）：只有这一句冲着玩家（你／玩家名）说才算；其余沿用 T078 原样不要求点名
const REST_WEAK = /歇着|养着|静养|该睡|睡一会|歇会(?!儿)|歇一歇|别累着|别熬夜/g;
const REST_NEG = /(?:不用|不必|别|不|没|未|省得|免得|哪能|怎么能)[^，。！？!?；;…\n]{0,4}(?:回屋|回房|上床|躺|歇|休息|睡|养)|别动不动|休息室|休息区/g;
// 玩家自己提了困累想睡：否定的（不用休息、不累、不困、没困）不算
const USER_TIRED_RE = /困|累|想睡|想歇|想躺|去睡|睡觉|上床|休息|歇会|躺会|晚安/g;
const USER_NOT = /(?:不用|不必|不要|不想|不需要|用不着|不|没|别|无需)[^，。！？!?；;…\n]{0,2}$/;
const userTired = text => {
    const t = plain(text);
    for (const m of t.matchAll(USER_TIRED_RE)) if (!USER_NOT.test(t.slice(Math.max(0, m.index - 4), m.index))) return true;
    return false;
};

// 说话人最近 last 条非玩家回复里，每条有没有一句冲玩家劝休息的；要最近的那条命中，并且和上一次命中的是他相邻的两条（中间隔着没命中的不算）
export function restHarping({ messages = [], speaker, userName = null, last = REST_WINDOW, min = REST_MIN } = {}) {
    if (!speaker || speaker === 'narrator') return false;
    const lastUser = [...messages].reverse().find(m => m?.is_user);
    if (lastUser && userTired(lastUser.text)) return false;
    const mine = messages.filter(m => !m?.is_user && m?.speaker === speaker).slice(-last);
    if (mine.length < min) return false;
    const isRest = s => {
        const c = String(s ?? '').replace(REST_NEG, ' ').trim();
        const aimed = /你/.test(c) || !!(userName && c.includes(userName));
        if (!REST_RE.test(c)) return false;
        // 只靠含糊词命中的，得冲着玩家说
        if (!aimed && !REST_RE.test(c.replace(REST_WEAK, ' '))) return false;
        if (/^(?:我|他|她|它)/.test(c) && !aimed) return false;
        return true;
    };
    const hit = mine.map(m => spokenOf(m.text).split(/[。！？!?\n…]+|(?<=[）)」”"])/).some(isRest));
    // 末尾连着的命中条数 >= min
    let run = 0;
    for (let i = hit.length - 1; i >= 0 && hit[i]; i--) run++;
    return run >= min;
}

export function choreLine({ name, userName = '对方', chores = [], rest = false } = {}) {
    if (!chores?.length && !rest) return null;
    const who = personWord(name);
    const what = [
        chores?.length && `围绕「${chores.slice(0, 4).join('、')}」这件过渡的小事${who}已经连着交代了好几回`,
        rest && `催${userName}回屋、躺下、休息或别动这番叮嘱${who}也已经反复说过`,
    ].filter(Boolean).join('；');
    return `（${what}：这件过渡的小事／这番叮嘱已经交代过了，这一条一笔带过（当作办完了、听见了），直接落到办完之后的一刻、接眼前新的事；${userName}没起身换地方，就还在原处往下接，别替${userName}跳时间、别替${userName}定去哪做什么。）`;
}


