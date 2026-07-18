'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import * as XLSX from 'xlsx';

// ─── 타입 정의 ───
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
  if (d <= 0) return { label: '만료', color: 'bg-red-100 text-red-600', rowColor: 'bg-red-50', dot: '🔴', priority: 0 };
  if (d <= 30) return { label: `D-${d}`, color: 'bg-orange-100 text-orange-600', rowColor: 'bg-orange-50', dot: '🟠', priority: 1 };
  if (d <= 60) return { label: `D-${d}`, color: 'bg-yellow-100 text-yellow-600', rowColor: 'bg-yellow-50', dot: '🟡', priority: 2 };
  return { label: `D-${d}`, color: 'bg-green-100 text-green-600', rowColor: '', dot: '🟢', priority: 3 };
}

// ─── 헤더 매핑 (XLSX용 — camelCase 매핑 후 snake_case로 저장) ───
const HEADER_MAP: Record<string, keyof SiteItem> = {
  '현장명': 'name',
  '원장번호': 'contract_number',
  '원장변호': 'contract_number',
  '보수료': 'maintenance_fee',
  '대수': 'elevator_count',
  '계약일자': 'contract_start',
  '만료일자': 'contract_end',
  '생활유통': 'contract_type',
  '계약종류': 'contract_type',
  '계약 종류': 'contract_type',
  '전화번호': 'phone',
  '계약자': 'contract_person',
  '제약자': 'contract_person',
  '업체명': 'company_name',
  '계약업체': 'company_name',
  '지역': 'region',
  '주소': 'address',
  '메일주소': 'email',
  '이메일': 'email',
};

type SortKey = 'name' | 'contract_end' | 'maintenance_fee' | 'elevator_count' | 'company_name';
type ExpiryFilter = 'all' | 'expired' | 'urgent' | 'warning';

export default function SitesPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [sites, setSites] = useState<SiteItem[]>([]);
  const [teams, setTeams] = useState<string[]>([]);

  // 호기
  const [siteElevators, setSiteElevators] = useState<ElevatorItem[]>([]);
  const [elevatorsLoading, setElevatorsLoading] = useState(false);
  const [totalElevatorCount, setTotalElevatorCount] = useState(0);

  // 필터/정렬
  const [activeTab, setActiveTab] = useState<'contract' | 'team'>('contract');
  const [selectedTeam, setSelectedTeam] = useState('전체');
  const [selectedType, setSelectedType] = useState('전체');
  const [searchText, setSearchText] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('contract_end');
  const [sortAsc, setSortAsc] = useState(true);
  const [expiryFilter, setExpiryFilter] = useState<ExpiryFilter>('all');

  // 엑셀
  const [showExcelModal, setShowExcelModal] = useState(false);
  const [excelSheets, setExcelSheets] = useState<string[]>([]);
  const [selectedSheet, setSelectedSheet] = useState('');
  const [excelWorkbook, setExcelWorkbook] = useState<XLSX.WorkBook | null>(null);
  const [excelPreview, setExcelPreview] = useState<Partial<SiteItem>[]>([]);
  const [importTeam, setImportTeam] = useState('');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState('');

  // 추가/수정 모달
  const [showAddModal, setShowAddModal] = useState(false);
  const [addForm, setAddForm] = useState<Partial<SiteItem>>({});
  const [addLoading, setAddLoading] = useState(false);
  const [selectedSite, setSelectedSite] = useState<SiteItem | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editForm, setEditForm] = useState<Partial<SiteItem>>({});

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

  // ─── 현장 로드 ───
  useEffect(() => {
    if (!userInfo?.company_id) return;
    const loadSites = async () => {
      const { data, error } = await supabase
        .from('sites')
        .select('*')
        .eq('company_id', userInfo.company_id)
        .order('created_at', { ascending: false });

      if (error) { console.error(error); return; }
      const list = (data || []) as SiteItem[];
      setSites(list);

      const teamSet = new Set(list.map(s => s.team_name).filter(Boolean) as string[]);
      setTeams(Array.from(teamSet));

      // 전체 호기 수 합산
      const { count } = await supabase
        .from('elevators')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', userInfo.company_id);
      setTotalElevatorCount(count ?? 0);
    };
    loadSites();
  }, [userInfo?.company_id]);

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
      if (activeTab === 'contract' && s.source === 'member') return false;
      if (activeTab === 'team' && s.source === 'admin') return false;
      if (!canEdit && s.team_name !== userInfo?.team) return false;
      if (canEdit && selectedTeam !== '전체' && s.team_name !== selectedTeam) return false;
      if (selectedType !== '전체' && s.contract_type !== selectedType) return false;
      if (expiryFilter === 'expired') {
        const d = getDday(s.contract_end);
        if (d === null || d > 0) return false;
      }
      if (expiryFilter === 'urgent') {
        const d = getDday(s.contract_end);
        if (d === null || d <= 0 || d > 30) return false;
      }
      if (expiryFilter === 'warning') {
        const d = getDday(s.contract_end);
        if (d === null || d <= 30 || d > 60) return false;
      }
      if (searchText) {
        const q = searchText.toLowerCase();
        return s.name?.toLowerCase().includes(q) ||
          s.company_name?.toLowerCase().includes(q) ||
          s.region?.toLowerCase().includes(q);
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
      } else if (sortKey === 'company_name') {
        valA = a.company_name || '';
        valB = b.company_name || '';
      }
      if (valA < valB) return sortAsc ? -1 : 1;
      if (valA > valB) return sortAsc ? 1 : -1;
      return 0;
    });

  // 만료 통계
  const tabSites = sites.filter(s => {
    if (activeTab === 'contract') return s.source !== 'member';
    return s.source === 'member';
  });
  const expiredCount = tabSites.filter(s => (getDday(s.contract_end) ?? 999) <= 0).length;
  const urgentCount = tabSites.filter(s => { const d = getDday(s.contract_end); return d !== null && d > 0 && d <= 30; }).length;
  const warningCount = tabSites.filter(s => { const d = getDday(s.contract_end); return d !== null && d > 30 && d <= 60; }).length;

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(true); }
  }

  function SortIcon({ k }: { k: SortKey }) {
    if (sortKey !== k) return <span className="text-gray-300 ml-1">↕</span>;
    return <span className="text-blue-500 ml-1">{sortAsc ? '↑' : '↓'}</span>;
  }

  // ─── 엑셀 업로드 ───
  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const data = new Uint8Array(evt.target?.result as ArrayBuffer);
      const wb = XLSX.read(data, { type: 'array', cellDates: true });
      setExcelWorkbook(wb);
      setExcelSheets(wb.SheetNames);
      setSelectedSheet(wb.SheetNames[0]);
      setShowExcelModal(true);
      previewSheet(wb, wb.SheetNames[0]);
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  }

  function previewSheet(wb: XLSX.WorkBook, sheetName: string) {
    const ws = wb.Sheets[sheetName];
    const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    if (rows.length < 2) { setExcelPreview([]); return; }
    const headers = (rows[0] as string[]).map(h => String(h).trim());
    const preview: Partial<SiteItem>[] = [];
    for (let i = 1; i < Math.min(rows.length, 6); i++) {
      const row = rows[i] as unknown[];
      const item: Partial<SiteItem> = {};
      headers.forEach((h, idx) => {
        const field = HEADER_MAP[h];
        if (field && row[idx] !== '') {
          if (field === 'contract_start' || field === 'contract_end') {
            const val = row[idx];
            (item as Record<string, unknown>)[field] = val instanceof Date ? val.toISOString().split('T')[0] : String(val);
          } else if (field === 'maintenance_fee' || field === 'elevator_count') {
            (item as Record<string, unknown>)[field] = Number(row[idx]) || 0;
          } else {
            (item as Record<string, unknown>)[field] = String(row[idx]);
          }
        }
      });
      if (item.name) preview.push(item);
    }
    setExcelPreview(preview);
  }

  function handleSheetChange(sheetName: string) {
    setSelectedSheet(sheetName);
    if (excelWorkbook) previewSheet(excelWorkbook, sheetName);
  }

  // ─── 엑셀 가져오기 ───
  async function handleImport() {
    if (!excelWorkbook || !userInfo?.company_id) return;
    setImporting(true);
    setImportResult('');
    try {
      const ws = excelWorkbook.Sheets[selectedSheet];
      const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
      if (rows.length < 2) { setImportResult('데이터가 없어요.'); return; }
      const headers = (rows[0] as string[]).map(h => String(h).trim());

      // 기존 현장 목록 (이름 기준 매핑)
      const { data: existingData } = await supabase
        .from('sites')
        .select('id, name')
        .eq('company_id', userInfo.company_id);
      const existingMap = new Map<string, string>();
      (existingData || []).forEach(d => {
        if (d.name) existingMap.set(d.name, d.id);
      });

      let addCount = 0;
      let updateCount = 0;
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i] as unknown[];
        const item: Record<string, unknown> = {
          company_id: userInfo.company_id,
          source: 'admin',
          team_name: importTeam || '',
          updated_at: new Date().toISOString(),
        };
        headers.forEach((h, idx) => {
          const field = HEADER_MAP[h];
          if (field && row[idx] !== '') {
            if (field === 'contract_start' || field === 'contract_end') {
              const val = row[idx];
              item[field] = val instanceof Date ? val.toISOString().split('T')[0] : String(val);
            } else if (field === 'maintenance_fee' || field === 'elevator_count') {
              item[field] = Number(row[idx]) || 0;
            } else {
              item[field] = String(row[idx]);
            }
          }
        });
        if (!item.name) continue;
        const existingId = existingMap.get(item.name as string);
        if (existingId) {
          await supabase.from('sites').update(item).eq('id', existingId);
          updateCount++;
        } else {
          await supabase.from('sites').insert({
            ...item,
            created_at: new Date().toISOString(),
            created_by: userInfo.uid,
          });
          addCount++;
        }
      }
      setImportResult(`✅ 신규 ${addCount}개 추가 · 기존 ${updateCount}개 업데이트 완료!`);
      // 목록 갱신
      const { data: refreshed } = await supabase
        .from('sites')
        .select('*')
        .eq('company_id', userInfo.company_id)
        .order('created_at', { ascending: false });
      setSites((refreshed || []) as SiteItem[]);
    } catch (e) {
      console.error(e);
      setImportResult('❌ 가져오기 중 오류가 발생했어요.');
    } finally {
      setImporting(false);
    }
  }

  // ─── 현장 추가 ───
  async function handleAddSite() {
    if (!addForm.name?.trim() || !userInfo?.company_id) return;
    setAddLoading(true);
    try {
      const { data: newSite, error } = await supabase.from('sites').insert({
        ...addForm,
        company_id: userInfo.company_id,
        source: 'admin',
        created_at: new Date().toISOString(),
        created_by: userInfo.uid,
      }).select().single();
      if (error) throw error;
      if (newSite) setSites(prev => [newSite as SiteItem, ...prev]);
      setShowAddModal(false);
      setAddForm({});
    } catch (e) {
      console.error(e);
    } finally {
      setAddLoading(false);
    }
  }

  // ─── 현장 수정 ───
  async function handleEditSave() {
    if (!selectedSite || !userInfo?.company_id) return;
    try {
      const { error } = await supabase
        .from('sites')
        .update({ ...editForm, updated_at: new Date().toISOString() })
        .eq('id', selectedSite.id);
      if (error) throw error;
      const updated = { ...selectedSite, ...editForm };
      setSelectedSite(updated);
      setSites(prev => prev.map(s => s.id === selectedSite.id ? updated : s));
      setEditMode(false);
    } catch (e) {
      console.error(e);
    }
  }

  // ─── 현장 삭제 ───
  async function handleDeleteSite(siteId: string) {
    if (!confirm('현장을 삭제할까요?')) return;
    await supabase.from('sites').delete().eq('id', siteId);
    setSites(prev => prev.filter(s => s.id !== siteId));
    setSelectedSite(null);
  }

  // ─── 전체 삭제 ───
  async function handleDeleteAll() {
    if (!userInfo?.company_id) return;
    const confirm1 = confirm('⚠️ 현재 탭의 현장을 전부 삭제할까요?\n이 작업은 되돌릴 수 없어요!');
    if (!confirm1) return;
    const input = prompt('확인을 위해 "전체삭제" 를 입력해주세요:');
    if (input !== '전체삭제') {
      alert('취소됐어요.');
      return;
    }
    try {
      const targetSites = sites.filter(s => {
        if (activeTab === 'contract') return s.source !== 'member';
        return s.source === 'member';
      });
      const ids = targetSites.map(s => s.id);
      if (ids.length > 0) {
        await supabase.from('sites').delete().in('id', ids);
        setSites(prev => prev.filter(s => !ids.includes(s.id)));
      }
      alert(`✅ ${targetSites.length}개 현장이 삭제됐어요.`);
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
          <button onClick={() => router.push('/')} className="text-gray-500 hover:text-gray-700 text-lg">←</button>
          <h1 className="font-bold text-lg">🏢 현장 관리</h1>
          <span className="text-sm text-gray-400">({filteredSites.length}개)</span>
        </div>
        {canEdit && (
          <div className="flex gap-2">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="text-sm bg-green-500 hover:bg-green-600 text-white px-3 py-1.5 rounded-lg font-medium"
            >
              📊 엑셀
            </button>
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
        <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFileChange} />
      </header>

      <div className="max-w-7xl mx-auto px-4 py-4">

        {/* 탭 */}
        {canEdit && (
          <div className="flex gap-2 mb-3">
            {(['contract', 'team'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => { setActiveTab(tab); setExpiryFilter('all'); }}
                className={`px-4 py-1.5 rounded-xl text-sm font-medium transition-colors ${activeTab === tab ? 'bg-blue-500 text-white' : 'bg-white text-gray-600 border'}`}
              >
                {tab === 'contract' ? '📋 계약 현장' : '🏢 팀 현장'}
              </button>
            ))}
          </div>
        )}

        {/* 만료 필터 탭 */}
        <div className="flex gap-2 mb-3 overflow-x-auto pb-1">
          {[
            { key: 'all', label: '전체', count: tabSites.length, color: 'bg-gray-100 text-gray-700', activeColor: 'bg-gray-700 text-white' },
            { key: 'expired', label: '🔴 만료', count: expiredCount, color: 'bg-red-50 text-red-500', activeColor: 'bg-red-500 text-white' },
            { key: 'urgent', label: '🟠 30일', count: urgentCount, color: 'bg-orange-50 text-orange-500', activeColor: 'bg-orange-500 text-white' },
            { key: 'warning', label: '🟡 60일', count: warningCount, color: 'bg-yellow-50 text-yellow-500', activeColor: 'bg-yellow-400 text-white' },
          ].map(({ key, label, count, color, activeColor }) => (
            <button
              key={key}
              onClick={() => setExpiryFilter(key as ExpiryFilter)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-colors border border-transparent
                ${expiryFilter === key ? activeColor : color}`}
            >
              {label}
              <span className={`text-xs px-1.5 py-0.5 rounded-full font-bold ${expiryFilter === key ? 'bg-white/30' : 'bg-white'}`}>
                {count}
              </span>
            </button>
          ))}
        </div>

        {/* 검색 + 필터 */}
        <div className="flex flex-wrap gap-2 mb-3">
          <input
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
            placeholder="현장명, 업체명, 지역 검색..."
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
          <select
            value={selectedType}
            onChange={e => setSelectedType(e.target.value)}
            className="border rounded-xl px-3 py-2 text-sm bg-white"
          >
            <option value="전체">계약 유형 전체</option>
            <option value="일반계약">일반계약</option>
            <option value="종합계약">종합계약</option>
            <option value="분담일반계약">분담일반계약</option>
            <option value="분담종합계약">분담종합계약</option>
            <option value="일반SMART계약">일반SMART계약</option>
            <option value="종합SMART계약">종합SMART계약</option>
          </select>
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
                    <button onClick={() => handleSort('company_name')} className="flex items-center hover:text-blue-600">
                      계약업체 <SortIcon k="company_name" />
                    </button>
                  </th>
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
                  {canEdit && <th className="text-center px-3 py-2.5 font-semibold text-gray-600 whitespace-nowrap">팀</th>}
                </tr>
              </thead>
              <tbody>
                {filteredSites.length === 0 ? (
                  <tr>
                    <td colSpan={canEdit ? 9 : 8} className="text-center py-16 text-gray-400">
                      <p className="text-3xl mb-2">🏢</p>
                      <p>현장이 없어요</p>
                      {canEdit && <p className="text-xs mt-1">엑셀 가져오기 또는 현장 추가를 해보세요!</p>}
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
                        {canEdit && (
                          <td className="px-3 py-2.5 text-center text-gray-600 whitespace-nowrap">
                            {site.team_name ? (
                              <span className="text-xs bg-gray-100 px-2 py-0.5 rounded-full">{site.team_name}</span>
                            ) : '-'}
                          </td>
                        )}
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
              <span>승강기 <strong className="text-gray-700">{totalElevatorCount}</strong>대</span>
              <span>보수료 합계 <strong className="text-gray-700">{filteredSites.reduce((s, i) => s + (i.maintenance_fee || 0), 0).toLocaleString()}</strong>원</span>
            </div>
          )}
        </div>
      </div>

      {/* ─── 엑셀 모달 ─── */}
      {showExcelModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-5">
            <h2 className="font-bold text-lg mb-4">📊 엑셀 가져오기</h2>
            <div className="mb-3">
              <label className="text-sm font-medium text-gray-700 mb-1 block">시트 선택</label>
              <div className="flex flex-wrap gap-2">
                {excelSheets.map(s => (
                  <button key={s} onClick={() => handleSheetChange(s)}
                    className={`text-sm px-3 py-1.5 rounded-lg border ${selectedSheet === s ? 'bg-blue-500 text-white border-blue-500' : 'text-gray-600'}`}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
            <div className="mb-3">
              <label className="text-sm font-medium text-gray-700 mb-1 block">팀 배정</label>
              <select value={importTeam} onChange={e => setImportTeam(e.target.value)}
                className="w-full border rounded-xl px-3 py-2 text-sm">
                <option value="">팀 미배정</option>
                {teams.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            {excelPreview.length > 0 && (
              <div className="mb-4">
                <p className="text-sm font-medium text-gray-700 mb-1">미리보기 (상위 5개)</p>
                <div className="bg-gray-50 rounded-xl overflow-hidden border">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-gray-100">
                        <th className="text-left px-2 py-1.5 text-gray-600">현장명</th>
                        <th className="text-left px-2 py-1.5 text-gray-600">업체</th>
                        <th className="text-center px-2 py-1.5 text-gray-600">만료일</th>
                        <th className="text-center px-2 py-1.5 text-gray-600">대수</th>
                      </tr>
                    </thead>
                    <tbody>
                      {excelPreview.map((item, i) => (
                        <tr key={i} className="border-t">
                          <td className="px-2 py-1.5 font-medium">{item.name}</td>
                          <td className="px-2 py-1.5 text-gray-500">{item.company_name || '-'}</td>
                          <td className="px-2 py-1.5 text-center text-gray-500">{item.contract_end || '-'}</td>
                          <td className="px-2 py-1.5 text-center text-gray-500">{item.elevator_count || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            <div className="bg-blue-50 rounded-xl p-3 mb-4 text-xs text-blue-700">
              💡 현장명이 같으면 <strong>덮어쓰기</strong>, 없으면 <strong>새로 추가</strong>돼요
            </div>
            {importResult && (
              <p className="text-sm text-center mb-3 font-medium text-green-600">{importResult}</p>
            )}
            <div className="flex gap-2">
              <button onClick={() => { setShowExcelModal(false); setImportResult(''); }}
                className="flex-1 py-2 border rounded-xl text-sm text-gray-600">닫기</button>
              <button onClick={handleImport} disabled={importing}
                className="flex-1 py-2 bg-blue-500 text-white rounded-xl text-sm font-medium disabled:opacity-50">
                {importing ? '가져오는 중...' : '가져오기'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── 현장 추가 모달 ─── */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto p-5">
            <h2 className="font-bold text-lg mb-4">+ 현장 추가</h2>
            <div className="space-y-3">
              {[
                { label: '현장명 *', field: 'name', type: 'text' },
                { label: '주소', field: 'address', type: 'text' },
                { label: '계약업체', field: 'company_name', type: 'text' },
                { label: '전화번호', field: 'phone', type: 'text' },
                { label: '계약자', field: 'contract_person', type: 'text' },
                { label: '승강기 대수', field: 'elevator_count', type: 'number' },
                { label: '보수료', field: 'maintenance_fee', type: 'number' },
                { label: '계약 시작일', field: 'contract_start', type: 'date' },
                { label: '계약 만료일', field: 'contract_end', type: 'date' },
                { label: '지역', field: 'region', type: 'text' },
                { label: '이메일', field: 'email', type: 'text' },
              ].map(({ label, field, type }) => (
                <div key={field}>
                  <label className="text-sm text-gray-600 mb-0.5 block">{label}</label>
                  <input type={type}
                    value={(addForm as Record<string, unknown>)[field] as string || ''}
                    onChange={e => setAddForm(prev => ({ ...prev, [field]: type === 'number' ? Number(e.target.value) : e.target.value }))}
                    className="w-full border rounded-xl px-3 py-2 text-sm" />
                </div>
              ))}
              <div>
                <label className="text-sm text-gray-600 mb-0.5 block">계약 유형</label>
                <select value={addForm.contract_type || ''}
                  onChange={e => setAddForm(prev => ({ ...prev, contract_type: e.target.value }))}
                  className="w-full border rounded-xl px-3 py-2 text-sm">
                  <option value="">선택</option>
                  <option value="FM">FM (종합)</option>
                  <option value="POG">POG (일반)</option>
                </select>
              </div>
              <div>
                <label className="text-sm text-gray-600 mb-0.5 block">팀 배정</label>
                <select value={addForm.team_name || ''}
                  onChange={e => setAddForm(prev => ({ ...prev, team_name: e.target.value }))}
                  className="w-full border rounded-xl px-3 py-2 text-sm">
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
                    { label: '계약 유형', value: selectedSite.contract_type === 'FM' ? 'FM (종합)' : selectedSite.contract_type === 'POG' ? 'POG (일반)' : selectedSite.contract_type },
                    { label: '승강기 대수', value: selectedSite.elevator_count ? `${selectedSite.elevator_count}대` : undefined },
                    { label: '보수료', value: selectedSite.maintenance_fee ? `${selectedSite.maintenance_fee.toLocaleString()}원` : undefined },
                    { label: '계약 시작일', value: selectedSite.contract_start },
                    { label: '계약 만료일', value: selectedSite.contract_end },
                    { label: '계약자', value: selectedSite.contract_person },
                    { label: '전화번호', value: selectedSite.phone },
                    { label: '이메일', value: selectedSite.email },
                    { label: '지역', value: selectedSite.region },
                    { label: '주소', value: selectedSite.address },
                    { label: '배정 팀', value: selectedSite.team_name },
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
                    { label: '계약업체', field: 'company_name', type: 'text' },
                    { label: '전화번호', field: 'phone', type: 'text' },
                    { label: '계약자', field: 'contract_person', type: 'text' },
                    { label: '승강기 대수', field: 'elevator_count', type: 'number' },
                    { label: '보수료', field: 'maintenance_fee', type: 'number' },
                    { label: '계약 시작일', field: 'contract_start', type: 'date' },
                    { label: '계약 만료일', field: 'contract_end', type: 'date' },
                    { label: '지역', field: 'region', type: 'text' },
                    { label: '이메일', field: 'email', type: 'text' },
                  ].map(({ label, field, type }) => (
                    <div key={field}>
                      <label className="text-sm text-gray-600 mb-0.5 block">{label}</label>
                      <input type={type}
                        value={(editForm as Record<string, unknown>)[field] as string || ''}
                        onChange={e => setEditForm(prev => ({ ...prev, [field]: type === 'number' ? Number(e.target.value) : e.target.value }))}
                        className="w-full border rounded-xl px-3 py-2 text-sm" />
                    </div>
                  ))}
                  <div>
                    <label className="text-sm text-gray-600 mb-0.5 block">계약 유형</label>
                    <select value={editForm.contract_type || ''}
                      onChange={e => setEditForm(prev => ({ ...prev, contract_type: e.target.value }))}
                      className="w-full border rounded-xl px-3 py-2 text-sm">
                      <option value="">선택</option>
                      <option value="FM">FM (종합)</option>
                      <option value="POG">POG (일반)</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-sm text-gray-600 mb-0.5 block">팀 배정</label>
                    <select value={editForm.team_name || ''}
                      onChange={e => setEditForm(prev => ({ ...prev, team_name: e.target.value }))}
                      className="w-full border rounded-xl px-3 py-2 text-sm">
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
