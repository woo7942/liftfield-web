'use client';

import { signInWithEmailAndPassword } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, Suspense } from 'react';
import { auth, db } from '@/lib/firebase';

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const userCred = await signInWithEmailAndPassword(auth, email, password);
      const uid = userCred.user.uid;

      const userSnap = await getDoc(doc(db, 'users', uid));
      if (!userSnap.exists()) {
        setError('사용자 정보를 찾을 수 없습니다.');
        setLoading(false);
        return;
      }

      const userData = userSnap.data();

      // ✅ 슈퍼어드민, 관리자, 멤버 모두 접근 가능 (trial 제외)
      const plan = userData.subscription?.plan || 'trial';
      const isSuperAdmin = userData.superAdmin === true;
      const isAdmin = userData.role === 'admin';
      const isMember = userData.role === 'member';
      const isPro = plan === 'pro' && userData.subscription?.status === 'active';
      const isCompany = plan === 'company' && userData.subscription?.status === 'active';

      if (!isSuperAdmin && !isAdmin && !isMember && !isPro && !isCompany) {
        setError('접근 권한이 없습니다.');
        await auth.signOut();
        setLoading(false);
        return;
      }

      // ✅ redirect 파라미터 있으면 해당 페이지로 이동
      const redirectUrl = searchParams.get('redirect') || '/';
      router.push(redirectUrl);

    } catch (e: any) {
      if (
        e.code === 'auth/user-not-found' ||
        e.code === 'auth/wrong-password' ||
        e.code === 'auth/invalid-credential'
      ) {
        setError('이메일 또는 비밀번호가 올바르지 않습니다.');
      } else {
        setError('로그인 중 오류가 발생했습니다.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-lg w-full max-w-md p-8">

        {/* 로고 */}
        <div className="text-center mb-8">
          <div className="text-4xl mb-3">🛗</div>
          <h1 className="text-2xl font-bold text-gray-900">LiftField</h1>
          <p className="text-gray-500 text-sm mt-1">승강기 관리 시스템</p>
        </div>

        {/* redirect 안내 배너 */}
        {searchParams.get('redirect') && (
          <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 mb-4">
            <p className="text-xs text-blue-700 text-center">
              🔐 로그인 후 초대 페이지로 자동 이동돼요!
            </p>
          </div>
        )}

        {/* 로그인 폼 */}
        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              이메일
            </label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="이메일 입력"
              className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              비밀번호
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="비밀번호 입력"
              className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              required
            />
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3">
              <p className="text-red-600 text-sm">{error}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold py-3 rounded-xl transition-colors"
          >
            {loading ? '로그인 중...' : '로그인'}
          </button>
        </form>

        <p className="text-center text-xs text-gray-400 mt-6">
          LiftField 웹 대시보드
        </p>
      </div>
    </div>
  );
}

// ✅ Suspense 래핑 필수 (useSearchParams 때문)
export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <LoginContent />
    </Suspense>
  );
}
