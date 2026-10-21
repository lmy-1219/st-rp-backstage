import { renderPronouns, playerContext } from './pronoun.mjs';
// 启动本机后台：node --disable-warning=ExperimentalWarning core/main.mjs [--home 目录] [--port 端口]
// 数据默认放在仓库的 .runtime/core/（不进仓）。
import fs from 'node:fs';
import { DEFAULT_PORT } from './local.mjs';
import { withRecommended } from './recommended.mjs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openStore, fingerprint, planFailure } from './store.mjs';
import { openRecords } from './records.mjs';
import { loadConfig } from './config.mjs';
import { createStagesAdmin } from './stages.mjs';
import { addFaces } from './cast.mjs';
import { PROFILE_SYSTEM, profilePrompt, parseProfile, profileHash } from './profile.mjs';
import { SCENE_SYSTEM, scenePrompt, parseScene, admitImpulse, stillThere, movedTo } from './scene.mjs';
import { STATE_SYSTEM, statePrompt, parseState, foldState, grounded, dropRemoteHere, herOwnOnly } from './state.mjs';
import { parseGlance, completeGlance } from './glance.mjs';   // 看一眼：此刻的样子＋兴头并成一次调用（用户 10/16）
import { PREP_SYSTEM, PREP_BUDGET, prepPrompt, prepMemoText } from './prep.mjs';
import { loadLibrary, pickChunks } from './advisor.mjs';
import { createVectors } from './vectors.mjs';
import { createPresets } from './presets.mjs';
import { createTuning } from './tuning.mjs';
import { checkRelease, applyRelease } from './update.mjs';
import { createWorker } from './worker.mjs';
import { createAssembler, createKeyMaker } from './assemble.mjs';
import { loadPriceTable } from './pricing.mjs';
import { loadSeeds } from './world.mjs';
import { loadFactionNet } from './factions.mjs';
import { loadFacts } from './facts.mjs';
import { openSituation, SITUATION_SYSTEM, parseSituation, recordOutcomes, repRecord } from './situation.mjs';
import { loadAnchors, indexAnchors, planYearFlags, yearFlagText } from './years.mjs';
import { storyYear } from './world.mjs';
import { turnWorth } from './planner.mjs';   // 转向检查先程序初筛（10/16）
import { NOW_MOTIF, PLAN_SYSTEM, withIntimate, API_PLAN_NOTE, placePrep, parsePlan, NODE_CHECK_SYSTEM, nodeCheckPrompt, parseNodeCheck, TURN_CHECK_SYSTEM, turnCheckPrompt, parseTurnCheck, premiseWaiting, premiseVoids } from './planner.mjs';
import { planRoster, normalizeRelations, personOf, leaderOf } from './relations.mjs';
import { ARRIVAL_SYSTEM, arrivalPrompt, parseArrival, lastLeave, awaySpan, validAwayPlan, LEAVE_SYSTEM, leavePrompt, parseLeave, isRemote, metInPerson, justLeft, openNow } from './arrival.mjs';
import { enteredSince, landSent } from './landing.mjs';
import { intentRecord, closeIntents } from './matters.mjs';
import { SETTLE_SYSTEM, settlePrompt, parseSettle } from './settle.mjs';
import { crewOf, crewEntry, latestNode, crewPushDue, pushedMeta, pushKey, pushText } from './crew.mjs';
import { bodyGate, holdBodyContact, heldContactText } from './body.mjs';
import { ASK_SYSTEM, askPrompt, parseAsk, knownFor, exchangeRecords } from './offstage.mjs';
import { lifeSheet, homeChanged } from './life.mjs';
import { boardFor } from './board.mjs';
import { awayPlansOf } from './opening.mjs';
import { unansweredLine, promisesFor, pullOf, placeNow } from './waiting.mjs';
import { doorFor } from './door.mjs';
import { knockNow, knockCandidate, beginKnock, knockAdvance, answerKnock, turnFor, autoLeave, markLeft, waitingKnock, pendingKnock, recentLapsed, leaveDoubts, answerLeaves, takePendingLeft, acknowledgeLeaves, KNOCK_JUDGE_SYSTEM, knockJudgePrompt, parseKnockJudge } from './auto.mjs';   // 自动进离场与调度（D-201）
import { pendingFor } from './pending.mjs';
import { planBrief, nodeCheckLines, nodeCheckTaken, awayMaterial, storyContext, sceneMaterial, prepMaterial, situationMaterial, prefetchFor, intimateSetup, intimatePlanOptions } from './slot.mjs';
import { AWAY_SYSTEM, AWAY_REVISE_SYSTEM, parseAway, awayPrompt, revisePrompt, pinNames, actualDaysOf } from './away.mjs';
import { FRESH_SYSTEM, freshPrompt, staleSpans, applyFresh, freshAnswerValid, voiceOf, PREVIOUS } from './fresh.mjs';
import { STAY_SYSTEM, stayPrompt, parseStay, applyStay } from './stay.mjs';
import { echoOpenings, dropEchoHeads } from './pace.mjs';
import { createHandoffs } from './handoff.mjs';
import { createAdvisor } from './advisor.mjs';
import { createSetupMaker, createKeysMaker, advisorContext, sameName, staleBackstory } from './setup.mjs';
import { createTalk } from './talk.mjs';
import { RECHECK_SYSTEM, recheckCandidates, recheckPrompt, parseRecheck, CLOSE_SYSTEM, closePrompt, staleCandidates, parseStale } from './recheck.mjs';
import { stripper } from './extract.mjs';
import { LORE_SYSTEM, lorePrompt, parseLore, LORE_VERSION, loreBatch, loreTried, GIVE_UP_VERDICT } from './lore.mjs';
import { createMaterials, LOOK_SYSTEM, lookPrompt, parseLook, RELATIONS_SYSTEM } from './materials.mjs';
import { weekOf, rollLong, activeLong, LONG_SYSTEM, longPrompt, parseLong } from './drift.mjs';
import { briefSection } from './setup.mjs';
import { clockFor, requestPlanNow, stateBlock, timelineFor, timeMarksFor, settledBy, CAMERA_NAME, scaleFor, paceFor, pastNodesOf, RECENT_NODES, sofarOf } from './slot.mjs';
import { paceCap } from './tempo.mjs';
import { withTaste } from './taste.mjs';   // 模型口味层：规划、检查的通用底后面按型号补几句口味（用户 10/15）
import { planSystem } from './planner.mjs';
import { extractSystem } from './extract.mjs';
import { bindPromptEnvironment, promptOptionsFor } from './prompt-slots.mjs';
import { renderPacket } from './handoff.mjs';
import { dayNumber } from './timeline.mjs';
import { EPISODE_SYSTEM, episodePrompt, parseEpisodes, spanOf, coveredUpTo } from './episodes.mjs';
import { storyDigest, SOFAR_SYSTEM, sofarPrompt, parseSofar } from './planner.mjs';
import { relativeDay, dayIndex } from './recall.mjs';
import { createModelClient, modelTally } from './model.mjs';
import { createServer, VERSION } from './server.mjs';
import { wantedProxy, proxyActive, proxyEnv } from './proxy.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const home = path.resolve(arg('--home') ?? process.env.RP_EMERGENCE_HOME ?? path.join(repo, '.runtime', 'core'));
const port = Number(arg('--port') ?? process.env.RP_EMERGENCE_PORT ?? DEFAULT_PORT);
// 玩的 ST 拉起的后台（D-117）：--st＝那个 ST 的目录，--follow＝跟着正本的哪个版本走（origin/main）。开发副本不带，面板上就没有"更新"。
const stRoot = arg('--st') ? path.resolve(arg('--st')) : null;
const follow = arg('--follow') ?? null;

// 出网代理自己兜底（core/proxy.mjs）：该走的代理（--proxy，没给就读 ST 的 config.yaml）这个进程没带上，就带着它重启自己一次再干活。
// NODE_USE_ENV_PROXY 只在进程启动时认，所以只能重启；RPE_PROXY_RESPAWN 防止来回重启。
const outProxy = wantedProxy({ proxyArg: arg('--proxy') ?? null, stRoot });
if (outProxy && !proxyActive(process.env, outProxy) && process.env.RPE_PROXY_RESPAWN !== '1') {
    spawn(process.execPath, [...process.execArgv, ...process.argv.slice(1)], { detached: true, stdio: 'ignore', windowsHide: true, env: { ...proxyEnv(process.env, outProxy), RPE_PROXY_RESPAWN: '1' } }).unref();
    process.exit(0);
}

fs.mkdirSync(home, { recursive: true });
// 全新的数据目录（别人刚装好）：先写上推荐配置（以前要手跑 tools/init-config.mjs）。钥匙不在里面：用户在面板钥匙簿里存，只存一把就各环节都用它
const freshHome = !fs.existsSync(path.join(home, 'config.json'));
if (freshHome) fs.writeFileSync(path.join(home, 'config.json'), `${JSON.stringify(withRecommended({}).config, null, 2)}\n`);
const logFile = path.join(home, 'core.log');
const log = line => fs.appendFileSync(logFile, `${new Date().toISOString()} ${line}\n`);
if (freshHome) log('new data folder: wrote the recommended config');

const store = openStore(path.join(home, 'rp.sqlite'));
const records = openRecords(store.db);
const situation = openSituation(store.db);
// 配置每次用时现读：用户改了钥匙或预算不用重启后台。
const getConfig = () => { const config = loadConfig(home); return { ...config, promptOptionsForChat: chatKey => promptOptionsFor(store, chatKey, config) }; };
const promptEnvironment = bindPromptEnvironment(store, { home, getConfig });
// 外援（D-73）：API 没响应、或设成交给窗口的活，写成外援包放进 <数据目录>/handoff/，由 AI 窗口做完用 tools/handoff.mjs 交回。
const handoffs = createHandoffs({ store, home, log });
const worker = createWorker({ store, records, getConfig, log, handoffs });
worker.start();
const assembler = createAssembler({ getConfig, records, log });
const keyMaker = createKeyMaker({ getConfig, records, log });
const setupMaker = createSetupMaker({ getConfig, records, log, clientFor: e => createModelClient(e) });
const keysMaker = createKeysMaker({ getConfig, records, clientFor: e => createModelClient(e) });
const materials = createMaterials(home);
const advisor = createAdvisor({ getConfig, records, log, repo, clientFor: a => createModelClient(a), packFor: chatKey => (chatKey ? packOf(chatKey) : null),
    ownFor: chatKey => (chatKey ? materials.libraryDir(store.requireChat(chatKey).story_id) : null) });

// 规划：queue＝写成外援包交给窗口（测试期，不走中转）；api＝调规划模型，没响应再交给窗口。
const advisorNote = id => (advisor.ready() ? [
    '碰到原作／世界层面的问题（某个势力会怎么动、一条情报怎么流转、有哪些用得上的边角人物），可以先问参谋再写规划：',
    '',
    `    node --disable-warning=ExperimentalWarning tools/advise.mjs --plan ${id} --q "问题" --context "眼下这一问的前提，一两句"`,
    '',
    '本局的开局单（原则、原作走向、前史）会自动带给参谋。拿回的是候选备忘，不是事实；用不用、怎么用由你定。支线"谁"牵头仍得是名册里的人，参谋给的人和事写进露面、应答里。',
].join('\n') : null);
// strict：年份和年表对不上就退回让写的人改（窗口写的）；调 API 写的没人能改，照收并记一笔。
const planOptions = chatKey => intimatePlanOptions(store, chatKey, planRoster(store, store.requireChat(chatKey).story_id, { chatKey }));
const planSystemFor = (chatKey, model, config) => { const options = promptOptionsFor(store, chatKey, config); return renderPronouns(withIntimate(withTaste(paceCap(planSystem(options), paceFor(store, chatKey)), { ...options, kind: 'plan', model }), intimateSetup(store, chatKey), options), playerContext(store, chatKey)); };
const requirePlanAttempt = id => { if (!store.ownsPlanAttempt(id)) throw Object.assign(new Error('plan_late：迟到作废'), { status: 409 }); };
const observePlanAttempt = id => {
    let at = 0, stage = null;
    return meta => { if (meta.stage !== stage || Date.now() - at >= 1000) { at = Date.now(); stage = meta.stage; store.updatePlanAttempt(id, meta); } };
};
const applyPlan = (planId, text, { strict = true, attempt = null } = {}) => {
    const plan = store.planById(planId);
    const own = !attempt;
    attempt ??= store.beginPlanAttempt(planId, { entry: 'handoff', model: 'window', briefChars: plan?.brief?.length ?? 0 });
    if (!attempt) throw Object.assign(new Error(plan?.status === 'requested' && store.activePlanAttempt(plan.chat_key, planId) ? '正在重新规划' : 'plan_late：迟到作废'), { status: 409 });
    try {
    requirePlanAttempt(attempt);
    store.updatePlanAttempt(attempt, { stage: '解析', outputChars: text.length });
    const chat = store.requireChat(plan.chat_key);
    const parsed = parsePlan(text, planOptions(plan.chat_key));
    if (!parsed.items.length) throw Object.assign(new Error(`规划里的事一件都没过：${parsed.dropped.map(d => d.reason).join('；')}`), { status: 400 });
    const anchors = packOf(plan.chat_key)?.anchors;
    const years = anchors ? (setup => planYearFlags(parsed, anchors, storyYear(setup), { setup }))(store.setupOf(chat.story_id)?.data).map(yearFlagText) : [];
    if (years.length && strict) throw Object.assign(new Error(`年份和年表对不上，改了再交：${years.join('；')}`), { status: 400 });
    if (years.length) log(`plan ${planId} accepted with year flags: ${years.join('；')}`);
    if (parsed.dropped.length) log(`plan ${planId} dropped ${parsed.dropped.length}: ${parsed.dropped.map(d => d.reason).join('；')}`);
    if (parsed.warnings?.length) log(`plan ${planId} warnings: ${parsed.warnings.join('；')}`);   // 只提醒、不退件（章程 H5：头一格太密）
    requirePlanAttempt(attempt);
    store.updatePlanAttempt(attempt, { stage: '落账' });
    store.submitPlan(plan.id, { ...parsed, raw: text });
    const faces = addFaces(store, chat.story_id, parsed.faces);
    if (faces.length) log(`plan ${planId} new faces: ${faces.join('、')}`);
    extendSofar(plan.chat_key).catch(error => log(`story so far ${plan.chat_key} failed: ${error.message}`));   // 章程 H4：之前的节点多了，更早的并成一段大意
    if (own) store.finishPlanAttempt(attempt);
    return { goal: parsed.goal, items: parsed.items.length, dropped: [...parsed.dropped.map(d => d.reason), ...(parsed.warnings ?? [])], years };
    } catch (error) {
        if (own) { const failure = planFailure(error); store.finishPlanAttempt(attempt, { status: failure === 'late' ? 'late' : 'failed', failure }); }
        throw error;
    }
};
const planPacket = ({ id, chatKey, brief }, why) => handoffs.request({
    kind: 'plan', key: String(id), chatKey, why, system: planSystemFor(chatKey, 'claude', getConfig()), user: brief,
    task: '当规划者：读【输入】里这一局此刻的账，按【系统提示】规划一个主线节点（局面、节点、这个节点里的事、往后），只输出它要的那个 JSON。这是长规划，要全面：值得起一个子代理慢慢想',
    checks: '"谁"必须是名册或关系表里的人、各格不能缺（用意、触发、时效、前提缺一不收）、露面应答知情来由里不能有写给后台的话，不合格的那件会被丢掉；"旧件"里答了留、撤、换的照办；一件都没过就退回；年份对不上年表的退回',
    extra: advisorNote(id), meta: { planId: id },
});
// 按此刻的账重攒简报（关系表、开局单改过，或者剧情往前走了）；攒不出来就用要规划那会儿的。
const freshBrief = planId => {
    const plan = store.planById(planId);
    try {
        const v = JSON.parse(store.getMeta(`plan_verdict:${planId}`) ?? 'null');   // 转向那一次的依据、参谋备忘，重攒时带上
        const memo = store.getMeta(`plan_memo:${planId}`), prep = store.getMeta(`plan_prep:${planId}`);
        // 备料、参谋备忘放在设定之后、局面之前（三家对比：接在末尾离输出最近，被原样搬进规划）
        const brief = planBrief(store, records, plan.chat_key, { reason: plan.reason, verdict: v?.verdict ?? null, thread: v?.thread ?? null, factionNet: packOf(plan.chat_key)?.factions ?? null, sit: situation, prices: packOf(plan.chat_key)?.table ?? null, facts: packOf(plan.chat_key)?.facts ?? null, prep: [prep, memo], budget: getConfig().planner.briefChars });
        store.setPlanBrief(plan.id, brief);
        return brief;
    } catch (error) { log(`plan ${planId} rebrief failed: ${error.message}`); return plan.brief; }
};
// 换档/换包之后，待交外援题目也用当前口味；不改其 planId、状态和已交回的答案。
const refreshPlanPackets = () => {
    for (const handoff of store.pendingHandoffs().filter(h => h.kind === 'plan')) {
        try {
            const plan = store.planById(handoff.payload.meta?.planId);
            if (!plan || plan.status !== 'requested') continue;
            const payload = { ...handoff.payload, system: planSystemFor(plan.chat_key, 'claude', getConfig()), user: freshBrief(plan.id) };
            if (payload.system === handoff.payload.system && payload.user === handoff.payload.user) continue;
            store.db.prepare("update handoffs set payload = ? where id = ? and status = 'pending'").run(JSON.stringify(payload), handoff.id);
            fs.mkdirSync(path.join(home, 'handoff'), { recursive: true });
            fs.writeFileSync(path.join(home, 'handoff', `${handoff.id}.md`), renderPacket({ ...handoff, payload }));
        } catch (error) { log(`plan handoff ${handoff.id} prompt refresh failed: ${error.message}`); }
    }
};
// 重启前就在等、还没有外援包的规划（比如这个功能上线前要的），补一份包。
for (const row of store.db.prepare("select id from plan_attempts where status = 'running'").all()) store.finishPlanAttempt(row.id, { status: 'failed', failure: 'connection' });
for (const p of store.pendingPlans()) {
    if (store.pendingHandoff('plan', String(p.id))) continue;
    planPacket({ id: p.id, chatKey: p.chat_key, brief: freshBrief(p.id) }, '要一份新的节点规划（设成了交给窗口写，不走 API）');
}
refreshPlanPackets();
// 调规划模型写一个节点的规划（api 模式；面板"再试一次"也走这里）。成了就落账，没成抛错。长规划输出多，给足长度和时间。
async function planViaApi({ id, chatKey, brief, attempt = null, entry = 'auto' }) {
    const cfg = getConfig(), e = cfg.extractor, p = cfg.planner, s = cfg.stages.plan;
    const thinks = !!(s.extraBody?.reasoning_effort || s.extraBody?.output_config?.effort);
    attempt ??= store.beginPlanAttempt(id, { entry, model: s.model ?? p.model, thinks, briefChars: brief.length });
    if (!attempt) throw Object.assign(new Error('正在重新规划'), { status: 409 });
    const started = Date.now();
    try {
    requirePlanAttempt(attempt);
    store.updatePlanAttempt(attempt, { stage: '发出', briefChars: brief.length });
    if (!s.baseUrl || !s.apiKey) throw new Error('planner_no_api');
    if (records.spentToday() >= e.dailyBudgetUsd) throw new Error('budget_reached');
    // 规划自己的每日上限（planner.budgetUsd）：到了就不再调，交给窗口写（9/27 查漏：这个上限以前配了没管）。
    if (records.spentTodayOn('(规划)') >= p.budgetUsd) throw new Error('plan_budget_reached');
        // 规划模型先想很久才开始写（实测 Fable 经中转，想的时候一个字都不发）：连着没数据的限放宽到 10 分钟，整件事 15 分钟。
        // 开了思考档的（Opus 5.5 高档）：想的那部分也算在输出上限里，直接给到 64000（10/11 实测高档一次就想掉四万八，起步给小了白花一回钱）。
        const r = await createModelClient({ ...e, ...s, maxOutputTokens: thinks ? 64000 : 24000, maxCap: thinks ? 64000 : undefined, timeoutMs: 900000, stream: true, idleMs: 600000 }).complete({ system: planSystemFor(chatKey, s.model ?? p.model, cfg), user: `${brief}\n\n${API_PLAN_NOTE}` }, { onMeta: observePlanAttempt(attempt) });
        store.updatePlanAttempt(attempt, { ...r.telemetry, outputChars: r.text.length });
        const costUsd = ((r.usage?.input ?? 0) * p.priceInPerM + (r.usage?.output ?? 0) * p.priceOutPerM) / 1e6;
        records.logAssemble({ chatKey, speaker: '(规划)', model: p.model, servedModel: r.servedModel, status: 'done', usage: r.usage, costUsd, ms: Date.now() - started, raw: r.text });
        const result = applyPlan(id, r.text, { strict: false, attempt });
        store.finishPlanAttempt(attempt);
        return result;
    } catch (error) {
        const failure = planFailure(error);
        store.finishPlanAttempt(attempt, { ...error.telemetry, status: failure === 'late' ? 'late' : 'failed', failure });
        records.logAssemble({ chatKey, speaker: '(规划)', model: p.model, status: 'failed', ms: Date.now() - started, error: error.message });
        log(`plan ${id} via api failed: ${error.message}`);
        throw error;
    }
}
const planRetryOrigins = new Map();
handoffs.register('plan', {
    stale: meta => !store.pendingPlans().some(p => p.id === meta.planId),
    apply: (text, meta) => applyPlan(meta.planId, text),
    // 面板"再试一次"：不等窗口，直接调规划模型（要钱：Fable 写一整个节点约一两美元）。
    retry: async meta => {
        const plan = store.planById(meta.planId);
        const cfg = getConfig(), s = cfg.stages.plan;
        const entry = planRetryOrigins.get(plan.id) ?? 'button';
        planRetryOrigins.delete(plan.id);
        const attempt = store.beginPlanAttempt(plan.id, { entry, model: s.model ?? cfg.planner.model, thinks: !!(s.extraBody?.reasoning_effort || s.extraBody?.output_config?.effort), briefChars: plan.brief?.length ?? 0 });
        if (!attempt) throw Object.assign(new Error('正在重新规划'), { status: 409 });
        try {
        store.updatePlanAttempt(attempt, { stage: '备料' });
        // 要规划那次备料没做成（杂务窗 9/30：开局那次认不到 Gemini 的钥匙，重试照样没有）：重试前补一份；还是没成就不带，照常写
        if (!store.getMeta(`plan_prep:${plan.id}`)) {
            const prep = await prepMemo({ chatKey: plan.chat_key }).catch(error => { log(`plan ${plan.id} prep failed again: ${error.message}`); return null; });
            if (prep) store.setMeta(`plan_prep:${plan.id}`, prep);
        }
        await planViaApi({ id: plan.id, chatKey: plan.chat_key, brief: freshBrief(plan.id), attempt });
        return 'done';
        } catch (error) { const failure = planFailure(error); store.finishPlanAttempt(attempt, { status: failure === 'late' ? 'late' : 'failed', failure }); throw error; }
    },
});
// force：这一次不管配置怎么设都走外援包（本机工具导一份写好的规划用，不花钱）
const onRequest = ({ id, chatKey, brief, reason, verdict = null, thread = null, force = null, rebrief = null, entry = 'auto' }) => {
    const cfg = getConfig(), s = cfg.stages.plan;
    const queue = force === 'queue' || cfg.planner.provider !== 'api';
    const attempt = store.beginPlanAttempt(id, { entry, model: queue ? 'window' : s.model ?? cfg.planner.model, thinks: !queue && !!(s.extraBody?.reasoning_effort || s.extraBody?.output_config?.effort), briefChars: brief.length });
    if (!attempt) return;
    store.updatePlanAttempt(attempt, { stage: '备料' });
    log(`plan ${id} requested (${reason}) for ${chatKey}`);
    if (verdict) store.setMeta(`plan_verdict:${id}`, JSON.stringify({ verdict, thread }));
    // 转向：不问用户，直接重新规划；面板上给一句不剧透的提示，证明系统在转（用户 9/27 定）。
    if (reason === 'turn' || reason === 'shift') store.setMeta(`notice:${chatKey}`, JSON.stringify({ id: `plan-${id}`, text: '剧情迎来了意外的展开' }));
    const go = b => {
        requirePlanAttempt(attempt);
        if (force === 'queue' || getConfig().planner.provider !== 'api') { const packet = planPacket({ id, chatKey, brief: b }, force === 'queue' ? '要一份新的节点规划（本机工具要的，交回写好的那份）' : '要一份新的节点规划（设成了交给窗口写，不走 API）'); store.finishPlanAttempt(attempt, { status: 'queued', stage: '等外援', briefChars: b.length }); return packet; }
        planViaApi({ id, chatKey, brief: b, attempt }).catch(error => {
            if (store.planById(id)?.status === 'requested') planPacket({ id, chatKey, brief: b }, `调规划模型没成（${error.message}）`);
        });
    };
    (async () => {
        // 规划前备料（D-109 第 3 步）：Gemini 读整张卡、账本、原文、资料，挑出候选插进简报（设定之后、局面之前）——写规划的模型读不了那么多。
        const prep = await prepMemo({ chatKey }).catch(error => { log(`plan ${id} prep failed: ${error.message}`); return null; });
        if (prep) store.setMeta(`plan_prep:${id}`, prep);
        let memo = null;
        // 玩家转了新方向：再让参谋从原作／世界层面查一遍（势力、情报链、突破口、边角人物）——
        // API 模式下写规划的模型一次调用没法自己去问参谋（N-130）。这一局没选素材包就不问（T-23 实测：没有开卷资料，参谋只会列一串冲突空位）。
        if (reason === 'turn' && advisor.ready() && packOf(chatKey)) {
            memo = await turnMemo({ chatKey, verdict, thread }).catch(error => { log(`plan ${id} advisor memo failed: ${error.message}`); return null; });
            if (memo) store.setMeta(`plan_memo:${id}`, memo);
        }
        // 备料也算进简报的预算（章程 H4）：带着它按要规划那会儿的参数重攒；攒不出来照旧插进去
        let b = brief;
        if (prep || memo) { try { b = rebrief ? rebrief([prep, memo].filter(Boolean)) : placePrep(brief, [prep, memo]); } catch (error) { log(`plan ${id} rebrief failed: ${error.message}`); b = placePrep(brief, [prep, memo]); } }
        if (b !== brief) store.setPlanBrief(id, b);
        go(b);
    })().catch(error => { const failure = planFailure(error); store.finishPlanAttempt(attempt, { status: failure === 'late' ? 'late' : 'failed', failure }); log(`plan ${id} prepare failed: ${error.message}`); });
};

// 规划前备料：用"备料"那一环节（默认跟着参谋），读得多、便宜；这一局选了素材包就按最近的原文挑一叠资料一起给。
async function prepMemo({ chatKey }) {
    const cfg = getConfig(), s = cfg.stages.prep;
    if (!s?.baseUrl || !s.apiKey || !s.model || records.spentToday() >= cfg.extractor.dailyBudgetUsd) return null;
    const pack = packOf(chatKey);
    const recentText = store.currentMessages(chatKey).slice(-12).map(m => m.text).join('\n');
    const library = pack ? pickChunks(loadLibrary(pack.dir), recentText, { budget: PREP_BUDGET.library }) : [];
    const started = Date.now();
    try {
        const r = await createModelClient({ ...s, maxOutputTokens: 8000, timeoutMs: 300000, stream: true }).complete({ system: PREP_SYSTEM, user: prepPrompt(prepMaterial(store, records, chatKey, { library })) });
        const costUsd = ((r.usage?.input ?? 0) * s.priceInPerM + (r.usage?.output ?? 0) * s.priceOutPerM) / 1e6;
        records.logAssemble({ chatKey, speaker: '(备料)', model: s.model, servedModel: r.servedModel, status: 'done', usage: r.usage, costUsd, ms: Date.now() - started, raw: r.text });
        log(`plan prep for ${chatKey}: ${r.usage?.input ?? '?'} in, $${costUsd.toFixed(3)}`);
        return prepMemoText(r.text);
    } catch (error) {
        records.logAssemble({ chatKey, speaker: '(备料)', model: s.model, status: 'failed', ms: Date.now() - started, error: error.message });
        throw error;
    }
}

async function turnMemo({ chatKey, verdict, thread }) {
    const setup = store.setupOf(store.requireChat(chatKey).story_id)?.data ?? null;
    const line = thread ? [...(setup?.储备线 ?? []), ...(setup?.主线 ?? [])].find(x => x.名 === thread) : null;
    const question = [
        `这一局的玩家角色认真提出了一个新的长期方向：${verdict ?? '（见依据）'}。`,
        line ? `开局单里对应的线「${line.名}」：${line.内容}` : '',
        '从原作（这一局有的话）和世界设定层面推一下：这件事牵涉哪些势力，它们眼下各自的处境、会怎么反应；有哪些情报链、突破口和代价；有哪些用得上的边角人物和没闭环的旧事。只给候选，标出处。',
    ].filter(Boolean).join('\n');
    const roster = store.getCast(store.requireChat(chatKey).story_id).map(e => e.name);
    const r = await advisor.ask({ question, context: advisorContext(setup), chatKey, roster, year: storyYear(setup) });
    // 填不出来的空位（"……：空"）不给规划者：只剩个框的"需要一个……"照样会把剧情往那边带。
    const memo = (r?.memo ?? '').split('\n').filter(x => !/[:：]\s*空\s*$/.test(x)).join('\n').trim();
    if (!memo.split('\n').some(x => /^\s*([-·•]|\d+[.、)])\s*\S/.test(x))) return null;
    r.memo = memo;
    log(`advisor memo for turn (${chatKey}): $${(r.costUsd ?? 0).toFixed(3)}`);
    return `【参谋备忘】（玩家转向后，Gemini 按素材包从原作／世界层面查的候选，不是事实；用不用、怎么用由你定）\n${r.memo}${r.flags?.length ? `\n程序核对专名：${r.flags.join('；')}` : ''}`;
}

// 玩家的角色提了新想法（记账记下来的）：便宜模型看一眼是不是认真要长期去做的新方向、对不对得上哪条储备线。是就记下判定，
// 下一次开口时重新规划（needsPlan → 'turn'）。不排外援：调不通就算了，下一个想法再看；/聊 和面板也能手动要。
// changes：这份规划之后新记下的关系变化、一直算数的改变（谁的都算）——看规划设想的局面还成不成立（用户 10/4）。
async function checkTurn({ chatKey, planId, ideas = [], others = [], changes = [], acts = [], outside = [] }) {
    const cfg = getConfig(), a = cfg.stages.judge, p = cfg.planner;
    if (!p.judge || !a.baseUrl || !a.apiKey || !p.judgeModel || !(ideas.length || others.length || changes.length || acts.length || outside.length)) return;
    if (records.spentToday() >= cfg.extractor.dailyBudgetUsd) return;
    // 程序初筛（planner.turnWorth；面板能关）：筛掉的这一轮不问，记录照样算看过（slot 那边已经记了）
    if (p.turnScreen) {
        const lastPos = store.currentMessages(chatKey).at(-1)?.pos ?? 0;
        const w = turnWorth({ ideas, others, changes, acts, outside, lastPos, actsAt: store.getMeta(`turn_acts_at:${chatKey}`) });
        if (!w.worth) { log(`plan ${planId} turn check skipped: ${w.why}`); return; }
        if (w.actsOnly) store.setMeta(`turn_acts_at:${chatKey}`, String(lastPos));
    }
    const plan = store.planById(planId);
    const node = plan?.node ? JSON.parse(plan.node) : null;
    const setup = store.setupOf(store.requireChat(chatKey).story_id)?.data ?? null;
    const started = Date.now();
    // 还等着的事连前提（章程 F1）：本来就要跑这一问，顺带看前提还在不在；不另加调用
    const waiting = premiseWaiting(store.menuOf(chatKey));
    try {
        const r = await createModelClient({ ...a, maxOutputTokens: 400 })
            .complete({ system: withTaste(TURN_CHECK_SYSTEM, { kind: 'judge', model: a.model ?? p.judgeModel, config: cfg }), user: turnCheckPrompt({ node, reserve: setup?.储备线 ?? [], main: setup?.主线 ?? [], ideas, others, changes, acts, outside, waiting }) });
        const costUsd = ((r.usage?.input ?? 0) * p.judgePriceInPerM + (r.usage?.output ?? 0) * p.judgePriceOutPerM) / 1e6;
        records.logAssemble({ chatKey, speaker: '(转向检查)', model: p.judgeModel, servedModel: r.servedModel, status: 'done', usage: r.usage, costUsd, ms: Date.now() - started, raw: r.text });
        const v = parseTurnCheck(r.text);
        log(`plan ${planId} turn check on ${[...ideas, ...others, ...changes, ...acts].map(i => i.id).join(',')}: ${v.turn ? '转向' : v.broke ? '弄断' : v.shift ? '局面变了' : '没有'}${v.thread ? `（${v.thread}）` : ''}${v.why ? `（${v.why}）` : ''}${v.idea ? `；念头：${v.idea.who}——${v.idea.what}` : ''}${v.loud ? `；发酵：${v.loud.ids.join(',')}（${v.loud.why}）` : ''}`);
        // 闹出了大动静（D-170，用户 10/6）：不等换天，当场让局势跑一次——各方动起来、消息传开、给玩家这边排一两件后续。一个剧情时段至多一次
        // 编号对不上（试玩 10/6：模型写了列表里的第 2、3 条，不是记录编号，那次局势什么都没拿到）：就当这一轮各人做的、说的都算
        const seen = [...acts, ...ideas, ...others, ...changes];
        const loudIds = v.loud ? v.loud.ids.filter(id => seen.some(r => r.id === id)) : [];
        if (v.loud && !outside.length && cfg.situation.enabled) loudSituation({ chatKey, ids: loudIds.length ? loudIds : acts.map(r => r.id), why: v.loud.why }).catch(error => log(`situation (loud) failed: ${error.message}`));
        // 判定挂在依据的那条想法所在的消息上：那条删了、改了、换到没有它的分支，这个判定就不算（verdictOf）。
        // 局面变了的挂在那条变化上；都有时挂在最后那条上（删到它之前就不算）
        const tip = store.currentMessages(chatKey).at(-1);
        // 前提没了的那几件撤掉，记一句为什么；挂在最后一条上（删回去就回来）
        for (const m of premiseVoids(waiting, v.gone)) {
            if (tip) store.updateMenu(chatKey, m.id, { status: 'void', by: '转向检查', why: m.why, at: { pos: tip.pos, fp: tip.fp } });
            log(`plan ${planId} menu ${m.id}「${m.title}」void: ${m.why}`);
        }
        const at = (v.shift && !v.turn && !v.broke ? changes : [...ideas, ...others, ...changes, ...acts]).reduce((x, r) => (!x || r.pos > x.pos ? r : x), null) ?? (outside.length && tip ? { pos: tip.pos, fp: tip.fp } : null);
        // 角色起的新念头（玩家没转向、没弄断时）：给眼下这个节点补几件，不整个重排（D-107）
        if (v.idea && !v.turn && !v.broke && !v.shift) {
            const src = others.filter(r => r.holder_name === v.idea.who).at(-1) ?? others.at(-1);
            if (src) supplement({ chatKey, planId, idea: v.idea, at: { pos: src.pos, fp: src.fp } }).catch(error => log(`plan ${planId} supplement failed: ${error.message}`));
        }
        if ((v.turn || v.broke || v.shift) && at) store.setMeta(`node_verdict:${planId}`, JSON.stringify({ result: v.turn ? '转向' : v.broke ? '弄断' : '变了', why: v.why, thread: v.thread, at: { pos: at.pos, fp: at.fp } }));
    } catch (error) {
        records.logAssemble({ chatKey, speaker: '(转向检查)', model: p.judgeModel, status: 'failed', ms: Date.now() - started, error: error.message });
    }
}

// 给眼下这个节点补几件（角色认真起了新念头，D-107）：同一份规划至多补两回；用规划那档、同一个每日上限；
// 补进来的挂在起念头那条消息上，删到它之前就撤回。出来的事按"事件"那套核对，新面孔照样入册。
const SUPPLEMENTS = 2;
async function supplement({ chatKey, planId, idea, at }) {
    return addToPlan({ chatKey, planId, at, counter: `plan_supplements:${planId}`, max: SUPPLEMENTS, reason: 'idea', verdict: `${idea.who}：${idea.what}`, line: `${idea.who}的念头`, label: `for ${idea.who}（${idea.what}）` });
}
// 剧情走到了开局单里某条储备线写明的地方（N-293）：展开那条线，给眼下这个节点补几件此刻就能用上的；同一份规划至多两回（同一条线一个剧情日一回，slot 那边管）
async function placeSupplement({ chatKey, planId, line, place, at }) {
    return addToPlan({ chatKey, planId, at, counter: `plan_place:${planId}`, max: SUPPLEMENTS, reason: 'place', verdict: `储备线「${line}」写明的地方到了：${place}`, thread: line, line, label: `at ${place}（${line}）` });
}
async function addToPlan({ chatKey, planId, at, counter, max, reason, verdict, thread = null, line, label }) {
    const key = counter, done = Number(store.getMeta(key) ?? 0);
    if (done >= max) return;
    const cfg = getConfig(), e = cfg.extractor, p = cfg.planner, s = cfg.stages.plan;
    if (p.provider !== 'api' || !s.baseUrl || !s.apiKey) return;
    if (records.spentToday() >= e.dailyBudgetUsd || records.spentTodayOn('(规划)') >= p.budgetUsd) return;
    const attempt = store.beginPlanAttempt(planId, { entry: 'supplement', model: s.model ?? p.model, thinks: !!(s.extraBody?.reasoning_effort || s.extraBody?.output_config?.effort), supplement: true });
    if (!attempt) return;
    try {
    store.setMeta(key, String(done + 1));
    const chat = store.requireChat(chatKey);
    const brief = planBrief(store, records, chatKey, { reason, verdict, thread, prices: packOf(chatKey)?.table ?? null, facts: packOf(chatKey)?.facts ?? null, budget: p.briefChars });
    store.updatePlanAttempt(attempt, { briefChars: brief.length });
    const started = Date.now();
    // 调不通（中转掐断、没回话）：记一笔失败、这一回不算数，抛给叫它的那边（储备线到了地方那一路会过几条再试）——
    // 以前一声不响就没了，次数却记上了（试玩 10/8：到了那个地方那一回没调通，那一天、那份规划就再也不补）
    let r;
    try { r = await createModelClient({ ...e, ...s, maxOutputTokens: 6000, timeoutMs: 600000, stream: true, idleMs: 300000 }).complete({ system: planSystemFor(chatKey, s.model ?? p.model, cfg), user: brief }, { onMeta: observePlanAttempt(attempt) }); }
    catch (error) {
        store.setMeta(key, String(done));
        records.logAssemble({ chatKey, speaker: '(规划)', model: p.model, status: 'failed', usage: error.usage ?? null, ms: Date.now() - started, error: error.message });
        log(`plan ${planId} supplement ${label} failed: ${error.message}`);
        throw error;
    }
    const costUsd = ((r.usage?.input ?? 0) * p.priceInPerM + (r.usage?.output ?? 0) * p.priceOutPerM) / 1e6;
    records.logAssemble({ chatKey, speaker: '(规划)', model: p.model, servedModel: r.servedModel, status: 'done', usage: r.usage, costUsd, ms: Date.now() - started, raw: r.text });
    requirePlanAttempt(attempt);
    store.updatePlanAttempt(attempt, { ...r.telemetry, stage: '解析', outputChars: r.text.length });
    const parsed = parsePlan(r.text, planOptions(chatKey));
    // 到了那个地方补的、当天就用的：此刻就在那儿才用得上，不排在口袋里别的事后头（按"当下"放：到了就进口袋、不占份数，先递）——
    // 试玩 10/9：吧台那几件补进来以后，口袋被两件别处的事占满，一直进不来
    const items = parsed.items.slice(0, 4).map(m => ({ ...m, line: m.line || line, ...(reason === 'place' && !(m.afterDays > 0) ? { motif: NOW_MOTIF } : {}) }));
    if (!items.length) { store.finishPlanAttempt(attempt, { status: 'failed', failure: 'bad_answer' }); log(`plan ${planId} supplement ${label}: nothing passed (${parsed.dropped.map(d => d.reason).join('；')})`); return; }
    const today = storyContext(store, records, chatKey).today;
    requirePlanAttempt(attempt);
    store.updatePlanAttempt(attempt, { stage: '落账' });
    store.appendMenu(planId, items, { storyDay: today, at, intimateProgress: parsed.intimateProgress });
    addFaces(store, chat.story_id, parsed.faces);
    log(`plan ${planId} supplement ${label}: ${items.map(m => m.title).join('、')} $${costUsd.toFixed(3)}`);
    store.finishPlanAttempt(attempt);
    } catch (error) { const failure = planFailure(error); store.finishPlanAttempt(attempt, { ...error.telemetry, status: failure === 'late' ? 'late' : 'failed', failure }); throw error; }
}

// 兴头（D-109 第 2 步，scene.mjs）：进来一条新的角色回复，看一眼场面。每条只看一次；
// 上一个兴头之后隔 gap 条才再看；同一个人隔 personGap 条。念头得是在场的人，邀约得是不在场的熟人；"提前"＝把排着的那件放进口袋，挂在这一条上。
// 此刻的样子（core/state.mjs，用户 9/30）：新来的消息读一遍，记穿着、位置、天气这类看得见的当前状态；用兴头那一档的模型（便宜）。
// 只看最近 20 条里还没读过的，一次至多 8 条；读过的记在这一局上（去复读改过的那条算读过）。
const stateBusy = new Set();
// 此刻的样子：备料（哪几条没读过、记下的样子、在场的人）和收结果分开写——单独调（runState）和并进"看一眼"（runGlance）共用同一份
function prepareState({ chatKey }) {
    const cfg = getConfig(), s = cfg.stages.scene;
    if (!cfg.state?.enabled || !s?.baseUrl || !s.apiKey || !s.model || stateBusy.has(chatKey)) return null;
    const chat = store.requireChat(chatKey);
    if (!chat.enabled) return null;
    const msgs = store.currentMessages(chatKey).filter(m => !m.hidden);
    const readKey = `state_read:${chat.story_id}`;
    let read = [];
    try { read = JSON.parse(store.getMeta(readKey) ?? '[]'); } catch {}
    const seen = new Set(read);
    const isRead = m => { let fp = m.fp; for (let i = 0; i < 4 && fp; i++) { if (seen.has(fp)) return true; fp = store.getMeta(`fresh_from:${fp}`); } return false; };
    const fresh = msgs.slice(-20).filter(m => !isRead(m)).slice(-8);
    if (!fresh.length || records.spentToday() >= cfg.extractor.dailyBudgetUsd) return null;
    const userName = [...msgs].reverse().find(m => m.is_user)?.name ?? null;
    const people = [...new Set(msgs.slice(-12).map(m => m.name).filter(Boolean))];
    const board = foldState(store.stateNotesOf(chatKey), undefined, { lastPos: msgs.at(-1)?.pos ?? null });
    const user = statePrompt({ board, messages: fresh.map(m => ({ n: m.pos, name: m.name ?? m.speaker, text: m.text })), people, userName, timeScale: scaleFor(store, chatKey) });
    // 收结果：正文里找得到原句、不在问句里的才收（N-279）
    // 发消息、打电话来的人那一条里写的是他那头（试玩 10/7：他在路口雨棚底下打来电话，"此地＝雨棚下"，场面表就当镜头在雨棚下）：
    // 他那条里的"此地"不收，他自己的位置照收
    const apply = list => {
        const byPos = new Map(fresh.map(m => [m.pos, m.fp])), textAt = new Map(fresh.map(m => [m.pos, m.text]));
        let arr = null;
        try { arr = JSON.parse(store.getMeta(`arrived:${chatKey}`) ?? 'null'); } catch {}
        const roster = (store.getCast(chat.story_id) ?? []).map(e => e.name);
        const here = dropRemoteHere(list.filter(x => byPos.has(x.n)), { remote: arr && isRemote(arr.how) ? arr : null, nameAt: n => fresh.find(m => m.pos === n)?.name, same: (a, b) => sameName(a, b, roster) });
        // 玩家的角色身上的东西只认玩家自己写的（用户 10/13：别的角色给她添的凝胶贴、脸色记成了她的样子）
        const kept = herOwnOnly(grounded(here, n => textAt.get(n)), { isUserAt: n => !!fresh.find(m => m.pos === n)?.is_user, isHer: w => !!userName && sameName(w, userName, roster), posOf: x => x.n });
        store.putStateNotes(chat.story_id, kept.map(x => ({ fp: byPos.get(x.n), who: x.who, aspect: x.aspect, text: x.text })));
        store.setMeta(readKey, JSON.stringify([...read, ...fresh.map(m => m.fp)].slice(-400)));
        return kept;
    };
    return { s, fresh, user, apply };
}
async function runState({ chatKey, prepared = null }) {
    const p = prepared ?? prepareState({ chatKey });
    if (!p) return;
    stateBusy.add(chatKey);
    const started = Date.now();
    try {
        const r = await createModelClient({ ...p.s, maxOutputTokens: 4000 }).complete({ system: STATE_SYSTEM, user: p.user });
        const costUsd = ((r.usage?.input ?? 0) * p.s.priceInPerM + (r.usage?.output ?? 0) * p.s.priceOutPerM) / 1e6;
        records.logAssemble({ chatKey, speaker: '(此刻的样子)', model: p.s.model, servedModel: r.servedModel, status: 'done', usage: r.usage, costUsd, ms: Date.now() - started, raw: r.text });
        const list = parseState(r.text);
        if (!list) throw new Error('state_bad_json');
        const kept = p.apply(list);
        log(`state ${chatKey}: ${p.fresh.length} read, ${kept.length} changed${list.length > kept.length ? ` (${list.length - kept.length} without a quote dropped)` : ''}, ${costUsd.toFixed(4)}`);
    } catch (error) {
        records.logAssemble({ chatKey, speaker: '(此刻的样子)', model: p.s.model, status: 'failed', usage: error.usage ?? null, ms: Date.now() - started, error: error.message });
        log(`state ${chatKey} failed: ${error.message}`);
    } finally { stateBusy.delete(chatKey); }
}

// 看一眼（core/glance.mjs，用户 10/16 定）：此刻的样子和兴头两眼都要看时并成一次调用；只有一眼要看、或者面板关了合并，照旧各调各的
async function runGlance({ chatKey }) {
    const cfg = getConfig();
    const merged = cfg.glance?.enabled !== false;
    if (!merged) await Promise.all([runState({ chatKey }).catch(() => {}), runScene({ chatKey }).catch(() => {})]);
    let st = null, sc = null, doubts = [];
    try { if (merged) st = prepareState({ chatKey }); } catch (error) { log(`state ${chatKey} failed: ${error.message}`); }
    try { if (merged) sc = prepareScene({ chatKey }); } catch (error) { log(`scene ${chatKey} failed: ${error.message}`); }
    // 第三眼：自动离场拿不准的那几位（auto.leaveDoubts），顺着这一次问；两眼都不用看时单独小问一次
    try { if (cfg.auto?.enabled && cfg.auto.leave) doubts = leaveDoubts(store, records, chatKey, { config: cfg }); } catch (error) { log(`leave doubts ${chatKey} failed: ${error.message}`); }
    if (!st && !sc && !doubts.length) return;
    if (!st && !doubts.length) return runScene({ chatKey, prepared: sc });
    if (!sc && !doubts.length) return runState({ chatKey, prepared: st });
    const s = cfg.stages.scene;
    if (!s?.baseUrl || !s.apiKey || !s.model || records.spentToday() >= cfg.extractor.dailyBudgetUsd) return;
    if (st) stateBusy.add(chatKey);
    if (sc) sceneBusy.add(chatKey);
    const started = Date.now();
    const msgs = store.currentMessages(chatKey).filter(m => !m.hidden);
    const userName = [...msgs].reverse().find(m => m.is_user)?.name ?? '玩家';
    try {
        const r = await completeGlance({ config: cfg, spentToday: records.spentToday(), state: st?.user ?? null, scene: sc?.user ?? null, doubts, messages: msgs, userName,
            complete: prompt => createModelClient({ ...s, maxOutputTokens: 8000 }).complete({ ...prompt, system: renderPronouns(extractSystem(prompt.system, promptOptionsFor(store, chatKey, cfg)), playerContext(store, chatKey)) }) });
        if (!r) return;
        const costUsd = ((r.usage?.input ?? 0) * s.priceInPerM + (r.usage?.output ?? 0) * s.priceOutPerM) / 1e6;
        records.logAssemble({ chatKey, speaker: '(看一眼)', model: s.model, servedModel: r.servedModel, status: 'done', usage: r.usage, costUsd, ms: Date.now() - started, raw: r.text });
        const got = parseGlance(r.text);
        if (st) {
            if (got.state) { const kept = st.apply(got.state); log(`state ${chatKey}: ${st.fresh.length} read, ${kept.length} changed${got.state.length > kept.length ? ` (${got.state.length - kept.length} without a quote dropped)` : ''} (看一眼)`); }
            else log(`state ${chatKey} failed: glance_state_bad_json`);
        }
        if (sc) {
            if (got.scene) { const imp = sc.apply(got.scene); if (imp) log(`scene ${chatKey} at ${sc.last.pos}: ${imp.kind} ${imp.who}${imp.to ? `→${imp.to}` : ''}——${imp.what}（${got.scene.why}） (看一眼) $${costUsd.toFixed(4)}`); }
            else log(`scene ${chatKey} failed: glance_scene_bad_json`);
        }
        if (doubts.length) {
            if (got.left) {
                const gone = answerLeaves(store, chatKey, doubts, got.left);
                for (const g of gone) { log(`auto ${chatKey}: ${g.who} 走了（看一眼：${g.why}）`); leave({ chatKey, who: g.who, avatar: g.avatar, anchor: g, how: g.how }).catch(() => {}); }
                if (!gone.length) log(`auto ${chatKey}: 本次没有确认离场，没判的保留复核`);
            } else log(`auto ${chatKey}: glance_left_bad_json`);
        }
    } catch (error) {
        records.logAssemble({ chatKey, speaker: '(看一眼)', model: s.model, status: 'failed', usage: error.usage ?? null, ms: Date.now() - started, error: error.message });
        log(`glance ${chatKey} failed: ${error.message}`);
    } finally { stateBusy.delete(chatKey); sceneBusy.delete(chatKey); }
}

// 场次摘要（episodes.mjs，N-284）：从头起连着写好摘要的那一条往后，攒够 EP_MIN 条（最近 EP_KEEP 条先不动，可能还会左滑、改）
// 就照原文分场写经过；用兴头那一档的模型（便宜）。中间有一段删了、改了，那段作废、从那里重写。一次至多 EP_MAX 条，没追上接着来。
// 最后一场还没收尾的先不存；同一处隔 EP_RETRY 条才再试（一场戏聊得很长时，别每来一条就花一次钱）。
const EP_MIN = 10, EP_KEEP = 4, EP_MAX = 36, EP_ROUNDS = 4, EP_RETRY = 6;
const episodeBusy = new Set();
// 有卡的人进场（N-292，用户 10/6）：扩展点了"进场"以后调。由头（来联系挑中的、口袋里的事、玩家点的名）＋他和玩家的关系＋到场前那几条
// → 便宜模型（兴头那一档）理出"怎么来的、为什么来、到场那一刻看得见什么"，记下，他进场后头两回开口时给他（slot.extrasFor）。
// 没配模型、超了当天预算、调不通：只记由头（那一格里写"看得见的照最后一段写的"）。他为什么来记一笔只他知道的心里话，往后问起答得上。
// 他离场了（D-169，用户 10/6）：照他走前那几句理出去向——要去办的事、大概多久、怎么回来；回来的时机、回来时这段时间干了什么都照它。
// 一次便宜模型（看场面那一档），在后台跑。没配模型也记下他走了（只按时段算什么时候能回来）。
// 他人到场了，去向用完：不删，记下是哪一次进场用掉的（arrival.validAwayPlan）——那次进场后他那条回复删了、换了别人在说，去向就回来（方案 删消息等于没发生过）
function dropAway(chatKey, who, by = null) {
    try {
        const plans = JSON.parse(store.getMeta(`away_plan:${chatKey}`) ?? '{}') ?? {};
        for (const k of Object.keys(plans)) if (plans[k]?.who === who) { if (by) plans[k] = { ...plans[k], dropped: by }; else delete plans[k]; }
        store.setMeta(`away_plan:${chatKey}`, JSON.stringify(plans));
    } catch {}
}
const leaving = new Map();
async function leave({ chatKey, who, avatar = null, anchor = null, how = null }) {
    const chat = store.requireChat(chatKey);
    const msgs = store.currentMessages(chatKey).filter(m => !m.hidden);
    const last = anchor ? msgs.find(m=>m.pos===anchor.at&&m.fp===anchor.fp) : msgs.at(-1);
    if (!last) return { ok: true };
    // 扩展点的"离场"和同步后看区间关上了（slot.advanceWorld ⑦）会前后脚都来：同一条消息上已经记过他的去向、或正在记，就不再问模型
    const key = `${chatKey}\u0001${who}\u0001${last.fp}`;
    if (leaving.has(key)) return leaving.get(key);
    try {
        const had = Object.values(JSON.parse(store.getMeta(`away_plan:${chatKey}`) ?? '{}') ?? {}).find(p => p?.who === who && p.fp === last.fp && p.at === last.pos + 1);
        if (had) return { ok: true, idempotent: true, ...had };
    } catch {}
    const work = leaveNow({ chat, chatKey, who, avatar, msgs: msgs.filter(m=>m.pos<=last.pos), last, how });
    leaving.set(key, work);
    try { return await work; } finally { leaving.delete(key); }
}
async function leaveNow({ chat, chatKey, who, avatar, msgs, last, how = null }) {
    const userName = [...msgs].reverse().find(m => m.is_user)?.name ?? '玩家';
    // 发消息、打电话来的人挂了：进场那一份用完了；他人一直在外头，离开从上一回出门算、去向接着用（这回说了新的就换成新的）
    let wasRemote = false;
    try { const arr = JSON.parse(store.getMeta(`arrived:${chatKey}`) ?? 'null'); if (arr?.who === who) { wasRemote = /电话|消息/.test(arr.how ?? '') && !metInPerson(msgs.filter(m => m.pos >= (arr.at ?? Infinity)), { who, userName: [...msgs].reverse().find(m => m.is_user)?.name ?? null, since: arr.at ?? Infinity, notes: store.stateNotesOf?.(chatKey) ?? [], others: (store.getCast(chat.story_id) ?? []).map(e => e.name) }); store.setMeta(`arrived:${chatKey}`, null); } } catch {}
    // 他这回的来意跟着离场过去（场记章程 B2）：挂在眼下这条上，删回去就回来
    try { const roster = (store.getCast(chat.story_id) ?? []).map(e => e.name); closeIntents({ records, chatKey, storyId: chat.story_id, who, fp: last.fp, same: (a, b) => sameName(a, b, roster) }); } catch {}
    let plans = {};
    try { plans = JSON.parse(store.getMeta(`away_plan:${chatKey}`) ?? '{}') ?? {}; } catch {}
    const before = wasRemote ? Object.values(plans).find(p => p?.who === who) ?? null : null;
    for (const k of Object.keys(plans)) if (plans[k]?.who === who) delete plans[k];
    const planKey=avatar ?? `name:${who}`;
    const minimal=before ?? {who,avatar,at:last.pos+1,fp:last.fp,how};
    plans[planKey]=minimal;
    store.setMeta(`away_plan:${chatKey}`,JSON.stringify(plans));
    const clean = stripper(getConfig().strip);
    const cfg = getConfig(), s = cfg.stages.scene;
    let plan = null;
    if (s?.baseUrl && s.apiKey && s.model && records.spentToday() < cfg.extractor.dailyBudgetUsd) {
        const started = Date.now();
        try {
            const r = await createModelClient({ ...s, maxOutputTokens: 1500 }).complete({ system: renderPronouns(LEAVE_SYSTEM, { ...playerContext(store, chatKey), person: who }),
                user: leavePrompt({ who, userName, messages: msgs.slice(-4).map(m => ({ name: m.speaker === 'narrator' ? '旁白' : (m.name ?? m.speaker), text: clean(m.text).slice(-1200) })) }) });
            const costUsd = ((r.usage?.input ?? 0) * s.priceInPerM + (r.usage?.output ?? 0) * s.priceOutPerM) / 1e6;
            records.logAssemble({ chatKey, speaker: '(离场)', model: s.model, servedModel: r.servedModel, status: 'done', usage: r.usage, costUsd, ms: Date.now() - started, raw: r.text });
            plan = parseLeave(r.text);
        } catch (error) {
            records.logAssemble({ chatKey, speaker: '(离场)', model: s.model, status: 'failed', usage: error.usage ?? null, ms: Date.now() - started, error: error.message });
        }
    }
    // 理去向期间原文可能已撤回、角色也可能又离场；迟到的结果不能盖回去。
    try { plans=JSON.parse(store.getMeta(`away_plan:${chatKey}`) ?? '{}') ?? {}; } catch { plans={}; }
    if (!store.currentMessages(chatKey).some(m=>!m.hidden&&m.fp===last.fp&&m.pos===last.pos)
        || plans[planKey]?.fp!==minimal.fp) return {ok:true,revoked:true};
    const enrichment=before && !plan?.errands?.length ? {} : (plan ?? {});
    plans[planKey]={...minimal,...enrichment,at:minimal.at,fp:minimal.fp};
    store.setMeta(`away_plan:${chatKey}`,JSON.stringify(plans));
    log(`leave ${chatKey} ${who}: ${plan ? `${plan.errands.length} errand(s), ${plan.span}, ${plan.back}` : 'no plan'}`);
    return { ok: true, ...(plan ?? {}) };
}

// unanswered（waiting.mjs，用户 10/9）：他找过玩家、门上一直没人接——这回专为它结算（不受"一个时段一回"管，次数由 waiting 管）
const settling = new Set();
async function settleAway({ chatKey, who, avatar = null, reason = '换时段', unanswered = null }) {
    const chat = store.requireChat(chatKey), messages = store.currentMessages(chatKey), last = messages.at(-1);
    if (!last) return { ok: true, skipped: true };
    // 人名认成名册里的写法（试玩 10/12：等着没人接那条路用短名记下"要来联系"，名册里是全名——后来他进了场、用掉了都认不出，那条一直挂着）
    {
        const castRows = store.getCast?.(chat.story_id) ?? [], names = castRows.map(c => c.name);
        let rel = null; try { const raw = store.relationsOf?.(chat.story_id); rel = raw ? normalizeRelations(raw) : null; } catch {}
        // 同一个人在名册里有两条（全名、旧卡名的短名）：认用户建的那条
        const hit = (list => (l => l.find(x => x.set_by === 'user') ?? l.find(x => Number.isFinite(x.bond)) ?? l[0] ?? list[0])(list.filter(x => x.role !== '不用')))(castRows.filter(c => c.name === who || sameName(c.name, who, names) || (!!rel && !!personOf(rel, who, names) && personOf(rel, who, names) === personOf(rel, c.name, names))));
        if (hit) { who = hit.name; avatar = avatar ?? hit.avatar ?? null; }
    }
    // 没人接的那一回：从等的那条起他自己进了场（landing.enteredSince），这回就不算了（waiting 已经拦过，排队期间进场的再拦一道）
    if (unanswered?.since) {
        let anchors = null, arrivals = [];
        try { anchors = JSON.parse(chat.anchors ?? 'null'); } catch {}
        try { arrivals = JSON.parse(store.getMeta(`arrivals:${chatKey}`) ?? '[]') ?? []; } catch {}
        if (enteredSince(unanswered.since.pos, { who, avatar, messages, anchors, arrivals })) return { ok: true, skipped: true, entered: true };
    }
    const tl = timelineFor(store, records, chatKey, messages);
    let settled = null;
    try { settled = JSON.parse(store.getMeta(`settled:${chatKey}:${who}`) ?? 'null'); } catch {}
    if (!unanswered && settled && settled.fp && messages.some(m => m.pos === settled.pos && m.fp === settled.fp)
        && settled.day === tl.today && settled.part === tl.part) return { ok: true, skipped: true, idempotent: true };
    const busyKey = `${chatKey}\u0001${who}`;
    if (settling.has(busyKey)) return { ok: true, skipped: true, busy: true };
    settling.add(busyKey);
    try { return await settleOnce({ chat, chatKey, messages, last, tl, who, avatar, unanswered }); } finally { settling.delete(busyKey); }
}
async function settleOnce({ chat, chatKey, messages, last, tl, who, avatar, unanswered }) {
    // 开局单里开场不在场的那份去向也算（opening.mjs）：结算写回时一起存下，之后就是记下的去向
    const plans = awayPlansOf(store, chatKey, { messages });
    const plan = Object.values(plans).find(p => p?.who === who || p?.avatar === avatar);
    const board = boardFor(store, records, chatKey, { present: [], timeline: tl });
    const person = board.people.find(p => p.name === who);
    const pending = pendingFor(store, records, chatKey, { present: [], timeline: tl });
    const errands = pending.items.filter(i => i.owner === who && i.kind === '去办' && ['排着', '到了'].includes(i.status));
    const waits = pending.items.filter(i => i.owner === who && i.kind === '等回音' && i.status === '等着');
    const left = person?.since ?? plan?.at ?? last.pos;
    const row = tl.rows.find(r => r.pos === left - 1) ?? tl.rows.find(r => r.pos === left) ?? null;
    const span = awaySpan(row, tl.rows.at(-1) ?? { day: tl.today, part: tl.part }, tl.scale);
    const clean = stripper(getConfig().strip);
    const leaving = messages.filter(m => m.pos >= left - 2 && m.pos < left && !m.hidden).map(m => `${m.speaker === 'narrator' ? '旁白' : (m.name ?? m.speaker)}：${clean(m.text).slice(-300)}`).join(' ／ ');
    // 读卡写的"兴趣和习惯"（不是整张卡的原文）
    const profile = store.profileOf?.(avatar)?.text ?? '';
    const rawRel = store.relationsOf?.(chat.story_id), roster = (store.getCast(chat.story_id) ?? []).map(e => e.name);
    const rel = rawRel ? normalizeRelations(rawRel) : null, userName = [...messages].reverse().find(m => m.is_user)?.name ?? '玩家';
    const tie = rel ? personOf(rel, who, roster)?.关系?.find(r => sameName(r.对, userName, roster))?.是 ?? '' : '';
    // 没人接的那一回：他怎么找的、等了多久；他和别人约好的事；玩家此刻在哪、身边有谁；别的有卡的人此刻在哪（他找过去会不会碰上约他的人）
    // 名字照关系表认（记账里写"V"、名册里是全名）：不然他和玩家两人之间的小约定会当成有第三个人
    const sameP = (a, b) => sameName(a, b, roster) || (!!rel && !!personOf(rel, a, roster) && personOf(rel, a, roster) === personOf(rel, b, roster));
    // 镜头外接着办（用户 10/12，N-363：角色没有自己的驱动，和没后台时一样）：原来没有待办（去办、等回音）就不结算；
    // 他是主角团的人、最新一份规划里有他的"下一步"、这一格时间里还没替他按打算推过，也跑一次，把他自己的打算交给结算。
    // 每人每格时间至多一次（crew.crewPushDue），别多花钱；不是主角团的人照旧
    const { plan: lastPlan, node } = latestNode(store, chatKey);
    const ownEntry = crewEntry(node, who, sameP);
    const ownDue = crewPushDue({ who, userName, crew: crewOf(store.setupOf?.(chat.story_id)?.data ?? null, node, userName), entry: ownEntry, pushed: pushedMeta(store, chatKey, who), today: tl.today, messages, same: sameP });
    if (!errands.length && !waits.length && !unanswered && !ownDue) return { ok: true, skipped: true };
    const own = ownDue ? { want: String(ownEntry.想干 ?? '').trim(), next: String(ownEntry.下一步 ?? '').trim() } : null;
    const rowAt = pos => tl.rows.find(r => r.pos === pos) ?? tl.rows.filter(r => r.pos <= pos).at(-1) ?? null;
    const unans = unanswered ? [unansweredLine(unanswered, { userName, span: awaySpan(rowAt(unanswered.since?.pos ?? last.pos), tl.rows.at(-1) ?? { day: tl.today, part: tl.part }, tl.scale) + `（隔了 ${last.pos - (unanswered.since?.pos ?? last.pos)} 条消息）` })] : [];
    const promises = unanswered ? promisesFor(pending.items, { who, userName, same: sameP, plans: Object.values(plans).map(p => validAwayPlan(p, messages)).filter(Boolean) }) : [];
    const spot = unanswered ? placeNow(store.stateNotesOf?.(chatKey) ?? [], { lastPos: last.pos, sameDay: pos => (tl.rows.filter(r => r.pos <= pos).at(-1)?.day ?? tl.today) === tl.today, fallback: board.camera?.from === 'state' || board.camera?.from === 'mark' ? board.camera.place ?? '' : '' }) : '';
    const here = unanswered ? [spot && `在${spot}`, (p => (p.length ? `身边有${p.join('、')}` : '身边没别人'))(board.people.filter(p => ['present', 'remote'].includes(p.status) && p.name !== CAMERA_NAME).map(p => p.name))].filter(Boolean).join('，') : '';
    const around = unanswered ? board.people.filter(p => p.card && p.name !== who && p.name !== CAMERA_NAME && ['away', 'absent'].includes(p.status) && (p.place || p.plan?.doing || p.plan?.errands?.length))
        .slice(0, 6).map(p => `${p.name}：${p.place || p.plan?.doing || (p.plan.errands ?? []).map(e => e?.text ?? e).join('；')}`) : [];
    const cfg = getConfig(), s = cfg.stages.scene;
    if (!s?.baseUrl || !s.apiKey || !s.model || records.spentToday() >= cfg.extractor.dailyBudgetUsd) return { ok: true, skipped: true };
    const started = Date.now();
    try {
        const r = await createModelClient({ ...s, maxOutputTokens: 1500 }).complete({ system: renderPronouns(SETTLE_SYSTEM, { ...playerContext(store, chatKey), person: who }), user: settlePrompt({ who, userName, span, leaving, errands, waits, profile, tie, place: person?.place ?? '', unanswered: unans, promises: promises.map(p => p.text), here, around, own }) });
        const costUsd = ((r.usage?.input ?? 0) * s.priceInPerM + (r.usage?.output ?? 0) * s.priceOutPerM) / 1e6;
        records.logAssemble({ chatKey, speaker: '(结算)', model: s.model, servedModel: r.servedModel, status: 'done', usage: r.usage, costUsd, ms: Date.now() - started, raw: r.text });
        const got = parseSettle(r.text); if (!got) return { ok: false };
        const fp = last.fp;
        // 他按自己的打算办到哪：落成他自己的一条（照去办的落法），下次露面那一格里带着（slot 的主角团那一块）；
        // 这一格时间记一笔推过了——结算没写"打算"也算推过，别再花一回
        if (own) {
            if (got.own) records.addDerived({ storyId: chat.story_id, fp, type: '做', text: pushText(who, ownEntry, got.own), holder: avatar ?? `name:${who}`, holderName: who, audience: [who], about: who });
            store.setMeta(pushKey(chatKey, who), JSON.stringify({ day: tl.today, pos: last.pos, fp, plan: lastPlan?.id ?? null }));
        }
        for (const e of got.errands) {
            const item = errands.find(x => x.text === e.text); if (!item) continue;
            records.addDerived({ storyId: chat.story_id, fp, type: '做', text: `${who}这段时间：${e.note}`, holder: avatar ?? `name:${who}`, holderName: who, audience: [who], about: who });
            for (const [key, p] of Object.entries(plans)) if (p?.who === who) p.errands = (p.errands ?? []).map(x => (x?.text ?? x) === e.text ? { text: e.text, done: e.result, note: e.note, settled: { pos: last.pos, fp } } : x);
        }
        if (got.home && homeChanged(lifeSheet(records.visible(chatKey).filter(r => r.holder_name === who || (r.audience ?? []).includes(who)), { same: (a, b) => sameName(a, b, roster) }).people.find(p => sameName(p.name, who, roster))?.home ?? '', [leaving, ...errands.map(e => e.text)])) records.addDerived({ storyId: chat.story_id, fp, type: '改变', text: `${who}换了住处：${got.home}`, holder: avatar ?? `name:${who}`, holderName: who, audience: [who], about: who, life: { who, kind: '住处', now: got.home, gone: '' }, duration: '直到被改变' });
        if (got.mind) records.addDerived({ storyId: chat.story_id, fp, type: '心里', text: `${who}这段时间心里：${got.mind}`, holder: avatar ?? `name:${who}`, holderName: who, audience: [who], about: who });
        for (const w of got.waits) {
            const item = waits.find(x => x.text === w.text); if (!item) continue;
            records.addDerived({ storyId: chat.story_id, fp, type: '心里', text: `${who}等回音没等到：${w.note}`, holder: avatar ?? `name:${who}`, holderName: who, audience: [who], about: who });
            if (w.result === '放下') records.addDerived({ storyId: chat.story_id, fp, type: '改变', duration: '几天', text: `${who}把这件事放下了：${w.note}`, holder: avatar ?? `name:${who}`, holderName: who, audience: [who], about: who });
        }
        store.setMeta(`away_plan:${chatKey}`, JSON.stringify(Object.fromEntries(Object.entries(plans).filter(([, p]) => !p?.seed || p.who === who))));
        // 刚走没多久（同一格里，span 以"同一"开头）、不是没人接那种、他走时说的事还没到办的时候：结算说要联系也先按下——记成他心里的，不挂门上
        // （试玩 10/11：他下午刚道别说明天复查，过了一个时段就又发消息问药劲散没散；两条消息前才分开，不像人）
        const justLeft = !unanswered && /^同一/.test(span) && !(got.errands ?? []).some(e => e.result === '办了');
        // 不为问身子上门（用户 10/12，方案 叙事节奏与防棘轮 第四节；body.mjs）：要联系的来意是问她身子的，而她最近几条没提身子（或说已经好了）——
        // 照上面"刚分开先按下"的做法记成他心里惦记的，不挂门上；没人接的那一回照旧由下面管
        const gate = bodyGate({ messages, userName });
        const herAliases = rel ? (p => (p ? [p.名, ...(p.又名 ?? [])].filter(Boolean) : []))(personOf(rel, userName, roster)) : [];
        const bodyHold = !unanswered && holdBodyContact({ contact: got.contact, gate, userName, aliases: herAliases });
        if (got.contact?.way !== '不' && justLeft) records.addDerived({ storyId: chat.story_id, fp, type: '心里', text: `${who}想过要${got.contact.way === '上门' ? '过去一趟' : got.contact.way === '电话' ? '打个电话' : '发条消息'}（${String(got.contact.text ?? '').slice(0, 80)}），想想刚分开没多久，先按下了`, holder: avatar ?? `name:${who}`, holderName: who, audience: [who], about: who });
        else if (bodyHold) records.addDerived({ storyId: chat.story_id, fp, type: '心里', text: heldContactText({ who, way: got.contact.way, userName, gate }), holder: avatar ?? `name:${who}`, holderName: who, audience: [who], about: who });
        else if (got.contact?.way !== '不') store.setMeta(`settled_contact:${chatKey}:${who}`, JSON.stringify({ way: got.contact.way, text: got.contact.text, at: last.pos, fp, used: false }));
        // 没人接的那一回（waiting.mjs）：再找（发消息、打电话、找上门）→ 门上换成这一回的；放下 → 门上那一项收起（挂在这一条上，删回去就回来）
        if (unans.length) {
            const u = unans[0];
            const said = got.waits.find(w => w.text === u.text || u.text.includes(w.text) || w.text.includes(u.text.slice(0, 24))) ?? null;
            const result = said?.result ?? (got.contact?.way && got.contact.way !== '不' ? '再联系' : '还等');
            const note = said?.note || got.contact?.text || '';
            if (result === '再联系' || result === '上门') {
                const way = result === '上门' ? '上门' : got.contact?.way && got.contact.way !== '不' ? got.contact.way : u.how === '打来电话' ? '电话' : '消息';
                const pull = way === '上门' ? pullOf(got.pull, promises) : null;
                // 他头一回找的那件（门上挂着的口袋、上一回结算写的联系）跟着走：进场时前台知道他先前说过什么、为什么又来
                const src = unanswered.item?.source;
                let earlier = null;
                if (src?.type === 'pocket') { const m = store.menuOf(chatKey).find(x => x.id === Number(src.id)); if (m) earlier = { way: u.how === '打来电话' ? '电话' : '消息', title: m.title ?? '', surface: m.surface ?? '', respond: m.respond ?? '' }; }
                if (src?.type === 'contact') { try { earlier = JSON.parse(store.getMeta(`settled_contact:${chatKey}:${who}`) ?? 'null')?.earlier ?? null; } catch {} }
                store.setMeta(`settled_contact:${chatKey}:${who}`, JSON.stringify({ way, text: (got.contact?.way !== '不' && got.contact?.text) || note, at: last.pos, fp, used: false, from: 'unanswered', ...(pull ? { pull } : {}), ...(earlier?.surface ? { earlier } : {}) }));
                records.addDerived({ storyId: chat.story_id, fp, type: '心里', text: `${who}找过${userName}没人接，又${way === '上门' ? '找上门去' : way === '电话' ? '打了电话' : '发了一条'}：${note}`.slice(0, 200), holder: avatar ?? `name:${who}`, holderName: who, audience: [who], about: who });
            } else if (result === '放下') {
                const src = unanswered.item?.source;
                if (src?.type === 'pocket' && Number.isInteger(Number(src.id))) store.updateMenu(chatKey, Number(src.id), { status: 'sunk', at: { pos: last.pos, fp } });
                if (src?.type === 'contact') { try { const c = JSON.parse(store.getMeta(`settled_contact:${chatKey}:${who}`) ?? 'null'); if (c) store.setMeta(`settled_contact:${chatKey}:${who}`, JSON.stringify({ ...c, used: true, usedAt: { pos: last.pos, fp } })); } catch {} }
                records.addDerived({ storyId: chat.story_id, fp, type: '改变', duration: '几天', text: `${who}找过${userName}没人接，先放下了：${note}`.slice(0, 200), holder: avatar ?? `name:${who}`, holderName: who, audience: [who], about: who });
            }
            log(`settle ${chatKey} ${who} (没人接 #${u.n}): ${result}${got.pull ? `；顺带：${got.pull.promise.slice(0, 30)}` : ''}`);
        }
        store.setMeta(`settled:${chatKey}:${who}`, JSON.stringify({ day: tl.today, part: tl.part, pos: last.pos, fp }));
        return { ok: true, ...got };
    } catch (error) {
        records.logAssemble({ chatKey, speaker: '(结算)', model: s.model, status: 'failed', ms: Date.now() - started, error: error.message });
        return { ok: false };
    }
}

// 镜头外的回话（offstage.mjs，用户 10/8："我跟他撒了谎，扭曲了某人的原话，那么他其实可以自己和某人求证，并双方都对此求证过程知情"）：
// 在场的有卡的人隔着消息、电话问不在场的有卡的人（advanceWorld ③丙 认出来的），替那人照他知道的回一句；问和答记成两条，两边都知道；
// 回话挂在问的人身上，他下一回开口带上。便宜模型（兴头那一档）。
async function askAway({ chatKey, pos, fp, asker, askerAvatar, target, targetAvatar, way, text }) {
    const cfg = getConfig(), s = cfg.stages.scene;
    if (!cfg.offstage?.enabled || !cfg.offstage?.ask || !s?.baseUrl || !s.apiKey || !s.model || records.spentToday() >= cfg.extractor.dailyBudgetUsd) return { ok: true, skipped: true };
    const chat = store.requireChat(chatKey);
    const messages = store.currentMessages(chatKey);
    if (!messages.some(m => m.pos === pos && m.fp === fp)) return { ok: true, skipped: true };
    const visible = records.visible(chatKey);
    const head = `${asker}（${way}）问${target}：`;
    if (visible.some(r => r.fp === fp && String(r.text).startsWith(head))) return { ok: true, skipped: true, idempotent: true };
    const roster = store.getCast(chat.story_id) ?? [], names = roster.map(e => e.name);
    const rawRel = store.relationsOf(chat.story_id);
    const rel = rawRel ? normalizeRelations(rawRel) : null;
    const tie = rel ? personOf(rel, target, names)?.关系?.find(r => sameName(r.对, asker, names))?.是 ?? '' : '';
    const profile = store.profileOf?.(targetAvatar)?.text ?? '';
    const tl = timelineFor(store, records, chatKey, messages);
    const dayOf = p => tl.rows.filter(r => r.pos <= p).at(-1)?.day ?? 0;
    const known = knownFor(visible, { name: target, text, roster, when: r => relativeDay(tl.today - dayOf(r.pos), tl.scale) });
    let where = '';
    try { where = boardFor(store, records, chatKey, { present: [], timeline: tl }).people.find(p => sameName(p.name, target, names))?.place ?? ''; } catch {}
    const started = Date.now();
    try {
        const r = await createModelClient({ ...s, maxOutputTokens: 1000 }).complete({ system: renderPronouns(ASK_SYSTEM, { ...playerContext(store, chatKey), person: target }), user: askPrompt({ asker, target, way, text, tie: String(tie).slice(0, 200), profile, known, where }) });
        const costUsd = ((r.usage?.input ?? 0) * s.priceInPerM + (r.usage?.output ?? 0) * s.priceOutPerM) / 1e6;
        records.logAssemble({ chatKey, speaker: '(镜头外回话)', model: s.model, servedModel: r.servedModel, status: 'done', usage: r.usage, costUsd, ms: Date.now() - started, raw: r.text });
        const got = parseAsk(r.text);
        if (!got) return { ok: false };
        for (const d of exchangeRecords({ ask: { fp, asker, askerAvatar, target, targetAvatar, way, text }, reply: got.reply, aside: got.aside })) records.addDerived({ storyId: chat.story_id, ...d });
        store.setMeta(`offstage_reply:${chatKey}:${asker}`, JSON.stringify({ pos, fp, target, way, reply: got.reply, aside: got.aside, at: messages.at(-1)?.pos ?? pos, used: false }));
        log(`askAway ${chatKey}: ${asker} → ${target} (${way}) ${costUsd.toFixed(4)}`);
        return { ok: true, ...got };
    } catch (error) {
        records.logAssemble({ chatKey, speaker: '(镜头外回话)', model: s.model, status: 'failed', usage: error.usage ?? null, ms: Date.now() - started, error: error.message });
        log(`askAway ${chatKey} failed: ${error.message}`);
        return { ok: false };
    }
}

// 旁白一写到他就先理（D-169，试玩 10/6：理一次要 50 秒，中间那层 30 秒就放弃了，他没等到就开口、用了已经删掉的旧的那份）：
// prepare 只理不进场，存着；玩家点"进场"时，写着他出现的还是那一条就直接用，正在理的就等它。
const arriving = new Map();
// 拉进来的人其实没走开：刚移出就拉回来，或者他只跟着别人出现、带他的人眼下就在群里
function rejoined(chat, { avatar, who, len }) {
    let anchors = null, members = [];
    try { anchors = JSON.parse(chat.anchors ?? 'null'); } catch {}
    if (avatar && justLeft(anchors, avatar, len)) return true;
    try { members = JSON.parse(chat.members ?? '[]') ?? []; } catch {}
    const cast = store.getCast(chat.story_id) ?? [], names = cast.map(e => e.name);
    const raw = store.relationsOf(chat.story_id), rel = raw ? normalizeRelations(raw) : null;
    const lead = rel ? leaderOf(rel, who, names) : null;
    const leadAv = lead ? cast.find(e => sameName(e.name, lead, names))?.avatar : null;
    return !!leadAv && members.some(m => m?.avatar === leadAv) && openNow(anchors, leadAv);
}

// anchor（叩门，auto.mjs）：他那条已经落在 anchor.at 上了，进场挂在它前一条（fp）上、他从那条起在场；knock＝候着（上门的去向先不清，玩家回应了再清）
async function arrive({ chatKey, who, avatar = null, prepare = false, mode = 'come', way = '', anchor = null, knock = false }) {
    const chat = store.requireChat(chatKey);
    const all = store.currentMessages(chatKey);
    const msgs = anchor ? all.filter(m => m.pos < Number(anchor.at)) : all;
    const tip = msgs.at(-1);
    if (anchor && (!tip || tip.fp !== anchor.fp)) return { ok: false, why: '叩门挂的那条没了' };
    // 刚移出就原地拉回来（用户 10/14："不小心把人移出群聊，再原地拉回来就接不上戏了"）：他没走开——不理进场那份、不编"这段时间"、不当他从外头来；
    // 跟着别人出现的人（关系表"跟着"），带他的人眼下就在群里，也一样（他只能跟着那人，不会自己上门）
    if (mode === 'come' && rejoined(chat, { avatar, who, len: (tip?.pos ?? -1) + 1 })) return { ok: true, skipped: 'rejoin' };
    const key = `${chatKey}\u0001${who}\u0001${tip?.fp ?? ''}\u0001${mode}\u0001${way}`;
    let brief = null;
    try { brief = JSON.parse(store.getMeta(`arrival_brief:${chatKey}`) ?? 'null'); } catch {}
    // 先理好的那份认人、认那一条、也认方式（"你去找他"和"他过来"理出来的不一样）
    // 叩门提前理的那份（knock）：隔了几条也认——怎么来的、为什么来、看得见什么几条之内不会变，省得时机到了再等几十秒
    const briefNear = brief?.knock && Number.isFinite(Number(brief.pos)) && (tip?.pos ?? 0) >= Number(brief.pos) && (tip?.pos ?? 0) - Number(brief.pos) <= 6;
    if (brief && !(brief.who === who && (brief.mode ?? 'come') === mode && (brief.fp === (tip?.fp ?? '') || briefNear))) brief = null;
    if (prepare && (brief || arriving.has(key))) return { ok: true, prepared: true };
    if (!prepare && !brief && arriving.has(key)) { await arriving.get(key).catch(() => {}); return arrive({ chatKey, who, avatar, mode, way }); }
    let offer = null;
    try { offer = JSON.parse(store.getMeta(`arrival_offer:${chatKey}`) ?? 'null'); } catch {}
    // 门上点进来的（D-175）：由头取门的名单里他那一项；结算写的联系照旧算 settle（进场后标用掉）
    if (!offer) {
        try {
            const item = doorFor(store, records, chatKey, { present: [], recentUser: '', timeline: timelineFor(store, records, chatKey, msgs) }).items.find(i => sameName(i.who, who, (store.getCast(chat.story_id) ?? []).map(e => e.name)));
            // sent：旁白替他递过的那条消息、来电（场记章程 B1），进场那份接着这条说
            if (item) offer = { who: item.who, avatar: item.avatar, why: item.reason ?? '', way: '', from: item.source?.type === 'contact' ? 'settle' : item.source?.type ?? 'user', lines: item.lines ?? [], sent: item.sent ?? null, earlier: item.earlier ?? null };
        } catch {}
    }
    if (!offer && mode !== 'come') offer = { who, avatar, why: '', way: '', from: 'user', lines: [] };
    // 玩家去找他：他在原地；远程：说好了是消息还是电话，模型答"上门"也不算
    if (offer && mode === 'go') offer = { ...offer, why: [`玩家去找${who}`, offer.lines?.[0], offer.from === 'settle' ? '' : offer.why].filter(Boolean).join('；'), way: '' };
    if (offer && mode === 'remote') offer = { ...offer, way: /电话/.test(way) ? '打来电话' : /消息/.test(way) ? '发来消息' : /电话|消息/.test(offer.way ?? '') ? offer.way : '发来消息' };
    const roster = (store.getCast(chat.story_id) ?? []).map(e => e.name);
    if (offer && !sameName(offer.who, who, roster)) offer = null;
    const userName = [...msgs].reverse().find(m => m.is_user)?.name ?? '玩家';
    const raw = store.relationsOf(chat.story_id);
    const rel = raw ? normalizeRelations(raw) : null;
    const me = rel ? personOf(rel, who, roster) : null, you = rel ? personOf(rel, userName, roster) : null;
    const tie = me?.关系?.find(r => sameName(r.对, userName, roster) || (you && personOf(rel, r.对, roster) === you))?.是 ?? '';
    let board = null; try { board = boardFor(store, records, chatKey, { recentUser: '', present: [], timeline: timelineFor(store, records, chatKey, store.currentMessages(chatKey)) }); } catch {}
    const place = board?.camera?.place ?? foldState(store.stateNotesOf(chatKey)).filter(n => n.aspect === '位置' && sameName(n.who, userName, roster)).map(n => n.text)[0] ?? '';
    // 他上一回离场以后（N-294，用户 10/6：他说去找房，回来时找没找到没人记）：离开时那两句、过了多久、他手上还开着的事、他住哪——
    // 让同一次便宜模型顺带写出这段时间他干了什么（换了住处就写新住处）。第一次进场没有这一段。
    const clean = stripper(getConfig().strip);
    let away = null;
    try {
        const boardPerson = board?.people?.find(p => sameName(p.name, who, roster));
        const left = boardPerson?.since ?? lastLeave(JSON.parse(chat.anchors ?? 'null'), avatar, (msgs.at(-1)?.pos ?? 0) + 1);
        if (left != null) {
            const tlNow = timelineFor(store, records, chatKey, msgs);
            const rows = new Map(tlNow.rows.map(r => [r.pos, r]));
            const visible = records.visible(chatKey).filter(r => r.holder_name === who || (r.audience ?? []).includes(who));
            const openIds = new Set(records.openIdeas(chatKey).map(r => r.id));
            const matters = [...visible.filter(r => r.holder_name === who && openIds.has(r.id)).slice(-4).map(r => r.text),
                ...store.menuOf(chatKey).filter(m => (m.goer === who || m.who === who) && m.errand && (m.status === 'waiting' || m.status === 'pocket')).map(m => m.errand)].slice(0, 6);
            const home = lifeSheet(visible, { same: (a, b) => sameName(a, b, roster) }).people.find(p => sameName(p.name, who, roster))?.home ?? '';
            let plan = boardPerson?.plan ?? null;
            if (!boardPerson) try { plan = Object.values(JSON.parse(store.getMeta(`away_plan:${chatKey}`) ?? '{}') ?? {}).find(p => p?.who === who && p.errands) ?? null; } catch {}
            // span 是给模型看的一句话（"同一天，早上走的，现在下午"），不是场面表的 stage；stage 另带着
            let contact = null; try { contact = JSON.parse(store.getMeta(`settled_contact:${chatKey}:${who}`) ?? 'null'); } catch {}
            // 写下这条以后他已经自己进过场（landing.enteredSince 认隔离区间、进场记录）：过时了，不当"他想说的"给
            try { if (contact?.at != null && enteredSince(contact.at, { who, avatar, messages: msgs, anchors: JSON.parse(chat.anchors ?? 'null'), arrivals: JSON.parse(store.getMeta(`arrivals:${chatKey}`) ?? '[]') ?? [] })) contact = null; } catch {}
            // 结算替他记下的（住处、心里、放下了什么）当事实给；去办的那几件 away.plan 上已经带着结果，不重复
            const settled = visible.filter(r => r.holder_name === who && ['改变', '心里'].includes(r.type) && r.pos >= left).map(r => r.text).filter(Boolean).slice(-6);
            away = { from: left, span: awaySpan(rows.get(left - 1) ?? rows.get(left), rows.get(msgs.at(-1)?.pos), tlNow.scale), stage: boardPerson?.stage ?? null, home, plan, contact, settled,
                leaving: msgs.filter(m => m.pos >= left - 2 && m.pos < left && !m.hidden).map(m => `${m.speaker === 'narrator' ? '旁白' : (m.name ?? m.speaker)}：${clean(m.text).slice(-300)}`).join(' ／ '), matters };
        }
    } catch {}
    const cfg = getConfig(), s = cfg.stages.scene;
    let got = brief?.got ?? null;
    const think = async () => {
        const user = arrivalPrompt({ who, userName, reason: offer?.from === 'settle' && mode !== 'go' ? `他这回来是为了说：${offer?.why ?? ''}` : (offer?.why ?? ''), tie: String(tie).slice(0, 200), place, away, way: offer?.way ?? '',
            mode, sent: offer?.sent ?? null, messages: msgs.slice(-8).filter(m => !m.hidden).map(m => ({ name: m.speaker === 'narrator' ? '旁白' : (m.name ?? m.speaker), text: clean(m.text).slice(-1200) })) });
        const started = Date.now();
        try {
            const r = await createModelClient({ ...s, maxOutputTokens: 1500 }).complete({ system: renderPronouns(ARRIVAL_SYSTEM, { ...playerContext(store, chatKey), person: who }), user });
            const costUsd = ((r.usage?.input ?? 0) * s.priceInPerM + (r.usage?.output ?? 0) * s.priceOutPerM) / 1e6;
            records.logAssemble({ chatKey, speaker: '(进场)', model: s.model, servedModel: r.servedModel, status: 'done', usage: r.usage, costUsd, ms: Date.now() - started, raw: r.text });
            return parseArrival(r.text);
        } catch (error) {
            records.logAssemble({ chatKey, speaker: '(进场)', model: s.model, status: 'failed', usage: error.usage ?? null, ms: Date.now() - started, error: error.message });
            return null;
        }
    };
    // 结算把这段时间都算过了（去办的件件有结果、手上没开着的事）、又是发消息／打电话来的：进场那份不用再问模型——他看不见这屋里，来由就是结算写的那句
    const fullySettled = !!away?.plan?.errands?.length && away.plan.errands.every(e => e?.done) && !away.matters?.length && /电话|消息/.test(offer?.way ?? '');
    const working = !brief && !fullySettled && (s?.baseUrl && s.apiKey && s.model && records.spentToday() < cfg.extractor.dailyBudgetUsd) ? think() : null;
    if (working) {
        arriving.set(key, working);
        try { got = await working; } finally { arriving.delete(key); }
        store.setMeta(`arrival_brief:${chatKey}`, JSON.stringify({ who, fp: tip?.fp ?? '', mode, got, ...(knock ? { knock: true, pos: tip?.pos ?? 0 } : {}) }));
    }
    if (prepare) { log(`arrive ${chatKey} ${who}: prepared ${got ? 'brief' : 'no brief'}`); return { ok: true, prepared: true }; }
    const at = (msgs.at(-1)?.pos ?? -1) + 1;   // 他从下一条起在场（叩门的：就是他那条）
    // 递的时候说好了是发消息、打电话来的（结算定的、玩家点名叫的），模型答"上门"也不算：旁白写的是终端响了，他不能这一条就走进屋（D 副本假模型 10/7 撞到）
    const offeredHow = /电话/.test(offer?.way ?? '') ? '电话' : /消息/.test(offer?.way ?? '') ? '消息' : '';
    const arr = { who, avatar, at, fp: tip?.fp ?? null, how: offeredHow || got?.how || '', why: got?.why || (offer?.from === 'settle' ? `他这回来是为了说：${offer?.why ?? ''}` : offer?.why || ''), saw: got?.saw ?? '', meanwhile: away && !fullySettled ? got?.meanwhile ?? '' : '', where: got?.where ?? '', from: offer?.from ?? 'user',
        // 他刚发过、打过的那条（场记章程 B1）：他头两回开口那一格带上（arrivedLines），接着这件说、不重发
        ...(offer?.sent?.surface ? { sent: { way: offer.sent.way, surface: offer.sent.surface, respond: offer.sent.respond ?? '' } } : {}),
        // 没人接又来找的：头一回那条（没递到玩家眼前，或者玩家没理）
        ...(offer?.earlier?.surface ? { earlier: { way: offer.earlier.way, surface: offer.earlier.surface, respond: offer.earlier.respond ?? '' } } : {}) };
    // 结算写的这一回带着"顺带"（waiting.mjs）：他人找上门来，约他的那人正好在——顺便把约好的那件提前到眼下（只认人真到了的）
    let pull = null;
    if (offer?.from === 'settle' && !offeredHow && !/电话|消息/.test(arr.how)) {
        try { pull = JSON.parse(store.getMeta(`settled_contact:${chatKey}:${who}`) ?? 'null')?.pull ?? null; } catch {}
        if (pull?.with) arr.why = [arr.why, `顺便：${pull.with}约他的那件（${pull.text}），人既然到了这儿，想就在眼下当面说开`].filter(Boolean).join('；');
    }
    store.setMeta(`arrived:${chatKey}`, JSON.stringify(arr));
    // 每次进场挂在哪条后面（at、那条的指纹）：删回去重来以后，隔离扩展还开着的区间对不上哪次还算数的进场，场面表就不认它
    // 带上怎么来的、在哪：场面表按各人自己最近一次进场认远程（"刚进场的"只有一份，后来的人一进场就盖掉了前一个打电话的）
    const entry = { who, avatar, at, fp: tip?.fp ?? null, how: arr.how || '', ...(arr.where ? { where: arr.where } : {}), ...(knock ? { knock: true } : {}) };
    try { const list = JSON.parse(store.getMeta(`arrivals:${chatKey}`) ?? '[]') ?? []; store.setMeta(`arrivals:${chatKey}`, JSON.stringify([...list, entry].slice(-40))); } catch {}
    store.setMeta(`arrival_offer:${chatKey}`, null);
    store.setMeta(`arrival_request:${chatKey}`, null);
    store.setMeta(`arrival_brief:${chatKey}`, null);
    store.setMeta(`door_lit:${chatKey}`, null);
    if (offer?.from === 'settle') {
        // 用掉那一下挂在这次进场上（landing.contactUsed）：他那条回复删了、换了别人在说，这条联系回来
        try { const c = JSON.parse(store.getMeta(`settled_contact:${chatKey}:${who}`) ?? 'null'); if (c) store.setMeta(`settled_contact:${chatKey}:${who}`, JSON.stringify({ ...c, used: true, usedAt: { pos: at - 1, fp: tip?.fp ?? null, who, avatar } })); } catch {}
    }
    // 他接上了：去向用完了（人到场的清掉；发消息、打电话来的人还在外头，去向留着）、这个时段里"先不"的也清掉
    if (!/电话|消息/.test(arr.how) && !knock) dropAway(chatKey, who, { at, fp: tip?.fp ?? null, who, avatar });
    try { store.setMeta(`arrival_hold:${chatKey}`, JSON.stringify((JSON.parse(store.getMeta(`arrival_hold:${chatKey}`) ?? '[]') ?? []).filter(h => !sameName(h.who, who, roster)))); } catch {}
    const last = msgs.at(-1);
    // 他这一条删了重来、又进一次场：上一回进场替他记在同一条上的来由、这段时间、换住处作废，只留这一回的
    if (last) try { records.retireDerived?.({ storyId: chat.story_id, fp: last.fp, holderName: who, prefixes: [`${who}来这儿`, `${who}离开这段时间`, `${who}换了住处`, `${who}刚给${userName}`] }); } catch {}
    const recs = [];
    // 来由记成他的"来意"（matters.mjs，场记章程 B2）：还没下文的事，留在他的场记里，直到他说了、办了（记账了结）或离场
    if (arr.why && last && records.addDerived) recs.push(records.addDerived(intentRecord({ storyId: chat.story_id, fp: last.fp, who, how: arr.how, why: arr.why, holder: avatar ?? `name:${who}` })));
    // 离开这段时间他干了什么：记成他自己的经历（只他知道，他愿意可以讲给人听）；换了住处，生活现状跟着改
    if (arr.meanwhile && last && records.addDerived) recs.push(records.addDerived({ storyId: chat.story_id, fp: last.fp, type: '做', text: `${who}离开这段时间：${arr.meanwhile}`.slice(0, 200), holder: avatar ?? `name:${who}`, holderName: who, audience: [who], about: who }));
    if (away && got?.home && last && records.addDerived && homeChanged(away.home, [away.leaving, ...(away.plan?.errands ?? []).map(e => e?.text ?? e)])) recs.push(records.addDerived({ storyId: chat.story_id, fp: last.fp, type: '改变', duration: '直到被改变', text: `${who}换了住处：${got.home}`.slice(0, 200), holder: avatar ?? `name:${who}`, holderName: who, audience: [who], about: who, life: { who, kind: '住处', now: got.home, gone: '' } }));
    // 旁白替他递过的那条（场记章程 B1）：记一笔他刚发过（他和玩家都知道，跟着这几笔挂到他那条回复上），口袋那件标用掉（等他那条回复，删了就回来）
    if (offer?.sent?.surface && last) try { const id = landSent(store, records, { chatKey, storyId: chat.story_id, who, avatar, userName, sent: offer.sent, at, fp: last.fp }); if (id != null) recs.push(id); } catch (error) { log(`arrive ${chatKey} ${who}: sent failed ${error.message}`); }
    // 提前的那件：给约他的那人排一件"人都来了"（当下：到了就进口袋、先递；那人有卡、不在场，挂在门上，玩家点了他才出来）
    const menus = [];
    if (pull?.with && tip) try {
        const plan = store.lastReadyPlan(chatKey);
        if (plan) {
            store.appendMenu(plan.id, [{ who: pull.with, title: '人都来了', surface: pull.surface || `${who}人找到这儿来了；${pull.with}约他的那件，眼下就能当面说`, respond: pull.respond || '', sink: null, fit: null, weight: '半轮', know: null,
                line: '约定提前', after: null, motif: NOW_MOTIF, promiseRef: pull.promiseRef ?? null, offscreen: false, afterDays: 0, entry: '找上门', place: null, goer: null, errand: null,
                origin: `原本约的：${pull.text}。${who}找上门来，正好碰上，顺便提前到眼下` }], { storyDay: storyContext(store, records, chatKey).today, at: { pos: tip.pos, fp: tip.fp } });
            const id = store.db.prepare('select max(id) id from menu where plan_id = ?').get(plan.id)?.id;
            if (Number.isInteger(id)) menus.push(id);
        }
    } catch (error) { log(`arrive ${chatKey} ${who}: pull failed ${error.message}`); }
    // 这几笔（和提前的那件）挂到他那条回复上（landing.relinkArrivals，每次同步跑）：回复删了、换了，它们跟着看不见
    if (recs.length || menus.length) try { const list = JSON.parse(store.getMeta(`arrivals:${chatKey}`) ?? '[]') ?? []; const mine = list.findLast(e => e.who === entry.who && e.at === entry.at && e.fp === entry.fp); if (mine) { if (recs.length) mine.recs = recs; if (menus.length) mine.menus = menus; store.setMeta(`arrivals:${chatKey}`, JSON.stringify(list)); } } catch {}
    log(`arrive ${chatKey} ${who}: ${arr.how || '-'} (点的：${({ go: '你去找他', come: '让他过来', remote: way ? `他${/电话/.test(way) ? '打电话' : '发消息'}` : '他发消息' })[mode] ?? mode}) ${got ? 'brief' : 'no brief'}`);
    return { ok: true, ...arr };
}

async function runEpisodes({ chatKey, force = false }) {
    const cfg = getConfig(), s = cfg.stages.scene;
    if (!cfg.episodes?.enabled || !s?.baseUrl || !s.apiKey || !s.model || episodeBusy.has(chatKey)) return { written: 0 };
    const chat = store.requireChat(chatKey);
    if (!chat.enabled) return { written: 0 };
    episodeBusy.add(chatKey);
    let written = 0;
    try {
        for (let round = 0; round < EP_ROUNDS; round++) {
            if (records.spentToday() >= cfg.extractor.dailyBudgetUsd) break;
            const msgs = store.currentMessages(chatKey);
            const from = coveredUpTo(store.episodesOf(chatKey));
            const end = msgs.length - 1 - EP_KEEP;
            if (end - from + 1 < EP_MIN) break;
            const to = Math.min(end, from + EP_MAX - 1);
            const tryKey = `episodes_try:${chatKey}`;
            let last = null;
            try { last = JSON.parse(store.getMeta(tryKey) ?? 'null'); } catch {}
            if (!force && last?.from === from && last?.fp === msgs[from]?.fp && to - last.to < EP_RETRY) break;
            store.setMeta(tryKey, JSON.stringify({ from, fp: msgs[from]?.fp, to }));
            const tl = timelineFor(store, records, chatKey, msgs);
            const row = new Map(tl.rows.map(r => [r.pos, r]));
            const whenAt = pos => (r => (r ? `${tl.scale.ordinal(dayNumber(tl.start, r.day))}${r.part ? ` ${r.part}` : ''}` : ''))(row.get(pos));
            const whereAt = pos => {
                try {
                    const m = msgs.find(x => x.pos === pos);
                    const index = m ? msgs.indexOf(m) : -1;
                    const b = boardFor(store, records, chatKey, { anchor: m?.fp && index >= 0 ? `${index + 1}:${m.fp}` : null, present: [], timeline: tl });
                    return b?.camera?.place ?? '';
                } catch { return ''; }
            };
            const shape = m => ({ n: m.pos, name: m.name ?? (m.is_user ? '玩家' : m.speaker), when: whenAt(m.pos), where: whereAt(m.pos), text: m.text });
            const span = msgs.slice(from, to + 1);
            const shown = span.filter(m => !m.hidden);
            if (!shown.length) break;
            const user = episodePrompt({ messages: shown.map(shape), before: msgs.slice(Math.max(0, from - 3), from).filter(m => !m.hidden).map(shape), clean: stripper(cfg.strip) });
            const started = Date.now();
            let r;
            try {
                r = await createModelClient({ ...s, maxOutputTokens: 8000 }).complete({ system: EPISODE_SYSTEM, user });
            } catch (error) {
                records.logAssemble({ chatKey, speaker: '(场次摘要)', model: s.model, status: 'failed', usage: error.usage ?? null, ms: Date.now() - started, error: error.message });
                throw error;
            }
            const costUsd = ((r.usage?.input ?? 0) * s.priceInPerM + (r.usage?.output ?? 0) * s.priceOutPerM) / 1e6;
            records.logAssemble({ chatKey, speaker: '(场次摘要)', model: s.model, servedModel: r.servedModel, status: 'done', usage: r.usage, costUsd, ms: Date.now() - started, raw: r.text });
            const list = parseEpisodes(r.text, { from, to });
            if (!list?.length) throw new Error('episodes_bad_json');
            const full = to - from + 1 >= EP_MAX;
            const keep = list.at(-1).open && (list.length > 1 || !full) ? list.slice(0, -1) : list;
            // 模型想的那会儿消息变了（删了、改了）：这一批不存，下回重来
            const now = store.currentMessages(chatKey);
            if (spanOf(now.slice(from, to + 1).map(m => m.fp)) !== spanOf(span.map(m => m.fp))) break;
            const speakers = e => now.slice(e.from, e.to + 1).filter(m => m.speaker !== 'narrator').map(m => m.name).filter(Boolean);
            store.putEpisodes(chat.story_id, keep.map(e => ({ ...e, span: spanOf(now.slice(e.from, e.to + 1).map(m => m.fp)), present: [...new Set([...e.present, ...speakers(e)])] })), s.model);
            written += keep.length;
            log(`episodes ${chatKey}: #${from}～#${to} → ${keep.map(e => `#${e.from}～#${e.to}`).join('、') || '还没收尾，先不存'}, ${costUsd.toFixed(4)}`);
            if (!keep.length || keep.at(-1).to < to) break;   // 剩下的是还没收尾的那场，等后面的来
        }
    } catch (error) {
        log(`episodes ${chatKey} failed: ${error.message}`);
    } finally { episodeBusy.delete(chatKey); }
    return { written };
}

const sceneBusy = new Set();
// 上传的素材（materials.mjs）：看一眼提用法（参谋那档，几分钱）；"关系表"那种整理成关系表的格子（开局单那档）。
async function lookMaterials({ chatKey }) {
    const cfg = getConfig(), s = cfg.stages.advisor;
    const storyId = store.requireChat(chatKey).story_id;
    for (const item of materials.list(storyId).filter(x => x.status === 'looking')) {
        const started = Date.now();
        try {
            if (!s?.baseUrl || !s.apiKey || !s.model) throw new Error('没配参谋那档的模型');
            const r = await createModelClient({ ...s, maxOutputTokens: 2000, timeoutMs: 120000, stream: true }).complete({ system: LOOK_SYSTEM, user: lookPrompt({ name: item.name, text: materials.text(storyId, item.name) }) });
            const costUsd = ((r.usage?.input ?? 0) * s.priceInPerM + (r.usage?.output ?? 0) * s.priceOutPerM) / 1e6;
            records.logAssemble({ chatKey, speaker: '(素材)', model: s.model, servedModel: r.servedModel, status: 'done', usage: r.usage, costUsd, ms: Date.now() - started, raw: r.text });
            materials.update(storyId, item.name, { ...parseLook(r.text), status: 'ready' });
        } catch (error) {
            log(`material look ${item.name} failed: ${error.message}`);
            materials.update(storyId, item.name, { status: 'ready', kind: '参考资料', why: `没看成（${error.message}），先按参考资料算`, summary: '' });
        }
    }
}
async function materialRelations({ chatKey, name }) {
    const cfg = getConfig(), s = cfg.stages.setup;
    const storyId = store.requireChat(chatKey).story_id;
    const started = Date.now();
    try {
        if (!s?.baseUrl || !s.apiKey || !s.model) throw new Error('没配开局单那档的模型');
        const r = await createModelClient({ ...s, maxOutputTokens: 16000, timeoutMs: 600000, stream: true }).complete({ system: RELATIONS_SYSTEM, user: materials.text(storyId, name) });
        const costUsd = ((r.usage?.input ?? 0) * s.priceInPerM + (r.usage?.output ?? 0) * s.priceOutPerM) / 1e6;
        records.logAssemble({ chatKey, speaker: '(素材)', model: s.model, servedModel: r.servedModel, status: 'done', usage: r.usage, costUsd, ms: Date.now() - started, raw: r.text });
        materials.update(storyId, name, { status: 'drafted', draft: String(r.text).trim() });
    } catch (error) {
        log(`material relations ${name} failed: ${error.message}`);
        materials.update(storyId, name, { status: 'ready', error: error.message });
    }
}

// 持续几周的事（drift.mjs，N-93）：每个剧情周掷一次要不要起一件；起了就让局势那档（Gemini）按这一局的设定写成具体的事和三个阶段。
// 掷过的周记下（不管起没起）；写失败的那周下次同步再试，三次不成就算这周没有。存在 long_events:<局>。
const longBusy = new Set();
async function runLong({ chatKey }) {
    const cfg = getConfig(), s = cfg.stages.situation;
    const chat = store.requireChat(chatKey);
    if (!chat.enabled || longBusy.has(chat.story_id)) return;
    // 10/10 以前起的事没记起时的消息位置：补成那一天头一条消息的位置，阶段才能按消息数也往前走（drift.longStage）
    try {
        const events = JSON.parse(store.getMeta(`long_events:${chat.story_id}`) ?? 'null');
        if (Array.isArray(events) && events.some(e => e && !Number.isFinite(e.起_pos))) {
            const msgs = store.currentMessages(chatKey), tl = timelineFor(store, records, chatKey, msgs);
            const fixed = events.map(e => { if (!e || Number.isFinite(e.起_pos)) return e; const first = msgs.find(m => tl.dayOf(m.pos) >= e.起) ?? msgs[0]; return first ? { ...e, 起_pos: first.pos } : e; });
            store.setMeta(`long_events:${chat.story_id}`, JSON.stringify(fixed));
        }
    } catch {}
    if (cfg.drift?.long === false || !s?.baseUrl || !s.apiKey || !s.model) return;
    const ctxNow = storyContext(store, records, chatKey);
    const ts = ctxNow.ts, week = weekOf(ctxNow.today, ts), nowPos = store.currentMessages(chatKey).at(-1)?.pos ?? null;
    const meta = k => { try { return JSON.parse(store.getMeta(`${k}:${chat.story_id}`) ?? 'null'); } catch { return null; } };
    const rolled = meta('long_rolled') ?? {};
    const todo = Array.from({ length: week + 1 }, (_, w) => w).filter(w => !(rolled[w] >= 1 || rolled[w] <= -3));
    if (!todo.length || records.spentToday() >= cfg.extractor.dailyBudgetUsd) return;
    longBusy.add(chat.story_id);
    try {
        for (const w of todo) {
            const events = meta('long_events') ?? [];
            const roll = rollLong(chat.story_id, w, activeLong(events, w === week ? ctxNow.today : w * ts.perWeek, w === week ? { lastPos: nowPos } : {}).length, ts);
            if (!roll) { rolled[w] = 1; continue; }
            const started = Date.now();
            try {
                const setup = store.setupOf(chat.story_id)?.data ?? null;
                const net = packOf(chatKey)?.factions;
                const factions = (net?.nodes ?? []).map(f => f?.name).filter(Boolean).slice(0, 40);
                const r = await createModelClient({ ...s, maxOutputTokens: 3000, timeoutMs: 120000, stream: true }).complete({ system: LONG_SYSTEM, user: longPrompt({ roll, setup: setup ? briefSection(setup).filter(l => !l.startsWith('储备线') && !l.startsWith('·')).slice(0, 8) : [], factions, timeScale: ts }) });
                const costUsd = ((r.usage?.input ?? 0) * s.priceInPerM + (r.usage?.output ?? 0) * s.priceOutPerM) / 1e6;
                records.logAssemble({ chatKey, speaker: '(持续的事)', model: s.model, servedModel: r.servedModel, status: 'done', usage: r.usage, costUsd, ms: Date.now() - started, raw: r.text });
                const e = parseLong(r.text, roll, w === week ? ctxNow.today : w * ts.perWeek, w === week ? nowPos : null);   // 这一周的从今天起；补掷以前的周从那周开头起
                if (e) { store.setMeta(`long_events:${chat.story_id}`, JSON.stringify([...events, e])); log(`long event ${chat.story_id} week ${w}: ${e.名}（${ts.span(e.天数)}）$${costUsd.toFixed(4)}`); }
                rolled[w] = 1;
            } catch (error) {
                records.logAssemble({ chatKey, speaker: '(持续的事)', model: s.model, status: 'failed', ms: Date.now() - started, error: error.message });
                rolled[w] = (rolled[w] ?? 0) - 1;
                break;
            }
        }
    } finally {
        store.setMeta(`long_rolled:${chat.story_id}`, JSON.stringify(rolled));
        longBusy.delete(chat.story_id);
    }
}

// 世界书谁知道（lore.mjs）：新的、改过的条目一批 25 条判一次（参谋那档，几分钱）；同一局同时只跑一份。
const loreBusy = new Set();
async function runLore({ chatKey }) {
    const cfg = getConfig(), s = cfg.stages.lore;
    const chat = store.requireChat(chatKey);
    if (!s?.baseUrl || !s.apiKey || !s.model || loreBusy.has(chat.story_id)) return;
    loreBusy.add(chat.story_id);
    try {
        // 判的规矩改了：模型判过的重判（玩家定的不动）
        if (store.getMeta(`lore_ver:${chat.story_id}`) !== String(LORE_VERSION)) {
            store.db.prepare("update lore set verdict = null, source = null where story_id = ? and (source is null or source = 'model')").run(chat.story_id);
            store.setMeta(`lore_ver:${chat.story_id}`, String(LORE_VERSION));
        }
        // 开局单"口径"里写明了只有哪几个人知道的事：判的时候照它（名单外的人不给）
        const bounds = (store.setupOf?.(chat.story_id)?.data?.口径 ?? []).filter(x => x?.事 && Array.isArray(x.谁知道) && x.谁知道.length).slice(0, 60);
        // 判不了的（中转拒答、答的不是 JSON）别一轮轮重问（试玩 10/13～10/16：16 条判不了，三天问了 450 次、每次十几秒）：
        // 一批没答上就拆开一条条问，一条单独问也没答上就当所有人都知道、记下来不再问（lore.loreBatch）
        const triesKey = `lore_tries:${chat.story_id}`;
        let tries = {};
        try { tries = JSON.parse(store.getMeta(triesKey) ?? '{}') ?? {}; } catch {}
        for (;;) {
            const unjudged = store.loreOf(chat.story_id).filter(r => !r.verdict);
            const { todo, giveUp } = loreBatch(unjudged, tries);
            for (const r of giveUp) { store.setLore(chat.story_id, r.key, GIVE_UP_VERDICT, 'model'); log(`lore ${chat.story_id}: gave up on ${r.key} after ${tries[r.key]?.n ?? 0} tries`); }
            if (!todo.length || records.spentToday() >= cfg.extractor.dailyBudgetUsd) return;
            const started = Date.now();
            const roster = store.getCast(chat.story_id).filter(e => e.role !== '不用');
            const userName = [...store.currentMessages(chatKey)].reverse().find(m => m.is_user)?.name ?? null;
            try {
                const r = await createModelClient({ ...s, maxOutputTokens: 6000, timeoutMs: 180000, stream: true }).complete({ system: LORE_SYSTEM, user: lorePrompt({ entries: todo, roster, userName, bounds }) });
                const costUsd = ((r.usage?.input ?? 0) * s.priceInPerM + (r.usage?.output ?? 0) * s.priceOutPerM) / 1e6;
                records.logAssemble({ chatKey, speaker: '(世界书谁知道)', model: s.model, servedModel: r.servedModel, status: 'done', usage: r.usage, costUsd, ms: Date.now() - started, raw: r.text });
                parseLore(r.text, todo.length).forEach((v, i) => store.setLore(chat.story_id, todo[i].key, v, 'model'));
                log(`lore ${chat.story_id}: judged ${todo.length} entr(ies), ${todo.length - parseLore(r.text, todo.length).filter(v => v.all).length} limited, $${costUsd.toFixed(4)}`);
            } catch (error) {
                records.logAssemble({ chatKey, speaker: '(世界书谁知道)', model: s.model, status: 'failed', ms: Date.now() - started, error: error.message });
                log(`lore ${chat.story_id} failed: ${error.message}`);
                tries = loreTried(tries, todo);
                store.setMeta(triesKey, JSON.stringify(tries));
                return;
            }
        }
    } finally { loreBusy.delete(chat.story_id); }
}

// 兴头：备料（看到哪了、空当隔够没、刚换了地方、场面材料）和收结果分开写——单独调（runScene）和并进"看一眼"（runGlance）共用同一份
function prepareScene({ chatKey }) {
    const cfg = getConfig(), sc = cfg.scene, s = cfg.stages.scene;
    if (!sc.enabled || !s?.baseUrl || !s.apiKey || !s.model || sceneBusy.has(chatKey)) return null;
    const chat = store.requireChat(chatKey);
    if (!chat.enabled) return null;
    // 看最新那条角色回复（前台常常是玩家下一句发出时才把上一条回复一起同步过来：最后一条是玩家的也照样看，玩家这句也在场面里）
    const messages = store.currentMessages(chatKey);
    const last = [...messages].reverse().find(m => !m.is_user);
    if (!last) return null;
    // 看到哪了：连指纹一起记；删回去、换了分支，记的那条不在了就重新看（scene.stillThere）
    const seenKey = `scene_seen:${chatKey}`;
    let seen = null;
    try { const raw = store.getMeta(seenKey); seen = raw == null ? null : String(raw).trim().startsWith('{') ? JSON.parse(raw) : { pos: Number(raw) }; } catch {}
    const same = (a, b) => !!store.sameMessage?.(a, b);
    if (seen && stillThere(seen, messages, same) && seen.pos >= last.pos) return null;
    store.setMeta(seenKey, JSON.stringify({ pos: last.pos, fp: last.fp }));
    let recent = [];
    try { recent = JSON.parse(store.getMeta(`impulses:${chatKey}`) ?? '[]'); } catch {}
    recent = recent.filter(x => stillThere(x.at, messages, same));   // 删掉的那段里冒过的兴头不算"刚冒过"
    // 玩家这边刚换了地方（N-295，D-167）：最近两条括号里的叙述写着走进、来到、推开门……——这一回不等空当，给它开局单里的几条线，
    // 让到了规划没写的地方也能临时冒点东西、喂得上长线。同一回换地方只这么来一次（记在那条上，删回去重来照样算）。
    const narration = t => (String(t ?? '').match(/（[^）]*）|\([^)]*\)/g) ?? []).join(' ');
    const tail = messages.slice(-2);
    let moved = movedTo(tail.map(m => narration(m.text)).join('\n'));
    let lastMove = null;
    try { lastMove = JSON.parse(store.getMeta(`scene_moved:${chatKey}`) ?? 'null'); } catch {}
    if (moved && lastMove && stillThere(lastMove, messages, same) && lastMove.pos >= (tail[0]?.pos ?? 0)) moved = null;
    if (!moved && recent.length && last.pos - (recent.at(-1).at?.pos ?? -Infinity) < sc.gap) return null;
    if (moved) store.setMeta(`scene_moved:${chatKey}`, JSON.stringify({ pos: last.pos, fp: last.fp }));
    if (records.spentToday() >= cfg.extractor.dailyBudgetUsd) return null;
    const m = sceneMaterial(store, records, chatKey);
    if (cfg.pace?.lateral === false) m.loose = [];   // 横向生长关着：不给手边的事、不记玩家眼下的样子
    const arcs = moved ? (m.setup?.储备线 ?? []).filter(x => !x.终局).slice(0, 10) : [];
    const user = scenePrompt({ ...m, recent: m.recent.slice(-6), arrived: moved, arcs });
    // 收结果：玩家眼下的样子（累着、难受……）没出兴头也记下，那一格里约定那几行照它改口气（用户 10/2）；
    // 程序这一关（人在场、各自隔一阵、斗嘴亲近有对象、亲近得有来往、讲过的往事不再讲）：scene.admitImpulse。返回存下的那一条，没有就 null
    const apply = v => {
        if (v.userState && cfg.pace?.lateral !== false) store.setMeta(`user_state:${chatKey}`, JSON.stringify({ state: v.userState, pos: last.pos, fp: last.fp }));
        if (!v.open) return null;
        const at = { pos: last.pos, fp: last.fp };
        let imp = admitImpulse(v, { ...m, pos: last.pos, at, gaps: sc });
        if (!imp) return null;
        if (v.kind === '提前') {
            const item = m.menu.find(x => x.id === v.id && x.status === 'waiting');
            if (!item) return null;
            store.updateMenu(chatKey, item.id, { status: 'pocket', pocket_day: m.today, at });
            imp = { ...imp, who: item.who, what: item.title, used: true };
        } else store.setMeta(`impulse:${chatKey}`, JSON.stringify(imp));
        store.setMeta(`impulses:${chatKey}`, JSON.stringify([...recent, imp].slice(-12)));
        return imp;
    };
    return { s, last, user, apply };
}
async function runScene({ chatKey, prepared = null }) {
    const p = prepared ?? prepareScene({ chatKey });
    if (!p) return;
    sceneBusy.add(chatKey);
    const started = Date.now();
    try {
        const r = await createModelClient({ ...p.s, maxOutputTokens: 6000 }).complete({ system: renderPronouns(SCENE_SYSTEM, playerContext(store, chatKey)), user: p.user });
        const costUsd = ((r.usage?.input ?? 0) * p.s.priceInPerM + (r.usage?.output ?? 0) * p.s.priceOutPerM) / 1e6;
        records.logAssemble({ chatKey, speaker: '(兴头)', model: p.s.model, servedModel: r.servedModel, status: 'done', usage: r.usage, costUsd, ms: Date.now() - started, raw: r.text });
        const v = parseScene(r.text);
        const imp = p.apply(v);
        if (imp) log(`scene ${chatKey} at ${p.last.pos}: ${imp.kind} ${imp.who}${imp.to ? `→${imp.to}` : ''}——${imp.what}（${v.why}） $${costUsd.toFixed(4)}`);
    } catch (error) {
        records.logAssemble({ chatKey, speaker: '(兴头)', model: p.s.model, status: 'failed', ms: Date.now() - started, error: error.message });
    } finally { sceneBusy.delete(chatKey); }
}


// 读卡写"兴趣和习惯"（D-109）：扩展交来卡的正文，后台用读卡那档（默认跟着参谋：读得多、便宜）写几行，按卡存。
// 同一张卡同时只读一次；调不通就算了，下回打开窗口再读。
const profiling = new Set();
async function makeProfile({ avatar, name, hash, text }) {
    if (profiling.has(avatar) || !String(text ?? '').trim()) return;
    const cfg = getConfig(), s = cfg.stages.profile;
    if (!s?.baseUrl || !s.apiKey || !s.model || records.spentToday() >= cfg.extractor.dailyBudgetUsd) return;
    profiling.add(avatar);
    const started = Date.now();
    try {
        const r = await createModelClient({ ...s, maxOutputTokens: 16000 }).complete({ system: renderPronouns(PROFILE_SYSTEM, { person: name }), user: profilePrompt({ name, text }) });
        const costUsd = ((r.usage?.input ?? 0) * s.priceInPerM + (r.usage?.output ?? 0) * s.priceOutPerM) / 1e6;
        records.logAssemble({ chatKey: '-', speaker: '(读卡)', model: s.model, servedModel: r.servedModel, status: 'done', usage: r.usage, costUsd, ms: Date.now() - started, raw: r.text });
        store.putProfile(avatar, profileHash(hash), parseProfile(r.text));
        log(`profile ${name}: $${costUsd.toFixed(4)}`);
    } catch (error) {
        const costUsd = ((error.usage?.input ?? 0) * s.priceInPerM + (error.usage?.output ?? 0) * s.priceOutPerM) / 1e6;
        records.logAssemble({ chatKey: '-', speaker: '(读卡)', model: s.model, status: 'failed', usage: error.usage ?? null, costUsd, ms: Date.now() - started, error: error.message });
        // 放大上限重来也没写完：半截先存着用，但不算读完，下回启动再读
        if (error.partial) store.putProfile(avatar, hash, parseProfile(error.partial));
        log(`profile ${name} failed: ${error.message}`);
    } finally { profiling.delete(avatar); }
}

// 读卡的版本变了（D-112 起多了往事、聊天、亲近）：各局名册里用得上的卡，按存下的正文重读一遍（一张约半美分）。一张一张来。
async function refreshProfiles() {
    const rows = store.db.prepare(`select distinct p.avatar, p.card_name name, p.card_hash hash, p.card_text text, p.hash done from card_profiles p
        join cast c on c.avatar = p.avatar where c.role != '不用' and p.card_text is not null and p.card_hash is not null`).all();
    for (const r of rows.filter(r => r.done !== profileHash(r.hash))) await makeProfile(r);
}

// 离开期间推演（away.mjs）：用户离开够久回来，推一次各人这些天以为的、做了的。一次离开只推一次（同时要的只跑一份）；
// 模型默认用记账那一档（用户 9/27 定：同一次离开 Opus 比 Sonnet 推得重得多，一次离开只推一次，多花不到一毛钱；流式读，两分钟上下）；
// 没配记账模型就用叙事组装那档。配置 absence.model 可另指定。
// 调不通就记"没成"，角色那一格照旧给程序那几行。
const thinking = new Map();
// 玩家回来后交代了这段空白：按玩家说的把推演重推一遍，写回同一份（"已按玩家改"），之后的余波跟着换（away.AWAY_REVISE_SYSTEM）。
// 只改一次；后台跑，不等（这一轮照旧，下一轮起用改过的）。said＝离开之后到眼下的几条（含玩家说的）。
const revising = new Map();
function reviseAway({ chatKey, absenceId }) {
    if (revising.has(absenceId)) return revising.get(absenceId);
    const job = (async () => {
        const a = store.absences(chatKey).find(x => x.id === absenceId);
        if (!a || a.story_status !== 'ready' || !a.story || a.story.已按玩家改 || a.from_pos == null) return null;
        const cfg = getConfig(), e = cfg.extractor, a0 = cfg.stages.away;
        const model = a0.model, prices = [a0.priceInPerM, a0.priceOutPerM];
        if (!a0.baseUrl || !a0.apiKey || !model || records.spentToday() >= e.dailyBudgetUsd) return null;
        const said = store.currentMessages(chatKey).filter(m => m.pos > a.from_pos).slice(0, 6).map(m => ({ name: m.name ?? m.speaker, text: m.text, isUser: !!m.is_user }));
        if (!said.some(m => m.isUser)) return null;
        const started = Date.now();
        try {
            const material = awayMaterial(store, records, chatKey, a);
            const r = await createModelClient({ ...a0, model, maxOutputTokens: 16000, timeoutMs: 600000, stream: true }).complete({ system: renderPronouns(AWAY_REVISE_SYSTEM, playerContext(store, chatKey)), user: revisePrompt(material, { story: a.story, said }) });
            const costUsd = ((r.usage?.input ?? 0) * prices[0] + (r.usage?.output ?? 0) * prices[1]) / 1e6;
            records.logAssemble({ chatKey, speaker: '(离开推演·按玩家改)', model, servedModel: r.servedModel, status: 'done', usage: r.usage, costUsd, ms: Date.now() - started, raw: r.text });
            // 实际天数（质量窗 10/3）：玩家说其实没空白就是 0——不跳日期、"回来那一段"和它的余波都撤掉；说了别的天数就照改
            const actual = actualDaysOf(r.text);
            let parsed = null;
            try { parsed = pinNames(parseAway(r.text), [...material.cast.map(e => e.name), ...material.names]); } catch (error) { if (actual !== 0) throw error; }
            const story = { ...(parsed ?? { 空白: '玩家说没有空白，接着刚才那一刻', 各人: [], 别人: [] }), 已按玩家改: true, 原来的空白: a.story.空白, 改自: a.id, ...(actual === 0 ? { 没有空白: true } : {}) };
            // 这条离开是从上一个窗口带过来的（分支）：改的只算这个窗口，另存一份，别动别的分支的
            let id = absenceId;
            if (a.chat_key !== chatKey) {
                id = store.putAbsence({ chatKey, fromFp: a.from_fp, toFp: a.to_fp, startedAt: a.started_at, endedAt: a.ended_at, hours: a.hours, days: a.days }).id;
                for (const sp of a.seen ?? []) store.markAbsenceSeen(id, sp);
            }
            store.setAbsenceStory(id, 'ready', story);
            if (actual != null && actual !== a.days) store.setAbsenceDays(id, actual);
            log(`away ${absenceId} revised after the player spoke`);
            return story;
        } catch (error) {
            records.logAssemble({ chatKey, speaker: '(离开推演·按玩家改)', model, status: 'failed', ms: Date.now() - started, error: error.message });
            log(`away ${absenceId} revise failed: ${error.message}`);
            return null;
        }
    })().finally(() => revising.delete(absenceId));
    revising.set(absenceId, job);
    return job;
}

function thinkAway({ chatKey, absenceId }) {
    if (thinking.has(absenceId)) return thinking.get(absenceId);
    const job = (async () => {
        const a = store.absences(chatKey).find(x => x.id === absenceId);
        if (!a) return null;
        if (a.story_status === 'ready') return a.story;
        const cfg = getConfig(), e = cfg.extractor, a0 = cfg.stages.away;   // 离开推演那一环节（D-106）
        const model = a0.model;
        const prices = [a0.priceInPerM, a0.priceOutPerM];
        if (!a0.baseUrl || !a0.apiKey || !model || records.spentToday() >= e.dailyBudgetUsd) { store.setAbsenceStory(absenceId, 'failed'); return null; }
        store.setAbsenceStory(absenceId, 'working');
        const started = Date.now();
        try {
            const material = awayMaterial(store, records, chatKey, a);
            const r = await createModelClient({ ...a0, model, maxOutputTokens: 16000, timeoutMs: 600000, stream: true }).complete({ system: renderPronouns(AWAY_SYSTEM, playerContext(store, chatKey)), user: awayPrompt(material) });
            const costUsd = ((r.usage?.input ?? 0) * prices[0] + (r.usage?.output ?? 0) * prices[1]) / 1e6;
            records.logAssemble({ chatKey, speaker: '(离开推演)', model, servedModel: r.servedModel, status: 'done', usage: r.usage, costUsd, ms: Date.now() - started, raw: r.text });
            const story = pinNames(parseAway(r.text), [...material.cast.map(e => e.name), ...material.names]);
            store.setAbsenceStory(absenceId, 'ready', story);
            log(`away ${absenceId} (${a.days} days) reasoned: ${story.各人.map(x => x.谁).join('、')}`);
            return story;
        } catch (error) {
            records.logAssemble({ chatKey, speaker: '(离开推演)', model, status: 'failed', ms: Date.now() - started, error: error.message });
            log(`away ${absenceId} failed: ${error.message}`);
            store.setAbsenceStory(absenceId, 'failed');
            return null;
        }
    })().finally(() => thinking.delete(absenceId));
    thinking.set(absenceId, job);
    return job;
}

// 去复读（core/fresh.mjs）：他刚说完的这条，和他前几条比，重样的说法请模型换成新的。出错、没钥匙、超预算都原样返回。
// 事后截一刀（stay.mjs，用户 10/2；默认关）：玩家没动，他却替她换了地方、跳了时间——让便宜模型看一眼，有就截到那之前。
// 用去复读那档模型；调不通、看不出就原样放过。
async function stayMessage({ chatKey, speaker, name, text, said }) {
    const cfg = getConfig(), a0 = cfg.stages.fresh, model = a0.model;
    if (!a0.baseUrl || !a0.apiKey || !model || records.spentToday() >= cfg.extractor.dailyBudgetUsd || String(text).length < 80) return { text, changes: [] };
    const started = Date.now();
    try {
        const r = await createModelClient({ ...a0, model, maxOutputTokens: 2000 }).complete({ system: renderPronouns(STAY_SYSTEM, { ...playerContext(store, chatKey), person: name }), user: stayPrompt({ name, said, text }) });
        const costUsd = ((r.usage?.input ?? 0) * a0.priceInPerM + (r.usage?.output ?? 0) * a0.priceOutPerM) / 1e6;
        records.logAssemble({ chatKey, speaker: '(截一刀)', model, servedModel: r.servedModel, status: 'done', usage: r.usage, costUsd, ms: Date.now() - started, raw: r.text });
        const judge = parseStay(r.text);
        const got = applyStay(text, judge);
        if (got.cut) log(`stay ${chatKey} ${name}: cut ${got.cut.length} chars（${judge.why}）`);
        return { text: got.text, changes: got.cut ? [{ from: got.cut, to: got.close ?? '' }] : [] };
    } catch (error) {
        records.logAssemble({ chatKey, speaker: '(截一刀)', model, status: 'failed', ms: Date.now() - started, error: error.message });
        return { text, changes: [] };
    }
}

function hasBoundVoice({ chatKey, speaker }) {
    const cfg = getConfig();
    if (!cfg.fresh.enabled) return false;
    const chat = store.requireChat(chatKey);
    const actor = store.getCast(chat.story_id).find(e => e.avatar === speaker && e.role !== '不用' && !String(e.avatar).startsWith('face:'));
    return !!actor && !!voiceOf(path.join(home, '口吻'), [actor.name, speaker]);
}
async function freshMessage({ chatKey, speaker, text, before = null, lore = null }) {
    const cfg = getConfig(), a0 = cfg.stages.fresh;   // 去复读那一环节（D-106）；默认跟着检索词那档：路数得赶在用户下一句之前记下
    const model = a0.model;
    // 左滑重来、"继续"时，库里这一格还是上一版：只拿它前面那条（扩展给的 before）为止的来比，别把被换掉的上一版当成"他前几条"
    // （试玩 9/30："继续"了一回，新的这条整个跟继续前的那半截比，找出 21 处"复读"，把刚换好的句子又换了一遍）
    const all = store.currentMessages(chatKey);
    const cut = typeof before === 'string' ? all.map(m => m.text).lastIndexOf(before) : -1;
    const messages = cut >= 0 ? all.slice(0, cut + 1) : all;
    const echo = [...messages].reverse().find(m => m.is_user)?.text ?? '';
    const chat = store.requireChat(chatKey);
    const actor = store.getCast(chat.story_id).find(e => e.avatar === speaker && e.role !== '不用' && !String(e.avatar).startsWith('face:'));
    const name = actor?.name ?? messages.filter(m => m.speaker === speaker).at(-1)?.name ?? speaker;
    const voice = cfg.fresh.enabled && actor ? voiceOf(path.join(home, '口吻'), [name, speaker]) : '';
    // 台词段首拿对方的话反问一句（"借钱？"）、"至于……"拎对方话头的：程序直接去掉，不花钱；模型换上来的句子再过一遍
    const tidy = out => {
        if (cfg.fresh.dropEchoes === false) return out;
        const d = dropEchoHeads(out.text, echo);
        return d.dropped.length ? { ...out, text: d.text, changes: [...out.changes, ...d.dropped.map(from => ({ from, to: '' }))] } : out;
    };
    const done = out => { if (out.changes.length) store.markFreshened(fingerprint(false, speaker, out.text), fingerprint(false, speaker, text)); return out; };
    // 先截一刀（默认关），再去复读
    // 截一刀和以前一样跟着去复读总开关（第二档），不跟绑定走：没绑语料的角色照旧能截
    const stayed = cfg.fresh.enabled && cfg.stay?.enabled ? await stayMessage({ chatKey, speaker, name, text, said: echo }) : { text, changes: [] };
    const pre = tidy({ text: stayed.text, changes: stayed.changes });
    if (!voice) return done(pre);
    if (!a0.baseUrl || !a0.apiKey || !model || records.spentToday() >= cfg.extractor.dailyBudgetUsd) return done(pre);
    const his = messages.filter(m => !m.is_user && m.speaker === speaker && m.text !== text && !(m.text.length >= 40 && text.startsWith(m.text))).map(m => m.text);
    const previous = his.slice(-PREVIOUS), usual = his.slice(-PREVIOUS - 30, -PREVIOUS);   // 更早的：他一贯的说法、这个世界的叫法
    // 他上一次开口之后、别人说的（至多两条）：别顺着别人的比喻往下说
    const lastMine = messages.map(m => m.speaker === speaker && m.text !== text).lastIndexOf(true);
    const others = messages.slice(lastMine + 1).filter(m => !m.is_user && m.speaker !== speaker && m.text !== text).slice(-2).map(m => ({ name: m.name ?? m.speaker, text: m.text }));
    const exclude = [...store.getCast(chat.story_id).map(e => e.name), ...messages.filter(m => m.is_user).map(m => m.name)].filter(Boolean);
    // 拿对方原话起头的台词（用户 9/29）也请模型换：当成程序找到的，括起来（段首的上面已经去掉了，剩下段中间的）
    const spans = [...staleSpans(pre.text, previous, { exclude, echo, usual }), ...echoOpenings(pre.text, echo).map(span => ({ span, count: 0, echo: true }))];
    const prices = [a0.priceInPerM, a0.priceOutPerM];
    const started = Date.now();
    try {
        // 他本人的口吻：数据目录 口吻/<名字>.md（fresh.voice，默认开；没放文件就没有）
        const setupData = store.setupOf?.(chat.story_id)?.data;
        const roster = store.getCast(chat.story_id).map(e => e.name);
        const facts = (staleBackstory(setupData, records.visible(chatKey), [...messages].reverse().find(m => m.is_user)?.name)?.前史 ?? []).filter(x => x.常驻 && !x.过时 && (!x.谁知道?.length || x.谁知道.some(p => sameName(p, name, roster)))).map(x => x.事);
        // 核对硬事实的材料（N-279）：这条之前的十来条、这一轮真触发的世界书、此刻的样子
        const context = messages.filter(m => m.text !== text).slice(-12).map(m => ({ name: m.name ?? (m.is_user ? '玩家' : m.speaker), text: m.text }));
        const fired = new Set(lore ?? []);
        const loreTexts = fired.size ? (store.loreOf?.(chat.story_id) ?? []).filter(e => fired.has(e.key) && e.text).slice(0, 6).map(e => ({ title: e.title, text: e.text })) : [];
        let stateNow = [];
        try { stateNow = stateBlock(store, { chatKey, name, present: [...new Set(context.map(m => m.name))], records }).slice(1); } catch {}
        // 这一轮给他的回忆（场记里"想起的"那一块，N-284 第三步）：说岔了以前的事，照它改回来。那一格按"这条之前那条"钉着
        const upto = messages.at(-1)?.text === text ? messages.slice(0, -1) : messages;
        const recalled = store.getSlotParts?.({ chatKey, speaker, anchor: upto.length ? `${upto.length}:${upto.at(-1).fp}` : 'start' })?.recall ?? '';
        const r = await createModelClient({ ...a0, model, maxOutputTokens: 6000 }).complete({ system: renderPronouns(FRESH_SYSTEM, { ...playerContext(store, chatKey), person: name }), user: freshPrompt({ name, text: pre.text, spans, previous, others, voice, facts, context, lore: loreTexts, state: stateNow, recall: recalled }) });
        const costUsd = ((r.usage?.input ?? 0) * prices[0] + (r.usage?.output ?? 0) * prices[1]) / 1e6;
        if (!freshAnswerValid(r.text)) throw Object.assign(new Error('fresh_bad_json'), { usage: r.usage });
        records.logAssemble({ chatKey, speaker: '(去复读)', model, servedModel: r.servedModel, status: 'done', usage: r.usage, costUsd, ms: Date.now() - started, raw: r.text });
        const got = applyFresh(pre.text, spans, r.text, previous, { voice, said: echo, styleOnly: !previous.length });
        const out = tidy({ ...got, changes: [...pre.changes, ...got.changes] });
        // 他一再用的路数记在这一条上（存下来的是换过的那版），他下一次开口时那一格提前说一声（fresh.waysLine）。
        // 也记着这条接的是哪一条（after）：左滑重来时这条换掉了，接的那条还在，下一版照样拿得到（试玩 9/30）
        const after = (cut >= 0 ? messages[cut] : [...messages].reverse().find(m => m.is_user))?.fp ?? null;
        store.setMeta(`fresh_ways:${chatKey}:${speaker}`, JSON.stringify({ fp: fingerprint(false, speaker, out.text), after, ways: out.ways }));
        done(out);
        log(`fresh ${chatKey} ${name}: ${spans.length} stale, ${out.changes.length} changed (${pre.changes.length} echo heads dropped, ${got.fixed ?? 0} facts put right), ${out.ways.length} ways`);
        return { ...out, fixed: got.fixed ?? 0, spans: spans.map(x => x.span) };
    } catch (error) {
        records.logAssemble({ chatKey, speaker: '(去复读)', model, status: 'failed', ms: Date.now() - started, error: error.message });
        log(`fresh ${chatKey} ${name}: failed (${error.message})`);
        return done(pre);
    }
}

// "开局到现在"的大意（章程 H4）：之前的节点多了，规划简报压过时最近 RECENT_NODES 个各一行，更早的并成一段。
// 交回一份新规划以后看一眼：下一份简报里"更早的"那几个节点（这一窗口的）还没并进大意的，按先后一个一个续写——
// 便宜那档（节点检查那一档），只给上一段大意＋这个节点的目标和结果，一回几分钱。写失败就停，简报里照旧一行一个。
// 存在局上（story_sofar:<局>）：{ ids: 盖到的节点编号，从早到晚, text }；分支对不上（编号不是同一串）就从头写。
async function extendSofar(chatKey) {
    const cfg = getConfig(), a = cfg.stages.judge, p = cfg.planner;
    if (!p.judge || !a.baseUrl || !a.apiKey || !p.judgeModel) return;
    const chat = store.requireChat(chatKey);
    const earlier = pastNodesOf(store, chatKey).slice(0, -RECENT_NODES);
    let cur = sofarOf(store, chat.story_id) ?? { ids: [], text: '' };
    if (cur.ids.length > earlier.length || cur.ids.some((id, i) => earlier[i].id !== id)) cur = { ids: [], text: '' };
    for (const node of earlier.slice(cur.ids.length, cur.ids.length + 10)) {
        if (records.spentToday() >= cfg.extractor.dailyBudgetUsd) return;
        const started = Date.now();
        try {
            const r = await createModelClient({ ...a, maxOutputTokens: 1200 }).complete({ system: SOFAR_SYSTEM, user: sofarPrompt(cur.text, node) });
            const costUsd = ((r.usage?.input ?? 0) * p.judgePriceInPerM + (r.usage?.output ?? 0) * p.judgePriceOutPerM) / 1e6;
            records.logAssemble({ chatKey, speaker: '(前情大意)', model: p.judgeModel, servedModel: r.servedModel, status: 'done', usage: r.usage, costUsd, ms: Date.now() - started, raw: r.text });
            const text = parseSofar(r.text);
            if (!text) return;
            cur = { ids: [...cur.ids, node.id], text };
            store.setMeta(`story_sofar:${chat.story_id}`, JSON.stringify(cur));
        } catch (error) {
            records.logAssemble({ chatKey, speaker: '(前情大意)', model: p.judgeModel, status: 'failed', ms: Date.now() - started, error: error.message });
            throw error;
        }
    }
}

// 节点检查（每个剧情日一次，便宜模型）：这个节点算成或明显落空了没有。判定记进 meta，下一次开口时据此叫规划者（N-88）。
// 不排外援：调不通就算了，第二天再看；面板上也能手动要下一份规划。
async function checkNode({ chatKey, planId }) {
    const cfg = getConfig(), a = cfg.stages.judge, p = cfg.planner;
    if (!p.judge || !a.baseUrl || !a.apiKey || !p.judgeModel) return;
    if (records.spentToday() >= cfg.extractor.dailyBudgetUsd) return;
    const plan = store.planById(planId);
    const node = plan?.node ? JSON.parse(plan.node) : null;
    if (!node?.目标) return;
    const lines = nodeCheckLines(store, records, chatKey, planId);
    if (!lines.length) return;
    const started = Date.now();
    try {
        let extra = {};
        try { extra = nodeCheckTaken(store, records, chatKey, planId); } catch {}
        const r = await createModelClient({ ...a, maxOutputTokens: 400 }).complete({ system: withTaste(NODE_CHECK_SYSTEM, { kind: 'judge', model: a.model ?? p.judgeModel, config: cfg }), user: nodeCheckPrompt(node, lines, extra) });
        const costUsd = ((r.usage?.input ?? 0) * p.judgePriceInPerM + (r.usage?.output ?? 0) * p.judgePriceOutPerM) / 1e6;
        records.logAssemble({ chatKey, speaker: '(节点检查)', model: p.judgeModel, servedModel: r.servedModel, status: 'done', usage: r.usage, costUsd, ms: Date.now() - started, raw: r.text });
        const v = parseNodeCheck(r.text);
        log(`plan ${planId} node check: ${v.result}${v.why ? `（${v.why}）` : ''}`);
        // 判定挂在检查时的最后一条消息上（删到它之前、换分支就不算，verdictOf）。
        const last = store.currentMessages(chatKey).at(-1);
        if (v.result !== '还没') store.setMeta(`node_verdict:${planId}`, JSON.stringify({ ...v, at: last ? { pos: last.pos, fp: last.fp } : null }));
    } catch (error) {
        records.logAssemble({ chatKey, speaker: '(节点检查)', model: p.judgeModel, status: 'failed', ms: Date.now() - started, error: error.message });
    }
}

// 局势推演（situation.mjs，Q-8②）：新的剧情日第一次要那一格时顺手跑一次，不等；上次之后没记下新的事就不调模型。
async function loudSituation({ chatKey, ids, why }) {
    const msgs = store.currentMessages(chatKey);
    const tl = timelineFor(store, records, chatKey, msgs);
    const row = tl.rows.at(-1) ?? null;
    const key = `situation_loud:${chatKey}`;
    let prev = null;
    try { prev = JSON.parse(store.getMeta(key) ?? 'null'); } catch {}
    if (prev && row && prev.day === row.day && prev.part === row.part && prev.pos <= (msgs.at(-1)?.pos ?? -1)) return;
    store.setMeta(key, JSON.stringify({ day: row?.day ?? null, part: row?.part ?? null, pos: msgs.at(-1)?.pos ?? 0 }));
    store.setMeta(`situation_ran:${chatKey}`, String(msgs.at(-1)?.pos ?? 0));
    return runSituation({ chatKey, day: tl.today, loud: { ids, why } });
}
// 同一局的局势一次只跑一个：换天那次和闹大了那次前后脚时，后一个等前一个跑完再跑（看得到前一个的结果）
const situationRuns = new Map();
function runSituation(args) {
    const prev = situationRuns.get(args.chatKey) ?? Promise.resolve();
    const next = prev.then(() => situationOnce(args));
    situationRuns.set(args.chatKey, next.catch(() => {}));
    return next;
}
// skip：玩家交代跳过的一段里补跑的那一次（slot.advanceWorld 排的，skip.mjs）：带上这是空白里第几天、玩家交代了什么
async function situationOnce({ chatKey, day, loud = null, skip = null }) {
    const cfg = getConfig(), a = cfg.stages.situation;
    if (!cfg.situation.enabled) return;
    const { baseUrl, apiKey, model } = a;
    if (!baseUrl || !apiKey || !model || records.spentToday() >= cfg.extractor.dailyBudgetUsd) return;
    const m = situationMaterial(store, records, situation, chatKey, { day, net: packOf(chatKey)?.factions ?? null, loud, skip });
    if (!m) return;
    const started = Date.now();
    try {
        const r = await createModelClient({ baseUrl, apiKey, model, maxOutputTokens: 6000, extraBody: a.extraBody }).complete({ system: SITUATION_SYSTEM, user: m.prompt });
        const costUsd = ((r.usage?.input ?? 0) * a.priceInPerM + (r.usage?.output ?? 0) * a.priceOutPerM) / 1e6;
        const v = parseSituation(r.text, { ...m.check, day, seen: m.prompt });
        situation.putTick({ storyId: m.storyId, chatKey, day, anchor: m.anchor, raw: r.text, moves: v.moves, spreads: v.spreads, outcomes: v.outcomes, reviews: v.reviews, lag: skip && !skip.lumped ? Math.max(0, skip.toDay - day) : 0 });
        recordOutcomes(situation, v.outcomes, { anchor: m.anchor, storyId: m.storyId, addRecord: records.addDerived, errands: m.errands });
        for (const x of v.reps ?? []) records.addDerived(repRecord(x, { storyId: m.storyId, anchor: m.anchor }));
        // 后续（N-268：事事有着落）：刚有了结果的事留下的后续，补进眼下这个节点（挂在推演那条消息上，删到它之前就撤回），由合适的人挑时候拿出来
        const plan = store.lastReadyPlan(chatKey);
        if (v.followups.length && plan) {
            store.appendMenu(plan.id, v.followups.map(f => ({ who: f.who, title: f.title, surface: f.surface, respond: f.respond, sink: null, fit: null, weight: f.weight, know: f.know || null, origin: f.origin || null, line: '后续', after: null, motif: f.loud ? NOW_MOTIF : '后续', afterDays: f.afterDays })), { storyDay: day, at: m.anchor });
            log(`situation ${chatKey} day ${day}: follow-ups ${v.followups.map(f => `${f.source}→${f.who}「${f.title}」`).join('、')}`);
        }
        // 镜头外有了动静（D-171，用户 10/6："发酵有了但整体规划反而落后"）：让每轮那次检查看一眼，规划设想的局面还成不成立；不成立就照常重新规划
        if (plan && (v.moves.length || v.spreads.length) && cfg.planner.provider !== 'off') {
            const outside = [...v.moves.map(x => `${x.who}：${x.what}${x.seen ? `（外面看得到：${x.seen}）` : ''}`), ...v.spreads.map(x => `${x.heard}（传到${x.target}，${x.channel}）`)];
            checkTurn({ chatKey, planId: plan.id, outside }).catch(error => log(`plan ${plan.id} outside check failed: ${error.message}`));
        }
        records.logAssemble({ chatKey, speaker: '(局势)', model, servedModel: r.servedModel, status: 'done', usage: r.usage, costUsd, ms: Date.now() - started, lines: v.moves.length + v.spreads.length + v.outcomes.length + v.followups.length, dropped: v.dropped.length, raw: r.text });
        log(`situation ${chatKey} day ${day}${loud ? ' (loud)' : ''}${skip ? ` (skip ${skip.nth}/${skip.of})` : ''}: ${v.moves.length} move(s), ${v.spreads.length} spread(s), ${v.followups.length} follow-up(s), ${v.reps?.length ?? 0} name(s), ${v.reviews?.length ?? 0} old move review(s)${v.dropped.length ? `, dropped ${v.dropped.map(d => d.reason).join('; ')}` : ''}`);
    } catch (error) {
        records.logAssemble({ chatKey, speaker: '(局势)', model, status: 'failed', ms: Date.now() - started, error: error.message });
        log(`situation failed (${chatKey}): ${error.message}`);
    }
}

// 补认约定（recheck.mjs，N-268）：早先记下的打算、答应没有约定那一格——交给记账那档补认一次。run 不为真只给预览（几条、多少字、大概多少钱），不调模型。
// 跨天的收尾核对（用户 10/6："跨天时的收尾核对要做"）：新的一天开始、记账读过了跨天那几条，就把前一天以前还开着的约定和那以后的原文
// 交给记账那档过一遍——办了、不办了、改了、没办成的补一笔了结（引文在原文里找得到才收）。记账当场漏记的（试玩：开回沃森、打给小德、
// 焊门、睡沙发都没记了结，第二天就被递成"到日子没办"），在这儿补上。一个剧情日一次；只看最近 CLOSE_WINDOW 条以内说的。
const CLOSE_WINDOW = 80;
const closeBusy = new Set();
async function runCloseCheck({ chatKey }) {
    const cfg = getConfig(), s = cfg.stages.extract;
    if (cfg.extractor.closeCheck === false || !s?.baseUrl || !s.apiKey || !s.model || closeBusy.has(chatKey)) return { ran: false };
    const chat = store.requireChat(chatKey);
    if (!chat.enabled) return { ran: false };
    const messages = store.currentMessages(chatKey), lastPos = messages.at(-1)?.pos ?? 0;
    const visible = records.visible(chatKey);
    const dayOf = dayIndex([...visible.filter(r => r.type === '时间'), ...timeMarksFor(store, records, chatKey, messages)], lastPos, scaleFor(store, chatKey));
    const today = dayOf(lastPos + 0.5);
    const tl = timelineFor(store, records, chatKey, messages), part = tl.part ?? null;
    const key = `close_check:${chatKey}`;
    let done = null;
    try { done = JSON.parse(store.getMeta(key) ?? 'null'); } catch {}
    // 不只跨天核一遍（用户 10/8："事账里累积了很多排着的，但很多都已经了结了"——线上记账常漏了结，一天只收一回，当天办了的要挂到第二天）：
    // 换了时段（隔了八条以上）、或者四十条没核过，也核一遍。头一回只记下从哪儿起
    if (!done) { store.setMeta(key, JSON.stringify({ day: today, part, at: lastPos })); return { ran: false }; }
    const newDay = done.day < today;
    const newPart = !newDay && !!part && done.part !== part && lastPos - (done.at ?? 0) >= 8;
    const long = !newDay && !newPart && lastPos - (done.at ?? 0) >= 40;
    if (!newDay && !newPart && !long) return { ran: false };
    const rowPart = new Map(tl.rows.map(r => [r.pos, r.part]));
    const since = newDay ? messages.find(m => dayOf(m.pos + 0.5) >= today)?.pos : newPart ? (messages.find(m => dayOf(m.pos + 0.5) === today && rowPart.get(m.pos) === part)?.pos ?? done.at) : done.at;
    if (since == null) return { ran: false };
    // 记账还没读到换天、换时段那几条：等它读完再核（不然刚记下的了结还没进来）
    if (messages.filter(m => m.pos >= since - 2 && m.pos <= since).some(m => !m.hidden && !records.isDone(chat.story_id, m.fp))) return { ran: false };
    const settled = settledBy(visible, { dayOf });
    const candidates = visible.filter(r => r.promise && ['说', '想法'].includes(r.type) && !settled.has(r.id) && r.pos < since && lastPos - r.pos <= CLOSE_WINDOW);
    // 另一半：规矩、要求、打算、记着的状况，还算不算数（只因为一时的状况才有的，那个状况过去了就换下，用户 10/7）
    const stale = staleCandidates(visible, { before: since, lastPos });
    store.setMeta(key, JSON.stringify({ day: today, part, at: lastPos }));
    if ((!candidates.length && !stale.length) || records.spentToday() >= cfg.extractor.dailyBudgetUsd) return { ran: false, candidates: candidates.length, stale: stale.length };
    closeBusy.add(chatKey);
    const started = Date.now();
    try {
        const clean = stripper(cfg.extractor.strip);
        // 原文只给最近 CLOSE_WINDOW 条上下：规矩、状况可能记得更早，表明它过去了的那条在最近
        const user = closePrompt({ promises: candidates, stale, messages: messages.filter(m => !m.hidden && lastPos - m.pos <= CLOSE_WINDOW + 10), clean, perMessage: 400 });
        const r = await createModelClient({ ...cfg.extractor, ...s, maxOutputTokens: 4000, timeoutMs: 300000, stream: true, idleMs: 240000 }).complete({ system: CLOSE_SYSTEM, user });
        const costUsd = ((r.usage?.input ?? 0) * (s.priceInPerM ?? 15) + (r.usage?.output ?? 0) * (s.priceOutPerM ?? 75)) / 1e6;
        const v = parseRecheck(r.text, { candidates, messages, clean });
        const w = parseStale(r.text, { candidates: stale, messages, clean });
        const dropped = [...v.dropped.filter(d => !/编号不在单子上/.test(d.reason)), ...w.dropped];
        records.logAssemble({ chatKey, speaker: '(跨天收尾)', model: s.model, servedModel: r.servedModel, status: 'done', usage: r.usage, costUsd, ms: Date.now() - started, lines: v.closes.length + w.ends.length, dropped: dropped.length, raw: r.text });
        for (const c of v.closes) records.addDerived({ storyId: chat.story_id, fp: c.fp, type: '了结', text: c.text, holder: c.speaker, holderName: c.name, audience: c.audience, quotes: [c.quote], ideaRef: c.id, outcome: c.outcome });
        // 不再算数的：记一笔了结（打算、要求就此关上），再用"改掉"把那条换下（规矩、状况各处都不再拿它）
        for (const e of w.ends) records.addDerived({ storyId: chat.story_id, fp: e.fp, type: '了结', text: e.text, holder: e.speaker, holderName: e.name, audience: e.audience, quotes: [e.quote], ideaRef: e.id, outcome: '不做了', links: [{ to: e.id, kind: '改掉' }] });
        log(`close check ${chatKey} day ${today}: ${candidates.length} open, ${v.closes.length} closed; ${stale.length} standing, ${w.ends.length} ended; dropped ${dropped.length}; ${costUsd.toFixed(3)}`);
        return { ran: true, candidates: candidates.length, stale: stale.length, closes: v.closes.map(({ id, pos, outcome, text }) => ({ id, pos, outcome, text })), ends: w.ends.map(({ id, pos, text }) => ({ id, pos, text })), costUsd };
    } catch (error) {
        records.logAssemble({ chatKey, speaker: '(跨天收尾)', model: s.model, status: 'failed', usage: error.usage ?? null, ms: Date.now() - started, error: error.message });
        log(`close check ${chatKey} failed: ${error.message}`);
        store.setMeta(key, JSON.stringify(done));   // 没成：下回再试
        return { ran: false, error: error.message };
    } finally { closeBusy.delete(chatKey); }
}

async function recheckPromises({ chatKey, run = false }) {
    const cfg = getConfig(), s = cfg.stages.extract;
    const chat = store.requireChat(chatKey);
    const messages = store.currentMessages(chatKey);
    const candidates = recheckCandidates(records.visible(chatKey), { lastPos: messages.at(-1)?.pos ?? 0 });
    if (!candidates.length) return { candidates: [], note: '没有要补认的' };
    const clean = stripper(cfg.extractor.strip);
    const user = recheckPrompt({ candidates, messages, clean });
    const estIn = Math.round((RECHECK_SYSTEM.length + user.length) / 1.3), estOut = 300 + candidates.length * 120;
    const preview = { candidates: candidates.map(r => ({ id: r.id, pos: r.pos, who: r.holder_name, text: r.text })), chars: user.length, model: s.model,
        estUsd: Number((((estIn * (s.priceInPerM ?? 15)) + estOut * (s.priceOutPerM ?? 75)) / 1e6).toFixed(3)) };
    if (!run) return preview;
    if (!s?.baseUrl || !s.apiKey || !s.model) throw Object.assign(new Error('记账那档没配好'), { status: 400 });
    if (records.spentToday() >= cfg.extractor.dailyBudgetUsd) throw Object.assign(new Error('今天后台的花费到上限了'), { status: 400 });
    const started = Date.now();
    const r = await createModelClient({ ...cfg.extractor, ...s, maxOutputTokens: 4000, timeoutMs: 300000, stream: true, idleMs: 240000 }).complete({ system: RECHECK_SYSTEM, user });
    const costUsd = ((r.usage?.input ?? 0) * (s.priceInPerM ?? 15) + (r.usage?.output ?? 0) * (s.priceOutPerM ?? 75)) / 1e6;
    const v = parseRecheck(r.text, { candidates, messages, clean });
    records.logAssemble({ chatKey, speaker: '(补认约定)', model: s.model, servedModel: r.servedModel, status: 'done', usage: r.usage, costUsd, ms: Date.now() - started, lines: v.promises.length + v.closes.length, dropped: v.dropped.length, raw: r.text });
    for (const p of v.promises) records.setPromise(p.id, p.promise);
    for (const c of v.closes) records.addDerived({ storyId: chat.story_id, fp: c.fp, type: '了结', text: c.text, holder: c.speaker, holderName: c.name, audience: c.audience, quotes: [c.quote], ideaRef: c.id, outcome: c.outcome });
    log(`recheck promises ${chatKey}: ${v.promises.length} promise(s), ${v.closes.length} closed, dropped ${v.dropped.length}; $${costUsd.toFixed(3)}`);
    return { ...preview, costUsd, promises: v.promises, closes: v.closes.map(({ id, pos, outcome, text }) => ({ id, pos, outcome, text })), dropped: v.dropped.map(d => d.reason) };
}

// 外援自动重试（面板开关）：每 5 分钟把等着的、能走 API 重试的再试一次，直到成了为止。
setInterval(() => {
    if (store.getMeta('handoff_autoretry') !== '1') return;
    for (const h of handoffs.list()) if (h.retry && !h.busy) {
        const planId = h.kind === 'plan' ? store.handoffById(h.id)?.payload?.meta?.planId : null;
        if (planId != null) planRetryOrigins.set(planId, 'auto');
        handoffs.retry(h.id).catch(() => {}).finally(() => { if (planId != null) planRetryOrigins.delete(planId); });
    }
}, 5 * 60 * 1000).unref();

// 价表、种子表按路径和改动时间缓存，改了文件自动重读。
// 素材包按局选（D-104，T-22：换个题材不能带出别的题材的价码、时事、年表、专名）。meta pack:<局> 记这一局用 素材包/ 下哪个目录；
// 没选就什么都不给（以前 config 里 economy.priceTable、world.*、advisor.library／nameTable 是全局的，每一局都拿同一个包——不再用）。
// 包里的文件都可有可无：物价.json、年表/时事种子.csv、年表/纪年锚点.json、专名对照表.csv；整个目录当参谋的开卷资料。
const packsDir = () => { const configured = loadConfig(home).packs.dir; return configured === '素材包' ? path.join(home, '素材包') : path.resolve(repo, configured); };
const packRoots = () => [...new Set([packsDir(), path.resolve(repo, loadConfig(home).packs.dir), path.join(repo, '素材包')])];
const packFiles = new Map();
const cachedFile = (file, load) => {
    if (!file) return null;
    let key = null;
    try { key = `${file}@${fs.statSync(file).mtimeMs}`; } catch { return null; }
    const hit = packFiles.get(file);
    if (hit?.key === key) return hit.value;
    const value = load(file);
    packFiles.set(file, { key, value });
    return value;
};
function listPacks() {
    return [...new Set(packRoots().flatMap(dir => { try { return fs.readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name); } catch { return []; } }))];
}
function packOf(chatKey) {
    let storyId = null;
    try { storyId = store.requireChat(chatKey).story_id; } catch { return null; }
    const name = store.getMeta(`pack:${storyId}`);
    if (!name || !listPacks().includes(name)) return null;
    const dir = packRoots().map(root => path.join(root, name)).find(d => { try { return fs.statSync(d).isDirectory(); } catch { return false; } });
    const file = rel => (fs.existsSync(path.join(dir, rel)) ? path.join(dir, rel) : null);
    return {
        name, dir, nameTable: file('专名对照表.csv'),
        table: cachedFile(file('物价.json'), loadPriceTable),
        seeds: cachedFile(file('年表/时事种子.csv'), loadSeeds),
        anchors: cachedFile(file('年表/纪年锚点.json'), f => indexAnchors(loadAnchors(f))),
        factions: cachedFile(file('势力网.json'), loadFactionNet),
        facts: cachedFile(file('常识.json'), loadFacts),
    };
}
// 跟后台说话（N-104）：用"跟后台说话"那一环节（不另选就是记账那档）；带着这一局的设定、此刻、和那句话有关的记录。
const talk = createTalk({
    store, records, log,
    client: () => {
        const cfg = getConfig(), s = cfg.stages.talk;
        if (!s?.baseUrl || !s.apiKey || !s.model) return null;
        if (records.spentToday() >= cfg.extractor.dailyBudgetUsd) throw new Error('今天后台的花费到上限了');
        const c = createModelClient({ ...s, maxOutputTokens: 4000, timeoutMs: 240000, stream: true });
        return { complete: args => c.complete(args), model: s.model, priceInPerM: s.priceInPerM, priceOutPerM: s.priceOutPerM };
    },
    context: chatKey => {
        const s = storyContext(store, records, chatKey);
        let clock = null;
        try { clock = clockFor(store, records, chatKey, s.messages); } catch {}
        let edits = [];
        try { edits = JSON.parse(store.getMeta(`edit_report:${chatKey}`) ?? '[]'); } catch {}
        return { s, setup: store.setupOf(s.chat.story_id)?.data ?? null, clock, digest: storyDigest(s.visible, { dayOf: s.dayOf, today: s.today, when: d => relativeDay(d, s.ts), max: 120 }).days, notes: (store.notesOf(chatKey) ?? []).filter(n => n.kind === '聊'), edits };
    },
    plan: chatKey => { const planner = settings().planner; if (planner) requestPlanNow(store, records, chatKey, planner, { reason: 'notes' }); },
});
const stagesAdmin = createStagesAdmin({ home, db: store.db, onKeys: () => { refreshVectors(); } });
const vectors = createVectors({ db: store.db, getConfig, log });
const presets = createPresets({ home });
const tuning = createTuning({ home });
// 这个后台进程是用哪个版本的代码起来的（D-163，试玩 10/5）：ST 关了后台不跟着关，下次开 ST 时插件先把代码快进到最新，
// 可后台还开着，内存里还是旧的——面板一看"已是最新"也不重启，一上午的改动都没用上。拿它和磁盘上的版本比，对不上就该重启。
const bootHead = (() => { try { return execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { timeout: 10000, windowsHide: true }).toString().trim() || null; } catch { return null; } })();
// 跟着正本（D-117）：看有没有新版本；更新＝快进、把扩展和插件拷进 ST，然后自己重启（关掉监听、拉起新的一个、退出）。
// 磁盘上已经是新的、自己跑的还是旧的（stale），也重启。
const release = !follow ? null : {
    check: async () => {
        const s = await checkRelease({ repo, follow });
        return s.ok ? { ...s, running: bootHead?.slice(0, 7) ?? null, stale: !!bootHead && !!s.headFull && s.headFull !== bootHead } : s;
    },
    apply: async () => {
        const r = await applyRelease({ repo, stRoot, follow });
        const stale = r.ok && !!bootHead && !!r.headFull && r.headFull !== bootHead;
        const restarted = r.ok && (r.updated || stale);
        if (restarted) setTimeout(restartSelf, 500);
        return { ...r, stale, restarted };
    },
};
// 转发插件交来的代理（--proxy，ST 自己出网用的那个）：自己重启时照样带上，不靠碰巧继承的环境变量。
const withProxy = env => { const e = proxyEnv({ ...env, NODE_USE_ENV_PROXY: '1' }, outProxy); delete e.RPE_PROXY_RESPAWN; return e; };
function restartSelf() {
    log('restarting after update');
    const again = () => {
        const child = spawn(process.execPath, [...process.execArgv, ...process.argv.slice(1)], { detached: true, stdio: 'ignore', windowsHide: true, env: withProxy(process.env) });
        child.unref();
        worker.stop(); store.close(); process.exit(0);
    };
    server.close(again);
    setTimeout(again, 5000).unref();
}
// 向量（D-110）：钥匙簿里哪把能调（没选时自动用它），各窗口的旧记录补转。启动时、存了钥匙或改了"向量"环节时跑一遍；同时只跑一份。
// 一局几百条记录转一遍不到一分钱。
let embedJob = null;
function refreshVectors() {
    if (embedJob) return embedJob;
    embedJob = (async () => {
        await stagesAdmin.probeEmbeds().catch(error => log(`embed probe failed: ${error.message}`));
        if (!vectors.ready()) return;
        let n = 0;
        for (const { key } of store.db.prepare('select key from chats where enabled = 1').all()) {
            try { n += await vectors.ensure(records.visible(key).filter(r => r.type !== '时间'), key); } catch (error) { log(`vectors backfill ${key} failed: ${error.message}`); }
        }
        if (n) log(`vectors backfill: ${n} record(s)`);
    })().finally(() => { embedJob = null; });
    return embedJob;
}
// ---------- 自动进离场与调度（core/auto.mjs，方案 1b；D-201）----------
// 便宜模型（去复读那档）判"玩家这句是不是在回他"：叩门状态机认不出的那几句才问，一句一次
async function judgeKnock({ chatKey, who, way, knock, text }) {
    const cfg = getConfig(), a0 = cfg.stages.fresh;
    if (!a0?.baseUrl || !a0.apiKey || !a0.model || records.spentToday() >= cfg.extractor.dailyBudgetUsd) return null;
    const started = Date.now();
    try {
        const r = await createModelClient({ ...a0, maxOutputTokens: 20 }).complete({ system: renderPronouns(KNOCK_JUDGE_SYSTEM, { ...playerContext(store, chatKey), person: who }), user: knockJudgePrompt({ who, way, knock, text }) });
        const costUsd = ((r.usage?.input ?? 0) * a0.priceInPerM + (r.usage?.output ?? 0) * a0.priceOutPerM) / 1e6;
        records.logAssemble({ chatKey, speaker: '(叩门回应)', model: a0.model, servedModel: r.servedModel, status: 'done', usage: r.usage, costUsd, ms: Date.now() - started, raw: r.text });
        return parseKnockJudge(r.text);
    } catch (error) {
        records.logAssemble({ chatKey, speaker: '(叩门回应)', model: a0.model, status: 'failed', usage: error.usage ?? null, ms: Date.now() - started, error: error.message });
        return null;
    }
}
// 同步之后：候着的那条写出来了没有、每次叩门走到哪一步（进场／作废）
const autoBusy = new Map();   // chatKey → 正在跑的那一次（同步钩子起的；扩展问"谁接"时先等它跑完，别拿到作废前的旧账）
async function autoRun({ chatKey }) {
    const cfg = getConfig();
    if (!cfg.auto?.enabled) return { ok: true, skipped: true };
    if (autoBusy.has(chatKey)) return autoBusy.get(chatKey);
    const work = autoRunNow({ chatKey, cfg });
    autoBusy.set(chatKey, work);
    try { return await work; } finally { autoBusy.delete(chatKey); }
}
async function autoRunNow({ chatKey, cfg }) {
    try {
        const r = await knockAdvance(store, records, chatKey, { arrive, judge: judgeKnock, config: cfg });
        if (r.finalized || r.entered.length || r.lapsed.length) log(`auto ${chatKey}: ${[r.finalized ? `${r.finalized.who} 叩门（${r.finalized.way}）` : '', ...r.entered.map(k => `${k.who} 进场`), ...r.lapsed.map(k => `${k.who} 作废（${k.lapsed.why}）`)].filter(Boolean).join('、')}`);
        // 门上到时候了的那一位：进场那份先理好（几条内理过的不重理），时机到了直接叩、不用等几十秒
        if (cfg.auto.knock && !pendingKnock(store, chatKey) && !waitingKnock(store, records, chatKey)) {
            const c = knockCandidate(store, records, chatKey, {});
            const last = store.currentMessages(chatKey).filter(m => !m.hidden).at(-1);
            let prep = null; try { prep = JSON.parse(store.getMeta(`knock_prep:${chatKey}`) ?? 'null'); } catch {}
            if (c?.who && last && !(prep && prep.who === c.who && prep.mode === c.mode && last.pos - prep.pos < 6)) {
                store.setMeta(`knock_prep:${chatKey}`, JSON.stringify({ who: c.who, mode: c.mode, pos: last.pos }));
                arrive({ chatKey, who: c.who, avatar: c.avatar, prepare: true, mode: c.mode, way: c.way, knock: true }).catch(() => {});
            }
        }
        return { ok: true, ...r };
    } catch (error) { log(`auto ${chatKey} failed: ${error.message}`); return { ok: false }; }
}
// 扩展问"谁接"：排好的队；没人该说、时机到了就叩门（候着的一条先理进场那份，扩展叫他写）；候着的那一个；谁走了（记去向，扩展关区间、静音）
// peek：只看开没开、谁候着、谁刚作废（扩展打开窗口、每条之后先问一下），不排队、不叩门、不记谁走了
async function autoTurn({ chatKey, present = [], recentUser = '', peek = false }) {
    const cfg = getConfig();
    const off = { enabled: false, queue: [], why: '关着', knock: null, waiting: null, left: [], lapsed: [] };
    if (!cfg.auto?.enabled) return {...off,left:takePendingLeft(store,chatKey),turnEnabled:false,buttons:cfg.auto?.buttons!==false};
    // remote：此刻远程（发消息、打电话）的人——扩展给他们写出来的每一条打上谁看得见的记号（同屋人看不见）
    const remoteNow = () => { try { return boardFor(store, records, chatKey, { present, timeline: timelineFor(store, records, chatKey, store.currentMessages(chatKey)) }).people.filter(p => p.status === 'remote').map(p => ({ who: p.name, avatar: p.avatar ?? null, way: p.way ?? '消息' })); } catch { return []; } };
    const tail = () => ({ enabled: true, turnEnabled:cfg.auto.turn!==false, buttons:cfg.auto.buttons!==false, waiting: waitingKnock(store, records, chatKey), lapsed: recentLapsed(store, chatKey), remote: remoteNow() });
    if (peek) return { ...off, ...tail(), left:takePendingLeft(store,chatKey) };
    if (autoBusy.has(chatKey)) await autoBusy.get(chatKey).catch(() => {});   // 同步那一下还在理叩门：等它
    const found = autoLeave(store,records,chatKey,{present,config:cfg});
    if(found.length) markLeft(store,chatKey,found);
    for(const l of found) leave({chatKey,who:l.who,avatar:l.avatar,anchor:l,how:l.how}).catch(error=>log(`leave plan failed: ${error.message}`));
    const left=takePendingLeft(store,chatKey);
    const t = turnFor(store, records, chatKey, { present, recentUser, config: cfg });
    let knock = pendingKnock(store, chatKey);
    // 叩门的时机（空当：承接的一句、刚换时段、旁白刚写完、身边没人）到了就先叩，屋里的人"顺着接一手"那类弱由头让位；玩家点了名的那一句照样先答
    if (!knock && !t.queue.some(q => q.role === '答')) {
        const k = knockNow(store, records, chatKey, { present, config: cfg });
        if (k.ok) {
            t.queue = [];
            knock = beginKnock(store, chatKey, k);
            log(`auto ${chatKey}: ${k.who} 该来了（${k.way}，${k.label}）`);
            // 进场那份按叩门那条接上（提前理过的几秒就回；没理过的这里等模型几十秒）：他那条写出来时怎么来的、为什么来已经在他那一格里
            try { await arrive({ chatKey, who: k.who, avatar: k.avatar, mode: k.mode, way: k.way, anchor: { at: k.at, fp: k.fp }, knock: true }); } catch (error) { log(`auto ${chatKey}: arrive for knock failed ${error.message}`); }
        } else t.why = t.why ? `${t.why}；${k.why}` : k.why;
    }
    // 调度式预跑：排在头一个的，这句的那一格先组装起来（打字时的草稿和发出去的不一样时，草稿那份用不上）
    const first = t.queue.find(q => q.avatar);
    if (first && recentUser) try { prefetchFor(store, records, { assembler, keyMaker }, { chatKey, recentUser, present, only: [first.avatar] }); } catch {}
    const out = { queue: t.queue, why: t.why, knock: knock ? { who: knock.who, avatar: knock.avatar, way: knock.way, at: knock.at, label: knock.label ?? '' } : null, left, ...tail() };
    log(`turn ${chatKey}: [${out.queue.map(q => `${q.who}·${q.role}${q.back ? '·叫回来' : ''}`).join(' ')}]${out.knock ? ` 叩门 ${out.knock.who}（${out.knock.way}）` : ''}${out.waiting ? ` 候着 ${out.waiting.who}` : ''}${out.lapsed.length ? ` 作废 ${out.lapsed.map(l => l.who).join(' ')}` : ''}${out.left.length ? ` 走了 ${out.left.map(l => l.who).join(' ')}` : ''}${!out.queue.length ? ` — ${out.why}` : ''}`);
    return out;
}
// 打字时预跑问"这句之后谁会开口"（server /v1/prefetch）：排到的人、门上该叩的那位；关着返回 null（照旧替在场的人都预跑）
function autoPredict({ chatKey, present = [], recentUser = '' }) {
    const cfg = getConfig();
    if (!cfg.auto?.enabled || !cfg.auto.turn) return null;
    const t = turnFor(store, records, chatKey, { present, recentUser, config: cfg });
    const out = t.queue.map(q => q.avatar).filter(Boolean);
    if (!out.length && cfg.auto.knock) { const c = knockCandidate(store, records, chatKey, { present }); if (c?.avatar) out.push(c.avatar); }
    return out;
}
async function autoAnswer({ chatKey, who, answer }) {
    const r = answerKnock(store, chatKey, { who, answer });
    if (r.ok) await autoRun({ chatKey });
    return r;
}

const settings = () => {
    const config = loadConfig(home);
    return { code: bootHead, refreshPlanPackets, arrive, leave, settle: settleAway, recheckPromises, packsDir, stRoot, backupsDir: path.join(home, 'backups'), auto: { run: autoRun, turn: autoTurn, answer: autoAnswer, predict: autoPredict, acknowledge: ({chatKey,receipts})=>acknowledgeLeaves(store,chatKey,receipts), unjudged: ({ chatKey }) => leaveDoubts(store, records, chatKey, { config }).length }, glance: { run: runGlance }, closeCheck: { run: runCloseCheck }, packOf, listPacks, presets, tuning, release, talk, lore: { run: runLore }, materials: { ...materials, look: lookMaterials, relations: materialRelations }, drift: { ...config.drift, run: runLong }, stages: stagesAdmin, profile: { make: makeProfile }, modelTally, scene: { run: runScene }, state: config.state.enabled ? { run: runState } : null, episodes: config.episodes.enabled ? { run: runEpisodes } : null, vectors, contacts: config.contacts, extract: { auto: config.extractor.auto }, slot: config.slot, cast: config.cast, absence: { ...config.absence, think: thinkAway, revise: reviseAway }, mood: config.mood, pace: config.pace, fresh: { ...config.fresh, dir: path.join(home, '口吻'), bound: hasBoundVoice, run: freshMessage }, planner: config.planner.provider === 'off' ? null : { ...config.planner, onRequest, checkNode, checkTurn, onPlace: placeSupplement, factionNet: chatKey => packOf(chatKey)?.factions ?? null, prices: chatKey => packOf(chatKey)?.table ?? null, facts: chatKey => packOf(chatKey)?.facts ?? null, situation }, situation: config.situation.enabled ? { sit: situation, run: runSituation } : null, offstage: config.offstage?.enabled === false ? null : { ...config.offstage, ask: config.offstage?.ask ? askAway : null } };
};
const server = createServer(store, { log, worker, records, assembler, keyMaker, advisor, setupMaker, keysMaker, handoffs, settings });
server.on('error', error => {
    log(`listen failed: ${error.message}`);
    console.error(error.code === 'EADDRINUSE' ? `端口 ${port} 已被占用（后台可能已经在运行）` : error.message);
    process.exit(1);
});
server.listen(port, '127.0.0.1', () => {
    log(`started v${VERSION} on 127.0.0.1:${port}, home ${home}, 出网代理 ${process.env.NODE_USE_ENV_PROXY === "1" && (process.env.HTTPS_PROXY || process.env.HTTP_PROXY) ? "开" : "没有"}`);
    console.log(`rp_emergence 后台 v${VERSION} 已启动：127.0.0.1:${port}，数据在 ${home}`);
    refreshVectors();
    refreshProfiles().catch(error => log(`profile refresh failed: ${error.message}`));
});
const stop = () => { worker.stop(); server.close(); store.close(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
