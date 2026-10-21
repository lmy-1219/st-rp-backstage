// 跟着正本走（D-117，9/30 用户：正本只有一份，改完别的地方跟着改／一键更新，别改完正本还得去试玩副本再改一遍）。
// 玩的 ST（试玩副本、以后装进用户自己的 ST）用的代码是这个仓的一份"发布用"的拷贝（git 工作树），只跟已经推送的 main 走：
// 窗口改到一半、没提交没推送的东西碰不到正在玩的那份；推送之前测试全过，推送就是发布。
// 更新＝把那份拷贝快进到 origin/main，再把扩展和转发插件的文件拷进 ST。ST 启动时自动做一次（转发插件），面板上也能点。
// 数据（后台数据目录、面板上调过的参数）不在代码里，更新不碰；卡、书、预设是用户的内容，也不碰。
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';

// 装进 ST 的文件：扩展、转发插件（插件的 config.json 是每个 ST 自己的，不在这里）
export const INSTALL = [
    { from: 'extension', to: ['data', 'default-user', 'extensions', 'rp-emergence'], files: ['manifest.json', 'index.js', 'sync.mjs'] },
    { from: 'plugin', to: ['plugins', 'rp-emergence'], files: ['index.js', 'package.json'] },
];

const git = (repo, args, timeout = 20000) => new Promise(resolve => {
    execFile('git', ['-C', repo, ...args], { timeout, windowsHide: true }, (error, stdout, stderr) =>
        resolve({ ok: !error, out: String(stdout ?? '').trim(), err: String(stderr || error?.message || '').trim() }));
});

export const RELEASE_REPOSITORY = 'https://github.com/lmy-1219/st-rp-backstage.git';
export function isReleaseOrigin(value) {
    const canonical = url => String(url ?? '').trim().replace(/^git@github\.com:/i, 'https://github.com/').replace(/^ssh:\/\/git@github\.com\//i, 'https://github.com/').replace(/\.git\/?$/i, '').replace(/\/$/, '').toLowerCase();
    return canonical(value) === canonical(RELEASE_REPOSITORY);
}
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

// 看一眼：这份拷贝在哪个版本、正本推送到了哪、差几个提交、改到了哪些地方
export async function checkRelease({ repo, follow = 'origin/main', fetch = true }) {
    repo=releaseRoot(repo);
    const remote = await git(repo, ['remote', 'get-url', 'origin']);
    const releaseRepository = remote.ok && isReleaseOrigin(remote.out);
    const info = readReleaseInfo(repo), published = follow === 'origin/main' && releaseRepository && !!info;
    const channel = { follow, releaseRepository, version: published ? info.version : null, layout: info?.layout ?? 1,
        edition: published || follow === 'origin/release' ? '正式版' : follow === 'origin/main' ? '开发版（跟 main）' : '开发版' };
    const fetched = fetch && follow.includes('/') ? await git(repo, ['fetch', '--quiet', follow.split('/')[0]], 30000) : null;
    channel.fetchFailed = fetched?.ok === false;
    const head = await git(repo, ['rev-parse', 'HEAD']), target = await git(repo, ['rev-parse', follow]);
    if (!head.ok || !target.ok) return { ...channel, ok: false, error: `找不到版本（${head.err || target.err}）` };
    const dirty = (await git(repo, ['status', '--porcelain', '--untracked-files=no'])).out.length > 0;
    const count = async range => Number((await git(repo, ['rev-list', '--count', range])).out || 0);
    const behind = await count(`HEAD..${follow}`), ahead = await count(`${follow}..HEAD`);
    const changed = behind ? (await git(repo, ['diff', '--name-only', `HEAD..${follow}`])).out.split('\n').filter(Boolean) : [];
    const log = behind ? (await git(repo, ['log', '--format=%s', '-n', '10', `HEAD..${follow}`])).out.split('\n').filter(Boolean) : [];
    return {
        ok: true, ...channel,
        head: head.out.slice(0, 7), headFull: head.out, target: target.out.slice(0, 7), behind, ahead, dirty, log,
        changed: changed.length,
        // 改到转发插件的，要重启 ST 才生效；改到扩展的，刷新网页
        needsStRestart: info?.layout===2?behind>0:changed.some(f => f.startsWith('plugin/')), needsReload: info?.layout===2?false:changed.some(f => f.startsWith('extension/')),
    };
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
export async function applyRelease({ repo, stRoot = null, follow = 'origin/main', fetch = true }) {
    repo=releaseRoot(repo);
    const s = await checkRelease({ repo, follow, fetch });
    if (!s.ok) return s;
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
