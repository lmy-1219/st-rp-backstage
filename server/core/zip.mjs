// 只读 ZIP 中央目录；不执行归档中的代码，不跟随链接。无第三方依赖。
import fs from 'node:fs';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';

export const ZIP_MAX_BYTES = 300 * 1024 * 1024;
export const ZIP_MAX_FILES = 5000;
const fail = message => { throw Object.assign(new Error(message), { status: 400 }); };
const ENCODING_ERROR = '压缩包里的中文文件名读不出来，请用 7-Zip 或 Bandizip 压成 zip（勾 UTF-8）再试，或者改用 git 地址。';
const table = Array.from({ length: 256 }, (_, n) => { for (let i = 0; i < 8; i++) n = (n >>> 1) ^ ((n & 1) ? 0xedb88320 : 0); return n >>> 0; });
export function zipCrc32(data) { let n = 0xffffffff; for (const b of data) n = table[(n ^ b) & 255] ^ (n >>> 8); return (n ^ 0xffffffff) >>> 0; }
function decodeName(bytes, utf8) {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { if (utf8) fail(ENCODING_ERROR); }
    try { return new TextDecoder('gbk', { fatal: true }).decode(bytes); } catch { fail(ENCODING_ERROR); }
}
function safeName(name) {
    if (!name || /[\\\x00-\x1f:]/.test(name) || name.startsWith('/') || name.split('/').some(p => p === '..' || p === '.' || /[. ]$/.test(p))) fail('压缩包有不安全路径');
    return name;
}

export function extractZip(data, target, { maxBytes = ZIP_MAX_BYTES, maxFiles = ZIP_MAX_FILES } = {}) {
    const zip = Buffer.isBuffer(data) ? data : fs.readFileSync(data);
    if (zip.length > ZIP_MAX_BYTES) fail('包太大');
    const range = (offset, size, end = zip.length) => { if (!Number.isSafeInteger(offset) || offset < 0 || size < 0 || offset + size > end) fail('压缩包损坏'); };
    let eocd = -1;
    for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65557); i--) if (zip.readUInt32LE(i) === 0x06054b50 && i + 22 + zip.readUInt16LE(i + 20) === zip.length) { eocd = i; break; }
    if (eocd < 0) fail('不是完整的 zip 压缩包');
    const count = zip.readUInt16LE(eocd + 10), cdSize = zip.readUInt32LE(eocd + 12), cd = zip.readUInt32LE(eocd + 16);
    if (count === 0xffff || cdSize === 0xffffffff || cd === 0xffffffff || (eocd >= 20 && zip.readUInt32LE(eocd - 20) === 0x07064b50)) fail('包太大（不支持 zip64）');
    if (zip.readUInt16LE(eocd + 4) || zip.readUInt16LE(eocd + 6) || zip.readUInt16LE(eocd + 8) !== count) fail('不支持分卷 zip');
    if (count > maxFiles) fail('压缩包文件超过上限');
    range(cd, cdSize, eocd);
    const entries = [], names = new Set(); let at = cd, bytes = 0;
    for (let i = 0; i < count; i++) {
        range(at, 46, cd + cdSize); if (zip.readUInt32LE(at) !== 0x02014b50) fail('压缩包目录损坏');
        const flags = zip.readUInt16LE(at + 8), method = zip.readUInt16LE(at + 10), crc = zip.readUInt32LE(at + 16), compressed = zip.readUInt32LE(at + 20), size = zip.readUInt32LE(at + 24), nl = zip.readUInt16LE(at + 28), el = zip.readUInt16LE(at + 30), cl = zip.readUInt16LE(at + 32), offset = zip.readUInt32LE(at + 42), mode = zip.readUInt32LE(at + 38) >>> 16;
        range(at, 46 + nl + el + cl, cd + cdSize);
        if ([size, compressed, offset].includes(0xffffffff) || zip.readUInt16LE(at + 34)) fail('包太大（不支持 zip64）');
        for (let p = at + 46 + nl; p + 4 <= at + 46 + nl + el;) { const id = zip.readUInt16LE(p), len = zip.readUInt16LE(p + 2); if (id === 1) fail('包太大（不支持 zip64）'); p += 4 + len; if (p > at + 46 + nl + el) fail('压缩包目录损坏'); }
        if ((mode & 0xf000) === 0xa000) fail('压缩包不能包含符号链接');
        if ((mode & 0xf000) && ![0x8000, 0x4000].includes(mode & 0xf000)) fail('压缩包有不支持的文件类型');
        if (flags & 1) fail('不支持加密 zip');
        if (![0, 8].includes(method)) fail('这个压缩包用了不支持的压缩方式，请用系统自带的“压缩为 zip”重新压一次');
        const rawName = zip.subarray(at + 46, at + 46 + nl), name = safeName(decodeName(rawName, !!(flags & 0x800))), directory = name.endsWith('/');
        const key = name.replace(/\/$/, '').toLowerCase(); if (names.has(key)) fail('压缩包有重复文件名'); names.add(key);
        bytes += size; if (bytes > maxBytes) fail('压缩包解压后超过大小上限');
        range(offset, 30, cd); if (zip.readUInt32LE(offset) !== 0x04034b50) fail('压缩包本地头损坏');
        const ln = zip.readUInt16LE(offset + 26), le = zip.readUInt16LE(offset + 28), start = offset + 30 + ln + le;
        range(offset, 30 + ln + le, cd); range(start, compressed, cd);
        if (zip.readUInt16LE(offset + 6) !== flags || zip.readUInt16LE(offset + 8) !== method || !zip.subarray(offset + 30, offset + 30 + ln).equals(rawName)) fail('压缩包文件头不一致');
        entries.push({ name, directory, size, crc, start, compressed, method }); at += 46 + nl + el + cl;
    }
    if (at !== cd + cdSize) fail('压缩包目录大小不一致');
    if (fs.existsSync(target)) fail('解压目标已存在');
    let made = false;
    try {
        fs.mkdirSync(target, { recursive: true }); made = true;
        for (const e of entries) {
            if (e.name.split('/').at(-1).toLowerCase() === 'secrets.json') continue;
            const out = path.join(target, ...e.name.split('/'));
            if (e.directory) { fs.mkdirSync(out, { recursive: true }); continue; }
            const input = zip.subarray(e.start, e.start + e.compressed);
            // 原样项的压缩／解压大小也必须一致。
            const decoded = e.method === 0 ? input : inflateRawSync(input, { maxOutputLength: Math.max(1, e.size) });
            if (decoded.length !== e.size || zipCrc32(decoded) !== e.crc) fail('压缩包内容校验失败');
            fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, decoded, { flag: 'wx' });
        }
        return { files: entries.filter(e => !e.directory && path.basename(e.name).toLowerCase() !== 'secrets.json').length, bytes };
    } catch (error) { if (made) fs.rmSync(target, { recursive: true, force: true }); throw Object.assign(error, { status: 400 }); }
}
