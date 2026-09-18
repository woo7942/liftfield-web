// components/TabBar.tsx
"use client";

import { useRef, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { C, Icon } from "@/lib/theme";

const TABS = [
  { key: "home", path: "/work", icon: Icon.home },
  { key: "sites", path: "/team-sites", icon: Icon.building },
  { key: "fault", path: "/fault", icon: Icon.wrench },
  { key: "inspection", path: "/inspection", icon: Icon.tool },
  { key: "inspect", path: "/inspect", icon: Icon.clipboard },
  { key: "material", path: "/material", icon: Icon.box },
  { key: "manual", path: "/manual", icon: Icon.zap },
  { key: "quote", path: "/quote", icon: Icon.fileText },
];

export default function TabBar({ active }: { active: string }) {
  const router = useRouter();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  const checkScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > 4);
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  };

  useEffect(() => {
    checkScroll();
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener("scroll", checkScroll);
    window.addEventListener("resize", checkScroll);
    return () => {
      el.removeEventListener("scroll", checkScroll);
      window.removeEventListener("resize", checkScroll);
    };
  }, []);

  const scrollBy = (dir: number) => {
    scrollRef.current?.scrollBy({ left: dir * 140, behavior: "smooth" });
  };

  return (
    <div
      style={{
        position: "fixed",
        bottom: 14,
        left: "50%",
        transform: "translateX(-50%)",
        width: 320,
        maxWidth: "calc(100vw - 28px)",
        background: "#fff",
        borderRadius: 20,
        padding: "10px 6px",
        zIndex: 40,
        boxShadow: "0 8px 24px rgba(15,23,42,0.12), 0 2px 6px rgba(15,23,42,0.06)",
        border: `1px solid ${C.line}`,
        display: "flex",
        alignItems: "center",
        gap: 2,
      }}
    >
      {canLeft && (
        <div
          onClick={() => scrollBy(-1)}
          style={{
            flexShrink: 0,
            width: 18,
            height: 30,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: C.primary,
            cursor: "pointer",
            animation: "tabbarArrowPulse 1.4s ease-in-out infinite",
          }}
        >
                    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <path d="M18 5l-7 7 7 7" opacity="1" />
            <path d="M13 5l-7 7 7 7" opacity="0.6" />
            <path d="M8 5l-7 7 7 7" opacity="0.3" />
          </svg>

        </div>
      )}

      <div
        ref={scrollRef}
        className="tabbar-scroll"
        style={{
          display: "flex",
          overflowX: "auto",
          scrollSnapType: "x proximity",
          gap: 6,
          flex: 1,
        }}
      >
        {TABS.map((t) => {
          const isActive = t.key === active;
          return (
            <div
              key={t.key}
              onClick={() => router.push(t.path)}
              style={{
                flexShrink: 0,
                width: 52,
                height: 44,
                borderRadius: 14,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: isActive ? C.primary : "transparent",
                color: isActive ? "#fff" : C.inkDim,
                cursor: "pointer",
                transition: "all .18s ease",
                boxShadow: isActive ? `0 4px 12px ${C.primary}55` : "none",
                scrollSnapAlign: "start",
              }}
            >
              {t.icon(20)}
            </div>
          );
        })}
      </div>

      {canRight && (
        <div
          onClick={() => scrollBy(1)}
          style={{
            flexShrink: 0,
            width: 18,
            height: 30,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: C.primary,
            cursor: "pointer",
            animation: "tabbarArrowPulse 1.4s ease-in-out infinite",
          }}
        >
                    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <path d="M6 5l7 7-7 7" opacity="1" />
            <path d="M11 5l7 7-7 7" opacity="0.6" />
            <path d="M16 5l7 7-7 7" opacity="0.3" />
          </svg>

        </div>
      )}
    </div>
  );
}
