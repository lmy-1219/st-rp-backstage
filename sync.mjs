// 浏览器侧的纯函数：认说话人、算消息指纹、分批。与后台 core/store.mjs 的 fingerprint 必须一致。
// 指纹用纯 JS 的 SHA-256：crypto.subtle 只在 https/localhost 下可用，远程经端口映射玩时是 http。

const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

export function sha256Hex(text) {
    const data = new TextEncoder().encode(text);
    const bitLength = data.length * 8;
    const padded = new Uint8Array(((data.length + 9 + 63) >> 6) << 6);
    padded.set(data);
    padded[data.length] = 0x80;
    const view = new DataView(padded.buffer);
    view.setUint32(padded.length - 8, Math.floor(bitLength / 0x100000000));
    view.setUint32(padded.length - 4, bitLength >>> 0);
    const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    const w = new Uint32Array(64);
    const rotr = (x, n) => (x >>> n) | (x << (32 - n));
    for (let offset = 0; offset < padded.length; offset += 64) {
        for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
        for (let i = 16; i < 64; i++) {
            const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
            const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
            w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
        }
        let [a, b, c, d, e, f, g, hh] = h;
        for (let i = 0; i < 64; i++) {
            const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
            const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
            hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
        }
        h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
    }
    return [...h].map(x => x.toString(16).padStart(8, '0')).join('');
}

export function fingerprint(isUser, speaker, text) {
    return sha256Hex(`${isUser ? 1 : 0}\u0001${speaker}\u0001${text}`).slice(0, 32);
}

// 用户在消息上点的剧情日期：day＝从这条起算新的一天｜same＝这里没有跨天｜d:N＝这条是第 N 天；后面可以带 @时段（10/3）
export const validDayMark = k => typeof k === 'string' && k !== '' && /^(?:day|same|d:\d{1,4})?(?:@(?:早上|上午|中午|下午|傍晚|晚上|深夜|凌晨))?$/.test(k);

// 镜头（N-276）：系统建的"旁白"卡只是让酒馆能生成的载体，它写的消息和 /sys 旁白一样记 narrator——后台不把它当人。
export const CAMERA_FLAG = 'rp_emergence_camera';
export const isCamera = ch => !!ch?.data?.extensions?.[CAMERA_FLAG];
// 只关原本开着的条目；保留不等于替用户打开原本关着的条目。
export function cameraPromptPlan(order, { keep = [], covered = [], hasPhi = false } = {}) {
    const allowed = new Set(['chatHistory', 'worldInfoBefore', 'worldInfoAfter', 'main', ...keep, ...covered]);
    if (hasPhi) allowed.add('jailbreak');
    return { disable: order.filter(e => e.enabled && !allowed.has(e.identifier)).map(e => e.identifier) };
}
// 全局世界书里可能有规则书（"演他""每个角色都优先抓自己关注的点"），那是给角色的，不该给旁白。
// ST 的选中列表照旧给角色那几轮用；这里只算出旁白那一轮要临时拿掉哪几本（用户取消勾的、而且当下选中的）。
export function cameraBookPlan(selected, books = []) {
    const remove = new Set((books ?? []).filter(b => b?.keep === false).map(b => String(b.name ?? '')));
    return (selected ?? []).filter(name => remove.has(String(name))).map(name => String(name));
}
let cameraAvatar = null;
export function setCamera(avatar) { cameraAvatar = avatar || null; }

// 谁说的：角色认卡文件名（两个同名角色也分得开），用户统一记 user，旁白记 narrator。
export function speakerOf(message, fallbackAvatar = null) {
    if (message.is_user) return 'user';
    if (message.extra?.type === 'narrator') return 'narrator';
    const avatar = message.original_avatar || fallbackAvatar;
    if (cameraAvatar && avatar === cameraAvatar) return 'narrator';
    return avatar || `name:${message.name ?? ''}`;
}

// 同一个消息对象没改过就不重算。
const cache = new WeakMap();
export function fingerprintMessage(message, speaker) {
    const text = String(message.mes ?? '');
    const hit = cache.get(message);
    if (hit && hit.text === text && hit.speaker === speaker && hit.isUser === !!message.is_user) return hit.fp;
    const fp = fingerprint(!!message.is_user, speaker, text);
    cache.set(message, { text, speaker, isUser: !!message.is_user, fp });
    return fp;
}

// 当前聊天 → 序列（每条的指纹）＋ 按指纹找正文的表。
export function buildSequence(chat, fallbackAvatar = null) {
    const seq = [];
    const bodies = new Map();
    // 末尾正在生成的那条（酒馆先放一条空的再往里写）不同步：它的指纹是"这个人的空消息"，人人一样，
    // 同步过去会被当成改稿，把好几条不相干的消息串成一条链（试玩 10/7：昨天的"此刻的样子"跑到了今天这条上）
    let end = chat.length;
    while (end > 0 && !chat[end - 1]?.is_user && !String(chat[end - 1]?.mes ?? '').trim()) end--;
    for (const message of chat.slice(0, end)) {
        const speaker = speakerOf(message, fallbackAvatar);
        const f = fingerprintMessage(message, speaker);
        const k = message.extra?.rp_day;   // 用户点的剧情日期：day＝从这条起算新的一天｜same＝这里没有跨天｜d:N＝这条是第 N 天
        const b = message.extra?.rp_board;
        // w：正在用的是第几版左滑（后台据此分清"改了这一条"和"左滑换了一版"，N-271）
        seq.push({ f, h: !!message.is_system, d: message.send_date == null ? null : String(message.send_date), w: Number.isInteger(message.swipe_id) ? message.swipe_id : 0, ...(validDayMark(k) ? { k } : {}), ...(b && typeof b === 'object' ? { b: JSON.stringify(b).slice(0, 4000) } : {}) });
        // l：生成这条时酒馆真触发的世界书（扩展记在 extra.rp_lore 上）
        const l = Array.isArray(message.extra?.rp_lore) ? message.extra.rp_lore.filter(k => typeof k === 'string') : [];
        // v：谁看得见（extra.rp_vis，发消息、打电话来的那条；visibility.mjs）
        const v = message.extra?.rp_vis && typeof message.extra.rp_vis === 'object' ? message.extra.rp_vis : null;
        if (!bodies.has(f)) bodies.set(f, { f, u: !!message.is_user, s: speaker, n: message.name ?? null, t: String(message.mes ?? ''), ...(l.length ? { l } : {}), ...(v ? { v } : {}) });
    }
    return { seq, bodies };
}

// 按大致字节数分批上传，避免单次请求太大。
export function batches(items, maxChars = 400_000) {
    const out = [];
    let current = [], size = 0;
    for (const item of items) {
        const n = item.t.length * 3 + 200;
        if (current.length && size + n > maxChars) { out.push(current); current = []; size = 0; }
        current.push(item); size += n;
    }
    if (current.length) out.push(current);
    return out;
}

// 只送最近几轮（质量窗 9/29，用户：每轮送进提示词的聊天固定为多少轮，让素材、召回、对话示例和系统提示压过历史消息）：
// ST 按上下文长度把历史塞满，塞不下的对话示例先被挤掉（实测 32k 里历史占了三十来轮、两万三千字，示例时有时无）。
// historyRounds＝N 时只留最后 N 个"用户开口"起的消息；0＝不管（默认）。在别的扩展（群聊隔离）裁完之后再裁（manifest 的 loading_order 排在它后面）。
export function keepRecentRounds(chat, rounds) {
    if (!(rounds > 0) || !Array.isArray(chat)) return 0;
    let seen = 0;
    for (let i = chat.length - 1; i >= 0; i--) {
        if (!chat[i]?.is_user || ++seen < rounds) continue;
        if (i > 0) chat.splice(0, i);
        return i;
    }
    return 0;
}

// ST 世界书按开口的角色筛（§5.4、N-252；后台 core/lore.mjs 判谁知道）：ST 加载条目时（WORLDINFO_ENTRIES_LOADED）
// 把开口的人不在名单里的条目拿掉（就地删，ST 接着用这几个数组）。后台还没判过的、内容改过的照留，收进 unknown 交给后台判。
// 名字对得上：一样，或者一个是另一个"·（"前面那截（和后台 sameLoreName 一样）。
const loreNorm = s => String(s ?? '').replace(/\s+/g, '').toLowerCase();
const loreHead = s => loreNorm(s).split(/[·（(]/)[0];
export const sameLoreName = (a, b) => !!a && !!b && (loreNorm(a) === loreNorm(b) || loreHead(a) === loreNorm(b) || loreNorm(a) === loreHead(b) || (!!loreHead(a) && loreHead(a) === loreHead(b)));
export function loreHash(text) {
    let h = 5381;
    const s = String(text ?? '');
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(16);
}
export function filterLore(lists, verdicts = {}, name = '') {
    const unknown = [];
    let removed = 0;
    for (const list of lists) {
        if (!Array.isArray(list)) continue;
        for (let i = list.length - 1; i >= 0; i--) {
            const e = list[i];
            if (!e || e.disable) continue;
            const key = `${e.world ?? ''}|${e.uid}`, hash = loreHash(e.content);
            const v = verdicts[key];
            if (!v || v.hash !== hash) { unknown.push({ key, hash, world: e.world ?? '', title: e.comment || (Array.isArray(e.key) ? e.key.join('、') : ''), text: String(e.content ?? '') }); continue; }
            if (name && !v.all && !(v.who ?? []).some(n => sameLoreName(n, name))) { list.splice(i, 1); removed++; }
        }
    }
    return { unknown, removed };
}

// 早些的回复换成大意（N-231）：哪几条要换——角色的回复里，最近 keep 条以外的（用户的话、系统消息、玩家第一次开口前的开场白不换）。返回下标，从后往前。
export function olderReplies(chat, keep = 8) {
    const out = [];
    let seen = 0;
    const k = Math.max(2, Number(keep) || 8);
    const opening = (chat ?? []).findIndex(m => m?.is_user);
    for (let i = (chat?.length ?? 0) - 1; i > Math.max(-1, opening); i--) {
        const m = chat[i];
        if (!m || m.is_user || m.is_system) continue;
        if (++seen > k) out.push(i);
    }
    return out;
}

// 后台那一格的几块放哪（D-116，用户 9/29：想在面板和 ST 的提示词管理里自己调位置）：
// 当前预设里有对应条目的（条目内容里写着 {{rpe_底子}} 这类宏、条目开着），交给宏，位置由预设定——用户在 ST 的提示词管理里拖拽、改深度；
// 预设里没有的，按面板设的位置用扩展提示放（places：各块插在倒数第几条之前；不设就用后台给的默认）。
// 返回 live（宏此刻的值）和 puts（要用扩展提示放的：[键, 文字, 位置 0＝跟在主提示词后面／1＝插进聊天, 深度]）。
// 用户 10/5（照 ST 文档：影响角色怎么做的写在角色定义之后，单纯的背景写在之前；记忆插在聊天记录之前）：
// 背景（world）跟在主提示词后面；想起的（recall）不再插进聊天里——后台没明说深度（depths.recall 是负数或没给）就放在聊天记录之前。
// 预设里没有条目时，ST 只能把"不插进聊天"的放在主提示词后面；要挪到角色定义之后、聊天记录之前，得把这几块加进预设。
export const SLOT_MACROS = ['rule', 'world', 'base', 'mid', 'recall', 'now'];
export function planPlacement({ rule = '', text = '', parts = null, covered = new Set(), places = {}, depths = {} }) {
    const live = Object.fromEntries(SLOT_MACROS.map(k => [k, '']));
    const puts = [];
    const depth = (k, def) => (Number.isInteger(places[k]) && places[k] >= 0 ? places[k] : Number.isInteger(depths[k]) && depths[k] >= 0 ? depths[k] : def);
    if (covered.has('rule')) live.rule = rule;
    if (!parts) {
        if (!covered.has('rule') && rule) puts.push(['rule', rule, 0, 0]);
        if (covered.has('now')) live.now = text; else if (text) puts.push(['slot', text, 1, depth('now', 0)]);
        return { live, puts };
    }
    if (covered.has('world')) live.world = parts.world ?? ''; else if (parts.world) puts.push(['world', parts.world, 0, 0]);
    if (covered.has('base')) live.base = parts.base ?? '';
    const head = [covered.has('rule') ? '' : rule, covered.has('base') ? '' : parts.base].filter(Boolean).join('\n');
    if (head) puts.push(['rule', head, 0, 0]);
    const inChat = Number.isInteger(depths.recall) && depths.recall >= 0;
    if (covered.has('recall')) live.recall = parts.recall ?? '';
    else if (parts.recall) puts.push(inChat ? ['recall', parts.recall, 1, depths.recall] : ['recall', parts.recall, 0, 0]);
    for (const [k, key, def] of [['mid', 'mid', 4], ['now', 'slot', 4]]) {
        if (covered.has(k)) live[k] = parts[k] ?? '';
        else if (parts[k]) puts.push([key, parts[k], 1, depth(k, def)]);
    }
    return { live, puts };
}

// 旁白那段的叙述（括号里）用了"我"——写成了某个人的口吻（D-169，试玩 10/6）。引号里是没卡的人开口说的话，不算。
export function narratorSaysI(text) {
    const t = String(text ?? '').replace(/"[^"]*"|“[^”]*”|「[^」]*」|『[^』]*』/g, '');
    return (t.match(/（[^）]*）|\([^)]*\)/g) ?? []).some(x => x.includes('我'));
}
// 旁白这一段末尾写到他了没有（D-169：要他露面时要求点名；没点名就不问玩家让不让他进场）。名字可以是卡名里的一截（"甲乙"里的"甲"）
export function namedIn(text, names = []) {
    const tail = String(text ?? '').slice(-300);
    const parts = [...new Set(names.flatMap(n => [n, ...String(n ?? '').split(/[\s·・.]+/)]).filter(n => n && n.length >= 2))];
    return parts.some(n => tail.includes(n));
}

const DOOR_MARK = /[（(]\s*该来\s*[:：]\s*([^()（）\r\n/／]+?)\s*(?:[/／]\s*(去找他|他过来|消息|电话)\s*)?[）)]/g;
export function doorMark(text) {
    const s = String(text ?? '');
    const all = [...s.matchAll(DOOR_MARK)];
    if (!all.length) return { who: null, way: null, text: s };
    const hit = all.at(-1);
    return { who: hit[1].trim(), way: hit[2] ?? null, text: s.replace(DOOR_MARK, '').replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trimEnd() };
}

// 谁看得见（和后台 core/visibility.mjs 一个判法）：发消息、打电话来的那条（extra.rp_vis.way 消息／电话）只有本人、玩家、旁白、发给的那人看得见；
// 上门的、没带记号的谁都看得见。viewer：要看的人的名字（旁白传 '旁白'）；userName：玩家的名字
export function visibleTo(message, viewer, userName = null) {
    const v = message?.extra?.rp_vis;
    if (!v || typeof v !== 'object' || !/消息|电话|短讯|短信|信息|来电|通话|语音/.test(String(v.way ?? ''))) return true;
    if (!viewer) return true;
    const norm = s => String(s ?? '').replace(/\s+/g, '').toLowerCase();
    const eq = (a, b) => !!a && !!b && norm(a) === norm(b);
    if (viewer === 'user' || viewer === '旁白' || viewer === 'narrator' || (userName && eq(viewer, userName))) return true;
    if (eq(viewer, v.from) || eq(viewer, v.to)) return true;
    return !message.is_user && eq(viewer, message.name);
}
// 发出去的那份聊天按开口的人筛（就地改数组：ST 拿的就是这个数组）；返回拿掉了几条
export function filterVisible(chat, viewer, userName = null) {
    if (!Array.isArray(chat) || !viewer) return 0;
    let n = 0;
    for (let i = chat.length - 1; i >= 0; i--) if (!visibleTo(chat[i], viewer, userName)) { chat.splice(i, 1); n++; }
    return n;
}
// 叩门候着的那一个（方案 自动进离场与调度 第二节第 3 条）：接／让他进来／不理，不替玩家写字
export function knockHtml(waiting, escape = s => String(s ?? '')) {
    if (!waiting?.who) return '';
    const way = waiting.way === '电话' ? '打来电话' : waiting.way === '上门' ? '在门口' : '发来消息';
    const yes = waiting.way === '上门' ? `让${escape(waiting.who)}进来` : `接${escape(waiting.who)}的${waiting.way === '电话' ? '电话' : '消息'}`;
    const b = (answer, text) => `<button type="button" class="menu_button rpe-knock-answer" data-who="${escape(waiting.who)}" data-answer="${answer}">${text}</button>`;
    return `<div class="rpe-door-title">${escape(waiting.who)}${way}，候着</div><div class="rpe-door-list"><div class="rpe-door-item rpe-door-lit"><span class="rpe-door-who">你回不回都行；打字回${escape(waiting.who)}也算</span>${b('接', yes)}${b('不理', '不理')}</div></div>`;
}

// solo：单聊（T070）——单聊进不了场，不画进场按钮，每项后面写一句怎么让他进场
export function doorHtml(items = [], lit = null, escape = s => String(s ?? ''), { solo = false } = {}) {
    if (!items.length) return '';
    const reason = { narrator: '旁白觉得该来了', named: `旁白写到了${lit?.who ?? ''}`, program: '到时候了' };
    const ordered = [...items].sort((a, b) => Number(lit?.who === b.who) - Number(lit?.who === a.who));
    const blocks = ordered.map(item => {
        const isLit = lit?.who === item.who;
        const labels = { '去找他': `你去找${item.who}`, '他过来': `让${item.who}过来`, 消息: `${item.who}发消息`, 电话: `${item.who}打电话` };
        const ways = solo
            ? `<span class="rpe-door-reason">要让${escape(item.who)}进场：把这个聊天转成群聊、把${escape(item.who)}拉进群</span>`
            : (item.ways ?? []).map(way => `<button type="button" class="menu_button rpe-door-way" data-who="${escape(item.who)}" data-avatar="${escape(item.avatar ?? '')}" data-way="${escape(way)}">${escape(labels[way] ?? way)}</button>`).join('');
        return `<div class="rpe-door-item${isLit ? ' rpe-door-lit' : ''}"><span class="rpe-door-who" title="${escape(item.label ?? '')}">${escape(item.who)} · ${escape(item.label ?? '')}</span>${ways}<button type="button" class="menu_button rpe-door-cancel" data-who="${escape(item.who)}">×</button></div>`;
    }).join('');
    const note = lit ? `<span class="rpe-door-reason">${escape(reason[lit.by] ?? '')}</span>` : '';
    return `<div class="rpe-door-title">外头的人${note}</div><div class="rpe-door-list">${blocks}</div>`;
}

// 群成员名单比较：玩家在群面板里直接把卡移出群（不是静音）时，后台的在场区间不会自己关。
// 上一次看到的名单里有、这次没有的，就是被移走的；旁白（镜头）卡不算人；没有上一次名单（刚打开、刚换聊天）不触发。
// prev / now：成员的 avatar 列表；返回被移走的 avatar（去重，保持原顺序）
export function removedMembers(prev, now, { camera = null } = {}) {
    if (!Array.isArray(prev) || !Array.isArray(now)) return [];
    const still = new Set(now);
    return [...new Set(prev)].filter(a => a && a !== camera && !still.has(a));
}

// 有卡的人在场时旁白要不要问后台一次（场记章程 #7、B4）：玩家最近那句之后已经有人答了、还没有旁白答过，
// 返回那句的位置和记号（同一句只问一次：done 是上次问过的那个记号）；玩家那句还没人答、旁白已经接过、问过了，返回 null。
// chat：ST 的消息数组；speaker：认谁说的（扩展传 speakerOf 带上兜底的卡）
export function cameraJoinPoint(chat, { speaker = m => speakerOf(m), done = null } = {}) {
    if (!Array.isArray(chat) || !chat.length) return null;
    let at = -1;
    for (let i = chat.length - 1; i >= 0; i--) if (chat[i]?.is_user) { at = i; break; }
    if (at < 0) return null;
    const after = chat.slice(at + 1).filter(Boolean);
    if (after.some(m => speaker(m) === 'narrator') || !after.some(m => !m.is_system)) return null;
    const key = `${at}:${fingerprintMessage(chat[at], 'user')}`;
    return key === done ? null : { at, key };

}

// 玩家在群面板里直接把卡拉进群（场记章程 B1）：和上一次看到的名单比，多了的就是新拉进来的，走一遍进场（和点门一样）。
// 旁白（镜头）卡不算人；skip：扩展自己正在拉进来的（enterChar 已经在走进场）；没有上一次名单（刚打开、刚换聊天）不触发。
// prev / now：成员的 avatar 列表；返回新拉进来的 avatar（去重，保持原顺序）
export function addedMembers(prev, now, { camera = null, skip = [] } = {}) {
    if (!Array.isArray(prev) || !Array.isArray(now)) return [];
    const had = new Set(prev), mine = new Set(skip ?? []);
    return [...new Set(now)].filter(a => a && a !== camera && !had.has(a) && !mine.has(a));
}

// 手动拉进群的人按门上他那一项的方式进场：那一项只给消息、电话（他是发消息、打电话来的），就按那种远程进；
// 门上没有他、或者能上门的，就当他过来了
export function arriveOpts(item) {
    const ways = Array.isArray(item?.ways) ? item.ways : [];
    return ways.length && ways.every(w => w === '消息' || w === '电话') ? { mode: 'remote', way: ways[0] } : { mode: 'come' };
}
// 玩家手动取消静音（T070 三）：上一次和这一次都在群里、上一次静音着、这一次没静音的。旁白卡、扩展自己正在取消的（skip）不算；
// 换了群／窗口（key 不同）、上一次没记静音名单的不触发
export function unmutedMembers(prev, now, { camera = null, skip = [] } = {}) {
    if (!prev || !now || prev.key !== now.key || !Array.isArray(prev.disabled) || !Array.isArray(now.disabled) || !Array.isArray(prev.members) || !Array.isArray(now.members)) return [];
    const off = new Set(now.disabled), was = new Set(prev.members), mine = new Set(skip ?? []);
    return [...new Set(prev.disabled)].filter(a => a && a !== camera && was.has(a) && now.members.includes(a) && !off.has(a) && !mine.has(a));
}

// 玩家的人设（用户 10/12，N-368；数据约定第 1 条）：规划得知道玩家的角色是什么脾气、喜欢什么，才写得出身边的人怎么冲着她使心思。
// c：ST 的 getContext()——name1 是眼下的人设名，powerUserSettings.persona_description 是眼下这个人设的描述（ST 切人设时就换掉它）。
// 描述里的 {{user}} 换成人设名。名字或描述拿不到就不发（null）；key 用来比"跟上次发的一样不一样"，一样就不再发
export function personaPayload(c, chatKey) {
    if (!chatKey) return null;
    const name = String(c?.name1 ?? '').trim().slice(0, 200);
    const raw = c?.powerUserSettings?.persona_description;
    if (!name) return null;
    const text = (typeof raw === 'string' ? raw : '').replace(/\{\{user\}\}/gi, name).trim().slice(0, 4000);
    return { body: { chatKey, name, text }, key: `${chatKey}\n${name}\n${text}` };
}

// 旧酒馆没有 PERSONA_CHANGED：只读名字，事件和三秒检查共用一份基线。
export function createPersonaWatch({ current, onChange, setTimer = setTimeout, clearTimer = clearTimeout }) {
    let key = null, name = null, timer = null;
    const check = () => {
        clearTimer(timer); timer = null;
        const next = current();
        if (!next?.key) { key = null; name = null; return; }
        const changed = key === next.key && name != null && next.name && name !== next.name;
        const previous = name; key = next.key; name = next.name;
        if (changed) onChange(previous, name);
        timer = setTimer(check, 3000);
    };
    return { check, pause() { clearTimer(timer); timer = null; }, reset() { clearTimer(timer); timer = null; key = null; name = null; } };
}

// 后台未明确回答关闭时，不显示旧门。solo（单聊，T070）：自动进离场开没开都画门（不带进场按钮），单聊里不叩门
export function autoDoorHtml({on=null,unavailable=false,buttons=true,waiting=null,items=[],lit=null,solo=false},escape) {
    if(solo) return doorHtml(items,lit,escape,{solo:true});
    if(unavailable) return '<div style="color:gray">后台连不上，进离场先停着</div>';
    if(on===null) return '';
    return on ? (buttons ? knockHtml(waiting,escape) : '') : doorHtml(items,lit,escape);
}
// 单聊门上的提示（T070）：同一窗口同一人同一件事只弹一次。件＝source.type:source.id，没有就用 label
export function doorNoticeKey(item) {
    const s = item?.source;
    return `${item?.avatar || item?.who || ''}|${s?.type != null && s?.id != null ? `${s.type}:${s.id}` : `label:${item?.label ?? ''}`}`;
}
// 门上到时候了（ready）、还没弹过的：返回要弹的那几项（同一件只出一次），seen 是已经弹过的键
export function freshDoorNotices(items = [], seen = []) {
    const done = new Set(Array.isArray(seen) ? seen : []), out = [];
    for (const item of Array.isArray(items) ? items : []) {
        if (!item?.ready || !item.who) continue;
        const key = doorNoticeKey(item);
        if (done.has(key)) continue;
        done.add(key); out.push({ item, key });
    }
    return out;
}
export function soloDoorToast(item) {
    const who = item.who;
    return `${who}该来了（${item.label ?? ''}）。单聊里拉不进来：要${who}进场，把这个聊天转成群聊、把${who}拉进群；不管${who}也行，${who}就一直在门上等着。`;
}
// ---------- 拉人进群按场面判（T070 二） ----------
// 攒一批：玩家在群面板连着点好几个人，ST 每点一次发一次 GROUP_UPDATED；最后一次加进来 wait 毫秒内没再加才一起处理。
// key 变了（换了窗口、换了群）就把攒着的那批作废、从新的重攒；同一个人只记第一次（count 是他进来那一刻的条数）
export function createArrivalBatcher({ wait, run, setTimer = setTimeout, clearTimer = clearTimeout }) {
    let key = null, items = [], timer = null;
    const drop = () => { clearTimer(timer); timer = null; key = null; items = []; };
    return {
        add(k, item) {
            if (key !== k) drop();
            key = k;
            if (!items.some(x => x.avatar === item.avatar)) items.push(item);
            clearTimer(timer);
            timer = setTimer(() => { const at = key, list = items; drop(); if (list.length) run(at, list); }, wait);
        },
        cancel: drop,
        size: () => items.length,
    };
}
// 隔离扩展自己监听 GROUP_UPDATED，拉进来那一刻就给新人开了一段区间（from＝当时条数）。先把这一段就地封成零长度（to＝from），
// 后台问场面时才不会因为这段开着判他在场。条件从严，任何一条不满足就不封（返回 why，调用方照现状进场）：
// 属于这批新人、是最后一段、to 为空、from 等于入队时条数、前面没有别的开着的段。写法照 closeIsolationAt；只改内存，写盘和核实由调用方做
export function sealArrival(c, { avatar, count, batch = [] }) {
    if (!batch.includes(avatar)) return { ok: false, why: '不在这批新人里' };
    const segs = c?.chatMetadata?.contextIsolation?.anchors?.[avatar]?.segments;
    if (!Array.isArray(segs) || !segs.length) return { ok: false, why: '没有区间记录' };
    const last = segs.at(-1);
    if (!last || typeof last !== 'object' || last.to != null) return { ok: false, why: '最后一段不是开着的' };
    if (segs.slice(0, -1).some(s => s?.to == null)) return { ok: false, why: '有不止一段开着' };
    if (!Number.isInteger(last.from) || last.from !== count) return { ok: false, why: `区间起点 ${last.from} 不是拉进来那一刻的 ${count}` };
    const before = { to: last.to, toDate: last.toDate };
    last.to = last.from;
    last.toDate = last.from > 0 ? String(c.chat?.[last.from - 1]?.send_date ?? '') : '';
    return { ok: true, before, sealed: { from: last.from, to: last.to, toDate: last.toDate } };
}
// 读回核实：最后一段就是封上的那段
export function sealedHolds(c, { avatar, sealed }) {
    const last = c?.chatMetadata?.contextIsolation?.anchors?.[avatar]?.segments?.at?.(-1);
    return !!last && last.from === sealed.from && last.to === sealed.to && last.toDate === sealed.toDate;
}
// 之后 sync／board 失败：最后一段还是封上的那段才还原（to/toDate 回到封之前的空值），别的不碰
export function unsealArrival(c, { avatar, sealed, before }) {
    if (!sealedHolds(c, { avatar, sealed })) return false;
    const last = c.chatMetadata.contextIsolation.anchors[avatar].segments.at(-1);
    last.to = before?.to ?? null; last.toDate = before?.toDate ?? '';
    return true;
}
// 分拣：场面明确说他在这儿（present）或在联系（remote）的进场，其余（away／absent／never、场面里没这个人）静音。
// board 没答上来返回 null（调用方照现状全进场）。认人照扩展里问 board 的现有写法：头像先认，没对上再认名字。
// since 早于他被拉进来那一刻（场面本来就记他在场）才带上：隔离区间从那条开起
export function sortArrivals(people = [], board) {
    const rows = Array.isArray(board?.people) ? board.people : null;
    if (!rows) return null;
    const enter = [], mute = [];
    for (const p of people) {
        const row = rows.find(x => x?.avatar && x.avatar === p.avatar) ?? rows.find(x => x?.name && x.name === p.name) ?? null;
        if (row && (row.status === 'present' || row.status === 'remote')) {
            const since = Number.isInteger(row.since) && row.since >= 0 && row.since < p.count ? row.since : null;
            enter.push({ ...p, status: row.status, since, way: row.way ?? null });
        } else mute.push({ ...p, status: row?.status ?? null });
    }
    return { enter, mute };
}
// 进场那一行（拉进群判在场、手动取消静音共用）。from：他这一段从第几条起（隔离扩展记的，零起算＝之前有几条）；
// since：从场面记的那条开起；earlier：之前进过场（看得见以前在场那几段）；from 拿不到（没装隔离扩展）就只说从这条起
export function arrivalLine({ who, from = null, since = null, earlier = false, how = null }) {
    const by = how ? `（${who}是${how}来的）` : '';
    if (!Number.isInteger(from)) return `${who}已进场${by}：从这条起${who}在场。`;
    if (earlier) return `${who}已进场${by}：从第${from}条起${who}在场，${who}不在场那阵子的事${who}没听见。`;
    if (since != null) return `${who}已进场${by}：第${from}条之前的${from}条消息${who}看不见。`;
    return `${who}已进场${by}：此前${from}条消息${who}看不见。`;
}
// 合并成一条提示的几行：先谁被拉进来、谁不在场被静音，再在场的一人一行。全在场不写"其中…"，全不在场不写进场那几行
export function arrivalToastLines({ all = [], entered = [], muted = [] }) {
    const lines = [];
    if (all.length) lines.push(`当前已拉入：${all.join('、')}。${muted.length ? `其中${muted.join('、')}判定为不在场，看不到当前对话消息，已静音。如果现在需要不在场的角色进场，直接关闭那个角色的静音即可。` : ''}`);
    for (const e of entered) lines.push(arrivalLine(e));
    if (entered.length) lines.push('要谁说话就点谁。');
    return lines;
}
export function autoTurnEnabled(reply) { return reply?.enabled===true && reply.turnEnabled!==false; }
// close / mute 必须验证实际状态；确认失败时也允许再次执行这两个幂等步骤。
export async function applyLeaveEvent(event,{close,mute,reopen,unmute,ack}) {
    if(event.action==='undo') { await reopen(); await unmute(); }
    else { await close(); await mute(); }
    if(event.id) await ack({id:event.id,version:event.version,action:event.action});
}


// 只认明确声明零起算、包含来源条的命令说明；识别过程不调用命令。
export function isolateLeaveSupportsIndex(command) {
    return typeof command?.helpString==='string'
        && /\/isolate-leave\s+名字\s+\d+/.test(command.helpString)
        && command.helpString.includes('包含') && command.helpString.includes('零起算');
}
// 原版扩展每次从 chatMetadata 取 anchors，没有另一份区间缓存。
export async function closeIsolationAt(c,{avatar,name,at}) {
    if(!Array.isArray(c.chat)||!Number.isInteger(at)||at<0||at>=c.chat.length) throw Error('来源条号无效');
    const object=v=>v && typeof v==='object' && !Array.isArray(v);
    const meta=c.chatMetadata;
    if(!object(meta)) throw Error('聊天元数据不可用');
    if(meta.contextIsolation!=null && !object(meta.contextIsolation)) throw Error('隔离元数据格式不符');
    const isolation=meta.contextIsolation??={};
    if(isolation.anchors!=null && !object(isolation.anchors)) throw Error('隔离名册格式不符');
    const anchors=isolation.anchors??={};
    if(anchors[avatar]!=null && !object(anchors[avatar])) throw Error('角色隔离记录格式不符');
    const rec=anchors[avatar]??={name,segments:[],brief:''};
    if(!Array.isArray(rec.segments) || !rec.segments.every(s=>object(s)&&Number.isInteger(s.from)&&s.from>=0&&(s.to==null||Number.isInteger(s.to)))) throw Error('隔离区间格式不符');
    const end=at+1,date=String(c.chat[at]?.send_date??'');
    const open=rec.segments.filter(s=>s.to==null);
    if(open.length>1) throw Error('存在多个开放区间');
    if(!open.length && rec.segments.some(s=>s.to===end&&s.toDate===date)) {
        await c.saveMetadata(); // 上次保存失败也必须重试写盘，不能只确认内存。
    } else {
        const seg=open[0];
        if(seg && seg.from>=end) throw Error('来源早于当前进场区间');
        if(!seg && rec.segments.length) throw Error('当前没有开放的隔离区间');
        if(seg) {seg.to=end;seg.toDate=date;}
        else rec.segments.push({from:0,fromDate:'',to:end,toDate:date});
        await c.saveMetadata();
    }
    const saved=c.chatMetadata?.contextIsolation?.anchors?.[avatar]?.segments;
    if(!Array.isArray(saved)||saved.some(s=>s.to==null)||!saved.some(s=>s.to===end&&s.toDate===date)) throw Error('隔离区间保存后核实失败');
}
export async function runLeaveAttempt({failures,key,event,attempt,save}) {
    const version=`${event.version??0}:${event.action??'leave'}`;
    if(failures[key]?.version===version && failures[key].count>=3) return false;
    const previous=failures[key];
    try {
        await attempt();delete failures[key];await save();return true;
    } catch(error) {
        const reason=String(error?.message??error).slice(0,300);
        failures[key]={who:event.who,version,reason,count:previous?.version===version&&previous.reason===reason?previous.count+1:1};
        await save();throw error;
    }
}
export function resetLeaveAttempt(failures,key) { delete failures[key]; }
export function leaveRetryView(failures={},escape=s=>String(s??'')) {
    const blocked=Object.entries(failures).filter(([,r])=>r?.count>=3);
    return {
        message:blocked.map(([,r])=>`${r.who}离场没落实：${r.reason}`).join('；'),
        html:blocked.map(([key,r])=>`<button type="button" class="menu_button rpe-leave-retry" data-leave-key="${escape(key)}">${escape(r.who)}：再试</button>`).join('')
    };
}
