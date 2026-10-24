// rp_emergence 的 ST 前端扩展：
// ① 接入的窗口里，消息一有变化就把"当前序列"增量同步给后台（只传指纹，后台缺哪条正文才补传哪条）；
// ② 每次某个角色要发言前，向后台要"只给他的那一格"，临时塞进这次请求，用完即清；
// ③ 设置面板里的开关与状态。后台连不上时什么都不做，ST 照常。
import { visibleTo, filterVisible, knockHtml, autoDoorHtml, autoTurnEnabled, applyLeaveEvent, isolateLeaveSupportsIndex, closeIsolationAt, runLeaveAttempt, resetLeaveAttempt, leaveRetryView } from './sync.mjs';   // 自动进离场与调度（1c）：谁看得见、候着那一行
import { removedMembers, speakerOf, fingerprintMessage, buildSequence, batches, keepRecentRounds, olderReplies, filterLore, planPlacement, SLOT_MACROS, CAMERA_FLAG, cameraPromptPlan, cameraBookPlan, isCamera, setCamera, loreHash, narratorSaysI, namedIn, doorMark, doorHtml, cameraJoinPoint, addedMembers, arriveOpts, personaPayload, createPersonaWatch } from './sync.mjs';

const MODULE = 'rp_emergence';
const KEYS = { rule: 'rp_emergence_rule', slot: 'rp_emergence_slot', mid: 'rp_emergence_mid', recall: 'rp_emergence_recall', world: 'rp_emergence_world' };
const INJECT_TYPES = new Set(['normal', 'swipe', 'regenerate', 'continue']);
const ctx = () => SillyTavern.getContext();

// ---------- 那一格的几块在提示词里放哪（D-116） ----------
// 每一块是一个宏（{{rpe_rule}} {{rpe_base}} {{rpe_mid}} {{rpe_recall}} {{rpe_now}}），值在每次生成前由拦截器填、生成完就清。
// 用户把写着这些宏的条目放进 ST 的"提示词管理"（面板上一键加），就能像别的条目一样拖拽、改深度、在外面加自己的话；
// 当前预设里没有的那几块，按面板"提示词位置"里设的位置用扩展提示放。
const live = Object.fromEntries(SLOT_MACROS.map(k => [k, '']));
for (const k of SLOT_MACROS) { try { ctx().registerMacro?.(`rpe_${k}`, () => live[k] ?? '', '后台那一格（RP：幕后）'); } catch { /* 老版本 ST 没有宏：只用扩展提示 */ } }
// {{rpe_soft}}：只是个记号，展开成空。预设里写着它的那条（"收着点"）开着没开，告诉后台那一格里关心那几句要不要（用户 10/14：老模型开、新模型关）
try { ctx().registerMacro?.('rpe_soft', () => '', '记号：这份预设要不要"收着点"（RP：幕后）'); } catch { /* 老版本 ST 没有宏 */ }
// ST 自己的提示词管理（只在对话补全类的 API 下有）：动态取，取不到就只用扩展提示
let stPrompts = null;
let stWorldInfo = null;
import('../../../openai.js').then(m => { stPrompts = m; restoreCameraPrompts(); }).catch(() => {});
import('../../../world-info.js').then(m => { stWorldInfo = m; restoreCameraPrompts(); }).catch(() => {});
const promptManagerNow = () => stPrompts?.promptManager ?? null;
// ST 提示词管理里自带条目的中文叫法（面板上列次序用）
const ST_NAMES = { main: '主提示词', worldInfoBefore: '世界书（前）', worldInfoAfter: '世界书（后）', charDescription: '角色描述', charPersonality: '角色性格',
    scenario: '情景', personaDescription: '人设描述', dialogueExamples: '对话示例', chatHistory: '聊天记录', enhanceDefinitions: '增强定义', nsfw: '辅助提示词', jailbreak: '后历史指令' };
// 用户 10/5（照 ST 文档）：单纯的背景放在角色定义之前（跟在主提示词后面）；影响他怎么做的底子、想起的记忆放在角色定义之后、聊天记录之前（before）；
// 口袋和这一轮插在聊天里。
export const BLOCKS = [
    { id: 'rpe_world', name: 'RP：幕后·背景', content: '{{rpe_world}}', position: 0, anchor: 'main', help: '单纯的背景：这阵子外面的事、各方的账、听说的、世界的底色（放在角色定义之前）' },
    { id: 'rpe_base', name: 'RP：幕后·底子', content: '{{rpe_rule}}\n{{rpe_base}}', position: 0, before: 'chatHistory', help: '他在这一局里一直算数的、影响他怎么做的：说好的规矩、开局单里的口径和前事、地盘、和在场的人的关系、心里还没过去的（放在角色定义之后、聊天记录之前）' },
    { id: 'rpe_recall', name: 'RP：幕后·想起的', content: '{{rpe_recall}}', position: 0, before: 'chatHistory', help: '和眼下有关、想起来的：那几场经过、旧事、现状、惦记着的、眼下让他想起的以前那一回、行情和账（放在聊天记录之前）' },
    { id: 'rpe_mid', name: 'RP：幕后·口袋', content: '{{rpe_mid}}', position: 1, depth: 4, help: '后台排的、由他挑时候的事（幕后口袋）：放在最近两轮之前' },
    { id: 'rpe_now', name: 'RP：幕后·这一轮', content: '{{rpe_now}}', position: 1, depth: 4, help: '这一轮的事：今天说好的、玩家伸手接了的、兴头、有人来找、回来那一段、怎么接的提醒' },
];
// 当前预设里开着的、写着我们的宏的条目 → 哪几块交给预设
function coveredByPreset(identifiers = false) {
    const m = promptManagerNow(), out = new Set();
    if (!m?.serviceSettings || !m.activeCharacter) return out;
    const order = m.getPromptOrderForCharacter(m.activeCharacter);
    for (const p of m.serviceSettings.prompts ?? []) {
        const found = String(p.content ?? '').match(/\{\{rpe_(rule|world|base|mid|recall|now)\}\}/g);
        if (!found || !order.some(e => e.identifier === p.identifier && e.enabled)) continue;
        if (identifiers) out.add(p.identifier);
        else for (const x of found) out.add(x.slice(6, -2));
    }
    return out;
}

// 预设里写着 {{rpe_soft}} 的条目（"收着点"）：开着＝true（老模型，一关心就下指令，那一格里写明平辈、商量的口气）；
// 关着＝false（新模型本来就偏软，那几句收掉）；预设里没有这条＝null，后台照开着算（和以前一样）
function softFlag() {
    const m = promptManagerNow();
    if (!m?.serviceSettings || !m.activeCharacter) return null;
    const order = m.getPromptOrderForCharacter(m.activeCharacter);
    const marked = (m.serviceSettings.prompts ?? []).filter(p => String(p.content ?? '').includes('{{rpe_soft}}'));
    if (!marked.length) return null;
    return marked.some(p => order.some(e => e.identifier === p.identifier && e.enabled));
}

function settings() {
    const all = ctx().extensionSettings;
    all[MODULE] ??= {};
    all[MODULE].enabled ??= true;
    all[MODULE].cameraKeep ??= [];
    all[MODULE].cameraBooks ??= {};
    // 新开的窗口：ask＝问一次（默认），auto＝直接接入，off＝不管。旧设置里关掉过自动接入的按 off 算。
    all[MODULE].newChats ??= all[MODULE].autoJoinNew === false ? 'off' : 'ask';
    all[MODULE].cameraJoin ??= true;   // 有卡的人在场时旁白也接没卡的人的戏（场记章程 #7）
    all[MODULE].speakFirst ??= true;   // 离开很久回来时，由在场最亲近的角色先开口
    all[MODULE].digestOld ??= true;    // 发给前台时，较早的角色回复换成大意（N-231，治照抄上文）
    all[MODULE].digestKeep ??= 8;      // 最近这么多条角色回复照原文
    all[MODULE].loreFilter ??= true;   // ST 的世界书按开口的人筛（他不该知道的条目拿掉，N-252）
    return all[MODULE];
}

// 保存恢复表时带上预设和角色，切聊天后也不能把开关还给另一个人的表。
let cameraOrder = null;
let cameraSavePending = false;
function restoreCameraPrompts() {
    const saved = settings().cameraRestore;
    if (!saved) return;
    const m = promptManagerNow();
    let order = cameraOrder;
    if (!order && m?.serviceSettings && saved.preset === m.serviceSettings.preset_settings_openai) {
        order = m.serviceSettings.prompt_order?.find(e => String(e.character_id) === String(saved.characterId))?.order;
    }
    const selected = stWorldInfo?.selected_world_info;
    if (Array.isArray(saved.books) && !Array.isArray(selected)) return;
    if (Array.isArray(selected) && Array.isArray(saved.books)) for (const name of saved.books) if (!selected.includes(name)) selected.push(name);
    if (saved.groupNudge !== undefined && !stPrompts?.oai_settings) return;
    if (saved.groupNudge !== undefined && stPrompts?.oai_settings) stPrompts.oai_settings.group_nudge_prompt = saved.groupNudge;
    if (!order) return;
    for (const e of order) if (Object.hasOwn(saved.enabled ?? {}, e.identifier)) e.enabled = saved.enabled[e.identifier];
    cameraOrder = null;
    delete settings().cameraRestore;
    if (cameraSavePending) { cameraSavePending = false; saveExtensionSettings(); }
}
function isolateCameraPrompts(character) {
    const m = promptManagerNow();
    if (!m?.activeCharacter || settings().cameraRestore) return;
    const order = m.getPromptOrderForCharacter(m.activeCharacter);
    const { disable } = cameraPromptPlan(order, { keep: settings().cameraKeep, covered: coveredByPreset(true),
        hasPhi: !!character.data?.post_history_instructions?.trim() });
    const selected = stWorldInfo?.selected_world_info;
    const books = Array.isArray(selected) ? cameraBookPlan(selected, Object.entries(settings().cameraBooks ?? {}).map(([name, keep]) => ({ name, keep }))) : [];
    const groupNudge = stPrompts?.oai_settings?.group_nudge_prompt;
    settings().cameraRestore = { preset: m.serviceSettings.preset_settings_openai, characterId: m.activeCharacter.id,
        enabled: Object.fromEntries(order.map(e => [e.identifier, e.enabled])), books,
        ...(groupNudge !== undefined ? { groupNudge } : {}) };
    cameraOrder = order;
    for (const e of order) if (disable.includes(e.identifier)) e.enabled = false;
    if (Array.isArray(selected) && books.length) for (let i = selected.length - 1; i >= 0; i--) if (books.includes(String(selected[i]))) selected.splice(i, 1);
    if (stPrompts?.oai_settings && groupNudge !== undefined) stPrompts.oai_settings.group_nudge_prompt = '';
    // 这里不保存 ST 设置，否则临时关掉的预设也会跟着落盘。
}
function saveExtensionSettings() {
    if (cameraOrder) { cameraSavePending = true; return; }
    ctx().saveSettingsDebounced();
}

// 卡的正文（读卡写"兴趣和习惯"用，D-109）和它的指纹：正文变了才重读。指纹算法和后台 core/profile.mjs 的 cardHash 一致。
// 读卡用的正文：描述、性格、场景、对话示例，加卡里自带的角色书条目（往事多半写在那里，D-112）
const cardText = ch => [ch.description, ch.personality, ch.scenario, ch.mes_example,
    ...(ch.data?.character_book?.entries ?? []).filter(e => e && e.enabled !== false && typeof e.content === 'string').map(e => e.content)]
    .filter(x => typeof x === 'string' && x.trim()).join('\n\n');
function cardHash(text) {
    let h = 5381;
    const s = String(text ?? '');
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return `${s.length}:${(h >>> 0).toString(36)}`;
}

async function api(route, body, timeout = 30000) {
    const t0 = performance.now();
    let ok = false;
    try {
        const response = await fetch(`/api/plugins/rp-emergence/${route}`, {
            method: 'POST', headers: ctx().getRequestHeaders(), body: JSON.stringify(body), signal: AbortSignal.timeout(timeout),
        });
        backendConnection.observe(response.status);
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw Object.assign(new Error(data.error || String(response.status)), { status: response.status });
        ok = true;
        return data;
    } catch (error) { if (!error.status) backendConnection.observe(0); throw error; }
    finally { tick(`后台:${route}`, performance.now() - t0, ok ? '' : '失败'); }
}

const state = { epoch: 0, chatKey: null, syncing: false, dirty: false, timer: null, status: null, plan: null, planTimer: null, collapsed: null, note: '', door: { items: [], lit: null }, remote: null, entering: new Set() };

// 不依赖打开聊天：短暂启动失败先等两分钟，404 则直接告诉玩家插件没加载。
export function createBackendConnection({ request, now = Date.now, schedule = setTimeout, cancel = clearTimeout, changed = () => {} }) {
    let kind = 'starting', since = null, timer = null, busy = false, revision = 0;
    const view = () => ({ kind, backendDown: kind === 'missing' || kind === 'down' });
    const stop = () => { if (timer !== null) cancel(timer); timer = null; };
    const observe = status => {
        if (status >= 200 && status < 500 && status !== 404) { revision++; kind = 'healthy'; since = null; stop(); }
        else if (status === 404) { revision++; kind = 'missing'; since = null; stop(); }
        else {
            revision++; since ??= now(); kind = now() - since >= 120000 ? 'down' : 'starting';
            if (kind === 'down') stop();
            else if (timer === null) timer = schedule(() => { timer = null; void check(); }, 5000);
        }
        changed(view()); return view();
    };
    const check = async (reset = false) => {
        if (busy) return view();
        if (reset) { stop(); since = null; kind = 'starting'; changed(view()); }
        busy = true; const began = revision;
        try { const status = await request(); if (began === revision) observe(status); }
        catch { if (began === revision) observe(0); }
        finally { busy = false; }
        return view();
    };
    return { observe, check, view, stop };
}
const backendConnection = createBackendConnection({
    request: async () => (await fetch('/api/plugins/rp-emergence/health', { signal: AbortSignal.timeout(3000) })).status,
    changed: status => { state.backendStatus = status.kind; state.backendDown = status.backendDown; render(); },
});

const escapeHtml = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// ---------- 耗时（方案 自动进离场与调度 第四节"先量再改"；用户 10/16："扩展加载、拉人进、叩门等都很慢"）----------
// 每一步花了多久都记一笔（最近 300 笔）：后台请求按路由、同步、生成、拉人、开区间、那一格。面板"这一轮各步耗时"看；window.rpeTimings 也能读
const timings = [];
globalThis.rpeTimings = timings;
function tick(what, ms, note = '') {
    timings.push({ at: Date.now(), what, ms: Math.round(ms), note: String(note ?? '').slice(0, 60) });
    if (timings.length > 300) timings.splice(0, timings.length - 300);
}
async function showTimings() {
    let server = null;
    try { server = await api('timings', {}); } catch {}
    const rows = timings.slice(-60).reverse();
    const sum = new Map();
    for (const t of timings) { const s = sum.get(t.what) ?? { n: 0, ms: 0, max: 0 }; s.n++; s.ms += t.ms; s.max = Math.max(s.max, t.ms); sum.set(t.what, s); }
    const fmt = ms => (ms >= 1000 ? (ms / 1000).toFixed(1) + ' 秒' : Math.round(ms) + ' 毫秒');
    const html = `<h3>这一轮各步耗时</h3>
        <p><small>扩展这边：每一步从发起到拿到结果（含后台算的时间和等前面请求的时间）。后台那边：每个请求后台自己算了多久。两边一比就知道慢在算、还是慢在排队。</small></p>
        <h4>扩展：按步汇总</h4><table class="responsiveTable"><tr><th>步</th><th>次数</th><th>平均</th><th>最慢</th></tr>
        ${[...sum.entries()].sort((a, b) => b[1].ms - a[1].ms).map(([k, s]) => `<tr><td>${escapeHtml(k)}</td><td>${s.n}</td><td>${fmt(s.ms / s.n)}</td><td>${fmt(s.max)}</td></tr>`).join('')}</table>
        <h4>后台：按请求汇总</h4><table class="responsiveTable"><tr><th>请求</th><th>次数</th><th>平均</th><th>最慢</th></tr>
        ${(server?.byRoute ?? []).map(r => `<tr><td>${escapeHtml(r.route)}</td><td>${r.n}</td><td>${fmt(r.avg)}</td><td>${fmt(r.max)}</td></tr>`).join('') || '<tr><td colspan="4">后台没答</td></tr>'}</table>
        <h4>扩展：最近 60 笔</h4><table class="responsiveTable"><tr><th>时间</th><th>步</th><th>耗时</th><th>备注</th></tr>
        ${rows.map(t => `<tr><td>${new Date(t.at).toLocaleTimeString()}</td><td>${escapeHtml(t.what)}</td><td>${fmt(t.ms)}</td><td>${escapeHtml(t.note)}</td></tr>`).join('')}</table>`;
    await ctx().callGenericPopup(html, ctx().POPUP_TYPE.TEXT, '', { wide: true, large: true, allowVerticalScrolling: true });
}

// 记账进度：开着且还有待记的，就隔一会儿刷新一次。
async function refreshPlan() {
    clearTimeout(state.planTimer);
    if (!state.chatKey) return;
    const epoch = state.epoch;
    try {
        const plan = await api('extract-plan', { chatKey: state.chatKey });
        if (epoch !== state.epoch) return;
        state.plan = plan; state.dailyBudget = plan.dailyBudgetUsd;
        if (plan.enabled && plan.pendingMessages > 0) state.planTimer = setTimeout(refreshPlan, 10000);
    } catch { state.plan = null; }
    render();
}

async function refreshDoor() {
    if (!state.chatKey || !settings().enabled || auto.on !== false) { state.door = { items: [], lit: null }; render(); return; }
    const c = ctx(), present = members(c).filter(m => !m.disabled).map(m => m.name).filter(Boolean);
    const recentUser = [...(c.chat ?? [])].reverse().find(m => m.is_user)?.mes ?? '';
    try {
        const r = await api('door', { chatKey: state.chatKey, present, recentUser });
        if (state.chatKey) state.door = r;
    } catch { state.door = { items: [], lit: null }; }
    render();
}

const TYPE_ORDER = ['改变', '想法', '了结', '钱', '关系', '说', '心里', '做', '时间'];
async function showRecords(rejected = false) {
    const { records } = await api('records', { chatKey: state.chatKey, rejected });
    const rows = records.map(r => {
        // 对账：被后面的账改掉的划线（以后不算数）；问了、要了有答复的标"已答"
        const gone = r.superseded_by ? `〔第 ${r.superseded_by.pos} 条改掉了〕` : '';
        const extra = [r.lasting && '一直算数', r.duration && `持续：${r.duration}`, r.elapsed && `过了：${r.elapsed}`, r.tense, r.todo && (r.closed_by ? `待办（第 ${r.closed_by.pos} 条答了）` : '待办'), r.fabricated && '对外编的说法', r.reason && `被拦原因：${r.reason}`].filter(Boolean).join(' · ');
        return `<div style="margin:.6em 0;padding:.4em .6em;border-left:3px solid var(--SmartThemeQuoteColor,#888)${gone ? ';opacity:.6' : ''}">
            <div><b>#${r.pos}</b> 〔${escapeHtml(r.type)}〕${gone ? `<s>${escapeHtml(r.text)}</s> ${gone}` : escapeHtml(r.text)}</div>
            <div style="opacity:.85">${r.quotes.map(q => `「${escapeHtml(q)}」`).join(' ')}</div>
            <small style="opacity:.7">${escapeHtml(r.holder_name ?? r.holder)}的说法 · 在场：${escapeHtml(r.audience.join('、'))}${extra ? ' · ' + escapeHtml(extra) : ''}</small></div>`;
    });
    const counts = TYPE_ORDER.map(t => `${t} ${records.filter(r => r.type === t).length}`).join(' · ');
    const html = `<h3>${rejected ? '被拦下的记录' : '后台记住了什么'}（${records.length} 条）</h3><p><small>${counts}</small></p>${rows.join('') || '<p>还没有。</p>'}`;
    await ctx().callGenericPopup(html, ctx().POPUP_TYPE.TEXT, '', { wide: true, large: true, allowVerticalScrolling: true });
}

// 场次摘要（N-284）：一场一段经过，以后被问起"那天都干了什么"照这个说，只给当时在场的人。能改；还没写到的可以现在补写（便宜模型，一场一两美分以内）。
async function showEpisodes(run = false) {
    const c = ctx();
    const r = await api('episodes', { chatKey: state.chatKey, ...(run ? { run: true } : {}) }, run ? 300000 : 30000);
    const box = document.createElement('div');
    const upto = r.episodes.length ? r.episodes.at(-1).to + 1 : 0;
    box.innerHTML = `<h3>剧情总览（${r.episodes.length} 场）</h3>
        <p><small>后台照原文分场写的经过：以后角色被问起"昨晚""那天"干了什么，就照这个说；只给当时在场的人。那段里删了、改了哪条，这一场作废、重写。
        你改了点"保存"，那几条消息不变就一直用你改的。写到第 ${upto} 条，共 ${r.total} 条（最近几条等一场收尾再写）。</small></p>
        ${r.ran ? `<p><small>${r.ran.off ? '场次摘要没开，或者"兴头（看场面）"那一档没配钥匙。' : `刚补写了 ${r.ran.written} 场。`}</small></p>` : ''}`
        + (r.episodes.map(e => `<div style="margin:.7em 0" data-ep="${e.id}">
            <div><b>#${e.from}～#${e.to}</b> ${escapeHtml(e.when)}${e.place ? ` · ${escapeHtml(e.place)}` : ''} <small style="opacity:.75">在场：${escapeHtml(e.present.join('、'))}${e.edited ? ' · 你改过' : ''}</small></div>
            <textarea class="text_pole" rows="4" style="width:100%" data-old="${escapeHtml(e.text)}">${escapeHtml(e.text)}</textarea></div>`).join('') || '<p>还没有。</p>');
    const res = await c.callGenericPopup(box, c.POPUP_TYPE.CONFIRM, '', { wide: true, large: true, allowVerticalScrolling: true, okButton: '保存', cancelButton: '关闭',
        customButtons: [{ text: '现在补写', result: c.POPUP_RESULT.CUSTOM1 }] });
    if (res === c.POPUP_RESULT.CUSTOM1) { globalThis.toastr?.info('在补写，大概几十秒。', 'RP：幕后'); return showEpisodes(true); }
    if (!res) return;
    const changed = [...box.querySelectorAll('[data-ep]')].map(d => ({ id: Number(d.dataset.ep), el: d.querySelector('textarea') })).filter(x => x.el.value.trim() && x.el.value !== x.el.dataset.old);
    for (const x of changed) await api('episode-edit', { chatKey: state.chatKey, id: x.id, text: x.el.value.trim() });
    if (changed.length) globalThis.toastr?.success(`改了 ${changed.length} 场。`, 'RP：幕后');
}

// 名册：这个局里每个人算哪一档，还没出场的人什么情况下会找上门（钩子）。
const ROLE_NOTES = { 主要: '一直在场；你不在的日子里照样过', 常联系: '会主动关心、有事会来找', 路过: '只在被找时回应，不主动关心', 新面孔: '没有卡、这一局里新长出来的人（规划要用的，或每条总结里反复出现的）：能牵头、会来找、有亲疏', 可能登场: '还没出场；写了钩子才会找上门', 不用: '不属于这个故事，或是旧版本' };
async function editCast() {
    const { roles, cast } = await api('cast', { chatKey: state.chatKey });
    const box = document.createElement('div');
    const order = r => roles.indexOf(r.role);
    const near = e => e.closeness ? `${e.closeness.level} ${e.closeness.score}` : '';
    const row = e => `
        <div style="display:flex;flex-wrap:wrap;gap:.5em;align-items:center;margin:.35em 0" data-avatar="${escapeHtml(e.avatar)}">
          <span style="flex:0 0 11em;overflow-wrap:anywhere">${escapeHtml(e.name)}</span>
          <select class="text_pole" data-field="role" style="flex:0 0 7em">${roles.map(r => `<option${r === e.role ? ' selected' : ''}>${r}</option>`).join('')}</select>
          <select class="text_pole" data-field="gender" title="性别">${['', '男', '女'].map(g => `<option value="${g}"${(e.gender ?? '') === g ? ' selected' : ''}>${g || '不写'}</option>`).join('')}</select>
          <select class="text_pole" data-field="bond" style="flex:0 0 4.5em" title="基础亲疏">${['', 0, 1, 2, 3, 4, 5].map(v => `<option value="${v}"${String(e.bond ?? '') === String(v) ? ' selected' : ''}>${v === '' ? '默认' : v}</option>`).join('')}</select>
          <small style="flex:0 0 6em;opacity:.8">${escapeHtml(near(e))}</small>
          <input class="text_pole" data-field="hook" style="flex:1" placeholder="钩子（可空）：什么情况下会来找" value="${escapeHtml(e.hook ?? '')}">
          <label style="flex:0 0 auto"><input type="checkbox" data-field="priority"${e.priority ? ' checked' : ''}> 优先</label>
          ${String(e.avatar).startsWith('face:') ? `<label><input type="checkbox" data-field="group"${e.群体 ? ' checked' : ''}> 一群人</label>` : ''}
          ${e.promote ? `<small data-promotion>戏份多了，要不要给 TA 建张卡？ <button type="button" class="menu_button" data-dismiss-promotion="${escapeHtml(e.avatar)}" title="忽略这次建卡提示，建议确认不需要再点。">不用</button></small>` : ''}
        </div>
        <div style="margin:0 0 .6em 11.5em" data-interests="${escapeHtml(e.avatar)}">
          <textarea class="text_pole" data-field="interests" rows="2" style="width:100%;font-size:.9em" placeholder="兴趣和习惯（读卡写的，可改；空着＝还没读或卡里没写）">${escapeHtml(e.interests ?? '')}</textarea>
        </div>`;
    const sorted = [...cast].sort((a, b) => order(a) - order(b) || (b.closeness?.score ?? 0) - (a.closeness?.score ?? 0) || a.name.localeCompare(b.name));
    const groups = rosterGroups(sorted);
    box.innerHTML = '<h3>名册</h3><details><summary>档位与亲疏说明</summary>' + roles.map(r => '<p><b>' + r + '</b>：' + (ROLE_NOTES[r] ?? '') + '</p>').join('') + '<small>基础亲疏加上聊天里的来往和关系变化，每次打开现算。</small></details>'
        + '<h4>有卡的</h4>' + (groups.cards.map(row).join('') || '<small>没有</small>')
        + '<h4>没卡的（旁白演）</h4>' + (groups.faces.map(row).join('') || '<small>没有</small>')
        + '<details><summary>其他卡 · ' + groups.other.length + '（不在这一局，默认不用）</summary><small>不列进场面纠正、不会被规划叫出来；改档位就拉进这一局。</small>' + groups.other.map(row).join('') + '</details>';
    box.addEventListener('click', async event => {
        const button = event.target.closest('[data-dismiss-promotion]');
        if (!button) return;
        try { await api('cast', { chatKey: state.chatKey, dismissPromotion: button.dataset.dismissPromotion }); button.closest('[data-promotion]').remove(); }
        catch (error) { globalThis.toastr?.error(error.message); }
    });
    const ok = await ctx().callGenericPopup(box, ctx().POPUP_TYPE.CONFIRM, '', { wide: true, large: true, allowVerticalScrolling: true, okButton: '保存', cancelButton: '取消' });
    if (!ok) return;
    const interestsOf = avatar => [...box.querySelectorAll('[data-interests]')].find(x => x.dataset.interests === avatar)?.querySelector('textarea')?.value ?? '';
    const set = [...box.querySelectorAll('[data-avatar]')].map(row => ({
        avatar: row.dataset.avatar, gender: row.querySelector('[data-field="gender"]').value, role: row.querySelector('[data-field="role"]').value, hook: row.querySelector('[data-field="hook"]').value,
        priority: row.querySelector('[data-field="priority"]').checked, bond: row.querySelector('[data-field="bond"]').value,
        群体: row.querySelector('[data-field="group"]')?.checked,
    })).map(e => { const old = cast.find(c => c.avatar === e.avatar); const text = interestsOf(e.avatar); return old && text.trim() !== (old.interests ?? '').trim() ? { ...e, interests: text } : e; })
        .filter(e => { const old = cast.find(c => c.avatar === e.avatar); return old && ('interests' in e || (old.gender ?? '') !== e.gender || old.role !== e.role || (old.hook ?? '') !== e.hook || !!old.priority !== e.priority || !!old.群体 !== !!e.群体 || String(old.bond ?? '') !== e.bond); });
    if (set.length) await api('cast', { chatKey: state.chatKey, set });
}

// 账本：谁欠谁、按期给的、谈着的价、最近的进出（只算记录里写明金额的）。
async function showLedger() {
    const l = await api('ledger', { chatKey: state.chatKey });
    const money = n => `${Number(n).toLocaleString('en-US')}${l.currency ? ' ' + escapeHtml(l.currency) : ''}`;
    const who = r => `${escapeHtml(r.from)} → ${escapeHtml(r.to)}`;
    const block = (title, rows, line) => rows.length ? `<h4>${title}</h4>${rows.map(r => `<div style="margin:.3em 0"><b>${line(r)}</b> <small style="opacity:.75">#${r.pos} ${escapeHtml(r.text)}</small></div>`).join('')}` : '';
    const html = `<h3>账本</h3><p><small>只算记录里写明金额的；报价不算成交，说定不算付了。</small></p>`
        + ((l.left ?? []).length ? `<h4>手上还剩多少</h4>${l.left.map(t => `<div style="margin:.3em 0">${escapeHtml(t)}</div>`).join('')}` : '<p><small>开局单"钱"那一格写上开场时谁手上有多少，这里就能算出现在还剩多少。</small></p>')
        + block('欠着的', l.debts, r => `${who(r)} ${money(r.left ?? r.amount)}`)
        + block('说定了的（含按期给的）', l.deals, r => `${who(r)} ${money(r.amount)}${r.every ? ' · ' + escapeHtml(r.every) : ''}`)
        + block('开过价、还没成的', l.quotes, r => `${who(r)} ${money(r.amount)}`)
        + block('进出', l.moves.slice(-12).reverse(), r => `${who(r)} ${money(r.amount)} · ${escapeHtml(r.stage)}`)
        + (l.debts.length + l.deals.length + l.quotes.length + l.moves.length ? '' : '<p>还没有写明金额的钱的事。</p>');
    await ctx().callGenericPopup(html, ctx().POPUP_TYPE.TEXT, '', { wide: true, allowVerticalScrolling: true });
}

async function showPending() {
    const r = await api('pending', { chatKey: state.chatKey });
    const groups = new Map([['排着', []], ['到了', []], ['过了时候', []], ['等着', []], ['递过', []], ['用上了', []], ['办了', []], ['改了', []], ['黄了', []], ['过去了', []], ['沉了', []], ['过期了', []], ['撤了', []], ['失效', []]]);
    for (const item of r.items ?? []) (groups.get(item.status) ?? groups.get('排着')).push(item);
    const order = ['排着', '到了', '过了时候', '等着', '递过', '用上了', '办了', '改了', '黄了', '过去了', '沉了', '过期了', '撤了', '失效'];
    const html = `<h3>约定历史</h3>${order.map(status => {
        const rows = groups.get(status) ?? [];
        if (!rows.length) return '';
        const body = rows.map(x => `<div style="margin:.35em 0"><b>${escapeHtml(x.kind)} · ${escapeHtml(x.status)} @第${escapeHtml(x.statusAt ?? x.since)}条</b> ${escapeHtml(x.text)}${x.why ? ` <small style="opacity:.75">${escapeHtml(x.why)}</small>` : ''}${x.next?.text ? `<br><small style="opacity:.85">${escapeHtml(x.next.label ?? '')}：${escapeHtml(x.next.text)}</small>` : ''}</div>`).join('');
        return ['办了', '改了', '黄了', '过去了', '沉了', '过期了', '撤了', '失效'].includes(status) ? `<details><summary>${status}（${rows.length}）</summary>${body}</details>` : `<h4>${status}</h4>${body}`;
    }).join('') || '<p>还没有。</p>'}`;
    await ctx().callGenericPopup(html, ctx().POPUP_TYPE.TEXT, '', { wide: true, allowVerticalScrolling: true });
}

// 后台给的一句不剧透的提示（比如剧情转向、重新规划了）：蓝色轻提示，每条只提示一次（记在本机，刷新页面也不重复）。
export function planAttemptsHtml(planning, esc) {
    const entries = { auto: '自动', button: '按钮', supplement: '补规划', handoff: '外援交回', repair: '修格式' };
    const kinds = { thinking: '想的吃光了', limit: '写到上限还没写完', format: '格式待修' };
    const rows = (planning?.attempts ?? []).map(a => `<tr><td>${esc(a.attemptId)}<br>规划 ${esc(String(a.planId))}</td><td>${esc(entries[a.entry] ?? a.entry)}</td><td>${esc(a.model ?? '未知')}<br>思考${a.thinks ? '开' : '关'}</td><td>${a.briefChars} / ${a.outputChars}</td><td>${(a.ms / 1000).toFixed(1)} 秒</td><td>${esc(a.stage)}<br>${esc(a.status)}</td><td>${esc(a.finishReason ?? '未知')}</td><td>${esc(a.failure ?? '无')}</td><td>${a.internalRetries}</td><td>${esc(kinds[a.partialKind] ?? '')}${a.hasPartial ? `<button type="button" class="menu_button" data-plan-partial="${esc(a.attemptId)}" title="只读查看已保存半截，建议规划失败时查。">看半截全文</button>` : ''}${a.repaired ? ' · 自动修过格式' : ''}</td></tr>`).join('');
    return `<h3>最近 20 次规划尝试</h3><p><small>每行是一次逻辑尝试，内部重发另计次数；正文只在本机数据库里；有半截的可以点开看。</small></p><table><thead><tr><th>尝试 / 规划</th><th>入口</th><th>型号 / 思考</th><th>简报 / 输出字数</th><th>耗时</th><th>阶段 / 状态</th><th>结束原因</th><th>失败类别</th><th>内部重发</th><th>半截与格式</th></tr></thead><tbody>${rows || '<tr><td colspan="10">还没有记录</td></tr>'}</tbody></table>`;
}
function noticeStory(chatKey, notice) {
    if (!notice?.id || !notice.text) return;
    const key = `rp_emergence_notice:${chatKey}`;
    let seen = null;
    try { seen = globalThis.localStorage?.getItem(key); } catch {}
    if (seen === notice.id || state.noticeSeen?.[chatKey] === notice.id) return;
    state.noticeSeen = { ...(state.noticeSeen ?? {}), [chatKey]: notice.id };
    try { globalThis.localStorage?.setItem(key, notice.id); } catch {}
    globalThis.toastr?.info(notice.text, '', { timeOut: 8000 });
}

// 离开很久回来：后台记下这次离开、推各人这些天做了什么（一两分钟），好了由在场最亲近的角色先开口。
// 每次离开只做一次（开口之后后台就不再当它是"刚回来"）；这期间窗口换了、或者用户自己先发了话，就不抢。
async function checkReturn(chatKey, epoch) {
    let r;
    try { r = await api('return', { chatKey }); } catch { return; }
    if (!r?.away || epoch !== state.epoch) return;
    const who = r.first?.name ?? '角色';
    const lengthAtStart = ctx().chat.length;
    const told = `离开了 ${r.days} 天。后台在推这些天身边的人做了什么`;
    globalThis.toastr?.info(settings().speakFirst ? `${told}，好了由${who}先开口。` : `${told}。`, '', { timeOut: 10000 });
    for (let i = 0; i < 80 && r.status === 'working'; i++) {   // 至多等五分多钟（中转慢的时候推演要两三分钟）
        await new Promise(resolve => setTimeout(resolve, 4000));
        if (epoch !== state.epoch) return;
        try { r = await api('return', { chatKey }); } catch { return; }
        if (!r.away) return;
    }
    if (!settings().speakFirst || !r.first || epoch !== state.epoch || ctx().chat.length !== lengthAtStart) return;
    const c = ctx();
    await c.executeSlashCommandsWithOptions(c.groupId ? `/trigger await=true ${r.first.name}` : '/trigger await=true');
}

// 删回去以后后台自己对账（方案 删消息等于没发生过）：重算的和那条当时的样子对不上，亮出来（后台日志里也有）
function driftHtml(d) {
    if (!d?.lines?.length) return '';
    return `<div style="color:var(--warning,#d33)">删回到第 ${d.at} 条以后，后台算出来的和那条当时的样子有 ${d.lines.length} 处对不上（多半是哪一环没跟着撤）：`
        + d.lines.map(l => `<div style="margin-left:.8em">· ${escapeHtml(l)}</div>`).join('')
        + ` <button class="menu_button" type="button" data-action="drift-clear" title="清除变化预览，建议核对后再用。">知道了</button></div>`;
}

// 外援队列件数变多了：轻提示一次（后台调模型没响应，活已经写成外援包等 AI 窗口接手）。
async function refreshHandoffs() {
    try { state.handoffUi = await api('handoff-ui', { action: 'list' }); } catch { state.handoffUi = null; }
    if (state.relationsDraft?.status === 'handoff') void refreshRelationsDraft();
    render();
}
function noticeHandoffs(n = 0) {
    if (n) refreshHandoffs();
    if (n > (state.handoffs ?? 0)) globalThis.toastr?.warning(`后台有 ${n} 件活调模型没响应，放进了外援队列。打开“此刻 → 外援”，复制题目贴给任何一个 AI（网页版也行），把它的回答贴回来点“交回”。`, 'RP：幕后', { timeOut: 12000 });
    state.handoffs = n;
}

// ---------- 跟后台说话（N-104，白皮书 §3.4） ----------
// 一个对话框：问记下的事、指出哪条记错了、商量方向。不进聊天记录，角色看不到。后台答完（调一次模型）会把要改的东西
// 先说成"我理解为……"，每条下面"记／不记"，点了"记"才写。对话存在后台，下次打开接着聊。
async function openTalk(first = '') {
    const c = ctx(), chatKey = state.chatKey;
    if (!chatKey) return;
    let v;
    try { v = await api('talk', first ? { chatKey, text: first } : { chatKey }); }
    catch (error) { globalThis.toastr?.warning(error.status === 400 ? '后台版本旧了，先在面板上更新。' : '后台暂时连不上。'); return false; }
    let timer = null, dlg = null;
    const bubble = t => `<div style="margin:.5em 0;text-align:right"><span style="display:inline-block;padding:.3em .6em;border-radius:8px;border:1px solid var(--SmartThemeBorderColor,#666);max-width:85%;text-align:left;white-space:pre-wrap">${escapeHtml(t.text)}</span></div>`;
    const card = (t, ti) => `<div style="margin:.5em 0"><div style="white-space:pre-wrap">${escapeHtml(t.text)}</div>${(t.proposals ?? []).map((p, i) => `<div style="margin:.35em 0;padding:.3em .5em;border-left:3px solid var(--SmartThemeQuoteColor,#e88)"><div>${escapeHtml(p.say)}</div>${p.status === 'proposed'
        ? `<div class="flex-container" style="gap:4px;margin-top:.2em"><div class="menu_button" data-talk-apply="${ti}:${i}" style="width:auto;white-space:nowrap" title="写入这项提议，建议逐条核对。">记</div><div class="menu_button" data-talk-skip="${ti}:${i}" style="width:auto;white-space:nowrap" title="拒绝这项提议，建议不合适时点。">不记</div></div>`
        : `<small style="opacity:.7">${p.status === 'done' ? '已记' : '没记'}</small>`}</div>`).join('')}</div>`;
    const draw = () => {
        if (!dlg) return;
        const log = dlg.querySelector('[data-role="talk-log"]');
        log.innerHTML = (v.turns.length ? v.turns.map((t, ti) => (t.role === 'user' ? bubble(t) : card(t, ti))).join('') : '<small style="opacity:.7">还没说过话。</small>')
            + (v.pending ? '<div style="opacity:.7;margin:.4em 0">后台在想……（一般半分钟到一分钟）</div>' : '')
            + (v.error ? `<div style="color:var(--warning,orange);margin:.4em 0">没答上：${escapeHtml(v.error)}</div>` : '');
        log.scrollTop = log.scrollHeight;
        dlg.querySelector('[data-role="talk-send"]').classList.toggle('disabled', !!v.pending);
    };
    const poll = () => {
        clearTimeout(timer);
        if (v.pending && dlg) timer = setTimeout(async () => { try { v = await api('talk', { chatKey }); } catch {} draw(); poll(); }, 2500);
    };
    const html = `<h3>任意调整</h3><p><small>不进聊天记录，角色看不到。它看不到幕后排着的事，不剧透；提议的改动要你点“记”才写。每说一句会调模型。</small></p><ul><li>问已经记下的事，比如某人知道那封信是谁写的吗。</li><li>指出某条总结记错了，提议改掉或作废。</li><li>定一件以后每轮都算数的事，避免前台总写反。</li><li>说想让剧情往哪走，规划会据此重排一次。</li><li>说这阵子想怎么玩、什么口味。</li></ul>
        <div data-role="talk-log" style="max-height:50vh;overflow-y:auto;text-align:left;border:1px solid var(--SmartThemeBorderColor,#555);border-radius:6px;padding:.4em .6em;margin:.4em 0"></div>
        <textarea class="text_pole" data-role="talk-input" rows="3" style="width:100%" placeholder="比如：第 230 条那里记错了，那天没去码头"></textarea>
        <div class="flex-container" style="justify-content:flex-end;gap:4px"><div class="menu_button" data-role="talk-clear" style="width:auto;white-space:nowrap" title="清空调整对话，建议保留重要结果。">清空对话</div><div class="menu_button" data-role="talk-send" style="width:auto;white-space:nowrap;padding:0 1.2em" title="向后台提问或提议，会调模型，按需用。">说</div></div>`;
    await c.callGenericPopup(html, c.POPUP_TYPE.TEXT, '', {
        okButton: '关闭', wide: true, allowVerticalScrolling: true, leftAlign: true,
        onOpen: popup => {
            dlg = popup.dlg;
            dlg.addEventListener('click', async e => {
                const a = e.target.closest('[data-talk-apply],[data-talk-skip],[data-role="talk-send"],[data-role="talk-clear"]');
                if (!a || a.classList.contains('disabled')) return;
                e.preventDefault();
                try {
                    if (a.dataset.role === 'talk-send') {
                        const box = dlg.querySelector('[data-role="talk-input"]'), t = box.value.trim();
                        if (!t) return;
                        box.value = '';
                        v = await api('talk', { chatKey, text: t });
                    } else if (a.dataset.role === 'talk-clear') v = await api('talk', { chatKey, clear: true });
                    else {
                        const [turn, i] = String(a.dataset.talkApply ?? a.dataset.talkSkip).split(':').map(Number);
                        v = await api('talk', { chatKey, apply: { turn, i, skip: a.dataset.talkSkip != null } });
                        if (a.dataset.talkApply != null) { refreshPlanStatus(); scheduleSync(0); }
                    }
                } catch (error) { globalThis.toastr?.warning(error.message || '后台暂时连不上。'); }
                draw(); poll();
            });
            draw(); poll();
        },
        onClose: () => { clearTimeout(timer); dlg = null; },
    });
    return true;
}

// ---------- 开局单 ----------
// 贴一整段 → 后台分格（一两分钟，好了会提醒）→ 你核对、改、确认；确认后从现在起生效，随时能改。按局存，不写进卡和书。

async function textPopup(title, note, value, { ok, cancel, extra = null, rows = 22 }) {
    const c = ctx();
    let text = value;
    const html = `<h3>${title}</h3><p><small>${note}</small></p><textarea class="text_pole" data-role="setup-text" rows="${rows}" style="width:100%;font-family:inherit;line-height:1.5">${escapeHtml(value)}</textarea>`;
    const result = await c.callGenericPopup(html, c.POPUP_TYPE.TEXT, '', {
        okButton: ok, cancelButton: cancel, wide: true, large: true, allowVerticalScrolling: true,
        customButtons: extra ? [{ text: extra, result: c.POPUP_RESULT.CUSTOM1 }] : null,
        onClosing: popup => { text = popup.dlg.querySelector('[data-role="setup-text"]')?.value ?? text; return true; },
    });
    return { result, text };
}

// 开局单的四个口（开局单设计稿 §四）：填表（必填只有基调和剧情类别）；贴一整段让后台分格；看和改全文；上传素材。
async function openSetup() {
    const c = ctx(), chatKey = state.chatKey;
    const s = await api('setup', { chatKey });
    if (s.draft?.status === 'working') { globalThis.toastr?.info('还在分格，好了会提醒。'); watchSetup(chatKey); return; }
    if (s.draft?.status === 'handoff') { globalThis.toastr?.warning(`调模型分格没响应，${s.draft.error}。打开“此刻 → 外援”，复制题目贴给任何一个 AI（网页版也行），把回答贴回来点“交回”，然后再核对开局单。`); watchSetup(chatKey); return; }
    if (s.draft?.status === 'failed') globalThis.toastr?.warning(`上次没分成：${s.draft.error}`);
    const draft = !!s.draft?.text, has = draft || !!s.confirmed?.text;
    const status = draft ? `后台分好的草稿还没核对${s.draft.unchecked ? `（${s.draft.unchecked} 条在原文里没找到对应的话）` : ''}。`
        : s.confirmed ? `现在生效的是 ${new Date(s.confirmed.at).toLocaleString()} 确认的那份${s.confirmed.data?.节奏 ? `（故事节奏：${s.confirmed.data.节奏}）` : ''}。` : '这一局还没有开局单。';
    const html = `<h3>开局单</h3><p>${status}</p>${(s.intimateWarnings ?? []).map(w => `<p><small>${escapeHtml(w)}</small></p>`).join('')}<p><small>填表：必填只有基调和剧情类别，其余都能空着。贴一整段：大纲、开场稿都行，后台替你分到各格、你再核对。上传素材：txt、md、json、csv，后台看一眼说该当开局单、关系表还是参考资料，你点头才处理。</small></p>`;
    const r = await c.callGenericPopup(html, c.POPUP_TYPE.TEXT, '', {
        okButton: false, cancelButton: '关闭',
        customButtons: [...(has ? [{ text: draft ? '核对草稿' : '看和改全文', result: c.POPUP_RESULT.CUSTOM1 }] : []),
            { text: '填表', result: c.POPUP_RESULT.CUSTOM2 }, { text: '贴一整段', result: c.POPUP_RESULT.CUSTOM3 }, { text: '上传素材', result: c.POPUP_RESULT.CUSTOM4 }],
    });
    if (r === c.POPUP_RESULT.CUSTOM1) return openSetupText(s);
    if (r === c.POPUP_RESULT.CUSTOM2) return openSetupForm(s);
    if (r === c.POPUP_RESULT.CUSTOM3) return pasteSetup(chatKey);
    if (r === c.POPUP_RESULT.CUSTOM4) return openMaterials();
}

// 确认后的回执：各段去了哪（谁看得到、什么时候用）
async function showReceipt(lines) {
    void refreshRelationsDraft();
    if (!lines?.length) { globalThis.toastr?.success('开局单已生效。'); return; }
    await ctx().callGenericPopup(`<h3>开局单已生效</h3><p><small>从现在起算数，随时能改。各段去了哪：</small></p><ul style="text-align:left">${lines.map(l => `<li>${escapeHtml(l)}</li>`).join('')}</ul>`, ctx().POPUP_TYPE.TEXT, '', { allowVerticalScrolling: true });
}

async function relationCardsFor(chatKey) {
    const { cast } = await api('cast', { chatKey });
    const chars = new Map((ctx().characters ?? []).map(c => [c.avatar, c]));
    let room = 120000;
    return [...cast].filter(c => c.role !== '不用' && !String(c.avatar).startsWith('face:')).sort((a,b) => Number(b.role === '主要')-Number(a.role === '主要')).flatMap(person => {
        const c = chars.get(person.avatar); if (!c) return [];
        const raw = [c.description, c.personality, c.scenario].filter(x => typeof x === 'string' && x.trim()).join('\n');
        const cap = Math.min(3000, room), marker = '（后面略）';
        const text = raw.length > cap ? (cap >= marker.length ? raw.slice(0, cap-marker.length)+marker : '') : raw;
        room -= text.length;
        return [{ avatar: person.avatar, text, sourceChars: raw.length }];
    });
}

async function refreshRelationsDraft() {
    clearTimeout(state.relationsTimer);
    const chatKey = state.chatKey, epoch = state.epoch;
    if (!chatKey) return;
    try {
        const r = await api('relations', { chatKey });
        if (chatKey !== state.chatKey || epoch !== state.epoch) return;
        state.relationsDraft = r.draft ?? null; render();
        if (['working', 'handoff'].includes(r.draft?.status)) state.relationsTimer = setTimeout(refreshRelationsDraft, r.draft.status === 'working' ? 2000 : 10000);
    } catch { /* 下次打开窗口或同步时再查，不影响聊天。 */ }
}

export function relationsDraftHtml(d, escape = s => s) {
    if (!d) return '';
    if (d.status === 'drafted') return `<button class="menu_button" type="button" data-action="relations-draft" title="核对自动草稿，保存后才生效。">关系表草稿好了（${d.people} 人），点开核对</button><small>这次起草花了约 $${Number(d.costUsd ?? 0).toFixed(4)}${d.via === 'handoff' ? '（不含外援费用）' : ''}${d.truncatedChars ? `；输入截短了 ${d.truncatedChars} 字` : ''}</small>`;
    if (d.status === 'working') return '<small>关系表正在起草，核对保存才生效。</small>';
    if (d.status === 'handoff') return '<small>关系表起草没响应，已放进外援；交回后仍要核对保存。</small>';
    return `<small>${escape(d.reason ?? '关系表还没起好，可手写或从素材整理')}</small>`;
}

// 故事节奏（章程 H2）：快／中／慢，选了旁边小字说这一档是什么样
const PACE_HINT = { 慢: '一格时间排一件左右，留白多，一场戏只叠一件，事情放得久才沉。', 中: '默认：一格时间两三件。', 快: '一格时间排四五件，事接着事。快档跳过时间会掉一堆事。' };
const CATEGORIES = ['爱情', '友情', '亲情', '群像', '热血', '日常', '冒险', '悬疑', '喜剧', '悲剧', '成长', '单人'];
// 人物开场状态（用户 10/9）：每行 谁｜哪一类｜是什么｜还有谁知道。住处、家里、衣服、东西归生活现状，钱归钱（后台分到各格）
const OPEN_ROW_KINDS = [['在哪', '在哪、在干什么'], ['身体', '身体'], ['心事', '心事、情绪'], ['手头的事', '手头的事'], ['约定', '开场前的约定'], ['欠账', '欠账'], ['名声', '名声'],
    ['住处', '住处'], ['家里', '家里的样子'], ['衣服', '衣服'], ['东西', '东西（车、资产）'], ['钱', '手上的钱']];
const OPEN_ROW_HINT = { 在哪: '角色甲开场在地点乙值夜班', 身体: '左手旧伤没好，靠药撑着', 心事: '刚吵过一架，还在气头上', 手头的事: '在替人查一笔账，等对方回话', 约定: '答应周五陪角色丙去地点乙',
    欠账: '欠角色丙两千', 名声: '在某个圈子里出了名的不好惹', 住处: '城东一间单身公寓', 家里: '双人床、坏了的暖气', 衣服: '一件旧皮夹克', 东西: '一辆修了一半的车，停在楼下', 钱: '五千' };
function openRowHtml(r = {}) {
    const kind = OPEN_ROW_KINDS.some(([k]) => k === r.类) ? r.类 : '在哪';
    const knows = Array.isArray(r.谁知道) ? r.谁知道.join('、') : String(r.谁知道 ?? '');
    return `<div data-row style="display:flex;flex-wrap:wrap;gap:.3em;align-items:center;margin:.2em 0" data-orig="${escapeHtml(r.原来 ? JSON.stringify(r.原来) : '')}">
        <input class="text_pole" data-r="谁" placeholder="谁" style="flex:0 0 7em" value="${escapeHtml(r.谁 ?? '')}">
        <select class="text_pole" data-r="类" style="flex:0 0 auto;width:auto">${OPEN_ROW_KINDS.map(([k, label]) => `<option value="${k}" ${k === kind ? 'selected' : ''}>${label}</option>`).join('')}</select>
        <input class="text_pole" data-r="是" placeholder="${escapeHtml(OPEN_ROW_HINT[kind])}" style="flex:1 1 12em" value="${escapeHtml(r.是 ?? '')}">
        <input class="text_pole" data-r="谁知道" placeholder="还有谁知道（、分隔；不写只有他自己）" style="flex:1 1 10em" value="${escapeHtml(knows)}">
        <div class="menu_button" data-role="row-del" title="删此行设定，建议核对后再删。" style="flex:0 0 auto">✕</div></div>`;
}
// 开局单填表里挑人（用户 10/12：主要聚焦角色、全剧情必要角色都能从角色卡列表里勾，没建卡的直接填）：
// 你自己的角色、群里的人、别的卡依次列（旁白卡不列）；列表里没有的写在下面那一格，用、隔开
const MUST_CAST_HEAD = '这一局必须有的角色：';
function mustCastFrom(d) {
    const line = (d?.原则 ?? []).map(x => String(x?.条 ?? '')).find(t => t.startsWith(MUST_CAST_HEAD));
    return line ? line.slice(MUST_CAST_HEAD.length).split(/[、,，]/).map(x => x.trim()).filter(Boolean) : [];
}
function castChoices(c) {
    const cards = (c.characters ?? []).filter(ch => ch?.name && !isCamera(ch)).map(ch => ch.name);
    return [...new Set([c.name1, ...members(c).map(m => m.name), ...cards].filter(Boolean))];
}
function castPicker(c, key, label, picked, hint) {
    const choices = castChoices(c), known = new Set(choices), mine = picked ?? [];
    const own = mine.filter(n => !known.has(n));
    return `<label style="display:block;margin:.5em 0 .1em"><b>${label}</b>（${hint}）</label>
        <div style="display:flex;flex-wrap:wrap;gap:.2em .8em;max-height:8em;overflow:auto">${choices.map(n => `<label class="checkbox_label"><input type="checkbox" data-pick="${key}" value="${escapeHtml(n)}" ${mine.includes(n) ? 'checked' : ''}> ${escapeHtml(n)}${n === c.name1 ? '（你）' : ''}</label>`).join('')}</div>
        <input class="text_pole" data-f="${key}自填" style="width:100%" placeholder="列表里没有的（还没建卡的）直接填，用、隔开" value="${escapeHtml(own.join('、'))}">`;
}
function castPicked(root, key) {
    const ticked = [...root.querySelectorAll(`[data-pick="${key}"]`)].filter(x => x.checked).map(x => x.value);
    const typed = String(root.querySelector(`[data-f="${key}自填"]`)?.value ?? '').split(/[、,，/]/).map(x => x.trim()).filter(Boolean);
    return [...new Set([...ticked, ...typed])];
}
export function setupPersonaHtml(name, escape = escapeHtml) {
    return `<p>这一局你演的是：<b>${escape(name || '当前未知')}</b>（当前人设）。点错了先去切人设再确认。</p>`;
}
export function setupIntimateRows(data, crew, cardNames, player) {
    if (Array.isArray(data) && data.length) return data.map(r => ({ 谁: [...r.谁], 成年: r.成年 === true }));
    const first = crew.find(n => n !== player && cardNames.includes(n));
    return first && player ? [{ 谁: [player, first], 成年: true }] : [];
}
export function setupIntimateHtml(rows, names, player, tier) {
    if (tier === 'SFW') return '<small>档位是 SFW，不用亲密线；要用先在\'这一局\'改档位。</small>';
    const own = rows.filter(r => r.谁.includes(player));
    const adult = checked => `<label class="checkbox_label"><input type="checkbox" data-intimate-adult${checked ? ' checked' : ''}> 两人都已成年</label>`;
    return `<div data-role="intimate-form"><b>亲密线</b><p>和你有亲密线的人（可多选）</p>
        <div style="display:flex;flex-wrap:wrap;gap:.3em .8em">${[...new Set([...names.filter(n => n !== player), ...own.flatMap(r => r.谁).filter(n => n !== player)])].map(n => {
            const row = own.find(r => r.谁.includes(n));
            return `<div data-intimate-own="${escapeHtml(n)}"><label class="checkbox_label"><input type="checkbox" data-intimate-pick${row ? ' checked' : ''}> ${escapeHtml(n)}</label>${adult(row ? row.成年 : true)}</div>`;
        }).join('')}</div><p>别的两人之间（可选）</p><div data-role="intimate-others">${rows.filter(r => !r.谁.includes(player)).map(r => setupIntimateOtherHtml(r, names)).join('')}</div>
        <button type="button" class="menu_button" style="width:auto;white-space:nowrap" data-role="intimate-add" title="添加一条两人之间的亲密线。">加一行</button><small>提交就表示你确认这些人都已成年；有未成年的，取消勾选或删掉那一条。</small></div>`;
}
export function setupIntimateOtherHtml(row = { 谁: [], 成年: true }, names = []) {
    return `<div data-intimate-other style="display:flex;flex-wrap:wrap;gap:.3em">${[0, 1].map(i => `<select class="text_pole" data-intimate-person><option value="">选人</option>${[...new Set([...names, ...row.谁])].map(n => `<option value="${escapeHtml(n)}"${row.谁[i] === n ? ' selected' : ''}>${escapeHtml(n)}</option>`).join('')}</select>`).join('')}<label class="checkbox_label"><input type="checkbox" data-intimate-adult${row.成年 ? ' checked' : ''}> 两人都已成年</label><button type="button" class="menu_button" data-role="intimate-del" title="删掉这条亲密线，确认后生效。">✕</button></div>`;
}
export function setupIntimatePicked(root, player) {
    return [...[...root.querySelectorAll('[data-intimate-own]')].filter(el => el.querySelector('[data-intimate-pick]').checked).map(el => ({ 谁: [player, el.dataset.intimateOwn], 成年: el.querySelector('[data-intimate-adult]').checked })),
        ...[...root.querySelectorAll('[data-intimate-other]')].map(el => ({ 谁: [...el.querySelectorAll('[data-intimate-person]')].map(x => x.value), 成年: el.querySelector('[data-intimate-adult]').checked }))];
}
async function openSetupForm(s) {
    const c = ctx(), chatKey = state.chatKey, setupPersona = String(c.name1 ?? '').trim();
    const d = s.confirmed?.data ?? {};
    const t = d.时间 ?? {};
    const own = (d.类别 ?? []).filter(x => !CATEGORIES.includes(x));
    const field = (label, key, rows = 2, ph = '') => `<label style="display:block;margin:.5em 0 .1em">${label}</label><textarea class="text_pole" data-f="${key}" rows="${rows}" style="width:100%" placeholder="${escapeHtml(ph)}"></textarea>`;
    const rows = Array.isArray(s.rows) ? s.rows : [];
    const crew = Array.isArray(s.crew) ? s.crew : Array.isArray(d.主角团) ? d.主角团 : [];
    const mustCast = Array.isArray(s.mustCast) ? s.mustCast : mustCastFrom(d);
    const intimate = setupIntimateRows(s.intimate ?? d.亲密线, crew, (c.characters ?? []).filter(ch => !isCamera(ch)).map(ch => ch.name), setupPersona);
    const intimateNames = [...new Set([setupPersona, ...(s.names ?? castChoices(c))].filter(Boolean))];
    const tier = s.content?.tier ?? state.content?.tier ?? 'SFW';
    const html = `<h3>开局单 · 填表</h3>${setupPersonaHtml(setupPersona)}<p><small>带 * 的必填，其余都能空着。"核心主线"到"必要剧情"每行一条，会加进现在那份里（已有的不重复）；要删、要改原来的，去"看和改全文"。"人物开场状态"和"亲密线"列的是现有的全部，在这儿改、删、加都算数。</small></p>
      <div style="text-align:left">
        <label style="display:block;margin:.5em 0 .1em"><b>基调 *</b>（一两句：整体什么氛围、这一局最看重什么）</label>
        <textarea class="text_pole" data-f="基调" rows="2" style="width:100%">${escapeHtml(d.基调 ?? '')}</textarea>
        <label style="display:block;margin:.5em 0 .1em"><b>剧情类别 *</b>（多选，也能自己填）</label>
        <div style="display:flex;flex-wrap:wrap;gap:.2em .8em">${CATEGORIES.map(k => `<label class="checkbox_label"><input type="checkbox" data-cat="${k}" ${(d.类别 ?? []).includes(k) ? 'checked' : ''}> ${k}</label>`).join('')}</div>
        <input class="text_pole" data-f="自填" style="width:100%" placeholder="自己填，用、隔开" value="${escapeHtml(own.join('、'))}">
        <label style="display:block;margin:.5em 0 .1em"><b>故事节奏</b>（选填，不选就是中）</label>
        <div style="display:flex;flex-wrap:wrap;gap:.3em;align-items:center">
            <select class="text_pole" data-f="节奏" style="flex:0 0 auto;width:auto">${[['中', '中（默认）'], ['慢', '慢'], ['快', '快']].map(([v, label]) => `<option value="${v}" ${(d.节奏 ?? '中') === v ? 'selected' : ''}>${label}</option>`).join('')}</select>
            <small data-role="pace-hint" style="flex:1 1 12em">${escapeHtml(PACE_HINT[d.节奏 ?? '中'] ?? '')}</small>
        </div>
        ${castPicker(c, '主角团', '主要聚焦角色（主角团）', crew, '故事围着转的那几个人，含你自己的角色；可多选，也能自己填')}
        ${setupIntimateHtml(intimate, intimateNames, setupPersona, tier)}
        <label>玩家性别 <select class="text_pole" data-f="玩家性别">${['', '男', '女'].map(g => `<option value="${g}"${(d.玩家性别 ?? '') === g ? ' selected' : ''}>${g || '不写'}</option>`).join('')}</select></label>
        <details style="margin:.5em 0"><summary>开场时间（选填）</summary>
          <div style="display:flex;flex-wrap:wrap;gap:.3em">
            <input class="text_pole" data-t="日期" placeholder="日期 2000-01-31" style="flex:1 1 9em" value="${escapeHtml(t.日期 ?? '')}">
            <select class="text_pole" data-t="时段" style="flex:0 0 auto;width:auto">${['', ...(t.尺度?.时段?.length ? t.尺度.时段 : ['早上', '上午', '中午', '下午', '傍晚', '晚上', '深夜', '凌晨'])].map(p => `<option value="${escapeHtml(p)}" ${t.时段 === p ? 'selected' : ''}>${escapeHtml(p) || '时段'}</option>`).join('')}</select>
            <input class="text_pole" data-t="从哪天算" placeholder="从哪天算第一天（选填）" style="flex:1 1 9em" value="${escapeHtml(t.从哪天算 ?? '')}">
            <input class="text_pole" data-t="第几天" placeholder="开场是第几天" style="flex:0 0 7em" value="${t.第几天 ?? ''}">
            <input class="text_pole" data-t="天气" placeholder="天气：小雨 3 ｜ 阴 2 ｜ 晴 2" style="flex:1 1 100%" value="${escapeHtml((t.天气 ?? []).map(x => `${x.种} ${x.份}`).join(' ｜ '))}">
            <input class="text_pole" data-t="气温" placeholder="气温（一句话）" style="flex:1 1 100%" value="${escapeHtml(t.气温 ?? '')}">
            <small style="flex:1 1 100%">时间尺度（选填）：这一局一格时间按什么走。一跳几个月、几年的局（远行、几代人）选月或年，"第几天"就成了第几年；不选就是按天、一天八段。时间尺度也决定局势每隔多久推一次。</small>
            <select class="text_pole" data-t="尺度单位" style="flex:0 0 auto;width:auto">${['', '小时', '天', '月', '年'].map(u => `<option value="${u}" ${(t.尺度?.单位 ?? '') === u ? 'selected' : ''}>${u ? `按${u}` : '按天（默认）'}</option>`).join('')}</select>
            <input class="text_pole" data-t="尺度时段" placeholder="一格里分哪几段，用、隔开（按年常写：春、夏、秋、冬；不填用默认）" style="flex:1 1 14em" value="${escapeHtml((t.尺度?.时段 ?? []).join('、'))}">
          </div></details>
        <details style="margin:.5em 0" ${rows.length ? 'open' : ''}><summary>人物开场状态（选填，多条，可自己加行）</summary>
          <small style="display:block;margin:.2em 0">开场那一刻这个人怎么样，之后跟着剧情变：在哪（开场不在场的人，镜头不写他、门上不挂他）、身体（每次都带着，好了、加重了跟着改）、心事（开场那场戏里带着，慢慢淡）、手头的事（时间到了替他推进）、约定（到日子给当事人）、欠账（还了才减）、名声（那个圈子的人照着待他）；住处、家当、车、手上的钱也在这儿填。</small>
          <div data-role="rows">${rows.map(openRowHtml).join('')}</div>
          <div class="menu_button" data-role="row-add" style="display:inline-block;margin-top:.3em" title="增加一行设定，建议只填确认的事实。">加一行</div>
        </details>
        ${field('核心主线', '主线', 2, '这一局的核心主题（只当主题，不排日程）')}
        ${field('必要剧情', '必要剧情', 2, '一定要有的线或场面，每行一条')}
        ${castPicker(c, '必要角色', '全剧情必要角色', mustCast, '一定要出场的人：从角色卡里勾，没建卡的直接填')}
        ${field('其他', '其他', 2)}
      </div>`;
    let form = null;
    const result = await c.callGenericPopup(html, c.POPUP_TYPE.TEXT, '', {
        okButton: '确认生效', cancelButton: '取消', wide: true, allowVerticalScrolling: true,
        customButtons: [{ text: '先存草稿', result: c.POPUP_RESULT.CUSTOM1 }],
        onOpen: popup => {
            const box = popup.dlg.querySelector('[data-role="rows"]');
            popup.dlg.addEventListener('click', e => {
                if (e.target?.closest?.('[data-role="row-add"]')) box.insertAdjacentHTML('beforeend', openRowHtml());
                const del = e.target?.closest?.('[data-role="row-del"]');
                if (del) del.closest('[data-row]')?.remove();
                if (e.target?.closest?.('[data-role="intimate-add"]')) popup.dlg.querySelector('[data-role="intimate-others"]').insertAdjacentHTML('beforeend', setupIntimateOtherHtml(undefined, intimateNames));
                e.target?.closest?.('[data-role="intimate-del"]')?.closest('[data-intimate-other]')?.remove();
            });
            // 换了哪一类，"是什么"的示例跟着换；换了节奏，旁边的小字跟着换
            popup.dlg.addEventListener('change', e => {
                if (e.target?.dataset?.f === '节奏') { const hint = popup.dlg.querySelector('[data-role="pace-hint"]'); if (hint) hint.textContent = PACE_HINT[e.target.value] ?? ''; return; }
                if (e.target?.dataset?.r !== '类') return;
                const input = e.target.closest('[data-row]')?.querySelector('[data-r="是"]');
                if (input) input.placeholder = OPEN_ROW_HINT[e.target.value] ?? '';
            });
        },
        onClosing: popup => {
            const q = sel => popup.dlg.querySelector(sel);
            const time = Object.fromEntries([...popup.dlg.querySelectorAll('[data-t]')].map(x => [x.dataset.t, x.value.trim()]));
            // 时间尺度（章程 G2）：两小格并成"尺度"那一格；都空着就是按天
            if (time.尺度单位 || time.尺度时段) time.尺度 = { 单位: time.尺度单位 || '天', 时段: time.尺度时段 };
            delete time.尺度单位; delete time.尺度时段;
            const orig = el => { try { return el.dataset.orig ? JSON.parse(el.dataset.orig) : null; } catch { return null; } };
            form = {
                基调: q('[data-f="基调"]').value, 主线: q('[data-f="主线"]').value, 必要剧情: q('[data-f="必要剧情"]').value,
                必要角色: castPicked(popup.dlg, '必要角色'), 玩家性别: q('[data-f="玩家性别"]').value, 主角团: castPicked(popup.dlg, '主角团'), 其他: q('[data-f="其他"]').value,
                ...(tier !== 'SFW' ? { 亲密线: setupIntimatePicked(popup.dlg, setupPersona) } : {}),
                节奏: q('[data-f="节奏"]')?.value ?? '中',
                类别: [...[...popup.dlg.querySelectorAll('[data-cat]')].filter(x => x.checked).map(x => x.dataset.cat), ...q('[data-f="自填"]').value.split(/[、,，/]/).map(x => x.trim()).filter(Boolean)],
                时间: time,
                // 后台不认这几行（旧版）就不带，免得把原有的几格当成删光了
                人物: Array.isArray(s.rows) ? [...popup.dlg.querySelectorAll('[data-row]')].map(el => ({ 谁: el.querySelector('[data-r="谁"]').value.trim(), 类: el.querySelector('[data-r="类"]').value,
                    是: el.querySelector('[data-r="是"]').value.trim(), 谁知道: el.querySelector('[data-r="谁知道"]').value.trim(), 原来: orig(el) })).filter(r => r.谁 || r.是) : undefined,
            };
            const half = (form.人物 ?? []).filter(r => !r.谁 || !r.是);
            if (popup.result !== c.POPUP_RESULT.NEGATIVE && popup.result !== c.POPUP_RESULT.CANCELLED && (form.亲密线 ?? []).some(r => r.谁.length !== 2 || r.谁.some(n => !n) || r.谁[0] === r.谁[1])) {
                globalThis.toastr?.warning('亲密线每条要选两个不同的人；不要的点 ✕ 删掉');
                return false;
            }
            if (popup.result !== c.POPUP_RESULT.NEGATIVE && popup.result !== c.POPUP_RESULT.CANCELLED && half.length) {
                globalThis.toastr?.warning(`人物开场状态有 ${half.length} 行没填全（谁、是什么都要写；不要的点 ✕ 删掉）`);
                return false;
            }
            if (popup.result === c.POPUP_RESULT.AFFIRMATIVE && (!form.基调.trim() || !form.类别.length)) {
                globalThis.toastr?.warning(`还没填：${[!form.基调.trim() && '基调', !form.类别.length && '剧情类别'].filter(Boolean).join('、')}`);
                return false;
            }
            return true;
        },
    });
    if (result !== c.POPUP_RESULT.AFFIRMATIVE && result !== c.POPUP_RESULT.CUSTOM1) return;
    try {
        if (result === c.POPUP_RESULT.AFFIRMATIVE) { await sendPersona(); if (String(ctx().name1 ?? '').trim() !== setupPersona) throw new Error('人设变了，请重新打开开局单核对'); }
        const r = await api('setup', { chatKey, form, confirm: result === c.POPUP_RESULT.AFFIRMATIVE, ...(result === c.POPUP_RESULT.AFFIRMATIVE ? { planPersona: setupPersona, relationCards: await relationCardsFor(chatKey) } : {}) });
        if (result === c.POPUP_RESULT.AFFIRMATIVE) await showReceipt(r.receipt);
        else globalThis.toastr?.info('存成草稿了，下次点"开局单 → 核对草稿"接着改。');
    } catch (error) { globalThis.toastr?.warning(error.message || '后台暂时连不上。'); }
}

async function openSetupText(s) {
    const c = ctx(), chatKey = state.chatKey, setupPersona = String(c.name1 ?? '').trim();
    const current = s.draft?.text ?? s.confirmed?.text ?? null;
    if (!current) return pasteSetup(chatKey);
    const note = s.draft?.text
        ? `后台分好的草稿，还没生效。${s.draft.unchecked ? `带 ⚠ 的 ${s.draft.unchecked} 条在你的原文里没找到对应的话，请看一眼。` : ''}改完点"确认"，从现在起生效${s.confirmed ? '，替换现在那一版' : ''}。`
        : `现在生效的开局单（${new Date(s.confirmed.at).toLocaleString()} 确认）。改完点"确认"就换成新的一版。`;
    const { result, text } = await textPopup('开局单', [setupPersonaHtml(setupPersona), note, ...(s.intimateWarnings ?? [])].join('\n'), current, { ok: '确认', cancel: s.draft?.text ? '先放着' : '关闭', extra: '重新贴一段' });
    if (result === c.POPUP_RESULT.AFFIRMATIVE) { await sendPersona(); if (String(ctx().name1 ?? '').trim() !== setupPersona) throw new Error('人设变了，请重新打开开局单核对'); const r = await api('setup', { chatKey, text, confirm: true, planPersona: setupPersona, relationCards: await relationCardsFor(chatKey) }); await showReceipt(r.receipt); }
    else if (result === c.POPUP_RESULT.CUSTOM1) await pasteSetup(chatKey);
    else if (s.draft?.text && text !== current) await api('setup', { chatKey, text });   // 草稿改过的先存着
}

// ---------- 人物关系表 ----------
// 这一局的人各是谁、地盘、和谁什么关系、故事开始时知道什么、外人眼里什么样。规划者读全表；每个角色开口前只拿他自己那几行。
async function openRelations(append = '', draftId = null) {
    const c = ctx(), chatKey = state.chatKey;
    const r = await api('relations', { chatKey });
    if (draftId && (r.draft?.id !== draftId || r.people)) { globalThis.toastr?.warning('关系表或草稿变了，请重新打开核对。'); await refreshRelationsDraft(); return false; }
    const blank = '【说明】\n【公开】（谁都知道的）\n【备注】\n【不在了】（规划不排）\n【人】\n\n## 人名\n又名：\n现在：\n地盘：\n关系：\n· 某人：怎样\n开局知道：\n· \n开局不知道：\n· \n';
    const note = r.text
        ? `这一局的关系表，${r.people} 人。${r.unsure.length ? `有待核或待定的：${r.unsure.join('、')}。` : ''}"开局不知道"只给规划者看，不会递给角色。改完点"保存"，下一轮起生效。`
        : '这一局还没有关系表。照下面的格子写（一人一段，"## 人名"开头），保存后下一轮起生效。';
    // 开场之后的变化（按账本和规划自动更新，跟着删消息、改稿、分支走）：只给看，不在这里改。
    const later = r.now?.length ? `<br><b>开场之后变了的（自动，跟着剧情走）：</b><br>${r.now.map(escapeHtml).join('<br>')}` : '';
    const start = append ? `${r.text ?? ''}\n\n${append}`.trim() + '\n' : r.text ?? blank;
    const { result, text } = await textPopup('人物关系表', (append ? '<b>最后面接着的是从素材整理出来的，核对、删改后保存。</b><br>' : '') + note + later, start, { ok: '保存', cancel: '关闭' });
    if (result === c.POPUP_RESULT.AFFIRMATIVE && text !== (r.text ?? blank)) {
        const saved = await api('relations', { chatKey, text, ...(draftId ? { draftId } : {}) });
        await refreshRelationsDraft();
        globalThis.toastr?.success(`关系表已保存（${saved.people} 人）。`);
        return true;
    }
    return false;
}

// ---------- 剧情素材（开局单设计稿 §四） ----------
// 传上来 → 后台看一眼提用法（开局单／关系表／参考资料，几分钱）→ 你点哪种就按哪种处理：
// 开局单＝分到各格进草稿；关系表＝整理成格子接在原表后面让你核对；参考资料＝存进这一局的资料夹，参谋按问题翻相关的几段。
async function openMaterials() {
    const c = ctx(), chatKey = state.chatKey;
    let items = (await api('material', { chatKey })).items ?? [];
    let dlg = null, timer = null;
    const STATUS = { looking: '后台在看……', ready: '', working: '在整理……', drafted: '整理好了', applied: '已处理' };
    const draw = () => {
        if (!dlg) return;
        dlg.querySelector('[data-role="mat-list"]').innerHTML = items.length ? items.map(x => `<div style="margin:.5em 0;padding:.3em .5em;border-left:3px solid var(--SmartThemeQuoteColor,#e88)">
            <b>${escapeHtml(x.name)}</b> <small style="opacity:.7">${x.chars} 字 · ${STATUS[x.status] ?? x.status}${x.status === 'applied' ? `（当${escapeHtml(x.kind ?? '')}）` : ''}</small>
            ${x.summary ? `<div><small>${escapeHtml(x.summary)}</small></div>` : ''}
            ${x.kind && x.status === 'ready' ? `<div><small>后台建议：当<b>${escapeHtml(x.kind)}</b>${x.why ? `（${escapeHtml(x.why)}）` : ''}</small></div>` : ''}
            ${x.error ? `<div><small style="color:var(--warning,orange)">没整理成：${escapeHtml(x.error)}</small></div>` : ''}
            <div class="flex-container" style="gap:4px;margin-top:.2em">${x.status === 'drafted' ? `<div class="menu_button" style="width:auto" data-mat-open="${escapeHtml(x.name)}" title="核对关系表草稿，建议确认后生效。">打开关系表核对</div>` : ''}
              ${['ready', 'drafted'].includes(x.status) ? ['开局单', '关系表', '参考资料'].map(k => `<div class="menu_button" style="width:auto${k === x.kind ? ';font-weight:bold' : ''}" data-mat-use="${escapeHtml(x.name)}" data-kind="${k}" title="指定素材用途，会调模型，建议先核对。">当${k}</div>`).join('') : ''}
              <div class="menu_button" style="width:auto" data-mat-remove="${escapeHtml(x.name)}" title="删除本局素材，建议先留备份。">删</div></div></div>`).join('') : '<small style="opacity:.7">还没传过素材。</small>';
    };
    const poll = () => { clearTimeout(timer); if (dlg && items.some(x => x.status === 'looking' || x.status === 'working')) timer = setTimeout(async () => { try { items = (await api('material', { chatKey })).items ?? items; } catch {} draw(); poll(); }, 3000); };
    const html = `<h3>剧情素材</h3><p><small>txt、md、json、csv 都行（可以一次选几份）。传上来后台先看一眼、说该当什么用，你点了才处理：当开局单会分到各格进草稿；当关系表会整理成格子接在原表后面给你核对（调用一次“每条总结”环节的模型）；当参考资料就存着，参谋按问题翻相关的几段。</small></p>
        <input type="file" data-role="mat-file" multiple accept=".txt,.md,.markdown,.json,.csv">
        <div data-role="mat-list" style="text-align:left;max-height:55vh;overflow-y:auto;margin-top:.4em"></div>`;
    await c.callGenericPopup(html, c.POPUP_TYPE.TEXT, '', {
        okButton: '关闭', wide: true, allowVerticalScrolling: true,
        onOpen: popup => {
            dlg = popup.dlg;
            dlg.querySelector('[data-role="mat-file"]').addEventListener('change', async e => {
                const files = [...(e.target.files ?? [])];
                if (!files.length) return;
                try {
                    const read = await Promise.all(files.map(f => f.text().then(text => ({ name: f.name, text }))));
                    items = (await api('material', { chatKey, files: read }, 60000)).items ?? items;
                    globalThis.toastr?.info(`传上去了 ${files.length} 份，后台在看。`);
                } catch (error) { globalThis.toastr?.warning(error.message || '没传上去。'); }
                e.target.value = '';
                draw(); poll();
            });
            dlg.addEventListener('click', async e => {
                const a = e.target.closest('[data-mat-use],[data-mat-remove],[data-mat-open]');
                if (!a) return;
                try {
                    if (a.dataset.matRemove) items = (await api('material', { chatKey, remove: a.dataset.matRemove })).items ?? items;
                    else if (a.dataset.matOpen) {
                        const r = await api('material', { chatKey, use: { name: a.dataset.matOpen, kind: '关系表' } });
                        if (r.draft && await openRelations(r.draft)) items = (await api('material', { chatKey, done: a.dataset.matOpen })).items ?? items;
                    } else {
                        const r = await api('material', { chatKey, use: { name: a.dataset.matUse, kind: a.dataset.kind } });
                        items = r.items ?? items;
                        if (r.started === 'setup') { globalThis.toastr?.info('在分到开局单各格，一两分钟，好了会提醒。'); watchSetup(chatKey); }
                        if (r.started === 'relations') globalThis.toastr?.info('在整理成关系表的格子，好了这里会出"打开关系表核对"。');
                    }
                } catch (error) { globalThis.toastr?.warning(error.message || '后台暂时连不上。'); }
                draw(); poll();
            });
            draw(); poll();
        },
        onClose: () => { clearTimeout(timer); dlg = null; },
    });
}

// 左下角魔棒菜单里的"开局单"：从哪个窗口点开就是哪个窗口；还没接入的先问一句接不接。
function addWand() {
    const menu = document.querySelector('#extensionsMenu');
    if (!menu) { setTimeout(addWand, 1000); return; }
    if (menu.querySelector('#rpe_wand_setup')) return;
    const item = document.createElement('div');
    item.id = 'rpe_wand_setup';
    item.className = 'list-group-item flex-container flexGap5';
    item.innerHTML = '<div class="fa-solid fa-scroll extensionsMenuExtensionButton"></div><span>开局单（RP：幕后）</span>';
    item.addEventListener('click', () => wandSetup().catch(() => {}));
    menu.append(item);
}
async function wandSetup() {
    const c = ctx();
    if (!settings().enabled) { globalThis.toastr?.info('RP：幕后没开（扩展面板里的总开关）。'); return; }
    if (!state.chatKey) {
        if (!chatIds(c).stChatId) { globalThis.toastr?.info('先打开一个聊天窗口。'); return; }
        if (!(await c.callGenericPopup('这个窗口还没接入 RP：幕后。现在接入，再填开局单？', c.POPUP_TYPE.CONFIRM))) return;
        await join();
    }
    if (state.chatKey) await openSetup();
}

// 局预设（收口计划第 5 件）：把这一局的开局单、名册、关系表、素材包、离开时怎么算存成一份；新局一键套上；导出、导入成文件（别的副本用）。
async function openPresets() {
    const c = ctx(), chatKey = state.chatKey;
    const box = document.createElement('div');
    box.style.textAlign = 'left';
    let list = (await api('preset', { chatKey })).presets;
    const draw = () => {
        box.innerHTML = `<h3>局预设</h3>
            <p><small>把这一局的开局单、名册、关系表、素材包选择、离开时怎么算存成一份；开新局时一键套上，套完照样能改，和原来那一局互不影响。不带记住的事和规划。预置的无卡人物会保留，剧情里长出来的新面孔保存时可选择带上。不花钱。</small></p>
            <div style="display:flex;gap:.4em;flex-wrap:wrap;margin:.4em 0">
              <input class="text_pole" data-f="name" placeholder="起个名字" style="flex:1 1 12em">
              <button class="menu_button" style="flex:0 0 auto;white-space:nowrap" data-p="save" type="button" title="保存本局起跑设定，建议新局确认后存。">把这一局存成预设</button>
              <button class="menu_button" style="flex:0 0 auto;white-space:nowrap" data-p="import" type="button" title="导入局预设文件，建议核对后再套。">从文件导入</button>
              <input type="file" accept=".json,application/json" data-f="file" hidden>
            </div>
            ${list.map(p => `<div data-name="${escapeHtml(p.name)}" style="margin:.4em 0;padding:.3em .6em;border-left:3px solid var(--SmartThemeQuoteColor,#888)">
              <b>${escapeHtml(p.name)}</b> <small style="opacity:.8">${escapeHtml(new Date(p.savedAt).toLocaleString())} · ${p.setup ? '有开局单' : '没有开局单'} · 名册 ${p.people} 人 · 关系表 ${p.relations} 人 · 素材包：${escapeHtml(p.pack ?? '不用')}</small>
              <div style="display:flex;gap:.4em;flex-wrap:wrap;margin-top:.3em">
                <button class="menu_button" style="flex:0 0 auto;white-space:nowrap" data-p="apply" type="button" title="替换本局起跑设定，建议新局使用。">套到这一局</button>
                <button class="menu_button" style="flex:0 0 auto;white-space:nowrap" data-p="export" type="button" title="导出这份预设，建议分享前查私有内容。">导出成文件</button>
                <button class="menu_button" style="flex:0 0 auto;white-space:nowrap" data-p="remove" type="button" title="移除此项，建议确认有备份再点。">删</button>
              </div></div>`).join('') || '<p><small>还没有预设。</small></p>'}`;
    };
    const reload = () => Promise.all([api('pack', { chatKey }).then(p => { state.pack = p; }), api('absence', { chatKey }).then(a => { state.absence = a; })]).catch(() => {}).then(() => render());
    box.addEventListener('click', async event => {
        const act = event.target?.dataset?.p;
        if (!act) return;
        const name = event.target.closest('[data-name]')?.dataset.name;
        try {
            if (act === 'save') {
                const n = box.querySelector('[data-f="name"]').value.trim();
                if (!n) { globalThis.toastr?.warning('先起个名字。'); return; }
                if (list.some(p => p.name === n) && !(await c.callGenericPopup(`已经有一份叫"${escapeHtml(n)}"的预设，换成这一局现在的样子？`, c.POPUP_TYPE.CONFIRM))) return;
                const { cast } = await api('cast', { chatKey });
                const grown = cast.filter(e => String(e.avatar).startsWith('face:') && e.role === '新面孔' && e.set_by !== 'user').length;
                const includeGrownFaces = grown > 0 && !!(await c.callGenericPopup(`要不要把这一局长出来的 ${grown} 个新面孔一起存`, c.POPUP_TYPE.CONFIRM));
                if (state.chatKey !== chatKey) return;
                list = (await api('preset', { chatKey, save: n, includeGrownFaces })).presets;
                globalThis.toastr?.success('存好了。');
            }
            // 先 return：后面的 draw() 会把这个隐藏的文件框换掉，选完文件的 change 落在已经不在页面上的旧框上，就没反应了（用户 10/22）
            if (act === 'import') { box.querySelector('[data-f="file"]').click(); return; }
            if (act === 'apply') {
                const ok = await c.callGenericPopup(`把"${escapeHtml(name)}"套到这一局？这一局现在的开局单、名册、关系表、素材包、离开时怎么算会换成预设里的（原来的样子后台另存了一份）。`, c.POPUP_TYPE.CONFIRM);
                if (!ok) return;
                const r = await api('preset', { chatKey, apply: name });
                list = r.presets;
                for (const warning of r.applied.warnings ?? []) globalThis.toastr?.warning(warning);
                globalThis.toastr?.success(`套好了：名册 ${r.applied.people} 人${r.applied.setup ? '、开局单' : ''}${r.applied.relations ? '、关系表' : ''}${r.applied.pack ? `、素材包"${r.applied.pack}"` : ''}。`);
                await reload();
            }
            if (act === 'export') {
                const { preset } = await api('preset', { export: name });
                const a = document.createElement('a');
                a.href = URL.createObjectURL(new Blob([JSON.stringify(preset, null, 1)], { type: 'application/json' }));
                a.download = `局预设-${name}.json`;
                a.click();
                setTimeout(() => URL.revokeObjectURL(a.href), 5000);
            }
            if (act === 'remove') {
                if (!(await c.callGenericPopup(`删掉预设"${escapeHtml(name)}"？已经套过它的局不受影响。`, c.POPUP_TYPE.CONFIRM))) return;
                list = (await api('preset', { remove: name })).presets;
            }
        } catch (error) { globalThis.toastr?.error(error.message); }
        draw();
    });
    box.addEventListener('change', async event => {
        if (event.target?.dataset?.f !== 'file' || !event.target.files?.[0]) return;
        try {
            const data = JSON.parse(await event.target.files[0].text());
            list = (await api('preset', { import: data })).presets;
            globalThis.toastr?.success(`导入了"${data.name}"。`);
        } catch (error) { globalThis.toastr?.error(`导入不了：${error.message}`); }
        draw();
    });
    draw();
    await c.callGenericPopup(box, c.POPUP_TYPE.TEXT, '', { wide: true, allowVerticalScrolling: true, okButton: '关闭' });
}

// 提示词位置（D-116）：当前预设的条目按次序列出来（灰的，只能在 ST 的提示词管理里改），后台那几块标在它们该在的位置；
// 一键把那几块加进当前预设（之后在 ST 的提示词管理里拖拽、改深度），或者移除；预设里没有的按这里设的深度放。
async function openPlaces() {
    const c = ctx();
    const box = document.createElement('div');
    box.style.textAlign = 'left';
    let preview = null;
    const draw = () => {
        const m = promptManagerNow();
        const covered = coveredByPreset();
        const places = settings().places ?? {};
        const presetName = c.chatCompletionSettings?.preset_settings_openai ?? '（不明）';
        const ours = id => BLOCKS.some(b => b.id === id);
        const cameraRows = m?.activeCharacter ? m.getPromptOrderForCharacter(m.activeCharacter).map(e => { const q = m.serviceSettings.prompts.find(p => p.identifier === e.identifier) ?? { name: e.identifier }; return `<label style="display:block"><input type="checkbox" data-camera-keep="${escapeHtml(e.identifier)}" ${settings().cameraKeep.includes(e.identifier) ? 'checked' : ''}> 旁白也用：${escapeHtml(ST_NAMES[e.identifier] ?? q.name ?? e.identifier)}</label>`; }).join('') : '<small>提示词管理还没载好。</small>';
        const selectedBooks = Array.isArray(stWorldInfo?.selected_world_info) ? stWorldInfo.selected_world_info : [];
        const cameraBookRows = selectedBooks.map(name => `<label style="display:block"><input type="checkbox" data-camera-book="${escapeHtml(name)}" ${settings().cameraBooks?.[name] !== false ? 'checked' : ''}> 旁白也用这本书：${escapeHtml(name)}</label>`).join('') || '<small>当前没有选中的全局世界书。</small>';
        let listHtml = '<p><small>眼下用的不是对话补全类的接口（或者提示词管理还没载好），只能按下面设的位置放。</small></p>';
        if (m?.activeCharacter) {
            const order = m.getPromptOrderForCharacter(m.activeCharacter).filter(e => e.enabled);
            const byId = id => m.serviceSettings.prompts.find(p => p.identifier === id) ?? { identifier: id, name: id };
            const rows = order.map(e => byId(e.identifier));
            // 预设里没有的后台块，按面板设的位置标出来（虚线）
            const virtual = BLOCKS.filter(b => !covered.has(b.id.slice(4))).map(b => ({ identifier: b.id, name: b.name, injection_position: b.position, injection_depth: Number.isInteger(places[b.id.slice(4)]) ? places[b.id.slice(4)] : b.depth, virtual: true }));
            const relative = rows.filter(p => (p.injection_position ?? 0) !== 1);
            // 预设里没有的、不插进聊天的几块：ST 只能放在主提示词后面
            const vRel = virtual.filter(v => v.injection_position === 0);
            if (vRel.length) relative.splice(Math.max(0, relative.findIndex(p => p.identifier === 'main')) + 1, 0, ...vRel);
            const inChat = [...rows.filter(p => p.injection_position === 1), ...virtual.filter(v => v.injection_position === 1)].sort((a, b) => (b.injection_depth ?? 4) - (a.injection_depth ?? 4));
            const line = (p, extra = '') => `<div style="padding:.15em .4em;margin:.1em 0;${ours(p.identifier) ? `border-left:3px ${p.virtual ? 'dashed' : 'solid'} var(--SmartThemeQuoteColor,#e88);font-weight:bold` : 'opacity:.55'}">${escapeHtml(ST_NAMES[p.identifier] ?? p.name ?? p.identifier)}${p.virtual ? '<small style="font-weight:normal">（预设里没有，按面板设的放）</small>' : ''}${extra}</div>`;
            listHtml = `<h4>当前预设「${escapeHtml(presetName)}」里，发给模型的次序</h4>
              <p><small>灰的是预设自己的条目，只能在 ST 的提示词管理里拖（左上第一个图标 → 最下面的提示词列表）；带色的是后台那几块（实线＝在预设里，虚线＝预设里没有、按面板设的放）。世界书条目、作者注释、角色备注按它们自己的设置插进聊天，这里不列。</small></p>
              ${relative.map(p => line(p)).join('')}
              ${inChat.length ? `<div style="margin:.4em 0 .1em"><small>插进聊天记录里的（倒数第几条之前；0＝所有消息之后）：</small></div>${inChat.map(p => line(p, `<small style="font-weight:normal">　倒数第 ${p.injection_depth ?? 4} 条</small>`)).join('')}` : ''}`;
        }
        const fallback = BLOCKS.filter(b => !covered.has(b.id.slice(4)));
        box.innerHTML = `<h3>提示词位置</h3>
            <p><small>后台每一轮给角色的材料分五块。把它们加进预设以后，就和预设里别的条目一样：在 ST 的提示词管理里拖拽定次序、改"插在聊天里"的深度、改角色，还可以在条目里宏的前后加自己的话。每个预设各存各的；换了没加过的预设，就按下面设的位置放。</small></p>
            ${listHtml}
            <h4>旁白</h4>
            <p><small>旁白这一轮默认只保留聊天记录、世界书和后台场记。下面勾选的预设条目也会保留。</small></p>
            ${cameraRows}
            <p><small>全局世界书（默认都给旁白；取消勾选规则书后只在角色回合使用）。</small></p>
            ${cameraBookRows}
            <p><small>如果 ST 关闭了“优先角色提示词／优先角色后历史指令”，或预设条目勾选了“禁止覆盖”，卡里的镜头定义不能替掉预设主提示词。</small></p>
            <div style="display:flex;gap:.4em;flex-wrap:wrap;margin:.5em 0"><button class="menu_button" data-p="camera-fill" type="button" title="补旁白主提示词，建议先备份原卡。">旁白卡补主提示词</button><button class="menu_button" data-p="camera-last" type="button" title="查看旁白请求，建议排错时用。">看旁白这一轮发了什么</button></div>
            <h4>后台的五块</h4>
            ${BLOCKS.map(b => {
                const inPreset = covered.has(b.id.slice(4));
                const d = places[b.id.slice(4)];
                return `<div style="margin:.4em 0;padding:.2em .5em;border-left:3px solid var(--SmartThemeQuoteColor,#888)">
                  <b>${escapeHtml(b.name)}</b> <small style="opacity:.8">${escapeHtml(b.help)}</small><br>
                  ${inPreset ? '<small>在当前预设里：位置照预设（去 ST 的提示词管理里改）</small>'
                    : b.position === 0 ? `<small>预设里没有：跟在主提示词后面${b.before ? '（加进预设后放在聊天记录之前）' : ''}</small>`
                    : `<small>预设里没有：插在倒数第</small> <input class="text_pole" data-place="${b.id.slice(4)}" type="number" min="0" max="50" value="${Number.isInteger(d) ? d : ''}" placeholder="${b.depth}" style="width:4em;display:inline-block"> <small>条之前（0＝最后；空着＝默认 ${b.depth}）</small>`}
                </div>`;
            }).join('')}
            <div style="display:flex;gap:.4em;flex-wrap:wrap;margin:.6em 0">
              ${m?.activeCharacter && fallback.length ? '<button class="menu_button" style="flex:0 0 auto;white-space:nowrap" data-p="add" type="button" title="补场记位置，建议先检查当前预设。">把几块加进当前预设</button>' : ''}
              ${m?.activeCharacter && covered.size ? '<button class="menu_button" style="flex:0 0 auto;white-space:nowrap" data-p="remove" type="button" title="移除此项，建议确认有备份再点。">从当前预设里移除这几块</button>' : ''}
              ${state.chatKey ? '<button class="menu_button" style="flex:0 0 auto;white-space:nowrap" data-p="preview" type="button" title="查看本轮供料，建议排错时用。">看这一轮每块的内容</button>' : ''}
            </div>
            <p><small>加进预设以后要永久存进预设文件，在 ST 的预设那里点"更新当前预设"；不存的话换预设就没了。</small></p>
            ${preview ? `<div style="white-space:pre-wrap;font-size:.9em;opacity:.9;max-height:40vh;overflow:auto;border:1px solid var(--SmartThemeBorderColor,#555);padding:.4em">${escapeHtml(preview)}</div>` : ''}`;
    };
    box.addEventListener('change', event => {
        const cameraKeep = event.target?.dataset?.cameraKeep;
        if (cameraKeep) { const set = new Set(settings().cameraKeep); event.target.checked ? set.add(cameraKeep) : set.delete(cameraKeep); settings().cameraKeep = [...set]; saveExtensionSettings(); return; }
        const cameraBook = event.target?.dataset?.cameraBook;
        if (cameraBook) { settings().cameraBooks = { ...(settings().cameraBooks ?? {}), [cameraBook]: event.target.checked }; saveExtensionSettings(); return; }
        const k = event.target?.dataset?.place;
        if (!k) return;
        const v = event.target.value === '' ? null : Math.max(0, Math.min(50, parseInt(event.target.value, 10)));
        settings().places = { ...(settings().places ?? {}), [k]: Number.isInteger(v) ? v : undefined };
        saveExtensionSettings();
    });
    box.addEventListener('click', async event => {
        const act = event.target?.dataset?.p;
        if (!act) return;
        const m = promptManagerNow();
        try {
            if (act === 'camera-last') {
                const rows = (state.lastCameraPrompt ?? []).map(x => `<p><b>${escapeHtml(x.role ?? '')}</b><br>${escapeHtml(String(x.content ?? '').slice(0, 300))}</p>`).join('') || '<p>还没有记录。</p>';
                await c.callGenericPopup(rows, c.POPUP_TYPE.TEXT, '旁白这一轮', { wide: true, large: true, allowVerticalScrolling: true }); return;
            }
            if (act === 'camera-fill') {
                const cam = cameraOf(c); if (!cam) { globalThis.toastr?.warning('还没有旁白卡。'); return; }
                const prompt = await api('camera-card', {});
                const r = await fetch('/api/characters/merge-attributes', { method: 'POST', headers: { ...c.getRequestHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ avatar: cam.avatar, data: { system_prompt: prompt.system, post_history_instructions: prompt.phi } }) });
                if (!r.ok) throw new Error(`补写失败（${r.status}）`);
                await c.getCharacters(); globalThis.toastr?.success('旁白卡的主提示词和后历史指令已补好。'); return;
            }
            if (act === 'add' && m?.activeCharacter) {
                const ok = await c.callGenericPopup(`在当前预设里加这几个条目（已经有的不重复加）：${BLOCKS.map(b => `「${escapeHtml(b.name)}」`).join('、')}。背景放在主提示词后面（角色定义之前）；底子、想起的放在聊天记录之前（角色定义之后）；口袋、这一轮插在聊天里倒数第 4 条之前（最后四条消息连着给）。你的条目一个不动。加完可以在 ST 的提示词管理里随意拖、改。`, c.POPUP_TYPE.CONFIRM);
                if (!ok) return;
                const order = m.getPromptOrderForCharacter(m.activeCharacter);
                let after = null;   // 插在聊天里的三块依次排在聊天记录后面
                for (const b of BLOCKS) {
                    if (!m.serviceSettings.prompts.some(p => p.identifier === b.id)) {
                        m.addPrompt({ name: b.name, role: 'system', content: b.content, injection_position: b.position, injection_depth: b.depth ?? 4, injection_order: 100, forbid_overrides: false }, b.id);
                    }
                    const have = order.find(e => e.identifier === b.id);
                    if (have) { have.enabled = true; continue; }
                    // 放在某一条之前（底子、想起的：聊天记录之前，按 BLOCKS 的次序排）
                    if (b.before) { const at = order.findIndex(e => e.identifier === b.before); order.splice(at >= 0 ? at : order.length, 0, { identifier: b.id, enabled: true }); continue; }
                    const anchor = order.findIndex(e => e.identifier === (b.anchor ?? after ?? 'chatHistory'));
                    order.splice(anchor >= 0 ? anchor + 1 : order.length, 0, { identifier: b.id, enabled: true });
                    if (!b.anchor) after = b.id;
                }
                await m.saveServiceSettings();
                m.render?.(false);
                globalThis.toastr?.success('加好了。去 ST 的提示词管理里看、拖；要永久存，点"更新当前预设"。');
            }
            if (act === 'remove' && m) {
                const ok = await c.callGenericPopup('从当前预设里移除这几个条目？移除以后按面板设的位置放。', c.POPUP_TYPE.CONFIRM);
                if (!ok) return;
                const ids = new Set(BLOCKS.map(b => b.id));
                m.serviceSettings.prompts = m.serviceSettings.prompts.filter(p => !ids.has(p.identifier));
                for (const list of m.serviceSettings.prompt_order ?? []) list.order = (list.order ?? []).filter(e => !ids.has(e.identifier));
                await m.saveServiceSettings();
                m.render?.(false);
            }
            if (act === 'preview') {
                const who = document.querySelector('#rp_emergence_panel [data-role="preview-who"]');
                const member = (who?.value === CAMERA_PICK ? { avatar: 'narrator', name: '旁白' } : null) ?? members(c).find(x => x.avatar === who?.value) ?? members(c)[0];
                if (member) {
                    const r = await api('slot-preview', { chatKey: state.chatKey, speaker: member.avatar, speakerName: member.name, recent: c.chat.slice(-3).map(x => String(x.mes ?? '')), recentUser: String([...c.chat].reverse().find(x => x.is_user)?.mes ?? ''), present: [c.name1, ...members(c).filter(x => !x.disabled).map(x => x.name)] });
                    preview = r.text || '（这一轮他没有要给的）';
                }
            }
        } catch (error) { globalThis.toastr?.error(error.message); }
        draw();
    });
    draw();
    await c.callGenericPopup(box, c.POPUP_TYPE.TEXT, '', { wide: true, large: true, allowVerticalScrolling: true, okButton: '关闭' });
}

// 跟着正本（D-117）：这个 ST 用的系统代码是正本的一份发布用拷贝，只跟已推送的最新版走。ST 每次启动自动跟上；
// 这里看有没有新版本、一键更新（后台会重启几秒；改到扩展的刷新网页，改到转发插件的要重启 ST）。开发副本不走这一套。
async function checkRelease() {
    try { state.release = await api('update', {}, 60000); } catch { state.release = null; }
    render();
    return state.release;
}
setTimeout(() => { checkRelease().catch(() => {}); }, 8000);
async function openUpdate() {
    const c = ctx();
    const r = await checkRelease();
    if (!r) { globalThis.toastr?.warning('后台暂时连不上。'); return; }
    if (!r.release) {
        await c.callGenericPopup('<h3>检查更新</h3><p>这个 ST 用的是开发中的代码（开发副本），不走更新：代码改了就是改了。</p>', c.POPUP_TYPE.TEXT);
        return;
    }
    if (!r.ok) { await c.callGenericPopup(`<h3>检查更新</h3><p>没查成：${escapeHtml(r.error ?? '')}</p>`, c.POPUP_TYPE.TEXT); return; }
    const currentVersion = r.label ? `v${r.label}` : r.head, targetVersion = r.targetLabel ? `v${r.targetLabel}` : r.target;
    if (!r.behind && !r.stale) { globalThis.toastr?.success(`已经是最新（${currentVersion}）。`); return; }
    // 代码已经是新的、后台跑的还是旧的（D-163）：只要重启后台
    const ok = await c.callGenericPopup(!r.behind ? `<h3>后台该重启了</h3>
        <p>代码已经是 ${escapeHtml(currentVersion)}，后台还在用启动时的 ${escapeHtml(r.running ?? '旧版本')}——重启一下才用上。</p>
        <p><small>后台重启几秒，别在角色正生成时点。这一局的数据、调过的参数都不动。</small></p>` : `<h3>有新版本</h3>
        <p>眼下 ${escapeHtml(currentVersion)}，新版本 ${escapeHtml(targetVersion)}，差 ${r.behind} 个提交：</p>
        <ul style="text-align:left">${(r.log ?? []).map(l => `<li><small>${escapeHtml(l)}</small></li>`).join('')}${r.behind > (r.log ?? []).length ? '<li><small>……</small></li>' : ''}</ul>
        <p><small>更新时后台重启几秒，别在角色正生成时点。你在面板上调过的参数、这一局的数据都不动；卡、书、预设也不动。${r.needsStRestart ? '<b>这次改到了转发插件：更新完关掉 ST 再开一次。</b>' : ''}</small></p>`,
        c.POPUP_TYPE.CONFIRM, '', { okButton: r.behind ? '更新' : '重启后台', cancelButton: '先不' });
    if (!ok) return;
    let done;
    try { done = await api('update', { apply: true }, 90000); } catch (error) { globalThis.toastr?.error(`没更新成：${error.message}`); return; }
    if (!done.ok) { globalThis.toastr?.error(`没更新成：${done.error ?? ''}`); return; }
    globalThis.toastr?.info('更新好了，后台在重启……');
    for (let i = 0; i < 30; i++) {
        await new Promise(resolve => setTimeout(resolve, 1500));
        try { await api('update', {}, 60000); break; } catch { /* 还在重启 */ }
    }
    await checkRelease();
    const extensionNote = done.extensionWarning ? `<p>${escapeHtml(done.extensionWarning)}。重启酒馆或运行一次安装器也能补上。</p>` : '';
    if (done.needsStRestart) await c.callGenericPopup(`<p>更新好了。这次改到了转发插件：关掉酒馆再开一次才用上。</p>${extensionNote}`, c.POPUP_TYPE.TEXT);
    else if (await c.callGenericPopup(`<p>更新好了。刷新一下网页用上新的扩展？</p>${extensionNote}`, c.POPUP_TYPE.CONFIRM, '', { okButton: '刷新', cancelButton: '等会儿' })) location.reload();
}

// 调参（D-116）：后台的开关和数字，分组列出来，改了立刻存（下一轮就生效）；每项可以恢复默认。
async function openTuning() {
    const c = ctx();
    const box = document.createElement('div');
    box.style.textAlign = 'left';
    let v = await api('tuning', {});
    const draw = () => {
        const groups = [...new Set(v.knobs.map(k => k.group))];
        const input = k => k.type === 'bool'
            ? `<label class="checkbox_label" style="display:inline-flex"><input type="checkbox" data-k="${escapeHtml(k.path)}" ${k.value ? 'checked' : ''}> 开</label>`
            : k.type === 'enum'
                ? `<select class="text_pole" data-k="${escapeHtml(k.path)}" style="width:auto;display:inline-block">${k.options.map(([x, l]) => `<option value="${escapeHtml(x)}"${x === k.value ? ' selected' : ''}>${escapeHtml(l)}</option>`).join('')}</select>`
                : `<input class="text_pole" data-k="${escapeHtml(k.path)}" type="number" step="${k.type === 'int' ? 1 : 'any'}" min="${k.min}" max="${k.max}" value="${k.value ?? ''}" style="width:7em;display:inline-block">`;
        box.innerHTML = `<h3>调参</h3>
            <p><small>后台的开关和数字。改了立刻存，下一轮就用新的；带"改过"的可以点"默认"恢复。钥匙和型号在"各环节的模型"里。</small></p>
            ${groups.map(g => `<h4>${escapeHtml(g)}</h4>${v.knobs.filter(k => k.group === g).map(k => `<div style="display:flex;gap:.5em;align-items:center;flex-wrap:wrap;margin:.3em 0">
                <span style="flex:1 1 12em">${escapeHtml(k.label)}${k.own ? ' <small style="color:var(--SmartThemeQuoteColor,#e88)">改过</small>' : ''}${k.help ? `<br><small style="opacity:.75">${escapeHtml(k.help)}</small>` : ''}${k.note?`<br><small>${escapeHtml(k.note)}</small>`:''}</span>
                ${input(k)}
                ${k.own ? `<button class="menu_button" style="flex:0 0 auto;white-space:nowrap" data-reset="${escapeHtml(k.path)}" type="button" title="恢复此项默认，建议不确定时用。">默认</button>` : ''}
              </div>`).join('')}`).join('')}`;
    };
    box.addEventListener('change', async event => {
        const path = event.target?.dataset?.k;
        if (!path) return;
        const k = v.knobs.find(x => x.path === path);
        const value = k.type === 'bool' ? event.target.checked : k.type === 'enum' ? event.target.value : event.target.value === '' ? null : Number(event.target.value);
        try { v = await api('tuning', { set: path, value }); globalThis.toastr?.success(`${k.label}：改好了，下一轮生效。`); }
        catch (error) { globalThis.toastr?.error(error.message); }
        draw();
    });
    box.addEventListener('click', async event => {
        const path = event.target?.dataset?.reset;
        if (!path) return;
        try { v = await api('tuning', { set: path, reset: true }); } catch (error) { globalThis.toastr?.error(error.message); }
        draw();
    });
    draw();
    await c.callGenericPopup(box, c.POPUP_TYPE.TEXT, '', { wide: true, large: true, allowVerticalScrolling: true, okButton: '关闭' });
}

// 各环节的模型（D-106）：钥匙簿（存几把钥匙，只显示末四位）；每个环节用哪把钥匙、哪个型号、单价、思考档；今天调了几次、花了多少。
// 改了立刻生效（后台每次用配置时现读）。钥匙填进来只存在后台，不进 ST 的设置，也不会再显示出来。
export function stageGroupState(stages, ids) {
    const rows = ids.map(id => stages.find(s => s.id === id)).filter(Boolean);
    const same = rows.length > 0 && rows.every(s => (s.key ?? '') === (rows[0].key ?? '') && (s.model ?? '') === (rows[0].model ?? ''));
    return { same, key: same ? rows[0].key ?? '' : '', model: same ? rows[0].model ?? '' : '', rows };
}
export async function saveStageGroup(ids, selection, send) {
    let value;
    if (typeof selection.model !== 'string' || selection.model.trim().length > 200) throw new Error('型号不对');
    for (const id of ids) value = await send('stages', { set: { id, key: selection.key, model: selection.model.trim() } });
    return value;
}
export function matchListedModel(name, list) {
    if (typeof name !== 'string') return null;
    if (list.includes(name)) return name;
    const normalize = s => s.toLowerCase().replace(/[._ ]/g, '-');
    const exact = list.filter(s => normalize(s) === normalize(name));
    if (exact.length === 1) return exact[0];
    if (exact.length > 1) return null;
    const bare = s => normalize(s).replace(/^[^/]+\//, '');
    const hits = list.filter(s => bare(s) === bare(name));
    return hits.length === 1 ? hits[0] : null;
}
export function modelPickerHtml(model, result = {}, recommended = '', group = false) {
    const list = result.models ?? [], hit = matchListedModel(recommended, list);
    const ordered = hit ? [hit, ...list.filter(m => m !== hit)] : list;
    const missing = model && !list.includes(model);
    return `<span data-model-picker style="flex:1 1 14em;min-width:12em"><input class="text_pole" data-model-search placeholder="搜索型号" aria-label="搜索型号"${list.length ? '' : ' hidden'}>
      <select class="text_pole" data-model-select aria-label="选择型号"${list.length ? '' : ' hidden'}><option value="">选择型号</option>${ordered.map(m=>`<option value="${escapeHtml(m)}"${m===model?' selected':''}>${escapeHtml(m)}${m===hit?' · 推荐':''}</option>`).join('')}${missing?`<option value="${escapeHtml(model)}" selected>${escapeHtml(model)}（列表里没有）</option>`:''}<option value="__manual__">手填……</option></select>
      <input class="text_pole" ${group?'data-group-model':'data-f="model"'} data-model-input aria-label="手填型号" value="${escapeHtml(model ?? '')}"${list.length?' hidden':''}>
      <small data-model-error>${escapeHtml(result.error ?? (list.length ? '' : '还没有型号列表，可先手填。'))}</small><span data-model-suggestion></span>
      <button class="menu_button" style="width:auto;white-space:nowrap" type="button" data-model-refresh title="重新读取渠道型号，拉不到仍可手填。">刷新列表</button></span>`;
}
export function stageGroupsHtml(value, lists = {}) {
    return (value.groups ?? []).map(group => {
        const selected = stageGroupState(value.stages, group.ids);
        return `<section data-model-group="${group.id}" style="margin:.6em 0;padding-bottom:.6em;border-bottom:1px solid var(--SmartThemeBorderColor)"><h4>${escapeHtml(group.name)}</h4><small style="display:block">${escapeHtml(group.help)}</small>
          ${selected.same ? '' : `<small style="display:block">各不相同：${selected.rows.map(s=>`${escapeHtml(s.name)}：${escapeHtml(s.key ?? '原配置')}／${escapeHtml(s.model ?? '未配')}`).join('；')}</small>`}
          <div style="display:flex;gap:.4em;flex-wrap:wrap;margin-top:.3em"><select style="flex:0 0 8em" data-group-key aria-label="${group.name}钥匙"><option value="">跟原配置</option>${value.keys.map(k=>`<option value="${escapeHtml(k.name)}"${k.name===selected.key?' selected':''}>${escapeHtml(k.name)}</option>`).join('')}</select>
          ${modelPickerHtml(selected.model,lists[group.ids[0]],value.stages.find(s=>s.id===group.ids[0])?.recommended,true)}
          <button class="menu_button" type="button" style="width:auto;white-space:nowrap;flex:0 0 auto" data-group-save="${group.id}" title="同时保存本组钥匙型号，建议先核对。">保存这一组</button></div>
          ${group.ids.includes('extract')?`<label>每几条总结一次 <input class="text_pole" data-summary-batch type="number" min="1" max="8" step="1" value="${value.batch??1}" style="width:5em;display:inline-block"></label><small style="display:block">攒几条一起总结，省一点钱；后台记住的事会晚几条。</small><small style="display:block">攒不够的话，最早那条等满 30 分钟也会总结；已设等待时间的照原值。</small>`:''}
          ${group.id==='fast'?`<label><input type="checkbox" data-advisor-enabled${value.advisorEnabled?' checked':''}> 参谋</label><small style="display:block">给原作知识不强的规划模型补原作世界观：翻这一局素材包里的原作资料。同人局用；原创世界、没装素材包的局可以关。</small>`:''}</section>`;
    }).join('');
}
async function openFreshSettings() {
    const c=ctx(),chatKey=state.chatKey,box=document.createElement('div');
    let value=await api('fresh-config',{chatKey});
    const draw=()=>{box.innerHTML=`<h3>去复读（全局）</h3>
      <label><input type="checkbox" data-fresh-switch="fresh.dropEchoes"${value.dropEchoes?' checked':''}>第一档：去掉复述开头</label><small>程序去复述半句，不花钱，建议保持开启。</small>
      <label><input type="checkbox" data-fresh-switch="fresh.enabled"${value.enabled?' checked':''}>第二档：按角色改口吻</label><small>${escapeHtml(value.guidance)}</small><small>只改已绑定角色，会调用模型，建议按需开。旧配置开着但没语料时只走第一档。</small>
      <p>当前窗口名册里有卡的人：<select data-fresh-person>${value.cast.map(a=>`<option value="${escapeHtml(a.avatar)}">${escapeHtml(a.name)}</option>`).join('')}</select></p>
      ${chatKey?'':'<small>先打开并接入聊天，才能选择本局角色。</small>'}
      <textarea class="text_pole" data-fresh-text rows="8" placeholder="粘贴角色台词，只用于学习口吻，不会改角色卡。"></textarea><input data-fresh-file type="file" accept=".md,.txt">
      <button class="menu_button" type="button" style="width:auto;white-space:nowrap" data-voice-act="save" title="绑定所选角色语料，建议挑代表台词。">保存绑定</button>
      <p data-fresh-warning>${escapeHtml(value.warning??'')}</p><h4>本局已绑定</h4>
      ${value.cast.filter(a=>a.bound).map(a=>`<p>${escapeHtml(a.name)}（${a.chars}字）<button class="menu_button" type="button" style="width:auto;white-space:nowrap" data-voice-act="read" data-avatar="${escapeHtml(a.avatar)}" title="查看并可替换语料，建议先核对。">看／换</button><button class="menu_button" type="button" style="width:auto;white-space:nowrap" data-voice-act="remove" data-avatar="${escapeHtml(a.avatar)}" title="解除语料绑定，建议确认不再使用。">删</button></p>`).join('')||'<small>还没有绑定；没有语料的角色不调第二档模型。</small>'}`;};
    draw();
    box.addEventListener('change',async event=>{try{
        if(event.target.dataset.freshSwitch){await api('tuning',{set:event.target.dataset.freshSwitch,value:event.target.checked});value=await api('fresh-config',{chatKey});}
        if(event.target.matches('[data-fresh-file]')){const file=event.target.files?.[0];if(file){if(!/\.(md|txt)$/i.test(file.name))throw Error('请选择md或txt文件');box.querySelector('[data-fresh-text]').value=await file.text();}}
    }catch(e){globalThis.toastr?.error(e.message);}});
    box.addEventListener('click',async event=>{const action=event.target.dataset.voiceAct;if(!action)return;try{
        const avatar=event.target.dataset.avatar??box.querySelector('[data-fresh-person]').value;
        if(action==='read'){const result=await api('fresh-config',{chatKey,action,avatar});box.querySelector('[data-fresh-person]').value=avatar;box.querySelector('[data-fresh-text]').value=result.text;return;}
        if(action==='remove'&&!await c.callGenericPopup('删除该角色的口吻语料？第二档将不再改这个角色。',c.POPUP_TYPE.CONFIRM))return;
        value=await api('fresh-config',{chatKey,action,avatar,text:action==='save'?box.querySelector('[data-fresh-text]').value:undefined});draw();if(value.warning)globalThis.toastr?.warning(value.warning);
    }catch(e){globalThis.toastr?.error(e.message);}});
    await c.callGenericPopup(box,c.POPUP_TYPE.TEXT,'',{wide:true,okButton:'关上'});
}

async function openStages() {
    const box = document.createElement('div');
    box.style.textAlign = 'left';
    let v = await api('stages', {});
    const lists = {};   // 拉到的型号列表：环节 → [型号]
    const hydrate = async () => { await Promise.all(v.stages.map(async s => { lists[s.id] = await api('stage-models', { stage:s.id }); })); };
    await hydrate();
    let fitted = null;   // 只有一把钥匙时比过的结果：{ models, missing }
    const money = n => `$${Number(n).toFixed(n >= 1 ? 2 : 3)}`;
    const draw = () => {
        const keyOpts = cur => ['<option value="">跟着原配置</option>', ...v.keys.map(k => `<option value="${escapeHtml(k.name)}"${k.name === cur ? ' selected' : ''}>${escapeHtml(k.name)}</option>`)].join('');
        const effortOpts = s => ['<option value="">默认档</option>', ...v.efforts.map(e => `<option${e === s.effort ? ' selected' : ''}>${e}</option>`)].join('');
        const effortNote = s => (s.effortOk === true ? '' : s.effortOk === 'output_config' ? '（按 Anthropic 的写法传）' : s.effortOk === false ? '（这条线传不过去，用默认档）' : '（没测过）');
        box.innerHTML = `<h3>各环节的模型</h3>
            <p><small>每个环节用哪把钥匙、哪个型号、按什么单价计费。不选就跟着原来的配置走。改了下一次调用就生效。思考档要先"测一次"（真调一两次极短的，几分钱），传得过去才会发；开了会更慢、更费钱（想的部分按输出算），检索词、检查、去复读这类要快的短活一般别开。</small></p>
            <h4>钥匙簿</h4>
            ${!v.keys.length ? '<p><small>先存一把钥匙。只有一把，各环节就都用它；有一把调 Claude、一把调 Gemini 的，名字照写"Claude""Gemini"，各环节照推荐的分。</small></p>' : ''}
            ${v.alone ? `<div style="margin:.3em 0"><small>只有一把钥匙「${escapeHtml(v.alone)}」：各环节都用它，型号照推荐的。它要是调不了某些推荐型号（中转只开了一家、或者是别家的钥匙），比一比再一键换。</small>
              <button class="menu_button" style="white-space:nowrap" data-st="fit" type="button" title="核对线路可用型号，建议换线路后查。">看看它调得了推荐的型号吗（不花钱）</button>
              ${fitted ? (fitted.missing.length ? `<div style="margin:.3em 0"><small>这几格的型号它调不了：${fitted.missing.map(x => `${escapeHtml(x.name)}（${escapeHtml(x.model)}）`).join('、')}。</small>
                <div style="display:flex;gap:.4em;flex-wrap:wrap;align-items:center"><select class="text_pole" data-f="fitmodel" style="flex:1 1 14em">${fitted.models.map(m => `<option>${escapeHtml(m)}</option>`).join('')}</select>
                <button class="menu_button" style="flex:0 0 auto;white-space:nowrap" data-st="use-model" type="button" title="统一选用此型号，建议确认适合各环节。">调不了的这几格都换成它</button></div></div>` : '<div><small>推荐的型号它都调得了。</small></div>') : ''}</div>` : ''}
            ${v.keys.map(k => `<div style="display:flex;gap:.5em;align-items:center;margin:.25em 0"><b style="flex:0 0 8em">${escapeHtml(k.name)}</b><small style="flex:1;overflow-wrap:anywhere">${escapeHtml(k.baseUrl)} · ${escapeHtml(k.tail)}</small><button class="menu_button" style="flex:0 0 auto;white-space:nowrap" data-st="remove-key" data-name="${escapeHtml(k.name)}" type="button" title="删除钥匙，建议确认没有环节需要。">删</button></div>`).join('') || '<p><small>还没有。原来配置里的钥匙照样在用（"跟着原配置"）。</small></p>'}
            ${v.wanted?.length ? `<p style="color:var(--warning,orange)"><small>还缺这几把钥匙：${v.wanted.map(n => `「${escapeHtml(n)}」`).join('、')}。照这个名字存进钥匙簿，用到它的环节就通了。</small></p>` : ''}
            <div style="display:flex;gap:.4em;flex-wrap:wrap;margin:.4em 0">
              <input class="text_pole" data-f="kname" placeholder="名字" style="flex:0 0 7em">
              <input class="text_pole" data-f="kurl" placeholder="地址 https://…/v1" style="flex:1 1 14em">
              <input class="text_pole" data-f="kkey" type="password" autocomplete="off" placeholder="钥匙（改地址时可空，沿用原来那把）" style="flex:1 1 14em">
              <button class="menu_button" style="flex:0 0 auto;white-space:nowrap" data-st="save-key" type="button" title="保存这把钥匙，建议核对地址后存。">存</button>
            </div>
            ${stageGroupsHtml(v, lists)}<details><summary>逐项调（进阶）</summary><h4>各环节</h4>
            ${v.stages.map(s => `<div data-stage="${s.id}" style="margin:.5em 0;padding:.4em .6em;border-left:3px solid var(--SmartThemeQuoteColor,#888)">
              <div><b>${escapeHtml(s.name)}</b><small data-stage-help="${s.id}">${escapeHtml(stageHelp(s.id))}</small>${s.id==='situation'?'<small>各方在镜头外的动向、消息怎么传开。按开局单的时间尺度：一跳几十年的局，把时间尺度设成“年”。一次跳很久最多补推三次。</small>':''} <small style="opacity:.8">今天 ${s.today.calls} 次，约 ${money(s.today.usd)}${s.chosen ? '' : ` · 没另选（跟着${escapeHtml(s.follows)}）`} · 此刻：${s.off ? '关着' : s.waits ? `${escapeHtml(s.model ?? '（没配）')}，等钥匙「${escapeHtml(s.waits)}」` : `${escapeHtml(s.model ?? '（没配）')}，${escapeHtml(s.auto ? `自动用了"${s.auto}"` : s.key ?? '原配置')} ${escapeHtml(s.tail)}`}</small></div>
              <div style="display:flex;gap:.4em;flex-wrap:wrap;align-items:center;margin-top:.3em">
                <select class="text_pole" data-f="key" style="flex:0 0 9em">${keyOpts(s.key)}</select>
                ${modelPickerHtml(s.model,lists[s.id],s.recommended)}
                <label><small>入</small> <input class="text_pole" data-f="in" value="${s.priceInPerM}" style="width:4.5em;display:inline-block"></label>
                <label><small>出</small> <input class="text_pole" data-f="out" value="${s.priceOutPerM}" style="width:4.5em;display:inline-block"></label>
                <small>美元／百万</small>
              </div>
              <div style="display:flex;gap:.4em;flex-wrap:wrap;align-items:center;margin-top:.3em">
                <select class="text_pole" data-f="effort" style="flex:0 0 7em"${s.effortOk === true || s.effortOk === 'output_config' ? '' : ' disabled'}>${effortOpts(s)}</select>
                <small style="opacity:.8">${effortNote(s)}</small>
                <button class="menu_button" style="flex:0 0 auto;white-space:nowrap" data-st="probe" type="button" title="实调一次测思考档，会收费，按需测。">测一次思考档</button>
                <button class="menu_button" style="flex:0 0 auto;white-space:nowrap" data-st="save" type="button" title="保存本格选择，建议先核对型号。">改</button>
                ${s.chosen ? '<button class="menu_button" style="flex:0 0 auto;white-space:nowrap" data-st="reset" type="button" title="恢复默认跟随，建议不单独配时用。">恢复成跟着原配置</button>' : ''}
                ${s.id === 'embed' ? `<button class="menu_button" style="flex:0 0 auto;white-space:nowrap" data-st="${s.off ? 'embed-on' : 'embed-off'}" type="button" title="切换向量检索，建议有嵌入模型再开。">${s.off ? '打开向量' : '关掉向量（照旧配检索词）'}</button>` : ''}
              </div>
            </div>`).join('')}</details>`;
    };
    const pickerRow = target => target.closest('[data-model-group], [data-stage]');
    const pickerStage = row => row.dataset.stage ?? v.groups.find(g=>g.id===row.dataset.modelGroup).ids[0];
    const pickerKey = row => row.querySelector('[data-group-key], [data-f="key"]')?.value || null;
    const suggest = picker => {
        const row=pickerRow(picker), list=lists[pickerStage(row)]?.models??[], input=picker.querySelector('[data-model-input]');
        const hit=list.includes(input.value)?null:matchListedModel(input.value,list), note=picker.querySelector('[data-model-suggestion]');
        note.innerHTML=hit?`<small>这个渠道里写作 ${escapeHtml(hit)}，要换成它吗？</small><button class="menu_button" style="width:auto;white-space:nowrap" type="button" data-model-use="${escapeHtml(hit)}" title="换成渠道返回的原名。">换成它</button>`:'';
    };
    const refreshPicker = async (row, refresh=false) => {
        const id=pickerStage(row), selectedKey=pickerKey(row), picker=row.querySelector('[data-model-picker]'), model=picker.querySelector('[data-model-input]').value;
        const result=await api('stage-models',{stage:id,key:selectedKey,refresh});
        if(!row.isConnected || pickerKey(row)!==selectedKey)return;
        lists[id]=result;
        picker.outerHTML=modelPickerHtml(model,result,v.stages.find(s=>s.id===id)?.recommended,!!row.dataset.modelGroup);
    };
    box.addEventListener('input',event=>{
        const picker=event.target.closest('[data-model-picker]');if(!picker)return;
        if(event.target.matches('[data-model-search]'))for(const option of picker.querySelector('[data-model-select]').options)option.hidden=!!option.value&&option.value!=='__manual__'&&!option.textContent.toLowerCase().includes(event.target.value.toLowerCase());
        if(event.target.matches('[data-model-input]'))suggest(picker);
    });
    box.addEventListener('change', async event => { try {
        if(event.target.matches('[data-model-select]')){const picker=event.target.closest('[data-model-picker]'),input=picker.querySelector('[data-model-input]');input.hidden=event.target.value!=='__manual__';if(input.hidden)input.value=event.target.value;suggest(picker);}
        if(event.target.matches('[data-group-key], [data-f="key"]'))await refreshPicker(pickerRow(event.target));
        if(event.target.matches('[data-summary-batch]')){await api('tuning',{set:'extractor.batch',value:event.target.value===''?null:Number(event.target.value)});v=await api('stages',{});event.target.value=v.batch;}
        if(event.target.matches('[data-advisor-enabled]')) { await api('tuning',{set:'advisor.enabled',value:event.target.checked});v=await api('stages',{});draw(); }
    }catch(e){globalThis.toastr?.error(e.message);} });
    box.addEventListener('click', async event => {
        if(event.target.hasAttribute('data-model-refresh')){try{await refreshPicker(pickerRow(event.target),true);}catch(e){globalThis.toastr?.error(e.message);}return;}
        if(event.target.dataset.modelUse){const picker=event.target.closest('[data-model-picker]');picker.querySelector('[data-model-input]').value=event.target.dataset.modelUse;const select=picker.querySelector('[data-model-select]');select.value=event.target.dataset.modelUse;picker.querySelector('[data-model-input]').hidden=true;suggest(picker);return;}
        const groupId=event.target.dataset.groupSave;
        if(groupId){const group=v.groups.find(g=>g.id===groupId),row=event.target.closest('[data-model-group]');try{v=await saveStageGroup(group.ids,{key:row.querySelector('[data-group-key]').value,model:row.querySelector('[data-group-model]').value},api);draw();}catch(e){v=await api('stages',{});draw();globalThis.toastr?.error('本组未全部保存：'+e.message);}return;}
        const act = event.target?.dataset?.st;
        if (!act) return;
        const row = event.target.closest('[data-stage]');
        const id = row?.dataset.stage;
        const f = name => (row ?? box).querySelector(`[data-f="${name}"]`)?.value ?? '';
        event.target.disabled = true;
        try {
            if (act === 'save-key') { v = await api('stages', { saveKey: { name: f('kname'), baseUrl: f('kurl'), apiKey: f('kkey') } }); await hydrate(); globalThis.toastr?.success('钥匙存好了。'); }
            if (act === 'remove-key') {
                const ok = await ctx().callGenericPopup(`删掉钥匙"${escapeHtml(event.target.dataset.name)}"？用着它的环节回到跟着原配置。`, ctx().POPUP_TYPE.CONFIRM);
                if (ok) v = await api('stages', { removeKey: event.target.dataset.name });
            }
            if (act === 'fit') {
                const r = await api('stages-fit', {});
                if (r.error) globalThis.toastr?.warning(`没比成：${r.error}`);
                else fitted = r;
            }
            if (act === 'use-model') {
                v = await api('stages-fit', { useModel: f('fitmodel') });
                globalThis.toastr?.success(`换了 ${v.changed} 格。单价按这个型号的常见价算，不认识的按贵的估，可以在下面各环节里改。`);
                fitted = null;
            }
            if (act === 'models') {
                const r = await api('stage-models', { stage: id, key: f('key') || null, refresh:true });
                lists[id] = r;
                if (r.error || !r.models.length) globalThis.toastr?.warning(`没拉到型号列表${r.error ? `：${r.error}` : ''}，手填型号就行。`);
                else globalThis.toastr?.info(`拉到 ${r.models.length} 个型号，点型号那一栏选。`);
            }
            if (act === 'save') {
                // 换了型号、单价没动：单价交给后台按型号定（认识的给常见价，不认识的按贵的估），免得沿用上一个型号的价
                const s = v.stages.find(x => x.id === id);
                const keep = f('model') !== (s.model ?? '') && f('in') === String(s.priceInPerM) && f('out') === String(s.priceOutPerM);
                v = await api('stages', { set: { id, key: f('key') || null, model: f('model'), priceInPerM: keep ? null : f('in'), priceOutPerM: keep ? null : f('out'), effort: f('effort') } });
                globalThis.toastr?.success('改好了，下一次调用就用它。');
            }
            if (act === 'reset') v = await api('stages', { reset: id });
            if (act === 'embed-off' || act === 'embed-on') v = await api('stages', { set: { id, off: act === 'embed-off' } });
            if (act === 'probe') {
                globalThis.toastr?.info('在测，慢的型号要一两分钟。');
                const r = await api('stage-probe', { stage: id }, 230000);
                v = r;
                globalThis.toastr?.[r.ok ? 'success' : 'warning'](r.ok === true ? `${r.model} 传得过去思考档。` : r.ok === false ? `${r.model} 经这条线传不过去思考档，就用默认档。` : `这次没测成（${r.status}），线路本身可能不通，过会儿再测。`);
            }
        } catch (error) { globalThis.toastr?.error(error.message); }
        draw();
    });
    draw();
    await ctx().callGenericPopup(box, ctx().POPUP_TYPE.TEXT, '', { wide: true, large: true, allowVerticalScrolling: true, okButton: '关闭' });
}

async function pasteSetup(chatKey) {
    const c = ctx();
    const { result, text } = await textPopup('开局单：贴一整段',
        '大纲、开场稿、设定都行，不用先拆。后台分到各格（基调、类别、生活现状、原则、前史、原作走向、称呼口径、主线、储备线、意向），你再核对。会调一次模型（几毛钱），一两分钟。',
        '', { ok: '让系统分格', cancel: '取消', rows: 16 });
    if (result !== c.POPUP_RESULT.AFFIRMATIVE || !text.trim()) return;
    await api('setup', { chatKey, source: text });
    globalThis.toastr?.info('在分格，一两分钟，好了会提醒。');
    watchSetup(chatKey);
}

function watchSetup(chatKey, tries = 0) {
    clearTimeout(state.setupTimer);
    state.setupTimer = setTimeout(async () => {
        try {
            const s = await api('setup', { chatKey });
            if (s.draft?.status === 'working' || s.draft?.status === 'handoff') {
                if (s.draft.status === 'handoff' && !state.setupHandoffTold) { state.setupHandoffTold = true; globalThis.toastr?.warning(`调模型分格没响应，${s.draft.error}。打开“此刻 → 外援”，复制题目给任何一个 AI，把回答贴回来点“交回”。`); }
                if (tries < 720) watchSetup(chatKey, tries + 1);
                return;
            }
            state.setupHandoffTold = false;
            if (s.draft?.status === 'draft') globalThis.toastr?.success('开局单分好了，点面板里的"开局单"核对。', 'RP：幕后', { timeOut: 15000 });
            else if (s.draft?.status === 'failed') globalThis.toastr?.warning(`开局单没分成：${s.draft.error}`);
        } catch { if (tries < 80) watchSetup(chatKey, tries + 1); }
    }, 5000);
}

function chatIds(c) {
    return { stChatId: c.chatId ?? c.getCurrentChatId?.() ?? null, groupId: c.groupId ?? null };
}
function currentGroup(c) {
    return c.groupId ? c.groups?.find(g => g.id == c.groupId) ?? null : null;
}
// 单聊里旧消息可能没记 original_avatar，缺的就算这张卡的。
function fallbackAvatar(c) {
    return c.groupId ? null : c.characters?.[c.characterId]?.avatar ?? null;
}
// 旁白卡（N-276）：只是载体，不算群里的人——不进名册、不算在场
function cameraOf(c) {
    const cam = (c.characters ?? []).find(isCamera) ?? null;
    setCamera(cam?.avatar);
    return cam;
}
const CAMERA_PICK = '__rpe_camera__';   // 面板预览里"旁白（镜头）"那一项
function members(c) {
    const group = currentGroup(c);
    if (group) {
        const cam = cameraOf(c)?.avatar;
        return group.members.filter(avatar => avatar !== cam).map(avatar => ({
            avatar, name: c.characters.find(x => x.avatar === avatar)?.name ?? null,
            disabled: !!group.disabled_members?.includes(avatar),
        }));
    }
    const character = c.characters?.[c.characterId];
    return character ? [{ avatar: character.avatar, name: character.name, disabled: false }] : [];
}

function clearPrompts() {
    restoreCameraPrompts();
    state.cameraGenerating = false;
    const prompts = ctx().extensionPrompts;
    if (prompts) for (const key of Object.values(KEYS)) delete prompts[key];
    for (const k of SLOT_MACROS) live[k] = '';
}

// ---------- 同步 ----------

function scheduleSync(delay = 1500) {
    if (!state.chatKey || !settings().enabled) return;
    clearTimeout(state.timer);
    state.timer = setTimeout(() => syncNow(), delay);
}

async function syncNow(force = false) {
    if (!state.chatKey || !settings().enabled) return;
    if (state.syncing) { state.dirty = true; return; }
    state.syncing = true;
    clearTimeout(state.timer);   // 这就同步了：排着的那一次不用再来（一轮里同步四次，一半是重复的）
    const epoch = state.epoch;
    const tStart = performance.now();
    let changed = force;
    try {
        do {
            state.dirty = false;
            const c = ctx();
            await sendPersona();
            if (epoch !== state.epoch) return;
            cameraOf(c);   // 旁白卡写的记 narrator：先认出它再算指纹
            const tb = performance.now();
            const { seq, bodies } = buildSequence(c.chat, fallbackAvatar(c));
            tick('同步:算指纹', performance.now() - tb, `${seq.length} 条`);
            const payload = {
                chatKey: state.chatKey, seq, force, members: members(c),
                anchors: c.chatMetadata?.contextIsolation?.anchors ?? null,
            };
            let result = await api('sync', payload);
            if (result.need?.length) {
                for (const batch of batches(result.need.map(f => bodies.get(f)).filter(Boolean))) {
                    if (epoch !== state.epoch) return;
                    await api('messages', { chatKey: state.chatKey, messages: batch });
                }
                if (epoch !== state.epoch) return;
                result = await api('sync', payload);
            }
            state.collapsed = result.collapsed ?? null;
            if (result.added || result.removed || result.edited) changed = true;
            force = false;
            state.note = '';
        } while (state.dirty && epoch === state.epoch);
        if (epoch === state.epoch) {
            state.status = await api('status', { chatKey: state.chatKey });
            noticeHandoffs(state.status.handoffs);
            noticeStory(state.chatKey, state.status.notice);
            // 门、日期标签、世界书、记账进度：聊天有变化、或者隔了一阵才刷（同一轮里重复的同步不再跟一串请求）
            const stale = Date.now() - (state.fanAt ?? 0) > 8000;
            if (changed || stale) {
                state.fanAt = Date.now();
                await refreshDoor();
                refreshDays();
                refreshLore();
                refreshPlan();
            }
            void sendPersona().catch(() => {});
            // 打开窗口后第一次同步完：把 ST 里现有的卡交给后台补名册（新卡给默认档，用户改过的不动）。
            if (state.castSent !== state.chatKey) {
                state.castSent = state.chatKey;
                const chars = ctx().characters ?? [];
                const chatKeyNow = state.chatKey;
                api('cast', { chatKey: chatKeyNow, cards: chars.map(ch => ({ avatar: ch.avatar, name: ch.name, gender: ch.gender ?? ch.data?.gender, hash: cardHash(cardText(ch)) })) })
                    .then(r => {
                        // 这一局用得上、后台还没读过（或卡改过）的卡：把正文交过去，后台写"兴趣和习惯"
                        const texts = (r.need ?? []).map(a => chars.find(ch => ch.avatar === a)).filter(Boolean)
                            .map(ch => ({ avatar: ch.avatar, name: ch.name, gender: ch.gender ?? ch.data?.gender, hash: cardHash(cardText(ch)), text: cardText(ch) })).filter(t => t.text.trim());
                        if (texts.length) return api('cast', { chatKey: chatKeyNow, texts });
                    }).catch(() => {});
                api('absence', { chatKey: state.chatKey }).then(a => { state.absence = a; render(); }).catch(() => {});
                checkReturn(state.chatKey, epoch);
                refreshPlanStatus();
                api('pack', { chatKey: state.chatKey }).then(p => { state.pack = p; render(); }).catch(() => {});
                void refreshRelationsDraft();
            }
        }
    } catch (error) {
        if (epoch === state.epoch) {
            state.note = error.status === 404 ? '后台没有这个窗口的记录。' : '后台暂时连不上；ST 照常可用。';
            if (error.status !== 404) scheduleSync(30000);
        }
    } finally {
        state.syncing = false;
        tick('同步:整个', performance.now() - tStart);
        render();
    }
}

// 玩家的人设交给后台（N-368）：接入、切窗口、每次同步完都看一眼，名字和描述跟上次发的一样就不发；拿不到就不发，发不出去下次再试，不报错
async function sendPersona(chatKey = state.chatKey) {
    personaWatch.check();
    if (state.personaFlight) await state.personaFlight;
    let p = null;
    try { if (chatKey === ctx().chatMetadata?.rp_emergence?.chatKey) p = personaPayload(ctx(), chatKey); } catch {}
    if (!p || state.personaSent === p.key) return;
    const flight = api('persona', p.body).then(() => { state.personaSent = p.key; });
    state.personaFlight = flight;
    try { await flight; } finally { if (state.personaFlight === flight) state.personaFlight = null; }
}

const personaWatch = createPersonaWatch({
    current: () => {
        const c = ctx(), mark = c.chatMetadata?.rp_emergence?.chatKey;
        // ST 重新打开空聊天时，后台 open 尚未返回，state.chatKey 会暂时空着；
        // 聊天自己的标记和 ST 身份仍在，不能因此把同窗切人设误当首次读到。
        if (!settings().enabled || !mark || (state.chatKey === mark && state.status?.enabled === false)) return null;
        return { key: chatIds(c).stChatId, name: String(c.name1 ?? '').trim() };
    },
    onChange: (from, to) => {
        globalThis.toastr?.info(`人设换了：${from} → ${to}。之后的规划会按 ${to}；要是点错了，现在切回去。`, 'RP：幕后');
        void sendPersona().then(() => refreshPlanStatus()).catch(() => {});
    },
});

async function confirmPersonaNow(chatKey, name) {
    await sendPersona(chatKey);
    if (ctx().chatMetadata?.rp_emergence?.chatKey !== chatKey || String(ctx().name1 ?? '').trim() !== name) throw new Error('人设变了，请重新核对');
    await api('plan-persona', { chatKey, confirm: true, name });
    refreshPlanStatus();
}

async function askPlanPersona(wait) {
    if (!wait || state.personaPromptBusy) return;
    const c = ctx(), chatKey = state.chatKey, name = wait.current || String(c.name1 ?? '').trim();
    const key = `${chatKey}:${wait.id}:${name}`;
    state.personaPrompted ??= new Set();
    if (state.personaPrompted.has(key)) return;
    state.personaPrompted.add(key); state.personaPromptBusy = true;
    try {
        const continuing = state.personaFallback?.chatKey === chatKey && state.personaFallback.name !== name;
        const html = continuing ? `<h3>用「${escapeHtml(name)}」继续规划吗？</h3>` : `<h3>确认规划人设</h3><p>这一局的规划要按人设「${escapeHtml(name || '当前未知')}」来排（${wait.previous ? `上次是「${escapeHtml(wait.previous)}」` : '这是第一份规划'}）。</p>`;
        const result = await c.callGenericPopup(html, c.POPUP_TYPE.CONFIRM, '', { okButton: continuing ? '继续' : '确认用此人设', cancelButton: '更改人设' });
        if (state.chatKey !== chatKey) return;
        if (result === c.POPUP_RESULT.AFFIRMATIVE) { await confirmPersonaNow(chatKey, name); state.personaFallback = null; return; }
        if (result !== c.POPUP_RESULT.NEGATIVE) return;
        const choices = Object.entries(stPowerUser?.power_user?.personas ?? c.powerUserSettings?.personas ?? {}).filter(([,n]) => typeof n === 'string' && n.trim());
        let selected = null;
        if (choices.length && typeof c.executeSlashCommandsWithOptions === 'function') {
            const pick = await c.callGenericPopup(`<h3>更改人设</h3><select class="text_pole" data-role="plan-persona-choice">${choices.map(([avatar,n]) => `<option value="${escapeHtml(avatar)}">${escapeHtml(n)}</option>`).join('')}</select>`, c.POPUP_TYPE.CONFIRM, '', { okButton: '用这个并继续', cancelButton: '先放着', onClosing: popup => { selected = popup.dlg.querySelector('[data-role="plan-persona-choice"]')?.value; return true; } });
            if (pick !== c.POPUP_RESULT.AFFIRMATIVE || state.chatKey !== chatKey) return;
            const target = choices.find(([a]) => a === selected);
            try {
                if (!target || /["\\\r\n|]/.test(target[0])) throw new Error('人设标识无法安全传给命令');
                await c.executeSlashCommandsWithOptions(`/persona-set mode=lookup "${target[0]}"`);
                if (ctx().chatMetadata?.rp_emergence?.chatKey !== chatKey || String(ctx().name1 ?? '').trim() !== target[1]) throw new Error('人设没有换过去');
                await confirmPersonaNow(chatKey, target[1]); state.personaFallback = null; return;
            } catch { /* 老酒馆命令不可用时留给人设页切换。 */ }
        }
        state.personaFallback = { chatKey, name };
        globalThis.toastr?.info('去用户设置页切到正确的人设，切好以后会自动继续', 'RP：幕后');
    } catch (error) { globalThis.toastr?.warning(error.message || '人设确认没成功，规划仍在等'); }
    finally { state.personaPromptBusy = false; }
}

// ---------- 窗口接入 ----------

async function onChatChanged() {
    const samePersonaWindow = state.personaWindow === chatIds(ctx()).stChatId;
    personaWatch.pause();
    if (!samePersonaWindow) { state.personaPrompted = new Set(); state.personaFallback = null; }
    state.personaWindow = chatIds(ctx()).stChatId;
    const epoch = ++state.epoch;
    state.lastCameraPrompt = null;
    state.lastPrompt = null;   // 换了窗口：上一次量的长度（别的卡、别的聊天）不作数
    clearTimeout(state.timer);
    clearTimeout(state.planTimer);
    clearTimeout(state.relationsTimer);
    state.relationsDraft = null;
    clearPrompts();
    Object.assign(state, { chatKey: null, status: null, plan: null, collapsed: null, note: '', door: { items: [], lit: null }, remote: null });
    Object.assign(auto, { on: null, unavailable: false, turnEnabled: null, buttons: true, jobs: new Map(), waiting: null, lastTurn: null, noRepeat: null, pending: new Map(), closed: new Set(), remote: new Map() });
    state.memberBase = memberSnapshot();   // 换了窗口：群成员名单的基线重记（不触发），不拿上一个窗口的名单比
    dayLabels = []; boardLabels = []; state.boardCast = [];
    drawDays();
    render();
    if (!settings().enabled) return;
    const c = ctx();
    cameraOf(c);
    const { stChatId, groupId } = chatIds(c);
    if (!stChatId) return;
    const mark = c.chatMetadata?.rp_emergence;
    try {
        if (!mark?.chatKey) {
            // 新开的窗口（只有开场白或空的）问一次要不要接；老窗口要用户点名才接（白皮书 §9.1-10）。
            if (freshChat(c) && !mark?.declined) await offerJoin(epoch);
            return;
        }
        const result = await api('open', {
            chatKey: mark.chatKey, stChatId, groupId,
            siblings: currentGroup(c)?.chats ?? null, mainChat: c.chatMetadata?.main_chat ?? null,
        });
        if (epoch !== state.epoch) return;
        if (result.status === 'unknown') { state.note = '这个窗口带着旧标记，但后台没有它的记录；可以重新接入。'; return; }
        if (result.status === 'branch') {
            c.chatMetadata.rp_emergence = { chatKey: result.chatKey };
            await c.saveMetadata();
        }
        state.chatKey = result.chatKey;
        personaWatch.check();
        scheduleSync(0);
        setTimeout(() => { if (epoch === state.epoch) autoPeek().catch(() => {}); }, 2500);
    } catch {
        if (epoch === state.epoch) {state.chatKey=mark.chatKey;auto.unavailable=true;state.note = '后台暂时连不上；ST 照常可用。';}
    } finally {
        render();
    }
}

// 新窗口＝用户还没说过话、只有开场白（群聊里每个成员各一条开场白，T-22 实测：两人的新群一开就是两条，以前只认"至多一条"，从来不问）。
const freshChat = c => !(c.chat ?? []).some(m => m.is_user) && (c.chat ?? []).length <= Math.max(1, members(c).length);

// 新窗口问一次：接入／这次不用／这个窗口别再问（"别再问"记在聊天自己的元数据里，跟着聊天文件走）。
// 只开个窗玩几十轮短线的，不必过系统（开局单 §四）。
const asked = new Set();
// ST 欢迎页的助手（默认那张，或用户在"更多"里指定的）开的聊天不是 RP，不问。
function isWelcomeAssistant(c) {
    const avatar = c.groupId ? null : c.characters?.[c.characterId]?.avatar;
    return !!avatar && avatar === (c.accountStorage?.getItem?.('assistant') ?? 'default_Assistant.png');
}
async function offerJoin(epoch) {
    const mode = settings().newChats;
    if (mode === 'off' || state.importingPack) return;   // 导入开局包时那边自己接入，不弹
    // 切聊天时 ST 会先发一次"聊天还空着"的切换事件、载完再发一次：等它稳下来，确认真是新窗口再说。
    await new Promise(resolve => setTimeout(resolve, 800));
    const c = ctx();
    if (epoch !== state.epoch) return;
    if (c.chatMetadata?.rp_emergence?.chatKey) return onChatChanged();   // 载完才看到标记：按已接入的窗口打开
    if (!freshChat(c) || c.chatMetadata?.rp_emergence || isWelcomeAssistant(c)) return;
    if (mode === 'auto') return join(epoch);
    const { stChatId, groupId } = chatIds(c);
    const key = `${groupId ?? ''}/${stChatId}`;
    if (asked.has(key) || !c.callGenericPopup) return;
    asked.add(key);
    const label = currentGroup(c)?.name ?? c.characters?.[c.characterId]?.name ?? '这个窗口';
    const answer = await c.callGenericPopup(
        `<h3>「${escapeHtml(label)}」这个新窗口接入 RP：幕后吗？</h3><p>接入后，后台记住这个窗口里发生的事，每个角色发言前拿到他该知道的那一格；离开、有人来找、规划这些也跟着这一局走。</p><p>只是开个窗玩一小段的，可以不接。以后想接，到扩展面板“设置”里勾选“本窗口接入”。</p>`,
        c.POPUP_TYPE.TEXT, '', { okButton: '接入', cancelButton: '这次不用', customButtons: [{ text: '这个窗口别再问', result: c.POPUP_RESULT.CUSTOM1 }] });
    if (epoch !== state.epoch) return;
    if (answer === c.POPUP_RESULT.AFFIRMATIVE) return join(epoch);
    if (answer === c.POPUP_RESULT.CUSTOM1) {
        c.chatMetadata.rp_emergence = { declined: true };
        await c.saveMetadata();
    }
}

// 同一个聊天同一时刻只接入一次（新建聊天时 ST 会连发切换事件）。
const joining = new Map();
async function join(epoch = state.epoch) {
    const c = ctx();
    const { stChatId, groupId } = chatIds(c);
    if (!stChatId) return;
    const label = currentGroup(c)?.name ?? c.characters?.[c.characterId]?.name ?? null;
    const key = `${groupId ?? ''}/${stChatId}`;
    if (!joining.has(key)) joining.set(key, api('join', { stChatId, groupId, label }).finally(() => joining.delete(key)));
    const result = await joining.get(key);
    if (epoch !== state.epoch) return;
    c.chatMetadata.rp_emergence = { chatKey: result.chatKey };
    await c.saveMetadata();
    state.chatKey = result.chatKey;
    scheduleSync(0);
    setTimeout(() => autoPeek().catch(() => {}), 2500);   // 自动进离场开没开：开了就把群改成手动策略
}

// ---------- 发言前注入 ----------

globalThis.rpEmergenceIntercept = async (_chat, _contextSize, _abort, type) => {
    clearPrompts();
    if (!settings().enabled || !state.chatKey || !INJECT_TYPES.has(type ?? 'normal')) return;
    keepRecentRounds(_chat, Number(settings().historyRounds) || 0);
    if (settings().digestOld) await digestOld(_chat).catch(() => {});
    const c = ctx();
    const character = c.characters?.[c.characterId];
    if (!character) return;
    cameraOf(c);
    const camera = isCamera(character);
    // 发消息、打电话来的那几条（extra.rp_vis）同屋别的有卡的人看不见：发出去的这份按开口的人筛（方案 自动进离场与调度，N-377）
    filterVisible(_chat, camera ? '旁白' : character.name, c.name1);
    if (camera) {
        setCamera(character.avatar);
        isolateCameraPrompts(character);
        state.cameraGenerating = true;
    }
    const tSlot = performance.now();
    const epoch = state.epoch, chatKey = state.chatKey, speaker = camera ? 'narrator' : character.avatar;
    // 左滑重生成/续写时，被替换的那条不算上文 ⇒ 和第一次生成拿到同一格。
    let rows = c.chat;
    const last = rows.at(-1);
    if ((type === 'swipe' || type === 'continue') && last && !last.is_user && speakerOf(last, fallbackAvatar(c)) === speaker) rows = rows.slice(0, -1);
    const before = rows.at(-1);
    const anchor = before ? `${rows.length}:${fingerprintMessage(before, speakerOf(before, fallbackAvatar(c)))}` : 'start';
    // 最近几句正文（后台拿来找相关的旧事；你刚发的那句可能还没同步过去）和此刻在场的人。
    const recent = rows.slice(-3).map(m => String(m.mes ?? ''));
    const recentUser = String([...rows.slice(-6)].reverse().find(m => m.is_user)?.mes ?? '');
    const present = [c.name1, ...members(c).filter(m => !m.disabled).map(m => m.name)].filter(Boolean);
    // 开了叙事组装时后台要先调一次模型（它自己 40 秒超时就退回纯程序那一格），这里多等一会儿。
    let slot;
    // 这一次能发多长（ST 给的：上下文减回复长度）、上一次实际发了多长（N-288）：后台照这个放宽或收窄"想起的"
    const room = { tokens: Number(_contextSize) || null, ...(state.lastPrompt ?? {}) };
    // 要不到就隔一秒半再要一次（试玩 10/11：左滑正撞上导入规划，后台那一下没答上，这一条什么料都没拿到，只能照聊天记录往下写）
    const ask = () => api('slot', { chatKey, speaker, speakerName: camera ? '旁白' : character.name, anchor, recent, recentUser, present, room, soft: softFlag(), frontModel: stPrompts?.getChatCompletionModel?.() ?? null }, 60000);
    try { slot = await ask(); }
    catch (error) {
        if (error?.name === 'TimeoutError' || epoch !== state.epoch) return;
        await new Promise(resolve => setTimeout(resolve, 1500));
        try { slot = await ask(); } catch { globalThis.toastr?.warning('这一条没拿到后台的料，角色只看聊天记录写。', 'RP：幕后', { timeOut: 6000 }); return; }
    }
    if (epoch !== state.epoch || ctx().characterId !== c.characterId) return;
    const stillHere = () => state.epoch === epoch && state.chatKey === chatKey && settings().enabled;
    // 当前预设里有条目的几块交给宏（位置由预设定）；没有的按面板设的位置放：0＝跟在主提示词后面，1＝插进聊天里、倒数第几条之前。
    // 调度排的第二个人起（noRepeat）：这一格末尾带一句，前一条已经答了的不重复、只接自己的那一截
    if (auto.noRepeat && auto.noRepeat === character.avatar && !camera) {
        const line = '（这一句之前已经有人答过了：答过的意思不再答一遍，只接你自己的那一截、你自己的看法。）';
        if (slot.parts) slot.parts = { ...slot.parts, now: slot.parts.now ? `${slot.parts.now}\n${line}` : line };
        slot.text = slot.text ? `${slot.text}\n${line}` : line;
    }
    auto.noRepeat = null;
    const plan = planPlacement({ rule: slot.rule, text: slot.text, parts: slot.parts ?? null, covered: coveredByPreset(), places: settings().places ?? {}, depths: slot.depths ?? {} });
    Object.assign(live, plan.live);
    for (const [key, text, position, depth] of plan.puts) c.setExtensionPrompt(KEYS[key], text, position, depth, false, 0, stillHere);
    tick('那一格:到放好', performance.now() - tSlot, character.name);
    // 这一次后台放进去多少字，等 ST 拼好提示词时一起量（下面 CHAT_COMPLETION_PROMPT_READY）
    state.oursChars = [...plan.puts.map(p => p[1]), ...Object.values(plan.live)].reduce((n, t) => n + String(t ?? '').length, 0);
    state.measuring = true;
    // 这一轮递了"不在场的人来联系"：人在不在群里由你定，轻轻提醒一下。
    if (slot.contact && !camera) globalThis.toastr?.info(`${slot.contact} 这轮可能会来联系。要是写成上门，要不要把${slot.contact}拉进群？`, 'RP：幕后', { timeOut: 8000 });
    // 有卡的人进场（N-292）：镜头这一段写他出现，写完了问你让不让他进场
};

// 早些的回复换成大意（N-231）：前台照着上文的样子写，上文里攒的原文越多越像。最近几条角色回复照原文，
// 更早的换成后台记账记下的那几件事（事还在，句子和节奏不在了）。只改这一次发出去的那份，不动聊天记录；后台没回就原样发。
async function digestOld(rows) {
    const c = ctx(), idx = olderReplies(rows, Number(settings().digestKeep) || 8);
    if (!idx.length || !state.chatKey) return;
    const fps = idx.map(i => fingerprintMessage(rows[i], speakerOf(rows[i], fallbackAvatar(c))));
    const r = await api('digest', { chatKey: state.chatKey, fps: [...new Set(fps)] }, 5000);
    idx.forEach((i, k) => { const t = r?.items?.[fps[k]]; if (t) rows[i] = { ...rows[i], mes: t }; });
}

// ---------- 面板 ----------

let render = () => {};
export function releaseLabel(info) {
    if (!info) return '';
    const edition = info.release ? (info.edition ?? (info.follow === 'origin/release' ? '正式版' : info.follow === 'origin/main' ? '开发版（跟 main）' : '更新分支未取得')) : '开发副本';
    const version = edition === '正式版' && Number.isSafeInteger(info.version) && info.version > 0 ? ` v${typeof info.label === 'string' && /^\d+(\.\d+)?$/.test(info.label) ? info.label : info.version}` : '';
    return `${edition}${version} · ${info.running ?? info.head ?? '版本未取得'}${info.release ? info.ok === false || info.fetchFailed ? ' · 新版检查失败' : info.behind > 0 ? ' · 有新版本' : ' · 发布分支无新版' : ''}`;
}
export function installationHint({backendDown,backendStatus,localRelease,backendRelease}={}) {
    const retry = '<button class="menu_button" type="button" data-action="health-retry" title="重新检查后台，建议修好连接后点。">再查一次</button>';
    if(backendStatus==='starting')return '<p role="status">后台正在启动……</p>';
    if(backendStatus==='missing')return '<p>后台插件还没装上（只装了面板）。要在运行酒馆的那台机器上跑一次安装器：Windows 双击 安装.bat；手机 Termux、Mac、Linux、云服务器运行 install.sh；然后重启酒馆。用 Docker 或者云服务器部署的，看说明里“云服务器／Docker”一节。 <a href="https://github.com/lmy-1219/st-rp-backstage#安装" target="_blank" rel="noopener noreferrer">查看安装说明</a></p><small>酒馆的“安装扩展”只能装面板这一半；报“Directory already exists”是面板已经装过了，不用再装。</small>'+retry;
    if(backendStatus==='down'||backendDown)return '<p>插件装好了，但后台没起来。重启一次酒馆试试；还不行，把 data/rp-emergence/后台日志.txt 最后几十行发到群里或 Issues。</p>'+retry;
    if(localRelease?.layout===2&&Number.isSafeInteger(localRelease.version)&&Number.isSafeInteger(backendRelease?.version)&&localRelease.version!==backendRelease.version)return '<p>扩展和后台版本还没对上，重启一次酒馆就好。</p>';
    return '';
}
async function loadExtensionRelease() {
    try {
        const response=await fetch(new URL('./release.json',import.meta.url));
        if(response.ok){const value=await response.json();if(value.layout===2&&Number.isSafeInteger(value.version))state.localRelease=value;}
    } catch { /* 开发安装没有发布清单，沿用开发流程。 */ }
    render();
}
export function playNoticeHtml(reason) {
    return reason === '要先开每条总结' ? '<p role="status"><b>规划停了：这一局没开每条总结</b></p><button class="menu_button" type="button" data-action="play-extract-enable" title="打开本局总结，建议先核对调用估算。">打开每条总结</button>' : reason ? '<p role="status">这一局是只记忆，规划和推演已停。</p>' : '';
}
export function contentControlsHtml(content) {
    return !content ? '' : `<label>玩法：<select data-content="play"><option value=""${content.ownPlay ? '' : ' selected'}>跟全局（当前 ${content.globalPlay === 'memory' ? '只记忆' : '完整'}）</option>${['完整','只记忆'].map(v=>`<option${content.ownPlay === v ? ' selected' : ''}>${v}</option>`).join('')}</select></label><small>${escapeHtml(content.playReason ?? '')}</small><b>口味</b>
            ${content.tiers.length > 1 ? `<label>档位：<select data-content="tier"><option value=""${content.ownTier ? '' : ' selected'}>跟全局默认（当前 ${escapeHtml(content.tier)}）</option>${content.tiers.map(t => `<option${content.ownTier === t ? ' selected' : ''}>${escapeHtml(t)}</option>`).join('')}</select></label>` : ''}
            <div class="rpe-pace" role="group" aria-label="节奏">${['快', '中', '慢'].map(p => `<button type="button" class="menu_button" title="调整事件疏密，建议先用中档。" data-pace="${p}" aria-pressed="${content.pace === p}">${p}</button>`).join('')}</div>
            ${content.tier === 'SFW' ? '<p>SFW 档不用亲密线</p>' : ''}
            ${content.tier !== 'SFW' && !content.intimate.some(r => r.adult && !r.error) ? '<small>没有生效的亲密线：后台不会安排亲密情节（剧情向和纯NSFW 都一样）。在开局单里加。</small>' : ''}
            ${content.pureNoPack && !content.pureIntimateInactive ? '<small>纯NSFW 的口味文字在单独的口味包里：在“高级 → 口味 → 看／改口味包”里导入，再选它。没导入时和剧情向一样。</small>' : ''}
            ${content.intimate.map(r => `<label class="checkbox_label"><input type="checkbox" data-content-adult="${r.index}"${r.adult ? ' checked' : ''}${content.tier === 'SFW' ? ' disabled' : ''}> 这一条里的人都已成年：${escapeHtml(r.people.join('、'))}<small>确认本线均成年，建议逐人核对。</small></label>${r.error && content.tier !== 'SFW' ? `<small>${escapeHtml(r.error)}</small>` : ''}${r.progress ? `<p>现在：${escapeHtml(r.progress.current)}${r.progress.day != null ? `（第${r.progress.day + 1}天更新）` : '（开局原文）'} <label>改回：<select data-intimate-progress="${r.index}">${r.progress.choices.map(v => `<option value="${escapeHtml(v)}"${v === r.progress.current ? ' selected' : ''}>${escapeHtml(v)}</option>`).join('')}</select></label></p>` : ''}`).join('')}`;
}


async function refreshContent() {
    const chatKey = state.chatKey;
    if (!chatKey) { state.content = null; return; }
    const value = await api('content', { chatKey });
    if (state.chatKey === chatKey) { state.content = { ...value, chatKey }; render(); }
}
async function writePromptPack(body) {
    const chatKey = state.chatKey;
    let value = await api('content', { chatKey, ...body });
    if (value.conflict) {
        const c = ctx(); let mode = 'copy';
        const ok = await c.callGenericPopup(`<h3>已有同名口味包</h3><p>${escapeHtml(value.name)}</p><select class="text_pole" data-role="prompt-conflict"><option value="copy">另存一份</option><option value="overwrite">覆盖同名包</option></select>`, c.POPUP_TYPE.CONFIRM, '', {
            onClosing: popup => { mode = popup.dlg.querySelector('[data-role="prompt-conflict"]').value; return true; },
        });
        if (!ok || state.chatKey !== chatKey) return null;
        value = await api('content', { chatKey, ...body, mode });
    }
    if (value.warnings?.length) globalThis.toastr?.warning(value.warnings.join('\n'));
    if (state.chatKey !== chatKey) return null;
    state.content = { ...value, chatKey }; render(); return value;
}
async function openPromptPack() {
    await refreshContent();
    const c = ctx(), chatKey = state.chatKey, box = document.createElement('div');
    box.style.textAlign = 'left';
    const draw = () => {
        const value = state.content;
        box.innerHTML = `<h3>口味包</h3><p>${escapeHtml(value.packs.find(p => p.id === value.pack)?.manifest.名字 ?? '系统默认')} · ${escapeHtml(value.tier)}</p>
            <p><small>默认文字随系统保留；要改先另存一份。固定格式和边界不能改。纯NSFW 的默认文字暂同剧情向，可另存自己的口味。</small></p>
            <button class="menu_button" type="button" data-prompt-action="export" title="导出口味包，建议修改前先备份。">导出包</button><button class="menu_button" type="button" data-prompt-action="import" title="导入口味包，建议核对来源再用。">导入包</button>
            <input type="file" accept=".json,application/json" data-role="prompt-file" hidden>
            ${value.slots.map(s => `<div style="padding:.4em;border-bottom:1px solid var(--SmartThemeQuoteColor,#888)"><button class="menu_button" type="button" data-prompt-slot="${escapeHtml(s.id)}" title="查看或编辑口味片段，建议先备份。">${s.editable && s.active ? '看／改' : '查看'}</button> <code>${escapeHtml(s.id)}</code> · ${escapeHtml(s.stage)} <small>${s.editable ? '可改' : '固定，不可改'}${s.active ? '' : '；当前档位不用'}</small></div>`).join('')}`;
    };
    draw();
    box.addEventListener('click', async event => {
        try {
            const id = event.target?.dataset?.promptSlot, action = event.target?.dataset?.promptAction;
            if (action === 'import') { box.querySelector('[data-role="prompt-file"]').click(); return; }
            if (action === 'export') {
                const { bundle } = await api('content', { chatKey, action: 'export', id: state.content.pack });
                const a = document.createElement('a'), url = URL.createObjectURL(new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' }));
                a.href = url; a.download = `口味包-${bundle.清单.名字}.json`; a.click(); URL.revokeObjectURL(url); return;
            }
            if (!id) return;
            let slot = state.content.slots.find(s => s.id === id);
            if (!slot.editable || !slot.active) {
                await c.callGenericPopup(`<h3>${escapeHtml(slot.stage)}</h3><p>${slot.active ? '固定段位，口味包不能覆盖。' : '当前档位不用这段。'}</p><textarea readonly rows="12" style="width:100%">${escapeHtml(slot.text)}</textarea>`, c.POPUP_TYPE.TEXT); return;
            }
            if (state.content.pack === 'default') {
                const name = await c.callGenericPopup('先另存成自己的口味包。包名：', c.POPUP_TYPE.INPUT, '我的口味');
                if (!name) return;
                if (!await writePromptPack({ action: 'copy', id: 'default', name })) return;
                slot = state.content.slots.find(s => s.id === id); draw();
            }
            const pack = state.content.packs.find(p => p.id === state.content.pack);
            let text = slot.text, restore = false;
            const ok = await c.callGenericPopup(`<h3>${escapeHtml(slot.stage)}</h3><p><code>${escapeHtml(id)}</code></p>${slot.contracts.length ? `<p><small>这段里有固定格式，保存时会核对：${slot.contracts.map(escapeHtml).join('；')}</small></p>` : ''}
                <textarea class="text_pole" data-role="prompt-text" rows="16" style="width:100%">${escapeHtml(text)}</textarea><button type="button" class="menu_button" data-role="prompt-reset" title="还原默认口味，建议放弃自改时用。">恢复默认</button>`, c.POPUP_TYPE.CONFIRM, '', {
                okButton: '保存', cancelButton: '取消', wide: true,
                onOpen: popup => {
                    const input = popup.dlg.querySelector('[data-role="prompt-text"]');
                    input.addEventListener('input', () => { restore = false; });
                    popup.dlg.querySelector('[data-role="prompt-reset"]').addEventListener('click', () => { input.value = slot.defaultText; restore = true; });
                },
                onClosing: popup => { text = popup.dlg.querySelector('[data-role="prompt-text"]').value; return true; },
            });
            if (!ok || state.chatKey !== chatKey) return;
            const paragraphs = { ...pack.paragraphs };
            if (restore) delete paragraphs[id]; else paragraphs[id] = text;
            await writePromptPack({ action: 'save', id: pack.id, bundle: { 清单: pack.manifest, 段落: paragraphs } }); draw();
        } catch (error) { globalThis.toastr?.error(error.message); }
    });
    box.addEventListener('change', async event => {
        if (!event.target.matches('[data-role="prompt-file"]')) return;
        const file = event.target.files?.[0]; if (!file) return;
        try { const bundle = JSON.parse(await file.text()); await writePromptPack({ action: 'import', bundle, select: true }); draw(); }
        catch (error) { globalThis.toastr?.error(error.message); }
    });
    await c.callGenericPopup(box, c.POPUP_TYPE.TEXT, '', { wide: true });
}

export function panelTab(value) {
    return ['now', 'story', 'ledger', 'settings', 'advanced'].includes(value) ? value : 'now';
}
export function readPanelTab(read) {
    try { return panelTab(read()); } catch { return 'now'; }
}
export function savePanelTab(value, write) {
    const tab = panelTab(value);
    try { write(tab); return tab; } catch { return 'now'; }
}
export function pendingTasks({ status = null, release = null, planStatus = null } = {}) {
    const rows = [], ex = status?.extract;
    if (status?.leaveUnjudged > 0) rows.push({ kind: 'leave', text: `有 ${status.leaveUnjudged} 人离场待判`, action: 'board-edit', label: '看场面 ›', note: '下一次同步时后台会再看一眼' });
    if (ex?.failing > 0 || ex?.skipped?.length) rows.push({ kind: 'extract', text: ex.failing > 0 ? '每条总结没成功' : `有 ${ex.skipped.length} 条总结被跳过`, action: ex.failing > 0 ? 'extract-retry' : 'extract-retry-skipped', label: '重记 ›' });
    const planning = status?.planning ?? planStatus?.planning;
    if (planning?.failure || planStatus?.last?.status === 'failed') rows.push({ kind: 'plan', text: planning?.message || '规划没成功', action: 'plan-reroll', label: '重新规划 ›' });
    if (status?.handoffs > 0) rows.push({ kind: 'handoff', text: `有 ${status.handoffs} 份外援待处理`, action: 'handoffs-open', label: '处理外援 ›' });
    if (release?.release && (release.behind > 0 || release.stale)) rows.push({ kind: 'update', text: '有新版本待更新', action: 'update', label: '更新 ›' });
    return rows;
}
export function pendingTasksHtml(rows) {
    return rows.map(r => `<div class="rpe-task"><span>${escapeHtml(r.text)}${r.note ? `<small>${escapeHtml(r.note)}</small>` : ''}</span><button type="button" class="menu_button" data-action="${escapeHtml(r.action)}" title="打开这项待办，建议看清原因再处理。">${escapeHtml(r.label)}</button></div>`).join('');
}
export function sceneCardHtml(board, roster = [], date = null) {
    if (!board) return '<p>场面还没算好</p>';
    const time = [date?.full || date?.label || (board.time?.day != null ? `第 ${board.time.day + 1} 天` : ''), board.time?.part].filter(Boolean).join(' · ');
    const people = (board.people ?? []).filter(p => ['present', 'remote'].includes(p.status)).map(p => {
        const entry = roster.find(e => e.name === p.name && e.role !== '不用');
        const tag = entry?.群体 ? '（一群人）' : String(entry?.avatar ?? '').startsWith('face:') ? '（没卡）' : '';
        return `<span class="rpe-person rpe-${p.status}">${escapeHtml(p.name)}${tag}${p.status === 'remote' ? ' · 远程' : ''}</span>`;
    }).join('');
    return `<div class="rpe-scene-head"><b>镜头：${escapeHtml(board.place ?? '？')}</b><small>${escapeHtml(time)}</small></div><div class="rpe-people">${people || '<small>没有在场的人</small>'}</div>`;
}
export function boardLabelText(board, marked = false) {
    const present = (board.people ?? []).filter(p => p.status === 'present').map(p => p.name);
    const remote = (board.people ?? []).filter(p => p.status === 'remote').map(p => `${p.name}${p.way ? `（${p.way}来）` : ''}`);
    return `镜头：${board.place ?? '？'} · 在场：${present.join('、') || '无'}${remote.length ? ` · 远程：${remote.join('、')}` : ''}${marked ? ' ✎' : ''}`;
}
export function boardPeopleAfterEdit(previous = {}, selected = {}, clear = false) {
    const people = clear ? {} : { ...previous };
    for (const [name, value] of Object.entries(selected)) {
        if (['在场', '远程', '不在'].includes(value)) people[name] = value;
        else if (value === '' && (clear || previous[name] !== '外头')) delete people[name];
    }
    return people;
}
export function rosterGroups(cast) {
    return { cards: cast.filter(e => e.role !== '不用' && !String(e.avatar).startsWith('face:')),
        faces: cast.filter(e => e.role !== '不用' && String(e.avatar).startsWith('face:')), other: cast.filter(e => e.role === '不用') };
}
export function handoffLabel(h) {
    return h.kind === 'extract' ? '每条总结（从一小段对话里记下事实）' : h.title;
}
export function panelHelp(key) {
    return ({playMode:'选择全局默认玩法，每局可以单独改。',"fresh-settings":"分两档去重复，建议先用免费第一档。","drift-clear":"清除变化预览，建议核对后再用。","extract-retry":"重试失败总结，建议先检查错误。","extract-retry-skipped":"补回跳过消息，建议核对后用。","handoff-cancel":"收起未交回答，建议暂不交时用。","handoff-copy":"复制完整题目，建议交给其他AI。","handoff-paste":"粘贴AI回答，建议核对后交回。","handoff-retry":"重调原模型，建议先检查连接。","handoff-submit":"提交并核对回答，建议保留完整内容。","pending-tab":"打开待办详情，建议按需查看。",'board-edit':'改正谁在哪，识别有误时用。','camera-now':'让旁白接一段，建议需要时用。','plan-reroll':'重排未用候选，建议失败或跑偏时用。','plan-reveal':'查看已排事件，介意剧透别打开。',setup:'填写本局设定，建议开局先核对。',cast:'管理本局人物，建议开局核对。',relations:'管理初始关系，建议开局核对。',presets:'保存或套用局设定，建议新局用。','opening-pack':'整套导入并建新群，建议先预览。',lore:'修改世界书知情，建议判错时用。',records:'看每条总结的来源，建议疑错时查。',ledger:'查看钱与家当，建议涉及交易时查。',pending:'查看约定的进展，建议按需查。',episodes:'按场回看经过，建议回顾时用。',talk:'问事或提改动，点记才写入。',stages:'选择钥匙和型号，建议先配好。',advanced:'打开更多选项，建议需要时再改。','advanced-back':'回到常用设置，建议平时用。','prompt-pack':'调整口味文字，建议先导出备份。','prompt-preview':'查看规划题目，建议先核对。',camera:'配置旁白载体，建议群聊需要时用。','plan-request':'请求下一份规划，建议确有需要再用。',places:'调整场记位置，建议先用默认。',tuning:'调整开关和参数，建议先用默认。',extract:'控制每条总结，建议保持开启。',backfill:'补总结接入前消息，建议先看估算。',sync:'同步当前采用稿，建议状态落后时用。',update:'检查代码版本，建议提示更新时用。',preview:'查看角色拿到的场记，建议排错时用。',timings:'查看本轮耗时，建议卡顿时用。','plan-attempts':'查看规划尝试，建议失败时查。',rejected:'查看被拦的内容，建议排错时查。',confirm:'确认大量删稿，建议核对后再点。',absencePaused:'暂停离开计时，建议离线不推进时开。',windowConnected:'让本窗口使用系统，建议按局开。',dailyBudget:'设置后台预算，建议先设上限。',pack:'选择本局素材，建议没有就留空。',awayMode:'选择离开怎么算，建议按玩法选。',speakFirst:'回来让角色先说，建议按需开。',cameraJoin:'让旁白接没卡人物，建议群聊开。',historyRounds:'限制送出的历史，建议先用默认。',digestOld:'把旧回复换成大意，建议按需开。',digestKeep:'保留近期原文，建议先用默认。',loreFilter:'按人物筛世界书，建议需要隔离时开。',newChats:'设置新窗口接入方式，建议先问。',testSlot:'检查注入接线，建议平时关闭。',enabled:'控制系统供料，建议按需启用。'})[key] ?? '';
}
export function stageHelp(id) {
    return ({extract:'逐条总结事实与知情，推荐可靠模型。',keys:'为旧事配检索词，推荐快速模型。',assemble:'把旧事串成回忆，建议按需开启。',judge:'判断转向与节点，推荐快速可靠模型。',plan:'安排下个节点，推荐较强创作模型。',away:'推离开后的动向，推荐较强模型。',advisor:'查资料作参谋，推荐阅读可靠模型。',setup:'拆分开局大纲，推荐长文可靠模型。',talk:'问事或提改动，推荐可靠模型。',setupKeys:'给前史配词，推荐快速模型。',fresh:'换掉重复写法，推荐快速模型。',profile:'读角色资料，推荐阅读可靠模型。',scene:'看场面起头，推荐快速模型。',prep:'整理规划备料，推荐阅读可靠模型。',lore:'判断世界书知情，推荐可靠模型。',situation:'推各方动向，有资料再启用。',embed:'按含义找旧事，需要嵌入模型。'})[id] ?? '';
}
export function onboardingHtml({ hasChat = false, joined = false } = {}) {
    if (joined) return '';
    const steps = ['先到“设置 → 钥匙和模型”填好钥匙。','在酒馆新建群聊并加入角色，单聊也可以。','打开聊天，若弹出接入确认就点“接入”；没弹时到“设置”勾选“本窗口接入”。','三选一：有局预设就套上；没有就填开局单或贴大纲、核对后确认生效；有整套开局包就点“导入开局包”，它会自动建群、接入和套设定，可跳过前面的第2～4步。','发第一句话开玩。第一份规划等开局单确认生效、或你发了第一句才开始，需几分钟、约一两美元；规划好之前角色照常说话。'];
    const start = hasChat ? 3 : 1;
    return `<section class="rpe-card" data-guide-start="${start}"><h4>开一局的顺序</h4><ol start="${start}">${steps.slice(start-1).map(s=>`<li>${s}</li>`).join('')}</ol></section>`;
}
export function panelPageHtml(page) {
    const button = (action, text) => `<button class="menu_button" data-action="${action}" type="button" title="${panelHelp(action)}">${text}</button>`;
    const card = (title, html) => `<section class="rpe-card"><h4>${title}</h4>${html}</section>`;
    if (page === 'now') return `<div data-role="start-guide"></div><div data-joined>${card('此刻的场面', '<div data-role="board-row"></div><div class="rpe-grid">' + button('board-edit', '纠正场面') + button('camera-now', '旁白来一段') + '</div>')}
        <section class="rpe-card" data-role="tasks-card" hidden><h4>待处理</h4><div data-role="tasks"></div></section>
        ${card('幕后', '<p data-role="plan"></p><div data-role="plan-row" class="rpe-grid">' + button('plan-reroll', '重新规划') + '<button class="menu_button" type="button" data-action="plan-repair" hidden title="只修已保存规划的格式，建议先看失败原因。">修格式</button>' + button('plan-reveal', '看幕后（剧透）') + '</div>')}
        <details class="rpe-card" data-role="handoff-details"><summary>外援</summary><small>把未完成任务交给其他AI，建议按题目交回。</small><div data-role="handoffs" hidden></div><div data-role="extract-alert"></div></details></div>`;
    if (page === 'story') return `<div data-joined><div data-role="relations-draft"></div>${card('这一局', '<p><small>有局预设：套上就行。没有：填开局单，或贴大纲让后台拆，核对确认后可保存、导出为局预设。开局包是作者用 skill 生成的整套卡、书和设定，点“导入开局包”会新建群。</small></p><div data-role="content-controls"></div><label class="checkbox_label"><input type="checkbox" data-opt="absencePaused"> 暂停离开计时</label>')}
        <div class="rpe-grid">${button('setup', '开局单')}${button('cast', '名册')}${button('relations', '关系表')}${button('presets', '局预设')}${button('opening-pack', '导入开局包')}</div></div>`;
    if (page === 'ledger') return `<div data-joined class="rpe-stack">${button('records', '总结详情')}${button('ledger', '账本')}${button('pending', '约定历史')}${button('episodes', '剧情总览')}${button('talk', '任意调整 <small>几美分一句</small>')}</div>`;
    if (page === 'settings') return `${card('设置', '<label>玩法（全局默认）：<select data-opt="playMode"><option value="full">完整</option><option value="memory">只记忆</option></select></label><small>只记忆：只留记性（总结、召回、不串知），不排剧情、不推演，省钱；角色主动性会弱一些。</small><label class="checkbox_label"><input type="checkbox" data-opt="windowConnected"> 本窗口接入</label><label>每天最多花（美元）<input class="text_pole" type="number" min="0" max="500" step="0.1" data-opt="dailyBudget" aria-label="每天最多花（美元）"></label>' + button('stages', '钥匙和模型') + '<small data-role="edition"></small><a data-role="release" data-action="update" hidden href="#">检查更新</a>')}${card('去复读', '<small>先用免费第一档；第二档只改绑定角色。</small>' + button('fresh-settings', '去复读两档与口吻语料'))}${button('advanced', '高级（创作者用）›')}`;
    if (page !== 'advanced') return '';
    return `${button('advanced-back', '‹ 返回设置')}
        ${card('口味', '<div data-role="prompt-pack-controls"></div>' + button('prompt-pack', '看／改口味包 · 导入／导出') + button('prompt-preview', '预览规划题目（不花钱）'))}
        ${card('这一局的细节', '<label data-role="pack-row">素材包：<select data-opt="pack"></select> <button class="menu_button" type="button" data-action="material-pack" title="导入参考资料，建议先核对预览。">导入素材包</button></label><label data-role="away-row">离开时这一局：<select data-opt="awayMode"><option value="">跟着默认</option><option value="real">照现实过</option><option value="pause">世界等你</option></select></label><label class="checkbox_label"><input type="checkbox" data-opt="speakFirst"> 离开回来时由角色先开口</label><label class="checkbox_label"><input type="checkbox" data-opt="cameraJoin"> 有卡的人在场时旁白也接没卡的人的戏</label>' + button('camera', '一个人时的旁白') + button('plan-request', '要下一个节点的规划（约一两美元）') + button('lore', '世界书谁知道') + '<small>后台自动判每条世界书谁该知道（要打开“世界书按开口的人筛”）；判错了在这里改。一般不用动。</small>')}
        ${card('送给前台的', '<label>每轮只送最近：<select data-opt="historyRounds"><option value="0">不限（ST 默认）</option><option value="10">10 轮</option><option value="15">15 轮</option><option value="20">20 轮</option><option value="30">30 轮</option></select> 聊天</label><label class="checkbox_label"><input type="checkbox" data-opt="digestOld"> 较早的回复换成大意，最近 <select data-opt="digestKeep"><option>4</option><option>6</option><option>8</option><option>12</option><option>20</option></select> 条照原文</label><label class="checkbox_label"><input type="checkbox" data-opt="loreFilter"> 世界书按开口的人筛</label>' + button('places', '提示词位置'))}
        ${card('后台', '<p data-role="ledger"></p><div class="rpe-grid">' + button('stages', '各环节的模型') + button('tuning', '调参') + button('extract', '暂停每条总结') + button('backfill', '补记接入以前的消息') + button('sync', '立即同步') + button('update', '检查更新') + '</div><label>新开的窗口：<select data-opt="newChats"><option value="ask">问我</option><option value="auto">直接接入</option><option value="off">不接入</option></select></label>')}
        <details class="rpe-card"><summary>排查用（平时不用开）</summary><p data-role="status"></p><span data-role="leave-retries"></span><small data-role="waiting"></small><p data-role="warn" hidden></p>${button('confirm', '确认，是我删的')}
        <div data-role="preview-row"><select class="text_pole" data-role="preview-who"></select>${button('preview', '预览所选角色此刻的场记')}</div><div class="rpe-grid">${button('timings', '这一轮各步耗时')}${button('plan-attempts', '最近 20 次规划尝试')}${button('rejected', '被拦下的')}</div><label class="checkbox_label"><input type="checkbox" data-opt="testSlot"> 接线测试（仅测试用）</label><label class="checkbox_label"><input type="checkbox" data-opt="enabled"> 总开关</label></details>`;
}
export function panelShellHtml() {
    return `<style>
    #rp_emergence_panel [hidden]{display:none!important}#rp_emergence_panel{color:var(--SmartThemeBodyColor);overflow-wrap:anywhere}
    #rp_emergence_panel .rpe-topbar{display:flex;align-items:center;gap:.5em;flex-wrap:wrap;width:100%}#rp_emergence_panel .rpe-topbar b{flex:1}
    #rp_emergence_panel .rpe-dot{width:.65em;height:.65em;border-radius:50%;display:inline-block;background:var(--SmartThemeBorderColor,#888)}#rp_emergence_panel .rpe-dot[data-state=on]{background:var(--success,#3a6)}#rp_emergence_panel .rpe-dot[data-state=error]{background:var(--error,#d55)}
    #rp_emergence_panel .rpe-tabs{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:3px;margin:.5em 0}#rp_emergence_panel .rpe-tabs button{min-width:0;padding:.3em}
    #rp_emergence_panel .rpe-card{background:var(--SmartThemeBlurTintColor);border:1px solid var(--SmartThemeBorderColor);border-radius:.65em;padding:.65em;margin:.5em 0}#rp_emergence_panel h4{margin:0 0 .5em}
    #rp_emergence_panel .menu_button{min-height:40px;white-space:normal;min-width:0;width:auto;margin:0;cursor:pointer}#rp_emergence_panel .rpe-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.4em}
    #rp_emergence_panel .rpe-stack{display:grid;gap:.5em}#rp_emergence_panel .rpe-stack button{width:100%;text-align:left}#rp_emergence_panel small{display:block;opacity:.8}
    #rp_emergence_panel label{display:block;margin:.5em 0}#rp_emergence_panel .rpe-task,#rp_emergence_panel .rpe-scene-head{display:flex;align-items:center;justify-content:space-between;gap:.5em;margin:.4em 0}
    #rp_emergence_panel .rpe-people{display:flex;gap:.3em;flex-wrap:wrap;margin:.6em 0}#rp_emergence_panel .rpe-person{border:1px solid var(--SmartThemeBorderColor);border-radius:1em;padding:.2em .55em}#rp_emergence_panel .rpe-remote{border-style:dashed;color:var(--SmartThemeQuoteColor)}
    #rp_emergence_panel .rpe-pace{display:flex;gap:.3em;margin:.5em 0}#rp_emergence_panel [aria-pressed=true],#rp_emergence_panel [aria-selected=true]{border-color:var(--SmartThemeQuoteColor);box-shadow:inset 0 -2px var(--SmartThemeQuoteColor)}
    #rp_emergence_panel summary{cursor:pointer;min-height:40px}#rp_emergence_panel input[type=number]{width:100%}
    @media(max-width:420px){#rp_emergence_panel .rpe-grid{grid-template-columns:1fr}#rp_emergence_panel .rpe-task{flex-wrap:wrap}}
    </style><div class="inline-drawer"><div class="inline-drawer-toggle inline-drawer-header"><div class="rpe-topbar"><span class="rpe-dot" data-role="connection-dot" aria-label="未接入"></span><b>RP：幕后</b><small data-role="spend"></small><button class="menu_button" type="button" data-action="pending-tab" data-role="pending-badge" hidden title="打开待办详情，建议按需查看。"></button></div><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div>
    <div class="inline-drawer-content"><div data-role="installation-hint" role="status" hidden></div><nav class="rpe-tabs" role="tablist" aria-label="RP：幕后">${[['now','此刻'],['story','这一局'],['ledger','剧情现状'],['settings','设置']].map(([id,text])=>`<button type="button" class="menu_button" role="tab" data-tab="${id}" aria-controls="rpe-page-${id}" title="切换面板栏目，建议按需要查看。">${text}</button>`).join('')}</nav>${['now','story','ledger','settings','advanced'].map(id=>`<div id="rpe-page-${id}" data-page="${id}" role="tabpanel">${panelPageHtml(id)}</div>`).join('')}<small data-role="note"></small></div></div>`;
}

function mountPanel() {
    const host = document.querySelector('#extensions_settings2') || document.querySelector('#extensions_settings');
    if (!host) { setTimeout(mountPanel, 500); return; }
    const panel = document.createElement('div');
    panel.id = 'rp_emergence_panel';
    panel.innerHTML = panelShellHtml();
    const $ = sel => panel.querySelector(sel);
    let currentTab = readPanelTab(() => settings().panelTab);
    const showPage = (next, save = false) => {
        currentTab = panelTab(next);
        if (save) currentTab = savePanelTab(currentTab, tab => { settings().panelTab = tab; saveExtensionSettings(); });
        for (const page of panel.querySelectorAll('[data-page]')) page.hidden = page.dataset.page !== currentTab;
        for (const tab of panel.querySelectorAll('[data-tab]')) tab.setAttribute('aria-selected', String(tab.dataset.tab === (currentTab === 'advanced' ? 'settings' : currentTab)));
    };
    $('[data-role="pending-badge"]').addEventListener('click', event => {
        event.stopPropagation(); showPage('now', true);
        panel.querySelector('.inline-drawer-content').style.display = 'block';
    });
    render = () => {
        const s = settings(), st = state.status;
        $('[data-role="relations-draft"]').innerHTML = relationsDraftHtml(state.relationsDraft, escapeHtml);
        const hint=$('[data-role="installation-hint"]');
        hint.innerHTML=installationHint({backendDown:state.backendDown,backendStatus:state.backendStatus,localRelease:state.localRelease,backendRelease:state.release});hint.hidden=!hint.innerHTML;
        const door = document.querySelector('#rpe_door');
        if (door) {
            door.innerHTML = state.chatKey && s.enabled ? autoDoorHtml({...auto,items:state.door?.items??[],lit:state.door?.lit},escapeHtml) : '';
            door.hidden = !door.innerHTML;
        }
        $('[data-opt="enabled"]').checked = s.enabled;
        $('[data-opt="newChats"]').value = s.newChats;
        $('[data-opt="historyRounds"]').value = String(Number(s.historyRounds) || 0);
        $('[data-opt="digestOld"]').checked = !!s.digestOld;
        $('[data-opt="loreFilter"]').checked = !!s.loreFilter;
        $('[data-opt="digestKeep"]').value = String(Number(s.digestKeep) || 8);
        $('[data-opt="testSlot"]').checked = !!st?.testSlot;
        $('[data-opt="testSlot"]').disabled = !state.chatKey;
        $('[data-opt="absencePaused"]').checked = !!state.absence?.paused;
        $('[data-role="away-row"]').hidden = !state.chatKey || !state.absence?.mode;
        if (state.absence?.mode) $('[data-opt="awayMode"]').value = state.absence.mode.own;
        $('[data-opt="speakFirst"]').checked = s.speakFirst !== false;
        $('[data-opt="cameraJoin"]').checked = s.cameraJoin !== false;
        const ps = state.planStatus;
        for (const button of panel.querySelectorAll('[data-action="plan-reroll"]')) button.disabled = !state.chatKey || ps?.provider === 'off';
        $('[data-role="plan-row"]').hidden = !state.chatKey;
        const planning = st?.planning ?? ps?.planning;
        $('[data-action="plan-repair"]').hidden = !planning?.repairAvailable;
        $('[data-action="plan-repair"]').disabled = !!planning?.running || !!ps?.playReason;
        $('[data-role="plan"]').textContent = !state.chatKey || !ps ? '' : ps.playReason ? ps.playReason + '，规划已停' : ps.provider === 'off' ? '规划关着'
            : (planning?.repairAvailable ? planning.repairReason : ps.awaitingPersona ? '等你确认人设' : planning?.running || ps.last?.status === 'requested' ? '在规划' : planning?.failure || ps.last?.status === 'failed' ? '没成功（' + (planning?.message || '上次没写成') + '）' : ps.last?.status === 'ready' ? '规划好了' : '还没有规划')
              + ' · 口袋 ' + (ps.counts?.pocket ?? 0) + ' 件 · 等着 ' + (ps.counts?.waiting ?? 0) + ' 件';
        $('[data-opt="windowConnected"]').checked = !!state.chatKey && st?.enabled !== false;
        $('[data-opt="windowConnected"]').disabled = !s.enabled;
        const daily = $('[data-opt="dailyBudget"]');
        if (document.activeElement !== daily) daily.value = state.dailyBudget ?? state.plan?.dailyBudgetUsd ?? '';
        const tasks = pendingTasks({ status: st, release: state.release, planStatus: ps });
        $('[data-role="tasks-card"]').hidden = !state.chatKey || !tasks.length;
        $('[data-role="tasks"]').innerHTML = pendingTasksHtml(tasks);
        const badge = $('[data-role="pending-badge"]'); badge.hidden = !tasks.length; badge.textContent = tasks.length + ' 件待处理';
        const dot = $('[data-role="connection-dot"]');
        dot.dataset.state = state.backendDown ? 'error' : state.backendStatus === 'starting' ? 'off' : state.chatKey ? (st?.enabled !== false && s.enabled ? 'on' : 'off') : state.backendStatus === 'healthy' ? 'on' : 'off';
        dot.setAttribute('aria-label', state.backendDown ? '后台连不上' : state.backendStatus === 'starting' ? '后台正在启动' : dot.dataset.state === 'on' ? (state.chatKey ? '已接入' : '后台已连接，窗口未接入') : '未接入或暂停');
        $('[data-action="sync"]').hidden = !state.chatKey;
        $('[data-action="confirm"]').hidden = !state.collapsed;
        const warn = $('[data-role="warn"]');
        warn.hidden = !state.collapsed;
        if (state.collapsed) warn.textContent = `这次读到的聊天只有 ${state.collapsed.after} 条，比后台记的 ${state.collapsed.before} 条少了很多。可能是聊天文件出了问题，后台先没跟着删。如果确实是你删的，点"确认"。`;
        $('[data-role="status"]').textContent = !s.enabled ? '已关闭。'
            : !state.chatKey ? '这个窗口没有接入。'
            : !st ? (state.syncing ? '同步中……' : '已接入。')
            : `已接入${st.enabled ? '' : '（已暂停）'}。后台记着这个窗口的 ${st.total} 条消息${st.syncedAt ? `，最近同步 ${new Date(st.syncedAt).toLocaleTimeString()}` : ''}。`;
        if(s.enabled && state.chatKey && st?.leaveUnjudged>0) $('[data-role="status"]').textContent += ` ${st.leaveUnjudged} 人离场待判`;
        const leaveRetry=leaveRetryView(ctx().chatMetadata?.rpeLeaveRetries,escapeHtml);
        if(s.enabled && state.chatKey && leaveRetry.message) $('[data-role="status"]').textContent += ` ${leaveRetry.message}`;
        if (s.enabled && state.chatKey && st?.planning?.message) $('[data-role="status"]').textContent += ` ${st.planning.message}`;
        $('[data-role="leave-retries"]').innerHTML=s.enabled&&state.chatKey?leaveRetry.html:'';
        $('[data-role="note"]').textContent = state.note;
        const joinedNow = !!state.chatKey && s.enabled;
        const openChat = chatIds(ctx()).stChatId;
        $('[data-role="start-guide"]').innerHTML = onboardingHtml({hasChat:openChat != null && openChat !== '',joined:!!state.chatKey});
        for(const input of panel.querySelectorAll('[data-opt]')){
            const help=panelHelp(input.dataset.opt),label=input.closest('label');
            if(help&&label&&!label.querySelector('[data-help-opt="'+input.dataset.opt+'"]')){const small=document.createElement('small');small.dataset.helpOpt=input.dataset.opt;small.textContent=help;label.append(small);}
        }
        const content = state.content?.chatKey === state.chatKey ? state.content : null;
        $('[data-role="content-controls"]').innerHTML = contentControlsHtml(joinedNow ? content : null);
        $('[data-role="prompt-pack-controls"]').innerHTML = !joinedNow || !content ? '' : `<label>这一局的包：<select data-content="pack"><option value=""${content.ownPack ? '' : ' selected'}>跟全局默认</option>${content.packs.map(p => `<option value="${escapeHtml(p.id)}"${content.ownPack === p.id ? ' selected' : ''}>${escapeHtml(p.manifest.名字)}</option>`).join('')}</select></label>
            <label>全局默认包：<select data-content="global-pack">${content.packs.map(p => `<option value="${escapeHtml(p.id)}"${content.globalPack === p.id ? ' selected' : ''}>${escapeHtml(p.manifest.名字)}</option>`).join('')}</select></label><small>${escapeHtml(content.warning)}</small>`;
        for (const section of panel.querySelectorAll('[data-joined]')) section.hidden = !joinedNow;
        $('[data-role="spend"]').textContent = state.plan ? '$' + Number(state.plan.spentTodayUsd || 0).toFixed(2) + ' / $' + state.plan.dailyBudgetUsd : '';
        const rel = $('[data-role="release"]');
        $('[data-role="edition"]').textContent = releaseLabel(state.release);
        rel.hidden = !(state.release?.release && (state.release.behind > 0 || state.release.stale));
        if (!rel.hidden) rel.textContent = state.release.behind > 0 ? `有新版本（${state.release.behind} 个提交），点这里更新` : '后台还在用旧代码，点这里重启';
        const pendingNow = state.status?.handoffs ?? 0;
        const cut = state.status?.cut;
        $('[data-role="waiting"]').textContent = [
            state.status?.intimateStopped ? '亲密线停着（换场景后恢复）' : '',
            pendingNow ? `有 ${pendingNow} 件等你处理（在"幕后"里）` : '',
            // 后台的回答写到上限或被中转掐断（用户 9/30：不许静默截断）：放大重来写完的也说一声，没写完的按失败算、会再试
            cut?.gaveUp ? `后台有 ${cut.gaveUp} 次回答没写完（写到上限或被中转掐断，按失败算、会再试；最近一次：${cut.last?.model ?? ''}）` : '',
            cut?.stretched ? `${cut.stretched} 次写到上限，放大重来写完了` : '',
        ].filter(Boolean).join('；');
        const waiting = state.status?.handoffs ?? 0;
        const hu = state.handoffUi;
        $('[data-role="handoffs"]').hidden = !waiting;
        $('[data-role="handoffs"]').innerHTML = !waiting ? '' : `外援队列：${waiting} 件等着。复制题目贴给任何一个 AI（网页版也行），把回答贴回来点“交回”；也可以重试 API。`
            + (hu?.pending ?? []).map(h => `<div style="margin:.2em 0">· ${escapeHtml(handoffLabel(h))}<small style="opacity:.8">（${escapeHtml(h.why)}）</small>${h.retry
                ? ` <button class="menu_button" type="button" data-action="handoff-retry" data-id="${h.id}" ${h.busy ? 'disabled' : ''} title="重调原模型，建议先检查连接。">${h.busy ? '正在重试…' : h.kind === 'plan' ? '再试一次（调规划模型写一整个节点，约一两美元）' : '再试一次'}</button>` : ''}
                <button class="menu_button" type="button" data-action="handoff-copy" data-id="${h.id}" title="复制完整题目，建议交给其他AI。">复制题目（约 ${h.chars ?? '?'} 字）</button>
                <button class="menu_button" type="button" data-action="handoff-paste" data-id="${h.id}" title="粘贴AI回答，建议核对后交回。">贴回答</button>
                ${state.handoffDrafts?.[h.id] ? `<div><textarea data-handoff-answer="${h.id}" rows="8" style="width:100%" aria-label="外援回答">${escapeHtml(state.handoffDrafts[h.id].text)}</textarea><button class="menu_button" type="button" data-action="handoff-submit" data-id="${h.id}" title="提交并核对回答，建议保留完整内容。">交回</button><button class="menu_button" type="button" data-action="handoff-cancel" data-id="${h.id}" title="收起未交回答，建议暂不交时用。">取消</button><div role="status">${escapeHtml(state.handoffDrafts[h.id].why ?? '')}</div></div>` : ''}</div>`).join('')
            + `<label class="checkbox_label"><input type="checkbox" data-opt="handoffAuto" ${hu?.auto ? 'checked' : ''}> 每 5 分钟自动再试，直到成了<small>重试未完成的任务，建议先检查模型连接。</small></label><small>能跑命令的 AI 窗口也可以说“处理外援”。</small>`;
        // 记账是一切的上游（D-174 第 5 步）：连败就亮红、能一键再试；判了"跳过"的能重记；落后几条也说一声
        const ex = st?.extract;
        $('[data-role="extract-alert"]').innerHTML = !ex ? '' : [
            ex.failing >= 2 ? `<div style="color:var(--warning,#d33)">每条总结停了：连败 ${ex.failing} 次（最后一次：${escapeHtml(ex.lastError ?? '没说原因')}）；下游的检查、局势、口袋都在等它。 <button class="menu_button" type="button" data-action="extract-retry" title="重试失败总结，建议先检查错误。">再试一次</button>${ex.skipped?.length ? ` <button class="menu_button" type="button" data-action="extract-retry-skipped" title="补回跳过消息，建议核对后用。">重记跳过的 ${ex.skipped.length} 条</button>` : ''}</div>` : '',
            ex.failing < 2 && ex.skipped?.length ? `<div style="color:var(--SmartThemeQuoteColor,#888)">有 ${ex.skipped.length} 条消息在总结时被跳过了（第 ${ex.skipped.join('、')} 条）。 <button class="menu_button" type="button" data-action="extract-retry-skipped" title="补回跳过消息，建议核对后用。">重记它们</button></div>` : '',
            ex.pendingMessages >= 4 ? `<div style="color:var(--SmartThemeQuoteColor,#888)">每条总结落后 ${ex.pendingMessages} 条</div>` : '',
        ].filter(Boolean).join('') + driftHtml(st?.drift);
        const playReason = state.planStatus?.playReason ?? state.content?.playReason ?? '';
        $('[data-role="content-controls"]').insertAdjacentHTML('beforeend', playNoticeHtml(playReason));
        const playSelect=$('[data-opt="playMode"]'); if(playSelect) playSelect.value=state.globalPlay ?? state.content?.globalPlay ?? 'full';
        for(const el of panel.querySelectorAll('[data-action="plan-request"], [data-action="plan-reroll"], [data-opt="awayMode"], [data-opt="speakFirst"]')) { el.disabled=!!playReason; el.title=playReason || '按需使用'; }
        const plan = state.plan, joined = !!state.chatKey && s.enabled;
        for (const sel of ['[data-role="ledger"]', '[data-action="extract"]', '[data-action="backfill"]', '[data-action="records"]', '[data-action="rejected"]', '[data-action="ledger"]', '[data-action="cast"]', '[data-action="setup"]', '[data-action="relations"]', '[data-action="presets"]']) $(sel).hidden = !joined || !plan;
        if (joined && plan) {
            const cost = `约 ${plan.estimate.calls} 次调用、约 $${plan.estimate.usd.toFixed(2)}`;
            $('[data-role="ledger"]').textContent = !plan.configured ? '后台每条总结：还没配置模型（在后台的 config.json 里填）。'
                : plan.enabled ? `后台每条总结：开着（${plan.model}）。${plan.pendingMessages ? `还有 ${plan.pendingMessages} 条待记，${cost}。` : '都记完了。'}今天已花约 $${plan.spentTodayUsd.toFixed(2)} / 上限 $${plan.dailyBudgetUsd}。${plan.lastError ? ` 上次出错：${plan.lastError}` : ''}`
                : `后台每条总结：关着。这个窗口有 ${plan.pendingMessages} 条待记，全记一遍${cost}（${plan.model}）。`;
            $('[data-action="extract"]').textContent = plan.enabled ? '暂停每条总结' : '开始每条总结（会花钱）';
            $('[data-action="extract"]').disabled = !plan.configured;
            // 接入时自动开的记账只记接入以后的（D-100）；以前的旧消息要不要补记，给个估价由你点。
            const older = plan.olderMessages ?? 0;
            $('[data-action="backfill"]').hidden = !older || !plan.configured;
            if (older) $('[data-action="backfill"]').textContent = `补记接入以前的 ${older} 条（约 ${plan.olderEstimate.usd.toFixed(2)}）`;
        }
        const packRow = $('[data-role="pack-row"]');
        packRow.hidden = !joined || !state.pack;
        if (joined && state.pack) {
            const sel = packRow.querySelector('select');
            sel.innerHTML = ['<option value="">不用素材包</option>', ...state.pack.packs.map(p => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`)].join('');
            sel.value = state.pack.pack ?? '';
        }
        $('[data-role="preview-row"]').hidden = !joined;
        if (joined) {
            const who = $('[data-role="preview-who"]'), keep = who.value;
            const list = members(ctx()).filter(m => !m.disabled);
            // 旁白（镜头那张卡）在群里本来就静音着，也列上（用户 10/9：一个人的时候面板里看不到旁白的场记）
            const cam = cameraOf(ctx()), camIn = !!cam && !!currentGroup(ctx())?.members.includes(cam.avatar);
            who.innerHTML = [...list.map(m => `<option value="${escapeHtml(m.avatar)}">${escapeHtml(m.name)}</option>`), ...(camIn ? [`<option value="${CAMERA_PICK}">旁白（镜头）</option>`] : [])].join('');
            if (list.some(m => m.avatar === keep) || (camIn && keep === CAMERA_PICK)) who.value = keep;
        }
        $('[data-role="board-row"]').innerHTML = sceneCardHtml(boardLabels.at(-1), state.boardCast ?? [], dayLabels.at(-1));
        showPage(currentTab);
    };
    panel.addEventListener('input', event => {
        const id = event.target?.dataset?.handoffAnswer;
        if (id && state.handoffDrafts?.[id]) state.handoffDrafts[id].text = event.target.value;
    });
    panel.addEventListener('click', async event => {
        const target = event.target.closest('button,a');
        if (target?.dataset.tab) {
            showPage(target.dataset.tab, true);
            if (target.dataset.tab === 'settings') try { const t = await api('tuning', {}); state.dailyBudget = t.knobs.find(k => k.path === 'extractor.dailyBudgetUsd')?.value; state.globalPlay = t.knobs.find(k => k.path === 'play.mode')?.value ?? 'full'; render(); } catch {}
            return;
        }
        if (target?.dataset.pace) {
            const chatKey = state.chatKey;
            try { const value = await api('content', { chatKey, action: 'settings', pace: target.dataset.pace }); if (state.chatKey === chatKey) { state.content = { ...value, chatKey }; render(); refreshPlanStatus(); } } catch (error) { globalThis.toastr?.error(error.message); }
            return;
        }
        const action = target?.dataset?.action;
        if (!action) return;
        if (action === 'advanced' || action === 'advanced-back') { showPage(action === 'advanced' ? 'advanced' : 'settings', true); return; }
        if (action === 'board-edit') { await pickBoard((ctx().chat?.length ?? 0) - 1).catch(() => {}); return; }
        if (action === 'camera-now') { await ctx().executeSlashCommandsWithOptions('/旁白'); return; }
        if (action === 'handoffs-open') { const d = $('[data-role="handoff-details"]'); d.open = true; d.scrollIntoView({ block: 'nearest' }); return; }
        try {
            if (action === 'prompt-pack') { await openPromptPack(); return; }
            if (action === 'prompt-preview') {
                const value = await api('content', { chatKey: state.chatKey, action: 'preview' });
                await ctx().callGenericPopup(`<h3>规划题目 · 系统提示词</h3><textarea readonly rows="22" style="width:100%">${escapeHtml(value.system)}</textarea>`, ctx().POPUP_TYPE.TEXT, '', { wide: true }); return;
            }
            const hid = Number(event.target.dataset.id);
            if (action === 'handoff-copy') {
                const r = await api('handoff-ui', { action: 'prompt', id: hid });
                if (r.ok === false) {
                    globalThis.toastr?.warning(r.why);
                    if (['handoff_closed', 'handoff_stale'].includes(r.error)) { delete state.handoffDrafts?.[hid]; await refreshHandoffs(); render(); }
                    return;
                }
                try {
                    await navigator.clipboard.writeText(r.prompt);
                    globalThis.toastr?.success('已复制，贴给任一个 AI');
                } catch {
                    await ctx().callGenericPopup(`<h3>复制题目</h3><textarea data-role="handoff-copy-text" readonly rows="16" style="width:100%">${escapeHtml(r.prompt)}</textarea>`, ctx().POPUP_TYPE.TEXT, '', {
                        wide: true, onOpen: popup => { const box = popup.dlg.querySelector('[data-role="handoff-copy-text"]'); box.focus(); box.select(); },
                    });
                }
                return;
            }
            if (action === 'handoff-paste') {
                state.handoffDrafts ??= {};
                state.handoffDrafts[hid] ??= { text: '', why: '' };
            }
            if (action === 'handoff-cancel') delete state.handoffDrafts?.[hid];
            if (action === 'handoff-submit') {
                const draft = state.handoffDrafts[hid];
                try {
                    const r = await api('handoff-ui', { action: 'submit', id: hid, text: draft.text });
                    if (!r.ok) {
                        draft.why = r.why;
                        if (['handoff_closed', 'handoff_stale'].includes(r.error)) { globalThis.toastr?.warning(r.why); delete state.handoffDrafts[hid]; await refreshHandoffs(); }
                    }
                    else {
                        delete state.handoffDrafts[hid];
                        globalThis.toastr?.success('交上了');
                        await refreshHandoffs();
                        state.status = await api('status', { chatKey: state.chatKey });
                    }
                } catch { draft.why = '后台暂时连不上，回答已保留，可以再交一次。'; }
            }
            if (action === 'join') await join();
            if (action === 'handoff-retry') {
                state.handoffUi = await api('handoff-ui', { action: 'retry', id: Number(event.target.dataset.id) });
                globalThis.toastr?.info('在重试（走 API）。成了会从这里消失；没成就还在，可以再点。');
                for (const wait of [5000, 20000, 60000, 180000]) setTimeout(() => api('status', { chatKey: state.chatKey }).then(st => { state.status = st; noticeHandoffs(st.handoffs); render(); }).catch(() => {}), wait);
            }
            if (action === 'sync') await syncNow();
            if (action === 'confirm') await syncNow(true);
            if (action === 'drift-clear') {
                try { await api('drift-clear', { chatKey: state.chatKey }); state.status = { ...(state.status ?? {}), drift: null }; render(); } catch {}
                return;
            }
            if (action === 'extract-retry') {
                await api('extract-run', { chatKey: state.chatKey, maxWindows: 1 });
                await refreshPlan();
                state.status = await api('status', { chatKey: state.chatKey });
            }
            if (action === 'extract-retry-skipped') {
                await api('extract-retry-skipped', { chatKey: state.chatKey });
                await refreshPlan();
                state.status = await api('status', { chatKey: state.chatKey });
            }
            if ((action === 'extract' || action === 'play-extract-enable') && state.plan) {
                const turningOn = action === 'play-extract-enable' || !state.plan.enabled, c = ctx();
                let fromNow = false;
                if (turningOn && state.plan.pendingMessages) {
                    const p = state.plan;
                    // 默认"从现在开始"：已有的不补、不花钱；要全补是另一个按钮，写清次数和钱
                    const pick = await c.callGenericPopup(`这个窗口已经有 ${p.pendingMessages} 条消息没总结过。<br><b>从现在开始</b>：只总结以后的新消息，旧的不补，不花钱；以后想补，点"补记接入以前的消息"。<br><b>全补</b>：用 ${escapeHtml(p.model)} 把这 ${p.pendingMessages} 条都总结一遍，预计约 ${p.estimate.calls} 次调用、约 $${p.estimate.usd.toFixed(2)}（按配置里的单价估）；今天的花费上限是 $${p.dailyBudgetUsd}，到了会自动停。`, c.POPUP_TYPE.TEXT, '', { okButton: '从现在开始', cancelButton: '取消', customButtons: [{ text: '全补', result: c.POPUP_RESULT.CUSTOM1 }] });
                    if (pick === c.POPUP_RESULT.AFFIRMATIVE) fromNow = true;
                    else if (pick !== c.POPUP_RESULT.CUSTOM1) return;
                }
                await api('extract-enable', { chatKey: state.chatKey, enabled: turningOn, ...(fromNow ? { fromNow: true } : {}) });
                await refreshPlan();
                await refreshPlanStatus();
                await refreshContent();
            }
            if (action === 'backfill' && state.plan?.olderMessages) {
                const p = state.plan, c = ctx();
                const ok = await c.callGenericPopup(`接入以前的 ${p.olderMessages} 条消息还没每条总结。用 ${escapeHtml(p.model)} 补记一遍预计约 ${p.olderEstimate.calls} 次调用、约 ${p.olderEstimate.usd.toFixed(2)}（按配置里的单价估）。今天的花费上限是 ${p.dailyBudgetUsd}，到了会自动停、第二天接着记。补记吗？`, c.POPUP_TYPE.CONFIRM);
                if (ok !== c.POPUP_RESULT.AFFIRMATIVE) return;
                await api('extract-enable', { chatKey: state.chatKey, enabled: true, backfill: true });
                await refreshPlan();
            }
            if (action === 'preview') {
                const c = ctx(), avatar = panel.querySelector('[data-role="preview-who"]').value;
                // 旁白：后台按镜头组那一格（说话的人记成 narrator，同发言时一样）
                const member = avatar === CAMERA_PICK ? { avatar: 'narrator', name: '旁白' } : members(c).find(m => m.avatar === avatar);
                if (member) {
                    const present = [c.name1, ...members(c).filter(m => !m.disabled).map(m => m.name)].filter(Boolean);
                    const { text } = await api('slot-preview', { chatKey: state.chatKey, speaker: member.avatar, speakerName: member.name, recent: c.chat.slice(-3).map(m => String(m.mes ?? '')), recentUser: String([...c.chat.slice(-6)].reverse().find(m => m.is_user)?.mes ?? ''), present });
                    await c.callGenericPopup(`<h3>${escapeHtml(member.name)}此刻会拿到的场记</h3><p><small>按最近 3 条消息找相关的旧事；实际发言时还会按那时的上文再算一次。</small></p><pre style="white-space:pre-wrap">${escapeHtml(text || '（空：没有他知道的、和眼下有关的事）')}</pre>`, c.POPUP_TYPE.TEXT, '', { wide: true, allowVerticalScrolling: true });
                }
            }
            if (action === 'records') await showRecords(false);
            if (action === 'timings') await showTimings();
            if (action === 'episodes') await showEpisodes();
            if (action === 'rejected') await showRecords(true);
            if (action === 'ledger') await showLedger();
            if (action === 'pending') await showPending();
            if (action === 'talk') await openTalk();
            if (action === 'lore') await openLore();
            if (action === 'cast') await editCast();
            if (action === 'setup') { await openSetup(); await refreshContent().catch(() => {}); }
            if (action === 'relations') await openRelations();
            if (action === 'relations-draft' && state.relationsDraft?.status === 'drafted') await openRelations(state.relationsDraft.text, state.relationsDraft.id);
            if (action === 'presets') await openPresets();
            if (action === 'opening-pack') await openOpeningPack();
            if (action === 'health-retry') await backendConnection.check(true);
            if (action === 'material-pack') await openMaterialPack();
            if (action === 'camera') await setUpCamera();
            if (action === 'fresh-settings') await openFreshSettings();
            if (action === 'stages') await openStages();
            if (action === 'places') await openPlaces();
            if (action === 'tuning') await openTuning();
            if (action === 'plan-attempts') {
                const chatKey = state.chatKey, result = await api('status', { chatKey });
                if (state.chatKey !== chatKey) return;
                await ctx().callGenericPopup(planAttemptsHtml(result.planning, escapeHtml), ctx().POPUP_TYPE.TEXT, '', { wide: true, large: true, allowVerticalScrolling: true, onOpen: popup => {
                    popup.dlg.addEventListener('click', async event => {
                        const attemptId = event.target.closest('[data-plan-partial]')?.dataset.planPartial;
                        if (!attemptId) return;
                        try {
                            const part = await api('plan-attempt', { chatKey: state.chatKey, attemptId });
                            const text = part.partial + (part.continuation ? '\n\n【续写原文】\n' + part.continuation : '');
                            await ctx().callGenericPopup('<h3>规划半截原文（只读）</h3><textarea readonly rows="20" style="width:100%">' + escapeHtml(text) + '</textarea>', ctx().POPUP_TYPE.TEXT, '', { wide: true, large: true, allowVerticalScrolling: true });
                        } catch (error) { globalThis.toastr?.warning(error.message); }
                    });
                } });
            }
            if (action === 'update') await openUpdate();
            if (action === 'plan-repair') { await api('plan-repair', { chatKey: state.chatKey }); refreshPlanStatus(); }
            if (action === 'plan-request') { state.planStatus = await api('plan', { chatKey: state.chatKey, request: true }); refreshPlanStatus(); }
            if (action === 'plan-reroll') {
                const c = ctx(), chatKey = state.chatKey;
                const current = await api('status', { chatKey });
                if (state.chatKey !== chatKey) return;
                if (current.planning?.running) { globalThis.toastr?.info('正在重新规划'); return; }
                const answer = await c.callGenericPopup('重抽这一份规划？抽成功以前，现在这份照常用。', c.POPUP_TYPE.CONFIRM);
                if (answer !== c.POPUP_RESULT.AFFIRMATIVE || state.chatKey !== chatKey) return;
                const result = await api('plan', { chatKey, reroll: true });
                if (state.chatKey !== chatKey) return;
                state.planStatus = result;
                const status = await api('status', { chatKey });
                if (state.chatKey !== chatKey) return;
                state.status = status;
                render();
                refreshPlanStatus();
            }
            if (action === 'plan-reveal') {
                if (!(await ctx().callGenericPopup('幕后规划会剧透：接下来排着什么事、谁会来。确定要看？', ctx().POPUP_TYPE.CONFIRM))) return;
                const p = await api('plan', { chatKey: state.chatKey, reveal: true });
                const STATUS = { waiting: '还没放出来', pocket: '在口袋里', shown: '拿出来了', used: '用上了', sunk: '沉底了', sunk_told: '沉底了', void: '不成立了，撤了', expired: '没赶上，过期了' };
                const row = m => `<div style="margin:.5em 0"><b>${escapeHtml(m.who)}「${escapeHtml(m.title)}」</b> <small>（${STATUS[m.status] ?? escapeHtml(m.status)}，第 ${m.ready_day + 1} 天起${m.after_title ? `，在「${escapeHtml(m.after_title)}」之后` : ''}）</small><br>露面：${escapeHtml(m.surface)}<br>应答：${escapeHtml(m.respond)}<br>沉底：${escapeHtml(m.sink ?? '')}${m.know ? `<br><small>知情：${escapeHtml(m.know)}</small>` : ''}</div>`;
                // 按线分组（节点规划有"线"；老的一张菜单没有，就不分）
                const lines = [...new Set((p.menu ?? []).map(m => m.line ?? ''))];
                const rows = lines.map(l => `${l ? `<h4 style="margin:.8em 0 .2em">${escapeHtml(l)}</h4>` : ''}${(p.menu ?? []).filter(m => (m.line ?? '') === l).map(row).join('')}`).join('');
                const n = p.node;
                const head = n ? [
                    n.局面 && `<p><b>局面</b>：${escapeHtml(n.局面)}</p>`,
                    `<p><b>这个节点</b>：${escapeHtml(n.目标 || p.goal || '')}${n.跨度 ? `（大概${escapeHtml(n.跨度)}）` : ''}</p>`,
                    (n.算成 || n.落空) && `<p><small>算成：${escapeHtml(n.算成 || '—')}；落空：${escapeHtml(n.落空 || '—')}</small></p>`,
                    n.线?.length && `<p>${n.线.map(l => `<b>${escapeHtml(l.名)}</b>：${escapeHtml(l.走向)}`).join('<br>')}</p>`,
                    n.往后?.length && `<p><small>往后：${n.往后.map(escapeHtml).join('；')}</small></p>`,
                ].filter(Boolean).join('') : `<p>${escapeHtml(p.goal ?? '（还没有）')}</p>`;
                await ctx().callGenericPopup(`<h3>幕后规划</h3>${head}${rows}`, ctx().POPUP_TYPE.TEXT, '', { wide: true, allowVerticalScrolling: true });
            }
            if (action === 'toggle' && state.status) {
                await api('enabled', { chatKey: state.chatKey, enabled: !state.status.enabled });
                clearPrompts();
                state.status = await api('status', { chatKey: state.chatKey });
            }
        } catch { state.note = '后台暂时连不上；ST 照常可用。'; }
        render();
    });
    panel.addEventListener('change', async event => {
        const progressIndex = event.target?.dataset?.intimateProgress;
        if (progressIndex !== undefined) {
            const chatKey = state.chatKey;
            try {
                const value = await api('content', { chatKey, action: 'progress', index: Number(progressIndex), value: event.target.value });
                if (state.chatKey !== chatKey) return;
                state.content = { ...value, chatKey }; render(); refreshPlanStatus();
            } catch (error) { globalThis.toastr?.error(error.message); await refreshContent().catch(() => {}); }
            return;
        }
        const contentOpt = event.target?.dataset?.content, adultIndex = event.target?.dataset?.contentAdult;
        if (contentOpt || adultIndex !== undefined) {
            const chatKey = state.chatKey;
            try {
                const body = contentOpt === 'pack' || contentOpt === 'global-pack' ? { action: 'select', id: event.target.value, global: contentOpt === 'global-pack' }
                    : { action: 'settings', ...(adultIndex !== undefined ? { adult: { index: Number(adultIndex), value: event.target.checked } } : { [contentOpt]: event.target.value }) };
                const value = await api('content', { chatKey, ...body });
                if (state.chatKey !== chatKey) return;
                state.content = { ...value, chatKey }; render(); refreshPlanStatus();
            } catch (error) { globalThis.toastr?.error(error.message); await refreshContent().catch(() => {}); }
            return;
        }
        const opt = event.target?.dataset?.opt;
        if (!opt) return;
        if (opt === 'playMode') {
            try { const t=await api('tuning',{set:'play.mode',value:event.target.value}); state.globalPlay=t.knobs.find(k=>k.path==='play.mode')?.value; await refreshContent(); await refreshPlanStatus(); render(); }
            catch(error){globalThis.toastr?.error(error.message);render();} return;
        }
        if (opt === 'windowConnected') {
            try {
                if (!state.chatKey) { if (event.target.checked) await join(); }
                else { await api('enabled', { chatKey: state.chatKey, enabled: event.target.checked }); clearPrompts(); state.status = await api('status', { chatKey: state.chatKey }); }
            } catch { state.note = '后台暂时连不上；ST 照常可用。'; }
            render(); return;
        }
        if (opt === 'dailyBudget') {
            try { const t = await api('tuning', { set: 'extractor.dailyBudgetUsd', value: Number(event.target.value) }); state.dailyBudget = t.knobs.find(k => k.path === 'extractor.dailyBudgetUsd')?.value; if (state.chatKey) await refreshPlan(); }
            catch (error) { globalThis.toastr?.error(error.message); }
            render(); return;
        }
        if (opt === 'pack') {
            try { state.pack = await api('pack', { chatKey: state.chatKey, set: event.target.value }); } catch { state.note = '后台暂时连不上。'; }
            render();
            return;
        }
        if (opt === 'handoffAuto') {
            try { state.handoffUi = await api('handoff-ui', { action: 'auto', on: event.target.checked }); }
            catch { state.note = '后台暂时连不上。'; }
        } else if (opt === 'awayMode') {
            try { state.absence = await api('absence', { chatKey: state.chatKey, mode: event.target.value }); }
            catch { state.note = '后台暂时连不上。'; }
        } else if (opt === 'absencePaused') {
            try { state.absence = await api('absence', { chatKey: state.chatKey, paused: event.target.checked }); }
            catch { state.note = '后台暂时连不上。'; }
        } else if (opt === 'testSlot') {
            try {
                await api('options', { chatKey: state.chatKey, testSlot: event.target.checked });
                state.status = await api('status', { chatKey: state.chatKey });
            } catch { state.note = '后台暂时连不上。'; }
        } else {
            settings()[opt] = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
            saveExtensionSettings();
            if (opt === 'enabled') { clearPrompts(); onChatChanged(); }
        }
        render();
    });
    host.append(panel);
    const form = document.querySelector('#form_sheld');
    if (form && !document.querySelector('#rpe_door')) {
        const door = document.createElement('div');
        door.id = 'rpe_door';
        door.style.cssText = 'margin:.25em 0;overflow-wrap:anywhere;';
        const style = document.createElement('style');
        // 门那一行（D-175）：一人一条，名字和理由一行（亮着的那条全显示，其余超长截断），按钮横排、窄屏自动换行
        style.textContent = '#rpe_door{font-size:.9em}#rpe_door .rpe-door-title{opacity:.8;margin-bottom:.15em}#rpe_door .rpe-door-reason{margin-left:.5em;color:var(--SmartThemeQuoteColor,#f90);font-weight:bold}#rpe_door .rpe-door-list{display:flex;flex-direction:column;gap:.2em}#rpe_door .rpe-door-item{display:flex;flex-wrap:wrap;align-items:center;gap:.25em;padding:.15em .35em;opacity:.7;border:1px solid var(--SmartThemeBorderColor,#888);border-radius:.3em}#rpe_door .rpe-door-item.rpe-door-lit{opacity:1;border-color:var(--SmartThemeQuoteColor,#f90)}#rpe_door .rpe-door-who{flex:1 1 12em;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}#rpe_door .rpe-door-item.rpe-door-lit .rpe-door-who{white-space:normal}#rpe_door .menu_button.rpe-door-way,#rpe_door .menu_button.rpe-door-cancel{display:inline-flex;width:auto;flex:0 0 auto;margin:0;padding:.1em .5em;font-size:.9em;white-space:nowrap}';
        document.head.append(style);
        form.insertBefore(door, document.querySelector('#send_form') ?? form.firstChild);
    }
    render();
}

// ---------- 导入开局包（_dev/开局包格式-20261017.md，用户 10/17：一键导入一整局）----------
// 后台读清单、把卡／书／局预设的文本交过来、素材包复制进它的目录；这里拿着酒馆的请求头把卡和书导进 ST、user 卡建成人设、建群、
// 开群聊留在场的开场白、接入窗口、套局预设、绑窗口书、选 ST 预设。ST 里已有的同名卡和书默认不动（勾了"覆盖"才用包里的，覆盖前后台先备份原件）。
// 每一步失败停在那一步报出来，导进去的留着（重来会跳过已有的）。
let stPersonas = null, stWorldInfoMod = null, stPowerUser = null;
import('../../../personas.js').then(m => { stPersonas = m; }).catch(() => {});
import('../../../world-info.js').then(m => { stWorldInfoMod = m; }).catch(() => {});
import('../../../power-user.js').then(m => { stPowerUser = m; }).catch(() => {});
const stHeaders = () => { const h = { ...ctx().getRequestHeaders() }; delete h['Content-Type']; delete h['content-type']; return h; };
async function stUpload(route, filename, blobOrText, extra = {}) {
    const fd = new FormData();
    fd.append('avatar', blobOrText instanceof Blob ? new File([blobOrText], filename, { type: blobOrText.type || 'image/png' }) : new File([blobOrText], filename, { type: 'application/json' }));
    for (const [k, v] of Object.entries(extra)) fd.append(k, v);
    const res = await fetch(route, { method: 'POST', headers: stHeaders(), body: fd });
    if (!res.ok) throw new Error(`${route} ${res.status}：${(await res.text()).slice(0, 120)}`);
    return res.json().catch(() => ({}));
}
async function stJson(route, body) {
    const res = await fetch(route, { method: 'POST', headers: ctx().getRequestHeaders(), body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`${route} ${res.status}：${(await res.text()).slice(0, 120)}`);
    return res.json().catch(() => ({}));
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const stWorldNames = () => (Array.isArray(stWorldInfoMod?.world_names) ? stWorldInfoMod.world_names : []);
// 这一包和 ST 里现有的撞了哪些：卡按名字、书按名字
function packConflicts(r) {
    const have = new Set((ctx().characters ?? []).map(ch => ch.name));
    const books = new Set(stWorldNames());
    return { cards: r.cards.filter(x => have.has(x.name)).map(x => x.name), books: r.books.filter(b => books.has(b.name)).map(b => b.name) };
}
export async function uploadOpeningZip(file, send, progress = () => {}) {
    if (!/\.zip$/i.test(file.name)) throw new Error('只认 .zip；rar、7z 请先转成 zip');
    const chunkSize = 4 * 1024 * 1024, total = Math.ceil(file.size / chunkSize), id = crypto.randomUUID();
    if (!total) throw new Error('压缩包是空的');
    try {
        let result;
        for (let index = 0; index < total; index++) {
            const bytes = new Uint8Array(await file.slice(index * chunkSize, (index + 1) * chunkSize).arrayBuffer());
            let binary = ''; for (let at = 0; at < bytes.length; at += 32768) binary += String.fromCharCode(...bytes.subarray(at, at + 32768));
            progress(index + 1, total); result = await send('opening-pack-upload', { id, index, total, name: file.name, data: btoa(binary) }, 180000);
        }
        return result.path;
    } catch (e) { try { await send('opening-pack-upload', { id, abort: true }); } catch {} throw e; }
}
async function openMaterialPack() {
    const c = ctx(), chatKey = state.chatKey;
    if (!chatKey) return;
    const box = document.createElement('div');
    box.style.textAlign = 'left';
    box.innerHTML = `<h3>导入素材包</h3>
        <label><input type="radio" name="rpe-material-source" value="zip" checked>选 zip</label>
        <div><input type="file" data-f="zip" accept=".zip" hidden><button class="menu_button" type="button" data-p="zip" style="width:auto;white-space:nowrap" title="打开系统文件选择器，建议选下载的zip。">选压缩包</button></div>
        <label><input type="radio" name="rpe-material-source" value="git">贴 git 地址</label>
        <div style="display:flex;gap:.4em"><input class="text_pole" data-f="git" placeholder="https://… 仓库地址"><button class="menu_button" type="button" data-p="git" style="width:auto;white-space:nowrap" title="拉取或更新素材，建议核对来源。">拉取／更新</button></div>
        <small>只认 zip 或无账号密码的 HTTPS git 地址。先预览，再确认导入。</small>
        <p data-f="progress" role="status"></p><div data-f="preview"></div>`;
    const preview = box.querySelector('[data-f="preview"]'), progress = box.querySelector('[data-f="progress"]');
    let looked = null, busy = false;
    const lock = value => { busy = value; for (const el of box.querySelectorAll('button,input')) el.disabled = value; };
    const show = async source => {
        looked = null;
        const r = await api('material-pack', { chatKey, path: source });
        if (r.choices) {
            preview.innerHTML = '<p>找到几份素材包，请选一份：</p>' + r.choices.map(x => `<button class="menu_button" type="button" data-p="choose" data-path="${escapeHtml(x.path)}" title="预览这份素材，建议核对内容。">${escapeHtml(x.name)}</button>`).join('');
            return;
        }
        looked = r;
        preview.innerHTML = `<h4>${escapeHtml(r.name)}</h4><ul>${r.checks.map(x => `<li>${escapeHtml(x.file)} ${x.ok === true ? '✓' : x.ok === false ? '✗' : '—'} ${escapeHtml(x.why)}</li>`).join('')}</ul>
            ${r.exists ? '<p>后台已有同名素材包，导入时会再问是否覆盖。</p>' : ''}
            <label><input type="checkbox" data-f="use" checked>给这一局用</label>
            <button class="menu_button" type="button" data-p="go" style="width:auto;white-space:nowrap" title="复制到后台素材目录，建议核对后导入。">导入</button>`;
    };
    const run = async work => {
        if (busy) return;
        lock(true);
        try { await work(); } catch (e) { progress.textContent = e.message; }
        finally { lock(false); }
    };
    box.querySelector('[data-f="zip"]').addEventListener('change', event => {
        const file = event.target.files?.[0]; if (!file) return;
        run(async () => {
            looked = null; preview.innerHTML = ''; box.querySelector('[value="zip"]').checked = true;
            const source = await uploadOpeningZip(file, (_route, data, timeout) => api('material-pack-upload', data, timeout), (i, n) => { progress.textContent = `上传中 ${i}/${n}`; });
            progress.textContent = '上传完成'; await show(source);
        });
        event.target.value = '';
    });
    box.addEventListener('click', event => {
        const action = event.target?.dataset?.p;
        if (!action || busy) return;
        if (action === 'zip') { box.querySelector('[data-f="zip"]').click(); return; }
        run(async () => {
            if (action === 'git') {
                looked = null; preview.innerHTML = ''; box.querySelector('[value="git"]').checked = true;
                progress.textContent = '正在拉取／更新……';
                const r = await api('material-pack-git', { url: box.querySelector('[data-f="git"]').value.trim() }, 190000);
                progress.textContent = r.operation === 'pull' ? '仓库更新完成' : '仓库拉取完成'; await show(r.path);
            }
            if (action === 'choose') await show(event.target.dataset.path);
            if (action === 'go' && looked) {
                if (state.chatKey !== chatKey) throw new Error('当前窗口变了，请回原窗口重新导入');
                const use = !!box.querySelector('[data-f="use"]').checked;
                const send = overwrite => api('material-pack', { chatKey, path: looked.path, go: true, use, overwrite });
                let r = await send(false);
                if (r.needsOverwrite) {
                    if (!(await c.callGenericPopup(`素材包「${escapeHtml(r.name)}」已经有了，覆盖吗？`, c.POPUP_TYPE.CONFIRM))) { progress.textContent = '没有覆盖'; return; }
                    r = await send(true);
                }
                if (state.chatKey === chatKey) { state.pack = { packs: r.packs, pack: r.pack }; render(); }
                looked = null; preview.innerHTML = ''; progress.textContent = `素材包「${r.name}」导入了${r.pack === r.name ? '，这一局已选用' : ''}。`;
            }
        });
    });
    await c.callGenericPopup(box, c.POPUP_TYPE.TEXT, '', { wide: true, allowVerticalScrolling: true, okButton: '关闭' });
}
async function openOpeningPack() {
    const c = ctx();
    const box = document.createElement('div');
    box.style.textAlign = 'left';
    box.innerHTML = `<h3>导入开局包</h3>
        <p><small>先选来源，再看一眼、核对并导入；会新建群、接入并套局预设，原窗口不套。</small></p>
        <label><input type="radio" name="rpe-opening-source" value="zip" checked>选压缩包（推荐）</label>
        <div><input type="file" data-f="zip" accept=".zip" hidden><button class="menu_button" data-p="zip" type="button" style="width:auto;white-space:nowrap" title="打开系统文件选择器，建议选下载的zip。">选压缩包</button><small style="display:block">QQ、微信里收到的，先点“保存到手机”或“用其他应用打开”存到下载里再选。只认 .zip；rar、7z 请先转成 zip。</small></div>
        <label><input type="radio" name="rpe-opening-source" value="git">贴 git 地址</label>
        <div style="display:flex;gap:.4em"><input class="text_pole" data-f="git" placeholder="https://… 仓库地址" style="flex:1"><button class="menu_button" data-p="git" type="button" style="width:auto;white-space:nowrap" title="拉取或更新仓库，建议先核对来源。">拉取／更新</button></div>
        <details><summary>本机文件夹（电脑进阶）</summary><label><input type="radio" name="rpe-opening-source" value="folder">本机文件夹</label><div style="display:flex;gap:.4em"><input class="text_pole" data-f="path" placeholder="局包所在的文件夹" style="flex:1" value="${escapeHtml(settings().lastOpeningPack ?? '')}"><button class="menu_button" data-p="check" type="button" style="white-space:nowrap" title="预览开局包资源，建议导入前先核对。">看一眼</button></div></details>
        <small data-f="source-progress"></small>
        <div data-f="preview" style="margin-top:.6em"></div>`;
    const preview = box.querySelector('[data-f="preview"]');
    let looked = null, pathIn = '';
    box.querySelector('[data-f="zip"]').addEventListener('change', async event => {
        const file = event.target.files?.[0]; if (!file) return;
        box.querySelector('[value="zip"]').checked = true; looked = null; preview.innerHTML = '';
        try { pathIn = await uploadOpeningZip(file, api, (i,n) => { box.querySelector('[data-f="source-progress"]').textContent = `上传中 ${i}/${n}`; }); box.querySelector('[data-f="source-progress"]').textContent = '上传完成'; box.querySelector('[data-p="check"]').click(); }
        catch(e) { preview.textContent = e.message; }
    });
    box.addEventListener('click', async event => {
        const act = event.target?.dataset?.p;
        if (!act) return;
        try {
            if (act === 'zip') { box.querySelector('[data-f="zip"]').click(); return; }
            if (act === 'git') {
                box.querySelector('[value="git"]').checked = true; looked = null; preview.innerHTML = '';
                box.querySelector('[data-f="source-progress"]').textContent = '正在拉取／更新……';
                const source = await api('opening-pack-git', { url: box.querySelector('[data-f="git"]').value.trim() }, 190000);
                pathIn = source.path; box.querySelector('[data-f="source-progress"]').textContent = source.operation === 'pull' ? '仓库更新完成' : '仓库拉取完成';
            }
            if (act === 'choose') pathIn = event.target.dataset.path;
            if (['check', 'git', 'choose'].includes(act)) {
                if (act === 'check' && box.querySelector('[name="rpe-opening-source"]:checked').value === 'folder') pathIn = box.querySelector('[data-f="path"]').value.trim();
                looked = null;
                preview.innerHTML = '<small>在看……</small>';
                looked = await api('opening-pack', { path: pathIn }, 60000);
                if (looked.choices) { preview.innerHTML = '<p>包里有多份开局包，请选一份：</p>' + looked.choices.map(x=>`<button class="menu_button" type="button" data-p="choose" data-path="${escapeHtml(x.path)}" title="选择这份开局包，建议核对名称。">${escapeHtml(x.name)}</button>`).join(''); looked = null; return; }
                if (box.querySelector('[name="rpe-opening-source"]:checked').value === 'folder') { settings().lastOpeningPack = pathIn; saveExtensionSettings(); }
                const clash = packConflicts(looked);
                const li = s => `<li>${s}</li>`;
                preview.innerHTML = `<p><b>${escapeHtml(looked.manifest.名)}</b>（群名：${escapeHtml(looked.manifest.群名)}）</p><ul>
                    ${li(`卡 ${looked.cards.length} 张${looked.user ? `；user 卡「${escapeHtml(looked.user.name)}」建成人设、不进群` : '；没有 user 卡（用你现在的人设）'}`)}
                    ${li(`开场白 ${looked.manifest.开场在场.length} 段（按这个顺序拼成开场）：${escapeHtml(looked.manifest.开场在场.join('、'))}`)}
                    ${li(`开场时和你在同一处的（只有这几位不静音；后台把没静音的当成在场。别处那几段开场白他们看不见）：<br>${looked.manifest.开场在场.map(n => `<label class="checkbox_label" style="display:inline-flex;margin-right:.8em"><input type="checkbox" data-together="${escapeHtml(n)}"${(looked.manifest.同场写了 ? looked.manifest.同场.includes(n) : true) ? ' checked' : ''}> ${escapeHtml(n)}</label>`).join('')}${looked.manifest.同场写了 ? '' : '<br><small>包里没写同场：默认全勾，只留跟你在一处的</small>'}`)}
                    ${li(`世界书 ${looked.books.length} 本：${looked.books.map(b => `${escapeHtml(b.name)}（${b.entries} 条，绑${b.bind}）`).join('；') || '无'}`)}
                    ${li(looked.preset ? `局预设「${escapeHtml(looked.preset.name)}」：名册 ${looked.preset.people} 人${looked.preset.setup ? '、开局单' : ''}${looked.preset.relations ? '、关系表' : ''}${looked.preset.pack ? `、素材包 ${escapeHtml(looked.preset.pack)}` : ''}` : '没有局预设')}
                    ${li(looked.pack ? `素材包「${escapeHtml(looked.pack.name)}」：${looked.pack.checks.map(x => `${escapeHtml(x.file)} ${x.ok === true ? '✓' : x.ok === false ? '✗' : '—'}${x.why ? ` ${escapeHtml(x.why)}` : ''}`).join('；')}` : '没有素材包')}
                    ${li(looked.stPreset ? `ST 预设：${escapeHtml(looked.stPreset.name)}` : 'ST 预设：用当前的')}</ul>
                    ${clash.cards.length || clash.books.length ? `<p>你的 ST 里已经有同名的：${clash.cards.length ? `卡 ${clash.cards.map(escapeHtml).join('、')}` : ''}${clash.cards.length && clash.books.length ? '；' : ''}${clash.books.length ? `书 ${clash.books.map(escapeHtml).join('、')}` : ''}。默认用你 ST 里现在那份，不动。</p>
                        <label class="checkbox_label"><input type="checkbox" data-f="overwrite"> 用包里的覆盖这几份（原件先备份到后台的 backups）</label>` : ''}
                    ${looked.warnings.length ? `<p style="color:var(--SmartThemeQuoteColor,#f90)">${looked.warnings.map(escapeHtml).join('<br>')}</p>` : ''}
                    <small>局预设文件夹里的“窗口书”“剧情种子书”“开场.txt”是给没装本系统的人用的，导入时不读。</small>
                    <button class="menu_button" data-p="go" type="button" style="width:auto;white-space:nowrap" title="导资源并建新群，建议确认清单后点。">就这样，导进来并开局</button>`;
            }
            if (act === 'go') {
                if (!looked) return;
                event.target.disabled = true;
                const overwrite = !!box.querySelector('[data-f="overwrite"]')?.checked;
                const together = [...box.querySelectorAll('[data-together]')].filter(x => x.checked).map(x => x.dataset.together);
                preview.insertAdjacentHTML('beforeend', '<div data-f="log" style="margin-top:.5em;font-family:monospace;white-space:pre-wrap"></div>');
                const logEl = preview.querySelector('[data-f="log"]');
                const say = s => { logEl.textContent += `${s}\n`; };
                await importOpeningPack(pathIn, say, { overwrite, together });
            }
        } catch (error) { preview.insertAdjacentHTML('beforeend', `<p style="color:#e55">${escapeHtml(error.message)}</p>`); }
    });
    await c.callGenericPopup(box, c.POPUP_TYPE.TEXT, '', { wide: true, large: true, allowVerticalScrolling: true, okButton: '关闭' });
}
// user 卡 → 人设（不经 ST 的"卡转人设"：那条路描述里有 {{user}} 会弹窗问要不要对调）。已有同名人设就只选中，不改描述
async function personaFrom(cardText, say) {
    const j = JSON.parse(cardText), d = j?.data ?? j;
    const name = String(d?.name ?? j?.name ?? '').trim(), description = String(d?.description ?? j?.description ?? '');
    const pu = stPowerUser?.power_user;
    if (!name || !pu || !stPersonas?.setUserAvatar) { say(`user 卡：没建成人设（${!name ? '卡没有名字' : '页面拿不到人设模块'}），你在人设管理里自己建`); return null; }
    const key = `${name} (Persona).png`;
    if (pu.personas?.[key]) say(`user 卡：人设「${name}」已经有了，选中它（描述没动）`);
    else {
        const img = await fetch('img/user-default.png').then(r => r.blob());
        await stUpload('/api/avatars/upload', 'avatar.png', img, { overwrite_name: key });
        pu.personas[key] = name;
        pu.persona_descriptions[key] = { description, position: 0, depth: 2, role: 0, lorebook: '', title: '' };
        ctx().saveSettingsDebounced();
        await stPersonas.getUserAvatars?.(true, key);
        say(`user 卡：建成人设「${name}」`);
    }
    await stPersonas.setUserAvatar(key, { toastPersonaNameChange: false });
    return key;
}
const OPENING_SAVE_ERROR = '聊天没存上（ST 说完整性校验失败）。群已经建了，卡和书没动。请关掉这个群重新导一次，或者告诉 Claude。';
function openingMessageStamp(messages) {
    return JSON.stringify(messages.map(m => [!!m.is_user, !!m.is_system, m.name ?? '', m.mes ?? '', m.original_avatar ?? '', m.send_date ?? '']));
}
function openingGroupIsCurrent(group) {
    const c = ctx();
    return String(c.groupId) === String(group.id) && String(c.chatId) === String(group.chat_id);
}
function openingDiagnosticHash(value) {
    let hash = 2166136261;
    for (const ch of String(value ?? '')) hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619);
    return (hash >>> 0).toString(16).padStart(8, '0');
}
function openingSaveFailure(code, details = {}) {
    const error = new Error(OPENING_SAVE_ERROR);
    error.openingDiagnostic = `${code} ${JSON.stringify(details)}`;
    console.warn('开局保存核验', error.openingDiagnostic);
    return error;
}
// ST getGroupChat 在所有开场白追加、首次 saveGroupChat 和元数据安装之后发 CHAT_CHANGED。
// 先订阅再开窗/重载，不拿“已经有三条”当成 24 人群初始化完成。
async function openingChatReady(group, open) {
    const c = ctx(), event = c.eventTypes.CHAT_CHANGED;
    let handler, timer;
    try {
        const ready = new Promise((resolve, reject) => {
            handler = () => { if (openingGroupIsCurrent(group)) resolve(); };
            c.eventSource.on(event, handler);
            timer = setTimeout(() => reject(new Error(OPENING_SAVE_ERROR)), 60000);
        });
        await Promise.all([ready, Promise.resolve().then(open)]);
    } finally {
        clearTimeout(timer);
        c.eventSource.removeListener(event, handler);
    }
}
async function readOpeningChat(group) {
    if (!openingGroupIsCurrent(group)) throw openingSaveFailure('WINDOW_MISMATCH');
    let rows;
    try { rows = await stJson('/api/chats/group/get', { id: group.chat_id }); }
    catch { throw openingSaveFailure('READ_FAILED'); }
    if (!Array.isArray(rows) || !rows[0]?.chat_metadata) throw openingSaveFailure('READ_FORMAT');
    return { metadata: rows[0].chat_metadata, messages: rows.slice(1) };
}
async function verifyOpeningChat(group, expected, { metadata = true, allowMissingIntegrity = false } = {}) {
    const disk = await readOpeningChat(group);
    if (!openingGroupIsCurrent(group)) throw openingSaveFailure('WINDOW_MISMATCH');
    const diskStamp = openingMessageStamp(disk.messages), memoryStamp = openingMessageStamp(ctx().chat);
    if (diskStamp !== expected || memoryStamp !== expected) throw openingSaveFailure('MESSAGE_MISMATCH', { diskCount: disk.messages.length, memoryCount: ctx().chat.length, disk: openingDiagnosticHash(diskStamp), memory: openingDiagnosticHash(memoryStamp), expected: openingDiagnosticHash(expected) });
    const integrityMatches = (allowMissingIntegrity && !disk.metadata.integrity) || disk.metadata.integrity === ctx().chatMetadata?.integrity;
    if (metadata && !integrityMatches) throw openingSaveFailure('INTEGRITY_MISMATCH', { disk: openingDiagnosticHash(disk.metadata.integrity), memory: openingDiagnosticHash(ctx().chatMetadata?.integrity) });
    if (metadata && disk.metadata.rp_emergence?.chatKey !== ctx().chatMetadata?.rp_emergence?.chatKey) throw openingSaveFailure('CHAT_KEY_MISMATCH', { disk: openingDiagnosticHash(disk.metadata.rp_emergence?.chatKey), memory: openingDiagnosticHash(ctx().chatMetadata?.rp_emergence?.chatKey) });
    return disk;
}
async function prepareOpeningChat(group, present, open) {
    await openingChatReady(group, open);
    // 完成事件保证首次保存已返回；再核对静止的一整份消息，处理事件订阅者继续追加的情况。
    let stable = '', since = Date.now();
    const deadline = Date.now() + 60000;
    for (;;) {
        if (!openingGroupIsCurrent(group) || Date.now() >= deadline) throw new Error(OPENING_SAVE_ERROR);
        const stamp = openingMessageStamp(ctx().chat);
        if (stamp !== stable || stGroups?.is_group_generating) { stable = stamp; since = Date.now(); }
        if (Date.now() - since >= 400) break;
        await sleep(100);
    }
    await verifyOpeningChat(group, stable, { metadata: false });
    // ST 1.16 首次保存发生在 updateChatMetadata 前；用官方重载安装磁盘元数据，绝不改 slug 或 force。
    await openingChatReady(group, () => ctx().reloadCurrentChat());
    await verifyOpeningChat(group, stable, { allowMissingIntegrity: true });
    const keep = new Set(present), now = ctx();
    const kept = now.chat.filter(m => m.is_user || keep.has(m.name));
    now.chat.splice(0, now.chat.length, ...kept);
    const expected = openingMessageStamp(kept);
    await now.saveChat();
    await verifyOpeningChat(group, expected);
    await openingChatReady(group, () => ctx().reloadCurrentChat());
    await verifyOpeningChat(group, expected);
    return kept;
}
async function importOpeningPack(pathIn, say, { overwrite = false, together = null } = {}) {
    const c = ctx();
    state.importingPack = true;
    try {
        const peek = await api('opening-pack', { path: pathIn }, 60000);
        const clash = packConflicts(peek);
        const byNameNow = new Map((c.characters ?? []).map(ch => [ch.name, ch]));
        const backup = overwrite ? { cards: clash.cards.map(n => byNameNow.get(n)?.avatar).filter(Boolean), books: clash.books } : null;
        const r = await api('opening-pack', { path: pathIn, go: true, ...(backup ? { backup } : {}) }, 180000);
        say(`读到：${r.manifest.名}；${r.pack ? (r.pack.installed?.skipped ? `素材包「${r.pack.name}」后台已经有，没动` : `素材包复制到后台「${r.pack.name}」`) : '没有素材包'}${r.backedUp ? `；覆盖前备份在 ${r.backedUp}` : ''}`);
        // 1. 卡：已有同名的默认跳过；勾了覆盖就按原文件名盖掉（ST 的 preserved_name）
        let imported = 0, replaced = 0;
        const skipped = [];
        for (const card of r.cards) {
            const old = byNameNow.get(card.name);
            if (old && !overwrite) { skipped.push(card.name); continue; }
            await stUpload('/api/characters/import', card.file, card.text, { file_type: 'json', ...(old ? { preserved_name: old.avatar } : {}) });
            if (old) replaced++; else imported++;
        }
        await c.getCharacters();
        say(`卡：新导 ${imported} 张${replaced ? `，覆盖 ${replaced} 张` : ''}${skipped.length ? `，已有的没动 ${skipped.length} 张（${skipped.slice(0, 6).join('、')}${skipped.length > 6 ? '…' : ''}）` : ''}`);
        const have = () => new Map((ctx().characters ?? []).map(ch => [ch.name, ch]));
        const byName = have();
        const missing = r.cards.filter(x => !byName.has(x.name)).map(x => x.name);
        if (missing.length) throw new Error(`这几张卡导完 ST 里找不到：${missing.join('、')}`);
        // 2. 世界书：已有同名的默认跳过
        const booksHave = new Set(stWorldNames());
        let booksIn = 0;
        for (const b of r.books) { if (booksHave.has(b.name) && !overwrite) continue; await stUpload('/api/worldinfo/import', b.file, b.text); booksIn++; }
        try { await stWorldInfoMod?.updateWorldInfoList?.(); } catch {}
        if (r.books.length) say(`世界书：导了 ${booksIn} 本${r.books.length - booksIn ? `，已有的没动 ${r.books.length - booksIn} 本` : ''}`);
        // 3. user 卡 → 人设
        const personaKey = r.user ? await personaFrom(r.user.text, say) : null;
        // 4. 建群：开场白那几位按顺序排前面（ST 按成员顺序放开场白），其余在后；只有同场的不静音（自动进离场开着时，接入后扩展会把回复方式改成手动）
        const present = r.manifest.开场在场.filter(n => byName.has(n));
        const others = r.cards.map(x => x.name).filter(n => !present.includes(n) && byName.has(n));
        const members = [...present, ...others].map(n => byName.get(n).avatar);
        const near = (Array.isArray(together) ? together : r.manifest.同场写了 ? r.manifest.同场 : present).filter(n => byName.has(n));
        const disabled = [...present, ...others].filter(n => !near.includes(n)).map(n => byName.get(n).avatar);
        const group = await stJson('/api/groups/create', { name: r.manifest.群名, members, disabled_members: disabled, activation_strategy: 0, generation_mode: 0, allow_self_responses: false });
        await c.getCharacters();
        await sleep(600);
        say(`群「${r.manifest.群名}」建好：${members.length} 人；同场不静音 ${near.length} 人（${near.join('、')}），其余 ${disabled.length} 人静音`);
        // 5. 开群聊：ST 按成员顺序放每张卡的开场白；不在场的（还有在场名单外的）那几条删掉
        const el = document.querySelector(`.group_select[data-grid="${group.id}"]`);
        if (!el) throw new Error('群建好了但列表里还没出现：刷新页面后点进群、在面板里接入、再套局预设');
        const kept = await prepareOpeningChat(group, present, () => el.click());
        say(`开场白：留了 ${kept.length} 条（${[...new Set(kept.map(m => m.name))].join('、')}）`);
        // 同场的人从同场那几段开场白起才看得见（别处那几段——春和堂、客院——他们不在）：上下文隔离扩展记的在场区间
        const firstNear = kept.findIndex(m => near.includes(m.name));
        const isolateNear = async () => { for (const n of near) await run(`/isolate ${n} ${firstNear}`); };
        const isolated = () => near.every(n => { const av = byName.get(n)?.avatar; return !!ctx().chatMetadata?.contextIsolation?.anchors?.[av]?.segments?.length; });
        if (firstNear > 0 && near.length && hasCommand('isolate')) {
            await isolateNear();
            await ctx().saveMetadata();
            await verifyOpeningChat(group, openingMessageStamp(kept));
            say(`在场区间：${near.join('、')} 从第 ${firstNear} 条起`);
        }
        if (personaKey) {
            try { await stPersonas.setUserAvatar(personaKey, { toastPersonaNameChange: false }); await stPersonas.setPersonaLockState?.(true, 'chat'); } catch {}
            await ctx().saveMetadata();
        }
        await verifyOpeningChat(group, openingMessageStamp(kept));
        // 6. 接入这个窗口；局预设、窗口书、ST 预设
        await join();
        for (let i = 0; i < 20 && !state.chatKey; i++) await sleep(300);
        if (!state.chatKey) throw new Error('接入没成：在面板“设置”勾选“本窗口接入”，再在“局预设”里套上');
        await verifyOpeningChat(group, openingMessageStamp(kept));
        if (r.preset) {
            await api('preset', { import: r.preset.data });
            const a = await api('preset', { chatKey: state.chatKey, apply: r.preset.name });
            for (const warning of a.applied.warnings ?? []) say(warning);
            say(`局预设「${r.preset.name}」套上了：名册 ${a.applied.people} 人${a.applied.setup ? '、开局单' : ''}${a.applied.relations ? '、关系表' : ''}${a.applied.pack ? `、素材包 ${a.applied.pack}` : ''}`);
        }
        const chatBook = r.books.find(b => b.bind === '窗口');
        if (chatBook) { ctx().chatMetadata.world_info = chatBook.name; await ctx().saveMetadata(); await verifyOpeningChat(group, openingMessageStamp(kept)); say(`窗口书：绑了「${chatBook.name}」`); }
        for (const b of r.books.filter(x => x.bind === '全局')) { try { await ctx().executeSlashCommandsWithOptions(`/world ${b.name}`); say(`全局书：开了「${b.name}」`); } catch {} }
        if (r.stPreset) { try { await stJson('/api/presets/save', { name: r.stPreset.name, preset: JSON.parse(r.stPreset.text), apiId: 'openai' }); await ctx().executeSlashCommandsWithOptions(`/preset ${r.stPreset.name}`); say(`ST 预设：${r.stPreset.name}`); } catch (error) { say(`ST 预设没选上：${error.message}`); } }
        // 在场区间再核一遍（中间几次存元数据有没有把它盖掉）：没有就补记
        if (firstNear > 0 && near.length && hasCommand('isolate') && !isolated()) {
            await isolateNear();
            await ctx().saveMetadata();
            say(isolated() ? '在场区间：补记上了' : `在场区间：没记上，你可以手动 /isolate 名字 ${firstNear}`);
        }
        await verifyOpeningChat(group, openingMessageStamp(kept));
        await syncNow(true).catch(() => {});
        await autoPeek().catch(() => {});
        await Promise.all([api('pack', { chatKey: state.chatKey }).then(p => { state.pack = p; }), api('absence', { chatKey: state.chatKey }).then(a => { state.absence = a; })]).catch(() => {});
        render();
        await verifyOpeningChat(group, openingMessageStamp(kept));
        say(`进离场：${auto.on===true?'已开启':auto.on===false?'后台关着':'尚未确认'}；群回复方式：${Number(currentGroup(ctx())?.activation_strategy)===MANUAL_STRATEGY?'手动':'未改成手动'}。`);
        say('开局好了：第一份规划后台自动排。你说第一句。');
        globalThis.toastr?.success('开局包导好了，你说第一句。', 'RP：幕后', { timeOut: 10000 });
    } catch (error) {
        if (error.openingDiagnostic) say(`保存核验诊断：${error.openingDiagnostic}`);
        throw error;
    } finally { state.importingPack = false; }
}

// ---------- 自动进离场与调度（方案 自动进离场与调度，D-201；后台 core/auto.mjs，1c）----------
// 后台的"自动进离场"开着（面板调参那一组）：① 这个群的回复方式改成"手动"——ST 自己不叫人，原来的记下、关了改回去；
// ② 你发一句、某人答完，问后台"谁接"，按单子一次叫一个（叫完群聊收尾又问一次，直到没人该说）；③ 后台说该叩门了：拉进群、开区间、
// 让他自己写那一条（发消息、打电话的带 rp_vis，同屋人看不见）；④ 候着的那一个画快捷按钮（接／让他进来／不理）；⑤ 谁走了、谁作废了：关区间、静音。
// 关着就全照旧：门那一行、点进场离场、旁白接一手。
let stGroups = null;
import('../../../group-chats.js').then(m => { stGroups = m; }).catch(() => {});
const MANUAL_STRATEGY = 2;   // ST 群的 activation_strategy：0 自然 1 列表 2 手动 3 池
const auto = { on: null, unavailable: false, turnEnabled: null, buttons: true, jobs: new Map(), waiting: null, lastTurn: null, noRepeat: null, pending: new Map(), closed: new Set(), remote: new Map() };
function presentNames(c) { return [c.name1, ...members(c).filter(m => !m.disabled).map(m => m.name)].filter(Boolean); }
// 群的回复方式：开了改成手动（记下原来的），关了改回去。改的是 ST 的群设置，记在搬迁清单
async function autoStrategy(enable) {
    const c = ctx(), g = currentGroup(c);
    if (!g) return;
    if (!stGroups?.editGroup) throw new Error('群设置尚未准备好');
    const saved = settings().autoStrategy ??= {};
    const now = Number(g.activation_strategy ?? 0);
    if (enable && now !== MANUAL_STRATEGY) {
        saved[g.id] = now;
        g.activation_strategy = MANUAL_STRATEGY;
        await stGroups.editGroup(g.id, true, false);
        saveExtensionSettings();
        globalThis.toastr?.info('这个群的回复方式改成了"手动"：你发一句 ST 不叫人，谁接话由后台排。关掉"谁接话"或"自动进离场"会改回原来的。', 'RP：幕后', { timeOut: 10000 });
    } else if (!enable && Object.hasOwn(saved, g.id)) {
        if (Number(g.activation_strategy) === MANUAL_STRATEGY) { g.activation_strategy = Number(saved[g.id]); await stGroups.editGroup(g.id, true, false); }
        delete saved[g.id];
        saveExtensionSettings();
        globalThis.toastr?.info('这个群的回复方式改回原来的了。', 'RP：幕后', { timeOut: 6000 });
    }
}
// 开没开、谁候着、谁刚作废：打开窗口时问一次；关着时每条之后也问一下（便宜，纯程序），开了就立刻跟上
async function autoPeek() {
    if (!state.chatKey || !settings().enabled) return false;
    const chatKey = state.chatKey;
    let r = null;
    try { r = await api('turn', { chatKey, peek: true }); } catch { if(chatKey===state.chatKey){auto.unavailable=true;render();} return false; }
    if (chatKey !== state.chatKey) return false;
    await autoApply(r);
    return !!r.enabled;
}
// 后台答的里头：开没开（变了就改群策略）、候着的那一个（画按钮）、谁作废了（关区间、静音）
async function autoApply(r) {
    const enableTurn=autoTurnEnabled(r);
    await autoStrategy(enableTurn);
    const was=auto.on;
    auto.on = !!r?.enabled;
    auto.unavailable=false;
    auto.turnEnabled=enableTurn;
    auto.buttons=r?.buttons!==false;
    auto.waiting = r?.waiting ?? null;
    if (Array.isArray(r?.remote)) auto.remote = new Map(r.remote.map(x => [x.avatar ?? x.who, { who: x.who, way: x.way }]));
    if (auto.on===false && was!==false) refreshDoor().catch(() => {});
    for (const l of [...(r?.left??[]),...(r?.lapsed??[])]) {
        try { await autoClose(l,l.id?'走了':'作废'); }
        catch(error) { console.warn('[RP：幕后] 离场未落实，将重试',l.who,error); }
    }
    render();
}
// 你发一句、某人答完：问后台谁接；该叩门就叩；谁走了关区间
async function autoDrive(type) {
    if (!settings().enabled || !state.chatKey) return 'off';
    if (!auto.on || auto.unavailable) { await autoPeek(); if (auto.unavailable || auto.on===null) return false; if (!auto.on) return 'off'; }
    if (type && type !== 'normal') return false;
    const c = ctx(), group = currentGroup(c);
    if (!group || c.is_group_generating) return false;
    const last = c.chat?.at(-1);
    if (!last) return false;
    // 同一条之后只问一次：叫的人没生成成（断网、被拒）群聊收尾又会走到这里，别一直重叫
    const key = `${c.chat.length}:${fingerprintMessage(last, speakerOf(last, fallbackAvatar(c)))}`;
    if (auto.lastTurn === key) {await autoPeek();return false;}
    const chatKey = state.chatKey, length = c.chat.length;
    await syncNow(true).catch(() => {});
    let r = null;
    try { r = await api('turn', { chatKey, present: presentNames(c), recentUser: [...c.chat].reverse().find(m => m.is_user)?.mes ?? '' }, 240000); } catch { auto.unavailable=true;render();return false; }
    const now = ctx();
    if (chatKey !== state.chatKey || now.chat.length !== length || now.is_group_generating) return false;
    console.log('[RP：幕后] 谁接', JSON.stringify({ queue: r.queue, knock: r.knock, waiting: r.waiting, left: r.left, lapsed: r.lapsed, why: r.why }));
    await autoApply(r);
    if (!auto.on) return 'off';
    auto.lastTurn = key;
    if (r.knock) return autoKnock(r.knock);
    if (!auto.turnEnabled) return 'off';
    const next = (r.queue ?? [])[0];
    return next ? autoSpeak(next) : false;
}
// 叫一个人说：旁白走旁白卡；静音着的（这会儿不在场）不叫
async function autoSpeak(q) {
    const c = ctx(), group = currentGroup(c);
    if (!group) return false;
    if (q.role === '旁白' || q.who === '旁白') {
        const cam = cameraOf(c), at = cam ? group.members.indexOf(cam.avatar) : -1;
        if (at < 0) return false;
        await c.executeSlashCommandsWithOptions(`/trigger await=true ${at}`);
        return true;
    }
    const ch = cardNamed(c, q.who, q.avatar);
    const at = ch ? group.members.indexOf(ch.avatar) : -1;
    if (at < 0) return false;
    if (group.disabled_members?.includes(ch.avatar)) {
        // 静音着＝这会儿不在场；刚走的人被点名叫回来（back）才取消静音、从这条起又在场；别的不叫
        if (!q.back) return false;
        await run(`/member-enable ${at}`);
        if (hasCommand('isolate')) await run(`/isolate ${ch.name}`);
    }
    auto.noRepeat = q.noRepeat ? ch.avatar : null;
    await c.executeSlashCommandsWithOptions(`/trigger await=true ${at}`);
    return true;
}
// 后台说该叩门了：拉进群、取消静音、从这条起在场（区间）、让他自己写那一条；他那条落下时 MESSAGE_RECEIVED 给它记号
async function autoKnock(k) {
    const c = ctx(), group = currentGroup(c), ch = cardNamed(c, k.who, k.avatar);
    if (!group || !ch) return false;
    state.entering.add(ch.avatar);
    try {
        let t0 = performance.now();
        if (!group.members.includes(ch.avatar)) { await run(`/member-add ${ch.avatar}`); tick('叩门:拉进群', performance.now() - t0, ch.name); t0 = performance.now(); }
        const g = currentGroup(ctx()), at = g?.members.indexOf(ch.avatar) ?? -1;
        if (at < 0) return false;
        if (g.disabled_members?.includes(ch.avatar)) { await run(`/member-enable ${at}`); tick('叩门:取消静音', performance.now() - t0, ch.name); t0 = performance.now(); }
        if (hasCommand('isolate')) { await run(`/isolate ${ch.name}`); tick('叩门:开区间', performance.now() - t0, ch.name); }
        auto.pending.set(ch.avatar, { who: ch.name, way: k.way });
        auto.closed.delete(`${ch.name}:${k.at}`);
        await ctx().executeSlashCommandsWithOptions(`/trigger await=true ${at}`);
        return true;
    } finally {
        state.entering.delete(ch.avatar);
        const snap = memberSnapshot();
        if (snap && state.memberBase?.key === snap.key) state.memberBase = snap;
    }
}
// 他走了（后台已经记了去向）、这次叩门作废了（他没进过场）：关区间、静音，不移出群
async function autoClose(l, why) {
    const chatKey=state.chatKey, jobs=auto.jobs, key=l.id??`${l.who}:${l.at}`;
    if(jobs.has(key)) return jobs.get(key);
    const c=ctx(),failures=c.chatMetadata.rpeLeaveRetries??={};
    const task=runLeaveAttempt({failures,key,event:l,attempt:()=>applyAutoClose(l,why,chatKey),save:async()=>{if(state.chatKey!==chatKey||ctx().chat!==c.chat)throw Error('聊天已切换');await c.saveMetadata();}});
    jobs.set(key,task);
    try {await task;} finally {jobs.delete(key);}
}
async function applyAutoClose(l,why,chatKey) {
    const c=ctx(),group=currentGroup(c),ch=cardNamed(c,l.who,l.avatar);
    if(!group || !ch) throw new Error('找不到离场角色');
    const at=l.id?l.at:(l.lapsed?.pos??l.at);
    const key=l.id??`lapsed:${ch.avatar}:${at}`;
    const journal=c.chatMetadata.rpeLeaveEvents??={};
    const guard=()=>{if(state.chatKey!==chatKey || ctx().chat!==c.chat) throw new Error('聊天已切换');};
    const save=async()=>{guard();await c.saveMetadata();};
    const anchor=()=>c.chatMetadata.contextIsolation?.anchors?.[ch.avatar];
    const copy=x=>x==null?null:JSON.parse(JSON.stringify(x));
    const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
    const receipt=journal[key];
    // 本次事件的重试复用最初的快照，刷新页面后也一样。
    if(l.action!=='undo' && (!receipt || receipt.undone)) {
        guard();
        journal[key]={avatar:ch.avatar,before:copy(anchor()),wasDisabled:!!group.disabled_members?.includes(ch.avatar)};
        await save();
    }
    const rec=journal[key];
    // 撤销较早的一次离场，不能冲掉此后另一次已落实的离场。
    const laterClose=()=>Object.entries(journal).filter(([id,r])=>id!==key && (r.avatar===ch.avatar || id.startsWith(`${encodeURIComponent(ch.avatar)}:`))
        && r.closed && !r.undone && r.after?.to>rec?.after?.to).map(([,r])=>r.after).sort((a,b)=>a.to-b.to)[0];
    await applyLeaveEvent(l,{
        close:async()=>{
            guard();
            if(rec.closed) return;
            if(!Number.isInteger(at)||!c.chat[at]) throw new Error('来源条号无效');
            if(l.id && fingerprintMessage(c.chat[at],speakerOf(c.chat[at],fallbackAvatar(c)))!==l.fp) throw new Error('来源消息已改变');
            if(!hasCommand('isolate-leave')) throw new Error('缺少 isolate-leave');
            // 只读注册说明来识别能力；不向原版试发带条号命令。
            const indexed=isolateLeaveSupportsIndex(c.SlashCommandParser?.commands?.['isolate-leave']);
            rec.boundaryMethod=indexed?'command':'metadata';
            try {
                if(indexed) await c.executeSlashCommandsWithOptions(`/isolate-leave ${ch.name} ${at}`);
                else await closeIsolationAt(c,{avatar:ch.avatar,name:ch.name,at});
            }
            finally {
                const segments=anchor()?.segments;
                const seg=Array.isArray(segments)?segments.findLast(x=>x.to===at+1):null;
                if(seg && !segments.some(x=>x.to==null)) {rec.after=copy(seg);rec.closed=true;await save();}
            }
            if(!rec.closed) throw new Error('隔离区间未按来源关闭');
        },
        mute:async()=>{
            guard();
            const g=currentGroup(ctx()),i=g?.members.indexOf(ch.avatar)??-1;
            if(i>=0 && !g.disabled_members?.includes(ch.avatar)) {rec.muting=true;await save();await c.executeSlashCommandsWithOptions(`/member-disable ${i}`);}
            if(i>=0 && !currentGroup(ctx())?.disabled_members?.includes(ch.avatar)) throw new Error('角色未静音');
            rec.muted=true;await save();
        },
        reopen:async()=>{
            guard();
            if(!rec || rec.undone || !rec.closed) return;
            const segs=anchor()?.segments;
            const i=segs?.findIndex(x=>same(x,rec.after))??-1;
            if(i>=0 && !rec.before?.segments?.some(x=>same(x,rec.after))) {
                const before=rec.before?.segments?.findLast(x=>x.to==null);
                const later=laterClose();
                if(before) segs[i]={...copy(before),...(later?{to:later.to,toDate:later.toDate}:{})};
                else if(later && !rec.before) segs[i]={from:0,fromDate:'',to:later.to,toDate:later.toDate};
                else segs.splice(i,1);
                await save();
            }
        },
        unmute:async()=>{
            guard();
            if(!rec || rec.undone) return;
            const g=currentGroup(ctx()),i=g?.members.indexOf(ch.avatar)??-1;
            if((rec.muted||rec.muting) && !rec.wasDisabled && !laterClose() && i>=0 && g.disabled_members?.includes(ch.avatar)) await c.executeSlashCommandsWithOptions(`/member-enable ${i}`);
            if((rec.muted||rec.muting) && !rec.wasDisabled && !laterClose() && i>=0 && currentGroup(ctx())?.disabled_members?.includes(ch.avatar)) throw new Error('角色未取消静音');
            rec.undone=true;await save();
        },
        ack:receipt=>api('leave-ack',{chatKey,receipts:[receipt]})
    });
    if(l.action!=='undo') {if(state.remote?.avatar===ch.avatar)state.remote=null;auto.remote.delete(ch.avatar);}
}
// 快捷按钮：接／让他进来＝进场，不理＝作废（后台定，这里只传信号）
async function autoAnswer(who, answer) {
    const chatKey = state.chatKey;
    const r = await api('knock-answer', { chatKey, who, answer });
    if (!r?.ok) { globalThis.toastr?.warning(`${who}没有候着的叩门。`, 'RP：幕后'); return; }
    await autoPeek();
    globalThis.toastr?.info(r.forced === '作废' ? `${who}这次没进场。` : `${who}进场了：你写一句${who}就接。`, 'RP：幕后', { timeOut: 6000 });
}

// ---------- 事件 ----------

async function stripDoorMark(id) {
    const c = ctx(), m = c.chat?.[id];
    if (!m || m.is_user || speakerOf(m, fallbackAvatar(c)) !== 'narrator') return;
    const mark = doorMark(m.mes);
    if (!mark.who) return;
    m.mes = mark.text;
    if (Array.isArray(m.swipes) && m.swipes[m.swipe_id ?? 0]) m.swipes[m.swipe_id ?? 0] = mark.text;
    c.updateMessageBlock(id, m);
    await c.saveChat();
}

const { eventSource, eventTypes } = ctx();
const on = (name, fn) => { if (eventTypes[name]) eventSource.on(eventTypes[name], fn); };
document.addEventListener('click', event => {
    const retry=event.target?.closest?.('.rpe-leave-retry');
    if(retry && state.chatKey) {
        const chatKey=state.chatKey,c=ctx();
        resetLeaveAttempt(c.chatMetadata.rpeLeaveRetries??={},retry.dataset.leaveKey);
        c.saveMetadata().then(()=>{if(state.chatKey===chatKey)return autoPeek();}).catch(error=>console.warn('[RP：幕后] 再试离场失败',error));
        render();return;
    }
    const way = event.target?.closest?.('.rpe-door-way');
    const cancel = event.target?.closest?.('.rpe-door-cancel');
    const knockAnswer = event.target?.closest?.('.rpe-knock-answer');
    if (knockAnswer && state.chatKey) { autoAnswer(knockAnswer.dataset.who, knockAnswer.dataset.answer).catch(() => {}); return; }
    if (way) {
        const w = way.dataset.way;
        const mode = w === '去找他' ? 'go' : w === '消息' || w === '电话' ? 'remote' : 'come';
        enterChar(way.dataset.who, way.dataset.avatar || null, { mode, ...(mode === 'remote' ? { way: w } : {}) }).then(refreshDoor).catch(() => {});
    } else if (cancel && state.chatKey) {
        api('arrival-request', { chatKey: state.chatKey, who: cancel.dataset.who, cancel: true }).then(refreshDoor).catch(() => {});
    }
}, true);
on('CHAT_CHANGED', () => { onChatChanged(); });
for (const event of ['PERSONA_CHANGED', 'SETTINGS_UPDATED']) on(event, () => { personaWatch.check(); void sendPersona().catch(() => {}); });
for (const name of ['MESSAGE_SENT', 'MESSAGE_RECEIVED', 'MESSAGE_EDITED', 'MESSAGE_DELETED', 'MESSAGE_SWIPED', 'MESSAGE_UPDATED', 'GROUP_UPDATED']) {
    on(name, (id) => { if (name === 'MESSAGE_EDITED' || name === 'MESSAGE_SWIPED') stripDoorMark(id).catch(() => {}); if (name === 'GROUP_UPDATED') watchMembers(); scheduleSync(); if (name !== 'MESSAGE_SENT') refreshDoor(); });
}
on('OAI_PRESET_CHANGED_AFTER', restoreCameraPrompts);
for (const name of ['GENERATION_ENDED', 'GENERATION_STOPPED']) on(name, clearPrompts);
// 旁白那一段写完了（N-292、D-169）：叙述用了"我"就提醒你重写；这一段递过"谁要露面"、末尾也点了他的名，就先在后台把他进场那份理好，再问你。
// 没点名：这次不问（后台下一段旁白再带一回，还没写到这个时段就不再递）。发消息、打电话来的人每说完一条，轻轻问一句要不要让他回去忙。
on('MESSAGE_RECEIVED', () => {
    const c = ctx(), last = c.chat?.at(-1);
    if (!last || last.is_user || !state.chatKey) return;
    const who = speakerOf(last, fallbackAvatar(c));
    // 叩门那条（autoKnock 叫他写的）：发消息、打电话来的带上记号，同屋别的有卡的人看不见；上门的不带
    const knock = auto.pending.get(who) ?? auto.remote?.get(who) ?? null;   // 叩门那条、远程的人之后写的每一条
    if (knock) {
        auto.pending.delete(who);
        if (knock.way !== '上门' && !last.extra?.rp_vis) { last.extra = { ...(last.extra ?? {}), rp_vis: { from: knock.who, way: knock.way } }; c.saveChat().catch(() => {}); }
    }
    const r = state.remote;
    if (r && r.chatKey === state.chatKey && who === r.avatar) {
        // 先问后台他是不是还在外头：两人当面碰上了（试玩 10/7：她走到他等着的那条街），就不再提醒、不再当远程
        syncNow(true).catch(() => {}).then(() => api('board', { chatKey: r.chatKey })).then(b => {
            const p = (b?.people ?? []).find(x => x.avatar === r.avatar || x.name === r.who);
            if (p && p.status !== 'remote') { if (state.remote === r) state.remote = null; return; }
            globalThis.toastr?.info(`${r.who}人还在外头，这是${r.how}。聊完了点这里让${r.who}回去忙（离场）。`, 'RP：幕后', { timeOut: 12000, onclick: () => { leaveChar(r.who).catch(() => {}); } });
        }).catch(() => {});
    }
    if (who !== 'narrator') return;
    if (narratorSaysI(last.mes)) {
        globalThis.toastr?.warning('旁白这段的叙述用了"我"，写成了某个人的口吻。点这里重写这一段（原来那段留在左边）。', 'RP：幕后', { timeOut: 20000, onclick: () => { $('#chat .last_mes .swipe_right').first().trigger('click'); } });
        return;
    }
    // 旁白留的记号（D-175）：不管点的是谁都先从消息里剥掉（同步是延后跑的，这里同步改掉，进后台的就是剥过的）；
    // 点的是门名单里的人才亮门、先把进场那份理好（点了个不在名单上的人，就当它没点）
    const mark = doorMark(last.mes);
    if (mark.who) {
        last.mes = mark.text;
        if (Array.isArray(last.swipes) && last.swipes[last.swipe_id ?? 0]) last.swipes[last.swipe_id ?? 0] = mark.text;
        c.updateMessageBlock(c.chat.length - 1, last);
        c.saveChat().catch(() => {});
    }
    // 手上的名单可能是上一次刷的（D 副本 10/7：玩家刚说完那句还没同步完旁白就写好了）：对不上就先刷一次再认
    const pick = list => mark.who ? list.find(x => namedIn(mark.who, [x.who]) || namedIn(x.who, [mark.who])) : list.find(x => namedIn(last.mes, [x.who]));
    const chatKey = state.chatKey;
    (async () => {
        let hit = pick(state.door?.items ?? []);
        if (!hit) { await syncNow(true).catch(() => {}); await refreshDoor(); hit = pick(state.door?.items ?? []); }
        if (!hit || chatKey !== state.chatKey) return;
        if (mark.who) {
            const mode = mark.way === '去找他' ? 'go' : mark.way === '消息' || mark.way === '电话' ? 'remote' : 'come';
            await api('door-lit', { chatKey, who: hit.who, way: mark.way ?? '', by: 'narrator' }).catch(() => {});
            // 自动进离场开着：记号只当"该叩门了"的免费信号（后台叩门时优先他），进场那份后台自己提前理
            if (auto.on===false) api('arrive', { chatKey, who: hit.who, avatar: hit.avatar, prepare: true, mode, way: mode === 'remote' ? mark.way : '' }, 240000).catch(() => {});
        } else await api('door-lit', { chatKey, who: hit.who, way: '', by: 'named' }).catch(() => {});
        await refreshDoor();
    })().catch(() => {});
});
// 这一次实际发出去多长（N-288）：字数现量，token 数用 ST 自己的算法（它就按这个砍聊天记录），算好了下一轮带给后台。
// 只量我们注入过的那次生成；不等它算完（不拖慢发送）。
on('CHAT_COMPLETION_PROMPT_READY', (e = {}) => {
    if (!e.dryRun && state.cameraGenerating) state.lastCameraPrompt = structuredClone(e.chat ?? []);
    if (e.dryRun || !state.measuring) return;
    state.measuring = false;
    const text = (e.chat ?? []).map(m => (typeof m?.content === 'string' ? m.content : Array.isArray(m?.content) ? m.content.map(x => x?.text ?? '').join('') : '')).join('\n');
    const last = { lastChars: text.length, lastOurs: state.oursChars ?? 0 };
    state.lastPrompt = last;
    const count = ctx().getTokenCountAsync;
    if (typeof count === 'function') Promise.resolve().then(() => count(text)).then(t => { if (state.lastPrompt === last && t > 0) last.lastTokens = t; }).catch(() => {});
});
// 一个人的时候（N-276）：群里的人都静音了、玩家这句没人接——旁白卡在这个群里就让它写周围的动静
// 有卡的人在场时（场记章程 #7、B4）：他们答完以后问后台一次，玩家这句是冲着没卡的人的，旁白接一手（cameraJoin）
on('GROUP_WRAPPER_FINISHED', (e = {}) => { setTimeout(() => autoDrive(e.type).then(r => { if (r === 'off') return cameraTurn(e.type); }).catch(() => {}), 50); });
async function cameraTurn(type, { force = false } = {}) {
    if (!settings().enabled || !state.chatKey || settings().camera === false) return false;
    if (type && type !== 'normal') return false;
    const c = ctx(), group = currentGroup(c), cam = cameraOf(c);
    if (!group || !cam || !group.members.includes(cam.avatar)) return false;
    // 手动叫过（/旁白、/进场）：这一句记成接过了，有卡的人答完不再自动接
    if (force) state.cameraJoinFor = cameraJoinPoint(c.chat, { speaker: m => speakerOf(m, fallbackAvatar(c)) })?.key ?? state.cameraJoinFor;
    if (!force && members(c).some(m => !m.disabled)) return cameraJoin(c, cam);
    if (!force && !c.chat?.at(-1)?.is_user) return false;
    // 同一句只叫一次：旁白没生成成（断网、被拒）时群聊收尾又会走到这里，别一直重叫
    const last = c.chat.at(-1), key = `${c.chat.length}:${fingerprintMessage(last, speakerOf(last, fallbackAvatar(c)))}`;
    if (!force && state.cameraFor === key) return false;
    state.cameraFor = key;
    await c.executeSlashCommandsWithOptions(`/trigger await=true ${group.members.indexOf(cam.avatar)}`);
    return true;
}
// 有卡的人在场、他们这一轮答完了：问后台这一句旁白要不要接（玩家点名了在场的没卡的人、或者接着跟上一条旁白里开口的人说话）。
// 同一句玩家的话只问一次；问的这会儿玩家又发了话、又在生成，就作罢。旁白卡在群里照旧静音（静音只是 ST 不自动轮它，/trigger 照样能说）。
async function cameraJoin(c, cam) {
    if (settings().cameraJoin === false) return false;
    const speaker = m => speakerOf(m, fallbackAvatar(c));
    const point = cameraJoinPoint(c.chat, { speaker, done: state.cameraJoinFor });
    if (!point) return false;
    state.cameraJoinFor = point.key;
    const chatKey = state.chatKey, length = c.chat.length;
    await syncNow(true).catch(() => {});
    const present = [c.name1, ...members(c).filter(m => !m.disabled).map(m => m.name)].filter(Boolean);
    let r = null;
    try { r = await api('camera-turn', { chatKey, recentUser: String(c.chat[point.at]?.mes ?? ''), present }); } catch { return false; }
    if (!r?.speak) return false;
    const now = ctx(), g = currentGroup(now);
    if (chatKey !== state.chatKey || now.is_group_generating || now.chat.length !== length || cameraJoinPoint(now.chat, { speaker })?.key !== point.key) return false;
    const at = g?.members.indexOf(cam.avatar) ?? -1;
    if (at < 0) return false;
    await now.executeSlashCommandsWithOptions(`/trigger await=true ${at}`);
    return true;
}
// 有卡的人进场、离场（N-292，用户 10/6）：静音只表示"这会儿不说话"；在不在场由进场、离场记（用你的上下文隔离扩展记在场区间，
// 后台跟着它算谁听见了什么）。进场：拉进群（在群里静音着就取消静音）→ 记从这一条起在场 → 后台替他理一次怎么来的、为什么来、
// 到场看见什么 → 让他先开口。
const hasCommand = name => !!ctx().SlashCommandParser?.commands?.[name];
const run = cmd => ctx().executeSlashCommandsWithOptions(cmd).catch(() => null);
function cardNamed(c, who, avatar = null) {
    return c.characters.find(x => avatar && x.avatar === avatar) ?? c.characters.find(x => x.name === who) ?? null;
}
async function enterChar(who, avatar = null, opts = {}) {
    const c = ctx(), group = currentGroup(c);
    if (!group) { globalThis.toastr?.warning('进场只在群聊里用。', 'RP：幕后'); return false; }
    const ch = cardNamed(c, who, avatar);
    if (!ch) { globalThis.toastr?.warning(`找不到「${who}」的卡。`, 'RP：幕后'); return false; }
    // 这是扩展自己拉进群的：群名单变了别当成玩家手动拉人（watchMembers），进场就走这一遍
    state.entering.add(ch.avatar);
    try {
        if (!group.members.includes(ch.avatar)) await run(`/member-add ${ch.avatar}`);
        let g = currentGroup(ctx()), at = g?.members.indexOf(ch.avatar) ?? -1;
        if (at < 0) { globalThis.toastr?.warning(`没能把${ch.name}加进群。`, 'RP：幕后'); return false; }
        if (g.disabled_members?.includes(ch.avatar)) await run(`/member-enable ${at}`);
        // 从这一条起在场：之前这里说的话他没听见（没装上下文隔离扩展时，后台只能当他一直在）
        if (hasCommand('isolate')) await run(`/isolate ${ch.name}`);
        await syncNow(true).catch(() => {});
        globalThis.toastr?.info(`${ch.name}进场中……`, 'RP：幕后', { timeOut: 6000 });
        await arriveNow(ch, opts);
        g = currentGroup(ctx()); at = g?.members.indexOf(ch.avatar) ?? -1;
        if (at >= 0) await run(`/trigger await=true ${at}`);
        return true;
    } finally {
        state.entering.delete(ch.avatar);
        // 名单基线跟上（群名单变了没发事件时，下一次比的时候别把他当成新拉进来的）
        const snap = memberSnapshot();
        if (snap && state.memberBase?.key === snap.key) state.memberBase = snap;
    }
}
// 后台替他理一次怎么来的、为什么来（main.arrive）；发消息、打电话来的记成远程
async function arriveNow(ch, opts = {}) {
    let got = null;
    try { got = await api('arrive', { chatKey: state.chatKey, who: ch.name, avatar: ch.avatar, mode: opts.mode ?? 'come', ...(opts.way ? { way: opts.way } : {}) }, 240000); } catch { /* 理不出来照样进场 */ }
    state.remote = /电话|消息/.test(got?.how ?? '') ? { who: ch.name, avatar: ch.avatar, how: /电话/.test(got.how) ? '打电话' : '发消息', chatKey: state.chatKey } : null;
    return got;
}
// 玩家在群面板里直接把卡移出群（不是静音）：区间没关，后台会一直当他在场。和上一次看到的名单比，少了的有卡的人当作离场。
// 页面刚打开、切换聊天时只记名单，不触发；静音不算（名单没变）。
function memberSnapshot() {
    const group = currentGroup(ctx());
    return group ? { key: `${group.id}|${group.chat_id ?? ''}`, members: [...(group.members ?? [])] } : null;
}
function watchMembers() {
    const c = ctx(), base = state.memberBase, snap = memberSnapshot();
    state.memberBase = snap;
    if (!settings().enabled || !base || !snap || base.key !== snap.key) return;
    const now = snap.members;
    for (const avatar of removedMembers(base.members, now, { camera: cameraOf(c)?.avatar ?? null })) {
        const ch = (c.characters ?? []).find(x => x.avatar === avatar);
        if (!ch || isCamera(ch)) continue;
        (async () => {
            if (hasCommand('isolate-leave')) await run(`/isolate-leave ${ch.name}`);
            if (state.remote?.avatar === avatar) state.remote = null;
            api('leave', { chatKey: state.chatKey, who: ch.name, avatar }, 240000).catch(() => {});
            globalThis.toastr?.info(`${ch.name}被移出了群，已按离场处理：从这条起${ch.name}不在场。`, 'RP：幕后', { timeOut: 8000 });
        })().catch(() => {});
    }
    // 玩家在群面板里直接把卡拉进群（场记章程 B1）：和点门一样走进场——从这条起在场、后台替他理怎么来的（门上有他那一项就按那项的方式）。
    // 扩展自己拉进来的（enterChar）不算；不自动让他开口，玩家自己点谁说话
    for (const avatar of addedMembers(base.members, now, { camera: cameraOf(c)?.avatar ?? null, skip: [...state.entering] })) {
        const ch = (c.characters ?? []).find(x => x.avatar === avatar);
        if (!ch || isCamera(ch)) continue;
        // 拉进来就静音着的（用户 10/16：全员常驻群，静音＝此刻不在场）：只是放进群，不算进场；取消静音、点门、叩门时才进
        if (currentGroup(c)?.disabled_members?.includes(avatar)) continue;
        // 门上他那一项先拿着：进场以后他就不在门上了
        const doorItem = (state.door?.items ?? []).find(i => i.avatar === avatar || i.who === ch.name) ?? null;
        state.entering.add(avatar);
        (async () => {
            try {
                if (hasCommand('isolate')) await run(`/isolate ${ch.name}`);
                await syncNow(true).catch(() => {});
                let item = doorItem;
                if (!item) { await refreshDoor().catch(() => {}); item = (state.door?.items ?? []).find(i => i.avatar === avatar || i.who === ch.name) ?? null; }
                const opts = arriveOpts(item);
                globalThis.toastr?.info(`${ch.name}被拉进了群，已按进场处理：从这条起${ch.name}在场，之前的事${ch.name}没听见${opts.mode === 'remote' ? `（${ch.name}是${opts.way === '电话' ? '打电话' : '发消息'}来的）` : ''}。要${ch.name}说话就点${ch.name}。`, 'RP：幕后', { timeOut: 8000 });
                await arriveNow(ch, opts);
            } finally {
                state.entering.delete(avatar);
                refreshDoor().catch(() => {});
            }
        })().catch(() => {});
    }
}
async function leaveChar(who) {
    const c = ctx(), group = currentGroup(c);
    const ch = cardNamed(c, who);
    if (!group || !ch || !group.members.includes(ch.avatar)) { globalThis.toastr?.warning(`群里没有「${who}」。`, 'RP：幕后'); return false; }
    if (hasCommand('isolate-leave')) await run(`/isolate-leave ${ch.name}`);
    else globalThis.toastr?.warning(`没装上下文隔离扩展：${ch.name}离场以后的事，后台还会当${ch.name}听见了。`, 'RP：幕后', { timeOut: 8000 });
    const at = group.members.indexOf(ch.avatar);
    if (!group.disabled_members?.includes(ch.avatar)) await run(`/member-disable ${at}`);
    await syncNow(true).catch(() => {});
    if (state.remote?.avatar === ch.avatar) state.remote = null;
    // 他走前说了去哪、办什么：后台记下去向，回来的时机照它（D-169；在后台跑，不等）
    api('leave', { chatKey: state.chatKey, who: ch.name, avatar: ch.avatar }, 240000).catch(() => {});
    globalThis.toastr?.success(`${ch.name}离场了：从这条起${ch.name}不在场，之后的事${ch.name}不知道。${ch.name}办完手上的事，旁白会带${ch.name}回来；要${ch.name}现在来：/进场 ${ch.name}`, 'RP：幕后', { timeOut: 8000 });
    return true;
}
// 镜头写完了：问让不让他进场
async function setUpCamera() {
    const c = ctx(), group = currentGroup(c);
    if (!group) { globalThis.toastr?.warning('旁白只在群聊里用：一个人的时候把群里的人都静音就行。'); return; }
    let cam = cameraOf(c);
    const steps = [cam ? null : '在你的角色列表里新建一张卡「旁白」（自带镜头主提示词和后历史指令；卡里带一个标记，系统认得它是镜头）', `把它加进这个群「${escapeHtml(group.name ?? '')}」，并且静音`].filter(Boolean);
    const ok = await c.callGenericPopup(`<h3>一个人时的旁白</h3><p>要做的：</p><ul>${steps.map(x => `<li>${x}</li>`).join('')}</ul><p><small>以后你一个人的时候（群里的人都离场或静音了），你说完一句没人接，旁白就写周围：天气、这地方的样子、近处远处的动静，和没有卡的人——路人、店里的人、来搭话的生人，可以一来一回接着演。有卡的人在场时，你这句是冲着没卡的人说的，有卡的人答完旁白也接一手（"这一局"那块里能关）。有卡的角色由各自的卡说话；要角色来，旁白只写到角色出现（门被推开、终端响了），然后按名字问你让不让进场。它不替你说话、不替你拿主意；后台不把它当人，不记它的账、不排它的关系。随时可以用 /旁白 叫它写一段；/离场 名字、/进场 名字 让有卡的人走、来。删卡或者移出群就不用了。</small></p>`, c.POPUP_TYPE.CONFIRM, '', { okButton: '好', cancelButton: '算了' });
    if (!ok) return;
    if (!cam) {
        const prompt = await api('camera-card', {});
        const fd = new FormData();
        for (const [k, v] of Object.entries({ system_prompt: prompt.system, post_history_instructions: prompt.phi, ch_name: '旁白', description: '', personality: '', scenario: '', first_mes: '', mes_example: '', tags: '', fav: 'false',
            creator_notes: 'RP：幕后建的镜头：玩家一个人的时候写周围的动静。后台不把它当人。', extensions: JSON.stringify({ [CAMERA_FLAG]: true }) })) fd.append(k, v);
        const headers = { ...c.getRequestHeaders() };
        delete headers['Content-Type'];
        const r = await fetch('/api/characters/create', { method: 'POST', headers, body: fd });
        if (!r.ok) { globalThis.toastr?.error(`建卡没成（${r.status}）`, 'RP：幕后'); return; }
        await c.getCharacters();
        cam = cameraOf(ctx());
        if (!cam) { globalThis.toastr?.error('卡建好了但没认出来，刷新一下页面再点一次。', 'RP：幕后'); return; }
    }
    if (!group.members.includes(cam.avatar)) await c.executeSlashCommandsWithOptions(`/member-add ${cam.avatar}`);
    const now = currentGroup(ctx());
    const at = now?.members.indexOf(cam.avatar) ?? -1;
    if (at >= 0 && !now.disabled_members?.includes(cam.avatar)) await c.executeSlashCommandsWithOptions(`/member-disable ${at}`);
    // 旁白是你的眼睛，看得见你看得见的全部：上下文隔离扩展别因为它刚加进群就只给它加进来以后的那几条（N-292，D 副本实测）
    // 光清掉不够：它头一回开口时隔离扩展会照"名册里新来的"再记一次进场——直接记成从第 0 条起就在
    if (hasCommand('isolate-clear')) await run(`/isolate-clear ${cam.name}`);
    if (hasCommand('isolate')) await run(`/isolate ${cam.name} 0`);
    globalThis.toastr?.success('旁白在这个群里了（静音）。你一个人的时候它会接；想让它现在写一段，用 /旁白。', 'RP：幕后');
    render();
}
// 消息重新画过（新消息、往上翻加载更多、改稿）：日历按钮补上，标签按手上的重画
for (const name of ['CHARACTER_MESSAGE_RENDERED', 'USER_MESSAGE_RENDERED', 'MORE_MESSAGES_LOADED', 'CHAT_CHANGED']) on(name, () => setTimeout(() => { addDayButtons(); drawDays(); }, 0));

// 打字时预跑（D-100：前台速度）：停下来 2.5 秒，把草稿递给后台先配词、替在场的人组装；发出去的和草稿一样，轮到谁开口时就不用等。
// 斜杠命令不算；后台一轮至多预跑两份草稿。
let draftTimer = null;
function watchDraft() {
    const box = document.querySelector('#send_textarea');
    if (!box || box.dataset.rpDraft) return;
    box.dataset.rpDraft = '1';
    box.addEventListener('input', () => {
        clearTimeout(draftTimer);
        draftTimer = setTimeout(() => {
            if (!settings().enabled || !state.chatKey) return;
            const draft = box.value.trim();
            if (!draft || draft.startsWith('/')) return;
            const c = ctx();
            const recent = [...(c.chat ?? []).slice(-2).map(m => String(m.mes ?? '')), draft];
            const present = [c.name1, ...members(c).filter(m => !m.disabled).map(m => m.name)].filter(Boolean);
            api('prefetch', { chatKey: state.chatKey, draft, recent, present }, 5000).catch(() => {});
        }, 2500);
    });
}
// 去复读（core/fresh.mjs，质量窗 Q-4）：角色这条生成完，后台把和他前几条重样的说法换成新的；换了就改进这条消息，
// 原文留在 extra.rp_fresh（可以撤回）。上文里攒不起复读，前台下一轮就少了照抄的样子。后台没开就原样返回，这里什么也不做。
async function freshen(id, type) {
    const c = ctx();
    const m = c.chat?.[id];
    if (!settings().enabled || !state.chatKey || !m || m.is_user || m.is_system || ['first_message', 'impersonate', 'quiet'].includes(type)) return;
    const text = m.mes;
    let r;
    // before：这条前面那条。左滑重来、"继续"时后台库里这一格还是上一版，只拿 before 为止的来比
    const before = id > 0 ? String(c.chat[id - 1]?.mes ?? '') : null;
    try { r = await api('fresh', { chatKey: state.chatKey, speaker: speakerOf(m, fallbackAvatar(c)), text, before, lore: Array.isArray(m.extra?.rp_lore) ? m.extra.rp_lore : null }, 230000); } catch { return; }
    const now = ctx();
    if (!r?.changes?.length || now.chat?.[id] !== m || m.mes !== text) return;   // 这期间换了窗口、改了稿、左滑了：不动
    m.extra = { ...(m.extra ?? {}), rp_fresh: { original: text, changes: r.changes } };
    m.mes = r.text;
    if (Array.isArray(m.swipes) && m.swipes[m.swipe_id ?? 0] === text) m.swipes[m.swipe_id ?? 0] = r.text;
    now.updateMessageBlock(id, m);
    await now.saveChat();
    scheduleSync();
    markFreshButtons();
    // 和前文、设定对不上的硬事实改过来了（N-279）：说一声改了什么，原文留着能撤回
    const fixes = r.changes.filter(x => x.fix);
    if (fixes.length) globalThis.toastr?.info(`这条有 ${fixes.length} 处和写过的对不上，按写过的改了：${fixes.map(x => `「${escapeHtml(String(x.from).replace(/<#[0-9.]+#>/g, "").slice(0, 24))}」→「${escapeHtml(String(x.to).slice(0, 24))}」${x.why ? `（${escapeHtml(x.why)}）` : ''}`).join('；')}。想撤回：点这条消息"…"菜单里的撤回按钮。`, 'RP：幕后', { timeOut: 12000, escapeHtml: false });
}
// 这一轮酒馆真触发了哪几条世界书（质量窗 10/2）：记在接下来那条回复上（extra.rp_lore，跟着聊天文件走），同步时交给后台；
// 记账时这几条给全文（以前靠字面挑，会漏会撞）。条目正文也交给后台认得——没开"按开口的人筛"时只认、不花钱判谁知道。
// 别的扩展在后台悄悄生成（quiet）时触发的不算。换一套卡、书、预设也一样：这是酒馆自己的事件，不认书名、不认条目写法。
on('GENERATION_STARTED', async type => { state.genType = type ?? 'normal'; state.genAt = performance.now(); await sendPersona(); });
on('WORLD_INFO_ACTIVATED', entries => {
    if (!settings().enabled || !state.chatKey || !Array.isArray(entries) || state.genType === 'quiet') return;
    const list = entries.filter(e => e && e.uid != null).slice(0, 60).map(e => ({ key: `${e.world ?? ''}|${e.uid}`, hash: loreHash(e.content), world: e.world ?? '',
        title: e.comment || (Array.isArray(e.key) ? e.key.join('、') : ''), text: String(e.content ?? '') }));
    state.fired = { keys: list.map(e => e.key), at: Date.now(), chatKey: state.chatKey };
    if (list.length) api('lore', { chatKey: state.chatKey, entries: list, judge: !!settings().loreFilter }).catch(() => {});
});
on('MESSAGE_RECEIVED', (id, type) => {
    const f = state.fired, m = ctx().chat?.[id];
    state.fired = null;
    if (!f || !m || m.is_user || f.chatKey !== state.chatKey || Date.now() - f.at > 10 * 60000 || ['quiet', 'impersonate'].includes(type)) return;
    m.extra = { ...(m.extra ?? {}), rp_lore: f.keys };
});
on('MESSAGE_RECEIVED', (id, type) => { if (state.genAt) { tick('生成', performance.now() - state.genAt, ctx().chat?.[id]?.name ?? ''); state.genAt = null; } freshen(id, type).catch(() => {}); });

// ---------- ST 的世界书按开口的人筛（§5.4、N-252） ----------
// 后台判过"谁知道"的条目（core/lore.mjs），开口的人不在名单里就从这一轮拿掉；没判过的照给，顺手交给后台判（几分钱一批）。
// 只拿掉、不加：ST 自己的角色过滤照旧先生效。面板"这一局 → 世界书谁知道"能看、能改。
let loreTimer = null;
const loreQueue = new Map();
async function refreshLore(entries = null) {
    if (!settings().enabled || !state.chatKey) return;
    const chatKey = state.chatKey;
    try {
        const r = await api('lore', entries ? { chatKey, entries } : { chatKey });
        if (chatKey === state.chatKey) state.lore = r;
    } catch {}
}
function queueLore(unknown) {
    for (const e of unknown) loreQueue.set(e.key, e);
    clearTimeout(loreTimer);
    loreTimer = setTimeout(() => { const list = [...loreQueue.values()]; loreQueue.clear(); refreshLore(list); }, 3000);
}
on('WORLDINFO_ENTRIES_LOADED', data => {
    if (!settings().enabled || !state.chatKey || !settings().loreFilter || !data) return;
    const c = ctx();
    const me = c.characters?.[c.characterId]?.name ?? '';
    const { unknown, removed } = filterLore([data.globalLore, data.characterLore, data.chatLore, data.personaLore], state.lore?.verdicts ?? {}, me);
    if (unknown.length) queueLore(unknown);
    if (removed) console.debug(`[rp_emergence] 世界书：${me} 不知道的 ${removed} 条这一轮没给`);
});
async function openLore() {
    const c = ctx();
    await refreshLore();
    const rows = state.lore?.rows ?? [];
    if (!rows.length) { globalThis.toastr?.info('后台还没见过这一局的世界书条目（开口生成一次就会收到）。'); return; }
    const line = r => `- 〔${r.world}〕${r.title || r.key} ｜ ${r.verdict ? (r.verdict.all !== false ? '所有人' : r.verdict.who.join('、')) : '所有人'} ｜ ${r.source === 'user' ? '你定的' : r.source === 'model' ? '判的' : '还没判'}`;
    const note = `后台自动判每条世界书谁该知道（要打开“世界书按开口的人筛”）；判错了在这里改。一般不用动。每条：书 · 条目 ｜ 谁知道（所有人，或者名字用、隔开） ｜ 是判的还是你定的。开口的人不在名单里，这一条这一轮就不给他。改了第二段点"保存"，你改的算数。${state.lore?.pending ? `还有 ${state.lore.pending} 条在等判。` : ''}`;
    const { result, text } = await textPopup('世界书谁知道', note, rows.map(line).join('\n'), { ok: '保存', cancel: '关闭' });
    if (result !== c.POPUP_RESULT.AFFIRMATIVE) return;
    const set = [];
    for (const m of text.split(/\r?\n/).map(l => l.match(/^\s*-\s*〔([^〕]*)〕(.*?)\s*｜\s*([^｜]*?)\s*(?:｜.*)?$/)).filter(Boolean)) {
        const r = rows.find(x => x.world === m[1] && (x.title || x.key) === m[2].trim());
        if (!r) continue;
        const names = m[3].split(/[、,，/]/).map(s => s.trim()).filter(Boolean);
        const all = !names.length || names.includes('所有人');
        const before = r.verdict && r.verdict.all === false ? r.verdict.who.join('、') : '所有人';
        if ((all ? '所有人' : names.join('、')) !== before) set.push({ key: r.key, all, who: all ? [] : names });
    }
    if (!set.length) return;
    try { state.lore = await api('lore', { chatKey: state.chatKey, set }); globalThis.toastr?.success(`改了 ${set.length} 条。`); }
    catch { globalThis.toastr?.warning('后台暂时连不上。'); }
}

// ---------- 剧情日期（N-265，白皮书 §5.6） ----------
// 消息名字旁边一个小标签：开场、跨天的那条写"第几天 · 几月几号 星期几 · 时段"，时段变了只写时段，拿不准的写"？"。只是界面装饰，不改正文。
// 消息"…"菜单里一个日历按钮（点标签也一样）：从这条起算新的一天／这里没有跨天。点的存在这条消息的 extra.rp_day 里，
// 跟着聊天文件走（备份、分支都带着），同步时交给后台，盖过系统自己认的。
let dayLabels = [], daySince = '', dayScale = null;   // dayScale：这一局的时间尺度（后台给的 { unit, word, ord, parts }）
let boardLabels = [];
const DAY_BUTTON = '<div title="剧情日期：改这条是第几天、什么时段" class="mes_button rpe_day fa-solid fa-calendar-day"></div>';
function addDayButtons() {
    const tpl = document.querySelector('#message_template .extraMesButtons');
    if (tpl && !tpl.querySelector('.rpe_day')) tpl.insertAdjacentHTML('afterbegin', DAY_BUTTON);
    if (tpl && !tpl.querySelector('.rpe_fresh')) tpl.insertAdjacentHTML('afterbegin', FRESH_BUTTON);
    for (const box of document.querySelectorAll('#chat .mes .extraMesButtons')) {
        if (!box.querySelector('.rpe_day')) box.insertAdjacentHTML('afterbegin', DAY_BUTTON);
        if (!box.querySelector('.rpe_fresh')) box.insertAdjacentHTML('afterbegin', FRESH_BUTTON);
    }
    markFreshButtons();
}

// ---------- 后台改过的消息：看改了哪几处、撤回（用户 10/3：弹窗说"能撤回"，面板上却没地方撤） ----------
// 消息"…"菜单里一个按钮，只在后台改过的消息上出现（去复读、核对硬事实，原文在 extra.rp_fresh）。
// 一处处勾着撤，或者整条还原成原文。撤完同步给后台，后台按改稿重记这条。
const FRESH_BUTTON = '<div title="后台改过这条：看改了哪几处、撤回" class="mes_button rpe_fresh fa-solid fa-clock-rotate-left" style="display:none"></div>';
function markFreshButtons() {
    const c = ctx();
    for (const el of document.querySelectorAll('#chat .mes .rpe_fresh')) {
        const id = Number(el.closest('.mes')?.getAttribute('mesid'));
        el.style.display = c.chat?.[id]?.extra?.rp_fresh ? '' : 'none';
    }
}
// 在正文里找一段（老记录里存的是不带停顿标记的新句子，正文里标记夹在中间）：返回起止，找不到 null
function findLoose(text, s) {
    const t = String(text), want = String(s ?? '');
    if (!want) return null;
    const k = t.indexOf(want);
    if (k >= 0) return { start: k, end: k + want.length };
    const esc = c => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const gap = '(?:\\s*<#[0-9.]+#>)*\\s*';
    const chars = [...want.replace(/<#[0-9.]+#>/g, '').replace(/\s+/g, '')];
    if (!chars.length) return null;
    const m = new RegExp(chars.map(esc).join(gap)).exec(t);
    return m ? { start: m.index, end: m.index + m[0].length } : null;
}
function freshWhere(text, x) {
    if (x.to) return findLoose(text, x.put ?? x.to) ?? (x.put ? findLoose(text, x.to) : null);
    if (typeof x.before !== 'string') return null;   // 老记录里删掉的那句不知道在哪：只能整条还原
    const k = String(text).indexOf(x.before);
    return k >= 0 && !String(text).includes(x.from) ? { start: k + x.before.length, end: k + x.before.length } : null;
}
async function undoFresh(id) {
    const c = ctx();
    const m = c.chat?.[id];
    const f = m?.extra?.rp_fresh;
    if (!m || !f) { globalThis.toastr?.info('这条后台没改过。'); return; }
    const plain = s => escapeHtml(String(s ?? '').replace(/<#[0-9.]+#>/g, '').trim());
    const rows = (f.changes ?? []).map((x, i) => {
        const live = !!freshWhere(m.mes, x);
        const kind = x.fix ? `改事实${x.why ? `（${escapeHtml(x.why)}）` : ''}` : x.to ? '换了说法' : '删掉了';
        return `<label style="display:flex;gap:.5em;align-items:flex-start;text-align:left;margin:.4em 0;${live ? '' : 'opacity:.5'}">
            <input type="checkbox" data-i="${i}" ${live ? '' : 'disabled'} style="margin-top:.3em">
            <span><small>${kind}${live ? '' : ' · 正文里已经找不到了'}</small><br>原来：${plain(x.from)}<br>${x.to ? `现在：${plain(x.to)}` : ''}</span></label>`;
    }).join('');
    let picked = [];
    const result = await c.callGenericPopup(`<h3>后台改过这条</h3><p><small>勾上想撤回的，或者整条还原成原文。撤完后台会按改稿重记这条。</small></p>${rows || '<p>没有记下改了哪几处。</p>'}`, c.POPUP_TYPE.TEXT, '', {
        okButton: false, cancelButton: '关闭', wide: true, allowVerticalScrolling: true,
        customButtons: [{ text: '撤回勾选的', result: c.POPUP_RESULT.CUSTOM1 }, { text: '整条还原成原文', result: c.POPUP_RESULT.CUSTOM2 }],
        onClosing: popup => { picked = [...popup.dlg.querySelectorAll('input[data-i]:checked')].map(el => Number(el.dataset.i)); return true; },
    });
    if (result !== c.POPUP_RESULT.CUSTOM1 && result !== c.POPUP_RESULT.CUSTOM2) return;
    if (ctx().chat?.[id] !== m || m.extra?.rp_fresh !== f) return;
    let text = m.mes, left = [];
    if (result === c.POPUP_RESULT.CUSTOM2) text = f.original;
    else {
        if (!picked.length) { globalThis.toastr?.info('没勾哪一处。'); return; }
        // 从后往前撤：后改的先撤，前面记的位置不受影响
        for (const [i, x] of [...(f.changes ?? []).entries()].reverse()) {
            const at = picked.includes(i) ? freshWhere(text, x) : null;
            if (!at) { left.unshift(x); continue; }
            text = `${text.slice(0, at.start)}${x.from}${text.slice(at.end)}`;
        }
    }
    const old = m.mes;
    m.mes = text;
    if (Array.isArray(m.swipes) && m.swipes[m.swipe_id ?? 0] === old) m.swipes[m.swipe_id ?? 0] = text;
    const extra = { ...(m.extra ?? {}) };
    if (left.length) extra.rp_fresh = { ...f, changes: left }; else delete extra.rp_fresh;
    m.extra = extra;
    ctx().updateMessageBlock(id, m);
    await ctx().saveChat();
    scheduleSync();
    markFreshButtons();
    globalThis.toastr?.success(result === c.POPUP_RESULT.CUSTOM2 ? '还原成原文了。' : `撤回了 ${(f.changes ?? []).length - left.length} 处。`);
}
document.addEventListener('click', event => {
    const el = event.target?.closest?.('.rpe_fresh');
    const id = Number(el?.closest('.mes')?.getAttribute('mesid'));
    if (!el || !Number.isInteger(id)) return;
    event.stopPropagation();
    undoFresh(id).catch(() => {});
}, true);
async function refreshDays() {
    if (!settings().enabled || !state.chatKey) { dayLabels = []; boardLabels = []; drawDays(); drawBoards(); return; }
    const chatKey = state.chatKey;
    try { const r = await api('timeline', { chatKey }); if (chatKey === state.chatKey) { dayLabels = r.labels ?? []; daySince = r.since ?? ''; dayScale = r.scale ?? null; } } catch { return; }
    try { const r = await api('boards', { chatKey }); if (chatKey === state.chatKey) boardLabels = r.boards ?? []; } catch { boardLabels = []; }
    try { const r = await api('cast', { chatKey }); if (chatKey === state.chatKey) state.boardCast = r.cast ?? []; } catch { state.boardCast = []; }
    drawDays();
    drawBoards();
}
function drawDays() {
    for (const el of document.querySelectorAll('#chat .rpe_daylabel')) el.remove();
    const c = ctx();
    for (const l of dayLabels) {
        const m = c.chat?.[l.pos];
        const at = document.querySelector(`#chat .mes[mesid="${l.pos}"] .timestamp`);
        if (!m || !at || fingerprintMessage(m, speakerOf(m, fallbackAvatar(c))) !== l.fp) continue;   // 还没同步过去的、对不上的不标
        const tag = document.createElement('small');
        tag.className = 'rpe_daylabel';
        tag.textContent = `${l.label}${l.mark ? ' ✎' : ''}`;
        tag.title = [l.unsure ? `拿不准：${l.unsure}` : '', l.full && l.full !== l.label ? l.full : '', l.mark ? '你点过这条' : '', '点一下改'].filter(Boolean).join('\n');
        tag.style.cssText = `margin-left:.6em;opacity:${l.kind === 'plain' ? '.5' : '.85'};cursor:pointer;white-space:nowrap;${l.unsure ? 'color:var(--warning,orange);font-weight:bold' : l.kind === 'day' ? 'font-weight:bold' : ''}`;
        at.after(tag);
    }
}
function drawBoards() {
    for (const el of document.querySelectorAll('#chat .rpe_boardlabel')) el.remove();
    const c = ctx();
    // 面板"这一局"里的一行：最新那条的场面
    const row = document.querySelector('[data-role="board-row"]');
    if (row) {
        row.innerHTML = sceneCardHtml(boardLabels.at(-1), state.boardCast ?? [], dayLabels.at(-1));
    }
    for (const l of boardLabels) {
        const m = c.chat?.[l.pos];
        const at = document.querySelector(`#chat .mes[mesid="${l.pos}"] .timestamp`);
        if (!m || !at || fingerprintMessage(m, speakerOf(m, fallbackAvatar(c))) !== l.fp) continue;
        const tag = document.createElement('small');
        tag.className = 'rpe_boardlabel';
        tag.textContent = boardLabelText(l, !!m.extra?.rp_board);
        tag.title = '后台以为这一刻镜头在哪、谁在场；错了点这里改，你定的算数';
        tag.style.cssText = 'margin-left:.6em;opacity:.85;white-space:nowrap;';
        at.after(tag);
    }
}
// 纠正这一条上的场面（第 1 步丙，用户 10/6："错了你看得见、点一下就对"）：镜头在哪、谁在不在。存在这条消息的 extra.rp_board 里
// （{ place, people: { 名字: 在场|远程|外头|不在 } }），跟着聊天文件走，同步时交给后台，排在所有来源前面；之后的移动、进场离场再接管。
const BOARD_STATES = [['在场', '在场'], ['远程', '远程（发消息、打电话来）'], ['不在', '不在']];
function boardRosterNames(cast, characters = []) {
    return [...new Set(cast.filter(e => e?.name && e.role !== '不用' && e.name !== '旁白' && e.avatar !== 'narrator' && !characters.some(ch => ch.avatar === e.avatar && isCamera(ch))).map(e => e.name))];
}
async function pickBoard(id) {
    const c = ctx(), m = c.chat?.[id];
    if (!m) return;
    if (!state.chatKey || !settings().enabled) { globalThis.toastr?.warning('这个窗口还没接入 RP：幕后。'); return; }
    const current = m.extra?.rp_board ?? {};
    const l = boardLabels.find(x => x.pos === id);
    const known = [...new Set(boardLabels.map(x => x.place).filter(Boolean))].slice(-6);
    const chatKey = state.chatKey;
    const { cast } = await api('cast', { chatKey });
    if (state.chatKey !== chatKey || ctx().chat?.[id] !== m) return;
    const cards = boardRosterNames(cast, c.characters ?? []);
    const now = name => l?.people?.find(p => p.name === name)?.status ?? null;
    const nowWord = s => ({ present: '在场', remote: '远程', away: '不在眼前', absent: '不在', never: '没来过' })[s] ?? '？';
    const row = name => `<tr><td style="padding:.1em .6em .1em 0">${escapeHtml(name)} <small>（系统认的：${nowWord(now(name))}）</small></td><td>` +
        `<label><input type="radio" name="rpe-bp-${escapeHtml(name)}" value=""${current.people?.[name] == null || current.people?.[name] === '外头' ? ' checked' : ''}> 不改</label> ` +
        BOARD_STATES.map(([v, t]) => `<label style="margin-left:.5em"><input type="radio" name="rpe-bp-${escapeHtml(name)}" value="${v}"${current.people?.[name] === v ? ' checked' : ''}> ${t}</label>`).join('') + '</td></tr>';
    const html = `<h3>场面纠正</h3><p>系统现在认的：镜头在 ${escapeHtml(l?.place ?? '？')}${l?.home ? `（${escapeHtml(l.home)}的家）` : ''}</p>
        <div style="text-align:left">
          <b>镜头在哪</b>（留空＝不纠正）<br><input class="text_pole" data-role="rpe-board-place" value="${escapeHtml(current.place ?? '')}" placeholder="比如：楼下便利店、他的公寓">
          ${known.length ? `<div style="margin:.3em 0"><small>认得的地方：</small>${known.map(p => `<button type="button" class="menu_button" data-role="rpe-board-pick" style="margin:.1em .2em;padding:.1em .5em" title="选择已知地点，建议核对实际场面。">${escapeHtml(p)}</button>`).join('')}</div>` : ''}
          <b>谁在不在</b><table style="margin-top:.3em">${cards.map(row).join('')}</table>
        </div>
        <button type="button" class="menu_button" data-role="rpe-board-reset" title="撤销本条纠正，建议确认识别无误再用。">清除此条场面纠正</button>
        <p><small>你定的算数，排在后台自己认的前面；从这条往后，直到之后又有人走了、来了、换了地方。存在这条消息里，跟着聊天文件走，也同步给后台。</small></p>`;
    let picked = null, clear = false;
    const ok = await c.callGenericPopup(html, c.POPUP_TYPE.CONFIRM, '', {
        okButton: '保存', cancelButton: '关闭',
        onOpen: popup => { popup.dlg.addEventListener('click', e => {
            const b = e.target?.closest?.('[data-role="rpe-board-pick"]');
            if (b) { const i = popup.dlg.querySelector('[data-role="rpe-board-place"]'); if (i) i.value = b.textContent; }
            if (e.target?.closest?.('[data-role="rpe-board-reset"]')) { clear = true; popup.dlg.querySelector('[data-role="rpe-board-place"]').value = ''; for (const radio of popup.dlg.querySelectorAll('input[type="radio"]')) radio.checked = false; }
        }); },
        onClosing: popup => {
            const dlg = popup.dlg;
            const selected = {};
            for (const name of cards) { const v = dlg.querySelector(`input[name="rpe-bp-${CSS.escape(name)}"]:checked`)?.value; if (v !== undefined) selected[name] = v; }
            const people = boardPeopleAfterEdit(current.people, selected, clear);
            picked = { place: dlg.querySelector('[data-role="rpe-board-place"]')?.value?.trim() ?? '', people };
            return true;
        },
    });
    if (!ok || !picked || ctx().chat?.[id] !== m) return;
    const extra = { ...(m.extra ?? {}) };
    const mark = { ...(picked.place ? { place: picked.place } : {}), ...(Object.keys(picked.people).length ? { people: picked.people } : {}) };
    if (Object.keys(mark).length) extra.rp_board = mark; else delete extra.rp_board;
    m.extra = extra;
    ctx().updateMessageBlock(id, m);
    await ctx().saveChat();
    await syncNow();
    refreshDays();
    globalThis.toastr?.success(Object.keys(mark).length ? '改好了，从这条往后照它算。' : '这条跟着系统认的了。', 'RP：幕后');
}
document.addEventListener('click', event => {
    const el = event.target?.closest?.('.rpe_boardlabel');
    const id = Number(el?.closest('.mes')?.getAttribute('mesid'));
    if (!el || !Number.isInteger(id)) return;
    event.stopPropagation();
    pickBoard(id).catch(() => {});
}, true);
const DAY_PARTS = ['早上', '上午', '中午', '下午', '傍晚', '晚上', '深夜', '凌晨'];
// 改这一条的剧情日期（10/3 用户：每条都显示、能手动改、改了同步到后台）：天（从这条起算新的一天／这里没有跨天／这条是第几天）和时段分开选，
// 存在这条消息的 extra.rp_day 里（"天@时段"，比如 "d:5@下午"、"@晚上"），跟着聊天文件走，同步时交给后台，盖过系统自己认的。
async function pickDay(id) {
    const c = ctx();
    const m = c.chat?.[id];
    if (!m) return;
    if (!state.chatKey || !settings().enabled) { globalThis.toastr?.warning('这个窗口还没接入 RP：幕后。'); return; }
    const l = dayLabels.find(x => x.pos === id);
    const [myDay = '', myPart = ''] = String(m.extra?.rp_day ?? '').split('@');
    const seen = l ? `系统现在认的：${escapeHtml(l.full ?? l.label)}${l.unsure ? `<br><small>拿不准：${escapeHtml(l.unsure)}</small>` : ''}` : '这条还没同步到后台。';
    const dayNo = /^d:(\d+)$/.exec(myDay)?.[1] ?? '';
    // 按年、按月走的局：说"新的一年"、时段是开局单写的那几段（章程 G2）
    const byDay = !dayScale || dayScale.unit === '天';
    const w = byDay ? '天' : dayScale.word, ord = byDay ? '天' : dayScale.ord;
    const parts = dayScale?.parts ?? DAY_PARTS;
    const radio = (v, text) => `<label style="display:block;margin:.2em 0"><input type="radio" name="rpe-day" value="${v}"${(v === 'd' ? /^d:/.test(myDay) : myDay === v) ? ' checked' : ''}> ${text}</label>`;
    const html = `<h3>剧情日期</h3><p>${seen}</p>
        <div style="text-align:left;display:inline-block">
          <b>这一${w}</b>
          ${radio('', '跟着系统认的')}${radio('day', `从这条起算新的一${w}`)}${radio('same', byDay ? '这里没有跨天' : `这里没有跨到下一${w}`)}
          <label style="display:block;margin:.2em 0"><input type="radio" name="rpe-day" value="d"${/^d:/.test(myDay) ? ' checked' : ''}> 这条是${escapeHtml(daySince)}第 <input type="number" min="1" max="9999" data-role="rpe-dayno" class="text_pole" style="width:5em;display:inline-block" value="${dayNo}"> ${ord}</label>
          <b>时段</b>
          <select data-role="rpe-part" class="text_pole" style="width:auto;display:inline-block;margin-left:.5em"><option value="">跟着系统认的</option>${parts.map(p => `<option${p === myPart ? ' selected' : ''}>${escapeHtml(p)}</option>`).join('')}</select>
        </div>
        <p><small>你定的算数，盖过系统自己认的，从这条往后都照它接着走；存在这条消息里，跟着聊天文件走，也同步给后台。</small></p>`;
    let picked = null;
    const ok = await c.callGenericPopup(html, c.POPUP_TYPE.CONFIRM, '', {
        okButton: '保存', cancelButton: '关闭',
        onClosing: popup => {
            const dlg = popup.dlg;
            const day = dlg.querySelector('input[name="rpe-day"]:checked')?.value ?? '';
            const n = Number.parseInt(dlg.querySelector('[data-role="rpe-dayno"]')?.value ?? '', 10);
            picked = { day, n, part: dlg.querySelector('[data-role="rpe-part"]')?.value ?? '' };
            return true;
        },
    });
    if (!ok || !picked || ctx().chat?.[id] !== m) return;
    if (picked.day === 'd' && !(picked.n >= 1 && picked.n <= 9999)) { globalThis.toastr?.warning(`填这条是第几${dayScale && dayScale.unit !== '天' ? dayScale.ord : '天'}。`); return; }
    const day = picked.day === 'd' ? `d:${picked.n}` : picked.day;
    const mark = `${day}${picked.part ? `@${picked.part}` : ''}`;
    const extra = { ...(m.extra ?? {}) };
    if (mark) extra.rp_day = mark; else delete extra.rp_day;
    m.extra = extra;
    await ctx().saveChat();
    await syncNow();
    globalThis.toastr?.success(mark ? '改好了，从这条往后照它算。' : '这条跟着系统认的了。', 'RP：幕后');
}
document.addEventListener('click', event => {
    const el = event.target?.closest?.('.rpe_day, .rpe_daylabel');
    const id = Number(el?.closest('.mes')?.getAttribute('mesid'));
    if (!el || !Number.isInteger(id)) return;
    event.stopPropagation();
    pickDay(id).catch(() => {});
}, true);

// ---------- 斜杠命令：不发给前台模型、不进聊天记录（白皮书 §3.4） ----------
function registerCommands() {
    const c = ctx();
    if (typeof c.registerSlashCommand !== 'function') return;
    const need = () => { if (!state.chatKey) { globalThis.toastr?.warning('这个窗口还没接入 RP：幕后。'); return false; } return true; };
    c.registerSlashCommand('账', async (_named, text) => {
        if (!need()) return '';
        const r = await api('ask', { chatKey: state.chatKey, q: String(text ?? '') });
        await ctx().callGenericPopup(`<h3>账</h3><pre style="white-space:pre-wrap">${escapeHtml(r.lines.join('\n'))}</pre>`, ctx().POPUP_TYPE.TEXT, '', { wide: true, allowVerticalScrolling: true });
        return '';
    }, ['rp-ask'], '查后台记下的事和账（剧情现状；程序查，不进聊天记录）。例：/账 那笔欠款后来怎样了；只写 /账 看总览');
    const note = (kind, done) => async (_named, text) => {
        const t = String(text ?? '').trim();
        if (!need() || !t) return '';
        const clear = t === '清';
        await api('note', { chatKey: state.chatKey, kind, ...(clear ? { clear: true } : { text: t }) });
        globalThis.toastr?.info(clear ? `已收回 /${kind}` : `${done}：${t}`, 'RP：幕后');
        refreshPlanStatus();
        return '';
    };
    c.registerSlashCommand('写', note('写', '这阵子按这个写（场面换了就退场）'), ['rp-write'], '这阵子想要的写法，原话转给角色，换个场面自动退场。例：/写 多写动作和受击反应；/写 清');
    c.registerSlashCommand('玩', note('玩', '这阵子这么玩（也会告诉规划者）'), ['rp-play'], '这阵子想怎么玩，原话转给角色和规划者。例：/玩 日常打屁；/玩 清');
    c.registerSlashCommand('停', async () => {
        if (!need()) return '';
        await api('intimate-stop', { chatKey: state.chatKey, present: [c.name1, ...members(ctx()).filter(x => !x.disabled).map(x => x.name)].filter(Boolean) });
        state.status = await api('status', { chatKey: state.chatKey });
        render();
        globalThis.toastr?.info('亲密线停着（换场景后恢复）', 'RP：幕后');
        return '';
    }, ['rp-stop'], '停下这一场的亲密线，收回还没用的亲密口袋；换地方或时段后恢复，其他口袋照常。');
    // /旁白（N-276）：现在就让旁白写一段（有人在场时也行）
    c.registerSlashCommand('旁白', async () => {
        if (!need()) return '';
        if (!currentGroup(ctx()) || !cameraOf(ctx()) || !currentGroup(ctx()).members.includes(cameraOf(ctx()).avatar)) { await setUpCamera(); return ''; }
        await cameraTurn('normal', { force: true });
        return '';
    }, ['rp-narrate'], '让旁白写一段：周围的动静、这地方的样子、没有卡的人（路人、来搭话的生人）。有卡的角色由各自的卡说话，要角色来用 /进场 名字。这个群里还没有旁白时先帮你建。');
    // /聊：打开"跟后台说话"、把这句发过去（后台复述它的理解，你点"记"才算）；后台旧了、连不上就照老样子直接留给规划
    // /进场 名字：下一段旁白写他出现，写完问你让不让他进场；群里没有旁白就直接进场（N-292）
    c.registerSlashCommand('进场', async (_named, text) => {
        if (!need()) return '';
        const who = String(text ?? '').trim();
        if (!who) { globalThis.toastr?.warning('用法：/进场 名字', 'RP：幕后'); return ''; }
        const now = ctx(), cam = cameraOf(now), group = currentGroup(now), ch = cardNamed(now, who);
        if (!ch) { globalThis.toastr?.warning(`找不到「${who}」的卡。`, 'RP：幕后'); return ''; }
        if (cam && group?.members.includes(cam.avatar)) {
            await api('arrival-request', { chatKey: state.chatKey, who: ch.name, avatar: ch.avatar }).catch(() => {});
            await cameraTurn('normal', { force: true });
        } else await enterChar(ch.name, ch.avatar);
        return '';
    }, ['rp-enter'], '让一个有卡的角色进场：旁白写到指定名字的角色出现（门被推开、终端响了），写完问你；进场后由该角色先开口，知道怎么来的、看见了什么。');
    // /离场 名字：从这条起他不在场（之后的事他不知道），并静音
    c.registerSlashCommand('离场', async (_named, text) => {
        if (!need()) return '';
        const who = String(text ?? '').trim();
        if (!who) { globalThis.toastr?.warning('用法：/离场 名字', 'RP：幕后'); return ''; }
        await leaveChar(who);
        return '';
    }, ['rp-leave'], '让指定名字的角色离场：从这条起不在场、听不见之后的事，并静音；要回来用 /进场 名字。');
    const oneWay = note('聊', '记下了，下次规划会带上');
    c.registerSlashCommand('聊', async (named, text) => {
        if (!need()) return '';
        if (await openTalk(String(text ?? '').trim()) === false) return oneWay(named, text);
        return '';
    }, ['rp-talk'], '任意调整：问记下的事、指出记错的、商量方向（不给角色看）。例：/聊 这几天想轻松点，别总围着伤病转');
}

function refreshPlanStatus() {
    if (!state.chatKey) return;
    const chatKey = state.chatKey, epoch = state.epoch;
    clearTimeout(state.planningTimer);
    refreshContent().catch(() => {});
    Promise.all([api('plan', { chatKey }), api('status', { chatKey })]).then(([p, st]) => {
        if (state.chatKey !== chatKey || state.epoch !== epoch) return;
        state.planStatus = p; state.status = st;
        noticeStory(chatKey, st.notice); render();
        if (p.awaitingPersona) void askPlanPersona(p.awaitingPersona);
        // 长规划在后台完成，玩家不发消息也要能看到失败和生效；只在有待完成规划时读状态。
        if (p.last?.status === 'requested' || st.planning?.running) state.planningTimer = setTimeout(refreshPlanStatus, 5000);
    }).catch(() => {
        if (state.chatKey === chatKey && state.epoch === epoch) state.planningTimer = setTimeout(refreshPlanStatus, 10000);
    });
}

mountPanel();
void backendConnection.check();
loadExtensionRelease();
addDayButtons();
addWand();
registerCommands();
watchDraft();
onChatChanged();
