"use client";

import React, { useMemo } from "react";
import type { MissionResult } from "@/lib/eelog/parser";
import {
  buildDroneBurstDistrib,
  buildDroneGapData,
  buildSatData,
  satColor,
} from "../lib/analysis";
import {
  formatDuration,
  formatNumber,
  formatPerMin,
  formatSignedPercent,
} from "../lib/format";
import {
  BASE_DROP,
  computeMetrics,
  EXTRA_PER_ROUND_AMOUNT,
  EXTRA_PER_ROUND_PROB,
  gradeCssClass,
  gradeFor,
  type ManualHms,
  type TimeMode,
} from "../lib/metrics";

export type RunCardProps = {
  m: MissionResult;
  idx: number;
  mul: number;
  nodeInfo: string;
  timeMode: TimeMode;
  manual: ManualHms;
  actualText: string;
  satPctMode: "total" | "active";
  copying: boolean;
  onCaptureRef: (idx: number, el: HTMLDivElement | null) => void;
  onTimeModeChange: (idx: number, mode: TimeMode) => void;
  onManualChange: (idx: number, field: "h" | "m" | "s", value: string) => void;
  onActualChange: (idx: number, value: string) => void;
  onSatPctModeChange: (mode: "total" | "active") => void;
  onCapture: (idx: number) => void;
  onShowDetail: (m: MissionResult, idx: number) => void;
};

export const RunCard = React.memo(function RunCard({
  m,
  idx,
  mul,
  nodeInfo,
  timeMode,
  manual,
  actualText,
  satPctMode,
  copying,
  onCaptureRef,
  onTimeModeChange,
  onManualChange,
  onActualChange,
  onSatPctModeChange,
  onCapture,
  onShowDetail,
}: RunCardProps) {
  const metrics = computeMetrics(m, mul);
  const mh = Number(manual.h);
  const mm = Number(manual.m);
  const ms = Number(manual.s);
  const manualSec =
    (Number.isFinite(mh) ? Math.max(0, mh) : 0) * 3600 +
    (Number.isFinite(mm) ? Math.max(0, mm) : 0) * 60 +
    (Number.isFinite(ms) ? Math.max(0, ms) : 0);
  const selectedSec =
    timeMode === "host"
      ? metrics.hostTotalSec
      : timeMode === "lastClient"
        ? metrics.lastClientTotalSec ?? metrics.hostTotalSec
        : manualSec > 0
          ? manualSec
          : metrics.hostTotalSec;
  const dronesPerMin =
    metrics.drones != null && selectedSec != null && selectedSec > 0
      ? metrics.drones / (selectedSec / 60)
      : undefined;
  const expectedPerHour =
    metrics.expectedTotal != null && selectedSec != null && selectedSec > 0
      ? (metrics.expectedTotal * 3600) / selectedSec
      : undefined;
  const expectedPerMin =
    metrics.expectedTotal != null && selectedSec != null && selectedSec > 0
      ? (metrics.expectedTotal * 60) / selectedSec
      : undefined;
  const fullExpectedPerHour =
    metrics.fullExpectedTotal != null && selectedSec != null && selectedSec > 0
      ? (metrics.fullExpectedTotal * 3600) / selectedSec
      : undefined;
  const grade = gradeFor(fullExpectedPerHour);
  const actualEssence = Number(actualText);
  const diffPct =
    Number.isFinite(actualEssence) &&
    metrics.expectedTotal != null &&
    metrics.expectedTotal > 0
      ? ((actualEssence - metrics.expectedTotal) / metrics.expectedTotal) * 100
      : undefined;
  const diffClass =
    diffPct != null ? (diffPct > 0 ? "diffPos" : diffPct < 0 ? "diffNeg" : "diffFlat") : "";
  const diffText = diffPct == null ? "-" : formatSignedPercent(diffPct);
  const phaseLabel =
    m.phases?.[0]?.kind === "wave"
      ? "波次"
      : m.phases?.[0]?.kind === "round"
        ? "轮次"
        : "阶段";

  // 饱和度/真空期分析在每次重渲染（如输入框打字）时重算会遍历整个时间序列，缓存住
  const sd = useMemo(
    () =>
      m.tickingSeries && m.tickingSeries.length > 0
        ? buildSatData(m.tickingSeries, metrics.hostTotalSec, selectedSec, m.phaseBoundaryTimes)
        : null,
    [m, metrics.hostTotalSec, selectedSec]
  );
  const dg = useMemo(
    () =>
      m.droneSpawnTimes && m.droneSpawnTimes.length >= 2
        ? buildDroneGapData(m.droneSpawnTimes, m.tickingSeries, metrics.hostTotalSec, selectedSec, m.phaseBoundaryTimes)
        : null,
    [m, metrics.hostTotalSec, selectedSec]
  );
  const bd = useMemo(() => buildDroneBurstDistrib(m.droneBurstSizes), [m]);

  return (
    <div className="runBlock">
      <div
        className="runCapture"
        ref={(el) => onCaptureRef(idx, el)}
      >
      <div className="runHeader">
        <div className="runLeft">
          <span className="runIndex">{String(idx + 1).padStart(2, "0")}</span>
          <span className="runSub">{nodeInfo || "-"}</span>
        </div>
        <div className={`gradeBadge ${gradeCssClass(grade)}`}>{grade}</div>
      </div>
      <div className="metricsBig">
        <div className="metric metricA">
          <div className="metricLabel">无人机生成</div>
          <div className="metricValue">{metrics.drones ?? "-"}</div>
        </div>
        <div className="metric metricB">
          <div className="metricLabel">敌人生成</div>
          <div className="metricValue">{metrics.enemySpawned ?? "-"}</div>
        </div>
        <div className="metric metricC">
          <div className="metricLabel">无人机/分钟</div>
          <div className="metricValue">{formatPerMin(dronesPerMin)}</div>
        </div>
        <div className="metric metricD">
          <div className="metricLabel">总时间</div>
          <div className="metricValue">{formatDuration(selectedSec)}</div>
        </div>
      </div>

      {(() => {
        if (!sd && !dg && !bd) return null;
        return (
          <div className="satDual">
            <div className="satModeRow">
              {copying
                ? <span className="satModeText">{satPctMode === "total" ? "总时间" : "有效时间"}</span>
                : <select
                    className="satSelect"
                    value={satPctMode}
                    onChange={(e) => onSatPctModeChange(e.target.value as "total" | "active")}
                  >
                    <option value="total">总时间</option>
                    <option value="active">有效时间</option>
                  </select>
              }
            </div>
            <div className="satDualGrid">
              {/* 左：敌人饱和度 + 无人机连续生成 */}
              {(sd || bd) && (
                <div className="satLeftStack">
                  {sd && (
                    <div className="satDistrib">
                      <div className="satTitleRow">
                        <span className="satTitle">敌人饱和度</span>
                        <span className="satMax">Max {sd.maxV}</span>
                      </div>
                      <div className="satHead">
                        <span className="satHeadLabel">存活</span>
                        <span className="satHeadSpacer" />
                        <span className="satHeadLabel">占比</span>
                      </div>
                      <div className="satRows">
                        {sd.buckets.map((b, i) => {
                          const label = b.hi != null ? `${b.lo}–${b.hi}` : `${b.lo}+`;
                          const ratio = sd.maxV > 0 ? (b.lo + (b.hi != null ? b.hi : b.lo)) / 2 / sd.maxV : 0;
                          const pct = satPctMode === "total" ? b.totalPct : b.activePct;
                          const baseSec = satPctMode === "total" ? sd.totalSec : sd.activeSec;
                          const barW = Math.max(pct > 0 ? 2 : 0, pct * 100);
                          const sec = pct * baseSec;
                          return (
                            <div className="satRow" key={i}>
                              <span className="satLabel">{label}</span>
                              <div className="satTrack">
                                <div className="satFill" style={{ width: `${barW}%`, backgroundColor: satColor(ratio) }} />
                              </div>
                              <span className="satPct">{(pct * 100).toFixed(1)}% <span className="satSub">{sec.toFixed(1)}s</span></span>
                            </div>
                          );
                        })}
                      </div>
                      <div className="satFooter">
                        ≥15 占比：{(satPctMode === "total" ? sd.gte15TotalPct : sd.gte15ActivePct).toFixed(1)}%
                      </div>
                    </div>
                  )}
                  {bd && (
                    <div className="satDistrib">
                      <div className="satTitleRow">
                        <span className="satTitle">无人机连续生成</span>
                        <span className="satMax">Max {bd.maxBurst}</span>
                      </div>
                      <div className="satHead">
                        <span className="satHeadLabel">数量</span>
                        <span className="satHeadSpacer" />
                        <span className="satHeadLabel">占比</span>
                      </div>
                      <div className="satRows">
                        {bd.rows.map((r) => {
                          const barW = Math.max(r.pct > 0 ? 2 : 0, r.pct * 100);
                          const ratio = bd.maxBurst > 1 ? (r.size - 1) / (bd.maxBurst - 1) : 0;
                          return (
                            <div className="satRow" key={r.size}>
                              <span className="satLabel">{r.size}</span>
                              <div className="satTrack">
                                <div className="satFill" style={{ width: `${barW}%`, backgroundColor: satColor(ratio) }} />
                              </div>
                              <span className="satPct">{(r.pct * 100).toFixed(1)}% <span className="satSub">{r.count}次</span></span>
                            </div>
                          );
                        })}
                      </div>
                      <div className="satFooter">
                        生成 {bd.rows.reduce((s, r) => s + r.count, 0)} 次
                      </div>
                    </div>
                  )}
                </div>
              )}
              {/* 右：无人机真空期 */}
              {dg && (
                <div className="satDistrib">
                  <div className="satTitleRow">
                    <span className="satTitle">无人机真空期</span>
                    <span className="satMax">Max {dg.maxGap}s</span>
                  </div>
                  <div className="satHead">
                    <span className="satHeadLabel">间隔(s)</span>
                    <span className="satHeadSpacer" />
                    <span className="satHeadLabel">占比</span>
                  </div>
                  <div className="satRows">
                    {dg.buckets.map((b, i) => {
                      const label = b.hi != null ? `${b.lo}–${b.hi}` : `${b.lo}+`;
                      const ratio = dg.maxGap > 0 ? (b.lo + (b.hi != null ? b.hi : b.lo)) / 2 / dg.maxGap : 0;
                      const pct = satPctMode === "total" ? b.totalPct : b.activePct;
                      const baseSec = satPctMode === "total" ? dg.totalSec : dg.activeSec;
                      const barW = Math.max(pct > 0 ? 2 : 0, pct * 100);
                      const sec = pct * baseSec;
                      return (
                        <div className="satRow" key={i}>
                          <span className="satLabel">{label}</span>
                          <div className="satTrack">
                            <div className="satFill" style={{ width: `${barW}%`, backgroundColor: satColor(ratio) }} />
                          </div>
                          <span className="satPct">{(pct * 100).toFixed(1)}% <span className="satSub">{sec.toFixed(1)}s</span></span>
                        </div>
                      );
                    })}
                  </div>
                  <div className="satFooter">
                    &gt;2s：{(satPctMode === "total" ? dg.gt2TotalPct : dg.gt2ActivePct).toFixed(1)}%
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      <div className="timeModeBar">
        <label className="modeItem">
          <input
            type="radio"
            name={`time-mode-${idx}`}
            checked={timeMode === "host"}
            onChange={() => onTimeModeChange(idx, "host")}
          />
          <span>主机时间</span>
        </label>
        <label className="modeItem">
          <input
            type="radio"
            name={`time-mode-${idx}`}
            checked={timeMode === "lastClient"}
            onChange={() => onTimeModeChange(idx, "lastClient")}
            disabled={metrics.lastClientTotalSec == null}
          />
          <span>最后客机时间 {formatDuration(metrics.lastClientTotalSec)}</span>
        </label>
        <label className="modeItem">
          <input
            type="radio"
            name={`time-mode-${idx}`}
            checked={timeMode === "manual"}
            onChange={() => onTimeModeChange(idx, "manual")}
          />
          <span>自定义时间</span>
        </label>
        {timeMode === "manual" ? (
          <label className="modeInput modeInputHms">
            <span>h</span>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="1"
              value={manual.h}
              onChange={(e) => onManualChange(idx, "h", e.target.value)}
            />
            <span>m</span>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="1"
              value={manual.m}
              onChange={(e) => onManualChange(idx, "m", e.target.value)}
            />
            <span>s</span>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="1"
              value={manual.s}
              onChange={(e) => onManualChange(idx, "s", e.target.value)}
            />
          </label>
        ) : null}
        <label className="modeInput">
          <span>实际生息</span>
          <input
            type="number"
            inputMode="decimal"
            min="0"
            step="0.1"
            value={actualText}
            onChange={(e) => onActualChange(idx, e.target.value)}
          />
        </label>
        <button
          className={`screenshotBtn${copying ? " copying" : ""}`}
          style={{ marginLeft: "auto" }}
          onClick={() => onCapture(idx)}
          disabled={copying}
          data-shot-ignore="true"
        >
          {copying ? "✓" : "截图"}
        </button>
      </div>

      <div className="metricsSmall">
        <div className="mini">
          <div className="miniLabel">波次</div>
          <div className="miniValue">{metrics.waveCount ?? "-"}</div>
        </div>
        <div className="mini">
          <div className="miniLabel">轮次</div>
          <div className="miniValue">{metrics.roundCount ?? "-"}</div>
        </div>
        <div className="mini">
          <div className="miniLabel">期望生息</div>
          <div className="miniValue">{formatNumber(metrics.expectedTotal, 3)}</div>
        </div>
        <div className="mini miniDual">
          <div className="miniLabel">生息速率</div>
          <div className="miniSub">h: {formatNumber(expectedPerHour, 1)}</div>
          <div className="miniSub">min: {formatNumber(expectedPerMin, 2)}</div>
        </div>
        {actualText.trim() ? (
          <div className="mini">
            <div className="miniLabel">偏差</div>
            <div className={`miniValue ${diffClass}`}>{diffText}</div>
          </div>
        ) : null}
      </div>

      </div>{/* /runCapture */}

      <details className="detail">
        <summary>查看详细</summary>
        <div className="detailInner">
          <div className="detailMeta">
            <div className="kv">
              <div className="k">{phaseLabel}</div>
              <div className="v">
                {(() => {
                  const wpr =
                    metrics.waveCount != null &&
                    metrics.roundCount != null &&
                    metrics.roundCount > 0
                      ? Math.round(metrics.waveCount / metrics.roundCount)
                      : 3;
                  if (m.phases?.[0]?.kind === "wave") {
                    return `${metrics.waveCount ?? "-"} 波 / ${metrics.roundCount ?? "-"} 轮（每 ${wpr} 波 1 轮）`;
                  }
                  if (
                    m.phases?.[0]?.kind === "round" &&
                    metrics.waveCount != null &&
                    metrics.roundCount != null &&
                    metrics.waveCount > metrics.roundCount
                  ) {
                    return `${metrics.waveCount} 波 / ${metrics.roundCount} 轮（每 2 波 1 轮）`;
                  }
                  if (m.phases?.[0]?.kind === "round") {
                    return `${metrics.roundCount ?? "-"} 轮`;
                  }
                  return "-";
                })()}
              </div>
            </div>
            <div className="kv">
              <div className="k">轮次奖励期望</div>
              <div className="v">
                {metrics.roundCount != null
                  ? `${formatNumber(
                      metrics.roundCount *
                        (1 + EXTRA_PER_ROUND_PROB * EXTRA_PER_ROUND_AMOUNT),
                      3
                    )}（保底 ${metrics.roundCount} + 额外期望 ${formatNumber(
                      metrics.roundCount *
                        (EXTRA_PER_ROUND_PROB * EXTRA_PER_ROUND_AMOUNT),
                      3
                    )}）`
                  : "-"}
              </div>
            </div>
            <div className="kv">
              <div className="k">无人机掉落倍率</div>
              <div className="v">× {formatNumber(mul, 2)}</div>
            </div>
          </div>

          {Array.isArray(m.phases) && m.phases.length ? (
            <div className="phaseTable">
              <div className="phaseRow phaseHead">
                <div className="c1">{phaseLabel}</div>
                <div className="c2">无人机生成（总）</div>
                <div className="c3">无人机期望生息（总）</div>
              </div>
              {(() => {
                let cumDrones = 0;
                let cumExpected = 0;
                return m.phases.map((p) => {
                  cumDrones += p.shieldDroneCount;
                  const perExpected = p.shieldDroneCount * BASE_DROP * mul;
                  cumExpected += perExpected;
                  // 每轮波数：普通防御=3，镜像防御=2；用比值动态推算
                  const wavesPerRound =
                    metrics.waveCount != null &&
                    metrics.roundCount != null &&
                    metrics.roundCount > 0
                      ? Math.round(metrics.waveCount / metrics.roundCount)
                      : 3;
                  // 轮次模式下 waveCount > roundCount 表示镜像防御降级（无单波标记）
                  const isMirrorRoundMode =
                    p.kind === "round" &&
                    metrics.waveCount != null &&
                    metrics.roundCount != null &&
                    metrics.waveCount > metrics.roundCount;
                  const label =
                    p.kind === "wave"
                      ? `第 ${p.index} 波（第 ${Math.ceil(p.index / wavesPerRound)} 轮）`
                      : isMirrorRoundMode
                        ? `第 ${p.index} 轮（第 ${p.index * 2 - 1}–${p.index * 2} 波）`
                        : p.partial
                          ? `第 ${p.index} 轮（不完整）`
                          : `第 ${p.index} 轮`;
                  return (
                    <div key={`${p.kind}-${p.index}`} className="phaseRow">
                      <div className="c1">{label}</div>
                      <div className="c2">
                        {p.shieldDroneCount}
                        <span className="phaseCum">（{cumDrones}）</span>
                      </div>
                      <div className="c3">
                        {formatNumber(perExpected, 3)}
                        <span className="phaseCum">（{formatNumber(cumExpected, 0)}）</span>
                      </div>
                    </div>
                  );
                });
              })()}
            </div>
          ) : (
            <div className="detailEmpty">该把日志段内未识别到 {phaseLabel} 标记</div>
          )}
        </div>
      </details>

      <div className="detailBtnRow" data-shot-ignore="true">
        <button
          className="detailBtn"
          onClick={() => onShowDetail(m, idx)}
        >
          查看时间线
        </button>
      </div>
    </div>
  );
});
