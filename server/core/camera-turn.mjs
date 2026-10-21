// 有卡的人在场时，旁白这一轮要不要接一手（场记章程 #7、B4）：纯程序判，不调模型。
// 没卡的人（路人、店里的人、来搭话的生人）只有旁白能演；有卡的人进了场，旁白也不消失——
// 玩家冲着没卡的人说话时，有卡的人答完，旁白接着把没卡的人那一下写出来。有卡的人的话、动作仍由他们自己来。
import { hasCard } from './arrival.mjs';
import { sameName } from './setup.mjs';
import { normalizeRelations, personOf } from './relations.mjs';

const CAMERA = 'narrator';
const CAMERA_NAME = '旁白';
// 往前看几条找"在场面里的没卡的人"
export const SCENE_SPAN = 8;
// 引号里的话：中文双引号、直角引号、英文双引号
const QUOTE = /“[^“”]{1,600}”|「[^「」]{1,600}」|『[^『』]{1,600}』|"[^"\n]{1,600}"/g;
// 引号前后多远以内带着名字，算是他开的口
const NEAR = 14;
const BREAK = /[。！？!?；;\n]/;
// 走了：写到他的那一句里有这些
// leaving.mjs（自动离场）也用这一套字眼，别复制一份
export const LEAVE = /走了|走远|离开|离去|出去了|出了门|退了出去|退出去|关上门|带上门|挂断|挂了电话|消失|不见了|没了影|转身走|走出|下了车|上了车走/;
// 这几条不算没卡的人开口：引号前后指的是玩家
const TO_PLAYER = /你[说问道喊答回]|你的声音/;

const isNarrator = m => !!m && !m.is_user && (m.speaker === CAMERA || m.name === CAMERA_NAME);
const asked = text => /[“「『"][^”」』"]*[”」』"]/.test(String(text ?? '')) || /[？?]/.test(String(text ?? ''));

// 一个人的几个叫法：名册里的名字、"甲·乙"的前半（两个字以上）、关系表里的又名（两个字以上）
export function callsOf(name, { rel = null, names = [] } = {}) {
    const out = new Set([name]);
    const head = String(name).split(/[·（(]/)[0];
    if (head && head !== name && head.length >= 2) out.add(head);
    for (const alias of (rel ? personOf(rel, name, names)?.又名 ?? [] : [])) if (String(alias).length >= 2) out.add(String(alias));
    return [...out].filter(Boolean);
}
const mentions = (text, calls) => calls.some(c => String(text ?? '').includes(c));

// 旁白这一条里，各人的事：开口（引号前后带着他的名字）、动作（一句话以他开头）、走了（写到他的那一句有离开的字眼）。
// 返回 [{ at, kind: 'speak'|'act'|'leave' }]，at 是在这一条里的位置；anon＝有人开口但前后没有名字（没名字的路人）
function eventsIn(text, calls, { known = [] } = {}) {
    const s = String(text ?? '');
    const out = [];
    let anon = false;
    for (const q of s.matchAll(QUOTE)) {
        const start = q.index, end = start + q[0].length;
        const before = s.slice(Math.max(0, start - NEAR), start).split(BREAK).at(-1);
        const after = s.slice(end, end + NEAR).split(BREAK)[0];
        const near = `${before}|${after}`;
        if (calls.length && mentions(near, calls)) out.push({ at: start, kind: 'speak' });
        else if (!known.some(c => near.includes(c)) && !TO_PLAYER.test(near)) anon = true;
    }
    if (calls.length) {
        let at = 0;
        for (const sentence of s.split(BREAK)) {
            const plain = sentence.replace(QUOTE, '');
            const lead = plain.replace(/^[\s（(）)【】\[\]…—-]+/, '');
            if (mentions(plain, calls) && LEAVE.test(plain)) out.push({ at, kind: 'leave' });
            else if (calls.some(c => lead.startsWith(c))) out.push({ at, kind: 'act' });
            at += sentence.length + 1;
        }
    }
    return { events: out.sort((a, b) => a.at - b.at), anon };
}

/**
 * 此刻在场面里的没卡的人。
 * 认法：场面表里 status 是 present（或远程）、没卡的；或者最近 SCENE_SPAN 条里旁白写过他开口、动作（名册里的没卡的人，连同又名），
 * 之后没写他走；"此刻的样子"里最近几条记了他的，也算他在（同样看之后有没有写他走）。
 * 没名字的路人：最近那条旁白里有人开口、前后没带任何名字，记成 anon（算在场面里，说不出是谁）。
 * 输入：messages（到玩家这句为止，含这句）、roster、board、stateNotes、userName、rel（normalizeRelations 过的关系表）、cards（有卡的人的叫法）
 * 输出：{ names: [名字…], anon: 布尔, spoke: Set（上一条旁白里开口的名字） }
 */
export function sceneStrangers({ messages = [], roster = [], board = null, stateNotes = [], userName = null, rel = null } = {}) {
    const names = roster.map(e => e?.name).filter(Boolean);
    const strangers = roster.filter(e => e?.name && e.name !== CAMERA_NAME && e.name !== userName && !hasCard(e));
    const cardCalls = roster.filter(e => e?.name && e.name !== CAMERA_NAME && hasCard(e)).flatMap(e => callsOf(e.name, { rel, names }));
    const known = [...cardCalls, ...strangers.flatMap(e => callsOf(e.name, { rel, names })), ...(userName ? [userName] : [])];
    const recent = messages.slice(-SCENE_SPAN);
    const firstPos = recent[0]?.pos ?? 0;
    const here = new Set();
    for (const p of board?.people ?? []) {
        if (p?.name && !p.card && p.name !== CAMERA_NAME && p.name !== userName && ['present', 'remote'].includes(p.status)) here.add(p.name);
    }
    for (const e of strangers) {
        const calls = callsOf(e.name, { rel, names });
        let state = null;   // 'in' | 'out'
        for (const m of recent) {
            // 此刻的样子里记了他（这一条上）：他在
            if ((stateNotes ?? []).some(n => n?.pos === m.pos && n.who === e.name && n.pos >= firstPos)) state = 'in';
            if (!isNarrator(m)) continue;
            for (const ev of eventsIn(m.text, calls, { known }).events) state = ev.kind === 'leave' ? 'out' : 'in';
        }
        if (state === 'in') here.add(e.name);
        else if (state === 'out') here.delete(e.name);
    }
    // 上一条旁白（玩家这句之前、上一句玩家的话之后那条）里谁开了口
    const userAt = messages.findLastIndex(m => m.is_user);
    const prevUser = messages.slice(0, Math.max(0, userAt)).findLastIndex(m => m.is_user);
    const lastNarr = messages.slice(prevUser + 1, Math.max(0, userAt)).findLast(isNarrator) ?? null;
    const spoke = new Set();
    let anon = false;
    if (lastNarr) {
        for (const e of strangers) if (eventsIn(lastNarr.text, callsOf(e.name, { rel, names }), { known }).events.some(ev => ev.kind === 'speak') && here.has(e.name)) spoke.add(e.name);
        anon = eventsIn(lastNarr.text, [], { known }).anon;
    }
    return { names: [...here], anon, spoke };
}

/**
 * 旁白这一轮要不要接（有卡的人在场时）。
 * 输入：messages（后台的这一局消息，玩家最近那句之后可以已经有人答了）、recentUser（玩家这句的原文，没给就用最近那条玩家消息）、
 *      present（群里开着口的人，含玩家）、roster（名册）、board（场面表）、stateNotes（此刻的样子）、relations（关系表，可缺）
 * 输出：{ speak, why, who? }
 */
export function cameraShouldSpeak({ messages = [], recentUser = null, present = [], roster = [], board = null, stateNotes = [], relations = null } = {}) {
    const userAt = messages.findLastIndex(m => m.is_user);
    if (userAt < 0) return { speak: false, why: '还没有玩家的话' };
    const userName = messages[userAt].name ?? null;
    const text = String(recentUser ?? messages[userAt].text ?? '');
    const rel = relations ? normalizeRelations(relations) : null;
    const names = roster.map(e => e?.name).filter(Boolean);
    const same = (a, b) => sameName(a, b, names) || (!!rel && !!personOf(rel, a, names) && personOf(rel, a, names) === personOf(rel, b, names));
    // 在场的有卡的人：群里开着口的（扩展带来的名单）里名册上有卡的；没带名单就看场面表
    const cardsHere = present.length
        ? present.filter(n => n && n !== userName && n !== CAMERA_NAME && roster.some(e => hasCard(e) && same(e.name, n)))
        : (board?.people ?? []).filter(p => p.card && ['present', 'remote'].includes(p.status) && p.name !== CAMERA_NAME).map(p => p.name);
    if (!cardsHere.length) return { speak: false, why: '身边没有有卡的人（一个人时照旧由旁白接）' };
    if (messages.slice(userAt + 1).some(isNarrator)) return { speak: false, why: '这一句旁白已经接过了' };
    const upto = messages.slice(0, userAt + 1);
    const scene = sceneStrangers({ messages: upto, roster, board, stateNotes, userName, rel });
    const strangerNamed = scene.names.find(n => mentions(text, callsOf(n, { rel, names })));
    if (strangerNamed) return { speak: true, why: `玩家这句点名了在场的没卡的人：${strangerNamed}`, who: strangerNamed };
    const cardNamed = cardsHere.find(n => mentions(text, callsOf(n, { rel, names })));
    if (cardNamed) return { speak: false, why: `玩家这句点名的是有卡的人：${cardNamed}` };
    if (!scene.names.length && !scene.anon) return { speak: false, why: '场面里没有没卡的人' };
    if ((scene.spoke.size || scene.anon) && asked(text)) {
        const who = [...scene.spoke][0] ?? null;
        return { speak: true, why: `玩家接着跟上一条旁白里开口的人说话${who ? `：${who}` : ''}`, ...(who ? { who } : {}) };
    }
    if (isNarrator(messages[userAt - 1])) return { speak: false, why: '上一条就是旁白，玩家这句没点名，不抢戏' };
    return { speak: false, why: '玩家这句没冲着没卡的人' };
}
