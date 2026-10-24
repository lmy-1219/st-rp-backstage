// 本机后台的存储：局（story）、窗口（chat）、消息正文、每个窗口当前的消息序列、钉住的材料格。
// 消息按内容指纹去重、按局共享：分支之间共用前缀，不重复上传也不重复抽取。
// 一个窗口"现在有哪些消息"只看它当前的序列；改稿、删稿、换 swipe 之后，旧版本自然不再可见。
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { liveEpisodes } from './episodes.mjs';
import { liveAnchors } from './landing.mjs';

// 这几种重新规划（玩家转向、弄断、局面变了）交回以后，旧节点里还在口袋里的事一并撤下（menuOf），要用的规划者重写进新的事件（用户 10/4）。
export const RETIRES_POCKET = new Set(['turn', 'broken', 'shift']);
// 菜单日志里的"留下"（章程 H3）：新规划的规划者答了留的旧件——不改它在哪一步，只让它换了规划也接着排、接着在口袋里（menuOf）
export const KEPT = 'kept';

export function planFailure(error) {
    const text = String(error?.message ?? error ?? '');
    if (/plan_(?:withdrawn|superseded|late)/.test(text)) return 'late';
    if (/model_truncated/.test(text)) return 'truncated';
    if (/timeout|超时|model_no_response/i.test(text)) return 'timeout';
    if (/bad_json|no_content|refusal|一件都没过|一条都没过/.test(text)) return 'bad_answer';
    if (/budget|no_api/.test(text)) return 'unavailable';
    return 'connection';
}

// 六格（章程 F1）落账：列名 purpose、trig、ttl、premise、if_taken、if_sunk；读出来（menuOf）是 purpose、trigger、ttl、premise、ifTaken、ifSunk
// 再加一格类别（章程 J1）：列名、读出来都是 category——撑的是开局单类别里的哪一样（简报数最近两份各类别排了几件）；没有这一格的旧件是空的
// 再加收尾、变数（章程 K1）：列名 close_text、twist；读出来 close_text 和 closeText 都有（K2 读 m.close_text ?? m.closeText），twist 原样
// 再加引子（章程 L1）：列名、读出来都是 lead——有日子的现场活动配的那件找上门的题；没有的是空的
const CELL_COLS = 'purpose, trig, ttl, premise, if_taken, if_sunk, category, close_text, twist, lead, intimate';
const cellValues = m => [m.purpose || null, m.trigger ? JSON.stringify(m.trigger) : null, m.ttl ? JSON.stringify(m.ttl) : null, m.premise || null, m.ifTaken || null, m.ifSunk || null, m.category || null, m.closeText || null, m.twist || null, m.lead || null, m.intimate ? JSON.stringify(m.intimate) : null];
const CELL_MARKS = CELL_COLS.split(',').map(() => '?').join(', ');
const fromJson = v => { if (v == null || v === '') return null; try { return JSON.parse(v); } catch { return null; } };
function readCells(m) {
    m.trigger = fromJson(m.trig);
    m.ttl = fromJson(m.ttl);
    m.ifTaken = m.if_taken ?? null;
    m.ifSunk = m.if_sunk ?? null;
    m.closeText = m.close_text ?? null;
    if (m.intimate) m.intimate = fromJson(m.intimate); else delete m.intimate;
    return m;
}
// 同一拍子（章程 F1 重复不收）：同线、同用意、题相近（互相包含，或有两个实在的两字词一样）
const WEAK_BIGRAM = /^[的了是着在也就都和与把被给让向从到很还又再才只么吗呢吧啊]|[的了是着吗呢吧啊]$/;
const bigrams = t => new Set((String(t ?? '').match(/[一-鿿]{2,}/g) ?? []).flatMap(w => [...w].slice(0, -1).map((_, i) => w.slice(i, i + 2))).filter(w => !WEAK_BIGRAM.test(w)));
export function titleNear(a, b) {
    const x = String(a ?? '').trim(), y = String(b ?? '').trim();
    if (x.length < 2 || y.length < 2) return false;
    if (x.includes(y) || y.includes(x)) return true;
    const bx = bigrams(x);
    return [...bigrams(y)].filter(w => bx.has(w)).length >= 2;
}
export const sameBeat = (old, n) => !!String(old?.line ?? '').trim() && String(old.line).trim() === String(n?.line ?? '').trim()
    && !!old.purpose && old.purpose === n.purpose && titleNear(old.title, n.title);

const EDIT_RUN = 6;
const CAMERA_LABEL = '旁白';   // 镜头那张卡在组格时用的名字（slot.CAMERA_NAME）：它的消息记成 narrator
// 用户在消息上点的剧情日期（N-265）：day＝从这条起算新的一天｜same＝这里没有跨天｜d:N＝这条是第 N 天；后面可以带 @时段（10/3：时段也能手动改）
export const DAY_MARK = /^(?:day|same|d:\d{1,4})?(?:@(?:早上|上午|中午|下午|傍晚|晚上|深夜|凌晨))?$/;
export const validMark = k => typeof k === 'string' && k !== '' && DAY_MARK.test(k);   // 中间连着改至多几条还认作就地改稿（inPlaceEdits）
const SCHEMA = `
create table if not exists stories(
  id text primary key, label text, created_at text not null);
create table if not exists chats(
  key text primary key, story_id text not null references stories(id), parent_key text,
  st_chat_id text, group_id text, label text,
  members text, anchors text,
  test_slot integer not null default 0, enabled integer not null default 1,
  joined_at text not null, synced_at text);
create table if not exists messages(
  story_id text not null, fp text not null,
  is_user integer not null, speaker text not null, name text, text text not null,
  first_seen text not null,
  primary key(story_id, fp));
create table if not exists chat_seq(
  chat_key text not null, pos integer not null, fp text not null,
  hidden integer not null default 0, sent_at text, board_mark text,
  primary key(chat_key, pos));
create index if not exists chat_seq_fp on chat_seq(chat_key, fp);
create table if not exists lore(
  story_id text not null, ekey text not null, hash text not null, world text, title text, text text,
  verdict text, source text, updated_at text not null,
  primary key(story_id, ekey));
create table if not exists slots(
  chat_key text not null, speaker text not null, anchor text not null,
  text text not null, created_at text not null,
  primary key(chat_key, speaker, anchor));
create table if not exists contact_offers(
  id integer primary key autoincrement, chat_key text not null, person text not null, day integer not null,
  at integer not null, round text not null, speaker text, created_at text not null);
create table if not exists card_profiles(
  avatar text primary key, hash text not null, text text, updated_at text not null);
create table if not exists cast(
  story_id text not null, avatar text not null, name text not null, role text not null, hook text,
  set_by text not null default 'auto', updated_at text not null,
  primary key(story_id, avatar));
create table if not exists absences(
  id integer primary key autoincrement, chat_key text not null, from_fp text not null, to_fp text,
  started_at text not null, ended_at text not null, hours real not null, days integer not null,
  seen text not null default '[]', created_at text not null,
  unique(chat_key, from_fp));
create table if not exists meta(key text primary key, value text);
create table if not exists plans(
  id integer primary key autoincrement, chat_key text not null, status text not null, reason text, story_day integer not null,
  provider text, brief text, raw text, goal text, bring_next text, error text, created_at text not null, ready_at text);
create table if not exists plan_attempts(
  id text primary key, plan_id integer not null, node_id integer not null, chat_key text not null,
  entry text not null, model text, thinks integer not null, brief_chars integer not null,
  output_chars integer not null default 0, internal_retries integer not null default 0,
  stage text not null, finish_reason text, failure text, status text not null,
  started_at text not null, finished_at text, elapsed_ms integer);
create index if not exists plan_attempts_chat on plan_attempts(chat_key, started_at);
create table if not exists intimate_progress(
  id integer primary key autoincrement, chat_key text not null, plan_id integer,
  people text not null, current_text text not null, basis text not null,
  story_day integer not null, pos integer, fp text, source text not null);
create table if not exists intimate_stops(
  id integer primary key autoincrement, chat_key text not null, people text not null,
  story_day integer not null, place text, part text, pos integer, fp text);
create table if not exists menu(
  id integer primary key autoincrement, plan_id integer not null, chat_key text not null, who text not null, title text not null,
  surface text not null, respond text not null, sink text, fit text, weight text, ready_day integer not null,
  status text not null default 'waiting', pocket_day integer, updated_at text not null);
create table if not exists handoffs(
  id integer primary key autoincrement, kind text not null, key text, chat_key text, status text not null default 'pending',
  payload text not null, result text, created_at text not null, closed_at text);
create table if not exists setups(
  id integer primary key autoincrement, story_id text not null, status text not null, data text, source text,
  unchecked text, error text, cost real, created_at text not null, updated_at text not null);
create table if not exists menu_log(
  id integer primary key autoincrement, chat_key text not null, item_id integer not null, status text not null,
  story_day integer, pos integer not null, fp text, created_at text not null);
create table if not exists notes(
  id integer primary key autoincrement, chat_key text not null, kind text not null, text text not null,
  story_day integer, pos integer, used_in_plan integer, cleared integer not null default 0, created_at text not null);
create table if not exists relations(
  story_id text primary key, data text not null, set_by text, updated_at text not null);
create table if not exists events(
  id integer primary key autoincrement, chat_key text, at text not null, kind text not null, detail text);
create table if not exists state_notes(
  id integer primary key autoincrement, story_id text not null, fp text not null, who text not null, aspect text not null, text text not null,
  created_at text not null);
create index if not exists state_notes_fp on state_notes(story_id, fp);
-- 场次摘要（core/episodes.mjs，N-284）：第 from_pos～to_pos 条的一段经过；span＝那几条消息的指纹串，对不上就作废
create table if not exists episodes(
  id integer primary key autoincrement, story_id text not null, from_pos integer not null, to_pos integer not null, span text not null,
  place text, present text not null default '[]', text text not null, edited integer not null default 0, model text, created_at text not null);
create index if not exists episodes_story on episodes(story_id, from_pos);
`;

// 一条消息的身份：谁说的 + 说了什么。浏览器端用同样的算法（extension/sync.mjs）。
export function fingerprint(isUser, speaker, text) {
    return createHash('sha256').update(`${isUser ? 1 : 0}\u0001${speaker}\u0001${text}`).digest('hex').slice(0, 32);
}

// 序列一下子少了很多条，多半是聊天文件塌了（N-51），先不认，等用户确认。
export function looksCollapsed(oldLength, newLength) {
    return oldLength >= 20 && newLength < oldLength * 0.5 && oldLength - newLength >= 10;
}

function countBy(values) {
    const counts = new Map();
    for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
    return counts;
}

// 新旧两个序列按内容比：多出来的、少掉的各几条（同内容重复出现也算数）。
export function diffSequences(oldFps, newFps) {
    const before = countBy(oldFps), after = countBy(newFps);
    let added = 0, removed = 0;
    for (const [fp, n] of after) added += Math.max(0, n - (before.get(fp) ?? 0));
    for (const [fp, n] of before) removed += Math.max(0, n - (after.get(fp) ?? 0));
    return { added, removed };
}

export function openStore(file) {
    const db = new DatabaseSync(file);
    db.exec('pragma journal_mode = wal; pragma foreign_keys = on; pragma busy_timeout = 3000;');
    db.exec(SCHEMA);
    try { db.exec('alter table slots add column ids text'); } catch {}
    try { db.exec('alter table chat_seq add column mark text'); } catch {}   // 用户在这条消息上点的剧情日期：day＝从这条起算新的一天｜same＝这里没有跨天｜d:N＝这条是第 N 天（存在消息的附加字段里，同步时带过来）
    try { db.exec('alter table slots add column carry text'); } catch {}   // 老地方：余波原来跟着钉住的格子存，现在搬到 carries（下面）
    try { db.exec('alter table slots add column parts text'); } catch {}   // 分块放时各块的文字（9/29）
    // 情绪余波（mood.mjs）：这一格给了、他之后几次开口还要接着的。单独存，不跟着"钉住"走——第一个开口的人到点先给纯程序那一格、
    // 不钉住（D-100），余波也得记下。
    db.exec('create table if not exists carries(chat_key text not null, speaker text not null, anchor text not null, carry text not null, created_at text not null, primary key(chat_key, speaker, anchor))');
    try { db.exec("insert or ignore into carries(chat_key, speaker, anchor, carry, created_at) select chat_key, speaker, anchor, carry, created_at from slots where carry is not null"); } catch {}
    try { db.exec('alter table cast add column priority integer not null default 0'); } catch {}   // 名册里用户勾的"优先"
    try { db.exec('alter table cast add column bond integer'); } catch {}
    try { db.exec('alter table cast add column gender text'); } catch {}
    try { db.exec('alter table cast add column interests text'); } catch {}
    try { db.exec('alter table cast add column call text'); } catch {}   // 新面孔没名字时怎么叫（N-269：生人在正文里叫出名字以前只用称呼）
    try { db.exec('alter table cast add column stranger integer'); } catch {}   // 新面孔是不是生人（1＝生人，0＝街坊熟人，null＝没说）
    try { db.exec('alter table cast add column is_group integer not null default 0'); } catch {}
    try { db.exec('alter table card_profiles add column card_text text'); } catch {}   // 卡的正文（规划前备料时给 Gemini 读，D-109 第 3 步；只在本机数据库里）
    try { db.exec('alter table card_profiles add column card_hash text'); } catch {}
    try { db.exec('alter table card_profiles add column card_name text'); } catch {}   // 这一局里用户改过的"兴趣和习惯"（空＝用读卡写的那份，card_profiles）   // 基础亲疏 0～5（空＝按档位默认）   // 这一格用了哪些记录（别让同一件旧事轮轮都被想起）
    try { db.exec('alter table plans add column anchor_pos integer'); } catch {}   // 规划是在哪条消息之后要的（删到它之前＝撤回）
    try { db.exec('alter table plans add column anchor_fp text'); } catch {}
    try { db.exec('alter table chats add column branch_len integer'); } catch {}
    try { db.exec('alter table chats add column extract_from integer'); } catch {}   // 自动记账从第几条起（老窗口接入时只记接入以后的；空＝从头）   // 分支出来时和上一个窗口共有的前缀条数
    try { db.exec('alter table absences add column story text'); } catch {}   // 离开期间各人以为的、做了的（模型推的，JSON）
    try { db.exec('alter table absences add column story_status text'); } catch {}   // working｜ready｜failed
    try { db.exec('alter table menu add column know text'); } catch {}   // 这件事露面时牵头的人知道什么、看到什么（规划者写）
    try { db.exec('alter table menu add column line text'); } catch {}   // 哪条线（感情线、工作线、某人的关系线……）
    try { db.exec('alter table menu add column after_title text'); } catch {}
    try { db.exec('alter table menu add column motif text'); } catch {}
    try { db.exec('alter table menu add column anchor_pos integer'); } catch {}   // 后来补进节点的几件：挂在哪条消息上（删到它之前就撤回）
    try { db.exec('alter table menu add column anchor_fp text'); } catch {}   // 这件事是哪一类（规划者写，母题账用）   // 在哪件之后（同一份规划里那件的题）
    try { db.exec('alter table plans add column node text'); } catch {}
    try { db.exec('alter table menu add column promise_ref integer'); } catch {}
    try { db.exec('alter table menu add column offscreen integer'); } catch {}
    // 怎么进场（找上门／到现场／镜头外，质量窗 10/5 方案）；到现场的：在哪、谁去、去的由头
    try { db.exec('alter table menu add column origin text'); } catch {}   // 来由（用户 10/7）：这件事背后是怎么回事——规划者写，有人追查时才交给镜头一截
    for (const col of ['entry', 'place', 'goer', 'errand']) { try { db.exec(`alter table menu add column ${col} text`); } catch {} }   // 镜头外：玩家不在时发生在牵头的人身上（规划者写的）
    try { db.exec('alter table slots add column ver text'); } catch {}
    try { db.exec('alter table menu_log add column by_name text'); } catch {}
    try { db.exec('alter table menu_log add column pending integer not null default 0'); } catch {}
    // 六格（章程 F1）：用意、触发（JSON）、时效（JSON）、前提、接了会怎样、没接会怎样；菜单项上读作 purpose、trigger、ttl、premise、ifTaken、ifSunk
    for (const col of ['purpose', 'trig', 'ttl', 'premise', 'if_taken', 'if_sunk', 'category', 'close_text', 'twist', 'lead', 'intimate']) { try { db.exec(`alter table menu add column ${col} text`); } catch {} }   // intimate：亲密线四格 JSON，旧件为 null
    try { db.exec('alter table menu_log add column why text'); } catch {}   // 这一步为什么（过期了"没赶上：……"、前提不成立、被新规划替换）
    // 每条消息当最后一条时的小快照（rewind.mjs：删回去以后拿重算的和它比，对不上的亮出来）
    db.exec('create table if not exists snapshots(chat_key text not null, pos integer not null, fp text not null, data text not null, at text not null, primary key(chat_key, fp))');   // 交给某人那一格里的一步（递给他、用上了、顺带提了）：等他那条回复（方案 删消息等于没发生过）
    try { db.exec('alter table messages add column lore text'); } catch {}
    try { db.exec('alter table messages add column vis text'); } catch {}   // 谁看得见（extra.rp_vis：{ from, way, to? }，发消息、打电话来的那条只有本人、玩家、旁白看得见；visibility.mjs）   // 生成这条时酒馆真触发的世界书条目（"书|uid" 的 JSON 数组；质量窗 10/2：记账时这几条给全文）   // 递给了谁（N-277：口袋里别人牵头的事递出去就先锁给他）
    try { db.exec('alter table chat_seq add column sw integer'); } catch {}   // 正在用的是第几版左滑（分清改稿和左滑，N-271）   // 钉住那一格时的代码指纹（slot.SLOT_CODE）   // 跟着哪件约定（N-268：规划者写的；到了那天和它一起给，不让路）   // 节点规划：局面、目标、算成、落空、跨度、各条线、往后（JSON）
    try { db.exec('alter table chat_seq add column board_mark text'); } catch {}
    // 清掉挂在空消息上的改稿链（试玩 10/7）：生成时的空占位被当成改稿，空消息的指纹人人一样，把不相干的几条串到了一起——
    // 昨天的"此刻的样子"、旧账的接续跟着链跑到了今天的消息上。以后同步不再挂（sync 里滤掉），这里把已经挂上的拆掉；没有就不动
    try {
        const blank = new Set(db.prepare("select fp from messages where trim(coalesce(text, '')) = ''").all().map(r => r.fp));
        if (blank.size) {
            const del = db.prepare('delete from meta where key = ?');
            for (const r of db.prepare("select key, value from meta where key like 'fresh_from:%'").all()) if (blank.has(r.key.slice('fresh_from:'.length)) || blank.has(r.value)) del.run(r.key);
        }
    } catch {}
    const now = () => new Date().toISOString();
    const tx = fn => {
        db.exec('begin immediate');
        try { const result = fn(); db.exec('commit'); return result; }
        catch (error) { db.exec('rollback'); throw error; }
    };
    // 预备句柄复用（10/16 提速：以前每次 q() 都重新 prepare，一轮几千次）；.all()/.get() 都是一次取完，复用没有重入问题
    const stmts = new Map();
    const q = sql => { let s = stmts.get(sql); if (!s) { s = db.prepare(sql); stmts.set(sql, s); } return s; };
    // 读缓存（10/16 提速）：同一连接上任何一次写都让 total_changes 变，变了就全清；一轮里几十次重读消息、状态、meta 只算一次。
    // 返回的是数组的浅拷贝（谁 sort 都不影响别人），行对象共用——别就地改行
    const changesQ = q('select total_changes() n');
    const memoStore = new Map();
    const memo = (name, key, fn, copy = v => v) => {
        const ver = changesQ.get().n;
        let slot = memoStore.get(name);
        if (!slot || slot.ver !== ver) { slot = { ver, map: new Map() }; memoStore.set(name, slot); }
        if (slot.map.has(key)) return copy(slot.map.get(key));
        const v = fn();
        slot.map.set(key, v);
        return copy(v);
    };
    const copyArr = a => [...a];
    const getChat = q('select * from chats where key = ?');
    const logEvent = q('insert into events(chat_key, at, kind, detail) values (?, ?, ?, ?)');
    const log = (chatKey, kind, detail) => logEvent.run(chatKey, now(), kind, JSON.stringify(detail ?? null));
    // 快照：一条消息当最后一条时各处的样子（rewind.mjs）。同一条覆盖；一个窗口只留最近 400 条的
    function putSnapshot(chatKey, { pos, fp, data }) {
        q('insert into snapshots(chat_key, pos, fp, data, at) values (?, ?, ?, ?, ?) on conflict(chat_key, fp) do update set pos = excluded.pos, data = excluded.data, at = excluded.at').run(chatKey, pos, fp, JSON.stringify(data), now());
        q('delete from snapshots where chat_key = ? and pos < (select max(pos) from snapshots where chat_key = ?) - 400').run(chatKey, chatKey);
    }
    function snapshotOf(chatKey, fp) { const r = q('select pos, fp, data from snapshots where chat_key = ? and fp = ?').get(chatKey, fp); return r ? { ...r, data: JSON.parse(r.data) } : null; }

    function requireChat(chatKey) {
        const chat = getChat.get(chatKey);
        if (!chat) throw Object.assign(new Error('unknown_chat'), { status: 404 });
        return chat;
    }

    function newChat({ storyId, parentKey = null, stChatId, groupId, label }) {
        const key = 'c-' + randomUUID();
        q(`insert into chats(key, story_id, parent_key, st_chat_id, group_id, label, joined_at)
           values (?, ?, ?, ?, ?, ?, ?)`).run(key, storyId, parentKey, stChatId ?? null, groupId ?? null, label ?? null, now());
        return key;
    }

    // 新接入一个窗口 = 开一局新的。同一个聊天重复接入（比如 ST 连发了两次切换事件）就返回已有的那条。
    function join({ stChatId, groupId = null, label = null }) {
        return tx(() => {
            const existing = q(`select key, story_id from chats where st_chat_id = ? and coalesce(group_id, '') = coalesce(?, '')
                                order by joined_at desc limit 1`).get(stChatId, groupId);
            if (existing) return { chatKey: existing.key, storyId: existing.story_id, status: 'existing' };
            const storyId = 's-' + randomUUID();
            q('insert into stories(id, label, created_at) values (?, ?, ?)').run(storyId, label, now());
            const chatKey = newChat({ storyId, stChatId, groupId, label });
            log(chatKey, 'join', { stChatId, groupId });
            return { chatKey, storyId, status: 'joined' };
        });
    }

    // 打开一个带着我们标记的窗口：同一个 / 改了名 / 分支出来的（元数据被 ST 原样复制过来）。
    // siblings：浏览器知道的同组其他聊天 id；旧 id 还在 ⇒ 这是分支，旧 id 没了 ⇒ 是改名。
    function open({ chatKey, stChatId, groupId = null, siblings = null, mainChat = null }) {
        const chat = getChat.get(chatKey);
        if (!chat) return { status: 'unknown' };
        if (chat.st_chat_id === stChatId) return { status: 'same', chatKey, storyId: chat.story_id, enabled: !!chat.enabled };
        const oldStillThere = Array.isArray(siblings) ? siblings.includes(chat.st_chat_id) : !!mainChat;
        return tx(() => {
            if (!oldStillThere) {
                q('update chats set st_chat_id = ? where key = ?').run(stChatId, chatKey);
                log(chatKey, 'renamed', { from: chat.st_chat_id, to: stChatId });
                return { status: 'renamed', chatKey, storyId: chat.story_id, enabled: !!chat.enabled };
            }
            const branchKey = newChat({ storyId: chat.story_id, parentKey: chatKey, stChatId, groupId, label: chat.label });
            q(`update chats set members = ?, anchors = ?, test_slot = ?, extract_from = ? where key = ?`)
                .run(chat.members, chat.anchors, chat.test_slot, chat.extract_from ?? null, branchKey);
            // 记账跟着上一个窗口（D-100）：它开着，分支也开着。
            try { q('update chats set extract = ? where key = ?').run(chat.extract ?? 0, branchKey); } catch {}
            log(branchKey, 'branch', { parent: chatKey, stChatId });
            return { status: 'branch', chatKey: branchKey, storyId: chat.story_id, enabled: true };
        });
    }

    // 接入时自动开的记账：从哪条记起等第一次同步再定（见 sync）。
    function autoExtract(chatKey) { q('update chats set extract_from = -1 where key = ?').run(chatKey); }

    function setEnabled({ chatKey, enabled }) {
        requireChat(chatKey);
        q('update chats set enabled = ? where key = ?').run(enabled ? 1 : 0, chatKey);
        log(chatKey, enabled ? 'enabled' : 'disabled');
        return { ok: true };
    }

    function setOptions({ chatKey, testSlot }) {
        requireChat(chatKey);
        if (typeof testSlot === 'boolean') q('update chats set test_slot = ? where key = ?').run(testSlot ? 1 : 0, chatKey);
        return { ok: true };
    }

    // 上传正文。指纹对不上的拒收（防止传错窗口或内容被截断）。
    function putMessages({ chatKey, messages }) {
        const chat = requireChat(chatKey);
        // 同一条早先传过但没带世界书（生成完还没记上就先同步了）：补上
        const insert = q(`insert into messages(story_id, fp, is_user, speaker, name, text, first_seen, lore, vis)
                          values (?, ?, ?, ?, ?, ?, ?, ?, ?) on conflict(story_id, fp) do update set lore = coalesce(messages.lore, excluded.lore), vis = coalesce(excluded.vis, messages.vis)
                          where excluded.lore is not null or excluded.vis is not null`);
        const rejected = [];
        let stored = 0;
        tx(() => {
            for (const m of messages) {
                if (fingerprint(!!m.u, m.s, m.t) !== m.f) { rejected.push(m.f); continue; }
                stored += Number(insert.run(chat.story_id, m.f, m.u ? 1 : 0, m.s, m.n ?? null, m.t, now(), m.l?.length ? JSON.stringify(m.l) : null, m.v && typeof m.v === 'object' ? JSON.stringify(m.v) : null).changes);
            }
        });
        return { stored, rejected };
    }

    // 浏览器报来当前序列（每条的指纹）。缺正文 ⇒ 列出来让它补传；齐了 ⇒ 整体替换该窗口的序列。
    function sync({ chatKey, seq, members = null, anchors = null, force = false }) {
        const chat = requireChat(chatKey);
        const known = q('select 1 from messages where story_id = ? and fp = ?');
        const need = [...new Set(seq.map(x => x.f))].filter(fp => !known.get(chat.story_id, fp));
        if (need.length) return { committed: false, need };
        const oldRows = q('select fp, sw, sent_at from chat_seq where chat_key = ? order by pos').all(chatKey);
        const oldFps = oldRows.map(r => r.fp);
        const newFps = seq.map(x => x.f);
        if (!force && looksCollapsed(oldFps.length, newFps.length)) {
            log(chatKey, 'collapse_blocked', { before: oldFps.length, after: newFps.length });
            return { committed: false, need: [], collapsed: { before: oldFps.length, after: newFps.length } };
        }
        const change = diffSequences(oldFps, newFps);
        // 改前或改后是空消息的不算改稿：空消息的指纹人人一样（生成时的空占位），挂上链就把不相干的几条串成一条（试玩 10/7）
        const textOf = q('select text from messages where story_id = ? and fp = ?');
        const blank = fp => !String(textOf.get(chat.story_id, fp)?.text ?? '').trim();
        const edits = inPlaceEdits(oldRows, seq).filter(e => !blank(e.fp) && !blank(e.old));
        return tx(() => {
            q('delete from chat_seq where chat_key = ?').run(chatKey);
            const insert = q('insert into chat_seq(chat_key, pos, fp, hidden, sent_at, mark, sw, board_mark) values (?, ?, ?, ?, ?, ?, ?, ?)');
            seq.forEach((x, pos) => insert.run(chatKey, pos, x.f, x.h ? 1 : 0, x.d ?? null, validMark(x.k) ? x.k : null, Number.isInteger(x.w) ? x.w : null, typeof x.b === 'string' ? x.b : null));
            // 这个窗口有了动静（新消息、删了、改了、左滑换了）：记下来；上一次动静隔得久，记一段"没动静"（离开从这里算，10/3 用户）
            if (change.added || change.removed || edits.length) {
                const before = new Set(oldFps);
                touch(chatKey, [...newFps].reverse().find(f => before.has(f)) ?? null);
            }
            // 删掉的消息里最晚的那个时间（10/3：删回去重来以后，删掉的那几条上玩过的时间不能忘，不然离开计时把中间算成空白，一下算出离开了 27.9 小时）
            const kept = new Set(newFps);
            const gone = Math.max(Number(getMeta(`gone_sent:${chatKey}`)) || 0, ...oldRows.filter(r => !kept.has(r.fp)).map(r => Date.parse(r.sent_at ?? '')).filter(Number.isFinite));
            if (gone > 0) setMeta(`gone_sent:${chatKey}`, String(gone));
            // 改了一条（不是删了、不是左滑换了一版）：新字挂到旧字上——挂在它上面的规划、口袋那一步、局势、此刻的样子都留着；
            // 它重新记账以后，后面的了结接到新记录上（records.relinkEdited）
            for (const e of edits) markFreshened(e.fp, e.old);
            if (edits.length) log(chatKey, 'edited', { at: edits.map(e => e.pos) });
            // 同一条消息换了字（去复读改写、就地改稿）：挂在旧指纹上的进场、离开、结算那几份跟着换成新指纹
            // （试玩 10/13：点了"他发来消息"，进场记在上一条的旧字上，去复读一改，场记就认不出这次进场，发消息的人被当成走进了屋）
            const renamed = [];
            for (let k = 0; k < Math.min(oldRows.length, seq.length); k++) if (oldRows[k].fp !== seq[k].f && sameMessage(seq[k].f, oldRows[k].fp)) renamed.push([oldRows[k].fp, seq[k].f]);
            if (renamed.length) {
                const rows = q('select key, value from meta where key in (?, ?, ?) or key like ? or key like ?').all(`arrived:${chatKey}`, `arrivals:${chatKey}`, `away_plan:${chatKey}`, `settled_contact:${chatKey}:%`, `settled:${chatKey}:%`);
                for (const { key, value } of rows) { let v = String(value ?? ''); for (const [a, b] of renamed) v = v.split(a).join(b); if (v !== value) setMeta(key, v); }
            }
            // 最后一条角色回复左滑换了一版（不是改、不是删）：挂在它上面的规划、规划落账时撤掉和留下旧件的那几步，跟到新的这一版——
            // 试玩 10/14：第 18 号规划落账后玩家左滑了 #725，规划连同那几步都挂在旧那版上，一起没了，面板和场记退回第 17 号。
            // 记账、口袋递给谁那几步照旧不跟（那是照那版的字记的）；玩家自己那条换了一版也不跟（edits 测试）
            const tipAt = seq.length - 1;
            // 只认扩展报了左滑序号、而且序号换了的（没报序号的老页面，最后一条换了说不清是左滑还是删了重写，照旧不跟——expiry 测试）
            if (tipAt >= 0 && oldRows.length === seq.length && oldRows[tipAt].fp !== seq[tipAt].f && Number.isInteger(seq[tipAt].w) && oldRows[tipAt].sw != null && oldRows[tipAt].sw !== seq[tipAt].w
                && !edits.some(e => e.pos === tipAt) && !sameMessage(seq[tipAt].f, oldRows[tipAt].fp)
                && oldRows.slice(0, tipAt).every((r, k) => r.fp === seq[k].f)) {
                const userAt = fp => !!q('select is_user from messages where story_id = ? and fp = ?').get(chat.story_id, fp)?.is_user;
                if (!userAt(oldRows[tipAt].fp) && !userAt(seq[tipAt].f)) {
                    q('update plans set anchor_fp = ? where chat_key = ? and anchor_pos = ? and anchor_fp = ?').run(seq[tipAt].f, chatKey, tipAt, oldRows[tipAt].fp);
                    q("update menu_log set fp = ? where chat_key = ? and pos = ? and fp = ? and by_name = '规划'").run(seq[tipAt].f, chatKey, tipAt, oldRows[tipAt].fp);
                }
            }
            // 隔离扩展的在场区间：存原样的，后台用按两头时间认过位置的（landing.liveAnchors；删回去以后截短不作废、新写的不算进去）。
            // 这次没带区间（后台自己同步那回）：拿上回存的原样那份按新的序列再认一遍
            if (anchors) setMeta(`anchors_raw:${chatKey}`, JSON.stringify(anchors));
            let raw = anchors;
            if (!raw) try { raw = JSON.parse(getMeta(`anchors_raw:${chatKey}`) ?? 'null'); } catch {}
            const live = raw ? liveAnchors(raw, seq.map(x => x.d ?? null)) : null;
            q('update chats set synced_at = ?, members = coalesce(?, members), anchors = coalesce(?, anchors) where key = ?')
                .run(now(), members ? JSON.stringify(members) : null, live ? JSON.stringify(live) : null, chatKey);
            if (change.added || change.removed) log(chatKey, 'sync', { total: newFps.length, ...change, forced: force || undefined });
            if (chat.parent_key && chat.branch_len == null && newFps.length) branchLen(chat, newFps);
            // 接入时自动开了记账的（extract_from＝-1）：第一次同步时，带着一大段旧聊天的只从接入以后记（旧的要不要补记，面板上给估价由用户点，D-100）。
            if (chat.extract_from === -1) q('update chats set extract_from = ? where key = ?').run(newFps.length > 3 ? newFps.length : 0, chatKey);
            return { committed: true, need: [], total: newFps.length, ...change, ...(edits.length ? { edited: edits.map(e => e.pos) } : {}) };
        });
    }

    // 哪几条是就地改的（N-271）：同一个位置、前后挨着的都没变、只有这一条的字变了，而且正在用的还是同一版左滑。
    // 老扩展不带左滑序号：最后一条字变了多半是左滑换了一版，不算改稿。
    // 中间连着改了几条也算（质量窗 10/2：离线直接改聊天文件常一次改挨着的几条，以前只认孤零零的一条，挨着的都当删了重写）：
    // 连着变了的一段两头都没变、总条数不变、不超过 EDIT_RUN 条；挨着末尾的只认一条（末尾连着变多半是删回去重写了）。
    function inPlaceEdits(oldRows, seq) {
        const n = Math.min(oldRows.length, seq.length), out = [];
        const kept = i => oldRows[i].fp === seq[i].f;
        for (let i = 0; i < n; i++) {
            if (kept(i)) continue;
            let j = i;
            while (j + 1 < n && !kept(j + 1)) j++;
            const ok = (i === 0 || kept(i - 1)) && (j + 1 >= n ? oldRows.length === seq.length && i === j : j - i < EDIT_RUN);
            if (ok) for (let k = i; k <= j; k++) {
                const o = oldRows[k], x = seq[k];
                const sameSwipe = o.sw != null && Number.isInteger(x.w) ? o.sw === x.w : k < n - 1;
                if (sameSwipe && !sameMessage(x.f, o.fp)) out.push({ pos: k, fp: x.f, old: o.fp });
            }
            i = j;
        }
        return out;
    }

    // 窗口当前可见的消息（按位置）。后续的抽取、选料都从这里取。
    function currentMessages(chatKey) { return memo('messages', chatKey, () => readMessages(chatKey), copyArr); }
    function readMessages(chatKey) {
        return q(`select s.pos, s.fp, s.hidden, s.sent_at, s.mark, s.board_mark as boardMark, m.is_user, m.speaker, m.name, m.text, m.lore, m.vis
                  from chat_seq s join chats c on c.key = s.chat_key
                  join messages m on m.story_id = c.story_id and m.fp = s.fp
                  where s.chat_key = ? order by s.pos`).all(chatKey).map(r => {
            // 谁看得见的记号照 ST 消息的样子放回 extra.rp_vis（visibility.visOf 读这儿）
            if (!r.vis) return r;
            try { return { ...r, extra: { rp_vis: JSON.parse(r.vis) } }; } catch { return r; }
        });
    }

    // ver：钉住时那一版代码的指纹（slot.SLOT_CODE）；给了 ver 就只认同一版钉的（旧版本钉的、没记版本的都当没钉过）
    function getSlot({ chatKey, speaker, anchor, ver = undefined }) {
        const r = q('select text, ver from slots where chat_key = ? and speaker = ? and anchor = ?').get(chatKey, speaker, anchor);
        if (!r || r.ver === 'given' || (ver !== undefined && r.ver !== ver)) return null;   // given＝只记下给了什么，从不当钉住的用
        return r.text;
    }

    // parts＝这一格分块放时各块的文字（slot.mjs PLACES）；没有就是整格放最后
    function putSlot({ chatKey, speaker, anchor, text, ids = null, parts = null, ver = null }) {
        q('insert or replace into slots(chat_key, speaker, anchor, text, ids, parts, ver, created_at) values (?, ?, ?, ?, ?, ?, ?, ?)')
            .run(chatKey, speaker, anchor, text, ids?.length ? JSON.stringify(ids) : null, parts ? JSON.stringify(parts) : null, ver, now());
    }
    // 没钉住的那一格给了什么（ver＝given：getSlot 不当钉住的用；getSlotParts、recentSlotIds 照样读得到）
    function putGiven({ chatKey, speaker, anchor, text, ids = null, parts = null }) { putSlot({ chatKey, speaker, anchor, text, ids, parts, ver: 'given' }); }
    function getSlotParts({ chatKey, speaker, anchor }) {
        const r = q('select parts from slots where chat_key = ? and speaker = ? and anchor = ?').get(chatKey, speaker, anchor);
        try { return r?.parts ? JSON.parse(r.parts) : null; } catch { return null; }
    }

    // 这一格留下的余波（钉没钉住都记；同一格重组一次就换成新的，没有就删掉）。
    function putCarry({ chatKey, speaker, anchor, carry = [] }) {
        if (carry?.length) q('insert or replace into carries(chat_key, speaker, anchor, carry, created_at) values (?, ?, ?, ?, ?)').run(chatKey, speaker, anchor, JSON.stringify(carry), now());
        else q('delete from carries where chat_key = ? and speaker = ? and anchor = ?').run(chatKey, speaker, anchor);
    }

    // 这个角色在这段上文之前的格子里留下的余波。同一局的别的窗口（分支）也算，但得是一样的上文，连那一格写出来的回复都一样：
    // 那个窗口从头到那条回复为止和这个窗口一条不差（只比最后一条会认错——两个分支里用户说了同一句话）。
    // 自己窗口里只认锚点还在眼下序列里的（删稿、改稿回退后，后面的旧格子不算）。
    // 返回 [{ n, i, carry }]，新的在前，只含留了余波的格子；i＝那一格之后到眼下，他又开口了几次（按他的消息数，没钉住的格子也算）。
    function carryBefore({ chatKey, speaker, anchor = null }) {
        const chat = requireChat(chatKey);
        const at = n => { const v = parseInt(String(n), 10); return Number.isFinite(v) ? v : -1; };
        const seq = q('select s.pos, s.fp, m.speaker from chat_seq s join messages m on m.story_id = ? and m.fp = s.fp where s.chat_key = ? order by s.pos').all(chat.story_id, chatKey);
        const now = anchor == null ? seq.length : at(anchor);
        const mine = seq.map(r => r.fp);
        const shared = new Map([[chatKey, mine.length]]);
        const sharedWith = key => {
            if (!shared.has(key)) {
                const theirs = q('select fp from chat_seq where chat_key = ? order by pos').all(key);
                let n = 0;
                while (n < mine.length && n < theirs.length && theirs[n].fp === mine[n]) n++;
                shared.set(key, n);
            }
            return shared.get(key);
        };
        const byAnchor = new Map();
        for (const r of q('select s.chat_key, s.anchor, s.carry from carries s join chats c on c.key = s.chat_key where c.story_id = ? and s.speaker = ?').all(chat.story_id, speaker)) {
            const n = at(r.anchor);
            if (n < 1 || n >= now || byAnchor.has(n) || r.anchor !== `${n}:${mine[n - 1]}`) continue;
            // 余波跟着那一格写出来的那条回复走：这个窗口里第 n 条得是他开的口；别的窗口的，连那条回复都得一样
            // （只比上文会认错：从回来那一刻之前分出去的分支没有那次离开，却把回来后那一格的余波带了过去——Q 副本实测）。
            if (seq[n]?.speaker !== speaker || (r.chat_key !== chatKey && sharedWith(r.chat_key) < n + 1)) continue;
            byAnchor.set(n, JSON.parse(r.carry));
        }
        const spoke = seq.filter(r => r.speaker === speaker).map(r => r.pos);
        return [...byAnchor].map(([n, carry]) => ({ n, carry, i: spoke.filter(p => p > n && p < now).length })).sort((x, y) => y.n - x.n);
    }

    // 这个角色在这段上文之前最近几格里用过的记录（锚点 "N:指纹" 的 N＝当时的消息条数）。
    // 返回 记录编号 → 出现过几格。改稿回退后，锚点在后面的旧格子不算。
    function recentSlotIds({ chatKey, speaker, anchor = null, limit = 3 }) {
        const at = n => { const v = parseInt(String(n), 10); return Number.isFinite(v) ? v : -1; };
        const before = anchor == null ? Infinity : at(anchor);
        const rows = q('select anchor, ids from slots where chat_key = ? and speaker = ? and ids is not null').all(chatKey, speaker)
            .filter(r => at(r.anchor) < before).sort((a, b) => at(b.anchor) - at(a.anchor)).slice(0, limit);
        const counts = new Map();
        for (const r of rows) for (const id of JSON.parse(r.ids)) counts.set(id, (counts.get(id) ?? 0) + 1);
        return counts;
    }

    // 递过的"不在场的人来联系"机会。round＝那一轮用户那句话（一轮只递一个）；at＝当时的消息条数。
    function contactOffers(chatKey) {
        return q('select person, day, at, round, speaker from contact_offers where chat_key = ? order by id').all(chatKey);
    }
    function putContactOffer({ chatKey, person, day, at, round, speaker }) {
        q('insert into contact_offers(chat_key, person, day, at, round, speaker, created_at) values (?, ?, ?, ?, ?, ?, ?)')
            .run(chatKey, person, day, at, String(round).slice(-300), speaker ?? null, now());
    }

    // 名册（按局）：谁是主要角色、谁会来找、谁只是路过、谁还没出场。用户改过的（set_by = 'user'）不被自动覆盖。
    // interests：这个人的兴趣和习惯（D-109：生活感的来源）。这一局用户改过的优先，没改就用读卡写的那份（按卡存，各局共用）。
    function getCast(storyId) {
        return q(`select c.avatar, c.name, c.gender, c.role, c.hook, c.priority, c.bond, c.set_by, c.call, c.stranger, c.is_group, coalesce(c.interests, p.text) interests, c.interests is not null interests_own
                  from cast c left join card_profiles p on p.avatar = c.avatar where c.story_id = ? order by c.name`).all(storyId).map(({ gender, is_group, ...e }) => ({ ...e, ...(gender == null ? {} : { gender }), ...(is_group ? { 群体: true } : {}) }));
    }
    function profileOf(avatar) { return q('select avatar, hash, text, card_text, card_hash, card_name, updated_at from card_profiles where avatar = ?').get(avatar) ?? null; }
    // 存卡的正文（不动读卡写的那份）：hash＝这份正文的指纹
    function putCardText(avatar, name, hash, text) {
        q(`insert into card_profiles(avatar, hash, text, card_text, card_hash, card_name, updated_at) values (?, '', null, ?, ?, ?, ?)
           on conflict(avatar) do update set card_text = excluded.card_text, card_hash = excluded.card_hash, card_name = excluded.card_name, updated_at = excluded.updated_at`)
            .run(avatar, String(text ?? '').slice(0, 20000), hash, name ?? null, now());
    }
    function putProfile(avatar, hash, text) {
        q('insert into card_profiles(avatar, hash, text, updated_at) values (?, ?, ?, ?) on conflict(avatar) do update set hash = excluded.hash, text = excluded.text, updated_at = excluded.updated_at').run(avatar, hash, text ?? null, now());
    }
    function setInterests(storyId, avatar, text) {
        q('update cast set interests = ?, updated_at = ? where story_id = ? and avatar = ?').run(typeof text === 'string' && text.trim() ? text.trim().slice(0, 1600) : null, now(), storyId, avatar);
    }
    function putCast(storyId, entries, { byUser = false } = {}) {
        const existing = new Map(getCast(storyId).map(e => [e.avatar, e]));
        tx(() => {
            const up = q(`insert into cast(story_id, avatar, name, role, hook, priority, bond, set_by, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)
                          on conflict(story_id, avatar) do update set name = excluded.name, role = excluded.role, hook = excluded.hook,
                          priority = excluded.priority, bond = excluded.bond, set_by = excluded.set_by, updated_at = excluded.updated_at`);
            for (const e of entries) {
                const old = existing.get(e.avatar);
                if (!byUser && old?.set_by === 'user') {
                    if (old.name !== e.name) q('update cast set name = ? where story_id = ? and avatar = ?').run(e.name, storyId, e.avatar);
                    continue;
                }
                const bond = e.bond === undefined ? (old?.bond ?? null) : Number.isInteger(e.bond) && e.bond >= 0 && e.bond <= 5 ? e.bond : null;
                up.run(storyId, e.avatar, e.name, e.role, e.hook ?? old?.hook ?? null, e.priority != null ? (e.priority ? 1 : 0) : (old?.priority ?? 0), bond, byUser ? 'user' : 'auto', now());
                if (e.gender !== undefined) q('update cast set gender = ? where story_id = ? and avatar = ?').run(e.gender || null, storyId, e.avatar);
                if (typeof e.群体 === 'boolean') q('update cast set is_group = ? where story_id = ? and avatar = ?').run(e.群体 ? 1 : 0, storyId, e.avatar);
                if (e.call !== undefined || e.stranger !== undefined) q('update cast set call = ?, stranger = ? where story_id = ? and avatar = ?').run(e.call ?? old?.call ?? null, e.stranger === undefined ? (old?.stranger ?? null) : e.stranger == null ? null : e.stranger ? 1 : 0, storyId, e.avatar);
            }
        });
        return getCast(storyId);
    }

    // 离开记录（按窗口）：从哪条消息之后离开、离开了多久；seen＝回来后已经拿到过"回来"那段的角色。
    // 这个窗口看得见的离开：自己的，加上一路往上的窗口里、分叉前就记下的（离开挂在离开前那条消息上，那条在共有的前缀里才算）。
    // 同一次离开（同一条消息）在几个窗口里各记了一份的，只算一次，先认自己这份。
    function absences(chatKey) {
        const h = historyOf(chatKey);
        const rows = q(`select a.*, s.pos from_pos from absences a left join chat_seq s on s.chat_key = a.chat_key and s.fp = a.from_fp
                  where a.chat_key in (${h.keys.map(() => '?').join(', ')}) order by a.id`).all(...h.keys)
            .filter(a => a.chat_key === chatKey || (a.from_pos != null && h.sees(a.chat_key, a.from_pos, a.from_fp)))
            .sort((a, b) => (a.chat_key === chatKey ? 0 : 1) - (b.chat_key === chatKey ? 0 : 1) || a.id - b.id);
        const seenFp = new Set();
        return rows.filter(a => !seenFp.has(a.from_fp) && seenFp.add(a.from_fp)).sort((a, b) => a.id - b.id)
            .map(a => ({ ...a, seen: JSON.parse(a.seen), story: a.story ? JSON.parse(a.story) : null }));
    }
    function putAbsence({ chatKey, fromFp, toFp = null, startedAt, endedAt, hours, days }) {
        q(`insert or ignore into absences(chat_key, from_fp, to_fp, started_at, ended_at, hours, days, created_at)
           values (?, ?, ?, ?, ?, ?, ?, ?)`).run(chatKey, fromFp, toFp, startedAt, endedAt, hours, days, now());
        return absences(chatKey).find(a => a.from_fp === fromFp);
    }
    // 玩家交代了实际过了几天（重推离开时，质量窗 10/3）：0＝其实没空白，日期不跳、回来那一段和余波都撤
    function setAbsenceDays(id, days) { q('update absences set days = ? where id = ?').run(days, id); }
    function setAbsenceStory(id, status, story = null) {
        q('update absences set story_status = ?, story = coalesce(?, story) where id = ?').run(status, story ? JSON.stringify(story) : null, id);
    }
    function markAbsenceSeen(id, speaker) {
        const row = q('select seen from absences where id = ?').get(id);
        const seen = new Set(JSON.parse(row?.seen ?? '[]')); seen.add(speaker);
        q('update absences set seen = ? where id = ?').run(JSON.stringify([...seen]), id);
    }

    // 全局小设置（离开计时暂停等）。
    // 离开＝这个窗口多久没有任何动静（10/3 用户：没输入、没删、没改；以前按最后一条消息的时间算，删回去重来就错）。
    // act:<窗口>＝最近一次动静；gap:<窗口>＝最近一段一小时以上的"没动静"（从哪条之后、从几点到几点），离开记账时（slot.noteAbsence）按设的小时数取用。
    // 还没记过动静的窗口（刚接入、老数据）不在这里起头：第一次组那一格时按消息时间算一次，再从那时起记。
    const GAP_MIN_MS = 3600000;
    function touch(chatKey, fromFp = null, at = Date.now()) {
        let act = null;
        try { act = JSON.parse(getMeta(`act:${chatKey}`) ?? 'null'); } catch {}
        if (!act?.last) return;
        if (at - act.last >= GAP_MIN_MS) setMeta(`gap:${chatKey}`, JSON.stringify({ from: act.last, to: at, fromFp }));
        setMeta(`act:${chatKey}`, JSON.stringify({ last: at }));
    }
    function getMeta(key) { return memo('meta', key, () => q('select value from meta where key = ?').get(key)?.value ?? null); }
    function setMeta(key, value) { q('insert or replace into meta(key, value) values (?, ?)').run(key, value == null ? null : String(value)); }

    // ---------- 规划与菜单（M6）：跟着消息走 ----------
    // 要规划、进口袋、用掉、沉底，每一步都记在"当时这个窗口的最后一条消息"上。
    // 窗口认不认一步＝那条消息还在不在它的序列里：删到那条之前＝没发生过（规划撤回，菜单项退回上一步）。
    // 分支只带上一个窗口里、分叉点之前就已经生效的（那条消息之后还有共有的消息）；分叉点上刚要的、分叉后才发生的都不带。

    // 分支和上一个窗口共有的前缀条数（第一次同步时量，量过就不变）。
    function branchLen(chat, fps = null) {
        if (chat.branch_len != null) return chat.branch_len;
        const own = fps ?? q('select fp from chat_seq where chat_key = ? order by pos').all(chat.key).map(r => r.fp);
        if (!own.length) return 0;
        const parent = q('select fp from chat_seq where chat_key = ? order by pos').all(chat.parent_key).map(r => r.fp);
        let n = 0;
        while (n < own.length && n < parent.length && own[n] === parent[n]) n++;
        q('update chats set branch_len = ? where key = ?').run(n, chat.key);
        return n;
    }

    // 这个窗口的来历：自己＋一路往上的窗口，各自只算到分叉处。
    // 去复读换过几句的那条（后台自己改的，意思没变）：改后的指纹记一笔"原来是哪条"，挂在原来那条上的东西（兴头、规划的一步）照认。
    // 试玩 9/30：去复读几乎每条都改，挂在刚写完那条上的兴头全被当成作废了。用户自己改稿、左滑出来的新消息不在这里，照旧作废。
    // 此刻的样子（core/state.mjs）：每一笔挂在写到它的那条消息上；读出来时按这个窗口此刻的序列排（去复读改过的那条照认）。
    // 场次摘要（N-284）：存的是一段消息的经过，读的时候按这个窗口此刻的消息核一遍（liveEpisodes）。
    function putEpisodes(storyId, list, model = null) {
        const ins = q('insert into episodes(story_id, from_pos, to_pos, span, place, present, text, model, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)');
        tx(() => { for (const e of list) ins.run(storyId, e.from, e.to, e.span, e.place ?? '', JSON.stringify(e.present ?? []), e.story, model, now()); });
    }
    function episodesOf(chatKey) {
        const chat = requireChat(chatKey);
        const rows = q('select * from episodes where story_id = ?').all(chat.story_id).map(r => ({ ...r, present: JSON.parse(r.present ?? '[]') }));
        return liveEpisodes(rows, currentMessages(chatKey).map(m => m.fp));
    }
    function editEpisode(storyId, id, text) {
        return q('update episodes set text = ?, edited = 1 where id = ? and story_id = ?').run(String(text).slice(0, 1200), id, storyId).changes > 0;
    }
    function putStateNotes(storyId, items) {
        const ins = q('insert into state_notes(story_id, fp, who, aspect, text, created_at) values (?, ?, ?, ?, ?, ?)');
        for (const x of items) ins.run(storyId, x.fp, x.who, x.aspect, x.text, now());
    }
    function stateNotesOf(chatKey) { return memo('notes', chatKey, () => readStateNotes(chatKey), copyArr); }
    function readStateNotes(chatKey) {
        const chat = requireChat(chatKey);
        const rows = q('select id, fp, who, aspect, text from state_notes where story_id = ?').all(chat.story_id);
        if (!rows.length) return [];
        const byFp = new Map();
        for (const r of rows) byFp.set(r.fp, [...(byFp.get(r.fp) ?? []), r]);
        const out = [];
        for (const m of currentMessages(chatKey)) {
            let fp = m.fp;
            for (let i = 0; i < 4 && fp; i++) { for (const r of byFp.get(fp) ?? []) out.push({ ...r, pos: m.pos }); fp = getMeta(`fresh_from:${fp}`); }
        }
        return out;
    }
    // 这一局玩家用过的名字：历史消息、各窗口当前人设、已确认规划人设。
    function playerNames(storyId) {
        const names = q('select distinct name from messages where story_id = ? and is_user = 1 and name is not null').all(storyId).map(r => r.name);
        for (const chat of q('select key from chats where story_id = ?').all(storyId)) {
            try { names.push(JSON.parse(getMeta(`persona:${chat.key}`) ?? 'null')?.name); } catch {}
        }
        names.push(getMeta(`plan_persona:${storyId}`));
        return [...new Set(names.filter(n => typeof n === 'string').map(n => n.trim()).filter(Boolean))];
    }
    function markFreshened(newFp, oldFp) { if (newFp && oldFp && newFp !== oldFp) setMeta(`fresh_from:${newFp}`, oldFp); }
    function sameMessage(currentFp, anchorFp) {
        let fp = currentFp;
        for (let i = 0; i < 4 && fp; i++) { if (fp === anchorFp) return true; fp = getMeta(`fresh_from:${fp}`); }
        return false;
    }
    function historyOf(chatKey) {
        const seq = q('select fp from chat_seq where chat_key = ? order by pos').all(chatKey).map(r => r.fp);
        const limits = new Map();
        let chat = getChat.get(chatKey), limit = Infinity;
        while (chat && !limits.has(chat.key)) {
            limits.set(chat.key, limit);
            if (!chat.parent_key) break;
            limit = Math.min(limit, branchLen(chat));
            chat = getChat.get(chat.parent_key);
        }
        const last = seq.length - 1;
        // origin 窗口里记在第 pos 条（指纹 fp）上的一步，这个窗口认不认。
        const sees = (origin, pos, fp) => {
            const cut = limits.get(origin);
            if (cut == null) return false;
            if (pos == null) return cut === Infinity;   // 没有锚点的旧数据：只认本窗口
            if (pos >= 0 && !sameMessage(seq[pos], fp)) return false;
            // 分叉的那条本身是共有的：记在它上面的（比如在它之后要的规划）也带过去（D-100 改 D-67②：从最新一条分支，不必再花一份规划钱）。
            return cut === Infinity || pos < cut;
        };
        return { last, lastFp: seq[last] ?? null, keys: [...limits.keys()], sees };
    }

    // basis：因为哪条消息上的判定（转向、弄断、局面变了）要的这份规划——那条删了、改了，这份也不算（用户 10/4）
    const basisOf = p => { try { return JSON.parse(getMeta(`plan_basis:${p.id}`) ?? 'null'); } catch { return null; } };
    function plansOf(chatKey, h = historyOf(chatKey)) {
        return q(`select * from plans where chat_key in (${h.keys.map(() => '?').join(', ')}) and status != 'withdrawn' order by id`).all(...h.keys)
            .filter(p => h.sees(p.chat_key, p.anchor_pos, p.anchor_fp))
            .filter(p => (b => !b || h.sees(p.chat_key, b.pos, b.fp))(basisOf(p)))
            .sort((a, b) => (a.anchor_pos ?? -1) - (b.anchor_pos ?? -1) || a.id - b.id);
    }
    function lastPlan(chatKey) { return plansOf(chatKey).at(-1) ?? null; }
    function lastReadyPlan(chatKey) { return plansOf(chatKey).filter(p => p.status === 'ready').at(-1) ?? null; }
    function readyPlans(chatKey) { return plansOf(chatKey).filter(p => p.status === 'ready'); }
    function planById(id) { return q('select * from plans where id = ?').get(id) ?? null; }
    function setPlanBrief(id, brief) { q('update plans set brief = ? where id = ?').run(brief, id); }
    // 还在等人写的；要它的那段已经删掉了的，顺手撤回。
    function stillWanted(plan) {
        const h = historyOf(plan.chat_key), b = basisOf(plan);
        if (h.sees(plan.chat_key, plan.anchor_pos, plan.anchor_fp) && (!b || h.sees(plan.chat_key, b.pos, b.fp))) return true;
        q("update plans set status = 'withdrawn', ready_at = ? where id = ?").run(now(), plan.id);
        return false;
    }
    function pendingPlans() {
        return q("select * from plans where status = 'requested' order by id").all().filter(stillWanted)
            .map(({ id, chat_key, reason, story_day, provider, created_at }) => ({ id, chat_key, reason, story_day, provider, created_at }));
    }
    function requestPlan({ chatKey, storyDay, reason, provider, brief, basis = null, rerollOf = null }) {
        const h = historyOf(chatKey);
        const id = Number(q("insert into plans(chat_key, status, reason, story_day, provider, brief, anchor_pos, anchor_fp, created_at) values (?, 'requested', ?, ?, ?, ?, ?, ?, ?)")
            .run(chatKey, reason, storyDay, provider, brief, h.last, h.lastFp, now()).lastInsertRowid);
        if (basis && Number.isInteger(basis.pos) && basis.fp) setMeta(`plan_basis:${id}`, JSON.stringify({ pos: basis.pos, fp: basis.fp }));
        if (rerollOf != null) setMeta(`replan_of:${id}`, String(rerollOf));
        return id;
    }
    function failPlan(id, error) { q("update plans set status = 'failed', error = ?, ready_at = ? where id = ?").run(String(error).slice(0, 1000), now(), id); }
    // 一个节点一次只跑一个逻辑尝试，备料也算进行中；长时间等外援不占调用登记。
    const planFlights = new Map();
    const nodeOf = id => { let next = Number(id), seen = new Set(); while (!seen.has(next)) { seen.add(next); const parent = Number(getMeta(`replan_of:${next}`)); if (!parent) break; next = parent; } return next; };
    const flightKey = (chatKey, id) => `${chatKey}:${nodeOf(id)}`;
    function activePlanAttempt(chatKey, id) { return planFlights.get(flightKey(chatKey, id)) ?? null; }
    function beginPlanAttempt(planId, { entry = 'auto', model = null, thinks = false, briefChars = 0, supplement = false } = {}) {
        const plan = planById(planId);
        if (!plan || !stillWanted(plan) || (supplement ? plan.status !== 'ready' || lastReadyPlan(plan.chat_key)?.id !== plan.id : plan.status !== 'requested' || lastPlan(plan.chat_key)?.id !== plan.id)) return null;
        const key = flightKey(plan.chat_key, plan.id);
        if (planFlights.has(key)) return null;
        const id = randomUUID();
        q("insert into plan_attempts(id,plan_id,node_id,chat_key,entry,model,thinks,brief_chars,stage,status,started_at) values (?,?,?,?,?,?,?,?,'发出','running',?)")
            .run(id, plan.id, nodeOf(plan.id), plan.chat_key, ['auto','button','supplement','handoff'].includes(entry) ? entry : 'auto', typeof model === 'string' ? model.slice(0, 200) : null, thinks ? 1 : 0, Math.max(0, Number(briefChars) || 0), now());
        planFlights.set(key, { id, planId: plan.id, supplement, started: Date.now() });
        return id;
    }
    function ownsPlanAttempt(id) {
        const attempt = q('select * from plan_attempts where id = ?').get(id);
        if (!attempt || attempt.status !== 'running') return false;
        const flight = activePlanAttempt(attempt.chat_key, attempt.plan_id), plan = planById(attempt.plan_id);
        return flight?.id === id && !!plan && stillWanted(plan) && (flight.supplement ? plan.status === 'ready' && lastReadyPlan(plan.chat_key)?.id === plan.id : plan.status === 'requested' && lastPlan(plan.chat_key)?.id === plan.id);
    }
    function updatePlanAttempt(id, meta = {}) {
        const columns = { stage: 'stage', outputChars: 'output_chars', internalRetries: 'internal_retries', finishReason: 'finish_reason', briefChars: 'brief_chars' };
        const values = [];
        for (const [key, col] of Object.entries(columns)) if (Object.hasOwn(meta, key)) {
            let value = meta[key];
            if (['outputChars','internalRetries','briefChars'].includes(key)) { if (!Number.isFinite(value) || value < 0) continue; value = Math.floor(value); }
            else if (key === 'stage') { if (!['发出','备料','流式中','流中断','解析','落账','等外援'].includes(value)) continue; }
            else value = typeof value === 'string' ? value.slice(0, 80) : null;
            values.push([col, value]);
        }
        if (values.length) q(`update plan_attempts set ${values.map(([k]) => `${k} = ?`).join(',')} where id = ? and status = 'running'`).run(...values.map(([,v]) => v), id);
    }
    function finishPlanAttempt(id, { status = 'done', failure = null, ...meta } = {}) {
        updatePlanAttempt(id, meta);
        const row = q('select * from plan_attempts where id = ?').get(id);
        if (!row || row.status !== 'running') return;
        const key = flightKey(row.chat_key, row.plan_id), flight = planFlights.get(key);
        const safeFailure = ['timeout','connection','truncated','bad_answer','unavailable','late'].includes(failure) ? failure : null;
        q('update plan_attempts set status = ?, failure = ?, finished_at = ?, elapsed_ms = ? where id = ?').run(['done','failed','late','queued'].includes(status) ? status : 'failed', safeFailure, now(), Math.max(0, Date.now() - (flight?.started ?? Date.parse(row.started_at))), id);
        if (flight?.id === id) planFlights.delete(key);
        if (status === 'late') log(row.chat_key, 'plan_late', { attemptId: id, planId: row.plan_id, why: '迟到作废' });
    }
    function planAttempts(chatKey, limit = 20) {
        return q('select * from plan_attempts where chat_key = ? order by rowid desc limit ?').all(chatKey, Math.min(20, Math.max(1, limit)))
            .map(r => ({ attemptId: r.id, planId: r.plan_id, nodeId: r.node_id, entry: r.entry, model: r.model, thinks: !!r.thinks, briefChars: r.brief_chars, outputChars: r.output_chars, internalRetries: r.internal_retries, stage: r.stage, finishReason: r.finish_reason, failure: r.failure, status: r.status, startedAt: r.started_at, finishedAt: r.finished_at, ms: r.elapsed_ms ?? Math.max(0, Date.now() - Date.parse(r.started_at)) }));
    }
    function planningState(chatKey) {
        const plan = lastPlan(chatKey), attempts = planAttempts(chatKey), latest = attempts.find(a => a.planId === plan?.id);
        const running = plan && activePlanAttempt(chatKey, plan.id);
        const external = !!plan && plan.status === 'requested' && !!pendingHandoff('plan', String(plan.id));
        const failed = attempts.find(a => a.planId === plan?.id && a.status === 'failed');
        const failure = latest?.status === 'done' ? null : failed?.failure ?? null;
        const labels = { timeout: '上游超时', connection: '连接断了', bad_answer: '答坏了', truncated: '被截断', unavailable: '线路未配置或到了花费上限' };
        const message = plan?.status === 'ready' && !running && !failure ? '' : [failure && `规划没成功（${labels[failure] ?? '连接断了'}），后台会再试；也可以点“重新规划”`, external && '规划交给外援了', running && '正在重新规划'].filter(Boolean).join('。');
        return { planId: plan?.id ?? null, running: !!running, external, failure, message, attempts };
    }
    function intimateEvents(table, chatKey) {
        const h = historyOf(chatKey), plans = new Set(readyPlans(chatKey).map(p => p.id));
        return q(`select * from ${table} where chat_key in (${h.keys.map(() => '?').join(',')}) order by id desc`).all(...h.keys)
            .filter(r => h.sees(r.chat_key, r.pos, r.fp) && (r.plan_id == null || plans.has(r.plan_id)))
            .map(r => ({ ...r, people: JSON.parse(r.people) }));
    }
    function intimateProgressOf(chatKey) {
        return intimateEvents('intimate_progress', chatKey).map(r => ({ 谁和谁: r.people, 现在: r.current_text, 依据: r.basis, day: r.story_day, pos: r.pos, source: r.source }));
    }
    function putIntimateProgress(chatKey, progress, { planId = null, storyDay = 0, source = 'planner', at = null } = {}) {
        const h = historyOf(chatKey), anchor = at ?? { pos: h.last, fp: h.lastFp };
        const ins = q('insert into intimate_progress(chat_key,plan_id,people,current_text,basis,story_day,pos,fp,source) values (?,?,?,?,?,?,?,?,?)');
        for (const row of progress ?? []) ins.run(chatKey, planId, JSON.stringify(row['谁和谁']), row.现在, row.依据, storyDay, anchor.pos, anchor.fp, source);
    }
    function logIntimateStop(chatKey, people, scene) {
        const h = historyOf(chatKey);
        for (const pair of people) q('insert into intimate_stops(chat_key,people,story_day,place,part,pos,fp) values (?,?,?,?,?,?,?)').run(chatKey, JSON.stringify(pair), scene.day, scene.place, scene.part, h.last, h.lastFp);
    }
    const intimateStopsOf = chatKey => intimateEvents('intimate_stops', chatKey);
    function submitPlan(id, args) {
        const rerollOf = Number(getMeta(`replan_of:${id}`)) || null;
        return rerollOf ? tx(() => submitPlanCore(id, args, rerollOf)) : submitPlanCore(id, args);
    }
    // 交回的菜单落账。旧菜单里还没放出来的由新菜单接手（见 menuOf），口袋里那一样留着。
    // crew、romance、gaps（章程 K1）：规划交回的"主角团""感情线""口子"，存进 node（node.主角团、node.感情线、node.口子；没写的不加这一格）
    // keyPeople（用户 10/12，M 数据约定第 2 条）：规划交回的"要紧的人"（主角团以外有自己打算的，带心思），存进 node.要紧的人；没写的不加这一格
    function submitPlanCore(id, { goal, node: planNode = null, items: offeredItems, bringNext, raw, dropped = [], olds = [], warnings = [], crew = [], keyPeople = [], romance = '', gaps = [], intimateProgress = [] }, rerollOf = null) {
        const node = planNode ? { ...planNode, ...(crew?.length ? { 主角团: crew } : {}), ...(keyPeople?.length ? { 要紧的人: keyPeople } : {}), ...(romance ? { 感情线: romance } : {}), ...(gaps?.length ? { 口子: gaps } : {}) } : null;
        const plan = planById(id);
        if (!plan) throw new Error('no_such_plan');
        if (plan.status !== 'requested' || !stillWanted(plan)) throw Object.assign(new Error('plan_withdrawn'), { status: 409 });
        // 规划者交回来、没过核对的那几件（缺六格、写到用不上的人……）：记一句，排查时看得见退了哪件、缺什么
        if (dropped?.length) log(plan.chat_key, 'plan_dropped', { plan: id, items: dropped.map(d => d.reason ?? String(d)).slice(0, 48) });
        // 只提醒、不退件的（头一格太密……，章程 H5）
        if (warnings?.length) log(plan.chat_key, 'plan_warnings', { plan: id, warnings: warnings.slice(0, 12) });
        const nameOf = x => String(x ?? '').trim();
        // 题带了人名前缀（"某人「题」"）的，拿「」里那几个字对
        const bare = x => { const s = nameOf(x); return s.match(/「([^」]+)」/)?.[1].trim() || s; };
        const near = (x, y) => x.length >= 2 && y.length >= 2 && (x.includes(y) || y.includes(x));
        // 规划者对旧件的回答（章程 H3）：留／撤／换，按题对上此刻还排着、在口袋里的旧件（同题的几件一起）。
        // 换：接替它的那件（"换成"）这一份里收下了才算——没收下（缺格退了、没写）当没答，照下面 F1 的规矩
        if (rerollOf && lastReadyPlan(plan.chat_key)?.id !== rerollOf) throw Object.assign(new Error('plan_superseded'), { status: 409 });
        const rerolled = rerollOf ? menuOf(plan.chat_key).filter(m => m.plan_id === rerollOf && ['waiting','pocket'].includes(m.status)) : [];
        const rerolledIds = new Set(rerolled.map(m => m.id));
        const open = menuOf(plan.chat_key).filter(m => !rerolledIds.has(m.id) && m.plan_id !== id && (m.status === 'waiting' || m.status === 'pocket'));
        const offeredTitle = t => offeredItems.find(n => nameOf(n.title) === nameOf(t)) ?? offeredItems.find(n => bare(n.title) === bare(t));
        const answer = new Map();   // 旧件 id → { how, by }
        const unmatched = [];
        for (const o of rerollOf ? [] : olds ?? []) {
            const hits = open.filter(m => bare(m.title) === bare(o.title));
            if (!hits.length) { unmatched.push(`「${o.title}」（${o.how}）`); continue; }
            const by = o.how === '换' ? offeredTitle(o.to) : null;
            if (o.how === '换' && !by) { unmatched.push(`「${o.title}」换成「${o.to}」，那件没收下`); continue; }
            for (const m of hits) if (!answer.has(m.id)) answer.set(m.id, { how: o.how, by });
        }
        if (unmatched.length) log(plan.chat_key, 'plan_olds_unmatched', { plan: id, olds: unmatched.slice(0, 24) });
        // 重复不收（章程 F1，试玩 10/10：规划重算三回，同一拍子写了三回）：新件和还活着的旧件同线、同用意、题相近——
        // 旧件还在口袋里的，新件不收；旧件还排着的（局势排的后续，换了规划也留着），留一件：新规划的这件替换旧件。
        // 旧件已经拿出来了、沉了的不算活着：新件接着写，照收。没写用意的旧件认不出是不是同一拍子，交给下面那条（同一个人同一条线排了后续）
        const follow = m => m.motif === '后续' || m.motif === '后续·当下';
        const retire = RETIRES_POCKET.has(plan.reason);
        const stays = m => follow(m) || m.kept_pos != null || answer.get(m.id)?.how === '留';   // 换了规划也留着的：局势排的后续、规划者留下的
        const alive = menuOf(plan.chat_key).filter(m => !rerolledIds.has(m.id) && ((m.status === 'pocket' && (stays(m) || !retire)) || (m.status === 'waiting' && stays(m))));
        const items = [], replaced = [];
        for (const n of offeredItems) {
            // 撤了、换了的旧件不算活着（换的那件就是接替它的，照收）；答了留的，新件和它同一拍子就不收（说了留，又写了一遍）
            const old = alive.find(o => sameBeat(o, n) && !['撤', '换'].includes(answer.get(o.id)?.how));
            if (old && (old.status === 'pocket' || answer.get(old.id)?.how === '留')) { log(plan.chat_key, 'plan_dropped', { plan: id, items: [`「${n.title}」和${old.status === 'pocket' ? '口袋里' : '留下'}的「${old.title}」是同一拍子（${old.line}／${old.purpose}），不收`] }); continue; }
            // 答了留的旧件，新件和它同题、或题互相包含又是同一个人牵头（章程 H5：说了留，又换条线、换个用意重写一遍）：新件不收
            const keptOld = open.find(o => answer.get(o.id)?.how === '留'
                && (bare(o.title) === bare(n.title) || (near(bare(o.title), bare(n.title)) && nameOf(o.who) === nameOf(n.who))));
            if (keptOld) { log(plan.chat_key, 'plan_dropped', { plan: id, items: [`「${n.title}」留的旧件已有（「${keptOld.title}」），不收`] }); continue; }
            if (old) replaced.push({ old, by: n });
            items.push(n);
        }
        // 新规划给同一个人、同一条线（或题互相包含的）排了后续：旧的那件还没放出来、还在口袋里的收掉（场记章程第 11 条，试玩 10/10：
        // "推完以后的读数"排上了，"三天后的读数"还挂在门上）。这一步记在要这份规划的那条消息上：那条删了，规划退了，旧件也回来
        // 只看新规划落账以后还留着的旧件（旧规划没放出来的本来就由新规划接手，见 menuOf；这里收的是还挂着的口袋、局势排的后续）
        // 规划者答过的旧件照它的答办，不再按这条猜
        const overtakenBy = old => items.find(n => nameOf(n.who) && nameOf(n.who) === nameOf(old.who)
            && ((nameOf(n.line) && nameOf(n.line) === nameOf(old.line)) || near(nameOf(n.title), nameOf(old.title))));
        (rerollOf ? (fn => fn()) : tx)(() => {
            const ins = q(`insert into menu(plan_id, chat_key, who, title, surface, respond, sink, fit, weight, know, line, after_title, motif, promise_ref, offscreen, ready_day, updated_at, entry, place, goer, errand, origin, ${CELL_COLS}) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${CELL_MARKS})`);
            for (const m of items) ins.run(id, plan.chat_key, m.who, m.title, m.surface, m.respond, m.sink || null, m.fit || null, m.weight || null, m.know || null, m.line || null, m.after || null, m.motif || null, m.promiseRef ?? null, m.offscreen ? 1 : 0, plan.story_day + m.afterDays, now(), m.entry ?? null, m.place || null, m.goer || null, m.errand || null, m.origin || null, ...cellValues(m));
            q("update plans set status = 'ready', goal = ?, node = ?, bring_next = ?, raw = ?, ready_at = ? where id = ?").run(goal ?? null, node ? JSON.stringify(node) : null, JSON.stringify(bringNext ?? []), raw ?? null, now(), id);
            q('update notes set used_in_plan = ? where chat_key = ? and kind = ? and used_in_plan is null').run(id, plan.chat_key, '聊');
            if (items.length) putIntimateProgress(plan.chat_key, intimateProgress, { planId: id, storyDay: plan.story_day });
        });
        for (const { old, by } of plan.anchor_pos == null ? [] : replaced) {
            updateMenu(plan.chat_key, old.id, { status: 'void', by: '规划', why: `新规划里同一拍子的「${by.title}」替换了它`, at: { pos: plan.anchor_pos, fp: plan.anchor_fp } });
            log(plan.chat_key, 'menu_void', { id: old.id, title: old.title, plan: id, why: `同一拍子（${old.line}／${old.purpose}）新规划又写了一回「${by.title}」，留新的，旧的「${old.title}」收了` });
        }
        // 照规划者的答办：撤 → 撤下；换 → 旧件撤下（接替它的那件上面照收了）；留 → 不动——旧规划里还排着的本来由新规划接手（menuOf），
        // 答了留的记一步"留下"，换了规划也接着排。都记在要这份规划的那条消息上：那条删了，规划退了，这几步也跟着不算
        const at = { pos: plan.anchor_pos, fp: plan.anchor_fp };
        for (const [oldId, { how, by }] of plan.anchor_pos == null ? [] : answer) {
            const old = open.find(m => m.id === oldId);
            if (how === '留') { updateMenu(plan.chat_key, oldId, { status: KEPT, by: '规划', why: '规划者留下的', at }); continue; }
            if (how === '换' && !items.includes(by)) { updateMenu(plan.chat_key, oldId, { status: KEPT, by: '规划', why: `规划者要换成「${by.title}」，那件没收下，旧的留着`, at }); continue; }
            const why = how === '撤' ? '规划者撤的' : `规划者换成了「${by.title}」`;
            updateMenu(plan.chat_key, oldId, { status: 'void', by: '规划', why, at });
            log(plan.chat_key, 'menu_void', { id: oldId, title: old?.title ?? '', plan: id, why });
        }
        const left = plan.anchor_pos == null || rerollOf ? [] : menuOf(plan.chat_key).filter(m => m.plan_id !== id && (m.status === 'waiting' || m.status === 'pocket') && !answer.has(m.id));
        for (const { old, by } of left.map(old => ({ old, by: overtakenBy(old) })).filter(x => x.by)) {
            updateMenu(plan.chat_key, old.id, { status: 'void', by: '规划', why: `新规划给${old.who}排了后续「${by.title}」`, at: { pos: plan.anchor_pos, fp: plan.anchor_fp } });
            log(plan.chat_key, 'menu_void', { id: old.id, title: old.title, plan: id, why: `新规划给${old.who}排了后续「${by.title}」${nameOf(by.line) && nameOf(by.line) === nameOf(old.line) ? `（同一条线：${old.line}）` : ''}，旧的「${old.title}」收了` });
        }
        if (rerollOf) {
            for (const old of rerolled) updateMenu(plan.chat_key, old.id, { status: 'void', by: '规划', why: '被重新规划替换', at: { pos: plan.anchor_pos, fp: plan.anchor_fp } });
            setMeta(`plan_revision:${plan.chat_key}`, String(Number(getMeta(`plan_revision:${plan.chat_key}`) ?? 0) + 1));
        }
        if (rerollOf || activePlanAttempt(plan.chat_key, id)) setMeta(`notice:${plan.chat_key}`, JSON.stringify({ id: `plan-ready-${id}`, text: '新规划已生效' }));
        return menuOf(plan.chat_key);
    }
    // 给眼下这份规划补几件（角色起的新念头，D-107）：挂在 at 那条消息上；从 storyDay 起算第几天后。
    function appendMenu(planId, items, { storyDay, at, intimateProgress = [] }) {
        const plan = planById(planId);
        if (!plan || plan.status !== 'ready') throw Object.assign(new Error('plan_not_ready'), { status: 409 });
        tx(() => {
            const ins = q(`insert into menu(plan_id, chat_key, who, title, surface, respond, sink, fit, weight, know, line, after_title, motif, promise_ref, offscreen, ready_day, anchor_pos, anchor_fp, updated_at, entry, place, goer, errand, origin, ${CELL_COLS}) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${CELL_MARKS})`);
            for (const m of items) ins.run(planId, plan.chat_key, m.who, m.title, m.surface, m.respond, m.sink || null, m.fit || null, m.weight || null, m.know || null, m.line || null, m.after || null, m.motif || null, m.promiseRef ?? null, m.offscreen ? 1 : 0, storyDay + m.afterDays, at.pos, at.fp, now(), m.entry ?? null, m.place || null, m.goer || null, m.errand || null, m.origin || null, ...cellValues(m));
            if (items.length) putIntimateProgress(plan.chat_key, intimateProgress, { planId, storyDay, at });
        });
        return menuOf(plan.chat_key);
    }
    // 这个窗口此刻的菜单：它认得的规划里的菜单项，状态按它认得的那几步重放。
    // 交给某人那一格里的一步（pending）挂在它真正落到纸面上的那条（方案 删消息等于没发生过，10/9）：被回的那条后面紧跟着的就是他这条回复，
    // 这一步才算数；回复删了、换成了别人在这条后面开口，这一步就撤，那件回到之前那一步。还没回（被回的那条就是最后一条）照算——他正在写；
    // speaker 给了（组那一格时）：在同一条上换了个人开口，别人那一步不算。settledOnly：还没回的不算（对账用）。logUpTo：只认到这一步为止（对账用）
    function menuOf(chatKey, { speaker = null, settledOnly = false, logUpTo = null, all = false } = {}) {
        const h = historyOf(chatKey);
        const info = q(`select s.pos, m.is_user, m.speaker, m.name from chat_seq s join chats c on c.key = s.chat_key
                         join messages m on m.story_id = c.story_id and m.fp = s.fp where s.chat_key = ? order by s.pos`).all(chatKey);
        const his = (row, who) => !!row && !row.is_user && (row.name === who || (who === CAMERA_LABEL && row.speaker === 'narrator'));
        const replied = s => {
            if (!s.pending) return true;
            const next = info[s.pos + 1];
            if (!next) return !settledOnly && (!speaker || speaker === s.by_name);
            return his(next, s.by_name);
        };
        const plans = plansOf(chatKey, h).filter(p => p.status === 'ready');
        if (!plans.length) return [];
        const ids = plans.map(p => p.id), marks = ids.map(() => '?').join(', ');
        const items = q(`select * from menu where plan_id in (${marks}) order by id`).all(...ids)
            .filter(m => m.anchor_pos == null || h.sees(m.chat_key, m.anchor_pos, m.anchor_fp));
        const steps = q(`select l.* from menu_log l join menu m on m.id = l.item_id where m.plan_id in (${marks}) order by l.id`).all(...ids)
            .filter(s => (logUpTo == null || s.id <= logUpTo) && h.sees(s.chat_key, s.pos, s.fp) && replied(s));
        for (const m of items) {
            readCells(m);
            if (all) { const stopped = steps.filter(s => s.item_id === m.id && s.why?.startsWith('/停：')).at(-1); if (stopped) m.intimate_stop = { pos: stopped.pos, fp: stopped.fp }; }
            Object.assign(m, { status: 'waiting', pocket_day: null, pocket_pos: null, settled_pos: null, settled_by: null, held_by: null, held_pos: null, why: null });
            // settled_pos：有了结果（拿出来了、用上了、沉了、撤了）的那一步在哪条消息上——局势推演按它找"刚有了结果的事"
            // offered：这一件递给了谁（N-277），不改它在哪一步
            for (const s of steps) if (s.item_id === m.id && s.status === 'offered') Object.assign(m, { held_by: s.by_name, held_pos: s.pos });
            else if (s.item_id === m.id && s.status === KEPT) m.kept_pos = s.pos;
            else if (s.item_id === m.id) Object.assign(m, { status: s.status, why: s.why ?? null }, s.status === 'waiting' ? { pocket_day: null, pocket_pos: null, held_by: null, held_pos: null, settled_pos: null, settled_by: null } : {}, s.status === 'pocket' ? { pocket_day: s.story_day, pocket_pos: s.pos } : {}, m.settled_pos == null && ['shown', 'used', 'sunk', 'void', 'expired'].includes(s.status) ? { settled_pos: s.pos, settled_by: s.by_name ?? null } : {});
        }
        const current = plans.at(-1).id;
        // 转向、弄断、局面变了以后的新规划：旧节点里还在口袋里的也撤下（新规划里要用的已经重写进去了）
        const retire = RETIRES_POCKET.has(plans.at(-1).reason);
        // 局势排的后续（发生过的事引来的，不是哪一份规划的）：换了规划也接着排、接着在口袋里（D-171：以前一重新规划就跟着旧节点一起撤了）
        const follow = m => m.motif === '后续' || m.motif === '后续·当下';
        // 规划者答了留的旧件（章程 H3）：和局势排的后续一样，换了规划也接着排、接着在口袋里
        return all ? items : items.filter(m => m.plan_id === current || ((follow(m) || m.kept_pos != null) && (m.status === 'waiting' || m.status === 'pocket')) || (m.status !== 'waiting' && !(retire && m.status === 'pocket')));
    }
    // 这几份规划里排过的事，不管后来到了哪一步、有没有被新规划接手（menuOf 只留眼下还算数的）——简报数最近两份各类别排了几件用（章程 J1）。
    // 后来补进来的几件照样看它挂的那条消息还在不在
    function planItems(chatKey, planIds = []) {
        const ids = planIds.filter(Number.isInteger);
        if (!ids.length) return [];
        const h = historyOf(chatKey);
        return q(`select * from menu where plan_id in (${ids.map(() => '?').join(', ')}) order by id`).all(...ids)
            .filter(m => m.anchor_pos == null || h.sees(m.chat_key, m.anchor_pos, m.anchor_fp)).map(readCells);
    }
    // 菜单日志走到哪了；某一步之后拿出来、交出去过的那几件（碰上的事从启用那一刻起算，旧的不补，matters.mjs）
    // 菜单项改挂到另一条消息上（landing.relinkArrivals：进场时顺带排的那件挂到他那条回复上）。返回动了几件
    function moveMenu({ ids = [], pos, fp }) {
        let n = 0;
        const move = q('update menu set anchor_pos = ?, anchor_fp = ? where id = ? and (anchor_fp is not ? or anchor_pos is not ?)');
        for (const id of ids) if (Number.isInteger(id)) n += Number(move.run(pos, fp, id, fp, pos).changes);
        return n;
    }
    function menuLogMax() { return q('select coalesce(max(id), 0) n from menu_log').get().n; }
    function settledSince(logId) { return new Set(q("select distinct item_id from menu_log where id > ? and status in ('shown', 'used')").all(logId).map(r => r.item_id)); }
    function updateMenu(chatKey, id, patch) {
        if (!patch?.status) return;
        const h = historyOf(chatKey);
        const at = patch.at ?? { pos: h.last, fp: h.lastFp };
        // pending：交给某人那一格里的一步，等他那条回复（见 menuOf）；只有写了是谁的才等
        q('insert into menu_log(chat_key, item_id, status, story_day, pos, fp, by_name, pending, why, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
            .run(chatKey, id, patch.status, patch.pocket_day ?? null, at.pos, at.fp, patch.by ?? null, patch.pending && patch.by ? 1 : 0, patch.why ? String(patch.why).slice(0, 200) : null, now());
    }

    // ---------- 外援（API 没响应时交给桌面应用里的 AI 窗口做的活） ----------
    const handoffRow = r => r && { ...r, payload: JSON.parse(r.payload), result: r.result ? JSON.parse(r.result) : null };
    function addHandoff({ kind, key = null, chatKey = null, payload }) {
        return Number(q('insert into handoffs(kind, key, chat_key, payload, created_at) values (?, ?, ?, ?, ?)').run(kind, key, chatKey, JSON.stringify(payload), now()).lastInsertRowid);
    }
    function handoffById(id) { return handoffRow(q('select * from handoffs where id = ?').get(id)) ?? null; }
    function pendingHandoff(kind, key) { return handoffRow(q("select * from handoffs where kind = ? and key is ? and status = 'pending' order by id desc limit 1").get(kind, key)) ?? null; }
    function pendingHandoffs() { return q("select * from handoffs where status = 'pending' order by id").all().map(handoffRow); }
    function closeHandoff(id, status, result = null) { q('update handoffs set status = ?, result = ?, closed_at = ? where id = ?').run(status, result == null ? null : JSON.stringify(result), now(), id); }

    // ---------- 人物关系表（按局存，一局一份，改了就换） ----------
    function relationsOf(storyId) {
        const r = q('select data from relations where story_id = ?').get(storyId);
        return r ? JSON.parse(r.data) : null;
    }
    function putRelations(storyId, data, { by = 'user' } = {}) {
        q('insert into relations(story_id, data, set_by, updated_at) values (?, ?, ?, ?) on conflict(story_id) do update set data = excluded.data, set_by = excluded.set_by, updated_at = excluded.updated_at')
            .run(storyId, JSON.stringify(data), by, now());
    }

    // ---------- 开局单（按局存；确认过的才算数，改一次存一版） ----------
    const setupRow = r => r && { ...r, data: r.data ? JSON.parse(r.data) : null, unchecked: r.unchecked ? JSON.parse(r.unchecked) : [] };
    function setupOf(storyId) { return setupRow(q("select * from setups where story_id = ? and status = 'confirmed' order by id desc limit 1").get(storyId)) ?? null; }
    // 某个时刻生效的那一版：确认一次就插一行 confirmed、旧的也留着 confirmed；superseded 是放弃的草稿，不算（T052 停单）
    function setupAt(storyId, at) { return setupRow(q("select * from setups where story_id = ? and status = 'confirmed' and created_at <= ? order by created_at desc, id desc limit 1").get(storyId, at)) ?? null; }
    // 还没确认的那一份（正在分格／分好了等核对／没分成），比最近一次确认的新才算。
    function setupDraft(storyId) {
        const done = setupOf(storyId)?.id ?? 0;
        return setupRow(q("select * from setups where story_id = ? and status in ('working', 'handoff', 'draft', 'failed') and id > ? order by id desc limit 1").get(storyId, done)) ?? null;
    }
    function startSetup({ storyId, source }) {
        return Number(q("insert into setups(story_id, status, source, created_at, updated_at) values (?, 'working', ?, ?, ?)").run(storyId, source, now(), now()).lastInsertRowid);
    }
    function finishSetup(id, { data, unchecked = [], costUsd = null }) {
        q("update setups set status = 'draft', data = ?, unchecked = ?, cost = ?, updated_at = ? where id = ?").run(JSON.stringify(data), JSON.stringify(unchecked), costUsd, now(), id);
    }
    function markSetupHandoff(id, handoffId) { q("update setups set status = 'handoff', error = ?, updated_at = ? where id = ?").run(`已交给外援 #${handoffId}`, now(), id); }
    function failSetup(id, error) { q("update setups set status = 'failed', error = ?, updated_at = ? where id = ?").run(String(error).slice(0, 500), now(), id); }
    function saveSetupDraft({ storyId, data }) {
        const draft = setupDraft(storyId);
        if (draft && !['working', 'handoff'].includes(draft.status)) q("update setups set status = 'draft', data = ?, updated_at = ? where id = ?").run(JSON.stringify(data), now(), draft.id);
        else q("insert into setups(story_id, status, data, created_at, updated_at) values (?, 'draft', ?, ?, ?)").run(storyId, JSON.stringify(data), now(), now());
    }
    function confirmSetup({ storyId, data }) {
        const source = setupDraft(storyId)?.source ?? setupOf(storyId)?.source ?? null;
        q("update setups set status = 'superseded', updated_at = ? where story_id = ? and status in ('draft', 'failed')").run(now(), storyId);
        q("insert into setups(story_id, status, data, source, created_at, updated_at) values (?, 'confirmed', ?, ?, ?, ?)").run(storyId, JSON.stringify(data), source, now(), now());
        return setupOf(storyId);
    }
    // 确认后程序补的东西（前史检索词）直接写回那一版，不算用户新改了一版。
    function updateSetupData(id, data) { q('update setups set data = ?, updated_at = ? where id = ?').run(JSON.stringify(data), now(), id); }
    function discardSetupDraft(storyId) { q("update setups set status = 'superseded', updated_at = ? where story_id = ? and status in ('draft', 'failed')").run(now(), storyId); }

    // 同一局里别的窗口最近一次有消息的时刻（在分支之间切来切去不算离开）。
    function storyActivity(chatKey) {
        const chat = requireChat(chatKey);
        const rows = q(`select s.sent_at from chat_seq s join chats c on c.key = s.chat_key
                        where c.story_id = ? and s.chat_key != ? and s.pos >= (select max(pos) - 2 from chat_seq where chat_key = s.chat_key)`).all(chat.story_id, chatKey);
        return Math.max(-Infinity, ...rows.map(r => Date.parse(r.sent_at ?? '')).filter(Number.isFinite));
    }

    // ---------- /写 /玩 /聊 ----------
    function addNote({ chatKey, kind, text, storyDay = null, pos = null }) {
        if (kind !== '聊') q('update notes set cleared = 1 where chat_key = ? and kind = ? and cleared = 0').run(chatKey, kind);   // 同类只留最新一条
        return Number(q('insert into notes(chat_key, kind, text, story_day, pos, created_at) values (?, ?, ?, ?, ?, ?)').run(chatKey, kind, text, storyDay, pos, now()).lastInsertRowid);
    }
    // ST 世界书条目谁知道（lore.mjs）：ekey＝书名|条目编号；verdict＝{all, who, why}；source＝model（判的）｜user（玩家定的）。
    // 新条目、内容改了的（玩家没定过的）清掉判断、等重判；玩家定过的内容改了也照旧算。
    function seeLore(storyId, entries) {
        const get = q('select hash, source from lore where story_id = ? and ekey = ?');
        const put = q(`insert into lore(story_id, ekey, hash, world, title, text, verdict, source, updated_at) values (?, ?, ?, ?, ?, ?, null, null, ?)
                      on conflict(story_id, ekey) do update set hash = excluded.hash, world = excluded.world, title = excluded.title, text = excluded.text,
                      verdict = case when lore.source = 'user' then lore.verdict else null end, source = case when lore.source = 'user' then 'user' else null end, updated_at = excluded.updated_at`);
        let fresh = 0;
        tx(() => { for (const e of entries) { const old = get.get(storyId, e.key); if (old?.hash === e.hash) continue; put.run(storyId, e.key, e.hash, e.world ?? null, e.title ?? null, e.text ?? null, now()); fresh++; } });
        return fresh;
    }
    function loreOf(storyId) {
        return q('select ekey key, hash, world, title, text, verdict, source from lore where story_id = ? order by world, title').all(storyId)
            .map(r => ({ ...r, verdict: r.verdict ? JSON.parse(r.verdict) : null }));
    }
    function setLore(storyId, key, verdict, source) {
        q('update lore set verdict = ?, source = ?, updated_at = ? where story_id = ? and ekey = ?').run(JSON.stringify(verdict), source, now(), storyId, key);
    }

    function clearNotes(chatKey, kind) { q('update notes set cleared = 1 where chat_key = ? and kind = ? and cleared = 0').run(chatKey, kind); }
    function notesOf(chatKey) { return q('select * from notes where chat_key = ? and cleared = 0 order by id').all(chatKey); }

    function status({ chatKey }) {
        const chat = requireChat(chatKey);
        const rows = q(`select m.is_user, m.speaker, count(*) n from chat_seq s join messages m
                        on m.story_id = ? and m.fp = s.fp where s.chat_key = ? group by m.is_user, m.speaker`)
            .all(chat.story_id, chatKey);
        const total = rows.reduce((sum, r) => sum + r.n, 0);
        const events = q('select at, kind, detail from events where chat_key = ? order by id desc limit 8').all(chatKey)
            .map(e => ({ at: e.at, kind: e.kind, detail: JSON.parse(e.detail) }));
        return {
            chatKey, storyId: chat.story_id, parentKey: chat.parent_key, label: chat.label,
            enabled: !!chat.enabled, testSlot: !!chat.test_slot, extract: !!chat.extract, syncedAt: chat.synced_at,
            total, adopted: Math.max(0, total - 1),
            speakers: Object.fromEntries(rows.map(r => [r.is_user ? 'user' : r.speaker, r.n])),
            events,
        };
    }

    return { intimateProgressOf, putIntimateProgress, logIntimateStop, intimateStopsOf, beginPlanAttempt, activePlanAttempt, ownsPlanAttempt, updatePlanAttempt, finishPlanAttempt, planAttempts, planningState, moveMenu, putSnapshot, snapshotOf, logEvent: log, menuLogMax, settledSince, putGiven, seeLore, loreOf, setLore, db, markFreshened, sameMessage, playerNames, putEpisodes, episodesOf, editEpisode, putStateNotes, stateNotesOf, join, open, autoExtract, setEnabled, setOptions, putMessages, sync, currentMessages, getSlot, getSlotParts, putSlot, recentSlotIds, putCarry, carryBefore, contactOffers, putContactOffer, getCast, putCast, profileOf, putProfile, putCardText, setInterests, absences, putAbsence, markAbsenceSeen, setAbsenceStory, setAbsenceDays, getMeta, setMeta, lastPlan, lastReadyPlan, readyPlans, planById, setPlanBrief, pendingPlans, requestPlan, failPlan, submitPlan, appendMenu, menuOf, planItems, updateMenu, storyActivity, addHandoff, handoffById, pendingHandoff, pendingHandoffs, closeHandoff, relationsOf, putRelations, setupOf, setupAt, setupDraft, startSetup, finishSetup, markSetupHandoff, failSetup, saveSetupDraft, confirmSetup, updateSetupData, discardSetupDraft, addNote, clearNotes, notesOf, status, requireChat, close: () => db.close() };
}
