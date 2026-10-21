// 早些的回复换成大意（N-231，根治照抄上文）：前台（Gemini）会照着上文的样子写——同样的节奏、同样的开头收尾、同样的狠话。
// 去复读只能换掉已经写出来的；上文里攒着的几十条原文还在一轮轮教它。发给前台时，最近几条角色回复照原文留着（扩展里设），
// 更早的换成记账记下的那几件事：事还在，原来的句子和节奏不在了，前台照抄不到。
// 记过账、没有要记的事的（寒暄、动作、斗嘴），换成一句"略"；还没记账的照原文（多半是最近的）。纯程序，不调模型。
const SKIP = new Set(['了结']);   // 了结只是关上一件事，大意里不用单写
const MAX_ITEMS = 4, MAX_CHARS = 220;

export function digestText(recs) {
    const items = recs.filter(r => !SKIP.has(r.type)).sort((a, b) => a.id - b.id).map(r => String(r.text ?? '').trim()).filter(Boolean);
    if (!items.length) return '（这一条的大意：只是动作和闲话，没有要记的事。原文略。）';
    let out = '';
    for (const t of items.slice(0, MAX_ITEMS)) {
        if (out && out.length + t.length > MAX_CHARS) break;
        out += (out ? '；' : '') + t;
    }
    return `（这一条的大意，原文略：${out}。）`.replace(/。。）$/, '。）');
}

// fps → { fp: 大意 }，只给记过账的。
export function digests(records, { storyId, chatKey, fps }) {
    const wanted = new Set(fps);
    const byFp = new Map();
    for (const r of records.visible(chatKey)) if (wanted.has(r.fp)) (byFp.get(r.fp) ?? byFp.set(r.fp, []).get(r.fp)).push(r);
    const out = {};
    for (const fp of wanted) if (records.isDone(storyId, fp)) out[fp] = digestText(byFp.get(fp) ?? []);
    return out;
}
