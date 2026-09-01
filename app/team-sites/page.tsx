'use client';

import React from 'react';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

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
  elevatorCount?: number;
  phone?: string;
  emergencyPhone?: string;   // 비통번호
  contractType?: string;     // 계약종류
  contractStart?: string;    // 계약 시작일
  contractEnd?: string;      // 계약 종료일
  teamName?: string;
  source?: 'admin' | 'member' | 'team';
  createdAt?: string;
  managerName?: string;
  memo?: string;
  password?: string;         // 출입/공동현관 비밀번호
  maintenanceFee?: number;   // 보수료
  lat?: number;
  lng?: number;
}

interface ElevatorItem {
  id: string;
  dong?: string;
  hogiNo?: string;
  type?: string;
  status?: string;
  installDate?: string;
  inspectionDate?: string;
  model?: string;            // elvtr_model
  manufacturer?: string;     // manufacturer_name
  mntCompany?: string;       // mnt_cpny_nm (관리업체)
  subCompany?: string;       // subcntr_cpny (하도급업체)
  liveLoad?: string;         // 정원/적재하중
  ratedSpeed?: string;       // 정격속도
  shuttleSection?: string;   // 운행구간
  lastResult?: string;       // 최근 검사결과
  installationPlace?: string;
}


interface CacheRow {
  elevator_no: string;
  dong?: string;
  hogi_no?: string;
  building?: string;
  installation_place?: string;
  type?: string;
  elvtr_model?: string;
  manufacturer_name?: string;
  mnt_cpny_nm?: string;
  subcntr_cpny?: string;
  live_load?: string;
  rated_speed?: string;
  shuttle_section?: string;
  status?: string;
  last_result_nm?: string;
  exam_date?: string;
  install_date?: string;
  main_no?: string;
  road_name?: string;
}

type SortKey = 'name' | 'teamName' | 'elevatorCount' | 'contractType';

// 계약종류 고정 옵션 (입력 폼용)
const CONTRACT_TYPES = ['종합계약', '일반계약', '분담종합계약', '분담일반계약', '종합SMART계약'];

// 시/도 이름 접두어 제거 (정식명 먼저, 축약형 나중 순서 중요)
const SIDO_PREFIXES = [
  '서울특별시', '서울',
  '부산광역시', '부산',
  '대구광역시', '대구',
  '인천광역시', '인천',
  '광주광역시', '광주',
  '대전광역시', '대전',
  '울산광역시', '울산',
  '세종특별자치시', '세종',
  '경기도', '경기',
  '강원특별자치도', '강원도', '강원',
  '충청북도', '충북',
  '충청남도', '충남',
  '전북특별자치도', '전라북도', '전북',
  '전라남도', '전남',
  '경상북도', '경북',
  '경상남도', '경남',
  '제주특별자치도', '제주도', '제주',
];

// 괄호 안 내용 제거 (예: "가람로 113 (당하동)" → "가람로 113")
function cleanAddressInput(raw: string): string {
  return raw.replace(/\([^)]*\)/g, '').trim();
}

function stripSidoPrefix(raw: string): string {
  const q = raw.trim();
  for (const prefix of SIDO_PREFIXES) {
    if (q.startsWith(prefix)) {
      return q.slice(prefix.length).trim();
    }
  }
  return q;
}

// 도로명 + 번지 추출 (예: "파주시 가람로 113" → { road: '가람로', number: '113' })
function extractRoadAndNumber(q: string): { road: string; number: string } | null {
  const match = q.match(/([가-힣0-9]+(?:로|길))\s*(\d+(?:-\d+)?)/);
  if (!match) return null;
  return { road: match[1], number: match[2] };
}

// 주소 → 좌표 변환 (카카오 지오코더)
function geocodeAddress(address: string): Promise<{ lat: number; lng: number } | null> {
  return new Promise((resolve) => {
    const w = window as any;
    if (!address?.trim() || !w.kakao?.maps?.services) { resolve(null); return; }
    const geocoder = new w.kakao.maps.services.Geocoder();
    const cleaned = stripSidoPrefix(cleanAddressInput(address));
    geocoder.addressSearch(cleaned, (result: any[], status: string) => {
      if (status === w.kakao.maps.services.Status.OK && result[0]) {
        resolve({ lat: parseFloat(result[0].y), lng: parseFloat(result[0].x) });
      } else {
        // 정제된 주소로 실패하면 원문으로 한 번 더 시도
        if (cleaned !== address.trim()) {
          geocoder.addressSearch(address.trim(), (result2: any[], status2: string) => {
            if (status2 === w.kakao.maps.services.Status.OK && result2[0]) {
              resolve({ lat: parseFloat(result2[0].y), lng: parseFloat(result2[0].x) });
            } else {
              resolve(null);
            }
          });
        } else {
          resolve(null);
        }
      }
    });
  });
}

// 자동 조회 결과 행의 고유 키 (elevator_no가 중복될 가능성을 대비해 idx까지 포함)
function cacheRowKey(row: CacheRow, idx: number): string {
  return `${row.elevator_no || 'no'}_${row.hogi_no || ''}_${idx}`;
}

export default function TeamSitesPage() {
  const router = useRouter();

  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [sites, setSites] = useState<SiteItem[]>([]);
  const [teams, setTeams] = useState<string[]>([]);

  // 호기
  const [siteElevators, setSiteElevators] = useState<ElevatorItem[]>([]);
  const [elevatorsLoading, setElevatorsLoading] = useState(false);
  const [totalElevatorCount, setTotalElevatorCount] = useState(0);

  // 필터/정렬
  const [selectedTeam, setSelectedTeam] = useState('전체');
  const [selectedContractType, setSelectedContractType] = useState('전체');
  const [groupByContract, setGroupByContract] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortAsc, setSortAsc] = useState(true);

  // 추가/수정 모달
  const [showAddModal, setShowAddModal] = useState(false);
  const [addForm, setAddForm] = useState<Partial<SiteItem>>({});
  const [addLoading, setAddLoading] = useState(false);
  const [selectedSite, setSelectedSite] = useState<SiteItem | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editForm, setEditForm] = useState<Partial<SiteItem>>({});
  const [expandedElevatorId, setExpandedElevatorId] = useState<string | null>(null);
  const [showSitePassword, setShowSitePassword] = useState(false);


  // 승강기 자동 조회 (elevator_national_cache)
  const [cacheSearching, setCacheSearching] = useState(false);
  const [cacheResults, setCacheResults] = useState<CacheRow[]>([]);
  const [cacheGrouped, setCacheGrouped] = useState<{ dong: string; count: number }[]>([]);
  const [selectedCacheKeys, setSelectedCacheKeys] = useState<Set<string>>(new Set());

  const isAdmin = userInfo?.role === 'admin';
  const isSuperAdmin = userInfo?.superAdmin === true;
  const canEdit = isAdmin || isSuperAdmin; // 전체 관리 권한 (모든 팀 현장 수정/삭제/팀 재배정)
  const hasTeam = !!(userInfo?.team && userInfo.team.trim());
  const canAddSite = canEdit || hasTeam; // 관리자 또는 팀 배정된 팀원은 자기 팀 현장 추가 가능

  // ─── 인증 ───
  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.push('/login'); return; }

      const { data: userData, error } = await supabase
        .from('users')
        .select('name, email, company_id, company_display_name, team, role, super_admin')
        .eq('id', session.user.id)
        .single();

      if (error || !userData) { router.push('/login'); return; }
      if (!userData.company_id) { router.push('/'); return; }

      setUserInfo({
        uid: session.user.id,
        name: userData.name || '',
        email: userData.email || session.user.email || '',
        companyId: userData.company_id,
        companyDisplayName: userData.company_display_name || '',
        team: userData.team || '',
        role: userData.role || 'member',
        superAdmin: userData.super_admin || false,
      });
      setLoading(false);
    };

    init();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) router.push('/login');
    });

    return () => subscription.unsubscribe();
  }, [router]);

  // ─── 카카오 지오코더 SDK 로드 (좌표 변환용, 지도 표시는 하지 않음) ───
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const w = window as any;
    if (w.kakao?.maps?.services) return;
    const existing = document.getElementById('kakao-geocoder-sdk');
    if (existing) return;
    const script = document.createElement('script');
    script.id = 'kakao-geocoder-sdk';
    script.src = `//dapi.kakao.com/v2/maps/sdk.js?appkey=${process.env.NEXT_PUBLIC_KAKAO_MAP_KEY}&autoload=false&libraries=services`;
    script.onload = () => { w.kakao.maps.load(() => {}); };
    document.head.appendChild(script);
  }, []);

  // ─── 현장 목록 로드 ───
  const reloadSites = async (companyId?: string) => {
    const cid = companyId ?? userInfo?.companyId;
    if (!cid) return;

    const isAdminUser = userInfo?.role === 'admin' || userInfo?.superAdmin === true;
    const myTeam = (userInfo?.team || '').trim();

    if (!isAdminUser && !myTeam) {
      setSites([]);
      setTeams([]);
      setTotalElevatorCount(0);
      return;
    }

    let query = supabase
      .from('sites')
      .select('id, name, address, lat, lng, elevator_count, phone, emergency_phone, contract_type, contract_start, contract_end, team, source, created_at, manager_name, memo, password, maintenance_fee')
      .eq('company_id', cid);

    if (!isAdminUser) {
      query = query.eq('team', myTeam);
    }

    const { data: sitesData, error } = await query.order('created_at', { ascending: false });

    if (error) { console.error(error); return; }

    const list: SiteItem[] = (sitesData || []).map(d => ({
      id: d.id,
      name: d.name || '',
      address: d.address || '',
      lat: d.lat ?? undefined,
      lng: d.lng ?? undefined,
      elevatorCount: d.elevator_count || 0,
      phone: d.phone || '',
      emergencyPhone: d.emergency_phone || '',
      contractType: d.contract_type || '',
      contractStart: d.contract_start || '',
      contractEnd: d.contract_end || '',
      teamName: d.team || '',
      source: d.source as 'admin' | 'member' | 'team',
      createdAt: d.created_at,
      managerName: d.manager_name || '',
      memo: d.memo || '',
      password: d.password || '',
      maintenanceFee: d.maintenance_fee || 0,
    }));

    setSites(list);

    const { data: teamRows } = await supabase
      .from('users')
      .select('team')
      .eq('company_id', cid)
      .not('team', 'is', null);

    const teamSet = new Set<string>();
    (teamRows || []).forEach(r => { const t = (r.team || '').trim(); if (t) teamSet.add(t); });
    list.forEach(s => { const t = (s.teamName || '').trim(); if (t) teamSet.add(t); });
    setTeams(Array.from(teamSet).sort());

    const siteIds = list.map(s => s.id);
    if (siteIds.length > 0) {
      const { count, error: elevError } = await supabase
        .from('elevators')
        .select('id', { count: 'exact', head: true })
        .in('site_id', siteIds);

      if (!elevError) setTotalElevatorCount(count || 0);
    } else {
      setTotalElevatorCount(0);
    }
  };

  useEffect(() => {
    if (!userInfo?.companyId) return;
    reloadSites(userInfo.companyId).catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userInfo?.companyId]);

  // ─── 현장 클릭 시 호기 로드 ───
  async function handleSiteClick(site: SiteItem) {
  setSelectedSite(site);
  setEditForm(site);
  setEditMode(false);
  setShowSitePassword(false);
  setSiteElevators([]);
  setElevatorsLoading(true);

  try {
    const { data, error } = await supabase
      .from('elevators')
      .select(`
        id, dong, hogi_no, type, status, install_date, inspection_date,
        elvtr_model, manufacturer_name, mnt_cpny_nm, subcntr_cpny,
        live_load, rated_speed, shuttle_section, last_result_nm, installation_place
      `)
      .eq('site_id', site.id)
      .order('dong', { ascending: true });

    if (error) throw error;

    const getHogiNum = (h: string) => parseInt((h || '').replace(/[^0-9]/g, '') || '0');
    const sorted = (data || []).sort((a: any, b: any) => {
      if ((a.dong || '') !== (b.dong || '')) return (a.dong || '').localeCompare(b.dong || '', 'ko', { numeric: true });
      return getHogiNum(a.hogi_no) - getHogiNum(b.hogi_no);
    });

    setSiteElevators(sorted.map((d: any) => ({
      id: d.id,
      dong: d.dong || '',
      hogiNo: d.hogi_no || '',
      type: d.type || '',
      status: d.status || '',
      installDate: d.install_date || '',
      inspectionDate: d.inspection_date || '',
      model: d.elvtr_model || '',
      manufacturer: d.manufacturer_name || '',
      mntCompany: d.mnt_cpny_nm || '',
      subCompany: d.subcntr_cpny || '',
      liveLoad: d.live_load || '',
      ratedSpeed: d.rated_speed || '',
      shuttleSection: d.shuttle_section || '',
      lastResult: d.last_result_nm || '',
      installationPlace: d.installation_place || '',
    })));
  } catch (e) {
    console.error(e);
  } finally {
    setElevatorsLoading(false);
  }
}


  async function searchElevatorCache() {
    const rawQ = (addForm.address || '').trim();
    if (!rawQ) {
      alert('먼저 주소나 건물명을 입력해주세요.');
      return;
    }

    setCacheSearching(true);
    setCacheResults([]);
    setCacheGrouped([]);
    setSelectedCacheKeys(new Set());

    try {
      const cleaned = cleanAddressInput(rawQ);
      const normalizedQ = stripSidoPrefix(cleaned);

      const runTextSearch = async (q: string) => {
        const { data, error } = await supabase
          .from('elevator_national_cache')
          .select('*')
          .or(`address1.ilike.%${q}%,address2.ilike.%${q}%,building.ilike.%${q}%`)
          .limit(500);
        if (error) throw error;
        return data || [];
      };

      let rows: CacheRow[] = [];

      // 1차: 도로명 + 번지를 정확한 컬럼으로 검색 (가장 정확)
      const roadInfo = extractRoadAndNumber(normalizedQ);
      if (roadInfo) {
        const { data, error } = await supabase
          .from('elevator_national_cache')
          .select('*')
          .ilike('road_name', `%${roadInfo.road}%`)
          .ilike('main_no', `%${roadInfo.number}%`)
          .limit(500);
        if (!error && data) rows = data;
      }

      // 2차: 시/도·괄호 제거한 문자열로 전체 부분일치 검색
      if (rows.length === 0) {
        rows = await runTextSearch(normalizedQ);
      }

      // 3차: 원문 그대로 한 번 더 검색 (최후 폴백)
      if (rows.length === 0 && normalizedQ !== rawQ) {
        rows = await runTextSearch(rawQ);
      }

      setCacheResults(rows);

      const groupMap = new Map<string, number>();
      rows.forEach((r) => {
        const key = r.dong && String(r.dong).trim() ? `${r.dong}동` : '동 정보 없음';
        groupMap.set(key, (groupMap.get(key) || 0) + 1);
      });
      setCacheGrouped(Array.from(groupMap.entries()).map(([dong, count]) => ({ dong, count })));

      // 관리업체명에 우리 회사명이 포함된 항목은 자동으로 체크해줌 (편의 기능)
      const myCompanyName = (userInfo?.companyDisplayName || '').trim();
      const autoSelected = new Set<string>();
      rows.forEach((r, idx) => {
        if (myCompanyName && r.mnt_cpny_nm && r.mnt_cpny_nm.includes(myCompanyName)) {
          autoSelected.add(cacheRowKey(r, idx));
        }
      });
      setSelectedCacheKeys(autoSelected);
      setAddForm(prev => ({ ...prev, elevatorCount: autoSelected.size || 0 }));

      if (rows.length === 0) {
        alert('일치하는 승강기 정보를 찾지 못했어요. 주소나 건물명을 다시 확인해주세요.');
      } else if (autoSelected.size === 0) {
        alert(`${rows.length}대가 조회됐어요. 이 중 우리 회사가 관리하는 호기만 체크한 뒤 저장해주세요. (같은 주소에 다른 관리업체 승강기가 섞여 있을 수 있어요)`);
      }
    } catch (e) {
      console.error(e);
      alert('조회 중 오류가 발생했어요.');
    } finally {
      setCacheSearching(false);
    }
  }

  function toggleCacheRow(key: string) {
    setSelectedCacheKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      setAddForm(f => ({ ...f, elevatorCount: next.size }));
      return next;
    });
  }

  function selectAllCache() {
    const all = new Set(cacheResults.map((r, idx) => cacheRowKey(r, idx)));
    setSelectedCacheKeys(all);
    setAddForm(prev => ({ ...prev, elevatorCount: all.size }));
  }

  function clearAllCache() {
    setSelectedCacheKeys(new Set());
    setAddForm(prev => ({ ...prev, elevatorCount: 0 }));
  }

  // ─── 계약종류 옵션 (실제 데이터 기준) ───
  const contractTypeOptions = Array.from(
    new Set(sites.map(s => s.contractType).filter((v): v is string => !!v))
  ).sort();

  // ─── 필터 + 정렬 ───
  const filteredSites = sites
    .filter(s => {
      if (!canEdit && s.teamName !== userInfo?.team) return false;
      if (canEdit && selectedTeam !== '전체' && s.teamName !== selectedTeam) return false;
      if (canEdit && selectedContractType !== '전체' && s.contractType !== selectedContractType) return false;
      if (searchText) {
        const q = searchText.toLowerCase();
        return (
          s.name?.toLowerCase().includes(q) ||
          s.teamName?.toLowerCase().includes(q) ||
          s.managerName?.toLowerCase().includes(q) ||
          s.phone?.toLowerCase().includes(q) ||
          s.emergencyPhone?.toLowerCase().includes(q)
        );
      }
      return true;
    })
    .sort((a, b) => {
      let valA: string | number = '';
      let valB: string | number = '';
      if (sortKey === 'name') { valA = a.name || ''; valB = b.name || ''; }
      else if (sortKey === 'teamName') { valA = a.teamName || ''; valB = b.teamName || ''; }
      else if (sortKey === 'elevatorCount') { valA = a.elevatorCount || 0; valB = b.elevatorCount || 0; }
      else if (sortKey === 'contractType') { valA = a.contractType || ''; valB = b.contractType || ''; }
      if (valA < valB) return sortAsc ? -1 : 1;
      if (valA > valB) return sortAsc ? 1 : -1;
      return 0;
    });

  const filteredElevatorCount = filteredSites.reduce((sum, s) => sum + (s.elevatorCount || 0), 0);
  const filteredFeeSum = filteredSites.reduce((sum, s) => sum + (s.maintenanceFee || 0), 0);

  // ─── 계약종류별 그룹핑 ───
  const groupedByContract = filteredSites.reduce((acc, s) => {
    const key = s.contractType || '미분류';
    if (!acc[key]) acc[key] = [];
    acc[key].push(s);
    return acc;
  }, {} as Record<string, SiteItem[]>);

  const groupKeys = Object.keys(groupedByContract).sort(
    (a, b) => groupedByContract[b].length - groupedByContract[a].length
  );

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(true); }
  }

  function SortIcon({ k }: { k: SortKey }) {
    if (sortKey !== k) return <span className="text-gray-300 ml-1">↕</span>;
    return <span className="text-blue-500 ml-1">{sortAsc ? '↑' : '↓'}</span>;
  }

  // ─── 현장 추가 (+ 자동 조회된 호기 중 '체크된 것만' + 좌표 함께 저장) ───
  async function handleAddSite() {
    if (!addForm.name?.trim() || !userInfo?.companyId) return;
    if (!canEdit && !userInfo?.team) {
      alert('배정된 팀이 없어 현장을 추가할 수 없어요. 관리자에게 팀 배정을 요청해주세요.');
      return;
    }
    setAddLoading(true);
    try {
      // 주소가 있으면 좌표 계산 시도 (지도 표시를 위해 필요)
      const coords = addForm.address ? await geocodeAddress(addForm.address) : null;

      // 체크된 호기만 추려냄 (같은 주소의 다른 관리업체 승강기가 섞이지 않도록)
      const selectedRows = cacheResults.filter((r, idx) => selectedCacheKeys.has(cacheRowKey(r, idx)));

      // 팀 배정: 관리자는 자유롭게 선택, 일반 팀원은 본인 팀으로 고정
      const teamToSave = canEdit ? (addForm.teamName || '') : (userInfo.team || '');

      const { data: newSite, error } = await supabase
        .from('sites')
        .insert({
          name: addForm.name,
          address: addForm.address || '',
          lat: coords?.lat ?? null,
          lng: coords?.lng ?? null,
          phone: addForm.phone || '',
          emergency_phone: addForm.emergencyPhone || '',
          contract_type: addForm.contractType || '',
          contract_start: addForm.contractStart || null,
          contract_end: addForm.contractEnd || null,
          elevator_count: selectedRows.length || addForm.elevatorCount || 0,
          team: teamToSave,
          manager_name: addForm.managerName || '',
          memo: addForm.memo || '',
          password: addForm.password || '',
          maintenance_fee: addForm.maintenanceFee || 0,
          source: 'team',
          company_id: userInfo.companyId,
          created_by: userInfo.uid,
          created_at: new Date().toISOString(),
        })
        .select('id')
        .single();

      if (error) throw error;

      if (!coords && addForm.address) {
        console.warn('좌표를 찾지 못했습니다. 지도에 표시되지 않을 수 있어요:', addForm.address);
      }

      if (newSite?.id && selectedRows.length > 0) {
        const elevatorRows = selectedRows.map((r) => ({
          site_id: newSite.id,
          company_id: userInfo.companyId,
          elevator_no: r.elevator_no,
          dong: r.dong,
          hogi_no: r.hogi_no,
          unit_number: r.hogi_no,
          building: r.building,
          installation_place: r.installation_place,
          type: r.type,
          model: r.elvtr_model,
          elvtr_model: r.elvtr_model,
          manufacturer: r.manufacturer_name,
          manufacturer_name: r.manufacturer_name,
          mnt_company: r.mnt_cpny_nm,
          mnt_cpny_nm: r.mnt_cpny_nm,
          sub_company: r.subcntr_cpny,
          subcntr_cpny: r.subcntr_cpny,
          live_load: r.live_load,
          rated_speed: r.rated_speed,
          shuttle_section: r.shuttle_section,
          status: r.status,
          last_result: r.last_result_nm,
          last_result_nm: r.last_result_nm,
          inspection_date: r.exam_date,
          exam_date: r.exam_date,
          install_date: r.install_date,
          main_no: r.main_no,
          road_name: r.road_name,
          created_at: new Date().toISOString(),
        }));

        const { error: elevError } = await supabase.from('elevators').insert(elevatorRows);
        if (elevError) {
          console.error('호기 자동 저장 오류:', elevError);
          alert('현장은 저장됐지만 호기 정보 자동 저장 중 오류가 있었어요.');
        }
      }

      setShowAddModal(false);
      setAddForm({});
      setCacheResults([]);
      setCacheGrouped([]);
      setSelectedCacheKeys(new Set());
      await reloadSites();
    } catch (e) {
      console.error(e);
    } finally {
      setAddLoading(false);
    }
  }

  // ─── 현장 수정 (주소가 바뀌면 좌표도 재계산) ───
  async function handleEditSave() {
    if (!selectedSite || !userInfo?.companyId) return;
    try {
      const addressChanged = (editForm.address || '') !== (selectedSite.address || '');
      const coords = addressChanged && editForm.address
        ? await geocodeAddress(editForm.address)
        : null;

      if (addressChanged && editForm.address && !coords) {
        console.warn('좌표를 찾지 못했습니다. 지도에 표시되지 않을 수 있어요:', editForm.address);
      }

      const { error } = await supabase
        .from('sites')
        .update({
          name: editForm.name,
          address: editForm.address || '',
          ...(addressChanged ? { lat: coords?.lat ?? null, lng: coords?.lng ?? null } : {}),
          phone: editForm.phone || '',
          emergency_phone: editForm.emergencyPhone || '',
          contract_type: editForm.contractType || '',
          contract_start: editForm.contractStart || null,
          contract_end: editForm.contractEnd || null,
          elevator_count: editForm.elevatorCount || 0,
          team: editForm.teamName || '',
          manager_name: editForm.managerName || '',
          memo: editForm.memo || '',
          password: editForm.password || '',
          maintenance_fee: editForm.maintenanceFee || 0,
          updated_at: new Date().toISOString(),
        })
        .eq('id', selectedSite.id);

      if (error) throw error;

      const updated = {
        ...selectedSite,
        ...editForm,
        ...(addressChanged ? { lat: coords?.lat, lng: coords?.lng } : {}),
      };
      setEditMode(false);
      setSelectedSite(updated);
      setSites(prev => prev.map(s => s.id === selectedSite.id ? updated : s));
    } catch (e) {
      console.error(e);
    }
  }

  // ─── 현장 삭제 ───
  async function handleDeleteSite(siteId: string) {
    if (!userInfo?.companyId) return;
    if (!confirm('현장을 삭제할까요?')) return;
    try {
      const { error } = await supabase
        .from('sites')
        .delete()
        .eq('id', siteId);

      if (error) throw error;

      setSelectedSite(null);
      setSites(prev => prev.filter(s => s.id !== siteId));
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

  // 테이블 컬럼 수 (colSpan용): 현장명,팀,대수,담당자,전화번호,비통번호,계약종류 = 7 (+관리 1)
  const emptyColSpan = canEdit ? 8 : 7;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 헤더 */}
      <header className="bg-white border-b px-4 py-3 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-2">
          <button onClick={() => router.push('/dashboard')} className="text-gray-500 hover:text-gray-700 text-lg">←</button>
          <h1 className="font-bold text-lg">🏢 팀별 현장</h1>
          <span className="text-sm text-gray-400">({filteredSites.length}개)</span>
        </div>
        {canAddSite && (
          <div className="flex gap-2">
            <button
              onClick={() => {
                setAddForm(canEdit ? {} : { teamName: userInfo?.team || '' });
                setCacheResults([]);
                setCacheGrouped([]);
                setSelectedCacheKeys(new Set());
                setShowAddModal(true);
              }}
              className="text-sm bg-blue-500 hover:bg-blue-600 text-white px-3 py-1.5 rounded-lg font-medium"
            >
              + 추가
            </button>
          </div>
        )}
      </header>

      <div className="max-w-7xl mx-auto px-4 py-4">

        {/* 검색 + 필터 */}
        <div className="flex flex-wrap gap-2 mb-3">
          <input
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
            placeholder="현장명, 팀명, 담당자, 전화번호, 비통번호 검색..."
            className="flex-1 min-w-48 border rounded-xl px-3 py-2 text-sm bg-white"
          />
          {canEdit && (
            <>
              <select
                value={selectedTeam}
                onChange={e => setSelectedTeam(e.target.value)}
                className="border rounded-xl px-3 py-2 text-sm bg-white"
              >
                <option value="전체">전체 팀</option>
                {teams.map(t => <option key={t} value={t}>{t}</option>)}
              </select>

              <select
                value={selectedContractType}
                onChange={e => setSelectedContractType(e.target.value)}
                className="border rounded-xl px-3 py-2 text-sm bg-white"
              >
                <option value="전체">전체 계약종류</option>
                {contractTypeOptions.map(c => <option key={c} value={c}>{c}</option>)}
              </select>

              <button
                onClick={() => setGroupByContract(!groupByContract)}
                className={`text-sm px-3 py-2 rounded-xl border ${
                  groupByContract ? 'bg-blue-500 text-white border-blue-500' : 'bg-white text-gray-600'
                }`}
              >
                📂 계약종류별 모아보기
              </button>
            </>
          )}
        </div>

        {/* 테이블 */}
        <div className="bg-white rounded-xl border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px] text-sm table-fixed">

              <thead>
                <tr className="bg-gray-50 border-b">
                  <th className="text-left px-3 py-2.5 font-semibold text-gray-600 whitespace-nowrap w-56">
                    <button onClick={() => handleSort('name')} className="flex items-center hover:text-blue-600">
                      현장명 <SortIcon k="name" />
                    </button>
                  </th>
                  <th className="text-center px-3 py-2.5 font-semibold text-gray-600 whitespace-nowrap w-20">
                    <button onClick={() => handleSort('teamName')} className="flex items-center justify-center hover:text-blue-600">
                      팀 <SortIcon k="teamName" />
                    </button>
                  </th>
                  <th className="text-center px-3 py-2.5 font-semibold text-gray-600 whitespace-nowrap w-16">
                    <button onClick={() => handleSort('elevatorCount')} className="flex items-center justify-center hover:text-blue-600">
                      대수 <SortIcon k="elevatorCount" />
                    </button>
                  </th>
                  <th className="text-center px-3 py-2.5 font-semibold text-gray-600 whitespace-nowrap w-20">담당자</th>
                  <th className="text-center px-3 py-2.5 font-semibold text-gray-600 whitespace-nowrap w-32">전화번호</th>
                  <th className="text-center px-3 py-2.5 font-semibold text-gray-600 whitespace-nowrap w-32">비통번호</th>
                  <th className="text-center px-3 py-2.5 font-semibold text-gray-600 whitespace-nowrap w-28">
                    <button onClick={() => handleSort('contractType')} className="flex items-center justify-center hover:text-blue-600">
                      계약종류 <SortIcon k="contractType" />
                    </button>
                  </th>
                  {canEdit && <th className="text-center px-3 py-2.5 font-semibold text-gray-600 whitespace-nowrap w-16">관리</th>}
                </tr>
              </thead>

              <tbody>
                {filteredSites.length === 0 ? (
                  <tr>
                    <td colSpan={emptyColSpan} className="text-center py-16 text-gray-400">
                      <p className="text-3xl mb-2">🏢</p>
                      {canEdit && selectedTeam !== '전체' ? (
                        <>
                          <p className="text-gray-500">{selectedTeam}에 배정된 현장이 없어요</p>
                          <p className="text-xs mt-1">+ 추가 버튼으로 배정하거나, 기존 현장을 수정해 팀을 바꿀 수 있어요</p>
                        </>
                      ) : (
                        <p>팀별 현장이 없어요</p>
                      )}
                    </td>
                  </tr>
                ) : groupByContract ? (
                  groupKeys.map(key => (
                    <React.Fragment key={key}>
                      <tr className="bg-blue-50 border-b">
                        <td colSpan={emptyColSpan} className="px-3 py-2 font-semibold text-blue-700 text-sm">
                          📂 {key} — {groupedByContract[key].length}개 현장 /{' '}
                          {groupedByContract[key].reduce((sum, s) => sum + (s.elevatorCount || 0), 0)}대 / 보수료{' '}
                          {groupedByContract[key].reduce((sum, s) => sum + (s.maintenanceFee || 0), 0).toLocaleString()}원
                        </td>
                      </tr>
                      {groupedByContract[key].map((site, idx) => (
                        <SiteRow key={site.id} site={site} idx={idx} canEdit={canEdit}
                          onClick={() => handleSiteClick(site)}
                          onDelete={() => handleDeleteSite(site.id)} />
                      ))}
                    </React.Fragment>
                  ))
                ) : (
                  filteredSites.map((site, idx) => (
                    <SiteRow key={site.id} site={site} idx={idx} canEdit={canEdit}
                      onClick={() => handleSiteClick(site)}
                      onDelete={() => handleDeleteSite(site.id)} />
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* 하단 합계 */}
          {filteredSites.length > 0 && (
            <div className="bg-gray-50 border-t px-3 py-2 flex gap-4 text-xs text-gray-500">
              <span>총 <strong className="text-gray-700">{filteredSites.length}</strong>개 현장</span>
              <span>승강기 <strong className="text-gray-700">{filteredElevatorCount}</strong>대</span>
              <span>보수료 <strong className="text-gray-700">{filteredFeeSum.toLocaleString()}</strong>원</span>
            </div>
          )}
        </div>
      </div>

      {/* ─── 현장 추가 모달 ─── */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto p-5">
            <h2 className="font-bold text-lg mb-4">+ 팀별 현장 추가</h2>
            <div className="space-y-3">

              {/* 현장명 */}
              <div>
                <label className="text-sm text-gray-600 mb-0.5 block">현장명 *</label>
                <input
                  type="text"
                  value={addForm.name || ''}
                  onChange={e => setAddForm(prev => ({ ...prev, name: e.target.value }))}
                  className="w-full border rounded-xl px-3 py-2 text-sm"
                />
              </div>

              {/* 주소 + 자동 조회 */}
              <div>
                <label className="text-sm text-gray-600 mb-0.5 block">주소</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={addForm.address || ''}
                    onChange={e => setAddForm(prev => ({ ...prev, address: e.target.value }))}
                    className="flex-1 border rounded-xl px-3 py-2 text-sm"
                    placeholder="도로명주소 또는 건물(아파트)명"
                  />
                  <button
                    type="button"
                    onClick={searchElevatorCache}
                    disabled={cacheSearching}
                    className="px-3 py-2 bg-green-500 hover:bg-green-600 text-white rounded-xl text-sm font-medium whitespace-nowrap disabled:opacity-50"
                  >
                    {cacheSearching ? '조회 중...' : '🔍 자동 조회'}
                  </button>
                </div>

                {cacheResults.length > 0 && (
                  <div className="mt-2 bg-blue-50 rounded-xl p-3 text-sm">
                    <div className="flex items-center justify-between mb-2">
                      <p className="font-medium text-blue-700">
                        ✅ 총 {cacheResults.length}대 조회됨 · <span className="text-green-700">{selectedCacheKeys.size}대 선택됨</span>
                      </p>
                      <div className="flex gap-1">
                        <button type="button" onClick={selectAllCache}
                          className="text-xs bg-white border border-blue-300 text-blue-600 px-2 py-0.5 rounded-full">
                          전체 선택
                        </button>
                        <button type="button" onClick={clearAllCache}
                          className="text-xs bg-white border border-gray-300 text-gray-500 px-2 py-0.5 rounded-full">
                          전체 해제
                        </button>
                      </div>
                    </div>

                    <p className="text-xs text-orange-600 mb-2">
                      ⚠️ 같은 주소에 다른 관리업체 승강기가 섞여 나올 수 있어요. 관리업체명을 확인해서 우리 회사가 관리하는 호기만 체크해주세요.
                    </p>

                    <div className="max-h-60 overflow-y-auto space-y-1 bg-white rounded-lg border border-blue-100 p-1.5">
                      {cacheResults.map((r, idx) => {
                        const key = cacheRowKey(r, idx);
                        const checked = selectedCacheKeys.has(key);
                        return (
                          <label key={key}
                            className={`flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer text-xs ${
                              checked ? 'bg-green-50' : 'hover:bg-gray-50'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleCacheRow(key)}
                              className="shrink-0"
                            />
                            <span className="w-14 shrink-0 font-medium text-gray-700">
                              {r.dong ? `${r.dong}동` : '동 없음'}
                            </span>
                            <span className="w-14 shrink-0 text-gray-600">{r.hogi_no || '-'}호기</span>
                            <span className="flex-1 truncate text-gray-500">{r.mnt_cpny_nm || '관리업체 정보 없음'}</span>
                          </label>
                        );
                      })}
                    </div>

                    {cacheGrouped.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {cacheGrouped.map(g => (
                          <span key={g.dong} className="text-xs bg-white border border-blue-200 px-2 py-0.5 rounded-full text-blue-600">
                            {g.dong} {g.count}대
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {[
                { label: '담당자', field: 'managerName', type: 'text' },
                { label: '전화번호', field: 'phone', type: 'text' },
                { label: '비통번호', field: 'emergencyPhone', type: 'text' },
                { label: '승강기 대수', field: 'elevatorCount', type: 'number' },
                { label: '비밀번호', field: 'password', type: 'text' },
                { label: '보수료(원)', field: 'maintenanceFee', type: 'number' },
                { label: '메모', field: 'memo', type: 'text' },
              ].map(({ label, field, type }) => (
                <div key={field}>
                  <label className="text-sm text-gray-600 mb-0.5 block">{label}</label>
                  <input
                    type={type}
                    value={(addForm as Record<string, unknown>)[field] as string || ''}
                    onChange={e => setAddForm(prev => ({
                      ...prev,
                      [field]: type === 'number' ? Number(e.target.value) : e.target.value,
                    }))}
                    className="w-full border rounded-xl px-3 py-2 text-sm"
                  />
                </div>
              ))}

              <div>
                <label className="text-sm text-gray-600 mb-0.5 block">계약종류</label>
                <select
                  value={addForm.contractType || ''}
                  onChange={e => setAddForm(prev => ({ ...prev, contractType: e.target.value }))}
                  className="w-full border rounded-xl px-3 py-2 text-sm"
                >
                  <option value="">선택 안 함</option>
                  {CONTRACT_TYPES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>

              {/* 계약 기간 */}
              <div>
                <label className="text-sm text-gray-600 mb-0.5 block">계약 기간</label>
                <div className="flex items-center gap-2">
                  <input
                    type="date"
                    value={addForm.contractStart || ''}
                    onChange={e => setAddForm(prev => ({ ...prev, contractStart: e.target.value }))}
                    className="flex-1 border rounded-xl px-3 py-2 text-sm"
                  />
                  <span className="text-gray-400 text-sm">~</span>
                  <input
                    type="date"
                    value={addForm.contractEnd || ''}
                    onChange={e => setAddForm(prev => ({ ...prev, contractEnd: e.target.value }))}
                    className="flex-1 border rounded-xl px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="text-sm text-gray-600 mb-0.5 block">팀 배정</label>
                {canEdit ? (
                  <select
                    value={addForm.teamName || ''}
                    onChange={e => setAddForm(prev => ({ ...prev, teamName: e.target.value }))}
                    className="w-full border rounded-xl px-3 py-2 text-sm"
                  >
                    <option value="">팀 미배정</option>
                    {teams.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={userInfo?.team || ''}
                    disabled
                    className="w-full border rounded-xl px-3 py-2 text-sm bg-gray-100 text-gray-500"
                  />
                )}
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => {
                  setShowAddModal(false);
                  setAddForm({});
                  setCacheResults([]);
                  setCacheGrouped([]);
                  setSelectedCacheKeys(new Set());
                }}
                className="flex-1 py-2 border rounded-xl text-sm text-gray-600"
              >
                취소
              </button>
              <button onClick={handleAddSite} disabled={addLoading}
                className="flex-1 py-2 bg-blue-500 text-white rounded-xl text-sm font-medium disabled:opacity-50">
                {addLoading ? '저장 중...' : '저장'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── 현장 상세 모달 ─── */}
      {selectedSite && (() => {
        const isOwnTeamSite = hasTeam && selectedSite.teamName === userInfo?.team;
        const canManageThisSite = canEdit || isOwnTeamSite;
        return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-lg">{selectedSite.name}</h2>
              <button onClick={() => { setSelectedSite(null); setExpandedElevatorId(null); }} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>

            </div>

            {!editMode ? (
              <>
                <div className="space-y-1.5 text-sm">
                  {[
                    { label: '배정 팀', value: selectedSite.teamName },
                    { label: '담당자', value: selectedSite.managerName },
                    { label: '전화번호', value: selectedSite.phone },
                    { label: '비통번호', value: selectedSite.emergencyPhone },
                    { label: '계약종류', value: selectedSite.contractType },
                    {
                      label: '계약 기간',
                      value: (selectedSite.contractStart || selectedSite.contractEnd)
                        ? `${selectedSite.contractStart || '?'} ~ ${selectedSite.contractEnd || '?'}`
                        : undefined,
                    },
                    { label: '승강기 대수', value: selectedSite.elevatorCount ? `${selectedSite.elevatorCount}대` : undefined },
                    { label: '주소', value: selectedSite.address },
                    { label: '메모', value: selectedSite.memo },
                    { label: '보수료', value: selectedSite.maintenanceFee ? `${selectedSite.maintenanceFee.toLocaleString()}원` : undefined },
                  ].filter(i => i.value).map(({ label, value }) => (
                    <div key={label} className="flex justify-between py-1.5 border-b last:border-0">
                      <span className="text-gray-500">{label}</span>
                      <span className="font-medium text-gray-800">{value}</span>
                    </div>
                  ))}

                  {selectedSite.password && (
                    <div className="flex justify-between items-center py-1.5 border-b last:border-0">
                      <span className="text-gray-500">비밀번호</span>
                      <span className="flex items-center gap-2">
                        <span className="font-medium text-gray-800">
                          {showSitePassword ? selectedSite.password : '•'.repeat(selectedSite.password.length)}
                        </span>
                        <button
                          type="button"
                          onClick={() => setShowSitePassword(prev => !prev)}
                          className="text-xs text-blue-500 hover:underline"
                        >
                          {showSitePassword ? '숨기기' : '표시'}
                        </button>
                      </span>
                    </div>
                  )}

                  {!selectedSite.lat && selectedSite.address && (
                    <p className="text-xs text-orange-500 pt-1">⚠️ 좌표가 없어 지도에 표시되지 않아요. 수정 후 저장하면 다시 시도돼요.</p>
                  )}
                </div>

                {/* 호기 목록 */}
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
      {siteElevators.map(elev => {
        const isOpen = expandedElevatorId === elev.id;
        return (
          <div key={elev.id} className="bg-gray-50 rounded-xl overflow-hidden">
            <button
              type="button"
              onClick={() => setExpandedElevatorId(isOpen ? null : elev.id)}
              className="w-full px-3 py-2 text-sm flex justify-between items-center"
            >
              <span className="font-medium text-left">
                {elev.dong ? `${elev.dong} ` : ''}{elev.hogiNo || elev.id}
              </span>
              <span className="flex items-center gap-2">
                <span className="text-gray-500 text-xs">{elev.type || '-'}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full ${
                  elev.status === '정상' ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'
                }`}>
                  {elev.status || '-'}
                </span>
                <span className="text-gray-400">{isOpen ? '▲' : '▼'}</span>
              </span>
            </button>

            {isOpen && (
              <div className="px-3 pb-3 pt-1 text-xs text-gray-600 space-y-1 border-t border-gray-200">
                {[
                  { label: '모델', value: elev.model },
                  { label: '제조사', value: elev.manufacturer },
                  { label: '관리업체', value: elev.mntCompany },
                  { label: '하도급업체', value: elev.subCompany },
                  { label: '정원/적재하중', value: elev.liveLoad },
                  { label: '정격속도', value: elev.ratedSpeed },
                  { label: '운행구간', value: elev.shuttleSection },
                  { label: '설치장소', value: elev.installationPlace },
                  { label: '설치일', value: elev.installDate },
                  { label: '최근 검사일', value: elev.inspectionDate },
                  { label: '최근 검사결과', value: elev.lastResult },
                ].filter(i => i.value).map(({ label, value }) => (
                  <div key={label} className="flex justify-between py-0.5">
                    <span className="text-gray-400">{label}</span>
                    <span className="font-medium text-gray-700">{value}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  )}
</div>



                {canManageThisSite && (
                  <div className="flex gap-2 mt-4">
                    {canEdit && (
                      <button onClick={() => handleDeleteSite(selectedSite.id)}
                        className="flex-1 py-2 border border-red-300 text-red-500 rounded-xl text-sm">삭제</button>
                    )}
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
                    { label: '담당자', field: 'managerName', type: 'text' },
                    { label: '전화번호', field: 'phone', type: 'text' },
                    { label: '비통번호', field: 'emergencyPhone', type: 'text' },
                    { label: '승강기 대수', field: 'elevatorCount', type: 'number' },
                    { label: '비밀번호', field: 'password', type: 'text' },
                    { label: '보수료(원)', field: 'maintenanceFee', type: 'number' },
                    { label: '메모', field: 'memo', type: 'text' },
                  ].map(({ label, field, type }) => (
                    <div key={field}>
                      <label className="text-sm text-gray-600 mb-0.5 block">{label}</label>
                      <input
                        type={type}
                        value={(editForm as Record<string, unknown>)[field] as string || ''}
                        onChange={e => setEditForm(prev => ({
                          ...prev,
                          [field]: type === 'number' ? Number(e.target.value) : e.target.value,
                        }))}
                        className="w-full border rounded-xl px-3 py-2 text-sm"
                      />
                    </div>
                  ))}

                  <div>
                    <label className="text-sm text-gray-600 mb-0.5 block">계약종류</label>
                    <select
                      value={editForm.contractType || ''}
                      onChange={e => setEditForm(prev => ({ ...prev, contractType: e.target.value }))}
                      className="w-full border rounded-xl px-3 py-2 text-sm"
                    >
                      <option value="">선택 안 함</option>
                      {CONTRACT_TYPES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>

                  {/* 계약 기간 */}
                  <div>
                    <label className="text-sm text-gray-600 mb-0.5 block">계약 기간</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="date"
                        value={editForm.contractStart || ''}
                        onChange={e => setEditForm(prev => ({ ...prev, contractStart: e.target.value }))}
                        className="flex-1 border rounded-xl px-3 py-2 text-sm"
                      />
                      <span className="text-gray-400 text-sm">~</span>
                      <input
                        type="date"
                        value={editForm.contractEnd || ''}
                        onChange={e => setEditForm(prev => ({ ...prev, contractEnd: e.target.value }))}
                        className="flex-1 border rounded-xl px-3 py-2 text-sm"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-sm text-gray-600 mb-0.5 block">팀 배정</label>
                    {canEdit ? (
                      <select
                        value={editForm.teamName || ''}
                        onChange={e => setEditForm(prev => ({ ...prev, teamName: e.target.value }))}
                        className="w-full border rounded-xl px-3 py-2 text-sm"
                      >
                        <option value="">팀 미배정</option>
                        {teams.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    ) : (
                      <input
                        type="text"
                        value={editForm.teamName || ''}
                        disabled
                        className="w-full border rounded-xl px-3 py-2 text-sm bg-gray-100 text-gray-500"
                      />
                    )}
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
        );
      })()}
    </div>
  );
}

// ─── 현장 행 컴포넌트 (일반 목록 / 그룹 목록 공통 사용) ───
function SiteRow({
  site, idx, canEdit, onClick, onDelete,
}: {
  site: SiteItem;
  idx: number;
  canEdit: boolean;
  onClick: () => void;
  onDelete: () => void;
}) {
  return (
    <tr
      onClick={onClick}
      className={`border-b last:border-0 cursor-pointer hover:bg-blue-50 transition-colors ${idx % 2 === 0 ? '' : 'bg-gray-50/50'}`}
    >
      <td className="px-3 py-2.5 font-medium text-gray-800 whitespace-normal break-words leading-snug">{site.name}</td>

      <td className="px-3 py-2.5 text-center whitespace-nowrap">
        {site.teamName ? (
          <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">{site.teamName}</span>
        ) : '-'}
      </td>
      <td className="px-3 py-2.5 text-center text-gray-600 whitespace-nowrap">
        {site.elevatorCount ? `${site.elevatorCount}대` : '-'}
      </td>
      <td className="px-3 py-2.5 text-center text-gray-600 whitespace-normal break-words">{site.managerName || '-'}</td>
      <td className="px-3 py-2.5 text-center text-gray-600 whitespace-normal break-words">{site.phone || '-'}</td>
      <td className="px-3 py-2.5 text-center text-gray-600 whitespace-normal break-words">{site.emergencyPhone || '-'}</td>

      <td className="px-3 py-2.5 text-center whitespace-nowrap">
        {site.contractType ? (
          <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-medium">{site.contractType}</span>
        ) : '-'}
      </td>

      {canEdit && (
        <td className="px-3 py-2.5 text-center" onClick={e => e.stopPropagation()}>
          <button
            onClick={onDelete}
            className="text-xs text-red-400 hover:text-red-600 px-2 py-1 rounded hover:bg-red-50"
          >
            삭제
          </button>
        </td>
      )}
    </tr>
  );
}
