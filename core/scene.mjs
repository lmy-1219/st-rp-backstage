import { personWord } from './pronoun.mjs';
// 兴头（D-109 第 2 步，N-225、N-226；D-112、D-113 加"就地"一类）：生活感按场面来。角色回完一条，后台让便宜、读得多的模型（默认 Gemini）看一眼眼下的场面：
// 出门的——活干完了的空当、接了活还在等、气氛正好、有人高兴兴奋——有人冒个念头（去喝一杯、找个场子），排着的轻松事正好对上，熟人来邀，街上冒件事；
// 就地的——不换场景、不推剧情时人也在动：没头没尾想起一件往事、一句听来的闲话，问玩家一件好奇的事，两个角色拌嘴，手上干着自己的活，
// 凑过去亲近（吵着、难过、兴奋、生气时也会，拿亲近压下一场架也是人之常情）。
// 有的话交给那个人下一次开口时用，写明"可以用也可以不用"；过几条没用就作废。发生了什么由记账接着记（说给谁听了、关系变了），以后想得起来。

export const SCENE_SYSTEM = [
    '你在给一部长篇角色扮演看场面。下面是最近几条对话，在场的人各自的底子（兴趣和习惯、往事、嘴上什么样、怎么对人亲近）和他们跟玩家眼下的关系，不在场的熟人，幕后排着的几件事。',
    '看这一刻有没有人会自己起点什么。人不是只在剧情推着的时候才动：闲着会没话找话，会突然想起当年的一件事、最近听来的一句闲话，手上干着自己的活会想换个做法；两个人会拌嘴；会问玩家一件好奇了很久的事；',
    '会在吵着、难过、兴奋、生气的时候凑过去亲近——拿亲近压下一场架、岔开一件事、讨个好，都是人之常情，不用先把事说开。',
    '挑最像这个人、最贴这一刻的一件（只挑一件）。分两类：',
    '出门的（要一个空当：事刚办完、在等着什么、气氛正好、有人高兴兴奋；正紧张、正吵着、有人受伤难过时不算）：',
    '- 念头：在场的某个人按自己的兴趣冒个念头（约人去哪、想弄点什么、想试试什么）；',
    '- 提前：幕后排着的哪件轻松的事正好对上这个空当（写它的编号）；',
    '- 邀约：不在场的某个熟人按他的兴趣和门路来邀（有新东西、办了什么、有个局）；',
    '- 街头：人在外面时，周围冒出件新鲜事或者有人求助。',
    '就地的（不用空当，吵着、难过也行；只有正说到要紧处——谈判、动手、救人——不插）：',
    '- 冒一句：没头没尾地想起一件往事（从他的往事里挑，写编号；讲过的别再挑）、一句听来的闲话、手上的事换个做法，或者纯粹没话找话；',
    '- 问你：问玩家一件提过又没说清、或者他一直好奇的事；',
    '- 斗嘴：在场的两个角色你来我往（写"对谁"），不一定冲着玩家；',
    '- 顺手：他手上正干着自己的事，给这一刻一点动静。先挑【手边的事】里他自己留下的、还没着落的（弄坏的、弄乱的、借了的、答应了的），顺手收拾、修补、兑现，写它的编号；没有，再用这个场景里本来就有的、最近几条写到过的东西（屋里的物件、随身的东西）干点什么；都没有才是泛泛的进进出出；',
    '- 亲近：他主动跟玩家（或在场的另一个人，写"对谁"）亲近。怎么起、到哪一步照两人眼下的关系和他的性子，不一定从小动作开始。',
    '玩家这阵只回一两个字的时候，多半该有人起点就地的：先照前面发生的事看〔玩家〕这是满足、累了，还是在闷着、敷衍、赌气——不对劲的话，就地的多半冲着〔玩家〕这个样子来（担心地问一句是不是累了、不舒服、不高兴，解释、哄、逗，也可能被激得冒火），别当没看见；别的时候多数没有，没有就说没有。',
    "先看玩家眼下的样子（从最近几条读）：\"能动\"（照常）、\"累着\"（没力气、想歇、不想动）、\"难受\"（病着、伤着、情绪低）、\"闷着\"（在赌气、敷衍）、\"正忙\"（手上有事）。玩家累着、难受时，只出就地的，不出出门的——留下陪着、聊、收拾、照顾（照顾算在顺手或亲近里）；说好的事先放着，由他改期还是等〔玩家〕。",
    '按每个人的"节奏"挑（底子里写了的）：迁就对方状态的人，留下来聊、收拾、照顾，横着把这一刻过完；按自己节奏推的人，催过一回也得让，让完就干自己手边的事。两个人眼下的关系还在重新摸索、试探的（看"和玩家眼下"），"问你""冒一句"比别的更像。',
    '给了【刚到】时，玩家这边刚换了地方：这一回不用等空当（正紧张、正动手时照旧不插），看这里会有什么人、什么事，多半是"街头"（这地方的人和动静、有人凑过来），也可以是在场的人就地的反应。给了【这一局的几条线】时，冒的那件事对得上哪条，就照它的写法来（谁、怎么露、隔多久）；对不上别硬凑。',
    '别写成任务，别替玩家决定，别讲道理、别劝和；按各人自己的底子来，和【最近冒过的兴头】别重样。',
    '只输出一个 JSON：{"玩家眼下": "能动|累着|难受|闷着|正忙", "有": true 或 false, "为什么": "一句", "种类": "念头|提前|邀约|街头|冒一句|问你|斗嘴|顺手|亲近", "手边": 顺手收拾【手边的事】时写它的编号，否则 null, "谁": "起头的人；街头写"世界"","对谁": "斗嘴、亲近时写，否则 null", "往事": 往事编号或 null, "什么": "一句", "怎么起": "一句：口气和由头（冒一句可以没有由头）", "编号": 提前时写袋编号，否则 null}',
].join('\n');

export const OUTING = new Set(['念头', '提前', '邀约', '街头']);
export const IN_PLACE = new Set(['冒一句', '问你', '斗嘴', '顺手', '亲近']);
const KINDS = new Set([...OUTING, ...IN_PLACE]);
export const USER_STATES = new Set(['能动', '累着', '难受', '闷着', '正忙']);
// 玩家这样时不出出门的（横着把这一刻过完，用户 10/2：横向生长）
export const STAY_STATES = new Set(['累着', '难受']);

// 记在"第几条"上的记号（看到哪了、玩家眼下的样子、上一个兴头）还算不算数：那个位置上还是同一条消息才算。
// 玩家删回去、换了分支，位置上换了别的消息或者根本没那么多条了，就当没记过（用户 10/3：删到睁眼那刻重玩，
// "看到第 56 条"的记号还在，场记一直不跑，累着时约定先放着也跟着失灵）。at＝{ pos, fp }；老记号只有 pos 的，位置还在就算。
// same(当前指纹, 记下的指纹)：去复读改过的那条指纹换了，也认得（store.sameMessage）。
export function stillThere(at, messages, same = null) {
    const pos = Number(at?.pos);
    if (!Number.isFinite(pos)) return false;
    const m = (messages ?? []).find(x => x.pos === pos);
    if (!m) return false;
    return !at.fp || m.fp === at.fp || !!same?.(m.fp, at.fp);
}

// 手边的事（用户 10/2）：在场的人自己弄出来的、还没着落的改变——弄坏的、弄乱的、借了的——给看场面当"顺手"的候选，
// 也给规划（几天没人碰的长成后果）。改变记在谁头上（holder）就是谁留下的；他自己身上的改变（关于谁＝他自己）不算手边的事。
// 只看最近一段（window 条消息）里的，更早的多半早就不在眼前了。
export function looseEnds(visible, { present = [], lastPos = Infinity, window = 150, same = (a, b) => a === b } = {}) {
    return visible.filter(r => r.type === '改变' && ['直到被改变', '永久'].includes(r.duration) && !r.superseded_by && !r.closed_by
        && lastPos - r.pos <= window && present.some(n => same(n, r.holder_name)) && !(r.about && same(r.about, r.holder_name)))
        .map(r => ({ id: r.id, who: r.holder_name, text: r.text, pos: r.pos }));
}

const clip = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const joined = (lines, n) => clip((lines ?? []).join('；'), n);

// present：[{ name, level, parts: { 兴趣和习惯, 往事, 聊天, 亲近 }, withUser }]；told：[{ who, n }] 这一局讲过的往事
// loose：手边的事（looseEnds）——在场的人留下的、还没着落的改变
// arrived：玩家这边刚换了地方（叙述里那一小段）；arcs：开局单里的储备线（只在刚换了地方时给，D-167）
export function scenePrompt({ userName = '玩家', setup = null, lastScene = [], present = [], offstage = [], menu = [], recent = [], told = [], passive = false, loose = [], arrived = null, arcs = [] }) {
    const person = p => {
        const parts = p.parts ?? {};
        const tales = (parts['往事'] ?? []).map((t, i) => `    往事${i + 1}${told.some(x => x.who === p.name && x.n === i + 1) ? '（讲过了）' : ''}：${clip(t, 80)}`);
        return [
            `· ${p.name}（${p.level ?? '不明'}）${parts['兴趣和习惯']?.length ? `：${joined(parts['兴趣和习惯'], 200)}` : '：（兴趣不明）'}`,
            ...(p.withUser ? [`    和${userName}眼下：${clip(p.withUser, 120)}`] : []),
            ...(parts['聊天']?.length ? [`    嘴上：${joined(parts['聊天'], 120)}`] : []),
            ...(parts['亲近']?.length ? [`    亲近：${joined(parts['亲近'], 120)}`] : []),
            ...(parts['节奏']?.length ? [`    节奏：${joined(parts['节奏'], 120)}`] : []),
            ...tales,
        ];
    };
    const looseLines = loose.length ? ['【手边的事】（在场的人留下的、还没着落的）', ...loose.map(l => `· 手边${l.id} ${l.who}留下的：${clip(l.text, 100)}`)] : [];
    return [
        ...(setup?.基调 ? [`【基调】${setup.基调}`] : []),
        `【玩家】${userName}${passive ? `（这一阵最近几句都只回一两个字）` : ''}`,
        '【在场的人】', ...(present.length ? present.flatMap(person) : ['（只有玩家）']),
        '【不在场的熟人】', ...(offstage.length ? offstage.map(p => `· ${p.name}（${p.role}，${p.level ?? '不明'}${p.lastSeen ? `，上次露面${p.lastSeen}` : ''}）：${joined(p.parts?.['兴趣和习惯'], 200) || clip(p.hook, 200) || '（兴趣不明）'}`) : ['（没有）']),
        ...looseLines,
        '【幕后排着的事】', ...(menu.length ? menu.map(m => `· 袋${m.id} ${m.who}「${m.title}」：${clip(m.surface, 100)}`) : ['（没有）']),
        ...(arrived ? [`【刚到】${userName}这边刚换了地方：${clip(arrived, 160)}`] : []),
        ...(arrived && arcs.length ? ['【这一局的几条线】（开局单里的；此刻对得上哪条，冒的那件事就照它的写法喂它；对不上别硬凑）', ...arcs.map(a => `· ${a.名}：${clip(a.内容, 120)}${a.条件 ? `（条件：${clip(a.条件, 60)}）` : ''}`)] : []),
        '【最近冒过的兴头】', ...(recent.length ? recent.map(r => `· ${r.kind ?? ''} ${r.who}${r.to ? `→${r.to}` : ''}：${r.what}`) : ['（没有）']),
        '', '【最近几条】', ...lastScene,
    ].join('\n');
}

export function parseScene(text) {
    const m = String(text ?? '').match(/\{[\s\S]*\}/);
    let raw = null;
    try { raw = m ? JSON.parse(m[0]) : null; } catch { raw = null; }
    // 玩家眼下的样子（累着、难受时只出就地的；约定那几行改口气）：没出兴头也算数
    const userState = USER_STATES.has(raw?.['玩家眼下']) ? raw['玩家眼下'] : null;
    const yes = raw && (raw['有'] === true || raw['空当'] === true);
    if (!yes || !KINDS.has(raw['种类'])) return { open: false, why: clip(raw?.['为什么'], 120), userState };
    const kind = raw['种类'];
    // 编号常写成"袋451""往事2""手边3"：取里面的数
    const num = x => Number(String(x ?? '').match(/\d+/)?.[0] ?? NaN);
    const id = num(raw['编号']), tale = num(raw['往事']), loose = num(raw['手边']);
    const to = clip(raw['对谁'], 40);
    const out = {
        open: true, kind, who: clip(raw['谁'], 40) || (kind === '街头' ? '世界' : ''), to: to && to !== 'null' ? to : null,
        what: clip(raw['什么'], 160), how: clip(raw['怎么起'], 120), why: clip(raw['为什么'], 120),
        id: Number.isFinite(id) && id > 0 ? id : null, tale: Number.isFinite(tale) && tale > 0 ? tale : null,
        loose: kind === '顺手' && Number.isFinite(loose) && loose > 0 ? loose : null, userState,
    };
    if (kind === '提前' ? !out.id : !out.what || !out.who) return { open: false, why: out.why };
    if (kind === '斗嘴' && !out.to) return { open: false, why: out.why };
    return out;
}

// 看场面的答复过不过得了程序这一关（D-112、D-113）：起头的人得在场（来邀的得是不在场的熟人）；同一个人隔一阵才再起头（就地的隔得短些）；
// 斗嘴、亲近得有对象（玩家或在场的另一个人）；亲近冲着玩家时两人得有来往（熟络以上），同一对人隔一阵才再来；讲过的往事不再讲。
// 不替角色讲道理：吵着、难过时能不能亲近、到哪一步，由模型照关系和性子定。过了返回要存的那一条，不过返回 null。
export function admitImpulse(v, { present = [], offstage = [], userName = '玩家', recent = [], told = [], pos = 0, at = null, gaps = {}, loose = [] }) {
    const { personGap = 30, inPlaceGap = 8, closeGap = 40 } = gaps;
    const known = (list, who) => (who ? list.find(p => p.name === who || p.name.includes(who) || who.includes(p.name)) : null);
    const inPlace = IN_PLACE.has(v.kind);
    // 玩家累着、难受：出门的不出（程序兜底，模型照规矩本就不该出）
    if (STAY_STATES.has(v.userState) && OUTING.has(v.kind)) return null;
    const me = v.kind === '邀约' ? known(offstage, v.who) : v.kind === '念头' || inPlace ? known(present, v.who) : null;
    if ((v.kind === '念头' || v.kind === '邀约' || inPlace) && !me) return null;
    const since = x => pos - (x.at?.pos ?? -Infinity);
    if (me && recent.some(x => x.who === me.name && since(x) < (inPlace ? inPlaceGap : personGap))) return null;
    let to = null;
    if (v.kind === '斗嘴' || v.kind === '亲近') {
        to = !v.to || v.to === userName || v.to === '玩家' ? userName : known(present, v.to)?.name ?? null;
        if (!to || to === me.name) return null;
    }
    if (v.kind === '亲近') {
        if (to === userName && ['点头之交', '陌生'].includes(me.level)) return null;
        if (recent.some(x => x.kind === '亲近' && x.who === me.name && x.to === to && since(x) < closeGap)) return null;
    }
    let tale = null;
    if (v.kind === '冒一句' && v.tale) {
        const text = me.parts?.['往事']?.[v.tale - 1] ?? null;
        if (text && told.some(t => t.who === me.name && (t.n === v.tale || t.text === text))) return null;
        if (text) tale = { n: v.tale, text };
    }
    // 顺手收拾手边的事：编号得是这次给过的
    const end = v.kind === '顺手' && v.loose ? loose.find(l => l.id === v.loose) ?? null : null;
    return { ...v, who: me?.name ?? v.who, to, tale, loose: end ? { id: end.id, text: end.text } : null, at, used: false };
}

// 交给开口的人的那几行（可以用，也可以不用）。
export function impulseLines(imp, { userName = '玩家' } = {}) {
    // 怎么起（由头、语气）只给场外来的（来邀、街上的事：怎么冒出来有用）；他自己就地做的不给——
    // 试玩 10/3："低骂着数落她""由头是电话不接害他把门禁干碎"被前台当剧本，照着报幕、照着刻薄。做什么交给他，怎么做照他的性子和眼前。
    const how = imp.how && (imp.kind === '邀约' || imp.kind === '街头') ? `——${imp.how}` : '';
    const own = `当是${imp.who}自己想的，别写成有人安排；${userName}接不接由${userName}`;
    if (imp.kind === '念头') return [`（此刻的兴头，可以提、也可以不提：${imp.who}${imp.what}${how}。提了就${own}。）`];
    if (imp.kind === '邀约') return [`（这会儿不在场的${imp.who}可以来邀一下，用这个世界说得通的方式，可以用也可以不用：${imp.what}${how}；接不接由${userName}。）`];
    if (imp.kind === '街头') return [`（这会儿周围可以冒出一件事，场面对不上就当没看见：${imp.what}${how}。）`];
    if (imp.kind === '冒一句') return [`（这会儿${imp.who}可以没头没尾地冒一句，可以用也可以不用：${imp.what}${how}。不用由头，就是突然想起来、随口一说；${own}。）`];
    if (imp.kind === '问你') return [`（这会儿${imp.who}可以问${userName}一件事，可以用也可以不用：${imp.what}${how}。${own}。）`];
    if (imp.kind === '斗嘴') return [`（这会儿${imp.who}可以跟${imp.to}你来我往拌几句，可以用也可以不用：${imp.what}${how}。不一定冲着${userName}。）`];
    if (imp.kind === '顺手' && imp.loose?.text) return [`（这会儿${imp.who}可以顺手把自己留下的那件事收拾了——${imp.loose.text}：${imp.what}${how}。可以用也可以不用；不用特意说，手上做着就行。）`];
    if (imp.kind === '顺手') return [`（这会儿${imp.who}手上可以正干着自己的事，给这一刻一点动静，可以用也可以不用：${imp.what}${how}。）`];
    if (imp.kind === '亲近') {
        const target = imp.to ?? userName;
        return [`（这会儿${imp.who}可以主动跟${target}亲近，可以用也可以不用：${imp.what}${how}。怎么起、到哪一步照两人眼下的关系和${personWord(imp.who)}的性子来，不用先把事说开。）`];
    }
    return [];
}

// 玩家这边刚换了地方（N-295，用户 10/6：到了一个规划没写的地方，临时也该有点东西）：叙述（括号里）写着走进、来到、推开门、打车去了、回到……
// 返回写着它的那一小段；没有就 null。只认叙述里的动作（"我们去酒吧吧"是打算，不算）。
const MOVE = /(走进|走了进|推开[^（）()]{0,10}门|来到|踏进|迈进|进了|去了|回到|下了车|赶到|到了)/;
export function movedTo(narration) {
    const t = String(narration ?? '');
    const m = MOVE.exec(t);
    if (!m) return null;
    return t.slice(Math.max(0, m.index - 20), m.index + 40).replace(/\s+/g, ' ').trim();
}
