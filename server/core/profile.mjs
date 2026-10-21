// 读卡写这个人的底子（D-109：生活感的来源；D-112、D-113：就地的活人感）。每张卡读一次，写成几段存起来（按卡存，各局共用；卡改了再读）。
// 兴头（看场面冒念头）、规划（各人自己想干的事）都靠它知道这个人喜欢什么、有什么往事会讲、嘴上什么样、怎么对人亲近；每轮把整张卡喂给模型太贵。
// 用户在名册里改过的那一局以改过的为准（store.setInterests）。

// 第 2 版多了往事、聊天、亲近三段；第 3 版放宽了回答的长度（会先"想"的模型想的字也算在上限里，3000 时一半的卡只写完第一段）。旧版读过的卡按存下的正文重读一遍（main.refreshProfiles）。
// 第 5 版多了"节奏"（用户 10/2：横向生长——迁就对方状态的人留下陪、聊、收拾，推着走的人催过一回也得让）。
export const PROFILE_V = 5;
export const profileHash = hash => `${hash}|v${PROFILE_V}`;
export const SECTIONS = ['兴趣和习惯', '往事', '聊天', '亲近', '节奏'];
const LIMITS = { 兴趣和习惯: 8, 往事: 5, 聊天: 3, 亲近: 3, 节奏: 2 };

export const PROFILE_SYSTEM = [
    '下面是一张角色扮演用的角色卡。给幕后写这个人的底子，分五段，每段几行，每行以"· "开头：',
    '【兴趣和习惯】〔当事人〕平时爱干什么；闲下来怎么放松；高兴、兴奋或者心烦的时候会想去哪、干点什么；常去的地方；会约谁、谁会来约〔当事人〕；〔当事人〕手上的门路和圈子——能给〔当事人〕带来什么邀约、消息、新鲜事。四到八行。',
    '【往事】〔当事人〕经历过、见过、会拿出来讲的事，三到五件，一件一行：什么事，大概什么时候、对谁会讲起。',
    '【聊天】爱聊什么，嘴上什么样；碰不得、一提就变脸的话题。一到三行。',
    '【亲近】〔当事人〕怎么对人好、怎么表达在乎；亲密的时候是主动还是等对方；吵完、难过、兴奋、生气的时候会不会拿亲近把事压下去、岔开。一到三行。',
    '【节奏】〔当事人〕对人的节奏：是迁就对方状态的人，还是按自己的节奏推着走的人；对方累了、不想动、不舒服时〔当事人〕会怎样（陪着、催一句就让、自己先去办、不管）。一到两行。',
    '只写卡里有的、或者从卡里能直接看出来的；卡里没写的那一段就只写"· （卡里没写）"，别编，别写剧情进度和外貌。',
].join('\n');

const MAX_CARD = 12000;

export function profilePrompt({ name, text }) {
    return `【角色】${name}\n【角色卡】\n${String(text ?? '').slice(0, MAX_CARD)}`;
}

const bullet = l => /^[·•\-*]\s*\S/.test(l);
const MISSING = /卡里[^。]*?(?:未|没)[^。]*?(?:写|提)/;
// 一行里"卡里没写……"的那截去掉（模型常在有内容的一行后面挂一句"卡里未写……"）；整行都是"卡里没写"就不要了。
function tidy(l) {
    let t = l.replace(/^[·•\-*]\s*/, '').trim();
    const i = t.search(MISSING);
    if (i < 0) return t;
    if (/^[（(].*[）)][。.]?$/.test(t)) return '';
    const head = t.slice(0, i);
    const cut = Math.max(...['；', ';', '（', '(', '，', ','].map(c => head.lastIndexOf(c)));
    t = (cut >= 0 ? head.slice(0, cut) : '').trim();
    if ((t.match(/（/g)?.length ?? 0) > (t.match(/）/g)?.length ?? 0)) t += '）';
    return t.length >= 4 ? t : '';
}

// 存下的那几段 → 各段的行（不带"· "）。没有段名的（旧版、用户自己写的）都算兴趣和习惯。
export function profileParts(text) {
    const out = Object.fromEntries(SECTIONS.map(s => [s, []]));
    let cur = '兴趣和习惯';
    for (const raw of String(text ?? '').split('\n')) {
        const l = raw.trim();
        const head = l.match(/^【([^】]+)】\s*(.*)$/);
        if (head) {
            cur = SECTIONS.find(s => head[1].includes(s)) ?? cur;
            const t = head[2] ? tidy(head[2]) : '';
            if (t) out[cur].push(t);
            continue;
        }
        const t = bullet(l) ? tidy(l) : '';
        if (t) out[cur].push(t);
    }
    return out;
}

// 模型回的四段：只留"· "开头的行，每段有上限；全是"卡里没写"算空。
export function parseProfile(text) {
    const parts = profileParts(text);
    const blocks = SECTIONS.map(s => ({ s, lines: parts[s].slice(0, LIMITS[s]).map(l => `· ${l.slice(0, 120)}`) })).filter(b => b.lines.length);
    if (!blocks.length) return null;
    // 只有一段兴趣和习惯时照旧不带段名（和第 1 版存的一样）
    if (blocks.length === 1 && blocks[0].s === '兴趣和习惯') return blocks[0].lines.join('\n').slice(0, 600);
    return blocks.map(b => `【${b.s}】\n${b.lines.join('\n')}`).join('\n').slice(0, 1500);
}

// 扩展那边算的卡指纹（卡的正文变了才重读）：简单的字符串散列，两边一致就行。
export function cardHash(text) {
    let h = 5381;
    const s = String(text ?? '');
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return `${s.length}:${(h >>> 0).toString(36)}`;
}
