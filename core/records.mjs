// 记录（证据账）：每条都挂在一条消息（局＋指纹）上，带原文片段、谁的说法、当时谁在场。
// 一个窗口能看到哪些记录，只看它当前序列里还有没有那条消息——改稿删稿后旧记录自动不可见。
const SCHEMA = `
create table if not exists records(
  id integer primary key autoincrement,
  story_id text not null, fp text not null, job_id integer,
  type text not null, text text not null, about text, tense text,
  quotes text not null, todo integer not null default 0, fabricated integer not null default 0,
  duration text, elapsed text, idea_ref integer, outcome text,
  holder text not null, holder_name text, audience text not null,
  status text not null default 'ok', reason text,
  created_at text not null);
create index if not exists records_fp on records(story_id, fp);
create table if not exists extract_done(
  story_id text not null, fp text not null, job_id integer not null,
  primary key(story_id, fp));
create table if not exists extract_jobs(
  id integer primary key autoincrement, story_id text not null, chat_key text not null,
  positions text not null, model text, status text not null,
  input_tokens integer, output_tokens integer, cost_usd real,
  accepted integer, rejected integer, error text, raw text,
  started_at text not null, finished_at text);
create table if not exists assemble_calls(
  id integer primary key autoincrement, chat_key text not null, speaker text not null, anchor text,
  model text, served_model text, status text not null,
  input_tokens integer, output_tokens integer, cost_usd real, ms integer,
  lines integer, dropped integer, error text, raw text, created_at text not null);
create table if not exists record_links(
  id integer primary key autoincrement, story_id text not null,
  from_id integer not null, to_id integer not null, kind text not null, created_at text not null);
create index if not exists record_links_from on record_links(story_id, from_id);
`;

// 对账（质量窗 10/2）：一条新账接上旧账——回答（那个问题、要求有了答复）、改掉（那条以后不再算数：改了日子、弄清了真相、状态变了）。
// 链接只存编号，挂在新账那条消息上：新账看不见了（删稿、改稿、换分支）链接就不算，旧账自动回来。"同一件"不落账：新的那条直接拦下。
// 证实／否定（用户 10/7）：猜的那个人后来亲眼见到、或被人告知，他猜对了／猜错了——只接【还开着的】里标着"猜的"那几条
export const LINK_KINDS = ['回答', '改掉', '证实', '否定', '交代'];   // 交代：替不在场的人记的那条接着别处交代它的原记录（offstage.mjs）
// 只说"这条""那件事"、没说是什么的：读出来时接上它指的那条（见 visible）；REF_OPEN 开头的那一截是程序加的，要原话时去掉它
export const DANGLING = /[这那](?:条|个)(?:规矩|要求|约定)|[这那]条(?=[，。；！？他她我你就也都算认不没得要是]|$)|[这那]件事|[这那]事(?![情物业实])|[这那]话|[这那]规矩/;
export const REF_OPEN = '（指的是';
export const bareText = t => { const i = String(t ?? '').indexOf(REF_OPEN); return i < 0 ? String(t ?? '') : String(t).slice(0, i); };

// 两句话说的是不是同一件事：两字组重合的比例（按短的那句算）。
export function similar(a, b) {
    const grams = s => { const t = String(s ?? '').replace(/[\s\p{P}]/gu, ''); const out = new Set(); for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2)); return out; };
    const x = grams(a), y = grams(b);
    if (!x.size || !y.size) return 0;
    let n = 0;
    for (const g of x) if (y.has(g)) n++;
    return n / Math.min(x.size, y.size);
}

export function openRecords(db) {
    db.exec(SCHEMA);
    // 读缓存（10/16 提速，和 store.memo 一个道理）：同一连接上写过就清；visible 一轮里被叫几十次
    const changesQ = db.prepare('select total_changes() n');
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
    try { db.exec('alter table chats add column extract integer not null default 0'); } catch {}
    try { db.exec('alter table records add column keys text'); } catch {}
    try { db.exec('alter table extract_jobs add column served_model text'); } catch {}
    try { db.exec('alter table records add column money text'); } catch {}   // 钱型记录：{from, to, amount, raw, stage, every, monthly}
    try { db.exec('alter table records add column relation text'); } catch {}   // 关系型记录：{with, now}（说话人和谁、从这条起是什么关系）
    try { db.exec('alter table records add column wide text'); } catch {}
    try { db.exec('alter table records add column faction text'); } catch {}
    try { db.exec('alter table records add column clock text'); } catch {}
    try { db.exec('alter table records add column unfinished integer not null default 0'); } catch {}   // "说"讲到一半停下的（N-124）：在场听的人过后惦记着追问，讲完了由"了结"关上   // 时间型记录：{part, unsure}（叙述里写明的一天里的什么时候；拿不准时间是不是往前走了）
    try { db.exec('alter table records add column standing integer not null default 0'); } catch {}   // 说好的：两人之间以后一直照着做的规矩（怎么称呼、别再做什么），每次开口都带着   // 势力账的三种记录：协议{parties,title,stage}、归属{who,public,real}、立场{a,b,public,real}   // 宽一点的检索词：大类、日常场合（换了说法、只说到同一类东西时接得上）
    try { db.exec('alter table records add column promise text'); } catch {}   // 约定（N-268）：{kind, doers, with, when}——类、谁办、跟谁、约在（照原文）
    try { db.exec('alter table records add column lasting integer not null default 0'); } catch {}   // 分量（质量窗 10/2）：1＝会一直算数的（住哪、本事、名声、谁在找什么、钱和约定），不受每条消息的条数上限
    try { db.exec('alter table records add column known text'); } catch {}
    try { db.exec('alter table records add column lesson text'); } catch {}
    try { db.exec('alter table records add column life text'); } catch {}
    try { db.exec('alter table records add column guess integer not null default 0'); } catch {}   // 猜的（用户 10/7）：他对没亲眼见到、没人告诉过他的事下的判断
    try { db.exec('alter table records add column matter text'); } catch {}   // 碰上的事（用户 10/7）：后台排的事真发生了、还没下文——{menu 口袋编号, title, origin 来由, entry, kind}；了结了才不再每次带着
    try { db.exec('alter table records add column rep text'); } catch {}
    try { db.exec('alter table records add column reach text'); } catch {}   // 到谁手上（用户 10/8）：东西、话、钱经别人的手送到、带给了一个不在场的人——他那边就收到了（offstage.mjs）   // 名声（D-172）：{who, among 在哪个圈子, view 他们怎么看, deal 他们往后怎么待他, keys 认这个圈子的词}   // 生活现状（N-288）：{who, kind 住处|家里|衣服|东西, now, gone, where}   // 认过的错（用户 10/5）：{with, did, cost}——对谁、错在哪、惹出了什么   // 提起的已知的事（开局单、世界书里本来就有的）：[{key, title}]
    const q = sql => db.prepare(sql);
    const now = () => new Date().toISOString();
    // 同一条上替同一个人记了好几回的进场那几笔（他那一条删了重来、又进一次场；试玩 10/7 #286 记了三遍，中间那遍照删掉的那一版写了
    // "还没顾上去喝热汤"）：每种只留最后一回的。以后 main.arrive 进场前先把旧的作废，这里把已经攒下的清掉；没有就不动
    try {
        const rows = q("select id, story_id, fp, holder_name, text from records where job_id is null and status = 'ok' and holder_name is not null").all();
        const kindOf = r => ['来这儿', '离开这段时间', '换了住处'].find(k => String(r.text ?? '').startsWith(`${r.holder_name}${k}`));
        const latest = new Map();
        for (const r of rows) { const k = kindOf(r); if (k) { const key = `${r.story_id}|${r.fp}|${r.holder_name}|${k}`; if (!latest.has(key) || latest.get(key) < r.id) latest.set(key, r.id); } }
        const retire = q("update records set status = 'void_redo', reason = '重新进场，上一回进场替他记的作废' where id = ?");
        for (const r of rows) { const k = kindOf(r); if (k && latest.get(`${r.story_id}|${r.fp}|${r.holder_name}|${k}`) !== r.id) retire.run(r.id); }
    } catch {}

    // 记录的写入统一走这里（新写入与重核共用）。
    const COLUMNS = 'story_id, fp, job_id, type, text, about, tense, quotes, todo, fabricated, duration, elapsed, idea_ref, outcome, holder, holder_name, audience, keys, money, relation, wide, faction, standing, clock, unfinished, promise, lasting, known, lesson, life, rep, guess, matter, reach, status, reason, created_at';
    // 被拦下的记录可能对不上任何一条消息（模型报错了消息号），指纹记成 '-' 照样留痕。
    const valuesOf = (storyId, jobId, r, status, reason) => [storyId, r.fp ?? '-', jobId, r.type ?? '?', r.text ?? '', r.about ?? null, r.tense ?? null,
        JSON.stringify(r.quotes ?? []), r.todo ? 1 : 0, r.fabricated ? 1 : 0, r.duration ?? null, r.elapsed ?? null,
        r.ideaRef ?? null, r.outcome ?? null, r.holder ?? '?', r.holderName ?? null, JSON.stringify(r.audience ?? []),
        r.keys?.length ? JSON.stringify(r.keys) : null, r.money ? JSON.stringify(r.money) : null, r.relation ? JSON.stringify(r.relation) : null, r.wide?.length ? JSON.stringify(r.wide) : null, r.faction ? JSON.stringify(r.faction) : null, r.standing ? 1 : 0, r.clock ? JSON.stringify(r.clock) : null, r.unfinished ? 1 : 0, r.promise ? JSON.stringify(r.promise) : null, r.lasting ? 1 : 0, r.known?.length ? JSON.stringify(r.known) : null, r.lesson ? JSON.stringify(r.lesson) : null, r.life ? JSON.stringify(r.life) : null, r.rep ? JSON.stringify(r.rep) : null, r.guess ? 1 : 0, r.matter ? JSON.stringify(r.matter) : null, r.reach ?? null, status, reason, now()];
    const insertRecord = () => q(`insert into records(${COLUMNS}) values (${COLUMNS.split(',').map(() => '?').join(', ')})`);
    // 同一段里接上的、了结的（extract.verify 存的是那条在 accepted 里的位置）：落账后换成记录号。
    const withSelf = (r, ids) => [...(r.links ?? []), ...(r.selfLinks ?? []).filter(l => ids[l.at] != null).map(l => ({ to: ids[l.at], kind: l.kind }))];
    const selfIdeas = (accepted, ids) => accepted.forEach((r, i) => { if (r.selfIdea != null && ids[r.selfIdea] != null) q('update records set idea_ref = ? where id = ?').run(ids[r.selfIdea], ids[i]); });
    // 一条新账接上的旧账（r.links＝[{to, kind}]，核对时已经只留给过的编号和认识的关系）
    const putLinks = (storyId, fromId, links) => {
        const insert = q('insert into record_links(story_id, from_id, to_id, kind, created_at) values (?, ?, ?, ?, ?)');
        for (const l of links ?? []) if (LINK_KINDS.includes(l.kind) && Number.isInteger(l.to)) insert.run(storyId, fromId, l.to, l.kind, now());
    };

    function isDone(storyId, fp) {
        return !!q('select 1 from extract_done where story_id = ? and fp = ?').get(storyId, fp);
    }

    function startJob({ storyId, chatKey, positions, model }) {
        return Number(q(`insert into extract_jobs(story_id, chat_key, positions, model, status, started_at)
                         values (?, ?, ?, ?, 'running', ?)`).run(storyId, chatKey, JSON.stringify(positions), model, now()).lastInsertRowid);
    }

    // 接口自报答题的模型（和请求的对不上＝可能被偷换）。
    function setServed(jobId, model) {
        if (model) q('update extract_jobs set served_model = ? where id = ?').run(String(model).slice(0, 120), jobId);
    }

    // 模型答了但没过（格式坏了、整段放弃）的，这次调用照样花了钱：带上用量，记进当天的账。
    function failJob(jobId, error, raw = null, { usage = null, costUsd = null } = {}) {
        q(`update extract_jobs set status = 'failed', error = ?, raw = ?, input_tokens = ?, output_tokens = ?, cost_usd = ?, finished_at = ? where id = ?`)
            .run(String(error).slice(0, 2000), raw, usage?.input ?? null, usage?.output ?? null, costUsd, now(), jobId);
    }

    // 一次抽取的结果整体落账：记录（含被拦下的，留痕不丢）＋这些消息标记为已记账。
    // markDone=false：补记某一型时不改"这条消息由哪段记下"（重核按它找回原来那一段）。
    function finishJob({ jobId, storyId, fps, accepted, rejected, usage, costUsd, raw, markDone = true }) {
        const insert = insertRecord();
        const put = (r, status, reason = null) => insert.run(...valuesOf(storyId, jobId, r, status, reason));
        db.exec('begin immediate');
        try {
            const ids = accepted.map(r => Number(put(r, 'ok').lastInsertRowid));
            accepted.forEach((r, i) => putLinks(storyId, ids[i], withSelf(r, ids)));
            selfIdeas(accepted, ids);
            relinkEdited(storyId, fps, accepted.map((r, i) => ({ ...r, id: ids[i] })), jobId);
            for (const r of rejected) put(r.record, 'rejected', r.reason);
            const done = q('insert or replace into extract_done(story_id, fp, job_id) values (?, ?, ?)');
            if (markDone) for (const fp of fps) done.run(storyId, fp, jobId);
            q(`update extract_jobs set status = 'done', input_tokens = ?, output_tokens = ?, cost_usd = ?, accepted = ?, rejected = ?,
               raw = ?, finished_at = ? where id = ?`)
                .run(usage?.input ?? null, usage?.output ?? null, costUsd ?? null, accepted.length, rejected.length, raw, now(), jobId);
            db.exec('commit');
        } catch (error) { db.exec('rollback'); throw error; }
    }

    // 改过的那条重新记完（N-271，改了不等于删了）：旧字记下的想法、约定——后面已经被了结的、规划跟着的、补认过约定那一格的——
    // 接到新记的、说的是同一件事的那条上。旧字＝meta 里的 fresh_from 链（store.sync 认出的改稿、去复读换过的字都记在那儿）。
    // 对不上的不接：改的时候把那件事删了，后面的了结就跟着失效。顺手记一份"这次改动留下了什么"（editReport）给用户看。
    function relinkEdited(storyId, fps, fresh, jobId) {
        let prevOf;
        try { const get = q('select value from meta where key = ?'); prevOf = fp => get.get(`fresh_from:${fp}`)?.value ?? null; } catch { return; }
        for (const fp of fps) {
            const olds = [];
            for (let p = prevOf(fp), i = 0; p && i < 4; p = prevOf(p), i++) olds.push(p);
            if (!olds.length) continue;
            const marks = olds.map(() => '?').join(', ');
            const before = q(`select id, type, text, promise from records where story_id = ? and status = 'ok' and fp in (${marks})`).all(storyId, ...olds);
            if (!before.length) continue;
            const mine = fresh.filter(r => r.fp === fp);
            const kept = new Set();
            for (const o of before) {
                // 说法换了一点的也算还在（0.3）；接了结、规划要更像才接（0.4）
                if (mine.some(n => similar(o.text, n.text) >= 0.3)) kept.add(o.id);
                const best = mine.filter(n => n.type === o.type).map(n => [n, similar(o.text, n.text)]).filter(([, s]) => s >= 0.4).sort((a, b) => b[1] - a[1])[0]?.[0];
                if (!best || !['想法', '说'].includes(o.type)) continue;
                q("update records set idea_ref = ? where idea_ref = ? and type = '了结'").run(best.id, o.id);
                q('update record_links set to_id = ? where to_id = ?').run(best.id, o.id);
                try { q('update menu set promise_ref = ? where promise_ref = ?').run(best.id, o.id); } catch {}
                if (o.promise && !best.promise) q('update records set promise = ? where id = ?').run(o.promise, best.id);
            }
            const gone = before.filter(o => !kept.has(o.id) && o.type !== '时间');
            const chatKey = q('select chat_key from extract_jobs where id = ?').get(jobId)?.chat_key;
            if (!chatKey || !gone.length) continue;
            // 后面还按原来的说法记着的：改动之后的记录里，和不再成立的那几件说的是同一回事的
            const pos = q('select pos from chat_seq where chat_key = ? and fp = ?').get(chatKey, fp)?.pos;
            const later = pos == null ? [] : visible(chatKey).filter(r => r.pos > pos && gone.some(g => similar(g.text, r.text) >= 0.3)).slice(0, 8);
            let list = [];
            try { list = JSON.parse(q('select value from meta where key = ?').get(`edit_report:${chatKey}`)?.value ?? '[]'); } catch {}
            list = [...list.filter(x => x.fp !== fp), { pos, fp, at: now(), gone: gone.map(g => g.text).slice(0, 8), later: later.map(r => ({ id: r.id, pos: r.pos, text: r.text })) }].slice(-10);
            q('insert or replace into meta(key, value) values (?, ?)').run(`edit_report:${chatKey}`, JSON.stringify(list));
            // 面板弹一句（扩展按 id 只弹一次）；细的在"跟后台说话"里看得到，要跟着改就在那儿说
            const clip = t => (String(t).length > 30 ? `${String(t).slice(0, 30)}…` : String(t));
            const text = `第 ${pos} 条改过了：原来从它记下的 ${gone.length} 件这回没再记到（${clip(gone[0].text)}${gone.length > 1 ? ' 等' : ''}）${later.length ? `；后面还有 ${later.length} 条记录按原来的说法记着（第 ${[...new Set(later.map(r => r.pos))].join('、')} 条）` : ''}。要跟着改，在"跟后台说话"里说一声就行。`;
            q('insert or replace into meta(key, value) values (?, ?)').run(`notice:${chatKey}`, JSON.stringify({ id: `edit:${fp}`, text }));
        }
    }

    // 今天估算花了多少：抽取＋发言前的叙事组装。只按局算时只算抽取（组装按窗口记，不分局）。
    function spentToday(storyIdOrNull = null) {
        const since = new Date(); since.setHours(0, 0, 0, 0);
        const extract = q(`select coalesce(sum(cost_usd), 0) s from extract_jobs where started_at >= ?${storyIdOrNull ? ' and story_id = ?' : ''}`)
            .get(...[since.toISOString(), ...(storyIdOrNull ? [storyIdOrNull] : [])]).s;
        if (storyIdOrNull) return extract;
        return extract + q('select coalesce(sum(cost_usd), 0) s from assemble_calls where created_at >= ?').get(since.toISOString()).s;
    }

    // 今天某一类调用（"(规划)"之类，记在叙事组装那张表里）估算花了多少。
    function spentTodayOn(speaker) {
        const since = new Date(); since.setHours(0, 0, 0, 0);
        return q('select coalesce(sum(cost_usd), 0) s from assemble_calls where speaker = ? and created_at >= ?').get(speaker, since.toISOString()).s;
    }

    // 发言前叙事组装的一次调用（成功或失败都记，报告里能看到花了多少、丢了几句）。
    function logAssemble({ chatKey, speaker, anchor, model, servedModel = null, status, usage = null, costUsd = null, ms = null, lines = null, dropped = null, error = null, raw = null }) {
        q(`insert into assemble_calls(chat_key, speaker, anchor, model, served_model, status, input_tokens, output_tokens, cost_usd, ms, lines, dropped, error, raw, created_at)
           values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(chatKey, speaker, anchor ?? null, model ?? null, servedModel ? String(servedModel).slice(0, 120) : null, status,
                usage?.input ?? null, usage?.output ?? null, costUsd, ms, lines, dropped, error ? String(error).slice(0, 2000) : null, raw, now());
    }

    function assembleCalls(chatKey, limit = 50) {
        return q(`select id, speaker, anchor, model, served_model, status, input_tokens, output_tokens, cost_usd, ms, lines, dropped, error, created_at
                  from assemble_calls where chat_key = ? order by id desc limit ?`).all(chatKey, limit);
    }

    // 窗口当前看得见的记录（消息还在序列里的）。带上出处位置。
    // 对账以后每条还带：closed_by（被看得见的"了结"或"回答"关上了：{id, pos}）、superseded_by（被看得见的"改掉"换掉了，以后不算数）。
    // 被改掉的默认不给（那一格、规划、账本都只拿活着的）；all=true 时连它们一起给（面板上划线显示）。
    function visible(chatKey, { status = 'ok', type = null, all = false } = {}) { return memo('visible', `${chatKey}|${status}|${type ?? ''}|${all ? 1 : 0}`, () => readVisible(chatKey, { status, type, all }), a => [...a]); }
    function readVisible(chatKey, { status = 'ok', type = null, all = false } = {}) {
        const rows = q(`select r.*, min(s.pos) pos from records r
                        join chats c on c.key = ? and c.story_id = r.story_id
                        join chat_seq s on s.chat_key = c.key and s.fp = r.fp
                        where r.status = ?${type ? ' and r.type = ?' : ''}
                        group by r.id order by pos, r.id`).all(...[chatKey, status, ...(type ? [type] : [])]);
        const out = rows.map(r => ({ ...r, quotes: JSON.parse(r.quotes), audience: JSON.parse(r.audience), keys: r.keys ? JSON.parse(r.keys) : [], money: r.money ? JSON.parse(r.money) : null, relation: r.relation ? JSON.parse(r.relation) : null, clock: r.clock ? JSON.parse(r.clock) : null, wide: r.wide ? JSON.parse(r.wide) : [], faction: r.faction ? JSON.parse(r.faction) : null, promise: r.promise ? JSON.parse(r.promise) : null, known: r.known ? JSON.parse(r.known) : [], lesson: r.lesson ? JSON.parse(r.lesson) : null, life: r.life ? JSON.parse(r.life) : null, rep: r.rep ? JSON.parse(r.rep) : null, matter: r.matter ? JSON.parse(r.matter) : null }));
        if (status !== 'ok') return out;
        const { closed, superseded, outgoing } = linksOf(chatKey);
        const byId = new Map(out.map(r => [r.id, r]));
        const targetOf = id => byId.get(id) ?? q('select id, text, holder_name from records where id = ?').get(id) ?? null;
        for (const r of out) {
            // 只说了"这条规矩他认""那件事她答应了"的（用户 10/8：前台看不出认的是哪条，规矩的内容和这句分开给，会误会）：
            // 它接上的那条（回答、改掉……）就是"这条"，读出来带上那条说的是什么
            const ref = DANGLING.test(r.text) ? (outgoing.get(r.id) ?? []).map(l => targetOf(l.to)).find(Boolean) : null;
            if (ref) { r.refers = ref.id; r.text = `${r.text}${REF_OPEN}${ref.holder_name ?? ''}那句：${String(ref.text).replace(/[。．.]+$/, '').slice(0, 80)}）`; }
            if (closed.has(r.id)) r.closed_by = closed.get(r.id);
            if (superseded.has(r.id)) r.superseded_by = superseded.get(r.id);
            // 猜的（用户 10/7：防住猜测被当成真的）：读出来就带着这是谁猜的——没人证实过的要他拿不准先问；证实了标出来；被否定的跟改掉一样不再给
            if (r.guess) r.text = `${r.text}${r.closed_by?.kind === '证实' ? `（${r.holder_name ?? '他'}猜的，后来证实了）` : `（这是${r.holder_name ?? '他'}猜的，没人证实过——拿不准就先问一句，别当成真的）`}`;
        }
        return all ? out : out.filter(r => !r.superseded_by);
    }

    // 看得见的了结和链接：关上了谁（了结、回答）、换掉了谁（改掉）。只认发起那条记录还看得见的。
    function linksOf(chatKey) { return memo('links', chatKey, () => readLinks(chatKey)); }
    function readLinks(chatKey) {
        const closed = new Map(), superseded = new Map(), outgoing = new Map();
        const seen = q(`select r.id, r.type, r.idea_ref, l.to_id, l.kind, min(s.pos) pos from records r
                        join chats c on c.key = ? and c.story_id = r.story_id
                        join chat_seq s on s.chat_key = c.key and s.fp = r.fp
                        left join record_links l on l.from_id = r.id
                        where r.status = 'ok' and (r.type = '了结' or l.id is not null)
                        group by r.id, l.id order by pos, r.id`).all(chatKey);
        for (const x of seen) {
            if (x.type === '了结' && x.idea_ref != null && !closed.has(x.idea_ref)) closed.set(x.idea_ref, { id: x.id, pos: x.pos });
            if ((x.kind === '回答' || x.kind === '证实') && !closed.has(x.to_id)) closed.set(x.to_id, { id: x.id, pos: x.pos, kind: x.kind });
            if ((x.kind === '改掉' || x.kind === '否定') && !superseded.has(x.to_id)) superseded.set(x.to_id, { id: x.id, pos: x.pos, kind: x.kind });
            if (x.kind) outgoing.set(x.id, [...(outgoing.get(x.id) ?? []), { to: x.to_id, kind: x.kind }]);
        }
        return { closed, superseded, outgoing };
    }

    // 还开着的想法：看得见的"想法"里，没被看得见的"了结"（或"回答"）对应上的；还有讲到一半停下的"说"（unfinished，讲完了由"了结"关上）、
    // 说定了要办的"说"（约定，N-268：办了、不办了、改了、没办成都由"了结"关上）。被"改掉"的也不算开着。
    function openIdeas(chatKey) {
        const told = visible(chatKey, { type: '说' }).filter(r => r.unfinished || r.promise);
        return [...visible(chatKey, { type: '想法' }), ...told].filter(r => !r.closed_by).sort((a, b) => a.pos - b.pos || a.id - b.id);
    }

    // 还没答的问题和要求（待办的说、做；约定另算）：最近 window 条里的、没被关上的。
    function openTodos(chatKey, { lastPos = null, window = 150 } = {}) {
        return visible(chatKey).filter(r => r.todo && ['说', '做'].includes(r.type) && !r.promise && !r.unfinished && !r.closed_by && (lastPos == null || lastPos - r.pos <= window));
    }

    function jobs(chatKey, limit = 20) {
        return q(`select id, positions, model, status, input_tokens, output_tokens, cost_usd, accepted, rejected, error, started_at, finished_at
                  from extract_jobs where chat_key = ? order by id desc limit ?`).all(chatKey, limit);
    }

    // 核对规则改了以后，用存下的原始输出重核这一段（不调模型）。
    // 内容没变的记录原地更新、保留编号——别处的"了结"按编号引用想法，编号一换就断。
    function replaceJobRecords({ jobId, storyId, accepted, rejected }) {
        db.exec('begin immediate');
        try {
            const existing = q('select id, fp, type, text, keys, wide, promise, created_at, status, reason from records where job_id = ?').all(jobId);
            const claim = r => {
                const i = existing.findIndex(e => e.fp === r.fp && e.type === r.type && e.text === r.text);
                return i < 0 ? null : existing.splice(i, 1)[0];
            };
            const values = (r, status, reason) => valuesOf(storyId, jobId, r, status, reason);
            const insert = insertRecord();
            const update = q(`update records set ${COLUMNS.split(',').map(c => `${c.trim()} = ?`).join(', ')} where id = ?`);
            const put = (r, status, reason = null) => {
                const old = claim(r);
                if (!old) return Number(insert.run(...values(r, status, reason)).lastInsertRowid);
                // 检索词可能是事后补的（tools/tag-records.mjs），原始输出里没有：重核时留着，别冲掉；记下的时间也不改。
                // 约定那一格也可能是事后补认的（tools/promises-recheck.mjs）：原始输出里没有就留着
                const kept = { ...r, ...(r.keys?.length || !old.keys ? {} : { keys: JSON.parse(old.keys) }), ...(r.wide?.length || !old.wide ? {} : { wide: JSON.parse(old.wide) }), ...(r.promise || !old.promise ? {} : { promise: JSON.parse(old.promise) }) };
                // 玩家作废、改过的（void_user）重核也不复活
                const row = old.status === 'void_user' ? values(kept, 'void_user', old.reason) : values(kept, status, reason);
                row[row.length - 1] = old.created_at;
                update.run(...row, old.id);
                return old.id;
            };
            // 接上的链接跟着这一段重来（只认这次核对留下的）
            q(`delete from record_links where from_id in (select id from records where job_id = ?)`).run(jobId);
            const ids = accepted.map(r => put(r, 'ok'));
            accepted.forEach((r, i) => putLinks(storyId, ids[i], withSelf(r, ids)));
            selfIdeas(accepted, ids);
            for (const r of rejected) put(r.record, 'rejected', r.reason);
            for (const e of existing) q('delete from records where id = ?').run(e.id);
            q('update extract_jobs set accepted = ?, rejected = ? where id = ?').run(accepted.length, rejected.length, jobId);
            db.exec('commit');
        } catch (error) { db.exec('rollback'); throw error; }
    }

    // 同一段消息失败过几次（防止坏段落无限重试扣钱）。
    function failures(chatKey, positions, since = '') {
        return q(`select count(*) n from extract_jobs where chat_key = ? and positions = ? and status = 'failed' and started_at >= ?`)
            .get(chatKey, JSON.stringify(positions), since).n;
    }

    // 放弃这一段：标成已处理（job_id = 0），报告里能看出是跳过的。
    function skip(storyId, fps) {
        const done = q('insert or replace into extract_done(story_id, fp, job_id) values (?, ?, 0)');
        for (const fp of fps) done.run(storyId, fp);
    }

    function skipped(storyId) {
        return q('select fp from extract_done where story_id = ? and job_id = 0').all(storyId).map(r => r.fp);
    }

    function unskip(storyId, fps) {
        if (!fps?.length) return 0;
        const marks = fps.map(() => '?').join(', ');
        return q(`delete from extract_done where story_id = ? and job_id = 0 and fp in (${marks})`).run(storyId, ...fps).changes;
    }

    function recentFailures(chatKey, since = '') {
        const rows = q(`select status from extract_jobs where chat_key = ? and started_at >= ? order by id desc`).all(chatKey, since);
        let n = 0;
        for (const row of rows) { if (row.status !== 'failed') break; n++; }
        return n;
    }

    // 同一条消息上替某人记过的那几笔（进场那份理出来的来由、这段时间、换了住处）：他这一条删了重来、又进一次场，旧的作废
    // （试玩 10/7：重来三回，"离开这段时间"就记了三条，有一条还是照删掉的那一版写的）
    function retireDerived({ storyId, fp, holderName, prefixes = [] }) {
        const rows = q("select id, text from records where story_id = ? and fp = ? and job_id is null and holder_name = ? and status = 'ok'").all(storyId, fp, holderName);
        const ids = rows.filter(r => prefixes.some(p => String(r.text ?? '').startsWith(p))).map(r => r.id);
        for (const id of ids) q("update records set status = 'void_redo', reason = ? where id = ?").run('重新进场，上一回进场替他记的作废', id);
        return ids.length;
    }

    function setKeys(id, keys) {
        q('update records set keys = ? where id = ?').run(keys?.length ? JSON.stringify(keys) : null, id);
    }

    // 程序替人补的记录（局势推演里传到他耳朵里的"听说"）：不属于哪次记账，重核不会删它；挂在给的那条消息上，删到它之前就看不见。
    // 程序记的"了结"（约定过了好几天没人再提，promises.mjs）：带上对应哪条、结果。
    // links：[{to, kind}]，这条接上的旧账（跨天收尾判"不再算数"的，用"改掉"把那条换下）
    function addDerived({ storyId, fp, type, text, holder, holderName = null, audience = [], about = null, quotes = [], keys = [], ideaRef = null, outcome = null, life = null, duration = null, money = null, rep = null, matter = null, promise = null, known = null, lasting = false, links = [] }) {
        const id = Number(insertRecord().run(...valuesOf(storyId, null, { fp, type, text, holder, holderName, audience, about, quotes, keys, ideaRef, outcome, life, duration, money, rep, matter, promise, known, lasting }, 'ok', null)).lastInsertRowid);
        if (links.length) putLinks(storyId, id, links);
        return id;
    }

    // 开局单"人物开场状态"记成的那几条（opening.mjs）：挂在某条消息上、known 里带着 setup:开场: 开头的键。
    function seedsAt(storyId, fp, prefix) {
        return q("select id, known from records where story_id = ? and fp = ? and status = 'ok' and job_id is null and known like ?").all(storyId, fp, `%"${prefix}%`)
            .map(r => ({ id: r.id, known: JSON.parse(r.known) }));
    }
    // 程序记的那条不再算数（开局单改了）：留痕、看不见
    function retire(id, reason) { q("update records set status = 'void_setup', reason = ? where id = ? and job_id is null").run(String(reason ?? '').slice(0, 300), id); }
    // 程序替人记的那几笔改挂到另一条消息上（landing.relinkArrivals：进场那几笔挂到他那条回复上）。只动程序记的；返回动了几条
    function moveDerived({ storyId, ids = [], fp }) {
        let n = 0;
        const move = q('update records set fp = ? where story_id = ? and id = ? and job_id is null and fp != ?');
        for (const id of ids) if (Number.isInteger(id)) n += Number(move.run(fp, storyId, id, fp).changes);
        return n;
    }

    // 玩家在"跟后台说话"里改的、作废的（N-104，最高权威）：原条标成 void_user（留痕、看不见），改的另记一条同出处的（不属于哪次记账，重核不动它）；
    // 别的"了结"指着原条的，改指新条。返回新条的编号（只作废时是 null）。
    function correct(id, text = null, why = '') {
        const old = q('select * from records where id = ?').get(id);
        if (!old) throw Object.assign(new Error('没有这条记录'), { status: 404 });
        db.exec('begin immediate');
        try {
            q("update records set status = 'void_user', reason = ? where id = ?").run(String(why || '玩家改了').slice(0, 300), id);
            let fresh = null;
            if (text) {
                const cols = COLUMNS.split(',').map(c => c.trim());
                const pick = c => (c === 'job_id' ? 'null' : c === 'text' ? '?' : c === 'status' ? "'ok'" : c === 'reason' ? '?' : c === 'created_at' ? '?' : c);
                fresh = Number(q(`insert into records(${cols.join(', ')}) select ${cols.map(pick).join(', ')} from records where id = ?`)
                    .run(String(text).slice(0, 200), `玩家改的；原来是：${old.text}`.slice(0, 300), now(), id).lastInsertRowid);
                q("update records set idea_ref = ? where idea_ref = ? and type = '了结'").run(fresh, id);
                q('update record_links set to_id = ? where to_id = ?').run(fresh, id);
            }
            db.exec('commit');
            return fresh;
        } catch (error) { db.exec('rollback'); throw error; }
    }

    // 补认约定（recheck.mjs）：给早先记下的那条补上约定那一格
    function setPromise(id, promise) {
        q('update records set promise = ? where id = ?').run(promise ? JSON.stringify(promise) : null, id);
    }

    function setWide(id, wide) {
        q('update records set wide = ? where id = ?').run(wide?.length ? JSON.stringify(wide) : null, id);
    }

    function setExtract(chatKey, on) {
        q('update chats set extract = ? where key = ?').run(on ? 1 : 0, chatKey);
    }

    return { setPromise, correct, isDone, startJob, setServed, failJob, finishJob, replaceJobRecords, spentToday, spentTodayOn, logAssemble, assembleCalls, visible, openIdeas, openTodos, jobs, failures, recentFailures, skipped, unskip, skip, retireDerived, setKeys, setWide, setExtract, addDerived, seedsAt, retire, moveDerived };
}
