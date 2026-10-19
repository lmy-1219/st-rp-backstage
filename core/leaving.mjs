// 自动离场判定（方案 自动进离场与调度 第二节第 4 条，N-377）：程序先认三样，认不出的（sure: false）留给"看一眼"兜底——
// 挂断：通话、消息结束——他或玩家的话里有挂断、挂了、不回了、先这样；远程的人连着 N 句玩家没对他说（话题转到屋里的人身上）；
// 走了：他自己那条叙述里写了走了、出门、转身走出（字眼复用 camera-turn 的 LEAVE，别复制一份）；玩家、旁白的叙述写了他走也算；
// 换场景：玩家的叙述把镜头挪走（移动词复用 board.movement），没写带着他 → 他留在原地，算不在场；写了带着他、和他一起 → 跟着。
// 只读消息、返回判定 { left, how: '挂断'|'走了'|'换场景'|null, at, sure, why }；关区间、记去向、静音、/isolate-leave 是主窗 1b、1c 的事。
// 后来的消息重新提供证据：明确回来算还在，新的含糊叙述保留没判。题材无关。
import { LEAVE, callsOf } from './camera-turn.mjs';
import { hasCard } from './arrival.mjs';
import { movement } from './board.mjs';
import { narrationOf } from './timeline.mjs';
import { addresseeOf } from './director.mjs';
import { normalizeRelations } from './relations.mjs';
import { visOf } from './visibility.mjs';

const CAMERA = 'narrator', CAMERA_NAME = '旁白';
const QUOTE = /“[^“”]{1,600}”|「[^「」]{1,600}」|『[^『』]{1,600}』|"[^"\n]{1,600}"/g;
const CLAUSE = /[，,。！？!?；;：:\n]/;
const isNarrator = m => !!m && !m.is_user && (m.speaker === CAMERA || m.name === CAMERA_NAME);
const mentions = (text, calls) => calls.some(c => c && String(text ?? '').includes(c));
const esc = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const clausesOf = t => String(t ?? '').split(CLAUSE).map(c => c.trim()).filter(Boolean);
const quotesOf = t => [...String(t ?? '').matchAll(QUOTE)].map(q => q[0]);
const hasQuote = t => quotesOf(t).length > 0;

// 通话、消息到此为止的字眼（他那头或玩家这头）
export const HANGUP = /挂断|挂了|挂掉|挂上|挂电话|先挂|收线|收了线|断了线|断线|掐了|掐断|结束通话|通话结束|按掉|按断|忙音|嘟嘟|先这样|先不说了|不说了|不聊了|回头说|回头聊|回头再说|晚点说|晚点聊|改天聊|改天说|下次再说|不回了|先忙|屏幕暗了|屏幕黑了|黑了屏/;
const NOT_HANGUP = /没挂|别挂|不挂|还没挂|没收线|没断/;
// 远程的人嘴里的"走了"也是到此为止
const GOING = /我(?:先|得|该|要)?走了|要走了|得走了|该走了|先走了|我走了/;
// 不算走：走了几步、走了过来、没走、又回来……；写着进来、坐下的那一小句也不算
const NOT_LEAVE = /没走|不走|别走|走不了|走不掉|走不开|走了[几两三一]?步|走了过来|走了进来|走了回来|走了神|走了样|走了调|走了一趟|走了一圈|走了一遍|走了一段|走了一阵|离不开|不离开|没离开|还没走|先别走|又回来|回来了|进来|进屋|进门|走进|坐下|躺下|落座|坐到|坐回|靠回|没出去|不出去|没消失|没不见/;
const hangupKind = word => /^挂/.test(word ?? '');   // LEAVE 里的 挂断、挂了电话 是通话那一类，当面的人不算走
// 道别、留下、让他等：镜头挪走时没带他
const PART = /道别|告别|分开|分手|留下|留在|告辞|挥手|目送|丢下|撇下|甩下|让[^，。！？]{0,4}(?:等|待|留)/;
// 写了"一起"、没点名：多半带着他，拿不准
const GENERIC_WITH = /一起|一道|一块|两人|两个人|俩|我们|大家|几人|一行|一同|并肩|肩并肩|手拉手/;

/**
 * 他走了没有。messages：这一局的消息；who：他的名字；options：
 *   aliases 又名、avatar 他的卡、userName 玩家名、status 'present'（当面）|'remote'（远程）、way 远程的方式（电话／消息）、
 *   since 从哪条起看（他这次进场的起点）、n 远程的人连着几句玩家没对他说算结束（默认 3）、others 在场的别人、roster 名册、relations 关系表（认又名）
 * 返回 { left, how: '挂断'|'走了'|'换场景'|null, at（哪条上认出来的）, sure, why }
 */
// 未命中词表只是没判，不能替角色证明他还在。否定、假设和动作对象都从严。
const UNSURE = /没有|没|不|别|如果|要是|假如|若|万一|打算|准备|想|将|要|会|回忆|记得|曾经|假装|仿佛|似乎|可能|让|请|叫/;
const uncertain = text => UNSURE.test(text.replace(/道别|告别/g, ""));
const STAY = /还在|仍在|留在|坐下|坐着|坐回|坐到|落座|靠在|靠回|站在|躺下|躺着|转过身|又回来|回来了|继续(?:看|做|说|收拾)|开口(?:说|问)/;
// 这是复核信号，不是确定离场的词表；任何来源都检查，宁可多复核。
const EXIT_SIGNAL = /出|去|走|退|离|散|辞|别|遁|归|回|撤|滚|挂/;
const COLLECTIVE = /们|众|都|全|所有|大家|各位|左右|闲杂|(?:两|几|数|[二三四五六七八九十0-9]+)(?:个|名|位|人)/;
// 例外从严：某个有卡人的叫法后紧接动作或少量修饰，才能认成只说那个人。
const NAMED_ACTION = /^(?:\s|已经|正在|转身|起身|随后|随即|先|就|便|也|又|已|正|将|要)*[出去走退离散辞别遁归回撤滚挂]/;
export function leftAt(messages = [], who, { aliases = [], avatar = null, userName = null, status = 'present', way = null, since = null, n = 3, others = [], roster = [], relations = null, remoteNames = [who] } = {}) {
    const none = { left: false, how: null, at: null, sure: true, why: '新消息和他无关' };
    if (!who) return none;
    const names = [...new Set([...roster.map(e => typeof e === 'string' ? e : e?.name), ...others, who].filter(Boolean))];
    const rel = relations ? normalizeRelations(relations) : null;
    const calls = [...new Set([...callsOf(who, { rel, names }), ...(aliases ?? []).filter(Boolean)])];
    const user = userName ?? [...messages].reverse().find(m => m?.is_user)?.name ?? null;
    const otherNames = names.filter(x => x !== who && x !== user && x !== CAMERA_NAME && !calls.includes(x));
    const otherCalls = otherNames.flatMap(x => callsOf(x, { rel, names })).filter(x => !calls.includes(x));
    const cardNames = new Set(roster.filter(e => typeof e === 'string' ? others.includes(e) : hasCard(e)).map(e => typeof e === 'string' ? e : e.name));
    const otherCards = otherNames.filter(name => cardNames.has(name)).map(name => ({ name, calls: callsOf(name, { rel, names }) }));
    const needsReview = text => clausesOf(text).some(clause => {
        if (COLLECTIVE.test(clause)) return true;
        if (!EXIT_SIGNAL.test(clause)) return false;
        const mentioned = otherCards.filter(p => mentions(clause, p.calls));
        if (!mentions(clause, calls) && mentioned.length === 1 && mentioned[0].calls.some(call => {
            const at = clause.indexOf(call);
            return at >= 0 && NAMED_ACTION.test(clause.slice(at + call.length));
        })) return false;
        return true;
    });
    const list = messages.filter(m => m && !m.hidden && (since == null || m.pos >= since)).sort((a,b) => a.pos-b.pos);
    const isHis = m => !m.is_user && (m.name === who || (!!avatar && m.speaker === avatar) || calls.includes(m.name));
    const remote = status === 'remote';
    const phone = /电话|来电|通话/.test(way ?? '');
    const unknown = (m, why) => ({ left: null, sure: false, how: null, at: m.pos, why });
    const stay = (m, why) => ({ left: false, sure: true, how: null, at: m.pos, why });
    const gone = (m, how, why) => ({ left: true, sure: true, how, at: m.pos, why });
    const word = c => { const w=LEAVE.exec(c.replace(/关上门|带上门/g, ''))?.[0]; if (hangupKind(w)) return null; return w==='转身走' && !/转身走(?:出|了出去|远|开)/.test(c) ? null : w; };
    const withHim = new RegExp('(?:带着|带上|领着|拉着|牵着|和|跟|同|与|陪|携|叫上)[ ]*(?:'+calls.map(esc).join('|')+')|(?:'+calls.map(esc).join('|')+')[ ]*(?:一起|一道|跟着|同行|跟上)');
    let result = none;
    let lastSpeaker = [...messages].filter(m => m.pos < (list[0]?.pos ?? Infinity) && !m.is_user && !isNarrator(m)).sort((a,b) => a.pos-b.pos).at(-1)?.name ?? null;
    for (const m of list) {
        const text = String(m.text ?? '');
        const own = isHis(m), named = mentions(text, calls), group = COLLECTIVE.test(text);
        // 未识别到点名不等于无关：宽信号先挂复核，再让已有明确证据作判定。
        if (needsReview(text)) result = unknown(m, '这条有离场或集体称呼信号，需要复核');
        const before = lastSpeaker;
        if (!m.is_user && !isNarrator(m)) lastSpeaker = m.name ?? null;
        const directed = !!m.is_user && (addresseeOf(text,[who,...otherNames],before,{rel,roster:names,userName:user})===who || (/你|您/.test(text) && !mentions(text,otherCalls)));
        const ambiguous = !m.is_user && /他|她/.test(text) && !mentions(text,otherCalls);
        if (remote && (own || m.is_user)) {
            const end = clausesOf(text).find(c => HANGUP.test(c) || GOING.test(c));
            if (end) {
                const target = own || (mentions(end,calls) && !mentions(end,otherCalls)) || (remoteNames.length === 1 && !mentions(end,otherCalls));
                result = uncertain(text) || NOT_HANGUP.test(end) || !target
                    ? unknown(m, '通话结束的对象或说法要复核') : gone(m, '挂断', '这段联系明确结束');
                continue;
            }
            if (own || named || group || directed) result = unknown(m, '这段联系是否结束还没判');
            continue;
        }
        const nar = narrationOf(text);
        if (own) {
            result = unknown(m, !nar && !hasQuote(text) ? '普通散文，需要复核离场' : '他这条是否离场要复核');
            const clauses = clausesOf(nar).filter(c => c.replace(/[（）()*\s]/g, '').length);
            for (const c of clauses) {
                const w = word(c);
                if (w && !group && !uncertain(nar) && !uncertain(c) && !NOT_LEAVE.test(c) && !/你/.test(c) && !mentions(c, otherCalls) && (!/[他她]/.test(c) || mentions(c,calls))) {
                    result = gone(m, '走了', '他自己的叙述明确写了走'); break;
                }
            }
            if (clauses.slice(-1).some(c => STAY.test(c) && !group && !uncertain(nar) && !uncertain(c) && !/你|您/.test(c) && (!/[他她]/.test(c) || mentions(c,calls)) && !mentions(c,otherCalls))) result = stay(m,'他最新的叙述明确还在场');
            if (result.left === null && quotesOf(text).some(q => GOING.test(q))) result = unknown(m,'他嘴上说了要走，叙述没写清');
            continue;
        }
        if (m.is_user && !remote) {
            const mv = movement(text);
            if (mv?.place && !uncertain(nar)) {
                const namedClauses = clausesOf(nar).filter(c => mentions(c,calls));
                if (namedClauses.some(c=>PART.test(c))) result = gone(m,'换场景','玩家挪走，明确和他分开');
                else if (namedClauses.some(c=>withHim.test(c))) result = stay(m,'玩家挪走，明确带着他');
                else if (addresseeOf(text,[who,...otherNames],null,{rel,roster:names,userName:user})===who) result = stay(m,'玩家挪走，这句还在对他说');
                else if (named || group || GENERIC_WITH.test(nar)) result = unknown(m,'镜头挪走，带没带他要复核');
                else result = gone(m,'换场景','玩家挪走，没写带着他');
                continue;
            }
        }
        if (named || group || directed || ambiguous) {
            result = unknown(m, group ? '这条涉及一群人，需要逐人复核' : '这条提到了他，需要复核');
            if (!group && (m.is_user || isNarrator(m))) {
                const body = nar || (isNarrator(m) && !hasQuote(text) ? text : '');
                const c = clausesOf(body).find(c => mentions(c,calls) && word(c) && !uncertain(body) && !uncertain(c) && !NOT_LEAVE.test(c) && !mentions(c,otherCalls));
                if (c) result = gone(m,'走了','叙述明确写了他走');
            }
        }
    }
    if (remote) {
        const lastHis = Math.max(-1,...list.filter(isHis).map(m=>m.pos));
        const users = list.filter(m=>m.is_user && m.pos>lastHis);
        let count=0, explicit=false;
        for(let i=users.length-1;i>=0 && count<n;i--) {
            const m=users[i];
            const before=list.filter(x=>x.pos<m.pos && !x.is_user && !isNarrator(x)).at(-1)?.name ?? null;
            const to=addresseeOf(m.text,[who,...otherNames],before,{rel,roster:names,userName:user});
            if(to===who || (to==null && phone && hasQuote(m.text))) break;
            count++; if(to) explicit=true;
        }
        if(count>=n) return explicit ? gone(users.at(-1),'挂断','玩家连续转向别人说话') : unknown(users.at(-1),'远程联系久未回应，需要复核');
    }
    return result;
}
