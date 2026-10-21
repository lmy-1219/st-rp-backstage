// 世界按不同的时间尺度变（N-93）：短期——天气（timeline.mjs，每天掷）、时事种子（world.mjs，每天至多一条）；
// 中期——物价小幅波动：每个剧情周按"局＋周＋价目"掷一次，多半不动，偶尔贵一成两成、便宜一成，常常连着几周不变；
// 长期——持续几周、分阶段的事（地盘之争打了又停、一阵严查、一场短缺、一场施工……）：每个剧情周掷一次要不要起一件
// （同时至多两件），种类、调性、地点、拖多久由程序掷，便宜模型按这一局的设定写成具体的事和三个阶段；
// 程序管它走到哪个阶段、什么时候完。给开口的人放在"背景"那块（对不上场面就当没看见），规划者全看。
// 阶段按剧情日和消息数取快的那个往前走（剧情日走得慢的局，每 50 条消息也进一阶）；走完最后一阶，给每个知道的人一次"过去了"的一句就撤；
// 平时不每轮都念：镜头在它的地段、玩家提到它、或这个剧情日还没给过他，才给，同时只给一件。
// 同一周、同一天怎么重来都一样（不用 Math.random）。删消息让剧情日退回去，还没开始的就不算。
// 题材无关：种类、调性是通用的，具体是什么事由模型按这一局的设定写（D-37）。
import { createHash } from 'node:crypto';
import { scaleOf, DAY } from './timescale.mjs';
// 时间尺度（章程 G2）：这里的"天"是这一局的单位，"周"是 timescale 的 perWeek 格（天＝7 天；年尺度＝10 年），
// 持续的事拖多久、走完多久以内补一句"过去了"也按那张表（天：14～42 天、14 天）。不给尺度就是天，和以前一样。

const unit = (...parts) => parseInt(createHash('sha256').update(parts.join(':')).digest('hex').slice(0, 8), 16) / 0x100000000;
export const weekOf = (day, timeScale = DAY) => Math.floor(Math.max(0, day) / scaleOf(timeScale).perWeek);

// ---------- 中期：物价 ----------
const STEPS = [[0.85, 0.05], [0.9, 0.1], [1, 0.6], [1.1, 0.15], [1.2, 0.1]];
const KEEP = 0.5;
export function priceFactor(seed, week, name) {
    let f = 1;
    for (let w = 0; w <= week; w++) {
        if (w > 0 && unit(seed, w, name, 'keep') < KEEP) continue;
        let x = unit(seed, w, name);
        f = STEPS.find(([, p]) => (x -= p) < 0)?.[0] ?? 1;
    }
    return f;
}
const say = f => (f > 1 ? `这阵子比平常贵${f >= 1.2 ? '两成' : '一成'}` : f < 1 ? `这阵子比平常便宜${f <= 0.85 ? '一成半' : '一成'}` : '');
// 价目按这一周的行情改：有准数的照比例改，只有一段说法的（range）附一句；没变的原样。
export function driftItems(items, { seed, day, timeScale = DAY }) {
    const week = weekOf(day, timeScale);
    return items.map(e => {
        const f = priceFactor(seed, week, e.name);
        if (f === 1) return e;
        const scale = v => (Number.isFinite(v) ? Math.round(v * f) : v);
        return { ...e, min: scale(e.min), max: scale(e.max), note: [say(f), e.note].filter(Boolean).join('；') };
    });
}

// ---------- 长期：持续几周的事 ----------
export const LONG_KINDS = ['势力之间的争斗', '一阵严查', '某样东西短缺', '一场事故的余波', '一件大事筹备中', '一种病在传', '罢工或停摆', '施工或封路', '一个传闻越传越大', '新来的一伙人'];
const TONES = ['紧张', '悬着不落地', '荒诞', '苦中作乐', '压抑', '热闹'];
const MAX_ACTIVE = 2, START = 0.3;
export const STAGE_MSGS = 50;   // 剧情日走得慢时，每过这么多条消息也进一阶
const WIDE = /^(全城|整座城|整个城|到处|处处|各处|哪都|哪里都)$/;
const FRESH_MSGS = 100;   // 走完以后过了这么久才第一次轮到某人，就不再补那句"过去了"

// 这一周起不起一件、什么样（模型写之前的骰子）。active＝这周开始时还没完的几件。地段由模型按这一局的设定写，不掷。
// 天数：按这一局的单位数（天尺度 14～42）。
export function rollLong(seed, week, active = 0, timeScale = DAY) {
    if (active >= MAX_ACTIVE || unit(seed, week, 'long') >= START) return null;
    const pick = (list, k) => list[Math.floor(unit(seed, week, k) * list.length)];
    const [lo, hi] = scaleOf(timeScale).long;
    return { week, 种类: pick(LONG_KINDS, 'kind'), 调性: pick(TONES, 'tone'), 天数: lo + Math.floor(unit(seed, week, 'days') * (hi - lo + 1)) };
}

export const LONG_SYSTEM = [
    '你在给一部长篇角色扮演的世界添一件"持续一阵的事"：它在镜头外慢慢发展，持续几周，分几个阶段；角色们会听说、会受点影响，但它不是任务，也不替任何人安排结局。',
    '按给你的种类、调性和天数，结合这一局的设定，写成这个世界里说得通的一件事。只用设定里有的势力、地点和常识，不编名册里的主要角色做了什么；具体的人用"有人""一伙人"带过。',
    '地点要写这一局设定里具体的一片（某个街区、场所、地段的名字），不要写"街上""到处"这类泛称；真是全城都在的事才写"全城"。',
    '谁会知道：事情只在某个圈子里传的写圈子或人名，满城皆知的才写"所有人"。',
    '镜头里：镜头恰好落在那片地方时，能亲眼看见的样子（看得见、听得见的东西，一句话；不是别人转述的消息）。',
    '只输出 JSON：{"名": "四到八个字", "一句话": "外人看到、听说的样子", "地点": "具体的一片", "阶段": ["刚冒头时的样子", "闹得最凶时的样子", "收尾时的样子"], "镜头里": "站在那片地方能看见的样子", "谁会知道": "所有人" 或 ["圈子或人名"]}',
].join('\n');

export function longPrompt({ roll, setup = [], factions = [], timeScale = DAY }) {
    const ts = scaleOf(timeScale);
    return [
        `【骰子】种类：${roll.种类}；调性：${roll.调性}；大概持续 ${ts.span(roll.天数)}`,
        ...(ts.unit === '天' ? [] : [`（这一局的时间按「${ts.unit}」走：说明里的"持续几周"，在这一局是持续几${ts.word}，照上面的时长写阶段。）`]),
        ...(setup.length ? ['', ...setup] : []),
        ...(factions.length ? ['', `【这一局的势力】${factions.join('、')}`] : []),
    ].join('\n');
}

// startPos：这件事起时最后一条消息的位置（没有就只按日子推阶段，老数据都是这样）。
export function parseLong(text, roll, startDay, startPos = null) {
    const m = String(text ?? '').match(/\{[\s\S]*\}/);
    let raw = null;
    try { raw = m ? JSON.parse(m[0]) : null; } catch {}
    const str = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
    const stages = (Array.isArray(raw?.阶段) ? raw.阶段 : []).map(x => str(x, 120)).filter(Boolean).slice(0, 4);
    if (!str(raw?.名, 20) || !str(raw?.一句话, 200) || stages.length < 2) return null;
    const list = Array.isArray(raw.谁会知道) ? raw.谁会知道 : typeof raw.谁会知道 === 'string' ? [raw.谁会知道] : [];
    const who = list.map(x => str(String(x), 30)).filter(x => x && x !== '所有人');
    return { 名: str(raw.名, 20), 一句话: str(raw.一句话, 200), 地点: str(raw.地点, 30), 阶段: stages, 镜头里: str(raw.镜头里, 120), 谁会知道: who, 起: startDay, ...(Number.isFinite(startPos) ? { 起_pos: startPos } : {}), 天数: roll.天数, 种类: roll.种类 };
}

// 走到第几阶段（从 0 数）：剧情日和消息数取快的那个；≥ 阶段数就是走完了；还没到起的日子是 null。
export function longStage(e, day, lastPos = null) {
    if (!e || !(e.起 <= day)) return null;
    const n = e.阶段.length;
    const byDay = Math.floor(((day - e.起) / e.天数) * n);
    const byMsg = Number.isFinite(e.起_pos) && Number.isFinite(lastPos) ? Math.floor(Math.max(0, lastPos - e.起_pos) / STAGE_MSGS) : 0;
    return Math.max(byDay, byMsg);
}
export const longKey = e => `${e.起}:${e.名}`;

// 这一天还在的几件，各走到哪个阶段。
export function activeLong(events, day, { lastPos = null } = {}) {
    return (events ?? []).filter(e => e && longStage(e, day, lastPos) != null && longStage(e, day, lastPos) < e.阶段.length)
        .map(e => ({ ...e, 第几阶段: longStage(e, day, lastPos) }));
}
// 刚走完的几件（走完很久了的不算：那时的人早该知道了）。
export function endedLong(events, day, { lastPos = null, timeScale = DAY } = {}) {
    const fresh = scaleOf(timeScale).fresh;
    return (events ?? []).filter(e => {
        if (!e) return false;
        const i = longStage(e, day, lastPos);
        if (i == null || i < e.阶段.length) return false;
        const overDays = day - (e.起 + e.天数);
        const overMsgs = Number.isFinite(e.起_pos) && Number.isFinite(lastPos) ? lastPos - e.起_pos - STAGE_MSGS * e.阶段.length : null;
        return overDays <= fresh || (overMsgs != null && overMsgs <= FRESH_MSGS);
    });
}

// 句子里提到了没有：整段在，或者其中一个两字的实词在（带"的、之、一"这类虚字的两字不算）。
const FILLER = /[的之一了在和与及把被是着过这那有个]/;
export function touches(text, phrase) {
    const t = String(text ?? '').replace(/\s+/g, '');
    for (const seg of String(phrase ?? '').split(/[\s，,。；;、：:（）()/·\-—]+/)) {
        if (seg.length < 2) continue;
        if (t.includes(seg)) return true;
        for (let i = 0; i + 2 <= seg.length; i++) { const g = seg.slice(i, i + 2); if (!FILLER.test(g) && t.includes(g)) return true; }
    }
    return false;
}
const hasArea = e => !!e.地点 && !WIDE.test(e.地点);
// 镜头所在的地方包含它的地段（反过来，地段写得比场面表的地方大一圈也算）；
const inArea = (place, area) => { const p = String(place ?? '').replace(/\s+/g, ''); return p.length >= 2 && (p.includes(area) || area.includes(p)); };
// 玩家这句提到了地段：整段在，或者它末尾那个两字的地名词在（"东码头"说成"码头"）。
const mentionsArea = (talk, area) => { const t = String(talk ?? '').replace(/\s+/g, ''); const tail = area.slice(-2); return t.includes(area) || (area.length >= 3 && !FILLER.test(tail) && t.includes(tail)); };

// 给开口的人的：他会知道的那几件里，这一轮该给哪一件、要不要给"过去了"。
// place：镜头此刻所在（场面表的地方）；talk：玩家这句；heard(kind, key)：这个剧情日／这件事他已经听过了没有（"听说"每剧情日一次，"过去了"一次）。
// 返回 { lines, told: [{ k, kind }] }，told 是这次给了的，由调用的人记下。同时只给一件（最近起的那件优先）。
export function longGive(events, { day, lastPos = null, name, sameName = (a, b) => a === b, when = () => '', place = '', talk = '', heard = () => false, timeScale = DAY }) {
    const knows = e => !e.谁会知道.length || e.谁会知道.some(w => sameName(w, name));
    const lines = [], told = [];
    const live = activeLong(events, day, { lastPos }).filter(knows).map(e => {
        const here = hasArea(e) && inArea(place, e.地点);
        const asked = !!talk && (touches(talk, e.名) || (hasArea(e) && mentionsArea(talk, e.地点)));
        const fresh = !heard('听说', longKey(e));
        return { e, here, asked, fresh };
    }).filter(x => x.here || x.asked || x.fresh).sort((a, b) => a.e.起 - b.e.起).at(-1);
    if (live) {
        const { e, here, asked } = live;
        const seen = (here || asked) && e.镜头里 ? `；镜头在${e.地点}时能看见：${e.镜头里}` : '';
        lines.push('这阵子一直在发生的事（镜头外慢慢发展，对不上场面就当没看见；别替它安排结局）：',
            `· ${e.名}${hasArea(e) ? `（${e.地点}）` : ''}：${e.一句话}——眼下${e.阶段[e.第几阶段]}（${when(e.起)}起）${seen}`);
        told.push({ k: longKey(e), kind: '听说' });
    }
    const over = endedLong(events, day, { lastPos, timeScale }).filter(knows).filter(e => !heard('过去了', longKey(e)));
    if (over.length) {
        lines.push('前阵子一直在发生的事已经过去了（只当心里有数，不用特意提）：', ...over.map(e => `· ${e.名}这阵子过去了：${e.阶段.at(-1)}`));
        for (const e of over) told.push({ k: longKey(e), kind: '过去了' });
    }
    return { lines, told };
}
export const longLines = (events, opts) => longGive(events, opts).lines;
