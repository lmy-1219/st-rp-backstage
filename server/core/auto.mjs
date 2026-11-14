import { personWord } from './pronoun.mjs';
import { createHash } from 'node:crypto';
// 自动进离场与调度的后台接口层（方案 自动进离场与调度 第七节 1b，N-377～N-379，D-201）。
// 判定都在 director.mjs（谁接话）、knock.mjs（叩门状态机）、leaving.mjs（走了没有）、visibility.mjs（谁看得见）里，这儿只管：
// · 发起叩门：门上到时候了的那一项（doorFor）＋时机（knockTiming）→ 候着的一条（knock_pending），进场那份先理（arrive prepare），扩展叫他写那一条；
// · 他那条落下了 → 记成叩门（knocks），进场那份接上（他从那条起远程、或在门口候着）；
// · 候着 → 玩家回应 → 进场（上门的把去向清掉）；两句没回、换了时段 → 作废（门上那一项回来，等着没人接那条路接着走；他心里记一笔没人理）；
//   认不出是不是在回他的那几句交便宜模型（judge），判了写回 verdicts；快捷按钮（接／不理／让他进来）写 forced；
// · 谁接话：拼 director.turnDetail 要的料（场面表、名册、关系、每人此刻要说的、节奏档）；候着的人只在玩家对他说时才排；
// · 自动离场：场面表上在场、远程的人逐个过一遍 leaving.leftAt，拿得准的交 main.leave 记去向，记下免得重复；删了那条就重新算。
// 存的都挂在消息上（条号＋指纹），删消息＝没发生过（D-185）。题材无关（D-37）。
import { turnDetail } from './director.mjs';
import { knockState, knockTiming, wayOf as knockWayOf } from './knock.mjs';
import { leftAt, completedDeparture, qualifiedAt } from './leaving.mjs';
import { callsOf } from './camera-turn.mjs';
import { normalizeRelations, leaderOf, personOf } from './relations.mjs';
import { boardFor, sourceVersion, factBasis, factCurrent, factInput } from './board.mjs';
import { capFresh } from './door.mjs';
import { pendingFor } from './pending.mjs';
import { timelineFor, paceFor, playModeOf } from './slot.mjs';
import { isOpenMatter, INTENT, closeIntents } from './matters.mjs';
import { sameName } from './setup.mjs';
import { hasCard, callsFor } from './arrival.mjs';
import { narrationOf } from './timeline.mjs';
import { resolveIdentity, sameIdentity, messageIsPerson } from './cast.mjs';
import { isPrivate } from './visibility.mjs';

export const KNOCKS = chatKey => `knocks:${chatKey}`;
export const PENDING = chatKey => `knock_pending:${chatKey}`;
export const LEFT = chatKey => `auto_left:${chatKey}`;
const KEEP = 40;
const CAME_LOOKBACK = 3;
const CAME_RECHECKS = 2;

const read = (store, key, fallback) => { try { return JSON.parse(store.getMeta?.(key) ?? 'null') ?? fallback; } catch { return fallback; } };
const readRaw = (store, key, fallback) => { try { return JSON.parse((store.getRawMeta ?? store.getMeta)?.(key) ?? 'null') ?? fallback; } catch { return fallback; } };
const write = (store, key, value) => store.setMeta?.(key, value == null ? null : JSON.stringify(value));
const num = v => (Number.isFinite(Number(v)) ? Number(v) : null);
const isHis = (m, k) => messageIsPerson(m, { ...k, name: k.who });
const userOf = messages => [...messages].reverse().find(m => m.is_user)?.name ?? '玩家';
const live = messages => messages.filter(m => !m.hidden);
const rowsOf = tl => pos => (tl.firmRows ?? tl.rows).filter(r => r.pos <= pos).at(-1) ?? { day: tl.firmToday ?? tl.today, part: tl.firmPart ?? tl.part };

function currentSource(store, chatKey, item, log = true) {
    const ok = !item.sourceVersion || item.sourceVersion === sourceVersion(store, chatKey, item.through ?? item.checkedAt ?? item.at);
    if (!ok && log) store.logEvent?.(chatKey, 'auto_stale_result', { avatar: item.avatar, at: item.at, reason: '判定依据已更新，保留当前状态' });
    return ok;
}

// 一轮的执行凭据挂在现有聊天元数据上；发令和落消息分别记账。
function executionBasis(store, chatKey, item) {
    const chat=store.requireChat(chatKey), board=boardFor(store,null,chatKey);
    let members=[],anchors={};try{members=JSON.parse(chat.members??'[]');anchors=JSON.parse(chat.anchors??'{}');}catch{}
    const person=board.people.find(p=>p.avatar===item.avatar);
    const scope=store.getCast?.(chat.story_id)??[];
    const manualRevision=createHash('sha256').update(JSON.stringify([
        anchors?.[item.avatar]?.rpeManualRevision??null,
        store.currentMessages(chatKey).filter(m=>m.pos<=(item.through??Infinity)&&m.boardMark).map(m=>[m.pos,m.boardMark]),
        store.getMeta?.(`card_choices:${chatKey}`)??null,scope.map(p=>[p.avatar,p.name,p.role]),
    ])).digest('hex');
    return { person:person ? [person.avatar,person.status,person.since,person.way,person.manualAway??null] : null,
        plan:person?.plan??null, arrivals:readRaw(store,`arrivals:${chatKey}`,[]).filter(p=>sameIdentity(p,item,scope)),
        member:members.some(p=>(typeof p==='string'?p:p.avatar)===item.avatar), segments:anchors?.[item.avatar]?.segments??[],
        manualRevision };
}
function executionCurrent(store, chatKey, e) {
    const current=executionBasis(store,chatKey,e),before=e.eligibility;
    if(!before||JSON.stringify(before)===JSON.stringify(current))return true;
    if(executionReprojected(store,chatKey,e,current)&&['present','remote'].includes(current.person?.[1])
        &&current.person[1]===before.person?.[1]){
        const person=[...current.person];person[2]=before.person[2];
        if(JSON.stringify({...current,segments:before.segments,person})===JSON.stringify(before))return true;
    }
    if(!['enter','back','knock'].includes(e.action)||!current.member)return false;
    // 凭据明确授权的准备动作只可新增这一段；其他进离场和人工裁决仍使它失效。
    const added=current.segments.at(-1);
    if(current.segments.length!==before.segments.length+1||added?.from!==e.openAt||added.to!=null
        ||JSON.stringify(current.segments.slice(0,-1))!==JSON.stringify(before.segments))return false;
    const samePerson=JSON.stringify(current.person)===JSON.stringify(before.person);
    if(!samePerson&&!(current.person?.[1]==='present'&&current.person[2]===e.openAt&&!current.person[4]))return false;
    return JSON.stringify({...current,segments:before.segments,member:before.member,person:before.person})===JSON.stringify(before);
}
function executionReprojected(store,chatKey,e,current=executionBasis(store,chatKey,e)) {
    if(!e.eligibility)return false;
    // 来源正文、裁决和人工入口有自己的留痕；没有用户正证据的区间变化默认是系统重新核对。
    return (!Object.hasOwn(e.eligibility,'manualRevision')||current.manualRevision===e.eligibility.manualRevision)
        &&JSON.stringify(current.person?.[4]??null)===JSON.stringify(e.eligibility.person?.[4]??null);
}
function executionSource(messages, through) {
    return 'v2:'+createHash('sha256').update(JSON.stringify([through,messages.filter(m=>m.pos<=through)
        .map(m=>[m.pos,m.fp,!!m.hidden])])).digest('hex');
}
function executionSourceMatches(e,messages) {
    if(!e.source)return messages.some(m=>m.pos===e.through);
    if(e.source.startsWith('v2:'))return e.source===executionSource(messages,e.through);
    // 旧指纹只覆盖末楼；无法证明更早正文是否改变时保留原来的暂停与显式核对。
    return e.source===createHash('sha256').update(JSON.stringify([e.through,messages.find(m=>m.pos===e.through)?.fp??null])).digest('hex');
}
export function executionFor(store, chatKey, item, kind = 'speak', retryOf = null) {
    if (item.who !== '旁白' && !hasCard(item)) throw Error(`${item.who}的卡身份未对上，请认卡确认后重新排队`);
    const messages = store.currentMessages(chatKey), through = messages.at(-1)?.pos ?? -1;
    const version = sourceVersion(store, chatKey, through);
    const source = executionSource(messages, through);
    const action=kind==='knock'?'knock':item.who==='旁白'?'camera':item.back?'back':item.enter?'enter':'speak';
    const eligibility=executionBasis(store,chatKey,item);
    const floor=Math.max(0,...eligibility.segments.filter(s=>s.to!=null&&s.to>s.from).map(s=>s.to));
    const openAt=Number.isInteger(item.enter?.at)&&item.enter.at>=floor?item.enter.at:through+1;
    const all = read(store, `auto_execution:${chatKey}`, []);
    for(const old of all)if(old.avatar===(item.avatar??null)&&old.through===through
        &&old.source&&!executionSourceMatches(old,messages))
        old.state='superseded';
    const withdrawn=all.find(e=>e.avatar===(item.avatar??null)&&e.through===through&&e.state==='delivered'
        &&!messages.some(m=>m.pos>e.through&&!m.hidden&&!m.is_user&&(e.avatar?m.speaker===e.avatar:m.name==='旁白')));
    if(!retryOf&&withdrawn){withdrawn.state='superseded';retryOf=withdrawn.id;}
    const held=all.find(e=>e.avatar===(item.avatar??null)&&e.through===through&&executionSourceMatches(e,messages)
        &&(['running','unconfirmed','cancelled','error','waiting','delivered'].includes(e.state)||e.retryOf&&e.state==='queued'));
    // 改稿又换回原稿时来源哈希会回到旧值，不能复用已经作废的同名执行 ID。
    if(!retryOf&&!held)retryOf=all.find(e=>e.avatar===(item.avatar??null)&&e.through===through&&e.state==='superseded'
        &&e.source&&executionSourceMatches(e,messages))?.id??null;
    const stamp=createHash('sha256').update(JSON.stringify([version,action,openAt,eligibility,...(retryOf?[retryOf,all.length]:[])])).digest('hex');
    const id = `${kind}:${encodeURIComponent(action === 'camera' ? 'narrator' : item.avatar)}:${through}:${stamp}`;
    // 发出过的同身份、同来源执行先核实；自身准备或纠正不能绕过未确认回执。
    // 旧回执信息不足时仍暂停；已发出/未确认的同来源执行优先于作废历史。
    let e = !retryOf && (held??all.find(e => e.id === id&&e.state!=='superseded'));
    if (!e) {
        e = { id, kind, source, action, eligibility, openAt, who: item.who, avatar: item.avatar ?? null, through, sourceVersion: version, state: 'queued' };
        if(retryOf)e.retryOf=retryOf;
        if(['enter','back','knock'].includes(action)){
            const fact=action==='enter'?activeCame(store,chatKey).find(c=>c.avatar===item.avatar&&c.at===item.enter.at):null;
            const basis={who:item.who,avatar:item.avatar,at:through,fp:messages.at(-1)?.fp,through,throughFp:messages.at(-1)?.fp,basis:[{pos:through,fp:messages.at(-1)?.fp}]};
            e.preparation=fact??{...basis,factBasis:factBasis(basis,factInput(store,chatKey))};
        }
        all.push(e); write(store, `auto_execution:${chatKey}`, all.slice(-60));
    }
    return { ...item, execution: { ...e } };
}
export function executionResult(store, chatKey, receipt, { records = null, config = null } = {}) {
    const all = read(store, `auto_execution:${chatKey}`, []);
    let e = all.find(e => e.id === receipt.id);
    // 对账先核实来源序列；前端另传精确身份的本人候选，复用到场的远程／私密排除。
    if(receipt.result==='reconcile'){
        const preparation=e?.preparation??receipt.previous?.preparation;
        if(!preparation)return {ok:false,why:'自动准备的来源记录缺失'};
        const input=factInput(store,chatKey),messages=Array.isArray(receipt.sequence)?receipt.sequence:input.messages;
        const facts={...input,messages};
        return {ok:true,preparationLive:factCurrent(preparation,facts)&&cameBasisLive(preparation,live(messages)),
            ownReplies:(receipt.ownReplies??[]).filter(m=>messages.some(s=>!s.hidden&&s.pos===m.pos&&s.fp===m.fp)
                &&inPersonEvidence(m, m.text, { who: input.roster.find(p=>p.avatar===preparation.avatar)?.name, roster: input.roster })).map(m=>({pos:m.pos,fp:m.fp})),
            laterCame:activeCame(store,chatKey,live(messages)).filter(c=>c.avatar===preparation.avatar
                &&factCurrent(c,facts)&&cameBasisLive(c,live(messages))).map(c=>({pos:c.at,fp:c.fp}))};
    }
    const missing=!e;
    if(!e&&receipt.result==='retry'&&receipt.previous?.id===receipt.id){
        const p=receipt.previous;
        if(Number.isInteger(p.through)&&p.through>=0&&['speak','knock'].includes(p.kind)
            && (p.avatar===null||typeof p.avatar==='string')&&typeof p.who==='string')e={...p,state:'unconfirmed'};
    }
    if (!e) return { ok: false, why: '来源版本已失效' };
    if(receipt.result==='start'&&e.state==='superseded')return {ok:false,why:'旧凭据已被替换，请核对当前执行'};
    const messages = live(store.currentMessages(chatKey));
    const landed = messages.find(m => m.pos > e.through && !m.is_user && String(m.text??'').trim() && (e.avatar ? m.speaker === e.avatar : m.name === '旁白'));
    const sameSource=executionSourceMatches(e,store.currentMessages(chatKey));
    if(!sameSource)return {ok:false,why:'来源版本已失效'};
    if(e.state==='delivered'&&!landed){e.state='unconfirmed';e.reason='原回复已撤回，请核对后重试';write(store,`auto_execution:${chatKey}`,all.slice(-60));}
    if (landed) { e.state = 'delivered'; e.reply = { pos: landed.pos, fp: landed.fp }; }
    else if (receipt.result === 'check') return { ok: true, execution: e };
    else if (receipt.result === 'retry') {
        if(e.state==='superseded')return {ok:false,why:'旧凭据已被替换，请核对当前执行'};
        if(missing&&e.kind==='knock'){
            const pending=pendingKnock(store,chatKey);
            if(pending?.execution===e.id&&pending.cleanup)e.cleanup=pending.cleanup;
        }
        if(e.kind==='knock'&&e.cleanup){
            const pending=pendingKnock(store,chatKey);
            if(!currentSource(store,chatKey,e)||pending?.execution!==e.id
                ||JSON.stringify(executionBasis(store,chatKey,e))!==JSON.stringify(e.cleanup.basis))return {ok:false,why:'在场或成员资格已改变，请重新排队'};
            const entries=readRaw(store,`arrivals:${chatKey}`,[]);
            write(store,`arrivals:${chatKey}`,[...entries,...e.cleanup.arrivals]);
            if(e.cleanup.arrived&&!read(store,`arrived:${chatKey}`,null))write(store,`arrived:${chatKey}`,e.cleanup.arrived);
            delete e.cleanup;
        }
        if(missing&&e.kind!=='knock'||!currentSource(store,chatKey,e)||!executionCurrent(store,chatKey,e)){
            // 用户明确要求重试，重新排当前队列；绝不把旧快照改成可以 start 的凭据。
            if(e.kind==='knock')return {ok:false,why:'在场或成员资格已改变，请重新排队'};
            const item=turnFor(store,records,chatKey,{config}).queue.find(q=>(q.avatar??null)===e.avatar);
            if(!item||item.avatar&&!executionBasis(store,chatKey,item).member&&!item.enter)return {ok:false,why:'当前没有接话资格，请核对在场和来源'};
            const q=executionFor(store,chatKey,item,e.kind,e.id);
            const updated=read(store,`auto_execution:${chatKey}`,[]),old=updated.find(x=>x.id===e.id);
            if(old)old.state='superseded';
            write(store,`auto_execution:${chatKey}`,updated);
            return {ok:true,execution:q.execution,item:q};
        }
        e.state = 'queued'; delete e.reason;
    }
    else if (receipt.result === 'start') {
        if (e.state !== 'queued') return { ok: false, execution: e, why: '这次执行已发出，先核对消息或由用户重试' };
        const current=executionBasis(store,chatKey,e);
        if(!currentSource(store,chatKey,e)||!executionCurrent(store,chatKey,e)
            || e.action==='speak'&&(!current.member||!['present','remote'].includes(current.person?.[1]))){
            if(current.member===e.eligibility?.member&&executionReprojected(store,chatKey,e,current))
                return {ok:false,replan:true,why:'系统在重新核对在场，稍后接上'};
            return {ok:false,why:'在场或成员资格已改变，请重新排队'};
        }
        e.state = 'running';
    } else if (['muted','cancelled','error','unconfirmed','waiting'].includes(receipt.result)) {
        e.state = receipt.result; e.reason = String(receipt.reason ?? '').slice(0,300);
    } else return { ok: false, why: '没有找到已落下的本人消息' };
    if(missing)all.push(e);
    if (e.kind === 'knock' && !['queued','running','delivered'].includes(e.state)) {
        const pending = pendingKnock(store, chatKey);
        if (pending && pending.avatar === e.avatar && pending.at === e.through + 1) {
            write(store,PENDING(chatKey),{...pending,error:e.reason||'生成未确认，请核对消息',execution:e.id});
            if (e.state !== 'unconfirmed') {
                const arrivals=readRaw(store,`arrivals:${chatKey}`,[]).filter(a=>a.knock&&a.avatar===e.avatar&&a.at===pending.at&&a.fp===pending.fp);
                const arrived=read(store,`arrived:${chatKey}`,null);
                dropKnockArrival(store,chatKey,pending);
                if(arrivals.length){
                    e.cleanup={arrivals,arrived:arrived?.avatar===e.avatar&&arrived.at===pending.at?arrived:null,basis:executionBasis(store,chatKey,e)};
                    write(store,PENDING(chatKey),{...pending,error:e.reason||'生成未确认，请核对消息',execution:e.id,cleanup:e.cleanup});
                }
            }
        }
    }
    if (e.kind === 'knock' && receipt.result === 'retry' && e.state === 'queued') {
        const pending = pendingKnock(store, chatKey);
        if (pending?.execution === e.id) {const {cleanup,...kept}=pending;write(store,PENDING(chatKey),{...kept,error:null});}
    }
    write(store, `auto_execution:${chatKey}`, all.slice(-60));
    store.logEvent?.(chatKey,'auto_execution_result',{id:e.id,state:e.state,avatar:e.avatar,reason:e.reason});
    return { ok: true, execution: e };
}

export const knocksOf = (store, chatKey) => read(store, KNOCKS(chatKey), []).filter(k => k && k.who && num(k.at) != null);
const blockedKnock = (store, chatKey, k) => playModeOf(store, chatKey) === 'memory' && ['pocket','contact','reach'].includes(k?.source?.type);
// 请求证据绑定请求本身，不能借普通来源的 sameMessage 改稿兼容续命。
function playerRequestFor(store, chatKey, person, { through = Infinity } = {}) {
    const chat = store.requireChat(chatKey), roster = store.getCast(chat.story_id) ?? [];
    const raw = store.relationsOf?.(chat.story_id), rel = raw ? normalizeRelations(raw) : null;
    const names = roster.map(p => p.name);
    const messages = store.currentMessages(chatKey).filter(m => m.pos <= through);
    const last = messages.at(-1)?.pos ?? -1;
    const unique = resolveIdentity(roster.filter(hasCard), person.who).person?.avatar === person.avatar;
    const called = m => m?.is_user && unique && callsFor(narrationOf(m.text), [person.who, ...(rel ? personOf(rel, person.who, names)?.又名 ?? [] : [])]);
    const valid = proof => {
        if (!proof || !sameIdentity(proof, person, roster)) return false;
        const message = messages.find(m => m.pos === proof.at);
        if (!message) return false;
        if (proof.type === 'message') return !!proof.fp && message.fp === proof.fp && !!called(message);
        if (proof.type !== 'button') return false;
        // 无指纹不能证明请求未改稿，不单独豁免依附者；需当前点名或重新点按钮。
        return !!proof.fp && message.fp === proof.fp;
    };
    // 本次请求已撤回就作废，不用别的当前请求替换这次证据。
    if (person.playerRequest) return valid(person.playerRequest) ? person.playerRequest : null;
    const request = read(store, `arrival_request:${chatKey}`, null);
    const button = request && { ...request, type: 'button' };
    if (button && last >= button.at && last - button.at <= 8 && valid(button)) return { ...button, who: person.who, avatar: person.avatar };
    const recent = [...messages].reverse().find(m => m.is_user);
    return called(recent) ? { type: 'message', who: person.who, avatar: person.avatar, at: recent.pos, fp: recent.fp } : null;
}
// 旧 pending 和直接远程进场也要守门；只有可辨认的玩家点名/请求能让依附者单独来。
export function unrequestedFollower(store, chatKey, person, { through = Infinity } = {}) {
    const chat = store.requireChat(chatKey), roster = store.getCast(chat.story_id) ?? [];
    const raw = store.relationsOf?.(chat.story_id), rel = raw ? normalizeRelations(raw) : null;
    const names = roster.map(p => p.name);
    if (!rel || !leaderOf(rel, person.who, names)) return false;
    if (person.source?.type === 'named') return false;
    return !playerRequestFor(store, chatKey, person, { through });
}
export const pendingKnock = (store, chatKey) => {
    const k=read(store,PENDING(chatKey),null);
    let valid=!k||currentSource(store,chatKey,k,false);
    // 联系/口袋的来源读口已核过日期和步骤；只改措辞的同一消息沿用项目既有改稿链。
    if(k&&!valid&&k.sourceBasis&&['contact','pocket'].includes(k.source?.type)&&k.sourceStep&&store.knockLive?.(chatKey,k)===true){
        const rows=store.currentMessages(chatKey).filter(m=>m.pos<=k.through);
        valid=k.sourceBasis.version===sourceVersion(store,chatKey,-1)&&rows.length===k.sourceBasis.rows.length&&rows.every((m,i)=>{
            const b=k.sourceBasis.rows[i];return m.pos===b.pos&&!!m.hidden===b.hidden&&(m.boardMark??null)===b.mark&&(m.fp===b.fp||store.sameMessage?.(m.fp,b.fp));
        });
    }
    const follower = k && unrequestedFollower(store, chatKey, k);
    if(k&&(!valid||follower)){store.logEvent?.(chatKey,'auto_stale_result',{avatar:k.avatar,reason:follower?'依附角色没有玩家请求，旧叩门失效':'叩门来源版本已改变'});write(store,PENDING(chatKey),null);dropKnockArrival(store,chatKey,k);return null;}
    return blockedKnock(store,chatKey,k) ? null : k;
};
export const writeKnocks = (store, chatKey, knocks) => {
    const hidden = readRaw(store, KNOCKS(chatKey), []).filter(k => !store.knockLive?.(chatKey, k));
    write(store, KNOCKS(chatKey), [...hidden, ...knocks].slice(-KEEP));
};

export function sourceStep(store, chatKey, k) {
    const source = k.source;
    if (!source) return null;
    let pos = k.sourceAt?.pos ?? source.pos ?? k.at - 1, fp = k.sourceAt?.fp ?? source.fp ?? k.fp, day = store.confirmedDayAt?.(chatKey, pos) ?? null, step = null;
    if (source.type === 'contact') {
        const current = read(store, `settled_contact:${chatKey}:${k.who}`, null);
        if (!current) return null;
        pos = current.at; fp = current.fp; day = current.basisDay ?? day; step = current.step ?? null;
    } else if (source.type === 'pocket') {
        const item = store.menuOf?.(chatKey, { all: true }).find(m => m.id === source.id);
        if (!item) return null;
        pos = item.status === 'shown' ? item.settled_pos : item.pocket_pos;
        day = item.status === 'shown' ? item.settled_day : item.pocket_day;
        step = item.status === 'shown' ? item.settled_step : item.pocket_step;
        fp = store.currentMessages(chatKey).find(m => m.pos === pos)?.fp ?? null;
    } else if (source.type === 'named' && Number.isInteger(source.id)) {
        pos = source.id;
        fp = store.currentMessages(chatKey).find(m => m.pos === pos)?.fp ?? null;
        day = store.confirmedDayAt?.(chatKey, pos) ?? day;
    }
    return { kind: source.type, id: source.id, pos, fp, day, ...(step != null ? { step } : {}) };
}

// 门上那一项他怎么来：说好了消息、电话的照说的；约好的、结算写的"他过来"、玩家叫的上门；在外头办事的照他去向里说的回法；其余发消息（最不扰人）
export function wayFor(item, plan = null) {
    // 门上只给了一种方式的才是说好的（doorAt：说好了消息、电话的 ways 只有那一个；默认的那一串里也有消息、电话，不算）
    const ways = item?.ways ?? [];
    if (ways.length === 1 && /消息|电话/.test(ways[0])) return /电话/.test(ways[0]) ? '电话' : '消息';
    const type = item?.source?.type;
    if (type === 'errand') return /上门/.test(plan?.back ?? '') ? '上门' : /电话/.test(plan?.back ?? '') ? '电话' : '消息';
    if (type === 'promise' || type === 'contact' || type === 'named') return '上门';
    return '消息';
}
const modeOf = way => (way === '上门' ? 'come' : 'remote');

function context(store, records, chatKey, { present = [], recentUser = '', timeline = null } = {}) {
    const chat = store.requireChat(chatKey);
    const messages = live(store.currentMessages(chatKey));
    const tl = timeline ?? timelineFor(store, records, chatKey, messages);
    const roster = store.getCast?.(chat.story_id) ?? [];
    const relations = store.relationsOf?.(chat.story_id) ?? null;
    const names = roster.map(e => e.name);
    let members = [];
    try { const parsed = JSON.parse(chat.members ?? '[]'); if (Array.isArray(parsed)) members = parsed; } catch {}
    return { chat, messages, tl, rowAt: rowsOf(tl), roster, relations, names, members, identityChoices: read(store,`card_choices:${chatKey}`,{}), userName: userOf(messages), present, recentUser,
        board: () => boardFor(store, records, chatKey, { present, recentUser, timeline: tl }) };
}

export function avatarFor(ctx, who, fallback = null) {
    return resolveIdentity(ctx.roster, { name: who, avatar: fallback }, { members: ctx.members, identityChoices: ctx.identityChoices }).person?.avatar ?? null;
}
const sameFor = (store, chatKey, a, b) => sameIdentity(a, b, store.getCast(store.requireChat(chatKey).story_id).filter(e => e.role !== '不用'));
const candidates = list => list.map((d,i) => ({ ...d, candidateId: `候选${i+1}` }));
function verdictFor(store, chatKey, doubts, d, verdicts) {
    const scope = store.getCast(store.requireChat(chatKey).story_id).filter(e => e.role !== '不用');
    const key = [d.candidateId, d.avatar].find(k => k && Object.hasOwn(verdicts ?? {}, k));
    const legacy = resolveIdentity(scope, d.who).person?.avatar === d.avatar && doubts.filter(x => x.who === d.who).length === 1;
    const value = key ? verdicts[key] : legacy ? verdicts?.[d.who] : undefined;
    if (typeof value === 'boolean' || (value && typeof value === 'object' && !Array.isArray(value)
        && ['走了','还在','被打发未动','看不出','到了','没到'].includes(value['结果']))) return value;
    store.logEvent?.(chatKey, 'auto_identity_unmatched', { avatar: d.avatar, who: d.who, reason: '回包没有唯一候选身份，保留原状态' });
    return undefined;
}

/**
 * 这会儿该不该叩门、谁、怎么来。返回 { ok, why } 或 { ok: true, who, avatar, way, at, fp, source, label }（还没记下，记下用 beginKnock）。
 * 不叩：关着；已经有一条候着的（pending 或状态机里候着）；时机不到（knockTiming）；门上没人到时候；门上那一项作废过（等结算换一条新的）
 */
// 门上该叩的那一项（不看时机）：到时候了、没作废过的头一项；旁白刚留的记号（door_lit，四条内）指着的优先。返回 { who, avatar, way, mode, source, label } 或 null
export function knockCandidate(store, records, chatKey, { present = [], timeline = null } = {}) {
    const ctx = context(store, records, chatKey, { present, timeline });
    const { messages, tl, names } = ctx;
    const last = messages.at(-1);
    if (!last) return null;
    const knocks = knocksOf(store, chatKey);
    const lit = read(store, `door_lit:${chatKey}`, null);
    const litOk = lit && num(lit.pos) != null && last.pos - num(lit.pos) <= 4 && messages.find(m => m.pos === num(lit.pos))?.fp === lit.fp;
    const items = capFresh(store, records, chatKey, { present, timeline: tl, litWho: litOk && ['narrator', 'named'].includes(lit.by) ? lit.who : null }).filter(i => i.ready);
    const lapsed = new Set(knocks.filter(k => k.lapsed && k.source).map(k => `${k.source.type}:${k.source.id}`));
    const fresh = items.filter(i => !(i.source && lapsed.has(`${i.source.type}:${i.source.id}`)));
    const item = (litOk ? fresh.find(i => sameName(i.who, lit.who, names)) : null) ?? fresh[0] ?? null;
    if (!item) return { who: null, why: items.length ? '门上的都叩过了、没人接' : '门上没人到时候' };
    let plan = null;
    try { plan = ctx.board().people.find(p => sameIdentity(p, item, ctx.roster))?.plan ?? null; } catch {}
    const way = wayFor(item, plan);
    const origin = ['promise', 'reach'].includes(item.source?.type) ? records?.visible?.(chatKey)?.find(r => r.id === item.source.id) : null;
    const sourceAt = origin ? { pos: origin.pos, fp: origin.fp } : item.source?.type === 'errand' && plan?.fp ? { pos: messages.find(m => m.fp === plan.fp)?.pos, fp: plan.fp } : null;
    const avatar = avatarFor(ctx, item.who, item.avatar);
    if (!avatar) return { who: null, why: `${item.who}的卡身份未能唯一匹配，请确认卡文件` };
    return { who: item.who, avatar, way, mode: modeOf(way), source: item.source ?? null, sourceAt, label: item.label ?? '' };
}

export function knockNow(store, records, chatKey, { present = [], timeline = null, config = null } = {}) {
    const auto = config?.auto ?? {};
    if (auto.enabled === false || auto.knock === false) return { ok: false, why: '关着' };
    const ctx = context(store, records, chatKey, { present, timeline });
    const { messages, tl, rowAt, roster, relations, names, userName } = ctx;
    const last = messages.at(-1);
    if (!last) return { ok: false, why: '还没有消息' };
    if (pendingKnock(store, chatKey)) return { ok: false, why: pendingKnock(store,chatKey).error || '有一条候着的还没写出来' };
    const knocks = knocksOf(store, chatKey);
    const c = knockCandidate(store, records, chatKey, { present, timeline: tl });
    const lit = read(store, `door_lit:${chatKey}`, null);
    const litPos = num(lit?.pos);
    const summoned = !!c?.who && (c.source?.type === 'named' || (lit?.by === 'narrator' && litPos != null
        && last.pos - litPos <= 4 && messages.find(m => m.pos === litPos)?.fp === lit.fp && sameName(c.who, lit.who, names)));
    const cards = ctx.board().people.filter(p=>p.card && ['present','remote'].includes(p.status)).map(p=>p.name);
    const timing = knockTiming({ messages, knocks, pace: paceFor(store, chatKey), present: cards, rowAt, parts: tl.parts, roster, relations, userName, maxTurns: auto.maxTurns, summoned, occasion: !summoned });
    if (!timing.ok) return { ok: false, why: timing.why };
    if (!c?.who) return { ok: false, why: c?.why ?? '门上没人到时候' };
    return { ok: true, ...c, at: last.pos + 1, fp: last.fp, basisDay: tl.firmToday ?? tl.today };
}

// 叩门时已经按叩门那条接了进场（main.autoTurn：进场那份理好了就先记，他那条写出来时记录已经在）
const knockEntry = (store, chatKey, k) => read(store, `arrivals:${chatKey}`, []).find(e => e?.knock && sameFor(store,chatKey,e, k) && num(e.at) === num(k.at) && e.fp === k.fp) ?? null;
// 候着的那条没写出来（挂的那条没了、那儿换成了别人在说）：叩门时记的那次进场撤掉
function dropKnockArrival(store, chatKey, k) {
    const list = readRaw(store, `arrivals:${chatKey}`, []);
    const kept = list.filter(e => !(e?.knock && sameFor(store,chatKey,e, k) && num(e.at) === num(k.at) && e.fp === k.fp));
    if (kept.length !== list.length) write(store, `arrivals:${chatKey}`, kept);
    const arrived = read(store, `arrived:${chatKey}`, null);
    if (arrived && sameFor(store,chatKey,arrived, k) && num(arrived.at) === num(k.at)) write(store, `arrived:${chatKey}`, null);
}
// 作废关闭沿用离场回执，直到落实才停止交付。
export function recentLapsed(store, chatKey) {
    const messages = live(store.currentMessages(chatKey)), last = messages.at(-1);
    if (!last) return [];
    const events = leaveEvents(store, chatKey);
    for (const k of knocksOf(store, chatKey).filter(k => k.lapsed && num(k.lapsed.pos) != null && messages.find(m => m.pos === num(k.lapsed.pos))?.fp === k.lapsed.fp)) {
        const item = { who: k.who, avatar: k.avatar ?? null, way: k.way, at: num(k.lapsed.pos), fp: k.lapsed.fp };
        const id = `lapsed:${eventId(item)}`;
        if (!events.some(e => e.id === id)) events.push({ ...item, through:item.at, sourceVersion:sourceVersion(store,chatKey,item.at), id, version: 1, action: 'leave', state: '待落实' });
    }
    write(store, LEAVE_EVENTS(chatKey), events);
    return events.filter(e => e.id.startsWith('lapsed:') && e.state === '待落实');
}

// 记下候着的一条（扩展接着叫他写）；进场那份由叫这个的人去先理（main.arrive prepare）
export function beginKnock(store, chatKey, k) {
    const basisDay = k.basisDay ?? store.confirmedDayAt?.(chatKey, k.at - 1) ?? timelineFor(store, null, chatKey).firmToday;
    const pending = { who: k.who, avatar: k.avatar ?? null, way: k.way, mode: k.mode ?? modeOf(k.way), at: k.at, fp: k.fp, through:k.at-1, sourceVersion:sourceVersion(store,chatKey,k.at-1), basisDay, source: k.source ?? null, sourceStep: sourceStep(store, chatKey, k), label: k.label ?? '', since: Date.now() };
    const chat = store.requireChat(chatKey), raw = store.relationsOf?.(chat.story_id);
    const names = (store.getCast(chat.story_id) ?? []).map(p => p.name);
    // 联系候选可能排在 named 前面；进场会消费 arrival_request，先把可核实的请求随这次叩门留下。
    if (raw && leaderOf(normalizeRelations(raw), k.who, names)) {
        const request = playerRequestFor(store, chatKey, k, { through: k.at - 1 });
        if (request) pending.playerRequest = request;
    }
    if(['contact','pocket'].includes(k.source?.type))pending.sourceBasis={version:sourceVersion(store,chatKey,-1),rows:store.currentMessages(chatKey).filter(m=>m.pos<k.at).map(m=>({pos:m.pos,fp:m.fp,hidden:!!m.hidden,mark:m.boardMark??null}))};
    write(store, PENDING(chatKey), pending);
    return pending;
}

// 快捷按钮（方案第二节第 3 条）：接／让他进来＝进场，不理＝作废；写在他这次叩门上，状态机先看它
export function answerKnock(store, chatKey, { who, avatar = null, answer }) {
    const knocks = knocksOf(store, chatKey);
    const scope = store.getCast(store.requireChat(chatKey).story_id).filter(e => e.role !== '不用');
    const person = resolveIdentity(scope, { name: who, avatar }).person;
    const k = person && [...knocks].reverse().find(x => sameIdentity(x, person, scope) && !x.entered && !x.lapsed);
    if (!k) return { ok: false, why: '他没有候着的叩门' };
    const messages = live(store.currentMessages(chatKey)), last = messages.at(-1);
    const forced = /不理|作废|否/.test(answer ?? '') ? '作废' : '进场';
    k.forced = forced;
    k.forcedAt = last ? { pos: last.pos, fp: last.fp } : null;
    writeKnocks(store, chatKey, knocks);
    return { ok: true, forced };
}

// 去向用完（和 main.dropAway 一样：人到场了不删，记下是哪一次进场用掉的）
function dropAwayPlan(store, chatKey, who, by) {
    const plans = read(store, `away_plan:${chatKey}`, {});
    for (const key of Object.keys(plans)) if (plans[key]?.who === who) plans[key] = { ...plans[key], dropped: by };
    write(store, `away_plan:${chatKey}`, plans);
}

// 作废了（他没进过场）：结算写的"要联系"、旁白替他递过的那条回到没用掉——门上那一项回来，等着没人接那条路接着走；
// 他这回的来意过去了；他心里记一笔没人理（只他知道，挂在定下作废的那条上，删了就没这回事）
function lapseKnock(store, records, chatKey, k, { chat, messages, names, userName }) {
    const same = (a, b) => sameName(a, b, names);
    const key = `settled_contact:${chatKey}:${k.who}`;
    const c = read(store, key, null);
    if (c?.usedAt && num(c.usedAt.pos) === k.at - 1 && c.usedAt.fp === k.fp) write(store, key, { ...c, used: false, usedAt: null, missed: (c.missed ?? 0) + 1 });
    if (k.source?.type === 'pocket' && Number.isInteger(k.source.id) && store.updateMenu) {
        const m = (store.menuOf?.(chatKey) ?? []).find(x => x.id === k.source.id);
        if (m && m.status === 'used') store.updateMenu(chatKey, m.id, { status: 'shown', by: k.who, why: '叩门没人接，他发过的那条还挂着' });
    }
    const decided = k.lapsed?.fp ?? messages.at(-1)?.fp ?? null;
    if (decided) {
        try { closeIntents({ records, chatKey, storyId: chat.story_id, who: k.who, fp: decided, same }); } catch {}
        const way = k.way === '电话' ? '打过电话' : k.way === '上门' ? '去找过' : '发过消息';
        if (records?.addDerived) try { records.addDerived({ storyId: chat.story_id, fp: decided, type: '心里', text: `${k.who}${way}${userName}，没人理。`.slice(0, 200), holder: k.avatar ?? `name:${k.who}`, holderName: k.who, audience: [k.who], about: k.who }); } catch {}
    }
    const arrived = read(store, `arrived:${chatKey}`, null);
    if (arrived && sameFor(store,chatKey,arrived, k) && num(arrived.at) === k.at) write(store, `arrived:${chatKey}`, null);
}

/**
 * 同步之后走一遍（main 在 sync 钩子里叫）：候着的那条写出来了没有；每次叩门走到哪一步。
 * deps：arrive（main.arrive，带 anchor、knock）、judge({ who, way, knock, text }) → true/false/null（便宜模型）、config
 * 返回 { finalized, entered: [k], lapsed: [k], gone: [k] }
 */
export async function knockAdvance(store, records, chatKey, { arrive = null, judge = null, config = null, present = [] } = {}) {
    const auto = config?.auto ?? {};
    const out = { finalized: null, entered: [], lapsed: [], gone: [] };
    const rawPending=readRaw(store,PENDING(chatKey),null);
    if (blockedKnock(store,chatKey,rawPending)) { write(store,PENDING(chatKey),null); dropKnockArrival(store,chatKey,rawPending); }
    const ctx = context(store, records, chatKey, { present });
    const { chat, messages, tl, rowAt, roster, relations, names, userName } = ctx;
    let knocks = knocksOf(store, chatKey);
    // 1. 候着的那条写出来了没有：写出来了就记成叩门、进场那份接上（他从那条起远程、或在门口候着）；挂的那条没了、或者那儿换成了别人在说，就没发生过
    const pending = pendingKnock(store, chatKey);
    if (pending) {
        const anchored = messages.find(m => m.pos === pending.at - 1)?.fp === pending.fp;
        const his = isHis(messages.find(m => m.pos === pending.at), pending);
        if (!anchored || (messages.some(m => m.pos >= pending.at) && !his)) { write(store, PENDING(chatKey), null); dropKnockArrival(store, chatKey, pending); }
        else if (his) {
            const k = { who: pending.who, avatar: pending.avatar ?? null, way: pending.way, at: pending.at, fp: pending.fp, basisDay: pending.basisDay, source: pending.source ?? null, sourceStep: pending.sourceStep ?? null, ...(pending.playerRequest ? { playerRequest: pending.playerRequest } : {}), verdicts: {} };
            knocks = [...knocks, k];
            writeKnocks(store, chatKey, knocks);
            write(store, PENDING(chatKey), null);
            out.finalized = k;
            // 叩门时没来得及接进场的（没有挂在这条上的进场记录）这时接：他从这条起远程、或在门口候着
            if (arrive && !knockEntry(store, chatKey, k)) try { await arrive({ chatKey, who: k.who, avatar: k.avatar, mode: pending.mode ?? modeOf(k.way), way: k.way, anchor: { at: k.at, fp: k.fp }, knock: true }); } catch {}
        }
    }
    if (!knocks.length) return out;
    const opts = { messages, knocks, userName, roster, relations, rowAt, parts: tl.parts, maxTurns: auto.maxTurns };
    const stateOf = k => (k.forced ? { state: k.forced, why: '玩家点了按钮', decided: k.forcedAt ?? { pos: messages.at(-1)?.pos, fp: messages.at(-1)?.fp }, asks: [] } : knockState(k, opts));
    const keep = [];
    for (const k of knocks) {
        if (k.entered || k.lapsed || blockedKnock(store,chatKey,k)) { keep.push(k); continue; }
        let s = stateOf(k);
        // 认不出是不是在回他的那几句：问一次便宜模型，判了写回，状态机再看一遍
        // 两句没回里有认不出的，也先问：第二句其实是在回他，就该进场不该作废
        if (['候着', '作废'].includes(s.state) && s.asks?.length && judge) {
            const knockText = String(messages.find(m => m.pos === s.message?.pos)?.text ?? '');
            let changed = false;
            for (const a of s.asks) {
                const key = `${a.pos}:${a.fp}`;
                if (k.verdicts && Object.prototype.hasOwnProperty.call(k.verdicts, key)) continue;
                let v = null;
                try { v = await judge({ chatKey, who: k.who, way: k.way, knock: knockText, text: a.text }); } catch {}
                if (v === true || v === false) { k.verdicts = { ...(k.verdicts ?? {}), [key]: v }; changed = true; }
            }
            if (changed) s = stateOf(k);
        }
        if (s.state === '进场') {
            k.entered = { pos: s.decided?.pos ?? null, fp: s.decided?.fp ?? null, why: s.why };
            if (k.way === '上门') dropAwayPlan(store, chatKey, k.who, { at: k.at, fp: k.fp, who: k.who, avatar: k.avatar });
            out.entered.push(k);
        } else if (s.state === '作废') {
            k.lapsed = { pos: s.decided?.pos ?? null, fp: s.decided?.fp ?? null, why: s.why };
            lapseKnock(store, records, chatKey, k, ctx);
            out.lapsed.push(k);
        } else if (s.state === '没发生') { out.gone.push(k); continue; }
        keep.push(k);
    }
    writeKnocks(store, chatKey, keep);
    return out;
}

// 此刻候着的那一个（给扩展画快捷按钮）：{ who, avatar, way, at, unanswered } 或 null
export function waitingKnock(store, records, chatKey) {
    const ctx = context(store, records, chatKey);
    const knocks = knocksOf(store, chatKey);
    for (const k of [...knocks].reverse()) {
        if (k.entered || k.lapsed || k.forced || blockedKnock(store,chatKey,k)) continue;
        const s = knockState(k, { messages: ctx.messages, knocks, userName: ctx.userName, roster: ctx.roster, relations: ctx.relations, rowAt: ctx.rowAt, parts: ctx.tl.parts });
        if (s.state === '候着' && s.message) return { who: k.who, avatar: k.avatar ?? null, way: k.way, at: k.at, unanswered: s.unanswered };
    }
    return null;
}

// 每人此刻要说的（给调度排"插"）：来意没说（记账里还开着的来意）、口袋到了（进了口袋还没拿出来）、等的回音有了、兴头（最近三十条里他的想法）
export function wantsFor(store, records, chatKey, { messages = null, timeline = null, present = [] } = {}) {
    const rows = messages ?? live(store.currentMessages(chatKey));
    const lastPos = rows.at(-1)?.pos ?? 0;
    const out = [];
    for (const r of records?.visible?.(chatKey) ?? []) if (isOpenMatter(r) && r.matter?.kind === INTENT && r.holder_name) out.push({ who: r.holder_name, avatar: hasCard({avatar:r.holder}) ? r.holder : null, kind: '来意', text: r.matter.title ?? '' });
    for (const m of store.menuOf?.(chatKey) ?? []) if (m.status === 'pocket' && m.who) out.push({ who: m.who, kind: '口袋', text: m.title ?? '' });
    try { for (const p of pendingFor(store, records, chatKey, { present, timeline }).items) if (p.kind === '等回音' && p.status === '有回音' && p.owner) out.push({ who: p.owner, kind: '等回音', text: p.text ?? '' }); } catch {}
    for (const r of records?.openIdeas?.(chatKey) ?? []) if (r.type === '想法' && r.holder_name && lastPos - (r.pos ?? 0) <= 30) out.push({ who: r.holder_name, avatar: hasCard({avatar:r.holder}) ? r.holder : null, kind: '兴头', text: r.text ?? '' });
    return out;
}

/**
 * 谁接话：拼 director 要的料，返回 { queue: [{ who, avatar, role, why, noRepeat }], why }。
 * 候着的人（门口的）按远程算：只在玩家对他说时才排（和发消息来的一样）
 */
export function turnFor(store, records, chatKey, { present = [], recentUser = '', config = null } = {}) {
    const auto = config?.auto ?? {};
    const ctx = context(store, records, chatKey, { present, recentUser });
    const { messages, roster, relations, names, userName, tl } = ctx;
    if (auto.enabled === false || auto.turn === false) return { queue: [], why: '关着' };
    let board = null;
    try { board = ctx.board(); } catch {}
    const waiting = waitingKnock(store, records, chatKey);
    // 他刚叩的门就是最后一条：停下等玩家，别让屋里的人替玩家接他的话
    if (waiting && waiting.at === messages.at(-1)?.pos) return { queue: [], complete:true, why: `${waiting.who}刚来联系，等玩家回他` };
    present = (board?.people ?? []).filter(p => ['present','remote'].includes(p.status)).map(p => p.name);
    const d = turnDetail({ text: recentUser || null, messages, board, roster, relations, members:ctx.members, identityChoices:ctx.identityChoices, wants: wantsFor(store, records, chatKey, { messages, timeline: tl, present }), pace: paceFor(store, chatKey), userName, present,
        stateNotes: store.stateNotesOf?.(chatKey) ?? [], cap: Number(auto.cap) > 0 ? Number(auto.cap) : null, chain: auto.chain ?? null });   // 没填（null）按节奏档，别算成 0；chain 没填按默认
    // 只有 director 已核实明确召回和可达性，才允许扩展开区间。
    const queue = d.queue.map(q => ({ who: q.who, avatar: q.who === '旁白' ? null : avatarFor(ctx, q.who, q.avatar), role: q.role, why: q.why, noRepeat: !!q.noRepeat,
        ...(board?.people.find(p => p.avatar === q.avatar)?.enter ? { enter: board.people.find(p => p.avatar === q.avatar).enter } : {}),
        ...(q.back === true ? { back: true } : {}) }));
    const unresolved = queue.find(q => q.who !== '旁白' && !hasCard(q));
    if (unresolved) return { queue: [], complete:false, why: `${unresolved.who}的卡身份未对上，请认卡确认后重新排队` };
    return { queue, why: d.why, complete: !d.paused };
}

/**
 * 谁走了（场面表上在场、远程的人逐个看；拿得准的才算）：返回还没记过的 [{ who, avatar, how, at, fp, why }]；记过的（markLeft）那条还在就不再报，删了就重新算
 */
export const LEAVE_ASK = chatKey => `leave_ask:${chatKey}`;
export const CAME_ASK = chatKey => `came_ask:${chatKey}`;
export const AUTO_CAME = chatKey => `auto_came:${chatKey}`;
export const LEFT_PENDING = chatKey => `auto_left_pending:${chatKey}`;
const squashQuote = t => String(t??'').replace(/[\p{P}\s]/gu,'');
const isOwn = (m,p) => messageIsPerson(m,p);
const cameBasisLive = (c, messages) => messages.some(m => m.pos === c.at && m.fp === c.fp)
    && (c.through == null || messages.some(m => m.pos === c.through && m.fp === c.throughFp))
    && (!c.basis || c.basis.every(b => messages.some(m => m.pos === b.pos && m.fp === b.fp)));
const CAME_QUOTES = /“[^“”]*”|「[^「」]*」|『[^『』]*』|"[^"\n]*"/g;
const CAME_UNCERTAIN = /想起|回忆|记得|曾经|转述|据说|听说|如果|要是|假如|明天/;
const CAME_ENTER = /^(?:又|已|已经|正|正在|终于|便|就|随后|随即|缓缓|慢慢|径直|突然|亲自|本人|从[^，。；\n]{1,12})*(?:推门(?:走)?进来|推开门(?:走)?进来|走进(?:来|屋|门|房间)|走了进来|进了(?:门|屋)|进来|进屋|进门|回到(?:屋内|面前|这里)|来到(?:面前|身边|这里)|出现在(?:面前|身边|门口))/;
const CAME_MOTION = /^(?:(?:又|已|已经|正|正在|终于|随后|随即|便|就|缓缓|慢慢|径直|突然|亲自|本人)|(?:推开|拉开|打开)[^，。；\n]{0,8}门|从[^，。；\n]{1,12})*(?:走|跑|迈|跨|踏|钻|挤)?(?:了)?(?:进来|进(?:了)?(?:房间|屋内|屋里|屋|门内|门)|回到(?:屋内|面前|这里))/;
const CAME_ACT = /^(?:又|已|已经|正|正在|随后|随即|缓缓|慢慢|便|就|仍|依旧)*(?:站在(?:我|你|玩家|桌|门|屋)|坐在|坐下|落座|伸手|抬手|拿起|按住|扶着|扶住|撑着|靠在|走到|转身|开口(?:说|问)|说道|问道)/;
// 在已有到场／动作识别的谓语起点核同子句前缀，不要求整句套句首动作格式。
const CAME_PREDICATE = /站|在|走进|来到|坐|推门|推开门|走了进来|进了|进来|进屋|进门|回到|出现|落座|伸手|抬手|拿起|按住|扶着|扶住|撑着|撑住|靠在|走到|转身|开口|说道|问道/g;
// 本人消息兜底与到场引文共用远程／私密排除，前端重新推导也交由这里核验。
const CAME_REMOTE = /电话|通话|消息|屏幕|终端那头/;
const CAME_FRAME = /想起|回忆|记得|曾经|从前|当年|梦里|梦中|转述|据说|听说|如果|要是|假如/;
function currentEvidenceSentences(text) {
    const out=[];
    for(const paragraph of String(text).replace(CAME_QUOTES,q=>' '.repeat(q.length)).split(/\n\s*\n/)) {
        let framed=false;
        for(const sentence of paragraph.split(/[。！？!?\n]/)) {
            for(const clause of sentence.split(/[；;]/)) {
                if(CAME_FRAME.test(clause))framed=true;
                else if(/此刻|现在|眼下|如今|回过神/.test(clause))framed=false;
                if(!framed&&!CAME_UNCERTAIN.test(clause)&&!CAME_REMOTE.test(sentence))out.push(clause);
            }
        }
    }
    return out;
}
function inPersonEvidence(message, text = message.text ?? '', { who = message.name, roster = [], calls = [] } = {}) {
    if(isPrivate(message))return false;
    const others=roster.filter(p=>p.name&&p.name!==who).map(p=>p.name);
    // 本人回复已由调用方核身份；这里只排除证明句自身的回忆、远程和别人动作。
    // 不要求动作在句首，也不因全文另一个段落的措辞剔除当前证明句。
    const narrative=String(text).replace(CAME_QUOTES,'').replace(/[（）()*\s]/g,'');
    const proofText=narrative?text:String(text).replace(CAME_QUOTES,q=>q.slice(1,-1));
    for(const paragraph of String(proofText).replace(CAME_QUOTES,q=>' '.repeat(q.length)).split(/\n\s*\n/)) {
        let framed=false;
        for(const sentence of paragraph.split(/[。！？!?\n]/)) {
            for(const clause of sentence.split(/[，,；;：:（）()]/)) {
                const proof=clause.trim().replace(/^[*\s]+/,'');
                if(CAME_FRAME.test(proof))framed=true;
                else if(/此刻|现在|眼下|如今|回过神/.test(proof))framed=false;
                const subject=proof.replace(/^(?:此刻|现在|眼下|如今)\s*/,'');
                if(proof&&!framed&&!CAME_UNCERTAIN.test(proof)&&!CAME_REMOTE.test(sentence)
                    &&!others.some(name=>subject.startsWith(name))&&!/陌生人|别人|目送|看着/.test(proof)
                    &&![...proof.matchAll(CAME_PREDICATE)].some(m=>qualifiedAt(proof,m.index,[who,...calls,...roster.map(p=>p.name)])))return true;
            }
        }
    }
    return false;
}
// 引文必须落在这一身份本人的当面证据里。引用、回忆和无法消歧的代词保留未判。
function cameEvidence(evidence, doubt, quote, person, roster) {
    if (isPrivate(evidence)) return false;
    const text = String(evidence.text ?? '');
    const own = messageIsPerson(evidence, { name: doubt.who, avatar: doubt.avatar }, roster);
    const recentlyAway = person && ['away', 'absent'].includes(person.status);
    const calls = [doubt.who,...(doubt.aliases??[]),...roster.map(p=>p.name)].filter(Boolean);
    const sentences = currentEvidenceSentences(text).filter(s => squashQuote(s).includes(squashQuote(quote)));
    for (const sentence of sentences) {
        if (!inPersonEvidence(evidence, sentence, { calls })) continue;
        for (const clause of sentence.split(/[，,：:（）()]/)) {
            const lead = clause.trim().replace(/^[*\s]+/, '');
            const subject = (doubt.aliases ?? [doubt.who]).find(n => lead.startsWith(n));
            if (subject && !own && roster.filter(p => p.card && p.name === doubt.who).length !== 1) continue;
            if(!subject&&own&&roster.some(p=>p.avatar!==doubt.avatar&&p.name&&lead.includes(p.name)))continue;
            const predicate = subject ? lead.slice(subject.length).trim() : own ? lead.replace(/^我/, '') : null;
            if (predicate != null && (CAME_ENTER.test(predicate) || CAME_MOTION.test(predicate) || !recentlyAway && CAME_ACT.test(predicate))
                && squashQuote(clause).includes(squashQuote(quote))) return true;
        }
    }
    // 未有离场反证时，精确 avatar 的本人发言也是证据；远程或离场后单独一句话不足以证明物理返场。
    return own && !recentlyAway && inPersonEvidence(evidence, text, { who: doubt.who, roster, calls });
}
// 正文已把有卡的人带到场面：先按名册叫法挑候选，模型只复核这些人。
export function cameDoubts(store, records, chatKey, { present = [], config = null } = {}) {
    if (config?.auto?.enabled === false || config?.auto?.turn === false) return [];
    let ctx, board;
    try { ctx = context(store, records, chatKey, { present }); board = ctx.board(); } catch { return []; }
    const { messages, roster, names, relations } = ctx;
    const userAt = messages.findLastIndex(m => m.is_user);
    if (userAt < 0) return [];
    const from = Math.max(0, userAt - CAME_LOOKBACK);
    const window = messages.slice(from);
    const facts = factInput(store, chatKey);
    const asked = read(store, CAME_ASK(chatKey), []).filter(a => cameBasisLive(a, messages) && factCurrent(a, facts));
    const arrived = activeCame(store, chatKey, messages);
    const rel = relations ? normalizeRelations(relations) : null;
    const out = [];
    for (const entry of roster.filter(hasCard)) {
        if (entry.role === '不用') continue;
        const p = board.people.find(p => p.avatar === entry.avatar);
        if (p && ['present', 'remote'].includes(p.status)) continue;
        if (p?.manualAway) continue;
        if (arrived.some(a => sameIdentity(a, entry, roster))) continue;
        const aliases = callsOf(entry.name, { rel, names });
        const hit = window.findLast(m => messageIsPerson(m, entry, roster) || aliases.some(n => n && String(m.text ?? '').includes(n)));
        if (!hit) continue;
        const prior = asked.filter(a => sameIdentity(a, entry, roster) && a.at === hit.pos && a.fp === hit.fp)
            .sort((a,b) => (a.through ?? a.at) - (b.through ?? b.at)).at(-1);
        const review = prior ? (prior.review ?? 0) + 1 : 0;
        if (prior && (prior.result === '到了' || review > CAME_RECHECKS
            || !window.some(m => !m.is_user && m.pos > (prior.through ?? prior.at)))) continue;
        out.push({ who: entry.name, avatar: entry.avatar ?? null, aliases, at: hit.pos, fp: hit.fp,
            from: window[0].pos, basis: window.map(m => ({ pos: m.pos, fp: m.fp })), review,
            through: messages.at(-1).pos, throughFp: messages.at(-1).fp });
    }
    return candidates(out).map(d => ({ ...d, sourceVersion: sourceVersion(store, chatKey, d.through) }));
}
export function activeCame(store, chatKey, messages = live(store.currentMessages(chatKey))) {
    const departed = leaveEvents(store, chatKey).filter(e => e.action === 'leave');
    const facts = factInput(store, chatKey);
    return read(store, AUTO_CAME(chatKey), []).filter(c => factCurrent(c, facts) && cameBasisLive(c, messages)
        && !departed.some(e => sameFor(store,chatKey,c, e) && e.at > c.at));
}
export function answerCame(store, chatKey, doubts, verdicts) {
    const messages = live(store.currentMessages(chatKey));
    const facts = factInput(store, chatKey);
    const asked = read(store, CAME_ASK(chatKey), []).filter(a => cameBasisLive(a, messages) && factCurrent(a, facts));
    const came = read(store, AUTO_CAME(chatKey), []).filter(c => cameBasisLive(c, messages) && factCurrent(c, facts));
    const accepted = [];
    const board = boardFor(store, null, chatKey);
    for (const d of doubts) {
        if (!currentSource(store, chatKey, d)) continue;
        const anchor = messages.find(m => m.pos === d.at && m.fp === d.fp);
        const last = messages.find(m => m.pos === d.through && m.fp === d.throughFp);
        const v = verdictFor(store, chatKey, doubts, d, verdicts);
        if (!anchor || !last || !v || !['到了', '没到'].includes(v['结果']) || !cameBasisLive(d, messages)) continue;
        if (asked.some(a => sameFor(store,chatKey,a, d) && (a.through ?? a.at) >= d.through)) continue;
        const basis = messages.filter(m => m.pos >= d.from && m.pos <= d.through).map(m => ({ pos: m.pos, fp: m.fp }));
        if (!d.basis?.length || JSON.stringify(basis) !== JSON.stringify(d.basis)) continue;
        const evidenceIndex = messages.findIndex(m => Number.isInteger(v['条']) && m.pos === v['条']);
        const evidence = messages[evidenceIndex];
        if (!evidence || evidence.pos < d.from || evidence.pos > last.pos
            || typeof v['引'] !== 'string' || [...v['引']].length > 20 || !squashQuote(v['引'])
            || !squashQuote(evidence.text).includes(squashQuote(v['引']))) continue;
        const person = board.people.find(p => p.avatar === d.avatar);
        if (v['结果'] === '到了' && (person?.manualAway || !cameEvidence(evidence, d, v['引'], person, board.people))) {
            store.logEvent?.(chatKey, 'auto_came_rejected', { avatar: d.avatar, at: evidence.pos, reason: person?.manualAway ? '手动离场尚未通过正常进场或明确召回解除' : '引文不能确认本人当面到场' });
            continue;
        }
        const confirmedBasis = factBasis(d, facts);
        asked.push({ who: d.who, avatar: d.avatar, at: d.at, fp: d.fp, through: d.through, throughFp: d.throughFp, sourceVersion: d.sourceVersion, factBasis: confirmedBasis,
            result: v['结果'], review: d.review ?? 0, basis: d.basis });
        if (v['结果'] !== '到了') continue;
        const item = { who: d.who, avatar: d.avatar ?? null, at: evidence.pos, fp: evidence.fp, quote: v['引'],
            basis: d.basis, through: d.through, throughFp: d.throughFp, sourceVersion: d.sourceVersion, factBasis: confirmedBasis };
        if (!came.some(c => sameFor(store,chatKey,c, item) && c.at === item.at && c.fp === item.fp)) { came.push(item); accepted.push(item); }
    }
    write(store, CAME_ASK(chatKey), asked.slice(-60));
    if (accepted.length) write(store, AUTO_CAME(chatKey), came.slice(-60));
    return accepted;
}
function reviewsOf(store, chatKey, messages) {
    return read(store,LEAVE_ASK(chatKey),[]).filter(r => currentSource(store, chatKey, r) && messages.some(m=>m.pos===r.at && m.fp===r.fp)
        && (r.evidenceAt==null || messages.some(m=>m.pos===r.evidenceAt&&m.fp===r.evidenceFp))
        && (r.checkedAt==null || messages.some(m=>m.pos===r.checkedAt && m.fp===r.checkedFp))
        && (!r.basis || r.basis.every(b=>messages.some(m=>m.pos===b.pos && m.fp===b.fp))));
}
function leaveChecks(store, records, chatKey, options) {
    const ctx=context(store,records,chatKey,options), {messages,roster,names,relations,userName}=ctx;
    const people=ctx.board().people.filter(p=>['present','remote'].includes(p.status) && roster.some(e=>hasCard(e)&&e.avatar===p.avatar));
    const asked=reviewsOf(store,chatKey,messages);
    const done=read(store,LEFT(chatKey),[]).filter(d=>messages.some(m=>m.pos===d.at&&m.fp===d.fp));
    return people.map(p=>{
        const avatar=p.avatar;
        const person={...p,avatar};
        const prior=asked.filter(d=>sameIdentity(d,p,roster) && (d.since??null)===(p.since??null)).at(-1);
        const corrected = messages.filter(m => {
            let mark; try { mark = typeof m.boardMark === 'string' ? JSON.parse(m.boardMark) : m.boardMark; } catch { return false; }
            return mark?.people && (Object.hasOwn(mark.people, avatar) || resolveIdentity(roster.filter(e=>e.role!=='不用'), p.name).person?.avatar === avatar && Object.hasOwn(mark.people, p.name));
        }).at(-1)?.pos;
        const since=Math.max(prior ? Math.max(num(p.since)??0,(prior.checkedAt??prior.at)+1) : num(p.since)??0, corrected == null ? 0 : corrected + 1);
        const r=leftAt(messages,p.name,{avatar,userName,status:p.status,way:p.way??null,since,
            others:people.filter(x=>x.name!==p.name&&x.status==='present').map(x=>x.name),roster,relations,
            remoteNames:people.filter(x=>x.status==='remote').map(x=>x.name),n:options.config?.auto?.remoteQuiet??3});
        const pending=prior?.state==='被打发未动' && !messages.some(m=>m.pos>prior.evidenceAt&&isOwn(m,person));
        const settled=prior?.state==='走了' && since>messages.at(-1)?.pos;
        return {p:person,r,prior,pending,settled,done,messages,aliases:callsOf(p.name,{rel:relations?normalizeRelations(relations):null,names}),from:since,
            remoteNames:people.filter(x=>x.status==='remote').map(x=>x.name)};
    });
}
export function autoLeave(store, records, chatKey, { present = [], config = null } = {}) {
    if(config?.auto?.enabled===false || config?.auto?.leave===false) return [];
    let checks; try {checks=leaveChecks(store,records,chatKey,{present,config});} catch {return [];}
    const out=[];
    for(const {p,r:event,done,messages} of checks) {
        if(event.left!==true || !event.sure) continue;
        const fp=messages.find(m=>m.pos===event.at)?.fp;
        if(done.some(d=>sameFor(store,chatKey,d,p)&&d.at===event.at&&d.fp===fp)) continue;
        out.push({who:p.name,avatar:p.avatar,at:event.at,fp,how:event.how,why:event.why});
    }
    return out;
}
// 没判和被打发未动都保留复核；只对核过的消息窗口推进游标。
export function leaveDoubts(store, records, chatKey, { present = [], config = null } = {}) {
    if(config?.auto?.enabled===false || config?.auto?.leave===false) return [];
    let checks; try {checks=leaveChecks(store,records,chatKey,{present,config});} catch {return [];}
    const out=[];
    for(const {p,r,prior,pending,settled,done,messages,aliases,from,remoteNames} of checks) {
        if(settled || (!pending && r.left!==null)) continue;
        const at=pending ? prior.at : r.at;
        const fp=messages.find(m=>m.pos===at)?.fp;
        if(at==null || done.some(d=>sameFor(store,chatKey,d,p) && d.at===at && d.fp===fp)) continue;
        const last=messages.at(-1);
        out.push({who:p.name,avatar:p.avatar,at,fp,why:pending?'被打发未动，继续核对是否已在场或离开':r.why,status:p.status,aliases,remoteNames,
            since:p.since??null,from,through:last.pos,throughFp:last.fp,
            ...(pending?{pendingAt:prior.evidenceAt,pendingQuote:prior.quote}:{}),
            basis:messages.filter(m=>m.pos>=(from??at)).slice(-10).map(m=>({pos:m.pos,fp:m.fp}))});
    }
    return candidates(out).map(d => ({ ...d, sourceVersion: sourceVersion(store, chatKey, d.through) }));
}
export function answerLeaves(store, chatKey, doubts, verdicts) {
    const messages=live(store.currentMessages(chatKey)), asked=reviewsOf(store,chatKey,messages), gone=[];
    for(const d of doubts) {
        if (!currentSource(store, chatKey, d)) continue;
        const v=verdictFor(store, chatKey, doubts, d, verdicts);
        if(v === undefined || !messages.some(m=>m.pos===d.at&&m.fp===d.fp)
            || (d.basis && !d.basis.every(b=>messages.some(m=>m.pos===b.pos&&m.fp===b.fp)))) continue;
        const legacy=typeof v==='boolean';
        const state=legacy?(v?'走了':'还在'):v?.['结果'];
        if(!['走了','还在','被打发未动'].includes(state)) continue;
        const evidence=legacy?messages.find(m=>m.pos===d.at):messages.find(m=>Number.isInteger(v?.['条'])&&m.pos===v['条']);
        if(!evidence || (!legacy && (typeof v['引']!=='string' || [...v['引']].length>20 || !squashQuote(v['引']) || !squashQuote(evidence.text).includes(squashQuote(v['引']))))) continue;
        // 只收这次给模型的窗口内的依据，不能引用未来或它没有读到的消息。
        const through=d.through??messages.at(-1)?.pos;
        if(evidence.pos>through || (!legacy && evidence.pos<(d.from??d.since??d.at) && !(state==='被打发未动'&&evidence.pos===d.pendingAt))) continue;
        const last=messages.find(m=>m.pos===through);
        if(!last || (d.throughFp && last.fp!==d.throughFp)) continue;
        if (state === '走了' && !completedDeparture(messages.filter(m => m.pos <= through), d.who, {
            avatar: d.avatar, aliases: d.aliases, status: d.status, at: evidence.pos, quote: legacy ? null : v['引'],
            roster: store.getCast(store.requireChat(chatKey).story_id) ?? [], remoteNames: d.remoteNames,
        })) {
            store.logEvent?.(chatKey, 'auto_left_rejected', { avatar: d.avatar, at: evidence.pos, reason: '引文不能确认本人已经离场，保留待核' });
            continue;
        }
        const old=asked.filter(x=>sameFor(store,chatKey,x,d)&&x.state==='被打发未动'&&(x.since??null)===(d.since??null)).at(-1);
        // 指纹只覆盖实际给出的十条窗口；原始依据与已判末条另有锚点核验。
        const basis=d.basis;
        if (asked.some(x=>sameFor(store,chatKey,x,d)&&x.at===d.at&&x.fp===d.fp&&x.checkedAt===through&&x.checkedFp===last.fp)) continue;
        asked.push({who:d.who,avatar:d.avatar??null,at:d.at,fp:d.fp,since:d.since??null,state,checkedAt:through,checkedFp:last.fp,through,sourceVersion:d.sourceVersion,
            evidenceAt:state==='被打发未动'&&old?old.evidenceAt:evidence.pos,evidenceFp:state==='被打发未动'&&old?old.evidenceFp:evidence.fp,quote:state==='被打发未动'&&old?old.quote:(legacy?null:v['引']),basis});
        if(state==='走了') gone.push({who:d.who,avatar:d.avatar??null,how:'看一眼',at:evidence.pos,fp:evidence.fp,why:'复核依据已核过',basis,through,sourceVersion:d.sourceVersion});
    }
    write(store,LEAVE_ASK(chatKey),asked.slice(-60));
    if(gone.length) {markLeft(store,chatKey,gone);write(store,LEFT_PENDING(chatKey),[...read(store,LEFT_PENDING(chatKey),[]),...gone].slice(-20));}
    return gone;
}
// 离场事件交给扩展，直到收到当前版本的落实确认。
export const LEAVE_EVENTS = chatKey => `auto_leave_events:${chatKey}`;
const eventId = item => encodeURIComponent(item.avatar ?? item.who)+':'+item.fp;
// 同一身份和指纹只有一个事件；撤销和再次出现递增版本，旧确认不能确认新动作。
export function leaveEvents(store, chatKey) {
    const messages=live(store.currentMessages(chatKey));
    const events=read(store,LEAVE_EVENTS(chatKey),[]);
    const facts = factInput(store, chatKey);
    for(const e of events) {
        const matches=messages.filter(m=>m.fp===e.fp);
        const source=matches.find(m=>m.pos===e.at) ?? (matches.length===1?matches[0]:null);
        const valid=!!source && factCurrent(e, facts) && (!e.basis || e.basis.every(b=>messages.some(m=>m.fp===b.fp&&m.pos===b.pos)));
        const action=valid?'leave':'undo';
        if(e.action!==action) {e.action=action;e.version++;e.state='待落实';}
        if(action==='leave'&&e.state==='被后来取代') {
            let anchors={};try{anchors=JSON.parse(store.getMeta?.(`anchors_raw:${chatKey}`)??'{}')??{};}catch{}
            const segs=anchors[e.avatar]?.segments??[];
            const came=read(store,AUTO_CAME(chatKey),[]).some(c=>sameFor(store,chatKey,c,e)&&c.at>e.at&&messages.some(m=>m.pos===c.at&&m.fp===c.fp));
            if(!segs.some(s=>s?.from>e.at&&s.to!==s.from)&&!came){e.version++;e.state='待落实';}
        }
        if(source) e.at=source.pos;
        if(action==='undo') {
            const plans=read(store,`away_plan:${chatKey}`,{});
            // 就地改稿会由 store.sync 把去向的指纹接到新字上；事件仍保留原离场证据。
            // 只撤同一位置、同一条改稿链的补记，别把另一回离场的去向一起撤掉。
            for(const [key,p] of Object.entries(plans)) if(sameFor(store,chatKey,p,e) && (p.fp===e.fp
                || (p.at===e.at+1 && store.sameMessage?.(p.fp,e.fp)))) delete plans[key];
            write(store,`away_plan:${chatKey}`,plans);
        }
    }
    write(store,LEAVE_EVENTS(chatKey),events);
    return events;
}
export function pendingLeaves(store,chatKey) { return leaveEvents(store,chatKey).filter(e=>e.state==='待落实'); }
export function acknowledgeLeaves(store,chatKey,receipts=[]) {
    const events=leaveEvents(store,chatKey);
    for(const r of receipts) {
        const e=events.find(e=>e.id===r.id&&e.version===r.version&&e.action===r.action);
        if(e) e.state=r.result==='achieved'?'已达成':r.result==='superseded'?'被后来取代':'已落实';
    }
    write(store,LEAVE_EVENTS(chatKey),events);
    return {ok:true,left:pendingLeaves(store,chatKey)};
}
export function takePendingLeft(store, chatKey) {
    const legacy=read(store,LEFT_PENDING(chatKey),[]);
    if(legacy.length) {markLeft(store,chatKey,legacy);write(store,LEFT_PENDING(chatKey),null);}
    return pendingLeaves(store,chatKey);
}
export function markLeft(store, chatKey, items) {
    const messages=live(store.currentMessages(chatKey));
    const done=read(store,LEFT(chatKey),[]).filter(d=>messages.some(m=>m.pos===d.at&&m.fp===d.fp));
    const events=leaveEvents(store,chatKey);
    for(const i of items) {
        if(!messages.some(m=>m.pos===i.at&&m.fp===i.fp)) continue;
        const id=eventId(i);
        if(!events.some(e=>e.id===id)) events.push({...i,through:i.through??i.at,sourceVersion:i.sourceVersion??sourceVersion(store,chatKey,i.through??i.at),factBasis:factBasis(i,factInput(store,chatKey)),id,action:'leave',version:1,state:'待落实'});
        if(!done.some(d=>sameFor(store,chatKey,d,i)&&d.fp===i.fp&&d.at===i.at)) done.push({who:i.who,avatar:i.avatar??null,at:i.at,fp:i.fp,how:i.how});
    }
    write(store,LEFT(chatKey),done.slice(-60));
    write(store,LEAVE_EVENTS(chatKey),events);
}

// 便宜模型判"玩家这句是不是在回他"（叩门状态机认不出的那几句）
export const KNOCK_JUDGE_SYSTEM = "你替一段群聊判一件小事：某人刚联系了玩家（发来消息、打来电话、或者到了门口），玩家接着写了一句。判这一句是不是在回应〔当事人〕——接电话、回消息、开门、让〔当事人〕进来、对〔当事人〕说话、搭〔当事人〕的茬都算；对别人说话、只写自己的动作、明说不理会都不算。只答一个字：是 或 否。";
export function knockJudgePrompt({ who, way, knock, text }) {
    const how = way === '电话' ? '打来电话' : way === '上门' ? '到了门口' : '发来消息';
    return `【${personWord(who)}】${who}（${how}），${personWord(who)}那条：${String(knock ?? '').slice(0, 600)}\n【玩家接着写的】${String(text ?? '').slice(0, 600)}\n玩家这句是不是在回应${personWord(who)}？只答 是 或 否。`;
}
export function parseKnockJudge(text) {
    const s = String(text ?? '').trim().replace(/^[\s"“'（(【\[]+/, '');
    if (/^是/.test(s)) return true;
    if (/^否|^不是|^不/.test(s)) return false;
    return null;
}
