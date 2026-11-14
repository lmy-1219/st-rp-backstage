// 场合（用户 10/16："之前在亲密戏中，回不了场外消息"）：眼下这几条正写着亲密戏、或者正打着、逃着——外头的人这会儿别来叩门，
// 候着的人那几句也不算玩家没回他。纯程序，只看最近几条叙述里的字眼：亲密认一类样子（吻、床、解衣、喘、交缠……），紧张认一类（枪、刀、血、追、逃、炸……）；
// 一个重的字眼就算，轻的要凑够几个。旁白的环境描写、引号里说的话不算（说"别开枪"不等于在打）。题材无关（D-37）。
import { narrationOf } from './timeline.mjs';
import { normalizeRelations, personOf } from './relations.mjs';

export const WINDOW = 4;   // 看最近几条
const CAMERA = 'narrator', CAMERA_NAME = '旁白';
const isNarrator = m => !!m && !m.is_user && (m.speaker === CAMERA || m.name === CAMERA_NAME);

// 认字要认「在亲密」而不是日常里碰巧有这个字（T074 返工二）：舌只认舌头/舌尖这类（锁舌、口舌不算）；床头（柜）、床沿是日常，床上降为弱信号；
// 紧张里：炸（油炸、炸鸡……）、闪（灯光闪烁）、刀（刀鞘、刀叉、菜刀……）的日常用法不算（T074 返工三）。
// 腰只认有人碰腰（弯腰、腰封、腰包不算）；埋进/埋在要接怀颈胸肩发。被子里要同一小句里有另一个人才算（T135：一个人钻进被子睡觉被当成亲密戏，挡住了该来的人）。
const STRONG_CLOSE = /吻|亲上|亲了|呻吟|解开[^，。；！？]{0,8}(?:衣|扣|裤|裙|胸|领|衬衫)|脱(?:下|掉|去|了)[^，。；！？]{0,4}(?:衣|裤|裙|衬|外套|内)|褪(?:下|去|到)|舌吻|唇舌|交缠|缠在一起|动情|情动|欲望|唇齿|咬住[^，。；！？]{0,3}(?:唇|耳|颈|肩)/;
const SOFT_CLOSE = /抱紧|搂紧|搂住|搂进|贴着|贴上|贴紧|体温|耳垂|后颈|锁骨|喉结|发烫|滚烫|发颤|轻颤|气息|鼻息|呼吸(?:乱|急|重|滚)|额头抵|抵着|唇|嘴唇|舔|压在|压上|压住|床上|(?:搂|揽|环|掐|箍)(?:住|着|紧)?[^，。；！？]{0,2}腰|(?:手|指|掌)[^，。；！？]{0,3}腰间|胸口|指尖|指腹|掌心|耳边|颈侧|脖颈|埋(?:进|在)[^，。；！？]{0,3}(?:怀|颈|胸|肩|发)/;
const SOFT_PART = /耳垂|后颈|锁骨|喉结|胸口|指尖|指腹|掌心|耳边|颈侧|脖颈/;
const SOFT_CLOSE_ACTION = /抱紧|搂紧|搂住|搂进|贴着|贴上|贴紧|体温|发烫|滚烫|发颤|轻颤|气息|鼻息|呼吸(?:乱|急|重|滚)|额头抵|抵着|唇|嘴唇|舔|压在|压上|压住|床上|(?:搂|揽|环|掐|箍)(?:住|着|紧)?[^，。；！？]{0,2}腰|(?:手|指|掌)[^，。；！？]{0,3}腰间|埋(?:进|在)[^，。；！？]{0,3}(?:怀|颈|胸|肩|发)/;
const STRONG_TENSE = /开火|开枪|子弹|射击|瞄准|扳机|枪口|中弹|爆炸|刺进|(?<!狗)血(?:流|涌|溅|泊|淋)|追上来|追了上来|包围|埋伏|持枪|枪声|交火|打起来|扭打|撕打/;
const SOFT_TENSE = /枪|(?<!菜|水果|餐|削[^，。；！？]{0,3})刀(?!鞘|叉|具)|血|撞|(?<!油|煎|酥|干)炸(?!鸡|肉|面|串|薯|酱|糕|饼|丸|虾|鱼|排|[^，。；！？]{0,3}肉)|追|逃|跑|扑|揍|拳|踹|吼|喊|尖叫|威胁|逼近|退后|躲|(?<!灯[^，。；！？]{0,6})(?<!一闪一)闪(?!烁|光|着光|一闪)|摔|砸|撞开|踢开|冲出|冲进|压低身|趴下|掩体|拔出|掏出/;
const count = (text, re) => (String(text ?? '').match(new RegExp(re.source, 'g')) ?? []).length;
const CLAUSE = /[，。；！？]/;
const CLOSE_AMBIGUOUS = /舌头|舌尖|伸舌|喘息|大腿根|胯|含住|吮|啃咬|被子里/g;
const TENSE_AMBIGUOUS = /警笛|警报|捅|砍|炸开/g;
const TONGUE_PARTNER = /唇|嘴|勾|缠|探进|吻|(?:他|她|对方|彼此)[^，。；！？]{0,4}口腔/;
const BREATH_PARTNER = /吻|贴|压|身下|怀里|耳边|颈/;
// 提到人、抱着物件或想着场外的人，都不能证明同在被子里；共同动作才算。
const BED_PARTNER = /两人|两个人|俩|彼此|(?:搂着|抱着|贴着|靠着)(?:他|她|对方)(?=$|[,;.!?、：:]|(?:一起)?(?:钻|挤|躲|窝|睡|躺|坐|靠|贴|搂|抱|缩|说|笑|哭|看|听|闭|睁))|(?:他|她|对方)的(?:怀|胸|身侧)/;
function bedTogether(messages, { roster = [], names = [], relations = null, userName = null } = {}) {
    const known = [...names, ...roster.map(p => typeof p === 'string' ? p : p?.name)].filter(Boolean);
    const rel = relations ? normalizeRelations(relations) : null;
    const aliases = rel ? known.flatMap(n => personOf(rel, n, known)?.又名 ?? []) : [];
    const player = userName ?? messages.find(m => m?.is_user && m.name)?.name;
    const people = [...new Set(['他', '她', '对方', player, ...known, ...aliases].filter(Boolean))];
    const escaped = people.map(n => String(n).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    return {
        together: new RegExp(`(?:和|跟|与|同)(?:${escaped.join('|')})(?:一起|钻|挤|躲|窝)`),
        people: new RegExp([...escaped].sort((a, b) => b.length - a.length).join('|'), 'g'),
    };
}
function bedPaired(clause, { together, people }) {
    if (/独自|一个人|自己一个/.test(clause)) return false;
    // 先遮住同一份 people 名单中的人名/又名（含人称），等长占位保留匹配位置，避免姓名中的动词字干扰。
    const masked = clause.replace(people, name => '□'.repeat(name.length));
    // 同小句内，配对匹配之前出现想/梦/回忆/等/盼/念，无论隔多远都排除；之后出现不影响。
    // 取舍：拿不准从严，不认想象里的同床；不再逐个判断紧挨对象的词形。
    const imagined = match => /想|梦|回忆|等|盼|念/.test(masked.slice(0, match.index));
    return [together, BED_PARTNER].some(re => [...clause.matchAll(new RegExp(re.source, 'g'))].some(m => !imagined(m)));
}
const OTHER_BODY = /(?:他|她|对方|彼此|那人)[^，。；！？]{0,5}(?:身|腰|腿|腹|胯|胸|臀|肩|手|颈|背)/;
const SUCK_OBJECT = /唇|耳|指|乳|颈|舌|嘴/;
const STAB_PARTNER = /刀|匕首|刺|肚子|腹|胸|血|伤口/;
const CHOP_PARTNER = /刀|斧|剑|刃|匕首|胳膊|手臂|脖|颈|头|胸|腿|肩|背|腹|身|血/;

function closeCounts(text, together) {
    let strong = 0, soft = 0;
    for (const clause of String(text ?? '').split(CLAUSE)) {
        strong += count(clause, STRONG_CLOSE);
        for (const match of clause.matchAll(CLOSE_AMBIGUOUS)) {
            const word = match[0], at = match.index;
            const nearby = clause.slice(Math.max(0, at - 8), at + word.length + 8);
            const paired = /舌头|舌尖|伸舌/.test(word) ? TONGUE_PARTNER.test(clause)
                : word === '被子里' ? bedPaired(clause, together)
                : word === '喘息' ? BREATH_PARTNER.test(clause)
                : /胯|大腿根/.test(word) ? OTHER_BODY.test(clause)
                : /含住|吮/.test(word) ? SUCK_OBJECT.test(nearby.replace(word, ''))
                : SUCK_OBJECT.test(nearby); // 啃咬食物不是亲密
            if (paired) strong++; else soft++;
        }
    }
    return { strong, soft: soft + count(text, SOFT_CLOSE) };
}

function tenseCounts(text) {
    let strong = 0, soft = 0;
    for (const clause of String(text ?? '').split(CLAUSE)) {
        strong += count(clause, STRONG_TENSE);
        for (const match of clause.matchAll(TENSE_AMBIGUOUS)) {
            const word = match[0];
            const paired = word === '捅' ? STAB_PARTNER.test(clause) && !/捅(?:给|出去|破)/.test(clause)
                : word === '砍' ? !/砍价/.test(clause) && CHOP_PARTNER.test(clause)
                : word === '炸开' ? !/炸开(?:了)?锅|笑炸开|乐炸开/.test(clause)
                : false; // 警报、警笛只作弱信号
            if (paired) strong++; else if (word !== '炸开') soft++; // “炸”已由原有弱词计过一次
        }
    }
    return { strong, soft: soft + count(text, SOFT_TENSE) };
}

/**
 * 眼下是什么场合：'亲密' | '紧张' | null。messages：到此刻为止（最后几条就够）；opts.except：不算谁写的（候着的那位自己那条）
 * 只看叙述（括号、星号里的），引号里的话不算；旁白的不算亲密（环境描写里的"床"不是在床上）但算紧张（旁白写了交火）
 */
export function occasionOf(messages = [], { except = null, window = WINDOW, ...people } = {}) {
    const rows = messages.filter(m => m && !(except && (m.name === except || m.speaker === except))).slice(-window);
    const together = bedTogether(messages, people);
    let strongClose = 0, softClose = 0, strongTense = 0, softTense = 0;
    for (const m of rows) {
        const nar = narrationOf(m.text) ?? '';
        if (!isNarrator(m)) { const close = closeCounts(nar, together); strongClose += close.strong; softClose += close.soft; }
        const tense = tenseCounts(nar); strongTense += tense.strong; softTense += tense.soft;
    }
    const close = strongClose >= 1 || softClose >= 3;
    const tense = strongTense >= 1 || softTense >= 3;
    if (close && !tense) return '亲密';
    if (tense && !close) return '紧张';
    if (close && tense) return strongClose >= strongTense ? '亲密' : '紧张';
    return null;
}
// 叩门用的严口径：亲密的弱信号须在同一条里凑够三个；紧张只认强信号。
export function occasionStrict(messages = [], { except = null, window = WINDOW, ...people } = {}) {
    const rows = messages.filter(m => m && !(except && (m.name === except || m.speaker === except))).slice(-window);
    const together = bedTogether(messages, people);
    const closeRows = closeCountsByMessage(rows, { window, ...people });
    const strongClose = closeRows.reduce((n, r) => n + r.strong, 0);
    const close = strongClose >= 1 || rows.some(m => {
        if (isNarrator(m)) return false;
        const nar = narrationOf(m.text) ?? '';
        const parts = count(nar, SOFT_PART), actions = count(nar, SOFT_CLOSE_ACTION) + closeCounts(nar, together).soft - count(nar, SOFT_CLOSE);
        return parts + actions >= 3 && actions >= 2;
    });
    const strongTense = tenseStrongCount(rows, { window });
    const tense = strongTense >= 1;
    if (close && !tense) return '亲密';
    if (tense && !close) return '紧张';
    if (close && tense) return strongClose >= strongTense ? '亲密' : '紧张';
    return null;
}
// 亲密字眼按条计数（T074 返工：路标卡用更严的口径，要知道弱信号散在几条消息里）。口径同 occasionOf：只看叙述、旁白不算；不改 occasionOf 本身。
export function closeCountsByMessage(messages = [], { window = WINDOW, ...people } = {}) {
    const together = bedTogether(messages, people);
    return messages.filter(Boolean).slice(-window).map(m => {
        const nar = narrationOf(m.text) ?? '';
        return isNarrator(m) ? { strong: 0, soft: 0 } : closeCounts(nar, together);
    });
}
// 紧张强信号按条计数（路标卡只看强信号，T074 返工三）。口径同 occasionOf（旁白也算紧张）。
export function tenseStrongCount(messages = [], { window = WINDOW } = {}) {
    return messages.filter(Boolean).slice(-window).reduce((n, m) => n + tenseCounts(narrationOf(m.text) ?? '').strong, 0);
}
export const tenseStrict = (messages = []) => tenseStrongCount(messages) >= 1;
export const WHY = { 亲密: '正是亲密的时候，外头的人先别来', 紧张: '正打着、逃着，顾不上外头' };

// 交心（T074）：谈心、吵架、道歉、和好、表白、哭诉这一类要连续、要沉浸的身心交流场面——路标卡先别自动弹出来打断。
// 和 occasionOf 分开写（叩门的行为不变）。纯程序，只看最近几条的叙述和对白（这类话都在对白里：道歉、表白、争吵），
// 旁白的环境描写也算（旁白写了"她哭了"）。重的字眼一个就算，轻的要凑够三个。题材无关（D-37）。
const STRONG_HEART = /对不起|抱歉|原谅|和好|道歉|赔不是|我喜欢你|喜欢上了你|我爱你|表白|吵架|争吵|大吵|摔门|哽咽|抽泣|啜泣|泣不成声|痛哭|失声/;
const SOFT_HEART = /哭|泪|眼眶|红了眼|哭腔|沉默|叹气|心里话|心事|难过|委屈|误会|解释|谈谈|聊聊|真心|在乎|害怕|生气|怒|吼/;
export function heartToHeart(messages = [], { window = WINDOW } = {}) {
    let strong = 0, soft = 0;
    for (const m of messages.filter(Boolean).slice(-window)) { const t = String(m.text ?? ''); strong += count(t, STRONG_HEART); soft += count(t, SOFT_HEART); }
    return strong >= 1 || soft >= 3;
}
