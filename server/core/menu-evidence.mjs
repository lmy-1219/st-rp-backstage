import { createHash } from 'node:crypto';

// 只约定证据，不读库、不写状态。提取负责目标与正文的语义对应；读口核来源、范围和冲突。
export const MENU_EVIDENCE_PROTOCOL = 1;
// 件递给某人后锁给他几条消息（slot 的组格锁与 planner 的"已递出待承接"共用；放这个叶子模块，避开 planner↔slot 循环引用）
export const OFFER_HOLD_SPAN = 6;
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const text = value => String(value ?? '').trim().replace(/[。.!！]+$/, '');
export const menuSource = m => m.sourceAt ?? m.anchorAt ?? (Number.isInteger(m.anchor_pos) ? { pos: m.anchor_pos, fp: m.anchor_fp ?? null } : null);
// 版本只认绑定了那一版的来源（带露面条件的件）；普通件的锚点改了字不算换了一件。
export const menuEvidenceVersion = m => hash([m.id, m.plan_id, m.sourceAt ?? null, m.who, m.surface, m.showCondition,
    m.closeText, m.premise, m.conditions, m.entry, m.place, m.goer, m.respond, m.cause, m.entryBasis, m.origin]);
// 来源、身份或结构修订，即使正文相同，也不是同一份证明。
export const menuRecordVersion = r => hash([r.id, r.pos, r.fp, r.raw_text ?? r.text, r.type, r.tense ?? null,
    !!r.todo, r.todo_kind ?? null, r.promise ?? null, !!r.guess, !!r.fabricated, !!r.unfinished,
    r.holder, r.holder_name, r.audience ?? [], r.quotes ?? [], r.idea_ref ?? null, r.outcome ?? null,
    r.matter ?? null, r.life ?? null, r.known ?? []]);
const anchorLive = (at, messages) => at && (at.pos === -1 ? at.fp == null
    : Number.isInteger(at.pos) && !!at.fp && messages.some(m => m.pos === at.pos && m.fp === at.fp));

// 输入须已按业务来源（剧情日等）过滤；这里再核当前正文分支、截止和显式替代关系。
export function currentMenuRecords({ visible = [], messages = [], links = [], through = Infinity } = {}) {
    const sourceLive = r => (r.status == null || r.status === 'ok') && r.pos <= through
        && anchorLive(r, messages) && !r.superseded_by
        && !(r.known ?? []).some(k => k?.basis && (Number.isInteger(k.basis.pos) || k.basis.fp) && !anchorLive(k.basis, messages));
    const rows = visible.filter(sourceLive), ids = new Set(rows.map(r => r.id));
    const replaced = new Set(links.filter(l => ids.has(l.from_id) && ['改掉', '否定'].includes(l.kind)).map(l => l.to_id));
    return rows.filter(r => !replaced.has(r.id));
}
// 是否真实发生与结果是否反驳菜单边界分开判断。
export const actualMenuRecord = r => !r.guess && !r.fabricated && !r.unfinished && r.tense !== '将来';
// 只判关事：约定按普通生命周期，其他关联事项失败仍开放；收尾标签与 isOpenMatter 同口径。
// 标签不是已核验的正证明，菜单完成仍须由下面的证据口现读。
export const menuMatterNeedsResult = r => !!r.matter && !r.promise && r.matter.evidence?.boundary !== '收尾';
export function quotedMenuRecord(r, messages = []) {
    return actualMenuRecord(r) && Array.isArray(r.quotes) && r.quotes.length > 0 && r.quotes.every(q =>
        typeof q === 'string' && q.trim() && messages.some(m => m.pos === r.pos && m.fp === r.fp && String(m.text ?? '').includes(q)));
}
const sameAudience = (a, b) => Array.isArray(a) && Array.isArray(b)
    && JSON.stringify([...new Set(a)].sort()) === JSON.stringify([...new Set(b)].sort());
const targetRecord = (r, m) => r.matter?.menu === m.id && !r.matter?.kind;

// 新露面日志和它的后续步骤共用这个来源/版本口；普通锚点改字不换件，露面正文必须是原稿。
export function shownMenuProofLive(m, step, p, messages = []) {
    if (!m) return false;
    const source = menuSource(m);
    return !!m && p?.protocol === MENU_EVIDENCE_PROTOCOL && p.menu === m.id
        && p.version === menuEvidenceVersion(m) && p.boundary === '露面' && step.status === 'shown'
        && anchorLive(p.evidence, messages) && p.evidence.pos >= 0
        && step.pos === p.evidence.pos && step.fp === p.evidence.fp && anchorLive(source, messages)
        && p.source?.pos === source.pos && (!m.showCondition || p.source.fp === source.fp)
        && p.evidence.pos > source.pos && typeof p.quote === 'string' && !!p.quote.trim()
        && messages.some(r => r.pos === p.evidence.pos && r.fp === p.evidence.fp && String(r.text ?? '').includes(p.quote));
}

// matter.evidence 与承载它的实际记录不可拆开借人/借受众；menu 单独只是关联，不是证明。
export function boundaryRelation(r, m, boundary, messages = []) {
    const p = r.matter?.evidence, source = menuSource(m);
    return !!p && targetRecord(r, m) && p.protocol === MENU_EVIDENCE_PROTOCOL && p.menu === m.id
        && p.version === menuEvidenceVersion(m) && p.boundary === boundary
        && ['发生', '实现', '撤销'].includes(p.relation)
        && p.source?.pos === r.pos && p.source?.fp === r.fp && anchorLive(source, messages)
        && r.pos > source.pos && r.holder_name === m.who && p.holder === r.holder
        && sameAudience(p.audience, r.audience) && quotedMenuRecord(r, messages);
}

// 正证据必须完整引用；反证据用当前有效的同件全集，不能受模型引用或展示预算影响。
export function menuBoundaryEvidence(m, boundary, context = {}) {
    const { messages = [] } = context, rows = currentMenuRecords(context);
    const wanted = boundary === '收尾' ? m.closeText : m.showCondition || m.surface;
    const conflicts = [], proofs = [];
    if (!text(wanted)) return { proofs, conflicts, reason: '没有边界' };
    const byId = new Map(rows.map(r => [r.id, r]));
    // 关联只引入候选；末端菜单号不能覆盖辅助根、别件根或缺失的根。
    // 沿了结链继承最近明示的结果边界。动作根的露面只证明发生，不限定后续履行的结果。
    const related = r => {
        const seen = new Set(); let linked = false, scope = null;
        while (r) {
            if (seen.has(r.id) || r.matter?.kind || (r.matter?.menu != null && r.matter.menu !== m.id)) return null;
            seen.add(r.id); linked ||= targetRecord(r, m);
            if (r.type === '了结') scope ??= r.matter?.evidence?.boundary ?? r.matter?.boundary ?? null;
            if (r.idea_ref == null) {
                if (!linked || r.type === '了结') return null;
                if (r.matter?.evidence?.boundary === '收尾') scope ??= '收尾';
                return { scope };
            }
            r = byId.get(r.idea_ref);
        }
        return null;
    };
    for (const r of rows) {
        if (!actualMenuRecord(r)) continue;
        const legacyNo = !r.todo && !r.promise && !['想法', '心里'].includes(r.type) && (text(r.raw_text ?? r.text) === `并非${text(wanted)}`
            || (r.type === '改变' && r.life?.who === m.who && text(r.life?.gone) === text(wanted)));
        const result = r.type === '了结' && related(r);
        const revoked = (r.type !== '了结' || result) && boundaryRelation(r, m, boundary, messages) && r.matter.evidence.relation === '撤销';
        // 未提供结果责任范围，一律从严阻断收尾；不按类型、待办或约定豁免，也不反推露面失败。
        const failed = result && r.outcome !== '做了' && boundary === (result.scope ?? '收尾');
        if (legacyNo || revoked || failed) conflicts.push({ id: r.id, reason: revoked ? '边界已撤销'
            : failed ? result.scope == null ? '同件结果范围未明' : '同件结果不支持成功' : '边界被明确否定' });
    }
    if (conflicts.length) return { proofs, conflicts, reason: '存在当前冲突' };
    for (const r of rows) {
        if (!boundaryRelation(r, m, boundary, messages) || r.matter.evidence.relation !== (boundary === '收尾' ? '实现' : '发生')) continue;
        if (r.type === '了结' && r.outcome !== '做了') continue;
        let action = r;
        if (r.idea_ref != null) {
            action = byId.get(r.idea_ref);
            if (!action || action.pos > r.pos || !targetRecord(action, m) || action.holder_name !== m.who || !quotedMenuRecord(action, messages)) continue;
        }
        proofs.push({ action, result: r });
    }
    return { proofs, conflicts, reason: proofs.length ? '同件边界已有正文证明' : '缺少同件边界证明' };
}

export const citedMenuProof = (pair, records = []) => [pair.action, pair.result].every(r => records.some(p => p.id === r.id));

// 核验依据用：挂在这件上的记录（关联或证明指向本件），连同沿 idea_ref 接上的了结。只决定何时重核，不决定冲突（冲突由上面按当前全集现读）。
export function menuLinkedRecords(m, rows = []) {
    const linked = new Set(rows.filter(r => r.matter?.menu === m.id || r.matter?.evidence?.menu === m.id).map(r => r.id));
    for (let size = -1; size !== linked.size;) {
        size = linked.size;
        for (const r of rows) if (linked.has(r.idea_ref)) linked.add(r.id);
    }
    return rows.filter(r => linked.has(r.id));
}
