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

// 玻璃面板上的等级配色：实心彩色徽章 + 整行渐变着色，等级差异一眼可辨
const TIER_STYLES: Record<string, TierStyle> = {
  S: {
    chip: "bg-gradient-to-r from-amber-400 to-orange-500 text-white shadow-[0_2px_12px_rgba(245,158,11,0.55)]",
    bar: "border-l-amber-400 bg-gradient-to-r from-amber-400/35 via-amber-400/15 to-transparent",
    strip: "bg-gradient-to-r from-amber-400 to-orange-500",
  },
  "A+": {
    chip: "bg-rose-500 text-white shadow-[0_2px_12px_rgba(244,63,94,0.5)]",
    bar: "border-l-rose-400 bg-gradient-to-r from-rose-500/30 via-rose-500/12 to-transparent",
    strip: "bg-rose-500",
  },
  A: {
    chip: "bg-orange-500 text-white shadow-[0_2px_12px_rgba(249,115,22,0.5)]",
    bar: "border-l-orange-400 bg-gradient-to-r from-orange-500/30 via-orange-500/12 to-transparent",
    strip: "bg-orange-500",
  },
  "A-": {
    chip: "bg-yellow-400 text-yellow-950 shadow-[0_2px_12px_rgba(250,204,21,0.5)]",
    bar: "border-l-yellow-300 bg-gradient-to-r from-yellow-400/28 via-yellow-400/12 to-transparent",
    strip: "bg-yellow-400",
  },
  B: {
    chip: "bg-emerald-500 text-white shadow-[0_2px_12px_rgba(16,185,129,0.5)]",
    bar: "border-l-emerald-400 bg-gradient-to-r from-emerald-500/28 via-emerald-500/12 to-transparent",
    strip: "bg-emerald-500",
  },
  C: {
    chip: "bg-sky-500 text-white shadow-[0_2px_12px_rgba(14,165,233,0.5)]",
    bar: "border-l-sky-400 bg-gradient-to-r from-sky-500/28 via-sky-500/12 to-transparent",
    strip: "bg-sky-500",
  },
  unrated: {
    chip: "bg-white/15 text-white/75 ring-1 ring-inset ring-white/25",
    bar: "border-l-white/30 bg-white/[0.05]",
    strip: "bg-white/30",
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
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/15 shadow-[inset_0_1px_2px_rgba(0,0,0,0.4)]">
        <div
          className="h-full rounded-full bg-gradient-to-r from-sky-500 via-indigo-500 to-violet-500 shadow-[0_0_12px_rgba(99,102,241,0.5)] transition-[width] duration-1000 ease-linear"
          style={{ width: `${(clamped / 3600) * 100}%` }}
        />
      </div>
      <div className="shrink-0 text-sm text-white/60">
        剩余{" "}
        <span className="font-mono text-base font-semibold text-white tabular-nums">
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
      <div className="text-xs font-semibold uppercase tracking-wider text-white/55">
        {label}
      </div>
      <div className="relative">
        <select
          className="w-full appearance-none rounded-xl border border-white/25 bg-white/10 px-3.5 py-2.5 pr-10 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.2)] backdrop-blur-md outline-none transition hover:bg-white/15 focus:border-sky-400 focus:ring-2 focus:ring-sky-300/50"
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
          className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-white/55"
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

const CARD = "glass rounded-3xl";
const GHOST_BTN =
  "glass-inner rounded-xl px-3.5 py-2 text-sm font-medium text-white/80 transition hover:bg-white/20 hover:text-white hover:shadow-md";

/**
 * 全页背景：二次元画面 + 轻微暗角，玻璃卡片的折射源。
 * 注意：不能用负 z-index——body 自身的不透明背景会把它盖住，
 * 这里用 z-0，内容区用 relative z-10 叠在上面。
 */
function Backdrop() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden bg-[#11131d]"
    >
      <div
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: `url(${dataUrl("/bg.jpg")})` }}
      />
      <div className="absolute inset-0 bg-gradient-to-b from-[#0a0c16]/50 via-[#0a0c16]/25 to-[#0a0c16]/65" />
    </div>
  );
}

/**
 * 指针特效：
 * 1. 一团柔光跟随鼠标（缓动追踪，screen 混合 -> 像光透过玻璃折射）
 * 2. 点击/触摸处泛起双圈水波纹
 * 全部用 ref 直接操作 DOM + transform，不触发 React 重渲染。
 */
function PointerEffects() {
  const spotRef = useRef<HTMLDivElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const spot = spotRef.current;
    const host = hostRef.current;
    if (!spot || !host) return;

    let tx = window.innerWidth / 2;
    let ty = window.innerHeight / 3;
    let cx = tx;
    let cy = ty;
    let raf = 0;

    const tick = () => {
      cx += (tx - cx) * 0.1;
      cy += (ty - cy) * 0.1;
      spot.style.transform = `translate3d(${cx - 320}px, ${cy - 320}px, 0)`;
      if (Math.abs(tx - cx) + Math.abs(ty - cy) > 0.5) {
        raf = requestAnimationFrame(tick);
      } else {
        raf = 0;
      }
    };

    const onMove = (e: PointerEvent) => {
      tx = e.clientX;
      ty = e.clientY;
      spot.style.opacity = "1";
      if (!raf) raf = requestAnimationFrame(tick);
    };

    const onDown = (e: PointerEvent) => {
      for (let i = 0; i < 2; i++) {
        const ring = document.createElement("span");
        ring.className = "ripple";
        ring.style.left = `${e.clientX}px`;
        ring.style.top = `${e.clientY}px`;
        ring.style.animationDelay = `${i * 140}ms`;
        ring.addEventListener("animationend", () => ring.remove());
        host.appendChild(ring);
      }
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerdown", onDown, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <>
      <div ref={spotRef} aria-hidden className="spotlight opacity-0" />
      <div
        ref={hostRef}
        aria-hidden
        className="pointer-events-none fixed inset-0 z-20 overflow-hidden"
      />
    </>
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
      <div className="min-h-screen">
        <Backdrop />
        <main className="relative z-10 mx-auto max-w-6xl space-y-6 px-5 py-10 md:px-8">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 animate-pulse rounded-xl bg-white/15" />
            <div className="space-y-2">
              <div className="h-5 w-48 animate-pulse rounded-md bg-white/15" />
              <div className="h-3 w-32 animate-pulse rounded-md bg-white/10" />
            </div>
          </div>
          <div className="h-44 animate-pulse rounded-2xl bg-white/10" />
          <div className="h-28 animate-pulse rounded-2xl bg-white/10" />
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="h-12 animate-pulse rounded-xl bg-white/10"
                style={{ animationDelay: `${i * 80}ms` }}
              />
            ))}
          </div>
          <div className="text-sm text-white/55">正在加载仲裁数据…</div>
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
    <div className="glass-inner inline-flex shrink-0 rounded-xl p-1">
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
              ? "bg-white text-neutral-900 shadow-sm"
              : "text-white/60 hover:text-white",
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
      <Backdrop />
      <PointerEffects />
      <main className="relative z-10 mx-auto max-w-6xl space-y-5 px-5 py-8 md:px-8 md:py-10">
        {/* ======= 顶栏 ======= */}
        <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={dataUrl("/logo.png")}
              alt="仲裁"
              width={44}
              height={44}
              className="h-11 w-11 rounded-2xl object-cover ring-1 ring-white/40 shadow-[0_6px_20px_rgba(139,92,246,0.45)]"
            />
            <div>
              <h1 className="text-[26px] font-extrabold leading-none tracking-tight text-white">
                仲裁
              </h1>
              <p className="mt-1.5 font-mono text-[11px] font-medium tracking-[0.24em] text-white/55">
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
                <span className="font-mono text-xs font-semibold uppercase tracking-[0.2em] text-white/55">
                  Live · 正在进行
                </span>
                {current ? <TierChip tier={currentTier} /> : null}
              </div>

              <div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <div className="font-mono text-5xl font-bold tabular-nums tracking-tight text-white md:text-6xl">
                  {current ? hhmm(current.cur.ts) : "—"}
                </div>
                <div className="min-w-0 truncate text-base font-semibold text-white/80 md:text-xl">
                  {currentNode ? displayNode(currentNode) : "—"}
                </div>
              </div>
              {current ? (
                <div className="mt-1 font-mono text-xs text-white/55">
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
              <aside className="glass-inner rounded-2xl p-4 md:p-5">
                <div className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-white/55">
                  Next · 下一场
                </div>
                <div className="mt-2.5 flex items-center gap-2.5">
                  <span className="font-mono text-2xl font-semibold tabular-nums text-white">
                    {hhmm(current.next.ts)}
                  </span>
                  <TierChip tier={nextTier} />
                </div>
                <div className="mt-1.5 text-sm leading-snug text-white/70">
                  {nextNode ? displayNode(nextNode) : "—"}
                </div>
                <div className="mt-1 font-mono text-xs text-white/55">
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
                <div className="text-xs font-semibold uppercase tracking-wider text-white/55">
                  显示范围
                </div>
                <div className="glass-inner inline-flex rounded-xl p-1">
                  {RANGE_OPTIONS.map(([hours, label]) => (
                    <button
                      key={hours}
                      className={[
                        "rounded-lg px-3 py-1.5 text-sm font-medium transition",
                        rangeHours === hours
                          ? "bg-white font-semibold text-neutral-900 shadow-md"
                          : "text-white/60 hover:text-white",
                      ].join(" ")}
                      onClick={() => setRangeHours(hours)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="text-xs font-semibold uppercase tracking-wider text-white/55">
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
                            : "border border-dashed border-white/30 bg-white/5 text-white/55 hover:border-white/50 hover:text-white/80",
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
                "shrink-0 rounded-xl px-3.5 py-2 text-sm font-medium transition",
                hasActiveFilter
                  ? "bg-white text-neutral-900 shadow-md hover:bg-white/85"
                  : "glass-inner text-white/55",
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
              <div className="text-xs font-semibold uppercase tracking-wider text-white/55">
                关键词
              </div>
              <div className="relative">
                <svg
                  className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-white/55"
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
                  className="w-full rounded-xl border border-white/25 bg-white/10 py-2.5 pl-10 pr-3.5 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.2)] backdrop-blur-md outline-none transition placeholder:text-white/40 hover:bg-white/15 focus:border-sky-400 focus:ring-2 focus:ring-sky-300/50"
                  placeholder="例如 地球拦截 或 地球 拦截"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <div className="text-xs text-white/55">
                匹配星球 / 任务 / 派系 / 节点名 / Key
              </div>
            </div>
          </div>

          {tab === "schedule" ? (
            <div className="space-y-3">
              <div
                ref={scheduleTopRef}
                className="flex flex-wrap items-center justify-between gap-3 text-sm text-white/60"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span>未来范围</span>
                  {rangeItems.length > 0 ? (
                    <>
                      <span className="font-mono tabular-nums text-white/80">
                        {dayLabel(rangeItems[0]!.ts)} {hhmm(rangeItems[0]!.ts)}
                      </span>
                      <span className="text-white/35">→</span>
                      <span className="font-mono tabular-nums text-white/80">
                        {dayLabel(rangeItems[rangeItems.length - 1]!.ts)}{" "}
                        {hhmm(rangeItems[rangeItems.length - 1]!.ts)}
                      </span>
                      <span className="text-white/55">
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
                <div className="rounded-2xl border border-dashed border-white/25 bg-white/5 py-16 text-center text-white/60 backdrop-blur-sm">
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
                          <div className="glass-inner mb-2 flex items-center gap-2 rounded-xl px-3.5 py-2">
                            <span className="inline-block h-1.5 w-1.5 rotate-45 bg-gradient-to-br from-sky-500 to-violet-500" />
                            <span className="text-sm font-bold tracking-wide text-white/90">
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
                                "mb-2 rounded-xl border border-white/15 border-l-4 p-3.5 shadow-[0_4px_16px_rgba(0,0,0,0.3)] backdrop-blur-md",
                                tierStyle(tier).bar,
                              ].join(" ")}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="font-mono text-base font-semibold tabular-nums text-white">
                                  {hhmm(ts)}
                                </div>
                                <TierChip tier={tier} />
                              </div>
                              <div className="mt-1.5 text-sm font-semibold text-white/90">
                                {displayNode(n)}
                              </div>
                              <div className="mt-0.5 font-mono text-xs text-white/55">
                                {nodeKey}
                              </div>
                              <div className="mt-3">
                                <select
                                  className="w-full rounded-lg border border-white/25 bg-white/10 px-2.5 py-2 text-sm text-white/90 outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-300/50"
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
                <div className="overflow-hidden rounded-2xl border border-white/20 bg-white/[0.06] backdrop-blur-md">
                  <div className="grid grid-cols-12 gap-2 border-b border-white/15 bg-white/10 px-5 py-3 text-[11px] font-bold uppercase tracking-[0.15em] text-white/55">
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
                            <div className="flex items-center gap-3 border-b border-white/15 bg-white/10 px-5 py-3 backdrop-blur-sm">
                              <span className="inline-block h-1.5 w-1.5 rotate-45 bg-gradient-to-br from-sky-500 to-violet-500" />
                              <span className="text-sm font-bold tracking-wide text-white/90">
                                {item.day}
                              </span>
                              <div className="h-px flex-1 bg-white/20" />
                            </div>
                          ) : (() => {
                            const { ts, nodeKey } = item;
                            const n = nodes[nodeKey] ?? fallbackNode(nodeKey);
                            const tier = tierOfNode[nodeKey] ?? "unrated";
                            return (
                              <div
                                className={[
                                  "grid grid-cols-12 items-center gap-2 border-b border-white/10 border-l-4 px-5 py-3 transition hover:brightness-125",
                                  tierStyle(tier).bar,
                                ].join(" ")}
                              >
                                <div className="col-span-2 font-mono tabular-nums text-white/80">
                                  {hhmm(ts)}
                                </div>
                                <div className="col-span-7 min-w-0">
                                  <div className="truncate text-sm font-semibold text-white/90">
                                    {displayNode(n)}
                                  </div>
                                  <div className="mt-0.5 font-mono text-xs text-white/55">
                                    {nodeKey}
                                  </div>
                                </div>
                                <div className="col-span-3 flex items-center gap-2.5">
                                  <TierChip tier={tier} />
                                  <select
                                    className="rounded-lg border border-white/25 bg-white/10 px-2 py-1.5 text-sm text-white/90 shadow-sm outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-300/50"
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
                        className="overflow-hidden rounded-2xl border border-white/20 bg-white/[0.06] backdrop-blur-md"
                      >
                        <div className={["h-1 w-full", tierStyle(tier).strip].join(" ")} />
                        <div className="flex items-center justify-between border-b border-white/15 bg-white/5 px-4 py-3">
                          <div className="flex items-center gap-2.5">
                            <TierChip tier={tier} />
                            <span className="text-sm font-bold text-white/90">节点</span>
                          </div>
                          <div className="font-mono text-xs tabular-nums text-white/55">
                            {visibleKeys.length}/{keys.length}
                          </div>
                        </div>

                        <div className="space-y-2 p-3">
                          {visibleKeys.length === 0 ? (
                            <div className="px-1 py-2 text-sm text-white/55">（空）</div>
                          ) : (
                            visibleKeys.map((nodeKey) => {
                              const n = nodes[nodeKey];
                              const text = n ? displayNode(n) : nodeKey;
                              const nodeTier = tierOfNode[nodeKey] ?? "unrated";
                              return (
                                <div
                                  key={nodeKey}
                                  className={[
                                    "rounded-xl border border-white/15 border-l-4 p-3.5 shadow-[0_2px_10px_rgba(0,0,0,0.25)] transition hover:brightness-125",
                                    tierStyle(nodeTier).bar,
                                  ].join(" ")}
                                >
                                  <div className="text-sm font-semibold text-white/90">
                                    {text}
                                  </div>
                                  <div className="mt-1 font-mono text-xs text-white/55">
                                    {nodeKey}
                                  </div>
                                  <div className="mt-3 flex flex-wrap items-center gap-2.5">
                                    <TierChip tier={nodeTier} />
                                    <select
                                      className="rounded-lg border border-white/25 bg-white/10 px-2 py-1.5 text-sm text-white/90 shadow-sm outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-300/50"
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

        <footer className="pb-2 pt-1 text-center text-xs text-white/55">
          整点轮换 · 等级表保存在本地浏览器，可随时恢复默认
        </footer>
      </main>

      {showScrollTop && tab === "schedule" ? (
        <button
          className="fixed bottom-6 right-6 z-30 flex h-11 w-11 items-center justify-center rounded-full bg-white text-neutral-900 shadow-[0_4px_16px_rgba(0,0,0,0.45)] transition hover:bg-white/85 active:scale-95"
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
