// components/TabBar.tsx
"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { C, Icon } from "@/lib/theme";
import { supabase } from "@/lib/supabase";
import AdminAlerts from "@/components/AdminAlerts";
import FaultAlerts from "@/components/FaultAlerts";
import AnnouncementBar from "@/components/AnnouncementBar";

// ─────────────────────────────────────────────
// 메뉴 정의 (팀원 하단바 / 관리자 사이드바 공용)
// ─────────────────────────────────────────────
// 아이콘 (lib/theme 에 없는 것만 여기서 정의) — TABS 보다 먼저 선언해야 함
type IconFn = (s: number) => React.ReactNode;
const svg = (d: React.ReactNode): IconFn => (s: number) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">{d}</svg>
);
const AIcon = {
  calendar: svg(<><rect x="3.5" y="5" width="17" height="15" rx="2.5" /><path d="M3.5 10h17M8 3v4M16 3v4" /></>),
  users: svg(<><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5" /><circle cx="17" cy="9" r="2.5" /><path d="M17 14.5c2.3 0 4 1.5 4.5 4" /></>),
  userPlus: svg(<><circle cx="10" cy="8" r="3.5" /><path d="M3.5 20c.8-3.5 3.4-5.5 6.5-5.5 1.6 0 3 .5 4.1 1.4" /><path d="M19 14v6M16 17h6" /></>),
};

type Tab = { key: string; path: string; icon: IconFn; label: string };

const TABS: Tab[] = [
  { key: "home",       path: "/work",       icon: Icon.home,      label: "홈" },
  { key: "sites",      path: "/team-sites", icon: Icon.building,  label: "팀별현장" },
  { key: "fault",      path: "/fault",      icon: Icon.wrench,    label: "고장접수" },
  { key: "inspection", path: "/inspection", icon: Icon.tool,      label: "점검" },
  { key: "inspect",    path: "/inspect",    icon: Icon.clipboard, label: "검사" },
  { key: "material",   path: "/material",   icon: Icon.box,       label: "자재" },
  { key: "manual",     path: "/manual",     icon: Icon.zap,       label: "매뉴얼" },
  { key: "quote",      path: "/quote",      icon: Icon.fileText,  label: "견적서" },
  { key: "myleave",    path: "/my-leave",   icon: AIcon.calendar, label: "휴가신청" },
];

// 관리자 전용 메뉴 (하단바에는 안 나옴)
// ※ path 는 프로젝트의 app 폴더 기준 — 다르면 여기만 고치면 됩니다.
const ADMIN_ONLY: Tab[] = [
  { key: "members", path: "/members", icon: AIcon.users,    label: "팀원 관리" },
  { key: "leave",   path: "/leave",   icon: AIcon.calendar, label: "연차/휴가" },
  { key: "team",    path: "/team",    icon: AIcon.userPlus, label: "팀원 초대" },
];

// 관리자는 '홈'을 누르면 운영 대시보드로 이동
const ADMIN_PATH_OVERRIDE: Record<string, string> = {
  home: "/dashboard",   // 새 관리자 홈 (예전 화면: /dashboard-old)
};

// 관리자 사이드바 그룹 구성 (key만 나열 — 순서/묶음 자유롭게 수정)
const SIDE_GROUPS: { title: string; keys: string[] }[] = [
  { title: "운영",      keys: ["home", "inspection", "inspect", "fault"] },
  { title: "현장 관리", keys: ["sites", "quote", "material"] },
  { title: "팀 관리",   keys: ["members", "leave", "team"] },
  { title: "자료",      keys: ["manual"] },
];

const SIDE_W = 232;      // 펼친 폭
const SIDE_W_MINI = 72;  // 접은 폭
const DESKTOP_MIN = 768; // 이 폭 이상 + 관리자일 때만 사이드바

// ─────────────────────────────────────────────
// 관리자 여부 (페이지 이동마다 재조회하지 않도록 캐시)
// ─────────────────────────────────────────────
// ※ 캐시는 "로그인한 사용자 id" 와 함께 저장 → 같은 브라우저에서 관리자→팀원으로
//    계정을 바꿔도 이전 관리자 판정이 남지 않음 (이전 버전의 버그 수정)
const CACHE_KEY = "lf_admin_v2";
let adminCache: { uid: string; admin: boolean } | null = null;

function readCache(): { uid: string; admin: boolean } | null {
  if (adminCache) return adminCache;
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function writeCache(v: { uid: string; admin: boolean } | null) {
  adminCache = v;
  if (typeof window === "undefined") return;
  if (v) sessionStorage.setItem(CACHE_KEY, JSON.stringify(v));
  else sessionStorage.removeItem(CACHE_KEY);
}

function useIsAdmin() {
  // 첫 렌더는 무조건 "판별 전(null)" → 팀원 화면에 사이드바가 깜빡 보이는 일 없음
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    sessionStorage.removeItem("lf_is_admin"); // 이전 버전 캐시 정리

    const resolve = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { writeCache(null); if (alive) setIsAdmin(false); return; }
      const uid = session.user.id;

      const c = readCache();
      if (c && c.uid === uid) { if (alive) setIsAdmin(c.admin); return; }

      const { data } = await supabase
        .from("users")
        .select("role, super_admin")
        .eq("id", uid)
        .single();
      const admin = !!data && (data.role === "admin" || data.super_admin === true);
      writeCache({ uid, admin });
      if (alive) setIsAdmin(admin);
    };
    resolve();

    // 로그아웃 / 다른 계정 로그인 시 다시 판별
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") { writeCache(null); if (alive) setIsAdmin(false); return; }
      const c = readCache();
      if (session && (!c || c.uid !== session.user.id)) { writeCache(null); resolve(); }
    });
    return () => { alive = false; subscription.unsubscribe(); };
  }, []);

  return isAdmin;
}

function useIsDesktop() {
  const [desk, setDesk] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${DESKTOP_MIN}px)`);
    const on = () => setDesk(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return desk;
}

// ─────────────────────────────────────────────
// 진입점: 관리자(PC) → 사이드바 / 그 외 → 기존 하단바
// 각 페이지의 <TabBar active="..." /> 는 그대로 두면 됩니다.
// ─────────────────────────────────────────────
export default function TabBar({ active }: { active: string }) {
  const isAdmin = useIsAdmin();
  const isDesktop = useIsDesktop();

  if (isAdmin === null) return null; // 첫 판별 전 깜빡임 방지
  // 관리자는 어느 화면에 있든 자재·견적·휴가 신청 알림을 받음
  // 고장 알림(FaultAlerts)은 팀원·관리자 모두, 신청 알림(AdminAlerts)은 관리자만
  if (isAdmin && isDesktop) return <><AnnouncementBar /><AdminSidebar active={active} /><AdminAlerts /><FaultAlerts /></>;
  return <><AnnouncementBar /><BottomTabBar active={active} isAdmin={isAdmin} />{isAdmin && <AdminAlerts />}<FaultAlerts /></>;
}

// ─────────────────────────────────────────────
// 관리자 왼쪽 고정 사이드바
// ─────────────────────────────────────────────
function AdminSidebar({ active }: { active: string }) {
  const router = useRouter();
  const [mini, setMini] = useState(false);
  const [userName, setUserName] = useState("");
  const [isSuper, setIsSuper] = useState(false);

  useEffect(() => {
    setMini(localStorage.getItem("lf_side_mini") === "1");
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const { data } = await supabase.from("users").select("name, super_admin").eq("id", session.user.id).single();
      if (data?.name) setUserName(data.name);
      setIsSuper(data?.super_admin === true);
    })();
  }, []);

  const width = mini ? SIDE_W_MINI : SIDE_W;

  // 본문을 사이드바 폭만큼 밀기 (언마운트 시 원복)
  useEffect(() => {
    const prevPL = document.body.style.paddingLeft;
    document.body.style.paddingLeft = `${width}px`;
    document.body.style.transition = "padding-left .2s ease";
    return () => { document.body.style.paddingLeft = prevPL; };
  }, [width]);

  const toggle = () => {
    const v = !mini;
    setMini(v);
    localStorage.setItem("lf_side_mini", v ? "1" : "0");
  };

  const logout = async () => {
    await supabase.auth.signOut();
    router.push("/login");
  };

  const byKey = Object.fromEntries(
    [...TABS, ...ADMIN_ONLY].map((t) => [t.key, { ...t, path: ADMIN_PATH_OVERRIDE[t.key] || t.path }])
  );

  return (
    <aside
      style={{
        position: "fixed", top: "var(--lf-ann-h, 0px)", left: 0, bottom: 0, width,
        background: "#fff", borderRight: `1px solid ${C.line}`,
        display: "flex", flexDirection: "column", zIndex: 35,
        transition: "width .2s ease",
      }}
    >
      {/* 로고 */}
      <div
        style={{
          height: 64, display: "flex", alignItems: "center", gap: 10,
          padding: mini ? 0 : "0 18px", justifyContent: mini ? "center" : "flex-start",
          borderBottom: `1px solid ${C.line}`, cursor: "pointer", flexShrink: 0,
        }}
        onClick={() => router.push(ADMIN_PATH_OVERRIDE.home)}
      >
        <div
          style={{
            width: 30, height: 30, borderRadius: 9, background: C.primary, color: "#fff",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontWeight: 800, fontSize: 13, flexShrink: 0,
          }}
        >
          LF
        </div>
        {!mini && (
          <>
            <span style={{ fontSize: 16, fontWeight: 800, color: C.ink }}>LiftField</span>
            <span
              style={{
                fontSize: 11, fontWeight: 700, color: C.primary,
                background: `${C.primary}14`, padding: "2px 6px", borderRadius: 5,
              }}
            >
              관리자
            </span>
          </>
        )}
      </div>

      {/* 접기 버튼 */}
      <button
        onClick={toggle}
        title={mini ? "사이드바 펼치기" : "사이드바 접기"}
        style={{
          position: "absolute", top: 20, right: -12, width: 24, height: 24, borderRadius: "50%",
          background: "#fff", border: `1px solid ${C.line}`, color: C.inkDim,
          display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
          fontSize: 12, fontWeight: 800, lineHeight: 1,
        }}
      >
        {mini ? "›" : "‹"}
      </button>

      {/* 메뉴 */}
      <nav style={{ flex: 1, overflowY: "auto", padding: "12px 12px" }}>
        {SIDE_GROUPS.map((g) => (
          <div key={g.title} style={{ marginBottom: 8 }}>
            {!mini && (
              <div style={{ fontSize: 11, fontWeight: 700, color: C.inkFaint, padding: "10px 10px 6px" }}>
                {g.title}
              </div>
            )}
            {g.keys.map((k) => {
              const t = byKey[k];
              if (!t) return null;
              const on = t.key === active;
              return (
                <div
                  key={t.key}
                  title={t.label}
                  onClick={() => router.push(t.path)}
                  style={{
                    display: "flex", alignItems: "center", gap: 11, height: 42,
                    padding: mini ? 0 : "0 12px", justifyContent: mini ? "center" : "flex-start",
                    borderRadius: 10, cursor: "pointer", marginBottom: 2,
                    background: on ? `${C.primary}14` : "transparent",
                    color: on ? C.primary : C.inkDim,
                    fontWeight: on ? 700 : 600, fontSize: 14,
                    transition: "background .15s",
                  }}
                  onMouseEnter={(e) => { if (!on) e.currentTarget.style.background = C.bg; }}
                  onMouseLeave={(e) => { if (!on) e.currentTarget.style.background = "transparent"; }}
                >
                  {t.icon(19)}
                  {!mini && <span style={{ whiteSpace: "nowrap" }}>{t.label}</span>}
                </div>
              );
            })}
          </div>
        ))}
        {/* 개발자(슈퍼어드민) 전용 */}
        {isSuper && (
          <div style={{ marginTop: 8 }}>
            {!mini && (
              <div style={{ fontSize: 11, fontWeight: 700, color: "#dc2626", padding: "10px 10px 6px" }}>개발자</div>
            )}
            <div
              title="개발자 관리"
              onClick={() => router.push("/admin")}
              style={{
                display: "flex", alignItems: "center", gap: 11, height: 42,
                padding: mini ? 0 : "0 12px", justifyContent: mini ? "center" : "flex-start",
                borderRadius: 10, cursor: "pointer",
                background: active === "admin" ? "#fee2e2" : "transparent",
                color: active === "admin" ? "#dc2626" : C.inkDim, fontWeight: 700, fontSize: 14,
              }}
            >
              <svg width={19} height={19} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3l8 4v5c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V7l8-4z" /><path d="M9 12l2 2 4-4" />
              </svg>
              {!mini && <span style={{ whiteSpace: "nowrap" }}>개발자 관리</span>}
            </div>
          </div>
        )}
      </nav>

      {/* 사용자 */}
      <div
        style={{
          borderTop: `1px solid ${C.line}`, padding: mini ? "14px 0" : "14px 16px",
          display: "flex", alignItems: "center", gap: 10,
          justifyContent: mini ? "center" : "flex-start", flexShrink: 0,
        }}
      >
        <div
          style={{
            width: 34, height: 34, borderRadius: "50%", background: C.bg, color: C.inkSoft,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontWeight: 800, fontSize: 13, flexShrink: 0,
          }}
        >
          {userName ? userName[0] : "관"}
        </div>
        {!mini && (
          <>
            <div style={{ minWidth: 0, lineHeight: 1.3 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>{userName || "관리자"}</div>
              <div style={{ fontSize: 12, color: C.inkFaint }}>관리자</div>
            </div>
            <button
              onClick={logout}
              style={{
                marginLeft: "auto", background: "none", border: "none", cursor: "pointer",
                color: C.inkFaint, fontSize: 12, fontWeight: 700,
              }}
            >
              로그아웃
            </button>
          </>
        )}
      </div>
    </aside>
  );
}

// ─────────────────────────────────────────────
// 팀원(및 모바일) 하단 탭바 — 글자 표시 + 가운데 고장접수
//   [홈] [현장] (고장접수) [점검] [더보기]
//   더보기: 검사 · 자재 · 매뉴얼 · 견적서 (아래에서 올라오는 시트)
// ─────────────────────────────────────────────
const BAR_LEFT  = ["home", "sites"];
const BAR_RIGHT = ["inspection"];
const BAR_CENTER = "fault";
const MORE_KEYS = ["inspect", "material", "manual", "quote", "myleave", "leave"];
const FAULT_RED = "#ef4444";

// ★ 하단바 스타일 선택: "indicator" (B · 옆으로 밀어서 전체 메뉴) | "center" (C · 가운데 고장접수)
const BAR_STYLE: "indicator" | "center" = "indicator";

// 관리자가 모바일(하단바)로 볼 때: 휴가신청 → 연차/휴가 관리, 홈 → 관리자 홈
function tabsFor(isAdmin: boolean): Tab[] {
  if (!isAdmin) return TABS;
  return TABS.map((t) =>
    t.key === "myleave" ? { ...t, key: "leave", path: "/leave", label: "연차/휴가" } :
    t.key === "home" ? { ...t, path: ADMIN_PATH_OVERRIDE.home || t.path } : t
  );
}

function BottomTabBar({ active, isAdmin }: { active: string; isAdmin: boolean }) {
  const tabs = tabsFor(isAdmin);
  return BAR_STYLE === "indicator" ? <BottomTabBarIndicator active={active} tabs={tabs} /> : <BottomTabBarCenter active={active} tabs={tabs} />;
}

// ─────────────────────────────────────────────
// B · 인디케이터형 — 8개 메뉴 전부, 좌우로 밀어서 이동
// ─────────────────────────────────────────────
function BottomTabBarIndicator({ active, tabs }: { active: string; tabs: Tab[] }) {
  const router = useRouter();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ left: false, right: false });

  const check = () => {
    const el = scrollRef.current; if (!el) return;
    setEdge({ left: el.scrollLeft > 4, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 });
  };

  // 현재 메뉴가 화면 가운데쯤 오도록 가로 스크롤 (scrollIntoView 대신 scrollLeft 사용)
  useEffect(() => {
    const el = scrollRef.current; if (!el) return;
    const btn = el.querySelector<HTMLElement>(`[data-key="${active}"]`);
    if (btn) el.scrollLeft = Math.max(0, btn.offsetLeft - (el.clientWidth - btn.offsetWidth) / 2);
    check();
    el.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", check);
    return () => { el.removeEventListener("scroll", check); window.removeEventListener("resize", check); };
  }, [active]);

  const fade = (side: "left" | "right") => (
    <div style={{
      position: "absolute", top: 0, bottom: 0, [side]: 0, width: 28, pointerEvents: "none", zIndex: 1,
      background: `linear-gradient(to ${side === "left" ? "right" : "left"}, rgba(255,255,255,.98), rgba(255,255,255,0))`,
      opacity: edge[side] ? 1 : 0, transition: "opacity .2s",
    }} />
  );

  return (
    <nav style={{
      position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 47,
      background: "rgba(255,255,255,.96)", backdropFilter: "blur(10px)",
      borderTop: `1px solid ${C.line}`, boxShadow: "0 -4px 16px rgba(15,23,42,.05)",
      paddingBottom: "env(safe-area-inset-bottom)",
    }}>
      <div style={{ position: "relative", maxWidth: 640, margin: "0 auto" }}>
        {fade("left")}
        {fade("right")}
        <div
          ref={scrollRef}
          className="lf-tabscroll"
          style={{
            display: "flex", overflowX: "auto", scrollSnapType: "x proximity",
            WebkitOverflowScrolling: "touch", scrollbarWidth: "none", padding: "0 6px",
          }}
        >
          {tabs.map((t) => {
            const on = t.key === active;
            const isFault = t.key === "fault";
            const color = on ? (isFault ? FAULT_RED : C.primary) : C.inkFaint;
            return (
              <button
                key={t.key}
                data-key={t.key}
                onClick={() => router.push(t.path)}
                style={{
                  flex: "0 0 auto", width: "max(20%, 72px)", height: 66, background: "none", border: "none",
                  cursor: "pointer", position: "relative", scrollSnapAlign: "start",
                  display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3,
                  color, WebkitTapHighlightColor: "transparent",
                }}
              >
                {/* 상단 인디케이터 */}
                <span style={{
                  position: "absolute", top: 0, left: "50%", width: 30, height: 3, borderRadius: "0 0 3px 3px",
                  background: isFault ? FAULT_RED : C.primary,
                  transform: `translateX(-50%) scaleX(${on ? 1 : 0})`, transition: "transform .2s",
                }} />
                {/* 아이콘 하이라이트 */}
                <span style={{
                  display: "flex", alignItems: "center", justifyContent: "center", width: 48, height: 28, borderRadius: 14,
                  background: on ? (isFault ? `${FAULT_RED}18` : `${C.primary}16`) : "transparent", transition: "background .2s",
                }}>
                  {t.icon(21)}
                </span>
                <span style={{ fontSize: 11, fontWeight: on ? 800 : 600, whiteSpace: "nowrap" }}>{t.label}</span>
              </button>
            );
          })}
        </div>
      </div>
      <style>{`.lf-tabscroll::-webkit-scrollbar{display:none}`}</style>
    </nav>
  );
}

// ─────────────────────────────────────────────
// C · 가운데 고장접수형 (BAR_STYLE = "center" 일 때)
// ─────────────────────────────────────────────
function BottomTabBarCenter({ active, tabs }: { active: string; tabs: Tab[] }) {
  const router = useRouter();
  const [moreOpen, setMoreOpen] = useState(false);
  const byKey = Object.fromEntries(tabs.map((t) => [t.key, t]));
  const go = (path: string) => { setMoreOpen(false); router.push(path); };

  // 더보기 안의 메뉴를 보고 있으면 그 메뉴 아이콘/이름을 더보기 자리에 표시
  const activeMore = MORE_KEYS.includes(active) ? byKey[active] : null;

  // ESC 로 시트 닫기
  useEffect(() => {
    if (!moreOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMoreOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [moreOpen]);

  const item = (key: string) => {
    const t = byKey[key];
    if (!t) return null;
    const on = t.key === active;
    return (
      <button
        key={t.key}
        onClick={() => go(t.path)}
        style={{
          flex: 1, minWidth: 0, height: "100%", background: "none", border: "none", cursor: "pointer",
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3,
          color: on ? C.primary : C.inkFaint, position: "relative", WebkitTapHighlightColor: "transparent",
        }}
      >
        <span style={{
          position: "absolute", top: 0, left: "50%", transform: `translateX(-50%) scaleX(${on ? 1 : 0})`,
          width: 28, height: 3, borderRadius: "0 0 3px 3px", background: C.primary, transition: "transform .2s",
        }} />
        {t.icon(22)}
        <span style={{ fontSize: 11, fontWeight: on ? 800 : 600, whiteSpace: "nowrap" }}>{t.label}</span>
      </button>
    );
  };

  const fault = byKey[BAR_CENTER];
  const faultOn = active === BAR_CENTER;
  const moreOn = !!activeMore || moreOpen;

  return (
    <>
      {/* 더보기 시트 */}
      {moreOpen && (
        <div
          onClick={() => setMoreOpen(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.35)", zIndex: 45, animation: "lfFade .15s ease" }}
        />
      )}
      <div
        style={{
          position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 46,
          transform: moreOpen ? "translateY(0)" : "translateY(110%)", transition: "transform .22s ease",
          background: "#fff", borderRadius: "20px 20px 0 0", boxShadow: "0 -10px 30px rgba(15,23,42,.15)",
          padding: "10px 16px calc(88px + env(safe-area-inset-bottom))",
        }}
      >
        <div style={{ width: 40, height: 4, borderRadius: 2, background: C.line, margin: "0 auto 14px" }} />
        <div style={{ fontSize: 13, fontWeight: 800, color: C.inkDim, margin: "0 4px 10px" }}>더보기</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
          {MORE_KEYS.map((k) => {
            const t = byKey[k]; if (!t) return null;
            const on = t.key === active;
            return (
              <button key={k} onClick={() => go(t.path)} style={{
                height: 78, borderRadius: 14, border: `1px solid ${on ? C.primary : C.line}`,
                background: on ? `${C.primary}10` : "#fff", color: on ? C.primary : C.inkSoft, cursor: "pointer",
                display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6,
              }}>
                {t.icon(24)}
                <span style={{ fontSize: 12.5, fontWeight: 700 }}>{t.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 하단 바 */}
      <nav
        style={{
          position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 47,
          background: "rgba(255,255,255,.96)", backdropFilter: "blur(10px)",
          borderTop: `1px solid ${C.line}`, boxShadow: "0 -4px 16px rgba(15,23,42,.05)",
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
      >
        <div style={{ height: 64, maxWidth: 560, margin: "0 auto", display: "flex", alignItems: "stretch", padding: "0 4px" }}>
          {BAR_LEFT.map(item)}

          {/* 가운데 고장접수 */}
          {fault && (
            <button
              onClick={() => go(fault.path)}
              style={{
                flex: 1, minWidth: 0, background: "none", border: "none", cursor: "pointer", position: "relative",
                display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end",
                paddingBottom: 9, gap: 3, WebkitTapHighlightColor: "transparent",
              }}
            >
              <span style={{
                position: "absolute", top: -22, left: "50%", transform: "translateX(-50%)",
                width: 58, height: 58, borderRadius: "50%", background: faultOn ? "#dc2626" : FAULT_RED, color: "#fff",
                display: "flex", alignItems: "center", justifyContent: "center",
                border: "4px solid #fff", boxShadow: `0 8px 18px -6px ${FAULT_RED}aa`,
              }}>
                {fault.icon(26)}
              </span>
              <span style={{ fontSize: 11, fontWeight: 800, color: FAULT_RED, whiteSpace: "nowrap" }}>{fault.label}</span>
            </button>
          )}

          {BAR_RIGHT.map(item)}

          {/* 더보기 */}
          <button
            onClick={() => setMoreOpen((v) => !v)}
            style={{
              flex: 1, minWidth: 0, height: "100%", background: "none", border: "none", cursor: "pointer",
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3,
              color: moreOn ? C.primary : C.inkFaint, position: "relative", WebkitTapHighlightColor: "transparent",
            }}
          >
            <span style={{
              position: "absolute", top: 0, left: "50%", transform: `translateX(-50%) scaleX(${activeMore ? 1 : 0})`,
              width: 28, height: 3, borderRadius: "0 0 3px 3px", background: C.primary, transition: "transform .2s",
            }} />
            {activeMore ? activeMore.icon(22) : (
              <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                {moreOpen
                  ? <path d="M6 6l12 12M18 6L6 18" />
                  : <><circle cx="5" cy="12" r="1.3" /><circle cx="12" cy="12" r="1.3" /><circle cx="19" cy="12" r="1.3" /></>}
              </svg>
            )}
            <span style={{ fontSize: 11, fontWeight: moreOn ? 800 : 600, whiteSpace: "nowrap" }}>
              {activeMore && !moreOpen ? activeMore.label : moreOpen ? "닫기" : "더보기"}
            </span>
          </button>
        </div>
      </nav>
      <style>{`@keyframes lfFade{from{opacity:0}to{opacity:1}}`}</style>
    </>
  );
}
