export type ScheduleEntry = { ts: number; nodeKey: string };

export type NodeInfo = {
  nodeKey: string;
  missionNameZh: string;
  factionNameZh: string;
  nameZh: string;
  systemNameZh: string;
  minEnemyLevel?: number | null;
  maxEnemyLevel?: number | null;
};

export type NodesZhFile = {
  schema: number;
  nodes: Record<string, NodeInfo>;
};

export type Tierlist = {
  schema: number;
  tiers: string[];
  tierBuckets: Record<string, string[]>;
  notes?: string;
};

export const DEFAULT_TIERS = ["S", "A+", "A", "A-", "B", "C", "unrated"] as const;

export function hhmm(ts: number) {
  const d = new Date(ts * 1000);
  const h = d.getHours();
  const m = d.getMinutes();
  // 需求：显示成 01:00 / 02:00 / 24:00（把 00:00 显示为 24:00）
  if (h === 0 && m === 0) return "24:00";
  const hh = String(h).padStart(2, "0");
  const mm = String(m).padStart(2, "0");
  return `${hh}:${mm}`;
}

export function displayNode(n: NodeInfo) {
  const mission = n.missionNameZh || n.nodeKey;
  const faction = n.factionNameZh || "";
  const place = n.nameZh || n.nodeKey;
  const planet = n.systemNameZh || "";
  const mid = faction ? `${mission} - ${faction}` : mission;
  const tail = planet ? `${place}, ${planet}` : place;
  return `${mid} @ ${tail}`;
}

export function findCurrentIndex(schedule: ScheduleEntry[], now: number) {
  let lo = 0;
  let hi = schedule.length - 1;
  let ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (schedule[mid]!.ts <= now) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

export function buildTierOfNode(t: Tierlist) {
  const out: Record<string, string> = {};
  for (const tier of t.tiers) {
    const arr = t.tierBuckets[tier] ?? [];
    for (const k of arr) out[k] = tier;
  }
  return out;
}

export function normalizeTierlist(t: Tierlist, allNodeKeys: string[]) {
  const tiers = (DEFAULT_TIERS as unknown as string[]).slice();

  const tierBuckets: Record<string, string[]> = {};
  for (const tier of tiers) tierBuckets[tier] = [];

  // 把输入的 buckets 合并进来；兼容 “未评级” 这个键名
  if (t?.tierBuckets && typeof t.tierBuckets === "object") {
    for (const tier of tiers) {
      const arr = (t.tierBuckets as any)[tier];
      if (Array.isArray(arr)) tierBuckets[tier] = [...arr];
    }
    const zhUnrated = (t.tierBuckets as any)["未评级"];
    if (Array.isArray(zhUnrated)) tierBuckets.unrated.push(...zhUnrated);

    // 旧的/未知的 tiers（例如 D/F）折叠进 C
    const extra: string[] = [];
    for (const [tier, arr] of Object.entries(t.tierBuckets)) {
      if (tiers.includes(tier) || tier === "未评级") continue;
      if (!Array.isArray(arr)) continue;
      extra.push(...arr);
    }
    if (extra.length) tierBuckets.C.push(...extra);
  }

  // 去重
  const seen = new Set<string>();
  for (const tier of tiers) {
    tierBuckets[tier] = tierBuckets[tier].filter((k) => {
      if (typeof k !== "string" || !k) return false;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  // 缺失节点全部补到 未评级（unrated）
  for (const k of allNodeKeys) if (!seen.has(k)) tierBuckets.unrated.push(k);

  return { schema: 1, tiers, tierBuckets } satisfies Tierlist;
}


export function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}