'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

// ── 타입 ──────────────────────────────────────────────────
interface FaultReport {
  id: string;
  site_id: string;
  site_name: string;
  hogi_no: string;
  content: string;
  reporter_phone: string;
  extra: string;
  assigned_to: string;
  assigned_name: string;
  team: string;
  company_id: string;
  status: '접수대기' | '접수' | '처리중' | '완료';
  created_at: string | null;
  received_at: string | null;
  arrived_at: string | null;
  completed_at: string | null;
  fault_cause: string;
  fault_action: string;
  fault_note: string;
}

// ── 날짜 유틸 ─────────────────────────────────────────────
const toDateStr = (v: string | null): string => {
  if (!v) return '-';
  const d = new Date(v);
  if (isNaN(d.getTime())) return '-';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}. ${pad(d.getMonth()+1)}. ${pad(d.getDate())}. ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const toDateObj = (v: string | null): Date => {
  if (!v) return new Date();
  const d = new Date(v);
  return isNaN(d.getTime()) ? new Date() : d;
};

const formatKoDate = (d: Date) =>
  `${d.getFullYear()}년 ${d.getMonth()+1}월 ${d.getDate()}일`;

const formatShort = (v: string | null): string => {
  if (!v) return '-';
  const d = new Date(v);
  if (isNaN(d.getTime())) return '-';
  const pad = (n: number) => String(n).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(2);
  return `${yy}.${pad(d.getMonth()+1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const toDatetimeLocal = (v: string | null): string => {
  if (!v) return '';
  const d = new Date(v);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const parseDatetimeInput = (s: string): string | null => {
  if (!s.trim()) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString();
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

  // PDF 기간 필터
  const [pdfDateFrom, setPdfDateFrom] = useState('');
  const [pdfDateTo, setPdfDateTo] = useState('');

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

  // ── 인증 + 데이터 로드 ────────────────────────────────
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!session) { router.push('/login'); return; }

      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('*')
        .eq('id', session.user.id)
        .single();

      if (userError || !userData) { router.push('/login'); return; }

      const plan   = userData.subscription_plan;
      const status = userData.subscription_status;
      const isCompany = plan === 'company' && status === 'active';
      const isPro     = plan === 'pro'     && status === 'active';

      if (
        !userData.super_admin &&
        userData.role !== 'admin' &&
        userData.role !== 'member' &&
        !isPro && !isCompany
      ) {
        router.push('/login');
        return;
      }

      setUserInfo({ uid: session.user.id, ...userData });
      await loadData(userData);
    });

    return () => subscription.unsubscribe();
  }, []);

  const loadData = async (info: any) => {
    const cid = info.company_id || '';
    if (!cid) { setLoading(false); return; }

    try {
      // fault_reports 로드
      const { data: faultData } = await supabase
        .from('fault_reports')
        .select('*')
        .eq('company_id', cid)
        .order('created_at', { ascending: false });

      const faultList = (faultData || []) as FaultReport[];
      setFaults(faultList);

      const teamSet = new Set(faultList.map(f => f.team).filter(Boolean));
      setTeams([ALL_TEAMS, ...Array.from(teamSet)]);

      // sites 로드
      const { data: siteData } = await supabase
        .from('sites')
        .select('*')
        .eq('company_id', cid)
        .order('site_name');
      setSites(siteData || []);

      // users 로드
      const { data: userData } = await supabase
        .from('users')
        .select('*')
        .eq('company_id', cid);
      setUsers(userData || []);

    } catch (e) {
      console.error('loadData error:', e);
    } finally {
      setLoading(false);
    }
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
      const siteTeam = sites.find(s => s.id === form.siteId)?.team || '';
      const now = new Date().toISOString();

      const { error } = await supabase.from('fault_reports').insert({
        site_id:        form.siteId,
        site_name:      form.siteName,
        hogi_no:        form.hogiNo,
        content:        form.content,
        reporter_phone: form.reporterPhone,
        extra:          form.extra,
        assigned_to:    form.assignedTo,
        assigned_name:  form.assignedName,
        team:           siteTeam,
        company_id:     userInfo?.company_id || '',
        status:         '접수대기',
        created_at:     now,
        received_at:    null,
        arrived_at:     null,
        completed_at:   null,
        fault_cause:    '',
        fault_action:   '',
        fault_note:     '',
      });

      if (error) throw error;

      // 목록 새로고침
      await loadData(userInfo);
      setReportModal(false);
      resetForm();
      alert('고장신고가 접수되었습니다!');
    } catch (e: any) {
      alert('오류: ' + e.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── 접수 처리 ──────────────────────────────────────────
  const handleReceive = async (fault: FaultReport) => {
    if (!confirm(`${fault.site_name} ${fault.hogi_no} 고장을 접수 처리하시겠어요?\n\n담당자: ${userInfo?.name || ''}`)) return;
    try {
      const { error } = await supabase
        .from('fault_reports')
        .update({
          status:        '접수',
          received_at:   new Date().toISOString(),
          assigned_to:   userInfo?.uid || '',
          assigned_name: userInfo?.name || '',
        })
        .eq('id', fault.id);

      if (error) throw error;
      await loadData(userInfo);
    } catch (e: any) {
      alert('오류: ' + e.message);
    }
  };

  // ── 처리중 변경 ─────────────────────────────────────────
  const handleSetInProgress = async (fault: FaultReport) => {
    try {
      const { error } = await supabase
        .from('fault_reports')
        .update({ status: '처리중' })
        .eq('id', fault.id);

      if (error) throw error;
      setSelectedFault(prev => prev ? { ...prev, status: '처리중' } : prev);
      await loadData(userInfo);
    } catch (e: any) {
      alert('오류: ' + e.message);
    }
  };

  // ── 처리 완료 저장 ──────────────────────────────────────
  const submitComplete = async () => {
    if (!selectedFault) return;
    if (!faultAction.trim()) return alert('처리 내용을 입력하세요');

    const arrivedDate   = parseDatetimeInput(arrivedAtInput)   ?? new Date().toISOString();
    const completedDate = parseDatetimeInput(completedAtInput) ?? new Date().toISOString();

    try {
      const { error } = await supabase
        .from('fault_reports')
        .update({
          fault_cause:  faultCause,
          fault_action: faultAction,
          fault_note:   faultNote,
          arrived_at:   arrivedDate,
          completed_at: completedDate,
          status:       '완료',
        })
        .eq('id', selectedFault.id);

      if (error) throw error;

      await loadData(userInfo);
      setDetailModal(false);
      resetDetailFields();
      alert('처리 완료가 저장되었습니다!');
    } catch (e: any) {
      alert('오류: ' + e.message);
    }
  };

  // ── 삭제 ───────────────────────────────────────────────
  const deleteFault = async (fault: FaultReport, closeModal = false) => {
    if (!confirm(`정말 삭제하시겠습니까?\n현장: ${fault.site_name}\n호기: ${fault.hogi_no}`)) return;
    try {
      const { error } = await supabase
        .from('fault_reports')
        .delete()
        .eq('id', fault.id);

      if (error) throw error;
      if (closeModal) setDetailModal(false);
      await loadData(userInfo);
      alert('삭제되었습니다.');
    } catch (e: any) {
      alert('오류: ' + e.message);
    }
  };

  // ── 상세 모달 열기 ──────────────────────────────────────
  const openDetail = (fault: FaultReport) => {
    setSelectedFault(fault);
    setFaultCause(fault.fault_cause || '');
    setFaultAction(fault.fault_action || '');
    setFaultNote(fault.fault_note || '');
    setArrivedAtInput(fault.arrived_at ? toDatetimeLocal(fault.arrived_at) : '');
    setCompletedAtInput(fault.completed_at ? toDatetimeLocal(fault.completed_at) : '');
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
    const reportDate = toDateObj(fault.created_at);
    const todayStr = formatKoDate(new Date());
    const docNo = `LF-${reportDate.getFullYear()}${String(reportDate.getMonth()+1).padStart(2,'0')}${String(reportDate.getDate()).padStart(2,'0')}-${fault.id.toString().slice(-4).toUpperCase()}`;
    const site = sites.find(s => s.id === fault.site_id);

    printHtml(`<!DOCTYPE html>
<html lang="ko"><head><meta charset="utf-8"/>
<style>
  @page { size: A4 portrait; margin: 20mm 15mm; }
  * { box-sizing: border-box; }
  body { font-family:'Malgun Gothic','Apple SD Gothic Neo','Noto Sans KR',sans-serif; color:#111; font-size:10pt; line-height:1.5; margin:0; padding:0; }
  .header { text-align:center; border-bottom:3px double #111; padding-bottom:12px; margin-bottom:18px; }
  .company { font-size:10pt; color:#555; letter-spacing:4px; margin-bottom:4px; }
  .title { font-size:22pt; font-weight:bold; letter-spacing:8px; margin:6px 0; }
  .doc-info { display:flex; justify-content:space-between; font-size:9pt; color:#444; margin-bottom:14px; }
  table.main { width:100%; border-collapse:collapse; margin-bottom:14px; }
  table.main th,table.main td { border:1px solid #333; padding:7px 10px; vertical-align:middle; font-size:10pt; }
  table.main th { background:#f3f4f6; text-align:center; font-weight:600; width:22%; }
  table.main td { text-align:left; }
  .time-table { width:100%; border-collapse:collapse; margin-bottom:14px; }
  .time-table th { background:#1f2937; color:#fff; padding:7px 10px; font-size:9pt; text-align:center; border:1px solid #333; }
  .time-table td { border:1px solid #333; padding:7px 10px; font-size:9pt; text-align:center; }
  .section-title { font-size:11pt; font-weight:bold; border-left:4px solid #111; padding-left:8px; margin:14px 0 8px; }
  .content-box { border:1px solid #333; padding:10px 12px; min-height:55px; white-space:pre-wrap; margin-bottom:10px; font-size:10pt; }
  .badge { display:inline-block; padding:2px 10px; border-radius:4px; font-weight:bold; font-size:9pt; color:#fff;
    background:${fault.status==='완료'?'#16a34a':fault.status==='처리중'?'#ea580c':'#dc2626'}; }
  .footer { margin-top:20px; border-top:1px solid #999; padding-top:8px; font-size:8pt; color:#666; text-align:center; }
  .signature { margin-top:30px; text-align:right; }
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
    <tr><th>현장명</th><td>${fault.site_name||'-'}</td><th>호기</th><td>${fault.hogi_no||'-'}</td></tr>
    <tr><th>주소</th><td colspan="3">${site?.address||'-'}</td></tr>
    <tr><th>담당자</th><td>${fault.assigned_name||'-'}</td><th>처리상태</th><td><span class="badge">${fault.status}</span></td></tr>
    ${fault.reporter_phone?`<tr><th>신고자 연락처</th><td colspan="3">${fault.reporter_phone}</td></tr>`:''}
  </table>
  <div class="section-title">📋 시간 내역</div>
  <table class="time-table">
    <thead><tr><th>고장 발생</th><th>접수</th><th>현장 도착</th><th>처리 완료</th></tr></thead>
    <tbody><tr>
      <td>${toDateStr(fault.created_at)}</td>
      <td>${toDateStr(fault.received_at)}</td>
      <td>${toDateStr(fault.arrived_at)}</td>
      <td>${toDateStr(fault.completed_at)}</td>
    </tr></tbody>
  </table>
  <div class="section-title">1. 고장 내용</div>
  <div class="content-box">${(fault.content||'내용 없음').replace(/\n/g,'<br/>')}</div>
  <div class="section-title">2. 고장 원인</div>
  <div class="content-box">${fault.fault_cause?fault.fault_cause.replace(/\n/g,'<br/>'):'<span style="color:#999">미입력</span>'}</div>
  <div class="section-title">3. 처리 내용</div>
  <div class="content-box">${fault.fault_action?fault.fault_action.replace(/\n/g,'<br/>'):'<span style="color:#999">미입력</span>'}</div>
  <div class="section-title">4. 비고</div>
  <div class="content-box">${fault.fault_note?fault.fault_note.replace(/\n/g,'<br/>'):'<span style="color:#999">-</span>'}</div>
  <div class="signature">
    <div style="font-size:10pt;margin-bottom:20px;">${formatKoDate(reportDate)}</div>
    <div style="font-size:14pt;font-weight:bold;letter-spacing:6px;">리 프 트 필 드</div>
  </div>
  <div class="footer">본 문서는 LiftField 시스템에서 자동 생성된 공식 문서입니다. (Doc No. ${docNo})</div>
</body></html>`);
  };

  // ── 목록 처리내역서 PDF ─────────────────────────────────
  const exportListPDF = (siteId?: string) => {
    let targetFaults = siteId
      ? faults.filter(f => f.site_id === siteId && f.status === '완료')
      : faults.filter(f => f.status === '완료');

    if (pdfDateFrom) {
      const from = new Date(pdfDateFrom);
      from.setHours(0, 0, 0, 0);
      targetFaults = targetFaults.filter(f => toDateObj(f.created_at) >= from);
    }
    if (pdfDateTo) {
      const to = new Date(pdfDateTo);
      to.setHours(23, 59, 59, 999);
      targetFaults = targetFaults.filter(f => toDateObj(f.created_at) <= to);
    }

    if (targetFaults.length === 0) return alert('해당 기간에 완료된 고장신고가 없습니다');

    const siteName = siteId ? sites.find(s => s.id === siteId)?.site_name || '' : '전체 현장';
    const todayStr = formatKoDate(new Date());
    const now = new Date();
    const docNo = `LF-LIST-${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}`;
    const periodStr = pdfDateFrom || pdfDateTo
      ? `${pdfDateFrom||'시작'} ~ ${pdfDateTo||'현재'}`
      : '전체 기간';

    const rows = targetFaults.map((f, idx) => `
      <tr>
        <td class="c">${idx+1}</td>
        <td class="c nw">${formatShort(f.created_at)}</td>
        <td class="c nw">${formatShort(f.received_at)}</td>
        <td class="c nw">${formatShort(f.arrived_at)}</td>
        <td class="c nw">${formatShort(f.completed_at)}</td>
        <td class="l">${f.site_name||'-'}</td>
        <td class="c">${f.hogi_no||'-'}</td>
        <td class="l">${(f.content||'-').replace(/\n/g,'<br/>')}</td>
        <td class="l">${(f.fault_cause||'-').replace(/\n/g,'<br/>')}</td>
        <td class="l">${(f.fault_action||'-').replace(/\n/g,'<br/>')}</td>
        <td class="c">${f.assigned_name||'-'}</td>
        <td class="l">${(f.fault_note||'-').replace(/\n/g,'<br/>')}</td>
      </tr>`).join('');

    printHtml(`<!DOCTYPE html>
<html lang="ko"><head><meta charset="utf-8"/>
<style>
  @page { size: A4 landscape; margin: 12mm 8mm; }
  * { box-sizing: border-box; }
  body { font-family:'Malgun Gothic','Apple SD Gothic Neo',sans-serif; color:#111; font-size:8pt; padding:10px; margin:0; }
  .header { text-align:center; border-bottom:3px double #111; padding-bottom:10px; margin-bottom:12px; }
  .title { font-size:18pt; font-weight:bold; letter-spacing:8px; }
  .doc-info { display:flex; justify-content:space-between; font-size:8pt; color:#444; margin-bottom:8px; }
  table { width:100%; border-collapse:collapse; }
  th,td { border:1px solid #333; padding:4px 3px; vertical-align:middle; font-size:7.5pt; word-break:keep-all; }
  th { background:#1f2937; color:#fff; text-align:center; }
  td.c { text-align:center; } td.l { text-align:left; vertical-align:top; }
  td.nw { white-space:nowrap; font-size:7pt; }
  .footer { margin-top:12px; border-top:1px solid #999; padding-top:6px; font-size:7.5pt; color:#666; text-align:center; }
</style></head><body>
  <div class="header">
    <div style="font-size:9pt;color:#555;letter-spacing:4px;margin-bottom:4px;">L I F T &nbsp; F I E L D</div>
    <div class="title">고 장 처 리 내 역 서</div>
  </div>
  <div class="doc-info">
    <div>문서번호: <strong>${docNo}</strong> &nbsp;|&nbsp; 대상: <strong>${siteName}</strong> &nbsp;|&nbsp; 기간: <strong>${periodStr}</strong> &nbsp;|&nbsp; 총 <strong>${targetFaults.length}건</strong></div>
    <div>출력일자: <strong>${todayStr}</strong></div>
  </div>
  <table>
    <colgroup>
      <col style="width:3%"/><col style="width:8%"/><col style="width:8%"/>
      <col style="width:8%"/><col style="width:8%"/><col style="width:10%"/>
      <col style="width:4%"/><col style="width:13%"/><col style="width:11%"/>
      <col style="width:13%"/><col style="width:6%"/><col style="width:8%"/>
    </colgroup>
    <thead><tr>
      <th>No.</th><th>고장발생</th><th>접수</th><th>도착</th><th>완료</th>
      <th>현장</th><th>호기</th><th>고장내용</th><th>고장원인</th>
      <th>처리내용</th><th>담당자</th><th>비고</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div style="margin-top:12px;text-align:right;">
    <div style="font-size:9pt;margin-bottom:10px;">${todayStr}</div>
    <div style="font-size:12pt;font-weight:bold;letter-spacing:5px;">리 프 트 필 드</div>
  </div>
  <div class="footer">본 문서는 LiftField 시스템에서 자동 생성된 공식 문서입니다. (Doc No. ${docNo})</div>
</body></html>`);
  };

  // ── 필터 ───────────────────────────────────────────────
  const filteredFaults = faults.filter(f => {
    const matchTeam   = teamFilter === ALL_TEAMS || f.team === teamFilter;
    const matchStatus = statusFilter === '전체'  || f.status === statusFilter;
    const matchSearch =
      f.site_name?.includes(search)     ||
      f.hogi_no?.includes(search)       ||
      f.assigned_name?.includes(search) ||
      f.content?.includes(search);
    return matchTeam && matchStatus && matchSearch;
  });

  const filteredSites = siteSearch.trim()
    ? sites.filter(s =>
        s.site_name?.toLowerCase().includes(siteSearch.toLowerCase()) ||
        s.address?.toLowerCase().includes(siteSearch.toLowerCase()))
    : sites;

  const selectedSite = sites.find(s => s.id === form.siteId);
  const teamUsers = selectedSite
    ? users.filter(u =>
        u.team === selectedSite.team ||
        u.team_name === selectedSite.team ||
        u.team === selectedSite.team_name
      )
    : [];

  const getCompletedCount = (siteId: string) =>
    faults.filter(f => f.site_id === siteId && f.status === '완료').length;

  const sitesForPdf = sites
    .filter(s => getCompletedCount(s.id) > 0)
    .filter(s =>
      !pdfSiteSearch.trim() ||
      s.site_name?.toLowerCase().includes(pdfSiteSearch.toLowerCase()));

  const totalCompleted = faults.filter(f => f.status === '완료').length;

  const stats = [
    { label: '전체',    count: faults.length,                                       color: 'bg-gray-100 text-gray-700' },
    { label: '접수대기', count: faults.filter(f => f.status === '접수대기').length,  color: 'bg-yellow-100 text-yellow-700' },
    { label: '접수',    count: faults.filter(f => f.status === '접수').length,       color: 'bg-red-100 text-red-600' },
    { label: '처리중',  count: faults.filter(f => f.status === '처리중').length,     color: 'bg-orange-100 text-orange-600' },
    { label: '완료',    count: faults.filter(f => f.status === '완료').length,       color: 'bg-green-100 text-green-700' },
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
              onClick={() => setStatusFilter(s.label)}
              className={`${s.color} rounded-xl p-4 text-center transition-all hover:opacity-80 ${
                statusFilter === s.label ? 'ring-2 ring-offset-2 ring-blue-400' : ''
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
        <input type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="현장명, 호기, 담당자, 내용 검색..."
          className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm text-gray-900 mb-4 focus:outline-none focus:ring-2 focus:ring-blue-500" />

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
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="font-bold text-gray-900 text-base">{fault.site_name}</span>
                        <span className="text-gray-500 text-sm">{fault.hogi_no}</span>
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${sc}`}>{fault.status}</span>
                        {fault.team && (
                          <span className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full">{fault.team}</span>
                        )}
                      </div>
                      <p className="text-sm text-gray-600 truncate mb-2">{fault.content}</p>
                      <div className="flex items-center gap-1 text-xs text-gray-400 flex-wrap">
                        <span>🔴 {formatShort(fault.created_at)}</span>
                        <span>→</span>
                        <span>📋 {formatShort(fault.received_at)}</span>
                        <span>→</span>
                        <span>🚗 {formatShort(fault.arrived_at)}</span>
                        <span>→</span>
                        <span>✅ {formatShort(fault.completed_at)}</span>
                      </div>
                      <p className="text-xs text-gray-400 mt-1">담당: {fault.assigned_name || '미배정'}</p>
                    </div>
                    <div className="flex flex-col gap-2 shrink-0" onClick={e => e.stopPropagation()}>
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

            <label className="block text-sm font-semibold text-gray-700 mb-1">현장 선택 *</label>
            {form.siteId ? (
              <div className="flex items-center justify-between bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 mb-3">
                <div>
                  <p className="font-semibold text-blue-700">📍 {form.siteName}</p>
                  <p className="text-xs text-gray-500">{sites.find(s => s.id === form.siteId)?.address || ''}</p>
                  <p className="text-xs text-blue-500 mt-0.5">팀: {sites.find(s => s.id === form.siteId)?.team || '-'}</p>
                </div>
                <button onClick={() => { setForm(p => ({ ...p, siteId: '', siteName: '', hogiNo: '', assignedTo: '', assignedName: '' })); setSiteSearch(''); }}
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
                      onClick={() => { setForm(p => ({ ...p, siteId: s.id, siteName: s.site_name })); setSiteSearch(''); }}
                      className="w-full text-left px-3 py-2.5 bg-gray-50 hover:bg-blue-50 rounded-lg border border-gray-100 transition-colors">
                      <p className="text-sm font-semibold text-gray-900">{s.site_name}</p>
                      <p className="text-xs text-gray-400">{s.team || '팀 미지정'} {s.address ? `· ${s.address}` : ''}</p>
                    </button>
                  ))}
                  {filteredSites.length > 5 && (
                    <p className="text-xs text-gray-400 text-center py-1">+ {filteredSites.length - 5}개 더 있음</p>
                  )}
                </div>
              </>
            )}

            {form.siteId && (
              <>
                <label className="block text-sm font-semibold text-gray-700 mb-1">호기 *</label>
                <input type="text" value={form.hogiNo}
                  onChange={e => setForm(p => ({ ...p, hogiNo: e.target.value }))}
                  placeholder="예: 1호기, 2호기"
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </>
            )}

            <label className="block text-sm font-semibold text-gray-700 mb-1">고장 내용 *</label>
            <textarea value={form.content} onChange={e => setForm(p => ({ ...p, content: e.target.value }))}
              placeholder="고장 내용을 입력하세요" rows={3}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />

            <label className="block text-sm font-semibold text-gray-700 mb-1">신고자 전화번호</label>
            <input type="tel" value={form.reporterPhone}
              onChange={e => setForm(p => ({ ...p, reporterPhone: e.target.value }))}
              placeholder="010-0000-0000"
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-blue-500" />

            <label className="block text-sm font-semibold text-gray-700 mb-1">추가사항</label>
            <textarea value={form.extra} onChange={e => setForm(p => ({ ...p, extra: e.target.value }))}
              placeholder="추가사항 입력" rows={2}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />

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

            <div className="bg-gray-50 rounded-xl border border-gray-100 p-4 mb-4 space-y-2">
              {[
                { label: '현장',    value: selectedFault.site_name },
                { label: '호기',    value: selectedFault.hogi_no },
                { label: '담당자',  value: selectedFault.assigned_name || '미배정' },
                { label: '신고자',  value: selectedFault.reporter_phone || '-' },
                { label: '고장내용', value: selectedFault.content },
                ...(selectedFault.extra ? [{ label: '추가사항', value: selectedFault.extra }] : []),
              ].map(row => (
                <div key={row.label} className="flex gap-3">
                  <span className="text-sm text-gray-500 w-16 shrink-0">{row.label}</span>
                  <span className="text-sm text-gray-900 flex-1">{row.value}</span>
                </div>
              ))}
            </div>

            {/* 시간 내역 */}
            <h3 className="font-bold text-gray-800 mb-2">⏱ 시간 내역</h3>
            <div className="grid grid-cols-2 gap-2 mb-4">
              {[
                { label: '🔴 고장 발생', value: toDateStr(selectedFault.created_at) },
                { label: '📋 접수',      value: toDateStr(selectedFault.received_at) },
                { label: '🚗 현장 도착', value: toDateStr(selectedFault.arrived_at) },
                { label: '✅ 처리 완료', value: toDateStr(selectedFault.completed_at) },
              ].map(row => (
                <div key={row.label} className="bg-gray-50 rounded-xl border border-gray-100 p-3">
                  <p className="text-xs text-gray-500 font-semibold mb-1">{row.label}</p>
                  <p className="text-sm text-gray-900 font-medium">{row.value}</p>
                </div>
              ))}
            </div>

            {selectedFault.status !== '완료' && (
              <>
                <h3 className="font-bold text-gray-800 mb-3">📝 처리 내용 입력</h3>
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

            {selectedFault.status === '완료' && (
              <div className="bg-green-50 border border-green-200 rounded-xl p-4 mb-4 space-y-2">
                <h3 className="font-bold text-green-800 mb-2">✅ 처리 완료 내역</h3>
                {[
                  { label: '고장 원인', value: selectedFault.fault_cause  || '-' },
                  { label: '처리 내용', value: selectedFault.fault_action || '-' },
                  { label: '비고',      value: selectedFault.fault_note   || '-' },
                ].map(row => (
                  <div key={row.label} className="flex gap-3">
                    <span className="text-sm text-gray-500 w-16 shrink-0">{row.label}</span>
                    <span className="text-sm text-gray-900 flex-1">{row.value}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="space-y-2">
              <button onClick={() => exportSinglePDF(selectedFault)}
                className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition-colors">
                📄 처리내역서 출력 (공문)
              </button>
              {selectedFault.status === '완료' && (
                <button onClick={() => exportListPDF(selectedFault.site_id)}
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
          PDF 현장 선택 + 기간 설정 모달
      ════════════════════════════════════════ */}
      {pdfModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md max-h-[85vh] overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-gray-900">📋 처리내역서 PDF</h2>
              <button onClick={() => { setPdfModal(false); setPdfSiteSearch(''); }}
                className="text-gray-400 hover:text-gray-700 text-2xl">×</button>
            </div>

            <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 mb-4">
              <p className="text-sm font-semibold text-blue-700 mb-3">📅 기간 설정 (선택)</p>
              <div className="flex gap-2 items-center">
                <div className="flex-1">
                  <label className="block text-xs text-gray-500 mb-1">시작일</label>
                  <input type="date" value={pdfDateFrom}
                    onChange={e => setPdfDateFrom(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <span className="text-gray-400 mt-4">~</span>
                <div className="flex-1">
                  <label className="block text-xs text-gray-500 mb-1">종료일</label>
                  <input type="date" value={pdfDateTo}
                    onChange={e => setPdfDateTo(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
              {(pdfDateFrom || pdfDateTo) && (
                <button onClick={() => { setPdfDateFrom(''); setPdfDateTo(''); }}
                  className="mt-2 text-xs text-blue-600 hover:underline">
                  기간 초기화
                </button>
              )}
            </div>

            <p className="text-xs text-gray-400 mb-3">완료된 고장신고가 있는 현장만 표시됩니다</p>
            <input type="text" value={pdfSiteSearch} onChange={e => setPdfSiteSearch(e.target.value)}
              placeholder="현장명 검색..."
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-blue-500" />

            <div className="space-y-2">
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
                      <p className="font-semibold text-gray-900">📍 {s.site_name}</p>
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
