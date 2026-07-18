'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

// ───────────────────────────────────────────
// 타입
// ───────────────────────────────────────────
interface UserDoc {
  uid: string;
  name: string;
  email: string;
  phone?: string;
  role: string;
  team?: string;
  company_id?: string;
  company_display_name?: string;
  super_admin?: boolean;
  status?: string;
  created_at?: string;
  created_from?: string;
  subscription_plan?: string;
  subscription_status?: string;
  subscription_end_date?: string;
  subscription_start_date?: string;
  max_members?: number;
}

interface QnaDoc {
  id: string;
  title: string;
  content: string;
  tag?: string;
  brand?: string;
  brand_label?: string;
  model_name?: string;
  author_name: string;
  author_uid: string;
  company_name?: string;
  is_public?: boolean;
  answer_count?: number;
  created_at?: string;
}

// ───────────────────────────────────────────
// 헬퍼
// ───────────────────────────────────────────
function formatDate(date?: string): string {
  if (!date) return '-';
  return new Date(date).toLocaleDateString('ko-KR', {
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
}

function formatDateTime(date?: string): string {
  if (!date) return '-';
  return new Date(date).toLocaleDateString('ko-KR', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

const PLAN_LABELS: Record<string, { label: string; color: string }> = {
  trial:   { label: '체험판',  color: 'bg-gray-100 text-gray-600' },
  pro:     { label: 'Pro',     color: 'bg-blue-100 text-blue-700' },
  company: { label: 'Company', color: 'bg-purple-100 text-purple-700' },
  expired: { label: '만료',    color: 'bg-red-100 text-red-600' },
};

const PLAN_OPTIONS = ['trial', 'pro', 'company', 'expired'];

// ───────────────────────────────────────────
// 컴포넌트
// ───────────────────────────────────────────
export default function AdminPage() {
  const router = useRouter();
  const [authReady, setAuthReady] = useState(false);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);

  // 데이터
  const [users, setUsers] = useState<UserDoc[]>([]);
  const [qnaList, setQnaList] = useState<QnaDoc[]>([]);

  // UI
  const [activeTab, setActiveTab] = useState<
    'users' | 'subscription' | 'companies' | 'stats' | 'accounts' | 'qna'
  >('users');
  const [searchText, setSearchText] = useState('');
  const [planFilter, setPlanFilter] = useState('전체');

  // 구독 수정 모달
  const [editUser, setEditUser] = useState<UserDoc | null>(null);
  const [editPlan, setEditPlan] = useState('');
  const [editStatus, setEditStatus] = useState('');
  const [editEndDate, setEditEndDate] = useState('');
  const [editMaxMembers, setEditMaxMembers] = useState(5);
  const [editLoading, setEditLoading] = useState(false);

  // 계정 관리 모달
  const [manageUser, setManageUser] = useState<UserDoc | null>(null);
  const [manageLoading, setManageLoading] = useState(false);

  // Realtime 채널 refs
  const usersChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const qnaChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // ── 유저 로드 헬퍼 ──
  const loadUsers = async () => {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) { console.error(error); return; }
    const list: UserDoc[] = (data || []).map((d) => ({
      uid: d.id,
      name: d.name || '',
      email: d.email || '',
      phone: d.phone || '',
      role: d.role || 'user',
      team: d.team || '',
      company_id: d.company_id || '',
      company_display_name: d.company_display_name || '',
      super_admin: d.super_admin || false,
      status: d.status || 'approved',
      created_at: d.created_at,
      created_from: d.created_from || 'app',
      subscription_plan: d.subscription_plan || 'trial',
      subscription_status: d.subscription_status || 'active',
      subscription_end_date: d.subscription_end_date,
      subscription_start_date: d.subscription_start_date,
      max_members: d.max_members || 1,
    }));
    setUsers(list);
  };

  // ── Q&A 로드 헬퍼 ──
  const loadQna = async () => {
    const { data, error } = await supabase
      .from('qna')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) { console.error(error); return; }
    const list: QnaDoc[] = (data || []).map((d) => ({
      id: d.id,
      title: d.title || '',
      content: d.content || '',
      tag: d.tag || '',
      brand: d.brand || '',
      brand_label: d.brand_label || '',
      model_name: d.model_name || '',
      author_name: d.author_name || '',
      author_uid: d.author_uid || '',
      company_name: d.company_name || '',
      is_public: d.is_public ?? true,
      answer_count: d.answer_count || 0,
      created_at: d.created_at,
    }));
    setQnaList(list);
  };

  // ── 인증 확인 ──
  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/login'); return; }

      const { data: userData } = await supabase
        .from('users')
        .select('*')
        .eq('id', user.id)
        .single();

      if (!userData || userData.super_admin !== true) {
        router.push('/');
        return;
      }
      setIsSuperAdmin(true);
      setAuthReady(true);
    };
    init();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') router.push('/login');
    });
    return () => subscription.unsubscribe();
  }, [router]);

  // ── 유저 목록 초기 로드 + Realtime ──
  useEffect(() => {
    if (!authReady) return;
    loadUsers();

    const channel = supabase
      .channel('admin-users')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'users',
      }, () => { loadUsers(); })
      .subscribe();

    usersChannelRef.current = channel;
    return () => { supabase.removeChannel(channel); };
  }, [authReady]);

  // ── Q&A 목록 초기 로드 + Realtime ──
  useEffect(() => {
    if (!authReady) return;
    loadQna();

    const channel = supabase
      .channel('admin-qna')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'qna',
      }, () => { loadQna(); })
      .subscribe();

    qnaChannelRef.current = channel;
    return () => { supabase.removeChannel(channel); };
  }, [authReady]);

  // ── 필터된 유저 ──
  const filteredUsers = users.filter((u) => {
    const matchPlan =
      planFilter === '전체' || u.subscription_plan === planFilter;
    const matchSearch =
      !searchText ||
      u.name.includes(searchText) ||
      u.email.includes(searchText) ||
      (u.company_display_name || '').includes(searchText);
    return matchPlan && matchSearch;
  });

  // ── Company 목록 ──
  const companies = Object.values(
    users
      .filter((u) => u.company_id && u.subscription_plan === 'company')
      .reduce<Record<string, { company_id: string; companyName: string; members: UserDoc[]; admin?: UserDoc }>>((acc, u) => {
        const cid = u.company_id!;
        if (!acc[cid]) {
          acc[cid] = {
            company_id: cid,
            companyName: u.company_display_name || cid,
            members: [],
          };
        }
        acc[cid].members.push(u);
        if (u.role === 'admin') acc[cid].admin = u;
        return acc;
      }, {})
  );

  // ── 통계 ──
  const stats = {
    total: users.length,
    trial: users.filter((u) => u.subscription_plan === 'trial').length,
    pro: users.filter((u) => u.subscription_plan === 'pro').length,
    company: users.filter((u) => u.subscription_plan === 'company').length,
    expired: users.filter((u) => u.subscription_plan === 'expired').length,
    fromWeb: users.filter((u) => u.created_from === 'web').length,
    fromApp: users.filter((u) => u.created_from === 'app' || !u.created_from).length,
    superAdmins: users.filter((u) => u.super_admin).length,
  };

  // ── 구독 수정 열기 ──
  const openEditUser = (u: UserDoc) => {
    setEditUser(u);
    setEditPlan(u.subscription_plan || 'trial');
    setEditStatus(u.subscription_status || 'active');
    setEditEndDate(u.subscription_end_date ? u.subscription_end_date.split('T')[0] : '');
    setEditMaxMembers(u.max_members || 5);
  };

  // ── 구독 저장 ──
  const saveSubscription = async () => {
    if (!editUser) return;
    setEditLoading(true);
    try {
      const { error } = await supabase.from('users').update({
        subscription_plan: editPlan,
        subscription_status: editStatus,
        subscription_end_date: editEndDate ? new Date(editEndDate).toISOString() : null,
        max_members: editPlan === 'company' ? editMaxMembers : 1,
        updated_at: new Date().toISOString(),
      }).eq('id', editUser.uid);
      if (error) throw error;
      setEditUser(null);
    } catch (e) {
      alert('저장 실패: ' + e);
    } finally {
      setEditLoading(false);
    }
  };

  // ── 강제 탈퇴 ──
  const handleDeleteUser = async (u: UserDoc) => {
    if (!confirm(`정말 "${u.name}" 계정을 삭제할까요?\n이 작업은 되돌릴 수 없어요.`)) return;
    setManageLoading(true);
    try {
      const { error } = await supabase.from('users').delete().eq('id', u.uid);
      if (error) throw error;
      setManageUser(null);
    } catch (e) {
      alert('삭제 실패: ' + e);
    } finally {
      setManageLoading(false);
    }
  };

  // ── 권한 변경 ──
  const handleToggleSuperAdmin = async (u: UserDoc) => {
    if (!confirm(`"${u.name}"의 SuperAdmin 권한을 ${u.super_admin ? '해제' : '부여'}할까요?`)) return;
    await supabase.from('users').update({ super_admin: !u.super_admin }).eq('id', u.uid);
  };

  const handleToggleStatus = async (u: UserDoc) => {
    const newStatus = u.status === 'approved' ? 'suspended' : 'approved';
    if (!confirm(`"${u.name}" 계정을 ${newStatus === 'suspended' ? '정지' : '복구'}할까요?`)) return;
    await supabase.from('users').update({ status: newStatus }).eq('id', u.uid);
  };

  // ── Q&A 삭제 ──
  const handleDeleteQna = async (id: string) => {
    if (!confirm('이 질문을 삭제할까요?')) return;
    await supabase.from('qna_answers').delete().eq('qna_id', id);
    await supabase.from('qna').delete().eq('id', id);
    setQnaList(prev => prev.filter(q => q.id !== id));
  };

  // ───────────────────────────────────────────
  if (!authReady) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-gray-500 text-sm">권한 확인 중...</p>
        </div>
      </div>
    );
  }

  // ───────────────────────────────────────────
  // 렌더
  // ───────────────────────────────────────────
  const TABS = [
    { key: 'users',        icon: '👤', label: '가입자 목록' },
    { key: 'subscription', icon: '💳', label: '구독 관리' },
    { key: 'companies',    icon: '🏢', label: '회사 목록' },
    { key: 'stats',        icon: '📊', label: '통계' },
    { key: 'accounts',     icon: '🔧', label: '계정 관리' },
    { key: 'qna',          icon: '💬', label: 'Q&A 관리' },
  ];

  return (
    <div className="min-h-screen bg-gray-50">

      {/* 헤더 */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push('/')}
              className="text-gray-400 hover:text-gray-600 transition text-sm"
            >
              ← 홈
            </button>
            <span className="text-gray-300">|</span>
            <h1 className="text-lg font-black text-gray-800">👑 슈퍼어드민</h1>
            <span className="bg-red-100 text-red-600 text-xs px-2 py-0.5 rounded-full font-bold">
              ADMIN ONLY
            </span>
          </div>
          <button
            onClick={() => supabase.auth.signOut().then(() => router.push('/login'))}
            className="text-sm text-gray-400 hover:text-gray-600 transition"
          >
            로그아웃
          </button>
        </div>
      </header>

      {/* 탭 네비 */}
      <div className="bg-white border-b border-gray-200 sticky top-16 z-10">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex overflow-x-auto">
            {TABS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key as typeof activeTab)}
                className={`flex items-center gap-1.5 px-4 py-4 text-sm font-semibold whitespace-nowrap border-b-2 transition-all ${
                  activeTab === tab.key
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                <span>{tab.icon}</span>
                <span>{tab.label}</span>
                {tab.key === 'users' && (
                  <span className="bg-gray-100 text-gray-600 text-xs px-1.5 py-0.5 rounded-full">
                    {users.length}
                  </span>
                )}
                {tab.key === 'qna' && (
                  <span className="bg-gray-100 text-gray-600 text-xs px-1.5 py-0.5 rounded-full">
                    {qnaList.length}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      <main className="max-w-7xl mx-auto px-4 py-6">

        {/* ════════════════════════════════
            탭 1 — 가입자 목록
        ════════════════════════════════ */}
        {activeTab === 'users' && (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row gap-3">
              <input
                type="text"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="이름 / 이메일 / 회사명 검색..."
                className="flex-1 border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
              />
              <div className="flex gap-2">
                {['전체', ...PLAN_OPTIONS].map((p) => (
                  <button
                    key={p}
                    onClick={() => setPlanFilter(p)}
                    className={`px-3 py-2 rounded-xl text-xs font-semibold transition-all ${
                      planFilter === p
                        ? 'bg-blue-600 text-white'
                        : 'bg-white border border-gray-200 text-gray-600 hover:border-blue-300'
                    }`}
                  >
                    {p === '전체' ? '전체' : PLAN_LABELS[p]?.label || p}
                  </button>
                ))}
              </div>
            </div>

            <p className="text-sm text-gray-500">
              총 <span className="font-bold text-gray-800">{filteredUsers.length}</span>명
            </p>

            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      {['이름', '이메일', '플랜', '상태', '가입경로', '가입일', '만료일'].map((h) => (
                        <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredUsers.map((u) => {
                      const plan = u.subscription_plan || 'trial';
                      const planInfo = PLAN_LABELS[plan] || PLAN_LABELS.trial;
                      const isExpired =
                        u.subscription_end_date && new Date(u.subscription_end_date) < new Date();
                      return (
                        <tr
                          key={u.uid}
                          className="border-b border-gray-50 hover:bg-blue-50/30 transition-colors"
                        >
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
                                u.super_admin ? 'bg-yellow-100 text-yellow-700' : 'bg-blue-100 text-blue-700'
                              }`}>
                                {u.super_admin ? '👑' : u.name.charAt(0)}
                              </div>
                              <div>
                                <p className="font-semibold text-gray-800">{u.name}</p>
                                {u.company_display_name && (
                                  <p className="text-xs text-gray-400">{u.company_display_name}</p>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-gray-600">{u.email}</td>
                          <td className="px-4 py-3">
                            <span className={`text-xs px-2 py-1 rounded-full font-semibold ${planInfo.color}`}>
                              {planInfo.label}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span className={`text-xs px-2 py-1 rounded-full font-semibold ${
                              u.status === 'suspended'
                                ? 'bg-red-100 text-red-600'
                                : isExpired
                                ? 'bg-orange-100 text-orange-600'
                                : 'bg-green-100 text-green-600'
                            }`}>
                              {u.status === 'suspended' ? '정지' : isExpired ? '만료' : '정상'}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span className={`text-xs px-2 py-1 rounded-full ${
                              u.created_from === 'web'
                                ? 'bg-indigo-100 text-indigo-600'
                                : 'bg-gray-100 text-gray-500'
                            }`}>
                              {u.created_from === 'web' ? '🌐 웹' : '📱 앱'}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-gray-500 text-xs">
                            {formatDate(u.created_at)}
                          </td>
                          <td className="px-4 py-3 text-xs">
                            <span className={isExpired ? 'text-red-500 font-semibold' : 'text-gray-500'}>
                              {formatDate(u.subscription_end_date)}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {filteredUsers.length === 0 && (
                  <div className="text-center py-12 text-gray-400">
                    <p className="text-3xl mb-2">👤</p>
                    <p className="text-sm">검색 결과가 없어요.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ════════════════════════════════
            탭 2 — 구독 관리
        ════════════════════════════════ */}
        {activeTab === 'subscription' && (
          <div className="space-y-4">
            <p className="text-sm text-gray-500">
              플랜을 클릭해서 구독을 수정할 수 있어요.
            </p>
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      {['이름', '이메일', '현재 플랜', '구독 상태', '만료일', '최대인원', '수정'].map((h) => (
                        <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((u) => {
                      const plan = u.subscription_plan || 'trial';
                      const planInfo = PLAN_LABELS[plan] || PLAN_LABELS.trial;
                      const isExpired =
                        u.subscription_end_date && new Date(u.subscription_end_date) < new Date();
                      return (
                        <tr
                          key={u.uid}
                          className="border-b border-gray-50 hover:bg-gray-50 transition-colors"
                        >
                          <td className="px-4 py-3 font-semibold text-gray-800">{u.name}</td>
                          <td className="px-4 py-3 text-gray-500">{u.email}</td>
                          <td className="px-4 py-3">
                            <span className={`text-xs px-2 py-1 rounded-full font-semibold ${planInfo.color}`}>
                              {planInfo.label}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span className={`text-xs px-2 py-1 rounded-full font-semibold ${
                              u.subscription_status === 'active' && !isExpired
                                ? 'bg-green-100 text-green-600'
                                : 'bg-red-100 text-red-600'
                            }`}>
                              {u.subscription_status === 'active' && !isExpired ? '활성' : '비활성'}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-xs">
                            <span className={isExpired ? 'text-red-500 font-bold' : 'text-gray-500'}>
                              {formatDate(u.subscription_end_date)}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-xs text-gray-500">
                            {plan === 'company' ? `${u.max_members || 1}명` : '-'}
                          </td>
                          <td className="px-4 py-3">
                            <button
                              onClick={() => openEditUser(u)}
                              className="text-xs bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 transition"
                            >
                              수정
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ════════════════════════════════
            탭 3 — 회사 목록
        ════════════════════════════════ */}
        {activeTab === 'companies' && (
          <div className="space-y-4">
            <p className="text-sm text-gray-500">
              Company 플랜 가입 회사 목록이에요.
              총 <span className="font-bold text-gray-800">{companies.length}</span>개 회사
            </p>
            {companies.length === 0 ? (
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-12 text-center text-gray-400">
                <p className="text-4xl mb-2">🏢</p>
                <p className="text-sm">등록된 회사가 없어요.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {companies.map((c) => (
                  <div
                    key={c.company_id}
                    className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5"
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <h3 className="font-black text-gray-800 text-base">{c.companyName}</h3>
                        <p className="text-xs text-gray-400 mt-0.5">ID: {c.company_id}</p>
                      </div>
                      <span className="bg-purple-100 text-purple-700 text-xs px-2 py-1 rounded-full font-semibold">
                        Company
                      </span>
                    </div>
                    {c.admin && (
                      <div className="bg-gray-50 rounded-xl p-3 mb-3">
                        <p className="text-xs text-gray-500 mb-1">관리자</p>
                        <p className="text-sm font-semibold text-gray-800">{c.admin.name}</p>
                        <p className="text-xs text-gray-400">{c.admin.email}</p>
                      </div>
                    )}
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-500">
                        멤버 <span className="font-bold text-gray-800">{c.members.length}</span>명
                      </span>
                      <span className="text-gray-500">
                        최대 <span className="font-bold text-gray-800">
                          {c.admin?.max_members || '-'}
                        </span>명
                      </span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-1">
                      {Array.from(new Set(c.members.map((m) => m.team).filter(Boolean))).map((t) => (
                        <span key={t} className="bg-blue-50 text-blue-600 text-xs px-2 py-0.5 rounded-full">
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ════════════════════════════════
            탭 4 — 통계
        ════════════════════════════════ */}
        {activeTab === 'stats' && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                { label: '전체 가입자', value: stats.total, color: 'blue', icon: '👤' },
                { label: '체험판', value: stats.trial, color: 'gray', icon: '🆓' },
                { label: 'Pro', value: stats.pro, color: 'blue', icon: '⭐' },
                { label: 'Company', value: stats.company, color: 'purple', icon: '🏢' },
              ].map((card) => (
                <div key={card.label} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
                  <div className="flex items-center gap-2 mb-2">
                    <span>{card.icon}</span>
                    <p className="text-xs text-gray-500">{card.label}</p>
                  </div>
                  <p className={`text-3xl font-black ${
                    card.color === 'purple' ? 'text-purple-600' :
                    card.color === 'blue' ? 'text-blue-600' : 'text-gray-600'
                  }`}>{card.value}</p>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
                <h3 className="font-bold text-gray-800 mb-4">📱 가입 경로</h3>
                <div className="space-y-3">
                  {[
                    { label: '앱 가입', value: stats.fromApp, color: 'bg-blue-500' },
                    { label: '웹 가입', value: stats.fromWeb, color: 'bg-indigo-500' },
                  ].map((item) => (
                    <div key={item.label}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-gray-600">{item.label}</span>
                        <span className="font-bold text-gray-800">{item.value}명</span>
                      </div>
                      <div className="w-full bg-gray-100 rounded-full h-2">
                        <div
                          className={`${item.color} h-2 rounded-full transition-all`}
                          style={{ width: `${stats.total ? (item.value / stats.total) * 100 : 0}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
                <h3 className="font-bold text-gray-800 mb-4">💳 플랜 현황</h3>
                <div className="space-y-3">
                  {[
                    { label: '체험판', value: stats.trial, color: 'bg-gray-400' },
                    { label: 'Pro', value: stats.pro, color: 'bg-blue-500' },
                    { label: 'Company', value: stats.company, color: 'bg-purple-500' },
                    { label: '만료', value: stats.expired, color: 'bg-red-400' },
                  ].map((item) => (
                    <div key={item.label}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-gray-600">{item.label}</span>
                        <span className="font-bold text-gray-800">
                          {item.value}명 ({stats.total ? Math.round((item.value / stats.total) * 100) : 0}%)
                        </span>
                      </div>
                      <div className="w-full bg-gray-100 rounded-full h-2">
                        <div
                          className={`${item.color} h-2 rounded-full transition-all`}
                          style={{ width: `${stats.total ? (item.value / stats.total) * 100 : 0}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {[
                { label: '만료된 계정', value: stats.expired, icon: '⚠️', color: 'text-red-500' },
                { label: 'SuperAdmin', value: stats.superAdmins, icon: '👑', color: 'text-yellow-600' },
                { label: '등록 회사', value: companies.length, icon: '🏢', color: 'text-purple-600' },
              ].map((card) => (
                <div key={card.label} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 text-center">
                  <p className="text-2xl mb-1">{card.icon}</p>
                  <p className={`text-2xl font-black ${card.color}`}>{card.value}</p>
                  <p className="text-xs text-gray-500 mt-1">{card.label}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ════════════════════════════════
            탭 5 — 계정 관리
        ════════════════════════════════ */}
        {activeTab === 'accounts' && (
          <div className="space-y-4">
            <p className="text-sm text-gray-500">
              계정 정지, 권한 변경, 강제 탈퇴를 관리해요.
            </p>
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      {['이름', '이메일', '역할', '상태', 'SuperAdmin', '관리'].map((h) => (
                        <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((u) => (
                      <tr
                        key={u.uid}
                        className="border-b border-gray-50 hover:bg-gray-50 transition-colors"
                      >
                        <td className="px-4 py-3 font-semibold text-gray-800">{u.name}</td>
                        <td className="px-4 py-3 text-gray-500 text-xs">{u.email}</td>
                        <td className="px-4 py-3">
                          <span className={`text-xs px-2 py-1 rounded-full ${
                            u.role === 'admin'
                              ? 'bg-purple-100 text-purple-700'
                              : 'bg-gray-100 text-gray-600'
                          }`}>
                            {u.role === 'admin' ? '관리자' : '멤버'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-xs px-2 py-1 rounded-full font-semibold ${
                            u.status === 'suspended'
                              ? 'bg-red-100 text-red-600'
                              : 'bg-green-100 text-green-600'
                          }`}>
                            {u.status === 'suspended' ? '정지' : '정상'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {u.super_admin ? (
                            <span className="text-yellow-500 font-bold">👑 Yes</span>
                          ) : (
                            <span className="text-gray-300 text-xs">-</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <button
                            onClick={() => setManageUser(u)}
                            className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1.5 rounded-lg transition"
                          >
                            관리
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ════════════════════════════════
            탭 6 — Q&A 관리
        ════════════════════════════════ */}
        {activeTab === 'qna' && (
          <div className="space-y-4">
            <p className="text-sm text-gray-500">
              전체 기술 Q&A를 관리해요.
              총 <span className="font-bold text-gray-800">{qnaList.length}</span>개
            </p>
            {qnaList.length === 0 ? (
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-12 text-center text-gray-400">
                <p className="text-4xl mb-2">💬</p>
                <p className="text-sm">등록된 Q&A가 없어요.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {qnaList.map((q) => (
                  <div
                    key={q.id}
                    className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          {q.brand_label && (
                            <span className="bg-blue-100 text-blue-700 text-xs px-2 py-0.5 rounded-full font-semibold">
                              {q.brand_label}
                            </span>
                          )}
                          {q.tag && (
                            <span className="bg-gray-100 text-gray-600 text-xs px-2 py-0.5 rounded-full">
                              {q.tag}
                            </span>
                          )}
                          {!q.is_public && (
                            <span className="bg-yellow-100 text-yellow-700 text-xs px-2 py-0.5 rounded-full">
                              🔒 비공개
                            </span>
                          )}
                        </div>
                        <h4 className="font-semibold text-gray-800 truncate">{q.title}</h4>
                        <p className="text-xs text-gray-500 mt-1 line-clamp-1">{q.content}</p>
                        <div className="flex gap-3 mt-2 text-xs text-gray-400">
                          <span>✍️ {q.author_name}</span>
                          {q.company_name && <span>🏢 {q.company_name}</span>}
                          <span>💬 답변 {q.answer_count || 0}개</span>
                          <span>📅 {formatDateTime(q.created_at)}</span>
                        </div>
                      </div>
                      <button
                        onClick={() => handleDeleteQna(q.id)}
                        className="text-xs text-red-400 hover:text-red-600 transition flex-shrink-0 border border-red-200 hover:border-red-400 px-2 py-1 rounded-lg"
                      >
                        삭제
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

      </main>

      {/* ════════════════════════════════
          구독 수정 모달
      ════════════════════════════════ */}
      {editUser && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-gray-800">💳 구독 수정</h3>
              <button onClick={() => setEditUser(null)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>

            <div className="bg-gray-50 rounded-xl p-3 text-sm">
              <p className="font-semibold text-gray-800">{editUser.name}</p>
              <p className="text-gray-500 text-xs">{editUser.email}</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">플랜</label>
              <div className="grid grid-cols-2 gap-2">
                {PLAN_OPTIONS.map((p) => (
                  <button
                    key={p}
                    onClick={() => setEditPlan(p)}
                    className={`py-2 rounded-xl text-sm font-semibold border-2 transition-all ${
                      editPlan === p
                        ? 'border-blue-500 bg-blue-600 text-white'
                        : 'border-gray-200 text-gray-600 hover:border-blue-300'
                    }`}
                  >
                    {PLAN_LABELS[p]?.label || p}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">구독 상태</label>
              <div className="flex gap-2">
                {['active', 'expired', 'cancelled'].map((s) => (
                  <button
                    key={s}
                    onClick={() => setEditStatus(s)}
                    className={`flex-1 py-2 rounded-xl text-sm font-semibold border-2 transition-all ${
                      editStatus === s
                        ? 'border-blue-500 bg-blue-600 text-white'
                        : 'border-gray-200 text-gray-600 hover:border-blue-300'
                    }`}
                  >
                    {s === 'active' ? '활성' : s === 'expired' ? '만료' : '취소'}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">만료일</label>
              <input
                type="date"
                value={editEndDate}
                onChange={(e) => setEditEndDate(e.target.value)}
                className="w-full border border-gray-300 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>

            {editPlan === 'company' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">최대 인원</label>
                <div className="grid grid-cols-4 gap-2">
                  {[5, 10, 15, 20, 30, 50, 100].map((n) => (
                    <button
                      key={n}
                      onClick={() => setEditMaxMembers(n)}
                      className={`py-2 rounded-xl text-sm font-semibold border-2 transition-all ${
                        editMaxMembers === n
                          ? 'border-blue-500 bg-blue-600 text-white'
                          : 'border-gray-200 text-gray-600 hover:border-blue-300'
                      }`}
                    >
                      {n}명
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setEditUser(null)}
                className="flex-1 border border-gray-300 text-gray-600 py-3 rounded-xl font-semibold hover:bg-gray-50 transition"
              >
                취소
              </button>
              <button
                onClick={saveSubscription}
                disabled={editLoading}
                className="flex-1 bg-blue-600 text-white py-3 rounded-xl font-semibold hover:bg-blue-700 transition disabled:opacity-50"
              >
                {editLoading ? '저장 중...' : '저장'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════════════════
          계정 관리 모달
      ════════════════════════════════ */}
      {manageUser && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-gray-800">🔧 계정 관리</h3>
              <button onClick={() => setManageUser(null)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>

            <div className="bg-gray-50 rounded-xl p-3">
              <p className="font-semibold text-gray-800">{manageUser.name}</p>
              <p className="text-gray-500 text-xs">{manageUser.email}</p>
              <p className="text-gray-400 text-xs mt-1">
                {PLAN_LABELS[manageUser.subscription_plan || 'trial']?.label} ·{' '}
                {manageUser.role === 'admin' ? '관리자' : '멤버'}
              </p>
            </div>

            <div className="space-y-2">
              <button
                onClick={() => handleToggleStatus(manageUser)}
                disabled={manageLoading}
                className={`w-full py-3 rounded-xl font-semibold text-sm transition ${
                  manageUser.status === 'suspended'
                    ? 'bg-green-100 text-green-700 hover:bg-green-200'
                    : 'bg-orange-100 text-orange-700 hover:bg-orange-200'
                }`}
              >
                {manageUser.status === 'suspended' ? '✅ 계정 복구' : '⏸️ 계정 정지'}
              </button>

              <button
                onClick={() => handleToggleSuperAdmin(manageUser)}
                disabled={manageLoading}
                className={`w-full py-3 rounded-xl font-semibold text-sm transition ${
                  manageUser.super_admin
                    ? 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {manageUser.super_admin ? '👑 SuperAdmin 해제' : '👑 SuperAdmin 부여'}
              </button>

              <button
                onClick={() => handleDeleteUser(manageUser)}
                disabled={manageLoading}
                className="w-full py-3 rounded-xl font-semibold text-sm bg-red-100 text-red-600 hover:bg-red-200 transition"
              >
                🗑️ 강제 탈퇴
              </button>
            </div>

            <button
              onClick={() => setManageUser(null)}
              className="w-full border border-gray-200 text-gray-600 py-2.5 rounded-xl text-sm font-semibold hover:bg-gray-50 transition"
            >
              닫기
            </button>
          </div>
        </div>
      )}

    </div>
  );
}
