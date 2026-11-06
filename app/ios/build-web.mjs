// 生成 iOS App 里的网页部分（ios/App/Web/）：界面（renderer/）+ 打包好的服务端代码（boot.js）+ pdf.js。
// 运行：npm run ios:web（Xcode 构建时也会自动运行）
import { build } from "esbuild";
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, rmSync, cpSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(APP, "ios/web-src");
const OUT = path.join(APP, "ios/App/Web");
const require = createRequire(import.meta.url);
const PDFJS = path.dirname(require.resolve("pdfjs-dist/package.json"));

// 服务端代码运行时读取的文件：放进内置的只读文件表（键是 /app/ 开头的路径，和 import.meta.url 换算出来的一致）
function walk(dir) {
  return readdirSync(dir).flatMap((f) => { const p = path.join(dir, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
}
function vfs() {
  const files = [...walk(path.join(APP, "server/ai/roster")), ...walk(path.join(APP, "server/ai/tasks")), path.join(APP, "server/ai/scenarios.json")];
  const map = {};
  for (const f of files) if (/\.(md|json|txt)$/.test(f)) map["/app/" + path.relative(APP, f).split(path.sep).join("/")] = readFileSync(f, "utf-8");
  return map;
}

const shim = (n) => path.join(SRC, "shims", n);
const ALIAS = {
  "node:fs": shim("fs.mjs"), fs: shim("fs.mjs"), "node:fs/promises": shim("fs.mjs"),
  "node:sqlite": shim("sqlite.mjs"),
  "node:zlib": shim("zlib.mjs"), zlib: shim("zlib.mjs"),
  "node:path": require.resolve("path-browserify"), path: require.resolve("path-browserify"),
  events: require.resolve("events/"), "node:events": require.resolve("events/"),
  stream: require.resolve("stream-browserify"), "node:stream": require.resolve("stream-browserify"),
  util: require.resolve("util/"), "node:util": require.resolve("util/"),
  ...Object.fromEntries(["crypto", "url", "module", "os", "child_process", "http", "worker_threads", "stream/promises"].flatMap((m) => [[`node:${m}`, shim("misc.mjs")], [m, shim("misc.mjs")]])),
};

const plugins = [{
  name: "ios",
  setup(b) {
    b.onResolve({ filter: /^virtual:vfs$/ }, () => ({ path: "vfs", namespace: "vfs" }));
    b.onLoad({ filter: /.*/, namespace: "vfs" }, () => ({ contents: `export const VFS = ${JSON.stringify(vfs())};`, loader: "js" }));
    for (const [from, to] of Object.entries(ALIAS)) {
      const re = new RegExp(`^${from.replace(/[/.]/g, "\\$&")}$`);
      b.onResolve({ filter: re }, () => ({ path: to }));
    }
    // 服务端代码用 import.meta.url 找自己旁边的文件；换成它在内置文件表里的路径
    b.onLoad({ filter: /[\\/]app[\\/]server[\\/].*\.mjs$/ }, (args) => {
      const rel = path.relative(APP, args.path).split(path.sep).join("/");
      const src = readFileSync(args.path, "utf-8").replace(/import\.meta\.url/g, JSON.stringify("file:///app/" + rel));
      return { contents: src, loader: "js", resolveDir: path.dirname(args.path) };
    });
  },
}];

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const r = await build({
  entryPoints: [path.join(SRC, "boot.mjs")],
  bundle: true, format: "esm", platform: "browser", target: ["safari16"],
  outfile: path.join(OUT, "boot.js"), plugins,
  define: { WebSocket: "globalThis.__NativeWebSocket", "process.env.NODE_ENV": '"production"' },
  loader: { ".json": "json" },
  mainFields: ["browser", "module", "main"],
  conditions: ["browser", "import"],
  logLevel: "warning", minify: true, sourcemap: false, legalComments: "none",
  metafile: true,
});

// 界面：桌面版的 renderer，换掉脚本入口，加手机布局
const R = path.join(APP, "renderer");
for (const f of ["app.js", "shortcuts.js", "style.css", "dictation-worklet.js"]) cpSync(path.join(R, f), path.join(OUT, f));
cpSync(path.join(SRC, "ios.css"), path.join(OUT, "ios.css"));
let html = readFileSync(path.join(R, "index.html"), "utf-8");
html = html
  .replace(/<meta name="viewport"[^>]*>/, '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover">')
  .replace(/script-src 'self'/, "script-src 'self' 'unsafe-eval'; connect-src 'self' blob: data:")
  .replace('<link rel="stylesheet" href="style.css">', '<link rel="stylesheet" href="style.css">\n<link rel="stylesheet" href="ios.css">')
  .replace(/<script src="shortcuts\.js"><\/script>\s*<script src="app\.js"><\/script>/, '<script type="module" src="boot.js"></script>')
  .replace("<body ", '<body data-platform="ios" ')
  .replace(/第一次打开需要解压法规数据并建立全文索引，大约一两分钟。/, "第一次打开要下载约 110 MB 的法规数据并在手机上建立全文索引，大约 2–5 分钟，请保持 App 在前台。");
if (!html.includes('src="boot.js"')) throw new Error("index.html 里没找到脚本入口");
writeFileSync(path.join(OUT, "index.html"), html);

// pdf.js（界面渲染扫描件用 build/pdf.min.mjs，服务端解析用打包进 boot.js 的 legacy 版）
for (const d of ["build/pdf.min.mjs", "build/pdf.worker.min.mjs", "cmaps", "standard_fonts"]) cpSync(path.join(PDFJS, d), path.join(OUT, "vendor/pdfjs", d), { recursive: true });

const kb = (f) => Math.round(statSync(path.join(OUT, f)).size / 1024);
console.log(`iOS 网页部分已生成：boot.js ${kb("boot.js")} KB，index.html ${kb("index.html")} KB`);
for (const w of r.warnings) console.log("警告：", w.text);
