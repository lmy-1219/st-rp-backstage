// 势力账（质量窗 Q-8 第一步）：势力之间、人和势力之间、两方之间的约定，按这一局发生的事一直记着。
// 复杂线（拉拢、渗透、策反、今天和甲谈交换、明天联合乙对付甲）只靠散在几百条记录里的事，
// 规划者隔几个节点就忘了谁和谁翻了脸；角色那一格里的长期约定也会像普通交代一样过期。
// 底子是素材包里的势力网（原作的，这一局可能早变了）；这一局的变化来自记账的三种记录：
//   协议——两方（人或势力）之间的交换或合作，到了哪一步；
//   归属——某人明面上是哪一方的、实际替谁做事；
//   立场——两个势力之间，外人看到的和实际的关系。
// 谁知道：每条记录的 audience（当时在场的人），加上约定的当事人、出面谈的人、归属说的那个人。
// 给角色的只用他知道的那些记录；给规划者的全给，并写明谁知道实情。
import fs from 'node:fs';

export const FACTION_TYPES = ['协议', '归属', '立场'];
export const DEAL_STAGES = ['谈着', '说定', '在办', '了了', '违约', '破裂'];
const CLOSED = new Set(['了了', '破裂']);
const knows = (r, name) => r.holder_name === name || (r.audience ?? []).includes(name);
const clip = (s, n) => String(s ?? '').trim().slice(0, n);
// 名字后面带的括号注释（"某某（某公司）"）去掉：同一个人、同一家前后写法对得上。
export const bareName = s => String(s ?? '').replace(/[（(][^）)]*[）)]/g, '').trim();

// 素材包里的势力网：{nodes:[{id,name,en,kind}], edges:[{from,to,type,period,note}]}；读不出来就当没有。
export function loadFactionNet(file) {
    try {
        const j = JSON.parse(fs.readFileSync(file, 'utf8'));
        return { nodes: Array.isArray(j.nodes) ? j.nodes : [], edges: Array.isArray(j.edges) ? j.edges : [] };
    } catch { return null; }
}

// 名字归一：势力网里的中英文名。"某帮成员""某公司总部"和"某帮""某公司"是一家时并到一起。
// 只认两个字以上的名字，取最长的那个对上（免得一个字的简称把别的都吞了）。
export function nameResolver(net = null) {
    const canon = new Map();
    for (const n of net?.nodes ?? []) for (const a of [n.name, n.en]) if (a && String(a).length >= 2) canon.set(String(a), n.name);
    const keys = [...canon.keys()].sort((a, b) => b.length - a.length);
    return s => {
        const t = bareName(s);
        if (!t) return '';
        if (canon.has(t)) return canon.get(t);
        const hit = keys.find(k => t.includes(k) && t.length - k.length <= 3);
        return hit ? canon.get(hit) : t;
    };
}

// 同一个人：一模一样，或者一个是另一个"名·姓"的名（"甲乙"对"甲乙·丙丁"）。只是包含不算（改名后的"乙"不是"甲 乙"）。
export const samePerson = (a, b) => !!a && !!b && (a === b || b.startsWith(`${a}·`) || a.startsWith(`${b}·`));

export const dealKey = (parties, title) => `${[...parties].sort().join('↔')}｜${String(title ?? '').trim()}`;

// 算账：records 是这一局看得见的记录（任意顺序）；view＝某人时只用他知道的。
// 返回 deals（同一笔按双方＋名目并起来，历程从早到晚）、allegiances（每人最新的一条）、stances（甲对乙最新的一条）。
export function factionLedger(records, { view = null, resolve = bareName, dayOf = null } = {}) {
    // 他知道：当时在场；或者他是约定的一方、出面谈的人；归属说的就是他。
    const isHim = n => samePerson(bareName(n), view);
    const his = r => knows(r, view) || (r.type === '协议' && [...(r.faction.parties ?? []), ...(r.faction.via ?? [])].some(isHim)) || (r.type === '归属' && isHim(r.faction.who));
    const rs = records.filter(r => FACTION_TYPES.includes(r.type) && r.faction && r.status !== 'rejected' && (!view || his(r))).sort((a, b) => a.pos - b.pos || a.id - b.id);
    const deals = new Map(), allegiances = new Map(), stances = new Map();
    const day = r => (dayOf ? dayOf(r.pos) : null);
    for (const r of rs) {
        const f = r.faction;
        if (r.type === '协议') {
            const parties = (f.parties ?? []).map(resolve).filter(Boolean);
            if (parties.length !== 2) continue;
            const key = dealKey(parties, f.title);
            const d = deals.get(key) ?? { key, parties: [...parties].sort(), title: f.title, history: [], via: new Set(), knownBy: new Set() };
            d.history.push({ stage: f.stage, text: r.text, pos: r.pos, id: r.id, day: day(r) });
            Object.assign(d, { stage: f.stage, text: r.text, pos: r.pos, id: r.id, day: day(r) });
            for (const v of f.via ?? []) d.via.add(bareName(v));
            // 当事的两方、出面谈的人自己当然知道（没有卡、不在群里的人也算）；再加上当时在场的人。
            for (const a of [...parties, ...d.via, r.holder_name, ...(r.audience ?? [])]) if (a) d.knownBy.add(a);
            deals.set(key, d);
        } else if (r.type === '归属') {
            const who = bareName(f.who);
            if (!who) continue;
            const prev = allegiances.get(who);
            const a = { who, public: resolve(f.public), real: resolve(f.real || f.public), text: r.text, pos: r.pos, id: r.id, day: day(r), knownBy: new Set(prev?.knownBy ?? []) };
            for (const x of [who, r.holder_name, ...(r.audience ?? [])]) if (x) a.knownBy.add(x);
            allegiances.set(who, a);
        } else if (r.type === '立场') {
            const a = resolve(f.a), b = resolve(f.b);
            if (!a || !b || a === b) continue;
            const key = `${a}→${b}`;
            const prev = stances.get(key);
            const s = { a, b, public: clip(f.public, 120), real: clip(f.real || f.public, 120), text: r.text, pos: r.pos, id: r.id, day: day(r), knownBy: new Set(prev?.knownBy ?? []) };
            for (const x of [r.holder_name, ...(r.audience ?? [])]) if (x) s.knownBy.add(x);
            stances.set(key, s);
        }
    }
    return { deals: [...deals.values()], allegiances: [...allegiances.values()], stances: [...stances.values()] };
}

export const isSecret = x => !!x.real && x.real !== x.public;
const whoKnows = (set, max = 6) => { const l = [...set]; return l.length > max ? `${l.slice(0, max).join('、')}等 ${l.length} 人` : l.join('、'); };
const since = (x, today, relDay) => (x.day != null && today != null && relDay ? `（${relDay(today - x.day)}）` : '');
// 归属的"实际"一般是一方的名字；模型偶尔写成一句话（"私下替某某做事"），那就照原样摆出来。
const realSide = a => (/[替为给帮做事]/.test(a.real) ? `实际：${a.real}` : `实际替${a.real}做事`);

// 给规划者的一段：全账，写明谁知道实情；外加素材包势力网里和这一局沾边的原作关系（可能已经变了）。
export function factionBrief(ledger, { net = null, today = null, relDay = null, maxBase = 12 } = {}) {
    const out = [];
    const { deals, allegiances, stances } = ledger;
    if (stances.length) out.push('各方之间（最新的一层；"实际"和"外面看"不一样的，只有列出的人知道实情）：',
        ...stances.map(s => `· ${s.a} 对 ${s.b}：${isSecret(s) ? `外面看${s.public}；实际${s.real}（知道实情的：${whoKnows(s.knownBy)}）` : s.real}${since(s, today, relDay)}`));
    if (allegiances.length) out.push('人的归属（明面／实际）：',
        ...allegiances.map(a => `· ${a.who}：${isSecret(a) ? `明面是${a.public}的人，${realSide(a)}（知道的：${whoKnows(a.knownBy)}）` : `${a.real}的人`}${since(a, today, relDay)}`));
    const open = deals.filter(d => !CLOSED.has(d.stage)), done = deals.filter(d => CLOSED.has(d.stage));
    if (deals.length) out.push('约定（谁和谁、什么、到哪一步；知道这笔约定的人）：',
        ...[...open, ...done.slice(-6)].map(d => `· ${d.parties.join(' 和 ')}「${d.title}」${d.via.size ? `（出面的：${[...d.via].join('、')}）` : ''}：${d.stage}${d.history.length > 1 ? `（${d.history.map(h => h.stage).join('→')}）` : ''}——${clip(d.text, 80)}（知道的：${whoKnows(d.knownBy)}）${since(d, today, relDay)}`));
    if (net?.edges?.length) {
        const named = new Set([...stances.flatMap(s => [s.a, s.b]), ...allegiances.flatMap(a => [a.public, a.real]), ...deals.flatMap(d => d.parties)]);
        const byId = new Map((net.nodes ?? []).map(n => [n.id, n.name]));
        const edges = net.edges.filter(e => named.has(byId.get(e.from)) || named.has(byId.get(e.to))).slice(0, maxBase);
        if (edges.length) out.push('原作里的底子（和上面沾边的；这一局可能早变了，以上面为准）：', ...edges.map(e => `· ${byId.get(e.from) ?? e.from} — ${byId.get(e.to) ?? e.to}：${e.type}${e.period ? `（${e.period}）` : ''}`));
    }
    return out.length ? ['【势力账】（这一局到现在，按记账算的）', ...out] : [];
}

// 给角色那一格的几行：只用他知道的；只给和眼下有关的，免得每轮都去碰（和"一直算数的改变"同一个教训）。
// 他自己这一方（他本人、他明面／实际的那一方、homes＝关系表里写着他是哪家的）还没了结的约定一直给（至多三笔）；
// 别人之间的只在眼下提到了、或当事人在场时给，提到的排前面。
export function factionSlotLines({ ledger, name, present = [], talk = '', homes = [], today = null, relDay = null, maxDeals = 3 }) {
    const { deals, allegiances, stances } = ledger;
    if (!deals.length && !allegiances.length && !stances.length) return [];
    const isMe = n => samePerson(n, name);
    const mine = allegiances.find(a => isMe(a.who));
    const sides = new Set([name, mine?.public, mine?.real, ...homes].filter(Boolean));
    const ours = p => sides.has(p) || isMe(p);
    const here = [...new Set(present)];
    // 提到：原话里有全名，或者有"名·姓"里的一截（"某某·斯托特"只说了"斯托特"）。
    const said = x => !!x && (talk.includes(x) || x.split('·').some(part => part.length >= 2 && talk.includes(part)));
    const inRoom = x => here.some(p => samePerson(p, x));
    const mentioned = x => said(x) || inRoom(x);
    const sideOf = person => { const a = allegiances.find(x => samePerson(x.who, person)); return a ? [a.public, a.real] : []; };
    const othersHere = x => here.some(p => !isMe(p) && sideOf(p).includes(x));
    const near = x => mentioned(x) || othersHere(x);
    // 两方里有一方被提到、或在场的别人是那一方的人才算沾边；他自己那一方单独不算（不然他那一方的事轮轮都给）。
    const touches = (x, y) => near(x) || near(y);
    const talkedOf = d => d.parties.some(said) || [...d.via].some(said) || talk.includes(d.title);
    const lines = [];
    const myDeals = deals.filter(d => (d.parties.some(ours) || [...d.via].some(isMe)) && (!CLOSED.has(d.stage) || (today != null && d.day != null && today - d.day <= 1)))
        .sort((a, b) => Number(talkedOf(b)) - Number(talkedOf(a)) || b.pos - a.pos).slice(0, maxDeals);
    for (const d of myDeals) {
        const other = d.parties.filter(p => !ours(p)).join('、') || d.parties.join('和');
        lines.push(`· 和${other}的「${d.title}」：${d.stage}——${clip(d.text, 70)}${since(d, today, relDay)}`);
    }
    const otherDeals = deals.filter(d => !myDeals.includes(d) && !CLOSED.has(d.stage) && (talkedOf(d) || d.parties.some(near)))
        .sort((a, b) => Number(talkedOf(b)) - Number(talkedOf(a)) || b.pos - a.pos).slice(0, 3);
    for (const d of otherDeals) lines.push(`· ${d.parties.join('和')}的「${d.title}」：${d.stage}——${clip(d.text, 70)}${since(d, today, relDay)}`);
    for (const a of allegiances) {
        if (isMe(a.who)) {
            if (isSecret(a) && (here.some(p => !isMe(p) && sideOf(p).includes(a.public)) || said(a.public) || said(a.real)))
                lines.push(`· ${name}明面上是${a.public}的人，${realSide(a)}；知道这件事的只有${whoKnows(new Set([...a.knownBy].filter(x => !isMe(x))))}`);
            continue;
        }
        if (!(mentioned(a.who) || (isSecret(a) && touches(a.public, a.real)))) continue;
        lines.push(isSecret(a) ? `· ${a.who}明面上是${a.public}的人，${realSide(a)}` : `· ${a.who}是${a.real}的人`);
    }
    for (const s of stances) {
        if (!touches(s.a, s.b)) continue;
        lines.push(`· ${s.a}对${s.b}：${isSecret(s) ? `外面看${s.public}，实际${s.real}` : s.real}`);
    }
    if (!lines.length) return [];
    return [`${name}知道的各方来往（这一局到现在；只供参考，提不提由${name}）：`, ...lines.slice(0, 8)];
}
