// macOS 自带的文字识别（Vision 框架），用 osascript -l JavaScript 运行，不需要另装软件。
// 用法：osascript -l JavaScript vision-mac.js 图片路径
ObjC.import("Vision");
ObjC.import("Foundation");
function run(argv) {
  const url = $.NSURL.fileURLWithPath(argv[0]);
  const req = $.VNRecognizeTextRequest.alloc.init;
  req.recognitionLevel = 0; // 0 = accurate
  req.recognitionLanguages = $(["zh-Hans", "zh-Hant", "en-US"]);
  req.usesLanguageCorrection = false;
  const handler = $.VNImageRequestHandler.alloc.initWithURLOptions(url, $({}));
  if (!handler.performRequestsError($([req]), null)) return "";
  const res = req.results;
  const out = [];
  for (let i = 0; i < res.count; i++) {
    const c = res.objectAtIndex(i).topCandidates(1);
    if (c.count) out.push(c.objectAtIndex(0).string.js);
  }
  return out.join("\n");
}
