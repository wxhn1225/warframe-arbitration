// 把 generated/arbys.schedule.json（约 3.1MB 的 {ts,nodeKey} 数组）
// 压缩为 v2 紧凑格式：起始时间 + 节点字典 + 索引序列（整点等距，无需逐条存 ts）。
// 用法：node scripts/compact-schedule.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcPath = path.join(root, "generated", "arbys.schedule.json");
const outPath = path.join(root, "web", "public", "data", "arbys.schedule.v2.json");

const { schedule } = JSON.parse(readFileSync(srcPath, "utf8"));
if (!Array.isArray(schedule) || schedule.length === 0) {
  throw new Error("schedule 为空");
}

const stepSec = 3600;
for (let i = 1; i < schedule.length; i++) {
  if (schedule[i].ts - schedule[i - 1].ts !== stepSec) {
    throw new Error(`第 ${i} 条不是整点等距，无法使用 v2 格式`);
  }
}

const nodeIndex = new Map();
const nodes = [];
const seq = schedule.map(({ nodeKey }) => {
  let idx = nodeIndex.get(nodeKey);
  if (idx === undefined) {
    idx = nodes.length;
    nodes.push(nodeKey);
    nodeIndex.set(nodeKey, idx);
  }
  return idx;
});

const out = {
  schema: 2,
  startTs: schedule[0].ts,
  stepSec,
  nodes,
  seq,
};

writeFileSync(outPath, JSON.stringify(out));
console.log(
  `OK: ${schedule.length} 条 / ${nodes.length} 个节点 -> ${outPath} (${(JSON.stringify(out).length / 1024).toFixed(1)} KB)`,
);
