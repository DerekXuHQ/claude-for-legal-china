// 启动器（外壳的一部分，在线更新换不了）：决定这次加载哪个版本的程序。
// 有下载好的候选版本就试运行一次；有已确认的当前版本就用它；都没有或校验不过就用安装包自带的版本。
// 做法沿用 CopyDeck 的 boot.mjs。
import { app, dialog } from "electron";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ReleaseState } from "./shell/release-state.mjs";
import { verifyAssembled } from "./shell/updater.mjs";

const builtin = dirname(fileURLToPath(import.meta.url));

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  const updatesDir = join(app.getPath("userData"), "updates");
  const state = new ReleaseState({ dir: updatesDir });
  // 从源码运行的开发版不加载下载的更新（设 CLS_DEV_RELEASES=1 可以测试更新流程）
  const dev = !app.isPackaged && !process.env.CLS_DEV_RELEASES;
  let selected = dev ? { load: null, sequence: 0, trial: false } : state.beginBoot();
  // 新装的安装包自带的版本不比下载的旧（重装或换了新安装包之后）：直接用自带的
  try {
    const base = JSON.parse(readFileSync(join(builtin, "package.json"), "utf8")).updateSequence || 0;
    if (selected.load && selected.sequence <= base) selected = { load: null, sequence: 0, trial: false, builtinNewer: true };
  } catch { /* 读不到就按原选择 */ }
  for (let attempt = 0; selected.load && attempt < 3; attempt++) {
    try {
      verifyAssembled(selected.load, selected.sequence);
      break;
    } catch (err) {
      state.reportFailure(selected.sequence, err.message);
      selected = state.beginBoot();
    }
  }
  globalThis.__clsBoot = { state, selected, builtin, updatesDir };
  app.on("before-quit", () => {
    const b = globalThis.__clsBoot;
    if (b.selected.load && !b.healthRecorded) state.noteCleanExit(b.selected.sequence);
  });
  try {
    await import(pathToFileURL(join(selected.load || builtin, "main.mjs")).href);
  } catch (err) {
    if (selected.load) {
      state.reportFailure(selected.sequence, err.message);
      app.relaunch();
      app.exit(1);
    } else {
      await app.whenReady();
      dialog.showErrorBox("中国法律检索启动失败", String(err?.stack || err));
      app.quit();
    }
  }
}
