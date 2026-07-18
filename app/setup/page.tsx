'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

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
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/login'); return; }

      const { data: userData } = await supabase
        .from('users')
        .select('*')
        .eq('id', user.id)
        .single();

      if (!userData) { router.push('/login'); return; }

      if (userData.company_id && userData.company_id.trim() !== '') {
        router.push('/');
        return;
      }

      const subPlan = userData.subscription_plan || 'trial';
      if (subPlan === 'trial') {
        router.push('/');
        return;
      }

      setUid(user.id);
      setUserName(userData.name || '');
      setPlan(subPlan);
      setLoading(false);
    };
    init();
  }, [router]);

  const handleSave = async () => {
    if (!companyName.trim()) { setError('회사명을 입력해주세요.'); return; }
    setSaving(true);
    setError('');

    try {
      const now = new Date().toISOString();

      const { data: companyData } = await supabase
        .from('companies')
        .insert({
          name: companyName.trim(),
          display_name: companyName.trim(),
          owner_uid: uid,
          created_at: now,
        })
        .select('id')
        .single();

      const companyId = companyData?.id || '';

      await supabase.from('users').update({
        company_id: companyId,
        company_display_name: companyName.trim(),
      }).eq('id', uid);

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
        <div className="bg-gradient-to-r from-blue-600 to-indigo-600 px-8 py-8 text-white text-center">
          <div className="text-5xl mb-3">🏢</div>
          <h1 className="text-2xl font-black mb-1">회사 설정</h1>
          <p className="text-blue-100 text-sm">{userName}님, 환영해요!<br />회사명을 입력하면 바로 시작할 수 있어요.</p>
        </div>
        <div className="px-8 py-6 space-y-5">
          <div className={`rounded-xl p-3 text-sm text-center font-semibold ${plan === 'company' ? 'bg-purple-50 text-purple-700 border border-purple-200' : 'bg-blue-50 text-blue-700 border border-blue-200'}`}>
            {plan === 'company' ? '🏢 Company 플랜' : '⭐ Pro 플랜'} 으로 이용 중이에요
          </div>
          <div>
            <label className="block text-sm font-bold text-gray-700 mb-1.5">회사명 *</label>
            <input type="text" value={companyName} onChange={e => setCompanyName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSave()} placeholder="예: (주)한국엘리베이터"
              className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" autoFocus />
            <p className="text-xs text-gray-400 mt-1">현장 관리 및 팀 구분에 사용돼요.</p>
          </div>
          {error && <p className="text-red-500 text-sm text-center">{error}</p>}
          <button onClick={handleSave} disabled={saving || !companyName.trim()}
            className="w-full bg-blue-600 text-white py-3.5 rounded-xl font-black hover:bg-blue-700 transition disabled:opacity-40 text-base">
            {saving ? '저장 중...' : plan === 'company' ? '저장 후 팀 관리로 →' : '시작하기 →'}
          </button>
          <div className="text-center pt-1">
            <p className="text-xs text-gray-400 mb-1.5">이미 회사에 초대받으셨나요?</p>
            <button onClick={() => router.push('/join')} className="text-sm font-bold text-orange-500 hover:text-orange-600 transition-colors">
              🏢 초대코드로 팀 합류하기
            </button>
          </div>
          <p className="text-center text-xs text-gray-400">
            나중에 설정하려면{' '}
            <button onClick={() => router.push('/')} className="text-blue-500 hover:underline">건너뛰기</button>
          </p>
        </div>
      </div>
    </div>
  );
}
