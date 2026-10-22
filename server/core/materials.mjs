// 剧情素材（开局单设计稿 §四、N-131）：用户为一局上传 txt、md、json、csv（只要读得出来）。后台先看一眼，提一个用法，用户点头才处理：
// - 开局单：这一局自己的设定、大纲、开场稿 → 走"贴一整段"那条路分到开局单各格，用户核对；
// - 关系表：主要在写人 → 整理成关系表的格子，接在原表后面给用户核对、保存；
// - 参考资料：世界观、地点、势力、历史这类查阅用的 → 存进这一局的资料夹，参谋（和经它的规划）按问题翻出相关的几段（"抓取"）。
// 存在 <数据目录>/materials/<局>/：收件/ 是刚传上来的，参考/ 是当参考资料用的（参谋读这个目录）；index.json 记每份的用法和状态。
// 题材无关：判断用法的规矩是通用的。
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fromText as relationsFromText } from './relations.mjs';
import { cleanAnswer, isTransient } from './handoff.mjs';

export const KINDS = ['开局单', '关系表', '参考资料'];
const EXT = /\.(txt|md|markdown|json|csv)$/i;
const MAX_FILE = 2_000_000;

export const LOOK_SYSTEM = [
    '下面是用户为一部长篇角色扮演上传的一份素材（可能是设定、大纲、开场稿、人物关系、势力、时间线、世界书导出……）。看一眼，判断它该怎么用，三选一：',
    '- 开局单：这一局自己的设定、大纲、开场稿、主线和储备线、开局前发生过的事；',
    '- 关系表：主要在写人——谁是谁、谁和谁什么关系、各自的地盘和本事、谁知道什么；',
    '- 参考资料：世界观、地点、势力、物品、价格、历史、时间线这类查阅用的。',
    '只输出 JSON：{"用法": "开局单|关系表|参考资料", "为什么": "一句", "大意": "两三句说这份素材讲了什么"}',
].join('\n');

export const lookPrompt = ({ name, text }) => `【文件名】${name}\n【内容】（太长的只给开头）\n${String(text).slice(0, 12000)}`;

export function parseLook(text) {
    const m = String(text ?? '').match(/\{[\s\S]*\}/);
    let raw = null;
    try { raw = m ? JSON.parse(m[0]) : null; } catch {}
    const kind = KINDS.includes(raw?.['用法']) ? raw['用法'] : '参考资料';
    return { kind, why: String(raw?.['为什么'] ?? '').slice(0, 200), summary: String(raw?.['大意'] ?? '').slice(0, 400) };
}

export const RELATIONS_SYSTEM = [
    '把用户给的人物素材整理成人物关系表的格子（只搬素材里写了的，不补、不改意思；没写的格不写）。每人一段：',
    '## 人名',
    '又名：别名、外号（顿号隔开）',
    '现在：他现在是谁、在做什么（一句）',
    '地盘：他常在、管得着的地方',
    '本事：他能给到什么、给得多准多细',
    '关系：',
    '· 某人：两人什么关系、什么态度',
    '开局知道：',
    '· 故事开始时他知道的事',
    '开局不知道：',
    '· 故事开始时他还不知道的事（只给规划看）',
    '只输出这些段落，不要别的话。',
].join('\n');

// 卡只取介绍三项，按名册身份认，主要在前；总输入（含标记）不超过十二万字。
export function relationsDraftInput({ cast = [], cards = [], setup = {}, net = '' } = {}) {
    const byAvatar = new Map(cards.filter(c => c && typeof c.avatar === 'string').map(c => [c.avatar, c]));
    const ordered = cast.filter(c => c.role !== '不用' && !String(c.avatar).startsWith('face:')).sort((a,b) => Number(b.role === '主要') - Number(a.role === '主要'));
    let truncatedChars = 0, truncatedCards = 0;
    const marker = '（后面略）';
    const blocks = ordered.flatMap(person => {
        const card = byAvatar.get(person.avatar); if (!card) return [];
        const raw = typeof card.text === 'string' ? card.text : [card.description, card.personality, card.scenario].filter(x => typeof x === 'string' && x.trim()).join('\n');
        const original = Math.max(raw.length, Number.isSafeInteger(card.sourceChars) ? card.sourceChars : 0);
        const text = raw.length > 3000 ? raw.slice(0, 3000-marker.length) + marker : raw;
        if (original > text.length) { truncatedCards++; truncatedChars += original-text.length; }
        if (!raw.trim()) return [];
        return [`【角色卡：${person.name}（${person.role}）】\n${text}`];
    });
    blocks.push('【开局单：前史、口径、人物开场状态】\n' + JSON.stringify({ 前史: setup?.前史 ?? [], 口径: setup?.口径 ?? [], 开场状态: setup?.开场状态 ?? [] }));
    if (net) blocks.push('【素材包关系网】\n' + net);
    const raw = blocks.join('\n\n'), user = raw.length > 120000 ? raw.slice(0, 120000-marker.length) + marker : raw;
    truncatedChars += raw.length-user.length;
    return { user, chars: user.length, truncatedChars, truncatedCards };
}

// 自动草稿与生效关系表分开存，外援和 API 走同一条核验路径。
export function createRelationsDrafts({ store, records, handoffs, getConfig, clientFor, packFor = () => null, log = () => {} }) {
    const key = storyId => `relations_draft:${storyId}`;
    const read = storyId => { try { return JSON.parse(store.getMeta(key(storyId)) ?? 'null'); } catch { return null; } };
    const write = (storyId, value) => { store.setMeta(key(storyId), value ? JSON.stringify(value) : null); return value; };
    const populated = storyId => !!store.relationsOf(storyId)?.人?.length;
    const current = meta => !populated(meta.storyId) && read(meta.storyId)?.id === meta.id && store.setupOf(meta.storyId)?.id === meta.setupId;
    const view = storyId => { const d = read(storyId); return d && current({ ...d, storyId }) ? d : null; };
    const finish = (text, meta, patch = {}) => {
        if (!current(meta)) throw new Error('relations_draft_stale');
        const answer = cleanAnswer(text), people = relationsFromText(answer).人.length;
        if (!people) throw new Error('关系表草稿里没有可核对的人物，原表保留');
        const d = write(meta.storyId, { ...read(meta.storyId), status: 'drafted', text: answer, people, ...patch });
        return { people: d.people };
    };
    const configured = s => !!(s?.baseUrl && s.apiKey && s.model);
    const cost = (usage, s) => ((usage?.input ?? 0) * (s.priceInPerM ?? 0) + (usage?.output ?? 0) * (s.priceOutPerM ?? 0)) / 1e6;
    const generate = async (meta, user) => {
        const cfg = getConfig(), s = cfg.stages?.setup, started = Date.now();
        if (!current(meta)) return;
        if (!configured(s)) { write(meta.storyId, { ...read(meta.storyId), status: 'unconfigured', reason: '没配开局单那档的模型，关系表要手写或从素材整理' }); return; }
        if (Number.isFinite(cfg.extractor?.dailyBudgetUsd) && (records?.spentToday?.() ?? 0) >= cfg.extractor.dailyBudgetUsd) { write(meta.storyId, { ...read(meta.storyId), status: 'blocked', reason: '今天后台预算已到上限，关系表先手写或从素材整理' }); return; }
        let response = null;
        try {
            const r = response = await clientFor({ ...s, maxOutputTokens: 16000, timeoutMs: 600000, stream: true }).complete({ system: RELATIONS_SYSTEM, user });
            const usd = cost(r.usage, s);
            if (current(meta)) finish(r.text, meta, { costUsd: (read(meta.storyId).costUsd ?? 0) + usd, via: 'api' });
            records?.logAssemble({ chatKey: meta.chatKey, speaker: '(开局单·关系表草稿)', model: s.model, servedModel: r.servedModel, status: 'done', usage: r.usage, costUsd: usd, ms: Date.now()-started, raw: r.text });
        } catch (error) {
            const usage = error.usage ?? response?.usage ?? null, usd = cost(usage, s);
            records?.logAssemble({ chatKey: meta.chatKey, speaker: '(开局单·关系表草稿)', model: s.model, status: 'failed', usage, costUsd: usd, ms: Date.now()-started, error: error.message });
            if (!current(meta)) return;
            const old = read(meta.storyId), base = { ...old, costUsd: (old.costUsd ?? 0) + usd, reason: error.message };
            if (handoffs && isTransient(error)) {
                const id = handoffs.request({ kind: 'relations-draft', key: meta.id, chatKey: meta.chatKey, why: error.message, system: RELATIONS_SYSTEM, user, task: '只把提供的卡介绍、开局单和关系网里写明的内容整理成关系表，等玩家核对保存', checks: '至少有一段可解析的人物；只存草稿，不直接写入关系表', meta });
                write(meta.storyId, { ...base, status: 'handoff', handoff: id });
            } else write(meta.storyId, { ...base, status: 'failed' });
            log(`relations draft failed: ${error.message}`);
        }
    };
    handoffs?.register('relations-draft', {
        stale: meta => !current(meta),
        apply: (text, meta) => finish(text, meta, { via: 'handoff' }),
        retry: async (meta, h) => { await generate(meta, h.payload.user); return view(meta.storyId)?.status === 'drafted' ? 'done' : 'failed'; },
    });
    return { view, clear: storyId => write(storyId, null),
        async start({ chatKey, cards = [] }) {
            const chat = store.requireChat(chatKey), setup = store.setupOf(chat.story_id);
            if (!setup || populated(chat.story_id)) return;
            const old = view(chat.story_id);
            if (old && ['working', 'handoff', 'drafted'].includes(old.status)) return old;
            const id = randomUUID(), meta = { id, chatKey, storyId: chat.story_id, setupId: setup.id };
            const pack = packFor(chatKey); let net = '';
            if (pack?.dir) { try { net = fs.readFileSync(path.join(pack.dir, '关系网.json'), 'utf8'); } catch (error) { if (error.code !== 'ENOENT') log(`relations network read failed: ${error.message}`); } }
            const input = relationsDraftInput({ cast: store.getCast(chat.story_id), cards, setup: setup.data, net });
            write(chat.story_id, { id, setupId: setup.id, status: 'working', costUsd: 0, chars: input.chars, truncatedChars: input.truncatedChars, truncatedCards: input.truncatedCards });
            log(`relations draft input: ${input.chars} chars; trimmed ${input.truncatedChars}, cards ${input.truncatedCards}`);
            await generate(meta, input.user);
            return view(chat.story_id);
        },
    };
}

// 文件名只留安全的字（中英文、数字、空格、点、横线、下划线），不许带路径。
export const safeName = name => path.basename(String(name ?? '')).replace(/[^\p{L}\p{N} ._\-（）()]/gu, '_').slice(0, 120);

export function createMaterials(home) {
    const root = storyId => path.join(home, 'materials', storyId);
    const indexFile = storyId => path.join(root(storyId), 'index.json');
    const read = storyId => { try { return JSON.parse(fs.readFileSync(indexFile(storyId), 'utf8')); } catch { return []; } };
    const write = (storyId, list) => { fs.mkdirSync(root(storyId), { recursive: true }); fs.writeFileSync(indexFile(storyId), JSON.stringify(list, null, 2)); };
    const fileOf = (storyId, item) => path.join(root(storyId), item.where === '参考' ? '参考' : '收件', item.name);
    return {
        list: storyId => read(storyId),
        // 参谋读的目录（没有就是 null）
        libraryDir: storyId => (fs.existsSync(path.join(root(storyId), '参考')) ? path.join(root(storyId), '参考') : null),
        add(storyId, files) {
            const list = read(storyId);
            const added = [];
            for (const f of files) {
                const name = safeName(f.name);
                const text = String(f.text ?? '');
                if (!EXT.test(name)) throw Object.assign(new Error(`${name}：只收 txt、md、json、csv`), { status: 400 });
                if (!text.trim() || text.length > MAX_FILE) throw Object.assign(new Error(`${name}：空的或太大（上限两百万字）`), { status: 400 });
                const dir = path.join(root(storyId), '收件');
                fs.mkdirSync(dir, { recursive: true });
                fs.writeFileSync(path.join(dir, name), text);
                const old = list.findIndex(x => x.name === name);
                if (old >= 0) { try { fs.rmSync(fileOf(storyId, list[old]), { force: true }); } catch {} list.splice(old, 1); }
                const item = { name, chars: text.length, where: '收件', status: 'looking', at: new Date().toISOString() };
                list.push(item);
                added.push(item);
            }
            write(storyId, list);
            return added;
        },
        text: (storyId, name) => { const item = read(storyId).find(x => x.name === name); return item ? fs.readFileSync(fileOf(storyId, item), 'utf8') : null; },
        update(storyId, name, patch) {
            const list = read(storyId);
            const item = list.find(x => x.name === name);
            if (!item) return null;
            if (patch.where && patch.where !== item.where) {
                const from = fileOf(storyId, item);
                const to = path.join(root(storyId), patch.where === '参考' ? '参考' : '收件', item.name);
                fs.mkdirSync(path.dirname(to), { recursive: true });
                fs.renameSync(from, to);
            }
            Object.assign(item, patch, { at: new Date().toISOString() });
            write(storyId, list);
            return item;
        },
        remove(storyId, name) {
            const list = read(storyId);
            const i = list.findIndex(x => x.name === name);
            if (i < 0) return;
            try { fs.rmSync(fileOf(storyId, list[i]), { force: true }); } catch {}
            list.splice(i, 1);
            write(storyId, list);
        },
    };
}
