// 局预设（收口计划第 5 件，N-233）：把一局的开局单、名册、关系表、素材包选择、离开计时存成一份，新局一键套用。
// 套完仍可改，和原来那一局互不影响（存的是一份拷贝）。存成后台数据目录下 presets/ 里的一个个文件（私有内容，不进仓），
// 另一个副本要用，把文件拷过去或者在面板上导出、导入。
// 不带记账、规划、口袋、关系的最新变化；剧情里冒出来的新面孔默认不带，保存时可选择带上。
import fs from 'node:fs';
import path from 'node:path';

export const PRESET_VERSION = 1;
const isFace = e => String(e?.avatar ?? '').startsWith('face:');
// 格式容错只认明确的生熟值，未知字符串不按 truthy 猜。
const strangerOf = v => v == null ? null : v === true || v === 1 || ['true', '生人'].includes(String(v).trim()) ? true : v === false || v === 0 || ['false', '熟人'].includes(String(v).trim()) ? false : null;

const cleanName = n => String(n ?? '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').replace(/^\.+/, '').trim().slice(0, 60);

// 这一局此刻的样子 → 一份预设
export function snapshot(store, storyId, { name, pack = null, includeGrownFaces = false } = {}) {
    const setup = store.setupOf(storyId)?.data ?? null;
    const cast = store.getCast(storyId).filter(e => e.role !== '新面孔' || (isFace(e) && (e.set_by === 'user' || includeGrownFaces))).map(e => ({
        avatar: e.avatar, name: e.name, ...(e.call !== undefined ? { call: e.call } : {}), ...(e.stranger !== undefined ? { stranger: strangerOf(e.stranger) } : {}), ...(e.gender !== undefined ? { gender: e.gender } : {}), role: e.role, hook: e.hook ?? null, priority: !!e.priority, bond: e.bond ?? null,
        interests: e.interests_own ? e.interests : null, byUser: e.set_by === 'user', ...(e.群体 === true ? { 群体: true } : {}),
    }));
    return {
        v: PRESET_VERSION, name, savedAt: new Date().toISOString(),
        setup, cast, relations: store.relationsOf(storyId), pack: pack ?? store.getMeta(`pack:${storyId}`) ?? null,
        absenceMode: store.getMeta(`absence_mode:${storyId}`) || null,
    };
}

export function summary(p) {
    return {
        name: p.name, savedAt: p.savedAt, setup: !!p.setup, people: p.cast?.length ?? 0,
        relations: p.relations?.人?.length ?? 0, pack: p.pack ?? null, absenceMode: p.absenceMode ?? null,
    };
}

// 套到这一局：名册按卡对（同一张卡），对不上按名字对；这一局名册里没有的人照样加进去（以后进群就认得）。
// 开局单存成新确认的一版（旧的留在历史里）；关系表、素材包、离开计时整个换掉。
export function applyPreset(store, storyId, p) {
    if (!p || p.v !== PRESET_VERSION) throw Object.assign(new Error('预设的格式不对'), { status: 400 });
    const have = store.getCast(storyId);
    const byAvatar = new Map(have.map(e => [e.avatar, e]));
    const warnings = [];
    const incoming = (p.cast ?? []).filter(e => {
        if (!isFace(e) || !have.some(h => !isFace(h) && h.name === e.name)) return true;
        warnings.push(`名册里的无卡人物${e.name}与已有卡同名，已跳过，没有覆盖卡。`);
        return false;
    });
    // 一张卡只认一条（杂务窗 9/30：预设里 4 张旧版同名卡按名字都落到主卡上，后写的"不用"盖掉了主卡）：
    // 先认卡文件对得上的；按名字对的排在后面，用着的、标了重点的先认，这张卡已经有人认了的就不再落上去（照原来的卡名留着，以后那张卡进来再认）
    const claimed = new Set(incoming.filter(e => byAvatar.has(e.avatar)).map(e => e.avatar));
    const rank = e => (byAvatar.has(e.avatar) ? 0 : e.role === '不用' ? 3 : e.priority ? 1 : 2);
    const entries = [...incoming].sort((a, b) => rank(a) - rank(b)).map(e => {
        if (byAvatar.has(e.avatar)) return { ...e };
        const to = have.find(h => h.name === e.name && isFace(h) === isFace(e))?.avatar;
        if (!to || claimed.has(to)) return { ...e };
        claimed.add(to);
        return { ...e, avatar: to };
    });
    if (entries.length) {
        store.putCast(storyId, entries.map(e => ({ avatar: e.avatar, name: e.name, ...(e.call !== undefined ? { call: e.call } : {}), ...(e.stranger !== undefined ? { stranger: strangerOf(e.stranger) } : {}), ...(e.gender !== undefined ? { gender: e.gender } : {}), ...(typeof e.群体 === 'boolean' ? { 群体: e.群体 } : {}), role: e.role, hook: e.hook, priority: e.priority, bond: e.bond })), { byUser: true });
        for (const e of entries) store.setInterests(storyId, e.avatar, e.interests ?? null);
    }
    if (p.setup) store.confirmSetup({ storyId, data: p.setup });
    if (p.relations) store.putRelations(storyId, p.relations, { by: 'preset' });
    store.setMeta(`pack:${storyId}`, p.pack || null);
    store.setMeta(`absence_mode:${storyId}`, p.absenceMode || null);
    return { ...(warnings.length ? { warnings } : {}), people: entries.length, setup: !!p.setup, relations: !!p.relations, pack: p.pack ?? null };
}

// 存在 <home>/presets/ 里，一份一个文件
export function createPresets({ home }) {
    const dir = path.join(home, 'presets');
    const file = name => path.join(dir, `${name}.json`);
    const read = f => { try { const p = JSON.parse(fs.readFileSync(f, 'utf8')); return p?.v === PRESET_VERSION ? p : null; } catch { return null; } };
    const bad = message => { throw Object.assign(new Error(message), { status: 400 }); };
    function list() {
        if (!fs.existsSync(dir)) return [];
        return fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => read(path.join(dir, f))).filter(Boolean)
            .map(summary).sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
    }
    function get(name) { return read(file(cleanName(name))); }
    function put(p) {
        const name = cleanName(p?.name);
        if (!name) bad('预设要起个名字');
        if (p.v !== PRESET_VERSION) bad('预设的格式不对');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(`${file(name)}.tmp`, JSON.stringify({ ...p, name }, null, 1));
        fs.renameSync(`${file(name)}.tmp`, file(name));
        return summary({ ...p, name });
    }
    function remove(name) { const f = file(cleanName(name)); if (fs.existsSync(f)) fs.unlinkSync(f); }
    // 套用前把这一局原来的样子存一份，不列在表里（套错了能找回）
    function backup(p) {
        const b = path.join(dir, '.套用前');
        fs.mkdirSync(b, { recursive: true });
        fs.writeFileSync(path.join(b, `${cleanName(p.name)}-${Date.now()}.json`), JSON.stringify(p, null, 1));
    }
    return { list, get, put, remove, backup };
}
