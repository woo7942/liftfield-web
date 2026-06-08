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
      if (data.role !== 'admin' && !data.superAdmin) {
        router.push('/login');
        return;
      }
      setUserInfo(data);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  const handleLogout = async () => {
    await signOut(auth);
    router.push('/login');
  };

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-gray-500">로딩 중...</div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 헤더 */}
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🛗</span>
          <h1 className="text-xl font-bold text-gray-900">LiftField</h1>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-600">{userInfo?.name} 님</span>
          <button
            onClick={handleLogout}
            className="text-sm text-gray-500 hover:text-red-500 transition-colors"
          >
            로그아웃
          </button>
        </div>
      </header>

      {/* 메인 */}
      <main className="max-w-6xl mx-auto px-6 py-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-6">대시보드</h2>

        {/* 메뉴 카드 */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <MenuCard icon="🔧" title="고장접수" desc="고장신고 등록 및 관리" href="/fault" />
          <MenuCard icon="📋" title="점검관리" desc="점검 일정 및 현황" href="/inspection" />
          <MenuCard icon="🏢" title="현장관리" desc="현장 및 호기 관리" href="/sites" />
          <MenuCard icon="👥" title="직원관리" desc="팀원 현황 관리" href="/members" />
          <MenuCard icon="📊" title="통계" desc="고장 및 점검 통계" href="/stats" />
          <MenuCard icon="⚙️" title="설정" desc="시스템 설정" href="/settings" />
        </div>
      </main>
    </div>
  );
}

function MenuCard({ icon, title, desc, href }: {
  icon: string;
  title: string;
  desc: string;
  href: string;
}) {
  const router = useRouter();
  return (
    <button
      onClick={() => router.push(href)}
      className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 hover:shadow-md hover:border-blue-200 transition-all text-left"
    >
      <div className="text-3xl mb-3">{icon}</div>
      <div className="font-semibold text-gray-900 mb-1">{title}</div>
      <div className="text-sm text-gray-500">{desc}</div>
    </button>
  );
}
