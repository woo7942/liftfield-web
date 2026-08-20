'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

// ─── 타입 정의 ───
interface UserInfo {
  uid: string;
  name: string;
  email: string;
  companyId: string;
  companyDisplayName: string;
  team: string;
  role: string;
  superAdmin?: boolean;
}

interface SiteItem {
  id: string;
  name: string;
  address?: string;
  elevatorCount?: number;
  phone?: string;
  region?: string;
  teamName?: string;
  source?: 'admin' | 'member' | 'team';

  createdAt?: string;
  managerName?: string;
  memo?: string;
}

interface ElevatorItem {
  id: string;
  hogiNo?: string;
  type?: string;
  status?: string;
  installDate?: string;
  inspectionDate?: string;
}

type SortKey = 'name' | 'teamName' | 'elevatorCount' | 'region';

export default function TeamSitesPage() {
  const router = useRouter();

  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [sites, setSites] = useState<SiteItem[]>([]);
  const [teams, setTeams] = useState<string[]>([]);

  // 호기
  const [siteElevators, setSiteElevators] = useState<ElevatorItem[]>([]);
  const [elevatorsLoading, setElevatorsLoading] = useState(false);
  const [totalElevatorCount, setTotalElevatorCount] = useState(0);

  // 필터/정렬
  const [selectedTeam, setSelectedTeam] = useState('전체');
  const [searchText, setSearchText] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortAsc, setSortAsc] = useState(true);

  // 추가/수정 모달
  const [showAddModal, setShowAddModal] = useState(false);
  const [addForm, setAddForm] = useState<Partial<SiteItem>>({});
  const [addLoading, setAddLoading] = useState(false);
  const [selectedSite, setSelectedSite] = useState<SiteItem | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editForm, setEditForm] = useState<Partial<SiteItem>>({});

  const isAdmin = userInfo?.role === 'admin';
  const isSuperAdmin = userInfo?.superAdmin === true;
  const canEdit = isAdmin || isSuperAdmin;

  // ─── 인증 ───
  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.push('/login'); return; }

      const { data: userData, error } = await supabase
        .from('users')
        .select('name, email, company_id, company_display_name, team, role, super_admin')
        .eq('id', session.user.id)
        .single();

      if (error || !userData) { router.push('/login'); return; }
      if (!userData.company_id) { router.push('/'); return; }

      setUserInfo({
        uid: session.user.id,
        name: userData.name || '',
        email: userData.email || session.user.email || '',
        companyId: userData.company_id,
        companyDisplayName: userData.company_display_name || '',
        team: userData.team || '',
        role: userData.role || 'member',
        superAdmin: userData.super_admin || false,
      });
      setLoading(false);
    };

    init();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) router.push('/login');
    });

    return () => subscription.unsubscribe();
  }, [router]);

  // ─── 현장 목록 로드 (source === 'team' 인 팀별현장만) ───
const reloadSites = async (companyId?: string) => {
  const cid = companyId ?? userInfo?.companyId;
  if (!cid) return;

  const isAdminUser = userInfo?.role === 'admin' || userInfo?.superAdmin === true;
  const myTeam = (userInfo?.team || '').trim();

  // 기사인데 팀 미배정이면 아무것도 안 보여줌
  if (!isAdminUser && !myTeam) {
    setSites([]);
    setTeams([]);
    setTotalElevatorCount(0);
    return;
  }

  let query = supabase
  .from('sites')
  .select('id, name, address, elevator_count, phone, region, team, source, created_at, manager_name, memo')
  .eq('company_id', cid);

if (!isAdminUser) {
  query = query.eq('team', myTeam);
}


  const { data: sitesData, error } = await query.order('created_at', { ascending: false });

  if (error) { console.error(error); return; }

  const list: SiteItem[] = (sitesData || []).map(d => ({
    id: d.id,
    name: d.name || '',
    address: d.address || '',
    elevatorCount: d.elevator_count || 0,
    phone: d.phone || '',
    region: d.region || '',
    teamName: d.team || '',
    source: d.source as 'admin' | 'member' | 'team',
    createdAt: d.created_at,
    managerName: d.manager_name || '',
    memo: d.memo || '',
  }));

  setSites(list);

  // 교체
const { data: teamRows } = await supabase
  .from('users')
  .select('team')
  .eq('company_id', cid)
  .not('team', 'is', null);

const teamSet = new Set<string>();
(teamRows || []).forEach(r => { const t = (r.team || '').trim(); if (t) teamSet.add(t); });
list.forEach(s => { const t = (s.teamName || '').trim(); if (t) teamSet.add(t); });
setTeams(Array.from(teamSet).sort());



    // 전체 호기 수 집계
    const siteIds = list.map(s => s.id);
    if (siteIds.length > 0) {
      const { count, error: elevError } = await supabase
        .from('elevators')
        .select('id', { count: 'exact', head: true })
        .in('site_id', siteIds);

      if (!elevError) setTotalElevatorCount(count || 0);
    } else {
      setTotalElevatorCount(0);
    }
  };

  useEffect(() => {
    if (!userInfo?.companyId) return;
    reloadSites(userInfo.companyId).catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userInfo?.companyId]);

  // ─── 현장 클릭 시 호기 로드 ───
  async function handleSiteClick(site: SiteItem) {
    setSelectedSite(site);
    setEditForm(site);
    setEditMode(false);
    setSiteElevators([]);
    setElevatorsLoading(true);

    try {
      const { data, error } = await supabase
        .from('elevators')
        .select('id, hogi_no, type, status, install_date, inspection_date')
        .eq('site_id', site.id);

      if (error) throw error;

      setSiteElevators((data || []).map(d => ({
        id: d.id,
        hogiNo: d.hogi_no || '',
        type: d.type || '',
        status: d.status || '',
        installDate: d.install_date || '',
        inspectionDate: d.inspection_date || '',
      })));
    } catch (e) {
      console.error(e);
    } finally {
      setElevatorsLoading(false);
    }
  }

  // ─── 필터 + 정렬 ───
  const filteredSites = sites
    .filter(s => {
      if (!canEdit && s.teamName !== userInfo?.team) return false;
      if (canEdit && selectedTeam !== '전체' && s.teamName !== selectedTeam) return false;
      if (searchText) {
        const q = searchText.toLowerCase();
        return (
          s.name?.toLowerCase().includes(q) ||
          s.teamName?.toLowerCase().includes(q) ||
          s.region?.toLowerCase().includes(q) ||
          s.managerName?.toLowerCase().includes(q)
        );
      }
      return true;
    })
    .sort((a, b) => {
      let valA: string | number = '';
      let valB: string | number = '';
      if (sortKey === 'name') { valA = a.name || ''; valB = b.name || ''; }
      else if (sortKey === 'teamName') { valA = a.teamName || ''; valB = b.teamName || ''; }
      else if (sortKey === 'elevatorCount') { valA = a.elevatorCount || 0; valB = b.elevatorCount || 0; }
      else if (sortKey === 'region') { valA = a.region || ''; valB = b.region || ''; }
      if (valA < valB) return sortAsc ? -1 : 1;
      if (valA > valB) return sortAsc ? 1 : -1;
      return 0;
    });

    const filteredElevatorCount = filteredSites.reduce((sum, s) => sum + (s.elevatorCount || 0), 0);


  function handleSort(key: SortKey) {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(true); }
  }

  function SortIcon({ k }: { k: SortKey }) {
    if (sortKey !== k) return <span className="text-gray-300 ml-1">↕</span>;
    return <span className="text-blue-500 ml-1">{sortAsc ? '↑' : '↓'}</span>;
  }

  // ─── 현장 추가 ───
  async function handleAddSite() {
    if (!addForm.name?.trim() || !userInfo?.companyId) return;
    setAddLoading(true);
    try {
      const { error } = await supabase.from('sites').insert({
        name: addForm.name,
        address: addForm.address || '',
        phone: addForm.phone || '',
        region: addForm.region || '',
        elevator_count: addForm.elevatorCount || 0,
        team: addForm.teamName || '',
        manager_name: addForm.managerName || '',
        memo: addForm.memo || '',
        source: 'member',
        company_id: userInfo.companyId,
        created_by: userInfo.uid,
        created_at: new Date().toISOString(),
      });

      if (error) throw error;

      setShowAddModal(false);
      setAddForm({});
      await reloadSites();
    } catch (e) {
      console.error(e);
    } finally {
      setAddLoading(false);
    }
  }

  // ─── 현장 수정 ───
  async function handleEditSave() {
    if (!selectedSite || !userInfo?.companyId) return;
    try {
      const { error } = await supabase
        .from('sites')
        .update({
          name: editForm.name,
          address: editForm.address || '',
          phone: editForm.phone || '',
          region: editForm.region || '',
          elevator_count: editForm.elevatorCount || 0,
          team: editForm.teamName || '',
          manager_name: editForm.managerName || '',
          memo: editForm.memo || '',
          updated_at: new Date().toISOString(),
        })
        .eq('id', selectedSite.id);

      if (error) throw error;

      const updated = { ...selectedSite, ...editForm };
      setEditMode(false);
      setSelectedSite(updated);
      setSites(prev => prev.map(s => s.id === selectedSite.id ? updated : s));
    } catch (e) {
      console.error(e);
    }
  }

  // ─── 현장 삭제 ───
  async function handleDeleteSite(siteId: string) {
    if (!userInfo?.companyId) return;
    if (!confirm('현장을 삭제할까요?')) return;
    try {
      const { error } = await supabase
        .from('sites')
        .delete()
        .eq('id', siteId);

      if (error) throw error;

      setSelectedSite(null);
      setSites(prev => prev.filter(s => s.id !== siteId));
    } catch (e) {
      console.error(e);
      alert('❌ 삭제 중 오류가 발생했어요.');
    }
  }

  // ─── 전체 삭제 ───
  async function handleDeleteAll() {
    if (!userInfo?.companyId) return;
    const confirm1 = confirm('⚠️ 팀별현장을 전부 삭제할까요?\n이 작업은 되돌릴 수 없어요!');
    if (!confirm1) return;
    const input = prompt('확인을 위해 "전체삭제" 를 입력해주세요:');
    if (input !== '전체삭제') { alert('취소됐어요.'); return; }

    try {
      const siteIds = sites.map(s => s.id);
      if (siteIds.length === 0) return;

      const { error } = await supabase
        .from('sites')
        .delete()
        .in('id', siteIds);

      if (error) throw error;

      await reloadSites();
      alert(`✅ ${siteIds.length}개 현장이 삭제됐어요.`);
    } catch (e) {
      console.error(e);
      alert('❌ 삭제 중 오류가 발생했어요.');
    }
  }

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <p className="text-gray-500">로딩 중...</p>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 헤더 */}
      <header className="bg-white border-b px-4 py-3 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-2">
          <button onClick={() => router.push('/dashboard')} className="text-gray-500 hover:text-gray-700 text-lg">←</button>
          <h1 className="font-bold text-lg">🏢 팀별 현장</h1>
          <span className="text-sm text-gray-400">({filteredSites.length}개)</span>
        </div>
        {canEdit && (
          <div className="flex gap-2">
            <button
              onClick={() => setShowAddModal(true)}
              className="text-sm bg-blue-500 hover:bg-blue-600 text-white px-3 py-1.5 rounded-lg font-medium"
            >
              + 추가
            </button>
            <button
              onClick={handleDeleteAll}
              className="text-sm bg-red-500 hover:bg-red-600 text-white px-3 py-1.5 rounded-lg font-medium"
            >
              🗑️ 전체삭제
            </button>
          </div>
        )}
      </header>

      <div className="max-w-7xl mx-auto px-4 py-4">

        {/* 검색 + 필터 */}
        <div className="flex flex-wrap gap-2 mb-3">
          <input
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
            placeholder="현장명, 팀명, 지역, 담당자 검색..."
            className="flex-1 min-w-48 border rounded-xl px-3 py-2 text-sm bg-white"
          />
          {canEdit && (
            <select
              value={selectedTeam}
              onChange={e => setSelectedTeam(e.target.value)}
              className="border rounded-xl px-3 py-2 text-sm bg-white"
            >
              <option value="전체">전체 팀</option>
              {teams.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          )}
        </div>

        {/* 테이블 */}
        <div className="bg-white rounded-xl border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b">
                  <th className="text-left px-3 py-2.5 font-semibold text-gray-600 whitespace-nowrap">
                    <button onClick={() => handleSort('name')} className="flex items-center hover:text-blue-600">
                      현장명 <SortIcon k="name" />
                    </button>
                  </th>
                  <th className="text-center px-3 py-2.5 font-semibold text-gray-600 whitespace-nowrap">
                    <button onClick={() => handleSort('teamName')} className="flex items-center justify-center hover:text-blue-600">
                      팀 <SortIcon k="teamName" />
                    </button>
                  </th>
                  <th className="text-center px-3 py-2.5 font-semibold text-gray-600 whitespace-nowrap">
                    <button onClick={() => handleSort('elevatorCount')} className="flex items-center justify-center hover:text-blue-600">
                      대수 <SortIcon k="elevatorCount" />
                    </button>
                  </th>
                  <th className="text-center px-3 py-2.5 font-semibold text-gray-600 whitespace-nowrap">담당자</th>
                  <th className="text-center px-3 py-2.5 font-semibold text-gray-600 whitespace-nowrap">전화번호</th>
                  <th className="text-center px-3 py-2.5 font-semibold text-gray-600 whitespace-nowrap">
                    <button onClick={() => handleSort('region')} className="flex items-center justify-center hover:text-blue-600">
                      지역 <SortIcon k="region" />
                    </button>
                  </th>
                  <th className="text-left px-3 py-2.5 font-semibold text-gray-600 whitespace-nowrap">주소</th>
                  {canEdit && <th className="text-center px-3 py-2.5 font-semibold text-gray-600 whitespace-nowrap">관리</th>}
                </tr>
              </thead>
              <tbody>
  {filteredSites.length === 0 ? (
    <tr>
      <td colSpan={canEdit ? 8 : 7} className="text-center py-16 text-gray-400">
        <p className="text-3xl mb-2">🏢</p>
        {canEdit && selectedTeam !== '전체' ? (
          <>
            <p className="text-gray-500">{selectedTeam}에 배정된 현장이 없어요</p>
            <p className="text-xs mt-1">+ 추가 버튼으로 배정하거나, 기존 현장을 수정해 팀을 바꿀 수 있어요</p>
          </>
        ) : (
          <p>팀별 현장이 없어요</p>
        )}
      </td>
    </tr>
  ) : (
    filteredSites.map((site, idx) => (

                    <tr
                      key={site.id}
                      onClick={() => handleSiteClick(site)}
                      className={`border-b last:border-0 cursor-pointer hover:bg-blue-50 transition-colors ${idx % 2 === 0 ? '' : 'bg-gray-50/50'}`}
                    >
                      <td className="px-3 py-2.5 font-medium text-gray-800 whitespace-nowrap">{site.name}</td>
                      <td className="px-3 py-2.5 text-center whitespace-nowrap">
                        {site.teamName ? (
                          <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">{site.teamName}</span>
                        ) : '-'}
                      </td>
                      <td className="px-3 py-2.5 text-center text-gray-600 whitespace-nowrap">
                        {site.elevatorCount ? `${site.elevatorCount}대` : '-'}
                      </td>
                      <td className="px-3 py-2.5 text-center text-gray-600 whitespace-nowrap">
                        {site.managerName || '-'}
                      </td>
                      <td className="px-3 py-2.5 text-center text-gray-600 whitespace-nowrap">
                        {site.phone || '-'}
                      </td>
                      <td className="px-3 py-2.5 text-center text-gray-600 whitespace-nowrap">
                        {site.region || '-'}
                      </td>
                      <td className="px-3 py-2.5 text-gray-600 max-w-xs truncate">
                        {site.address || '-'}
                      </td>
                      {canEdit && (
                        <td className="px-3 py-2.5 text-center" onClick={e => e.stopPropagation()}>
                          <button
                            onClick={() => handleDeleteSite(site.id)}
                            className="text-xs text-red-400 hover:text-red-600 px-2 py-1 rounded hover:bg-red-50"
                          >
                            삭제
                          </button>
                        </td>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* 하단 합계 */}
{filteredSites.length > 0 && (
  <div className="bg-gray-50 border-t px-3 py-2 flex gap-4 text-xs text-gray-500">
    <span>총 <strong className="text-gray-700">{filteredSites.length}</strong>개 현장</span>
    <span>승강기 <strong className="text-gray-700">{filteredElevatorCount}</strong>대</span>
  </div>
)}

        </div>
      </div>

      {/* ─── 현장 추가 모달 ─── */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto p-5">
            <h2 className="font-bold text-lg mb-4">+ 팀별 현장 추가</h2>
            <div className="space-y-3">
              {[
                { label: '현장명 *', field: 'name', type: 'text' },
                { label: '주소', field: 'address', type: 'text' },
                { label: '담당자', field: 'managerName', type: 'text' },
                { label: '전화번호', field: 'phone', type: 'text' },
                { label: '승강기 대수', field: 'elevatorCount', type: 'number' },
                { label: '지역', field: 'region', type: 'text' },
                { label: '메모', field: 'memo', type: 'text' },
              ].map(({ label, field, type }) => (
                <div key={field}>
                  <label className="text-sm text-gray-600 mb-0.5 block">{label}</label>
                  <input
                    type={type}
                    value={(addForm as Record<string, unknown>)[field] as string || ''}
                    onChange={e => setAddForm(prev => ({
                      ...prev,
                      [field]: type === 'number' ? Number(e.target.value) : e.target.value,
                    }))}
                    className="w-full border rounded-xl px-3 py-2 text-sm"
                  />
                </div>
              ))}
              <div>
                <label className="text-sm text-gray-600 mb-0.5 block">팀 배정</label>
                <select
                  value={addForm.teamName || ''}
                  onChange={e => setAddForm(prev => ({ ...prev, teamName: e.target.value }))}
                  className="w-full border rounded-xl px-3 py-2 text-sm"
                >
                  <option value="">팀 미배정</option>
                  {teams.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={() => setShowAddModal(false)} className="flex-1 py-2 border rounded-xl text-sm text-gray-600">취소</button>
              <button onClick={handleAddSite} disabled={addLoading}
                className="flex-1 py-2 bg-blue-500 text-white rounded-xl text-sm font-medium disabled:opacity-50">
                {addLoading ? '저장 중...' : '저장'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── 현장 상세 모달 ─── */}
      {selectedSite && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-lg">{selectedSite.name}</h2>
              <button onClick={() => setSelectedSite(null)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>

            {!editMode ? (
              <>
                <div className="space-y-1.5 text-sm">
                  {[
                    { label: '배정 팀', value: selectedSite.teamName },
                    { label: '담당자', value: selectedSite.managerName },
                    { label: '전화번호', value: selectedSite.phone },
                    { label: '승강기 대수', value: selectedSite.elevatorCount ? `${selectedSite.elevatorCount}대` : undefined },
                    { label: '지역', value: selectedSite.region },
                    { label: '주소', value: selectedSite.address },
                    { label: '메모', value: selectedSite.memo },
                  ].filter(i => i.value).map(({ label, value }) => (
                    <div key={label} className="flex justify-between py-1.5 border-b last:border-0">
                      <span className="text-gray-500">{label}</span>
                      <span className="font-medium text-gray-800">{value}</span>
                    </div>
                  ))}
                </div>

                {/* 호기 목록 */}
                <div className="mt-4">
                  <h3 className="font-semibold text-sm text-gray-700 mb-2">
                    🔧 호기 목록 ({siteElevators.length}대)
                  </h3>
                  {elevatorsLoading ? (
                    <p className="text-sm text-gray-400 text-center py-3">로딩 중...</p>
                  ) : siteElevators.length === 0 ? (
                    <p className="text-sm text-gray-400 text-center py-3">등록된 호기가 없어요</p>
                  ) : (
                    <div className="space-y-1.5">
                      {siteElevators.map(elev => (
                        <div key={elev.id} className="bg-gray-50 rounded-xl px-3 py-2 text-sm flex justify-between items-center">
                          <span className="font-medium">{elev.hogiNo || elev.id}</span>
                          <span className="text-gray-500">{elev.type || '-'}</span>
                          <span className={`text-xs px-2 py-0.5 rounded-full ${
                            elev.status === '정상' ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'
                          }`}>
                            {elev.status || '-'}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {canEdit && (
                  <div className="flex gap-2 mt-4">
                    <button onClick={() => handleDeleteSite(selectedSite.id)}
                      className="flex-1 py-2 border border-red-300 text-red-500 rounded-xl text-sm">삭제</button>
                    <button onClick={() => setEditMode(true)}
                      className="flex-1 py-2 bg-blue-500 text-white rounded-xl text-sm font-medium">수정</button>
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="space-y-3">
                  {[
                    { label: '현장명', field: 'name', type: 'text' },
                    { label: '주소', field: 'address', type: 'text' },
                    { label: '담당자', field: 'managerName', type: 'text' },
                    { label: '전화번호', field: 'phone', type: 'text' },
                    { label: '승강기 대수', field: 'elevatorCount', type: 'number' },
                    { label: '지역', field: 'region', type: 'text' },
                    { label: '메모', field: 'memo', type: 'text' },
                  ].map(({ label, field, type }) => (
                    <div key={field}>
                      <label className="text-sm text-gray-600 mb-0.5 block">{label}</label>
                      <input
                        type={type}
                        value={(editForm as Record<string, unknown>)[field] as string || ''}
                        onChange={e => setEditForm(prev => ({
                          ...prev,
                          [field]: type === 'number' ? Number(e.target.value) : e.target.value,
                        }))}
                        className="w-full border rounded-xl px-3 py-2 text-sm"
                      />
                    </div>
                  ))}
                  <div>
                    <label className="text-sm text-gray-600 mb-0.5 block">팀 배정</label>
                    <select
                      value={editForm.teamName || ''}
                      onChange={e => setEditForm(prev => ({ ...prev, teamName: e.target.value }))}
                      className="w-full border rounded-xl px-3 py-2 text-sm"
                    >
                      <option value="">팀 미배정</option>
                      {teams.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                </div>
                <div className="flex gap-2 mt-4">
                  <button onClick={() => setEditMode(false)} className="flex-1 py-2 border rounded-xl text-sm text-gray-600">취소</button>
                  <button onClick={handleEditSave} className="flex-1 py-2 bg-blue-500 text-white rounded-xl text-sm font-medium">저장</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
