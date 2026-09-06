"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { C, Icon, pick, parseYmd, dDay, timeAgo } from "@/lib/theme";
import TabBar from "@/components/TabBar";

// ── 도넛 차트 ───────────────────────────
function Donut({
  pct,
  size = 90,
  stroke = 10,
  color = C.primary,
  bg = "#e2e8f0",
  children,
}: {
  pct: number;
  size?: number;
  stroke?: number;
  color?: string;
  bg?: string;
  children?: React.ReactNode;
}) {
  const r = (size - stroke) / 2;
  const cir = 2 * Math.PI * r;
  const offset = cir - (Math.min(100, Math.max(0, pct)) / 100) * cir;
  return (
    <div style={{ position: "relative", width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={bg} strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeDasharray={cir}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: "stroke-dashoffset .5s ease" }}
        />
      </svg>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {children}
      </div>
    </div>
  );
}

// ── 히어로 (오늘의 진행률) ───────────────
function ProgressHero({
  completedToday,
  openFaults,
  urgent,
  overdue,
}: {
  completedToday: number;
  openFaults: number;
  urgent: number;
  overdue: number;
}) {
  const total = completedToday + openFaults;
  const pct = total === 0 ? 0 : Math.round((completedToday / total) * 100);
  return (
    <div
      style={{
        background: `linear-gradient(135deg, ${C.primaryDeep} 0%, ${C.primary} 100%)`,
        borderRadius: 16,
        padding: "18px 20px",
        color: "#fff",
        display: "flex",
        alignItems: "center",
        gap: 18,
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: "radial-gradient(rgba(255,255,255,0.08) 1px, transparent 1px)",
          backgroundSize: "10px 10px",
          opacity: 0.6,
        }}
      />
      <Donut pct={pct} size={94} stroke={8} color="#fff" bg="rgba(255,255,255,0.15)">
        <div style={{ fontSize: 22, fontWeight: 800, fontFamily: C.mono, color: "#fff", lineHeight: 1 }}>{pct}%</div>
        <div style={{ fontSize: 9, color: "rgba(255,255,255,0.7)", fontWeight: 600, marginTop: 2 }}>완료율</div>
      </Donut>
      <div style={{ flex: 1, position: "relative" }}>
        <div style={{ fontSize: 10, color: "rgba(255,255,255,0.6)", fontWeight: 700, letterSpacing: "1px", marginBottom: 6 }}>
          오늘의 진행률
        </div>
        <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-0.4px", lineHeight: 1.2, marginBottom: 8 }}>
          {completedToday}건 완료
          <br />
          <span style={{ color: "rgba(255,255,255,0.7)", fontWeight: 600 }}>{openFaults}건 남음</span>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <div style={{ padding: "3px 8px", borderRadius: 4, background: "rgba(255,255,255,0.15)", fontSize: 10, fontWeight: 700, fontFamily: C.mono }}>
            긴급 {urgent}
          </div>
          <div style={{ padding: "3px 8px", borderRadius: 4, background: "rgba(255,255,255,0.15)", fontSize: 10, fontWeight: 700, fontFamily: C.mono }}>
            초과 {overdue}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── KPI 미니 카드 ───────────────────────
function MiniKpi({
  label,
  value,
  max,
  color,
  icon,
  unit = "건",
}: {
  label: string;
  value: number;
  max: number;
  color: string;
  icon: (s: number) => React.ReactNode;
  unit?: string;
}) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div style={{ background: C.surface, borderRadius: 12, padding: "12px 12px 14px", border: `1px solid ${C.line}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
        <div
          style={{
            width: 22,
            height: 22,
            borderRadius: 6,
            background: `${color}15`,
            color,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {icon(12)}
        </div>
        <span style={{ fontSize: 10.5, color: C.inkDim, fontWeight: 700 }}>{label}</span>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 3, marginBottom: 8 }}>
        <span style={{ fontSize: 24, fontWeight: 800, color: C.ink, fontFamily: C.mono, letterSpacing: "-1px", lineHeight: 1 }}>
          {value}
        </span>
        <span style={{ fontSize: 10, color: C.inkFaint, fontWeight: 600 }}>
          / {max}
          {unit}
        </span>
      </div>
      <div style={{ height: 3, background: `${color}18`, borderRadius: 2, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 2 }} />
      </div>
    </div>
  );
}

function SectionTitle({ title, count, onMore }: { title: string; count: number; onMore: () => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 4px 12px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 15, fontWeight: 800, color: C.ink, letterSpacing: "-0.4px" }}>{title}</span>
        <span
          style={{
            padding: "1px 8px",
            borderRadius: 8,
            background: C.primaryLight,
            color: C.primary,
            fontSize: 10.5,
            fontWeight: 800,
            fontFamily: C.mono,
          }}
        >
          {count}
        </span>
      </div>
      <button
        onClick={onMore}
        style={{
          background: "none",
          border: "none",
          color: C.inkDim,
          fontSize: 11.5,
          fontWeight: 700,
          cursor: "pointer",
          padding: 0,
          display: "flex",
          alignItems: "center",
          gap: 2,
        }}
      >
        전체 {Icon.chevronRight(14)}
      </button>
    </div>
  );
}

function IconChip({ icon, color, size = 40 }: { icon: (s: number) => React.ReactNode; color: string; size?: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: 12,
        flexShrink: 0,
        background: `${color}12`,
        color,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        border: `1px solid ${color}20`,
      }}
    >
      {icon(size * 0.5)}
    </div>
  );
}

// ── 고장 아이템 ─────────────────────────
function FaultItemRow({ f, onClick }: { f: any; onClick: () => void }) {
  const createdAt = pick(f, ["created_at"], new Date().toISOString());
  const siteName = pick(f, ["site_name"], "현장명 없음");
  const hogiNo = pick(f, ["hogi_no"], "");
  const content = pick(f, ["content"], "내용 없음");
  const status = pick(f, ["status"], "접수대기");
  const hoursAgo = (Date.now() - new Date(createdAt).getTime()) / 3600000;
  const urgent = status === "접수대기" && hoursAgo >= 2;
  const color = urgent ? C.red : status === "접수대기" ? C.amber : C.inkFaint;
  const badge = urgent ? "긴급" : status;
  return (
    <div
      onClick={onClick}
      style={{
        background: C.surface,
        borderRadius: 12,
        padding: "13px 14px",
        border: `1px solid ${C.line}`,
        marginBottom: 8,
        display: "flex",
        alignItems: "center",
        gap: 12,
        cursor: "pointer",
      }}
    >
      <IconChip icon={Icon.wrench} color={color} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
          <span style={{ padding: "1px 6px", borderRadius: 3, background: `${color}15`, color, fontSize: 10, fontWeight: 800 }}>
            {badge}
          </span>
          <span style={{ fontSize: 10.5, color: C.inkFaint, fontWeight: 700 }}>{status}</span>
        </div>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: C.ink, marginBottom: 1 }}>
          {siteName} {hogiNo && <span style={{ color: C.inkFaint, fontWeight: 500, fontSize: 12 }}>· {hogiNo}</span>}
        </div>
        <div
          style={{
            fontSize: 12,
            color: C.inkDim,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {content}
        </div>
      </div>
      <div style={{ fontSize: 10.5, color: C.inkFaint, fontWeight: 700, flexShrink: 0, fontFamily: C.mono }}>
        {timeAgo(createdAt)}
      </div>
    </div>
  );
}

// ── 검사 아이템 ─────────────────────────
function InspectItemRow({ i, onClick }: { i: any; onClick: () => void }) {
  const applcEnDt: string = pick(i, ["applc_en_dt"], "");
  const siteName = pick(i, ["site_name"], "현장명 없음");
  const hogiNo = pick(i, ["hogi_no"], "");
  if (!applcEnDt) return null;

  const d = dDay(applcEnDt);
  const overdue = d < 0;
  const imminent = d >= 0 && d <= 3;
  const color = overdue ? C.red : imminent ? C.amber : C.primary;
  const pct = overdue ? 100 : Math.max(10, 100 - (d / 30) * 100);

  return (
    <div
      onClick={onClick}
      style={{
        background: C.surface,
        borderRadius: 12,
        padding: "13px 14px",
        border: `1px solid ${C.line}`,
        marginBottom: 8,
        display: "flex",
        alignItems: "center",
        gap: 12,
        cursor: "pointer",
      }}
    >
      <Donut pct={pct} size={48} stroke={5} color={color} bg={C.line}>
        <div style={{ fontSize: 9, fontWeight: 700, color, fontFamily: C.mono, lineHeight: 1 }}>
          {overdue ? "초과" : "D-"}
        </div>
        <div style={{ fontSize: 13, fontWeight: 800, color, fontFamily: C.mono, lineHeight: 1, marginTop: 1 }}>
          {overdue ? `+${Math.abs(d)}` : d}
        </div>
      </Donut>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: C.ink, marginBottom: 3 }}>{siteName}</div>
        <div style={{ fontSize: 11.5, color: C.inkDim, display: "flex", alignItems: "center", gap: 5 }}>
          {hogiNo && (
            <span style={{ padding: "1px 6px", borderRadius: 3, background: `${color}12`, color, fontWeight: 700, fontSize: 10 }}>
              {hogiNo}
            </span>
          )}
          <span style={{ fontFamily: C.mono }}>
            {applcEnDt.slice(4, 6)}.{applcEnDt.slice(6, 8)}
          </span>
        </div>
      </div>
      <span style={{ color: C.inkFaint }}>{Icon.chevronRight(16)}</span>
    </div>
  );
}

// ── 자재 아이템 ─────────────────────────
function MaterialItemRow({ m, onClick }: { m: any; onClick: () => void }) {
  const siteName = pick(m, ["site_name"], "현장명 없음");
  const materialName = pick(m, ["material_name", "item_name", "material", "name"], "자재명 없음");
  const quantity = pick(m, ["quantity", "qty", "count"], "-");
  const status = pick(m, ["status"], "접수");
  const statusColor: Record<string, string> = { 접수: C.amber, 수령: C.primary, 교체완료: C.green };
  const color = statusColor[status] ?? C.inkDim;
  const steps = ["접수", "수령", "교체완료"];
  const currentStep = steps.indexOf(status);
  return (
    <div
      onClick={onClick}
      style={{
        background: C.surface,
        borderRadius: 12,
        padding: "13px 14px",
        border: `1px solid ${C.line}`,
        marginBottom: 8,
        cursor: "pointer",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
        <IconChip icon={Icon.box} color={C.purple} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: C.ink, marginBottom: 2 }}>
            {materialName}{" "}
            <span style={{ color: C.inkFaint, fontFamily: C.mono, fontWeight: 500, fontSize: 12 }}>×{quantity}</span>
          </div>
          <div style={{ fontSize: 11.5, color: C.inkDim }}>{siteName}</div>
        </div>
        <span style={{ padding: "3px 8px", borderRadius: 8, fontSize: 10.5, fontWeight: 800, background: `${color}14`, color }}>
          {status}
        </span>
      </div>
      <div style={{ display: "flex", gap: 3 }}>
        {steps.map((s, idx) => (
          <div key={idx} style={{ flex: 1, height: 3, borderRadius: 2, background: idx <= currentStep ? color : C.line }} />
        ))}
      </div>
    </div>
  );
}

// ── 메인 페이지 ─────────────────────────
export default function WorkPage() {
  const router = useRouter();
  const [userRaw, setUserRaw] = useState<any>(null);
  const [faults, setFaults] = useState<any[]>([]);
  const [materials, setMaterials] = useState<any[]>([]);
  const [inspects, setInspects] = useState<any[]>([]);
  const [activeSites, setActiveSites] = useState(0);
  const [completedToday, setCompletedToday] = useState(0);

  useEffect(() => {
    fetchAll();
    const t = setInterval(fetchAll, 60000);
    return () => clearInterval(t);
  }, []);

  async function fetchAll() {
    const { data: authData } = await supabase.auth.getUser();
    const uid = authData?.user?.id;
    if (!uid) return;

    // 1) 로그인 사용자 정보
    const { data: userData, error: userErr } = await supabase.from("users").select("*").eq("id", uid).single();
    if (userErr) console.error("USER QUERY ERROR:", userErr.message);
    setUserRaw(userData);

    const team = pick(userData, ["team", "team_name"], "");

    // 2) 고장 (team 컬럼 확정됨)
    const { data: faultData, error: faultErr } = await supabase
      .from("fault_reports")
      .select("*")
      .eq("team", team)
      .order("created_at", { ascending: true })
      .limit(30);
    if (faultErr) console.error("FAULT QUERY ERROR:", faultErr.message);
    const openFaults = (faultData ?? []).filter((f) => pick(f, ["status"], "접수대기") !== "완료");
    setFaults(openFaults);

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    setCompletedToday(
      (faultData ?? []).filter(
        (f) => pick(f, ["status"]) === "완료" && new Date(pick(f, ["created_at"], 0)) >= todayStart
      ).length
    );

    // 3) 자재 (team 컬럼 확정됨)
    const { data: materialData, error: matErr } = await supabase
      .from("material_requests")
      .select("*")
      .eq("team", team)
      .order("requested_at", { ascending: true })
      .limit(30);
    if (matErr) console.error("MATERIAL QUERY ERROR:", matErr.message);
    const pendingMaterials = (materialData ?? []).filter((m) => pick(m, ["status"]) !== "교체완료");
    setMaterials(pendingMaterials);

    // 4) 현장 목록(팀 기준) → 검사 필터 및 담당 현장 수
    const userTeamName = pick(userData, ["team"], "");
    const userCompanyId = pick(userData, ["company_id"], null);

    let siteIds: string[] = [];

    if (userTeamName) {
      let siteQuery = supabase.from("sites").select("id").eq("team", userTeamName);
      if (userCompanyId) {
        siteQuery = siteQuery.eq("company_id", userCompanyId);
      }
      const { data: siteRows, error: siteErr } = await siteQuery;

      if (siteErr) {
        console.error("SITE QUERY ERROR:", siteErr.message);
      } else {
        siteIds = (siteRows ?? [])
          .map((s: { id: string }) => s.id)
          .filter((id: string | null | undefined): id is string => Boolean(id));
      }
    }

    setActiveSites(siteIds.length);

    if (siteIds.length === 0) {
      setInspects([]);
    } else {
      const { data: inspectData, error: inspErr } = await supabase
        .from("safety_inspections")
        .select("id, site_name, hogi_no, applc_en_dt, site_id")
        .in("site_id", siteIds);

      if (inspErr) {
        console.error("INSPECT QUERY ERROR:", inspErr.message);
        setInspects([]);
      } else {
        const latestByKey = new Map<string, any>();
        (inspectData ?? []).forEach((row: any) => {
          const key = `${row.site_id}_${row.hogi_no ?? ""}`;
          const existing = latestByKey.get(key);
          if (!existing || String(row.applc_en_dt) > String(existing.applc_en_dt)) {
            latestByKey.set(key, row);
          }
        });
        const dedupedInspectData = Array.from(latestByKey.values());

        const in7 = new Date();
        in7.setDate(in7.getDate() + 7);

        const filtered = dedupedInspectData.filter((row: any) => {
          const ymd = row?.applc_en_dt;
          if (!ymd) return false;
          const due = parseYmd(String(ymd));
          return due <= in7;
        });

        filtered.sort(
          (a: any, b: any) =>
            parseYmd(String(a.applc_en_dt)).getTime() - parseYmd(String(b.applc_en_dt)).getTime()
        );

        setInspects(filtered.slice(0, 30));
      }
    }
  }

  async function handleLogout() {
    if (!confirm("로그아웃 하시겠습니까?")) return;
    await supabase.auth.signOut();
    router.push("/login");
  }

  const urgentCount = faults.filter((f) => {
    const created = pick(f, ["created_at"], new Date().toISOString());
    return (Date.now() - new Date(created).getTime()) / 3600000 >= 2;
  }).length;
  const overdueInspectCount = inspects.filter((i) => dDay(pick(i, ["applc_en_dt"], "20990101")) < 0).length;
  const imminentInspectCount = inspects.filter((i) => {
    const d = dDay(pick(i, ["applc_en_dt"], "20990101"));
    return d >= 0 && d <= 3;
  }).length;

  const userName = pick(userRaw, ["name", "user_name", "full_name", "username"], "이름없음");
  const companyName = pick(userRaw, ["company_display_name", "company_name", "company", "corp_name"], "-");
  const teamName = pick(userRaw, ["team", "team_name"], "-");

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.ink, paddingBottom: 110 }}>
      <div style={{ padding: "24px 20px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 12,
              background: C.primary,
              color: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 18,
              fontWeight: 800,
              boxShadow: `0 4px 12px ${C.primary}44`,
            }}
          >
            L
          </div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800, color: C.ink }}>{userName}</div>
            <div style={{ fontSize: 11, color: C.inkDim, fontWeight: 600 }}>
              {teamName} · {companyName}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div
            onClick={() => router.push('/settings')}
            style={{
              width: 40,
              height: 40,
              borderRadius: 12,
              background: "#fff",
              border: `1px solid ${C.line}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: C.inkDim,
              cursor: "pointer",
            }}
          >
            {Icon.settings(18)}
          </div>
          <div
            onClick={handleLogout}
            style={{
              width: 40,
              height: 40,
              borderRadius: 12,
              background: "#fff",
              border: `1px solid ${C.line}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: C.red,
              cursor: "pointer",
            }}
          >
            {Icon.logout(18)}
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 480, margin: "0 auto" }}>
        <div style={{ padding: "0 16px 14px" }}>
          <ProgressHero
            completedToday={completedToday}
            openFaults={faults.length}
            urgent={urgentCount}
            overdue={overdueInspectCount}
          />
        </div>

        <div style={{ padding: "0 16px 16px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <MiniKpi label="긴급 고장" value={urgentCount} max={5} color={C.red} icon={Icon.alert} />
          <MiniKpi label="임박 검사" value={imminentInspectCount} max={10} color={C.amber} icon={Icon.clock} />
          <MiniKpi label="자재 대기" value={materials.length} max={8} color={C.purple} icon={Icon.box} />
          <MiniKpi label="담당 현장" value={activeSites} max={20} color={C.primary} icon={Icon.building} />
        </div>

        <div style={{ padding: "0 16px 4px" }}>
          <SectionTitle title="고장접수" count={faults.length} onMore={() => router.push("/fault")} />
          {faults.length === 0 ? (
            <p style={{ fontSize: 13, color: C.inkFaint, padding: "8px 4px" }}>처리할 고장이 없습니다</p>
          ) : (
            faults.slice(0, 3).map((f, idx) => <FaultItemRow key={f.id ?? idx} f={f} onClick={() => router.push("/fault")} />)
          )}
        </div>

        <div style={{ padding: "0 16px 4px" }}>
          <SectionTitle title="검사관련" count={inspects.length} onMore={() => router.push("/inspect")} />
          {inspects.length === 0 ? (
            <p style={{ fontSize: 13, color: C.inkFaint, padding: "8px 4px" }}>임박한 검사가 없습니다</p>
          ) : (
            inspects.slice(0, 3).map((i, idx) => <InspectItemRow key={i.id ?? idx} i={i} onClick={() => router.push("/inspect")} />)
          )}
        </div>

        <div style={{ padding: "0 16px 4px" }}>
          <SectionTitle title="자재신청" count={materials.length} onMore={() => router.push("/material")} />
          {materials.length === 0 ? (
            <p style={{ fontSize: 13, color: C.inkFaint, padding: "8px 4px" }}>신청 중인 자재가 없습니다</p>
          ) : (
            materials.slice(0, 3).map((m, idx) => <MaterialItemRow key={m.id ?? idx} m={m} onClick={() => router.push("/material")} />)
          )}
        </div>
      </div>

      <TabBar active="home" />
    </div>
  );
}
