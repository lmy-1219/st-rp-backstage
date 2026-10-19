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

// 用户这阵只回一两个字，不只是"没有新话头"（用户 9/29）：可能是心满意足、累了、懒得说，也可能是在敷衍、在躲、在赌气、在冷战。
// 他在场就不能当没看见——让他照前面发生的事读这个变化，按他的性子接（担心地追问、试探，冒火、解释、无奈、嬉皮笑脸地哄、真哄，或者也闷着：赌气也是反应）；
// 是哪一种不替他定。程序只点出"连着几句都这样""刚才还有来有往"。上一段演过的别再演一遍（B 段实测会整段重演）。
// 这一条的范围（用户 10/2，横向生长）：模型闲下来就推剧情——起身、出门、换地方。给它一个能照做的边界，比"不用急"管用：
// 只写眼前这几分钟，停在对方能接的地方；对方没动，场面不挪、时间不跳。肯定句，不写"别急"。
export function scopeLine({ userName = '对方' } = {}) {
    return `（这一条只写眼前这几分钟，写到别人能接话的地方就停。${userName}没起身、没说走，就别替${userName}起身、换地方、跳时间；你自己想换地方、想往后走，可以开口提，跟不跟由${userName}。横着把这一刻过完也是戏：聊、问、收拾、手上的事。）`;
}

export function onwardLine({ messages, speaker, name, userName = '对方', soft = true }) {
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
    return `（${userName}${streak >= 2 ? '这阵连着几句都只回一两个字' : '这句只回了一两个字'}${changed ? '，刚才还有来有往' : ''}。${name}在场，会注意到：可能是心满意足、累了、懒得说，也可能是在敷衍、在躲、在赌气——前面发生过什么，${personWord(name)}心里多半有数。照${personWord(name)}读到的和${personWord(name)}的性子接：${soft ? '担心地追问、试探一句（是不是累了、不舒服、不高兴）、冒火、解释两句、无奈、嬉皮笑脸地哄、真哄，或者也闷着不理（赌气也是一种反应）' : '问一句、刺一句、冒火、无奈、自顾自干手上的事，或者也闷着不理（赌气也是一种反应），不用哄'}，别当没看见。上一段演过的不用再演一遍${end ? `，从停下的地方（"${end}"）接` : ''}。）`;
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
    return `（${name}上一段问了${w}话，可${w}不在这儿、开不了口，等不来回答：想知道的自己去看、去查，或者先搁下，别一轮轮追着问。）`;
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
        parts.push(`${said}，${name}都看见听见了，是眼前最近的事。可以接这一条——冲${personWord(other.speaker === 'narrator' ? '里面的人' : base(other.name) || '别人')}去、答${personWord(other.speaker === 'narrator' ? '里面的人' : base(other.name) || '别人')}、顶${personWord(other.speaker === 'narrator' ? '里面的人' : base(other.name) || '别人')}、顺着${personWord(other.speaker === 'narrator' ? '里面的人' : base(other.name) || '别人')}往下说——也可以接${name}更在意的别的；不用每条都冲着${userName}说`);
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
    const ask = [
        ways?.length || shape ? `这一条挑前几条没用过的${ways?.length ? (shape ? '开口、收尾、比喻、动作，长短和分段也换一换' : '开口、收尾、比喻和动作来写') : '长短、分段、开头和收尾'}` : '',
        ways?.length ? `这些意思${personWord(name)}已经说过好几回，${userName}听见了，这一条接眼前新的事` : '',
        echo ? `抓${personWord(name)}最在意的那一点直接说，不用先复述，也不用一条条都回` : '',
    ].filter(Boolean);
    return `（${parts.join('；')}。${ask.join('；')}。）`;
}

