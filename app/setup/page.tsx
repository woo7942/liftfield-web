'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';

function generateCompanyId(name: string): string {
  const base = name
    .replace(/\s/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]/g, '')
    .substring(0, 6);
  const rand = Math.random().toString(36).substring(2, 6);
  return `${base}${rand}`;
}

export default function SetupPage() {
  const router = useRouter();
  const [uid, setUid] = useState('');
  const [userName, setUserName] = useState('');
  const [plan, setPlan] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [companyName, setCompanyName] = useState('');

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) { router.push('/login'); return; }

      const snap = await getDoc(doc(db, 'users', user.uid));
      if (!snap.exists()) { router.push('/login'); return; }

      const data = snap.data();

      // companyId 이미 있으면 홈으로
      if (data.companyId && data.companyId.trim() !== '') {
        router.push('/');
        return;
      }

      // trial이면 홈으로
      const subPlan = data.subscription?.plan || 'trial';
      if (subPlan === 'trial') {
        router.push('/');
        return;
      }

      setUid(user.uid);
      setUserName(data.name || '');
      setPlan(subPlan);
      setLoading(false);
    });
    return () => unsub();
  }, [router]);

  const handleSave = async () => {
    if (!companyName.trim()) {
      setError('회사명을 입력해주세요.');
      return;
    }

    setSaving(true);
    setError('');

    try {
      const companyId = generateCompanyId(companyName);

      await updateDoc(doc(db, 'users', uid), {
        companyId,
        companyDisplayName: companyName.trim(),
        updatedAt: serverTimestamp(),
      });

      // Company 플랜이면 팀 관리로, Pro면 홈으로
      router.push(plan === 'company' ? '/team' : '/');
    } catch {
      setError('저장 중 오류가 발생했어요. 다시 시도해주세요.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-gray-500 text-sm">확인 중...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">

        {/* 헤더 */}
        <div className="bg-gradient-to-r from-blue-600 to-indigo-600 px-8 py-8 text-white text-center">
          <div className="text-5xl mb-3">🏢</div>
          <h1 className="text-2xl font-black mb-1">회사 설정</h1>
          <p className="text-blue-100 text-sm">
            {userName}님, 환영해요!<br />
            회사명을 입력하면 바로 시작할 수 있어요.
          </p>
        </div>

        <div className="px-8 py-6 space-y-5">

          {/* 플랜 뱃지 */}
          <div className={`rounded-xl p-3 text-sm text-center font-semibold ${
            plan === 'company'
              ? 'bg-purple-50 text-purple-700 border border-purple-200'
              : 'bg-blue-50 text-blue-700 border border-blue-200'
          }`}>
            {plan === 'company' ? '🏢 Company 플랜' : '⭐ Pro 플랜'} 으로 이용 중이에요
          </div>

          {/* 회사명 입력 */}
          <div>
            <label className="block text-sm font-bold text-gray-700 mb-1.5">
              회사명 *
            </label>
            <input
              type="text"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSave()}
              placeholder="예: (주)한국엘리베이터"
              className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              autoFocus
            />
            <p className="text-xs text-gray-400 mt-1">
              현장 관리 및 팀 구분에 사용돼요.
            </p>
          </div>

          {/* 안내 */}
          <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 text-xs text-blue-700 space-y-1.5">
            <p className="font-bold text-sm">📌 설정 완료 후 할 수 있어요:</p>
            {plan === 'company' && (
              <p>👥 팀 관리에서 팀을 만들고 초대코드를 발급할 수 있어요</p>
            )}
            <p>🏢 현장 및 호기를 등록하고 관리할 수 있어요</p>
            <p>🔍 점검 현황을 한눈에 모니터링할 수 있어요</p>
            <p>💬 기술 Q&A에 참여할 수 있어요</p>
          </div>

          {plan === 'company' && (
            <div className="bg-purple-50 border border-purple-100 rounded-xl p-3 text-xs text-purple-600">
              💡 회사명 저장 후 <span className="font-bold">팀 관리 페이지</span>로 이동해요.
              거기서 팀을 만들고 팀원 초대코드를 발급할 수 있어요!
            </div>
          )}

          {error && (
            <p className="text-red-500 text-sm text-center">{error}</p>
          )}

          <button
            onClick={handleSave}
            disabled={saving || !companyName.trim()}
            className="w-full bg-blue-600 text-white py-3.5 rounded-xl font-black hover:bg-blue-700 transition disabled:opacity-40 text-base"
          >
            {saving ? '저장 중...' : plan === 'company' ? '저장 후 팀 관리로 →' : '시작하기 →'}
          </button>

          {/* 초대코드로 합류 옵션 */}
<div className="text-center pt-1">
  <p className="text-xs text-gray-400 mb-1.5">이미 회사에 초대받으셨나요?</p>
  <button
    onClick={() => router.push('/join')}
    className="text-sm font-bold text-orange-500 hover:text-orange-600 transition-colors"
  >
    🏢 초대코드로 팀 합류하기
  </button>
</div>

<p className="text-center text-xs text-gray-400">
  나중에 설정하려면{' '}
  <button
    onClick={() => router.push('/')}
    className="text-blue-500 hover:underline"
  >
    건너뛰기
  </button>
</p>


          <p className="text-center text-xs text-gray-400">
            나중에 설정하려면{' '}
            <button
              onClick={() => router.push('/')}
              className="text-blue-500 hover:underline"
            >
              건너뛰기
            </button>
          </p>

        </div>
      </div>
    </div>
  );
}
