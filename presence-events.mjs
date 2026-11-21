import { fingerprintMessage, isCamera, resolveIdentity, sequenceRevision, sequenceWindow, speakerOf } from './sync.mjs';

const hidden = row => row.hidden || row.is_system;
const hasBody = row => typeof row?.mes === 'string';
const nonempty = value => typeof value === 'string' && value.trim() !== '';
const object = value => value != null && typeof value === 'object' && !Array.isArray(value);
const integer = (value, min = 0) => Number.isSafeInteger(value) && value >= min;
const ways = new Map([['当面', null], ['电话', 'phone'], ['消息', 'message']]);
const eventFields = new Set(['schema', 'source', 'avatar', 'opKey', 'id', 'carrier', 'version', 'action', 'way', 'deps', 'targetVersion']);
const fixedActions = new Map([['delivery', 'enter'], ['manual-leave', 'leave'], ['message-verdict', null],
    ['manual', null], ['opening', 'enter']]);
const isSegmentOpen = event => event?.schema === 2 && event.source === 'segment-open';
const hasOperationKey = (event, open) => nonempty(event?.opKey) && (open ? isSegmentOpen(event) : fixedActions.has(event.source));
const completeRef = (ref, open) => object(ref) && nonempty(ref.sid) && nonempty(ref.fp) && (integer(ref.sw) || open && ref.sw === null);
const validRef = (value, segmentOpen) => completeRef(value, segmentOpen) && Object.keys(value).every(key => ['sid', 'fp', 'sw'].includes(key));
function validCarrier(value, source, open) {
    if (source !== 'manual-leave' || !object(value) || !Object.hasOwn(value, 'send_date')) return validRef(value, open);
    const { send_date, ...ref } = value;
    return validRef(ref) && (send_date === null || typeof send_date === 'string' || Number.isFinite(send_date));
}

function eventShapeReason(event, cards) {
    if (!object(event)) return 'field-invalid';
    const { schema, source, avatar, opKey, id, carrier, version, action, way, deps, targetVersion } = event;
    const open = isSegmentOpen(event), undo = action === 'undo', fixed = open ? 'enter' : fixedActions.get(source);
    const independent = source === 'manual' || source === 'opening';
    const enterWay = independent ? way === '当面' || source === 'manual' && way === '远程' : ways.has(way);
    if (!(open || schema === 1 && fixedActions.has(source)) || !cards.has(avatar) || !nonempty(opKey)
        || !nonempty(id) || !validCarrier(carrier, source, open) || !integer(version, 1)
        || (undo ? !integer(targetVersion, 1) : Object.hasOwn(event, 'targetVersion'))
        || !undo && (fixed ? action !== fixed : action !== 'enter' && action !== 'leave')
        || (action === 'enter' ? !enterWay : way !== null)
        || !Array.isArray(deps) || !undo && independent && deps.length
        || !Array.from(deps).every(ref => validRef(ref, open))) return 'field-invalid';
    if (Object.hasOwn(event, 'factBasis') || Object.hasOwn(event, 'sourceVersion')) return 'dependency-missing';
    return Object.keys(event).every(key => eventFields.has(key)) ? null : 'field-invalid';
}
const refKey = ({ sid, fp, sw }) => JSON.stringify([sid, fp, sw]);
export const eventId = ({ avatar, source, opKey, carrier: { sid, fp, sw } }) => JSON.stringify([avatar, source, opKey, sid, fp, sw]);

function parseEventId(id) {
    let parts;
    try { parts = JSON.parse(typeof id === 'string' ? id : 'null'); } catch { return null; }
    if (!Array.isArray(parts) || parts.length !== 6) return null;
    const [avatar, source, opKey, sid, fp, sw] = parts, open = source === 'segment-open';
    return nonempty(avatar) && nonempty(opKey) && (open || fixedActions.has(source))
        && completeRef({ sid, fp, sw }, open) && JSON.stringify(parts) === id ? parts : null;
}

export function rowsFromChat(chat, fallbackAvatar = null, generating = null) {
    // 坏正文保留原楼号，只有它之后的合法空白尾楼可裁掉。
    const start = chat.findLastIndex(row => !hasBody(row)) + 1;
    const { end, pending } = sequenceWindow(start ? chat.slice(start) : chat), tail = chat[start + end - 1];
    return Array.from(chat.slice(0, start + end), (message = {}) => {
        message ??= {};
        const speaker = speakerOf(message, fallbackAvatar);
        const fp = hasBody(message) ? fingerprintMessage(message, speaker) : null;
        const revision = sequenceRevision(message, speaker, fp, generating, tail);
        return { ...message, speaker, fp, swipe_id: integer(message.swipe_id) ? revision.w : undefined,
            revisionPending: revision.pending || pending && message === tail };
    });
}

function indexRows(prefix, chat) {
    const sources = new Map(), messages = new Map(), ranks = [];
    const index = (map, at, ...ids) => {
        for (const id of new Set(ids)) {
            if (nonempty(id)) map.set(id, map.has(id) ? -1 : at);
        }
    };
    let visible = 0;
    for (const [at, row] of prefix.entries()) {
        index(sources, at, row.extra?.rpeSourceId, row.rpeSourceId);
        index(messages, at, row.extra?.rpeMessageId, row.rpeMessageId);
        ranks.push(hidden(row) ? visible : ++visible);
    }
    const locate = (ref, segmentOpen) => {
        const at = sources.get(ref.sid);
        if (at == null || at === -1) return -1;
        const { extra, rpeSourceId, rpeMessageId, fp, swipe_id } = prefix[at];
        if (rpeSourceId != null && rpeSourceId !== extra?.rpeSourceId
            || rpeMessageId != null && extra?.rpeMessageId != null && rpeMessageId !== extra.rpeMessageId
            || messages.get(rpeMessageId ?? extra?.rpeMessageId) === -1) return -1;
        if (fp === null) return -2;
        if (segmentOpen) {
            const raw = chat[at], hasDrafts = 'swipes' in raw || 'swipe_info' in raw;
            if (ref.sw === null ? raw.is_user !== true || hasDrafts || 'swipe_id' in raw
                : raw.swipe_id !== ref.sw || !Array.isArray(raw.swipes) && (ref.sw !== 0 || hasDrafts)) return -1;
        }
        return extra?.rpeSourceId === ref.sid && fp === ref.fp && (ref.sw === null || swipe_id === ref.sw)
            && !hidden(prefix[at]) && !prefix[at].revisionPending ? at : -1;
    };
    return { locate, ranks };
}

const ownDelivery = (row, avatar) => row.speaker === avatar && !row.is_user && avatar !== 'user' && avatar !== 'narrator';
function eventReason(event, row, at, cards, { locate: locateLegacy, ranks }) {
    const invalid = eventShapeReason(event, cards);
    if (invalid) return invalid;
    const { source, avatar, carrier, action, deps } = event, undo = action === 'undo';
    const segmentOpen = source === 'segment-open', locate = segmentOpen ? ref => locateLegacy(ref, true) : locateLegacy;
    if (event.id !== eventId(event)) return 'op-conflict';
    if (locate(carrier) !== at || source === 'opening' && at !== 0) return 'field-invalid';
    if (source === 'manual-leave' && Object.hasOwn(carrier, 'send_date') && carrier.send_date !== (row.send_date ?? null)) return 'field-invalid';
    if (source === 'delivery' && (!ownDelivery(row, avatar) || !row.mes.trim())) return 'field-invalid';
    let first, last = -1, includesCarrier = false;
    for (const ref of deps) {
        const pos = locate(ref);
        if (pos === -2) return 'field-invalid';
        if (pos <= last || !undo && (source === 'delivery' || segmentOpen) && pos >= at) return 'dependency-missing';
        first ??= pos;
        last = pos;
        if (pos === at) includesCarrier = true;
    }
    // 每个引用均可见且严格递增，可见楼的名次差检出窗口内漏楼。
    if (!undo && source === 'message-verdict'
        && (!includesCarrier || ranks[last] - ranks[first] + 1 !== deps.length)) return 'dependency-missing';
    return null;
}

function actionAtLatestVersion(events) {
    const versions = Map.groupBy(events, event => event.version);
    const signature = ({ action, way, targetVersion, deps }) => JSON.stringify([action, way, targetVersion, deps.map(refKey)]);
    let latest, originalAction, expected = 1;
    for (const [version, entries] of [...versions].sort(([a], [b]) => a - b)) {
        const [event, ...copies] = entries;
        if (version !== expected++ || copies.some(copy => signature(copy) !== signature(event))
            || (event.action === 'undo'
                ? event.targetVersion >= version || !versions.get(event.targetVersion)
                    || versions.get(event.targetVersion)[0].action === 'undo'
                : originalAction && event.action !== originalAction)) return { broken: event };
        if (event.action !== 'undo') originalAction ??= event.action;
        latest = event;
    }
    return { action: latest.action === 'undo' ? null : latest };
}

function verifiedActions(prefix, chat, cards, rosterAvatars, rejectEvent) {
    const index = indexRows(prefix, chat), floors = prefix.map(() => []), verified = [], rejected = [], bound = new Set();
    for (const [at, row] of prefix.entries()) for (const field of ['rpePresence', 'rpePresenceOpen']) {
        if (!row.extra || !Object.hasOwn(row.extra, field)) continue;
        const records = row.extra[field], open = field === 'rpePresenceOpen';
        if (!Array.isArray(records)) {
            rejected.push({ at, event: records, reason: 'field-invalid', open });
            continue;
        }
        for (const event of records) {
            const reason = event?.schema === (open ? 1 : 2) ? 'field-invalid' : eventReason(event, row, at, cards, index);
            const entry = { at, event, reason, open };
            (reason ? rejected : verified).push(entry);
            if (cards.has(event?.avatar) && hasOperationKey(event, open)) bound.add(entry);
        }
    }
    for (const entry of rejected) {
        const { at, event, reason, open } = entry, carrier = event?.carrier, undo = event?.action === 'undo';
        // 完整 ID 优先，错列但原载体校验通过的正动作仍只报未归属。
        const parsed = (open || event?.schema === 2) && parseEventId(event?.id);
        const misplaced = open ? event?.schema === 1 : event?.schema === 2 && (parsed?.[1] === 'segment-open' || !fixedActions.has(event.source));
        const parts = (open || misplaced) && (!misplaced || undo || eventReason(event, prefix[at], at, cards, index)) && parsed;
        const id = event?.id;
        const exact = (parts || undo) && verified.find(({ event: first, open: firstOpen }) =>
            first.id === id && first.version === 1 && first.action !== 'undo' && (open || misplaced || firstOpen));
        if (exact) bound.add(Object.assign(entry, { original: exact.event }));
        else if (parts) bound.delete(entry);
        else if (!misplaced && nonempty(event?.avatar) && !rosterAvatars.has(event.avatar)) {
            rejectEvent(at, event, !open && event.schema === 2 ? reason : 'avatar-not-in-roster', []);
            continue;
        }
        const carrierKey = !parts && (!open || isSegmentOpen(event)) && completeRef(carrier, open) ? refKey(carrier) : null;
        let matches = exact ? [exact] : parts || misplaced ? [] : verified.filter(({ event: valid, open: validOpen }) =>
            validOpen === open && (valid.id === id || carrierKey && valid.opKey === event.opKey
                && (!open || !nonempty(event.avatar) || valid.avatar === event.avatar) && refKey(valid.carrier) === carrierKey));
        if (!open && !misplaced && !matches.length && !nonempty(event?.avatar))
            matches = verified.filter(valid => valid.at === at && !valid.open);
        const targets = new Set(matches.map(valid => valid.event.avatar));
        if (!exact && !misplaced && cards.has(event?.avatar) && (hasOperationKey(event, open) && carrierKey
            && event.id === eventId(event) || !open && event.source === 'delivery' && ownDelivery(prefix[at], event.avatar))) targets.add(event.avatar);
        entry.targets = parts ? [parts[0]] : open && targets.size > 1 ? [] : [...targets].sort();
        rejectEvent(at, event, reason, entry.targets, exact ? Math.min(at, exact.at) : parts ? null : at, matches);
    }
    const operations = Map.groupBy(bound, ({ event, original: { avatar, source, opKey } = event }) => JSON.stringify([avatar, source, opKey]));
    for (const entries of operations.values()) {
        const { at, event } = entries[0];
        if (entries.some(entry => entry.at !== at || (entry.original ?? entry.event).id !== (entries[0].original ?? event).id)) {
            for (const entry of entries) {
                if (entry.reason !== 'op-conflict') rejectEvent(entry.at, entry.event, 'op-conflict', entry.targets);
            }
        } else if (entries.every(entry => !entry.reason)) {
            const { action, broken } = actionAtLatestVersion(entries.map(entry => entry.event));
            if (broken) rejectEvent(at, broken, 'version-chain');
            else if (action) floors[at].push(action);
        }
    }
    return floors;
}

function legacyIssues(row, report) {
    const extra = row.extra ?? {};
    if (extra.rpeArrival != null) report('rpeArrival', extra.rpeArrival);
    let vis = extra.rp_vis;
    if (vis != null) {
        if (typeof vis === 'string') { try { vis = JSON.parse(vis); } catch { vis = null; } }
        const from = vis?.from;
        report('rp_vis', { avatar: vis?.fromAvatar ?? from?.avatar, name: object(from) ? from.name : from });
    }
    for (const [source, events] of [['arrivals', row.arrivals], ['auto_came', row.came], ['departure', row.departures]]) {
        if (Array.isArray(events)) for (const event of events) report(source, event);
    }
}

function* floorChanges(events, at, issue, nextEvents) {
    const change = (entries, boundary, channel = null) => {
        if (!entries?.length) return null;
        const { action, way } = entries[0];
        if (entries.some(event => event.action !== action || event.way !== way)) {
            for (const event of entries) issue(at, event, 'event-floor-conflict', undefined, entries[0].source === 'segment-open' ? null : at);
            return null;
        }
        const source = entries.reduce((first, event) => event.source < first ? event.source : first, entries[0].source);
        channel = way === '远程' ? channel : ways.get(way) ?? null;
        const state = action === 'leave' ? 'absent' : way === '远程' || channel ? 'remote' : 'present';
        return { at, state, channel, source, boundary };
    };
    for (const [avatar, entries] of Map.groupBy(events, event => event.avatar)) {
        const layers = Map.groupBy(entries, event => ['manual', 'opening', 'segment-open'].includes(event.source) ? event.source : event.action);
        const opening = change(layers.get('opening'), 'on');
        const enter = change(layers.get('enter'), 'on'), leave = change(layers.get('leave'), 'after');
        const manual = change(layers.get('manual'), 'on', enter?.channel ?? null);
        const on = manual ?? enter ?? opening;
        if (on) yield [avatar, on, layers.get(layers.has(on.source) ? on.source : 'enter')];
        const opens = layers.get('segment-open'), closing = leave && !manual;
        if (closing && !opens) yield [avatar, leave, layers.get('leave')];
        if (!opens) continue;
        const opened = change(closing ? [...opens, ...layers.get('leave')] : opens, 'after');
        if (nextEvents?.some(event => event.avatar === avatar && event.source === 'manual')) continue;
        yield [avatar, opened ?? { at, state: 'unknown', channel: null, source: 'unresolved', boundary: 'after' }, opened ? opens : []];
    }
}

function applyChange(person, change) {
    const previous = person.changes.at(-1);
    if (previous?.state === change.state && previous.channel === change.channel && previous.source === change.source) return;
    person.changes.push(change);
    const at = change.at + Number(change.boundary === 'after');
    const last = person.intervals.at(-1);
    if (change.state === 'absent' || change.state === 'unknown') {
        if (last?.to === null) last.to = at;
    } else if (last?.to !== null) person.intervals.push({ from: at, to: null });
}

export function stateAt(input, avatar, k) {
    const result = derivePresence(input);
    if (!integer(k) || k >= result.length) return { state: 'unknown', channel: null };
    const person = Object.hasOwn(result.byAvatar, avatar) ? result.byAvatar[avatar] : null;
    const change = person?.changes.findLast(c => c.at + Number(c.boundary === 'after') <= k);
    return { state: change?.state ?? 'unknown', channel: change?.channel ?? null };
}

export function inspect(input, at, event, { includeProjection = false } = {}) {
    const field = event?.schema === 2 ? 'rpePresenceOpen' : 'rpePresence';
    const row = input.chat?.[at], records = row?.extra?.[field];
    if (!integer(at) || !object(row) || !object(event)
        || Object.hasOwn(row.extra ?? {}, field) && !Array.isArray(records)) return { ok: false, reason: 'field-invalid', effective: false };
    const staged = { ...row, extra: { ...row.extra, [field]: records?.includes(event) ? records : [...(records ?? []), event] } };
    const generating = input.generating?.message === row ? { ...input.generating, message: staged } : input.generating;
    let ownReason, chainReason;
    const inspection = { at, event, reject(record, reason, targets, matches) {
        if (record === event) ownReason ??= reason;
        else if (targets.includes(event.avatar) && (matches ? matches.some(valid => valid.event.id === event.id)
            : record?.id === event.id)) chainReason ??= reason;
    } };
    const projection = projectPresence({ ...input, chat: input.chat.with(at, staged), generating }, inspection);
    const reason = ownReason ?? chainReason ?? (at >= projection.length ? 'field-invalid' : null);
    return { ok: reason === null, reason, effective: reason === null && inspection.effectiveAt !== undefined,
        ...(includeProjection && { projection }) };
}

export function derivePresence(input) { return projectPresence(input); }
function projectPresence({ chat, roster, openingSnapshot = null, fallbackAvatar = null, generating = null,
    through = (chat?.length ?? 0) - 1 }, inspection) {
    if (!Array.isArray(chat) || chat.some(row => row && Object.hasOwn(row, 'revisionPending'))) throw new TypeError('需要原始 chat 数组');
    if (!integer(through, -1)) throw new RangeError('through 必须是大于等于 -1 的整数');
    const prefix = rowsFromChat(chat.slice(0, through + 1), fallbackAvatar, generating);
    const cards = roster.filter(card => nonempty(card?.avatar) && !isCamera(card));
    const avatars = new Set(cards.map(card => card.avatar));
    const byAvatar = Object.fromEntries([...avatars].map(avatar => [avatar, { intervals: [], changes: [] }]));
    const unresolved = [], failedAt = new Map();
    const issue = (at, source, reason, ref, avatar, candidates = [], details) => unresolved.push({
        at, avatar: avatar ?? null, source, reason,
        identity: { avatar: ref?.avatar ?? null, name: ref?.name ?? ref?.who ?? null }, candidates, eventId: ref?.id ?? null,
        ...details,
    });
    const rejectEvent = (at, event, reason, targets = [event.avatar], cutoff = at, matches) => {
        inspection?.reject(event, reason, targets, matches);
        for (const avatar of targets.length ? targets : [null]) {
            if (cutoff !== null && avatars.has(avatar)) failedAt.set(avatar, Math.min(cutoff, failedAt.get(avatar) ?? cutoff));
            issue(at, event?.source ?? 'rpePresence', reason, event, avatar, targets, { version: event?.version ?? null });
        }
    };
    const legacy = (at, source, ref) => {
        const { person, candidates } = resolveIdentity(cards, ref);
        issue(at, source, 'legacy-only', typeof ref === 'string' ? { name: ref } : ref, person?.avatar, candidates);
    };
    const actions = verifiedActions(prefix, chat, avatars, new Set(roster.map(card => card?.avatar)), rejectEvent);
    if (openingSnapshot != null) {
        const { at, members, disabled } = openingSnapshot;
        const floor = integer(at) && at < prefix.length ? at : null;
        const files = new Set([members, disabled].filter(Array.isArray).flatMap(list => Array.from(list)));
        issue(floor, 'opening-snapshot', 'legacy-only', null, null, [], { ref: openingSnapshot });
        for (const avatar of files) if (nonempty(avatar)) legacy(floor, 'opening-snapshot', { avatar });
    }
    for (const [at, row] of prefix.entries()) {
        for (const [avatar, change, evidence] of floorChanges(actions[at], at, rejectEvent, actions[at + 1])) {
            applyChange(byAvatar[avatar], change);
            if (at === inspection?.at && evidence.some(event => event.id === inspection.event.id && event.version === inspection.event.version))
                inspection.effectiveAt = at + Number(change.boundary === 'after');
        }
        if (row.fp === null) issue(at, 'message', 'field-invalid');
        legacyIssues(row, (source, ref) => legacy(at, source, ref));
        const board = row.extra?.rp_board, people = board?.people;
        if (Object.hasOwn(board ?? {}, 'people') && !object(people)) issue(at, 'manual', 'legacy-only', null, null, [], { ref: people });
        for (const key of object(people) ? Object.keys(people).sort() : []) {
            const value = people[key], { avatar, name } = value ?? {};
            const candidates = [...new Set(cards.filter(card => card.avatar === key || card.name === key
                || card.avatar === avatar || name != null && card.name === name).map(card => card.avatar))].sort();
            issue(at, 'manual', 'legacy-only', { avatar, name: name ?? key }, candidates.length === 1 ? candidates[0] : null,
                candidates, { key });
        }
    }
    for (const [avatar, person] of Object.entries(byAvatar)) {
        const at = failedAt.get(avatar);
        if (at !== undefined) {
            person.changes = person.changes.filter(change => change.at + Number(change.boundary === 'after') < at);
            person.changes.push({ at, state: 'unknown', channel: null, source: 'unresolved', boundary: 'on' });
            person.intervals = person.intervals.filter(interval => interval.from < at);
            const last = person.intervals.at(-1);
            if (last && (last.to === null || last.to > at)) last.to = at;
        }
        if (person.changes[0]?.at !== 0 || person.changes[0].boundary === 'after') {
            issue(0, 'opening', 'no-opening-evidence', { avatar }, avatar);
        }
    }
    if (inspection && inspection.effectiveAt >= failedAt.get(inspection.event.avatar)) inspection.effectiveAt = undefined;
    return { byAvatar, unresolved, floorChannels: {}, length: prefix.length };
}
