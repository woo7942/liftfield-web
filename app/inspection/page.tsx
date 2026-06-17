'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { onAuthStateChanged } from 'firebase/auth';
import {
  doc, getDoc, collection, query,
  getDocs, setDoc, serverTimestamp,
} from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';

interface UserInfo {
  uid: string;
  name: string;
  companyId: string;
  companyDisplayName: string;
  role: string;
  superAdmin: boolean;
}

interface Site {
  id: string;
  name: string;
  address?: string;
  companyId: string;
}

interface Elevator {
  id: string;
  siteId: string;
  siteName: string;
  elevatorNo: string;
  dong?: string;
  hoNo?: string;
  companyId: string;
}

interface InspectionHistory {
  inspectionDate: string;
  result: string;
  inspectionOrg: string;
  inspector: string;
  nextInspectionDate?: string;
}

interface FailItem {
  failCd: string;
  failNm: string;
  failContent?: string;
}

interface CacheData {
  elevatorNo: string;
  history: InspectionHistory[];
  failList: FailItem[];
  cachedAt: Date;
}

const API_KEY = process.env.NEXT_PUBLIC_ELEVATOR_API_KEY || '';

function toDate(v: unknown): Date | undefined {
  if (!v) return undefined;
  if (v instanceof Date) return v;
  if (typeof v === 'object' && 'toDate' in (v as object))
    return (v as { toDate: () => Date }).toDate();
  return undefined;
}

function getResultColor(result: string) {
  if (result?.includes('합격') && !result?.includes('조건')) return 'green';
  if (result?.includes('조건')) return 'yellow';
  if (result?.includes('불합격')) return 'red';
  return 'gray';
}

function getResultBadge(result: string) {
  const color = getResultColor(result);
  const cls = {
    green: 'bg-green-100 text-green-700 border border-green-200',
    yellow: 'bg-yellow-100 text-yellow-700 border border-yellow-200',
    red: 'bg-red-100 text-red-700 border border-red-200',
    gray: 'bg-gray-100 text-gray-500 border border-gray-200',
  }[color];
  const icon = { green: '✅', yellow: '⚠️', red: '❌', gray: '❓' }[color];
  return { cls, icon };
}

function parseXmlItems(xml: string, itemTag: string): Record<string, string>[] {
  const items: Record<string, string>[] = [];
  const re = new RegExp(`<${itemTag}[\\s\\S]*?</${itemTag}>`, 'g');
  let m;
  while ((m = re.exec(xml)) !== null) {
    const block = m[0];
    const tagRe = /<(\w+)[^>]*>([\s\S]*?)<\/\1>/g;
    const obj: Record<string, string> = {};
    let tm;
    while ((tm = tagRe.exec(block)) !== null) {
      obj[tm[1]] = tm[2].trim();
    }
    items.push(obj);
  }
  return items;
}

async function fetchInspectionHistory(elevatorNo: string): Promise<InspectionHistory[]> {
  try {
    const url = `https://apis.data.go.kr/B553131/ElevatorInfo/getElevatorInspectionInfo?serviceKey=${API_KEY}&elevatorNo=${elevatorNo}&numOfRows=50&pageNo=1`;
    const res = await fetch(url);
    const xml = await res.text();
    const items = parseXmlItems(xml, 'item');
    return items.map((it) => ({
      inspectionDate: it.inspctDe || '',
      result: it.inspctRsltNm || '',
      inspectionOrg: it.inspctInsttNm || '',
      inspector: it.inspctorNm || '',
      nextInspectionDate: it.nxtInspctDe || '',
    }));
  } catch {
    return [];
  }
}

async function fetchFailList(elevatorNo: string): Promise<FailItem[]> {
  try {
    const url = `https://apis.data.go.kr/B553131/ElevatorInfo/getElevatorInspectionItemInfo?serviceKey=${API_KEY}&elevatorNo=${elevatorNo}&numOfRows=50&pageNo=1`;
    const res = await fetch(url);
    const xml = await res.text();
    const items = parseXmlItems(xml, 'item');
    return items.map((it) => ({
      failCd: it.failCd || '',
      failNm: it.failNm || '',
      failContent: it.failCn || '',
    }));
  } catch {
    return [];
  }
}

function generateSingleHtml(
  elevator: Elevator,
  history: InspectionHistory[],
  failList: FailItem[],
  companyName: string
): string {
  const latest = history[0];
  const historyRows = history.map((h) => `
    <tr>
      <td>${h.inspectionDate}</td>
      <td>${h.result}</td>
      <td>${h.inspectionOrg}</td>
      <td>${h.inspector}</td>
      <td>${h.nextInspectionDate || '-'}</td>
    </tr>
  `).join('');

  const failRows = failList.length > 0
    ? failList.map((f) => `
      <tr>
        <td>${f.failCd}</td>
        <td>${f.failNm}</td>
        <td>${f.failContent || '-'}</td>
      </tr>
    `).join('')
    : '<tr><td colspan="3" style="text-align:center;color:#888">부적합 항목 없음</td></tr>';

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8"/>
<title>점검 보고서 - ${elevator.elevatorNo}</title>
<style>
  body { font-family: 'Malgun Gothic', sans-serif; padding: 30px; color: #222; }
  h1 { font-size: 22px; border-bottom: 2px solid #2563eb; padding-bottom: 8px; color: #1e40af; }
  h2 { font-size: 16px; margin-top: 24px; color: #374151; }
  .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; background: #f3f4f6; padding: 16px; border-radius: 8px; margin: 12px 0; }
  .info-item { font-size: 13px; } .info-item span { font-weight: bold; }
  .badge { display: inline-block; padding: 4px 12px; border-radius: 20px; font-weight: bold; font-size: 13px; margin: 8px 0; }
  .badge-green { background: #d1fae5; color: #065f46; }
  .badge-yellow { background: #fef3c7; color: #92400e; }
  .badge-red { background: #fee2e2; color: #991b1b; }
  .badge-gray { background: #f3f4f6; color: #6b7280; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 12px; }
  th { background: #1e40af; color: white; padding: 8px; text-align: left; }
  td { padding: 7px 8px; border-bottom: 1px solid #e5e7eb; }
  tr:nth-child(even) td { background: #f9fafb; }
  .footer { margin-top: 40px; font-size: 11px; color: #9ca3af; text-align: right; }
  @media print { body { padding: 15px; } }
</style>
</head>
<body>
  <h1>🛗 승강기 점검 보고서</h1>
  <div class="info-grid">
    <div class="info-item">회사명: <span>${companyName}</span></div>
    <div class="info-item">승강기번호: <span>${elevator.elevatorNo}</span></div>
    <div class="info-item">현장명: <span>${elevator.siteName}</span></div>
    <div class="info-item">동: <span>${elevator.dong || '-'}</span></div>
    <div class="info-item">출력일: <span>${new Date().toLocaleDateString('ko-KR')}</span></div>
    ${latest ? `<div class="info-item">최근검사일: <span>${latest.inspectionDate}</span></div>` : ''}
  </div>
  ${latest ? `<div class="badge badge-${getResultColor(latest.result)}">${latest.result || '정보없음'}</div>` : ''}
  <h2>📋 검사 이력</h2>
  <table>
    <thead><tr><th>검사일</th><th>결과</th><th>검사기관</th><th>검사자</th><th>차기검사일</th></tr></thead>
    <tbody>${historyRows || '<tr><td colspan="5" style="text-align:center;color:#888">검사 이력 없음</td></tr>'}</tbody>
  </table>
  <h2>⚠️ 부적합 항목</h2>
  <table>
    <thead><tr><th>코드</th><th>항목명</th><th>내용</th></tr></thead>
    <tbody>${failRows}</tbody>
  </table>
  <div class="footer">LiftField · 출력일: ${new Date().toLocaleString('ko-KR')}</div>
</body>
</html>`;
}

function generateSiteHtml(
  site: Site,
  elevators: Elevator[],
  cacheMap: Record<string, CacheData>,
  companyName: string
): string {
  const elevatorSections = elevators.map((elev) => {
    const cache = cacheMap[elev.elevatorNo];
    const latest = cache?.history?.[0];
    const color = latest ? getResultColor(latest.result) : 'gray';
    const failRows = (cache?.failList || []).length > 0
      ? cache.failList.map((f) => `
          <tr><td>${f.failCd}</td><td>${f.failNm}</td><td>${f.failContent || '-'}</td></tr>
        `).join('')
      : '<tr><td colspan="3" style="text-align:center;color:#888">부적합 없음</td></tr>';

    return `
      <div style="margin-bottom:32px;border:1px solid #e5e7eb;border-radius:8px;padding:16px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
          <strong style="font-size:14px;">승강기번호: ${elev.elevatorNo}${elev.dong ? ` (${elev.dong})` : ''}</strong>
          <span class="badge badge-${color}">${latest?.result || '정보없음'}</span>
        </div>
        ${latest ? `<p style="font-size:12px;color:#6b7280;margin:4px 0;">최근검사: ${latest.inspectionDate} · ${latest.inspectionOrg}</p>` : ''}
        <table style="width:100%;border-collapse:collapse;font-size:11px;margin-top:8px;">
          <thead><tr style="background:#374151;color:white;">
            <th style="padding:6px;">코드</th><th style="padding:6px;">항목명</th><th style="padding:6px;">내용</th>
          </tr></thead>
          <tbody>${failRows}</tbody>
        </table>
      </div>
    `;
  }).join('');

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8"/>
<title>현장 점검 보고서 - ${site.name}</title>
<style>
  body { font-family: 'Malgun Gothic', sans-serif; padding: 30px; color: #222; }
  h1 { font-size: 22px; border-bottom: 2px solid #2563eb; padding-bottom: 8px; color: #1e40af; }
  .badge { display: inline-block; padding: 3px 10px; border-radius: 20px; font-weight: bold; font-size: 12px; }
  .badge-green { background: #d1fae5; color: #065f46; }
  .badge-yellow { background: #fef3c7; color: #92400e; }
  .badge-red { background: #fee2e2; color: #991b1b; }
  .badge-gray { background: #f3f4f6; color: #6b7280; }
  .footer { margin-top: 40px; font-size: 11px; color: #9ca3af; text-align: right; }
  @media print { body { padding: 15px; } }
</style>
</head>
<body>
  <h1>🏢 현장 점검 보고서</h1>
  <p style="font-size:13px;color:#6b7280;margin-bottom:24px;">
    회사: <strong>${companyName}</strong> · 현장: <strong>${site.name}</strong> ·
    출력일: ${new Date().toLocaleDateString('ko-KR')} · 총 ${elevators.length}대
  </p>
  ${elevatorSections}
  <div class="footer">LiftField · 출력일: ${new Date().toLocaleString('ko-KR')}</div>
</body>
</html>`;
}

export default function InspectionPage() {
  const router = useRouter();
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(true);

  const [sites, setSites] = useState<Site[]>([]);
  const [elevators, setElevators] = useState<Elevator[]>([]);
  const [cacheMap, setCacheMap] = useState<Record<string, CacheData>>({});

  const [search, setSearch] = useState('');
  const [expandedSites, setExpandedSites] = useState<Set<string>>(new Set());
  const [fetchingMap, setFetchingMap] = useState<Record<string, boolean>>({});
  const [selectedElev, setSelectedElev] = useState<Elevator | null>(null);

  // ── 인증 ──
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) { router.push('/login'); return; }
      const snap = await getDoc(doc(db, 'users', user.uid));
      if (!snap.exists()) { router.push('/login'); return; }

      const data = snap.data();
      const isSuperAdmin = data.superAdmin === true;
      const isAdmin = data.role === 'admin';

      if (!isSuperAdmin && !isAdmin) {
        router.push('/');
        return;
      }

      setUserInfo({
        uid: user.uid,
        name: data.name || '',
        companyId: data.companyId || '',
        companyDisplayName: data.companyDisplayName || '',
        role: data.role || 'member',
        superAdmin: isSuperAdmin,
      });
    });
    return () => unsub();
  }, [router]);

  // ── 현장 + 호기 + 캐시 로드 ──
  useEffect(() => {
    if (!userInfo) return;
    const load = async () => {
      try {
        // ✅ 신규 구조
        const siteSnap = await getDocs(
          collection(db, 'companies', userInfo.companyId, 'sites')
        );
        const siteList: Site[] = siteSnap.docs.map((d) => ({
          id: d.id,
          name: d.data().name || d.data().siteName || '',
          address: d.data().address || '',
          companyId: userInfo.companyId,
        }));
        setSites(siteList);

        // ✅ 현장별 호기 로드
        const elevList: Elevator[] = [];
        for (const siteDoc of siteSnap.docs) {
          const elevSnap = await getDocs(
            collection(db, 'companies', userInfo.companyId, 'sites', siteDoc.id, 'elevators')
          );
          elevSnap.docs.forEach((d) => {
            elevList.push({
              id: d.id,
              siteId: siteDoc.id,
              siteName: siteDoc.data().name || siteDoc.data().siteName || '',
              elevatorNo: d.data().elevatorNo || '',
              dong: d.data().dong || '',
              hoNo: d.data().hoNo || '',
              companyId: userInfo.companyId,
            });
          });
        }
        setElevators(elevList);

        // ✅ 캐시 로드
        const cacheSnap = await getDocs(
          collection(db, 'companies', userInfo.companyId, 'elevatorInspectionCache')
        );
        const map: Record<string, CacheData> = {};
        cacheSnap.docs.forEach((d) => {
          const data = d.data();
          map[d.id] = {
            elevatorNo: d.id,
            history: data.history || [],
            failList: data.failList || [],
            cachedAt: toDate(data.cachedAt) || new Date(0),
          };
        });
        setCacheMap(map);
        setLoading(false);
      } catch (e) {
        console.error(e);
        setLoading(false);
      }
    };
    load();
  }, [userInfo]);

  // ── API 호출 + 캐시 저장 ──
  const fetchAndCache = useCallback(async (elevator: Elevator, force = false) => {
    if (!userInfo) return;
    const cached = cacheMap[elevator.elevatorNo];
    if (cached && !force) return;

    setFetchingMap((prev) => ({ ...prev, [elevator.elevatorNo]: true }));
    try {
      const [history, failList] = await Promise.all([
        fetchInspectionHistory(elevator.elevatorNo),
        fetchFailList(elevator.elevatorNo),
      ]);

      await setDoc(
        doc(db, 'companies', userInfo.companyId, 'elevatorInspectionCache', elevator.elevatorNo),
        { history, failList, cachedAt: serverTimestamp(), elevatorNo: elevator.elevatorNo }
      );

      const now = new Date();
      setCacheMap((prev) => ({
        ...prev,
        [elevator.elevatorNo]: {
          elevatorNo: elevator.elevatorNo,
          history,
          failList,
          cachedAt: now,
        },
      }));
    } catch (e) {
      console.error('fetchAndCache error:', e);
    } finally {
      setFetchingMap((prev) => ({ ...prev, [elevator.elevatorNo]: false }));
    }
  }, [userInfo, cacheMap]);

  // ── 현장 펼치기 ──
  const toggleSite = async (siteId: string) => {
    const next = new Set(expandedSites);
    if (next.has(siteId)) {
      next.delete(siteId);
    } else {
      next.add(siteId);
      const siteElevs = elevators.filter((e) => e.siteId === siteId);
      for (const elev of siteElevs) {
        await fetchAndCache(elev);
      }
    }
    setExpandedSites(next);
  };

  // ── 단일 PDF 출력 ──
  const printSingle = (elevator: Elevator) => {
    const cache = cacheMap[elevator.elevatorNo];
    const html = generateSingleHtml(
      elevator,
      cache?.history || [],
      cache?.failList || [],
      userInfo?.companyDisplayName || ''
    );
    const win = window.open('', '_blank');
    if (win) {
      win.document.write(html);
      win.document.close();
      win.onload = () => win.print();
    }
  };

  // ── 현장 전체 PDF 출력 ──
  const printSite = (site: Site) => {
    const siteElevs = elevators.filter((e) => e.siteId === site.id);
    const html = generateSiteHtml(site, siteElevs, cacheMap, userInfo?.companyDisplayName || '');
    const win = window.open('', '_blank');
    if (win) {
      win.document.write(html);
      win.document.close();
      win.onload = () => win.print();
    }
  };

  // ── 통계 계산 ──
  const stats = (() => {
    let total = 0, pass = 0, conditional = 0, fail = 0;
    elevators.forEach((e) => {
      const latest = cacheMap[e.elevatorNo]?.history?.[0];
      if (!latest) return;
      total++;
      if (latest.result?.includes('합격') && !latest.result?.includes('조건')) pass++;
      else if (latest.result?.includes('조건')) conditional++;
      else if (latest.result?.includes('불합격')) fail++;
    });
    return { total, pass, conditional, fail };
  })();

  // ── 검색 필터 ──
  const filteredSites = sites.filter((s) => {
    if (!search) return true;
    const siteElevs = elevators.filter((e) => e.siteId === s.id);
    return (
      s.name.includes(search) ||
      siteElevs.some(
        (e) => e.elevatorNo.includes(search) || (e.dong || '').includes(search)
      )
    );
  });

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-gray-500 text-sm">데이터 불러오는 중...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 헤더 */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => router.push('/')} className="text-gray-400 hover:text-gray-600 text-sm">
              ← 홈
            </button>
            <span className="text-gray-300">|</span>
            <h1 className="text-lg font-bold text-gray-800">🔍 점검 현황</h1>
            {userInfo?.companyDisplayName && (
              <span className="bg-indigo-100 text-indigo-700 text-xs px-2 py-1 rounded-full font-semibold">
                🏢 {userInfo.companyDisplayName}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600">{userInfo?.name} 님</span>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6">
        {/* 요약 카드 */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
          {[
            { label: '전체 호기', value: elevators.length, sub: '등록된 승강기', color: 'blue', icon: '🛗' },
            { label: '합격', value: stats.pass, sub: '정상', color: 'green', icon: '✅' },
            { label: '조건부합격', value: stats.conditional, sub: '조치 필요', color: 'yellow', icon: '⚠️' },
            { label: '불합격', value: stats.fail, sub: '즉시 조치', color: 'red', icon: '❌' },
          ].map((card) => (
            <div key={card.label} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
              <div className="flex items-center gap-2 mb-1">
                <span>{card.icon}</span>
                <p className="text-xs text-gray-500">{card.label}</p>
              </div>
              <p className={`text-2xl font-bold ${
                card.color === 'blue' ? 'text-blue-600' :
                card.color === 'green' ? 'text-green-600' :
                card.color === 'yellow' ? 'text-yellow-600' : 'text-red-600'
              }`}>{card.value}</p>
              <p className="text-xs text-gray-400 mt-1">{card.sub}</p>
            </div>
          ))}
        </div>

        {/* 검색 */}
        <div className="mb-4">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="현장명, 승강기번호, 동 검색..."
            className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
          />
        </div>

        {/* 현장 목록 */}
        {filteredSites.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-12 text-center text-gray-400">
            <p className="text-4xl mb-3">🏢</p>
            <p className="text-sm">등록된 현장이 없어요.<br />앱에서 현장과 호기를 먼저 등록해주세요.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredSites.map((site) => {
              const siteElevs = elevators.filter((e) => e.siteId === site.id);
              const isExpanded = expandedSites.has(site.id);

              const siteStats = { pass: 0, conditional: 0, fail: 0, unknown: 0 };
              siteElevs.forEach((e) => {
                const latest = cacheMap[e.elevatorNo]?.history?.[0];
                if (!latest) { siteStats.unknown++; return; }
                if (latest.result?.includes('합격') && !latest.result?.includes('조건')) siteStats.pass++;
                else if (latest.result?.includes('조건')) siteStats.conditional++;
                else if (latest.result?.includes('불합격')) siteStats.fail++;
                else siteStats.unknown++;
              });

              return (
                <div key={site.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                  <div
                    className="p-4 flex items-center justify-between cursor-pointer hover:bg-gray-50 transition"
                    onClick={() => toggleSite(site.id)}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-indigo-100 rounded-xl flex items-center justify-center text-lg">
                        🏢
                      </div>
                      <div>
                        <p className="font-bold text-gray-800">{site.name}</p>
                        <p className="text-xs text-gray-400">{site.address || '주소 미등록'} · {siteElevs.length}대</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {siteStats.fail > 0 && (
                        <span className="bg-red-100 text-red-600 text-xs px-2 py-0.5 rounded-full font-semibold">
                          ❌ {siteStats.fail}
                        </span>
                      )}
                      {siteStats.conditional > 0 && (
                        <span className="bg-yellow-100 text-yellow-600 text-xs px-2 py-0.5 rounded-full font-semibold">
                          ⚠️ {siteStats.conditional}
                        </span>
                      )}
                      {siteStats.pass > 0 && (
                        <span className="bg-green-100 text-green-600 text-xs px-2 py-0.5 rounded-full font-semibold">
                          ✅ {siteStats.pass}
                        </span>
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); printSite(site); }}
                        className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-600 px-2 py-1 rounded-lg transition ml-1"
                      >
                        🖨️ 출력
                      </button>
                      <span className={`text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}>
                        ▼
                      </span>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="border-t border-gray-100 divide-y divide-gray-50">
                      {siteElevs.length === 0 ? (
                        <p className="p-4 text-sm text-gray-400 text-center">등록된 호기가 없어요.</p>
                      ) : (
                        siteElevs.map((elev) => {
                          const cache = cacheMap[elev.elevatorNo];
                          const latest = cache?.history?.[0];
                          const badge = latest ? getResultBadge(latest.result) : null;
                          const isFetching = fetchingMap[elev.elevatorNo];

                          return (
                            <div
                              key={elev.id}
                              className="p-4 flex items-center justify-between hover:bg-gray-50 cursor-pointer transition"
                              onClick={() => {
                                setSelectedElev(elev);
                                fetchAndCache(elev);
                              }}
                            >
                              <div className="flex items-center gap-3">
                                <div className="w-8 h-8 bg-gray-100 rounded-lg flex items-center justify-center text-sm">
                                  🛗
                                </div>
                                <div>
                                  <div className="flex items-center gap-2">
                                    <p className="text-sm font-semibold text-gray-800">{elev.elevatorNo}</p>
                                    {elev.dong && (
                                      <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">
                                        {elev.dong}
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-xs text-gray-400">
                                    {latest ? `최근검사: ${latest.inspectionDate}` : '검사이력 없음'}
                                  </p>
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                {isFetching ? (
                                  <span className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                                ) : badge ? (
                                  <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${badge.cls}`}>
                                    {badge.icon} {latest?.result}
                                  </span>
                                ) : (
                                  <span className="text-xs bg-gray-100 text-gray-400 px-2 py-0.5 rounded-full">
                                    미조회
                                  </span>
                                )}
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    fetchAndCache(elev, true);
                                  }}
                                  className="text-xs text-blue-400 hover:text-blue-600 transition"
                                  title="새로고침"
                                >
                                  🔄
                                </button>
                                <span className="text-gray-300">›</span>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* 호기 상세 모달 */}
      {selectedElev && (() => {
        const cache = cacheMap[selectedElev.elevatorNo];
        const latest = cache?.history?.[0];
        const badge = latest ? getResultBadge(latest.result) : null;
        const isFetching = fetchingMap[selectedElev.elevatorNo];

        return (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col overflow-hidden">
              <div className="p-5 border-b border-gray-100 flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-black text-gray-800">🛗 {selectedElev.elevatorNo}</h2>
                    {selectedElev.dong && (
                      <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded">{selectedElev.dong}</span>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">{selectedElev.siteName}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => fetchAndCache(selectedElev, true)}
                    className="text-xs bg-blue-50 hover:bg-blue-100 text-blue-600 px-3 py-1.5 rounded-xl transition"
                  >
                    🔄 새로고침
                  </button>
                  <button
                    onClick={() => printSingle(selectedElev)}
                    className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-600 px-3 py-1.5 rounded-xl transition"
                  >
                    🖨️ PDF 출력
                  </button>
                  <button
                    onClick={() => setSelectedElev(null)}
                    className="text-gray-400 hover:text-gray-600 text-xl ml-1"
                  >
                    ✕
                  </button>
                </div>
              </div>

              <div className="overflow-y-auto flex-1 p-5 space-y-4">
                {isFetching ? (
                  <div className="text-center py-12">
                    <div className="w-8 h-8 border-4 border-blue-400 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                    <p className="text-sm text-gray-400">검사 이력 불러오는 중...</p>
                  </div>
                ) : (
                  <>
                    {latest && (
                      <div className={`rounded-xl p-4 ${
                        getResultColor(latest.result) === 'green' ? 'bg-green-50 border border-green-200' :
                        getResultColor(latest.result) === 'yellow' ? 'bg-yellow-50 border border-yellow-200' :
                        getResultColor(latest.result) === 'red' ? 'bg-red-50 border border-red-200' :
                        'bg-gray-50 border border-gray-200'
                      }`}>
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-xs text-gray-500 mb-1">최근 검사 결과</p>
                            <p className="text-xl font-black text-gray-800">
                              {badge?.icon} {latest.result}
                            </p>
                            <p className="text-xs text-gray-500 mt-1">
                              {latest.inspectionDate} · {latest.inspectionOrg} · {latest.inspector}
                            </p>
                          </div>
                          {latest.nextInspectionDate && (
                            <div className="text-right">
                              <p className="text-xs text-gray-400">차기검사일</p>
                              <p className="text-sm font-bold text-gray-700">{latest.nextInspectionDate}</p>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    <div>
                      <h3 className="font-bold text-gray-700 text-sm mb-2">📋 검사 이력</h3>
                      {(cache?.history || []).length === 0 ? (
                        <p className="text-sm text-gray-400 text-center py-4">검사 이력이 없어요.</p>
                      ) : (
                        <div className="space-y-2">
                          {cache.history.map((h, i) => {
                            const b = getResultBadge(h.result);
                            return (
                              <div key={i} className="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-2.5">
                                <div>
                                  <p className="text-sm font-medium text-gray-800">{h.inspectionDate}</p>
                                  <p className="text-xs text-gray-400">{h.inspectionOrg}</p>
                                </div>
                                <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${b.cls}`}>
                                  {b.icon} {h.result}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {(cache?.failList || []).length > 0 && (
                      <div>
                        <h3 className="font-bold text-red-600 text-sm mb-2">⚠️ 부적합 항목</h3>
                        <div className="space-y-2">
                          {cache.failList.map((f, i) => (
                            <div key={i} className="bg-red-50 border border-red-100 rounded-xl px-4 py-2.5">
                              <div className="flex items-center gap-2">
                                <span className="text-xs bg-red-100 text-red-600 px-1.5 py-0.5 rounded font-mono">
                                  {f.failCd}
                                </span>
                                <p className="text-sm font-semibold text-red-700">{f.failNm}</p>
                              </div>
                              {f.failContent && (
                                <p className="text-xs text-red-500 mt-1">{f.failContent}</p>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {!cache && (
                      <div className="text-center py-8 text-gray-400">
                        <p className="text-3xl mb-2">🔍</p>
                        <p className="text-sm">검사 데이터가 없어요.<br />새로고침 버튼을 눌러 불러오세요.</p>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
