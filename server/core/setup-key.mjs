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
