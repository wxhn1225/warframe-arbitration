// EE.log 解析内核单元测试：用合成日志驱动状态机
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createEeLineParser,
  parseRecentValidEeLogFromFile,
} from "../src/lib/eelog/parser.ts";
import { scanFileRange, type SliceableFile } from "../src/lib/eelog/scanCore.ts";

// ---- 合成日志构造工具 ---------------------------------------------------------

const startName = (t: number) =>
  `${t.toFixed(3)} Script [Info]: ThemedSquadOverlay.lua: Mission name: 测试节点 - 仲裁`;
const hostLoading = (t: number, node: string) =>
  `${t.toFixed(3)} Script [Info]: ThemedSquadOverlay.lua: Host loading {"name":"${node}_EliteAlert","tag":"x"}`;
const ssStarted = (t: number) =>
  `${t.toFixed(3)} Game [Info]: GameRulesImpl - changing state from SS_WAITING_FOR_PLAYERS to SS_STARTED`;
const ssEnding = (t: number) =>
  `${t.toFixed(3)} Game [Info]: GameRulesImpl - changing state from SS_STARTED to SS_ENDING`;
const eomInit = (t: number) =>
  `${t.toFixed(3)} Script [Info]: EndOfMatch.lua: Initialize`;
const endMark = (t: number, node: string) =>
  `${t.toFixed(3)} Script [Info]: Background.lua: EliteAlertMission at ${node} cleanup`;
const wave = (t: number, n: number) =>
  `${t.toFixed(3)} Script [Info]: WaveDefend.lua: Defense wave: ${n}`;
const survivalTier = (t: number, n: number, internal: number) =>
  `${t.toFixed(3)} Script [Info]: SurvivalMission.lua: Survival: Gave reward tier ${n} at ${internal.toFixed(3)}`;
const interRound = (t: number) =>
  `${t.toFixed(3)} Script [Info]: HudRedux.lua: Queuing new transmission: InterNewRoundLotusTransmission`;
const drone = (t: number) =>
  `${t.toFixed(3)} AI [Info]: OnAgentCreated /Npc/CorpusEliteShieldDroneAgent7`;
const enemy = (t: number, spawned: number, ticking: number) =>
  `${t.toFixed(3)} AI [Info]: OnAgentCreated /Npc/SomeEnemyAgent Spawned ${spawned} MonitoredTicking ${ticking}`;
const noise = (t: number, i: number) =>
  `${t.toFixed(3)} Sys [Info]: irrelevant line number ${i} with no markers`;

function feedAll(lines: string[], options?: Parameters<typeof createEeLineParser>[0]) {
  const p = createEeLineParser(options);
  for (const l of lines) p.feedLine(l);
  return p.finish();
}

// ---- 防御任务 -----------------------------------------------------------------

function defenseRun(node = "SolNode123", base = 100): string[] {
  return [
    startName(base),
    hostLoading(base + 1, node),
    ssStarted(base + 10),
    wave(base + 20, 1),
    drone(base + 25),
    drone(base + 25.1), // 连续两行 → 同一 burst 事件
    enemy(base + 30, 50, 12),
    wave(base + 80, 2),
    drone(base + 90),
    enemy(base + 95, 80, 18),
    wave(base + 140, 3),
    wave(base + 200, 4),
    enemy(base + 210, 120, 9),
    eomInit(base + 300),
    ssEnding(base + 310),
    endMark(base + 320, node),
  ];
}

test("防御任务：波次/轮次/无人机/时长/敌人计数", () => {
  const { missions, validTotal } = feedAll(defenseRun());
  assert.equal(validTotal, 1);
  const m = missions[0]!;
  assert.equal(m.status, "ok");
  assert.equal(m.nodeId, "SolNode123");
  assert.equal(m.shieldDroneCount, 3);
  assert.equal(m.spawnedAtEnd, 120);
  assert.equal(m.eomDurationSec, 290); // (100+300) - (100+10)
  assert.equal(m.waveCount, 4);
  assert.equal(m.roundCount, 2); // ceil(4/3)
  assert.equal(m.phases?.length, 4);
  // 波1 两架（burst 合并为一次事件、计数 2），波2 一架
  assert.deepEqual(m.phases?.map((p) => p.shieldDroneCount), [2, 1, 0, 0]);
  assert.deepEqual(m.droneBurstSizes, [2, 1]);
  assert.equal(m.droneSpawnTimes?.length, 2);
  assert.equal(m.tickingSeries?.length, 3);
});

// ---- 时长过滤 -------------------------------------------------------------------

test("时长 < minDurationSec 的完整任务被排除", () => {
  const node = "SolNode9";
  const lines = [
    startName(0),
    hostLoading(1, node),
    ssStarted(10),
    enemy(20, 5, 3),
    eomInit(40), // 仅 30s
    ssEnding(45),
    endMark(50, node),
  ];
  const { missions, validTotal, warnings } = feedAll(lines, { count: 2, minDurationSec: 60 });
  assert.equal(validTotal, 0);
  assert.equal(missions.length, 0);
  assert.ok(warnings.some((w) => w.includes("有效记录不足")));
});

// ---- 只保留最近 N 次 ------------------------------------------------------------

test("count=2 时只保留最近 2 次，validTotal 记录全部", () => {
  const lines = [
    ...defenseRun("SolNodeA", 0),
    ...defenseRun("SolNodeB", 1000),
    ...defenseRun("SolNodeC", 2000),
  ];
  const { missions, validTotal } = feedAll(lines, { count: 2 });
  assert.equal(validTotal, 3);
  assert.deepEqual(missions.map((m) => m.nodeId), ["SolNodeB", "SolNodeC"]);
  assert.deepEqual(missions.map((m) => m.index), [1, 2]);
});

// ---- 生存任务 -------------------------------------------------------------------

test("生存任务：tier 计轮，EOM 之后的 tier 被丢弃", () => {
  const node = "SolNode55";
  const lines = [
    startName(0),
    hostLoading(1, node),
    ssStarted(10),
    drone(50),
    survivalTier(310, 1, 300),
    drone(400),
    survivalTier(610, 2, 600),
    eomInit(900),       // 撤离
    survivalTier(905, 3, 895), // EOM 之后才触发的 tier → 应被丢弃
    ssEnding(910),
    endMark(920, node),
  ];
  const { missions } = feedAll(lines, { count: 1 });
  const m = missions[0]!;
  assert.equal(m.roundCount, 2);
  assert.equal(m.waveCount, 2);
  // 轮1 一架（tier1 前的暂存归入），轮2 一架
  assert.deepEqual(m.phases?.map((p) => p.shieldDroneCount), [1, 1]);
  assert.equal(m.phaseBoundaryTimes?.length, 2);
});

// ---- 拦截任务 -------------------------------------------------------------------

test("拦截任务：轮次播报计数，首轮前无人机归入第 1 轮", () => {
  const node = "SolNode77";
  const lines = [
    startName(0),
    hostLoading(1, node),
    ssStarted(10),
    drone(30),
    drone(40),
    interRound(180),
    drone(200),
    interRound(360),
    eomInit(400),
    ssEnding(410),
    endMark(420, node),
  ];
  const { missions } = feedAll(lines, { count: 1 });
  const m = missions[0]!;
  assert.equal(m.roundCount, 2);
  assert.equal(m.waveCount, 2);
  assert.deepEqual(m.phases?.map((p) => p.shieldDroneCount), [2, 1]);
});

// ---- 残局（incomplete）----------------------------------------------------------

test("文件结尾未结束的任务：有 SS_STARTED 和生成信号 → incomplete 仍计入", () => {
  const lines = [
    startName(0),
    hostLoading(1, "SolNode3"),
    ssStarted(10),
    drone(50),
    enemy(60, 9, 4),
    // 文件到此截断
  ];
  const { missions, validTotal } = feedAll(lines, { count: 2 });
  assert.equal(validTotal, 1);
  assert.equal(missions[0]!.status, "incomplete");
});

test("只有开始标记没有 SS_STARTED 的任务被丢弃", () => {
  const lines = [startName(0), hostLoading(1, "SolNode4"), noise(5, 1)];
  const { validTotal } = feedAll(lines, { count: 2 });
  assert.equal(validTotal, 0);
});

// ---- 带 ! 前缀的时间戳 -----------------------------------------------------------

test("时间戳带 ! 前缀的行能正常解析", () => {
  const node = "SolNode8";
  const lines = defenseRun(node).map((l, i) => (i % 2 === 0 ? `!${l}` : l));
  const { missions } = feedAll(lines, { count: 1 });
  assert.equal(missions[0]!.nodeId, node);
  assert.equal(missions[0]!.eomDurationSec, 290);
});

// ---- 流式入口（File 分块 + CRLF）-------------------------------------------------

test("parseRecentValidEeLogFromFile：CRLF + 跨块切割结果一致", async () => {
  const text = defenseRun().join("\r\n") + "\r\n";
  const file = new File([text], "EE.log");
  const res = await parseRecentValidEeLogFromFile(file, { count: 2, chunkBytes: 64 });
  assert.equal(res.readComplete, true);
  assert.equal(res.missions.length, 1);
  assert.equal(res.missions[0]!.shieldDroneCount, 3);
  assert.equal(res.missions[0]!.eomDurationSec, 290);
});

// ---- 并行扫描路径与逐行解析一致性 --------------------------------------------------

function makeBigLog(): string {
  const lines: string[] = [];
  let t = 0;
  const push = (l: string) => lines.push(l);
  // 大量噪声 + 三次任务（防御 / 生存 / 拦截）
  for (let i = 0; i < 2000; i++) push(noise(t++, i));
  for (const l of defenseRun("SolNodeA", 5000)) push(l);
  for (let i = 0; i < 3000; i++) push(noise(6000 + i, i));
  push(startName(10000));
  push(hostLoading(10001, "SolNodeB"));
  push(ssStarted(10010));
  push(drone(10050));
  push(survivalTier(10310, 1, 300));
  push(drone(10400));
  push(eomInit(10900));
  push(ssEnding(10910));
  push(endMark(10920, "SolNodeB"));
  for (let i = 0; i < 3000; i++) push(noise(20000 + i, i));
  for (const l of defenseRun("SolNodeC", 30000)) push(l);
  return lines.join("\r\n") + "\r\n";
}

function mockFile(buf: Buffer): SliceableFile {
  return {
    size: buf.length,
    slice: (s: number, e: number) => ({
      // 拷贝一份保证返回独立的 ArrayBuffer（Buffer.subarray 是共享视图）
      arrayBuffer: async () => new Uint8Array(buf.subarray(s, Math.min(e, buf.length))).buffer,
    }),
  };
}

test("scanFileRange 分段扫描 + 回放 与 逐行解析结果一致", async () => {
  const text = makeBigLog();
  const buf = Buffer.from(text, "utf8");
  const file = mockFile(buf);

  // 模拟 3 个 worker 分段扫描（故意用不对齐行边界的分割点）
  const segs = 3;
  const segSize = Math.ceil(buf.length / segs);
  const parts: string[] = [];
  for (let i = 0; i < segs; i++) {
    const s = i * segSize;
    const e = Math.min(buf.length, s + segSize);
    parts.push(await scanFileRange(file, s, e, 4096));
  }
  const linesText = parts.filter((p) => p.length > 0).join("\n");

  const replay = createEeLineParser({ count: 10 });
  for (const l of linesText.split("\n")) if (l.length > 0) replay.feedLine(l);
  const parallel = replay.finish();

  const direct = feedAll(
    text.split("\n").map((l) => (l.endsWith("\r") ? l.slice(0, -1) : l)),
    { count: 10 }
  );

  assert.equal(parallel.validTotal, direct.validTotal);
  assert.equal(parallel.missions.length, direct.missions.length);
  for (let i = 0; i < direct.missions.length; i++) {
    const a = parallel.missions[i]!;
    const b = direct.missions[i]!;
    assert.equal(a.nodeId, b.nodeId);
    assert.equal(a.shieldDroneCount, b.shieldDroneCount);
    assert.equal(a.eomDurationSec, b.eomDurationSec);
    assert.equal(a.waveCount, b.waveCount);
    assert.equal(a.roundCount, b.roundCount);
    assert.equal(a.spawnedAtEnd, b.spawnedAtEnd);
    assert.deepEqual(a.phases, b.phases);
    assert.deepEqual(a.droneSpawnTimes, b.droneSpawnTimes);
  }
});
