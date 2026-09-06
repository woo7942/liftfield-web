// components/TabBar.tsx
"use client";

import { useRouter } from "next/navigation";
import { C, Icon } from "@/lib/theme";

const TABS = [
  { key: "home", path: "/work", icon: Icon.home },
  { key: "sites", path: "/team-sites", icon: Icon.building },
  { key: "fault", path: "/fault", icon: Icon.wrench },
  { key: "inspection", path: "/inspection", icon: Icon.tool },
  { key: "inspect", path: "/inspect", icon: Icon.clipboard },
  { key: "material", path: "/material", icon: Icon.box },
  { key: "quote", path: "/quote", icon: Icon.fileText },
];

export default function TabBar({ active }: { active: string }) {
  const router = useRouter();
  return (
    <div
      style={{
        position: "fixed",
        bottom: 14,
        left: 14,
        right: 14,
        maxWidth: 480,
        margin: "0 auto",
        background: "#fff",
        borderRadius: 20,
        padding: "10px 6px",
        display: "flex",
        justifyContent: "space-around",
        zIndex: 40,
        boxShadow: "0 8px 24px rgba(15,23,42,0.12), 0 2px 6px rgba(15,23,42,0.06)",
        border: `1px solid ${C.line}`,
      }}
    >
      {TABS.map((t) => {
        const isActive = t.key === active;
        return (
          <div
            key={t.key}
            onClick={() => router.push(t.path)}
            style={{
              width: 44,
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
            }}
          >
            {t.icon(20)}
          </div>
        );
      })}
    </div>
  );
}
