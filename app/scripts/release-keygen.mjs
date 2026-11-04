// 生成在线更新的签名密钥（只需要一次）。私钥放在本机 ~/.china-law-search/release-key.pem，不进仓库；
// 公钥写进 shell/release-public-key.pem，随安装包分发。换密钥后旧安装包就收不到新更新了，所以私钥要备份好。
import { generateKeyPairSync } from "node:crypto";
import { writeFileSync, mkdirSync, existsSync, chmodSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.join(os.homedir(), ".china-law-search");
const priv = path.join(dir, "release-key.pem");
if (existsSync(priv) && !process.argv.includes("--force")) {
  console.log(`私钥已存在：${priv}（要重新生成请加 --force，旧安装包将无法验证新签名）`);
  process.exit(0);
}
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
mkdirSync(dir, { recursive: true, mode: 0o700 });
writeFileSync(priv, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
chmodSync(priv, 0o600);
const pub = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "shell", "release-public-key.pem");
writeFileSync(pub, publicKey.export({ type: "spki", format: "pem" }));
console.log(`私钥：${priv}\n公钥：${pub}`);
