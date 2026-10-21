// 删消息就等于没发生过（方案 删消息等于没发生过，质量窗 → 主窗 10/9；用户 10/9："我希望我删消息的时候不用顾虑他的记忆现在到哪里了，
// 也不用到处找刚刚明明触发了的口袋为什么又接不上了"）。一条总规矩：后台推出来的、交给某人去演的，都挂在它真正写出来的那条消息上——
// 那条还在就算数，删了、换掉了就撤。这里是进场那份、"要联系"用掉的那一下、他后来自己进了场（enteredSince）；口袋那几步在 store.menuOf（pending），隔离区间在 liveAnchors。
// 题材无关。

const num = v => (Number.isFinite(Number(v)) ? Number(v) : null);
const isHis = (m, e) => !!m && !m.is_user && (m.name === e.who || (!!e.avatar && m.speaker === e.avatar));

// 这次进场之后他那条回复：他进场以后、他下一次进场之前，第一条他开口的消息；没有就 null
function replyOf(e, messages, entries = []) {
    const at = num(e?.at);
    if (at == null) return null;
    const next = Math.min(Infinity, ...entries.filter(x => x !== e && isSame(x, e) && num(x.at) > at).map(x => num(x.at)));
    return messages.find(m => m.pos >= at && m.pos < next && isHis(m, e)) ?? null;
}
const isSame = (a, b) => (a.who && a.who === b.who) || (!!a.avatar && a.avatar === b.avatar);

// 隔离区间封上了、中间一条都没有（拉进来又移出去，他一句没说）：等于没进过场，也不算"刚走"
export const emptySegment = s => s?.to != null && num(s.to) != null && num(s?.from) != null && num(s.to) <= num(s.from);
// 这次进场开的那段（起点就是 at 的最后一段）封上了、他一句没说：用户 10/15——点了他发消息，前台没调成功，点头像让他说的那条对不上删了，
// 人移出去，进场记录还挂在进场前那条上，门上就再也不挂他了
const leftSilent = (e, anchors) => { const segs = (e?.avatar ? anchors?.[e.avatar]?.segments ?? [] : []).filter(s => num(s?.from) === num(e.at)); return segs.length > 0 && emptySegment(segs.at(-1)); };

// 进场还算不算：挂的那条（进场前最后一条）还在；而且他进场以后还没有别的消息（他正在写）、或者后面有他开口的。
// 他那条删了、后面换成了别人在说：这次进场就不算（场面表不认这次进场开的区间）；他一句没说就被移出去了（anchors 给了才认）：也不算
export function arrivalLive(e, messages, entries = [], anchors = null) {
    const at = num(e?.at);
    if (at == null || messages[at - 1]?.fp !== e.fp) return false;
    if (replyOf(e, messages, entries)) return true;
    return messages.length <= at && !leftSilent(e, anchors);
}

// 进场时替他记的那几笔（来由、这段时间、换了住处）挂到他那条回复上：回复删了、换了，它们跟着看不见；他又开口了，跟着回来。
// 每次同步跑一遍（只动 arrivals 里记了 recs 的那几次）。没有回复、他正在写：挂在进场前那条上；后面换成了别人在说：挂到一个看不见的指纹上
export const GONE = 'gone:';
export function relinkArrivals(store, records, chatKey) {
    if (!records?.moveDerived && !store.moveMenu) return 0;
    let entries = [];
    try { entries = JSON.parse(store.getMeta?.(`arrivals:${chatKey}`) ?? '[]') ?? []; } catch { return 0; }
    if (!Array.isArray(entries) || !entries.some(e => e?.recs?.length || e?.menus?.length)) return 0;
    const messages = store.currentMessages(chatKey);
    const chat = store.requireChat(chatKey), storyId = chat.story_id;
    let anchors = null; try { anchors = JSON.parse(chat.anchors ?? 'null'); } catch {}
    let moved = 0;
    entries.forEach((e, i) => {
        if (!(e?.recs?.length || e?.menus?.length) || !e.fp) return;
        const at = num(e.at);
        // 同一条上又进了一次场（他那条删了重来）：前一次替他记的不再算，只留最后一次的
        const again = entries.slice(i + 1).some(x => x && isSame(x, e) && num(x.at) === at && x.fp === e.fp);
        const anchored = !again && at != null && messages[at - 1]?.fp === e.fp;
        const reply = anchored ? replyOf(e, messages, entries) : null;
        const target = reply?.fp ?? (anchored && messages.length <= at && !leftSilent(e, anchors) ? e.fp : `${GONE}${e.fp}`);
        if (e.recs?.length) moved += records.moveDerived({ storyId, ids: e.recs, fp: target });
        // 进场时顺带排给别人的那件（main.arrive 的"提前"）：同样挂在他那条回复上
        if (e.menus?.length && store.moveMenu) moved += store.moveMenu({ ids: e.menus, pos: reply?.pos ?? at - 1, fp: target });
    });
    return moved;
}

// 隔离扩展记的在场区间，按两头那条消息的时间认回这条序列里的位置（后台按条号认的话，删回去以后新写在同样条号上的消息也会被当成他在场）：
// - 起点那条（他进场前那条）没了：照条号认起点（左滑重来过的那条日期会变；整段删回去重写的，结尾那一步截完是空的）；
// - 只有结尾那条（他离场前看到的最后一条）没了：截到还在的、比他离场时间早的最后一条——删回去以后新写的消息时间都更晚，不会算进来；
// - 没记时间的（老数据、从头就在的）照条号。dates：这条序列里每条的发送时间（ST 的 send_date）
export function liveAnchors(anchors, dates = []) {
    if (!anchors || typeof anchors !== 'object') return anchors;
    const at = d => (d ? dates.indexOf(String(d)) : -1);
    const time = d => Date.parse(d ?? '');
    const out = {};
    for (const [key, rec] of Object.entries(anchors)) {
        if (!rec || !Array.isArray(rec.segments)) { out[key] = rec; continue; }
        const segments = [];
        for (const s of rec.segments) {
            if (!s || typeof s !== 'object') continue;
            let from = s.from, to = s.to;
            // 起点那条找不到：照条号（隔离扩展也是这样，前台、后台认的得是同一段）。封上的段不再整段作废（用户 10/14：那条进场后被左滑重来过、
            // 日期变了，人一移出整段在场作废，退回上一回进场的记忆）——结尾照下面只收他离场前写下的，删回去重写的照样进不来
            if (s.fromDate) { const i = at(s.fromDate); if (i >= 0) from = i + 1; }
            if (to != null && s.toDate) {
                const i = at(s.toDate);
                if (i >= 0) to = i + 1;
                else {
                    const limit = time(s.toDate);
                    let j = -1;
                    if (Number.isFinite(limit)) dates.forEach((d, n) => { const t = time(d); if (Number.isFinite(t) && t < limit) j = n; });
                    if (j + 1 <= from) continue;
                    to = j + 1;
                }
            }
            segments.push({ ...s, from, to });
        }
        out[key] = { ...rec, segments };
    }
    return out;
}

// 他在 pos 那条以后自己进了场没有（场记章程 第二节第 3、10 条，试玩 10/10：结算替他写了"要联系"，之后他自己打来电话、人也在戏里，
// 门上那条还挂着、还被当成"没人接"又结算了两回）。按消息认，删回去就回来：
// - 隔离区间（liveAnchors 认过的那份，按 avatar）有一段从 pos 以后开始、开头那条还在这条序列里，而且这段不是一次作废了的进场开的
//   （和场面表 board.liveSegment 一样：起点上记过他进场、那几次全不算数了，这段就不算）；
// - 或者进场记录里有他一次 at 在 pos 以后、而且这次进场还算数（arrivalLive）。
// 远程（电话、消息）进来的也算：他已经亲自出面说过话了，后台替他挂的那一下就过时了
export function enteredSince(pos, { who = null, avatar = null, messages = [], anchors = null, arrivals = [] } = {}) {
    const p = num(pos);
    if (p == null || (!who && !avatar)) return false;
    const entries = Array.isArray(arrivals) ? arrivals.filter(Boolean) : [];
    const me = { who, avatar };
    const mine = entries.filter(e => isSame(e, me));
    const live = e => arrivalLive(e, messages, entries, anchors);
    const segs = avatar ? anchors?.[avatar]?.segments : null;
    const segLive = s => { const atStart = mine.filter(e => num(e.at) === s.from); return !atStart.length || atStart.some(live); };
    if (Array.isArray(segs) && segs.some(s => Number.isFinite(s?.from) && s.from > p && s.from <= messages.length && !emptySegment(s) && segLive(s))) return true;
    return mine.some(e => num(e.at) > p && live(e));
}

// 旁白替他递过消息、来电，他从门上进来接着这条说（场记章程 B1）：进场时替他记一笔"他刚给玩家发过消息……"（他和玩家都知道；
// 返回的编号由调用的人放进这次进场的 recs，relinkArrivals 把它挂到他那条回复上——以后他也想得起是自己发的）；
// 那件口袋标用掉：这一步挂在进场前那条上、等他那条回复（store.menuOf 的 pending），他那条删了、换了别人在说，就回到"拿出来了"、门上又挂他。
// sent：门上那一项的 sent（{ id, way, surface, respond }）；at：他从哪条起在场；fp：进场前那条的指纹
export function landSent(store, records, { chatKey, storyId, who, avatar = null, userName = '玩家', sent, at, fp }) {
    if (!sent?.surface || !fp || !Number.isInteger(at)) return null;
    const verb = sent.way === '电话' ? '打过电话' : '发过消息';
    const rec = records?.addDerived ? records.addDerived({ storyId, fp, type: '做', text: `${who}刚给${userName}${verb}：${sent.surface}`.slice(0, 200), holder: avatar ?? `name:${who}`, holderName: who, audience: [who, userName], about: who }) : null;
    if (Number.isInteger(sent.id) && store?.updateMenu) store.updateMenu(chatKey, sent.id, { status: 'used', by: who, pending: true, at: { pos: at - 1, fp } });
    return rec;
}

// 结算写的"要联系"用掉了没有：用掉那一下记在哪条（usedAt），那条还在才算；进场用掉的，还要他那条回复在（同进场）。
// 写下它以后他自己进了场（enteredSince）也算用掉——他人都来过了，这条不用再等人点。entries：进场记录（arrivals）；
// opts：{ anchors, who, avatar }（不给就只认 usedAt，老调用照旧）。老数据只有 used: true，照旧算用掉
export function contactUsed(c, messages, entries = [], opts = {}) {
    if (!c) return false;
    const who = opts.who ?? c.who ?? null, avatar = opts.avatar ?? c.avatar ?? null;
    if (c.at != null && enteredSince(c.at, { who, avatar, messages, anchors: opts.anchors ?? null, arrivals: entries })) return true;
    if (!c.usedAt) return !!c.used;
    const u = c.usedAt;
    if (messages[u.pos]?.fp !== u.fp) return false;
    if (!u.who) return true;
    return messages.length <= u.pos + 1 || messages.slice(u.pos + 1).some(m => isHis(m, { who: u.who, avatar: u.avatar ?? null }));
}
