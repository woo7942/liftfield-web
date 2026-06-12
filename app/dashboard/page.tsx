'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';

export default function DashboardPage() {
  const router = useRouter();
  const [userInfo, setUserInfo] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        router.push('/login');
        return;
      }

      const snap = await getDoc(doc(db, 'users', user.uid));
      if (!snap.exists()) {
        router.push('/login');
        return;
      }

      const data = snap.data();

      // ✅ company 또는 superAdmin만 접근 가능
      // ✅ 변경
const isCompany = data.subscription?.plan === 'company';
const isAdmin = data.role === 'admin';
const isSuperAdmin = data.superAdmin === true;

if (!isSuperAdmin && !(isCompany && isAdmin)) {
  router.push('/');
  return;
}


      setUserInfo({ uid: user.uid, ...data });
      setLoading(false);
    });
    return () => unsub();
  }, []);

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

  const isCompany = userInfo?.subscription?.plan === 'company';
  const isSuperAdmin = userInfo?.superAdmin;

  return (
    <div className="min-h-screen bg-gray-50">

      {/* ── 헤더 ── */}
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between sticky top-0 z-10 shadow-sm">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push('/')}
            className="text-gray-400 hover:text-gray-700 transition-colors mr-1"
          >
            ←
          </button>
          <span className="text-2xl">🛗</span>
          <h1 className="text-xl font-bold text-gray-900">LiftField</h1>
          <span className={`text-xs font-bold px-2 py-1 rounded-full ${
            isSuperAdmin
              ? 'bg-yellow-100 text-yellow-700'
              : 'bg-purple-100 text-purple-700'
          }`}>
            {isSuperAdmin ? '👑 슈퍼관리자' : '🏢 Company'}
          </span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-600 hidden sm:block">
            {userInfo?.name} 님
          </span>
          <button
            onClick={handleLogout}
            className="text-sm text-gray-400 hover:text-red-500 transition-colors"
          >
            로그아웃
          </button>
        </div>
      </header>

      {/* ── 메인 ── */}
      <main className="max-w-6xl mx-auto px-6 py-8">
        <div className="mb-8">
          <h2 className="text-2xl font-bold text-gray-900">대시보드</h2>
          <p className="text-gray-500 text-sm mt-1">
            {userInfo?.team ? `${userInfo.team} 팀` : ''} 전체 현황을 확인하세요
          </p>
        </div>

        {/* 메뉴 카드 */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <MenuCard
            icon="🔧"
            title="고장접수"
            desc="고장신고 등록 및 관리"
            badge=""
            color="red"
            onClick={() => router.push('/fault')}
          />
          <MenuCard
            icon="📋"
            title="점검관리"
            desc="점검 일정 및 현황"
            badge=""
            color="blue"
            onClick={() => router.push('/inspection')}
          />
          <MenuCard
            icon="🏢"
            title="현장관리"
            desc="현장 및 호기 관리"
            badge=""
            color="green"
            onClick={() => router.push('/sites')}
          />
          <MenuCard
            icon="👥"
            title="직원관리"
            desc="팀원 현황 관리"
            badge=""
            color="orange"
            onClick={() => router.push('/members')}
          />
          <MenuCard
            icon="📊"
            title="통계"
            desc="고장 및 점검 통계"
            badge=""
            color="purple"
            onClick={() => router.push('/stats')}
          />
          {isSuperAdmin && (
            <MenuCard
              icon="👑"
              title="슈퍼관리자"
              desc="회원 및 구독 관리"
              badge="관리자 전용"
              color="yellow"
              onClick={() => router.push('/super')}
            />
          )}
        </div>

        {/* 접근 권한 안내 */}
        <div className="mt-8 bg-purple-50 border border-purple-200 rounded-2xl p-5">
          <div className="flex items-start gap-3">
            <span className="text-2xl">🏢</span>
            <div>
              <p className="font-semibold text-purple-900">Company 플랜 웹 대시보드</p>
              <p className="text-sm text-purple-600 mt-1">
                사무실에서 고장접수, 점검관리, 현장관리를 웹으로 편리하게 관리하세요.
                PDF 출력 및 통계 기능을 이용할 수 있습니다.
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

// ── 메뉴 카드 컴포넌트 ──
function MenuCard({
  icon, title, desc, badge, color, onClick,
}: {
  icon: string;
  title: string;
  desc: string;
  badge: string;
  color: string;
  onClick: () => void;
}) {
  const colorMap: Record<string, string> = {
    red:    'hover:border-red-300 hover:bg-red-50',
    blue:   'hover:border-blue-300 hover:bg-blue-50',
    green:  'hover:border-green-300 hover:bg-green-50',
    orange: 'hover:border-orange-300 hover:bg-orange-50',
    purple: 'hover:border-purple-300 hover:bg-purple-50',
    yellow: 'hover:border-yellow-300 hover:bg-yellow-50',
  };

  const badgeColorMap: Record<string, string> = {
    red:    'bg-red-100 text-red-700',
    blue:   'bg-blue-100 text-blue-700',
    green:  'bg-green-100 text-green-700',
    orange: 'bg-orange-100 text-orange-700',
    purple: 'bg-purple-100 text-purple-700',
    yellow: 'bg-yellow-100 text-yellow-700',
  };

  return (
    <button
      onClick={onClick}
      className={`bg-white rounded-2xl p-6 shadow-sm border border-gray-100 transition-all text-left relative ${colorMap[color] || ''}`}
    >
      {badge && (
        <span className={`absolute top-3 right-3 text-xs font-bold px-2 py-1 rounded-full ${badgeColorMap[color] || ''}`}>
          {badge}
        </span>
      )}
      <div className="text-3xl mb-3">{icon}</div>
      <div className="font-semibold text-gray-900 mb-1">{title}</div>
      <div className="text-sm text-gray-500">{desc}</div>
    </button>
  );
}
