"use client";

import React, { useEffect, useMemo, useRef } from "react";
import type { TimelineEvent } from "../lib/analysis";

export function TimelineChart({
  allEvents,
  selectedRange,
  onRangeChange,
  playFromTime,
  speed,
  onSkipReady,
  onPlayheadChange,
  onViewModeChange,
  onToggleViewReady,
  onResumeReady,
}: {
  allEvents: TimelineEvent[];
  selectedRange: [number, number] | null;
  onRangeChange: (r: [number, number] | null) => void;
  playFromTime: { t: number; seq: number } | null;
  speed: number;
  onSkipReady: (skipFn: (() => void) | null) => void;
  onPlayheadChange: (t: number | null) => void;
  onViewModeChange: (mode: "scroll" | "browse" | "full") => void;
  onToggleViewReady: (fn: (() => void) | null) => void;
  onResumeReady: (fn: (() => void) | null) => void;
}) {
  const canvasRef        = useRef<HTMLCanvasElement>(null);
  const sliderRef        = useRef<HTMLInputElement>(null);
  const animRef          = useRef<number>(0);
  const redrawRef        = useRef<((r: [number, number] | null) => void) | null>(null);
  const startScrollRef   = useRef<((sec: number) => void) | null>(null);
  const jumpToRef        = useRef<((sec: number) => void) | null>(null);
  const resumeRef        = useRef<(() => void) | null>(null);
  const skipRef          = useRef<(() => void) | null>(null);
  const toggleViewRef    = useRef<(() => void) | null>(null);
  const selectedRangeRef = useRef(selectedRange);
  const speedRef         = useRef(speed);

  useEffect(() => { speedRef.current = speed; }, [speed]);
  useEffect(() => { selectedRangeRef.current = selectedRange; }, [selectedRange]);
  useEffect(() => { redrawRef.current?.(selectedRangeRef.current); }, [selectedRange]);
  const lastPlaySeqRef = useRef(0);
  useEffect(() => {
    if (playFromTime != null && playFromTime.seq !== lastPlaySeqRef.current) {
      lastPlaySeqRef.current = playFromTime.seq;
      setTimeout(() => startScrollRef.current?.(playFromTime.t), 0);
    }
  }, [playFromTime]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    cancelAnimationFrame(animRef.current);
    const cv = canvas;

    const W = cv.offsetWidth, H = cv.offsetHeight;
    if (W === 0 || H === 0) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = W * dpr; cv.height = H * dpr;
    const ctxRaw = cv.getContext("2d");
    if (!ctxRaw) return;
    const c = ctxRaw;
    c.scale(dpr, dpr);

    const ticking = allEvents.filter((e) => e.kind === "ticking");
    const drones  = allEvents.filter((e) => e.kind === "drone");
    const phases  = allEvents.filter((e) => e.kind === "phase");
    if (ticking.length === 0 && drones.length === 0) return;

    const maxT  = Math.max(...allEvents.map((e) => e.t), 1);
    const maxV  = Math.max(...ticking.map((e) => e.value ?? 0), 1);
    const maxDC = Math.max(...drones.map((e) => e.value ?? 1), 1);

    const PAD = { top: 10, right: 12, bottom: 24, left: 42 };
    const cW = W - PAD.left - PAD.right;
    const cH = H - PAD.top - PAD.bottom;
    const aH = Math.floor(cH * 0.62);
    const aTop = PAD.top, aBot = PAD.top + aH;
    const divY = aBot + 1, dTop = divY + 2, dBot = PAD.top + cH;
    const dH = cH - aH - 3;

    const isDark = !!document.documentElement.getAttribute("data-theme");
    const labelC  = isDark ? "rgb(190,190,190)" : "rgb(30,24,16)";
    const gridC   = isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.10)";
    const divC    = isDark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.14)";
    const lineC   = isDark ? "rgb(55,210,85)" : "rgb(0,125,42)";
    const phaseC  = isDark ? "rgba(255,200,50,0.85)" : "rgba(130,80,0,0.92)";
    const bandC   = isDark ? "rgba(255,255,255,0.026)" : "rgba(0,0,0,0.028)";
    const selFill = isDark ? "rgba(255,255,255,0.09)" : "rgba(60,80,220,0.09)";
    const selBord = isDark ? "rgba(255,255,255,0.38)" : "rgba(60,80,220,0.55)";
    const aFillT  = isDark ? "rgba(55,210,85,0.28)" : "rgba(0,140,50,0.23)";
    const aFillB  = isDark ? "rgba(55,210,85,0.02)" : "rgba(0,140,50,0.02)";
    const sFillT  = isDark ? "rgba(65,168,255,0.78)" : "rgba(10,62,192,0.68)";
    const sFillB  = isDark ? "rgba(65,168,255,0.10)" : "rgba(10,62,192,0.08)";
    const droneC  = isDark ? "rgb(65,168,255)" : "rgb(10,62,192)";

    const windowDur   = Math.min(maxT * 0.22, 120);
    const totalScroll = Math.max(0, maxT - windowDur);
    const BASE_MS     = Math.max(6000, totalScroll * 25);

    const waveBounds = [0, ...phases.map((p) => p.t), maxT];

    const step = Math.max(1, Math.floor(ticking.length / 600));
    const sampled: TimelineEvent[] = ticking.filter((_, i) => i % step === 0);
    const lastPt = ticking[ticking.length - 1];
    if (lastPt && sampled[sampled.length - 1] !== lastPt) sampled.push(lastPt);

    function yA(v: number) { return aTop + (1 - v / maxV) * aH; }
    function yD(n: number) { return dBot - (n / maxDC) * dH * 0.82; }

    const xOfFull = (t: number) => PAD.left + (t / maxT) * cW;
    const fullPts = sampled.map((e) => ({ x: xOfFull(e.t), y: yA(e.value ?? 0) }));

    function catmullSegments(pts: { x: number; y: number }[]) {
      for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[Math.max(0, i - 1)]!;
        const p1 = pts[i]!;
        const p2 = pts[i + 1]!;
        const p3 = pts[Math.min(pts.length - 1, i + 2)]!;
        c.bezierCurveTo(
          p1.x + (p2.x - p0.x) / 6, p1.y + (p2.y - p0.y) / 6,
          p2.x - (p3.x - p1.x) / 6, p2.y - (p3.y - p1.y) / 6,
          p2.x, p2.y,
        );
      }
    }

    function fmtTime(sec: number) {
      const s = Math.round(sec);
      const mm = Math.floor(s / 60), ss = s % 60;
      return mm > 0 ? `${mm}:${String(ss).padStart(2, "0")}` : `${s}s`;
    }

    function drawScene(
      xOf: (t: number) => number,
      tA: number, tB: number,
      pts: { x: number; y: number }[],
      xTicks: number[],
      range: [number, number] | null,
    ) {
      c.clearRect(0, 0, W, H);

      c.fillStyle = labelC; c.font = "bold 12px sans-serif";
      c.textAlign = "right"; c.textBaseline = "middle";
      c.fillText(String(maxV), PAD.left - 4, aTop);
      c.fillText("0", PAD.left - 4, aBot);
      c.fillStyle = isDark ? "rgba(65,168,255,0.7)" : "rgba(10,62,192,0.7)";
      c.font = "bold 10px sans-serif";
      c.fillText("生成", PAD.left - 4, (dTop + dBot) / 2);

      c.fillStyle = labelC; c.font = "bold 12px sans-serif";
      c.textAlign = "center"; c.textBaseline = "top";
      for (const t of xTicks) c.fillText(fmtTime(t), xOf(t), dBot + 4);

      c.save();
      c.beginPath(); c.rect(PAD.left, 0, cW, H); c.clip();

      for (let i = 1; i < waveBounds.length - 1; i += 2) {
        const lo = waveBounds[i]!, hi = waveBounds[i + 1]!;
        if (hi <= tA || lo >= tB) continue;
        const x1 = Math.max(PAD.left, xOf(Math.max(lo, tA)));
        const x2 = Math.min(PAD.left + cW, xOf(Math.min(hi, tB)));
        if (x2 > x1) { c.fillStyle = bandC; c.fillRect(x1, aTop, x2 - x1, cH); }
      }

      c.strokeStyle = gridC; c.lineWidth = 0.5;
      for (let i = 0; i <= 4; i++) {
        const y = aTop + (i / 4) * aH;
        c.beginPath(); c.moveTo(PAD.left, y); c.lineTo(PAD.left + cW, y); c.stroke();
      }

      c.strokeStyle = divC; c.lineWidth = 1;
      c.beginPath(); c.moveTo(PAD.left, divY); c.lineTo(PAD.left + cW, divY); c.stroke();

      if (range) {
        const x1 = Math.max(PAD.left, xOfFull(range[0]));
        const x2 = Math.min(PAD.left + cW, xOfFull(range[1]));
        if (x2 > x1) {
          c.fillStyle = selFill; c.fillRect(x1, aTop, x2 - x1, cH);
          c.strokeStyle = selBord; c.lineWidth = 1; c.strokeRect(x1, aTop, x2 - x1, cH);
        }
      }

      c.font = "bold 9px sans-serif"; c.textAlign = "center"; c.textBaseline = "top";
      for (const p of phases) {
        if (p.t < tA - 2 || p.t > tB + 2) continue;
        const x = xOf(p.t);
        c.setLineDash([3, 3]); c.strokeStyle = phaseC; c.lineWidth = 1;
        c.beginPath(); c.moveTo(x, aTop); c.lineTo(x, dBot); c.stroke();
        c.setLineDash([]);
        c.fillStyle = phaseC;
        c.fillText(`第${p.phaseIdx ?? ""}波`, x, aTop + 2);
      }

      if (pts.length >= 2) {
        const grad = c.createLinearGradient(0, aTop, 0, aBot);
        grad.addColorStop(0, aFillT); grad.addColorStop(1, aFillB);
        c.beginPath(); c.moveTo(pts[0]!.x, aBot); c.lineTo(pts[0]!.x, pts[0]!.y);
        catmullSegments(pts);
        c.lineTo(pts[pts.length - 1]!.x, aBot); c.closePath();
        c.fillStyle = grad; c.fill();

        c.beginPath(); c.moveTo(pts[0]!.x, pts[0]!.y);
        catmullSegments(pts);
        c.strokeStyle = lineC; c.lineWidth = 1.8; c.stroke();
      }

      c.strokeStyle = isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.07)";
      c.lineWidth = 0.5;
      c.beginPath(); c.moveTo(PAD.left, dBot); c.lineTo(PAD.left + cW, dBot); c.stroke();

      c.font = "bold 8px sans-serif"; c.textAlign = "center"; c.textBaseline = "bottom";
      for (const d of drones) {
        if (d.t < tA || d.t > tB) continue;
        const x = xOf(d.t), cnt = d.value ?? 1, yt = yD(cnt);
        const sg = c.createLinearGradient(0, yt, 0, dBot);
        sg.addColorStop(0, sFillT); sg.addColorStop(1, sFillB);
        c.fillStyle = sg; c.fillRect(x - 1.5, yt, 3, dBot - yt);
        if (cnt > 1) { c.fillStyle = droneC; c.fillText(`\u00d7${cnt}`, x, yt - 1); }
      }

      c.restore();
    }

    function drawScrollFrame(wStart: number) {
      const xOf = (t: number) => PAD.left + ((t - wStart) / windowDur) * cW;
      const xTicks = Array.from({ length: 6 }, (_, i) => wStart + (i / 5) * windowDur);
      const marg = windowDur * 0.06;
      const visPts = sampled
        .filter((e) => e.t >= wStart - marg && e.t <= wStart + windowDur + marg)
        .map((e) => ({ x: xOf(e.t), y: yA(e.value ?? 0) }));
      drawScene(xOf, wStart, wStart + windowDur, visPts, xTicks, null);
    }

    function drawFull(range: [number, number] | null) {
      const xTicks = Array.from({ length: 7 }, (_, i) => (i / 6) * maxT);
      drawScene(xOfFull, 0, maxT, fullPts, xTicks, range);
    }

    let animMode: "scroll" | "browse" | "full" = "scroll";
    let browseStart = 0;
    let isDragging = false;
    let dragStartT = 0;
    let dragMoved  = false;

    const slider = sliderRef.current;

    function setMode(m: typeof animMode) { animMode = m; onViewModeChange(m); }

    redrawRef.current = (r) => { if (animMode === "full") drawFull(r); };

    function drawBrowse(wStart: number) {
      browseStart = Math.max(0, Math.min(wStart, totalScroll));
      drawScrollFrame(browseStart);
      if (slider) slider.value = String(Math.round((browseStart / Math.max(totalScroll, 1)) * 1000));
    }

    function enterBrowse(wStart: number) {
      cancelAnimationFrame(animRef.current);
      setMode("browse");
      onRangeChange(null);
      onSkipReady(null);
      onPlayheadChange(null);
      drawBrowse(wStart);
    }

    function enterFull() {
      cancelAnimationFrame(animRef.current);
      setMode("full");
      redrawRef.current = (r) => drawFull(r);
      drawFull(selectedRangeRef.current);
      onRangeChange(null);
      onSkipReady(null);
      onPlayheadChange(null);
      if (slider) slider.value = "1000";
    }

    const toggleView = () => {
      if (animMode === "scroll") return;
      if (animMode === "full") enterBrowse(browseStart);
      else enterFull();
    };
    toggleViewRef.current = toggleView;
    onToggleViewReady(toggleView);

    function clientXToTime(clientX: number) {
      const rect = cv.getBoundingClientRect();
      return Math.max(0, Math.min(maxT, ((clientX - rect.left - PAD.left) / cW) * maxT));
    }

    function startScrollFrom(startSec: number) {
      cancelAnimationFrame(animRef.current);
      setMode("scroll");
      onRangeChange(null);
      const scrollFrom = Math.max(0, Math.min(startSec, totalScroll));
      const remainScroll = totalScroll - scrollFrom;
      const baseRemainMs = Math.max(2000, remainScroll * 25);
      let prevNow = performance.now();
      let progress = 0;
      function anim(now: number) {
        const dt = now - prevNow; prevNow = now;
        progress += dt * speedRef.current / baseRemainMs;
        if (progress >= 1) { progress = 1; }
        const curStart = scrollFrom + progress * remainScroll;
        drawScrollFrame(curStart);
        if (slider) slider.value = String(Math.round((curStart / Math.max(totalScroll, 1)) * 1000));
        onPlayheadChange(curStart + windowDur * 0.5);
        if (progress < 1) { animRef.current = requestAnimationFrame(anim); }
        else { enterBrowse(totalScroll); }
      }
      animRef.current = requestAnimationFrame(anim);
      onSkipReady(() => enterFull());
    }
    startScrollRef.current = startScrollFrom;
    jumpToRef.current = (sec: number) => enterBrowse(Math.max(0, sec - windowDur * 0.5));
    resumeRef.current = () => { if (animMode === "browse") startScrollFrom(browseStart); };
    onResumeReady(resumeRef.current);

    let sliderDragging = false;
    function onSliderInput() {
      if (!slider) return;
      sliderDragging = true;
      const ratio = Number(slider.value) / 1000;
      if (animMode !== "browse") {
        cancelAnimationFrame(animRef.current);
        setMode("browse");
        onSkipReady(null);
        onPlayheadChange(null);
      }
      drawBrowse(ratio * totalScroll);
    }
    function onSliderChange() {
      if (!slider || !sliderDragging) return;
      sliderDragging = false;
      startScrollFrom(browseStart);
    }
    slider?.addEventListener("input", onSliderInput);
    slider?.addEventListener("change", onSliderChange);

    function onMouseDown(e: MouseEvent) {
      if (animMode === "scroll") {
        enterBrowse(browseStart);
        return;
      }
      if (animMode === "full") {
        isDragging = true; dragMoved = false; dragStartT = clientXToTime(e.clientX);
        return;
      }
      isDragging = true; dragMoved = false; dragStartT = e.clientX;
    }
    function onMouseMove(e: MouseEvent) {
      if (!isDragging) return;
      dragMoved = true;
      if (animMode === "full") {
        drawFull([Math.min(dragStartT, clientXToTime(e.clientX)), Math.max(dragStartT, clientXToTime(e.clientX))]);
      } else if (animMode === "browse") {
        const dx = e.clientX - dragStartT;
        dragStartT = e.clientX;
        const dtSec = -(dx / cW) * windowDur;
        drawBrowse(browseStart + dtSec);
      }
    }
    function onMouseUp(e: MouseEvent) {
      if (!isDragging) return;
      isDragging = false;
      if (animMode === "full") {
        if (!dragMoved) {
          startScrollFrom(clientXToTime(e.clientX));
          return;
        }
        const lo = Math.min(dragStartT, clientXToTime(e.clientX));
        const hi = Math.max(dragStartT, clientXToTime(e.clientX));
        if (hi - lo < maxT * 0.005) { onRangeChange(null); drawFull(null); }
        else { onRangeChange([lo, hi]); drawFull([lo, hi]); }
      }
    }

    cv.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);

    startScrollFrom(0);

    return () => {
      cancelAnimationFrame(animRef.current);
      cv.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      slider?.removeEventListener("input", onSliderInput);
      slider?.removeEventListener("change", onSliderChange);
      onToggleViewReady(null);
      onResumeReady(null);
    };
  }, [allEvents, onRangeChange]);

  const phases = useMemo(() => allEvents.filter((e) => e.kind === "phase"), [allEvents]);
  const maxT = useMemo(() => Math.max(...allEvents.map((e) => e.t), 1), [allEvents]);

  return (
    <div className="chartCanvasWrap">
      <canvas ref={canvasRef} className="detailChart" style={{ cursor: "crosshair" }} />
      <div className="chartSliderWrap">
        <input
          ref={sliderRef}
          type="range"
          className="chartSlider"
          min={0}
          max={1000}
          defaultValue={0}
        />
        <div className="chartSliderTicks">
          {(() => {
            const total = phases.length;
            const step = total <= 20 ? 1 : total <= 50 ? 5 : total <= 100 ? 10 : 20;
            return phases.map((p) => {
              const idx = p.phaseIdx ?? 0;
              const showLabel = idx === 1 || idx % step === 0 || idx === total;
              return (
                <span
                  key={p.t}
                  className={`chartSliderTick${showLabel ? "" : " tickOnly"}`}
                  style={{ left: `${(p.t / maxT) * 100}%` }}
                  title={`第${idx}波 — ${p.t.toFixed(0)}s`}
                >
                  {showLabel ? idx : ""}
                </span>
              );
            });
          })()}
        </div>
      </div>
    </div>
  );
}
