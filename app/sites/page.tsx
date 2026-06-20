'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { auth, db } from '@/lib/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import {
  collection, query, onSnapshot,
  addDoc, updateDoc, deleteDoc, doc,
  serverTimestamp, orderBy, getDocs
} from 'firebase/firestore';
import * as XLSX from 'xlsx';

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
  contractNumber?: string;
  maintenanceFee?: number;
  elevatorCount?: number;
  contractStart?: string;
  contractEnd?: string;
  contractType?: string;
  contractPerson?: string;
  companyName?: string;
  phone?: string;
  email?: string;
  region?: string;
  teamName?: string;
  source?: 'admin' | 'member';
  createdAt?: unknown;
}

interface ElevatorItem {
  id: string;
  hogiNo?: string;
  type?: string;
  status?: string;
  installDate?: string;
  inspectionDate?: string;
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

// ─── 헤더 매핑 ───
const HEADER_MAP: Record<string, keyof SiteItem> = {
  '현장명': 'name',
  '원장번호': 'contractNumber',
  '원장변호': 'contractNumber',
  '보수료': 'maintenanceFee',
  '대수': 'elevatorCount',
  '계약일자': 'contractStart',
  '만료일자': 'contractEnd',
  '생활유통': 'contractType',
  '계약종류': 'contractType',
  '계약 종류': 'contractType',
  '전화번호': 'phone',
  '계약자': 'contractPerson',
  '제약자': 'contractPerson',
  '업체명': 'companyName',
  '계약업체': 'companyName',
  '지역': 'region',
  '주소': 'address',
  '메일주소': 'email',
  '이메일': 'email',
};

type SortKey = 'name' | 'contractEnd' | 'maintenanceFee' | 'elevatorCount' | 'companyName';
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
  const [sortKey, setSortKey] = useState<SortKey>('contractEnd');
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
  const isSuperAdmin = userInfo?.superAdmin === true;
  const canEdit = isAdmin || isSuperAdmin;

  // ─── 인증 ───
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) { router.push('/login'); return; }
      try {
        const { getDoc } = await import('firebase/firestore');
        const snap = await getDoc(doc(db, 'users', user.uid));
        if (!snap.exists()) { router.push('/login'); return; }
        const data = snap.data();
        if (!data.companyId) { router.push('/'); return; }
        setUserInfo({
          uid: user.uid,
          name: data.name || '',
          email: user.email || '',
          companyId: data.companyId,
          companyDisplayName: data.companyDisplayName || '',
          team: data.team || '',
          role: data.role || 'member',
          superAdmin: data.superAdmin || false,
        });
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    });
    return () => unsub();
  }, [router]);

  // ─── 현장 구독 ───
  useEffect(() => {
    if (!userInfo?.companyId) return;
    const q = query(
      collection(db, 'companies', userInfo.companyId, 'sites'),
      orderBy('createdAt', 'desc')
    );
    getDocs(q).then(async (snap) => {
      const list: SiteItem[] = snap.docs.map(d => {
        const data = d.data();
        return {
          id: d.id,
          ...data,
          name: data.name || data.siteName || '',
          teamName: data.teamName || data.team || '',
        } as SiteItem;
      });
      setSites(list);
      const teamSet = new Set(list.map(s => s.teamName).filter(Boolean) as string[]);
      setTeams(Array.from(teamSet));

      // 전체 호기 수 합산
      let total = 0;
      for (const siteDoc of snap.docs) {
        const elevsSnap = await getDocs(
          collection(db, 'companies', userInfo.companyId, 'sites', siteDoc.id, 'elevators')
        );
        total += elevsSnap.size;
      }
      setTotalElevatorCount(total);
    }).catch(console.error);
  }, [userInfo?.companyId]);


  // ─── 현장 클릭 시 호기 로드 ───
  async function handleSiteClick(site: SiteItem) {
    setSelectedSite(site);
    setEditForm(site);
    setEditMode(false);
    setSiteElevators([]);
    setElevatorsLoading(true);
    try {
      const snap = await getDocs(
        collection(db, 'companies', userInfo!.companyId, 'sites', site.id, 'elevators')
      );
      setSiteElevators(snap.docs.map(d => ({ id: d.id, ...d.data() } as ElevatorItem)));
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
      if (!canEdit && s.teamName !== userInfo?.team) return false;
      if (canEdit && selectedTeam !== '전체' && s.teamName !== selectedTeam) return false;
      if (selectedType !== '전체' && s.contractType !== selectedType) return false;
      if (expiryFilter === 'expired') {
        const d = getDday(s.contractEnd);
        if (d === null || d > 0) return false;
      }
      if (expiryFilter === 'urgent') {
        const d = getDday(s.contractEnd);
        if (d === null || d <= 0 || d > 30) return false;
      }
      if (expiryFilter === 'warning') {
        const d = getDday(s.contractEnd);
        if (d === null || d <= 30 || d > 60) return false;
      }
      if (searchText) {
        const q = searchText.toLowerCase();
        return s.name?.toLowerCase().includes(q) ||
          s.companyName?.toLowerCase().includes(q) ||
          s.region?.toLowerCase().includes(q);
      }
      return true;
    })
    .sort((a, b) => {
      let valA: string | number = '';
      let valB: string | number = '';
      if (sortKey === 'contractEnd') {
        valA = a.contractEnd || '9999';
        valB = b.contractEnd || '9999';
      } else if (sortKey === 'maintenanceFee') {
        valA = a.maintenanceFee || 0;
        valB = b.maintenanceFee || 0;
      } else if (sortKey === 'elevatorCount') {
        valA = a.elevatorCount || 0;
        valB = b.elevatorCount || 0;
      } else if (sortKey === 'name') {
        valA = a.name || '';
        valB = b.name || '';
      } else if (sortKey === 'companyName') {
        valA = a.companyName || '';
        valB = b.companyName || '';
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
  const expiredCount = tabSites.filter(s => (getDday(s.contractEnd) ?? 999) <= 0).length;
  const urgentCount = tabSites.filter(s => { const d = getDday(s.contractEnd); return d !== null && d > 0 && d <= 30; }).length;
  const warningCount = tabSites.filter(s => { const d = getDday(s.contractEnd); return d !== null && d > 30 && d <= 60; }).length;

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
          if (field === 'contractStart' || field === 'contractEnd') {
            const val = row[idx];
            (item as Record<string, unknown>)[field] = val instanceof Date ? val.toISOString().split('T')[0] : String(val);
          } else if (field === 'maintenanceFee' || field === 'elevatorCount') {
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
    if (!excelWorkbook || !userInfo?.companyId) return;
    setImporting(true);
    setImportResult('');
    try {
      const ws = excelWorkbook.Sheets[selectedSheet];
      const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
      if (rows.length < 2) { setImportResult('데이터가 없어요.'); return; }
      const headers = (rows[0] as string[]).map(h => String(h).trim());
      const existingSnap = await getDocs(collection(db, 'companies', userInfo.companyId, 'sites'));
      const existingMap = new Map<string, string>();
      existingSnap.docs.forEach(d => {
        const name = d.data().name;
        if (name) existingMap.set(name, d.id);
      });
      let addCount = 0;
      let updateCount = 0;
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i] as unknown[];
        const item: Record<string, unknown> = {
          source: 'admin',
          teamName: importTeam || '',
          updatedAt: serverTimestamp(),
        };
        headers.forEach((h, idx) => {
          const field = HEADER_MAP[h];
          if (field && row[idx] !== '') {
            if (field === 'contractStart' || field === 'contractEnd') {
              const val = row[idx];
              item[field] = val instanceof Date ? val.toISOString().split('T')[0] : String(val);
            } else if (field === 'maintenanceFee' || field === 'elevatorCount') {
              item[field] = Number(row[idx]) || 0;
            } else {
              item[field] = String(row[idx]);
            }
          }
        });
        if (!item.name) continue;
        const existingId = existingMap.get(item.name as string);
        if (existingId) {
          await updateDoc(doc(db, 'companies', userInfo.companyId, 'sites', existingId), item);
          updateCount++;
        } else {
          await addDoc(collection(db, 'companies', userInfo.companyId, 'sites'),
            { ...item, createdAt: serverTimestamp(), createdBy: userInfo.uid });
          addCount++;
        }
      }
      setImportResult(`✅ 신규 ${addCount}개 추가 · 기존 ${updateCount}개 업데이트 완료!`);
    } catch (e) {
      console.error(e);
      setImportResult('❌ 가져오기 중 오류가 발생했어요.');
    } finally {
      setImporting(false);
    }
  }

  // ─── 현장 추가 ───
  async function handleAddSite() {
    if (!addForm.name?.trim() || !userInfo?.companyId) return;
    setAddLoading(true);
    try {
      await addDoc(collection(db, 'companies', userInfo.companyId, 'sites'), {
        ...addForm,
        source: 'admin',
        createdAt: serverTimestamp(),
        createdBy: userInfo.uid,
      });
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
    if (!selectedSite || !userInfo?.companyId) return;
    try {
      await updateDoc(doc(db, 'companies', userInfo.companyId, 'sites', selectedSite.id), {
        ...editForm,
        updatedAt: serverTimestamp(),
      });
      setEditMode(false);
      setSelectedSite({ ...selectedSite, ...editForm });
    } catch (e) {
      console.error(e);
    }
  }

  // ─── 현장 삭제 ───
  async function handleDeleteSite(siteId: string) {
    if (!userInfo?.companyId) return;
    if (!confirm('현장을 삭제할까요?')) return;
    await deleteDoc(doc(db, 'companies', userInfo.companyId, 'sites', siteId));
    setSelectedSite(null);
  }

  // ─── 전체 삭제 ───
  async function handleDeleteAll() {
    if (!userInfo?.companyId) return;
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
      for (const site of targetSites) {
        await deleteDoc(doc(db, 'companies', userInfo.companyId, 'sites', site.id));
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
                    <button onClick={() => handleSort('companyName')} className="flex items-center hover:text-blue-600">
                      계약업체 <SortIcon k="companyName" />
                    </button>
                  </th>
                  <th className="text-center px-3 py-2.5 font-semibold text-gray-600 whitespace-nowrap">유형</th>
                  <th className="text-center px-3 py-2.5 font-semibold text-gray-600 whitespace-nowrap">
                    <button onClick={() => handleSort('elevatorCount')} className="flex items-center justify-center hover:text-blue-600">
                      대수 <SortIcon k="elevatorCount" />
                    </button>
                  </th>
                  <th className="text-right px-3 py-2.5 font-semibold text-gray-600 whitespace-nowrap">
                    <button onClick={() => handleSort('maintenanceFee')} className="flex items-center justify-end hover:text-blue-600">
                      보수료 <SortIcon k="maintenanceFee" />
                    </button>
                  </th>
                  <th className="text-center px-3 py-2.5 font-semibold text-gray-600 whitespace-nowrap">
                    <button onClick={() => handleSort('contractEnd')} className="flex items-center justify-center hover:text-blue-600">
                      계약만료 <SortIcon k="contractEnd" />
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
                    const expiry = getExpiryInfo(site.contractEnd);
                    return (
                      <tr
                        key={site.id}
                        onClick={() => handleSiteClick(site)}
                        className={`border-b last:border-0 cursor-pointer hover:bg-blue-50 transition-colors ${expiry?.rowColor || (idx % 2 === 0 ? '' : 'bg-gray-50/50')}`}
                      >
                        <td className="px-3 py-2.5 font-medium text-gray-800 whitespace-nowrap">{site.name}</td>
                        <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">{site.companyName || '-'}</td>
                        <td className="px-3 py-2.5 text-center whitespace-nowrap">
                          {site.contractType ? (
  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
    site.contractType.includes('종합') ? 'bg-blue-100 text-blue-600' :
    site.contractType.includes('일반') ? 'bg-purple-100 text-purple-600' :
    'bg-gray-100 text-gray-600'
  }`}>
    {site.contractType}
  </span>
) : '-'}

                        </td>
                        <td className="px-3 py-2.5 text-center text-gray-600 whitespace-nowrap">
                          {site.elevatorCount ? `${site.elevatorCount}대` : '-'}
                        </td>
                        <td className="px-3 py-2.5 text-right text-gray-600 whitespace-nowrap">
                          {site.maintenanceFee ? `${site.maintenanceFee.toLocaleString()}` : '-'}
                        </td>
                        <td className="px-3 py-2.5 text-center text-gray-600 whitespace-nowrap">
                          {site.contractEnd || '-'}
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
                            {site.teamName ? (
                              <span className="text-xs bg-gray-100 px-2 py-0.5 rounded-full">{site.teamName}</span>
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

              <span>보수료 합계 <strong className="text-gray-700">{filteredSites.reduce((s, i) => s + (i.maintenanceFee || 0), 0).toLocaleString()}</strong>원</span>
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
                          <td className="px-2 py-1.5 text-gray-500">{item.companyName || '-'}</td>
                          <td className="px-2 py-1.5 text-center text-gray-500">{item.contractEnd || '-'}</td>
                          <td className="px-2 py-1.5 text-center text-gray-500">{item.elevatorCount || '-'}</td>
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
                { label: '계약업체', field: 'companyName', type: 'text' },
                { label: '전화번호', field: 'phone', type: 'text' },
                { label: '계약자', field: 'contractPerson', type: 'text' },
                { label: '승강기 대수', field: 'elevatorCount', type: 'number' },
                { label: '보수료', field: 'maintenanceFee', type: 'number' },
                { label: '계약 시작일', field: 'contractStart', type: 'date' },
                { label: '계약 만료일', field: 'contractEnd', type: 'date' },
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
                <select value={addForm.contractType || ''}
                  onChange={e => setAddForm(prev => ({ ...prev, contractType: e.target.value }))}
                  className="w-full border rounded-xl px-3 py-2 text-sm">
                  <option value="">선택</option>
                  <option value="FM">FM (종합)</option>
                  <option value="POG">POG (일반)</option>
                </select>
              </div>
              <div>
                <label className="text-sm text-gray-600 mb-0.5 block">팀 배정</label>
                <select value={addForm.teamName || ''}
                  onChange={e => setAddForm(prev => ({ ...prev, teamName: e.target.value }))}
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
                {selectedSite.contractEnd && (() => {
                  const expiry = getExpiryInfo(selectedSite.contractEnd);
                  return expiry ? (
                    <div className={`mb-3 text-center py-2 rounded-xl text-sm font-medium ${expiry.color}`}>
                      {expiry.dot} 계약 만료 {expiry.label}
                    </div>
                  ) : null;
                })()}
                <div className="space-y-1.5 text-sm">
                  {[
                    { label: '계약업체', value: selectedSite.companyName },
                    { label: '계약 유형', value: selectedSite.contractType === 'FM' ? 'FM (종합)' : selectedSite.contractType === 'POG' ? 'POG (일반)' : selectedSite.contractType },
                    { label: '승강기 대수', value: selectedSite.elevatorCount ? `${selectedSite.elevatorCount}대` : undefined },
                    { label: '보수료', value: selectedSite.maintenanceFee ? `${selectedSite.maintenanceFee.toLocaleString()}원` : undefined },
                    { label: '계약 시작일', value: selectedSite.contractStart },
                    { label: '계약 만료일', value: selectedSite.contractEnd },
                    { label: '계약자', value: selectedSite.contractPerson },
                    { label: '전화번호', value: selectedSite.phone },
                    { label: '이메일', value: selectedSite.email },
                    { label: '지역', value: selectedSite.region },
                    { label: '주소', value: selectedSite.address },
                    { label: '배정 팀', value: selectedSite.teamName },
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
                    { label: '계약업체', field: 'companyName', type: 'text' },
                    { label: '전화번호', field: 'phone', type: 'text' },
                    { label: '계약자', field: 'contractPerson', type: 'text' },
                    { label: '승강기 대수', field: 'elevatorCount', type: 'number' },
                    { label: '보수료', field: 'maintenanceFee', type: 'number' },
                    { label: '계약 시작일', field: 'contractStart', type: 'date' },
                    { label: '계약 만료일', field: 'contractEnd', type: 'date' },
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
                    <select value={editForm.contractType || ''}
                      onChange={e => setEditForm(prev => ({ ...prev, contractType: e.target.value }))}
                      className="w-full border rounded-xl px-3 py-2 text-sm">
                      <option value="">선택</option>
                      <option value="FM">FM (종합)</option>
                      <option value="POG">POG (일반)</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-sm text-gray-600 mb-0.5 block">팀 배정</label>
                    <select value={editForm.teamName || ''}
                      onChange={e => setEditForm(prev => ({ ...prev, teamName: e.target.value }))}
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
