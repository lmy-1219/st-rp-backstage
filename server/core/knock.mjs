// 叩门（方案 自动进离场与调度 第二节第 2、3 条，N-378）：该来的人不再挂成门上那一行按钮，而是自己在聊天里发来一条消息、打来电话、找上门（写到门口止）。
// 之后他是"候着"：玩家回应了 → 进场（远程的进远程区间，门口的进当面区间）；玩家 N 句没回、或者换了时段 → 作废（他没进过场，那条留着，
// 之后走"等着没人接"那条路，再来就是又一次叩门）。
// 挂消息的规矩照 landing.mjs：叩门记录 { who, avatar, way, at, fp, verdicts? }——at 是他那条落下的条号、fp 是前一条（他开口前最后一条）的指纹；
// 前一条没了、他那条换成了别人在说，这次叩门就没发生过（landing.arrivalLive 同一套判法）。
// 这里只有判定（纯程序、不花钱）：respondedTo 回应判定、knockState 状态机、knockTiming 时机、knockSegmentState／knockLapsed 给场面表的钩子
//（作废的叩门开的那段区间不算在场；场面表的读口由主窗接）。记录存哪、何时叩、扩展怎么叫他是主窗 1b、1c 的事。
// 认不出是不是在回他的那几句（asks）交给便宜模型，判了写回记录的 verdicts（"条号:指纹" → true/false），状态机先看它。题材无关。
import { arrivalLive } from './landing.mjs';
import { partsBetween } from './arrival.mjs';
import { PARTS } from './timeline.mjs';
import { callsOf } from './camera-turn.mjs';
import { isBridge, isLull } from './director.mjs';
import { paceName, MID } from './tempo.mjs';
import { normalizeRelations } from './relations.mjs';
import { occasionOf, WHY as OCCASION_WHY } from './occasion.mjs';   // 场合（用户 10/16）：亲密戏、打着的时候不叩门，候着时那几句不算没回

export const STATES = ['候着', '进场', '作废', '没发生'];
export const MAX_TURNS = 2;   // 玩家几句没回算没接（方案第八节建议 2 句）
// 上一次叩门之后隔够几条、一个时段至多几次，按节奏档（可调）
export const GAP = Object.freeze({ 慢: 12, 中: 8, 快: 5 });
export const PER_PART = Object.freeze({ 慢: 1, 中: 2, 快: 2 });

const CAMERA = 'narrator', CAMERA_NAME = '旁白';
const QUOTE = /“[^“”]{1,600}”|「[^「」]{1,600}」|『[^『』]{1,600}』|"[^"\n]{1,600}"/;
const CLAUSE = /[，,。！？!?；;：:\n]/;
const asked = t => /[？?]/.test(String(t ?? ''));
const isNarrator = m => !!m && !m.is_user && (m.speaker === CAMERA || m.name === CAMERA_NAME);
const num = v => (Number.isFinite(Number(v)) ? Number(v) : null);
const norm = s => String(s ?? '').replace(/\s+/g, '').toLowerCase();
const mentions = (t, calls) => calls.some(c => c && String(t ?? '').includes(c));
export const wayOf = w => (/电话|来电|通话/.test(w ?? '') ? '电话' : /消息|短讯|短信/.test(w ?? '') ? '消息' : /门|上门|来找|找上/.test(w ?? '') ? '上门' : null);

// 明说了不理：这一小句点了他、或者说的是那个东西（手机、门），又带这些字眼
const IGNORE = /没理|不理|没搭理|不搭理|无视|懒得|没回(?!头)|不回(?!头)|没接|不接|不开门|没开门|不去开|没去开|不应|没应|装没听见|当没看见|当没听见|没看|不看|关掉|按掉|挂掉|静音|扣下|翻过去|放回|让[他她]等/;
const MEDIUM = /手机|终端|电话|来电|消息|短讯|短信|屏幕|门|敲门|门铃|铃/;
// 回应的动作，按方式分
const ACT = {
    电话: /接起|接通|接听|接了(?:电话|起来|通话)|接电话|按下接听|按了接听|划开接听|点了接听|拿起(?:电话|终端|手机)|回拨|打回去|拨回去|拨了回去|按了接通/,
    消息: /回复|回消息|回短讯|回短信|回信|回过去|回[他她]|回道|回了(?:一?[条句个]|几个字|过去|[他她])|打字|敲了几个字|敲字|发过去|发了(?:一?[条句个]|过去)|点开(?:消息|短讯|短信|终端|手机)|拿起(?:终端|手机)/,
    上门: /开门|开了门|把门打开|拉开门|门打开|门开了|让[^，。！？]{0,4}进来|请进|进来吧|迎[他她]?进|放[他她]进来|去开门|走到门口|走向门|隔着门|应了一声|应了[他她]|问了一?声|谁啊|谁呀|是谁/,
};
const GENERIC = /回应|应声|答道|答了|回了一?声|回话/;

/**
 * 玩家这句算不算回应他。text 玩家这句；who 他的名字；aliases 他的又名；opts：{ way 他怎么来的（电话／消息／上门）, lastSpeaker 上一条是谁说的,
 * others 在场别人的名字（含又名）, userName }。返回 { responded, sure, why }：sure 为 false 的认不出（当场问一次便宜模型是 1b 的事）。
 */
export function respondedTo(text, who, aliases = [], { way = null, lastSpeaker = null, others = [], userName = null } = {}) {
    const s = String(text ?? '');
    if (!s.trim() || !who) return { responded: false, sure: true, why: '空的' };
    const calls = [...new Set([who, ...(aliases ?? [])].filter(Boolean).map(String))];
    const otherCalls = (others ?? []).flat().filter(Boolean).map(String).filter(c => !calls.includes(c) && c !== userName);
    const w = wayOf(way);
    const clauses = s.split(CLAUSE).map(c => c.trim()).filter(Boolean);
    // 1. 明说了不理他：这一小句点了他、或者说的是那个东西（手机、门）
    if (clauses.some(c => IGNORE.test(c) && (mentions(c, calls) || MEDIUM.test(c)))) return { responded: false, sure: true, why: '玩家明说了不理' };
    // 2. 点了他的名
    if (clauses.some(c => mentions(c, calls))) return { responded: true, sure: true, why: '点了他的名' };
    // 3. 接、回、开门、让他进来这类动作，按方式；没说方式的三种都认
    const acts = w ? [ACT[w]] : Object.values(ACT);
    if (clauses.some(c => (acts.some(re => re.test(c)) || GENERIC.test(c)) && !IGNORE.test(c))) return { responded: true, sure: true, why: `有${w ? `接${w}` : '回应'}那类的动作` };
    // 4. 点了别人：这句是对别人说的
    if (mentions(s, otherCalls)) return { responded: false, sure: true, why: '这句是对别人说的' };
    // 5. 他刚说完、玩家没点别人，这句是回话（引号里的话、问句、承接的短句）
    const him = !!lastSpeaker && calls.some(c => norm(c) === norm(lastSpeaker));
    if (him && (QUOTE.test(s) || asked(s) || isBridge(s))) return { responded: true, sure: true, why: '他刚说完，这句接着他' };
    return { responded: false, sure: false, why: him ? '他刚说完，这句只是叙述，认不出是不是在回他' : '认不出是不是在回他' };
}

const isHis = (m, k) => !!m && !m.is_user && (m.name === k.who || (!!k.avatar && m.speaker === k.avatar));
const sameKnocker = (a, b) => !!a && !!b && ((!!a.who && a.who === b.who) || (!!a.avatar && a.avatar === b.avatar));
// 他那条（叩门的那条）：at 之后、他下一次叩门之前，第一条他开口的
function knockMessage(k, messages, mine) {
    const at = num(k?.at);
    if (at == null) return null;
    const next = Math.min(Infinity, ...mine.filter(x => x !== k && num(x.at) > at).map(x => num(x.at)));
    return messages.find(m => m.pos >= at && m.pos < next && isHis(m, k)) ?? null;
}

/**
 * 这次叩门走到哪一步了。knock：{ who, avatar, way, at, fp, verdicts? }；opts：{ messages, knocks（他的所有叩门记录，认他下一次叩门）, userName, roster, relations,
 * rowAt(pos)→{day, part}（给了才认"换了时段"）, parts, maxTurns }
 * 返回 { state: 候着|进场|作废|没发生, why, at（叩门的 at）, message（他那条）, decided（定下进场／作废的那条）, unanswered（玩家没回的句数）, asks（认不出的那几句，给便宜模型）, held（场合不合适、没算的句数） }
 * occasion：false＝不看场合；默认看——玩家那句写在亲密戏、打斗里（occasion.mjs），不算他没回（他候着），换了时段照样作废
 */
export function knockState(knock, { messages = [], knocks = [], userName = null, roster = [], relations = null, rowAt = null, parts = PARTS, maxTurns = MAX_TURNS, occasion = true } = {}) {
    const at = num(knock?.at);
    const base = { at, message: null, decided: null, unanswered: 0, asks: [] };
    if (!knock?.who || at == null) return { ...base, state: '没发生', why: '记录不全' };
    const mine = knocks.filter(k => sameKnocker(k, knock));
    if (!arrivalLive(knock, messages, mine.length ? mine : [knock])) return { ...base, state: '没发生', why: '挂的那条没了，或者他那条换成了别人在说' };
    const msg = knockMessage(knock, messages, mine.length ? mine : [knock]);
    if (!msg) return { ...base, state: '候着', why: '他那条还在写' };
    const message = { pos: msg.pos, fp: msg.fp };
    const names = roster.map(e => (typeof e === 'string' ? e : e?.name)).filter(Boolean);
    const rel = relations ? normalizeRelations(relations) : null;
    const calls = callsOf(knock.who, { rel, names });
    const user = userName ?? messages.find(m => m.is_user && m.name)?.name ?? null;
    const others = names.filter(n => n !== knock.who && n !== CAMERA_NAME && n !== user).flatMap(n => callsOf(n, { rel, names })).filter(c => !calls.includes(c));
    const way = wayOf(knock.way);
    const row0 = rowAt ? rowAt(msg.pos) : null;
    const moved = m => !!rowAt && partsBetween(row0, rowAt(m.pos), parts) >= 1;
    const verdicts = knock.verdicts && typeof knock.verdicts === 'object' ? knock.verdicts : {};
    let lastSpeaker = knock.who, unanswered = 0, held = 0;
    const asks = [];
    const done = (state, why, m) => ({ ...base, state, why, message, decided: { pos: m.pos, fp: m.fp }, unanswered, asks, held });
    const sorted = [...messages].sort((a, b) => a.pos - b.pos);
    const busy = m => occasion !== false && !!occasionOf(sorted.filter(x => x.pos <= m.pos && x.pos > msg.pos), { except: knock.who });
    for (const m of sorted.filter(x => x.pos > msg.pos)) {
        if (m.is_user) {
            const key = `${m.pos}:${m.fp}`;
            const r = Object.prototype.hasOwnProperty.call(verdicts, key)
                ? { responded: !!verdicts[key], sure: true, why: verdicts[key] ? '便宜模型判了是在回他' : '便宜模型判了不是' }
                : respondedTo(m.text, knock.who, calls, { way, lastSpeaker, others, userName: user });
            if (r.responded) return done('进场', r.why, m);
            if (moved(m)) return done('作废', '换了时段', m);
            // 场合不合适（亲密戏、打着）：这句不算他没回，他候着；认不出的也不拿去问
            if (busy(m)) { held++; lastSpeaker = m.name ?? user; continue; }
            if (!r.sure) asks.push({ pos: m.pos, fp: m.fp, text: String(m.text ?? '') });
            unanswered++;
            if (unanswered >= maxTurns) return done('作废', `玩家 ${unanswered} 句没回`, m);
            lastSpeaker = m.name ?? user;
        } else {
            if (moved(m)) return done('作废', '换了时段', m);
            lastSpeaker = m.name ?? lastSpeaker;
        }
    }
    return { ...base, state: '候着', why: unanswered ? `玩家 ${unanswered} 句没回，还候着` : held ? '场合不合适，他候着' : '等玩家回', message, unanswered, asks, held };
}

/**
 * 这会儿能不能叩门（都是程序，不花钱）：一次只一个；上一次叩门隔够几条；一个时段至多几次；
 * 空当——玩家这句只是承接、刚换了时段、旁白刚写完一段；玩家正和在场的人一来一回紧着说，先等。
 * opts：knockState 的那些，再加 pace、present（在场的有卡的人；给了空名单就不用等"一来一回"）、gap、perPart
 */
export function knockTiming({ messages = [], knocks = [], pace = null, present = null, gap = null, perPart = null, occasion = true, ...rest } = {}) {
    const last = messages.at(-1);
    if (!last) return { ok: false, why: '还没有消息' };
    // 场合（occasion.mjs）：正写着亲密戏、正打着——外头的人先别来
    const now = occasion !== false ? occasionOf(messages) : null;
    if (now) return { ok: false, why: `场合不合适：${OCCASION_WHY[now]}` };
    const p = paceName(pace && typeof pace === 'object' ? pace.name : pace) ?? MID;
    const opts = { messages, knocks, ...rest };
    const states = knocks.map(k => ({ k, s: knockState(k, opts) }));
    const waiting = states.find(x => x.s.state === '候着');
    if (waiting) return { ok: false, why: `${waiting.k.who}还候着，一次只一个` };
    const live = states.filter(x => x.s.state !== '没发生');
    const lastAt = Math.max(-Infinity, ...live.map(x => num(x.k.at)).filter(v => v != null));
    const need = gap ?? GAP[p];
    if (Number.isFinite(lastAt) && last.pos - lastAt < need) return { ok: false, why: `上一次叩门才隔了 ${last.pos - lastAt} 条，要隔够 ${need} 条` };
    const rowAt = rest.rowAt ?? null, parts = rest.parts ?? PARTS;
    if (rowAt) {
        const now = rowAt(last.pos);
        const n = live.filter(x => partsBetween(rowAt(num(x.k.at)), now, parts) === 0).length;
        if (n >= (perPart ?? PER_PART[p])) return { ok: false, why: `这个时段已经叩过 ${n} 次门` };
    }
    const prev = messages.at(-2);
    if (rowAt && prev && partsBetween(rowAt(prev.pos), rowAt(last.pos), parts) >= 1) return { ok: true, why: '刚换了时段' };
    if (isNarrator(last)) return { ok: true, why: '旁白刚写完一段' };
    if (Array.isArray(present) && !present.length) return { ok: true, why: '身边没有有卡的人' };
    if (last.is_user && isLull(last.text)) return { ok: true, why: '玩家这句只是承接、一个小动作' };
    if (last.is_user) return { ok: false, why: '玩家正和在场的人说着话，先等' };
    return { ok: false, why: `${last.name ?? '某人'}刚答完，玩家还没接，先等` };
}

/**
 * 隔离区间那一段是不是叩门开的、开它的叩门走到了哪一步：null（不是叩门开的）| 候着 | 进场 | 作废 | 没发生。
 * segment：{ from, to }；opts：{ who, avatar, knocks, ...knockState 的 }。同一个起点上记了几次叩门（删了重来）：有一次还算数就按那一次
 */
export function knockSegmentState(segment, { who = null, avatar = null, knocks = [], ...rest } = {}) {
    const from = num(segment?.from);
    if (from == null) return null;
    const me = { who, avatar };
    const mine = knocks.filter(k => k && sameKnocker(k, me) && num(k.at) === from);
    if (!mine.length) return null;
    const states = mine.map(k => knockState(k, { knocks, ...rest }).state);
    return states.find(s => s === '进场') ?? states.find(s => s === '候着') ?? states.find(s => s === '作废') ?? '没发生';
}
// 给场面表的钩子：这段区间是一次作废了（或没发生过）的叩门开的 → 不算在场，也不算"刚走"（和作废的进场一样，主窗接进 board.liveSegment）
export function knockLapsed(segment, opts = {}) {
    const s = knockSegmentState(segment, opts);
    return s === '作废' || s === '没发生';
}
