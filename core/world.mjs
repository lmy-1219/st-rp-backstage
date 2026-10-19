// 世界的底色（白皮书 §5.7"世界质感"、O-20；J-45 时事种子）：题材包里写好的一批世界时事，程序掷骰，
// 每个剧情日至多一条，递给那天第一个开口的人：场面松的时候可以让它从新闻、广播、路人闲聊或谁的一句话里冒出来，对不上就当没看见。
// 同一局里用过的不再用（出过的母题进账）；年头按这一局的年份算（"五年前"），没有年份就只写发生的年份。
// ⛔ 不是任务、不是本轮必须写的事；和菜单口袋、来联系在同一轮时让位。
import fs from 'node:fs';
import { parseCsv } from './advisor.mjs';
import { roll } from './planner.mjs';
import { dateOf, eraDate } from './timeline.mjs';
import { scaleOf, cnCount } from './timescale.mjs';

// 只认开头的连续年份及数字月日；括号说明不参与推断精度。
function seedDate(text) {
    if (text.startsWith('开局前')) return { year: null, month: null, day: null, before: true };
    const after = /^开局后(?:约)?([0-9０-９零〇一二两三四五六七八九十百千万]+)(天|日|个月|月|年)/.exec(text);
    if (after) {
        const n = cnCount(after[1]);
        const unit = after[2] === '日' ? '天' : after[2] === '个月' ? '月' : after[2];
        if (Number.isFinite(n) && n >= 0) return { year: null, month: null, day: null, after: { n, unit } };
    }
    const match = /^(\d{1,5})(?!\d)(?:-(\d{1,2})(?!\d)(?:-(\d{1,2})(?!\d))?)?/.exec(text);
    const year = match ? Number(match[1]) || null : null;
    const month = year && Number(match[2]) >= 1 && Number(match[2]) <= 12 ? Number(match[2]) : null;
    const day = month && Number(match[3]) >= 1 && Number(match[3]) <= 31 ? Number(match[3]) : null;
    // 不合法的日降为月精度，不把不存在的日期当成已经发生。
    const date = day == null ? null : dateOf(`${year}-${month}-${day}`);
    return { year, month, day: date?.y === year && date.m === month && date.d === day ? day : null };
}

// 种子表：CSV，列名认"时间／一句话／地点／调性／谁会提起／领域"，缺的列留空。
export function loadSeeds(file) {
    const [header, ...rows] = parseCsv(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
    const at = name => header.indexOf(name);
    const col = (r, name) => (at(name) >= 0 ? String(r[at(name)] ?? '').trim() : '');
    return rows.map((r, i) => ({ i, ...seedDate(col(r, '时间')), text: col(r, '一句话'), place: col(r, '地点'), tone: col(r, '调性'), who: col(r, '谁会提起'), field: col(r, '领域') }))
        .filter(s => s.text);
}

// 优先用开局日期；没写日期才沿用“开场”里的四位年份。
export function storyYear(setup) {
    const date = dateOf(setup?.时间?.日期, 0, { week: false });
    if (date) return date.y;
    const y = String(setup?.开场 ?? '').match(/(?<!\d)(\d{4})(?!\d)/)?.[1];
    return y ? Number(y) : null;
}

const ago = (year, now) => {
    if (!year || !now || year > now) return null;
    const n = now - year;
    return n === 0 ? '就是今年' : `${n} 年前`;
};

// 今天给不给、给哪条：同一局同一个剧情日只掷一次（可复现），两次里一次给；挑这一局还没用过的。
export function pickSeed(seeds, { key, used = [], now = null, elapsed = null }) {
    const left = (seeds ?? []).filter(s => !used.includes(s.i)).filter(s => happened(s, now, elapsed));
    if (!left.length || roll(`${key}:world`, 2) !== 0) return null;
    return left[roll(`${key}:seed`, left.length)];
}

// 相对档独立按开局后格数判定；这里只用30/360天，不改全局的elapsedUnits。
const SEED_DAYS = { 天: 1, 月: 30, 年: 360 };
function happened(seed, now, elapsed) {
    if (seed.before) return true;
    if (seed.after) {
        if (!Number.isFinite(elapsed?.today)) return false;
        const scale = scaleOf(elapsed.timeScale);
        const days = SEED_DAYS[scale.unit] ?? scale.days;
        const units = Math.ceil(seed.after.n * SEED_DAYS[seed.after.unit] / days);
        return elapsed.today >= units;
    }
    if (seed.year == null) return true;
    if (now?.y == null) return false;
    if (seed.year !== now.y) return seed.year < now.y;
    if (seed.month == null || now.m == null) return false;
    if (seed.month !== now.m) return seed.month < now.m;
    return seed.day != null && now.d != null && seed.day <= now.d;
}

export function seedLines(seed, { year = null, start = null } = {}) {
    const when = [seed.year ? (eraDate(start, { y: seed.year, m: seed.month, d: seed.day }) ?? `${seed.year} 年`) : null, ago(seed.year, year)].filter(Boolean).join('，');
    return [
        '世界的底色（可用可不用：场面松的时候，可以让它从传闻、路人闲聊或谁的一句话里冒出来（按这个世界传消息的方式）；正说到要紧处、对不上场面，就当没看见）：',
        `· ${seed.text}${[when, seed.place].filter(Boolean).length ? `（${[when, seed.place].filter(Boolean).join('，')}）` : ''}${seed.who ? `  常会提起它的：${seed.who}` : ''}`,
    ];
}
