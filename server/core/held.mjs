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
export function secretKeepNote(x) {
    const hidden = Array.isArray(x.不让谁知道) ? x.不让谁知道 : [];
    return hidden.length ? hidden.includes('除知道的人以外') ? '这件事不能让别人知道（守不守、怎么守，照你自己的性子和你跟他们的关系）。' : `这件事不能让${hidden.join('、')}知道（守不守、怎么守，照你自己的性子和你跟他们的关系）。` : '';
}

// 一行：事（对谁）——此刻的处置：闷着；不说的时候：……；……才会开口，挑……
export function heldLine(x) {
    const to = str(x.对谁) ? `（对${str(x.对谁)}）` : '';
    const why = str(x.为什么);
    const parts = [`眼下倾向${x.处置}${why ? `，因为${why}` : ''}`];
    if (str(x.不说时外显)) parts.push(`没说的时候可能会：${str(x.不说时外显)}`);
    const when = str(x.开口条件), where = str(x.说的场合);
    if (when) parts.push(`在等的机会：${when}`);
    if (where) parts.push(`想找的场合：${where}`);
    const secret = secretKeepNote(x);
    return `· ${str(x.事)}${to}——${parts.join('；')}${secret ? `；${secret}` : ''}`;
}

export function secretLeaksOf(store, chatKey) {
    try { const value = JSON.parse(store.getMeta(`secret_leaks:${store.requireChat(chatKey).story_id}`) ?? '[]'); return Array.isArray(value) ? value : []; } catch { return []; }
}
export function activeLeaks(store, records, chatKey) {
    const ids = new Set((records?.visible?.(chatKey) ?? []).map(r => r.id));
    return secretLeaksOf(store, chatKey).filter(x => Number.isInteger(x.proof) && ids.has(x.proof));
}
// 只投影当前有效的认知，不写回用户填写的开局单。
export function withSecretLeaks(data, leaks = []) {
    if (!data || !leaks.length) return data;
    return { ...data, 前史: (data.前史 ?? []).map(row => {
        const known = leaks.filter(x => x.source === 'setup' && x.事 === row.事).map(x => x.谁知道了);
        if (!known.length) return row;
        return { ...row, 谁知道: [...new Set([...(row.谁知道 ?? []), ...known])], 不让谁知道: (row.不让谁知道 ?? []).filter(n => !known.includes(n)) };
    }) };
}
export function secretCandidates(store, chatKey, records = null) {
    const story = store.requireChat(chatKey).story_id, setup = store.setupOf(story)?.data;
    const people = [...new Set([...store.getCast(story).filter(p => p.role !== '不用').map(p => p.name), ...(store.playerNames?.(story) ?? []), ...(setup?.主角团 ?? [])].filter(Boolean))];
    const leaked = activeLeaks(store, records, chatKey), rows = [];
    for (const x of setup?.前史 ?? []) {
        if (x.过时 || !x.不让谁知道?.length || !x.谁知道?.length) continue;
        const denied = x.不让谁知道.includes('除知道的人以外') ? people.filter(n => !x.谁知道.includes(n)) : x.不让谁知道.filter(n => people.includes(n) && !x.谁知道.includes(n));
        rows.push({ source: 'setup', 事: x.事, 知道: x.谁知道, 不让: denied });
    }
    const plan = store.lastReadyPlan(chatKey), node = plan?.node ? JSON.parse(plan.node) : null;
    for (const x of node?.心事 ?? node?.心里压着的事 ?? []) if (x.处置 === '瞒着' && str(x.事) && str(x.对谁)) rows.push({ source: 'plan', 事: x.事, 知道: [x.谁], 不让: str(x.对谁).split(/[、,，]/).map(s => s.trim()).filter(n => people.includes(n) && n !== x.谁) });
    return rows.map(x => ({ ...x, 不让: x.不让.filter(n => !leaked.some(l => l.事 === x.事 && l.谁知道了 === n)) })).filter(x => x.不让.length);
}
export function recordSecretLeaks(store, { chatKey, candidates, leaks, evidence = [], at = null }) {
    const story = store.requireChat(chatKey).story_id, old = secretLeaksOf(store, chatKey), accepted = [];
    const visibleIds = new Set(evidence.map(r => r.id));
    const current = old.filter(x => Number.isInteger(x.proof) && visibleIds.has(x.proof));
    const roster = store.getCast(story), person = value => roster.find(x => x.avatar === value)?.name ?? value;
    const flat = value => String(value ?? '').replace(/\s/g, '');
    for (const row of leaks ?? []) {
        const match = candidates.find(x => x.事 === row.事 && x.不让.includes(row.谁知道了));
        if (!match || current.concat(accepted).some(x => x.事 === row.事 && x.谁知道了 === row.谁知道了) || /猜|怀疑|可能|推测/.test(row.怎么 ?? '') || flat(row.依据).length < 3) continue;
        // 必须引用实际记下的证据，且这条事实确实到了该人：说话的受众、亲历者或亲自说出的事实。
        const proof = evidence.find(r => !r.fabricated && !r.guess && ['说', '做', '改变', '了结'].includes(r.type) && !/不知道|不知情|没听见|没看到|未得知|只是猜|怀疑/.test(row.依据) && flat(r.text).includes(flat(row.依据)) && (person(r.holder_name ?? r.holder) === row.谁知道了 || (r.audience ?? []).map(person).includes(row.谁知道了)));
        if (!proof || !Number.isInteger(proof.id)) continue;
        accepted.push({ 事: row.事, 谁知道了: row.谁知道了, 怎么: str(row.怎么).slice(0, 150), 依据: str(row.依据).slice(0, 300), 谁漏的: proof.type === '说' ? person(proof.holder_name ?? proof.holder) : '', source: match.source, proof: proof.id, at });
    }
    if (!accepted.length) return [];
    store.setMeta(`secret_leaks:${story}`, JSON.stringify(old.concat(accepted)));
    store.setMeta(`secret_notice:${chatKey}`, JSON.stringify({ id: `secret:${old.length + accepted.length}`, text: '有件瞒着的事被人知道了，下一份规划会接上。' }));
    return accepted;
}
export function secretLeakLines(leaks = []) {
    return leaks.length ? ['【秘密漏了】', ...leaks.map(x => `· ${x.事}；${x.谁知道了}已经知道了；怎么知道：${x.怎么}${x.谁漏的 ? `；谁漏的：${x.谁漏的}` : ''}`), '这一份排出后果：知道的人怎么反应、漏的人怎么面对；已经漏给这个人的不再当成还瞒着。'] : [];
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
