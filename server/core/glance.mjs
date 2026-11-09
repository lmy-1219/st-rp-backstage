// 看一眼（方案 自动进离场与调度 第四节、第十节；用户 10/16 定做）：角色答完一条，后台要看两眼——"此刻的样子"（穿着、位置、带着、
// 身体、天气、周围、地方、时段有没有变）和"兴头"（这一刻有没有人自己起点什么）。两眼用的是同一档模型、同一时刻、同一段正文，
// 以前各调一次、串着等（试玩里每次 40 秒上下）；这里并成一次调用：两份规矩各自原样，答案合成一个 JSON 的两格。
// 第三眼（第十节"谁走了"兜底）：自动离场程序拿不准的那几位，顺着这一次问；两眼都不用看时单独小问一次。
// 只有一眼要看时照旧单独调（main.runState／runScene），解析失败的那一格照单独调失败处理。面板能关（glance.enabled）。题材无关。
import { STATE_SYSTEM, parseState } from './state.mjs';
import { SCENE_SYSTEM, parseScene } from './scene.mjs';

const OUT = /^只输出一个 JSON[：:]/;
// 各自那条"只输出一个 JSON：{…}"改成"这一眼的答案是一个 JSON：{…}"（格式说明留着，字段都在里面）
const asPart = text => text.split('\n').map(l => (OUT.test(l) ? l.replace(OUT, '这一眼的答案是一个 JSON：') : l)).join('\n');

export const GLANCE_HEAD = '你在给一部长篇角色扮演看一眼眼下：同一段刚写下的正文，看两眼——第一眼记"此刻的样子"有没有变，第二眼看场面有没有人自己起点什么。两眼各有各的规矩，分开想，互不影响。';
export const GLANCE_TAIL = '最后把各眼的答案合成一个 JSON 输出：{"此刻": <第一眼的 JSON>, "场面": <第二眼的 JSON>, "走了": <第三眼的 JSON>, "来了": <第四眼的 JSON>}。没给材料的那一眼填 null。除这个 JSON 外什么都不写。';
// 第三眼：程序拿不准的那几位，照最近几条正文判还在不在这个场面
export const LEFT_SYSTEM = [
    '照给出的正文，逐人复核此刻还在不在场（远程的人是否仍在联系）。不要凭题材常识补动作；不能看清就答看不出。',
    '玩家打发某人或一群人离开，对方答应或照做，从那条起算走了；拒绝或仍在场做事则还在。被打发后一直没开口、正文也没确认在场，先答被打发未动；玩家又说两句仍如此，才算走了。',
    '每人选走了、还在、被打发未动、看不出，并用条号和那条里二十字以内的原文作依据。叫法和又名只用来认人，答案用名单上的名字。',
    '这一眼的答案是一个 JSON：{"名字":{"结果":"走了|还在|被打发未动|看不出","条":0,"引":"照抄的短片段"}}。',
].join('\n');
export const CAME_SYSTEM = [
    '照给出的正文，逐人判断他是不是已经当面出现在这个场面里。正文写他走进来、推门出来、站在面前，有人当面跟他说话，或者他开口说了话，算到了。',
    '只是提到他、说要去找他、在想他、打电话或发消息给他，不算到了。拿不准就答没到。叫法和又名只用来认人，答案用名单上的名字。',
    '每人答到了或没到，用条号和那条里二十字以内的原文作依据。',
    '这一眼的答案是一个 JSON：{"名字":{"结果":"到了|没到","条":0,"引":"照抄的短片段"}}。',
].join('\n');

export function glanceSystem({ state = true, scene = true, left = false, came = false } = {}) {
    return [GLANCE_HEAD, '',
        ...(state ? ['【第一眼：此刻的样子】', asPart(STATE_SYSTEM), ''] : []),
        ...(scene ? ['【第二眼：看场面】', asPart(SCENE_SYSTEM), ''] : []),
        ...(left ? ['【第三眼：谁走了】', LEFT_SYSTEM, ''] : []),
        ...(came ? ['【第四眼：谁来了】', CAME_SYSTEM, ''] : []),
        GLANCE_TAIL].join('\n');
}

export function glancePrompt({ state = null, scene = null, left = null, came = null } = {}) {
    return [
        ...(state ? ['【第一眼的材料：此刻的样子】', state, ''] : []),
        ...(scene ? ['【第二眼的材料：看场面】', scene, ''] : []),
        ...(left ? ['【第三眼的材料：谁走了】', left, ''] : []),
        ...(came ? ['【第四眼的材料：谁来了】', came, ''] : []),
    ].join('\n').trim();
}
export function camePrompt({ doubts = [], messages = [], userName = '玩家' } = {}) {
    const userAt = messages.findLastIndex(m => m.is_user);
    const from = Math.max(0, userAt - 3);
    const clip = text => { const t = String(text ?? ''); return t.length <= 1500 ? t : t.slice(0, 300) + '……' + t.slice(-900); };
    return ['【要复核的几位】', ...doubts.map(d => '· ' + d.who + '（叫法：' + (d.aliases ?? [d.who]).join('、') + '）'),
        '', '【最近正文】（' + userName + '是玩家的角色）',
        ...messages.slice(from).slice(-10).map(m => '〔' + m.pos + '〕' + (m.is_user ? userName : (m.name ?? m.speaker)) + '：' + clip(m.text))].join('\n');
}

// 第三眼的材料：拿不准的几位（who、why）＋最近几条正文
export function leftPrompt({ doubts = [], messages = [], userName = '玩家', recent = 10 } = {}) {
    const starts = doubts.map(d => d.from ?? d.since ?? d.at).filter(Number.isFinite);
    const from = starts.length ? Math.min(...starts) : -Infinity;
    const clip = text => { const t=String(text ?? ''); return t.length<=1500 ? t : t.slice(0,300)+'……'+t.slice(-900); };
    return [
        '【要复核的几位】', ...doubts.map(d => '· '+d.who+'（'+(d.status==='remote'?'远程':'当面')+'；叫法：'+(d.aliases??[d.who]).join('、')+'；起疑条：'+d.at+'）：'+d.why+(d.pendingAt!=null?'；已核被打发未动〔'+d.pendingAt+'〕：'+(d.pendingQuote??''): '')),
        '', '【从上次判过以后】（'+userName+'是玩家的角色）',
        ...messages.filter(m=>m.pos>=from).slice(-Math.min(10,recent)).map(m=>'〔'+m.pos+'〕'+(m.is_user?userName:(m.name??m.speaker))+'：'+clip(m.text)),
    ].join('\n');
}

// 合并关着时仍可只问第三眼；注入 complete，测试不接真模型。
export async function completeGlance({ config, spentToday = 0, state = null, scene = null, doubts = [], came = [], messages = [], userName = '玩家', complete }) {
    if (config.glance?.enabled === false) { state=null; scene=null; }
    if (!state && !scene && !doubts.length && !came.length) return null;
    const stage=config.stages?.scene;
    if (!stage?.baseUrl || !stage.apiKey || !stage.model || spentToday >= (config.extractor?.dailyBudgetUsd ?? Infinity)) return null;
    return complete({ system:glanceSystem({state:!!state,scene:!!scene,left:!!doubts.length,came:!!came.length}),
        user:glancePrompt({state,scene,left:doubts.length?leftPrompt({doubts,messages,userName}):null,
            came:came.length?camePrompt({doubts:came,messages,userName}):null}) });
}

// → { state: parseState 的结果（[] 也算答了）| null（没答、答坏了）, scene: parseScene 的结果 | null（没答）, left: { 名字: 走了没 } | null }
// 旧版第三眼仅兼容真正布尔；结构化答案的依据在 answerLeaves 按实际输入核验。
export function parseGlance(text) {
    const s = String(text ?? '');
    const none = { state: null, scene: null, left: null };
    // 旧调用方对坏答案做三格对象的深比较；属性仍可读，兼容旧断言。
    Object.defineProperty(none, 'came', { value: null });
    const a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a < 0 || b <= a) return none;
    let v;
    try { v = JSON.parse(s.slice(a, b + 1)); } catch { return none; }
    if (!v || typeof v !== 'object') return none;
    const has = k => Object.prototype.hasOwnProperty.call(v, k);
    let st = null, sc = null, lf = null;
    if (has('此刻') || has('场面') || has('走了') || has('来了')) { st = v['此刻'] ?? null; sc = v['场面'] ?? null; lf = v['走了'] ?? null; }
    else if (has('变化')) st = v;
    else if (has('有') || has('玩家眼下') || has('空当')) sc = v;
    let left = null;
    if (lf && typeof lf === 'object' && !Array.isArray(lf)) {
        left = Object.fromEntries(Object.entries(lf).filter(([name,x]) => name.trim() && (typeof x === 'boolean' || (x && typeof x==='object' && !Array.isArray(x) && ['走了','还在','被打发未动','看不出'].includes(x['结果'])))));
    }
    const came = v['来了'];
    const parsedCame = came && typeof came === 'object' && !Array.isArray(came)
        ? Object.fromEntries(Object.entries(came).filter(([name,x]) => name.trim() && x && typeof x === 'object' && !Array.isArray(x) && ['到了','没到'].includes(x['结果']))) : null;
    const result = {
        state: st && typeof st === 'object' ? parseState(JSON.stringify(st)) : null,
        scene: sc && typeof sc === 'object' ? parseScene(JSON.stringify(sc)) : null,
        left,
        came: parsedCame,
    };
    return result.state === null && result.scene === null && result.left === null && !has('来了') ? none : result;
}
