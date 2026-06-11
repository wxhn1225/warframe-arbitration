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
  chip: string;
  bar: string;
  strip: string;
};

// 近白画布下的等级配色：S 用实心墨色（全页最强对比），
// 其余用低饱和软色块，色彩只用于表达等级语义
const TIER_STYLES: Record<string, TierStyle> = {
  S: {
    chip: "bg-neutral-900 text-white",
    bar: "border-l-neutral-900",
    strip: "bg-neutral-900",
  },
  "A+": {
    chip: "bg-rose-100 text-rose-700 ring-1 ring-inset ring-rose-200",
    bar: "border-l-rose-400",
    strip: "bg-rose-400",
  },
  A: {
    chip: "bg-orange-100 text-orange-700 ring-1 ring-inset ring-orange-200",
    bar: "border-l-orange-400",
    strip: "bg-orange-400",
  },
  "A-": {
    chip: "bg-yellow-100 text-yellow-700 ring-1 ring-inset ring-yellow-200",
    bar: "border-l-yellow-400",
    strip: "bg-yellow-400",
  },
  B: {
    chip: "bg-emerald-100 text-emerald-700 ring-1 ring-inset ring-emerald-200",
    bar: "border-l-emerald-400",
    strip: "bg-emerald-400",
  },
  C: {
    chip: "bg-sky-100 text-sky-700 ring-1 ring-inset ring-sky-200",
    bar: "border-l-sky-400",
    strip: "bg-sky-400",
  },
  unrated: {
    chip: "bg-neutral-100 text-neutral-500 ring-1 ring-inset ring-neutral-200",
    bar: "border-l-neutral-300",
    strip: "bg-neutral-300",
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

/**
 * 当前小时进度条 + 剩余倒计时。
 * 独立 1s 计时：只有这个小组件每秒重渲染，不影响主列表。
 */
function HourProgress({ startTs }: { startTs: number }) {
  const calc = () => Math.floor(Date.now() / 1000) - startTs;
  const [elapsed, setElapsed] = useState(calc);
  useEffect(() => {
    setElapsed(calc());
    const id = setInterval(() => setElapsed(calc()), 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startTs]);

  const clamped = Math.min(3600, Math.max(0, elapsed));
  const left = 3600 - clamped;
  const mm = String(Math.floor(left / 60)).padStart(2, "0");
  const ss = String(left % 60).padStart(2, "0");

  return (
    <div className="flex items-center gap-4">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-neutral-200/80">
        <div
          className="h-full rounded-full bg-neutral-900 transition-[width] duration-1000 ease-linear"
          style={{ width: `${(clamped / 3600) * 100}%` }}
        />
      </div>
      <div className="shrink-0 text-sm text-neutral-500">
        剩余{" "}
        <span className="font-mono text-base font-semibold text-neutral-900 tabular-nums">
          {mm}:{ss}
        </span>
      </div>
    </div>
  );
}

function TierChip({ tier, className = "" }: { tier: string; className?: string }) {
  return (
    <span
      className={[
        "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-bold tracking-wide",
        tierStyle(tier).chip,
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
      <div className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
        {label}
      </div>
      <div className="relative">
        <select
          className="w-full appearance-none rounded-lg border border-neutral-200 bg-white px-3.5 py-2.5 pr-10 text-neutral-800 outline-none transition hover:border-neutral-300 focus:border-neutral-400 focus:ring-2 focus:ring-neutral-300/60"
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
          className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-neutral-400"
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

const CARD =
  "rounded-2xl border border-neutral-200/80 bg-white shadow-[0_1px_2px_rgba(28,25,23,0.04),0_16px_40px_-24px_rgba(28,25,23,0.12)]";
const GHOST_BTN =
  "rounded-lg border border-neutral-200 bg-white px-3.5 py-2 text-sm font-medium text-neutral-600 transition hover:border-neutral-300 hover:text-neutral-900 hover:shadow-sm";

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
      <div className="min-h-screen">
        <main className="mx-auto max-w-6xl space-y-6 px-5 py-10 md:px-8">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 animate-pulse rounded-xl bg-neutral-200/80" />
            <div className="space-y-2">
              <div className="h-5 w-48 animate-pulse rounded-md bg-neutral-200/80" />
              <div className="h-3 w-32 animate-pulse rounded-md bg-neutral-200/60" />
            </div>
          </div>
          <div className="h-44 animate-pulse rounded-2xl bg-neutral-200/50" />
          <div className="h-28 animate-pulse rounded-2xl bg-neutral-200/50" />
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="h-12 animate-pulse rounded-xl bg-neutral-200/40"
                style={{ animationDelay: `${i * 80}ms` }}
              />
            ))}
          </div>
          <div className="text-sm text-neutral-400">正在加载仲裁数据…</div>
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
    <div className="inline-flex shrink-0 rounded-lg bg-neutral-100 p-1">
      {(
        [
          ["schedule", "仲裁时间"],
          ["tierlist", "等级表"],
        ] as const
      ).map(([key, label]) => (
        <button
          key={key}
          className={[
            "rounded-md px-4 py-1.5 text-sm font-semibold transition",
            tab === key
              ? "bg-neutral-900 text-white shadow-sm"
              : "text-neutral-500 hover:text-neutral-900",
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
    <div className="min-h-screen">
      <main className="mx-auto max-w-6xl space-y-5 px-5 py-8 md:px-8 md:py-10">
        {/* ======= 顶栏 ======= */}
        <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3.5">
            <div className="grid h-11 w-11 place-items-center rounded-xl bg-neutral-900 shadow-[0_2px_8px_rgba(28,25,23,0.25)]">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <rect
                  x="12"
                  y="2.8"
                  width="13"
                  height="13"
                  rx="2"
                  transform="rotate(45 12 2.8)"
                  fill="#FFFFFF"
                />
              </svg>
            </div>
            <div>
              <h1 className="text-[26px] font-extrabold leading-none tracking-tight text-neutral-900">
                仲裁时刻
              </h1>
              <p className="mt-1.5 font-mono text-[11px] font-medium tracking-[0.24em] text-neutral-400">
                WARFRAME ARBITRATION
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              className={GHOST_BTN}
              onClick={exportScheduleTxt}
              title="导出当前选择范围的仲裁序列 TXT"
            >
              导出 TXT
            </button>
            <button
              className={GHOST_BTN}
              onClick={exportScheduleJson}
              title="导出当前选择范围的仲裁序列 JSON"
            >
              导出 JSON
            </button>
            {isDevMode && (
              <button
                className={GHOST_BTN}
                onClick={exportTierlistJson}
                title="导出当前等级表 JSON（可发给开发者更新默认值）"
              >
                导出等级表
              </button>
            )}
            <button
              className={GHOST_BTN}
              onClick={resetToDefault}
              title="清空本地保存的等级表，恢复默认"
            >
              恢复默认等级
            </button>
          </div>
        </header>

        {/* ======= 当前仲裁 ======= */}
        <section className={`${CARD} overflow-hidden`}>
          <div className="grid gap-6 p-5 md:grid-cols-[1fr_280px] md:items-stretch md:p-7">
            <div className="min-w-0 flex flex-col">
              <div className="flex items-center gap-2.5">
                <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
                <span className="font-mono text-xs font-semibold uppercase tracking-[0.2em] text-neutral-400">
                  Live · 正在进行
                </span>
                {current ? <TierChip tier={currentTier} /> : null}
              </div>

              <div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <div className="font-mono text-5xl font-bold tabular-nums tracking-tight text-neutral-900 md:text-6xl">
                  {current ? hhmm(current.cur.ts) : "—"}
                </div>
                <div className="min-w-0 truncate text-base font-semibold text-neutral-700 md:text-xl">
                  {currentNode ? displayNode(currentNode) : "—"}
                </div>
              </div>
              {current ? (
                <div className="mt-1 font-mono text-xs text-neutral-400">
                  {current.cur.nodeKey}
                </div>
              ) : null}

              {current ? (
                <div className="mt-auto pt-5">
                  <HourProgress startTs={current.cur.ts} />
                </div>
              ) : null}
            </div>

            {current ? (
              <aside className="rounded-xl border border-neutral-200/80 bg-neutral-50/80 p-4 md:p-5">
                <div className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-neutral-400">
                  Next · 下一场
                </div>
                <div className="mt-2.5 flex items-center gap-2.5">
                  <span className="font-mono text-2xl font-semibold tabular-nums text-neutral-900">
                    {hhmm(current.next.ts)}
                  </span>
                  <TierChip tier={nextTier} />
                </div>
                <div className="mt-1.5 text-sm leading-snug text-neutral-600">
                  {nextNode ? displayNode(nextNode) : "—"}
                </div>
                <div className="mt-1 font-mono text-xs text-neutral-400">
                  {current.next.nodeKey}
                </div>
              </aside>
            ) : null}
          </div>
        </section>

        {/* ======= 筛选 ======= */}
        <section className={`${CARD} space-y-5 p-5 md:p-6`}>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex flex-wrap items-start gap-x-8 gap-y-4">
              <div className="space-y-1.5">
                <div className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
                  显示范围
                </div>
                <div className="inline-flex rounded-lg bg-neutral-100 p-1">
                  {RANGE_OPTIONS.map(([hours, label]) => (
                    <button
                      key={hours}
                      className={[
                        "rounded-md px-3 py-1.5 text-sm font-medium transition",
                        rangeHours === hours
                          ? "bg-white font-semibold text-neutral-900 shadow-sm"
                          : "text-neutral-500 hover:text-neutral-900",
                      ].join(" ")}
                      onClick={() => setRangeHours(hours)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
                  筛选等级
                </div>
                <div className="flex flex-wrap gap-1.5 pt-0.5">
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
                          "rounded-md px-2.5 py-1 text-xs font-bold tracking-wide transition",
                          active
                            ? tierStyle(tier).chip
                            : "border border-dashed border-neutral-300 bg-white text-neutral-400 hover:border-neutral-400 hover:text-neutral-600",
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
                "shrink-0 rounded-lg px-3.5 py-2 text-sm font-medium transition",
                hasActiveFilter
                  ? "border border-neutral-300 bg-neutral-100 text-neutral-900 hover:bg-neutral-200"
                  : "border border-neutral-200 bg-white text-neutral-400",
              ].join(" ")}
              onClick={clearFilters}
              title="清空筛选与搜索"
            >
              清空筛选
            </button>
          </div>

          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
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
              <div className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
                关键词
              </div>
              <div className="relative">
                <svg
                  className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-neutral-400"
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                >
                  <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
                  <path
                    d="M20 20l-3.5-3.5"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
                <input
                  className="w-full rounded-lg border border-neutral-200 bg-white py-2.5 pl-10 pr-3.5 text-neutral-800 outline-none transition placeholder:text-neutral-400 hover:border-neutral-300 focus:border-neutral-400 focus:ring-2 focus:ring-neutral-300/60"
                  placeholder="例如 地球拦截 或 地球 拦截"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <div className="text-xs text-neutral-400">
                匹配星球 / 任务 / 派系 / 节点名 / Key
              </div>
            </div>
          </div>

          {tab === "schedule" ? (
            <div className="space-y-3">
              <div
                ref={scheduleTopRef}
                className="flex flex-wrap items-center justify-between gap-3 text-sm text-neutral-500"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span>未来范围</span>
                  {rangeItems.length > 0 ? (
                    <>
                      <span className="font-mono tabular-nums text-neutral-700">
                        {dayLabel(rangeItems[0]!.ts)} {hhmm(rangeItems[0]!.ts)}
                      </span>
                      <span className="text-neutral-300">→</span>
                      <span className="font-mono tabular-nums text-neutral-700">
                        {dayLabel(rangeItems[rangeItems.length - 1]!.ts)}{" "}
                        {hhmm(rangeItems[rangeItems.length - 1]!.ts)}
                      </span>
                      <span className="text-neutral-400">
                        （{rangeItems.length} 条 / {Math.round(rangeItems.length / 24)} 天）
                      </span>
                    </>
                  ) : (
                    <span>—</span>
                  )}
                </div>
                {viewSwitch}
              </div>

              {flatItems.length === 0 ? (
                <div className="rounded-xl border border-dashed border-neutral-300 py-16 text-center text-neutral-400">
                  没有符合当前筛选条件的仲裁
                </div>
              ) : null}

              {/* 手机：卡片虚拟列表 */}
              {isMobile && flatItems.length > 0 && (
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
                          <div className="mb-2 flex items-center gap-2 rounded-lg bg-neutral-100/80 px-3.5 py-2">
                            <span className="inline-block h-1.5 w-1.5 rotate-45 bg-neutral-400" />
                            <span className="text-sm font-bold tracking-wide text-neutral-800">
                              {item.day}
                            </span>
                          </div>
                        ) : (() => {
                          const { ts, nodeKey } = item;
                          const n = nodes[nodeKey] ?? fallbackNode(nodeKey);
                          const tier = tierOfNode[nodeKey] ?? "unrated";
                          return (
                            <div
                              className={[
                                "mb-2 rounded-xl border border-neutral-200/80 border-l-[3px] bg-white p-3.5 shadow-[0_1px_2px_rgba(28,25,23,0.04)]",
                                tierStyle(tier).bar,
                              ].join(" ")}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="font-mono text-base font-semibold tabular-nums text-neutral-900">
                                  {hhmm(ts)}
                                </div>
                                <TierChip tier={tier} />
                              </div>
                              <div className="mt-1.5 text-sm font-semibold text-neutral-800">
                                {displayNode(n)}
                              </div>
                              <div className="mt-0.5 font-mono text-xs text-neutral-400">
                                {nodeKey}
                              </div>
                              <div className="mt-3">
                                <select
                                  className="w-full rounded-lg border border-neutral-200 bg-white px-2.5 py-2 text-sm text-neutral-700 outline-none focus:border-neutral-400 focus:ring-2 focus:ring-neutral-300/60"
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
              {!isMobile && flatItems.length > 0 && (
                <div className="overflow-hidden rounded-xl border border-neutral-200/80">
                  <div className="grid grid-cols-12 gap-2 border-b border-neutral-200 bg-neutral-50/80 px-5 py-3 text-[11px] font-bold uppercase tracking-[0.15em] text-neutral-400">
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
                            <div className="flex items-center gap-3 border-b border-neutral-200/80 bg-neutral-50 px-5 py-3">
                              <span className="inline-block h-1.5 w-1.5 rotate-45 bg-neutral-400" />
                              <span className="text-sm font-bold tracking-wide text-neutral-800">
                                {item.day}
                              </span>
                              <div className="h-px flex-1 bg-neutral-200/70" />
                            </div>
                          ) : (() => {
                            const { ts, nodeKey } = item;
                            const n = nodes[nodeKey] ?? fallbackNode(nodeKey);
                            const tier = tierOfNode[nodeKey] ?? "unrated";
                            return (
                              <div
                                className={[
                                  "grid grid-cols-12 items-center gap-2 border-b border-neutral-100 border-l-[3px] bg-white px-5 py-3 transition-colors hover:bg-neutral-50",
                                  tierStyle(tier).bar,
                                ].join(" ")}
                              >
                                <div className="col-span-2 font-mono tabular-nums text-neutral-700">
                                  {hhmm(ts)}
                                </div>
                                <div className="col-span-7 min-w-0">
                                  <div className="truncate text-sm font-semibold text-neutral-800">
                                    {displayNode(n)}
                                  </div>
                                  <div className="mt-0.5 font-mono text-xs text-neutral-400">
                                    {nodeKey}
                                  </div>
                                </div>
                                <div className="col-span-3 flex items-center gap-2.5">
                                  <TierChip tier={tier} />
                                  <select
                                    className="rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-sm text-neutral-700 outline-none transition focus:border-neutral-400 focus:ring-2 focus:ring-neutral-300/60"
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
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {tiers
                  .filter((tier) => selectedTiers[tier] !== false)
                  .map((tier) => {
                    const keys = tierlist.tierBuckets[tier] ?? [];
                    const visibleKeys = keys.filter(isVisibleNode);
                    return (
                      <div
                        key={tier}
                        className="overflow-hidden rounded-xl border border-neutral-200/80 bg-white"
                      >
                        <div className={["h-1 w-full", tierStyle(tier).strip].join(" ")} />
                        <div className="flex items-center justify-between border-b border-neutral-200/70 px-4 py-3">
                          <div className="flex items-center gap-2.5">
                            <TierChip tier={tier} />
                            <span className="text-sm font-bold text-neutral-800">节点</span>
                          </div>
                          <div className="font-mono text-xs tabular-nums text-neutral-400">
                            {visibleKeys.length}/{keys.length}
                          </div>
                        </div>

                        <div className="space-y-2 p-3">
                          {visibleKeys.length === 0 ? (
                            <div className="px-1 py-2 text-sm text-neutral-400">（空）</div>
                          ) : (
                            visibleKeys.map((nodeKey) => {
                              const n = nodes[nodeKey];
                              const text = n ? displayNode(n) : nodeKey;
                              const nodeTier = tierOfNode[nodeKey] ?? "unrated";
                              return (
                                <div
                                  key={nodeKey}
                                  className={[
                                    "rounded-lg border border-neutral-200/80 border-l-[3px] bg-white p-3.5 transition-colors hover:bg-neutral-50",
                                    tierStyle(nodeTier).bar,
                                  ].join(" ")}
                                >
                                  <div className="text-sm font-semibold text-neutral-800">
                                    {text}
                                  </div>
                                  <div className="mt-1 font-mono text-xs text-neutral-400">
                                    {nodeKey}
                                  </div>
                                  <div className="mt-3 flex flex-wrap items-center gap-2.5">
                                    <TierChip tier={nodeTier} />
                                    <select
                                      className="rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-sm text-neutral-700 outline-none transition focus:border-neutral-400 focus:ring-2 focus:ring-neutral-300/60"
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

        <footer className="pb-2 pt-1 text-center text-xs text-neutral-400">
          整点轮换 · 等级表保存在本地浏览器，可随时恢复默认
        </footer>
      </main>

      {showScrollTop && tab === "schedule" ? (
        <button
          className="fixed bottom-6 right-6 flex h-11 w-11 items-center justify-center rounded-full bg-neutral-900 text-white shadow-[0_4px_16px_rgba(0,0,0,0.2)] transition hover:bg-neutral-700 active:scale-95"
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
