'use client';

import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';

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

// ── 메인 컨텐츠 ──────────────────────────────────
function JoinContent() {
  const router      = useRouter();
  const searchParams = useSearchParams();

  const [userInfo, setUserInfo]       = useState<UserInfo | null>(null);
  const [loading, setLoading]         = useState(true);
  const [code, setCode]               = useState('');
  const [step, setStep]               = useState<'input' | 'confirm' | 'done'>('input');
  const [inviteInfo, setInviteInfo]   = useState<InviteInfo | null>(null);
  const [verifying, setVerifying]     = useState(false);
  const [joining, setJoining]         = useState(false);
  const [error, setError]             = useState('');
  const [migrateStatus, setMigrateStatus] = useState('');

  // ── URL 파라미터 자동 입력 ──
  useEffect(() => {
    const codeParam = searchParams.get('code');
    if (codeParam) setCode(codeParam.toUpperCase());
  }, [searchParams]);

  // ── 인증 확인 ──
  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        const codeParam = searchParams.get('code') || '';
        router.push(`/login?redirect=${encodeURIComponent(`/join?code=${codeParam}`)}`);
        return;
      }

      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('name, email, company_id, team, role, subscription, status')  // ← status 추가
        .eq('id', session.user.id)
        .single();

      if (userError || !userData) { router.push('/login'); return; }

      // ★★★ 여기에 새로 추가 ★★★
      if (userData.company_id && userData.status === 'approved') {
        router.replace('/dashboard');
        return;
      }
      // ★★★ 추가 끝 ★★★

      setUserInfo({
        uid:          session.user.id,
        name:         userData.name         || '',
        email:        session.user.email    || '',
        companyId:    userData.company_id   || '',
        team:         userData.team         || '',
        role:         userData.role         || 'member',
        subscription: userData.subscription || { plan: 'trial', status: 'active' },
      });
      setLoading(false);
    };

    init();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => { if (!session) router.push('/login'); }
    );
    return () => subscription.unsubscribe();
  }, [router, searchParams]);

  // ── 초대코드 검증 ──
  const handleVerify = async () => {
    setError('');
    const trimCode = code.trim().toUpperCase();
    if (!trimCode) { setError('초대코드를 입력해주세요.'); return; }

    setVerifying(true);
    try {
      const { data: invRows, error: invError } = await supabase
        .from('invitations')
        .select('*')
        .eq('code', trimCode)
        .eq('status', 'active');

      if (invError) throw invError;
      if (!invRows || invRows.length === 0) {
        setError('유효하지 않거나 만료된 초대코드예요. 관리자에게 새 코드를 요청해주세요.');
        return;
      }

      const inv = invRows[0];
      const expireAt = inv.expire_at ? new Date(inv.expire_at) : null;

      if (expireAt && expireAt < new Date()) {
        setError('만료된 초대코드예요. 관리자에게 새 코드를 요청해주세요.');
        return;
      }
      if ((inv.used_count || 0) >= inv.max_members) {
        setError('초대 가능 인원이 초과됐어요. 관리자에게 문의해주세요.');
        return;
      }

      setInviteInfo({
        docId:              inv.id,
        companyId:          inv.company_id,
        companyDisplayName: inv.company_display_name || inv.company_id,
        teamName:           inv.team_name,
        usedCount:          inv.used_count    || 0,
        maxMembers:         inv.max_members,
        status:             inv.status,
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

  // ── 현장 데이터 자동 이전 ──
  // Pro → Company 합류 시 기존 company_id의 sites를 새 company_id로 재배정
  const migrateSites = async (
    oldCompanyId: string,
    newCompanyId: string,
    teamName: string
  ) => {
    if (!oldCompanyId || oldCompanyId === newCompanyId) return;
    try {
      setMigrateStatus('현장 데이터 이전 중...');

      // 기존 팀 현장 조회
      const { data: siteRows, error: siteError } = await supabase
        .from('sites')
        .select('id')
        .eq('company_id', oldCompanyId)
        .eq('team_name', teamName);

      if (siteError) throw siteError;
      if (!siteRows || siteRows.length === 0) { setMigrateStatus(''); return; }

      let migrated = 0;
      for (const site of siteRows) {
        // sites 테이블의 company_id 재배정
        await supabase
          .from('sites')
          .update({
            company_id:    newCompanyId,
            migrated_from: oldCompanyId,
            migrated_at:   new Date().toISOString(),
          })
          .eq('id', site.id);

        // elevators도 함께 재배정
        await supabase
          .from('elevators')
          .update({ company_id: newCompanyId })
          .eq('site_id', site.id);

        migrated++;
        setMigrateStatus(`현장 이전 중... (${migrated}/${siteRows.length})`);
      }
      setMigrateStatus('');
    } catch (e) {
      console.error('현장 이전 오류:', e);
      setMigrateStatus('');
    }
  };

  // ── 합류 확정 ──
  const handleJoin = async () => {
    if (!userInfo || !inviteInfo) return;
    if (joining) return;
    setJoining(true);
    setError('');

    try {
      // 이미 같은 회사 소속인지 확인
      const { data: freshUser } = await supabase
        .from('users')
        .select('company_id')
        .eq('id', userInfo.uid)
        .single();

      if (freshUser?.company_id === inviteInfo.companyId) {
        setStep('done');
        return;
      }

      // 초대코드 최신 상태 재확인
      const { data: freshInv } = await supabase
        .from('invitations')
        .select('used_count, max_members')
        .eq('id', inviteInfo.docId)
        .single();

      if (!freshInv || (freshInv.used_count || 0) >= freshInv.max_members) {
        setError('초대 가능 인원이 초과됐어요. 관리자에게 문의해주세요.');
        return;
      }

      const wasPro       = userInfo.subscription?.plan === 'pro';
      const oldCompanyId = userInfo.companyId;

      // Pro 사용자였으면 현장 자동 이전
      if (wasPro && oldCompanyId && oldCompanyId !== inviteInfo.companyId) {
        await migrateSites(oldCompanyId, inviteInfo.companyId, inviteInfo.teamName);
      }

      // 유저 정보 업데이트
      const now = new Date().toISOString();
      const { error: updateError } = await supabase
        .from('users')
        .update({
          company_id:          inviteInfo.companyId,
          company_display_name: inviteInfo.companyDisplayName,
          team:                inviteInfo.teamName,
          role:                'member',
          joined_at:           now,
          updated_at:          now,
          subscription: {
            plan:          'company',
            status:        'active',
            moved_from_pro: wasPro,
            start_date:    now,
          },
        })
        .eq('id', userInfo.uid);

      if (updateError) throw updateError;

      // 초대코드 used_count 증가
      await supabase.rpc('increment_invitation_used_count', {
        invitation_id: inviteInfo.docId,
      });

      setStep('done');
    } catch (e) {
      console.error(e);
      setError('합류 처리 중 오류가 발생했어요. 다시 시도해주세요.');
    } finally {
      setJoining(false);
    }
  };

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-gray-500 text-sm">확인 중...</p>
      </div>
    </div>
  );

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
              onChange={e => { setCode(e.target.value.toUpperCase()); setError(''); }}
              onKeyDown={e => e.key === 'Enter' && handleVerify()}
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
                <span className="text-sm font-bold text-gray-900">{inviteInfo.companyDisplayName}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-500">팀명</span>
                <span className="text-sm font-bold text-blue-700">{inviteInfo.teamName}</span>
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

            <div className="bg-yellow-50 border border-yellow-100 rounded-xl p-3 mb-5">
              <p className="text-xs text-yellow-700">
                ⚠️ 합류 후에는 현재 계정이 위 회사 / 팀으로 자동 연결됩니다.
                기존 소속 정보는 새 회사/팀으로 덮어써집니다.
              </p>
              {userInfo?.subscription?.plan === 'pro' && (
                <p className="text-xs text-orange-600 mt-2 font-semibold">
                  📱 Pro 구독 중이시네요! 팀 합류 후 앱(App Store / Google Play)에서
                  Pro 구독을 직접 취소해주세요. 취소하지 않으면 중복 결제될 수 있어요.
                  <br />✅ 기존 등록하신{' '}
                  <span className="text-blue-600">{inviteInfo.teamName}</span> 팀 현장은 자동으로 이전돼요!
                </p>
              )}
            </div>

            {migrateStatus && (
              <div className="mb-4 p-3 bg-blue-50 border border-blue-100 rounded-xl">
                <p className="text-sm text-blue-600 flex items-center gap-2">
                  <span className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                  {migrateStatus}
                </p>
              </div>
            )}

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
                    {migrateStatus || '처리 중...'}
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

// ── 페이지 래퍼 (Suspense) ──
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
