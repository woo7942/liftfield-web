'use client';

import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';

interface UserInfo {
  uid: string; name: string; email: string; companyId: string;
  team: string; role: string; subscriptionPlan: string;
}

interface InviteInfo {
  docId: string; companyId: string; companyDisplayName: string;
  teamName: string; usedCount: number; maxMembers: number;
}

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

  useEffect(() => {
    const codeParam = searchParams.get('code');
    if (codeParam) setCode(codeParam.toUpperCase());
  }, [searchParams]);

  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        const codeParam = searchParams.get('code') || '';
        router.push(`/login?redirect=${encodeURIComponent(`/join?code=${codeParam}`)}`);
        return;
      }

      const { data } = await supabase.from('users').select('*').eq('id', user.id).single();
      if (!data) { router.push('/login'); return; }

      setUserInfo({
        uid: user.id,
        name: data.name || '',
        email: user.email || '',
        companyId: data.company_id || '',
        team: data.team || '',
        role: data.role || 'member',
        subscriptionPlan: data.subscription_plan || 'trial',
      });
      setLoading(false);
    };
    init();
  }, [router, searchParams]);

  const handleVerify = async () => {
    setError('');
    const trimCode = code.trim().toUpperCase();
    if (!trimCode) { setError('초대코드를 입력해주세요.'); return; }

    setVerifying(true);
    try {
      const { data, error: err } = await supabase
        .from('invitations')
        .select('*')
        .eq('code', trimCode)
        .eq('used', false)
        .single();

      if (err || !data) {
        setError('유효하지 않거나 만료된 초대코드예요. 관리자에게 새 코드를 요청해주세요.');
        return;
      }

      // 회사 이름 조회
      const { data: companyData } = await supabase
        .from('companies')
        .select('display_name, name')
        .eq('id', data.company_id)
        .single();

      setInviteInfo({
        docId: data.id,
        companyId: data.company_id,
        companyDisplayName: companyData?.display_name || companyData?.name || data.company_id,
        teamName: data.team_name || '',
        usedCount: data.used_count || 0,
        maxMembers: data.max_members || 10,
      });
      setStep('confirm');
    } catch {
      setError('초대코드 확인 중 오류가 발생했어요. 다시 시도해주세요.');
    } finally {
      setVerifying(false);
    }
  };

  const handleJoin = async () => {
    if (!userInfo || !inviteInfo || joining) return;
    setJoining(true);
    setError('');

    try {
      const now = new Date().toISOString();

      await supabase.from('users').update({
        company_id: inviteInfo.companyId,
        company_display_name: inviteInfo.companyDisplayName,
        team: inviteInfo.teamName,
        role: 'member',
        subscription_plan: 'company',
        subscription_status: 'active',
      }).eq('id', userInfo.uid);

      await supabase.from('invitations').update({ used: true, used_by: userInfo.uid }).eq('id', inviteInfo.docId);

      setStep('done');
    } catch {
      setError('합류 처리 중 오류가 발생했어요. 다시 시도해주세요.');
    } finally {
      setJoining(false);
    }
  };

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
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg">
            <span className="text-2xl">🏢</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">팀 합류</h1>
          <p className="text-gray-500 text-sm mt-1">관리자에게 받은 초대코드를 입력하세요</p>
        </div>

        {/* STEP 1: 코드 입력 */}
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
                  {userInfo.subscriptionPlan?.toUpperCase() || 'FREE'}
                </span>
              </div>
            )}
            <label className="block text-sm font-medium text-gray-700 mb-2">초대코드</label>
            <input type="text" value={code} onChange={e => { setCode(e.target.value.toUpperCase()); setError(''); }}
              onKeyDown={e => e.key === 'Enter' && handleVerify()} placeholder="예: ABC123" maxLength={10}
              className="w-full px-4 py-3 border border-gray-200 rounded-xl text-center text-xl font-bold tracking-widest focus:outline-none focus:ring-2 focus:ring-blue-500 uppercase" />
            {error && (
              <div className="mt-3 p-3 bg-red-50 border border-red-100 rounded-xl">
                <p className="text-sm text-red-600">⚠️ {error}</p>
              </div>
            )}
            <button onClick={handleVerify} disabled={verifying || !code.trim()}
              className="w-full mt-4 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white font-semibold rounded-xl transition-colors">
              {verifying ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  확인 중...
                </span>
              ) : '코드 확인'}
            </button>
          </div>
        )}

        {/* STEP 2: 합류 확인 */}
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
                <span className="text-sm font-bold text-gray-900">{inviteInfo.companyDisplayName}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-500">팀명</span>
                <span className="text-sm font-bold text-blue-700">{inviteInfo.teamName}</span>
              </div>
            </div>
            <div className="bg-yellow-50 border border-yellow-100 rounded-xl p-3 mb-5">
              <p className="text-xs text-yellow-700">⚠️ 합류 후에는 현재 계정이 위 회사/팀으로 자동 연결됩니다.</p>
            </div>
            {error && (
              <div className="mb-3 p-3 bg-red-50 border border-red-100 rounded-xl">
                <p className="text-sm text-red-600">⚠️ {error}</p>
              </div>
            )}
            <div className="flex gap-3">
              <button onClick={() => { setStep('input'); setError(''); }}
                className="flex-1 py-3 border border-gray-200 text-gray-600 font-medium rounded-xl hover:bg-gray-50 transition-colors">다시 입력</button>
              <button onClick={handleJoin} disabled={joining}
                className="flex-1 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white font-semibold rounded-xl transition-colors">
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

        {/* STEP 3: 완료 */}
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
            <button onClick={() => router.push('/')} className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition-colors">
              홈으로 이동
            </button>
          </div>
        )}

        {step === 'input' && (
          <p className="text-center mt-4">
            <button onClick={() => router.push('/')} className="text-sm text-gray-400 hover:text-gray-600 transition-colors">
              ← 홈으로 돌아가기
            </button>
          </p>
        )}
      </div>
    </div>
  );
}

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
