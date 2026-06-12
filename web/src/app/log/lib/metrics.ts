import type { MissionResult } from "@/lib/eelog/parser";

// ---- Buff / 评分 / 期望生息计算 -------------------------------------------------

export type BuffState = {
  blueBox: boolean; // ×2
  abundant: boolean; // ×1.18
  yellowBox: boolean; // ×2
  blessing: boolean; // ×1.25
};
export type TimeMode = "host" | "lastClient" | "manual";
export type ManualHms = { h: string; m: string; s: string };

export const BASE_DROP = 0.06;
export const EXTRA_PER_ROUND_PROB = 0.1;
export const EXTRA_PER_ROUND_AMOUNT = 3;

export function buffMultiplier(b: BuffState): number {
  let m = 1;
  if (b.blueBox) m *= 2;
  if (b.abundant) m *= 1.18;
  if (b.yellowBox) m *= 2;
  if (b.blessing) m *= 1.25;
  return m;
}

export function gradeFor(perHour?: number): string {
  if (perHour == null || !Number.isFinite(perHour)) return "-";
  if (perHour >= 800) return "S";
  if (perHour >= 700) return "A+";
  if (perHour >= 600) return "A";
  if (perHour >= 500) return "A-";
  return "F";
}

export function gradeCssClass(grade: string): string {
  if (grade === "S") return "gradeS";
  if (grade === "A+") return "gradeAPlus";
  if (grade === "A") return "gradeA";
  if (grade === "A-") return "gradeAMinus";
  return "gradeF";
}

export type MissionMetrics = ReturnType<typeof computeMetrics>;

export function computeMetrics(m: MissionResult | null | undefined, mul: number) {
  const enemySpawned = m?.spawnedAtEnd ?? undefined;
  const drones = m?.shieldDroneCount ?? undefined;
  const hostTotalSec =
    m?.eomDurationSec != null && m.eomDurationSec > 0 ? m.eomDurationSec : undefined;
  const lastClientTotalSec =
    m?.lastClientDurationSec != null && m.lastClientDurationSec > 0
      ? m.lastClientDurationSec
      : undefined;
  const waveCount = m?.waveCount;
  const roundCount = m?.roundCount;

  const expectedFromDrones =
    drones != null ? drones * BASE_DROP * mul : undefined;
  const expectedFromRounds =
    roundCount != null
      ? roundCount * (1 + EXTRA_PER_ROUND_PROB * EXTRA_PER_ROUND_AMOUNT)
      : undefined;
  const expectedTotal =
    expectedFromDrones != null && expectedFromRounds != null
      ? expectedFromDrones + expectedFromRounds
      : expectedFromDrones != null
        ? expectedFromDrones
        : expectedFromRounds != null
          ? expectedFromRounds
          : undefined;

  // 满状态（用于评分）
  const fullMul = 2 * 1.18 * 2 * 1.25;
  const fullExpectedFromDrones =
    drones != null ? drones * BASE_DROP * fullMul : undefined;
  const fullExpectedFromRounds =
    roundCount != null
      ? roundCount * (1 + EXTRA_PER_ROUND_PROB * EXTRA_PER_ROUND_AMOUNT)
      : undefined;
  const fullExpectedTotal =
    fullExpectedFromDrones != null && fullExpectedFromRounds != null
      ? fullExpectedFromDrones + fullExpectedFromRounds
      : fullExpectedFromDrones != null
        ? fullExpectedFromDrones
        : fullExpectedFromRounds != null
          ? fullExpectedFromRounds
          : undefined;

  return {
    enemySpawned,
    drones,
    hostTotalSec,
    lastClientTotalSec,
    waveCount,
    roundCount,
    expectedFromDrones,
    expectedFromRounds,
    expectedTotal,
    fullExpectedTotal,
  };
}
