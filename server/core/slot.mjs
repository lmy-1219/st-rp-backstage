import { personWord, renderPronouns, playerWord, playerContext } from './pronoun.mjs';
import { registerPromptDefaults, promptText, promptOptionsFor, DEFAULT_TIER, DEFAULT_PACK } from './prompt-slots.mjs';
// 发言前给当前角色的那一格材料。
// 同一窗口、同一角色、同一段上文 ⇒ 同一格（钉住），这样左滑重生成、换模型对比时材料不变（白皮书 §9.1-3）。
// 内容：程序按这个角色知道的记录挑材料（recall.mjs）；开了叙事组装就让模型把相关旧事串成线（assemble.mjs），
// 组装失败或超时退回纯程序那一格，且不钉住（下次再试）。"接线测试"开着时换成一句测试话。
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { selectMaterial, renderPlain, finish, dayIndex, relativeDay, timeSkipIn, expiredTodo, placeRecall, faceRecall, recordKnownTo } from './recall.mjs';
import { isPrivate } from './visibility.mjs';
import { renderNarrative, narrativeState } from './assemble.mjs';
import { matchPrices, priceLines, talksMoney, talksJobs, tiersNamed, tierPrice, standingLines, scopeOf, planPriceLines, matchHousing, housingLines } from './pricing.mjs';
import { buildLedger, moneyLines, amountsIn, balanceLines, balances, namedParties } from './money.mjs';
import { absentPeople, pickContact, contactLines } from './contacts.mjs';
import { detectGap, absenceMarks, attemptsDuring, returnLines, returnCarry, phoneCarry, dueReturn } from './absence.mjs';
import { awayLines, awayBrief, awayCarry } from './away.mjs';
import { rollDice, motifLedger } from './dice.mjs';
import { carryParts, lingerLines, afterLines, cueLine, pocketCarry } from './mood.mjs';
import { impulseLines, IN_PLACE, looseEnds, STAY_STATES, stillThere } from './scene.mjs';
import { profileParts } from './profile.mjs';
import { senseScores, textKey } from './vectors.mjs';
import { onwardLine, absentAskLine, takenLine, moldOf, varyLine, lastEchoes, scopeLine, bodyHarping } from './pace.mjs';
import { bodyGate, bodyGuard, herTrouble } from './body.mjs';
import { crewOf, crewEntry, latestNode, crewLines, pushedText, crewPushDue, pushedMeta, keyPersonEntry, mindLine } from './crew.mjs';
import { warmWords } from './tone.mjs';
import { keepWay, wayOnly } from './fresh.mjs';
import { factionLedger, factionSlotLines, factionBrief, nameResolver, samePerson } from './factions.mjs';
import { situationNow, moveLive, situationPrompt, deliverDue, situationSlotLines, situationBrief, repLines } from './situation.mjs';
import { closeness, roleOf, BOND_DEFAULT, mentionedIn } from './cast.mjs';
import { slotLines, sameName, reserveOpen, toText as setupText, backstoryText, staleBackstory, knowsRow, heldBackstory, activeIntimate, checkIntimate } from './setup.mjs';
import { heldLines, saidSince, activeLeaks, withSecretLeaks, secretLeakLines } from './held.mjs';
import { openingLines, bodyRows, OPEN_SCENE } from './opening.mjs';
// 规划简报里的主角团、还没下文的口子（章程 K1）
import { crewTies } from './relations.mjs';
import { openGaps, CLOSE_UNITS, intimatePair } from './planner.mjs';
import { toText as relationsText } from './relations.mjs';
import { normalizeRelations, slotLines as relationLines, leaderOf, followersOf, personOf, givesWork, giverLine, mentionLines, currentRelations } from './relations.mjs';
import { pickSeed, seedLines, storyYear } from './world.mjs';
import { NOW_MOTIF, placesIn, buildBrief, needsPlan, stepPocket, stackedHere, reachedFor, pocketLines, respondLines, shownLines, sinkLines, storyDigest, WORLD, OFFSCREEN_FIT, entryOf, nearPlace, timePassed, offscreenLines, errandLines, ifTakenOf, ifSunkOf, takenOf, expiredPocket, premiseGone, storyLayers, layerNote, briefBlocks, BRIEF_CHARS, BRIEF_SHARES, UNSQUEEZED, categoryCounts, draggingLines, overdueAhead, LOOKBACK_PLANS } from './planner.mjs';
import { foldState, stateLines, herOwnOnly } from './state.mjs';
import { timeline, clockNow, dateIn, dayNumber, weekdayIndex, PARTS, withNoteMarks, timeTag } from './timeline.mjs';
import { scaleOf, DAY } from './timescale.mjs';
import { paceOf } from './tempo.mjs';
import { promiseOf, stageOf, promiseLines, relatedTo, retime, partyOf, LAPSED, settledTwins, settledByDoing, dueOf } from './promises.mjs';
import { offstageFacts, reachDeliveries, asksAway, replyLines } from './offstage.mjs';
import { matchFacts, factLines, planFactLines } from './facts.mjs';
import { driftItems, longGive, activeLong } from './drift.mjs';
import { episodeLines, asksPast, EPISODE_CHARS } from './episodes.mjs';
import { lifeSheet, lifeLines, homeLines, ownHomeLines, seedOf } from './life.mjs';
import { hasCard, arrivedLines, isRemote, remoteLine, playerThereLines, validAwayPlan, remoteAt } from './arrival.mjs';
import { boardFor } from './board.mjs';
import { pendingFor } from './pending.mjs';
import { doorFor, doorLines } from './door.mjs';
import { stepWaits, dropTry } from './waiting.mjs';
import { enteredSince, emptySegment } from './landing.mjs';
import { settleMatters, mattersFor, sharedMatter, matterLines, matterBrief, PURSUE, closeLed, closeIntents, handOf, stageLines, LEAD, INTENT, closeDue, lapseMatters, gapSteps } from './matters.mjs';
import { optionsFor } from './options.mjs';
import { findSkip, liveSkips, settleSkip, skipDays, skipPromptLines, firstAfterSkip, skipLines, SKIP_MISSED, skipEvents } from './skip.mjs';
import { applyMoves, movesOf, eventStep, leadNotice, moveEvent, echoEvent, markEchoed } from './eventlead.mjs';
import { bareText } from './records.mjs';
import { pairImpressions } from './impressions.mjs';

// 钉住的那一格只在同一版后台代码里算数（试玩 10/1：删回去重新生成，拿到的是几小时前旧代码钉住的那一格——没有约定、口袋还在最后）。
// 代码指纹＝core 下各 .mjs 的内容；更新以后左滑重来会重新组一格（开了叙事组装就多一次组装的钱）。
export const SLOT_CODE = (() => {
    try {
        const dir = new URL('.', import.meta.url), h = createHash('sha256');
        for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.mjs')).sort()) h.update(fs.readFileSync(new URL(f, dir)));
        return h.digest('hex').slice(0, 12);
    } catch { return 'dev'; }
})();

// 放在提示词开头的系统块里，告诉前台模型怎么读那一格（J-42：读法句进开头，格子放末尾）：READING_RULE、SPLIT_RULE 见下。
export function wrap(text) {
    return `【场记】${text}`;
}

// 那一格分几块、各放哪（9/29 体检，用户：有些该靠近末尾，有些该在开头交代；10/1 用户：背景放聊天之前，口袋放最近两轮之前；
// 10/2 用户：想起的、这一轮也放到最近四条之前——放在玩家那句后面时，前台读完它就回头接上一下的场面，不接玩家的问话）：
//   base   开头——这一局里他的底子（说好的规矩、开局单里他的口径和知道的前事、地盘、和在场的人的关系），
//          后面跟着这阵子的背景（back：势力账、听说的、世界的底色、没过去的心事）：跟在主提示词后面、聊天之前；
//   mid    中段——幕后口袋（后台排的、由他挑时候的事）：插在倒数第四条之前（最近两轮之前）；
//   recall 也在倒数第四条之前——和眼下这句话有关、想起来的（旧事、现状、行情、说到的人）；
//   now    也在倒数第四条之前——这一轮的事（今天说好的、回来、玩家伸手接了的、兴头、有人来找、玩家这阵子想要的、怎么接的提醒）。
// 原来整格都在最后：背景和旧事排在玩家那句话后面、占着最显眼的位置，前台容易每件都去碰，真要紧的那几行反被冲淡；
// 口袋放在最后时前台拿到就用（试玩 10/1：说好去老维那儿的早上，口袋里的中介、房东先进了场）。
export const PLACES = ['world', 'base', 'mid', 'recall', 'now'];
// 场记是素材，不是提纲（用户 10/1：角色不是报幕的主持人；他有自己的选择，可以瞒、可以说谎，但有后果）
const MATERIAL_NOT_SCRIPT = '这些是他手边的素材，不是要他照着念、照着办的提纲：他按自己的性子、处境和眼前的场面取舍——可以不提、晚点提、只说一半、瞒着不说，甚至说假话（那也是他做过的事，会被记下，往后有后果）。别把场记里的事一件件转述给对方，也别替对方安排下一步。';
// 能编的和不能动的（N-279，用户 10/2：补全、瞎编要用在临时的小事、环境、姿态、念头、对已有的事的个人解读上，不是把写过的改得前后矛盾——
// 试玩：开自己的车来的转头成了"叫了那辆烂皮卡的车台"，设定"将近半年陆续划走"嘴里成了"半个月抽空"）。和上面"可以说假话"分开：说假话得是他有理由瞒。
const FACTS_FIXED = '分清能编的和不能动的：前文写过的、场记和设定里写明的人和事——谁、什么时候、多少、什么东西、在哪——照原样；能放开编的是临时冒出来的小事、环境和天气的变化、姿态动作、一闪而过的念头，和他对已有的事有自己的看法。前文没交代过的细节可以补，补了就算定下了。他要瞒、要说假话，得是他有理由瞒，不是顺嘴把数目、时间、东西说岔。被问到、说起以前发生过的事：场记和上文里有的照着说；都没有的那部分（谁说了哪句、名字、数目、在哪），他记不清——可以说记不清、反问、只说个大概，别编出来。';
export const READING_RULE = `对话里偶尔会出现以【场记】开头的一段：那是只给当前发言角色看的背景材料，不是任何人说出口的话。用得上就自然地用，用不上就当没看见。${MATERIAL_NOT_SCRIPT}${FACTS_FIXED}不要复述它，也不要回应它。`;
export const SPLIT_RULE = `对话前后会出现几段以【场记】开头的文字：都是只给当前发言角色看的材料，不是任何人说出口的话。写着"底子"的一直算数；别的用得上就自然地用，用不上就当没看见。${MATERIAL_NOT_SCRIPT}${FACTS_FIXED}都不要复述，也不要回应。`;
export const BASE_CHARS = 900;
// 想起的那一块（旧事，加上放在那里的几行）：平常／玩家在问以前的事时（不含场次经过——那块另算，见 episodes.EPISODE_CHARS）
export const RECALL_CHARS = 1200, RECALL_CHARS_ASKED = 3000;
// 那一格跟着 ST 的上下文走（N-288，用户 10/5："随ST内设置的模型最大上下文按比例动态分配……常驻的不变，缩小召回的范围"）。
// room＝扩展传来的：tokens（这一次能发多长＝上下文减回复长度，ST 给的）；lastChars／lastTokens（上一次实际发出去的总长，字数和 token 数）、
// lastOurs（其中后台这几块的字数）。想起的、场次经过按 tokens 和 REF_ROOM 的比例放宽或收窄（底子、这一轮这些常驻的不动）；
// 上一次实际发出去的量得到时，再按剩下的空间收一收——别让 ST 为了塞下后台的材料去砍聊天记录。上限只是天花板，相关的才给。
export const REF_ROOM = 28000;   // 以前那几个长度是照这么大定的（32k 上下文、回复留 4k）
const SCALE_MIN = 0.5, SCALE_MAX = 4, GROWTH = 3000, KEEP = 0.92;
export function roomFit(room) {
    const tokens = Number(room?.tokens);
    if (!(tokens > 0)) return { s: 1, spare: null };
    let s = Math.min(SCALE_MAX, Math.max(SCALE_MIN, tokens / REF_ROOM));
    const chars = Number(room.lastChars), used = Number(room.lastTokens), ours = Math.max(0, Number(room.lastOurs) || 0);
    let spare = null;
    if (chars > 0 && used > 0) {
        const perToken = Math.min(3, Math.max(0.6, chars / used));
        // 能给后台这几块的字数：这一次能发的，减去上一次除了后台以外的（卡、世界书、预设、聊天），再给新来的那两条留点
        spare = Math.round(tokens * perToken * KEEP - (chars - ours) - GROWTH);
        s = Math.min(s, Math.max(SCALE_MIN, (spare - BASE_CHARS - SLOT_CHARS) / (RECALL_CHARS_ASKED + EPISODE_CHARS)));
    }
    return { s: Math.round(s * 100) / 100, spare };
}
const HEADS = {
    base: name => `【场记】这一局里${name}的底子（一直算数，不用特意提起）：`,
    // 单纯的背景（这阵子外面的事、各方的账、世界的底色）放在角色定义之前；他心里、手上还挂着的跟着底子（用户 10/5，照 ST 文档：影响角色怎么做的放在角色定义之后，单纯的背景放在之前）
    world: name => `【场记】这阵子外面的背景（${name}知道的；单纯是背景，对不上眼下的场面就当没看见）：`,
    back: name => `【场记】${name}这阵子心里、手上还挂着的（对不上眼下的场面就当没看见）：`,
    mid: name => `【场记】${name}手边备着的事（只给${personWord(name)}；不是任何人说出口的话）：`,
    now: name => `【场记】眼下这一轮（只给${name}）：`,
};

// 镜头（N-276，用户 10/2）：玩家一个人的时候（群里的人都静音了），系统建的"旁白"卡开口写周围的动静。
// 那张卡只是让酒馆能生成的载体：扩展把它写的消息记成 narrator（和 /sys 旁白一样），后台不把它当人——不读卡、不记它的账、不排它的关系。
// 它照玩家的眼睛看：玩家知道的旧事、此刻的样子、今天说好的事、口袋里没人在场牵头的事、不在场的人来联系；不写玩家心里想什么，不替玩家说话拿主意。
export const CAMERA = 'narrator';
export const CAMERA_NAME = '旁白';
// others：用 /旁白 时身边还有人——他们的话和动作是他们自己的，镜头不替他们写
// 有卡的人在场时旁白也接一手（场记章程 #7、B4，camera-turn.mjs 判要不要接）：这一轮只写没卡的人和周围，有卡的人刚说的不重复、不替他们接
// 用户 10/6（N-292）：镜头只管环境、场面和没卡的人（路人、店里的人、来搭话的生人），这些人它可以一来一回接着演；
// 有卡的人不归它——要来就只写到他出现为止（门被推开、终端响了），由他自己的卡进场接戏。cards：名册里有卡的人
// D-169（用户 10/6："旁白应该是第三人称写环境和 NPC"；选了叙述里对玩家用"你"）：旁白卡是空的，以前这些只在聊天中间一段提醒里，
// 上文全是各人用"我"写的，旁白照着写成了某个人的"我"。现在这是旁白的定义，放在"角色定义之后"那块（对旁白就相当于它的卡），
// 聊天中间只留一句短的（cameraNudge）。称呼旁白用"旁白"，免得和"正文里称玩家为'你'"混在一起。
export const cameraRule = (name, others = [], { cards = [] } = {}) => [
    `【场记】旁白是谁（一直算数）：旁白是这场戏的镜头，不是戏里的哪个人，跟着${name}的眼睛看。${others.length ? `${name}身边有${others.join('、')}——他们的话和动作由他们自己来，旁白不替他们写。这一轮只写没卡的人的回应和周围的动静，有卡的人刚说的话不重复、不替他们接。` : `${name}这会儿身边没有别人。`}`,
    `· 写什么：${name}周围看得见、听得见的——天气和光线、这地方的样子、近处远处的动静；这里没有卡的人：路人、店里的人、来搭话的生人、找上门的陌生人、捎来的话和消息（按这个世界说得通的方式）。没卡的人由旁白来演，说什么、做什么都可以写，可以一来一回接着往下演，同一个人前后一致（长相、说话的样子、前面说过的话）。但他们是这地方的一部分，不是主角：一次说一两句、做一个动作，不发长篇，不一口气把事说完，留着让${name}问。`,
    `· 怎么写：叙述放在括号里。正文里称${name}为"你"；别的人、这地方用第三人称。旁白没有"我"——叙述里不出现"我"，不用谁的口吻、不从谁的眼睛里写。没卡的人开口，话放在引号里，写清是谁说的。聊天记录里各人用"我"写的是他们自己的视角，旁白别跟着学。`,
    `· 不写什么：${cards.length ? `有自己卡的人（${cards.join('、')}）` : '有自己卡的人'}的话和动作，一个字都不替他们写；他们要来，写到他出现之前就停。${name}的话、心思和决定是${name}自己的：不替${name}说话，不写${name}心里想什么，不替${name}拿主意、动手；旁白写的是这个世界和这些人对它的回应。`,
    `· 要紧的事不编：有名有姓的新人、具体的地址和门路、价钱、哪个势力在干什么、谁在找谁——场记里没给的别造。${name}问起场记里没有的，让人答得含糊（"认识个人，回头给你地方"）或者答不上，后面自会有安排。能编的只是眼前的小东西：光、声音、一个路人、一句搭腔。`,
    `· 写到哪停：写到${name}能接话的地方就停；篇幅跟着${name}走——${name}写两句，旁白三五句就够，不比${name}写得多。抓${name}这句里的事回应，别顺着自己上一条往下铺；没卡的人答了就停，不替${name}总结局面、不抒情。没什么事就写一小段安静的此刻，别硬造事。`,
    '样子（只看写法，内容照眼下的场面）：',
    '（雨顺着窗缝往下淌。楼道里有人拖着箱子走过，轮子磕在门槛上，停了一下，又走远了。你屋里只剩那台机器低低地响。）',
    '（门外响了两下。）"送东西的，"门外那人隔着门喊，"签个字。"',
].join('\n');
export const cameraNudge = name => `（旁白：叙述用第三人称，正文里称${name}为"你"，不出现"我"；有卡的人不替他写。）`;
// 卡里这份不随场面变化；在场名单仍由每轮的 cameraRule 给。
export const cameraCardPrompt = () => ({
    system: [
        '你是这场戏的镜头（旁白），不是戏里的人，跟着玩家的眼睛看。',
        '写玩家周围看得见、听得见的：天气和光线、这地方的样子、近处远处的动静、捎来的话和消息。没有卡的人由旁白来演，可以一来一回接着往下演，同一个人前后一致；但他们是这地方的一部分，不是主角：一次说一两句、做一个动作，不发长篇，不一口气把事说完。',
        '叙述放在括号里，正文里称玩家为"你"，别的人和这地方用第三人称。旁白没有"我"，不沿用聊天记录里各人的第一人称视角。没卡的人开口，话放在引号里，写清是谁说的。',
        '有自己卡的人的话和动作不替他们写；他们要来，只写到他出现为止。不替玩家说话、想心事、拿主意或动手，只写周围对玩家的回应。',
        '要紧的事不编：有名有姓的新人、具体的地址和门路、价钱、势力的动向、谁在找谁，场记里没给的别造；玩家问起没有的，让人答得含糊或答不上。能编的只是眼前的小东西。',
        '写到玩家能接话的地方就停；篇幅跟着玩家走，玩家写两句，旁白三五句就够。抓玩家这句里的事回应，别顺着自己上一条往下铺。没什么事就写一小段安静的此刻，别硬造事。',
    ].join('\n'),
    phi: '（旁白：叙述用第三人称，正文里称玩家为"你"，不出现"我"；有卡的人不替他写。）',
});
// 旁白"别碰这些人"那张单子：这局出现过的有卡的人，加门的名单里的（D-175：不再把十几个从没出场的人都摆上）
function cameraCards(store, records, { chatKey, storyId, anchor, present, recentUser, contacts, planner }) {
    const cards = (store.getCast?.(storyId) ?? []).filter(e => hasCard(e) && e.name !== CAMERA_NAME);
    let seen = null, door = [];
    try { seen = boardFor(store, records, chatKey, { anchor, present }).people; } catch {}
    try { door = doorFor(store, records, chatKey, { anchor, present, recentUser, contacts, planner }).items.map(i => i.who); } catch {}
    return (seen ? cards.filter(e => door.includes(e.name) || seen.some(p => p.name === e.name && p.status !== 'never')) : cards).map(e => e.name);
}
// 进场的事在镜头那一格里留多久、进场的人头几回开口带着来由（条）
const ARRIVAL_SPAN = 8;
// 每轮检查顺带看的"这一轮各人做的、说的"（D-170）：会不会在外头发酵
const ACTS = new Set(['做', '说', '钱', '改变']);

function testContent({ speakerName, total }) {
    return `（接线测试）这一格只给「${speakerName}」。后台已收到这个窗口的 ${total} 条消息。`;
}

// 同一窗口、同一角色、同一句用户的话 ⇒ 组装一次就够（一轮里别人先开口、上文变了，旧事还是那些）。
// 第一个角色要格子时，就替在场的其他角色也先组装上，轮到他们时现成（组装一次十几秒，挨个等太慢）。
// 用户那句话的检索词也是一轮一份，所有角色共用。
const ahead = new Map();
const AHEAD_TTL_MS = 15 * 60 * 1000;
// 用户那句去掉首尾空白再比（打字时预跑用的草稿和发出去的那条，ST 会修掉首尾空白）。
const aheadKey = (chatKey, speaker, recentUser) => `${chatKey}\u0001${speaker}\u0001${String(recentUser ?? '').trim()}`;
const KEYS = '\u0002keys';
function once(key, start) {
    const now = Date.now();
    for (const [k, v] of ahead) if (now - v.at > AHEAD_TTL_MS) ahead.delete(k);
    if (!ahead.has(key)) {
        const promise = Promise.resolve().then(start);
        ahead.set(key, { at: now, promise });
        promise.catch(() => ahead.delete(key));   // 失败了下次重试
    }
    return ahead.get(key).promise;
}

function memberList(store, chatKey) {
    try { return JSON.parse(store.requireChat(chatKey).members ?? '[]').filter(m => m?.avatar); } catch { return []; }
}

// 用户那句话的检索词（没配模型、没有用户的话、出错都返回 []）。
async function queryKeysFor(store, keyMaker, { chatKey, recent, recentUser, present }) {
    if (!keyMaker || !recentUser?.trim()) return [];
    // 只有"嗯""好""（点头）"这种：配不出词（T-22 实测模型回一段"我需要更多信息"，被当成检索词），不调，旧事按上文挑。
    if (recentUser.replace(/[（(][^）)]*[）)]/g, '').replace(/[\s\p{P}]/gu, '').length < 3) return [];
    const names = [...new Set([...present, ...memberList(store, chatKey).map(m => m.name)].filter(Boolean))];
    try { return (await once(aheadKey(chatKey, KEYS, recentUser), () => keyMaker({ chatKey, recent, recentUser, names }))) ?? []; }
    catch { return []; }
}

// 她的身子她说了算（用户 10/12，方案 叙事节奏与防棘轮 第四节；body.mjs）：她一病，角色就开始照顾、说她身子弱，记账把这些记成他的态度和规矩，
// 下一轮他带着这些料开口，关心得更重，逐轮叠加永远好不了。一格的守门在这里搭一次：看玩家最近几条自己写的话（玩家刚发、还没同步过来的那句也算），
// 想起的旧事、规矩、心里没过去的、生活现状里记账记的身体、此刻的样子里她的身体、碰上了／口袋、来意、关系后半句、前几次开口的余波、离开回来那一段（顺带来联系那几行、兴头）都经它过——
// 记录按记录判（knower 知道的那些里留最新的；镜头不传，照玩家），成句的按句判。开局单用户亲手写的、他自己和别人的伤病不经它。
// speaker（头像）：给了就把他的余波、回来那一段也算进 open 的两条里（absence、camera、carry 跟组格时一样）
export function bodyGuardFor(store, records, chatKey, { anchor = null, recentUser = '', knower = null, userName = null, speaker = null, absence = null, camera = false, carry = true } = {}) {
    const messages = uptoAnchor(store.currentMessages(chatKey), anchor);
    const user = userName ?? [...messages].reverse().find(m => m.is_user)?.name ?? null;
    if (!user) return bodyGuard({});
    const said = String(recentUser ?? '').trim();
    const lastUser = [...messages].reverse().find(m => m.is_user);
    const gate = bodyGate({ messages: said && String(lastUser?.text ?? '').trim() !== said ? [...messages, { is_user: true, name: user, text: said }] : messages, userName: user });
    const storyId = store.requireChat(chatKey).story_id;
    const rosterNames = (store.getCast?.(storyId) ?? []).map(e => e.name);
    const rawRel = store.relationsOf?.(storyId);
    const rel = rawRel ? normalizeRelations(rawRel) : null;
    const her = rel ? personOf(rel, user, rosterNames) : null;
    const same = (a, b) => a === b || sameName(a, b, rosterNames) || (!!rel && !!personOf(rel, a, rosterNames) && personOf(rel, a, rosterNames) === personOf(rel, b, rosterNames));
    const upto = messages.at(-1)?.pos ?? null;
    const notes = foldState((store.stateNotesOf?.(chatKey) ?? []).filter(n => upto == null || n.pos <= upto), same, { lastPos: upto });
    const who = knower ?? user;   // 没说是谁（镜头）：照玩家知道的
    const knows = r => same(r.holder_name, who) || (r.audience ?? []).some(a => same(a, who));
    // 他的余波（前几格留下的，挂在那一格的条数上）、回来那一段（挂在离开那一条之后）
    const derived = [];
    if (speaker && knower && !camera && gate.mode === 'open') {
        try {
            const back = awayDue(store, chatKey, { speaker, name: knower, userName: user, absence, same });
            back?.away.forEach((text, i) => derived.push({ key: `a:${back.fresh.id}:${i}`, pos: (back.fresh.from_pos ?? upto ?? 0) + 0.5, text }));
        } catch {}
        if (carry) for (const slot of store.carryBefore?.({ chatKey, speaker, anchor }) ?? []) for (const c of slot.carry ?? []) if (c?.text) derived.push({ key: `c:${c.key}`, pos: (slot.n ?? 0) - 1, text: c.text });
    }
    return bodyGuard({ setup: store.setupOf?.(storyId)?.data ?? null, gate, userName: user, aliases: her ? [her.名, ...(her.又名 ?? [])].filter(Boolean) : [], same, records: records?.visible?.(chatKey) ?? [], notes, knows,
        towardHer: key => String(key).split(/[\u0001\u0002]/).some(n => same(n, user)), derived, speaker: camera ? null : knower });
}

function materialFor(store, records, { chatKey, speaker, name, anchor = null, recent, recentUser, present, queryKeys = [], pool, sense = null, skipOpen = null, scale = 1, guard = null }) {
    const chat = store.requireChat(chatKey);
    const messages = store.currentMessages(chatKey);
    // 她的伤病那几条按守门过（预跑别人那一格时也一样：组装好的会被留着直接用）
    const keep = (guard ?? bodyGuardFor(store, records, chatKey, { anchor, recentUser, knower: name, speaker })).keep;
    const material = selectMaterial({
        name, avatar: speaker, present, messages, records: records.visible(chatKey).filter(keep),
        openIdeaIds: new Set(records.openIdeas(chatKey).map(r => r.id)), recent, recentUser, queryKeys, queryWide: queryKeys.wide ?? [], sense,
        recalled: store.recentSlotIds?.({ chatKey, speaker, anchor }) ?? new Map(),
        timeMarks: timeMarksFor(store, records, chatKey), timeRecs: records.visible(chatKey).filter(r => r.type === '时间'),
        anchors: chat.anchors ? JSON.parse(chat.anchors) : null, pool, skipOpen, more: asksPast(recentUser, scaleFor(store, chatKey)), scale, timeScale: scaleFor(store, chatKey),
        tag: (n, today) => timeTag(n, { start: store.setupOf?.(chat.story_id)?.data?.时间 ?? null, today, timeScale: scaleFor(store, chatKey) }),
    });
    const byPos = new Map(messages.map(m => [m.pos, m.text]));
    return { material, messageText: pos => byPos.get(pos) ?? '' };
}

// 按角色组装（不钉住）。records 模块缺席时（老测试）返回空。
// 返回 { text, final, mode, ids }：final＝可以钉住（纯程序结果、或组装成功）；组装失败的回退结果 final=false。
// economy＝{ table }（价表）；contacts＝{ enabled, minGap }（不在场的人来联系）。
// T012：用户指定原文，修改措辞须由用户确认；逐字回归锁定。
export const POCKET_INTIMATE = '这一件由你发起：直接做，照你的性子带着对方往下走。不拿出来问要不要、想不想，也不停下来等对方点头；害羞、犹豫写在动作和神态里，不写成征求同意的话，别客气成温吞。两个人都愿意是这段关系的前提，不用每一步再确认。';

registerPromptDefaults({ 'pocket.intimate': POCKET_INTIMATE });
const pocketIntimateFor = (store, chatKey) => promptText('pocket.intimate', promptOptionsFor(store, chatKey));
export function intimateSetup(store, chatKey) {
    const storyId = store.requireChat(chatKey).story_id;
    const roster = (store.getCast?.(storyId) ?? []).filter(x => x.role !== '不用').map(x => x.name);
    const data = store.setupOf?.(storyId)?.data ?? null;
    if (promptOptionsFor(store, chatKey).tier === 'SFW') return data ? { ...data, 档位: 'SFW', 亲密线: [] } : data;
    return checkIntimate(data, { names: [...roster, ...(store.playerNames?.(storyId) ?? [])] });
}
export function intimatePlanOptions(store, chatKey, base) {
    const roster = store.getCast?.(store.requireChat(chatKey).story_id) ?? [];
    const intimate = activeIntimate(intimateSetup(store, chatKey));
    return { ...base, intimate, intimateProgress: currentIntimateProgress(store, chatKey, intimate), carded: n => roster.some(e => hasCard(e) && e.name === n), pace: paceFor(store, chatKey) };
}
export function currentIntimateProgress(store, chatKey, lines = activeIntimate(intimateSetup(store, chatKey))) {
    const saved = store.intimateProgressOf?.(chatKey) ?? [];
    return lines.map(line => saved.find(r => intimatePair(r['谁和谁']) === intimatePair(line.谁) && [line.现在, ...line.阶梯].includes(r.现在))
        ?? { 谁和谁: line.谁, 现在: line.现在, 依据: '开局原文', day: null, pos: null, source: 'setup' });
}
export function intimateProgressFor(store, records, chatKey, context = null) {
    const lines = activeIntimate(intimateSetup(store, chatKey));
    if (!lines.length) return [];
    const s = context ?? storyContext(store, records ?? { visible: () => [], openIdeas: () => [] }, chatKey), current = currentIntimateProgress(store, chatKey, lines);
    const items = store.menuOf(chatKey, { all: true, settledOnly: true }), stops = store.intimateStopsOf(chatKey);
    return lines.map((line, i) => {
        const key = intimatePair(line.谁), now = current[i];
        const ownStops = stops.filter(r => intimatePair(r.people) === key);
        const history = items.filter(m => m.purpose === '亲密' && m.intimate && line.谁.includes(m.who)
            && lines.filter(x => x.谁.includes(m.who)).length === 1
            && (['used','shown','sunk','sunk_told'].includes(m.status) || m.intimate_stop || m.why?.startsWith('/停：')))
            .map(m => { const stopped = m.why?.startsWith('/停：') || (m.intimate_stop && !['used','shown','sunk','sunk_told'].includes(m.status));
                const pos = stopped ? m.intimate_stop?.pos ?? ownStops[0]?.pos : m.settled_pos ?? m.pocket_pos ?? store.planById(m.plan_id)?.anchor_pos;
                return { id: m.id, pos: pos ?? -1, day: pos != null ? s.dayOf(pos + 0.5) : m.ready_day,
                    play: m.intimate.玩法 || '未记', place: m.place || '', reached: m.intimate.走到哪 || '未记', left: m.intimate.留下什么 || '未记',
                    result: stopped ? '玩家喊停' : m.status === 'used' ? '演了' : m.status === 'shown' ? '挑起来没接' : '没碰上' }; })
            .sort((a,b) => a.pos - b.pos || a.id - b.id).slice(-8);
        const pushes = new Set(), refusals = new Set();
        for (const r of s.visible) {
            const source = s.messages.find(m => m.fp === r.fp);
            if (!source?.is_user || !line.谁.includes(source.name) || r.fabricated || r.superseded_by || r.closed_by || !['现在','过去'].includes(r.tense)) continue;
            const other = line.谁.find(n => n !== source.name), text = String(r.text).replace(/[“”「」"']/g, '');
            // 两个完整名字和已发生的动作必须明确；不把拒绝别的事、假设或否定句算进来。
            if (/[？?]|如果|要是|假如|打算|想要|没有|并未|不曾/.test(text + '\n' + source.text)) continue;
            if (r.type === '做' && [`${source.name}推开了${other}`, `${source.name}推开${other}`].some(t => text.includes(t)) && source.text.includes('推开') && source.text.includes(other)) pushes.add(r.fp);
            if (r.type === '说' && [`${source.name}对${other}明确说不`, `${source.name}向${other}明确说不`].some(t => text.includes(t)) && /说[“「"']?不/.test(source.text) && source.text.includes(other)) refusals.add(r.fp);
        }
        return { people: line.谁, current: now.现在, basis: now.依据, source: now.source,
            day: now.pos != null ? s.dayOf(now.pos + 0.5) : now.day, history,
            stops: ownStops.slice(0,3).reverse().map(r => ({ day: r.pos != null ? s.dayOf(r.pos + 0.5) : r.story_day, place: r.place, part: r.part })), pushes: pushes.size, refusals: refusals.size };
    });
}
function intimateScene(store, records, chatKey, present = []) {
    const tl = timelineFor(store, records, chatKey);
    const board = boardFor(store, records, chatKey, { present, timeline: tl });
    return { place: board?.camera?.place || board?.fast?.place || '', day: tl.today, part: tl.part ?? null };
}
export function intimateStopped(store, records, chatKey, { present = [], record = false } = {}) {
    const raw = store.getMeta?.(`intimate_stop:${chatKey}`);
    if (!raw) return false;
    let stop;
    try { stop = JSON.parse(raw); } catch { return true; }
    const now = intimateScene(store, records, chatKey, present);
    // 不明的地方、时段不能当作换场；换日也算换了时间。
    const changed = (stop.place && now.place && stop.place !== now.place) || (stop.part && now.part && stop.part !== now.part) || now.day !== stop.day;
    if (changed && record) store.setMeta(`intimate_stop:${chatKey}`, null);
    return !changed;
}
export function stopIntimate(store, records, chatKey, { present = [] } = {}) {
    const scene = intimateScene(store, records, chatKey, present);
    store.setMeta(`intimate_stop:${chatKey}`, JSON.stringify(scene));
    store.logIntimateStop(chatKey, activeIntimate(intimateSetup(store, chatKey)).map(r => r.谁), scene);
    const settled = new Map((store.menuOf?.(chatKey, { settledOnly: true }) ?? []).map(m => [m.id, m]));
    let withdrawn = 0;
    for (const m of store.menuOf?.(chatKey) ?? []) if (m.purpose === '亲密' && (m.status === 'pocket' || (m.status === 'used' && ['waiting', 'pocket'].includes(settled.get(m.id)?.status)))) {
        store.updateMenu(chatKey, m.id, { status: 'waiting', by: '玩家', why: '/停：这一场暂停，换场后恢复' });
        withdrawn++;
    }
    return { stopped: true, withdrawn };
}
function intimateAllowed(store, records, chatKey, { present = [], record = false } = {}) {
    if (intimateStopped(store, records, chatKey, { present, record })) return () => false;
    const rows = activeIntimate(intimateSetup(store, chatKey));
    return m => rows.some(x => x.谁.includes(m.who));
}
export function withdrawIntimateForTier(store, chatKey) {
    if (promptOptionsFor(store, chatKey).tier !== 'SFW') return 0;
    const settled = new Map((store.menuOf?.(chatKey, { settledOnly: true }) ?? []).map(item => [item.id, item]));
    let withdrawn = 0;
    for (const item of store.menuOf?.(chatKey) ?? []) if (item.purpose === '亲密' && (item.status === 'pocket' || (item.status === 'used' && ['waiting', 'pocket'].includes(settled.get(item.id)?.status)))) {
        store.updateMenu(chatKey, item.id, { status: 'waiting', by: '系统', why: 'SFW 档不用亲密线' }); withdrawn++;
    }
    return withdrawn;
}
// 递给牵头人的那一句（T013）：有哪格写哪格；旧件没有玩法、存的是"新在哪"，照旧写它
export const intimateDetail = m => {
    const x = m.intimate;
    if (!x) return '';
    return [x.名目 && `${m.who}此刻出手，是因为${x.名目}`, x.玩法 ? `这一件玩的是${x.玩法}` : x.新在哪, x.怎么带 && `怎么带：${x.怎么带}`,
        x.加入?.length && `${x.加入.join('、')}会加进来`, x.走到哪 && `这一件${x.走到哪}`].filter(Boolean).join('；');
};
const intimateSlotVersion = (store, chatKey) => {
    const data = store.setupOf?.(store.requireChat(chatKey).story_id)?.data?.亲密线;
    const stop = store.getMeta?.(`intimate_stop:${chatKey}`);
    const prompt = promptOptionsFor(store, chatKey);
    const revision = store.getMeta?.(`plan_revision:${chatKey}`);
    const base = prompt.tier === DEFAULT_TIER && prompt.pack === DEFAULT_PACK
        ? (data?.length || stop ? `${SLOT_CODE}:${createHash('sha256').update(JSON.stringify([data, stop])).digest('hex').slice(0, 16)}` : SLOT_CODE)
        : `${SLOT_CODE}:${createHash('sha256').update(JSON.stringify([data, stop, prompt.version])).digest('hex').slice(0, 16)}`;
    return revision ? `${base}:plan-${revision}` : base;
};

// 总闸只读配置，不改各功能开关；暂停总结时下游一律停。
export function playModeOf(store, chatKey, config = null) {
    const chat = store.requireChat(chatKey);
    if (chat.extract === 0 || chat.extract === false) return 'memory';
    const own = store.setupOf?.(chat.story_id)?.data?.玩法;
    if (own === '完整') return 'full';
    if (own === '只记忆') return 'memory';
    const cfg = config ?? promptOptionsFor(store, chatKey).config;
    return cfg?.play?.mode === 'memory' ? 'memory' : 'full';
}
export function playStop(store, chatKey, config = null) {
    return playModeOf(store, chatKey, config) === 'full' ? null : { ok: true, skipped: true, reason: store.requireChat(chatKey).extract === 0 || store.requireChat(chatKey).extract === false ? '要先开每条总结' : '这一局是只记忆' };
}
function playOptions(store, chatKey, opts) {
    return playModeOf(store, chatKey) === 'memory' ? { ...opts, contacts: { enabled: false }, absence: { ...opts.absence, mode: 'pause' }, planner: { record: false }, situation: null, drift: { prices: false, long: false } } : opts;
}
const fullPlay = (store, chatKey) => playModeOf(store, chatKey) === 'full';
export async function composeSlot(store, records, args, opts = {}) {
    const { chatKey, speaker, speakerName } = args;
    opts = playOptions(store, chatKey, opts);
    const chat = store.requireChat(chatKey);
    if (chat.test_slot) return { text: testContent({ speakerName: speakerName || speaker, total: store.status({ chatKey }).total }), final: true, mode: 'test' };
    if (!records) return { text: '', final: true, mode: 'none' };
    // 离开记一笔、世界往前走的那些写，都在折那一步（advance，buildSlot 组格前、同步后各跑一次）；这里只读
    const messages = store.currentMessages(chatKey);
    // 镜头（N-276）：照玩家的眼睛看——旧事、此刻的样子、约定按玩家拿；口袋按镜头递
    const camera = speaker === CAMERA;
    // 玩家的名字：新窗口头一句可能还没同步过来，镜头就用扩展传来的在场名单的头一个（就是玩家）
    const userName = [...messages].reverse().find(m => m.is_user)?.name ?? (camera ? args.present?.[0] : undefined);
    const eyes = camera ? { ...args, speakerName: userName ?? '玩家', present: args.present?.length ? args.present : [userName].filter(Boolean), camera: true } : args;
    const pending = camera ? false : await awaitAway(store, chatKey, args.speaker, opts.absence);
    let pendingLedger = null;
    try {
        const upto = args.anchor ? uptoAnchor(messages, args.anchor) : messages;
        pendingLedger = pendingFor(store, records, chatKey, { anchor: args.anchor ?? null, present: eyes.present ?? [], recentUser: args.recentUser ?? '', timeline: timelineFor(store, records, chatKey, upto) });
    } catch {}
    // 约定（N-268）：先算好——"今天说好的"那一块给了的，"惦记着"里不再重复
    let promised = null;
    try { promised = promisesFor(store, records, eyes); } catch {}
    const fit = roomFit(args.room);
    // 她的身子她说了算（bodyGuardFor）：镜头照玩家的眼睛看，按玩家知道的
    const guard = bodyGuardFor(store, records, chatKey, { anchor: args.anchor ?? null, recentUser: args.recentUser ?? '', knower: camera ? userName : speakerName || speaker, userName,
        speaker: args.speaker, absence: opts.absence ?? null, camera, carry: (opts.mood ?? {}).carry !== false });
    const base = await memorySlot(store, records, eyes, { ...opts, skipOpen: promised?.shownIds ?? null, pendingLedger, scale: fit.s, episodes: store.episodesOf?.(chatKey) ?? [], guard });
    const backstoryPick = await backstorySense(store, chatKey, args.recentUser, opts.vectors);
    const { lines: extra, blocks = null, contact, carry = [], linger = [], dayOf = null, stance = null } = extrasFor(store, records, eyes, { ...opts, pendingAway: pending, pendingLedger, backstoryPick, promised, guard }, base);
    const name = camera ? CAMERA_NAME : speakerName || speaker;
    // 隔着消息、电话的人没"进门"：旧事那段开头那句换成人不在这儿（试玩 10/13：他发消息来，场记写他刚到场、进门之前的事没看见）
    if (stance?.status === 'remote' && base?.text) base.text = base.text.split('\n').map(l => (l.startsWith(`${name}刚到场。`) ? `${name}这会儿隔着${stance.way || '消息'}，人不在这儿；这里之前发生的事、说过的话，${name}没看见也没听见，除非有人告诉过${name}。` : l)).join('\n');
    // 情绪余波（mood.mjs）：前几格给过、他心里还没过去的，接着给他之后的开口；平常戏里持续几天的"改变"也在这里。
    const mood = opts.mood ?? {};
    const on = mood.carry !== false;
    const prior = on && store.carryBefore ? store.carryBefore({ chatKey, speaker, anchor: args.anchor ?? null }) : [];
    const at = parseInt(args.anchor ?? '', 10);
    // 那一格有个总长度（9/27 审计：一般 830 字、长的两三千字，前台一次读太多就每件都去碰）：超了就按次序让位——
    // 底色和顺带一提先让，再是别人的口袋，再是他自己牵头的；眼下正在说的、玩家伸了手的不让。让掉的口袋还在口袋里，下回再给。
    // 离开期间的推演按玩家说的改过了：前几格留下的余波换成改过的那一份（改过后没了的那一项就不再给）。
    const revised = (store.absences?.(chatKey) ?? []).filter(a => a.story_status === 'ready' && a.story?.已按玩家改);
    const byId = new Map();   // 前几格记的推演编号（原来那条、或另存前的那条）→ 改过的每一项
    for (const a of revised) {
        const texts = new Map(awayCarry(a.story, { name, userName: userName ?? '对方', same: samePerson, id: a.id, days: a.days }).map(c => [c.key.split(':').slice(2).join(':'), c.text]));
        for (const id of [a.id, a.story.改自].filter(x => x != null)) byId.set(String(id), texts);
    }
    // 玩家交代其实没空白（实际 0 天，质量窗 10/3）：这次离开留下的余波都撤（回来那一段、电话、推演出来的那几股劲）
    const voided = new Set((store.absences?.(chatKey) ?? []).filter(a => a.days === 0).flatMap(a => [a.id, a.story?.改自].filter(x => x != null).map(String)));
    const resolve = key => {
        const p = /^pocket:(\d+)$/.exec(key ?? '');
        if (p) {
            const m = store.menuOf?.(chatKey).find(m => m.id === Number(p[1]));
            if (m?.purpose === '亲密' && (camera || m.who !== (speakerName || speaker) || !intimateAllowed(store, records, chatKey, { present: args.present })(m))) return null;
        }
        const v = /^(?:away|return|phone):(\d+)/.exec(key ?? '');
        if (v && voided.has(v[1])) return null;
        const m = /^away:(\d+):(.*)$/.exec(key ?? ''); const texts = m && byId.get(m[1]); return texts ? texts.get(m[2]) ?? null : undefined;
    };
    // 余波里说她伤病的那一截按守门切（"以为她伤得重、药还没送来"不跨几轮一直带着；她提了身子才算进那两条）
    const carried = carryParts(prior, { name, userName: userName ?? '对方', now: Number.isFinite(at) ? at : messages.length, current: carry, dayOf, resolve, timeScale: scaleFor(store, chatKey), cut: guard.carry,
        tag: (n, today) => timeTag(n, { start: store.setupOf?.(chat.story_id)?.data?.时间 ?? null, today, timeScale: scaleFor(store, chatKey) }) });
    const scopedBlocks = (blocks ?? []).filter(p => !camera || p.scope !== 'person');
    const all = [...(camera ? scopedBlocks : (blocks ?? [{ tier: 0, lines: extra, scope: 'person' }])),
        { tier: 0, lines: carried.near, scope: 'person' }, { tier: 1, lines: carried.later, place: 'back', scope: 'person' },
        { tier: 2, lines: on ? linger : [], place: 'back', scope: 'person' }].filter(p => !camera || p.scope !== 'person');
    // 三块各算各的长度（N-284 第二步，用户 10/4："1600 字上限不合理"）：底子（常备）、想起的（旧事＋放在那一块的几行）、眼下这一轮（口袋、此刻、背景）。
    // 以前想起的旧事算在 1600 里、自己又不让，一长就把眼下这一轮的挤掉；现在各让各的。想起的那块：玩家在问以前的事时放宽。
    const split = opts.slot?.split !== false;
    const recallCap = Math.round((asksPast(args.recentUser, scaleFor(store, chatKey)) ? RECALL_CHARS_ASKED : RECALL_CHARS) * fit.s);
    const kept = new Set([...fitParts(0, all.filter(p => p.place === 'base'), BASE_CHARS), ...fitParts(base.text?.length ?? 0, all.filter(p => p.place === 'recall'), recallCap),
        ...fitParts(0, all.filter(p => p.place !== 'base' && p.place !== 'recall'), opts.slot?.maxChars ?? SLOT_CHARS)]);
    const more = all.filter(p => kept.has(p)).flatMap(p => p.lines);
    const out = { ...base, contact, carry, room: fit, blocks: all.filter(p => kept.has(p)).map(({ tier, lines, place, scope }) => ({ tier, lines, place, scope })), text: !more.length ? base.text : base.text ? `${base.text}\n${more.join('\n')}` : finish(base.material.name, more) };
    // 场次摘要（N-284）：问起哪天的、玩家这句正冲着的旧账落在哪场——那几场的经过整段给；另算长度，不和别的抢地方，不参与让位
    const episode = camera || opts.episodes === false ? '' : soften(episodeBlock(store, records, chatKey, { name, text: args.recentUser, hits: episodeHits(base.material), messages, roster: (store.getCast?.(chat.story_id) ?? []).map(e => e.name), cap: Math.round(EPISODE_CHARS * fit.s), count: Math.min(5, Math.max(1, Math.round(2 * fit.s))) }).join('\n'));
    if (episode) out.text = out.text ? `${out.text}\n${episode}` : episode;
    const tail = [];   // 末尾那几句提醒（分块放时进"眼下这一轮"）
    const say = line => { if (line) { tail.push(line); out.text = out.text ? `${out.text}\n${line}` : line; } };
    // 她提了身子（照她写的来，关心一句就够）、说已经好了（按好了写）：那几块之后一句，一格只一次
    say(guard.note({ soft: args.soft !== false }));
    // 材料里提到用户用的是第三人称（"她""他"），前台会跟着在正文里改口：末尾提醒一句，人称照它一直以来的写法。
    // 镜头不是哪个人（试玩 10/6：旁白卡是空的，上文全是别人用"我"写的，旁白跟着用他的口吻写了一整段）
    if (out.text && userName && !camera) say(`（${split ? '场记里' : '上面'}用第三人称提到${userName}，只是材料的写法；正文里对${userName}的称呼和人称，照你一直以来的写法。）`);
    // 群聊里别人括号里写的心里话也在上文里，前台会当成听见了（实测：别人心里算的账，刚进门的人张口就说了）。
    // 他不知道的别让前台自己补上、猜中（试玩 9/30）
    if (out.text) say(renderPronouns("（别人括号里写的心里话，你听不见也看不见；你只知道他们说出口的话和看得见的动作。场记和聊天里都没有的别人的内情、底细、秘密，〔当事人〕不知道，别替〔当事人〕补全，也别让〔当事人〕猜中。）", { person: name }));
    const cameraDef = camera ? cameraRule(userName ?? '玩家', (args.present ?? []).filter(n => n && n !== userName), { cards: cameraCards(store, records, { chatKey, storyId: chat.story_id, anchor: args.anchor, present: args.present ?? [], recentUser: args.recentUser ?? '', contacts: opts.contacts, planner: opts.planner }) }) : '';
    if (camera && split) say(cameraNudge(userName ?? '玩家'));
    // 给前台的那一句口味：这一轮对用户这句话怎么接，由前台当场定。
    say(mood.cue && !camera ? cueLine({ name, userName: userName ?? '对方', recentUser: args.recentUser }) : null);
    // 他用滥的路数、最近两条的模子、上一条的复述开头，合成一句（varyFor）
    say(varyFor(store, { chatKey, speaker, name, userName, messages: uptoAnchor(messages, args.anchor), fresh: opts.fresh, pace: opts.pace }));
    // 往下接（pace.mjs）：用户只应了一声，别把上一段再演一遍；他上一段问了不在场的人话，别干等。
    if (opts.pace?.enabled !== false && !camera) {
        const names = (store.getCast?.(chat.story_id) ?? []).map(e => e.name);
        const upto = uptoAnchor(messages, args.anchor);
        for (const line of [onwardLine({ messages, speaker, name, userName: userName ?? '对方', soft: args.soft !== false }), absentAskLine({ messages, speaker, name, names, present: args.present ?? [] }), takenLine({ messages: upto, speaker, name, userName: userName ?? '对方', remote: stance?.status === 'remote' })]) say(line);
    }
    // 这一条的范围（用户 10/2，横向生长）：只写眼前这几分钟，停在对方能接的地方；对方没动，场面不挪、时间不跳。放在最末。
    if (opts.pace?.scope !== false && opts.pace?.lateral !== false && !camera) say(scopeLine({ userName: userName ?? '对方' }));
    if (camera) out.text = out.text ? `${cameraDef}\n${out.text}` : cameraDef;   // 整格（预览、不分块时）也带定义
    if (out.text) out.text = soften(out.text);
    if (split && out.text) {
        const linesOf = place => all.filter(p => kept.has(p) && (p.place ?? 'now') === place).flatMap(p => p.lines);
        const block = (place, lines) => (lines.length ? soften([HEADS[place](name), ...lines].join('\n')) : '');
        const recall = [base.text, ...linesOf('recall')].filter(Boolean);
        out.parts = {
            world: block('world', linesOf('world')),
            base: [cameraDef, block('base', linesOf('base')), block('back', linesOf('back'))].filter(Boolean).join('\n\n'), mid: block('mid', linesOf('mid')),
            recall: [episode, !recall.length ? '' : soften(wrap(base.text ? recall.join('\n') : finish(name, recall)))].filter(Boolean).join('\n\n'),
            now: block('now', [...linesOf('now'), ...tail]),
        };
    }
    if (pending) out.final = false;   // 推演还没回来：这一格先不钉住，左滑重来时能用上推好的
    return out;
}

// 按事挑那几场经过时，旧账的先后：用户那句里在说以前的那一句（"之前……的时候""你说过"），它最对得上的那条在最前；
// 再是别的每一句最对得上的；再按相关度（试玩 10/5：一句里先说了个地名、后说到"之前在某处分别的时候"，挑中的是那个地名的两场）。
export function episodeHits(material) {
    if (!material?.hits?.length) return [];
    const rel = id => material.relevance?.get(id) ?? 0;
    const direct = material.hits.filter(r => material.direct?.has?.(r.id)).sort((a, b) => rel(b.id) - rel(a.id));
    const leads = (material.leads ?? []).map(l => ({ ...l, r: direct.find(r => r.id === l.id) })).filter(l => l.r)
        .sort((a, b) => (asksPast(b.piece) ? 1 : 0) - (asksPast(a.piece) ? 1 : 0) || rel(b.id) - rel(a.id)).map(l => l.r);
    return [...new Set([...leads, ...direct])];
}

// 给开口的人的那几场经过（episodes.mjs）：剧情日、时段按这个窗口此刻的日子算（用户后来改了哪天，跟着改）；最近 30 条以内前台自己看得见，按事挑时不重复给。
const EPISODE_RECENT = 30;
// 他那时在不在场：隔离区间盖得住 from～to 这一段（没记过区间的人不拦）。摘要模型写"在场"偶尔把刚走、只被提到的人也算进去
function witnessed(store, chatKey, name, roster, from, to) {
    const card = (store.getCast?.(store.requireChat(chatKey).story_id) ?? []).find(e => sameName(e.name, name, roster));
    if (!card?.avatar) return true;
    let anchors = null;
    try { anchors = JSON.parse(store.requireChat(chatKey).anchors ?? 'null'); } catch {}
    const segs = (anchors?.[card.avatar]?.segments ?? []).filter(s => Number.isFinite(s?.from) && (s.to == null || s.to > s.from));
    if (!segs.length) return true;
    if (!segs.some(s => s.from <= to && (s.to == null || s.to > to))) return false;
    // 那时他隔着电话、消息（场记章程第 2 条）：区间开着，人不在这儿——这一场的经过写的是当面看得见听得见的，不给他；
    // 他在电话里说过、听过的照记账（"说"）给，那份按条算谁听见了
    let arrivals = [];
    try { arrivals = JSON.parse(store.getMeta?.(`arrivals:${chatKey}`) ?? '[]') ?? []; } catch {}
    if (!(Array.isArray(arrivals) ? arrivals : Object.values(arrivals ?? {})).length) return true;
    return !remoteAt(to, { arrivals, anchors, members: [card], messages: store.currentMessages(chatKey), notes: store.stateNotesOf?.(chatKey) ?? [] }).has(card.name);
}
export function episodeBlock(store, records, chatKey, { name, text = '', hits = [], messages = store.currentMessages(chatKey), roster = [], cap = EPISODE_CHARS, count = 2 }) {
    const episodes = store.episodesOf?.(chatKey) ?? [];
    if (!episodes.length) return [];
    const tl = timelineFor(store, records, chatKey, messages);
    const partBy = new Map(tl.rows.map(r => [r.pos, r.part]));
    return episodeLines(episodes, {
        name, text, dayOf: tl.dayOf, partAt: p => partBy.get(p) ?? null, today: tl.today,
        knows: e => e.present.some(p => sameName(p, name, roster)) && witnessed(store, chatKey, name, roster, e.from_pos, e.to_pos), hitPos: hits.map(r => r.pos), recentFrom: (messages.at(-1)?.pos ?? 0) - EPISODE_RECENT,
        when: d => timeTag(tl.today - d, { start: tl.start, today: tl.today, timeScale: tl.scale }), timeScale: tl.scale, cap, count,
    });
}

// 别人讲到一半停下的、他在场听了的（N-124，白皮书 §5.7 W2.3 ②）：最近 150 条以内、还没讲完的，至多两条。
const ASK_WINDOW = 150;
export function askLines(visible, { name, openIds, lastPos = 0, when = () => '' }) {
    const rows = visible.filter(r => r.type === '说' && r.unfinished && openIds.has(r.id) && r.holder_name && r.holder_name !== name
        && (r.audience ?? []).includes(name) && lastPos - r.pos <= ASK_WINDOW).slice(-2);
    return rows.length ? [`${name}还想知道的（别人上回没讲完；有空当可以追问、对一对自己知道的，正说到别的要紧事就先放着）：`, ...rows.map(r => `· ${r.text}（${when(r)}）`)] : [];
}

// 群像里不在群里的人（N-274，用户 10/2：营地、帮派、酒吧的群像，前台只写有卡在场的那几个，旁边那一圈人像不存在）：
// 最近几条正文里写到的、名册或关系表里有的、不在这个群里开口的人，至少两个时提一句——他们要是就在这儿，写群像时也带一笔；
// 附上关系表里他现在是谁、和开口的人什么关系，免得写走样。只是被提起、人不在这儿的，前台自己分得清。
const CROWD_WINDOW = 3, CROWD_MIN = 2, CROWD_MAX = 6;
export function crowdLines({ messages = [], present = [], name, userName = null, player = [], rel = null, rosterNames = [], board = null }) {
    const { names, same } = nameFinder(rel, rosterNames);
    const boardHere = board?.people?.filter(p => p.status === 'present' || p.status === 'remote').map(p => p.name) ?? [];
    const here = [...(board ? boardHere : present), name, userName, ...player].filter(Boolean);
    const seen = names(messages.slice(-CROWD_WINDOW).map(m => m.text).join('\n')).filter(n => !here.some(h => same(h, n))).slice(0, CROWD_MAX);
    if (seen.length < CROWD_MIN) return [];
    const who = seen.join('、'), cut = (t, k) => (String(t ?? '').length > k ? `${String(t).slice(0, k)}…` : String(t ?? ''));
    return [`最近几条里还写到了${who}（他们不在这个群里）：他们要是就在这儿，写群像时也带他们一笔——在干什么、什么神情、偶尔插一句；不用每个都写，别抢了眼前的戏，也别替${userName ?? '玩家'}说话。人不在这儿就当没看见。`,
        ...seen.map(n => {
            // 外人眼里的样子（写了的照它；没写的多半是街面上的人，"现在"就是谁都看得见的那面）；关系照开口的人自己那一侧。
            // 试玩 10/13：给开口的人的是另一个人那格"现在"的实情，那是只有两三个人知道的事
            const p = rel ? personOf(rel, n, rosterNames) : null;
            const me = rel ? personOf(rel, name, rosterNames) : null;
            const tie = me?.关系?.find(r => same(r.对, n))?.是;
            const look = p?.外人眼里 || p?.现在;
            const bits = [look ? cut(look, 40) : '', tie ? `${name}和${n}：${cut(tie, 30)}` : ''].filter(Boolean);
            return bits.length ? `· ${n}：${bits.join('；')}` : null;
        }).filter(Boolean)];
}

// 说好的（质量窗 9/29，用户：V 明说了不喜欢被叫"大传奇"，该永久记住、开口前就知道，也可能成为聊天的养分）：
// 记账标了"说好的"——两人之间以后一直照着做的规矩（怎么称呼、别再做什么）——他知道的，每次开口都带一行。
// 只说"照着做、不用提起"：每轮都给的东西前台容易当成每轮都要处理的事（旧事里那条医嘱让人几十轮围着它转），所以不写成要他回应的样子。
// 同一件事前后说得不一样（后来又说"还是那么叫吧"），两条都给，以后说的为准。至多 4 条，新的优先。
const AGREED_MAX = 4;
export function agreedLines(records, { name, dayOf = () => 0, today = 0, when = relativeDay, closed = new Set() }) {
    // 拼上去的每一句（答、同一句里还说的）单独过"他知不知道"（场记章程第 1 条，试玩 10/10：玩家独自对别人说的话，
    // 被当成他那条要求的"答"拼给了他）——他不知道的就不拼，只给主句
    const knowsIt = r => !!r && (r.holder_name === name || (r.audience ?? []).includes(name));
    const known = records.filter(r => r.standing && knowsIt(r))
        .filter(r => !closed.has(r.id))
        .sort((a, b) => b.pos - a.pos).slice(0, AGREED_MAX).sort((a, b) => a.pos - b.pos);
    if (!known.length) return [];
    // 分清是谁立的（试玩 10/3：他要求她"再躲起来先给个信"，她没答应，被写成"说好了的"，前台拿它训她）：
    // 别人跟他定下的，他照着做；他自己说的——立给自己的照着做，要别人照着做的，对方没答应前只是他提过的要求。
    // 规矩和对它的回答放一处（用户 10/8："他认下这条规矩"和她立的那条分开给，前台看不出认的是哪条）：
    // 立规矩的那条后面跟着谁怎么答的；答的那条不再单列
    const byId = new Map(records.map(r => [r.id, r]));
    const answerOf = r => { const a = r.closed_by?.kind === '回答' ? byId.get(r.closed_by.id) ?? null : null; return knowsIt(a) ? a : null; };
    const answers = new Set(known.map(answerOf).filter(Boolean).map(a => a.id));
    // 规矩只剩一句原话、看不出要照着做什么的（"她说「我在乎你就得在乎」"）：带上她同一条消息里说的别的话
    const thin = r => bareText(r.text).replace(new RegExp(`^${(r.holder_name ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`), '').replace(/^(说|称|要求|让|对[^，。]{1,8}说)/, '').replace(/「[^」]*」/g, '').replace(/[，。,.；;：:\s]/g, '').length < 6;
    const sibling = r => records.find(x => x.id !== r.id && x.pos === r.pos && x.holder_name === r.holder_name && x.type === '说' && !x.standing && knowsIt(x));
    const line = r => {
        const a = answerOf(r), s = thin(r) ? sibling(r) : null;
        const said = t => bareText(t).replace(/[。．.]+$/, '');
        const answered = a ? said(a.text).replace(new RegExp(`^${(a.holder_name ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`), '').replace(/^(说|答|称|回)/, '') : '';
        if (!a && !s) return `· ${bareText(r.text)}（${when(today - dayOf(r.pos))}）`;
        return `· ${said(r.text)}${s ? `（同一句里还说：${said(s.text)}）` : ''}${a ? `——${a.holder_name ?? ''}答：${answered}`: ''}（${when(today - dayOf(r.pos))}）`;
    };
    const fromOthers = known.filter(r => r.holder_name !== name && !answers.has(r.id)), fromHim = known.filter(r => r.holder_name === name && !answers.has(r.id));
    return [
        ...(fromOthers.length ? [`${name}和身边的人之间说好了的（别人跟${personWord(name)}定下的规矩，一直照着做就行，不用特意提起；前后说得不一样的，以后说的为准）：`, ...fromOthers.map(line)] : []),
        ...(fromHim.length ? [`${name}自己说过的规矩（${personWord(name)}立给自己的、答应别人的，${personWord(name)}照着做；${personWord(name)}要别人照着做的，对方没答应之前只是${personWord(name)}提过的要求，照不照做由对方，别当成对方欠${personWord(name)}的）：`, ...fromHim.map(line)] : []),
    ];
}

// 直白的性词换成"亲密"一类的说法（9/29 Q 副本实测：那一格里一句记账"甲和乙发生了性关系"，加上上文里别的叫法，
// 前台 Gemini 连着三次整条拒收"prompt contains sensitive words"；只换这一句就过了）。记账提示词也改了，这里兜住旧记录和组装的原话。
const SOFTEN = [[/发生了?性关系/g, '有了亲密关系'], [/性关系/g, '亲密关系'], [/做爱|性交|性爱/g, '亲热']];
export const soften = text => SOFTEN.reduce((t, [re, to]) => t.replace(re, to), String(text));

// 那一格的总长度和让位（tier：0 不让——眼下正在说的、玩家伸了手的、回来那一段、这场戏里的余波；1 他自己牵头的和过了这场戏的余波；2 和在场的人的关系（常备的底子）、别人的口袋、来联系、平常戏里还没过去的；3 底色和顺带一提）。
// 同一档里后加的先让（关系在前、口袋在后：别人的口袋先让，关系后让）。
export const SLOT_CHARS = 1600;
// relations.slotLines 给的几行里，"X和在场的人："那一段（标题＋底下的 · 行）单拿出来，其余照旧。
export function splitTies(lines, name) {
    const ties = [], rest = [];
    let inTies = false;
    for (const l of lines ?? []) {
        if (String(l) === `${name}和在场的人：`) { inTies = true; ties.push(l); continue; }
        if (inTies && (String(l).startsWith('· ') || String(l).startsWith('  '))) { ties.push(l); continue; }   // 缩进的是那一行下面的"这一路"（relations.pathLines），跟着那一行不让
        inTies = false;
        rest.push(l);
    }
    return { ties, rest };
}
export function fitParts(baseLen, parts, cap = SLOT_CHARS) {
    const size = p => p.lines.reduce((s, l) => s + String(l).length + 1, 0);
    let total = baseLen + parts.reduce((s, p) => s + size(p), 0);
    const keep = parts.map(p => p.lines.length > 0);
    for (const tier of [3, 2, 1]) for (let i = parts.length - 1; i >= 0 && total > cap; i--)
        if (keep[i] && parts[i].tier === tier) { keep[i] = false; total -= size(parts[i]); }
    return parts.filter((_, i) => keep[i]);
}
export const fitSlot = (baseLen, parts, cap = SLOT_CHARS) => fitParts(baseLen, parts, cap).flatMap(p => p.lines);

// 开局单的前事里哪几条和眼下的话有关：向量能用就按意思挑——和记录召回一样，只留比别的条目明显更贴近的，一条都不突出就不给
// （试玩 9/30：字面撞词撞上"东西""年前""墨西哥"，把不相干的前事递了上去）。前事每条转一次向量存着；玩家这句话的向量召回旧事时已经转过，这里复用。
// 还没转完、或者调不通：返回 null，退回字面比对（setup.rankBackstory）。
export async function backstorySense(store, chatKey, recentUser, vectors) {
    if (!vectors?.ready?.() || !vectors.ensureTexts || !String(recentUser ?? '').trim()) return null;
    const items = store.setupOf?.(store.requireChat(chatKey).story_id)?.data?.前史 ?? [];
    if (!items.length) return null;
    const texts = items.map(backstoryText);
    vectors.ensureTexts(texts, `backstory:${chatKey}`).catch(() => {});
    const vecs = vectors.vectorsOfTexts(texts);
    if (vecs.length < new Set(texts).size * 0.8) return null;
    let scores;
    try { scores = senseScores(await vectors.query(recentUser), vecs, { top: 4 }); } catch { return null; }
    return cands => cands.map(c => ({ r: c, score: scores.get(textKey(backstoryText(c.x))) ?? 0 })).filter(h => h.score > 0).sort((a, b) => b.score - a.score);
}

function cameraFaces({ roster, board, rel = null, statuses = ['present'] }) {
    const names = roster.map(e => e.name);
    const person = n => rel ? personOf(rel, n, names) : null;
    const same = (a, b) => !!a && !!b && (sameName(a, b, names) || (!!person(a) && person(a) === person(b)));
    return roster.filter(e => String(e.avatar).startsWith('face:') && e.role !== '不用' && e.name !== CAMERA_NAME
        && board?.people?.some(p => statuses.includes(p.status) && (p.avatar ? p.avatar === e.avatar : same(p.name, e.name))))
        .sort((a, b) => (b.bond ?? BOND_DEFAULT[b.role] ?? 1) - (a.bond ?? BOND_DEFAULT[a.role] ?? 1)).slice(0, 8);
}

// 旁白眼前没卡的人：只带性子、这一侧对玩家的态度和用户定的称呼，不带知情。
export function cameraFaceLines({ roster, board, messages = [], player = null, rel = null, setup = null, current = new Map() }) {
    const names = roster.map(e => e.name), call = strangerCall(roster, messages);
    const person = n => rel ? personOf(rel, n, names) : null;
    const same = (a, b) => sameName(a, b, names) || (!!person(a) && person(a) === person(b));
    const canonical = n => person(n)?.名 ?? n;
    const rows = cameraFaces({ roster, board, rel })
        .map(e => {
            const mine = player ? current.dir?.get(`${canonical(e.name)}\u0002${canonical(player)}`)?.text : null;
            const attitude = mine || (player ? person(e.name)?.关系?.find(r => same(r.对, player))?.是 : null);
            const tone = player ? setup?.口径?.find(r => same(r.谁, e.name) && same(r.对谁, player))?.怎么 : null;
            const bits = [String(e.hook ?? '').slice(0, 60), attitude && `对玩家：${String(attitude).slice(0, 60)}`, tone && `怎么叫玩家：${tone}`].filter(Boolean);
            return { bond: e.bond ?? BOND_DEFAULT[e.role] ?? 1, text: `· ${e.群体 ? e.call || e.name : call(e.name) || e.name}${e.群体 ? '（一群人）' : ''}：${bits.join('｜')}` };
        }).sort((a, b) => b.bond - a.bond).slice(0, 8);
    const render = () => rows.length ? ['这里没卡的人：', ...rows.map(r => r.text)].join('\n') : '';
    while (rows.length && render().length > 500) rows.pop();
    return render();
}

export function cameraKnowledgeLines({ roster, board, visible = [], rel = null, player = null, when = () => '之前', lastPos = Infinity, messages = [] }) {
    const names = roster.map(e => e.name);
    const person = n => rel ? personOf(rel, n, names) : null;
    const same = (a, b) => !!a && !!b && (sameName(a, b, names) || (!!person(a) && person(a) === person(b)));
    const call = strangerCall(roster, messages);
    const present = cameraFaces({ roster, board, rel }), remote = cameraFaces({ roster, board, rel, statuses: ['remote'] });
    const selected = new Set([...present, ...remote].map(e => e.avatar));
    const mentioned = roster.filter(e => String(e.avatar).startsWith('face:') && e.role !== '不用' && e.name !== CAMERA_NAME && !selected.has(e.avatar)
        && messages.slice(-2).some(m => mentionedIn(m.text)(e.name)))
        .sort((a, b) => (b.bond ?? BOND_DEFAULT[b.role] ?? 1) - (a.bond ?? BOND_DEFAULT[a.role] ?? 1));
    const entries = [...present.map(e => ({ e, scope: 'present' })), ...remote.map(e => ({ e, scope: 'remote' })), ...mentioned.map(e => ({ e, scope: 'mentioned' }))].slice(0, 8);
    const rows = entries.map(({ e, scope }) => {
        const source = scope === 'mentioned' ? visible.filter(r => !['心里', '余波'].includes(r.type) && recordKnownTo(r, player, same)) : visible;
        const picked = faceRecall({ visible: source, name: e.name, same, lastPos, max: scope === 'mentioned' ? 3 : 4 });
        const lines = picked.map(r => {
            const head = `· ${String(when(r)).slice(0, 30)}：`, tail = recordKnownTo(r, player, same) ? '' : '（玩家不知道）';
            return `${head}${String(r.text || r.about || '').replace(/[。．.]+$/, '').slice(0, Math.max(0, 80 - head.length - tail.length))}${tail}`;
        });
        const label = e.群体 ? e.call || e.name : call(e.name) || e.name;
        return !lines.length ? '' : scope === 'mentioned' ? `${label}和玩家打过的交道：\n${lines.join('\n')}`
            : `${scope === 'remote' ? '（不在眼前，电话或消息里）' : ''}${label}知道的（只有标了"玩家不知道"的那几条，别让旁人替他说出来；他自己说不说，照他的性子和此刻的场面）：\n${lines.join('\n')}`;
    }).filter(Boolean);
    while (rows.length && rows.join('\n').length > 900) rows.pop();
    return rows.join('\n');
}

// 叙事组装限时（D-100：前台速度是用户的硬要求；实测配检索词＋组装一般 16 秒、慢时近 30 秒）：从这里起至多等 assembler.budgetMs，
// 到点先给纯程序那一格、不钉住；配词和组装照旧在后台跑完，结果留在 ahead 里，左滑重来时直接用上。
// 后开口的人多半已经提前组装好（prefetchOthers），不用等。
async function memorySlot(store, records, { chatKey, speaker, speakerName, anchor = null, recent = [], recentUser = '', present = [], camera = false }, { assembler = null, keyMaker = null, vectors = null, skipOpen = null, pendingLedger = null, scale = 1, episodes = [], guard = null }) {
    const name = speakerName || speaker;
    if (camera) {
        // 旁白的旧事按地方和眼前没卡的人来，不走玩家的关键词召回（召回来的是她的衣服鞋子）
        const messages = store.currentMessages(chatKey);
        const tl = timelineFor(store, records, chatKey, messages);
        let board = null;
        try { board = boardFor(store, records, chatKey, { anchor, present, recentUser, timeline: tl }); } catch {}
        const visible = records?.visible?.(chatKey) ?? [];
        const when = r => timeTag(tl.dayOf(r.pos ?? r.from_pos ?? 0), { start: tl.start, today: tl.today, timeScale: tl.scale });
        const storyId = store.requireChat(chatKey).story_id;
        const roster = store.getCast(storyId), rawRel = store.relationsOf(storyId);
        const rel = rawRel ? normalizeRelations(rawRel) : null;
        const names = roster.map(e => e.name), person = n => rel ? personOf(rel, n, names) : null;
        const same = (a, b) => !!a && !!b && (sameName(a, b, names) || (!!person(a) && person(a) === person(b)));
        const faces = cameraFaces({ roster, board, rel });
        const player = [...messages].reverse().find(m => m.is_user)?.name ?? null;
        const old = visible.filter(r => !guard || guard.keep(r));
        const privateAt = r => messages.some(m => isPrivate(m) && (m.fp === r.fp || m.pos === r.pos));
        // 地点兜底只放共同可用的公开记录；私信/心里/余波留在各人的格里。
        const publicRows = old.filter(r => recordKnownTo(r, player, same) && faces.every(e => recordKnownTo(r, e.name, same))
            && !['心里', '余波'].includes(r.type) && !privateAt(r));
        const publicEpisodes = episodes.filter(e => player && (e.present ?? []).some(n => same(n, player)) && faces.every(f => (e.present ?? []).some(n => same(n, f.name)))
            && !messages.some(m => isPrivate(m) && m.pos >= e.from_pos && m.pos <= e.to_pos));
        const knowledge = cameraKnowledgeLines({ roster, board, visible: old, rel, player, when, lastPos: messages.at(-1)?.pos ?? Infinity, messages });
        const rows = placeRecall({ visible: publicRows, episodes: publicEpisodes, board, when, max: knowledge ? 2 : 4, lastPos: messages.at(-1)?.pos ?? Infinity, userName: player }).slice(0, knowledge ? 2 : undefined);
        const recallText = rows.length ? ['上次在这儿：', ...rows].join('\n') : '';
        const people = cameraFaceLines({ roster, board, messages, player, rel, setup: store.setupOf(storyId)?.data, current: relationsNow(store, chatKey, rel, visible, roster.map(e => e.name)) });
        const text = [recallText, people, knowledge].filter(Boolean).join('\n');
        return { text, final: true, mode: 'place', ids: [], material: { name, hits: [], state: [], open: [], pool: [], lessons: [], when, who: () => '' }, queryKeys: [] };
    }
    // 事账说关了的不再当"惦记着、问过没回音"给：有回音、失效的要求；关了的约定（没关的远期约定照旧在"惦记着"里，约定那块只给今天、过了时候的）；钱、规矩各归各的块
    const CLOSED = new Set(['办了', '改了', '黄了', '过去了', '失效', '有回音']);
    const pendingSkip = pendingLedger && speaker !== CAMERA ? new Set(pendingLedger.items.filter(x => (x.kind === '要求' && CLOSED.has(x.status)) || (x.kind === '约定' && CLOSED.has(x.status)) || ['钱', '规矩'].includes(x.kind)).map(x => x.source?.id).filter(x => x != null)) : new Set();
    const allSkip = new Set([...(skipOpen ?? []), ...pendingSkip]);
    const pick = (queryKeys, pool, sense = null) => materialFor(store, records, { chatKey, speaker, name, anchor, recent, recentUser, present, queryKeys, pool, sense, skipOpen: allSkip, scale, guard });
    // 按意思找旧事（向量，D-109 第 4 步）：能用就不再先让模型配检索词（那一步两三秒）；这一局的记录还没转完、或者调不通，就照旧配词。
    const senseFor = async () => {
        if (!vectors?.ready?.() || !recentUser?.trim()) return null;
        const recs = records.visible(chatKey).filter(r => r.type !== '时间');
        vectors.ensure(recs, chatKey).catch(() => {});
        const items = vectors.vectorsOf(recs);
        if (!items.length || items.length < recs.length * 0.8) return null;
        try { return (senseUsed = senseScores(await vectors.query(recentUser), items)); } catch { return null; }
    };
    // 按意思算出来的分也交出去：碰上的事那一块拿它认玩家这句是不是在说那件（matters.mjs）
    let senseUsed = null;
    const out = (material, queryKeys, text, final, mode, ids) => ({ text, final, mode, ids, material, queryKeys, sense: senseUsed });
    const plain = (material, queryKeys, final, mode) => out(material, queryKeys, renderPlain(material), final, mode, [...(material.plainHits ?? material.hits), ...material.state, ...material.open, ...(material.lessons ?? [])].map(r => r.id));
    if (!assembler) return plain(pick([], false, await senseFor()).material, [], true, 'plain');

    let keysSoFar = [], senseSoFar = null;
    const full = (async () => {
        const sense = await senseFor();
        senseSoFar = sense;
        const queryKeys = sense ? [] : await queryKeysFor(store, keyMaker, { chatKey, recent, recentUser, present });
        keysSoFar = queryKeys;
        const { material, messageText } = pick(queryKeys, true, sense);
        // 程序连一条相关的都没挑出来，就不花钱请模型了。
        if (!material.hits.length || !material.pool.length) return plain(material, queryKeys, true, 'plain');
        try {
            const r = await once(aheadKey(chatKey, speaker, recentUser),
                () => assembler({ chatKey, speaker, anchor, name, present, recent, recentUser, material, messageText }));
            if (r && (r.lines.length || r.none)) return out(material, queryKeys, renderNarrative(material, r.lines), true, 'narrative', [...r.lines.flatMap(l => l.ids), ...narrativeState(material, r.lines).map(s => s.id), ...material.open.map(o => o.id)]);
            // 模型给了东西却一句都没过核对：多半是格式乱了，用纯程序的，钉住（免得左滑一次花一次）。
            if (r) return plain(material, queryKeys, true, 'plain_after_rejected');
            return plain(material, queryKeys, true, 'plain');
        } catch {
            return plain(material, queryKeys, false, 'plain_fallback');
        }
    })();
    const budget = Number(assembler.budgetMs?.() ?? 0);
    if (!(budget > 0)) return full;
    let timer;
    const done = await Promise.race([full, new Promise(r => { timer = setTimeout(() => r(null), budget); })]);
    clearTimeout(timer);
    if (done) return done;
    // 到点了：检索词已经配好就用上，没好就只用程序的字组召回。
    return plain(pick(keysSoFar, false, senseSoFar).material, keysSoFar, false, 'plain_budget');
}

// 用户回来了没有：离开够久就记一笔（剧情里也过去这么多天）。"世界等我"模式、预览都不记。
// 面板上"暂停离开计时"勾着就不记；取消暂停的那一刻起重新计（暂停期间不算离开）。
// 离开是离开这一局：同一局的别的窗口（分支）里最近还在玩，就不算离开。
export function absencePaused(store) { return store.getMeta?.('absence_paused') === '1'; }
// 离开时剧情照现实过还是世界等你：按局设（9/27 审计：一局停在打斗中途、一局是慢生活，全局一个设置只能二选一）。
// 这一局在面板上选过就按它；没选跟着配置的 absence.mode（默认照现实过）。
export function absenceModeOf(store, chatKey, absence) {
    const storyId = store.requireChat?.(chatKey)?.story_id;
    const own = storyId ? store.getMeta?.(`absence_mode:${storyId}`) : null;
    return own === 'pause' || own === 'real' ? own : absence?.mode === 'pause' ? 'pause' : 'real';
}
const awayOff = (store, chatKey, absence) => absenceModeOf(store, chatKey, absence) === 'pause' || absencePaused(store);
export function noteAbsence(store, chatKey, absence) {
    if (playModeOf(store, chatKey) === 'memory') {
        // 复用暂停计时的基点：恢复完整后不补算只记忆期间的离开。
        // 键是 absence_resumed_at:<局>（记忆模式的基点）；全局键 absence_resumed_at（无后缀）是"暂停离开计时"的基点，
        // 由 server.mjs 的暂停开关读写、下面第 832 行读取，两者各管各的，不是同一件事。
        store.setMeta?.('absence_resumed_at:' + store.requireChat(chatKey).story_id, String(Date.now()));
        return null;
    }
    if (!store.putAbsence || absence?.record === false || awayOff(store, chatKey, absence)) return null;
    const memoryKey='absence_resumed_at:' + store.requireChat(chatKey).story_id;
    const wasMemory=store.getMeta?.(memoryKey)!=null;
    if(wasMemory) { store.setMeta?.(memoryKey,null); store.setMeta?.('act:'+chatKey,JSON.stringify({last:Date.now()})); store.setMeta?.('gap:'+chatKey,null); return null; }
    const resumed = Number(store.getMeta?.('absence_resumed_at'));
    // 这个窗口里删掉的消息上玩过的时间也算（10/3：删回去重来以后，删掉的那几条上玩过的时间被忘了，一下算出离开了 27.9 小时）
    const goneSent = Number(store.getMeta?.(`gone_sent:${chatKey}`));
    // 离开按窗口算（A1/D-260）：不再用同一局别的窗口的动静抵消这个窗口的离开。
    const since = Math.max(Number.isFinite(resumed) && resumed > 0 ? resumed : -Infinity, Number.isFinite(goneSent) && goneSent > 0 ? goneSent : -Infinity);
    const minHours = absence?.minHours ?? 24, maxDays = absence?.maxDays ?? 30;
    const messages = store.currentMessages(chatKey), now = Date.now();
    // 离开＝这个窗口多久没有任何动静（10/3 用户：没输入、没删、没改）。同步时记下的"没动静"那一段（store.touch），
    // 或者此刻离上一次动静已经够久（玩家刚回来、新的那句还没同步过来）；组这一格本身也算一次动静。
    let act = null, quiet = null;
    try { act = JSON.parse(store.getMeta?.(`act:${chatKey}`) ?? 'null'); quiet = JSON.parse(store.getMeta?.(`gap:${chatKey}`) ?? 'null'); } catch {}
    if (act?.last) {
        if (!quiet || quiet.used) quiet = now - act.last >= minHours * HOUR_MS ? { from: act.last, to: now, fromFp: messages.at(-1)?.fp ?? null } : null;
        store.setMeta(`act:${chatKey}`, JSON.stringify({ last: now }));
        if (!quiet) return null;
        store.setMeta(`gap:${chatKey}`, JSON.stringify({ ...quiet, used: true }));
        const from = Math.max(quiet.from, Number.isFinite(resumed) && resumed > 0 ? resumed : -Infinity);
        const hours = (quiet.to - from) / HOUR_MS;
        if (hours < minHours || !quiet.fromFp) return null;
        return store.putAbsence({ chatKey, fromFp: quiet.fromFp, toFp: null, startedAt: new Date(from).toISOString(), endedAt: new Date(quiet.to).toISOString(),
            hours: Math.round(hours * 10) / 10, days: Math.min(maxDays, Math.max(1, Math.round(hours / 24))) });
    }
    // 还没记过动静的窗口（刚接入、老数据）：按消息时间算一次，从此刻起记动静。
    store.setMeta?.(`act:${chatKey}`, JSON.stringify({ last: now }));
    // 分支刚开出来：分叉前继承的旧消息可能很久以前，起点不能早于开分支那一刻（joined_at），否则把继承来的旧消息当成离开的起点。
    // 只对分支（有 parent_key）生效；新接入的独立局照旧按消息时间算（lead 拍板：A1 只要求别的窗口不抵消本窗口的离开）。
    const chat = store.requireChat(chatKey);
    const branchFloor = chat?.parent_key ? Date.parse(chat.joined_at ?? '') : -Infinity;
    const floor = Math.max(Number.isFinite(since) ? since : -Infinity, Number.isFinite(branchFloor) ? branchFloor : -Infinity);
    const gap = detectGap(messages, now, { minHours, maxDays, since: Number.isFinite(floor) ? floor : null });
    return gap ? store.putAbsence({ chatKey, ...gap }) : null;
}
const HOUR_MS = 3600000;

// 回来后第一次开口前：离开期间的推演（absence.think，模型推各人这些天）还没好就等一会儿（至多 90 秒），好了再给那一格；
// 等不到就照旧给程序那几行。只等该拿回来那一段的人。
// 至多等 AWAY_WAIT：前台速度要紧（D-100），推演要一两分钟，用户先开口时多半等不到；等不到就先不带推演、不钉住。返回 true＝还没推好。
const AWAY_WAIT = 10000;
async function awaitAway(store, chatKey, speaker, absence) {
    if (!absence?.think || awayOff(store, chatKey, absence)) return false;
    const messages = store.currentMessages(chatKey);
    const due = dueReturn(store.absences?.(chatKey) ?? [], { speaker, lastPos: messages.at(-1)?.pos ?? 0 });
    if (!due || due.story_status === 'ready' || due.story_status === 'failed') return false;
    let timer;
    const done = await Promise.race([
        absence.think({ chatKey, absenceId: due.id }).then(() => true, () => true),
        new Promise(r => { timer = setTimeout(() => r(false), absence.waitMs ?? AWAY_WAIT); }),
    ]);
    clearTimeout(timer);
    return !done;
}

// 回来后的第一轮该给他的那段推演（extrasFor 给、守门先算额度都用这一份，两处行号对得上）：没到时候是 null
function awayDue(store, chatKey, { speaker, name, userName = null, camera = false, absence = null, same = (a, b) => a === b }) {
    const lastPos = store.currentMessages(chatKey).at(-1)?.pos ?? 0;
    const due = camera || awayOff(store, chatKey, absence) ? null : dueReturn(store.absences?.(chatKey) ?? [], { speaker, lastPos });
    if (!due) return null;
    const fresh = (store.absences?.(chatKey) ?? []).find(a => a.id === due.id) ?? due;   // 推演可能刚写好
    const opening = lastPos === fresh.from_pos;
    return { due, fresh, opening, away: awayLines(fresh.story, { name, userName: userName ?? '对方', same, opening }) };
}

// 旧事之外的几块，都是程序算的：聊到钱时的行情与他知道的账；用户离开后回来的第一轮；
// 平时轮到这一轮第一个开口的人时，看要不要递一个"不在场的人来联系"。
// camera（N-276）：镜头开口——name 是玩家（照玩家的眼睛看），不给"回来那一段"、关系、追问这些属于某个人的
function extrasFor(store, records, { chatKey, speaker, speakerName, anchor = null, recent = [], recentUser = '', present = [], camera = false }, { economy = null, contacts = null, absence = null, planner = null, world = null, factions = null, situation = null, pendingAway = false, pendingLedger = null, slot = null, backstoryPick = null, drift = null, promised = null, pace = null, mood = null, guard: given = null }, base) {
    const drama = fullPlay(store, chatKey);
    const ts = scaleFor(store, chatKey);   // 这一局的时间尺度（章程 G2）
    // 她的身子她说了算（bodyGuardFor）：记账来的几块（规矩、心里没过去的、生活现状、碰上了／来意、还想知道的）拿 fed，不拿 visible
    const guard = given ?? bodyGuardFor(store, records, chatKey, { anchor, recentUser, knower: camera ? null : speakerName || speaker });
    const name = speakerName || speaker;
    // 场面表是统一的读口；拿不到时继续沿用本函数原有判断。
    let board = null;
    try {
        const boardMessages = anchor ? uptoAnchor(store.currentMessages(chatKey), anchor) : store.currentMessages(chatKey);
        board = boardFor(store, records, chatKey, { anchor, present, recentUser, timeline: timelineFor(store, records, chatKey, boardMessages) });
    } catch {}
    const { material, queryKeys = [] } = base;
    const lines = [], blocks = [];
    const add = (tier, arr, place = 'now', scope = 'person') => { if (arr?.length) { blocks.push({ tier, lines: arr, place, scope }); lines.push(...arr); } };
    let contact = null;
    const table = economy?.table ?? null;
    // 上一条：最近一条不是用户这句的消息（先开口的人可能正在问价）。
    const last = [...recent].reverse().find(t => t && t !== recentUser) ?? '';
    const talk = [recentUser, last].join('\n');
    const visible = records.visible(chatKey);
    const fed = visible.filter(guard.keep);
    const storyId = store.requireChat(chatKey).story_id;
    const roster = store.getCast?.(storyId) ?? [];
    const rosterNames = roster.map(e => e.name);
    const rawRel = store.relationsOf?.(storyId);
    const rel = rawRel ? normalizeRelations(rawRel) : null;
    const me = rel ? personOf(rel, name, rosterNames) : null;
    const priceOf = tiers => tierPrice(table, tiers);
    let prices = matchPrices(table, talk, queryKeys);
    // 物价按周小幅波动（drift.mjs）：给的价码按这一周的行情改
    if (prices.items.length && drift?.prices !== false) {
        const msgs = store.currentMessages(chatKey), lp = msgs.at(-1)?.pos ?? 0;
        const day = dayIndex([...visible.filter(r => r.type === '时间'), ...timeMarksFor(store, records, chatKey, msgs)], lp, scaleFor(store, chatKey))(lp + 0.5);
        prices = { ...prices, items: driftItems(prices.items, { seed: storyId, day, timeScale: ts }) };
    }
    // 真在聊钱才给：用户这句提到钱或活儿；或者上一条提到钱、又对得上某个价码。只是字面碰上某个价目的检索词（"急救"）不算。
    const moneyTalk = talksMoney(recentUser, table) || talksJobs(recentUser)
        || ((talksMoney(last, table) || talksJobs(last)) && (prices.items.length || prices.jobs.length || prices.gear.length));
    const front = slot?.front ?? { prices: false, fixers: false, seeds: true };
    if (moneyTalk) {
      // 他自己的账（谁欠谁、他知道的那几笔）照给；这个世界的行情和看人要价是事实类的，开关打开、或者开口的是派活的人才给
      if (front.prices || givesWork(me)) {
        // 用户这句明说了这单开价多少（只认活儿相关的话里、最大的那个数）
        const offered = talksJobs(recentUser) ? Math.max(0, ...amountsIn(recentUser)) || null : null;
        // 活儿的单价、抽成、到手多少只给派活的人（试玩 9/30）。开口的是派活的人、聊的是活又没点到哪一档：只给他派的那几档（关系表"派活"），不是全表。
        const giving = givesWork(me);
        const own = giving && !prices.jobs.length && talksJobs(talk) ? tiersNamed(table, me.派活) : [];
        const seen = giving ? (own.length ? { ...prices, jobs: own } : prices) : { ...prices, jobs: [] };
        add(0, priceLines(table, seen, { showJobs: giving && talksJobs(talk), offer: giving ? offered : null, giver: giving }), 'recall', 'person');
        // 卖家看人要价（用户 9/30）：在场的人（含开口的人和玩家）关系表里写了身价的，对上价表的那一档；只在他的身价管得着的那类买卖上说
        const who = [...new Set([name, ...present])].map(n => ({ name: n, text: rel ? personOf(rel, n, rosterNames)?.身价 : '' })).filter(p => p.text);
        // 地下的买卖（价表 standing.underground 的词：情报、武器、装备、黑客软件……）说到了，没对上价目也算
        const shady = (table?.standing?.underground ?? []).some(k => k && talk.includes(k)) ? [{ name: '地下的买卖', scope: '地下' }] : [];
        const goods = [...prices.items.map(e => ({ ...e, scope: scopeOf(e) })), ...prices.gear.map(e => ({ ...e, scope: scopeOf(e, 'gear') })), ...shady];
        add(0, standingLines(table, who, { jobs: giving && talksJobs(talk), items: goods }), 'recall', 'person');
      }
        const closedMoney = new Set((pendingLedger?.items ?? []).filter(x => x.kind === '钱' && x.status === '办了').map(x => x.source?.id).filter(x => x != null));
        add(0, moneyLines(buildLedger(visible, { knower: name, named: namedParties(roster, [...store.currentMessages(chatKey)].reverse().find(m => m.is_user)?.name) }), { name, when: material.when, currency: table?.currency ?? '', involves: present, closed: closedMoney }), 'recall', 'person');
        // 手上还剩多少（N-266）：他自己的；开局单写了他知道谁开场有多少的，那个人的（按他知道的进出算）
        const left = balanceLines(visible, { name, start: store.setupOf?.(store.requireChat(chatKey).story_id)?.data?.钱 ?? [], currency: table?.currency ?? '' });
        if (left.length) add(0, ['手上的钱（按记下的进出算的大概数）：', ...left], 'recall', 'person');
    }

    // 住处（用户 10/1）：聊到租房、买房、住处时给要找的那一档（不受"行情给不给前台"那个开关管：用户要前台拿到这一档）
    if (table) add(0, housingLines(table, matchHousing(table, talk, queryKeys)), 'recall', 'person');
    // 素材包的常识（facts.mjs）：说到了才给那一两条
    if (world?.facts?.length) add(1, factLines(matchFacts(world.facts, [talk, ...queryKeys].join('\n'))), 'recall', 'person');

    const messages = store.currentMessages(chatKey);
    const lastPos = messages.at(-1)?.pos ?? 0;
    const absences = store.absences?.(chatKey) ?? [];
    const timeRecs = visible.filter(r => r.type === '时间'), marks = timeMarksFor(store, records, chatKey, messages);
    const dayOf = dayIndex([...timeRecs, ...marks], lastPos, scaleFor(store, chatKey));
    // 玩家回来后按玩家说的重推离开期间：在折那一步（advanceWorld）
    // 记下的日子（不算还没记账的那几条里临时认的跳转）：回不来的事——口袋沉底、节点检查——只按它来（9/27 审计：临时认错了一天，那件沉了就回不来）。
    const firmDayOf = marks.some(m => m.provisional) ? dayIndex([...timeRecs, ...marks.filter(m => !m.provisional)], lastPos, scaleFor(store, chatKey)) : dayOf;
    const userName = [...messages].reverse().find(m => m.is_user)?.name ?? null;
    const openIdeaIds = new Set(records.openIdeas(chatKey).map(r => r.id));
    const closenessOf = (person, entry = roleOf(roster, person)) => closeness({ name: person, userName, entry, records: visible, dayOf, lastPos, openIdeaIds });
    const boardPresent = board?.people?.filter(p => p.status === 'present' || p.status === 'remote').map(p => p.name) ?? null;
    const people = () => absentPeople({ records: visible, messages, present: boardPresent ?? present, userName, roster, openIdeaIds, closenessOf, dayOf, timeScale: ts });

    // 用户用 /写 /玩 说的这阵子想要的（原话）：同一个剧情日、30 条以内有效，换了一天或过了就退场。
    const today = dayOf(lastPos + 0.5);   // 离开记在最后那条之后半格：回来由角色先开口时，今天已经是离开之后
    const firmToday = firmDayOf(lastPos + 0.5);
    // 场记里说"哪天"都用这一种写法（timeline.timeTag，用户 10/14：别再昨天前天乱记）：tagDay(第几格)、ago(几格以前)
    const timeStart = store.setupOf?.(store.requireChat(chatKey).story_id)?.data?.时间 ?? null;
    const tagDay = n => timeTag(n, { start: timeStart, today, timeScale: ts }), ago = d => tagDay(today - d);
    // 平常戏里还没过去的（mood.mjs）：记账的"改变"里持续几天、几周的；这一格已经当旧事、现状给了的不重复。
    const linger = lingerLines(fed, { name, userName, dayOf, today, lastPos, timeScale: ts, when: ago, skip: new Set([...material.hits, ...material.state].map(r => r.id)) });
    const notes = store.notesOf?.(chatKey) ?? [];
    const live = notes.filter(n => n.kind !== '聊' && n.story_day === today && lastPos - (n.pos ?? lastPos) <= NOTE_WINDOW);
    if (live.length) add(0, [`${userName ?? '玩家'}这阵子想要的（原话，场面换了就不用管）：`, ...live.map(n => `· ${n.kind === '写' ? '写法' : '玩法'}：${n.text}`)], 'now', 'reply');
    const closedRules = new Set((pendingLedger?.items ?? []).filter(x => x.kind === '规矩' && ['失效', '办了'].includes(x.status)).map(x => x.source?.id).filter(x => x != null));
    add(0, agreedLines(fed, { name, dayOf, today, closed: closedRules, when: ago }), 'base', 'person');
    // 他刚进场的那一份（进场、发消息打电话来的）：生活现状和下面的进场那几行都要看
    let arr = null;
    try { arr = JSON.parse(store.getMeta?.(`arrived:${chatKey}`) ?? 'null'); } catch {}
    // D-169（试玩 10/6）：理进场那份比他开口慢、旧的那份按条号对上了，他用了已经删掉的那一回——现在认那条的指纹
    const arrLive = !!(arr?.who && sameName(arr.who, name, rosterNames) && (arr.fp == null || (m => !!m && (m.fp === arr.fp || !!store.sameMessage?.(m.fp, arr.fp)))(messages.find(m => m.pos === arr.at - 1))));
    // 远程：进场那份写的是消息、电话，而且还没当面碰上（场面表认，metInPerson）
    const remote = arrLive && isRemote(arr.how) && (board?.people?.find(p => sameName(p.name, name, rosterNames))?.status ?? 'remote') === 'remote';
    // 他那头：接通以后他那几条里写到的他自己的位置（此刻的样子读出来的；用户 10/8：他在他那头走动，不在镜头这间屋里）
    const uptoPos = anchor ? (uptoAnchor(store.currentMessages(chatKey), anchor).at(-1)?.pos ?? lastPos) : lastPos;
    const hisNow = remote ? (foldState((store.stateNotesOf?.(chatKey) ?? []).filter(n => n.pos >= (arr.at ?? 0) && n.pos <= uptoPos)).find(n => n.aspect === '位置' && sameName(n.who, name, rosterNames))?.text ?? '') : '';
    // 生活现状（N-288）：他知道的住处、衣服、身边的东西每次都带；家里的样子镜头在那儿才给。换掉的就不在表里，不会越攒越多。
    // 开局单写了开场时的样子就先铺上（他是那人、或在"还有谁知道"里），聊天里的变化往上改。名字照关系表认（开局单写"甲"、聊天里叫"甲某"）
    // 开局单"人物开场状态"里的身体那几条（opening.mjs）也铺在底下：好了、加重了，记账跟着改
    const lifeData = store.setupOf?.(store.requireChat(chatKey).story_id)?.data ?? null;
    const asUser = x => ({ ...x, 谁: String(x.谁).replace(/\{\{user\}\}/g, userName ?? '玩家'), 谁知道: (x.谁知道 ?? []).map(k => String(k).replace(/\{\{user\}\}/g, userName ?? '玩家')) });
    const lifeRows = [...(lifeData?.生活现状 ?? []), ...bodyRows(lifeData)].map(asUser);
    if (!camera) {
        const same = (a, b) => sameName(a, b, rosterNames) || (!!rel && !!personOf(rel, a, rosterNames) && personOf(rel, a, rosterNames) === personOf(rel, b, rosterNames));
        const seed = seedOf(lifeRows, x => knowsRow(x, name, same));
        const sheet = lifeSheet(fed.filter(r => r.holder_name === name || (r.audience ?? []).includes(name)), { same, names: [...rosterNames, userName].filter(Boolean), seed });
        // 镜头在哪：此刻的样子里的位置（在场的人的；不在场的人上回躺在哪张床上，不说明镜头在那屋里）、周围，加最近两条括号里的叙述（扩展带来的，玩家刚发的那句可能还没同步；对白里说到"家"不算）
        const narration = t => (String(t ?? '').match(/（[^）]*）|\([^)]*\)/g) ?? []).join(' ');
        const scene = [board?.camera?.place, board?.fast?.place, ...foldState(store.stateNotesOf?.(chatKey) ?? []).filter(n => n.aspect === '周围' || (n.aspect === '位置' && [name, ...present].some(p => sameName(p, n.who, rosterNames)))).map(n => n.text), ...[...recent.slice(-2), recentUser].map(narration)].filter(Boolean).join('\n');
        // 他是发消息、打电话来的：人不在那处住处，家里的样子不给（试玩 10/6：他在摊子上发短讯，那一格写着"这处住处现在的样子，镜头就在这儿"）
        add(0, lifeLines(sheet, { name, present: remote ? [] : present, scene: remote ? '' : scene, same, names: [...rosterNames, userName].filter(Boolean), board: remote ? null : board }), 'base', 'person');
        // 他在他自己住的地方发消息、打电话（用户 10/8：他屋里添了什么没给他，前文买的被褥被写成了别的料子）：那处的样子给他，镜头不在那儿
        if (remote) add(0, ownHomeLines(sheet, { name, where: [arr.where, hisNow].filter(Boolean).join('；'), same, names: [...rosterNames, userName].filter(Boolean) }), 'base', 'person');
    } else {
        // 旁白：这处住处现在的样子是这地方的事（镜头在屋里就得知道新门、新面板），按全部记录折，不按谁知道
        const same = (a, b) => sameName(a, b, rosterNames) || (!!rel && !!personOf(rel, a, rosterNames) && personOf(rel, a, rosterNames) === personOf(rel, b, rosterNames));
        const seed = seedOf(lifeRows.filter(x => x.类 !== '身体'));
        const sheet = lifeSheet(visible, { same, names: [...rosterNames, userName].filter(Boolean), seed });
        const narration = t => (String(t ?? '').match(/（[^）]*）|\([^)]*\)/g) ?? []).join(' ');
        const scene = [board?.camera?.place, board?.fast?.place, ...foldState(store.stateNotesOf?.(chatKey) ?? []).filter(n => n.aspect === '周围' || (n.aspect === '位置' && [name, ...present].some(p => sameName(p, n.who, rosterNames)))).map(n => n.text), ...[...recent.slice(-2), recentUser].map(narration)].filter(Boolean).join('\n');
        add(0, homeLines(sheet, { present, scene, same, names: [...rosterNames, userName].filter(Boolean), board }), 'base', 'scene');
        // 在场的人身上一直带着的（没好的旧伤、靠药撑着……）：照玩家知道的（用户 10/9，开局单"人物开场状态"的身体）
        if (userName) {
            const known = lifeSheet(fed.filter(r => r.holder_name === userName || (r.audience ?? []).includes(userName)), { same, names: [...rosterNames, userName], seed: seedOf(lifeRows, x => knowsRow(x, userName, same)) });
            add(0, lifeLines(known, { name: userName, present, same, names: [...rosterNames, userName], only: '身体' }), 'base', 'scene');
        }
    }
    // 刚进场的有卡的人（N-292）：进场时理好的怎么来的、为什么来、到场那一刻看得见什么——他进场后头两回开口带着
    let stance = null;
    if (!camera) {
        const boardPerson = board?.people?.find(p => sameName(p.name, name, rosterNames));
        const live = boardPerson ? boardPerson.status === 'remote' : arrLive;
        const spoke = arrLive ? messages.filter(m => m.pos >= arr.at && !m.is_user && m.name === name).length : 0;
        // 发消息、打电话来、又已经当面碰上了的：进场那份（人不在这儿）不再给，换一句他就在这儿
        const metNow = !!boardPerson && boardPerson.status !== 'remote' && arrLive && isRemote(arr.how);
        // 镜头外求证的回话（offstage.mjs，用户 10/8）：他隔着消息、电话问过不在场的人，后台替那人回了——他开口时带上，直到他开过口
        let rp = null;
        try { rp = JSON.parse(store.getMeta?.(`offstage_reply:${chatKey}:${name}`) ?? 'null'); } catch {}
        // 他在回话写下之后开过口，就不再带——按眼下的消息认，他那条删了又带上（不看存下的 used，方案 删消息等于没发生过）
        if (rp && messages.some(m => m.pos === rp.pos && m.fp === rp.fp) && !messages.some(m => m.pos > (rp.at ?? rp.pos) && !m.is_user && m.name === name)) add(0, replyLines(rp, { name }), 'now', 'moment');
        // "此刻能做的"（options.mjs）要知道他是隔着电话、消息，刚到，还是就在这儿：场面表认的为准，没有就看他这次进场
        const remoteNow = !metNow && (boardPerson ? boardPerson.status === 'remote' : arrLive && isRemote(arr.how));
        const justCame = !metNow && !remoteNow && arrLive && lastPos - arr.at <= ARRIVAL_SPAN && spoke < 2;
        stance = { status: remoteNow ? 'remote' : justCame ? 'arrived' : 'present', way: remoteNow ? (/电话|来电/.test(`${boardPerson?.way ?? ''} ${arrLive ? arr.how ?? '' : ''}`) ? '电话' : '消息') : '' };
        // 三选一：已经当面碰上了／刚接通、刚到（头两回）／人不在这儿（之后每回）
        if (metNow) add(0, [`（${name}刚才还在外头发消息、打电话，眼下已经和${userName ?? '对方'}当面碰上了：人就在这儿，看得见、碰得着。）`], 'now', 'moment');
        else if (arrLive && lastPos - arr.at <= ARRIVAL_SPAN && spoke < 2) add(0, arrivedLines({ ...arr, now: hisNow, userName: userName ?? '对方' }), 'now', 'moment');
        else if (live && arr && isRemote(arr.how)) add(0, [remoteLine({ ...arr, now: hisNow, userName: userName ?? '对方' })], 'now', 'scene');
        // 打电话来的人：玩家此刻实际在哪、什么样子（用户 10/7："要不让他收到我位置和状态的场记"）——是镜头知道的，不是他知道的；
        // 给了他就不会照上回的印象替玩家编出一辆车来。发消息来的不给：他看不见也听不见，给了他就照着写（用户 10/9："他是发消息，场景不该是吧台边"）
        if (live && arr && /电话|来电/.test(arr.how ?? '') && userName) {
            const upto = anchor ? (uptoAnchor(store.currentMessages(chatKey), anchor).at(-1)?.pos ?? lastPos) : lastPos;
            const mineNow = foldState((store.stateNotesOf?.(chatKey) ?? []).filter(n => n.pos <= upto)).filter(n => sameName(n.who, userName, rosterNames) && ['位置', '穿着'].includes(n.aspect)).map(n => n.text);
            add(0, playerThereLines({ who: name, userName, place: board?.camera?.place ?? '', now: mineNow }), 'now', 'scene');
        }
    }

    // 持续几周的事（drift.mjs，N-93）：不每轮都念——镜头此刻在它的地段、玩家这句提到了它、或这个剧情日还没给过他，才给他会知道的那一件（同时只一件）；
    // 走完了给一次"过去了"。给过的记在 long_told 里，挂在当时最后那条消息上：那条删了就当没给过，同一条上重来（重新生成）照样再给。
    if (drift?.long !== false) {
        let events = [];
        try { events = JSON.parse(store.getMeta?.(`long_events:${storyId}`) ?? '[]'); } catch {}
        if (events.length) {
            const who = camera ? '(旁白)' : name;
            const fpAt = new Map(messages.map(m => [m.pos, m.fp]));
            let told = [];
            try { told = JSON.parse(store.getMeta?.(`long_told:${storyId}`) ?? '[]'); } catch {}
            told = told.filter(t => t && fpAt.get(t.pos) === t.fp);
            const earlier = told.filter(t => t.who === who && t.pos < lastPos);
            const give = longGive(events, { day: today, lastPos, timeScale: ts, name: camera ? userName ?? name : name, sameName: (a, b) => sameName(a, b, rosterNames), when: tagDay,
                place: remote ? '' : [board?.camera?.place, board?.fast?.place].filter(Boolean).join('\n'), talk: recentUser ?? '',
                heard: (kind, k) => earlier.some(t => t.kind === kind && t.k === k && (kind === '过去了' || t.day === today)) });
            add(2, give.lines, 'world', 'scene');
            const at = messages.at(-1);
            const fresh = give.told.filter(g => !told.some(t => t.who === who && t.pos === lastPos && t.kind === g.kind && t.k === g.k));
            if (planner?.record !== false && at && fresh.length) store.setMeta?.(`long_told:${storyId}`, JSON.stringify([...told, ...fresh.map(g => ({ ...g, who, day: today, pos: at.pos, fp: at.fp }))].slice(-300)));
        }
    }
    // 别人讲到一半停下的（N-124）：他在场听了一半，过后还惦记着——有空当可以追问，讲完了（记账"了结"）就不再给。
    // 群像里不在群里的人（N-274）：最近几条写到的、至少两个，提一句带一笔
    if (!camera) add(2, crowdLines({ messages, present, name, userName, rel, rosterNames, board,
        player: rel && userName ? (p => (p ? [p.名, ...p.又名] : []))(personOf(rel, userName, rosterNames)) : [] }), 'now', 'moment');
    if (!camera) add(1, askLines(fed, { name, openIds: new Set(records.openIdeas(chatKey).map(r => r.id)), lastPos: messages.at(-1)?.pos ?? 0, when: material.when }), 'recall', 'person');
    // 他眼里眼前这几个人（和玩家这句说到的人）之间是什么样（用户 10/9："这个关系只当做当事人视角的观察，影响该角色判断"）：
    // 只从他亲眼看见过的两人互动里来，只说样子，不说事
    if (!camera) {
        const sameP = (a, b) => sameName(a, b, rosterNames) || (!!rel && !!personOf(rel, a, rosterNames) && personOf(rel, a, rosterNames) === personOf(rel, b, rosterNames));
        const talked = rosterNames.filter(n => n && n !== CAMERA_NAME && String(recentUser ?? '').includes(n));
        add(1, pairImpressions(visible, { viewer: name, people: [...present, userName, ...talked].filter(Boolean), same: sameP, aliases: n => [n, ...(rel ? personOf(rel, n, rosterNames)?.又名 ?? [] : [])] }), 'base', 'person');
    }
    // 开局单：他对眼前的人的称呼和态度；他知道的前事里和眼下的话有关的（只给他知道的那一版）。
    const leaks = activeLeaks(store, records, chatKey);
    const setup = staleBackstory(withSecretLeaks(store.setupOf?.(store.requireChat(chatKey).story_id)?.data, leaks), visible, userName);
    add(0, leaks.filter(x => x.source === 'plan' && sameName(x.谁知道了, name, rosterNames)).map(x => `· ${x.事}`), 'recall', 'person');
    if (setup) {
        if (setup.玩家性别 === '其他') add(0, ["玩家的角色不用'他''她'称呼，直接叫名字。"], 'base', 'person');
        const sl = { name, present, talk: [talk, ...queryKeys].join('\n'), roster: roster.map(e => e.name), pick: backstoryPick };
        add(0, slotLines(setup, { ...sl, only: 'base' }), 'base', 'person');
        // 和眼下的话有关才挑上来的前事是想起来的，不是一直挂着的：放在想起的那一块（方案"场记的分量与连续性"：开局单的细节靠召回）
        add(0, slotLines(setup, { ...sl, only: 'recall' }), 'recall', 'person');
    }
    // 人物开场状态（opening.mjs，用户 10/9）：开场那天各人在哪、在干什么，开场时心里带着的——他自己和知道的人带着（旁白照玩家知道的）。
    // 那人开场以后进过场、走开过，或者开场那场戏过去了他一直在场，他"开场在哪"就不再给
    if (setup?.开场状态?.length) {
        const gone = who => {
            const bp = board?.people?.find(p => sameName(p.name, who, rosterNames));
            if (!bp) return lastPos >= OPEN_SCENE;
            if (bp.status === 'away') return !bp.plan?.seed;
            if (bp.status === 'present' || bp.status === 'remote') return (bp.since ?? 0) > 1 || lastPos >= OPEN_SCENE;
            return false;
        };
        add(0, openingLines(setup, { knower: camera ? userName : name, same: (a, b) => sameName(a, b, rosterNames), today, startDay: dayOf(0), lastPos, gone, userName }), 'base', camera ? 'scene' : 'person');
    }

    // 人物关系表：他的地盘；他和在场的人的关系（口径已经写了的不重复）；这一局第一次开口时，故事开始时他知道的、眼前的人在他眼里的样子；
    // 聊天里说到的派活的人（点了名，或聊活儿时点到他管的那一片）——原来写在世界书里、从没触发过的那一类，改由这里按需递。
    if (rel && !camera) {
        const covered = to => !!setup?.口径?.some(x => sameName(x.谁, name, rosterNames) && sameName(x.对谁, to, rosterNames));
        const firstTime = !messages.some(m => !m.is_user && m.name === name);
        // 他和在场的人的关系是他怎么对待眼前这个人的底子（边界、分寸都在这一行）：不让。
        // 试玩 10/4：那一格一超长，这一段（连同"不强行介入"）整段被让掉，从早上起一直没给到前台。地盘本事、第一次见面的介绍照旧可以让。
        // 关系那一行"后来："之后的那段（规划、记账写的）：说她伤病的那一截拿掉，其余照留（bodyGuardFor）
        // 这一路（relations.pathLines，方案"场记的分量与连续性"第 1 步）：他和眼前的人一路的转折——记账的"关系"记录（他知道的）＋以前几份规划写的他那一侧。
        // 日子和"现在"那一行同一本日历（timelineFor），写成几月几日（第几天），不写昨天前天（用户 10/14："最大程度避免事件发生的时间错乱"）
        let path = null;
        try {
            const tl = timelineFor(store, records, chatKey, messages);
            const label = pos => timeTag(tl.dayOf(pos), { start: tl.start, today: tl.today, timeScale: tl.scale });
            const canonOf = n => personOf(rel, n, rosterNames)?.名 ?? String(n ?? '').trim();
            const meC = canonOf(name);
            const relRecs = visible.filter(r => r.type === '关系' && r.relation?.with && (r.holder_name === name || (r.audience ?? []).includes(name)));
            const snaps = (drama ? store.readyPlans?.(chatKey) ?? [] : []).flatMap(p => { let n = null; try { n = JSON.parse(p.node ?? 'null'); } catch {} return (n?.关系 ?? []).filter(x => canonOf(x.谁) === meC && x.现在).map(x => ({ pos: p.anchor_pos ?? -1, text: x.现在, from: '规划', with: canonOf(x.对谁) })); });
            // 规划交的"这一段留下的"（第 4 步）：那一步走出来了，带分量；3 是转折，一直留着
            const lefts = (drama ? store.readyPlans?.(chatKey) ?? [] : []).flatMap(p => { let n = null; try { n = JSON.parse(p.node ?? 'null'); } catch {} return (n?.留下 ?? []).filter(x => canonOf(x.谁) === meC && x.留下的).map(x => ({ pos: (p.anchor_pos ?? 0) - 0.5, text: x.留下的, from: '规划留下', weight: x.分量, with: canonOf(x.对谁) })); });
            const clean = es => es.filter(e => guard.lines([e.text]).length);   // 她的身子她说了算：说她伤病的那几步不给（body.mjs）
            path = { label, entriesFor: other => clean([
                ...relRecs.filter(r => { const a = canonOf(r.holder_name ?? r.holder), b = canonOf(r.relation.with); return (a === meC && b === other) || (a === other && b === meC); })
                    .map(r => ({ pos: r.pos, text: bareText(r.text), from: '记账' })),
                ...snaps.filter(x => x.with === other), ...lefts.filter(x => x.with === other)]) };
        } catch { path = null; }
        const relAll = relationLines(rel, { name, present, roster: rosterNames, firstTime, sees: stance?.status !== 'remote', covered, current: guard.relations(relationsNow(store, chatKey, rel, visible, rosterNames)), lastPos: messages.at(-1)?.pos ?? null, path });
        const { ties, rest } = splitTies(relAll, name);
        add(0, ties, 'base', 'person');
        add(2, rest, 'base', 'person');
        if (front.fixers) add(0, mentionLines(rel, { talk, jobTalk: talksJobs(talk), present: [...present, name], roster: rosterNames, priceOf: givesWork(me) ? priceOf : undefined }), 'recall', 'person');
    }
    // 势力账（factions.mjs，Q-8）：他知道的约定、暗线、各方关系；他自己是一方、还没了结的约定一直给，别的只在眼下沾边时给。
    const resolve = nameResolver(factions?.net ?? null);
    const ledger = factionLedger(visible, { view: name, resolve, dayOf });
    // 他是哪家的：关系表里他"现在"那一格写到的势力（势力网里的名字，或账里当过一方的）。
    const sideNames = [...new Set([...(factions?.net?.nodes ?? []).map(n => n.name), ...ledger.deals.flatMap(d => d.parties)])].filter(n => n && n.length >= 2 && !rosterNames.includes(n));
    const homes = me?.现在 ? sideNames.filter(n => me.现在.includes(n)) : [];
    // 他自己是一方的约定跟他自己牵头的事同一档让位
    add(1, factionSlotLines({ ledger, name, present, talk: [talk, ...queryKeys].join('\n'), homes, today, relDay: ago }), 'world', 'person');

    // 主角团的打算（用户 10/12，N-363／N-365："角色是活的，有问题自己找办法……角色没有自己想干的事、没有驱动，和没后台的时候一样"）：
    // 轮到主角团里的人开口（不是玩家、不是旁白），带上最新一份规划给他写的打算——想办成什么、手上在做什么、想拉她一起做什么；
    // 她眼下有难处时多一句"会为她做什么——去做，别光说"；团里两人这一段之间的事，对方此刻在场才给；镜头外他按打算办到哪也带着（crew.mjs）。
    // 放在"他这阵子心里、手上还挂着的"那一层（back），长度算进那一格；他自己的打算不让位（让掉了就又是没有驱动），团里那句跟他牵头的事同一档
    if (drama && !camera && userName && !sameName(name, userName, rosterNames)) {
        try {
            const sameP = (a, b) => sameName(a, b, rosterNames) || (!!rel && !!personOf(rel, a, rosterNames) && personOf(rel, a, rosterNames) === personOf(rel, b, rosterNames));
            const { plan, node } = latestNode(store, chatKey);
            const entry = node ? crewEntry(node, name, sameP) : null;
            const inCrew = !!entry && crewOf(store.setupOf?.(storyId)?.data ?? null, node, userName).some(n => sameP(n, name));
            // 要紧的人（不在主角团里、规划另写了心思的）：他开口时只给他那句心里的打算（N-368），别的主角团那几句没有
            const key = !inCrew && node ? keyPersonEntry(node, name, sameP) : null;
            const keyMind = key ? mindLine(key.心思, { keep: l => guard.lines([l]).length > 0 }) : null;
            if (keyMind) add(0, [keyMind], 'back', 'person');
            if (inCrew) {
                const herP = rel ? personOf(rel, userName, rosterNames) : null;
                const upto = anchor ? (uptoAnchor(messages, anchor).at(-1)?.pos ?? lastPos) : lastPos;
                const notes = foldState((store.stateNotesOf?.(chatKey) ?? []).filter(n => n.pos <= upto), sameP, { lastPos: upto });
                const trouble = herTrouble({ gate: { mode: guard.mode }, notes, userName, aliases: herP ? [herP.名, ...(herP.又名 ?? [])].filter(Boolean) : [], same: sameP });
                const { own, team } = crewLines({ name, userName, entry, present, trouble, same: sameP, keep: l => guard.lines([l]).length > 0,
                    pushed: pushedText(visible, { name, same: sameP, since: plan?.anchor_pos ?? -1 }) });
                add(0, own, 'back', 'person');
                add(1, team, 'back', 'person');
            }
        } catch {}
    }
    // 心里压着的事（held.mjs，用户 10/16）：他知道、压着不说的——最新一份规划写给他的（规划之后他自己说出口了的不算），加开局单前史里他压着的（记账标了过时＝说开了，不算）。
    // 给的是"此刻的处置"，不是"他知道 X"：只给 X，前台当场就说出口，误会和心事就没了分量。放在"他这阵子心里、手上还挂着的"那一层，不让位
    if (!camera && !(userName && sameName(name, userName, rosterNames))) {
        try {
            const sameP = (a, b) => sameName(a, b, rosterNames) || (!!rel && !!personOf(rel, a, rosterNames) && personOf(rel, a, rosterNames) === personOf(rel, b, rosterNames));
            const { plan, node } = latestNode(store, chatKey);
            const fromPlan = (drama ? node?.心事 ?? [] : []).filter(x => sameP(x.谁, name) && !saidSince(x, visible, { name, since: plan?.anchor_pos ?? -1, same: sameP }));
            const fromSetup = heldBackstory(setup, { name, present, roster: rosterNames });
            const held = heldLines({ name, items: [...fromPlan, ...fromSetup] });
            const kept = held.slice(1).filter(l => guard.lines([l]).length);   // 说她伤病的那一条照"她的身子"那道筛子去掉
            if (kept.length) add(0, [held[0], ...kept], 'back', 'person');
        } catch {}
    }

    // 回来后的第一轮：每个在场角色第一次开口时给；这几天找过来的只给第一个开口的。
    const same = (a, b) => sameName(a, b, rosterNames) || (rel && personOf(rel, a, rosterNames) && personOf(rel, a, rosterNames) === personOf(rel, b, rosterNames));
    const back = awayDue(store, chatKey, { speaker, name, userName, camera, absence, same });
    if (back) {
        const { due, fresh, opening, away } = back;
        const first = !due.seen.length;
        const attempts = first ? attemptsDuring(fresh, people(), { closenessOf }) : [];
        // 说她伤病的那一截切掉（bodyGuardFor：她这阵子没提身子时，"以为她伤得重、药还没送来"不跟着回来那一段一起给）
        add(0, [...guard.away(returnLines({ name, userName: userName ?? '对方', absence: fresh, open: material.open, attempts, first, level: away.length ? null : closenessOf(name).level, reasoned: away.length > 0, opening })), ...guard.away(away, fresh.id)]);
        // 推演还没回来就先不记"给过了"：左滑重来或下一轮还会带上这段，那时推好的就能用上。
        if (absence?.record !== false && !pendingAway) store.markAbsenceSeen(due.id, speaker);
        const carry = [...(away.length ? awayCarry(fresh.story, { name, userName: userName ?? '对方', same, id: fresh.id, days: fresh.days })
            : returnCarry({ name, userName: userName ?? '对方', absence: fresh, level: closenessOf(name).level })),
            ...(opening ? phoneCarry({ userName: userName ?? '对方', absence: fresh, attempts }) : [])];
        return { lines, blocks, contact, carry, linger, dayOf };
    }

    // 有卡的人谁能来、什么时候来：不再由这一格挑（D-175）——门的名单（door.mjs）列人选，旁白看时机留记号，玩家点了才进场。
    // 这里只认"不在场的有卡的人"：他牵头的口袋、来联系挑中的他，镜头都不替他演
    const cardOf = who => roster.find(e => hasCard(e) && e.name !== CAMERA_NAME && sameName(e.name, who, rosterNames)) ?? null;
    const boardPerson = who => board?.people?.find(p => sameName(p.name, who, rosterNames)) ?? null;
    const absentCard = who => {
        if (!cardOf(who)) return false;
        const bp = boardPerson(who);
        return bp ? !['present', 'remote'].includes(bp.status) : !present.some(p => sameName(p, who, rosterNames));
    };
    // 刚回来的那几条里不另递（这几天找过来的已经说过了）。
    const justBack = absences.at(-1)?.from_pos != null && lastPos - absences.at(-1).from_pos <= 8;
    if (contacts?.enabled !== false && recentUser && store.contactOffers && !justBack) {
        const offers = store.contactOffers(chatKey);
        const round = String(recentUser).slice(-300);
        const already = offers.find(o => o.round === round);
        if (!already || already.speaker === speaker) {
            // 有规划者在管：没出场过的人第一次露面只走菜单（规划者读得到名册和钩子，会排时候）；这里只递出场过的人，免得两边都往里引人。
            // 只跟着别人出现的人不单独联系人（关系表的"跟着"）。
            // 出场过的人得有由头才递：他和玩家之间有一件碰上了、还没下文的事（场记章程 #2），不再随机挑人
            const sameWho = (a, b) => sameName(a, b, rosterNames) || (!!rel && !!personOf(rel, a, rosterNames) && personOf(rel, a, rosterNames) === personOf(rel, b, rosterNames));
            const list = (planner?.provider ? people().filter(p => p.lastPos >= 0) : people()).filter(p => !(rel && leaderOf(rel, p.person, rosterNames)))
                .filter(p => p.lastPos < 0 || !!sharedMatter(visible, { person: p.person, userName, same: sameWho }));
            const pick = already ? list.find(p => p.person === already.person)
                : pickContact({ people: list, dayOf, lastPos, offers, minGap: contacts?.minGap ?? 16 });
            if (pick && camera && cardOf(pick.person)) {
                // 镜头不替有卡的人演：他进门的名单（door.mjs 的"可能来联系"），这一格不写他
            } else if (pick) {
                if (!already && contacts?.record !== false) store.putContactOffer({ chatKey, person: pick.person, day: today, at: lastPos, round, speaker });
                const withHim = rel ? followersOf(rel, pick.person, rosterNames) : [];
                const giver = rel ? personOf(rel, pick.person, rosterNames) : null;
                add(2, guard.lines([...contactLines(pick, { when: material.when, lastSeen: tagDay(dayOf(pick.lastPos)) }),
                    ...(withHim.length ? [`  （${withHim.join('、')}一直跟着${pick.person}）`] : []),
                    ...(givesWork(giver) ? [`  （${personWord(giver.名)}是派活的：${giverLine(giver, priceOf)}）`] : [])]), 'now', 'scene');
                contact = pick.person;
            }
        }
    }

    // 兴头（D-109 第 2 步，scene.mjs）：看场面冒出来的念头、邀约、街上的事，交给合适的人开口时用；给一次就算用过。
    if (store.getMeta && planner?.record !== false) {
        let imp = null;
        try { imp = JSON.parse(store.getMeta(`impulse:${chatKey}`) ?? 'null'); } catch {}
        // 用过了没有：交给谁那一下挂在被回的那条上，他那条回复还在才算用过（方案 删消息等于没发生过）——删了、换了别人开口，兴头回来；
        // 老数据只有 used: true，照旧算用过
        const impAnchor = (anchor ? uptoAnchor(messages, anchor) : messages).at(-1) ?? null;
        const spent = !!imp?.used && (typeof imp.usedAt !== 'object' || !imp.usedAt ? true
            : messages[imp.usedAt.pos]?.fp === imp.usedAt.fp && !!messages[imp.usedAt.pos + 1] && !messages[imp.usedAt.pos + 1].is_user && sameName(messages[imp.usedAt.pos + 1].name, imp.usedBy, rosterNames));
        const alive = imp && !spent && messages.some(m => m.pos === imp.at?.pos && (m.fp === imp.at?.fp || !!store.sameMessage?.(m.fp, imp.at?.fp))) && lastPos - imp.at.pos <= IMPULSE_LIFE;
        // 念头和就地的（冒一句、问你、斗嘴、顺手、亲近）只给起头的那个人；来邀、街上的事给哪个开口的都行
        const own = imp && (imp.kind === '念头' || IN_PLACE.has(imp.kind));
        // 发消息、打电话来的人不拿兴头：那是给在这儿的人的（试玩 10/7："往干燥暖和的后座里挤"给了在路口打电话的人，他就自己钻进了车里）
        const mine = alive && !remote && (own ? sameName(imp.who, name, rosterNames) || imp.who === name : !contact);
        if (mine) {
            // 念头、就地的是起头那个人的；来邀、街头的事是这地方的（旁白也拿）
            add(own ? 1 : 2, guard.lines(impulseLines(imp, { userName: userName ?? '玩家' })), 'now', own ? 'person' : 'scene');
            store.setMeta(`impulse:${chatKey}`, JSON.stringify({ ...imp, used: true, usedBy: name, usedAt: impAnchor ? { pos: impAnchor.pos, fp: impAnchor.fp } : null }));
            // 交出去的往事算讲过了：同一件一局只讲一回（D-112）
            if (imp.kind === '冒一句' && imp.tale?.text) {
                let told = [];
                try { told = JSON.parse(store.getMeta(`told:${storyId}`) ?? '[]'); } catch {}
                store.setMeta(`told:${storyId}`, JSON.stringify([...told, { who: imp.who, n: imp.tale.n, text: imp.tale.text, at: lastPos, fp: messages.at(-1)?.fp }].slice(-80)));
            }
        }
    }

    // 余波（方案"场记的分量与连续性"D 层）：他心里还没过去的那股劲，紧挨此刻的样子之前；和刚递到手上的同一档，不让位
    if (!camera && mood?.carry !== false) add(0, afterLines(fed, { name, dayOf, today, lastPos, timeScale: ts, tag: n => tagDay(n) }), 'now', 'person');
    // 此刻的样子（用户 9/30）：聊天里写到过的穿着、位置、天气……只给在场的人（开口的人、玩家）；每轮都带，没写到就没有
    add(0, stateBlock(store, { chatKey, name, present, userName, rosterNames, rel, dayOf, today, records, anchor, keepNote: guard.keepNote }), 'now', 'moment');
    // 此刻能做的（场记章程第二节第 5 条、B3）：隔着电话／消息、刚到、就在这儿，各几样可以做的，由他挑——不写该做什么、不写对方会怎样。只给有卡的人，旁白不给
    if (!camera && stance) {
        const same = (a, b) => sameName(a, b, rosterNames) || (!!rel && !!personOf(rel, a, rosterNames) && personOf(rel, a, rosterNames) === personOf(rel, b, rosterNames));
        const hand = handOf(visible, { name, same });
        add(0, optionsFor({ ...stance, intent: hand.intent, matters: hand.matters, userName: userName ?? '对方', name }), 'now', 'person');
    }

    // 约定（N-268、D-140）：今天说好的、过了时候还没见办的、明天的……只给在场的当事人（场面 > 约定 > 口袋：后台排的事给今天的让路，见 menuFor）。
    // 只提一次的提过就记下；过了好几天没人再提的，记一笔"就这么过去了"（了结，结果"过去了"）——往后旧事、规划里都看得见，谁在意由各人。
    if (promised) {
        // 玩家眼下累着、难受（看场面那一步判的，近几条内）：说好的事"先放着"，别催（用户 10/2）
        let us = null;
        try { us = JSON.parse(store.getMeta?.(`user_state:${chatKey}`) ?? 'null'); } catch {}
        const lateral = pace?.lateral !== false;
        // 判的那条还在（删回去以后，被删那段里判的"累着"不算）
        const tired = lateral && !!us && STAY_STATES.has(us.state) && stillThere(us, messages, (a, b) => !!store.sameMessage?.(a, b)) && lastPos - us.pos <= 3;
        const hold = tired ? (pace?.holdDrop ? 'drop' : true) : false;   // pace.holdDrop：累着时约定那几行干脆不给（Q 对比用）
        // 今天的、过了时候的那几行不每轮都给：同一件给过两回以后，隔六条再给（他心里本就有数，一轮轮提醒只会让他催）
        let given = {};
        try { given = JSON.parse(store.getMeta?.(`promise_given:${chatKey}`) ?? '{}'); } catch {}
        // 删回去以后，被删那段里提过的不算（位置比眼下还靠后的那几回）
        for (const k of Object.keys(given)) given[k] = (given[k] ?? []).filter(pos => pos <= lastPos);
        const NUDGE = new Set(['today', 'late', 'overdue']);
        const closedPromises = new Set((pendingLedger?.items ?? []).filter(x => x.kind === '约定' && ['办了', '改了', '黄了', '失效'].includes(x.status)).map(x => String(x.source?.id)).filter(Boolean));
        const due = promised.stages.filter(({ p, stage }) => !closedPromises.has(String(p.r?.id ?? p.id)) && !(stage === 'lapse' && p.due?.soon) && !(lateral && NUDGE.has(stage) && (given[p.id] ?? []).length >= 2 && lastPos - (given[p.id].at(-1) ?? -Infinity) < 6));
        add(0, promiseLines(due, { name, userName: userName ?? '对方', today, when: ago, same: promised.same, hold }), 'now', 'person');
        if (planner?.record !== false) {
            let marked = false;
            for (const { p, stage } of due) if (NUDGE.has(stage) && partyOf(p, name, promised.same)) { (given[p.id] ??= []).push(lastPos); given[p.id] = given[p.id].slice(-4); marked = true; }
            if (marked) store.setMeta?.(`promise_given:${chatKey}`, JSON.stringify(given));
            const told = promised.told;
            let changed = false;
            const at = messages.at(-1);
            // "就这么过去了"那一笔还记在这里（第 2 步事账会改成现算不落账）：先给这一格那一行，再记，下一格起它就关上了
            for (const { p, stage } of promised.stages) {
                if (stage === 'lapse' && at && records.addDerived) records.addDerived({ storyId, fp: at.fp, type: '了结', ideaRef: p.id, outcome: LAPSED, holder: p.r.holder, holderName: p.r.holder_name,
                    audience: [...new Set([...p.doers, ...p.with])], text: `说好的事${p.due?.soon ? '当时没办' : '到日子没办'}，也没人再提，就这么过去了：${String(p.r.text).slice(0, 120)}` });
                // 记在哪条上提的（试玩 10/3：删回去重来以后，只记"提过了"不记在哪条，该重提的不提、该重新收尾的不收）
                if (promised.once(p)(stage) && partyOf(p, name, promised.same)) { (told[p.id] ??= []).push(`${stage}@${at?.fp ?? ''}`); told[p.id] = told[p.id].slice(-8); changed = true; }
            }
            if (changed) store.setMeta?.(`promise_told:${chatKey}`, JSON.stringify(told));
        }
    }

    // 菜单：口袋按剧情日走；玩家伸手就给全；放久了沉底。都只给该给的那个人。
    const carry = [];
    // 事账里口袋和约定互相记着的编号：只用来**扩**"今天有约定"时的关联（哪件口袋和那件约定是一回事），不另起让路——
    // 没有今天的约定就不让路（10/5 口袋冻住那回就是让路让过了头）。只认还开着的约定对上的口袋
    const OPEN_PROMISE = new Set(['排着', '到了', '过了时候']);
    const pendingPocketRelated = new Set((pendingLedger?.items ?? []).filter(x => x.kind === '约定' && OPEN_PROMISE.has(x.status)).flatMap(x => x.with ?? []).map(String));
    // 那件约定的当事人才拿得到它的内容（镜头照玩家的眼睛）
    const holdWho = camera ? userName : name;
    const pendingHold = pendingPocketRelated.size ? { related: m => pendingPocketRelated.has(`pocket:${m.id}`), label: m => (x => (x && [...(x.who ?? []), ...(x.with ?? [])].some(w => sameName(w, holdWho, rosterNames)) ? x.text : ''))(pendingLedger.items.find(x => x.kind === '约定' && OPEN_PROMISE.has(x.status) && (x.with ?? []).includes(`pocket:${m.id}`))).slice(0, 40) } : null;
    const menuLines = drama && store.menuOf && !contact ? menuFor(store, chatKey, { records, isCarded: who => !!cardOf(who), speaker: camera ? CAMERA_NAME : name, camera, present, recentUser, userName, today, dayOf, firm: { today: firmToday, dayOf: firmDayOf }, at: lastPos, passive: passiveUser(messages), record: planner?.record !== false, carry, followers: who => (rel ? followersOf(rel, who, rosterNames) : []), face: who => roleOf(roster, who)?.role === '新面孔', stranger: strangerCall(roster, messages),
        giver: who => (p => (givesWork(p) ? giverLine(p, priceOf) : null))(rel ? personOf(rel, who, rosterNames) : null),
        player: [userName, ...(rel && userName ? (p => (p ? [p.名, ...p.又名] : []))(personOf(rel, userName, rosterNames)) : [])].filter(Boolean), hold: promised?.hold ? { related: m => promised.hold.related(m) || !!pendingHold?.related(m), label: m => (promised.hold.party?.(m, holdWho) ? promised.hold.label(m) : '') || pendingHold?.label(m) || '', today: m => !!promised.hold.strong?.(m) && !!promised.hold.party?.(m, holdWho) } : null, keep: m => !!(pendingHold?.related(m) || promised?.keeps?.(m)),
        // 口袋怎么进场（质量窗 10/5 方案）：到现场的看眼下在哪，镜头外的看时间过没过
        scene: [board?.camera?.place, board?.fast?.place, [...messages.slice(-3).map(m => m.text), ...foldState(store.stateNotesOf?.(chatKey) ?? []).filter(n => n.aspect === '位置' || n.aspect === '周围').map(n => n.text)].join('\n')].filter(Boolean).join('\n'),
        partAt: (rows => pos => rows().get(pos) ?? null)((cache => () => cache ?? (cache = new Map(timelineFor(store, records, chatKey, messages).rows.map(r => [r.pos, r.part]))))(null)),
        awaySince: pos => absences.some(a => a.days > 0 && a.from_pos != null && a.from_pos >= pos),
        ...(({ names, same }) => ({ named: names, same }))(nameFinder(rel, rosterNames)),
        carded: who => absentCard(who), board, anchorAt: anchor ? (uptoAnchor(messages, anchor).at(-1)?.pos ?? null) : null,
        // 交给他的那几步挂在被回的那条上、等他这条回复（方案 删消息等于没发生过）：他这条删了、换了别人开口，那一步就撤
        anchorMsg: (anchor ? uptoAnchor(messages, anchor) : messages).at(-1) ?? null,
        // 他到日子以后离开过镜头没有：眼下在外头，或者隔离区间里有一段在那天或之后关上（to 是他看不到的第一条）
        wentOff: (who, day) => {
            const card = cardOf(who);
            if (!card || !Number.isFinite(day)) return false;
            if (boardPerson(who)?.status === 'away') return true;
            let anchors = null;
            try { anchors = JSON.parse(store.requireChat(chatKey).anchors ?? 'null'); } catch {}
            // 零长度的封段（拉进来判不在场当场封上，T070）不算走开过（用户 10/15）
            return (anchors?.[card.avatar]?.segments ?? []).some(s => Number.isFinite(s?.to) && s.to <= lastPos && !emptySegment(s) && dayOf(s.to) >= day);
        },
        // 不在场的有卡的人牵头的那件：镜头不替他演，也不在这儿递——它在门的名单里（door.mjs），他来了自己拿出来
        arrive: camera ? () => {} : null,
        // 说她伤病的那几件不递（bodyGuardFor）：规划排的，不是她自己写的；放着的照常沉底
        hide: guard.hidesItem }) : [];
    for (const b of menuLines.blocks ?? [{ tier: 1, lines: menuLines }]) add(b.tier, b.lines, b.place ?? 'now', 'reply');
    // 玩家交代跳过的一段（skip.mjs，章程 G1）：空白过后头一个开口的人多一块"这段时间"——纯程序拼，只给这一回（按消息认：他这条删了就再给）。
    // 旁白拿全部；有卡的人只拿他知道的：他自己办到哪儿、他找过没人应的、"世界"那边的、外面看得到的、他有份的约定
    try {
        let skips = [];
        try { skips = liveSkips(JSON.parse(store.getMeta?.(`skips:${chatKey}`) ?? '[]'), messages); } catch {}
        const skip = skips.at(-1);
        const upto = anchor ? uptoAnchor(messages, anchor) : messages;
        if (skip && firstAfterSkip(skip, upto)) {
            const same = (a, b) => sameName(a, b, rosterNames);
            const knows = r => camera || same(r.holder_name, name) || (r.audience ?? []).some(a => same(a, name));
            const settled = visible.filter(r => r.type === '做' && r.pos >= skip.pos && /这段时间：/.test(r.text ?? '') && knows(r));
            const missed = (store.menuOf?.(chatKey) ?? []).filter(m => /^sunk/.test(m.status) && m.settled_pos === skip.pos && m.why === SKIP_MISSED && (camera || m.who === WORLD || same(m.who, name)))
                .map(m => ({ who: m.who, surface: m.surface, sink: m.sink || ifSunkOf(m) }));
            const seen = situation?.sit ? situationNow(situation.sit, { storyId, messages: upto, visibleIds: new Set(visible.map(r => r.id)), dayOf: firmDayOf }).moves
                .filter(mv => mv.seen && Number.isFinite(mv.pos) && mv.pos >= skip.pos).map(mv => mv.seen) : [];
            const closedBy = settledBy(visible, { dayOf: firmDayOf });
            const overdue = visible.filter(r => r.promise).map(r => promiseOf(r, { dayOf: firmDayOf }))
                .filter(p => p?.due && !p.due.soon && p.due.end >= skip.fromDay && p.due.end < skip.toDay && !closedBy.has(p.id) && (camera || partyOf(p, name, same)))
                .map(p => ({ text: p.r.text, when: p.when }));
            add(0, skipLines(skip, { userName: userName ?? '玩家', settled, missed, seen, overdue }), 'now', camera ? 'scene' : 'person');
        }
    } catch {}
    // 碰上的事（matters.mjs，用户 10/7："只要提起了就可以追查/解决/找源头……他可以隐瞒不说但不该不出现在场记里"）：
    // 后台排的事真发生了、还没下文的，知道的人每次开口都带着（这几天的；早的聊到了才带），直到正文里有了着落。
    // 镜头照玩家的眼睛看：玩家这边的；这句在追那件事（问为什么、要去查）时，交给镜头它的来由。不让位：至多四行，只有他知道的那几件聊天里没有，让掉就又"只影响了一轮"
    {
        const same = (a, b) => sameName(a, b, rosterNames) || (!!rel && !!personOf(rel, a, rosterNames) && personOf(rel, a, rosterNames) === personOf(rel, b, rosterNames));
        const who = camera ? userName : name;
        // 场上的事：拿出来了、还没了结、这场戏还没过去的，接着开口的人都带着（用户 10/8）；它们不再在下面"碰上了"那块重复
        // 说她伤病的那几件（碰上了、来意、场上的）不给（bodyGuardFor）
        const stage = who && store.menuOf ? stageLines({ menu: (drama ? store.menuOf(chatKey) : []).filter(m => !guard.hidesItem(m)).map(warmItem), visible: fed, name, knower: who, speaker: camera ? CAMERA_NAME : name, same, lastPos, dayOf, today, userName: userName ?? '玩家', talk: recentUser, gone: absentCard }) : { lines: [], menus: new Set() };
        add(0, stage.lines, 'now', 'scene');
        // 过了收期的不再列（用户 10/12，N-362：三天前的小事还挂在"还没下文"里）：折那一步会替它记了结，这里防的是还没折到的那一下
        const lapsed = closeClock(store, chatKey, { messages, dayOf, today });
        const items = (who ? mattersFor(fed, { name: who, same, dayOf, today, talk: recentUser, userName, senseOf: id => base.sense?.get?.(id) ?? 0 }) : []).filter(x => !stage.menus.has(x.r.matter?.menu) || x.r.matter?.kind === LEAD).filter(x => !lapsed(x.r));
        const opts = { name, when: material.when ?? (r => tagDay(dayOf(r.pos))), camera, userName: userName ?? '玩家', pursue: PURSUE.test(recentUser) };
        // 玩家这句说到的放眼下这一轮（对这句的回应要用），别的放想起的那一块；他的来意（只他本人）也放眼下：他手上正拿着的事，不当旧事
        const now = x => x.hit || x.r.matter?.kind === INTENT;
        // 来意是递给本人的私下话：过一道换词（N-368），库里的原文不动
        const warmIntent = x => (x.r.matter?.kind === INTENT ? { ...x, r: { ...x.r, text: warmWords(x.r.text), matter: { ...x.r.matter, title: warmWords(x.r.matter.title ?? '') } } } : x);
        add(0, matterLines(items.filter(now).map(warmIntent), opts), 'now', camera ? 'scene' : 'person');
        add(0, matterLines(items.filter(x => !now(x)).map(warmIntent), opts), 'recall', camera ? 'scene' : 'person');
    }
    // 门（D-175）：外头能来的有卡的人给旁白看，它觉得哪位顺理成章该出现了就写到他出现之前、末尾留记号；扩展认记号亮门，玩家点了才进场
    if (camera) {
        // 门上每人那几句多半是口袋里的题和来意：同样过一道换词（N-368）
        try { add(0, doorLines(doorFor(store, records, chatKey, { anchor, present, recentUser, timeline: timelineFor(store, records, chatKey, messages), contacts, planner }).items.map(i => ({ ...i, lines: (i.lines ?? []).map(warmWords) }))), 'now', 'scene'); } catch {}
    }
    if (drama && !contact && !menuLines.length && store.menuOf && planner?.record !== false) {
        // 玩家只跟着时先让这一刻活一会儿（D-112）：兴头在看场面、最近又没冒过就地的，先等几条再劝时间往后走
        let log = [];
        try { log = JSON.parse(store.getMeta?.(`impulses:${chatKey}`) ?? '[]'); } catch {}
        const watching = store.getMeta?.(`scene_seen:${chatKey}`) != null;
        const lived = log.some(x => IN_PLACE.has(x.kind) && lastPos - (x.at?.pos ?? -Infinity) <= 12);
        const idle = idleLine(store, chatKey, { messages, lastPos, today, userName, holdFor: watching && !lived ? IDLE_HOLD : 0, dayOf });
        if (idle) add(3, [idle], 'now', 'moment');
    }

    // 世界的底色：这个窗口的这个剧情日还没轮过，就掷一次骰（两次里一次给），挑这一局没用过的一条；和来联系、口袋同一轮时让位。
    if (front.seeds && world?.seeds?.length && !contact && !menuLines.length && store.getMeta) {
        const storyId = store.requireChat(chatKey).story_id;
        const dayKey = `world_day:${chatKey}`;
        if (store.getMeta(dayKey) !== String(today)) {
            // 用过的世界种子记成 { i, pos, fp }，挂在写它的那条消息上：那条还在本窗口才算用过（分叉前共有所以继承、分叉后各算各的、删回去也撤得掉）。旧格式纯数字照旧算用过。
            const raw = JSON.parse(store.getMeta(`world_used:${storyId}`) ?? '[]');
            const same = (a, b) => !!store.sameMessage?.(a, b);
            const used = raw.filter(u => Number.isInteger(u) ? true : u && stillThere({ pos: u.pos, fp: u.fp }, messages, same)).map(u => Number.isInteger(u) ? u : u.i);
            const current = dateIn(setup?.时间, today, { calendar: true })?.d;
            const year = current?.y ?? storyYear(setup);
            const now = current ?? (year == null ? null : { y: year, m: null, d: null });
            const seed = pickSeed(world.seeds, { key: `${storyId}:${today}`, used, now, elapsed: { today, timeScale: ts } });
            if (world.record !== false) {
                store.setMeta(dayKey, String(today));
                if (seed) store.setMeta(`world_used:${storyId}`, JSON.stringify([...raw, { i: seed.i, pos: lastPos, fp: messages.at(-1)?.fp }]));
            }
            if (seed) add(3, seedLines(seed, { year, start: setup?.时间 }), 'world', 'scene');
        }
    }

    // 叫规划者、节点检查、每轮检查、储备线展开：都在折那一步（advanceWorld），不在组格路上
    // 名声（D-172）：眼下说的、最近几条写的沾上了某个圈子，给一句他们怎么待那个人（写那个圈子里的人时用）
    add(1, repLines(visible, { text: [talk, ...recent].join('\n') }), 'now', 'moment');
    // 局势（situation.mjs，Q-8②）：到日子的传开已经在折那一步补成了记录；这里只读——今天传到主角这边的放"眼下"，别的放背景
    if (situation?.sit) {
        try {
            const now = situationNow(situation.sit, { storyId, messages, visibleIds: new Set(visible.map(r => r.id)), dayOf: firmDayOf, live: moveLiveCtx(store, chatKey, { records: visible, principal: userName }) });
            const posOf = id => visible.find(r => r.id === id)?.pos;
            const fresh = now.delivered.some(s => userName && s.target === userName && posOf(s.record_id) != null && dayOf(posOf(s.record_id)) >= today);
            add(fresh && camera ? 1 : 2, situationSlotLines(now, { name, today, records: visible, dayOf, notices: [], principal: userName, lastPos, camera }), fresh && camera ? 'now' : 'world', 'scene');
        } catch {}
    }
    // 有日子的活动的引子送不到（章程 L1，用户 10/12）：折那一步升级成"下一句"的，这一格最前面一句让她知道（旁白开口也算）；
    // 给了记在被回的那条上，只给一回（左滑重来照给）
    if (store.menuOf) {
        try {
            const anchorMsg = (anchor ? uptoAnchor(messages, anchor) : messages).at(-1) ?? null;
            const notice = leadNotice(store, chatKey, { menu: menuDays(store, store.menuOf(chatKey), dayOf), messages, anchorMsg, today, timeScale: ts, userName: userName ?? '玩家', record: planner?.record !== false, retime: (t, said) => (Number.isFinite(said) ? retime(t, said, today, ts) : t) });
            if (notice.length) { blocks.unshift({ tier: 0, lines: notice, place: 'now', scope: 'scene' }); lines.unshift(...notice); }
        } catch {}
    }
    return { lines, blocks, contact, carry, linger, dayOf, stance };
}

// 折一次（D-174 第 1 步乙）：没人开口也该发生的事——离开记一笔、按玩家说的重推、口袋进口袋和沉底、叫规划者和几种检查、
// 到日子的传开和换天那次局势。组格前（buildSlot）和同步提交后（/v1/sync）各调一次。
// 每一项自己就是幂等的（进过口袋的不再进、传到的不再传、检查按记下的编号和天数、规划在等着就不再要），所以不按指纹拦着重跑：
// 判定、记录是在两次开口之间到的（节点检查跑完了、记账追上了），下一次组格就得认。只记一笔"折到哪了"给排查看。
export async function advance(store, records, chatKey, deps = {}, { present = [] } = {}) {
    if (!records) return { advanced: false };
    try { noteAbsence(store, chatKey, deps.absence); } catch {}
    const last = store.currentMessages(chatKey).at(-1);
    if (!last) return { advanced: false, pos: null, fp: null };
    if (playModeOf(store, chatKey) === 'full') try { advanceWorld(store, records, chatKey, deps, { present }); } catch {}
    else try { const messages=store.currentMessages(chatKey), chat=store.requireChat(chatKey), tl=timelineFor(store,records,chatKey,messages); promisesNow(store,records,chatKey,{visible:records.visible(chatKey),messages,dayOf:tl.dayOf,today:tl.today,present,rosterNames:(store.getCast?.(chat.story_id)??[]).map(x=>x.name),setup:store.setupOf?.(chat.story_id)?.data??null}); } catch {}
    const time = timelineFor(store, records, chatKey);
    const advanced = { pos: last.pos, fp: last.fp };
    if (time.part != null || time.today > 0) { advanced.day = time.today; advanced.part = time.part; }
    store.setMeta?.(`advanced:${chatKey}`, JSON.stringify(advanced));
    return { advanced: true, pos: last.pos, fp: last.fp };
}

function advanceWorld(store, records, chatKey, { planner = null, situation = null, absence = null, settle = null, leave = null, offstage = null } = {}, { present = [] } = {}) {
    const messages = store.currentMessages(chatKey);
    const last = messages.at(-1);
    if (!last) return;
    const lastPos = last.pos;
    const storyId = store.requireChat(chatKey).story_id;
    const visible = records.visible(chatKey);
    const absences = store.absences?.(chatKey) ?? [];
    const timeRecs = visible.filter(r => r.type === '时间'), marks = timeMarksFor(store, records, chatKey, messages);
    const dayOf = dayIndex([...timeRecs, ...marks], lastPos, scaleFor(store, chatKey));
    const firmDayOf = marks.some(m => m.provisional) ? dayIndex([...timeRecs, ...marks.filter(m => !m.provisional)], lastPos, scaleFor(store, chatKey)) : dayOf;
    const today = dayOf(lastPos + 0.5), firmToday = firmDayOf(lastPos + 0.5);
    const userName = [...messages].reverse().find(m => m.is_user)?.name ?? null;
    const roster = store.getCast?.(storyId) ?? [], rosterNames = roster.map(e => e.name);
    const rawRel = store.relationsOf?.(storyId);
    const rel = rawRel ? normalizeRelations(rawRel) : null;
    // 谁在场：扩展带来的名单（组格前那次）；同步后那次没有名单，按场面表
    let board = null;
    try { board = boardFor(store, records, chatKey, { present, recentUser: '', timeline: timelineFor(store, records, chatKey, messages) }); } catch {}
    const here = present.length ? present : [...new Set([...(board?.people?.filter(p => p.status === 'present' || p.status === 'remote').map(p => p.name) ?? []), userName].filter(Boolean))];

    // ⑦ 去向只有一个门（D-174 第 4 步乙）：隔离扩展把他的区间关上了（静音、移出群、/isolate-leave 都算）、他又没去向，就替他记一份——
    // 跟扩展点"离场"是同一条路（main.leave 自己认重，先到的那次算）。他回来了去向怎么清：走进场那套的 main.arrive 清；
    // 这里不按区间重开清——扩展的"进场"是先开区间、同步、再调进场，这儿一清进场就拿不到结算的结果了。
    // 头一回见到这局（没记过区间）只记下，不动：旧闭段不是刚走的。闭在最近几条之外的也不算刚走。
    try {
        const anchors = JSON.parse(store.requireChat(chatKey).anchors ?? 'null') ?? {};
        const segs = avatar => (anchors[avatar]?.segments ?? []).map(s => ({ from: s.from, to: s.to ?? null }));
        const seenRaw = store.getMeta?.(`segments_seen:${chatKey}`) ?? null;
        let seen = null;
        try { seen = seenRaw ? JSON.parse(seenRaw) : null; } catch {}
        let plans = null;
        try { plans = JSON.parse(store.getMeta?.(`away_plan:${chatKey}`) ?? '{}') ?? {}; } catch {}
        const next = {};
        for (const card of roster.filter(e => e.avatar && hasCard(e) && e.name !== CAMERA_NAME)) {
            const now = segs(card.avatar), old = seen?.[card.avatar] ?? [];
            next[card.avatar] = now;
            if (!seen || !plans) continue;
            // 零长度的封段（拉进来判不在场当场封上，T070；拉进来又移出、一句没说）不算刚走（用户 10/15），不替他补去向
            const ended = now.filter(s => s.to != null && s.to >= lastPos - 3 && !emptySegment(s) && !old.some(o => o.from === s.from && o.to === s.to)).sort((a, b) => a.to - b.to).at(-1);
            if (!ended) continue;
            // 他牵头、当面办过了的那几件收起来
            if (!present.some(n => sameName(n, card.name, rosterNames))) try { closeLed({ records, chatKey, storyId, who: card.name, fp: last.fp, same: (a, b) => sameName(a, b, rosterNames) }); } catch {}
            // 他这回的来意跟着他离场过去（场记章程 B2）
            if (!present.some(n => sameName(n, card.name, rosterNames))) try { closeIntents({ records, chatKey, storyId, who: card.name, fp: last.fp, same: (a, b) => sameName(a, b, rosterNames) }); } catch {}
            // 区间是在最后一条上关的，场面表在这一条上还把他算在场：只按扩展带来的名单挡（名单里有他就是还在）；
            // 挡下的这回先不记成"见过"，同步那次（没名单）再看一遍
            if (present.some(n => sameName(n, card.name, rosterNames))) { next[card.avatar] = old; continue; }
            const hasPlan = Object.values(plans).some(p => (p?.who === card.name || (card.avatar && p?.avatar === card.avatar)) && !!validAwayPlan(p, messages));
            // 区间的 to 不含在段内：最后在场的 to - 1 才是这次离场来源。
            // 后面可能已经接了几句；不能把补记挂在那些新句上，否则删离场原文撤不掉。
            const source = messages.find(m => !m.hidden && m.pos === ended.to - 1);
            if (!hasPlan && source && leave) leave({ chatKey, who: card.name, avatar: card.avatar, anchor: { at: source.pos, fp: source.fp } })?.catch?.(() => {});
        }
        const nowSeen = JSON.stringify(next);
        if (nowSeen !== seenRaw) store.setMeta?.(`segments_seen:${chatKey}`, nowSeen);
    } catch {}

    // ① 玩家回来后说了话：按玩家说的把离开期间的推演重推一遍（main.reviseAway，后台跑，下一轮起用；只改一次）
    if (absence?.revise && absence?.record !== false) for (const a of absences) {
        if (a.story_status === 'ready' && a.story && !a.story.已按玩家改 && a.from_pos != null && lastPos - a.from_pos <= 12 && messages.some(m => m.is_user && m.pos > a.from_pos)) absence.revise({ chatKey, absenceId: a.id })?.catch?.(() => {});
    }
    // ② 约定此刻各在哪一步（让路、关联要用）；"就这么过去了"那一笔还在组格时记（它要先给当事人那一行再关上，第 2 步事账再改）
    let promised = null;
    try { promised = promisesNow(store, records, chatKey, { visible, messages, dayOf, today, present: here, rosterNames, rel, setup: store.setupOf?.(storyId)?.data ?? null }); } catch {}
    // ③〇 玩家交代跳过的一段（skip.mjs，章程 G1）：最近一次跨天是玩家那句交代的，记一段空白，挂在玩家那条上（删了就回来）；
    // 口袋里落在空白里的先按空白处理（到现场的过期、找上门的当作来过没人应——沉底、照沉底的后果走），不一下子全算成今天刚到时候。
    // 只按记下的日子认（沉底回不来）；一段空白只处理一次
    let skipNew = null;
    try {
        let kept = [];
        try { kept = liveSkips(JSON.parse(store.getMeta?.(`skips:${chatKey}`) ?? '[]'), messages); } catch {}
        const found = findSkip({ messages, timeRecs, marks, dayOf: firmDayOf });
        if (found && !kept.some(s => s.pos === found.pos && s.fp === found.fp)) {
            skipNew = { ...found, seen: { pos: lastPos, fp: last.fp } };
            if (store.menuOf && planner?.record !== false) {
                const menu = menuDays(store, store.menuOf(chatKey), firmDayOf);
                const settled = new Set(['used', 'shown', 'sunk', 'sunk_told', 'void', 'expired']);
                const blocked = m => !!m.after_title && menu.some(x => x.id !== m.id && x.plan_id === m.plan_id && x.title === m.after_title && !settled.has(x.status));
                const at = { pos: skipNew.pos, fp: skipNew.fp };
                const isPlayer = n => !!userName && sameName(n, userName, rosterNames);
                // 有日子的现场活动（章程 L1）：主线的改期到跳后第一格（引子算没送到，下面③之后马上再送）；别的照牵头的人在镜头外发生、给回音
                const player = [userName, ...(rel && userName ? (p => (p ? [p.名, ...p.又名] : []))(personOf(rel, userName, rosterNames)) : [])].filter(Boolean);
                const dated = skipEvents(menu, skipNew, { node: latestNode(store, chatKey).node });
                for (const m of dated.move) moveEvent(store, records, chatKey, m, { to: skipNew.toDay, at, roster, player, storyId, timeScale: scaleFor(store, chatKey) });
                for (const m of dated.off) echoEvent(store, records, chatKey, m, { at, day: skipNew.toDay, roster, userName, player, storyId, why: '玩家交代跳过的这段时间里，那边照常办了' });
                markEchoed(store, chatKey, dated.off.map(m => m.id), at);
                const spare = new Set([...dated.move, ...dated.off].map(m => m.id));
                for (const c of settleSkip(menu, skipNew, { keep: promised?.keeps ?? (() => false), blocked, isPlayer, spare: m => spare.has(m.id) })) {
                    store.updateMenu(chatKey, c.id, { status: c.status, why: c.why, by: '空白', at });
                    // 沉底那句进"这段时间"那一块，不再单给一回
                    if (c.status === 'sunk') store.updateMenu(chatKey, c.id, { status: 'sunk_told', why: c.why, by: '空白', at });
                    store.logEvent?.(chatKey, c.status === 'expired' ? 'menu_expired' : 'menu_skip', { id: c.id, why: c.why });
                }
            }
            store.setMeta?.(`skips:${chatKey}`, JSON.stringify([...kept, skipNew].slice(-6)));
        }
    } catch {}
    // ③ 口袋：到日子的进口袋（掷骰、份数、让路），放久了沉底
    if (store.menuOf && planner?.record !== false) {
        withdrawIntimateForTier(store, chatKey);
        const allowIntimate = intimateAllowed(store, records, chatKey, { present, record: true });
        const menu = menuDays(store, store.menuOf(chatKey), dayOf).filter(m => m.purpose !== '亲密' || allowIntimate(m));
        if (menu.length) {
            const gone = pocketGone(store, records, chatKey, { messages, roster, rosterNames, board, here, today, dayOf });
            // 这局的节奏（章程 H2）：份数、沉底、一场戏叠几件；此刻这场戏里已经拿出来、还没下文的几件
            let stacked = 0;
            try { stacked = pocketStack(store, records, chatKey, { menu, messages, rosterNames, today, dayOf }); } catch {}
            const contentTier = activeIntimate(intimateSetup(store, chatKey)).length ? promptOptionsFor(store, chatKey).tier : null;
            for (const c of stepPocket(menu, { today, dayOf, at: lastPos, timeScale: scaleFor(store, chatKey), pace: paceFor(store, chatKey), contentTier, stacked, firm: { today: firmToday, dayOf: firmDayOf }, hold: promised?.hold ?? null, keep: promised?.keeps ?? (() => false), gone })) {
                store.updateMenu(chatKey, c.id, c);
                if (c.why) store.logEvent?.(chatKey, c.status === 'expired' ? 'menu_expired' : 'menu_void', { id: c.id, why: c.why });
            }
            // 有日子的现场活动（eventlead.mjs，章程 L1，用户 10/12：她不知道就直接错过了）：前一格起引子还没送到就升级——
            // 挂到门上（找上门、牵头的人有卡又不在场），或者下一次开口那一格最前面一句；知道了却没去的，牵头的人镜头外照常办了、排一件回音
            try {
                const player = [userName, ...(rel && userName ? (p => (p ? [p.名, ...p.又名] : []))(personOf(rel, userName, rosterNames)) : [])].filter(Boolean);
                eventStep(store, records, chatKey, { menu: menuDays(store, store.menuOf(chatKey), dayOf), messages, today, firmToday, here, roster, userName, player, node: latestNode(store, chatKey).node });
            } catch {}
        }
    }
    // ④ 该叫规划者了没有（N-88：一个节点一次；不等结果）。节点算成／落空由便宜模型每个剧情日看一眼（planner.checkNode，后台跑，
    // 判定记在 meta 里，据此叫规划者）。/玩 只影响当天的供料，不叫规划者；/聊 才算改方向。
    // 记账落后时，先用角色正文认出口袋里的事，等正式记账追上后再由后面的结果盖过。
    const recentUnrecorded = typeof records?.isDone === 'function' ? messages.slice(-2).filter(m => !m.is_user && !records.isDone(storyId, m.fp)) : [];
    if (recentUnrecorded.length && store.menuOf) {
        for (const pocket of store.menuOf(chatKey).filter(m => m.status === 'offered' && m.held_by)) {
            const hit = recentUnrecorded.find(m => reachedFor(pocket, m.text));
            if (hit) store.updateMenu(chatKey, pocket.id, { status: 'shown', by: '程序', at: { pos: hit.pos, fp: hit.fp } });
        }
    }
    // ③乙 碰上的事（matters.mjs）：拿出来了、交出去了的，记成知道的人心里还没下文的一件——谁知道照那条消息时谁在场（场面表），镜头外的只有他自己
    if (store.menuOf && planner?.record !== false) {
        try {
            const tl = timelineFor(store, records, chatKey, messages);
            const boardAtPos = pos => {
                const m = messages.find(x => x.pos === pos);
                try { return boardFor(store, records, chatKey, { anchor: m ? `${pos + 1}:${m.fp}` : null, present: [], recentUser: '', timeline: tl }); } catch { return null; }
            };
            const presentAt = pos => {
                const b = boardAtPos(pos);
                // 场面表认不出在场的（没装隔离扩展、没有区间）：那条前后开过口的人也算在场（隔着电话、消息开口的不算，settleMatters 按 remoteAt 去掉）
                const spoke = messages.filter(x => !x.is_user && x.speaker !== CAMERA && x.name && x.name !== CAMERA_NAME && x.pos >= pos - 3 && x.pos <= pos + 1).map(x => x.name);
                return [...new Set([...(b?.people ?? []).filter(p => p.status === 'present' && p.name !== CAMERA_NAME).map(p => p.name), ...spoke])];
            };
            // 那条时隔着电话、消息的人（场面表 remote）：不算当面碰上（场记章程第 2 条）
            const remoteHere = pos => (boardAtPos(pos)?.people ?? []).filter(p => p.status === 'remote').map(p => p.name);
            const cardOf = who => roster.find(e => hasCard(e) && e.name !== CAMERA_NAME && sameName(e.name, who, rosterNames)) ?? null;
            const player = [userName, ...(rel && userName ? (p => (p ? [p.名, ...p.又名] : []))(personOf(rel, userName, rosterNames)) : [])].filter(Boolean);
            const placeAt = pos => { const m = messages.find(x => x.pos === pos); try { return boardFor(store, records, chatKey, { anchor: m ? `${pos + 1}:${m.fp}` : null, present: [], recentUser: '', timeline: tl }).camera?.place ?? null; } catch { return null; } };
            // 他是不是从这条之后进的场（进场记录挂在他进场前那条上：at 是他头一条、fp 是前一条的指纹）：是就给"怎么来的"
            let arrivals = [];
            try { arrivals = JSON.parse(store.getMeta?.(`arrivals:${chatKey}`) ?? '[]') ?? []; } catch {}
            const arrivedAt = (pos, who) => {
                const e = (Array.isArray(arrivals) ? arrivals : []).findLast(x => x && Number(x.at) === pos + 1 && x.fp === messages.find(m => m.pos === pos)?.fp && sameName(x.who, who, rosterNames));
                return e ? String(e.how ?? '') : null;
            };
            settleMatters({ store, records, chatKey, storyId, messages, presentAt, remoteAt: remoteHere, placeAt, arrivedAt, holderOf: n => cardOf(n)?.avatar ?? `name:${n}`, userName, player, camera: CAMERA_NAME, same: (a, b) => sameName(a, b, rosterNames) });
        } catch {}
    }
    // ③丁 推出来的东西到期就收（场记章程第 11 条）：他牵头的那几件，他之后当面开过口（记账记下的说、做）就了结——每次折都看，在不在场都看
    // （原来只在他离场那一下看：那时他开口的那几条常还没进账，牵头的那件也可能是离场后才补记的，就一直开着）；
    // 他这回的来意：上一回在场的区间已经关了、人也不在了，那以前记下的跟着过去（离场那一下没赶上的补收）
    if (records.addDerived) {
        let anchors = {};
        try { anchors = JSON.parse(store.requireChat(chatKey).anchors ?? 'null') ?? {}; } catch {}
        const same = (a, b) => sameName(a, b, rosterNames);
        for (const card of roster.filter(e => hasCard(e) && e.name !== CAMERA_NAME)) {
            try { closeLed({ records, chatKey, storyId, who: card.name, fp: last.fp, same, wide: false }); } catch {}
            if (here.some(n => same(n, card.name))) continue;
            // 零长度的封段（拉进来判不在场当场封上，T070）不算进过场、不算离场（用户 10/15）
            const segs = (card.avatar ? anchors[card.avatar]?.segments ?? [] : []).filter(s => !emptySegment(s));
            if (!segs.length || segs.some(s => s.to == null)) continue;
            const ended = Math.max(...segs.map(s => Number(s.to)).filter(Number.isFinite));
            if (Number.isFinite(ended)) try { closeIntents({ records, chatKey, storyId, who: card.name, fp: last.fp, same, before: ended }); } catch {}
        }
    }
    // ③戊 收期（用户 10/12，N-362：口袋没有结束点，琐事没完没了；剧情要有聚焦）：先照最新一份规划办它对上一份口子的答（收／续），
    // 再替过了收期、正文里没了结、玩家也没追的那几件记一条"就这么过去了"（挂在眼下最后一条上，删回去就回来）。都按记下的日子算（回不来的事只按它）
    if (records.addDerived && planner?.record !== false) {
        try { settleGaps(store, records, chatKey, { storyId, messages, last }); } catch {}
        try { lapseMatters({ records, chatKey, storyId, fp: last.fp, menu: store.menuOf?.(chatKey) ?? [], due: closeClock(store, chatKey, { messages, dayOf: firmDayOf, today: firmToday }) }); } catch {}
    }
    // ③丙 镜头外的人（offstage.mjs，用户 10/8）：别处交代了他的事他自己知道；送到他那儿的他收到了；在场的人隔着消息、电话问不在场的人，
    // 后台替那人照他知道的回一句（main.askAway，后台跑）。都是程序认，记在原记录那条消息上；原记录没了就跟着没了
    if (offstage?.enabled !== false && records.addDerived) {
        try {
            const key = `offstage_since:${chatKey}`;
            const all = records.visible(chatKey, { all: true });
            // 头一回启用只看最近二十条里记下的（早的多半早在正文里交代过了，补一遍只会把旧事当新事）
            const first = store.getMeta?.(key) == null;
            const since = first ? Math.max(0, ...all.filter(r => r.pos < lastPos - 20).map(r => r.id)) : Number(store.getMeta?.(key) ?? 0) || 0;
            const player = [userName, ...(rel && userName ? (p => (p ? [p.名, ...p.又名] : []))(personOf(rel, userName, rosterNames)) : [])].filter(Boolean);
            const made = [...offstageFacts({ visible: all, since, roster, rel, player, userName }), ...reachDeliveries({ visible: all, since, roster })];
            for (const d of made) if (!all.some(r => r.fp === d.fp && r.holder_name === d.holderName && r.text === d.text)) records.addDerived({ storyId, ...d });
            const maxId = Math.max(since, ...all.map(r => r.id));
            if (first || maxId > since) store.setMeta?.(key, String(maxId));
            // 问不在场的人：最近两条里还没看过的（看到哪了连指纹记着，删回去、换分支就重看）
            if (typeof offstage?.ask === 'function') {
                const seenKey = `offstage_seen:${chatKey}`;
                let seen = null;
                try { seen = JSON.parse(store.getMeta?.(seenKey) ?? 'null'); } catch {}
                const seenOk = !!seen && messages.some(m => m.pos === seen.pos && m.fp === seen.fp);
                const fresh = messages.slice(-2).filter(m => !m.is_user && !(seenOk && m.pos <= seen.pos));
                if (fresh.length) {
                    const absent = who => { const bp = board?.people?.find(p => sameName(p.name, who, rosterNames)); return bp ? !['present', 'remote'].includes(bp.status) : !here.some(n => sameName(n, who, rosterNames)); };
                    for (const a of asksAway(fresh, { roster, absent, userName, player })) offstage.ask({ chatKey, ...a })?.catch?.(() => {});
                    store.setMeta?.(seenKey, JSON.stringify({ pos: messages.at(-1).pos, fp: messages.at(-1).fp }));
                }
            }
            // 回话给过了：他在回话写下之后又开过口，就不再带
            for (const e of roster.filter(e => hasCard(e) && e.name !== CAMERA_NAME)) {
                let rp = null;
                try { rp = JSON.parse(store.getMeta?.(`offstage_reply:${chatKey}:${e.name}`) ?? 'null'); } catch {}
                if (rp && !rp.used && messages.some(m => m.pos > (rp.at ?? rp.pos) && !m.is_user && m.name === e.name)) store.setMeta?.(`offstage_reply:${chatKey}:${e.name}`, JSON.stringify({ ...rp, used: true }));
            }
        } catch {}
    }
    if (store.requestPlan && planner?.provider && planner?.record !== false) {
        try {
            const notes = store.notesOf?.(chatKey) ?? [];
            const openIdeaIds = new Set(records.openIdeas(chatKey).map(r => r.id));
            const last = store.lastPlan(chatKey);
            const active = store.menuOf(chatKey).filter(m => m.status === 'waiting' || m.status === 'pocket').length;
            const newNotes = notes.some(n => n.kind === '聊' && n.used_in_plan == null);
            const verdict = last?.status === 'ready' ? verdictOf(store, chatKey, last.id) : null;
            let reason = needsPlan({ lastPlan: last, activeItems: active, newNotes, nodeOver: verdict?.result });
            // 第一份规划等开局单确认生效、或者玩家说了第一句再排（用户 10/22：一接入就排，角色还没拉完、开局单还没填，钱就花出去了）
            if (reason === 'first' && !store.setupOf?.(storyId) && !messages.some(m => m.is_user)) reason = null;
            // 判定挂在哪条消息上，新规划也跟着挂上：那条删了、改了，新规划就不算，退回原来那份（用户 10/4）
            if (reason) requestPlanNow(store, records, chatKey, planner, { reason, present: here, verdict: verdict?.why, thread: verdict?.thread, basis: verdict?.at ?? null });
            else if (last?.status === 'ready' && backFrom(store, chatKey, last)) {
                // 离开好些天刚回来、这些天推好了：接住这些天留下的事，重新规划（一次离开只叫一次）。
                const back = backFrom(store, chatKey, last);
                store.setMeta(`back_planned:${back.id}`, '1');
                requestPlanNow(store, records, chatKey, planner, { reason: 'back', present: here });
            } else if (last?.status === 'ready') {
                // 换了剧情日看一次；一个剧情日里聊得很长（试玩第 5 天一百多条）时，每 NODE_EVERY 条也看一次
                const dayDue = firmToday > last.story_day && store.getMeta?.(`node_checked:${last.id}`) !== String(firmToday);
                const posDue = lastPos - Number(store.getMeta?.(`node_checked_pos:${last.id}`) ?? last.anchor_pos ?? 0) >= NODE_EVERY;
                if (last.node && planner.checkNode && (dayDue || posDue)) {
                    store.setMeta(`node_checked:${last.id}`, String(firmToday));
                    store.setMeta(`node_checked_pos:${last.id}`, String(lastPos));
                    planner.checkNode({ chatKey, planId: last.id }).catch(() => {});
                }
                // 玩家的角色在这份规划之后新提的想法（记账记下来的）：看一眼是不是认真要长期去做的新方向（N-72：当引力，不当轨道）。
                if (planner.checkTurn && userName) {
                    const seenKey = `turn_checked:${chatKey}`;
                    // 想法之外也看玩家说的话：拒绝、放弃多半记成"说"（B 段实测："那一单我不接了"记成了说，规划照旧等着那单交货）。
                    const ideas = visible.filter(r => (r.type === '想法' || r.type === '说') && r.holder_name === userName && r.pos > (last.anchor_pos ?? -1));
                    // 别的角色起的新念头（D-107）：同一次顺带看，分量够就给眼下这个节点补几件
                    const others = visible.filter(r => r.type === '想法' && r.holder_name && r.holder_name !== userName && openIdeaIds.has(r.id) && r.pos > (last.anchor_pos ?? -1));
                    // 关系变了、一直算数的改变（谁的都算，用户 10/4：两人当场在一起了）：看规划设想的局面还成不成立
                    const changes = visible.filter(r => (r.type === '关系' || (r.type === '改变' && LASTING_CHANGE.has(r.duration))) && r.pos > (last.anchor_pos ?? -1));
                    // 这一轮各人做了什么、说了什么（D-170，用户 10/6：闹出的动静该在外头发酵）：同一次顺带看会不会传开、引来反应
                    const counted = new Set([...ideas, ...others, ...changes].map(r => r.id));
                    const acts = visible.filter(r => ACTS.has(r.type) && !counted.has(r.id) && r.pos > (last.anchor_pos ?? -1));
                    const seen = Number(store.getMeta?.(seenKey) ?? -1);
                    const fresh = ideas.filter(r => r.id > seen), freshOthers = others.filter(r => r.id > seen), freshChanges = changes.filter(r => r.id > seen), freshActs = acts.filter(r => r.id > seen).slice(-12);
                    if (fresh.length || freshOthers.length || freshChanges.length || freshActs.length) {
                        store.setMeta(seenKey, String(Math.max(...[...fresh, ...freshOthers, ...freshChanges, ...freshActs].map(r => r.id))));
                        planner.checkTurn({ chatKey, planId: last.id, ideas: fresh, others: freshOthers, changes: freshChanges, acts: freshActs }).catch(() => {});
                    }
                }
                // 剧情走到了开局单里某条储备线写明的地方（N-293，用户 10/6：一个人去了某个酒吧，开局单里一条储备线的条件写着"在那儿"，规划里却一件都没有）：
                // 展开那条线，给眼下这个节点补几件此刻就能用上的（规划那档模型，一次七八毛、几分钟，后台跑不等）。同一条线一个剧情日至多一回；
                // 那条线眼下已经有排着、在口袋里的事就不用。在哪看场面表（镜头在哪、快路认的地方）、此刻的样子和最近两条括号里的叙述——嘴上说起那个地方不算。
                if (planner.onPlace) {
                    const narration = t => (String(t ?? '').match(/（[^）]*）|\([^)]*\)/g) ?? []).join(' ');
                    const where = [board?.camera?.place, board?.fast?.place, ...foldState(store.stateNotesOf?.(chatKey) ?? []).filter(n => (n.aspect === '位置' || n.aspect === '周围' || n.aspect === '地方') && (n.who === '此地' || (userName && sameName(n.who, userName, rosterNames)))).map(n => n.text),
                        ...messages.slice(-2).map(m => narration(m.text))].filter(Boolean).join('\n');
                    // 进了那处以后，"此刻的样子"常把地方写成里面更细的一块（试玩 10/9：某家酒吧 → 里面的包厢 → 吧台边，酒吧的名字没了，
                    // 人还在那儿却认不出）：同一天、四十条以内、上一回"在路上"以后记过的地方都算
                    const spots = (store.stateNotesOf?.(chatKey) ?? []).filter(n => n.who === '此地' && n.aspect === '地方' && n.pos <= lastPos && lastPos - n.pos <= 40 && firmDayOf(n.pos) === firmToday).sort((a, b) => a.pos - b.pos);
                    const here = spots.slice(spots.findLastIndex(n => /路上|往.{1,12}去|出了|离开/.test(n.text)) + 1).map(n => n.text).join('\n');
                    const whereNow = [where, here].filter(Boolean).join('\n');
                    const busy = new Set(store.menuOf(chatKey).filter(m => m.status === 'waiting' || m.status === 'pocket').map(m => m.line));
                    for (const x of store.setupOf?.(storyId)?.data?.储备线 ?? []) {
                        const hit = placesIn(x.条件).find(p => whereNow.includes(p));
                        const key = `reserve_place:${chatKey}:${x.名}`, wait = `reserve_place_wait:${chatKey}:${x.名}`;
                        if (!hit || busy.has(x.名) || store.getMeta?.(key) === String(firmToday) || lastPos < Number(store.getMeta?.(wait) ?? -1)) continue;
                        const before = store.getMeta?.(key) ?? null;
                        store.setMeta?.(key, String(firmToday));
                        // 没调通：这一天还没算补过，隔六条再试（以前一声不响就算补过了）
                        planner.onPlace({ chatKey, planId: last.id, line: x.名, place: hit, at: { pos: lastPos, fp: messages.at(-1)?.fp ?? null } })?.catch?.(() => { store.setMeta?.(key, before); store.setMeta?.(wait, String(lastPos + 6)); });
                        break;
                    }
                }
            }
        } catch {}
    }
    // ⑤ 局势（situation.mjs，Q-8②）：到日子的传开替他补成"听说／消息"（挂在最后一条上）；新的剧情日第一次推一次局势（后台跑，不等）
    if (situation?.sit && situation.record !== false) {
        try {
            const now = situationNow(situation.sit, { storyId, messages, visibleIds: new Set(visible.map(r => r.id)), dayOf: firmDayOf });
            deliverDue(situation.sit, now, { today: firmToday, anchor: last, storyId, addRecord: records.addDerived, principal: userName });
            // 认上次跑的那条消息、按现在的天数算（D-170，试玩 10/6：原来记的是"跑过第几天"，天数算法改正过以后它以为第 2 天跑过了，四天没再跑）
            const ran = Number(store.getMeta?.(`situation_ran:${chatKey}`) ?? -1);
            const since = Math.max(now.lastTick?.anchor_pos ?? -1, ran <= lastPos ? ran : -1);
            if (situation.run && firmToday > (since >= 0 ? firmDayOf(since + 0.5) : -1)) {
                store.setMeta(`situation_ran:${chatKey}`, String(lastPos));
                // 玩家交代跳过的一段：空白几天补几次换天（至多三次，再多就一次），每次带上这是第几天、玩家交代了什么；排队，一次只跑一个
                const runs = skipNew && skipNew.toDay === firmToday ? skipDays(skipNew) : [];
                if (runs.length) for (const r of runs) situation.run({ chatKey, day: r.day, skip: { ...r, said: skipNew.said, fromDay: skipNew.fromDay, toDay: skipNew.toDay, span: skipNew.span } })?.catch?.(() => {});
                else situation.run({ chatKey, day: firmToday }).catch(() => {});
            }
        } catch {}
    }

    // ⑥ 换时段，或玩家刚结束一段离开：只给在外头且有事挂着的有卡角色结算。
    if (settle && board) {
        const time = timelineFor(store, records, chatKey, messages);
        let previous = null;
        try { previous = JSON.parse(store.getMeta?.(`advanced:${chatKey}`) ?? 'null'); } catch {}
        const valid = previous && messages.some(m => m.pos === previous.pos && m.fp === previous.fp);
        const before = valid ? previous : time.rows.at(-2);
        const changed = before && (before.day !== time.today || before.part !== time.part);
        const returned = absences.some(a => a.ended_at && a.days > 0 && messages.some(m => m.fp === a.from_fp && m.pos <= lastPos && (!valid || m.pos > previous.pos)));
        if (changed || returned) {
            const pending = pendingFor(store, records, chatKey, { present, timeline: time });
            // 主角团的人（用户 10/12，N-363）：最新一份规划里有他的"下一步"、这一格时间还没替他推过，没有待办也结算一次——镜头外接着办（crew.crewPushDue）；
            // 不在场的都算（出门了、走开了、这个窗口还没露过面），每人每格时间至多一次
            const sameP = (a, b) => sameName(a, b, rosterNames) || (!!rel && !!personOf(rel, a, rosterNames) && personOf(rel, a, rosterNames) === personOf(rel, b, rosterNames));
            const { node } = latestNode(store, chatKey);
            const crew = node ? crewOf(store.setupOf?.(storyId)?.data ?? null, node, userName) : [];
            const ownDue = p => !!node && crewPushDue({ who: p.name, userName, crew, entry: crewEntry(node, p.name, sameP), pushed: pushedMeta(store, chatKey, p.name), today: time.today, messages, same: sameP });
            for (const p of board.people.filter(p => p.card && p.name !== CAMERA_NAME && ['away', 'absent', 'never'].includes(p.status))) {
                const busy = p.status === 'away' && pending.items.some(i => i.owner === p.name && ((i.kind === '去办' && ['排着', '到了'].includes(i.status)) || (i.kind === '等回音' && i.status === '等着')));
                if (!busy && !ownDue(p)) continue;
                try { settle({ chatKey, who: p.name, avatar: p.avatar, reason: '换时段' })?.catch?.(() => {}); } catch {}
            }
        }
    }
    // ⑥乙 门上等着没人接的（waiting.mjs，用户 10/9：一直不回他消息，他是不是该直接找上来）：换了时段、或者隔了十来条还没接，
    // 替他结算一次——再发一条、打电话、找上门、放下、还等。开始等、每回结算都挂在玩家那条上（重生成模型那条不重算），删回去就重新算；调不通这回不算。
    // 从等的那条起他自己进了场（隔离区间、进场记录，landing.enteredSince）：这一回等就结束了
    if (settle && board) {
        try {
            const time = timelineFor(store, records, chatKey, messages);
            const rowAt = pos => time.rows.filter(r => r.pos <= pos).at(-1) ?? { day: time.today, part: time.part };
            let prev = {};
            try { prev = JSON.parse(store.getMeta?.(`door_wait:${chatKey}`) ?? '{}') ?? {}; } catch {}
            const door = doorFor(store, records, chatKey, { present, timeline: time }).items;
            let anchors = null, arrivals = [];
            try { anchors = JSON.parse(store.requireChat(chatKey).anchors ?? 'null'); } catch {}
            try { arrivals = JSON.parse(store.getMeta?.(`arrivals:${chatKey}`) ?? '[]') ?? []; } catch {}
            const entered = (who, pos, item) => enteredSince(pos, { who, avatar: item?.avatar ?? null, messages, anchors, arrivals });
            const { next, due } = stepWaits({ prev, door, messages, rowAt, entered, parts: time.parts });
            if (JSON.stringify(next) !== JSON.stringify(prev)) store.setMeta?.(`door_wait:${chatKey}`, JSON.stringify(next));
            for (const d of due) {
                const at = d.at;
                const undo = () => { try { store.setMeta?.(`door_wait:${chatKey}`, JSON.stringify(dropTry(JSON.parse(store.getMeta?.(`door_wait:${chatKey}`) ?? '{}') ?? {}, d.who, at))); } catch {} };
                try { Promise.resolve(settle({ chatKey, who: d.who, avatar: d.avatar, reason: '没人接', unanswered: d })).then(r => { if (r?.ok === false) undo(); }, undo); } catch { undo(); }
            }
        } catch {}
    }
}

// 收期的钟（matters.closeDue）：这一局的收期格数（tempo.close），规划写了续的那几件从那份规划挂的那条重新起算（那条删了就不算）
function closeClock(store, chatKey, { messages, dayOf, today }) {
    const close = paceFor(store, chatKey).close;
    let restart = {};
    try { restart = JSON.parse(store.getMeta?.(`matter_restart:${chatKey}`) ?? '{}') ?? {}; } catch {}
    const at = id => { const x = restart[id]; return x && messages.some(m => m.pos === x.pos && m.fp === x.fp) ? x.pos : null; };
    return r => closeDue(r, { messages, dayOf, today, close, restart: at(r.id) });
}

// 最新一份规划对上一份口子的答（K 约定第 4、5 条）：收 → 记一条了结（落地那句）；续 → 续的次数＋1（matter_cont，规划简报读）、收期从这份规划起重算；
// 续过一次又写续的当收办，落地用它的收尾。同一份规划同一件只办一次（gaps_done 记着办过的题）。
// 了结挂在要这份规划的那条消息上：那条删了，规划退了，这几步也跟着不算（那条不在了、或者那件是后来才记的，挂眼下最后一条）
function settleGaps(store, records, chatKey, { storyId, messages, last }) {
    const { plan, node } = latestNode(store, chatKey);
    const gaps = Array.isArray(node?.口子) ? node.口子 : [];
    if (!plan || !gaps.length) return [];
    const doneKey = `gaps_done:${chatKey}:${plan.id}`;
    let done = [];
    try { done = JSON.parse(store.getMeta?.(doneKey) ?? '[]') ?? []; } catch {}
    const contKey = id => `matter_cont:${chatKey}:${id}`;
    const contOf = id => Number(store.getMeta?.(contKey(id)) ?? 0) || 0;
    const visible = records.visible(chatKey);
    const steps = gapSteps(gaps, { visible, menu: store.menuOf?.(chatKey) ?? [], done: new Set(done), contOf });
    if (!steps.length) return [];
    const anchor = messages.find(m => m.pos === plan.anchor_pos && m.fp === plan.anchor_fp) ?? last;
    let restart = {};
    try { restart = JSON.parse(store.getMeta?.(`matter_restart:${chatKey}`) ?? '{}') ?? {}; } catch {}
    for (const st of steps) {
        if (st.act === '收') for (const id of st.ids) {
            const r = visible.find(x => x.id === id);
            if (!r) continue;
            const at = r.pos <= anchor.pos ? anchor : last;
            records.addDerived({ storyId, fp: at.fp, type: '了结', ideaRef: id, outcome: '做了', text: String(st.text).slice(0, 200), holder: r.holder, holderName: r.holder_name, audience: r.audience ?? [] });
        }
        if (st.act === '续') {
            for (const id of st.menus) store.setMeta?.(contKey(id), String(contOf(id) + 1));
            for (const id of st.ids) restart[id] = { pos: anchor.pos, fp: anchor.fp };
        }
        done.push(st.title);
    }
    store.setMeta?.(doneKey, JSON.stringify(done));
    if (steps.some(st => st.act === '续' && st.ids.length)) store.setMeta?.(`matter_restart:${chatKey}`, JSON.stringify(restart));
    return steps;
}

// 局势动向还作不作数要看的材料（situation.moveLive）：进场记录、隔离区间读库里的，记录和主角由调用的人给
function moveLiveCtx(store, chatKey, { records, principal }) {
    let anchors = null, arrivals = [];
    try { anchors = JSON.parse(store.requireChat(chatKey).anchors ?? 'null'); } catch {}
    try { arrivals = JSON.parse(store.getMeta?.(`arrivals:${chatKey}`) ?? '[]') ?? []; } catch {}
    return { records, principal, anchors, arrivals };
}

// 局势推演要的材料（main.mjs runSituation）：势力账、上次推演之后记下的事（第一次只看前一天起的）、托出去还没了结的事、
// 上次之后传到的话、还在路上的话、认得的人和势力。上次之后什么都没记下、也没有托出去的事，就返回 null（不调模型）。
// 托出去的事（Q-8③）：主角是一方、还没了结的约定，由对方（出面的人）去办；不在场的人答应过的事。主要角色、在场的人自己演，不替他们结算。
// skip：玩家交代跳过的一段里补跑的那一次（skip.skipDays 的一项＋玩家交代的原话）——上次之后什么都没记下也照跑（这几天各方接着动）；
// 到日子没办的约定按这一天算（一次推好几天的，空白里到日子的都算）
export function situationMaterial(store, records, sit, chatKey, { day, net = null, loud = null, skip = null }) {
    const s = storyContext(store, records, chatKey);
    const now = situationNow(sit, { storyId: s.chat.story_id, messages: s.messages, visibleIds: new Set(s.visible.map(r => r.id)), dayOf: s.dayOf, live: moveLiveCtx(store, chatKey, { records: s.visible, principal: s.userName }) });
    const firstOfYesterday = s.messages.find(m => s.dayOf(m.pos) >= day - 1)?.pos ?? 0;
    const from = now.lastTick ? now.lastTick.anchor_pos : firstOfYesterday - 1;
    const DERIVED = new Set(['时间', '听说', '消息', '结果']);
    // 闹大了的那几条（D-170）：每轮的检查判的，哪怕刚好排在上次推演之前也给（换天那次和它前后脚跑）；早先还开着的话头（担心过会传开、会被盯上的）一起给，对得上就照它兑现
    const loudSet = new Set((loud?.ids ?? []).map(Number));
    const fresh = s.visible.filter(r => (r.pos > from || loudSet.has(r.id)) && !DERIVED.has(r.type)).slice(-60);
    const loudIds = [...loudSet].filter(id => fresh.some(r => r.id === id));
    const openIds = new Set(records.openIdeas?.(chatKey)?.map(r => r.id) ?? []);
    const open = s.visible.filter(r => openIds.has(r.id) && r.pos <= from && (r.type === '说' || r.type === '想法') && s.lastPos - r.pos <= 300).slice(-6);
    const anchor = s.messages.at(-1);
    const heardIds = new Set(s.visible.filter(r => (r.type === '听说' || r.type === '消息') && r.pos > from).map(r => r.id));
    const heard = now.delivered.filter(d => heardIds.has(d.record_id));
    const principal = s.userName;
    const mainNames = s.roster.filter(e => e.role === '主要').map(e => e.name);
    const onStage = n => samePerson(n, principal) || mainNames.some(m => samePerson(m, n)) || s.present.some(p => samePerson(p, n));
    const resolve = nameResolver(net);
    const ledger = factionLedger(s.visible, { resolve, dayOf: s.dayOf });
    const done = new Set(now.outcomes.filter(o => o.record_id == null || s.visible.some(r => r.id === o.record_id)).map(o => o.key));
    // 到期那天（试玩 10/12：周日说"周二下午前给尺寸，迟了照标准做"，周一推演就把它当成到了、出了结果）：
    // 约定、待办里写了星期几、明天后天、几天后的，照开局单的日期算出是哪一天；还没到那一天的不交给这一回推演
    const start = store.setupOf?.(s.chat.story_id)?.data?.时间 ?? null;
    const weekdayOf = d => weekdayIndex(start, d);
    const notYet = due => !!due && !due.soon && due.day > day;
    const dueWord = due => (due && !due.soon ? `到期：${dateIn(start, due.day)?.week ?? s.ts.ordinal(dayNumber(start, due.day))}${due.part ? due.part : ''}` : '');
    const errands = [];
    for (const d of ledger.deals) {
        if (!['说定', '在办'].includes(d.stage) || !principal || !d.parties.some(p => samePerson(p, principal)) || done.has(d.key)) continue;
        const executor = [...d.via][0] ?? d.parties.find(p => !samePerson(p, principal));
        if (!executor || onStage(executor)) continue;
        const due = dueOf(d.text, { saidDay: d.history[0]?.day ?? s.today, weekdayOf, timeScale: s.ts });
        if (notYet(due)) continue;
        errands.push({ id: d.id, key: d.key, executor, title: d.title, stage: d.stage, when: relativeDay(s.today - (d.history[0]?.day ?? s.today), s.ts), due: dueWord(due), what: `「${d.title}」${d.text}` });
    }
    const todos = s.visible.filter(r => r.todo && !r.closed_by && !r.promise && r.holder_name && !onStage(r.holder_name) && !done.has(`r:${r.id}`) && s.lastPos - r.pos <= 200 && !expiredTodo(r, s.today - s.dayOf(r.pos), s.ts))
        .map(r => ({ r, due: dueOf(r.text, { saidDay: s.dayOf(r.pos), weekdayOf, timeScale: s.ts }) }));
    // 同一个人隔几条又补了个期限（先说"把尺寸发来"，接着"周二下午前，迟了照标准做"）：前面那件跟着后面的期限，还没到就一起不交
    const later = (x, y) => y.r.pos >= x.r.pos && y.r.pos - x.r.pos <= 10 && y.r.holder_name === x.r.holder_name && notYet(y.due);
    for (const { r, due } of todos) {
        if (notYet(due) || todos.some(y => y.r !== r && later({ r }, y))) continue;
        errands.push({ id: r.id, key: `r:${r.id}`, executor: r.holder_name, title: '', stage: '答应了', when: relativeDay(s.today - s.dayOf(r.pos), s.ts), due: dueWord(due), what: r.text });
    }
    // 约定（N-268）：办的人不在场的（他答应了、托给他的），也是托出去的事——到了日子由局势出结果；结果传到主角那边要等消息，记账再关上这件约定。
    const closedBy = settledBy(s.visible, { dayOf: s.dayOf, timeScale: s.ts });
    const promised = s.visible.filter(r => r.promise).map(r => promiseOf(r, { dayOf: s.dayOf, weekdayOf, timeScale: s.ts })).filter(Boolean);
    for (const p of promised) {
        const executor = p.doers.find(d => !onStage(d));
        if (!executor || closedBy.has(p.id) || done.has(`r:${p.id}`) || !['眼前', '定了日子', '有条件'].includes(p.kind)) continue;
        if (notYet(p.due)) continue;
        errands.push({ id: p.id, key: `r:${p.id}`, executor, title: '', stage: '答应了', when: relativeDay(s.today - p.saidDay, s.ts), due: dueWord(p.due), what: `${p.r.text}（约在：${p.when || '没说'}）` });
    }
    // 刚有了结果的事（上次推演之后）：后台排的事拿出来了、用上了、沉了；说好的事有了结果、或者到日子没办而有人在镜头外等着——局势给它们排后续
    const STATUS = { shown: '拿出来了', used: '接了、用上了', sunk: '一直没人接，沉了', void: '不成立了，撤了' };
    const results = [
        ...store.menuOf(chatKey).filter(m => m.settled_pos != null && m.settled_pos > from && STATUS[m.status === 'sunk_told' ? 'sunk' : m.status])
            // 沉了的带上"没接会怎样"（外头会有什么动静从这句长）；接了的带上"往后会落下什么"（章程 F2）
            .map(m => ({ id: `事${m.id}`, line: `${m.who}「${m.title}」：${m.surface} → ${/sunk/.test(m.status) && m.why === SKIP_MISSED ? `${SKIP_MISSED}，沉了` : STATUS[m.status === 'sunk_told' ? 'sunk' : m.status]}${/sunk/.test(m.status) && ifSunkOf(m) ? `（没接会怎样：${ifSunkOf(m)}）` : takenOf(m, s.messages) && ifTakenOf(m) ? `（接了往后：${ifTakenOf(m)}）` : ''}` })),
        ...promised.filter(p => closedBy.get(p.id)?.pos > from).map(p => ({ id: `约${p.id}`, line: `${[...new Set([...p.doers, ...p.with])].join('和')}说好的：${p.r.text}（约在：${p.when || '没说'}）→ ${closedBy.get(p.id).outcome}：${closedBy.get(p.id).text}` })),
        ...promised.filter(p => !closedBy.has(p.id) && p.due && !p.due.soon && (skip ? p.due.end < day && p.due.end >= day - (skip.lumped ? skip.of : 1) : s.today - p.due.end === 1) && [...p.doers, ...p.with].some(x => !onStage(x)))
            .map(p => ({ id: `约${p.id}`, line: `${[...new Set([...p.doers, ...p.with])].join('和')}说好的：${p.r.text}（约在：${p.when || '没说'}）→ 到日子没办，${[...p.doers, ...p.with].filter(x => !onStage(x)).join('、')}在镜头外等着` })),
    ].slice(-10);
    if ((!fresh.length && !heard.length && !errands.length && !results.length && !loudIds.length && !skip) || !anchor) return null;
    const rel = (r => (r ? normalizeRelations(r) : null))(store.relationsOf?.(s.chat.story_id));
    const people = [...new Map([...s.roster.filter(e => e.role !== '不用').map(e => [e.name, { name: e.name, role: e.role }]), ...(rel?.人 ?? []).map(p => [p.名, { name: p.名, role: '' }])]).values()]
        .filter(p => p.name !== principal);
    const factions = [...new Set([...(net?.nodes ?? []).map(n => n.name), ...ledger.deals.flatMap(d => d.parties), ...ledger.stances.flatMap(x => [x.a, x.b]), ...ledger.allegiances.flatMap(a => [a.public, a.real])])]
        .filter(n => n && n.length >= 2 && !people.some(p => p.name === n) && n !== principal);
    const byId = new Map([...fresh, ...open].map(r => [r.id, r]));
    const errandOf = new Map(errands.map(e => [e.id, e]));
    const aware = id => {
        const e = errandOf.get(id);
        if (e && !byId.has(id)) return [e.executor];
        const r = byId.get(id);
        if (!r) return [];
        const f = r.faction ?? {};
        return [...new Set([r.holder_name, ...(r.audience ?? []), ...(f.parties ?? []), ...(f.via ?? []), f.who, principal].filter(Boolean))];
    };
    return {
        storyId: s.chat.story_id, anchor: { pos: anchor.pos, fp: anchor.fp }, errands: errandOf,
        prompt: situationPrompt({ day, timeScale: s.ts, date: dateIn(start, day)?.week ?? '', firstDay: dayNumber(start, 0), ledgerLines: factionBrief(ledger, { net, today: s.today, relDay: d => relativeDay(d, s.ts) }), records: fresh, heard, pending: now.pending, errands, principal, people, factions, results, loud: loudIds.length ? { ids: loudIds, why: loud?.why ?? '' } : null, open, moves: now.moves.slice(-8), skip: skip ? skipPromptLines(skip, { principal }) : [] }),
        check: { known: [...people.map(p => p.name), ...factions, ...errands.map(e => e.executor)], main: mainNames, ids: new Set([...fresh, ...open].map(r => r.id)), aware, errands: errandOf, principal, results: new Set(results.map(x => x.id)), loud: new Set(loudIds), liveMoves: new Set(now.moves.slice(-8).map(x => x.id)) },
    };
}

const NOTE_WINDOW = 30;

// 节点检查／转向检查的判定（记在 meta 里，按规划存）：依据的那条消息已经不在这个窗口里（删了、改了、换到没有它的分支）就不算。
// 9/27 实测：删掉"重组武侍"那几条后，转向判定还留着，下一次开口又为一个已经不存在的想法叫了规划者。
export function verdictOf(store, chatKey, planId) {
    let v = null;
    try { v = JSON.parse(store.getMeta?.(`node_verdict:${planId}`) ?? 'null'); } catch {}
    if (!v?.at) return v;
    const cur = store.currentMessages(chatKey)[v.at.pos]?.fp;
    return cur === v.at.fp || (cur && store.sameMessage?.(cur, v.at.fp)) ? v : null;
}

// 这份规划之后发生的、三天以上、推好了、还没为它重新规划过的那次离开。
function backFrom(store, chatKey, plan) {
    return (store.absences?.(chatKey) ?? []).filter(a => a.days >= 3 && a.story_status === 'ready' && a.from_pos != null
        && a.from_pos >= (plan.anchor_pos ?? -1) && store.getMeta?.(`back_planned:${a.id}`) !== '1').at(-1) ?? null;
}

// 算剧情日用的记号（"时间"记录之外的）：离开那几段，加上还没记账的最近几条里明写的时间跳转（记上之前先按它算）。
// 此刻的样子那几行（core/state.mjs）。ctx 里缺的（钉住的那一格重填时）现算。
// 左滑重来、"继续"时，库里这一格还是被换掉的那一版（它写的此刻的样子、它的台词）：只认到这一格接的那条（anchor 里的指纹）为止
// （试玩 9/30：左滑重写电梯里那一条，此刻的样子却是被换掉那版写到的"已经走出大门"）。
export function uptoAnchor(messages, anchor) {
    const fp = /^\d+:(.+)$/.exec(String(anchor ?? ''))?.[1];
    if (!fp) return messages;
    for (let i = messages.length - 1; i >= 0; i--) if (messages[i].fp === fp) return messages.slice(0, i + 1);
    return messages;
}

// keepNote：她的身体那一笔给不给（bodyGuardFor）
export function stateBlock(store, { chatKey, name, present = [], userName = null, rosterNames = null, rel = undefined, dayOf = null, today = null, records = null, anchor = null, keepNote = null }) {
    if (!store.stateNotesOf) return [];
    const storyId = store.requireChat(chatKey).story_id;
    const names = rosterNames ?? (store.getCast?.(storyId) ?? []).map(e => e.name);
    const table = rel !== undefined ? rel : (r => (r ? normalizeRelations(r) : null))(store.relationsOf?.(storyId));
    let day = dayOf, now = today, user = userName;
    const cut = anchor ? uptoAnchor(store.currentMessages(chatKey), anchor) : null;
    const upto = cut?.length ? cut.at(-1).pos : null;
    if (!day || now == null || user == null) {
        const messages = cut ?? store.currentMessages(chatKey);
        const lastPos = messages.at(-1)?.pos ?? 0;
        user ??= [...messages].reverse().find(m => m.is_user)?.name ?? null;
        if (!day || now == null) {
            const visible = records?.visible?.(chatKey) ?? [];
            day = dayIndex([...visible.filter(r => r.type === '时间'), ...timeMarksFor(store, records, chatKey, messages)], lastPos, scaleFor(store, chatKey));
            now = day(lastPos + 0.5);
        }
    }
    const same = (a, b) => a === b || sameName(a, b, names) || (!!table && !!personOf(table, a, names) && personOf(table, a, names) === personOf(table, b, names));
    // 玩家的角色身上的东西只认玩家自己写的（已经记下的旧笔也照这样筛）
    const userAt = new Set((cut ?? store.currentMessages(chatKey)).filter(m => m.is_user).map(m => m.pos));
    const notes = herOwnOnly(store.stateNotesOf(chatKey).filter(n => (upto == null || n.pos <= upto) && (!keepNote || keepNote(n))), { isUserAt: p => userAt.has(p), isHer: w => !!user && same(w, user) });
    let clock = null;
    try { clock = clockFor(store, records, chatKey, cut ?? store.currentMessages(chatKey)); } catch {}
    const lastPos = upto ?? (cut ?? store.currentMessages(chatKey)).at(-1)?.pos ?? null;
    let moved = null, remote = [];
    try {
        const b = boardFor(store, records, chatKey, { anchor, present });
        const cam = b.camera;
        if (cam?.place && cam.from !== 'state') moved = { place: cam.place, pos: cam.since };
        // 发消息、打电话来的人：他那头的样子和这儿分开给（用户 10/8）
        remote = (b.people ?? []).filter(p => p.status === 'remote').map(p => ({ name: p.name, way: p.way ?? '' }));
    } catch {}
    return stateLines(foldState(notes, same, { lastPos }), { people: [name, ...present, user].filter(Boolean), same, dayOf: day, today: now, clock, moved, remote, name });
}

// 那一句提醒：去复读第三版（fresh.ways）点出的他最近几条一再用的路数；形状（pace.shape，收口计划 ③）：他最近两条一个模子；
// 上一条台词拿对方原话起头的（用户 9/29）。合成一句。
// 路数记在他那条回复上，只认记在最近几条之一上的；左滑重来时那条已经换掉了，所以也记着它接的是哪一条（after），接的那条还在就照用。
export function varyFor(store, { chatKey, speaker, name, userName = null, messages, fresh = null, pace = null }) {
    let ways = [];
    if (fresh?.enabled === true && fresh?.ways && fresh.bound?.({ chatKey, speaker }) === true) {
        let saved = null;
        try { saved = JSON.parse(store.getMeta?.(`fresh_ways:${chatKey}:${speaker}`) ?? 'null'); } catch {}
        if (saved?.ways?.length && messages.slice(-8).some(m => m.fp === saved.fp || (saved.after && m.fp === saved.after))) ways = saved.ways.map(wayOnly).filter(w => w && keepWay(w));
    }
    // 一个人别一个话头刷屏（用户 10/12，方案 叙事节奏与防棘轮）：他最近三条里有两条以上把话头拐到她的身子上——
    // 和用滥的路数一起点出来，接上"这些意思他已经说过好几回……接眼前新的事"。她说已经好了也一样
    if (pace?.enabled !== false && userName && bodyHarping({ messages, speaker, userName, aliases: herAliases(store, chatKey, userName) })) ways = [...ways, `一再把话头拐到${userName}的身子上`];
    const mold = pace?.enabled !== false && pace?.shape !== false ? moldOf({ messages, speaker }) : null;
    const echoes = pace?.enabled !== false ? lastEchoes({ messages, speaker }) : [];
    return varyLine({ name, ways, mold, userName: userName ?? '对方', echoes });
}
function herAliases(store, chatKey, userName) {
    try {
        const storyId = store.requireChat(chatKey).story_id;
        const rawRel = store.relationsOf?.(storyId);
        const p = rawRel ? personOf(normalizeRelations(rawRel), userName, (store.getCast?.(storyId) ?? []).map(e => e.name)) : null;
        return p ? [p.名, ...(p.又名 ?? [])].filter(Boolean) : [];
    } catch { return []; }
}
const VARY = /^（.*(一再用到的路数|是一个模子|的原话拎出来再接)/;
// 换上去的那一句放回原来那句的位置；原来没有就放在范围那一句（scopeLine，总在最末）之前。
const SCOPE = /^（这一条只写眼前这几分钟/;
function swapVary(text, line) {
    const rows = String(text ?? '').split('\n');
    const at = rows.findIndex(l => VARY.test(l));
    const kept = rows.filter(l => !VARY.test(l));
    if (!line) return kept.join('\n');
    let i = at >= 0 ? at : kept.length;
    if (at < 0 && kept.length && SCOPE.test(kept[kept.length - 1])) i = kept.length - 1;
    return [...kept.slice(0, i), line, ...kept.slice(i)].join('\n');
}

// 左滑重来沿用钉住的那一格（免得滑一次花一次），但"此刻的样子"随时在变、又不花钱：每次按最新的换进去
// （试玩 9/30：钉住的格子是这一块上线前拼的，左滑时一直没有）。末尾那一句提醒也一样按最新的换（试玩 9/30：左滑时一直是钉住时那句，
// 去复读这几次点出来的路数一句也没送到）。
const STATE_HEAD = /^此刻的样子（/;
function swapState(text, lines) {
    const kept = [];
    let inBlock = false;
    for (const l of String(text ?? '').split('\n')) {
        if (STATE_HEAD.test(l)) { inBlock = true; continue; }
        if (inBlock && l.startsWith('· ')) continue;
        inBlock = false;
        kept.push(l);
    }
    return lines.length ? [...kept.filter((l, i) => l || i < kept.length - 1), ...lines].join('\n') : kept.join('\n');
}
function refreshPinned(store, records, { chatKey, speaker, speakerName, present, anchor = null }, text, parts, { fresh = null, pace = null } = {}) {
    const name = speakerName || speaker;
    let lines = [], vary = null;
    try { lines = stateBlock(store, { chatKey, name, present, records, anchor, keepNote: bodyGuardFor(store, records, chatKey, { anchor, knower: speaker === CAMERA ? null : name }).keepNote }); } catch { return { text, parts }; }
    try {
        const messages = uptoAnchor(store.currentMessages(chatKey), anchor);
        vary = varyFor(store, { chatKey, speaker, name, userName: [...messages].reverse().find(m => m.is_user)?.name ?? null, messages, fresh, pace });
    } catch {}
    const hasOld = String(text ?? '').split('\n').some(l => STATE_HEAD.test(l) || VARY.test(l));
    if (!lines.length && !vary && !hasOld) return { text, parts };
    const swap = t => swapVary(swapState(t, lines), vary);
    const nextParts = parts ? { ...parts, now: parts.now ? swap(parts.now) : lines.length || vary ? soften([HEADS.now(name), ...lines, ...(vary ? [vary] : [])].join('\n')) : '' } : parts;
    return { text: swap(text), parts: nextParts };
}

// 这一局的时间尺度（章程 G2）：开局单"时间"那一格的"尺度"；没写就是天。
export function scaleFor(store, chatKey) {
    try { return scaleOf(store.setupOf?.(store.requireChat(chatKey).story_id)?.data ?? null); } catch { return DAY; }
}
// 这局的节奏（章程 H2）：开局单"节奏"那一格（快／中／慢）配这一局的尺度算出来的那组数；没写就是中。
export function paceFor(store, chatKey) {
    try { return paceOf(store.setupOf?.(store.requireChat(chatKey).story_id)?.data ?? null); } catch { return paceOf(null); }
}

export function timeMarksFor(store, records, chatKey, messages = store.currentMessages(chatKey)) {
    const storyId = store.requireChat(chatKey).story_id;
    const pending = messages.slice(-8).filter(m => !(records?.isDone?.(storyId, m.fp)));
    const skips = pending.map(m => ({ m, phrase: timeSkipIn(m.text) })).filter(x => x.phrase).map(x => ({ pos: x.m.pos, elapsed: x.phrase, provisional: true }));
    // 用户在消息"…"菜单里点的（最高权威，N-265）：从这条起算新的一天／这条是第几天（d:N，N 是标签上的天数）／这里没有跨天
    const base = Number.isInteger(store.setupOf?.(storyId)?.data?.时间?.第几天) ? store.setupOf(storyId).data.时间.第几天 : 1;
    // 手动定的时段（"…@下午"）只管时段，这里只看前半截的天
    const user = messages.filter(m => String(m.mark ?? '').split('@')[0]).map(m => ({ ...m, mark: String(m.mark).split('@')[0] })).map(m => {
        if (m.mark === 'day') return { pos: m.pos, elapsed: scaleFor(store, chatKey).nextText, manual: true };
        if (m.mark === 'same') return { pos: m.pos, cancel: true };
        const n = /^d:(\d{1,4})$/.exec(m.mark)?.[1];
        return n ? { pos: m.pos, setDay: Number(n) - base, manual: true } : null;
    }).filter(Boolean);
    // 此刻的样子报的"第二天·早上"（章程 I1）：记账还没写明"时间"的先按它跨天；同处叙述硬词临时认的让给它
    const timeRecs = (records?.visible?.(chatKey) ?? []).filter(r => r.type === '时间');
    return withNoteMarks([...absenceMarks(store.absences?.(chatKey) ?? []), ...skips, ...user], store.stateNotesOf?.(chatKey) ?? [], timeRecs, scaleFor(store, chatKey));
}

// 这个窗口的剧情日期（timeline.mjs）：每条消息第几天、什么时段，今天、此刻的时段；start＝开局单的"时间"那一格。
export function timelineFor(store, records, chatKey, messages = store.currentMessages(chatKey)) {
    const chat = store.requireChat(chatKey);
    const start = store.setupOf?.(chat.story_id)?.data?.时间 ?? null;
    const timeRecs = (records?.visible?.(chatKey) ?? []).filter(r => r.type === '时间');
    return { start, seed: chat.story_id, ...timeline({ messages, timeRecs, marks: timeMarksFor(store, records, chatKey, messages), notes: store.stateNotesOf?.(chatKey) ?? [], start, isDone: m => !!records?.isDone?.(chat.story_id, m.fp) }) };
}
// 规划简报里的【说好的事】（N-268）：还开着的走到哪一步；最近三天有了结果的，结果是什么（规划者按结果排后续）。
// ts：这一局的时间尺度（"明天"在年尺度下是"明年"）
const STAGE_WORDS = { eve: (ts = DAY) => ts.next, today: (ts = DAY) => ts.this, late: (ts = DAY) => `${ts.this}，过了说好的时候还没见办`, overdue: () => '到日子没办，还没个说法', open: (ts = DAY) => (ts.unit === '天' ? '没定准哪天，或者一段时间里哪天都行' : `没定准哪${ts.word === '个月' ? '个月' : ts.word}，或者一段时间里哪${ts.word === '个月' ? '个月' : ts.word}都行`), cond: () => '等条件', met: () => '条件到了', lapse: (ts = DAY) => (ts.unit === '天' ? '过了好几天没人再提' : `过了好几${ts.word}没人再提`) };
export function promiseBrief(store, records, chatKey, s) {
    const tl = timelineFor(store, records, chatKey, s.messages);
    const rows = new Map(tl.rows.map(r => [r.pos, r.part]));
    const weekdayOf = d => weekdayIndex(tl.start, d);
    const closedBy = settledBy(s.visible, { dayOf: s.dayOf, partAt: pos => rows.get(pos) ?? null, weekdayOf, timeScale: s.ts });
    const open = [], done = [];
    for (const r of s.visible.filter(r => r.promise)) {
        const p = promiseOf(r, { dayOf: s.dayOf, partAt: pos => rows.get(pos) ?? null, weekdayOf, timeScale: s.ts });
        if (!p) continue;
        const who = [...new Set([...p.doers, ...p.with])].join('和');
        const end = closedBy.get(r.id);
        if (end) {
            if (s.today - s.dayOf(end.pos) <= 3) done.push(`· [约${r.id}] ${who}：${r.text}（约在：${p.when || '没说'}）→ ${end.outcome}（${relativeDay(s.today - s.dayOf(end.pos), s.ts)}）${end.outcome !== LAPSED ? `：${end.text}` : ''}`);
            continue;
        }
        const stage = stageOf(p, { today: s.today, part: tl.part, timeScale: s.ts });
        const word = stage === 'later' ? `${s.ts.span(p.due.day - s.today)}后${p.due.part ? `的${p.due.part}` : ''}` : STAGE_WORDS[stage](s.ts);
        open.push(`· [约${r.id}] ${who}：${retime(r.text, p.saidDay, s.today, s.ts)}（约在：${p.when || '没说'}，${relativeDay(s.today - p.saidDay, s.ts)}说的；${p.kind}；眼下：${word}）`);
    }
    return [...open, ...done.slice(-8)];
}

// 开口的人这一轮的约定（composeSlot 先算一次）：shownIds＝"今天说好的"那一块会给他的，"惦记着"里就不重复。
function promisesFor(store, records, { chatKey, speaker, speakerName, present = [] }) {
    const visible = records.visible(chatKey);
    if (!visible.some(r => r.promise)) return null;
    const messages = store.currentMessages(chatKey);
    const lastPos = messages.at(-1)?.pos ?? 0;
    const dayOf = dayIndex([...visible.filter(r => r.type === '时间'), ...timeMarksFor(store, records, chatKey, messages)], lastPos, scaleFor(store, chatKey));
    const storyId = store.requireChat(chatKey).story_id;
    const rawRel = store.relationsOf?.(storyId);
    const now = promisesNow(store, records, chatKey, { visible, messages, dayOf, today: dayOf(lastPos + 0.5), present, rosterNames: (store.getCast?.(storyId) ?? []).map(e => e.name),
        rel: rawRel ? normalizeRelations(rawRel) : null, setup: store.setupOf?.(storyId)?.data ?? null });
    const name = speakerName || speaker;
    return { ...now, shownIds: new Set(now.stages.filter(({ p, stage }) => !['later', 'open', 'cond'].includes(stage) && partyOf(p, name, now.same)).map(({ p }) => p.id)) };
}

// 约定（promises.mjs，N-268、D-140）此刻各走到哪一步；hold＝今天有在场的人说好要办的事时，后台排的事怎么让路（menuFor／stepPocket）。
// 只看记账标了"约定"的；了结了的（记账记的办了、不办了、改了、没办成，或者程序记的"就这么过去了"）不算。
// told＝只提一次的（明天的、条件到了的、等会儿就办却过了时段的、就这么过去了的）已经给谁提过（meta）。
// 一段文字里说到了谁（别名也认）、两个称呼是不是同一个人。别名至少两个字才认（一个字的太容易撞上别的词）；名册里的名字照认。
export function nameFinder(rel, rosterNames = []) {
    const aliases = [...(rel?.人 ?? []).flatMap(p => [p.名, ...(p.又名 ?? [])].map(a => [a, p.名])).filter(([a]) => String(a ?? '').length >= 2), ...rosterNames.filter(Boolean).map(n => [n, n])];
    const names = text => [...new Set(aliases.filter(([a]) => String(text).includes(a)).map(([, n]) => n))];
    const same = (a, b) => a === b || sameName(a, b, rosterNames) || (!!rel && !!personOf(rel, a, rosterNames) && personOf(rel, a, rosterNames) === personOf(rel, b, rosterNames));
    return { names, same };
}
// 只提一次的已经在眼下这条历史上提过了没有：提的那条删掉了（删回去重来、换了分支）就当没提过。
// "就这么过去了"不靠这个记：它记成一条了结，了结在就是收了尾，跟着消息删了就重新收尾。老格式（只记了阶段）照旧当提过。
export function toldHere(told, id, stage, messages) {
    if (stage === 'lapse') return false;
    const live = new Set(messages.map(m => m.fp));
    return (told[id] ?? []).some(t => t === stage || (String(t).startsWith(`${stage}@`) && live.has(String(t).slice(stage.length + 1))));
}
// 约定被了结在哪条上（idea_ref → 那条了结）。程序自己记的"就这么过去了"要按眼下的天数再核一遍：记它的时候天数算错了的不算
// （试玩 10/6："从早上到午后"被算成过了一夜，那一拍把当天的五件约定都记成过去了，天数改回来以后它们还关着）。
export function settledBy(visible, { dayOf = () => 0, partAt = () => null, weekdayOf = null, timeScale = DAY } = {}) {
    const promises = new Map(visible.filter(r => r.promise).map(r => [r.id, r]));
    const lapsedThen = r => { const pr = promises.get(r.idea_ref); const p = pr ? promiseOf(pr, { dayOf, partAt, weekdayOf, timeScale }) : null; return !p || ['lapse', 'overdue'].includes(stageOf(p, { today: dayOf(r.pos + 0.5), part: partAt(r.pos), timeScale })); };   // 差一天也认（同样的话前后出现过，记在前一处）
    const out = new Map();
    for (const r of visible) if (r.type === '了结' && r.idea_ref != null && !(out.get(r.idea_ref)?.pos <= r.pos) && (r.outcome !== LAPSED || lapsedThen(r))) out.set(r.idea_ref, r);
    return out;
}
export const HOLD_FOR = 20;
const ONCE = p => s => s === 'eve' || s === 'met' || s === 'lapse' || (s === 'late' && p.due?.soon);
export function promisesNow(store, records, chatKey, { visible, messages, dayOf, today, present = [], rosterNames = [], rel = null, setup = null }) {
    const tl = timelineFor(store, records, chatKey, messages);
    const rows = new Map(tl.rows.map(r => [r.pos, r.part]));
    const weekdayOf = d => weekdayIndex(tl.start, d);
    const closedAt = new Map([...settledBy(visible, { dayOf, partAt: pos => rows.get(pos) ?? null, weekdayOf, timeScale: tl.scale })].map(([k, r]) => [k, r.pos]));
    const same = (a, b) => a === b || sameName(a, b, rosterNames) || (!!rel && !!personOf(rel, a, rosterNames) && personOf(rel, a, rosterNames) === personOf(rel, b, rosterNames));
    const twins = settledTwins(visible.filter(r => r.promise), closedAt);
    // 办了没人记了结的（用户 10/8）：办的人名下有一条说的是同一件的"做"，也算关上
    const closed = new Set([...closedAt.keys(), ...twins, ...settledByDoing(visible.filter(r => r.promise && !closedAt.has(r.id) && !twins.has(r.id)), visible, { dayOf, same }).keys()]);
    const start = setup?.钱 ?? [];
    const balance = who => balances(visible, { start, people: [who] }).find(x => same(x.name, who))?.now ?? null;
    let told = {};
    try { told = JSON.parse(store.getMeta?.(`promise_told:${chatKey}`) ?? '{}'); } catch {}
    const stages = visible.filter(r => r.promise && !closed.has(r.id))
        .map(r => promiseOf(r, { dayOf, partAt: pos => rows.get(pos) ?? null, weekdayOf, timeScale: tl.scale })).filter(Boolean)
        .map(p => ({ p, stage: stageOf(p, { today, part: tl.part, balance, timeScale: tl.scale }) }))
        .filter(({ p, stage }) => !(ONCE(p)(stage) && toldHere(told, p.id, stage, messages)));
    // 约定里说到的人（别名也认）：后台排的事是不是由他牵头
    const { names } = nameFinder(rel, rosterNames);
    const here = [...present];
    // 今天说好的事让后台排的事先放着，只放 HOLD_FOR 条：从今天开头（今天才说的从说的那条）算起过了这么多条还没去办，就不再拦
    // （试玩 10/5：废品站、验货这几件一直没去，剧情停在第五天八十来条，口袋全冻着，不递也不沉）。
    const lastPos = messages.at(-1)?.pos ?? 0;
    const todayFrom = messages.find(m => dayOf(m.pos + 0.5) >= today)?.pos ?? lastPos;
    const due = stages.filter(({ p, stage }) => stage === 'today' && [...p.doers, ...p.with].some(x => here.some(n => same(n, x)))
        && lastPos - Math.max(todayFrom, p.r.pos ?? 0) < HOLD_FOR);
    const relatedOne = m => due.find(({ p }) => relatedTo(p, m, { same, names, present: here }));
    // 说"这件和今天说好的是一回事"只认真对得上的（规划写明跟着它、内容或场合对得上、约定冲着牵头的那个人去）；办约定的人自己牵头的只拿来让路（试玩 10/7：箱子那件被说成和吃烤肉是一回事）
    const strongOne = m => due.find(({ p }) => relatedTo(p, m, { same, names, present: here, byPeople: 'named' }));
    const hold = due.length ? { related: m => !!relatedOne(m), strong: m => !!strongOne(m), party: (m, who) => (o => !!o && partyOf(o.p, who, same))(strongOne(m)), label: m => retime(strongOne(m)?.p.r.text ?? '', strongOne(m)?.p.saidDay ?? today, today, tl.scale).replace(/[（(][^）)]*[）)]/g, '').replace(/[。．.]+$/, '').split(/[，,；;]/)[0].slice(0, 40) } : null;
    const keeps = m => stages.some(({ p }) => relatedTo(p, m, { same, names, present: here }));
    return { stages, hold, keeps, same, once: ONCE, told };
}

export function clockFor(store, records, chatKey, messages) {
    const tl = timelineFor(store, records, chatKey, messages);
    return clockNow(tl.start, { today: tl.today, part: tl.part, seed: tl.seed });
}

// 场面停住了（B 段实测：用户只说"嗯""好"的 30 轮里，剧情一直停在同一个晚上，规划里后面几天的事一件都出不来）：
// 口袋空着、今天能来的都来过了、后面几天还排着事，用户最近三句都很短，就给开口的人一句"时间可以往后走"。隔 10 条以上才再给。
export function passiveUser(messages) {
    const said = messages.filter(m => m.is_user).slice(-3);
    return said.length >= 3 && said.every(m => String(m.text).trim().length <= 16);
}
const IDLE_HOLD = 8;
export function idleLine(store, chatKey, { messages, lastPos, today, userName = null, holdFor = 0, dayOf = null }) {
    const menu = menuDays(store, store.menuOf(chatKey), dayOf);
    if (!menu.length || menu.some(m => m.status === 'pocket' || m.status === 'shown')) return null;
    const waiting = menu.filter(m => m.status === 'waiting');
    if (!waiting.length || waiting.some(m => m.ready_day <= today)) return null;
    if (!passiveUser(messages)) return null;
    const key = `idle_nudge:${chatKey}`;
    const lastGiven = Number(store.getMeta?.(key) ?? -Infinity);
    if (lastPos - lastGiven < 10) return null;
    // 先等 holdFor 条（这一段停住以来第一次要劝时开始算；隔久了重新算）
    if (holdFor > 0) {
        const hk = `idle_hold:${chatKey}`;
        const held = Number(store.getMeta?.(hk) ?? NaN);
        if (!Number.isFinite(held) || lastPos - held > holdFor * 3) { store.setMeta?.(hk, String(lastPos)); return null; }
        if (lastPos - held < holdFor) return null;
    }
    store.setMeta?.(key, String(lastPos));
    const who = userName ?? '对方';
    return `（眼下没什么事等着，${who}这一阵只回一两个字：先看是心满意足、累了，还是在闷着、躲着——闷着的话先接住这个，别急着跳过去；场面真是自然停住了，可以让时间往后走——入夜、睡下、第二天、过几天——别一直停在同一刻；怎么过、过多久由你写，别替${who}定下什么。）`;
}

// 这个窗口此刻各对人的关系（记账的"关系"记录＋最近一份交回的规划写的关系现状，取更晚的）。
export function relationsNow(store, chatKey, rel, visible, rosterNames = []) {
    const last = playModeOf(store, chatKey) === 'full' ? store.lastReadyPlan?.(chatKey) : null;
    const node = last?.node ? JSON.parse(last.node) : null;
    return currentRelations(rel, { records: visible, plan: node?.关系?.length ? { relations: node.关系, pos: last.anchor_pos ?? -1 } : null, roster: rosterNames });
}

// 口袋过期、前提没了（章程 F1）：给 stepPocket 的 gone(m)。镜头在哪、谁在场按场面表（某一条上的、此刻的）；时段按时间线；
// 前提里"某人还没来找她"那种，他从这件排下的那条以后进过场（landing.enteredSince）就作废。场面表按条现算，同一条只算一次
export function pocketGone(store, records, chatKey, { messages, roster = [], rosterNames = [], board = null, here = [], today = 0, dayOf = null }) {
    const tl = timelineFor(store, records, chatKey, messages);
    const parts = new Map((tl.rows ?? []).map(r => [r.pos, r.part]));
    const partAt = pos => parts.get(pos) ?? [...parts].filter(([p]) => p <= pos).at(-1)?.[1] ?? null;
    const boards = new Map();
    const boardAt = pos => {
        if (!boards.has(pos)) {
            const m = messages.find(x => x.pos === pos);
            let b = null;
            try { b = m ? boardFor(store, records, chatKey, { anchor: `${pos + 1}:${m.fp}`, present: [], recentUser: '', timeline: tl }) : null; } catch {}
            boards.set(pos, b);
        }
        return boards.get(pos);
    };
    let anchors = null, arrivals = [];
    try { anchors = JSON.parse(store.requireChat(chatKey).anchors ?? 'null'); } catch {}
    try { arrivals = JSON.parse(store.getMeta?.(`arrivals:${chatKey}`) ?? '[]') ?? []; } catch {}
    const avatarOf = n => roster.find(e => sameName(e.name, n, rosterNames))?.avatar ?? null;
    const sinceOf = m => (m.anchor_pos != null ? m.anchor_pos : store.planById?.(m.plan_id)?.anchor_pos ?? null);
    const ctx = { today, dayOf, at: messages.at(-1)?.pos ?? 0, partAt, placeAt: pos => boardAt(pos)?.camera?.place ?? null, placeNow: board?.camera?.place ?? null,
        presentAt: pos => presentOn(boardAt(pos)), presentNow: here, same: (a, b) => sameName(a, b, rosterNames) };
    const names = rosterNames.filter(n => n && n !== CAMERA_NAME);
    return m => premiseGone(m, { names, since: sinceOf, entered: (who, pos) => enteredSince(pos, { who, avatar: avatarOf(who), messages, anchors, arrivals }) }) ?? expiredPocket(m, ctx);
}

// 一场戏里已经叠了几件（章程 H2，给 stepPocket 的 stacked）：拿出来还没下文的那几件，拿出来那条上的场面（镜头在哪、谁在场）
// 和最后一条上的一样、又是同一个剧情日。两头都按同一种算法现算场面表（不带"此刻在场"的提示），免得两边口径不一
export function pocketStack(store, records, chatKey, { menu, messages, rosterNames = [], today = null, dayOf = null }) {
    // 只看今天拿出来的（前一天的不算同一场戏）：没有就不必现算场面表
    const out = (menu ?? []).filter(m => m.status === 'shown' && Number.isFinite(m.settled_pos) && (!dayOf || !Number.isFinite(today) || dayOf(m.settled_pos + 0.5) === today));
    if (!out.length) return 0;
    const last = messages.at(-1);
    if (!last) return 0;
    const tl = timelineFor(store, records, chatKey, messages);
    const sceneAt = pos => {
        const m = messages.find(x => x.pos === pos);
        if (!m) return null;
        let b = null;
        try { b = boardFor(store, records, chatKey, { anchor: `${pos + 1}:${m.fp}`, present: [], recentUser: '', timeline: tl }); } catch {}
        return b ? { place: b.camera?.place ?? null, present: presentOn(b) } : null;
    };
    return stackedHere(out, { sceneAt, now: sceneAt(last.pos), same: (a, b) => sameName(a, b, rosterNames), dayOf, today });
}
const presentOn = b => (b?.people ?? []).filter(p => p.status === 'present' && p.name !== CAMERA_NAME).map(p => p.name);

// 规划里的"第几天后"按规划那条消息现在算第几天来折（存的是要规划那会儿算的天数：后来日子的认定改了——比如开场多算的一天被修掉——
// 到时候的事就整体错开，试玩 10/1"明早第一站去老维那儿"那件因此晚了一天）。后来补进节点的几件（挂在别的消息上）照存的算。
// 改期（章程 L1）：跳时间跳过了主线的活动，日子挪到跳后第一格（eventlead.moveEvent 记在 meta 里、挂在玩家那条上）——这里套上
export function menuDays(store, menu, dayOf) {
    const moved = list => { try { return list.length && store.getMeta ? applyMoves(list, movesOf(store, list[0].chat_key)) : list; } catch { return list; } };
    if (!dayOf || !store.planById) return moved(menu);
    const shift = new Map();
    for (const m of menu) {
        if (shift.has(m.plan_id)) continue;
        const plan = store.planById(m.plan_id);
        shift.set(m.plan_id, plan?.anchor_pos != null && Number.isFinite(plan.story_day) ? dayOf(plan.anchor_pos + 0.5) - plan.story_day : 0);
    }
    // said_day：这件是哪天写的（规划者写的"明早""今晚"递给前台时按今天换说法）
    const planDay = id => { const p = store.planById(id); return p?.anchor_pos != null ? dayOf(p.anchor_pos + 0.5) : null; };
    return moved(menu.map(m => ({ ...m, ...(m.anchor_pos == null && shift.get(m.plan_id) ? { ready_day: m.ready_day + shift.get(m.plan_id) } : {}),
        said_day: m.anchor_pos != null ? dayOf(m.anchor_pos + 0.5) : planDay(m.plan_id) })));
}

// 生人（N-269，用户 10/1：城里没人知道每个陌生人叫什么）：规划里的新面孔是生人、正文里还没人叫过他的名字的，递给前台时只用称呼，
// 名字留着——有人问了、查了、看见名牌才用。街坊熟人照叫名字。老规划没写熟不熟的，按"是谁"那句猜（邻居、楼里、对门……算熟）；没写称呼的取"是谁"的头一截。
const KNOWN_FACE = /邻居|街坊|楼里|楼下|楼上|对门|隔壁|熟人|老相识|老朋友|认识.{0,6}多年/;
export function strangerCall(roster, messages) {
    const said = messages.map(m => m.text).join('\n');
    return who => {
        const e = roleOf(roster, who);
        if (e?.role !== '新面孔' || e.stranger === 0 || (e.stranger == null && KNOWN_FACE.test(e.hook ?? ''))) return null;
        const head = String(e.name).split(/[·・（(]/)[0];
        if (said.includes(head.length >= 2 ? head : e.name)) return null;
        return e.call || String(e.hook ?? '').split(/[，,；;。]/)[0].slice(0, 24) || '一个面生的人';
    };
}
// 称呼里"的"前面那截（地方）这句话里已经说过了，就只说"那个＋后面那截"（"那个经纪人"）（质量窗 10/5）
export const callIn = (call, text) => {
    const i = call.lastIndexOf('的');
    if (i <= 0 || i >= call.length - 1) return call;
    const runs = call.slice(0, i).match(/[\u4e00-\u9fff]{2,}/g) ?? [];
    return runs.some(w => String(text).includes(w.slice(-2))) ? `那个${call.slice(i + 1)}` : call;
};
// 口袋里一件事递给前台的那几格（题、露面、应答、知情、用在、由头、沉底、接了会怎样）过一道换词（用户 10/12，N-368：
// 写成"利用""拿捏"，前台就把角色演成反派）。只换递出去的这一份，库里的原文不动
const WARM_CELLS = ['title', 'surface', 'respond', 'know', 'fit', 'errand', 'sink', 'if_taken'];
const warmItem = m => (m ? { ...m, ...Object.fromEntries(WARM_CELLS.filter(k => typeof m[k] === 'string').map(k => [k, warmWords(m[k])])) } : m);
const maskName = (m, call) => {
    if (!call) return m;
    const head = String(m.who).split(/[·・（(]/)[0];
    const swap = t => (t == null ? t : (c => String(t).split(m.who).join(c).split(head.length >= 2 ? head : m.who).join(c))(callIn(call, t)));
    return { ...m, who: call, title: swap(m.title), surface: swap(m.surface), respond: swap(m.respond), know: swap(m.know), sink: swap(m.sink) };
};

const HOLD_SPAN = 6, AIM_WAIT = 6, ERRAND_GAP = 12, NODE_EVERY = 40;
function menuFor(store, chatKey, { records = null, isCarded = () => false, scene = '', partAt = () => null, awaySince = () => false, speaker, present, recentUser, userName, today, dayOf = null, firm = null, at = 0, passive = false, record, carry = null, followers = () => [], giver = () => null, face = () => false, player = [], hold = null, keep = () => false, stranger = () => null, named = () => [], same = () => false, camera = false, carded = () => false, arrive = null, board = null, wentOff = null, anchorAt = null, anchorMsg = null, given = null, hide = () => false }) {
    // 在同一条上换了个人开口：前一个人那一步（他那条回复删了）不算，那件回到之前那一步（store.menuOf）
    const allowed = intimateAllowed(store, records, chatKey, { present });
    const menu = menuDays(store, store.menuOf(chatKey, { speaker }), dayOf).filter(m => !hide(m) && (m.purpose !== '亲密' || (!camera && m.who === speaker && isCarded(m.who) && allowed(m))));
    if (!menu.length) return [];
    // 交给他的这一步：挂在被回的那条上，等他这条回复（store.menuOf 的 pending）
    const step = status => ({ status, by: speaker, pending: true, ...(anchorMsg ? { at: { pos: anchorMsg.pos, fp: anchorMsg.fp } } : {}) });
    // 到日子的进口袋、放久了沉底：在折那一步做（advanceWorld，组格前已经跑过），这里拿到的菜单就是折过的
    const lines = [], blocks = [];
    // place：露面（由他挑时候的）和刚沉下去的放中段（最近两轮之前）；玩家伸手接了的、已经拿出来要交后半截的放最后（是对眼下这句的回应）
    const add = (tier, arr, place = 'now') => { if (arr?.length) { blocks.push({ tier, lines: arr, place }); lines.push(...arr); } };
    const intimateLines = m => m.purpose === '亲密' ? [intimateDetail(m), pocketIntimateFor(store, chatKey)].filter(Boolean) : [];
    lines.blocks = blocks;
    // 沉底：刚沉下去的，给接下来开口的人顺带一提（只提一次）
    // 规划者写的"明早""今晚"按今天换说法；生人只用称呼
    const menuTs = scaleFor(store, chatKey);
    const dated = m => (Number.isFinite(m.said_day) && m.said_day !== today ? { ...m, ...Object.fromEntries(['surface', 'respond', 'know', 'sink', 'fit'].map(k => [k, m[k] == null ? m[k] : retime(m[k], m.said_day, today, menuTs)])) } : m);
    const shownAs = m => warmItem(maskName(dated(m), stranger(m.who)));
    for (const m of menu.filter(m => m.status === 'sunk')) {
        add(3, sinkLines(shownAs(m)), 'mid');
        if (record) store.updateMenu(chatKey, m.id, step('sunk_told'));
    }
    // 口袋里可以同时有几件（份数看事态，见 stepPocket）。这一格只给和他有关的：他牵头的，外加至多一两件不在场的人或"世界"牵头的。
    // 玩家牵头的事（规划写成了"V 查账户""V 去找谁"）：没有哪个角色是玩家，交给在场开口的人，从他眼里带出来（试玩 9/30）
    const isPlayer = who => player.includes(who);
    const sameAs = (a, b) => a === b || same(a, b);
    // 别人牵头的事递给谁（N-277，用户 10/2：在场的卡一多，下一个开口的人拿到同一件、再演一遍；记账认出"写出来了"要攒几条才记）：
    // 递出去就先锁给他；他走了、或者隔了 HOLD_SPAN 条他都没再开口，才放给别人。
    // 冲着某个在场的人来的（路人冲谁嚷嚷）：先等那个人开口；等了 AIM_WAIT 条还没轮到，才给别人，并写明只写自己看见听见的。
    const holder = m => (m.held_by && present.some(n => sameAs(n, m.held_by)) && at - (m.held_pos ?? -Infinity) < HOLD_SPAN ? m.held_by : null);
    const remoteSpeaker = board?.people?.some(p => sameAs(p.name, speaker) && p.status === 'remote');
    const mine = m => remoteSpeaker ? m.who === speaker : (m.who === speaker || ((isPlayer(m.who) || !present.includes(m.who)) && (h => !h || sameAs(h, speaker))(holder(m))));
    const forOthers = m => {
        if (m.who === speaker) return null;
        const aimed = present.filter(n => !isPlayer(n) && !sameAs(n, m.who) && named(`${m.title ?? ''}${m.surface ?? ''}`).some(x => sameAs(x, n)));
        return aimed.length && !aimed.some(n => sameAs(n, speaker)) ? aimed : null;
    };
    const waited = m => Number.isFinite(m.pocket_pos) && at - m.pocket_pos >= AIM_WAIT;
    const mayTake = m => !forOthers(m) || waited(m) || (h => !!h && sameAs(h, speaker))(holder(m));
    const aside = m => (who => (who ? [`  （这件冲着${who}来：你只写你看见、听见的和你自己的反应；${who}怎么回、回不回，留给${who}自己）`] : []))(forOthers(m)?.join('、'));
    // 已经拿出来了的（记账认出来的）：交出后半截，然后算用上了。
    // 牵头的是不在场的有卡的人（他发来的消息、他的事）：后半截是他的话，只交给他本人——他从门上进来（发消息、打电话、上门）时拿；
    // 镜头、别的人不替他说（试玩 10/9：他发来的消息拿出来了，后半截交给了先开口的旁白，他本人一直拿不到）
    for (const m of menu.filter(m => m.status === 'shown' && mine(m) && mayTake(m) && !(carded(m.who) && !sameAs(m.who, speaker)))) {
        add(0, [...shownLines(shownAs(m), { userName: userName ?? '玩家', speaker }), ...intimateLines(m), ...aside(m)]);
        if (record) store.updateMenu(chatKey, m.id, step('used'));
    }
    // 在这一条上交给他、他这一条又删了重来的（试玩 10/7：#287 删了重新生成，那件挂在 #286 上一直算用过，后面几版都拿不到）：
    // 交的那一步就在眼下这一条上、交给的就是他——这一版照样给他，当它还在口袋里
    // 按这一格的锚点认（试玩 10/7：左滑重来时后台里旧的那一版还在，按最后一条认就对不上，又没给）
    const redo = m => m.status === 'used' && m.settled_pos === (anchorAt ?? at) && !!m.settled_by && sameAs(m.settled_by, speaker);
    const pockets = menu.filter(m => (m.status === 'pocket' || redo(m)) && mine(m));
    const offered = [];
    // 镜头外：时间真过去了没有；到现场：谁会去那儿（规划写了"谁去"就照它，没写从"用在"里认人名）、上回提他是哪条（隔 12 条才再提）
    // 镜头外的那件给不给他：剧情时间真过去了（跨天、时段跳两档）、玩家离开过，或者他自己到日子以后离开过镜头（离场去办事，试玩 10/7：
    // 他出去办过那件事、回来自己也提了，可那天一直是同一个时段，那件就一直等着）
    const passed = m => timePassed(m, { at, dayOf, partAt, away: Number.isFinite(m.pocket_pos) && awaySince(m.pocket_pos) }) || !!wentOff?.(m.who, m.ready_day);
    const goerOf = m => m.goer || named(m.fit ?? '').find(n => !isPlayer(n)) || null;
    const errandDue = m => at - Number(store.getMeta?.(`errand:${chatKey}:${m.id}`) ?? -Infinity) >= ERRAND_GAP;
    for (const pocket of pockets) {
        const entry = entryOf(pocket);
        if (entry === '镜头外' && !(recentUser && reachedFor(pocket, recentUser) && passed(pocket))) {
            // 当场不递（质量窗 10/5：前台在实时场面里替他把镜头外的事做完，"几分钟内跳了个'去找过中介了'"）。
            // 剧情时间真过去了，牵头的人下次开口时给他一句"这段时间你自己碰上过"——他一直守着没走开，就当没发生
            if (!camera && sameAs(pocket.who, speaker) && passed(pocket)) {
                add(1, [...offscreenLines(shownAs(pocket), { userName: userName ?? '玩家' }), ...intimateLines(pocket)]);
                given?.push(shownAs(pocket));
                if (record) store.updateMenu(chatKey, pocket.id, step('used'));
            }
            continue;
        }
        if (entry === '到现场' && !nearPlace(pocket, scene, named(`${pocket.place ?? ''}${pocket.fit ?? ''}`)) && !(recentUser && reachedFor(pocket, recentUser))) {
            // 还没去那儿：不递口袋，只给会去的那个人一句由头（去不去、什么时候去由他）
            const goer = goerOf(pocket);
            if (!camera && pocket.errand && goer && sameAs(goer, speaker) && errandDue(pocket)) {
                add(2, errandLines(shownAs(pocket), { goer: speaker }), 'back');
                if (record) store.setMeta?.(`errand:${chatKey}:${pocket.id}`, String(at));
            }
            continue;
        }
        if (recentUser && reachedFor(pocket, recentUser)) {
            // 玩家伸手了：眼下开口的人接（冲着别人来的照样写明只写自己那份）
            add(0, [...respondLines(shownAs(pocket), { userName: userName ?? '玩家', speaker }), ...intimateLines(pocket), ...aside(pocket)]);
            carry?.push(pocketCarry(shownAs(pocket), { userName: userName ?? '玩家', speaker }));
            if (record) store.updateMenu(chatKey, pocket.id, step('used'));
        } else if ((!hold || hold.related(pocket) || pocket.motif === NOW_MOTIF) && mayTake(pocket) && !(camera && (pocket.offscreen || OFFSCREEN_FIT.test(pocket.fit ?? '')))) offered.push(pocket);   // 今天有说好的事：和它无关的先放着（N-268）；镜头跟着玩家，玩家不在时发生在别人身上的不归它
    }
    // 一轮只给一件（用户 10/1：给了几件"挑合适的用"，前台常是件件都用）：他自己牵头的优先；再是已经递给他的、冲着他来的；没有就给一件别人的（玩家那边的事算别人的）
    // 刚闹出的动静引来的后续（D-170）排在最前：它就是冲着眼前这一摊来的
    const shown = [offered.find(m => m.motif === NOW_MOTIF && (m.who === speaker || !present.includes(m.who))) ?? offered.find(m => m.who === speaker) ?? offered.find(m => holder(m) && sameAs(holder(m), speaker))
        ?? offered.find(m => named(`${m.title ?? ''}${m.surface ?? ''}`).some(x => sameAs(x, speaker))) ?? offered[0]].filter(Boolean);
    shown.forEach(pocket => {
        // 镜头那一格：不在场的、有卡的人牵头的事，镜头不替他演——改成"这一段让他来"，那件事留在口袋里，等他来了自己拿出来（N-292）
        if (camera && arrive && carded(pocket.who)) { arrive(pocket); return; }
        const call = stranger(pocket.who);
        const [head, ...body] = pocketLines(shownAs(pocket), { userName: userName ?? '玩家', speaker, camera });
        if (record && pocket.who !== speaker) store.updateMenu(chatKey, pocket.id, step('offered'));
        // 一轮就这一件：超长让位时排在背景、关系这些常备的后面才让（试玩 10/1：今天有约、此刻的样子又长，老维那件被长度挤掉了）
        add(1, [head, ...body, ...intimateLines(pocket), ...aside(pocket),
            ...(hold?.related(pocket) && hold.label(pocket) ? [`  （这件和${hold.today?.(pocket) ? '今天' : ''}说好的「${hold.label(pocket)}」是一回事：办那件事的时候用得上）`] : []),
            // "世界"只留给真没人牵头的；新面孔没有卡，由前台把他写出来（D-107：以前这类事都挂"世界"，递成"从新闻、广播里冒出来"，和"房东端来一盘菜"对不上）
            ...(isPlayer(pocket.who) ? [camera ? `  （这是${userName ?? '玩家'}那边的事：别替${userName ?? '玩家'}做、别替${userName ?? '玩家'}说和想；只能从看得见、听得见的地方带出来——捎来的一句话、门口的动静、按这个世界说得通的方式递到眼前的消息，做不做由${userName ?? '玩家'}）`
                : `  （这是${userName ?? '玩家'}那边的事：别替${userName ?? '玩家'}做、别替${playerWord(playerContext(store, chatKey))}说和想；只能从你看得见、听得见的地方带出来，或者由你提起、问起、帮${playerWord(playerContext(store, chatKey))}张罗，做不做由${playerWord(playerContext(store, chatKey))}）`]
                : pocket.who === WORLD ? ['  （这件事不是哪个人牵头：传闻、捎来的话、路人、这个地方本身的动静都行，按这个世界说得通的方式带出来）']
                : entryOf(pocket) === '到现场' && (call || face(pocket.who) || !present.includes(pocket.who)) ? [`  （${call ?? pocket.who}在${pocket.place || '那儿'}：他们到了那儿会碰上${call || face(pocket.who) ? `——这一局新出现的人，没有卡，由你把${personWord(pocket.who)}写出来` : ''}${call ? `；正文里还没人叫过${personWord(pocket.who)}的名字，就别写名字，只按看得见的样子写；有人问了、查了、看见名牌，${personWord(pocket.who)}叫${pocket.who}` : ''}）`]
                : call ? [`  （${call}是这一局里新出现的人，没有卡：由你把${personWord(pocket.who)}写出来——露面、捎话或者找上门，按这个世界说得通的方式。正文里还没人叫过${personWord(pocket.who)}的名字，就别写名字，只按看得见的样子写；有人问了、查了、看见名牌，${personWord(pocket.who)}叫${pocket.who}）`]
                : face(pocket.who) ? [`  （${pocket.who}是这一局里新出现的人，没有卡：由你把${pocket.who}写出来——露面、捎话或者找上门，按这个世界说得通的方式）`]
                : present.includes(pocket.who) ? [] : hold?.related(pocket) ? [`  （${pocket.who}不在场：多半是去办今天说好的那件事时见到${personWord(pocket.who)}；或者${personWord(pocket.who)}捎来话、找上门）`]
                : [`  （${pocket.who}不在场：要写就写成${pocket.who}捎来话、来信或者找上门——用这个世界里说得通的方式）`]),
            ...(followers(pocket.who).length ? [`  （${followers(pocket.who).join('、')}一直跟着${pocket.who}，一起出现）`] : []),
            // 派活的人来的单子：他管哪片、派哪几档、这几档的价码，程序替前台查好（价码只认价表）。
            ...(giver(pocket.who) ? [`  （${pocket.who}是派活的：${giver(pocket.who)}）`] : []),
            // B 段实测：用户只说"嗯""好"时，角色一直让场面停在原处，口袋里的事"挑时候"挑了二十来条也没拿出来。
            ...(passive && Number.isFinite(pocket.pocket_pos) && at - pocket.pocket_pos >= 10
                ? [`  （这件放了好一阵了，${userName ?? '对方'}这一阵也只是跟着：可以让它这一轮冒出来——有人捎来话、有人敲门、${personWord(speaker)}自己想起来；${personWord(speaker)}怎么对待它，照${personWord(speaker)}的性子。）`] : [])], 'mid');
    });
    return lines;
}

// 这个窗口此刻的剧情状况（剧情日、谁在场、名册与亲疏、不在场的人）：规划、查账、笔记都用。
export function storyContext(store, records, chatKey, { present = null } = {}) {
    const chat = store.requireChat(chatKey);
    const visible = records.visible(chatKey);
    const messages = store.currentMessages(chatKey);
    const lastPos = messages.at(-1)?.pos ?? 0;
    const dayOf = dayIndex([...visible.filter(r => r.type === '时间'), ...timeMarksFor(store, records, chatKey, messages)], lastPos, scaleFor(store, chatKey));
    const today = dayOf(lastPos + 0.5);   // 离开记在最后那条之后半格：回来由角色先开口时，今天已经是离开之后
    const userName = [...messages].reverse().find(m => m.is_user)?.name ?? null;
    const members = chat.members ? JSON.parse(chat.members) : [];
    const here = present ?? [userName, ...members.filter(m => !m.disabled).map(m => m.name)].filter(Boolean);
    const roster = store.getCast?.(chat.story_id) ?? [];
    const openIdeaIds = new Set(records.openIdeas(chatKey).map(r => r.id));
    const closenessOf = (person, entry = roleOf(roster, person)) => closeness({ name: person, userName, entry, records: visible, dayOf, lastPos, openIdeaIds });
    const ts = scaleFor(store, chatKey);
    // 规划者看的材料也用场记那一种说"哪天"的写法（timeline.timeTag）
    const timeStart = store.setupOf?.(chat.story_id)?.data?.时间 ?? null;
    const when = r => timeTag(dayOf(r.pos), { start: timeStart, today, timeScale: ts });
    return { chat, visible, messages, lastPos, dayOf, today, ts, userName, present: here, roster, openIdeaIds, closenessOf, when,
        people: () => absentPeople({ records: visible, messages, present: here, userName, roster, openIdeaIds, closenessOf, dayOf, timeScale: ts }) };
}

// 现在就叫规划者（发言前按需触发、面板按钮、/聊 都走这里）：攒简报、记一条"等规划"、交给 provider。
const LASTING_CHANGE = new Set(['直到被改变', '永久']);

export function planPersonaOf(store, chatKey) {
    const chat = store.requireChat(chatKey);
    let persona = null;
    try { persona = JSON.parse(store.getMeta(`persona:${chatKey}`) ?? 'null'); } catch {}
    const current = typeof persona?.name === 'string' ? persona.name.trim() : '';
    let previous = store.getMeta(`plan_persona:${chat.story_id}`) || null;
    // 老局已有生效规划：第一次检查只补记当前名字，不打断正在玩的局。
    if (!previous && current && store.lastReadyPlan(chatKey)) {
        previous = current; store.setMeta(`plan_persona:${chat.story_id}`, current);
    }
    return { current, previous };
}

export function holdPlanPersona(store, request) {
    const { current, previous } = planPersonaOf(store, request.chatKey);
    if (current && current === previous) { store.setMeta(`plan_persona_wait:${request.chatKey}`, null); return null; }
    const { id, chatKey, reason = 'user', verdict = null, thread = null, force = null, entry = 'auto', source = null } = request;
    store.setMeta(`plan_persona_wait:${chatKey}`, JSON.stringify({ id, chatKey, reason, verdict, thread, force, entry, source }));
    return { current, previous };
}

export function awaitingPlanPersona(store, chatKey) {
    let wait = null;
    try { wait = JSON.parse(store.getMeta(`plan_persona_wait:${chatKey}`) ?? 'null'); } catch {}
    if (!wait || store.planById(wait.id)?.status !== 'requested') return null;
    const p = planPersonaOf(store, chatKey);
    return { ...p, id: wait.id };
}

export function confirmPlanPersona(store, chatKey, expected = null) {
    const chat = store.requireChat(chatKey), p = planPersonaOf(store, chatKey);
    if (!p.current || (expected != null && p.current !== expected)) throw Object.assign(new Error('人设变了或还没送到后台，请重新核对'), { status: 409 });
    store.setMeta(`plan_persona:${chat.story_id}`, p.current);
    let wait = null;
    try { wait = JSON.parse(store.getMeta(`plan_persona_wait:${chatKey}`) ?? 'null'); } catch {}
    store.setMeta(`plan_persona_wait:${chatKey}`, null);
    return wait && store.planById(wait.id)?.status === 'requested' ? wait : null;
}

export function requestPlanNow(store, records, chatKey, planner, { reason = 'user', present = null, verdict = null, thread = null, basis = null, force = null, entry = 'auto', source = null } = {}) {
    const stopped = playStop(store, chatKey); if (stopped) return stopped;
    const factionNet = planner.factionNet?.(chatKey) ?? null, sit = planner.situation ?? null, prices = planner.prices?.(chatKey) ?? null, facts = planner.facts?.(chatKey) ?? null;
    const last = store.lastPlan(chatKey);
    const reroll = reason === 'reroll', previous = reroll ? store.lastReadyPlan?.(chatKey) : null;
    if (last?.status === 'requested' && (!reroll || store.activePlanAttempt?.(chatKey, last.id))) return last.id;
    if (previous && store.activePlanAttempt?.(chatKey, previous.id)) return previous.id;
    const s = storyContext(store, records, chatKey, { present });
    const opts = { present, reason, verdict, thread, factionNet, sit, prices, facts, rerollOf: previous?.id ?? null, ...(planner.briefChars ? { budget: planner.briefChars } : {}) };
    const brief = planBrief(store, records, chatKey, opts);
    const retry = last?.status === 'requested';
    const id = retry ? last.id : store.requestPlan({ chatKey, storyDay: s.today, reason, provider: planner.provider, brief, basis, rerollOf: previous?.id ?? null });
    store.setPlanSource?.(id, source ?? (reroll ? 'button' : entry));
    if (retry) { store.setPlanBrief(id, brief); if (previous) store.setMeta(`replan_of:${id}`, String(previous.id)); }
    // rebrief：备料、参谋备忘回来以后带上它们按同样的参数重攒（备料也算进预算，章程 H4）
    planner.onRequest?.({ id, chatKey, brief, reason, verdict, thread, source, entry: reroll ? 'button' : entry, rebrief: prep => planBrief(store, records, chatKey, { ...opts, prep }), ...(force ? { force } : {}) });
    return id;
}

// 上一份生效规划的三类节奏提醒；只读日志，坏记录跳过。
function rhythmFor(store, chatKey, planId) {
    if (!planId || !store.db) return [];
    return store.db.prepare("select detail from events where chat_key = ? and kind = 'plan_warnings' order by id").all(chatKey).flatMap(row => {
        let detail;
        try { detail = JSON.parse(row.detail); } catch { return []; }
        if (detail?.plan !== planId || !Array.isArray(detail.warnings)) return [];
        return detail.warnings.filter(w => typeof w === 'string' && (w.startsWith('这一份没有意外')
            || /^第 [1-9]\d* 天挤了 /.test(w) || /^(?:今天|第 [1-9]\d* 天)有 (?:[2-9]|[1-9]\d+) 件一整轮的重戏/.test(w)));
    });
}
// 这一局此刻的规划简报（要规划时攒一次；"再试一次"、重启补包时按此刻的账重攒，别拿要规划那会儿的旧简报）。
// prep：规划前备料、参谋备忘（各一段文字），放在设定之后、局面之前
// budget：简报至多多少字（章程 H4，planner.briefChars）；超了按远近压（squeezeBrief），没超一个字不动
export function planBrief(store, records, chatKey, { present = null, reason = null, rerollOf = null, verdict = null, thread = null, factionNet = null, sit = null, prices = null, facts = null, prep = [], budget = BRIEF_CHARS } = {}) {
    const s = storyContext(store, records, chatKey, { present });
    const replaced = new Set(), ready = store.readyPlans?.(chatKey) ?? [];
    let previous = rerollOf ?? (reason === 'reroll' ? store.lastReadyPlan?.(chatKey)?.id : null);
    while (previous && !replaced.has(Number(previous)) && ready.some(p => p.id === Number(previous))) {
        replaced.add(Number(previous)); previous = Number(store.getMeta?.(`replan_of:${previous}`)) || null;
    }
    const last = replaced.size ? ready.filter(p => !replaced.has(p.id) && p.id < Math.min(...replaced)).at(-1) ?? null : store.lastReadyPlan?.(chatKey) ?? null;
    const notes = store.notesOf?.(chatKey) ?? [];
    // taken：玩家接了没有（用上了，或拿出来以后玩家伸手了）——接了的带上"往后"，规划给它排后续（章程 F2）
    const unseen = m => replaced.has(m.plan_id) && (['waiting', 'pocket'].includes(m.status) || (m.status === 'void' && m.why === '被重新规划替换'));
    const menu = store.menuOf(chatKey).filter(m => !unseen(m)).map(m => ({ ...m, taken: takenOf(m, s.messages) }));
    const rerollTitles = replaced.size ? [...new Set(store.menuOf(chatKey, { all: true }).filter(unseen).map(m => m.title).filter(Boolean))].slice(0, 20) : [];
    let setupChanges = [];
    // 开局单改动跟这一串里最早那份比（连点几次重排，改动每次都点名）
    const replacing = replaced.size ? ready.find(p => p.id === Math.min(...replaced)) : null;
    const currentSetup = replaced.size ? store.setupOf?.(s.chat.story_id) : null;
    if (replacing && currentSetup?.created_at > replacing.created_at) {
        const old = store.setupAt?.(s.chat.story_id, replacing.created_at);
        const before = new Set((old?.data ? setupText(old.data) : '').replaceAll('\r\n', '\n').split('\n'));
        setupChanges = setupText(currentSetup.data).replaceAll('\r\n', '\n').split('\n').filter(line => line.trim() && !before.has(line));
    }
    // 这一局到现在：账本要事按剧情日排（取代原先"最近两天的改变"＋"一直有效的改变"两段——一个窗口只跨两三天时，那样切会丢掉大半前情）。
    const digest = storyDigest(s.visible, { dayOf: s.dayOf, today: s.today, when: d => relativeDay(d, s.ts) });
    const rel = (r => (r ? normalizeRelations(r) : null))(store.relationsOf?.(s.chat.story_id));
    const setup = staleBackstory(withSecretLeaks(intimateSetup(store, chatKey), activeLeaks(store, records, chatKey)), s.visible, s.userName);
    const lastNode = last?.node ? JSON.parse(last.node) : null;
    // 三样对账（章程 J1，用户 10/12：基调写的轻松热闹，规划连着几份排伤病；开局单写好要来的主线在"往后"里推了六份）：
    // 最近几份交回的规划（新的在前）的节点和事件，交给 planner 里的纯函数数——类别排了几件、拖着的线、该来的还没来
    // （每份排过的事要全的：menuOf 只留眼下还算数的，旧规划里没放出来、被新规划接手的不在里面）
    const recentRows = ready.filter(p => !replaced.has(p.id)).slice(-LOOKBACK_PLANS).reverse();
    const planned = store.planItems?.(chatKey, recentRows.slice(0, 2).map(p => p.id)) ?? menu;
    const recentPlans = recentRows.map(p => ({ node: (() => { try { return p.node ? JSON.parse(p.node) : null; } catch { return null; } })(), items: planned.filter(m => m.plan_id === p.id) }));
    const castNames = s.roster.map(e => e.name).filter(Boolean);
    // 关系的最新变化（规划写的、记账记下的）：简报的关系表那一段和【主角团】里团里两两的关系都用
    const current = relationsNow(store, chatKey, rel, s.visible, castNames);
    // 主角团（章程 K1）：开局单写的，没写用上一份规划里的＋玩家；每人的底子、上一份写的打算、团里两两眼下的关系
    const players = [s.userName, ...(store.playerNames?.(s.chat.story_id) ?? [])].filter(Boolean);
    const isPlayer = n => players.some(p => sameName(n, p, castNames));
    // 名字按关系表的别名归一（试玩 10/12：开局单写简称、聊天里用全名，简报列成两个人；开局单写全名、名册里是短名，底子对不上）：
    // 是玩家的别名就并到玩家名下，名册里有同一个人就用名册里的写法，去重
    const who = n => personOf(rel, n, castNames);
    const crewNames = [...new Set(crewOf(setup, lastNode, s.userName).map(n => {
        const p = who(n);
        if (isPlayer(n) || (p && players.some(u => who(u) === p))) return s.userName ?? n;
        return castNames.find(c => sameName(c, n, castNames) || (p && who(c) === p)) ?? n;
    }))];
    const cast = s.roster.filter(e => e.role !== '不用').map(e => ({ ...e, level: s.closenessOf(e.name, e).level }));
    // 还没下文的口子（章程 K1）：收期按节奏表（K2 加的 close；没有就按档），续过几次看 meta matter_cont:<窗口>:<编号>
    const pace = paceOf(setup, s.ts);
    const close = Number.isFinite(pace.close) ? pace.close : CLOSE_UNITS[pace.name] ?? CLOSE_UNITS.中;
    const base = {
        secretLeaks: secretLeakLines(activeLeaks(store, records, chatKey)),
        ...(replaced.size ? { reroll: { titles: rerollTitles, changes: setupChanges.slice(0, 40), more: Math.max(0, setupChanges.length - 40) } } : {}),
        ts: s.ts,
        rhythm: rhythmFor(store, chatKey, last?.id),
        // 玩家的人设（用户 10/12，M 数据约定第 1 条）：扩展交来的，存在 meta persona:<窗口>；简报里【玩家的角色】那一块，没有就不出
        persona: (() => { try { const p = JSON.parse(store.getMeta?.(`persona:${chatKey}`) ?? 'null'); return p && String(p.text ?? '').trim() ? { name: String(p.name ?? '').trim() || s.userName || '', text: String(p.text) } : null; } catch { return null; } })(),
        // romance：上一份写的感情线（以前只存着，下一份看不到，每份从头排；试玩 10/13）
        crew: crewNames.length ? { names: crewNames, player: crewNames.filter(isPlayer), last: Array.isArray(lastNode?.主角团) ? lastNode.主角团 : [], romance: typeof lastNode?.感情线 === 'string' ? lastNode.感情线 : '', cast,
            ties: crewTies(rel, crewNames, { current, roster: castNames, skip: isPlayer }) } : null,
        minds: [...(lastNode?.主角团 ?? []), ...(lastNode?.要紧的人 ?? [])].filter(p => p?.心思 && !isPlayer(p.谁) && !(who(p.谁) && players.some(u => who(u) === who(p.谁)))).map(p => ({ 谁: p.谁, 心思: p.心思 })),
        gaps: openGaps(menu, s.visible, { dayOf: s.dayOf, today: s.today, close, cont: id => Number(store.getMeta?.(`matter_cont:${chatKey}:${id}`) ?? 0) || 0 }),
        mix: categoryCounts(recentPlans, setup?.类别),
        dragging: draggingLines(recentPlans, { names: castNames }),
        overdue: overdueAhead(recentPlans, { names: castNames }),
        reason: reason ?? store.lastPlan(chatKey)?.reason ?? null, verdict, thread,
        lastNode,
        pastNodes: replaced.size ? ready.filter(p => !replaced.has(p.id)).slice(0, -1).filter(p => p.node).map(p => ({ id: p.id, 目标: JSON.parse(p.node).目标, verdict: verdictOf(store, chatKey, p.id) })).filter(n => n.目标) : pastNodesOf(store, chatKey),
        story: digest.days, storyCut: digest.cut,
        dice: rollDice(`${chatKey}:${s.lastPos}:${(store.readyPlans?.(chatKey) ?? []).length}`, 3),   // 同一处再要一份（比如弄断后接着要）也换一组骰子
        motifs: motifLedger((store.menuOf?.(chatKey) ?? []).filter(m => !unseen(m) && (m.plan_id === last?.id || m.status !== 'waiting'))),
        // 第几天和消息上的日期标签同一套数法（开局单的"开场是第几天"、日期）；时段单给
        day: s.today, ...(() => { try { const tl = timelineFor(store, records, chatKey, s.messages); return { start: tl.start, part: tl.part ?? null, clock: clockNow(tl.start, { today: tl.today, part: tl.part, seed: tl.seed }) }; } catch { return { clock: null }; } })(),
        prep: prep.filter(Boolean), userName: s.userName, present: s.present, notes: notes.filter(n => n.kind !== '聊' || n.used_in_plan == null),
        cast,
        // 全部还开着的想法（D-100：以前只给最近 20 条，长局会把最老的挤掉，和"几百轮后也能兑现"相悖）；待办只看最近 120 条内的。
        open: s.visible.filter(r => (r.type === '想法' && s.openIdeaIds.has(r.id)) || (r.todo && !r.closed_by && s.lastPos - r.pos <= 120)).map(r => ({ ...r, when: s.when(r) })),
        // 没着落的改变（用户 10/2）：在场的人弄出来的、还没人收拾的——几天没人碰就该长成后果
        loose: looseEnds(s.visible, { present: s.present, lastPos: s.lastPos, window: 300 }).map(l => ({ ...l, when: s.when({ pos: l.pos }) })),
        // 碰上了、还没下文的事（matters.mjs）：规划给它排后续，来由照它
        matters: matterBrief(s.visible, { when: s.when }),
        money: moneyLines(buildLedger(s.visible), { name: '全局', when: s.when, max: 8 }).slice(1),
        absent: s.people().map(p => ({ ...p, level: s.closenessOf(p.person).level, lastSeen: p.lastPos < 0 ? '（还没出场）' : relativeDay(s.today - s.dayOf(p.lastPos), s.ts) })),
        menu, bringNext: last?.bring_next ? JSON.parse(last.bring_next) : [],
        setup,
        intimateProgress: intimateProgressFor(store, records, chatKey, s),
        // 储备线平时只给名字和条件（O-22）；转向对得上、手上的线在用、最近聊到了的给全文
        openReserve: reserveOpen(setup, { thread, lines: [...(lastNode?.线 ?? []).map(l => l.名), ...menu.map(m => m.line)],
            text: [...s.messages.slice(-40).map(m => m.text), ...s.visible.filter(r => r.type === '想法' && s.openIdeaIds.has(r.id)).map(r => r.text)].join(' ') }),
        relations: rel,
        promises: (() => { try { return promiseBrief(store, records, chatKey, s); } catch { return []; } })(),
        // 势力账（Q-8）：各方之间、人的明面／实际归属、约定，全给并写明谁知道实情；外加素材包势力网里沾边的原作底子。
        factions: [...factionBrief(factionLedger(s.visible, { resolve: nameResolver(factionNet), dayOf: s.dayOf }), { net: factionNet, today: s.today, relDay: d => relativeDay(d, s.ts) }),
            ...(sit ? situationBrief(situationNow(sit, { storyId: s.chat.story_id, messages: s.messages, visibleIds: new Set(s.visible.map(r => r.id)), dayOf: s.dayOf, live: moveLiveCtx(store, chatKey, { records: s.visible, principal: s.userName }) }), { today: s.today, relDay: d => relativeDay(d, s.ts), timeScale: s.ts }) : []),
            ...(() => { try { return activeLong(JSON.parse(store.getMeta?.(`long_events:${s.chat.story_id}`) ?? '[]'), s.today, { lastPos: s.messages.at(-1)?.pos ?? null }); } catch { return []; } })()
                .map(e => `持续的事（${relativeDay(s.today - e.起, s.ts)}起，约 ${s.ts.span(e.天数)}；${e.谁会知道.length ? `${e.谁会知道.join('、')}知道` : '所有人都听说了'}）：${e.名}——${e.一句话}；眼下${e.阶段[e.第几阶段]}${e.阶段.length > e.第几阶段 + 1 ? `；之后：${e.阶段.slice(e.第几阶段 + 1).join(' → ')}` : ''}`)],
        currentRelations: rel ? current : null,
        prices: planPriceLines(prices),
        facts: planFactLines(facts),
        impulses: (() => { try { return JSON.parse(store.getMeta?.(`impulses:${chatKey}`) ?? '[]').slice(-6); } catch { return []; } })(),
        away: (store.absences?.(chatKey) ?? []).filter(a => a.story_status === 'ready' && a.from_pos != null && a.from_pos >= (last?.anchor_pos ?? -1)).flatMap(a => awayBrief(a.story, a.days)),
        // 前台最后几条原文（T-23 实测：卡和书都没写多少的局，账本里只有"说"，规划者看不到谁开店、谁是来客，把两个人的身份整个弄反了）。
        scene: s.messages.slice(-SCENE_MESSAGES).map(m => `[${m.name ?? m.speaker}] ${String(m.text).replace(/<#[0-9.]+#>/g, '').replace(/\s+/g, ' ').trim().slice(0, SCENE_CHARS)}`),
    };
    return squeezeBrief(store, chatKey, s, base, { budget, last, lastNode, menu });
}
const SCENE_MESSAGES = 8, SCENE_CHARS = 500;

// 之前的节点（上一个以前的，从早到晚）：每个带编号、目标、结局
export const pastNodesOf = (store, chatKey) => (store.readyPlans?.(chatKey) ?? []).slice(0, -1).filter(p => p.node)
    .map(p => ({ id: p.id, 目标: JSON.parse(p.node).目标, verdict: verdictOf(store, chatKey, p.id) })).filter(n => n.目标);
export const RECENT_NODES = 5;   // 之前的节点压过时，最近几个一行
export const ACTIVE_MESSAGES = 300;   // 名册、关系表压过时：最近多少条消息里露过面、被提到的算活着（条数，不分时间尺度）
// "开局到现在"的大意（main 里便宜那档续写，存 story_sofar:<局>）：{ ids: [盖到的节点编号，从早到晚], text }
export const sofarOf = (store, storyId) => { try { const v = JSON.parse(store.getMeta?.(`story_sofar:${storyId}`) ?? 'null'); return v?.text && Array.isArray(v.ids) ? v : null; } catch { return null; } };

// 规划简报超了预算（章程 H4，用户 10/11）：按"远的先压"收。压的先后、各块配额见 planner.BRIEF_SHARES 那段注释。
// 没超：原样返回（和以前一字不差）。压过、或者压不下去的块超了：meta brief_cut:<窗口> 记一句，面板顶上提示一回（notice:<窗口>）。
function squeezeBrief(store, chatKey, s, base, { budget, last, lastNode, menu }) {
    const full = buildBrief(base);
    const metaKey = `brief_cut:${chatKey}`;
    let prev = null;
    try { prev = JSON.parse(store.getMeta?.(metaKey) ?? 'null'); } catch {}
    if (!(budget > 0) || full.length <= budget) {
        if (prev) store.setMeta?.(metaKey, 'null');
        return full;
    }
    // 活着的人：开局单点了名的（主要、常联系）、在场的、玩家；最近 ACTIVE_MESSAGES 条或上一个节点开始以来露过面、被提到的；上一个节点里排过事、写过关系的
    const since = Math.min(s.lastPos - ACTIVE_MESSAGES, last?.anchor_pos ?? Infinity);
    const msgs = s.messages.filter(m => m.pos > since);
    const speakers = new Set(msgs.map(m => m.name).filter(Boolean));
    const blob = msgs.map(m => String(m.text ?? '')).join('\n');
    const named = new Set(s.roster.filter(e => e.role === '主要' || e.role === '常联系').map(e => e.name));
    const inNode = new Set([...menu.filter(m => last && m.plan_id === last.id).map(m => m.who), ...(lastNode?.关系 ?? []).flatMap(r => [r.谁, r.对谁])]);
    const crew = new Set(base.crew?.names ?? []);   // 主角团（章程 K1）一直算活着
    const alive = name => !!name && (named.has(name) || crew.has(name) || s.present.includes(name) || name === s.userName || inNode.has(name) || speakers.has(name) || (name.length >= 2 && blob.includes(name)));
    const castView = { cast: base.cast.filter(e => alive(e.name)), castQuiet: base.cast.filter(e => !alive(e.name)), relKeep: p => [p.名, ...(p.又名 ?? [])].some(alive) };
    // 这一局到现在：最近 R 格逐条（R 从节奏表取，格＝这一局的单位），再往前到上一个节点开始按场次
    const recentMax = paceOf(store.setupOf?.(s.chat.story_id)?.data ?? null, s.ts).recent;
    const nodeStart = last?.anchor_pos != null ? s.dayOf(last.anchor_pos) : -Infinity;
    const episodes = store.episodesOf?.(chatKey) ?? [];
    const storyView = R => { const L = storyLayers(s.visible, { dayOf: s.dayOf, today: s.today, when: d => relativeDay(d, s.ts), recent: R, nodeStart, episodes }); return { story: L.days, storyCut: 0, lasting: L.lasting, storyLayer: layerNote(R, s.ts, { node: nodeStart > -Infinity }) }; };
    // 之前的节点：最近 RECENT_NODES 个一行，更早的用写好的大意（盖到的节点对得上才用；没写成就照旧一行一个）
    const earlier = base.pastNodes.slice(0, -RECENT_NODES);
    const sofar = sofarOf(store, s.chat.story_id);
    const sofarOk = !!sofar && earlier.length > 0 && sofar.ids.length <= earlier.length && sofar.ids.every((id, i) => earlier[i].id === id);
    const pastView = sofarOk ? { pastSofar: { text: sofar.text, count: sofar.ids.length }, pastNodes: base.pastNodes.slice(sofar.ids.length) } : {};
    const half = p => { const t = String(p); const cut = t.lastIndexOf('\n', Math.ceil(t.length / 2)); return `${t.slice(0, cut > 0 ? cut : Math.ceil(t.length / 2))}\n（太长，后半截略去了）`; };
    const lv = { cast: 0, story: 0, past: 0, prep: 0 };
    const render = () => buildBrief({ ...base, ...(lv.cast ? castView : {}), ...(lv.story ? storyView(recentMax - lv.story + 1) : {}), ...(lv.past ? pastView : {}), ...(lv.prep ? { prep: base.prep.map(half) } : {}) });
    const steps = [
        { blocks: ['名册', '关系表'], go: () => !lv.cast && (lv.cast = 1) },
        ...Array.from({ length: recentMax }, (_, i) => ({ blocks: ['这一局到现在'], go: () => lv.story === i && (lv.story = i + 1) })),
        { blocks: ['之前的节点'], go: () => !lv.past && sofarOk && (lv.past = 1) },
        { blocks: ['备料'], go: () => !lv.prep && base.prep.length > 0 && (lv.prep = 1) },
    ];
    let text = full;
    // 头一轮只压超了自己配额的块；还超就第二轮不看配额接着压
    for (const round of [1, 2]) for (const st of steps) {
        if (text.length <= budget) break;
        if (round === 1) { const sz = briefBlocks(text); if (st.blocks.reduce((n, b) => n + sz[b], 0) <= st.blocks.reduce((n, b) => n + BRIEF_SHARES[b] * budget, 0)) continue; }
        if (st.go()) text = render();
    }
    const sizes = briefBlocks(text);
    const over = UNSQUEEZED.filter(b => sizes[b] > BRIEF_SHARES[b] * budget);
    const done = [
        lv.cast && '名册、关系表只给最近露过面的人，其余只列名字',
        lv.story && `这一局到现在只有最近 ${recentMax - lv.story + 1} ${s.ts.word}逐条，再往前按场次经过`,
        lv.past && `之前的节点只有最近 ${RECENT_NODES} 个一行，更早的并成一段大意`,
        lv.prep && '备料截了一半',
    ].filter(Boolean);
    const info = { at: s.lastPos, before: full.length, after: text.length, budget, steps: done, over,
        text: `规划简报 ${full.length} 字，超了预算 ${budget}：${done.length ? `${done.join('；')}，压到 ${text.length} 字` : '能压的都没压下去'}${over.length ? `；${over.join('、')}超了配额，不压，照给` : ''}` };
    store.setMeta?.(metaKey, JSON.stringify(info));
    // 压法变了才提示一回（同一局每次重攒都一样就不再弹）
    if (JSON.stringify([prev?.steps, prev?.over]) !== JSON.stringify([done, over]))
        store.setMeta?.(`notice:${chatKey}`, JSON.stringify({ id: `brief-cut:${s.lastPos}:${done.length}`, text: done.length ? '规划简报按远近压过了' : '规划简报超了预算（设定、上一个节点、开着的事不压，照给了）' }));
    return text;
}

// 节点检查那一问的材料：规划之后记下的事（至多 60 条，太长的截断）。
export function nodeCheckLines(store, records, chatKey, planId) {
    const s = storyContext(store, records, chatKey);
    const plan = store.planById(planId);
    const since = plan?.anchor_pos ?? -1;
    return s.visible.filter(r => r.pos > since && r.type !== '时间').slice(-60).map(r => `· ${s.when(r)} ${r.holder_name ?? r.holder}：${String(r.text).slice(0, 200)}`);
}
// 节点检查顺带看的（章程 K1，替换 F2 的"接了的有没有后续"）：这一份规划"口子"里答了续的那几件——原来那件 → 接着它的那件（这一份里同题的那件到了哪一步）；
// 和眼下还排着的事。不再挑"接了却没后续的"（每件事只往下长、收不住）
const STEP_WORDS = { waiting: '还排着', pocket: '在口袋里', shown: '拿出来了', used: '用上了', sunk: '沉底了', sunk_told: '沉底了', void: '撤了', expired: '过期了' };
export function nodeCheckTaken(store, records, chatKey, planId) {
    const plan = store.planById(planId);
    let node = null;
    try { node = plan?.node ? JSON.parse(plan.node) : null; } catch {}
    const menu = store.menuOf(chatKey);
    const bare = t => String(t ?? '').trim();
    const continued = (Array.isArray(node?.口子) ? node.口子 : []).filter(g => g?.处理 === '续' && bare(g.题)).slice(0, 12).map(g => {
        const next = bare(g.续成) ? menu.find(m => m.plan_id === planId && bare(m.title) === bare(g.续成)) ?? null : null;
        return `· 「${bare(g.题)}」→「${bare(g.续成) || '（没写接着它的那件）'}」${next ? `：${next.who}，${STEP_WORDS[next.status] ?? next.status}；${String(next.surface ?? '').slice(0, 80)}` : ''}`;
    });
    const queued = menu.filter(m => ['waiting', 'pocket'].includes(m.status)).slice(0, 20).map(m => `· ${m.line ? `〔${m.line}〕` : ''}${m.who}「${m.title}」：${String(m.surface ?? '').slice(0, 80)}`);
    return { continued, queued };
}

// 离开期间推演（away.mjs）要的材料：这一局此刻的账，外加最后那一幕的原文、程序按亲疏算的"谁找过用户"。
// 规划前备料的材料（prep.mjs）：整张卡（主要、常联系、新面孔在前）、关系表、开局单、账本（新的在前）、最近 40 条原文、素材资料、兴头。
export function prepMaterial(store, records, chatKey, { library = [] } = {}) {
    const s = storyContext(store, records, chatKey);
    const order = { 主要: 0, 常联系: 1, 新面孔: 2, 可能登场: 3, 路过: 4 };
    const seen = new Set();
    const cards = s.roster.filter(e => e.role !== '不用' && !seen.has(e.name) && seen.add(e.name)).sort((a, b) => (order[a.role] ?? 9) - (order[b.role] ?? 9))
        .map(e => {
            const card = store.profileOf?.(e.avatar)?.card_text ?? '';
            const text = [card.slice(0, 6000), e.hook && `是谁：${e.hook}`, e.interests && `兴趣和习惯：\n${e.interests}`].filter(Boolean).join('\n');
            return text ? { name: e.name, role: e.role, text } : null;
        }).filter(Boolean);
    const rel = store.relationsOf?.(s.chat.story_id);
    const setup = store.setupOf?.(s.chat.story_id)?.data;
    let impulses = [];
    try { impulses = JSON.parse(store.getMeta?.(`impulses:${chatKey}`) ?? '[]').slice(-6); } catch {}
    return {
        userName: s.userName ?? '玩家', cards, library, impulses,
        relations: rel ? relationsText(normalizeRelations(rel)) : '',
        setup: setup ? setupText(setup) : '',
        story: [...s.visible].reverse().map(r => `· ${s.when(r)} ${r.holder_name ?? r.holder}〔${r.type}〕：${r.text}`),
        scene: s.messages.slice(-40).map(m => `[${m.name ?? m.speaker}] ${String(m.text).replace(/<#[0-9.]+#>/g, '').trim().slice(0, 800)}`),
    };
}

// 兴头那一问的材料（scene.mjs）：最后几条原文、在场的人各自的底子（兴趣和习惯、往事、嘴上、亲近）和跟玩家眼下的关系、
// 不在场的熟人、排着的事、最近冒过的兴头、这一局讲过的往事、玩家这阵是不是只跟着。
export const IMPULSE_LIFE = 6;
const goalOf = m => { try { return (typeof m?.trig === 'string' ? JSON.parse(m.trig) : m?.trig)?.goal || ''; } catch { return ''; } };
export function sceneMaterial(store, records, chatKey) {
    const s = storyContext(store, records, chatKey);
    const seen = new Set();
    const uniq = list => list.filter(e => !seen.has(e.name) && seen.add(e.name));
    const rosterNames = s.roster.map(e => e.name);
    const rel = (r => (r ? normalizeRelations(r) : null))(store.relationsOf?.(s.chat.story_id));
    const now = rel ? relationsNow(store, chatKey, rel, s.visible, rosterNames) : new Map();
    const same = (a, b) => a === b || sameName(a, b, rosterNames) || (!!rel && !!personOf(rel, a, rosterNames) && personOf(rel, a, rosterNames) === personOf(rel, b, rosterNames));
    // 他和玩家眼下的关系：后来的变化（记账、规划）优先，没有就用关系表里开场时的
    const withUser = name => {
        if (!s.userName) return null;
        for (const [k, v] of now) { const [a, b] = k.split('\u0001'); if ((same(a, name) && same(b, s.userName)) || (same(b, name) && same(a, s.userName))) return v.text; }
        return (rel ? personOf(rel, name, rosterNames) : null)?.关系?.find(r => same(r.对, s.userName))?.是 ?? null;
    };
    const present = uniq(s.present.filter(n => n && n !== s.userName).map(n => ({ name: n, entry: roleOf(s.roster, n) })))
        .map(({ name, entry }) => ({ name, level: s.closenessOf(name, entry).level, parts: profileParts(entry?.interests), withUser: withUser(name) }));
    const offstage = uniq(s.roster.filter(e => ['常联系', '新面孔', '可能登场'].includes(e.role) && !s.present.includes(e.name) && (e.interests || e.hook)))
        .map(e => ({ ...e, c: s.closenessOf(e.name, e) })).sort((a, b) => (b.c.score ?? 0) - (a.c.score ?? 0)).slice(0, 6)
        .map(({ c, ...e }) => ({ name: e.name, role: e.role, level: c.level, parts: profileParts(e.interests), hook: e.hook }));
    let recent = [], told = [];
    try { recent = JSON.parse(store.getMeta?.(`impulses:${chatKey}`) ?? '[]'); } catch {}
    // 删回去以后，被删那段里冒过的兴头不算"刚冒过"（不然位置比眼下还靠后，隔多久都算没隔够，就地的一个也出不来）
    recent = recent.filter(x => stillThere(x.at, s.messages, (a, b) => !!store.sameMessage?.(a, b)));
    try { told = JSON.parse(store.getMeta?.(`told:${s.chat.story_id}`) ?? '[]'); } catch {}
    // 讲过的往事挂在写它的那条消息上：那条还在本窗口才算讲过（分叉前共有的 fp 相同所以继承，分叉后各自不同所以不串，删回去也撤得掉）。旧数据只有 at 没有 fp，stillThere 按位置算。
    told = told.filter(t => t && stillThere({ pos: t.at, fp: t.fp }, s.messages, (a, b) => !!store.sameMessage?.(a, b)));
    return {
        userName: s.userName ?? '玩家', today: s.today, setup: staleBackstory(store.setupOf?.(s.chat.story_id)?.data ?? null, s.visible, s.userName), present, offstage, recent, told,
        passive: passiveUser(s.messages), storyId: s.chat.story_id,
        // 手边的事：在场的人留下的、还没着落的改变（弄坏、弄乱、借了），给"顺手"当候选（用户 10/2）
        loose: looseEnds(s.visible, { present: s.present, lastPos: s.messages.at(-1)?.pos ?? 0, same }),
        // 写了前提（触发里的 goal）的不给提前：它写的"谁知道什么"是按前提发生过写的（试玩 10/14：一件写着"饭桌上听来的"的事，
        // 饭局没发生就被提前，那人就知道了饭桌上才会听到的事）
        menu: (store.menuOf?.(chatKey) ?? []).filter(m => (m.status === 'waiting' || m.status === 'pocket') && !goalOf(m)).slice(0, 12),
        lastScene: s.messages.slice(-SCENE_MESSAGES).map(m => `[${m.name ?? m.speaker}] ${String(m.text).replace(/<#[0-9.]+#>/g, '').replace(/\s+/g, ' ').trim().slice(0, SCENE_CHARS)}`),
        messages: s.messages,
    };
}

export function awayMaterial(store, records, chatKey, absence) {
    const s = storyContext(store, records, chatKey);
    const rel = (r => (r ? normalizeRelations(r) : null))(store.relationsOf?.(s.chat.story_id));
    const rosterNames = s.roster.map(e => e.name);
    const near = s.roster.filter(e => e.role === '主要' || e.role === '常联系').map(e => e.name);
    const who = [...new Set([...s.present, ...near])];
    const rows = rel ? rel.人.filter(p => who.some(n => personOf(rel, n, rosterNames) === p)).map(p =>
        `· ${p.名}：${[p.现在, p.关系.length && `关系（开场时）：${p.关系.map(r => `${r.对}——${r.是}`).join('；')}`].filter(Boolean).join('｜')}`) : [];
    const now = rel ? relationsNow(store, chatKey, rel, s.visible, rosterNames) : new Map();
    const digest = storyDigest(s.visible, { dayOf: s.dayOf, today: s.today, when: d => relativeDay(d, s.ts), max: 140 }).days
        .flatMap(d => [`${s.ts.nth(d.day + 1)}（${d.when}）`, ...d.items.map(r => `· ${r.holder_name ?? r.holder}：${r.text}`)]);
    return {
        userName: s.userName ?? '玩家', days: absence.days, hours: absence.hours, present: s.present,
        cast: s.roster.filter(e => e.role !== '不用').map(e => ({ ...e, c: s.closenessOf(e.name, e) })).sort((x, y) => (y.c.score ?? 0) - (x.c.score ?? 0)).map(({ c, ...e }) => ({ ...e, level: c.level })),
        relations: [...rows, ...(now.size ? ['关系的最新变化：', ...[...now].map(([k, v]) => `· ${k.split('\u0001').join(' 与 ')}：${v.text}`)] : [])],
        digest, lastScene: s.messages.slice(-6).map(m => `[${m.name ?? m.speaker}] ${String(m.text).replace(/<#[0-9.]+#>/g, '').slice(0, 700)}`),
        open: s.visible.filter(r => r.type === '想法' && s.openIdeaIds.has(r.id)).map(r => `· ${r.holder_name ?? r.holder}：${r.text}`),
        attempts: attemptsDuring(absence, s.people(), { closenessOf: s.closenessOf }),
        setup: staleBackstory(store.setupOf?.(s.chat.story_id)?.data ?? null, s.visible, s.userName),
        names: rel ? rel.人.map(p => p.名) : [],
    };
}

// 回来时谁先开口：在场的成员里和用户最近的那个（主要角色优先）。
export function firstToSpeak(store, records, chatKey) {
    const s = storyContext(store, records, chatKey);
    const members = (s.chat.members ? JSON.parse(s.chat.members) : []).filter(m => !m.disabled && m.name);
    const scored = members.map(m => ({ m, main: roleOf(s.roster, m.name)?.role === '主要' ? 1 : 0, c: s.closenessOf(m.name).score ?? 0 }))
        .sort((a, b) => b.main - a.main || b.c - a.c);
    return scored[0] ? { avatar: scored[0].m.avatar, name: scored[0].m.name } : null;
}

// 名册上每个人此刻和用户的亲疏（面板排序用；每次现算，日常 RP 里跟着变）。
export function closenessTable(store, records, chatKey) {
    const chat = store.requireChat(chatKey);
    const visible = records.visible(chatKey);
    const messages = store.currentMessages(chatKey);
    const lastPos = messages.at(-1)?.pos ?? 0;
    const dayOf = dayIndex([...visible.filter(r => r.type === '时间'), ...timeMarksFor(store, records, chatKey, messages)], lastPos, scaleFor(store, chatKey));
    const userName = [...messages].reverse().find(m => m.is_user)?.name ?? null;
    const openIdeaIds = new Set(records.openIdeas(chatKey).map(r => r.id));
    return new Map(store.getCast(chat.story_id).map(e => [e.avatar, closeness({ name: e.name, userName, entry: e, records: visible, dayOf, lastPos, openIdeaIds })]));
}

// 替在场的其他角色先组装（不等结果、不钉住；轮到他们时 composeSlot 会拿到同一份）。
// 打字时预跑（D-100：前台速度）：用户停下来一会儿，扩展把草稿递过来，先替在场的每个人配词、组装；发出去的那句和草稿一样，
// 轮到谁开口时直接用上。一轮（最后一条消息不变）至多预跑两份草稿，免得边打边改花冤枉钱。
const drafts = new Map();
// only（调度式预跑，方案 自动进离场与调度 第四节）：后台按调度认出接下来谁开口，只替他们预跑；不给（自动进离场关着）照旧替在场的人都预跑
export function prefetchDraft(store, records, deps, { chatKey, draft, recent = [], present = [], only = null }) {
    const text = String(draft ?? '').trim();
    if (!store.requireChat(chatKey).enabled) return { ok: true, skipped: 'off' };
    // 只承接的一句（"嗯""好"）也预跑：组装主要靠上文，一轮至多两份草稿兜着花费。
    if (!deps.assembler || !records || !text) return { ok: true, skipped: 'empty' };
    const base = store.currentMessages(chatKey).at(-1)?.fp ?? 'start';
    const seen = drafts.get(chatKey);
    const round = seen?.base === base ? seen : { base, count: 0, last: null };
    if (round.last === text) return { ok: true, skipped: 'same' };
    if (round.count >= 2) return { ok: true, skipped: 'limit' };
    drafts.set(chatKey, { base, count: round.count + 1, last: text });
    prefetchOthers(store, records, deps, { chatKey, speaker: null, recent, recentUser: text, present, only }).catch(() => {});
    return { ok: true, started: true, ...(Array.isArray(only) ? { only: only.length } : {}) };
}

// 调度定了接下来谁说（main.autoTurn）：就替他预跑这一句（草稿和发出去的不一样时草稿那份用不上，这里补一份）
export function prefetchFor(store, records, deps, { chatKey, recentUser, present = [], only }) {
    if (!deps?.assembler || !records || !recentUser || !Array.isArray(only) || !only.length) return;
    const recent = store.currentMessages(chatKey).filter(m => !m.hidden).slice(-3).map(m => String(m.text ?? ''));
    prefetchOthers(store, records, deps, { chatKey, speaker: null, recent, recentUser, present, only }).catch(() => {});
}

async function prefetchOthers(store, records, { assembler, keyMaker }, { chatKey, speaker, recent, recentUser, present, only = null }) {
    if (!assembler || !records || !recentUser) return;
    const picked = Array.isArray(only) ? new Set(only.filter(Boolean)) : null;
    const others = memberList(store, chatKey).filter(m => !m.disabled && m.avatar !== speaker && !ahead.has(aheadKey(chatKey, m.avatar, recentUser))
        && (!picked || picked.has(m.avatar) || picked.has(m.name)));
    if (!others.length) return;
    const queryKeys = await queryKeysFor(store, keyMaker, { chatKey, recent, recentUser, present });
    for (const m of others) {
        if (ahead.has(aheadKey(chatKey, m.avatar, recentUser))) continue;
        const name = m.name || m.avatar;
        const { material, messageText } = materialFor(store, records, { chatKey, speaker: m.avatar, name, recent, recentUser, present, queryKeys, pool: true });
        if (!material.hits.length || !material.pool.length) continue;
        once(aheadKey(chatKey, m.avatar, recentUser),
            () => assembler({ chatKey, speaker: m.avatar, anchor: 'ahead', name, present, recent, recentUser, material, messageText })).catch(() => {});
    }
}

// 同一格同时被要了两次（比如扩展重复触发）只组装一次。
const inflight = new Map();

export async function buildSlot(store, { chatKey, speaker, speakerName, anchor, recent = [], recentUser = '', present = [], room = null }, records = null, { assembler = null, keyMaker = null, economy = null, contacts = null, absence = null, planner = null, world = null, mood = null, fresh = null, slot = null, vectors = null, pace = null, factions = null, situation = null, drift = null } = {}) {
    const chat = store.requireChat(chatKey);
    if (!chat.enabled) return { text: '', rule: '' };
    // 先折一次（世界往前走的那些写），再组格（只读）；预览（slot-preview）走 composeSlot，不经这里，什么都不写
    await advance(store, records, chatKey, { planner, situation, absence }, { present });
    // 分块放（slot.split）：各块的文字和中段、"玩家最后一句之前"各插在倒数第几条；扩展不认分块时照旧用 text 整格放最后
    const split = slot?.split !== false;
    const depths = { mid: slot?.midDepth ?? 4, recall: slot?.recallDepth ?? -1, now: slot?.nowDepth ?? 4 };
    const shape = (text, parts) => ({ text: text ? wrap(text) : '', rule: !text ? '' : split && parts ? SPLIT_RULE : READING_RULE, ...(text && split && parts ? { parts, depths } : {}) });
    const versionNow = () => {
        const leaks = activeLeaks(store, records, chatKey);
        return intimateSlotVersion(store, chatKey) + (playModeOf(store, chatKey) === 'memory' ? ':memory' : '') + (leaks.length ? ':secrets:' + leaks.map(x => `${x.proof}:${x.事}:${x.谁知道了}`).join('|') : '');
    };
    const version = versionNow();
    const pinned = store.getSlot({ chatKey, speaker, anchor, ver: version });
    if (pinned !== null) {
        const parts = store.getSlotParts?.({ chatKey, speaker, anchor }) ?? null;
        const again = chat.test_slot ? { text: pinned, parts } : refreshPinned(store, records, { chatKey, speaker, speakerName, present, anchor }, pinned, parts, { fresh, pace });
        return { ...shape(again.text, again.parts), pinned: true };
    }
    const key = `${chatKey}\u0001${speaker}\u0001${anchor}\u0001${version}`;
    if (!inflight.has(key)) {
        inflight.set(key, composeSlot(store, records, { chatKey, speaker, speakerName, anchor, recent, recentUser, present, room }, { assembler, keyMaker, economy, contacts, absence, planner, world, mood, fresh, slot, vectors, pace, factions, situation, drift })
            .then(result => {
                if (result.final) store.putSlot({ chatKey, speaker, anchor, text: result.text, ids: [...new Set(result.ids ?? [])], parts: result.parts ?? null, ver: version });
                // 没钉住的（组装超时先给了纯程序那一格）也记下给了什么，标成 given：不当钉住的用（getSlot 认版本），
                // 回头查得到、去复读核对时拿得到"想起的"那块（质量窗 10/5：从 10/4 早上起常常没钉住，后台查不到那几轮给了什么）
                else if (result.text && result.mode !== 'test' && result.mode !== 'none') store.putGiven?.({ chatKey, speaker, anchor, text: result.text, ids: [...new Set(result.ids ?? [])], parts: result.parts ?? null });
                if (result.mode !== 'test' && result.mode !== 'none') store.putCarry?.({ chatKey, speaker, anchor, carry: result.carry ?? [] });   // 余波钉没钉住都记
                return result;
            })
            .finally(() => inflight.delete(key)));
        prefetchOthers(store, records, { assembler, keyMaker }, { chatKey, speaker, recent, recentUser, present }).catch(() => {});
    }
    const { text, mode, contact = null, parts = null } = await inflight.get(key);
    // 正在等组装时喊停：旧版本不返回给前台，重新取暂停后的那一格。
    if (versionNow() !== version) return buildSlot(store, { chatKey, speaker, speakerName, anchor, recent, recentUser, present, room }, records, { assembler, keyMaker, economy, contacts, absence, planner, world, mood, fresh, slot, vectors, pace, factions, situation, drift });
    return { ...shape(text, parts), pinned: false, mode, contact };
}
