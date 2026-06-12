"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toCanvas } from "html-to-image";
import type { MissionResult, ParseResult } from "@/lib/eelog/parser";
import { parseEeLogInWorker } from "@/lib/eelog/parseInWorker";
import { DetailOverlay } from "./components/DetailOverlay";
import { RunCard } from "./components/RunCard";
import { t } from "./lib/format";
import {
  BASE_DROP,
  buffMultiplier,
  type BuffState,
  type ManualHms,
  type TimeMode,
} from "./lib/metrics";

type NodeMeta = {
  nodeId: string;
  nodeName?: string;
  systemName?: string;
  missionType?: string;
  faction?: string;
};

type RegionInfo = {
  name?: string;
  systemName?: string;
  missionType?: string;
  missionName?: string;
  factionName?: string;
};

const EMPTY_HMS: ManualHms = { h: "", m: "", s: "" };

const BASE_PATH = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/$/, "");

// File System Access API（Chrome/Edge）：按 id 持久记住上次使用的目录，
// 用户第一次选过 EE.log 后，之后的选择框都直接停在 Warframe 日志目录
type OpenFilePickerFn = (opts?: {
  id?: string;
  multiple?: boolean;
  types?: { description?: string; accept: Record<string, string[]> }[];
}) => Promise<Array<{ getFile: () => Promise<File> }>>;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/**
 * 在画布上铺出与页面一致的“玻璃背后”：
 * 背景图 cover 填满 + 模糊（等效 backdrop-filter）+ 暗角遮罩 + 面板玻璃底色。
 * 卡片本身以透明 PNG 叠在上面，出图观感与页面相同。
 */
async function paintGlassBackdrop(ctx: CanvasRenderingContext2D, w: number, h: number, pr: number) {
  ctx.fillStyle = "#11131d";
  ctx.fillRect(0, 0, w, h);
  try {
    const bg = await loadImage(`${BASE_PATH}/bg.jpg`);
    const scale = Math.max(w / bg.naturalWidth, h / bg.naturalHeight);
    const dw = bg.naturalWidth * scale;
    const dh = bg.naturalHeight * scale;
    if (typeof ctx.filter === "string") ctx.filter = `blur(${18 * pr}px) saturate(150%)`;
    ctx.drawImage(bg, (w - dw) / 2, (h - dh) / 2, dw, dh);
    ctx.filter = "none";
  } catch {
    // 背景图加载失败就保留纯底色
  }
  const vignette = ctx.createLinearGradient(0, 0, 0, h);
  vignette.addColorStop(0, "rgba(10, 12, 22, 0.5)");
  vignette.addColorStop(0.5, "rgba(10, 12, 22, 0.25)");
  vignette.addColorStop(1, "rgba(10, 12, 22, 0.65)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, w, h);
  const panel = ctx.createLinearGradient(0, 0, w * 0.4, h);
  panel.addColorStop(0, "rgba(28, 30, 44, 0.52)");
  panel.addColorStop(1, "rgba(16, 18, 30, 0.40)");
  ctx.fillStyle = panel;
  ctx.fillRect(0, 0, w, h);
}

export default function Page() {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const lastFileRef = useRef<File | null>(null);
  const captureRefs = useRef<Array<HTMLDivElement | null>>([]);
  const [copyingIdx, setCopyingIdx] = useState<number | null>(null);
  const [satPctMode, setSatPctMode] = useState<"total" | "active">("active");
  const [detailState, setDetailState] = useState<{ m: MissionResult; idx: number } | null>(null);

  const [isDragOver, setIsDragOver] = useState(false);
  const [eePathCopied, setEePathCopied] = useState(false);
  const copyEePath = async () => {
    try {
      await navigator.clipboard.writeText("%LOCALAPPDATA%\\Warframe");
      setEePathCopied(true);
      setTimeout(() => setEePathCopied(false), 1500);
    } catch {
      // 剪贴板不可用时忽略（http 或旧浏览器）
    }
  };
  const [parse, setParse] = useState<ParseResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [regions, setRegions] = useState<Record<string, RegionInfo> | null>(null);
  const [dictZh, setDictZh] = useState<Record<string, string> | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [showCount, setShowCount] = useState<number>(2);
  const [showCountInput, setShowCountInput] = useState<string>("2");
  const [displayCount, setDisplayCount] = useState<number>(2);
  const [timeModeByIdx, setTimeModeByIdx] = useState<Record<number, TimeMode>>({});
  const [manualHmsByIdx, setManualHmsByIdx] = useState<Record<number, ManualHms>>({});
  const [actualEssenceByIdx, setActualEssenceByIdx] = useState<Record<number, string>>({});
  const [buffs, setBuffs] = useState<BuffState>({
    blueBox: true,
    abundant: true,
    yellowBox: true,
    blessing: true,
  });
  const mul = useMemo(() => buffMultiplier(buffs), [buffs]);

  const missions = useMemo<MissionResult[]>(() => parse?.missions ?? [], [parse]);
  const visibleMissions = useMemo(() => {
    if (displayCount <= 0) return [];
    if (missions.length <= displayCount) return missions;
    // 展示“最近”的 N 次：取末尾
    return missions.slice(Math.max(0, missions.length - displayCount));
  }, [missions, displayCount]);

  const warfameDataRef = useRef<{
    regions: Record<string, RegionInfo> | null;
    dictZh: Record<string, string> | null;
  } | null>(null);

  const ensureWarframeData = async () => {
    if (warfameDataRef.current?.regions && warfameDataRef.current?.dictZh) {
      return warfameDataRef.current;
    }
    try {
      const basePath = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/$/, "");
      const base = `${basePath}/warframe-public-export-plus`;
      const [r1, r2] = await Promise.all([
        fetch(`${base}/ExportRegions.json`),
        fetch(`${base}/dict.zh.json`),
      ]);
      const [j1, j2] = await Promise.all([
        r1.ok ? r1.json() : null,
        r2.ok ? r2.json() : null,
      ]);
      const data = {
        regions: (j1 && typeof j1 === "object" ? (j1 as Record<string, RegionInfo>) : null),
        dictZh: (j2 && typeof j2 === "object" ? (j2 as Record<string, string>) : null),
      };
      warfameDataRef.current = data;
      if (data.regions) setRegions(data.regions);
      if (data.dictZh) setDictZh(data.dictZh);
      return data;
    } catch {
      return null;
    }
  };

  // 页面加载后预取节点数据，把网络延迟藏在用户上传文件之前
  useEffect(() => {
    void ensureWarframeData();
  }, []);

  const nodeInfoLine = (m: MissionResult) => {
    if (!m.nodeId) return "-";
    const info = regions?.[m.nodeId];
    const meta: NodeMeta | undefined = info
      ? {
          nodeId: m.nodeId,
          nodeName: t(dictZh, info.name),
          systemName: t(dictZh, info.systemName),
          missionType: t(dictZh, info.missionName),
          faction: t(dictZh, info.factionName),
        }
      : undefined;
    const parts = [meta?.nodeName, meta?.systemName, meta?.missionType, meta?.faction].filter(
      Boolean
    ) as string[];
    // 不展示 (SolNode94) 这类括号信息，只展示可读文本
    return parts.length ? parts.join(" · ") : m.nodeId;
  };

  const handleFile = async (
    file: File,
    countOverride?: number,
    opts?: { preserveExisting?: boolean }
  ) => {
    lastFileRef.current = file;
    setError(null);
    if (!opts?.preserveExisting) setParse(null);
    setProgress(0);
    setTimeModeByIdx({});
    setManualHmsByIdx({});
    setActualEssenceByIdx({});
    try {
      // 节点信息：按裁剪后的 ExportRegions + dict.zh.json 翻译（用于展示）
      // 加载失败不影响解析，只会影响节点信息展示
      const data = await ensureWarframeData();
      const useCount = countOverride ?? showCount;
      const res = await parseEeLogInWorker(
        file,
        {
          count: useCount,
          minDurationSec: 60,
          chunkBytes: 4 * 1024 * 1024,
          nodeRegions: data?.regions ?? undefined,
        },
        // 节流：整数百分比变化才触发重渲染（worker 进度消息很密集）
        (p) =>
          setProgress((prev) =>
            prev != null && Math.round(prev * 100) === Math.round(p * 100) ? prev : p
          )
      );
      setParse(res);
      setDisplayCount(useCount);
    } catch (e) {
      setError(e instanceof Error ? e.message : "读取或解析失败");
    } finally {
      setProgress(null);
    }
  };

  const captureRun = useCallback(async (idx: number) => {
    const el = captureRefs.current[idx];
    if (!el) return;
    setCopyingIdx(idx);
    try {
      // 等待一帧让 React 重渲染（下拉框 → 纯文字）
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      await document.fonts.ready;
      // 卡片透明出图（半透明玻璃保留 alpha），再合成到模拟页面背景的画布上
      const pr = 2;
      const shot = await toCanvas(el, {
        pixelRatio: pr,
        // 按钮等交互元素不进截图
        filter: (node) =>
          !(node instanceof HTMLElement && node.dataset.shotIgnore != null),
      });
      const out = document.createElement("canvas");
      out.width = shot.width;
      out.height = shot.height;
      const ctx = out.getContext("2d");
      if (!ctx) throw new Error("画布不可用");
      await paintGlassBackdrop(ctx, out.width, out.height, pr);
      ctx.drawImage(shot, 0, 0);
      const blob = await new Promise<Blob | null>((resolve) =>
        out.toBlob(resolve, "image/png")
      );
      if (!blob) throw new Error("生成图片失败");
      const url = URL.createObjectURL(blob);
      try {
        // 先试剪贴板，失败则回退下载
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      } catch {
        const a = document.createElement("a");
        a.href = url;
        a.download = `arbitration-${String(idx + 1).padStart(2, "0")}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      } finally {
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      alert(`截图失败：${msg}`);
    } finally {
      setTimeout(() => setCopyingIdx(null), 1600);
    }
  }, []);

  // ── RunCard 稳定回调（配合 React.memo 避免整列表重渲染）──
  const handleCaptureRef = useCallback((idx: number, el: HTMLDivElement | null) => {
    captureRefs.current[idx] = el;
  }, []);
  const handleTimeModeChange = useCallback((idx: number, mode: TimeMode) => {
    setTimeModeByIdx((s) => ({ ...s, [idx]: mode }));
  }, []);
  const handleManualChange = useCallback(
    (idx: number, field: "h" | "m" | "s", value: string) => {
      setManualHmsByIdx((s) => ({
        ...s,
        [idx]: { ...(s[idx] ?? EMPTY_HMS), [field]: value },
      }));
    },
    []
  );
  const handleActualChange = useCallback((idx: number, value: string) => {
    setActualEssenceByIdx((s) => ({ ...s, [idx]: value }));
  }, []);
  const handleSatPctModeChange = useCallback((mode: "total" | "active") => {
    setSatPctMode(mode);
  }, []);
  const handleShowDetail = useCallback((m: MissionResult, idx: number) => {
    setDetailState({ m, idx });
  }, []);
  const handleCapture = useCallback((idx: number) => {
    void captureRun(idx);
  }, [captureRun]);

  return (
    <div className="arb-log">
    <div className="wrap">
      <div
        className={`panel dropzone ${isDragOver ? "dragover" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f) void handleFile(f);
        }}
      >
        <div className="statusBar">
          <div className="statusLeft">
            <span className="statusTitle">状态</span>
            <span className="statusHint">初始掉率：{Math.round(BASE_DROP * 100)}%</span>
          </div>
          <div className="statusToggles">
            <label className="toggle">
              <input
                type="checkbox"
                checked={buffs.blueBox}
                onChange={(e) => setBuffs((s) => ({ ...s, blueBox: e.target.checked }))}
              />
              <span>资源掉落几率加成 ×2</span>
            </label>
            <label className="toggle">
              <input
                type="checkbox"
                checked={buffs.abundant}
                onChange={(e) => setBuffs((s) => ({ ...s, abundant: e.target.checked }))}
              />
              <span>富足巡回者 ×1.18</span>
            </label>
            <label className="toggle">
              <input
                type="checkbox"
                checked={buffs.yellowBox}
                onChange={(e) => setBuffs((s) => ({ ...s, yellowBox: e.target.checked }))}
              />
              <span>资源数量加成 ×2</span>
            </label>
            <label className="toggle">
              <input
                type="checkbox"
                checked={buffs.blessing}
                onChange={(e) => setBuffs((s) => ({ ...s, blessing: e.target.checked }))}
              />
              <span>资源掉落几率祝福 ×1.25</span>
            </label>
          </div>
        </div>

        <div className="helpLine">
          <span>
            EE.log 路径：
            <button
              type="button"
              className="copyPath"
              onClick={copyEePath}
              title="复制路径"
            >
              <code>%LOCALAPPDATA%\Warframe</code>
              <span aria-hidden>{eePathCopied ? "✓ 已复制" : "⧉"}</span>
            </button>
          </span>
          <span>时长 &lt; 1 分钟自动排除</span>
        </div>

        <div className="topbar">
          <div className="actions">
            <span className="hint">仅限主机的 EE.log</span>
            {progress != null ? (
              <span className="warnTag">{Math.round(progress * 100)}%</span>
            ) : null}
            {error ? (
              <span className="err" title={error}>
                解析失败：{error}
              </span>
            ) : null}
            {parse?.readComplete === false ? (
              <span
                className="warnTag"
                title={`${parse.readStopReason ?? "读取未完成"}（已读取 ${Math.round(
                  (parse.readProgress01 ?? 0) * 100
                )}%）`}
              >
                未读完 {Math.round((parse.readProgress01 ?? 0) * 100)}%
              </span>
            ) : null}
            {visibleMissions.some((m) => m.status === "incomplete") ? (
              <span className="warnTag">incomplete</span>
            ) : null}
            <label
              className="btn primary"
              htmlFor="file"
              onClick={(e) => {
                const picker = (window as { showOpenFilePicker?: OpenFilePickerFn })
                  .showOpenFilePicker;
                if (!picker) return; // 回退到原生 input
                e.preventDefault();
                void (async () => {
                  try {
                    const [handle] = await picker({
                      id: "warframe-ee-log",
                      multiple: false,
                      types: [
                        {
                          description: "EE.log 日志",
                          accept: { "text/plain": [".log", ".txt"] },
                        },
                      ],
                    });
                    if (handle) void handleFile(await handle.getFile());
                  } catch {
                    // 用户取消选择
                  }
                })();
              }}
            >
              上传
            </label>
            <label className="countPick">
              <span>展示</span>
              <input
                type="number"
                inputMode="numeric"
                min="1"
                step="1"
                value={showCountInput}
                onChange={(e) => setShowCountInput(e.target.value)}
              />
              <span>次</span>
              <span style={{ opacity: 0.72 }}>
                Max：{parse?.validTotal ?? "-"}次
              </span>
            </label>
            <button
              type="button"
              className="btn ghost"
              onClick={() => {
                const max = parse?.validTotal;
                const n0 = Number(showCountInput);
                const n = Number.isFinite(n0) ? Math.max(1, Math.floor(n0)) : 2;
                const clamped = max != null ? Math.min(n, Math.max(1, max)) : n;
                setShowCount(clamped);
                setShowCountInput(String(clamped));
                setDisplayCount(clamped);
                // 立刻按新值展示：若当前结果不足再自动重解析补齐
                if (clamped <= missions.length) {
                  setTimeModeByIdx({});
                  setManualHmsByIdx({});
                  setActualEssenceByIdx({});
                } else if (lastFileRef.current) {
                  // 保留当前展示，后台重解析补齐到 clamped
                  void handleFile(lastFileRef.current, clamped, { preserveExisting: true });
                }
              }}
              disabled={!lastFileRef.current || progress != null}
            >
              应用
            </button>
            <button
              type="button"
              className="btn ghost"
              onClick={() => {
                setError(null);
                setParse(null);
                setTimeModeByIdx({});
                setManualHmsByIdx({});
                setActualEssenceByIdx({});
                setShowCount(2);
                setShowCountInput("2");
                setDisplayCount(2);
                lastFileRef.current = null;
                if (fileRef.current) fileRef.current.value = "";
              }}
            >
              清空
            </button>
            <input
              id="file"
              ref={fileRef}
              type="file"
              accept=".log,.txt"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleFile(f);
              }}
            />
          </div>
        </div>

        <div className="runs">
          {visibleMissions.length === 0 ? (
            <div className="empty">暂无有效记录</div>
          ) : (
            visibleMissions.map((m, idx) => (
              <RunCard
                key={idx}
                m={m}
                idx={idx}
                mul={mul}
                nodeInfo={nodeInfoLine(m)}
                timeMode={timeModeByIdx[idx] ?? "host"}
                manual={manualHmsByIdx[idx] ?? EMPTY_HMS}
                actualText={actualEssenceByIdx[idx] ?? ""}
                satPctMode={satPctMode}
                copying={copyingIdx === idx}
                onCaptureRef={handleCaptureRef}
                onTimeModeChange={handleTimeModeChange}
                onManualChange={handleManualChange}
                onActualChange={handleActualChange}
                onSatPctModeChange={handleSatPctModeChange}
                onCapture={handleCapture}
                onShowDetail={handleShowDetail}
              />
            ))
          )}
        </div>
      </div>
    </div>

    {detailState && (
      <DetailOverlay
        m={detailState.m}
        runIdx={detailState.idx}
        nodeInfo={nodeInfoLine(detailState.m)}
        onClose={() => setDetailState(null)}
      />
    )}
    </div>
  );
}
