import { personWord } from './pronoun.mjs';
// 局势（质量窗 Q-8 第二、三步）：一个剧情日推一次——各方在镜头外按自己知道的接着动；这一天发生的事按渠道、带着时间差和走样
// 传到该知道的人耳朵里；托出去的事（不在场的人替主角办的）到了日子出结果。
// NC 的原始需求："一件事会传开：有人当天知道，有人三天后听到走样的版本"；"计划编译回路：别人负责的步骤变成在途，到期出结果（失手、变卦、漏风）"。
// 做法（借 Multihog 的按日推进、只动宏观；world-backstage 的"认知只能经获知过程增加"；见调研 26）：
//   - 模型只写三样：动向（势力这一层的动作，不替名册里的主要角色做决定）、传开（哪件事经什么渠道、几天后、以什么样子传到谁）、
//     托付（到期的那件办得怎么样）；
//   - 程序核：主语得是认得的、缘由得是给过的记录；传到的人得认得、原本不知道；托付的编号得在单子上、结果只认四种；
//   - 传到的那天，程序替他记一条"听说"（只他一个人知道）；传到主角的，记成"消息"，给在场的人一行由他挑时候拿出来；
//   - 托付的结果记成一条"结果"（只办事的人知道），主角那边要等消息传到；
//   - 推演挂在当时最后一条消息上，补的记录挂在补的那一刻的最后一条消息上：删消息、换分支都跟着退。
// 不是全城模拟：没有缘由就不动，一天可以什么都没有。

import { enteredSince } from './landing.mjs';
import { toldOf } from './matters.mjs';
import { scaleOf, scaleNote, DAY } from './timescale.mjs';
// 时间尺度（章程 G2）：按年、按月走的局，"一个剧情日推一次"就是一年、一个月推一次；"第几天""几天后"按那个单位读（提示词开头说一句）。
// firstDay：开场那天算第几天（开局单写的，和消息上的日期标签同一个数；试玩 10/12：这里说第 6 天，标签上是第 9 天）
const nthOf = (ts, firstDay = 1) => n => (ts.unit === '天' ? `第 ${n + firstDay - 1} 天` : `第 ${n + firstDay - 1} ${ts.ord}`);

export const SITUATION_SYSTEM = [
    '你在帮一部长篇角色扮演看"局势"：故事里的各方（公司、帮派、组织、团体，也包括主角这一伙）和不在场的人，在镜头外会接着动；发生过的事也会一点点传开。',
    '下面有：势力账（各方关系、人的明面和实际归属、约定，以及谁知道实情）、这一天记下的事（每条写了当时在场、知道的人）、托出去还没了结的事、上次之后刚传到谁耳朵里的话、还在路上没传到的话、认得的人和势力。',
    '写下的每一句以后会单独交给某个人或前台，看不到这里别的内容：谁（名字；生人写称呼）对谁、在哪、什么东西都写出来，别写"那张脸""一个人来""这边的人"这种得靠前后文才知道指谁的说法。',
    '请做三件事。',
    '一、动向：各方按自己知道的，这一天在镜头外做了什么。只写势力、组织这一层的动作和压力（加强戒备、收缩或扩张地盘、放出风声、派人去查、换个说法、按兵不动、翻脸、找新盟友），不替【认得的人】里标了"主要"的人物做决定。一方不知道实情，就照它以为的那样行事：被瞒着的照样信、照样合作。没有缘由就不动，可以一条都没有；局势可以升温，也可以僵住、降温、反噬。至多三条。',
    '二、传开：这一天发生的事，哪些会传到谁耳朵里。要有人传、要有渠道、要花时间：在场的人转告、手下报告、内线、街面传闻、公开的消息（这个世界里说得通的那种）；越私密的越难传，传得越远越走样；没人会说出去的就不传。约定的双方、当时在场的人本来就知道，不用写。至多六条。',
    '三、托付：【托出去还没了结的事】里，由不在场的人去办的那一份，到了该办的时候（照约定里说的时间、答应了几天、【今天】是几号星期几来判断；说的是星期几、几号、几点的，没到那一刻就不写——周二下午的事，周一不出结果），这一天办得怎么样：成了、失手、变卦（他不干了或反水）、漏风（办了，但走漏了风声）。照这个人、这件事的难处和他知道的来，不一定都顺。只写那个人那一份，主角自己要做的那一份不写。结果要让谁知道（包括【主角】：主角会经什么渠道得知，比如对方来消息、有人来报信），写进"传开"，"哪件"写这件托付的编号。至多四条。',
    '四、后续：【刚有了结果的事】、【闹大了的事】，以及这一天记下的事里会在外头引起反应的，哪件会在故事里留下后续——谁因此高兴、失望、起疑、借机、改主意、找上门、捎来话、当面提起；说好了却没办成的，等着的一方照他的性子反应（打来问、记下了、不在乎、自己找上门）。镜头外的动作写进动向或传开；要在主角这边冒出来的，写成一件"后续"：谁牵头（认得的人，或者"世界"）、题（几个字）、露面（一句看得见的事）、应答（主角那边伸手、问起时它的内容）、知情（牵头的人这时知道什么、看到什么）、来由（这件后续背后是怎么回事，一句；牵头的人不知道的也写——它只在有人追查时才露出来）、几天后（0～3）、分量（一句或半轮）。小事也算；没什么影响的不写；不写成责备，也不替主角那边做决定。【闹大了的事】是刚闹出的大动静：照谁看见了、谁会听说、离得多远、各方的性子，排一两件会回到主角这边的（找上门、捎来话、打来电话、有人当面提起），近处的当天就可以（几天后 0），远处的晚一两天；【还开着的话头】里早先担心过的事，这回对得上就照它兑现。至多三件。',
    '五、名声：这一天的事让谁在哪个圈子里有了名声（D-172：街面上做生意的、某个行当、某栋楼的住户、某一伙人）——他们往后怎么看他、怎么待他：开价（不敢抬价、按实价，或者反过来往上抬）、让路、巴结、躲着、找上门试试。要有人传开、圈子里真会知道；小事、没人看见的不算。"关键词"写几个能认出这个圈子的人或场面的词（两个字以上：行当、称呼、地方）。至多两条。',
    '六、旧动向：【上回还在的动向】里每一条（带编号），照这一天的情形答一句：还在（还在继续，不用多写）、停了（办完了、不了了之、对方已经和主角当面见过了、被后来的事盖过了）、变了（换了做法或有了新进展，给新的一句，外人看得到的样子也写）。拿不准就答还在。不用重新写一遍。',
    '写到开局单、世界书、账里已经有的事，时间、数目、谁、什么东西照原文写，别换说法、别改数（"将近半年里陆续……"别写成"半年前……"）：你写的会一字不差递给前台，换一个说法前台就跟着换，再被记成新的事实。',
    '只输出 JSON，不要别的文字：',
    '{"动向": [{"谁": "势力或人名", "做了什么": "一句", "外人看得到": "外人能看到的样子，一句；看不到就写空字符串", "缘由": [记录编号]}],',
    ' "传开": [{"哪件": 记录编号或托付编号, "传到": "人名、势力名或主角", "渠道": "怎么传到的", "几天后": 0到7的整数, "听到的": "他听到的样子，一句；可以和实情不一样"}],',
    ' "托付": [{"哪件": 托付编号, "结果": "成了、失手、变卦、漏风之一", "发生了什么": "一句"}],',
    ' "名声": [{"谁": "有了名声的人", "在谁那儿": "哪个圈子", "怎么看": "一句", "怎么待": "往后怎么待他，一句", "关键词": [""], "缘由": [记录编号]}],',
    ' "后续": [{"哪件": "事几、约几，或记下的事的编号", "谁": "牵头的人或世界", "题": "几个字", "露面": "一句", "应答": "...", "知情": "一句", "来由": "一句", "几天后": 0, "分量": "一句或半轮"}],',
    ' "旧动向": [{"编号": 旧动向的编号, "还在吗": "还在、停了、变了之一", "现在": "变了时写新的一句，其他留空", "外人看得到": "变了时外人能看到的样子，一句；没有就留空"}]}',
    '没有就给空数组。',
].join('\n');

export const OUTCOMES = ['成了', '失手', '变卦', '漏风'];
export const REVIEWS = ['还在', '停了', '变了'];
// 一条动向最多再给角色那一格这么多条消息（从它的推演挂的那条算起；超过了只进规划简报）
export const MOVE_WINDOW = 40;
const clip = (s, n) => String(s ?? '').trim().slice(0, n);
const tidy = t => String(t ?? '').trim().replace(/[。；;，,]+$/, '');
const samePerson = (a, b) => !!a && !!b && (a === b || b.startsWith(`${a}·`) || a.startsWith(`${b}·`));

// 给模型的材料。records：这一天（上次推演之后）记下的；ledgerLines：factionBrief 的输出；pending：还没传到的；heard：上次之后传到的；
// errands：托出去还没了结的事 [{id, executor, what, stage, when}]；people：[{name, role}]（名册＋关系表里的人），factions：势力名。
// results：刚有了结果的事（后台排的事接了、拿出来了、沉了；说好的事办了、改了、没办成、过去了、到日子没办），[{id: '事3'|'约12', line}]。
// loud：刚闹出大动静的那几条（每轮的检查判了"会发酵"，D-170）{ ids, why }；open：早先还开着的话头（担心过会传开、会被盯上的那种）
// moves：之前推演记下的动向（D-171，试玩 10/6：第 2 天有一方派了眼线盯着主角那栋楼，之后的推演不知道，楼里闹翻了天消息也没往那一方走）
export function situationPrompt({ day, date = '', firstDay = 1, ledgerLines = [], records = [], pending = [], heard = [], errands = [], principal = null, people = [], factions = [], results = [], loud = null, open = [], moves = [], skip = [], timeScale = DAY }) {
    const ts = scaleOf(timeScale), nth = nthOf(ts, firstDay);
    return [
        ...(scaleNote(ts) ? [scaleNote(ts), ''] : []),
        `【今天】剧情${nth(day + 1)}${date ? `（${date}）` : ''}。${principal ? `【主角】${principal}。` : ''}`,
        ...skip,
        '', ...(ledgerLines.length ? ledgerLines : ['【势力账】（还没有）']),
        ...(moves.length ? ['', '【上回还在的动向】（之前推演记下的、看样子还没了的；派了人盯着哪儿、在查什么的，那儿出了事消息先到他那儿。每一条请在"旧动向"里答：还在、停了、变了）', ...moves.map(m => `· [${m.id}] ${nth(m.day + 1)} ${m.who}：${clip(m.what, 120)}`)] : []),
        '', '【这一天记下的事】（编号、谁、什么；在场＝当时知道的人）',
        ...(records.length ? records.map(r => `· [${r.id}] ${r.holder_name ?? r.holder}：${clip(r.text, 160)}（在场：${[...new Set([r.holder_name, ...(r.audience ?? [])].filter(Boolean))].join('、')}）`) : ['（没有）']),
        '', '【托出去还没了结的事】（编号、谁去办、到哪一步、什么时候答应的）', ...(errands.length ? errands.map(e => `· [${e.id}] ${e.executor}（${e.stage}，${e.when}${e.due ? `；${e.due}` : ''}）：${clip(e.what, 150)}`) : ['（没有）']),
        '', '【上次之后传到的话】（谁听说了什么；他们照听到的样子反应，不知道实情）', ...(heard.length ? heard.map(h => `· ${h.target}（${h.channel}）：${clip(h.heard, 100)}`) : ['（没有）']),
        '', '【还在路上的话】', ...(pending.length ? pending.map(p => `· [${p.source}] → ${p.target}（${p.channel}，${nth(p.due + 1)}到）：${clip(p.heard, 80)}`) : ['（没有）']),
        '', '【刚有了结果的事】（编号、谁、什么、结果；这一天里怎么接的、怎么选的，见上面记下的事）', ...(results.length ? results.map(x => `· [${x.id}] ${x.line}`) : ['（没有）']),
        ...(loud?.ids?.length ? ['', `【闹大了的事】（上面记下的事里这几条刚闹出了大动静${loud.why ? `：${clip(loud.why, 120)}` : ''}）`, ...loud.ids.map(id => `· [${id}]`)] : []),
        ...(open.length ? ['', '【还开着的话头】（早先说过、还没了结的；编号、谁、什么）', ...open.map(r => `· [${r.id}] ${r.holder_name ?? r.holder}：${clip(r.text, 120)}`)] : []),
        '', '【认得的人】', ...(people.length ? people.map(p => `· ${p.name}${p.role ? `（${p.role}）` : ''}`) : ['（没有）']),
        '', '【认得的势力】', factions.length ? factions.join('、') : '（没有）',
    ].join('\n');
}

// 解析＋核对。known：认得的名字（人、势力）；main：名册里"主要"的人（动向不能以他们为主语）；
// ids：这一天给过的记录编号；aware(id)：那件事当时已经知道的人（传到他们就不算传开）；
// errands：Map(编号 → {executor, key})，托出去还没了结的事；principal：主角的名字（传到主角＝给在场的人一条"这边收到的消息"）。
// seen：给模型的材料全文——材料里写着的名字（记录里的帮派、地名）也算认得，素材包的势力网不全（实测少了一个帮）。
export function parseSituation(text, { known = [], main = [], ids = new Set(), aware = () => [], day = 0, errands = new Map(), principal = null, seen = '', results = new Set(), loud = new Set(), liveMoves = new Set() } = {}) {
    const s = String(text ?? '');
    const body = /```(?:json)?\s*([\s\S]*?)```/i.exec(s)?.[1] ?? /\{[\s\S]*\}/.exec(s)?.[0] ?? '';
    let obj = null;
    try { obj = JSON.parse(body); } catch { return { moves: [], spreads: [], outcomes: [], followups: [], reviews: [], dropped: [{ reason: 'not_json' }] }; }
    const knownSet = new Set(known), mainSet = new Set(main);
    const isKnown = n => knownSet.has(n) || [...knownSet].some(k => samePerson(k, n)) || (n.length >= 2 && String(seen).includes(n));
    const dropped = [], moves = [], spreads = [], outcomes = [], followups = [], reps = [], reviews = [];
    // 旧动向（章程第 11 条）：回头看上回还在的动向，每条答还在、停了、变了；编号得是给过的，变了要写新的一句
    for (const x of Array.isArray(obj?.['旧动向']) ? obj['旧动向'].slice(0, 10) : []) {
        const id = Number(x?.['编号']), verdict = clip(x?.['还在吗'], 4), what = clip(x?.['现在'], 140), outside = clip(x?.['外人看得到'], 140);
        if (!liveMoves.has(id)) { dropped.push({ item: x, reason: `旧动向的编号不在给过的里面：${x?.['编号']}` }); continue; }
        if (!REVIEWS.includes(verdict)) { dropped.push({ item: x, reason: `旧动向的答法不认识：${verdict || '空'}` }); continue; }
        if (verdict === '变了' && !what) { dropped.push({ item: x, reason: '旧动向变了却没写新的一句' }); continue; }
        if (reviews.some(r => r.move === id)) { dropped.push({ item: x, reason: '同一条旧动向答了两次' }); continue; }
        reviews.push({ move: id, verdict, ...(verdict === '变了' ? { what, seen: outside } : {}) });
    }
    // 名声（D-172）：谁在哪个圈子里有了什么名声、他们往后怎么待他；要有缘由，至多两条
    for (const x of Array.isArray(obj?.['名声']) ? obj['名声'].slice(0, 4) : []) {
        const who = clip(x?.['谁'], 30), among = clip(x?.['在谁那儿'], 40), view = clip(x?.['怎么看'], 160), deal = clip(x?.['怎么待'], 160);
        const keys = [...new Set((Array.isArray(x?.['关键词']) ? x['关键词'] : []).map(k => clip(k, 12)).filter(k => k.length >= 2))].slice(0, 10);
        const why = (Array.isArray(x?.['缘由']) ? x['缘由'] : [x?.['缘由']]).map(Number).filter(n => ids.has(n));
        if (!who || !among || !deal) { dropped.push({ item: x, reason: '名声缺谁、在谁那儿或怎么待' }); continue; }
        if (!why.length) { dropped.push({ item: x, reason: '名声没有缘由' }); continue; }
        if (who !== principal && !isKnown(who)) { dropped.push({ item: x, reason: `不认得：${who}` }); continue; }
        if (reps.length >= 2) { dropped.push({ item: x, reason: '一次至多两条名声' }); continue; }
        reps.push({ who, among, view, deal, keys, why });
    }
    for (const m of Array.isArray(obj?.['动向']) ? obj['动向'].slice(0, 5) : []) {
        const who = clip(m?.['谁'], 30), what = clip(m?.['做了什么'], 140), seen = clip(m?.['外人看得到'], 140);
        const why = (Array.isArray(m?.['缘由']) ? m['缘由'] : [m?.['缘由']]).map(Number).filter(n => ids.has(n) || errands.has(n));
        if (!who || !what) { dropped.push({ item: m, reason: '动向缺谁或做了什么' }); continue; }
        if (mainSet.has(who)) { dropped.push({ item: m, reason: `动向替主要角色做了决定：${who}` }); continue; }
        if (!isKnown(who)) { dropped.push({ item: m, reason: `不认得：${who}` }); continue; }
        if (!why.length) { dropped.push({ item: m, reason: '动向没有缘由' }); continue; }
        if (moves.length >= 3) { dropped.push({ item: m, reason: '一天至多三条动向' }); continue; }
        moves.push({ who, what, seen, why });
    }
    for (const o of Array.isArray(obj?.['托付']) ? obj['托付'].slice(0, 6) : []) {
        const id = Number(o?.['哪件']), result = clip(o?.['结果'], 4), what = clip(o?.['发生了什么'], 160);
        const e = errands.get(id);
        if (!e) { dropped.push({ item: o, reason: `托付的编号不在单子上：${o?.['哪件']}` }); continue; }
        if (!OUTCOMES.includes(result)) { dropped.push({ item: o, reason: `托付的结果不认识：${result || '空'}` }); continue; }
        if (!what) { dropped.push({ item: o, reason: '托付没写发生了什么' }); continue; }
        if (outcomes.some(x => x.key === e.key)) { dropped.push({ item: o, reason: '同一件托付写了两次' }); continue; }
        if (outcomes.length >= 4) { dropped.push({ item: o, reason: '一天至多四条托付' }); continue; }
        outcomes.push({ source: id, key: e.key, who: e.executor, result, what });
    }
    const settled = new Set(outcomes.map(o => o.source));
    for (const x of Array.isArray(obj?.['传开']) ? obj['传开'].slice(0, 10) : []) {
        const source = Number(x?.['哪件']), target = clip(x?.['传到'], 30), channel = clip(x?.['渠道'], 20), heard = clip(x?.['听到的'], 140);
        const after = Math.round(Number(x?.['几天后']));
        const errand = errands.has(source) && !ids.has(source);
        if (!ids.has(source) && !errands.has(source)) { dropped.push({ item: x, reason: `传开的那件不在这一天的记录里：${x?.['哪件']}` }); continue; }
        // 结果没交回来的托付，不许先传开（那等于替它定了结果）。
        if (errand && !settled.has(source)) { dropped.push({ item: x, reason: '传开的托付没有结果' }); continue; }
        if (!target || !heard) { dropped.push({ item: x, reason: '传开缺传到谁或听到的样子' }); continue; }
        const notice = !!principal && (target === principal || target === '主角');
        if (!notice && !isKnown(target)) { dropped.push({ item: x, reason: `不认得：${target}` }); continue; }
        if (!notice && aware(source).some(n => samePerson(n, target))) { dropped.push({ item: x, reason: `${target}当时就知道` }); continue; }
        if (!(after >= 0 && after <= 7)) { dropped.push({ item: x, reason: `几天后不对：${x?.['几天后']}` }); continue; }
        if (spreads.length >= 8) { dropped.push({ item: x, reason: '一天至多八条' }); continue; }
        spreads.push({ source, target: notice ? principal : target, channel: channel || '传闻', due: day + after, heard });
    }
    // 后续：哪件得是给过的结果；牵头的得认得（或者"世界"）；露面、应答都要有。
    for (const f of Array.isArray(obj?.['后续']) ? obj['后续'].slice(0, 5) : []) {
        const source = clip(f?.['哪件'], 12), who = clip(f?.['谁'], 30), title = clip(f?.['题'], 20), surface = clip(f?.['露面'], 200), respond = clip(f?.['应答'], 600), know = clip(f?.['知情'], 200), origin = clip(f?.['来由'], 300);
        const after = Math.round(Number(f?.['几天后']));
        // 记下的事（闹大了的那几条，或者这一天记下的、会在外头引起反应的；D-171：换天那次局势排的后续以前都被扔了）——就是冲着眼前来的，至多两件
        const n = Number(String(source).replace(/^#/, ''));
        const fromLoud = loud.has(n) || (!results.has(source) && ids.has(n));
        if (!results.has(source) && !fromLoud) { dropped.push({ item: f, reason: `后续的那件不在刚有了结果的事里：${f?.['哪件']}` }); continue; }
        if (fromLoud && followups.filter(x => x.loud).length >= 2) { dropped.push({ item: f, reason: '闹大了的事至多两件后续' }); continue; }
        if (!who || !title || !surface || !respond) { dropped.push({ item: f, reason: '后续缺谁、题、露面或应答' }); continue; }
        if (who !== '世界' && !isKnown(who)) { dropped.push({ item: f, reason: `不认得：${who}` }); continue; }
        if (followups.length >= 3) { dropped.push({ item: f, reason: '一天至多三件后续' }); continue; }
        followups.push({ source, who, title, surface, respond, know, ...(origin ? { origin } : {}), afterDays: after >= 0 && after <= 3 ? after : 0, weight: /半轮/.test(f?.['分量'] ?? '') ? '半轮' : '一句', ...(fromLoud ? { loud: true } : {}) });
    }
    return { moves, spreads, outcomes, followups, reps, reviews, dropped };
}
// 名声记成一条一直算数的改变（世界那边的事：那个圈子里的人都知道，挂在推演那一刻的最后一条消息上）
export const repRecord = (x, { storyId, anchor }) => ({ storyId, fp: anchor.fp, type: '改变', duration: '直到被改变', text: `${x.among}那儿传开了：${x.view || `${x.who}的名声`}；往后待${x.who}：${x.deal}`.slice(0, 200),
    holder: 'world', holderName: '世界', audience: [], about: x.who, quotes: [], keys: x.keys, rep: { who: x.who, among: x.among, view: x.view, deal: x.deal, keys: x.keys } });
// 写到那个圈子里的人时（D-172，用户 10/6："以后我再找人上门修东西、安装什么设备的时候，来的人都不敢再抬价"）：
// 眼下说的、写的沾上了那个圈子（关键词或圈子名），给开口的人一句——他写那个圈子里的人时照这个待那个人。同一人同一圈子取最新的一条。
export function repLines(records, { text = '' } = {}) {
    const t = String(text ?? '');
    const latest = new Map();
    for (const r of records) if (r.rep?.who && r.rep?.among) latest.set(`${r.rep.who}\u0001${r.rep.among}`, r);
    const hit = [...latest.values()].filter(r => [r.rep.among, ...(r.rep.keys ?? [])].some(k => k && k.length >= 2 && t.includes(k)));
    return hit.length ? ['名声（写到这些圈子里的人时照这个来；这是他们那边听说的，别的人不一定知道）：', ...hit.map(r => `· ${r.rep.among}那儿：${r.rep.view ? `${r.rep.view}——` : ''}待${r.rep.who}：${r.rep.deal}`)] : [];
}

// 局势的存放：推演一次记一行（挂在当时最后一条消息上），动向、传开、托付的结果各自一张表；传到了记下补的那条记录的编号。
const SCHEMA = `
create table if not exists situation_ticks(
  id integer primary key autoincrement, story_id text not null, chat_key text not null, day integer not null,
  anchor_pos integer not null, anchor_fp text not null, raw text, created_at text not null);
create table if not exists situation_moves(
  id integer primary key autoincrement, tick_id integer not null, who text not null, what text not null, seen text, why text);
create table if not exists situation_move_reviews(
  id integer primary key autoincrement, tick_id integer not null, move_id integer not null, verdict text not null, what text, seen text);
create table if not exists situation_spreads(
  id integer primary key autoincrement, tick_id integer not null, source integer not null, target text not null,
  channel text, due integer not null, heard text not null, record_id integer);
create table if not exists situation_outcomes(
  id integer primary key autoincrement, tick_id integer not null, source integer not null, key text not null,
  who text not null, result text not null, what text not null, record_id integer);
`;

export function openSituation(db) {
    db.exec(SCHEMA);
    // lag：玩家交代跳过的一段里补跑的那几次（skip.mjs）挂在空白过后的那条上，推的却是空白里早几天——早几天记在这儿，按现在的天数重算时不挪错
    try { db.exec('alter table situation_ticks add column lag integer'); } catch {}
    const q = sql => db.prepare(sql);
    const now = () => new Date().toISOString();
    const inTicks = (table, tickIds, extra = '') => (tickIds.length
        ? q(`select x.*, t.day from ${table} x join situation_ticks t on t.id = x.tick_id where x.tick_id in (${tickIds.map(() => '?').join(',')}) ${extra} order by x.id`).all(...tickIds) : []);
    function putTick({ storyId, chatKey, day, anchor, raw, moves = [], spreads = [], outcomes = [], reviews = [], lag = 0 }) {
        db.exec('begin');
        try {
            const id = Number(q('insert into situation_ticks(story_id, chat_key, day, anchor_pos, anchor_fp, raw, created_at, lag) values (?, ?, ?, ?, ?, ?, ?, ?)').run(storyId, chatKey, day, anchor.pos, anchor.fp, raw ?? null, now(), Number(lag) || 0).lastInsertRowid);
            for (const m of moves) q('insert into situation_moves(tick_id, who, what, seen, why) values (?, ?, ?, ?, ?)').run(id, m.who, m.what, m.seen || null, JSON.stringify(m.why));
            for (const r of reviews) q('insert into situation_move_reviews(tick_id, move_id, verdict, what, seen) values (?, ?, ?, ?, ?)').run(id, r.move, r.verdict, r.what ?? null, r.seen || null);
            for (const s of spreads) q('insert into situation_spreads(tick_id, source, target, channel, due, heard) values (?, ?, ?, ?, ?, ?)').run(id, s.source, s.target, s.channel, s.due, s.heard);
            for (const o of outcomes) o.id = Number(q('insert into situation_outcomes(tick_id, source, key, who, result, what) values (?, ?, ?, ?, ?, ?)').run(id, o.source, o.key, o.who, o.result, o.what).lastInsertRowid);
            db.exec('commit');
            return id;
        } catch (error) { db.exec('rollback'); throw error; }
    }
    // 这个窗口看得见的推演：挂的那条消息还在它的序列里（删到那条之前、换到没有它的分支，就当没推过）。
    function ticksFor(storyId, fps) {
        return q('select * from situation_ticks where story_id = ? order by id').all(storyId).filter(t => fps.has(t.anchor_fp));
    }
    const movesOf = tickIds => inTicks('situation_moves', tickIds).map(m => ({ ...m, why: JSON.parse(m.why ?? '[]') }));
    const reviewsOf = tickIds => inTicks('situation_move_reviews', tickIds);
    const spreadsOf = tickIds => inTicks('situation_spreads', tickIds);
    const outcomesOf = tickIds => inTicks('situation_outcomes', tickIds);
    function setDelivered(id, recordId) { q('update situation_spreads set record_id = ? where id = ?').run(recordId, id); }
    function setOutcomeRecord(id, recordId) { q('update situation_outcomes set record_id = ? where id = ?').run(recordId, id); }
    return { putTick, ticksFor, movesOf, reviewsOf, spreadsOf, outcomesOf, setDelivered, setOutcomeRecord };
}

// 一条动向还作不作数（章程第 11 条：推出来的每一样都有过期；读时判，不改库）。收法三种：
// - 被后来的回头看答了"停了"（move.stopped，situationNow 按看得见的回头看盖上去的）；
// - 缘由了结：它的缘由（move.why 里的记录编号）全被看得见的"了结"或"回答"关上了；或者有一件同题的"碰上了"（matter）在它之后了结了；
// - 它的主语之后和主角当面见过（进场记录、隔离区间里他在玩家身边出现过，比动向挂的那条晚；远程来电来信也算他亲自出面了），
//   或者之后有他自己的"说""做"、当时在场的人里有主角。
// 另可带 window（条数）和 lastPos：动向挂的那条离最新一条超过这么多条，也算过了（角色那一格用；规划简报不用）。
// 回头看改过的 move.pos 是新那次推演挂的那条。
export function moveLive(move, { records = [], messages = [], arrivals = [], anchors = null, principal = null, avatarOf = null, lastPos = null, window = null } = {}) {
    if (!move || move.stopped) return false;
    if (window != null && lastPos != null && Number.isFinite(move.pos) && lastPos - move.pos > window) return false;
    const byId = new Map(records.map(r => [r.id, r]));
    const why = (Array.isArray(move.why) ? move.why : []).map(Number).map(id => byId.get(id)).filter(Boolean);
    const closed = r => !!r.closed_by && r.closed_by.kind !== '证实';
    if (why.length && why.every(closed)) return false;
    const pos = Number.isFinite(move.pos) ? move.pos : null;
    if (pos != null && move.who) {
        if (records.some(r => r.matter && closed(r) && r.closed_by.pos > pos && toldOf(r, move.what ?? '', [move.who]))) return false;
        if (principal && !samePerson(move.who, principal)) {
            const list = Array.isArray(arrivals) ? arrivals : Object.values(arrivals ?? {});
            const avatar = avatarOf?.(move.who) ?? list.find(e => e && (e.who === move.who) && e.avatar)?.avatar ?? null;
            if (enteredSince(pos, { who: move.who, avatar, messages, anchors, arrivals: list })) return false;
            if (records.some(r => r.pos > pos && ['说', '做'].includes(r.type) && samePerson(r.holder_name, move.who) && (r.audience ?? []).some(a => samePerson(a, principal)))) return false;
        }
    }
    return true;
}

// 这个窗口此刻的局势：看得见的推演里的动向、托付的结果、传开；传开分"已传到"（补的那条记录还在这个窗口里）和"还在路上"。
// dayOf：按现在的天数重算——推演记的是当时算出来的第几天；天数算法改正过以后（D-171，试玩 10/6），"第 3 天到"整个挪到了还没到的日子。
// 传开、动向的日子改按"推演那条消息现在是第几天＋当时说的隔几天"算。
// live：给了就按 moveLive 筛动向（{ records, messages, arrivals, anchors, principal, ... }）；没给只去掉回头看答了"停了"的。
export function situationNow(sit, { storyId, messages, visibleIds, dayOf = null, live = null }) {
    const fps = new Set(messages.map(m => m.fp));
    const ticks = sit.ticksFor(storyId, fps);
    const ids = ticks.map(t => t.id);
    const tickOf = new Map(ticks.map(t => [t.id, t]));
    const base = x => { const t = tickOf.get(x.tick_id); return dayOf && t && Number.isFinite(t.day) ? dayOf(t.anchor_pos + 0.5) - (Number(t.lag) || 0) - t.day : 0; };
    const spreads = sit.spreadsOf(ids).map(s => ({ ...s, due: s.due + base(s), day: s.day + base(s) }));
    return {
        ticks,
        lastTick: ticks.at(-1) ?? null,
        moves: movesWithReviews(sit, ids, tickOf, base).filter(m => !m.stopped && (!live || moveLive(m, { messages, ...live }))),
        outcomes: sit.outcomesOf(ids).map(o => ({ ...o, day: o.day + base(o) })),
        delivered: spreads.filter(s => s.record_id != null && visibleIds.has(s.record_id)),
        pending: spreads.filter(s => !(s.record_id != null && visibleIds.has(s.record_id))),
    };
}

// 动向带上它挂的那条消息的位置；按看得见的回头看盖上去：停了的标 stopped，变了的换成新的一句（时间也算新那次推演的）
function movesWithReviews(sit, ids, tickOf, base) {
    const moves = sit.movesOf(ids).map(m => ({ ...m, day: m.day + base(m), pos: tickOf.get(m.tick_id)?.anchor_pos ?? null }));
    const byId = new Map(moves.map(m => [m.id, m]));
    for (const r of sit.reviewsOf?.(ids) ?? []) {
        const m = byId.get(r.move_id);
        if (!m) continue;
        if (r.verdict === '停了') m.stopped = true;
        else if (r.verdict === '变了' && r.what) {
            m.stopped = false; m.revised = true;
            m.what = r.what; m.seen = r.seen || null;
            m.day = r.day + base(r); m.pos = tickOf.get(r.tick_id)?.anchor_pos ?? m.pos;
        }
    }
    return moves;
}

// 到日子的传开：替他记一条"听说"（只他知道），挂在眼下最后一条消息上。addRecord 由调用方给（records.addDerived）。
// 传到主角的是"这边收到的消息"：记成一条"消息"（只主角知道），这一格里给在场的人一行，由他挑时候拿出来。
export function deliverDue(sit, now, { today, anchor, storyId, addRecord, principal = null }) {
    const out = [];
    for (const s of now.pending.filter(x => x.due <= today)) {
        const notice = !!principal && s.target === principal;
        const id = addRecord({ storyId, fp: anchor.fp, ...(notice ? { matter: { kind: '消息', title: s.channel ?? '' } } : {}), type: notice ? '消息' : '听说', text: notice ? `${s.target}这边收到：${s.heard}（${s.channel}）` : `${s.target}听说：${s.heard}（${s.channel}）`, holder: s.target, holderName: s.target, audience: [s.target], about: s.target, quotes: [], keys: [] });
        sit.setDelivered(s.id, id);
        out.push({ ...s, record_id: id, notice });
    }
    return out;
}

// 托付的结果：记成一条只办事的人知道的"结果"（主角那边要等消息传到），挂在推演那一刻的最后一条消息上。
export function recordOutcomes(sit, outcomes, { anchor, storyId, addRecord, errands }) {
    for (const o of outcomes) {
        const e = errands.get(o.source);
        const id = addRecord({ storyId, fp: anchor.fp, type: '结果', text: `${o.who}${e?.title ? `办「${e.title}」` : '办的那件事'}：${tidy(o.what)}（${o.result}）`, holder: o.who, holderName: o.who, audience: [o.who], about: o.who, quotes: [], keys: [] });
        sit.setOutcomeRecord(o.id, id);
        o.record_id = id;
    }
}

// 规划简报的一段：这几天的动向（外人看得到的另写）、托出去的事办得怎么样、还在路上的话。
export function situationBrief(now, { today = null, relDay = null, max = 12, timeScale = DAY } = {}) {
    const out = [];
    const nth = nthOf(scaleOf(timeScale));
    const rel = d => (today != null && relDay ? relDay(today - d) : nth(d + 1));
    if (now.moves.length) out.push('【镜头外的动向】（局势推演记下的，按天；"外面看得到"的已经是公开的动静，别的只有那一方自己知道）',
        ...now.moves.slice(-max).map(m => `· ${rel(m.day)} ${m.who}：${tidy(m.what)}${m.seen ? `；外面看得到：${tidy(m.seen)}` : ''}`));
    if (now.outcomes.length) out.push('【托出去的事，办得怎么样】（只有办事的人和传到的人知道；主角那边要等消息传到）',
        ...now.outcomes.slice(-max).map(o => `· ${rel(o.day)} ${o.who}：${o.result}——${tidy(o.what)}`));
    if (now.pending.length) out.push('【还在路上的话】（还没传到的；到了那天他才知道）',
        ...now.pending.slice(-max).map(s => `· ${nth(s.due + 1)} → ${s.target}（${s.channel}）：${tidy(s.heard)}`));
    return out;
}

// 角色那一格：主角这边刚收到的消息（这一格补上的）；他最近一两天听说的（至多两条）；外面看得到的动静（前一天、今天的，至多两条，可用可不用）。
export function situationSlotLines(now, { name, today, records, dayOf, notices = [], principal = null, lastPos = null, camera = false }) {
    const lines = [];
    const byId = new Map(records.map(r => [r.id, r]));
    // 主角这边今天收到的消息：这一格刚补上的，加上今天早些时候补上、还在这个窗口里的。只给镜头（旁白让消息传进来）——
    // 在场的有卡的人看不见她终端上的字，给了他，他就当自己知道了（试玩 10/14：她还没看的推送，同屋的两个人先说出了内容）
    const today_ = !camera ? [] : now.delivered.filter(s => principal && s.target === principal && byId.has(s.record_id) && dayOf(byId.get(s.record_id).pos) >= today);
    const news = camera ? [...new Map([...today_, ...notices].map(s => [s.id, s])).values()] : [];
    if (news.length) lines.push(`${principal ?? '主角'}这边刚收到的消息（可以让消息传进来、有人来报信；不必这一轮就拿出来，拿出来时照这个样子，不一定是实情；已经演过的就不用再提）：`, ...news.map(s => `· ${tidy(s.heard)}（${s.channel}）`));
    const heard = now.delivered.filter(s => s.target !== principal && samePerson(s.target, name) && byId.has(s.record_id) && today - dayOf(byId.get(s.record_id).pos) <= 1).slice(-2);
    if (heard.length) lines.push(`${name}最近听说的（传到${personWord(name)}耳朵里的样子，不一定是实情；提不提、信不信由${name}）：`, ...heard.map(s => `· ${tidy(s.heard)}（${s.channel}）`));
    // 外面的动静：前一天、今天的，而且挂的那条离现在不到 MOVE_WINDOW 条（剧情日走得慢时，同一条不要挂几百条消息）
    const seen = now.moves.filter(m => m.seen && today - m.day <= 1 && !(lastPos != null && Number.isFinite(m.pos) && lastPos - m.pos > MOVE_WINDOW)).slice(-2);
    if (seen.length) lines.push('外面的动静（可用可不用：场面松的时候从街谈巷议、传来的消息、谁的一句话里冒出来；正说到要紧处就当没看见）：', ...seen.map(m => `· ${tidy(m.seen)}`));
    return lines;
}
