"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { MissionResult } from "@/lib/eelog/parser";
import {
  buildEventTimeline,
  FILTER_OPTIONS,
  KIND_LABELS,
  type EventFilter,
  type EventKind,
} from "../lib/analysis";
import { TimelineChart } from "./TimelineChart";

export function DetailOverlay({
  m,
  runIdx,
  nodeInfo,
  onClose,
}: {
  m: MissionResult;
  runIdx: number;
  nodeInfo: string;
  onClose: () => void;
}) {
  const [filter, setFilter] = useState<EventFilter>("all");
  const [chartRange, setChartRange] = useState<[number, number] | null>(null);
  const [speed, setSpeed] = useState(1);
  const [playTrigger, setPlayTrigger] = useState<{ t: number; seq: number } | null>(null);
  const [skipFn, setSkipFn] = useState<(() => void) | null>(null);
  const [viewMode, setViewMode] = useState<"scroll" | "browse" | "full">("scroll");
  const [followPlay, setFollowPlay] = useState(false);
  const toggleViewFnRef = useRef<(() => void) | null>(null);
  const resumeFnRef = useRef<(() => void) | null>(null);
  const playheadRef = useRef<number | null>(null);
  const allEvents = useMemo(() => buildEventTimeline(m), [m]);
  const events = useMemo(() => {
    let evts = filter === "all" ? allEvents : allEvents.filter((e) => e.kind === filter);
    if (chartRange) evts = evts.filter((e) => e.t >= chartRange[0] && e.t <= chartRange[1]);
    return evts;
  }, [allEvents, filter, chartRange]);
  const handlePlayFrom = (t: number) => setPlayTrigger({ t, seq: Date.now() });

  const bodyRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(followPlay);
  useEffect(() => { followRef.current = followPlay; }, [followPlay]);
  const eventsRef = useRef(events);
  useEffect(() => { eventsRef.current = events; }, [events]);

  const rowVirtualizer = useVirtualizer({
    count: events.length,
    getScrollElement: () => bodyRef.current,
    estimateSize: () => 28,
    overscan: 12,
  });
  const virtualizerRef = useRef(rowVirtualizer);
  useEffect(() => { virtualizerRef.current = rowVirtualizer; }, [rowVirtualizer]);

  const handlePlayhead = useMemo(() => {
    let last = 0;
    return (t: number | null) => {
      playheadRef.current = t;
      if (t == null || !followRef.current) return;
      const now = performance.now();
      if (now - last < 120) return;
      last = now;
      const evs = eventsRef.current;
      if (evs.length === 0) return;
      let lo = 0, hi = evs.length - 1;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (evs[mid]!.t < t) lo = mid + 1; else hi = mid; }
      virtualizerRef.current.scrollToIndex(lo, { align: "center", behavior: "smooth" });
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // TimelineChart 主 effect 的依赖：必须是稳定引用，否则每次渲染都会重建画布动画
  const handleSkipReady = useCallback((fn: (() => void) | null) => setSkipFn(() => fn), []);
  const handleToggleViewReady = useCallback((fn: (() => void) | null) => {
    toggleViewFnRef.current = fn;
  }, []);
  const handleResumeReady = useCallback((fn: (() => void) | null) => {
    resumeFnRef.current = fn;
  }, []);

  const counts = useMemo(() => {
    const c: Record<EventKind, number> = { ticking: 0, drone: 0, phase: 0 };
    for (const e of allEvents) c[e.kind]++;
    return c;
  }, [allEvents]);

  return (
    <div
      className="detailOverlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="detailPanel">
        <div className="detailHeader">
          <span className="detailTitle">Run #{runIdx + 1} — {nodeInfo}</span>
          <span className="detailTotalCount">{events.length.toLocaleString()} 条</span>
          <button className="detailClose" onClick={onClose} title="关闭 (Esc)">✕</button>
        </div>
        <div className="chartControlsWrap">
          <TimelineChart
            allEvents={allEvents}
            selectedRange={chartRange}
            onRangeChange={setChartRange}
            playFromTime={playTrigger}
            speed={speed}
            onSkipReady={handleSkipReady}
            onPlayheadChange={handlePlayhead}
            onViewModeChange={setViewMode}
            onToggleViewReady={handleToggleViewReady}
            onResumeReady={handleResumeReady}
          />
          <div className="speedControls">
            <button
              className={`speedBtn${(viewMode === "browse" || speed === 0) ? " active" : ""}`}
              onClick={() => {
                if (viewMode === "browse") {
                  if (speed === 0) setSpeed(1);
                  resumeFnRef.current?.();
                } else {
                  setSpeed(speed === 0 ? 1 : 0);
                }
              }}
            >{(viewMode === "browse" || speed === 0) ? "▶" : "⏸"}</button>
            {[0.1, 0.25, 0.5, 1, 2].map((s) => (
              <button
                key={s}
                className={`speedBtn${speed === s && viewMode !== "browse" ? " active" : ""}`}
                onClick={() => {
                  setSpeed(s);
                  if (viewMode === "browse") {
                    setTimeout(() => resumeFnRef.current?.(), 0);
                  }
                }}
              >{s}×</button>
            ))}
            <input
              className="speedInput"
              type="number"
              min="0"
              step="0.1"
              value={speed}
              onChange={(e) => {
                const raw = e.target.value;
                if (raw === "" || raw === "-") { setSpeed(0); return; }
                const v = parseFloat(raw);
                if (Number.isFinite(v) && v >= 0) setSpeed(v);
              }}
              title="自定义倍速"
            />
            <span className="speedInputUnit">×</span>
            {skipFn && (
              <button className="speedBtn speedBtnSkip" onClick={skipFn}>跳过 ⏭</button>
            )}
            {viewMode !== "scroll" && (
              <button
                className="speedBtn speedBtnView"
                onClick={() => toggleViewFnRef.current?.()}
              >{viewMode === "browse" ? "全景" : "窗口"}</button>
            )}
          </div>
        </div>
        <div className="detailFilters">
          {FILTER_OPTIONS.map(({ key, label }) => (
            <button
              key={key}
              className={`detailFilter detailFilter-${key}${filter === key ? " active" : ""}`}
              onClick={() => setFilter(key)}
            >
              {label}
              {key !== "all" && <span className="detailFilterCount">{counts[key as EventKind]}</span>}
            </button>
          ))}
          {chartRange && (
            <div className="chartRangeTag">
              <span>{chartRange[0].toFixed(1)}s – {chartRange[1].toFixed(1)}s</span>
              <button className="chartRangeClear" onClick={() => setChartRange(null)} title="清除时间筛选">✕</button>
            </div>
          )}
          <button
            className={`detailFilter detailFilterFollow${followPlay ? " active" : ""}`}
            onClick={() => setFollowPlay((v) => !v)}
            title={followPlay ? "表格跟随播放中，点击关闭" : "表格不跟随，点击开启"}
          >{followPlay ? "跟随 ✓" : "跟随"}</button>
        </div>
        <div className="detailTableHead">
          <span className="dtTime">时间 (s)</span>
          <span className="dtKind">类型</span>
          <span className="dtVal">数值</span>
        </div>
        <div className="detailBody" ref={bodyRef}>
          <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, position: "relative" }}>
            {rowVirtualizer.getVirtualItems().map((vRow) => {
              const ev = events[vRow.index]!;
              const valText =
                ev.kind === "ticking"
                  ? String(ev.value ?? "-")
                  : ev.kind === "drone"
                    ? `×${ev.value ?? 1}`
                    : `第 ${ev.phaseIdx} 波`;
              return (
                <div
                  key={vRow.index}
                  className={`dtRow dtRow-${ev.kind}`}
                  style={{
                    position: "absolute",
                    top: 0,
                    transform: `translateY(${vRow.start}px)`,
                    height: `${vRow.size}px`,
                    width: "100%",
                  }}
                >
                  <span className="dtTime dtTimeLink" onClick={() => handlePlayFrom(ev.t)} title="从此处播放">{ev.t.toFixed(2)}</span>
                  <span className="dtKind">{KIND_LABELS[ev.kind]}</span>
                  <span className="dtVal">{valText}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
