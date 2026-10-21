import { personWord, renderPronouns } from './pronoun.mjs';
// 离开期间身边的人做了什么（用户 9/27：离开九天回来，最亲的人反应还那么淡不对——他可能早就急了、动手做了事）。
// 用户离开够久（默认 24 小时起）回来时，调一次模型推：这些天里每个人以为出了什么事、做了什么、找了谁、那人因此知道了什么、
// 用户回来那一刻他在哪、什么状态，见面的第一反应往哪去。按各人和用户的关系、性格、经历、这一局的处境推；越亲近、越有理由担心的越坐不住。
// ⛔ 只写他们以为的、做了的，不替用户定下这些天到底在哪、出了什么事——那由用户回来时自己说，他们可以猜错。
// 结果挂在那一次"离开"上（离开挂在离开前那条消息上：删到那条之前、换分支，都跟着走）。角色那一格只给他自己那份，外加别人为他做的、找过他的。

import { repairQuotes } from './extract.mjs';

// 这段空白在身边的人那头是什么样，顺着最后那一幕推（用户 9/27：上一幕是睡着了、身边有人，就不能推成凭空消失、出走，可能是长睡未醒）。
// 心里怎么转，照真人在这种处境下会怎么想（用户 9/29：昏迷十一天，推演却写成"他不认为出了什么事""头两天觉得正常"——没人会这么想，
// 何况原因不明、刚分开过五年又重逢、知道她不稳定）。性子只决定怕怎么露出来，不决定怕不怕。两种常见的次序是用户给的，只当参考。
export const AWAY_MIND = [
    '推他们心里怎么转，照真人在这种处境下会怎么想，别往轻里写：原因不明、日子一天天过去，人会越来越往坏处想；越在乎、越有过失去的经历（失去过这个人一次、刚找回来、关系刚变近），怕得越厉害。性子只决定这份怕怎么露出来（嘴硬、发火、闷着、寸步不离……），不决定怕不怕。',
    '真人在这种时候会做的事也照实推：一遍遍确认、找信得过的医生或懂行的人来看、问原因、自己猜、想办法防着再出事。',
    '常见的次序可以参考，照他的性子可快可慢、可以跳：人在眼前昏着不醒的，醒来那一刻先确认没看错、没听错、还是那个人，长出一口气，然后顾身体、问感受、找人来看、追问原因，拿到说法以后想办法别再出事，憋了这么多天的后怕和火气过后才涌上来，接下来一阵时刻盯着，直到对方缓过来；人不见了又回来的，先是庆幸、确认安全，然后是火气、心里堵（觉得自己没被当回事），一阵紧张、信不过，直到得到保证、被真心安抚，半信半疑地一再确认，才慢慢平息。',
];

export const AWAY_SYSTEM = [
    '下面是一部长篇角色扮演。玩家的角色在最后那一幕之后，有一段日子没在剧情里出现——现实里没进这个窗口，按设定剧情里也过去了差不多那么久，这段日子没演。',
    '这段空白在身边的人那头是什么样子，顺着最后那一幕推，别和剧情割裂：那一幕里〔玩家〕在哪、在做什么、跟谁在一起、身子怎么样，决定了别人这些天看到的是什么。',
    '比如那一幕〔玩家〕躺着、睡着、身边有人，那多半是一直睡着或昏着没醒，身边的人一直看得见〔玩家〕；〔玩家〕一个人出了门、说了要去办事，那才是出去以后没回来、联系不上；别的情形照那一幕的样子推。',
    '人就在身边、却这么多天没跟谁说上话，最说得通的多半是一直没醒，别写成〔玩家〕醒着、照常吃喝却不理人——那是玩家没说过的事。',
    '能定下的只有一件：这些天〔玩家〕没在剧情里露面，也没跟谁说上话。为什么，由玩家回来时自己说。',
    '请先写清在身边的人眼里这段空白是什么样，再推一推各人以为出了什么事、做了什么。',
    '按各人和玩家的角色的关系、性格、做过的事、这一局已经发生的事来推：越亲近、越有理由担心（比如失去过这个人一次、知道这个人身上有秘密、有人在找这个人）的越坐不住，',
    '可能早就动手做了事——守着、找人、打听、查、求助、跟人翻脸，甚至去冒险；动作要从这一局已有的人和门路里长出来，合各人的本事和处境。关系淡的可能只是注意到了，或者根本没在意。',
    ...AWAY_MIND,
    '别人因此知道了什么，也写清（谁被问过、被托过，就知道这个人出了状况）。',
    '只推最要紧的几个人，至多五个，按和玩家的角色从近到远排：最近的那一两个写细（这些天心里怎么转的、一步步做了什么），远的一两句带过；"别人"里只放被他们找过、或者自己也动了的。写实在的事，不铺陈。',
    '最近的那一两个，再写几笔他心里：压着的到底是什么（用他自己的话，不贴"创伤""焦虑"这类标签）；什么会让他松下来一点，什么会让他又绷起来；接下来几天他这个人会怎么带着这件事（按他的性子，比如阴阳怪气、看得很紧、加倍粘人、一直绷着、格外珍惜眼前，可以混着，也可以是别的样子）；过了最紧的那几天，这股劲会怎么慢慢松下来（先松哪儿、还剩着什么）；这股劲大概拖多久。',
    '只写他们以为的、做了的；不替玩家定下这些天到底出了什么事——那由玩家回来时自己说，他们可以猜错。别写台词。',
    '"谁"照名册和关系里的名字原样写，别加注。',
    '',
    '只输出一个 JSON：{"空白": "在身边的人眼里这些天玩家的角色是什么样（顺着最后那一幕，只写看得见的）",',
    ' "各人": [{"谁": "...", "以为": "他以为出了什么事", "做了": ["按先后，一件一句"], "找了谁": [{"谁": "...", "怎么": "...", "那人因此知道了": "..."}],',
    ' "身边的人": "他知道的其他人这些天在哪、做了什么（只写他会知道的；不知道就空着）",',
    ' "现在": "玩家的角色重新露面（回来、醒来……照空白的样子）那一刻他在哪、什么状态、什么心情",',
    ' "见面": "那一刻他的第一反应往哪去（可能当场冲出来，也可能先愣着、确认，过后才涌上来；按他的性子；不写台词）", "没收尾的": ["他起了头、还没了的事"],',
    ' "压着的": "他心里压着的到底是什么", "松": "什么会让他松下来一点", "紧": "什么会让他又绷起来", "这几天": "接下来几天他会怎么带着这件事", "慢慢松": "过了最紧的那几天，怎么慢慢松下来", "拖多久": "当天｜两三天｜一周上下"}],',
    ' "别人": [{"谁": "...", "做了": "...", "知道了": "..."}]}',
].join('\n');

const str = (v, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const list = (v, n, max) => (Array.isArray(v) ? v : []).map(x => str(x, max)).filter(Boolean).slice(0, n);

// "拖多久"只认三档；后台按它决定余波给几个剧情日，不写给前台（给了数字，前台会数着演）。
export const LASTS = { 当天: 0, 两三天: 2, 一周上下: 6 };
function lasting(v) {
    const t = String(v ?? '');
    if (/周|七天|星期/.test(t)) return '一周上下';
    if (/[两三四五]天|几天/.test(t)) return '两三天';
    if (/当天|今天|一天/.test(t)) return '当天';
    return '';
}

export function parseAway(text) {
    const s = String(text ?? '').replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/, '');
    let raw;
    const body = s.slice(s.indexOf('{'), s.lastIndexOf('}') + 1);
    try { raw = JSON.parse(body); } catch { try { raw = JSON.parse(repairQuotes(body)); } catch { throw new Error('away_bad_json'); } }
    const people = (Array.isArray(raw['各人']) ? raw['各人'] : []).map(p => ({
        谁: str(p?.['谁'], 40), 以为: str(p?.['以为'], 400), 做了: list(p?.['做了'], 8, 200),
        找了谁: (Array.isArray(p?.['找了谁']) ? p['找了谁'] : []).map(x => ({ 谁: str(x?.['谁'], 40), 怎么: str(x?.['怎么'], 200), 知道了: str(x?.['那人因此知道了'], 200) })).filter(x => x.谁).slice(0, 6),
        身边的人: str(p?.['身边的人'], 300), 现在: str(p?.['现在'], 300), 见面: str(p?.['见面'], 200), 没收尾的: list(p?.['没收尾的'], 4, 200),
        压着的: str(p?.['压着的'], 400), 松: str(p?.['松'], 300), 紧: str(p?.['紧'], 300), 这几天: str(p?.['这几天'], 400), 慢慢松: str(p?.['慢慢松'], 300), 拖多久: lasting(p?.['拖多久']),
    })).filter(p => p.谁 && (p.以为 || p.做了.length || p.现在));
    const others = (Array.isArray(raw['别人']) ? raw['别人'] : []).map(p => ({ 谁: str(p?.['谁'], 40), 做了: str(p?.['做了'], 200), 知道了: str(p?.['知道了'], 200) })).filter(p => p.谁 && (p.做了 || p.知道了)).slice(0, 10);
    if (!people.length) throw new Error('away_empty');
    return { 空白: str(raw['空白'], 300), 各人: people, 别人: others };
}

// 模型有时给名字添个括号注（"某某（实体）"），名册里没这个写法、角色那一格就对不上：去掉末尾括号注后能和名册原样对上的，改用名册的写法。
// 名册里本来就带括号的（"某某（来访）"）是另一个人，原样留着。
export function pinNames(story, names) {
    const known = new Set(names.filter(Boolean));
    const fix = n => {
        if (!n || known.has(n)) return n;
        const base = n.replace(/\s*[（(][^）)]*[）)]\s*$/, '');
        return base !== n && known.has(base) ? base : n;
    };
    return { ...story, 各人: story.各人.map(p => ({ ...p, 谁: fix(p.谁), 找了谁: p.找了谁.map(x => ({ ...x, 谁: fix(x.谁) })) })), 别人: story.别人.map(p => ({ ...p, 谁: fix(p.谁) })) };
}

// 推演要的材料（给模型的）：离开多久、在场与名册、关系、这一局到现在、最后那一幕、还开着的想法、程序算的"谁找过用户"。
export function awayPrompt({ userName = '玩家', days, hours, present = [], cast = [], relations = [], digest = [], lastScene = [], open = [], attempts = [], setup = null }) {
    const out = [`【离开】${userName}在最后那一幕之后，现实里 ${Math.round(hours)} 小时（约 ${days} 天）没进这个窗口，剧情里也过去了差不多 ${days} 天。`];
    if (setup?.基调) out.push(`【这一局的基调】${setup.基调}`);
    if (setup?.原则?.length) out.push('【原则】', ...setup.原则.map(x => `· ${x.条}`));
    out.push('', `【最后那一幕在场的人】${present.join('、') || '不明'}`);
    if (cast.length) out.push(`【名册】（从近到远；档位、和${userName}的亲疏、钩子）`, ...cast.map(e => `· ${e.name}：${e.role}，${e.level}${e.hook ? `；钩子：${e.hook}` : ''}`));
    if (relations.length) out.push('', '【人物与关系】', ...relations);
    if (digest.length) out.push('', '【这一局到现在】（账本里的要事，按剧情日）', ...digest);
    if (open.length) out.push('', '【还开着的想法和答应过的事】', ...open);
    if (lastScene.length) out.push('', '【最后那一幕】（原文，从早到晚）', ...lastScene);
    if (attempts.length) out.push('', `【程序按亲疏算的：这些天谁试着找过${userName}】`, ...attempts.map(a => `· ${a.person}（第 ${a.day} 天起）：${a.how}`));
    return out.join('\n');
}

// 玩家回来后交代了这段空白（"我就是睡了一觉""我被困在城外了"），按玩家说的把推演重推一遍（用户 9/29：
// 推演先猜成"她醒着、把自己关起来"，玩家回来说的是昏睡了十一天，之后几轮的余波却一直照着那份猜的给）。
// 玩家说了的算，没说的照原来推的留着；对不上的一环扣一环地改。输出和第一次一样的 JSON，写回同一份推演，余波跟着换（slot.buildSlot）。
export const AWAY_REVISE_SYSTEM = [
    '下面是一部长篇角色扮演。玩家的角色空了一段日子没在剧情里出现，后台先按最后那一幕推过一遍这段空白（【原来的推演】）。现在玩家回来了，【玩家回来后说的】是原话。',
    '这段空白到底是怎么回事，以玩家说的为准：玩家说了的算，没说的照原来推的留着。原来的推演里和玩家说的对不上的地方都改——空白是什么样、各人以为出了什么事、做了什么、找了谁、现在什么状态、心里压着什么、什么让他松什么让他紧、这几天怎么带着、怎么慢慢松——一环扣一环地改，别只改一句。',
    '回来之后已经演了的（【回来后已经演了的】），当成已经发生的事，推演里"见面""现在"写的和它不一样的，照演了的改。',
    ...AWAY_MIND,
    '人名照原来的写。',
    // 玩家说其实没空白（质量窗 10/3：试玩里玩家交代"只过了几分钟"，推演改了，日期却还跳了一天，"空了 1 天才露面"的余波也还在）
    '在 JSON 里另加一格"实际天数"：照玩家说的，剧情里这段空白实际过了几天（整数）。玩家说只过了几分钟、几个钟头，或者根本没离开、接着刚才那一刻，写 0，这时"各人"可以是空的；玩家没说清的，照原来的天数写。',
    '',
    ...AWAY_SYSTEM.split('\n').slice(AWAY_SYSTEM.split('\n').findIndex(l => l.startsWith('只输出一个 JSON'))),
].join('\n');

// 重推时模型给的"实际天数"（0＝其实没空白）；没给、给得不对就是 null（照原来的天数）
export function actualDaysOf(text) {
    const s = String(text ?? '');
    try {
        const raw = JSON.parse(s.slice(s.indexOf('{'), s.lastIndexOf('}') + 1));
        const n = Number(raw?.['实际天数']);
        return Number.isInteger(n) && n >= 0 && n <= 365 ? n : null;
    } catch { return null; }
}

export function revisePrompt(material, { story, said = [] }) {
    return [awayPrompt(material), '', '【原来的推演】', JSON.stringify(story, null, 1), '', '【回来后已经演了的】（原文，从早到晚）',
        ...said.map(m => `${m.name}：${String(m.text).replace(/<#[0-9.]+#>/g, '').slice(0, 1500)}`),
        '', '【玩家回来后说的】（原话）', ...said.filter(m => m.isUser).map(m => `· ${String(m.text).slice(0, 600)}`)].join('\n');
}

// 角色那一格：他自己这些天的那份；别人找过他、托过他的；这回由他先开口时怎么开。
export function awayLines(story, { name, userName = '对方', same = (a, b) => a === b, opening = false }) {
    if (!story) return [];
    const lines = [];
    const me = story.各人.find(p => same(p.谁, name));
    if (me) {
        // 分两块：此刻的他给满；这些天做过的、手上没收尾的标明"问起、说到再拿出来"——实测整段一起给，开场就一口气全倒出来。
        // 由他先开口时（用户还一句没说）这一块干脆不给，从他下一次开口起由余波递上：标了"问起再说"，前台照样在开场全倒了。
        lines.push(`这些天${name}是怎么过的（后台按${name}的性子和处境推的；${name}知道的就是这些，${userName}那边到底怎么了并不知道）：`);
        if (me.以为) lines.push(`· 以为：${me.以为}`);
        if (me.压着的) lines.push(`· 心里压着的：${me.压着的}`);
        if (me.现在) lines.push(`· ${userName}重新露面这一刻：${me.现在}`);
        if (me.见面) lines.push(`· 那一刻${name}的第一反应往这边去：${me.见面}（怎么说由你）`);
        if (me.松 || me.紧) lines.push(`· ${[me.松 && `让${personWord(name)}松下来一点的：${me.松}`, me.紧 && `让${personWord(name)}又绷起来的：${me.紧}`].filter(Boolean).join('；')}`);
        const did = [...me.做了.map(x => `· ${x}`), ...me.找了谁.map(x => `· 找过${x.谁}：${x.怎么}`),
            ...(me.没收尾的.length ? [`· 还没收尾的：${me.没收尾的.join('；')}`] : []), ...(me.身边的人 ? [`· ${personWord(name)}知道的其他人这些天：${me.身边的人}`] : [])];
        if (did.length && !opening) lines.push(`这些天${name}做过的（${userName}问起、或者正好说到再拿出来，不必这一轮说完）：`, ...did);
    }
    const toMe = toHim(story, name, same);
    if (toMe.length) lines.push(`这些天和${name}有关的：`, ...toMe.map(t => `· ${t}`));
    if (opening && lines.length) {
        // 空白只给先开口的那个（回来时先开口的是最近的在场角色，那一幕里他在）；远处的人未必看得见。
        if (story.空白) lines.push(`（这段空白在身边的人眼里：${story.空白}）`);
        lines.push(`（这一轮由你先开口：写${name}此刻在干什么、在想什么，和${userName}重新露面那一刻的第一反应；这些天${userName}到底怎么了，留给${userName}接着说，别替${userName}写来路。）`);
    }
    return lines;
}

function toHim(story, name, same) {
    return [
        ...story.各人.flatMap(p => p.找了谁.filter(x => same(x.谁, name)).map(x => `${p.谁}找过${name}：${x.怎么}${x.知道了 ? `（${name}因此知道了：${x.知道了}）` : ''}`)),
        ...story.别人.filter(p => same(p.谁, name)).map(p => `${name}这些天：${p.做了}${p.知道了 ? `（知道了：${p.知道了}）` : ''}`),
    ];
}

// 余波（mood.mjs）：这份推演只在他回来后第一次开口时整段给；之后按"留多久"（keep）接着给——
// 做过的、没收尾的只再给一回（next）；以为的、露面前的样子、知道的别人近况给到这场戏过去（scene）；
// 心里压着的、什么让他松什么让他紧、这几天怎么带着它，给到"拖多久"那么多个剧情日（数字只给后台，前台看不到）。
export function awayCarry(story, { name, userName = '对方', same = (a, b) => a === b, id = 0, days = null }) {
    if (!story) return [];
    const me = story.各人.find(p => same(p.谁, name));
    const cut = (s, n) => (s.length > n ? `${s.slice(0, n)}……` : s);
    const about = days ? `${userName}空了 ${days} 天那回` : `${userName}空了一阵那回`;
    const long = LASTS[me?.拖多久] ?? 0;
    const out = [];
    const add = (k, keep, text) => out.push({ key: `away:${id}:${k}`, keep, about, text });
    if (me?.以为) add('以为', 'scene', `这些天${name}以为：${me.以为}`);
    if (me?.压着的) add('压着的', long, `${name}心里压着的：${me.压着的}`);
    if (me?.现在) add('现在', 'scene', `${userName}重新露面前，${name}是这个样子：${me.现在}`);
    const did = [...(me?.做了 ?? []), ...(me?.找了谁 ?? []).map(x => `找过${x.谁}：${x.怎么}`)];
    if (did.length) add('做了', 'next', `这些天${name}做过的（${userName}问起、或者说到了再讲）：${cut(did.join('；'), 400)}`);
    if (me?.没收尾的.length) add('没收尾', 'next', `${name}起了头、还没收尾的：${me.没收尾的.join('；')}`);
    if (me?.身边的人) add('身边的人', 'scene', `${name}知道的其他人这些天：${me.身边的人}`);
    if (me?.松 || me?.紧) add('松紧', long, [me.松 && `让${name}松下来一点的：${me.松}`, me.紧 && `让${personWord(name)}又绷起来的：${me.紧}`].filter(Boolean).join('；'));
    // 前一半的日子给"这几天怎么带着"，后一半换成"怎么慢慢松"（用户 9/27：第三天还是满格，没往下落）。没写慢慢松的，这几天给满。
    const half = me?.慢慢松 ? Math.ceil(long / 2) : long;
    if (me?.这几天) add('这几天', half, `这几天${name}会怎么带着这件事：${me.这几天}`);
    if (me?.慢慢松 && long > half) out.push({ key: `away:${id}:慢慢松`, keep: long, from: half + 1, about, text: `这股劲在${name}身上慢慢松下来的样子：${me.慢慢松}` });
    const toMe = toHim(story, name, same);
    if (toMe.length) add(renderPronouns("找过〔当事人〕", { person: name }), 'scene', cut(toMe.join('；'), 400));
    return out;
}

// 规划简报里的一段：离开期间各人以为的、做了的（全给规划者）。
export function awayBrief(story, days) {
    if (!story) return [];
    return [`【离开期间】（玩家离开了约 ${days} 天，没演；下面是后台推的各人这些天，不是玩家定的）`,
        ...(story.空白 ? [`· 在身边的人眼里：${story.空白}`] : []),
        ...story.各人.map(p => `· ${p.谁}：以为${p.以为 || '（没写）'}；做了：${p.做了.join('；') || '（没写）'}${p.找了谁.length ? `；找了：${p.找了谁.map(x => `${x.谁}（${x.怎么}${x.知道了 ? `，${x.谁}因此知道了：${x.知道了}` : ''}）`).join('；')}` : ''}${p.没收尾的.length ? `；没收尾的：${p.没收尾的.join('；')}` : ''}`),
        ...story.别人.map(p => `· ${p.谁}：${p.做了}${p.知道了 ? `（知道了：${p.知道了}）` : ''}`)];
}
