"use client";

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import {
  buildTierOfNode,
  decodeSchedule,
  displayNode,
  downloadJson,
  downloadText,
  findCurrentIndex,
  hhmm,
  normalizeTierlist,
  type CompactScheduleFile,
  type NodesZhFile,
  type NodeInfo,
  type ScheduleEntry,
  type Tierlist,
} from "@/lib/arbys";

const STORAGE_KEY = "arbys.tierlist.v1";
const EMPTY_NODES: Record<string, NodeInfo> = {};
const BASE_PATH = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/$/, "");
const dataUrl = (p: string) => `${BASE_PATH}${p.startsWith("/") ? "" : "/"}${p}`;

const RANGE_OPTIONS = [
  [24, "24小时"],
  [168, "7天"],
  [720, "30天"],
  [2160, "3个月"],
  [8760, "1年"],
] as const;

type RangeHours = (typeof RANGE_OPTIONS)[number][0];

// 用 useSyncExternalStore 订阅外部状态（媒体查询 / URL 参数），
// 避免「effect 里同步 setState」导致的级联渲染，同时保证 SSR 水合安全
const MOBILE_QUERY = "(max-width: 767px)";
const subscribeMobile = (cb: () => void) => {
  const mq = window.matchMedia(MOBILE_QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};
const getIsMobile = () => window.matchMedia(MOBILE_QUERY).matches;
const subscribeNoop = () => () => {};
const getIsDevMode = () =>
  new URLSearchParams(window.location.search).get("dev") === "1";
const getServerFalse = () => false;

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

type TierStyle = {
  pill: string;
  row: string;
  dot: string;
  header: string;
};

const TIER_STYLES: Record<string, TierStyle> = {
  S: {
    pill: "bg-gradient-to-br from-fuchsia-500 to-purple-600 text-white shadow-[0_2px_14px_rgba(217,70,239,0.45)]",
    row: "border-l-fuchsia-400 bg-gradient-to-r from-fuchsia-500/[0.13] to-transparent",
    dot: "bg-fuchsia-400 shadow-[0_0_12px_rgba(232,121,249,0.9)]",
    header: "from-fuchsia-500/25",
  },
  "A+": {
    pill: "bg-gradient-to-br from-rose-500 to-red-600 text-white shadow-[0_2px_14px_rgba(244,63,94,0.45)]",
    row: "border-l-rose-400 bg-gradient-to-r from-rose-500/[0.12] to-transparent",
    dot: "bg-rose-400 shadow-[0_0_12px_rgba(251,113,133,0.9)]",
    header: "from-rose-500/25",
  },
  A: {
    pill: "bg-gradient-to-br from-amber-400 to-orange-500 text-slate-950 shadow-[0_2px_14px_rgba(251,191,36,0.45)]",
    row: "border-l-amber-300 bg-gradient-to-r from-amber-400/[0.12] to-transparent",
    dot: "bg-amber-300 shadow-[0_0_12px_rgba(252,211,77,0.9)]",
    header: "from-amber-400/25",
  },
  "A-": {
    pill: "bg-gradient-to-br from-orange-400 to-amber-600 text-slate-950 shadow-[0_2px_14px_rgba(251,146,60,0.4)]",
    row: "border-l-orange-300 bg-gradient-to-r from-orange-400/[0.11] to-transparent",
    dot: "bg-orange-300 shadow-[0_0_12px_rgba(253,186,116,0.9)]",
    header: "from-orange-400/25",
  },
  B: {
    pill: "bg-gradient-to-br from-emerald-400 to-teal-600 text-slate-950 shadow-[0_2px_14px_rgba(52,211,153,0.4)]",
    row: "border-l-emerald-300 bg-gradient-to-r from-emerald-400/[0.10] to-transparent",
    dot: "bg-emerald-300 shadow-[0_0_12px_rgba(110,231,183,0.9)]",
    header: "from-emerald-400/25",
  },
  C: {
    pill: "bg-gradient-to-br from-cyan-400 to-sky-600 text-slate-950 shadow-[0_2px_14px_rgba(34,211,238,0.4)]",
    row: "border-l-cyan-300 bg-gradient-to-r from-cyan-400/[0.10] to-transparent",
    dot: "bg-cyan-300 shadow-[0_0_12px_rgba(103,232,249,0.9)]",
    header: "from-cyan-400/25",
  },
  unrated: {
    pill: "bg-white/[0.08] text-slate-300 ring-1 ring-white/15",
    row: "border-l-slate-500/50 bg-gradient-to-r from-white/[0.04] to-transparent",
    dot: "bg-slate-400",
    header: "from-slate-400/15",
  },
};

function tierStyle(tier: string): TierStyle {
  return TIER_STYLES[tier] ?? TIER_STYLES.unrated!;
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

/** 独立 1s 倒计时：只有这个小组件每秒重渲染，不影响主列表 */
function Countdown({ targetTs }: { targetTs: number }) {
  const calc = () => Math.max(0, targetTs - Math.floor(Date.now() / 1000));
  const [left, setLeft] = useState(calc);
  useEffect(() => {
    setLeft(calc());
    const id = setInterval(() => setLeft(calc()), 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetTs]);
  const mm = String(Math.floor(left / 60)).padStart(2, "0");
  const ss = String(left % 60).padStart(2, "0");
  return (
    <span className="font-mono tabular-nums tracking-tight">
      {mm}:{ss}
    </span>
  );
}

function TierPill({ tier, className = "" }: { tier: string; className?: string }) {
  return (
    <span
      className={[
        "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold tracking-wide",
        tierStyle(tier).pill,
        className,
      ].join(" ")}
    >
      {tierZh(tier)}
    </span>
  );
}

function SelectField({
  label,
  value,
  onChange,
  placeholder,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  options: string[];
}) {
  return (
    <div className="space-y-1.5">
      <div className="text-xs font-semibold tracking-wider text-slate-400 uppercase">
        {label}
      </div>
      <div className="relative">
        <select
          className="w-full appearance-none px-3.5 py-2.5 pr-10 rounded-xl bg-white/[0.05] ring-1 ring-white/10 text-slate-100 outline-none transition focus:ring-2 focus:ring-cyan-400/50 hover:bg-white/[0.08]"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">{placeholder}</option>
          {options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
        <svg
          className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
        >
          <path
            d="M6 9l6 6 6-6"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    </div>
  );
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
  const [rangeHours, setRangeHours] = useState<RangeHours>(168);
  const [filterPlanet, setFilterPlanet] = useState("");
  const [filterMission, setFilterMission] = useState("");
  const [filterFaction, setFilterFaction] = useState("");
  const [showScrollTop, setShowScrollTop] = useState(false);
  const isMobile = useSyncExternalStore(subscribeMobile, getIsMobile, getServerFalse);
  const isDevMode = useSyncExternalStore(subscribeNoop, getIsDevMode, getServerFalse);

  const scheduleTopRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const [listScrollMargin, setListScrollMargin] = useState(0);

  // 只在挂载/视图切换/窗口尺寸变化时测量列表顶部偏移，避免每次渲染都强制 reflow
  useLayoutEffect(() => {
    const measure = () => {
      if (!listRef.current) return;
      const m = listRef.current.getBoundingClientRect().top + window.scrollY;
      setListScrollMargin((prev) => (Math.abs(prev - m) > 1 ? m : prev));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [tab, isMobile]);

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
        fetch(dataUrl("/data/arbys.schedule.v2.json")).then((r) => r.json()),
        fetch(dataUrl("/data/arbys.nodes.zh.json")).then((r) => r.json()),
        fetch(dataUrl("/data/tierlist.default.json")).then((r) => r.json()),
      ]);

      const scheduleArr = decodeSchedule(s as CompactScheduleFile);
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

  const nodes = nodesFile?.nodes ?? EMPTY_NODES;
  const tierOfNode = useMemo(
    () => (tierlist ? buildTierOfNode(tierlist) : {}),
    [tierlist],
  );

  const nodesArr = useMemo(() => Object.values(nodes), [nodes]);

  // startIdx 是原始值：每小时才变一次，now 每 30s 跳动不会触发下游 memo 重算
  const startIdx = useMemo(
    () => (schedule && schedule.length > 0 ? findCurrentIndex(schedule, now) : 0),
    [schedule, now],
  );

  const rangeItems = useMemo<ScheduleEntry[]>(() => {
    if (!schedule || schedule.length === 0) return [];
    return schedule.slice(startIdx, Math.min(schedule.length, startIdx + rangeHours));
  }, [schedule, startIdx, rangeHours]);

  const current = useMemo(() => {
    if (!schedule || schedule.length === 0) return null;
    const cur = schedule[startIdx]!;
    const next = schedule[Math.min(startIdx + 1, schedule.length - 1)]!;
    return { idx: startIdx, cur, next };
  }, [schedule, startIdx]);

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

  // 每个节点的搜索文本只拼一次（节点总数 < 100），不再在每行过滤时重复拼接
  const searchTextOfNode = useMemo(() => {
    const m = new Map<string, string>();
    for (const [k, n] of Object.entries(nodes)) {
      m.set(
        k,
        [
          n.missionNameZh,
          n.factionNameZh,
          n.nameZh,
          n.systemNameZh,
          k,
          displayNode(n),
        ]
          .join(" ")
          .toLowerCase(),
      );
    }
    return m;
  }, [nodes]);

  // 可见性只取决于 nodeKey（与时间无关），按节点缓存：
  // 过滤上万行 schedule 时实际只计算 <100 次
  const isVisibleNode = useMemo(() => {
    const compute = (nodeKey: string) => {
      const tier = tierOfNode[nodeKey] ?? "unrated";
      if (selectedTiers[tier] === false) return false;
      const n = nodes[nodeKey];
      if (filterPlanet && n?.systemNameZh !== filterPlanet) return false;
      if (filterMission && n?.missionNameZh !== filterMission) return false;
      if (filterFaction && n?.factionNameZh !== filterFaction) return false;
      if (searchTokens.length === 0) return true;
      const text = searchTextOfNode.get(nodeKey) ?? nodeKey.toLowerCase();
      // AND：每个 token 都必须命中
      return searchTokens.every((tok) => text.includes(tok));
    };
    // 已知节点全部预计算（<100 个）；schedule 中的未知 key 走兜底实时计算
    const cache = new Map<string, boolean>();
    for (const k of Object.keys(nodes)) cache.set(k, compute(k));
    return (nodeKey: string) => cache.get(nodeKey) ?? compute(nodeKey);
  }, [
    nodes,
    tierOfNode,
    selectedTiers,
    filterPlanet,
    filterMission,
    filterFaction,
    searchTokens,
    searchTextOfNode,
  ]);

  type FlatItem =
    | { type: "day"; day: string; key: string }
    | { type: "row"; ts: number; nodeKey: string; key: string };

  const flatItems = useMemo<FlatItem[]>(() => {
    let lastDay = "";
    const result: FlatItem[] = [];
    for (const { ts, nodeKey } of rangeItems) {
      if (!isVisibleNode(nodeKey)) continue;
      const day = dayLabel(ts);
      if (day !== lastDay) {
        result.push({ type: "day", day, key: `day-${day}` });
        lastDay = day;
      }
      result.push({ type: "row", ts, nodeKey, key: `${ts}-${nodeKey}` });
    }
    return result;
  }, [rangeItems, isVisibleNode]);

  const virtualizer = useWindowVirtualizer({
    count: flatItems.length,
    estimateSize: (i) =>
      flatItems[i]?.type === "day"
        ? (isMobile ? 44 : 52)
        : (isMobile ? 130 : 58),
    overscan: 12,
    scrollMargin: listScrollMargin,
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

  function exportTierlistJson() {
    downloadJson("tierlist.default.json", tierlist);
  }

  function exportScheduleTxt() {
    const days = Math.round(rangeHours / 24);
    const lines = rangeItems
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
      schedule: rangeItems.map(({ ts, nodeKey }) => {
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
      <div className="relative min-h-screen overflow-hidden">
        <Backdrop />
        <main className="relative mx-auto max-w-7xl px-5 py-8 md:px-8 space-y-6">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-cyan-400/30 to-indigo-500/30 ring-1 ring-white/10 animate-pulse" />
            <div className="space-y-2">
              <div className="h-5 w-56 rounded-lg bg-white/[0.07] animate-pulse" />
              <div className="h-3 w-36 rounded-lg bg-white/[0.05] animate-pulse" />
            </div>
          </div>
          <div className="h-48 rounded-3xl bg-white/[0.04] ring-1 ring-white/[0.07] animate-pulse" />
          <div className="h-32 rounded-3xl bg-white/[0.04] ring-1 ring-white/[0.07] animate-pulse" />
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="h-12 rounded-2xl bg-white/[0.03] ring-1 ring-white/[0.05] animate-pulse"
                style={{ animationDelay: `${i * 80}ms` }}
              />
            ))}
          </div>
          <div className="text-sm text-slate-400">正在加载仲裁数据…</div>
        </main>
      </div>
    );
  }

  const tiers = tierlist.tiers;
  const hasActiveFilter =
    !!filterPlanet ||
    !!filterMission ||
    !!filterFaction ||
    !!search.trim() ||
    tiers.some((t) => selectedTiers[t] === false);

  const viewSwitch = (
    <div className="inline-flex shrink-0 rounded-xl bg-white/[0.05] ring-1 ring-white/10 p-1 backdrop-blur">
      {(
        [
          ["schedule", "仲裁时间"],
          ["tierlist", "等级表"],
        ] as const
      ).map(([key, label]) => (
        <button
          key={key}
          className={[
            "px-4 py-1.5 rounded-lg text-sm font-semibold transition-all",
            tab === key
              ? "bg-gradient-to-r from-cyan-500/90 to-indigo-500/90 text-white shadow-[0_2px_12px_rgba(34,211,238,0.3)]"
              : "text-slate-300 hover:text-white",
          ].join(" ")}
          onClick={() => setTab(key)}
        >
          {label}
        </button>
      ))}
    </div>
  );

  const currentNode = current
    ? nodes[current.cur.nodeKey] ?? fallbackNode(current.cur.nodeKey)
    : null;
  const nextNode = current
    ? nodes[current.next.nodeKey] ?? fallbackNode(current.next.nodeKey)
    : null;
  const currentTier = current ? tierOfNode[current.cur.nodeKey] ?? "unrated" : "unrated";
  const nextTier = current ? tierOfNode[current.next.nodeKey] ?? "unrated" : "unrated";

  return (
    <div className="relative min-h-screen overflow-x-clip">
      <Backdrop />

      <main className="relative mx-auto max-w-7xl px-5 py-8 md:px-8 space-y-6">
        {/* ======= 顶栏 ======= */}
        <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3.5">
            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-cyan-400/25 to-indigo-500/25 ring-1 ring-white/15 shadow-[0_0_30px_rgba(34,211,238,0.2)]">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                <path
                  d="M12 2l3 6 7 1-5 5 1.2 7L12 17.8 5.8 21 7 14 2 9l7-1 3-6z"
                  fill="url(#star)"
                  stroke="rgba(255,255,255,0.4)"
                  strokeWidth="0.6"
                />
                <defs>
                  <linearGradient id="star" x1="2" y1="2" x2="22" y2="22">
                    <stop stopColor="#67e8f9" />
                    <stop offset="1" stopColor="#818cf8" />
                  </linearGradient>
                </defs>
              </svg>
            </div>
            <div>
              <h1 className="text-2xl md:text-[28px] font-extrabold tracking-tight leading-none">
                <span className="bg-gradient-to-r from-cyan-200 via-sky-200 to-indigo-200 bg-clip-text text-transparent">
                  Warframe 仲裁
                </span>
              </h1>
              <p className="mt-1.5 text-[13px] text-slate-400 tracking-wide">
                整点轮换时间表 · 节点等级筛选
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              className="px-3.5 py-2 rounded-xl text-sm font-medium bg-white/[0.06] hover:bg-white/[0.1] ring-1 ring-white/10 text-slate-200 transition backdrop-blur"
              onClick={exportScheduleTxt}
              title="导出当前选择范围的仲裁序列 TXT"
            >
              导出 TXT
            </button>
            <button
              className="px-3.5 py-2 rounded-xl text-sm font-medium bg-white/[0.06] hover:bg-white/[0.1] ring-1 ring-white/10 text-slate-200 transition backdrop-blur"
              onClick={exportScheduleJson}
              title="导出当前选择范围的仲裁序列 JSON"
            >
              导出 JSON
            </button>
            {isDevMode && (
              <button
                className="px-3.5 py-2 rounded-xl text-sm font-medium bg-white/[0.06] hover:bg-white/[0.1] ring-1 ring-white/10 text-slate-200 transition backdrop-blur"
                onClick={exportTierlistJson}
                title="导出当前等级表 JSON（可发给开发者更新默认值）"
              >
                导出等级表
              </button>
            )}
            <button
              className="px-3.5 py-2 rounded-xl text-sm font-medium bg-white/[0.06] hover:bg-white/[0.1] ring-1 ring-white/10 text-slate-200 transition backdrop-blur"
              onClick={resetToDefault}
              title="清空本地保存的等级表，恢复默认"
            >
              恢复默认等级
            </button>
          </div>
        </header>

        {/* ======= 当前仲裁 Hero ======= */}
        <section className="rounded-3xl p-px bg-gradient-to-br from-cyan-400/35 via-indigo-400/15 to-transparent shadow-[0_8px_40px_rgba(2,6,23,0.5)]">
          <div className="rounded-[calc(1.5rem-1px)] bg-[#0a101e]/95 backdrop-blur-xl p-5 md:p-7">
            <div className="grid gap-6 md:grid-cols-[1fr_auto] md:items-center">
              <div className="min-w-0">
                <div className="flex items-center gap-2.5">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-400 opacity-60" />
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-cyan-300" />
                  </span>
                  <span className="text-xs font-bold tracking-[0.2em] text-cyan-200/90 uppercase">
                    正在进行
                  </span>
                  {current ? <TierPill tier={currentTier} /> : null}
                </div>

                <div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
                  <div className="font-mono text-5xl md:text-6xl font-bold tracking-tight text-white tabular-nums">
                    {current ? hhmm(current.cur.ts) : "—"}
                  </div>
                  <div className="text-base md:text-xl font-semibold text-slate-100 truncate">
                    {currentNode ? displayNode(currentNode) : "—"}
                  </div>
                </div>
                {current ? (
                  <div className="mt-1.5 font-mono text-xs text-slate-500">
                    {current.cur.nodeKey}
                  </div>
                ) : null}
              </div>

              {current ? (
                <div className="shrink-0 rounded-2xl bg-white/[0.04] ring-1 ring-white/10 p-4 md:p-5 md:min-w-[280px]">
                  <div className="flex items-center justify-between gap-6">
                    <span className="text-xs font-bold tracking-[0.18em] text-slate-400 uppercase">
                      下一场
                    </span>
                    <span className="text-lg font-semibold text-cyan-200">
                      <Countdown targetTs={current.cur.ts + 3600} />
                    </span>
                  </div>
                  <div className="mt-3 flex items-center gap-2.5">
                    <span className="font-mono text-xl text-white tabular-nums">
                      {hhmm(current.next.ts)}
                    </span>
                    <TierPill tier={nextTier} />
                  </div>
                  <div className="mt-1.5 text-sm text-slate-300 leading-snug">
                    {nextNode ? displayNode(nextNode) : "—"}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </section>

        {/* ======= 筛选 + 列表 ======= */}
        <section className="rounded-3xl bg-white/[0.03] ring-1 ring-white/[0.08] backdrop-blur-xl p-4 md:p-6 space-y-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex flex-wrap gap-x-6 gap-y-4 items-start">
              <div className="space-y-1.5">
                <div className="text-xs font-semibold tracking-wider text-slate-400 uppercase">
                  显示范围
                </div>
                <div className="inline-flex rounded-xl bg-white/[0.05] ring-1 ring-white/10 p-1">
                  {RANGE_OPTIONS.map(([hours, label]) => (
                    <button
                      key={hours}
                      className={[
                        "px-3 py-1.5 rounded-lg text-sm font-medium transition-all",
                        rangeHours === hours
                          ? "bg-gradient-to-r from-cyan-500/90 to-indigo-500/90 text-white shadow-[0_2px_10px_rgba(34,211,238,0.25)]"
                          : "text-slate-300 hover:text-white",
                      ].join(" ")}
                      onClick={() => setRangeHours(hours)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="text-xs font-semibold tracking-wider text-slate-400 uppercase">
                  筛选等级
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {tiers.map((tier) => {
                    const active = selectedTiers[tier] !== false;
                    return (
                      <button
                        key={tier}
                        aria-pressed={active}
                        onClick={() =>
                          setSelectedTiers((m) => ({ ...m, [tier]: !active }))
                        }
                        className={[
                          "px-2.5 py-1 rounded-full text-xs font-bold tracking-wide transition-all",
                          active
                            ? tierStyle(tier).pill
                            : "bg-white/[0.04] text-slate-500 ring-1 ring-white/[0.08] opacity-60 hover:opacity-90",
                        ].join(" ")}
                        title={active ? "点击隐藏该等级" : "点击显示该等级"}
                      >
                        {tierZh(tier)}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <button
              className={[
                "shrink-0 px-3.5 py-2 rounded-xl text-sm font-medium ring-1 transition",
                hasActiveFilter
                  ? "bg-white/[0.08] hover:bg-white/[0.12] ring-white/15 text-white"
                  : "bg-white/[0.04] ring-white/[0.08] text-slate-500",
              ].join(" ")}
              onClick={clearFilters}
              title="清空筛选与搜索"
            >
              清空筛选
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
            <SelectField
              label="星球"
              value={filterPlanet}
              onChange={setFilterPlanet}
              placeholder="全部星球"
              options={planetOptions}
            />
            <SelectField
              label="任务类型"
              value={filterMission}
              onChange={setFilterMission}
              placeholder="全部任务类型"
              options={missionOptions}
            />
            <SelectField
              label="派系"
              value={filterFaction}
              onChange={setFilterFaction}
              placeholder="全部派系"
              options={factionOptions}
            />
            <div className="space-y-1.5">
              <div className="text-xs font-semibold tracking-wider text-slate-400 uppercase">
                关键词
              </div>
              <div className="relative">
                <svg
                  className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                >
                  <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
                  <path d="M20 20l-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
                <input
                  className="w-full pl-10 pr-3.5 py-2.5 rounded-xl bg-white/[0.05] ring-1 ring-white/10 text-slate-100 placeholder:text-slate-500 outline-none transition focus:ring-2 focus:ring-cyan-400/50 hover:bg-white/[0.08]"
                  placeholder="例如 地球拦截 或 地球 拦截"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <div className="text-xs text-slate-500">
                匹配星球 / 任务 / 派系 / 节点名 / Key
              </div>
            </div>
          </div>

          {tab === "schedule" ? (
            <div className="space-y-3">
              <div
                ref={scheduleTopRef}
                className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-400"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span>未来范围</span>
                  {rangeItems.length > 0 ? (
                    <>
                      <span className="font-mono text-slate-200 tabular-nums">
                        {dayLabel(rangeItems[0]!.ts)} {hhmm(rangeItems[0]!.ts)}
                      </span>
                      <span className="text-slate-600">→</span>
                      <span className="font-mono text-slate-200 tabular-nums">
                        {dayLabel(rangeItems[rangeItems.length - 1]!.ts)}{" "}
                        {hhmm(rangeItems[rangeItems.length - 1]!.ts)}
                      </span>
                      <span className="text-slate-500">
                        （{rangeItems.length} 条 / {Math.round(rangeItems.length / 24)} 天）
                      </span>
                    </>
                  ) : (
                    <span>—</span>
                  )}
                </div>
                {viewSwitch}
              </div>

              {/* 手机：卡片虚拟列表 */}
              {isMobile && (
                <div
                  ref={listRef}
                  style={{ height: virtualizer.getTotalSize(), position: "relative" }}
                >
                  {virtualizer.getVirtualItems().map((vRow) => {
                    const item = flatItems[vRow.index];
                    if (!item) return null;
                    return (
                      <div
                        key={item.key}
                        data-index={vRow.index}
                        ref={virtualizer.measureElement}
                        style={{
                          position: "absolute",
                          top: 0,
                          left: 0,
                          width: "100%",
                          transform: `translateY(${vRow.start - virtualizer.options.scrollMargin}px)`,
                        }}
                      >
                        {item.type === "day" ? (
                          <div className="mb-2 px-3.5 py-2 rounded-xl bg-gradient-to-r from-cyan-400/15 to-transparent ring-1 ring-white/[0.08]">
                            <div className="flex items-center gap-2">
                              <div className="h-2 w-2 rounded-full bg-cyan-300 shadow-[0_0_12px_rgba(103,232,249,0.9)]" />
                              <div className="text-sm font-bold text-white tracking-wide">
                                {item.day}
                              </div>
                            </div>
                          </div>
                        ) : (() => {
                          const { ts, nodeKey } = item;
                          const n = nodes[nodeKey] ?? fallbackNode(nodeKey);
                          const tier = tierOfNode[nodeKey] ?? "unrated";
                          return (
                            <div
                              className={[
                                "mb-2 rounded-xl ring-1 ring-white/[0.08] border-l-[3px] p-3.5",
                                tierStyle(tier).row,
                              ].join(" ")}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="font-mono text-base font-semibold text-slate-100 tabular-nums">
                                  {hhmm(ts)}
                                </div>
                                <TierPill tier={tier} />
                              </div>
                              <div className="mt-1.5 text-sm font-semibold text-white">
                                {displayNode(n)}
                              </div>
                              <div className="mt-0.5 font-mono text-xs text-slate-500">
                                {nodeKey}
                              </div>
                              <div className="mt-3">
                                <select
                                  className="w-full text-sm rounded-lg bg-white/[0.05] ring-1 ring-white/10 px-2.5 py-2 outline-none focus:ring-2 focus:ring-cyan-400/50"
                                  value={tier}
                                  onChange={(e) => moveNode(nodeKey, e.target.value)}
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
                        })()}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* 桌面/平板：虚拟滚动表格 */}
              {!isMobile && (
                <div className="rounded-2xl bg-black/25 ring-1 ring-white/[0.08] overflow-hidden">
                  <div className="grid grid-cols-12 gap-2 px-5 py-3 text-[11px] font-bold uppercase tracking-[0.15em] text-slate-400 border-b border-white/[0.08] bg-white/[0.02]">
                    <div className="col-span-2">时间</div>
                    <div className="col-span-7">任务</div>
                    <div className="col-span-3">等级</div>
                  </div>
                  <div
                    ref={listRef}
                    style={{ height: virtualizer.getTotalSize(), position: "relative" }}
                  >
                    {virtualizer.getVirtualItems().map((vRow) => {
                      const item = flatItems[vRow.index];
                      if (!item) return null;
                      return (
                        <div
                          key={item.key}
                          data-index={vRow.index}
                          ref={virtualizer.measureElement}
                          style={{
                            position: "absolute",
                            top: 0,
                            left: 0,
                            width: "100%",
                            transform: `translateY(${vRow.start - virtualizer.options.scrollMargin}px)`,
                          }}
                        >
                          {item.type === "day" ? (
                            <div className="px-5 py-3 bg-gradient-to-r from-cyan-400/[0.13] via-indigo-400/[0.06] to-transparent border-y border-white/[0.08]">
                              <div className="flex items-center gap-3">
                                <div className="h-2 w-2 rounded-full bg-cyan-300 shadow-[0_0_12px_rgba(103,232,249,0.9)]" />
                                <div className="text-sm font-bold text-white tracking-wide">
                                  {item.day}
                                </div>
                                <div className="flex-1 h-px bg-gradient-to-r from-white/15 to-transparent" />
                              </div>
                            </div>
                          ) : (() => {
                            const { ts, nodeKey } = item;
                            const n = nodes[nodeKey] ?? fallbackNode(nodeKey);
                            const tier = tierOfNode[nodeKey] ?? "unrated";
                            return (
                              <div
                                className={[
                                  "grid grid-cols-12 gap-2 px-5 py-3 items-center border-l-[3px] border-b border-white/[0.05] transition-colors hover:bg-white/[0.04]",
                                  tierStyle(tier).row,
                                ].join(" ")}
                              >
                                <div className="col-span-2 font-mono text-slate-200 tabular-nums">
                                  {hhmm(ts)}
                                </div>
                                <div className="col-span-7 min-w-0">
                                  <div className="text-sm font-semibold text-white truncate">
                                    {displayNode(n)}
                                  </div>
                                  <div className="font-mono text-xs text-slate-500 mt-0.5">
                                    {nodeKey}
                                  </div>
                                </div>
                                <div className="col-span-3 flex items-center gap-2.5">
                                  <TierPill tier={tier} />
                                  <select
                                    className="text-sm rounded-lg bg-black/30 ring-1 ring-white/10 px-2 py-1.5 outline-none transition focus:ring-2 focus:ring-cyan-400/50"
                                    value={tier}
                                    onChange={(e) => moveNode(nodeKey, e.target.value)}
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
                          })()}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <section className="space-y-3">
              <div className="flex items-center justify-end">{viewSwitch}</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {tiers
                  .filter((tier) => selectedTiers[tier] !== false)
                  .map((tier) => {
                    const keys = tierlist.tierBuckets[tier] ?? [];
                    const visibleKeys = keys.filter(isVisibleNode);
                    return (
                      <div
                        key={tier}
                        className="rounded-2xl bg-black/25 ring-1 ring-white/[0.08] overflow-hidden"
                      >
                        <div
                          className={[
                            "px-4 py-3 border-b border-white/[0.08] flex items-center justify-between bg-gradient-to-r to-transparent",
                            tierStyle(tier).header,
                          ].join(" ")}
                        >
                          <div className="flex items-center gap-2.5">
                            <TierPill tier={tier} />
                            <span className="text-sm font-bold text-white">节点</span>
                          </div>
                          <div className="font-mono text-xs text-slate-400 tabular-nums">
                            {visibleKeys.length}/{keys.length}
                          </div>
                        </div>

                        <div className="p-3 space-y-2">
                          {visibleKeys.length === 0 ? (
                            <div className="px-1 py-2 text-sm text-slate-500">（空）</div>
                          ) : (
                            visibleKeys.map((nodeKey) => {
                              const n = nodes[nodeKey];
                              const text = n ? displayNode(n) : nodeKey;
                              const nodeTier = tierOfNode[nodeKey] ?? "unrated";
                              return (
                                <div
                                  key={nodeKey}
                                  className={[
                                    "rounded-xl p-3.5 ring-1 ring-white/[0.08] border-l-[3px] transition-colors hover:bg-white/[0.04]",
                                    tierStyle(nodeTier).row,
                                  ].join(" ")}
                                >
                                  <div className="text-sm font-semibold text-white">
                                    {text}
                                  </div>
                                  <div className="font-mono text-xs text-slate-500 mt-1">
                                    {nodeKey}
                                  </div>
                                  <div className="mt-3 flex flex-wrap gap-2.5 items-center">
                                    <TierPill tier={nodeTier} />
                                    <select
                                      className="text-sm rounded-lg bg-black/30 ring-1 ring-white/10 px-2 py-1.5 outline-none transition focus:ring-2 focus:ring-cyan-400/50"
                                      value={nodeTier}
                                      onChange={(e) => moveNode(nodeKey, e.target.value)}
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
          className="fixed bottom-6 right-6 h-11 w-11 rounded-full bg-gradient-to-br from-cyan-500/90 to-indigo-500/90 text-white shadow-[0_4px_24px_rgba(34,211,238,0.4)] ring-1 ring-white/20 backdrop-blur flex items-center justify-center transition hover:scale-110 active:scale-95"
          onClick={() =>
            scheduleTopRef.current?.scrollIntoView({ behavior: "smooth" })
          }
          aria-label="回到顶部"
          title="回到顶部"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path
              d="M12 5l-7 7m7-7l7 7M12 5v14"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      ) : null}
    </div>
  );
}

/** 全页背景：深空底色 + 极光渐变 + 细网格 */
function Backdrop() {
  return (
    <div aria-hidden className="fixed inset-0 -z-10 overflow-hidden bg-[#060a14]">
      <div className="absolute -top-48 left-1/2 h-[640px] w-[920px] -translate-x-1/2 rounded-full bg-cyan-500/[0.10] blur-[120px]" />
      <div className="absolute top-1/4 -left-48 h-[560px] w-[560px] rounded-full bg-indigo-500/[0.10] blur-[120px]" />
      <div className="absolute bottom-0 -right-32 h-[600px] w-[600px] rounded-full bg-violet-500/[0.07] blur-[120px]" />
      <div
        className="absolute inset-0 opacity-[0.35]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(148,163,184,0.045) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.045) 1px, transparent 1px)",
          backgroundSize: "44px 44px",
          maskImage:
            "radial-gradient(ellipse 90% 60% at 50% 0%, black 30%, transparent 80%)",
          WebkitMaskImage:
            "radial-gradient(ellipse 90% 60% at 50% 0%, black 30%, transparent 80%)",
        }}
      />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(148,163,184,0.06),transparent_62%)]" />
    </div>
  );
}
