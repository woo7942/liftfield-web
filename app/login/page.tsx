'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState, Suspense } from 'react';
import { supabase } from '@/lib/supabase';
import { completeOnboarding } from '@/lib/onboarding';

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
      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (authError) {
        setError('이메일 또는 비밀번호가 올바르지 않습니다.');
        return;
      }

      const uid = data.user?.id;
      if (!uid) { setError('로그인 정보를 확인할 수 없습니다.'); return; }

      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('*')
        .eq('id', uid)
        .single();

      if (userError || !userData) {
        // 프로필이 아직 없음 → 이메일 인증 후 첫 로그인일 가능성이 높음
        const meta: any = data.user?.user_metadata || {};
        if (meta.pending_invite_code || meta.pending_company_name) {
          try {
            await completeOnboarding(uid, data.user?.email || email, {
              name: meta.name,
              phone: meta.pending_phone,
              pending_invite_code: meta.pending_invite_code,
              pending_company_name: meta.pending_company_name,
              agree_marketing: meta.pending_agree_marketing,
            });
            router.push('/dashboard');
            return;
          } catch (e: any) {
            setError(e.message || '가입 처리 중 오류가 발생했어요.');
            await supabase.auth.signOut();
            return;
          }
        }
        setError('사용자 정보를 찾을 수 없습니다.');
        await supabase.auth.signOut();
        return;
      }

      const isSuperAdmin = userData.super_admin === true;
      const isAdmin = userData.role === 'admin';
      const isMember = userData.role === 'member';

      const redirectUrl = searchParams.get('redirect') || '/dashboard';
      if (redirectUrl.startsWith('/join')) {
        router.push(redirectUrl);
        return;
      }

      if (!isSuperAdmin && !isAdmin && !isMember) {
        setError('접근 권한이 없습니다.');
        await supabase.auth.signOut();
        return;
      }

      router.push(redirectUrl);

    } catch (e: any) {
      setError('로그인 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-lg w-full max-w-md p-8">

        <div className="text-center mb-8">
          <div className="text-4xl mb-3">🛗</div>
          <h1 className="text-2xl font-bold text-gray-900">LiftField</h1>
          <p className="text-gray-500 text-sm mt-1">엘리베이터 관리 시스템</p>
        </div>

        {searchParams.get('redirect') && (
          <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 mb-4">
            <p className="text-xs text-blue-700 text-center">
              먼저 로그인 후 해당 페이지로 자동 이동합니다!
            </p>
          </div>
        )}

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
          계정이 없으신가요?{' '}
          <button
            onClick={() => {
              const redirect = searchParams.get('redirect') || '';
              const codeMatch = redirect.match(/code=([^&]+)/);
              const code = codeMatch ? codeMatch[1] : '';
              router.push(code ? `/signup?code=${code}` : '/signup');
            }}
            className="text-blue-500 hover:underline"
          >
            회원가입
          </button>
        </p>
      </div>
    </div>
  );
}

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
