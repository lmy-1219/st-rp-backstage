// 场合（用户 10/16："之前在亲密戏中，回不了场外消息"）：眼下这几条正写着亲密戏、或者正打着、逃着——外头的人这会儿别来叩门，
// 候着的人那几句也不算玩家没回他。纯程序，只看最近几条叙述里的字眼：亲密认一类样子（吻、床、解衣、喘、交缠……），紧张认一类（枪、刀、血、追、逃、炸……）；
// 一个重的字眼就算，轻的要凑够几个。旁白的环境描写、引号里说的话不算（说"别开枪"不等于在打）。题材无关（D-37）。
import { narrationOf } from './timeline.mjs';

export const WINDOW = 4;   // 看最近几条
const CAMERA = 'narrator', CAMERA_NAME = '旁白';
const isNarrator = m => !!m && !m.is_user && (m.speaker === CAMERA || m.name === CAMERA_NAME);

const STRONG_CLOSE = /吻|亲上|亲了|呻吟|喘息|床上|床沿|床头|被子里|解开[^，。；！？]{0,4}(?:衣|扣|裤|裙|胸|领)|脱(?:下|掉|去|了)[^，。；！？]{0,4}(?:衣|裤|裙|衬|外套|内)|褪(?:下|去|到)|舌|胯|大腿根|交缠|缠在一起|动情|情动|欲望|唇齿|啃咬|咬住[^，。；！？]{0,3}(?:唇|耳|颈|肩)|含住|吮/;
const SOFT_CLOSE = /抱紧|搂紧|搂住|搂进|贴着|贴上|贴紧|体温|耳垂|后颈|锁骨|喉结|发烫|滚烫|发颤|轻颤|气息|鼻息|呼吸(?:乱|急|重|滚)|额头抵|抵着|唇|嘴唇|舔|压在|压上|压住|腰|胸口|指尖|指腹|掌心|耳边|颈侧|脖颈|埋进|埋在/;
const STRONG_TENSE = /开火|开枪|子弹|射击|瞄准|扳机|枪口|中弹|爆炸|炸开|砍|捅|刺进|血(?:流|涌|溅|泊|淋)|追上来|追了上来|包围|埋伏|警笛|警报|持枪|枪声|交火|打起来|扭打|撕打/;
const SOFT_TENSE = /枪|刀|血|撞|炸|追|逃|跑|扑|揍|拳|踹|吼|喊|尖叫|威胁|逼近|退后|躲|闪|摔|砸|撞开|踢开|冲出|冲进|压低身|趴下|掩体|拔出|掏出/;
const count = (text, re) => (String(text ?? '').match(new RegExp(re.source, 'g')) ?? []).length;

/**
 * 眼下是什么场合：'亲密' | '紧张' | null。messages：到此刻为止（最后几条就够）；opts.except：不算谁写的（候着的那位自己那条）
 * 只看叙述（括号、星号里的），引号里的话不算；旁白的不算亲密（环境描写里的"床"不是在床上）但算紧张（旁白写了交火）
 */
export function occasionOf(messages = [], { except = null, window = WINDOW } = {}) {
    const rows = messages.filter(m => m && !(except && (m.name === except || m.speaker === except))).slice(-window);
    let strongClose = 0, softClose = 0, strongTense = 0, softTense = 0;
    for (const m of rows) {
        const nar = narrationOf(m.text) ?? '';
        if (!isNarrator(m)) { strongClose += count(nar, STRONG_CLOSE); softClose += count(nar, SOFT_CLOSE); }
        strongTense += count(nar, STRONG_TENSE); softTense += count(nar, SOFT_TENSE);
    }
    const close = strongClose >= 1 || softClose >= 3;
    const tense = strongTense >= 1 || softTense >= 3;
    if (close && !tense) return '亲密';
    if (tense && !close) return '紧张';
    if (close && tense) return strongClose >= strongTense ? '亲密' : '紧张';
    return null;
}
export const WHY = { 亲密: '正是亲密的时候，外头的人先别来', 紧张: '正打着、逃着，顾不上外头' };
