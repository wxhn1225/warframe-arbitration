"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const BASE_PATH = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/$/, "");
const dataUrl = (p: string) => `${BASE_PATH}${p.startsWith("/") ? "" : "/"}${p}`;

/**
 * 全页背景：二次元画面 + 轻微暗角，玻璃卡片的折射源。
 * 注意：不能用负 z-index——body 自身的不透明背景会把它盖住，
 * 这里用 z-0，内容区用 relative z-10 叠在上面。
 */
export function Backdrop() {
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
// 触屏设备没有悬停指针，光效无意义还占合成开销，直接不挂载。
// useSyncExternalStore 订阅媒体查询：水合安全，且外接鼠标等设备变化时自动响应
const HOVER_QUERY = "(hover: hover) and (pointer: fine)";
const subscribeHover = (cb: () => void) => {
  const mq = window.matchMedia(HOVER_QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};
const getHasHoverPointer = () => window.matchMedia(HOVER_QUERY).matches;
const getServerFalse = () => false;

export function PointerEffects() {
  const enabled = useSyncExternalStore(subscribeHover, getHasHoverPointer, getServerFalse);
  if (!enabled) return null;
  return <PointerEffectsImpl />;
}

function PointerEffectsImpl() {
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
        className="pointer-events-none fixed inset-0 z-40 overflow-hidden"
      />
    </>
  );
}

const NAV_TABS = [
  { href: "/", label: "仲裁队列" },
  { href: "/log", label: "日志分析" },
] as const;

/**
 * 全站玻璃导航：左侧品牌（液态铬字），右侧两个分页标签。
 * 活跃标签 = 白色实底药丸，与队列页内部的 viewSwitch 同一套语言。
 */
export function SiteNav() {
  const pathname = usePathname();
  // 路由切换要等目标页整体挂载完，pathname 才会变；期间药丸不动会显得"点了没反应"。
  // 点击时先乐观高亮目标标签，真实路径跟上后清掉。
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const [prevPathname, setPrevPathname] = useState(pathname);
  if (prevPathname !== pathname) {
    setPrevPathname(pathname);
    setPendingHref(null);
  }
  const shownPath = pendingHref ?? pathname;
  const isLog = shownPath.startsWith("/log");

  return (
    <div className="sticky top-3 z-30 mx-auto w-full max-w-6xl px-5 md:px-8">
      <nav className="glass flex items-center justify-between gap-3 rounded-2xl px-4 py-2.5 md:px-5">
        <Link href="/" className="flex min-w-0 items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={dataUrl("/logo.png")}
            alt="Warframe Arbitration"
            width={34}
            height={34}
            className="h-[34px] w-[34px] shrink-0 rounded-xl object-cover ring-1 ring-white/40"
          />
          <span className="chrome-word hidden truncate font-mono text-[13px] font-bold tracking-[0.22em] sm:block">
            WARFRAME ARBITRATION
          </span>
        </Link>

        <div
          className="lm-seg shrink-0"
          style={{ "--seg-n": 2, "--seg-i": isLog ? 1 : 0 } as React.CSSProperties}
        >
          <div aria-hidden className="lm-seg-thumb" />
          {NAV_TABS.map(({ href, label }) => {
            const active = href === "/log" ? isLog : !isLog;
            return (
              <Link
                key={href}
                href={href}
                onClick={() => setPendingHref(href)}
                data-active={active}
                className="lm-seg-item px-4 py-1.5 text-sm md:px-5"
              >
                {label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
