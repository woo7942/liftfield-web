'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, getDoc, collection, query, where, onSnapshot } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';

const MENU_ITEMS = [
  { icon: '🏢', title: '현장관리', desc: '현장 및 호기 관리', path: '/sites', color: 'green' },
  { icon: '🔧', title: '고장접수', desc: '고장신고 등록 및 관리', path: '/fault', color: 'red' },
  { icon: '📋', title: '점검관리', desc: '점검 일정 및 현황', path: '/inspection', color: 'blue' },
  { icon: '📦', title: '자재신청', desc: '자재 신청 및 처리 관리', path: '/material', color: 'yellow' },
  { icon: '👥', title: '직원관리', desc: '팀원 현황 관리', path: '/members', color: 'orange' },
  { icon: '📊', title: '통계', desc: '고장 및 점검 통계', path: '/stats', color: 'purple' },
  { icon: '🔗', title: '팀 초대하기', desc: '팀 초대코드 발급', path: '/team', color: 'indigo' },
];

const COLOR_MAP: Record<string, { sidebar: string; card: string; badge: string; icon: string }> = {
  green:  { sidebar: 'hover:bg-green-50 hover:text-green-700',  card: 'border-green-200 bg-green-50',   badge: 'bg-green-100 text-green-700',   icon: 'bg-green-100' },
  red:    { sidebar: 'hover:bg-red-50 hover:text-red-700',      card: 'border-red-200 bg-red-50',       badge: 'bg-red-100 text-red-700',       icon: 'bg-red-100' },
  blue:   { sidebar: 'hover:bg-blue-50 hover:text-blue-700',    card: 'border-blue-200 bg-blue-50',     badge: 'bg-blue-100 text-blue-700',     icon: 'bg-blue-100' },
  yellow: { sidebar: 'hover:bg-yellow-50 hover:text-yellow-700',card: 'border-yellow-200 bg-yellow-50', badge: 'bg-yellow-100 text-yellow-700', icon: 'bg-yellow-100' },
  orange: { sidebar: 'hover:bg-orange-50 hover:text-orange-700',card: 'border-orange-200 bg-orange-50', badge: 'bg-orange-100 text-orange-700', icon: 'bg-orange-100' },
  purple: { sidebar: 'hover:bg-purple-50 hover:text-purple-700',card: 'border-purple-200 bg-purple-50', badge: 'bg-purple-100 text-purple-700', icon: 'bg-purple-100' },
  indigo: { sidebar: 'hover:bg-indigo-50 hover:text-indigo-700',card: 'border-indigo-200 bg-indigo-50', badge: 'bg-indigo-100 text-indigo-700', icon: 'bg-indigo-100' },
};

export default function DashboardPage() {
  const router = useRouter();
  const [userInfo, setUserInfo] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [siteCount, setSiteCount] = useState(0);
  const [faultCount, setFaultCount] = useState(0);
  const [materialCount, setMaterialCount] = useState(0);
  const [memberCount, setMemberCount] = useState(0);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) { router.push('/login'); return; }
      const snap = await getDoc(doc(db, 'users', user.uid));
      if (!snap.exists()) { router.push('/login'); return; }
      const data = snap.data();
      const isCompany = data.subscription?.plan === 'company';
      const isAdmin = data.role === 'admin';
      const isSuperAdmin = data.superAdmin === true;
      if (!isSuperAdmin && !(isCompany && isAdmin)) { router.push('/'); return; }
      setUserInfo({ uid: user.uid, ...data });
      setLoading(false);
    });
    return () => unsub();
  }, []);

  // 미리보기 카운트 로드
  useEffect(() => {
    if (!userInfo) return;
    const cid = userInfo.companyId;
    const useNew = userInfo.useNewStructure;

    // 현장 수
    const siteCol = useNew
      ? collection(db, 'companies', cid, 'sites')
      : collection(db, 'sites');
    const siteQ = useNew ? siteCol : query(siteCol, where('companyId', '==', cid));
    const u1 = onSnapshot(siteQ, (s) => setSiteCount(s.size));

    // 고장접수 수 (신규 접수)
    const faultCol = useNew
      ? collection(db, 'companies', cid, 'faultReports')
      : collection(db, 'faultReports');
    const faultQ = useNew
      ? query(faultCol, where('status', '==', '접수대기'))
      : query(faultCol, where('companyId', '==', cid), where('status', '==', '접수대기'));
    const u2 = onSnapshot(faultQ, (s) => setFaultCount(s.size));

    // 자재신청 수 (신청중)
    const matCol = useNew
      ? collection(db, 'companies', cid, 'materialRequests')
      : collection(db, 'materialRequests');
    const matQ = useNew
      ? query(matCol, where('status', '==', '신청중'))
      : query(matCol, where('companyId', '==', cid), where('status', '==', '신청중'));
    const u3 = onSnapshot(matQ, (s) => setMaterialCount(s.size));

    // 멤버 수
    const u4 = onSnapshot(
      query(collection(db, 'users'), where('companyId', '==', cid)),
      (s) => setMemberCount(s.size)
    );

    return () => { u1(); u2(); u3(); u4(); };
  }, [userInfo]);

  const handleLogout = async () => {
    await signOut(auth);
    router.push('/');
  };

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="flex flex-col items-center gap-3">
        <div className="text-3xl animate-spin">🛗</div>
        <p className="text-gray-500 text-sm">로딩 중...</p>
      </div>
    </div>
  );

  const isSuperAdmin = userInfo?.superAdmin;

  // 미리보기 카운트 매핑
  const previewCounts: Record<string, number | null> = {
    '/fault': faultCount,
    '/material': materialCount,
    '/members': memberCount,
    '/sites': siteCount,
  };

  const previewLabels: Record<string, string> = {
    '/fault': '접수대기',
    '/material': '신청중',
    '/members': '전체 인원',
    '/sites': '등록 현장',
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">

      {/* ── 상단 헤더 ── */}
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between sticky top-0 z-20 shadow-sm">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🛗</span>
          <h1 className="text-xl font-black text-gray-900">LiftField</h1>
          <span className={`text-xs font-bold px-2 py-1 rounded-full ${
            isSuperAdmin ? 'bg-yellow-100 text-yellow-700' : 'bg-purple-100 text-purple-700'
          }`}>
            {isSuperAdmin ? '👑 슈퍼관리자' : '🏢 운영 페이지'}
          </span>
          {userInfo?.companyDisplayName && (
            <span className="text-xs text-gray-400 font-medium hidden sm:block">
              {userInfo.companyDisplayName}
            </span>
          )}
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-600 hidden sm:block">{userInfo?.name} 님</span>
          <button onClick={() => router.push('/')} className="text-sm text-gray-400 hover:text-gray-700 transition-colors">
            홈
          </button>
          <button onClick={handleLogout} className="text-sm text-gray-400 hover:text-red-500 transition-colors">
            로그아웃
          </button>
        </div>
      </header>

      <div className="flex flex-1">

        {/* ── 왼쪽 사이드바 ── */}
        <aside className="w-56 bg-white border-r border-gray-200 flex flex-col sticky top-16 h-[calc(100vh-64px)] shrink-0">
          <div className="p-4 border-b border-gray-100">
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">메뉴</p>
          </div>
          <nav className="flex-1 overflow-y-auto py-2">
            {MENU_ITEMS.map((item) => {
              const c = COLOR_MAP[item.color];
              return (
                <button
                  key={item.path}
                  onClick={() => router.push(item.path)}
                  className={`w-full flex items-center gap-3 px-4 py-3 text-left text-sm font-medium text-gray-600 transition-all ${c.sidebar}`}
                >
                  <span className={`w-8 h-8 rounded-xl flex items-center justify-center text-base shrink-0 ${c.icon}`}>
                    {item.icon}
                  </span>
                  <span>{item.title}</span>
                </button>
              );
            })}
            {isSuperAdmin && (
              <button
                onClick={() => router.push('/super')}
                className="w-full flex items-center gap-3 px-4 py-3 text-left text-sm font-medium text-gray-600 hover:bg-yellow-50 hover:text-yellow-700 transition-all"
              >
                <span className="w-8 h-8 rounded-xl flex items-center justify-center text-base shrink-0 bg-yellow-100">
                  👑
                </span>
                <span>슈퍼관리자</span>
              </button>
            )}
          </nav>
          <div className="p-4 border-t border-gray-100">
            <button
              onClick={() => router.push('/')}
              className="w-full text-xs text-gray-400 hover:text-gray-600 transition-colors text-left flex items-center gap-2"
            >
              ← 홈으로
            </button>
          </div>
        </aside>

        {/* ── 오른쪽 메인 ── */}
        <main className="flex-1 p-6 overflow-y-auto">

          {/* 인사말 */}
          <div className="mb-6">
            <h2 className="text-2xl font-black text-gray-900">
              안녕하세요, {userInfo?.name} 님 👋
            </h2>
            <p className="text-gray-400 text-sm mt-1">
              {userInfo?.companyDisplayName || ''} 운영 현황을 확인하세요
            </p>
          </div>

          {/* 현장관리 메인 카드 */}
          <div
            onClick={() => router.push('/sites')}
            className="bg-gradient-to-br from-green-500 to-emerald-600 rounded-3xl p-7 text-white mb-6 cursor-pointer hover:shadow-xl hover:shadow-green-200 transition-all hover:-translate-y-0.5 group"
          >
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-3xl">🏢</span>
                  <span className="text-lg font-black">현장관리</span>
                </div>
                <p className="text-green-100 text-sm mb-4">
                  현장 및 호기를 등록하고 전체 현황을 한눈에 모니터링하세요
                </p>
                <div className="flex items-center gap-4">
                  <div className="bg-white/20 rounded-2xl px-4 py-2">
                    <p className="text-xs text-green-100">등록 현장</p>
                    <p className="text-2xl font-black">{siteCount}</p>
                  </div>
                </div>
              </div>
              <span className="text-5xl opacity-20 group-hover:opacity-40 transition-opacity">🏢</span>
            </div>
            <div className="mt-4 flex items-center gap-1 text-green-100 text-sm font-semibold">
              현장관리 바로가기 →
            </div>
          </div>

          {/* 나머지 메뉴 미리보기 카드 */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {MENU_ITEMS.filter((m) => m.path !== '/sites').map((item) => {
              const c = COLOR_MAP[item.color];
              const count = previewCounts[item.path];
              const label = previewLabels[item.path];
              return (
                <button
                  key={item.path}
                  onClick={() => router.push(item.path)}
                  className={`bg-white rounded-2xl p-5 border-2 ${c.card} text-left hover:shadow-md transition-all hover:-translate-y-0.5 group`}
                >
                  <div className="flex items-center justify-between mb-3">
                    <span className={`w-10 h-10 rounded-xl flex items-center justify-center text-xl ${c.icon}`}>
                      {item.icon}
                    </span>
                    {count !== null && count !== undefined && label && (
                      <span className={`text-xs font-bold px-2 py-1 rounded-full ${c.badge}`}>
                        {label} {count}
                      </span>
                    )}
                  </div>
                  <p className="font-bold text-gray-900 text-sm mb-1">{item.title}</p>
                  <p className="text-xs text-gray-400 leading-relaxed">{item.desc}</p>
                  <p className="mt-3 text-xs font-semibold text-gray-400 group-hover:text-gray-600 transition-colors">
                    바로가기 →
                  </p>
                </button>
              );
            })}

            {isSuperAdmin && (
              <button
                onClick={() => router.push('/super')}
                className="bg-white rounded-2xl p-5 border-2 border-yellow-200 bg-yellow-50 text-left hover:shadow-md transition-all hover:-translate-y-0.5 group"
              >
                <div className="flex items-center justify-between mb-3">
                  <span className="w-10 h-10 rounded-xl flex items-center justify-center text-xl bg-yellow-100">
                    👑
                  </span>
                  <span className="text-xs font-bold px-2 py-1 rounded-full bg-yellow-100 text-yellow-700">
                    전용
                  </span>
                </div>
                <p className="font-bold text-gray-900 text-sm mb-1">슈퍼관리자</p>
                <p className="text-xs text-gray-400 leading-relaxed">회원 및 구독 관리</p>
                <p className="mt-3 text-xs font-semibold text-gray-400 group-hover:text-gray-600 transition-colors">
                  바로가기 →
                </p>
              </button>
            )}
          </div>

        </main>
      </div>
    </div>
  );
}
