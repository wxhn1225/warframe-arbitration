import type { ParseResult, ParseRecentValidFromFileOptions } from "./parser";
import { parseRecentValidEeLogFromFile } from "./parser";

type ParserWorkerResponse =
  | { type: "progress"; progress: number }
  | { type: "done"; result: ParseResult }
  | { type: "error"; message: string };

type ScanWorkerResponse =
  | { type: "progress"; bytesDone: number }
  | { type: "done"; linesText: string; bytes: number }
  | { type: "error"; message: string };

// 超过该大小启用并行扫描路径（多 Worker 提取标记行 + 单 Worker 回放状态机）
const PARALLEL_MIN_SIZE = 256 * 1024 * 1024;

function runParserWorker(
  req: { file?: File; linesText?: string; options?: ParseRecentValidFromFileOptions },
  onProgress?: (progress01: number) => void
): Promise<ParseResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./parser.worker.ts", import.meta.url));
    worker.onmessage = (e: MessageEvent<ParserWorkerResponse>) => {
      const msg = e.data;
      if (msg.type === "progress") {
        onProgress?.(msg.progress);
      } else if (msg.type === "done") {
        worker.terminate();
        resolve(msg.result);
      } else {
        worker.terminate();
        reject(new Error(msg.message));
      }
    };
    worker.onerror = (ev) => {
      worker.terminate();
      reject(new Error(ev.message || "解析 Worker 异常"));
    };
    worker.postMessage(req);
  });
}

function scanSegment(
  file: File,
  start: number,
  end: number,
  onProgress: (bytesDone: number) => void
): Promise<string> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./scan.worker.ts", import.meta.url));
    worker.onmessage = (e: MessageEvent<ScanWorkerResponse>) => {
      const msg = e.data;
      if (msg.type === "progress") {
        onProgress(msg.bytesDone);
      } else if (msg.type === "done") {
        onProgress(msg.bytes);
        worker.terminate();
        resolve(msg.linesText);
      } else {
        worker.terminate();
        reject(new Error(msg.message));
      }
    };
    worker.onerror = (ev) => {
      worker.terminate();
      reject(new Error(ev.message || "扫描 Worker 异常"));
    };
    worker.postMessage({ file, start, end });
  });
}

async function parseParallel(
  file: File,
  options?: ParseRecentValidFromFileOptions,
  onProgress?: (progress01: number) => void
): Promise<ParseResult> {
  const cores = typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 4 : 4;
  const workers = Math.min(Math.max(cores - 1, 2), 6);
  const segSize = Math.ceil(file.size / workers);

  // 扫描占进度的 0~0.95，回放占 0.95~1
  const doneBytes = new Array<number>(workers).fill(0);
  const reportScan = () => {
    if (!onProgress) return;
    const total = doneBytes.reduce((a, b) => a + b, 0);
    onProgress(Math.min(0.95, (total / file.size) * 0.95));
  };

  const tasks: Promise<string>[] = [];
  for (let i = 0; i < workers; i++) {
    const start = i * segSize;
    const end = Math.min(file.size, start + segSize);
    if (start >= end) break;
    tasks.push(
      scanSegment(file, start, end, (bytesDone) => {
        doneBytes[i] = bytesDone;
        reportScan();
      })
    );
  }
  const parts = await Promise.all(tasks);
  const linesText = parts.filter((p) => p.length > 0).join("\n");
  const result = await runParserWorker({ linesText, options });
  onProgress?.(1);
  return result;
}

/**
 * 在 Web Worker 中解析 EE.log，主线程不阻塞。
 * - 大文件（>256MB）：多 Worker 并行扫描标记行，再回放状态机（快一个数量级）
 * - 一般文件：单 Worker 流式解析
 * - Worker 不可用（极老浏览器）：回退主线程
 */
export async function parseEeLogInWorker(
  file: File,
  options?: ParseRecentValidFromFileOptions,
  onProgress?: (progress01: number) => void
): Promise<ParseResult> {
  if (typeof Worker === "undefined") {
    return parseRecentValidEeLogFromFile(file, options, onProgress);
  }
  if (file.size >= PARALLEL_MIN_SIZE) {
    try {
      return await parseParallel(file, options, onProgress);
    } catch {
      // 并行路径异常时回退经典路径
    }
  }
  return runParserWorker({ file, options }, onProgress);
}
