import type { Metadata } from "next";
import { Nunito } from "next/font/google";
import "./arb-log.css";

const nunito = Nunito({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800", "900"],
  variable: "--font-nunito",
  display: "swap",
});

export const metadata: Metadata = {
  title: "日志分析 | Warframe Arbitration",
  description: "上传 EE.log 分析仲裁记录：无人机统计、期望生息精华、时间线",
};

export default function LogLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <div className={nunito.variable}>{children}</div>;
}
