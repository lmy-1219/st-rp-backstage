// 开局包（_dev/开局包格式-20261017.md，用户 10/17：一键导入一整局）：局包是一个文件夹，根目录一份 开局包.json 清单；
// 这里只做读和核——卡、user 卡、世界书、局预设、ST 预设各读成文本交给扩展（扩展拿着酒馆的请求头往 ST 里导），素材包复制进本仓的素材包目录。
// 不碰 ST 的数据目录（那是扩展在页面里做的）；本机路径由用户在面板里填。题材无关。
import fs from 'node:fs';
import path from 'node:path';
import { readLocal } from './local.mjs';

const MANIFEST = ['开局包.json', 'opening-pack.json'];

const isDir = p => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const isFile = p => { try { return fs.statSync(p).isFile(); } catch { return false; } };
const readJson = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const fail = message => { throw Object.assign(new Error(message), { status: 400 }); };
const names = v => (Array.isArray(v) ? v.map(x => String(x ?? '').trim()).filter(Boolean) : []);

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
export function readOpeningPack(dir, { full = true, local = readLocal() } = {}) {
    const root = path.resolve(String(dir ?? '').trim().replace(/^"|"$/g, ''));
    if (!root || !isDir(root)) fail('这个路径不是一个文件夹');
    const real = fs.realpathSync.native(root).toLowerCase();
    if (local.productionSt.some(p => {
        const protectedRoot = (isDir(p) ? fs.realpathSync.native(p) : path.resolve(p)).toLowerCase();
        return real === protectedRoot || real.startsWith(protectedRoot + path.sep);
    })) fail('这是生产 ST 的目录');
    const mf = MANIFEST.map(n => path.join(root, n)).find(isFile);
    if (!mf) fail(`文件夹里没有 ${MANIFEST[0]}（清单；格式见 _dev/开局包格式-20261017.md）`);
    let m;
    try { m = readJson(mf); } catch { fail('开局包.json 不是 JSON'); }
    if (m?.v !== 1) fail('开局包.json 的 v 要是 1');
    const rel = p => path.resolve(root, String(p));
    const warnings = [];
    // 卡
    const cardDir = rel(m.卡 ?? '卡');
    if (!isDir(cardDir)) fail(`没有卡的目录：${m.卡 ?? '卡'}`);
    const userFile = m.user卡 ? rel(m.user卡) : null;
    const cards = fs.readdirSync(cardDir).filter(f => /\.json$/i.test(f) && (!userFile || path.resolve(cardDir, f) !== userFile)).sort()
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
        const d = rel(m.素材包);
        if (!isDir(d)) fail(`没有素材包目录：${m.素材包}`);
        pack = { name: path.basename(d), dir: d, checks: checkPack(d) };
        if (preset?.pack && preset.pack !== pack.name) warnings.push(`局预设里 pack＝"${preset.pack}"，素材包目录名是"${pack.name}"，对不上（套完以后这一局选不到包）`);
        for (const c of pack.checks) if (c.ok === false) warnings.push(`素材包 ${c.file}：${c.why}`);
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

// 素材包复制进本仓的素材包目录：目标已存在且不盖就跳过
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
        const s = path.join(src, e.name), d = path.join(dst, e.name);
        if (e.isDirectory()) copyDir(s, d);
        else if (e.isFile()) fs.copyFileSync(s, d);
    }
}
