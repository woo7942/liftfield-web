'use client';

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

interface UserInfo {
  uid: string;
  name: string;
  companyId: string;
  companyDisplayName: string;
  role: string;
  superAdmin: boolean;
  team: string;
}

interface Team {
  id: string;
  name: string;
}

interface SiteRow {
  id: string;
  name: string;
  address: string;
  team: string;
  lat: number | null;
  lng: number | null;
  elevatorCount: number;
  managerName: string;
  phone: string;
}

interface ElevatorRow {
  id: string;
  siteId: string;
  dong: string;      // 없으면 '동 미지정'
  hogiNo: string;     // 예: '1호기'
  installationPlace: string;
}

interface UnitInspection {
  elevatorId: string;
  completed: boolean;
  completedBy?: string;
  completedAt?: string;
  inspectionDate?: string;
}

interface NoteRow {
  note: string;
}

const MONTHS = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];

export default function InspectionPage() {
  const router = useRouter();
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  const [teams, setTeams] = useState<Team[]>([]);
  const [sites, setSites] = useState<SiteRow[]>([]);
  const [elevators, setElevators] = useState<ElevatorRow[]>([]);
  const [filterTeam, setFilterTeam] = useState('전체');

  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);

  // elevator_id -> UnitInspection
  const [rawUnits, setRawUnits] = useState<Record<string, UnitInspection>>({});
  const [noteMap, setNoteMap] = useState<Record<string, NoteRow>>({});

  const [mapReady, setMapReady] = useState(false);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapObjRef = useRef<any>(null);
  const overlaysRef = useRef<any[]>([]);
  const boundsFitSiteIdsRef = useRef<string>(''); // ✅ 지도 확대 유지용: 이전에 범위를 맞춘 현장 목록 저장

  const [selectedSite, setSelectedSite] = useState<SiteRow | null>(null);
  const [panelUnits, setPanelUnits] = useState<UnitInspection[]>([]);
  const [panelNote, setPanelNote] = useState('');
  const [panelDate, setPanelDate] = useState(''); // ✅ 누락됐던 상태 선언 추가
  const [panelSaving, setPanelSaving] = useState(false);
  const [reportGenerating, setReportGenerating] = useState(false); // ✅ 특이사항 리포트 PDF 생성 중 여부

  // 🔍 현장 검색
  const [siteSearchQuery, setSiteSearchQuery] = useState('');
  const [showSearchResults, setShowSearchResults] = useState(false);

  // ── 인증 ──────────────────────────────────────
  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.push('/login'); return; }
      const { data: userData, error } = await supabase
        .from('users')
        .select('name, company_id, company_display_name, role, super_admin, team')
        .eq('id', session.user.id)
        .single();
      if (error || !userData) { router.push('/login'); return; }
      const admin = userData.role === 'admin' || userData.super_admin === true;
      setUserInfo({
        uid: session.user.id,
        name: userData.name || '',
        companyId: userData.company_id || '',
        companyDisplayName: userData.company_display_name || '',
        role: userData.role || 'member',
        superAdmin: userData.super_admin === true,
        team: userData.team || '',
      });
      setIsAdmin(admin);
      setLoading(false);
    };
    init();
  }, [router]);

  // ── 팀 목록 ──────────────────────
  useEffect(() => {
    if (!userInfo || !isAdmin) return;
    const loadTeams = async () => {
      const { data } = await supabase.from('teams')
        .select('id, name').eq('company_id', userInfo.companyId).order('name');
      setTeams((data || []).map((t: any) => ({ id: t.id, name: t.name || '' })));
    };
    loadTeams();
  }, [userInfo, isAdmin]);

  // ── 현장 목록 ──────────────────────
  useEffect(() => {
    if (!userInfo) return;
    const loadSites = async () => {
      let q = supabase.from('sites')
        .select('id, site_name, name, address, team, lat, lng, elevator_count, manager_name, phone')
        .eq('company_id', userInfo.companyId);
      if (!isAdmin) q = q.eq('team', userInfo.team);
      const { data, error } = await q;
      if (error) { console.error(error); return; }
      setSites((data || []).map((s: any) => ({
        id: s.id,
         name: s.name || s.site_name || '',   // ← name을 우선 사용
        address: s.address || '',
        team: s.team || '',
        lat: s.lat,
        lng: s.lng,
        elevatorCount: s.elevator_count || 0,
        managerName: s.manager_name || '',
        phone: s.phone || '',
      })));
    };
    loadSites();
  }, [userInfo, isAdmin]);

  // ── 승강기(호기) 목록 로드: elevators 테이블에서 실제 동/호기 정보 ──
  useEffect(() => {
    if (!userInfo) return;
    const loadElevators = async () => {
      const { data, error } = await supabase
        .from('elevators')
        .select('id, site_id, dong, hogi_no, installation_place')
        .eq('company_id', userInfo.companyId);
      if (error) { console.error(error); return; }
      setElevators((data || []).map((e: any) => ({
        id: e.id,
        siteId: e.site_id,
        dong: e.dong || '동 미지정',
        hogiNo: e.hogi_no || '',
        installationPlace: e.installation_place || '',
      })));
    };
    loadElevators();
  }, [userInfo]);

  const filteredSites = isAdmin && filterTeam !== '전체'
    ? sites.filter(s => s.team === filterTeam)
    : sites;

  // ── 현장별 승강기 그룹 (동 -> 호기 배열), 정렬 포함 ──
  const elevatorsBySite = useMemo(() => {
    const map: Record<string, ElevatorRow[]> = {};
    elevators.forEach(e => {
      if (!map[e.siteId]) map[e.siteId] = [];
      map[e.siteId].push(e);
    });
    const getHogiNum = (h: string) => parseInt((h || '').replace(/[^0-9]/g, '') || '0');
    Object.values(map).forEach(arr => {
      arr.sort((a, b) => {
        if (a.dong !== b.dong) return a.dong.localeCompare(b.dong, 'ko', { numeric: true });
        return getHogiNum(a.hogiNo) - getHogiNum(b.hogiNo);
      });
    });
    return map;
  }, [elevators]);

  // 승강기 정보가 아예 없는 현장(=엘리베이터 정보 미등록)은 elevator_count만큼
  // 가짜 호기로 대체해서 지도 마커/통계가 깨지지 않게 함
  const siteUnitsBase = useMemo(() => {
    const map: Record<string, ElevatorRow[]> = {};
    sites.forEach(site => {
      const real = elevatorsBySite[site.id];
      if (real && real.length > 0) {
        map[site.id] = real;
      } else {
        const count = Math.max(site.elevatorCount || 1, 1);
        map[site.id] = Array.from({ length: count }, (_, i) => ({
          id: `virtual-${site.id}-${i + 1}`,
          siteId: site.id,
          dong: '동 미지정',
          hogiNo: `${i + 1}호기`,
          installationPlace: '',
        }));
      }
    });
    return map;
  }, [sites, elevatorsBySite]);

  // ── 선택된 월의 호기별 점검 기록 + 비고 로드 ──
  const loadInspections = useCallback(async () => {
    if (!userInfo) return;
    const [unitsRes, notesRes] = await Promise.all([
      supabase.from('site_inspection_units').select('*')
        .eq('company_id', userInfo.companyId).eq('year', year).eq('month', month),
      supabase.from('site_inspections').select('site_id, note')
        .eq('company_id', userInfo.companyId).eq('year', year).eq('month', month),
    ]);
    if (unitsRes.error) { console.error(unitsRes.error); return; }
    const raw: Record<string, UnitInspection> = {};
    (unitsRes.data || []).forEach((r: any) => {
      if (!r.elevator_id) return; // 예전 unit_no 방식 레거시 행은 건너뜀
      raw[r.elevator_id] = {
        elevatorId: r.elevator_id,
        completed: r.completed,
        completedBy: r.completed_by,
        completedAt: r.completed_at,
        inspectionDate: r.inspection_date,
      };
    });
    setRawUnits(raw);

    const notes: Record<string, NoteRow> = {};
    (notesRes.data || []).forEach((r: any) => { notes[r.site_id] = { note: r.note || '' }; });
    setNoteMap(notes);
  }, [userInfo, year, month]);

  useEffect(() => { loadInspections(); }, [loadInspections]);

  // ── 현장별 호기 배열 (완료 상태 병합) ──
  const inspectionUnitsMap = useMemo(() => {
    const map: Record<string, UnitInspection[]> = {};
    sites.forEach(site => {
      const base = siteUnitsBase[site.id] || [];
      map[site.id] = base.map(e => rawUnits[e.id] || { elevatorId: e.id, completed: false });
    });
    return map;
  }, [sites, siteUnitsBase, rawUnits]);

  // ── 현장 검색 결과 (이름/주소 매칭, 최대 8개) ──
  const searchResults = useMemo(() => {
    const q = siteSearchQuery.trim().toLowerCase();
    if (!q) return [];
    return filteredSites
      .filter(s => s.lat != null && s.lng != null)
      .filter(s =>
        s.name?.toLowerCase().includes(q) ||
        s.address?.toLowerCase().includes(q)
      )
      .slice(0, 8);
  }, [siteSearchQuery, filteredSites]);

  // ── 카카오맵 SDK 스크립트 로드 ──
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const w = window as any;
    if (w.kakao && w.kakao.maps) { setMapReady(true); return; }
    const script = document.createElement('script');
    script.src = `//dapi.kakao.com/v2/maps/sdk.js?appkey=${process.env.NEXT_PUBLIC_KAKAO_MAP_KEY}&autoload=false`;
    script.onload = () => { w.kakao.maps.load(() => setMapReady(true)); };
    document.head.appendChild(script);
  }, []);

  // ── 지도 최초 1회 생성 (줌 컨트롤 추가) ──
  useEffect(() => {
    if (!mapReady || !mapContainerRef.current || mapObjRef.current) return;
    const w = window as any;
    mapObjRef.current = new w.kakao.maps.Map(mapContainerRef.current, {
      center: new w.kakao.maps.LatLng(36.5, 127.8),
      level: 12,
    });
    const zoomControl = new w.kakao.maps.ZoomControl();
    mapObjRef.current.addControl(zoomControl, w.kakao.maps.ControlPosition.RIGHT);

    // ✅ 지도 클릭 시 검색 드롭다운 닫기
    w.kakao.maps.event.addListener(mapObjRef.current, 'click', () => {
      setShowSearchResults(false);
    });
  }, [mapReady, loading]);

  // ── 현장/점검현황이 바뀔 때마다 마커 갱신 (완료/일부완료/미완료 3색) ──
  useEffect(() => {
    if (!mapReady || !mapObjRef.current) return;
    const w = window as any;
    overlaysRef.current.forEach(o => o.setMap(null));
    overlaysRef.current = [];

    const valid = filteredSites.filter(s => s.lat != null && s.lng != null);
    if (valid.length === 0) return;

    const bounds = new w.kakao.maps.LatLngBounds();

    valid.forEach(site => {
      const position = new w.kakao.maps.LatLng(site.lat, site.lng);
      bounds.extend(position);

      const units = inspectionUnitsMap[site.id] || [];
      const total = units.length;
      const doneCount = units.filter(u => u.completed).length;

      let color = '#94a3b8';
      let badge = '';
      if (total > 0 && doneCount === total) {
        color = '#22c55e';
        badge = '✅ ';
      } else if (doneCount > 0) {
        color = '#f59e0b';
        badge = `${doneCount}/${total} `;
      }

      const el = document.createElement('div');
      el.style.cursor = 'pointer';
      el.style.display = 'flex';
      el.style.flexDirection = 'column';
      el.style.alignItems = 'center';
      el.innerHTML = `
        <div style="background:${color};color:#fff;font-size:11px;font-weight:700;padding:4px 9px;border-radius:9999px;white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,.3);">
          ${badge}${site.name}
        </div>
        <div style="width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-top:7px solid ${color};margin-top:-1px;"></div>
      `;
      el.addEventListener('click', () => {
        setSelectedSite(site);
        setPanelUnits((inspectionUnitsMap[site.id] || []).map(u => ({ ...u })));
        setPanelNote(noteMap[site.id]?.note || '');
        setPanelDate(new Date().toISOString().slice(0, 10)); // ✅ 패널 열 때 오늘 날짜로 기본 세팅
      });

      const overlay = new w.kakao.maps.CustomOverlay({
        position,
        content: el,
        yAnchor: 1.3,
      });
      overlay.setMap(mapObjRef.current);
      overlaysRef.current.push(overlay);
    });

    mapObjRef.current.relayout();

    // ✅ 실제로 "표시되는 현장 목록"이 바뀌었을 때만 지도 범위를 재조정한다.
    //    점검 완료 상태만 바뀐 경우(체크 후 저장)에는 사용자가 맞춰둔 줌/위치를 그대로 유지.
    const currentSiteIds = valid.map(s => s.id).sort().join(',');
    if (currentSiteIds !== boundsFitSiteIdsRef.current) {
      mapObjRef.current.setBounds(bounds);
      boundsFitSiteIdsRef.current = currentSiteIds;
    }
  }, [mapReady, filteredSites, inspectionUnitsMap, noteMap]);

  // ── 호기별 완료 + 비고 + 점검일 저장 ──
  const savePanel = async () => {
    if (!selectedSite || !userInfo) return;
    setPanelSaving(true);
    try {
      const realUnits = panelUnits.filter(u => !u.elevatorId.startsWith('virtual-'));
      if (realUnits.length > 0) {
        const unitPayloads = realUnits.map(u => {
          const prev = rawUnits[u.elevatorId]; // 기존 저장값
          const wasCompleted = prev?.completed === true;
          let dateToSave: string | null = null;

          if (u.completed) {
            // 원래도 완료였다면 기존 날짜 유지, 이번에 새로 완료됐다면 panelDate 적용
            dateToSave = wasCompleted ? (prev?.inspectionDate ?? panelDate ?? null) : (panelDate || null);
          }

          return {
            company_id: userInfo.companyId,
            site_id: selectedSite.id,
            elevator_id: u.elevatorId,
            year, month,
            completed: u.completed,
            completed_by: u.completed ? (wasCompleted ? prev?.completedBy : userInfo.name) : null,
            completed_at: u.completed ? (wasCompleted ? prev?.completedAt : new Date().toISOString()) : null,
            inspection_date: dateToSave,
            updated_at: new Date().toISOString(),
          };
        });
        const { error: unitErr } = await supabase
          .from('site_inspection_units')
          .upsert(unitPayloads, { onConflict: 'elevator_id,year,month' });
        if (unitErr) throw unitErr;
      } else {
        // 승강기 정보가 없는 현장: 기존 unit_no 방식으로라도 저장(현장당 1행)
        const unitPayloads = panelUnits.map((u, idx) => ({
          company_id: userInfo.companyId,
          site_id: selectedSite.id,
          year, month,
          unit_no: idx + 1,
          completed: u.completed,
          completed_by: u.completed ? userInfo.name : null,
          completed_at: u.completed ? new Date().toISOString() : null,
          inspection_date: u.completed ? (panelDate || null) : null,
          updated_at: new Date().toISOString(),
        }));
        const { error: unitErr } = await supabase
          .from('site_inspection_units')
          .upsert(unitPayloads, { onConflict: 'site_id,year,month,unit_no' });
        if (unitErr) throw unitErr;
      }

      const { error: noteErr } = await supabase
        .from('site_inspections')
        .upsert({
          company_id: userInfo.companyId,
          site_id: selectedSite.id,
          year, month,
          note: panelNote.trim(),
          inspection_date: panelDate || null,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'site_id,year,month' });
      if (noteErr) throw noteErr;

      await loadInspections();
      setSelectedSite(null);
    } catch (e: any) {
      alert('저장 실패: ' + e.message);
    } finally {
      setPanelSaving(false);
    }
  };

  const toggleAllUnits = (value: boolean) => {
    setPanelUnits(prev => prev.map(u => ({ ...u, completed: value })));
  };

  // ── 이번 달 특이사항이 있는 현장만 모아 PDF 리포트 생성 ──
  const generateReport = async () => {
    const targets = filteredSites.filter(s => (noteMap[s.id]?.note || '').trim() !== '');
    if (targets.length === 0) {
      alert(`${year}년 ${month}월에는 특이사항이 등록된 현장이 없어요.`);
      return;
    }

    setReportGenerating(true);
    try {
      const { default: html2canvas } = await import('html2canvas');
      const { jsPDF } = await import('jspdf');

      const wrapper = document.createElement('div');
      wrapper.style.position = 'fixed';
      wrapper.style.top = '0';
      wrapper.style.left = '-99999px';
      wrapper.style.width = '800px';
      wrapper.style.background = '#ffffff';
      wrapper.style.padding = '32px';
      wrapper.style.fontFamily = "'Pretendard','Malgun Gothic',sans-serif";

      const rows = targets.map(site => {
        const units = inspectionUnitsMap[site.id] || [];
        const total = units.length;
        const done = units.filter(u => u.completed).length;
        const note = (noteMap[site.id]?.note || '')
          .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          .replace(/\n/g, '<br/>');
        return `
          <div style="border:1px solid #e5e7eb;border-radius:12px;padding:16px 20px;margin-bottom:14px;">
            <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px;">
              <span style="font-size:16px;font-weight:800;color:#1f2937;">${site.name}</span>
              <span style="font-size:12px;color:#6b7280;">${month}월 점검 · ${done}/${total}호기 완료</span>
            </div>
            <div style="font-size:12px;color:#9ca3af;margin-bottom:8px;">${site.address || ''}</div>
            <div style="font-size:13px;color:#374151;line-height:1.6;">${note}</div>
          </div>
        `;
      }).join('');

      wrapper.innerHTML = `
        <div style="text-align:center;margin-bottom:24px;">
          <h1 style="font-size:20px;font-weight:900;color:#111827;margin:0 0 4px;">${year}년 ${month}월 특이사항 점검 리포트</h1>
          <p style="font-size:12px;color:#9ca3af;margin:0;">총 ${targets.length}개 현장</p>
        </div>
        ${rows}
      `;

      document.body.appendChild(wrapper);
      const canvas = await html2canvas(wrapper, { scale: 2, backgroundColor: '#ffffff' });
      document.body.removeChild(wrapper);

      const pdf = new jsPDF('p', 'mm', 'a4');
      const pageWidth = 210;
      const pageHeight = 297;
      const imgWidth = pageWidth;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      const imgData = canvas.toDataURL('image/png');

      let heightLeft = imgHeight;
      let position = 0;
      pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;
      while (heightLeft > 0) {
        position = heightLeft - imgHeight;
        pdf.addPage();
        pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
        heightLeft -= pageHeight;
      }

      pdf.save(`${year}년_${month}월_특이사항_리포트.pdf`);
    } catch (e: any) {
      alert('리포트 생성 실패: ' + e.message);
    } finally {
      setReportGenerating(false);
    }
  };

  // ── 검색 결과 클릭 시 해당 현장으로 지도 이동 + 패널 오픈 ──
  const goToSite = (site: SiteRow) => {
    const w = window as any;
    if (mapObjRef.current && site.lat != null && site.lng != null) {
      const position = new w.kakao.maps.LatLng(site.lat, site.lng);
      mapObjRef.current.setLevel(3);
      mapObjRef.current.panTo(position);
    }
    setSelectedSite(site);
    setPanelUnits((inspectionUnitsMap[site.id] || []).map(u => ({ ...u })));
    setPanelNote(noteMap[site.id]?.note || '');
    setPanelDate(new Date().toISOString().slice(0, 10));
    setSiteSearchQuery('');
    setShowSearchResults(false);
  };

  const prevMonth = () => { if (month === 1) { setYear(y => y - 1); setMonth(12); } else setMonth(m => m - 1); };
  const nextMonth = () => { if (month === 12) { setYear(y => y + 1); setMonth(1); } else setMonth(m => m + 1); };

  const stats = useMemo(() => {
    let total = 0, done = 0;
    filteredSites.forEach(site => {
      const units = inspectionUnitsMap[site.id] || [];
      total += units.length;
      done += units.filter(u => u.completed).length;
    });
    return { total, done };
  }, [filteredSites, inspectionUnitsMap]);
  const rate = stats.total > 0 ? Math.round(stats.done / stats.total * 100) : 0;

  // 선택된 현장의 승강기를 동별로 그룹 (패널 표시용)
  const selectedElevators = selectedSite ? (siteUnitsBase[selectedSite.id] || []) : [];
  const panelGroups = useMemo(() => {
    const groups: Record<string, { elevator: ElevatorRow; unit: UnitInspection }[]> = {};
    selectedElevators.forEach((e, idx) => {
      const unit = panelUnits[idx];
      if (!unit) return;
      const key = e.dong || '동 미지정';
      if (!groups[key]) groups[key] = [];
      groups[key].push({ elevator: e, unit });
    });
    return groups;
  }, [selectedElevators, panelUnits]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <button onClick={() => router.push('/')} className="text-gray-400 hover:text-gray-600 text-sm">← 홈</button>
            <span className="text-gray-300">|</span>
            <h1 className="text-lg font-bold text-gray-800">🗺️ 점검 지도</h1>
            {userInfo?.companyDisplayName && (
              <span className="bg-indigo-100 text-indigo-700 text-xs px-2 py-1 rounded-full font-semibold">
                🏢 {userInfo.companyDisplayName}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={prevMonth} className="text-gray-400 hover:text-gray-700 text-lg font-bold px-1">‹</button>
            <span className="text-sm font-bold text-gray-700">{year}년 {MONTHS[month - 1]}</span>
            <button onClick={nextMonth} className="text-gray-400 hover:text-gray-700 text-lg font-bold px-1">›</button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-2">
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm px-4 py-2 text-sm">
              전체 <strong className="text-gray-800">{stats.total}</strong>호기
            </div>
            <div className="bg-green-50 rounded-xl border border-green-100 shadow-sm px-4 py-2 text-sm text-green-700">
              완료 <strong>{stats.done}</strong>호기 ({rate}%)
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap justify-end">
            {isAdmin && (
              <div className="flex gap-2 overflow-x-auto">
                {['전체', ...teams.map(t => t.name)].map(t => (
                  <button
                    key={t}
                    onClick={() => setFilterTeam(t)}
                    className={`whitespace-nowrap px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                      filterTeam === t ? 'bg-blue-600 text-white' : 'bg-white text-gray-500 border border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            )}

            <button
              onClick={generateReport}
              disabled={reportGenerating}
              className="whitespace-nowrap px-3 py-1.5 rounded-lg text-xs font-semibold bg-gray-800 text-white hover:bg-gray-900 transition disabled:opacity-60"
            >
              {reportGenerating ? '생성 중...' : `📄 ${month}월 특이사항 리포트`}
            </button>
          </div>
        </div>

        <div className="relative bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          {/* 🔍 현장 검색 */}
          <div className="absolute top-3 left-3 right-3 z-20 sm:right-auto sm:w-80">
            <div className="relative">
              <input
                type="text"
                value={siteSearchQuery}
                onChange={e => { setSiteSearchQuery(e.target.value); setShowSearchResults(true); }}
                onFocus={() => setShowSearchResults(true)}
                placeholder="🔍 현장명 또는 주소로 검색"
                className="w-full bg-white border border-gray-200 shadow-md rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
              {siteSearchQuery && (
                <button
                  onClick={() => { setSiteSearchQuery(''); setShowSearchResults(false); }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-sm"
                >
                  ✕
                </button>
              )}
            </div>

            {showSearchResults && siteSearchQuery.trim() && (
              <div className="mt-1 bg-white border border-gray-200 rounded-xl shadow-lg max-h-64 overflow-y-auto">
                {searchResults.length === 0 ? (
                  <p className="text-xs text-gray-400 px-4 py-3">검색 결과가 없어요</p>
                ) : (
                  searchResults.map(site => {
                    const units = inspectionUnitsMap[site.id] || [];
                    const total = units.length;
                    const done = units.filter(u => u.completed).length;
                    const badgeClass =
                      total > 0 && done === total
                        ? 'bg-green-100 text-green-700'
                        : done > 0
                        ? 'bg-amber-100 text-amber-700'
                        : 'bg-gray-100 text-gray-500';
                    return (
                      <button
                        key={site.id}
                        onClick={() => goToSite(site)}
                        className="w-full text-left px-4 py-2.5 hover:bg-gray-50 flex items-center justify-between gap-2 border-b border-gray-50 last:border-0"
                      >
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold text-gray-800 truncate">{site.name}</span>
                          <span className="block text-[11px] text-gray-400 truncate">{site.address}</span>
                        </span>
                        <span className={`shrink-0 text-[10px] font-bold px-2 py-1 rounded-full ${badgeClass}`}>
                          {done}/{total}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            )}
          </div>

          <div ref={mapContainerRef} style={{ width: '100%', height: '65vh' }} />
        </div>
        <p className="text-xs text-gray-400 text-center">
          🟢 전체완료 · 🟠 일부완료 · ⚪ 미점검 &nbsp;|&nbsp; 현장 마커를 클릭하면 점검 처리를 할 수 있어요.
        </p>
      </main>

      {selectedSite && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-md max-h-[85vh] overflow-y-auto">
            <div className="p-5 border-b border-gray-100 flex items-center justify-between sticky top-0 bg-white">
              <div>
                <h2 className="text-lg font-black text-gray-800">{selectedSite.name}</h2>
                <p className="text-xs text-gray-400 mt-0.5">{selectedSite.address}</p>
              </div>
              <button onClick={() => setSelectedSite(null)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>

            <div className="p-5 space-y-4">
              <div className="flex flex-wrap gap-2 text-xs">
                {selectedSite.team && (
                  <span className="bg-indigo-50 text-indigo-600 px-2.5 py-1 rounded-full font-semibold">{selectedSite.team}</span>
                )}
                {selectedSite.elevatorCount > 0 && (
                  <span className="bg-gray-100 text-gray-600 px-2.5 py-1 rounded-full font-semibold">🛗 {selectedSite.elevatorCount}호기</span>
                )}
                {selectedSite.managerName && (
                  <span className="bg-gray-100 text-gray-600 px-2.5 py-1 rounded-full font-semibold">👤 {selectedSite.managerName}</span>
                )}
              </div>

              {/* ✅ 점검일 입력 */}
              <div>
                <label className="text-xs font-bold text-gray-500 uppercase mb-1 block">점검일</label>
                <input
                  type="date"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  value={panelDate}
                  onChange={e => setPanelDate(e.target.value)}
                />
                <p className="text-[11px] text-gray-400 mt-1">
                  오늘 체크한 호기에는 이 날짜가 저장돼요. 이미 완료된 호기의 점검일은 바뀌지 않아요.
                </p>
              </div>

              <div className="bg-gray-50 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs font-bold text-gray-500">{year}년 {MONTHS[month - 1]} 호기별 점검 상태</p>
                  {panelUnits.length > 1 && (
                    <div className="flex gap-1">
                      <button onClick={() => toggleAllUnits(true)} className="text-[11px] px-2 py-1 rounded-lg bg-green-100 text-green-700 font-semibold">전체완료</button>
                      <button onClick={() => toggleAllUnits(false)} className="text-[11px] px-2 py-1 rounded-lg bg-gray-200 text-gray-600 font-semibold">전체취소</button>
                    </div>
                  )}
                </div>

                {Object.entries(panelGroups).map(([dong, list]) => (
                  <div key={dong} className="space-y-1.5">
                    {dong !== '동 미지정' && (
                      <p className="text-[11px] font-bold text-indigo-500 px-1">📍 {dong}</p>
                    )}
                    {list.map(({ elevator, unit }) => {
                      const idx = panelUnits.findIndex(u => u.elevatorId === unit.elevatorId);
                      return (
                        <button
                          key={unit.elevatorId}
                          type="button"
                          onClick={() => setPanelUnits(prev => prev.map((p, i) => i === idx ? { ...p, completed: !p.completed } : p))}
                          className={`w-full flex items-center justify-between py-2.5 px-3 rounded-xl font-bold text-sm transition ${
                            unit.completed ? 'bg-green-500 text-white' : 'bg-white text-gray-500 border-2 border-dashed border-gray-300'
                          }`}
                        >
                          <span>{elevator.installationPlace ? `(${elevator.installationPlace})` : (elevator.hogiNo || '호기')}</span>
                          <span className="flex items-center gap-1.5">
                            {unit.completed && unit.inspectionDate && (
                              <span className="text-[10px] font-normal opacity-80">{unit.inspectionDate}</span>
                            )}
                            {unit.completed ? '✅ 완료' : '미완료'}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>

              <div>
                <label className="text-xs font-bold text-gray-500 uppercase mb-1 block">비고 / 특이사항</label>
                <textarea
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none"
                  rows={3}
                  value={panelNote}
                  onChange={e => setPanelNote(e.target.value)}
                  placeholder="점검 중 발견된 특이사항을 기록해주세요"
                />
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setSelectedSite(null)}
                  className="flex-1 py-3 rounded-xl border border-gray-200 text-gray-600 font-semibold hover:bg-gray-50 transition"
                >
                  취소
                </button>
                <button
                  onClick={savePanel}
                  disabled={panelSaving}
                  className="flex-1 py-3 rounded-xl bg-blue-600 text-white font-semibold hover:bg-blue-700 transition disabled:opacity-60"
                >
                  {panelSaving ? '저장 중...' : '저장'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
