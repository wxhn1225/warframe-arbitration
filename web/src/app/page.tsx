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
      <div className="min-h-screen bg-[#0B1220] text-slate-100">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute -top-24 left-1/2 h-[520px] w-[520px] -translate-x-1/2 rounded-full bg-blue-500/18 blur-3xl" />
          <div className="absolute top-40 -left-24 h-[520px] w-[520px] rounded-full bg-slate-400/16 blur-3xl" />
          <div className="absolute bottom-0 right-0 h-[520px] w-[520px] rounded-full bg-blue-400/10 blur-3xl" />
        </div>
        <main className="relative p-6 max-w-6xl mx-auto">
          <div className="text-lg font-semibold">加载中…</div>
          <div className="text-base font-medium text-slate-300 mt-2">
            首次加载会读 3 个 JSON：仲裁时间、节点中文、默认等级表。
          </div>
        </main>
      </div>
    );
  }

  const tiers = tierlist.tiers;
  const viewSwitch = (
    <div className="flex flex-wrap gap-2 shrink-0">
      <button
        className={[
          "px-3 py-2 rounded-xl ring-1 ring-white/10 backdrop-blur",
          tab === "schedule"
            ? "bg-blue-500/25 text-blue-100"
            : "bg-white/5 hover:bg-white/10 text-slate-200",
        ].join(" ")}
        onClick={() => setTab("schedule")}
      >
        仲裁时间
      </button>
      <button
        className={[
          "px-3 py-2 rounded-xl ring-1 ring-white/10 backdrop-blur",
          tab === "tierlist"
            ? "bg-blue-500/25 text-blue-100"
            : "bg-white/5 hover:bg-white/10 text-slate-200",
        ].join(" ")}
        onClick={() => setTab("tierlist")}
      >
        等级表
      </button>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#0B1220] text-slate-100 selection:bg-blue-400/25 selection:text-slate-50">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute -top-24 left-1/2 h-[780px] w-[780px] -translate-x-1/2 rounded-full bg-blue-500/16 blur-3xl" />
        <div className="absolute top-40 -left-24 h-[620px] w-[620px] rounded-full bg-slate-400/14 blur-3xl" />
        <div className="absolute bottom-0 right-0 h-[700px] w-[700px] rounded-full bg-blue-400/10 blur-3xl" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(148,163,184,0.10),transparent_62%)]" />
      </div>

      <main className="relative p-6 max-w-7xl mx-auto space-y-6">
        <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-2">
              <span className="inline-block h-2 w-2 rounded-full bg-blue-400 shadow-[0_0_18px_rgba(96,165,250,0.9)]" />
              <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
                Warframe Arbitration
              </h1>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/15 ring-1 ring-white/15 backdrop-blur"
              onClick={exportScheduleTxt}
              title="导出当前选择范围的仲裁序列 TXT"
            >
              导出仲裁 TXT
            </button>

            <button
              className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/15 ring-1 ring-white/15 backdrop-blur"
              onClick={exportScheduleJson}
              title="导出当前选择范围的仲裁序列 JSON"
            >
              导出仲裁 JSON
            </button>

            <button
              className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/15 ring-1 ring-white/15 backdrop-blur"
              onClick={resetToDefault}
              title="清空本地保存的等级表，恢复默认"
            >
              恢复默认等级
            </button>
          </div>
        </header>

        <section className="rounded-2xl bg-white/5 ring-1 ring-white/10 backdrop-blur p-4">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="w-full rounded-2xl bg-white/5 ring-1 ring-white/10 p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="inline-flex items-center gap-2">
                  <span className="inline-block h-2.5 w-2.5 rounded-full bg-blue-300 shadow-[0_0_18px_rgba(147,197,253,0.9)]" />
                  <span className="px-2 py-1 rounded-lg bg-white/10 ring-1 ring-white/15 text-sm font-bold text-white">
                    当前
                  </span>
                </div>
                {current ? (
                  <span
                    className={[
                      "px-2 py-1 rounded-full text-xs font-semibold",
                      tierPillClass(tierOfNode[current.cur.nodeKey] ?? "unrated"),
                    ].join(" ")}
                  >
                    {tierZh(tierOfNode[current.cur.nodeKey] ?? "unrated")}
                  </span>
                ) : null}
              </div>

              <div className="mt-2 flex items-baseline gap-3">
                <div className="font-mono text-3xl md:text-4xl text-white">
                  {current ? hhmm(current.cur.ts) : "—"}
                </div>
              </div>

              <div className="mt-2 text-base md:text-lg text-slate-50 font-semibold">
                {current
                  ? displayNode(
                      nodes[current.cur.nodeKey] ??
                        fallbackNode(current.cur.nodeKey),
                    )
                  : "—"}
              </div>

              <div className="mt-3 pt-3 border-t border-white/10">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-200/90">
                  <span className="inline-flex items-center gap-2">
                    <span className="inline-block h-2 w-2 rounded-full bg-blue-300 shadow-[0_0_14px_rgba(147,197,253,0.85)]" />
                    <span className="font-semibold">下个</span>
                  </span>
                  <span className="font-mono text-base text-white">
                    {current ? hhmm(current.next.ts) : "—"}
                  </span>
                  <span className="text-slate-300">·</span>
                  <span className="text-slate-50 font-medium">
                    {current
                      ? displayNode(
                          nodes[current.next.nodeKey] ??
                            fallbackNode(current.next.nodeKey),
                        )
                      : "—"}
                  </span>
                  {current ? (
                    <span
                      className={[
                        "ml-auto px-2 py-1 rounded-full text-xs font-semibold",
                        tierPillClass(
                          tierOfNode[current.next.nodeKey] ?? "unrated",
                        ),
                      ].join(" ")}
                    >
                      {tierZh(tierOfNode[current.next.nodeKey] ?? "unrated")}
                    </span>
                  ) : null}
                </div>
              </div>
            </div>

            {/* 视图切换挪到“未来范围”那一行右侧 */}
          </div>
        </section>

        <section className="rounded-2xl bg-white/5 ring-1 ring-white/10 backdrop-blur p-4 space-y-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap gap-4 items-center">
              <div className="flex items-center gap-2">
                <span className="text-base font-semibold text-slate-200">显示范围</span>
                <div className="inline-flex rounded-xl bg-white/5 ring-1 ring-white/10 p-1">
                  <button
                    className={[
                      "px-3 py-1.5 rounded-lg text-sm",
                      rangeHours === 24
                        ? "bg-white/10 text-white"
                        : "text-slate-300 hover:text-white",
                    ].join(" ")}
                    onClick={() => setRangeHours(24)}
                  >
                    24小时
                  </button>
                  <button
                    className={[
                      "px-3 py-1.5 rounded-lg text-sm",
                      rangeHours === 168
                        ? "bg-white/10 text-white"
                        : "text-slate-300 hover:text-white",
                    ].join(" ")}
                    onClick={() => setRangeHours(168)}
                  >
                    7天
                  </button>
                  <button
                    className={[
                      "px-3 py-1.5 rounded-lg text-sm",
                      rangeHours === 720
                        ? "bg-white/10 text-white"
                        : "text-slate-300 hover:text-white",
                    ].join(" ")}
                    onClick={() => setRangeHours(720)}
                  >
                    30天
                  </button>
                  <button
                    className={[
                      "px-3 py-1.5 rounded-lg text-sm",
                      rangeHours === 2160
                        ? "bg-white/10 text-white"
                        : "text-slate-300 hover:text-white",
                    ].join(" ")}
                    onClick={() => setRangeHours(2160)}
                  >
                    3个月
                  </button>
                  <button
                    className={[
                      "px-3 py-1.5 rounded-lg text-sm",
                      rangeHours === 8760
                        ? "bg-white/10 text-white"
                        : "text-slate-300 hover:text-white",
                    ].join(" ")}
                    onClick={() => setRangeHours(8760)}
                  >
                    1年
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap gap-3 items-center">
                <div className="text-base font-semibold text-slate-200">筛选等级</div>
                {tiers.map((tier) => (
                  <label
                    key={tier}
                    className="inline-flex items-center gap-2 text-base text-slate-100"
                  >
                    <input
                      type="checkbox"
                      className="accent-fuchsia-400"
                      checked={selectedTiers[tier] !== false}
                      onChange={(e) =>
                        setSelectedTiers((m) => ({
                          ...m,
                          [tier]: e.target.checked,
                        }))
                      }
                    />
                    <span
                      className={[
                        "px-2 py-0.5 rounded-full text-sm font-semibold",
                        tierPillClass(tier),
                      ].join(" ")}
                    >
                      {tierZh(tier)}
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
              <button
                className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/15 ring-1 ring-white/15"
                onClick={clearFilters}
                title="清空筛选与搜索"
              >
                清空筛选
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="space-y-1">
              <div className="text-sm font-semibold text-slate-200">星球</div>
              <select
                className="w-full px-3 py-2 rounded-xl bg-white/5 ring-1 ring-white/10 outline-none focus:ring-blue-300/40"
                value={filterPlanet}
                onChange={(e) => setFilterPlanet(e.target.value)}
              >
                <option value="">全部星球</option>
                {planetOptions.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <div className="text-sm font-semibold text-slate-200">任务类型</div>
              <select
                className="w-full px-3 py-2 rounded-xl bg-white/5 ring-1 ring-white/10 outline-none focus:ring-blue-300/40"
                value={filterMission}
                onChange={(e) => setFilterMission(e.target.value)}
              >
                <option value="">全部任务类型</option>
                {missionOptions.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <div className="text-sm font-semibold text-slate-200">派系</div>
              <select
                className="w-full px-3 py-2 rounded-xl bg-white/5 ring-1 ring-white/10 outline-none focus:ring-blue-300/40"
                value={filterFaction}
                onChange={(e) => setFilterFaction(e.target.value)}
              >
                <option value="">全部派系</option>
                {factionOptions.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <div className="text-sm font-semibold text-slate-200">关键词（可选）</div>
              <input
                className="w-full px-3 py-2 rounded-xl bg-white/5 ring-1 ring-white/10 placeholder:text-slate-400 outline-none focus:ring-blue-300/40"
                placeholder="支持连写或空格：例如 地球拦截 或 地球 拦截"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <div className="text-sm font-medium text-slate-300">
                关键词会同时匹配：星球/任务类型/派系/节点名/节点Key
              </div>
            </div>
          </div>

          {tab === "schedule" ? (
            <div className="space-y-3">
              <div
                ref={scheduleTopRef}
                className="text-base font-medium text-slate-300 flex flex-wrap items-center justify-between gap-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span>未来范围：</span>
                  {scheduleRange.items.length > 0 ? (
                    <>
                      <span className="font-mono text-slate-200">
                        {dayLabel(scheduleRange.items[0]!.ts)}{" "}
                        {hhmm(scheduleRange.items[0]!.ts)}
                      </span>
                      <span className="text-slate-400">→</span>
                      <span className="font-mono text-slate-200">
                        {dayLabel(
                          scheduleRange.items[scheduleRange.items.length - 1]!.ts,
                        )}{" "}
                        {hhmm(
                          scheduleRange.items[scheduleRange.items.length - 1]!.ts,
                        )}
                      </span>
                      <span className="text-slate-400">
                        （{scheduleRange.items.length} 条 /{" "}
                        {Math.round(scheduleRange.items.length / 24)} 天）
                      </span>
                    </>
                  ) : (
                    <span>—</span>
                  )}
                </div>

                {viewSwitch}
              </div>

              {/* 桌面/平板：虚拟滚动表格 */}
              <div className="hidden md:block rounded-2xl bg-white/5 ring-1 ring-white/10 overflow-hidden">
                <div className="grid grid-cols-12 gap-2 px-4 py-3 text-sm font-semibold text-slate-200 border-b border-white/10">
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
                            <div className="px-4 py-3 bg-gradient-to-r from-blue-400/20 via-slate-400/10 to-transparent border-y border-white/10">
                              <div className="flex items-center gap-3">
                                <div className="h-2.5 w-2.5 rounded-full bg-blue-300 shadow-[0_0_18px_rgba(147,197,253,0.9)]" />
                                <div className="text-sm md:text-base font-semibold text-white tracking-wide">
                                  {item.day}
                                </div>
                                <div className="flex-1 h-px bg-white/10" />
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
                                    "grid grid-cols-12 gap-2 px-4 py-3 items-center border-l-4 border-b border-white/10 transition-colors",
                                    tierNodeTintClass(tier),
                                  ].join(" ")}
                                >
                                  <div className="col-span-2 font-mono text-slate-200">
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
