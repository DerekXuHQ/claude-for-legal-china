// node:zlib 的 iOS 替身（纯 JS，fflate）
import { Buffer } from "buffer";
import { zlibSync, unzlibSync, gunzipSync as gunz, gzipSync as gz, inflateSync as infl, deflateSync as defl } from "fflate";

const u8 = (b) => (b instanceof Uint8Array ? b : new Uint8Array(b));
export const deflateSync = (b, o = {}) => Buffer.from(zlibSync(u8(b), { level: o.level ?? 6 }));
export const inflateSync = (b) => Buffer.from(unzlibSync(u8(b)));
export const deflateRawSync = (b, o = {}) => Buffer.from(defl(u8(b), { level: o.level ?? 6 }));
export const inflateRawSync = (b) => Buffer.from(infl(u8(b)));
export const gunzipSync = (b) => Buffer.from(gunz(u8(b)));
export const gzipSync = (b) => Buffer.from(gz(u8(b)));
export const createGunzip = () => { throw new Error("iOS 版不支持流式解压"); };
export default { deflateSync, inflateSync, deflateRawSync, inflateRawSync, gunzipSync, gzipSync, createGunzip };
