// 解析专用 Web Worker：在后台线程跑解析，避免大日志卡住 UI
// 两种模式：
// - { file }      经典路径：流式逐行解析整个文件
// - { linesText } 并行路径：扫描 Worker 已提取好标记行，这里只回放状态机
import { createEeLineParser, parseRecentValidEeLogFromFile } from "./parser";
import type { ParseRecentValidFromFileOptions } from "./parser";

type WorkerRequest = {
  file?: File;
  linesText?: string;
  options?: ParseRecentValidFromFileOptions;
};

const ctx = self as unknown as {
  postMessage: (msg: unknown) => void;
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null;
};

ctx.onmessage = async (e) => {
  const { file, linesText, options } = e.data;
  try {
    if (linesText != null) {
      const parser = createEeLineParser(options);
      for (const line of linesText.split("\n")) {
        if (line.length > 0) parser.feedLine(line);
      }
      const { missions, warnings, validTotal } = parser.finish();
      ctx.postMessage({
        type: "done",
        result: { missions, warnings, validTotal, readComplete: true, readProgress01: 1 },
      });
      return;
    }
    if (!file) throw new Error("缺少 file 或 linesText");
    const result = await parseRecentValidEeLogFromFile(file, options, (progress) => {
      ctx.postMessage({ type: "progress", progress });
    });
    ctx.postMessage({ type: "done", result });
  } catch (err) {
    ctx.postMessage({
      type: "error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
};
