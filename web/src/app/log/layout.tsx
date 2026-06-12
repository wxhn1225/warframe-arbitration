import type { Metadata } from "next";
import "./arb-log.css";

export const metadata: Metadata = {
  title: "日志分析 | Warframe Arbitration",
  description: "上传 EE.log 分析仲裁记录：无人机统计、期望生息精华、时间线",
};

export default function LogLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
