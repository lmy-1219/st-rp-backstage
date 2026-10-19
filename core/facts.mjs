// 常识（用户 10/1）：素材包里一条条的世界常识（素材包/*/常识.json）。前台只在眼下的话对上时拿到那一两条；规划全看。
// 前台模型自己知道的不用记（用户：先拿去问系统里的模型，一致的就不记）——这里只放它不知道、或者和这一局说法不一样的。
// 每条：name（几个字）、keys（说到其中一个才算沾边）、with（可选：还得同时说到其中一个，免得常挂在嘴边的地名每轮都触发）、text、front（false＝只给规划）。
// 题材无关：内容都在素材包里。
import fs from 'node:fs';

export function loadFacts(file) {
    if (!file) return [];
    let raw;
    try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return []; }
    const words = v => (Array.isArray(v) ? v.filter(k => typeof k === 'string' && k.length >= 2) : []);
    return (Array.isArray(raw?.facts) ? raw.facts : []).filter(f => f && typeof f.name === 'string' && typeof f.text === 'string' && f.text.trim())
        // with 里一个字的也认（逃、撤）：它只在 keys 已经对上时才看
        .map(f => ({ name: f.name, keys: words(f.keys), with: (Array.isArray(f.with) ? f.with : []).filter(k => typeof k === 'string' && k.length), text: f.text.trim(), front: f.front !== false }));
}

// 和眼下的话沾边的（至多 max 条）：keys 里有一个出现，写了 with 的还得 with 里也有一个出现。
export function matchFacts(facts, text, { max = 2 } = {}) {
    const t = String(text ?? '');
    return (facts ?? []).filter(f => f.front && f.keys.some(k => t.includes(k)) && (!f.with.length || f.with.some(k => t.includes(k)))).slice(0, max);
}

export const factLines = facts => (facts.length ? ['这个世界的常识（和眼下有关的；用得上就用，别照念）：', ...facts.map(f => `· ${f.name}：${f.text}`)] : []);
export const planFactLines = facts => (facts?.length ? ['【这个世界的常识】（前台只在说到时拿到其中一两条）', ...facts.map(f => `· ${f.name}：${f.text}`)] : []);
