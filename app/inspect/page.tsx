'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

const SERVICE_KEY = '4c4e8677cc42223329b997aee1cbc0dffa8cd337ecb0e8c47364825dc2c76577';

const getTag = (xml: string, tag: string) =>
  xml.match(new RegExp(`<${tag}>(.*?)<\/${tag}>`))?.[1] || '';
const getItems = (xml: string) =>
  xml.match(/<item>[\s\S]*?<\/item>/g) || [];
const fmtYmd = (d: string) =>
  d ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : '';

interface UserInfo {
  uid: string;
  name: string;
  companyId: string;
  role: string;
  superAdmin?: boolean;
  team?: string;
}

interface Site {
  id: string;
  siteName?: string;
  name?: string;
  source?: string;
  teamName?: string;
}

interface Elevator {
  id: string;
  hogiNo?: string | number;
  elevatorNo?: string;
  dong?: string;
  installationPlace?: string;
}

export default function InspectPage() {
  const router = useRouter();
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(true);

  // 현장 검색
  const [sites, setSites] = useState<Site[]>([]);
  const [siteSearch, setSiteSearch] = useState('');
  const [selectedSite, setSelectedSite] = useState<Site | null>(null);

  // 호기 목록
  const [elevators, setElevators] = useState<Elevator[]>([]);
  const [elevsLoading, setElevsLoading] = useState(false);

  // 검사 상세
  const [selectedElev, setSelectedElev] = useState<Elevator | null>(null);
  const [apiLoading, setApiLoading] = useState(false);
  const [history, setHistory] = useState<any[]>([]);
  const [failList, setFailList] = useState<any[]>([]);
  const [apiError, setApiError] = useState('');
  const [memos, setMemos] = useState<{
    [key: string]: { memo: string; status: string; docId?: string };
  }>({});
  const [savingKey, setSavingKey] = useState('');

  // 데이터 출처(캐시 or API) 표시용
  const [dataSource, setDataSource] = useState<'cache' | 'api' | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);

  // ── 인증 ──
  useEffect(() => {
    const loadUser = async (uid: string) => {
      try {
        const { data: userData, error: userError } = await supabase
          .from('users')
          .select('name, company_id, role, super_admin, team')
          .eq('id', uid)
          .single();

        if (userError || !userData) {
          router.push('/login');
          return;
        }

        const info: UserInfo = {
          uid,
          name: userData.name || '',
          companyId: userData.company_id || '',
          role: userData.role || 'member',
          superAdmin: userData.super_admin || false,
          team: userData.team || '',
        };
        setUserInfo(info);

        // 현장 목록 로드 — source='team' 팀별현장만
        const { data: allSites, error: sitesError } = await supabase
          .from('sites')
          .select('id, site_name, name, source, team')
          .eq('company_id', userData.company_id)
          .eq('source', 'team');

        if (sitesError) throw sitesError;

        const mapped: Site[] = (allSites || []).map((s: any) => ({
          id: s.id,
          siteName: s.site_name,
          name: s.name,
          source: s.source,
          teamName: s.team,
        }));

        const isAdmin =
          userData.role === 'admin' || userData.super_admin === true;

        if (isAdmin) {
          setSites(mapped);
        } else {
          setSites(
            mapped.filter(
              (s) =>
                s.teamName === userData.team
            )
          );
        }
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };

    // 현재 세션 확인
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        router.push('/login');
        setLoading(false);
        return;
      }
      loadUser(session.user.id);
    });

    // 인증 상태 변경 구독
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (!session) {
          router.push('/login');
        }
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  // ── 현장 클릭 → 호기 로드 ──
  const handleSiteClick = async (site: Site) => {
    setSelectedSite(site);
    setSiteSearch('');
    setSelectedElev(null);
    setElevators([]);
    setElevsLoading(true);
    try {
      const { data, error } = await supabase
        .from('elevators')
        .select('id, hogi_no, elevator_no, dong, installation_place')
        .eq('site_id', site.id)
        .eq('company_id', userInfo!.companyId);

      if (error) throw error;

      setElevators(
        (data || []).map((e: any) => ({
          id: e.id,
          hogiNo: e.hogi_no,
          elevatorNo: e.elevator_no,
          dong: e.dong,
          installationPlace: e.installation_place,
        }))
      );
    } catch (e) {
      console.error(e);
    } finally {
      setElevsLoading(false);
    }
  };

  // ── 검사 데이터 자동 저장 (원본 이력 + 부적합 상세) ──
  const saveInspectionData = async (
    elev: Elevator,
    histData: any[],
    allFails: any[]
  ) => {
    if (!userInfo) return;
    try {
      const { data: existingRows } = await supabase
        .from('safety_inspections')
        .select('id, inspct_de')
        .eq('company_id', userInfo.companyId)
        .eq('elevator_id', elev.id);

      const existingMap: Record<string, string> = {};
      (existingRows || []).forEach((r: any) => {
        existingMap[r.inspct_de] = r.id;
      });

      for (const h of histData) {
        const fails = allFails
          .filter((f) => f.examYmd === h.inspctDe)
          .map(({ examYmd, ...rest }) => rest);

        const payload = {
          company_id: userInfo.companyId,
          site_id: selectedSite?.id || '',
          site_name: selectedSite?.siteName || selectedSite?.name || '',
          elevator_id: elev.id,
          hogi_no: String(elev.hogiNo || ''),
          elevator_no: elev.elevatorNo || '',
          inspct_de: h.inspctDe,
          inspct_kind_nm: h.inspctKindNm || '',
          disp_words: h.dispWords || '',
          fail_cd: h.failCd || '',
          fail_detail: fails,
          inspct_instt_nm: h.inspctInsttNm || '',
          applc_be_dt: h.applcBeDt || '',
          applc_en_dt: h.applcEnDt || '',
          updated_at: new Date().toISOString(),
        };

        const existingId = existingMap[h.inspctDe];
        if (existingId) {
          await supabase
            .from('safety_inspections')
            .update(payload)
            .eq('id', existingId);
        } else {
          await supabase.from('safety_inspections').insert({
            ...payload,
            user_memo: '',
            status: '미대응',
            created_at: new Date().toISOString(),
          });
        }
      }
    } catch (e) {
      console.error('검사 데이터 자동 저장 실패', e);
    }
  };

  // ── 호기 클릭 → 저장된 데이터 우선 조회, 없으면 API 조회 ──
  const handleElevClick = async (elev: Elevator, forceRefresh = false) => {
    if (!elev.elevatorNo) {
      alert('승강기번호가 없어 검사이력을 조회할 수 없습니다.');
      return;
    }
    setSelectedElev(elev);
    setApiLoading(true);
    setHistory([]);
    setFailList([]);
    setApiError('');
    setMemos({});
    setDataSource(null);
    setLastSyncedAt(null);

    try {
      // 1) 저장된 데이터 우선 조회 (새로고침이 아닐 때만)
      if (!forceRefresh) {
        const { data: cachedRows, error: cacheError } = await supabase
          .from('safety_inspections')
          .select('*')
          .eq('company_id', userInfo!.companyId)
          .eq('elevator_id', elev.id)
          .order('inspct_de', { ascending: false })
          .limit(5);

        if (cacheError) throw cacheError;

        if (cachedRows && cachedRows.length > 0) {
          const histData = cachedRows.map((row: any) => ({
            inspctDe: row.inspct_de,
            inspctKindNm: row.inspct_kind_nm,
            dispWords: row.disp_words,
            inspctInsttNm: row.inspct_instt_nm || '',
            applcBeDt: row.applc_be_dt || '',
            applcEnDt: row.applc_en_dt || '',
            failCd: row.fail_cd,
          }));

          const allFails: any[] = [];
          const memoMap: typeof memos = {};
          cachedRows.forEach((row: any) => {
            memoMap[`${elev.id}_${row.inspct_de}`] = {
              memo: row.user_memo || '',
              status: row.status || '미대응',
              docId: row.id,
            };
            if (row.fail_detail && Array.isArray(row.fail_detail)) {
              row.fail_detail.forEach((f: any) =>
                allFails.push({ ...f, examYmd: row.inspct_de })
              );
            }
          });

          setHistory(histData);
          setFailList(allFails);
          setMemos(memoMap);
          setDataSource('cache');
          setLastSyncedAt(cachedRows[0].updated_at || null);
          setApiLoading(false);
          return; // 저장된 데이터가 있으면 API 호출 없이 종료
        }
      }

      // 2) 저장된 데이터가 없거나 새로고침 요청 → 공공 API 호출
      const histRes = await fetch(
        `https://apis.data.go.kr/B553664/ElevatorInspectsafeService/getInspectsafeList` +
          `?serviceKey=${SERVICE_KEY}&elevator_no=${elev.elevatorNo}&numOfRows=50&pageNo=1`
      );
      const histText = await histRes.text();
      const histData = getItems(histText)
        .map((xml) => ({
          inspctDe: getTag(xml, 'inspctDe'),
          inspctKindNm: getTag(xml, 'inspctKindNm'),
          dispWords: getTag(xml, 'dispWords'),
          inspctInsttNm: getTag(xml, 'inspctInsttNm'),
          applcBeDt: getTag(xml, 'applcBeDt'),
          applcEnDt: getTag(xml, 'applcEnDt'),
          failCd: getTag(xml, 'failCd'),
        }))
        .filter((h) => h.inspctDe)
        .sort((a, b) => b.inspctDe.localeCompare(a.inspctDe))
        .slice(0, 5);
      setHistory(histData);

      // 부적합 목록 조회
      const allFails: any[] = [];
      for (const h of histData.filter((h) => h.failCd)) {
        const failRes = await fetch(
          `https://apis.data.go.kr/B553664/ElevatorInspectsafeService/getInspectFailList` +
            `?serviceKey=${SERVICE_KEY}&fail_cd=${h.failCd}&numOfRows=50&pageNo=1`
        );
        const failText = await failRes.text();
        getItems(failText).forEach((xml) =>
          allFails.push({
            examYmd: h.inspctDe,
            standardArticle: getTag(xml, 'standardArticle'),
            standardTitle1: getTag(xml, 'standardTitle1'),
            failDesc: getTag(xml, 'failDesc'),
            failDescInspector: getTag(xml, 'failDescInspector'),
          })
        );
      }
      setFailList(allFails);
      setDataSource('api');
      setLastSyncedAt(new Date().toISOString());

      // 3) 조회 결과 자동 저장 (메모를 남기지 않아도 원본 데이터는 저장)
      await saveInspectionData(elev, histData, allFails);

      // 저장 후 docId 매핑을 위해 다시 조회
      const { data: savedRows } = await supabase
        .from('safety_inspections')
        .select('id, inspct_de, user_memo, status')
        .eq('company_id', userInfo!.companyId)
        .eq('elevator_id', elev.id);

      const memoMap: typeof memos = {};
      (savedRows || []).forEach((row: any) => {
        memoMap[`${elev.id}_${row.inspct_de}`] = {
          memo: row.user_memo || '',
          status: row.status || '미대응',
          docId: row.id,
        };
      });
      setMemos(memoMap);
    } catch (e: any) {
      setApiError(`조회 실패: ${e.message}`);
    } finally {
      setApiLoading(false);
    }
  };

  // ── 메모 저장 ──
  const saveMemo = async (h: any) => {
    if (!selectedElev || !userInfo) return;
    const key = `${selectedElev.id}_${h.inspctDe}`;
    const current = memos[key] || { memo: '', status: '미대응' };
    setSavingKey(key);

    try {
      const payload = {
        company_id: userInfo.companyId,
        site_id: selectedSite?.id || '',
        site_name: selectedSite?.siteName || selectedSite?.name || '',
        elevator_id: selectedElev.id,
        hogi_no: String(selectedElev.hogiNo || ''),
        elevator_no: selectedElev.elevatorNo || '',
        inspct_de: h.inspctDe,
        inspct_kind_nm: h.inspctKindNm || '',
        disp_words: h.dispWords || '',
        fail_cd: h.failCd || '',
        user_memo: current.memo,
        status: current.status,
        updated_at: new Date().toISOString(),
      };

      if (current.docId) {
        // 기존 레코드 수정
        const { error } = await supabase
          .from('safety_inspections')
          .update(payload)
          .eq('id', current.docId);
        if (error) throw error;
      } else {
        // 신규 레코드 삽입
        const { data: newRow, error } = await supabase
          .from('safety_inspections')
          .insert({ ...payload, created_at: new Date().toISOString() })
          .select('id')
          .single();
        if (error) throw error;
        setMemos((prev) => ({
          ...prev,
          [key]: { ...current, docId: newRow.id },
        }));
      }
      alert('✅ 저장 완료');
    } catch (e: any) {
      alert(`❌ 저장 실패: ${e.message}`);
    } finally {
      setSavingKey('');
    }
  };

  const updateMemo = (
    key: string,
    field: 'memo' | 'status',
    value: string
  ) => {
    setMemos((prev) => ({
      ...prev,
      [key]: { ...(prev[key] || { memo: '', status: '미대응' }), [field]: value },
    }));
  };

  const filteredSites =
    siteSearch.trim().length >= 1
      ? sites
          .filter((s) =>
            (s.siteName || s.name || '')
              .toLowerCase()
              .includes(siteSearch.toLowerCase())
          )
          .slice(0, 20)
      : sites.slice(0, 20);

  if (loading)
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-gray-500">로딩 중...</p>
      </div>
    );

  return (
    <div className="min-h-screen bg-gray-50 print:bg-white">
      {/* 헤더 */}
      <header className="bg-white border-b px-4 py-3 flex items-center gap-2 sticky top-0 z-10 print:hidden">
        <button
          onClick={() => router.push('/dashboard')}
          className="text-gray-500 hover:text-gray-700 text-lg"
        >
          ←
        </button>
        <h1 className="font-bold text-lg">🔍 검사 지적사항</h1>
        {selectedSite && (
          <span className="text-sm text-gray-400 ml-1">
            / {selectedSite.siteName || selectedSite.name}
          </span>
        )}
        {selectedElev && (
          <span className="text-sm text-gray-400">
            / {selectedElev.hogiNo}호기
          </span>
        )}
      </header>

      <div className="max-w-5xl mx-auto px-4 py-4 print:px-0 print:py-0 print:max-w-none">
        {/* ── 현장 검색 ── */}
        {!selectedSite && (
          <div className="max-w-xl mx-auto mt-8">
            <p className="text-gray-500 text-sm mb-3 text-center">
              팀별현장 목록에서 검사이력을 조회할 현장을 선택하세요
            </p>
            <div className="relative">
              <input
                value={siteSearch}
                onChange={(e) => setSiteSearch(e.target.value)}
                placeholder="🔍 현장명 검색..."
                className="w-full border rounded-xl px-4 py-3 text-sm bg-white shadow-sm
                           focus:outline-none focus:ring-2 focus:ring-blue-300"
              />
              {siteSearch && (
                <button
                  onClick={() => setSiteSearch('')}
                  className="absolute right-3 top-3 text-gray-400 hover:text-gray-600"
                >
                  ✕
                </button>
              )}
            </div>

            {filteredSites.length > 0 ? (
              <div className="mt-2 bg-white border rounded-xl shadow-sm overflow-hidden">
                {!siteSearch && (
                  <div className="px-4 py-2 bg-gray-50 border-b text-xs text-gray-400">
                    팀별현장 전체 ({sites.length}개)
                  </div>
                )}
                {filteredSites.map((site) => (
                  <button
                    key={site.id}
                    onClick={() => handleSiteClick(site)}
                    className="w-full text-left px-4 py-3 hover:bg-blue-50 border-b
                               last:border-0 text-sm font-medium text-gray-700 transition-colors"
                  >
                    🏢 {site.siteName || site.name}
                  </button>
                ))}
              </div>
            ) : (
              <div className="mt-4 text-center text-gray-400 text-sm py-8 bg-white border rounded-xl">
                {siteSearch
                  ? '검색 결과가 없습니다'
                  : '팀별현장이 없어요. 팀별현장에서 현장을 등록해 주세요.'}
              </div>
            )}
          </div>
        )}

        {/* ── 현장 선택됨 ── */}
        {selectedSite && (
          <div className="flex gap-4 print:block">
            {/* 왼쪽: 호기 목록 */}
            <div className="w-56 shrink-0 print:hidden">
              <div className="bg-white border rounded-xl overflow-hidden">
                <div className="px-3 py-2.5 border-b bg-gray-50 flex items-center justify-between">
                  <span className="text-sm font-bold text-gray-700">
                    🏢 {selectedSite.siteName || selectedSite.name}
                  </span>
                  <button
                    onClick={() => {
                      setSelectedSite(null);
                      setSelectedElev(null);
                      setElevators([]);
                    }}
                    className="text-xs text-gray-400 hover:text-gray-600"
                  >
                    변경
                  </button>
                </div>

                {elevsLoading ? (
                  <div className="py-8 text-center text-gray-400 text-sm">
                    로딩 중...
                  </div>
                ) : elevators.length === 0 ? (
                  <div className="py-8 text-center text-gray-400 text-sm">
                    호기 없음
                  </div>
                ) : (
                  elevators
                    .sort(
                      (a, b) =>
                        parseInt(
                          String(a.hogiNo || '0').replace(/[^0-9]/g, '') || '0'
                        ) -
                        parseInt(
                          String(b.hogiNo || '0').replace(/[^0-9]/g, '') || '0'
                        )
                    )
                    .map((elev) => (
                      <button
                        key={elev.id}
                        onClick={() => handleElevClick(elev)}
                        className={`w-full text-left px-3 py-2.5 border-b last:border-0 text-sm transition-colors
                          ${
                            selectedElev?.id === elev.id
                              ? 'bg-blue-50 text-blue-700 font-semibold'
                              : 'hover:bg-gray-50 text-gray-700'
                          }`}
                      >
                        <div className="font-medium">
                          {elev.dong ? `${elev.dong} ` : ''}
                          {String(elev.hogiNo || '').replace(/[^0-9]/g, '')}호기
                        </div>
                        {elev.installationPlace && (
                          <div className="text-xs text-gray-400">
                            {elev.installationPlace}
                          </div>
                        )}
                        <div className="text-xs text-gray-400">
                          {elev.elevatorNo || '번호없음'}
                        </div>
                      </button>
                    ))
                )}
              </div>
            </div>

            {/* 오른쪽: 검사 상세 */}
            <div className="flex-1">
              {!selectedElev && (
                <div className="bg-white border rounded-xl py-20 text-center text-gray-400">
                  <p className="text-3xl mb-3">🔍</p>
                  <p className="text-sm">왼쪽에서 호기를 선택하세요</p>
                </div>
              )}

              {selectedElev && (
                <div className="bg-white border rounded-xl overflow-hidden print:border-none print:rounded-none">
                  {/* 화면에서만 보이는 헤더 */}
                  <div className="px-4 py-3 bg-purple-50 border-b flex items-center justify-between print:hidden">
                    <div>
                      <span className="font-bold text-purple-700">
                        {selectedElev.dong ? `${selectedElev.dong} ` : ''}
                        {String(selectedElev.hogiNo || '').replace(/[^0-9]/g, '')}
                        호기
                      </span>
                      {selectedElev.installationPlace && (
                        <span className="text-sm text-gray-500 ml-2">
                          ({selectedElev.installationPlace})
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-gray-500">
                      승강기번호: {selectedElev.elevatorNo || '없음'}
                    </span>
                  </div>

                  {/* 인쇄 시에만 보이는 제목 */}
                  <div className="hidden print:block px-4 pt-4">
                    <h2 className="text-lg font-bold">
                      {selectedSite?.siteName || selectedSite?.name} ·{' '}
                      {selectedElev.dong ? `${selectedElev.dong} ` : ''}
                      {String(selectedElev.hogiNo || '').replace(/[^0-9]/g, '')}호기 검사이력
                    </h2>
                    <p className="text-xs text-gray-500 mt-1">
                      승강기번호 {selectedElev.elevatorNo || '없음'} · 출력일{' '}
                      {new Date().toLocaleDateString('ko-KR')}
                    </p>
                  </div>

                  <div className="p-4">
                    {apiLoading && (
                      <div className="py-16 text-center print:hidden">
                        <div className="inline-block w-8 h-8 border-4 border-purple-300 border-t-purple-600 rounded-full animate-spin mb-3" />
                        <p className="text-gray-500 text-sm">
                          검사이력 조회 중...
                        </p>
                      </div>
                    )}

                    {apiError && (
                      <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-600 text-sm print:hidden">
                        {apiError}
                      </div>
                    )}

                    {!apiLoading && !apiError && history.length === 0 && (
                      <div className="py-16 text-center text-gray-400 print:hidden">
                        <p className="text-3xl mb-3">📄</p>
                        <p className="text-sm">검사이력이 없습니다</p>
                      </div>
                    )}

                    {/* 데이터 출처 안내 + 새로고침 + PDF 저장 */}
                    {!apiLoading && !apiError && history.length > 0 && dataSource && (
                      <div className="mb-4 flex items-center justify-between bg-blue-50 border border-blue-100 rounded-lg px-3 py-2 print:hidden">
                        <span className="text-xs text-blue-600">
                          {dataSource === 'cache'
                            ? `저장된 데이터입니다${
                                lastSyncedAt
                                  ? ` (최근 확인: ${new Date(lastSyncedAt).toLocaleDateString('ko-KR')})`
                                  : ''
                              }`
                            : '방금 최신 정보를 가져와 저장했습니다'}
                        </span>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            onClick={() => window.print()}
                            className="text-xs px-3 py-1 bg-gray-700 hover:bg-gray-800 text-white rounded-lg font-medium"
                          >
                            PDF 저장
                          </button>
                          <button
                            onClick={() => handleElevClick(selectedElev, true)}
                            className="text-xs px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium"
                          >
                            새로고침
                          </button>
                        </div>
                      </div>
                    )}

                    {!apiLoading && history.length > 0 && (
                      <div className="space-y-3">
                        <h3 className="font-bold text-gray-700 text-sm print:hidden">
                          최근 검사이력 ({history.length}건)
                        </h3>
                        {history.map((h, i) => {
                          const key = `${selectedElev.id}_${h.inspctDe}`;
                          const memoData = memos[key] || {
                            memo: '',
                            status: '미대응',
                          };
                          const isSaving = savingKey === key;
                          const fails = failList.filter(
                            (f) => f.examYmd === h.inspctDe
                          );
                          const dotColor =
                            h.dispWords === '합격'
                              ? 'bg-green-500'
                              : h.dispWords === '조건부합격'
                              ? 'bg-yellow-500'
                              : 'bg-red-500';
                          const textColor =
                            h.dispWords === '합격'
                              ? 'text-green-600'
                              : h.dispWords === '조건부합격'
                              ? 'text-yellow-600'
                              : 'text-red-600';
                          return (
                            <div
                              key={i}
                              className="border-b border-gray-200 pb-4 last:border-0 print:break-inside-avoid"
                            >
                              <div className="flex items-center gap-2 mb-1">
                                <span
                                  className={`w-2 h-2 rounded-full ${dotColor} shrink-0`}
                                />
                                <span className="font-semibold text-gray-800 text-sm">
                                  {fmtYmd(h.inspctDe)}
                                </span>
                                <span className="text-xs text-gray-400">
                                  {h.inspctKindNm}
                                </span>
                                <span
                                  className={`text-xs font-bold ml-auto ${textColor}`}
                                >
                                  {h.dispWords}
                                </span>
                              </div>
                              <p className="text-xs text-gray-400 mb-2 pl-4">
                                {h.inspctInsttNm} · 유효기간 {fmtYmd(h.applcBeDt)} ~{' '}
                                {fmtYmd(h.applcEnDt)}
                              </p>

                              {/* 부적합 내역 */}
                              {fails.length > 0 && (
                                <div className="pl-4 mb-2 space-y-1.5">
                                  {fails.map((f, fi) => (
                                    <div key={fi} className="text-xs text-gray-600">
                                      <p className="font-medium text-red-500">
                                        {f.standardArticle} {f.standardTitle1}
                                      </p>
                                      <p>{f.failDesc}</p>
                                      {f.failDescInspector && (
                                        <p className="text-gray-400 italic">
                                          👤 {f.failDescInspector}
                                        </p>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              )}

                              {/* 화면용 대응 메모 편집 */}
                              <div className="pl-4 print:hidden">
                                <div className="flex gap-1.5 mb-1.5">
                                  {['미대응', '대응중', '완료'].map((s) => (
                                    <button
                                      key={s}
                                      onClick={() => updateMemo(key, 'status', s)}
                                      className={`text-xs px-2.5 py-1 rounded-md font-medium transition-colors
                                        ${
                                          memoData.status === s
                                            ? 'bg-purple-600 text-white'
                                            : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                                        }`}
                                    >
                                      {s}
                                    </button>
                                  ))}
                                </div>
                                <textarea
                                  value={memoData.memo}
                                  onChange={(e) =>
                                    updateMemo(key, 'memo', e.target.value)
                                  }
                                  placeholder="대응 내역, 특이사항 등을 입력하세요"
                                  className="w-full text-xs border border-gray-200 rounded-md px-3 py-2 resize-none h-16
                                             focus:outline-none focus:ring-1 focus:ring-purple-300"
                                />
                                <button
                                  onClick={() => saveMemo(h)}
                                  disabled={isSaving}
                                  className="mt-1.5 text-xs px-4 py-1.5 bg-purple-600 hover:bg-purple-700
                                             text-white rounded-md font-medium disabled:opacity-50"
                                >
                                  {isSaving
                                    ? '저장 중...'
                                    : memoData.docId
                                    ? '수정 저장'
                                    : '저장'}
                                </button>
                              </div>

                              {/* 인쇄용 대응 메모(읽기 전용) */}
                              {(memoData.memo || memoData.status !== '미대응') && (
                                <div className="hidden print:block pl-4 text-xs text-gray-600">
                                  상태: {memoData.status}
                                  {memoData.memo ? ` · 메모: ${memoData.memo}` : ''}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
