// ST 自己的世界书按开口的角色筛（白皮书 §5.4、N-252）：后台递的东西早就按"谁知道"筛过了，ST 的世界书条目还是谁开口都整条给。
// 每条条目判一次"这一局里谁会知道"：常识、公开的设定、地图、价格、势力的公开面＝所有人；某人的私事、只有亲历者知道的经过、
// 组织内部的事＝只写知道的人（从名册里挑）；拿不准就算所有人（宁可多给，不错筛）。按条目内容存着，内容改了才重判。
// 扩展在 ST 加载条目时，把开口的人不在名单里的拿掉（只拿掉，不加；ST 自己的角色过滤照旧先生效）。玩家在面板上改的算数，盖过判的。
// 题材无关：判断的规矩是通用的，人名来自名册。

export const LORE_SYSTEM = [
    '下面是一部长篇角色扮演用的世界书条目（编号、标题、内容），和这一局的名册。替每一条判断：在这一局里，谁会知道条目里写的事？',
    '- 常识、公开的设定、地图、地点、价格、物品、势力和组织的公开面、街头流传的事：写"所有人"。',
    '- 某个人的私事、秘密、只有亲历者才知道的经过、某个组织内部的机密、只在某几个人之间说过的话：只列知道的人（用名册里的名字；名册里没有的人不写）。',
    '- 条目讲的就是某个人自己（他的经历、性格、习惯）：他自己知道；别人知道多少按条目里写的公开程度定，一般人只知道公开的那面——这种条目分不开公开和私密的，写他自己和条目里明说知道的人。',
    '- 【认知边界】是开局单写明的：哪件事只有哪几个人知道。条目里写到其中哪一件（哪怕只顺带一句），名单外的人就不列——条目讲的是他自己、他的往事也一样（宁可他少看一条，也别让他读到不该知道的）。这一条压过下面的"拿不准"。',
    '- 写某人心里怎么看另一个人（定位、感情、打算、怎么待他）：只列这个人自己和条目里明说知道的人，被看的那个人不列。',
    '- 拿不准就写"所有人"。宁可多给，不要错筛。',
    '只输出一个 JSON：{"1": {"谁知道": "所有人"}, "2": {"谁知道": ["名字", "名字"], "为什么": "一句"}, …}，每条都要有。',
].join('\n');

// 规矩改了就加一：模型判过的重判一遍（玩家在面板上定的不动）。2：判的时候看认知边界（试玩 10/13：一个只知道旧事的人拿到了写着另一件只有两三个人知道的事的条目）
export const LORE_VERSION = 2;

// bounds：开局单"口径"里写明谁知道的那几件 [{事, 谁知道}]
export function lorePrompt({ entries, roster = [], userName = null, bounds = [] }) {
    const who = s => String(s ?? '').replace(/\{\{user\}\}/g, userName ?? '玩家');
    return [
        `【名册】${roster.map(e => `${e.name}（${e.role ?? ''}）`).join('、') || '（空）'}${userName ? `；玩家的角色：${userName}` : ''}`,
        ...(bounds.length ? ['', '【认知边界】（开局单写明的：这件事只有这几个人知道）', ...bounds.map(b => `· ${who(b.事).slice(0, 120)}（只有：${b.谁知道.map(who).join('、')}）`)] : []),
        '', '【条目】',
        ...entries.map((e, i) => `${i + 1}. 〔${e.title || '无标题'}〕${String(e.text ?? '').replace(/\s+/g, ' ').slice(0, 600)}`),
    ].join('\n');
}

// 判不了的别一轮轮重问（10/16）：tries＝{ key: { hash, n } }，一批没答上各记一次；记过的单独问（把拒答的那一条隔开）；
// 单独问也没答上（n ≥ 2）就放弃——当所有人都知道，记成模型判的（改了规矩重判时会再试）。条目改了（hash 变）从头算
export const GIVE_UP_VERDICT = Object.freeze({ all: true, who: [], why: '判不了：模型几次没答上，先当所有人都知道' });
export function loreBatch(unjudged, tries = {}, { batch = 25, maxTries = 2 } = {}) {
    const n = r => (tries[r.key]?.hash === r.hash ? tries[r.key].n ?? 0 : 0);
    const giveUp = unjudged.filter(r => n(r) >= maxTries);
    const rest = unjudged.filter(r => n(r) < maxTries);
    const retry = rest.filter(r => n(r) >= 1);
    return { todo: retry.length ? [retry[0]] : rest.slice(0, batch), giveUp };
}
export function loreTried(tries = {}, todo = []) {
    const out = { ...tries };
    for (const r of todo) out[r.key] = { hash: r.hash, n: (out[r.key]?.hash === r.hash ? out[r.key].n ?? 0 : 0) + 1 };
    return out;
}

export function parseLore(text, count) {
    const m = String(text ?? '').match(/\{[\s\S]*\}/);
    if (!m) throw new Error('lore_bad_json');
    let raw;
    try { raw = JSON.parse(m[0]); } catch { throw new Error('lore_bad_json'); }
    return Array.from({ length: count }, (_, i) => {
        const x = raw[String(i + 1)];
        const who = x?.['谁知道'];
        if (!x || who === '所有人' || !Array.isArray(who)) return { all: true, who: [], why: '' };
        const names = who.map(n => String(n).trim()).filter(n => n && n !== '所有人');
        return names.length ? { all: false, who: names, why: String(x['为什么'] ?? '').slice(0, 200) } : { all: true, who: [], why: '' };
    });
}

// 名字对得上（扩展里也用同一套：一样，或者一个是另一个"·（"前面那截）。
const norm = s => String(s ?? '').replace(/\s+/g, '').toLowerCase();
const head = s => norm(s).split(/[·（(]/)[0];
export const sameLoreName = (a, b) => !!a && !!b && (norm(a) === norm(b) || head(a) === norm(b) || norm(a) === head(b) || (head(a) && head(a) === head(b)));

// 这个人看不看得到这一条：判成所有人、或名单里有他。
export const loreVisible = (verdict, name) => !verdict || verdict.all || (verdict.who ?? []).some(n => sameLoreName(n, name));
