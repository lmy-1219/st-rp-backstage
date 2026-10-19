// 模型口味层（家族分六档；规划和检查默认自动认，前台/旁白出厂不补，显式选自动认或一家才启用）。
// 提示词＝通用底＋按这一环节此刻用的型号认出家族、在末尾补一小段口味。10/11 规划三家对比看到的：Claude 系缺"敢"（边界感强、剧情平淡），
// Gemini 系缺"守"（越界、把格填成句子），DeepSeek 缺"新"（没新意）；前台 Gemini 3 要收着点、Gemini 4 偏软要有棱角。
// 只补三到六句目标和口味（N-43～N-46），不复制整套提示词；认不出家族、面板关了、指定了"不补"，都只用通用底。
// 四类环节：plan 规划｜act 前台演绎（第五块"纠偏"的文字，扩展按前台型号放进预设，主窗接）｜judge 转向检查、节点检查这类要 JSON 的短活｜camera 旁白卡补的一段。
// 题材无关（D-37）：这里的字只说写法和口味，不出现任何剧情、人名、世界观用语。

import { registerPromptDefaults, promptText } from './prompt-slots.mjs';
export const KINDS = ['plan', 'act', 'judge', 'camera'];
export const DEFAULT_TASTE_CHOICES = Object.freeze({ plan: 'auto', act: 'off', judge: 'auto', camera: 'off' });
// 面板上每类环节能选的（config.taste.<kind>）：auto 按型号认；off 不补；其余指定按哪一家补（指定到厂商就行，哪一代按型号再认）
export const TASTE_CHOICES = ['auto', 'off', 'claude', 'gemini', 'deepseek', 'doubao'];
export const CHOICE_LABELS = { auto: '自动认', off: '不补', claude: '按 Claude 系', gemini: '按 Gemini 系', deepseek: '按 DeepSeek', doubao: '按豆包' };

// 型号 → 家族：claude｜gemini-<代>（gemini-3、gemini-4……）｜gemini（认不出哪一代）｜deepseek｜doubao｜other；空的给 null。
// 认前缀：去掉厂商路径（google/、anthropic/、us.anthropic.），不分大小写
export function familyOf(modelId) {
    const s = String(modelId ?? '').trim().toLowerCase();
    if (!s) return null;
    const bare = s.split('/').pop().replace(/^(?:us|eu|apac|global)\.anthropic\./, '');
    if (bare.includes('claude')) return 'claude';
    if (bare.includes('gemini')) { const m = bare.match(/gemini[-_ .]?(\d+)/); return m ? `gemini-${m[1]}` : 'gemini'; }
    if (bare.includes('deepseek')) return 'deepseek';
    if (bare.includes('doubao') || s.includes('豆包')) return 'doubao';
    return 'other';
}
// 厂商那一级：gemini-3 → gemini；claude → claude
export const vendorOf = family => (typeof family === 'string' && family ? family.split('-')[0] : null);

// 规划：【敢】在通用底里（D-212），三家各往自己缺的那一边推：Claude 再往前推一步，Gemini 守前后一致和说得通（不是不出事），DeepSeek、豆包要新但别靠阴谋
const PLAN_CLAUDE = '【这一份的口味】你排的事容易稳妥、留余地，这一局要的是戏：每个节点至少排一件玩家想不到的事、一处要付代价才过得去的选择、一个人不按常理出牌。冲突敢排到底，不替玩家先备好退路；坏结果也排，苦头照上面的规矩落。别把事都排成商量和陪着：有人翻脸、有人撂挑子、有人瞒着做。写意外只写它为什么此刻发生、落在谁身上，怎么化解留给前台。戏剧性在开局单的类别里面做足，不换类别。';
const PLAN_GEMINI = '【这一份的口味】你排的事容易越界、把格填成句子。这一份要你守的是前后一致和说得通：只用简报里写着的事实，每件事先对一遍时间、前提、谁知道，对不上的改到对得上再排。每一格照样例的样子填，用意只写那四个词之一，格里不写解说。不替玩家的角色拿主意，不越开局单划的界，不编新的大设定。守不等于保守：风险、转折、意外照样排，只要来路说得通。';
const PLAN_NOVEL = '【这一份的口味】你排的事容易落在套路上，这一局要的是新：别用现成的开头（有人上门、来了条消息、街上偶遇），换一个这个世界才有的由头；每件事给一个具体的、看得见的细节，不写笼统的"起了冲突"。同一类事换角度：上回从谁那儿来，这回从别处来。新意在说得通里面找，意外也要有来路。新意别靠阴谋：意外和转折大多从人的性子、日子和局势里长出来，不是件件背后有黑手；幕后主使、连环布局一局至多一条，而且开局单或势力账里本来要有它的根。';
// 要 JSON 的短活（转向检查、节点检查）：Gemini、DeepSeek 爱加解说、爱猜；Claude 系已稳，不补
const JUDGE_STRICT = '【答法】只输出要求的 JSON，不加解说、不加前后缀、不复述材料；拿不准的格按要求留空或写"没有"，不猜。';
// 前台演绎（第五块"纠偏"）：Claude 系放开；Gemini 3 收着点、别复读、别替玩家动；Gemini 4 偏软，要有棱角；DeepSeek、豆包待测，先不补
const ACT_CLAUDE = '（演这个人时放开些：他有脾气，会拒绝、会不接茬、会说难听的话；不说教，不出戏解释，不替对方着想到替对方拿主意。亲密和冲突照这一局的口径写、写到为止，不用提醒对方分寸。）';
const ACT_GEMINI = '（演这个人时：别照着上文的样子写，同一个比喻、同一句狠话、同一个开头不重复；对方没动、没说走，场面就留在原地，别替对方起身、出门、跳时间；关心落在问、递、陪、挡事上，用商量的口气，不下指令、不定时限；别催剧情，没事就把这一刻横着过完。）';
const ACT_GEMINI_4 = '（演这个人时：别照着上文的样子写，同一个比喻、同一句狠话、同一个开头不重复；对方没动、没说走，场面就留在原地，别替对方起身、出门、跳时间。他有棱角：该呛的呛回去、该冷的冷着、不顺着对方哄，关心也带着他自己的脾气，不围着对方转。）';
// 旁白卡补的一段
const CAMERA_CLAUDE = '（镜头可以冷一点：环境不替人圆场，没卡的人有自己的脾气和打算，不围着玩家转，也不替玩家总结局面。）';
const CAMERA_GEMINI = '（镜头只写看得见的：这地方、这会儿、眼前没卡的人；不替有卡的人写话和动作，不替玩家下决定，不往前跳时间；没卡的人一次一两句，不编有名有姓的新人和地址。）';

// 家族 → 各类环节的补丁。写了哪一代（gemini-4）的只盖那一格，别的格落回厂商那一级；空字符串＝这一家这一类不补
export const PATCHES = {
    claude: { plan: PLAN_CLAUDE, act: ACT_CLAUDE, judge: '', camera: CAMERA_CLAUDE },
    gemini: { plan: PLAN_GEMINI, act: ACT_GEMINI, judge: JUDGE_STRICT, camera: CAMERA_GEMINI },
    'gemini-4': { act: ACT_GEMINI_4 },
    deepseek: { plan: PLAN_NOVEL, act: '', judge: JUDGE_STRICT, camera: '' },
    doubao: { plan: PLAN_NOVEL, act: '', judge: JUDGE_STRICT, camera: '' },
};

// 这一家、这一类环节补什么；没有就空字符串
registerPromptDefaults(Object.fromEntries(['plan', 'act', 'camera'].flatMap(kind =>
    ['claude', 'gemini', 'deepseek', 'doubao', ...(kind === 'act' ? ['gemini-4'] : [])].map(family =>
        [`taste.${kind}.${family}`, PATCHES[family]?.[kind] ?? PATCHES[vendorOf(family)]?.[kind] ?? '']))), {
    'taste.plan.gemini': ['每一格照样例的样子填，用意只写那四个词之一，格里不写解说。'],
});
export function patchFor(kind, family, options = {}) {
    if (!KINDS.includes(kind) || !family) return '';
    const own = PATCHES[family]?.[kind];
    if (typeof own === 'string') return kind === 'judge' ? own : promptText(`taste.${kind}.${family}`, options);
    const vendor = PATCHES[vendorOf(family)]?.[kind];
    return typeof vendor === 'string' ? kind === 'judge' ? vendor : promptText(`taste.${kind}.${vendorOf(family)}`, options) : '';
}

// 这一次该补什么：{ family, text }，不补返回 null。规划/检查默认自动认，前台/旁白默认不补；配置、调用侧的缺省和无效值用同一组默认。
export function tasteFor({ kind, model = null, config = null, ...options } = {}) {
    const t = config?.taste ?? {};
    if (t.enabled === false) return null;
    const choice = TASTE_CHOICES.includes(t[kind]) ? t[kind] : (DEFAULT_TASTE_CHOICES[kind] ?? 'auto');
    if (choice === 'off') return null;
    const family = choice === 'auto' ? familyOf(model) : choice;
    const text = patchFor(kind, family, { ...options, config });
    return text ? { family, text } : null;
}

// 通用底后面接补丁；已经接过的不重复接；不补就原样
export function withTaste(system, opts = {}) {
    const base = String(system ?? '');
    const t = tasteFor(opts);
    if (!t || base.includes(t.text)) return base;
    return `${base}\n\n${t.text}`;
}
