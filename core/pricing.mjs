// 行情：读一份价表（题材数据放在素材包里，这里只认字段），按眼下在聊的事挑出相关价码，给活儿估个到手数。
// 价表格式见 素材包/*/物价.json：items（日常开销）、gear.tiers（装备档次）、jobs.tiers（活儿档次）、
// jobs.fixerCut（中间人抽成比例）、jobs.costs（一单常见开销）、standing（身价：卖家看人要价，用户 9/30）。数字都是整数货币单位；null 表示原文没给准数。
import fs from 'node:fs';
import { amountsIn } from './money.mjs';

export function loadPriceTable(file) {
    if (!file) return null;
    let raw;
    try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
    const list = v => Array.isArray(v) ? v.filter(x => x && typeof x.name === 'string') : [];
    return {
        currency: typeof raw.currency === 'string' ? raw.currency : '',
        items: list(raw.items),
        gear: list(raw.gear?.tiers),
        jobs: list(raw.jobs?.tiers),
        fixerCut: raw.jobs?.fixerCut && Number.isFinite(raw.jobs.fixerCut.min) ? raw.jobs.fixerCut : null,
        costs: list(raw.jobs?.costs),
        jobNote: typeof raw.jobs?.rule === 'string' ? raw.jobs.rule : null,
        standing: loadStanding(raw.standing),
        housing: list(raw.housing?.tiers).map(t => ({ ...t, keys: Array.isArray(t.keys) ? t.keys : [], rent: pairOf(t.rent), buy: pairOf(t.buy) })),
    };
}
const pairOf = v => (Array.isArray(v) && v.length === 2 && v.every(Number.isFinite) ? v : null);

// 身价：{ rule, tiers: [{ name, markup: [低, 高], pay: [低, 高], scope, note, keys }] }。markup＝同样的东西卖家对他开到行情的几倍；
// pay＝同一档活他拿到的报价是表上的几成（表上是按有名的佣兵写的）；scope＝在哪类买卖上认得他（"地下"：只有圈子里的卖家认得；
// "到处"：走到哪都认得）。价表里每一项也可以写 scope（items 不写算"日常"，gear 不写算"地下"）。都可有可无。
function loadStanding(raw) {
    const pair = v => (Array.isArray(v) && v.length === 2 && v.every(Number.isFinite) ? v : null);
    const tiers = (Array.isArray(raw?.tiers) ? raw.tiers : []).filter(t => t && typeof t.name === 'string' && t.name)
        .map(t => ({ name: t.name, markup: pair(t.markup), pay: pair(t.pay), scope: t.scope === '到处' ? '到处' : '地下', note: typeof t.note === 'string' ? t.note : '', keys: Array.isArray(t.keys) ? t.keys : [] }));
    const underground = Array.isArray(raw?.underground) ? raw.underground.filter(k => typeof k === 'string' && k.length >= 2) : [];
    return tiers.length ? { rule: typeof raw.rule === 'string' ? raw.rule : '', tiers, underground } : null;
}

// 某人写的身价（关系表"身价"那一格，一句话）对得上价表里哪一档：档名或检索词整段出现在里面。
export function standingOf(table, text) {
    const t = String(text ?? '');
    if (!table?.standing || !t.trim()) return null;
    return table.standing.tiers.find(s => [s.name, ...s.keys].some(k => k && k.length >= 2 && t.includes(k))) ?? null;
}

// 在场的人里身价和行情不一样的：卖家对他开几倍、同一档活他拿几成（数字照价表）。
// 这是写卖家、写派活的人时用的（试玩 9/30：出价的人知道该抬多少，买的人只知道可能被敲竹杠）；
// 只在他的身价管得着的那类买卖上说（圈子里有名的，街面上的吃住照常）。
// people：[{ name, text }]（text＝关系表里他的身价）。jobs：眼下在聊活儿（开口的是派活的人）。items：眼下说到的价目（含装备）。
export const scopeOf = (e, kind = 'item') => e?.scope ?? (kind === 'gear' ? '地下' : '日常');
export function standingLines(table, people = [], { jobs = false, items = [] } = {}) {
    if (!table?.standing) return [];
    const x = ([a, b]) => (a === b ? `${a}` : `${a}～${b}`);
    const lines = [];
    for (const { name, text } of people) {
        const s = standingOf(table, text);
        if (!s) continue;
        const bits = [];
        const inScope = items.filter(e => s.scope === '到处' || e.scope === '地下');
        if (s.markup && !(s.markup[0] === 1 && s.markup[1] === 1) && inScope.length) {
            const eg = inScope.find(e => Number.isFinite(e.min));
            const hi = eg ? (Number.isFinite(eg.max) ? eg.max : eg.min) : null;
            bits.push(`卖家认得${name}，同样的东西对${name}通常开到行情的 ${x(s.markup)} 倍${eg ? `（${eg.name}：行情 ${formatRange(eg.min, eg.max, table.currency, eg.range)}，对${name}约 ${formatRange(Math.round(eg.min * s.markup[0]), Math.round(hi * s.markup[1]), table.currency)}）` : ''}`);
        }
        if (jobs && s.pay && !(s.pay[0] === 1 && s.pay[1] === 1)) bits.push(`同一档活${name}拿到的报价通常只有表上的 ${Math.round(s.pay[0] * 10)}～${Math.round(s.pay[1] * 10)} 成`);
        if (!bits.length) continue;
        if (s.note) bits.push(s.note);
        lines.push(`· ${name}（${s.name}）：${bits.join('；')}`);
    }
    return lines.length ? [table.standing.rule || '卖家看人要价：', ...lines, '（这几行是写卖家、写派活的人开价时用的；买的人自己只知道可能被多要，不知道具体抬了多少）'] : [];
}

export function formatMoney(n, currency = '') {
    if (!Number.isFinite(n)) return '';
    return `${Math.round(n).toLocaleString('en-US')}${currency ? ` ${currency}` : ''}`;
}

export function formatRange(min, max, currency = '', raw = null) {
    if (raw) return raw;
    if (Number.isFinite(min) && Number.isFinite(max)) return min === max ? formatMoney(min, currency) : `${formatMoney(min)}～${formatMoney(max, currency)}`;
    if (Number.isFinite(min)) return `${formatMoney(min, currency)}以上`;
    if (Number.isFinite(max)) return `${formatMoney(max, currency)}以内`;
    return '';
}

// 聊到钱没有、聊到活儿没有（通用字眼；题材自己的币种词由价表的 currency 补上）。
const MONEY_WORDS = /钱|价|租|买|卖|付|欠|借|账|佣金|报酬|赏金|月供|工资|薪|多少|贵|便宜|预算|花销|开销|赚|存款|存下|收入|费/;
const JOB_WORDS = /单子|接单|委托|活儿|接活|佣金|报酬|赏金|中间人|报价|雇主/;
export function talksMoney(text, table) {
    const t = String(text ?? '');
    return MONEY_WORDS.test(t) || (!!table?.currency && t.includes(table.currency));
}
export const talksJobs = text => JOB_WORDS.test(String(text ?? ''));

// 某一档/某一项和眼下的话对不对得上：检索词或名字整段出现在话里。
const hit = (entry, text) => [entry.name, ...(entry.keys ?? [])].some(k => k && k.length >= 2 && text.includes(k));

// 挑出和眼下有关的价码。text＝用户这句加最近几句；queryKeys＝给用户那句配的检索词（可空）。
export function matchPrices(table, text, queryKeys = [], { max = 4 } = {}) {
    if (!table) return { items: [], gear: [], jobs: [] };
    const t = `${text ?? ''} ${queryKeys.join(' ')}`;
    return {
        items: table.items.filter(e => hit(e, t)).slice(0, max),
        gear: table.gear.filter(e => hit(e, t)).slice(0, 2),
        jobs: table.jobs.filter(e => hit(e, t)).slice(0, 2),
    };
}

// 一单活儿大概能落下多少：报价 → 扣中间人 → 扣一单常见开销（按月算的开销不算进一单）。
export function jobEstimate(table, tier, { cutRate = null } = {}) {
    if (!table || !tier || !Number.isFinite(tier.min)) return null;
    const hi = Number.isFinite(tier.max) ? tier.max : tier.min;
    const cut = cutRate != null ? { min: cutRate, max: cutRate } : table.fixerCut ?? { min: 0, max: 0 };
    const perJob = table.costs.filter(c => !c.unit && Number.isFinite(c.min));
    const costMin = perJob.length ? Math.min(...perJob.map(c => c.min)) : 0;
    const costMax = perJob.reduce((s, c) => s + (Number.isFinite(c.max) ? c.max : c.min), 0);
    const receivedMin = Math.round(tier.min * (1 - cut.max)), receivedMax = Math.round(hi * (1 - cut.min));
    return {
        gross: [tier.min, hi], cut: [cut.min, cut.max], received: [receivedMin, receivedMax],
        costs: [costMin, costMax], net: [Math.max(0, receivedMin - costMax), Math.max(0, receivedMax - costMin)],
    };
}

const pct = r => `${Math.round(r * 100)}%`;

// 按档名挑活儿的档次（关系表里派活的人写的"中等难度、高难度"）：同名的先认，没有就认唯一以它开头的那档。
export function tiersNamed(table, names = []) {
    if (!table) return [];
    const pick = n => table.jobs.find(t => t.name === n) ?? (c => (c.length === 1 ? c[0] : null))(table.jobs.filter(t => t.name.startsWith(n)));
    return [...new Set(names.map(pick).filter(Boolean))];
}
// 这几档活的价码，一句话（"中等难度 5,000～10,000 欧；高难度 15,000～30,000 欧"）。
export function tierPrice(table, names = []) {
    return tiersNamed(table, names).map(t => `${t.name.replace(/（.*$/, '')} ${formatRange(t.min, t.max, table.currency, t.range)}`).join('；');
}

// 住处（用户 10/1：房产分几档；规划全看，前台只给要找的那一档）。聊到租房、买房、住处时才给：
// 说到的地段、档次那一档（至多两档）→ 说到的钱数落在哪一档的租金或买价里 → 都没有就给价表里标了 default 的那一档。
const HOUSING_WORDS = /租房|房租|月租|租金|租个|租间|租下|找房|看房|房子|公寓|住处|住的地方|落脚|搬家|搬过去|搬进|二房东|房东|中介|买房|买.{0,3}(?:房|宅|公寓|别墅|庄园)|(?:豪|大|住)宅|房价|房产|首付|单间|隔断间|楼盘|住哪|别墅/;
export const talksHousing = text => HOUSING_WORDS.test(String(text ?? ''));
export function matchHousing(table, text, queryKeys = []) {
    if (!table?.housing?.length) return [];
    const t = `${text ?? ''} ${queryKeys.join(' ')}`;
    if (!talksHousing(t)) return [];
    const named = table.housing.filter(h => hit(h, t));
    if (named.length) return named.slice(0, 2);
    const amounts = [...amountsIn(text)].filter(n => n >= 100);
    const within = (r, n) => r && n >= r[0] * 0.8 && n <= r[1] * 1.2;
    const byMoney = table.housing.find(h => amounts.some(n => within(h.rent, n) || within(h.buy, n)));
    if (byMoney) return [byMoney];
    return table.housing.filter(h => h.default).slice(0, 1);
}
const housingHead = (h, c) => `${h.name}（${h.areas}）：${h.rent ? `月租 ${formatRange(h.rent[0], h.rent[1], c)}` : ''}${h.rentNote ? `${h.rent ? '，' : ''}${h.rentNote}` : ''}；买下 ${h.buy ? formatRange(h.buy[0], h.buy[1], c) : '—'}${h.buyNote ? `（${h.buyNote}）` : ''}`;
export function housingLines(table, tiers = []) {
    if (!tiers.length) return [];
    const c = table.currency;
    return ['住处的行情（写到看房、开价、谈租金时照这个；房东、中介、本地人心里有数，开口的人自己未必清楚现在的价）：',
        ...tiers.flatMap(h => [`· ${housingHead(h, c)}`, ...[h.env && `环境：${h.env}`, h.security && `安保：${h.security}`, h.extra && `另外：${h.extra}`, h.lore].filter(Boolean).map(x => `  ${x}`)])];
}

// 规划简报里的一段（用户 9/30：行情是给后台排剧情用的）：活儿各档的价、中间人抽多少、看人要价的几档。前台只在派活的人开口时拿到活儿的单价。
export function planPriceLines(table) {
    if (!table) return [];
    const c = table.currency;
    const out = ['【行情】（给你排活计、花销、谁找谁用；数字以这里为准。前台只有派活的人开口时才拿到活儿的单价，别人只知道个大概）'];
    for (const t of table.jobs) out.push(`· ${t.name}的活${t.examples ? `（${t.examples}）` : ''}：${formatRange(t.min, t.max, c, t.range)}`);
    if (table.fixerCut) out.push(`· 中间人抽佣金的 ${pct(table.fixerCut.min)}～${pct(table.fixerCut.max)}`);
    if (table.jobNote) out.push(`· ${table.jobNote}`);
    if (table.housing?.length) {
        out.push('· 住处分几档（前台聊到租房、买房、住处时只拿到要找的那一档）：');
        // note＝只给规划的（这一档在这一局里意味着什么）；lore＝这一档的世界常识，前台拿到这一档时也给
        for (const h of table.housing) out.push(`  - ${housingHead(h, table.currency)}；${[h.env && `环境：${h.env}`, h.security && `安保：${h.security}`, h.extra, h.lore, h.note].filter(Boolean).join('；')}`);
    }
    if (table.standing) {
        const x = ([a, b]) => (a === b ? `${a}` : `${a}～${b}`);
        out.push(`· ${table.standing.rule || '卖家看人要价：'}`);
        if (table.standing.underground?.length) out.push(`  （地下的买卖：${table.standing.underground.join('、')}）`);
        for (const s of table.standing.tiers) out.push(`  - ${s.name}（${s.scope === '到处' ? '走到哪都认得' : '圈子里认得'}）：${[s.markup && `开到行情的 ${x(s.markup)} 倍`, s.pay && `同一档活拿表上的 ${x(s.pay.map(v => v * 10))} 成`, s.note].filter(Boolean).join('；')}`);
    }
    return out.length > 1 ? out : [];
}

// 写给前台的几行。giver：开口的是派活的人（他心里有数）；不是的话，这是写到有人开价、结账时照的数，开口的人自己未必清楚
// （试玩 9/30：离开五年的人不会天然知道眼下的行情；活儿的单价只给派活的人）。
// offer：眼下这单明说的开价（中间人报的总价），给出这一单大概落下多少。
export function priceLines(table, { items = [], gear = [], jobs = [] }, { showJobs = false, offer = null, giver = true } = {}) {
    if (!table) return [];
    const c = table.currency;
    const lines = [];
    const per = e => e.unit && e.unit !== '件' ? `${e.unit} ` : '';
    for (const e of items) lines.push(`· ${e.name}：${per(e)}${formatRange(e.min, e.max, c, e.range)}${e.note ? `（${e.note}）` : ''}`);
    for (const e of gear) lines.push(`· ${e.name}：${formatRange(e.min, e.max, c, e.range)}`);
    const tiers = jobs.length ? jobs : showJobs ? table.jobs : [];
    for (const e of tiers) {
        const est = jobEstimate(table, e);
        const head = `· ${e.name}的活${e.examples ? `（${e.examples}）` : ''}：${formatRange(e.min, e.max, c, e.range)}`;
        lines.push(est && jobs.length
            ? `${head}；中间人抽 ${pct(est.cut[0])}～${pct(est.cut[1])}，到手约 ${formatRange(...est.received, c)}，再扣一单的常见开销，落下约 ${formatRange(...est.net, c)}`
            : head);
    }
    if (tiers.length && table.fixerCut && !jobs.length) lines.push(`· 中间人一般抽佣金的 ${pct(table.fixerCut.min)}～${pct(table.fixerCut.max)}`);
    if (offer && tiers.length) {
        const est = jobEstimate(table, { min: offer, max: offer });
        lines.push(`· 这单开价 ${formatMoney(offer, c)}：中间人抽 ${pct(est.cut[0])}～${pct(est.cut[1])} 后到手约 ${formatRange(...est.received, c)}，再扣一单的常见开销，落下约 ${formatRange(...est.net, c)}`);
    }
    if (tiers.length && table.jobNote) lines.push(`· ${table.jobNote}`);
    return lines.length ? [giver ? '这个世界的行情（你心里有数的价码，数字以这里为准）：' : '眼下的行情（写到有人开价、结账时照这个数；卖家和本地人心里有数，开口的人自己未必清楚现在的价）：', ...lines] : [];
}
