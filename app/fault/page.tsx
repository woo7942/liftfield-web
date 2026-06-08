'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  collection, onSnapshot, orderBy, query,
  where, addDoc, updateDoc, deleteDoc,
  doc, serverTimestamp, getDocs
} from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, db } from '@/lib/firebase';

// ── 타입 ──────────────────────────────────────────────────────────────
interface FaultReport {
  id: string;
  siteId: string;
  siteName: string;
  hogiNo: string;
  content: string;
  reporterPhone: string;
  extra: string;
  assignedTo: string;
  assignedName: string;
  team: string;
  companyId: string;
  status: '접수' | '처리중' | '완료';
  createdAt: any;
  callbackContent: string;
  callbackResult: string;
  completedAt: any;
}

// ── 날짜 헬퍼 ─────────────────────────────────────────────────────────
const toDateStr = (v: any): string => {
  if (!v) return '-';
  if (typeof v === 'string') return v;
  if (v?.seconds) {
    const d = new Date(v.seconds * 1000);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}. ${pad(d.getMonth()+1)}. ${pad(d.getDate())}. ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  return '-';
};

const toDateObj = (v: any): Date => {
  if (!v) return new Date();
  if (v?.seconds) return new Date(v.seconds * 1000);
  if (typeof v === 'string') return new Date(v);
  return new Date();
};

const formatKoDate = (d: Date) =>
  `${d.getFullYear()}년 ${d.getMonth()+1}월 ${d.getDate()}일`;

const formatShort = (v: any): string => {
  if (!v) return '-';
  const d = toDateObj(v);
  const pad = (n: number) => String(n).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(2);
  return `${yy}.${pad(d.getMonth()+1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

// ── PDF 생성 헬퍼 ─────────────────────────────────────────────────────
const printHtml = (html: string) => {
  const win = window.open('', '_blank');
  if (!win) return;
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => { win.print(); }, 500);
};

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────
export default function FaultPage() {
  const router = useRouter();
  const [userInfo, setUserInfo] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [faults, setFaults] = useState<FaultReport[]>([]);
  const [sites, setSites] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [search, setSearch] = useState('');

  // 모달 상태
  const [reportModal, setReportModal] = useState(false);
  const [detailModal, setDetailModal] = useState(false);
  const [selectedFault, setSelectedFault] = useState<FaultReport | null>(null);

  // 폼 상태
  const [siteSearch, setSiteSearch] = useState('');
  const [form, setForm] = useState({
    siteId: '', siteName: '', hogiNo: '',
    content: '', reporterPhone: '', extra: '',
    assignedTo: '', assignedName: '',
  });
  const [callbackContent, setCallbackContent] = useState('');
  const [callbackResult, setCallbackResult] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // ── 인증 확인 ──
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) { router.push('/login'); return; }
      const { doc, getDoc } = await import('firebase/firestore');
      const snap = await getDoc(doc(db, 'users', user.uid));
      if (!snap.exists()) { router.push('/login'); return; }
      const data = snap.data();
      if (data.role !== 'admin' && !data.superAdmin) { router.push('/login'); return; }
      setUserInfo({ uid: user.uid, ...data });
    });
    return () => unsub();
  }, []);

  // ── 데이터 구독 ──
  useEffect(() => {
    if (!userInfo) return;
    const cid = userInfo.companyId || '';
    const useNew = !!(userInfo.useNewStructure && cid);
    const unsubs: (() => void)[] = [];

    // 고장신고
    const faultCol = useNew
      ? collection(db, 'companies', cid, 'faultReports')
      : collection(db, 'faultReports');
    const faultQ = useNew
      ? query(faultCol, orderBy('createdAt', 'desc'))
      : query(faultCol, where('companyId', '==', cid), orderBy('createdAt', 'desc'));
    unsubs.push(onSnapshot(faultQ, snap => {
      setFaults(snap.docs.map(d => ({ id: d.id, ...d.data() } as FaultReport)));
      setLoading(false);
    }));

    // 현장
    const siteCol = useNew
      ? collection(db, 'companies', cid, 'sites')
      : collection(db, 'sites');
    const siteQ = useNew
      ? query(siteCol, orderBy('siteName'))
      : query(siteCol, where('companyId', '==', cid), orderBy('siteName'));
    unsubs.push(onSnapshot(siteQ, snap => setSites(snap.docs.map(d => ({ id: d.id, ...d.data() })))));

    // 사용자
    const userQ = query(collection(db, 'users'), where('companyId', '==', cid), where('status', '==', 'approved'));
    unsubs.push(onSnapshot(userQ, snap => setUsers(snap.docs.map(d => ({ id: d.id, ...d.data() })))));

    return () => unsubs.forEach(u => u());
  }, [userInfo]);

  // ── 고장신고 접수 ──
  const submitReport = async () => {
    if (isSubmitting) return;
    if (!form.siteId) return alert('현장을 선택하세요');
    if (!form.hogiNo.trim()) return alert('호기를 입력하세요');
    if (!form.content.trim()) return alert('고장 내용을 입력하세요');
    if (!form.assignedTo) return alert('담당자를 선택하세요');

    setIsSubmitting(true);
    try {
      const cid = userInfo.companyId || '';
      const useNew = !!(userInfo.useNewStructure && cid);
      const faultCol = useNew
        ? collection(db, 'companies', cid, 'faultReports')
        : collection(db, 'faultReports');

      await addDoc(faultCol, {
        ...form,
        team: userInfo.team || '',
        companyId: cid,
        status: '접수',
        createdAt: serverTimestamp(),
        callbackContent: '',
        callbackResult: '',
        completedAt: null,
      });

      setReportModal(false);
      setForm({ siteId: '', siteName: '', hogiNo: '', content: '', reporterPhone: '', extra: '', assignedTo: '', assignedName: '' });
      setSiteSearch('');
      alert('고장신고가 접수되었습니다!');
    } catch (e: any) {
      alert('오류: ' + e.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── 콜백 보고 ──
  const submitCallback = async () => {
    if (!selectedFault) return;
    if (!callbackContent.trim()) return alert('콜백 내용을 입력하세요');
    if (!callbackResult.trim()) return alert('처리 결과를 입력하세요');

    const cid = userInfo.companyId || '';
    const useNew = !!(userInfo.useNewStructure && cid);
    const faultRef = useNew
      ? doc(db, 'companies', cid, 'faultReports', selectedFault.id)
      : doc(db, 'faultReports', selectedFault.id);

    try {
      await updateDoc(faultRef, {
        callbackContent, callbackResult,
        status: '완료', completedAt: serverTimestamp(),
      });
      setDetailModal(false);
      setCallbackContent(''); setCallbackResult('');
      alert('처리완료 보고가 저장되었습니다!');
    } catch (e: any) {
      alert('오류: ' + e.message);
    }
  };

  // ── 삭제 ──
  const deleteFault = async (fault: FaultReport) => {
    if (!confirm(`정말 삭제하시겠습니까?\n현장: ${fault.siteName}\n호기: ${fault.hogiNo}`)) return;
    const cid = userInfo.companyId || '';
    const useNew = !!(userInfo.useNewStructure && cid);
    const faultRef = useNew
      ? doc(db, 'companies', cid, 'faultReports', fault.id)
      : doc(db, 'faultReports', fault.id);
    try {
      await deleteDoc(faultRef);
      setDetailModal(false);
      alert('삭제되었습니다.');
    } catch (e: any) {
      alert('오류: ' + e.message);
    }
  };

  // ── PDF: 단건 신고서 ──
  const exportSinglePDF = (fault: FaultReport) => {
    const reportDate = toDateObj(fault.createdAt);
    const completedDate = fault.completedAt ? toDateObj(fault.completedAt) : null;
    const dateStr = formatKoDate(reportDate);
    const todayStr = formatKoDate(new Date());
    const docNo = `LF-${reportDate.getFullYear()}${String(reportDate.getMonth()+1).padStart(2,'0')}${String(reportDate.getDate()).padStart(2,'0')}-${fault.id.slice(-4).toUpperCase()}`;
    const site = sites.find(s => s.id === fault.siteId);

    const html = `<!DOCTYPE html>
<html lang="ko"><head><meta charset="utf-8"/>
<style>
  @page { size: A4; margin: 25mm 20mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Malgun Gothic','Apple SD Gothic Neo','Noto Sans KR',sans-serif; color:#111; font-size:11pt; line-height:1.6; padding:20px; margin:0; }
  .header { text-align:center; border-bottom:3px double #111; padding-bottom:16px; margin-bottom:24px; }
  .company { font-size:12pt; color:#555; letter-spacing:4px; margin-bottom:6px; }
  .title { font-size:26pt; font-weight:bold; letter-spacing:12px; margin:8px 0; }
  .doc-info { display:flex; justify-content:space-between; font-size:10pt; color:#444; margin-bottom:20px; }
  table.main { width:100%; border-collapse:collapse; margin-bottom:18px; table-layout:fixed; }
  table.main th, table.main td { border:1px solid #333; padding:10px 12px; vertical-align:middle; font-size:11pt; word-break:keep-all; }
  table.main th { background:#f3f4f6; text-align:center; font-weight:600; width:18%; }
  table.main td { text-align:center; width:32%; }
  table.main td.left { text-align:left; }
  .section-title { font-size:13pt; font-weight:bold; border-left:5px solid #111; padding-left:10px; margin:18px 0 10px; }
  .content-box { border:1px solid #333; padding:14px 16px; min-height:80px; white-space:pre-wrap; margin-bottom:18px; text-align:left; }
  .badge { display:inline-block; padding:3px 12px; border-radius:4px; font-weight:bold; font-size:10pt; color:#fff;
    background:${fault.status==='완료'?'#16a34a':fault.status==='처리중'?'#ea580c':'#dc2626'}; }
  .signature { margin-top:50px; text-align:right; }
  .signature .date { font-size:12pt; margin-bottom:24px; }
  .signature .org { font-size:16pt; font-weight:bold; letter-spacing:6px; }
  .footer { margin-top:40px; border-top:1px solid #999; padding-top:10px; font-size:9pt; color:#666; text-align:center; }
</style></head><body>
  <div class="header">
    <div class="company">L I F T &nbsp; F I E L D</div>
    <div class="title">고 장 신 고 서</div>
  </div>
  <div class="doc-info">
    <div>문서번호: <strong>${docNo}</strong></div>
    <div>출력일자: <strong>${todayStr}</strong></div>
  </div>
  <table class="main">
    <tr><th>현장명</th><td class="left">${fault.siteName||'-'}</td><th>호기</th><td>${fault.hogiNo||'-'}</td></tr>
    <tr><th>주소</th><td class="left" colspan="3">${site?.address||'-'}</td></tr>
    <tr><th>신고자</th><td>${fault.reporterPhone||'-'}</td><th>담당자</th><td>${fault.assignedName||'-'}</td></tr>
    <tr><th>신고일시</th><td>${toDateStr(fault.createdAt)}</td><th>처리상태</th><td><span class="badge">${fault.status}</span></td></tr>
    ${completedDate?`<tr><th>완료일시</th><td colspan="3">${toDateStr(fault.completedAt)}</td></tr>`:''}
  </table>
  <div class="section-title">1. 고장 내용</div>
  <div class="content-box">${(fault.content||'내용 없음').replace(/\n/g,'<br/>')}</div>
  ${fault.extra?`<div class="section-title">2. 추가 사항</div><div class="content-box">${fault.extra.replace(/\n/g,'<br/>')}</div>`:''}
  <div class="section-title">${fault.extra?'3':'2'}. 콜백 내용</div>
  <div class="content-box">${fault.callbackContent?fault.callbackContent.replace(/\n/g,'<br/>'):'<span style="color:#999">미입력</span>'}</div>
  <div class="section-title">${fault.extra?'4':'3'}. 처리 결과</div>
  <div class="content-box">${fault.callbackResult?fault.callbackResult.replace(/\n/g,'<br/>'):'<span style="color:#999">미입력</span>'}</div>
  <div class="signature"><div class="date">${dateStr}</div><div class="org">리 프 트 필 드</div></div>
  <div class="footer">본 문서는 LiftField 시스템에서 자동 생성된 공식 문서입니다. (Doc No. ${docNo})</div>
</body></html>`;

    printHtml(html);
  };

  // ── PDF: 처리내역서 ──
  const exportListPDF = (siteId?: string) => {
    const targetFaults = siteId
      ? faults.filter(f => f.siteId === siteId && f.status === '완료')
      : faults.filter(f => f.status === '완료');

    if (targetFaults.length === 0) return alert('완료된 고장신고가 없습니다');

    const siteName = siteId ? sites.find(s => s.id === siteId)?.siteName || '' : '전체 현장';
    const todayStr = formatKoDate(new Date());
    const now = new Date();
    const docNo = `LF-LIST-${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}`;

    const rows = targetFaults.map((f, idx) => `
      <tr>
        <td class="c">${idx+1}</td>
        <td class="c nowrap">${formatShort(f.createdAt)}</td>
        <td class="l">${f.siteName||'-'}</td>
        <td class="c">${f.hogiNo||'-'}</td>
        <td class="l">${(f.content||'-').replace(/\n/g,'<br/>')}</td>
        <td class="l">${(f.callbackContent||'-').replace(/\n/g,'<br/>')}</td>
        <td class="l">${(f.callbackResult||'-').replace(/\n/g,'<br/>')}</td>
        <td class="c">${f.assignedName||'-'}</td>
        <td class="c nowrap">${formatShort(f.completedAt)}</td>
      </tr>`).join('');

    const html = `<!DOCTYPE html>
<html lang="ko"><head><meta charset="utf-8"/>
<style>
  @page { size: A4 landscape; margin: 15mm 12mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Malgun Gothic','Apple SD Gothic Neo','Noto Sans KR',sans-serif; color:#111; font-size:10pt; line-height:1.5; padding:16px; margin:0; }
  .header { text-align:center; border-bottom:3px double #111; padding-bottom:14px; margin-bottom:16px; }
  .company { font-size:11pt; color:#555; letter-spacing:4px; margin-bottom:4px; }
  .title { font-size:22pt; font-weight:bold; letter-spacing:8px; margin:6px 0; }
  .doc-info { display:flex; justify-content:space-between; font-size:9.5pt; color:#444; margin-bottom:10px; }
  .summary { margin-bottom:10px; font-size:10pt; }
  table { width:100%; border-collapse:collapse; table-layout:fixed; }
  th, td { border:1px solid #333; padding:6px 4px; vertical-align:middle; font-size:9pt; word-break:keep-all; }
  th { background:#1f2937; color:#fff; text-align:center; font-weight:600; }
  td.c { text-align:center; } td.l { text-align:left; vertical-align:top; }
  td.nowrap { white-space:nowrap; font-size:8.5pt; }
  .signature { margin-top:24px; text-align:right; }
  .signature .date { font-size:11pt; margin-bottom:18px; }
  .signature .org { font-size:14pt; font-weight:bold; letter-spacing:5px; }
  .footer { margin-top:20px; border-top:1px solid #999; padding-top:8px; font-size:8.5pt; color:#666; text-align:center; }
</style></head><body>
  <div class="header">
    <div class="company">L I F T &nbsp; F I E L D</div>
    <div class="title">고 장 처 리 내 역 서</div>
  </div>
  <div class="doc-info"><div>문서번호: <strong>${docNo}</strong></div><div>출력일자: <strong>${todayStr}</strong></div></div>
  <div class="summary"><strong>대상 현장:</strong> ${siteName} &nbsp;|&nbsp; <strong>총 처리건수:</strong> ${targetFaults.length}건</div>
  <table>
    <colgroup>
      <col style="width:4%"/><col style="width:13%"/><col style="width:12%"/>
      <col style="width:5%"/><col style="width:16%"/><col style="width:15%"/>
      <col style="width:15%"/><col style="width:7%"/><col style="width:13%"/>
    </colgroup>
    <thead><tr>
      <th>No.</th><th>신고일시</th><th>현장</th><th>호기</th>
      <th>고장내용</th><th>콜백내용</th><th>처리결과</th><th>담당자</th><th>완료일시</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="signature"><div class="date">${todayStr}</div><div class="org">리 프 트 필 드</div></div>
  <div class="footer">본 문서는 LiftField 시스템에서 자동 생성된 공식 문서입니다. (Doc No. ${docNo})</div>
</body></html>`;

    printHtml(html);
  };

  // ── 필터 ──
  const filteredFaults = faults.filter(f =>
    f.siteName?.includes(search) || f.hogiNo?.includes(search) ||
    f.assignedName?.includes(search) || f.content?.includes(search)
  );

  const filteredSites = siteSearch.trim()
    ? sites.filter(s =>
        s.siteName?.toLowerCase().includes(siteSearch.toLowerCase()) ||
        s.address?.toLowerCase().includes(siteSearch.toLowerCase()))
    : sites;

  const selectedSite = sites.find(s => s.id === form.siteId);
  const teamUsers = selectedSite
    ? users.filter(u => u.team === selectedSite.team)
    : [];

  const statusColor: Record<string, string> = {
    '접수': 'bg-red-100 text-red-600',
    '처리중': 'bg-yellow-100 text-yellow-700',
    '완료': 'bg-green-100 text-green-700',
  };

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-gray-500">로딩 중...</div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 헤더 */}
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push('/dashboard')} className="text-gray-500 hover:text-gray-900 mr-2">← 뒤로</button>
          <span className="text-xl">🔧</span>
          <h1 className="text-xl font-bold text-gray-900">고장신고 관리</h1>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => exportListPDF()}
            className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2 rounded-xl transition-colors"
          >
            📋 처리내역서 PDF
          </button>
          <button
            onClick={() => setReportModal(true)}
            className="bg-red-500 hover:bg-red-600 text-white text-sm font-semibold px-4 py-2 rounded-xl transition-colors"
          >
            🚨 고장접수
          </button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6">
        {/* 검색 */}
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="현장명, 호기, 담당자, 내용 검색..."
          className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm text-gray-900 mb-4 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />

        {/* 통계 */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          {[
            { label: '전체', count: faults.length, color: 'bg-gray-100 text-gray-700' },
            { label: '처리중', count: faults.filter(f => f.status !== '완료').length, color: 'bg-yellow-100 text-yellow-700' },
            { label: '완료', count: faults.filter(f => f.status === '완료').length, color: 'bg-green-100 text-green-700' },
          ].map(s => (
            <div key={s.label} className={`${s.color} rounded-xl p-4 text-center`}>
              <div className="text-2xl font-bold">{s.count}</div>
              <div className="text-sm font-medium mt-1">{s.label}</div>
            </div>
          ))}
        </div>

        {/* 목록 */}
        {filteredFaults.length === 0 ? (
          <div className="text-center text-gray-400 py-20">고장신고 내역이 없습니다</div>
        ) : (
          <div className="space-y-3">
            {filteredFaults.map(fault => (
              <div
                key={fault.id}
                className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 cursor-pointer hover:shadow-md transition-shadow"
                onClick={() => {
                  setSelectedFault(fault);
                  setCallbackContent(fault.callbackContent || '');
                  setCallbackResult(fault.callbackResult || '');
                  setDetailModal(true);
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="font-bold text-gray-900">{fault.siteName}</span>
                      <span className="text-gray-500 text-sm">{fault.hogiNo}</span>
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${statusColor[fault.status] || 'bg-gray-100 text-gray-600'}`}>
                        {fault.status}
                      </span>
                    </div>
                    <p className="text-sm text-gray-600 truncate">{fault.content}</p>
                    <p className="text-xs text-gray-400 mt-1">담당: {fault.assignedName} · {toDateStr(fault.createdAt)}</p>
                  </div>
                  <button
                    onClick={e => { e.stopPropagation(); exportSinglePDF(fault); }}
                    className="bg-blue-50 hover:bg-blue-100 text-blue-600 text-xs font-semibold px-3 py-2 rounded-lg transition-colors whitespace-nowrap"
                  >
                    📄 신고서
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* ── 고장접수 모달 ── */}
      {reportModal && (
        <div className="fixed inset-0 bg-black/50 flex items-end justify-center z-50">
          <div className="bg-white rounded-t-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-4">🚨 고장접수</h2>

            {/* 현장 선택 */}
            <label className="block text-sm font-semibold text-gray-700 mb-1">현장 선택 *</label>
            {form.siteId ? (
              <div className="flex items-center justify-between bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 mb-3">
                <div>
                  <p className="font-semibold text-blue-700">📍 {form.siteName}</p>
                  <p className="text-xs text-gray-500">{sites.find(s => s.id === form.siteId)?.address || ''}</p>
                </div>
                <button
                  onClick={() => { setForm(p => ({ ...p, siteId: '', siteName: '', hogiNo: '', assignedTo: '', assignedName: '' })); setSiteSearch(''); }}
                  className="text-xs bg-blue-600 text-white px-3 py-1.5 rounded-lg"
                >변경</button>
              </div>
            ) : (
              <>
                <input
                  type="text"
                  value={siteSearch}
                  onChange={e => setSiteSearch(e.target.value)}
                  placeholder="현장명 검색..."
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-900 mb-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <div className="space-y-1 mb-3 max-h-40 overflow-y-auto">
                  {filteredSites.slice(0, 5).map(s => (
                    <button
                      key={s.id}
                      onClick={() => { setForm(p => ({ ...p, siteId: s.id, siteName: s.siteName })); setSiteSearch(''); }}
                      className="w-full text-left px-3 py-2.5 bg-gray-50 hover:bg-blue-50 rounded-lg border border-gray-100 transition-colors"
                    >
                      <p className="text-sm font-semibold text-gray-900">{s.siteName}</p>
                      {s.address && <p className="text-xs text-gray-500">{s.address}</p>}
                    </button>
                  ))}
                </div>
              </>
            )}

            {/* 호기 */}
            {form.siteId && (
              <>
                <label className="block text-sm font-semibold text-gray-700 mb-1">호기 *</label>
                <input
                  type="text"
                  value={form.hogiNo}
                  onChange={e => setForm(p => ({ ...p, hogiNo: e.target.value }))}
                  placeholder="예: 1호기, 2호기"
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-900 mb-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </>
            )}

            {/* 고장 내용 */}
            <label className="block text-sm font-semibold text-gray-700 mb-1">고장 내용 *</label>
            <textarea
              value={form.content}
              onChange={e => setForm(p => ({ ...p, content: e.target.value }))}
              placeholder="고장 내용을 입력하세요"
              rows={3}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-900 mb-3 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />

            {/* 신고자 전화 */}
            <label className="block text-sm font-semibold text-gray-700 mb-1">신고자 전화번호</label>
            <input
              type="tel"
              value={form.reporterPhone}
              onChange={e => setForm(p => ({ ...p, reporterPhone: e.target.value }))}
              placeholder="010-0000-0000"
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-900 mb-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />

            {/* 추가사항 */}
            <label className="block text-sm font-semibold text-gray-700 mb-1">추가사항</label>
            <textarea
              value={form.extra}
              onChange={e => setForm(p => ({ ...p, extra: e.target.value }))}
              placeholder="추가사항 입력"
              rows={2}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-900 mb-3 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />

            {/* 담당자 */}
            <label className="block text-sm font-semibold text-gray-700 mb-1">담당자 선택 *</label>
            {!form.siteId ? (
              <p className="text-xs text-gray-400 mb-3">먼저 현장을 선택해주세요</p>
            ) : teamUsers.length === 0 ? (
              <p className="text-xs text-gray-400 mb-3">{selectedSite?.team || '미지정'} 팀에 소속된 사용자가 없습니다</p>
            ) : (
              <div className="flex flex-wrap gap-2 mb-3">
                {teamUsers.map(u => (
                  <button
                    key={u.id}
                    onClick={() => setForm(p => ({ ...p, assignedTo: u.id, assignedName: u.name }))}
                    className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                      form.assignedTo === u.id
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-gray-100 text-gray-700 border-gray-200 hover:bg-gray-200'
                    }`}
                  >
                    {u.name}
                  </button>
                ))}
              </div>
            )}

            {/* 버튼 */}
            <div className="flex gap-2 mt-2">
              <button
                onClick={() => { setReportModal(false); setSiteSearch(''); }}
                className="flex-1 py-3 bg-gray-100 text-gray-700 font-semibold rounded-xl"
              >취소</button>
              <button
                onClick={submitReport}
                disabled={isSubmitting}
                className="flex-2 flex-1 py-3 bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white font-semibold rounded-xl transition-colors"
              >{isSubmitting ? '접수 중...' : '접수'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── 상세 모달 ── */}
      {detailModal && selectedFault && (
        <div className="fixed inset-0 bg-black/50 flex items-end justify-center z-50">
          <div className="bg-white rounded-t-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-gray-900">🔧 고장신고 상세</h2>
              <button onClick={() => setDetailModal(false)} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">×</button>
            </div>

            {/* 상세 정보 */}
            <div className="space-y-2 border border-gray-100 rounded-xl p-4 mb-4 bg-gray-50">
              {[
                { label: '현장', value: selectedFault.siteName },
                { label: '호기', value: selectedFault.hogiNo },
                { label: '고장내용', value: selectedFault.content },
                { label: '신고자', value: selectedFault.reporterPhone || '-' },
                ...(selectedFault.extra ? [{ label: '추가사항', value: selectedFault.extra }] : []),
                { label: '담당자', value: selectedFault.assignedName },
                { label: '신고시간', value: toDateStr(selectedFault.createdAt) },
                { label: '상태', value: selectedFault.status },
              ].map(row => (
                <div key={row.label} className="flex gap-3">
                  <span className="text-sm text-gray-500 w-16 shrink-0">{row.label}</span>
                  <span className="text-sm text-gray-900 flex-1">{row.value}</span>
                </div>
              ))}
            </div>

            {/* 콜백 보고 */}
            {selectedFault.status !== '완료' ? (
              <div className="mb-4">
                <h3 className="font-bold text-gray-800 mb-3">📞 콜백 보고</h3>
                <textarea
                  value={callbackContent}
                  onChange={e => setCallbackContent(e.target.value)}
                  placeholder="콜백 내용 입력"
                  rows={3}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-900 mb-2 focus:outline-none focus:ring-2 focus:ring-green-500 resize-none"
                />
                <textarea
                  value={callbackResult}
                  onChange={e => setCallbackResult(e.target.value)}
                  placeholder="처리 결과 입력"
                  rows={3}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-900 mb-2 focus:outline-none focus:ring-2 focus:ring-green-500 resize-none"
                />
                <button
                  onClick={submitCallback}
                  className="w-full py-3 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-xl transition-colors"
                >✅ 처리완료 보고</button>
              </div>
            ) : (
              <div className="mb-4 bg-green-50 border border-green-200 rounded-xl p-4 space-y-2">
                <h3 className="font-bold text-green-800">✅ 처리완료</h3>
                <div className="flex gap-3"><span className="text-sm text-gray-500 w-16">콜백내용</span><span className="text-sm text-gray-900">{selectedFault.callbackContent}</span></div>
                <div className="flex gap-3"><span className="text-sm text-gray-500 w-16">처리결과</span><span className="text-sm text-gray-900">{selectedFault.callbackResult}</span></div>
                <div className="flex gap-3"><span className="text-sm text-gray-500 w-16">완료시간</span><span className="text-sm text-gray-900">{toDateStr(selectedFault.completedAt)}</span></div>
              </div>
            )}

            {/* PDF 버튼 */}
            <div className="space-y-2">
              <button
                onClick={() => exportSinglePDF(selectedFault)}
                className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition-colors"
              >📄 신고서 출력 (공문)</button>
              {selectedFault.status === '완료' && (
                <button
                  onClick={() => exportListPDF(selectedFault.siteId)}
                  className="w-full py-3 bg-cyan-600 hover:bg-cyan-700 text-white font-semibold rounded-xl transition-colors"
                >📋 이 현장 처리내역서 출력</button>
              )}
              <button
                onClick={() => deleteFault(selectedFault)}
                className="w-full py-3 bg-red-500 hover:bg-red-600 text-white font-semibold rounded-xl transition-colors"
              >🗑 삭제</button>
              <button
                onClick={() => setDetailModal(false)}
                className="w-full py-3 bg-gray-100 text-gray-700 font-semibold rounded-xl"
              >닫기</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
