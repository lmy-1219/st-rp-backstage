// 生成时只保留说话人亲历的在场区间；只修改 ST 给拦截器的临时聊天数组。
const DEFAULT_KEEP_BEFORE = 1;
const DEFAULT_BRIEF = '[以上对话你不在场，没有听见。你从这一刻起才到场。你只知道你自己本来就知道的事，以及你现在亲眼看见、亲耳听见的。其余的一切你只能猜，而且可能猜错。]';
const note = mes => ({ name: '场景', is_user: false, is_system: false, mes, extra: {}, send_date: '' });

// 剧情时间先找之后的第一份总结快照；back=true 只往前找。
export function storyTimeAt(chat, index, back = false) {
    const pick = s => {
        const m = String(s ?? '').match(/^\s*【时间】\s*\n?\s*([^\n]+)/m);
        return m ? m[1].trim() : null;
    };
    if (!back) {
        for (let i = Math.max(0, index); i < chat.length; i++) {
            const t = pick(chat[i]?.extra?.memory);
            if (t) return t;
        }
    }
    for (let i = Math.min(index, chat.length - 1); i >= 0; i--) {
        const t = pick(chat[i]?.extra?.memory);
        if (t) return t;
    }
    return null;
}

/** 原地裁剪生成用聊天。没有记录或已能看到全部时返回 null。 */
export function cutByPresence(chat, rec, { full = [], dateOf = m => String(m?.send_date ?? ''), storyTimeAt: timeAt = () => null,
    protectedView = null } = {}) {
    if (protectedView) {
        const { visible, privateTo, through, ceiling, thirdParty, origins } = protectedView;
        const byRow = new Map(full.flatMap((row, pos) => row.is_system ? [] : [[row, pos]]));
        const original = [...byRow.keys()];
        const byExtra = Map.groupBy(original.filter(row => row.extra), row => row.extra);
        const locate = row => byRow.has(row) ? row : byExtra.get(row.extra)?.length === 1 ? byExtra.get(row.extra)[0]
            : Number.isInteger(row.index) && original[row.index]?.mes === row.mes ? original[row.index] : null;
        const allowed = Map.groupBy(ceiling, locate);
        const pieces = Map.groupBy(rec.ownFragments, piece => piece.at);
        const pending = new Set(rec.fragmentDeductions.map(r => r.at));
        const rows = [], sent = full.map(() => []);
        for (const row of chat) {
            const source = locate(row), at = byRow.get(source);
            if (at == null || at > through || source.hidden || rec.closed || !row.mes || !visible(source)) continue;
            const offset = source.mes.indexOf(row.mes);
            if (offset < 0 || source.mes.lastIndexOf(row.mes) !== offset) continue;
            const grant = !thirdParty && rec.ranges.some(r => r.grant && r.from <= at && at < r.to);
            if (!grant && !allowed.get(source)?.some(old => old.mes.includes(row.mes))) continue;
            const keep = (piece, start) => {
                const end = start + piece.mes.length;
                if (sent[at].some(([lo, hi]) => lo < end && start < hi)) return;
                sent[at].push([start, end]);
                rows.push(piece); origins.set(piece, at);
            };
            if (!pending.has(at) && (!rec.blocks(at) || privateTo(source))) keep(row, offset);
            else for (const { range: [from, to] } of pieces.get(at) ?? []) {
                const start = Math.max(from, offset), end = Math.min(to, offset + row.mes.length);
                if (start < end) keep({ ...row, mes: source.mes.slice(start, end) }, start);
            }
        }
        chat.splice(0, chat.length, ...(!thirdParty && rows.length < original.length ? [note(DEFAULT_BRIEF)] : []), ...rows);
        return;
    }
    if (!rec?.segments?.length) return null;
    const before = chat.length;
    const brief = () => String(rec.brief || '').trim() || DEFAULT_BRIEF;
    const closed = () => {
        chat.splice(0, chat.length, note(brief()));
        return { before, after: chat.length, spans: 0 };
    };
    try {
        const keep = Number.isInteger(rec.keepBefore) ? rec.keepBefore : DEFAULT_KEEP_BEFORE;
        const toCore = i => {
            let n = 0;
            for (let k = 0, lim = Math.min(i, full.length); k < lim; k++) if (!full[k].is_system) n++;
            return n;
        };
        const locate = (index, date) => {
            if (date) {
                const at = chat.findIndex(m => dateOf(m) === date);
                if (at >= 0) return { at, byDate: true };
            }
            if (Number.isInteger(index) && index >= 0) return { at: Math.min(index, chat.length), byDate: false };
            return { at: -1, byDate: false };
        };

        // 先合并原始区间，再加边距。否则边距会吞掉两段之间的缺席说明。
        const raw = [];
        for (const seg of rec.segments) {
            if (!seg || !Number.isInteger(seg.from) || seg.from < 0 ||
                (seg.to != null && (!Number.isInteger(seg.to) || seg.to < seg.from))) return closed();
            const cutShort = seg.to != null && seg.toDate && !chat.some(m => dateOf(m) === seg.toDate);
            const s = locate(seg.from, seg.fromDate);
            if (s.at < 0) continue;
            const start = s.byDate ? s.at + 1 : Math.min(toCore(seg.from), chat.length);
            let end;
            if (seg.to == null) {
                end = chat.length;
            } else if (seg.to <= 0) {
                continue;
            } else if (cutShort) {
                const limit = Date.parse(seg.toDate);
                let last = -1;
                if (Number.isFinite(limit)) chat.forEach((m, n) => {
                    const t = Date.parse(dateOf(m));
                    if (Number.isFinite(t) && t < limit) last = n;
                });
                end = last + 1;
            } else {
                const e = locate(seg.to - 1, seg.toDate);
                if (e.at < 0) continue;
                end = e.byDate ? Math.min(e.at + 1, chat.length) : Math.min(toCore(seg.to), chat.length);
            }
            // 刚进场还没有新消息时，开放段仍可用边距形成最小窗口。
            if (end > start || seg.to == null) raw.push({ start, end, segFrom: seg.from, segTo: seg.to });
        }
        raw.sort((a, b) => a.start - b.start);
        const merged = [];
        for (const span of raw) {
            const tail = merged[merged.length - 1];
            if (tail && span.start <= tail.end) {
                if (span.end > tail.end) { tail.end = span.end; tail.segTo = span.segTo; }
            } else merged.push({ ...span });
        }
        merged.forEach((span, i) => {
            const floor = i === 0 ? 0 : merged[i - 1].end;
            span.start = Math.max(floor, span.start - keep);
        });
        if (!merged.length) return closed();
        if (merged.length === 1 && merged[0].start === 0 && merged[0].end === chat.length) return null;

        const out = [];
        merged.forEach((span, i) => {
            if (i === 0) {
                if (span.start > 0) out.push(note(brief()));
            } else {
                const t1 = timeAt((merged[i - 1].segTo ?? 0) - 1, true);
                const t2 = timeAt(span.segFrom ?? 0);
                const gap = (t1 && t2 && t1 !== t2)
                    ? `你上次在场到「${t1}」，现在是「${t2}」。`
                    : (t2 ? `现在是「${t2}」。` : '中间过了一段时间。');
                out.push(note(`[你离开了一段时间。${gap}这中间发生的事你不在场，不知道，也没人告诉过你。以下是你回来之后的事。]`));
            }
            out.push(...chat.slice(span.start, span.end));
        });
        chat.splice(0, chat.length, ...out);
        return { before, after: chat.length, spans: merged.length };
    } catch {
        return closed();
    }
}
