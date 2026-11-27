import { presenceEvidence, rowsFromChat } from './presence-events.mjs';
import { fingerprint, isCamera, sequenceRevision, visibleTo } from './sync.mjs';

const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const versionOf = value => fingerprint(false, 'presence', canonical(value));
const unique = rows => [...new Map(rows.map(row => [canonical(row), row])).entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, row]) => row);
const visible = row => row?.fp && !row.hidden && !row.is_system && !row.revisionPending;
const channels = { 当面: null, 电话: 'phone', 消息: 'message' };
const sourceRef = ({ source, id = null, opKey = null, version = null, origin = null, carrier = null, deps }, type = source) =>
    ({ type, id, opKey, version, origin, carrier, deps: deps ?? [] });
function endpoint(side, at, boundary, state, channel, evidence, reason = null) {
    const verdict = reason?.endsWith('-conflict') || reason === 'version-chain' ? 'conflict' : reason === 'not-live' ? 'not-live' : reason ? 'unknown' : 'proven';
    return { side, at, boundary, effectiveAt: at === null ? null : at + Number(boundary === 'after'),
        state, channel, verdict, evidence: unique(evidence), reasons: reason ? [reason] : [] };
}
function legacyEndpoint({ type, avatar, at, id, record: receipt }, row, { card, facts, matches, originLimit }) {
    const open = type === 'rpeArrival', side = open ? 'open' : 'close', boundary = open ? 'on' : 'after';
    const linked = facts.filter(fact => fact?.id === id);
    const ref = card && at !== null && linked.find(fact => fact.kind === (open ? 'arrival' : 'leave') && (open || fact.carrier?.pos === at));
    if (!ref) return endpoint(side, at, boundary, 'unknown', null, [sourceRef({ ...receipt, id, carrier: receipt.after }, type)], 'source-unavailable');
    const carrier = ref.carrier, channel = open ? channels[ref.way] ?? null : null;
    const persisted = open ? visible(row) && row.speaker === avatar && !row.is_user && row.mes.trim()
        && receipt.fp === carrier?.fp && receipt.sw === carrier.sw && receipt.sentAt === carrier.sentAt
        : (receipt.closed || receipt.observed) && String(receipt.after.toDate ?? '') === String(row.send_date ?? '');
    const reason = linked.length > 1 || ref.avatar !== avatar ? 'source-conflict'
        : ref.phase !== 'fact' || !ref.id || !ref.origin || ref.version == null || !(at < originLimit(ref.origin)) ? 'source-unavailable'
        : ref.state !== 'live' ? ref.state === 'not-live' ? 'not-live' : 'source-unavailable'
        : !persisted || carrier?.pos !== at || !matches({ ...carrier, arrivalId: open ? ref.id : null }, at)
            || !Array.isArray(ref.deps) || open && !ref.deps.length
            || !Array.from(ref.deps).every(dep => dep?.pos < originLimit(ref.origin) && matches(dep, dep.pos)) ? 'carrier-unverified'
        : open && !Object.hasOwn(channels, ref.way) ? 'channel-unverified' : null;
    return endpoint(side, at, boundary, open ? channel ? 'remote' : 'present' : 'absent', channel, [sourceRef(ref, type)], reason);
}

export function importLegacyPresence(input) {
    const { chat, roster, generating, fallbackAvatar, openingSnapshot, localWindow = null, chatKey = null,
        chatMetadata: metadata = {}, materials } = input;
    // T150a：确认楼。只给楼号 >= floor 的旧账痕迹记账；没有楼号的整窗级项照旧。不传则逐值不变。
    const floor = Number.isSafeInteger(input.floor) && input.floor > 0 ? input.floor : null;
    const { prefix, locate, changes, rejected, withdrawn, unresolved: diagnostics } = presenceEvidence(input);
    const length = prefix.length, anchors = metadata.contextIsolation?.anchors ?? {};
    const originalRows = chat.slice(0, (input.through ?? chat.length - 1) + 1);
    const versionFor = (rows, projected = rowsFromChat(rows, fallbackAvatar, generating)) => rows.length + ':' + versionOf([localWindow, chatKey, rows,
        projected.map(row => [row.fp, row.revisionPending]), roster, fallbackAvatar, openingSnapshot, metadata]);
    const inputVersion = versionFor(originalRows, prefix), scoped = localWindow != null && materials?.inputVersion === inputVersion ? materials : null;
    const oldLength = Number(String(materials?.inputVersion ?? '').split(':')[0]);
    const appended = localWindow != null && oldLength < originalRows.length && materials?.fragments?.length
        && materials.inputVersion === versionFor(originalRows.slice(0, oldLength));
    const suppliedFacts = unique(materials?.facts ?? []), facts = scoped ? suppliedFacts : [];
    const fragments = unique((scoped || appended ? materials.fragments : []) ?? []);
    const fork = scoped?.fork, parent = fork?.parentKey, headKey = metadata.rp_emergence?.chatKey;
    const forkVerified = parent && parent !== chatKey && (headKey === parent || (headKey ?? undefined) === chatKey)
        && Number.isSafeInteger(fork.cut) && fork.cut >= 0;
    const originLimit = origin => origin === chatKey ? length : forkVerified && origin === parent ? fork.cut : 0;
    const window = { localWindow, chatKey, length, inputVersion, version: versionOf([inputVersion, suppliedFacts, !!scoped, fragments, !!materials?.fragments?.length, fork, scoped?.newWindow]) };
    const reasons = [], blockers = [], byAvatar = Object.create(null);
    const reasonAt = (avatar, at, reason, sourceRefs = [], candidates = [], range) =>
        ({ avatar, candidates, at, range, reason, sourceRefs, owner: reason === 'manual-review' ? 'd2' : 'c' });
    const block = (...args) => reasons.push(reasonAt(...args));
    const gate = (...args) => { if (floor === null || !(Number.isSafeInteger(args[1]) && args[1] < floor)) blockers.push(reasonAt(...args)); };
    const trace = (type, avatar, at, ref, candidates) => gate(avatar ?? null, Number.isSafeInteger(at) && at >= 0 ? at : null, 'legacy-unverified', [{ ...ref, type }], candidates);
    const cards = roster.filter(card => card?.avatar && !isCamera(card));
    const avatars = new Set([...cards.map(card => card.avatar), ...Object.keys(anchors)]);
    function matches(ref, at) {
        const row = prefix[at];
        if (!Number.isSafeInteger(at) || !ref?.fp || !visible(row) || row.fp !== ref.fp
            || ref.sw !== sequenceRevision(chat[at], row.speaker, row.fp, generating, chat[prefix.length - 1]).w
            || !Object.hasOwn(ref, 'sentAt') || ref.sentAt !== (row.send_date ?? null)) return false;
        const ids = new Set([row.rpeMessageId, row.extra?.rpeMessageId].filter(Boolean));
        const duplicate = m => [m.rpeMessageId, m.extra?.rpeMessageId].some(id => ids.has(id))
            || ref.arrivalId && m.extra?.rpeArrival?.id === ref.arrivalId;
        const id = ref.rpeMessageId ?? ref.messageId;
        if (ids.size > 1 || id != null && !ids.has(id) || prefix.some((m, i) => i !== at && duplicate(m))) return false;
        if (ref.sid || row.rpeSourceId || row.extra?.rpeSourceId)
            return !!ref.sid && locate({ sid: ref.sid, fp: ref.fp, sw: row.swipe_id ?? null }) === at;
        return id != null || !ids.size && prefix.filter(m => m.fp === ref.fp).length === 1;
    }
    const privateSenders = new Map(), receipts = [];
    for (const fact of suppliedFacts) trace('fact', fact?.avatar, fact?.carrier?.pos, sourceRef(fact ?? {}));
    for (const type of ['rpeExecution', 'rpeLeaveRetries'])
        for (const [id, record] of Object.entries(metadata[type] ?? {})) trace(type, record?.avatar, record?.at, { id });
    const issuesAt = Map.groupBy(diagnostics, d => d.at);
    for (const [at, row] of originalRows.entries()) {
        const extra = row?.extra ?? {}, arrival = extra.rpeArrival;
        if (extra.rp_board != null && !issuesAt.get(at)?.some(d => d.source === 'manual')) trace('rp_board', null, at);
        if (arrival != null) receipts.push({ type: 'rpeArrival', avatar: arrival.avatar, at, id: arrival.id, record: arrival });
        // 无身份的观察者看不到私聊。用正式可见性入口识别同样的标记。
        if (extra.rp_vis != null && !row.original_avatar && !visibleTo(row, {}, null, [])) {
            const issue = issuesAt.get(at)?.find(d => d.source === 'rp_vis');
            const sender = issue?.avatar ?? issue?.identity.avatar;
            trace('rp_vis', sender, at, issue, issue?.candidates);
            privateSenders.set(at, sender);
        }
        for (const event of [extra.rpePresence, extra.rpePresenceOpen].flat().filter(Boolean))
            if (event.source === 'segment-open' || Object.hasOwn(event.carrier ?? {}, 'send_date') || event.factBasis != null
                || event.sourceVersion != null || arrival?.id != null && event.opKey === arrival.id
                || event.id != null && suppliedFacts.some(fact => fact?.shadowId === event.id))
                trace('shadow', event.avatar, at, sourceRef(event));
    }
    for (const [id, record] of Object.entries(metadata.rpeLeaveEvents ?? {}))
        receipts.push({ type: 'rpeLeaveEvents', avatar: record?.avatar, at: record?.after?.to - 1, id, record });
    for (const { type, avatar, at, id, record } of receipts) trace(type, avatar, at, { id, carrier: record?.after });
    for (const [id, record] of Object.entries(metadata.rpeBoardApplied ?? {})) {
        const { avatar, pos, fp, status } = record ?? {}, row = prefix[pos];
        const mark = (!forkVerified || pos < fork.cut) && visible(row) && row.fp === fp && id === [avatar, pos, fp].join(':')
            && !prefix.some((m, at) => at !== pos && m.fp === fp) && issuesAt.get(pos)?.find(d => d.source === 'manual' && d.avatar === avatar
                && (row.extra?.rp_board?.people?.[d.key]?.status ?? row.extra?.rp_board?.people?.[d.key]) === status);
        const start = mark ? pos : forkVerified ? Math.min(fork.cut, length) : null;
        trace('rpeBoardApplied', avatar, mark ? pos : null, { id, record });
        block(avatars.has(avatar) ? avatar : null, mark ? pos : null, mark ? 'manual-review' : 'manual-origin-unverified',
            [{ type: 'rpeBoardApplied', id, record, mark: mark || undefined }], [], start === null ? undefined : [start, length]);
    }
    for (const d of diagnostics) {
        if (d.reason !== 'legacy-only' && (length || d.reason !== 'no-opening-evidence')) gate(d.avatar, d.at, d.reason, [d], d.candidates);
        if (d.source === 'rp_vis' && privateSenders.has(d.at) && !privateSenders.get(d.at)) block(null, d.at, 'fragment-unverified', [d], d.candidates);
        if (!['arrivals', 'auto_came', 'departure', 'manual'].includes(d.source)) continue;
        trace(d.source === 'manual' ? 'rp_board' : d.source, d.avatar, d.at, d, d.candidates);
        if (reasons.some(b => b.sourceRefs[0]?.mark === d)) continue;
        const reason = d.source !== 'manual' ? 'legacy-only' : visible(prefix[d.at]) ? 'manual-review' : 'manual-origin-unverified';
        block(d.avatar, d.at, reason, [d], d.candidates);
    }
    for (const avatar of avatars) {
        const endpoints = [], ranges = [], ownFragments = [], stops = new Set();
        const card = cards.find(card => card.avatar === avatar);
        for (const { change, sources } of changes.filter(entry => entry.avatar === avatar))
            endpoints.push(endpoint(change.state === 'absent' ? 'close' : 'open', change.at, change.boundary, change.state, change.channel,
                sources.map(event => sourceRef(event))));
        for (const { at, event, reason, cutoff, versions, targets } of [...withdrawn, ...rejected]) {
            const matchesAvatar = versions ? event.avatar === avatar : targets?.includes(avatar);
            if (!matchesAvatar) continue;
            const close = event?.action === 'leave', boundary = close || event?.source === 'segment-open' ? 'after' : 'on';
            const sources = versions ?? (event?.source ? [event] : []);
            endpoints.push(endpoint(close ? 'close' : 'open', at, boundary, 'unknown', null, sources.map(event => sourceRef(event)), reason ?? 'not-live'));
            if (!versions) stops.add(cutoff ?? at + Number(boundary === 'after'));
        }
        for (const receipt of receipts.filter(r => r.avatar === avatar && !r.record?.undone && r.record?.status !== 'superseded'))
            endpoints.push(legacyEndpoint({ ...receipt, at: prefix[receipt.at] ? receipt.at : null }, prefix[receipt.at], { card, facts, matches, originLimit }));
        for (const [at, row] of prefix.entries()) {
            if (!card || !visible(row) || row.is_user || !row.mes.trim()) continue;
            const pieces = fragments.filter(piece => piece.carrier?.pos === at && (scoped || at < oldLength));
            const sender = privateSenders.has(at) ? privateSenders.get(at) : row.speaker;
            if (sender !== avatar && !pieces.some(piece => piece.avatar === avatar)) continue;
            const carrier = { pos: at, sid: row.extra?.rpeSourceId ?? null, rpeMessageId: row.extra?.rpeMessageId ?? row.rpeMessageId,
                fp: row.fp, sw: row.swipe_id ?? 0, sentAt: row.send_date ?? null };
            const valid = pieces.filter(({ carrier, range }) => Array.isArray(range) && range.length === 2
                && range.every(Number.isSafeInteger) && range[0] >= 0 && range[0] < range[1] && range[1] <= row.mes.length && matches(carrier, at));
            const bounds = [...new Set([0, row.mes.length, ...valid.flatMap(piece => piece.range)])].sort((a, b) => a - b);
            for (let i = 1; i < bounds.length; i++) {
                const from = bounds[i - 1], to = bounds[i], covering = valid.filter(piece => piece.range[0] <= from && piece.range[1] >= to);
                const own = covering.find(piece => piece.avatar === avatar && piece.id);
                if (own && covering.every(piece => piece.avatar === avatar) && visibleTo({ ...row, speaker: sender }, card, '', roster))
                    ownFragments.push({ avatar, at, carrier, range: [from, to], id: own.id });
                else if ((sender === avatar || own) && row.mes.slice(from, to).trim())
                    block(avatar, at, 'fragment-unverified', [], [], [from, to]);
            }
        }
        const arrivals = endpoints.filter(end => end.evidence[0]?.type === 'rpeArrival' && end.verdict !== 'proven');
        for (const end of endpoints.filter(end => end.verdict === 'proven')) {
            const old = arrivals.find(old => end.evidence.some(ref => ref.type === 'delivery' && (ref.id === facts.find(fact => fact?.id === old.evidence[0].id)?.shadowId
                || old.evidence[0].id && ref.opKey === old.evidence[0].id && end.at === old.at)));
            if (old) Object.assign(end, { verdict: old.verdict, reasons: old.reasons });
        }
        const active = new Map();
        for (const [at, group] of Map.groupBy(endpoints.filter(end => end.verdict === 'proven'), end => end.effectiveAt)) {
            const [first, ...copies] = group;
            if (copies.some(end => end.state !== first.state || end.channel !== first.channel)) {
                for (const end of group) Object.assign(end, { verdict: 'conflict', reasons: ['source-conflict'] });
                stops.add(at);
            } else {
                first.evidence = unique(group.flatMap(end => end.evidence));
                for (const copy of copies) endpoints.splice(endpoints.indexOf(copy), 1);
                active.set(at, first);
            }
        }
        const segments = anchors[avatar]?.segments ?? [];
        for (const segment of Array.isArray(segments) ? segments : [null]) {
            const { from, to, fromDate, toDate } = segment ?? {};
            const ref = { type: 'contextIsolation', avatar, from, to, fromDate, toDate }, openAt = Math.max(0, from - 1);
            const inheritedClose = forkVerified && from <= fork.cut && to - 1 >= fork.cut
                && fork.closes?.some(close => close.avatar === avatar && close.from === from && close.to === to && close.toDate === toDate);
            const matchesDate = (at, date) => visible(prefix[at]) && (!date || String(prefix[at].send_date ?? '') === String(date));
            const openingProven = matchesDate(openAt, fromDate) && active.get(from)?.side === 'open';
            for (const [side, bound, at, date] of [['open', from, openAt, fromDate], ['close', to, to - 1, toDate]]) {
                if (side === 'close' && to === null) continue;
                trace(ref.type, avatar, prefix[at] && !(side === 'close' && inheritedClose) ? at : null, { ...ref, side });
                if (side === 'close' && inheritedClose) continue;
                const located = matchesDate(at, date), manualClose = side === 'close'
                    && reasons.some(b => b.avatar === avatar && b.at === bound && b.reason === 'manual-review');
                if (located && active.get(bound)?.side === side || manualClose) continue;
                endpoints.push(endpoint(side, located ? at : null, at === bound ? 'on' : 'after', 'unknown', null, [ref], 'legacy-boundary-unverified'));
                const cutoff = side === 'close' && openingProven ? from + 1 : Number.isSafeInteger(bound) ? bound : 0;
                stops.add(forkVerified && at >= fork.cut ? Math.max(fork.cut, cutoff) : cutoff);
            }
        }
        for (const end of endpoints) {
            if (end.verdict === 'unknown' && ['rpeArrival', 'rpeLeaveEvents'].includes(end.evidence[0]?.type) && active.get(end.effectiveAt)?.side !== end.side) stops.add(end.effectiveAt);
            const reason = end.state === 'remote' && !end.channel && end.verdict === 'proven' ? 'channel-unverified' : end.reasons[0];
            if (reason && reason !== 'not-live') block(avatar, end.at, reason, end.evidence);
        }
        let current;
        for (let at = 0; at < length; at++) {
            const pending = reasons.some(b => b.at === at && [null, avatar].includes(b.avatar)
                && (b.reason === 'manual-review' || b.reason === 'legacy-only'));
            current = stops.has(at) || pending ? undefined : active.get(at) ?? current;
            const last = ranges.at(-1);
            if (last && last.evidence === current?.evidence) last.to++;
            else ranges.push(current ? { from: at, to: at + 1, state: current.state, channel: current.channel, evidence: current.evidence }
                : { from: at, to: at + 1, state: 'unknown', channel: null, reason: active.size ? 'continuity-unverified' : 'no-endpoint-evidence' });
        }
        for (const { from, to, reason } of ranges) if (reason) block(avatar, from, reason, [], [], [from, to]);
        byAvatar[avatar] = { advisory: true, endpoints: unique(endpoints), ranges, ownFragments, unresolved: unique([...reasons, ...blockers].filter(b => b.avatar === avatar || b.candidates.includes(avatar))) };
    }
    const hasHead = ['contextIsolation', 'rpeBoardApplied', 'rpeExecution', 'rpeLeaveRetries'].some(key => metadata[key] != null)
        || headKey !== undefined;
    if (localWindow == null || length && !avatars.size || headKey && headKey !== chatKey && !forkVerified) gate(null, null, 'window-unverified');
    if (!length && (chat.length || hasHead || !scoped?.newWindow || materials?.facts?.length || materials?.fragments?.length)) gate(null, null, 'empty-unverified');
    const disposition = blockers.length ? 'hold' : length ? 'ready' : 'empty-new';
    return { window, byAvatar, unresolved: unique([...reasons, ...blockers]), eligibility: { disposition, d1Ready: disposition !== 'hold', blockers: unique(blockers) } };
}
