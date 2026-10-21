import { personWord } from './pronoun.mjs';
// 生活现状（N-288，用户 10/5："添一个当前生活现状的一格，记并更新当前住所位置、家居状况、以及'买了一批新衣服，他现在有…'"）：
// 记账认出的"生活现状"（extract 的同名一格：搬家、家里添换扔坏、衣服、随身的东西）按先后折成一张"现在是什么样"的表——
// 换掉的就不在了，所以它不会越攒越多（和回忆不同），每次开口都带着：住在哪、衣服、身边的东西给在场的人；
// 家里的样子只在镜头就在那处住处时给（人在外面，不用硬扯一句新换的床）。
// 前台会照着自己前面写过的样子往下写（试玩：漏风、破门在他十几条回复里出现过），所以写明"以这个为准"，换掉的旧样子点名说不在了。
// 开局单里写的开场时的样子（setup.mjs 的"生活现状"那一格）先铺上，聊天里的变化照先后往上改。
// 题材无关：类别是通用的，人名、地名、东西都来自聊天和开局单。
import { similar } from './records.mjs';

// 那处住处在不在这段文字里：名字里的中心词（末两三个字，"城东公寓"的"公寓""东公寓"）或者整个名字写到了
const named = (place, scene) => {
    const runs = String(place ?? '').match(/[一-鿿A-Za-z0-9]{2,}/g) ?? [];
    return runs.some(w => scene.includes(w) || scene.includes(w.slice(-2)) || (w.length >= 3 && scene.includes(w.slice(-3))));
};

// 身体（用户 10/9，开局单"人物开场状态"）：会一直带着的身体状况——没好的旧伤、病根、靠药撑着、身上装着的东西；好了、加重了跟着改
export const LIFE_KINDS = ['住处', '家里', '衣服', '东西', '身体'];
const GONE = /^(没了|没有了|扔了|坏了|丢了|卖了|无)$/;
const LIST_MAX = 10, HOME_MAX = 24, GONE_MAX = 4;

// 开局单"生活现状"那一格的一条（{谁, 类, 是, 在哪, 谁知道}）→ lifeSheet 的 seed；knows(条)：开口的人知不知道
export const seedOf = (rows = [], knows = () => true) => rows.filter(x => x && LIFE_KINDS.includes(x.类) && x.谁 && x.是 && knows(x))
    .map(x => ({ who: x.谁, kind: x.类, now: x.是, gone: '', ...(x.类 === '家里' && x.在哪 ? { where: x.在哪 } : {}) }));

// 衣服这一类记的是家当（买了、扔了、坏了、送人了），不是此刻穿哪身（用户 10/14："我写了，就是斜襟衬衫这身，但被退回到很早之前的酒红短裙了"——
// 记账把"换上酒红短裙"记成了衣服"有酒红短裙"、换下来的水手服"不在了"，下回换斜襟衬衫没记，生活现状里一直写着酒红那身"以这个为准"）。
// 只说换上、穿上，没说买、扔、坏、送、做的，是换衣服，归此刻的样子，这里不收（旧记录也照这样筛）
const WEAR = /换上|穿上|换了一身|换了身|套上|换成/;
const OWN = /买|扔|丢|坏|送|捐|卖|做的|做了|定做|收到|拿到手|新衣/;
export const lifeOf = r => {
    const l = r?.life;
    if (!(l && LIFE_KINDS.includes(l.kind) && l.who && (l.now || l.gone))) return null;
    if (l.kind === '衣服' && WEAR.test(String(r.text ?? '')) && !OWN.test(String(r.text ?? ''))) return null;
    return l;
};

const clean = t => String(t ?? '').trim().replace(/[。．.；;]+$/, '');
// 是不是同一件：一样、或者一个包着另一个（"旧皮夹克"和"起球的旧皮夹克"）；四个字以上的才按字面相近算——"单人床"和"双人床"不是一件
const alike = (a, b) => { const x = clean(a), y = clean(b); return !!x && !!y && (x === y || x.includes(y) || y.includes(x) || (Math.min(x.length, y.length) >= 4 && similar(x, y) >= 0.6)); };
// 住处的名字去掉"某某的"再比（"乙的城东公寓"和"城东公寓"是一处）
const homeCore = (t, names = []) => { let s = clean(t); for (const n of names) if (n) s = s.split(`${n}的`).join('').split(n).join(''); return s.replace(/^的/, '') || clean(t); };

// "坏掉的供暖""没有厨房""旧的沙发"这类写着状况的：新来的那件说的是同一样东西（末两个字对得上、或写在里面），就换掉它
const STATE_WORD = /^(坏掉的|坏了的|坏的|没有|旧的|破的?)/;
const replaces = (item, now) => { const x = clean(item), y = clean(now); return STATE_WORD.test(x) && y.length >= 2 && (x.endsWith(y.slice(-2)) || x.includes(y.slice(-2))); };
// 一张表里加、换、去掉：换掉的那件在表里就拿掉；表里没有（卡里、前面正文里写过的旧样子）就记下"原来的那件不在了"，前台别再照旧写
// 换掉的那件写法和表里不一样（试玩 10/6："被打烂的生铁旧门"之于开局单的"入户木门"，新门装好了旧门还在表里）：
// 末一个字一样（门、床、灯）、又不是写着"没有"的，表里只有这一件，就是它。正在装、施工中的不算现在的样子，装好了才算。
const NOUN = t => clean(t).replace(/[（(][^）)]*[）)]$/, '').slice(-1);
const NOT_THERE = /没有|没装|无/;
const IN_PROGRESS = /正在|施工中|安装中|在装|还没装好|未完工|没装完/;
function apply(list, gone, { now, gone: old }, max = LIST_MAX) {
    if (old) {
        const before = list.length;
        for (let i = list.length - 1; i >= 0; i--) if (alike(list[i], old)) list.splice(i, 1);
        if (list.length === before) {
            const same = list.map((x, i) => [x, i]).filter(([x]) => NOUN(x) && NOUN(x) === NOUN(old) && !NOT_THERE.test(x));
            if (same.length === 1) { const [x, i] = same[0]; list.splice(i, 1); if (!gone.some(g => alike(g, x))) gone.push(clean(x)); }
            else if (!gone.some(g => alike(g, old))) gone.push(clean(old));
        }
    }
    if (now && !GONE.test(clean(now)) && !IN_PROGRESS.test(now)) {
        for (let i = list.length - 1; i >= 0; i--) if (alike(list[i], now) || replaces(list[i], now)) list.splice(i, 1);
        list.push(clean(now));
        // 又有了的不再算"不在了"
        for (let i = gone.length - 1; i >= 0; i--) if (alike(gone[i], now)) gone.splice(i, 1);
    }
    while (list.length > max) list.shift();
    while (gone.length > GONE_MAX) gone.shift();
}

// records：开口的人知道的记录（带 pos），按先后折。same(a, b)：两个名字是不是同一个人。
// seed：开局单里写的开场时的样子（{who, kind, now, where}），排在所有记录前面。
export function lifeSheet(records, { same = (a, b) => a === b, names = [], seed = [] } = {}) {
    const people = [], homes = [];
    const person = who => {
        let p = people.find(x => same(x.name, who));
        if (!p) people.push(p = { name: who, home: null, clothes: [], goneClothes: [], things: [], goneThings: [], body: [], goneBody: [] });
        return p;
    };
    const home = (key, who) => {
        const core = homeCore(key, names);
        let h = homes.find(x => alike(x.core, core));
        if (!h) homes.push(h = { name: clean(key), core, owners: [], items: [], gone: [] });
        if (who && !h.owners.some(o => same(o, who))) h.owners.push(who);
        return h;
    };
    const seeded = seed.filter(l => lifeOf({ life: l })).map((l, i) => ({ id: -1 - i, pos: -Infinity, life: l }));
    for (const r of [...seeded, ...[...records].filter(lifeOf).sort((a, b) => a.pos - b.pos || a.id - b.id)]) {
        const l = lifeOf(r), p = person(l.who);
        if (l.kind === '住处') {
            if (l.now && !GONE.test(clean(l.now))) { p.home = clean(l.now); home(l.now, l.who); } else p.home = null;
        } else if (l.kind === '家里') {
            // "某人的公寓"＝那人眼下住的地方（开局单写"甲的城东公寓"、住处那条写"城东的单身公寓，约 50 平米"，是一处）
            const owner = /^(.+?)的/.exec(clean(l.where))?.[1];
            // 他自己没有"住处"那条（签合同那条只有签的人知道），"某人的十楼公寓""某人的旧公寓"说的还是他住的那一处（用户 10/8：被褥记在一处、冰箱记在另一处）
            const ownerHome = owner ? (people.find(x => same(x.name, owner))?.home ?? homes.find(h => h.owners.some(o => same(o, owner)))?.name ?? null) : null;
            const h = home(ownerHome || l.where || p.home || `${l.who}住的地方`, l.who);
            apply(h.items, h.gone, l, HOME_MAX);
        } else if (l.kind === '衣服') apply(p.clothes, p.goneClothes, l);
        else if (l.kind === '身体') apply(p.body, p.goneBody, l);
        else apply(p.things, p.goneThings, l);
    }
    return { people, homes };
}

// 他本来就有住处的，这段时间只有去找房、租房、搬家才算换了住处；搬进去、收拾、签收东西都是同一处（用户 10/8：他搬进自己刚租的屋收拾东西，
// 进场那份写了"住处：不验身份的旧公寓"，账上就成了两处——前面买的被褥在旧那处、新摆的冰箱在新那处，前台把被褥写成了别的料子）
const MOVING = /找房|看房|租房|租到|租了|搬家|搬去|搬进|搬到|换个住处|换了住处|换住处|新住处|落脚|退租/;
export const homeChanged = (home, texts = []) => !home || MOVING.test(texts.filter(Boolean).join(' '));

// 镜头在不在那处住处：scene＝此刻的样子（位置、周围）和最近两条括号里的叙述（嘴上说"在家待着"不算，人在车里）——
// 写到了那处住处；或者写的是"家里、屋里"这类，而在场的人里只有一处住处
const AT_HOME = /家里|回家|到家|在家|屋里|卧室|客厅|厨房|浴室|阳台|床上/;
// 镜头只认到那栋楼、那片地方（"甲楼"之于"甲楼的单身公寓"）：人坐在车里、在电梯里、楼下，都还算那栋楼，不算在屋里——
// 有这些、又没写到屋里的样子，屋里那张单子就不给（试玩 10/14：两人坐在楼下停着的车里，那一格给了十几行屋里的样子，写着"镜头就在这儿"）
const OUT_OF_ROOM = /驾驶座|副驾|后座|车里|车上|车内|电梯|货梯|楼道|走廊|楼下|大堂|停车场|车库|天台/;
export function homeHere(sheet, { scene = '', present = [], same = (a, b) => a === b, names = [], board = null } = {}) {
    if (board?.camera?.place) {
        const p = board.camera.place;
        const hit = sheet.homes.filter(h => (h.items.length || h.gone.length) && alike(homeCore(h.core, names), p));
        // 场面表认出镜头在别处（主街、店里），就不再按字面猜在不在家里（试玩 10/7：两人在主街上，场记写着"镜头就在 H10 这处住处"）
        const loose = h => { const c = clean(homeCore(h.core, names)), q = clean(p); return c !== q && c.includes(q); };
        return hit.filter(h => !loose(h) || !OUT_OF_ROOM.test(scene) || AT_HOME.test(scene));
    }
    const hit = sheet.homes.filter(h => (h.items.length || h.gone.length) && named(homeCore(h.core, names), scene));
    if (hit.length) return hit;
    if (!AT_HOME.test(scene)) return [];
    const theirs = sheet.homes.filter(h => (h.items.length || h.gone.length) && h.owners.some(o => present.some(p => same(p, o))));
    return theirs.length === 1 ? theirs : [];
}

const join = xs => xs.join('、');
// only＝'身体'：只给身体那一截（旁白：在场的人身上带着的伤病，照玩家知道的；住处、家当不给）
export function lifeLines(sheet, { name, present = [], scene = '', same = (a, b) => a === b, names = [], board = null, only = null } = {}) {
    const who = [name, ...present.filter(p => !same(p, name))];
    const rows = [];
    for (const n of who) {
        const p = sheet.people.find(x => same(x.name, n));
        if (!p) continue;
        const body = p.body?.length || p.goneBody?.length ? `身体：${p.body.length ? join(p.body) : ''}${p.goneBody.length ? `${p.body.length ? '；' : ''}之前的${join(p.goneBody)}已经好了、不在了` : ''}` : '';
        const bits = only === '身体' ? [body].filter(Boolean) : [
            p.home ? `住在${p.home}` : '',
            p.clothes.length || p.goneClothes.length ? `衣服（家当；此刻穿的哪身照此刻的样子）：${p.clothes.length ? `有${join(p.clothes)}` : ''}${p.goneClothes.length ? `${p.clothes.length ? '；' : ''}原来的${join(p.goneClothes)}不在了` : ''}` : '',
            p.things.length || p.goneThings.length ? `身边的东西：${p.things.length ? `有${join(p.things)}` : ''}${p.goneThings.length ? `${p.things.length ? '；' : ''}原来的${join(p.goneThings)}不在了` : ''}` : '',
            body,
        ].filter(Boolean);
        if (bits.length) rows.push(`· ${p.name}：${bits.join('；')}`);
    }
    if (only === '身体') return rows.length ? ['在场的人身上一直带着的（以这个为准，写到时别和它相反；不用特意提起）：', ...rows] : [];
    const here = homeLines(sheet, { scene, present: who, same, names, board });
    if (!rows.length && !here.length) return [];
    return ['生活现状（以这个为准：和卡里、前面正文里写过的不一样的，照这里写；不用特意提起）：', ...rows, ...here];
}
// 发消息、打电话来的人在他自己住的地方（用户 10/8：他在新租的屋里打来电话，那一格给的却是镜头所在那处的样子，他自己屋里添了什么没给，
// 前文买的纯棉被褥被写成了化纤）：他住的那处的样子给他——镜头不在那儿，是他自己看得见的。where＝他那头的位置（进场那份写的、此刻的样子读出来的）
const AT_OWN = /屋里|家里|住处|公寓|房里|房间|租的|回家|到家|自己那儿|床|厨房|客厅|卧室|洗手间|浴室|窗台|水池|冰箱/;
export function ownHomeLines(sheet, { name, where = '', same = (a, b) => a === b, names = [] } = {}) {
    const w = String(where ?? '');
    if (!name || !w) return [];
    const mine = sheet.homes.filter(h => (h.items.length || h.gone.length) && h.owners.some(o => same(o, name)));
    const hit = mine.filter(h => named(homeCore(h.core, names), w));
    const here = hit.length ? hit : AT_OWN.test(w) ? mine.slice(-1) : [];
    return here.flatMap(h => [
        `· ${name}那头、${personWord(name)}住的地方（${h.name}）现在的样子（镜头不在这儿，是${personWord(name)}自己眼前的；${personWord(name)}那头照这个写）：`,
        ...h.items.map(x => `  - ${x}`),
        ...(h.gone.length ? [`  - 原来的${join(h.gone)}已经换掉、不在了`] : []),
    ]);
}
// 镜头所在那处住处现在的样子，一样一行（一样东西里自己带着逗号，并成一行读不清）。角色和旁白都用：它是这地方的事，不是谁的底子
export function homeLines(sheet, { present = [], scene = '', same = (a, b) => a === b, names = [], board = null } = {}) {
    return homeHere(sheet, { scene, present, same, names, board }).flatMap(h => [
        `· 这处住处（${h.name}）现在的样子，镜头就在这儿：`,
        ...h.items.map(x => `  - ${x}`),
        ...(h.gone.length ? [`  - 原来的${join(h.gone)}已经换掉、不在了`] : []),
    ]);
}
