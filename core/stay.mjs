// 事后截一刀（用户 10/2，横向生长）：前台模型闲下来就推剧情——玩家没动，它替她起身、出门、换了地方、跳了时间。
// 提示词管不住的，生成完让便宜模型看一眼：有没有在玩家没动的情况下挪了场面；有就截到那一句之前（程序按原文找句子边界），
// 可以补一句收住的。玩家自己说了要走的不截；角色一个人出门、玩家留在原地的也不截。默认关（config.stay.enabled），Q 上验过再开。
// 题材无关：判的是"场面挪没挪"，不认任何地名、人名。

export const STAY_SYSTEM = [
    "下面是一部长篇角色扮演里玩家刚说的一句，和某个角色接着写的一条回复。写回复的模型有个毛病：玩家没动，它替玩家把场面往前赶——替〔玩家〕起身、出门、上车、到了下一个地方，或者直接跳到几分钟、几小时之后。",
    "只判一件事：这条回复里，有没有在玩家没动、没说走的情况下，换了地点、跳了时间、或者替玩家做了起身出门的决定？玩家自己这句说了要走、要去哪的，不算；角色自己一个人出门、玩家留在原地的，也不算（〔当事人〕可以走，不能把〔玩家〕带走）；只是说\"等会儿走\"\"五分钟后下楼\"这类话，没真走，也不算；〔当事人〕讲的往事、回忆里换了地方的，是在讲，不是眼下挪了（Q 实测误截过一回），也不算；〔当事人〕自己在屋里走动、动手做事（倒水、脱靴子、修东西），玩家还在原处的，更不算。",
    '有的话，找到从哪一句起开始赶路：把那一句开头的原文（前 10～15 个字，一个字不改）抄出来，程序会从那里截掉。再写一句收住的话（可写可不写，不超过 40 字，这个角色的口吻，停在这一刻、把话递回给玩家；没有合适的就留空）。',
    '只输出一个 JSON：{"赶路": true 或 false, "从哪句起": "原文开头十几个字", "收一句": "……", "为什么": "一句"}',
].join('\n');

export function stayPrompt({ name, said, text }) {
    return `【玩家刚说的】\n${String(said ?? '').trim() || '（没说话）'}\n\n【${name}接着写的】\n${String(text ?? '')}`;
}

export function parseStay(raw) {
    const m = String(raw ?? '').match(/\{[\s\S]*\}/);
    let v = null;
    try { v = m ? JSON.parse(m[0]) : null; } catch { v = null; }
    if (!v || v['赶路'] !== true) return { move: false, why: String(v?.['为什么'] ?? '').slice(0, 120) };
    return { move: true, from: String(v['从哪句起'] ?? '').trim().slice(0, 40), close: String(v['收一句'] ?? '').trim().slice(0, 60), why: String(v['为什么'] ?? '').slice(0, 120) };
}

const squash = s => String(s ?? '').replace(/\s+/g, '').replace(/[“”"„‟＂]/g, '"').replace(/[‘’'＇]/g, "'");

// 从模型指的那一句起截掉。找不到原文、或者截完剩不下什么（不到四成）就不动——宁可放过，别把整条砍没。
// 截在那一句所在段落的开头前一个换行处之后：段中间截会留半句；那一句是段首就正好。
export function applyStay(text, judge) {
    const src = String(text ?? '');
    if (!judge?.move || !judge.from || judge.from.length < 4) return { text: src, cut: null };
    let i = src.indexOf(judge.from);
    if (i < 0) {
        // 空白、引号样式对不上：按压掉空白的位置折回原文
        const flat = squash(src), j = flat.indexOf(squash(judge.from));
        if (j < 0) return { text: src, cut: null };
        let k = 0, n = 0;
        while (k < src.length && n < j) { if (!/\s|[“”"„‟＂‘’'＇]/.test(src[k])) n++; k++; }
        i = k;
    }
    // 退到这一句的开头：上一个句号／换行之后
    const head = src.slice(0, i);
    const back = Math.max(head.lastIndexOf('\n'), head.lastIndexOf('。'), head.lastIndexOf('！'), head.lastIndexOf('？'), head.lastIndexOf('!'), head.lastIndexOf('?'));
    const at = back >= 0 ? back + 1 : i;
    if (at < src.length * 0.4 || at < 40) return { text: src, cut: null };
    const kept = src.slice(0, at).replace(/\s+$/, '');
    const cut = src.slice(at).trim();
    const close = judge.close && !kept.includes(judge.close) ? judge.close : '';
    return { text: close ? `${kept}\n${close}` : kept, cut, close };
}
