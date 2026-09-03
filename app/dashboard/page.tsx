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
  itemName?: string;
  item_name?: string;
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
  if (d <= 0)  return { label: '만료',   rowCls: 'expired', ddayBg: '#fef2f2', ddayColor: '#ef4444', barColor: '#ef4444' };
  if (d <= 30) return { label: `D-${d}`, rowCls: 'urgent',  ddayBg: '#fff7ed', ddayColor: '#f97316', barColor: '#f97316' };
  if (d <= 60) return { label: `D-${d}`, rowCls: 'warning', ddayBg: '#fefce8', ddayColor: '#ca8a04', barColor: '#eab308' };
  return       { label: `D-${d}`,        rowCls: '',        ddayBg: '#f0fdf4', ddayColor: '#16a34a', barColor: '#22c55e' };
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


const S = {
  panel: (): React.CSSProperties => ({
    background: '#fff', borderRadius: 14, display: 'flex', flexDirection: 'column',
    boxShadow: '0 1px 3px rgba(0,0,0,.05)', overflow: 'hidden',
  }),
  panelHead: (): React.CSSProperties => ({
    display: 'flex', alignItems: 'center', gap: 7,
    padding: '12px 14px 10px', flexShrink: 0, borderBottom: '1px solid #f1f5f9',
  }),
  badge: (bg: string): React.CSSProperties => ({
    fontSize: 9, fontWeight: 800, color: '#fff',
    padding: '2px 7px', borderRadius: 10, background: bg, flexShrink: 0,
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
  useEffect(() => {
    if (!userInfo) return;
    const cid = userInfo.company_id || userInfo.companyId;
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const fetchAlerts = async () => {
      let faultQ = supabase.from('fault_reports')
        .select('*')
        .eq('status', '접수대기')
        .gte('created_at', since)
        .order('created_at', { ascending: false });
      if (!userInfo.super_admin) faultQ = faultQ.eq('company_id', cid);
      const { data: faultData } = await faultQ;
      setFaultList((faultData || []) as FaultItem[]);
      setCounts(p => ({ ...p, fault: faultData?.length || 0 }));

      let matQ = supabase.from('material_usages')
        .select('*')
        .eq('status', '신청중')
        .gte('created_at', since)
        .order('created_at', { ascending: false });
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
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 36 }}>🛗</div>
        <p style={{ color: '#94a3b8', fontSize: 13, marginTop: 10 }}>로딩 중...</p>
      </div>
    </div>
  );

  const isSuperAdmin = userInfo?.super_admin;
  const nameChar = (userInfo?.name || 'A').charAt(0);

  return (
    <div style={{
      height: '100vh', overflow: 'hidden', display: 'flex', flexDirection: 'column',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans KR", sans-serif',
      background: '#0f172a', fontSize: 'clamp(12px, 1vw, 15px)',
    }}>

      {/* ═══ 헤더 ═══════════════════════════════════ */}
      <header style={{
        height: 50, background: '#0f172a', borderBottom: '1px solid #1e293b',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 20px', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={() => router.push('/')} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', cursor: 'pointer' }}>
            <div style={{ width: 28, height: 28, borderRadius: 7, background: 'linear-gradient(135deg,#3b82f6,#6366f1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>🛗</div>
            <span style={{ color: '#f8fafc', fontWeight: 800, fontSize: 16, letterSpacing: '-.4px' }}>LiftField</span>
          </button>
          <div style={{ width: 1, height: 16, background: '#334155' }} />
          <span style={{ color: '#64748b', fontSize: 13, fontWeight: 600 }}>운영 대시보드</span>
          {isSuperAdmin && (
            <span style={{ background: '#fbbf24', color: '#78350f', fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 12 }}>
              👑 슈퍼관리자
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#22c55e', fontWeight: 600 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#22c55e', display: 'inline-block' }} />
            실시간 연동
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, background: '#1e293b', borderRadius: 20, padding: '3px 10px 3px 3px' }}>
            <div style={{ width: 24, height: 24, borderRadius: '50%', background: 'linear-gradient(135deg,#3b82f6,#6366f1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 800, color: '#fff' }}>{nameChar}</div>
            <span style={{ fontSize: 13, color: '#cbd5e1', fontWeight: 600 }}>{userInfo?.name} · {userInfo?.company_display_name || userInfo?.companyDisplayName || '관리자'}</span>
          </div>
          <button onClick={handleLogout} style={{ background: 'none', border: '1px solid #334155', borderRadius: 6, color: '#64748b', fontSize: 12, padding: '4px 10px', cursor: 'pointer', fontFamily: 'inherit' }}>
            로그아웃
          </button>
        </div>
      </header>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* ═══ 사이드바 ═══════════════════════════════ */}
        <aside style={{ width: 188, background: '#0f172a', borderRight: '1px solid #1e293b', display: 'flex', flexDirection: 'column', padding: '12px 0', flexShrink: 0 }}>
          <div style={{ padding: '0 10px 6px', fontSize: 10, fontWeight: 700, color: '#334155', textTransform: 'uppercase', letterSpacing: '1.2px' }}>Menu</div>
          {MENUS.map((m) => {
            const isActive = activeNav === m.path;
            const cnt = m.badgeKey ? (counts as any)[m.badgeKey] : 0;
            return (
              <button key={m.path}
                onClick={() => { setActiveNav(m.path); router.push(m.path); }}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                  padding: '8px 10px', border: 'none', cursor: 'pointer', textAlign: 'left',
                  borderLeft: isActive ? '2px solid #3b82f6' : '2px solid transparent',
                  background: isActive ? '#1e3a5f' : 'none',
                  transition: 'all .15s', fontFamily: 'inherit',
                }}
                onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = '#1e293b'; }}
                onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = 'none'; }}
              >
                <div style={{ width: 26, height: 26, borderRadius: 6, fontSize: 12, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: isActive ? '#1d4ed820' : '#1e293b' }}>{m.icon}</div>
                <span style={{ fontSize: 13, fontWeight: isActive ? 700 : 500, color: isActive ? '#93c5fd' : '#64748b', flex: 1 }}>{m.label}</span>
                {m.badgeKey && cnt > 0 && <span style={S.badge(BADGE_COLORS[m.badgeKey] || '#64748b')}>{cnt}</span>}
              </button>
            );
          })}
          {isSuperAdmin && (
            <button onClick={() => router.push('/admin/companie')} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', border: 'none', borderLeft: '2px solid transparent', background: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' }}>
              <div style={{ width: 26, height: 26, borderRadius: 6, background: '#fef9c3', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12 }}>👑</div>
              <span style={{ fontSize: 13, color: '#a16207', fontWeight: 500 }}>슈퍼관리자</span>
            </button>
          )}
          <div style={{ flex: 1 }} />
          <div style={{ padding: 10, borderTop: '1px solid #1e293b' }}>
            <button onClick={() => router.push('/')} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#475569', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
              ← 홈으로
            </button>
          </div>
        </aside>

        {/* ═══ 메인 ════════════════════════════════════ */}
        <main style={{
          flex: 1, background: '#f1f5f9',
          display: 'flex', flexDirection: 'column',
          padding: '16px 20px 12px', gap: 12, overflow: 'hidden',
        }}>

          {/* 상단 바 */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
            <div>
              <h1 style={{ fontSize: 19, fontWeight: 800, color: '#0f172a', letterSpacing: '-.4px', margin: 0 }}>
                안녕하세요, {userInfo?.name}님 👋
              </h1>
              <p style={{ fontSize: 13, color: '#94a3b8', marginTop: 2 }}>
                {userInfo?.company_display_name || userInfo?.companyDisplayName || ''} · 계약현장 {sites.length}개 관리 중
              </p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {alertCount > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, background: '#fef3c7', border: '1px solid #fde68a', borderRadius: 16, padding: '5px 12px', fontSize: 10, color: '#92400e', fontWeight: 700, cursor: 'pointer' }}
                  onClick={() => setActiveFilter('expired')}>
                  ⚡ 알림 {alertCount}건
                </div>
              )}
              <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 16, padding: '5px 12px', fontSize: 12, color: '#64748b', fontWeight: 600 }}>{today}</div>
            </div>
          </div>

          {/* KPI 행 */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, flexShrink: 0 }}>
            {[
              { ic: '🏢', val: sites.length,        lbl: '등록 현장',    tag: '실시간',   tagBg: '#f0fdf4', tagColor: '#10b981', topColor: '#10b981', icBg: '#f0fdf4', path: '/sites' },
              { ic: '⚠️', val: expiredSites.length, lbl: '계약 만료',    tag: '즉시 갱신', tagBg: '#fef2f2', tagColor: '#ef4444', topColor: '#ef4444', icBg: '#fef2f2', path: '/sites', valColor: expiredSites.length > 0 ? '#ef4444' : undefined },
              { ic: '🔧', val: counts.fault,         lbl: '고장 접수대기', tag: '처리 필요', tagBg: '#fffbeb', tagColor: '#f59e0b', topColor: '#f59e0b', icBg: '#fffbeb', path: '/fault', valColor: counts.fault > 0 ? '#f59e0b' : undefined },
              { ic: '📋', val: totalElevs,           lbl: '전체 승강기',  tag: '전체 현장', tagBg: '#eff6ff', tagColor: '#3b82f6', topColor: '#3b82f6', icBg: '#eff6ff', path: '/sites' },
            ].map((k, i) => (
              <div key={i} onClick={() => router.push(k.path)} style={{
                background: '#fff', borderRadius: 12, padding: '14px 16px',
                display: 'flex', alignItems: 'center', gap: 12,
                cursor: 'pointer', transition: 'all .2s',
                borderTop: `3px solid ${k.topColor}`,
                position: 'relative', overflow: 'hidden',
                boxShadow: '0 1px 3px rgba(0,0,0,.05)',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-2px)'; (e.currentTarget as HTMLDivElement).style.boxShadow = `0 6px 18px ${k.topColor}20`; }}
              onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.transform = 'none'; (e.currentTarget as HTMLDivElement).style.boxShadow = '0 1px 3px rgba(0,0,0,.05)'; }}
              >
                <div style={{ width: 38, height: 38, borderRadius: 10, background: k.icBg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, flexShrink: 0 }}>{k.ic}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 28, fontWeight: 900, letterSpacing: '-1px', lineHeight: 1, color: k.valColor || '#0f172a' }}>{k.val}</div>
                  <div style={{ fontSize: 12, color: '#94a3b8', fontWeight: 600, marginTop: 3 }}>{k.lbl}</div>
                </div>
                <div style={{ fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 16, background: k.tagBg, color: k.tagColor, flexShrink: 0, alignSelf: 'flex-start' }}>{k.tag}</div>
                <div style={{ position: 'absolute', right: -6, bottom: -8, fontSize: 50, opacity: .04, pointerEvents: 'none', lineHeight: 1 }}>{k.ic}</div>
              </div>
            ))}
          </div>

          {/* ── 하단 2열 (왼쪽: 계약 만료 현황 확대 / 중앙: 최근 알림 확대) ── */}
          <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 12, flex: 1, minHeight: 0 }}>

            {/* 왼쪽: 계약 만료 현황 (확대) */}
            <div style={S.panel()}>
              <div style={S.panelHead()}>
                <div style={{ width: 4, height: 16, borderRadius: 2, background: 'linear-gradient(to bottom,#ef4444,#f97316)', flexShrink: 0 }} />
                <span style={{ fontSize: 15, fontWeight: 800, color: '#334155', flex: 1 }}>계약 만료 현황</span>
              </div>
              <div style={{ flex: 1, overflowY: 'auto', padding: '14px 14px' }}>
                {[
                  { cls: 'expired', dot: '#ef4444', label: '만료됨',   count: expiredSites.length,  bg: '#fef2f2', border: '#ef4444', tc: '#dc2626' },
                  { cls: 'urgent',  dot: '#f97316', label: '30일 이내', count: urgentSites.length,   bg: '#fff7ed', border: '#f97316', tc: '#ea580c' },
                  { cls: 'warning', dot: '#eab308', label: '60일 이내', count: warningSites.length,  bg: '#fefce8', border: '#eab308', tc: '#ca8a04' },
                  { cls: 'safe',    dot: '#22c55e', label: '60일 초과', count: safeSites.length,     bg: '#f0fdf4', border: '#22c55e', tc: '#16a34a' },
                ].map(row => (
                  <div key={row.cls} onClick={() => setActiveFilter(row.cls as any)} style={{
                    display: 'flex', alignItems: 'center', gap: 9,
                    padding: '11px 12px', borderRadius: 10, marginBottom: 8,
                    background: row.bg, borderLeft: `4px solid ${row.border}`,
                    cursor: 'pointer', transition: 'opacity .15s',
                  }}
                  onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.opacity = '.8'}
                  onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.opacity = '1'}
                  >
                    <div style={{ width: 9, height: 9, borderRadius: '50%', background: row.dot, flexShrink: 0 }} />
                    <span style={{ flex: 1, fontSize: 14, fontWeight: 700, color: row.tc }}>{row.label}</span>
                    <span style={{ fontSize: 22, fontWeight: 900, color: row.tc }}>{row.count}</span>
                    <span style={{ fontSize: 12, color: '#94a3b8' }}>개</span>
                  </div>
                ))}

                <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid #f1f5f9' }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: '#94a3b8', marginBottom: 9 }}>⏰ 만료 임박 순위</div>
                  {expiryTop.length === 0 ? (
                    <p style={{ fontSize: 12, color: '#94a3b8', textAlign: 'center', padding: '12px 0' }}>현장 데이터가 없어요</p>
                  ) : expiryTop.map(s => {
                    const info = getDdayInfo(getContractEnd(s));
                    if (!info) return null;
                    return (
                      <div key={s.id} onClick={() => router.push('/sites')} style={{
                        display: 'flex', alignItems: 'center', gap: 7,
                        padding: '9px 10px', borderRadius: 9, background: '#f8fafc',
                        cursor: 'pointer', marginBottom: 6,
                      }}
                      onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.background = '#f1f5f9'}
                      onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.background = '#f8fafc'}
                      >
                        <span style={{ fontSize: 12, fontWeight: 800, padding: '2px 7px', borderRadius: 8, flexShrink: 0, background: info.ddayBg, color: info.ddayColor }}>{info.label}</span>
                        <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: '#1e293b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{getSiteName(s)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* 중앙: 최근 알림 (확대, 가로 3분할) + 처리 현황 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0 }}>
              <div style={{ ...S.panel(), flex: 1, minHeight: 0 }}>
                <div style={S.panelHead()}>
                  <div style={{ width: 4, height: 16, borderRadius: 2, background: 'linear-gradient(to bottom,#ef4444,#f97316)', flexShrink: 0 }} />
                  <span style={{ fontSize: 15, fontWeight: 800, color: '#334155', flex: 1 }}>최근 알림</span>
                  {alertCount > 0 && <span style={S.badge('#ef4444')}>{alertCount}</span>}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, flex: 1, overflow: 'hidden', padding: '10px 12px' }}>

                  {/* 📅 예약건 */}
                  <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRadius: 10, border: '1px solid #f1f5f9' }}>
                    <div style={{ padding: '9px 12px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: '#ef4444' }}>📅 예약건</span>
                      {contractAlertCount > 0 && <span style={S.badge('#ef4444')}>{contractAlertCount}</span>}
                    </div>
                    <div style={{ flex: 1, overflowY: 'auto', padding: '9px 10px', display: 'flex', flexDirection: 'column', gap: 7 }}>
                      {expiredSites.length === 0 && urgentSites.length === 0 ? (
                        <div style={{ textAlign: 'center', color: '#94a3b8', fontSize: 12, padding: '24px 0' }}>
                          <div style={{ fontSize: 24, marginBottom: 6 }}>✅</div>만료 예정 없음
                        </div>
                      ) : (
                        <>
                          {expiredSites.map(s => (
                            <div key={`exp-${s.id}`} onClick={() => router.push('/sites')} style={{ padding: '10px 11px', borderRadius: 10, background: '#fef2f2', borderLeft: '3px solid #ef4444', cursor: 'pointer' }}>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 }}>
                                <span style={{ fontSize: 11, fontWeight: 700, color: '#dc2626' }}>🔴 계약 만료</span>
                                <span style={{ fontSize: 10, background: '#fee2e2', color: '#ef4444', padding: '1px 6px', borderRadius: 6, fontWeight: 700 }}>만료</span>
                              </div>
                              <div style={{ fontSize: 13, fontWeight: 700, color: '#1e293b', marginBottom: 2 }}>{getSiteName(s)}</div>
                              <div style={{ fontSize: 11, color: '#94a3b8' }}>{getContractType(s) || '계약'} · {getContractEnd(s) || '-'}</div>
                            </div>
                          ))}
                          {urgentSites.map(s => {
                            const info = getDdayInfo(getContractEnd(s));
                            return (
                              <div key={`urg-${s.id}`} onClick={() => router.push('/sites')} style={{ padding: '10px 11px', borderRadius: 10, background: '#fff7ed', borderLeft: '3px solid #f97316', cursor: 'pointer' }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 }}>
                                  <span style={{ fontSize: 11, fontWeight: 700, color: '#ea580c' }}>⏰ 만료 임박</span>
                                  <span style={{ fontSize: 10, background: '#ffedd5', color: '#f97316', padding: '1px 6px', borderRadius: 6, fontWeight: 700 }}>{info?.label}</span>
                                </div>
                                <div style={{ fontSize: 13, fontWeight: 700, color: '#1e293b', marginBottom: 2 }}>{getSiteName(s)}</div>
                                <div style={{ fontSize: 11, color: '#94a3b8' }}>{getContractType(s) || '계약'} · {getContractEnd(s) || '-'}</div>
                              </div>
                            );
                          })}
                        </>
                      )}
                    </div>
                  </div>

                  {/* 🔧 고장접수 */}
                  <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRadius: 10, border: '1px solid #f1f5f9' }}>
                    <div style={{ padding: '9px 12px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: '#d97706' }}>🔧 고장접수</span>
                      {counts.fault > 0 && <span style={S.badge('#f59e0b')}>{counts.fault}</span>}
                    </div>
                    <div style={{ flex: 1, overflowY: 'auto', padding: '9px 10px', display: 'flex', flexDirection: 'column', gap: 7 }}>
                      {faultList.length === 0 ? (
                        <div style={{ textAlign: 'center', color: '#94a3b8', fontSize: 12, padding: '24px 0' }}>
                          <div style={{ fontSize: 24, marginBottom: 6 }}>✅</div>대기 중인 고장 없음
                        </div>
                      ) : faultList.map(f => (
                        <div key={f.id} onClick={() => router.push('/fault')} style={{ padding: '10px 11px', borderRadius: 10, background: '#fffbeb', borderLeft: '3px solid #f59e0b', cursor: 'pointer' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 }}>
                            <span style={{ fontSize: 11, fontWeight: 700, color: '#d97706' }}>접수대기</span>
                            <span style={{ fontSize: 10, color: '#94a3b8' }}>{timeAgo(f.created_at)}</span>
                          </div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: '#1e293b', marginBottom: 2 }}>{f.site_name || f.siteName} · {f.hogi_no || f.hogiNo}</div>
                          <div style={{ fontSize: 11, color: '#78716c', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.content}</div>
                          <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 3 }}>담당: {f.assigned_name || f.assignedName || '미배정'}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* 📦 자재신청 */}
                  <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRadius: 10, border: '1px solid #f1f5f9' }}>
                    <div style={{ padding: '9px 12px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: '#7c3aed' }}>📦 자재신청</span>
                      {counts.material > 0 && <span style={S.badge('#8b5cf6')}>{counts.material}</span>}
                    </div>
                    <div style={{ flex: 1, overflowY: 'auto', padding: '9px 10px', display: 'flex', flexDirection: 'column', gap: 7 }}>
                      {materialList.length === 0 ? (
                        <div style={{ textAlign: 'center', color: '#94a3b8', fontSize: 12, padding: '24px 0' }}>
                          <div style={{ fontSize: 24, marginBottom: 6 }}>✅</div>대기 중인 신청 없음
                        </div>
                      ) : materialList.map(m => (
                        <div key={m.id} onClick={() => router.push('/material')} style={{ padding: '10px 11px', borderRadius: 10, background: '#faf5ff', borderLeft: '3px solid #8b5cf6', cursor: 'pointer' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 }}>
                            <span style={{ fontSize: 11, fontWeight: 700, color: '#7c3aed' }}>신청중</span>
                            <span style={{ fontSize: 10, color: '#94a3b8' }}>{timeAgo(m.created_at)}</span>
                          </div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: '#1e293b', marginBottom: 2 }}>{m.site_name || m.siteName}</div>
                          <div style={{ fontSize: 12, color: '#6d28d9', marginBottom: 2 }}>{m.item_name || m.itemName}</div>
                          <div style={{ fontSize: 11, color: '#94a3b8' }}>신청자: {m.requester_name || m.requesterName || '-'}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                </div>
              </div>

              {/* 처리 현황 바 */}
              <div style={{ background: '#0f172a', borderRadius: 12, padding: 14, flexShrink: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b', marginBottom: 10 }}>이번달 처리 현황</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 16 }}>
                  {[
                    { name: '🔴 계약 갱신율', pct: sites.length > 0 ? Math.round((safeSites.length / sites.length) * 100) : 0, grad: 'linear-gradient(90deg,#ef4444,#f97316)' },
                    { name: '🔧 고장 처리율', pct: 87, grad: 'linear-gradient(90deg,#f59e0b,#fbbf24)' },
                    { name: '📋 점검 완료율', pct: 74, grad: 'linear-gradient(90deg,#3b82f6,#6366f1)' },
                  ].map(p => (
                    <div key={p.name}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8' }}>{p.name}</span>
                        <span style={{ fontSize: 12, fontWeight: 800, color: '#f1f5f9' }}>{p.pct}%</span>
                      </div>
                      <div style={{ height: 5, background: '#1e293b', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{ height: '100%', borderRadius: 3, width: `${p.pct}%`, background: p.grad }} />
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
        ::-webkit-scrollbar { width: 4px; height: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #e2e8f0; border-radius: 4px; }
      `}</style>
    </div>
  );
}
