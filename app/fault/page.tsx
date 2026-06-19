'use client';

import { onAuthStateChanged } from 'firebase/auth';
import {
  addDoc, collection, deleteDoc,
  doc, getDoc, onSnapshot, orderBy,
  query, serverTimestamp, updateDoc, where
} from 'firebase/firestore';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { auth, db } from '@/lib/firebase';

// ── 타입 ──────────────────────────────────────────────────
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
  status: '접수대기' | '접수' | '처리중' | '완료';
  createdAt: any;
  receivedAt: any;
  arrivedAt: any;
  completedAt: any;
  faultCause: string;
  faultAction: string;
  faultNote: string;
}

// ── 날짜 유틸 ─────────────────────────────────────────────
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

const toDatetimeLocal = (v: any): string => {
  if (!v) return '';
  const d = toDateObj(v);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const parseDatetimeInput = (s: string): Date | null => {
  if (!s.trim()) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
};

// ── 상태 스타일 ───────────────────────────────────────────
const STATUS_STYLE: Record<string, string> = {
  '접수대기': 'bg-yellow-100 text-yellow-700',
  '접수':     'bg-red-100 text-red-600',
  '처리중':   'bg-orange-100 text-orange-600',
  '완료':     'bg-green-100 text-green-700',
};

// ── PDF 출력 ──────────────────────────────────────────────
const printHtml = (html: string) => {
  const win = window.open('', '_blank');
  if (!win) return;
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 500);
};

// ── 팀 필터 탭 ────────────────────────────────────────────
const ALL_TEAMS = '전체';

export default function FaultPage() {
  const router = useRouter();
  const [userInfo, setUserInfo] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [faults, setFaults] = useState<FaultReport[]>([]);
  const [sites, setSites] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [teams, setTeams] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [teamFilter, setTeamFilter] = useState(ALL_TEAMS);
  const [statusFilter, setStatusFilter] = useState('전체');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 모달
  const [reportModal, setReportModal] = useState(false);
  const [detailModal, setDetailModal] = useState(false);
  const [selectedFault, setSelectedFault] = useState<FaultReport | null>(null);
  const [pdfModal, setPdfModal] = useState(false);
  const [pdfSiteSearch, setPdfSiteSearch] = useState('');

  // 신고 폼
  const [siteSearch, setSiteSearch] = useState('');
  const [form, setForm] = useState({
    siteId: '', siteName: '', hogiNo: '',
    content: '', reporterPhone: '', extra: '',
    assignedTo: '', assignedName: '',
  });

  // 처리 폼
  const [faultCause, setFaultCause] = useState('');
  const [faultAction, setFaultAction] = useState('');
  const [faultNote, setFaultNote] = useState('');
  const [arrivedAtInput, setArrivedAtInput] = useState('');
  const [completedAtInput, setCompletedAtInput] = useState('');

  // ── 인증 ──────────────────────────────────────────────
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) { router.push('/login'); return; }
      const snap = await getDoc(doc(db, 'users', user.uid));
      if (!snap.exists()) { router.push('/login'); return; }
      const data = snap.data();
      const plan = data.subscription?.plan;
      const status = data.subscription?.status;
      const isCompany = plan === 'company' && status === 'active';
      const isPro = plan === 'pro' && status === 'active';
      if (!data.superAdmin && data.role !== 'admin' && data.role !== 'member' && !isPro && !isCompany) {
        router.push('/login'); return;
      }
      setUserInfo({ uid: user.uid, ...data });
    });
    return () => unsub();
  }, []);

  // ── 데이터 구독 ────────────────────────────────────────
  useEffect(() => {
    if (!userInfo) return;
    const cid = userInfo.companyId || '';
    const useNew = !!(userInfo.useNewStructure && cid);
    const unsubs: (() => void)[] = [];

    // faultReports
    const faultCol = useNew
      ? collection(db, 'companies', cid, 'faultReports')
      : collection(db, 'faultReports');
    const faultQ = useNew
      ? query(faultCol, orderBy('createdAt', 'desc'))
      : query(faultCol, where('companyId', '==', cid), orderBy('createdAt', 'desc'));
    unsubs.push(onSnapshot(faultQ, snap => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() } as FaultReport));
      setFaults(data);
      // 팀 목록 자동 추출
      const teamSet = new Set(data.map(f => f.team).filter(Boolean));
      setTeams([ALL_TEAMS, ...Array.from(teamSet)]);
      setLoading(false);
    }));

    // sites
    const siteCol = useNew
      ? collection(db, 'companies', cid, 'sites')
      : collection(db, 'sites');
    const siteQ = useNew
      ? query(siteCol, orderBy('siteName'))
      : query(siteCol, where('companyId', '==', cid), orderBy('siteName'));
    unsubs.push(onSnapshot(siteQ, snap =>
      setSites(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    ));

    // users
    const userQ = query(
      collection(db, 'users'),
      where('companyId', '==', cid),
      where('status', '==', 'approved')
    );
    unsubs.push(onSnapshot(userQ, snap =>
      setUsers(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    ));

    return () => unsubs.forEach(u => u());
  }, [userInfo]);

  // ── Firestore 경로 헬퍼 ────────────────────────────────
  const getFaultCol = () => {
    const cid = userInfo?.companyId || '';
    const useNew = !!(userInfo?.useNewStructure && cid);
    return useNew
      ? collection(db, 'companies', cid, 'faultReports')
      : collection(db, 'faultReports');
  };

  const getFaultDoc = (id: string) => {
    const cid = userInfo?.companyId || '';
    const useNew = !!(userInfo?.useNewStructure && cid);
    return useNew
      ? doc(db, 'companies', cid, 'faultReports', id)
      : doc(db, 'faultReports', id);
  };

  // ── 고장 신고 접수 ──────────────────────────────────────
  const submitReport = async () => {
    if (isSubmitting) return;
    if (!form.siteId)         return alert('현장을 선택하세요');
    if (!form.hogiNo.trim())  return alert('호기를 입력하세요');
    if (!form.content.trim()) return alert('고장 내용을 입력하세요');
    if (!form.assignedTo)     return alert('담당자를 선택하세요');

    setIsSubmitting(true);
    try {
      await addDoc(getFaultCol(), {
        ...form,
        team: userInfo?.team || '',
        companyId: userInfo?.companyId || '',
        status: '접수대기',
        createdAt: serverTimestamp(),
        receivedAt: null,
        arrivedAt: null,
        completedAt: null,
        faultCause: '',
        faultAction: '',
        faultNote: '',
      });
      setReportModal(false);
      resetForm();
      alert('고장신고가 접수되었습니다!');
    } catch (e: any) {
      alert('오류: ' + e.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── 접수 처리 (접수대기 → 접수) ────────────────────────
  const handleReceive = async (fault: FaultReport) => {
    if (!confirm(`${fault.siteName} ${fault.hogiNo} 고장을 접수 처리하시겠어요?\n\n담당자: ${userInfo?.name || ''}`)) return;
    try {
      await updateDoc(getFaultDoc(fault.id), {
        status: '접수',
        receivedAt: serverTimestamp(),
        assignedTo: userInfo?.uid || '',
        assignedName: userInfo?.name || '',
      });
    } catch (e: any) {
      alert('오류: ' + e.message);
    }
  };

  // ── 처리중 변경 ─────────────────────────────────────────
  const handleSetInProgress = async (fault: FaultReport) => {
    try {
      await updateDoc(getFaultDoc(fault.id), { status: '처리중' });
    } catch (e: any) {
      alert('오류: ' + e.message);
    }
  };

  // ── 처리 완료 저장 ──────────────────────────────────────
  const submitComplete = async () => {
    if (!selectedFault) return;
    if (!faultAction.trim()) return alert('처리 내용을 입력하세요');

    const arrivedDate = parseDatetimeInput(arrivedAtInput);
    const completedDate = parseDatetimeInput(completedAtInput);

    try {
      await updateDoc(getFaultDoc(selectedFault.id), {
        faultCause,
        faultAction,
        faultNote,
        arrivedAt:   arrivedDate   ? arrivedDate   : serverTimestamp(),
        completedAt: completedDate ? completedDate : serverTimestamp(),
        status: '완료',
      });
      setDetailModal(false);
      resetDetailFields();
      alert('처리 완료가 저장되었습니다!');
    } catch (e: any) {
      alert('오류: ' + e.message);
    }
  };

  // ── 삭제 ───────────────────────────────────────────────
  const deleteFault = async (fault: FaultReport, closeModal = false) => {
    if (!confirm(`정말 삭제하시겠습니까?\n현장: ${fault.siteName}\n호기: ${fault.hogiNo}`)) return;
    try {
      await deleteDoc(getFaultDoc(fault.id));
      if (closeModal) setDetailModal(false);
      alert('삭제되었습니다.');
    } catch (e: any) {
      alert('오류: ' + e.message);
    }
  };

  // ── 상세 모달 열기 ──────────────────────────────────────
  const openDetail = (fault: FaultReport) => {
    setSelectedFault(fault);
    setFaultCause(fault.faultCause || '');
    setFaultAction(fault.faultAction || '');
    setFaultNote(fault.faultNote || '');
    setArrivedAtInput(fault.arrivedAt ? toDatetimeLocal(fault.arrivedAt) : '');
    setCompletedAtInput(fault.completedAt ? toDatetimeLocal(fault.completedAt) : '');
    setDetailModal(true);
  };

  const resetForm = () => {
    setForm({ siteId: '', siteName: '', hogiNo: '', content: '', reporterPhone: '', extra: '', assignedTo: '', assignedName: '' });
    setSiteSearch('');
  };

  const resetDetailFields = () => {
    setFaultCause(''); setFaultAction(''); setFaultNote('');
    setArrivedAtInput(''); setCompletedAtInput('');
  };

  // ── 단건 처리내역서 PDF ─────────────────────────────────
  const exportSinglePDF = (fault: FaultReport) => {
    const reportDate = toDateObj(fault.createdAt);
    const todayStr = formatKoDate(new Date());
    const docNo = `LF-${reportDate.getFullYear()}${String(reportDate.getMonth()+1).padStart(2,'0')}${String(reportDate.getDate()).padStart(2,'0')}-${fault.id.slice(-4).toUpperCase()}`;
    const site = sites.find(s => s.id === fault.siteId);

    printHtml(`<!DOCTYPE html>
<html lang="ko"><head><meta charset="utf-8"/>
<style>
  @page { size: A4; margin: 25mm 20mm; }
  * { box-sizing: border-box; }
  body { font-family:'Malgun Gothic','Apple SD Gothic Neo',sans-serif; color:#111; font-size:11pt; line-height:1.6; padding:20px; margin:0; }
  .header { text-align:center; border-bottom:3px double #111; padding-bottom:16px; margin-bottom:24px; }
  .company { font-size:12pt; color:#555; letter-spacing:4px; margin-bottom:6px; }
  .title { font-size:26pt; font-weight:bold; letter-spacing:8px; margin:8px 0; }
  .doc-info { display:flex; justify-content:space-between; font-size:10pt; color:#444; margin-bottom:20px; }
  table.main { width:100%; border-collapse:collapse; margin-bottom:18px; }
  table.main th,table.main td { border:1px solid #333; padding:10px 12px; vertical-align:middle; font-size:11pt; }
  table.main th { background:#f3f4f6; text-align:center; font-weight:600; width:20%; }
  table.main td { text-align:left; }
  .time-table { width:100%; border-collapse:collapse; margin-bottom:18px; }
  .time-table th { background:#1f2937; color:#fff; padding:8px 12px; font-size:10pt; text-align:center; border:1px solid #333; }
  .time-table td { border:1px solid #333; padding:8px 12px; font-size:10pt; text-align:center; }
  .section-title { font-size:13pt; font-weight:bold; border-left:5px solid #111; padding-left:10px; margin:18px 0 10px; }
  .content-box { border:1px solid #333; padding:14px 16px; min-height:70px; white-space:pre-wrap; margin-bottom:14px; }
  .badge { display:inline-block; padding:3px 14px; border-radius:4px; font-weight:bold; font-size:10pt; color:#fff;
    background:${fault.status==='완료'?'#16a34a':fault.status==='처리중'?'#ea580c':'#dc2626'}; }
  .footer { margin-top:30px; border-top:1px solid #999; padding-top:10px; font-size:9pt; color:#666; text-align:center; }
</style></head><body>
  <div class="header">
    <div class="company">L I F T &nbsp; F I E L D</div>
    <div class="title">고 장 처 리 내 역 서</div>
  </div>
  <div class="doc-info">
    <div>문서번호: <strong>${docNo}</strong></div>
    <div>출력일자: <strong>${todayStr}</strong></div>
  </div>
  <table class="main">
    <tr><th>현장명</th><td>${fault.siteName||'-'}</td><th>호기</th><td>${fault.hogiNo||'-'}</td></tr>
    <tr><th>주소</th><td colspan="3">${site?.address||'-'}</td></tr>
    <tr><th>담당자</th><td>${fault.assignedName||'-'}</td><th>처리상태</th><td><span class="badge">${fault.status}</span></td></tr>
    ${fault.reporterPhone?`<tr><th>신고자 연락처</th><td colspan="3">${fault.reporterPhone}</td></tr>`:''}
  </table>
  <div class="section-title">📋 시간 내역</div>
  <table class="time-table">
    <thead><tr><th>고장 발생</th><th>접수</th><th>현장 도착</th><th>처리 완료</th></tr></thead>
    <tbody><tr>
      <td>${toDateStr(fault.createdAt)}</td>
      <td>${toDateStr(fault.receivedAt)}</td>
      <td>${toDateStr(fault.arrivedAt)}</td>
      <td>${toDateStr(fault.completedAt)}</td>
    </tr></tbody>
  </table>
  <div class="section-title">1. 고장 내용</div>
  <div class="content-box">${(fault.content||'내용 없음').replace(/\n/g,'<br/>')}</div>
  <div class="section-title">2. 고장 원인</div>
  <div class="content-box">${fault.faultCause?fault.faultCause.replace(/\n/g,'<br/>'):'<span style="color:#999">미입력</span>'}</div>
  <div class="section-title">3. 처리 내용</div>
  <div class="content-box">${fault.faultAction?fault.faultAction.replace(/\n/g,'<br/>'):'<span style="color:#999">미입력</span>'}</div>
  <div class="section-title">4. 비고</div>
  <div class="content-box">${fault.faultNote?fault.faultNote.replace(/\n/g,'<br/>'):'<span style="color:#999">-</span>'}</div>
  <div style="margin-top:50px;text-align:right;">
    <div style="font-size:12pt;margin-bottom:24px;">${formatKoDate(reportDate)}</div>
    <div style="font-size:16pt;font-weight:bold;letter-spacing:6px;">리 프 트 필 드</div>
  </div>
  <div class="footer">본 문서는 LiftField 시스템에서 자동 생성된 공식 문서입니다. (Doc No. ${docNo})</div>
</body></html>`);
  };

  // ── 목록 처리내역서 PDF ─────────────────────────────────
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
        <td class="c nowrap">${formatShort(f.receivedAt)}</td>
        <td class="c nowrap">${formatShort(f.arrivedAt)}</td>
        <td class="c nowrap">${formatShort(f.completedAt)}</td>
        <td class="l">${f.siteName||'-'}</td>
        <td class="c">${f.hogiNo||'-'}</td>
        <td class="l">${(f.content||'-').replace(/\n/g,'<br/>')}</td>
        <td class="l">${(f.faultCause||'-').replace(/\n/g,'<br/>')}</td>
        <td class="l">${(f.faultAction||'-').replace(/\n/g,'<br/>')}</td>
        <td class="c">${f.assignedName||'-'}</td>
        <td class="l">${(f.faultNote||'-').replace(/\n/g,'<br/>')}</td>
      </tr>`).join('');

    printHtml(`<!DOCTYPE html>
<html lang="ko"><head><meta charset="utf-8"/>
<style>
  @page { size: A4 landscape; margin: 15mm 10mm; }
  * { box-sizing: border-box; }
  body { font-family:'Malgun Gothic','Apple SD Gothic Neo',sans-serif; color:#111; font-size:9pt; padding:16px; margin:0; }
  .header { text-align:center; border-bottom:3px double #111; padding-bottom:12px; margin-bottom:14px; }
  .title { font-size:20pt; font-weight:bold; letter-spacing:8px; }
  .doc-info { display:flex; justify-content:space-between; font-size:9pt; color:#444; margin-bottom:10px; }
  table { width:100%; border-collapse:collapse; }
  th,td { border:1px solid #333; padding:5px 4px; vertical-align:middle; font-size:8.5pt; word-break:keep-all; }
  th { background:#1f2937; color:#fff; text-align:center; }
  td.c { text-align:center; } td.l { text-align:left; vertical-align:top; }
  td.nowrap { white-space:nowrap; font-size:8pt; }
  .footer { margin-top:16px; border-top:1px solid #999; padding-top:8px; font-size:8pt; color:#666; text-align:center; }
</style></head><body>
  <div class="header">
    <div style="font-size:10pt;color:#555;letter-spacing:4px;">L I F T &nbsp; F I E L D</div>
    <div class="title">고 장 처 리 내 역 서</div>
  </div>
  <div class="doc-info">
    <div>문서번호: <strong>${docNo}</strong> &nbsp;|&nbsp; 대상: <strong>${siteName}</strong> &nbsp;|&nbsp; 총 <strong>${targetFaults.length}건</strong></div>
    <div>출력일자: <strong>${todayStr}</strong></div>
  </div>
  <table>
    <colgroup>
      <col style="width:3%"/><col style="width:9%"/><col style="width:9%"/>
      <col style="width:9%"/><col style="width:9%"/><col style="width:10%"/>
      <col style="width:4%"/><col style="width:12%"/><col style="width:10%"/>
      <col style="width:11%"/><col style="width:6%"/><col style="width:8%"/>
    </colgroup>
    <thead><tr>
      <th>No.</th><th>고장발생</th><th>접수</th><th>도착</th><th>완료</th>
      <th>현장</th><th>호기</th><th>고장내용</th><th>고장원인</th>
      <th>처리내용</th><th>담당자</th><th>비고</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div style="margin-top:16px;text-align:right;">
    <div style="font-size:11pt;margin-bottom:14px;">${todayStr}</div>
    <div style="font-size:14pt;font-weight:bold;letter-spacing:5px;">리 프 트 필 드</div>
  </div>
  <div class="footer">본 문서는 LiftField 시스템에서 자동 생성된 공식 문서입니다. (Doc No. ${docNo})</div>
</body></html>`);
  };

  // ── 필터 ───────────────────────────────────────────────
  const filteredFaults = faults.filter(f => {
    const matchSearch =
      f.siteName?.includes(search) || f.hogiNo?.includes(search) ||
      f.assignedName?.includes(search) || f.content?.includes(search);
    const matchTeam = teamFilter === ALL_TEAMS || f.team === teamFilter;
    const matchStatus = statusFilter === '전체' || f.status === statusFilter;
    return matchSearch && matchTeam && matchStatus;
  });

  const filteredSites = siteSearch.trim()
    ? sites.filter(s =>
        s.siteName?.toLowerCase().includes(siteSearch.toLowerCase()) ||
        s.address?.toLowerCase().includes(siteSearch.toLowerCase()))
    : sites;

  const selectedSite = sites.find(s => s.id === form.siteId);
  const teamUsers = selectedSite ? users.filter(u => u.team === selectedSite.team) : [];

  const getCompletedCount = (siteId: string) =>
    faults.filter(f => f.siteId === siteId && f.status === '완료').length;
  const sitesForPdf = sites
    .filter(s => getCompletedCount(s.id) > 0)
    .filter(s =>
      !pdfSiteSearch.trim() ||
      s.siteName?.toLowerCase().includes(pdfSiteSearch.toLowerCase()));
  const totalCompleted = faults.filter(f => f.status === '완료').length;

  // ── 통계 ───────────────────────────────────────────────
  const stats = [
    { label: '전체',    count: faults.length,                                   color: 'bg-gray-100 text-gray-700' },
    { label: '접수대기', count: faults.filter(f => f.status === '접수대기').length, color: 'bg-yellow-100 text-yellow-700' },
    { label: '접수',    count: faults.filter(f => f.status === '접수').length,    color: 'bg-red-100 text-red-600' },
    { label: '처리중',  count: faults.filter(f => f.status === '처리중').length,  color: 'bg-orange-100 text-orange-600' },
    { label: '완료',    count: faults.filter(f => f.status === '완료').length,    color: 'bg-green-100 text-green-700' },
  ];

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-gray-500 text-lg">로딩 중...</div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50">

      {/* ── 헤더 ── */}
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between sticky top-0 z-10 shadow-sm">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push('/dashboard')}
            className="text-gray-400 hover:text-gray-700 text-sm font-medium">← 뒤로</button>
          <span className="text-xl">🔧</span>
          <h1 className="text-xl font-bold text-gray-900">고장접수 관리</h1>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setPdfModal(true)}
            className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2 rounded-xl transition-colors">
            📋 처리내역서 PDF
          </button>
          <button onClick={() => setReportModal(true)}
            className="bg-red-500 hover:bg-red-600 text-white text-sm font-semibold px-4 py-2 rounded-xl transition-colors">
            🚨 고장접수
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6">

        {/* ── 통계 카드 ── */}
        <div className="grid grid-cols-5 gap-3 mb-6">
          {stats.map(s => (
            <button key={s.label}
              onClick={() => setStatusFilter(s.label === '전체' ? '전체' : s.label)}
              className={`${s.color} rounded-xl p-4 text-center transition-all hover:opacity-80 ${
                statusFilter === s.label || (s.label === '전체' && statusFilter === '전체')
                  ? 'ring-2 ring-offset-2 ring-blue-400' : ''
              }`}>
              <div className="text-2xl font-bold">{s.count}</div>
              <div className="text-xs font-semibold mt-1">{s.label}</div>
            </button>
          ))}
        </div>

        {/* ── 팀 필터 탭 ── */}
        {teams.length > 1 && (
          <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
            {teams.map(t => (
              <button key={t} onClick={() => setTeamFilter(t)}
                className={`px-4 py-2 rounded-full text-sm font-semibold whitespace-nowrap transition-colors ${
                  teamFilter === t
                    ? 'bg-blue-600 text-white'
                    : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
                }`}>
                {t}
              </button>
            ))}
          </div>
        )}

        {/* ── 검색 ── */}
        <input
          type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="현장명, 호기, 담당자, 내용 검색..."
          className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm text-gray-900 mb-4 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />

        {/* ── 고장 목록 ── */}
        {filteredFaults.length === 0 ? (
          <div className="text-center text-gray-400 py-20 text-lg">고장신고 내역이 없습니다</div>
        ) : (
          <div className="space-y-3">
            {filteredFaults.map(fault => {
              const sc = STATUS_STYLE[fault.status] || 'bg-gray-100 text-gray-600';
              return (
                <div key={fault.id}
                  className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 hover:shadow-md transition-shadow cursor-pointer"
                  onClick={() => openDetail(fault)}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      {/* 제목 행 */}
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="font-bold text-gray-900 text-base">{fault.siteName}</span>
                        <span className="text-gray-500 text-sm">{fault.hogiNo}</span>
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${sc}`}>
                          {fault.status}
                        </span>
                        {fault.team && (
                          <span className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full">
                            {fault.team}
                          </span>
                        )}
                      </div>

                      {/* 고장 내용 */}
                      <p className="text-sm text-gray-600 truncate mb-2">{fault.content}</p>

                      {/* 시간 흐름 */}
                      <div className="flex items-center gap-1 text-xs text-gray-400 flex-wrap">
                        <span>🔴 {formatShort(fault.createdAt)}</span>
                        <span>→</span>
                        <span>📋 {formatShort(fault.receivedAt)}</span>
                        <span>→</span>
                        <span>🚗 {formatShort(fault.arrivedAt)}</span>
                        <span>→</span>
                        <span>✅ {formatShort(fault.completedAt)}</span>
                      </div>

                      <p className="text-xs text-gray-400 mt-1">담당: {fault.assignedName || '미배정'}</p>
                    </div>

                    {/* 오른쪽 버튼들 */}
                    <div className="flex flex-col gap-2 shrink-0" onClick={e => e.stopPropagation()}>
                      {/* 접수대기 → 접수 버튼 */}
                      {fault.status === '접수대기' && (
                        <button onClick={() => handleReceive(fault)}
                          className="bg-red-500 hover:bg-red-600 text-white text-xs font-bold px-3 py-2 rounded-lg transition-colors">
                          📋 접수
                        </button>
                      )}
                      <button onClick={() => exportSinglePDF(fault)}
                        className="bg-blue-50 hover:bg-blue-100 text-blue-600 text-xs font-semibold px-3 py-2 rounded-lg transition-colors">
                        📄 내역서
                      </button>
                      <button onClick={() => deleteFault(fault)}
                        className="bg-red-50 hover:bg-red-100 text-red-500 text-xs font-semibold px-3 py-2 rounded-lg transition-colors">
                        🗑 삭제
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* ════════════════════════════════════════
          고장접수 모달
      ════════════════════════════════════════ */}
      {reportModal && (
        <div className="fixed inset-0 bg-black/50 flex items-end md:items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-gray-900">🚨 고장접수</h2>
              <button onClick={() => { setReportModal(false); resetForm(); }}
                className="text-gray-400 hover:text-gray-700 text-2xl">×</button>
            </div>

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
                  className="text-xs bg-blue-600 text-white px-3 py-1.5 rounded-lg">변경</button>
              </div>
            ) : (
              <>
                <input type="text" value={siteSearch} onChange={e => setSiteSearch(e.target.value)}
                  placeholder="현장명 검색..."
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                <div className="space-y-1 mb-3 max-h-40 overflow-y-auto">
                  {filteredSites.slice(0, 5).map(s => (
                    <button key={s.id}
                      onClick={() => { setForm(p => ({ ...p, siteId: s.id, siteName: s.siteName })); setSiteSearch(''); }}
                      className="w-full text-left px-3 py-2.5 bg-gray-50 hover:bg-blue-50 rounded-lg border border-gray-100 transition-colors">
                      <p className="text-sm font-semibold text-gray-900">{s.siteName}</p>
                      {s.address && <p className="text-xs text-gray-500">{s.address}</p>}
                    </button>
                  ))}
                  {filteredSites.length > 5 && (
                    <p className="text-xs text-gray-400 text-center py-1">+ {filteredSites.length - 5}개 더 있음</p>
                  )}
                </div>
              </>
            )}

            {/* 호기 */}
            {form.siteId && (
              <>
                <label className="block text-sm font-semibold text-gray-700 mb-1">호기 *</label>
                <input type="text" value={form.hogiNo}
                  onChange={e => setForm(p => ({ ...p, hogiNo: e.target.value }))}
                  placeholder="예: 1호기, 2호기"
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </>
            )}

            {/* 고장 내용 */}
            <label className="block text-sm font-semibold text-gray-700 mb-1">고장 내용 *</label>
            <textarea value={form.content} onChange={e => setForm(p => ({ ...p, content: e.target.value }))}
              placeholder="고장 내용을 입력하세요" rows={3}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />

            {/* 신고자 전화 */}
            <label className="block text-sm font-semibold text-gray-700 mb-1">신고자 전화번호</label>
            <input type="tel" value={form.reporterPhone}
              onChange={e => setForm(p => ({ ...p, reporterPhone: e.target.value }))}
              placeholder="010-0000-0000"
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-blue-500" />

            {/* 추가사항 */}
            <label className="block text-sm font-semibold text-gray-700 mb-1">추가사항</label>
            <textarea value={form.extra} onChange={e => setForm(p => ({ ...p, extra: e.target.value }))}
              placeholder="추가사항 입력" rows={2}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />

            {/* 담당자 */}
            <label className="block text-sm font-semibold text-gray-700 mb-1">담당자 선택 *</label>
            {!form.siteId ? (
              <p className="text-xs text-gray-400 mb-3">먼저 현장을 선택해주세요</p>
            ) : teamUsers.length === 0 ? (
              <p className="text-xs text-gray-400 mb-3">{selectedSite?.team || '미지정'} 팀에 소속된 사용자가 없습니다</p>
            ) : (
              <div className="flex flex-wrap gap-2 mb-3">
                {teamUsers.map(u => (
                  <button key={u.id}
                    onClick={() => setForm(p => ({ ...p, assignedTo: u.id, assignedName: u.name }))}
                    className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                      form.assignedTo === u.id
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-gray-100 text-gray-700 border-gray-200 hover:bg-gray-200'
                    }`}>
                    {u.name}
                  </button>
                ))}
              </div>
            )}

            <div className="flex gap-2 mt-2">
              <button onClick={() => { setReportModal(false); resetForm(); }}
                className="flex-1 py-3 bg-gray-100 text-gray-700 font-semibold rounded-xl">취소</button>
              <button onClick={submitReport} disabled={isSubmitting}
                className="flex-1 py-3 bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white font-semibold rounded-xl transition-colors">
                {isSubmitting ? '접수 중...' : '신고 접수'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════
          상세 / 처리 모달
      ════════════════════════════════════════ */}
      {detailModal && selectedFault && (
        <div className="fixed inset-0 bg-black/50 flex items-end md:items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-gray-900">🔧 고장 상세</h2>
              <button onClick={() => { setDetailModal(false); resetDetailFields(); }}
                className="text-gray-400 hover:text-gray-700 text-2xl">×</button>
            </div>

            {/* 기본 정보 */}
            <div className="bg-gray-50 rounded-xl border border-gray-100 p-4 mb-4 space-y-2">
              {[
                { label: '현장',    value: selectedFault.siteName },
                { label: '호기',    value: selectedFault.hogiNo },
                { label: '담당자',  value: selectedFault.assignedName || '미배정' },
                { label: '신고자',  value: selectedFault.reporterPhone || '-' },
                { label: '고장내용', value: selectedFault.content },
                ...(selectedFault.extra ? [{ label: '추가사항', value: selectedFault.extra }] : []),
              ].map(row => (
                <div key={row.label} className="flex gap-3">
                  <span className="text-sm text-gray-500 w-16 shrink-0">{row.label}</span>
                  <span className="text-sm text-gray-900 flex-1">{row.value}</span>
                </div>
              ))}
            </div>

            {/* 시간 내역 그리드 */}
            <h3 className="font-bold text-gray-800 mb-2">⏱ 시간 내역</h3>
            <div className="grid grid-cols-2 gap-2 mb-4">
              {[
                { label: '🔴 고장 발생', value: toDateStr(selectedFault.createdAt) },
                { label: '📋 접수',      value: toDateStr(selectedFault.receivedAt) },
                { label: '🚗 현장 도착', value: toDateStr(selectedFault.arrivedAt) },
                { label: '✅ 처리 완료', value: toDateStr(selectedFault.completedAt) },
              ].map(row => (
                <div key={row.label} className="bg-gray-50 rounded-xl border border-gray-100 p-3">
                  <p className="text-xs text-gray-500 font-semibold mb-1">{row.label}</p>
                  <p className="text-sm text-gray-900 font-medium">{row.value}</p>
                </div>
              ))}
            </div>

            {/* 처리 입력 (완료 전) */}
            {selectedFault.status !== '완료' && (
              <>
                <h3 className="font-bold text-gray-800 mb-3">📝 처리 내용 입력</h3>

                {/* 처리중 버튼 */}
                {selectedFault.status === '접수' && (
                  <button onClick={() => handleSetInProgress(selectedFault)}
                    className="w-full py-2.5 bg-orange-500 hover:bg-orange-600 text-white font-semibold rounded-xl mb-3 transition-colors">
                    🔧 처리중으로 변경
                  </button>
                )}

                <label className="block text-sm font-semibold text-gray-700 mb-1">현장 도착시간</label>
                <input type="datetime-local" value={arrivedAtInput}
                  onChange={e => setArrivedAtInput(e.target.value)}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-blue-500" />

                <label className="block text-sm font-semibold text-gray-700 mb-1">처리 완료시간</label>
                <input type="datetime-local" value={completedAtInput}
                  onChange={e => setCompletedAtInput(e.target.value)}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-blue-500" />

                <label className="block text-sm font-semibold text-gray-700 mb-1">고장 원인</label>
                <textarea value={faultCause} onChange={e => setFaultCause(e.target.value)}
                  placeholder="고장 원인을 입력하세요" rows={2}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />

                <label className="block text-sm font-semibold text-gray-700 mb-1">처리 내용 *</label>
                <textarea value={faultAction} onChange={e => setFaultAction(e.target.value)}
                  placeholder="처리 내용을 입력하세요" rows={3}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />

                <label className="block text-sm font-semibold text-gray-700 mb-1">비고</label>
                <textarea value={faultNote} onChange={e => setFaultNote(e.target.value)}
                  placeholder="비고 입력" rows={2}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />

                <button onClick={submitComplete}
                  className="w-full py-3 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-xl transition-colors mb-2">
                  ✅ 처리 완료 저장
                </button>
              </>
            )}

            {/* 완료 내역 */}
            {selectedFault.status === '완료' && (
              <div className="bg-green-50 border border-green-200 rounded-xl p-4 mb-4 space-y-2">
                <h3 className="font-bold text-green-800 mb-2">✅ 처리 완료 내역</h3>
                {[
                  { label: '고장 원인', value: selectedFault.faultCause || '-' },
                  { label: '처리 내용', value: selectedFault.faultAction || '-' },
                  { label: '비고',      value: selectedFault.faultNote  || '-' },
                ].map(row => (
                  <div key={row.label} className="flex gap-3">
                    <span className="text-sm text-gray-500 w-16 shrink-0">{row.label}</span>
                    <span className="text-sm text-gray-900 flex-1">{row.value}</span>
                  </div>
                ))}
              </div>
            )}

            {/* 하단 버튼 */}
            <div className="space-y-2">
              <button onClick={() => exportSinglePDF(selectedFault)}
                className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition-colors">
                📄 처리내역서 출력 (공문)
              </button>
              {selectedFault.status === '완료' && (
                <button onClick={() => exportListPDF(selectedFault.siteId)}
                  className="w-full py-3 bg-cyan-600 hover:bg-cyan-700 text-white font-semibold rounded-xl transition-colors">
                  📋 이 현장 전체 내역서
                </button>
              )}
              <button onClick={() => deleteFault(selectedFault, true)}
                className="w-full py-3 bg-red-500 hover:bg-red-600 text-white font-semibold rounded-xl transition-colors">
                🗑 삭제
              </button>
              <button onClick={() => { setDetailModal(false); resetDetailFields(); }}
                className="w-full py-3 bg-gray-100 text-gray-700 font-semibold rounded-xl">
                닫기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════
          PDF 현장 선택 모달
      ════════════════════════════════════════ */}
      {pdfModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md max-h-[80vh] overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-gray-900">📋 PDF 출력 - 현장 선택</h2>
              <button onClick={() => { setPdfModal(false); setPdfSiteSearch(''); }}
                className="text-gray-400 hover:text-gray-700 text-2xl">×</button>
            </div>
            <p className="text-xs text-gray-400 mb-3">완료된 고장신고가 있는 현장만 표시됩니다</p>
            <input type="text" value={pdfSiteSearch} onChange={e => setPdfSiteSearch(e.target.value)}
              placeholder="현장명 검색..."
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-blue-500" />

            <div className="space-y-2">
              {/* 전체 */}
              {totalCompleted > 0 && (
                <button
                  onClick={() => { setPdfModal(false); exportListPDF(); }}
                  className="w-full flex items-center justify-between bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 hover:bg-blue-100 transition-colors">
                  <div className="text-left">
                    <p className="font-semibold text-blue-700">📋 전체 현장</p>
                    <p className="text-xs text-gray-500">모든 완료 고장신고를 포함합니다</p>
                  </div>
                  <span className="bg-blue-600 text-white text-xs font-bold px-2.5 py-1 rounded-full">
                    {totalCompleted}건
                  </span>
                </button>
              )}
              {/* 현장별 */}
              {sitesForPdf.length === 0 ? (
                <p className="text-center text-gray-400 py-6 text-sm">
                  {pdfSiteSearch ? '검색 결과가 없습니다' : '완료된 고장신고가 있는 현장이 없습니다'}
                </p>
              ) : sitesForPdf.map(s => {
                const cnt = getCompletedCount(s.id);
                return (
                  <button key={s.id}
                    onClick={() => { setPdfModal(false); exportListPDF(s.id); }}
                    className="w-full flex items-center justify-between bg-gray-50 border border-gray-100 rounded-xl px-4 py-3 hover:bg-gray-100 transition-colors">
                    <div className="text-left">
                      <p className="font-semibold text-gray-900">📍 {s.siteName}</p>
                      {s.address && <p className="text-xs text-gray-500 truncate">{s.address}</p>}
                    </div>
                    <span className="bg-green-100 text-green-700 text-xs font-bold px-2.5 py-1 rounded-full ml-2">
                      {cnt}건
                    </span>
                  </button>
                );
              })}
            </div>

            <button onClick={() => { setPdfModal(false); setPdfSiteSearch(''); }}
              className="w-full mt-4 py-3 bg-gray-100 text-gray-700 font-semibold rounded-xl">
              취소
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
