'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, useRef, useMemo } from 'react';

import { supabase } from '@/lib/supabase';
import { C, Icon, pick } from '@/lib/theme';
import TabBar from '@/components/TabBar';

interface FaultReport {
  id: string;
  site_id: string;
  site_name: string;
  hogi_no: string;
  elevator_no: string;
  equip_type: string;
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
const formatKoDate = (d: Date) => `${d.getFullYear()}년 ${d.getMonth()+1}월 ${d.getDate()}일`;
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

const isEscalatorType = (t?: string | null): boolean =>
  !!t && (t.includes('에스컬레이터') || t.includes('무빙워크'));

const ELEVATOR_CAUSE_GROUPS: Record<string, string[]> = {
  '전기·전원': ['정전·전원 차단', '배선 접촉불량·단선', '누전'],
  '제어반': ['제어반(인버터) 에러', '기판 소손', '통신·신호 오류'],
  '도어': ['도어 개폐 불량', '도어 스위치 불량', '도어 레일 이물질 끼임', '도어 벨트 마모·이탈'],
  '권상기·모터': ['권상기 이상음', '메인모터 과열', '브레이크 라이닝 마모', '브레이크 미개방(작동불량)'],
  '로프·안전장치': ['로프 장력 불균형', '로프 마모·소선단선', '조속기(과속조절기) 작동', '리미트·안전스위치 오동작', '완충기 이상'],
  '조작반·표시': ['버튼·조작반 고장', '층수표시기 오류', '인터폰 불량'],
  '기타': ['정지위치 불량(착상오차)', '승강로 이물질 끼임', '진동·소음 발생', '노후 부품열화', '사용자 과실(비정상 사용)', '원인불명', '기타'],
};
const ESCALATOR_CAUSE_GROUPS: Record<string, string[]> = {
  '스텝·디딤판': ['스텝 변형·파손', '스텝체인 장력불량(늘어짐)', '스텝 롤러 마모', '스텝 정렬 불량'],
  '핸드레일': ['핸드레일 이탈', '핸드레일 속도불일치', '핸드레일 마모·손상', '핸드레일 급정지'],
  '구동부': ['구동체인 이상', '감속기 소음·마모', '메인브레이크 이상', '전동기 과열'],
  '콤플레이트·스커트': ['콤플레이트 파손', '스커트가드 마찰·간섭', '안전브러시(스커트 디플렉터) 이탈'],
  '안전장치': ['비상정지스위치 작동', '인렛가드 안전스위치 작동', '역행방지장치 작동'],
  '전기·제어': ['제어반 오류', '릴레이 불량', '정전·전원차단'],
  '기타': ['이물질 끼임', '소음·진동', '노후 부품열화', '원인불명', '기타'],
};
const ACTION_CHIPS = [
  '리셋 후 정상 작동 확인', '부품 교체', '조정·재조임',
  '청소·이물질 제거', '부품 주문 후 재방문 예정',
  '제조사·외주업체 A/S 요청', '고객 안내 후 종료',
];
const CHIP_SEP = ' · ';
const toggleChipValue = (current: string, label: string): string => {
  const parts = current.split(CHIP_SEP).map(p => p.trim()).filter(Boolean);
  const idx = parts.indexOf(label);
  if (idx >= 0) parts.splice(idx, 1); else parts.push(label);
  return parts.join(CHIP_SEP);
};

const STATUS_LABEL: Record<string, string> = {
  '접수대기': '접수대기', '접수': '접수중', '처리중': '처리중', '완료': '완료',
};

// ── 상태별 색상 (메인화면 팔레트 기준) ──
const STATUS_COLOR: Record<string, string> = {
  '접수대기': C.amber,
  '접수':     C.amber,
  '처리중':   C.primary,
  '완료':     C.green,
};

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

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
  const [elevators, setElevators] = useState<any[]>([]);
  const [teams, setTeams] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [teamFilter, setTeamFilter] = useState(ALL_TEAMS);
  const [statusFilter, setStatusFilter] = useState('전체');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [reportModal, setReportModal] = useState(false);
  const [detailModal, setDetailModal] = useState(false);
  const [selectedFault, setSelectedFault] = useState<FaultReport | null>(null);
  const [pdfModal, setPdfModal] = useState(false);
  const [pdfSiteSearch, setPdfSiteSearch] = useState('');
  const [pdfDateFrom, setPdfDateFrom] = useState('');
  const [pdfDateTo, setPdfDateTo] = useState('');
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [soundOn, setSoundOn] = useState(false);
  const [unseenCount, setUnseenCount] = useState(0);
  const [pushEnabled, setPushEnabled] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem('fault_sound_on');
    if (saved === 'true') setSoundOn(true);
  }, []);

  const [siteSearch, setSiteSearch] = useState('');
  const [elevSearch, setElevSearch] = useState('');
  const [manualHogi, setManualHogi] = useState(false);
  const [form, setForm] = useState({
    siteId: '', siteName: '', hogiNo: '', elevatorNo: '', equipType: '',
    content: '', reporterPhone: '', extra: '',
  });

  const [faultCause, setFaultCause] = useState('');
  const [faultAction, setFaultAction] = useState('');
  const [faultNote, setFaultNote] = useState('');
  const [arrivedAtInput, setArrivedAtInput] = useState('');
  const [completedAtInput, setCompletedAtInput] = useState('');

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!session) { router.push('/login'); return; }
      const { data: userData, error: userError } = await supabase
        .from('users').select('*').eq('id', session.user.id).single();
      if (userError || !userData) { router.push('/login'); return; }
      const plan = userData.subscription_plan;
      const status = userData.subscription_status;
      const isCompany = plan === 'company' && status === 'active';
      const isPro = plan === 'pro' && status === 'active';
      if (!userData.super_admin && userData.role !== 'admin' && userData.role !== 'member' && !isPro && !isCompany) {
        router.push('/login'); return;
      }
      setUserInfo({ uid: session.user.id, ...userData });
      await loadData(userData);
    });
    return () => subscription.unsubscribe();
  }, []);
  useEffect(() => {
    audioRef.current = new Audio('/sounds/alert.mp3');
  }, []);
  useEffect(() => {
    if (!userInfo) return;
    if (typeof window === 'undefined' || !('Notification' in window)) return;

    if (Notification.permission === 'granted') {
      setSoundOn(true);
      localStorage.setItem('fault_sound_on', 'true');
      return;
    }

    if (Notification.permission === 'denied') return;

    let confirmed = false;
    while (!confirmed) {
      confirmed = window.confirm(
        '새 고장 접수를 실시간으로 알려드리려고 합니다.\n알림을 받으시겠습니까?'
      );
    }

    audioRef.current
      ?.play()
      .then(() => {
        audioRef.current?.pause();
        if (audioRef.current) audioRef.current.currentTime = 0;
        setSoundOn(true);
        localStorage.setItem('fault_sound_on', 'true');
      })
      .catch((err) => console.error('알림음 사전 재생 실패:', err));

    enablePushNotification(true);
  }, [userInfo]);

  useEffect(() => {
    if (!userInfo?.company_id) return;
    const isOfficeAdmin = userInfo.super_admin || userInfo.role === 'admin';

    const channel = supabase
      .channel('fault-reports-realtime')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'fault_reports' },
        (payload) => {
          const newFault = payload.new as FaultReport;
          if (newFault.company_id !== userInfo.company_id) return;
          if (!isOfficeAdmin && newFault.team !== userInfo.team) return;

          setFaults(prev => [newFault, ...prev]);
          setUnseenCount(prev => prev + 1);

          console.log('새 고장 접수 감지, soundOn:', soundOn);
          if (soundOn) {
            audioRef.current?.play()
              .then(() => console.log('알림음 재생 성공'))
              .catch((err) => console.error('알림음 재생 실패:', err.name, err.message));
          }
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [userInfo, soundOn]);

  useEffect(() => {
    const handleVisibilityChange = async () => {
      if (document.visibilityState === 'visible') {
        const { data, error } = await supabase.auth.getSession();
        if (error || !data.session) {
          router.push('/login');
          return;
        }
        const expiresAt = data.session.expires_at;
        const now = Math.floor(Date.now() / 1000);
        if (expiresAt && expiresAt - now < 60) {
          await supabase.auth.refreshSession();
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  const loadData = async (info: any) => {
    const cid = info.company_id || '';
    if (!cid) { setLoading(false); return; }
    try {
      const isOfficeAdmin = info.super_admin || info.role === 'admin';

      let faultQuery = supabase
        .from('fault_reports')
        .select('*')
        .eq('company_id', cid)
        .order('created_at', { ascending: false });

      if (!isOfficeAdmin) {
        faultQuery = faultQuery.eq('team', info.team || '__none__');
      }

      const { data: faultData } = await faultQuery;
      const faultList = (faultData || []) as FaultReport[];
      setFaults(faultList);

      const { data: siteData } = await supabase
        .from('sites')
        .select('*')
        .eq('company_id', cid)
        .order('name');
      setSites(siteData || []);

      const siteIds = (siteData || []).map((s: any) => s.id);
      if (siteIds.length > 0) {
        const { data: elevData } = await supabase.from('elevators').select('*').in('site_id', siteIds);
        setElevators(elevData || []);
      } else {
        setElevators([]);
      }

      const { data: userData } = await supabase.from('users').select('*').eq('company_id', cid);
      const userList = userData || [];
      setUsers(userList);

      const teamFromUsers = userList.map((u: any) => u.team).filter(Boolean);
      const teamFromFaults = faultList.map((f) => f.team).filter(Boolean);
      const teamSet = new Set([...teamFromUsers, ...teamFromFaults]);
      setTeams([ALL_TEAMS, ...Array.from(teamSet)]);
    } catch (e) {
      console.error('loadData error:', e);
    } finally {
      setLoading(false);
    }
  };

  const submitReport = async () => {
    if (isSubmitting) return;
    if (!form.siteId) return alert('현장을 선택하세요');
    if (!form.hogiNo.trim()) return alert('승강기(설비)를 선택하거나 호기를 입력하세요');
    if (!form.content.trim()) return alert('고장 내용을 입력하세요');

    setIsSubmitting(true);
    try {
      const siteTeam = sites.find(s => s.id === form.siteId)?.team || '';
      const now = new Date().toISOString();
      const { error } = await supabase.from('fault_reports').insert({
        site_id: form.siteId, site_name: form.siteName,
        hogi_no: form.hogiNo, elevator_no: form.elevatorNo || '', equip_type: form.equipType || '',
        content: form.content, reporter_phone: form.reporterPhone, extra: form.extra,
        assigned_to: '', assigned_name: '',
        team: siteTeam, company_id: userInfo?.company_id || '',
        status: '접수대기', created_at: now,
        received_at: null, arrived_at: null, completed_at: null,
        fault_cause: '', fault_action: '', fault_note: '',
      });
      if (error) throw error;
      await loadData(userInfo);
      setReportModal(false);
      resetForm();
      alert('고장신고가 접수되었습니다! 해당 팀 전체에게 표시됩니다.');
    } catch (e: any) {
      alert('오류: ' + e.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  async function enablePushNotification(silent = false) {
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        if (!silent) alert('이 브라우저는 푸시 알림을 지원하지 않습니다.');
        return;
      }
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        if (!silent) alert('알림 권한이 거부되었습니다.');
        return;
      }
      const registration = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(
          process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!
        ),
      });

      const subJson = subscription.toJSON();

      await supabase.from('push_subscriptions').upsert(
        {
          user_id: userInfo?.uid,
          company_id: userInfo?.company_id,
          team: userInfo?.team,
          endpoint: subJson.endpoint,
          p256dh: subJson.keys?.p256dh,
          auth: subJson.keys?.auth,
        },
        { onConflict: 'endpoint' }
      );

      setPushEnabled(true);
      if (!silent) alert('푸시 알림이 활성화되었습니다.');
    } catch (err) {
      console.error('푸시 등록 실패:', err);
      if (!silent) alert('푸시 알림 등록에 실패했습니다.');
    }
  }

  const handleReceive = async (fault: FaultReport) => {
    if (!confirm(`${fault.site_name} ${fault.hogi_no} 고장을 내가 접수하시겠어요?\n\n담당자: ${userInfo?.name || ''}`)) return;
    try {
      const { data, error } = await supabase
        .from('fault_reports')
        .update({
          status: '접수',
          received_at: new Date().toISOString(),
          assigned_to: userInfo?.uid || '',
          assigned_name: userInfo?.name || '',
        })
        .eq('id', fault.id)
        .eq('status', '접수대기')
        .select();
      if (error) throw error;
      if (!data || data.length === 0) {
        alert('이미 다른 팀원이 접수를 완료했습니다.');
        await loadData(userInfo);
        return;
      }
      await loadData(userInfo);
      openDetail(data[0] as FaultReport);
    } catch (e: any) {
      alert('오류: ' + e.message);
    }
  };

  const handleSetInProgress = async (fault: FaultReport) => {
    try {
      const { error } = await supabase.from('fault_reports').update({ status: '처리중' }).eq('id', fault.id);
      if (error) throw error;
      setSelectedFault(prev => prev ? { ...prev, status: '처리중' } : prev);
      await loadData(userInfo);
    } catch (e: any) {
      alert('오류: ' + e.message);
    }
  };

  const submitComplete = async () => {
    if (!selectedFault) return;
    if (!faultAction.trim()) return alert('처리 내용을 입력하세요');
    const arrivedDate = parseDatetimeInput(arrivedAtInput) ?? new Date().toISOString();
    const completedDate = parseDatetimeInput(completedAtInput) ?? new Date().toISOString();
    try {
      const { error } = await supabase.from('fault_reports').update({
        fault_cause: faultCause, fault_action: faultAction, fault_note: faultNote,
        arrived_at: arrivedDate, completed_at: completedDate, status: '완료',
      }).eq('id', selectedFault.id);
      if (error) throw error;
      await loadData(userInfo);
      setDetailModal(false);
      resetDetailFields();
      alert('처리 완료가 저장되었습니다!');
    } catch (e: any) {
      alert('오류: ' + e.message);
    }
  };

  const deleteFault = async (fault: FaultReport, closeModal = false) => {
    if (!confirm(`정말 삭제하시겠습니까?\n현장: ${fault.site_name}\n호기: ${fault.hogi_no}`)) return;
    try {
      const { error } = await supabase.from('fault_reports').delete().eq('id', fault.id);
      if (error) throw error;
      if (closeModal) setDetailModal(false);
      await loadData(userInfo);
      alert('삭제되었습니다.');
    } catch (e: any) {
      alert('오류: ' + e.message);
    }
  };

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
    setForm({ siteId: '', siteName: '', hogiNo: '', elevatorNo: '', equipType: '', content: '', reporterPhone: '', extra: '' });
    setSiteSearch(''); setElevSearch(''); setManualHogi(false);
  };
  const resetDetailFields = () => {
    setFaultCause(''); setFaultAction(''); setFaultNote('');
    setArrivedAtInput(''); setCompletedAtInput('');
  };

  const safeFileTitle = (s: string) => s.replace(/[\\/:*?"<>|]/g, '').trim();

  const exportSinglePDF = (fault: FaultReport) => {
    const reportDate = toDateObj(fault.created_at);
    const todayStr = formatKoDate(new Date());
    const docNo = `LF-${reportDate.getFullYear()}${String(reportDate.getMonth()+1).padStart(2,'0')}${String(reportDate.getDate()).padStart(2,'0')}-${fault.id.toString().slice(-4).toUpperCase()}`;
    const site = sites.find(s => s.id === fault.site_id);
    const docTitle = safeFileTitle(`${fault.site_name} ${fault.hogi_no} 고장처리보고서`);

    printHtml(`<!DOCTYPE html>
<html lang="ko"><head><meta charset="utf-8"/><title>${docTitle}</title>
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
    background:${fault.status==='완료'?'#16a34a':fault.status==='처리중'?'#2563eb':'#ea580c'}; }
  .footer { margin-top:20px; border-top:1px solid #999; padding-top:8px; font-size:8pt; color:#666; text-align:center; }
  .signature { margin-top:30px; text-align:right; }
</style></head><body>
  <div class="header">
    <div class="company">L I F T &nbsp; F I E L D</div>
    <div class="title">고 장 처 리 보 고 서</div>
  </div>
  <div class="doc-info">
    <div>문서번호: <strong>${docNo}</strong></div>
    <div>출력일자: <strong>${todayStr}</strong></div>
  </div>
  <table class="main">
    <tr><th>현장명</th><td>${fault.site_name||'-'}</td><th>호기</th><td>${fault.hogi_no||'-'}${fault.elevator_no?` (${fault.elevator_no})`:''}</td></tr>
    <tr><th>주소</th><td colspan="3">${site?.address||'-'}</td></tr>
    <tr><th>담당자</th><td>${fault.assigned_name||'-'}</td><th>처리상태</th><td><span class="badge">${STATUS_LABEL[fault.status]||fault.status}</span></td></tr>
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

  const exportListPDF = (siteId?: string) => {
    let targetFaults = siteId
      ? faults.filter(f => f.site_id === siteId && f.status === '완료')
      : faults.filter(f => f.status === '완료');
    if (pdfDateFrom) {
      const from = new Date(pdfDateFrom); from.setHours(0,0,0,0);
      targetFaults = targetFaults.filter(f => toDateObj(f.created_at) >= from);
    }
    if (pdfDateTo) {
      const to = new Date(pdfDateTo); to.setHours(23,59,59,999);
      targetFaults = targetFaults.filter(f => toDateObj(f.created_at) <= to);
    }
    if (targetFaults.length === 0) return alert('해당 기간에 완료된 고장신고가 없습니다');

    const siteName = siteId ? sites.find(s => s.id === siteId)?.site_name || '' : '전체 현장';
    const todayStr = formatKoDate(new Date());
    const now = new Date();
    const docNo = `LF-LIST-${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}`;
    const periodStr = pdfDateFrom || pdfDateTo ? `${pdfDateFrom||'시작'} ~ ${pdfDateTo||'현재'}` : '전체 기간';
    const docTitle = safeFileTitle(`${siteName} 고장처리내역서`);

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
<html lang="ko"><head><meta charset="utf-8"/><title>${docTitle}</title>
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

  const filteredFaults = faults.filter(f => {
    const matchTeam = teamFilter === ALL_TEAMS || f.team === teamFilter;
    const matchStatus = statusFilter === '전체' || f.status === statusFilter;
    const matchSearch =
      f.site_name?.includes(search) || f.hogi_no?.includes(search) ||
      f.assigned_name?.includes(search) || f.content?.includes(search);
    return matchTeam && matchStatus && matchSearch;
  });

  const filteredSites = siteSearch.trim()
    ? sites.filter(s =>
        s.name?.toLowerCase().includes(siteSearch.toLowerCase()) ||
        s.address?.toLowerCase().includes(siteSearch.toLowerCase()))
    : sites;

  const siteElevators = form.siteId ? elevators.filter(e => e.site_id === form.siteId) : [];
const filteredElevators = elevSearch.trim()
  ? siteElevators.filter(e =>
      e.hogi_no?.toLowerCase().includes(elevSearch.toLowerCase()) ||
      e.elevator_no?.toLowerCase().includes(elevSearch.toLowerCase()) ||
      e.dong?.toLowerCase().includes(elevSearch.toLowerCase()))
  : siteElevators;

// 🏢 동별 그룹핑 (InspectionPage와 동일한 정렬 규칙)
const getHogiNum = (h?: string) => parseInt((h || '').replace(/[^0-9]/g, '') || '0');
const groupedElevators = useMemo(() => {
  const map: Record<string, any[]> = {};
  filteredElevators.forEach(e => {
    const key = e.dong || '동 미지정';
    if (!map[key]) map[key] = [];
    map[key].push(e);
  });
  Object.values(map).forEach(arr =>
    arr.sort((a, b) => getHogiNum(a.hogi_no) - getHogiNum(b.hogi_no))
  );
  return Object.entries(map).sort(([a], [b]) => a.localeCompare(b, 'ko', { numeric: true }));
}, [filteredElevators]);


  const activeCauseGroups = isEscalatorType(form.equipType) ? ESCALATOR_CAUSE_GROUPS : ELEVATOR_CAUSE_GROUPS;

  const getCompletedCount = (siteId: string) => faults.filter(f => f.site_id === siteId && f.status === '완료').length;
  const sitesForPdf = sites.filter(s => getCompletedCount(s.id) > 0)
    .filter(s => !pdfSiteSearch.trim() || s.site_name?.toLowerCase().includes(pdfSiteSearch.toLowerCase()));
  const totalCompleted = faults.filter(f => f.status === '완료').length;

  const stats = [
    { label: '전체', count: faults.length, color: C.inkDim },
    { label: '접수대기', count: faults.filter(f => f.status === '접수대기').length, color: C.amber },
    { label: '접수', count: faults.filter(f => f.status === '접수').length, color: C.amber },
    { label: '처리중', count: faults.filter(f => f.status === '처리중').length, color: C.primary },
    { label: '완료', count: faults.filter(f => f.status === '완료').length, color: C.green },
  ];

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: C.inkDim, fontSize: 16 }}>로딩 중...</div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.ink, paddingBottom: 130 }}>
      {/* 상단 헤더 (메인화면 스타일) */}
      <div style={{ padding: '24px 20px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            onClick={() => router.push('/work')}
            style={{
              width: 40, height: 40, borderRadius: 12, background: C.red, color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: `0 4px 12px ${C.red}44`, cursor: 'pointer',
            }}
          >
            {Icon.wrench(18)}
          </div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800, color: C.ink }}>고장신고 관리</div>
            {teamFilter !== ALL_TEAMS && (
              <div style={{ fontSize: 11, color: C.inkDim, fontWeight: 600 }}>
                {teamFilter}팀 인원 {users.filter(u => u.team === teamFilter).length}명
              </div>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div
            onClick={() => setPdfModal(true)}
            style={{
              width: 40, height: 40, borderRadius: 12, background: '#fff',
              border: `1px solid ${C.line}`, display: 'flex', alignItems: 'center',
              justifyContent: 'center', color: C.inkDim, cursor: 'pointer',
            }}
          >
            {Icon.fileText(18)}
          </div>
          <div
            onClick={() => setReportModal(true)}
            style={{
              width: 40, height: 40, borderRadius: 12, background: C.red, color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: `0 4px 12px ${C.red}44`, cursor: 'pointer', fontSize: 22, fontWeight: 700, lineHeight: 1,
            }}
          >
            +
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 480, margin: '0 auto' }}>
        {/* 통계 칩 */}
        <div style={{ padding: '0 16px 12px', display: 'flex', gap: 8, overflowX: 'auto' }}>
          {stats.map((s) => {
            const active = statusFilter === s.label;
            return (
              <button
                key={s.label}
                onClick={() => setStatusFilter(s.label)}
                style={{
                  flexShrink: 0,
                  minWidth: 68,
                  padding: '10px 14px',
                  borderRadius: 12,
                  background: active ? `${s.color}15` : C.surface,
                  border: active ? `1.5px solid ${s.color}` : `1px solid ${C.line}`,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  cursor: 'pointer',
                }}
              >
                <span style={{ fontSize: 11, fontWeight: 700, color: active ? s.color : C.inkDim }}>{s.label}</span>
                <span style={{ fontSize: 18, fontWeight: 800, fontFamily: C.mono, color: active ? s.color : C.ink, lineHeight: 1.3 }}>
                  {s.count}
                </span>
              </button>
            );
          })}
        </div>

        {/* 검색/필터 */}
        <div style={{ padding: '0 16px 14px', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="현장명·호기·담당자·내용 검색"
            style={{
              flex: 1, minWidth: 180, padding: '10px 12px', borderRadius: 10,
              border: `1px solid ${C.line}`, fontSize: 13, outline: 'none', background: C.surface,
            }}
          />
          <select
            value={teamFilter}
            onChange={(e) => setTeamFilter(e.target.value)}
            style={{
              padding: '10px 12px', borderRadius: 10, border: `1px solid ${C.line}`,
              fontSize: 13, background: C.surface, color: C.ink,
            }}
          >
            {teams.map((t) => (
              <option key={t} value={t}>{t === ALL_TEAMS ? '전체 팀' : `${t}팀`}</option>
            ))}
          </select>
        </div>

        {/* 목록 */}
        <div style={{ padding: '0 16px' }}>
          {filteredFaults.length === 0 && (
            <p style={{ textAlign: 'center', color: C.inkFaint, padding: '60px 0', fontSize: 13 }}>
              고장신고 내역이 없습니다
            </p>
          )}

          {filteredFaults.map((f) => {
            const color = STATUS_COLOR[f.status] || C.inkFaint;
            const hoursAgo = f.created_at ? (Date.now() - new Date(f.created_at).getTime()) / 3600000 : 0;
            const urgent = f.status === '접수대기' && hoursAgo >= 2;
            const chipColor = urgent ? C.red : color;
            return (
              <div
                key={f.id}
                style={{
                  background: C.surface, borderRadius: 14, border: `1px solid ${C.line}`,
                  padding: '14px 16px', marginBottom: 10,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                  <div
                    style={{
                      width: 40, height: 40, borderRadius: 12, flexShrink: 0,
                      background: `${chipColor}12`, color: chipColor,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      border: `1px solid ${chipColor}20`,
                    }}
                  >
                    {Icon.wrench(20)}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, flexWrap: 'wrap' }}>
                      <span style={{ padding: '2px 8px', borderRadius: 6, background: `${chipColor}15`, color: chipColor, fontSize: 10.5, fontWeight: 800 }}>
                        {urgent ? '긴급' : STATUS_LABEL[f.status] || f.status}
                      </span>
                      {f.team && <span style={{ fontSize: 10.5, color: C.inkFaint, fontWeight: 700 }}>{f.team}팀</span>}
                      {f.equip_type && <span style={{ fontSize: 10.5, color: C.inkFaint }}>· {f.equip_type}</span>}
                    </div>
                    <div style={{ fontSize: 14.5, fontWeight: 800, color: C.ink, marginBottom: 2 }}>
                      {f.site_name} · {f.hogi_no}
                      {f.elevator_no && <span style={{ color: C.inkFaint, fontWeight: 500, fontSize: 12 }}> ({f.elevator_no})</span>}
                    </div>
                    <div style={{ fontSize: 12.5, color: C.inkDim, marginBottom: 6 }}>{f.content}</div>
                    <div style={{ fontSize: 10.5, color: C.inkFaint, fontFamily: C.mono }}>{toDateStr(f.created_at)}</div>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: `1px solid ${C.line}`, marginTop: 12, paddingTop: 10 }}>
                  <div style={{ fontSize: 11.5, color: C.inkDim }}>
                    담당: <span style={{ fontWeight: 700, color: C.inkSoft }}>{f.assigned_name || '미배정'}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    {f.status === '접수대기' && (
                      <button
                        onClick={() => handleReceive(f)}
                        style={{ padding: '7px 12px', background: C.amber, color: '#fff', borderRadius: 8, fontSize: 11.5, fontWeight: 800, border: 'none', cursor: 'pointer' }}
                      >
                        접수하기
                      </button>
                    )}
                    {f.status === '접수' && (
                      <button
                        onClick={() => handleSetInProgress(f)}
                        style={{ padding: '7px 12px', background: C.primary, color: '#fff', borderRadius: 8, fontSize: 11.5, fontWeight: 800, border: 'none', cursor: 'pointer' }}
                      >
                        현장 도착·처리 시작
                      </button>
                    )}
                    {(f.status === '처리중' || f.status === '접수') && (
                      <button
                        onClick={() => openDetail(f)}
                        style={{ padding: '7px 12px', background: C.bg, color: C.inkSoft, borderRadius: 8, fontSize: 11.5, fontWeight: 700, border: `1px solid ${C.line}`, cursor: 'pointer' }}
                      >
                        처리 입력
                      </button>
                    )}
                    {f.status === '완료' && (
                      <>
                        <button
                          onClick={() => openDetail(f)}
                          style={{ padding: '7px 12px', background: C.bg, color: C.inkSoft, borderRadius: 8, fontSize: 11.5, fontWeight: 700, border: `1px solid ${C.line}`, cursor: 'pointer' }}
                        >
                          상세보기
                        </button>
                        <button
                          onClick={() => exportSinglePDF(f)}
                          style={{ padding: '7px 12px', background: C.green, color: '#fff', borderRadius: 8, fontSize: 11.5, fontWeight: 800, border: 'none', cursor: 'pointer' }}
                        >
                          🧾 보고서
                        </button>
                      </>
                    )}
                    <button
                      onClick={() => deleteFault(f)}
                      style={{ padding: '7px 8px', background: 'transparent', color: C.red, fontSize: 11.5, border: 'none', cursor: 'pointer' }}
                    >
                      삭제
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ===================== 고장 접수 모달 ===================== */}
      {reportModal && (
        <div className="fixed inset-0 bg-black/50 z-30 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b px-5 py-4 flex items-center justify-between">
              <h2 className="text-lg font-bold">고장 접수</h2>
              <button
                onClick={() => { setReportModal(false); resetForm(); }}
                className="text-gray-400 text-xl"
              >✕</button>
            </div>

            <div className="p-5 space-y-4">
              <div>
                <label className="text-sm font-semibold text-gray-700 mb-1 block">현장 선택 *</label>
                {form.siteId ? (
                  <div className="flex items-center justify-between bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
                    <div>
                      <div className="font-semibold text-sm">{form.siteName}</div>
                      <div className="text-xs text-gray-500">
                        {sites.find((s) => s.id === form.siteId)?.address}
                      </div>
                    </div>
                    <button
                      onClick={() => setForm({ ...form, siteId: '', siteName: '', hogiNo: '', elevatorNo: '', equipType: '' })}
                      className="text-xs text-blue-600 font-semibold"
                    >
                      변경
                    </button>
                  </div>
                ) : (
                  <>
                    <input
                      value={siteSearch}
                      onChange={(e) => setSiteSearch(e.target.value)}
                      placeholder="현장명 또는 주소 검색"
                      className="w-full px-3 py-2 border rounded-lg text-sm mb-2 outline-none focus:border-blue-400"
                    />
                    <div className="max-h-40 overflow-y-auto border rounded-lg divide-y">
                      {filteredSites.length === 0 && (
                        <div className="text-center text-gray-400 text-sm py-4">검색 결과가 없습니다</div>
                      )}
                      {filteredSites.map((s) => (
                        <button
                          key={s.id}
                          onClick={() =>
                            setForm({ ...form, siteId: s.id, siteName: s.name || s.address || '이름 미등록 현장', hogiNo: '', elevatorNo: '', equipType: '' })
                          }
                          className="w-full text-left px-3 py-2 hover:bg-gray-50 text-sm"
                        >
                          <div className="font-medium">
                            {s.name
                              ? s.name
                              : <span className="text-red-500">⚠ 현장명 미등록 (운영자 페이지에서 확인 필요)</span>}
                          </div>
                          <div className="text-xs text-gray-400">{s.address || '주소 미등록'}</div>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>

              {form.siteId && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-sm font-semibold text-gray-700">설비(승강기·에스컬레이터·무빙워크) 선택 *</label>
                    <button
                      onClick={() => setManualHogi(!manualHogi)}
                      className="text-xs text-blue-600 font-semibold"
                    >
                      {manualHogi ? '목록에서 선택' : '직접 입력'}
                    </button>
                  </div>

                  {!manualHogi ? (
                    <>
                      <input
                        value={elevSearch}
                        onChange={(e) => setElevSearch(e.target.value)}
                        placeholder="호기 또는 등록번호 검색"
                        className="w-full px-3 py-2 border rounded-lg text-sm mb-2 outline-none focus:border-blue-400"
                      />
                      <div className="max-h-40 overflow-y-auto border rounded-lg divide-y">
  {filteredElevators.length === 0 && (
    <div className="text-center text-gray-400 text-sm py-4">등록된 설비가 없습니다. 직접 입력을 이용하세요.</div>
  )}
  {groupedElevators.map(([dong, list]) => (
    <div key={dong}>
      {dong !== '동 미지정' && (
        <div className="px-3 py-1.5 bg-gray-50 text-xs font-bold text-indigo-500">📍 {dong}</div>
      )}
      {list.map((e) => {
        const dongPrefix = e.dong && e.dong !== '동 미지정' ? `${e.dong} ` : '';
        const hogiDisplay = e.installation_place ? e.installation_place : (e.hogi_no || '');
        const composedHogi = `${dongPrefix}${hogiDisplay}`.trim();
        const isSelected = form.hogiNo === composedHogi;
        return (
          <button
            key={e.id}
            onClick={() =>
              setForm({
                ...form,
                hogiNo: composedHogi,
                elevatorNo: e.elevator_no || '',
                equipType: e.type || e.equip_type || '승강기',
              })
            }
            className={`w-full text-left px-3 py-2 hover:bg-gray-50 text-sm ${isSelected ? 'bg-blue-50' : ''}`}
          >
            <div className="font-medium">
              {e.installation_place ? `(${e.installation_place})` : (e.hogi_no || '호기')}
              <span className="text-xs text-gray-400 font-normal"> · {e.type || e.equip_type}</span>
            </div>
            {e.elevator_no && <div className="text-xs text-gray-400">등록번호 {e.elevator_no}</div>}
          </button>
        );
      })}
    </div>
  ))}
</div>

                    </>
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        value={form.hogiNo}
                        onChange={(e) => setForm({ ...form, hogiNo: e.target.value })}
                        placeholder="호기 (예: 101동 1호기)"
                        className="col-span-2 px-3 py-2 border rounded-lg text-sm outline-none focus:border-blue-400"
                      />
                      <input
                        value={form.elevatorNo}
                        onChange={(e) => setForm({ ...form, elevatorNo: e.target.value })}
                        placeholder="등록번호 (선택)"
                        className="px-3 py-2 border rounded-lg text-sm outline-none focus:border-blue-400"
                      />
                      <select
                        value={form.equipType}
                        onChange={(e) => setForm({ ...form, equipType: e.target.value })}
                        className="px-3 py-2 border rounded-lg text-sm bg-white"
                      >
                        <option value="">설비 종류 선택</option>
                        <option value="승강기">승강기</option>
                        <option value="에스컬레이터">에스컬레이터</option>
                        <option value="무빙워크">무빙워크</option>
                      </select>
                    </div>
                  )}

                  {form.hogiNo && (
                    <div className="mt-2 text-xs text-green-600 font-semibold">
                      선택됨: {form.hogiNo} {form.elevatorNo && `(${form.elevatorNo})`} · {form.equipType || '종류 미지정'}
                    </div>
                  )}
                </div>
              )}

              <div>
                <label className="text-sm font-semibold text-gray-700 mb-1 block">고장 내용 *</label>
                <textarea
                  value={form.content}
                  onChange={(e) => setForm({ ...form, content: e.target.value })}
                  placeholder="예: 3층에서 문이 안 열림 / 이상 소음 발생 등"
                  rows={3}
                  className="w-full px-3 py-2 border rounded-lg text-sm outline-none focus:border-blue-400 resize-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-sm font-semibold text-gray-700 mb-1 block">신고자 연락처</label>
                  <input
                    value={form.reporterPhone}
                    onChange={(e) => setForm({ ...form, reporterPhone: e.target.value })}
                    placeholder="010-0000-0000"
                    className="w-full px-3 py-2 border rounded-lg text-sm outline-none focus:border-blue-400"
                  />
                </div>
                <div>
                  <label className="text-sm font-semibold text-gray-700 mb-1 block">추가 메모</label>
                  <input
                    value={form.extra}
                    onChange={(e) => setForm({ ...form, extra: e.target.value })}
                    placeholder="특이사항"
                    className="w-full px-3 py-2 border rounded-lg text-sm outline-none focus:border-blue-400"
                  />
                </div>
              </div>
            </div>

            <div className="sticky bottom-0 bg-white border-t px-5 py-3 flex gap-2">
              <button
                onClick={() => { setReportModal(false); resetForm(); }}
                className="flex-1 py-2.5 bg-gray-100 rounded-lg font-semibold text-gray-700"
              >
                취소
              </button>
              <button
                onClick={submitReport}
                disabled={isSubmitting}
                className="flex-1 py-2.5 bg-red-500 hover:bg-red-600 text-white rounded-lg font-bold disabled:opacity-50"
              >
                {isSubmitting ? '접수 중...' : '고장 접수하기'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===================== 상세/처리 모달 ===================== */}
      {detailModal && selectedFault && (
        <div className="fixed inset-0 bg-black/50 z-30 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b px-5 py-4 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold">
                  {selectedFault.site_name} · {selectedFault.hogi_no}
                </h2>
                <span
                  className="inline-block mt-1 px-2 py-0.5 rounded-md text-xs font-bold"
                  style={{ background: `${STATUS_COLOR[selectedFault.status]}15`, color: STATUS_COLOR[selectedFault.status] }}
                >
                  {STATUS_LABEL[selectedFault.status] || selectedFault.status}
                </span>
              </div>
              <button onClick={() => setDetailModal(false)} className="text-gray-400 text-xl">✕</button>
            </div>

            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="bg-gray-50 rounded-lg p-2">
                  <div className="text-xs text-gray-400">고장 발생</div>
                  <div className="font-medium">{toDateStr(selectedFault.created_at)}</div>
                </div>
                <div className="bg-gray-50 rounded-lg p-2">
                  <div className="text-xs text-gray-400">접수</div>
                  <div className="font-medium">{toDateStr(selectedFault.received_at)}</div>
                </div>
              </div>

              {(selectedFault.reporter_phone || selectedFault.extra) && (
                <div className="grid grid-cols-1 gap-2 text-sm">
                  {selectedFault.reporter_phone && (
                    <div className="bg-gray-50 rounded-lg p-2">
                      <div className="text-xs text-gray-400">신고자 연락처</div>
                      <div className="font-medium">{selectedFault.reporter_phone}</div>
                    </div>
                  )}
                  {selectedFault.extra && (
                    <div className="bg-gray-50 rounded-lg p-2">
                      <div className="text-xs text-gray-400">추가 메모</div>
                      <div className="font-medium whitespace-pre-wrap">{selectedFault.extra}</div>
                    </div>
                  )}
                </div>
              )}

              <div>
                <label className="text-sm font-semibold text-gray-700 mb-1 block">고장 내용</label>
                <div className="bg-gray-50 rounded-lg p-3 text-sm whitespace-pre-wrap">{selectedFault.content}</div>
              </div>

              {selectedFault.status === '완료' ? (
                <>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="bg-gray-50 rounded-lg p-2">
                      <div className="text-xs text-gray-400">현장 도착</div>
                      <div className="font-medium">{toDateStr(selectedFault.arrived_at)}</div>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-2">
                      <div className="text-xs text-gray-400">처리 완료</div>
                      <div className="font-medium">{toDateStr(selectedFault.completed_at)}</div>
                    </div>
                  </div>
                  <div>
                    <label className="text-sm font-semibold text-gray-700 mb-1 block">고장 원인</label>
                    <div className="bg-gray-50 rounded-lg p-3 text-sm whitespace-pre-wrap">
                      {selectedFault.fault_cause || <span className="text-gray-400">미입력</span>}
                    </div>
                  </div>
                  <div>
                    <label className="text-sm font-semibold text-gray-700 mb-1 block">처리 내용</label>
                    <div className="bg-gray-50 rounded-lg p-3 text-sm whitespace-pre-wrap">
                      {selectedFault.fault_action || <span className="text-gray-400">미입력</span>}
                    </div>
                  </div>
                  {selectedFault.fault_note && (
                    <div>
                      <label className="text-sm font-semibold text-gray-700 mb-1 block">비고</label>
                      <div className="bg-gray-50 rounded-lg p-3 text-sm whitespace-pre-wrap">{selectedFault.fault_note}</div>
                    </div>
                  )}
                </>
              ) : (
                <>
                  {selectedFault.status === '접수' && (
                    <button
                      onClick={() => handleSetInProgress(selectedFault)}
                      className="w-full py-2 bg-blue-50 text-blue-600 rounded-lg text-sm font-semibold"
                    >
                      현장 도착 · 처리중으로 전환
                    </button>
                  )}

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-xs font-semibold text-gray-500 mb-1 block">현장 도착 시간</label>
                      <input
                        type="datetime-local"
                        value={arrivedAtInput}
                        onChange={(e) => setArrivedAtInput(e.target.value)}
                        className="w-full px-2 py-2 border rounded-lg text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-gray-500 mb-1 block">처리 완료 시간</label>
                      <input
                        type="datetime-local"
                        value={completedAtInput}
                        onChange={(e) => setCompletedAtInput(e.target.value)}
                        className="w-full px-2 py-2 border rounded-lg text-sm"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-sm font-semibold text-gray-700 mb-1 block">
                      고장 원인 {isEscalatorType(selectedFault.equip_type) ? '(에스컬레이터·무빙워크)' : '(승강기)'}
                    </label>
                    <div className="space-y-2 max-h-48 overflow-y-auto border rounded-lg p-2">
                      {Object.entries(activeCauseGroups).map(([group, items]) => (
                        <div key={group}>
                          <div className="text-xs font-semibold text-gray-400 mb-1">{group}</div>
                          <div className="flex flex-wrap gap-1.5 mb-1">
                            {items.map((label) => {
                              const active = faultCause.split(CHIP_SEP).map((s) => s.trim()).includes(label);
                              return (
                                <button
                                  key={label}
                                  onClick={() => setFaultCause(toggleChipValue(faultCause, label))}
                                  className={`px-2.5 py-1 rounded-full text-xs border ${
                                    active
                                      ? 'bg-red-500 text-white border-red-500'
                                      : 'bg-white text-gray-600 border-gray-300'
                                  }`}
                                >
                                  {label}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                    <textarea
                      value={faultCause}
                      onChange={(e) => setFaultCause(e.target.value)}
                      rows={2}
                      placeholder="선택된 원인이 자동으로 표시됩니다. 필요시 직접 수정하세요."
                      className="w-full mt-1.5 px-3 py-2 border rounded-lg text-sm outline-none focus:border-blue-400 resize-none"
                    />
                  </div>

                  <div>
                    <label className="text-sm font-semibold text-gray-700 mb-1 block">처리 내용 *</label>
                    <div className="flex flex-wrap gap-1.5 mb-1.5">
                      {ACTION_CHIPS.map((label) => {
                        const active = faultAction.split(CHIP_SEP).map((s) => s.trim()).includes(label);
                        return (
                          <button
                            key={label}
                            onClick={() => setFaultAction(toggleChipValue(faultAction, label))}
                            className={`px-2.5 py-1 rounded-full text-xs border ${
                              active
                                ? 'bg-blue-500 text-white border-blue-500'
                                : 'bg-white text-gray-600 border-gray-300'
                            }`}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                    <textarea
                      value={faultAction}
                      onChange={(e) => setFaultAction(e.target.value)}
                      rows={2}
                      placeholder="선택된 처리내용이 자동으로 표시됩니다. 필요시 직접 수정하세요."
                      className="w-full px-3 py-2 border rounded-lg text-sm outline-none focus:border-blue-400 resize-none"
                    />
                  </div>

                  <div>
                    <label className="text-sm font-semibold text-gray-700 mb-1 block">비고</label>
                    <textarea
                      value={faultNote}
                      onChange={(e) => setFaultNote(e.target.value)}
                      rows={2}
                      placeholder="특이사항이 있으면 입력하세요"
                      className="w-full px-3 py-2 border rounded-lg text-sm outline-none focus:border-blue-400 resize-none"
                    />
                  </div>
                </>
              )}
            </div>

            <div className="sticky bottom-0 bg-white border-t px-5 py-3 flex gap-2">
              {selectedFault.status === '완료' ? (
                <>
                  <button
                    onClick={() => deleteFault(selectedFault, true)}
                    className="px-4 py-2.5 bg-red-50 text-red-500 rounded-lg font-semibold text-sm"
                  >
                    삭제
                  </button>
                  <button
                    onClick={() => exportSinglePDF(selectedFault)}
                    className="flex-1 py-2.5 bg-green-500 hover:bg-green-600 text-white rounded-lg font-bold"
                  >
                    🧾 고장처리 보고서 PDF
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => setDetailModal(false)}
                    className="flex-1 py-2.5 bg-gray-100 rounded-lg font-semibold text-gray-700"
                  >
                    닫기
                  </button>
                  <button
                    onClick={submitComplete}
                    className="flex-1 py-2.5 bg-green-500 hover:bg-green-600 text-white rounded-lg font-bold"
                  >
                    처리 완료 저장
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ===================== PDF 내보내기 모달 ===================== */}
      {pdfModal && (
        <div className="fixed inset-0 bg-black/50 z-30 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b px-5 py-4 flex items-center justify-between">
              <h2 className="text-lg font-bold">고장처리 내역 PDF</h2>
              <button onClick={() => setPdfModal(false)} className="text-gray-400 text-xl">✕</button>
            </div>

            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-semibold text-gray-500 mb-1 block">시작일</label>
                  <input
                    type="date"
                    value={pdfDateFrom}
                    onChange={(e) => setPdfDateFrom(e.target.value)}
                    className="w-full px-2 py-2 border rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-500 mb-1 block">종료일</label>
                  <input
                    type="date"
                    value={pdfDateTo}
                    onChange={(e) => setPdfDateTo(e.target.value)}
                    className="w-full px-2 py-2 border rounded-lg text-sm"
                  />
                </div>
              </div>

              <button
                onClick={() => exportListPDF()}
                className="w-full py-2.5 bg-gray-800 hover:bg-gray-900 text-white rounded-lg font-bold text-sm"
              >
                전체 현장 내보내기 (완료 {totalCompleted}건)
              </button>

              <div>
                <label className="text-sm font-semibold text-gray-700 mb-1 block">현장별 내보내기</label>
                <input
                  value={pdfSiteSearch}
                  onChange={(e) => setPdfSiteSearch(e.target.value)}
                  placeholder="현장명 검색"
                  className="w-full px-3 py-2 border rounded-lg text-sm mb-2 outline-none focus:border-blue-400"
                />
                <div className="max-h-56 overflow-y-auto border rounded-lg divide-y">
                  {sitesForPdf.length === 0 && (
                    <div className="text-center text-gray-400 text-sm py-6">완료된 고장처리 내역이 있는 현장이 없습니다</div>
                  )}
                  {sitesForPdf.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => exportListPDF(s.id)}
                      className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-gray-50 text-sm"
                    >
                      <span className="font-medium">{s.site_name}</span>
                      <span className="text-xs text-gray-400">완료 {getCompletedCount(s.id)}건</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <TabBar active="fault" />
    </div>
  );
}
