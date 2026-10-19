// 此刻的样子（用户 9/30）：穿着、天气这类不算重要、但属于"当前状态"的事实——聊天里写到过就给，没写就不给，换了就更新。
// 每来几条新消息，便宜模型读一遍，只记正文里明确写到、看得见的；每一笔挂在写到它的那条消息上（改稿、删消息、左滑跟着退）。
// 给前台时只给在场的人；过了一天：天气记成"前一天"（下过雨，地上可能还湿），别的标"前一天写到的"，再往后就不给了。
// 时段（章程 I1）：正文写到了几点、什么时段、过了一夜、第二天，顺带报一条（此地｜时段｜第二天·早上），剧情日期按它走（timeline.noteMarks）；
// 不另加调用，词表是这一局的时段表（timescale.scaleOf(开局单).parts）。
// 题材无关：方面是通用的，人名、地名都来自聊天。
import { scaleOf } from './timescale.mjs';
import { bodyTalk } from './body.mjs';
import { personWord } from './pronoun.mjs';

export const ASPECTS = ['穿着', '位置', '带着', '身体', '天气', '周围', '地方', '时段'];
const SCENE_ASPECTS = new Set(['天气', '周围', '地方', '时段']);   // 场面上的：谁写"此地"
export const HERE = '此地';
const GONE = /^(没了|没有了|已经没了|无)$/;

export const STATE_SYSTEM = [
    '下面是一部长篇角色扮演里刚写下的几条消息（带编号），和到目前为止记下的"此刻的样子"。你只做一件事：记下正文里明确写到的、看得见的当前状态有没有变。',
    '按这几个方面记：',
    '- 穿着：衣服、鞋、妆发、戴着的东西；',
    '- 位置：在哪、什么姿势（坐在哪、靠着什么、站在门口）；',
    '- 带着：手上、身上带着的东西，他的车停在哪（写明哪辆、停在哪一处；车被别人开走了就不再写在他身上）；人起身走开、离开那个地方时，手里拿着的、属于那儿的东西（餐具、杯子、顺手拿起的小东西）写"没了"，除非正文写了带走；',
    '- 身体：伤、病、醉、累、冷、湿、饿这类会持续一阵的身体状况；一下就过去的不记（烫了一下、呛了一口、打了个喷嚏、脸红、心跳快）；',
    '- 天气：天气和冷热（场面上的，"谁"写"此地"）；',
    '- 周围：门窗、灯、开着的电视和音乐、屋里的样子（场面上的，"谁"写"此地"）。',
    '- 时段：此刻是一格时间里的哪一段（场面上的，"谁"写"此地"）。正文里写到了几点、什么时段、天亮了、过了一夜、第二天、过了几天，就报一条；"现在"只填【这一局的时段】里的一个词；跨进了新的一格，前面写上第几格，像"第二天·早上""过了两天·上午""第三天·下午"（按【这一局的时段】里说的单位写）；还在同一格里往后走的只写时段词。拿不准、没写到就不报；没有【这一局的时段】就不报这一项。',
    '- 地方：这一场在哪处，几个字，带主人或招牌（场面上的，"谁"写"此地"）。镜头跟着玩家：玩家出了门、离开了那处、上车下车、往别处去，"此地"就跟着改成玩家眼下所在或正去的那处（"往某街去的路上"）；人不在玩家身边、隔着电话消息说的他那头，不算"此地"。',
    '规矩：没写到的别猜，别从性格、习惯推；和已经记下的一样的不用再写；变了的写新的一句（整句替换，写到看得见的样子为止，不写心理）；没了的（脱掉了、放下了、雨停了）写"没了"。',
    '"谁"写人名，照【在场的人】里的写法（玩家的角色也照那里的名字）。"条"写是哪一条写到的。',
    '每一笔加"原句"：从那一条里逐字摘一小段（不超过 30 字），是正文里写到这个样子的原话。问句、猜测、打算、假设、回忆里的不算（"你的车呢？"不能记成车停在哪；"等会儿换身衣服"不能记成换了衣服）；摘不出原句的就不记。',
    '只输出一个 JSON：{"变化": [{"条": 编号, "谁": "…", "方面": "穿着|位置|带着|身体|天气|周围|地方|时段", "现在": "…", "原句": "…"}]}；什么都没变就 {"变化": []}。',
].join('\n');

// timeScale：这一局的尺度（scaleOf 认得的都行）；时段表空的（按小时走）就不给【这一局的时段】。
// 记下的时段只给时段词，不带"第二天"（免得模型照抄，同一天又算一次跨天）。
const partOnly = t => String(t ?? '').split(/[·・]/).at(-1).trim();
export function statePrompt({ board = [], messages = [], people = [], userName = null, timeScale = null }) {
    const ts = scaleOf(timeScale);
    return [
        `【在场的人】${people.join('、') || '不明'}${userName ? `（${userName}是玩家的角色）` : ''}`,
        ...(ts.parts.length ? [`【这一局的时段】一${ts.word}分这几段：${ts.parts.join('、')}（先后照这个次序）；跨进新的一${ts.word}写"第二${ts.ord}·${ts.parts[0]}""过了两${ts.word}·${ts.parts[1] ?? ts.parts[0]}"这样。`] : []),
        '',
        '【记下的此刻的样子】',
        ...(board.length ? board.map(n => `· ${n.who}｜${n.aspect}｜${n.aspect === '时段' ? partOnly(n.text) : n.text}`) : ['（还没有）']),
        '',
        '【新来的消息】',
        ...messages.map(m => `〔${m.n}〕${m.name}：${m.text}`),
    ].join('\n');
}

export function parseState(text) {
    const s = String(text ?? '');
    const a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a < 0 || b <= a) return null;
    let v;
    try { v = JSON.parse(s.slice(a, b + 1)); } catch { return null; }
    const list = Array.isArray(v?.['变化']) ? v['变化'] : [];
    return list.map(x => ({ n: Number(x?.['条']), who: String(x?.['谁'] ?? '').trim(), aspect: String(x?.['方面'] ?? '').trim(), text: String(x?.['现在'] ?? '').trim().slice(0, 160), quote: String(x?.['原句'] ?? '').trim().slice(0, 60) }))
        .filter(x => Number.isFinite(x.n) && x.who && ASPECTS.includes(x.aspect) && x.text)
        .map(x => (SCENE_ASPECTS.has(x.aspect) ? { ...x, who: HERE } : x));
}

// 每一笔要在那一条正文里找得到原句，而且原句不在问句里（N-279，试玩 10/2：玩家问了句"你的保时捷呢"，就记成了"保时捷停在楼下"，
// 之后每一轮都当事实递给前台）。textOf(n)＝第 n 条的正文。比的时候去掉空白和格式标记。
const squash = t => String(t ?? '').replace(/<#[0-9.]+#>|\s+/g, '');
export function grounded(list, textOf) {
    return (list ?? []).filter(x => {
        const body = squash(textOf(x.n)), q = squash(x.quote);
        if (!q || !body) return false;
        const i = body.indexOf(q);
        if (i < 0) return false;
        const end = body.slice(i + q.length).search(/[。！!？?…\n]/);
        const stop = end < 0 ? '' : body[i + q.length + end];
        return !(stop === '？' || stop === '?' || /[？?]$/.test(q));
    });
}

// 玩家的角色身上的东西（穿着、带着、身体）只认玩家自己那几条写的（用户 10/13："我真的很疑惑哪里有写user脸很白气色不好"）：
// 别的角色在叙述里给她添的——后颈贴了块降温凝胶贴、脸色发灰——记成她此刻的样子，往后每一格都递，大家照着写，越写越病。
// 位置、场面上的照旧（别人写她坐下、出门，常是镜头跟着她走）。isUserAt(pos)：那一条是不是玩家发的；isHer(谁)：是不是玩家的角色
// 用户 10/14："角色状态（穿着）好像很久没更新了又好像是更新过但是回退了"——别人写的穿着、带着整条不收，她自己又没写换衣服，
// 她那一行就退回她头一天自己写的那身。穿着、带着别人写的照收，只按逗号切掉说伤病、贴的包的、脸色的那几截；身体上的只认她自己写的。
export const HER_OWN = new Set(['穿着', '带着', '身体']);
const MEDICAL = /(?:贴着|贴了|贴的|贴片)|纱布|绷带|膏药|凝胶|针眼|创可贴|夹板|胶布|护具|消炎|止痛|抑制剂|苍白|发白|泛灰|青灰|青白|脸色|气色|血色/;
const notHurt = seg => !MEDICAL.test(seg) && !bodyTalk(seg);
export const herOwnOnly = (list, { isUserAt = () => true, isHer = () => false, posOf = x => x.pos } = {}) => (list ?? []).flatMap(x => {
    if (!HER_OWN.has(x.aspect) || !isHer(x.who) || isUserAt(posOf(x))) return [x];
    if (x.aspect === '身体') return [];
    const text = String(x.text ?? '').split(/[，,；;]/).map(s => s.trim()).filter(s => s && notHurt(s)).join('，');
    return text ? [text === x.text ? x : { ...x, text }] : [];
});

// 手上拿着的（筷子、杯子、顺手拿起的东西）：这个人后来挪了地方、换了姿势，就当放下了——还拿着的话正文会再写到，再记。
// 拎着、背着、抱着、揣着的是跟着人走的，不算。身体上的：过了 BODY_SPAN 条消息没再写到就不给（长久的伤病正文和记账里还会提）。
// 试玩 10/4：拉面摊上记下"手里拿着筷子""舌尖被烫到"，没人写放下、没人写好了，上车、进诊所、躺上手术椅以后还一直递给前台，前台照着演。
const IN_HAND = /手里|手上|手中|指间|指尖|捏着|攥着|握着|拿着|端着|夹着|叼着/;
const CARRIED = /拎|提着|背着|抱着|揣/;
export const BODY_SPAN = 12;

// 按聊天里的次序叠出此刻的样子：同一个人、同一方面取最晚的一笔；"没了"就划掉。notes：[{ pos, who, aspect, text }]；lastPos：最新一条的位置
// 发消息、打电话来的人那一条里写的是他那头（试玩 10/7：他在路口雨棚底下打来电话，"此地＝雨棚下"，场面表就当镜头在雨棚下）：
// 他那几条里的"此地"不收，他自己的位置照收。remote：{ who, at }（进场那份记的，发消息、打电话来的才给）；nameAt(n)：第 n 条是谁说的
export function dropRemoteHere(list, { remote = null, nameAt = () => null, same = (a, b) => a === b } = {}) {
    if (!remote?.who) return list;
    return list.filter(x => !(x.who === '此地' && x.n >= (remote.at ?? Infinity) && same(nameAt(x.n), remote.who)));
}

// 一样东西停在哪（车、摩托）是这样东西的事，不是谁身上的：记在某人"带着"里的"某某停在……"，之后别人（或此地）写到了这样东西——
// 被别人开走了、停到了别处——那一截就不再算数（用户 10/8：她早把车开走了，他那份里一直写着"车停在楼底下"，他照着写开车去接她，
// 写出来又被记回去，一轮轮转下去）
const PARKED = /([^，,；;。：:\s（）()]{2,14}?)(?:就|正|还|一直)?(?:停在|停着|停靠在|泊在)/;
function movedAway(n, notes, same) {
    if (n.aspect !== '带着' && n.aspect !== '位置') return n;
    const parts = String(n.text).split(/(?<=[，,；;])/);
    // 只有写了"停在"的那几条才看后面的记录（10/16 提速：以前每条都去比全表，几百条就是几十万次认人）
    if (!parts.some(p => PARKED.test(p))) return n;
    const later = notes.filter(o => o.pos > n.pos && !same(o.who, n.who));
    const kept = parts.filter(p => {
        const m = PARKED.exec(p);
        if (!m) return true;
        const thing = m[1].replace(/^.*的/, '');
        const keys = [thing, thing.length >= 3 ? thing.slice(-2) : null].filter(k => k && k.length >= 2 && !/^车子?$/.test(k));
        return !keys.length || !later.some(o => keys.some(k => String(o.text).includes(k)));
    });
    if (kept.length === parts.length) return n;
    const text = kept.join('').replace(/[，,；;]+$/, '');
    return text ? { ...n, text } : null;
}

export function foldState(notes, same0 = (a, b) => a === b, { lastPos = null } = {}) {
    // 认人的结果这一次折叠里记着（同样几个名字比几千次）
    const seen = new Map();
    const same = (a, b) => { const k = `${a}\u0001${b}`; let v = seen.get(k); if (v === undefined) { v = same0(a, b); seen.set(k, v); } return v; };
    const out = [];
    for (const n0 of [...notes].sort((a, b) => a.pos - b.pos || (a.id ?? 0) - (b.id ?? 0))) {
        const n = movedAway(n0, notes, same);
        if (!n) continue;
        const i = out.findIndex(o => o.aspect === n.aspect && same(o.who, n.who));
        if (i >= 0) out.splice(i, 1);
        if (!GONE.test(n.text)) out.push(n);
    }
    const movedSince = n => out.some(o => o.aspect === '位置' && same(o.who, n.who) && o.pos > n.pos);
    return out.filter(n => !(n.aspect === '带着' && IN_HAND.test(n.text) && !CARRIED.test(n.text) && movedSince(n))
        && !(n.aspect === '身体' && lastPos != null && lastPos - n.pos > BODY_SPAN));
}

// 给某人那一格的几行。board＝foldState 的结果；people＝在场的人（含开口的人和玩家）；dayOf(pos)、today：剧情日。
// 人换了地方，之前那处的"周围"就不给了（门开着、电视开着是那间屋子的事）。
// clock＝{ now, weather }（timeline.clockNow）：现在几号、星期几、什么时候；今天的天气（聊天里今天写到过天气就以聊天为准，不给）。
// moved：场面表认出的、比"此地"那条更新的去处（叙述里"往某处走去"、用户点的；试玩 10/7：人出了地下室往主街走，这里还写着地下室那间屋）
// remote：发消息、打电话来的人（[{ name, way }] 或名字），人不在这儿（用户 10/8："我和他在通话，所在地方本来就不一样，但会被强制写成一样"）：
//   他自己开口时：这儿的地方、周围是镜头所在，他看不见，不给；只给他那头自己的样子（他那几条里写的位置、穿着）。
//   别人开口时：他那几行标明"不在这儿、在那头"，别把他写进这间屋。name：这一格是谁的
export function stateLines(board, { people = [], same = (a, b) => a === b, dayOf = () => 0, today = 0, clock = null, moved = null, remote = [], name = null } = {}) {
    const here = p => people.some(x => same(x, p));
    const away = (Array.isArray(remote) ? remote : []).map(r => (typeof r === 'string' ? { name: r, way: '' } : r)).filter(r => r?.name);
    const awayOf = p => away.find(r => same(r.name, p)) ?? null;
    const selfAway = name ? awayOf(name) : null;
    const lastMove = Math.max(-1, ...board.filter(n => n.aspect === '位置' && here(n.who) && !awayOf(n.who)).map(n => n.pos));
    const age = n => Math.max(0, today - dayOf(n.pos));
    const shown = board.filter(n => (n.who === HERE ? !(n.aspect === '周围' && n.pos < lastMove) && !(selfAway && n.aspect !== '天气') : here(n.who) && !(selfAway && !same(n.who, name))) && age(n) <= (n.aspect === '身体' ? 2 : 1));
    if (!shown.length && !clock?.now && !clock?.weather) return [];
    const lines = [];
    if (clock?.now) lines.push(`· 现在：${clock.now}`);
    const weather = shown.find(n => n.aspect === '天气');
    if (weather) lines.push(age(weather) ? `· 前一天：${weather.text}（可能还留着影响）` : `· 天气：${weather.text}`);
    if ((!weather || age(weather)) && clock?.weather) lines.push(`· 今天的天气：${clock.weather}（正文里写了别的，以正文为准）`);
    const noted = shown.find(n => n.aspect === '地方');
    const place = selfAway ? null : moved?.place && (!noted || (moved.pos ?? -1) > (noted.pos ?? -1)) ? { text: moved.place, pos: moved.pos } : noted;
    if (place) lines.push(`· 地方：${place.text}${age(place) ? '（前一天写到的）' : ''}`);
    // 换了地方，旧那处的"周围"不给
    const around = place === noted ? shown.find(n => n.aspect === '周围') : null;
    if (around) lines.push(`· 周围：${around.text}${age(around) ? '（前一天写到的）' : ''}`);
    const order = ['穿着', '位置', '带着', '身体'];
    const whoList = [...new Set(shown.filter(n => n.who !== HERE).map(n => n.who))];
    for (const who of whoList) {
        const bits = order.map(a => shown.find(n => n.who === who && n.aspect === a)).filter(Boolean)
            .map(n => `${n.text}${age(n) ? '（前一天写到的）' : ''}`);
        const r = awayOf(who);
        const tag = r ? (selfAway ? `（${personWord(who)}那头，自己看得见的）` : `（不在这儿：${/电话/.test(r.way ?? '') ? '电话' : /消息/.test(r.way ?? '') ? '消息' : '电话或消息'}那头，这是${personWord(who)}那头的样子，别写进这儿）`) : '';
        if (bits.length) lines.push(`· ${who}${tag}：${bits.join('；')}`);
    }
    if (!lines.length) return [];
    return [selfAway ? `此刻的样子（${name}人不在镜头这儿，这儿的地方、周围${personWord(name)}看不见；这是${personWord(name)}那头，聊天里写到过的）：` : '此刻的样子（聊天里写到过的；这之后写了新的，以聊天里最新的为准）：', ...lines];
}
