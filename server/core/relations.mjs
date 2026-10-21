import { personWord } from './pronoun.mjs';
// 人物关系表（按局存，用户可在面板里看、改）：每个人现在是谁、地盘和本事、和谁什么关系、故事开始时知道什么、
// 外人眼里是什么样、跟着谁（不单独出现的人）、什么时候才会来；另有全局的"公开的""备注""不在了"。
// 规划者读全表：别让中间人派地盘外的活、跟着别人的人一起排、别让人在露面时知道他那时还不该知道的事。
// 前台只拿当前发言那个人的几行：他的地盘；他和在场的人的关系；他第一次出场时，故事开始时他知道的、眼前的人在他眼里的样子。
// ⛔ "开局不知道"只给规划者，不给前台：写给前台，前台就会让他说出来（实测：卡里写"不知道那副身体花了多少钱"，角色开口就报了价）。
import { sameName, crewOf } from './setup.mjs';
import { scaleOf } from './timescale.mjs';
import { paceOf } from './tempo.mjs';

// 本事：他能给到什么、给得多准多细（中间人的情报和后勤分三六九等，用户 9/30）；身价：卖家眼里他是哪一档（对上价表的身价，见 pricing.standingOf）
const TEXT_FIELDS = ['现在', '地盘', '本事', '身价', '跟着', '何时来', '外人眼里', '能用', '出处'];
const INLINE_LISTS = ['又名', '管辖', '派活'];   // 一行写完、用顿号隔开的：别名；管哪几片；派哪几档的活（档名照价表里活儿的档次）
const LIST_FIELDS = ['关系', '开局知道', '开局不知道', '待核'];
const TOP_LISTS = { 公开: '（谁都知道的）', 备注: '', 不在了: '（规划不排）' };

const split = s => String(s ?? '').split(/[、,，;；]/).map(x => x.trim()).filter(Boolean);
const clean = s => String(s ?? '').trim();

export function emptyRelations() {
    return { 说明: '', 公开: [], 备注: [], 不在了: [], 人: [] };
}

// 规整：缺的格补空，关系写成 {对, 是}。
export function normalizeRelations(raw) {
    const d = { ...emptyRelations(), ...(raw ?? {}) };
    d.说明 = clean(d.说明);
    for (const k of Object.keys(TOP_LISTS)) d[k] = (Array.isArray(d[k]) ? d[k] : []).map(clean).filter(Boolean);
    d.人 = (Array.isArray(d.人) ? d.人 : []).filter(p => clean(p?.名)).map(p => {
        const out = { 名: clean(p.名) };
        for (const f of INLINE_LISTS) out[f] = Array.isArray(p[f]) ? p[f].map(clean).filter(Boolean) : split(p[f]);
        for (const f of TEXT_FIELDS) out[f] = clean(p[f]);
        out.关系 = (Array.isArray(p.关系) ? p.关系 : []).map(r => (typeof r === 'string' ? splitRelation(r) : { 对: clean(r?.对), 是: clean(r?.是) })).filter(r => r.对 && r.是);
        for (const f of LIST_FIELDS.slice(1)) out[f] = (Array.isArray(p[f]) ? p[f] : []).map(clean).filter(Boolean);
        return out;
    });
    return d;
}

function splitRelation(line) {
    const i = line.search(/[：:]/);
    return i > 0 ? { 对: clean(line.slice(0, i)).replace(/^对\s*/, ''), 是: clean(line.slice(i + 1)) } : { 对: '', 是: clean(line) };
}

// ---------- 文字版（面板里看、改都用这个） ----------

export function toText(data) {
    const d = normalizeRelations(data);
    const out = [`【说明】${d.说明}`];
    for (const [k, note] of Object.entries(TOP_LISTS)) out.push(`【${k}】${note}`, ...d[k].map(x => `· ${x}`));
    out.push('【人】');
    for (const p of d.人) {
        out.push('', `## ${p.名}`);
        if (p.又名.length) out.push(`又名：${p.又名.join('、')}`);
        for (const f of ['现在', '地盘', '本事']) if (p[f]) out.push(`${f}：${p[f]}`);
        for (const f of ['管辖', '派活']) if (p[f].length) out.push(`${f}：${p[f].join('、')}`);
        if (p.身价) out.push(`身价：${p.身价}`);
        for (const f of ['跟着', '外人眼里', '何时来']) if (p[f]) out.push(`${f}：${p[f]}`);
        if (p.关系.length) out.push('关系：', ...p.关系.map(r => `· ${r.对}：${r.是}`));
        for (const f of ['开局知道', '开局不知道']) if (p[f].length) out.push(`${f}：`, ...p[f].map(x => `· ${x}`));
        for (const f of ['出处', '能用']) if (p[f]) out.push(`${f}：${p[f]}`);
        if (p.待核.length) out.push('待核：', ...p.待核.map(x => `· ${x}`));
    }
    return out.join('\n') + '\n';
}

// 读回来：认"【段名】"、"## 人名"、"键：值"、"键："下面跟"· "开头的条目；认不出的行接到上一格后面。
export function fromText(text) {
    const d = emptyRelations();
    let top = null, person = null, list = null, field = null;
    for (const raw of String(text ?? '').split(/\r?\n/)) {
        const line = raw.trim();
        if (!line) continue;
        const head = line.match(/^【([^】]+)】\s*(.*)$/);
        if (head) {
            person = null; list = null; field = null;
            top = head[1];
            if (top === '说明') { d.说明 = head[2].trim(); field = { obj: d, key: '说明' }; }
            continue;
        }
        const name = line.match(/^##\s*(.+)$/);
        if (name) {
            person = { 名: name[1].trim(), 又名: [], 管辖: [], 派活: [], 关系: [], 开局知道: [], 开局不知道: [], 待核: [] };
            d.人.push(person); top = '人'; list = null; field = null;
            continue;
        }
        const item = line.match(/^[·•\-*]\s*(.+)$/);
        if (item) {
            if (person && list) person[list].push(list === '关系' ? splitRelation(item[1]) : item[1].trim());
            else if (!person && top in TOP_LISTS) d[top].push(item[1].trim());
            field = null;
            continue;
        }
        const kv = person && line.match(/^([^：:]{1,6})[：:]\s*(.*)$/);
        if (kv && (INLINE_LISTS.includes(kv[1]) || TEXT_FIELDS.includes(kv[1]) || LIST_FIELDS.includes(kv[1]))) {
            if (INLINE_LISTS.includes(kv[1])) { person[kv[1]] = split(kv[2]); list = null; field = null; }
            else if (LIST_FIELDS.includes(kv[1])) { list = kv[1]; field = null; if (kv[2].trim()) person[list].push(list === '关系' ? splitRelation(kv[2]) : kv[2].trim()); }
            else { person[kv[1]] = kv[2].trim(); field = { obj: person, key: kv[1] }; list = null; }
            continue;
        }
        if (field) field.obj[field.key] = `${field.obj[field.key]}${field.obj[field.key] ? ' ' : ''}${line}`;
    }
    return normalizeRelations(d);
}

// ---------- 查人 ----------

const NORM = new Map();   // 10/16 提速：归一化缓存
const norm = s => { const k = String(s ?? ''); let v = NORM.get(k); if (v === undefined) { v = k.replace(/\s+/g, '').toLowerCase(); if (NORM.size > 20000) NORM.clear(); NORM.set(k, v); } return v; };
export function isPerson(p, name, roster = []) {
    return !!name && (sameName(p.名, name, roster) || p.又名.some(a => norm(a) === norm(name)));
}
// 按名字、又名建一次索引（10/16 提速）：名字对得上就直接取；只有"前半名"那种才走慢路
const INDEX = new WeakMap();
export function personOf(data, name, roster = []) {
    if (!data?.人?.length || !name) return null;
    let idx = INDEX.get(data);
    if (!idx) {
        idx = new Map();
        for (const p of data.人) { const k = norm(p.名); if (k && !idx.has(k)) idx.set(k, p); for (const a of p.又名 ?? []) { const ka = norm(a); if (ka && !idx.has(ka)) idx.set(ka, p); } }
        INDEX.set(data, idx);
    }
    return idx.get(norm(name)) ?? data.人.find(p => isPerson(p, name, roster)) ?? null;
}
// 这个人只跟着谁出现（跟着的那个人牵头）；反过来，谁跟着他。
export function leaderOf(data, name, roster = []) {
    return personOf(data, name, roster)?.跟着 || null;
}
export function followersOf(data, name, roster = []) {
    return (data?.人 ?? []).filter(p => p.跟着 && sameName(p.跟着, name, roster)).map(p => p.名);
}
const usable = p => !/^(否|不)/.test(p.能用);

// ---------- 规划简报里的一段 ----------

// keep(人)：规划简报压过时（章程 H4）只给活着的人整行；别的只留"谁对谁"一行。不给就全给（和以前一样）。
export function briefSection(data, { current = null, keep = null } = {}) {
    if (!data?.人?.length) return [];
    const later = current?.size ? ['', '【关系的最新变化】（开场之后，按账本和上一段规划；和表里的底不一样时以这里为准）', ...currentLines(current)] : [];
    return [...table(data, keep), ...later];
}
function table(data, keep = null) {
    const out = ['【人物关系表】（用户定的；各人的地盘、关系、故事开始时知道什么。"开局不知道"是提醒你：这些他露面时还不知道，别写进他的露面和应答里）'];
    if (data.公开.length) out.push('谁都知道的：', ...data.公开.map(x => `· ${x}`));
    // 备注里常写着"要等某某做了什么以后才有"的设想（用户 10/13：表里写"对外说法经某中间人传开"，戏里她没答应、给了个假名，
    // 规划照旧当它传开了，几路人都循着它找上门）：写明那是开局时的设想，戏里走成别的样子的照戏里的
    if (data.备注.length) out.push('备注（开局时写的；里面说"要等……才有""以后会……"的是开局时的设想，聊天里已经走成别的样子的，以聊天里发生的和【关系的最新变化】为准）：', ...data.备注.map(x => `· ${x}`));
    if (data.不在了.length) out.push(`不在了、别排：${data.不在了.map(x => x.replace(/[。；]+$/, '')).join('；')}`);
    for (const p of data.人) {
        if (keep && !keep(p)) { out.push(`· ${p.名}：（最近没露面，只列跟谁有关系）${p.关系.length ? p.关系.map(r => `对${r.对}`).join('、') : '—'}`); continue; }
        const bits = [
            p.现在,
            p.地盘 && `地盘：${p.地盘}`,
            p.本事 && `本事：${p.本事}`,
            p.管辖.length && `管辖：${p.管辖.join('、')}`,
            p.派活.length && `派活：${p.派活.join('、')}`,
            p.身价 && `身价：${p.身价}`,
            p.跟着 && `只跟着${p.跟着}出现，不单独露面、不单独联系人`,
            p.何时来 && `什么时候才会来：${p.何时来}`,
            p.外人眼里 && `外人眼里：${p.外人眼里}`,
            p.关系.length && `关系：${p.关系.map(r => `${r.对}——${r.是}`).join('；')}`,
            p.开局知道.length && `开局知道：${p.开局知道.join('；')}`,
            p.开局不知道.length && `开局不知道：${p.开局不知道.join('；')}`,
            p.能用 && `能不能用：${p.能用}`,
        ].filter(Boolean);
        out.push(`· ${p.名}${p.又名.length ? `（${p.又名.join('、')}）` : ''}：${bits.join('｜')}`);
    }
    return out;
}

// ---------- 角色那一格里的几行 ----------
// name：正在开口的人；present：在场的人（含用户）；covered(对谁)：开局单的口径已经写了他对这个人的态度，就不再重复。
// firstTime：他在这一局里第一次出场（刚到场、之前没开过口）。
// 表里给用户看的出处小注（"（开局单）""（原作全通）"）不递给前台。
const plain = s => String(s).replace(/（[^（）]*(开局单|角色卡|原作|参谋|世界书|私设)[^（）]*）\s*$/, '').trim();
const clause = s => plain(s).replace(/[。；;，,\s]+$/, '');   // 拼进一句里的那一段，去掉句末标点

// ---------- 关系跟着剧情走 ----------
// 表里写的是开场时的底；之后的变化有两处来源，都挂在消息上（删消息、改稿、分支都自动跟着变）：
// ①记账记下的"关系"型记录（说话人和谁、从这条起是什么关系）；②规划者每一段顺手写的"关系现状"（挂在要规划的那条消息上）。
// 同一对人取最晚的那一条；两处都没有，才用表里的底。
// 每一条都是某一侧的（by）：给某人那一格时，只用他自己那一侧的，另一侧的只用记账记下的（当着面说了、做了的）；
// 规划写的另一侧的心思（试玩 9/30：规划替玩家写了"四天没联系他是还没准备好"，被当成另一个人知道的递了过去）不给。
const canon = (data, name, roster) => personOf(data, name, roster)?.名 ?? String(name ?? '').trim();
export const pairKey = (a, b) => [a, b].sort().join('\u0001');
const dirKey = (by, other) => `${by}\u0002${other}`;
export function currentRelations(data, { records = [], plan = null, roster = [] } = {}) {
    const out = new Map();
    out.dir = new Map();
    out.planDir = new Map();   // 每一侧最近一份规划写的（关系那一行的"眼下"，用户 10/14）
    const put = (a, b, entry) => {
        const ca = canon(data, a, roster), cb = canon(data, b, roster);
        const key = pairKey(ca, cb);
        const old = out.get(key);
        if (!old || entry.pos >= old.pos) out.set(key, entry);
        const dk = dirKey(ca, cb), oldDir = out.dir.get(dk);
        if (!oldDir || entry.pos >= oldDir.pos) out.dir.set(dk, entry);
        if (entry.from === '规划') out.planDir.set(dk, entry);
    };
    if (plan?.relations?.length) for (const r of plan.relations) if (r.谁 && r.对谁 && r.现在) put(r.谁, r.对谁, { text: r.现在, pos: plan.pos ?? -1, from: '规划', by: r.谁 });
    for (const r of records) if (r.type === '关系' && r.relation?.with && r.relation?.now) put(r.holder_name ?? r.holder, r.relation.with, { text: r.relation.now, pos: r.pos, from: '记账', by: r.holder_name ?? r.holder, id: r.id });
    return out;
}
// 给面板和规划简报看的：每对人一行。
export function currentLines(current) {
    return [...current].map(([key, v]) => `· ${key.split('\u0001').join(' 与 ')}：${v.text}（${v.from}${v.by ? `，${v.by}那一侧` : ''}）`);
}

// 表里一行常是"不会变的底＋开场时的样子"（"彼此最重要的人。开场时他觉得……"）：底＝第一个"开场时、故事开始时、一开始、眼下、目前"之前那截；没有这类字眼就整行都算底
const STAGE = /(?:^|[。；;，,！？\s])(?=开场时|故事开始时|开局时|一开始|眼下|目前|如今)/;
export const groundOf = text => { const t = plain(text); const m = STAGE.exec(t); return clause(m ? t.slice(0, m.index) : t); };

// 这一路（方案"场记的分量与连续性"第 1 步，用户 10/14："角色不会忘记这一路的感受，明白自己的心路……越重要的越清晰"）：
// 他和眼前这个人一路走过的转折——那时两人走到哪、他心里怎么变的。只记阶段和感受，不记场面细节（细节在"那几场经过"和召回里）；
// 眼下这一段（最近一份规划写的、那之后记下的）不在这里重复。日子写成"几月几日（第几天）"，和"现在"那一行同一本日历，不写昨天前天。
// entries：[{ pos, text, from: '记账'|'规划', by }]（记账的"关系"记录、以前几份规划写的他那一侧的快照）；stageFrom：眼下这一段从哪条起；
// opening：表里"开场时"那截（被规划换掉了才给，当这一路的头一步）；label(pos)：日子的说法。
// 越重要越清楚：转折（挑明、亲近、翻脸、拉黑、和好、认错……）一直留着；一天里的几条并成一行；超了 PATH_MAX 行先去掉近的、不是转折的
// （近的有"那几场经过"），不按远近模糊要紧的。
export const PATH_MAX = 6, DAY_MAX = 3, ITEM_MAX = 56, LEFT_ITEM = 90;   // 规划交的"这一段留下的"是挑过的一步，给长一点
const TURN = /表白|挑明|坦白|告白|吻|亲上|亲热|上床|睡了|在一起|拉黑|断联|绝交|翻脸|决裂|闹翻|和好|道歉|服软|认错|越界|分手|不再|第一次|头一回|划清|切断|收回/;
const SIMILAR = 0.5;
const bigrams = t => { const s = plain(t).replace(/[^一-鿿A-Za-z0-9]/g, ''); const out = new Set(); for (let i = 0; i + 2 <= s.length; i++) out.add(s.slice(i, i + 2)); return out; };
const overlap = (a, b) => { const x = bigrams(a), y = bigrams(b); if (!x.size || !y.size) return 0; let n = 0; for (const g of x) if (y.has(g)) n++; return n / Math.min(x.size, y.size); };
const brief = (t, max = 70) => { const s = clause(t); if (s.length <= max) return s; const cut = s.slice(0, max); const i = Math.max(cut.lastIndexOf('。'), cut.lastIndexOf('；'), cut.lastIndexOf('，')); return `${i >= max / 2 ? cut.slice(0, i) : cut}……`; };
export function pathLines({ name, other, entries = [], stageFrom = Infinity, opening = '', label = pos => '', max = PATH_MAX }) {
    // 规划的快照一份份很像（拉黑那几天写了八份）：和上一条留下的规划快照差不多的不要（留头一份：那个样子是从那天起的）；眼下这一段的不要
    const kept = [];
    let lastPlan = null;
    for (const e of [...entries].filter(e => e?.text && Number.isFinite(e.pos) && e.pos < stageFrom).sort((a, b) => a.pos - b.pos)) {
        if (e.from === '规划') { if (lastPlan && overlap(lastPlan.text, e.text) >= SIMILAR) continue; lastPlan = e; }
        // 规划交的"这一段留下的"：后一份又把同一步写了一遍的不要
        if (e.from === '规划留下' && kept.some(k => k.from === '规划留下' && overlap(k.text, e.text) >= SIMILAR)) continue;
        kept.push({ ...e, turn: e.weight === 3 || TURN.test(e.text) });
    }
    // 一天一行：同一天的几条并起来（转折在前，至多两条）
    const days = [];
    for (const e of kept) {
        const day = label(e.pos);
        const d = days.at(-1);
        if (d && d.day === day) d.items.push(e); else days.push({ day, pos: e.pos, items: [e] });
    }
    // 一天里：规划的快照只留最晚那份；转折在前、他自己这一侧在前，至多三条，再按先后排
    const mine = e => e.from === '规划' || e.from === '规划留下' || String(e.text).startsWith(name);
    for (const d of days) {
        const lastSnap = d.items.filter(e => e.from === '规划').at(-1);
        d.items = d.items.filter(e => e.from !== '规划' || e === lastSnap)
            .sort((a, b) => Number(b.turn) - Number(a.turn) || Number(mine(b)) - Number(mine(a)) || a.pos - b.pos).slice(0, DAY_MAX).sort((a, b) => a.pos - b.pos);
        d.turn = d.items.some(e => e.turn);
    }
    while (days.length > max) {
        const i = days.map((d, k) => [d, k]).reverse().find(([d]) => !d.turn)?.[1] ?? days.length - 1;   // 先去掉最近的、不是转折的；全是转折就去掉最近的（近的在"那几场经过"里）
        days.splice(i, 1);
    }
    const rows = days.map(d => `  · ${d.day ? `${d.day}：` : ''}${d.items.map(e => brief(e.from === '规划' ? `${name}那时：${e.text}` : e.text, e.from === '规划留下' ? LEFT_ITEM : ITEM_MAX)).join('；')}`);
    if (opening) rows.unshift(`  · 开场时：${brief(String(opening).replace(/^(开场时|故事开始时|开局时|一开始)[，,：:]?/, ''), 90)}`);
    if (!rows.length) return [];
    return [`  ${name}和${other}这一路（转折，按先后；记的是那时两人走到哪、${name}心里怎么变的，细节问起了再想；现在的样子看上面一行）：`, ...rows];
}

// 规划写的关系现状是那一刻的快照（常顺带写着"他还不清楚怎么回事"）：过了 OLD_PLAN 条，聊天里早有了新的，不再说"以这个为准"（试玩 10/5：诊所看完了，还递着"他猜是后遗症，但不清楚"）。
export const OLD_PLAN = 30;
// path：{ entriesFor(对方名) => 这一对人一路的记录, label(pos) => 日子 }，给了就在每个在场的人那行下面接"这一路"（pathLines）
export function slotLines(data, { name, present = [], roster = [], firstTime = false, sees = true, covered = () => false, current = new Map(), lastPos = null, path = null }) {
    const me = personOf(data, name, roster);
    if (!me) return [];
    const lines = [];
    if (me.地盘 || me.本事 || givesWork(me)) lines.push(`${name}的地盘和本事：${[me.地盘 && clause(me.地盘), me.本事 && clause(me.本事), me.管辖.length && `管${me.管辖.join('、')}`, givesWork(me) && `派${me.派活.join('、')}的活`].filter(Boolean).join('；')}`);
    const here = present.filter(p => p && !isPerson(me, p, roster));
    // 和在场的每个人：表里的底，加上后来的变化（取最新的一层）。原来有了变化就整行换成最新一句，底子（"某种程度上就是彼此"）就丢了（主窗 D-98）。
    // 开局单口径写过态度的，底就不重复，只给后来的。
    const ties = [];
    for (const p of here) {
        const other = canon(data, p, roster);
        // 他自己这一侧后来的（规划写的、记账记下他说的做的）压过表里的底；对方那一侧的（记账记下对方当面说的做的）是对方的心意和举动，
        // 不替他改主意（试玩 10/4：她吻了他、提出在一起，记成"两人关系进入更亲密的阶段"还写着"以这个为准"，前台就把他开场时的底整个扔了）。
        const mine = !current.dir ? current.get(pairKey(me.名, other)) : current.dir.get(dirKey(me.名, other));
        const theirs = !current.dir ? null : (e => (e?.from === '记账' && e.pos > (mine?.pos ?? -Infinity) ? e : null))(current.dir.get(dirKey(other, me.名)));
        const base = me.关系.find(r => sameName(r.对, p, roster) || isPerson(personOf(data, r.对, roster) ?? { 名: r.对, 又名: [] }, p, roster));
        const floor = base && !covered(base.对) ? clause(base.是) : null;
        if (!mine && !theirs) { if (floor) ties.push(`· ${base.对}：${plain(base.是)}`); continue; }
        const old = mine?.from === '规划' && lastPos != null && lastPos - mine.pos > OLD_PLAN;
        const mark = old ? '（这是早些时候规划里写的样子；那之后聊天里发生的为准）' : '（按最近发生的；和前面对不上的地方以这个为准）';
        // 规划写过这一侧的（用户 10/14："拿了新规划……应该替换/重写场记里的哪一块……不能每次写了规划就在原有的下面加上现在的规划"）：
        // 表里那一行只留不会变的底（"开场时……"以前那截），开场时的样子由最近一份规划写的"眼下"换掉；那之后记账记下的变化接在后面
        const planned = current.planDir?.get(dirKey(me.名, other)) ?? null;
        const ground = planned && base && !covered(base.对) ? groundOf(base.是) : floor;
        const own = !mine ? (floor ? `${floor}。` : '')
            : planned ? `${ground ? `${ground}。` : ''}眼下：${clause(planned.text)}${mine !== planned && mine.pos > planned.pos ? `。后来：${clause(mine.text)}` : ''}${mark}`
            : `${floor ? `${floor}。后来：` : ''}${clause(mine.text)}${mark}`;
        const side = theirs ? `${p}那边后来：${clause(theirs.text)}（这是${p}那一边的心意和举动；${name}自己怎么看、怎么接，照上面写的和${personWord(name)}自己说过做过的）` : '';
        ties.push(`· ${p}：${own}${side}`);
        if (path?.entriesFor) {
            // 眼下这一段从哪条起：最近一份规划写的那条；没有就是他这一侧最新那条（"后来"给了的）；对方那边后来的更晚，也算在眼下
            const stageFrom = Math.min(...[planned?.pos, mine?.pos, theirs?.pos].filter(Number.isFinite), Infinity);
            const opening = planned && base && !covered(base.对) ? plain(base.是).slice(plain(base.是).indexOf(ground ?? '') + (ground ?? '').length).replace(/^[。；;，,！？\s]+/, '') : '';
            ties.push(...pathLines({ name, other: p, entries: path.entriesFor(other, p) ?? [], stageFrom, opening, label: path.label ?? (() => '') }));
        }
    }
    if (ties.length) lines.push(`${name}和在场的人：`, ...ties);
    if (firstTime) {
        const following = followersOf(data, name, roster);
        if (following.length) lines.push(`${following.join('、')}一直跟着${name}（${following.map(f => personOf(data, f, roster)?.外人眼里).filter(Boolean).join('；')}）`);
        const known = [...data.公开, ...me.开局知道];
        if (known.length) lines.push(`故事开始时${name}知道的（之后可能又听到了别的风声，以聊天里发生的为准）：`, ...known.map(x => `· ${plain(x)}`));
        const together = [...followersOf(data, name, roster), me.跟着].filter(Boolean);   // 一直在一起的，不算第一次见
        const seen = here.map(p => personOf(data, p, roster)).filter(p => p?.外人眼里 && usable(p) && !together.some(t => isPerson(p, t, roster)));
        // 隔着消息、电话的（sees＝false）：人不在这儿，谁也没看见
        if (seen.length && sees) lines.push(`${name}这是在这一局里第一次见到他们，眼里看到的是：`, ...seen.map(p => `· ${p.名}：${plain(p.外人眼里)}`));
    }
    return lines;
}

// 核对交回的规划用：能牵头的名字＝名册里不是"不用"的，加上关系表里能用的人（没做卡的中间人也能派活、来找）；
// 跟着别人的人改成他跟着的那个人牵头。
// chatKey（章程 K1）：给了就按这个窗口认主角团——开局单没写主角团时用它上一份交回的规划里写的（setup.crewOf）
export function planRoster(store, storyId, { chatKey = null } = {}) {
    const cast = store.getCast(storyId);
    const all = cast.map(e => e.name);
    const rel = store.relationsOf?.(storyId);
    const data = rel ? normalizeRelations(rel) : null;
    const fromTable = data ? data.人.filter(p => usable(p) && !/待定/.test(p.能用)).map(p => p.名) : [];
    const names = [...new Set([...cast.filter(e => e.role !== '不用').map(e => e.name), ...fromTable])];
    // 这一局用不上的人（名册里"不用"、又不是哪个用得上的人的别的版本）：事件里写到他们就丢掉那件（T-22 实测：别的故事的人名混进了规划）。
    const head = n => String(n).split(/[（(]/)[0].trim();
    const foreign = [...new Set(cast.filter(e => e.role === '不用').map(e => e.name))]
        .filter(n => head(n).length >= 2 && !names.some(m => head(m) === head(n) || m.includes(head(n)) || head(n).includes(head(m)))
            // 关系表里认成用得上的那个人的又名（旧名卡是某人的另一个名字），不算别的故事的人（10/11：写到他的事件整件被丢）
            && !(data && (p => p && names.some(m => personOf(data, m, all) === p))(personOf(data, n, all))));
    // 玩家的角色（人设名，连同关系表里他那一行的名字和又名）：规划里的事不能由他牵头——场记只发给开口的角色，没有哪个角色是玩家，
    // 由他牵头的事永远递不出去（试玩 9/30：20 件里 7 件写的是玩家）。这类事改成"世界"：从在场的人眼里、从场面上带出来。
    const players = store.playerNames?.(storyId) ?? [];
    const player = [...new Set(players.flatMap(n => { const p = data ? personOf(data, n, all) : null; return p ? [n, p.名, ...p.又名] : [n]; }))].filter(Boolean);
    // cells：规划者交回的每件事都要有六格里的用意、触发、时效、前提（章程 F1，planner.parsePlan）
    // afterCap："第几天后"的上限按这一局的时间尺度（章程 G2：天 60，年 20）；maxEvents：一个节点至多几件，按这局的节奏（章程 H2：慢档 8，别的 12）
    // unitCap：节奏表每格至多几件（perUnit 上限，章程 H5）——头一格排多了提醒一句
    // categories：开局单的类别（章程 J1）——这一份一件都没撑到的类别，parsePlan 记一句提醒
    const setup = store.setupOf?.(storyId)?.data ?? null;
    const pace = paceOf(setup);
    // crew：主角团名单（章程 K1）——parsePlan 数主角团的事占几成
    let lastNode = null;
    try { const p = chatKey ? store.lastReadyPlan?.(chatKey) : null; lastNode = p?.node ? JSON.parse(p.node) : null; } catch {}
    const userName = (chatKey ? [...(store.currentMessages?.(chatKey) ?? [])].reverse().find(m => m.is_user)?.name : null) ?? players[0] ?? null;
    return { names, foreign, player, leaderOf: name => (data ? leaderOf(data, name, all) : null), cells: true, afterCap: scaleOf(setup).planCap, maxEvents: pace.maxEvents, unitCap: pace.perUnit[1],
        categories: Array.isArray(setup?.类别) ? setup.类别 : [], crew: crewOf(setup, lastNode, userName) };
}

// 主角团里两两眼下的关系（章程 K1，规划简报【主角团】那一块）：谁对谁——后来的（规划写的、记账记下的，他自己那一侧）压过表里的底；
// 都没有的那一对不列。skip(名字)：这个人那一侧不列（玩家的角色：她怎么看别人由玩家自己演）
export function crewTies(data, names = [], { current = null, roster = [], skip = () => false } = {}) {
    const people = [...new Set(names.filter(Boolean))];
    const out = [];
    for (const a of people) {
        if (skip(a)) continue;
        for (const b of people) {
            if (a === b || sameName(a, b, roster)) continue;
            const later = current?.dir?.get(dirKey(canon(data, a, roster), canon(data, b, roster)));
            const me = personOf(data, a, roster);
            const base = me?.关系.find(r => sameName(r.对, b, roster) || isPerson(personOf(data, r.对, roster) ?? { 名: r.对, 又名: [] }, b, roster));
            const text = later?.text ?? (base ? plain(base.是) : '');
            if (text) out.push({ 谁: a, 对谁: b, 现在: text });
        }
    }
    return out;
}

// ---------- 派活的人（中间人一类）：管哪几片、派哪几档的活 ----------
// priceOf(档名们) → 一句行情，由调用方从价表里查：关系表自己不写价，免得和价表打架。
export const givesWork = p => !!p?.派活?.length;
export function giverLine(p, priceOf = () => '') {
    const price = priceOf(p.派活);
    return `${p.名}：${[p.管辖.length && `管${p.管辖.join('、')}`, p.地盘 && clause(p.地盘), p.本事 && clause(p.本事), `派${p.派活.join('、')}的活${price ? `（这个世界的价码：${price}）` : ''}`].filter(Boolean).join('；')}`;
}

// 聊天里说到的派活的人（点了名的；或者聊到活儿时点到了他管的那一片）：行内都知道的地盘和派活的档次。在场的不算（他自己那一格有）。
export function mentionLines(data, { talk = '', jobTalk = false, present = [], roster = [], priceOf } = {}) {
    const text = String(talk);
    if (!text.trim() || !data?.人?.length) return [];
    const here = p => present.some(x => isPerson(p, x, roster));
    const named = p => [p.名, ...p.又名].some(n => n.length >= 2 && text.includes(n));
    const area = p => jobTalk && p.管辖.some(a => a.length >= 2 && text.includes(a));
    const hit = data.人.filter(p => givesWork(p) && usable(p) && !here(p) && (named(p) || area(p))).slice(0, 3);
    return hit.length ? ['说到的派活的人（行内都知道的）：', ...hit.map(p => `· ${giverLine(p, priceOf)}`)] : [];
}
