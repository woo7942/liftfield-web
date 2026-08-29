'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

interface UserDoc {
  id: string;
  name: string;
  email: string;
  role: string;
  team?: string;
  company_id?: string;
  company_display_name?: string;
  super_admin?: boolean;
  subscription_plan?: string;
  subscription_status?: string;
  subscription_end_date?: string;
  data_deletion_at?: string;
  max_members?: number;
  created_at?: string;
}

interface CompanyGroup {
  company_id: string;
  company_name: string;
  members: UserDoc[];
  admin?: UserDoc;
}

const PLAN_LABELS: Record<string, { label: string; color: string }> = {
  trial:   { label: '체험판',  color: 'bg-gray-100 text-gray-600' },
  pro:     { label: 'Pro',     color: 'bg-blue-100 text-blue-700' },
  company: { label: 'Company', color: 'bg-purple-100 text-purple-700' },
  expired: { label: '만료',    color: 'bg-red-100 text-red-600' },
};

function formatDate(v?: string | null): string {
  if (!v) return '-';
  const d = new Date(v);
  if (isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

export default function AdminCompaniesPage() {
  const router = useRouter();
  const [authReady, setAuthReady] = useState(false);
  const [users, setUsers] = useState<UserDoc[]>([]);
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CompanyGroup | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleteLoading, setDeleteLoading] = useState(false);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_e, session) => {
      if (!session) { router.push('/login'); return; }
      const { data: me } = await supabase
        .from('users')
        .select('super_admin')
        .eq('id', session.user.id)
        .single();
      if (!me || me.super_admin !== true) { router.push('/'); return; }
      setAuthReady(true);
      await loadUsers();
    });
    return () => subscription.unsubscribe();
  }, []);

  const loadUsers = async () => {
    const { data } = await supabase
      .from('users')
      .select('*')
      .order('created_at', { ascending: false });
    setUsers((data || []) as UserDoc[]);
  };

  const companies: CompanyGroup[] = Object.values(
    users
      .filter(u => u.company_id && u.company_id !== '__system__')
      .reduce<Record<string, CompanyGroup>>((acc, u) => {
        const cid = u.company_id!;
        if (!acc[cid]) acc[cid] = { company_id: cid, company_name: u.company_display_name || cid, members: [] };
        acc[cid].members.push(u);
        if (u.role === 'admin') acc[cid].admin = u;
        return acc;
      }, {})
  ).filter(c =>
    !search ||
    c.company_name.toLowerCase().includes(search.toLowerCase()) ||
    c.company_id.toLowerCase().includes(search.toLowerCase())
  );

  const getStatusInfo = (admin?: UserDoc) => {
    if (!admin) return { badge: '관리자 없음', color: 'bg-gray-100 text-gray-500', daysLeft: null, daysToDelete: null };
    const plan = admin.subscription_plan || 'trial';
    const status = admin.subscription_status || 'active';
    const endDate = admin.subscription_end_date ? new Date(admin.subscription_end_date) : null;
    const deletionAt = admin.data_deletion_at ? new Date(admin.data_deletion_at) : null;
    const now = new Date();
    const isExpired = endDate ? endDate < now : false;
    const daysLeft = endDate ? Math.ceil((endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)) : null;
    const daysToDelete = deletionAt ? Math.ceil((deletionAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)) : null;

    if (status === 'cancelled') return { badge: '정지됨', color: 'bg-red-100 text-red-600', daysLeft, daysToDelete };
    if (plan === 'company' && status === 'active' && !isExpired) return { badge: '결제완료', color: 'bg-green-100 text-green-700', daysLeft, daysToDelete };
    if (status === 'active' && !isExpired) return { badge: `체험중 D-${daysLeft}`, color: 'bg-blue-100 text-blue-700', daysLeft, daysToDelete };
    return { badge: '체험/구독 종료', color: 'bg-orange-100 text-orange-600', daysLeft, daysToDelete };
  };

  const handleActivate = async (admin: UserDoc) => {
    if (!confirm(`"${admin.company_display_name}" 회사를 결제완료(1년) 상태로 변경할까요?`)) return;
    setBusyId(admin.id);
    const oneYearLater = new Date();
    oneYearLater.setFullYear(oneYearLater.getFullYear() + 1);
    const { error } = await supabase.rpc('update_company_subscription', {
      p_admin_id: admin.id,
      p_plan: 'company',
      p_status: 'active',
      p_end_date: oneYearLater.toISOString(),
      p_max_members: admin.max_members || 5,
    });
    if (error) alert('처리 실패: ' + error.message);
    await loadUsers();
    setBusyId(null);
  };

  const handleExtendTrial = async (admin: UserDoc, days: number) => {
    setBusyId(admin.id);
    const base = admin.subscription_end_date ? new Date(admin.subscription_end_date) : new Date();
    const newEnd = new Date(Math.max(base.getTime(), Date.now()) + days * 24 * 60 * 60 * 1000);
    const { error } = await supabase.rpc('update_company_subscription', {
      p_admin_id: admin.id,
      p_plan: 'trial',
      p_status: 'active',
      p_end_date: newEnd.toISOString(),
      p_max_members: admin.max_members || 5,
    });
    if (error) alert('처리 실패: ' + error.message);
    await loadUsers();
    setBusyId(null);
  };

  const handleSuspend = async (admin: UserDoc) => {
    const willSuspend = admin.subscription_status !== 'cancelled';
    if (!confirm(`"${admin.company_display_name}" 회사를 ${willSuspend ? '정지' : '정지 해제'}할까요?`)) return;
    setBusyId(admin.id);
    const { error } = await supabase.rpc('update_company_subscription', {
      p_admin_id: admin.id,
      p_plan: admin.subscription_plan || 'trial',
      p_status: willSuspend ? 'cancelled' : 'active',
      p_end_date: admin.subscription_end_date || null,
      p_max_members: admin.max_members || 5,
    });
    if (error) alert('처리 실패: ' + error.message);
    await loadUsers();
    setBusyId(null);
  };

  const handleScheduleDeletion = async (admin: UserDoc, days: number) => {
    if (!confirm(`"${admin.company_display_name}" 회사를 ${days}일 후 삭제 예정으로 지정할까요?`)) return;
    setBusyId(admin.id);
    const { error } = await supabase.rpc('schedule_company_deletion', {
      p_admin_id: admin.id,
      p_days: days,
    });
    if (error) alert('처리 실패: ' + error.message);
    await loadUsers();
    setBusyId(null);
  };

  const handleCancelDeletion = async (admin: UserDoc) => {
    setBusyId(admin.id);
    const { error } = await supabase.rpc('cancel_company_deletion', { p_admin_id: admin.id });
    if (error) alert('처리 실패: ' + error.message);
    await loadUsers();
    setBusyId(null);
  };

  const handlePermanentDelete = async () => {
    if (!deleteTarget) return;
    if (deleteConfirmText !== deleteTarget.company_name) {
      alert('회사명을 정확히 입력해주세요.');
      return;
    }
    setDeleteLoading(true);
    const { error } = await supabase.rpc('delete_company_permanently', {
      p_company_id: deleteTarget.company_id,
    });
    setDeleteLoading(false);
    if (error) {
      alert('삭제 실패: ' + error.message);
      return;
    }
    setDeleteTarget(null);
    setDeleteConfirmText('');
    await loadUsers();
    alert('삭제가 완료됐어요.');
  };

  if (!authReady) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const summary = {
    total: companies.length,
    trial: companies.filter(c => (c.admin?.subscription_plan || 'trial') === 'trial' && c.admin?.subscription_status !== 'cancelled').length,
    active: companies.filter(c => c.admin?.subscription_plan === 'company' && c.admin?.subscription_status === 'active').length,
    suspended: companies.filter(c => c.admin?.subscription_status === 'cancelled').length,
    scheduled: companies.filter(c => !!c.admin?.data_deletion_at).length,
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => router.push('/admin')} className="text-gray-400 hover:text-gray-600 text-sm">← 관리자 홈</button>
            <span className="text-gray-300">|</span>
            <h1 className="text-lg font-black text-gray-800">🏢 회사 관리 대시보드</h1>
          </div>
          <button onClick={() => supabase.auth.signOut().then(() => router.push('/login'))} className="text-sm text-gray-400 hover:text-gray-600">로그아웃</button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6 space-y-6">

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[
            { label: '전체 회사', value: summary.total, color: 'text-gray-800' },
            { label: '체험중', value: summary.trial, color: 'text-blue-600' },
            { label: '결제완료', value: summary.active, color: 'text-green-600' },
            { label: '정지됨', value: summary.suspended, color: 'text-red-600' },
            { label: '삭제예약', value: summary.scheduled, color: 'text-orange-600' },
          ].map(card => (
            <div key={card.label} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 text-center">
              <p className={`text-2xl font-black ${card.color}`}>{card.value}</p>
              <p className="text-xs text-gray-500 mt-1">{card.label}</p>
            </div>
          ))}
        </div>

        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="회사명 또는 ID로 검색"
          className="w-full max-w-sm px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
        />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {companies.map(c => {
            const admin = c.admin;
            const info = getStatusInfo(admin);
            const busy = admin ? busyId === admin.id : false;

            return (
              <div key={c.company_id} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 space-y-4">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-black text-gray-800 text-base">{c.company_name}</h3>
                    <p className="text-xs text-gray-400 mt-0.5">ID: {c.company_id}</p>
                    {admin && <p className="text-xs text-gray-500 mt-1">관리자: {admin.name} ({admin.email})</p>}
                  </div>
                  <span className={`text-xs px-2.5 py-1 rounded-full font-semibold whitespace-nowrap ${info.color}`}>{info.badge}</span>
                </div>

                <div className="flex items-center gap-4 text-xs text-gray-500">
                  <span>멤버 <b className="text-gray-800">{c.members.length}</b>명</span>
                  {admin?.subscription_end_date && <span>만료일 <b className="text-gray-800">{formatDate(admin.subscription_end_date)}</b></span>}
                </div>

                {admin?.data_deletion_at && (
                  <div className="bg-orange-50 border border-orange-100 rounded-xl px-3 py-2 text-xs text-orange-700 flex items-center justify-between">
                    <span>⚠️ 삭제 예정일: {formatDate(admin.data_deletion_at)} (D-{info.daysToDelete})</span>
                    <button
                      disabled={busy}
                      onClick={() => handleCancelDeletion(admin)}
                      className="text-orange-600 underline hover:text-orange-800"
                    >
                      예약 취소
                    </button>
                  </div>
                )}

                {admin && (
                  <div className="flex flex-wrap gap-1.5 pt-2 border-t border-gray-50">
                    <button disabled={busy} onClick={() => handleActivate(admin)}
                      className="px-2.5 py-1.5 bg-green-600 hover:bg-green-700 disabled:opacity-40 text-white text-xs rounded-lg font-semibold">
                      결제완료 처리 (1년)
                    </button>
                    <button disabled={busy} onClick={() => handleExtendTrial(admin, 7)}
                      className="px-2.5 py-1.5 bg-blue-50 hover:bg-blue-100 disabled:opacity-40 text-blue-700 text-xs rounded-lg font-semibold">
                      체험 +7일
                    </button>
                    <button disabled={busy} onClick={() => handleExtendTrial(admin, 15)}
                      className="px-2.5 py-1.5 bg-blue-50 hover:bg-blue-100 disabled:opacity-40 text-blue-700 text-xs rounded-lg font-semibold">
                      체험 +15일
                    </button>
                    <button disabled={busy} onClick={() => handleExtendTrial(admin, 30)}
                      className="px-2.5 py-1.5 bg-blue-50 hover:bg-blue-100 disabled:opacity-40 text-blue-700 text-xs rounded-lg font-semibold">
                      체험 +30일
                    </button>
                    <button disabled={busy} onClick={() => handleSuspend(admin)}
                      className={`px-2.5 py-1.5 disabled:opacity-40 text-xs rounded-lg font-semibold ${
                        admin.subscription_status === 'cancelled'
                          ? 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                          : 'bg-red-50 hover:bg-red-100 text-red-600'
                      }`}>
                      {admin.subscription_status === 'cancelled' ? '정지 해제' : '즉시 정지'}
                    </button>
                    {!admin.data_deletion_at && (
                      <>
                        <button disabled={busy} onClick={() => handleScheduleDeletion(admin, 30)}
                          className="px-2.5 py-1.5 bg-orange-50 hover:bg-orange-100 disabled:opacity-40 text-orange-600 text-xs rounded-lg font-semibold">
                          30일 후 삭제 예약
                        </button>
                        <button disabled={busy} onClick={() => handleScheduleDeletion(admin, 90)}
                          className="px-2.5 py-1.5 bg-orange-50 hover:bg-orange-100 disabled:opacity-40 text-orange-600 text-xs rounded-lg font-semibold">
                          90일 후 삭제 예약
                        </button>
                      </>
                    )}
                    <button
                      onClick={() => { setDeleteTarget(c); setDeleteConfirmText(''); }}
                      className="px-2.5 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs rounded-lg font-semibold ml-auto"
                    >
                      🗑️ 완전 삭제
                    </button>
                  </div>
                )}
              </div>
            );
          })}
          {companies.length === 0 && (
            <div className="col-span-2 bg-white rounded-2xl shadow-sm border border-gray-100 p-12 text-center text-gray-400">
              <p className="text-4xl mb-2">🏢</p><p className="text-sm">등록된 회사가 없어요.</p>
            </div>
          )}
        </div>
      </main>

      {deleteTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
            <h3 className="text-lg font-bold text-red-600">⚠️ 회사 완전 삭제</h3>
            <p className="text-sm text-gray-600">
              <b>{deleteTarget.company_name}</b> 회사의 모든 팀원({deleteTarget.members.length}명), 현장, 승강기 캐시, 초대코드가
              <b className="text-red-600"> 영구적으로 삭제</b>됩니다. 이 작업은 되돌릴 수 없어요.
            </p>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                확인을 위해 회사명 <b>"{deleteTarget.company_name}"</b>을 정확히 입력해주세요
              </label>
              <input
                type="text"
                value={deleteConfirmText}
                onChange={e => setDeleteConfirmText(e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
              />
            </div>
            <div className="flex gap-3 pt-2">
              <button onClick={() => setDeleteTarget(null)} className="flex-1 border border-gray-300 text-gray-600 py-3 rounded-xl font-semibold hover:bg-gray-50">
                취소
              </button>
              <button
                onClick={handlePermanentDelete}
                disabled={deleteLoading || deleteConfirmText !== deleteTarget.company_name}
                className="flex-1 bg-red-600 text-white py-3 rounded-xl font-semibold hover:bg-red-700 disabled:opacity-40"
              >
                {deleteLoading ? '삭제 중...' : '영구 삭제'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
