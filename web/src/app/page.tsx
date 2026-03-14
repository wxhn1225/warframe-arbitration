"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  buildTierOfNode,
  displayNode,
  downloadJson,
  downloadText,
  findCurrentIndex,
  hhmm,
  normalizeTierlist,
  type NodesZhFile,
  type NodeInfo,
  type ScheduleEntry,
  type Tierlist,
} from "@/lib/arbys";

const STORAGE_KEY = "arbys.tierlist.v1";
const BASE_PATH = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/$/, "");
const dataUrl = (p: string) => `${BASE_PATH}${p.startsWith("/") ? "" : "/"}${p}`;

function fallbackNode(nodeKey: string): NodeInfo {
  return {
    nodeKey,
    missionNameZh: "",
    factionNameZh: "",
    nameZh: "",
    systemNameZh: "",
  };
}

function tierZh(tier: string) {
  return tier === "unrated" ? "未评级" : tier;
}

function tierPillClass(tier: string) {
  switch (tier) {
    case "S":
      return "bg-fuchsia-500/15 text-fuchsia-200 ring-1 ring-fuchsia-400/30";
    case "A+":
      return "bg-rose-500/15 text-rose-200 ring-1 ring-rose-400/30";
    case "A":
      return "bg-amber-500/15 text-amber-200 ring-1 ring-amber-400/30";
    case "A-":
      return "bg-orange-500/15 text-orange-200 ring-1 ring-orange-400/30";
    case "B":
      return "bg-emerald-500/15 text-emerald-200 ring-1 ring-emerald-400/30";
    case "C":
      return "bg-cyan-500/15 text-cyan-200 ring-1 ring-cyan-400/30";
    case "unrated":
      return "bg-slate-500/10 text-slate-200 ring-1 ring-slate-400/20";
    default:
      return "bg-slate-500/10 text-slate-200 ring-1 ring-slate-400/20";
  }
}

function tierNodeTintClass(tier: string) {
  // 用于“节点随评级变色”：深色背景下更明显（渐变底 + 左侧色条 + 轻微发光）
  switch (tier) {
    case "S":
      return "border-l-fuchsia-300/90 bg-gradient-to-r from-fuchsia-400/18 to-transparent shadow-[0_0_22px_rgba(232,121,249,0.10)]";
    case "A+":
      return "border-l-rose-300/90 bg-gradient-to-r from-rose-400/18 to-transparent shadow-[0_0_22px_rgba(251,113,133,0.10)]";
    case "A":
      return "border-l-amber-300/90 bg-gradient-to-r from-amber-300/18 to-transparent shadow-[0_0_22px_rgba(252,211,77,0.10)]";
    case "A-":
      return "border-l-orange-300/90 bg-gradient-to-r from-orange-400/18 to-transparent shadow-[0_0_22px_rgba(251,146,60,0.10)]";
    case "B":
      return "border-l-emerald-300/90 bg-gradient-to-r from-emerald-400/16 to-transparent shadow-[0_0_22px_rgba(52,211,153,0.10)]";
    case "C":
      return "border-l-cyan-300/90 bg-gradient-to-r from-cyan-400/16 to-transparent shadow-[0_0_22px_rgba(34,211,238,0.10)]";
    case "unrated":
    default:
      return "border-l-slate-300/40 bg-gradient-to-r from-white/[0.06] to-transparent";
  }
}

function dayLabel(ts: number) {
  const d = new Date(ts * 1000);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const week = d.toLocaleDateString("zh-CN", { weekday: "short" });
  return `${yyyy}-${mm}-${dd} (${week})`;
}

function dateTimeLabel(ts: number) {
  const d = new Date(ts * 1000);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hhmm(ts)}`;
}

export default function Home() {
  const [schedule, setSchedule] = useState<ScheduleEntry[] | null>(null);
  const [nodesFile, setNodesFile] = useState<NodesZhFile | null>(null);
  const [tierlist, setTierlist] = useState<Tierlist | null>(null);

  const [selectedTiers, setSelectedTiers] = useState<Record<string, boolean>>(
    {},
  );
  const [search, setSearch] = useState("");
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [tab, setTab] = useState<"schedule" | "tierlist">("schedule");
  const [rangeHours, setRangeHours] = useState<24 | 168 | 720 | 2160 | 8760>(168);
  const [filterPlanet, setFilterPlanet] = useState("");
  const [filterMission, setFilterMission] = useState("");
  const [filterFaction, setFilterFaction] = useState("");
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

  const scheduleTopRef = useRef<HTMLDivElement | null>(null);
  const desktopScrollRef = useRef<HTMLDivElement | null>(null);
  const mobileScrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const onScroll = () => {
      setShowScrollTop(window.scrollY > 420);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    (async () => {
      const [s, n, td] = await Promise.all([
        fetch(dataUrl("/data/arbys.schedule.json")).then((r) => r.json()),
        fetch(dataUrl("/data/arbys.nodes.zh.json")).then((r) => r.json()),
        fetch(dataUrl("/data/tierlist.default.json")).then((r) => r.json()),
      ]);

      const scheduleArr = (s?.schedule ?? []) as ScheduleEntry[];
      const nodes = n as NodesZhFile;

      const allNodeKeys = Object.keys(nodes.nodes ?? {});
      const localRaw =
        typeof window !== "undefined"
          ? localStorage.getItem(STORAGE_KEY)
          : null;
      const localTier = localRaw ? (JSON.parse(localRaw) as Tierlist) : null;
      const normalized = normalizeTierlist(
        localTier ?? (td as Tierlist),
        allNodeKeys,
      );

      setSchedule(scheduleArr);
      setNodesFile(nodes);
      setTierlist(normalized);

      const initSelected: Record<string, boolean> = {};
      for (const tier of normalized.tiers) initSelected[tier] = true;
      setSelectedTiers(initSelected);
    })();
  }, []);

  useEffect(() => {
    if (!tierlist) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tierlist));
  }, [tierlist]);

  const nodes = nodesFile?.nodes ?? {};
  const allNodeKeys = useMemo(() => Object.keys(nodes), [nodes]);
  const tierOfNode = useMemo(
    () => (tierlist ? buildTierOfNode(tierlist) : {}),
    [tierlist],
  );

  const nodesArr = useMemo(() => Object.values(nodes), [nodes]);

  const scheduleRange = useMemo(() => {
    if (!schedule || schedule.length === 0) return { startIdx: 0, items: [] as ScheduleEntry[] };
    const startIdx = findCurrentIndex(schedule, now);
    const endIdx = Math.min(schedule.length, startIdx + rangeHours);
    return { startIdx, items: schedule.slice(startIdx, endIdx) };
  }, [schedule, now, rangeHours]);

  const current = useMemo(() => {
    if (!schedule || schedule.length === 0) return null;
    const idx = findCurrentIndex(schedule, now);
    const cur = schedule[idx]!;
    const next = schedule[Math.min(idx + 1, schedule.length - 1)]!;
    return { idx, cur, next };
  }, [schedule, now]);

  const planetAllOptions = useMemo(() => {
    const set = new Set<string>();
    for (const n of nodesArr) if (n?.systemNameZh) set.add(n.systemNameZh);
    return Array.from(set).sort((a, b) => a.localeCompare(b, "zh-CN"));
  }, [nodesArr]);

  const missionAllOptions = useMemo(() => {
    const set = new Set<string>();
    for (const n of nodesArr) if (n?.missionNameZh) set.add(n.missionNameZh);
    return Array.from(set).sort((a, b) => a.localeCompare(b, "zh-CN"));
  }, [nodesArr]);

  const factionAllOptions = useMemo(() => {
    const set = new Set<string>();
    for (const n of nodesArr) if (n?.factionNameZh) set.add(n.factionNameZh);
    return Array.from(set).sort((a, b) => a.localeCompare(b, "zh-CN"));
  }, [nodesArr]);

  const searchTokens = useMemo(() => {
    const raw = search.trim().toLowerCase();
    if (!raw) return [] as string[];

    // 1) 有空格：空格分词（AND）
    if (/\s/.test(raw)) {
      return raw.split(/\s+/).map((x) => x.trim()).filter(Boolean);
    }

    // 2) 无空格：尝试从“连写字符串”里提取已知词（星球/任务类型/派系），实现“地球拦截”这种输入
    const q = raw.replace(/\s+/g, "");
    const dict = [
      ...planetAllOptions,
      ...missionAllOptions,
      ...factionAllOptions,
    ]
      .map((x) => x.toLowerCase())
      .filter(Boolean);

    const hits = dict.filter((t) => q.includes(t));
    hits.sort((a, b) => b.length - a.length);

    // 去重
    const uniqHits: string[] = [];
    const seen = new Set<string>();
    for (const h of hits) {
      if (seen.has(h)) continue;
      seen.add(h);
      uniqHits.push(h);
    }

    // 还原剩余碎片（例如用户输入了节点Key的一部分）
    let rest = q;
    for (const h of uniqHits) rest = rest.split(h).join(" ");
    const restTokens = rest.split(/\s+/).map((x) => x.trim()).filter(Boolean);

    const out = [...uniqHits, ...restTokens].filter(Boolean);
    return out.length ? out : [q];
  }, [search, planetAllOptions, missionAllOptions, factionAllOptions]);

  const planetOptions = useMemo(() => {
    // 受「任务类型/派系」影响的星球列表（faceted）
    const set = new Set<string>();
    for (const n of nodesArr) {
      if (!n?.systemNameZh) continue;
      if (filterMission && n.missionNameZh !== filterMission) continue;
      if (filterFaction && n.factionNameZh !== filterFaction) continue;
      set.add(n.systemNameZh);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "zh-CN"));
  }, [nodesArr, filterMission, filterFaction]);

  const missionOptions = useMemo(() => {
    // 受「星球/派系」影响的任务类型列表（faceted）
    const set = new Set<string>();
    for (const n of nodesArr) {
      if (!n?.missionNameZh) continue;
      if (filterPlanet && n.systemNameZh !== filterPlanet) continue;
      if (filterFaction && n.factionNameZh !== filterFaction) continue;
      set.add(n.missionNameZh);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "zh-CN"));
  }, [nodesArr, filterPlanet, filterFaction]);

  const factionOptions = useMemo(() => {
    // 受「星球/任务类型」影响的派系列表（faceted）
    const set = new Set<string>();
    for (const n of nodesArr) {
      if (!n?.factionNameZh) continue;
      if (filterPlanet && n.systemNameZh !== filterPlanet) continue;
      if (filterMission && n.missionNameZh !== filterMission) continue;
      set.add(n.factionNameZh);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "zh-CN"));
  }, [nodesArr, filterPlanet, filterMission]);

  function isVisibleNode(nodeKey: string) {
    const tier = tierOfNode[nodeKey] ?? "unrated";
    if (selectedTiers[tier] === false) return false;
    const n = nodes[nodeKey];
    if (filterPlanet && n?.systemNameZh !== filterPlanet) return false;
    if (filterMission && n?.missionNameZh !== filterMission) return false;
    if (filterFaction && n?.factionNameZh !== filterFaction) return false;
    if (searchTokens.length === 0) return true;
    const text = (
      n
        ? [
            n.missionNameZh,
            n.factionNameZh,
            n.nameZh,
            n.systemNameZh,
            nodeKey,
            displayNode(n),
          ].join(" ")
        : nodeKey
    ).toLowerCase();
    // AND：每个 token 都必须命中
    return searchTokens.every((tok) => text.includes(tok));
  }

  type FlatItem =
    | { type: "day"; day: string; key: string }
    | { type: "row"; ts: number; nodeKey: string; key: string };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const flatItems = useMemo<FlatItem[]>(() => {
    let lastDay = "";
    const result: FlatItem[] = [];
    for (const { ts, nodeKey } of scheduleRange.items) {
      if (!isVisibleNode(nodeKey)) continue;
      const day = dayLabel(ts);
      if (day !== lastDay) {
        result.push({ type: "day", day, key: `day-${day}` });
        lastDay = day;
      }
      result.push({ type: "row", ts, nodeKey, key: `${ts}-${nodeKey}` });
    }
    return result;
  // isVisibleNode 不是稳定引用，intentionally 依赖完整 filter 状态
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scheduleRange.items, tierOfNode, selectedTiers, filterPlanet, filterMission, filterFaction, searchTokens]);

  const desktopVirtualizer = useVirtualizer({
    count: flatItems.length,
    getScrollElement: () => desktopScrollRef.current,
    estimateSize: (i) => (flatItems[i]?.type === "day" ? 52 : 58),
    overscan: 15,
  });

  const mobileVirtualizer = useVirtualizer({
    count: flatItems.length,
    getScrollElement: () => mobileScrollRef.current,
    estimateSize: (i) => (flatItems[i]?.type === "day" ? 44 : 130),
    overscan: 8,
  });

  function clearFilters() {
    setFilterPlanet("");
    setFilterMission("");
    setFilterFaction("");
    setSearch("");
    const next: Record<string, boolean> = {};
    for (const tier of tiers) next[tier] = true;
    setSelectedTiers(next);
  }

  function moveNode(nodeKey: string, toTier: string) {
    if (!tierlist) return;
    const tiers = tierlist.tiers;
    const nextBuckets: Record<string, string[]> = {};
    for (const tier of tiers) {
      nextBuckets[tier] = (tierlist.tierBuckets[tier] ?? []).filter(
        (k) => k !== nodeKey,
      );
    }
    (nextBuckets[toTier] ?? (nextBuckets[toTier] = [])).push(nodeKey);
    setTierlist({ ...tierlist, tierBuckets: nextBuckets });
  }

  function resetToDefault() {
    localStorage.removeItem(STORAGE_KEY);
    location.reload();
  }

  function exportScheduleTxt() {
    const days = Math.round(rangeHours / 24);
    const lines = scheduleRange.items
      .map(({ ts, nodeKey }) => {
        const n = nodes[nodeKey] ?? fallbackNode(nodeKey);
        const tier = tierOfNode[nodeKey] ?? "unrated";
        return `${dateTimeLabel(ts)} • ${displayNode(n)} (${tierZh(tier)})`;
      })
      .join("\n");

    downloadText(`arbys-${days}d.txt`, lines + "\n");
  }

  function exportScheduleJson() {
    const days = Math.round(rangeHours / 24);
    downloadJson(`arbys-${days}d.json`, {
      schema: 1,
      rangeHours,
      exportedAt: new Date().toISOString(),
      schedule: scheduleRange.items.map(({ ts, nodeKey }) => {
        const n = nodes[nodeKey] ?? fallbackNode(nodeKey);
        const tier = tierOfNode[nodeKey] ?? "unrated";
        return {
          ts,
          nodeKey,
          hhmm: hhmm(ts),
          day: dayLabel(ts),
          tier,
          tierZh: tierZh(tier),
          mission: n.missionNameZh,
          faction: n.factionNameZh,
          node: n.nameZh,
          planet: n.systemNameZh,
          display: displayNode(n),
        };
      }),
    });
  }

  if (!schedule || !nodesFile || !tierlist) {
    return (
      <div className="min-h-screen bg-[#090e18] text-slate-100 flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="inline-block h-9 w-9 rounded-full border-2 border-slate-700 border-t-blue-400 animate-spin" />
          <div className="text-sm text-slate-400">加载数据中…</div>
        </div>
      </div>
    );
  }

  const tiers = tierlist.tiers;
  const viewSwitch = (
    <div className="inline-flex rounded-xl bg-white/5 ring-1 ring-white/10 p-0.5 shrink-0">
      <button
        className={[
          "px-4 py-1.5 rounded-lg text-sm font-medium transition-colors",
          tab === "schedule"
            ? "bg-blue-500/30 text-blue-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
            : "text-slate-400 hover:text-slate-200",
        ].join(" ")}
        onClick={() => setTab("schedule")}
      >
        仲裁时间
      </button>
      <button
        className={[
          "px-4 py-1.5 rounded-lg text-sm font-medium transition-colors",
          tab === "tierlist"
            ? "bg-blue-500/30 text-blue-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
            : "text-slate-400 hover:text-slate-200",
        ].join(" ")}
        onClick={() => setTab("tierlist")}
      >
        等级表
      </button>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#090e18] text-slate-100 selection:bg-blue-400/25 selection:text-slate-50">
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-40 left-1/2 h-[900px] w-[900px] -translate-x-1/2 rounded-full bg-blue-600/10 blur-[120px]" />
        <div className="absolute top-1/3 -left-40 h-[600px] w-[600px] rounded-full bg-indigo-600/8 blur-[100px]" />
        <div className="absolute bottom-0 right-0 h-[600px] w-[600px] rounded-full bg-blue-500/8 blur-[100px]" />
      </div>

      <main className="relative px-4 py-5 md:px-6 md:py-6 max-w-7xl mx-auto space-y-4">
        <header className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-60" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-blue-400 shadow-[0_0_10px_rgba(96,165,250,0.9)]" />
            </span>
            <h1 className="text-lg md:text-xl font-bold tracking-tight text-white">
              Warframe Arbitration
            </h1>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              className="h-8 px-3 flex items-center gap-1.5 rounded-lg bg-white/5 hover:bg-white/10 ring-1 ring-white/10 text-xs text-slate-300 hover:text-white transition-colors"
              onClick={exportScheduleTxt}
              title="导出当前选择范围的仲裁序列 TXT"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              TXT
            </button>
            <button
              className="h-8 px-3 flex items-center gap-1.5 rounded-lg bg-white/5 hover:bg-white/10 ring-1 ring-white/10 text-xs text-slate-300 hover:text-white transition-colors"
              onClick={exportScheduleJson}
              title="导出当前选择范围的仲裁序列 JSON"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              JSON
            </button>
            <button
              className="h-8 px-3 flex items-center gap-1.5 rounded-lg bg-white/5 hover:bg-white/10 ring-1 ring-white/10 text-xs text-slate-300 hover:text-white transition-colors"
              onClick={resetToDefault}
              title="清空本地保存的等级表，恢复默认"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.95"/></svg>
              重置
            </button>
          </div>
        </header>

        <section className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* 当前仲裁 */}
          <div className="relative rounded-2xl overflow-hidden bg-gradient-to-br from-slate-900/90 to-slate-800/50 ring-1 ring-white/10 p-5">
            <div className="absolute inset-0 bg-gradient-to-br from-blue-500/10 to-transparent pointer-events-none" />
            <div className="relative">
              <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500 mb-3 flex items-center gap-2">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-blue-400" />
                </span>
                当前仲裁
              </div>
              <div className="text-xl md:text-2xl font-bold text-white leading-snug">
                {current ? displayNode(nodes[current.cur.nodeKey] ?? fallbackNode(current.cur.nodeKey)) : "—"}
              </div>
              <div className="mt-3 flex items-center gap-3">
                <span className="font-mono text-2xl text-slate-100 tabular-nums">{current ? hhmm(current.cur.ts) : "—"}</span>
                {current && (<span className={["px-2.5 py-1 rounded-full text-xs font-bold", tierPillClass(tierOfNode[current.cur.nodeKey] ?? "unrated")].join(" ")}>{tierZh(tierOfNode[current.cur.nodeKey] ?? "unrated")}</span>)}
              </div>
            </div>
          </div>
          {/* 下一个仲裁 */}
          <div className="relative rounded-2xl overflow-hidden bg-white/[0.03] ring-1 ring-white/8 p-5">
            <div className="relative">
              <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500 mb-3 flex items-center gap-2">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="5 12 12 5 19 12"/><polyline points="5 19 12 12 19 19"/></svg>
                下一个
              </div>
              <div className="text-xl md:text-2xl font-bold text-slate-200 leading-snug">
                {current ? displayNode(nodes[current.next.nodeKey] ?? fallbackNode(current.next.nodeKey)) : "—"}
              </div>
              <div className="mt-3 flex items-center gap-3">
                <span className="font-mono text-2xl text-slate-300 tabular-nums">{current ? hhmm(current.next.ts) : "—"}</span>
                {current && (<span className={["px-2.5 py-1 rounded-full text-xs font-bold", tierPillClass(tierOfNode[current.next.nodeKey] ?? "unrated")].join(" ")}>{tierZh(tierOfNode[current.next.nodeKey] ?? "unrated")}</span>)}
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-2xl bg-white/[0.04] ring-1 ring-white/8 p-4 space-y-3">
          {/* 工具栏：范围 + 视图切换 + 筛选开关 */}
          <div className="flex flex-wrap items-center gap-3 justify-between">
            <div className="flex flex-wrap items-center gap-2">
              {/* 范围选择 */}
              <div className="inline-flex rounded-xl bg-black/20 ring-1 ring-white/8 p-0.5">
                {([24, 168, 720, 2160, 8760] as const).map((h) => {
                  const label = h === 24 ? "24h" : h === 168 ? "7天" : h === 720 ? "30天" : h === 2160 ? "3月" : "1年";
                  return (
                    <button
                      key={h}
                      className={[
                        "px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
                        rangeHours === h
                          ? "bg-white/12 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
                          : "text-slate-400 hover:text-slate-200",
                      ].join(" ")}
                      onClick={() => setRangeHours(h)}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              {/* 视图切换 */}
              {viewSwitch}
            </div>

            <div className="flex items-center gap-2">
              {/* 筛选开关 */}
              <button
                className={[
                  "h-8 px-3 flex items-center gap-1.5 rounded-lg ring-1 text-xs transition-colors",
                  showFilters
                    ? "bg-blue-500/20 ring-blue-400/30 text-blue-200"
                    : "bg-white/5 ring-white/10 text-slate-400 hover:text-slate-200",
                ].join(" ")}
                onClick={() => setShowFilters((v) => !v)}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="4" y1="6" x2="20" y2="6"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="11" y1="18" x2="13" y2="18"/></svg>
                筛选
                {showFilters ? " ▴" : " ▾"}
              </button>
              <button
                className="h-8 px-3 rounded-lg bg-white/5 hover:bg-white/10 ring-1 ring-white/10 text-xs text-slate-400 hover:text-slate-200 transition-colors"
                onClick={clearFilters}
              >
                清空
              </button>
            </div>
          </div>

          {/* 筛选面板（可折叠） */}
          {showFilters && (
            <div className="rounded-xl bg-black/20 ring-1 ring-white/8 p-3 space-y-3">
              {/* 等级勾选 */}
              <div className="flex flex-wrap gap-2 items-center">
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider mr-1">等级</span>
                {tiers.map((tier) => (
                  <label key={tier} className="cursor-pointer">
                    <input
                      type="checkbox"
                      className="sr-only peer"
                      checked={selectedTiers[tier] !== false}
                      onChange={(e) => setSelectedTiers((m) => ({ ...m, [tier]: e.target.checked }))}
                    />
                    <span className={[
                      "px-2.5 py-1 rounded-full text-xs font-semibold cursor-pointer transition-opacity peer-checked:opacity-100 opacity-35",
                      tierPillClass(tier),
                    ].join(" ")}>
                      {tierZh(tier)}
                    </span>
                  </label>
                ))}
              </div>
              {/* 下拉 + 搜索 */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                <select
                  className="w-full px-3 py-2 rounded-xl bg-white/5 ring-1 ring-white/10 text-sm outline-none focus:ring-blue-300/40"
                  value={filterPlanet}
                  onChange={(e) => setFilterPlanet(e.target.value)}
                >
                  <option value="">全部星球</option>
                  {planetOptions.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
                <select
                  className="w-full px-3 py-2 rounded-xl bg-white/5 ring-1 ring-white/10 text-sm outline-none focus:ring-blue-300/40"
                  value={filterMission}
                  onChange={(e) => setFilterMission(e.target.value)}
                >
                  <option value="">全部任务类型</option>
                  {missionOptions.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
                <select
                  className="w-full px-3 py-2 rounded-xl bg-white/5 ring-1 ring-white/10 text-sm outline-none focus:ring-blue-300/40"
                  value={filterFaction}
                  onChange={(e) => setFilterFaction(e.target.value)}
                >
                  <option value="">全部派系</option>
                  {factionOptions.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
                <input
                  className="w-full px-3 py-2 rounded-xl bg-white/5 ring-1 ring-white/10 text-sm placeholder:text-slate-500 outline-none focus:ring-blue-300/40"
                  placeholder="关键词搜索…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>
          )}

          {tab === "schedule" ? (
            <div className="space-y-2">
              {/* 范围信息条 */}
              <div ref={scheduleTopRef} className="flex flex-wrap items-center gap-2 text-xs text-slate-500 px-1">
                {scheduleRange.items.length > 0 ? (
                  <>
                    <span className="font-mono text-slate-400">{dayLabel(scheduleRange.items[0]!.ts)} {hhmm(scheduleRange.items[0]!.ts)}</span>
                    <span>→</span>
                    <span className="font-mono text-slate-400">{dayLabel(scheduleRange.items[scheduleRange.items.length - 1]!.ts)} {hhmm(scheduleRange.items[scheduleRange.items.length - 1]!.ts)}</span>
                    <span className="text-slate-600">·</span>
                    <span>{scheduleRange.items.length} 条 / {Math.round(scheduleRange.items.length / 24)} 天</span>
                  </>
                ) : <span>暂无数据</span>}
              </div>

              {/* 桌面/平板：虚拟滚动表格 */}
              <div className="hidden md:block rounded-2xl bg-black/20 ring-1 ring-white/8 overflow-hidden">
                <div className="grid grid-cols-12 gap-2 px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wider border-b border-white/8">
                  <div className="col-span-2">时间</div>
                  <div className="col-span-7">任务</div>
                  <div className="col-span-3">等级</div>
                </div>

                <div
                  ref={desktopScrollRef}
                  className="overflow-y-auto thin-scroll"
                  style={{ height: "min(75vh, 640px)" }}
                >
                  <div
                    style={{
                      height: desktopVirtualizer.getTotalSize(),
                      position: "relative",
                    }}
                  >
                    {desktopVirtualizer.getVirtualItems().map((vRow) => {
                      const item = flatItems[vRow.index]!;
                      return (
                        <div
                          key={item.key}
                          data-index={vRow.index}
                          ref={desktopVirtualizer.measureElement}
                          style={{
                            position: "absolute",
                            top: 0,
                            left: 0,
                            width: "100%",
                            transform: `translateY(${vRow.start}px)`,
                          }}
                        >
                          {item.type === "day" ? (
                            <div className="px-4 py-2 bg-gradient-to-r from-slate-700/30 to-transparent border-y border-white/6">
                              <div className="flex items-center gap-2">
                                <div className="h-1.5 w-1.5 rounded-full bg-blue-400/70" />
                                <div className="text-xs font-semibold text-slate-400 tracking-wide">
                                  {item.day}
                                </div>
                                <div className="flex-1 h-px bg-white/6" />
                              </div>
                            </div>
                          ) : (
                            (() => {
                              const { ts, nodeKey } = item;
                              const n = nodes[nodeKey] ?? fallbackNode(nodeKey);
                              const tier = tierOfNode[nodeKey] ?? "unrated";
                              return (
                                <div
                                  className={[
                                    "grid grid-cols-12 gap-2 px-4 py-2.5 items-center border-l-2 border-b border-white/5 transition-colors hover:bg-white/[0.02]",
                                    tierNodeTintClass(tier),
                                  ].join(" ")}
                                >
                                  <div className="col-span-2 font-mono text-sm text-slate-300 tabular-nums">
                                    {hhmm(ts)}
                                  </div>
                                  <div className="col-span-7">
                                    <div className="text-sm font-medium text-white">
                                      {displayNode(n)}
                                    </div>
                                    <div className="text-xs text-slate-400 mt-0.5">
                                      {nodeKey}
                                    </div>
                                  </div>
                                  <div className="col-span-3 flex items-center gap-2">
                                    <span
                                      className={[
                                        "px-2 py-1 rounded-full text-xs font-semibold",
                                        tierPillClass(tier),
                                      ].join(" ")}
                                    >
                                      {tierZh(tier)}
                                    </span>
                                    <select
                                      className="text-sm rounded-lg bg-black/30 ring-1 ring-white/15 px-2 py-1 outline-none focus:ring-fuchsia-400/40"
                                      value={tier}
                                      onChange={(e) =>
                                        moveNode(nodeKey, e.target.value)
                                      }
                                    >
                                      {tiers.map((t) => (
                                        <option key={t} value={t}>
                                          移动到 {tierZh(t)}
                                        </option>
                                      ))}
                                    </select>
                                  </div>
                                </div>
                              );
                            })()
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* 手机：虚拟滚动卡片列表 */}
              <div
                ref={mobileScrollRef}
                className="md:hidden overflow-y-auto thin-scroll"
                style={{ height: "min(80vh, 700px)" }}
              >
                <div
                  style={{
                    height: mobileVirtualizer.getTotalSize(),
                    position: "relative",
                  }}
                >
                  {mobileVirtualizer.getVirtualItems().map((vRow) => {
                    const item = flatItems[vRow.index]!;
                    return (
                      <div
                        key={item.key}
                        data-index={vRow.index}
                        ref={mobileVirtualizer.measureElement}
                        style={{
                          position: "absolute",
                          top: 0,
                          left: 0,
                          width: "100%",
                          transform: `translateY(${vRow.start}px)`,
                        }}
                      >
                        {item.type === "day" ? (
                          <div className="px-3 py-2 rounded-xl bg-white/5 ring-1 ring-white/10 mb-2">
                            <div className="flex items-center gap-2">
                              <div className="h-2.5 w-2.5 rounded-full bg-blue-300 shadow-[0_0_18px_rgba(147,197,253,0.9)]" />
                              <div className="text-sm font-semibold text-white">
                                {item.day}
                              </div>
                            </div>
                          </div>
                        ) : (
                          (() => {
                            const { ts, nodeKey } = item;
                            const n = nodes[nodeKey] ?? fallbackNode(nodeKey);
                            const tier = tierOfNode[nodeKey] ?? "unrated";
                            return (
                              <div
                                className={[
                                  "mb-2 rounded-xl ring-1 ring-white/10 border-l-4 p-3",
                                  tierNodeTintClass(tier),
                                ].join(" ")}
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <div className="font-mono text-base text-slate-200">
                                    {hhmm(ts)}
                                  </div>
                                  <span
                                    className={[
                                      "px-2 py-1 rounded-full text-xs font-semibold",
                                      tierPillClass(tier),
                                    ].join(" ")}
                                  >
                                    {tierZh(tier)}
                                  </span>
                                </div>

                                <div className="mt-2 text-sm font-semibold text-white">
                                  {displayNode(n)}
                                </div>
                                <div className="mt-1 text-xs text-slate-400">
                                  {nodeKey}
                                </div>

                                <div className="mt-3">
                                  <select
                                    className="w-full text-sm rounded-lg bg-white/5 ring-1 ring-white/10 px-2 py-2 outline-none"
                                    value={tier}
                                    onChange={(e) =>
                                      moveNode(nodeKey, e.target.value)
                                    }
                                  >
                                    {tiers.map((t) => (
                                      <option key={t} value={t}>
                                        移动到 {tierZh(t)}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              </div>
                            );
                          })()
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : (
            <section className="space-y-3">
              <div className="flex items-center justify-end">
                {viewSwitch}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {tiers
                .filter((tier) => selectedTiers[tier] !== false)
                .map((tier) => {
                  const keys = tierlist.tierBuckets[tier] ?? [];
                  const visibleKeys = keys.filter(isVisibleNode);
                  return (
                    <div
                      key={tier}
                      className="rounded-2xl bg-black/20 ring-1 ring-white/15 overflow-hidden"
                    >
                      <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span
                            className={[
                              "px-2 py-1 rounded-full text-xs font-semibold",
                              tierPillClass(tier),
                            ].join(" ")}
                          >
                            {tierZh(tier)}
                          </span>
                          <span className="font-semibold">节点</span>
                        </div>
                        <div className="text-xs text-slate-400">
                          {visibleKeys.length}/{keys.length}
                        </div>
                      </div>

                      <div className="p-3 space-y-2">
                        {visibleKeys.length === 0 ? (
                          <div className="text-sm text-slate-400">（空）</div>
                        ) : (
                          visibleKeys.map((nodeKey) => {
                            const n = nodes[nodeKey];
                            const text = n ? displayNode(n) : nodeKey;
                            const tier = tierOfNode[nodeKey] ?? "unrated";
                            return (
                              <div
                                key={nodeKey}
                                className={[
                                  "rounded-xl p-3 ring-1 ring-white/15 border-l-4 transition-colors",
                                  tierNodeTintClass(tier),
                                ].join(" ")}
                              >
                                <div className="text-sm font-medium text-white">
                                  {text}
                                </div>
                                <div className="text-xs text-slate-400 mt-1">
                                  {nodeKey}
                                </div>
                                <div className="mt-3 flex flex-wrap gap-2 items-center">
                                  <span
                                    className={[
                                      "px-2 py-1 rounded-full text-xs font-semibold",
                                      tierPillClass(tier),
                                    ].join(" ")}
                                  >
                                    {tierZh(tier)}
                                  </span>
                                  <select
                                    className="text-sm rounded-lg bg-black/30 ring-1 ring-white/15 px-2 py-1 outline-none focus:ring-fuchsia-400/40"
                                    value={tier}
                                    onChange={(e) =>
                                      moveNode(nodeKey, e.target.value)
                                    }
                                  >
                                    {tiers.map((t) => (
                                      <option key={t} value={t}>
                                        移动到 {tierZh(t)}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </section>

      </main>

      {showScrollTop && tab === "schedule" ? (
        <button
          className="fixed bottom-5 right-5 h-10 w-10 rounded-full bg-white/10 hover:bg-white/15 ring-1 ring-white/20 backdrop-blur flex items-center justify-center"
          onClick={() =>
            scheduleTopRef.current?.scrollIntoView({ behavior: "smooth" })
          }
          aria-label="回到顶部"
          title="回到顶部"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="text-slate-100"
          >
            <path
              d="M12 5l-7 7m7-7l7 7M12 5v14"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      ) : null}
    </div>
  );
}
