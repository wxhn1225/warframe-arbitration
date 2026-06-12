// ---- 大文件标记行扫描 -----------------------------------------------------------
// 大日志里 99.9% 的行与解析无关。并行路径先用多个 Worker 把含标记的行扫出来，
// 再把这些行按顺序喂给 createEeLineParser，结果与逐行解析完全一致。
//
// SCAN_PATTERNS 必须覆盖 parser.ts 中所有正则可能命中的行：
// - "Script [Info]: "              所有 .lua 脚本标记（任务开始/波次/轮次/生存tier/EOM/结束等）
// - "AI [Info]: OnAgentCreated"    敌人/无人机生成（含 Spawned/MonitoredTicking 字段）
// - "GameRulesImpl - changing state" 状态机 SS_STARTED/SS_ENDING
// - "Sending LOAD_LEVEL to"        客机进图（Net 行）
// - "CreatePlayerForClient. id="   客机进图（Game 行）
// - "_EliteAlert"                  NodeId 补抓窗口（reVoteNodeId 可匹配任意行）

export const SCAN_PATTERNS = [
  "Script [Info]: ",
  "AI [Info]: OnAgentCreated",
  "GameRulesImpl - changing state",
  "Sending LOAD_LEVEL to",
  "CreatePlayerForClient. id=",
  "_EliteAlert",
] as const;

// 单遍正则交替比逐模式 indexOf 快约 2 倍（V8 对字面量交替有优化）
const SCAN_RE = new RegExp(
  SCAN_PATTERNS.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"),
  "g"
);

// File 的最小接口（便于 Node 测试用 fd 模拟）
export type SliceableFile = {
  size: number;
  slice: (start: number, end: number) => { arrayBuffer: () => Promise<ArrayBuffer> };
};

/**
 * 扫描文件 [start, end) 字节范围，返回所有包含标记的完整行（按出现顺序、"\n" 连接）。
 * 行归属约定：行起始字节在 [start, end) 内的行属于本段——
 * - start > 0 且 start-1 不是换行符时，跳过开头的残行（它属于上一段）；
 * - 末尾跨界的行会继续读到行尾补全（它属于本段）。
 */
export async function scanFileRange(
  file: SliceableFile,
  start: number,
  end: number,
  chunkBytes = 8 * 1024 * 1024,
  onProgress?: (bytesDone: number) => void
): Promise<string> {
  // 每块扫完立刻 join 成扁平字符串：String.slice 产生的是引用父串的视图（SlicedString），
  // 不立即落平会把所有块的完整文本驻留在内存里，大文件直接 OOM
  const outParts: string[] = [];
  const decoder = new TextDecoder("utf-8");
  let offset = start;
  let carry = "";
  let skippedHead = start === 0;

  // start-1 恰好是换行符时，本段开头就是完整行，无需跳过
  if (!skippedHead && start > 0) {
    const probe = new Uint8Array(await file.slice(start - 1, start).arrayBuffer());
    if (probe[0] === 0x0a) skippedHead = true;
  }

  const scanText = (text: string) => {
    // 单遍正则交替找命中（位置天然递增），按行去重后提取整行
    SCAN_RE.lastIndex = 0;
    let lastLineEnd = -1;
    let m: RegExpExecArray | null;
    let lines: string[] | null = null;
    while ((m = SCAN_RE.exec(text)) !== null) {
      const h = m.index;
      if (h <= lastLineEnd) continue; // 同一行多个命中
      const ls = text.lastIndexOf("\n", h) + 1;
      let le = text.indexOf("\n", h);
      if (le === -1) le = text.length;
      lastLineEnd = le;
      SCAN_RE.lastIndex = le; // 跳到行尾继续，避免同行重复匹配
      let line = text.slice(ls, le);
      if (line.length > 0 && line.charCodeAt(line.length - 1) === 13) line = line.slice(0, -1);
      if (line.length > 0) (lines ??= []).push(line);
    }
    // join 落平视图；单元素 join 会原样返回视图，用拼接强制复制
    if (lines) outParts.push(lines.length > 1 ? lines.join("\n") : (" " + lines[0]).substring(1));
  };

  while (offset < end) {
    const chunkEnd = Math.min(end, offset + chunkBytes);
    const buf = await file.slice(offset, chunkEnd).arrayBuffer();
    let text = decoder.decode(buf, { stream: true });
    if (!skippedHead) {
      // 丢弃属于上一段的残行
      const nl = text.indexOf("\n");
      if (nl === -1) { offset = chunkEnd; continue; }
      text = text.slice(nl + 1);
      skippedHead = true;
    }
    const combined = carry + text;
    // 只扫描到最后一个完整行，余下部分进位到下一块
    const lastNl = combined.lastIndexOf("\n");
    if (lastNl === -1) {
      carry = combined;
    } else {
      scanText(combined.slice(0, lastNl + 1));
      carry = combined.slice(lastNl + 1);
    }
    offset = chunkEnd;
    onProgress?.(offset - start);
  }

  // 末行跨过 end：继续读到行尾补全（该行起始在本段内）
  if (carry.length > 0 && end < file.size) {
    let extra = end;
    while (extra < file.size) {
      const more = Math.min(file.size, extra + 64 * 1024);
      const buf = await file.slice(extra, more).arrayBuffer();
      const text = decoder.decode(buf, { stream: true });
      const nl = text.indexOf("\n");
      if (nl !== -1) {
        carry += text.slice(0, nl);
        break;
      }
      carry += text;
      extra = more;
    }
  }
  if (carry.trim()) scanText(carry + "\n");

  return outParts.join("\n");
}
