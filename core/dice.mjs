// 规划的骰子和母题账（白皮书 §5.7，D-100 C）：多样性只能来自程序掷骰＋用过的母题记账——"请发挥创意"出不来
// （实测两次各出 12 条，9 条母题重合；同一组骰子给两个模型，写出同一个点子）。
// 维度都是通用的，不带题材（D-37）；落到这一局里是什么样，由规划者换成说得通的样子。题材相关的底色在素材包的时事种子里。
import { createHash } from 'node:crypto';

export const DICE = {
    类别: ['人情往来', '钱', '身体', '街头小事', '势力动静', '意外', '温情', '笑料', '旧物', '新面孔', '误会', '手艺', '天气', '邻里', '传闻', '承诺到期', '小麻烦', '好运', '坏消息', '一个请求'],
    调性: ['轻松', '暖', '荒诞', '紧张', '悬着不落地', '苦中作乐', '尴尬', '安静', '好笑又心酸'],
    尺度: ['一句话的小事', '半天的事', '拖几天的事'],
    物件: ['一把没人认领的伞', '一张过期的票', '一只走丢的动物', '一件坏掉的家什', '一封送错的信', '一件借出去没还的东西', '一段留下来的话', '一张旧照片',
        '一个没拆的包裹', '一盆快死的植物', '一把备用钥匙', '一件不合身的衣服', '一封陌生人的来信或口信', '一份做多了的饭', '一块停了的表', '一个上锁的盒子',
        '一张写了一半的清单', '一枚不认识的硬币或筹码', '一件修了又坏的东西', '一双别人的鞋'],
    地点: ['家里', '邻居家', '街上', '店里', '路上', '常去的地方', '没去过的地方', '城外'],
};

const pick = (seed, key, list) => list[parseInt(createHash('sha256').update(`${seed}:${key}`).digest('hex').slice(0, 8), 16) % list.length];

// 掷 n 组，每组五个面；同一个 seed 掷出来一样（"再试一次"、重启补包时简报不变）。
export function rollDice(seed, n = 3) {
    return Array.from({ length: n }, (_, i) => Object.fromEntries(Object.entries(DICE).map(([dim, list]) => [dim, pick(seed, `${i}:${dim}`, list)])));
}

export function diceLines(dice) {
    return dice.map(d => `· ${d.类别} × ${d.调性} × ${d.尺度} × ${d.物件} × ${d.地点}`);
}

// 用过的母题：这一局出过的事（之前几份规划里露过面的，加上眼下这份排着的），按母题数一数，多的在前。
export function motifLedger(menu) {
    const counts = new Map();
    for (const m of menu) {
        const k = String(m.motif ?? '').trim();
        if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    return [...counts].map(([motif, n]) => ({ motif, n })).sort((a, b) => b.n - a.n || a.motif.localeCompare(b.motif));
}
