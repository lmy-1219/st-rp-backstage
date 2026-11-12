// 接入和读取的可见状态；只记阶段与时间，不保存聊天正文。
export function failureView(error, step = '这一步') {
    if (error?.code === 'unknown_chat' || error?.message === 'unknown_chat') return { kind: 'unknown', text: '这个窗口带着旧标记，后台没有它的记录；可以重新接入。' };
    if (error?.kind === 'network' || error?.code === 'core_unavailable') return { kind: 'network', text: '后台暂时连不上，会自动重试；ST 照常可用。' };
    const reason = String(error?.message || '原因未知').replace(/[\r\n]+/g, ' ').slice(0, 100);
    return { kind: 'step', text: `${step}没走通${error?.status ? `（HTTP ${error.status}）` : ''}：${reason}；可重试。` };
}

export function setStage(state, name, status, detail = '') {
    const stages = state.stages ??= {};
    stages[name] = { status, detail, lastOk: status === '成功' ? Date.now() : stages[name]?.lastOk ?? null };
}

export function stageHtml(stages = {}, escape = String) {
    return [['connection', '连接'], ['open', '接入'], ['sync', '消息同步'], ['boards', '场面读取']].map(([key, label]) => {
        const s = stages[key];
        return `<div>${label}：${escape(s?.status ?? '未开始')}${s?.detail ? ` · ${escape(s.detail)}` : ''}<small> · 最后成功：${s?.lastOk ? new Date(s.lastOk).toLocaleTimeString() : '尚无'}</small></div>`;
    }).join('');
}

export function cardChoiceHtml(choices = {}, escape = String) {
    return Object.entries(choices).map(([name, choice]) => {
        const status = choice.status === 'pending' ? '待确认' : choice.status === 'cancelled' ? '取消' : choice.avatar ? choice.synced ? '已确认' : '后台未保存' : choice.asked ? '取消' : '待确认';
        return `<div>${escape(name)}：${status} <button type="button" class="menu_button" data-action="card-retry" data-name="${escape(name)}" title="重新选择这个名字在本局使用的卡。">重新认卡</button></div>`;
    }).join('');
}
