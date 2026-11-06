// 停住时给玩家一张「接下来」路标卡（T074，用户 11/1："并没有特别想玩下去的动力……给玩家一点方向，不是角色上门的选项，而是剧情点的"）。
// 纯程序，不调模型，题材无关（D-37）。两件事：
//   一、停住了没有（stuckAt）：玩家连着 quiet 条消息之间没有"新事"，或者自上次换地方以来已经发了 scene 条——自动弹一次；
//       亲密、紧张、交心的场面（需要连续和沉浸）不自动弹，计数照走，场面过去了再弹；同一次停住只自动弹一次。
//   二、卡上有什么（signposts / skipLine）：到现场的、到点了的、前置了结的、谁去是玩家或眼下在一起的人的件，一件一行给玩家看；
//       不给知情、来由、应答、题（剧透、幕后标签）；再加"跳到下一件事"（只在天尺度、有往后排着的事时）。
// "新事"＝口袋件拿出来或用上了、有人叩门或进场、换了地方（叙述里写着走进、来到……）、新规划落账。
// 记号都挂在消息上（pos＋fp）：那条消息删了、改了，记号就不算（照 scene.stillThere 的规矩）。
import { entryOf, afterBlocked, entryProjection, nearPlace as exactPlace } from './planner.mjs';
import { leadReady, focusLine } from './eventlead.mjs';
import { stillThere, movedTo } from './scene.mjs';
import { occasionOf, heartToHeart, closeCountsByMessage, tenseStrongCount } from './occasion.mjs';
import { narrationOf } from './timeline.mjs';
import { scaleOf, DAY } from './timescale.mjs';
import { sameName } from './setup.mjs';

// 数值：默认、范围集中放这里（config.mjs 读、tuning.mjs 列；没填、乱填按默认）
export const GUIDE = Object.freeze({
    quiet: { default: 4, min: 1, max: 20 },    // 玩家连着几条消息没有新事就算停住
    scene: { default: 8, min: 2, max: 40 },    // 自上次换地方以来玩家发了几条就算停住
    max: { default: 3, min: 1, max: 5 },       // 卡上路标至多几条（另有"跳到下一件事""自己写"两条固定项）
    stall: { default: 2, min: 2, max: 10 },    // 没新事的条数到 quiet 的几倍：后台补货；被沉浸挡着时弹一张只有"跳到下一件事"的轻卡（T077）
});
export const guideKnob = (v, k) => { const r = GUIDE[k], n = Number(v); return v != null && v !== '' && Number.isInteger(n) && n >= r.min && n <= r.max ? n : r.default; };
export const guideConfig = raw => ({ enabled: raw?.enabled !== false, quiet: guideKnob(raw?.quiet, 'quiet'), scene: guideKnob(raw?.scene, 'scene'), max: guideKnob(raw?.max, 'max'), stall: guideKnob(raw?.stall, 'stall') });

const LIVE = new Set(['waiting', 'pocket']);
const tidy = t => String(t ?? '').trim();
const read = (store, key, fallback) => { try { return JSON.parse(store.getMeta?.(key) ?? 'null') ?? fallback; } catch { return fallback; } };
export const SHOWN_KEY = chatKey => `guide_shown:${chatKey}`;
export const PICKS_KEY = chatKey => `guide_picks:${chatKey}`;
export const REFILL_KEY = planId => `guide_refill:${planId}`;

// ── 新事 ──────────────────────────────────────────────
// events：[{ pos, fp, kind }]，调用方按当前消息核过的（见 eventsOf）。返回最近一件新事的位置（没有就 -1）。
const lastPosOf = (events, kinds = null) => events.filter(e => !kinds || kinds.includes(e.kind)).reduce((n, e) => Math.max(n, e.pos), -1);

// 这几个来源各自挂在哪条消息上；挂的那条不在当前消息里（删回去了、改了）就不算
export function eventsOf({ messages = [], menu = [], arrivals = [], plans = [], same = null }) {
    const at = (pos, fp, kind) => (stillThere({ pos, fp: fp ?? null }, messages, same) ? [{ pos: Number(pos), fp: fp ?? null, kind }] : []);
    const out = [];
    for (const m of menu) if (['shown', 'used'].includes(m.status) && Number.isFinite(m.settled_pos)) out.push(...at(m.settled_pos, null, '拿出来'));
    for (const a of arrivals) if (a && Number.isFinite(Number(a.at))) out.push(...at(a.at, a.fp, a.knock ? '叩门' : '进场'));
    for (const p of plans) if (Number.isFinite(p.anchor_pos)) out.push(...at(p.anchor_pos, p.anchor_fp, '新规划'));
    for (const m of messages) if (movedTo(narrationOf(m.text))) out.push({ pos: m.pos, fp: m.fp ?? null, kind: '换处' });
    return out;
}

// 停住了没有。messages：当前消息；events：eventsOf 的结果；shown：上次自动弹的记号 { pos, fp } | null
export function stuckAt({ messages = [], events = [], shown = null, quiet = GUIDE.quiet.default, scene = GUIDE.scene.default, same = null } = {}) {
    const users = messages.filter(m => m.is_user);
    const lastNew = lastPosOf(events), lastMove = lastPosOf(events, ['换处']);
    const quietCount = users.filter(m => m.pos > lastNew).length, sceneCount = users.filter(m => m.pos > lastMove).length;
    const stuck = quietCount >= quiet || sceneCount >= scene;
    // 弹过以后，要等下一件新事发生才再算：上次弹的那条还在，且之后没有新事
    const already = !!shown && stillThere(shown, messages, same) && shown.pos >= lastNew;
    return { stuck, quietCount, sceneCount, lastNew, lastMove, already };
}

// 沉浸的场面：亲密、紧张、交心。不自动弹，手动按钮不看这条
// 路标卡的亲密口径比叩门严（回放里"腰包""指尖敲桌"这类日常描写凑够 3 个弱信号就被认成亲密）：
// 强信号 ≥1，或弱信号 ≥3 且散在至少 CLOSE_SOFT_MSGS 条不同消息里。不改 occasionOf（叩门在用）。
export const CLOSE_SOFT_MSGS = 2;
export function closeStrict(messages = []) {
    const rows = closeCountsByMessage(messages);
    const strong = rows.reduce((n, r) => n + r.strong, 0), soft = rows.reduce((n, r) => n + r.soft, 0);
    return strong >= 1 || (soft >= 3 && rows.filter(r => r.soft > 0).length >= CLOSE_SOFT_MSGS);
}
// 紧张同理：路标卡让路是为了不打断真打起来的戏，那几乎必有强信号；弱信号凑数（日常的撞、退后、拔出）不算。叩门不变。
export const tenseStrict = (messages = []) => tenseStrongCount(messages) >= 1;
export function immersive(messages) {
    const occ = occasionOf(messages);
    if (occ === '紧张' && !tenseStrict(messages)) return heartToHeart(messages) ? '交心' : null;
    if (occ === '亲密' && !closeStrict(messages)) return heartToHeart(messages) ? '交心' : null;
    return occ ?? (heartToHeart(messages) ? '交心' : null);
}

// ── 卡上有什么 ─────────────────────────────────────────
// 认人：同 eventlead.herName 的写法（"玩家""主角"开头，或和玩家的名字对得上）
const herName = (n, players = []) => { const s = tidy(n); return !!s && (/^(?:玩家|主角)/.test(s) || players.some(p => p && sameName(s, p))); };
const placeText = m => { const p = tidy(m?.place); return p.match(/「([^」]{2,})」/)?.[1] ?? p; };
const rank = (m, node) => (m.purpose === '主线' ? 0 : focusLine(m, node) ? 1 : 2);
// 谁去可能写了好几个人（"甲、乙"）：拆开，有一个是玩家或在场的人就算
const goes = (m, { players, present, names }) => {
    const parts = tidy(m.goer).split(/[、,，和与及]/).map(tidy).filter(Boolean);
    return !parts.length || parts.some(g => herName(g, players) || present.some(n => sameName(n, g, names)));
};

// 路标一行：规划新写的「路标」格；旧件没有就用模板。里面必须有"在哪"的字（玩家发出去以后，slot 的到现场递送靠它认出他去了）。
// 括号包着由这里加。不碰知情、来由、应答、题。
export const SIGN_TEMPLATE = place => `去${place}看看`;
export function signLine(m, { nearPlace = null, names = [] } = {}) {
    const line = tidy(m.signpost ?? m.sign_post);
    return line && exactPlace(m, line) ? line : '';
}

// menu：menuDays 套过日子的菜单；today：今天是第几天
export function signposts({ menu = [], today, node = null, players = [], present = [], names = [], visible = [], max = GUIDE.max.default, nearPlace = null, render = t => t } = {}) {
    if (!Number.isFinite(today)) return [];
    const picked = [], seen = new Set();
    const ok = menu.filter(m => LIVE.has(m.status) && entryOf(m) === '到现场' && placeText(m)
        && !(Number.isFinite(m.ready_day) && today < m.ready_day) && !afterBlocked(m, menu) && goes(m, { players, present, names }))
        .sort((a, b) => rank(a, node) - rank(b, node) || a.id - b.id);
    for (const m of ok) {
        const key = placeText(m);
        if (seen.has(key)) continue;   // 同一个地方只出一条
        const known = players.map(viewer => entryProjection(m, { viewer, visible, same: (a, b) => sameName(a, b, names), player: true, menu })).find(Boolean);
        if (!known || known.mode !== 'records' || !exactPlace(m, known.text)) continue;
        seen.add(key);
        const reason = (known.parts ?? [{ text: known.text, day: m.said_day }]).map(p => render(p.text, m, p, today)).join('；');
        const text = reason;
        picked.push({ id: m.id, kind: 'sign', place: key, text, fill: `（${text}）` });
        if (picked.length >= max) break;
    }
    return picked;
}

// 「跳到下一件事」：往后排着的事（ready_day > 今天）里最近的一件，填一句 recall.timeSkipIn 认得的时间交代，不写那天会发生什么。
// 只在时间尺度是"天"时出，别的尺度先不出。
const CN = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
export function skipText(days) {
    const n = Math.floor(days);
    if (!(n >= 1)) return null;
    return n === 1 ? '（第二天，……）' : `（过了${n === 2 ? '两' : CN[n] || n}天，……）`;
}
export function skipLine({ menu = [], today, timeScale = DAY } = {}) {
    if (!Number.isFinite(today) || scaleOf(timeScale).unit !== '天') return null;
    const ahead = menu.filter(m => LIVE.has(m.status) && Number.isFinite(m.ready_day) && m.ready_day > today).map(m => m.ready_day);
    if (!ahead.length) return null;
    const days = Math.min(...ahead) - today, fill = skipText(days);
    return fill ? { kind: 'skip', days, text: fill.slice(1, -1), fill } : null;
}

// 一次判定（纯）：input 同上；auto＝是自动弹的那次问（手动按钮不看停住、不看场面）
export function guideAt(input = {}) {
    const cfg = guideConfig(input.cfg), messages = input.messages ?? [];
    const st = stuckAt({ messages, events: input.events ?? [], shown: input.shown ?? null, quiet: cfg.quiet, scene: cfg.scene, same: input.same });
    const items = signposts({ menu: input.menu, today: input.today, node: input.node, players: input.players, present: input.present, names: input.names, visible: input.visible, max: cfg.max, nearPlace: input.nearPlace, render: input.render });
    const skip = skipLine({ menu: input.menu, today: input.today, timeScale: input.timeScale });
    const scene = immersive(messages);
    const hasChoice = items.length > 0 || !!skip;
    // 停得够久（没新事的条数到 quiet 的 stall 倍，T077）：后台补货（不看沉浸、不看弹过没有）；被沉浸挡着时弹轻卡（只有 skip，没有 skip 不弹）
    const long = cfg.enabled && st.quietCount >= cfg.quiet * cfg.stall;
    const light = long && st.stuck && !st.already && !!scene && !!skip;
    return { enabled: cfg.enabled, ...st, scene, items, skip, empty: !hasChoice, long, light,
        show: (cfg.enabled && st.stuck && !st.already && !scene && hasChoice) || light,
        // 该弹却除了"自己写"什么都给不出（不看沉浸：补货只是叫一次规划）
        refill: cfg.enabled && st.stuck && !st.already && !hasChoice,
        // 停得够久：往现有规划里补几件（同一份规划至多一次，server 管记号）
        stall: long };
}

// ── 接 store ──────────────────────────────────────────
// slot：{ timelineFor, menuDays, scaleFor }——由 server 传进来（config.mjs 要读这里的数值，这里不能反过来 import slot.mjs，免得循环引用）
export function guideFor(store, records, chatKey, { present = [], config = null, nearPlace = null, slot } = {}) {
    const { timelineFor, menuDays, scaleFor, renderEntry = t => t } = slot;
    const chat = store.requireChat(chatKey);
    const messages = store.currentMessages(chatKey);
    const timeline = timelineFor(store, records, chatKey, messages);
    const menu = menuDays(store, store.menuOf(chatKey), timeline.dayOf ?? null);
    const last = store.lastReadyPlan?.(chatKey) ?? null;
    let node = null; try { node = last?.node ? JSON.parse(last.node) : null; } catch {}
    const userName = [...messages].reverse().find(m => m.is_user)?.name ?? null;
    const players = [userName, ...(store.playerNames?.(chat.story_id) ?? [])].filter(Boolean);
    const roster = store.getCast?.(chat.story_id) ?? [];
    const names = roster.map(e => e.name);
    const same = (a, b) => store.sameMessage?.(a, b) ?? false;
    const events = eventsOf({ messages, menu, arrivals: read(store, `arrivals:${chatKey}`, []), plans: store.readyPlans?.(chatKey) ?? [], same });
    const visible = (records.visible?.(chatKey) ?? []).filter(r => r.pos <= (messages.at(-1)?.pos ?? -1));
    const render = (text, m, part, today) => renderEntry(text, m, { sourceDay: part.pos != null ? timeline.dayOf(part.pos) : part.day ?? m.said_day, today, timeScale: scaleFor(store, chatKey), roster, messages });
    const out = guideAt({ cfg: config, messages, events, shown: read(store, SHOWN_KEY(chatKey), null), same, menu, today: timeline.today, node, players, present, names, visible, timeScale: scaleFor(store, chatKey), nearPlace, render });
    return { ...out, last, lastMessage: messages.at(-1) ?? null };
}

// 自动弹出来了：记一笔（挂在当时最后一条消息上），同一次停住不再弹
export function markShown(store, chatKey, lastMessage) {
    if (lastMessage) store.setMeta(SHOWN_KEY(chatKey), JSON.stringify({ pos: lastMessage.pos, fp: lastMessage.fp }));
}

// 玩家点了哪条：挂在当前最后一条消息上，删回那条之前就不算（picksOf 核）。只留最近 40 笔
export function recordPick(store, chatKey, { picked, offered = [], kind = 'sign' }, lastMessage) {
    if (!lastMessage) return;
    const list = read(store, PICKS_KEY(chatKey), []);
    list.push({ pos: lastMessage.pos, fp: lastMessage.fp, kind, picked: tidy(picked).slice(0, 80), offered: offered.map(x => tidy(x).slice(0, 80)).filter(Boolean).slice(0, 5) });
    store.setMeta(PICKS_KEY(chatKey), JSON.stringify(list.slice(-40)));
}
export function picksOf(store, chatKey, messages = store.currentMessages(chatKey), limit = 10) {
    return read(store, PICKS_KEY(chatKey), []).filter(p => stillThere(p, messages, (a, b) => store.sameMessage?.(a, b) ?? false)).slice(-limit);
}
