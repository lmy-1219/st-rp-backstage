// 场面表的唯一读口：开场 avatar、隔离区间、进离场记录、开局依据与人工纠正在这里统一裁决。
// 调用方的 present 只供诊断，不能改变事实；住处与时间沿用现有读口。
import { createHash } from 'node:crypto';
import { hasCard, validAwayPlan, lastLeave, awayStage, callsFor, isRemote, metInPerson } from './arrival.mjs';
import { narrationOf, dateOf, calendarOf, weatherOn, PARTS } from './timeline.mjs';
import { lifeSheet } from './life.mjs';
import { awayPlansOf } from './opening.mjs';
import { arrivalLive, emptySegment } from './landing.mjs';
import { foldState } from './state.mjs';
import { sameIdentity, resolveIdentity } from './cast.mjs';
import { knockState } from './knock.mjs';

const CAMERA_NAME = '旁白';   // 镜头那张卡的名字（slot.mjs 也是这个）
const MOVE_WORDS = '走进|走到|进了|进入|来到|到了|回到|下楼到|下楼找到|上楼到|推门进|拐进|踏进|钻进|跟着[^，。；！？,;!?]{0,12}进了';
const PLACE_RE = new RegExp(`(?:${MOVE_WORDS})\\s*([^，。；！？,;!?\\s]{2,12}?)(?=[，。；！？,;!?]|里|内|门口|外|$)`, 'g');
const GENERIC_PLACES = new Set(['家里', '这里', '那里', '外头', '楼下', '楼上', '门口', '屋里', '里面', '外面', '这边', '那边', '前面', '后面', '窗边', '床边', '门外', '屋外']);
// movement 仍供自动离场使用；它的词面结果不进入镜头地点。
const HEAD_RE = /(?:往|朝)\s*([^，。；！？,;!?\s（）()]{2,10}?)\s*(?:走去|走|去|赶|跑|那边去|方向)/g;
const TIME_RE = /凌晨|早上|上午|中午|下午|傍晚|晚上|深夜/g;
const CLEARED_PLACE = /^(没了|没有了|已经没了|无)$/;

const values = value => Array.isArray(value) ? value : Object.values(value ?? {});
const number = value => Number.isFinite(Number(value)) ? Number(value) : null;
const rosterEntry = entry => typeof entry === 'string' ? { name: entry } : entry;

// 场面与事实快照共用纠正归属；全停用时仍保留可唯一核实的历史身份。
function personMarkValue(mark, person, roster, identityChoices = {}) {
    const { avatar, name } = person;
    if (avatar && Object.hasOwn(mark.people ?? {}, avatar)) return mark.people[avatar];
    for (const [key, chosen] of Object.entries(identityChoices)) {
        if (chosen === avatar && Object.hasOwn(mark.people ?? {}, key)) return mark.people[key];
    }
    if (identityChoices[name] && identityChoices[name] !== avatar) return null;
    const active = roster.filter(p => p.role !== '不用' && p.name === name);
    if (resolveIdentity(active.length ? active : roster, name).person?.avatar !== avatar) return null;
    return mark.people?.[name] ?? null;
}

// leaving.mjs（自动离场：玩家把镜头挪走、没带他）也用这一路认移动，所以导出
export function movement(text) {
    const source = String(narrationOf(text) ?? '');
    let match, at = -1;
    // 到了哪儿、往哪儿去：同一段里后写的那个算
    for (const candidate of [...source.matchAll(PLACE_RE), ...source.matchAll(HEAD_RE)]) {
        const place = candidate[1].replace(/^(?:自己的|他的|她的|他们的)/, '').replace(/(?:这边|那边|这儿|那儿)$/, '');
        if (place.length >= 2 && !GENERIC_PLACES.has(place) && candidate.index > at) { match = { place, time: source.match(TIME_RE)?.[0] ?? null }; at = candidate.index; }
    }
    return match;
}

// 隔离扩展记的区间：from 是他看得到的第一条，to 是他离开后看不到的第一条（离开时记 chat.length，裁上下文只给到 to - 1）
function segmentAt(anchors, avatar, pos) {
    return (anchors?.[avatar]?.segments ?? [])
        .filter(segment => number(segment?.from) != null && segment.from <= pos && (segment.to == null || pos < segment.to))
        .at(-1) ?? null;
}

function planFor(plans, person, roster) {
    return values(plans).find(plan => sameIdentity(plan, person, roster)) ?? null;
}

function rowAt(timeline, pos, fallback) {
    return (timeline?.rows ?? []).filter(row => number(row.pos) != null && row.pos <= pos).at(-1) ?? fallback;
}

// 住处名去掉"某某的"再比（"甲的公寓"和"城东公寓"是一处；"乙的店"剩下"店"，对不上谁的家）
function homeCore(place) {
    return String(place ?? '').replace(/^\s*(?:[^的]{1,12}的)/, '').trim();
}

function homeFor(homes, place) {
    if (!place) return null;
    const target = homeCore(place);
    const home = values(homes).find(item => {
        const core = homeCore(item?.core ?? item?.name);
        return core && (target === core || target.includes(core) || core.includes(target));
    });
    return home?.owners?.[0] ?? null;
}

// inGroup：他在群里开着口——扩展带来的名单里有他；没带名单（后台同步那次）就看隔离区间开着没有
function validRemote(arrived, messages, inGroup, notes = [], others = []) {
    const userName = [...messages].reverse().find(m => m.is_user)?.name ?? null;
    return !!arrived && inGroup
        && isRemote(arrived.how) && arrived.fp
        && Number.isInteger(Number(arrived.at))
        && messages[Number(arrived.at) - 1]?.fp === arrived.fp
        // 接通以后两人当面碰上了：从那条起他就在这儿（那条删了又回到远程）；正文里的样子，或"此刻的样子"读出来的位置
        && !metInPerson(messages.filter(m => (m.pos ?? 0) >= Number(arrived.at)), { who: arrived.who ?? arrived.name, userName, since: Number(arrived.at), others,
            notes: notes.filter(n => messages.some(m => m.pos === n.pos)) });
}

function wayOf(arrived) {
    return /电话|来电/.test(arrived?.how ?? '') ? '电话' : '消息';
}

/**
 * 根据已经截好的消息、状态和时间线生成场面表。
 * 输入是 boardAt 的数据对象，输出包含 time、camera、people、fast 四段。
 */
export function boardAt(input = {}) {
    const messages = [...(input.messages ?? [])].sort((a, b) => (number(a.pos) ?? 0) - (number(b.pos) ?? 0));
    const last = messages.at(-1) ?? {};
    const pos = number(input.pos) ?? number(last.pos) ?? 0;
    const marks = (input.marks ?? []).map((mark, index) => {
        try { const value = typeof mark === 'string' ? JSON.parse(mark) : mark; return value && typeof value === 'object' ? { ...value, pos: number(value.pos) ?? index } : null; } catch { return null; }
    }).filter(mark => mark && mark.pos <= pos && !messages.find(m => m.pos === mark.pos)?.hidden);
    const latestPlaceMark = marks.filter(mark => typeof mark.place === 'string' && mark.place.trim())
        .sort((a, b) => a.pos - b.pos).at(-1) ?? null;
    const timeline = input.timeline ?? {};
    const lastRow = timeline.rows?.at(-1) ?? {};
    const today = timeline.today ?? lastRow.day ?? 0;
    const part = timeline.part ?? lastRow.part ?? null;
    const time = {
        day: today,
        part,
        // 不按天走的局（章程 G2）：日期、天气不在这儿按天推（标签、"此刻的样子"那一行按尺度写）
        date: timeline.date ?? (timeline.scale && timeline.scale.unit !== '天' ? null : dateOf(timeline.start?.日期, today, calendarOf(timeline.start))),
        weather: timeline.weather ?? (timeline.scale && timeline.scale.unit !== '天' ? null : weatherOn(timeline.start?.天气, timeline.seed ?? '', today)),
    };

    // 此地只认"地方"那一格（这一场在哪处）："周围"是一整句环境描写，拿它当地方名会压掉快路
    const notes = (input.stateNotes ?? [])
        .filter(note => note?.who === '此地' && note.aspect === '地方' && note.text && (number(note.pos) ?? 0) <= pos)
        .sort((a, b) => (number(a.pos) ?? 0) - (number(b.pos) ?? 0));
    const latestState = notes.at(-1) ?? null;
    const foldedPlace = foldState(notes).find(n => n.who === '此地' && n.aspect === '地方') ?? null;
    const state = latestState && !CLEARED_PLACE.test(latestState.text.trim()) ? foldedPlace : null;
    const candidates = messages.slice(-2).map(message => ({ ...movement(message.text), pos: number(message.pos) ?? pos })).filter(item => item.place);
    const recent = input.recentUser?.text ?? input.recentUser;
    if (recent) {
        const found = movement(recent);
        if (found) candidates.push({ ...found, pos: pos + 1 });
    }
    const fast = candidates.at(-1) ?? { place: null, pos: null, time: null };
    // 清除也占一个位置，不能越过它拾回旧地点；同位置用户标记优先。
    const rank = { mark: 1, state: 0 };
    const cameraCandidates = [
        latestPlaceMark ? { place: latestPlaceMark.place, pos: latestPlaceMark.pos, from: 'mark' } : null,
        latestState ? { place: state?.text ?? null, pos: number(latestState.pos) ?? 0, from: state ? 'state' : null } : null,
    ].filter(Boolean).sort((a, b) => ((a.pos ?? 0) - (b.pos ?? 0)) || ((rank[a.from] ?? 0) - (rank[b.from] ?? 0)));
    const camera = cameraCandidates.at(-1) ?? { place: null, pos: null, from: null };
    const cameraPlace = camera.place;
    const cameraFrom = camera.from;
    const fallbackRow = { day: today, part };
    // 镜头那张卡（旁白）不是人，不进场面表（和 slot.mjs 的 CAMERA_NAME 一样）
    const solo = input.solo && messages.some(m => !m.is_user && m.speaker === input.solo.avatar && m.name === input.solo.name)
        ? input.solo : null;
    const roster = (input.roster ?? []).map(rosterEntry).filter(person => person?.name && person.name !== CAMERA_NAME)
        .filter(person => !solo || person.name !== solo.name || person.avatar === solo.avatar);
    const scope = roster.filter(p => p.role !== '不用');
    const matches = (a, b) => sameIdentity(a, b, scope);
    const basisLive = e => messages.some(m => !m.hidden && m.pos === e.at && m.fp === e.fp)
        && (e.throughFp == null || messages.some(m => !m.hidden && m.pos === e.through && m.fp === e.throughFp))
        && (!e.basis || e.basis.every(b => messages.some(m => !m.hidden && m.pos === b.pos && m.fp === b.fp)));
    const departures = values(input.departures).filter(e=>basisLive(e) && input.sourceCurrent?.(e)!==false && e.action!=='undo');
    const came = values(input.came).filter(e=>basisLive(e) && input.sourceCurrent?.(e)!==false);
    const firstUser = messages.findIndex(m => m.is_user);
    const opening = messages.slice(0, firstUser < 0 ? messages.length : firstUser)
        .filter(m => !m.hidden && !m.is_user && m.speaker && !m.extra?.rp_vis);
    // 进场被删掉了（那次进场挂的那条消息没了、换了），隔离扩展的区间却还开着（试玩 10/7：删回去重来，旁白一回话正好落在他当初进场那条的位置上，
    // 他就"在场"了，门上那一行跟着没了）：区间起点对应的进场全作废了就不算；之后又有还算数的进场，从那次算起。没有进场记录的区间照旧
    const entries = values(input.arrivals);
    // 叩门作废了的（他发来消息、到了门口，玩家没理，knock.mjs）：那次进场不算——他没进过场，开的区间也不算在场（方案 自动进离场与调度）
    const lapsedKnocks = values(input.knocks).filter(k => k?.lapsed && k.who);
    // 进场挂在他进场后那条回复上（landing.arrivalLive）：他那条删了、后面换成了别人在说，这次进场就不算
    const liveEntry = e => input.knockLive?.(e) !== false && !(e?.knock && lapsedKnocks.some(k=>matches(k,e) && number(k.at)===number(e.at))) && arrivalLive(e, messages, entries, input.anchors);
    const liveSegment = (segment, person) => {
        if (!segment) return null;
        const mine = entries.filter(e => matches(e, person));
        const atStart = mine.filter(e => Number(e.at) === segment.from);
        if (!atStart.length || atStart.some(liveEntry)) return segment;
        const again = mine.filter(e => Number(e.at) > segment.from && Number(e.at) <= pos && liveEntry(e)).at(-1);
        return again ? { ...segment, from: Number(again.at) } : null;
    };
    // 他自己最近一条"位置"（此刻的样子里记的），从 from 这条起、到此刻；没有就 null
    const ownSpot = (name, from) => foldState((input.stateNotes ?? []).filter(n => n?.who === name && number(n.pos) != null && n.pos >= from && n.pos <= pos))
        .filter(n => n.aspect === '位置' && String(n.text ?? '').trim()).at(-1)?.text?.trim() ?? null;
    const people = roster.map(person => {
        const avatar = person.avatar;
        // 他的区间只留还算数的（作废的那次进场开的区间不算在场，也不算"上次离开"）
        // 同一个起点有好几段的只认最后那段（前面的是删回去重来留下的）；结束比开始还早的不认；
        // 封上了、中间一条都没有的（拉进来又移出去，他一句没说）也不认：不算进过场，也不算"刚走"（landing.emptySegment，用户 10/15）
        const raw = (input.anchors?.[avatar]?.segments ?? []).filter(x => number(x?.from) != null && (x.to == null || x.to >= x.from));
        const kept = raw.filter((x, i) => raw.findLastIndex(y => y.from === x.from) === i && !emptySegment(x));
        const segs = kept.map(x => liveSegment(x, person)).filter(Boolean);
        const own = { [avatar]: { segments: segs } };
        const segment = segmentAt(own, avatar, pos);
        // 他最近一次还算数的进场（进场记录里带着怎么来的）；没带的旧记录，照"刚进场的"那一份认
        const mineIn = entries.filter(e => matches(e, person) && Number(e.at) <= pos + 1 && liveEntry(e)).sort((a, b) => Number(a.at) - Number(b.at)).at(-1) ?? null;
        const meta = input.arrived && matches(input.arrived, person) ? input.arrived : null;
        const arrived = meta && (!mineIn || (Number(meta.at) === Number(mineIn.at) && meta.fp === mineIn.fp)) ? meta : mineIn?.how ? { ...mineIn, who: mineIn.who ?? person.name } : null;
        // 开局单里开场不在场的那份去向（opening.mjs）：名单里有他（人就在这儿）就不算
        const planned = planFor(input.awayPlans, person, scope);
        const plan = planned?.seed ? (messages.some(m => m.fp === planned.fp) ? planned : null) : validAwayPlan(planned, messages, input.sourceLive);
        const leave = lastLeave(own, avatar, pos + 1);
        const soloHere = solo?.avatar === avatar && solo.name === person.name;
        // 单聊身份只为仍有效的这次联系补参与资格；较新的去向或离场已经结束它。
        const soloRemote = soloHere && arrived && liveEntry(arrived)
            && (leave == null || leave < Number(arrived.at))
            && (!plan || (plan.at != null && Number(plan.at) < Number(arrived.at)));
        const inGroup = !!segment || soloRemote || (!!arrived && liveEntry(arrived)
            && (leave == null || leave < Number(arrived.at))
            && (!plan || plan.seed || (plan.at != null && Number(plan.at) < Number(arrived.at))));
        const remote = validRemote(arrived, messages, inGroup && (leave == null || Number(arrived?.at) > leave) && (!plan || plan.seed || Number(plan.at) < Number(arrived?.at)), input.stateNotes ?? [], roster.map(p => p.name));
        let status = 'never';
        let since = null;
        let way = null;
        let place = null;
        // 发消息、打电话来的人先认：他在群里开着口，隔离扩展照样记他"在场"，区间分不出他人在不在这儿
        if (remote) {
            status = 'remote';
            since = arrived.at ?? null;
            way = wayOf(arrived);
            // 位置以他自己最新写的为准（章程 #4）：进场那条之后"此刻的样子"里记了他在哪，就是那儿；进场那份写的只管进场那一刻
            place = ownSpot(person.name, Number(arrived.at)) ?? arrived.where ?? null;
        } else if (segment) {
            status = 'present';
            since = segment.from;
            place = cameraPlace;
        } else if ((plan && !plan.seed) || leave != null) {
            status = 'away';
            since = leave ?? plan?.at ?? null;
            place = (leave != null ? ownSpot(person.name, leave) : null) ?? plan?.where ?? null;
        } else if ((soloHere && !planned && (!meta || mineIn || liveEntry(meta)) && !entries.some(e =>
            matches(e, person) && Number(e.at) <= pos + 1 && !liveEntry(e))
            && !(input.anchors?.[avatar]?.segments ?? []).some(x => Number(x.from) <= pos && (emptySegment(x) || !liveSegment(x, person))))) {
            status = 'present';
            place = cameraPlace;
        }
        const firstSpoke = (input.group ?? !input.solo) && person.role !== '不用' && opening.find(m => m.speaker === avatar);
        if (firstSpoke && !remote && (since == null || firstSpoke.pos >= Number(since))
            && !entries.some(e => matches(e, person) && (isRemote(e.how) || e.knock))) {
            status = 'present'; since = firstSpoke.pos; place = cameraPlace;
        } else if (status === 'never' && plan?.seed) {
            status = plan.absent ? 'absent' : 'unknown'; since = plan.at; place = plan.where;
        }
        const events = [
            ...came.filter(c => matches(c, person)).map(c => ({ ...c, kind: 'came' })),
            ...departures.filter(e => matches(e, person)).map(e => ({ ...e, kind: 'leave' })),
        ].sort((a,b) => a.at - b.at || (a.kind === 'leave' ? 1 : -1));
        for (const e of events) {
            if (e.kind === 'came' && status === 'present') continue;
            if (since != null && Number(since) > e.at) continue;
            status = e.kind === 'came' ? 'present' : (messages.some(m => m.is_user && m.pos > e.at) ? 'away' : 'absent');
            since = e.at; way = null; place = status === 'present' ? cameraPlace : null;
        }
        const waiting = values(input.knocks).filter(k => matches(k, person) && !k.entered && !k.lapsed && !k.forced).at(-1);
        if (waiting && waiting.way === '上门' && (since == null || Number(since) <= Number(waiting.at))) {
            const state = knockState(waiting, { messages, knocks: values(input.knocks), roster, rowAt: p => rowAt(timeline,p,fallbackRow) });
            if (state.state === '候着' && state.message) { status = 'remote'; way = '上门'; since = waiting.at; }
        }
        const departure = number(since);
        let stage = status === 'away'
            ? awayStage(events.at(-1)?.kind === 'leave' && since === events.at(-1).at && Number(plan?.at ?? -1) <= events.at(-1).at ? null : plan, rowAt(timeline, departure ?? pos, fallbackRow), fallbackRow, departure == null ? 0 : Math.max(0, pos - departure + 1), timeline?.parts ?? PARTS)
            : null;
        const markValue = mark => personMarkValue(mark, person, roster, input.identityChoices);
        const personMark = marks.filter(mark => markValue(mark) != null).at(-1);
        if (personMark && (since == null || personMark.pos >= departure)) {
            const value = markValue(personMark), marked = typeof value === 'object' ? value.status : value;
            const statusMap = { '在场': 'present', '远程': 'remote', '外头': 'away', '不在': 'absent' };
            if (statusMap[marked]) { status = statusMap[marked]; since = personMark.pos; way = status === 'remote' ? '消息' : null; place = status === 'present' ? cameraPlace : null; }
        }
        // 人工离场的来源随原楼撤销；后来正常进场/人工在场已经生效时不再拦截。
        const marked = personMark && markValue(personMark);
        const markedStatus = typeof marked === 'object' ? marked?.status : marked;
        const manualAt = plan?.manual === true && !plan.seed ? (plan.manualAt ?? { pos: Number(plan.at) - 1, fp: plan.fp }) : null;
        const manualSource = [
            ...(['不在', '外头'].includes(markedStatus) ? [{ pos: personMark.pos, fp: messages.find(m => m.pos === personMark.pos)?.fp }] : []),
            ...(manualAt && messages.some(m => !m.hidden && m.pos === manualAt.pos && m.fp === manualAt.fp) ? [manualAt] : []),
        ].sort((a, b) => a.pos - b.pos).at(-1);
        const manualAway = manualSource && !(mineIn && Number(mineIn.at) > manualSource.pos)
            && !(segment && segment.from > manualSource.pos)
            && !(['在场', '远程'].includes(markedStatus) && personMark.pos >= manualSource.pos) ? manualSource : null;
        if (manualAway) {
            if (!['away', 'absent'].includes(status)) {
                status = plan || markedStatus === '外头' || messages.some(m => !m.hidden && m.is_user && m.pos > manualAway.pos) ? 'away' : 'absent';
                since = manualAway.pos;
            }
            way = null; place = null;
            stage = awayStage(plan, rowAt(timeline, since, fallbackRow), fallbackRow, Math.max(0, pos - since + 1), timeline?.parts ?? PARTS);
        }
        return {
            name: person.name,
            avatar: avatar ?? null,
            card: hasCard(person),
            status,
            way,
            since,
            place,
            plan,
            stage,
            ...(manualAway ? { manualAway } : {}),
            ...(!segment && events.at(-1)?.kind === 'came' && status === 'present' && since === events.at(-1).at ? { enter: { at: since } } : {}),
        };
    });

    const called = [];
    for (const source of [...messages.slice(-2).map(message => narrationOf(message.text)), narrationOf(recent)]) {
        if (!source) continue;
        for (const person of roster) {
            const way = callsFor(source, [person.name]);
            if (way && resolveIdentity(scope,person.name).person?.avatar === person.avatar && !called.some(c => c.avatar === person.avatar)) called.push({ who: person.name, avatar: person.avatar, way });
        }
    }
    const identityWarnings = marks.flatMap(mark => Object.keys(mark.people ?? {}).flatMap(key => {
        if (roster.some(p=>p.avatar===key)) return [];
        const result=resolveIdentity(scope,key);
        return result.status==='ambiguous' ? [{ pos: mark.pos, name: key, candidates: result.candidates, reason: '旧场面纠正的身份待确认' }] : [];
    }));
    return {
        identityWarnings,
        pos,
        fp: last.fp ?? null,
        time,
        camera: { place: cameraPlace ?? null, from: cameraFrom, home: homeFor(input.homes?.homes ?? input.homes, cameraPlace), since: camera.pos },
        people,
        fast: { place: fast.place ?? null, moved: !!fast.place, called, time: fast.time ?? null },
    };
}

function uptoAnchor(messages, anchor) {
    const match = /^(\d+):(.+)$/.exec(String(anchor ?? ''));
    if (!match) return messages;
    const count = Number(match[1]);
    if (!Number.isInteger(count) || count < 1 || messages[count - 1]?.fp !== match[2]) return messages;
    return messages.slice(0, count);
}

function soloMember(chat, roster) {
    if (chat.group_id != null && chat.group_id !== '') return null;
    let members;
    try { members = JSON.parse(chat.members ?? '[]'); } catch { return null; }
    if (!Array.isArray(members)) return null;
    const active = members.filter(Boolean);
    if (active.length !== 1) return null;
    const member = active[0];
    if (!member.avatar || !member.name || member.name === CAMERA_NAME) return null;
    const matches = roster.filter(p => p.avatar === member.avatar && p.name === member.name);
    return matches.length === 1 ? { avatar: member.avatar, name: member.name } : null;
}

function messageMarks(messages) {
    return messages.map(m => {
        if (m.hidden) return null;
        try {
            const mark = typeof m.boardMark === 'string' ? JSON.parse(m.boardMark) : m.boardMark;
            return mark && typeof mark === 'object' ? { ...mark, pos: m.pos } : null;
        } catch { return null; }
    });
}

function cacheVersion(store, chat, chatKey, present, recentUser, marks) {
    const notes = store.stateNotesOf?.(chatKey) ?? [];
    const arrived = store.getMeta?.(`arrived:${chatKey}`) ?? '';
    const plans = store.getMeta?.(`away_plan:${chatKey}`) ?? '';
    return JSON.stringify({
        notes: [notes.length, notes.at(-1)?.id ?? null],
        group: chat.group_id ?? null,
        members: chat.members ?? null,
        cast: (store.getCast?.(chat.story_id) ?? []).map(p => [p.avatar, p.name, p.role]),
        anchors: createHash('sha256').update(String(chat.anchors ?? '')).digest('hex'),
        arrived,
        arrivals: store.getMeta?.(`arrivals:${chatKey}`) ?? '',
        knocks: store.getMeta?.(`knocks:${chatKey}`) ?? '',
        came: store.getMeta?.(`auto_came:${chatKey}`) ?? '',
        departures: store.getMeta?.(`auto_leave_events:${chatKey}`) ?? '',
        plans,
        correctionRev: store.getMeta?.(`correction_rev:${chat.story_id}`) ?? '',
        identityChoices: store.getMeta?.(`card_choices:${chatKey}`) ?? '',
        setup: store.setupOf?.(chat.story_id)?.id ?? null,
        recentUser: recentUser ?? '',
        // 纠正是存在各条上的 JSON 文本：哪几条有、写了什么，都进版本（试玩 10/7：只数条数，改了纠正还拿到旧表）
        marks: (marks ?? []).map((m, i) => (m ? `${i}:${m}` : '')).filter(Boolean).join('|'),
    });
}

const cache = new Map();
const loaderCache = new Map();

/**
 * 从 store 读取场面表输入，按锚点截断并做至多 32 项的 LRU 缓存。
 * 输入为 store、records、chatKey 和可选筛选项，输出与 boardAt 相同。
 */
// 装一次料、按位置算多次（10/16 提速）：事账要算每条"要求"那会儿的场面表，以前一条一次全量重读（785 条的局一轮 39 秒）。
// at(anchor)／atPos(pos) 按截到的位置算，同一位置只算一次；料和 boardFor 一样
export function boardLoader(store, records, chatKey, { present = null, recentUser = null, timeline = null } = {}) {
    const chat = store.requireChat(chatKey);
    const all = store.currentMessages(chatKey);
    let anchors = null, arrived = null, arrivals = [], knocks = [], came = [], departures = [];
    try { anchors = chat.anchors ? JSON.parse(chat.anchors) : null; } catch {}
    try { arrived = JSON.parse(store.getMeta?.(`arrived:${chatKey}`) ?? 'null'); } catch {}
    try { arrivals = JSON.parse((store.getRawMeta ?? store.getMeta)?.(`arrivals:${chatKey}`) ?? '[]') ?? []; } catch {}
    try { knocks = JSON.parse(store.getMeta?.(`knocks:${chatKey}`) ?? '[]') ?? []; } catch {}
    try { came = JSON.parse(store.getMeta?.(`auto_came:${chatKey}`) ?? '[]') ?? []; } catch {}
    try { departures = JSON.parse(store.getMeta?.(`auto_leave_events:${chatKey}`) ?? '[]') ?? []; } catch {}
    const awayPlans = awayPlansOf(store, chatKey, { messages: all });
    const visible = records?.visible?.(chatKey) ?? records ?? [];
    const homes = lifeSheet(visible).homes;
    const stateNotes = store.stateNotesOf?.(chatKey) ?? [];
    const roster = store.getCast?.(chat.story_id) ?? [];
    const solo = soloMember(chat, roster);
    let identityChoices={};try{identityChoices=JSON.parse(store.getMeta?.(`card_choices:${chatKey}`)??'{}');}catch{}
    const sourceCurrent=e=>factCurrent(e,{messages:all,roster,identityChoices});
    const done = new Map();
    const liveByEntry = new WeakMap();
    const knockLive = e => {
        if (!e || typeof e !== 'object') return store.knockLive?.(chatKey, e);
        if (!liveByEntry.has(e)) liveByEntry.set(e, store.knockLive?.(chatKey, e));
        return liveByEntry.get(e);
    };
    const at = (anchor = null) => {
        const messages = uptoAnchor(all, anchor);
        const key = `${messages.length}|${messages.at(-1)?.fp ?? ''}`;
        if (done.has(key)) return done.get(key);
        const value = boardAt({ messages, marks: messageMarks(messages), stateNotes, anchors, roster, solo, identityChoices, group: !!chat.group_id, arrived, arrivals, knocks, knockLive, came, departures, sourceCurrent, awayPlans, sourceLive: source => store.basisLive?.(chatKey, source.pos, source.day) !== false, recentUser, timeline: timeline ?? {}, homes });
        done.set(key, value);
        return value;
    };
    const atPos = pos => { const row = all.find(m => m.pos === pos) ?? all[pos - 1]; return at(row ? `${pos + 1}:${row.fp}` : null); };
    return { at, atPos, messages: all };
}

export function boardFor(store, records, chatKey, { anchor = null, present = null, recentUser = null, timeline = null } = {}) {
    const chat = store.requireChat(chatKey);
    const all = store.currentMessages(chatKey);
    const messages = uptoAnchor(all, anchor);
    const presentList = present ?? [];
    const marks = messages.map(message => message.boardMark);
    // 消息序列（删改稿、左滑换版都变）和时间进版本，但只放一个哈希，键别有几千字
    const seqHash = createHash('sha1').update(messages.map(m => `${m.pos}:${m.fp}:${!!m.hidden}`).join('|')).digest('hex').slice(0, 16);
    const allSeqHash = createHash('sha1').update(all.map(m => `${m.pos}:${m.fp}:${!!m.hidden}`).join('|')).digest('hex').slice(0, 16);
    const allMarks = all.map(message => message.boardMark);
    const rowsHash = createHash('sha1').update((timeline?.rows ?? []).map(r => `${r.pos}:${r.day}:${r.part ?? ''}`).join('|')).digest('hex').slice(0, 16);
    const key = `${chatKey}|${seqHash}|${timeline?.timeView ?? 'firm'}:${timeline?.today ?? ''}:${timeline?.part ?? ''}:${rowsHash}|${anchor ?? ''}|${cacheVersion(store, chat, chatKey, presentList, recentUser, marks)}`;
    if (cache.has(key)) {
        const value = cache.get(key);
        cache.delete(key);
        cache.set(key, value);
        return value;
    }
    const loaderKey = `${chatKey}|${allSeqHash}|${timeline?.timeView ?? 'firm'}:${timeline?.today ?? ''}:${timeline?.part ?? ''}:${rowsHash}|${cacheVersion(store, chat, chatKey, presentList, recentUser, allMarks)}`;
    let loader = loaderCache.get(loaderKey);
    if (loader) loaderCache.delete(loaderKey);
    else loader = boardLoader(store, records, chatKey, { present: presentList, recentUser, timeline });
    loaderCache.set(loaderKey, loader);
    while (loaderCache.size > 8) loaderCache.delete(loaderCache.keys().next().value);
    const value = { ...loader.at(anchor), sourceVersion: sourceVersion(store, chatKey, messages.at(-1)?.pos ?? -1) };
    cache.set(key, value);
    while (cache.size > 32) cache.delete(cache.keys().next().value);
    return value;
}

// 来源版本只覆盖判断实际读过的前缀；后来的新段不会使较早的事件失效。
export function sourceVersion(store, chatKey, through = null) {
    const chat = store.requireChat(chatKey);
    return versionOf({messages:store.currentMessages(chatKey),roster:store.getCast?.(chat.story_id)??[],correctionRev:store.getMeta?.(`correction_rev:${chat.story_id}`)??'',identityChoices:store.getMeta?.(`card_choices:${chatKey}`)??''},through);
}
function versionOf({messages,roster,correctionRev,identityChoices},through) {
    const rows=messages.filter(m=>through==null||m.pos<=through);
    return createHash('sha256').update(JSON.stringify({
        rows: rows.map(m => [m.pos, m.fp, !!m.hidden, m.boardMark ?? null]),
        cast:roster.map(p=>[p.avatar,p.name,p.role]),correctionRev,identityChoices,
    })).digest('hex');
}

// 已确认事实只依赖自己的身份和相关裁决；全局修订仅用于缓存和待回包。
export function factBasis(item, { messages, roster, identityChoices = {} }) {
    const chosen = !item.avatar && identityChoices[item.who ?? item.name];
    const person = resolveIdentity(roster, chosen ? { avatar: chosen } : item).person;
    const through = item.through ?? item.checkedAt ?? item.at;
    const marks = messages.filter(m => !m.hidden && m.pos <= through).flatMap(m => {
        let people; try { people = (typeof m.boardMark === 'string' ? JSON.parse(m.boardMark) : m.boardMark)?.people; } catch { return []; }
        if (!people) return [];
        const value = person && personMarkValue({ people }, person, roster, identityChoices);
        return value == null ? [] : [[m.pos, m.fp, value]];
    });
    return { identity: person ? [person.avatar, person.name] : null, choice: chosen || null, marks };
}
export function factCurrent(item, input) {
    const now = factBasis(item, input);
    if (!now.identity) return false;
    if (item.factBasis) return JSON.stringify({ ...item.factBasis, choice: item.avatar ? null : item.factBasis.choice }) === JSON.stringify(now);
    return !now.marks.some(([pos]) => pos >= item.at);
}
export function factInput(store, chatKey) {
    const chat = store.requireChat(chatKey);
    let identityChoices = {}; try { identityChoices = JSON.parse(store.getMeta?.(`card_choices:${chatKey}`) ?? '{}'); } catch {}
    return { messages: store.currentMessages(chatKey), roster: store.getCast?.(chat.story_id) ?? [], identityChoices };
}

// 闭段是投影，只有仍有效的离场事件或明确人工裁决才是离场来源。
export function departureSource(store, chatKey, avatar, end) {
    const input=factInput(store,chatKey),person=input.roster.find(p=>p.avatar===avatar);
    if(!person)return null;
    const live=input.messages.filter(m=>!m.hidden);
    let events=[];try{events=JSON.parse(store.getMeta?.(`auto_leave_events:${chatKey}`)??'[]')??[];}catch{}
    const event=events.findLast(e=>e.avatar===avatar&&e.action!=='undo'&&e.at===end-1
        &&live.some(m=>m.pos===e.at&&m.fp===e.fp)&&factCurrent(e,input)
        &&(e.throughFp==null||live.some(m=>m.pos===e.through&&m.fp===e.throughFp))
        &&(!e.basis||e.basis.every(b=>live.some(m=>m.pos===b.pos&&m.fp===b.fp))));
    if(event)return {at:event.at,fp:event.fp,how:event.how??'自动离场',manual:false};
    const marked=live.find(m=>m.pos===end);
    if(marked){
        let mark;try{mark=typeof marked.boardMark==='string'?JSON.parse(marked.boardMark):marked.boardMark;}catch{}
        const value=mark&&typeof mark==='object'?personMarkValue(mark,person,input.roster,input.identityChoices):null;
        if(['不在','外头'].includes(typeof value==='object'?value?.status:value))
            return {at:marked.pos,fp:marked.fp,how:'人工纠正',manual:true};
    }
    let plans={};try{plans=JSON.parse(store.getMeta?.(`away_plan:${chatKey}`)??'{}')??{};}catch{}
    const plan=Object.values(plans).find(p=>p?.avatar===avatar&&p.manual===true&&!p.seed);
    const source=plan?.manualAt??(plan?{pos:Number(plan.at)-1,fp:plan.fp}:null);
    return source&&source.pos===end-1&&live.some(m=>m.pos===source.pos&&m.fp===source.fp)
        ?{at:source.pos,fp:source.fp,how:'人工离场',manual:true}:null;
}
