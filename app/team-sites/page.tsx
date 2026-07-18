'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

// ─── 타입 ───
interface UserInfo {
  uid: string;
  name: string;
  email: string;
  company_id: string;
  company_display_name: string;
  team: string;
  role: string;
  super_admin?: boolean;
}

interface SiteItem {
  id: string;
  name: string;
  address?: string;
  contract_number?: string;
  maintenance_fee?: number;
  elevator_count?: number;
  contract_start?: string;
  contract_end?: string;
  contract_type?: string;
  contract_person?: string;
  company_name?: string;
  phone?: string;
  email?: string;
  region?: string;
  team_name?: string;
  source?: 'admin' | 'member';
  created_at?: string;
}

interface ElevatorItem {
  id: string;
  hogi_no?: string;
  type?: string;
  status?: string;
  install_date?: string;
  inspection_date?: string;
}

// ─── 유틸 ───
function getDday(dateStr?: string): number | null {
  if (!dateStr) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr);
  target.setHours(0, 0, 0, 0);
  return Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function getExpiryInfo(dateStr?: string) {
  const d = getDday(dateStr);
  if (d === null) return null;
  if (d <= 0) return { label: '만료', color: 'bg-red-100 text-red-600', rowColor: 'bg-red-50', dot: '🔴' };
  if (d <= 30) return { label: `D-${d}`, color: 'bg-orange-100 text-orange-600', rowColor: 'bg-orange-50', dot: '🟠' };
  if (d <= 60) return { label: `D-${d}`, color: 'bg-yellow-100 text-yellow-600', rowColor: 'bg-yellow-50', dot: '🟡' };
  return { label: `D-${d}`, color: 'bg-green-100 text-green-600', rowColor: '', dot: '🟢' };
}

type SortKey = 'name' | 'contract_end' | 'maintenance_fee' | 'elevator_count' | 'team_name';

export default function TeamSitesPage() {
  const router = useRouter();

  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [sites, setSites] = useState<SiteItem[]>([]);
  const [teams, setTeams] = useState<string[]>([]);

  // 호기
  const [siteElevators, setSiteElevators] = useState<ElevatorItem[]>([]);
  const [elevatorsLoading, setElevatorsLoading] = useState(false);

  // 필터/정렬
  const [selectedTeam, setSelectedTeam] = useState('전체');
  const [searchText, setSearchText] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('team_name');
  const [sortAsc, setSortAsc] = useState(true);

  // 상세
  const [selectedSite, setSelectedSite] = useState<SiteItem | null>(null);

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
          email: user.email || '',
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

  // ─── 팀별현장 로드 (source=member) ───
  useEffect(() => {
    if (!userInfo?.company_id) return;
    const loadSites = async () => {
      let query = supabase
        .from('sites')
        .select('*')
        .eq('company_id', userInfo.company_id)
        .eq('source', 'member')
        .order('created_at', { ascending: false });

      // 일반 멤버는 자신의 팀 현장만 조회
      if (!canEdit) {
        query = query.eq('team_name', userInfo.team);
      }

      const { data, error } = await query;
      if (error) { console.error(error); return; }
      const list = (data || []) as SiteItem[];
      setSites(list);

      const teamSet = new Set(list.map(s => s.team_name).filter(Boolean) as string[]);
      setTeams(Array.from(teamSet));
    };
    loadSites();
  }, [userInfo?.company_id, canEdit, userInfo?.team]);

  // ─── 현장 클릭 → 호기 로드 ───
  async function handleSiteClick(site: SiteItem) {
    setSelectedSite(site);
    setSiteElevators([]);
    setElevatorsLoading(true);
    try {
      const { data, error } = await supabase
        .from('elevators')
        .select('*')
        .eq('site_id', site.id);
      if (error) throw error;
      setSiteElevators((data || []) as ElevatorItem[]);
    } catch (e) {
      console.error(e);
    } finally {
      setElevatorsLoading(false);
    }
  }

  // ─── 필터 + 정렬 ───
  const filteredSites = sites
    .filter(s => {
      if (canEdit && selectedTeam !== '전체' && s.team_name !== selectedTeam) return false;
      if (searchText) {
        const q = searchText.toLowerCase();
        return s.name?.toLowerCase().includes(q) ||
          s.company_name?.toLowerCase().includes(q) ||
          s.region?.toLowerCase().includes(q) ||
          s.team_name?.toLowerCase().includes(q);
      }
      return true;
    })
    .sort((a, b) => {
      let valA: string | number = '';
      let valB: string | number = '';
      if (sortKey === 'contract_end') {
        valA = a.contract_end || '9999';
        valB = b.contract_end || '9999';
      } else if (sortKey === 'maintenance_fee') {
        valA = a.maintenance_fee || 0;
        valB = b.maintenance_fee || 0;
      } else if (sortKey === 'elevator_count') {
        valA = a.elevator_count || 0;
        valB = b.elevator_count || 0;
      } else if (sortKey === 'name') {
        valA = a.name || '';
        valB = b.name || '';
      } else if (sortKey === 'team_name') {
        valA = a.team_name || '';
        valB = b.team_name || '';
      }
      if (valA < valB) return sortAsc ? -1 : 1;
      if (valA > valB) return sortAsc ? 1 : -1;
      return 0;
    });

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(true); }
  }

  function SortIcon({ k }: { k: SortKey }) {
    if (sortKey !== k) return <span className="text-gray-300 ml-1">↕</span>;
    return <span className="text-blue-500 ml-1">{sortAsc ? '↑' : '↓'}</span>;
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
          <button onClick={() => router.push('/')} className="text-gray-500 hover:text-gray-700 text-lg">←</button>
          <h1 className="font-bold text-lg">🏢 팀별 현장</h1>
          <span className="text-sm text-gray-400">({filteredSites.length}개)</span>
        </div>
        {userInfo?.company_display_name && (
          <span className="text-xs text-gray-400 bg-gray-100 px-2 py-1 rounded-full">
            {userInfo.company_display_name}
          </span>
        )}
      </header>

      <div className="max-w-7xl mx-auto px-4 py-4">

        {/* 팀별 요약 카드 */}
        {canEdit && teams.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 mb-4">
            {teams.map(teamName => {
              const teamSites = sites.filter(s => s.team_name === teamName);
              return (
                <button
                  key={teamName}
                  onClick={() => setSelectedTeam(selectedTeam === teamName ? '전체' : teamName)}
                  className={`bg-white rounded-xl border p-3 text-left transition-all ${
                    selectedTeam === teamName
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-200 hover:border-blue-300'
                  }`}
                >
                  <p className="text-xs text-gray-500 mb-1">🏢 {teamName}</p>
                  <p className="text-xl font-bold text-gray-800">{teamSites.length}</p>
                  <p className="text-xs text-gray-400">개 현장</p>
                </button>
              );
            })}
          </div>
        )}

        {/* 검색 + 필터 */}
        <div className="flex flex-wrap gap-2 mb-3">
          <input
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
            placeholder="현장명, 팀명, 업체명, 지역 검색..."
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
                  <th className="text-left px-3 py-2.5 font-semibold text-gray-600 whitespace-nowrap">
                    <button onClick={() => handleSort('team_name')} className="flex items-center hover:text-blue-600">
                      팀 <SortIcon k="team_name" />
                    </button>
                  </th>
                  <th className="text-left px-3 py-2.5 font-semibold text-gray-600 whitespace-nowrap">계약업체</th>
                  <th className="text-center px-3 py-2.5 font-semibold text-gray-600 whitespace-nowrap">유형</th>
                  <th className="text-center px-3 py-2.5 font-semibold text-gray-600 whitespace-nowrap">
                    <button onClick={() => handleSort('elevator_count')} className="flex items-center justify-center hover:text-blue-600">
                      대수 <SortIcon k="elevator_count" />
                    </button>
                  </th>
                  <th className="text-right px-3 py-2.5 font-semibold text-gray-600 whitespace-nowrap">
                    <button onClick={() => handleSort('maintenance_fee')} className="flex items-center justify-end hover:text-blue-600">
                      보수료 <SortIcon k="maintenance_fee" />
                    </button>
                  </th>
                  <th className="text-center px-3 py-2.5 font-semibold text-gray-600 whitespace-nowrap">
                    <button onClick={() => handleSort('contract_end')} className="flex items-center justify-center hover:text-blue-600">
                      계약만료 <SortIcon k="contract_end" />
                    </button>
                  </th>
                  <th className="text-center px-3 py-2.5 font-semibold text-gray-600 whitespace-nowrap">D-day</th>
                  <th className="text-center px-3 py-2.5 font-semibold text-gray-600 whitespace-nowrap">지역</th>
                </tr>
              </thead>
              <tbody>
                {filteredSites.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="text-center py-16 text-gray-400">
                      <p className="text-3xl mb-2">🏢</p>
                      <p>팀별 현장이 없어요</p>
                      <p className="text-xs mt-1">현장 등록은 앱(멤버)에서 추가할 수 있어요</p>
                    </td>
                  </tr>
                ) : (
                  filteredSites.map((site, idx) => {
                    const expiry = getExpiryInfo(site.contract_end);
                    return (
                      <tr
                        key={site.id}
                        onClick={() => handleSiteClick(site)}
                        className={`border-b last:border-0 cursor-pointer hover:bg-blue-50 transition-colors ${expiry?.rowColor || (idx % 2 === 0 ? '' : 'bg-gray-50/50')}`}
                      >
                        <td className="px-3 py-2.5 font-medium text-gray-800 whitespace-nowrap">{site.name}</td>
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          {site.team_name ? (
                            <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">
                              {site.team_name}
                            </span>
                          ) : '-'}
                        </td>
                        <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">{site.company_name || '-'}</td>
                        <td className="px-3 py-2.5 text-center whitespace-nowrap">
                          {site.contract_type ? (
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                              site.contract_type.includes('종합') ? 'bg-blue-100 text-blue-600' :
                              site.contract_type.includes('일반') ? 'bg-purple-100 text-purple-600' :
                              'bg-gray-100 text-gray-600'
                            }`}>
                              {site.contract_type}
                            </span>
                          ) : '-'}
                        </td>
                        <td className="px-3 py-2.5 text-center text-gray-600 whitespace-nowrap">
                          {site.elevator_count ? `${site.elevator_count}대` : '-'}
                        </td>
                        <td className="px-3 py-2.5 text-right text-gray-600 whitespace-nowrap">
                          {site.maintenance_fee ? `${site.maintenance_fee.toLocaleString()}` : '-'}
                        </td>
                        <td className="px-3 py-2.5 text-center text-gray-600 whitespace-nowrap">
                          {site.contract_end || '-'}
                        </td>
                        <td className="px-3 py-2.5 text-center whitespace-nowrap">
                          {expiry ? (
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${expiry.color}`}>
                              {expiry.label}
                            </span>
                          ) : '-'}
                        </td>
                        <td className="px-3 py-2.5 text-center text-gray-600 whitespace-nowrap">
                          {site.region || '-'}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* 하단 합계 */}
          {filteredSites.length > 0 && (
            <div className="bg-gray-50 border-t px-3 py-2 flex gap-4 text-xs text-gray-500">
              <span>총 <strong className="text-gray-700">{filteredSites.length}</strong>개 현장</span>
              <span>보수료 합계 <strong className="text-gray-700">{filteredSites.reduce((s, i) => s + (i.maintenance_fee || 0), 0).toLocaleString()}</strong>원</span>
            </div>
          )}
        </div>
      </div>

      {/* ─── 현장 상세 모달 ─── */}
      {selectedSite && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="font-bold text-lg">{selectedSite.name}</h2>
                {selectedSite.team_name && (
                  <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">
                    {selectedSite.team_name}
                  </span>
                )}
              </div>
              <button onClick={() => setSelectedSite(null)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>

            {selectedSite.contract_end && (() => {
              const expiry = getExpiryInfo(selectedSite.contract_end);
              return expiry ? (
                <div className={`mb-3 text-center py-2 rounded-xl text-sm font-medium ${expiry.color}`}>
                  {expiry.dot} 계약 만료 {expiry.label}
                </div>
              ) : null;
            })()}

            <div className="space-y-1.5 text-sm">
              {[
                { label: '계약업체', value: selectedSite.company_name },
                { label: '계약 유형', value: selectedSite.contract_type },
                { label: '승강기 대수', value: selectedSite.elevator_count ? `${selectedSite.elevator_count}대` : undefined },
                { label: '보수료', value: selectedSite.maintenance_fee ? `${selectedSite.maintenance_fee.toLocaleString()}원` : undefined },
                { label: '계약 시작일', value: selectedSite.contract_start },
                { label: '계약 만료일', value: selectedSite.contract_end },
                { label: '계약자', value: selectedSite.contract_person },
                { label: '전화번호', value: selectedSite.phone },
                { label: '이메일', value: selectedSite.email },
                { label: '지역', value: selectedSite.region },
                { label: '주소', value: selectedSite.address },
              ].filter(i => i.value).map(({ label, value }) => (
                <div key={label} className="flex justify-between py-1.5 border-b last:border-0">
                  <span className="text-gray-500">{label}</span>
                  <span className="font-medium text-gray-800">{value}</span>
                </div>
              ))}
            </div>

            {/* ─── 호기 목록 ─── */}
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
                      <span className="font-medium">{elev.hogi_no || elev.id}</span>
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

            <button
              onClick={() => setSelectedSite(null)}
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
