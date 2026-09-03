'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

// ── localStorage TTL 캐시 헬퍼 ──────────────────────
const cache = {
  set(key: string, data: unknown) {
    try { localStorage.setItem(key, JSON.stringify({ data, ts: Date.now() })); } catch {}
  },
  get<T>(key: string, ttlMs: number): T | null {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const { data, ts } = JSON.parse(raw);
      if (Date.now() - ts > ttlMs) { localStorage.removeItem(key); return null; }
      return data as T;
    } catch { return null; }
  },
  invalidate(key: string) {
    try { localStorage.removeItem(key); } catch {}
  },
};

export function invalidateSitesCache(companyId: string) {
  cache.invalidate(`sites_${companyId}`);
  cache.invalidate(`totalElevs_${companyId}`);
}

// ── 타입 ──────────────────────────────────────────
interface SiteItem {
  id: string;
  name: string;
  site_name?: string;
  companyName?: string;
  company_name?: string;
  contractType?: string;
  contract_type?: string;
  elevatorCount?: number;
  elevator_count?: number;
  maintenanceFee?: number;
  maintenance_fee?: number;
  contractStart?: string;
  contract_start?: string;
  contractEnd?: string;
  contract_end?: string;
  teamName?: string;
  team_name?: string;
  team?: string;
  region?: string;
  phone?: string;
}

interface FaultItem {
  id: string;
  siteName?: string;
  site_name?: string;
  hogiNo?: string;
  hogi_no?: string;
  content: string;
  assignedName?: string;
  assigned_name?: string;
  status: string;
  created_at: any;
}

interface MaterialItem {
  id: string;
  siteName?: string;
  site_name?: string;
  materialName?: string;
  material_name?: string;
  requesterName?: string;
  requester_name?: string;
  status: string;
  created_at: any;
}


// ── 유틸 ──────────────────────────────────────────
function getDday(dateStr?: string): number | null {
  if (!dateStr) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr); target.setHours(0, 0, 0, 0);
  return Math.ceil((target.getTime() - today.getTime()) / 86400000);
}

function getDdayInfo(dateStr?: string) {
  const d = getDday(dateStr);
  if (d === null) return null;
  if (d <= 0)  return { label: '만료',   rowCls: 'expired', ddayBg: '#fee2e2', ddayColor: '#ef4444', barColor: '#ef4444' };
  if (d <= 30) return { label: `D-${d}`, rowCls: 'urgent',  ddayBg: '#fef3c7', ddayColor: '#f59e0b', barColor: '#f59e0b' };
  if (d <= 60) return { label: `D-${d}`, rowCls: 'warning', ddayBg: '#fef9c3', ddayColor: '#ca8a04', barColor: '#eab308' };
  return       { label: `D-${d}`,        rowCls: '',        ddayBg: '#d1fae5', ddayColor: '#10b981', barColor: '#10b981' };
}

function timeAgo(v: any): string {
  if (!v) return '-';
  const d = new Date(v);
  const diff = Math.floor((Date.now() - d.getTime()) / 60000);
  if (diff < 1)  return '방금 전';
  if (diff < 60) return `${diff}분 전`;
  if (diff < 1440) return `${Math.floor(diff / 60)}시간 전`;
  return `${Math.floor(diff / 1440)}일 전`;
}

// snake_case → camelCase 헬퍼
const getSiteName = (s: SiteItem) => s.site_name || s.name || '';
const getContractType = (s: SiteItem) => s.contract_type || s.contractType || '';
const getElevatorCount = (s: SiteItem) => s.elevator_count || s.elevatorCount || 0;
const getMaintenanceFee = (s: SiteItem) => s.maintenance_fee || s.maintenanceFee || 0;
const getContractEnd = (s: SiteItem) => s.contract_end || s.contractEnd || '';
const getTeamName = (s: SiteItem) => s.team || s.team_name || s.teamName || '';


// ── 사이드바 메뉴 ──────────────────────────────────
const MENUS = [
  { icon: '📋', label: '계약현장',  path: '/sites',      badgeKey: '' },
  { icon: '🏢', label: '팀별현장',  path: '/team-sites', badgeKey: '' },
  { icon: '📄', label: '견적서',    path: '/quote',      badgeKey: 'quote' },
  { icon: '🔧', label: '고장접수',  path: '/fault',      badgeKey: 'fault' },
  { icon: '📋', label: '점검관리',  path: '/inspection', badgeKey: '' },
  { icon: '🔍', label: '검사지적',  path: '/inspect',    badgeKey: '' },
  { icon: '📦', label: '자재신청',  path: '/material',   badgeKey: 'material' },
  { icon: '👥', label: '직원관리',  path: '/members',    badgeKey: 'member' },
  { icon: '📊', label: '통계',      path: '/stats',      badgeKey: '' },
  { icon: '🔗', label: '팀 초대',   path: '/team',       badgeKey: '' },
];


const BADGE_COLORS: Record<string, string> = {
  fault: '#ef4444', material: '#f59e0b', member: '#8b5cf6', quote: '#3b82f6',
};

// ── 진행 중 상태 목록 & 상태별 배지 스타일 ─────────────
// 고장: 완료 전까지(접수대기·접수·처리중) 계속 표시
const FAULT_ACTIVE_STATUSES = ['접수대기', '접수', '처리중'];
const FAULT_STATUS_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  '접수대기': { bg: '#fef3c7', color: '#f59e0b', label: '접수대기' },
  '접수':     { bg: '#dbeafe', color: '#3b82f6', label: '접수완료' },
  '처리중':   { bg: '#ede9fe', color: '#8b5cf6', label: '처리중' },
};

// 자재: 교체완료·반려 전까지(신청중·접수·수령) 계속 표시
const MATERIAL_ACTIVE_STATUSES = ['신청중', '접수', '수령'];
const MATERIAL_STATUS_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  '신청중': { bg: '#fef3c7', color: '#f59e0b', label: '신청중' },
  '접수':   { bg: '#dbeafe', color: '#3b82f6', label: '접수완료' },
  '수령':   { bg: '#d1fae5', color: '#10b981', label: '수령완료' },
};

// ── 디자인 토큰 (Aurora Indigo) ──────────────────────
const T = {
  bg: '#f3f4f9',
  panel: '#ffffff',
  border: '#e6e8f1',
  borderSoft: '#eef0f7',
  text1: '#1e2130',
  text2: '#6b7085',
  text3: '#9a9fb0',
  sideBg: 'linear-gradient(180deg,#14151f,#1c1e2c)',
  sideText: '#9ea3b8',
  sideBorder: 'rgba(255,255,255,0.07)',
  sideActiveBg: 'rgba(129,140,248,0.14)',
  shadowSm: '0 1px 2px rgba(20,21,31,0.05)',
  shadowMd: '0 6px 16px rgba(20,21,31,0.08)',
  shadowLg: '0 16px 32px rgba(20,21,31,0.12)',
};

const S = {
  panel: (): React.CSSProperties => ({
    background: T.panel, borderRadius: 18, display: 'flex', flexDirection: 'column',
    border: `1px solid ${T.borderSoft}`, boxShadow: T.shadowSm, overflow: 'hidden',
  }),
  panelHead: (): React.CSSProperties => ({
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '13px 16px 11px', flexShrink: 0, borderBottom: `1px solid ${T.borderSoft}`,
  }),
  badge: (bg: string): React.CSSProperties => ({
    fontSize: 9, fontWeight: 800, color: '#fff',
    padding: '2px 7px', borderRadius: 10, background: bg, flexShrink: 0,
    boxShadow: '0 2px 6px rgba(0,0,0,0.25)',
  }),
};

export default function DashboardPage() {
  const router = useRouter();
  const [userInfo, setUserInfo]     = useState<any>(null);
  const [loading, setLoading]       = useState(true);
  const [sites, setSites]           = useState<SiteItem[]>([]);
  const [totalElevs, setTotalElevs] = useState(0);
  const [counts, setCounts] = useState({ fault: 0, material: 0, member: 0, quote: 0 });

  const [activeFilter, setActiveFilter] = useState<'all' | 'expired' | 'urgent' | 'warning'>('all');
  const [activeNav, setActiveNav]   = useState('/dashboard');
  const [today, setToday]           = useState('');
  const [faultList, setFaultList]   = useState<FaultItem[]>([]);
  const [materialList, setMaterialList] = useState<MaterialItem[]>([]);

  useEffect(() => {
    const d = new Date();
    setToday(d.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' }));
  }, []);

  // ── 인증 ──────────────────────────────────────────
  useEffect(() => {
  const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
    if (!session?.user) { router.push('/login'); return; }

    const { data: userData, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', session.user.id)
      .single();

    if (error || !userData) { router.push('/login'); return; }

    const isSuperAdmin = userData.super_admin === true;
    const isAdmin = userData.role === 'admin';

    if (!isSuperAdmin && !isAdmin) { router.push('/'); return; }

    if (isSuperAdmin) {
  router.replace('/admin/companies');
  return;
}

    setUserInfo({ id: session.user.id, ...userData });
    setLoading(false);
  });
  return () => subscription.unsubscribe();
}, []);


  // ── 현장 로드 ──────────────────────────────────────
  useEffect(() => {
    if (!userInfo) return;
    const cid = userInfo.company_id || userInfo.companyId;
    const cacheKey = `sites_${cid}`;
    const TTL = 5 * 60 * 1000;

    const cached = cache.get<SiteItem[]>(cacheKey, TTL);
    if (cached) { setSites(cached); return; }

    const fetchSites = async () => {
      let query = supabase.from('sites').select('*').order('created_at', { ascending: false });
      if (!userInfo.super_admin) query = query.eq('company_id', cid);

      const { data, error } = await query;
      if (error) { console.error(error); return; }
      const allData = (data || []) as SiteItem[];
      cache.set(cacheKey, allData);
      setSites(allData);
    };
    fetchSites();
  }, [userInfo]);

  // ── 승강기 수 ──────────────────────────────────────
  useEffect(() => {
    if (!userInfo) return;
    const cid = userInfo.company_id || userInfo.companyId;
    const cacheKey = `totalElevs_${cid}`;
    const TTL = 10 * 60 * 1000;

    const cached = cache.get<number>(cacheKey, TTL);
    if (cached !== null) { setTotalElevs(cached); return; }

    const fetchElevs = async () => {
      let query = supabase.from('elevators').select('id', { count: 'exact' });
      if (!userInfo.super_admin) query = query.eq('company_id', cid);
      const { count } = await query;
      setTotalElevs(count || 0);
      cache.set(cacheKey, count || 0);
    };
    fetchElevs();
  }, [userInfo]);

  // ── 알림 (고장/자재/직원) ──────────────────────────
  // ★ 변경: 완료(고장) / 교체완료·반려(자재) 전까지는 상태와 무관하게 계속 노출
  useEffect(() => {
    if (!userInfo) return;
    const cid = userInfo.company_id || userInfo.companyId;

    const fetchAlerts = async () => {
      // 고장: 접수대기·접수·처리중 (완료 전까지) 전부 조회
      let faultQ = supabase.from('fault_reports')
        .select('*')
        .in('status', FAULT_ACTIVE_STATUSES)
        .order('created_at', { ascending: false })
        .limit(30);
      if (!userInfo.super_admin) faultQ = faultQ.eq('company_id', cid);
      const { data: faultData } = await faultQ;
      setFaultList((faultData || []) as FaultItem[]);
      setCounts(p => ({ ...p, fault: faultData?.length || 0 }));

      // 자재: 신청중·접수·수령 (교체완료/반려 전까지) 전부 조회
      let matQ = supabase.from('material_requests')
        .select('*')
        .in('status', MATERIAL_ACTIVE_STATUSES)
        .order('created_at', { ascending: false })
        .limit(30);
      if (!userInfo.super_admin) matQ = matQ.eq('company_id', cid);
      const { data: matData } = await matQ;
      setMaterialList((matData || []) as MaterialItem[]);
      setCounts(p => ({ ...p, material: matData?.length || 0 }));

      let quoteQ = supabase.from('quotes')
        .select('id', { count: 'exact' })
        .eq('status', '승인대기');
      if (!userInfo.super_admin) quoteQ = quoteQ.eq('company_id', cid);
      const { count: quoteCount } = await quoteQ;
      setCounts(p => ({ ...p, quote: quoteCount || 0 }));

      const memberCacheKey = `memberCount_${cid}`;
      const cachedMember = cache.get<number>(memberCacheKey, 10 * 60 * 1000);
      if (cachedMember !== null) {
        setCounts(p => ({ ...p, member: cachedMember }));
      } else {
        let memberQ = supabase.from('users').select('id', { count: 'exact' });
        if (!userInfo.super_admin) memberQ = memberQ.eq('company_id', cid);
        const { count } = await memberQ;
        setCounts(p => ({ ...p, member: count || 0 }));
        cache.set(memberCacheKey, count || 0);
      }
    };

    fetchAlerts();
    const interval = setInterval(fetchAlerts, 30000);
    return () => clearInterval(interval);
  }, [userInfo]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push('/');
  };

  // ── 파생 데이터 ──────────────────────────────────
  const expiredSites = sites.filter(s => (getDday(getContractEnd(s)) ?? 1) <= 0);
  const urgentSites  = sites.filter(s => { const d = getDday(getContractEnd(s)); return d !== null && d > 0 && d <= 30; });
  const warningSites = sites.filter(s => { const d = getDday(getContractEnd(s)); return d !== null && d > 30 && d <= 60; });
  const safeSites    = sites.filter(s => { const d = getDday(getContractEnd(s)); return d !== null && d > 60; });
  const alertCount   = expiredSites.length + urgentSites.length + counts.fault + counts.material;

  const expiryTop = [...sites]
    .filter(s => getContractEnd(s))
    .sort((a, b) => (getDday(getContractEnd(a)) ?? 9999) - (getDday(getContractEnd(b)) ?? 9999))
    .slice(0, 8);

  const contractAlertCount = expiredSites.length + urgentSites.length;

  if (loading) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: T.bg }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 36 }}>🛗</div>
        <p style={{ color: T.text3, fontSize: 13, marginTop: 10 }}>로딩 중...</p>
      </div>
    </div>
  );

  const isSuperAdmin = userInfo?.super_admin;
  const nameChar = (userInfo?.name || 'A').charAt(0);

  return (
    <div style={{
      height: '100vh', overflow: 'hidden', display: 'flex', flexDirection: 'column',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans KR", sans-serif',
      background: T.bg, fontSize: 'clamp(12px, 1vw, 15px)',
    }}>

      {/* ═══ 헤더 ═══════════════════════════════════ */}
      <header style={{
        height: 58, background: T.panel, borderBottom: `1px solid ${T.borderSoft}`,
        boxShadow: T.shadowSm, position: 'relative', zIndex: 5,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 24px', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <button onClick={() => router.push('/')} style={{ display: 'flex', alignItems: 'center', gap: 9, background: 'none', border: 'none', cursor: 'pointer' }}>
            <div style={{ width: 30, height: 30, borderRadius: 10, background: 'linear-gradient(135deg,#6366f1,#a855f7)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, boxShadow: '0 4px 10px rgba(99,102,241,0.35)' }}>🛗</div>
            <span style={{ color: T.text1, fontWeight: 800, fontSize: 16, letterSpacing: '-.5px' }}>LiftField</span>
          </button>
          <div style={{ width: 1, height: 16, background: T.border }} />
          <span style={{ color: T.text2, fontSize: 13, fontWeight: 600 }}>운영 대시보드</span>
          {isSuperAdmin && (
            <span style={{ background: '#fef3c7', color: '#92400e', fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 12 }}>
              👑 슈퍼관리자
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#10b981', fontWeight: 700, padding: '5px 12px', borderRadius: 20, background: '#d1fae5' }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#10b981', display: 'inline-block' }} />
            실시간 연동
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: T.bg, borderRadius: 24, padding: '3px 14px 3px 3px', border: `1px solid ${T.borderSoft}` }}>
            <div style={{ width: 25, height: 25, borderRadius: '50%', background: 'linear-gradient(135deg,#818cf8,#c084fc)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, color: '#fff' }}>{nameChar}</div>
            <span style={{ fontSize: 12, color: T.text1, fontWeight: 600 }}>{userInfo?.name} · {userInfo?.company_display_name || userInfo?.companyDisplayName || '관리자'}</span>
          </div>
          <button onClick={handleLogout} style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: 8, color: T.text2, fontSize: 12, padding: '6px 12px', cursor: 'pointer', fontFamily: 'inherit' }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = T.bg; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = T.panel; }}
          >
            로그아웃
          </button>
        </div>
      </header>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* ═══ 사이드바 (다크) ═══════════════════════════ */}
        <aside style={{ width: 200, background: T.sideBg, boxShadow: `inset -1px 0 0 ${T.sideBorder}`, display: 'flex', flexDirection: 'column', padding: '16px 12px', flexShrink: 0, overflowY: 'auto' }}>
          <div style={{ padding: '4px 10px 10px', fontSize: 10, fontWeight: 800, color: 'rgba(255,255,255,0.32)', textTransform: 'uppercase', letterSpacing: '1.4px' }}>Menu</div>
          {MENUS.map((m) => {
            const isActive = activeNav === m.path;
            const cnt = m.badgeKey ? (counts as any)[m.badgeKey] : 0;
            return (
              <button key={m.path}
                onClick={() => { setActiveNav(m.path); router.push(m.path); }}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                  padding: '9px 10px', border: 'none', cursor: 'pointer', textAlign: 'left',
                  borderRadius: 10, marginBottom: 2,
                  boxShadow: isActive ? 'inset 3px 0 0 0 #818cf8' : 'none',
                  background: isActive ? T.sideActiveBg : 'none',
                  transition: 'background .15s, color .15s', fontFamily: 'inherit',
                }}
                onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.06)'; }}
                onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = 'none'; }}
              >
                <div style={{ width: 23, height: 23, borderRadius: 7, fontSize: 12, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: isActive ? 'rgba(129,140,248,0.28)' : 'rgba(255,255,255,0.06)', border: isActive ? 'none' : '1px solid rgba(255,255,255,0.08)' }}>{m.icon}</div>
                <span style={{ fontSize: 13, fontWeight: isActive ? 700 : 600, color: isActive ? '#fff' : T.sideText, flex: 1 }}>{m.label}</span>
                {m.badgeKey && cnt > 0 && <span style={S.badge(BADGE_COLORS[m.badgeKey] || T.text3)}>{cnt}</span>}
              </button>
            );
          })}
          {isSuperAdmin && (
            <button onClick={() => router.push('/admin/companie')} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', border: 'none', borderRadius: 10, background: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' }}>
              <div style={{ width: 23, height: 23, borderRadius: 7, background: 'rgba(251,191,36,0.18)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12 }}>👑</div>
              <span style={{ fontSize: 13, color: '#fbbf24', fontWeight: 600 }}>슈퍼관리자</span>
            </button>
          )}
          <div style={{ flex: 1 }} />
          <div style={{ padding: '12px 0 0', borderTop: `1px solid ${T.sideBorder}`, marginTop: 10 }}>
            <button onClick={() => router.push('/')} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'rgba(255,255,255,0.42)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: '5px 10px' }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = '#fff'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.42)'; }}
            >
              ← 홈으로
            </button>
          </div>
        </aside>

        {/* ═══ 메인 ════════════════════════════════════ */}
        <main style={{
          flex: 1, background: T.bg,
          display: 'flex', flexDirection: 'column',
          padding: '20px 24px 16px', gap: 15, overflow: 'hidden',
        }}>

          {/* 상단 바 */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
            <div>
              <h1 style={{ fontSize: 22, fontWeight: 800, color: T.text1, letterSpacing: '-.5px', margin: 0 }}>
                안녕하세요, {userInfo?.name}님 👋
              </h1>
              <p style={{ fontSize: 12, color: T.text3, marginTop: 4, fontWeight: 500 }}>
                {userInfo?.company_display_name || userInfo?.companyDisplayName || ''} · 계약현장 {sites.length}개 관리 중
              </p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {alertCount > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'linear-gradient(135deg,#fef3c7,#fff)', border: '1px solid rgba(245,158,11,0.25)', boxShadow: T.shadowSm, borderRadius: 20, padding: '7px 14px', fontSize: 12, color: '#f59e0b', fontWeight: 700, cursor: 'pointer' }}
                  onClick={() => setActiveFilter('expired')}>
                  ⚡ 알림 {alertCount}건
                </div>
              )}
              <div style={{ background: T.panel, border: `1px solid ${T.border}`, boxShadow: T.shadowSm, borderRadius: 20, padding: '7px 14px', fontSize: 12, color: T.text2, fontWeight: 600 }}>{today}</div>
            </div>
          </div>

          {/* KPI 행 */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 13, flexShrink: 0 }}>
            {[
              { ic: '🏢', val: sites.length,        lbl: '등록 현장',    tag: '실시간',   color: '#10b981', tagBg: '#d1fae5', icBg: 'rgba(16,185,129,0.13)', path: '/sites' },
              { ic: '⚠️', val: expiredSites.length, lbl: '계약 만료',    tag: '즉시 갱신', color: '#ef4444', tagBg: '#fee2e2', icBg: 'rgba(239,68,68,0.13)', path: '/sites', valColor: expiredSites.length > 0 ? '#ef4444' : undefined },
              { ic: '🔧', val: counts.fault,         lbl: '고장 처리중', tag: '처리 필요', color: '#f59e0b', tagBg: '#fef3c7', icBg: 'rgba(245,158,11,0.13)', path: '/fault', valColor: counts.fault > 0 ? '#f59e0b' : undefined },
              { ic: '📋', val: totalElevs,           lbl: '전체 승강기',  tag: '전체 현장', color: '#3b82f6', tagBg: '#dbeafe', icBg: 'rgba(59,130,246,0.13)', path: '/sites' },
            ].map((k, i) => (
              <div key={i} onClick={() => router.push(k.path)} style={{
                background: T.panel, borderRadius: 18, padding: '18px 20px',
                display: 'flex', alignItems: 'center', gap: 15,
                cursor: 'pointer', transition: 'transform .18s ease, box-shadow .18s ease',
                border: `1px solid ${T.borderSoft}`,
                position: 'relative', overflow: 'hidden',
                boxShadow: T.shadowSm,
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-3px)'; (e.currentTarget as HTMLDivElement).style.boxShadow = T.shadowLg; }}
              onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.transform = 'none'; (e.currentTarget as HTMLDivElement).style.boxShadow = T.shadowSm; }}
              >
                <div style={{ position: 'absolute', left: 0, top: 0, right: 0, height: 3, background: `linear-gradient(90deg,${k.color},transparent)` }} />
                <div style={{ width: 48, height: 48, borderRadius: 14, background: k.icBg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>{k.ic}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 27, fontWeight: 800, letterSpacing: '-1px', lineHeight: 1, color: k.valColor || T.text1 }}>{k.val}</div>
                  <div style={{ fontSize: 12, color: T.text3, fontWeight: 600, marginTop: 5 }}>{k.lbl}</div>
                </div>
                <div style={{ fontSize: 10, fontWeight: 800, padding: '4px 10px', borderRadius: 20, background: k.tagBg, color: k.color, flexShrink: 0, alignSelf: 'flex-start' }}>{k.tag}</div>
              </div>
            ))}
          </div>

          {/* ── 하단 2열 (왼쪽: 계약 만료 현황 / 중앙: 최근 알림) ── */}
          <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 13, flex: 1, minHeight: 0 }}>

            {/* 왼쪽: 계약 만료 현황 */}
            <div style={S.panel()}>
              <div style={S.panelHead()}>
                <div style={{ width: 23, height: 23, borderRadius: 7, background: '#fee2e2', color: '#ef4444', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, flexShrink: 0 }}>📅</div>
                <span style={{ fontSize: 14, fontWeight: 800, color: T.text1, flex: 1, letterSpacing: '-.2px' }}>계약 만료 현황</span>
              </div>
              <div style={{ flex: 1, overflowY: 'auto', padding: '15px 15px' }}>
                {[
                  { dot: '#ef4444', label: '만료됨',   count: expiredSites.length,  bg: '#fee2e2', tc: '#ef4444' },
                  { dot: '#f59e0b', label: '30일 이내', count: urgentSites.length,   bg: '#fef3c7', tc: '#f59e0b' },
                  { dot: '#eab308', label: '60일 이내', count: warningSites.length,  bg: '#fef9c3', tc: '#ca8a04' },
                  { dot: '#10b981', label: '60일 초과', count: safeSites.length,     bg: '#d1fae5', tc: '#10b981' },
                ].map(row => (
                  <div key={row.label} onClick={() => setActiveFilter(row.label === '만료됨' ? 'expired' : row.label === '30일 이내' ? 'urgent' : 'warning')} style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '12px 13px', borderRadius: 12, marginBottom: 8,
                    background: row.bg, boxShadow: `inset 3px 0 0 ${row.dot}`,
                    cursor: 'pointer', transition: 'transform .15s, box-shadow .15s',
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.transform = 'translateX(3px)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.transform = 'none'; }}
                  >
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: row.dot, flexShrink: 0 }} />
                    <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: row.tc }}>{row.label}</span>
                    <span style={{ fontSize: 21, fontWeight: 800, color: row.tc, letterSpacing: '-.5px' }}>{row.count}</span>
                    <span style={{ fontSize: 11, color: T.text3, opacity: .7 }}>개</span>
                  </div>
                ))}

                <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px dashed ${T.border}` }}>
                  <div style={{ fontSize: 11, fontWeight: 800, color: T.text3, marginBottom: 8, letterSpacing: '.5px', textTransform: 'uppercase' }}>⏰ 만료 임박 순위</div>
                  {expiryTop.length === 0 ? (
                    <p style={{ fontSize: 12, color: T.text3, textAlign: 'center', padding: '12px 0' }}>현장 데이터가 없어요</p>
                  ) : expiryTop.map(s => {
                    const info = getDdayInfo(getContractEnd(s));
                    if (!info) return null;
                    return (
                      <div key={s.id} onClick={() => router.push('/sites')} style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '8px 10px', borderRadius: 10,
                        cursor: 'pointer', marginBottom: 3, transition: 'background .15s',
                      }}
                      onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.background = T.bg}
                      onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.background = 'transparent'}
                      >
                        <span style={{ fontSize: 10, fontWeight: 800, padding: '3px 8px', borderRadius: 20, flexShrink: 0, minWidth: 44, textAlign: 'center', background: info.ddayBg, color: info.ddayColor }}>{info.label}</span>
                        <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: T.text1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{getSiteName(s)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* 중앙: 최근 알림 + 처리 현황 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 13, minHeight: 0 }}>
              <div style={{ ...S.panel(), flex: 1, minHeight: 0 }}>
                <div style={S.panelHead()}>
                  <div style={{ width: 23, height: 23, borderRadius: 7, background: '#fee2e2', color: '#ef4444', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, flexShrink: 0 }}>🔔</div>
                  <span style={{ fontSize: 14, fontWeight: 800, color: T.text1, flex: 1, letterSpacing: '-.2px' }}>최근 알림</span>
                  {alertCount > 0 && <span style={S.badge('#ef4444')}>{alertCount}</span>}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 13, flex: 1, overflow: 'hidden', padding: '13px 15px' }}>

                  {/* 📅 예약건 */}
                  <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRadius: 14, background: 'linear-gradient(180deg,rgba(239,68,68,0.06),transparent 60%)' }}>
                    <div style={{ padding: '10px 12px', borderBottom: `1px solid ${T.borderSoft}`, display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                      <span style={{ fontSize: 12, fontWeight: 800, color: '#ef4444', flex: 1, letterSpacing: '-.1px' }}>📅 예약건</span>
                      {contractAlertCount > 0 && <span style={S.badge('#ef4444')}>{contractAlertCount}</span>}
                    </div>
                    <div style={{ flex: 1, overflowY: 'auto', padding: '10px 11px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {expiredSites.length === 0 && urgentSites.length === 0 ? (
                        <div style={{ textAlign: 'center', color: T.text3, fontSize: 12, padding: '26px 0' }}>
                          <div style={{ fontSize: 24, marginBottom: 6 }}>✅</div>만료 예정 없음
                        </div>
                      ) : (
                        <>
                          {expiredSites.map(s => (
                            <div key={`exp-${s.id}`} onClick={() => router.push('/sites')} style={{ padding: '11px 12px', borderRadius: 12, background: T.panel, border: `1px solid ${T.borderSoft}`, boxShadow: T.shadowSm, borderLeft: '3px solid #ef4444', cursor: 'pointer', transition: 'transform .15s, box-shadow .15s' }}
                              onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.transform = 'translateX(3px)'; (e.currentTarget as HTMLDivElement).style.boxShadow = T.shadowMd; }}
                              onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.transform = 'none'; (e.currentTarget as HTMLDivElement).style.boxShadow = T.shadowSm; }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
                                <span style={{ fontSize: 10, fontWeight: 800, color: '#ef4444' }}>🔴 계약 만료</span>
                                <span style={{ fontSize: 9, background: '#fee2e2', color: '#ef4444', padding: '1px 7px', borderRadius: 10, fontWeight: 800 }}>만료</span>
                              </div>
                              <div style={{ fontSize: 12, fontWeight: 700, color: T.text1, marginBottom: 2 }}>{getSiteName(s)}</div>
                              <div style={{ fontSize: 11, color: T.text2 }}>{getContractType(s) || '계약'} · {getContractEnd(s) || '-'}</div>
                            </div>
                          ))}
                          {urgentSites.map(s => {
                            const info = getDdayInfo(getContractEnd(s));
                            return (
                              <div key={`urg-${s.id}`} onClick={() => router.push('/sites')} style={{ padding: '11px 12px', borderRadius: 12, background: T.panel, border: `1px solid ${T.borderSoft}`, boxShadow: T.shadowSm, borderLeft: '3px solid #f59e0b', cursor: 'pointer', transition: 'transform .15s, box-shadow .15s' }}
                                onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.transform = 'translateX(3px)'; (e.currentTarget as HTMLDivElement).style.boxShadow = T.shadowMd; }}
                                onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.transform = 'none'; (e.currentTarget as HTMLDivElement).style.boxShadow = T.shadowSm; }}
                              >
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
                                  <span style={{ fontSize: 10, fontWeight: 800, color: '#f59e0b' }}>⏰ 만료 임박</span>
                                  <span style={{ fontSize: 9, background: '#fef3c7', color: '#f59e0b', padding: '1px 7px', borderRadius: 10, fontWeight: 800 }}>{info?.label}</span>
                                </div>
                                <div style={{ fontSize: 12, fontWeight: 700, color: T.text1, marginBottom: 2 }}>{getSiteName(s)}</div>
                                <div style={{ fontSize: 11, color: T.text2 }}>{getContractType(s) || '계약'} · {getContractEnd(s) || '-'}</div>
                              </div>
                            );
                          })}
                        </>
                      )}
                    </div>
                  </div>

                  {/* 🔧 고장접수 (완료 전까지 계속 노출, 상태별 배지 색상 다름) */}
                  <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRadius: 14, background: 'linear-gradient(180deg,rgba(245,158,11,0.06),transparent 60%)' }}>
                    <div style={{ padding: '10px 12px', borderBottom: `1px solid ${T.borderSoft}`, display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                      <span style={{ fontSize: 12, fontWeight: 800, color: '#f59e0b', flex: 1, letterSpacing: '-.1px' }}>🔧 고장접수</span>
                      {counts.fault > 0 && <span style={S.badge('#f59e0b')}>{counts.fault}</span>}
                    </div>
                    <div style={{ flex: 1, overflowY: 'auto', padding: '10px 11px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {faultList.length === 0 ? (
                        <div style={{ textAlign: 'center', color: T.text3, fontSize: 12, padding: '26px 0' }}>
                          <div style={{ fontSize: 24, marginBottom: 6 }}>✅</div>처리 중인 고장 없음
                        </div>
                      ) : faultList.map(f => {
                        const st = FAULT_STATUS_STYLE[f.status] || FAULT_STATUS_STYLE['접수대기'];
                        return (
                          <div key={f.id} onClick={() => router.push('/fault')} style={{ padding: '11px 12px', borderRadius: 12, background: T.panel, border: `1px solid ${T.borderSoft}`, boxShadow: T.shadowSm, borderLeft: `3px solid ${st.color}`, cursor: 'pointer', transition: 'transform .15s, box-shadow .15s' }}
                            onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.transform = 'translateX(3px)'; (e.currentTarget as HTMLDivElement).style.boxShadow = T.shadowMd; }}
                            onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.transform = 'none'; (e.currentTarget as HTMLDivElement).style.boxShadow = T.shadowSm; }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
                              <span style={{ fontSize: 9, background: st.bg, color: st.color, padding: '1px 7px', borderRadius: 10, fontWeight: 800 }}>{st.label}</span>
                              <span style={{ fontSize: 10, color: T.text3 }}>{timeAgo(f.created_at)}</span>
                            </div>
                            <div style={{ fontSize: 12, fontWeight: 700, color: T.text1, marginBottom: 2 }}>{f.site_name || f.siteName} · {f.hogi_no || f.hogiNo}</div>
                            <div style={{ fontSize: 11, color: T.text2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.content}</div>
                            <div style={{ fontSize: 10, color: T.text3, marginTop: 4 }}>담당: {f.assigned_name || f.assignedName || '미배정'}</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* 📦 자재신청 (교체완료/반려 전까지 계속 노출, 상태별 배지 색상 다름) */}
                  <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRadius: 14, background: 'linear-gradient(180deg,rgba(139,92,246,0.06),transparent 60%)' }}>
                    <div style={{ padding: '10px 12px', borderBottom: `1px solid ${T.borderSoft}`, display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                      <span style={{ fontSize: 12, fontWeight: 800, color: '#8b5cf6', flex: 1, letterSpacing: '-.1px' }}>📦 자재신청</span>
                      {counts.material > 0 && <span style={S.badge('#8b5cf6')}>{counts.material}</span>}
                    </div>
                    <div style={{ flex: 1, overflowY: 'auto', padding: '10px 11px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {materialList.length === 0 ? (
                        <div style={{ textAlign: 'center', color: T.text3, fontSize: 12, padding: '26px 0' }}>
                          <div style={{ fontSize: 24, marginBottom: 6 }}>✅</div>진행 중인 신청 없음
                        </div>
                      ) : materialList.map(m => {
                        const st = MATERIAL_STATUS_STYLE[m.status] || MATERIAL_STATUS_STYLE['신청중'];
                        return (
                          <div key={m.id} onClick={() => router.push('/material')} style={{ padding: '11px 12px', borderRadius: 12, background: T.panel, border: `1px solid ${T.borderSoft}`, boxShadow: T.shadowSm, borderLeft: `3px solid ${st.color}`, cursor: 'pointer', transition: 'transform .15s, box-shadow .15s' }}
                            onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.transform = 'translateX(3px)'; (e.currentTarget as HTMLDivElement).style.boxShadow = T.shadowMd; }}
                            onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.transform = 'none'; (e.currentTarget as HTMLDivElement).style.boxShadow = T.shadowSm; }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
                              <span style={{ fontSize: 9, background: st.bg, color: st.color, padding: '1px 7px', borderRadius: 10, fontWeight: 800 }}>{st.label}</span>
                              <span style={{ fontSize: 10, color: T.text3 }}>{timeAgo(m.created_at)}</span>
                            </div>
                            <div style={{ fontSize: 12, fontWeight: 700, color: T.text1, marginBottom: 2 }}>{m.site_name || m.siteName}</div>
                            <div style={{ fontSize: 11, color: '#8b5cf6', fontWeight: 600, marginBottom: 2 }}>{m.material_name || m.materialName}</div>
                            <div style={{ fontSize: 10, color: T.text3 }}>신청자: {m.requester_name || m.requesterName || '-'}</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                </div>
              </div>

              {/* 처리 현황 바 */}
              <div style={{ background: T.panel, borderRadius: 18, border: `1px solid ${T.borderSoft}`, boxShadow: T.shadowSm, padding: '16px 20px', flexShrink: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: T.text1 }}>📈 이번달 처리 현황</div>
                  <div style={{ fontSize: 10, color: T.text3 }}>2026년 9월 기준</div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 24 }}>
                  {[
                    { name: '🔴 계약 갱신율', pct: sites.length > 0 ? Math.round((safeSites.length / sites.length) * 100) : 0, grad: 'linear-gradient(90deg,#ef4444,#f87171)' },
                    { name: '🔧 고장 처리율', pct: 87, grad: 'linear-gradient(90deg,#f59e0b,#fbbf24)' },
                    { name: '📋 점검 완료율', pct: 74, grad: 'linear-gradient(90deg,#3b82f6,#6366f1)' },
                  ].map(p => (
                    <div key={p.name}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 7 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: T.text2 }}>{p.name}</span>
                        <span style={{ fontSize: 15, fontWeight: 800, color: T.text1, letterSpacing: '-.5px' }}>{p.pct}%</span>
                      </div>
                      <div style={{ height: 7, background: T.bg, borderRadius: 20, overflow: 'hidden' }}>
                        <div style={{ height: '100%', borderRadius: 20, width: `${p.pct}%`, background: p.grad, transition: 'width .3s' }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #d7d9e3; border-radius: 6px; }
      `}</style>
    </div>
  );
}
