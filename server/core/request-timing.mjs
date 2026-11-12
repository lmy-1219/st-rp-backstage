import { AsyncLocalStorage } from 'node:async_hooks';

const context = new AsyncLocalStorage();
const names = ['snapshot', 'store.sync', 'advance', 'compose', 'modelWait'];
export function requestTrace() {
    return { started: performance.now(), ended: null, stage: 'body', failedStage: null, spans: [] };
}
export const withTrace = (trace, run) => context.run(trace, run);

// 区间取并集：并发模型不重复累计，后台未等待的工作只算返回前的部分。
export function traceView(trace) {
    const end = trace.ended ?? performance.now();
    const phases = Object.fromEntries(names.map(name => {
        const spans = trace.spans.filter(s => s.name === name).map(s => [s.start, Math.min(s.end ?? end, end)]).sort((a,b) => a[0]-b[0]);
        let ms=0,last=-Infinity;
        for(const [start,stop] of spans){if(stop>Math.max(start,last))ms+=stop-Math.max(start,last);last=Math.max(last,stop);}
        return [name, Math.round(ms * 100) / 100];
    }));
    return { ...phases, total: Math.round((end-trace.started)*100)/100, stage: trace.failedStage ?? trace.stage };
}

export function measure(name, run) {
    const trace=context.getStore();
    if(!trace||trace.ended!==null)return run();
    const span={name,start:performance.now(),end:null};trace.spans.push(span);
    const previous=trace.stage;trace.stage=name;
    const finish=()=>{span.end=performance.now();if(trace.ended===null&&trace.stage===name)trace.stage=previous;};
    const fail=error=>{if(trace.ended===null)trace.failedStage??=name;throw error;};
    try {
        const result=run();
        if(result&&typeof result.then==='function')return result.catch(fail).finally(finish);
        finish();return result;
    } catch(error) { finish();return fail(error); }
}
