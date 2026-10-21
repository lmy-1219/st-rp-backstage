import { personWord } from './pronoun.mjs';
// 钱：从"钱"型记录算出谁欠谁、谁答应给谁、谁开了价还没成、最近的进出。
// 纪律（白皮书 §7.1、事实书 skill）：没明说金额不动账；报价不扣款；说定≠付了；欠着的钱还了才减。
// 只算记录里写明的进出；手上还剩多少（N-266）只给开局单写了开场钱数的人算：开场的数＋写明的付了、花了、还了，不猜别的。

const DIGIT = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const UNIT = { 十: 10, 百: 100, 千: 1000 };
const BIG = { 万: 1e4, 亿: 1e8 };

// "两百万""一千五""1,500""2万""1.5万""三十万" → 整数；认不出返回 null。
export function parseAmount(input) {
    const s = String(input ?? '').replace(/[\s,，_]/g, '').replace(/[kK](?![a-zA-Z])/g, '千');
    const tokens = s.match(/\d+(?:\.\d+)?|[零〇一二两三四五六七八九]|[十百千]|[万亿]/g);
    if (!tokens) return null;
    let total = 0, section = 0, number = null, lastUnit = 0, lastWasDigitAfterUnit = false;
    for (const t of tokens) {
        if (/^\d/.test(t) || t in DIGIT) {
            number = /^\d/.test(t) ? Number(t) : DIGIT[t];
            lastWasDigitAfterUnit = lastUnit > 0;
        } else if (t in UNIT) {
            section += (number ?? 1) * UNIT[t]; lastUnit = UNIT[t]; number = null; lastWasDigitAfterUnit = false;
        } else if (t in BIG) {
            section += number ?? 0;
            total += (section || 1) * BIG[t]; section = 0; number = null; lastUnit = BIG[t]; lastWasDigitAfterUnit = false;
        }
    }
    // 口语省掉末位单位："一千五"＝1500、"一万五"＝15000、"两百五"＝250
    if (number != null) section += lastWasDigitAfterUnit && lastUnit >= 100 && number < 10 ? number * (lastUnit / 10) : number;
    const value = Math.round(total + section);
    return Number.isFinite(value) && value > 0 ? value : null;
}

// 一段正文里像金额的说法各值多少（核对模型给的金额是不是原文里真有的）。
export function amountsIn(text) {
    const s = String(text ?? '').replace(/(\d),(?=\d{3})/g, '$1');
    const out = new Set();
    for (const m of s.matchAll(/\d+(?:\.\d+)?\s*[万亿千百kK]?|[零〇一二两三四五六七八九十百千万亿]{2,}/g)) {
        const v = parseAmount(m[0]);
        if (v) out.add(v);
    }
    return out;
}

// "得了"：抢来、捡来、赢来的、赏金、卖东西得的——没有付款人也进账（试玩 10/7：清道夫箱子里那两万只在"说"里，手上的钱算不上）
export const STAGES = ['报价', '说定', '付了', '欠着', '还了', '花了', '得了'];
// 现钱真动了的几种：付了、花了、还了、得了（钱到了收款人手上）；报价、说定、欠着不算
const CASH = new Set(['付了', '花了', '还了', '得了']);

const knows = (r, name) => r.holder_name === name || (r.audience ?? []).includes(name);
// 同一个人（或同一家）：一模一样，或者一个名字包含另一个（"某公司"和"某公司总部"）。
export const samePerson = (a, b) => !!a && !!b && a !== '不明' && b !== '不明' && (a === b || (a.length >= 2 && b.length >= 2 && (a.includes(b) || b.includes(a))));
// 同一方：一样的人，或者一边写的是"外人／不明"、另一边不是有名有卡的人（记账一条写"维修工"、下一条照规矩写"外人"，同一笔两头对不上——试玩 10/6 的门）。
// named 是这一局有名字的人（名册）；没给就照严的来。
const OUTSIDE = new Set(['外人', '不明']);
// 有名有姓的一方：名册里除"新面孔"（维修工、摊主这类记账顺手入册的叫法）之外的人，加上玩家
export const namedParties = (cast = [], userName = null) => [...cast.filter(e => e?.name && e.role !== '新面孔').map(e => e.name), userName].filter(Boolean);
export function sameParty(a, b, named = []) {
    if (samePerson(a, b)) return true;
    if (!named.length || !a || !b) return false;
    const isNamed = n => named.some(x => samePerson(x, n));
    return (OUTSIDE.has(a) && !OUTSIDE.has(b) && !isNamed(b)) || (OUTSIDE.has(b) && !OUTSIDE.has(a) && !isNamed(a));
}

// 同一笔被前后几条各记了一次（付款的人说一遍、收款的人又说一遍；"甲用乙的卡付了"和"甲说花了"付款人都不一样）：
// 八条以内、收款方和数目都一样的只算一次（试玩 10/6：一顿外卖 460 两人各扣了一次，两条隔了六条消息）
export function dedupeCash(rows) {
    const seen = [], out = [];
    for (const r of rows) {
        const m = r.money;
        if (CASH.has(m.stage) && m.amount != null && seen.some(s => samePerson(s.to, m.to) && s.amount === m.amount && r.pos - s.pos <= 8)) continue;
        if (CASH.has(m.stage)) seen.push({ ...m, pos: r.pos });
        out.push(r);
    }
    return out;
}

// 账本：按时间走一遍。knower 给了就只看他知道的；named 是名册（"外人"按同一方认）。
export function buildLedger(records, { knower = null, named = [] } = {}) {
    const rows = dedupeCash(records.filter(r => r.type === '钱' && r.money && (!knower || knows(r, knower))).sort((a, b) => a.pos - b.pos || a.id - b.id));
    const same = (a, b) => sameParty(a, b, named);
    const quotes = [], deals = [], debts = [], moves = [];
    // 报价：同两方之间后面定了、付了、赊了，这价就谈完了，数目不用一样（吓回原价的那三百关不掉一千八的开价）；
    // 说定：数目一样才算付的是这一笔，说定时没写数目的例外
    const closeQuotes = m => { const i = quotes.findIndex(x => same(x.money.from, m.from) && same(x.money.to, m.to)); if (i >= 0) quotes.splice(i, 1); };
    const closeDeals = m => {
        const i = deals.findIndex(x => same(x.money.from, m.from) && same(x.money.to, m.to) && (x.money.amount === m.amount || x.money.amount == null) && !x.money.monthly);
        if (i >= 0) deals.splice(i, 1);
    };
    for (const r of rows) {
        const m = r.money;
        if (m.stage === '报价') quotes.push(r);
        else if (m.stage === '说定') {
            closeQuotes(m);
            // 同一笔约定被不同的消息各记了一次（按期付的尤其常见）：只留最早那条
            if (!deals.some(d => same(d.money.from, m.from) && same(d.money.to, m.to) && d.money.amount === m.amount && d.money.every === m.every)) deals.push(r);
        }
        else if (m.stage === '欠着') { closeQuotes(m); debts.push({ ...r, left: m.amount }); }
        else if (m.stage === '还了') {
            let left = m.amount;
            for (const d of debts) {
                if (left <= 0) break;
                // 还钱的人＝欠钱的人，收钱的人＝债主
                if (same(d.money.from, m.from) && same(d.money.to, m.to) && d.left > 0) { const pay = Math.min(d.left, left); d.left -= pay; left -= pay; }
            }
            moves.push(r);
        } else if (m.stage === '付了' || m.stage === '花了') {
            closeQuotes(m); closeDeals(m);
            moves.push(r);
        } else if (m.stage === '得了') moves.push(r);
    }
    return { quotes, deals, debts: debts.filter(d => d.left > 0), moves };
}

// 手上还剩多少（N-266）。start＝开局单"钱"那一格（[{谁, 多少, 谁知道}]）；people＝另外要看的人（玩家、开口的人）。
// 只有现钱真动了的才算：付了、花了、还了（钱从付款人到了收款人手上）；报价、说定、欠着（赊的、垫的说不清现钱动没动）不算。
// 同一笔被前后几条消息各记了一次（付款的人说一遍、收款的人又说一遍）：三条以内、谁给谁、多少都一样的只算一次。
// knower 给了就只算他知道的那几笔（前台：据他所知）。开场钱数没写的，只有进出、没有"还剩"。
export function balances(records, { start = [], people = [], knower = null } = {}) {
    const names = [...(start ?? []).map(s => s.谁), ...people].filter(Boolean);
    const out = new Map();
    const of = n => {
        const k = names.find(x => samePerson(x, n));
        if (!k) return null;
        if (!out.has(k)) out.set(k, { name: k, start: (start ?? []).find(x => samePerson(x.谁, k))?.多少 ?? null, in: 0, out: 0, moves: 0 });
        return out.get(k);
    };
    names.forEach(of);
    for (const r of dedupeCash(records.filter(r => r.type === '钱' && r.money && CASH.has(r.money.stage) && (!knower || knows(r, knower))).sort((a, b) => a.pos - b.pos || a.id - b.id))) {
        const m = r.money;
        const a = of(m.from), b = of(m.to);
        if (a && a !== b) { a.out += m.amount; a.moves++; }
        if (b && a !== b) { b.in += m.amount; b.moves++; }
    }
    return [...out.values()].map(x => ({ ...x, now: x.start == null ? null : x.start + x.in - x.out }));
}
const money = (n, currency) => `${Math.round(n).toLocaleString('en-US')}${currency ? ` ${currency}` : ''}`;
// 给人看的一行（/账、面板）。
export function balanceText(x, currency = '') {
    if (x.now != null) return `${x.name}：现在约 ${money(x.now, currency)}（开场 ${money(x.start, currency)}${x.moves ? `，之后进 ${money(x.in, currency)}、出 ${money(x.out, currency)}` : '，之后没有写明金额的进出'}）`;
    return x.moves ? `${x.name}：开场以来进 ${money(x.in, currency)}、出 ${money(x.out, currency)}（开局单"钱"那一格写上开场时有多少，就能算出还剩多少）` : '';
}
// 给开口的人的：他自己的；开局单写了他知道谁的开场钱数的，那个人的（按他知道的进出算）。
export function balanceLines(records, { name, start = [], currency = '' }) {
    const lines = [];
    for (const s of start ?? []) {
        const mine = samePerson(s.谁, name);
        if (!mine && !(s.谁知道 ?? []).some(n => samePerson(n, name))) continue;
        const x = balances(records, { start: [s], knower: name })[0];
        if (x?.now == null) continue;
        lines.push(mine ? `· ${name}自己手上大概还有 ${money(x.now, currency)}` : `· 据${name}所知，${x.name}手上大概还有 ${money(x.now, currency)}（${personWord(name)}不在场时的进出不算）`);
    }
    return lines;
}

// 写给前台的几行：他知道的、还没了结的钱上的事，外加最近几笔进出。
// 对外人、对"不明"的开价只是在说行情（"别墅起租至少十万"），不算两个人之间谈着的价。
const outsider = n => !n || n === '不明' || n === '外人';
export function moneyLines(ledger, { name, when, currency = '', involves = [], max = 5, closed = new Set() }) {
    const amount = n => `${Math.round(n).toLocaleString('en-US')}${currency ? ` ${currency}` : ''}`;
    const touches = r => !involves.length || involves.some(n => samePerson(r.money.from, n) || samePerson(r.money.to, n));
    const mine = r => samePerson(r.money.from, name) || samePerson(r.money.to, name);
    const rows = [];
    for (const d of ledger.debts.filter(touches).filter(r => !closed.has(r.id))) rows.push([d, `· 欠着：${d.text}${d.left < d.money.amount ? `（已还一部分，还欠 ${amount(d.left)}）` : ''}（${when(d)}）`]);
    for (const r of ledger.deals.filter(touches).filter(r => !closed.has(r.id))) {
        const paid = r.money.monthly && [...ledger.moves].reverse().find(m => samePerson(m.money.from, r.money.from) && samePerson(m.money.to, r.money.to) && m.money.amount === r.money.amount);
        rows.push([r, r.money.monthly ? `· 按期给的：${r.text}（${when(r)}说定${paid ? `；最近一期${when(paid)}付过` : ''}）` : `· 说定了、钱还没给：${r.text}（${when(r)}）`]);
    }
    for (const r of ledger.quotes.filter(r => touches(r) && !outsider(r.money.from) && !outsider(r.money.to) && !closed.has(r.id))) rows.push([r, `· 开过价、还没成：${r.text}（${when(r)}）`]);
    const dealt = new Set(ledger.deals.map(r => `${r.money.from}|${r.money.to}|${r.money.amount}`));
    for (const r of ledger.moves.filter(r => touches(r) && !dealt.has(`${r.money.from}|${r.money.to}|${r.money.amount}`)).slice(-2)) rows.push([r, `· ${when(r)}：${r.text}`]);
    // 跟他自己有关的排前面，最多几条
    const lines = [...rows.filter(([r]) => mine(r)), ...rows.filter(([r]) => !mine(r))].slice(0, max).map(([, l]) => l);
    return lines.length ? [`${name}知道的钱上的事：`, ...lines] : [];
}
