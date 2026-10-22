// 开局包（_dev/开局包格式-20261017.md，用户 10/17：一键导入一整局）：局包是一个文件夹，根目录一份 开局包.json 清单；
// 卡、user 卡、世界书、局预设、ST 预设读成文本交给扩展；新素材复制进后台数据目录。
// ZIP/Git 来源也只准备文件，ST 导入仍由扩展完成。题材无关。
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { extractZip, ZIP_MAX_BYTES } from './zip.mjs';
import { readLocal } from './local.mjs';

const MANIFEST = ['开局包.json', 'opening-pack.json'];

const isDir = p => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const isFile = p => { try { return fs.statSync(p).isFile(); } catch { return false; } };
const readJson = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const fail = message => { throw Object.assign(new Error(message), { status: 400 }); };
const names = v => (Array.isArray(v) ? v.map(x => String(x ?? '').trim()).filter(Boolean) : []);
function assertOpeningDirectory(root, local = readLocal()) {
    if (!isDir(root)) fail('这个路径不是一个文件夹');
    const real = fs.realpathSync.native(root).toLowerCase();
    if (local.productionSt.some(p => { const base = (isDir(p) ? fs.realpathSync.native(p) : path.resolve(p)).toLowerCase(); return real === base || real.startsWith(base + path.sep); })) fail('这是生产 ST 的目录');
}

// 读一张 chara_card_v3（ST 直接导的那种）：name、first_mes 在顶层或 data 里
function readCard(file) {
    const text = fs.readFileSync(file, 'utf8');
    let j;
    try { j = JSON.parse(text); } catch { fail(`卡不是 JSON：${path.basename(file)}`); }
    const d = j?.data && typeof j.data === 'object' ? j.data : j;
    const name = String(d?.name ?? j?.name ?? '').trim();
    if (!name) fail(`卡没有名字：${path.basename(file)}`);
    return { file: path.basename(file), name, greeting: !!String(d?.first_mes ?? j?.first_mes ?? '').trim(), text };
}

// 素材包里系统会读的几样：在不在、格式对不对
export function checkPack(dir) {
    const has = rel => isFile(path.join(dir, rel));
    const json = rel => { try { return readJson(path.join(dir, rel)); } catch { return null; } };
    const out = [];
    const check = (rel, ok, why) => out.push({ file: rel, ok, why });
    if (has('物价.json')) { const j = json('物价.json'); check('物价.json', Array.isArray(j?.items), Array.isArray(j?.items) ? `${j.items.length} 条` : '要 items（见开局包格式）'); } else check('物价.json', null, '没有（可以没有）');
    if (has('常识.json')) { const j = json('常识.json'); check('常识.json', Array.isArray(j?.facts), Array.isArray(j?.facts) ? `${j.facts.length} 条` : '要 facts（见开局包格式）'); } else check('常识.json', null, '没有（可以没有）');
    if (has('势力网.json')) { const j = json('势力网.json'); check('势力网.json', Array.isArray(j?.nodes) && Array.isArray(j?.edges), '要 nodes 和 edges'); } else check('势力网.json', null, '没有（可以没有）');
    check('年表/时事种子.csv', has('年表/时事种子.csv') ? true : null, has('年表/时事种子.csv') ? '' : '没有（可以没有；草稿要人核完改名才算）');
    if (has('年表/纪年锚点.json')) { const j = json('年表/纪年锚点.json'); const a = j?.anchors ?? j; check('年表/纪年锚点.json', Array.isArray(a), '要 anchors'); } else check('年表/纪年锚点.json', null, '没有（可以没有）');
    check('专名对照表.csv', has('专名对照表.csv') ? true : null, has('专名对照表.csv') ? '' : '没有（中文题材可以没有）');
    // 对的那几样只报条数
    for (const c of out) if (c.ok === true && /^要 /.test(c.why)) c.why = '';
    return out;
}

/**
 * 读一个开局包。返回 { manifest: { 名, 群名, 开场在场, 书绑法 }, cards: [{ file, name, greeting, text }], user: { file, name, text } | null,
 *   books: [{ file, name, bind, text }], preset: { name, text, data } | null, stPreset: { name, text } | null, pack: { name, dir, checks } | null, warnings: [] }
 * full=false 时不带 text（先看一眼用）
 */
export function readOpeningPack(dir, { full = true, local = readLocal(), boundary = null } = {}) {
    const root = path.resolve(String(dir ?? '').trim().replace(/^"|"$/g, ''));
    assertOpeningDirectory(root, local);
    if (boundary) {
        const check = dir => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { if (e.name === '.git') continue; if (e.isSymbolicLink()) fail('开局包不能引用链接'); if (e.isDirectory()) check(path.join(dir, e.name)); } };
        check(root);
    }
    const mf = MANIFEST.map(n => path.join(root, n)).find(isFile);
    if (!mf) fail(`文件夹里没有 ${MANIFEST[0]}（清单；格式见 _dev/开局包格式-20261017.md）`);
    let m;
    try { m = readJson(mf); } catch { fail('开局包.json 不是 JSON'); }
    if (m?.v !== 1) fail('开局包.json 的 v 要是 1');
    const inside = file => { if (!boundary) return true; const base = fs.realpathSync(boundary), resolved = fs.existsSync(file) ? fs.realpathSync(file) : path.resolve(file); return resolved === base || resolved.startsWith(base + path.sep); };
    const rel = p => { const file = path.resolve(root, String(p)); if (!inside(file) || path.basename(file).toLowerCase() === 'secrets.json' || (boundary && path.relative(boundary, file).split(path.sep).includes('.git'))) fail('清单引用了包外或受保护的文件'); return file; };
    const warnings = [];
    // 卡
    const cardDir = rel(m.卡 ?? '卡');
    if (!isDir(cardDir)) fail(`没有卡的目录：${m.卡 ?? '卡'}`);
    const userFile = m.user卡 ? rel(m.user卡) : null;
    const cards = fs.readdirSync(cardDir).filter(f => /\.json$/i.test(f) && f.toLowerCase() !== 'secrets.json' && (!userFile || path.resolve(cardDir, f) !== userFile)).sort()
        .map(f => readCard(path.join(cardDir, f)));
    if (!cards.length) fail('卡的目录里没有 *.json');
    const dup = cards.map(c => c.name).filter((n, i, a) => a.indexOf(n) !== i);
    if (dup.length) warnings.push(`有重名的卡：${[...new Set(dup)].join('、')}`);
    let user = null;
    if (userFile) { if (!isFile(userFile)) fail(`没有 user 卡：${m.user卡}`); const c = readCard(userFile); user = { file: c.file, name: c.name, text: c.text }; }
    // 开场在场
    const present = names(m.开场在场);
    const known = new Set(cards.map(c => c.name));
    const missing = present.filter(n => !known.has(n));
    if (missing.length) warnings.push(`开场在场里有卡里没有的：${missing.join('、')}`);
    const silent = present.filter(n => known.has(n) && !cards.find(c => c.name === n).greeting);
    if (silent.length) warnings.push(`开场在场的这几位卡里没有开场白：${silent.join('、')}`);
    if (!present.length) warnings.push('开场在场是空的：开场白会全留、谁都不静音');
    // 同场（可选）：开场时和玩家在同一处的人——群里只有他们不静音（后台把没静音的当成在场）；没写就让用户在看一眼时勾
    const together = names(m.同场);
    const strayTogether = together.filter(n => !known.has(n));
    if (strayTogether.length) warnings.push(`同场里有卡里没有的：${strayTogether.join('、')}`);
    // 世界书
    const books = (Array.isArray(m.世界书) ? m.世界书 : []).map(b => {
        const f = rel(b?.文件 ?? '');
        if (!isFile(f)) fail(`没有世界书：${b?.文件}`);
        const text = fs.readFileSync(f, 'utf8');
        let j; try { j = JSON.parse(text); } catch { fail(`世界书不是 JSON：${b.文件}`); }
        if (!j || typeof j !== 'object' || !('entries' in j)) fail(`世界书要有 entries：${b.文件}`);
        return { file: path.basename(f), name: path.parse(f).name, bind: b?.绑 === '全局' ? '全局' : '窗口', entries: Object.keys(j.entries ?? {}).length, text };
    });
    // 局预设（rp_emergence 局预设 v1）
    let preset = null;
    if (m.局预设) {
        const f = rel(m.局预设);
        if (!isFile(f)) fail(`没有局预设：${m.局预设}`);
        const text = fs.readFileSync(f, 'utf8');
        let j; try { j = JSON.parse(text); } catch { fail('局预设不是 JSON'); }
        if (j?.v !== 1 || !j.name) fail('局预设要是 rp_emergence 局预设 v1（有 v: 1 和 name）');
        preset = { name: String(j.name), text, data: j, people: Array.isArray(j.cast) ? j.cast.length : 0, setup: !!j.setup, relations: !!j.relations, pack: j.pack ?? null };
        if (Array.isArray(j.cast)) {
            const castMissing = j.cast.filter(e => e?.role !== '不用' && !String(e?.avatar ?? '').startsWith('face:') && !known.has(String(e?.name ?? ''))).map(e => e.name);
            if (castMissing.length) warnings.push(`局预设名册里有卡没导的：${castMissing.slice(0, 8).join('、')}${castMissing.length > 8 ? '…' : ''}`);
        }
    } else warnings.push('没有局预设：开局单、名册、关系表都得你在面板里填');
    // ST 预设
    let stPreset = null;
    if (m.ST预设) { const f = rel(m.ST预设); if (!isFile(f)) fail(`没有 ST 预设：${m.ST预设}`); stPreset = { name: path.parse(f).name, text: fs.readFileSync(f, 'utf8') }; }
    // 素材包
    let pack = null;
    if (m.素材包) {
        const original = path.resolve(root, String(m.素材包)), last = String(m.素材包).replaceAll('\\', '/').split('/').filter(Boolean).at(-1);
        const candidates = [original, path.join(root, '素材包', last ?? ''), path.join(root, last ?? '')];
        const d = candidates.find(p => inside(p) && isDir(p));
        if (!d) warnings.push('素材包缺；其他资源仍可导入');
        else {
            if (d !== original) warnings.push('素材包在包里找到了');
            pack = { name: path.basename(d), dir: d, checks: checkPack(d) };
            if (preset?.pack && preset.pack !== pack.name) warnings.push(`局预设里 pack＝"${preset.pack}"，素材包目录名是"${pack.name}"，对不上（套完以后这一局选不到包）`);
            for (const c of pack.checks) if (c.ok === false) warnings.push(`素材包 ${c.file}：${c.why}`);
        }
    }
    const strip = x => (x && 'text' in x ? { ...x, text: undefined } : x);
    const out = {
        manifest: { 名: String(m.名 ?? path.basename(root)), 群名: String(m.群名 ?? m.名 ?? path.basename(root)), 开场在场: present, 同场: together.filter(n => known.has(n)), 同场写了: Array.isArray(m.同场) },
        cards, user, books, preset, stPreset, pack, warnings,
    };
    if (full) return out;
    return { ...out, cards: cards.map(strip), user: strip(user), books: books.map(strip), preset: preset ? { ...strip(preset), data: undefined } : null, stPreset: strip(stPreset) };
}

// 覆盖同名卡、书之前先备份原件（ST 数据目录里 characters/<avatar>、worlds/<名>.json）；stRoot 不知道就不备份
export function backupStFiles(stRoot, backupRoot, { cards = [], books = [] } = {}) {
    if (!stRoot || !backupRoot || (!cards.length && !books.length)) return null;
    const user = path.join(stRoot, 'data', 'default-user');
    if (!isDir(user)) return null;
    const dir = path.join(backupRoot, `开局包覆盖前-${new Date().toISOString().replace(/[:.]/g, '-')}`);
    fs.mkdirSync(dir, { recursive: true });
    for (const a of cards) { const f = path.join(user, 'characters', path.basename(String(a))); if (isFile(f)) fs.copyFileSync(f, path.join(dir, path.basename(f))); }
    for (const n of books) { const f = path.join(user, 'worlds', `${path.basename(String(n))}.json`); if (isFile(f)) fs.copyFileSync(f, path.join(dir, path.basename(f))); }
    return dir;
}

// 素材包复制进调用方提供的数据目录：目标已存在且不盖就跳过
export function installPack(src, packsDir, { overwrite = false } = {}) {
    if (!packsDir) fail('没有素材包目录');
    const target = path.join(packsDir, path.basename(src));
    if (isDir(target) && !overwrite) return { target, skipped: true };
    if (isDir(target)) fs.rmSync(target, { recursive: true, force: true });
    fs.mkdirSync(packsDir, { recursive: true });
    copyDir(src, target);   // 自己递归拷（fs.cpSync 在 Windows 上碰到中文目录会把进程带崩，10/17 实测）
    return { target, skipped: false };
}
function copyDir(src, dst) {
    fs.mkdirSync(dst, { recursive: true });
    for (const e of fs.readdirSync(src, { withFileTypes: true })) {
        if (e.name === '.git') continue;
        const s = path.join(src, e.name), d = path.join(dst, e.name);
        if (e.isDirectory()) copyDir(s, d);
        else if (e.isFile() && e.name.toLowerCase() !== 'secrets.json') fs.copyFileSync(s, d);
    }
}

// 独立素材包：从受管来源里找，不把任意本机路径当成上传结果。
export function findMaterialPacks(root) {
    assertOpeningDirectory(path.resolve(root));
    const found = [];
    function walk(dir, depth) {
        const st = fs.lstatSync(dir);
        if (st.isSymbolicLink() || !st.isDirectory()) fail('素材包目录不是普通目录');
        if (['常识.json', '物价.json', '势力网.json', '关系网.json'].some(n => isFile(path.join(dir, n))) || ['年表', '人物档案'].some(n => isDir(path.join(dir, n)))) { found.push(dir); return; }
        if (depth === 3) return;
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) if (e.isDirectory() && !e.isSymbolicLink() && !e.name.startsWith('.')) walk(path.join(dir, e.name), depth + 1);
    }
    walk(path.resolve(root), 0);
    if (!found.length) fail('这不像一个素材包');
    return found;
}

export function materialPackSource(input, managed) {
    const root = path.resolve(managed), dir = path.resolve(input), rel = path.relative(root, dir);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel) || rel.split(path.sep).some(n => n.startsWith('.'))) fail('请选择本入口上传或拉取的素材包');
    const top = rel.split(path.sep)[0];
    if (!isFile(path.join(root, '.sources', top + '.json'))) fail('不认识这个素材包来源');
    const check = current => {
        const st = fs.lstatSync(current);
        if (st.isSymbolicLink()) fail('素材包不能引用链接');
        if (st.isDirectory()) for (const e of fs.readdirSync(current, { withFileTypes: true })) if (e.name !== '.git') check(path.join(current, e.name));
    };
    // 从来源顶层检查，防止选择落在链接目录下面。
    check(path.join(root, top));
    safeLabel(path.basename(dir));
    return dir;
}

export function findOpeningPacks(root) {
    assertOpeningDirectory(path.resolve(root));
    const found = [];
    function walk(dir, depth) {
        const st = fs.lstatSync(dir); if (!st.isDirectory() || st.isSymbolicLink()) fail('开局包目录不是普通目录');
        if (MANIFEST.some(n => isFile(path.join(dir, n)))) { found.push(dir); return; }
        if (depth === 3) return;
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) if (e.isDirectory() && e.name !== '.git' && !e.isSymbolicLink()) walk(path.join(dir, e.name), depth + 1);
    }
    walk(path.resolve(root), 0);
    if (!found.length) fail('包里没有 开局包.json');
    return found;
}

export const UPLOAD_CHUNK_BYTES = 4 * 1024 * 1024;
const UPLOAD_TTL = 30 * 60 * 1000;
const execAsync = promisify(execFile);
const safeLabel = value => {
    const name = String(value ?? '').trim();
    if (!name || name.length > 150 || /[\\/:*?"<>|\x00-\x1f]/.test(name) || /[. ]$/.test(name) || name === '.' || name === '..' || name.startsWith('.')) fail('包名不对');
    return name;
};
const plainDir = dir => { if (fs.existsSync(dir) && (!fs.lstatSync(dir).isDirectory() || fs.lstatSync(dir).isSymbolicLink())) fail('开局包目录不是普通目录'); };
export function httpsPackUrl(value) {
    let u; try { u = new URL(value); } catch { fail('请贴 HTTPS git 仓库地址'); }
    if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash) fail('只接受不带账号密码的 HTTPS git 仓库地址');
    return u.href.replace(/\/$/, '');
}

// 数据目录的受管入口；测试可传真 Git 的合成本地传输，产品入口仍在 server 严格核 HTTPS。
export function openingSources(root, { now = Date.now, runGit = null } = {}) {
    root = path.resolve(root); const temp = path.join(root, '.upload'), stateDir = path.join(root, '.sources'), sessions = new Map();
    const ensure = () => { plainDir(root); plainDir(temp); plainDir(stateDir); fs.mkdirSync(temp, { recursive: true }); fs.mkdirSync(stateDir, { recursive: true }); };
    const marker = name => path.join(stateDir, name + '.json');
    const drop = id => { const s = sessions.get(id); sessions.delete(id); if (s && fs.existsSync(s.file)) fs.unlinkSync(s.file); };
    function cleanup() {
        if (!fs.existsSync(temp)) return; plainDir(temp);
        for (const [id, s] of sessions) if (now() - s.at >= UPLOAD_TTL) drop(id);
        for (const e of fs.readdirSync(temp, { withFileTypes: true })) if (e.isFile() && /^[a-zA-Z0-9_-]+\.zip$/.test(e.name)) {
            const file = path.join(temp, e.name); if (now() - fs.statSync(file).mtimeMs >= UPLOAD_TTL) fs.unlinkSync(file);
        }
    }
    const git = runGit ?? (async (args, cwd) => {
        const r = await execAsync('git', ['-c', 'core.hooksPath=' + path.join(root, '.no-hooks'), ...args], { cwd, timeout: 180000, maxBuffer: 1024 * 1024, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }); return r.stdout.trim();
    });
    let busy = false;
    return { root, cleanup,
        upload(b) {
            ensure(); cleanup(); const { id, index, total, data, name } = b;
            const validId = typeof id === 'string' && /^[a-zA-Z0-9_-]{12,80}$/.test(id);
            if (b.abort === true && validId) { drop(id); return { aborted: true }; }
            try {
                if (!validId || !Number.isInteger(index) || !Number.isInteger(total) || total < 1 || total > Math.ceil(ZIP_MAX_BYTES / UPLOAD_CHUNK_BYTES) || index < 0 || index >= total) fail('上传编号不对');
                if (typeof data !== 'string' || !data.length || data.length % 4 || data.length > Math.ceil(UPLOAD_CHUNK_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) fail('上传块不是有效 base64');
                const bytes = Buffer.from(data, 'base64'); if (bytes.toString('base64') !== data) fail('上传块不是有效 base64'); if (bytes.length > UPLOAD_CHUNK_BYTES) fail('上传块太大');
                if (!/\.zip$/i.test(String(name))) fail('只认 .zip；rar、7z 请先转成 zip');
                const label = safeLabel(name.slice(0, -4)); let s = sessions.get(id);
                if (!s) { if (index !== 0) fail('不认识这个上传 id'); if (sessions.size >= 4) fail('正在上传的包太多'); const file = path.join(temp, id + '.zip'); fs.writeFileSync(file, Buffer.alloc(0), { flag: 'wx' }); s = { file, next: 0, total, name, at: now(), size: 0 }; sessions.set(id, s); }
                if (s.next !== index || s.total !== total || s.name !== name) fail('上传块缺失、重复或顺序不对');
                s.size += bytes.length; if (s.size > ZIP_MAX_BYTES) fail('包太大'); fs.appendFileSync(s.file, bytes); s.next++; s.at = now();
                if (s.next < total) return { received: s.next, total };
                const target = path.join(root, label), staged = path.join(root, '.extract-' + randomUUID());
                plainDir(target); if (fs.existsSync(target) && (!fs.existsSync(marker(label)) || readJson(marker(label)).kind !== 'zip')) fail('同名目录不是已上传的压缩包，不覆盖');
                try { extractZip(s.file, staged); if (fs.existsSync(target)) fs.rmSync(target, { recursive: true }); fs.renameSync(staged, target); fs.writeFileSync(marker(label), JSON.stringify({ kind: 'zip' })); }
                finally { if (fs.existsSync(staged)) fs.rmSync(staged, { recursive: true, force: true }); }
                drop(id); return { received: total, total, path: target };
            } catch (e) { if (validId) drop(id); throw e; }
        },
        async pull(url) {
            if (busy) fail('正在拉取，请稍候'); ensure(); busy = true;
            let created = null;
            try {
                const name = safeLabel(decodeURIComponent(String(url).split('/').filter(Boolean).at(-1)).replace(/\.git$/i, '')), target = path.join(root, name);
                plainDir(target);
                let operation;
                if (fs.existsSync(target)) {
                    if (!fs.existsSync(marker(name)) || readJson(marker(name)).kind !== 'git') fail('同名目录不是本入口拉取的仓库，不覆盖');
                    if ((await git(['remote', 'get-url', 'origin'], target)).trim() !== url) fail('已有同名仓库的 origin 地址不同，不覆盖');
                    if ((await git(['status', '--porcelain'], target)).trim()) fail('已有仓库有改动，不更新');
                    await git(['pull', '--ff-only'], target); operation = 'pull';
                } else {
                    created = target; await git(['clone', '--depth', '1', '--', url, target], root);
                    fs.writeFileSync(marker(name), JSON.stringify({ kind: 'git' })); operation = 'clone'; created = null;
                }
                return { path: target, operation };
            } catch (e) { if (created && fs.existsSync(created)) fs.rmSync(created, { recursive: true, force: true }); throw Object.assign(new Error((e.stderr || e.message) + '\n手机上网络不稳的，可以改用压缩包'), { status: 400 }); }
            finally { busy = false; }
        },
    };
}
