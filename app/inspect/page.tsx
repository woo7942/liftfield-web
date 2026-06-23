'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc, collection, getDocs, query, where, addDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';

const SERVICE_KEY = '4c4e8677cc42223329b997aee1cbc0dffa8cd337ecb0e8c47364825dc2c76577';

const getTag = (xml: string, tag: string) => xml.match(new RegExp(`<${tag}>(.*?)<\/${tag}>`))?.[1] || '';
const getItems = (xml: string) => xml.match(/<item>[\s\S]*?<\/item>/g) || [];
const fmtYmd = (d: string) => d ? `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}` : '';

interface UserInfo {
  uid: string;
  name: string;
  companyId: string;
  role: string;
  superAdmin?: boolean;
}

interface Site {
  id: string;
  siteName?: string;
  name?: string;
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
  const [memos, setMemos] = useState<{ [key: string]: { memo: string; status: string; docId?: string } }>({});
  const [savingKey, setSavingKey] = useState('');

  // ── 인증 ──
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) { router.push('/login'); return; }
      try {
        const snap = await getDoc(doc(db, 'users', user.uid));
        if (!snap.exists()) { router.push('/login'); return; }
        const data = snap.data();
        setUserInfo({ uid: user.uid, name: data.name || '', companyId: data.companyId || '', role: data.role || 'member', superAdmin: data.superAdmin || false });

        // 현장 목록 로드 (1회)
        const sitesSnap = await getDocs(collection(db, 'companies', data.companyId, 'sites'));
        setSites(sitesSnap.docs.map(d => ({ id: d.id, ...d.data() } as Site)));
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    });
    return () => unsub();
  }, []);

  // ── 현장 클릭 → 호기 로드 ──
  const handleSiteClick = async (site: Site) => {
    setSelectedSite(site);
    setSiteSearch('');
    setSelectedElev(null);
    setElevators([]);
    setElevsLoading(true);
    try {
      const snap = await getDocs(collection(db, 'companies', userInfo!.companyId, 'sites', site.id, 'elevators'));
      setElevators(snap.docs.map(d => ({ id: d.id, ...d.data() } as Elevator)));
    } catch (e) {
      console.error(e);
    } finally {
      setElevsLoading(false);
    }
  };

  // ── 호기 클릭 → API 조회 ──
  const handleElevClick = async (elev: Elevator) => {
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

    // 메모 로드
    try {
      const memoSnap = await getDocs(query(
        collection(db, 'companies', userInfo!.companyId, 'safetyInspections'),
        where('elevatorId', '==', elev.id)
      ));
      const memoMap: typeof memos = {};
      memoSnap.docs.forEach(d => {
        const data = d.data();
        memoMap[`${elev.id}_${data.inspctDe}`] = { memo: data.userMemo || '', status: data.status || '미대응', docId: d.id };
      });
      setMemos(memoMap);
    } catch (e) { console.error(e); }

    // API 조회
    try {
      const histRes = await fetch(`https://apis.data.go.kr/B553664/ElevatorInspectsafeService/getInspectsafeList?serviceKey=${SERVICE_KEY}&elevator_no=${elev.elevatorNo}&numOfRows=50&pageNo=1`);
      const histText = await histRes.text();
      const histData = getItems(histText).map(xml => ({
        inspctDe: getTag(xml, 'inspctDe'),
        inspctKindNm: getTag(xml, 'inspctKindNm'),
        dispWords: getTag(xml, 'dispWords'),
        inspctInsttNm: getTag(xml, 'inspctInsttNm'),
        applcBeDt: getTag(xml, 'applcBeDt'),
        applcEnDt: getTag(xml, 'applcEnDt'),
        failCd: getTag(xml, 'failCd'),
      })).filter(h => h.inspctDe).sort((a, b) => b.inspctDe.localeCompare(a.inspctDe)).slice(0, 5);
      setHistory(histData);

      // 부적합 조회
      const allFails: any[] = [];
      for (const h of histData.filter(h => h.failCd)) {
        const failRes = await fetch(`https://apis.data.go.kr/B553664/ElevatorInspectsafeService/getInspectFailList?serviceKey=${SERVICE_KEY}&fail_cd=${h.failCd}&numOfRows=50&pageNo=1`);
        const failText = await failRes.text();
        getItems(failText).forEach(xml => allFails.push({
          examYmd: h.inspctDe,
          standardArticle: getTag(xml, 'standardArticle'),
          standardTitle1: getTag(xml, 'standardTitle1'),
          failDesc: getTag(xml, 'failDesc'),
          failDescInspector: getTag(xml, 'failDescInspector'),
        }));
      }
      setFailList(allFails);
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
        companyId: userInfo.companyId,
        siteId: selectedSite?.id || '',
        siteName: selectedSite?.siteName || selectedSite?.name || '',
        elevatorId: selectedElev.id,
        hogiNo: String(selectedElev.hogiNo || ''),
        elevatorNo: selectedElev.elevatorNo || '',
        inspctDe: h.inspctDe,
        inspctKindNm: h.inspctKindNm || '',
        dispWords: h.dispWords || '',
        failCd: h.failCd || '',
        userMemo: current.memo,
        status: current.status,
        updatedAt: serverTimestamp(),
      };
      if (current.docId) {
        await updateDoc(doc(db, 'companies', userInfo.companyId, 'safetyInspections', current.docId), payload);
      } else {
        const newDoc = await addDoc(collection(db, 'companies', userInfo.companyId, 'safetyInspections'), { ...payload, createdAt: serverTimestamp() });
        setMemos(prev => ({ ...prev, [key]: { ...current, docId: newDoc.id } }));
      }
      alert('✅ 저장 완료');
    } catch (e: any) {
      alert(`❌ 저장 실패: ${e.message}`);
    } finally {
      setSavingKey('');
    }
  };

  const updateMemo = (key: string, field: 'memo' | 'status', value: string) => {
    setMemos(prev => ({ ...prev, [key]: { ...(prev[key] || { memo: '', status: '미대응' }), [field]: value } }));
  };

  const resultColor = (r: string) => r === '합격' ? 'text-green-600 bg-green-50' : r === '조건부합격' ? 'text-yellow-600 bg-yellow-50' : 'text-red-600 bg-red-50';
  const resultBorder = (r: string) => r === '합격' ? 'border-green-400' : r === '조건부합격' ? 'border-yellow-400' : 'border-red-400';

  const filteredSites = siteSearch.trim().length >= 2
  ? sites.filter(s => (s.siteName || s.name || '').toLowerCase().includes(siteSearch.toLowerCase())).slice(0, 20)
  : [];


  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <p className="text-gray-500">로딩 중...</p>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 헤더 */}
      <header className="bg-white border-b px-4 py-3 flex items-center gap-2 sticky top-0 z-10">
        <button onClick={() => router.push('/dashboard')} className="text-gray-500 hover:text-gray-700 text-lg">←</button>
        <h1 className="font-bold text-lg">🔍 검사 지적사항</h1>
        {selectedSite && (
          <span className="text-sm text-gray-400 ml-1">/ {selectedSite.siteName || selectedSite.name}</span>
        )}
        {selectedElev && (
          <span className="text-sm text-gray-400">/ {selectedElev.hogiNo}호기</span>
        )}
      </header>

      <div className="max-w-5xl mx-auto px-4 py-4">
        {/* ── 현장 검색 ── */}
        {!selectedSite && (
          <div className="max-w-xl mx-auto mt-8">
            <p className="text-gray-500 text-sm mb-3 text-center">검사이력을 조회할 현장을 검색하세요</p>
            <div className="relative">
              <input
                value={siteSearch}
                onChange={e => setSiteSearch(e.target.value)}
                placeholder="🔍 현장명 검색... (2글자 이상)"

                className="w-full border rounded-xl px-4 py-3 text-sm bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
              />
              {siteSearch && (
                <button onClick={() => setSiteSearch('')} className="absolute right-3 top-3 text-gray-400 hover:text-gray-600">✕</button>
              )}
            </div>
            {filteredSites.length > 0 && (
              <div className="mt-2 bg-white border rounded-xl shadow-sm overflow-hidden">
                {filteredSites.map(site => (
                  <button
                    key={site.id}
                    onClick={() => handleSiteClick(site)}
                    className="w-full text-left px-4 py-3 hover:bg-blue-50 border-b last:border-0 text-sm font-medium text-gray-700 transition-colors"
                  >
                    🏢 {site.siteName || site.name}
                  </button>
                ))}
              </div>
            )}
            {siteSearch.trim() && filteredSites.length === 0 && (
              <p className="text-center text-gray-400 text-sm mt-4">검색 결과가 없습니다</p>
            )}
          </div>
        )}

        {/* ── 현장 선택됨 ── */}
        {selectedSite && (
          <div className="flex gap-4">
            {/* 왼쪽: 호기 목록 */}
            <div className="w-56 shrink-0">
              <div className="bg-white border rounded-xl overflow-hidden">
                <div className="px-3 py-2.5 border-b bg-gray-50 flex items-center justify-between">
                  <span className="text-sm font-bold text-gray-700">
                    🏢 {selectedSite.siteName || selectedSite.name}
                  </span>
                  <button
                    onClick={() => { setSelectedSite(null); setSelectedElev(null); setElevators([]); }}
                    className="text-xs text-gray-400 hover:text-gray-600"
                  >
                    변경
                  </button>
                </div>
                {elevsLoading ? (
                  <div className="py-8 text-center text-gray-400 text-sm">로딩 중...</div>
                ) : elevators.length === 0 ? (
                  <div className="py-8 text-center text-gray-400 text-sm">호기 없음</div>
                ) : (
                  elevators
                    .sort((a, b) => parseInt(String(a.hogiNo || '0').replace(/[^0-9]/g, '') || '0') - parseInt(String(b.hogiNo || '0').replace(/[^0-9]/g, '') || '0'))
                    .map(elev => (
                      <button
                        key={elev.id}
                        onClick={() => handleElevClick(elev)}
                        className={`w-full text-left px-3 py-2.5 border-b last:border-0 text-sm transition-colors ${selectedElev?.id === elev.id ? 'bg-blue-50 text-blue-700 font-semibold' : 'hover:bg-gray-50 text-gray-700'}`}
                      >
                        <div className="font-medium">{elev.dong ? `${elev.dong} ` : ''}{String(elev.hogiNo || '').replace(/[^0-9]/g, '')}호기</div>
                        {elev.installationPlace && <div className="text-xs text-gray-400">{elev.installationPlace}</div>}
                        <div className="text-xs text-gray-400">{elev.elevatorNo || '번호없음'}</div>
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
                <div className="bg-white border rounded-xl overflow-hidden">
                  {/* 호기 정보 헤더 */}
                  <div className="px-4 py-3 bg-purple-50 border-b flex items-center justify-between">
                    <div>
                      <span className="font-bold text-purple-700">
                        {selectedElev.dong ? `${selectedElev.dong} ` : ''}{String(selectedElev.hogiNo || '').replace(/[^0-9]/g, '')}호기
                      </span>
                      {selectedElev.installationPlace && (
                        <span className="text-sm text-gray-500 ml-2">({selectedElev.installationPlace})</span>
                      )}
                    </div>
                    <span className="text-xs text-gray-500">승강기번호: {selectedElev.elevatorNo || '없음'}</span>
                  </div>

                  <div className="p-4">
                    {apiLoading && (
                      <div className="py-16 text-center">
                        <div className="inline-block w-8 h-8 border-4 border-purple-300 border-t-purple-600 rounded-full animate-spin mb-3"></div>
                        <p className="text-gray-500 text-sm">검사이력 조회 중...</p>
                      </div>
                    )}

                    {apiError && (
                      <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-600 text-sm">{apiError}</div>
                    )}

                    {!apiLoading && !apiError && history.length === 0 && (
                      <div className="py-16 text-center text-gray-400">
                        <p className="text-3xl mb-3">📄</p>
                        <p className="text-sm">검사이력이 없습니다</p>
                      </div>
                    )}

                    {!apiLoading && history.length > 0 && (
                      <div className="space-y-4">
                        <h3 className="font-bold text-gray-700 text-sm">📋 최근 검사이력 ({history.length}건)</h3>
                        {history.map((h, i) => {
                          const key = `${selectedElev.id}_${h.inspctDe}`;
                          const memoData = memos[key] || { memo: '', status: '미대응' };
                          const isSaving = savingKey === key;
                          const fails = failList.filter(f => f.examYmd === h.inspctDe);
                          return (
                            <div key={i} className={`border-l-4 ${resultBorder(h.dispWords)} bg-gray-50 rounded-r-xl p-4`}>
                              <div className="flex items-center justify-between mb-2">
                                <span className="font-bold text-gray-700">{fmtYmd(h.inspctDe)} · {h.inspctKindNm}</span>
                                <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${resultColor(h.dispWords)}`}>{h.dispWords}</span>
                              </div>
                              <p className="text-xs text-gray-500 mb-1">기관: 한국승강기안전공단 {h.inspctInsttNm}</p>
                              <p className="text-xs text-gray-500 mb-3">유효기간: {fmtYmd(h.applcBeDt)} ~ {fmtYmd(h.applcEnDt)}</p>

                              {/* 부적합 내역 */}
                              {fails.length > 0 && (
                                <div className="mb-3 bg-red-50 border border-red-200 rounded-xl p-3">
                                  <p className="text-xs font-bold text-red-600 mb-2">⚠️ 부적합 내역 ({fails.length}건)</p>
                                  <div className="space-y-2">
                                    {fails.map((f, fi) => (
                                      <div key={fi} className="text-xs text-gray-700 border-b border-red-100 pb-2 last:border-0 last:pb-0">
                                        <p className="font-semibold text-red-600">{f.standardArticle} {f.standardTitle1}</p>
                                        <p className="mt-0.5">{f.failDesc}</p>
                                        {f.failDescInspector && <p className="text-gray-400 italic mt-0.5">👤 {f.failDescInspector}</p>}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* 메모 */}
                              <div className="bg-white border rounded-xl p-3">
                                <p className="text-xs font-bold text-gray-600 mb-2">📝 대응 메모</p>
                                <div className="flex gap-1.5 mb-2">
                                  {['미대응', '대응중', '완료'].map(s => (
                                    <button
                                      key={s}
                                      onClick={() => updateMemo(key, 'status', s)}
                                      className={`flex-1 text-xs py-1 rounded-lg font-medium transition-colors ${memoData.status === s ? 'bg-purple-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                                    >
                                      {s}
                                    </button>
                                  ))}
                                </div>
                                <textarea
                                  value={memoData.memo}
                                  onChange={e => updateMemo(key, 'memo', e.target.value)}
                                  placeholder="대응 내역, 특이사항 등을 입력하세요"
                                  className="w-full text-xs border rounded-lg px-3 py-2 resize-none h-20 focus:outline-none focus:ring-1 focus:ring-purple-300"
                                />
                                <button
                                  onClick={() => saveMemo(h)}
                                  disabled={isSaving}
                                  className="mt-2 w-full text-xs py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-bold disabled:opacity-50 transition-colors"
                                >
                                  {isSaving ? '저장 중...' : memoData.docId ? '수정 저장' : '저장'}
                                </button>
                              </div>
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
