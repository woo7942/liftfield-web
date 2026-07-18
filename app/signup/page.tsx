'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

// ───────────────────────────────────────────
// 상수
// ───────────────────────────────────────────
const PLANS = [
  { id: 'trial',   name: '체험판', price: '무료',         desc: '14일 무료 체험',          color: 'gray'   },
  { id: 'pro',     name: 'Pro',    price: '₩9,900/월',    desc: '개인 사용자용',           color: 'blue'   },
  { id: 'company', name: 'Company',price: '₩60,000~/월',  desc: '팀 관리 + 전체 대시보드', color: 'purple' },
];

const PLAN_MEMBERS = [5, 10, 15, 20, 30, 50];

function calcCompanyPrice(members: number) {
  const base = 9900 * members;
  const webFee = 10000;
  let discount = 0;
  if (members >= 50) discount = 0.2;
  else if (members >= 30) discount = 0.15;
  else if (members >= 20) discount = 0.1;
  else if (members >= 10) discount = 0.05;
  return Math.round((base * (1 - discount) + webFee) / 100) * 100;
}

function defaultPermissions(plan: string) {
  const isTrial = plan === 'trial';
  return {
    dashboard: true, inspection: true, exam: true,
    error: !isTrial, materialRequest: !isTrial,
    fault: !isTrial, chat: !isTrial, quotes: !isTrial,
  };
}

// ───────────────────────────────────────────
// 컴포넌트
// ───────────────────────────────────────────
export default function SignupPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);

  // Step 1
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');

  // 초대코드
  const [inviteMode, setInviteMode] = useState(false);
  const [inviteCode, setInviteCode] = useState('');
  const [inviteInfo, setInviteInfo] = useState<{
    docId: string; companyId: string; teamName: string;
    ownerName: string; maxMembers: number; usedCount: number;
  } | null>(null);
  const [inviteMsg, setInviteMsg] = useState('');

  // Step 2
  const [selectedPlan, setSelectedPlan] = useState<'trial' | 'pro' | 'company'>('trial');
  const [companyName, setCompanyName] = useState('');
  const [selectedMembers, setSelectedMembers] = useState(5);

  // Step 3
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [agreePrivacy, setAgreePrivacy] = useState(false);
  const [agreeMarketing, setAgreeMarketing] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  // ── 초대코드 확인 ──
  const checkInviteCode = async () => {
    if (!inviteCode.trim()) return;
    setInviteMsg('확인 중...');
    try {
      const { data, error: err } = await supabase
        .from('invitations')
        .select('*')
        .eq('code', inviteCode.trim().toUpperCase())
        .eq('used', false)
        .single();

      if (err || !data) {
        setInviteMsg('❌ 유효하지 않은 초대코드예요.');
        setInviteInfo(null);
        return;
      }

      setInviteInfo({
        docId: data.id,
        companyId: data.company_id,
        teamName: data.team_name || '',
        ownerName: data.owner_name || '',
        maxMembers: data.max_members || 10,
        usedCount: data.used_count || 0,
      });
      setInviteMsg(`✅ 확인됐어요! [${data.team_name}] 팀`);
    } catch {
      setInviteMsg('❌ 오류가 발생했어요. 다시 시도해주세요.');
    }
  };

  const validateStep1 = () => {
    if (!name.trim()) return '이름을 입력해주세요.';
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return '올바른 이메일을 입력해주세요.';
    if (!phone.trim()) return '휴대폰 번호를 입력해주세요.';
    if (password.length < 6) return '비밀번호는 6자 이상이어야 해요.';
    if (password !== passwordConfirm) return '비밀번호가 일치하지 않아요.';
    if (inviteMode && !inviteInfo) return '초대코드를 확인해주세요.';
    return null;
  };

  const validateStep2 = () => {
    if (selectedPlan === 'company' && !companyName.trim()) return '회사명을 입력해주세요.';
    return null;
  };

  // ── 최종 제출 ──
  const handleSubmit = async () => {
    if (!agreeTerms || !agreePrivacy) { setError('필수 약관에 동의해주세요.'); return; }
    setLoading(true);
    setError('');

    try {
      // 1) Supabase Auth 회원가입
      const { data: authData, error: signUpError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: { data: { name: name.trim() } },
      });

      if (signUpError || !authData.user) throw new Error(signUpError?.message || '회원가입 실패');
      const uid = authData.user.id;
      const now = new Date().toISOString();

      // ── 초대코드로 가입 ──
      if (inviteMode && inviteInfo) {
        const endDate = new Date();
        endDate.setFullYear(endDate.getFullYear() + 1);

        await supabase.from('users').insert({
          id: uid,
          email: email.trim(),
          name: name.trim(),
          phone: phone.trim(),
          role: 'member',
          team: inviteInfo.teamName,
          status: 'approved',
          company_id: inviteInfo.companyId,
          super_admin: false,
          subscription_plan: 'company',
          subscription_status: 'active',
          subscription_is_pro: true,
          subscription_start_date: now,
          subscription_end_date: endDate.toISOString(),
          created_at: now,
          created_from: 'web',
        });

        // 초대코드 사용 처리
        await supabase.from('invitations').update({ used: true, used_by: uid }).eq('id', inviteInfo.docId);

        setDone(true);
        return;
      }

      // ── 일반 가입 ──
      let companyId = '';
      const endDate1m = new Date(); endDate1m.setMonth(endDate1m.getMonth() + 1);
      const endDate14d = new Date(); endDate14d.setDate(endDate14d.getDate() + 14);

      if (selectedPlan === 'company') {
        const { data: companyData } = await supabase.from('companies').insert({
          name: companyName.trim(),
          display_name: companyName.trim(),
          owner_uid: uid,
          created_at: now,
        }).select('id').single();
        companyId = companyData?.id || '';
      }

      const subPlan: Record<string, unknown> = {
        trial:   { plan: 'trial',   status: 'active', end_date: endDate14d.toISOString(), max_members: 1 },
        pro:     { plan: 'pro',     status: 'active', end_date: endDate1m.toISOString(),  max_members: 1 },
        company: { plan: 'company', status: 'active', end_date: endDate1m.toISOString(),  max_members: selectedMembers },
      }[selectedPlan] as Record<string, unknown>;

      await supabase.from('users').insert({
        id: uid,
        email: email.trim(),
        name: name.trim(),
        phone: phone.trim(),
        role: 'admin',
        team: '',
        status: 'approved',
        company_id: selectedPlan === 'company' ? companyId : null,
        company_display_name: selectedPlan === 'company' ? companyName.trim() : '',
        super_admin: false,
        subscription_plan: selectedPlan,
        subscription_status: (subPlan.status as string),
        subscription_is_pro: selectedPlan !== 'trial',
        subscription_end_date: (subPlan.end_date as string),
        subscription_max_members: (subPlan.max_members as number),
        created_at: now,
        created_from: 'web',
      });

      setDone(true);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '오류가 발생했어요.';
      if (msg.includes('email-already-in-use') || msg.includes('already registered'))
        setError('이미 사용 중인 이메일이에요.');
      else if (msg.includes('weak-password'))
        setError('비밀번호가 너무 약해요. 6자 이상으로 설정해주세요.');
      else setError(msg);
    } finally {
      setLoading(false);
    }
  };

  // 완료 화면
  if (done) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full text-center">
          <div className="text-6xl mb-4">🎉</div>
          <h2 className="text-2xl font-bold text-gray-800 mb-2">가입 완료!</h2>
          <p className="text-gray-500 mb-2">
            인증 메일을 발송했어요.<br />이메일을 확인한 후 로그인해주세요.
          </p>
          {selectedPlan === 'company' && !inviteMode && (
            <div className="bg-purple-50 rounded-xl p-4 my-4 text-left">
              <p className="text-sm font-semibold text-purple-700 mb-1">🏢 Company 관리자로 가입됐어요!</p>
              <p className="text-xs text-purple-600">로그인 후 팀 관리 메뉴에서 팀별 초대코드를 발급하세요.</p>
            </div>
          )}
          {inviteMode && inviteInfo && (
            <div className="bg-blue-50 rounded-xl p-4 my-4 text-left">
              <p className="text-sm font-semibold text-blue-700 mb-1">👥 [{inviteInfo.teamName}] 팀으로 합류했어요!</p>
              <p className="text-xs text-blue-600">로그인 후 팀 작업을 시작하세요.</p>
            </div>
          )}
          <button onClick={() => router.push('/login')} className="w-full mt-4 bg-blue-600 text-white py-3 rounded-xl font-semibold hover:bg-blue-700 transition">
            로그인하러 가기
          </button>
          <button onClick={() => router.push('/')} className="w-full mt-2 text-gray-400 text-sm hover:text-gray-600 transition">홈으로</button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden">

        {/* 헤더 */}
        <div className="bg-gradient-to-r from-blue-600 to-indigo-600 px-8 py-6 text-white">
          <h1 className="text-2xl font-bold">🏗️ LiftField 회원가입</h1>
          <p className="text-blue-100 text-sm mt-1">승강기 현장 관리 플랫폼</p>
          <div className="flex items-center gap-2 mt-4">
            {[1, 2, 3].map((s) => (
              <div key={s} className="flex items-center gap-2">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all ${step >= s ? 'bg-white text-blue-600' : 'bg-blue-400 text-white'}`}>
                  {step > s ? '✓' : s}
                </div>
                {s < 3 && <div className={`h-0.5 w-8 transition-all ${step > s ? 'bg-white' : 'bg-blue-400'}`} />}
              </div>
            ))}
            <span className="text-blue-100 text-xs ml-2">{step === 1 ? '기본 정보' : step === 2 ? '플랜 선택' : '약관 동의'}</span>
          </div>
        </div>

        <div className="px-8 py-6">
          {/* STEP 1 */}
          {step === 1 && (
            <form autoComplete="off" onSubmit={(e) => e.preventDefault()} className="space-y-4">
              <h2 className="text-lg font-bold text-gray-800">기본 정보 입력</h2>
              {[
                { label: '이름 *', type: 'text', value: name, onChange: setName, placeholder: '홍길동' },
                { label: '이메일 *', type: 'email', value: email, onChange: setEmail, placeholder: 'example@email.com' },
                { label: '휴대폰 *', type: 'tel', value: phone, onChange: setPhone, placeholder: '010-0000-0000' },
              ].map((f) => (
                <div key={f.label}>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{f.label}</label>
                  <input type={f.type} value={f.value} onChange={e => f.onChange(e.target.value)} placeholder={f.placeholder} autoComplete="off"
                    className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                </div>
              ))}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">비밀번호 * (6자 이상)</label>
                <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••" autoComplete="new-password"
                  className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">비밀번호 확인 *</label>
                <input type="password" value={passwordConfirm} onChange={e => setPasswordConfirm(e.target.value)} placeholder="••••••" autoComplete="new-password"
                  className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
              </div>
              {/* 초대코드 */}
              <div className="border border-blue-100 rounded-xl p-4 bg-blue-50">
                <button type="button" onClick={() => { setInviteMode(!inviteMode); setInviteInfo(null); setInviteMsg(''); setInviteCode(''); }}
                  className="text-sm font-semibold text-blue-600 hover:text-blue-800 transition">
                  {inviteMode ? '▼ 초대코드 입력 취소' : '🔗 초대코드가 있으신가요?'}
                </button>
                {inviteMode && (
                  <div className="mt-3 space-y-2">
                    <div className="flex gap-2">
                      <input type="text" value={inviteCode} onChange={e => setInviteCode(e.target.value.toUpperCase())}
                        placeholder="초대코드 입력 (예: ABC123)" maxLength={8}
                        className="flex-1 border border-gray-300 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                      <button type="button" onClick={checkInviteCode}
                        className="bg-blue-600 text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-blue-700 transition">확인</button>
                    </div>
                    {inviteMsg && <p className="text-xs text-gray-600">{inviteMsg}</p>}
                  </div>
                )}
              </div>
              {error && <p className="text-red-500 text-sm">{error}</p>}
              <button onClick={() => { setError(''); const err = validateStep1(); if (err) { setError(err); return; } setStep(inviteMode && inviteInfo ? 3 : 2); }}
                className="w-full bg-blue-600 text-white py-3 rounded-xl font-semibold hover:bg-blue-700 transition">다음</button>
              <p className="text-center text-sm text-gray-500">
                이미 계정이 있으신가요?{' '}
                <button onClick={() => router.push('/login')} className="text-blue-600 font-semibold hover:underline">로그인</button>
              </p>
            </form>
          )}

          {/* STEP 2 */}
          {step === 2 && (
            <div className="space-y-4">
              <h2 className="text-lg font-bold text-gray-800">플랜 선택</h2>
              <div className="space-y-3">
                {PLANS.map((plan) => (
                  <button key={plan.id} type="button" onClick={() => setSelectedPlan(plan.id as 'trial' | 'pro' | 'company')}
                    className={`w-full text-left border-2 rounded-xl p-4 transition-all ${selectedPlan === plan.id
                      ? plan.color === 'purple' ? 'border-purple-500 bg-purple-50' : plan.color === 'blue' ? 'border-blue-500 bg-blue-50' : 'border-gray-400 bg-gray-50'
                      : 'border-gray-200 hover:border-gray-300'}`}>
                    <div className="flex justify-between items-center">
                      <span className="font-semibold text-gray-800">{plan.name}</span>
                      <span className={`text-sm font-bold ${plan.color === 'purple' ? 'text-purple-600' : plan.color === 'blue' ? 'text-blue-600' : 'text-gray-500'}`}>{plan.price}</span>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">{plan.desc}</p>
                  </button>
                ))}
              </div>
              {selectedPlan === 'company' && (
                <div className="space-y-3 border border-purple-200 rounded-xl p-4 bg-purple-50">
                  <p className="text-sm font-semibold text-purple-700">🏢 Company 설정</p>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">회사명 *</label>
                    <input type="text" value={companyName} onChange={e => setCompanyName(e.target.value)} placeholder="(주)한국엘리베이터"
                      className="w-full border border-gray-300 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">최대 인원</label>
                    <div className="grid grid-cols-3 gap-2">
                      {PLAN_MEMBERS.map((m) => (
                        <button key={m} type="button" onClick={() => setSelectedMembers(m)}
                          className={`py-2 rounded-xl text-sm font-semibold border-2 transition-all ${selectedMembers === m ? 'border-purple-500 bg-purple-600 text-white' : 'border-gray-200 text-gray-600 hover:border-purple-300'}`}>
                          {m}명
                        </button>
                      ))}
                    </div>
                    <p className="text-xs text-purple-600 mt-2 font-semibold">예상 금액: ₩{calcCompanyPrice(selectedMembers).toLocaleString()}/월</p>
                  </div>
                </div>
              )}
              {error && <p className="text-red-500 text-sm">{error}</p>}
              <div className="flex gap-3">
                <button onClick={() => setStep(1)} className="flex-1 border border-gray-300 text-gray-600 py-3 rounded-xl font-semibold hover:bg-gray-50 transition">이전</button>
                <button onClick={() => { setError(''); const err = validateStep2(); if (err) { setError(err); return; } setStep(3); }}
                  className="flex-1 bg-blue-600 text-white py-3 rounded-xl font-semibold hover:bg-blue-700 transition">다음</button>
              </div>
            </div>
          )}

          {/* STEP 3 */}
          {step === 3 && (
            <div className="space-y-4">
              <h2 className="text-lg font-bold text-gray-800">약관 동의</h2>
              <div className="bg-gray-50 rounded-xl p-4 text-sm space-y-1">
                <p><span className="text-gray-500">이름:</span> <span className="font-medium">{name}</span></p>
                <p><span className="text-gray-500">이메일:</span> <span className="font-medium">{email}</span></p>
                {inviteMode && inviteInfo ? (
                  <>
                    <p><span className="text-gray-500">가입 방식:</span> <span className="font-medium text-blue-600">초대코드</span></p>
                    <p><span className="text-gray-500">팀:</span> <span className="font-medium">{inviteInfo.teamName}</span></p>
                  </>
                ) : (
                  <>
                    <p><span className="text-gray-500">플랜:</span> <span className="font-medium">{selectedPlan}</span></p>
                    {selectedPlan === 'company' && (
                      <>
                        <p><span className="text-gray-500">회사명:</span> <span className="font-medium">{companyName}</span></p>
                        <p><span className="text-gray-500">최대 인원:</span> <span className="font-medium">{selectedMembers}명</span></p>
                      </>
                    )}
                  </>
                )}
              </div>
              {[
                { label: '[필수] 이용약관 동의', checked: agreeTerms, onChange: setAgreeTerms },
                { label: '[필수] 개인정보 처리방침 동의', checked: agreePrivacy, onChange: setAgreePrivacy },
                { label: '[선택] 마케팅 정보 수신 동의', checked: agreeMarketing, onChange: setAgreeMarketing },
              ].map((item) => (
                <label key={item.label} className="flex items-center gap-3 cursor-pointer">
                  <input type="checkbox" checked={item.checked} onChange={e => item.onChange(e.target.checked)} className="w-4 h-4 accent-blue-600" />
                  <span className="text-sm text-gray-700">{item.label}</span>
                </label>
              ))}
              {error && <p className="text-red-500 text-sm">{error}</p>}
              <div className="flex gap-3">
                <button onClick={() => setStep(inviteMode && inviteInfo ? 1 : 2)} className="flex-1 border border-gray-300 text-gray-600 py-3 rounded-xl font-semibold hover:bg-gray-50 transition">이전</button>
                <button onClick={handleSubmit} disabled={loading} className="flex-1 bg-blue-600 text-white py-3 rounded-xl font-semibold hover:bg-blue-700 disabled:opacity-50 transition">
                  {loading ? '처리 중...' : '가입 완료'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
