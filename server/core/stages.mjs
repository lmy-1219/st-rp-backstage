// 各环节的钥匙和模型（D-106：划掉 ComfyUI，改在 ST 面板里选）。
// 面板经转发插件过来：看各环节此刻用什么、今天调了几次花了多少；存钥匙、换钥匙和模型、拉型号列表、测思考档传不传得过去。
// 钥匙只存在后台的 config.json 里；这里任何一个返回都不带整把钥匙，只给末四位（面板可能经端口映射在别处打开）。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import modelData from './models.json' with { type: 'json' };
import { loadConfig, STAGES, EFFORTS, probeKey, EMBED_MODEL, embedProbeKey, sameKeyName } from './config.mjs';
import { IDLE_MS } from './model.mjs';

const tail = key => (key ? `…${String(key).slice(-4)}` : '');
const cleanUrl = v => (typeof v === 'string' ? v.trim().replace(/\/+$/, '') : '');

export function matchModel(name, list) {
    if (typeof name !== 'string') return null;
    if (list.includes(name)) return name;
    const normalize = s => s.toLowerCase().replace(/[._ ]/g, '-');
    const exact = list.filter(s => normalize(s) === normalize(name));
    if (exact.length === 1) return exact[0];
    if (exact.length > 1) return null;
    const bare = s => normalize(s).replace(/^[^/]+\//, '');
    const hits = list.filter(s => bare(s) === bare(name));
    return hits.length === 1 ? hits[0] : null;
}

// 记在叙事组装那张表里的调用，按"说话的人"认是哪个环节；不带括号的是角色名（叙事组装）。
export function stageOfSpeaker(speaker) {
    const s = String(speaker ?? '');
    if (!s.startsWith('(')) return 'assemble';
    if (s === '(检索词)') return 'keys';
    if (s === '(转向检查)' || s === '(节点检查)' || s === '(前情大意)' || s === '(规划·修格式)') return 'judge';
    if (s === '(规划)') return 'plan';
    if (s.startsWith('(离开推演')) return 'away';   // 含"按玩家改"那一次
    if (s === '(结算)') return 'scene';
    if (s === '(镜头外回话)') return 'scene';
    if (s === '(局势)' || s === '(持续的事)') return 'situation';
    if (s.startsWith('(参谋')) return 'advisor';
    if (s.startsWith('(开局单')) return 'setup';
    if (s === '(前史检索词)') return 'setupKeys';
    if (s === '(去复读)' || s === '(截一刀)' || s === '(叩门回应)') return 'fresh';   // 截一刀、叩门回应借去复读那一档的模型
    if (s === '(读卡)') return 'profile';
    if (s === '(兴头)' || s === '(此刻的样子)' || s === '(看一眼)' || s === '(场次摘要)' || s === '(进场)' || s === '(离场)') return 'scene';   // 此刻的样子、场次摘要、进场借兴头那一档的模型
    if (s === '(备料)') return 'prep';
    if (s === '(跟后台说话)') return 'talk';
    if (s === '(世界书谁知道)') return 'lore';
    if (s === '(素材)') return 'advisor';
    if (s === '(补认约定)' || s === '(跨天收尾)') return 'extract';   // 用记账那档的模型（recheck.mjs；跨天收尾见 main.runCloseCheck）
    return null;
}

// onKeys：钥匙簿或"向量"环节变了（后台据此重测哪把能调向量、补转旧记录）
export function createStagesAdmin({ home, db = null, fetchImpl = fetch, onKeys = () => {} }) {
    const file = path.join(home, 'config.json');
    const cacheFile = path.join(home, 'model-lists.json');
    let cache = {}; try { cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); } catch {}
    const inflight = new Map();
    const cacheId = k => crypto.createHash('sha256').update(JSON.stringify([cleanUrl(k.baseUrl), k.name ?? k.key ?? ''])).digest('hex');
    const fingerprint = k => crypto.createHash('sha256').update(k.apiKey).digest('hex');
    const readRaw = () => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; } };
    // 先写临时文件再换名：写到一半后台正好读配置，读到的不会是半截
    const patch = mutate => {
        const raw = readRaw();
        mutate(raw);
        fs.writeFileSync(`${file}.tmp`, `${JSON.stringify(raw, null, 2)}\n`);
        fs.renameSync(`${file}.tmp`, file);
    };
    const bad = message => { throw Object.assign(new Error(message), { status: 400 }); };

    function today() {
        const out = Object.fromEntries(STAGES.map(s => [s.id, { calls: 0, usd: 0 }]));
        if (!db) return out;
        const since = new Date(); since.setHours(0, 0, 0, 0);
        for (const r of db.prepare('select speaker, count(*) n, coalesce(sum(cost_usd), 0) usd from assemble_calls where created_at >= ? group by speaker').all(since.toISOString())) {
            const id = stageOfSpeaker(r.speaker);
            if (id) { out[id].calls += r.n; out[id].usd += r.usd; }
        }
        const e = db.prepare('select count(*) n, coalesce(sum(cost_usd), 0) usd from extract_jobs where started_at >= ?').get(since.toISOString());
        out.extract.calls += e.n; out.extract.usd += e.usd;
        return out;
    }

    function view() {
        const config = loadConfig(home), raw = readRaw(), used = today();
        return {
            batch: config.extractor.batch,
            keys: config.keys.map(k => ({ name: k.name, baseUrl: k.baseUrl, tail: tail(k.apiKey) })),
            // 各环节写着要用、钥匙簿里还没有的钥匙名（推荐配置里写的是名字，钥匙由用户照名字存）
            // 钥匙簿里只有一把时各环节都用它，不算缺（alone：有环节是借它的）
            wanted: config.keys.length === 1 ? [] : [...new Set(Object.values(raw.stages ?? {}).map(ov => ov?.key).filter(n => typeof n === 'string' && n && !config.keys.some(k => sameKeyName(k.name, n))))],
            alone: config.keys.length === 1 && Object.values(config.stages).some(s => s.alone) ? config.keys[0].name : null,
            efforts: EFFORTS,
            stages: STAGES.map(s => {
                const x = config.stages[s.id], ov = raw.stages?.[s.id] ?? {};
                return {
                    id: s.id, name: s.name, follows: s.follows, key: x.key, baseUrl: x.baseUrl, tail: tail(x.apiKey), model: x.model,
                    priceInPerM: x.priceInPerM, priceOutPerM: x.priceOutPerM, chosen: !!raw.stages?.[s.id], auto: x.auto ?? null, off: x.off === true,
                    waits: typeof ov.key === 'string' && ov.key && !x.key ? ov.key : null,
                    effort: typeof ov.effort === 'string' ? ov.effort : '', effortOk: config.effortProbe[probeKey(x.baseUrl, x.model)] ?? null,
                    today: { calls: used[s.id].calls, usd: Math.round(used[s.id].usd * 1000) / 1000 },
                    recommended: modelData.recommended.stages[s.id]?.model ?? (s.id === 'extract' ? modelData.recommended.extractor.model : s.id === 'keys' || s.id === 'fresh' || s.id === 'setupKeys' ? modelData.recommended.assembler.keysModel : modelData.recommended.advisor.model),
                };
            }),
        };
    }

    function saveKey({ name, baseUrl, apiKey }) {
        name = typeof name === 'string' ? name.trim() : '';
        baseUrl = cleanUrl(baseUrl);
        if (!name || name.length > 40) bad('钥匙要起个名字（40 字以内）');
        if (!/^https?:\/\/\S+$/.test(baseUrl) || baseUrl.length > 300) bad('地址要以 http:// 或 https:// 开头');
        if (apiKey != null && (typeof apiKey !== 'string' || apiKey.length > 500)) bad('钥匙不对');
        patch(raw => {
            const keys = Array.isArray(raw.keys) ? raw.keys : [];
            const old = keys.find(k => sameKeyName(k?.name, name));
            const key = typeof apiKey === 'string' && apiKey.trim() ? apiKey.trim() : old?.apiKey;   // 不填钥匙＝沿用这个名字原来那把
            if (!key) bad('新钥匙要填钥匙本身');
            raw.keys = [...keys.filter(k => !sameKeyName(k?.name, name)), { name, baseUrl, apiKey: key }];
        });
        onKeys();
        void models({ key: name, refresh: true });
        return view();
    }

    // 删一把钥匙：用着它的环节回到"跟着原配置"
    function removeKey(name) {
        patch(raw => {
            raw.keys = (Array.isArray(raw.keys) ? raw.keys : []).filter(k => !sameKeyName(k?.name, name));
            for (const ov of Object.values(raw.stages ?? {})) if (sameKeyName(ov?.key, name)) delete ov.key;
        });
        return view();
    }

    function setStage(id, v) {
        if (!STAGES.some(s => s.id === id)) bad('没有这个环节');
        patch(raw => {
            const keys = Array.isArray(raw.keys) ? raw.keys : [];
            const ov = { ...(raw.stages?.[id] ?? {}) };
            // 没选钥匙时，这一格原来写着、钥匙簿里还没有的名字（推荐配置要的那把）留着：面板的下拉里没有它，空着不等于用户要清掉它（杂务窗 9/30：清掉了，名字改对了也补不上）
            if ('key' in v) {
                const hit = v.key ? keys.find(k => sameKeyName(k?.name, v.key)) : null;
                if (v.key && !hit) bad('钥匙簿里没有这把');
                if (hit) ov.key = hit.name;
                else if (!(typeof ov.key === 'string' && ov.key && !keys.some(k => sameKeyName(k?.name, ov.key)))) delete ov.key;
            }
            if ('model' in v) { const m = typeof v.model === 'string' ? v.model.trim() : ''; if (m.length > 200) bad('型号太长'); if (m) ov.model = m; else delete ov.model; }
            for (const f of ['priceInPerM', 'priceOutPerM']) if (f in v) {
                if (v[f] === null || v[f] === '') delete ov[f];
                else { const n = Number(v[f]); if (!Number.isFinite(n) || n < 0 || n > 1000) bad('单价不对'); ov[f] = n; }
            }
            if ('effort' in v) { if (v.effort && !EFFORTS.includes(v.effort)) bad('没有这个思考档'); if (v.effort) ov.effort = v.effort; else delete ov.effort; }
            if ('off' in v) { if (id !== 'embed') bad('只有向量能关'); if (v.off) ov.off = true; else delete ov.off; }
            raw.stages = { ...(raw.stages ?? {}), [id]: ov };
            if (!Object.keys(ov).length) delete raw.stages[id];
        });
        if (id === 'embed') onKeys();
        return view();
    }

    function resetStage(id) {
        patch(raw => { if (raw.stages) delete raw.stages[id]; });
        if (id === 'embed') onKeys();
        return view();
    }

    // 某把钥匙在那个地址上能用哪些型号（拉不到就返回空，面板让手填）。keyName 空＝这个环节此刻用的那把。
    async function models({ stage, key, refresh = false }) {
        const config = loadConfig(home);
        const k = key ? config.keys.find(x => sameKeyName(x.name, key)) : config.stages[stage];
        if (!k?.baseUrl || !k.apiKey) return { models: [], error: '这一环节还没有钥匙' };
        const id = cacheId(k), token = fingerprint(k);
        if (inflight.has(id)) return inflight.get(id);
        if (!refresh && cache[id]?.token === token) return cache[id].result;
        const request = (async () => { let result;
        try {
            const r = await fetchImpl(`${k.baseUrl}/models`, { headers: { authorization: `Bearer ${k.apiKey}`, 'x-api-key': k.apiKey, 'anthropic-version': '2023-06-01' }, signal: AbortSignal.timeout(20000) });
            if (!r.ok) result = { models: [], error: `渠道回 ${r.status}` };
            else {
            const body = await r.json().catch(() => null);
            const list = [...new Set((Array.isArray(body?.data) ? body.data : []).map(m => m?.id).filter(x => typeof x === 'string' && x.length <= 200))].sort();
            result = { models: list, ...(list.length ? {} : { error: '渠道没有返回型号列表' }) };
            }
        } catch (error) { result = { models: [], error: error.name === 'TimeoutError' ? '拉型号列表超时' : '连接渠道失败' }; }
        cache[id] = { token, result };
        try { fs.writeFileSync(`${cacheFile}.tmp`, JSON.stringify(cache)); fs.renameSync(`${cacheFile}.tmp`, cacheFile); } catch { /* 缓存写不成不影响手填 */ }
        return result;
        })();
        inflight.set(id, request);
        try { return await request; } finally { inflight.delete(id); }
    }

    // 只有一把钥匙时（10/2 用户定为默认）：它调得了各环节推荐的型号吗？拉一次型号列表比一比（不调模型、不花钱）。
    // 中转上的一把钥匙常常只开一家，别家的钥匙更是一个推荐型号都没有——调不了的那几格，面板上一键换成它调得了的。
    async function fit() {
        const config = loadConfig(home);
        if (config.keys.length !== 1) return { models: [], missing: [], error: '钥匙簿里不止一把（或者还没有）' };
        const { models: list, error } = await models({ key: config.keys[0].name });
        if (error || !list.length) return { models: [], missing: [], error: error ?? '没拉到型号列表' };
        const missing = STAGES.filter(s => s.id !== 'embed' && config.stages[s.id]?.model && config.stages[s.id].key === config.keys[0].name && !matchModel(config.stages[s.id].model, list))
            .map(s => ({ id: s.id, name: s.name, model: config.stages[s.id].model }));
        return { models: list, missing, key: config.keys[0].name };
    }
    // 把这几格（不给就是 fit 认出来调不了的那几格）都换成同一个型号；单价交给常见型号表，不认识的按贵的估，面板上能改
    async function useModel(model, ids = null) {
        const m = typeof model === 'string' ? model.trim() : '';
        if (!m || m.length > 200) bad('型号不对');
        const which = ids ?? (await fit()).missing.map(x => x.id);
        patch(raw => {
            for (const id of which) {
                if (!STAGES.some(s => s.id === id) || id === 'embed') continue;
                const ov = { ...(raw.stages?.[id] ?? {}), model: m };
                delete ov.priceInPerM; delete ov.priceOutPerM; delete ov.effort;
                raw.stages = { ...(raw.stages ?? {}), [id]: ov };
            }
        });
        return { ...view(), changed: which.length };
    }

    // 思考档传不传得过去：真调一次极短的问题。先按 OpenAI 的写法（reasoning_effort）；不成再按 Anthropic 的写法（output_config.effort，
    // 实测新一代 Claude 经中转只认这个，reasoning_effort 和 thinking.budget_tokens 都回 503）；还不成再什么都不带调一次，
    // 不带能成＝这个型号经这条线传不过去（记 false），都不成＝线路本身的毛病（不记，下回再测）。一个型号约几分钱。
    async function probe(stage) {
        const config = loadConfig(home);
        const s = config.stages[stage];
        if (!s?.baseUrl || !s.apiKey || !s.model) bad('这一环节还没配好');
        const call = async extra => {
            try {
                const r = await fetchImpl(`${s.baseUrl}/chat/completions`, {
                    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${s.apiKey}` },
                    body: JSON.stringify({ model: s.model, max_tokens: 2048, stream: false, messages: [{ role: 'user', content: '只回一个字：好' }], ...extra }),
                    signal: AbortSignal.timeout(IDLE_MS),   // 和别的调用一样：一分半不回才算没通（几次都在转发插件的四分钟内）
                });
                const body = await r.json().catch(() => null);
                return { ok: r.ok && Array.isArray(body?.choices), status: r.status };
            } catch (error) { return { ok: false, status: error.name === 'TimeoutError' ? 'timeout' : 'error' }; }
        };
        const withEffort = await call({ reasoning_effort: 'low' });
        let result = withEffort.ok ? true : null;
        if (!withEffort.ok && (await call({ output_config: { effort: 'low' } })).ok) result = 'output_config';
        if (result === null) result = (await call({})).ok ? false : null;
        if (result !== null) patch(raw => { raw.effortProbe = { ...(raw.effortProbe ?? {}), [probeKey(s.baseUrl, s.model)]: result }; });
        return { stage, model: s.model, ok: result, status: withEffort.status, ...view() };
    }

    // 钥匙簿里哪把能调向量模型（EMBED_MODEL）：没测过的（新存的、换了钥匙的）各转一个字试试，几乎不花钱。
    // 回了向量＝能；回了错＝不能；连不上、超时＝线路的毛病，不记，下回再测。
    async function probeEmbeds() {
        const config = loadConfig(home), done = config.embedProbe ?? {};
        const found = {};
        for (const k of config.keys) {
            const id = embedProbeKey(k);
            if (id in done || !k.baseUrl || !k.apiKey) continue;
            try {
                const r = await fetchImpl(`${k.baseUrl}/embeddings`, {
                    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${k.apiKey}` },
                    body: JSON.stringify({ model: EMBED_MODEL, input: ['好'] }), signal: AbortSignal.timeout(20000),
                });
                const body = await r.json().catch(() => null);
                if (r.ok && Array.isArray(body?.data?.[0]?.embedding) && body.data[0].embedding.length) found[id] = true;
                else if (r.status >= 400 && r.status < 500) found[id] = false;
            } catch { /* 线路的毛病，下回再测 */ }
        }
        if (Object.keys(found).length) patch(raw => { raw.embedProbe = { ...(raw.embedProbe ?? {}), ...found }; });
        return found;
    }

    return { view, saveKey, removeKey, setStage, resetStage, models, probe, probeEmbeds, fit, useModel };
}
