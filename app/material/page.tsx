// app/(pages)/material/page.tsx
'use client';

import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  deleteDoc,
  where,
} from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { useEffect, useMemo, useState } from 'react';
import { auth, db } from '@/lib/firebase';

// ─────────────────────────────────────────────
// 타입 정의
// ─────────────────────────────────────────────
type MaterialStatus = '신청중' | '자재분출' | '자재교체';

type MaterialRequest = {
  id: string;
  companyId: string;
  team?: string;
  siteId: string;
  siteName: string;
  hogiNo: string;
  materialName: string;
  spec?: string;
  quantity: number;
  unit: string;
  reason?: string;
  requesterId?: string;
  requesterName?: string;
  dispatcherId?: string;
  dispatcherName?: string;
  replacerId?: string;
  replacerName?: string;
  status: MaterialStatus;
  requestedAt?: any;
  dispatchedAt?: any;
  replacedAt?: any;
  note?: string;
  createdAt?: any;
};

type Site = {
  id: string;
  siteName: string;
  address?: string;
  companyId?: string;
  team?: string;
};

type UserInfo = {
  uid: string;
  name: string;
  email: string;
  role: string;
  companyId?: string;
  team?: string;
  useNewStructure?: boolean;
  subscriptionPlan?: string;
};

// ─────────────────────────────────────────────
// 상태 스타일
// ─────────────────────────────────────────────
const STATUS_STYLE: Record<MaterialStatus, { bg: string; text: string; border: string; label: string }> = {
  신청중:   { bg: '#FEF3C7', text: '#92400E', border: '#F59E0B', label: '신청중' },
  자재분출: { bg: '#DBEAFE', text: '#1E40AF', border: '#3B82F6', label: '자재분출' },
  자재교체: { bg: '#D1FAE5', text: '#065F46', border: '#10B981', label: '교체완료' },
};

// ─────────────────────────────────────────────
// 날짜 헬퍼
// ─────────────────────────────────────────────
const formatTs = (ts: any): string => {
  if (!ts) return '-';
  try {
    const d = ts instanceof Timestamp ? ts.toDate() : ts?.seconds ? new Date(ts.seconds * 1000) : new Date(ts);
    if (isNaN(d.getTime())) return '-';
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  } catch { return '-'; }
};

const tsToDateStr = (ts: any): string => {
  if (!ts) return '';
  try {
    const d = ts instanceof Timestamp ? ts.toDate() : ts?.seconds ? new Date(ts.seconds * 1000) : new Date(ts);
    if (isNaN(d.getTime())) return '';
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  } catch { return ''; }
};

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
};

const printHtml = (html: string) => {
  const w = window.open('', '_blank');
  if (!w) return;
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => { w.print(); }, 500);
};

// ─────────────────────────────────────────────
// 메인 컴포넌트
// ─────────────────────────────────────────────
export default function MaterialPage() {
  const [userInfo, setUserInfo]     = useState<UserInfo | null>(null);
  const [loading, setLoading]       = useState(true);
  const [requests, setRequests]     = useState<MaterialRequest[]>([]);
  const [sites, setSites]           = useState<Site[]>([]);

  // 필터
  const [search, setSearch]             = useState('');
  const [statusFilter, setStatusFilter] = useState<MaterialStatus | '전체'>('전체');
  const [teamFilter, setTeamFilter]     = useState('전체');

  // 상세 모달
  const [detailModal, setDetailModal]   = useState(false);
  const [selected, setSelected]         = useState<MaterialRequest | null>(null);

  // PDF 모달
  const [pdfModal, setPdfModal]         = useState(false);
  const [pdfSiteId, setPdfSiteId]       = useState('');
  const [pdfSiteName, setPdfSiteName]   = useState('');
  const [pdfDateFrom, setPdfDateFrom]   = useState('');
  const [pdfDateTo, setPdfDateTo]       = useState('');
  const [pdfStatusFilter, setPdfStatusFilter] = useState<MaterialStatus | '전체'>('전체');

  // ── 인증 및 데이터 구독 ──
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) { window.location.href = '/login'; return; }
      try {
        const { doc, getDoc } = await import('firebase/firestore');
        const snap = await getDoc(doc(db, 'users', user.uid));
        if (!snap.exists()) { window.location.href = '/login'; return; }
        const data = snap.data() as UserInfo;
        if (!['admin', 'superadmin'].includes(data.role)) {
          alert('관리자만 접근 가능합니다.');
          window.location.href = '/';
          return;
        }
        setUserInfo({ ...data, uid: user.uid });
      } catch (e) {
        console.error(e);
        window.location.href = '/login';
      }
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!userInfo) return;
    const isSuperAdmin = userInfo.role === 'superadmin';
    const useNew = userInfo.useNewStructure && !!userInfo.companyId;
    const cid = userInfo.companyId || '';

    const unsubs: (() => void)[] = [];

    // materialRequests 구독
    const matCol = useNew
      ? collection(db, 'companies', cid, 'materialRequests')
      : collection(db, 'materialRequests');
    const matQ = isSuperAdmin
      ? query(matCol, orderBy('createdAt', 'desc'))
      : useNew
        ? query(matCol, orderBy('createdAt', 'desc'))
        : query(matCol, where('companyId', '==', cid), orderBy('createdAt', 'desc'));
    unsubs.push(onSnapshot(matQ, (snap) => {
      setRequests(snap.docs.map((d) => ({ id: d.id, ...d.data() } as MaterialRequest)));
      setLoading(false);
    }));

    // sites 구독
    const siteCol = useNew
      ? collection(db, 'companies', cid, 'sites')
      : collection(db, 'sites');
    const siteQ = isSuperAdmin
      ? query(siteCol)
      : useNew
        ? query(siteCol)
        : query(siteCol, where('companyId', '==', cid));
    unsubs.push(onSnapshot(siteQ, (snap) => {
      setSites(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Site)));
    }));

    return () => unsubs.forEach((u) => u());
  }, [userInfo]);

  // ── 팀 목록 ──
  const teams = useMemo(() => {
    const set = new Set(requests.map((r) => r.team).filter(Boolean) as string[]);
    return ['전체', ...Array.from(set)];
  }, [requests]);

  // ── 필터된 목록 ──
  const filtered = useMemo(() => {
    let list = requests;
    if (teamFilter !== '전체') list = list.filter((r) => r.team === teamFilter);
    if (statusFilter !== '전체') list = list.filter((r) => r.status === statusFilter);
    if (search.trim()) {
      const s = search.toLowerCase();
      list = list.filter((r) =>
        r.siteName?.toLowerCase().includes(s) ||
        r.materialName?.toLowerCase().includes(s) ||
        r.hogiNo?.toLowerCase().includes(s) ||
        r.requesterName?.toLowerCase().includes(s)
      );
    }
    return list;
  }, [requests, search, statusFilter, teamFilter]);

  // ── 통계 ──
  const stats = useMemo(() => ({
    전체:     requests.length,
    신청중:   requests.filter((r) => r.status === '신청중').length,
    자재분출: requests.filter((r) => r.status === '자재분출').length,
    자재교체: requests.filter((r) => r.status === '자재교체').length,
  }), [requests]);

  // ── Firestore 경로 헬퍼 ──
  const getDocRef = (id: string) => {
    const useNew = userInfo?.useNewStructure && !!userInfo?.companyId;
    const cid = userInfo?.companyId || '';
    return useNew
      ? doc(db, 'companies', cid, 'materialRequests', id)
      : doc(db, 'materialRequests', id);
  };

  // ── 자재분출 처리 ──
  const handleDispatch = async (item: MaterialRequest) => {
    if (!confirm(`${item.materialName} 자재분출 처리하시겠습니까?`)) return;
    try {
      await updateDoc(getDocRef(item.id), {
        status: '자재분출',
        dispatchedAt: serverTimestamp(),
        dispatcherId: userInfo?.uid || '',
        dispatcherName: userInfo?.name || '',
      });
      // 상세 모달 내용 갱신
      setSelected((prev) => prev ? { ...prev, status: '자재분출', dispatcherName: userInfo?.name } : prev);
    } catch (e) {
      alert('자재분출 처리 실패');
    }
  };

  // ── 자재교체 완료 처리 ──
  const handleReplace = async (item: MaterialRequest) => {
    if (!confirm(`${item.materialName} 교체완료 처리하시겠습니까?`)) return;
    try {
      await updateDoc(getDocRef(item.id), {
        status: '자재교체',
        replacedAt: serverTimestamp(),
        replacerId: userInfo?.uid || '',
        replacerName: userInfo?.name || '',
      });
      setSelected((prev) => prev ? { ...prev, status: '자재교체', replacerName: userInfo?.name } : prev);
    } catch (e) {
      alert('자재교체 처리 실패');
    }
  };

  // ── 삭제 ──
  const handleDelete = async (id: string) => {
    if (!confirm('이 자재신청을 삭제하시겠습니까?')) return;
    try {
      await deleteDoc(getDocRef(id));
      setDetailModal(false);
    } catch {
      alert('삭제 실패');
    }
  };

  // ── PDF 필터된 목록 ──
  const pdfFiltered = useMemo(() => {
    let list = requests;
    if (pdfSiteId) list = list.filter((r) => r.siteId === pdfSiteId);
    if (pdfStatusFilter !== '전체') list = list.filter((r) => r.status === pdfStatusFilter);
    if (pdfDateFrom) list = list.filter((r) => tsToDateStr(r.requestedAt) >= pdfDateFrom);
    if (pdfDateTo)   list = list.filter((r) => tsToDateStr(r.requestedAt) <= pdfDateTo);
    return list;
  }, [requests, pdfSiteId, pdfStatusFilter, pdfDateFrom, pdfDateTo]);

  // ── PDF 생성 ──
  const exportPDF = () => {
    if (pdfFiltered.length === 0) { alert('출력할 내역이 없습니다.'); return; }

    const titleSite   = pdfSiteId ? (sites.find((s) => s.id === pdfSiteId)?.siteName || '') : '전체 현장';
    const titlePeriod = pdfDateFrom && pdfDateTo
      ? `${pdfDateFrom} ~ ${pdfDateTo}`
      : pdfDateFrom ? `${pdfDateFrom} 이후`
      : pdfDateTo   ? `${pdfDateTo} 이전`
      : '전체 기간';

    const rows = pdfFiltered.map((r, i) => `
      <tr>
        <td style="text-align:center">${i + 1}</td>
        <td>${formatTs(r.requestedAt)}</td>
        <td>${r.siteName}</td>
        <td style="text-align:center">${r.hogiNo}</td>
        <td>${r.materialName}${r.spec ? ` (${r.spec})` : ''}</td>
        <td style="text-align:center">${r.quantity}${r.unit}</td>
        <td>${r.reason || '-'}</td>
        <td style="text-align:center">
          <span style="padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600;
            background:${r.status==='신청중'?'#FEF3C7':r.status==='자재분출'?'#DBEAFE':'#D1FAE5'};
            color:${r.status==='신청중'?'#92400E':r.status==='자재분출'?'#1E40AF':'#065F46'}">
            ${r.status}
          </span>
        </td>
        <td>${r.requesterName || '-'}</td>
        <td>${formatTs(r.dispatchedAt)}</td>
        <td>${formatTs(r.replacedAt)}</td>
      </tr>`
    ).join('');

    const html = `
      <html>
        <head>
          <meta charset="utf-8"/>
          <style>
            @page { size: A4 landscape; margin: 15mm; }
            body { font-family: Arial, sans-serif; }
            h1 { text-align:center; font-size:20px; margin-bottom:4px; }
            h3 { text-align:center; color:#6B7280; font-weight:normal; margin-top:0; margin-bottom:16px; font-size:13px; }
            table { width:100%; border-collapse:collapse; font-size:11px; }
            th,td { border:1px solid #ddd; padding:5px 7px; }
            th { background:#F3F4F6; }
            tr:nth-child(even) { background:#F9FAFB; }
          </style>
        </head>
        <body>
          <h1>자재신청 내역</h1>
          <h3>${titleSite} / ${titlePeriod} (총 ${pdfFiltered.length}건)</h3>
          <table>
            <thead>
              <tr>
                <th>번호</th><th>신청일시</th><th>현장</th><th>호기</th>
                <th>자재명</th><th>수량</th><th>사유</th><th>상태</th>
                <th>신청자</th><th>분출일시</th><th>교체완료일시</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </body>
      </html>`;

    printHtml(html);
    setPdfModal(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <div className="w-10 h-10 border-4 border-yellow-400 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-gray-500">자재신청 내역 불러오는 중...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">

      {/* 헤더 */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">자재신청 관리</h1>
          <p className="text-sm text-gray-500 mt-1">앱에서 신청된 자재를 확인하고 처리하세요</p>
        </div>
        <button
          onClick={() => setPdfModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 font-semibold text-sm"
        >
          📄 PDF 출력
        </button>
      </div>

      {/* 통계 카드 */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {([
          { label: '전체',     value: stats.전체,     color: 'text-gray-700',  bg: 'bg-gray-50'   },
          { label: '신청중',   value: stats.신청중,   color: 'text-yellow-700',bg: 'bg-yellow-50' },
          { label: '자재분출', value: stats.자재분출, color: 'text-blue-700',  bg: 'bg-blue-50'   },
          { label: '교체완료', value: stats.자재교체, color: 'text-green-700', bg: 'bg-green-50'  },
        ] as const).map((s) => (
          <div key={s.label} className={`${s.bg} rounded-xl p-4 border border-gray-100`}>
            <p className={`text-3xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-sm text-gray-500 mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      {/* 필터 영역 */}
      <div className="flex flex-wrap gap-3 mb-4">
        {/* 검색 */}
        <input
          type="text"
          placeholder="현장명, 자재명, 호기, 신청자 검색"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="border border-gray-200 rounded-lg px-4 py-2 text-sm w-72 focus:outline-none focus:ring-2 focus:ring-yellow-400"
        />

        {/* 상태 필터 */}
        <div className="flex gap-2">
          {(['전체', '신청중', '자재분출', '자재교체'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-2 rounded-lg text-sm font-semibold border transition-colors ${
                statusFilter === s
                  ? 'bg-yellow-400 text-white border-yellow-400'
                  : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
              }`}
            >
              {s === '자재교체' ? '교체완료' : s}
            </button>
          ))}
        </div>

        {/* 팀 필터 */}
        {teams.length > 1 && (
          <select
            value={teamFilter}
            onChange={(e) => setTeamFilter(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400"
          >
            {teams.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        )}
      </div>

      {/* 테이블 */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">상태</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">신청일시</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">현장</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">호기</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">자재명</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">수량</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">신청자</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">분출일시</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">교체완료일시</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">처리</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={10} className="text-center py-16 text-gray-400">
                    <div className="text-4xl mb-2">📦</div>
                    <p>자재신청 내역이 없습니다.</p>
                  </td>
                </tr>
              ) : filtered.map((r) => {
                const st = STATUS_STYLE[r.status] || STATUS_STYLE['신청중'];
                return (
                  <tr
                    key={r.id}
                    className="hover:bg-gray-50 cursor-pointer"
                    onClick={() => { setSelected(r); setDetailModal(true); }}
                  >
                    <td className="px-4 py-3">
                      <span style={{ background: st.bg, color: st.text, border: `1px solid ${st.border}` }}
                        className="px-2 py-1 rounded-full text-xs font-semibold">
                        {st.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-600 text-xs">{formatTs(r.requestedAt)}</td>
                    <td className="px-4 py-3 font-semibold text-gray-900">{r.siteName}</td>
                    <td className="px-4 py-3 text-gray-600">{r.hogiNo}호기</td>
                    <td className="px-4 py-3 text-gray-900">
                      {r.materialName}{r.spec ? ` (${r.spec})` : ''}
                    </td>
                    <td className="px-4 py-3 font-semibold text-yellow-700">{r.quantity}{r.unit}</td>
                    <td className="px-4 py-3 text-gray-600">{r.requesterName || '-'}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{formatTs(r.dispatchedAt)}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{formatTs(r.replacedAt)}</td>
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      {r.status === '신청중' && (
                        <button
                          onClick={() => handleDispatch(r)}
                          className="px-3 py-1.5 bg-blue-100 text-blue-700 rounded-lg text-xs font-semibold hover:bg-blue-200"
                        >
                          📦 자재분출
                        </button>
                      )}
                      {r.status === '자재분출' && (
                        <button
                          onClick={() => handleReplace(r)}
                          className="px-3 py-1.5 bg-green-100 text-green-700 rounded-lg text-xs font-semibold hover:bg-green-200"
                        >
                          ✅ 교체완료
                        </button>
                      )}
                      {r.status === '자재교체' && (
                        <span className="text-xs text-gray-400">완료</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── 상세 모달 ── */}
      {detailModal && selected && (() => {
        const st = STATUS_STYLE[selected.status] || STATUS_STYLE['신청중'];
        // 최신 데이터 반영
        const current = requests.find((r) => r.id === selected.id) || selected;
        return (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden">
              {/* 모달 헤더 */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
                <h2 className="text-lg font-bold text-gray-900">자재신청 상세</h2>
                <button onClick={() => setDetailModal(false)} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
              </div>

              <div className="p-6 overflow-y-auto max-h-[70vh]">
                {/* 상태 배지 */}
                <div className="flex justify-center mb-6">
                  <span style={{ background: st.bg, color: st.text, border: `1px solid ${st.border}` }}
                    className="px-6 py-2 rounded-full text-sm font-bold">
                    {st.label}
                  </span>
                </div>

                {/* 신청 정보 */}
                <div className="bg-gray-50 rounded-xl p-4 mb-4">
                  <p className="text-xs font-bold text-blue-600 mb-3">📋 신청 정보</p>
                  {[
                    { label: '현장',   value: current.siteName },
                    { label: '호기',   value: `${current.hogiNo}호기` },
                    { label: '자재명', value: `${current.materialName}${current.spec ? ` (${current.spec})` : ''}` },
                    { label: '수량',   value: `${current.quantity}${current.unit}` },
                    { label: '사유',   value: current.reason || '-' },
                    { label: '비고',   value: current.note   || '-' },
                  ].map((row) => (
                    <div key={row.label} className="flex py-2 border-b border-gray-100 last:border-0">
                      <span className="w-20 text-xs text-gray-500 font-semibold">{row.label}</span>
                      <span className="text-sm text-gray-900 flex-1">{row.value}</span>
                    </div>
                  ))}
                </div>

                {/* 처리 이력 */}
                <div className="bg-gray-50 rounded-xl p-4 mb-4">
                  <p className="text-xs font-bold text-blue-600 mb-3">⏱ 처리 이력</p>
                  {[
                    { label: '신청일시', value: formatTs(current.requestedAt),  sub: current.requesterName },
                    { label: '분출일시', value: formatTs(current.dispatchedAt), sub: current.dispatcherName },
                    { label: '교체완료', value: formatTs(current.replacedAt),   sub: current.replacerName },
                  ].map((row) => (
                    <div key={row.label} className="flex py-2 border-b border-gray-100 last:border-0">
                      <span className="w-20 text-xs text-gray-500 font-semibold">{row.label}</span>
                      <div className="flex-1">
                        <p className="text-sm text-gray-900">{row.value}</p>
                        {row.sub && <p className="text-xs text-gray-400 mt-0.5">{row.sub}</p>}
                      </div>
                    </div>
                  ))}
                </div>

                {/* 액션 버튼 */}
                {current.status === '신청중' && (
                  <button
                    onClick={() => handleDispatch(current)}
                    className="w-full py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 mb-2"
                  >
                    📦 자재분출 처리
                  </button>
                )}
                {current.status === '자재분출' && (
                  <button
                    onClick={() => handleReplace(current)}
                    className="w-full py-3 bg-green-600 text-white rounded-xl font-bold hover:bg-green-700 mb-2"
                  >
                    ✅ 교체완료 처리
                  </button>
                )}
                <button
                  onClick={() => handleDelete(current.id)}
                  className="w-full py-2.5 bg-red-50 text-red-600 rounded-xl font-semibold hover:bg-red-100 text-sm mt-1"
                >
                  🗑 삭제
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── PDF 모달 ── */}
      {pdfModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="text-lg font-bold text-gray-900">PDF 출력 옵션</h2>
              <button onClick={() => setPdfModal(false)} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
            </div>

            <div className="p-6 overflow-y-auto max-h-[75vh]">
              {/* 기간 퀵 버튼 */}
              <p className="text-xs font-semibold text-gray-500 mb-2">출력 기간</p>
              <div className="flex flex-wrap gap-2 mb-3">
                {[
                  { label: '이번 달', action: () => {
                    const t = new Date();
                    const y = t.getFullYear(), m = String(t.getMonth()+1).padStart(2,'0');
                    const last = new Date(y, t.getMonth()+1, 0).getDate();
                    setPdfDateFrom(`${y}-${m}-01`); setPdfDateTo(`${y}-${m}-${String(last).padStart(2,'0')}`);
                  }},
                  { label: '지난 달', action: () => {
                    const t = new Date(), prev = new Date(t.getFullYear(), t.getMonth()-1, 1);
                    const y = prev.getFullYear(), m = String(prev.getMonth()+1).padStart(2,'0');
                    const last = new Date(y, prev.getMonth()+1, 0).getDate();
                    setPdfDateFrom(`${y}-${m}-01`); setPdfDateTo(`${y}-${m}-${String(last).padStart(2,'0')}`);
                  }},
                  { label: '최근 3개월', action: () => {
                    const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
                    const end = new Date(), start = new Date(); start.setMonth(start.getMonth()-3);
                    setPdfDateFrom(fmt(start)); setPdfDateTo(fmt(end));
                  }},
                  { label: '전체 기간', action: () => { setPdfDateFrom(''); setPdfDateTo(''); }},
                ].map((btn) => (
                  <button key={btn.label} onClick={btn.action}
                    className="px-3 py-1.5 bg-yellow-50 border border-yellow-300 text-yellow-800 rounded-full text-xs font-semibold hover:bg-yellow-100">
                    {btn.label}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">시작일</label>
                  <input type="date" value={pdfDateFrom} onChange={(e) => setPdfDateFrom(e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">종료일</label>
                  <input type="date" value={pdfDateTo} onChange={(e) => setPdfDateTo(e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400" />
                </div>
              </div>

              {/* 상태 필터 */}
              <p className="text-xs font-semibold text-gray-500 mb-2">상태 필터</p>
              <div className="flex flex-wrap gap-2 mb-4">
                {(['전체', '신청중', '자재분출', '자재교체'] as const).map((s) => (
                  <button key={s} onClick={() => setPdfStatusFilter(s)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                      pdfStatusFilter === s
                        ? 'bg-yellow-400 text-white border-yellow-400'
                        : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                    }`}>
                    {s === '자재교체' ? '교체완료' : s}
                  </button>
                ))}
              </div>

              {/* 현장 선택 */}
              <p className="text-xs font-semibold text-gray-500 mb-2">현장 선택 (선택 안 하면 전체)</p>
              <select
                value={pdfSiteId}
                onChange={(e) => {
                  const id = e.target.value;
                  setPdfSiteId(id);
                  setPdfSiteName(sites.find((s) => s.id === id)?.siteName || '');
                }}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-yellow-400"
              >
                <option value="">전체 현장</option>
                {sites.map((s) => <option key={s.id} value={s.id}>{s.siteName}</option>)}
              </select>

              {/* 미리보기 건수 */}
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-3 mb-4 text-sm text-yellow-800">
                출력 대상: <strong>{pdfFiltered.length}건</strong>
              </div>

              <button
                onClick={exportPDF}
                className="w-full py-3 bg-yellow-400 text-white rounded-xl font-bold hover:bg-yellow-500"
              >
                📄 PDF 출력
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
