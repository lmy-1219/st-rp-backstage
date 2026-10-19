// 后台出网代理（D-126 之后，试玩 9/30 又撞到一回）：代理只写在 ST 自己的 config.yaml（requestProxy）里时，
// 后台不管是谁拉起来的（新旧转发插件、自己重启、手动启动），启动时自己读一遍；自己没带上，就带着代理重启自己一次。
// 只认 http(s) 代理（Node 自带的 fetch 不认 socks）。--proxy off 表示不走代理。
import fs from 'node:fs';
import path from 'node:path';

export function stProxyFrom(stRoot) {
    if (!stRoot) return null;
    let text;
    try { text = fs.readFileSync(path.join(stRoot, 'config.yaml'), 'utf8'); } catch { return null; }
    const block = /^requestProxy:[^\n]*\n((?:[ \t#].*\n?|\s*\n)*)/m.exec(text)?.[1] ?? '';
    const on = /^\s+enabled:\s*true\b/m.test(block);
    const url = /^\s+url:\s*["']?([^"'\s#]+)/m.exec(block)?.[1] ?? null;
    return on && url && /^https?:\/\//.test(url) ? url : null;
}

// 该用哪个代理：--proxy 优先（"off"＝不用），没给就读 ST 的配置。
export function wantedProxy({ proxyArg = null, stRoot = null } = {}) {
    if (proxyArg) return proxyArg === 'off' ? null : proxyArg;
    return stProxyFrom(stRoot);
}

// 这个进程眼下的环境是不是已经在走这个代理（NODE_USE_ENV_PROXY 只在进程启动时认）。
export function proxyActive(env, url) {
    return env.NODE_USE_ENV_PROXY === '1' && (env.HTTPS_PROXY === url || env.https_proxy === url);
}

export function proxyEnv(env, url) {
    return url ? { ...env, NODE_USE_ENV_PROXY: '1', HTTPS_PROXY: url, HTTP_PROXY: url, NO_PROXY: 'localhost,127.0.0.1,::1' } : { ...env };
}
