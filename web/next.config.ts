import type { NextConfig } from "next";

const basePath = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/$/, "");

const nextConfig: NextConfig = {
  // GitHub Pages 需要纯静态输出
  output: "export",
  trailingSlash: true,

  // 让你本地 dev 仍然用根路径；部署到 GH Pages 时由环境变量注入仓库名
  // 例如：NEXT_PUBLIC_BASE_PATH=/warframe-arbitration
  basePath,
  assetPrefix: basePath ? `${basePath}/` : undefined,

  // next/image 在 static export 下需关闭优化（你项目目前基本不用，但留着更稳）
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
