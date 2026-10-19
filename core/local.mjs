// 本机路径与后台清单只读 local.json；文件缺失才用空配置，坏配置不能让生产保护静默失效。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_PORT = 8019;
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function readLocal(root = repo) {
    let raw;
    try { raw = JSON.parse(fs.readFileSync(path.join(root, 'local.json'), 'utf8')); }
    catch (e) {
        if (e.code === 'ENOENT') return { productionSt: [], backends: [], devSt: '' };
        throw new Error('local.json 读不了，请检查本机配置', { cause: e });
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)
        || (raw.productionSt !== undefined && (!Array.isArray(raw.productionSt) || raw.productionSt.some(p => typeof p !== 'string' || !p.trim())))
        || (raw.devSt !== undefined && typeof raw.devSt !== 'string')
        || (raw.backends !== undefined && (!Array.isArray(raw.backends) || raw.backends.some(b => !b || typeof b.名 !== 'string' || !Number.isInteger(b.port) || b.port < 1 || b.port > 65535)))) {
        throw new Error('local.json 格式不对，请检查 productionSt、devSt 和 backends');
    }
    return {
        productionSt: (raw.productionSt ?? []).map(p => path.resolve(root, p)),
        backends: (raw.backends ?? []).map(b => ({ 名: b.名, port: b.port })),
        devSt: raw.devSt?.trim() ? path.resolve(root, raw.devSt) : '',
    };
}
