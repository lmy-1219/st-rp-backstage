// 纪年检查（J-45、D-75）：后台写出来、会递给前台的东西（参谋的备忘、规划的菜单），里面说到有年表锚点的事、又写了年份的，
// 年份对不上年表就拦下来。年份两种写法都认："2025 年"，或者"五年前"（按这一局的年份折算）。
// 锚点只有"年份＋一句说明"，程序按说明里少见的词认出一句话在说哪件事（某座楼、某场战争的名字认得出，城市名这种到处都有的不算数）。
import fs from 'node:fs';

// 锚点文件：{ anchors: [{ year, label, confidence }] }；confidence 为"有出入"的，差一年也放过。
export function loadAnchors(file) {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    return (raw.anchors ?? raw).filter(a => Number.isFinite(a.year) && a.label).map(a => ({ year: a.year, label: a.label, loose: a.confidence === '有出入' }));
}

const CN = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
export function cnNumber(s) {
    if (/^\d+$/.test(s)) return Number(s);
    if (!/^[零一二两三四五六七八九十百]+$/.test(s)) return null;
    let n = 0, cur = 0;
    for (const c of s) {
        if (c === '百') { n += (cur || 1) * 100; cur = 0; }
        else if (c === '十') { n += (cur || 1) * 10; cur = 0; }
        else cur = CN[c];
    }
    return n + cur;
}

function grams(text) {
    const out = new Set();
    for (const run of String(text).replace(/[^㐀-鿿]+/g, '|').split('|')) {
        for (let i = 0; i + 3 <= run.length; i++) out.add(run.slice(i, i + 3));
        for (let i = 0; i + 2 <= run.length; i++) out.add(run.slice(i, i + 2));
    }
    for (const w of String(text).toLowerCase().match(/[a-z][a-z0-9.-]{2,}/g) ?? []) out.add(w);
    return out;
}

// 预先算好每个锚点的"认得出它的词"：三字组（或外文词）里只在少数几个锚点出现的。
// 以虚字开头或结尾的三字组（"在某城"、"城的"）不算：它只是句子的接缝，认不出是哪件事（实测："家族还在某城边上转"被当成"某公司在某城建立……"那件事）。
const FUNCTION_CHARS = /^[的了在是和与及把被向对从到为也都就还又而并或之其这那着过于以将所给让由]|[的了在是和与及把被向对从到为也都就还又而并或之其这那着过于以将所给让由]$/;
export function indexAnchors(anchors) {
    const each = anchors.map(a => ({ ...a, g: grams(a.label) }));
    const df = new Map();
    for (const a of each) for (const g of a.g) df.set(g, (df.get(g) ?? 0) + 1);
    const usable = g => /[a-z]/.test(g) || (g.length >= 3 && !FUNCTION_CHARS.test(g));
    return each.map(a => ({ ...a, keys: [...a.g].filter(g => usable(g) && df.get(g) <= 3) }));
}

// 这一局自己的锚点：开局单前史里写了年份的那几条（"某年在某处……"）。同一个地方在世界年表里和这一局里可能各出过一件事
// （实测：规划写"五年前从某塔下面把人救出来"，只对世界年表的话会被当成那座塔二十年前的另一件事拦下）。
// 一条写了好几个年份的（"甲年～乙年"），每个年份各算一个、放宽一年。
export function storyAnchors(setup) {
    return indexAnchors((setup?.前史 ?? []).flatMap(x => {
        const years = [...new Set([...String(x.事 ?? '').matchAll(/(?<!\d)((?:19|20)\d\d)(?!\d)/g)].map(m => Number(m[1])))];
        return years.map(year => ({ year, label: x.事, loose: years.length > 1 }));
    }));
}

// 一段话里的年份写错了的地方：[{ clause, wrote, label, year }]。
// extra：这一局自己的锚点（已建好索引）。它只能替一句话"作证"、不能单独拦：前史是长长的叙述句，里面尽是"见过面"这类
// 平常词组，拿它单独拦会误伤（实测："这副手还没跟它见过面"被当成前史里"两人还没直接见过面"那件事）。
export function checkYears(text, anchors, { storyYear = null, extra = null } = {}) {
    const world = anchors?.[0]?.keys ? anchors : indexAnchors(anchors ?? []);
    if (!world.length) return [];
    const flags = [];
    for (const clause of String(text).split(/[。；！？!?\n]/).map(s => s.trim()).filter(Boolean)) {
        const years = [];
        for (const m of clause.matchAll(/(?<!\d)((?:19|20)\d\d)\s*年(?!代)/g)) years.push({ y: Number(m[1]), wrote: `${m[1]} 年` });
        if (storyYear) for (const m of clause.matchAll(/([0-9零一二两三四五六七八九十百]+)\s*年前/g)) {
            const n = cnNumber(m[1]);
            if (n != null && n > 0) years.push({ y: storyYear - n, wrote: `${m[1]}年前（＝${storyYear - n} 年）`, fuzzy: true });
        }
        if (!years.length) continue;
        const g = grams(clause);
        const hitsIn = list => list.map(a => ({ a, n: a.keys.filter(k => g.has(k)).length })).filter(h => h.n > 0).sort((x, y) => y.n - x.n);
        const hits = hitsIn(world);
        if (!hits.length) continue;
        const witnesses = [...hits, ...hitsIn(extra ?? [])];
        for (const w of years) {
            const fits = witnesses.some(({ a }) => Math.abs(a.year - w.y) <= (a.loose || w.fuzzy ? 1 : 0));
            if (!fits) flags.push({ clause: clause.slice(0, 60), wrote: w.wrote, label: hits[0].a.label, year: hits[0].a.year });
        }
    }
    return flags;
}

export const yearFlagText = f => `「${f.clause}」写的是 ${f.wrote}，年表里「${f.label}」是 ${f.year} 年`;

// 菜单里会递给前台的那几格（露面、应答、沉底、用在）＋阶段目标。
export function planYearFlags(parsed, anchors, storyYear, { setup = null } = {}) {
    const texts = [parsed.goal, ...parsed.items.flatMap(i => [i.surface, i.respond, i.sink, i.fit])].filter(Boolean);
    const extra = setup ? storyAnchors(setup) : null;
    return texts.flatMap(t => checkYears(t, anchors, { storyYear, extra }));
}
