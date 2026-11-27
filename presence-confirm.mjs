// T150a：「从这一楼起按新记法」的确认记录。
// 记录写在确认楼那条消息上（extra.rpeConfirm 窗级标记 + extra.rpePresence 里每人一条 manual 事件），
// 跟着消息走：分支切在确认楼之后带着它，切在之前就没有。退回标记写在聊天元数据（rpeConfirmReverted）。
import { derivePresence, eventId, rowsFromChat } from './presence-events.mjs';
import { isCamera, speakerOf } from './sync.mjs';

const object = value => value != null && typeof value === 'object' && !Array.isArray(value);
const nonempty = value => typeof value === 'string' && value.trim() !== '';
const integer = (value, min = 0) => Number.isSafeInteger(value) && value >= min;
const stamp = value => JSON.stringify(value, (_, v) => object(v)
    ? Object.fromEntries(Object.keys(v).sort().map(key => [key, v[key]])) : v);
const draft = m => stamp([speakerOf(m), m.mes, m.swipe_id, m.swipes, m.swipe_info, m.hidden, m.is_system, m.is_user, m.send_date]);
const outcome = (stage, reason, status = 'uncovered') => ({ status, stage, reason });
const choices = new Map([['present', { action: 'enter', way: '当面', state: 'present' }],
    ['remote', { action: 'enter', way: '远程', state: 'remote' }], ['absent', { action: 'leave', way: null, state: 'absent' }]]);

const validRecord = record => object(record) && record.schema === 1 && nonempty(record.opKey) && integer(record.version, 1)
    && object(record.carrier) && Object.keys(record.carrier).sort().join() === 'fp,sid,sw'
    && nonempty(record.carrier.sid) && nonempty(record.carrier.fp) && integer(record.carrier.sw);

function idsOf(chat, field) {
    const seen = new Set();
    for (const message of chat) {
        const top = message?.[field], nested = message?.extra?.[field];
        if (top != null && nested != null && top !== nested) return null;
        const id = nested ?? top;
        if (id == null) continue;
        if (!nonempty(id) || seen.has(id)) return null;
        seen.add(id);
    }
    return seen;
}

// 本窗的确认楼：{ floor, state: none|active|reverted|stale, reason, opKey }。
// 只看消息上的记录，元数据只用来读「退回」标记，和删楼提示（rpeConfirmHint，只在整条记录找不到时用）。
export function confirmedFloor(chat, { metadata = {}, generating = null, fallbackAvatar = null, through, chatKey = null } = {}) {
    const part = Array.isArray(chat) ? chat.slice(0, integer(through, -1) ? through + 1 : chat.length) : [];
    const rows = rowsFromChat(part, fallbackAvatar, generating);
    const found = rows.flatMap((row, at) => row?.extra && Object.hasOwn(row.extra, 'rpeConfirm') ? [{ at, row, record: row.extra.rpeConfirm }] : []);
    const result = (floor, state, reason, opKey = null) => ({ floor, state, reason, opKey });
    if (!found.length) {
        const hint = metadata?.rpeConfirmHint;
        return object(hint) && integer(hint.at) && part.length > hint.at && chatKey != null && hint.chatKey === chatKey
            ? result(hint.at, 'stale', 'confirm-deleted', hint.opKey ?? null) : result(null, 'none', 'no-confirm');
    }
    const { at, row, record } = found.at(-1);
    if (!validRecord(record)) return result(at, 'stale', 'record-invalid');
    const { carrier, opKey } = record, reverted = metadata?.rpeConfirmReverted;
    if (object(reverted) && reverted.opKey === opKey && reverted.at === at && reverted.fp === carrier.fp)
        return result(at, 'reverted', 'reverted', opKey);
    if (row.hidden || row.is_system) return result(at, 'stale', 'carrier-hidden', opKey);
    if (row.revisionPending || row.swipe_id !== carrier.sw) return result(at, 'stale', 'carrier-swiped', opKey);
    if (row.fp !== carrier.fp) return result(at, 'stale', 'carrier-edited', opKey);
    if (row.extra?.rpeSourceId !== carrier.sid || rows.filter(other => other?.extra?.rpeSourceId === carrier.sid).length !== 1)
        return result(at, 'stale', 'carrier-ambiguous', opKey);
    return result(at, 'active', 'confirmed', opKey);
}

// 从确认楼起算的场面：把确认楼之前整段切掉，确认楼上的 manual 事件就是每个人的起点，其余照 derivePresence。
export function confirmedPresence(input) {
    const { chat, roster, metadata, generating = null, fallbackAvatar = null, chatKey = null } = input;
    const through = integer(input.through, -1) ? input.through : chat.length - 1;
    const found = confirmedFloor(chat, { metadata, generating, fallbackAvatar, through, chatKey });
    if (found.state !== 'active') return { ...found, byAvatar: null, unresolved: [], length: 0 };
    const { floor } = found;
    const result = derivePresence({ chat: chat.slice(floor), roster, fallbackAvatar, generating, through: through - floor });
    const byAvatar = Object.fromEntries(Object.entries(result.byAvatar).map(([avatar, person]) => [avatar, {
        intervals: person.intervals.map(({ from, to }) => ({ from: from + floor, to: to === null ? null : to + floor })),
        changes: person.changes.map(change => ({ ...change, at: change.at + floor })),
    }]));
    const unresolved = result.unresolved.map(issue => ({ ...issue, at: integer(issue.at) ? issue.at + floor : issue.at }));
    return { ...found, byAvatar, unresolved, length: result.length + floor };
}

// T150b：把送给后台的隔离区间换成「确认楼之前照旧（截到确认楼为止），确认楼及以后用新记录算出的区间」。
// old：原来的 anchors（{ avatar: { segments, ...其余字段 } }），不改动它；没有就当空。
export function composeAnchors(old, view) {
    const out = {}, floor = view.floor;
    for (const [avatar, rec] of Object.entries(object(old) ? old : {})) {
        if (!object(rec) || !Array.isArray(rec.segments)) { out[avatar] = rec; continue; }
        const segments = [];
        for (const segment of rec.segments) {
            if (!object(segment) || !(segment.from < floor)) continue;
            if (segment.to == null || segment.to > floor) {
                const { toDate, ...rest } = segment;
                segments.push({ ...rest, to: floor });
            } else segments.push(segment);
        }
        out[avatar] = { ...rec, segments };
    }
    for (const [avatar, person] of Object.entries(view.byAvatar ?? {})) {
        const fresh = person.intervals.map(({ from, to }) => ({ from, to }));
        out[avatar] = { ...out[avatar], segments: [...(out[avatar]?.segments ?? []), ...fresh] };
    }
    return out;
}

// 同步用：状态 active 时给出新 anchors 和确认楼；其余状态一字不改（anchors 原样返回，不带确认楼）。
export function confirmedSync(input) {
    const view = confirmedPresence(input);
    if (view.state !== 'active') return { state: view.state, floor: null, anchors: input.anchors ?? null, view };
    return { state: 'active', floor: view.floor, anchors: composeAnchors(input.anchors, view), view };
}

// 此刻在场或远程的人（头像集合）：确认楼起算的区间里还开着的。
export function presentAvatars(view) {
    return new Set(Object.entries(view?.byAvatar ?? {}).filter(([, person]) => person.intervals.at(-1)?.to === null).map(([avatar]) => avatar));
}

// T150c：角色看得到的历史读哪一份 anchors（visibleNow / cutByPresence 旧路径、boardDecision 受保护路径共用）。
// view：confirmedSync 的结果里的 { floor, anchors }（只有 active 才给）；第三方隔离扩展开着就一律读原来的，floor 给 null。
export function historyAnchors({ anchors, view = null, thirdParty = false }) {
    if (thirdParty || !view || view.floor == null) return { anchors, floor: null };
    return { anchors: view.anchors, floor: view.floor };
}

// 退回旧读法：把标记写进聊天元数据，只对应当前这一条确认记录。
export function revertConfirm(chat, metadata, options = {}) {
    const found = confirmedFloor(chat, { ...options, metadata });
    if (found.state !== 'active' && found.state !== 'stale' || !found.opKey) return outcome('revert', 'no-record');
    const row = chat[found.floor];
    metadata.rpeConfirmReverted = { opKey: found.opKey, at: found.floor, fp: row.extra.rpeConfirm.carrier.fp };
    return { status: 'reverted', stage: 'revert', reason: 'reverted', floor: found.floor };
}

export function captureConfirm({ chat }, floor) {
    const message = chat[floor], original = object(message) ? draft(message) : null;
    return { floor, message, current: () => object(message) && chat[floor] === message && draft(message) === original };
}

function floorFailure(chat, row, message, floor, generating) {
    if (!row) return 'empty-floor';
    if (row.hidden) return 'hidden-floor';
    if (row.is_system) return 'system-floor';
    if (!row.fp || typeof message.mes !== 'string') return 'carrier-invalid';
    if (!row.mes.trim()) return 'empty-floor';
    if (generating?.message === message || generating?.active && floor === chat.length - 1 && !message.is_user) return 'floor-generating';
    if (row.revisionPending) return 'floor-unsettled';
    if (!integer(row.swipe_id) || !integer(message.swipe_id)) return 'carrier-invalid';
    return null;
}

// list：[{ avatar, state: 'present'|'remote'|'absent', way? }]；认人只看 avatar，同名各列各的。
export function writeConfirm({ chat, metadata, roster, generating = null, chatKey = null }, floor, list, { newId, opKey = newId, capture } = {}) {
    const reject = reason => outcome('prepare', reason);
    if (!integer(floor) || floor >= chat.length || !object(chat[floor])) return reject('floor-invalid');
    const message = chat[floor], extra = message.extra;
    if (capture && (capture.message !== message || capture.floor !== floor || !capture.current())) return reject('carrier-changed');
    const row = rowsFromChat(chat, null, generating)[floor];
    const failure = floorFailure(chat, row, message, floor, generating);
    if (failure) return reject(failure);
    if (extra != null && !object(extra)) return reject('carrier-invalid');

    const cards = (roster ?? []).filter(card => nonempty(card?.avatar) && !card.avatar.startsWith('face:') && !isCamera(card));
    if (!Array.isArray(list) || !list.length) return reject('empty-roster');
    const listed = new Set();
    for (const item of list) {
        if (!object(item) || !nonempty(item.avatar)) return reject('avatar-not-in-roster');
        const matches = cards.filter(card => card.avatar === item.avatar).length;
        if (!matches) return reject('avatar-not-in-roster');
        if (matches > 1) return reject('avatar-ambiguous');
        if (listed.has(item.avatar)) return reject('duplicate-avatar');
        const choice = choices.get(item.state);
        if (!choice) return reject('state-invalid');
        if (item.way != null && item.way !== choice.way) return reject('way-invalid');
        listed.add(item.avatar);
    }

    const sources = idsOf(chat, 'rpeSourceId');
    if (!sources || !idsOf(chat, 'rpeMessageId')) return reject('instance-id-conflict');
    const existing = extra?.rpeSourceId ?? message.rpeSourceId, key = opKey(), sid = existing ?? newId();
    if (!nonempty(key) || !nonempty(sid) || existing == null && sources.has(sid)) return reject('instance-id-conflict');

    const others = chat.flatMap((m, at) => at !== floor && m?.extra && Object.hasOwn(m.extra, 'rpeConfirm') ? [at] : []);
    if (others.some(at => at > floor)) return reject('confirm-before-existing');
    const old = extra?.rpeConfirm, oldKey = old?.opKey;
    if (old != null && (!validRecord(old) || oldKey === key)) return reject('op-conflict');
    if (extra && Object.hasOwn(extra, 'rpePresence') && !Array.isArray(extra.rpePresence)) return reject('event-slot-invalid');
    const kept = (extra?.rpePresence ?? []).filter(event => !(oldKey && event?.source === 'manual' && String(event.opKey).startsWith(oldKey + ':')));
    if (kept.some(event => event?.source === 'manual' && listed.has(event.avatar))) return reject('floor-has-manual');

    const carrier = { sid, fp: row.fp, sw: row.swipe_id };
    const events = list.map(({ avatar, state }) => {
        const { action, way } = choices.get(state);
        const event = { schema: 1, source: 'manual', avatar, opKey: key + ':' + avatar, carrier: { ...carrier }, version: 1, action, way, deps: [] };
        return { ...event, id: eventId(event) };
    });
    const confirm = { schema: 1, opKey: key, carrier: { ...carrier }, version: 1 };
    const patch = { rpePresence: [...kept, ...events], rpeConfirm: confirm };
    if (extra?.rpeSourceId == null) patch.rpeSourceId = sid;
    for (const field of Object.keys(patch)) {
        const descriptor = extra && Object.getOwnPropertyDescriptor(extra, field);
        if (descriptor ? !descriptor.writable : extra && !Object.isExtensible(extra)) return reject('event-slot-invalid');
    }

    const candidate = chat.with(floor, { ...message, extra: { ...extra, ...patch } });
    const checked = confirmedPresence({ chat: candidate, roster, generating, through: floor });
    const bad = checked.state !== 'active' || checked.floor !== floor
        // 只核她这次名单里的人：名册里不在名单上的卡（这一局不用、没来过）在确认楼上本来就没有开头记录，不该挡住确认（T150 D 副本实测）
        || checked.unresolved.some(issue => issue.at === floor && issue.reason !== 'legacy-only' && (issue.avatar == null || listed.has(issue.avatar)))
        || list.some(({ avatar, state }) => {
            const first = checked.byAvatar[avatar]?.changes[0];
            return first?.at !== floor || first.state !== choices.get(state).state;
        });
    if (bad) return reject('presence-rejected');

    message.extra = Object.assign(message.extra ?? {}, patch);
    const hint = { opKey: key, sid, at: floor, chatKey: chatKey ?? null };
    if (object(metadata)) metadata.rpeConfirmHint = hint;
    return { status: 'attached', receipt: { at: floor, draft: draft(message), confirm: structuredClone(confirm),
        events: structuredClone(events), list: structuredClone(list), roster: structuredClone(roster) } };
}

// T150d：确认楼之后她手动纠正的一条新记录。统一用 manual 事件，写在当时最后一楼上（从这一楼起算）。
// 同一楼上这个人原有的 manual 事件（确认时那条、或更早的纠正）换成这一条：她最后改的算数（N-490）。
// 只改 chat 里最后一楼的 extra；不满足条件就一字不动，返回 uncovered。
export function writeManual({ chat, metadata = {}, roster, generating = null, chatKey = null }, avatar, want, { newId, opKey = newId } = {}) {
    const reject = reason => outcome('prepare', reason);
    const choice = choices.get(want);
    if (!choice) return reject('state-invalid');
    if (!Array.isArray(chat) || !chat.length || !nonempty(avatar)) return reject('floor-invalid');
    const found = confirmedFloor(chat, { metadata, generating, chatKey });
    if (found.state !== 'active') return reject('not-active');
    const floor = chat.length - 1, message = chat[floor], extra = message?.extra;
    if (!object(message) || floor < found.floor) return reject('floor-invalid');
    const row = rowsFromChat(chat, null, generating)[floor];
    const failure = floorFailure(chat, row, message, floor, generating);
    if (failure) return reject(failure);
    if (extra != null && !object(extra)) return reject('carrier-invalid');
    const matches = (roster ?? []).filter(card => card?.avatar === avatar && !avatar.startsWith('face:') && !isCamera(card)).length;
    if (!matches) return reject('avatar-not-in-roster');
    if (matches > 1) return reject('avatar-ambiguous');

    const sources = idsOf(chat, 'rpeSourceId');
    if (!sources || !idsOf(chat, 'rpeMessageId')) return reject('instance-id-conflict');
    const existing = extra?.rpeSourceId ?? message.rpeSourceId, key = opKey(), sid = existing ?? newId();
    if (!nonempty(key) || !nonempty(sid) || existing == null && sources.has(sid)) return reject('instance-id-conflict');
    if (extra && Object.hasOwn(extra, 'rpePresence') && !Array.isArray(extra.rpePresence)) return reject('event-slot-invalid');
    if ((extra?.rpePresence ?? []).some(event => event?.opKey === key + ':' + avatar)) return reject('op-conflict');

    const carrier = { sid, fp: row.fp, sw: row.swipe_id };
    const event = { schema: 1, source: 'manual', avatar, opKey: key + ':' + avatar, carrier, version: 1, action: choice.action, way: choice.way, deps: [] };
    event.id = eventId(event);
    const kept = (extra?.rpePresence ?? []).filter(old => !(old?.source === 'manual' && old.avatar === avatar));
    const patch = { rpePresence: [...kept, event] };
    if (extra?.rpeSourceId == null) patch.rpeSourceId = sid;
    for (const field of Object.keys(patch)) {
        const descriptor = extra && Object.getOwnPropertyDescriptor(extra, field);
        if (descriptor ? !descriptor.writable : extra && !Object.isExtensible(extra)) return reject('event-slot-invalid');
    }
    const candidate = chat.with(floor, { ...message, extra: { ...extra, ...patch } });
    const checked = confirmedPresence({ chat: candidate, roster, metadata, generating, chatKey, through: floor });
    if (checked.state !== 'active' || checked.floor !== found.floor
        || checked.unresolved.some(issue => issue.at === floor && issue.reason !== 'legacy-only')
        || checked.byAvatar[avatar]?.changes.at(-1)?.state !== choice.state) return reject('presence-rejected');

    message.extra = Object.assign(message.extra ?? {}, patch);
    return { status: 'attached', receipt: { at: floor, avatar, state: choice.state, event: structuredClone(event), roster: structuredClone(roster) } };
}

// 写完读盘复核（手动纠正那条）：事件原样在盘上、确认楼仍有效、这个人的现状和她改的一致。
export async function verifyManual(receipt, { current, read }) {
    const unknown = reason => outcome('verify', reason, 'unverified');
    const { at, avatar, state, event, roster } = receipt;
    let disk;
    try {
        if (!current()) return unknown('window-changed');
        disk = await read();
    } catch { return unknown('read-failed'); }
    if (!current()) return unknown('window-changed');
    const { metadata, messages } = disk, message = messages?.[at];
    if (!object(message) || !(message.extra?.rpePresence ?? []).some(saved => stamp(saved) === stamp(event))) return unknown('archive-carrier');
    const checked = confirmedPresence({ chat: messages, roster, metadata });
    if (checked.state !== 'active' || checked.byAvatar[avatar]?.changes.at(-1)?.state !== state) return unknown('archive-presence');
    return outcome('verify', 'archive-confirmed', 'saved');
}

// T150d：谁能开口。新记录算出"此刻不在"的人静音，"此刻在场或远程"的人取消静音。
// 只动系统替他静音的那部分：她手动静音的（manualMuted 里有）、旁白卡、正在被系统改静音的（skip）、场面里没有记录或状态不明的，一律不碰。
export function muteAlignment(view, { members = [], disabled = [], manualMuted = {}, camera = null, skip = [] } = {}) {
    const plan = { mute: [], unmute: [] };
    if (!view?.byAvatar) return plan;
    const skipped = new Set(skip), off = new Set(disabled);
    for (const avatar of new Set(members)) {
        if (avatar === camera || skipped.has(avatar) || manualMuted?.[avatar]) continue;
        const now = view.byAvatar[avatar]?.changes.at(-1)?.state;
        if ((now === 'present' || now === 'remote') && off.has(avatar)) plan.unmute.push(avatar);
        else if (now === 'absent' && !off.has(avatar)) plan.mute.push(avatar);
    }
    return plan;
}

// T150e：点确认前先看末楼合不合格（正在生成、左滑未定、隐藏、空楼不行）。合格返回 null，否则返回原因。
export function confirmFloorCheck({ chat, generating = null }) {
    if (!Array.isArray(chat) || !chat.length) return 'empty-floor';
    const floor = chat.length - 1, message = chat[floor];
    if (!object(message)) return 'floor-invalid';
    return floorFailure(chat, rowsFromChat(chat, null, generating)[floor], message, floor, generating);
}

// T150e：预览名单。底稿是 /v1/board 此刻给的人，名册里每个有卡的人一行；认人只看 avatar，同名各列各的。
// 面板上不在场、没来过、不在眼前的，一律从"不在"起；远程从"远程"起。
export function previewRows(board, cast, { camera = isCamera } = {}) {
    const people = Array.isArray(board?.people) ? board.people : [];
    const seen = new Set(), rows = [];
    for (const card of Array.isArray(cast) ? cast : []) {
        if (!object(card) || !nonempty(card.avatar) || card.avatar.startsWith('face:') || card.role === '不用' || camera(card) || seen.has(card.avatar)) continue;
        seen.add(card.avatar);
        const status = people.find(p => p?.avatar === card.avatar)?.status;
        rows.push({ avatar: card.avatar, name: card.name ?? card.avatar, state: status === 'present' ? 'present' : status === 'remote' ? 'remote' : 'absent' });
    }
    return rows;
}

// T150e：面板上那一行怎么显示。kind: hidden | blocked | none | active | stale | reverted。
// found：confirmedFloor 的结果；没有确认记录的窗传 { state: 'none' }。
export function confirmPanelModel({ found, thirdParty = false, joined = false, hasChat = false, branch = false } = {}) {
    if (!joined || !hasChat) return { kind: 'hidden' };
    if (thirdParty) return { kind: 'blocked', text: '这个窗开着另一个隔离扩展，这一版先不支持从这一楼起按新记法' };
    const state = found?.state ?? 'none', floor = found?.floor;
    const before = integer(floor) ? `第 ${floor} 楼之前仍按旧读法。` : '';
    if (state === 'active') return { kind: 'active', floor, text: `从第 ${floor} 楼起按新记法。${before}`, button: { action: 'presence-revert', label: '退回旧读法' } };
    if (state === 'stale') return { kind: 'stale', floor, text: `第 ${floor} 楼被改动过，请重新确认。${before}`, button: { action: 'presence-confirm', label: '重新确认' } };
    if (state === 'reverted') return { kind: 'reverted', floor, text: `已退回旧读法。`, button: { action: 'presence-confirm', label: '从这一楼起按新记法' } };
    return { kind: 'none', text: branch ? '这个分支从确认楼之前开出，仍是旧读法。' : '', button: { action: 'presence-confirm', label: '从这一楼起按新记法' } };
}

// 面板上那一小行的 HTML；按钮用 data-action，由面板的点击处理接。
export function confirmLineHtml(model, escape = String) {
    if (!model || model.kind === 'hidden') return '';
    const button = model.button ? `<button type="button" class="menu_button" data-action="${model.button.action}" title="${model.kind === 'active' ? '退回后照旧读法，想再切回来要重新确认。' : '先看预览名单，核对后再确认。'}">${escape(model.button.label)}</button>` : '';
    const text = model.text ? `<small>${escape(model.text)}</small> ` : '';
    return `<div class="rpe-presence-confirm" data-kind="${model.kind}">${text}${button}</div>`;
}

// 写完读盘复核：记录原样在、确认楼仍有效、每个人的起点和她确认的一致。
export async function verifyConfirm(receipt, { current, read }) {
    const unknown = reason => outcome('verify', reason, 'unverified');
    const { at, confirm, events, roster, list } = receipt;
    let disk;
    try {
        if (!current()) return unknown('window-changed');
        disk = await read();
    } catch { return unknown('read-failed'); }
    if (!current()) return unknown('window-changed');
    const { metadata, messages } = disk, message = messages?.[at];
    if (!object(message) || draft(message) !== receipt.draft || stamp(message.extra?.rpeConfirm) !== stamp(confirm)
        || !events.every(event => (message.extra.rpePresence ?? []).some(saved => stamp(saved) === stamp(event)))) return unknown('archive-carrier');
    const checked = confirmedPresence({ chat: messages, roster, metadata, through: at });
    if (checked.state !== 'active' || checked.floor !== at || checked.opKey !== confirm.opKey) return unknown('archive-boundary');
    if (list.some(({ avatar, state }) => checked.byAvatar[avatar]?.changes[0]?.state !== choices.get(state).state)) return unknown('archive-presence');
    if (!current()) return unknown('window-changed');
    return outcome('verify', 'archive-confirmed', 'saved');
}
