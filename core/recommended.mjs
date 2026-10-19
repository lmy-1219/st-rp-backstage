// 推荐配置（体检 9/29）：全新的数据目录里什么都没配——各环节没有型号，叙事组装、参谋是关的，每日上限只有 3 美元——
// 和在测试副本里真跑过的那一套不是一回事。这里是真跑过的那一套：哪个环节用哪个型号、按什么价记账、哪些功能开着。
// 钥匙不在这里：各环节写的是钥匙簿里的名字（KEY_NAMES），用户在面板的钥匙簿里照这几个名字存，用到它的环节就通了。
// 中转上一把钥匙常常只开一家的模型，所以按家分：一把调 Claude 的、一把调 Gemini 的、一把调向量的（向量那把后台自己认，不用名字）。
export const KEY_NAMES = { claude: 'Claude', gemini: 'Gemini' };

import modelData from './models.json' with { type: 'json' };

export const RECOMMENDED = modelData.recommended;

const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
const blank = v => v === undefined || v === null || v === '';

// 把推荐配置补进现有配置：现有的（用户填过、改过的）一律不动，只补没有的；钥匙、钥匙簿、测过的记录不碰。
// 返回补好的配置和补了哪些（给人看）。
export function withRecommended(raw = {}, rec = RECOMMENDED) {
    const added = [];
    const merge = (have, want, trail) => {
        const out = isObj(have) ? { ...have } : {};
        for (const [k, v] of Object.entries(want)) {
            const at = [...trail, k].join('.');
            if (isObj(v)) { out[k] = merge(out[k], v, [...trail, k]); continue; }
            if (blank(out[k])) { out[k] = v; added.push(at); }
        }
        return out;
    };
    return { config: merge(raw, rec, []), added };
}
