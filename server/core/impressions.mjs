import { personWord } from './pronoun.mjs';
// 旁人眼里两人是什么样（用户 10/9："这个关系只当做当事人视角的观察，影响该角色判断"）：
// 他只从自己当场看见过的两人互动里得出一个印象——常一起出现、举止亲近、一方很护着另一方、当面拌过嘴、互相打趣——不给任何具体的事。
// 只看他在场、两人也都在场的那几条（记录的主人是其中一个、另一个也在场、说的是对方）；心里话不算。见过不到两回的不给。
// 写明这是他看到的样子，不一定是两人实际的关系：影响他怎么看、怎么待他们，不用说出来，也别替两人下结论。
// 题材无关：只认动作和口气的一般说法。
const SIGNS = [
    ['举止亲近', /抱|搂|牵着|牵住|吻|亲了|依偎|靠在[^，。]{0,6}(?:肩|怀)|揽|贴着|(?:握住|攥住|拉住|牵起)[^，。]{0,14}(?:手|手腕)|十指/],
    ['一方很护着另一方', /护着|挡在|扶着|扶住|喂|守着|照顾|叮嘱|担心|不放心|替[^，。]{0,4}(?:挡|付|扛|撑)|盯着[^，。]{0,4}(?:吃|药|休息)|让[^，。]{0,8}(?:先)?(?:检查|看看|躺下|躺好|休息|吃)|不让[^，。]{0,6}(?:走|去|出门|下地)/],
    ['当面拌过嘴', /吵|骂|质问|顶嘴|赌气|冷脸|甩开|摔门|翻脸|呛|发火|不耐烦|吼/],
    ['互相打趣', /玩笑|打趣|逗|调侃|斗嘴|损了?[^，。]{0,2}一句/],
];

// visible：开口的人看得见的记录；viewer：开口的人；people：此刻眼前（或正说到）的人，不含他自己；aliases(n)：n 的几个叫法
export function pairImpressions(visible, { viewer, people = [], same = (a, b) => a === b, aliases = n => [n], max = 3 } = {}) {
    const here = [...new Set(people.filter(p => p && !same(p, viewer)))];
    const out = [];
    for (let i = 0; i < here.length; i++) for (let j = i + 1; j < here.length; j++) {
        const [a, b] = [here[i], here[j]];
        const inAud = (r, n) => same(r.holder_name, n) || (r.audience ?? []).some(x => same(x, n));
        const says = (r, other) => same(r.about, other) || aliases(other).some(n => n && String(r.text ?? '').includes(n));
        const seen = visible.filter(r => r.job_id != null && r.type !== '心里' && r.type !== '余波' && inAud(r, viewer) && inAud(r, a) && inAud(r, b)
            && ((same(r.holder_name, a) && says(r, b)) || (same(r.holder_name, b) && says(r, a))));
        if (seen.length < 2) continue;
        const bits = [seen.length >= 4 ? '常一起出现' : '见过两人一起', ...SIGNS.filter(([, re]) => seen.some(r => re.test(r.text))).map(([w]) => w)];
        out.push({ a, b, n: seen.length, line: `· ${a}和${b}：${bits.join('；')}` });
    }
    const top = out.sort((x, y) => y.n - x.n).slice(0, max);
    return top.length ? [`${viewer}自己看到的、这几个人之间的样子（只是${personWord(viewer)}亲眼看到的印象，不一定是两人实际的关系；影响${personWord(viewer)}怎么看、怎么待他们，不用说出来，也别替两人下结论）：`, ...top.map(x => x.line)] : [];
}
