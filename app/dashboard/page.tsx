'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import {
  doc, getDoc, collection, query, where,
  getDocs, onSnapshot, orderBy, collectionGroup
} from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';

// ── 타입 ──────────────────────────────────────────
interface SiteItem {
  id: string;
  name: string;
  companyName?: string;
  contractType?: string;
  elevatorCount?: number;
  maintenanceFee?: number;
  contractStart?: string;
  contractEnd?: string;
  teamName?: string;
  region?: string;
  phone?: string;
}

interface FaultItem {
  id: string;
  siteName: string;
  hogiNo: string;
  content: string;
  assignedName: string;
  status: string;
  createdAt: any;
}

interface MaterialItem {
  id: string;
  siteName: string;
  itemName: string;
  requesterName: string;
  status: string;
  createdAt: any;
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
  const d = v?.seconds ? new Date(v.seconds * 1000) : new Date(v);
  const diff = Math.floor((Date.now() - d.getTime()) / 60000);
  if (diff < 1)  return '방금 전';
  if (diff < 60) return `${diff}분 전`;
  if (diff < 1440) return `${Math.floor(diff / 60)}시간 전`;
  return `${Math.floor(diff / 1440)}일 전`;
}

// ── 사이드바 메뉴 ──────────────────────────────────
const MENUS = [
  { icon: '🏢', label: '현장관리',  path: '/sites',      badgeKey: '' },
  { icon: '🔧', label: '고장접수',  path: '/fault',      badgeKey: 'fault' },
  { icon: '📋', label: '점검관리',  path: '/inspection', badgeKey: '' },
  { icon: '📦', label: '자재신청',  path: '/material',   badgeKey: 'material' },
  { icon: '👥', label: '직원관리',  path: '/members',    badgeKey: 'member' },
  { icon: '📊', label: '통계',      path: '/stats',      badgeKey: '' },
  { icon: '🔗', label: '팀 초대',   path: '/team',       badgeKey: '' },
];

const BADGE_COLORS: Record<string, string> = {
  fault: '#ef4444', material: '#f59e0b', member: '#8b5cf6',
};

const S = {
  flex: (gap = 0): React.CSSProperties => ({ display: 'flex', alignItems: 'center', gap }),
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

// ── 알림 탭 타입 ──────────────────────────────────

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

  // 알림 탭
  const [faultList, setFaultList]   = useState<FaultItem[]>([]);
  const [materialList, setMaterialList] = useState<MaterialItem[]>([]);

  useEffect(() => {
    const d = new Date();
    setToday(d.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' }));
  }, []);

  // 인증
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) { router.push('/login'); return; }
      const snap = await getDoc(doc(db, 'users', user.uid));
      if (!snap.exists()) { router.push('/login'); return; }
      const data = snap.data();
      const isCompany    = data.subscription?.plan === 'company';
      const isAdmin      = data.role === 'admin';
      const isSuperAdmin = data.superAdmin === true;
      if (!isSuperAdmin && !(isCompany && isAdmin)) { router.push('/'); return; }
      setUserInfo({ uid: user.uid, ...data });
      setLoading(false);
    });
    return () => unsub();
  }, []);

  // 현장 (localStorage 캐시)
useEffect(() => {
  if (!userInfo) return;
  const cid = userInfo.companyId;
  const cacheKey = `sites_${cid}`;
  const cached = localStorage.getItem(cacheKey);

  if (cached) {
    setSites(JSON.parse(cached));
  } else {
    getDocs(query(collection(db, 'companies', cid, 'sites'), orderBy('createdAt', 'desc')))
      .then(snap => {
        const data = snap.docs.map(d => ({ id: d.id, ...d.data() } as SiteItem));
        setSites(data);
        localStorage.setItem(cacheKey, JSON.stringify(data));
      }).catch(console.error);
  }
}, [userInfo]);


  // 승강기 수 (localStorage 캐시)
useEffect(() => {
  if (!userInfo) return;
  const cacheKey = `totalElevs_${userInfo.companyId}`;
  const cached = localStorage.getItem(cacheKey);
  
  if (cached) {
    // 저장된 값 바로 사용
    setTotalElevs(Number(cached));
  } else {
    // 최초 1회만 Firebase 읽기
    getDocs(query(collectionGroup(db, 'elevators'), where('companyId', '==', userInfo.companyId)))
      .then(snap => {
        setTotalElevs(snap.size);
        localStorage.setItem(cacheKey, String(snap.size));
      }).catch(console.error);
  }
}, [userInfo]);


  // 카운트 + 알림 목록 구독
  useEffect(() => {
    if (!userInfo) return;
    const cid    = userInfo.companyId;
    const useNew = userInfo.useNewStructure;
    const unsubs: (() => void)[] = [];

    // 24시간 이내만 구독
const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

// 고장접수
const faultCol = useNew ? collection(db, 'companies', cid, 'faultReports') : collection(db, 'faultReports');
const faultQ   = useNew
  ? query(faultCol, where('status', '==', '접수대기'), where('createdAt', '>=', since), orderBy('createdAt', 'desc'))
  : query(faultCol, where('companyId', '==', cid), where('status', '==', '접수대기'), where('createdAt', '>=', since), orderBy('createdAt', 'desc'));
unsubs.push(onSnapshot(faultQ, s => {
  setCounts(p => ({ ...p, fault: s.size }));
  setFaultList(s.docs.map(d => ({ id: d.id, ...d.data() } as FaultItem)));
}));

// 자재신청
const matCol = useNew ? collection(db, 'companies', cid, 'materialRequests') : collection(db, 'materialRequests');
const matQ   = useNew
  ? query(matCol, where('status', '==', '신청중'), where('createdAt', '>=', since), orderBy('createdAt', 'desc'))
  : query(matCol, where('companyId', '==', cid), where('status', '==', '신청중'), where('createdAt', '>=', since), orderBy('createdAt', 'desc'));
unsubs.push(onSnapshot(matQ, s => {
  setCounts(p => ({ ...p, material: s.size }));
  setMaterialList(s.docs.map(d => ({ id: d.id, ...d.data() } as MaterialItem)));
}));


    // 직원 수 (localStorage 캐시)
const memberCacheKey = `memberCount_${cid}`;
const cachedMember = localStorage.getItem(memberCacheKey);
if (cachedMember) {
  setCounts(p => ({ ...p, member: Number(cachedMember) }));
} else {
  getDocs(query(collection(db, 'users'), where('companyId', '==', cid)))
    .then(s => {
      setCounts(p => ({ ...p, member: s.size }));
      localStorage.setItem(memberCacheKey, String(s.size));
    }).catch(console.error);
}


    return () => unsubs.forEach(u => u());
  }, [userInfo]);

  const handleLogout = async () => { await signOut(auth); router.push('/'); };

  // ── 파생 데이터 ──────────────────────────────────
  const expiredSites = sites.filter(s => (getDday(s.contractEnd) ?? 1) <= 0);
  const urgentSites  = sites.filter(s => { const d = getDday(s.contractEnd); return d !== null && d > 0 && d <= 30; });
  const warningSites = sites.filter(s => { const d = getDday(s.contractEnd); return d !== null && d > 30 && d <= 60; });
  const safeSites    = sites.filter(s => { const d = getDday(s.contractEnd); return d !== null && d > 60; });
  const alertCount   = expiredSites.length + urgentSites.length + counts.fault + counts.material;

  const expiryTop = [...sites]
    .filter(s => s.contractEnd)
    .sort((a, b) => (getDday(a.contractEnd) ?? 9999) - (getDday(b.contractEnd) ?? 9999))
    .slice(0, 5);

  const filtered = sites
    .filter(s => {
      if (activeFilter === 'expired') return (getDday(s.contractEnd) ?? 1) <= 0;
      if (activeFilter === 'urgent')  { const d = getDday(s.contractEnd); return d !== null && d > 0 && d <= 30; }
      if (activeFilter === 'warning') { const d = getDday(s.contractEnd); return d !== null && d > 30 && d <= 60; }
      return true;
    })
    .filter(s => {
      if (!search) return true;
      const q = search.toLowerCase();
      return s.name?.toLowerCase().includes(q) ||
             s.companyName?.toLowerCase().includes(q) ||
             s.region?.toLowerCase().includes(q);
    })
    .sort((a, b) => (getDday(a.contractEnd) ?? 9999) - (getDday(b.contractEnd) ?? 9999));

  const totalFee = filtered.reduce((s, i) => s + (i.maintenanceFee || 0), 0);

  // 알림 탭 카운트
  const contractAlertCount = expiredSites.length + urgentSites.length;

  if (loading) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 36 }}>🛗</div>
        <p style={{ color: '#94a3b8', fontSize: 13, marginTop: 10 }}>로딩 중...</p>
      </div>
    </div>
  );

  const isSuperAdmin = userInfo?.superAdmin;
  const nameChar = (userInfo?.name || 'A').charAt(0);

  return (
    <div style={{
  height: '100vh', overflow: 'hidden', display: 'flex', flexDirection: 'column',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans KR", sans-serif',
  background: '#0f172a', fontSize: 15, zoom: 1.15,
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
            <span style={{ fontSize: 13, color: '#cbd5e1', fontWeight: 600 }}>{userInfo?.name} · {userInfo?.companyDisplayName || '관리자'}</span>
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
            <button onClick={() => router.push('/admin')} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', border: 'none', borderLeft: '2px solid transparent', background: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' }}>
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
                {userInfo?.companyDisplayName || ''} · 전체 {sites.length}개 현장 관리 중
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

          {/* ── 하단 3열: 왼쪽(만료현황) | 가운데(현장목록) | 오른쪽(알림) ── */}
          {/* gridTemplateColumns 비율 조정: 현장목록 줄이고 알림 크게 */}
          <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr 520px', gap: 12, flex: 1, minHeight: 0 }}>

            {/* ── 왼쪽: 계약 만료 현황 ── */}
            <div style={S.panel()}>
              <div style={S.panelHead()}>
                <div style={{ width: 3, height: 14, borderRadius: 2, background: 'linear-gradient(to bottom,#ef4444,#f97316)', flexShrink: 0 }} />
                <span style={{ fontSize: 13, fontWeight: 700, color: '#334155', flex: 1 }}>계약 만료 현황</span>
              </div>
              <div style={{ flex: 1, overflowY: 'auto', padding: '10px 10px' }}>
                {[
                  { cls: 'expired', dot: '#ef4444', label: '만료됨',   count: expiredSites.length,  bg: '#fef2f2', border: '#ef4444', tc: '#dc2626' },
                  { cls: 'urgent',  dot: '#f97316', label: '30일 이내', count: urgentSites.length,   bg: '#fff7ed', border: '#f97316', tc: '#ea580c' },
                  { cls: 'warning', dot: '#eab308', label: '60일 이내', count: warningSites.length,  bg: '#fefce8', border: '#eab308', tc: '#ca8a04' },
                  { cls: 'safe',    dot: '#22c55e', label: '60일 초과', count: safeSites.length,     bg: '#f0fdf4', border: '#22c55e', tc: '#16a34a' },
                ].map(row => (
                  <div key={row.cls} onClick={() => setActiveFilter(row.cls as any)} style={{
                    display: 'flex', alignItems: 'center', gap: 7,
                    padding: '7px 8px', borderRadius: 9, marginBottom: 5,
                    background: row.bg, borderLeft: `3px solid ${row.border}`,
                    cursor: 'pointer', transition: 'opacity .15s',
                  }}
                  onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.opacity = '.8'}
                  onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.opacity = '1'}
                  >
                    <div style={{ width: 7, height: 7, borderRadius: '50%', background: row.dot, flexShrink: 0 }} />
                    <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: row.tc }}>{row.label}</span>
                    <span style={{ fontSize: 17, fontWeight: 900, color: row.tc }}>{row.count}</span>
                    <span style={{ fontSize: 11, color: '#94a3b8' }}>개</span>
                  </div>
                ))}

                <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #f1f5f9' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', marginBottom: 6 }}>⏰ 만료 임박 순위</div>
                  {expiryTop.length === 0 ? (
                    <p style={{ fontSize: 11, color: '#94a3b8', textAlign: 'center', padding: '10px 0' }}>현장 데이터가 없어요</p>
                  ) : expiryTop.map(s => {
                    const info = getDdayInfo(s.contractEnd);
                    if (!info) return null;
                    return (
                      <div key={s.id} onClick={() => router.push('/sites')} style={{
                        display: 'flex', alignItems: 'center', gap: 5,
                        padding: '6px 7px', borderRadius: 7, background: '#f8fafc',
                        cursor: 'pointer', marginBottom: 4,
                      }}
                      onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.background = '#f1f5f9'}
                      onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.background = '#f8fafc'}
                      >
                        <span style={{ fontSize: 11, fontWeight: 800, padding: '1px 6px', borderRadius: 7, flexShrink: 0, background: info.ddayBg, color: info.ddayColor }}>{info.label}</span>
                        <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: '#1e293b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name}</span>
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
                <span style={{ fontSize: 13, fontWeight: 700, color: '#334155', flex: 1 }}>현장 목록</span>
                <span style={{ fontSize: 11, color: '#94a3b8' }}>전체 {sites.length}개</span>
              </div>

              {/* 검색 + 필터 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '8px 10px 0', flexShrink: 0 }}>
                <input
                  value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="🔍 현장명, 업체명 검색..."
                  style={{ flex: 1, border: '1px solid #e2e8f0', borderRadius: 7, padding: '5px 8px', fontSize: 12, fontFamily: 'inherit', background: '#f8fafc', color: '#334155', outline: 'none' }}
                />
                {[
                  { key: 'expired', label: `🔴 ${expiredSites.length}`,  activeColor: '#ef4444' },
                  { key: 'urgent',  label: `🟠 ${urgentSites.length}`,   activeColor: '#f97316' },
                  { key: 'warning', label: `🟡 ${warningSites.length}`,  activeColor: '#eab308' },
                ].map(f => (
                  <button key={f.key} onClick={() => setActiveFilter(prev => prev === f.key as any ? 'all' : f.key as any)} style={{
                    fontSize: 11, fontWeight: 700, padding: '5px 8px', borderRadius: 7,
                    border: `1px solid ${activeFilter === f.key ? f.activeColor : '#e2e8f0'}`,
                    background: activeFilter === f.key ? f.activeColor : '#f8fafc',
                    color: activeFilter === f.key ? '#fff' : '#64748b',
                    cursor: 'pointer', whiteSpace: 'nowrap', transition: 'all .15s', fontFamily: 'inherit',
                  }}>{f.label}</button>
                ))}
              </div>

              {/* 테이블 */}
              <div style={{ flex: 1, overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: '#f8fafc', position: 'sticky', top: 0 }}>
                      {['현장명', '계약업체', '유형', '대수', '보수료', '만료일', 'D-day', '팀'].map(h => (
                        <th key={h} style={{ padding: '7px 8px', textAlign: 'left', fontWeight: 700, color: '#64748b', whiteSpace: 'nowrap', fontSize: 11, borderBottom: '1px solid #f1f5f9' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.length === 0 ? (
                      <tr>
                        <td colSpan={8} style={{ textAlign: 'center', padding: '28px 0', color: '#94a3b8', fontSize: 12 }}>
                          <div style={{ fontSize: 24, marginBottom: 6 }}>🏢</div>
                          현장이 없어요
                        </td>
                      </tr>
                    ) : filtered.map(s => {
                      const info = getDdayInfo(s.contractEnd);
                      const rowBg =
                        info?.rowCls === 'expired' ? '#fef2f2' :
                        info?.rowCls === 'urgent'  ? '#fff7ed' :
                        info?.rowCls === 'warning' ? '#fefce8' : 'transparent';
                      const typeColor = s.contractType?.includes('종합')
                        ? { bg: '#eff6ff', color: '#3b82f6' }
                        : s.contractType ? { bg: '#f5f3ff', color: '#7c3aed' } : null;
                      return (
                        <tr key={s.id}
                          onClick={() => router.push('/sites')}
                          style={{ background: rowBg, cursor: 'pointer', borderBottom: '1px solid #f8fafc', transition: 'filter .1s' }}
                          onMouseEnter={e => (e.currentTarget as HTMLTableRowElement).style.filter = 'brightness(.97)'}
                          onMouseLeave={e => (e.currentTarget as HTMLTableRowElement).style.filter = 'none'}
                        >
                          <td style={{ padding: '6px 8px', fontWeight: 700, color: '#1e293b', whiteSpace: 'nowrap', fontSize: 12 }}>{s.name}</td>
                          <td style={{ padding: '6px 8px', color: '#475569', whiteSpace: 'nowrap', fontSize: 11 }}>{s.companyName || '-'}</td>
                          <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>
                            {typeColor ? (
                              <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 5px', borderRadius: 5, background: typeColor.bg, color: typeColor.color }}>
                                {s.contractType?.includes('종합') ? '종합' : '일반'}
                              </span>
                            ) : '-'}
                          </td>
                          <td style={{ padding: '6px 8px', color: '#475569', whiteSpace: 'nowrap', fontSize: 11 }}>{s.elevatorCount ? `${s.elevatorCount}대` : '-'}</td>
                          <td style={{ padding: '6px 8px', color: '#475569', whiteSpace: 'nowrap', fontSize: 11 }}>{s.maintenanceFee ? s.maintenanceFee.toLocaleString() : '-'}</td>
                          <td style={{ padding: '6px 8px', whiteSpace: 'nowrap', fontWeight: 700, color: info?.ddayColor || '#475569', fontSize: 11 }}>{s.contractEnd || '-'}</td>
                          <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>
                            {info ? (
                              <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 6px', borderRadius: 7, background: info.ddayBg, color: info.ddayColor }}>{info.label}</span>
                            ) : '-'}
                          </td>
                          <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>
                            {s.teamName ? (
                              <span style={{ fontSize: 10, background: '#f1f5f9', padding: '1px 5px', borderRadius: 5, color: '#64748b' }}>{s.teamName}</span>
                            ) : '-'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* 합계 */}
              <div style={{ padding: '6px 10px', background: '#f8fafc', borderTop: '1px solid #f1f5f9', display: 'flex', gap: 14, fontSize: 11, color: '#64748b', flexShrink: 0 }}>
                <span>총 <strong style={{ color: '#334155' }}>{filtered.length}</strong>개</span>
                <span>승강기 <strong style={{ color: '#334155' }}>{totalElevs}</strong>대</span>
                <span>월 보수료 <strong style={{ color: '#334155' }}>{totalFee.toLocaleString()}</strong>원</span>
              </div>
            </div>

            {/* ── 오른쪽: 알림 (하나의 패널, 내부 가로 3분할) ── */}
<div style={{ display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0 }}>

  {/* 단일 패널 */}
  <div style={{ ...S.panel(), flex: 1, minHeight: 0 }}>
    {/* 패널 헤더 */}
    <div style={S.panelHead()}>
      <div style={{ width: 3, height: 14, borderRadius: 2, background: 'linear-gradient(to bottom,#ef4444,#f97316)', flexShrink: 0 }} />
      <span style={{ fontSize: 13, fontWeight: 700, color: '#334155', flex: 1 }}>최근 알림</span>
      {alertCount > 0 && <span style={S.badge('#ef4444')}>{alertCount}</span>}
    </div>

    {/* 가로 3분할 내용 */}
    <div style={{ display: 'grid', gridTemplateRows: '1fr 1fr 1fr', gridTemplateColumns: '1fr', gap: 8, flex: 1, overflow: 'hidden', padding: '8px 10px' }}>



      {/* 📅 예약건 */}
      <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRadius: 8, border: '1px solid #f1f5f9' }}>

        <div style={{ padding: '8px 12px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#ef4444' }}>📅 예약건</span>
          {contractAlertCount > 0 && <span style={S.badge('#ef4444')}>{contractAlertCount}</span>}
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {expiredSites.length === 0 && urgentSites.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#94a3b8', fontSize: 11, padding: '20px 0' }}>
              <div style={{ fontSize: 22, marginBottom: 6 }}>✅</div>
              만료 예정 없음
            </div>
          ) : (
            <>
              {expiredSites.map(s => (
                <div key={`exp-${s.id}`} onClick={() => router.push('/sites')} style={{
                  padding: '9px 10px', borderRadius: 9, background: '#fef2f2',
                  borderLeft: '3px solid #ef4444', cursor: 'pointer', transition: 'opacity .15s',
                }}
                onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.opacity = '.8'}
                onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.opacity = '1'}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: '#dc2626' }}>🔴 계약 만료</span>
                    <span style={{ fontSize: 9, background: '#fee2e2', color: '#ef4444', padding: '1px 5px', borderRadius: 6, fontWeight: 700 }}>만료</span>
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#1e293b', marginBottom: 2 }}>{s.name}</div>
                  <div style={{ fontSize: 10, color: '#94a3b8' }}>{s.contractType || '계약'} · {s.contractEnd || '-'}</div>
                </div>
              ))}
              {urgentSites.map(s => {
                const info = getDdayInfo(s.contractEnd);
                return (
                  <div key={`urg-${s.id}`} onClick={() => router.push('/sites')} style={{
                    padding: '9px 10px', borderRadius: 9, background: '#fff7ed',
                    borderLeft: '3px solid #f97316', cursor: 'pointer', transition: 'opacity .15s',
                  }}
                  onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.opacity = '.8'}
                  onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.opacity = '1'}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: '#ea580c' }}>⏰ 만료 임박</span>
                      <span style={{ fontSize: 9, background: '#ffedd5', color: '#f97316', padding: '1px 5px', borderRadius: 6, fontWeight: 700 }}>{info?.label}</span>
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#1e293b', marginBottom: 2 }}>{s.name}</div>
                    <div style={{ fontSize: 10, color: '#94a3b8' }}>{s.contractType || '계약'} · {s.contractEnd || '-'}</div>
                  </div>
                );
              })}
            </>
          )}
        </div>
      </div>

      {/* 🔧 고장접수 */}
      <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRadius: 8, border: '1px solid #f1f5f9' }}>

        <div style={{ padding: '8px 12px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#d97706' }}>🔧 고장접수</span>
          {counts.fault > 0 && <span style={S.badge('#f59e0b')}>{counts.fault}</span>}
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {faultList.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#94a3b8', fontSize: 11, padding: '20px 0' }}>
              <div style={{ fontSize: 22, marginBottom: 6 }}>✅</div>
              대기 중인 고장 없음
            </div>
          ) : faultList.map(f => (
            <div key={f.id} onClick={() => router.push('/fault')} style={{
              padding: '9px 10px', borderRadius: 9, background: '#fffbeb',
              borderLeft: '3px solid #f59e0b', cursor: 'pointer', transition: 'opacity .15s',
            }}
            onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.opacity = '.8'}
            onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.opacity = '1'}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: '#d97706' }}>접수대기</span>
                <span style={{ fontSize: 9, color: '#94a3b8' }}>{timeAgo(f.createdAt)}</span>
              </div>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#1e293b', marginBottom: 2 }}>{f.siteName} · {f.hogiNo}</div>
              <div style={{ fontSize: 10, color: '#78716c', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.content}</div>
              <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>담당: {f.assignedName || '미배정'}</div>
            </div>
          ))}
        </div>
      </div>

      {/* 📦 자재신청 */}
      <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRadius: 8, border: '1px solid #f1f5f9' }}>

        <div style={{ padding: '8px 12px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#7c3aed' }}>📦 자재신청</span>
          {counts.material > 0 && <span style={S.badge('#8b5cf6')}>{counts.material}</span>}
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {materialList.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#94a3b8', fontSize: 11, padding: '20px 0' }}>
              <div style={{ fontSize: 22, marginBottom: 6 }}>✅</div>
              대기 중인 신청 없음
            </div>
          ) : materialList.map(m => (
            <div key={m.id} onClick={() => router.push('/material')} style={{
              padding: '9px 10px', borderRadius: 9, background: '#faf5ff',
              borderLeft: '3px solid #8b5cf6', cursor: 'pointer', transition: 'opacity .15s',
            }}
            onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.opacity = '.8'}
            onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.opacity = '1'}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: '#7c3aed' }}>신청중</span>
                <span style={{ fontSize: 9, color: '#94a3b8' }}>{timeAgo(m.createdAt)}</span>
              </div>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#1e293b', marginBottom: 2 }}>{m.siteName}</div>
              <div style={{ fontSize: 11, color: '#6d28d9', marginBottom: 2 }}>{m.itemName}</div>
              <div style={{ fontSize: 10, color: '#94a3b8' }}>신청자: {m.requesterName || '-'}</div>
            </div>
          ))}
        </div>
      </div>

    </div>
  </div>

  {/* 처리 현황 바 */}
  <div style={{ background: '#0f172a', borderRadius: 12, padding: 14, flexShrink: 0 }}>
    <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b', marginBottom: 10 }}>이번달 처리 현황</div>
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
