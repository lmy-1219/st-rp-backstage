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
const completeRef = value => object(value) && nonempty(value.sid) && nonempty(value.fp) && integer(value.sw);
const validRef = value => completeRef(value) && Object.keys(value).every(key => ['sid', 'fp', 'sw'].includes(key));

function eventShapeReason(event, cards) {
    if (!object(event)) return 'field-invalid';
    const { schema, source, avatar, opKey, id, carrier, version, action, way, deps, targetVersion } = event;
    const undo = action === 'undo', fixed = fixedActions.get(source);
    const independent = source === 'manual' || source === 'opening';
    const enterWay = independent ? way === '当面' || source === 'manual' && way === '远程' : ways.has(way);
    if (schema !== 1 || !fixedActions.has(source) || !cards.has(avatar) || !nonempty(opKey)
        || !nonempty(id) || !validRef(carrier) || !integer(version, 1)
        || (undo ? !integer(targetVersion, 1) : Object.hasOwn(event, 'targetVersion'))
        || !undo && (fixed ? action !== fixed : action !== 'enter' && action !== 'leave')
        || (action === 'enter' ? !enterWay : way !== null)
        || !Array.isArray(deps) || !undo && independent && deps.length
        || !Array.from(deps).every(validRef)) return 'field-invalid';
    if (Object.hasOwn(event, 'factBasis') || Object.hasOwn(event, 'sourceVersion')) return 'dependency-missing';
    return Object.keys(event).every(key => eventFields.has(key)) ? null : 'field-invalid';
}
const refKey = ({ sid, fp, sw }) => JSON.stringify([sid, fp, sw]);
const eventId = ({ avatar, source, opKey, carrier: { sid, fp, sw } }) => JSON.stringify([avatar, source, opKey, sid, fp, sw]);

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

function indexRows(prefix) {
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
    const locate = ref => {
        const at = sources.get(ref.sid);
        if (at == null || at === -1) return -1;
        const { extra, rpeSourceId, rpeMessageId, fp, swipe_id } = prefix[at];
        if (rpeSourceId != null && rpeSourceId !== extra?.rpeSourceId
            || rpeMessageId != null && extra?.rpeMessageId != null && rpeMessageId !== extra.rpeMessageId
            || messages.get(rpeMessageId ?? extra?.rpeMessageId) === -1) return -1;
        if (fp === null) return -2;
        return extra?.rpeSourceId === ref.sid && fp === ref.fp && swipe_id === ref.sw
            && !hidden(prefix[at]) && !prefix[at].revisionPending ? at : -1;
    };
    return { locate, ranks };
}

const ownDelivery = (row, avatar) => row.speaker === avatar && !row.is_user && avatar !== 'user' && avatar !== 'narrator';
function eventReason(event, row, at, cards, { locate, ranks }) {
    const invalid = eventShapeReason(event, cards);
    if (invalid) return invalid;
    const { source, avatar, carrier, action, deps } = event, undo = action === 'undo';
    if (event.id !== eventId(event)) return 'op-conflict';
    if (locate(carrier) !== at || source === 'opening' && at !== 0) return 'field-invalid';
    if (source === 'delivery' && (!ownDelivery(row, avatar) || !row.mes.trim())) return 'field-invalid';
    let first, last = -1, includesCarrier = false;
    for (const ref of deps) {
        const pos = locate(ref);
        if (pos === -2) return 'field-invalid';
        if (pos <= last || !undo && source === 'delivery' && pos >= at) return 'dependency-missing';
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

function verifiedActions(prefix, cards, rosterAvatars, rejectEvent) {
    const index = indexRows(prefix), floors = prefix.map(() => []), verified = [], rejected = [], bound = [];
    for (const [at, row] of prefix.entries()) {
        if (!row.extra || !Object.hasOwn(row.extra, 'rpePresence')) continue;
        const records = row.extra.rpePresence;
        if (!Array.isArray(records)) {
            rejected.push({ at, event: records, reason: 'field-invalid' });
            continue;
        }
        for (const event of records) {
            const reason = eventReason(event, row, at, cards, index);
            const entry = { at, event, reason };
            (reason ? rejected : verified).push(entry);
            if (cards.has(event?.avatar) && fixedActions.has(event.source) && nonempty(event.opKey)) bound.push(entry);
        }
    }
    for (const entry of rejected) {
        const { at, event, reason } = entry, carrier = event?.carrier;
        if (nonempty(event?.avatar) && !rosterAvatars.has(event.avatar)) {
            rejectEvent(at, event, 'avatar-not-in-roster', []);
            continue;
        }
        const carrierKey = completeRef(carrier) ? refKey(carrier) : null;
        const matches = verified.filter(({ event: valid }) => valid.id === event?.id
            || carrierKey && valid.opKey === event.opKey && refKey(valid.carrier) === carrierKey);
        const targets = new Set(matches.map(valid => valid.event.avatar));
        if (cards.has(event?.avatar) && (fixedActions.has(event.source) && nonempty(event.opKey)
            && carrierKey && event.id === eventId(event)
            || event.source === 'delivery' && ownDelivery(prefix[at], event.avatar))) targets.add(event.avatar);
        if (!targets.size && !nonempty(event?.avatar)) for (const valid of verified) if (valid.at === at) targets.add(valid.event.avatar);
        entry.targets = [...targets].sort();
        rejectEvent(at, event, reason, entry.targets);
    }
    const operations = Map.groupBy(bound, ({ event }) => JSON.stringify([event.avatar, event.source, event.opKey]));
    for (const entries of operations.values()) {
        const { at, event } = entries[0];
        if (entries.some(entry => entry.at !== at || entry.event.id !== event.id)) {
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

function* floorChanges(events, at, issue) {
    const change = (entries, boundary, channel = null) => {
        if (!entries?.length) return null;
        const { action, way } = entries[0];
        if (entries.some(event => event.action !== action || event.way !== way)) {
            for (const event of entries) issue(at, event, 'event-floor-conflict');
            return null;
        }
        const source = entries.reduce((first, event) => event.source < first ? event.source : first, entries[0].source);
        channel = way === '远程' ? channel : ways.get(way) ?? null;
        const state = action === 'leave' ? 'absent' : way === '远程' || channel ? 'remote' : 'present';
        return { at, state, channel, source, boundary };
    };
    for (const [avatar, entries] of Map.groupBy(events, event => event.avatar)) {
        const layers = Map.groupBy(entries, event => ['manual', 'opening'].includes(event.source) ? event.source : event.action);
        const opening = change(layers.get('opening'), 'on');
        const enter = change(layers.get('enter'), 'on'), leave = change(layers.get('leave'), 'after');
        const manual = change(layers.get('manual'), 'on', enter?.channel ?? null);
        if (manual || enter || opening) yield [avatar, manual ?? enter ?? opening];
        if (leave && !manual) yield [avatar, leave];
    }
}

function applyChange(person, change) {
    const previous = person.changes.at(-1);
    if (previous?.state === change.state && previous.channel === change.channel && previous.source === change.source) return;
    person.changes.push(change);
    const at = change.at + Number(change.boundary === 'after');
    const last = person.intervals.at(-1);
    if (change.state === 'absent') {
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

export function derivePresence({ chat, roster, openingSnapshot = null, fallbackAvatar = null, generating = null,
    through = (chat?.length ?? 0) - 1 }) {
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
    const rejectEvent = (at, event, reason, targets = [event.avatar]) => {
        for (const avatar of targets.length ? targets : [null]) {
            if (avatars.has(avatar)) failedAt.set(avatar, Math.min(at, failedAt.get(avatar) ?? at));
            issue(at, event?.source ?? 'rpePresence', reason, event, avatar, targets, { version: event?.version ?? null });
        }
    };
    const legacy = (at, source, ref) => {
        const { person, candidates } = resolveIdentity(cards, ref);
        issue(at, source, 'legacy-only', typeof ref === 'string' ? { name: ref } : ref, person?.avatar, candidates);
    };
    const actions = verifiedActions(prefix, avatars, new Set(roster.map(card => card?.avatar)), rejectEvent);
    if (openingSnapshot != null) {
        const { at, members, disabled } = openingSnapshot;
        const floor = integer(at) && at < prefix.length ? at : null;
        const files = new Set([members, disabled].filter(Array.isArray).flatMap(list => Array.from(list)));
        issue(floor, 'opening-snapshot', 'legacy-only', null, null, [], { ref: openingSnapshot });
        for (const avatar of files) if (nonempty(avatar)) legacy(floor, 'opening-snapshot', { avatar });
    }
    for (const [at, row] of prefix.entries()) {
        for (const [avatar, change] of floorChanges(actions[at], at, rejectEvent)) applyChange(byAvatar[avatar], change);
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
    return { byAvatar, unresolved, floorChannels: {}, length: prefix.length };
}
