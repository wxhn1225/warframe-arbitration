// ---- 文案/数字格式化 ----------------------------------------------------------

export function t(dict: Record<string, string> | null, key?: string): string | undefined {
  if (!key) return undefined;
  const v = dict?.[key];
  if (typeof v === "string" && v.trim()) return v;
  return key;
}

export function formatDuration(v?: number): string {
  if (v == null) return "-";
  const s = Math.max(0, Math.floor(v)); // 只显示整数部分（不四舍五入）
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s - m * 60;
  if (m < 60) return `${m}m ${rs}s`;
  const h = Math.floor(m / 60);
  const rm = m - h * 60;
  return `${h}h ${rm}m ${rs}s`;
}

export function formatPerMin(v?: number): string {
  if (v == null) return "-";
  if (!Number.isFinite(v)) return "-";
  return v.toFixed(2);
}

export function formatNumber(v?: number, digits = 3): string {
  if (v == null) return "-";
  if (!Number.isFinite(v)) return "-";
  return v.toFixed(digits);
}

export function formatSignedPercent(v?: number): string {
  if (v == null || !Number.isFinite(v)) return "-";
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
}
