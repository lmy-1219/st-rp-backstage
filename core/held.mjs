import { personWord } from './pronoun.mjs';
// 心里压着的事（用户 10/16，小说转卡那边做开局单时的发现："不止是误会，主要是认知错位和角色性格以及剧情条件的关系，这是剧情节奏和拉扯的来源……
// 同样的还影响'报喜不报忧'这种事——角色心里有事/遇到了事，什么情况会说，不说的时候是什么表现，说的时候会挑在什么场景/时间"）。
// 他知道一件事、心里压着一件事（误会、秘密、坏消息、心意、打算），不等于他会说。每件旁边带一个处置：说不说、不说时往哪漏、什么条件才说、挑什么场合。
// 字段名和小说那边出的开局单同一套：处置｜开口条件｜不说时外显｜说的场合。来处：开局单前史里标了"谁知道"的条目、规划写的"心里压着的事"。
// 给前台的是本人眼下的倾向、为什么和想找的机会，不把处置和场合写成必须执行的开关。
// 处置是规划和开局单写的候选，不是事实，不进记账；说出口了（记账：前史那条标"过时"；规划写的那条：他之后说了的话对上了这件事）就退。题材无关。

export const HOLD_KINDS = ['瞒着', '闷着', '挑时候说', '直说'];
export const HOLD_KEYS = ['处置', '开口条件', '不说时外显', '说的场合'];
const str = v => (typeof v === 'string' ? v.trim() : '');

// 一条里的那四格（只留写了的；处置不认得的不要）；一格都没有就 null
export function holdOf(x, max = 120) {
    const out = {};
    for (const k of HOLD_KEYS) {
        const v = str(x?.[k]).slice(0, max);
        if (!v) continue;
        if (k === '处置' && !HOLD_KINDS.includes(v)) continue;
        out[k] = v;
    }
    return Object.keys(out).length ? out : null;
}
// 压着的：写了处置、又不是"直说"的
export const isHeld = x => !!x?.处置 && x.处置 !== '直说';

// 一行：事（对谁）——此刻的处置：闷着；不说的时候：……；……才会开口，挑……
export function heldLine(x) {
    const to = str(x.对谁) ? `（对${str(x.对谁)}）` : '';
    const why = str(x.为什么);
    const parts = [`眼下倾向${x.处置}${why ? `，因为${why}` : ''}`];
    if (str(x.不说时外显)) parts.push(`没说的时候可能会：${str(x.不说时外显)}`);
    const when = str(x.开口条件), where = str(x.说的场合);
    if (when) parts.push(`在等的机会：${when}`);
    if (where) parts.push(`想找的场合：${where}`);
    return `· ${str(x.事)}${to}——${parts.join('；')}`;
}

const bigrams = t => { const s = String(t ?? '').replace(/[^一-鿿A-Za-z0-9]/g, ''); const out = new Set(); for (let i = 0; i + 2 <= s.length; i++) out.add(s.slice(i, i + 2)); return out; };
export const overlap = (a, b) => { const x = bigrams(a), y = bigrams(b); if (!x.size || !y.size) return 0; let n = 0; for (const g of x) if (y.has(g)) n++; return n / Math.min(x.size, y.size); };

// 那一格里他的这一块：items＝[{ 事, 对谁, 处置, 开口条件, 不说时外显, 说的场合 }]（规划写的在前、开局单的在后；同一件只留头一条）
export const HELD_MAX = 4;
export function heldLines({ name, items = [] }) {
    const kept = [];
    for (const x of items) if (isHeld(x) && str(x.事) && !kept.some(k => overlap(k.事, x.事) >= 0.5)) kept.push(x);
    if (!kept.length) return [];
    return [`${name}心里压着的事（${personWord(name)}知道，不等于会说；每条后面是眼下的倾向和为什么，当下改主意也行）：`,
        ...kept.slice(0, HELD_MAX).map(heldLine)];
}

// 规划写的那条，他之后自己说出口了没有：规划锚点以后他名下的"说"，和这件事对得上（字面重合过半）、对方当时在场（写了对谁的话）。
// 只是提起要不要说、心里想说（记账记成"心里"）不算——前台写了说出口才算说了
export function saidSince(x, records, { name, since = -1, same = (a, b) => a === b }) {
    const to = str(x.对谁);
    return records.some(r => r.type === '说' && r.pos > since && same(r.holder_name, name)
        && (!to || (r.audience ?? []).some(a => same(a, to))) && overlap(x.事, r.text) >= 0.5);
}
