import { personWord } from './pronoun.mjs';
// 情绪递进（用户 9/27，质量窗 Q-1）：后台材料带动了角色的情绪，后面几轮、几天要接得住，不是一轮演完或一轮就丢。
// 分工按谁看得见什么：
// - 前台每轮都带着最近的上文，他上一次怎么发的火、用户这句怎么接的都在眼前——"这一轮是接着、加重、松动还是转向"由前台当场定（cueLine）。
// - 前台只看得见已经写出来的那部分。只给过一次的材料（离开期间的推演、用户伸手接下的那件事……），没说出口的一层过了这一轮就没了，
//   所以由后台给他之后的开口留一份"余波"（carryLines）：材料在哪一格给的，那一格就记下余波，之后照着接。
// - 平常戏里出的事（吵了一架、被吓坏了），记账记成"改变"、持续几天或几周的，在那几天里也接着给（lingerLines）。
// 给多久、给多重由后台按剧情日定，不写给前台（给了"持续三天"，前台会数着演）；前台只看到内容。
// 旧事（recall）不留余波：它和眼下有关时每轮都会再给，不相关时刻意不给（旧事不轮轮重提）。
export const CARRY_TURNS = 3;    // "这场戏"：他之后这么多次开口以内
export const CARRY_SPAN = 16;    // 且隔着不超过这么多条、没换剧情日
import { scaleOf, relativeUnit } from './timescale.mjs';

const LINGER_DAYS = { 几天: 3, 几周: 14 };
const MAX_LINGER = 3;
const RECENT_WINDOW = 30;        // 最近这么多条里的事前台自己看得见（和 recall 同一个数）

// 每条余波带 keep（留多久）：'next'＝他紧接着的下一次开口；'scene'＝这场戏里（CARRY_TURNS 次开口、CARRY_SPAN 条以内、同一个剧情日）；
// 数字 n＝给到那一天之后第 n 个剧情日（这场戏里照常给；过了这场戏换成"平时压在底下，碰到才冒"的写法）。
// 老数据：fade＝next，没写的＝scene。about＝这是哪件事（过了这场戏以后用来点名）。from＝第几个剧情日起才给（"慢慢松"那一段）。
const keepOf = c => c.keep ?? (c.fade ? 'next' : 'scene');

// prior＝store.carryBefore 的结果（这个角色在这段上文之前的格子，新的在前，i＝第几次之前）；current＝这一格自己整段给了的（同一件不重复）。
// dayOf(pos)＝那条消息在第几个剧情日；没有就都算同一天。
export function carryLines(prior, opts) {
    const { near, later } = carryParts(prior, opts);
    return [...near, ...later];
}

// 分成两段：near＝这场戏里的（紧接着给材料那一格的两三次开口），later＝过了这场戏、碰到才冒的。
// 那一格超长让位时，near 和"回来那一段"一样不让（质量窗 9/29：旧事占了一千四百字，余波排在第 1 档被整段让掉，刚醒来那几轮他心里带着的一句都没到前台）。
// resolve(key)：这一项现在该怎么写（离开期间的推演按玩家说的改过了）；undefined＝照原来的，null＝改过后没了、不再给。
// cut(这一项)：给之前再过一道（她的身子她说了算，body.mjs：说她伤病的那一截切掉）；返回改过的这一项，null＝这回不给。
// tag(第几天, 今天)：那天怎么写（timeline.mjs timeTag，和这一格别处同一个说法）；没有就照"昨天、前天、几天前"。
export function carryParts(prior, { name, userName = '对方', now = Infinity, current = [], dayOf = null, resolve = null, timeScale = null, cut = null, tag = null }) {
    const skip = new Set(current.map(c => c.key));
    const seen = new Set();
    const near = [], later = new Map();
    const day = n => (dayOf ? dayOf(n - 0.5) : 0);   // 锚点 N＝那时有 N 条，最后一条是 N-1；离开记在那条之后半格
    const today = Number.isFinite(now) ? day(now) : 0;
    for (const slot of prior) {
        const i = slot.i ?? 0;
        const since = today - day(slot.n);
        const scene = i < CARRY_TURNS && now - slot.n <= CARRY_SPAN && since <= 0;
        for (let c of slot.carry ?? []) {
            const fresh = resolve?.(c?.key);
            if (fresh === null) continue;
            if (fresh !== undefined) c = { ...c, text: fresh };
            if (cut && c?.text) { c = cut(c); if (!c) continue; }
            if (!c?.text || skip.has(c.key) || seen.has(c.key)) continue;
            const keep = keepOf(c);
            if ((c.from ?? 0) > Math.max(since, 0)) continue;
            if (keep === 'next' ? i === 0 && scene : scene) { seen.add(c.key); near.push(c.text); continue; }
            if (typeof keep === 'number' && since <= keep) {
                seen.add(c.key);
                const k = c.about ?? '那件事';
                if (!later.has(k)) later.set(k, { since, items: [] });
                later.get(k).items.push(c.text);
            }
        }
    }
    const head = near.length ? [`${name}前几次开口时心里带着的、还没过去的（刚才已经说了、做了的不用再来一遍；剩下的看${userName}怎么接——接着、加重、松动、转向都行，可以慢慢出来，也可以一直压着不说）：`,
        ...near.map(t => `· ${t}`)] : [];
    const tail = [];
    for (const [about, { since, items }] of later) {
        tail.push(`${name}心里还挂着${about}${since > 0 ? `（${tag ? tag(today - since, today) : dayWord(since, timeScale)}的事）` : ''}：平时压在底下、不挂在嘴上，碰到了才冒出来；冒出来什么样、冒多少，照${personWord(name)}这个人：`, ...items.map(t => `· ${t}`));
    }
    return { near: head, later: tail };
}

const dayWord = (d, timeScale = null) => (timeScale && scaleOf(timeScale).unit !== '天' ? (d <= 0 ? '' : relativeUnit(d, timeScale)) : d <= 0 ? '' : d === 1 ? '昨天' : d === 2 ? '前天' : `${d} 天前`);
// 持续几天、几周的，按这一局的单位折（年尺度下"几周"不到一年：只在当年）
const lingerFor = (duration, timeScale) => { const ts = scaleOf(timeScale), d = LINGER_DAYS[duration]; return ts.unit === '天' ? d : Math.round(d / ts.days); };

// 平常戏里出的事：记账的"改变"里持续几天、几周的（受了惊吓、心里结了疙瘩、伤没好透……），在那几天里接着给，
// 只给他知道的、和他或用户有关的，已经滚出前台上文的；这一格已经当旧事给了的不重复。
export function lingerLines(records, { name, userName = null, dayOf, today, lastPos, skip = new Set(), timeScale = null, when = d => dayWord(d, timeScale) || scaleOf(timeScale).this + '早些时候' }) {
    const knows = r => r.holder_name === name || (r.audience ?? []).includes(name);
    const about = r => [name, userName].some(n => n && (r.holder_name === n || (r.about ?? '').includes(n) || String(r.text).includes(n)));
    const picked = records.filter(r => r.type === '改变' && LINGER_DAYS[r.duration] != null && knows(r) && about(r) && !skip.has(r.id)
        && r.pos < lastPos - RECENT_WINDOW && today - dayOf(r.pos) <= lingerFor(r.duration, timeScale))
        .sort((a, b) => b.pos - a.pos).slice(0, MAX_LINGER).sort((a, b) => a.pos - b.pos);
    if (!picked.length) return [];
    return [`${name}这几天心里、身上还没过去的（平时压在底下，碰到了才冒出来）：`, ...picked.map(r => `· ${when(today - dayOf(r.pos))}：${r.text}`)];
}

// 余波（方案"场记的分量与连续性"D 层）：记账记下的他心里留下的那股劲（型"余波"，只记给他自己；relation.weight 多重 1～3，relation.until 等到什么才过去）。
// 用户 10/14："要防止情绪没完没了且逐轮基于上一程度递增"——她说了难听的话，他记着，等到她宽慰才过去；她难过，他说话做事放轻，等到看见她高兴起来。
// 那条还在最近 recent 条里的不给：前台自己看得见那句话和他当时的反应，再递一遍等于加码，下一轮演得更重、记账再记更重的，就成了棘轮。
// 出了这个窗口、还没等到的才给，就这个分量带着；等到了（记账"改掉"那条，visible 不给被改掉的）就不在了。
// 没等到也有个头：轻的不给，明显的带三天，重的带一周（按这一局的单位折）。至多 AFTER_MAX 条：重的、近的先占，按先后排。tag(第几天, 今天)：日子的说法（timeTag）。
export const AFTER_MAX = 3;
const AFTER_DAYS = { 2: 3, 3: 7 };
export function afterLines(records, { name, dayOf = () => 0, today = 0, lastPos = 0, timeScale = null, tag = null, recent = RECENT_WINDOW }) {
    const ts = scaleOf(timeScale);
    const keep = w => (ts.unit === '天' ? AFTER_DAYS[w] : Math.round(AFTER_DAYS[w] / ts.days));
    const rows = records.filter(r => r.type === '余波' && r.holder_name === name && !r.superseded_by && r.pos < lastPos - recent)
        .map(r => ({ r, w: [1, 2, 3].includes(r.relation?.weight) ? r.relation.weight : 2, day: dayOf(r.pos) }))
        .filter(x => x.w > 1 && today - x.day <= keep(x.w));
    if (!rows.length) return [];
    const picked = rows.sort((a, b) => b.w - a.w || b.r.pos - a.r.pos).slice(0, AFTER_MAX).sort((a, b) => a.r.pos - b.r.pos);
    const when = x => (tag ? tag(x.day, today) : dayWord(today - x.day, timeScale) || ts.this + '早些时候');
    const until = x => (x.r.relation?.until ? `——等到${x.r.relation.until}才过去` : '');
    return [`${name}心里还没过去的（就这个分量带着，没有新的事不往上加；平时压在底下、不用每句都提，碰到了才冒出来；等到写着的那件事就过去了）：`,
        ...picked.map(x => `· ${when(x)}：${x.r.text}${until(x)}`)];
}

// 给前台的那一句口味（正着说：Gemini 对"别怎样"不太听）。用户还没说话（由他先开口）时不给。
export function cueLine({ name, userName = '对方', recentUser = '' }) {
    if (!String(recentUser).trim()) return null;
    return `（${name}此刻的心情从上一次开口接着来：没过去的还在；这一轮看${userName}这句话把它往哪儿带——接着、加重、松动、转向，或者生出新的，顺着来。）`;
}

// 用户伸手接下的那件事（口袋）：这回一次给全了，他紧接着的下一次开口心里还带着。
export function pocketCarry(m, { userName = '对方', speaker = null } = {}) {
    const know = m.know && (!speaker || m.who === speaker || m.who === '世界') ? m.know : null;   // 牵头的人知道的只给他自己（N-277）
    return { key: `pocket:${m.id}`, keep: 'next', text: `刚和${userName}说起「${m.title}」这件事（${personWord(speaker ?? m.who)}实际说了多少、怎么说的，以正文为准）：${m.respond}${know ? `（当时知道的、看到的：${know}）` : ''}` };
}
