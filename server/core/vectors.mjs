// 向量检索（D-109 第 4 步，N-228）：按意思找旧事。记录记下后转成向量存本机（record_vectors）；每轮把玩家这句话转一次，
// 和这一局的记录比，挑意思最近的几条。字面对上的照样算（人名、地名字面更准），两样在 recall.selectMaterial 里合起来。
// 向量能用时就不再先让模型给这句话配检索词（那一步两三秒，挡在前台前面）；向量调不通就退回配检索词。
// 用哪个模型、哪把钥匙：面板"各环节的模型"里的"向量"那一环节（OpenAI 兼容的 /embeddings；本机 Ollama 也是这个接口）。

import { createHash } from 'node:crypto';

const BATCH = 16;
// 不是记录的一段话（开局单的前事）按文字存向量：同一段话只转一次，换了模型重转。
export const textKey = t => createHash('sha1').update(String(t)).digest('hex');

export function vecToBlob(v) { return Buffer.from(new Float32Array(v).buffer); }
export function blobToVec(b) { return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4); }

export function cosine(a, b) {
    let d = 0, x = 0, y = 0;
    for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; x += a[i] * a[i]; y += b[i] * b[i]; }
    return x && y ? d / Math.sqrt(x * y) : 0;
}

// 记录的哪段话拿去转向量：谁的说法＋内容（和检索时比的是"意思"，不含引文原话）。
export const recordText = r => `${r.holder_name ?? r.holder ?? ''}：${r.text}`;

// 一句话和一叠记录的相似度 → 只留明显突出的（比大多数记录高出一截的），缩到 0～1。
// 用离群程度而不是绝对值：不同模型的余弦分布不一样，一局里总有"最像"的一条，不相干时也不该硬塞。
export function senseScores(qvec, items, { z = 2.5, top = 12 } = {}) {
    if (!qvec || !items.length) return new Map();
    const sims = items.map(it => ({ id: it.id, s: cosine(qvec, it.vec) }));
    const n = sims.length, mean = sims.reduce((a, x) => a + x.s, 0) / n;
    const sd = Math.sqrt(sims.reduce((a, x) => a + (x.s - mean) ** 2, 0) / n) || 1;
    return new Map(sims.map(x => ({ id: x.id, z: (x.s - mean) / sd })).filter(x => x.z >= z).sort((a, b) => b.z - a.z).slice(0, top)
        .map(x => [x.id, Math.min(1, (x.z - z + 1) / 3)]));
}

export function createVectors({ db, getConfig, log = () => {}, fetchImpl = fetch }) {
    db.exec('create table if not exists record_vectors(record_id integer primary key, model text not null, vec blob not null)');
    db.exec('create table if not exists text_vectors(key text primary key, model text not null, vec blob not null)');
    const stage = () => getConfig().stages?.embed ?? null;
    const ready = () => { const s = stage(); return !!(s?.baseUrl && s.apiKey && s.model); };
    async function embed(texts, { timeoutMs = 60000 } = {}) {
        const s = stage();
        const out = [];
        for (let i = 0; i < texts.length; i += BATCH) {
            const r = await fetchImpl(`${s.baseUrl}/embeddings`, {
                method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${s.apiKey}` },
                body: JSON.stringify({ model: s.model, input: texts.slice(i, i + BATCH) }), signal: AbortSignal.timeout(timeoutMs),
            });
            const j = await r.json().catch(() => null);
            if (!r.ok || !Array.isArray(j?.data)) throw new Error(`embed_http_${r.status}`);
            out.push(...j.data.sort((a, b) => a.index - b.index).map(d => d.embedding));
        }
        return out;
    }
    // 这些记录里还没转过（或换了模型）的，转了存起来。在后台跑，不等。
    const busy = new Set();
    async function ensure(recs, key = 'all') {
        if (!ready() || busy.has(key)) return 0;
        const model = stage().model;
        const have = new Map(recs.length ? db.prepare(`select record_id, model from record_vectors where record_id in (${recs.map(() => '?').join(',')})`).all(...recs.map(r => r.id)).map(x => [x.record_id, x.model]) : []);
        const todo = recs.filter(r => have.get(r.id) !== model);
        if (!todo.length) return 0;
        busy.add(key);
        try {
            const vecs = await embed(todo.map(recordText), { timeoutMs: 120000 });
            const put = db.prepare('insert into record_vectors(record_id, model, vec) values (?, ?, ?) on conflict(record_id) do update set model = excluded.model, vec = excluded.vec');
            todo.forEach((r, i) => put.run(r.id, model, vecToBlob(vecs[i])));
            log(`vectors: ${todo.length} record(s) embedded with ${model}`);
            return todo.length;
        } finally { busy.delete(key); }
    }
    function vectorsOf(recs) {
        if (!recs.length || !ready()) return [];
        const model = stage().model;
        const rows = db.prepare(`select record_id, vec from record_vectors where model = ? and record_id in (${recs.map(() => '?').join(',')})`).all(model, ...recs.map(r => r.id));
        return rows.map(x => ({ id: x.record_id, vec: blobToVec(x.vec) }));
    }
    // 一叠文字（前事）：还没转过的转了存起来，在后台跑，不等；vectorsOfTexts 取已经转好的（id＝textKey）。
    async function ensureTexts(texts, key = 'texts') {
        if (!ready() || busy.has(key) || !texts.length) return 0;
        const model = stage().model;
        const keys = texts.map(textKey);
        const have = new Map(db.prepare(`select key, model from text_vectors where key in (${keys.map(() => '?').join(',')})`).all(...keys).map(x => [x.key, x.model]));
        const todo = texts.filter((t, i) => have.get(keys[i]) !== model);
        if (!todo.length) return 0;
        busy.add(key);
        try {
            const vecs = await embed(todo, { timeoutMs: 120000 });
            const put = db.prepare('insert into text_vectors(key, model, vec) values (?, ?, ?) on conflict(key) do update set model = excluded.model, vec = excluded.vec');
            todo.forEach((t, i) => put.run(textKey(t), model, vecToBlob(vecs[i])));
            log(`vectors: ${todo.length} text(s) embedded with ${model}`);
            return todo.length;
        } finally { busy.delete(key); }
    }
    function vectorsOfTexts(texts) {
        if (!texts.length || !ready()) return [];
        const keys = [...new Set(texts.map(textKey))];
        return db.prepare(`select key, vec from text_vectors where model = ? and key in (${keys.map(() => '?').join(',')})`).all(stage().model, ...keys)
            .map(x => ({ id: x.key, vec: blobToVec(x.vec) }));
    }
    // 一句话 → 向量（同一句只转一次）。
    const cache = new Map();
    async function query(text, { timeoutMs = 4000 } = {}) {
        const key = `${stage()?.model}\u0001${text}`;
        if (cache.has(key)) return cache.get(key);
        const p = embed([text], { timeoutMs }).then(v => v[0]);
        cache.set(key, p);
        if (cache.size > 200) cache.delete(cache.keys().next().value);
        p.catch(() => cache.delete(key));
        return p;
    }
    return { ready, ensure, vectorsOf, query, ensureTexts, vectorsOfTexts };
}
