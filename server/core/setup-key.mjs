// T154g1：开局设定（名册、关系表、开局单、世界书谁知道、同一人不同经历、规划人设、包设置等）存在哪个键下。
// 新局和没开过新分支的旧窗：键就是 story_id（父子共用一份，行为和以前逐值相同）。
// 这一版以后开出来的新分支：子窗自己的 chatKey（开分支时整份复制了父窗那一刻的设定，之后各读各的）。
// 窗口认不认"设定已分开"看 meta setup_split:<窗>（store.setupKeyOf）。读写这批数据的口统一用下面这几个，别自己拿 story_id 去读；
// tests/core/t154g1-story-id-guard.test.mjs 会扫 core/，直接把 story_id 喂给这批存取函数的算命中，白名单只放确实该共用的。
//
// 没有 setupKeyOf 的简化 store（测试里的假 store）退回 story_id——这是整个 core/ 里唯一一处这样回退的地方。
const SPLIT_BACK = (store, chatKey, storyId) => (typeof store.setupKeyOf === 'function' && chatKey != null ? store.setupKeyOf(chatKey) : storyId);
export const setupKeyFor = (store, chatKey) => SPLIT_BACK(store, chatKey, store.requireChat?.(chatKey)?.story_id);
export const setupKeyOfChat = (store, chat) => SPLIT_BACK(store, chat?.key, chat?.story_id);
// 外援包、关系表草稿的 meta 里 storyId 一栏现在装的是设定归属键（名字沿用，免得动在途的外援包）：读它统一走这里
export const metaSetupKey = meta => meta?.setupKey ?? meta?.storyId;

// T154g2：剧情进度（离开模式、长线事件、故事至今、世界用过什么、瞒着的事漏了……）存在哪个键下：新局和旧窗＝story_id（父子共用），g2 以后开的新分支＝自己的 chatKey。
// 标记是 progress_split:<窗>，和上面的 setup_split 分开：g1 时开出来的分支只带了设定，进度还是共用的，不能把它们的进度读口改走 chatKey。
const PROGRESS_BACK = (store, chatKey, storyId) => (typeof store.progressKeyOf === 'function' && chatKey != null ? store.progressKeyOf(chatKey) : storyId);
export const progressKeyFor = (store, chatKey) => PROGRESS_BACK(store, chatKey, store.requireChat?.(chatKey)?.story_id);
export const progressKeyOfChat = (store, chat) => PROGRESS_BACK(store, chat?.key, chat?.story_id);

// 第三十六封：纠正版本（来源版本里那一段）。三份计数：
//   correction_rev:<局>      ——改到双方都读的记录（fix/void），所有窗都读；
//   correction_rev:own:<局>  ——没分开存的窗（新局、旧窗、父窗）的本窗私有提议，只有没分开的窗读；
//   correction_rev:<窗>      ——已分开存的窗自己的私有提议，只有它自己读。
// 返回 { shared, own }：shared 是按局那份，own 是本窗该读的私有那份。没分开存的窗 own 读 own:<局>，分开存的读 <窗>。
// 私有两份都为空时，拼出来的标记和以前逐值相同（已存的判断不会因升级失效）。
export function correctionParts(store, chat) {
    const get = key => (store.getRawMeta ?? store.getMeta)?.call(store, key) ?? null;
    const split = setupKeyOfChat(store, chat) !== chat?.story_id || PROGRESS_BACK(store, chat?.key, chat?.story_id) !== chat?.story_id;
    return { shared: get(`correction_rev:${chat?.story_id}`), own: get(split ? `correction_rev:${chat?.key}` : `correction_rev:own:${chat?.story_id}`) };
}
export const correctionTag = (store, chat) => { const p = correctionParts(store, chat); return (p.shared ?? '') + (p.own ? `|w${p.own}` : ''); };
export const correctionCount = (store, chat) => { const p = correctionParts(store, chat); return (Number(p.shared) || 0) + (Number(p.own) || 0); };
