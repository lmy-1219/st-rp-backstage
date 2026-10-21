// 调参（试玩期间用户自己在面板上调，9/29 用户：尽量都让我能从面板上调一下，别一点问题都来找窗口改代码）。
// 这里列后台配置里能调的开关和数字：每一项写明管什么、调大调小会怎样；改了存进后台的 config.json，下一次调用就用新的（后台每次现读配置）。
// 钥匙、型号、单价不在这里（在"各环节的模型"里）；只收这张表里的项，值按类型和范围核过才写。
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from './config.mjs';
import { KINDS as TASTE_KINDS, TASTE_CHOICES, CHOICE_LABELS } from './taste.mjs';
import { CONTENT_TIERS, allowedTiers } from './prompt-slots.mjs';

// 模型口味（core/taste.mjs）：每类环节按哪一家补口味
const TASTE_OPTIONS = TASTE_CHOICES.map(c => [c, CHOICE_LABELS[c]]);
const TASTE_HELP = { plan: '自动认：按规划用的型号——Claude 系往戏剧性推（敢排意外、代价、翻脸），Gemini 系往一致性推（只用简报里的事实、按格填、不越界），DeepSeek 往新意推。指定一家：不管型号按那一家补。不补：只用通用底',
    judge: '转向检查、节点检查这类要 JSON 的短活：Gemini、DeepSeek 补一句只出 JSON、不解说、不猜；Claude 系已稳，不补',
    act: '前台、旁白补丁默认不发；开了以后按型号补一段演法。选自动认或指定一家才启用前台演绎的纠偏（第五块）：Claude 系放开（有脾气、会拒绝、不说教）；Gemini 3 收着点、别复读、别替玩家动、关心不下指令；Gemini 4 有棱角。要扩展把前台型号报给后台才生效',
    camera: '前台、旁白补丁默认不发；开了以后按型号补一段演法。选自动认或指定一家才给旁白带一段：Claude 系镜头冷一点、不替人圆场；Gemini 系只写看得见的、不编新人新地址' };
const TASTE_LABELS = { plan: '规划', judge: '转向检查、节点检查', act: '前台演绎的纠偏', camera: '旁白' };

// path：config.json 里的位置；group：面板上的分组；get：从 loadConfig 的结果里读此刻生效的值（不写就按 path 读）
export const KNOBS = [
    { path: 'cast.promoteRecords', group: '名册', type: 'int', min: 1, max: 10000, label: '无卡人物多少条记录后提示建卡', help: '还须有和玩家的关系大事，或牵头过口袋事件；只提示，不自动建卡' },
    { path: 'cast.promoteWeight', group: '名册', type: 'int', min: 1, max: 3, label: '提示建卡的关系变化分量', help: '规划这一段留下的里，两人与玩家之间达到这个分量才算关系大事' },
    { path: 'content.defaultTier', group: '口味', type: 'enum', options: CONTENT_TIERS.map(t => [t, t]), label: '新局默认档位', help: '本局开局单写了档位的，照本局；系统限制只能用一种档位时以系统限制为准。' },
    // 那一格
    { path: 'slot.split', group: '那一格', type: 'bool', label: '分块放', help: '开：底子在开头，口袋、想起的、这一轮都插在最近四条消息之前（最后四条连着给）。关：整格放在最后（原来的样子）' },
    { path: 'slot.front.prices', group: '给前台的', type: 'bool', label: '行情和看人要价', help: '开：聊到钱时把物价、卖家对谁抬价递给开口的人。关（默认）：只给后台规划用，规划排到买卖时自己写进那件事；派活的人自己开口时照样拿他那几档活的价' },
    { path: 'slot.front.fixers', group: '给前台的', type: 'bool', label: '说到的派活的人', help: '开：聊天里点到某个中间人，把他的地盘、本事递给开口的人。关（默认）：只给后台（关系表规划全读）；中间人自己牵头的事照样带着他的本事' },
    { path: 'slot.front.seeds', group: '给前台的', type: 'bool', label: '世界的底色', help: '开（默认）：场面松的时候偶尔递一条这座城的新闻、传闻当背景，可用可不用。关：不递' },
    { path: 'slot.maxChars', group: '那一格', type: 'int', min: 400, max: 6000, label: '总长度（字）', help: '除了"底子"以外那几块加起来的上限；超了按次序让位（背景先让，眼下正在说的不让）。调小更省、更干净，调大给得更全' },
    { path: 'assembler.enabled', group: '那一格', type: 'bool', label: '叙事组装', help: '开：先让模型把挑出来的旧事串成几句话再给（每次约 1 美分）。关：程序直接列出来（不花钱、更快）' },
    { path: 'assembler.budgetMs', group: '那一格', type: 'int', min: 0, max: 60000, label: '组装最多等（毫秒）', help: '第一个开口的角色最多多等多久；到点先给程序列的那一格。0＝等到组装好为止' },
    // 活人感
    { path: 'state.enabled', group: '那一格', type: 'bool', label: '此刻的样子', help: '开（默认）：每来几条新消息，后台用便宜模型记下写到过的穿着、位置、带着的东西、身体状况、天气、周围，给在场的人；换了就更新，过一天天气记成"前一天"。每轮约 0.2 美分' },
    { path: 'glance.enabled', group: '活人感', type: 'bool', label: '看一眼合并', help: '开（默认）：角色答完一条，"此刻的样子"和"兴头"两眼并成一次模型调用（一轮少等一次，省一半钱）；两份规矩各自原样，答案合成一个 JSON。关：各调各的，和以前一样' },
    { path: 'scene.enabled', group: '活人感', type: 'bool', label: '兴头（看场面起头）', help: '角色回完一条，后台看一眼场面：有人冒个念头、闲聊、斗嘴、亲近、熟人来邀、街上冒件事。每次约 1 美分' },
    { path: 'scene.gap', group: '活人感', type: 'int', min: 2, max: 60, label: '两个兴头至少隔几条', help: '调小更热闹，调大更安静' },
    { path: 'scene.inPlaceGap', group: '活人感', type: 'int', min: 2, max: 60, label: '同一个人就地起头隔几条', help: '冒一句、问你、斗嘴、顺手、亲近' },
    { path: 'scene.personGap', group: '活人感', type: 'int', min: 2, max: 200, label: '同一个人提议出门隔几条', help: '喝一杯、找场子这类' },
    { path: 'scene.closeGap', group: '活人感', type: 'int', min: 2, max: 400, label: '同一对人亲近隔几条', help: '' },
    { path: 'mood.carry', group: '活人感', type: 'bool', label: '情绪余波', help: '给过一次的材料带动的情绪，之后几次开口接着给' },
    { path: 'situation.enabled', group: '活人感', type: 'bool', label: '局势推演', help: '一个剧情日推一次各方的动向、消息怎么传开（要素材包里有势力网）。每次约 1 美分' },
    { path: 'contacts.enabled', group: '活人感', type: 'bool', label: '不在场的人来联系', help: '' },
    { path: 'drift.prices', group: '活人感', type: 'bool', label: '物价按周小幅波动', help: '开（默认）：每个剧情周，有的东西贵一成两成、便宜一成，常常连着几周不变；聊到钱时给的价码跟着变。不花钱' },
    { path: 'drift.long', group: '活人感', type: 'bool', label: '持续几周的事', help: '开（默认）：每个剧情周掷一次要不要起一件持续几周、分阶段的事（地盘之争、一阵严查、短缺……，同时至多两件），角色当背景听说。起一件约 1 美分' },
    { path: 'contacts.minGap', group: '活人感', type: 'int', min: 4, max: 200, label: '来联系至少隔几条', help: '' },
    // 写法
    { path: 'fresh.enabled', group: '写法', type: 'bool', label: '去复读', help: '每条回复生成完，换掉和他前几条重样的整句（每条约半美分，几秒后那条会变一下）' },
    { path: 'fresh.ways', group: '写法', type: 'bool', label: '点出他用滥的路数', help: '下一次开口前提醒一句' },
    { path: 'fresh.dropEchoes', group: '写法', type: 'bool', label: '去掉复述开头', help: '台词一段开头拿对方的话反问一句（"借钱？"）、"至于……"拎对方话头的，程序直接去掉（不花钱，跟着去复读开关）' },
    { path: 'fresh.voice', group: '写法', type: 'bool', label: '换句子学他本人的口吻', help: '后台数据目录"口吻"下放 <角色名>.md（他本人的台词选段），去复读换句子时照着学口吻、不许照抄（每条多花不到半美分；没放文件就不用）' },
    { path: 'pace.enabled', group: '写法', type: 'bool', label: '往下接', help: '玩家只应一声时别把上一段再演一遍；别追问不在场的人' },
    { path: 'pace.shape', group: '写法', type: 'bool', label: '形状提醒', help: '他最近两条一个模子（一样长、一样分段、一样开头收尾）时点出来' },
    // 离开与规划
    { path: 'planner.turnScreen', group: '离开与规划', type: 'bool', label: '转向检查先程序初筛', help: '开（默认）：记账记下新东西后，只有玩家拿主意的话、角色起的新念头、关系变了、做的事里有闹大的字眼才叫模型判转向／弄断／发酵（试玩七天 266 次里 259 次什么都没判出来，每次近一分钟）；只因做的事而问的至少隔八条。关：每批新记录都问' },
    { path: 'absence.mode', group: '离开与规划', type: 'enum', options: [['real', '照现实过'], ['pause', '世界等你']], label: '离开时默认', help: '每一局还可以在"这一局"里单独设' },
    { path: 'absence.minHours', group: '离开与规划', type: 'num', min: 1, max: 720, label: '多久不来算离开（小时）', help: '' },
    { path: 'absence.maxDays', group: '离开与规划', type: 'int', min: 1, max: 365, label: '离开最多按几天算', help: '' },
    { path: 'planner.provider', group: '离开与规划', type: 'enum', options: [['api', '调模型'], ['queue', '交给窗口'], ['off', '关']], label: '规划', help: '调模型：一个主线节点一次，约一两美元' },
    { path: 'planner.briefChars', group: '离开与规划', type: 'int', min: 10000, max: 400000, label: '规划简报最多多少字', help: '超了按远近压：先只给最近露过面的人，再把早些的账按场次、按节点并起来，再截备料；压过了面板上会提示一回' },
    // 花费
    { path: 'extractor.dailyBudgetUsd', group: '花费', type: 'num', min: 0, max: 500, label: '后台每天最多花（美元）', help: '到了就停：记账、组装、兴头这些都不调了' },
    { path: 'thinking.heartbeat', group: '离开与规划', type: 'bool', label: '想得久的模型保持连接', help: '按 Anthropic 写法开了思考档的（比如规划用 Opus 5.5 高档），请它边想边吐思考摘要当心跳，中转就不会因为五分钟没数据掐断；摘要读到就丢，不存不给看，也不多收钱' },
    { path: 'planner.budgetUsd', group: '花费', type: 'num', min: 0, max: 500, label: '规划每天最多花（美元）', help: '' },
    { path: 'extractor.auto', group: '花费', type: 'bool', label: '新接入的窗口自动记账', help: '' },
    // 自动进离场与调度（core/auto.mjs，D-201）
    { path: 'auto.enabled', group: '自动进离场', type: 'bool', label: '进离场和谁接话交给后台', help: '开了：该来的人自己在聊天里发消息、打电话、敲门，你不回他就不算进场；谁接话、谁插话后台排，ST 的群要改成"手动"策略（扩展替你改）；他说走了、挂了、你换了地方后台自己记他走了。默认开。关：照旧门那一行、你点进场离场' },
    { path: 'auto.knock', group: '自动进离场', type: 'bool', label: '叩门', help: '门上到时候了的人自己来联系（一次只一个、隔够几条、一个时段至多一两次）' },
    { path: 'auto.turn', group: '自动进离场', type: 'bool', label: '谁接话后台排', help: '关了就回到 ST 自己的轮话' },
    { path: 'auto.leave', group: '自动进离场', type: 'bool', label: '走了自动记', help: '挂断、走了、换场景没带他：拿得准的自动记去向；拿不准的交看一眼复核，核过才记' },
    { path: 'auto.buttons', group: '自动进离场', type: 'bool', label: '叩门下面的快捷按钮', help: '接／不理／让他进来，不替你写字；打字回一样有效' },
    { path: 'auto.maxTurns', group: '自动进离场', type: 'num', min: 1, max: 6, label: '几句没回算没接', help: '你的几句话之后他这次叩门作废（换了时段也作废）' },
    { path: 'auto.remoteQuiet', group: '自动进离场', type: 'num', min: 1, max: 8, label: '远程的人几句没理算结束', help: '电话里、消息里的人，他开口以后你连着几句没对他说，通话／消息就算结束了' },
    // 模型口味：总开关默认开；规划/检查默认自动认，前台/旁白需另行启用。
    { path: 'taste.enabled', group: '模型口味', type: 'bool', label: '按模型补口味', help: '开（默认）：规划和检查按型号认家族，末尾补几句口味——Claude 系的规划往戏剧性推，Gemini 系往一致性、守格守界推，DeepSeek 往新意推；认不出家族的只用通用底。前台、旁白补丁默认不发；开了以后按型号补一段演法。关：全部只用通用底' },
    ...TASTE_KINDS.map(k => ({ path: `taste.${k}`, group: '模型口味', type: 'enum', options: TASTE_OPTIONS, label: TASTE_LABELS[k], help: TASTE_HELP[k] })),
];

const byPath = new Map(KNOBS.map(k => [k.path, k]));
const read = (obj, p) => p.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

export function checkValue(knob, v) {
    if (knob.type === 'bool') { if (typeof v !== 'boolean') throw new Error('要开或关'); return v; }
    if (knob.type === 'enum') { if (!knob.options.some(([x]) => x === v)) throw new Error('没有这个选项'); return v; }
    const n = Number(v);
    if (v === '' || v === null || !Number.isFinite(n)) throw new Error('要填数字');
    if (knob.type === 'int' && !Number.isInteger(n)) throw new Error('要填整数');
    if (n < knob.min || n > knob.max) throw new Error(`要在 ${knob.min}～${knob.max} 之间`);
    return n;
}

export function createTuning({ home }) {
    const file = path.join(home, 'config.json');
    const readRaw = () => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; } };
    const patch = mutate => {
        const raw = readRaw();
        mutate(raw);
        fs.writeFileSync(`${file}.tmp`, `${JSON.stringify(raw, null, 2)}\n`);
        fs.renameSync(`${file}.tmp`, file);
    };
    const bad = message => { throw Object.assign(new Error(message), { status: 400 }); };
    function view() {
        const config = loadConfig(home), raw = readRaw();
        return { knobs: KNOBS.filter(k => k.path !== 'content.defaultTier' || allowedTiers(config).length > 1).map(k => ({ ...k, ...(k.path === 'content.defaultTier' ? { options: k.options.filter(([t]) => allowedTiers(config).includes(t)) } : {}), value: read(config, k.path), own: read(raw, k.path) !== undefined })) };
    }
    // value 为 undefined：恢复默认（从配置里删掉这一项）
    function set(p, value) {
        const knob = byPath.get(p);
        if (!knob) bad('没有这一项');
        if (p === 'content.defaultTier' && value !== undefined && !allowedTiers(loadConfig(home)).includes(value)) bad('系统没有开放这个档位');
        let v;
        if (value !== undefined) { try { v = checkValue(knob, value); } catch (e) { bad(`${knob.label}：${e.message}`); } }
        patch(raw => {
            const keys = p.split('.');
            let o = raw;
            for (const k of keys.slice(0, -1)) { if (!o[k] || typeof o[k] !== 'object') o[k] = {}; o = o[k]; }
            if (value === undefined) delete o[keys.at(-1)]; else o[keys.at(-1)] = v;
        });
        return view();
    }
    return { view, set };
}
