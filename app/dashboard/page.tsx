'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

// ── 타입 ──────────────────────────────────────────
interface SiteItem {
  id: string;
  name: string;
  company_name?: string;
  contract_type?: string;
  elevator_count?: number;
  maintenance_fee?: number;
  contract_start?: string;
  contract_end?: string;
  team_name?: string;
  region?: string;
  phone?: string;
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

// ── 사이드바 메뉴 ──────────────────────────────────
const MENUS = [
  { icon: '📋', label: '계약현장',  path: '/sites',       badgeKey: '' },
  { icon: '🏢', label: '팀별현장',  path: '/team-sites',  badgeKey: '' },
  { icon: '🔧', label: '고장접수',  path: '/fault',       badgeKey: 'fault' },
  { icon: '📋', label: '점검관리',  path: '/inspection',  badgeKey: '' },
  { icon: '📦', label: '자재신청',  path: '/material',    badgeKey: 'material' },
  { icon: '👥', label: '직원관리',  path: '/members',     badgeKey: 'member' },
  { icon: '📊', label: '통계',      path: '/stats',       badgeKey: '' },
  { icon: '🔗', label: '팀 초대',   path: '/team',        badgeKey: '' },
];

const BADGE_COLORS: Record<string, string> = {
  fault: '#ef4444', material: '#f59e0b', member: '#8b5cf6',
};

// ── 인라인 스타일 객체 ──────────────────────────────
const S = {
  flex: (gap = 0): React.CSSProperties => ({ display: 'flex', alignItems: 'center', gap }),
  panel: (): React.CSSProperties => ({
    background: '#fff', borderRadius: 14, display: 'flex', flexDirection: 'column',
    boxShadow: '0 1px 3px rgba(0,0,0,.05)', overflow: 'hidden',
  }),
  panelHead: (): React.CSSProperties => ({
    display: 'flex', alignItems: 'center', gap: 7,
    padding: '12px 14px 10px', flexShrink: 0, borderBottom: '1px solid #f8fafc',
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
  const [counts, setCounts]         = useState({ fault: 0, material: 0, member: 0 });
  const [activeFilter, setActiveFilter] = useState<'all' | 'expired' | 'urgent' | 'warning'>('all');
  const [search, setSearch]         = useState('');
  const [activeNav, setActiveNav]   = useState('/dashboard');
  const [today, setToday]           = useState('');

  // 오늘 날짜
  useEffect(() => {
    const d = new Date();
    setToday(d.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' }));
  }, []);

  // 인증 + 초기 데이터 로드
  useEffect(() => {
    let faultChannel: ReturnType<typeof supabase.channel> | null = null;
    let matChannel: ReturnType<typeof supabase.channel> | null = null;

    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/login'); return; }

      const { data: userData } = await supabase
        .from('users')
        .select('*')
        .eq('id', user.id)
        .single();

      if (!userData) { router.push('/login'); return; }

      const isCompany   = userData.subscription_plan === 'company';
      const isAdmin     = userData.role === 'admin';
      const isSuperAdmin = userData.super_admin === true;
      if (!isSuperAdmin && !(isCompany && isAdmin)) { router.push('/'); return; }

      setUserInfo({ uid: user.id, ...userData });

      const cid = userData.company_id;

      // 현장 로드 (source=admin만)
      const { data: sitesData } = await supabase
        .from('sites')
        .select('*')
        .eq('company_id', cid)
        .eq('source', 'admin')
        .order('created_at', { ascending: false });
      setSites((sitesData || []) as SiteItem[]);

      // 승강기 총 수
      const { count: elevCount } = await supabase
        .from('elevators')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', cid);
      setTotalElevs(elevCount || 0);

      // 카운트 초기 로드
      const [{ count: faultCount }, { count: matCount }, { count: memberCount }] = await Promise.all([
        supabase.from('fault_reports').select('id', { count: 'exact', head: true }).eq('company_id', cid).eq('status', '접수대기'),
        supabase.from('material_requests').select('id', { count: 'exact', head: true }).eq('company_id', cid).eq('status', '신청중'),
        supabase.from('users').select('id', { count: 'exact', head: true }).eq('company_id', cid),
      ]);
      setCounts({ fault: faultCount || 0, material: matCount || 0, member: memberCount || 0 });

      // Realtime: fault_reports
      faultChannel = supabase
        .channel(`dashboard-fault-${cid}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'fault_reports', filter: `company_id=eq.${cid}` }, async () => {
          const { count } = await supabase.from('fault_reports').select('id', { count: 'exact', head: true }).eq('company_id', cid).eq('status', '접수대기');
          setCounts(p => ({ ...p, fault: count || 0 }));
        })
        .subscribe();

      // Realtime: material_requests
      matChannel = supabase
        .channel(`dashboard-mat-${cid}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'material_requests', filter: `company_id=eq.${cid}` }, async () => {
          const { count } = await supabase.from('material_requests').select('id', { count: 'exact', head: true }).eq('company_id', cid).eq('status', '신청중');
          setCounts(p => ({ ...p, material: count || 0 }));
        })
        .subscribe();

      setLoading(false);
    };

    init();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') router.push('/login');
    });

    return () => {
      subscription.unsubscribe();
      if (faultChannel) supabase.removeChannel(faultChannel);
      if (matChannel) supabase.removeChannel(matChannel);
    };
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push('/');
  };

  // ── 파생 데이터 ──────────────────────────────────
  const expiredSites = sites.filter(s => (getDday(s.contract_end) ?? 1) <= 0);
  const urgentSites  = sites.filter(s => { const d = getDday(s.contract_end); return d !== null && d > 0 && d <= 30; });
  const warningSites = sites.filter(s => { const d = getDday(s.contract_end); return d !== null && d > 30 && d <= 60; });
  const safeSites    = sites.filter(s => { const d = getDday(s.contract_end); return d !== null && d > 60; });
  const alertCount   = expiredSites.length + urgentSites.length;

  // 만료 임박 상위 5개
  const expiryTop = [...sites]
    .filter(s => s.contract_end)
    .sort((a, b) => {
      const da = getDday(a.contract_end) ?? 9999;
      const db_ = getDday(b.contract_end) ?? 9999;
      return da - db_;
    })
    .slice(0, 5);

  // 테이블 필터
  const filtered = sites
    .filter(s => {
      if (activeFilter === 'expired') return (getDday(s.contract_end) ?? 1) <= 0;
      if (activeFilter === 'urgent')  { const d = getDday(s.contract_end); return d !== null && d > 0 && d <= 30; }
      if (activeFilter === 'warning') { const d = getDday(s.contract_end); return d !== null && d > 30 && d <= 60; }
      return true;
    })
    .filter(s => {
      if (!search) return true;
      const q = search.toLowerCase();
      return s.name?.toLowerCase().includes(q) ||
             s.company_name?.toLowerCase().includes(q) ||
             s.region?.toLowerCase().includes(q);
    })
    .sort((a, b) => {
      const da = getDday(a.contract_end) ?? 9999;
      const db_ = getDday(b.contract_end) ?? 9999;
      return da - db_;
    });

  const totalFee = filtered.reduce((s, i) => s + (i.maintenance_fee || 0), 0);

  if (loading) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 36, animation: 'spin 1s linear infinite' }}>🛗</div>
        <p style={{ color: '#94a3b8', fontSize: 13, marginTop: 10 }}>로딩 중...</p>
      </div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );

  const isSuperAdmin = userInfo?.super_admin;
  const nameChar = (userInfo?.name || 'A').charAt(0);

  return (
    <div style={{ height: '100vh', overflow: 'hidden', display: 'flex', flexDirection: 'column',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans KR", sans-serif',
      background: '#0f172a', fontSize: 15 }}>

      {/* ═══ 헤더 ═══════════════════════════════════ */}
      <header style={{
        height: 50, background: '#0f172a', borderBottom: '1px solid #1e293b',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 20px', flexShrink: 0,
      }}>
        {/* 왼쪽 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={() => router.push('/')} style={{
            display: 'flex', alignItems: 'center', gap: 8,
            background: 'none', border: 'none', cursor: 'pointer',
          }}>
            <div style={{
              width: 28, height: 28, borderRadius: 7,
              background: 'linear-gradient(135deg,#3b82f6,#6366f1)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14,
            }}>🛗</div>
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
        {/* 오른쪽 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#22c55e', fontWeight: 600 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#22c55e', display: 'inline-block' }} />
            실시간 연동
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, background: '#1e293b', borderRadius: 20, padding: '3px 10px 3px 3px' }}>
            <div style={{
              width: 24, height: 24, borderRadius: '50%',
              background: 'linear-gradient(135deg,#3b82f6,#6366f1)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 10, fontWeight: 800, color: '#fff',
            }}>{nameChar}</div>
            <span style={{ fontSize: 13, color: '#cbd5e1', fontWeight: 600 }}>
              {userInfo?.name} · {userInfo?.company_display_name || '관리자'}
            </span>
          </div>
          <button onClick={handleLogout} style={{
            background: 'none', border: '1px solid #334155', borderRadius: 6,
            color: '#64748b', fontSize: 12, padding: '4px 10px', cursor: 'pointer', fontFamily: 'inherit',
          }}>로그아웃</button>
        </div>
      </header>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* ═══ 사이드바 ═══════════════════════════════ */}
        <aside style={{
          width: 188, background: '#0f172a', borderRight: '1px solid #1e293b',
          display: 'flex', flexDirection: 'column', padding: '12px 0', flexShrink: 0,
        }}>
          <div style={{ padding: '0 10px 6px', fontSize: 10, fontWeight: 700, color: '#334155', textTransform: 'uppercase', letterSpacing: '1.2px' }}>
            Menu
          </div>

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
                <div style={{
                  width: 26, height: 26, borderRadius: 6, fontSize: 12, flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: isActive ? '#1d4ed820' : '#1e293b',
                }}>{m.icon}</div>
                <span style={{ fontSize: 13, fontWeight: isActive ? 700 : 500, color: isActive ? '#93c5fd' : '#64748b', flex: 1 }}>
                  {m.label}
                </span>
                {m.badgeKey && cnt > 0 && (
                  <span style={S.badge(BADGE_COLORS[m.badgeKey] || '#64748b')}>{cnt}</span>
                )}
              </button>
            );
          })}

          {isSuperAdmin && (
            <button onClick={() => router.push('/admin')} style={{
              width: '100%', display: 'flex', alignItems: 'center', gap: 8,
              padding: '8px 10px', border: 'none', borderLeft: '2px solid transparent',
              background: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
            }}>
              <div style={{ width: 26, height: 26, borderRadius: 6, background: '#fef9c3', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12 }}>👑</div>
              <span style={{ fontSize: 13, color: '#a16207', fontWeight: 500 }}>슈퍼관리자</span>
            </button>
          )}

          <div style={{ flex: 1 }} />
          <div style={{ padding: 10, borderTop: '1px solid #1e293b' }}>
            <button onClick={() => router.push('/')} style={{
              display: 'flex', alignItems: 'center', gap: 6,
              fontSize: 12, color: '#475569', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
            }}>← 홈으로</button>
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
                {userInfo?.company_display_name || ''} · 전체 {sites.length}개 현장 관리 중
              </p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {alertCount > 0 && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  background: '#fef3c7', border: '1px solid #fde68a', borderRadius: 16,
                  padding: '5px 12px', fontSize: 10, color: '#92400e', fontWeight: 700, cursor: 'pointer',
                }} onClick={() => setActiveFilter('expired')}>
                  ⚡ 만료·위험 현장 {alertCount}개
                </div>
              )}
              <div style={{
                background: '#fff', border: '1px solid #e2e8f0', borderRadius: 16,
                padding: '5px 12px', fontSize: 12, color: '#64748b', fontWeight: 600,
              }}>{today}</div>
            </div>
          </div>

          {/* KPI 행 */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, flexShrink: 0 }}>
            {[
              { ic: '🏢', val: sites.length, lbl: '등록 현장',    tag: `+${sites.length > 0 ? '실시간' : 0}`, tagBg: '#f0fdf4', tagColor: '#10b981', topColor: '#10b981', icBg: '#f0fdf4', path: '/sites' },
              { ic: '⚠️', val: expiredSites.length, lbl: '계약 만료', tag: '즉시 갱신', tagBg: '#fef2f2', tagColor: '#ef4444', topColor: '#ef4444', icBg: '#fef2f2', path: '/sites', valColor: expiredSites.length > 0 ? '#ef4444' : undefined },
              { ic: '🔧', val: counts.fault, lbl: '고장 접수대기', tag: '처리 필요', tagBg: '#fffbeb', tagColor: '#f59e0b', topColor: '#f59e0b', icBg: '#fffbeb', path: '/fault', valColor: counts.fault > 0 ? '#f59e0b' : undefined },
              { ic: '📋', val: totalElevs, lbl: '전체 승강기',   tag: '전체 현장', tagBg: '#eff6ff', tagColor: '#3b82f6', topColor: '#3b82f6', icBg: '#eff6ff', path: '/sites' },
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
                  <div style={{ fontSize: 28, fontWeight: 900, letterSpacing: '-1px', lineHeight: 1, color: (k as any).valColor || '#0f172a' }}>{k.val}</div>
                  <div style={{ fontSize: 12, color: '#94a3b8', fontWeight: 600, marginTop: 3 }}>{k.lbl}</div>
                </div>
                <div style={{ fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 16, background: k.tagBg, color: k.tagColor, flexShrink: 0, alignSelf: 'flex-start' }}>{k.tag}</div>
                <div style={{ position: 'absolute', right: -6, bottom: -8, fontSize: 50, opacity: .04, pointerEvents: 'none', lineHeight: 1 }}>{k.ic}</div>
              </div>
            ))}
          </div>

          {/* 하단 3열 */}
          <div style={{ display: 'grid', gridTemplateColumns: '210px 1fr 240px', gap: 12, flex: 1, minHeight: 0 }}>

            {/* ── 왼쪽: 계약 만료 현황 ── */}
            <div style={S.panel()}>
              <div style={S.panelHead()}>
                <div style={{ width: 3, height: 14, borderRadius: 2, background: 'linear-gradient(to bottom,#ef4444,#f97316)', flexShrink: 0 }} />
                <span style={{ fontSize: 14, fontWeight: 700, color: '#334155', flex: 1 }}>계약 만료 현황</span>
              </div>
              <div style={{ flex: 1, overflowY: 'auto', padding: '10px 12px' }}>
                {/* 요약 카드 */}
                {[
                  { cls: 'expired', dot: '#ef4444', label: '만료됨',   count: expiredSites.length,  bg: '#fef2f2', border: '#ef4444', tc: '#dc2626' },
                  { cls: 'urgent',  dot: '#f97316', label: '30일 이내', count: urgentSites.length,   bg: '#fff7ed', border: '#f97316', tc: '#ea580c' },
                  { cls: 'warning', dot: '#eab308', label: '60일 이내', count: warningSites.length,  bg: '#fefce8', border: '#eab308', tc: '#ca8a04' },
                  { cls: 'safe',    dot: '#22c55e', label: '60일 초과', count: safeSites.length,     bg: '#f0fdf4', border: '#22c55e', tc: '#16a34a' },
                ].map(row => (
                  <div key={row.cls} onClick={() => setActiveFilter(row.cls as any)} style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '8px 10px', borderRadius: 9, marginBottom: 5,
                    background: row.bg, borderLeft: `3px solid ${row.border}`,
                    cursor: 'pointer', transition: 'opacity .15s',
                  }}
                  onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.opacity = '.8'}
                  onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.opacity = '1'}
                  >
                    <div style={{ width: 7, height: 7, borderRadius: '50%', background: row.dot, flexShrink: 0 }} />
                    <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: row.tc }}>{row.label}</span>
                    <span style={{ fontSize: 18, fontWeight: 900, color: row.tc }}>{row.count}</span>
                    <span style={{ fontSize: 11, color: '#94a3b8', marginLeft: 1 }}>개</span>
                  </div>
                ))}

                {/* 만료 임박 순위 */}
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #f1f5f9' }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#94a3b8', marginBottom: 7 }}>⏰ 만료 임박 순위</div>
                  {expiryTop.length === 0 ? (
                    <p style={{ fontSize: 11, color: '#94a3b8', textAlign: 'center', padding: '12px 0' }}>현장 데이터가 없어요</p>
                  ) : expiryTop.map(s => {
                    const info = getDdayInfo(s.contract_end);
                    if (!info) return null;
                    const typeColor = s.contract_type?.includes('종합') ? { bg: '#eff6ff', color: '#3b82f6' } : { bg: '#f5f3ff', color: '#7c3aed' };
                    return (
                      <div key={s.id} onClick={() => router.push('/sites')} style={{
                        display: 'flex', alignItems: 'center', gap: 6,
                        padding: '7px 8px', borderRadius: 7, background: '#f8fafc',
                        cursor: 'pointer', marginBottom: 4, transition: 'background .12s',
                      }}
                      onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.background = '#f1f5f9'}
                      onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.background = '#f8fafc'}
                      >
                        <span style={{
                          fontSize: 12, fontWeight: 800,
                          padding: '1px 7px', borderRadius: 8, flexShrink: 0, minWidth: 44, textAlign: 'center',
                          background: info.ddayBg, color: info.ddayColor,
                        }}>{info.label}</span>
                        <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: '#1e293b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {s.name}
                        </span>
                        {s.contract_type && (
                          <span style={{ fontSize: 11, fontWeight: 700, padding: '1px 6px', borderRadius: 6, background: typeColor.bg, color: typeColor.color, flexShrink: 0 }}>
                            {s.contract_type.includes('종합') ? '종합' : '일반'}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* ── 가운데: 현장 테이블 ── */}
            <div style={S.panel()}>
              <div style={S.panelHead()}>
                <div style={{ width: 3, height: 14, borderRadius: 2, background: 'linear-gradient(to bottom,#3b82f6,#6366f1)', flexShrink: 0 }} />
                <span style={{ fontSize: 14, fontWeight: 700, color: '#334155', flex: 1 }}>현장 목록</span>
                <span style={{ fontSize: 12, color: '#94a3b8' }}>전체 {sites.length}개</span>
              </div>

              {/* 검색 + 필터 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px 0', flexShrink: 0 }}>
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="🔍  현장명, 업체명, 지역 검색..."
                  style={{
                    flex: 1, border: '1px solid #e2e8f0', borderRadius: 8,
                    padding: '5px 10px', fontSize: 13, fontFamily: 'inherit',
                    background: '#f8fafc', color: '#334155', outline: 'none',
                  }}
                />
                {[
                  { key: 'expired', label: `🔴 만료 ${expiredSites.length}`,  activeColor: '#ef4444' },
                  { key: 'urgent',  label: `🟠 30일 ${urgentSites.length}`,   activeColor: '#f97316' },
                  { key: 'warning', label: `🟡 60일 ${warningSites.length}`,  activeColor: '#eab308' },
                ].map(f => (
                  <button key={f.key} onClick={() => setActiveFilter(prev => prev === f.key as any ? 'all' : f.key as any)} style={{
                    fontSize: 12, fontWeight: 700,
                    padding: '5px 10px', borderRadius: 8,
                    border: `1px solid ${activeFilter === f.key ? f.activeColor : '#e2e8f0'}`,
                    background: activeFilter === f.key ? f.activeColor : '#f8fafc',
                    color: activeFilter === f.key ? '#fff' : '#64748b',
                    cursor: 'pointer', whiteSpace: 'nowrap', transition: 'all .15s', fontFamily: 'inherit',
                  }}>{f.label}</button>
                ))}
              </div>

              {/* 테이블 */}
              <div style={{ flex: 1, overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: '#f8fafc', position: 'sticky', top: 0 }}>
                      {['현장명','계약업체','유형','대수','보수료(원)','계약 시작','계약 만료','D-day','팀'].map(h => (
                        <th key={h} style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 700, color: '#64748b', whiteSpace: 'nowrap', fontSize: 12, borderBottom: '1px solid #f1f5f9' }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.length === 0 ? (
                      <tr>
                        <td colSpan={9} style={{ textAlign: 'center', padding: '32px 0', color: '#94a3b8', fontSize: 12 }}>
                          <div style={{ fontSize: 28, marginBottom: 8 }}>🏢</div>
                          현장이 없어요
                        </td>
                      </tr>
                    ) : filtered.map(s => {
                      const info = getDdayInfo(s.contract_end);
                      const rowBg =
                        info?.rowCls === 'expired' ? '#fef2f2' :
                        info?.rowCls === 'urgent'  ? '#fff7ed' :
                        info?.rowCls === 'warning' ? '#fefce8' : 'transparent';
                      const typeColor = s.contract_type?.includes('종합')
                        ? { bg: '#eff6ff', color: '#3b82f6' }
                        : s.contract_type ? { bg: '#f5f3ff', color: '#7c3aed' } : null;
                      return (
                        <tr key={s.id}
                          onClick={() => router.push('/sites')}
                          style={{ background: rowBg, cursor: 'pointer', borderBottom: '1px solid #f8fafc', transition: 'filter .1s' }}
                          onMouseEnter={e => (e.currentTarget as HTMLTableRowElement).style.filter = 'brightness(.97)'}
                          onMouseLeave={e => (e.currentTarget as HTMLTableRowElement).style.filter = 'none'}
                        >
                          <td style={{ padding: '7px 10px', fontWeight: 700, color: '#1e293b', whiteSpace: 'nowrap' }}>{s.name}</td>
                          <td style={{ padding: '7px 10px', color: '#475569', whiteSpace: 'nowrap' }}>{s.company_name || '-'}</td>
                          <td style={{ padding: '7px 10px', whiteSpace: 'nowrap' }}>
                            {typeColor ? (
                              <span style={{ fontSize: 11, fontWeight: 700, padding: '1px 6px', borderRadius: 6, background: typeColor.bg, color: typeColor.color }}>
                                {s.contract_type?.includes('종합') ? '종합' : '일반'}
                              </span>
                            ) : '-'}
                          </td>
                          <td style={{ padding: '7px 10px', color: '#475569', whiteSpace: 'nowrap' }}>{s.elevator_count ? `${s.elevator_count}대` : '-'}</td>
                          <td style={{ padding: '7px 10px', color: '#475569', whiteSpace: 'nowrap' }}>{s.maintenance_fee ? s.maintenance_fee.toLocaleString() : '-'}</td>
                          <td style={{ padding: '7px 10px', color: '#94a3b8', whiteSpace: 'nowrap', fontSize: 12 }}>{s.contract_start || '-'}</td>
                          <td style={{ padding: '7px 10px', whiteSpace: 'nowrap', fontWeight: 700, color: info?.ddayColor || '#475569' }}>{s.contract_end || '-'}</td>
                          <td style={{ padding: '7px 10px', whiteSpace: 'nowrap' }}>
                            {info ? (
                              <span style={{
                                fontSize: 11, fontWeight: 800, padding: '2px 7px', borderRadius: 8,
                                background: info.ddayBg, color: info.ddayColor,
                              }}>{info.label}</span>
                            ) : '-'}
                          </td>
                          <td style={{ padding: '7px 10px', whiteSpace: 'nowrap' }}>
                            {s.team_name ? (
                              <span style={{ fontSize: 11, background: '#f1f5f9', padding: '1px 6px', borderRadius: 6, color: '#64748b' }}>{s.team_name}</span>
                            ) : '-'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* 테이블 하단 합계 */}
              <div style={{ padding: '7px 12px', background: '#f8fafc', borderTop: '1px solid #f1f5f9', display: 'flex', gap: 16, fontSize: 12, color: '#64748b', flexShrink: 0 }}>
                <span>총 <strong style={{ color: '#334155' }}>{filtered.length}</strong>개 현장</span>
                <span>승강기 <strong style={{ color: '#334155' }}>{totalElevs}</strong>대</span>
                <span>월 보수료 합계 <strong style={{ color: '#334155' }}>{totalFee.toLocaleString()}</strong>원</span>
              </div>
            </div>

            {/* ── 오른쪽: 알림 + 처리 현황 ── */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0 }}>

              {/* 최근 알림 패널 */}
              <div style={{ ...S.panel(), flex: 1 }}>
                <div style={S.panelHead()}>
                  <div style={{ width: 3, height: 14, borderRadius: 2, background: 'linear-gradient(to bottom,#ef4444,#f97316)', flexShrink: 0 }} />
                  <span style={{ fontSize: 14, fontWeight: 700, color: '#334155', flex: 1 }}>최근 알림</span>
                  {alertCount > 0 && <span style={S.badge('#ef4444')}>{alertCount}</span>}
                </div>
                <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {expiredSites.slice(0, 2).map(s => (
                    <div key={`exp-${s.id}`} onClick={() => router.push('/sites')} style={{
                      display: 'flex', alignItems: 'flex-start', gap: 8,
                      padding: '8px 10px', borderRadius: 8, background: '#fef2f2',
                      borderLeft: '2px solid #ef4444', cursor: 'pointer',
                    }}>
                      <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#ef4444', flexShrink: 0, marginTop: 2 }} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: '#1e293b' }}>🔴 계약 만료 — {s.name}</div>
                        <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 1 }}>즉시 갱신 필요 · {s.contract_type || '계약'}</div>
                      </div>
                      <span style={{ fontSize: 11, color: '#fca5a5', flexShrink: 0 }}>오늘</span>
                    </div>
                  ))}
                  {urgentSites.slice(0, 2).map(s => {
                    const info = getDdayInfo(s.contract_end);
                    return (
                      <div key={`urg-${s.id}`} onClick={() => router.push('/sites')} style={{
                        display: 'flex', alignItems: 'flex-start', gap: 8,
                        padding: '8px 10px', borderRadius: 8, background: '#fff7ed',
                        borderLeft: '2px solid #f97316', cursor: 'pointer',
                      }}>
                        <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#f97316', flexShrink: 0, marginTop: 2 }} />
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: '#1e293b' }}>⏰ {info?.label} — {s.name}</div>
                          <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 1 }}>계약 만료 {info?.label} 전 · {s.contract_type || '계약'}</div>
                        </div>
                        <span style={{ fontSize: 11, color: '#fdba74', flexShrink: 0 }}>오늘</span>
                      </div>
                    );
                  })}
                  {counts.fault > 0 && (
                    <div onClick={() => router.push('/fault')} style={{
                      display: 'flex', alignItems: 'flex-start', gap: 8,
                      padding: '8px 10px', borderRadius: 8, background: '#f8fafc',
                      borderLeft: '2px solid #f59e0b', cursor: 'pointer',
                    }}>
                      <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#f59e0b', flexShrink: 0, marginTop: 2 }} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: '#1e293b' }}>🔧 고장접수 대기 {counts.fault}건</div>
                        <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 1 }}>처리가 필요한 고장신고</div>
                      </div>
                      <span style={{ fontSize: 11, color: '#cbd5e1', flexShrink: 0 }}>실시간</span>
                    </div>
                  )}
                  {counts.material > 0 && (
                    <div onClick={() => router.push('/material')} style={{
                      display: 'flex', alignItems: 'flex-start', gap: 8,
                      padding: '8px 10px', borderRadius: 8, background: '#f8fafc',
                      borderLeft: '2px solid #f59e0b', cursor: 'pointer',
                    }}>
                      <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#f59e0b', flexShrink: 0, marginTop: 2 }} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: '#1e293b' }}>📦 자재신청 {counts.material}건</div>
                        <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 1 }}>처리 대기 중인 자재신청</div>
                      </div>
                      <span style={{ fontSize: 11, color: '#cbd5e1', flexShrink: 0 }}>실시간</span>
                    </div>
                  )}
                  {expiredSites.length === 0 && urgentSites.length === 0 && counts.fault === 0 && counts.material === 0 && (
                    <div style={{ textAlign: 'center', color: '#94a3b8', fontSize: 12, padding: '20px 0' }}>
                      <div style={{ fontSize: 24, marginBottom: 6 }}>✅</div>
                      처리할 알림이 없어요
                    </div>
                  )}
                </div>
              </div>

              {/* 처리 현황 바 */}
              <div style={{ background: '#0f172a', borderRadius: 12, padding: 14, flexShrink: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b', marginBottom: 10, letterSpacing: '.2px' }}>이번달 처리 현황</div>
                {[
                  { name: '🔴 계약 갱신율', pct: sites.length > 0 ? Math.round((safeSites.length / sites.length) * 100) : 0, grad: 'linear-gradient(90deg,#ef4444,#f97316)' },
                  { name: '🔧 고장 처리율', pct: 87, grad: 'linear-gradient(90deg,#f59e0b,#fbbf24)' },
                  { name: '📋 점검 완료율', pct: 74, grad: 'linear-gradient(90deg,#3b82f6,#6366f1)' },
                ].map(p => (
                  <div key={p.name} style={{ marginBottom: 9 }}>
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
