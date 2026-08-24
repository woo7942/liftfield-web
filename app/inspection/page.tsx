'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
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

interface InspectionRow {
  id?: string;
  siteId: string;
  completed: boolean;
  note: string;
  completedBy?: string;
  completedAt?: string;
}

const MONTHS = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];

export default function InspectionPage() {
  const router = useRouter();
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  const [teams, setTeams] = useState<Team[]>([]);
  const [sites, setSites] = useState<SiteRow[]>([]);
  const [filterTeam, setFilterTeam] = useState('전체');

  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);

  const [inspectionMap, setInspectionMap] = useState<Record<string, InspectionRow>>({});

  const [mapReady, setMapReady] = useState(false);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapObjRef = useRef<any>(null);
  const overlaysRef = useRef<any[]>([]);

  const [selectedSite, setSelectedSite] = useState<SiteRow | null>(null);
  const [panelChecked, setPanelChecked] = useState(false);
  const [panelNote, setPanelNote] = useState('');
  const [panelSaving, setPanelSaving] = useState(false);

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

  // ── 팀 목록 (운영자만 조회, 필터용) ──────────
  useEffect(() => {
    if (!userInfo || !isAdmin) return;
    const loadTeams = async () => {
      const { data } = await supabase.from('teams')
        .select('id, name').eq('company_id', userInfo.companyId).order('name');
      setTeams((data || []).map((t: any) => ({ id: t.id, name: t.name || '' })));
    };
    loadTeams();
  }, [userInfo, isAdmin]);

  // ── 현장 목록 (운영자=전체 / 팀원=본인 팀만) ──
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
        name: s.site_name || s.name || '',
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

  const filteredSites = isAdmin && filterTeam !== '전체'
    ? sites.filter(s => s.team === filterTeam)
    : sites;

  // ── 선택된 월의 점검 기록 로드 ────────────────
  const loadInspections = useCallback(async () => {
    if (!userInfo) return;
    const { data, error } = await supabase
      .from('site_inspections')
      .select('*')
      .eq('company_id', userInfo.companyId)
      .eq('year', year)
      .eq('month', month);
    if (error) { console.error(error); return; }
    const map: Record<string, InspectionRow> = {};
    (data || []).forEach((r: any) => {
      map[r.site_id] = {
        id: r.id,
        siteId: r.site_id,
        completed: r.completed,
        note: r.note || '',
        completedBy: r.completed_by,
        completedAt: r.completed_at,
      };
    });
    setInspectionMap(map);
  }, [userInfo, year, month]);

  useEffect(() => { loadInspections(); }, [loadInspections]);

  // ── 카카오맵 SDK 스크립트 로드 ────────────────
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const w = window as any;
    if (w.kakao && w.kakao.maps) { setMapReady(true); return; }
    const script = document.createElement('script');
    script.src = `//dapi.kakao.com/v2/maps/sdk.js?appkey=${process.env.NEXT_PUBLIC_KAKAO_MAP_KEY}&autoload=false`;
    script.onload = () => { w.kakao.maps.load(() => setMapReady(true)); };
    document.head.appendChild(script);
  }, []);

  // ── 지도 최초 1회 생성 ────────────────────────
  useEffect(() => {
    if (!mapReady || !mapContainerRef.current || mapObjRef.current) return;
    const w = window as any;
    mapObjRef.current = new w.kakao.maps.Map(mapContainerRef.current, {
      center: new w.kakao.maps.LatLng(36.5, 127.8),
      level: 12,
    });
  }, [mapReady]);

  // ── 현장이나 점검현황이 바뀔 때마다 마커 갱신 ──
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

      const done = !!inspectionMap[site.id]?.completed;
      const color = done ? '#22c55e' : '#94a3b8';

      const el = document.createElement('div');
      el.style.cursor = 'pointer';
      el.style.display = 'flex';
      el.style.flexDirection = 'column';
      el.style.alignItems = 'center';
      el.innerHTML = `
        <div style="background:${color};color:#fff;font-size:11px;font-weight:700;padding:4px 9px;border-radius:9999px;white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,.3);">
          ${done ? '✅ ' : ''}${site.name}
        </div>
        <div style="width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-top:7px solid ${color};margin-top:-1px;"></div>
      `;
      el.addEventListener('click', () => {
        setSelectedSite(site);
        setPanelChecked(!!inspectionMap[site.id]?.completed);
        setPanelNote(inspectionMap[site.id]?.note || '');
      });

      const overlay = new w.kakao.maps.CustomOverlay({
        position,
        content: el,
        yAnchor: 1.3,
      });
      overlay.setMap(mapObjRef.current);
      overlaysRef.current.push(overlay);
    });

    mapObjRef.current.setBounds(bounds);
  }, [mapReady, filteredSites, inspectionMap]);

  // ── 점검 상태 + 비고 저장 ─────────────────────
  const savePanel = async () => {
    if (!selectedSite || !userInfo) return;
    setPanelSaving(true);
    try {
      const payload = {
        company_id: userInfo.companyId,
        site_id: selectedSite.id,
        year, month,
        completed: panelChecked,
        note: panelNote.trim(),
        completed_by: panelChecked ? userInfo.name : null,
        completed_at: panelChecked ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      };
      const { error } = await supabase
        .from('site_inspections')
        .upsert(payload, { onConflict: 'site_id,year,month' });
      if (error) throw error;
      await loadInspections();
      setSelectedSite(null);
    } catch (e: any) {
      alert('저장 실패: ' + e.message);
    } finally {
      setPanelSaving(false);
    }
  };

  const prevMonth = () => { if (month === 1) { setYear(y => y - 1); setMonth(12); } else setMonth(m => m - 1); };
  const nextMonth = () => { if (month === 12) { setYear(y => y + 1); setMonth(1); } else setMonth(m => m + 1); };

  const stats = {
    total: filteredSites.length,
    done: filteredSites.filter(s => inspectionMap[s.id]?.completed).length,
  };
  const rate = stats.total > 0 ? Math.round(stats.done / stats.total * 100) : 0;

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
        {/* 통계 + 팀 필터 */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-2">
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm px-4 py-2 text-sm">
              전체 <strong className="text-gray-800">{stats.total}</strong>곳
            </div>
            <div className="bg-green-50 rounded-xl border border-green-100 shadow-sm px-4 py-2 text-sm text-green-700">
              완료 <strong>{stats.done}</strong>곳 ({rate}%)
            </div>
          </div>
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
        </div>

        {/* 지도 */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div ref={mapContainerRef} style={{ width: '100%', height: '65vh' }} />
        </div>
        <p className="text-xs text-gray-400 text-center">
          🟢 이번 달 점검완료 · ⚪ 미점검 &nbsp;|&nbsp; 현장 마커를 클릭하면 점검 처리를 할 수 있어요.
        </p>
      </main>

      {/* ── 현장 상세 / 점검 처리 패널 ── */}
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

              <div className="bg-gray-50 rounded-xl p-4">
                <p className="text-xs font-bold text-gray-500 mb-2">{year}년 {MONTHS[month - 1]} 점검 상태</p>
                <button
                  type="button"
                  onClick={() => setPanelChecked(v => !v)}
                  className={`w-full py-3 rounded-xl font-bold text-sm transition ${
                    panelChecked
                      ? 'bg-green-500 text-white'
                      : 'bg-white text-gray-500 border-2 border-dashed border-gray-300'
                  }`}
                >
                  {panelChecked ? '✅ 점검완료' : '점검완료로 표시하기'}
                </button>
                {inspectionMap[selectedSite.id]?.completedBy && panelChecked && (
                  <p className="text-xs text-gray-400 mt-2">
                    {inspectionMap[selectedSite.id]?.completedBy} ·{' '}
                    {(inspectionMap[selectedSite.id]?.completedAt || '').slice(0, 16).replace('T', ' ')}
                  </p>
                )}
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
