'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { auth, db } from '@/lib/firebase';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import {
  collection, query, where, onSnapshot,
  addDoc, updateDoc, deleteDoc, doc,
  serverTimestamp, orderBy
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
  subscription?: { plan: string; status: string };
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

// ─── 날짜 유틸 ───
function getDday(dateStr?: string): number | null {
  if (!dateStr) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr);
  target.setHours(0, 0, 0, 0);
  return Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function getExpiryBadge(dateStr?: string) {
  const d = getDday(dateStr);
  if (d === null) return null;
  if (d <= 0) return { label: '만료', color: 'bg-red-100 text-red-600' };
  if (d <= 30) return { label: `D-${d} 임박`, color: 'bg-orange-100 text-orange-600' };
  if (d <= 60) return { label: `D-${d}`, color: 'bg-yellow-100 text-yellow-600' };
  return { label: `D-${d}`, color: 'bg-green-100 text-green-600' };
}

// ─── 엑셀 헤더 매핑 ───
const HEADER_MAP: Record<string, keyof SiteItem> = {
  '현장명': 'name',
  '원장번호': 'contractNumber',
  '원장변호': 'contractNumber',
  '보수료': 'maintenanceFee',
  '대수': 'elevatorCount',
  '계약일자': 'contractStart',
  '만료일자': 'contractEnd',
  '생활유통': 'contractType',
  'FM': 'contractType',
  'POG': 'contractType',
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

export default function SitesPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [sites, setSites] = useState<SiteItem[]>([]);
  const [teams, setTeams] = useState<string[]>([]);

  // 탭: contract(계약현장) | team(팀현장)
  const [activeTab, setActiveTab] = useState<'contract' | 'team'>('contract');
  const [selectedTeam, setSelectedTeam] = useState<string>('전체');
  const [searchText, setSearchText] = useState('');

  // 엑셀 파싱 상태
  const [showExcelModal, setShowExcelModal] = useState(false);
  const [excelSheets, setExcelSheets] = useState<string[]>([]);
  const [selectedSheet, setSelectedSheet] = useState('');
  const [excelWorkbook, setExcelWorkbook] = useState<XLSX.WorkBook | null>(null);
  const [excelPreview, setExcelPreview] = useState<Partial<SiteItem>[]>([]);
  const [importTeam, setImportTeam] = useState('');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState('');

  // 현장 추가 모달
  const [showAddModal, setShowAddModal] = useState(false);
  const [addForm, setAddForm] = useState<Partial<SiteItem>>({});
  const [addLoading, setAddLoading] = useState(false);

  // 현장 상세 모달
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
          subscription: data.subscription || {},
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
    const unsub = onSnapshot(q, (snap) => {
      const list: SiteItem[] = snap.docs.map(d => ({ id: d.id, ...d.data() } as SiteItem));
      setSites(list);
      // 팀 목록 추출
      const teamSet = new Set(list.map(s => s.teamName).filter(Boolean) as string[]);
      setTeams(Array.from(teamSet));
    });
    return () => unsub();
  }, [userInfo?.companyId]);

  // ─── 필터링 ───
  const filteredSites = sites.filter(s => {
    // 탭 필터
    if (activeTab === 'contract' && s.source === 'member') return false;
    if (activeTab === 'team' && s.source !== 'member') return false;
    // 팀원은 본인 팀만
    if (!canEdit && s.teamName !== userInfo?.team) return false;
    // 팀 필터 (관리자)
    if (canEdit && selectedTeam !== '전체' && s.teamName !== selectedTeam) return false;
    // 검색
    if (searchText && !s.name?.includes(searchText) && !s.companyName?.includes(searchText)) return false;
    return true;
  });

  // 만료 임박 현장 (관리자용)
  const urgentSites = sites.filter(s => {
    const d = getDday(s.contractEnd);
    return d !== null && d <= 60;
  }).sort((a, b) => (getDday(a.contractEnd) ?? 999) - (getDday(b.contractEnd) ?? 999));

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
          // 날짜 처리
          if (field === 'contractStart' || field === 'contractEnd') {
            const val = row[idx];
            if (val instanceof Date) {
              (item as Record<string, unknown>)[field] = val.toISOString().split('T')[0];
            } else {
              (item as Record<string, unknown>)[field] = String(val);
            }
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

  async function handleImport() {
    if (!excelWorkbook || !userInfo?.companyId) return;
    setImporting(true);
    setImportResult('');
    try {
      const ws = excelWorkbook.Sheets[selectedSheet];
      const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
      if (rows.length < 2) { setImportResult('데이터가 없어요.'); return; }

      const headers = (rows[0] as string[]).map(h => String(h).trim());
      let count = 0;

      for (let i = 1; i < rows.length; i++) {
        const row = rows[i] as unknown[];
        const item: Partial<SiteItem> & { source: string; teamName: string; createdAt: unknown; createdBy: string } = {
          source: 'admin',
          teamName: importTeam || '',
          createdAt: serverTimestamp(),
          createdBy: userInfo.uid,
        };

        headers.forEach((h, idx) => {
          const field = HEADER_MAP[h];
          if (field && row[idx] !== '') {
            if (field === 'contractStart' || field === 'contractEnd') {
              const val = row[idx];
              if (val instanceof Date) {
                (item as Record<string, unknown>)[field] = val.toISOString().split('T')[0];
              } else {
                (item as Record<string, unknown>)[field] = String(val);
              }
            } else if (field === 'maintenanceFee' || field === 'elevatorCount') {
              (item as Record<string, unknown>)[field] = Number(row[idx]) || 0;
            } else {
              (item as Record<string, unknown>)[field] = String(row[idx]);
            }
          }
        });

        if (item.name) {
          await addDoc(collection(db, 'companies', userInfo.companyId, 'sites'), item);
          count++;
        }
      }
      setImportResult(`✅ ${count}개 현장이 등록됐어요!`);
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
          <button onClick={() => router.push('/')} className="text-gray-500 hover:text-gray-700">←</button>
          <h1 className="font-bold text-lg">🏢 현장 관리</h1>
        </div>
        <div className="flex gap-2">
          {canEdit && (
            <>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="text-sm bg-green-500 hover:bg-green-600 text-white px-3 py-1.5 rounded-lg"
              >
                📊 엑셀 가져오기
              </button>
              <button
                onClick={() => setShowAddModal(true)}
                className="text-sm bg-blue-500 hover:bg-blue-600 text-white px-3 py-1.5 rounded-lg"
              >
                + 현장 추가
              </button>
            </>
          )}
        </div>
        <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFileChange} />
      </header>

      <div className="max-w-5xl mx-auto px-4 py-4">

        {/* 만료 임박 알림 (관리자만) */}
        {canEdit && urgentSites.length > 0 && (
          <div className="mb-4 bg-orange-50 border border-orange-200 rounded-xl p-3">
            <p className="text-sm font-bold text-orange-700 mb-2">🔔 계약 만료 임박 ({urgentSites.length}건)</p>
            <div className="flex flex-wrap gap-2">
              {urgentSites.slice(0, 5).map(s => {
                const badge = getExpiryBadge(s.contractEnd);
                return (
                  <button
                    key={s.id}
                    onClick={() => { setSelectedSite(s); setEditForm(s); }}
                    className={`text-xs px-2 py-1 rounded-full font-medium ${badge?.color}`}
                  >
                    {s.name} {badge?.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* 탭 (관리자만) */}
        {canEdit && (
          <div className="flex gap-2 mb-4">
            <button
              onClick={() => setActiveTab('contract')}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${activeTab === 'contract' ? 'bg-blue-500 text-white' : 'bg-white text-gray-600 border'}`}
            >
              📋 계약 현장
            </button>
            <button
              onClick={() => setActiveTab('team')}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${activeTab === 'team' ? 'bg-blue-500 text-white' : 'bg-white text-gray-600 border'}`}
            >
              🏢 팀 현장
            </button>
          </div>
        )}

        {/* 검색 + 팀 필터 */}
        <div className="flex gap-2 mb-4">
          <input
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
            placeholder="현장명 또는 업체명 검색..."
            className="flex-1 border rounded-xl px-3 py-2 text-sm"
          />
          {canEdit && (
            <select
              value={selectedTeam}
              onChange={e => setSelectedTeam(e.target.value)}
              className="border rounded-xl px-3 py-2 text-sm"
            >
              <option value="전체">전체 팀</option>
              {teams.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          )}
        </div>

        {/* 현장 목록 */}
        <div className="grid gap-3">
          {filteredSites.length === 0 ? (
            <div className="text-center py-16 text-gray-400">
              <p className="text-4xl mb-2">🏢</p>
              <p>현장이 없어요</p>
              {canEdit && <p className="text-sm mt-1">엑셀 가져오기 또는 현장 추가를 해보세요!</p>}
            </div>
          ) : (
            filteredSites.map(site => {
              const badge = getExpiryBadge(site.contractEnd);
              return (
                <button
                  key={site.id}
                  onClick={() => { setSelectedSite(site); setEditForm(site); setEditMode(false); }}
                  className="bg-white rounded-xl border p-4 text-left hover:shadow-md transition-shadow"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-bold text-gray-800">{site.name}</span>
                        {site.contractType && (
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${site.contractType === 'FM' ? 'bg-blue-100 text-blue-600' : 'bg-purple-100 text-purple-600'}`}>
                            {site.contractType === 'FM' ? '종합' : '일반'}
                          </span>
                        )}
                        {badge && (
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${badge.color}`}>
                            {badge.label}
                          </span>
                        )}
                      </div>
                      <div className="text-sm text-gray-500 flex flex-wrap gap-x-3 gap-y-0.5">
                        {site.companyName && <span>🏭 {site.companyName}</span>}
                        {site.elevatorCount && <span>🛗 {site.elevatorCount}대</span>}
                        {site.region && <span>📍 {site.region}</span>}
                        {site.teamName && <span>👥 {site.teamName}</span>}
                      </div>
                    </div>
                    <span className="text-gray-300 text-lg">›</span>
                  </div>
                  {site.contractEnd && (
                    <p className="text-xs text-gray-400 mt-1">계약 만료: {site.contractEnd}</p>
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* ─── 엑셀 가져오기 모달 ─── */}
      {showExcelModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-5">
            <h2 className="font-bold text-lg mb-4">📊 엑셀 가져오기</h2>

            {/* 시트 선택 */}
            <div className="mb-3">
              <label className="text-sm font-medium text-gray-700 mb-1 block">시트 선택</label>
              <div className="flex flex-wrap gap-2">
                {excelSheets.map(s => (
                  <button
                    key={s}
                    onClick={() => handleSheetChange(s)}
                    className={`text-sm px-3 py-1.5 rounded-lg border ${selectedSheet === s ? 'bg-blue-500 text-white border-blue-500' : 'text-gray-600'}`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            {/* 팀 배정 */}
            <div className="mb-3">
              <label className="text-sm font-medium text-gray-700 mb-1 block">팀 배정 (선택)</label>
              <select
                value={importTeam}
                onChange={e => setImportTeam(e.target.value)}
                className="w-full border rounded-xl px-3 py-2 text-sm"
              >
                <option value="">팀 미배정</option>
                {teams.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>

            {/* 미리보기 */}
            {excelPreview.length > 0 && (
              <div className="mb-4">
                <p className="text-sm font-medium text-gray-700 mb-1">미리보기 (상위 5개)</p>
                <div className="bg-gray-50 rounded-xl p-3 space-y-2">
                  {excelPreview.map((item, i) => (
                    <div key={i} className="text-xs text-gray-600 border-b pb-1 last:border-0">
                      <span className="font-medium">{item.name}</span>
                      {item.companyName && ` · ${item.companyName}`}
                      {item.contractEnd && ` · 만료: ${item.contractEnd}`}
                      {item.elevatorCount && ` · ${item.elevatorCount}대`}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {importResult && (
              <p className="text-sm text-center mb-3 font-medium text-green-600">{importResult}</p>
            )}

            <div className="flex gap-2">
              <button
                onClick={() => { setShowExcelModal(false); setImportResult(''); }}
                className="flex-1 py-2 border rounded-xl text-sm text-gray-600"
              >
                닫기
              </button>
              <button
                onClick={handleImport}
                disabled={importing}
                className="flex-1 py-2 bg-blue-500 text-white rounded-xl text-sm font-medium disabled:opacity-50"
              >
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
                  <input
                    type={type}
                    value={(addForm as Record<string, unknown>)[field] as string || ''}
                    onChange={e => setAddForm(prev => ({ ...prev, [field]: type === 'number' ? Number(e.target.value) : e.target.value }))}
                    className="w-full border rounded-xl px-3 py-2 text-sm"
                  />
                </div>
              ))}
              <div>
                <label className="text-sm text-gray-600 mb-0.5 block">계약 유형</label>
                <select
                  value={addForm.contractType || ''}
                  onChange={e => setAddForm(prev => ({ ...prev, contractType: e.target.value }))}
                  className="w-full border rounded-xl px-3 py-2 text-sm"
                >
                  <option value="">선택</option>
                  <option value="FM">FM (종합)</option>
                  <option value="POG">POG (일반)</option>
                </select>
              </div>
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
              <button onClick={handleAddSite} disabled={addLoading} className="flex-1 py-2 bg-blue-500 text-white rounded-xl text-sm font-medium disabled:opacity-50">
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
                <div className="space-y-2 text-sm">
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
                  ].filter(item => item.value).map(({ label, value }) => (
                    <div key={label} className="flex justify-between py-1 border-b last:border-0">
                      <span className="text-gray-500">{label}</span>
                      <span className="font-medium text-gray-800">{value}</span>
                    </div>
                  ))}
                </div>
                {/* 만료 배지 */}
                {selectedSite.contractEnd && (() => {
                  const badge = getExpiryBadge(selectedSite.contractEnd);
                  return badge ? (
                    <div className={`mt-3 text-center py-2 rounded-xl text-sm font-medium ${badge.color}`}>
                      계약 만료 {badge.label}
                    </div>
                  ) : null;
                })()}
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
                      <input
                        type={type}
                        value={(editForm as Record<string, unknown>)[field] as string || ''}
                        onChange={e => setEditForm(prev => ({ ...prev, [field]: type === 'number' ? Number(e.target.value) : e.target.value }))}
                        className="w-full border rounded-xl px-3 py-2 text-sm"
                      />
                    </div>
                  ))}
                  <div>
                    <label className="text-sm text-gray-600 mb-0.5 block">계약 유형</label>
                    <select
                      value={editForm.contractType || ''}
                      onChange={e => setEditForm(prev => ({ ...prev, contractType: e.target.value }))}
                      className="w-full border rounded-xl px-3 py-2 text-sm"
                    >
                      <option value="">선택</option>
                      <option value="FM">FM (종합)</option>
                      <option value="POG">POG (일반)</option>
                    </select>
                  </div>
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
