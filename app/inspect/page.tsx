'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

// ─── 타입 ───
interface UserInfo {
  uid: string;
  name: string;
  company_id: string;
  company_display_name: string;
  team: string;
  role: string;
  super_admin?: boolean;
}

interface InspectionRecord {
  id: string;
  company_id: string;
  site_id: string;
  site_name: string;
  team_name: string;
  scheduled_date: string;
  status: '예정' | '완료' | '불합격' | '재검사';
  inspector?: string;
  note?: string;
  result?: string;
  defect_items?: string[];
  created_at?: string;
}

interface SafetyInspection {
  id: string;
  company_id: string;
  site_id: string;
  site_name: string;
  team_name: string;
  inspection_type: string;
  scheduled_date: string;
  status: '예정' | '완료' | '지적' | '시정완료';
  defect_description?: string;
  action_taken?: string;
  inspector?: string;
  note?: string;
  created_at?: string;
}

type TabType = 'inspections' | 'safety';
type StatusFilter = 'all' | '예정' | '완료' | '불합격' | '재검사' | '지적' | '시정완료';

const STATUS_COLORS: Record<string, string> = {
  '예정':     'bg-blue-100 text-blue-700',
  '완료':     'bg-green-100 text-green-700',
  '불합격':   'bg-red-100 text-red-600',
  '재검사':   'bg-orange-100 text-orange-600',
  '지적':     'bg-red-100 text-red-600',
  '시정완료': 'bg-emerald-100 text-emerald-700',
};

function toDateStr(v?: string) {
  if (!v) return '-';
  const d = new Date(v);
  return `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')}`;
}

export default function InspectPage() {
  const router = useRouter();

  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(true);

  const [activeTab, setActiveTab] = useState<TabType>('inspections');
  const [inspections, setInspections] = useState<InspectionRecord[]>([]);
  const [safetyList, setSafetyList] = useState<SafetyInspection[]>([]);
  const [dataLoading, setDataLoading] = useState(false);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [teamFilter, setTeamFilter] = useState('전체');
  const [searchText, setSearchText] = useState('');
  const [teams, setTeams] = useState<string[]>([]);

  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1);

  // 상세 모달
  const [selectedInspection, setSelectedInspection] = useState<InspectionRecord | null>(null);
  const [selectedSafety, setSelectedSafety] = useState<SafetyInspection | null>(null);

  const isAdmin = userInfo?.role === 'admin';
  const isSuperAdmin = userInfo?.super_admin === true;
  const canEdit = isAdmin || isSuperAdmin;

  // ─── 인증 ───
  useEffect(() => {
    const init = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) { router.push('/login'); return; }

        const { data: userData } = await supabase
          .from('users')
          .select('*')
          .eq('id', user.id)
          .single();

        if (!userData || !userData.company_id) { router.push('/'); return; }

        setUserInfo({
          uid: user.id,
          name: userData.name || '',
          company_id: userData.company_id,
          company_display_name: userData.company_display_name || '',
          team: userData.team || '',
          role: userData.role || 'member',
          super_admin: userData.super_admin || false,
        });
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    init();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') router.push('/login');
    });
    return () => subscription.unsubscribe();
  }, [router]);

  // ─── 데이터 로드 ───
  useEffect(() => {
    if (!userInfo?.company_id) return;
    const loadData = async () => {
      setDataLoading(true);
      try {
        const cid = userInfo.company_id;
        const startDate = `${selectedYear}-${String(selectedMonth).padStart(2,'0')}-01`;
        const endDate = new Date(selectedYear, selectedMonth, 0).toISOString().split('T')[0];

        if (activeTab === 'inspections') {
          let query = supabase
            .from('inspections')
            .select('*')
            .eq('company_id', cid)
            .gte('scheduled_date', startDate)
            .lte('scheduled_date', endDate)
            .order('scheduled_date', { ascending: true });

          // 일반 멤버는 자신의 팀만
          if (!canEdit) {
            query = query.eq('team_name', userInfo.team);
          }

          const { data, error } = await query;
          if (error) throw error;
          const list = (data || []) as InspectionRecord[];
          setInspections(list);

          // 팀 목록 추출
          const teamSet = new Set(list.map(i => i.team_name).filter(Boolean));
          setTeams(Array.from(teamSet));

        } else {
          let query = supabase
            .from('safety_inspections')
            .select('*')
            .eq('company_id', cid)
            .gte('scheduled_date', startDate)
            .lte('scheduled_date', endDate)
            .order('scheduled_date', { ascending: true });

          if (!canEdit) {
            query = query.eq('team_name', userInfo.team);
          }

          const { data, error } = await query;
          if (error) throw error;
          const list = (data || []) as SafetyInspection[];
          setSafetyList(list);

          const teamSet = new Set(list.map(i => i.team_name).filter(Boolean));
          setTeams(Array.from(teamSet));
        }
      } catch (e) {
        console.error(e);
      } finally {
        setDataLoading(false);
      }
    };
    loadData();
  }, [userInfo, activeTab, selectedYear, selectedMonth, canEdit]);

  // ─── 필터링 ───
  const filteredInspections = inspections.filter(i => {
    if (statusFilter !== 'all' && i.status !== statusFilter) return false;
    if (canEdit && teamFilter !== '전체' && i.team_name !== teamFilter) return false;
    if (searchText) {
      const q = searchText.toLowerCase();
      return i.site_name?.toLowerCase().includes(q) ||
        i.team_name?.toLowerCase().includes(q) ||
        i.inspector?.toLowerCase().includes(q);
    }
    return true;
  });

  const filteredSafety = safetyList.filter(i => {
    if (statusFilter !== 'all' && i.status !== statusFilter) return false;
    if (canEdit && teamFilter !== '전체' && i.team_name !== teamFilter) return false;
    if (searchText) {
      const q = searchText.toLowerCase();
      return i.site_name?.toLowerCase().includes(q) ||
        i.team_name?.toLowerCase().includes(q) ||
        i.inspection_type?.toLowerCase().includes(q);
    }
    return true;
  });

  // ─── 통계 ───
  const inspStats = {
    total: filteredInspections.length,
    completed: filteredInspections.filter(i => i.status === '완료').length,
    failed: filteredInspections.filter(i => i.status === '불합격').length,
    recheck: filteredInspections.filter(i => i.status === '재검사').length,
    scheduled: filteredInspections.filter(i => i.status === '예정').length,
  };

  const safetyStats = {
    total: filteredSafety.length,
    completed: filteredSafety.filter(i => i.status === '완료').length,
    defect: filteredSafety.filter(i => i.status === '지적').length,
    fixed: filteredSafety.filter(i => i.status === '시정완료').length,
    scheduled: filteredSafety.filter(i => i.status === '예정').length,
  };

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <p className="text-gray-500">로딩 중...</p>
    </div>
  );

  const INSP_STATUSES: StatusFilter[] = ['all', '예정', '완료', '불합격', '재검사'];
  const SAFETY_STATUSES: StatusFilter[] = ['all', '예정', '완료', '지적', '시정완료'];
  const currentStatuses = activeTab === 'inspections' ? INSP_STATUSES : SAFETY_STATUSES;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 헤더 */}
      <header className="bg-white border-b px-4 py-3 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-2">
          <button onClick={() => router.push('/')} className="text-gray-500 hover:text-gray-700 text-lg">←</button>
          <h1 className="font-bold text-lg">🔍 검사지적</h1>
        </div>
        {userInfo?.company_display_name && (
          <span className="text-xs text-gray-400 bg-gray-100 px-2 py-1 rounded-full">
            {userInfo.company_display_name}
          </span>
        )}
      </header>

      <div className="max-w-6xl mx-auto px-4 py-4">

        {/* 탭 */}
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => { setActiveTab('inspections'); setStatusFilter('all'); }}
            className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${
              activeTab === 'inspections' ? 'bg-blue-500 text-white' : 'bg-white text-gray-600 border'
            }`}
          >
            📋 법정검사
          </button>
          <button
            onClick={() => { setActiveTab('safety'); setStatusFilter('all'); }}
            className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${
              activeTab === 'safety' ? 'bg-orange-500 text-white' : 'bg-white text-gray-600 border'
            }`}
          >
            🛡️ 안전점검 지적
          </button>
        </div>

        {/* 월 선택 */}
        <div className="flex items-center gap-3 mb-4 bg-white rounded-xl border px-4 py-2.5">
          <button
            onClick={() => {
              if (selectedMonth === 1) { setSelectedYear(y => y - 1); setSelectedMonth(12); }
              else setSelectedMonth(m => m - 1);
            }}
            className="text-gray-500 hover:text-gray-700 font-bold text-lg px-1"
          >
            ‹
          </button>
          <span className="font-bold text-gray-800 flex-1 text-center">
            {selectedYear}년 {selectedMonth}월
          </span>
          <button
            onClick={() => {
              if (selectedMonth === 12) { setSelectedYear(y => y + 1); setSelectedMonth(1); }
              else setSelectedMonth(m => m + 1);
            }}
            className="text-gray-500 hover:text-gray-700 font-bold text-lg px-1"
          >
            ›
          </button>
        </div>

        {/* 통계 카드 */}
        {activeTab === 'inspections' ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            {[
              { label: '전체', value: inspStats.total, color: 'text-gray-700', bg: 'bg-white' },
              { label: '완료', value: inspStats.completed, color: 'text-green-600', bg: 'bg-green-50' },
              { label: '불합격', value: inspStats.failed, color: 'text-red-600', bg: 'bg-red-50' },
              { label: '재검사', value: inspStats.recheck, color: 'text-orange-600', bg: 'bg-orange-50' },
            ].map(card => (
              <div key={card.label} className={`${card.bg} rounded-xl border p-3 text-center`}>
                <p className="text-xs text-gray-500 mb-1">{card.label}</p>
                <p className={`text-2xl font-bold ${card.color}`}>{card.value}</p>
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            {[
              { label: '전체', value: safetyStats.total, color: 'text-gray-700', bg: 'bg-white' },
              { label: '완료', value: safetyStats.completed, color: 'text-green-600', bg: 'bg-green-50' },
              { label: '지적', value: safetyStats.defect, color: 'text-red-600', bg: 'bg-red-50' },
              { label: '시정완료', value: safetyStats.fixed, color: 'text-emerald-600', bg: 'bg-emerald-50' },
            ].map(card => (
              <div key={card.label} className={`${card.bg} rounded-xl border p-3 text-center`}>
                <p className="text-xs text-gray-500 mb-1">{card.label}</p>
                <p className={`text-2xl font-bold ${card.color}`}>{card.value}</p>
              </div>
            ))}
          </div>
        )}

        {/* 필터 */}
        <div className="flex flex-wrap gap-2 mb-3">
          <input
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
            placeholder="현장명, 팀명, 검사원 검색..."
            className="flex-1 min-w-48 border rounded-xl px-3 py-2 text-sm bg-white"
          />
          {canEdit && teams.length > 0 && (
            <select
              value={teamFilter}
              onChange={e => setTeamFilter(e.target.value)}
              className="border rounded-xl px-3 py-2 text-sm bg-white"
            >
              <option value="전체">전체 팀</option>
              {teams.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          )}
        </div>

        {/* 상태 필터 */}
        <div className="flex gap-2 mb-3 overflow-x-auto pb-1">
          {currentStatuses.map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
                statusFilter === s
                  ? 'bg-gray-800 text-white'
                  : 'bg-white border text-gray-600 hover:border-gray-400'
              }`}
            >
              {s === 'all' ? '전체' : s}
            </button>
          ))}
        </div>

        {/* 목록 */}
        {dataLoading ? (
          <div className="bg-white rounded-xl border p-16 text-center text-gray-400">
            <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-sm">로딩 중...</p>
          </div>
        ) : activeTab === 'inspections' ? (
          filteredInspections.length === 0 ? (
            <div className="bg-white rounded-xl border p-16 text-center text-gray-400">
              <p className="text-3xl mb-2">📋</p>
              <p>해당 월의 법정검사 기록이 없어요</p>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredInspections.map(item => (
                <button
                  key={item.id}
                  onClick={() => setSelectedInspection(item)}
                  className="w-full bg-white rounded-xl border hover:border-blue-300 hover:bg-blue-50 p-4 text-left transition-all"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${STATUS_COLORS[item.status] || 'bg-gray-100 text-gray-600'}`}>
                          {item.status}
                        </span>
                        {item.team_name && (
                          <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">
                            {item.team_name}
                          </span>
                        )}
                      </div>
                      <p className="font-semibold text-gray-800 text-sm">{item.site_name}</p>
                      {item.inspector && (
                        <p className="text-xs text-gray-400 mt-0.5">검사원: {item.inspector}</p>
                      )}
                      {item.defect_items && item.defect_items.length > 0 && (
                        <p className="text-xs text-red-500 mt-0.5">
                          ⚠️ 지적사항 {item.defect_items.length}건
                        </p>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xs font-medium text-gray-600">{toDateStr(item.scheduled_date)}</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )
        ) : (
          filteredSafety.length === 0 ? (
            <div className="bg-white rounded-xl border p-16 text-center text-gray-400">
              <p className="text-3xl mb-2">🛡️</p>
              <p>해당 월의 안전점검 지적 기록이 없어요</p>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredSafety.map(item => (
                <button
                  key={item.id}
                  onClick={() => setSelectedSafety(item)}
                  className="w-full bg-white rounded-xl border hover:border-orange-300 hover:bg-orange-50 p-4 text-left transition-all"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${STATUS_COLORS[item.status] || 'bg-gray-100 text-gray-600'}`}>
                          {item.status}
                        </span>
                        {item.inspection_type && (
                          <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                            {item.inspection_type}
                          </span>
                        )}
                        {item.team_name && (
                          <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">
                            {item.team_name}
                          </span>
                        )}
                      </div>
                      <p className="font-semibold text-gray-800 text-sm">{item.site_name}</p>
                      {item.defect_description && (
                        <p className="text-xs text-red-500 mt-0.5 line-clamp-1">
                          ⚠️ {item.defect_description}
                        </p>
                      )}
                      {item.action_taken && (
                        <p className="text-xs text-emerald-600 mt-0.5 line-clamp-1">
                          ✅ {item.action_taken}
                        </p>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xs font-medium text-gray-600">{toDateStr(item.scheduled_date)}</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )
        )}
      </div>

      {/* ─── 법정검사 상세 모달 ─── */}
      {selectedInspection && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-lg">📋 법정검사 상세</h2>
              <button onClick={() => setSelectedInspection(null)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>

            <div className="mb-3 flex items-center gap-2">
              <span className={`text-sm font-bold px-3 py-1 rounded-full ${STATUS_COLORS[selectedInspection.status] || 'bg-gray-100'}`}>
                {selectedInspection.status}
              </span>
            </div>

            <div className="space-y-2 text-sm">
              {[
                { label: '현장명', value: selectedInspection.site_name },
                { label: '팀', value: selectedInspection.team_name },
                { label: '검사일', value: toDateStr(selectedInspection.scheduled_date) },
                { label: '검사원', value: selectedInspection.inspector },
                { label: '결과', value: selectedInspection.result },
                { label: '비고', value: selectedInspection.note },
              ].filter(i => i.value).map(({ label, value }) => (
                <div key={label} className="flex justify-between py-1.5 border-b last:border-0">
                  <span className="text-gray-500">{label}</span>
                  <span className="font-medium text-gray-800 text-right max-w-[60%]">{value}</span>
                </div>
              ))}
            </div>

            {selectedInspection.defect_items && selectedInspection.defect_items.length > 0 && (
              <div className="mt-4">
                <p className="text-sm font-bold text-red-600 mb-2">⚠️ 지적사항</p>
                <div className="space-y-1">
                  {selectedInspection.defect_items.map((item, idx) => (
                    <div key={idx} className="bg-red-50 rounded-lg px-3 py-2 text-sm text-red-700">
                      {idx + 1}. {item}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <button
              onClick={() => setSelectedInspection(null)}
              className="mt-4 w-full py-2 border rounded-xl text-sm text-gray-600 hover:bg-gray-50"
            >
              닫기
            </button>
          </div>
        </div>
      )}

      {/* ─── 안전점검 상세 모달 ─── */}
      {selectedSafety && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-lg">🛡️ 안전점검 지적 상세</h2>
              <button onClick={() => setSelectedSafety(null)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>

            <div className="mb-3 flex items-center gap-2">
              <span className={`text-sm font-bold px-3 py-1 rounded-full ${STATUS_COLORS[selectedSafety.status] || 'bg-gray-100'}`}>
                {selectedSafety.status}
              </span>
              {selectedSafety.inspection_type && (
                <span className="text-sm bg-gray-100 text-gray-600 px-3 py-1 rounded-full">
                  {selectedSafety.inspection_type}
                </span>
              )}
            </div>

            <div className="space-y-2 text-sm">
              {[
                { label: '현장명', value: selectedSafety.site_name },
                { label: '팀', value: selectedSafety.team_name },
                { label: '점검일', value: toDateStr(selectedSafety.scheduled_date) },
                { label: '검사원', value: selectedSafety.inspector },
              ].filter(i => i.value).map(({ label, value }) => (
                <div key={label} className="flex justify-between py-1.5 border-b">
                  <span className="text-gray-500">{label}</span>
                  <span className="font-medium text-gray-800">{value}</span>
                </div>
              ))}
            </div>

            {selectedSafety.defect_description && (
              <div className="mt-4">
                <p className="text-sm font-bold text-red-600 mb-2">⚠️ 지적내용</p>
                <div className="bg-red-50 rounded-xl p-3 text-sm text-red-700 leading-relaxed whitespace-pre-wrap">
                  {selectedSafety.defect_description}
                </div>
              </div>
            )}

            {selectedSafety.action_taken && (
              <div className="mt-3">
                <p className="text-sm font-bold text-emerald-600 mb-2">✅ 시정조치</p>
                <div className="bg-emerald-50 rounded-xl p-3 text-sm text-emerald-700 leading-relaxed whitespace-pre-wrap">
                  {selectedSafety.action_taken}
                </div>
              </div>
            )}

            {selectedSafety.note && (
              <div className="mt-3">
                <p className="text-sm font-bold text-gray-600 mb-2">📝 비고</p>
                <div className="bg-gray-50 rounded-xl p-3 text-sm text-gray-600 leading-relaxed whitespace-pre-wrap">
                  {selectedSafety.note}
                </div>
              </div>
            )}

            <button
              onClick={() => setSelectedSafety(null)}
              className="mt-4 w-full py-2 border rounded-xl text-sm text-gray-600 hover:bg-gray-50"
            >
              닫기
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
