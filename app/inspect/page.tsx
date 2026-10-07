'use client';

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { C, Icon } from '@/lib/theme';
import TabBar from '@/components/TabBar';

const getTag = (xml: string, tag: string) =>
  xml.match(new RegExp(`<${tag}>(.*?)<\/${tag}>`))?.[1] || '';
const getItems = (xml: string) =>
  xml.match(/<item>[\s\S]*?<\/item>/g) || [];
const fmtYmd = (d: string) =>
  d ? (d.includes('-') ? d : `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`) : '';

// 'YYYYMMDD' / 'YYYY-MM-DD' / ISO 모두 Date로 (new Date('20250301')은 Invalid Date라 직접 파싱)
const parseYmd = (v: any): Date | null => {
  if (!v) return null;
  const s = String(v).trim();
  const m = s.replace(/[^0-9]/g, '').match(/^(\d{4})(\d{2})(\d{2})/);
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
};
const ymdKey = (v: any) => String(v || '').replace(/[^0-9]/g, '').slice(0, 8);

// 다음 검사기한 계산: 국가 캐시(exam_date)는 갱신이 늦으므로
// 우리가 저장한 최신 검사이력(safety_inspections)과 비교해 더 최근 것을 기준으로 함.
// 최신 이력에 유효기간 종료일(applc_en_dt)이 있으면 그 날짜가 실제 기한.
const calcDueDate = (cacheExam: any, installDate: any, latest?: { de: string; en: string } | null): Date | null => {
  const cacheBase = parseYmd(cacheExam);
  const histBase = latest ? parseYmd(latest.de) : null;
  if (histBase && (!cacheBase || histBase.getTime() >= cacheBase.getTime())) {
    const en = parseYmd(latest!.en);
    if (en && en.getTime() > histBase.getTime()) return en;
    const n = new Date(histBase); n.setFullYear(n.getFullYear() + 1); return n;
  }
  const base = cacheBase || parseYmd(installDate);
  if (!base) return null;
  const n = new Date(base); n.setFullYear(n.getFullYear() + 1); return n;
};

type ItemCheck = { done: boolean; note: string; at?: string };

export default function InspectPage() {
  const router = useRouter();
  const [userInfo, setUserInfo] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const [sites, setSites] = useState<any[]>([]);
  const [siteSearch, setSiteSearch] = useState('');
  const [selectedSite, setSelectedSite] = useState<any>(null);

  const [elevators, setElevators] = useState<any[]>([]);
  const [elevsLoading, setElevsLoading] = useState(false);

    const [selectedElev, setSelectedElev] = useState<any>(null);
  const [elevPickerOpen, setElevPickerOpen] = useState(false);
  const [apiLoading, setApiLoading] = useState(false);

  const [history, setHistory] = useState<any[]>([]);
  const [failList, setFailList] = useState<any[]>([]);
  const [apiError, setApiError] = useState('');
  const [memos, setMemos] = useState<{
    [key: string]: { memo: string; status: string; docId?: string };
  }>({});
  const [savingKey, setSavingKey] = useState('');

  const [dataSource, setDataSource] = useState<'cache' | 'api' | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);

  const [siteReportLoading, setSiteReportLoading] = useState(false);
  const [siteReportRows, setSiteReportRows] = useState<{ elev: any; latest: any | null }[]>([]);
  const [reportProgress, setReportProgress] = useState('');

  const [overviewLoading, setOverviewLoading] = useState(false);
  const [overviewList, setOverviewList] = useState<any[]>([]);
  const [overviewVerifying, setOverviewVerifying] = useState('');
  // 기한초과로 뜬 호기는 세션당 한 번 공단 API로 최신 이력을 다시 확인
  const verifiedRef = useRef<Set<string>>(new Set());

  // ── 지적항목 체크/비고 ──
  const [checks, setChecks] = useState<Record<string, Record<string, ItemCheck>>>({});
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const [savingRow, setSavingRow] = useState('');
  const [needsMigration, setNeedsMigration] = useState(false);
  const [printMode, setPrintMode] = useState<'site' | 'elev'>('site');
  const [condFilter, setCondFilter] = useState<'all' | 'open' | 'done'>('open');
  const keepOpenRef = useRef<Set<string>>(new Set());
  const [showAllUnits, setShowAllUnits] = useState(false);
  // 동별 호기 번호 (현장 전체 일련번호 hogi_no → 동 안에서 1,2,3…)
  const [dongNo, setDongNo] = useState<Record<string, number>>({});
  const applyDongNo = (list: any[]) => {
    const groups: Record<string, any[]> = {};
    list.forEach((e: any) => {
      if (!e?.dong) return;
      const k = `${e.site_id || e.siteId || ''}|${e.dong}`;
      (groups[k] = groups[k] || []).push(e);
    });
    const map: Record<string, number> = {};
    Object.values(groups).forEach((g) => {
      g.sort((a, b) => (parseInt(String(a.hogi_no ?? a.hogiNo ?? '').replace(/[^0-9]/g, '') || '0') - parseInt(String(b.hogi_no ?? b.hogiNo ?? '').replace(/[^0-9]/g, '') || '0')))
        .forEach((e, i) => { map[e.id] = i + 1; });
    });
    setDongNo((prev) => ({ ...prev, ...map }));
  };

  // ── D-day 정보: 급한 정도에 따라 색상을 구분 (팔레트 C 기준) ──
  function getDdayInfo(elev: any) {
    const { examDate, installDate, ncStatus, dueDate } = elev;
    if (ncStatus && !ncStatus.includes('운행중')) {
      return {
        label: ncStatus,
        style: { color: C.inkDim, background: '#eef1f5' },
        urgent: false,
      };
    }
    const next: Date | null = dueDate ? new Date(dueDate) : calcDueDate(examDate, installDate, null);
    if (!next || isNaN(next.getTime())) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diffDays = Math.ceil((next.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays < 0)
      return {
        label: '검사기한초과',
        style: { color: '#fff', background: C.red },
        urgent: true,
        diffDays,
      };
    if (diffDays <= 30)
      return {
        label: `D-${diffDays}`,
        style: { color: C.red, background: '#fee2e2' },
        urgent: true,
        diffDays,
      };
    if (diffDays <= 90)
      return {
        label: `D-${diffDays}`,
        style: { color: C.amber, background: '#fef3c7' },
        urgent: true,
        diffDays,
      };
    return null;
  }

  const GENERIC_FAIL_DESC = '안전검사기준에 적합하지 않음';
  const formatFailText = (f: any) => {
    const desc = f.failDesc && f.failDesc !== GENERIC_FAIL_DESC ? f.failDesc : '';
    const inspector = f.failDescInspector || '';
    return [desc, inspector].filter(Boolean).join(' - ') || f.failDesc || inspector || '내용 없음';
  };

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

        const info = {
          uid,
          name: userData.name || '',
          companyId: userData.company_id || '',
          role: userData.role || 'member',
          superAdmin: userData.super_admin || false,
          team: userData.team || '',
        };
        setUserInfo(info);

        // ⚠ 기존: .eq('source','team') 로 팀별현장에서 등록한 현장만 가져와서
        //   관리자/다른 경로로 등록된 같은 주소 현장(예: 에코빌 101·103동)이 검색에서 빠졌음.
        //   + Supabase 기본 1,000행 제한 → 끝까지 나눠서 조회
        const allSites: any[] = [];
        for (let fromRow = 0; ; fromRow += 1000) {
          const { data: page, error: sitesError } = await supabase
            .from('sites')
            .select('id, site_name, name, address, source, team')
            .eq('company_id', userData.company_id)
            .order('id')
            .range(fromRow, fromRow + 999);
          if (sitesError) throw sitesError;
          allSites.push(...(page || []));
          if (!page || page.length < 1000) break;
        }

        const mapped = allSites.map((s: any) => ({
          id: s.id,
          siteName: s.name || s.site_name,
          name: s.name,
          altName: s.site_name,
          address: s.address || '',
          source: s.source,
          teamName: s.team,
        }));

        const isAdmin = userData.role === 'admin' || userData.super_admin === true;

        if (isAdmin) {
          setSites(mapped);
        } else {
          setSites(mapped.filter((s: any) => s.teamName === userData.team));
        }
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        router.push('/login');
        setLoading(false);
        return;
      }
      loadUser(session.user.id);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        router.push('/login');
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // 현장 화면에서 돌아올 때마다 다시 계산 (방금 조회/새로고침한 검사이력 반영)
  useEffect(() => {
    if (!userInfo || sites.length === 0 || selectedSite) return;
    loadOverview();
  }, [userInfo, sites, selectedSite]);

  // 호기별 최신 검사이력 (safety_inspections) — URL 길이/1000행 제한 때문에 나눠서 조회
  const fetchLatestInspections = async (elevIds: string[]) => {
    const map: Record<string, { de: string; en: string }> = {};
    for (let i = 0; i < elevIds.length; i += 150) {
      const { data: insRows } = await supabase
        .from('safety_inspections')
        .select('elevator_id, inspct_de, applc_en_dt')
        .eq('company_id', userInfo!.companyId)
        .in('elevator_id', elevIds.slice(i, i + 150))
        .order('inspct_de', { ascending: false })
        .limit(1000);
      (insRows || []).forEach((r: any) => {
        const de = ymdKey(r.inspct_de);
        if (!de) return;
        const cur = map[r.elevator_id];
        if (!cur || de > cur.de) map[r.elevator_id] = { de, en: ymdKey(r.applc_en_dt) };
      });
    }
    return map;
  };

  const loadOverview = async () => {
    if (!userInfo) return;
    setOverviewLoading(true);
    try {
      const siteIds = sites.map((s: any) => s.id);
      const { data: allElevs, error } = await supabase
        .from('elevators')
        .select('id, hogi_no, elevator_no, dong, installation_place, site_id')
        .in('site_id', siteIds)
        .eq('company_id', userInfo.companyId);

      if (error) throw error;

      const elevNos = (allElevs || []).map((e: any) => e.elevator_no).filter(Boolean) as string[];

      let cacheMap: Record<string, any> = {};
      if (elevNos.length > 0) {
        const { data: cacheRows } = await supabase
          .from('elevator_national_cache')
          .select('elevator_no, exam_date, install_date, status')
          .in('elevator_no', elevNos);
        (cacheRows || []).forEach((c: any) => {
          cacheMap[c.elevator_no] = c;
        });
      }

      const siteMap: Record<string, any> = {};
      sites.forEach((s: any) => {
        siteMap[s.id] = s;
      });

      applyDongNo(allElevs || []);

      const build = (latestMap: Record<string, { de: string; en: string }>) => {
        const rows = (allElevs || [])
          .map((e: any) => {
            const c = e.elevator_no ? cacheMap[e.elevator_no] : null;
            const latest = latestMap[e.id] || null;
            const due = calcDueDate(c?.exam_date, c?.install_date, latest);
            const elev = {
              id: e.id,
              hogiNo: e.hogi_no,
              elevatorNo: e.elevator_no,
              dong: e.dong,
              installationPlace: e.installation_place,
              examDate: latest?.de || c?.exam_date || null,
              installDate: c?.install_date || null,
              ncStatus: c?.status || null,
              dueDate: due ? due.toISOString() : null,
            };
            const dday = getDdayInfo(elev);
            const site = siteMap[e.site_id];
            return dday && dday.urgent && site ? { elev, site, dday } : null;
          })
          .filter(Boolean) as any[];
        rows.sort((a, b) => (a.dday.diffDays ?? 9999) - (b.dday.diffDays ?? 9999));
        return rows;
      };

      const elevIds = (allElevs || []).map((e: any) => e.id);
      let latestMap = await fetchLatestInspections(elevIds);
      let rows = build(latestMap);
      setOverviewList(rows);
      setOverviewLoading(false);

      // ── 아직 '기한초과'로 남은 호기만 공단 API로 최신 이력 재확인 → 저장 → 다시 계산 ──
      const toVerify = rows
        .filter((r: any) => (r.dday.diffDays ?? 0) < 0 && r.elev.elevatorNo && !verifiedRef.current.has(String(r.elev.id)))
        .slice(0, 40);
      if (toVerify.length > 0) {
        for (let i = 0; i < toVerify.length; i++) {
          setOverviewVerifying(`최신 검사이력 확인 중 ${i + 1}/${toVerify.length}`);
          verifiedRef.current.add(String(toVerify[i].elev.id));
          await fetchAndSaveForReport(toVerify[i].elev, toVerify[i].site);
        }
        latestMap = await fetchLatestInspections(elevIds);
        rows = build(latestMap);
        setOverviewList(rows);
      }
    } catch (e) {
      console.error('임박 검사 알림 로드 실패', e);
    } finally {
      setOverviewLoading(false);
      setOverviewVerifying('');
    }
  };

  const handleSiteClick = async (site: any) => {
    setSelectedSite(site);
    setSiteSearch('');
    setSelectedElev(null);
    setElevators([]);
    setSiteReportRows([]);
    setElevsLoading(true);
    try {
      const { data, error } = await supabase
        .from('elevators')
        .select('id, hogi_no, elevator_no, dong, installation_place')
        .eq('site_id', site.id)
        .eq('company_id', userInfo!.companyId);

      if (error) throw error;

      const elevList = (data || []).map((e: any) => ({
        id: e.id,
        hogiNo: e.hogi_no,
        elevatorNo: e.elevator_no,
        dong: e.dong,
        installationPlace: e.installation_place,
      }));

      const elevNos = elevList.map((e: any) => e.elevatorNo).filter(Boolean) as string[];
      let cacheMap: Record<string, any> = {};
      if (elevNos.length > 0) {
        const { data: cacheRows } = await supabase
          .from('elevator_national_cache')
          .select('elevator_no, exam_date, install_date, status')
          .in('elevator_no', elevNos);
        (cacheRows || []).forEach((c: any) => {
          cacheMap[c.elevator_no] = c;
        });
      }

      const merged = elevList.map((e: any) => {
        const c = e.elevatorNo ? cacheMap[e.elevatorNo] : null;
        return {
          ...e,
          examDate: c?.exam_date || null,
          installDate: c?.install_date || null,
          ncStatus: c?.status || null,
        };
      });

      applyDongNo(merged.map((e: any) => ({ ...e, site_id: site.id })));
      setElevators(merged);
      loadSiteReport(site, merged);
    } catch (e) {
      console.error(e);
    } finally {
      setElevsLoading(false);
    }
  };

  const saveInspectionData = async (elev: any, histData: any[], allFails: any[], site: any) => {
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
          site_id: site?.id || '',
          site_name: site?.siteName || site?.name || '',
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
          await supabase.from('safety_inspections').update(payload).eq('id', existingId);
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

  const handleElevClick = async (elev: any, forceRefresh = false, siteOverride?: any) => {
    const site = siteOverride ?? selectedSite;
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
              row.fail_detail.forEach((f: any) => allFails.push({ ...f, examYmd: row.inspct_de }));
            }
          });

          setHistory(histData);
          setFailList(allFails);
          setMemos(memoMap);
          setChecks((prev) => {
            const n = { ...prev };
            cachedRows.forEach((r: any) => { if (r.item_checks && typeof r.item_checks === 'object') n[r.id] = r.item_checks; });
            return n;
          });
          setDataSource('cache');
          setLastSyncedAt(cachedRows[0].updated_at || null);
          setApiLoading(false);
          return;
        }
      }

      // ── 서버 API 라우트 경유 호출 (기존 직접 fetch → /api/inspect) ──
      const histRes = await fetch(`/api/inspect?type=history&elevator_no=${elev.elevatorNo}`);
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

      const allFails: any[] = [];
      for (const h of histData.filter((h) => h.failCd)) {
        const failRes = await fetch(`/api/inspect?type=fail&fail_cd=${h.failCd}`);
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

      await saveInspectionData(elev, histData, allFails, site);

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
      const ids = (savedRows || []).map((r: any) => r.id);
      if (ids.length) {
        const { data: ckRows, error: ckErr } = await supabase.from('safety_inspections').select('id, item_checks').in('id', ids);
        if (ckErr && String(ckErr.message).includes('item_checks')) setNeedsMigration(true);
        setChecks((prev) => {
          const n = { ...prev };
          (ckRows || []).forEach((r: any) => { if (r.item_checks && typeof r.item_checks === 'object') n[r.id] = r.item_checks; });
          return n;
        });
      }
    } catch (e: any) {
      setApiError(`조회 실패: ${e.message}`);
    } finally {
      setApiLoading(false);
    }
  };

  const goToElevator = async (site: any, elev: any) => {
    await handleSiteClick(site);
    await handleElevClick(elev, false, site);
  };

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
        const { error } = await supabase.from('safety_inspections').update(payload).eq('id', current.docId);
        if (error) throw error;
      } else {
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

  const updateMemo = (key: string, field: 'memo' | 'status', value: string) => {
    setMemos((prev) => ({
      ...prev,
      [key]: { ...(prev[key] || { memo: '', status: '미대응' }), [field]: value },
    }));
  };

  const fetchAndSaveForReport = async (elev: any, site: any) => {
    if (!elev.elevatorNo) return null;
    try {
      // ── 서버 API 라우트 경유 호출 ──
      const histRes = await fetch(`/api/inspect?type=history&elevator_no=${elev.elevatorNo}`);
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

      if (histData.length === 0) return null;

      const allFails: any[] = [];
      for (const h of histData.filter((h) => h.failCd)) {
        const failRes = await fetch(`/api/inspect?type=fail&fail_cd=${h.failCd}`);
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

      await saveInspectionData(elev, histData, allFails, site);

      const latest = histData[0];
      const latestFails = allFails
        .filter((f) => f.examYmd === latest.inspctDe)
        .map(({ examYmd, ...rest }) => rest);

      let finalFails = latestFails;
      let failSourceDe = latest.inspctDe;
      if (finalFails.length === 0) {
        const failRecord = histData.find((h) => allFails.some((f) => f.examYmd === h.inspctDe));
        if (failRecord) {
          finalFails = allFails
            .filter((f) => f.examYmd === failRecord.inspctDe)
            .map(({ examYmd, ...rest }) => rest);
          failSourceDe = failRecord.inspctDe;
        }
      }

      return {
        elevator_id: elev.id,
        inspct_de: latest.inspctDe,
        inspct_kind_nm: latest.inspctKindNm,
        disp_words: latest.dispWords,
        fail_cd: latest.failCd,
        fail_detail: latestFails,
        status: '미대응',
        user_memo: '',
        _failSource: { inspct_de: failSourceDe, fail_detail: finalFails },
      };
    } catch (e) {
      console.error(`${elev.elevatorNo} 조회 실패`, e);
      return null;
    }
  };

  const loadSiteReportAndPrint = async () => {
    if (!selectedSite || !userInfo || elevators.length === 0) return;

    setSelectedElev(null);
    setHistory([]);
    setFailList([]);

    setSiteReportLoading(true);
    setReportProgress('');
    try {
      const elevIds = elevators.map((e: any) => e.id);
      const { data, error } = await supabase
        .from('safety_inspections')
        .select('elevator_id, inspct_de, inspct_kind_nm, disp_words, fail_cd, fail_detail, status, user_memo')
        .eq('company_id', userInfo.companyId)
        .in('elevator_id', elevIds)
        .order('inspct_de', { ascending: false });

      if (error) throw error;

      const rowsByElev: Record<string, any[]> = {};
      (data || []).forEach((row: any) => {
        if (!rowsByElev[row.elevator_id]) rowsByElev[row.elevator_id] = [];
        rowsByElev[row.elevator_id].push(row);
      });

      const latestMap: Record<string, any> = {};
      Object.keys(rowsByElev).forEach((elevId) => {
        const rows = rowsByElev[elevId];
        const latestRow = rows[0];
        const failRow = rows.find((r) => Array.isArray(r.fail_detail) && r.fail_detail.length > 0);
        latestMap[elevId] = { ...latestRow, _failSource: failRow || null };
      });

      const missing = elevators.filter((e: any) => !latestMap[e.id] && e.elevatorNo);

      if (missing.length > 0) {
        for (let i = 0; i < missing.length; i++) {
          setReportProgress(`검사이력 미조회 승강기 확인 중 (${i + 1}/${missing.length})`);
          const result = await fetchAndSaveForReport(missing[i], selectedSite);
          if (result) latestMap[missing[i].id] = result;
        }
      }

      const rows = elevators.map((e: any) => ({
        elev: e,
        latest: latestMap[e.id] || null,
      }));

      setSiteReportRows(rows);
      setReportProgress('');
      setTimeout(() => window.print(), 300);
    } catch (e) {
      console.error(e);
      alert('보고서 데이터를 불러오지 못했습니다.');
    } finally {
      setSiteReportLoading(false);
    }
  };

  // ─────────────────────────────────────────────
  // 지적사항 항목별 체크/비고 (safety_inspections.item_checks jsonb)
  // ─────────────────────────────────────────────
  const itemKey = (f: any, i: number) => `${i}|${f.standardArticle || ''}|${String(f.failDesc || '').slice(0, 30)}`;
  const getCheck = (rowId: string | undefined, key: string): ItemCheck =>
    (rowId && checks[rowId]?.[key]) || { done: false, note: '' };
  const setCheck = (rowId: string | undefined, key: string, patch: Partial<ItemCheck>) => {
    if (!rowId) return;
    setChecks((prev) => {
      const row = { ...(prev[rowId] || {}) };
      const cur = row[key] || { done: false, note: '' };
      const next: ItemCheck = { ...cur, ...patch };
      if (patch.done === true && !cur.done) next.at = new Date().toISOString();
      if (patch.done === false) delete next.at;
      row[key] = next;
      return { ...prev, [rowId]: row };
    });
    setDirty((d) => ({ ...d, [rowId]: true }));
  };

  const saveRowChecks = async (rowId: string, totalItems: number) => {
    if (!rowId) return;
    setSavingRow(rowId);
    try {
      const row: Record<string, ItemCheck> = checks[rowId] || {};
      const doneCnt = Object.values(row).filter((c) => c.done).length;
      const payload: any = { item_checks: row, updated_at: new Date().toISOString() };
      if (totalItems > 0 && doneCnt === totalItems) payload.status = '완료';
      else if (doneCnt > 0) payload.status = '대응중';
      const { error } = await supabase.from('safety_inspections').update(payload).eq('id', rowId);
      if (error) throw error;
      setDirty((d) => { const n = { ...d }; delete n[rowId]; return n; });
    } catch (e: any) {
      if (String(e?.message || '').includes('item_checks')) setNeedsMigration(true);
      alert(`저장 실패: ${e.message}`);
    } finally {
      setSavingRow('');
    }
  };

  // ── 현장 전체 지적사항 불러오기 (화면 표시용, 인쇄는 별도) ──
  const loadSiteReport = async (site: any = selectedSite, elevs: any[] = elevators) => {
    if (!site || !userInfo || elevs.length === 0) return;
    setSiteReportLoading(true);
    setReportProgress('');
    try {
      const elevIds = elevs.map((e: any) => e.id);
      const query = async () => {
        const base = 'id, elevator_id, inspct_de, inspct_kind_nm, disp_words, fail_cd, fail_detail, status, user_memo, updated_at';
        let res: { data: any[] | null; error: any } = await supabase.from('safety_inspections').select(`${base}, item_checks`)
          .eq('company_id', userInfo.companyId).in('elevator_id', elevIds).order('inspct_de', { ascending: false });
        if (res.error && String(res.error.message).includes('item_checks')) {
          setNeedsMigration(true);
          res = await supabase.from('safety_inspections').select(`${base}`)
            .eq('company_id', userInfo.companyId).in('elevator_id', elevIds).order('inspct_de', { ascending: false });
        }
        if (res.error) throw res.error;
        return (res.data || []) as any[];
      };

      let data = await query();
      const have = new Set(data.map((r: any) => r.elevator_id));
      const missing = elevs.filter((e: any) => !have.has(e.id) && e.elevatorNo);
      if (missing.length > 0) {
        for (let i = 0; i < missing.length; i++) {
          setReportProgress(`검사이력 확인 중 ${i + 1}/${missing.length}`);
          await fetchAndSaveForReport(missing[i], site);
        }
        data = await query();
      }

      const rowsByElev: Record<string, any[]> = {};
      data.forEach((row: any) => {
        (rowsByElev[row.elevator_id] = rowsByElev[row.elevator_id] || []).push(row);
      });
      const latestMap: Record<string, any> = {};
      Object.keys(rowsByElev).forEach((id) => {
        const rows = rowsByElev[id];
        const failRow = rows.find((r) => Array.isArray(r.fail_detail) && r.fail_detail.length > 0);
        latestMap[id] = { ...rows[0], _failSource: failRow || null };
      });

      setSiteReportRows(elevs.map((e: any) => ({ elev: e, latest: latestMap[e.id] || null })));
      const ck: typeof checks = {};
      data.forEach((r: any) => { if (r.item_checks && typeof r.item_checks === 'object') ck[r.id] = r.item_checks; });
      setChecks((prev) => ({ ...prev, ...ck }));
      setDirty({});
    } catch (e) {
      console.error(e);
      alert('지적사항을 불러오지 못했습니다.');
    } finally {
      setSiteReportLoading(false);
      setReportProgress('');
    }
  };

  const doPrint = (mode: 'site' | 'elev') => {
    if (Object.keys(dirty).length > 0 && !confirm('저장하지 않은 체크/비고가 있어요. 화면에 보이는 그대로 인쇄할까요?')) return;
    setPrintMode(mode);
    setTimeout(() => window.print(), 250);
  };

  // 공백 무시 + 현장명(name/site_name)·주소 모두에서 검색 ('에코빌103동' = '에코빌 103동')
  const norm = (v: any) => String(v || '').toLowerCase().replace(/\s+/g, '');
  const filteredSites =
    siteSearch.trim().length >= 1
      ? sites
          .filter((s: any) => {
            const q = norm(siteSearch);
            return [s.siteName, s.name, s.altName, s.address].some((v) => norm(v).includes(q));
          })
          .sort((a: any, b: any) => String(a.siteName || '').localeCompare(String(b.siteName || ''), 'ko', { numeric: true }))
          .slice(0, 30)
      : sites.slice(0, 20);

  const sortedElevators = [...elevators].sort(
    (a: any, b: any) =>
      parseInt(String(a.hogiNo || '0').replace(/[^0-9]/g, '') || '0') -
      parseInt(String(b.hogiNo || '0').replace(/[^0-9]/g, '') || '0')
  );

  const groupedByDong = siteReportRows.reduce((acc: Record<string, typeof siteReportRows>, r) => {
    const key = r.elev.dong || '동 정보 없음';
    if (!acc[key]) acc[key] = [];
    acc[key].push(r);
    return acc;
  }, {});

  const conditionalSummaryRows = siteReportRows
    .filter((r) => r.latest?.disp_words && r.latest.disp_words !== '합격')
    .map((r) => {
      const failSourceRow = r.latest?._failSource || r.latest;
      const fails: any[] = Array.isArray(failSourceRow?.fail_detail) ? failSourceRow.fail_detail : [];
      return { ...r, failSourceRow, fails };
    })
    .filter((r) => r.fails.length > 0)
    .sort((a, b) => {
      const dongA = a.elev.dong || '';
      const dongB = b.elev.dong || '';
      if (dongA !== dongB) return dongA.localeCompare(dongB, 'ko');
      return (
        parseInt(String(a.elev.hogiNo || '0').replace(/[^0-9]/g, '') || '0') -
        parseInt(String(b.elev.hogiNo || '0').replace(/[^0-9]/g, '') || '0')
      );
    });

  // ───── 표시 헬퍼 ─────
  const hogiNum = (h: any) => String(h || '').replace(/[^0-9]/g, '');
  const unitLabel = (e: any) => `${e?.dong ? e.dong + ' ' : ''}${(e?.dong && dongNo[e.id]) || hogiNum(e?.hogiNo)}호기`;
  const unitSort = (a: any, b: any) => {
    const da = a.dong || '', db = b.dong || '';
    if (da !== db) return da.localeCompare(db, 'ko', { numeric: true });
    return ((dongNo[a.id] || parseInt(hogiNum(a.hogiNo) || '0')) - (dongNo[b.id] || parseInt(hogiNum(b.hogiNo) || '0')));
  };
  const resultColor = (w?: string) => (w === '합격' ? C.green : w === '조건부합격' ? C.amber : w ? C.red : C.inkFaint);
  const DONE = '#15803d';
  const siteName = selectedSite?.siteName || selectedSite?.name || '';
  const today = new Date().toLocaleDateString('ko-KR');

  const unitRows = [...siteReportRows].sort((a, b) => unitSort(a.elev, b.elev));
  const condRows = unitRows
    .filter((r) => r.latest?.disp_words && r.latest.disp_words !== '합격')
    .map((r) => {
      const src = r.latest?._failSource || r.latest;
      const fails: any[] = Array.isArray(src?.fail_detail) ? src.fail_detail : [];
      const done = fails.filter((f, i) => getCheck(src?.id, itemKey(f, i)).done).length;
      return { ...r, src, fails, done };
    })
    .filter((r) => r.fails.length > 0);
  const totalItems = condRows.reduce((a, r) => a + r.fails.length, 0);
  const doneItems = condRows.reduce((a, r) => a + r.done, 0);
  // 미처리 탭: 한 번 보인 호기는 다 체크해도 사라지지 않고 유지 (탭을 다시 누르면 정리)
  if (condFilter === 'open') condRows.forEach((r) => { if (r.done < r.fails.length) keepOpenRef.current.add(String(r.elev.id)); });
  const shownCond = condRows.filter((r) =>
    condFilter === 'all' ? true : condFilter === 'done' ? r.done === r.fails.length
    : r.done < r.fails.length || keepOpenRef.current.has(String(r.elev.id)));
  const dirtyCount = Object.keys(dirty).length;
  const saveAllDirty = async () => {
    for (const r of condRows) if (r.src?.id && dirty[r.src.id]) await saveRowChecks(r.src.id, r.fails.length);
  };

  // ───── UI 조각 ─────
  const card: CSSProperties = { background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14 };
  const sub: CSSProperties = { fontSize: 12, color: C.inkFaint };
  const btn = (primary = false): CSSProperties => ({
    height: 36, padding: '0 14px', borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
    border: primary ? 'none' : `1px solid ${C.line}`, background: primary ? C.ink : C.surface, color: primary ? '#fff' : C.inkSoft,
  });
  const chip = (w?: string) => (
    <span style={{ fontSize: 11.5, fontWeight: 800, padding: '2px 8px', borderRadius: 6, color: resultColor(w), background: `${resultColor(w)}14`, whiteSpace: 'nowrap' }}>
      {w || '이력 없음'}
    </span>
  );

  // 지적항목 1줄 (체크 + 내용 + 비고)
  const renderItem = (rowId: string | undefined, f: any, i: number) => {
    const k = itemKey(f, i);
    const c = getCheck(rowId, k);
    const color = c.done ? DONE : C.ink;
    return (
      <div key={i} style={{ display: 'flex', gap: 12, padding: '12px 0', borderTop: i ? `1px solid ${C.bg}` : 'none' }}>
        <button
          onClick={() => setCheck(rowId, k, { done: !c.done })}
          disabled={!rowId}
          aria-label="처리 완료"
          style={{
            width: 24, height: 24, borderRadius: 7, flexShrink: 0, marginTop: 1, cursor: rowId ? 'pointer' : 'default',
            border: c.done ? 'none' : `2px solid ${C.line}`, background: c.done ? DONE : '#fff', color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 900,
          }}
        >{c.done ? '✓' : ''}</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          {(f.standardArticle || f.standardTitle1) && (
            <div style={{ fontSize: 12, fontWeight: 700, color: c.done ? DONE : C.inkDim, marginBottom: 2 }}>
              {f.standardArticle} {f.standardTitle1}
            </div>
          )}
          <div style={{ fontSize: 13.5, lineHeight: 1.5, color, fontWeight: 600, transition: 'color .15s' }}>{formatFailText(f)}</div>
          <input
            value={c.note}
            onChange={(e) => setCheck(rowId, k, { note: e.target.value })}
            disabled={!rowId}
            placeholder="비고 · 처리 내용"
            style={{
              marginTop: 8, width: '100%', height: 36, borderRadius: 9, padding: '0 11px', fontSize: 13, outline: 'none',
              border: `1px solid ${c.done ? `${DONE}55` : C.line}`, background: c.done ? `${DONE}08` : '#fff', color: c.done ? DONE : C.ink,
              boxSizing: 'border-box',
            }}
          />
          {c.done && c.at && <div style={{ fontSize: 11, color: DONE, marginTop: 4 }}>처리 {new Date(c.at).toLocaleDateString('ko-KR')}</div>}
        </div>
      </div>
    );
  };

  const renderUnit = (r: (typeof condRows)[number]) => {
    const allDone = r.done === r.fails.length;
    const id = r.src?.id;
    return (
      <div key={r.elev.id} style={{ ...card, borderColor: allDone ? `${DONE}55` : C.line, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', background: allDone ? `${DONE}0a` : '#fafbfc', borderBottom: `1px solid ${C.line}` }}>
          <button onClick={() => handleElevClick(r.elev)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 15, fontWeight: 800, color: C.ink }}>
            {unitLabel(r.elev)}
          </button>
          {chip(r.latest?.disp_words)}
          <span style={sub}>{fmtYmd(r.src?.inspct_de)} {r.src?.inspct_kind_nm || ''}</span>
          <span style={{ marginLeft: 'auto', fontSize: 12.5, fontWeight: 800, color: allDone ? DONE : C.inkDim }}>{r.done}/{r.fails.length}</span>
          {id && dirty[id] && (
            <button onClick={() => saveRowChecks(id, r.fails.length)} disabled={savingRow === id} style={{ ...btn(true), height: 30, padding: '0 12px', fontSize: 12 }}>
              {savingRow === id ? '저장 중' : '저장'}
            </button>
          )}
        </div>
        <div style={{ padding: '2px 16px 6px' }}>
          {r.fails.map((f: any, i: number) => renderItem(id, f, i))}
        </div>
      </div>
    );
  };

  if (loading)
    return (
      <div style={{ background: C.bg, color: C.inkDim, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        로딩 중...
      </div>
    );

  // ───── 인쇄 문서 ─────
  const pTh: CSSProperties = { border: '1px solid #cbd5e1', background: '#f1f5f9', padding: '6px 8px', fontSize: '9.5pt', fontWeight: 700, textAlign: 'left' };
  const pTd: CSSProperties = { border: '1px solid #cbd5e1', padding: '6px 8px', fontSize: '9.5pt', verticalAlign: 'top' };
  const printItems = (rowId: string | undefined, fails: any[]) => (
    <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 6 }}>
      <thead>
        <tr>
          <th style={{ ...pTh, width: 28, textAlign: 'center' }}>No</th>
          <th style={pTh}>지적 내용</th>
          <th style={{ ...pTh, width: 52, textAlign: 'center' }}>처리</th>
          <th style={{ ...pTh, width: '32%' }}>비고</th>
        </tr>
      </thead>
      <tbody>
        {fails.map((f, i) => {
          const c = getCheck(rowId, itemKey(f, i));
          return (
            <tr key={i} style={{ breakInside: 'avoid' }}>
              <td style={{ ...pTd, textAlign: 'center' }}>{i + 1}</td>
              <td style={pTd}>
                {(f.standardArticle || f.standardTitle1) && <div style={{ fontSize: '8.5pt', color: '#475569', fontWeight: 700 }}>{f.standardArticle} {f.standardTitle1}</div>}
                <div style={{ color: c.done ? DONE : '#0f172a' }}>{formatFailText(f)}</div>
              </td>
              <td style={{ ...pTd, textAlign: 'center', fontWeight: 800, color: c.done ? DONE : '#94a3b8' }}>
                {c.done ? '완료' : '미처리'}
                {c.done && c.at && <div style={{ fontSize: '7.5pt', fontWeight: 500 }}>{new Date(c.at).toLocaleDateString('ko-KR')}</div>}
              </td>
              <td style={{ ...pTd, color: c.done ? DONE : '#0f172a' }}>{c.note || ''}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );

  const printSite = (
    <div className="ins-print">
      <div style={{ borderBottom: '2px solid #0f172a', paddingBottom: 8, marginBottom: 10, display: 'flex', alignItems: 'flex-end' }}>
        <div>
          <div style={{ fontSize: '9pt', color: '#64748b' }}>승강기 안전검사 지적사항 처리현황</div>
          <div style={{ fontSize: '17pt', fontWeight: 800 }}>{siteName}</div>
        </div>
        <div style={{ marginLeft: 'auto', textAlign: 'right', fontSize: '9pt', color: '#475569' }}>
          출력일 {today}<br />조건부·불합격 {condRows.length}대 · 지적 {totalItems}건 · 처리 {doneItems}건 ({totalItems ? Math.round((doneItems / totalItems) * 100) : 0}%)
        </div>
      </div>
      {condRows.length > 0 && (
        <div style={{ fontSize: '9pt', color: '#334155', marginBottom: 12, lineHeight: 1.6 }}>
          <b>대상 호기</b> : {condRows.map((r) => unitLabel(r.elev)).join(' · ')}
        </div>
      )}
      {condRows.map((r) => (
        <div key={r.elev.id} style={{ marginBottom: 14, breakInside: 'avoid' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontSize: '11.5pt', fontWeight: 800 }}>{unitLabel(r.elev)}</span>
            <span style={{ fontSize: '9pt', fontWeight: 700, color: resultColor(r.latest?.disp_words) }}>{r.latest?.disp_words}</span>
            <span style={{ fontSize: '8.5pt', color: '#64748b' }}>
              {fmtYmd(r.src?.inspct_de)} {r.src?.inspct_kind_nm || ''}{r.elev.elevatorNo ? ` · 승강기번호 ${r.elev.elevatorNo}` : ''}
            </span>
            <span style={{ marginLeft: 'auto', fontSize: '9pt', fontWeight: 700, color: r.done === r.fails.length ? DONE : '#475569' }}>처리 {r.done}/{r.fails.length}</span>
          </div>
          {printItems(r.src?.id, r.fails)}
        </div>
      ))}
      {condRows.length === 0 && <div style={{ padding: 20, textAlign: 'center', color: '#64748b' }}>조건부·불합격 지적사항이 없습니다.</div>}

      <div style={{ breakBefore: condRows.length > 4 ? 'page' : 'auto', marginTop: 18 }}>
        <div style={{ fontSize: '11pt', fontWeight: 800, borderBottom: '1px solid #0f172a', paddingBottom: 4, marginBottom: 6 }}>전체 승강기 검사현황 ({unitRows.length}대)</div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>{['호기', '최근검사일', '검사종류', '결과', '지적 처리'].map((h) => <th key={h} style={pTh}>{h}</th>)}</tr></thead>
          <tbody>
            {unitRows.map((r) => {
              const cr = condRows.find((x) => x.elev.id === r.elev.id);
              return (
                <tr key={r.elev.id}>
                  <td style={pTd}>{unitLabel(r.elev)}</td>
                  <td style={pTd}>{r.latest ? fmtYmd(r.latest.inspct_de) : '-'}</td>
                  <td style={pTd}>{r.latest?.inspct_kind_nm || '-'}</td>
                  <td style={{ ...pTd, fontWeight: 700, color: resultColor(r.latest?.disp_words) }}>{r.latest?.disp_words || '-'}</td>
                  <td style={{ ...pTd, color: cr && cr.done === cr.fails.length ? DONE : '#0f172a' }}>{cr ? `${cr.done}/${cr.fails.length}` : '-'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );

  const printElev = selectedElev && (
    <div className="ins-print">
      <div style={{ borderBottom: '2px solid #0f172a', paddingBottom: 8, marginBottom: 12 }}>
        <div style={{ fontSize: '9pt', color: '#64748b' }}>승강기 안전검사 이력</div>
        <div style={{ fontSize: '16pt', fontWeight: 800 }}>{siteName} · {unitLabel(selectedElev)}</div>
        <div style={{ fontSize: '9pt', color: '#475569' }}>승강기번호 {selectedElev.elevatorNo || '-'} · 출력일 {today}</div>
      </div>
      {history.map((h, i) => {
        const fails = failList.filter((f) => f.examYmd === h.inspctDe);
        const md = memos[`${selectedElev.id}_${h.inspctDe}`];
        return (
          <div key={i} style={{ marginBottom: 12, breakInside: 'avoid' }}>
            <div style={{ fontSize: '10.5pt', fontWeight: 800 }}>
              {fmtYmd(h.inspctDe)} {h.inspctKindNm} <span style={{ color: resultColor(h.dispWords) }}>{h.dispWords}</span>
            </div>
            <div style={{ fontSize: '8.5pt', color: '#64748b' }}>{h.inspctInsttNm} · 유효기간 {fmtYmd(h.applcBeDt)} ~ {fmtYmd(h.applcEnDt)}</div>
            {fails.length > 0 && printItems(md?.docId, fails)}
          </div>
        );
      })}
    </div>
  );

  return (
    <>
      <style>{`
        .ins-print { display: none; }
        @media print {
          @page { size: A4; margin: 12mm; }
          body { padding-left: 0 !important; background: #fff !important; }
          .ins-screen { display: none !important; }
          .ins-print { display: block !important; color: #0f172a; font-family: 'Pretendard', 'Malgun Gothic', sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      `}</style>

      {printMode === 'elev' && selectedElev ? printElev : selectedSite ? printSite : null}

      <div className="ins-screen" style={{ background: C.bg, minHeight: '100vh', paddingBottom: 120, color: C.ink }}>
        {/* 헤더 */}
        <header style={{
          position: 'sticky', top: 0, zIndex: 20, background: `${C.bg}ee`, backdropFilter: 'blur(8px)',
          borderBottom: `1px solid ${C.line}`, minHeight: 60, display: 'flex', alignItems: 'center', gap: 10, padding: '10px 20px', flexWrap: 'wrap',
        }}>
          {selectedElev ? (
            <button onClick={() => setSelectedElev(null)} style={{ ...btn(), height: 34, padding: '0 10px' }}>‹ 지적사항</button>
          ) : null}
          <div style={{ minWidth: 0 }}>
            <div style={sub}>검사</div>
            <div style={{ fontSize: 18, fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {selectedSite ? siteName : '검사 지적사항'}{selectedElev ? ` · ${unitLabel(selectedElev)}` : ''}
            </div>
          </div>
          <div style={{ flex: 1 }} />
          {selectedSite && !selectedElev && (
            <>
              {dirtyCount > 0 && <button onClick={saveAllDirty} style={btn(true)}>모두 저장 ({dirtyCount})</button>}
              <button onClick={() => doPrint('site')} disabled={siteReportLoading || unitRows.length === 0} style={btn()}>인쇄 · PDF</button>
              <button onClick={() => { setSelectedSite(null); setSelectedElev(null); setElevators([]); setSiteReportRows([]); }} style={{ ...btn(), border: 'none', background: 'none', color: C.inkFaint }}>현장 변경</button>
            </>
          )}
          {selectedElev && history.length > 0 && (
            <>
              <button onClick={() => handleElevClick(selectedElev, true)} style={btn()}>새로고침</button>
              <button onClick={() => doPrint('elev')} style={btn()}>인쇄 · PDF</button>
            </>
          )}
        </header>

        <main style={{ maxWidth: 920, margin: '0 auto', padding: '18px 16px' }}>
          {needsMigration && (
            <div style={{ ...card, background: '#fffbeb', borderColor: '#fde68a', padding: '12px 14px', marginBottom: 14, fontSize: 12.5, color: '#92400e' }}>
              체크/비고 저장용 컬럼이 아직 없어요. Supabase SQL Editor에서 한 번 실행해 주세요:
              <code style={{ display: 'block', marginTop: 6, background: '#fff', padding: '6px 8px', borderRadius: 6, color: '#0f172a' }}>
                alter table safety_inspections add column if not exists item_checks jsonb default &apos;{'{}'}&apos;::jsonb;
              </code>
            </div>
          )}

          {/* ── 현장 선택 전 ── */}
          {!selectedSite && (
            <div style={{ maxWidth: 620, margin: '10px auto 0' }}>
              <div style={{ position: 'relative' }}>
                <input
                  value={siteSearch}
                  onChange={(e) => setSiteSearch(e.target.value)}
                  placeholder="현장명으로 검색"
                  autoFocus
                  style={{ width: '100%', height: 50, borderRadius: 14, border: `1px solid ${C.line}`, background: C.surface, padding: '0 44px 0 16px', fontSize: 15, outline: 'none', boxSizing: 'border-box' }}
                />
                {siteSearch && <button onClick={() => setSiteSearch('')} style={{ position: 'absolute', right: 12, top: 13, background: 'none', border: 'none', color: C.inkFaint, fontSize: 16, cursor: 'pointer' }}>✕</button>}
              </div>
              {siteSearch && (
                <div style={{ ...card, marginTop: 8, overflow: 'hidden' }}>
                  {filteredSites.length === 0 && <div style={{ padding: 28, textAlign: 'center', color: C.inkFaint, fontSize: 13 }}>검색 결과가 없습니다</div>}
                  {filteredSites.map((s: any, i: number) => (
                    <button key={s.id} onClick={() => handleSiteClick(s)} style={{
                      width: '100%', textAlign: 'left', padding: '13px 16px', background: 'none', border: 'none', borderTop: i ? `1px solid ${C.bg}` : 'none',
                      fontSize: 14, fontWeight: 600, color: C.ink, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
                    }}>
                      <span style={{ color: C.inkFaint }}>{Icon.building(15)}</span>
                      <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                        <span>{s.siteName || s.name}</span>
                        {s.address && <span style={{ ...sub, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.address}</span>}
                      </span>
                      {s.teamName && <span style={{ ...sub, marginLeft: 'auto', flexShrink: 0 }}>{s.teamName}</span>}
                    </button>
                  ))}
                </div>
              )}

              <div style={{ marginTop: 26 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
                  <b style={{ fontSize: 15 }}>검사 예정</b>
                  <span style={sub}>90일 이내 · {overviewList.length}대</span>
                  {overviewVerifying && <span style={{ ...sub, marginLeft: 'auto' }}>{overviewVerifying}</span>}
                </div>
                <div style={{ ...card, overflow: 'hidden' }}>
                  {overviewLoading && <div style={{ padding: 28, textAlign: 'center', color: C.inkFaint, fontSize: 13 }}>불러오는 중...</div>}
                  {!overviewLoading && overviewList.length === 0 && <div style={{ padding: 28, textAlign: 'center', color: C.inkFaint, fontSize: 13 }}>90일 이내 예정된 검사가 없습니다</div>}
                  {!overviewLoading && overviewList.map((r: any, i: number) => (
                    <button key={r.elev.id} onClick={() => goToElevator(r.site, r.elev)} style={{
                      width: '100%', textAlign: 'left', padding: '12px 16px', background: 'none', border: 'none', borderTop: i ? `1px solid ${C.bg}` : 'none',
                      cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10,
                    }}>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: C.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.site.siteName || r.site.name}</div>
                        <div style={sub}>{unitLabel(r.elev)}</div>
                      </div>
                      <span style={{ ...r.dday.style, fontSize: 12, fontWeight: 800, padding: '3px 9px', borderRadius: 7, whiteSpace: 'nowrap' }}>{r.dday.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── 현장 지적사항 ── */}
          {selectedSite && !selectedElev && (
            <>
              {(elevsLoading || siteReportLoading) && (
                <div style={{ ...card, padding: 40, textAlign: 'center', color: C.inkFaint, fontSize: 13 }}>{reportProgress || '검사 이력을 불러오는 중...'}</div>
              )}
              {!elevsLoading && !siteReportLoading && elevators.length === 0 && (
                <div style={{ ...card, padding: 40, textAlign: 'center', color: C.inkFaint, fontSize: 13 }}>등록된 호기가 없습니다</div>
              )}

              {!elevsLoading && !siteReportLoading && unitRows.length > 0 && (
                <>
                  {/* 요약 */}
                  <div style={{ ...card, padding: '16px 18px', marginBottom: 12 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 8 }}>
                      {[
                        ['전체 호기', unitRows.length, '대', C.ink],
                        ['조건부·불합격', condRows.length, '대', condRows.length ? C.amber : C.ink],
                        ['지적 처리', doneItems, `/${totalItems}`, doneItems === totalItems && totalItems ? DONE : C.ink],
                        ['남은 항목', totalItems - doneItems, '건', totalItems - doneItems ? C.red : C.ink],
                      ].map(([k, v, u, c]) => (
                        <div key={k as string} style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 12, color: C.inkFaint, whiteSpace: 'nowrap' }}>{k}</div>
                          <div style={{ fontSize: 22, fontWeight: 800, color: c as string, letterSpacing: -0.4, whiteSpace: 'nowrap' }}>
                            {v}<span style={{ fontSize: 13, color: C.inkFaint, fontWeight: 600, marginLeft: 1 }}>{u}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                    {totalItems > 0 && (
                      <div style={{ height: 6, borderRadius: 3, background: C.bg, overflow: 'hidden', marginTop: 12 }}>
                        <div style={{ width: `${(doneItems / totalItems) * 100}%`, height: '100%', background: DONE, borderRadius: 3, transition: 'width .2s' }} />
                      </div>
                    )}
                  </div>

                  {/* 필터 */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 10, flexWrap: 'wrap' }}>
                    {([['open', '미처리', condRows.filter((r) => r.done < r.fails.length).length], ['done', '처리완료', condRows.filter((r) => r.done === r.fails.length).length], ['all', '전체', condRows.length]] as const).map(([k, label, n]) => (
                      <button key={k} onClick={() => { keepOpenRef.current = new Set(); setCondFilter(k); }} style={{
                        height: 32, padding: '0 12px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13,
                        background: condFilter === k ? C.line : 'transparent', color: condFilter === k ? C.ink : C.inkDim, fontWeight: condFilter === k ? 800 : 600,
                      }}>{label} <span style={{ color: C.inkFaint, fontWeight: 500 }}>{n}</span></button>
                    ))}
                    <button onClick={() => setShowAllUnits((v) => !v)} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: C.inkDim, fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>
                      전체 호기 보기 {showAllUnits ? '▴' : '▾'}
                    </button>
                  </div>

                  {/* 전체 호기 (펼침) */}
                  {showAllUnits && (
                    <div style={{ ...card, padding: 12, marginBottom: 12, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {unitRows.map((r) => (
                        <button key={r.elev.id} onClick={() => handleElevClick(r.elev)} style={{
                          display: 'inline-flex', alignItems: 'center', gap: 6, height: 32, padding: '0 10px', borderRadius: 8,
                          border: `1px solid ${C.line}`, background: '#fff', cursor: 'pointer', fontSize: 12.5, fontWeight: 600, color: C.inkSoft,
                        }}>
                          <span style={{ width: 7, height: 7, borderRadius: '50%', background: resultColor(r.latest?.disp_words) }} />
                          {unitLabel(r.elev)}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* 지적사항 */}
                  <div style={{ display: 'grid', gap: 12 }}>
                    {shownCond.map((r) => renderUnit(r))}
                    {shownCond.length === 0 && (
                      <div style={{ ...card, padding: 40, textAlign: 'center', color: C.inkFaint, fontSize: 13 }}>
                        {condRows.length === 0 ? '조건부·불합격 지적사항이 없습니다' : condFilter === 'open' ? '모든 지적사항을 처리했어요' : '해당 항목이 없습니다'}
                      </div>
                    )}
                  </div>
                </>
              )}
            </>
          )}

          {/* ── 호기 상세 ── */}
          {selectedSite && selectedElev && (
            <div style={{ display: 'grid', gap: 12 }}>
              <div style={{ ...sub, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <span>승강기번호 {selectedElev.elevatorNo || '없음'}</span>
                {selectedElev.installationPlace && <span>{selectedElev.installationPlace}</span>}
                {dataSource && <span>{dataSource === 'cache' ? `저장된 데이터${lastSyncedAt ? ` · ${new Date(lastSyncedAt).toLocaleDateString('ko-KR')}` : ''}` : '방금 최신 정보를 가져왔어요'}</span>}
              </div>
              {apiLoading && <div style={{ ...card, padding: 40, textAlign: 'center', color: C.inkFaint, fontSize: 13 }}>검사이력 조회 중...</div>}
              {apiError && <div style={{ ...card, padding: 14, background: '#fef2f2', borderColor: '#fecaca', color: C.red, fontSize: 13 }}>{apiError}</div>}
              {!apiLoading && !apiError && history.length === 0 && <div style={{ ...card, padding: 40, textAlign: 'center', color: C.inkFaint, fontSize: 13 }}>검사이력이 없습니다</div>}

              {!apiLoading && history.map((h, i) => {
                const key = `${selectedElev.id}_${h.inspctDe}`;
                const md = memos[key] || { memo: '', status: '미대응' };
                const fails = failList.filter((f) => f.examYmd === h.inspctDe);
                const rowId = md.docId;
                const done = fails.filter((f, fi) => getCheck(rowId, itemKey(f, fi)).done).length;
                return (
                  <div key={i} style={{ ...card, overflow: 'hidden' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', background: '#fafbfc', borderBottom: `1px solid ${C.line}`, flexWrap: 'wrap' }}>
                      <b style={{ fontSize: 14.5 }}>{fmtYmd(h.inspctDe)}</b>
                      <span style={sub}>{h.inspctKindNm}</span>
                      {chip(h.dispWords)}
                      {fails.length > 0 && <span style={{ marginLeft: 'auto', fontSize: 12.5, fontWeight: 800, color: done === fails.length ? DONE : C.inkDim }}>{done}/{fails.length}</span>}
                      {rowId && dirty[rowId] && (
                        <button onClick={() => saveRowChecks(rowId, fails.length)} disabled={savingRow === rowId} style={{ ...btn(true), height: 30, padding: '0 12px', fontSize: 12 }}>
                          {savingRow === rowId ? '저장 중' : '저장'}
                        </button>
                      )}
                    </div>
                    <div style={{ padding: '4px 16px 12px' }}>
                      <div style={{ ...sub, padding: '8px 0 2px' }}>{h.inspctInsttNm} · 유효기간 {fmtYmd(h.applcBeDt)} ~ {fmtYmd(h.applcEnDt)}</div>
                      {fails.map((f, fi) => renderItem(rowId, f, fi))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </main>
      </div>

      <div className="ins-screen">
        <TabBar active="inspect" />
      </div>
    </>
  );
}
