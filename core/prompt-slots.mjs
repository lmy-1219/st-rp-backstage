// 口味段位和数据目录里的口味包。默认文字由原提示词模块登记，契约仍由原模块持有。
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';

export const CONTENT_TIERS = Object.freeze(['SFW', '剧情向NSFW', '纯NSFW']);
export const DEFAULT_TIER = '剧情向NSFW';
const adult = CONTENT_TIERS.slice(1);
const descriptors = [
    ['plan.dare', '规划·敢'], ['plan.shape', '规划·怎么排才好看'], ['plan.alive', '规划·角色是活的'],
    ['plan.intimate', '规划·亲密线', adult], ['pocket.intimate', '前台·亲密口袋', adult],
    ['intimate.consent', '亲密线·固定边界', adult, false], ['extract.intro', '记账·故事导语'],
    ...['claude', 'gemini', 'deepseek', 'doubao'].map(f => [`taste.plan.${f}`, `规划·${f}`]),
    ...['claude', 'gemini', 'gemini-4', 'deepseek', 'doubao'].map(f => [`taste.act.${f}`, `前台·${f}`]),
    ...['claude', 'gemini', 'deepseek', 'doubao'].map(f => [`taste.camera.${f}`, `旁白·${f}`]),
];
const defaults = new Map();
const tierDefaults = new Map();
const lockedFragments = new Map();
export const PROMPT_SLOTS = Object.freeze(descriptors.map(([id, stage, tiers = CONTENT_TIERS, editable = true]) => Object.freeze({ id, stage, tiers: Object.freeze([...tiers]), editable })));
const byId = new Map(PROMPT_SLOTS.map(s => [s.id, s]));
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };

// 只在系统模块加载时登记；包读写永远不能走这个入口或改默认值。
export function registerPromptDefaults(values, contracts = {}, byTier = {}) {
    for (const [id, text] of Object.entries(values)) {
        if (!byId.has(id) || typeof text !== 'string') throw new Error('invalid prompt default');
        if (defaults.has(id) && defaults.get(id) !== text) throw new Error('prompt default already registered');
        defaults.set(id, text);
    }
    for (const [id, parts] of Object.entries(contracts)) lockedFragments.set(id, Object.freeze([...parts]));
    for (const [tier, entries] of Object.entries(byTier)) {
        if (!CONTENT_TIERS.includes(tier)) throw new Error('invalid prompt tier');
        validateParagraphs(entries);
        for (const [id, text] of Object.entries(entries)) {
            if (!byId.has(id) || typeof text !== 'string') throw new Error('invalid prompt default');
            const key = `${tier}:${id}`;
            if (tierDefaults.has(key) && tierDefaults.get(key) !== text) throw new Error('prompt default already registered');
            tierDefaults.set(key, text);
        }
    }
}
export function allowedTiers(config = {}) {
    const requested = config?.content?.tiers;
    const tiers = requested === undefined ? [...CONTENT_TIERS] : Array.isArray(requested) ? CONTENT_TIERS.filter(t => requested.includes(t)) : [];
    return tiers.length ? tiers : ['SFW'];
}
export function tierOf(config = {}, setup = null) {
    const tiers = allowedTiers(config);
    return tiers.includes(setup?.档位) ? setup.档位 : tiers.includes(config?.content?.defaultTier) ? config.content.defaultTier : tiers.includes(DEFAULT_TIER) ? DEFAULT_TIER : tiers[0];
}
export function validateParagraphs(paragraphs = {}) {
    if (!paragraphs || typeof paragraphs !== 'object' || Array.isArray(paragraphs)) fail('段落要是编号与文字的对应表');
    const clean = {}, warnings = [];
    for (const [id, text] of Object.entries(paragraphs)) {
        const slot = byId.get(id);
        if (!slot) { warnings.push(`没有这个段位，已跳过：${id}`); continue; }
        if (!slot.editable) fail(`这个段位不能改：${id}`);
        if (typeof text !== 'string' || text.length > 50000) fail(`段落要是五万字以内的文字：${id}`);
        let at = 0;
        for (const fixed of lockedFragments.get(id) ?? []) {
            const i = text.indexOf(fixed, at);
            if (i < 0) fail(`固定格式不能改：${id}（${fixed}）`);
            at = i + fixed.length;
        }
        clean[id] = text;
    }
    return { paragraphs: clean, warnings };
}
const SFW_INTRO = '这是虚构故事，可能有冲突、伤病；记账只记事实，不复述细节。';
const ACT_INTIMATE = '亲密和冲突照这一局的口径写、写到为止，不用提醒对方分寸。';
export function defaultPrompt(id, tier = DEFAULT_TIER) {
    const slot = byId.get(id);
    if (!slot) throw new Error(`unknown prompt slot: ${id}`);
    if (!slot.tiers.includes(tier)) return '';
    const text = tierDefaults.get(`${tier}:${id}`) ?? defaults.get(id);
    if (text === undefined) throw new Error(`prompt default not registered: ${id}`);
    return tier === 'SFW' && id === 'extract.intro' ? SFW_INTRO : tier === 'SFW' && id === 'taste.act.claude' ? text.replace(ACT_INTIMATE, '') : text;
}
export const promptTier = options => tierOf(options.config, { ...options.setup, ...(CONTENT_TIERS.includes(options.tier) ? { 档位: options.tier } : {}) });
export function promptText(id, options = {}) {
    const tier = promptTier(options);
    const base = defaultPrompt(id, tier), slot = byId.get(id);
    if (!slot.tiers.includes(tier) || !slot.editable) return base;
    const value = options.paragraphs?.[id];
    if (typeof value !== 'string') return base;
    // 包经过相同的核对；调用方直接给的覆盖也不能绕过固定格式。
    validateParagraphs({ [id]: value });
    return tier === 'SFW' && id === 'taste.act.claude' ? value.replace(ACT_INTIMATE, '') : value;
}
export function slotTable(options = {}) {
    const tier = promptTier(options);
    return PROMPT_SLOTS.map(s => ({ ...s, active: s.tiers.includes(tier), defaultText: defaultPrompt(s.id, tier), text: promptText(s.id, { ...options, tier }), contracts: lockedFragments.get(s.id) ?? [] }));
}
export const DEFAULT_PACK = 'default';
const builtin = () => ({ id: DEFAULT_PACK, manifest: { 名字: '系统默认', 版本: 1, 适用档位: [...CONTENT_TIERS], 说明: '随系统提供；编辑时另存为自己的包。' }, paragraphs: {}, builtin: true });
export function createPromptPacks(home) {
    const root = path.resolve(home, 'prompt-packs');
    const packPath = id => {
        if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(id) || id === DEFAULT_PACK) fail('口味包编号不对');
        const target = path.resolve(root, id);
        if (path.dirname(target) !== root) fail('口味包路径不对');
        if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) fail('口味包目录不能是链接');
        return target;
    };
    const normalize = raw => {
        const m = raw?.manifest ?? raw?.清单;
        if (!m || typeof m.名字 !== 'string' || !m.名字.trim() || m.名字.length > 80 || !Number.isInteger(m.版本) || m.版本 < 1) fail('清单要有名字和正整数版本');
        const tiers = CONTENT_TIERS.filter(t => Array.isArray(m.适用档位) && m.适用档位.includes(t));
        if (!tiers.length) fail('清单要写适用档位');
        const v = validateParagraphs(raw.paragraphs ?? raw.段落 ?? {});
        return { manifest: { 名字: m.名字, 版本: m.版本, 适用档位: tiers, 说明: typeof m.说明 === 'string' ? m.说明.slice(0, 2000) : '' }, ...v };
    };
    function read(id = DEFAULT_PACK) {
        if (id === DEFAULT_PACK) return builtin();
        const dir = packPath(id);
        const manifest = JSON.parse(fs.readFileSync(path.join(dir, '清单.json'), 'utf8'));
        const paragraphs = JSON.parse(fs.readFileSync(path.join(dir, '段落.json'), 'utf8'));
        return { id, ...normalize({ manifest, paragraphs }), builtin: false };
    }
    function list() {
        if (!fs.existsSync(root)) return [builtin()];
        return [builtin(), ...fs.readdirSync(root, { withFileTypes: true }).filter(e => e.isDirectory() && !e.isSymbolicLink()).flatMap(e => {
            try { return [read(e.name)]; } catch { return []; }
        })];
    }
    function write(raw, { id = null, mode = null } = {}) {
        if (id === DEFAULT_PACK) fail('系统默认包不能改，请先另存');
        const value = normalize(raw);
        const same = list().find(p => !p.builtin && p.manifest.名字 === value.manifest.名字);
        if (same && same.id !== id && !['overwrite', 'copy'].includes(mode)) return { conflict: true, existing: same.id, name: same.manifest.名字 };
        if (same && mode === 'overwrite') id = same.id;
        if (!id || mode === 'copy') id = `pack-${randomUUID()}`;
        if (same && mode === 'copy') {
            const names = new Set(list().map(p => p.manifest.名字));
            let i = 2; const name = value.manifest.名字;
            while (names.has(`${name}（${i}）`)) i++;
            value.manifest.名字 = `${name}（${i}）`;
        }
        const dir = packPath(id); fs.mkdirSync(dir, { recursive: true });
        for (const [file, data] of [['清单.json', value.manifest], ['段落.json', value.paragraphs]]) {
            const target = path.join(dir, file);
            if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) fail('口味包文件不能是链接');
            fs.writeFileSync(`${target}.tmp`, JSON.stringify(data, null, 2) + '\n'); fs.renameSync(`${target}.tmp`, target);
        }
        return { ...read(id), warnings: value.warnings };
    }
    const exportPack = id => { const p = read(id); return { 清单: p.manifest, 段落: p.paragraphs }; };
    return { read, list, write, exportPack };
}

const environments = new WeakMap();
export function bindPromptEnvironment(store, { home = null, getConfig = () => ({}) } = {}) {
    const environment = { home, getConfig, packs: home ? createPromptPacks(home) : null };
    environments.set(store, environment); return environment;
}
export function promptEnvironmentFor(store) { return environments.get(store) ?? null; }
export function setGlobalPromptPack(store, id) {
    const env = environments.get(store);
    if (!env?.home || !env.packs) fail('口味包目录还没接好');
    env.packs.read(id);
    const file = path.join(env.home, 'config.json');
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    raw.content = { ...raw.content, pack: id };
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(raw, null, 2) + '\n'); fs.renameSync(`${file}.tmp`, file);
}
export function promptOptionsFor(store, chatKey, config = null) {
    const env = environments.get(store);
    config ??= env?.getConfig() ?? {};
    const storyId = store.requireChat(chatKey).story_id;
    const setup = store.setupOf?.(storyId)?.data ?? {};
    const tier = tierOf(config, setup);
    const selected = store.getMeta?.(`prompt_pack:${storyId}`) || config.content?.pack || DEFAULT_PACK;
    let pack = builtin(), warning = '';
    try { pack = env?.packs?.read(selected) ?? builtin(); }
    catch { warning = '所选口味包读不出来，暂用系统默认；原包保留。'; }
    if (!pack.manifest.适用档位.includes(tier)) { warning = '这个包不适用于当前档位，暂用系统默认。'; pack = builtin(); }
    const version = createHash('sha256').update(JSON.stringify([tier, pack.id, pack.paragraphs])).digest('hex').slice(0, 16);
    return { config, setup, tier, paragraphs: pack.paragraphs, pack: pack.id, selected, warning, version };
}
