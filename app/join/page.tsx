'use client';

import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { auth, db } from '@/lib/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import {
  collection,
  query,
  where,
  getDocs,
  doc,
  updateDoc,
  serverTimestamp,
  increment,
} from 'firebase/firestore';

interface UserInfo {
  uid: string;
  name: string;
  email: string;
  companyId: string;
  team: string;
  role: string;
  subscription: { plan: string; status: string };
}

interface InviteInfo {
  docId: string;
  companyId: string;
  companyDisplayName: string;
  teamName: string;
  usedCount: number;
  maxMembers: number;
  status: string;
  expireAt: Date | null;
}

// ─── useSearchParams는 Suspense 안에서만 사용 가능 ───
function JoinContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(true);

  const [code, setCode] = useState('');
  const [step, setStep] = useState<'input' | 'confirm' | 'done'>('input');

  const [inviteInfo, setInviteInfo] = useState<InviteInfo | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState('');

  // ─── URL 파라미터 자동 입력 ───
  useEffect(() => {
    const codeParam = searchParams.get('code');
    if (codeParam) {
      setCode(codeParam.toUpperCase());
    }
  }, [searchParams]);

  // ─── 인증 확인 ───
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        const code = searchParams.get('code') || '';
        router.push(`/login?redirect=${encodeURIComponent(`/join?code=${code}`)}`);
        return;
      }

      try {
        const { getDoc } = await import('firebase/firestore');
        const snap = await getDoc(doc(db, 'users', user.uid));
        if (!snap.exists()) {
          router.push('/login');
          return;
        }
        const data = snap.data();

        // ✅ 차단 로직 제거 — 덮어쓰기 허용
        setUserInfo({
          uid: user.uid,
          name: data.name || data.displayName || '',
          email: user.email || '',
          companyId: data.companyId || '',
          team: data.team || '',
          role: data.role || 'member',
          subscription: data.subscription || { plan: 'trial', status: 'active' },
        });
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    });
    return () => unsub();
  }, [router, searchParams]);

  // ─── 초대코드 검증 ───
  const handleVerify = async () => {
    setError('');
    const trimCode = code.trim().toUpperCase();
    if (!trimCode) {
      setError('초대코드를 입력해주세요.');
      return;
    }

    setVerifying(true);
    try {
      const q = query(
        collection(db, 'invitations'),
        where('code', '==', trimCode),
        where('status', '==', 'active')
      );
      const snap = await getDocs(q);

      if (snap.empty) {
        setError('유효하지 않거나 만료된 초대코드예요. 관리자에게 새 코드를 요청해주세요.');
        setVerifying(false);
        return;
      }

      const invDoc = snap.docs[0];
      const data = invDoc.data();

      // 만료일 확인
      const expireAt = data.expireAt?.toDate ? data.expireAt.toDate() : null;
      if (expireAt && expireAt < new Date()) {
        setError('만료된 초대코드예요. 관리자에게 새 코드를 요청해주세요.');
        setVerifying(false);
        return;
      }

      // 인원 초과 확인
      if (data.usedCount >= data.maxMembers) {
        setError('초대 가능 인원이 초과됐어요. 관리자에게 문의해주세요.');
        setVerifying(false);
        return;
      }

      setInviteInfo({
        docId: invDoc.id,
        companyId: data.companyId,
        companyDisplayName: data.companyDisplayName || data.companyId,
        teamName: data.teamName,
        usedCount: data.usedCount || 0,
        maxMembers: data.maxMembers,
        status: data.status,
        expireAt,
      });
      setStep('confirm');
    } catch (e) {
      console.error(e);
      setError('초대코드 확인 중 오류가 발생했어요. 다시 시도해주세요.');
    } finally {
      setVerifying(false);
    }
  };

  // ─── 합류 확정 ───
  const handleJoin = async () => {
    if (!userInfo || !inviteInfo) return;
    setJoining(true);
    setError('');

    try {
      // ✅ Pro 구독자면 company 플랜으로 자동 전환
      const isPro = userInfo.subscription?.plan === 'pro';

      await updateDoc(doc(db, 'users', userInfo.uid), {
        companyId: inviteInfo.companyId,
        companyDisplayName: inviteInfo.companyDisplayName,
        team: inviteInfo.teamName,
        role: 'member',
        joinedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        ...(isPro && {
          subscription: {
            plan: 'company',
            status: 'active',
            movedFromPro: true,
          },
        }),
      });

      await updateDoc(doc(db, 'invitations', inviteInfo.docId), {
        usedCount: increment(1),
      });

      setStep('done');
    } catch (e) {
      console.error(e);
      setError('합류 처리 중 오류가 발생했어요. 다시 시도해주세요.');
    } finally {
      setJoining(false);
    }
  };

  // ─── 로딩 ───
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-gray-500 text-sm">확인 중...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50 flex items-center justify-center px-4">
      <div className="w-full max-w-md">

        {/* 로고 */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg">
            <span className="text-2xl">🏢</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">팀 합류</h1>
          <p className="text-gray-500 text-sm mt-1">관리자에게 받은 초대코드를 입력하세요</p>
        </div>

        {/* ── STEP 1: 코드 입력 ── */}
        {step === 'input' && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">

            {userInfo && (
              <div className="bg-gray-50 rounded-xl p-3 mb-5 flex items-center gap-3">
                <div className="w-9 h-9 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 font-bold text-sm">
                  {userInfo.name?.charAt(0) || '?'}
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-800">{userInfo.name}</p>
                  <p className="text-xs text-gray-500">{userInfo.email}</p>
                </div>
                <span className="ml-auto text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-full font-medium">
                  {userInfo.subscription?.plan?.toUpperCase() || 'FREE'}
                </span>
              </div>
            )}

            {/* URL로 코드 자동 입력됐을 때 안내 */}
            {searchParams.get('code') && (
              <div className="bg-green-50 border border-green-100 rounded-xl p-3 mb-4">
                <p className="text-xs text-green-700 text-center">
                  ✅ 초대링크로 접속했어요! 아래 코드를 확인하고 코드 확인을 눌러주세요.
                </p>
              </div>
            )}

            <label className="block text-sm font-medium text-gray-700 mb-2">
              초대코드
            </label>
            <input
              type="text"
              value={code}
              onChange={(e) => {
                setCode(e.target.value.toUpperCase());
                setError('');
              }}
              onKeyDown={(e) => e.key === 'Enter' && handleVerify()}
              placeholder="예: ABC123"
              maxLength={10}
              className="w-full px-4 py-3 border border-gray-200 rounded-xl text-center text-xl font-bold tracking-widest focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all uppercase"
            />

            {error && (
              <div className="mt-3 p-3 bg-red-50 border border-red-100 rounded-xl">
                <p className="text-sm text-red-600">⚠️ {error}</p>
              </div>
            )}

            <button
              onClick={handleVerify}
              disabled={verifying || !code.trim()}
              className="w-full mt-4 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white font-semibold rounded-xl transition-colors"
            >
              {verifying ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  확인 중...
                </span>
              ) : '코드 확인'}
            </button>

            <p className="text-center text-xs text-gray-400 mt-4">
              초대코드는 관리자에게 요청하세요
            </p>
          </div>
        )}

        {/* ── STEP 2: 합류 확인 ── */}
        {step === 'confirm' && inviteInfo && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            <div className="text-center mb-6">
              <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
                <span className="text-2xl">✅</span>
              </div>
              <p className="text-sm text-gray-500">유효한 초대코드예요!</p>
            </div>

            <div className="bg-blue-50 rounded-xl p-4 mb-5 space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-500">회사명</span>
                <span className="text-sm font-bold text-gray-900">
                  {inviteInfo.companyDisplayName}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-500">팀명</span>
                <span className="text-sm font-bold text-blue-700">
                  {inviteInfo.teamName}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-500">잔여 초대 인원</span>
                <span className="text-sm font-medium text-gray-700">
                  {inviteInfo.maxMembers - inviteInfo.usedCount}명 남음
                </span>
              </div>
              {inviteInfo.expireAt && (
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-500">만료일</span>
                  <span className="text-sm text-gray-700">
                    {inviteInfo.expireAt.toLocaleDateString('ko-KR')}
                  </span>
                </div>
              )}
            </div>

            {/* ✅ 안내 문구 */}
            <div className="bg-yellow-50 border border-yellow-100 rounded-xl p-3 mb-5">
              <p className="text-xs text-yellow-700">
                ⚠️ 합류 후에는 현재 계정이 위 회사 / 팀으로 자동 연결됩니다.
                기존 소속 정보는 새 회사/팀으로 덮어써집니다.
              </p>
              {/* ✅ Pro 구독자 안내 */}
              {userInfo?.subscription?.plan === 'pro' && (
                <p className="text-xs text-orange-600 mt-2 font-semibold">
                  📱 Pro 구독 중이시네요! 팀 합류 후 앱(App Store / Google Play)에서
                  Pro 구독을 직접 취소해주세요. 취소하지 않으면 중복 결제될 수 있어요.
                </p>
              )}
            </div>

            {error && (
              <div className="mb-3 p-3 bg-red-50 border border-red-100 rounded-xl">
                <p className="text-sm text-red-600">⚠️ {error}</p>
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => { setStep('input'); setError(''); }}
                className="flex-1 py-3 border border-gray-200 text-gray-600 font-medium rounded-xl hover:bg-gray-50 transition-colors"
              >
                다시 입력
              </button>
              <button
                onClick={handleJoin}
                disabled={joining}
                className="flex-1 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white font-semibold rounded-xl transition-colors"
              >
                {joining ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    처리 중...
                  </span>
                ) : '팀 합류하기'}
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 3: 완료 ── */}
        {step === 'done' && inviteInfo && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 text-center">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <span className="text-3xl">🎉</span>
            </div>
            <h2 className="text-xl font-bold text-gray-900 mb-2">합류 완료!</h2>
            <p className="text-gray-500 text-sm mb-1">
              <span className="font-semibold text-blue-600">{inviteInfo.companyDisplayName}</span>
            </p>
            <p className="text-gray-500 text-sm mb-6">
              <span className="font-semibold text-purple-600">{inviteInfo.teamName}</span> 팀에 합류했어요!
            </p>

            <div className="bg-gray-50 rounded-xl p-4 mb-6 text-left space-y-2">
              <p className="text-xs text-gray-500">✅ 이제 팀 점검 현황을 함께 확인할 수 있어요</p>
              <p className="text-xs text-gray-500">✅ 팀원들과 동일한 현장 정보를 공유해요</p>
              <p className="text-xs text-gray-500">✅ 기존 사용하던 기능은 그대로 유지돼요</p>
            </div>

            <button
              onClick={() => router.push('/')}
              className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition-colors"
            >
              홈으로 이동
            </button>
          </div>
        )}

        {/* 뒤로가기 */}
        {step === 'input' && (
          <p className="text-center mt-4">
            <button
              onClick={() => router.push('/')}
              className="text-sm text-gray-400 hover:text-gray-600 transition-colors"
            >
              ← 홈으로 돌아가기
            </button>
          </p>
        )}

      </div>
    </div>
  );
}

// ─── Suspense 래핑 필수 (useSearchParams 때문) ───
export default function JoinPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <JoinContent />
    </Suspense>
  );
}
