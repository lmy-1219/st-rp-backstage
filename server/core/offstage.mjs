import { personWord, renderPronouns } from './pronoun.mjs';
// 镜头外的人也在这个世界里（用户 10/8）：
// ① 别处交代了他的事（他不在场，别人——角色、旁白——说出了他这些年在哪、做了什么），那就是正史，他自己知道（"最近和某人的剧情里提到过
//    某方的行踪……应该记为正史并让该角色知道自己发生了什么，不然就会变成前者是编的，前后对不上"）。玩家说的不算（玩家可以撒谎）；
//    猜的、编的、心里想的、将来会怎样的不算。
// ② 东西、话、钱经别人的手送到不在场的人那儿（记账标的"到谁手上"），他那边就收到了：记成他碰上的一件事（matters），这几天他开口都带着
//    （"我让中介替我置办了东西送到他那去，我得主动拉他进来复述一遍……否则他可能就不知道"）。
// ③ 在场的人隔着消息、电话问不在场的人（"给某某发了条消息问……"）：后台替那个人照他知道的回一句，问和答两边都知道
//    （"我跟他撒了谎，扭曲了某人的原话，那么他其实可以自己和某人求证，并双方都对此求证过程知情"）。
// 题材无关：人名都来自名册和聊天。
import { hasCard, callsFor } from './arrival.mjs';
import { sameName } from './setup.mjs';
import { personOf } from './relations.mjs';
import { rankByOverlap } from './recall.mjs';

const CAMERA_NAME = '旁白';
export const TOLD_LINK = '交代';   // 替他记的那条接着原来那条：原来那条删了、改了，看得见的链接跟着没了
const FACT_TYPES = new Set(['说', '做', '改变']);
const clip = (s, n) => String(s ?? '').trim().slice(0, n);
const tidy = t => String(t ?? '').trim().replace(/[。．.；;，,]+$/, '');

// 名册里有卡的人（镜头那张卡不算）
export const cardedOf = (roster = []) => roster.filter(e => hasCard(e) && e.name !== CAMERA_NAME);

// "关于谁"写的是一方、一伙（不是人名）：关系表里"现在""跟着""地盘"写着它的人就是它的人
export function membersOf(rel, about, roster = []) {
    const a = String(about ?? '').trim();
    if (!rel?.人 || a.length < 2) return [];
    return rel.人.filter(p => [p.现在, p.跟着, p.地盘, ...(p.又名 ?? [])].some(f => f && String(f).includes(a))).map(p => p.名);
}

// 去掉开头的"某某说／报告／对某某说："——记成他自己的事时，谁说的他不知道，也不该知道（说的人在记录里可能用的是别名，不按名字认）
const SAID = /^[^，。：:；！？]{1,12}?(?:对[^，。：:]{1,8})?(?:说起|说|称|报告|讲|答|补充|提到|交代|透露|确认|告诉[^：:，,]{0,8})[：:，,]?\s*/;
export function ownWords(text) {
    const t = String(text ?? '');
    const out = t.replace(SAID, '');
    return out.length >= 6 && !/^[的了着地得]/.test(out) ? out : t;
}
// 看法、推断、修辞不是他的事（"以他的脾气，要是……就会……""查的是……不是找……"）：只收事情本身
const OPINION = /脾气|性子|要是[^，。]{0,14}(?:就|准|会)|准会|肯定|多半|想必|无非|其实|不过是|说白了|图的是|查的是|为的是|不是为了|不是找|心思|会不会|怕是|不管[^，。]{0,18}(?:还是|都)|在[^，。]{0,6}眼里|看来|算是|等于/;

// ① 别处交代的他自己的事。visible：这个窗口看得见的记录；since：上回看到的最大记录号；player：玩家的几个叫法；
// rel：关系表（规整过的）；roster：名册。返回要补的记录（调用方落账）。
export function offstageFacts({ visible = [], since = 0, roster = [], rel = null, player = [], userName = null } = {}) {
    // 只给不常在场的人：主要角色几乎场场都在，别人说起他的多半是看法、当面的话，记给他等于让他听见了别人背后怎么说他（用户 10/8）
    const carded = cardedOf(roster).filter(e => e.role !== '主要');
    const names = roster.map(e => e.name);
    const isPlayer = n => !!n && [userName, ...player].filter(Boolean).some(p => sameName(p, n, names));
    const out = [];
    for (const r of visible) {
        // 只收会一直算数的事本身（记账标了"长"）：他在哪、做了什么、发生在他身上的；看法、修辞、一时的小事不算
        if (!(r.id > since) || r.job_id == null || !FACT_TYPES.has(r.type) || !r.lasting || r.guess || r.fabricated || r.tense === '将来' || !r.about) continue;
        if (!r.holder_name || isPlayer(r.holder_name) || OPINION.test(r.text)) continue;
        const direct = carded.filter(e => sameName(e.name, r.about, names));
        const party = direct.length ? [] : membersOf(rel, r.about, names).map(n => carded.find(e => sameName(e.name, n, names))).filter(Boolean);
        for (const e of [...direct, ...party]) {
            if (sameName(e.name, r.holder_name, names) || (r.audience ?? []).some(a => sameName(a, e.name, names))) continue;
            // 内容里得点到他（或他那一伙）的名：关于谁填串了的不收
            const called = [e.name, ...(direct.length ? [] : [r.about]), ...(personOf(rel, e.name, names)?.又名 ?? [])].filter(Boolean);
            if (!called.some(n => String(r.text).includes(n))) continue;
            const body = tidy(ownWords(r.text));
            if (!body) continue;
            out.push({ source: r.id, fp: r.fp, type: '做', text: `${e.name}自己的事（别处交代的，${personWord(e.name)}自己知道）：${body}`.slice(0, 200), holder: e.avatar, holderName: e.name, audience: [e.name], about: e.name, keys: r.keys ?? [], links: [{ to: r.id, kind: TOLD_LINK }] });
        }
    }
    return out;
}

// ② 送到他那儿的：记成他碰上的一件事（只他知道，这几天他开口都带着，有了着落记账"了结"）
// 托人转告、带话的：话还在转告的人手上，不算送到（等转告的那条再说）
const RELAY = /转告|带话|带句话|捎句话|捎话|传话|替[^，。]{0,6}告诉|让[^，。]{0,8}告诉|帮[^，。]{0,6}问/;
export function reachDeliveries({ visible = [], since = 0, roster = [] } = {}) {
    const carded = cardedOf(roster);
    const names = roster.map(e => e.name);
    const out = [];
    for (const r of visible) {
        if (!(r.id > since) || !r.reach || RELAY.test(r.text)) continue;
        const e = carded.find(x => sameName(x.name, r.reach, names));
        if (!e || sameName(e.name, r.holder_name, names) || (r.audience ?? []).some(a => sameName(a, e.name, names))) continue;
        out.push({ source: r.id, fp: r.fp, type: '做', text: `${e.name}这边收到了（送到${personWord(e.name)}那儿、带给${personWord(e.name)}的）：${tidy(r.text)}`.slice(0, 220), holder: e.avatar, holderName: e.name, audience: [e.name], about: e.name, keys: r.keys ?? [],
            matter: { kind: '收到', title: clip(tidy(r.text), 24), entry: '镜头外', who: e.name }, links: [{ to: r.id, kind: TOLD_LINK }] });
    }
    return out;
}

// ③ 在场的有卡的人隔着消息、电话问不在场的有卡的人。messages：最近几条（已经看过的不算）；absent(name)：他这会儿不在场（场面表）
// 叙述（括号里）点了那个人的名，又写着发消息、打电话、联系、问他；他说出口的话（括号外）就是问的内容，没有就取那一段叙述
const CONTACT = /联系|拨通|拨给|打给|发给|发了?条|发过去|问[一了]?问|求证|核实|回了?条|回电|回信|转告|捎话|留言|告诉/;
export function asksAway(messages = [], { roster = [], absent = () => false, userName = null, player = [] } = {}) {
    const carded = cardedOf(roster);
    const names = roster.map(e => e.name);
    const isPlayer = n => !!n && [userName, ...player].filter(Boolean).some(p => sameName(p, n, names));
    const out = [];
    for (const m of messages) {
        if (m.is_user || !m.name || isPlayer(m.name) || m.name === CAMERA_NAME || m.speaker === 'narrator') continue;
        const asker = carded.find(e => sameName(e.name, m.name, names));
        if (!asker) continue;
        const text = String(m.text ?? '');
        const blocks = text.match(/（[^）]*）|\([^)]*\)/g) ?? [];
        const spoken = tidy(text.replace(/（[^）]*）|\([^)]*\)/g, ' ').replace(/<#[0-9.]+#>|\([a-z ]+\)/g, ' ').replace(/\s+/g, ' '));
        for (const e of carded) {
            if (e === asker || !absent(e.name)) continue;
            const block = blocks.find(b => b.includes(e.name) && (callsFor(b, [e.name]) || CONTACT.test(b)));
            if (!block) continue;
            const way = callsFor(block, [e.name]) === '打来电话' || /电话|拨|打给|语音/.test(block) ? '电话' : '消息';
            const asked = (spoken || tidy(block.slice(1, -1))).slice(0, 300);
            if (asked.length < 2) continue;
            out.push({ pos: m.pos, fp: m.fp, asker: asker.name, askerAvatar: asker.avatar, target: e.name, targetAvatar: e.avatar, way, text: asked, block: tidy(block.slice(1, -1)).slice(0, 200) });
        }
    }
    return out;
}

// 替不在场的人回一句：给他自己知道的（他名下、他在场听过的记录里和这句最沾边的），他和问的人的关系，读卡写的习惯
export const ASK_SYSTEM = [
    "一部长篇角色扮演里，有个角色这会儿不在镜头里；镜头里的另一个人隔着消息或电话问了〔当事人〕一句。你替不在镜头里的这个人回一句，像〔当事人〕本人会回的那样。",
    "只照【〔当事人〕知道的】来：知道的照实说（怎么说、说多少照〔当事人〕的性子和〔当事人〕跟问的人的关系）；不知道的就说不知道、反问或者不接；问的人说的和〔当事人〕知道的对不上，照〔当事人〕知道的说，可以指出来。别替〔当事人〕编新的事、新的人。",
    "发消息的回一两行字；电话里的回一两句话。只输出一个 JSON：{\"回\": \"〔当事人〕回的话（照〔当事人〕的口吻，第一人称）\", \"顺便\": \"〔当事人〕顺手告诉对方的一件〔当事人〕知道、对方多半想知道的事，一句；没有就空\"}",
].join('\n');
export function askPrompt({ asker, target, way, text, tie = '', profile = '', known = [], where = '' }) {
    return [
        `【不在镜头里的人】${target}${where ? `（这会儿${where}）` : ''}`,
        `【问${personWord(target)}的人】${asker}（${way === '电话' ? '打电话' : '发消息'}问的）`,
        tie ? `【${target}和${asker}】${tie}` : '',
        profile ? `【${target}的习惯】${profile.slice(0, 400)}` : '',
        '', renderPronouns("【〔当事人〕知道的】（〔当事人〕自己说过、做过、在场听过的）", { person: target }), ...(known.length ? known.map(k => `· ${k}`) : ['（没有记下的）']),
        '', `【${asker}问的】`, text,
    ].filter(l => l !== '').join('\n');
}
export function parseAsk(text) {
    const s = String(text ?? '');
    const a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a < 0 || b <= a) return null;
    try {
        const v = JSON.parse(s.slice(a, b + 1));
        const reply = clip(v['回'], 400), aside = clip(v['顺便'], 200);
        return reply ? { reply, aside } : null;
    } catch { return null; }
}
// 他知道的里和这句最沾边的几条（按字面、检索词），加上最近的几条
export function knownFor(visible, { name, text, roster = [], when = () => '' , max = 10 }) {
    const names = roster.map(e => e.name);
    const mine = visible.filter(r => !['时间', '了结'].includes(r.type) && (sameName(r.holder_name, name, names) || (r.audience ?? []).some(a => sameName(a, name, names)))).map(r => ({ ...r, quotes: r.quotes ?? [], keys: r.keys ?? [] }));
    const hit = rankByOverlap(mine, text).filter(x => x.score > 0).slice(0, max).map(x => x.r);
    const recent = mine.slice(-4);
    return [...new Set([...hit, ...recent])].sort((a, b) => a.pos - b.pos).map(r => `${when(r)}${when(r) ? '：' : ''}${r.text}`);
}

// 问和答记成两条（挂在问的那条消息上）：问的人、被问的人都知道
export function exchangeRecords({ ask, reply, aside = '' }) {
    const q = { fp: ask.fp, type: '说', text: `${ask.asker}（${ask.way}）问${ask.target}：${ask.text}`.slice(0, 200), holder: ask.askerAvatar, holderName: ask.asker, audience: [ask.asker, ask.target], about: ask.target, keys: [] };
    const a = { fp: ask.fp, type: '说', text: `${ask.target}（${ask.way}）回${ask.asker}：${reply}${aside ? `；顺便说：${aside}` : ''}`.slice(0, 200), holder: ask.targetAvatar, holderName: ask.target, audience: [ask.target, ask.asker], about: null, keys: [] };
    return [q, a];
}

// 问的人下一回开口时那一行（只给一回；他那条删了就没有）
export function replyLines(r, { name }) {
    if (!r?.reply || !r?.target) return [];
    return [`（${r.target}回了${name}${r.way === '电话' ? '电话里' : '发过去的消息'}问的那句：「${tidy(r.reply)}」${r.aside ? `，顺便说：${tidy(r.aside)}` : ''}——这段来往只有${name}和${r.target}知道；信不信、提不提、怎么用由${name}。）`];
}

