// 场面表的唯一读口：先看隔离区间，再看进场记录、去向、离场记录和传入名单。
// 镜头由“此地”状态与叙述中的移动合并；时间完全采用调用方传入的 timeline。
// 来源先后：在场区间 > 指纹有效的消息/电话进场 > 去向 > 隔离区间离场 > present 名单 > never。
// 镜头按此地与快路的位置比较，住处、时间和呼叫分别取 homes、timeline 和 arrival.callsFor。
import { createHash } from 'node:crypto';
import { hasCard, validAwayPlan, lastLeave, awayStage, callsFor, isRemote, metInPerson } from './arrival.mjs';
import { narrationOf, dateOf, calendarOf, weatherOn, PARTS } from './timeline.mjs';
import { lifeSheet } from './life.mjs';
import { awayPlansOf } from './opening.mjs';
import { arrivalLive, emptySegment } from './landing.mjs';
import { foldState } from './state.mjs';

const CAMERA_NAME = '旁白';   // 镜头那张卡的名字（slot.mjs 也是这个）
const MOVE_WORDS = '走进|走到|进了|进入|来到|到了|回到|下楼到|下楼找到|上楼到|推门进|拐进|踏进|钻进|跟着[^，。；！？,;!?]{0,12}进了';
const PLACE_RE = new RegExp(`(?:${MOVE_WORDS})\\s*([^，。；！？,;!?\\s]{2,12}?)(?=[，。；！？,;!?]|里|内|门口|外|$)`, 'g');
const GENERIC_PLACES = new Set(['家里', '这里', '那里', '外头', '楼下', '楼上', '门口', '屋里', '里面', '外面', '这边', '那边', '前面', '后面', '窗边', '床边', '门外', '屋外']);
// 往哪儿去（试玩 10/7："从地下室出来，往主街走去"——镜头一直留在地下室那间屋里）：去的那个地方算镜头所在
const HEAD_RE = /(?:往|朝)\s*([^，。；！？,;!?\s（）()]{2,10}?)\s*(?:走去|走|去|赶|跑|那边去|方向)/g;
const TIME_RE = /凌晨|早上|上午|中午|下午|傍晚|晚上|深夜/g;

const values = value => Array.isArray(value) ? value : Object.values(value ?? {});
const number = value => Number.isFinite(Number(value)) ? Number(value) : null;
const rosterEntry = entry => typeof entry === 'string' ? { name: entry } : entry;

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

function planFor(plans, person) {
    return values(plans).find(plan => plan && (plan.who === person.name || plan.avatar === person.avatar)) ?? null;
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
    }).filter(mark => mark && mark.pos <= pos);
    const latestPlaceMark = marks.filter(mark => typeof mark.place === 'string' && mark.place.trim()).at(-1) ?? null;
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
    const state = notes.at(-1) ?? null;
    const candidates = messages.slice(-2).map(message => ({ ...movement(message.text), pos: number(message.pos) ?? pos })).filter(item => item.place);
    const recent = input.recentUser?.text ?? input.recentUser;
    if (recent) {
        const found = movement(recent);
        if (found) candidates.push({ ...found, pos: pos + 1 });
    }
    const fast = candidates.at(-1) ?? { place: null, pos: null, time: null };
    const useState = state && (!fast.place || (number(state.pos) ?? 0) >= (number(fast.pos) ?? 0));
    // 三路按位置比，后来的赢；同一条上都有时：用户的纠正 > 此地（模型读过原文认的）> 快路（程序正则认的）
    const rank = { mark: 2, state: 1, fast: 0 };
    const cameraCandidates = [
        latestPlaceMark ? { place: latestPlaceMark.place, pos: latestPlaceMark.pos, from: 'mark' } : null,
        useState ? { place: state.text, pos: number(state.pos) ?? 0, from: 'state' } : null,
        fast.place ? { place: fast.place, pos: candidates.at(-1)?.pos ?? pos, from: 'fast' } : null,
    ].filter(Boolean).sort((a, b) => ((a.pos ?? 0) - (b.pos ?? 0)) || (rank[a.from] - rank[b.from]));
    const camera = cameraCandidates.at(-1) ?? { place: null, pos: null, from: null };
    const cameraPlace = camera.place;
    const cameraFrom = camera.from;
    const fallbackRow = { day: today, part };
    const present = new Set(input.present ?? []);
    // 镜头那张卡（旁白）不是人，不进场面表（和 slot.mjs 的 CAMERA_NAME 一样）
    const roster = (input.roster ?? []).map(rosterEntry).filter(person => person?.name && person.name !== CAMERA_NAME);
    // 进场被删掉了（那次进场挂的那条消息没了、换了），隔离扩展的区间却还开着（试玩 10/7：删回去重来，旁白一回话正好落在他当初进场那条的位置上，
    // 他就"在场"了，门上那一行跟着没了）：区间起点对应的进场全作废了就不算；之后又有还算数的进场，从那次算起。没有进场记录的区间照旧
    const entries = values(input.arrivals);
    // 叩门作废了的（他发来消息、到了门口，玩家没理，knock.mjs）：那次进场不算——他没进过场，开的区间也不算在场（方案 自动进离场与调度）
    const lapsedKnocks = new Set(values(input.knocks).filter(k => k?.lapsed && k.who).map(k => `${k.who}|${number(k.at)}`));
    // 进场挂在他进场后那条回复上（landing.arrivalLive）：他那条删了、后面换成了别人在说，这次进场就不算
    const liveEntry = e => !(e?.knock && lapsedKnocks.has(`${e.who}|${number(e.at)}`)) && arrivalLive(e, messages, entries, input.anchors);
    const liveSegment = (segment, person) => {
        if (!segment) return null;
        const mine = entries.filter(e => e && (e.avatar === person.avatar || e.who === person.name));
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
        const mineIn = entries.filter(e => e && (e.avatar === avatar || e.who === person.name) && Number(e.at) <= pos + 1 && liveEntry(e)).sort((a, b) => Number(a.at) - Number(b.at)).at(-1) ?? null;
        const meta = input.arrived && (input.arrived.who === person.name || input.arrived.avatar === avatar) ? input.arrived : null;
        const arrived = meta && (!mineIn || (Number(meta.at) === Number(mineIn.at) && meta.fp === mineIn.fp)) ? meta : mineIn?.how ? { ...mineIn, who: mineIn.who ?? person.name } : null;
        // 开局单里开场不在场的那份去向（opening.mjs）：名单里有他（人就在这儿）就不算
        const planned = planFor(input.awayPlans, person);
        const plan = planned?.seed && present.has(person.name) ? null : validAwayPlan(planned, messages);
        const leave = lastLeave(own, avatar, pos + 1);
        const inGroup = present.size ? present.has(person.name) : !!segment;
        const remote = validRemote(arrived, messages, inGroup, input.stateNotes ?? [], roster.map(p => p.name));
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
        } else if (plan || leave != null) {
            status = 'away';
            since = leave ?? plan?.at ?? null;
            place = (leave != null ? ownSpot(person.name, leave) : null) ?? plan?.where ?? null;
        } else if (present.has(person.name)) {
            status = 'present';
            place = cameraPlace;
        }
        const departure = number(since);
        const stage = status === 'away'
            ? awayStage(plan, rowAt(timeline, departure ?? pos, fallbackRow), fallbackRow, departure == null ? 0 : Math.max(0, pos - departure + 1), timeline?.parts ?? PARTS)
            : null;
        const personMark = marks.filter(mark => mark.people && Object.prototype.hasOwnProperty.call(mark.people, person.name)).at(-1);
        if (personMark && (since == null || personMark.pos >= departure)) {
            const marked = personMark.people[person.name];
            const statusMap = { '在场': 'present', '远程': 'remote', '外头': 'away', '不在': 'absent' };
            if (statusMap[marked]) { status = statusMap[marked]; since = personMark.pos; way = status === 'remote' ? '消息' : null; place = status === 'present' ? cameraPlace : null; }
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
        };
    });

    const called = [];
    for (const source of [...messages.slice(-2).map(message => narrationOf(message.text)), narrationOf(recent)]) {
        if (!source) continue;
        for (const person of roster) {
            const way = callsFor(source, [person.name]);
            if (way && !called.some(c => c.who === person.name)) called.push({ who: person.name, way });
        }
    }
    return {
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

function cacheVersion(store, chat, chatKey, present, recentUser, marks) {
    const notes = store.stateNotesOf?.(chatKey) ?? [];
    const arrived = store.getMeta?.(`arrived:${chatKey}`) ?? '';
    const plans = store.getMeta?.(`away_plan:${chatKey}`) ?? '';
    return JSON.stringify({
        notes: [notes.length, notes.at(-1)?.id ?? null],
        anchors: String(chat.anchors ?? '').length,
        arrived,
        arrivals: store.getMeta?.(`arrivals:${chatKey}`) ?? '',
        knocks: store.getMeta?.(`knocks:${chatKey}`) ?? '',
        plans,
        setup: store.setupOf?.(chat.story_id)?.id ?? null,
        present: [...(present ?? [])],
        recentUser: recentUser ?? '',
        // 纠正是存在各条上的 JSON 文本：哪几条有、写了什么，都进版本（试玩 10/7：只数条数，改了纠正还拿到旧表）
        marks: (marks ?? []).map((m, i) => (m ? `${i}:${m}` : '')).filter(Boolean).join('|'),
    });
}

const cache = new Map();

/**
 * 从 store 读取场面表输入，按锚点截断并做至多 32 项的 LRU 缓存。
 * 输入为 store、records、chatKey 和可选筛选项，输出与 boardAt 相同。
 */
// 装一次料、按位置算多次（10/16 提速）：事账要算每条"要求"那会儿的场面表，以前一条一次全量重读（785 条的局一轮 39 秒）。
// at(anchor)／atPos(pos) 按截到的位置算，同一位置只算一次；料和 boardFor 一样
export function boardLoader(store, records, chatKey, { present = null, recentUser = null, timeline = null } = {}) {
    const chat = store.requireChat(chatKey);
    const all = store.currentMessages(chatKey);
    let anchors = null, arrived = null, arrivals = [], knocks = [];
    try { anchors = chat.anchors ? JSON.parse(chat.anchors) : null; } catch {}
    try { arrived = JSON.parse(store.getMeta?.(`arrived:${chatKey}`) ?? 'null'); } catch {}
    try { arrivals = JSON.parse(store.getMeta?.(`arrivals:${chatKey}`) ?? '[]') ?? []; } catch {}
    try { knocks = JSON.parse(store.getMeta?.(`knocks:${chatKey}`) ?? '[]') ?? []; } catch {}
    const awayPlans = awayPlansOf(store, chatKey, { messages: all });
    const visible = records?.visible?.(chatKey) ?? records ?? [];
    const homes = lifeSheet(visible).homes;
    const stateNotes = store.stateNotesOf?.(chatKey) ?? [];
    const roster = store.getCast?.(chat.story_id) ?? [];
    const done = new Map();
    const at = (anchor = null) => {
        const messages = uptoAnchor(all, anchor);
        const key = `${messages.length}|${messages.at(-1)?.fp ?? ''}`;
        if (done.has(key)) return done.get(key);
        const value = boardAt({ messages, marks: messages.map(m => m.boardMark), stateNotes, anchors, roster, arrived, arrivals, knocks, awayPlans, present: present ?? [], recentUser, timeline: timeline ?? {}, homes });
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
    const seqHash = createHash('sha1').update(messages.map(m => `${m.pos}:${m.fp}`).join('|')).digest('hex').slice(0, 16);
    const key = `${chatKey}|${seqHash}|${timeline?.today ?? ''}:${timeline?.part ?? ''}|${anchor ?? ''}|${cacheVersion(store, chat, chatKey, presentList, recentUser, marks)}`;
    if (cache.has(key)) {
        const value = cache.get(key);
        cache.delete(key);
        cache.set(key, value);
        return value;
    }
    const value = boardLoader(store, records, chatKey, { present: presentList, recentUser, timeline }).at(anchor);
    cache.set(key, value);
    while (cache.size > 32) cache.delete(cache.keys().next().value);
    return value;
}
