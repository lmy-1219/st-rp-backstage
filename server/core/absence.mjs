import { personWord } from './pronoun.mjs';
// 离开与回来（白皮书阶段 3B；需求 N-21/N-22/N-32～N-34；调研 17 §四～§六）。
// 双时钟：窗口里按剧情时间走；只有用户真没进窗口时，才按现实时间一比一走，而且只对一直在场的主要角色。
// 离开期间不生成任何情节，只记两件事：离开了多久（事实）、谁试着找过用户（一行事件，不写正文）。
// 离开的理由是剧情：角色可以猜、可以问、可以因为担心做点什么，但由用户回来时自己定，系统不替用户定性。
const HOUR = 3600e3;
const CLOSE = new Set(['至亲', '亲近']);

// 找最近的一次"离开"：最后一条消息到现在，或者用户回来发的那条和它前一条之间，隔了至少 minHours（默认 24 小时）。
// since＝用户上次取消"暂停离开计时"的时刻：暂停期间不算离开，从取消那一刻重新计。
export function detectGap(messages, now, { minHours = 24, maxDays = 30, since = null } = {}) {
    const t = m => Math.max(Date.parse(m?.sent_at ?? ''), Number.isFinite(since) ? since : -Infinity);
    const last = messages.at(-1), prev = messages.at(-2);
    const make = (from, to, start, end) => {
        const hours = (end - start) / HOUR;
        return { fromFp: from.fp, toFp: to?.fp ?? null, fromPos: from.pos, startedAt: new Date(start).toISOString(), endedAt: new Date(end).toISOString(),
            hours: Math.round(hours * 10) / 10, days: Math.min(maxDays, Math.max(1, Math.round(hours / 24))) };
    };
    if (!last || !Number.isFinite(t(last))) return null;
    if (now - t(last) >= minHours * HOUR) return make(last, null, t(last), now);
    if (last.is_user && prev && Number.isFinite(t(prev)) && t(last) - t(prev) >= minHours * HOUR) return make(prev, last, t(prev), t(last));
    return null;
}

// 离开在剧情里也算过了这么多天：给 dayIndex 当"时间"记录用（位置在离开前那条之后）。
export function absenceMarks(absences) {
    return absences.filter(a => a.from_pos != null && a.days > 0).map(a => ({ pos: a.from_pos + 0.5, elapsed: `${a.days}天`, absence: true }));   // 0 天＝玩家说其实没空白
}

// 离开期间谁试着找过用户（不写正文，只一行事件）。people＝contacts.absentPeople 的结果；closenessOf(person) → { score, level }。
// 烈度按亲疏：亲近的第一天就找、找好几回，离开久了会找上门；熟络的第二天一条；点头之交得有事、离开三天以上才留一条；陌生的不找。
// 还没出场、有钩子的：离开三天以上才来，一次离开最多一位。
export function attemptsDuring(absence, people, { max = 3, closenessOf = () => ({ score: 3, level: '熟络' }) } = {}) {
    const out = [];
    for (const p of people) {
        const c = closenessOf(p.person);
        const said = p.threads.at(-1)?.text ?? null;   // 他和在场的人之间最近挂着的那件事（找来说什么得和它接得上）
        const why = p.hook ?? said;
        const last = p.hook ? said : null;
        if (p.lastPos < 0) {
            if (absence.days < 3 || out.some(a => a.offstage) || c.level === '陌生') continue;
            out.push({ person: p.person, day: Math.max(1, absence.days - 1), offstage: true, level: c.level, how: CLOSE.has(c.level) ? '找上门来过，没见着人，留了话' : '找过来，没找着人，留了话', about: p.hook });
        } else if (p.role !== '主要') {
            if (CLOSE.has(c.level)) out.push({ person: p.person, day: 1, level: c.level, how: absence.days >= 3 ? '三番五次地找，后来还找上门来过' : '三番五次地找', about: why, last });
            else if (c.level === '熟络') out.push({ person: p.person, day: Math.min(absence.days, 2), level: c.level, how: '找过一回没找着，留了话', about: why, last });
            else if (c.level === '点头之交' && why && absence.days >= 3) out.push({ person: p.person, day: 3, level: c.level, how: '留了一句话', about: why, last });
        }
        if (out.length >= max) break;
    }
    return out.sort((a, b) => a.day - b.day);
}

// 主要角色回来时的分寸：按他和用户的亲疏。
// 这些日子是什么样（出去了联系不上，还是一直睡着没醒）不在这里定：前台照最后那一幕来（用户 9/27）。
function stirred(name, userName, level) {
    if (level === '至亲') return `${name}和${userName}很近：这些日子${personWord(name)}多半坐不住——守过、找过、等过、急过、气过都有可能，怎么个坐不住由${personWord(name)}的性格和最后那一幕定。`;
    if (level === '亲近') return `${name}会惦记${userName}这几天去哪了，见面会问，也许找过。`;
    if (level === '熟络') return `${name}注意得到${userName}这几天不在，见面会问一句。`;
    return `${name}未必在意${userName}这几天去了哪。`;
}

const span = days => (days >= 14 ? `${Math.round(days / 7)} 周` : `${days} 天`);

// 回来后，每个在场的角色第一次开口前拿到的那段。first＝这一轮第一个开口的人（这几天找过来的只给他一份）。
// reasoned：后台已经推过他这些天（away.mjs），就不再给"照常过日子"那句泛泛的。
export function returnLines({ name, userName = '对方', absence, open = [], attempts = [], first = false, level = null, reasoned = false, opening = false }) {
    const d = span(absence.days);
    const lines = [
        `${userName}离开了一阵：现实里有 ${d}没进这个窗口，按设定剧情里也过去了差不多 ${d}。中间这些日子没演。`,
        ...(reasoned ? [] : [`${name}这几天照常过自己的日子${open.length ? `；手上惦记的事可以一笔带过做到了哪一步：${open.map(r => r.text.replace(/[。．.]+$/, '')).join('；')}` : ''}。`]),
        ...(level ? [stirred(name, userName, level)] : []),
        `这些天${userName}到底怎么了，由${userName}自己说；${name}可以猜、可以问、可以因为担心做过点什么，但别替${userName}定下来。`,
    ];
    // 用户先开口时才有这条退路；由他先开口时没有"这句话"，前台会拿十几天前那句当成没断过（实测照着上一幕往下演了）。
    if (!opening) lines.push(`要是${userName}这句话明显是接着上一幕说的、像是没断过，就当中间没断，这段不用管。`);
    // 这一轮由他先开口（用户还没说话）：推演没有结果时也得说清别替用户写原因（实测：前台自己写成了她这十一天一直昏迷在床上）。
    // 空白在旁人眼里是什么样（出去了没回来、一直睡着没醒）顺着最后那一幕，不预设是出走。
    if (opening && !reasoned) lines.push(`（这一轮由你先开口：写${name}此刻在干什么、在想什么，和${userName}重新露面那一刻的第一反应——这段空白在身边的人眼里是什么样，顺着最后那一幕来；这些天${userName}到底怎么了、为什么，留给${userName}接着说，别替${userName}写。）`);
    // 由他先开口时这几天找过来的不在这一轮给（实测开场就挨个念一遍），从他下一次开口起由余波递上（phoneCarry）。
    if (first && attempts.length && !opening) {
        lines.push(`这几天找过${userName}的（怎么找的——留言、捎话、上门——用这个世界里说得通的方式；可以让${userName}或在场的人看到，不必一次全拿出来，问起、翻到了再说；内容只按找来的人自己知道的事写，和各自上回说过的对得上）：`);
        for (const a of attempts) lines.push(`· ${a.person}（第 ${a.day} 天起）：${a.how}${a.about ? `——跟这件事有关：${a.about}` : ''}${a.last ? `；上回挂着的：${a.last}` : ''}`);
    }
    return lines;
}

// 余波（mood.mjs）：没推演时，亲近的人心里那点"空了这么久"也不是一轮就过去。
export function returnCarry({ name, userName = '对方', absence, level = null }) {
    if (!['至亲', '亲近'].includes(level)) return [];
    return [{ key: `return:${absence.id ?? absence.from_fp ?? 0}`, keep: level === '至亲' ? 2 : 'scene', about: `${userName}空了 ${span(absence.days)}那回`,
        text: `${userName}空了 ${span(absence.days)}才重新露面。${stirred(name, userName, level)}` }];
}

export function phoneCarry({ userName = '对方', absence, attempts = [] }) {
    if (!attempts.length) return [];
    return [{ key: `phone:${absence.id ?? absence.from_fp ?? 0}`, keep: 'next',
        text: `这几天找过${userName}的（怎么找的用这个世界里说得通的方式；${userName}翻到、问起再说；内容只按找来的人自己知道的事写）：${attempts.map(a => `${a.person}（第 ${a.day} 天起）${a.how}${a.about ? `，为的是：${a.about}` : ''}`).join('；')}` }];
}

// 这一段有没有到该给的时候：回来后的第一轮里，这个角色还没拿过。
export function dueReturn(absences, { speaker, lastPos, window = 8 }) {
    const a = absences.at(-1);
    if (!a || a.from_pos == null || !(a.days > 0) || lastPos - a.from_pos > window || a.seen.includes(speaker)) return null;
    return a;
}

