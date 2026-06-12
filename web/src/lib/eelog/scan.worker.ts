// 大文件并行扫描 Worker：提取一个字节段内的所有标记行
import { scanFileRange } from "./scanCore";

type ScanRequest = { file: File; start: number; end: number };

const ctx = self as unknown as {
  postMessage: (msg: unknown) => void;
  onmessage: ((e: MessageEvent<ScanRequest>) => void) | null;
};

ctx.onmessage = async (e) => {
  const { file, start, end } = e.data;
  try {
    let lastPost = 0;
    const linesText = await scanFileRange(file, start, end, 8 * 1024 * 1024, (bytesDone) => {
      const now = Date.now();
      if (now - lastPost > 200) {
        lastPost = now;
        ctx.postMessage({ type: "progress", bytesDone });
      }
    });
    // 单个字符串传输（结构化克隆大字符串远快于字符串数组）
    ctx.postMessage({ type: "done", linesText, bytes: end - start });
  } catch (err) {
    ctx.postMessage({
      type: "error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
};
