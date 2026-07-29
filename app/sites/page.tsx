'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import * as XLSX from 'xlsx';
import { invalidateSitesCache } from '@/app/dashboard/page';

// ─── 타입 정의 ───
interface UserInfo {
  id: string;
  name: string;
  email: string;
  company_id: string;
  companyDisplayName?: string;
  team: string;
  role: string;
  super_admin?: boolean;
}

interface SiteItem {
  id: string;
  name?: string;
  site_name?: string;
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
  company_id?: string;
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
function getSiteName(s: SiteItem) { return s.site_name || s.name || ''; }

function getDday(dateStr?: string): number | null {
  if (!dateStr) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr); target.setHours(0, 0, 0, 0);
  return Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function getExpiryInfo(dateStr?: string) {
  const d = getDday(dateStr);
  if (d === null) return null;
  if (d <= 0)  return { label: '만료',   color: 'bg-red-100 text-red-600',    rowColor: 'bg-red-50',    dot: '🔴', priority: 0 };
  if (d <= 30) return { label: `D-${d}`, color: 'bg-orange-100 text-orange-600', rowColor: 'bg-orange-50', dot: '🟠', priority: 1 };
  if (d <= 60) return { label: `D-${d}`, color: 'bg-yellow-100 text-yellow-600', rowColor: 'bg-yellow-50', dot: '🟡', priority: 2 };
  return       { label: `D-${d}`, color: 'bg-green-100 text-green-600', rowColor: '', dot: '🟢', priority: 3 };
}

// ─── 헤더 매핑 ───
const HEADER_MAP: Record<string, keyof SiteItem> = {
  '현장명': 'site_name', '현장': 'site_name', '사이트명': 'site_name', '건물명': 'site_name', '빌딩명': 'site_name', 'name': 'site_name', 'sitename': 'site_name',
  '원장번호': 'contract_number', '원장변호': 'contract_number', '계약번호': 'contract_number', '원장': 'contract_number',
  '보수료': 'maintenance_fee', '유지보수료': 'maintenance_fee', '월보수료': 'maintenance_fee', '금액': 'maintenance_fee',
  '대수': 'elevator_count', '승강기대수': 'elevator_count', '엘리베이터대수': 'elevator_count', '승강기수': 'elevator_count', '대': 'elevator_count',
  '계약일자': 'contract_start', '계약시작': 'contract_start', '계약시작일': 'contract_start', '시작일': 'contract_start', '계약일': 'contract_start',
  '만료일자': 'contract_end', '만료일': 'contract_end', '계약만료': 'contract_end', '계약만료일': 'contract_end', '종료일': 'contract_end', '계약종료일': 'contract_end',
  '생활유통': 'contract_type', '계약종류': 'contract_type', '계약 종류': 'contract_type', '계약유형': 'contract_type', '종류': 'contract_type',
  '전화번호': 'phone', '연락처': 'phone', '전화': 'phone', '핸드폰': 'phone', '휴대폰': 'phone', 'tel': 'phone', 'phone': 'phone',
  '계약자': 'contract_person', '제약자': 'contract_person', '담당자': 'contract_person', '담당': 'contract_person',
  '업체명': 'company_name', '계약업체': 'company_name', '업체': 'company_name', '회사명': 'company_name', '회사': 'company_name',
  '지역': 'region', '지역명': 'region', '구역': 'region',
  '주소': 'address', '도로명주소': 'address', '지번주소': 'address', '소재지': 'address',
  '메일주소': 'email', '이메일': 'email', 'email': 'email', '이-메일': 'email',
};

function normalizeHeader(h: string): string {
  return String(h).replace(/[\s\u3000\t\r\n]/g, '').replace(/[()（）\[\]【】]/g, '').toLowerCase();
}

const NORMALIZED_HEADER_MAP: Record<string, keyof SiteItem> = (() => {
  const m: Record<string, keyof SiteItem> = {};
  for (const [k, v] of Object.entries(HEADER_MAP)) { m[normalizeHeader(k)] = v; }
  return m;
})();

function excelSerialToDate(serial: number): string {
  const utcDays = Math.floor(serial - 25569);
  const date = new Date(utcDays * 86400 * 1000);
  return date.toISOString().split('T')[0];
}

function parseDateValue(val: unknown): string {
  if (!val && val !== 0) return '';
  if (val instanceof Date) {
    if (isNaN(val.getTime())) return '';
    return val.toISOString().split('T')[0];
  }
  const s = String(val).trim();
  if (!s) return '';
  if (/^\d{4,6}$/.test(s)) {
    const n = Number(s);
    if (n > 30000 && n < 60000) return excelSerialToDate(n);
  }
  const isoMatch = s.match(/^(\d{4})[.\-\/](\d{1,2})[.\-\/](\d{1,2})/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2].padStart(2,'0')}-${isoMatch[3].padStart(2,'0')}`;
  const yyMatch = s.match(/^(\d{2})[.\-\/](\d{1,2})[.\-\/](\d{1,2})/);
  if (yyMatch) {
    const year = parseInt(yyMatch[1]) >= 50 ? `19${yyMatch[1]}` : `20${yyMatch[1]}`;
    return `${year}-${yyMatch[2].padStart(2,'0')}-${yyMatch[3].padStart(2,'0')}`;
  }
  const koMatch = s.match(/(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일?/);
  if (koMatch) return `${koMatch[1]}-${koMatch[2].padStart(2,'0')}-${koMatch[3].padStart(2,'0')}`;
  return s;
}

function detectHeaderRow(rows: unknown[][]): { headerRowIdx: number; colMap: Record<number, keyof SiteItem> } {
  let bestIdx = 0; let bestScore = 0; let bestColMap: Record<number, keyof SiteItem> = {};
  const limit = Math.min(rows.length, 10);
  for (let r = 0; r < limit; r++) {
    const colMap: Record<number, keyof SiteItem> = {}; let score = 0;
    const row = rows[r] as unknown[];
    for (let c = 0; c < row.length; c++) {
      const norm = normalizeHeader(String(row[c] ?? ''));
      if (norm && NORMALIZED_HEADER_MAP[norm]) {
        colMap[c] = NORMALIZED_HEADER_MAP[norm]; score++;
        if (NORMALIZED_HEADER_MAP[norm] === 'site_name') score += 3;
      }
    }
    if (score > bestScore) { bestScore = score; bestIdx = r; bestColMap = colMap; }
  }
  return { headerRowIdx: bestIdx, colMap: bestColMap };
}

function parseRow(row: unknown[], colMap: Record<number, keyof SiteItem>): Partial<SiteItem> {
  const item: Partial<SiteItem> = {};
  for (const [colStr, field] of Object.entries(colMap)) {
    const idx = Number(colStr); const val = row[idx];
    if (val === '' || val === null || val === undefined) continue;
    if (field === 'contract_start' || field === 'contract_end') {
      const parsed = parseDateValue(val);
      if (parsed) (item as Record<string, unknown>)[field] = parsed;
    } else if (field === 'maintenance_fee' || field === 'elevator_count') {
      const n = Number(String(val).replace(/[,원\s]/g, ''));
      if (!isNaN(n)) (item as Record<string, unknown>)[field] = n;
    } else {
      (item as Record<string, unknown>)[field] = String(val).trim();
    }
  }
  return item;
}

type SortKey = 'site_name' | 'contract_end' | 'maintenance_fee' | 'elevator_count' | 'company_name';
type ExpiryFilter = 'all' | 'expired' | 'urgent' | 'warning';

export default function SitesPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [sites, setSites] = useState<SiteItem[]>([]);
  const [teams, setTeams] = useState<string[]>([]);

  const [siteElevators, setSiteElevators] = useState<ElevatorItem[]>([]);
  const [elevatorsLoading, setElevatorsLoading] = useState(false);
  const [totalElevatorCount, setTotalElevatorCount] = useState(0);

  const [selectedTeam, setSelectedTeam] = useState('전체');
  const [selectedType, setSelectedType] = useState('전체');
  const [searchText, setSearchText] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('contract_end');
  const [sortAsc, setSortAsc] = useState(true);
  const [expiryFilter, setExpiryFilter] = useState<ExpiryFilter>('all');

  const [showExcelModal, setShowExcelModal] = useState(false);
  const [excelSheets, setExcelSheets] = useState<string[]>([]);
  const [selectedSheet, setSelectedSheet] = useState('');
  const [excelWorkbook, setExcelWorkbook] = useState<XLSX.WorkBook | null>(null);
  const [excelPreview, setExcelPreview] = useState<Partial<SiteItem>[]>([]);
  const [importTeam, setImportTeam] = useState('');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState('');
  const [excelParseInfo, setExcelParseInfo] = useState('');

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
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!session?.user) { router.push('/login'); return; }
      const { data: userData, error } = await supabase
        .from('users').select('*').eq('id', session.user.id).single();
      if (error || !userData) { router.push('/login'); return; }
      if (!userData.company_id) { router.push('/'); return; }
      setUserInfo({
        id: session.user.id,
        name: userData.name || '',
        email: session.user.email || '',
        company_id: userData.company_id,
        companyDisplayName: userData.company_display_name || '',
        team: userData.team || '',
        role: userData.role || 'member',
        super_admin: userData.super_admin || false,
      });
      setLoading(false);
    });
    return () => subscription.unsubscribe();
  }, [router]);

  // ─── 현장 목록 로드 ───
  const reloadSites = async (companyId?: string) => {
    const cid = companyId ?? userInfo?.company_id;
    if (!cid) return;
    invalidateSitesCache(cid);

    let query = supabase.from('sites').select('*').order('created_at', { ascending: false });
    if (!isSuperAdmin) query = query.eq('company_id', cid);

    const { data, error } = await query;
    if (error) { console.error(error); return; }

    const list = (data || []) as SiteItem[];
    setSites(list);

    const teamSet = new Set(list.map(s => s.team_name).filter(Boolean) as string[]);
    setTeams(Array.from(teamSet));

    // 전체 호기 수
    let elevQuery = supabase.from('elevators').select('id', { count: 'exact' });
    if (!isSuperAdmin) elevQuery = elevQuery.eq('company_id', cid);
    const { count } = await elevQuery;
    setTotalElevatorCount(count || 0);
  };

  useEffect(() => {
    if (!userInfo?.company_id) return;
    reloadSites(userInfo.company_id).catch(console.error);
  }, [userInfo?.company_id]);

  // ─── 현장 클릭 시 호기 로드 ───
  async function handleSiteClick(site: SiteItem) {
    setSelectedSite(site);
    setEditForm(site);
    setEditMode(false);
    setSiteElevators([]);
    setElevatorsLoading(true);
    try {
      const { data } = await supabase
        .from('elevators').select('*').eq('site_id', site.id);
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
      if (!canEdit && s.team_name !== userInfo?.team) return false;
      if (canEdit && selectedTeam !== '전체' && s.team_name !== selectedTeam) return false;
      if (selectedType !== '전체' && s.contract_type !== selectedType) return false;
      if (expiryFilter === 'expired') { const d = getDday(s.contract_end); if (d === null || d > 0) return false; }
      if (expiryFilter === 'urgent')  { const d = getDday(s.contract_end); if (d === null || d <= 0 || d > 30) return false; }
      if (expiryFilter === 'warning') { const d = getDday(s.contract_end); if (d === null || d <= 30 || d > 60) return false; }
      if (searchText) {
        const q = searchText.toLowerCase();
        return getSiteName(s)?.toLowerCase().includes(q) ||
          s.company_name?.toLowerCase().includes(q) ||
          s.region?.toLowerCase().includes(q);
      }
      return true;
    })
    .sort((a, b) => {
      let valA: string | number = '';
      let valB: string | number = '';
      if (sortKey === 'contract_end')     { valA = a.contract_end || '9999'; valB = b.contract_end || '9999'; }
      else if (sortKey === 'maintenance_fee') { valA = a.maintenance_fee || 0; valB = b.maintenance_fee || 0; }
      else if (sortKey === 'elevator_count')  { valA = a.elevator_count || 0; valB = b.elevator_count || 0; }
      else if (sortKey === 'site_name')   { valA = getSiteName(a); valB = getSiteName(b); }
      else if (sortKey === 'company_name') { valA = a.company_name || ''; valB = b.company_name || ''; }
      if (valA < valB) return sortAsc ? -1 : 1;
      if (valA > valB) return sortAsc ? 1 : -1;
      return 0;
    });

  const expiredCount = sites.filter(s => (getDday(s.contract_end) ?? 999) <= 0).length;
  const urgentCount  = sites.filter(s => { const d = getDday(s.contract_end); return d !== null && d > 0 && d <= 30; }).length;
  const warningCount = sites.filter(s => { const d = getDday(s.contract_end); return d !== null && d > 30 && d <= 60; }).length;

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
      setImportResult('');
      setExcelParseInfo('');
      setShowExcelModal(true);
      previewSheet(wb, wb.SheetNames[0]);
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  }

  function previewSheet(wb: XLSX.WorkBook, sheetName: string) {
    const ws = wb.Sheets[sheetName];
    const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    const cleanRows = rows.filter(row => (row as unknown[]).some(cell => String(cell ?? '').trim() !== ''));
    if (cleanRows.length < 2) { setExcelPreview([]); setExcelParseInfo('⚠️ 데이터를 찾을 수 없어요.'); return; }
    const { headerRowIdx, colMap } = detectHeaderRow(cleanRows);
    const matchedFields = Object.values(colMap);
    const hasName = matchedFields.includes('site_name');
    const mappedCount = Object.keys(colMap).length;
    if (mappedCount === 0) { setExcelParseInfo('⚠️ 인식 가능한 컬럼을 찾지 못했어요.'); setExcelPreview([]); return; }
    setExcelParseInfo(`✅ ${headerRowIdx + 1}행을 헤더로 인식 · ${mappedCount}개 컬럼 매칭${!hasName ? ' ⚠️ 현장명 컬럼 없음' : ''}`);
    const preview: Partial<SiteItem>[] = [];
    for (let i = headerRowIdx + 1; i < Math.min(cleanRows.length, headerRowIdx + 6); i++) {
      const item = parseRow(cleanRows[i] as unknown[], colMap);
      if (item.site_name) preview.push(item);
    }
    setExcelPreview(preview);
  }

  function handleSheetChange(sheetName: string) {
    setSelectedSheet(sheetName);
    setExcelParseInfo('');
    if (excelWorkbook) previewSheet(excelWorkbook, sheetName);
  }

  // ─── 엑셀 가져오기 ───
  async function handleImport() {
    if (!excelWorkbook || !userInfo?.company_id) return;
    setImporting(true); setImportResult('');
    try {
      const ws = excelWorkbook.Sheets[selectedSheet];
      const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
      const cleanRows = rows.filter(row => (row as unknown[]).some(cell => String(cell ?? '').trim() !== ''));
      if (cleanRows.length < 2) { setImportResult('⚠️ 데이터가 없어요.'); setImporting(false); return; }
      const { headerRowIdx, colMap } = detectHeaderRow(cleanRows);
      if (Object.keys(colMap).length === 0) { setImportResult('⚠️ 인식 가능한 컬럼을 찾지 못했어요.'); setImporting(false); return; }

      // 기존 현장 목록
      const { data: existingData } = await supabase.from('sites').select('id, site_name').eq('company_id', userInfo.company_id);
      const existingMap = new Map<string, string>();
      (existingData || []).forEach((d: any) => { if (d.site_name) existingMap.set(String(d.site_name).trim(), d.id); });

      let addCount = 0; let updateCount = 0; let skipCount = 0;

      for (let i = headerRowIdx + 1; i < cleanRows.length; i++) {
        const parsed = parseRow(cleanRows[i] as unknown[], colMap);
        if (!parsed.site_name || !String(parsed.site_name).trim()) { skipCount++; continue; }

        const item = {
          ...parsed,
          source: 'admin',
          team_name: importTeam || '',
          company_id: userInfo.company_id,
          updated_at: new Date().toISOString(),
        };

        const existingId = existingMap.get(String(parsed.site_name).trim());
        if (existingId) {
          await supabase.from('sites').update(item).eq('id', existingId);
          updateCount++;
        } else {
          await supabase.from('sites').insert({ ...item, created_at: new Date().toISOString() });
          addCount++;
        }
      }
      const skipMsg = skipCount > 0 ? ` (현장명 없는 ${skipCount}행 제외)` : '';
      setImportResult(`✅ 신규 ${addCount}개 추가 · 기존 ${updateCount}개 업데이트 완료!${skipMsg}`);
      await reloadSites();
    } catch (e) {
      console.error(e);
      setImportResult('❌ 가져오기 중 오류가 발생했어요.');
    } finally {
      setImporting(false);
    }
  }

  // ─── 현장 추가 ───
  async function handleAddSite() {
    if (!addForm.site_name?.trim() || !userInfo?.company_id) return;
    setAddLoading(true);
    try {
      await supabase.from('sites').insert({
        ...addForm,
        source: 'admin',
        company_id: userInfo.company_id,
        created_at: new Date().toISOString(),
      });
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
    if (!selectedSite || !userInfo?.company_id) return;
    try {
      await supabase.from('sites').update({ ...editForm, updated_at: new Date().toISOString() }).eq('id', selectedSite.id);
      setEditMode(false);
      setSelectedSite({ ...selectedSite, ...editForm });
      setSites(prev => prev.map(s => s.id === selectedSite.id ? { ...s, ...editForm } : s));
    } catch (e) {
      console.error(e);
    }
  }

  // ─── 현장 삭제 ───
  async function handleDeleteSite(siteId: string) {
    if (!confirm('현장을 삭제할까요?')) return;
    try {
      await supabase.from('sites').delete().eq('id', siteId);
      setSelectedSite(null);
      setSites(prev => prev.filter(s => s.id !== siteId));
    } catch (e) {
      console.error(e);
      alert('❌ 삭제 중 오류가 발생했어요.');
    }
  }

  // ─── 전체 삭제 ───
  async function handleDeleteAll() {
    if (!userInfo?.company_id) return;
    const confirm1 = confirm('⚠️ 현재 탭의 현장을 전부 삭제할까요?\n이 작업은 되돌릴 수 없어요!');
    if (!confirm1) return;
    const input = prompt('확인을 위해 "전체삭제" 를 입력해주세요:');
    if (input !== '전체삭제') { alert('취소됐어요.'); return; }
    try {
      await supabase.from('sites').delete().eq('company_id', userInfo.company_id);
      await reloadSites();
      alert(`✅ 현장이 모두 삭제됐어요.`);
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
          <h1 className="font-bold text-lg">📋 계약 현장</h1>
          <span className="text-sm text-gray-400">({filteredSites.length}개)</span>
        </div>
        {canEdit && (
          <div className="flex gap-2">
            <button onClick={() => fileInputRef.current?.click()} className="text-sm bg-green-500 hover:bg-green-600 text-white px-3 py-1.5 rounded-lg font-medium">📊 엑셀</button>
            <button onClick={() => setShowAddModal(true)} className="text-sm bg-blue-500 hover:bg-blue-600 text-white px-3 py-1.5 rounded-lg font-medium">+ 추가</button>
            <button onClick={handleDeleteAll} className="text-sm bg-red-500 hover:bg-red-600 text-white px-3 py-1.5 rounded-lg font-medium">🗑️ 전체삭제</button>
          </div>
        )}
        <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFileChange} />
      </header>

      <div className="max-w-7xl mx-auto px-4 py-4">
        {/* 만료 필터 탭 */}
        <div className="flex gap-2 mb-3 overflow-x-auto pb-1">
          {[
            { key: 'all',     label: '전체',    count: sites.length,  color: 'bg-gray-100 text-gray-700',     activeColor: 'bg-gray-700 text-white' },
            { key: 'expired', label: '🔴 만료',  count: expiredCount,  color: 'bg-red-50 text-red-500',        activeColor: 'bg-red-500 text-white' },
            { key: 'urgent',  label: '🟠 30일',  count: urgentCount,   color: 'bg-orange-50 text-orange-500',  activeColor: 'bg-orange-500 text-white' },
            { key: 'warning', label: '🟡 60일',  count: warningCount,  color: 'bg-yellow-50 text-yellow-500',  activeColor: 'bg-yellow-400 text-white' },
          ].map(({ key, label, count, color, activeColor }) => (
            <button key={key} onClick={() => setExpiryFilter(key as ExpiryFilter)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-colors border border-transparent ${expiryFilter === key ? activeColor : color}`}>
              {label}
              <span className={`text-xs px-1.5 py-0.5 rounded-full font-bold ${expiryFilter === key ? 'bg-white/30' : 'bg-white'}`}>{count}</span>
            </button>
          ))}
        </div>

        {/* 검색 + 필터 */}
        <div className="flex flex-wrap gap-2 mb-3">
          <input value={searchText} onChange={e => setSearchText(e.target.value)}
            placeholder="현장명, 업체명, 지역 검색..."
            className="flex-1 min-w-48 border rounded-xl px-3 py-2 text-sm bg-white" />
          {canEdit && (
            <select value={selectedTeam} onChange={e => setSelectedTeam(e.target.value)} className="border rounded-xl px-3 py-2 text-sm bg-white">
              <option value="전체">전체 팀</option>
              {teams.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          )}
          <select value={selectedType} onChange={e => setSelectedType(e.target.value)} className="border rounded-xl px-3 py-2 text-sm bg-white">
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
                    <button onClick={() => handleSort('site_name')} className="flex items-center hover:text-blue-600">현장명 <SortIcon k="site_name" /></button>
                  </th>
                  <th className="text-left px-3 py-2.5 font-semibold text-gray-600 whitespace-nowrap">
                    <button onClick={() => handleSort('company_name')} className="flex items-center hover:text-blue-600">계약업체 <SortIcon k="company_name" /></button>
                  </th>
                  <th className="text-center px-3 py-2.5 font-semibold text-gray-600 whitespace-nowrap">유형</th>
                  <th className="text-center px-3 py-2.5 font-semibold text-gray-600 whitespace-nowrap">
                    <button onClick={() => handleSort('elevator_count')} className="flex items-center justify-center hover:text-blue-600">대수 <SortIcon k="elevator_count" /></button>
                  </th>
                  <th className="text-right px-3 py-2.5 font-semibold text-gray-600 whitespace-nowrap">
                    <button onClick={() => handleSort('maintenance_fee')} className="flex items-center justify-end hover:text-blue-600">보수료 <SortIcon k="maintenance_fee" /></button>
                  </th>
                  <th className="text-center px-3 py-2.5 font-semibold text-gray-600 whitespace-nowrap">
                    <button onClick={() => handleSort('contract_end')} className="flex items-center justify-center hover:text-blue-600">계약만료 <SortIcon k="contract_end" /></button>
                  </th>
                  <th className="text-center px-3 py-2.5 font-semibold text-gray-600 whitespace-nowrap">D-day</th>
                  <th className="text-center px-3 py-2.5 font-semibold text-gray-600 whitespace-nowrap">지역</th>
                  {canEdit && <th className="text-center px-3 py-2.5 font-semibold text-gray-600 whitespace-nowrap">팀</th>}
                </tr>
              </thead>
              <tbody>
                {filteredSites.length === 0 ? (
                  <tr><td colSpan={canEdit ? 9 : 8} className="text-center py-16 text-gray-400">
                    <p className="text-3xl mb-2">🏢</p><p>현장이 없어요</p>
                    {canEdit && <p className="text-xs mt-1">엑셀 가져오기 또는 현장 추가를 해보세요!</p>}
                  </td></tr>
                ) : filteredSites.map((site, idx) => {
                  const expiry = getExpiryInfo(site.contract_end);
                  return (
                    <tr key={site.id} onClick={() => handleSiteClick(site)}
                      className={`border-b last:border-0 cursor-pointer hover:bg-blue-50 transition-colors ${expiry?.rowColor || (idx % 2 === 0 ? '' : 'bg-gray-50/50')}`}>
                      <td className="px-3 py-2.5 font-medium text-gray-800 whitespace-nowrap">{getSiteName(site)}</td>
                      <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">{site.company_name || '-'}</td>
                      <td className="px-3 py-2.5 text-center whitespace-nowrap">
                        {site.contract_type ? (
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                            site.contract_type.includes('종합') ? 'bg-blue-100 text-blue-600' :
                            site.contract_type.includes('일반') ? 'bg-purple-100 text-purple-600' : 'bg-gray-100 text-gray-600'
                          }`}>{site.contract_type}</span>
                        ) : '-'}
                      </td>
                      <td className="px-3 py-2.5 text-center text-gray-600 whitespace-nowrap">{site.elevator_count ? `${site.elevator_count}대` : '-'}</td>
                      <td className="px-3 py-2.5 text-right text-gray-600 whitespace-nowrap">{site.maintenance_fee ? site.maintenance_fee.toLocaleString() : '-'}</td>
                      <td className="px-3 py-2.5 text-center text-gray-600 whitespace-nowrap">{site.contract_end || '-'}</td>
                      <td className="px-3 py-2.5 text-center whitespace-nowrap">
                        {expiry ? <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${expiry.color}`}>{expiry.label}</span> : '-'}
                      </td>
                      <td className="px-3 py-2.5 text-center text-gray-600 whitespace-nowrap">{site.region || '-'}</td>
                      {canEdit && (
                        <td className="px-3 py-2.5 text-center text-gray-600 whitespace-nowrap">
                          {site.team_name ? <span className="text-xs bg-gray-100 px-2 py-0.5 rounded-full">{site.team_name}</span> : '-'}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {filteredSites.length > 0 && (
            <div className="bg-gray-50 border-t px-3 py-2 flex gap-4 text-xs text-gray-500">
              <span>총 <strong className="text-gray-700">{filteredSites.length}</strong>개 현장</span>
              <span>승강기 <strong className="text-gray-700">{totalElevatorCount}</strong>대</span>
              <span>보수료 합계 <strong className="text-gray-700">{filteredSites.reduce((s, i) => s + (i.maintenance_fee || 0), 0).toLocaleString()}</strong>원</span>
            </div>
          )}
        </div>
      </div>

      {/* 엑셀 모달 */}
      {showExcelModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-5">
            <h2 className="font-bold text-lg mb-4">📊 엑셀 가져오기</h2>
            {excelSheets.length > 1 && (
              <div className="mb-3">
                <label className="text-sm font-medium text-gray-700 mb-1 block">시트 선택</label>
                <div className="flex flex-wrap gap-2">
                  {excelSheets.map(s => (
                    <button key={s} onClick={() => handleSheetChange(s)}
                      className={`text-sm px-3 py-1.5 rounded-lg border ${selectedSheet === s ? 'bg-blue-500 text-white border-blue-500' : 'text-gray-600'}`}>{s}</button>
                  ))}
                </div>
              </div>
            )}
            {excelParseInfo && (
              <div className={`mb-3 rounded-xl p-3 text-xs font-medium ${excelParseInfo.startsWith('✅') ? 'bg-green-50 text-green-700' : 'bg-orange-50 text-orange-700'}`}>
                {excelParseInfo.split('\n').map((line, i) => <p key={i}>{line}</p>)}
              </div>
            )}
            <div className="mb-3">
              <label className="text-sm font-medium text-gray-700 mb-1 block">팀 배정</label>
              <select value={importTeam} onChange={e => setImportTeam(e.target.value)} className="w-full border rounded-xl px-3 py-2 text-sm">
                <option value="">팀 미배정</option>
                {teams.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            {excelPreview.length > 0 && (
              <div className="mb-4">
                <p className="text-sm font-medium text-gray-700 mb-1">미리보기 (상위 5개)</p>
                <div className="bg-gray-50 rounded-xl overflow-hidden border">
                  <table className="w-full text-xs">
                    <thead><tr className="bg-gray-100">
                      <th className="text-left px-2 py-1.5 text-gray-600">현장명</th>
                      <th className="text-left px-2 py-1.5 text-gray-600">업체</th>
                      <th className="text-center px-2 py-1.5 text-gray-600">만료일</th>
                      <th className="text-center px-2 py-1.5 text-gray-600">대수</th>
                    </tr></thead>
                    <tbody>
                      {excelPreview.map((item, i) => (
                        <tr key={i} className="border-t">
                          <td className="px-2 py-1.5 font-medium">{item.site_name}</td>
                          <td className="px-2 py-1.5 text-gray-500">{item.company_name || '-'}</td>
                          <td className="px-2 py-1.5 text-center text-gray-500">{item.contract_end || '-'}</td>
                          <td className="px-2 py-1.5 text-center text-gray-500">{item.elevator_count ?? '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            <div className="bg-blue-50 rounded-xl p-3 mb-4 text-xs text-blue-700">
              💡 헤더 행 위치를 자동으로 감지해요 · 현장명이 같으면 <strong>덮어쓰기</strong>, 없으면 <strong>새로 추가</strong>돼요
            </div>
            {importResult && (
              <p className={`text-sm text-center mb-3 font-medium ${importResult.startsWith('✅') ? 'text-green-600' : 'text-red-500'}`}>{importResult}</p>
            )}
            <div className="flex gap-2">
              <button onClick={() => { setShowExcelModal(false); setImportResult(''); setExcelParseInfo(''); }} className="flex-1 py-2 border rounded-xl text-sm text-gray-600">닫기</button>
              <button onClick={handleImport} disabled={importing || excelPreview.length === 0} className="flex-1 py-2 bg-blue-500 text-white rounded-xl text-sm font-medium disabled:opacity-50">
                {importing ? '가져오는 중...' : '가져오기'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 현장 추가 모달 */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto p-5">
            <h2 className="font-bold text-lg mb-4">+ 현장 추가</h2>
            <div className="space-y-3">
              {[
                { label: '현장명 *', field: 'site_name', type: 'text' },
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
                <select value={addForm.contract_type || ''} onChange={e => setAddForm(prev => ({ ...prev, contract_type: e.target.value }))} className="w-full border rounded-xl px-3 py-2 text-sm">
                  <option value="">선택</option>
                  <option value="일반계약">일반계약</option>
                  <option value="종합계약">종합계약</option>
                  <option value="분담일반계약">분담일반계약</option>
                  <option value="분담종합계약">분담종합계약</option>
                </select>
              </div>
              <div>
                <label className="text-sm text-gray-600 mb-0.5 block">팀 배정</label>
                <select value={addForm.team_name || ''} onChange={e => setAddForm(prev => ({ ...prev, team_name: e.target.value }))} className="w-full border rounded-xl px-3 py-2 text-sm">
                  <option value="">팀 미배정</option>
                  {teams.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={() => setShowAddModal(false)} className="flex-1 py-2 border rounded-xl text-sm text-gray-600">취소</button>
              <button onClick={handleAddSite} disabled={addLoading} className="flex-1 py-2 bg-blue-500 text-white rounded-xl text-sm font-medium disabled:opacity-50">
                {addLoading ? '저장 중...' : '저장'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 현장 상세 모달 */}
      {selectedSite && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-lg">{getSiteName(selectedSite)}</h2>
              <button onClick={() => setSelectedSite(null)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>
            {!editMode ? (
              <>
                {selectedSite.contract_end && (() => {
                  const expiry = getExpiryInfo(selectedSite.contract_end);
                  return expiry ? <div className={`mb-3 text-center py-2 rounded-xl text-sm font-medium ${expiry.color}`}>{expiry.dot} 계약 만료 {expiry.label}</div> : null;
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
                    { label: '배정 팀', value: selectedSite.team_name },
                  ].filter(i => i.value).map(({ label, value }) => (
                    <div key={label} className="flex justify-between py-1.5 border-b last:border-0">
                      <span className="text-gray-500">{label}</span>
                      <span className="font-medium text-gray-800">{value}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-4">
                  <h3 className="font-semibold text-sm text-gray-700 mb-2">🔧 호기 목록 ({siteElevators.length}대)</h3>
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
                          <span className={`text-xs px-2 py-0.5 rounded-full ${elev.status === '정상' ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'}`}>{elev.status || '-'}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                {canEdit && (
                  <div className="flex gap-2 mt-4">
                    <button onClick={() => handleDeleteSite(selectedSite.id)} className="flex-1 py-2 border border-red-300 text-red-500 rounded-xl text-sm">삭제</button>
                    <button onClick={() => setEditMode(true)} className="flex-1 py-2 bg-blue-500 text-white rounded-xl text-sm font-medium">수정</button>
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="space-y-3">
                  {[
                    { label: '현장명', field: 'site_name', type: 'text' },
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
                    <select value={editForm.contract_type || ''} onChange={e => setEditForm(prev => ({ ...prev, contract_type: e.target.value }))} className="w-full border rounded-xl px-3 py-2 text-sm">
                      <option value="">선택</option>
                      <option value="일반계약">일반계약</option>
                      <option value="종합계약">종합계약</option>
                      <option value="분담일반계약">분담일반계약</option>
                      <option value="분담종합계약">분담종합계약</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-sm text-gray-600 mb-0.5 block">팀 배정</label>
                    <select value={editForm.team_name || ''} onChange={e => setEditForm(prev => ({ ...prev, team_name: e.target.value }))} className="w-full border rounded-xl px-3 py-2 text-sm">
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
