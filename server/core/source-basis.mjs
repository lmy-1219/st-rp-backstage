// 来源描述只保存原始凭据；位置、有效性均由当前窗口现算。此模块无存储和副作用。
export const sourceMessage = m => m ? { pos: m.pos, fp: m.fp, sw: m.sw ?? null, sentAt: m.sent_at ?? null,
    ...(m.doorRevision != null ? { revision: m.doorRevision } : {}) } : null;
const result = (state, reason, pos = null) => ({ state, reason, pos });

export function sourceIndex({ messages = [], chatKey = null, limits = new Map(), arrivals = [], dependencies = new Map() } = {}) {
    const byFp = new Map();
    for (const m of messages) byFp.set(m.fp, [...(byFp.get(m.fp) ?? []), m]);
    return { messages, byFp, chatKey, limits, arrivals, dependencies };
}

export function messageBasis(ref, index, through = Infinity) {
    if (!ref?.fp || !Number.isInteger(ref.pos)) return result('unknown', '缺消息凭据');
    const matches = (index.byFp.get(ref.fp) ?? []).filter(m => !m.hidden && m.pos <= through
        && (ref.sw == null || m.sw === ref.sw) && (ref.sentAt == null || m.sent_at === ref.sentAt)
        && (ref.revision == null || m.doorRevision === ref.revision));
    const exact = matches.find(m => m.pos === ref.pos);
    if (exact) return result('live', '原消息版本仍在', exact.pos);
    if (matches.length === 1) return result('live', '原消息位置投影', matches[0].pos);
    return result(matches.length ? 'unknown' : 'not-live', matches.length ? '消息位置不唯一' : '消息已撤回或换稿');
}

export function projectSource(basis, index, { phase = 'fact', through = Infinity, rawBasis = false } = {}) {
    if (!basis || basis.kind !== 'arrival' || basis.version !== 1 || !basis.id || !basis.avatar || !basis.origin || !basis.trigger)
        return result('unknown', '缺精确进场来源');
    const cut = index.limits.get(basis.origin);
    if (cut == null) return result('not-live', '来源属于另一分支');
    if (basis.incomplete) return result('unknown', basis.incomplete);
    for (const ref of [basis.trigger, basis.sourceStep, basis.handoff].filter(Boolean)) {
        const live = messageBasis(ref, index, through);
        if (live.state !== 'live') return live;
        if (ref === basis.handoff && (!ref.revision || ref.avatar !== basis.avatar)) return result('unknown', '交接缺稿本或精确身份');
    }
    // 唯一组合入口：消息/分支 + 原联系或口袋的精确步骤 + 各自的时间依据。
    // 调用方提供存续结果；纯模块不读取存储、菜单或时间线。
    const dependency = index.dependencies.get(basis.id);
    if (basis.sourceStep && dependency?.step !== true)
        return result(dependency?.step === false ? 'not-live' : 'unknown', '原来源步骤不再成立或缺凭据');
    // rawBasis 仅供时间线读取底层事实以解除时间递归；仍须核消息、步骤、交付和分支。
    // 普通事实与 event_source 菜单必须走完整时间判断。
    if (!rawBasis && dependency?.time !== true)
        return result(dependency?.time === false ? 'not-live' : 'unknown', '来源时间依据不再成立或缺凭据');
    // 同一锚点重新进场，只替代本窗口可见且凭据仍成立的来源，不改共享产物。
    const later = index.arrivals.find(a => a.source_basis?.id !== basis.id && a.source_basis?.origin === basis.origin
        && a.source_basis?.avatar === basis.avatar && a.source_basis?.trigger?.pos === basis.trigger?.pos
        && a.source_basis?.trigger?.fp === basis.trigger?.fp && index.arrivals.findIndex(x => x.source_basis?.id === a.source_basis.id) > index.arrivals.findIndex(x => x.source_basis?.id === basis.id)
        // 替代者本身也须在当前分支有效，父支后来保存的新版本不能撤掉子支旧交付。
        && projectSource(a.source_basis, { ...index, arrivals: [] }, { phase, through, rawBasis }).state === 'live');
    if (later) return result('not-live', '本分支同锚点已重新进场');
    if (basis.delivery) {
        if (basis.delivery.pos >= cut) return result('not-live', '交付在分叉之后');
        const live = messageBasis(basis.delivery, index, through);
        if (live.state !== 'live') return live;
        const message = index.messages.find(m => m.pos === live.pos);
        if (message?.is_user || message?.speaker !== basis.avatar) return result('not-live', '交付身份不符');
        return result('live', '原进场及保存回复仍在', live.pos);
    }
    if (phase !== 'prepare') return result('unknown', '尚无保存回执');
    if (cut !== Infinity) return result('not-live', '准备材料不跨分支继承');
    const trigger = messageBasis(basis.trigger, index, through);
    if (trigger.state !== 'live') return trigger;
    if (index.messages.some(m => m.pos > trigger.pos && m.pos <= through && !m.hidden)) return result('not-live', '准备后已有消息且未确认交付');
    return result('live', '本次首次生成的准备材料', trigger.pos);
}
