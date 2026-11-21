import { eventId, inspect, rowsFromChat } from './presence-events.mjs';
import { isCamera, speakerOf } from './sync.mjs';

const object = value => value != null && typeof value === 'object' && !Array.isArray(value);
const stamp = value => JSON.stringify(value, (_, v) => object(v)
    ? Object.fromEntries(Object.keys(v).sort().map(key => [key, v[key]])) : v);
const validId = id => typeof id === 'string' && id.trim() !== '';
const validSlot = slot => Number.isSafeInteger(slot) && slot >= 0;
const segments = (metadata, avatar) => metadata.contextIsolation?.anchors?.[avatar]?.segments;
const draft = m => stamp([speakerOf(m), m.mes, m.swipe_id, m.swipes, m.swipe_info, m.hidden, m.is_system, m.is_user, m.send_date]);
const keyMatches = (chat, { avatar, source, opKey }) => chat.flatMap((message, at) =>
    [message?.extra?.rpePresence ?? []].flat().filter(event => event?.avatar === avatar
        && event.source === source && event.opKey === opKey).map(event => ({ at, event })));

export function manualLeaveCardMatches({ characters, members, roster, card, who, resolved }) {
    const { avatar } = card;
    if (!avatar?.trim() || avatar.startsWith('face:') || isCamera(card) || resolved !== card) return false;
    const cards = (characters ?? []).filter(candidate => members.includes(candidate.avatar));
    const named = cards.filter(candidate => candidate.name === who);
    const matches = Array.isArray(roster) ? roster.filter(candidate => candidate?.avatar === avatar) : [];
    return named.length === 1 && named[0] === card && cards.filter(candidate => candidate.avatar === avatar).length === 1
        && members.filter(id => id === avatar).length === 1 && matches.length === 1 && matches[0].name === who
        && typeof matches[0].role === 'string' && matches[0].role !== '不用';
}

function idsOf(chat, field) {
    const seen = new Set();
    for (const message of chat) {
        const top = message?.[field], nested = message?.extra?.[field];
        if (top != null && nested != null && top !== nested) return null;
        const id = nested ?? top;
        if (id == null) continue;
        if (!validId(id) || seen.has(id)) return null;
        seen.add(id);
    }
    return seen;
}

function acceptedAt(chat, roster, match, generating = null) {
    const input = { chat, roster, generating };
    const { effective, projection } = inspect(input, match.at, match.event, { includeProjection: true });
    if (!effective) return false;
    const { byAvatar } = projection;
    const beforeLeave = byAvatar[match.event.avatar]?.changes.findLast(change => change.at + Number(change.boundary === 'after') <= match.at);
    return beforeLeave?.state !== 'absent';
}

function closed(metadata, { chatKey, avatar, boundary }) {
    const list = segments(metadata, avatar);
    return metadata.rp_emergence?.chatKey === chatKey && Array.isArray(list)
        && list.filter(segment => stamp(segment) === boundary).length === 1;
}

const outcome = (stage, reason, status = 'uncovered') => ({ status, stage, reason });

export function captureManualLeave({ chat, metadata, avatar }, segment, message) {
    const at = segment.to - 1, boundary = stamp(segment);
    const anchor = metadata.contextIsolation?.anchors?.[avatar], revision = anchor?.rpeManualRevision;
    const signature = row => stamp([draft(row), row.rpeMessageId, row.extra?.rpeMessageId, row.rpeSourceId, row.extra?.rpeSourceId]);
    const original = signature(message);
    return { segment, message, current: () => chat.length === at + 1 && chat[at] === message
        && metadata.contextIsolation?.anchors?.[avatar] === anchor && anchor?.rpeManualRevision === revision
        && anchor?.segments?.includes(segment) && stamp(segment) === boundary && signature(message) === original };
}

export function writeManualLeave({ chat, metadata, chatKey, avatar }, segment, message, { roster, generating, newId, opKey = newId }) {
    const at = segment.to - 1, boundary = stamp(segment), proof = { chatKey, avatar, boundary };
    const reject = reason => outcome('prepare', reason);
    if (!validSlot(at) || chat[at] !== message || !closed(metadata, proof)
        || !segments(metadata, avatar).includes(segment)) return reject('close-proof-changed');

    const row = rowsFromChat(chat, null, generating)[at], extra = message?.extra;
    if (!row?.fp || row.hidden || row.is_system || row.revisionPending || !validSlot(row.swipe_id)
        || !validSlot(message?.swipe_id) || extra != null && !object(extra)) return reject('carrier-invalid');
    const sources = idsOf(chat, 'rpeSourceId');
    if (!sources || !idsOf(chat, 'rpeMessageId')) return reject('instance-id-conflict');
    const existing = extra?.rpeSourceId ?? message.rpeSourceId;
    const key = opKey(), sid = existing ?? newId();
    if (!validId(key) || !validId(sid) || existing == null && sources.has(sid)) return reject('instance-id-conflict');

    const carrier = { sid, fp: row.fp, sw: row.swipe_id, send_date: message.send_date ?? null };
    const event = { schema: 1, source: 'manual-leave', avatar, opKey: key, carrier,
        version: 1, action: 'leave', way: null, deps: [] };
    event.id = eventId(event);
    if (extra && Object.hasOwn(extra, 'rpePresence') && !Array.isArray(extra.rpePresence)) return reject('event-slot-invalid');
    const [prior, ...copies] = keyMatches(chat, event), replay = !!prior;
    if (prior && !Object.hasOwn(prior.event.carrier ?? {}, 'send_date')) delete carrier.send_date;
    if (replay && (prior.at !== at || copies.length || stamp(prior.event) !== stamp(event))) return reject('op-conflict');
    const candidate = chat.slice(), patch = {};
    if (!replay) {
        patch.rpePresence = { value: [...(extra?.rpePresence ?? []), event] };
        if (extra?.rpeSourceId == null) patch.rpeSourceId = { value: sid };
        for (const [key, descriptor] of Object.entries(patch)) {
            const old = extra && Object.getOwnPropertyDescriptor(extra, key);
            if (old ? !old.writable : extra && !Object.isExtensible(extra)) return reject('event-slot-invalid');
            if (!old) Object.assign(descriptor, { writable: true, enumerable: true, configurable: true });
        }
        candidate[at] = { ...message, extra: Object.defineProperties({ ...extra }, patch) };
    }
    if (!acceptedAt(candidate, roster, { at, event: prior?.event ?? event }, generating)) return reject(replay ? 'op-conflict' : 'presence-rejected');

    const receipt = { ...proof, at, draft: draft(message), event: structuredClone(event), roster: structuredClone(roster), replay };
    if (!replay) Object.defineProperties(message.extra ??= {}, patch);
    return { status: replay ? 'replay' : 'attached', receipt };
}

export async function verifyManualLeave(receipt, { current, read }) {
    const unknown = reason => outcome('verify', reason, 'unverified');
    const { at, event, roster, replay } = receipt;
    let disk;
    try {
        if (!current()) return unknown('window-changed');
        disk = await read();
    } catch { return unknown('read-failed'); }
    if (!current()) return unknown('window-changed');

    const { metadata, messages } = disk;
    if (!closed(metadata, receipt) || !idsOf(messages, 'rpeSourceId') || !idsOf(messages, 'rpeMessageId'))
        return unknown('archive-boundary');
    const [match, ...copies] = keyMatches(messages, event);
    if (!match || copies.length || stamp(match.event) !== stamp(event) || draft(messages[match.at]) !== receipt.draft)
        return unknown('archive-carrier');
    if (!acceptedAt(messages, roster, match)) return unknown('archive-presence');
    if (!current()) return unknown('window-changed');
    if (match.at !== at) return { ...unknown('archive-moved'), movedTo: match.at, segmentTo: at + 1 };
    return outcome('verify', 'archive-confirmed', replay ? 'already-saved' : 'saved');
}

export function manualLeaveWriter(proof, { current, prepare, read, report, schedule, write = writeManualLeave }) {
    let ready, result;
    try { ready = prepare(); }
    catch { ready = false; }
    return {
        capture(segment, message) {
            if (!current()) return;
            try {
                const options = ready && prepare();
                result = options ? write(proof, segment, message, options) : outcome('prepare', 'ineligible');
            } catch { result = outcome('prepare', 'writer-failed'); }
        },
        finish(closeStatus) {
            if (!result) return;
            const { receipt, ...prepared } = result;
            result = null;
            const record = checked => report({ avatar: proof.avatar, opKey: receipt?.event.opKey, at: receipt?.at, closeStatus, ...checked });
            if (!receipt) { record(prepared); return; }
            schedule(async () => {
                let checked;
                try { checked = await verifyManualLeave(receipt, { current, read }); }
                catch { checked = outcome('verify', 'verify-failed', 'unverified'); }
                if (checked.status !== 'unverified' && !current()) checked = outcome('verify', 'window-changed', 'unverified');
                record(checked);
            });
        },
    };
}

const idSlot = (obj, field) => [obj != null && Object.hasOwn(obj, field), obj?.[field]];
const openIds = (m, source = idSlot(m.extra, 'rpeSourceId')) =>
    stamp([source, idSlot(m, 'rpeSourceId'), idSlot(m, 'rpeMessageId'), idSlot(m.extra, 'rpeMessageId')]);
const openColumn = 'rpePresenceOpen', columns = [openColumn, 'rpePresence'];
const draftShape = m => ['swipe_id', 'swipes', 'swipe_info'].map(key => Object.hasOwn(m, key));
const openDraft = (m, shape = draftShape(m)) => shape.join(',') + draft(m);
const plainExtra = extra => extra == null || object(extra) && [null, Object.prototype].includes(Object.getPrototypeOf(extra));

export function captureSegmentOpen(proof, anchor, segment, message, { generating, newId }) {
    const { chat, avatar, opKey, way } = proof, at = segment.from - 1;
    if (!validSlot(at) || at + 1 !== chat.length || !message || chat[at] !== message) return outcome('capture', 'boundary-invalid');
    if (Object.hasOwn(message, 'revisionPending')) return outcome('capture', 'carrier-invalid');
    const shape = draftShape(message), [hasSlot, hasSwipes, hasInfo] = shape;
    const { extra, swipe_id: slot, swipes, swipe_info: info } = message, originalSid = extra?.rpeSourceId;
    const [row] = rowsFromChat([message], null, generating);
    const unslotted = message.is_user === true && !hasSlot && !hasSwipes && !hasInfo;
    const invalidCarrier = () => outcome('capture', 'carrier-invalid');
    if (!row?.fp || row.hidden || row.is_system || row.revisionPending || !row.mes.trim()) return invalidCarrier();
    if (!unslotted) {
        if (!hasSlot || !validSlot(slot) || slot !== row.swipe_id) return invalidCarrier();
        if (Array.isArray(swipes) ? swipes[slot] !== message.mes : slot !== 0 || hasSwipes || hasInfo) return invalidCarrier();
        if (hasInfo && (!Array.isArray(info) || slot >= info.length)) return invalidCarrier();
    }
    if (originalSid == null && message.rpeSourceId != null) return outcome('capture', 'top-only-source-id');
    if (Object.hasOwn(extra ?? {}, 'rpeSourceId') && !validId(originalSid)) return outcome('capture', 'source-id-conflict');
    const event = { schema: 2, source: 'segment-open', avatar, opKey, id: null, version: 1, action: 'enter', way, deps: [],
        carrier: { sid: originalSid ?? newId(), fp: row.fp, sw: unslotted ? null : row.swipe_id } };
    if (!validId(event.carrier.sid) || !validId(opKey) || !validId(avatar) || !['当面', '电话', '消息'].includes(way)) return outcome('capture', 'intent-invalid');
    event.id = eventId(event);
    return { ...proof, at, anchor, segment, message, event, originalSid, ids: openIds(message), draft: openDraft(message, shape),
        sourceSlot: idSlot(extra, 'rpeSourceId'), boundary: stamp(segment), revision: stamp(anchor?.rpeManualRevision) };
}

export function segmentOpenFailure(capture, result, generating) {
    if (result?.status === 'achieved') return 'already-open';
    if (!capture || result?.status !== 'applied' || result.segment !== capture.segment) return 'open-unconfirmed';
    const { chat, metadata, chatKey, avatar, at, anchor, segment, message } = capture;
    if (metadata.rp_emergence?.chatKey !== chatKey || metadata.contextIsolation?.anchors?.[avatar] !== anchor
        || !Array.isArray(anchor.segments) || !anchor.segments.includes(segment)
        || segment.to !== null || segment.from !== at + 1 || anchor.segments.filter(s => s && s.to == null).length !== 1
        || stamp(segment) !== capture.boundary || stamp(anchor.rpeManualRevision) !== capture.revision) return 'segment-changed';
    if (chat[at] !== message) return 'carrier-moved';
    if (Object.hasOwn(message, 'revisionPending')) return 'carrier-invalid';
    if (!plainExtra(message.extra)) return 'event-slot-invalid';
    if (openDraft(message) !== capture.draft) return 'carrier-changed';
    if (generating?.message === message || generating?.active && chat.length === at + 1 && !message.is_user) return 'carrier-invalid';
}

export function writeSegmentOpen(capture, { result, roster, generating, publicationFailure }) {
    const reject = reason => outcome('prepare', reason);
    const failure = segmentOpenFailure(capture, result, generating);
    if (failure) return reject(failure);
    const { chat, at, message, event, originalSid, ids } = capture, { sid } = event.carrier;
    const { extra } = message, records = extra?.[openColumn];
    if ((records !== undefined || Object.hasOwn(extra ?? {}, openColumn)) && !Array.isArray(records)) return reject('event-slot-invalid');
    const sources = new Set(), messages = new Set();
    const idSets = [['rpeSourceId', sources], ['rpeMessageId', messages]];
    let prior, otherRef;
    for (const [i, row] of chat.entries()) {
        if (row === message && i !== at) return reject('carrier-duplicated');
        const extra = row?.extra;
        for (const [field, used] of idSets) {
            const [hasTop, top] = idSlot(row, field), [hasNested, nested] = idSlot(extra, field);
            if (!hasTop && !hasNested) continue;
            const id = hasNested ? nested : top;
            if (!validId(id) || hasTop && top !== id || used.has(id)) return reject(used === sources ? 'source-id-conflict' : 'message-id-conflict');
            used.add(id);
        }
        for (const column of columns) {
            const records = extra?.[column];
            if (records == null) continue;
            for (const record of Array.isArray(records) ? records : [records]) {
                if (record?.id === event.id || record?.avatar === event.avatar && record.source === event.source && record.opKey === event.opKey) {
                    if (prior || i !== at || column !== openColumn || stamp(record) !== stamp(event)) return reject('op-conflict');
                    prior = record;
                } else if (originalSid == null && (record?.carrier?.sid === sid || [record?.deps ?? []].flat().some(ref => ref?.sid === sid))) otherRef = true;
            }
        }
    }
    const installed = prior && originalSid == null && extra?.rpeSourceId === sid;
    if (openIds(message, installed ? capture.sourceSlot : undefined) !== ids) return reject('carrier-id-changed');
    if (originalSid == null && (sources.has(sid) && !installed || otherRef)) return reject('source-id-collision');

    const nextExtra = prior ? extra : Object.create(Object.getPrototypeOf(extra ?? {}), Object.getOwnPropertyDescriptors(extra ?? {}));
    if (!prior) {
        if ('extra' in message && !Object.hasOwn(message, 'extra')) return reject('event-slot-invalid');
        if (extra && !Object.isExtensible(extra)) Object.preventExtensions(nextExtra);
        if (!Reflect.set(nextExtra, openColumn, [...(records ?? []), event])) return reject('event-slot-invalid');
        if (originalSid == null && !Reflect.set(nextExtra, 'rpeSourceId', sid)) return reject('event-slot-invalid');
    }
    const candidate = prior ? chat : chat.with(at, { ...message, extra: nextExtra });
    const checked = inspect({ chat: candidate, roster, generating }, at, prior ?? event, { prepared: true });
    if (!checked.effective) return reject(checked.ok ? 'presence-ineffective' : 'presence-rejected');
    const ineligible = publicationFailure?.();
    if (ineligible) return reject(ineligible);
    if (!prior && !Reflect.set(message, 'extra', nextExtra)) return reject('event-slot-invalid');
    return prior ? outcome('prepare', 'exact-replay', 'replay') : { status: 'attached' };
}

export function segmentOpenArrivalFailure(got, remote, { avatar, chatKey, mode, way, bucket }) {
    if (!object(got) || got.skipped) return 'arrive-unconfirmed';
    const channel = mode === 'come' ? null : way === '电话' ? 'phone' : 'message';
    const actual = remote == null ? null : remote.avatar === avatar && remote.chatKey === chatKey
        ? ({ 打电话: 'phone', 发消息: 'message' })[remote.how] : undefined;
    const basis = got.source_basis;
    const dependent = [basis?.deps, got.deps].some(deps => deps != null && (!Array.isArray(deps) || deps.length));
    if (dependent || basis?.handoff || basis?.sourceStep || basis?.playerRequest || basis?.delivery || basis?.factBasis
        || got.sourceStep || got.sent || got.factBasis || basis != null && !object(basis)) return 'dependent-arrival';
    if (actual !== channel || ('mode' in got && got.mode !== mode) || ('channel' in got && got.channel !== channel)
        || ('way' in got && got.way !== way && !(mode === 'come' && ['上门', bucket].includes(got.way)))) return 'way-conflict';
}
