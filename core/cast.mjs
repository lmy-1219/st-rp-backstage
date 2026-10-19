// 名册：这个局里的人各算哪一档（用户可改，存在后台，按局）。
//   主要     ——这个窗口的群成员，一直在场；你不在的日子里他们照样过（缺席时钟只对他们走，白皮书 N-22）
//   常联系   ——出场过、会主动关心或有事会来找（医生、中间人……）
//   路过     ——出场过，但只在被找时回应，不主动关心（工具人）
//   新面孔   ——没有卡、这一局里新长出来的人（规划者列出来要用的，或者记账里反复出现的）：能牵头、会来联系、有亲疏；前台把他写出来（D-107）
//   可能登场 ——还没在这个故事里出场的卡；给了"钩子"（什么情况下会找上门）才会被递出去
//   不用     ——不属于这个故事、或是迭代留下的旧版本
export const ROLES = ['主要', '常联系', '新面孔', '路过', '可能登场', '不用'];
export const ROLE_WEIGHT = { 主要: 4, 常联系: 3, 新面孔: 2, 可能登场: 1, 路过: 0, 不用: 0 };

// 新发现的卡给个默认档：群成员＝主要；在这个窗口说过话＝常联系；其余＝可能登场。用户改过的不动（store.putCast 管）。
// 和群成员同名、却不是那张卡的，多半是同一个人的旧版本 ⇒ 不用。
// 不在群里的卡：这一局认得的（聊天里、开局单里、关系表里提到过名字）才算"可能登场"，别的一律"不用"——
// ST 里放着别的题材的卡，以前一律"可能登场"，换个题材开新局，规划者就把别的题材的人名写进来（T-22 实测）。
// mentioned(名字) → 这一局有没有提到过；不给就按旧的（都算可能登场）。
export function autoRoster({ cards = [], members = [], speakers = new Set(), mentioned = null, listed = false }) {
    const inGroup = new Set(members.map(m => m.avatar));
    const memberNames = new Set(cards.filter(c => inGroup.has(c.avatar)).map(c => c.name));
    return cards.filter(c => c?.avatar && c?.name).map(c => ({
        avatar: c.avatar, name: c.name, ...(c.gender !== undefined ? { gender: c.gender } : {}),
        role: inGroup.has(c.avatar) ? '主要' : listed || memberNames.has(c.name) ? '不用' : speakers.has(c.name) ? '常联系'
            : !mentioned || mentioned(c.name) ? '可能登场' : '不用',
    }));
}
// 新面孔入册（D-107；T-23 实测：规划者编的房东一个人在一份规划里占了三四件，只能挂在"世界"名下，不会来联系、没有亲疏）。
// 没有卡，记成 face:名字；已经在名册里的（同名的卡、之前记过的）不动，用户改过的也不动（putCast 管）。
export const FACE = 'face:';
export function addFaces(store, storyId, faces = []) {
    const cast = store.getCast(storyId);
    const fresh = faces.filter(f => f?.name && !cast.some(e => e.name === f.name));
    if (fresh.length) store.putCast(storyId, fresh.map(f => ({ avatar: `${FACE}${f.name}`, name: f.name, role: '新面孔', hook: f.who || null, call: f.call || null, stranger: f.known === undefined ? undefined : !f.known, ...(f.群体 === true ? { 群体: true } : {}) })));
    return fresh.map(f => f.name);
}
// 记账里反复出现、名册里没有的人（至少 3 条是他说的、做的）：也算新面孔。泛称（老板、店员、路人……）不算，那不是一个人。
const GENERIC = /^(?:老板娘?|店员|店主|服务员|伙计|司机|路人|行人|客人|顾客|邻居|同事|陌生人|男人|女人|孩子|小孩|老人|老头|老太太?|大爷|大妈|众人|大家|有人|对方|旁人|医生|护士|警察|保安|门卫|店家|掌柜|小二)$/;
export function facesFromRecords(records, { roster = [], userName = null, min = 3 } = {}) {
    const count = new Map();
    for (const r of records) {
        const n = String(r.holder_name ?? '').trim();
        if (r.holder === 'narrator' || n.length < 2 || n.length > 12 || n === userName || GENERIC.test(n) || roleOf(roster, n)) continue;   // 旁白（镜头）不是人
        count.set(n, (count.get(n) ?? 0) + 1);
    }
    return [...count].filter(([, k]) => k >= min).map(([name]) => ({ name, who: null, ...(/^(?:几个|一队|一群|一批).+|^.+们$/.test(name) ? { 群体: true } : {}) }));
}

export function promotionCandidates({ roster, records, leaves = [], menu = [], player, same = (a, b) => a === b, recordThreshold, weightThreshold }) {
    return roster.filter(e => String(e.avatar).startsWith(FACE) && e.role !== '不用' && !e.群体).filter(e => {
        const count = records.filter(r => (r.holder_name && same(r.holder_name, e.name)) || (r.audience ?? []).some(n => same(n, e.name))).length;
        if (count < recordThreshold) return false;
        const tie = player && leaves.some(x => Number(x.分量) >= weightThreshold && ((same(x.谁, e.name) && same(x.对谁, player)) || (same(x.谁, player) && same(x.对谁, e.name))));
        return tie || menu.some(m => ['pocket', 'shown', 'used'].includes(m.status) && same(m.who, e.name));
    }).map(e => e.avatar);
}

// 这段文字里有没有这个名字（全名，或者括号前的那一截，至少两个字）。
export function mentionedIn(text) {
    const t = String(text ?? '');
    return name => {
        const full = String(name ?? '').trim(), head = full.split(/[（(]/)[0].trim();
        return (full.length >= 2 && t.includes(full)) || (head.length >= 2 && t.includes(head));
    };
}

// 按名字找档：记录里的名字和卡名一样，或一个包含另一个。
export function roleOf(roster, name) {
    if (!name || !roster?.length) return null;
    // 同名的几张（同一个人的几个版本）取档位最高的那张
    const best = list => list.sort((a, b) => ROLE_WEIGHT[b.role] - ROLE_WEIGHT[a.role])[0] ?? null;
    return best(roster.filter(e => e.name === name)) ?? best(roster.filter(e => e.role !== '不用' && (e.name.includes(name) || name.includes(e.name))));
}

// ---------- 亲疏 ----------
// 基础亲疏（bond，0～5）：名册里可设（用户或 Claude 按卡和聊天草拟的关系表）；没设按档位给默认值。
// 再加上平时的数据（每次要用时现算，日常 RP 里自然跟着变）：最近几天和用户来往多少、有没有关系上的大事
// （在一起、组队这类"改变"）、有没有一起在做的事、最近一次来往隔了多久。
export const BOND_DEFAULT = { 主要: 3, 常联系: 2, 新面孔: 1, 可能登场: 1, 路过: 0, 不用: 0 };
export const LEVELS = [[6, '至亲'], [4.5, '亲近'], [3, '熟络'], [1, '点头之交'], [-Infinity, '陌生']];
export const levelOf = score => LEVELS.find(([min]) => score >= min)[1];

// 两人之间直接的来往：一方说的、做的，里面提到另一方（别人转述两人的事不算）。
const between = (r, a, b) => {
    const has = n => r.about === n || r.text.includes(n) || r.money?.from === n || r.money?.to === n;
    return (r.holder_name === a && has(b)) || (r.holder_name === b && has(a));
};

// records＝窗口里看得见的记录；dayOf＝位置 → 第几天；openIdeaIds＝还开着的想法。
// 平时的数据最多加 2 分（来往 0.8、大事 0.6、一起在做的事 0.4、最近 0.2）：底子说了算，数据只调节。路过的人不因事务往来变亲。
export function closeness({ name, userName, entry = null, records, dayOf, lastPos, openIdeaIds = new Set() }) {
    const role = entry?.role ?? '常联系';
    const base = Number.isFinite(entry?.bond) ? entry.bond : BOND_DEFAULT[role] ?? 1;
    if (!userName || role === '不用' || role === '路过') return { score: base, level: levelOf(base), base, parts: {} };
    const today = dayOf(lastPos);
    const both = records.filter(r => r.type !== '时间' && between(r, name, userName));
    const recent = both.filter(r => today - dayOf(r.pos) <= 3);
    const round = v => Math.round(v * 100) / 100;
    const parts = {
        来往: round(Math.min(0.8, recent.length / 20)),
        大事: round(Math.min(0.6, both.filter(r => r.type === '改变').length * 0.2)),
        在做的事: round(Math.min(0.4, both.filter(r => r.type === '想法' && openIdeaIds.has(r.id)).length * 0.2)),
        最近: both.length && today - dayOf(both.at(-1).pos) <= 1 ? 0.2 : 0,
    };
    const score = Math.round((base + Object.values(parts).reduce((s, v) => s + v, 0)) * 10) / 10;
    return { score, level: levelOf(score), base, parts };
}
