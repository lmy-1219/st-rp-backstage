// 跟着正本走（D-117，9/30 用户：正本只有一份，改完别的地方跟着改／一键更新，别改完正本还得去试玩副本再改一遍）。
// 玩的 ST（试玩副本、以后装进用户自己的 ST）用的代码是这个仓的一份"发布用"的拷贝（git 工作树），只跟已经推送的 main 走：
// 窗口改到一半、没提交没推送的东西碰不到正在玩的那份；推送之前测试全过，推送就是发布。
// 更新＝把那份拷贝快进到 origin/main，再把扩展和转发插件的文件拷进 ST。ST 启动时自动做一次（转发插件），面板上也能点。
// 数据（后台数据目录、面板上调过的参数）不在代码里，更新不碰；卡、书、预设是用户的内容，也不碰。
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { isReleaseOrigin, assertReleaseTree, releaseCloneProblem, noLinks } from './install.mjs';
export { RELEASE_REPOSITORY, isReleaseOrigin } from './install.mjs';

// 装进 ST 的文件：扩展、转发插件（插件的 config.json 是每个 ST 自己的，不在这里）
export const INSTALL = [
    { from: 'extension', to: ['data', 'default-user', 'extensions', 'rp-emergence'], files: ['manifest.json', 'index.js', 'sync.mjs'] },
    { from: 'plugin', to: ['plugins', 'rp-emergence'], files: ['index.js', 'package.json'] },
];

const git = (repo, args, timeout = 20000) => new Promise(resolve => {
    execFile('git', ['-C', repo, ...args], { timeout, windowsHide: true }, (error, stdout, stderr) =>
        resolve({ ok: !error, out: String(stdout ?? '').trim(), err: String(stderr || error?.message || '').trim() }));
});

export function readReleaseInfo(repo) {
    try {
        const file = path.join(repo, 'release.json');
        if (fs.lstatSync(file).isSymbolicLink()) return null;
        const info = JSON.parse(fs.readFileSync(file, 'utf8'));
        return Number.isSafeInteger(info.version) && info.version > 0 && /^[a-f0-9]{40,64}$/i.test(info.sourceCommit) && Number.isFinite(Date.parse(info.date)) ? info : null;
    } catch { return null; }
}
// 后台在 layout:2 下位于 server/core；旧后台传入的 repo 因而是 server。
export function releaseRoot(repo) {
    if(readReleaseInfo(repo)?.layout===2)return repo;
    const parent=path.dirname(repo);
    return path.basename(repo)==='server'&&readReleaseInfo(parent)?.layout===2?parent:repo;
}

function extensionClone(stRoot) {
    if (!stRoot) return null;
    const candidates = [
        path.join(stRoot, 'public', 'scripts', 'extensions', 'third-party', 'st-rp-backstage'),
        path.join(stRoot, 'data', 'default-user', 'extensions', 'st-rp-backstage'),
    ];
    return candidates.find(dir => fs.existsSync(dir)) ?? null;
}

// 看一眼：这份拷贝在哪个版本、正本推送到了哪、差几个提交、改到了哪些地方
export async function checkRelease({ repo, stRoot = null, follow = 'origin/main', fetch = true, acceptsOrigin = isReleaseOrigin }) {
    repo=releaseRoot(repo);
    const remote = await git(repo, ['remote', 'get-url', 'origin']);
    const releaseRepository = remote.ok && acceptsOrigin(remote.out);
    const info = readReleaseInfo(repo), published = follow === 'origin/main' && releaseRepository && !!info;
    const label = value => /^\d+(\.\d+)?$/.test(String(value ?? '')) ? String(value) : null;
    const channel = { follow, releaseRepository, version: published ? info.version : null, label: published ? label(info.label) : null, layout: info?.layout ?? 1,
        edition: published || follow === 'origin/release' ? '正式版' : follow === 'origin/main' ? '开发版（跟 main）' : '开发版' };
    const fetched = fetch && follow.includes('/') ? await git(repo, ['fetch', '--quiet', follow.split('/')[0]], 30000) : null;
    channel.fetchFailed = fetched?.ok === false;
    const head = await git(repo, ['rev-parse', 'HEAD']), target = await git(repo, ['rev-parse', follow]);
    if (!head.ok || !target.ok) return { ...channel, ok: false, error: `找不到版本（${head.err || target.err}）` };
    const dirty = (await git(repo, ['status', '--porcelain', '--untracked-files=no'])).out.length > 0;
    const count = async range => Number((await git(repo, ['rev-list', '--count', range])).out || 0);
    const pluginBehind = await count(`HEAD..${follow}`), ahead = await count(`${follow}..HEAD`);
    let behind = pluginBehind, extensionBehind = 0;
    let changed = behind ? (await git(repo, ['diff', '--name-only', `HEAD..${follow}`])).out.split('\n').filter(Boolean) : [];
    let log = behind ? (await git(repo, ['log', '--format=%s', '-n', '10', `HEAD..${follow}`])).out.split('\n').filter(Boolean) : [];
    if (info?.layout === 2 && stRoot) {
        const ext = extensionClone(stRoot);
        if (ext && fs.existsSync(path.join(ext, '.git'))) {
            const extHead = await git(ext, ['rev-parse', 'HEAD']);
            if (extHead.ok && extHead.out !== target.out) {
                extensionBehind = await count(`${extHead.out}..${target.out}`);
                if (pluginBehind === 0 && extensionBehind > 0) {
                    behind = extensionBehind;
                    changed = (await git(repo, ['diff', '--name-only', `${extHead.out}..${target.out}`])).out.split('\n').filter(Boolean);
                    log = (await git(repo, ['log', '--format=%s', '-n', '10', `${extHead.out}..${target.out}`])).out.split('\n').filter(Boolean);
                    const extInfo = readReleaseInfo(ext);
                    if (published && extInfo) channel.label = label(extInfo.label) ?? channel.label;
                }
            }
        }
    }
    let targetInfo;
    try { const r = await git(repo, ['show', `${follow}:release.json`]); if (r.ok) targetInfo = JSON.parse(r.out); } catch {}
    return {
        ok: true, ...channel,
        head: head.out.slice(0, 7), headFull: head.out, target: target.out.slice(0, 7), targetFull: target.out, targetLabel: published ? label(targetInfo?.label) : null, behind, extensionBehind, ahead, dirty, log,
        changed: changed.length,
        // 改到转发插件的，要重启 ST 才生效；改到扩展的，刷新网页
        needsStRestart: info?.layout===2 ? head.out !== target.out && changed.some(f => f.startsWith('server/plugin/') || f === 'package.json') : changed.some(f => f.startsWith('plugin/')),
        needsReload: info?.layout===2 ? changed.some(isExtensionFile) || (pluginBehind === 0 && extensionBehind > 0) : changed.some(f => f.startsWith('extension/')),
    };
}

const isExtensionFile = file => ['index.js', 'sync.mjs', 'manifest.json', 'style.css'].includes(file) || file.startsWith('assets/');

// 与安装器共用 origin、工作区和树检查；后台只用异步 git，不运行安装器的同步命令。
async function prepareClone(repo, { follow, fetch, acceptsOrigin }) {
    const run = async args => { const r = await git(repo, args, 30000); if (!r.ok) throw Error(r.err || 'git 检查失败'); return r.out; };
    if (!fs.existsSync(path.join(repo, '.git'))) throw Error('扩展不是用 git 装的，刷新网页前请自己替换');
    const origin = await run(['remote', 'get-url', 'origin']);
    let problem = releaseCloneProblem({ origin, dirty: await run(['status', '--porcelain', '--untracked-files=all']), branch: await run(['branch', '--show-current']) }, acceptsOrigin);
    if (problem) throw Error(problem);
    if (follow !== 'origin/main') throw Error('新安装布局只跟 origin/main，未更新');
    if (fetch) await run(['fetch', '--quiet', 'origin']);
    const tree = await run(['ls-tree', '-rz', follow]);
    try { assertReleaseTree(tree); } catch (error) { error.unsafeTree = true; throw error; }
    const target = await run(['rev-parse', follow]);
    const ahead = Number(await run(['rev-list', '--count', `${target}..HEAD`]));
    problem = releaseCloneProblem({ origin, branch: 'main', dirty: false, ahead }, acceptsOrigin);
    if (problem) throw Error(problem);
    const head = await run(['rev-parse', 'HEAD']);
    const changed = head === target ? [] : (await run(['diff', '--name-only', `HEAD..${target}`])).split('\n').filter(Boolean);
    return { repo, target, updated: head !== target, needsReload: changed.some(isExtensionFile) };
}

async function applyLayout2({ repo, stRoot, follow, fetch, acceptsOrigin, status }) {
    let plugin, extension, warning = null;
    try {
        const insideSt = stRoot && !path.relative(stRoot, repo).split(path.sep).includes('..');
        noLinks(insideSt ? stRoot : repo, repo);
        plugin = await prepareClone(repo, { follow, fetch: false, acceptsOrigin });
    } catch (error) { return { ...status, ok: false, error: error.message }; }
    const ext = extensionClone(stRoot);
    try {
        if (!ext) throw Error('扩展不是用 git 装的，刷新网页前请自己替换');
        noLinks(stRoot, ext);
        extension = await prepareClone(ext, { follow, fetch, acceptsOrigin });
        if (extension.target !== plugin.target) { warning = '两份克隆查到的版本不同，扩展那份没更新，请再检查一次更新'; extension = null; }
    } catch (error) {
        if (error.unsafeTree) return { ...status, ok: false, error: error.message };
        warning = `扩展那份没更新：${error.message}`;
    }
    for (const clone of [plugin, extension].filter(Boolean)) {
        if (!clone.updated) continue;
        const merged = await git(clone.repo, ['merge', '--ff-only', '--quiet', clone.target], 60000);
        if (!merged.ok) {
            if (clone === plugin) return { ...status, ok: false, error: `没更新成：${merged.err}` };
            warning = `扩展那份没更新：${merged.err}`; extension = null;
        }
    }
    return { ...status, ok: true, updated: plugin.updated || !!extension?.updated, pluginUpdated: plugin.updated, copied: 0, needsReload: status.needsReload || !!extension?.needsReload, extensionUpdated: !!extension?.updated, extensionWarning: warning };
}

// 扩展和插件的文件拷进 ST（内容一样的不拷）。返回拷了几个。
export function installFiles({ repo, stRoot }) {
    let n = 0;
    for (const { from, to, files } of INSTALL) {
        const dir = path.join(stRoot, ...to);
        fs.mkdirSync(dir, { recursive: true });
        for (const f of files) {
            const src = path.join(repo, from, f), dst = path.join(dir, f);
            const a = fs.readFileSync(src);
            if (fs.existsSync(dst) && Buffer.compare(a, fs.readFileSync(dst)) === 0) continue;
            fs.writeFileSync(`${dst}.tmp`, a);
            fs.renameSync(`${dst}.tmp`, dst);
            n++;
        }
    }
    return n;
}

// 更新：只快进（这份拷贝里有没提交的改动、或者有正本里没有的提交，就不动，说清楚为什么）；然后把文件拷进 ST。
export async function applyRelease({ repo, stRoot = null, follow = 'origin/main', fetch = true, acceptsOrigin = isReleaseOrigin }) {
    repo=releaseRoot(repo);
    const s = await checkRelease({ repo, stRoot, follow, fetch, acceptsOrigin });
    if (!s.ok) return s;
    if (s.layout === 2 && s.fetchFailed) return { ...s, ok: false, error: '没取到发布仓的新版本，未更新' };
    if (s.layout === 2) return applyLayout2({ repo, stRoot, follow, fetch, acceptsOrigin, status: s });
    if (s.dirty) return { ...s, ok: false, error: '这份代码里有没提交的改动，没更新' };
    if (s.ahead) return { ...s, ok: false, error: '这份代码里有正本里没有的提交，没更新' };
    if (s.behind) {
        const m = await git(repo, ['merge', '--ff-only', '--quiet', follow], 60000);
        if (!m.ok) return { ...s, ok: false, error: `没更新成：${m.err}` };
    }
    const layout2=readReleaseInfo(repo)?.layout===2;
    const copied = stRoot&&!layout2 ? installFiles({ repo, stRoot }) : 0;
    return { ...s, layout:readReleaseInfo(repo)?.layout ?? s.layout, ok: true, updated: s.behind > 0, copied };
}
