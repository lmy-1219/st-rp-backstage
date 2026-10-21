// 后台自己的配置：<数据目录>/config.json（不进仓，钥匙只放这里，不放 ST 里）。
// {
//   "extractor": {
//     "baseUrl": "https://…/v1",            OpenAI 兼容接口
//     "apiKey": "…",                        用户自己填
//     "model": "…",
//     "priceInPerM": 5, "priceOutPerM": 25, 每百万 token 的价格（美元），用来估算和记账
//     "dailyBudgetUsd": 3,                  当天估算花费超过就停
//     "maxOutputTokens": 16000,
//     "temperature": 0.2,                   可选；新一代模型不接受，别填
//     "extraBody": { … },                   可选；原样并进请求体
//     "provider": "api",                    api＝调模型；window＝一律写成外援包交给 AI 窗口（不走中转）
//     "fallback": "window",                 API 没响应时交给窗口（off＝不交，照旧重试）
//     "auto": true,                          新接入的窗口默认开记账（带着旧聊天接入的只记接入以后的）；分支跟上一个窗口
//     "batch": 1, "batchWaitMin": 0          默认一条一记、不等（写成 4、10＝攒够 4 条，攒不够、最早那条等了 10 分钟也记；已经写过的照旧生效）
//   },
//   "assembler": {                          发言前的叙事组装（每次角色开口前调一次模型，按次花钱）
//     "enabled": false,                     默认关；打开才调
//     "model": "…",                         不填就用 extractor 的；baseUrl、apiKey 同理
//     "via": "advisor",                     组装模型借那一格的 baseUrl、apiKey（钥匙只开了一家模型时）；配检索词、去复读仍用这一格的
//     "priceInPerM": 5, "priceOutPerM": 25, 不填就用 extractor 的
//     "maxOutputTokens": 4000                会先"想"的模型想的字也算在上限里；写到上限会自动放大一倍重来（core/model.mjs）。
//                                           所有调用都是连着一分半没数据才算卡住，timeoutMs 只防挂死（至少半小时）
//     "budgetMs": 6000                      这一格最多等配检索词＋组装多久，到点先给纯程序那一格（0＝不限）
//     "keysModel": "…", "keysPriceInPerM": 1, "keysPriceOutPerM": 5   先给用户那句话配检索词用的模型（可用快而便宜的）
//   },                                      花费和抽取合计，受同一个 dailyBudgetUsd 管
//   "packs": { "dir": "素材包" },           素材包目录；每一局用哪个包在面板上选（D-104）。包里：物价.json、年表/时事种子.csv、年表/纪年锚点.json、专名对照表.csv，都可有可无
//   （旧的 economy.priceTable、world.seeds／anchors、advisor.library／nameTable 是全局的，每一局都拿同一个包，换题材会带出别的题材——不再用）
//   "world": { "seeds": "素材包/…/时事种子.csv", "anchors": "素材包/…/纪年锚点.json" },   seeds＝世界的底色（每个剧情日至多一条，掷骰、用过不再用）；anchors＝纪年检查（参谋备忘、规划菜单里年份对不上年表就拦）
//   "contacts": { "enabled": true, "minGap": 16 },       不在场的人来联系：开关、两次之间至少隔几条消息
//   "absence": { "mode": "real", "minHours": 24, "maxDays": 30, "model": "…" },  用户离开：real＝剧情里按现实一比一过（只对主要角色），pause＝世界等你；隔多久算离开；model＝离开期间推演用的模型（不填用记账那档）
//   "fresh": { "enabled": true, "ways": true, "dropEchoes": true, "voice": true, "model": "…" },  去复读（收口计划 ③：默认开，没钥匙时原样放过）（core/fresh.mjs）：每条回复生成完，把和他前几条重样的句子换成新的；
//                                          ways＝顺手点出他一再用的路数，下一次开口前提前说一声（实测这一半最管用）；
//                                          不填 model 用叙事组装那档的检索词模型（快：实测 4～10 秒，Sonnet 要 8～40 秒、中转慢时超时）
//   "scene": { "enabled": true, "gap": 10, "personGap": 30 },  兴头：角色回完一条看一眼场面，空当里让人冒个念头、排着的轻松事提前、熟人来邀、街上冒件事（用"兴头"那一环节，默认跟着参谋）
//   "slot": { "maxChars": 1600 },          那一格的总长度：超了按次序让位（底色先让，再是别人的口袋，再是他自己牵头的；眼下正在说的、玩家伸了手的不让）
//   "mood": { "carry": true, "cue": false },  情绪递进（core/mood.mjs）：carry＝只给过一次的材料在他之后几次开口留余波；cue＝那一格末尾给前台一句"心情从上一次接着来"
//   "advisor": {                            参谋：规划者碰到原作／世界层面的问题时问它（两步走，开卷）；默认关
//     "enabled": false,
//     "baseUrl": "…", "apiKey": "…",        不填就用 extractor 的（同一把钥匙开不开得了这个模型看中转）
//     "model": "…",                         用户定的型号（D-70）
//     "priceInPerM": 0.5, "priceOutPerM": 3, 不填按这个估
//     "library": "素材包/…",                开卷资料目录（相对仓库根目录或绝对路径）
//     "nameTable": "素材包/…/专名对照表.csv", 专名核对用的对照表
//     "budgetChars": 40000                  每次递过去的资料最多多少字
//   },                                      花费同样记进当天的账，受 dailyBudgetUsd 管
//   "planner": { "provider": "api" },     api（默认）＝调 model（默认记账那档，钥匙同 extractor），没响应或到了每日上限再交给窗口；queue＝一律写成外援包交给 AI 窗口；off＝不规划
//                                          "budgetUsd": 5 规划模型每天最多花多少（到了就交给窗口写），也受 extractor.dailyBudgetUsd 管
//                                          "briefChars": 60000 规划简报至多多少字，超了按远近压（名册关系表 → 这一局到现在 → 之前的节点 → 备料）
//                                          一个主线节点规划一次（N-88）；"judge": false 关掉每个剧情日的节点检查，"judgeModel" 换检查用的便宜模型
//   "strip": ["<#[0-9.]+#>", "\\([A-Za-z][A-Za-z ]{0,24}\\)"]   抽取前从正文里剥掉的标记（TTS 停顿、语气词等）
//   "keys": [{ "name": "…", "baseUrl": "https://…/v1", "apiKey": "…" }]   钥匙簿（D-106）：面板上存的几把钥匙；只放这里，面板只显示末四位
//   "stages": { "<环节>": { "key": "钥匙簿里的名字", "model": "…", "priceInPerM": 3, "priceOutPerM": 15, "effort": "low|medium|high" } }
//                                          各环节（STAGES）换钥匙、换模型；不写的跟着上面各格原来的配置走。effort 只在测过传得过去时才发
//   "effortProbe": { "<地址>|<型号>": true }   思考档参数传不传得过去（面板上测一次记下）：true＝按 OpenAI 的写法 reasoning_effort 传；
//                                              "output_config"＝按 Anthropic 的写法 output_config.effort 传（新一代 Claude 经中转只认这个）；false＝都传不过去
//   "embedProbe": { "<钥匙名>|<钥匙的散列>": true }   这把钥匙能不能调 EMBED_MODEL（后台启动、存钥匙时自己测；"向量"环节没选时自动用能调的第一把）
// }
import crypto from 'node:crypto';
import modelData from './models.json' with { type: 'json' };
import fs from 'node:fs';
import path from 'node:path';

import { KINDS as TASTE_KINDS, TASTE_CHOICES, DEFAULT_TASTE_CHOICES } from './taste.mjs';
export const DEFAULT_STRIP = ['<#[0-9.]+#>', '\\([A-Za-z][A-Za-z ]{0,24}\\)'];
export const CAST_PROMOTION_DEFAULTS = Object.freeze({ promoteRecords: 30, promoteWeight: 2 });

import { CONTENT_TIERS, allowedTiers, DEFAULT_TIER } from './prompt-slots.mjs';
export function loadConfig(home) {
    let raw = {};
    try { raw = JSON.parse(fs.readFileSync(path.join(home, 'config.json'), 'utf8')); } catch {}
    const e = raw.extractor ?? {};
    const extractor = {
        baseUrl: typeof e.baseUrl === 'string' ? e.baseUrl.replace(/\/+$/, '') : null,
        apiKey: typeof e.apiKey === 'string' && e.apiKey ? e.apiKey : null,
        model: typeof e.model === 'string' ? e.model : null,
        priceInPerM: Number(e.priceInPerM ?? 5),
        priceOutPerM: Number(e.priceOutPerM ?? 25),
        dailyBudgetUsd: Number(e.dailyBudgetUsd ?? 3),
        maxOutputTokens: Number(e.maxOutputTokens ?? 16000),
        temperature: typeof e.temperature === 'number' ? e.temperature : null,
        extraBody: e.extraBody && typeof e.extraBody === 'object' ? e.extraBody : null,
        provider: e.provider === 'window' ? 'window' : 'api',
        fallback: e.fallback === 'off' ? 'off' : 'window',
        // D-100：新接入的窗口默认开记账（老窗口只记接入以后的）。
        // 默认不攒（场记章程 #8）：固定的开销是系统提示和"还开着的"，要记的那一两条只占零头；真攒满了每条便宜，可玩家的节奏下
        // 绝大多数是一两条就等满了 10 分钟，等于没攒成、只多了延迟，账也跟不上最新一条。省钱从固定部分省，不从延迟省。
        // 想攒的自己写：攒够 batch 条一起记；攒不够、最早那条又已经等了 batchWaitMin 分钟，也记。config.json 里已经写了的照旧生效。
        auto: e.auto !== false,
        batch: Math.max(1, Number(e.batch ?? 1)),
        batchWaitMin: Number(e.batchWaitMin ?? 0),
    };
    // 各环节换钥匙、换模型（D-106）：记账那档先换，下面各格"不填就用记账的"都跟着它
    const book = keyBook(raw.keys), probes = raw.effortProbe && typeof raw.effortProbe === 'object' ? raw.effortProbe : {}, over = raw.stages && typeof raw.stages === 'object' ? raw.stages : {};
    const stages = { extract: resolveStage(connOf(extractor), over.extract, book, probes) };
    Object.assign(extractor, connOf(stages.extract));
    const a = raw.assembler ?? {};
    const own = typeof a.model === 'string' && a.model;
    const via = typeof a.via === 'string' && raw[a.via] && typeof raw[a.via] === 'object' && raw[a.via].apiKey ? raw[a.via] : null;
    const pl = raw.planner ?? {};
    const plannerModel = typeof pl.model === 'string' && pl.model ? pl.model : (extractor.model || 'claude-fable-5-1');
    const castInt = (v, fallback, max) => Number.isInteger(v) && v >= 1 && v <= max ? v : fallback;
    const config = {
        cast: { promoteRecords: castInt(raw.cast?.promoteRecords, CAST_PROMOTION_DEFAULTS.promoteRecords, 10000), promoteWeight: castInt(raw.cast?.promoteWeight, CAST_PROMOTION_DEFAULTS.promoteWeight, 3) },
        extractor,
        assembler: {
            enabled: a.enabled === true,
            baseUrl: typeof a.baseUrl === 'string' ? a.baseUrl.replace(/\/+$/, '') : extractor.baseUrl,
            apiKey: typeof a.apiKey === 'string' && a.apiKey ? a.apiKey : extractor.apiKey,
            model: own ? a.model : extractor.model,
            // 换了模型却没给价格时不沿用抽取模型的价格（可能差几倍），按贵的估
            priceInPerM: Number(a.priceInPerM ?? (own ? 5 : extractor.priceInPerM)),
            priceOutPerM: Number(a.priceOutPerM ?? (own ? 25 : extractor.priceOutPerM)),
            // 给"眼下这句话"配检索词用的模型：活简单，可以用快而便宜的；不填就用上面的 model
            // 组装模型借另一格的线路和钥匙（"via": "advisor"：中转上一把钥匙只开了一家的模型时）；检索词、去复读、判定照旧用这一格自己的
            // 全新的数据目录里什么地址都没有：空着，别对空值调 replace（杂务窗 9/29 搭试玩副本时一启动就崩）
            modelBaseUrl: typeof (via?.baseUrl ?? a.baseUrl ?? extractor.baseUrl) === 'string' ? (via?.baseUrl ?? a.baseUrl ?? extractor.baseUrl).replace(/\/+$/, '') : null,
            modelApiKey: via?.apiKey || (typeof a.apiKey === 'string' && a.apiKey ? a.apiKey : extractor.apiKey),
            keysModel: typeof a.keysModel === 'string' && a.keysModel ? a.keysModel : (own ? a.model : extractor.model),
            keysPriceInPerM: Number(a.keysPriceInPerM ?? a.priceInPerM ?? (own ? 5 : extractor.priceInPerM)),
            keysPriceOutPerM: Number(a.keysPriceOutPerM ?? a.priceOutPerM ?? (own ? 25 : extractor.priceOutPerM)),
            // 会先"想"的模型（Gemini 3.x）想的字也算在上限里：1500 时答案写到一半就被截断（质量窗 9/28 真链路踩到）。按实际用量计费，放宽不多花
            maxOutputTokens: Number(a.maxOutputTokens ?? 4000),
            timeoutMs: Number(a.timeoutMs ?? 40000),
            // 这一格最多等配检索词＋组装多久（D-100：前台速度）；到点先给纯程序那一格，组装好的留给左滑。0＝不限
            budgetMs: Number(a.budgetMs ?? 6000),
            temperature: typeof a.temperature === 'number' ? a.temperature : null,
            extraBody: a.extraBody && typeof a.extraBody === 'object' ? a.extraBody : null,
        },
        world: { seeds: typeof raw.world?.seeds === 'string' ? raw.world.seeds : null, anchors: typeof raw.world?.anchors === 'string' ? raw.world.anchors : null },
        economy: { priceTable: typeof raw.economy?.priceTable === 'string' ? raw.economy.priceTable : null },
        contacts: { enabled: raw.contacts?.enabled !== false, minGap: Number(raw.contacts?.minGap ?? 16) },
        advisor: advisorOf(raw.advisor ?? {}, extractor),
        planner: {
            // 默认调规划模型（D-100：装进用户的 ST 以后没人开窗代写）；调不通或到了每日上限再交给窗口。
            provider: ['queue', 'api', 'off'].includes(pl.provider) ? pl.provider : 'api',
            // 默认用记账那档（D-101，9/27 实测：Fable 带着长简报要先闷头想五分钟以上、一个字不发，中转把不说话的连接掐了，
            // 又不接受"少想一点"的参数；Opus 4.6 一开口就往外写，一份规划约 0.6 美元）。窗口代写的规划不受影响。
            model: plannerModel,
            priceInPerM: Number(pl.priceInPerM ?? (plannerModel === extractor.model ? extractor.priceInPerM : 15)),   // 没给价就按贵的估
            priceOutPerM: Number(pl.priceOutPerM ?? (plannerModel === extractor.model ? extractor.priceOutPerM : 75)),
            budgetUsd: Number(pl.budgetUsd ?? 5),   // 规划模型每天最多花多少（D-100：成本可控；一个节点约一两美元）
            // 规划简报至多多少字（章程 H4）：超了按远近压——先名册关系表、再这一局到现在、再之前的节点、再备料；没超一个字不动
            briefChars: Number(pl.briefChars ?? 60000),
            // 节点检查：每个剧情日用便宜模型看一眼这个节点算成／落空没有（钥匙、地址同叙事组装那一格）；不填型号就用组装那个
            judge: pl.judge !== false,
            // 转向检查先程序初筛（10/16）：玩家随口的"说"、没闹大字眼的"做"不叫模型；关了每批新记录都问
            turnScreen: pl.turnScreen !== false,
            judgeModel: typeof pl.judgeModel === 'string' && pl.judgeModel ? pl.judgeModel : (own ? a.model : extractor.model),
            judgePriceInPerM: Number(pl.judgePriceInPerM ?? a.priceInPerM ?? (own ? 5 : extractor.priceInPerM)),
            judgePriceOutPerM: Number(pl.judgePriceOutPerM ?? a.priceOutPerM ?? (own ? 25 : extractor.priceOutPerM)),
            // 没单独给型号时跟组装模型走同一条线路（组装借了别的格的钥匙时，这里也得借；质量窗 9/28：组装换成 Gemini 后，节点检查拿着只开了 Claude 的钥匙去调 Gemini，一直 404）
            judgeVia: !(typeof pl.judgeModel === 'string' && pl.judgeModel) && !!own,
        },
        absence: { mode: raw.absence?.mode === 'pause' ? 'pause' : 'real', minHours: Number(raw.absence?.minHours ?? 24), maxDays: Number(raw.absence?.maxDays ?? 30),
            model: typeof raw.absence?.model === 'string' && raw.absence.model ? raw.absence.model : null },   // 离开期间推演用的模型（不填：用记账那档；没有再用叙事组装那档）
        mood: { carry: raw.mood?.carry !== false, cue: raw.mood?.cue === true },
        // 兴头（D-109，scene.mjs）：角色回完一条看一眼场面；gap＝上一个兴头之后至少隔几条，personGap＝同一个人出门那类至少隔几条，
        // inPlaceGap＝同一个人就地那类（冒一句、问你、斗嘴、顺手、亲近，D-112）至少隔几条，closeGap＝同一对人亲近至少隔几条
        // 此刻的样子（core/state.mjs）：穿着、位置、天气这类当前状态，聊天里写到过就给
        state: { enabled: raw.state?.enabled !== false },
        // 看一眼（core/glance.mjs，用户 10/16）：此刻的样子和兴头两眼都要看时并成一次调用；关了各调各的
        glance: { enabled: raw.glance?.enabled !== false },
        // 镜头外的人（core/offstage.mjs，用户 10/8）：别处交代了他的事他自己知道、送到他那儿的他收到了（纯程序）；
        // 在场的人隔着消息电话问不在场的人，后台替那人回一句（便宜模型，走兴头那一档）——ask 关了就不回
        offstage: { enabled: raw.offstage?.enabled !== false, ask: raw.offstage?.ask !== false },
        episodes: { enabled: raw.episodes?.enabled !== false },   // 场次摘要（N-284）
        // 世界按时间尺度变（drift.mjs，N-93）：物价按周小幅波动；持续几周、分阶段的事
        drift: { prices: raw.drift?.prices !== false, long: raw.drift?.long !== false },
        // 走 Anthropic 原生接口时要思考摘要当心跳（D-136）：想久了中转不掐；摘要读到就丢
        thinking: { heartbeat: raw.thinking?.heartbeat !== false },
        scene: { enabled: raw.scene?.enabled !== false, gap: Number(raw.scene?.gap ?? 6), personGap: Number(raw.scene?.personGap ?? 30),
            inPlaceGap: Number(raw.scene?.inPlaceGap ?? 8), closeGap: Number(raw.scene?.closeGap ?? 40) },
        // 那一格的总长度（超了按次序让位，见 slot.fitSlot；9/27 审计）
        // split＝分块放（背景在角色定义之前，底子、想起的在聊天记录之前，口袋、这一轮插在最近四条之前；9/29 体检、10/2、10/5 用户）；false＝整格放最后（原来的样子）
        // midDepth／nowDepth＝口袋、这一轮各插在倒数第几条消息之前（10/2 用户：都放 4，最后四条消息连着给前台，别拆开）；
        // recallDepth＝想起的：负数（默认）＝放在聊天记录之前（10/5 用户：记忆插在聊天记录之前）；写了 0 以上才插进聊天
        slot: { maxChars: Number(raw.slot?.maxChars ?? 1600), split: raw.slot?.split !== false, midDepth: Number(raw.slot?.midDepth ?? 4), recallDepth: Number(raw.slot?.recallDepth ?? -1), nowDepth: Number(raw.slot?.nowDepth ?? 4),
            // 事实类的几块给不给前台（9/30）：行情和看人要价、说到的派活的人默认只给后台（规划简报里有全份）；派活的人自己开口时照样拿自己那一行的价
            front: { prices: raw.slot?.front?.prices === true, fixers: raw.slot?.front?.fixers === true, seeds: raw.slot?.front?.seeds !== false } },
        // 往下接（core/pace.mjs）：用户只应一声时别重演上一段；别追问不在场的人
        // shape＝他最近两条一个模子（一样长、一样分段、一样开头收尾）时，那一格末尾点出来，请这一条挑没用过的（纯程序，收口计划 ③）
        // lateral（横向生长，用户 10/2）：手边的事、玩家累着时只出就地的和约定"先放着"、约定提两回后歇一歇、末尾的范围句——一个总开关，Q 上开着关着对比用
        pace: { enabled: raw.pace?.enabled !== false, shape: raw.pace?.shape !== false, scope: raw.pace?.scope !== false, lateral: raw.pace?.lateral !== false, holdDrop: raw.pace?.holdDrop === true },
        // 事后截一刀（用户 10/2）：玩家没动，他却换了地方、跳了时间——截到那之前。默认关，Q 上验过再开。
        // 模型口味层（core/taste.mjs，用户 10/15）：各环节的系统提示词按型号认家族、末尾补几句口味；每类环节 auto 按型号认、off 不补、或指定按哪一家补
        taste: { enabled: raw.taste?.enabled !== false, ...Object.fromEntries(TASTE_KINDS.map(k => [k, TASTE_CHOICES.includes(raw.taste?.[k]) ? raw.taste[k] : DEFAULT_TASTE_CHOICES[k]])) },
        content: { tiers: allowedTiers(raw), defaultTier: CONTENT_TIERS.includes(raw.content?.defaultTier) ? raw.content.defaultTier : DEFAULT_TIER,
            pack: typeof raw.content?.pack === 'string' ? raw.content.pack : 'default' },
        stay: { enabled: raw.stay?.enabled === true },
        // 自动进离场与调度（core/auto.mjs，D-201、D-210）：默认开——开了以后该来的人自己在聊天里发消息、打电话、敲门（knock），玩家不回不算进场；
        // 谁接话由后台排（turn）；走了自动记（leave）；快捷按钮（buttons）。maxTurns＝玩家几句没回算没接；cap＝一句之后至多几人（不填按节奏档）；
        // remoteQuiet＝远程的人连着几句玩家没对他说算结束
        auto: { enabled: raw.auto?.enabled !== false, knock: raw.auto?.knock !== false, turn: raw.auto?.turn !== false, leave: raw.auto?.leave !== false, buttons: raw.auto?.buttons !== false,
            maxTurns: Math.max(1, Number(raw.auto?.maxTurns ?? 2) || 2), cap: Number.isFinite(Number(raw.auto?.cap)) && Number(raw.auto?.cap) > 0 ? Number(raw.auto.cap) : null,
            remoteQuiet: Math.max(1, Number(raw.auto?.remoteQuiet ?? 3) || 3) },
        // 局势（core/situation.mjs，Q-8②）：一个剧情日推一次各方的动向、消息怎么传开；默认关。model 不填用叙事组装那档（同一条线路）
        situation: { enabled: raw.situation?.enabled === true, model: typeof raw.situation?.model === 'string' && raw.situation.model ? raw.situation.model : null },
        fresh: { enabled: raw.fresh?.enabled !== false, ways: raw.fresh?.ways !== false, dropEchoes: raw.fresh?.dropEchoes !== false, voice: raw.fresh?.voice !== false, model: typeof raw.fresh?.model === 'string' && raw.fresh.model ? raw.fresh.model : null,
            priceInPerM: raw.fresh?.priceInPerM == null ? null : Number(raw.fresh.priceInPerM), priceOutPerM: raw.fresh?.priceOutPerM == null ? null : Number(raw.fresh.priceOutPerM) },
        strip: Array.isArray(raw.strip) ? raw.strip : DEFAULT_STRIP,
        // 素材包放在哪（相对仓库根目录）；每一局用哪个包在面板上选，存在后台（D-104）
        packs: { dir: typeof raw.packs?.dir === 'string' && raw.packs.dir ? raw.packs.dir : '素材包' },
    };
    const embedProbes = raw.embedProbe && typeof raw.embedProbe === 'object' ? raw.embedProbe : {};
    return withStages(config, stages, over, book, probes, embedProbes);
}

// ---------- 各环节的钥匙和模型（D-106：划掉 ComfyUI，改在面板里选） ----------
// follows：不另外选时跟着谁（面板上说明用）。顺序就是面板上的顺序。
export const STAGES = [
    { id: 'extract', name: '记账', follows: '原配置' },
    { id: 'keys', name: '检索词', follows: '叙事组装那把钥匙' },
    { id: 'assemble', name: '叙事组装', follows: '记账' },
    { id: 'judge', name: '转向和节点检查', follows: '叙事组装' },
    { id: 'plan', name: '规划', follows: '记账' },
    { id: 'away', name: '离开推演', follows: '记账' },
    { id: 'advisor', name: '参谋', follows: '记账那把钥匙' },
    { id: 'setup', name: '开局单', follows: '记账' },
    { id: 'talk', name: '跟后台说话', follows: '记账' },
    { id: 'setupKeys', name: '前史检索词', follows: '检索词' },
    { id: 'fresh', name: '去复读', follows: '检索词' },
    { id: 'profile', name: '读卡（兴趣和习惯）', follows: '参谋' },
    { id: 'scene', name: '兴头（看场面）', follows: '参谋' },
    { id: 'prep', name: '规划前备料', follows: '参谋' },
    { id: 'lore', name: '世界书谁知道', follows: '参谋' },
    { id: 'situation', name: '局势（一个剧情日推一次）', follows: '叙事组装' },
    { id: 'embed', name: '向量（按意思找旧事）', follows: `自动：钥匙簿里能调 ${modelData.embedModel} 的那把；都不能就照旧配检索词` },
];
// 常见型号的单价（每百万 token，美元）：换了模型又没填价时用；不认识的按贵的估（15／75）。
// 官方价目表 2026-10-12 核过（试玩 10/12：表里没有 Haiku 5.5，去复读按 15／75 估，一天估出 16 美元、把记账的当天上限吃满，实际不到两毛）。
// Haiku 5.5 的输入过 10 万 token 贵五倍，这里各环节一次远到不了，按低的那档。
export const KNOWN_PRICES = modelData.knownPrices;
export const EFFORTS = ['low', 'medium', 'high'];
// 向量默认用的型号（D-110 选型）；钥匙簿里哪把能调它，后台自己测（stages.probeEmbeds）
export const EMBED_MODEL = modelData.embedModel;
// 认钥匙用它的散列（不存钥匙的任何一段）：换了钥匙就重测
export const embedProbeKey = k => `${k.name}|${crypto.createHash('sha256').update(String(k.apiKey ?? '')).digest('hex').slice(0, 8)}`;
export const probeKey = (baseUrl, model) => `${baseUrl}|${model}`;

// 钥匙名不分大小写、不管前后空格（杂务窗 9/30：用户存成 claude、gemini，推荐配置要的是 Claude、Gemini，一把都没认到）
export const sameKeyName = (a, b) => typeof a === 'string' && typeof b === 'string' && !!a.trim() && a.trim().toLowerCase() === b.trim().toLowerCase();

function keyBook(v) {
    return (Array.isArray(v) ? v : []).filter(k => k && typeof k.name === 'string' && k.name.trim() && typeof k.baseUrl === 'string' && k.baseUrl && typeof k.apiKey === 'string' && k.apiKey)
        .map(k => ({ name: k.name.trim(), baseUrl: k.baseUrl.replace(/\/+$/, ''), apiKey: k.apiKey }));
}
const connOf = x => ({ baseUrl: x.baseUrl ?? null, apiKey: x.apiKey ?? null, model: x.model ?? null, priceInPerM: x.priceInPerM, priceOutPerM: x.priceOutPerM, extraBody: x.extraBody ?? null });

// 一个环节此刻用什么：面板上选了的换掉，没选的照 def（原来那样）。
export function resolveStage(def, ov, book = [], probes = {}) {
    ov = ov && typeof ov === 'object' ? ov : {};
    const named = typeof ov.key === 'string' && ov.key ? book.find(x => sameKeyName(x.name, ov.key)) ?? null : null;
    // 钥匙簿里只有一把（10/2 用户定为默认）：这一环节要的那把还没有，就用这一把——一装好存一把钥匙就能用
    const alone = !named && typeof ov.key === 'string' && ov.key && book.length === 1 ? book[0] : null;
    const k = named ?? alone;
    const baseUrl = k ? k.baseUrl : def.baseUrl, apiKey = k ? k.apiKey : def.apiKey;
    const model = typeof ov.model === 'string' && ov.model.trim() ? ov.model.trim() : def.model;
    const same = model === def.model, known = KNOWN_PRICES[model];
    const priceInPerM = typeof ov.priceInPerM === 'number' && ov.priceInPerM >= 0 ? ov.priceInPerM : same ? def.priceInPerM : known?.[0] ?? 15;
    const priceOutPerM = typeof ov.priceOutPerM === 'number' && ov.priceOutPerM >= 0 ? ov.priceOutPerM : same ? def.priceOutPerM : known?.[1] ?? 75;
    // 思考档：测过传得过去才发（已知有的型号经中转带这个参数会被拒）
    const via = probes[probeKey(baseUrl, model)];
    const effort = EFFORTS.includes(ov.effort) && (via === true || via === 'output_config') ? ov.effort : null;
    const extraBody = !effort ? def.extraBody ?? null
        : via === 'output_config' ? { ...(def.extraBody ?? {}), output_config: { ...(def.extraBody?.output_config ?? {}), effort } }
        : { ...(def.extraBody ?? {}), reasoning_effort: effort };
    return { baseUrl, apiKey, model, priceInPerM, priceOutPerM, extraBody, effort, key: k?.name ?? null, ...(alone ? { alone: true } : {}), chosen: !!(k || !same || typeof ov.priceInPerM === 'number' || effort) };
}

function withStages(config, stages, over, book, probes, embedProbes = {}) {
    const x = config.extractor, a = config.assembler, p = config.planner, f = config.fresh;
    const one = (id, def) => (stages[id] = resolveStage(def, over[id], book, probes));
    // 组装模型可能借别的格的线路（via，见上）：面板没选钥匙时照借；选了就组装、检索词、去复读都跟着选的那把
    const asm = one('assemble', { ...connOf(a), baseUrl: a.modelBaseUrl ?? a.baseUrl, apiKey: a.modelApiKey ?? a.apiKey });
    Object.assign(a, { model: asm.model, priceInPerM: asm.priceInPerM, priceOutPerM: asm.priceOutPerM, extraBody: asm.extraBody, modelBaseUrl: asm.baseUrl, modelApiKey: asm.apiKey },
        asm.key ? { baseUrl: asm.baseUrl, apiKey: asm.apiKey } : {});
    const keys = one('keys', { ...connOf(a), model: a.keysModel, priceInPerM: a.keysPriceInPerM, priceOutPerM: a.keysPriceOutPerM });
    Object.assign(a, { keysModel: keys.model, keysPriceInPerM: keys.priceInPerM, keysPriceOutPerM: keys.priceOutPerM });
    // 转向和节点检查没单独给型号时跟组装模型同一条线路（judgeVia，质量窗 9/28）
    const judge = one('judge', { ...connOf(a), ...(p.judgeVia ? { baseUrl: a.modelBaseUrl, apiKey: a.modelApiKey } : {}), model: p.judgeModel, priceInPerM: p.judgePriceInPerM, priceOutPerM: p.judgePriceOutPerM });
    Object.assign(p, { judgeModel: judge.model, judgePriceInPerM: judge.priceInPerM, judgePriceOutPerM: judge.priceOutPerM });
    const plan = one('plan', { ...connOf(x), model: p.model, priceInPerM: p.priceInPerM, priceOutPerM: p.priceOutPerM });
    Object.assign(p, { model: plan.model, priceInPerM: plan.priceInPerM, priceOutPerM: plan.priceOutPerM });
    // 离开推演：原来是 absence.model，不填用记账那档；价按它是哪档算
    const awayModel = config.absence.model || x.model || a.model;
    const away = one('away', { ...connOf(a), model: awayModel, ...(awayModel === a.model && awayModel !== x.model ? { priceInPerM: a.priceInPerM, priceOutPerM: a.priceOutPerM } : { priceInPerM: x.priceInPerM, priceOutPerM: x.priceOutPerM }) });
    config.absence.model = away.model;
    Object.assign(config.advisor, connOf(one('advisor', connOf(config.advisor))));
    one('profile', connOf(config.advisor));
    one('scene', connOf(config.advisor));
    one('prep', connOf(config.advisor));
    one('lore', connOf(config.advisor));
    // 局势推演（situation.mjs）：不另选时跟叙事组装那条线路、那个型号；situation.model 另给了型号就按它的常见价算
    const sitModel = config.situation.model || a.model;
    one('situation', { ...connOf(a), baseUrl: a.modelBaseUrl, apiKey: a.modelApiKey, model: sitModel,
        ...(sitModel === a.model ? {} : { priceInPerM: KNOWN_PRICES[sitModel]?.[0] ?? 15, priceOutPerM: KNOWN_PRICES[sitModel]?.[1] ?? 75 }) });
    // 向量（D-110）：面板没选就自动用钥匙簿里测过能调 EMBED_MODEL 的第一把；面板上关了（off）就不开
    const embedOff = over.embed?.off === true;
    const embedAuto = embedOff ? null : book.find(k => embedProbes[embedProbeKey(k)] === true) ?? null;
    const embed = one('embed', { baseUrl: embedAuto?.baseUrl ?? null, apiKey: embedAuto?.apiKey ?? null, model: EMBED_MODEL, priceInPerM: 0.15, priceOutPerM: 0, extraBody: null });
    if (embedOff) Object.assign(embed, { baseUrl: null, apiKey: null, model: null, key: null, off: true });
    else if (!embed.key && embedAuto) embed.auto = embedAuto.name;
    one('setup', connOf(x));
    one('talk', connOf(x));
    one('setupKeys', { ...connOf(keys), extraBody: a.extraBody });
    const freshModel = f.model || keys.model || a.model;
    const fresh = one('fresh', { ...connOf(a), model: freshModel,
        ...(f.priceInPerM != null ? { priceInPerM: f.priceInPerM, priceOutPerM: f.priceOutPerM ?? f.priceInPerM * 5 } : freshModel === keys.model ? { priceInPerM: keys.priceInPerM, priceOutPerM: keys.priceOutPerM } : { priceInPerM: a.priceInPerM, priceOutPerM: a.priceOutPerM }) });
    Object.assign(f, { model: fresh.model, priceInPerM: fresh.priceInPerM, priceOutPerM: fresh.priceOutPerM });
    for (const st of Object.values(stages)) st.heartbeat = config.thinking?.heartbeat !== false;
    config.stages = stages;
    config.keys = book;
    config.effortProbe = probes;
    config.embedProbe = embedProbes;
    return config;
}

function advisorOf(v, extractor) {
    return {
        enabled: v.enabled === true,
        baseUrl: typeof v.baseUrl === 'string' ? v.baseUrl.replace(/\/+$/, '') : extractor.baseUrl,
        apiKey: typeof v.apiKey === 'string' && v.apiKey ? v.apiKey : extractor.apiKey,
        model: typeof v.model === 'string' && v.model ? v.model : null,
        priceInPerM: Number(v.priceInPerM ?? 0.5),
        priceOutPerM: Number(v.priceOutPerM ?? 3),
        library: typeof v.library === 'string' ? v.library : null,
        nameTable: typeof v.nameTable === 'string' ? v.nameTable : null,
        budgetChars: Number(v.budgetChars ?? 40000),
        maxOutputTokens: Number(v.maxOutputTokens ?? 8000),
        timeoutMs: Number(v.timeoutMs ?? 180000),
        temperature: typeof v.temperature === 'number' ? v.temperature : null,
        extraBody: v.extraBody && typeof v.extraBody === 'object' ? v.extraBody : null,
    };
}

export function extractorReady(config) {
    const e = config.extractor;
    return !!(e.baseUrl && e.model && e.apiKey);
}
