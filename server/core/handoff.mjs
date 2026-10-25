// 外援（D-73）：用到 Claude／GPT 系模型的后台环节（前台正文除外），API 没响应、或配置成"交给窗口"时，
// 把这件活写成一份自带全部说明的"外援包"，由桌面应用里任一个 AI 窗口接手，做完交回；后台像对待模型的回答一样核对再落账。
// 接手的窗口只读这一份包，不用读项目：要做什么、原样的系统提示和输入、输出格式、怎么交回、交回后怎么核对，全在包里。
// 每轮开口前现算的（叙事组装、检索词）等不了窗口，不排队——调不通就当场退回纯程序那一格。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const TITLES = { extract: '记账（从一小段对话里记下事实）', setup: '开局单分格', plan: '规划（一个主线节点）', keys: '开局单前史的检索词', 'relations-draft': '关系表自动起草（核对保存才生效）' };
const fence = s => '````text\n' + String(s ?? '') + '\n````';

// 调模型的错误里哪些是"API 没响应"（该交给窗口），哪些是回答本身的问题（照原来的重试／对半切／跳过）。
export const isTransient = error => /timeout|aborted|fetch failed|ECONN|socket|network|model_http_(5\d\d|429|408)|model_bad_json|model_no_content/i.test(String(error?.message ?? error));

export function cleanAnswer(text) {
    const s = String(text).replace(/<(think|thinking)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
    const blocks = [...s.matchAll(/```[^\n`]*\r?\n([\s\S]*?)```/g)].map(m => m[1]);
    return (blocks.length ? blocks.reduce((a, b) => b.length > a.length ? b : a) : s).trim();
}

export function renderPrompt(h) {
    const p = h.payload;
    return [
        `请你${p.task ?? '按【系统提示】的要求处理【输入】'}。`,
        '', '【系统提示】', '', fence(p.system),
        '', '【输入】', '', fence(p.user), '',
        '只输出系统提示要求的格式，不要加解释，不要分段说明；JSON 可以放在代码块里。',
    ].join('\n');
}

export function renderPacket(h) {
    const p = h.payload;
    return [
        `<!-- handoff ${h.id} · ${h.kind} · ${h.created_at} -->`,
        `# 外援 #${h.id}：${TITLES[h.kind] ?? h.kind}`,
        '',
        '## 要你做什么',
        '',
        `${p.why ? `后台${p.why}。` : ''}请你${p.task ?? '当这一步的模型：按下面【系统提示】的要求处理【输入】，只输出它要求的格式'}。`,
        `把输出存成一个 UTF-8 文件，在项目根目录（${repo}）交回：`,
        '',
        `    node tools/handoff.mjs submit ${h.id} --file <你的输出文件>`,
        '',
        `交回后后台会像对待模型的回答一样核对${p.checks ? `（${p.checks}）` : ''}；格式不对会被拒，改了再交。做不了就：`,
        '',
        `    node tools/handoff.mjs drop ${h.id}`,
        '',
        '## 注意',
        '',
        '- 这份包就是全部：不用读项目代码和文档。',
        '- 里面是用户的私有内容：不要复制到别处，不要读项目里别的私有文件，不要联网。',
        '- 输出很长时，可以先写进文件，再用 --file 交回。',
        ...(p.extra ? ['', p.extra] : []),
        '',
        '---',
        renderPrompt(h),
    ].join('\n');
}

// register(kind, { apply(text, meta, handoff) → 结果摘要（出错就抛，包留着等重交）, stale(meta) → 真＝这件活已经不需要了,
//                   retry(meta, handoff) → 'done'｜'started'（再走一次 API；抛错＝还是没成） })
export function createHandoffs({ store, home, log = () => {} }) {
    const dir = path.join(home, 'handoff');
    const kinds = new Map();
    const file = id => path.join(dir, `${id}.md`);
    const remove = id => { try { fs.rmSync(file(id)); } catch {} };
    const retrying = new Set();
    const self = {
        dir,
        register(kind, spec) { kinds.set(kind, spec); },
        // 同一件活（kind＋key）已经在等了就不再开一份，返回原来那份。
        request({ kind, key = null, chatKey = null, why = '', system, user, task = null, checks = null, extra = null, meta = {} }) {
            const existing = store.pendingHandoff(kind, key);
            if (existing) return existing.id;
            const id = store.addHandoff({ kind, key, chatKey, payload: { why, system, user, task, checks, extra, meta } });
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(file(id), renderPacket(store.handoffById(id)));
            log(`handoff ${id} (${kind}) requested: ${why}`);
            return id;
        },
        pending(kind = null, key) {
            if (kind) return store.pendingHandoff(kind, key);
            return self.list();
        },
        // 等着的；已经不需要的（比如要它的那段消息删了）顺手撤掉。
        // 不带 chatKey：照旧返回全部（本机工具 tools/handoff.mjs 用）。带 chatKey：返回 { pending, others }，
        // pending＝本窗口的（自己＋分叉点前继承的 keys，chat_key 为空的全局活每个窗口都算），others＝别的窗口的按窗口归并。
        list({ chatKey = null } = {}) {
            const all = store.pendingHandoffs().filter(h => {
                if (!kinds.get(h.kind)?.stale?.(h.payload.meta, h)) return true;
                store.closeHandoff(h.id, 'dropped', { reason: 'stale' });
                remove(h.id);
                return false;
            }).map(h => ({ id: h.id, kind: h.kind, title: TITLES[h.kind] ?? h.kind, chatKey: h.chat_key, why: h.payload.why, createdAt: h.created_at, file: file(h.id), retry: !!kinds.get(h.kind)?.retry, busy: retrying.has(h.id) }));
            if (chatKey == null) return all;
            const keys = new Set(store.historyOf(chatKey).keys);
            const pending = all.filter(h => h.chatKey == null || keys.has(h.chatKey));
            const others = all.filter(h => h.chatKey != null && !keys.has(h.chatKey));
            const labelOf = key => { try { const c = store.requireChat(key); return c.label || c.st_chat_id || key; } catch { return key; } };
            const groups = new Map();
            for (const h of others) { const g = groups.get(h.chatKey) ?? { chatKey: h.chatKey, label: labelOf(h.chatKey), items: [] }; g.items.push(h); groups.set(h.chatKey, g); }
            return { pending, others: [...groups.values()].map(g => ({ chatKey: g.chatKey, label: g.label, n: g.items.length, items: g.items })) };
        },
        async submit(id, text) {
            const h = store.handoffById(Number(id));
            if (!h) throw Object.assign(new Error('no_such_handoff'), { status: 404 });
            if (h.status !== 'pending') throw Object.assign(new Error('handoff_closed'), { status: 409 });
            const spec = kinds.get(h.kind);
            if (!spec) throw Object.assign(new Error(`no_handler_${h.kind}`), { status: 500 });
            if (spec.stale?.(h.payload.meta, h)) {
                store.closeHandoff(h.id, 'dropped', { reason: 'stale' });
                remove(h.id);
                throw Object.assign(new Error('handoff_stale'), { status: 409 });
            }
            const result = await spec.apply(cleanAnswer(text), h.payload.meta, h);
            store.closeHandoff(h.id, 'done', result ?? null);
            remove(h.id);
            log(`handoff ${h.id} (${h.kind}) done`);
            return result;
        },
        // 再走一次 API（面板的"再试一次"、自动重试）：成了就收掉这份包；没成包留着，接着等外援或下次再试。
        // spec.retry 返回 'done'（这次就做完了）或 'started'（交回原来那一步去重试，结果之后才知道，比如记账）。
        async retry(id) {
            const h = store.handoffById(Number(id));
            if (!h || h.status !== 'pending') throw Object.assign(new Error('handoff_closed'), { status: 409 });
            const spec = kinds.get(h.kind);
            if (!spec?.retry) throw Object.assign(new Error('no_retry'), { status: 409 });
            if (retrying.has(h.id)) return { status: 'busy' };
            retrying.add(h.id);
            try {
                const how = await spec.retry(h.payload.meta, h);
                if (how === 'done' || how === 'started') { store.closeHandoff(h.id, 'done', { via: `retry_${how}` }); remove(h.id); }
                log(`handoff ${h.id} (${h.kind}) retry: ${how}`);
                return { status: how };
            } catch (error) {
                log(`handoff ${h.id} (${h.kind}) retry failed: ${error.message}`);
                return { status: 'failed', error: error.message };
            } finally {
                retrying.delete(h.id);
            }
        },
        canRetry(kind) { return !!kinds.get(kind)?.retry; },
        drop(id, reason = 'dropped') {
            const h = store.handoffById(Number(id));
            if (!h || h.status !== 'pending') return false;
            store.closeHandoff(h.id, 'dropped', { reason });
            remove(h.id);
            kinds.get(h.kind)?.dropped?.(h.payload.meta, h);
            return true;
        },
        // 某件活已经由别的路做完了（比如规划用老工具交回），把对应的包收掉。
        settle(kind, key) {
            const h = store.pendingHandoff(kind, key);
            if (h) { store.closeHandoff(h.id, 'done', { via: 'other' }); remove(h.id); }
        },
    };
    return self;
}
