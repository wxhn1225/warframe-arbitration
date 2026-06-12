import type { MissionResult, TickingPoint } from "@/lib/eelog/parser";

// ---- 饱和度分析 -------------------------------------------------------------

export type SatBucket = { lo: number; hi: number | null; totalPct: number; activePct: number };
export type SatData = {
  maxV: number;
  buckets: SatBucket[];
  gte15TotalPct: number;
  gte15ActivePct: number;
  totalSec: number;
  activeSec: number;
};

// ---- 共享：检测无效时段 ----
const INACTIVE_THRESH = 3;

export function detectInactiveIntervals(
  series: TickingPoint[],
  phaseBoundaryTimes?: number[],
): Array<{ start: number; end: number }> {
  if (series.length < 2) return [];
  const intervals: Array<{ start: number; end: number }> = [];

  // 1) MT=0 连续 ≥ INACTIVE_THRESH 秒（或开局首段 MT=0）
  let runStart = -1;
  for (let i = 0; i < series.length; i++) {
    if (series[i]!.v === 0) {
      if (runStart < 0) runStart = i;
    } else {
      if (runStart >= 0) {
        const s = series[runStart]!.t;
        const e = series[i]!.t;
        if (runStart === 0 || e - s >= INACTIVE_THRESH) intervals.push({ start: s, end: e });
        runStart = -1;
      }
    }
  }
  if (runStart >= 0) {
    const s = series[runStart]!.t;
    const e = series[series.length - 1]!.t;
    if (runStart === 0 || e - s >= INACTIVE_THRESH) intervals.push({ start: s, end: e });
  }

  // 2) 采样点间隔 ≥ INACTIVE_THRESH 秒，满足以下任一条件标为无效：
  //    - 开局第一段（i===0）
  //    - 边界任一侧 MT=0（轮次切换后无人刷新）
  //    - 间隔超长（≥20s），极可能是轮次间隙（战斗中很少 20s 无生成）
  for (let i = 0; i < series.length - 1; i++) {
    const s = series[i]!.t;
    const e = series[i + 1]!.t;
    const gap = e - s;
    if (gap >= INACTIVE_THRESH) {
      const vBefore = series[i]!.v;
      const vAfter = series[i + 1]!.v;
      if (i === 0 || vBefore === 0 || vAfter === 0 || gap >= 20) {
        intervals.push({ start: s, end: e });
      }
    }
  }

  // 3) 轮次边界时间戳标记的采样空白（MT 两端都 >0 但确实是轮次间）
  if (phaseBoundaryTimes && phaseBoundaryTimes.length > 0) {
    for (const bt of phaseBoundaryTimes) {
      for (let i = 0; i < series.length - 1; i++) {
        if (series[i]!.t <= bt && series[i + 1]!.t > bt) {
          const gap = series[i + 1]!.t - series[i]!.t;
          if (gap >= INACTIVE_THRESH) {
            intervals.push({ start: series[i]!.t, end: series[i + 1]!.t });
          }
          break;
        }
      }
    }
  }

  // 按 start 排序并合并重叠区间
  intervals.sort((a, b) => a.start - b.start);
  const merged: Array<{ start: number; end: number }> = [];
  for (const iv of intervals) {
    const last = merged[merged.length - 1];
    if (last && iv.start <= last.end) {
      last.end = Math.max(last.end, iv.end);
    } else {
      merged.push({ start: iv.start, end: iv.end });
    }
  }
  return merged;
}

export function satColor(ratio: number): string {
  const r = ratio < 0.5 ? Math.round(ratio * 2 * 255) : 255;
  const g = ratio < 0.5 ? 255 : Math.round((1 - (ratio - 0.5) * 2) * 255);
  return `rgb(${r},${g},40)`;
}

export function buildSatData(series: TickingPoint[], hostSec?: number, selectedSec?: number, phaseBoundaryTimes?: number[]): SatData | null {
  // 按选中时间裁剪：只保留时间窗口内的数据
  let src = series;
  if (hostSec != null && selectedSec != null && selectedSec < hostSec && selectedSec > 0) {
    const trimStart = hostSec - selectedSec;
    src = series.filter((p) => p.t >= trimStart);
  }
  if (src.length < 2) return null;
  const maxV = Math.max(...src.map((p) => p.v), 1);
  const STEP = 5;
  const numBuckets = Math.max(1, Math.ceil((maxV + 1) / STEP));
  const totalDurs = new Array(numBuckets).fill(0) as number[];
  const activeDurs = new Array(numBuckets).fill(0) as number[];
  let totalAll = 0, activeAll = 0;

  const gaps = detectInactiveIntervals(src, phaseBoundaryTimes);
  let gi = 0;
  let gte15Total = 0, gte15Active = 0;
  for (let i = 0; i < src.length - 1; i++) {
    const dt = src[i + 1]!.t - src[i]!.t;
    if (dt <= 0 || dt > 10) continue;
    const v = src[i]!.v;
    const t = src[i]!.t;
    const idx = Math.min(Math.floor(v / STEP), numBuckets - 1);
    totalDurs[idx]! += dt;
    totalAll += dt;
    if (v >= 15) gte15Total += dt;
    while (gi < gaps.length && gaps[gi]!.end <= t) gi++;
    const inGap = gi < gaps.length && t >= gaps[gi]!.start && t < gaps[gi]!.end;
    if (!inGap) {
      activeDurs[idx]! += dt;
      activeAll += dt;
      if (v >= 15) gte15Active += dt;
    }
  }
  if (totalAll <= 0) return null;

  const buckets: SatBucket[] = [];
  for (let i = 0; i < numBuckets; i++) {
    const lo = i * STEP;
    const hi = i < numBuckets - 1 ? lo + STEP - 1 : null;
    buckets.push({
      lo,
      hi,
      totalPct: totalDurs[i]! / totalAll,
      activePct: activeAll > 0 ? activeDurs[i]! / activeAll : 0,
    });
  }
  return {
    maxV,
    buckets,
    gte15TotalPct: totalAll > 0 ? (gte15Total / totalAll) * 100 : 0,
    gte15ActivePct: activeAll > 0 ? (gte15Active / activeAll) * 100 : 0,
    totalSec: totalAll,
    activeSec: activeAll,
  };
}

// ---- 无人机真空期分析 ---------------------------------------------------------

export type DroneGapBucket = { lo: number; hi: number | null; totalPct: number; activePct: number };
export type DroneGapData = {
  maxGap: number;
  buckets: DroneGapBucket[];
  gt2TotalPct: number;
  gt2ActivePct: number;
  totalSec: number;
  activeSec: number;
};

export function buildDroneGapData(
  times: number[],
  tickingSeries: TickingPoint[] | undefined,
  hostSec?: number,
  selectedSec?: number,
  phaseBoundaryTimes?: number[],
): DroneGapData | null {
  if (times.length < 2) return null;

  // 按选中时间裁剪
  let src = times;
  if (hostSec != null && selectedSec != null && selectedSec < hostSec && selectedSec > 0) {
    const trimStart = hostSec - selectedSec;
    src = times.filter((t) => t >= trimStart);
  }
  if (src.length < 2) return null;

  // 计算事件间的间隔（parser 已将连续无人机行合并为单次事件）
  const gaps: number[] = [];
  for (let i = 0; i < src.length - 1; i++) {
    gaps.push(src[i + 1]! - src[i]!);
  }

  // 变步长分桶边界：0-2 每0.5s, 2-4 每1s, 4-10 每2s, 10-30(10-15/15-20/20-30), 30-50 每10s，最后一桶固定 50+
  const edges: number[] = [0, 0.5, 1, 1.5, 2, 3, 4, 6, 8, 10, 15, 20, 30, 40, 50, 60];
  const numBuckets = edges.length - 1;

  const totalDurs = new Array(numBuckets).fill(0) as number[];
  const activeDurs = new Array(numBuckets).fill(0) as number[];
  let totalAll = 0, activeAll = 0;
  let gt2Total = 0, gt2Active = 0;

  const gapIntervals = tickingSeries ? detectInactiveIntervals(tickingSeries, phaseBoundaryTimes) : [];

  // maxGap 只取有效时段内的最大间隔（排除无效时段）
  let maxGap = 0;

  function isInGap(t: number): boolean {
    for (const g of gapIntervals) {
      if (t >= g.start && t < g.end) return true;
    }
    return false;
  }

  function bucketIdx(g: number): number {
    for (let b = 0; b < numBuckets; b++) {
      if (g < edges[b + 1]!) return b;
    }
    return numBuckets - 1;
  }

  for (let i = 0; i < gaps.length; i++) {
    const g = gaps[i]!;
    const idx = bucketIdx(g);
    totalDurs[idx]! += g;
    totalAll += g;
    if (g > 2) gt2Total += g;
    const midT = src[i]! + g / 2;
    if (!isInGap(midT)) {
      activeDurs[idx]! += g;
      activeAll += g;
      if (g > 2) gt2Active += g;
      if (g > maxGap) maxGap = g;
    }
  }
  if (totalAll <= 0) return null;

  const buckets: DroneGapBucket[] = [];
  for (let i = 0; i < numBuckets; i++) {
    const lo = edges[i]!;
    const hi = i < numBuckets - 1 ? edges[i + 1]! : null;
    buckets.push({
      lo,
      hi,
      totalPct: totalDurs[i]! / totalAll,
      activePct: activeAll > 0 ? activeDurs[i]! / activeAll : 0,
    });
  }
  return {
    maxGap: Math.round(maxGap),
    buckets,
    gt2TotalPct: totalAll > 0 ? (gt2Total / totalAll) * 100 : 0,
    gt2ActivePct: activeAll > 0 ? (gt2Active / activeAll) * 100 : 0,
    totalSec: totalAll,
    activeSec: activeAll,
  };
}

// ---- 无人机连续生成数量分布 -----------------------------------------------------

export type DroneBurstDistrib = {
  maxBurst: number;
  rows: Array<{ size: number; count: number; pct: number }>;
};

export function buildDroneBurstDistrib(burstSizes: number[] | undefined): DroneBurstDistrib | null {
  if (!burstSizes || burstSizes.length === 0) return null;
  const maxBurst = Math.max(...burstSizes);
  if (maxBurst <= 0) return null;
  const counts = new Array(maxBurst).fill(0) as number[];
  for (const s of burstSizes) {
    if (s >= 1 && s <= maxBurst) counts[s - 1]!++;
  }
  const total = burstSizes.length;
  const rows = counts.map((c, i) => ({ size: i + 1, count: c, pct: total > 0 ? c / total : 0 }));
  return { maxBurst, rows };
}

// ---- 事件时间线 ----------------------------------------------------------------

export type EventKind = "ticking" | "drone" | "phase";
export type TimelineEvent = {
  t: number;
  kind: EventKind;
  value?: number;
  phaseIdx?: number;
  phaseKind?: "wave" | "round";
};

export function buildEventTimeline(m: MissionResult): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  if (m.tickingSeries) {
    for (const p of m.tickingSeries) {
      events.push({ t: p.t, kind: "ticking", value: p.v });
    }
  }
  if (m.droneSpawnTimes) {
    for (let i = 0; i < m.droneSpawnTimes.length; i++) {
      events.push({
        t: m.droneSpawnTimes[i]!,
        kind: "drone",
        value: m.droneBurstSizes?.[i],
      });
    }
  }
  if (m.phaseBoundaryTimes) {
    const phaseKind = m.phases?.[0]?.kind;
    for (let i = 0; i < m.phaseBoundaryTimes.length; i++) {
      events.push({
        t: m.phaseBoundaryTimes[i]!,
        kind: "phase",
        phaseIdx: i + 1,
        phaseKind,
      });
    }
  }
  events.sort((a, b) => a.t - b.t);
  return events;
}

export const KIND_LABELS: Record<EventKind, string> = {
  ticking: "存活敌人",
  drone: "无人机生成",
  phase: "波次",
};

export type EventFilter = "all" | EventKind;
export const FILTER_OPTIONS: { key: EventFilter; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "ticking", label: "存活敌人" },
  { key: "drone", label: "无人机生成" },
  { key: "phase", label: "波次" },
];
