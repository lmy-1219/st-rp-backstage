// 删消息就等于没发生过（方案 删消息等于没发生过，质量窗 → 主窗 10/9；用户 10/9："我希望我删消息的时候不用顾虑他的记忆现在到哪里了，
// 也不用到处找刚刚明明触发了的口袋为什么又接不上了"）。一条总规矩：后台推出来的、交给某人去演的，都挂在它真正写出来的那条消息上——
// 那条还在就算数，删了、换掉了就撤。这里是进场那份、"要联系"用掉的那一下、他后来自己进了场（enteredSince）；口袋那几步在 store.menuOf（pending），隔离区间在 liveAnchors。
// 题材无关。

import { randomUUID, createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { projectSource, sourceIndex, sourceMessage } from './source-basis.mjs';
import { sameIdentity, messageIsPerson, resolveIdentity } from './cast.mjs';
import { assertKnockReader } from './store.mjs';
const num = v => (Number.isFinite(Number(v)) ? Number(v) : null);
const scopeOf = (messages, entries) => [...entries.map(e => ({ name: e.who ?? e.name, avatar: e.avatar })),
    ...messages.filter(m => !m.is_user && /\.(png|webp|jpe?g|gif)$/i.test(m.speaker ?? '')).map(m => ({ name: m.name, avatar: m.speaker }))].filter(p => p.avatar && p.name);
const isHis = (m, e, roster = []) => messageIsPerson(m, resolveIdentity(roster, e).person ?? { ...e, name: e.who ?? e.name }, roster);

// 这次进场之后他那条回复：他进场以后、他下一次进场之前，第一条他开口的消息；没有就 null
function replyOf(e, messages, entries = []) {
    const at = num(e?.at);
    if (at == null) return null;
    const roster = scopeOf(messages, entries);
    const next = Math.min(Infinity, ...entries.filter(x => x !== e && isSame(x, e, roster) && num(x.at) > at).map(x => num(x.at)));
    return messages.find(m => m.pos >= at && m.pos < next && isHis(m, e, roster)) ?? null;
}
const isSame = (a, b, roster = []) => sameIdentity(a, b, roster);

// 隔离区间封上了、中间一条都没有（拉进来又移出去，他一句没说）：等于没进过场，也不算"刚走"
export const emptySegment = s => s?.to != null && num(s.to) != null && num(s?.from) != null && num(s.to) <= num(s.from);
// 这次进场开的那段（起点就是 at 的最后一段）封上了、他一句没说：用户 10/15——点了他发消息，前台没调成功，点头像让他说的那条对不上删了，
// 人移出去，进场记录还挂在进场前那条上，门上就再也不挂他了
const leftSilent = (e, anchors) => { const segs = (e?.avatar ? anchors?.[e.avatar]?.segments ?? [] : []).filter(s => num(s?.from) === num(e.at)); return segs.length > 0 && emptySegment(segs.at(-1)); };

// 新来源只认本次保存版本。旧的纯消息/人工区间仍保留各自契约。
// T150c：confirmFloor（确认楼）给了，at ≥ 确认楼的进场一律不算数（同 boardAt 口径）；不给就和以前一样
export function arrivalLive(e, messages, entries = [], anchors = null, sourceLive = null, phase = 'prepare', confirmFloor = null) {
    assertKnockReader(sourceLive, arrivalLive);
    if (confirmFloor != null && num(e?.at) != null && num(e.at) >= num(confirmFloor)) return false;
    // 明确的进场产物必须拿到当前窗口的完整结论；缺上下文不能自造无限分支，
    // unknown 也不能落回“后来本人说过话”。独立人工区间保留原契约。
    if (e?.source_basis || e?.recs?.length || e?.menus?.length)
        return sourceLive?.(e, { through: messages.at(-1)?.pos ?? -1, phase }) === true && !leftSilent(e, anchors);
    const at = num(e?.at);
    if (at == null || messages[at - 1]?.fp !== e.fp) return false;
    if (replyOf(e, messages, entries)) return true;
    return messages.length <= at && !leftSilent(e, anchors);
}

const json = (v, fallback = null) => { try { return JSON.parse(v ?? 'null') ?? fallback; } catch { return fallback; } };
// 存储适配器只取原始数据；判定交给纯模块，不回调 menuOf/visible/时间线。
const projections = new WeakMap();
const contexts = new WeakMap();
export function setSourceContext(db, context) { contexts.set(db, context); projections.delete(db); }
export function sourceProjection(db, chatKey) {
    const version = db.prepare('select total_changes() n').get().n;
    let cache = projections.get(db);
    if (!cache || cache.version !== version) projections.set(db, cache = { version, values: new Map() });
    if (!cache.values.has(chatKey)) cache.values.set(chatKey, readSourceProjection(db, chatKey));
    return cache.values.get(chatKey);
}
function readSourceProjection(db, chatKey) {
    const q = sql => db.prepare(sql);
    const chat = q('select * from chats where key = ?').get(chatKey);
    const chats = q('select key, parent_key, branch_len from chats where story_id = ?').all(chat.story_id);
    const context = contexts.get(db)?.(chatKey);
    const limits = context?.limits ?? new Map();
    const meta = key => json(q('select value from meta where key = ?').get(key)?.value);
    const drafts = meta(`door_handoffs:${chatKey}`) ?? [];
    const messages = q(`select s.pos, s.fp, s.hidden, s.sw, s.sent_at, m.is_user, m.speaker from chat_seq s
        join chats c on c.key = s.chat_key join messages m on m.story_id = c.story_id and m.fp = s.fp where s.chat_key = ? order by s.pos`).all(chatKey)
        .map(m => ({ ...m, doorRevision: drafts.find(d => d.pos === m.pos && d.fp === m.fp)?.revision ?? null }));
    const entries = chats.flatMap(c => (meta(`arrivals:${c.key}`) ?? []).map(e => ({ ...e, origin: c.key })));
    const legacy = new Map(), legacyMenus = new Map(), legacyEntries = new Map(), groups = new Map();
    const entryKey = e => JSON.stringify([e.origin ?? chatKey, e.avatar, Number(e.at), e.fp]);
    for (const e of entries) {
        if (e.source_basis || !(e.recs?.length || e.menus?.length)) continue;
        const key = entryKey(e), group = groups.get(key) ?? [];
        if (!group.some(x => isDeepStrictEqual(x, e))) group.push(e);
        groups.set(key, group);
    }
    const ambiguous = e => ({ version: 1, kind: 'arrival', id: `legacy:${entryKey(e)}`, origin: e.origin ?? chatKey,
        avatar: e.avatar, trigger: { pos: Number(e.at) - 1, fp: e.fp }, incomplete: '旧进场关联不唯一' });
    for (const [key, group] of groups) {
        const e = group[0];
        const executions = meta(`auto_execution:${e.origin}`) ?? [];
        const candidates = executions.filter(x => x.avatar === e.avatar && x.through + 1 === Number(e.at) && x.reply && x.state === 'delivered' && x.handoff);
        const exec = candidates.length === 1 ? candidates[0] : null;
        const handoff = exec?.handoff;
        const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
        const sourceMatches = exec?.source && (exec.source.startsWith('v2:')
            ? exec.source === 'v2:' + digest([exec.through, messages.filter(m => m.pos <= exec.through).map(m => [m.pos, m.fp, !!m.hidden])])
            : exec.source === digest([exec.through, e.fp]));
        const incomplete = candidates.length > 1 ? '旧执行关联不唯一'
            : !sourceMatches || handoff?.pos !== Number(e.at) - 1 || handoff?.fp !== e.fp || handoff?.avatar !== e.avatar ? '旧执行与进场来源不一致或缺证明'
            : !handoff?.revision || !Number.isInteger(exec?.reply?.sw) ? '旧关联缺原交接稿本或回复稿本凭据' : null;
        const basis = group.length > 1 ? ambiguous(e) : { version: 1, kind: 'arrival', id: exec?.id ?? `legacy:${e.origin}:${e.at}:${e.fp}`, origin: e.origin, avatar: e.avatar,
            trigger: { pos: Number(e.at) - 1, fp: e.fp }, sourceStep: e.sourceStep ?? null, handoff: handoff ?? null,
            basisDay: e.basisDay ?? null, delivery: exec?.reply ?? null, incomplete };
        legacyEntries.set(key, basis);
        // 一个旧产物也只能关联一个来源。冲突使涉及的整次来源一起 unknown，不能各口挑首项或末项。
        for (const [map, field] of [[legacy, 'recs'], [legacyMenus, 'menus']]) for (const id of new Set(group.flatMap(x => x[field] ?? []))) {
            const previous = map.get(id);
            if (previous && previous !== basis) previous.incomplete = basis.incomplete = '旧产物关联不唯一';
            map.set(id, previous ?? basis);
        }
    }
    const seen = new Set();
    const adapted = entries.filter(e => {
        if (!limits.has(e.origin)) return false;
        if (e.source_basis) return true;
        const key = entryKey(e);
        if (seen.has(key)) return false;
        seen.add(key); return true;
    }).map(e => ({ ...e, source_basis: e.source_basis ?? legacyEntries.get(entryKey(e)) }));
    const linkedBases = new Map();
    for (const e of entries) {
        const basis = e.source_basis ?? legacyEntries.get(entryKey(e));
        if (!basis) continue;
        const key = entryKey(e), previous = linkedBases.get(key);
        linkedBases.set(key, !previous || isDeepStrictEqual(previous, basis) ? basis : ambiguous(e));
    }
    const arrivalBasis = entry => entry.source_basis ?? ((entry.recs?.length || entry.menus?.length)
        ? legacyEntries.get(entryKey(entry)) : linkedBases.get(entryKey(entry))) ?? null;
    const index = sourceIndex({ messages, chatKey, limits, arrivals: adapted });
    const evaluate = (basis, options = {}) => {
        const dependencies = new Map();
        const related = adapted.filter(e => e.source_basis?.origin === basis?.origin && e.avatar === basis?.avatar
            && e.source_basis?.trigger?.pos === basis?.trigger?.pos && e.source_basis?.trigger?.fp === basis?.trigger?.fp);
        for (const b of [basis, ...related.map(e => e.source_basis)].filter(Boolean))
            if (!b.incomplete && !dependencies.has(b.id)) dependencies.set(b.id, context?.dependencies(b, options));
        return projectSource(basis, { ...index, dependencies }, options);
    };
    const arrival = (entry, options) => {
        const basis = arrivalBasis(entry);
        return basis ? evaluate(basis, options) : { state: 'unknown', reason: '缺唯一进场来源', pos: null };
    };
    const record = (row, options) => {
        const basis = typeof row.source_basis === 'string' ? json(row.source_basis) : row.source_basis;
        if (row.source_basis != null && !basis) return { state: 'unknown', reason: '来源 JSON 无效', pos: null };
        const source = basis ?? legacy.get(row.id);
        if (source) return evaluate(source, options);
        if (row.job_id == null) return { state: 'live', reason: '普通正文来源', pos: row.pos };
        const ref = json(row.source_instance), candidates = index.byFp.get(row.fp) ?? [];
        const positions = ref?.pos == null ? json(q('select positions from extract_jobs where id = ?').get(row.job_id)?.positions, []) : [];
        const instance = uniqueOrdinarySource(row, candidates, ref, Array.isArray(positions) ? positions : []);
        if (instance && !meta(`ordinary_collision:${chatKey}:${row.fp}:${instance.sent_at}`)) return { state: 'live', pos: instance.pos };
        return { state: 'unknown', reason: '普通账来源实例不唯一', pos: ref?.pos ?? (positions.length === 1 ? positions[0] : null) };
    };
    return { index, entries, legacy, legacyMenus, arrivalBasis, evaluate, arrival, record };
}

function uniqueOrdinarySource(row, candidates, ref, positions) {
    if (row.source_instance == null) return candidates.length === 1 && candidates[0].sent_at && positions.includes(candidates[0].pos) ? candidates[0] : null;
    if (ref?.fp !== row.fp || ref.ambiguous || !ref.sentAt || !Number.isInteger(ref.pos) || (ref.legacy && candidates.length !== 1)) return null;
    const [m, duplicate] = candidates.filter(m => m.sent_at === ref.sentAt);
    return m && !duplicate && (m.sw === ref.sw || ref.legacy && ref.sw == null) && (ref.revision == null || m.doorRevision === ref.revision) ? m : null;
}

// 基础候选先补入有明确旧关联的 ID；gone: / 被搬过的 fp 不能在 SQL join 时丢失。
export function sourceRows(db, chatKey, { status = 'ok', type = null, through = Infinity, rawBasis = false } = {}) {
    const projection = sourceProjection(db, chatKey), ids = [...projection.legacy.keys()];
    const rows = db.prepare(`select r.*, min(s.pos) pos from records r join chats c on c.key = ? and c.story_id = r.story_id
        left join chat_seq s on s.chat_key = c.key and s.fp = r.fp
        where r.status = ? ${type ? 'and r.type = ?' : ''}
        and (s.pos is not null or r.source_basis is not null ${ids.length ? `or r.id in (${ids.map(() => '?').join(',')})` : ''})
        group by r.id`).all(chatKey, status, ...(type ? [type] : []), ...ids);
    const visible = [], rejected = [];
    for (const row of rows) {
        const state = projection.record(row, { through, rawBasis });
        if (state.state !== 'live') rejected.push({ id: row.id, fp: row.fp, status: row.status, ...state, recoverable: state.state !== 'unknown' });
        if (state.pos == null || state.pos > through || state.state === 'not-live') continue;
        const source_basis = json(row.source_basis) ?? projection.legacy.get(row.id) ?? null;
        visible.push({ ...row, original_fp: row.fp, fp: source_basis?.delivery?.fp ?? row.fp, pos: state.pos, source_basis, source_unknown: state.state === 'unknown' });
    }
    visible.sort((a, b) => a.pos - b.pos || a.id - b.id);
    return { rows: visible, rejected, projection };
}

export function arrivalBasis(store, chatKey, { avatar, trigger, sourceStep = null, handoff = null, basisDay = null }) {
    const messages = store.currentMessages(chatKey);
    const step = sourceStep ? { ...sourceStep, ...sourceMessage(messages.find(m => m.pos === sourceStep.pos && m.fp === sourceStep.fp)) } : null;
    return { version: 1, kind: 'arrival', id: randomUUID(), origin: chatKey, avatar,
        trigger: sourceMessage(trigger), sourceStep: step,
        handoff: handoff ? { ...sourceMessage(messages.find(m => m.pos === handoff.pos && m.fp === handoff.fp)),
            pos: handoff.pos, fp: handoff.fp, revision: handoff.revision, avatar: handoff.avatar, way: handoff.way } : null,
        basisDay, delivery: null };
}

export function cancelArrival(store, chatKey, id) {
    const entries = json(store.getRawMeta(`arrivals:${chatKey}`), []);
    const entry = entries.find(e => e.source_basis?.id === id);
    if (!entry || entry.source_basis.delivery) return false;
    store.setMeta(`arrivals:${chatKey}`, JSON.stringify(entries.filter(e => e !== entry)));
    const arrived = json(store.getRawMeta(`arrived:${chatKey}`));
    if (arrived?.source_basis?.id === id) store.setMeta(`arrived:${chatKey}`, null);
    return true;
}

// 保存回执只绑定一次；改稿/后来的本人发言绝不重新绑定。
export function bindArrivalReceipts(store, records, chatKey, receipts = []) {
    if (!Array.isArray(receipts) || !receipts.length) return 0;
    let bound = 0;
    for (const receipt of receipts) {
        const entries = json(store.getRawMeta(`arrivals:${chatKey}`), []);
        const entry = entries.find(e => e.source_basis?.id === receipt.id && e.avatar === receipt.avatar);
        if (!entry || entry.source_basis.delivery || entry.source_basis.origin !== chatKey) continue;
        const message = store.currentMessages(chatKey).find(m => m.pos === receipt.pos && m.fp === receipt.fp && !m.hidden
            && !m.is_user && m.speaker === receipt.avatar && (m.sw ?? null) === (receipt.sw ?? null) && (m.sent_at ?? null) === (receipt.sentAt ?? null));
        if (!message || message.pos !== Number(entry.at)) continue;
        const basis = { ...entry.source_basis, delivery: { ...sourceMessage(message), execution: receipt.execution ?? null } };
        if (sourceProjection(store.db, chatKey).evaluate(basis).state !== 'live') continue;
        entry.source_basis = basis;
        store.setMeta(`arrivals:${chatKey}`, JSON.stringify(entries));
        const arrived = json(store.getRawMeta(`arrived:${chatKey}`));
        if (arrived?.source_basis?.id === basis.id) store.setMeta(`arrived:${chatKey}`, JSON.stringify({ ...arrived, source_basis: basis }));
        // 只补交付元数据，原始 fp/status/id 保持原样。
        if (entry.recs?.length) {
            const update = store.db.prepare('update records set source_basis = ? where id = ? and story_id = ? and source_basis is not null');
            for (const id of entry.recs) update.run(JSON.stringify(basis), id, store.requireChat(chatKey).story_id);
        }
        for (const id of entry.menus ?? []) store.setMeta(`event_source:${id}`, JSON.stringify(basis));
        bound++;
    }
    return bound;
}

// 保留旧导出供下游显式迁移；同步已不调用，也不再搬动任何记录。
export const GONE = 'gone:';
export const relinkArrivals = () => 0;

// 隔离扩展记的在场区间，按两头那条消息的时间认回这条序列里的位置（后台按条号认的话，删回去以后新写在同样条号上的消息也会被当成他在场）：
// - 起点那条（他进场前那条）没了：照条号认起点（左滑重来过的那条日期会变；整段删回去重写的，结尾那一步截完是空的）；
// - 只有结尾那条（他离场前看到的最后一条）没了：截到还在的、比他离场时间早的最后一条——删回去以后新写的消息时间都更晚，不会算进来；
// - 没记时间的（老数据、从头就在的）照条号。dates：这条序列里每条的发送时间（ST 的 send_date）
export function liveAnchors(anchors, dates = []) {
    if (!anchors || typeof anchors !== 'object') return anchors;
    const at = d => (d ? dates.indexOf(String(d)) : -1);
    const time = d => Date.parse(d ?? '');
    const out = {};
    for (const [key, rec] of Object.entries(anchors)) {
        if (!rec || !Array.isArray(rec.segments)) { out[key] = rec; continue; }
        const segments = [];
        for (const s of rec.segments) {
            if (!s || typeof s !== 'object') continue;
            let from = s.from, to = s.to;
            // 起点那条找不到：照条号（隔离扩展也是这样，前台、后台认的得是同一段）。封上的段不再整段作废（用户 10/14：那条进场后被左滑重来过、
            // 日期变了，人一移出整段在场作废，退回上一回进场的记忆）——结尾照下面只收他离场前写下的，删回去重写的照样进不来
            if (s.fromDate) { const i = at(s.fromDate); if (i >= 0) from = i + 1; }
            if (to != null && s.toDate) {
                const i = at(s.toDate);
                if (i >= 0) to = i + 1;
                else {
                    const limit = time(s.toDate);
                    let j = -1;
                    if (Number.isFinite(limit)) dates.forEach((d, n) => { const t = time(d); if (Number.isFinite(t) && t < limit) j = n; });
                    if (j + 1 <= from) continue;
                    to = j + 1;
                }
            }
            segments.push({ ...s, from, to });
        }
        out[key] = { ...rec, segments };
    }
    return out;
}

// T154c：分支只继承切出（共有前缀 k 楼）以前的在场区间（D-403）。ST 开分支时把父窗的元数据整份复制过来，里面带着父窗 k 楼以后的区间；
// 分支自己后来写的区间要留下。区分办法：起点（fromDate）那一楼的发送时间在分支自己的序列里、而且位置在 k 以后，才算分支自己的。
// - 起点 from > k：只收起点是分支自己那一楼的；from === k：起点那条是共有的、分辨不出，父窗那边有一模一样的一段就当是父窗带来的丢掉，否则收；
// - 起点在 k 以前、结尾 to ≥ k：结尾那条是分支自己的就留着，否则截到 k（还开着，和父窗删回 k 楼那时一样）；
// - 拿不准（没记时间）按父窗带来的算。k 不是整数就原样还回去。parentRaw：父窗存的原样区间（认 from === k 那一种）。
export function cutBranchAnchors(anchors, { k, dates = [], parentRaw = null } = {}) {
    if (!anchors || typeof anchors !== 'object' || !Number.isSafeInteger(k) || k < 0) return anchors;
    const own = (d, from) => !!d && from - 1 >= k && dates[from - 1] === String(d);   // 起点那一楼在分支序列里的同一位置对得上才算；只是别处出现过不算
    const parentHas = (key, s) => (parentRaw?.[key]?.segments ?? []).some(p => p && p.from === s.from && (p.fromDate ?? '') === (s.fromDate ?? ''));
    const out = {};
    for (const [key, rec] of Object.entries(anchors)) {
        if (!rec || !Array.isArray(rec.segments)) { out[key] = rec; continue; }
        const segments = [];
        for (const s of rec.segments) {
            if (!s || typeof s !== 'object' || !Number.isFinite(s.from)) { segments.push(s); continue; }
            if (s.from > k ? !own(s.fromDate, s.from) : s.from === k && parentHas(key, s)) continue;
            // 结尾超过切出点：那是父窗未来才发生的离场，分支不继承（D-403），按还开着算；只有结尾那一楼和分支序列同一位置对得上（分支自己写的离场）才收
            const ownEnd = s.toDate && s.to - 1 >= k && dates[s.to - 1] === String(s.toDate);
            segments.push(s.to != null && s.to > k && !ownEnd ? { ...s, to: null, ...('toDate' in s ? { toDate: '' } : {}) } : s);
        }
        out[key] = { ...rec, segments };
    }
    return out;
}

// 他在 pos 那条以后自己进了场没有（场记章程 第二节第 3、10 条，试玩 10/10：结算替他写了"要联系"，之后他自己打来电话、人也在戏里，
// 门上那条还挂着、还被当成"没人接"又结算了两回）。按消息认，删回去就回来：
// - 隔离区间（liveAnchors 认过的那份，按 avatar）有一段从 pos 以后开始、开头那条还在这条序列里，而且这段不是一次作废了的进场开的
//   （和场面表 board.liveSegment 一样：起点上记过他进场、那几次全不算数了，这段就不算）；
// - 或者进场记录里有他一次 at 在 pos 以后、而且这次进场还算数（arrivalLive）。
// 远程（电话、消息）进来的也算：他已经亲自出面说过话了，后台替他挂的那一下就过时了
// T150b：confirmFloor（确认楼）及以后只认隔离区间（前端送来的新区间），进场记录里 at ≥ 确认楼的不看；不给就和以前一样
export const confirmFloorOf = (store, chatKey) => { const v = store?.getMeta?.(`confirm_floor:${chatKey}`); return v == null || !Number.isSafeInteger(Number(v)) ? null : Number(v); };
export function enteredSince(pos, { who = null, avatar = null, messages = [], anchors = null, arrivals = [], knockLive = null, confirmFloor = null } = {}) {
    assertKnockReader(knockLive, enteredSince);
    const p = num(pos);
    if (p == null || (!who && !avatar)) return false;
    const floor = confirmFloor == null ? null : num(confirmFloor);
    const entries = (Array.isArray(arrivals) ? arrivals.filter(Boolean) : []).filter(e => floor == null || !(num(e.at) >= floor));
    const me = { who, avatar };
    const mine = entries.filter(e => isSame(e, me, scopeOf(messages, entries)));
    // 明确来源只查一次事实结论；普通对象保留原来源预检和消息/人工区间契约。
    const live = e => (e.source_basis || e.recs?.length || e.menus?.length || knockLive?.(e, { phase: 'prepare' }) !== false)
        && arrivalLive(e, messages, entries, anchors, knockLive, 'fact', floor);
    const segs = avatar ? anchors?.[avatar]?.segments : null;
    const segLive = s => { if (floor != null && s.from >= floor) return true; const atStart = mine.filter(e => num(e.at) === s.from); return !atStart.length || atStart.some(live); };
    if (Array.isArray(segs) && segs.some(s => Number.isFinite(s?.from) && s.from > p && s.from <= messages.length && !emptySegment(s) && segLive(s))) return true;
    return mine.some(e => num(e.at) > p && live(e));
}

// 旁白替他递过消息、来电，他从门上进来接着这条说（场记章程 B1）：进场时替他记一笔"他刚给玩家发过消息……"（他和玩家都知道；
// 返回的编号由调用的人放进这次进场的 recs，relinkArrivals 把它挂到他那条回复上——以后他也想得起是自己发的）；
// 那件口袋标用掉：这一步挂在进场前那条上、等他那条回复（store.menuOf 的 pending），他那条删了、换了别人在说，就回到"拿出来了"、门上又挂他。
// sent：门上那一项的 sent（{ id, way, surface, respond }）；at：他从哪条起在场；fp：进场前那条的指纹
export function landSent(store, records, { chatKey, storyId, who, avatar = null, userName = '玩家', sent, at, fp, source_basis = null }) {
    if (!sent?.surface || !fp || !Number.isInteger(at)) return null;
    const verb = sent.way === '电话' ? '打过电话' : '发过消息';
    const rec = records?.addDerived ? records.addDerived({ storyId, fp, type: '做', text: `${who}刚给${userName}${verb}：${sent.surface}`.slice(0, 200), holder: avatar ?? `name:${who}`, holderName: who, audience: [who, userName], about: who, source_basis }) : null;
    if (Number.isInteger(sent.id) && store?.updateMenu) store.updateMenu(chatKey, sent.id, { status: 'used', by: who, pending: true, at: { pos: at - 1, fp } });
    return rec;
}

// 结算写的"要联系"用掉了没有：用掉那一下记在哪条（usedAt），那条还在才算；进场用掉的，还要他那条回复在（同进场）。
// 写下它以后他自己进了场（enteredSince）也算用掉——他人都来过了，这条不用再等人点。entries：进场记录（arrivals）；
// opts：{ anchors, who, avatar }（不给就只认 usedAt，老调用照旧）。老数据只有 used: true，照旧算用掉
export function contactUsed(c, messages, entries = [], opts = {}) {
    assertKnockReader(opts.knockLive, contactUsed);
    if (!c) return false;
    const who = opts.who ?? c.who ?? null, avatar = opts.avatar ?? c.avatar ?? null;
    if (c.at != null && enteredSince(c.at, { who, avatar, messages, anchors: opts.anchors ?? null, arrivals: entries, knockLive: opts.knockLive, confirmFloor: opts.confirmFloor ?? null })) return true;
    if (!c.usedAt) return !!c.used;
    const u = c.usedAt;
    if (u.arrivalId) { const e = entries.find(e => e.source_basis?.id === u.arrivalId); return !!e && arrivalLive(e, messages, entries, opts.anchors, opts.knockLive, 'fact', opts.confirmFloor ?? null); }
    const linked = entries.filter(e => Number(e.at) === u.pos + 1 && e.fp === u.fp
        && isSame(e, { who: u.who, avatar: u.avatar }, scopeOf(messages, entries)));
    if (linked.length) return linked.some(e => arrivalLive(e, messages, entries, opts.anchors, opts.knockLive, 'fact', opts.confirmFloor ?? null));
    if (messages[u.pos]?.fp !== u.fp) return false;
    if (!u.who) return true;
    return messages.length <= u.pos + 1 || messages.slice(u.pos + 1).some(m => isHis(m, { who: u.who, avatar: u.avatar ?? null }, scopeOf(messages, entries)));
}
