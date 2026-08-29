'use client';

import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { completeOnboarding } from '@/lib/onboarding';

interface InvitePreview {
  companyDisplayName: string;
  teamName: string;
  remaining: number;
}

function SignupContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const codeParam = (searchParams.get('code') || '').toUpperCase();

  const [invitePreview, setInvitePreview] = useState<InvitePreview | null>(null);
  const [inviteError, setInviteError] = useState('');
  const [checkingInvite, setCheckingInvite] = useState(!!codeParam);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [agreeMarketing, setAgreeMarketing] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [needsEmailConfirm, setNeedsEmailConfirm] = useState(false);

  useEffect(() => {
    if (!codeParam) { setCheckingInvite(false); return; }
    const check = async () => {
      const { data, error: err } = await supabase
        .from('invitations')
        .select('*')
        .eq('code', codeParam)
        .eq('status', 'active');

      if (err || !data || data.length === 0) {
        setInviteError('유효하지 않거나 만료된 초대코드예요.');
        setCheckingInvite(false);
        return;
      }
      const inv = data[0];
      const expireAt = inv.expire_at ? new Date(inv.expire_at) : null;
      if (expireAt && expireAt < new Date()) {
        setInviteError('만료된 초대코드예요. 관리자에게 새 코드를 요청해주세요.');
        setCheckingInvite(false);
        return;
      }
      if ((inv.used_count || 0) >= inv.max_members) {
        setInviteError('초대 가능 인원이 초과됐어요.');
        setCheckingInvite(false);
        return;
      }
      setInvitePreview({
        companyDisplayName: inv.company_display_name || inv.company_id,
        teamName: inv.team_name,
        remaining: inv.max_members - (inv.used_count || 0),
      });
      setCheckingInvite(false);
    };
    check();
  }, [codeParam]);

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!name.trim()) { setError('이름을 입력해주세요.'); return; }
    if (!email.trim()) { setError('이메일을 입력해주세요.'); return; }
    if (password.length < 6) { setError('비밀번호는 6자 이상 입력해주세요.'); return; }
    if (password !== password2) { setError('비밀번호가 일치하지 않아요.'); return; }
    if (!codeParam && !companyName.trim()) { setError('회사명을 입력해주세요.'); return; }
    if (codeParam && inviteError) { setError(inviteError); return; }

    setLoading(true);
    try {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: {
            name: name.trim(),
            pending_invite_code: codeParam || null,
            pending_company_name: !codeParam ? companyName.trim() : null,
            pending_phone: phone.trim() || null,
            pending_agree_marketing: agreeMarketing,
          },
        },
      });

      if (signUpError) {
        if (signUpError.message.includes('already registered') || signUpError.message.includes('User already')) {
          setError('이미 가입된 이메일이에요. 로그인해주세요.');
        } else {
          setError('가입 중 오류가 발생했어요: ' + signUpError.message);
        }
        return;
      }

       // Supabase는 이미 가입 + 인증 완료된 이메일로 signUp을 호출해도
      // 에러 없이 성공한 것처럼 응답하면서 identities를 빈 배열로 돌려준다.
      if (data.user && data.user.identities && data.user.identities.length === 0) {
        setError('이미 가입된 이메일이에요. 로그인해주세요.');
        return;
      }

      const uid = data.user?.id;
      if (!uid) { setError('계정 생성에 실패했어요. 다시 시도해주세요.'); return; }

      if (!data.session) {
        setNeedsEmailConfirm(true);
        return;
      }

      await completeOnboarding(uid, email.trim(), {
        name: name.trim(),
        phone: phone.trim(),
        pending_invite_code: codeParam || null,
        pending_company_name: !codeParam ? companyName.trim() : null,
        agree_marketing: agreeMarketing,
      });

      router.push('/dashboard');
    } catch (e: any) {
      setError(e.message || '가입 처리 중 오류가 발생했어요.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-lg w-full max-w-md p-8">

        <div className="text-center mb-6">
          <div className="text-4xl mb-3">🛗</div>
          <h1 className="text-2xl font-bold text-gray-900">LiftField 회원가입</h1>
          <p className="text-gray-500 text-sm mt-1">
            {codeParam ? '초대받은 팀에 합류해요' : '새 회사 계정을 만들어요'}
          </p>
        </div>

        {checkingInvite && (
          <div className="bg-gray-50 rounded-xl p-3 mb-4 text-center text-sm text-gray-400">
            초대코드 확인 중...
          </div>
        )}

        {!checkingInvite && codeParam && invitePreview && (
          <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 mb-5 space-y-1.5">
            <p className="text-xs text-blue-500 font-semibold">✅ 유효한 초대코드예요</p>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">회사명</span>
              <span className="font-bold text-gray-900">{invitePreview.companyDisplayName}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">팀명</span>
              <span className="font-bold text-blue-700">{invitePreview.teamName}</span>
            </div>
          </div>
        )}

        {!checkingInvite && codeParam && inviteError && (
          <div className="bg-red-50 border border-red-100 rounded-xl p-3 mb-5">
            <p className="text-sm text-red-600">⚠️ {inviteError}</p>
          </div>
        )}

        {needsEmailConfirm ? (
          <div className="bg-green-50 border border-green-100 rounded-xl p-5 text-center">
            <p className="text-2xl mb-2">📧</p>
            <p className="text-sm text-gray-700 font-semibold mb-1">인증 메일을 보냈어요!</p>
            <p className="text-xs text-gray-500">
              {email}로 전송된 링크를 눌러 인증을 완료하시면{codeParam ? ' 자동으로 팀에 합류돼요.' : ' 바로 로그인해서 시작할 수 있어요.'}
            </p>
            <button
              onClick={() => router.push('/login')}
              className="w-full mt-4 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition-colors"
            >
              로그인 화면으로
            </button>
          </div>
        ) : (
          <form onSubmit={handleSignup} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">이름 *</label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>

            {!codeParam && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">회사명 *</label>
                <input
                  type="text"
                  value={companyName}
                  onChange={e => setCompanyName(e.target.value)}
                  placeholder="예: 우정승강기"
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">이메일 *</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">휴대폰</label>
              <input
                type="tel"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                placeholder="선택 입력"
                className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">비밀번호 *</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="6자 이상"
                className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">비밀번호 확인 *</label>
              <input
                type="password"
                value={password2}
                onChange={e => setPassword2(e.target.value)}
                className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>

            <label className="flex items-center gap-2 text-xs text-gray-500">
              <input
                type="checkbox"
                checked={agreeMarketing}
                onChange={e => setAgreeMarketing(e.target.checked)}
              />
              마케팅 정보 수신에 동의합니다 (선택)
            </label>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                <p className="text-red-600 text-sm">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading || (!!codeParam && (checkingInvite || !!inviteError))}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold py-3 rounded-xl transition-colors"
            >
              {loading ? '가입 처리 중...' : '가입하기'}
            </button>
          </form>
        )}

        <p className="text-center text-xs text-gray-400 mt-6">
          이미 계정이 있으신가요?{' '}
          <button
            onClick={() => router.push(codeParam ? `/login?redirect=${encodeURIComponent(`/join?code=${codeParam}`)}` : '/login')}
            className="text-blue-500 hover:underline"
          >
            로그인
          </button>
        </p>
      </div>
    </div>
  );
}

export default function SignupPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <SignupContent />
    </Suspense>
  );
}
