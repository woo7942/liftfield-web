'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import TabBar from '@/components/TabBar';

// ───────────────────────────────────────────
// 타입
// ───────────────────────────────────────────
interface UserDoc {
  id: string;
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
function formatDate(v?: string | null): string {
  if (!v) return '-';
  const d = new Date(v);
  if (isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

function formatDateTime(v?: string | null): string {
  if (!v) return '-';
  const d = new Date(v);
  if (isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

const PLAN_LABELS: Record<string, { label: string; color: string }> = {
  trial:   { label: '체험판',  color: 'bg-gray-100 text-gray-600'   },
  pro:     { label: 'Pro',     color: 'bg-blue-100 text-blue-700'   },
  company: { label: 'Company', color: 'bg-purple-100 text-purple-700' },
  expired: { label: '만료',    color: 'bg-red-100 text-red-600'     },
};

const PLAN_OPTIONS = ['trial', 'pro', 'company', 'expired'];

// ───────────────────────────────────────────
// 컴포넌트
// ───────────────────────────────────────────
export default function AdminPage() {
  const router = useRouter();
  const [authReady, setAuthReady] = useState(false);
  const [users, setUsers] = useState<UserDoc[]>([]);
  const [qnaList, setQnaList] = useState<QnaDoc[]>([]);
  const [activeTab, setActiveTab] = useState<'users' | 'subscription' | 'companies' | 'stats' | 'accounts' | 'qna' | 'health' | 'activity' | 'notice'>('users');
  const [searchText, setSearchText] = useState('');
  const [planFilter, setPlanFilter] = useState('전체');

  // 구독 수정 모달
  const [editUser, setEditUser] = useState<UserDoc | null>(null);
  const [editPlan, setEditPlan] = useState('');
  const [editStatus, setEditStatus] = useState('');
  const [editEndDate, setEditEndDate] = useState('');
  const [editMaxMembers, setEditMaxMembers] = useState(5);
  const [editLoading, setEditLoading] = useState(false);

  // 시스템 점검 / 최근 활동
  const [health, setHealth] = useState<{ label: string; value: number | string; level: 'ok' | 'warn' | 'bad'; hint: string; sql?: string }[] | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [activity, setActivity] = useState<{ at: string; kind: string; company: string; text: string }[] | null>(null);
  const [activityLoading, setActivityLoading] = useState(false);

  // 공지사항
  const [notices, setNotices] = useState<any[] | null>(null);
  const [noticeErr, setNoticeErr] = useState('');
  const [nForm, setNForm] = useState({ title: '', body: '', level: 'info', target: '', starts_at: '', ends_at: '' });
  const [nSaving, setNSaving] = useState(false);

  // 계정 관리 모달
  const [manageUser, setManageUser] = useState<UserDoc | null>(null);
  const [manageLoading, setManageLoading] = useState(false);

  // ── 인증 확인 ──
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!session) { router.push('/login'); return; }

      const { data: userData } = await supabase
        .from('users')
        .select('*')
        .eq('id', session.user.id)
        .single();

      if (!userData || userData.super_admin !== true) {
        router.push('/');
        return;
      }
      setAuthReady(true);
      await loadData();
    });
    return () => subscription.unsubscribe();
  }, []);

  const loadData = async () => {
    // 유저 목록
    const { data: userData } = await supabase
      .from('users')
      .select('*')
      .order('created_at', { ascending: false });
    setUsers((userData || []) as UserDoc[]);

    // Q&A 목록
    const { data: qnaData } = await supabase
      .from('qna')
      .select('*')
      .order('created_at', { ascending: false });
    setQnaList((qnaData || []) as QnaDoc[]);
  };

  // ── 필터된 유저 ──
  const filteredUsers = users.filter(u => {
    const matchPlan = planFilter === '전체' || u.subscription_plan === planFilter;
    const matchSearch = !searchText ||
      u.name.includes(searchText) ||
      u.email.includes(searchText) ||
      (u.company_display_name || '').includes(searchText);
    return matchPlan && matchSearch;
  });

  // ── Company 목록 ──
  const companies = Object.values(
    users
      .filter(u => u.company_id && u.subscription_plan === 'company')
      .reduce<Record<string, { company_id: string; company_name: string; members: UserDoc[]; admin?: UserDoc }>>((acc, u) => {
        const cid = u.company_id!;
        if (!acc[cid]) acc[cid] = { company_id: cid, company_name: u.company_display_name || cid, members: [] };
        acc[cid].members.push(u);
        if (u.role === 'admin') acc[cid].admin = u;
        return acc;
      }, {})
  );

  // ── 통계 ──
  const stats = {
    total:       users.length,
    trial:       users.filter(u => u.subscription_plan === 'trial').length,
    pro:         users.filter(u => u.subscription_plan === 'pro').length,
    company:     users.filter(u => u.subscription_plan === 'company').length,
    expired:     users.filter(u => u.subscription_plan === 'expired').length,
    fromWeb:     users.filter(u => u.created_from === 'web').length,
    fromApp:     users.filter(u => u.created_from === 'app' || !u.created_from).length,
    superAdmins: users.filter(u => u.super_admin).length,
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
      const { error } = await supabase
        .from('users')
        .update({
          subscription_plan:     editPlan,
          subscription_status:   editStatus,
          subscription_end_date: editEndDate ? new Date(editEndDate).toISOString() : null,
          max_members:           editPlan === 'company' ? editMaxMembers : 1,
        })
        .eq('id', editUser.id);

      if (error) throw error;
      await loadData();
      setEditUser(null);
    } catch (e) {
      alert('저장 실패: ' + e);
    } finally {
      setEditLoading(false);
    }
  };

  // ── 강제 탈퇴 ──
  const handleDeleteUser = async (u: UserDoc) => {
    if (!confirm(`정말 "${u.name}" 계정을 삭제할까요?\n로그인 계정까지 완전히 지워지며 되돌릴 수 없어요.`)) return;
    setManageLoading(true);
    try {
      // 브라우저에서 users.delete() 는 RLS 때문에 0건 삭제(에러 없음)로 끝나고,
      // 로그인 계정(auth.users)은 아예 못 지움 → 서버 함수로 처리
      const { error } = await supabase.rpc('admin_delete_user', { p_uid: u.id });
      if (error) throw new Error(error.message);
      setUsers(prev => prev.filter(x => x.id !== u.id));
      await loadData();
      setManageUser(null);
      alert(`"${u.name}" 계정을 탈퇴 처리했어요.`);
    } catch (e: any) {
      const msg = String(e?.message || e);
      alert(msg.includes('admin_delete_user')
        ? '삭제 실패: 서버 함수가 아직 없어요.\nSupabase SQL Editor에서 supabase/admin_account_cleanup.sql 을 먼저 실행해주세요.'
        : '삭제 실패: ' + msg);
    } finally {
      setManageLoading(false);
    }
  };

  // ── 목록에 안 나오는 가입 계정 (auth.users 에만 남은 계정) ──
  const [orphans, setOrphans] = useState<{ id: string; email: string; created_at: string; last_sign_in_at: string | null; provider: string }[] | null>(null);
  const [orphanErr, setOrphanErr] = useState('');
  const [orphanLoading, setOrphanLoading] = useState(false);

  const loadOrphans = async () => {
    setOrphanLoading(true);
    const { data, error } = await supabase.rpc('admin_list_orphan_auth_users');
    if (error) {
      setOrphanErr(error.message.includes('admin_list_orphan_auth_users')
        ? 'Supabase SQL Editor에서 supabase/admin_account_cleanup.sql 을 먼저 실행해주세요.'
        : error.message);
      setOrphans([]);
    } else { setOrphanErr(''); setOrphans(data || []); }
    setOrphanLoading(false);
  };

  const deleteOrphan = async (o: { id: string; email: string }) => {
    if (!confirm(`"${o.email || o.id}" 가입 계정을 삭제할까요?`)) return;
    const { error } = await supabase.rpc('admin_delete_user', { p_uid: o.id });
    if (error) return alert('삭제 실패: ' + error.message);
    setOrphans(prev => (prev || []).filter(x => x.id !== o.id));
  };

  const purgeOrphans = async () => {
    if (!orphans?.length) return;
    if (!confirm(`목록에 없는 가입 계정 ${orphans.length}개를 모두 삭제할까요?\n계정 관리 목록에 보이는 계정은 그대로 유지돼요.\n되돌릴 수 없어요.`)) return;
    setOrphanLoading(true);
    const { data, error } = await supabase.rpc('admin_purge_orphan_auth_users');
    setOrphanLoading(false);
    if (error) return alert('정리 실패: ' + error.message);
    alert(`${data ?? 0}개 계정을 정리했어요.`);
    await loadOrphans();
  };

  // ── SuperAdmin 토글 ──
  const handleToggleSuperAdmin = async (u: UserDoc) => {
    if (!confirm(`"${u.name}"의 SuperAdmin 권한을 ${u.super_admin ? '해제' : '부여'}할까요?`)) return;
    const { error } = await supabase
      .from('users')
      .update({ super_admin: !u.super_admin })
      .eq('id', u.id);
    if (!error) await loadData();
  };

  // ── 계정 정지/복구 ──
  const handleToggleStatus = async (u: UserDoc) => {
    const newStatus = u.status === 'approved' ? 'suspended' : 'approved';
    if (!confirm(`"${u.name}" 계정을 ${newStatus === 'suspended' ? '정지' : '복구'}할까요?`)) return;
    const { error } = await supabase
      .from('users')
      .update({ status: newStatus })
      .eq('id', u.id);
    if (!error) await loadData();
  };

  // ── Q&A 삭제 ──
  const handleDeleteQna = async (id: string) => {
    if (!confirm('이 질문을 삭제할까요?')) return;
    const { error } = await supabase.from('qna').delete().eq('id', id);
    if (!error) setQnaList(prev => prev.filter(q => q.id !== id));
  };

  // ── 시스템 점검 (데이터 상태) ──
  const countOf = async (table: string, build?: (q: any) => any) => {
    let q: any = supabase.from(table).select('id', { count: 'exact', head: true });
    if (build) q = build(q);
    const { count, error } = await q;
    return error ? -1 : (count || 0);
  };
  const fetchAllIds = async (table: string, cols: string) => {
    let all: any[] = [];
    for (let f = 0; ; f += 1000) {
      const { data, error } = await supabase.from(table).select(cols).order('id').range(f, f + 999);
      if (error || !data) break;
      all = all.concat(data);
      if (data.length < 1000) break;
    }
    return all;
  };
  const loadHealth = async () => {
    setHealthLoading(true);
    try {
      const [sites, elevs] = await Promise.all([
        fetchAllIds('sites', 'id, company_id, team'),
        fetchAllIds('elevators', 'id, site_id, dong, hogi_no'),
      ]);
      const siteIds = new Set(sites.map((s) => s.id));
      const orphan = elevs.filter((e) => !e.site_id || !siteIds.has(e.site_id)).length;
      const dongdong = elevs.filter((e) => /동동$/.test(e.dong || '')).length;
      const dupMap: Record<string, number> = {};
      elevs.forEach((e) => { const k = `${e.site_id}|${e.dong}|${e.hogi_no}`; dupMap[k] = (dupMap[k] || 0) + 1; });
      const dup = Object.values(dupMap).filter((n) => n > 1).reduce((a, n) => a + n - 1, 0);
      const withElev = new Set(elevs.map((e) => e.site_id));
      const emptySites = sites.filter((s) => !withElev.has(s.id)).length;
      const noTeamSites = sites.filter((s) => !s.team).length;
      const noTeamUsers = users.filter((u) => u.company_id && !u.team && u.role !== 'admin').length;
      const noCompany = users.filter((u) => !u.company_id).length;
      const [pushCnt, faultOpen] = await Promise.all([
        countOf('push_subscriptions'),
        countOf('fault_reports', (q) => q.neq('status', '완료')),
      ]);
      const now = Date.now();
      const expSoon = users.filter((u) => u.subscription_end_date && new Date(u.subscription_end_date).getTime() - now < 14 * 864e5 && new Date(u.subscription_end_date).getTime() > now).length;
      const expired = users.filter((u) => u.subscription_end_date && new Date(u.subscription_end_date).getTime() < now && u.subscription_plan !== 'expired').length;

      setHealth([
        { label: '전체 현장 / 승강기', value: `${sites.length.toLocaleString()} / ${elevs.length.toLocaleString()}`, level: 'ok', hint: '모든 회사 합계' },
        { label: '현장 없는 승강기', value: orphan, level: orphan ? 'bad' : 'ok', hint: '현장이 삭제됐는데 남아 있는 호기 — 숫자가 틀어지는 원인',
          sql: "delete from elevators e where e.site_id is null or not exists (select 1 from sites s where s.id = e.site_id);" },
        { label: "동 이름 '동동'", value: dongdong, level: dongdong ? 'warn' : 'ok', hint: '예: 102동동',
          sql: "update elevators set dong = regexp_replace(dong, '(동){2,}$', '동') where dong ~ '동동$';" },
        { label: '중복 호기 (같은 현장·동·호기)', value: dup, level: dup ? 'bad' : 'ok', hint: '점검 완료율이 안 맞는 원인' },
        { label: '호기 없는 현장', value: emptySites, level: emptySites ? 'warn' : 'ok', hint: '팀별현장에서 수정 → 승강기 조회로 호기 등록 필요' },
        { label: '팀 미배정 현장', value: noTeamSites, level: noTeamSites ? 'warn' : 'ok', hint: '고장 알림이 아무에게도 가지 않음' },
        { label: '팀 미배정 팀원', value: noTeamUsers, level: noTeamUsers ? 'warn' : 'ok', hint: '팀원 관리에서 팀 배정 필요' },
        { label: '회사 없는 가입자', value: noCompany, level: noCompany ? 'warn' : 'ok', hint: '가입 후 회사 설정을 안 한 계정' },
        { label: '알림 등록 기기', value: pushCnt < 0 ? '조회 불가' : pushCnt, level: 'ok', hint: 'push_subscriptions' },
        { label: '미처리 고장 (전체)', value: faultOpen < 0 ? '조회 불가' : faultOpen, level: faultOpen > 0 ? 'warn' : 'ok', hint: '완료되지 않은 고장' },
        { label: '구독 14일 내 만료', value: expSoon, level: expSoon ? 'warn' : 'ok', hint: '구독 관리 탭에서 연장' },
        { label: '만료일 지났는데 활성', value: expired, level: expired ? 'bad' : 'ok', hint: "플랜을 'expired'로 바꾸거나 기간 연장" },
      ]);
    } finally {
      setHealthLoading(false);
    }
  };

  // ── 최근 활동 (전체 회사) ──
  const loadActivity = async () => {
    setActivityLoading(true);
    try {
      const companyName = (cid?: string) => users.find((u) => u.company_id === cid)?.company_display_name || cid || '-';
      const [f, q, l, u] = await Promise.all([
        supabase.from('fault_reports').select('created_at, company_id, site_name, hogi_no, status').order('created_at', { ascending: false }).limit(20),
        supabase.from('quotes').select('created_at, team_id, title, status, amount').order('created_at', { ascending: false }).limit(15),
        supabase.from('leave_requests').select('created_at, company_id, user_name, type, status').order('created_at', { ascending: false }).limit(15),
        supabase.from('users').select('created_at, name, company_display_name').order('created_at', { ascending: false }).limit(15),
      ]);
      const list = [
        ...(f.data || []).map((x: any) => ({ at: x.created_at, kind: '고장', company: companyName(x.company_id), text: `${x.site_name || ''} ${x.hogi_no || ''} · ${x.status}` })),
        ...(q.data || []).map((x: any) => ({ at: x.created_at, kind: '견적', company: x.team_id || '-', text: `${x.title || ''} · ${x.status} · ${(x.amount || 0).toLocaleString()}원` })),
        ...(l.data || []).map((x: any) => ({ at: x.created_at, kind: '휴가', company: companyName(x.company_id), text: `${x.user_name || ''} · ${x.type} · ${x.status}` })),
        ...(u.data || []).map((x: any) => ({ at: x.created_at, kind: '가입', company: x.company_display_name || '-', text: x.name || '' })),
      ].filter((x) => x.at).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 60);
      setActivity(list);
    } finally {
      setActivityLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'health' && !health && users.length) loadHealth();
    if (activeTab === 'activity' && !activity && users.length) loadActivity();
    if (activeTab === 'accounts' && !orphans && !orphanLoading) loadOrphans();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, users.length]);

  // ── 공지사항 ──
  const loadNotices = async () => {
    const { data, error } = await supabase.from('announcements').select('*').order('created_at', { ascending: false }).limit(50);
    if (error) { setNoticeErr(error.message); setNotices([]); return; }
    setNoticeErr(''); setNotices(data || []);
  };
  const saveNotice = async () => {
    if (!nForm.title.trim()) return alert('제목을 입력하세요');
    setNSaving(true);
    try {
      const { error } = await supabase.from('announcements').insert({
        title: nForm.title.trim(), body: nForm.body.trim() || null, level: nForm.level,
        target_company_id: nForm.target || null,
        starts_at: nForm.starts_at ? new Date(nForm.starts_at).toISOString() : new Date().toISOString(),
        ends_at: nForm.ends_at ? new Date(nForm.ends_at).toISOString() : null,
        active: true,
      });
      if (error) throw error;
      setNForm({ title: '', body: '', level: 'info', target: '', starts_at: '', ends_at: '' });
      await loadNotices();
    } catch (e: any) { alert('저장 실패: ' + e.message); } finally { setNSaving(false); }
  };
  const toggleNotice = async (n: any) => {
    const { error } = await supabase.from('announcements').update({ active: !n.active }).eq('id', n.id);
    if (!error) loadNotices();
  };
  const deleteNotice = async (n: any) => {
    if (!confirm(`"${n.title}" 공지를 삭제할까요?`)) return;
    const { error } = await supabase.from('announcements').delete().eq('id', n.id);
    if (!error) loadNotices();
  };

  // ── 회사로 보기: 내 계정의 company_id를 잠시 바꿔서 그 회사 관리자 화면을 열기 ──
  const viewAsCompany = async (companyId: string, companyName: string) => {
    if (!confirm(`"${companyName}" 회사 화면으로 들어갈까요?\n\n• 이 회사의 실제 데이터가 보이고, 수정하면 그대로 반영돼요.\n• 화면 위쪽 보라색 띠의 [내 회사로 돌아가기]로 복귀해요.`)) return;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    const { data: me, error: meErr } = await supabase.from('users')
      .select('company_id, company_display_name, home_company_id').eq('id', session.user.id).single();
    if (meErr || !me) { alert('내 정보를 불러오지 못했어요: ' + (meErr?.message || '')); return; }
    const { error } = await supabase.from('users').update({
      // 처음 들어갈 때만 원래 회사를 기억 (다른 회사로 또 이동해도 원래 회사는 유지)
      home_company_id: me.home_company_id || me.company_id,
      ...(me.home_company_id ? {} : { home_company_display_name: me.company_display_name }),
      company_id: companyId,
      company_display_name: companyName,
    }).eq('id', session.user.id);
    if (error) {
      alert(error.message.includes('home_company')
        ? 'Supabase에 home_company_id 컬럼이 아직 없어요. 안내된 SQL을 먼저 실행해 주세요.'
        : '전환 실패: ' + error.message);
      return;
    }
    sessionStorage.clear();
    window.location.href = '/dashboard';
  };

  // 모든 회사 목록 (플랜 상관없이 company_id 기준)
  const allCompanies = Object.values(users.reduce<Record<string, { id: string; name: string; count: number; admin?: string }>>((acc, u) => {
    if (!u.company_id) return acc;
    const c = acc[u.company_id] || (acc[u.company_id] = { id: u.company_id, name: u.company_display_name || u.company_id, count: 0 });
    c.count++;
    if (u.role === 'admin' && !c.admin) c.admin = u.name;
    return acc;
  }, {})).sort((a, b) => b.count - a.count);

  useEffect(() => {
    if (activeTab === 'notice' && notices === null) loadNotices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  if (!authReady) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center">
        <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-gray-500 text-sm">권한 확인 중...</p>
      </div>
    </div>
  );

  const TABS = [
    { key: 'users',        icon: '👤', label: '가입자 목록' },
    { key: 'subscription', icon: '💳', label: '구독 관리'   },
    { key: 'companies',    icon: '🏢', label: '회사 목록'   },
    { key: 'stats',        icon: '📊', label: '통계'         },
    { key: 'accounts',     icon: '🔧', label: '계정 관리'   },
    { key: 'qna',          icon: '💬', label: 'Q&A 관리'    },
    { key: 'health',       icon: '🩺', label: '시스템 점검' },
    { key: 'activity',     icon: '🕒', label: '최근 활동' },
    { key: 'notice',       icon: '📢', label: '공지사항' },
  ];

  return (
    <div className="min-h-screen bg-gray-50 pb-28">

      {/* 헤더 */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => router.push('/dashboard')}
              className="text-gray-400 hover:text-gray-600 transition text-sm">← 홈</button>
            <span className="text-gray-300">|</span>
            <h1 className="text-lg font-black text-gray-800">👑 개발자 관리</h1>
            <span className="bg-red-100 text-red-600 text-xs px-2 py-0.5 rounded-full font-bold">ADMIN ONLY</span>
          </div>
          <button onClick={() => router.push('/admin/companies')}
  className="text-sm bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-xl font-semibold transition mr-2">
  🏢 회사 관리 대시보드
</button>

          <button onClick={() => supabase.auth.signOut().then(() => router.push('/login'))}
            className="text-sm text-gray-400 hover:text-gray-600 transition">로그아웃</button>
        </div>
      </header>

      {/* 탭 네비 */}
      <div className="bg-white border-b border-gray-200 sticky top-16 z-10">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex overflow-x-auto">
            {TABS.map(tab => (
              <button key={tab.key} onClick={() => setActiveTab(tab.key as typeof activeTab)}
                className={`flex items-center gap-1.5 px-4 py-4 text-sm font-semibold whitespace-nowrap border-b-2 transition-all ${
                  activeTab === tab.key ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}>
                <span>{tab.icon}</span>
                <span>{tab.label}</span>
                {tab.key === 'users' && (
                  <span className="bg-gray-100 text-gray-600 text-xs px-1.5 py-0.5 rounded-full">{users.length}</span>
                )}
                {tab.key === 'qna' && (
                  <span className="bg-gray-100 text-gray-600 text-xs px-1.5 py-0.5 rounded-full">{qnaList.length}</span>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      <main className="max-w-7xl mx-auto px-4 py-6">

        {/* ── 탭 1: 가입자 목록 ── */}
        {activeTab === 'users' && (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row gap-3">
              <input type="text" value={searchText} onChange={e => setSearchText(e.target.value)}
                placeholder="이름 / 이메일 / 회사명 검색..."
                className="flex-1 border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
              <div className="flex gap-2">
                {['전체', ...PLAN_OPTIONS].map(p => (
                  <button key={p} onClick={() => setPlanFilter(p)}
                    className={`px-3 py-2 rounded-xl text-xs font-semibold transition-all ${
                      planFilter === p ? 'bg-blue-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:border-blue-300'
                    }`}>
                    {p === '전체' ? '전체' : PLAN_LABELS[p]?.label || p}
                  </button>
                ))}
              </div>
            </div>
            <p className="text-sm text-gray-500">총 <span className="font-bold text-gray-800">{filteredUsers.length}</span>명</p>

            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      {['이름', '이메일', '플랜', '상태', '가입경로', '가입일', '만료일'].map(h => (
                        <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredUsers.map(u => {
                      const plan = u.subscription_plan || 'trial';
                      const planInfo = PLAN_LABELS[plan] || PLAN_LABELS.trial;
                      const isExpired = u.subscription_end_date && new Date(u.subscription_end_date) < new Date();
                      return (
                        <tr key={u.id} className="border-b border-gray-50 hover:bg-blue-50/30 transition-colors">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
                                u.super_admin ? 'bg-yellow-100 text-yellow-700' : 'bg-blue-100 text-blue-700'
                              }`}>
                                {u.super_admin ? '👑' : u.name.charAt(0)}
                              </div>
                              <div>
                                <p className="font-semibold text-gray-800">{u.name}</p>
                                {u.company_display_name && <p className="text-xs text-gray-400">{u.company_display_name}</p>}
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-gray-600">{u.email}</td>
                          <td className="px-4 py-3">
                            <span className={`text-xs px-2 py-1 rounded-full font-semibold ${planInfo.color}`}>{planInfo.label}</span>
                          </td>
                          <td className="px-4 py-3">
                            <span className={`text-xs px-2 py-1 rounded-full font-semibold ${
                              u.status === 'suspended' ? 'bg-red-100 text-red-600' :
                              isExpired ? 'bg-orange-100 text-orange-600' : 'bg-green-100 text-green-600'
                            }`}>
                              {u.status === 'suspended' ? '정지' : isExpired ? '만료' : '정상'}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span className={`text-xs px-2 py-1 rounded-full ${
                              u.created_from === 'web' ? 'bg-indigo-100 text-indigo-600' : 'bg-gray-100 text-gray-500'
                            }`}>
                              {u.created_from === 'web' ? '🌐 웹' : '📱 앱'}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-gray-500 text-xs">{formatDate(u.created_at)}</td>
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
                    <p className="text-3xl mb-2">👤</p><p className="text-sm">검색 결과가 없어요.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── 탭 2: 구독 관리 ── */}
        {activeTab === 'subscription' && (
          <div className="space-y-4">
            <p className="text-sm text-gray-500">플랜을 클릭해서 구독을 수정할 수 있어요.</p>
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      {['이름', '이메일', '현재 플랜', '구독 상태', '만료일', '최대인원', '수정'].map(h => (
                        <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {users.map(u => {
                      const plan = u.subscription_plan || 'trial';
                      const planInfo = PLAN_LABELS[plan] || PLAN_LABELS.trial;
                      const isExpired = u.subscription_end_date && new Date(u.subscription_end_date) < new Date();
                      return (
                        <tr key={u.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                          <td className="px-4 py-3 font-semibold text-gray-800">{u.name}</td>
                          <td className="px-4 py-3 text-gray-500">{u.email}</td>
                          <td className="px-4 py-3">
                            <span className={`text-xs px-2 py-1 rounded-full font-semibold ${planInfo.color}`}>{planInfo.label}</span>
                          </td>
                          <td className="px-4 py-3">
                            <span className={`text-xs px-2 py-1 rounded-full font-semibold ${
                              u.subscription_status === 'active' && !isExpired ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'
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
                            <button onClick={() => openEditUser(u)}
                              className="text-xs bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 transition">
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

        {/* ── 탭 3: 회사 목록 ── */}
        {activeTab === 'companies' && (
          <div className="space-y-4">
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
                <b className="text-sm text-gray-800">👀 회사로 보기</b>
                <span className="text-xs text-gray-400">그 회사 관리자 화면을 그대로 열어서 문의를 확인해요 · 전체 {allCompanies.length}개 회사</span>
              </div>
              {allCompanies.map((c) => (
                <div key={c.id} className="flex items-center gap-3 px-4 py-2.5 border-b border-gray-50 last:border-0 text-sm">
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-gray-800 truncate">{c.name}</div>
                    <div className="text-xs text-gray-400 truncate">관리자 {c.admin || '-'} · 멤버 {c.count}명</div>
                  </div>
                  <button onClick={() => viewAsCompany(c.id, c.name)}
                    className="text-xs font-bold text-purple-700 bg-purple-50 hover:bg-purple-100 px-3 py-1.5 rounded-lg shrink-0">
                    이 회사로 보기 →
                  </button>
                </div>
              ))}
            </div>
            <p className="text-sm text-gray-500">
              Company 플랜 가입 회사 목록이에요. 총 <span className="font-bold text-gray-800">{companies.length}</span>개 회사
            </p>
            {companies.length === 0 ? (
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-12 text-center text-gray-400">
                <p className="text-4xl mb-2">🏢</p><p className="text-sm">등록된 회사가 없어요.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {companies.map(c => (
                  <div key={c.company_id} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <h3 className="font-black text-gray-800 text-base">{c.company_name}</h3>
                        <p className="text-xs text-gray-400 mt-0.5">ID: {c.company_id}</p>
                      </div>
                      <span className="bg-purple-100 text-purple-700 text-xs px-2 py-1 rounded-full font-semibold">Company</span>
                    </div>
                    {c.admin && (
                      <div className="bg-gray-50 rounded-xl p-3 mb-3">
                        <p className="text-xs text-gray-500 mb-1">관리자</p>
                        <p className="text-sm font-semibold text-gray-800">{c.admin.name}</p>
                        <p className="text-xs text-gray-400">{c.admin.email}</p>
                      </div>
                    )}
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-500">멤버 <span className="font-bold text-gray-800">{c.members.length}</span>명</span>
                      <span className="text-gray-500">최대 <span className="font-bold text-gray-800">{c.admin?.max_members || '-'}</span>명</span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-1">
                      {Array.from(new Set(c.members.map(m => m.team).filter(Boolean))).map(t => (
                        <span key={t} className="bg-blue-50 text-blue-600 text-xs px-2 py-0.5 rounded-full">{t}</span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── 탭 4: 통계 ── */}
        {activeTab === 'stats' && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                { label: '전체 가입자', value: stats.total,   color: 'blue',   icon: '👤' },
                { label: '체험판',       value: stats.trial,   color: 'gray',   icon: '🆓' },
                { label: 'Pro',          value: stats.pro,     color: 'blue',   icon: '⭐' },
                { label: 'Company',      value: stats.company, color: 'purple', icon: '🏢' },
              ].map(card => (
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
                    { label: '앱 가입', value: stats.fromApp, color: 'bg-blue-500'   },
                    { label: '웹 가입', value: stats.fromWeb, color: 'bg-indigo-500' },
                  ].map(item => (
                    <div key={item.label}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-gray-600">{item.label}</span>
                        <span className="font-bold text-gray-800">{item.value}명</span>
                      </div>
                      <div className="w-full bg-gray-100 rounded-full h-2">
                        <div className={`${item.color} h-2 rounded-full`}
                          style={{ width: `${stats.total ? (item.value / stats.total) * 100 : 0}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
                <h3 className="font-bold text-gray-800 mb-4">💳 플랜 현황</h3>
                <div className="space-y-3">
                  {[
                    { label: '체험판', value: stats.trial,   color: 'bg-gray-400'   },
                    { label: 'Pro',    value: stats.pro,     color: 'bg-blue-500'   },
                    { label: 'Company',value: stats.company, color: 'bg-purple-500' },
                    { label: '만료',   value: stats.expired, color: 'bg-red-400'    },
                  ].map(item => (
                    <div key={item.label}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-gray-600">{item.label}</span>
                        <span className="font-bold text-gray-800">
                          {item.value}명 ({stats.total ? Math.round((item.value / stats.total) * 100) : 0}%)
                        </span>
                      </div>
                      <div className="w-full bg-gray-100 rounded-full h-2">
                        <div className={`${item.color} h-2 rounded-full`}
                          style={{ width: `${stats.total ? (item.value / stats.total) * 100 : 0}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {[
                { label: '만료된 계정', value: stats.expired,         icon: '⚠️', color: 'text-red-500'    },
                { label: 'SuperAdmin',  value: stats.superAdmins,      icon: '👑', color: 'text-yellow-600' },
                { label: '등록 회사',   value: companies.length,        icon: '🏢', color: 'text-purple-600' },
              ].map(card => (
                <div key={card.label} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 text-center">
                  <p className="text-2xl mb-1">{card.icon}</p>
                  <p className={`text-2xl font-black ${card.color}`}>{card.value}</p>
                  <p className="text-xs text-gray-500 mt-1">{card.label}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── 탭 5: 계정 관리 ── */}
        {activeTab === 'accounts' && (
          <div className="space-y-4">
            <p className="text-sm text-gray-500">계정 정지, 권한 변경, 강제 탈퇴를 관리해요.</p>
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      {['이름', '이메일', '역할', '상태', 'SuperAdmin', '관리'].map(h => (
                        <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {users.map(u => (
                      <tr key={u.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3 font-semibold text-gray-800">{u.name}</td>
                        <td className="px-4 py-3 text-gray-500 text-xs">{u.email}</td>
                        <td className="px-4 py-3">
                          <span className={`text-xs px-2 py-1 rounded-full ${
                            u.role === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-600'
                          }`}>
                            {u.role === 'admin' ? '관리자' : '멤버'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-xs px-2 py-1 rounded-full font-semibold ${
                            u.status === 'suspended' ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-600'
                          }`}>
                            {u.status === 'suspended' ? '정지' : '정상'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {u.super_admin ? <span className="text-yellow-500 font-bold">👑 Yes</span> : <span className="text-gray-300 text-xs">-</span>}
                        </td>
                        <td className="px-4 py-3">
                          <button onClick={() => setManageUser(u)}
                            className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1.5 rounded-lg transition">
                            관리
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* 목록에 안 나오는 가입 계정 */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-100 flex-wrap">
                <div>
                  <p className="font-bold text-gray-800 text-sm">
                    목록에 없는 가입 계정 {orphans && <span className="text-red-500">{orphans.length}</span>}
                  </p>
                  <p className="text-xs text-gray-400">로그인 계정은 있는데 회원 정보가 없어 위 목록에 안 나오는 계정이에요. (가입 중단·이전 탈퇴 잔여)</p>
                </div>
                <div className="flex gap-2">
                  <button onClick={loadOrphans} disabled={orphanLoading}
                    className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1.5 rounded-lg transition disabled:opacity-50">
                    {orphanLoading ? '불러오는 중...' : '새로고침'}
                  </button>
                  <button onClick={purgeOrphans} disabled={orphanLoading || !orphans?.length}
                    className="text-xs bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 rounded-lg font-semibold transition disabled:opacity-40">
                    전부 정리
                  </button>
                </div>
              </div>
              {orphanErr ? (
                <p className="px-4 py-6 text-sm text-red-500">{orphanErr}</p>
              ) : !orphans?.length ? (
                <p className="px-4 py-6 text-sm text-gray-400 text-center">{orphanLoading ? '불러오는 중...' : '정리할 계정이 없어요.'}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-100">
                        {['이메일', '가입 방식', '가입일', '마지막 로그인', ''].map(h => (
                          <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {orphans.map(o => (
                        <tr key={o.id} className="border-b border-gray-50">
                          <td className="px-4 py-3 text-gray-700 text-xs">{o.email || o.id}</td>
                          <td className="px-4 py-3 text-gray-500 text-xs">{o.provider}</td>
                          <td className="px-4 py-3 text-gray-500 text-xs">{formatDate(o.created_at)}</td>
                          <td className="px-4 py-3 text-gray-500 text-xs">{formatDateTime(o.last_sign_in_at)}</td>
                          <td className="px-4 py-3">
                            <button onClick={() => deleteOrphan(o)}
                              className="text-xs bg-red-100 hover:bg-red-200 text-red-600 px-3 py-1.5 rounded-lg transition">삭제</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── 탭 6: Q&A 관리 ── */}
        {activeTab === 'qna' && (
          <div className="space-y-4">
            <p className="text-sm text-gray-500">
              전체 기술 Q&A를 관리해요. 총 <span className="font-bold text-gray-800">{qnaList.length}</span>개
            </p>
            {qnaList.length === 0 ? (
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-12 text-center text-gray-400">
                <p className="text-4xl mb-2">💬</p><p className="text-sm">등록된 Q&A가 없어요.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {qnaList.map(q => (
                  <div key={q.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          {q.brand_label && (
                            <span className="bg-blue-100 text-blue-700 text-xs px-2 py-0.5 rounded-full font-semibold">{q.brand_label}</span>
                          )}
                          {q.tag && (
                            <span className="bg-gray-100 text-gray-600 text-xs px-2 py-0.5 rounded-full">{q.tag}</span>
                          )}
                          {!q.is_public && (
                            <span className="bg-yellow-100 text-yellow-700 text-xs px-2 py-0.5 rounded-full">🔒 비공개</span>
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
                      <button onClick={() => handleDeleteQna(q.id)}
                        className="text-xs text-red-400 hover:text-red-600 transition flex-shrink-0 border border-red-200 hover:border-red-400 px-2 py-1 rounded-lg">
                        삭제
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── 탭 7: 시스템 점검 ── */}
        {activeTab === 'health' && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <p className="text-sm text-gray-500 flex-1">데이터 상태를 한 번에 점검해요. 빨간색은 숫자가 틀어지는 원인이니 정리하는 게 좋아요.</p>
              <button onClick={loadHealth} disabled={healthLoading} className="text-sm bg-gray-900 text-white px-4 py-2 rounded-xl font-semibold disabled:opacity-50">
                {healthLoading ? '점검 중...' : '다시 점검'}
              </button>
            </div>
            {!health ? (
              <div className="bg-white rounded-2xl border border-gray-100 p-12 text-center text-gray-400 text-sm">{healthLoading ? '점검 중...' : '다시 점검을 눌러주세요'}</div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {health.map((h) => (
                  <div key={h.label} className={`bg-white rounded-2xl border p-4 ${h.level === 'bad' ? 'border-red-200' : h.level === 'warn' ? 'border-amber-200' : 'border-gray-100'}`}>
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${h.level === 'bad' ? 'bg-red-500' : h.level === 'warn' ? 'bg-amber-500' : 'bg-green-500'}`} />
                      <span className="text-sm font-semibold text-gray-700">{h.label}</span>
                    </div>
                    <div className={`text-2xl font-black mt-1 ${h.level === 'bad' ? 'text-red-600' : h.level === 'warn' ? 'text-amber-600' : 'text-gray-900'}`}>{typeof h.value === 'number' ? h.value.toLocaleString() : h.value}</div>
                    <div className="text-xs text-gray-400 mt-1">{h.hint}</div>
                    {h.sql && typeof h.value === 'number' && h.value > 0 && (
                      <button onClick={() => { navigator.clipboard?.writeText(h.sql!); alert('정리 SQL을 복사했어요. Supabase SQL Editor에 붙여넣어 실행하세요.'); }}
                        className="mt-2 text-xs font-semibold text-blue-600">정리 SQL 복사</button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── 탭 8: 최근 활동 ── */}
        {activeTab === 'activity' && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <p className="text-sm text-gray-500 flex-1">전체 회사의 최근 고장·견적·휴가·가입 활동이에요.</p>
              <button onClick={loadActivity} disabled={activityLoading} className="text-sm bg-gray-900 text-white px-4 py-2 rounded-xl font-semibold disabled:opacity-50">
                {activityLoading ? '불러오는 중...' : '새로고침'}
              </button>
            </div>
            <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
              {!activity || activity.length === 0 ? (
                <div className="p-12 text-center text-gray-400 text-sm">{activityLoading ? '불러오는 중...' : '활동이 없어요'}</div>
              ) : activity.map((a, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-3 border-b border-gray-50 last:border-0 text-sm">
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-md shrink-0 ${
                    a.kind === '고장' ? 'bg-red-50 text-red-600' : a.kind === '견적' ? 'bg-blue-50 text-blue-600' : a.kind === '휴가' ? 'bg-green-50 text-green-600' : 'bg-purple-50 text-purple-600'}`}>{a.kind}</span>
                  <span className="text-gray-400 text-xs shrink-0 w-28 truncate">{a.company}</span>
                  <span className="flex-1 min-w-0 truncate text-gray-700">{a.text}</span>
                  <span className="text-xs text-gray-400 shrink-0">{formatDateTime(a.at)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── 탭 9: 공지사항 ── */}
        {activeTab === 'notice' && (
          <div className="space-y-4">
            {noticeErr && (
              <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-2xl p-4 text-sm">
                공지 테이블이 아직 없어요. Supabase SQL Editor에서 안내된 <b>announcements</b> 테이블 생성 SQL을 실행해 주세요.
                <div className="text-xs mt-1 opacity-70">{noticeErr}</div>
              </div>
            )}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 space-y-3">
              <b className="text-sm text-gray-800">새 공지</b>
              <input value={nForm.title} onChange={(e) => setNForm({ ...nForm, title: e.target.value })} placeholder="제목 (예: 10월 10일 02:00~04:00 서버 점검)"
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm" />
              <input value={nForm.body} onChange={(e) => setNForm({ ...nForm, body: e.target.value })} placeholder="내용 (선택) — 한 줄로 표시돼요"
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm" />
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                <select value={nForm.level} onChange={(e) => setNForm({ ...nForm, level: e.target.value })} className="border border-gray-200 rounded-xl px-3 py-2 text-sm">
                  <option value="info">📢 일반 (파랑)</option>
                  <option value="warn">⚠️ 점검·주의 (주황)</option>
                  <option value="urgent">🚨 긴급 (빨강)</option>
                </select>
                <select value={nForm.target} onChange={(e) => setNForm({ ...nForm, target: e.target.value })} className="border border-gray-200 rounded-xl px-3 py-2 text-sm">
                  <option value="">모든 회사</option>
                  {allCompanies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <label className="text-xs text-gray-500">시작 (비우면 지금)
                  <input type="datetime-local" value={nForm.starts_at} onChange={(e) => setNForm({ ...nForm, starts_at: e.target.value })} className="w-full border border-gray-200 rounded-xl px-2 py-1.5 text-sm mt-0.5" />
                </label>
                <label className="text-xs text-gray-500">종료 (비우면 계속)
                  <input type="datetime-local" value={nForm.ends_at} onChange={(e) => setNForm({ ...nForm, ends_at: e.target.value })} className="w-full border border-gray-200 rounded-xl px-2 py-1.5 text-sm mt-0.5" />
                </label>
              </div>
              <button onClick={saveNotice} disabled={nSaving} className="bg-gray-900 text-white text-sm font-semibold px-5 py-2 rounded-xl disabled:opacity-50">
                {nSaving ? '등록 중...' : '공지 등록'}
              </button>
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
              {(notices || []).length === 0 ? (
                <div className="p-10 text-center text-gray-400 text-sm">등록된 공지가 없어요</div>
              ) : (notices || []).map((n) => {
                const ended = n.ends_at && new Date(n.ends_at) < new Date();
                const target = n.target_company_id ? (allCompanies.find((c) => c.id === n.target_company_id)?.name || n.target_company_id) : '모든 회사';
                return (
                  <div key={n.id} className={`flex items-center gap-3 px-4 py-3 border-b border-gray-50 last:border-0 text-sm ${!n.active || ended ? 'opacity-50' : ''}`}>
                    <span>{n.level === 'urgent' ? '🚨' : n.level === 'warn' ? '⚠️' : '📢'}</span>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-gray-800 truncate">{n.title}</div>
                      <div className="text-xs text-gray-400 truncate">
                        {target} · {formatDateTime(n.starts_at)} ~ {n.ends_at ? formatDateTime(n.ends_at) : '계속'}{ended ? ' · 종료됨' : ''}
                      </div>
                    </div>
                    <button onClick={() => toggleNotice(n)} className={`text-xs font-bold px-2.5 py-1 rounded-lg ${n.active ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {n.active ? '표시 중' : '숨김'}
                    </button>
                    <button onClick={() => deleteNotice(n)} className="text-xs text-red-400 hover:text-red-600">삭제</button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

      </main>

      {/* ── 구독 수정 모달 ── */}
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
                {PLAN_OPTIONS.map(p => (
                  <button key={p} onClick={() => setEditPlan(p)}
                    className={`py-2 rounded-xl text-sm font-semibold border-2 transition-all ${
                      editPlan === p ? 'border-blue-500 bg-blue-600 text-white' : 'border-gray-200 text-gray-600 hover:border-blue-300'
                    }`}>
                    {PLAN_LABELS[p]?.label || p}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">구독 상태</label>
              <div className="flex gap-2">
                {['active', 'expired', 'cancelled'].map(s => (
                  <button key={s} onClick={() => setEditStatus(s)}
                    className={`flex-1 py-2 rounded-xl text-sm font-semibold border-2 transition-all ${
                      editStatus === s ? 'border-blue-500 bg-blue-600 text-white' : 'border-gray-200 text-gray-600 hover:border-blue-300'
                    }`}>
                    {s === 'active' ? '활성' : s === 'expired' ? '만료' : '취소'}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">만료일</label>
              <input type="date" value={editEndDate} onChange={e => setEditEndDate(e.target.value)}
                className="w-full border border-gray-300 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
            {editPlan === 'company' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">최대 인원</label>
                <div className="grid grid-cols-4 gap-2">
                  {[5, 10, 15, 20, 30, 50, 100].map(n => (
                    <button key={n} onClick={() => setEditMaxMembers(n)}
                      className={`py-2 rounded-xl text-sm font-semibold border-2 transition-all ${
                        editMaxMembers === n ? 'border-blue-500 bg-blue-600 text-white' : 'border-gray-200 text-gray-600 hover:border-blue-300'
                      }`}>
                      {n}명
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="flex gap-3 pt-2">
              <button onClick={() => setEditUser(null)}
                className="flex-1 border border-gray-300 text-gray-600 py-3 rounded-xl font-semibold hover:bg-gray-50 transition">취소</button>
              <button onClick={saveSubscription} disabled={editLoading}
                className="flex-1 bg-blue-600 text-white py-3 rounded-xl font-semibold hover:bg-blue-700 transition disabled:opacity-50">
                {editLoading ? '저장 중...' : '저장'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 계정 관리 모달 ── */}
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
                {PLAN_LABELS[manageUser.subscription_plan || 'trial']?.label} · {manageUser.role === 'admin' ? '관리자' : '멤버'}
              </p>
            </div>
            <div className="space-y-2">
              <button onClick={() => handleToggleStatus(manageUser)} disabled={manageLoading}
                className={`w-full py-3 rounded-xl font-semibold text-sm transition ${
                  manageUser.status === 'suspended'
                    ? 'bg-green-100 text-green-700 hover:bg-green-200'
                    : 'bg-orange-100 text-orange-700 hover:bg-orange-200'
                }`}>
                {manageUser.status === 'suspended' ? '✅ 계정 복구' : '⏸️ 계정 정지'}
              </button>
              <button onClick={() => handleToggleSuperAdmin(manageUser)} disabled={manageLoading}
                className={`w-full py-3 rounded-xl font-semibold text-sm transition ${
                  manageUser.super_admin
                    ? 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}>
                {manageUser.super_admin ? '👑 SuperAdmin 해제' : '👑 SuperAdmin 부여'}
              </button>
              <button onClick={() => handleDeleteUser(manageUser)} disabled={manageLoading}
                className="w-full py-3 rounded-xl font-semibold text-sm bg-red-100 text-red-600 hover:bg-red-200 transition">
                🗑️ 강제 탈퇴
              </button>
            </div>
            <button onClick={() => setManageUser(null)}
              className="w-full border border-gray-200 text-gray-600 py-2.5 rounded-xl text-sm font-semibold hover:bg-gray-50 transition">
              닫기
            </button>
          </div>
        </div>
      )}

      <TabBar active="admin" />
    </div>
  );
}


