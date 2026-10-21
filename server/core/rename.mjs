// 角色改名：卡换了名字，头像文件名跟着换；ST 会把旧消息上的署名、头像一起改掉。
// 后台认一条消息靠"谁说的（头像文件名）＋说了什么"的指纹，改名以后这个人说过的每条都成了"没见过的新消息"：
// 记账、钉住的格子、余波、离开、规划全对不上，还会整段重抽。
// 这里把后台里这个人的旧头像名、旧名字、旧指纹一起换成新的——每张表每一格字都过一遍，不挑表，免得漏。
// 要在 ST 改名之前停掉后台、改完名再换、换完再开：中间要是同步进来了新指纹，就不动，让调用方先处理。
import { fingerprint } from './store.mjs';

const FP = /\b[0-9a-f]{32}\b/g;

export function renameSpeaker(db, { fromAvatar, toAvatar, fromName, toName }) {
    if (!fromAvatar || !toAvatar || !fromName || !toName) throw new Error('rename_needs_both_names');
    const mine = db.prepare('select story_id, fp, is_user, text from messages where speaker = ?').all(fromAvatar);
    const fps = new Map(mine.map(m => [m.fp, fingerprint(!!m.is_user, toAvatar, m.text)]));
    const known = db.prepare('select 1 from messages where story_id = ? and fp = ?');
    const clash = mine.filter(m => known.get(m.story_id, fps.get(m.fp)));
    if (clash.length) return { ok: false, clash: clash.length, messages: mine.length, changed: {} };
    // 旧名字是别人名字的一部分（"甲"和"甲乙"）：整格换字会把别人也改了，不做。
    const names = db.prepare('select distinct name from messages where name is not null union select distinct name from cast').all().map(r => r.name);
    const overlap = names.filter(n => n !== fromName && n.includes(fromName));
    if (overlap.length) return { ok: false, overlap, messages: mine.length, changed: {} };

    const swap = s => {
        let out = s.replace(FP, x => fps.get(x) ?? x);
        if (out.includes(fromAvatar)) out = out.split(fromAvatar).join(toAvatar);
        if (out.includes(fromName)) out = out.split(fromName).join(toName);
        return out;
    };
    const tables = db.prepare("select name from sqlite_master where type = 'table' and name not like 'sqlite_%'").all().map(t => t.name);
    const changed = {};
    db.exec('begin');
    try {
        for (const table of tables) {
            const cols = db.prepare(`pragma table_info("${table}")`).all().map(c => c.name);
            for (const row of db.prepare(`select rowid as _rid, * from "${table}"`).all()) {
                const set = {};
                for (const c of cols) if (typeof row[c] === 'string') { const v = swap(row[c]); if (v !== row[c]) set[c] = v; }
                const keys = Object.keys(set);
                if (!keys.length) continue;
                db.prepare(`update "${table}" set ${keys.map(k => `"${k}" = ?`).join(', ')} where rowid = ?`).run(...keys.map(k => set[k]), row._rid);
                changed[table] = (changed[table] ?? 0) + 1;
            }
        }
        db.exec('commit');
    } catch (error) {
        db.exec('rollback');
        throw error;
    }
    return { ok: true, messages: mine.length, changed };
}
