// 仲裁队列核心逻辑单元测试（node --test，Node >= 22.18 原生类型擦除运行 TS）
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decodeSchedule,
  findCurrentIndex,
  normalizeTierlist,
  buildTierOfNode,
  hhmm,
  displayNode,
  DEFAULT_TIERS,
  type CompactScheduleFile,
  type Tierlist,
} from "../src/lib/arbys.ts";

test("decodeSchedule：v2 紧凑格式按等距步长还原", () => {
  const c: CompactScheduleFile = {
    schema: 2,
    startTs: 1000,
    stepSec: 3600,
    nodes: ["A", "B"],
    seq: [0, 1, 0],
  };
  const out = decodeSchedule(c);
  assert.deepEqual(out, [
    { ts: 1000, nodeKey: "A" },
    { ts: 4600, nodeKey: "B" },
    { ts: 8200, nodeKey: "A" },
  ]);
});

test("findCurrentIndex：二分查找边界", () => {
  const sched = [1000, 2000, 3000].map((ts) => ({ ts, nodeKey: "X" }));
  assert.equal(findCurrentIndex(sched, 500), 0);   // 早于首条 → 0
  assert.equal(findCurrentIndex(sched, 1000), 0);  // 恰在整点
  assert.equal(findCurrentIndex(sched, 1999), 0);  // 小时中段
  assert.equal(findCurrentIndex(sched, 2000), 1);
  assert.equal(findCurrentIndex(sched, 99999), 2); // 晚于末条 → 最后一条
});

test("normalizeTierlist：合并/去重/兼容旧键/缺失节点补未评级", () => {
  const input = {
    schema: 1,
    tiers: ["S", "D"],
    tierBuckets: {
      S: ["n1", "n2"],
      A: ["n2", "n3"],     // n2 与 S 重复，应去重保留 S
      D: ["n4"],            // 未知 tier 折叠进 C
      "未评级": ["n5"],     // 中文键兼容 → unrated
    },
  } as unknown as Tierlist;
  const all = ["n1", "n2", "n3", "n4", "n5", "n6"];
  const out = normalizeTierlist(input, all);

  assert.deepEqual(out.tiers, [...DEFAULT_TIERS]);
  assert.deepEqual(out.tierBuckets.S, ["n1", "n2"]);
  assert.deepEqual(out.tierBuckets.A, ["n3"]);
  assert.deepEqual(out.tierBuckets.C, ["n4"]);
  assert.deepEqual(out.tierBuckets.unrated, ["n5", "n6"]); // n6 缺失补入
  // 全部节点恰好出现一次
  const flat = Object.values(out.tierBuckets).flat().sort();
  assert.deepEqual(flat, [...all].sort());
});

test("buildTierOfNode：反向索引", () => {
  const t: Tierlist = {
    schema: 1,
    tiers: ["S", "A"],
    tierBuckets: { S: ["n1"], A: ["n2"] },
  };
  assert.deepEqual(buildTierOfNode(t), { n1: "S", n2: "A" });
});

test("hhmm / displayNode 基本格式", () => {
  assert.match(hhmm(0), /^\d{2}:\d{2}$/);
  assert.equal(
    displayNode({
      nodeKey: "SolNode1",
      missionNameZh: "防御",
      factionNameZh: "Grineer",
      nameZh: "某地",
      systemNameZh: "地球",
    }),
    "防御 - Grineer @ 某地, 地球"
  );
  // 缺字段时回退 nodeKey
  assert.equal(
    displayNode({ nodeKey: "K", missionNameZh: "", factionNameZh: "", nameZh: "", systemNameZh: "" }),
    "K @ K"
  );
});
