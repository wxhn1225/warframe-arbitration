// 真实数据文件完整性校验：public/data 下的排期 / 节点 / 默认等级表
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  decodeSchedule,
  normalizeTierlist,
  type CompactScheduleFile,
  type NodesZhFile,
  type Tierlist,
} from "../src/lib/arbys.ts";

const dataDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public/data");
const load = (f: string) => JSON.parse(readFileSync(path.join(dataDir, f), "utf8"));

const scheduleFile = load("arbys.schedule.v2.json") as CompactScheduleFile;
const nodesFile = load("arbys.nodes.zh.json") as NodesZhFile;
const tierlistFile = load("tierlist.default.json") as Tierlist;

test("排期 v2：schema/等距/索引范围合法", () => {
  assert.equal(scheduleFile.schema, 2);
  assert.equal(scheduleFile.stepSec, 3600);
  assert.ok(scheduleFile.seq.length > 0);
  assert.ok(scheduleFile.nodes.length > 0);
  for (const i of scheduleFile.seq) {
    assert.ok(Number.isInteger(i) && i >= 0 && i < scheduleFile.nodes.length);
  }
  const decoded = decodeSchedule(scheduleFile);
  assert.equal(decoded.length, scheduleFile.seq.length);
  assert.equal(decoded[1]!.ts - decoded[0]!.ts, 3600);
});

test("排期覆盖当前时间（站点能显示“正在进行”）", () => {
  const decoded = decodeSchedule(scheduleFile);
  const now = Math.floor(Date.now() / 1000);
  const first = decoded[0]!.ts;
  const last = decoded[decoded.length - 1]!.ts;
  assert.ok(first <= now, `排期起点 ${new Date(first * 1000).toISOString()} 应早于现在`);
  assert.ok(last >= now, `排期终点 ${new Date(last * 1000).toISOString()} 应晚于现在（数据未过期）`);
  // 剩余覆盖少于 30 天给出提醒性失败信息
  const daysLeft = (last - now) / 86400;
  assert.ok(daysLeft > 0, `排期数据剩余 ${daysLeft.toFixed(1)} 天`);
});

test("排期引用的节点全部有中文信息", () => {
  const known = new Set(Object.keys(nodesFile.nodes));
  const missing = scheduleFile.nodes.filter((k) => !known.has(k));
  assert.deepEqual(missing, [], `缺中文信息的节点: ${missing.join(", ")}`);
});

test("节点信息字段完整", () => {
  for (const [key, n] of Object.entries(nodesFile.nodes)) {
    assert.equal(n.nodeKey, key);
    assert.ok(n.nameZh, `${key} 缺 nameZh`);
    assert.ok(n.systemNameZh, `${key} 缺 systemNameZh`);
    assert.ok(n.missionNameZh, `${key} 缺 missionNameZh`);
  }
});

test("默认等级表：归一化后全部节点恰好分配一次", () => {
  const allKeys = Object.keys(nodesFile.nodes);
  const norm = normalizeTierlist(tierlistFile, allKeys);
  const flat = Object.values(norm.tierBuckets).flat();
  assert.equal(flat.length, new Set(flat).size, "归一化后不应有重复节点");
  assert.deepEqual([...flat].sort(), [...allKeys].sort());
  // 默认表里引用的节点不应是未知节点
  const known = new Set(allKeys);
  const unknownRefs = Object.values(tierlistFile.tierBuckets ?? {})
    .flat()
    .filter((k) => !known.has(k));
  assert.deepEqual(unknownRefs, [], `等级表引用了未知节点: ${unknownRefs.join(", ")}`);
});
