// 调模型：OpenAI 兼容的 /chat/completions；按 Anthropic 写法开了思考档的走 Anthropic 原生的 /messages（见 noNative 那段）。钥匙只在请求头里用，不写日志。
// temperature 只在配置里给了数字时才发（新一代模型不接受采样参数）；extraBody 原样并进请求体（比如思考档位）。
// 一律流式读（实测中转对不流式的长回答会卡住：几千字的回答五分钟都等不回来）。只要一直有数据进来就不算超时，
// 连着 idleMs 一点数据都没有才算卡住（用户 9/30：至少一分半，Fable、Opus 慢，Gemini 也要十来秒才吐字）；
// 整件事的上限只防挂死，不拿来掐慢模型。
// 截断不静默（用户 9/30）：写到输出上限的，把上限放大一倍重来；流到一半断了（没有结束标记）的，原样再要一次；
// 还不行就抛 model_truncated / model_stream_cut，调用方按失败处理（会再试、面板上看得见），不拿半截当完整的用。
export const IDLE_MS = 90000;
// 开了思考档的：想的那段中转不往外吐字（实测 Opus 5.5 经这条中转，想的时候流里一个字没有，也没有保活），
// 头一个正文字出来之前至多等这么久（中转自己连着约五分钟没数据就掐，卡在它前面）；开始写以后仍按 IDLE_MS。
export const THINK_IDLE_MS = 270000;
const TOTAL_MS = 1800000;
export const MAX_OUT = 32000;
export const RETRY_WAIT_MS = { value: 3000 };

// 从后台启动起：几次写到上限放大重来写完了、几次到底没写完（面板顶上一条）。
const tally = { stretched: 0, gaveUp: 0, last: null };
export const modelTally = () => ({ ...tally });

const hitLimit = reason => /^(length|max_tokens)$/i.test(String(reason ?? ''));

// 按 Anthropic 写法传思考档的（output_config.effort，D-134）走 Anthropic 原生接口 /messages，并要思考摘要当心跳（D-136）：
// 实测 Opus 5.5 经这条中转，兼容接口上想的时候一个字不吐、连思考摘要也不转，一份规划想了五分钟被中转掐断；
// 原生接口会把思考摘要一段段转过来（最长 4 秒一段），连接就一直活着。摘要只当心跳，读到就丢，不存、不给谁看（用户只要结果）。
// 中转不认原生接口（404／405）就记下这个地址，退回兼容接口。
const noNative = new Set();

// maxCap：写到上限放大重来时至多放到多少（默认 MAX_OUT；想得多、写得长的活可以给更大的，按实际用量计费）。
// heartbeat：走原生接口时要不要思考摘要当心跳（默认要；关了想久了会被中转掐断）。
export function createModelClient({ baseUrl, apiKey, model, temperature = null, maxOutputTokens = 4000, extraBody = null, timeoutMs = TOTAL_MS, stream = true, idleMs = IDLE_MS, maxCap = MAX_OUT, heartbeat = true }) {
    // 开了思考档（面板上选的，D-106）：想的那部分也算在输出里，短活（检索词 200、检查 400）会被想的挤没，给足长度
    const thinks = !!(extraBody?.reasoning_effort || extraBody?.output_config?.effort);
    const firstMax = thinks ? Math.max(maxOutputTokens, 8000) : maxOutputTokens;
    const firstIdle = thinks ? Math.max(idleMs, THINK_IDLE_MS) : idleMs;
    const total = Math.max(Number(timeoutMs) || 0, TOTAL_MS);
    const wantsNative = () => stream && !!extraBody?.output_config && !noNative.has(baseUrl);

    async function once(max, { system, user }, observe) {
        const native = wantsNative();
        const { reasoning_effort: _drop, ...rest } = extraBody && typeof extraBody === 'object' ? extraBody : {};
        const body = native
            ? {
                model, max_tokens: max, stream: true, system, messages: [{ role: 'user', content: user }], ...rest,
                ...(heartbeat ? { thinking: { ...(rest.thinking ?? {}), type: 'adaptive', display: 'summarized' } } : {}),
            }
            : {
                model, max_tokens: max, stream,
                ...(stream ? { stream_options: { include_usage: true } } : {}),
                messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
                ...(Number.isFinite(temperature) ? { temperature } : {}),
                ...(extraBody && typeof extraBody === 'object' ? extraBody : {}),
            };
        // 响应头 idleMs 还不来（实测中转偶尔整个挂住，底层要干等五分钟才报 fetch failed），就当这次没连上，再连一次。
        const send = async () => {
            observe({ stage: '发出', outputChars: 0, finishReason: null, send: true });
            const gave = new AbortController();
            const first = setTimeout(() => gave.abort(new Error('model_no_response')), idleMs);
            try {
                return await fetch(native ? `${baseUrl}/messages` : `${baseUrl}/chat/completions`, {
                    method: 'POST',
                    headers: native
                        ? { 'content-type': 'application/json', 'x-api-key': apiKey, authorization: `Bearer ${apiKey}`, 'anthropic-version': '2023-06-01' }
                        : { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
                    body: JSON.stringify(body),
                    signal: AbortSignal.any([AbortSignal.timeout(total), gave.signal]),
                });
            } catch (error) {
                throw error.cause?.code ? new Error(`${error.message} (${error.cause.code})`) : error;
            } finally {
                clearTimeout(first);
            }
        };
        let response;
        try { response = await send(); } catch (error) { if (!/model_no_response|fetch failed|ECONN|socket/i.test(String(error?.message))) throw error; response = await send(); }
        // 中转偶尔回"暂时不可用"（503 之类，实测隔几秒就好）：等 3 秒再要一次
        if ([502, 503, 504, 529].includes(response.status)) { await response.text().catch(() => {}); await new Promise(r => setTimeout(r, RETRY_WAIT_MS.value)); response = await send(); }
        if (native) {
            if ([404, 405].includes(response.status)) { noNative.add(baseUrl); return once(max, { system, user }, observe); }   // 中转没有原生接口：退回兼容接口
            if (!response.ok) throw new Error(`model_http_${response.status}: ${(await response.text()).slice(0, 300)}`);
            return readNative(response, idleMs, firstIdle, observe);
        }
        // 要了流式、对方却回了一整块 JSON（有的中转不认 stream）：照整块读
        if (stream && response.ok && !/json/i.test(response.headers?.get?.('content-type') ?? '')) return readStream(response, idleMs, firstIdle, observe);
        observe({ stage: '流式中' });
        const text = await response.text();
        if (!response.ok) throw new Error(`model_http_${response.status}: ${text.slice(0, 300)}`);
        let data;
        try { data = JSON.parse(text); } catch { throw new Error('model_bad_json'); }
        const choice = data.choices?.[0];
        const content = choice?.message?.content;
        observe({ stage: '解析', outputChars: typeof content === 'string' ? content.length : 0, finishReason: choice?.finish_reason ?? null });
        if (typeof content !== 'string') throw new Error(`model_no_content${choice?.finish_reason ? `_${choice.finish_reason}` : ''}`);
        return {
            text: content,
            finishReason: choice.finish_reason ?? null,
            servedModel: typeof data.model === 'string' ? data.model : null,   // 接口自报是哪个模型答的，用来发现被偷换
            usage: { input: data.usage?.prompt_tokens ?? null, output: data.usage?.completion_tokens ?? null },
        };
    }

    return {
        model,
        async complete(prompt, { onMeta = null } = {}) {
            let max = firstMax, recut = 0;
            let sends = 0;
            const telemetry = { stage: '发出', outputChars: 0, finishReason: null, internalRetries: 0 };
            const observed = () => typeof onMeta === 'function' ? { telemetry: { ...telemetry } } : {};
            const observe = change => {
                if (change.send) telemetry.internalRetries = Math.max(0, ++sends - 1);
                if (typeof change.stage === 'string') telemetry.stage = change.stage;
                if (Number.isFinite(change.outputChars)) telemetry.outputChars = change.outputChars;
                if (Object.hasOwn(change, 'finishReason')) telemetry.finishReason = typeof change.finishReason === 'string' ? change.finishReason.slice(0, 80) : null;
                // 只出元数据，观测器出错不能改变原请求、重发或超时行为。
                try { onMeta?.({ ...telemetry }); } catch {}
            };
            const used = { input: null, output: null };
            const add = u => { for (const k of ['input', 'output']) if (Number.isFinite(u?.[k])) used[k] = (used[k] ?? 0) + u[k]; };
            for (;;) {
                let r;
                try { r = await once(max, prompt, observe); }
                catch (error) {
                    add(error.usage);
                    if (/model_stream_cut/.test(error.message) && recut++ < 1) continue;
                    if (/model_stream_cut/.test(error.message)) giveUp(error.message);
                    throw Object.assign(error, { usage: used, ...observed() });
                }
                add(r.usage);
                // 想的部分把输出上限几乎吃光、正文只写了几个字（10/11 实测 Opus 5.5 高档规划：48000 里 47990 在想，正文五个字，结束原因却报 end_turn）：
                // 也当写到上限，放大重来；放到顶还这样就按截断算，不拿那几个字当完整的用
                const ate = !hitLimit(r.finishReason) && Number(r.usage?.output) >= max - 64 && String(r.text ?? '').length < 200;
                if (!hitLimit(r.finishReason) && !ate) {
                    if (max > firstMax) tally.stretched++;
                    observe({ outputChars: r.text.length, finishReason: r.finishReason });
                    return { ...r, usage: used, ...observed(), ...(max > firstMax ? { stretchedTo: max } : {}) };
                }
                if (max >= maxCap) {
                    const message = ate ? `model_truncated（想的部分把输出上限 ${max} 吃光了，正文只有 ${r.text.length} 字）` : `model_truncated（写到输出上限 ${max} 还没写完，已收 ${r.text.length} 字）`;
                    giveUp(message);
                    observe({ outputChars: r.text.length, finishReason: r.finishReason });
                    throw Object.assign(new Error(message), { partial: r.text, usage: used, ...observed() });
                }
                max = Math.min(max * 2, maxCap);
            }
        },
    };
    function giveUp(message) { tally.gaveUp++; tally.last = { at: new Date().toISOString(), model, error: message }; }
}

// 读 SSE：一行一个 "data: {...}"，把 delta 里的字接起来；最后一块带用量（stream_options.include_usage）。
// 没有结束原因、也没有 [DONE] 就断了的，是半路被掐（中转掐长连接之类），不当写完了。
async function readStream(response, idleMs, firstIdle = idleMs, observe = () => {}) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '', text = '', finishReason = null, servedModel = null, usage = null, saw = false, ended = false;
    observe({ stage: '流式中', outputChars: 0, finishReason: null });
    const next = () => {
        let timer;
        const idle = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('model_stream_idle_timeout')), text ? idleMs : firstIdle); });
        return Promise.race([reader.read(), idle]).finally(() => clearTimeout(timer));
    };
    const take = line => {
        if (!line.startsWith('data:')) return;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') { ended = true; return; }
        if (!payload) return;
        let chunk;
        try { chunk = JSON.parse(payload); } catch { return; }
        saw = true;
        if (typeof chunk.model === 'string') servedModel ??= chunk.model;
        const choice = chunk.choices?.[0];
        if (typeof choice?.delta?.content === 'string') text += choice.delta.content;
        if (choice?.finish_reason) finishReason = choice.finish_reason;
        observe({ outputChars: text.length, finishReason });
        if (chunk.usage) usage = chunk.usage;
    };
    const spent = () => ({ input: usage?.prompt_tokens ?? null, output: usage?.completion_tokens ?? null });
    try {
        for (;;) {
            const { value, done } = await next();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let i;
            while ((i = buffer.indexOf('\n')) >= 0) { take(buffer.slice(0, i).trim()); buffer = buffer.slice(i + 1); }
        }
        take(buffer.trim());
    } catch (error) {
        reader.cancel().catch(() => {});
        observe({ stage: '流中断', outputChars: text.length, finishReason });
        // 断在半路时说清收到了多少（分得清是一直没开始写，还是写到一半被掐）
        throw Object.assign(new Error(`${error.message}（已收 ${text.length} 字）`), { usage: spent() });
    }
    // 想的部分把输出上限吃光了、一个正文字还没写（实测 deepseek-flash 去复读，上限 1500 时次次如此）：当成写到上限，交给上面放大重来
    if (saw && !text && hitLimit(finishReason)) return { text: '', finishReason, servedModel, usage: spent() };
    if (!saw || !text) throw Object.assign(new Error(`model_no_content${finishReason ? `_${finishReason}` : ''}`), { usage: spent() });
    if (!finishReason && !ended) { observe({ stage: '流中断', outputChars: text.length, finishReason }); throw Object.assign(new Error(`model_stream_cut（流到一半断了，已收 ${text.length} 字）`), { usage: spent() }); }
    return { text, finishReason, servedModel, usage: spent() };
}

// 读 Anthropic 原生的流：只接正文（text_delta）；思考摘要（thinking_delta）只当心跳，丢掉。
// 结束原因在 message_delta 里（max_tokens＝写到上限，refusal＝被安全分类拒了），message_stop 是结束标记。
async function readNative(response, idleMs, firstIdle = idleMs, observe = () => {}) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '', text = '', finishReason = null, servedModel = null, input = null, output = null, ended = false, failed = null;
    observe({ stage: '流式中', outputChars: 0, finishReason: null });
    const next = () => {
        let timer;
        const idle = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('model_stream_idle_timeout')), text ? idleMs : firstIdle); });
        return Promise.race([reader.read(), idle]).finally(() => clearTimeout(timer));
    };
    const take = line => {
        if (!line.startsWith('data:')) return;
        let ev;
        try { ev = JSON.parse(line.slice(5).trim()); } catch { return; }
        if (ev.type === 'message_start') { servedModel ??= ev.message?.model ?? null; input = ev.message?.usage?.input_tokens ?? input; }
        else if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') text += ev.delta.text ?? '';
        else if (ev.type === 'message_delta') { finishReason = ev.delta?.stop_reason ?? finishReason; output = ev.usage?.output_tokens ?? output; }
        else if (ev.type === 'message_stop') ended = true;
        else if (ev.type === 'error') failed = ev.error?.message ?? 'stream_error';
        observe({ outputChars: text.length, finishReason });
    };
    const spent = () => ({ input, output });
    try {
        for (;;) {
            const { value, done } = await next();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let i;
            while ((i = buffer.indexOf('\n')) >= 0) { take(buffer.slice(0, i).trim()); buffer = buffer.slice(i + 1); }
        }
        take(buffer.trim());
    } catch (error) {
        reader.cancel().catch(() => {});
        observe({ stage: '流中断', outputChars: text.length, finishReason });
        throw Object.assign(new Error(`${error.message}（已收 ${text.length} 字）`), { usage: spent() });
    }
    if (failed) { observe({ stage: '流中断', outputChars: text.length, finishReason }); throw Object.assign(new Error(`model_stream_error: ${String(failed).slice(0, 200)}（已收 ${text.length} 字）`), { usage: spent() }); }
    if (finishReason === 'refusal') throw Object.assign(new Error('model_refusal'), { usage: spent() });
    if (!text && hitLimit(finishReason)) return { text: '', finishReason, servedModel, usage: spent() };
    if (!text) throw Object.assign(new Error(`model_no_content${finishReason ? `_${finishReason}` : ''}`), { usage: spent() });
    if (!finishReason && !ended) { observe({ stage: '流中断', outputChars: text.length, finishReason }); throw Object.assign(new Error(`model_stream_cut（流到一半断了，已收 ${text.length} 字）`), { usage: spent() }); }
    return { text, finishReason, servedModel, usage: spent() };
}
