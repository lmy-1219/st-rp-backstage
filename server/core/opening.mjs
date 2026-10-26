import { personWord } from './pronoun.mjs';
// 人物开场状态（用户 10/9："人物开场状态（多条，可自己加行）……关键是每一类都要接到系统里已经有、会跟着剧情变的那部分，不能只是一段静态文字"）。
// 开局单那一格（setup.mjs 的"开场状态"）每行：谁｜哪一类｜是什么｜还有谁知道。各类接到哪儿：
// - 在哪：开场不在场的人记成在外头（场面表读的去向，seedPlans）——镜头不替他写进这场，门上不挂他；开场那天知道的人带着这一句（openingLines）。
// - 身体：并进生活现状（life.mjs 的"身体"那一类）：知道的人每次开口都带着，聊天里好了、加重了，记账跟着改。
// - 心事：开场那场戏里心里带着；过了这场戏压在底下、碰到才冒；过两天淡了（openingLines，像 mood.mjs 的余波）。
// - 手头的事：记成他的一条"想法"（惦记着的，正文里有了着落由记账的"了结"关上）；开场不在场的，还写进去向的"去办"，时间结算替他推进。
// - 约定：记成一条说好的（promises.mjs：到日子给当事人，过了没办有说法）。
// - 欠账：记成一条"欠着"（money.mjs：还了才减）。
// - 名声：记成一条名声（situation.repLines：写到那个圈子里的人时照着待他）。
// 记成记录的几类挂在这个窗口的第一条消息上（开场就有）。开局单改了：对不上的作废、新的补上、没变的不动（后来关上它的那条还接得上）。
// 题材无关：人名、地方、事都来自开局单。
import { createHash } from 'node:crypto';
import { amountsIn } from './money.mjs';
import { dueOf } from './promises.mjs';
import { hasCard } from './arrival.mjs';
import { emptySegment } from './landing.mjs';
import { sameName, knowsRow } from './setup.mjs';

export const SEED = 'setup:开场:';
const CAMERA_NAME = '旁白';   // 镜头那张卡（slot.mjs 也是这个）
export const OPEN_SCENE = 24;  // 开场那场戏：头这么多条以内、还在开场那天
const MOOD_DAYS = 2;           // 开场时的心事，过了那场戏还压着几天
const uniq = xs => [...new Set(xs.filter(Boolean))];
const esc = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const rowsOf = data => (data?.开场状态 ?? []).filter(x => x?.谁 && x?.是 && x?.类);
const userOf = messages => [...messages].reverse().find(m => m.is_user)?.name ?? null;

// "是什么"里写到的别的人（名册里的、玩家）：长名字先认，他自己不算
export function namesIn(text, names = [], self = null, same = (a, b) => a === b) {
    const t = String(text ?? '');
    const out = [];
    for (const n of uniq(names).sort((a, b) => b.length - a.length)) {
        if (!t.includes(n) || (self && same(n, self)) || out.some(o => o.includes(n) || same(o, n))) continue;
        out.push(n);
    }
    return out;
}

// 欠账：谁欠谁、多少。写着"对方欠他""借给对方""对方还没还"——对方欠他；"向对方借""从对方那儿借"、别的（欠对方、赊的）——他欠对方。
// 对方：写了"跟谁"照写的；没写认"是什么"里的人；都没有认"欠"后面那个叫法（"欠房东三个月房租"）。
// 数目：写了"多少"照它；没写取"是什么"里最大的那个数（不到十的不算钱数，多半是"三个月"一类）。
export function debtOf(x, { names = [], same = (a, b) => a === b } = {}) {
    const t = String(x?.是 ?? '');
    const other = x?.跟谁?.[0] ?? namesIn(t, names, x?.谁, same)[0]
        ?? /欠(?:了|着)?([^，。；、\s\d零〇一二两三四五六七八九十百千万]{1,8}?)(?:的|一|[\d零〇两三四五六七八九十百千万]|钱|笔|些)/.exec(t)?.[1] ?? null;
    if (!x?.谁 || !other) return null;
    const amounts = [...amountsIn(t)].filter(n => n >= 10);
    const amount = x.多少 ?? (amounts.length ? Math.max(...amounts) : null);
    const o = esc(other);
    const theyOwe = !new RegExp(`(?:从|向|跟|找)${o}[^，。；]{0,6}借`).test(t) && new RegExp(`借给${o}|${o}[^，。；]{0,4}(?:欠|还没还|没还|赖着)`).test(t);
    return theyOwe ? { from: other, to: x.谁, amount } : { from: x.谁, to: other, amount };
}

// 约定：跟谁（写了照写的，没写认"是什么"里的人）；"是什么"里认得出日子就是定了日子（"等会儿"是眼前），"等……以后"是有条件，都没有是没准日子的往后。
// 约在哪天由 promises.promiseOf 按剧情日期再算（开局单写了日期才认得出星期几）。
export function promiseOfRow(x, { names = [], same = (a, b) => a === b } = {}) {
    const t = String(x?.是 ?? '');
    const due = dueOf(t, { saidDay: 0, weekdayOf: () => 1 });
    const kind = due ? (due.soon ? '眼前' : '定了日子') : /等[^，。；]{1,16}(?:以后|之后|了再|再|的时候)|攒够|赚够|凑够|有了钱/.test(t) ? '有条件' : '畅想';
    return { kind, doers: [x.谁], with: x?.跟谁?.length ? x.跟谁 : namesIn(t, names, x.谁, same), when: t };
}

// 名声：哪个圈子（写了照写的；没写认"在……里、那儿、一带"；都没有就是认得他的人，聊到他时给）。认这个圈子的词：圈子名和它的中心词。
export function repOfRow(x) {
    const t = String(x?.是 ?? '');
    const among = String(x?.圈子 ?? '').trim() || /在([^，。；]{2,14}?)(?:里|中间|中|那儿|那边|一带)/.exec(t)?.[1] || '';
    const core = among.replace(/^(?:这一带的?|那一带的?|整个)/, '').replace(/(?:的人|那帮人|那些人|圈子|一带|那边|这边|里头)$/, '');
    const keys = among ? uniq([among, core, core.length >= 3 ? core.slice(-2) : null]).filter(k => k.length >= 2) : [x.谁];
    return { who: x.谁, among: among || `认得${x.谁}的人`, view: t, deal: `照这个名声待${personWord(x.谁)}`, keys };
}

// 开局单 → 要记的那几条（还没落账的样子）。userName：玩家的名字（开局单里写的 {{user}} 换成它）；avatarOf(名字)→他那张卡
export function openingRecords(data, { userName = null, avatarOf = () => null, names = [], same = (a, b) => a === b } = {}) {
    const sub = s => String(s ?? '').replace(/\{\{user\}\}/g, userName ?? '玩家');
    const all = uniq([...names, userName]);
    const out = [];
    for (const raw of rowsOf(data)) {
        const x = { ...raw, 谁: sub(raw.谁), 是: sub(raw.是), 谁知道: (raw.谁知道 ?? []).map(sub), ...(raw.跟谁 ? { 跟谁: raw.跟谁.map(sub) } : {}) };
        const holder = userName && same(x.谁, userName) ? 'user' : avatarOf(x.谁) ?? `name:${x.谁}`;
        const audience = uniq([x.谁, ...(x.谁知道.includes('所有人') ? all : x.谁知道)]);
        const mine = { holder, holderName: x.谁, about: x.谁 };
        let r = null;
        if (x.类 === '手头的事') r = { type: '想法', text: `${x.谁}手头在办：${x.是}（开场时就在办）`, ...mine, audience };
        else if (x.类 === '约定') {
            const p = promiseOfRow(x, { names: all, same });
            r = { type: '说', text: `${x.谁}：${x.是}（开场前就说好的）`, ...mine, about: p.with[0] ?? x.谁, audience: uniq([...audience, ...p.with]), promise: p };
        } else if (x.类 === '欠账') {
            const d = debtOf(x, { names: all, same });
            // 欠的不是钱（人情一类）：记成他心里一直记着的
            if (d && (d.amount || /钱|账|款|租|费|贷/.test(x.是))) r = { type: '钱', text: `${x.谁}：${x.是}（开场时就欠着）`, ...mine, about: same(d.from, x.谁) ? d.to : d.from, audience: uniq([...audience, d.from, d.to]), money: { from: d.from, to: d.to, amount: d.amount, raw: x.是, stage: '欠着' }, lasting: true };
            else r = { type: '心里', text: `${x.谁}：${x.是}（开场时就欠着）`, ...mine, audience: uniq([...audience, d?.from, d?.to]) };
        } else if (x.类 === '名声') {
            const rep = repOfRow(x);
            r = { type: '改变', duration: '直到被改变', text: `${rep.among}那儿都知道：${x.是}`.slice(0, 200), holder: 'world', holderName: '世界', about: x.谁, audience, rep, keys: rep.keys, lasting: true };
        }
        if (!r) continue;
        const sig = createHash('sha1').update(JSON.stringify(r)).digest('hex').slice(0, 12);
        out.push({ ...r, known: [{ key: `${SEED}${sig}`, title: x.是.slice(0, 40) }] });
    }
    return out;
}

const seedKey = r => (r.known ?? []).find(k => String(k?.key ?? '').startsWith(SEED))?.key ?? null;

// 记成记录的那几类落到这个窗口的第一条消息上；开局单（或玩家的名字）没变就不动。同步、确认开局单时都调一次。
export function ensureOpening(store, records, chatKey) {
    if (!records?.addDerived || !records.seedsAt || !records.retire) return { skipped: true };
    const chat = store.requireChat(chatKey);
    const messages = store.currentMessages(chatKey);
    const first = messages[0];
    if (!first) return { skipped: true };
    const setup = store.setupOf?.(chat.story_id) ?? null;
    const userName = userOf(messages);
    const mark = `opening_seeded:${chat.story_id}:${first.fp}`;
    const stamp = `${setup?.id ?? 0}|${userName ?? ''}`;
    if (store.getMeta?.(mark) === stamp) return { skipped: true };
    const cast = store.getCast?.(chat.story_id) ?? [];
    const names = uniq([...cast.map(e => e.name), userName]);
    const same = (a, b) => sameName(a, b, names);
    const want = openingRecords(setup?.data, { userName, names, same, avatarOf: n => cast.find(e => hasCard(e) && same(e.name, n))?.avatar ?? null });
    const wanted = new Set(want.map(seedKey));
    const kept = new Set();
    let added = 0, voided = 0;
    for (const r of records.seedsAt(chat.story_id, first.fp, SEED)) {
        const k = seedKey(r);
        if (!wanted.has(k) || kept.has(k)) { records.retire(r.id, '开局单改了，这条开场状态不再算数'); voided++; } else kept.add(k);
    }
    for (const w of want) if (!kept.has(seedKey(w))) { records.addDerived({ storyId: chat.story_id, fp: first.fp, ...w }); added++; }
    store.setMeta?.(mark, stamp);
    return { added, voided };
}

// "在地点乙值夜班" → "地点乙"：在、去了、到了后面，动作或"里、那儿"前面那一截；认不出就 null
const placeOf = t => /(?:在|去了|到了|回了|待在|呆在|躲在)([^，。；、\s]{2,12}?)(?:值|上班|干活|做事|守|帮|忙|待着|呆着|躲着|住着|养|看|跟|陪|和|等|办|查|找|睡|里|那儿|那边|附近|，|。|；|$)/.exec(String(t ?? ''))?.[1] ?? null;

// 开场不在场的人的去向：在哪那条写的地方；手头的事成了"去办"；回不回来没说（门上不挂他）。只给名册里的人（不给玩家、旁白）。
export function seedPlans(data, { roster = [], first = null, same = (a, b) => a === b, userName = null } = {}) {
    if (!first) return {};
    const out = {};
    for (const e of roster) {
        if (!e?.name || e.name === CAMERA_NAME || (userName && same(e.name, userName))) continue;
        const mine = rowsOf(data).filter(x => same(x.谁, e.name) && (x.类 === '在哪' || x.类 === '手头的事'));
        if (!mine.length) continue;
        const where = mine.find(x => x.类 === '在哪')?.是 ?? '';
        out[e.avatar ?? `name:${e.name}`] = { who: e.name, avatar: e.avatar ?? null, at: first.pos + 1, fp: first.fp, seed: true,
            where: placeOf(where) ?? (where.slice(0, 30) || null), doing: where || null,
            errands: mine.filter(x => x.类 === '手头的事').map(x => ({ text: x.是 })), span: '说不准', back: '没说', backLine: '' };
    }
    return out;
}

// 这个窗口记下的去向，加上开局单里开场不在场的人（他进过场——隔离区间、进场记录里有他——或者已经有记下的去向，就不再算）。
// 场面表、事账、时间结算都从这儿读。
export function awayPlansOf(store, chatKey, { messages = null } = {}) {
    let plans = {};
    try { plans = JSON.parse(store.getMeta?.(`away_plan:${chatKey}`) ?? '{}') ?? {}; } catch {}
    try {
        const chat = store.requireChat(chatKey);
        const data = store.setupOf?.(chat.story_id)?.data;
        const msgs = messages ?? store.currentMessages(chatKey);
        if (!rowsOf(data).length || !msgs.length) return plans;
        let anchors = {}, arrivals = [];
        try { anchors = JSON.parse(chat.anchors ?? 'null') ?? {}; } catch {}
        try { arrivals = JSON.parse(store.getMeta?.(`arrivals:${chatKey}`) ?? '[]') ?? []; } catch {}
        const roster = store.getCast?.(chat.story_id) ?? [];
        const userName = userOf(msgs);
        const names = uniq([...roster.map(e => e.name), userName]);
        const same = (a, b) => sameName(a, b, names);
        for (const [k, p] of Object.entries(seedPlans(data, { roster, first: msgs[0], same, userName }))) {
            const his = x => !!x && (same(x.who ?? x.name ?? '', p.who) || (!!p.avatar && x.avatar === p.avatar));
            // 进过场才不算开局去向；零长度的封段（拉进来判不在场当场封上，T070）不算进过场（用户 10/15）
            if (Object.values(plans).some(his) || (Array.isArray(arrivals) ? arrivals : []).some(his) || (p.avatar && (anchors?.[p.avatar]?.segments ?? []).some(s => !emptySegment(s)))) continue;
            plans[k] = p;
        }
    } catch {}
    return plans;
}

// 给开口的人的几行（他是那人、或"还有谁知道"里有他；旁白照玩家知道的）：
// 在哪：开场那天、那人开场的样子还算数时给（gone(谁)＝他之后进过场、走开过，或者开场那场戏已经过去而他一直在场）；
// 心事：开场那场戏里给那人和知道的人；过了那场戏，两天以内只给他自己，压在底下的写法。
export function openingLines(data, { knower, same = (a, b) => a === b, today = 0, startDay = 0, lastPos = 0, gone = () => false, userName = null } = {}) {
    if (!knower) return [];
    const sub = s => String(s ?? '').replace(/\{\{user\}\}/g, userName ?? '玩家');
    const rows = rowsOf(data).map(x => ({ ...x, 谁: sub(x.谁), 是: sub(x.是), 谁知道: (x.谁知道 ?? []).map(sub) })).filter(x => knowsRow(x, knower, same));
    const firstDay = today <= startDay;
    const scene = firstDay && lastPos < OPEN_SCENE;
    const out = [];
    const where = firstDay ? rows.filter(x => x.类 === '在哪' && !gone(x.谁)) : [];
    if (where.length) out.push(`开场时各人在哪、在干什么（${knower}知道的；之后聊天里写了别的，以聊天为准）：`, ...where.map(x => `· ${x.谁}：${x.是}`));
    const mood = rows.filter(x => x.类 === '心事');
    if (scene && mood.length) out.push('开场时心里带着的（这场戏里接着带着：怎么露、露多少照这个人，别一下演完，也别突然没了）：', ...mood.map(x => `· ${x.谁}：${x.是}${same(x.谁, knower) ? '' : `（${knower}知道）`}`));
    else if (!scene && today - startDay <= MOOD_DAYS) {
        const own = mood.filter(x => same(x.谁, knower));
        if (own.length) out.push(`${knower}心里还挂着开场时的事（平时压在底下、不挂在嘴上，碰到了才冒出来）：`, ...own.map(x => `· ${x.是}`));
    }
    return out;
}

// 身体那几条并进生活现状的底（life.seedOf 认的样子）
export const bodyRows = data => rowsOf(data).filter(x => x.类 === '身体');
