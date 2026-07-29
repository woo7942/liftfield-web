'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

// ── 타입 ──────────────────────────────────────────
interface UserInfo {
  uid: string;
  name: string;
  companyId: string;
  companyDisplayName: string;
  role: string;
  superAdmin: boolean;
}

interface Team {
  id: string;
  name: string;
}

interface Site {
  id: string;
  name: string;
  teamName?: string;
}

interface InspectionRecord {
  id: string;
  siteId: string;
  siteName: string;
  teamName: string;
  scheduledDate: string;
  completedDate?: string;
  totalCount: number;
  completedCount: number;
  status: '예정' | '진행중' | '완료';
  note?: string;
  createdAt?: string;
}

const STATUS_COLOR: Record<string, string> = {
  '예정':   'bg-gray-100 text-gray-600',
  '진행중': 'bg-blue-100 text-blue-600',
  '완료':   'bg-green-100 text-green-600',
};

const MONTHS = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];

// ── 컴포넌트 ──────────────────────────────────────
export default function InspectionPage() {
  const router = useRouter();
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(true);

  // 데이터
  const [records, setRecords] = useState<InspectionRecord[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [sites, setSites] = useState<Site[]>([]);

  // 필터
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [activeTeam, setActiveTeam] = useState('전체');

  // 모달
  const [addModal, setAddModal] = useState(false);
  const [editModal, setEditModal] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<InspectionRecord | null>(null);

  // 폼
  const [form, setForm] = useState({
    siteId: '',
    siteName: '',
    teamName: '',
    scheduledDate: '',
    totalCount: '',
    completedCount: '',
    status: '예정' as InspectionRecord['status'],
    note: '',
  });
  const [submitting, setSubmitting] = useState(false);

  // ── 인증 ──────────────────────────────────────
  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.push('/login'); return; }

      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('name, company_id, company_display_name, role, super_admin')
        .eq('id', session.user.id)
        .single();

      if (userError || !userData) { router.push('/login'); return; }

      const isSuperAdmin = userData.super_admin === true;
      const isAdmin = userData.role === 'admin';
      if (!isSuperAdmin && !isAdmin) { router.push('/'); return; }

      setUserInfo({
        uid: session.user.id,
        name: userData.name || '',
        companyId: userData.company_id || '',
        companyDisplayName: userData.company_display_name || '',
        role: userData.role || 'member',
        superAdmin: isSuperAdmin,
      });
      setLoading(false);
    };

    init();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => { if (!session) router.push('/login'); }
    );
    return () => subscription.unsubscribe();
  }, []);

  // ── 팀 목록 로드 ──────────────────────────────
  useEffect(() => {
    if (!userInfo) return;
    const loadTeams = async () => {
      const { data, error } = await supabase
        .from('teams')
        .select('id, name')
        .eq('company_id', userInfo.companyId)
        .order('name', { ascending: true });

      if (error) { console.error(error); return; }
      setTeams((data || []).map((t: any) => ({ id: t.id, name: t.name || '' })));
    };
    loadTeams();
  }, [userInfo]);

  // ── 현장 목록 로드 ────────────────────────────
  useEffect(() => {
    if (!userInfo) return;
    const loadSites = async () => {
      const { data, error } = await supabase
        .from('sites')
        .select('id, name, site_name, team_name')
        .eq('company_id', userInfo.companyId);

      if (error) { console.error(error); return; }
      setSites(
        (data || []).map((s: any) => ({
          id: s.id,
          name: s.name || s.site_name || '',
          teamName: s.team_name || '',
        }))
      );
    };
    loadSites();
  }, [userInfo]);

  // ── 점검 기록 로드 ────────────────────────────
  useEffect(() => {
    if (!userInfo) return;
    const loadRecords = async () => {
      setLoading(true);
      const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
      const endDate   = `${year}-${String(month).padStart(2, '0')}-31`;

      const { data, error } = await supabase
        .from('inspections')
        .select('*')
        .eq('company_id', userInfo.companyId)
        .gte('scheduled_date', startDate)
        .lte('scheduled_date', endDate)
        .order('scheduled_date', { ascending: true });

      if (error) { console.error(error); setLoading(false); return; }

      setRecords(
        (data || []).map((r: any) => ({
          id:             r.id,
          siteId:         r.site_id,
          siteName:       r.site_name,
          teamName:       r.team_name,
          scheduledDate:  r.scheduled_date,
          completedDate:  r.completed_date,
          totalCount:     r.total_count || 0,
          completedCount: r.completed_count || 0,
          status:         r.status,
          note:           r.note || '',
          createdAt:      r.created_at,
        }))
      );
      setLoading(false);
    };
    loadRecords();
  }, [userInfo, year, month]);

  // ── 팀 필터 적용 ──────────────────────────────
  const filteredRecords = activeTeam === '전체'
    ? records
    : records.filter(r => r.teamName === activeTeam);

  // ── 통계 ──────────────────────────────────────
  const stats = {
    total:      filteredRecords.length,
    done:       filteredRecords.filter(r => r.status === '완료').length,
    inProgress: filteredRecords.filter(r => r.status === '진행중').length,
    planned:    filteredRecords.filter(r => r.status === '예정').length,
    rate: filteredRecords.length > 0
      ? Math.round(
          filteredRecords.filter(r => r.status === '완료').length /
          filteredRecords.length * 100
        )
      : 0,
  };

  // ── 현장 선택 시 팀 자동 세팅 ─────────────────
  const handleSiteChange = (siteId: string) => {
    const site = sites.find(s => s.id === siteId);
    setForm(f => ({
      ...f,
      siteId,
      siteName: site?.name || '',
      teamName: site?.teamName || f.teamName,
    }));
  };

  // ── 추가 ──────────────────────────────────────
  const handleAdd = async () => {
    if (!form.siteId || !form.scheduledDate) {
      alert('현장과 점검일은 필수예요!');
      return;
    }
    setSubmitting(true);
    try {
      const { error } = await supabase
        .from('inspections')
        .insert({
          company_id:      userInfo!.companyId,
          site_id:         form.siteId,
          site_name:       form.siteName,
          team_name:       form.teamName,
          scheduled_date:  form.scheduledDate,
          total_count:     Number(form.totalCount) || 0,
          completed_count: Number(form.completedCount) || 0,
          status:          form.status,
          note:            form.note.trim(),
          created_at:      new Date().toISOString(),
        });

      if (error) throw error;

      // 목록 새로고침
      const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
      const endDate   = `${year}-${String(month).padStart(2, '0')}-31`;
      const { data: refreshed } = await supabase
        .from('inspections')
        .select('*')
        .eq('company_id', userInfo!.companyId)
        .gte('scheduled_date', startDate)
        .lte('scheduled_date', endDate)
        .order('scheduled_date', { ascending: true });

      setRecords(
        (refreshed || []).map((r: any) => ({
          id:             r.id,
          siteId:         r.site_id,
          siteName:       r.site_name,
          teamName:       r.team_name,
          scheduledDate:  r.scheduled_date,
          completedDate:  r.completed_date,
          totalCount:     r.total_count || 0,
          completedCount: r.completed_count || 0,
          status:         r.status,
          note:           r.note || '',
          createdAt:      r.created_at,
        }))
      );

      setAddModal(false);
      resetForm();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  // ── 수정 ──────────────────────────────────────
  const handleEdit = async () => {
    if (!selectedRecord) return;
    setSubmitting(true);
    try {
      const { error } = await supabase
        .from('inspections')
        .update({
          site_id:         form.siteId,
          site_name:       form.siteName,
          team_name:       form.teamName,
          scheduled_date:  form.scheduledDate,
          total_count:     Number(form.totalCount) || 0,
          completed_count: Number(form.completedCount) || 0,
          status:          form.status,
          note:            form.note.trim(),
          updated_at:      new Date().toISOString(),
        })
        .eq('id', selectedRecord.id)
        .eq('company_id', userInfo!.companyId);

      if (error) throw error;

      // 로컬 상태 업데이트
      setRecords(prev =>
        prev.map(r =>
          r.id === selectedRecord.id
            ? {
                ...r,
                siteId:         form.siteId,
                siteName:       form.siteName,
                teamName:       form.teamName,
                scheduledDate:  form.scheduledDate,
                totalCount:     Number(form.totalCount) || 0,
                completedCount: Number(form.completedCount) || 0,
                status:         form.status,
                note:           form.note.trim(),
              }
            : r
        )
      );

      setEditModal(false);
      setSelectedRecord(null);
      resetForm();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  // ── 삭제 ──────────────────────────────────────
  const handleDelete = async (id: string) => {
    if (!confirm('삭제하시겠어요?')) return;
    const { error } = await supabase
      .from('inspections')
      .delete()
      .eq('id', id)
      .eq('company_id', userInfo!.companyId);

    if (error) { alert(error.message); return; }

    setRecords(prev => prev.filter(r => r.id !== id));
    setEditModal(false);
    setSelectedRecord(null);
  };

  // ── 빠른 상태 변경 ────────────────────────────
  const cycleStatus = async (record: InspectionRecord) => {
    const next: Record<string, InspectionRecord['status']> = {
      '예정': '진행중', '진행중': '완료', '완료': '예정',
    };
    const newStatus = next[record.status];

    const { error } = await supabase
      .from('inspections')
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq('id', record.id)
      .eq('company_id', userInfo!.companyId);

    if (error) { alert(error.message); return; }

    setRecords(prev =>
      prev.map(r => r.id === record.id ? { ...r, status: newStatus } : r)
    );
  };

  const resetForm = () => setForm({
    siteId: '', siteName: '', teamName: '', scheduledDate: '',
    totalCount: '', completedCount: '', status: '예정', note: '',
  });

  const openEdit = (r: InspectionRecord) => {
    setSelectedRecord(r);
    setForm({
      siteId:         r.siteId,
      siteName:       r.siteName,
      teamName:       r.teamName,
      scheduledDate:  r.scheduledDate,
      totalCount:     String(r.totalCount),
      completedCount: String(r.completedCount),
      status:         r.status,
      note:           r.note || '',
    });
    setEditModal(true);
  };

  // ── 월 이동 ───────────────────────────────────
  const prevMonth = () => {
    if (month === 1) { setYear(y => y - 1); setMonth(12); }
    else setMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (month === 12) { setYear(y => y + 1); setMonth(1); }
    else setMonth(m => m + 1);
  };

  if (loading && !userInfo) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // ── 폼 공통 렌더 ──────────────────────────────
  const renderForm = () => (
    <div className="space-y-3">
      <div>
        <label className="text-xs font-bold text-gray-500 uppercase mb-1 block">현장</label>
        <select
          className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
          value={form.siteId}
          onChange={e => handleSiteChange(e.target.value)}
        >
          <option value="">현장 선택</option>
          {sites.map(s => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="text-xs font-bold text-gray-500 uppercase mb-1 block">팀</label>
        <select
          className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
          value={form.teamName}
          onChange={e => setForm(f => ({ ...f, teamName: e.target.value }))}
        >
          <option value="">팀 선택</option>
          {teams.map(t => (
            <option key={t.id} value={t.name}>{t.name}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="text-xs font-bold text-gray-500 uppercase mb-1 block">점검일</label>
        <input
          type="date"
          className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
          value={form.scheduledDate}
          onChange={e => setForm(f => ({ ...f, scheduledDate: e.target.value }))}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-bold text-gray-500 uppercase mb-1 block">전체 호기</label>
          <input
            type="number" min="0"
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            value={form.totalCount}
            onChange={e => setForm(f => ({ ...f, totalCount: e.target.value }))}
            placeholder="0"
          />
        </div>
        <div>
          <label className="text-xs font-bold text-gray-500 uppercase mb-1 block">완료 호기</label>
          <input
            type="number" min="0"
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            value={form.completedCount}
            onChange={e => setForm(f => ({ ...f, completedCount: e.target.value }))}
            placeholder="0"
          />
        </div>
      </div>

      <div>
        <label className="text-xs font-bold text-gray-500 uppercase mb-1 block">상태</label>
        <div className="flex gap-2">
          {(['예정','진행중','완료'] as const).map(s => (
            <button
              key={s}
              type="button"
              onClick={() => setForm(f => ({ ...f, status: s }))}
              className={`flex-1 py-2 rounded-xl text-sm font-semibold border transition ${
                form.status === s
                  ? s === '완료'   ? 'bg-green-500 text-white border-green-500'
                  : s === '진행중' ? 'bg-blue-500 text-white border-blue-500'
                  : 'bg-gray-500 text-white border-gray-500'
                  : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="text-xs font-bold text-gray-500 uppercase mb-1 block">메모 (선택)</label>
        <textarea
          className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none"
          rows={2}
          value={form.note}
          onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
          placeholder="특이사항 등"
        />
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 헤더 */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => router.push('/')} className="text-gray-400 hover:text-gray-600 text-sm">
              ← 홈
            </button>
            <span className="text-gray-300">|</span>
            <h1 className="text-lg font-bold text-gray-800">📋 점검 관리</h1>
            {userInfo?.companyDisplayName && (
              <span className="bg-indigo-100 text-indigo-700 text-xs px-2 py-1 rounded-full font-semibold">
                🏢 {userInfo.companyDisplayName}
              </span>
            )}
          </div>
          <button
            onClick={() => { resetForm(); setAddModal(true); }}
            className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2 rounded-xl transition"
          >
            + 점검 추가
          </button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6 space-y-5">

        {/* 월 선택 */}
        <div className="flex items-center justify-between bg-white rounded-2xl border border-gray-100 shadow-sm px-5 py-4">
          <button onClick={prevMonth} className="text-gray-400 hover:text-gray-700 text-xl font-bold px-2">‹</button>
          <div className="text-center">
            <p className="text-xl font-black text-gray-800">{year}년 {MONTHS[month - 1]}</p>
            <p className="text-xs text-gray-400 mt-0.5">점검 일정</p>
          </div>
          <button onClick={nextMonth} className="text-gray-400 hover:text-gray-700 text-xl font-bold px-2">›</button>
        </div>

        {/* 통계 카드 */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: '전체',   value: stats.total,      color: 'text-gray-700',   bg: 'bg-gray-50',   icon: '📋' },
            { label: '완료',   value: stats.done,       color: 'text-green-600',  bg: 'bg-green-50',  icon: '✅' },
            { label: '진행중', value: stats.inProgress, color: 'text-blue-600',   bg: 'bg-blue-50',   icon: '🔄' },
            { label: '완료율', value: `${stats.rate}%`, color: 'text-purple-600', bg: 'bg-purple-50', icon: '📊' },
          ].map(c => (
            <div key={c.label} className={`${c.bg} rounded-2xl border border-gray-100 p-4 shadow-sm`}>
              <p className="text-xs text-gray-500 mb-1">{c.icon} {c.label}</p>
              <p className={`text-2xl font-black ${c.color}`}>{c.value}</p>
            </div>
          ))}
        </div>

        {/* 팀 필터 탭 */}
        <div className="flex gap-2 overflow-x-auto pb-1">
          {['전체', ...teams.map(t => t.name)].map(team => (
            <button
              key={team}
              onClick={() => setActiveTeam(team)}
              className={`whitespace-nowrap px-4 py-2 rounded-xl text-sm font-semibold transition ${
                activeTeam === team
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'bg-white text-gray-500 border border-gray-200 hover:bg-gray-50'
              }`}
            >
              {team}
            </button>
          ))}
        </div>

        {/* 점검 목록 */}
        {loading ? (
          <div className="flex justify-center py-16">
            <div className="w-8 h-8 border-4 border-blue-400 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filteredRecords.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-16 text-center text-gray-400">
            <p className="text-4xl mb-3">📋</p>
            <p className="text-sm">이번 달 점검 일정이 없어요.<br />+ 점검 추가 버튼으로 등록해주세요!</p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="text-left px-4 py-3 text-xs font-bold text-gray-500 uppercase">현장</th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-gray-500 uppercase">팀</th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-gray-500 uppercase">점검일</th>
                  <th className="text-center px-4 py-3 text-xs font-bold text-gray-500 uppercase">호기</th>
                  <th className="text-center px-4 py-3 text-xs font-bold text-gray-500 uppercase">완료율</th>
                  <th className="text-center px-4 py-3 text-xs font-bold text-gray-500 uppercase">상태</th>
                  <th className="text-center px-4 py-3 text-xs font-bold text-gray-500 uppercase">수정</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filteredRecords.map(r => {
                  const rate = r.totalCount > 0
                    ? Math.round(r.completedCount / r.totalCount * 100)
                    : 0;
                  return (
                    <tr key={r.id} className="hover:bg-gray-50 transition">
                      <td className="px-4 py-3 font-semibold text-gray-800">{r.siteName}</td>
                      <td className="px-4 py-3 text-gray-500">
                        <span className="bg-indigo-50 text-indigo-600 text-xs px-2 py-0.5 rounded-full font-semibold">
                          {r.teamName || '-'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-500">{r.scheduledDate}</td>
                      <td className="px-4 py-3 text-center text-gray-600">
                        {r.completedCount}/{r.totalCount}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 bg-gray-100 rounded-full h-1.5 min-w-[60px]">
                            <div
                              className={`h-1.5 rounded-full transition-all ${
                                rate === 100 ? 'bg-green-500' : rate > 50 ? 'bg-blue-500' : 'bg-yellow-400'
                              }`}
                              style={{ width: `${rate}%` }}
                            />
                          </div>
                          <span className="text-xs text-gray-500 w-8 text-right">{rate}%</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() => cycleStatus(r)}
                          className={`text-xs px-2.5 py-1 rounded-full font-semibold cursor-pointer transition hover:opacity-80 ${STATUS_COLOR[r.status]}`}
                        >
                          {r.status}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() => openEdit(r)}
                          className="text-xs text-blue-500 hover:text-blue-700 font-semibold transition"
                        >
                          ✏️ 수정
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>

      {/* ── 추가 모달 ── */}
      {addModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="p-5 border-b border-gray-100 flex items-center justify-between sticky top-0 bg-white">
              <h2 className="text-lg font-black text-gray-800">📋 점검 추가</h2>
              <button onClick={() => setAddModal(false)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>
            <div className="p-5">
              {renderForm()}
              <div className="flex gap-3 mt-5">
                <button
                  onClick={() => setAddModal(false)}
                  className="flex-1 py-3 rounded-xl border border-gray-200 text-gray-600 font-semibold hover:bg-gray-50 transition"
                >
                  취소
                </button>
                <button
                  onClick={handleAdd}
                  disabled={submitting}
                  className="flex-1 py-3 rounded-xl bg-blue-600 text-white font-semibold hover:bg-blue-700 transition disabled:opacity-60"
                >
                  {submitting ? '저장 중...' : '추가'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── 수정 모달 ── */}
      {editModal && selectedRecord && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="p-5 border-b border-gray-100 flex items-center justify-between sticky top-0 bg-white">
              <h2 className="text-lg font-black text-gray-800">✏️ 점검 수정</h2>
              <button
                onClick={() => { setEditModal(false); setSelectedRecord(null); }}
                className="text-gray-400 hover:text-gray-600 text-xl"
              >✕</button>
            </div>
            <div className="p-5">
              {renderForm()}
              <div className="flex gap-3 mt-5">
                <button
                  onClick={() => handleDelete(selectedRecord.id)}
                  className="px-4 py-3 rounded-xl bg-red-50 text-red-500 font-semibold hover:bg-red-100 transition"
                >
                  🗑️
                </button>
                <button
                  onClick={() => { setEditModal(false); setSelectedRecord(null); }}
                  className="flex-1 py-3 rounded-xl border border-gray-200 text-gray-600 font-semibold hover:bg-gray-50 transition"
                >
                  취소
                </button>
                <button
                  onClick={handleEdit}
                  disabled={submitting}
                  className="flex-1 py-3 rounded-xl bg-blue-600 text-white font-semibold hover:bg-blue-700 transition disabled:opacity-60"
                >
                  {submitting ? '저장 중...' : '저장'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
