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
const TASTE_HELP = { plan: "调整规划口味，建议自动识别。",
    judge: "调整判定口味，建议自动识别。",
    act: "前台补丁默认关闭，建议按需开启。",
    camera: "旁白补丁默认关闭，建议按需开启。" };
const TASTE_LABELS = { plan: '规划', judge: '转向检查、节点检查', act: '前台演绎的纠偏', camera: '旁白' };

// path：config.json 里的位置；group：面板上的分组；get：从 loadConfig 的结果里读此刻生效的值（不写就按 path 读）
const FRESH_KNOBS = [
    {path:'fresh.enabled',type:'bool',label:'按角色改口吻'},
    {path:'fresh.dropEchoes',type:'bool',label:'去掉复述开头'},
    {path:'advisor.enabled',type:'bool',label:'参谋'},
];
export const KNOBS = [
    { path: 'cast.promoteRecords', group: '名册', type: 'int', min: 1, max: 10000, label: "无卡人物多少条记录后提示建卡", help: "建卡提示的记录门槛，建议先用默认。" },
    { path: 'cast.promoteWeight', group: '名册', type: 'int', min: 1, max: 3, label: "提示建卡的关系变化分量", help: "建卡提示的关系门槛，建议先用默认。" },
    { path: 'content.defaultTier', group: '口味', type: 'enum', options: CONTENT_TIERS.map(t => [t, t]), label: "新局默认档位", help: "新局内容档位，建议按玩法选。" },
    // 那一格
    { path: 'slot.split', group: '那一格', type: 'bool', label: "分块放", help: "把场记分块放，建议保持开启。" },
    { path: 'slot.front.prices', group: '给前台的', type: 'bool', label: "行情和看人要价", help: "给前台行情，建议有买卖戏再开。" },
    { path: 'slot.front.fixers', group: '给前台的', type: 'bool', label: "说到的派活的人", help: "给前台派活资料，建议需要时再开。" },
    { path: 'slot.front.seeds', group: '给前台的', type: 'bool', label: "世界的底色", help: "提供背景动静，建议保持开启。" },
    { path: 'slot.maxChars', group: '那一格', type: 'int', min: 400, max: 6000, label: "总长度（字）", help: "限制场记长度，建议先用默认。" },
    { path: 'assembler.enabled', group: '那一格', type: 'bool', label: "叙事组装", help: "用模型串起旧事，建议按需开启。" },
    { path: 'assembler.budgetMs', group: '那一格', type: 'int', min: 0, max: 60000, label: "组装最多等（毫秒）", help: "限制组装等待，建议先用默认。" },
    // 活人感
    { path: 'state.enabled', group: '那一格', type: 'bool', label: "此刻的样子", help: "更新眼下状况，建议保持开启。" },
    { path: 'glance.enabled', group: '活人感', type: 'bool', label: "看一眼合并", help: "合并状态与兴头调用，建议开启。" },
    { path: 'scene.enabled', group: '活人感', type: 'bool', label: "兴头（看场面起头）", help: "让角色当场起头，建议保持开启。" },
    { path: 'scene.gap', group: '活人感', type: 'int', min: 2, max: 60, label: "两个兴头至少隔几条", help: "控制兴头间隔，建议先用默认。" },
    { path: 'scene.inPlaceGap', group: '活人感', type: 'int', min: 2, max: 60, label: "同一个人就地起头隔几条", help: "控制同人闲聊间隔，建议先用默认。" },
    { path: 'scene.personGap', group: '活人感', type: 'int', min: 2, max: 200, label: "同一个人提议出门隔几条", help: "控制同人邀约间隔，建议先用默认。" },
    { path: 'scene.closeGap', group: '活人感', type: 'int', min: 2, max: 400, label: "同一对人亲近隔几条", help: "控制同对亲近间隔，建议先用默认。" },
    { path: 'mood.carry', group: '活人感', type: 'bool', label: "情绪余波", help: "保留情绪余波，建议保持开启。" },
    { path: 'situation.enabled', group: '活人感', type: 'bool', label: "局势推演", help: "推各方动向，有势力资料再开。" },
    { path: 'contacts.enabled', group: '活人感', type: 'bool', label: "不在场的人来联系", help: "让不在场的人联系，建议开启。" },
    { path: 'drift.prices', group: '活人感', type: 'bool', label: "物价按周小幅波动", help: "让物价按周波动，建议先用默认。" },
    { path: 'drift.long', group: '活人感', type: 'bool', label: "持续几周的事", help: "生成持续多日的事，建议先用默认。" },
    { path: 'contacts.minGap', group: '活人感', type: 'int', min: 4, max: 200, label: "来联系至少隔几条", help: "控制联系间隔，建议先用默认。" },
    // 写法
    { path: 'pace.enabled', group: '写法', type: 'bool', label: "往下接", help: "让回应往下接，建议保持开启。" },
    { path: 'pace.shape', group: '写法', type: 'bool', label: "形状提醒", help: "提醒换写法，建议保持开启。" },
    // 离开与规划
    { path: 'planner.turnScreen', group: '离开与规划', type: 'bool', label: "转向检查先程序初筛", help: "先筛需判转向的事，建议开启。" },
    { path: 'absence.mode', group: '离开与规划', type: 'enum', options: [['real', '照现实过'], ['pause', '世界等你']], label: "离开时默认", help: "决定离开怎么算，建议按玩法选。" },
    { path: 'absence.minHours', group: '离开与规划', type: 'num', min: 1, max: 720, label: "多久不来算离开（小时）", help: "设离开门槛，建议先用默认。" },
    { path: 'absence.maxDays', group: '离开与规划', type: 'int', min: 1, max: 365, label: "离开最多按几天算", help: "限制离开推进，建议先用默认。" },
    { path: 'planner.provider', group: '离开与规划', type: 'enum', options: [['api', '调模型'], ['queue', '交给窗口'], ['off', '关']], label: "规划", help: "选择规划方式，建议先用调模型。" },
    { path: 'planner.briefChars', group: '离开与规划', type: 'int', min: 10000, max: 400000, label: "规划简报最多多少字", help: "限制规划材料长度，建议先用默认。" },
    // 花费
    { path: 'extractor.dailyBudgetUsd', group: '花费', type: 'num', min: 0, max: 500, label: "后台每天最多花（美元）", help: "控制后台花费，建议先设预算。" },
    { path: 'thinking.heartbeat', group: '离开与规划', type: 'bool', label: "想得久的模型保持连接", help: "给长思考保活，建议保持默认。" },
    { path: 'planner.budgetUsd', group: '花费', type: 'num', min: 0, max: 500, label: "规划每天最多花（美元）", help: "限制规划花费，建议先设预算。" },
    { path: 'extractor.auto', group: '花费', type: 'bool', label: "新接入的窗口自动每条总结", help: "接入后自动每条总结，建议开启。" },
    // 自动进离场与调度（core/auto.mjs，D-201）
    { path: 'auto.enabled', group: '自动进离场', type: 'bool', label: "进离场和谁接话交给后台", help: "安排进离场与接话，建议开启。" },
    { path: 'auto.knock', group: '自动进离场', type: 'bool', label: "叩门", help: "让角色主动来联系，建议开启。" },
    { path: 'auto.turn', group: '自动进离场', type: 'bool', label: "谁接话后台排", help: "安排谁接话，建议保持开启。" },
    { path: 'auto.leave', group: '自动进离场', type: 'bool', label: "走了自动记", help: "识别角色离开，建议保持开启。" },
    { path: 'auto.buttons', group: '自动进离场', type: 'bool', label: "叩门下面的快捷按钮", help: "提供叩门快捷回应，建议开启。" },
    { path: 'auto.maxTurns', group: '自动进离场', type: 'num', min: 1, max: 6, label: "几句没回算没接", help: "设不回应的等待量，建议用默认。" },
    { path: 'auto.remoteQuiet', group: '自动进离场', type: 'num', min: 1, max: 8, label: "远程的人几句没理算结束", help: "设远程联系结束量，建议用默认。" },
    // 模型口味：总开关默认开；规划/检查默认自动认，前台/旁白需另行启用。
    { path: 'taste.enabled', group: '模型口味', type: 'bool', label: "按模型补口味", help: "按模型调整演法，建议保持默认。" },
    ...TASTE_KINDS.map(k => ({ path: `taste.${k}`, group: '模型口味', type: 'enum', options: TASTE_OPTIONS, label: TASTE_LABELS[k], help: TASTE_HELP[k] })),
];

const byPath = new Map([...KNOBS, ...FRESH_KNOBS].map(k => [k.path, k]));
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
        return { controls: { advisorEnabled: config.advisor.enabled }, knobs: KNOBS.filter(k => k.path !== 'content.defaultTier' || allowedTiers(config).length > 1).map(k => ({ ...k, ...(k.path === 'content.defaultTier' ? { options: k.options.filter(([t]) => allowedTiers(config).includes(t)) } : {}), value: read(config, k.path), own: read(raw, k.path) !== undefined })) };
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
