// T154a 量尺：给一个 store 和一个 chatKey，把这个窗"知道的一切"倒成一份规范化、可深度比较的对象。
// 纯读：只调现有读口（historyOf、currentMessages、plansOf 的口径、menuOf、absences、contactOffers、notesOf、episodesOf、
// stateNotesOf、declarationsOf、getMeta……）和只读 SQL，不写库。
// 已知的读口副作用（幂等的派生值，不改"知道什么"）：historyOf 在分支窗还没量过共有前缀时会补写 chats.branch_len。
// records 读口要调用方传 { records }（openRecords 的返回）；不传就不倒记账那几类（table:records 为空）。
//
// 返回 { chat, know, cache }：
//   know  ：登记表里 knows=true 的每一类（键＝登记表的 key），三句判据拿它比；
//   cache ：knows=false 的类（缓存/游标/提示/序号/流水），只记有几条，不比；
//   规范化：去掉登记表 DROP_FIELDS 和该项 strip 里的字段（递归）、窗/局的随机标识换成占位、对象键排序。
import { situationReader } from './situation.mjs';
import { DROP_FIELDS, TABLES, META } from './state-registry.mjs';

const CHAT = '<chat>', STORY = '<story>';
const json = v => { if (v == null) return null; if (typeof v !== 'string') return v; try { return JSON.parse(v); } catch { return v; } };

function canon(value, drop) {
    if (Array.isArray(value)) return value.map(v => canon(v, drop));
    if (value && typeof value === 'object') {
        const out = {};
        for (const k of Object.keys(value).sort()) if (!drop.has(k) && value[k] !== undefined) out[k] = canon(value[k], drop);
        return out;
    }
    return value;
}

export function dumpWindow(store, chatKey, { records = null, situation = null } = {}) {
    const db = store.db;
    const chat = store.requireChat(chatKey), storyId = chat.story_id;
    const hasTable = name => !!db.prepare("select 1 from sqlite_master where type = 'table' and name = ?").get(name);
    // records 由调用方传入（openRecords 开库时会跑一次迁移写库，倒出来不自己开）；situationReader 只读
    const rec = records;
    const sit = situation ?? (hasTable('situation_ticks') ? situationReader(db) : null);
    const h = store.historyOf(chatKey);
    const msgs = store.currentMessages(chatKey);
    const fps = new Set(msgs.map(m => m.fp));
    const inFps = list => list.filter(r => fps.has(r.fp));
    // records / situation 的表由各自模块开库时才建；没建的当没有
    const all = (sql, ...args) => { try { return db.prepare(sql).all(...args); } catch (e) { if (/no such table/.test(e.message)) return []; throw e; } };

    // 规划用"第几份"代替自增编号（按本窗看得见的、锚点位置排）
    const planRows = (() => {
        const keys = h.keys, rows = all(`select * from plans where chat_key in (${keys.map(() => '?').join(', ')}) and status != 'withdrawn' order by id`, ...keys)
            .filter(p => h.sees(p.chat_key, p.anchor_pos, p.anchor_fp))
            .filter(p => (b => !b || h.sees(p.chat_key, b.pos, b.fp))(json(store.getMeta(`plan_basis:${p.id}`))))
            .sort((a, b) => (a.anchor_pos ?? -1) - (b.anchor_pos ?? -1) || a.id - b.id);
        return rows;
    })();
    const planNo = new Map(planRows.map((p, i) => [p.id, `plan${i + 1}`]));
    const menuItems = store.menuOf(chatKey, { all: true });
    const itemLabel = new Map(menuItems.map(m => [m.id, `${planNo.get(m.plan_id) ?? '?'}|${m.who}|${m.title}`]));
    const logRows = all(`select * from menu_log where chat_key in (${h.keys.map(() => '?').join(', ')}) order by id`, ...h.keys).filter(r => h.sees(r.chat_key, r.pos, r.fp));
    const logLabel = new Map(logRows.map(r => [r.id, `${itemLabel.get(r.item_id) ?? '?'}|${r.status}|${r.pos}`]));
    const absRows = store.absences(chatKey);
    const absLabel = new Map(absRows.map(a => [a.id, a.from_fp]));
    const recRows = rec ? rec.visible(chatKey, { all: true }) : [];
    const recLabel = new Map(recRows.map(r => [r.id, `${r.fp}|${r.type}|${r.holder_name ?? ''}|${String(r.raw_text ?? r.text).slice(0, 40)}`]));

    const readers = {
        'table:messages': () => msgs.map(m => ({ pos: m.pos, fp: m.fp, is_user: m.is_user, speaker: m.speaker, name: m.name, text: m.text, lore: m.lore, vis: m.vis, sent_at: m.sent_at })),
        'table:records': () => recRows.map(r => ({ ...r, plan_label: undefined })),
        'table:extract_done': () => inFps(all('select fp from extract_done where story_id = ? order by fp', storyId)),
        'table:record_links': () => all('select from_id, to_id, kind from record_links where story_id = ? order by id', storyId)
            .filter(l => recLabel.has(l.from_id)).map(l => ({ from: recLabel.get(l.from_id), to: recLabel.get(l.to_id) ?? `#${l.to_id}`, kind: l.kind })),
        'table:state_notes': () => store.stateNotesOf(chatKey),
        'table:episodes': () => store.episodesOf(chatKey),
        'table:situation_ticks': () => sit ? sit.ticksFor(storyId, fps) : [],
        'table:situation_moves': () => sit ? sit.movesOf(sit.ticksFor(storyId, fps).map(t => t.id)) : [],
        'table:situation_move_reviews': () => sit ? sit.reviewsOf(sit.ticksFor(storyId, fps).map(t => t.id)) : [],
        'table:situation_spreads': () => sit ? sit.spreadsOf(sit.ticksFor(storyId, fps).map(t => t.id)) : [],
        'table:situation_outcomes': () => sit ? sit.outcomesOf(sit.ticksFor(storyId, fps).map(t => t.id)) : [],
        'table:chats': () => ({ members: json(chat.members), anchors: json(chat.anchors), test_slot: chat.test_slot, enabled: chat.enabled, extract_from: chat.extract_from ?? null, extract: chat.extract ?? 0 }),
        'table:chat_seq': () => all('select pos, fp, hidden, sent_at, mark, sw, swipes, board_mark, vis from chat_seq where chat_key = ? order by pos', chatKey),
        'table:plans': () => planRows.map(p => ({ no: planNo.get(p.id), status: p.status, reason: p.reason, story_day: p.story_day, goal: p.goal, node: json(p.node), bring_next: json(p.bring_next), anchor_pos: p.anchor_pos, anchor_fp: p.anchor_fp })),
        'table:menu': () => menuItems.map(m => ({ ...m, plan_label: planNo.get(m.plan_id) ?? null })),
        'table:menu_log': () => logRows.map(r => ({ item: itemLabel.get(r.item_id) ?? '?', status: r.status, story_day: r.story_day, pos: r.pos, fp: r.fp, by_name: r.by_name, why: r.why, basis_part: r.basis_part, pending: r.pending })),
        'table:intimate_progress': () => store.intimateProgressOf(chatKey),
        'table:intimate_stops': () => store.intimateStopsOf(chatKey),
        'table:absences': () => absRows,
        'table:slots': () => all('select speaker, anchor, text, ids, parts, ver from slots where chat_key = ? order by speaker, anchor', chatKey),
        'table:carries': () => Object.fromEntries([...new Set(all('select distinct c.speaker from carries c join chats h on h.key = c.chat_key where h.story_id = ?', storyId).map(r => r.speaker))].sort().map(sp => [sp, store.carryBefore({ chatKey, speaker: sp })]).filter(([, v]) => v.length)),
        'table:snapshots': () => all('select pos, fp, data from snapshots where chat_key = ? order by pos', chatKey),
        'table:notes': () => store.notesOf(chatKey),
        'table:contact_offers': () => store.contactOffers(chatKey),
        'table:handoffs': () => store.pendingHandoffs().filter(x => x.chat_key == null || h.keys.includes(x.chat_key)).map(x => ({ kind: x.kind, key: x.key, global: x.chat_key == null, status: x.status })),
        'table:plan_attempts': () => all('select count(*) n from plan_attempts where chat_key = ?', chatKey)[0]?.n ?? 0,
        'table:events': () => all('select kind from events where chat_key = ? order by id', chatKey).map(e => e.kind),
        'table:extract_jobs': () => all('select count(*) n from extract_jobs where chat_key = ?', chatKey)[0]?.n ?? 0,
        'table:assemble_calls': () => all('select count(*) n from assemble_calls where chat_key = ?', chatKey)[0]?.n ?? 0,
        'table:stories': () => ({ exists: !!all('select 1 from stories where id = ?', storyId).length }),
        'table:cast': () => store.getCast(storyId),
        'table:relations': () => store.relationsOf(storyId),
        'table:setups': () => { const s = store.setupOf(storyId); return s ? { status: s.status, data: s.data } : null; },
        'table:lore': () => store.loreOf(storyId),
        'table:card_groups': () => store.declarationsOf(storyId),
        'table:card_profiles': () => store.getCast(storyId).map(e => store.profileOf(e.avatar)).filter(Boolean).map(({ avatar, text, card_text, card_name }) => ({ avatar, text, card_text, card_name })),
    };

    // meta：按登记表逐项读（getMeta＝现在实际的读口，带来源过滤）
    const metaRows = prefix => all('select key from meta where key like ? escape \'\\\'', `${prefix.replace(/[\\_%]/g, c => '\\' + c)}:%`).map(r => r.key);
    // 值里带 { pos, fp } 的条目，那一楼在本窗序列里已经不是那条消息（删了、改了）就不算数——和 store.readMeta 里那七类、
    // 以及各读口按 pos/fp 过滤的口径一致（读口各自判，这里统一按"那一楼还是不是那条"）。数组滤元素，按人名/编号分键的对象滤值；滤空了当没有。
    // 楼号取 pos，没有 pos 的取 at（settled_contact 这类 at＝楼号）；arrived 的 at 是进场后的下一楼，另按 at-1
    const posOf = (e, shift = 0) => Number.isInteger(e?.pos) ? e.pos : Number.isInteger(e?.at) ? e.at - shift : null;
    const deadAt = (e, shift = 0) => e && typeof e === 'object' && !Array.isArray(e) && posOf(e, shift) != null && typeof e.fp === 'string' && posOf(e, shift) >= 0
        && !(msgs[posOf(e, shift)] && (msgs[posOf(e, shift)].fp === e.fp || store.sameMessage(msgs[posOf(e, shift)].fp, e.fp)));
    const liveValue = (v, shift = 0) => {
        if (Array.isArray(v)) { const r = v.filter(e => !deadAt(e, shift)); return r.length ? r : null; }
        if (!v || typeof v !== 'object') return v;
        if (deadAt(v, shift)) return null;
        const vals = Object.values(v);
        if (vals.length && vals.every(x => x && typeof x === 'object' && posOf(x, shift) != null && typeof x.fp === 'string')) {
            const r = Object.fromEntries(Object.entries(v).filter(([, x]) => !deadAt(x, shift)));
            return Object.keys(r).length ? r : null;
        }
        return v;
    };
    const readMeta = entry => {
        const out = {};
        if (entry.scope === 'global') {   // 无后缀的全局键，键名就是前缀本身
            const v = store.getMeta(entry.prefix);
            return v == null ? out : { '-': json(v) };
        }
        const base = entry.scope === 'story' ? storyId : chatKey;
        if (entry.prefix === 'arrivals') {   // 进场记账是"顺着父窗读"的：sourceProjection 读同局各窗，只到分叉点
            const list = [];
            for (const origin of h.keys) {
                const own = origin === chatKey;
                const raw = json(own ? store.getMeta(`arrivals:${origin}`) : store.getRawMeta(`arrivals:${origin}`));
                if (!Array.isArray(raw)) continue;
                for (const e of raw) if (h.sees(origin, Number(e.at) - 1, e.fp)) list.push(e);
            }
            const live = list.length ? list : null;
            return live == null ? out : { '-': live };
        }
        for (const key of metaRows(entry.prefix)) {
            const rest = key.slice(entry.prefix.length + 1);
            let name = null, value;
            if (entry.scope === 'window' || entry.scope === 'story') {
                if (rest !== base && !rest.startsWith(base + ':')) continue;
                name = rest.slice(base.length + 1) || '-';
            } else if (entry.scope === 'plan') {
                const id = Number(rest); if (!planNo.has(id)) continue;
                name = planNo.get(id);
            } else if (entry.scope === 'step') {
                const id = Number(rest);
                name = entry.prefix === 'menu_proof' ? logLabel.get(id) : entry.prefix === 'back_planned' ? absLabel.get(id) : itemLabel.get(id);
                if (name == null) continue;
            } else if (entry.scope === 'fp') {
                if (!fps.has(rest)) continue;
                name = rest;
            } else continue;
            value = store.getMeta(key);
            if (value == null) continue;
            value = liveValue(json(value), entry.prefix === 'arrived' ? 1 : 0);
            if (value == null) continue;
            if (entry.prefix === 'replan_of') value = planNo.get(Number(value)) ?? value;
            out[name] = value;
        }
        return out;
    };

    const know = {}, cache = {};
    const finish = (value, entry) => {
        const drop = new Set([...DROP_FIELDS, ...(entry.strip ?? [])]);
        const text = JSON.stringify(value ?? null).replaceAll(chatKey, CHAT).replaceAll(storyId, STORY);
        return canon(JSON.parse(text), drop);
    };
    for (const entry of TABLES) {
        if (entry.dump === false) continue;
        const read = readers[entry.key];
        if (!read) throw new Error(`state-dump: 登记表里的 ${entry.key} 没有读法`);
        (entry.knows ? know : cache)[entry.key] = entry.knows ? finish(read(), entry) : (v => Array.isArray(v) ? v.length : v)(read());
    }
    for (const entry of META) {
        if (entry.should === 'counter') continue;
        const value = readMeta(entry);
        if (entry.knows) know[entry.key] = finish(value, entry);
        else cache[entry.key] = Object.keys(value).length;
    }
    const sorted = o => Object.fromEntries(Object.keys(o).sort().map(k => [k, o[k]]));
    return { chat: { total: msgs.length }, know: sorted(know), cache: sorted(cache) };
}






