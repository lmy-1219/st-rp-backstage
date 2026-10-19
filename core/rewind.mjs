// 删回去以后后台自己对账（方案 删消息等于没发生过，10/9）：每次同步，给那时的最后一条记一份小快照——每件口袋在哪一步、谁在场谁远程谁在外头、
// 每人看得到哪几段。删回到某一条以后，把重算的结果和那条当时的快照比，对不上的在面板上亮一行、写日志。
// 以后新加的环节忘了挂在真正写出来的那条上，第一次删消息就会亮出来，不用用户自己去找。
// 比的时候：口袋只认快照那时已经有的那几步（之后才补记的不算），还没回的那一步不算（他正在写）；
// 群里的人有进有出（拉人、移出不是消息，删消息撤不回）的那几个人不比。题材无关。
import { boardFor } from './board.mjs';

const STEP = { waiting: '还没到', pocket: '在口袋里', offered: '在口袋里', shown: '拿出来了', used: '用上了', sunk: '沉了', sunk_told: '沉了', void: '撤了', expired: '过期了' };
const WHERE = { present: '在场', remote: '隔着消息电话', away: '在外头', absent: '不在', never: '没出场' };
const spanText = segs => (segs.length ? segs.map(s => `#${s.from}～${s.to == null ? '' : `#${s.to - 1}`}`).join('、') : '一段都没有');

function membersOf(chat) {
    try { return (JSON.parse(chat.members ?? '[]') ?? []).map(m => m?.name ?? m?.avatar ?? m).filter(Boolean).map(String); } catch { return []; }
}

// 此刻（最后一条）各处的样子。logUpTo：口袋只认到这一步为止
export function stateNow(store, records, chatKey, { logUpTo = null } = {}) {
    const chat = store.requireChat(chatKey);
    const messages = store.currentMessages(chatKey);
    const last = messages.at(-1);
    if (!last) return null;
    const pockets = Object.fromEntries((store.menuOf?.(chatKey, { settledOnly: true, logUpTo }) ?? []).map(m => [m.id, { title: m.title, step: STEP[m.status] ?? m.status }]));
    let people = {};
    try { people = Object.fromEntries(boardFor(store, records, chatKey, { present: [], recentUser: '' }).people.map(p => [p.name, WHERE[p.status] ?? p.status])); } catch {}
    let anchors = {};
    try { anchors = JSON.parse(chat.anchors ?? 'null') ?? {}; } catch {}
    const cast = store.getCast?.(chat.story_id) ?? [];
    const spans = {};
    for (const [avatar, rec] of Object.entries(anchors ?? {})) {
        const name = cast.find(e => e.avatar === avatar)?.name ?? rec?.name ?? avatar;
        // 只看到这一条为止的（之后的还没写）
        spans[name] = spanText((rec?.segments ?? []).filter(s => Number.isFinite(s?.from) && s.from <= last.pos).map(s => ({ from: s.from, to: s.to == null || s.to >= last.pos + 1 ? null : s.to })));
    }
    return { pos: last.pos, fp: last.fp, logMax: store.menuLogMax?.() ?? 0, pockets, people, spans, members: membersOf(chat) };
}

// 同步之前：给眼下的最后一条记快照（它当最后一条时最后的样子）
export function snapshot(store, records, chatKey) {
    const s = stateNow(store, records, chatKey);
    if (s) store.putSnapshot?.(chatKey, { pos: s.pos, fp: s.fp, data: s });
    return s;
}

// 两份比一比：对不上的几行（给人看的）
export function compareStates(then, now) {
    if (!then || !now) return [];
    const at = `#${then.pos}`;
    const out = [];
    for (const id of new Set([...Object.keys(then.pockets ?? {}), ...Object.keys(now.pockets ?? {})])) {
        const a = then.pockets?.[id], b = now.pockets?.[id];
        if ((a?.step ?? '不在单子上') !== (b?.step ?? '不在单子上')) out.push(`口袋「${a?.title ?? b?.title ?? id}」：${at} 那会儿是${a?.step ?? '不在单子上'}，现在算${b?.step ?? '不在单子上'}`);
    }
    const moved = new Set([...(then.members ?? [])].filter(m => !(now.members ?? []).includes(m)).concat((now.members ?? []).filter(m => !(then.members ?? []).includes(m))));
    for (const name of new Set([...Object.keys(then.people ?? {}), ...Object.keys(now.people ?? {})])) {
        if (moved.has(name)) continue;
        const a = then.people?.[name], b = now.people?.[name];
        if (a && b && a !== b) out.push(`${name}：${at} 那会儿${a}，现在算${b}`);
    }
    for (const name of new Set([...Object.keys(then.spans ?? {}), ...Object.keys(now.spans ?? {})])) {
        if (moved.has(name)) continue;
        const a = then.spans?.[name] ?? '一段都没有', b = now.spans?.[name] ?? '一段都没有';
        if (a !== b) out.push(`${name}看得到的：${at} 那会儿是 ${a}，现在是 ${b}`);
    }
    return out;
}

// 同步之后：删回去了（少了消息、没添新的），最后那条有快照——重算、比、对不上的记下来（面板亮一行、写日志）
export function checkRewind(store, records, chatKey, result) {
    if (!result?.committed || !(result.removed > 0) || result.added > 0) return [];
    const messages = store.currentMessages(chatKey);
    const last = messages.at(-1);
    const snap = last ? store.snapshotOf?.(chatKey, last.fp) : null;
    if (!snap) return [];
    const lines = compareStates(snap.data, stateNow(store, records, chatKey, { logUpTo: snap.data.logMax }));
    if (lines.length) {
        store.setMeta?.(`drift:${chatKey}`, JSON.stringify({ id: `${last.fp}:${Date.now()}`, at: last.pos, lines: lines.slice(0, 12) }));
        store.logEvent?.(chatKey, 'rewind_drift', { at: last.pos, lines });
    } else store.setMeta?.(`drift:${chatKey}`, null);
    return lines;
}
