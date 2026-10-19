// ST 服务端插件：把 /api/plugins/rp-emergence/* 原样转给本机后台。
// 浏览器只跟 ST 同一个地址说话 ⇒ 远程/手机玩也能用，且继承 ST 自己的登录保护（白皮书 §9.1-1）。
// 配置在同目录 config.json：{ "port": <后台端口>, "autoStart": { "entry": "<仓库>/core/main.mjs", "home": "<数据目录>" }, "update": { "follow": "origin/main" } }
// 后台没起来时，只是这些接口返回 503；ST 本身不受影响（N-40）。
// 写了 update 的（玩的 ST，D-117）：ST 一启动先把代码跟到正本已推送的最新版、把扩展装好，再拉起后台。
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const info = {
    id: 'rp-emergence',
    name: 'rp_emergence',
    description: '转发到本机 rp_emergence 后台',
};

// 插件独立部署，不能 import core；此默认值须和 core/local.mjs 保持一致。
const DEFAULT_PORT = 8019;
const here = path.dirname(fileURLToPath(import.meta.url));
const stRoot = path.resolve(here, '..', '..');
// 接口名只认小写字母和连字符，其余由后台自己认（以后加接口不用改插件、不用重启 ST）
const ROUTE = /^[a-z][a-z-]{0,39}$/;
const LONG = new Set(['slot', 'fresh', 'stage-probe', 'update', 'arrive', 'leave']);   // 要等模型或要拉代码的，多等一会儿（后台连着一分半没动静才算模型卡住，这里得等得更久）

function readConfig() {
    try { return JSON.parse(fs.readFileSync(path.join(here, 'config.json'), 'utf8')); }
    catch { return {}; }
}

async function health(base) {
    try { return (await fetch(`${base}/v1/health`, { signal: AbortSignal.timeout(1500) })).ok; }
    catch { return false; }
}

// ST 自己出网用的代理（config.yaml 的 requestProxy，或者启动 ST 时的 --requestProxyEnabled/--requestProxyUrl）：后台调模型也走它。
// 试玩 9/30：代理只写在 ST 的配置里、不在系统环境变量里；后台以前碰巧从带代理的窗口继承到，重启一次换成双击 ST 拉起的那份，就直连不上中转了。
// 配置里写了 "proxy" 就用它（写 "off" 就不走代理）。只认 http(s) 代理（Node 自带的 fetch 不认 socks）。
export function stProxy(config) {
    if (typeof config.proxy === 'string') return config.proxy === 'off' ? null : config.proxy;
    const argv = process.argv.join(' ');
    let on = false, url = null;
    try {
        const text = fs.readFileSync(path.join(stRoot, 'config.yaml'), 'utf8');
        const block = /^requestProxy:[^\n]*\n((?:[ \t#].*\n?|\s*\n)*)/m.exec(text)?.[1] ?? '';
        on = /^\s+enabled:\s*true\b/m.test(block);
        url = /^\s+url:\s*["']?([^"'\s#]+)/m.exec(block)?.[1] ?? null;
    } catch {}
    if (/--requestProxyEnabled(?![= ]false)/.test(argv)) on = true;
    url = /--requestProxyUrl[= ](\S+)/.exec(argv)?.[1] ?? url;
    return on && url && /^https?:\/\//.test(url) ? url : null;
}

// 后台没在跑就把它作为独立进程拉起来；它和 ST 互不牵连。
let lastStart = 0;
async function ensureCore(base, config) {
    if (!config.autoStart?.entry || Date.now() - lastStart < 10000 || await health(base)) return;
    lastStart = Date.now();
    const args = ['--disable-warning=ExperimentalWarning', config.autoStart.entry, '--port', String(config.port ?? DEFAULT_PORT), '--st', stRoot];
    if (config.autoStart.home) args.push('--home', config.autoStart.home);
    if (config.update?.follow) args.push('--follow', config.update.follow);
    const proxy = stProxy(config);
    if (proxy) args.push('--proxy', proxy);
    try {
        // 本机若经 HTTP(S)_PROXY 出网（比如本地代理软件），Node 自带的 fetch 要这个开关才会走代理。
        const env = { ...process.env, NODE_USE_ENV_PROXY: '1', ...(proxy ? { HTTPS_PROXY: proxy, HTTP_PROXY: proxy, NO_PROXY: 'localhost,127.0.0.1,::1' } : {}) };
        const child = spawn(process.execPath, args, { detached: true, stdio: 'ignore', windowsHide: true, env });
        child.unref();
        console.log(`[rp-emergence] 已启动本机后台（pid ${child.pid}）`);
    } catch (error) {
        console.warn('[rp-emergence] 后台启动失败：', error.message);
    }
}

function firstFollow(repo, follow) {
    const run = args => new Promise(resolve => execFile('git', ['-C', repo, ...args], { timeout: 30000, windowsHide: true }, () => resolve()));
    return run(['fetch', '--quiet', follow.split('/')[0]]).then(() => run(['merge', '--ff-only', '--quiet', follow]));
}

// 跟上正本（D-117）：拉取已推送的最新版、快进、把扩展和插件文件拷进这个 ST。调不通就用眼下这份，照常开。
async function followRelease(config) {
    if (!config.update?.follow || !config.autoStart?.entry) return;
    const repo = path.resolve(path.dirname(config.autoStart.entry), '..');
    const updater = path.join(repo, 'core', 'update.mjs');
    try {
        // 代码比"跟着正本"这套还旧（还没有 update.mjs）：先自己拉取、快进一次，有了再往下走
        if (!fs.existsSync(updater)) await firstFollow(repo, config.update.follow);
        const { applyRelease } = await import(pathToFileURL(updater).href);
        const r = await Promise.race([applyRelease({ repo, stRoot, follow: config.update.follow }), new Promise(resolve => setTimeout(() => resolve({ ok: false, error: '超时' }), 45000))]);
        if (!r.ok) console.warn(`[rp-emergence] 没跟上正本：${r.error}`);
        else console.log(`[rp-emergence] ${r.updated ? `已跟上正本（${r.target}，${r.behind} 个提交）` : `已是正本最新（${r.head}）`}${r.copied ? `，装了 ${r.copied} 个文件` : ''}${r.needsStRestart ? '；这次改到了转发插件，再重启一次 ST 才用上' : ''}`);
    } catch (error) {
        console.warn('[rp-emergence] 跟正本时出错：', error.message);
    }
}

// 后台还开着（ST 关了它不跟着关，D-163）：代码刚快进过，它内存里还是旧的。问它是用哪个版本起来的，和磁盘上的对不上就让它更新（会自己重启）。
// 更老的后台不报版本、也不会因为这个重启：只提示一句。
async function restartIfStale(base, config) {
    if (!config.update?.follow || !config.autoStart?.entry || !(await health(base))) return;
    const repo = path.resolve(path.dirname(config.autoStart.entry), '..');
    const disk = await new Promise(resolve => execFile('git', ['-C', repo, 'rev-parse', 'HEAD'], { timeout: 10000, windowsHide: true }, (e, out) => resolve(e ? null : String(out).trim())));
    let code = null;
    try { code = (await (await fetch(`${base}/v1/health`, { signal: AbortSignal.timeout(3000) })).json())?.code ?? null; } catch {}
    if (!disk || code === disk) return;
    try {
        const r = await (await fetch(`${base}/v1/update`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ apply: true }), signal: AbortSignal.timeout(90000) })).json();
        console.log(r?.restarted ? '[rp-emergence] 后台还在用旧代码，已让它重启' : '[rp-emergence] 后台还在用旧代码，没能让它自己重启：在面板上点"更新"，或者结束那个后台进程');
    } catch (error) { console.warn('[rp-emergence] 让后台重启时出错：', error.message); }
}

export async function init(router) {
    const config = readConfig();
    const base = `http://127.0.0.1:${config.port ?? DEFAULT_PORT}`;
    await followRelease(config);
    await restartIfStale(base, config);
    ensureCore(base, config);

    router.get('/health', async (_req, res) => {
        res.status((await health(base)) ? 200 : 503).json({ ok: await health(base) });
    });
    router.post('/:route', async (req, res) => {
        if (!ROUTE.test(req.params.route)) return res.status(404).json({ error: 'not_found' });
        try {
            const upstream = await fetch(`${base}/v1/${req.params.route}`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(req.body ?? {}),
                signal: AbortSignal.timeout(LONG.has(req.params.route) ? 240000 : 30000),
            });
            res.status(upstream.status).type('application/json').send(await upstream.text());
        } catch {
            // 后台不在（比如刚更新完在重启）：拉一次，这一回先告诉扩展连不上
            ensureCore(base, readConfig());
            res.status(503).json({ error: 'core_unavailable' });
        }
    });
}

export async function exit() {}
