// T154a 登记表：后台记的每一类"窗口知道的东西"——每个 meta 键前缀、每张表——各自属于哪一层、现在怎么继承、该怎样、总账哪一行。
// 纯数据，不读库、不写库。state-dump.mjs 按它逐项倒；tests/core/t154a-registry.test.mjs 扫 core/ 核对没有漏登。
//
// 栏：
//   key        倒出来的对象里这一类的名字（table:xxx / meta:xxx），也是 t154b-known-red.json 的键
//   scope      作用域：window 窗｜story 局｜plan 规划编号｜step 菜单步骤（菜单项）编号｜fp 消息指纹｜global 全局
//   suffix     键名在 前缀:${窗或局} 之后还带什么：none｜who（人名）｜menu（菜单项编号）｜plan（规划编号）｜fp（指纹）｜ver（版本号）｜avatar（头像）
//   inherit    现在分支怎么继承：none 不继承｜follow-parent 顺着父窗读｜copy 整份复制｜follow-message 跟着消息（同局同指纹同一行）
//   should     判据该怎样（总账＋D-403/D-405）：
//                per-window      各窗各自，分支只带切出那一楼以前的
//                copy-at-fork    分支时带一份走，之后各改各的（D-405 第 2 条：这一局的设定）
//                follow-message  挂在消息上，天然满足
//                follow-owner    跟着它依附的那一行（规划、菜单项）
//                cache           缓存/游标/提示，不继承，读时从消息重推
//                shared          跨局共用，保持（读卡资料、全局离开暂停）
//                counter         内部序号，不进比较
//                diagnostic      日志/流水，只供排查
//   status     总账里这一类在三句判据上的记号（1 新聊天=空局｜2 分支=父窗删回到第 k 楼｜3 之后互不相干）：Y 满足 N 不满足 P 部分 ? 要量
//   ledger     总账行号（C9、D13……）；总账里没有的写 +新 并在 ADDED 里说明
//   knows      这一类的值会不会改变"这个窗知道的一切"。false＝缓存/游标/面板提示/序号，从消息能重推，不进三句判据的比较（倒在 cache 栏里，只看不比）
//   strip      倒出来前要去掉的字段名（递归；时间戳、自增编号这类不影响"知道什么"的）
//   dump       false＝这一类不进倒出来的东西（全局向量缓存、meta 表本身）
const meta = (prefix, scope, suffix, inherit, should, status, ledger, opts = {}) => ({
    key: `meta:${prefix}`, kind: 'meta', prefix, scope, suffix, inherit, should, status, ledger, knows: true, strip: [], ...opts });
const table = (name, scope, inherit, should, status, ledger, opts = {}) => ({
    key: `table:${name}`, kind: 'table', table: name, scope, inherit, should, status, ledger, knows: true, strip: [], ...opts });

// 一律去掉的字段（倒出来时递归）：库内自增编号、各种时间戳、窗口/局的随机标识——换一个库、换一个窗倒出来不该因此不同
export const DROP_FIELDS = ['id', 'chat_key', 'story_id', 'chatKey', 'storyId', 'created_at', 'updated_at', 'ready_at', 'closed_at',
    'started_at', 'finished_at', 'first_seen', 'joined_at', 'synced_at', 'authorization', 'st_chat_id', 'group_id', 'label'];

export const TABLES = [
    // —— 第 1 种：挂在消息上、整局共用 ——
    table('messages', 'fp', 'follow-message', 'follow-message', 'YYP', 'A1', { note: 'vis/lore 回填走同一行 coalesce，一窗补写别窗读到' }),
    table('records', 'fp', 'follow-message', 'follow-message', 'YYY', 'A2', { strip: ['job_id', 'idea_ref'], note: '读口 records.visible；"当时谁在场"读时按本窗重算' }),
    table('record_vectors', 'global', 'follow-message', 'cache', 'YYY', 'A2', { knows: false, dump: false, note: '向量缓存，按记录编号；不倒' }),
    table('text_vectors', 'global', 'follow-message', 'cache', 'YYY', 'A2', { knows: false, dump: false, note: '向量缓存，按文本；不倒' }),
    table('extract_done', 'fp', 'follow-message', 'follow-message', 'YYY', 'A3', { strip: ['job_id'] }),
    table('record_links', 'fp', 'follow-message', 'follow-message', 'YYY', 'A4', { note: '读口 records.visible 的 closed_by/superseded_by 带出；不单倒' }),
    table('state_notes', 'fp', 'follow-message', 'follow-message', 'YYY', 'A5'),
    table('episodes', 'fp', 'follow-message', 'follow-message', 'YYP', 'A6', { strip: ['model'], note: 'editEpisode 改的是共用那一行' }),
    table('situation_ticks', 'fp', 'follow-message', 'follow-message', 'YYY', 'A7', { strip: ['raw', 'time_basis'] }),
    table('situation_moves', 'fp', 'follow-message', 'follow-message', 'YYY', 'A7', { strip: ['tick_id'] }),
    table('situation_move_reviews', 'fp', 'follow-message', 'follow-message', 'YYY', 'A7', { strip: ['tick_id', 'move_id'] }),
    table('situation_spreads', 'fp', 'follow-message', 'follow-message', 'YYY', 'A7', { strip: ['tick_id', 'record_id', 'source'] }),
    table('situation_outcomes', 'fp', 'follow-message', 'follow-message', 'YYY', 'A7', { strip: ['tick_id', 'record_id', 'source'] }),
    // —— 第 2 种：按窗口记的表 ——
    table('chats', 'window', 'copy', 'per-window', 'YNY', 'B1', { strip: ['parent_key', 'branch_len'], note: 'open() 手工复制 members/anchors/test_slot/extract_from/extract；anchors 不按第 k 楼截' }),
    table('chat_seq', 'window', 'none', 'per-window', 'YYY', 'B2', { note: '读口 currentMessages' }),
    table('plans', 'window', 'follow-parent', 'per-window', 'YYP', 'B3', { strip: ['provider', 'error'], note: '读口 plansOf（historyOf 顺着父窗读，锚点 ≤ 分叉点）；规划编号用第几份代替' }),
    table('menu', 'window', 'follow-parent', 'follow-owner', 'YYY', 'B4', { strip: ['plan_id', 'pocket_step', 'settled_step', 'conditionStep', 'conditionSteps', 'verification', 'beforeVerification'], note: '读口 menuOf(all:true)' }),
    table('menu_log', 'window', 'follow-parent', 'per-window', 'YYY', 'B5', { strip: ['item_id', 'by_plan'], note: 'h.sees(chat_key,pos,fp)' }),
    table('intimate_progress', 'window', 'follow-parent', 'per-window', 'YYY', 'B6', { strip: ['plan_id'] }),
    table('intimate_stops', 'window', 'follow-parent', 'per-window', 'YYY', 'B7', { strip: ['plan_id'] }),
    table('absences', 'window', 'follow-parent', 'per-window', 'YYP', 'B8', { strip: ['story_status'], note: 'T154i：行按切点过滤（sees，父窗删楼后子窗看父窗的行仍随父窗 chat_seq 变，这是读口不是读过/处理，未动）；读过/处理结果/天数的本窗覆盖存 meta absence_ov，继承来的行不改' }),
    table('slots', 'window', 'none', 'cache', 'YPY', 'B9', { knows: false, note: '钉住的那一格，分支重新组格，当缓存' }),
    table('carries', 'window', 'follow-parent', 'per-window', 'YYY', 'B10', { note: '读口 carryBefore：同局别窗的余波，前提是连那条回复都一样' }),
    table('snapshots', 'window', 'none', 'cache', 'YPY', 'B11', { knows: false, strip: ['at'], note: '删回去后对账用的小快照；每窗留最近 400 条' }),
    table('notes', 'window', 'none', 'per-window', 'YNY', 'B12', { strip: ['used_in_plan'], note: '/写 /玩 /聊 笔记；只读本窗 chat_key' }),
    table('contact_offers', 'window', 'none', 'per-window', 'YNY', 'B13', { note: '读口 contactOffers(chatKey) 只读本窗' }),
    table('handoffs', 'window', 'none', 'per-window', 'YYY', 'B14', { strip: ['result', 'payload'], note: 'T154i：pending 只认 chat_key＝本窗（加全局无 chat_key 的）；父窗的包进 others；带窗口的交回/放弃校验属于本窗，命令行不带 chatKey 不受限' }),
    table('plan_attempts', 'window', 'none', 'diagnostic', 'YYY', 'B15', { knows: false, note: '规划尝试流水' }),
    table('events', 'window', 'none', 'diagnostic', 'YYY', 'B16', { knows: false, note: '事件日志（join/branch/renamed/sync…）；开分支时本来就多一条 branch' }),
    table('extract_jobs', 'window', 'none', 'diagnostic', 'YYY', 'B17', { knows: false, note: '记账任务流水' }),
    table('assemble_calls', 'window', 'none', 'diagnostic', 'YYY', 'B17', { knows: false, note: '组格调用流水' }),
    // —— 第 4 种：整局共用、不分窗口 ——
    table('stories', 'story', 'copy', 'copy-at-fork', 'YYY', 'D1', { note: '局的身份；分支同一局' }),
    table('cast', 'story', 'copy', 'copy-at-fork', 'YNN', 'D2', { note: '名册；同局任一窗改、alignCastToGroup 自动对齐，别窗跟着变' }),
    table('relations', 'story', 'copy', 'copy-at-fork', 'YNN', 'D3'),
    table('setups', 'story', 'copy', 'copy-at-fork', 'YNN', 'D4', { strip: ['source', 'cost', 'error', 'unchecked'], note: '常用读口 setupOf 最新确认版' }),
    table('lore', 'story', 'copy', 'copy-at-fork', 'YNN', 'D5', { strip: ['hash'] }),
    table('card_groups', 'story', 'copy', 'copy-at-fork', 'YNN', 'D6', { note: '读口 declarationsOf' }),
    table('card_profiles', 'global', 'copy', 'shared', 'PNN', 'D7', { strip: ['hash', 'card_hash'], note: '按卡存，跨局共用，保持' }),
    table('meta', 'global', 'none', 'per-window', '---', '-', { knows: false, dump: false, note: '键值表本身；按前缀逐项登记在 META' }),
];

export const META = [
    // C1 时间与离开计时
    meta('act', 'window', 'none', 'none', 'cache', 'Y?Y', 'C1', { knows: false, strip: ['last'], note: '最近一次动静；缺失时按消息时间重估' }),
    meta('gap', 'window', 'none', 'none', 'cache', 'Y?Y', 'C1', { knows: false, strip: ['from', 'to'] }),
    meta('gone_sent', 'window', 'none', 'none', 'cache', 'Y?Y', 'C1', { knows: false, note: '删掉的消息里最晚的发送时间（毫秒）' }),
    meta('world_day', 'window', 'none', 'none', 'cache', 'Y?Y', 'C1', { knows: false, note: '世界那一天的缓存，带 timeBasis' }),
    meta('skips', 'window', 'none', 'none', 'per-window', 'Y?Y', 'C1', { note: '玩家交代的跳时间；读时 liveSkips 核消息' }),
    meta('skip_scene', 'window', 'none', 'none', 'per-window', 'Y?Y', 'C1', { strip: ['planId'] }),
    // C2a/C2b 进场（主窗第十五封：拆成"在不在"和"怎么来的、带什么来意"两行）
    meta('anchors_raw', 'window', 'none', 'copy', 'per-window', 'YNY', 'C2a', { note: '进场·在不在：隔离扩展原样的在场区间；来自 ST 元数据整份，分支不按 k 截。后台读成 chats.anchors（landing.liveAnchors）' }),
    meta('confirm_floor', 'window', 'none', 'none', 'per-window', 'Y?Y', '+新(C2a)', { note: '进场·在不在：确认楼（T150b），总账没有，随 anchors_raw 一起算' }),
    meta('arrivals', 'window', 'none', 'follow-parent', 'per-window', 'YYY', 'C2b', { note: '进场·怎么来的、带什么来意：每次进场的 how/why/brief/source_basis；sourceProjection 读同局各窗，按 limits 只到分叉点' }),
    meta('arrived', 'window', 'none', 'none', 'per-window', 'YYY', 'C2b', { note: '进场·怎么来的：最近一次进场的镜像（刚进场的人）。总账 C2 整行记 Y，但代码里只有 arrivals 顺着父窗读，arrived 只读本窗键（T154b 量）' }),
    // C3 到访/离场过程
    meta('arrival_brief', 'window', 'none', 'none', 'cache', 'Y?Y', 'C3', { knows: false, note: '进场前备好的简报，进场时清掉' }),
    meta('arrival_hold', 'window', 'none', 'none', 'cache', 'Y?Y', 'C3', { knows: false }),
    meta('arrival_offer', 'window', 'none', 'none', 'cache', 'Y?Y', 'C3', { knows: false }),
    meta('arrival_request', 'window', 'none', 'none', 'cache', 'Y?Y', 'C3', { knows: false }),
    meta('knocks', 'window', 'none', 'none', 'per-window', 'Y?Y', 'C3', { note: '叩门记录，readMeta 统一按来源过滤' }),
    meta('knock_pending', 'window', 'none', 'none', 'per-window', 'Y?Y', 'C3'),
    meta('knock_prep', 'window', 'none', 'none', 'cache', 'Y?Y', 'C3', { knows: false }),
    meta('came_ask', 'window', 'none', 'none', 'cache', 'Y?Y', 'C3', { knows: false }),
    meta('leave_ask', 'window', 'none', 'none', 'cache', 'Y?Y', 'C3', { knows: false }),
    meta('auto_came', 'window', 'none', 'none', 'per-window', 'Y?Y', 'C3'),
    meta('auto_left', 'window', 'none', 'none', 'per-window', 'Y?Y', 'C3'),
    meta('auto_left_pending', 'window', 'none', 'none', 'cache', 'Y?Y', 'C3', { knows: false }),
    meta('auto_leave_events', 'window', 'none', 'none', 'per-window', 'Y?Y', 'C3'),
    meta('auto_execution', 'window', 'none', 'none', 'per-window', 'Y?Y', 'C3'),
    meta('auto_execution_retired', 'window', 'none', 'none', 'per-window', 'Y?Y', 'C3'),
    // C4 门与路标
    meta('door_lit', 'window', 'none', 'none', 'cache', 'YNY', 'C4', { knows: false, note: '门上亮着的那一下，只在最近 4 楼内有效' }),
    meta('door_wait', 'window', 'none', 'none', 'cache', 'YNY', 'C4', { knows: false }),
    meta('branch_cut', 'window', 'none', 'none', 'per-window', 'Y?Y', 'C2a', { knows: false, note: 'T154c 分支切过一次的标记' }),
    meta('door_handoffs', 'window', 'none', 'copy', 'per-window', 'YNY', 'C4', { note: 'open() 开分支时整份复制，不按 k 截' }),
    meta('guide_picks', 'window', 'none', 'none', 'cache', 'YNY', 'C4', { knows: false }),
    meta('guide_shown', 'window', 'none', 'none', 'cache', 'YNY', 'C4', { knows: false }),
    // C5 约定了结/联络判定
    meta('settled', 'window', 'who', 'none', 'per-window', 'Y?Y', 'C5'),
    meta('settled_contact', 'window', 'who', 'none', 'per-window', 'Y?Y', 'C5'),
    meta('crew_pushed', 'window', 'who', 'none', 'per-window', 'Y?Y', 'C5'),
    meta('contact_verdict', 'window', 'ver', 'none', 'cache', 'Y?Y', 'C5', { knows: false }),
    meta('contact_verdict_revision', 'window', 'none', 'none', 'counter', 'Y?Y', 'C5', { knows: false }),
    meta('away_plan', 'window', 'none', 'none', 'per-window', 'Y?Y', 'C5'),
    // C6 认卡/人设
    meta('card_choices', 'window', 'none', 'none', 'per-window', 'Y?Y', 'C6', { note: '谁是哪张卡的选择；改变认人' }),
    meta('persona', 'window', 'none', 'none', 'per-window', 'Y?Y', 'C6', { strip: ['at'], note: '玩家人设（名字、说明）' }),
    meta('plan_persona_wait', 'window', 'none', 'none', 'cache', 'Y?Y', 'C6', { knows: false, strip: ['id'] }),
    // C7 规划过程、推演节拍
    meta('plan_eval', 'window', 'none', 'none', 'cache', 'Y?Y', 'C7', { knows: false }),
    meta('plan_revision', 'window', 'none', 'none', 'counter', 'Y?Y', 'C7', { knows: false }),
    meta('turn_checked', 'window', 'none', 'none', 'cache', 'Y?Y', 'C7', { knows: false }),
    meta('turn_acts_at', 'window', 'none', 'none', 'cache', 'Y?Y', 'C7', { knows: false }),
    meta('situation_ran', 'window', 'none', 'none', 'cache', 'Y?Y', 'C7', { knows: false }),
    meta('situation_echoes', 'window', 'none', 'none', 'per-window', 'Y?Y', 'C7', { note: '推演余响，等到点才递出' }),
    meta('situation_loud', 'window', 'none', 'none', 'cache', 'Y?Y', 'C7', { knows: false }),
    meta('brief_cut', 'window', 'none', 'none', 'cache', 'Y?Y', 'C7', { knows: false }),
    meta('close_check', 'window', 'none', 'none', 'cache', 'Y?Y', 'C7', { knows: false }),
    meta('episodes_try', 'window', 'none', 'none', 'cache', 'Y?Y', 'C7', { knows: false }),
    meta('gaps_done', 'window', 'plan', 'none', 'cache', 'Y?Y', 'C7', { knows: false }),
    meta('fallback_wait', 'window', 'none', 'none', 'cache', 'Y?Y', 'C7', { knows: false }),
    meta('matters_since', 'window', 'none', 'none', 'cache', 'Y?Y', 'C7', { knows: false }),
    // C8 角色心思、兴头、承诺、场景游标
    meta('impulse', 'window', 'none', 'none', 'per-window', 'Y?Y', 'C8'),
    meta('impulses', 'window', 'none', 'none', 'per-window', 'Y?Y', 'C8'),
    meta('promise_given', 'window', 'none', 'none', 'per-window', 'Y?Y', 'C8'),
    meta('promise_told', 'window', 'none', 'none', 'per-window', 'Y?Y', 'C8'),
    meta('matter_cont', 'window', 'menu', 'none', 'cache', 'Y?Y', 'C8', { knows: false }),
    meta('matter_restart', 'window', 'none', 'none', 'cache', 'Y?Y', 'C8', { knows: false }),
    meta('inform_since', 'window', 'none', 'none', 'cache', 'Y?Y', 'C8', { knows: false }),
    meta('intimate_stop', 'window', 'none', 'none', 'per-window', 'Y?Y', 'C8'),
    meta('idle_hold', 'window', 'none', 'none', 'cache', 'Y?Y', 'C8', { knows: false }),
    meta('idle_nudge', 'window', 'none', 'none', 'cache', 'Y?Y', 'C8', { knows: false }),
    meta('offstage_reply', 'window', 'who', 'none', 'per-window', 'Y?Y', 'C8'),
    meta('offstage_seen', 'window', 'none', 'none', 'cache', 'Y?Y', 'C8', { knows: false }),
    meta('offstage_since', 'window', 'none', 'none', 'cache', 'Y?Y', 'C8', { knows: false }),
    meta('segments_seen', 'window', 'none', 'none', 'cache', 'Y?Y', 'C8', { knows: false }),
    meta('scene_seen', 'window', 'none', 'none', 'cache', 'Y?Y', 'C8', { knows: false }),
    meta('scene_moved', 'window', 'none', 'none', 'cache', 'Y?Y', 'C8', { knows: false }),
    meta('user_state', 'window', 'none', 'none', 'per-window', 'Y?Y', 'C8'),
    meta('event_echo', 'window', 'none', 'none', 'per-window', 'Y?Y', 'C8'),
    meta('event_lead', 'window', 'none', 'none', 'per-window', 'Y?Y', 'C8'),
    meta('event_moves', 'window', 'none', 'none', 'per-window', 'Y?Y', 'C8'),
    meta('fresh_ways', 'window', 'who', 'none', 'per-window', 'Y?Y', 'C8'),
    meta('menu_checks', 'window', 'menu', 'none', 'per-window', 'Y?Y', 'C8', { note: '菜单项核验日志；menuOf 读它改状态' }),
    meta('errand', 'window', 'menu', 'none', 'cache', '+新', '+新(C8)', { knows: false, note: '去办的事上次递出的位置（冷却游标），总账没有' }),
    meta('advanced', 'window', 'none', 'none', 'cache', '+新', '+新(C7)', { knows: false, note: '场景推进缓存（slot.mjs 1976），总账没有' }),
    // C9 面板提示与维护
    meta('notice', 'window', 'none', 'none', 'cache', 'Y?Y', 'C9', { knows: false }),
    meta('secret_notice', 'window', 'none', 'none', 'cache', 'Y?Y', 'C9', { knows: false }),
    meta('drift', 'window', 'none', 'none', 'cache', 'Y?Y', 'C9', { knows: false }),
    meta('edit_report', 'window', 'none', 'none', 'cache', 'Y?Y', 'C9', { knows: false }),
    meta('talk', 'window', 'none', 'none', 'per-window', 'Y?Y', 'C9', { note: '/聊 对话轮次' }),
    meta('handoff_autoretry', 'window', 'none', 'none', 'cache', 'Y?Y', 'C9', { knows: false, note: '外援自动重试开关（本窗设置）' }),
    meta('swipe_repair_rev', 'window', 'none', 'none', 'counter', 'Y?Y', 'C9', { knows: false }),
    meta('sync_rev', 'window', 'none', 'none', 'counter', 'Y?Y', 'C9', { knows: false }),
    meta('authorization_rev', 'window', 'none', 'none', 'counter', 'Y?Y', 'C9', { knows: false, note: '键还有 authorization_rev:story:<局> 一种；都是内部序号' }),
    meta('ordinary_collision', 'window', 'fp', 'none', 'cache', 'Y?Y', 'C9', { knows: false, note: '键 ordinary_collision:<窗>:<指纹>:<发送时间>' }),
    // C11 挂在规划/菜单/步骤编号上的附属
    meta('plan_attempt_context', 'plan', 'none', 'follow-owner', 'cache', 'YYY', 'C11', { knows: false, note: '键用尝试编号（uuid）' }),
    meta('plan_basis', 'plan', 'none', 'follow-owner', 'follow-owner', 'YYY', 'C11', { strip: ['fp'], note: 'plansOf 读它判规划还认不认' }),
    meta('plan_memo', 'plan', 'none', 'follow-owner', 'cache', 'YYY', 'C11', { knows: false }),
    meta('plan_prep', 'plan', 'none', 'follow-owner', 'cache', 'YYY', 'C11', { knows: false }),
    meta('plan_source', 'plan', 'none', 'follow-owner', 'cache', 'YYY', 'C11', { knows: false }),
    meta('plan_verdict', 'plan', 'none', 'follow-owner', 'follow-owner', 'YYY', 'C11'),
    meta('plan_abandon', 'plan', 'none', 'follow-owner', 'diagnostic', 'YYY', 'C11', { knows: false }),
    meta('replan_of', 'plan', 'none', 'follow-owner', 'follow-owner', 'YYY', 'C11'),
    meta('node_checked', 'plan', 'none', 'follow-owner', 'cache', 'YYY', 'C11', { knows: false }),
    meta('node_checked_pos', 'plan', 'none', 'follow-owner', 'cache', 'YYY', 'C11', { knows: false }),
    meta('node_verdict', 'plan', 'none', 'follow-owner', 'follow-owner', 'YYY', 'C11'),
    meta('mind_stale', 'plan', 'none', 'follow-owner', 'cache', 'YYY', 'C11', { knows: false }),
    meta('menu_condition', 'step', 'none', 'follow-owner', 'follow-owner', 'YYY', 'C11'),
    meta('menu_contract', 'step', 'none', 'follow-owner', 'follow-owner', 'YYY', 'C11'),
    meta('menu_proof', 'step', 'none', 'follow-owner', 'follow-owner', 'YYY', 'C11', { note: '键用菜单日志那一步的编号' }),
    meta('event_source', 'step', 'none', 'follow-owner', 'follow-owner', 'YYY', 'C11'),
    meta('back_planned', 'step', 'none', 'follow-owner', 'cache', 'YYY', 'C11', { knows: false, note: '键用离开记录编号' }),
    // A8 改稿链、左滑冲突（全局按指纹，不分局）
    meta('fresh_from', 'fp', 'none', 'follow-message', 'follow-message', 'PYP', 'A8', { note: '改稿链：新指纹→旧指纹' }),
    meta('swipe_conflict', 'fp', 'none', 'follow-message', 'follow-message', 'PYP', 'A8'),
    // D8～D14 整局共用的 meta
    meta('plan_persona', 'story', 'none', 'copy', 'copy-at-fork', 'YNN', 'D8'),
    meta('absence_ov', 'window', 'fp', 'none', 'cache', '+新', '+新(B8)', { knows: false, note: 'T154i：键 absence_ov:<窗>:<离开起点指纹>，值 { seen, story_status, story, days }＝本窗对继承来的离开记录的读过/处理/天数，盖在行上公共值之上；已经反映在 table:absences 里，不重复倒' }),
    meta('absence_mode', 'story', 'none', 'copy', 'per-window', 'YYY', 'D9', { note: 'D-405：剧情进度类，各窗各自' }),
    meta('absence_resumed_at', 'story', 'none', 'none', 'cache', 'YYY', 'D9', { knows: false, note: '毫秒时间戳基点（游标），按窗存但不复制，子窗自己重算；无后缀的那一个（D14）是全局' }),
    meta('absence_paused', 'global', 'none', 'none', 'shared', 'PNN', 'D14', { note: '全局离开暂停，保持共用' }),
    meta('sys_muted', 'global', 'none', 'none', 'shared', '+新', 'E7', { knows: false, note: 'T154h：键 sys_muted:<群>，值是头像列表＝群里当前这一声静音仍归系统负责的人。按群不按窗，跨窗共用、不随分支复制也不截（各窗的在场已管切点）；系统静音时加、系统解除或她手动接管时删。state-dump 按无后缀全局键读，看不到它' }),
    meta('long_events', 'story', 'none', 'copy', 'per-window', 'YYY', 'D10'),
    meta('long_rolled', 'story', 'none', 'copy', 'per-window', 'YYY', 'D10'),
    meta('long_told', 'story', 'none', 'copy', 'per-window', 'YYY', 'D10'),
    meta('told', 'story', 'none', 'copy', 'per-window', 'YYY', 'D10'),
    meta('story_sofar', 'story', 'none', 'copy', 'per-window', 'YYY', 'D11'),
    meta('state_read', 'story', 'none', 'copy', 'per-window', 'YYY', 'D11'),
    meta('world_used', 'story', 'none', 'copy', 'per-window', 'YYY', 'D11'),
    meta('lore_tries', 'story', 'none', 'copy', 'copy-at-fork', 'YNN', 'D12', { knows: false }),
    meta('lore_ver', 'story', 'none', 'copy', 'copy-at-fork', 'YNN', 'D12', { knows: false }),
    meta('roster_listed', 'story', 'none', 'copy', 'copy-at-fork', 'YNN', 'D12', { knows: false }),
    meta('opening_seeded', 'story', 'fp', 'copy', 'copy-at-fork', 'YNN', 'D12', { note: '键 opening_seeded:<局>:<开场消息指纹>' }),
    meta('cast_promotion_dismissed', 'story', 'avatar', 'copy', 'copy-at-fork', 'YNN', 'D12'),
    meta('pack', 'story', 'none', 'copy', 'copy-at-fork', 'YNN', 'D12', { note: '局设置' }),
    meta('prompt_pack', 'story', 'none', 'copy', 'copy-at-fork', 'YNN', 'D12', { note: '局设置' }),
    meta('relations_draft', 'story', 'none', 'copy', 'copy-at-fork', 'YNN', 'D12'),
    // T154g1：开局设定分开存的记号和开局单编号对照（按窗；开分支时写，只读）
    meta('setup_split', 'window', 'none', 'none', 'cache', '+新', '+新(D12)', { knows: false, note: '这个窗的开局设定已分开存（值 1）；没有＝键用 story_id（新局和旧窗）' }),
    meta('setup_idmap', 'window', 'none', 'none', 'cache', '+新', '+新(D12)', { knows: false, note: '开分支复制开局单各版时旧编号→新编号，核对前史证据时换算' }),
    // T154g2：剧情进度按窗存的标记（开分支时写）和切点截过一次的标记
    meta('progress_split', 'window', 'none', 'none', 'cache', '+新', '+新(D13)', { knows: false, note: '这个窗的剧情进度已分开存（值 1）；没有＝键用 story_id（新局和旧窗）' }),
    meta('absence_mode_log', 'story', 'none', 'none', 'cache', '+新', '+新(D9)', { knows: false, note: '离开模式每次切换记在第几楼（pos、fp），开分支时按切点取当时的值；旧值没有记录，定位不了就不带' }),
    meta('secret_leaks', 'story', 'none', 'copy', 'per-window', 'YYY', 'D13'),
    meta('correction_rev', 'story', 'none', 'none', 'cache', 'YNN', 'D13', { knows: false, note: '纠正版本号（T154g2b：键 correction_rev:<局> 是改共用记录/共用设定的；correction_rev:<窗> 是只改本窗的私有提议）：共用记录被纠正的次数，只拿来让缓存失效；不是窗知道的东西，T154g2 判为缓存，保持按局，不复制' }),
    meta('vis_protocol', 'story', 'none', 'none', 'cache', 'YNN', 'D13', { knows: false, note: '逐楼协议标记，同步时从消息重推；T154g2 判为缓存，保持按局，不复制' }),
];

// ST 那边的东西，不在后台库里：登记在这里只为让总账 57 行都有去处；state-dump 倒不到它们（量尺在后台这一边）。
export const EXTERNAL = [
    { key: 'st:chatMetadata.rp_emergence', ledger: 'E1', status: 'YPY', note: '我们的窗口标记、openingMuted；ST 整份复制' },
    { key: 'st:chatMetadata.contextIsolation', ledger: 'E2', status: 'YNP', note: '第三方隔离扩展的区间；不碰，只在读的一边截' },
    { key: 'st:chatMetadata.rpeManualMuted', ledger: 'E3', status: 'YNY' },
    { key: 'st:chatMetadata.rpeExecution…', ledger: 'E4', status: 'YNY', note: 'rpeExecution rpeLeaveEvents rpeLeaveRetries rpeBoardApplied rpeCardChoices rpeMuteRecovery rpeDoorNoticed' },
    { key: 'st:chatMetadata.other', ledger: 'E5', status: 'YNY' },
    { key: 'st:message.extra', ledger: 'E6', status: 'YYY', note: 'rp_board rp_vis rp_day rp_door rp_lore rp_fresh rpeSourceId rpeMessageId rpeArrival rpePresence rpePresenceOpen' },
    { key: 'st:group.disabled_members', ledger: 'E7', status: 'NNN', note: '群静音表，D-405 由扩展对齐' },
];

// 总账里没有、这次登记时补上的类别
export const ADDED = [
    { key: 'meta:confirm_floor', as: 'C2a 进场·在不在', why: 'T150b 加的确认楼，每窗一行，随 anchors_raw 同进同出；总账 C10 只写了 anchors_raw' },
    { key: 'meta:branch_cut', as: 'C2a 进场·在不在', why: 'T154c 分支窗首次同步时按切出点截过一次的标记（值是切出点楼数），防止重复截；内部标记' },
    { key: 'meta:absence_ov', as: 'B8', why: 'T154i 离开记录的读过/处理/天数按窗覆盖；总账 B8 只写了行上的 seen' },
    { key: 'meta:errand', as: 'C8', why: '去办的事的冷却游标，键 errand:<窗>:<菜单项>；总账 C8 的 22 个前缀里没有' },
    { key: 'meta:advanced', as: 'C7', why: '场景推进缓存（slot.mjs），总账 C7 的 13 个前缀里没有' },
    { key: 'meta:setup_split', as: 'D12', why: 'T154g1 开分支时记下这个窗的开局设定已分开存；决定读写键用 chatKey 还是 story_id' },
    { key: 'meta:absence_mode_log', as: 'D9', why: 'T154g2b 离开模式每次切换的楼号记录，开分支时按切点取父窗当时的值' },
    { key: 'meta:progress_split', as: 'D13', why: 'T154g2 开分支时记下这个窗的剧情进度已分开存；决定进度读写键用 chatKey 还是 story_id' },
    { key: 'meta:setup_idmap', as: 'D12', why: 'T154g1 开分支复制开局单各版时的旧→新编号对照，核对前史证据用' },
    { key: 'meta:authorization_rev', as: 'C9', why: '内部授权序号，键 authorization_rev:<窗> 和 authorization_rev:story:<局>；总账 C9 里没有，归内部序号' },
];

// 看不出前缀的动态拼键调用点，按调用点登记（不按文件放行）：file＝文件名；match＝该行内容里必须出现的特征串；count＝现有处数。
// 新增一处动态拼键（或某处行内容变了）测试就红：要么改成字面量前缀，要么在这里补一条并写清读写的是哪些已登记前缀。
// 只传参 key / k 的透传包装（函数里的 setMeta(key, …)）不在此列，前缀由调用点另行扫到。
export const DYNAMIC_KEY_SITES = [
    { file: 'state-dump.mjs', match: '(entry.prefix)', count: 1, note: '量尺按登记表的 entry.prefix 读，前缀本来就是从登记表来的' },
    { file: 'state-dump.mjs', match: 'value = store', count: 1, note: 'key 来自 metaRows(entry.prefix)，同上' },
    { file: 'main.mjs', match: '`${k}:${progressKeyOfChat(store, chat)}`', count: 1, note: 'meta(k)，k 取 long_rolled / long_events 等已登记前缀' },
    { file: 'pending.mjs', match: '`${prefix}${c.name}`', count: 1, note: 'prefix＝settled_contact:<窗>: ，已登记 settled_contact' },
    { file: 'slot.mjs', match: '`${key}:${chatKey}`', count: 2, note: "for key of ['world_day','situation_ran'] 读/清缓存（同一循环两行）" },
    { file: 'store.mjs', match: '${name}:${from}', count: 2, note: 'forkSetup 和 forkProgress（T154g2，name 取 PROGRESS_META 里已登记的前缀）：开分支时整份复制开局设定那批 meta，name 取 SETUP_META 里已登记的前缀（plan_persona / lore_tries / lore_ver / roster_listed / pack / prompt_pack / relations_draft）' },
    { file: 'store.mjs', match: '${name}:${branchKey}', count: 1, note: 'forkProgress：开分支时把进度那批 meta 整份写到子窗自己的键下，name 取 PROGRESS_META 里已登记的前缀' },
    { file: 'store.mjs', match: '${name}:${chatKey}', count: 2, note: 'cutProgress：按切点截进度那批 meta（读和写各一处），name 同上' },
    { file: 'store.mjs', match: '${name}:${to}', count: 1, note: 'forkSetup：同上，写到子窗的设定归属键下' },
    { file: 'store.mjs', match: '${prefix}:${to}:', count: 1, note: 'forkSetup：opening_seeded / cast_promotion_dismissed 两个带后缀的前缀，整份复制到子窗的设定归属键下' },
    { file: 'store.mjs', match: '`${key}:${chatKey}`', count: 1, note: 'authorizationVersion 里 read(\'arrivals\'|\'card_choices\'|…)，读的是已登记前缀' },
];
