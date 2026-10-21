// 规划前备料（D-109 第 3 步，N-227）：写规划的模型（Opus／Fable）一次读不了太多、读多了贵；Gemini 读得多又便宜。
// 每次叫规划之前，先让 Gemini 把整张卡、关系表、开局单、账本里记下的事、最近的原文、素材资料、最近冒过的兴头读一遍，
// 挑出用得上的写成一页备忘（标出处），附在给规划者的简报后面。只列候选，不写剧情。

export const PREP_SYSTEM = [
    '你在给一部长篇角色扮演的规划者备料。规划者待会儿要规划这一局接下来的一个阶段；它读不了太多东西，你读得多，替它把用得上的挑出来。',
    '下面是这一局的角色卡、人物关系、开局单、账本里记下的事、最近的原文，有的话还有素材资料和最近看场面冒出来的兴头。',
    '写一页备忘，分五块：',
    '一、各人眼下的处境和心气：在场的、常来往的，每人一两句，从最近的原文和账本看；',
    '二、各人自己想干的事：按卡和兴趣和习惯——会想去哪、想弄点什么、会约谁、谁会来约他；和眼下的主线不相干也行，生活感从这里来；',
    '三、没收尾的旧事：账本和原文里起了头、没下文的（谁起的头、谁知道）；',
    '四、这附近的地方和人：卡、关系表、资料里提到的，能露面的熟人、店、场子、门路；',
    '五、可以长出来的小事，五到八件：生活里的、街上的、熟人来邀的都行，每件一句。',
    '每条后面标出处：【卡：谁】【账本】【原文】【关系表】【开局单】【资料：文件名】，你自己记得的原作内容标【凭记忆】。',
    '只列候选，不写剧情段落、不写台词，不替玩家定任何事；卡里、账本里没有的别当成事实。整份不超过一千五百字。',
].join('\n');

const cut = (s, n) => String(s ?? '').slice(0, n);
const fill = (items, budget) => {
    const out = [];
    let used = 0;
    for (const x of items) { if (used + x.length > budget) break; out.push(x); used += x.length; }
    return out;
};

// 各块的上限（字）：整份约十几万字，Gemini 一次读得下，一份约几分钱。
export const PREP_BUDGET = { cards: 40000, relations: 15000, setup: 6000, story: 30000, scene: 20000, library: 25000 };

export function prepPrompt({ userName = '玩家', cards = [], relations = '', setup = '', story = [], scene = [], library = [], impulses = [] }) {
    return [
        `【玩家】${userName}`,
        '', '【角色卡】', ...(cards.length ? fill(cards.map(c => `—— ${c.name}（${c.role}）\n${c.text}`), PREP_BUDGET.cards) : ['（没有）']),
        ...(relations ? ['', '【人物关系】', cut(relations, PREP_BUDGET.relations)] : []),
        ...(setup ? ['', '【开局单】', cut(setup, PREP_BUDGET.setup)] : []),
        '', '【账本里记下的事】（新的在前）', ...(story.length ? fill(story, PREP_BUDGET.story) : ['（还没有）']),
        '', '【最近的原文】', ...(scene.length ? scene.slice(-Math.max(1, fill([...scene].reverse(), PREP_BUDGET.scene).length)) : ['（没有）']),
        ...(library.length ? ['', '【素材资料】', ...fill(library.map(c => `—— ${c.source}｜${c.title}\n${c.text}`), PREP_BUDGET.library)] : []),
        ...(impulses.length ? ['', '【最近看场面冒出来的兴头】', ...impulses.map(i => `· ${i.kind}：${i.who}——${i.what}`)] : []),
    ].join('\n');
}

export function prepMemoText(text) {
    const body = String(text ?? '').replace(/^\s*```[a-z]*\s*|\s*```\s*$/g, '').trim();
    return body ? `【Gemini 备料】（规划前读了整张卡、账本、原文、资料挑出来的候选，标了出处；不是事实，用不用由你定）\n${body.slice(0, 3000)}` : null;
}
