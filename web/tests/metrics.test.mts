// 日志分析页指标与饱和度分析单元测试
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buffMultiplier,
  gradeFor,
  computeMetrics,
  BASE_DROP,
} from "../src/app/log/lib/metrics.ts";
import {
  detectInactiveIntervals,
  buildSatData,
  buildDroneGapData,
  buildDroneBurstDistrib,
  buildEventTimeline,
} from "../src/app/log/lib/analysis.ts";
import { formatDuration, t as translate } from "../src/app/log/lib/format.ts";
import type { MissionResult } from "../src/lib/eelog/parser.ts";

test("buffMultiplier：组合倍率", () => {
  assert.equal(buffMultiplier({ blueBox: false, abundant: false, yellowBox: false, blessing: false }), 1);
  assert.equal(buffMultiplier({ blueBox: true, abundant: false, yellowBox: true, blessing: false }), 4);
  // 满状态 2 × 1.18 × 2 × 1.25 = 5.9
  assert.ok(Math.abs(buffMultiplier({ blueBox: true, abundant: true, yellowBox: true, blessing: true }) - 5.9) < 1e-9);
});

test("gradeFor：评级阈值边界", () => {
  assert.equal(gradeFor(800), "S");
  assert.equal(gradeFor(799.99), "A+");
  assert.equal(gradeFor(700), "A+");
  assert.equal(gradeFor(600), "A");
  assert.equal(gradeFor(500), "A-");
  assert.equal(gradeFor(499), "F");
  assert.equal(gradeFor(undefined), "-");
  assert.equal(gradeFor(NaN), "-");
});

test("computeMetrics：无人机期望 + 轮次奖励期望", () => {
  const m = {
    index: 1,
    shieldDroneCount: 100,
    roundCount: 10,
    eomDurationSec: 3600,
    status: "ok",
  } as MissionResult;
  const mul = 2;
  const r = computeMetrics(m, mul);
  // 100 × 0.06 × 2 = 12
  assert.ok(Math.abs(r.expectedFromDrones! - 100 * BASE_DROP * mul) < 1e-9);
  // 10 × (1 + 0.1×3) = 13
  assert.ok(Math.abs(r.expectedFromRounds! - 13) < 1e-9);
  assert.ok(Math.abs(r.expectedTotal! - 25) < 1e-9);
  // 满状态：100×0.06×5.9 + 13 = 35.4 + 13 = 48.4
  assert.ok(Math.abs(r.fullExpectedTotal! - 48.4) < 1e-9);
});

test("computeMetrics：空任务全部 undefined", () => {
  const r = computeMetrics(null, 1);
  assert.equal(r.expectedTotal, undefined);
  assert.equal(r.hostTotalSec, undefined);
});

test("detectInactiveIntervals：MT=0 连续段与超长采样间隙", () => {
  const series = [
    { t: 0, v: 0 },   // 开局 0 段
    { t: 5, v: 10 },
    { t: 6, v: 12 },
    { t: 30, v: 11 }, // 6→30 间隔 24s ≥ 20 → 无效段
    { t: 31, v: 0 },
    { t: 36, v: 0 },  // 0 段 ≥ 3s
    { t: 38, v: 9 },
  ];
  const iv = detectInactiveIntervals(series);
  // [0,5]（开局）、[6,30]（超长间隙）、[31,38]（0 段）
  assert.deepEqual(iv, [
    { start: 0, end: 5 },
    { start: 6, end: 30 },
    { start: 31, end: 38 },
  ]);
});

test("buildSatData：分桶时间占比与 ≥15 占比", () => {
  // 每秒一个采样点，前 10s v=3（桶 0-4），后 10s v=17（桶 15-19）
  const series = [
    ...Array.from({ length: 11 }, (_, i) => ({ t: i, v: 3 })),
    ...Array.from({ length: 10 }, (_, i) => ({ t: 11 + i, v: 17 })),
  ];
  const d = buildSatData(series)!;
  assert.ok(d);
  assert.equal(d.maxV, 17);
  // 总时长 20s，v=3 占 10s+1s（10→11 这 1s 仍按前值 3）
  assert.ok(Math.abs(d.totalSec - 20) < 1e-9);
  assert.ok(Math.abs(d.gte15TotalPct - (9 / 20) * 100) < 1e-6);
  const pctSum = d.buckets.reduce((a, b) => a + b.totalPct, 0);
  assert.ok(Math.abs(pctSum - 1) < 1e-9);
});

test("buildDroneGapData：间隔分桶与 >2s 占比", () => {
  const times = [0, 1, 2, 10]; // gaps: 1, 1, 8
  const d = buildDroneGapData(times, undefined)!;
  assert.ok(d);
  assert.equal(d.maxGap, 8);
  assert.ok(Math.abs(d.totalSec - 10) < 1e-9);
  assert.ok(Math.abs(d.gt2TotalPct - 80) < 1e-6); // 8/10
});

test("buildDroneBurstDistrib：连发数量分布", () => {
  const d = buildDroneBurstDistrib([1, 1, 2, 3, 1])!;
  assert.equal(d.maxBurst, 3);
  assert.deepEqual(
    d.rows.map((r) => [r.size, r.count]),
    [[1, 3], [2, 1], [3, 1]]
  );
});

test("buildEventTimeline：按时间排序的混合事件流", () => {
  const m = {
    index: 1,
    shieldDroneCount: 2,
    status: "ok",
    tickingSeries: [{ t: 5, v: 3 }],
    droneSpawnTimes: [2, 8],
    droneBurstSizes: [1, 2],
    phaseBoundaryTimes: [6],
    phases: [{ kind: "wave", index: 1, shieldDroneCount: 2 }],
  } as MissionResult;
  const ev = buildEventTimeline(m);
  assert.deepEqual(ev.map((e) => e.kind), ["drone", "ticking", "phase", "drone"]);
  assert.equal(ev[3]!.value, 2);
});

test("format：formatDuration / 字典翻译回退", () => {
  assert.equal(formatDuration(59.9), "59s");
  assert.equal(formatDuration(61), "1m 1s");
  assert.equal(formatDuration(3661), "1h 1m 1s");
  assert.equal(formatDuration(undefined), "-");
  assert.equal(translate({ k: "值" }, "k"), "值");
  assert.equal(translate({}, "missing"), "missing"); // 缺词条回退 key
  assert.equal(translate(null, undefined), undefined);
});
