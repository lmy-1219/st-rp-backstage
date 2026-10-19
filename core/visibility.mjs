// 按消息的可见（方案 自动进离场与调度 第二节第 1 条"认知隔离"第二层，N-377）：他发给玩家的消息、他电话里说的话，同屋别的有卡的人看不见
//（电话只听得见玩家这头说出口的）；本人、玩家、旁白看得见。这类消息带 extra.rp_vis = { from, way, to? }（和 rp_lore、rp_fresh 一样跟着聊天文件走）；
// 找上门的那条（敲门、在门口）屋里的人都听得见；没带记号的普通消息照旧谁都看得见。
// 这里只有判定：visibleTo／visibleMessages；扩展的拦截器按开口的人筛是主窗 1c 的事，后台场记那一侧（N-375、章程第 2 条）另算。题材无关。

const CAMERA = new Set(['旁白', 'narrator']);
const PLAYER = new Set(['user', '玩家']);
const norm = s => String(s ?? '').replace(/\s+/g, '').toLowerCase();

// 方式归成三种：电话、消息、上门；认不出的照原样留着
export const wayOf = w => (/电话|来电|通话|语音/.test(w ?? '') ? '电话' : /消息|短讯|短信|信息/.test(w ?? '') ? '消息' : /门|上门|来找|找上/.test(w ?? '') ? '上门' : String(w ?? '').trim() || null);
// 只有这两种是私密的
const PRIVATE = new Set(['消息', '电话']);

// 挂在消息上的记号：from 谁发来的／谁那头说的，way 消息／电话／上门，to 发给谁（玩家回他的那条可以带，让他看得见）
export function visTag(from, way, to = null) {
    return { from: String(from ?? '').trim() || null, way: wayOf(way), ...(to ? { to: String(to).trim() } : {}) };
}

// 读一条消息上的记号（对象或 JSON 文本都认）；没有就 null
export function visOf(message) {
    let v = message?.extra?.rp_vis ?? null;
    if (typeof v === 'string') { try { v = JSON.parse(v); } catch { return null; } }
    if (!v || typeof v !== 'object' || (!v.from && !v.way)) return null;
    return visTag(v.from, v.way, v.to);
}

export const isPrivate = message => { const v = visOf(message); return !!v && PRIVATE.has(v.way); };

/**
 * 这条消息 viewer 看不看得见。
 * message：{ speaker, name, is_user, extra: { rp_vis: { from, way, to? } } }；viewer：要看的人的名字（'user'／玩家名＝玩家，'旁白'／'narrator'＝旁白）；
 * userName：玩家的名字；same：可选的同名比较（关系表认同一个人的几张卡）。没说是谁在看（不是替某个角色生成）就照旧看得见。
 */
export function visibleTo({ message, viewer = null, userName = null, same = null } = {}) {
    const v = visOf(message);
    if (!v || !PRIVATE.has(v.way)) return true;
    if (viewer == null || viewer === '') return true;
    const eq = (a, b) => !!a && !!b && (a === b || norm(a) === norm(b) || (!!same && same(a, b)));
    if (PLAYER.has(viewer) || (userName && eq(viewer, userName))) return true;
    if (CAMERA.has(viewer)) return true;
    if (eq(viewer, v.from) || eq(viewer, v.to)) return true;
    // 这条就是他自己写的（署他的名）
    if (message && !message.is_user && (eq(viewer, message.name) || (!!message.speaker && viewer === message.speaker))) return true;
    return false;
}

// 给某人看的那份序列：筛掉他看不见的
export const visibleMessages = (messages, viewer, opts = {}) => (messages ?? []).filter(m => visibleTo({ message: m, viewer, ...opts }));
