import { personWord, renderPronouns } from './pronoun.mjs';
// 有卡的人进场（N-292，用户 10/6："旁白只做环境、场景和 NPC 描写，如果有角色要入场，最后给个类似'门打开，某人从门外进来'，
// 然后我拉人进来，他进来也能接上戏……他进场是知道自己怎么来的，来干嘛的，能看到user正在和一个生人打得火热，也能在进群就先发言"）。
// 一来一回：镜头那一格里递一句"这一段让他来"（只写到他出现为止，他的话和动作由他自己的卡来）→ 扩展问玩家让不让他进场 →
// 进场时便宜模型替他理一次"怎么来的、为什么来、到场那一刻看得见什么"→ 他头一回开口的那一格里带上（之前说的话他没听见）。
// 题材无关：人名、地方都来自聊天和名册。
import { arrivalLive } from './landing.mjs';
import { scaleOf, DAY } from './timescale.mjs';

// 名册里有卡的人（头像是图片文件；"face:"开头的是没卡的新面孔；镜头那张卡不算）
export const hasCard = entry => !!entry && /\.(png|webp|jpe?g|gif)$/i.test(String(entry.avatar ?? '')) && entry.role !== '不用';

// 镜头那一格里的一句：接下来他要露面（试玩 10/6：原来写"这一段让他来"，旁白读成"这一段归他写"，用他的口吻写了他出门、下楼、买东西）
// way：口袋里写明了怎么来的（发来消息、打来电话）
// D-169：写到他时要点他的名（扩展看名字在不在，在才问玩家让不让他进场）
export const arrivalCue = ({ who, around = '玩家', way = '' }) => `（接下来${who}要露面${way ? `（${way}）` : ''}：旁白这一段照样只写${around}身边——这地方的样子、动静、没卡的人。${who}不在镜头里：${personWord(who)}在哪、在干什么、说什么，一个字都别写，更别用${personWord(who)}的口吻写。只在这一段最后带出${personWord(who)}来的那一下，照这个世界说得通的方式${/消息|电话/.test(way) ? `：终端响了、屏幕上跳出${who}的名字` : `：门被推开、${who}走进来，或者终端响了、屏幕上跳出${who}的名字`}——写到这一下时点出"${who}"这个名字。之后由${who}自己的卡接着演。）`;
export const wayOf = text => /电话|来电/.test(text ?? '') ? '打来电话' : /消息|短讯|短信|发来/.test(text ?? '') ? '发来消息' : '';
export const isRemote = way => /电话|消息|来电|短讯|短信/.test(way ?? '');

export const ARRIVAL_SYSTEM = [
    "一部长篇角色扮演里，有个角色这会儿到场了（旁白刚写到〔当事人〕出现：门被推开、有人走进来，或者终端响了）。〔当事人〕接下来要自己开口。你只替〔当事人〕理清两样，给〔当事人〕自己心里有数：",
    "1. 来由：〔当事人〕为什么这会儿来、怎么来的（照旁白写的那样：找上门、刚好路过、打电话、发消息）。给了由头就照由头；没给，就按〔当事人〕和在场的人的关系、〔当事人〕这几天手上的事、这个地方，想一个平常、说得通的，别编大事、别编新的人和东西。一两句，〔当事人〕自己心里有数的口气。玩家去找〔当事人〕的，就写〔当事人〕在原地看见玩家过来。",
    "2. 看到：〔当事人〕到场那一刻看得见、听得见的——谁在哪、和谁在一起、在干什么、什么神情、什么气氛。只写〔当事人〕这一眼看得到、听得到的；之前他们说了什么〔当事人〕没听见，别写；打电话来的，写〔当事人〕电话里听得到的（背景声、对方的口气）。两三句。",
    "3. 这段时间（给了【〔当事人〕上一回离开】才写）：〔当事人〕离开以后到现在做了什么——照〔当事人〕手上的事、离开时说要去办的、过去了多久，写一两件平常的事，办成了还是没办成照实写；过去没多久就写没多久能做完的事；别编大事、别编新的人和东西。〔当事人〕这段时间要是真换了住处（租到了另一处房、搬去了另一处），在\"住处\"里写新住处是什么样的地方（几个字）；【〔当事人〕离开时住在】写了的，那就是〔当事人〕住的地方——搬进去、收拾它、签收送到那儿的东西都不算换住处，留空。",
    "4. 在哪：打电话、发消息来的，〔当事人〕这会儿人在哪、在干什么（照〔当事人〕走时说的去向、过了多久，几个字到一句）；人到场的留空。",
    "不替〔当事人〕决定接下来做什么、说什么，不写〔当事人〕的心理活动。只输出一个 JSON：{\"怎么来\": \"上门|路过|电话|消息\", \"来由\": \"\", \"看到\": \"\", \"这段时间\": \"\", \"住处\": \"\", \"在哪\": \"\"}",
].join('\n');

// 旁白刚替他递出去的那条消息、来电（场记章程 B1；门上那一项的 sent：{ way 消息|电话, surface 露面原文, respond 应答原文 }）：
// 他进来就是接着这件说的，不是重发一遍。他自己知道这条（是他发的、他打的），隔离区间从进场那条起、旁白那条他看不见，所以要给
const sentVerb = sent => (sent?.way === '电话' ? '打过' : '发过');
export const sentText = (who, userName, sent) => `${who}刚给${userName}${sent?.way === '电话' ? '打过电话' : '发过消息'}：${sent?.surface ?? ''}`;

// away：他上一回离场以后（{ span 过了多久, leaving 离开时那两句, matters 他手上还开着的事, home 他眼下住哪 }）；第一次进场没有
// way：口袋、去向里写明了的怎么来（发来消息、打来电话、上门）；away.plan：他离场时记下的去向（D-169）；sent：旁白刚替他递出去的那条
export function arrivalPrompt({ who, userName = '玩家', reason = '', tie = '', place = '', messages = [], away = null, way = '', mode = 'come', sent = null }) {
    return [
        `【到场的人】${who}`,
        `【在场的玩家角色】${userName}`,
        tie ? `【${who}和${userName}】${tie}` : '',
        place ? `【这会儿在哪】${place}` : '',
        reason ? `【后台给的由头】${reason}` : `【后台给的由头】（没有，照关系和这几天的事想一个平常的）`,
        mode === 'go' ? renderPronouns("【是谁找谁】玩家去找〔当事人〕（〔当事人〕在那儿，玩家到了）。", { person: who }) : mode === 'remote' ? `【怎么联系】${personWord(who)}${/电话/.test(way) ? '打电话' : '发消息'}来，人不过来。` : '',
        way ? `【怎么来】${way}` : '',
        ...(sent?.surface ? [`【${personWord(who)}刚${sentVerb(sent)}】${sent.surface}${sent.respond ? `——${sent.respond}` : ''}`,
            `（这条是旁白刚替${personWord(who)}递出去的，是${personWord(who)}自己${sentVerb(sent)}的。这一条${personWord(who)}接着这件往下写，别重发一遍；来由就照这件写。）`] : []),
        ...(away ? [
            `【${personWord(who)}上一回离开】${away.leaving || '（没写怎么走的）'}；离开到现在：${away.span || '不清楚过了多久'}`,
            ...(away.plan?.errands?.length ? [`【${personWord(who)}走时说要去办的】${away.plan.errands.filter(e => !e?.done).map(e => e.text ?? e).join(' → ')}${away.plan.span ? `（大概${away.plan.span}）` : ''}${away.plan.backLine ? `；说过回来时：${away.plan.backLine}` : ''}`] : []),
            ...(away.plan?.errands?.some(e => e?.done) ? [`【这段时间${personWord(who)}已经】${away.plan.errands.filter(e => e?.done).map(e => `${e.text}：${e.done}，${e.note || ''}`).join('；')}。这些是已经定了的事实，不重猜、不改写；这段时间只补没结算过的部分，没有就留空。`] : []),
            ...(away.settled?.length ? [`【这段时间已经定了的】${away.settled.join('；')}。只补没结算过的部分。`] : []),
            ...(away.contact ? [`【${personWord(who)}之前发过／想说】${away.contact.way}：${away.contact.text}（这里只记了想联系，尚未确认递出）`] : []),
            ...(away.home ? [`【${personWord(who)}离开时住在】${away.home}`] : []),
            ...(away.matters?.length ? [renderPronouns("【〔当事人〕手上还开着的事】", { person: who }), ...away.matters.map(t => `· ${t}`)] : []),
        ] : []),
        '',
        renderPronouns("【〔当事人〕到场之前的几条（最后一条是旁白写到〔当事人〕出现）】", { person: who }),
        ...messages.map(m => `〔${m.name}〕${m.text}`),
    ].filter(Boolean).join('\n');
}

export function parseArrival(text) {
    const s = String(text ?? '');
    const a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a < 0 || b <= a) return null;
    try {
        const v = JSON.parse(s.slice(a, b + 1));
        const str = (x, n) => (typeof x === 'string' ? x.trim().slice(0, n) : '');
        const out = { how: str(v['怎么来'], 8), why: str(v['来由'], 200), saw: str(v['看到'], 300), meanwhile: str(v['这段时间'], 300), home: str(v['住处'], 60), where: str(v['在哪'], 120) };
        return out.why || out.saw ? out : null;
    } catch { return null; }
}

// 他进场后头一回、头两回开口的那一格里带上
const PHONE = /电话|消息|来电/;
export function arrivedLines({ who, how = '', why = '', saw = '', meanwhile = '', where = '', now = '', userName = '对方', sent = null, earlier = null }) {
    const phone = PHONE.test(how);
    return [
        ...(phone ? [remoteLine({ who, how, where, now, userName })] : []),
        ...(meanwhile ? [`离开这段时间${who}：${meanwhile}`] : []),
        `${who}刚${phone ? '接通' : '到这儿'}${how ? `（${how}）` : ''}${why ? `：${why}` : ''}`,
        // 没人接又来找的（main.settleAway 记的 earlier）：头一回那条说的是什么，这回是接着它来的
        ...(earlier?.surface ? [`${who}先前${earlier.way === '电话' ? '打过一回电话' : '发过一条'}，${userName}一直没回：${earlier.surface}${earlier.respond ? `（${personWord(who)}那回要说的：${earlier.respond}）` : ''}。这回是接着那件来的，那件还没说开。`] : []),
        // 旁白刚替他递出去的那条（场记章程 B1）：他自己发的、打的，接着这件说，不重发
        ...(sent?.surface ? [`${sentText(who, userName, sent)}${sent.respond ? `（${userName}接了、问起，这回别吊着：${sent.respond}）` : ''}。这是${who}自己刚${sentVerb(sent)}的，${userName}已经${sent.way === '电话' ? '听到' : '看到'}了：这一条接着这件往下说，别把刚才那条重发一遍。`] : []),
        saw ? `${phone ? (/消息|短讯|短信/.test(how) ? '隔着屏幕' : '电话里') : '到场那一刻'}看得见、听得见的：${saw}` : `${phone ? (/消息|短讯|短信/.test(how) ? '隔着屏幕' : '电话里') : '到场那一刻'}看得见、听得见的：照上面最后一段写的那样。`,
        `（之前这里说过的话、发生的事${who}没听见、没看见，只知道上面这些和${phone ? '接通' : '到场'}以后看见听见的。这是${who}${phone ? '接通' : '进场'}后头一回开口，可以先开口。）`,
    ];
}
// 发消息、打电话来的（D-169，试玩 10/6：口袋写的是发来一条消息，他两回都扛着东西走回了屋里）：人不在这儿。
// 放在他那一格最前面；他接着聊的每一格都带，直到他离场。他说过"回来时怎么样"的，等他真回来再说。
// 对方那头（试玩 10/7：她早下了车，他打电话过去写"背景里还是封闭车厢的气压声"，叫她把车开过来）：他看不见她在哪，上回知道的不一定还对
const thereLine = (how, userName, who) => /消息|短讯|短信/.test(how)
    ? `${userName}那头${personWord(who)}看不见也听不见：${userName}这会儿在哪、在干什么，${personWord(who)}只知道${userName}自己说出来的；${personWord(who)}上回知道的不一定还对，别替${userName}写那头的样子和动静。`
    : `电话里${personWord(who)}只听得到${userName}此刻那头真实的动静（照${userName}最后一段写的）；${userName}在哪${personWord(who)}看不见，${personWord(who)}上回知道的不一定还对，别照那个补。`;
// 远程的人那一格：玩家此刻实际在哪、什么样子——镜头知道的，他不知道（用户 10/7）。只给位置和看得见的样子，不给心事底细
export function playerThereLines({ who, userName = '对方', place = '', now = [] }) {
    const seen = [place ? `在${place}` : '', ...now].filter(Boolean);
    if (!seen.length) return [];
    return [`（${userName}此刻实际：${seen.join('；')}。这是镜头知道的，不是${who}知道的——${who}看见${userName}、听${userName}说了才算知道；${userName}走到${who}跟前了，${who}就看见了。别照${who}上回的印象替${userName}写在别处。）`];
}
// now：他接通以后那几条里写到的他那头的位置（此刻的样子读出来的），有就带上——他在他那头走动，不在镜头这间屋里（用户 10/8）
export const remoteLine = ({ who, how = '', where = '', now = '', userName = '对方' }) => `（${who}人不在这儿${where || now ? `，此刻在${[now ? String(where).replace(/^在/, '').split(/[，,；;]/)[0] : String(where).replace(/^在/, ''), now].filter(Boolean).join('，')}（以这个为准，${personWord(who)}那头和${userName}这儿不是一处）` : '，还在别处'}。${personWord(who)}是${/消息|短讯|短信/.test(how) ? '发消息' : '打电话'}来的：${/消息|短讯|短信/.test(how) ? renderPronouns("这一条只写〔当事人〕发过来的消息——屏幕上的几行字", { person: who }) : renderPronouns("这一条只写电话里〔当事人〕说的话、〔当事人〕那头听得见的动静", { person: who })}；别写${personWord(who)}回到这儿、走进门。${personWord(who)}说过回来时要怎样的，等${personWord(who)}真回来再说；要过来，得等${personWord(who)}真到了门口。${thereLine(how, userName, who)}）`;

// 他上一回离场在哪条：上下文隔离记的在场区间里，封上了的、在这一次进场之前的最后一段的末尾（第一次进场没有）
export function lastLeave(anchors, avatar, at) {
    const segs = (anchors?.[avatar]?.segments ?? []).filter(s => Number.isFinite(s?.to) && s.to <= at);
    const last = segs.reduce((x, s) => (!x || s.to > x.to ? s : x), null);
    return last ? last.to : null;
}
// 刚移出就原地拉回来（用户 10/14）：离场那一段的结尾就在眼下（移出以后删过几条的，结尾比眼下靠后一点，至多 3 条）——中间没有新消息，他没走开
export function justLeft(anchors, avatar, len) {
    return (anchors?.[avatar]?.segments ?? []).some(s => Number.isFinite(s?.to) && Number.isFinite(s?.from) && s.to > s.from && s.to >= len - 1 && s.to <= len + 3);
}
// 这个人眼下在不在场：隔离扩展没记过他（一直在）、或者有一段还开着
export const openNow = (anchors, avatar) => { const segs = anchors?.[avatar]?.segments; return !segs?.length || segs.some(s => s?.to == null); };
// 他离场时记下去向（D-169，用户 10/6：他说了去二手摊、去别的区、找房，后台却在他出门一句之后就让他回来）：
// 照他走前那几句，便宜模型理出要去办的事、大概多久、怎么回来。存着，回来的时机、回来时这段时间干了什么都照它。
export const LEAVE_SYSTEM = [
    "一部长篇角色扮演里，有个角色刚离开这个场面（出门、挂断、走开）。照〔当事人〕走前那几句，替后台记下〔当事人〕的去向：",
    "1. 去办：〔当事人〕说了要去办的事，按先后，一件一句；没说就照这几天〔当事人〕手上的事和〔当事人〕这个人，写最可能的一两件。只记〔当事人〕自己去办的：〔当事人〕叫别人（玩家）去做的事不是〔当事人〕的去办。别编大事、别编新的人和东西。",
    '2. 多久：办完这些大概要多久，从这几个里挑：一会儿（几分钟到半个钟头）／一两个钟头／半天／到晚上／明天／说不准。',
    "3. 怎么回来：〔当事人〕说了还回不回来、怎么回来，从这几个里挑：上门／消息／电话／不回来／没说。说了回来时的具体做法（比如进门前先怎样），照原话写在\"回来时\"里，没说就留空。",
    '只输出一个 JSON：{"去办": [""], "多久": "", "怎么回来": "", "回来时": ""}',
].join('\n');
export function leavePrompt({ who, userName = '玩家', messages = [] }) {
    return [`【离开的人】${who}`, `【留下的玩家角色】${userName}`, '', renderPronouns("【〔当事人〕走前的几条（最后几条里〔当事人〕离开）】", { person: who }), ...messages.map(m => `〔${m.name}〕${m.text}`)].join('\n');
}
const SPANS = ['一会儿', '一两个钟头', '半天', '到晚上', '明天', '说不准'];
const BACKS = ['上门', '消息', '电话', '不回来', '没说'];
export function parseLeave(text) {
    const s = String(text ?? '');
    const a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a < 0 || b <= a) return null;
    try {
        const v = JSON.parse(s.slice(a, b + 1));
        const errands = (Array.isArray(v['去办']) ? v['去办'] : []).filter(x => typeof x === 'string' && x.trim()).map(x => x.trim().slice(0, 80)).slice(0, 5);
        const pick = (x, list, d) => list.find(k => String(x ?? '').includes(k)) ?? d;
        return { errands, span: pick(v['多久'], SPANS, '说不准'), back: pick(v['怎么回来'], BACKS, '没说'), backLine: typeof v['回来时'] === 'string' ? v['回来时'].trim().slice(0, 80) : '' };
    } catch { return null; }
}
// 两个时刻之间隔了几个时段（{ day, part }；时段不认得就只按天算）
export function partsBetween(a, b, parts) {
    const days = (b?.day ?? 0) - (a?.day ?? 0);
    const i = parts.indexOf(a?.part), j = parts.indexOf(b?.part);
    return days * (parts.length || 1) + (i >= 0 && j >= 0 ? j - i : 0);   // 一格里不分时段的（小时尺度）：一格算一段
}
// 他这会儿走到哪一步了（plan＝去向；left、now＝离开那条和眼下的 { day, part }；since＝离开以后过了几条）：
// early 同一个时段里——不主动拉他回来（用户 10/6 定的；他自己说了"一会儿就回"的，隔几条可以回）；
// out 在外头办事——只能发消息、打电话来；due 办得差不多了——可以回来，说了回来的由旁白带他回来。
export function awayStage(plan, left, now, since, parts) {
    if (plan?.errands?.length && plan.errands.every(e => ['办了', '没办成'].includes(e?.done))) return 'due';
    const gone = partsBetween(left, now, parts);
    const quick = plan?.span === '一会儿' && plan?.back !== '不回来';
    if (gone <= 0 && !(quick && since >= 6)) return 'early';
    if (!plan) return 'due';
    const nowAt = parts.indexOf(now?.part);
    const done = plan.span === '一会儿' ? true
        : plan.span === '一两个钟头' ? gone >= 1
        // 时段不是一天里那几段（按年、按月走的局，章程 G2）：到晚上、明天都算过了一段就办完
        : plan.span === '到晚上' ? (now?.day ?? 0) > (left?.day ?? 0) || (parts.includes('晚上') ? nowAt >= parts.indexOf('晚上') : gone >= 1)
        : plan.span === '明天' ? (now?.day ?? 0) > (left?.day ?? 0) || (!parts.includes('晚上') && gone >= 1)
        : gone >= 2;
    return done ? 'due' : 'out';
}
// 发消息、打电话来的人和玩家当面碰上了（试玩 10/7：她走到他等着的那条街，他认出她迎上去截住她）：从那条起他就在这儿，不再是远程。
// 认的是一类样子，不是几种说法（用户 10/7："现在两人已经见面了，但场记里还写着他不在这儿是在发消息"——他写的是"停在离你半步远的位置"、
// 伸手截住她的手腕，她写的是"在你面前转了一圈"，一种都没对上）：
// 叙述里人就在对方跟前、身边（离你半步、在你面前）、碰到了对方（攥住你的手腕、把你拽进怀里）；或者"此刻的样子"那一步读出来的位置写着他在她跟前。
// 只看括号里的叙述，一段一段看：写着屏幕、语音、终端、消息的那段不算（隔着屏幕看见、发过去的话）。messages：他接通以后的那几条
const NEAR = '(?:跟前|面前|身前|身边|身旁|旁边|身后|正前方|前头|怀里)';
const DIST = '(?:半步|一步|两步|几步|一臂|一拳|咫尺|一米|两米)';
const TOUCH = '(?:攥|握|抓|扣|拽|拉|搂|抱|摸|碰|拍|揉|捏|按|扶|托|捂|揽|牵|截住|贴上|覆上)';
const BODY = '(?:手|腕|肩|脸|头|发|后颈|脖|胳膊|臂|腰|背|下巴|额|指|掌)';
// 不带身上哪儿的只认抓牢、拽进来这种（"按你说的""拉你下水"不算）
const HOLD = '(?:攥|握|抓|扣|拽|拉|搂|抱|揽|牵|截)(?:住|进)';
const FAR = /屏幕|全息|投影|视频|画面|照片|终端|通讯|语音|听筒|消息|短讯|短信|电话|HUD|镜头里/;
const HE_MET = new RegExp([`你(?:的)?${NEAR}`, `离你[^，。；！？]{0,4}${DIST}`, `${TOUCH}[^，。；！？]{0,6}你(?:的)?${BODY}`, `${HOLD}(?:了)?你`, `把你[^，。；！？]{0,2}${TOUCH}`,
    '截断了你的去路', '拦住(?:了)?你', '挡住(?:了)?你的(?:路|去路)'].join('|'));
// "此刻的样子"里他（或她）的位置、在做：写着对方的名字，又是跟前、身边、半步、替对方挡着这类
const NOTE_NEAR = new RegExp(`${NEAR}|${DIST}|挨着|并肩|对面|替[^，。；]{0,8}挡|${TOUCH}`);
const escape = n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// others：屋里别的人的名字——玩家叙述里点了别人的名、没点他的那一小段，里面的"他"是别人（D 副本 10/16："祁渊走了出去，门在他身后合上"把发消息来的那位算成了当面在场）
export function metInPerson(messages, { who, names = [], userName = null, notes = [], since = null, others = [] } = {}) {
    const his = [who, ...names].filter(Boolean);
    const other = (others ?? []).map(String).filter(n => n && !his.includes(n) && n !== userName);
    const aboutOther = b => other.some(n => b.includes(n)) && !his.some(h => b.includes(h));
    const blocks = t => String(t ?? '').match(/（[^）]*）|\([^)]*\)/g)?.filter(b => !FAR.test(b)) ?? [];
    const them = his.length ? `(?:你|他|${his.map(escape).join('|')})` : '(?:你|他)';
    const SHE_MET = new RegExp([`${them}(?:的)?${NEAR}`, `离${them}[^，。；！？]{0,4}${DIST}`, `${TOUCH}[^，。；！？]{0,6}${them}(?:的)?${BODY}`, `${HOLD}(?:了)?${them}`, `把${them}[^，。；！？]{0,2}${TOUCH}`].join('|'));
    if (messages.some(m => blocks(m.text).some(b => !(m.is_user && aboutOther(b)) && (m.is_user ? SHE_MET : his.includes(m.name) ? HE_MET : null)?.test(b)))) return true;
    // 位置那一步（模型读过原文）写的：他在她跟前，或者她在他跟前
    const from = since ?? (messages[0]?.pos ?? Infinity);
    return notes.some(n => (n.pos ?? -1) >= from && !FAR.test(n.text ?? '') && NOTE_NEAR.test(n.text ?? '')
        && ((his.includes(n.who) && !!userName && String(n.text).includes(userName)) || (!!userName && n.who === userName && his.some(h => String(n.text).includes(h)))));
}
// 在 pos 这条时，哪些人是"远程"（场记章程第 2 条）：打电话、发消息进来的人隔离区间也开着，只看区间会被算成当面在场——
// 玩家屏幕上收到的别人的消息、玩家身边的动静、括号里的动作，他全"知道"了。远程的人只听得见玩家说出口的和他自己那头的。
// 认法和场面表（board.mjs）一致：盖住 pos 的那段区间是从一次怎么来为电话／消息的进场开的（进场的 at 就是段的 from，指纹对得上），
// 那之后没有当面进场、也没在正文里当面碰上；用户在那条上纠正过（"远程""在场"）的，以纠正为准。
// arrivals：进场记录（arrivals:${chatKey}）；anchors：隔离区间；members：[{ avatar, name }]；messages：当前消息（有就核指纹、看当面碰上和纠正）
// 返回名字集合；要分电话还是消息用 remoteWayAt
export function remoteAt(pos, opts = {}) { return new Set(remoteWayAt(pos, opts).keys()); }
// 同上，返回 Map：名字 → '电话' | '消息'（隔着电话的，话筒收得到那头所有说出口的话；隔着消息的只收得到玩家对他说的、他自己说的）
export function remoteWayAt(pos, { arrivals = [], anchors = null, members = [], messages = null, userName = null, notes = [] } = {}) {
    const out = new Map();
    const entries = (Array.isArray(arrivals) ? arrivals : Object.values(arrivals ?? {})).filter(e => e && Number.isFinite(Number(e.at)));
    const list = messages ? [...messages].sort((a, b) => (a.pos ?? 0) - (b.pos ?? 0)) : null;
    const fpOk = e => !list || list.find(m => m.pos === Number(e.at) - 1)?.fp === e.fp;
    const user = userName ?? (list ? [...list].reverse().find(m => m.is_user && m.name)?.name ?? null : null);
    const marks = (list ?? []).filter(m => m.pos <= pos && m.boardMark).map(m => {
        try { const v = typeof m.boardMark === 'string' ? JSON.parse(m.boardMark) : m.boardMark; return v?.people ? { pos: Number.isFinite(Number(v.pos)) ? Number(v.pos) : m.pos, people: v.people } : null; } catch { return null; }
    }).filter(Boolean);
    const near = list ? notes.filter(n => (n?.pos ?? Infinity) <= pos && list.some(m => m.pos === n.pos)) : [];
    for (const member of members) {
        if (!member?.name) continue;
        const seg = (anchors?.[member.avatar]?.segments ?? [])
            .filter(s => Number.isFinite(Number(s?.from)) && Number(s.from) <= pos && (s.to == null || pos < s.to)).at(-1) ?? null;
        let remote = false, since = null, way = '消息';
        if (seg) {
            since = Number(seg.from);
            const mine = entries.filter(e => (member.avatar && e.avatar === member.avatar) || e.who === member.name);
            const openers = mine.filter(e => Number(e.at) === since && isRemote(e.how) && fpOk(e));
            const opened = openers.length > 0;
            way = openers.some(e => /电话|来电/.test(e.how ?? '')) ? '电话' : '消息';
            const faced = mine.some(e => Number(e.at) > since && Number(e.at) <= pos && !isRemote(e.how) && fpOk(e));
            const met = opened && !faced && !!list && metInPerson(list.filter(m => m.pos >= since && m.pos <= pos), { who: member.name, userName: user, since, notes: near });
            remote = opened && !faced && !met;
        }
        const mark = marks.filter(k => Object.prototype.hasOwnProperty.call(k.people, member.name)).at(-1);
        if (mark && (since == null || mark.pos >= since) && ['在场', '远程', '外头', '不在'].includes(mark.people[member.name])) remote = mark.people[member.name] === '远程';
        if (remote) out.set(member.name, way);
    }
    return out;
}

// 玩家这句里叫他（N-297：发消息、打电话给他，或者直接叫他过来）：叙述（括号里）点了他的名，又写着玩家主动去发、打、拨、回他。
// 一小句一小句认（场记章程第 11 条，试玩 10/10："没回他的消息"被当成玩家在联系他）：
// 带"没回、没接、不回、没理、没看"的那句不算；"他的消息、他发来、他打来"是收到的，不算；只有"给他发、回他、打给他、拨"才算
const NOT_CALLING = /没回|没接|不回|不接|没理|不理|没搭理|不搭理|没看|不看|未回|未接|懒得回/;
const esc = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const B = '[^，。！？；,!?;]';
const HIT = '打(?![听算量扮扰字开探])';
export function callsFor(narration, names) {
    const t = String(narration ?? '');
    const ns = (names ?? []).filter(Boolean).map(String);
    if (!ns.some(n => t.includes(n))) return '';
    for (const part of t.split(/[，。！？；,!?;\n]/)) {
        const hit = ns.filter(n => part.includes(n));
        if (!hit.length || NOT_CALLING.test(part)) continue;
        for (const n of hit.map(esc)) {
            if (new RegExp(`(?:打给|拨给|拨通了?|打通了?|拨了?)${B}{0,2}${n}|给${n}${B}{0,6}(?:${HIT}|拨)|给${n}${B}{0,6}回${B}{0,4}电话|(?:${HIT}|拨|回)了?${B}{0,2}${n}的?${B}{0,4}(?:电话|号码|号)|(?:给|和|跟)${n}${B}{0,4}视频`).test(part)) return '打来电话';
            if (new RegExp(`给${n}${B}{0,8}(?:发|回)|发给${n}|回(?:复|了|复了)?${n}${B}{0,6}(?:消息|短讯|短信|信息)|回复了?${n}`).test(part)) return '发来消息';
        }
    }
    return '';
}

// 离开到现在过了多久（剧情日、时段；a、b＝那两条的 { day, part }）。timeScale：这一局的尺度，"过了 3 年""同一年"（章程 G2）。
export function awaySpan(a, b, timeScale = DAY) {
    if (!a || !b) return '';
    const ts = scaleOf(timeScale);
    const days = (b.day ?? 0) - (a.day ?? 0);
    const same = ts.unit === '天' ? '同一天' : `同一${ts.word === '个月' ? '个月' : ts.word}`;
    if (days > 0) return `过了 ${ts.span(days)}${a.part || b.part ? `（${a.part || '?'}走的，现在${b.part || '?'}）` : ''}`;
    return a.part && b.part && a.part !== b.part ? `${same}，${a.part}走的，现在${b.part}` : `${same}，没过多久`;
}

// 完成标记也认结算那条的指纹：删改后恢复成原来的去办，不让旧结果留在事账里。
export function validAwayPlan(plan, messages) {
    // 记这份去向时的最后一条删了：这份去向就没了（试玩 10/7：删掉的那一版里记的"回去喝汤"一直挂着，进场那份照它写了"还没顾上去喝热汤"）
    if (plan?.fp && Number.isFinite(Number(plan.at)) && !messages.some(m => m.pos === Number(plan.at) - 1 && m.fp === plan.fp)) return null;
    // 他人到场、用掉了这份去向的那次进场还算数（他那条回复还在、或者正在写）：没了；那次进场不算了，去向回来（方案 删消息等于没发生过）
    if (plan?.dropped && arrivalLive(plan.dropped, [...messages].sort((a, b) => a.pos - b.pos))) return null;
    if (!plan?.errands) return plan;
    return { ...plan, errands: plan.errands.map(e => e?.settled && !messages.some(m => m.pos === e.settled.pos && m.fp === e.settled.fp) ? e.text : e) };
}
