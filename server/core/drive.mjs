// 只归并有出处的材料，不把字面重合解释成因果。links 只装来源读口的明确编号。
const list = x => Array.isArray(x) ? x : x ? [x] : [];
const short = x => String(x ?? '').replace(/\s+/g, ' ').trim().slice(0, 480);

export function readDrive(material = [], { focus = null, lines = [], names = [] } = {}) {
    const rows = material.filter(r => r?.ref && r.text && r.active !== false);
    const groups = [];
    for (const r of rows) {
        const keys = new Set([r.ref, ...list(r.links)]);
        // 私密材料只在同一个人的材料里归并，绝不借另一来源扩散知情范围。
        const who = list(r.who).filter(Boolean);
        const hits = groups.filter(g => JSON.stringify(g.who) === JSON.stringify(who) && [...keys].some(k => g.keys.has(k)));
        const g = { rows: [r], keys, who };
        for (const hit of hits) { g.rows.push(...hit.rows); for (const k of hit.keys) keys.add(k); groups.splice(groups.indexOf(hit), 1); }
        groups.push(g);
    }
    return groups.map(g => {
        const associated = lines.filter(l => g.rows.some(r => r.line === l.name) || list(l.refs).some(ref => g.keys.has(ref)));
        const line = associated.find(l => l.name === focus)?.name ?? associated[0]?.name ?? null;
        const linked = !!line || g.who.some(w => names.includes(w));
        const row = [...g.rows].sort((a, b) => (b.pos ?? -1) - (a.pos ?? -1))[0];
        const background = g.rows.every(r => r.kind === '底色') || !linked;
        return { from: row.from, ref: row.ref, who: g.who, line: background ? null : line,
            kind: background ? '底色' : g.rows.some(r => r.kind === '候选') ? '候选' : '事实',
            text: short([...new Set(g.rows.map(r => r.text))].join('；')), pos: Math.max(...g.rows.map(r => r.pos ?? -1)) };
    }).sort((a, b) => {
        const rank = r => r.kind === '底色' ? 3 : r.line === focus && focus ? 0 : r.line ? 1 : 2;
        return rank(a) - rank(b) || b.pos - a.pos;
    }).slice(0, 4).map(({ pos, ...row }) => row);
}

// who 给定时只取本人一侧；公共块不带任何限定知情人的内容。
export function driveLines(rows = [], { focus = null, goal = '', who = null, all = false } = {}) {
    const picked = rows.filter(r => all || (who ? r.who.includes(who) : !r.who.length));
    if (!picked.length && !focus && !goal) return [];
    return ['【世界里的劲】', ...(focus || goal ? [`这一段：${focus ?? '焦点未明'}；目标：${goal || '未写'}`] : []),
        ...picked.map(r => `· ${r.from}／${r.kind}〔${r.ref}〕${r.line ? `（${r.line}）` : ''}${r.who.length ? `【仅供${r.who.join('、')}各自知情的一侧】` : ''}：${r.text}`)];
}
