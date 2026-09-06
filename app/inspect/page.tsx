'use client';

import { useEffect, useState } from 'react';
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

  // ── D-day 정보: 급한 정도에 따라 색상을 구분 (팔레트 C 기준) ──
  function getDdayInfo(elev: any) {
    const { examDate, installDate, ncStatus } = elev;
    if (ncStatus && !ncStatus.includes('운행중')) {
      return {
        label: ncStatus,
        style: { color: C.inkDim, background: '#eef1f5' },
        urgent: false,
      };
    }
    const baseStr = examDate || installDate;
    if (!baseStr) return null;
    const base = new Date(baseStr);
    if (isNaN(base.getTime())) return null;
    const next = new Date(base);
    next.setFullYear(next.getFullYear() + 1);
    const today = new Date();
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

        const { data: allSites, error: sitesError } = await supabase
          .from('sites')
          .select('id, site_name, name, source, team')
          .eq('company_id', userData.company_id)
          .eq('source', 'team');

        if (sitesError) throw sitesError;

        const mapped = (allSites || []).map((s: any) => ({
          id: s.id,
          siteName: s.name || s.site_name,
          name: s.name,
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

  useEffect(() => {
    if (!userInfo || sites.length === 0) return;
    loadOverview();
  }, [userInfo, sites]);

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

      const rows = (allElevs || [])
        .map((e: any) => {
          const c = e.elevator_no ? cacheMap[e.elevator_no] : null;
          const elev = {
            id: e.id,
            hogiNo: e.hogi_no,
            elevatorNo: e.elevator_no,
            dong: e.dong,
            installationPlace: e.installation_place,
            examDate: c?.exam_date || null,
            installDate: c?.install_date || null,
            ncStatus: c?.status || null,
          };
          const dday = getDdayInfo(elev);
          const site = siteMap[e.site_id];
          return dday && dday.urgent && site ? { elev, site, dday } : null;
        })
        .filter(Boolean) as any[];

      rows.sort((a, b) => (a.dday.diffDays ?? 9999) - (b.dday.diffDays ?? 9999));
      setOverviewList(rows);
    } catch (e) {
      console.error('임박 검사 알림 로드 실패', e);
    } finally {
      setOverviewLoading(false);
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

      setElevators(merged);
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

    setSiteReportRows([]);

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

  const filteredSites =
    siteSearch.trim().length >= 1
      ? sites
          .filter((s: any) => (s.siteName || s.name || '').toLowerCase().includes(siteSearch.toLowerCase()))
          .slice(0, 20)
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

  if (loading)
    return (
      <div
        style={{ background: C.bg, color: C.inkDim }}
        className="min-h-screen flex items-center justify-center"
      >
        <p className="text-sm">로딩 중...</p>
      </div>
    );

  return (
    <>
      <div style={{ background: C.bg, minHeight: '100vh', paddingBottom: 100 }} className="print:bg-white print:pb-0">
        <header
          style={{ background: C.surface, borderBottom: `1px solid ${C.line}` }}
          className="px-4 py-3 flex items-center gap-3 sticky top-0 z-10 print:hidden"
        >
          <button
            onClick={() => router.push('/dashboard')}
            style={{ color: C.inkFaint }}
            className="text-lg leading-none shrink-0"
          >
            ←
          </button>
          <div
            style={{ width: 40, height: 40, borderRadius: 12, background: C.primary, color: '#fff' }}
            className="flex items-center justify-center shrink-0"
          >
            {Icon.clipboard(20)}
          </div>
          <div className="flex-1 min-w-0">
            <h1 style={{ color: C.ink }} className="font-bold text-base leading-tight truncate">
              검사 지적사항
            </h1>
            <p style={{ color: C.inkDim }} className="text-xs truncate">
              {selectedSite
                ? `${selectedSite.siteName || selectedSite.name}${
                    selectedElev ? ` · ${selectedElev.hogiNo}호기` : ''
                  }`
                : '승강기 안전검사 이력 확인'}
            </p>
          </div>
          {selectedSite && (
            <button
              onClick={() => {
                setSelectedSite(null);
                setSelectedElev(null);
                setElevators([]);
              }}
              style={{ color: C.inkFaint }}
              className="text-xs shrink-0"
            >
              처음으로
            </button>
          )}
        </header>

        <div className="max-w-5xl mx-auto px-4 py-4 print:px-0 print:py-0 print:max-w-none">
          {!selectedSite && (
            <div className="max-w-2xl mx-auto mt-6">
              <div>
                <p style={{ color: C.inkDim }} className="text-sm mb-3 text-center">
                  현장을 검색해서 확인할 수 있습니다
                </p>
                <div className="relative">
                  <input
                    value={siteSearch}
                    onChange={(e) => setSiteSearch(e.target.value)}
                    placeholder="현장명 검색..."
                    style={{ background: C.surface, border: `1px solid ${C.line}`, color: C.ink }}
                    className="w-full rounded-xl px-4 py-3 text-sm shadow-sm focus:outline-none"
                  />
                  {siteSearch && (
                    <button
                      onClick={() => setSiteSearch('')}
                      style={{ color: C.inkFaint }}
                      className="absolute right-3 top-3"
                    >
                      ✕
                    </button>
                  )}
                </div>

                {siteSearch &&
                  (filteredSites.length > 0 ? (
                    <div
                      style={{ background: C.surface, border: `1px solid ${C.line}` }}
                      className="mt-2 rounded-xl shadow-sm overflow-hidden"
                    >
                      {filteredSites.map((site: any) => (
                        <button
                          key={site.id}
                          onClick={() => handleSiteClick(site)}
                          style={{ borderColor: C.line, color: C.inkSoft }}
                          className="w-full text-left px-4 py-3 hover:bg-black/[0.02] border-b last:border-0 text-sm font-medium transition-colors flex items-center gap-1.5"
                        >
                          {Icon.building(14)} {site.siteName || site.name}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div
                      style={{ background: C.surface, border: `1px solid ${C.line}`, color: C.inkFaint }}
                      className="mt-4 text-center text-sm py-8 rounded-xl"
                    >
                      검색 결과가 없습니다
                    </div>
                  ))}
              </div>

              <div className="mt-8 pt-6" style={{ borderTop: `1px solid ${C.line}` }}>
                <h2 style={{ color: C.inkSoft }} className="text-sm font-bold mb-2 flex items-center gap-1.5">
                  {Icon.clock(15)} 검사 예정 알림
                </h2>
                <p style={{ color: C.inkFaint }} className="text-xs mb-3">
                  다음 예상 검사일이 90일 이내로 임박한 승강기입니다. 클릭하면 바로 상세 이력으로 이동합니다.
                </p>

                {overviewLoading ? (
                  <div
                    style={{ background: C.surface, border: `1px solid ${C.line}`, color: C.inkFaint }}
                    className="text-center text-sm py-8 rounded-xl"
                  >
                    불러오는 중...
                  </div>
                ) : overviewList.length === 0 ? (
                  <div
                    style={{ background: C.surface, border: `1px solid ${C.line}`, color: C.inkFaint }}
                    className="text-center text-sm py-8 rounded-xl"
                  >
                    90일 이내 예정된 검사가 없습니다
                  </div>
                ) : (
                  <div
                    style={{ background: C.surface, border: `1px solid ${C.line}` }}
                    className="rounded-xl overflow-hidden divide-y"
                  >
                    {overviewList.map((r: any) => (
                      <button
                        key={r.elev.id}
                        onClick={() => goToElevator(r.site, r.elev)}
                        style={{ borderColor: C.line }}
                        className="w-full text-left px-4 py-3 hover:bg-black/[0.02] flex items-center justify-between gap-3 transition-colors"
                      >
                        <div className="min-w-0">
                          <div style={{ color: C.ink }} className="text-sm font-medium truncate flex items-center gap-1">
                            {Icon.building(14)} {r.site.siteName || r.site.name}
                          </div>
                          <div style={{ color: C.inkFaint }} className="text-xs truncate">
                            {r.elev.dong ? `${r.elev.dong} ` : ''}
                            {String(r.elev.hogiNo || '').replace(/[^0-9]/g, '')}호기
                          </div>
                        </div>
                        <span
                          style={{ ...r.dday.style }}
                          className="text-xs px-2.5 py-1 rounded-full font-bold shrink-0 whitespace-nowrap"
                        >
                          {r.dday.label}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {selectedSite && (
            <div className="flex gap-4 print:block">
              <div className="w-56 shrink-0 print:hidden">
                <div style={{ background: C.surface, border: `1px solid ${C.line}` }} className="rounded-xl overflow-hidden">
                  <div
                    style={{ borderColor: C.line, background: C.bg }}
                    className="px-3 py-2.5 border-b flex items-center justify-between"
                  >
                    <span style={{ color: C.inkSoft }} className="text-sm font-bold flex items-center gap-1">
                      {Icon.building(14)} {selectedSite.siteName || selectedSite.name}
                    </span>
                    <button
                      onClick={() => {
                        setSelectedSite(null);
                        setSelectedElev(null);
                        setElevators([]);
                      }}
                      style={{ color: C.inkFaint }}
                      className="text-xs"
                    >
                      변경
                    </button>
                  </div>

                  {elevators.length > 0 && (
                    <div style={{ borderColor: C.line }} className="px-3 py-2 border-b">
                      <button
                        onClick={loadSiteReportAndPrint}
                        disabled={siteReportLoading}
                        style={{ background: C.inkSoft, color: '#fff' }}
                        className="w-full text-xs px-3 py-1.5 rounded-lg font-medium disabled:opacity-50 flex items-center justify-center gap-1"
                      >
                        {Icon.fileText(13)} {siteReportLoading ? reportProgress || '준비 중...' : '전체 보고서 PDF (동별)'}
                      </button>
                    </div>
                  )}

                  {elevsLoading ? (
                    <div style={{ color: C.inkFaint }} className="py-8 text-center text-sm">
                      로딩 중...
                    </div>
                  ) : elevators.length === 0 ? (
                    <div style={{ color: C.inkFaint }} className="py-8 text-center text-sm">
                      호기 없음
                    </div>
                  ) : (
                    sortedElevators.map((elev: any) => {
                      const dday = getDdayInfo(elev);
                      const isActive = selectedElev?.id === elev.id;
                      return (
                        <button
                          key={elev.id}
                          onClick={() => handleElevClick(elev)}
                          style={{
                            borderColor: C.line,
                            background: isActive ? C.primaryLight : 'transparent',
                            color: isActive ? C.primaryDeep : C.inkSoft,
                          }}
                          className={`w-full text-left px-3 py-2.5 border-b last:border-0 text-sm transition-colors ${
                            isActive ? 'font-semibold' : 'hover:bg-black/[0.02]'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <div className="font-medium">
                              {elev.dong ? `${elev.dong} ` : ''}
                              {String(elev.hogiNo || '').replace(/[^0-9]/g, '')}호기
                            </div>
                            {dday && dday.urgent && (
                              <span
                                style={{ ...dday.style }}
                                className="text-[10px] px-1.5 py-0.5 rounded font-bold"
                              >
                                {dday.label}
                              </span>
                            )}
                          </div>
                          {elev.installationPlace && (
                            <div style={{ color: C.inkFaint }} className="text-xs">
                              {elev.installationPlace}
                            </div>
                          )}
                          <div style={{ color: C.inkFaint }} className="text-xs">
                            {elev.elevatorNo || '번호없음'}
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>

              <div className="flex-1">
                {!selectedElev && siteReportRows.length === 0 && (
                  <div
                    style={{ background: C.surface, border: `1px solid ${C.line}`, color: C.inkFaint }}
                    className="rounded-xl py-20 text-center"
                  >
                    <div className="flex justify-center mb-3" style={{ color: C.inkFaint }}>
                      {Icon.clipboard(32)}
                    </div>
                    <p className="text-sm">왼쪽에서 호기를 선택하세요</p>
                  </div>
                )}

                {siteReportRows.length > 0 && !selectedElev && (
                  <div className="hidden print:block p-4">
                    <h2 className="text-lg font-bold mb-1">
                      {selectedSite?.siteName || selectedSite?.name} 전체 승강기 검사현황
                    </h2>
                    <p className="text-xs text-gray-500 mb-4">출력일 {new Date().toLocaleDateString('ko-KR')}</p>

                    {Object.entries(groupedByDong).map(([dong, rows]) => (
                      <div key={dong} className="mb-4 print:break-inside-avoid">
                        <h3 className="font-bold text-sm border-b pb-1 mb-2">{dong}</h3>
                        <table className="w-full text-xs border-collapse">
                          <thead>
                            <tr className="border-b">
                              <th className="text-left py-1">호기</th>
                              <th className="text-left py-1">최근검사일</th>
                              <th className="text-left py-1">종류</th>
                              <th className="text-left py-1">결과</th>
                              <th className="text-left py-1">대응상태</th>
                            </tr>
                          </thead>
                          <tbody>
                            {rows
                              .sort(
                                (a, b) =>
                                  parseInt(String(a.elev.hogiNo || '0').replace(/[^0-9]/g, '') || '0') -
                                  parseInt(String(b.elev.hogiNo || '0').replace(/[^0-9]/g, '') || '0')
                              )
                              .map((r) => (
                                <tr key={r.elev.id} className="border-b">
                                  <td className="py-1">{String(r.elev.hogiNo || '').replace(/[^0-9]/g, '')}호기</td>
                                  <td className="py-1">{r.latest ? fmtYmd(r.latest.inspct_de) : '-'}</td>
                                  <td className="py-1">{r.latest?.inspct_kind_nm || '-'}</td>
                                  <td className="py-1">{r.latest?.disp_words || '-'}</td>
                                  <td className="py-1">{r.latest?.status || '-'}</td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                      </div>
                    ))}

                    {conditionalSummaryRows.length > 0 && (
                      <div className="mt-6 pt-4 border-t-2 border-gray-400 print:break-inside-avoid">
                        <h3 className="font-bold text-sm mb-3">⚠ 조건부합격 / 불합격 지적사항</h3>
                        {conditionalSummaryRows.map((r) => {
                          const dateNote =
                            r.failSourceRow && r.failSourceRow.inspct_de !== r.latest?.inspct_de
                              ? ` (${fmtYmd(r.failSourceRow.inspct_de)} 검사 기준)`
                              : '';
                          return (
                            <div key={r.elev.id} className="mb-2 text-xs print:break-inside-avoid">
                              <p className="font-semibold text-gray-800">
                                {r.elev.dong ? `${r.elev.dong} ` : ''}
                                {String(r.elev.hogiNo || '').replace(/[^0-9]/g, '')}호기
                                <span className="ml-2 text-red-600">{r.latest?.disp_words}</span>
                                <span className="ml-2 text-gray-400 font-normal">{dateNote}</span>
                              </p>
                              <ul className="pl-4 list-disc text-gray-600">
                                {r.fails.map((f: any, fi: number) => (
                                  <li key={fi}>{formatFailText(f)}</li>
                                ))}
                              </ul>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {selectedElev && (
                  <div
                    style={{ background: C.surface, border: `1px solid ${C.line}` }}
                    className="rounded-xl overflow-hidden print:border-none print:rounded-none"
                  >
                    <div
                      style={{ background: C.primaryLight, borderColor: C.line }}
                      className="px-4 py-3 border-b flex items-center justify-between print:hidden"
                    >
                      <div>
                        <span style={{ color: C.primaryDeep }} className="font-bold">
                          {selectedElev.dong ? `${selectedElev.dong} ` : ''}
                          {String(selectedElev.hogiNo || '').replace(/[^0-9]/g, '')}호기
                        </span>
                        {selectedElev.installationPlace && (
                          <span style={{ color: C.inkDim }} className="text-sm ml-2">
                            ({selectedElev.installationPlace})
                          </span>
                        )}
                      </div>
                      <span style={{ color: C.inkDim }} className="text-xs">
                        승강기번호: {selectedElev.elevatorNo || '없음'}
                      </span>
                    </div>

                    <div className="hidden print:block px-4 pt-4">
                      <h2 className="text-lg font-bold">
                        {selectedSite?.siteName || selectedSite?.name} ·{' '}
                        {selectedElev.dong ? `${selectedElev.dong} ` : ''}
                        {String(selectedElev.hogiNo || '').replace(/[^0-9]/g, '')}호기 검사이력
                      </h2>
                      <p className="text-xs text-gray-500 mt-1">
                        승강기번호 {selectedElev.elevatorNo || '없음'} · 출력일 {new Date().toLocaleDateString('ko-KR')}
                      </p>
                    </div>

                    <div className="p-4">
                      {apiLoading && (
                        <div className="py-16 text-center print:hidden">
                          <div
                            style={{ borderColor: C.primaryLight, borderTopColor: C.primary }}
                            className="inline-block w-8 h-8 border-4 rounded-full animate-spin mb-3"
                          />
                          <p style={{ color: C.inkFaint }} className="text-sm">
                            검사이력 조회 중...
                          </p>
                        </div>
                      )}

                      {apiError && (
                        <div
                          style={{ background: '#fef2f2', border: '1px solid #fecaca', color: C.red }}
                          className="rounded-xl p-4 text-sm print:hidden"
                        >
                          {apiError}
                        </div>
                      )}

                      {!apiLoading && !apiError && history.length === 0 && (
                        <div style={{ color: C.inkFaint }} className="py-16 text-center print:hidden">
                          <div className="flex justify-center mb-3">{Icon.fileText(28)}</div>
                          <p className="text-sm">검사이력이 없습니다</p>
                        </div>
                      )}

                      {!apiLoading && !apiError && history.length > 0 && dataSource && (
                        <div
                          style={{ background: C.primaryLight, border: `1px solid ${C.primaryLight}` }}
                          className="mb-4 flex items-center justify-between rounded-lg px-3 py-2 print:hidden"
                        >
                          <span style={{ color: C.primaryDeep }} className="text-xs">
                            {dataSource === 'cache'
                              ? `저장된 데이터입니다${
                                  lastSyncedAt ? ` (최근 확인: ${new Date(lastSyncedAt).toLocaleDateString('ko-KR')})` : ''
                                }`
                              : '방금 최신 정보를 가져와 저장했습니다'}
                          </span>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              onClick={() => window.print()}
                              style={{ background: C.inkSoft, color: '#fff' }}
                              className="text-xs px-3 py-1 rounded-lg font-medium"
                            >
                              PDF 저장
                            </button>
                            <button
                              onClick={() => handleElevClick(selectedElev, true)}
                              style={{ background: C.primary, color: '#fff' }}
                              className="text-xs px-3 py-1 rounded-lg font-medium"
                            >
                              새로고침
                            </button>
                          </div>
                        </div>
                      )}

                      {!apiLoading && history.length > 0 && (
                        <div className="space-y-3">
                          <h3 style={{ color: C.inkSoft }} className="font-bold text-sm print:hidden">
                            최근 검사이력 ({history.length}건)
                          </h3>
                          {(() => {
                            const latestFailRecord = history.find((h) => failList.some((f) => f.examYmd === h.inspctDe));
                            return history.map((h, i) => {
                              const key = `${selectedElev.id}_${h.inspctDe}`;
                              const memoData = memos[key] || { memo: '', status: '미대응' };
                              const isSaving = savingKey === key;
                              const fails = failList.filter((f) => f.examYmd === h.inspctDe);
                              const resultColor =
                                h.dispWords === '합격' ? C.green : h.dispWords === '조건부합격' ? C.amber : C.red;
                              return (
                                <div
                                  key={i}
                                  style={{ borderColor: C.line }}
                                  className={`border-b pb-4 last:border-0 print:break-inside-avoid ${
                                    i > 0 ? 'print:hidden' : ''
                                  }`}
                                >
                                  <div className="flex items-center gap-2 mb-1">
                                    <span
                                      style={{ background: resultColor }}
                                      className="w-2 h-2 rounded-full shrink-0"
                                    />
                                    <span style={{ color: C.ink }} className="font-semibold text-sm">
                                      {fmtYmd(h.inspctDe)}
                                    </span>
                                    <span style={{ color: C.inkFaint }} className="text-xs">
                                      {h.inspctKindNm}
                                    </span>
                                    <span style={{ color: resultColor }} className="text-xs font-bold ml-auto">
                                      {h.dispWords}
                                    </span>
                                  </div>
                                  <p style={{ color: C.inkFaint }} className="text-xs mb-2 pl-4">
                                    {h.inspctInsttNm} · 유효기간 {fmtYmd(h.applcBeDt)} ~ {fmtYmd(h.applcEnDt)}
                                  </p>

                                  {fails.length > 0 && (
                                    <div className="pl-4 mb-2 space-y-1.5">
                                      {fails.map((f, fi) => (
                                        <div key={fi} style={{ color: C.inkDim }} className="text-xs">
                                          <p style={{ color: C.red }} className="font-medium">
                                            {f.standardArticle} {f.standardTitle1}
                                          </p>
                                          <p>{f.failDesc}</p>
                                          {f.failDescInspector && (
                                            <p style={{ color: C.inkFaint }} className="italic">
                                              👤 {f.failDescInspector}
                                            </p>
                                          )}
                                        </div>
                                      ))}
                                    </div>
                                  )}

                                  {i === 0 &&
                                    fails.length === 0 &&
                                    h.dispWords !== '합격' &&
                                    latestFailRecord &&
                                    latestFailRecord.inspctDe !== h.inspctDe && (
                                      <div className="hidden print:block pl-4 mb-2 space-y-1.5">
                                        <p className="text-xs text-gray-400 font-medium">
                                          ※ {fmtYmd(latestFailRecord.inspctDe)} 검사 지적사항
                                        </p>
                                        {failList
                                          .filter((f) => f.examYmd === latestFailRecord.inspctDe)
                                          .map((f, fi) => (
                                            <div key={fi} className="text-xs text-gray-600">
                                              <p className="font-medium text-red-500">
                                                {f.standardArticle} {f.standardTitle1}
                                              </p>
                                              <p>{f.failDesc}</p>
                                              {f.failDescInspector && (
                                                <p className="text-gray-400 italic">👤 {f.failDescInspector}</p>
                                              )}
                                            </div>
                                          ))}
                                      </div>
                                    )}

                                  <div className="pl-4 print:hidden">
                                    <div className="flex gap-1.5 mb-1.5">
                                      {['미대응', '대응중', '완료'].map((s) => (
                                        <button
                                          key={s}
                                          onClick={() => updateMemo(key, 'status', s)}
                                          style={{
                                            background: memoData.status === s ? C.purple : '#f1f5f9',
                                            color: memoData.status === s ? '#fff' : C.inkDim,
                                          }}
                                          className="text-xs px-2.5 py-1 rounded-md font-medium transition-colors"
                                        >
                                          {s}
                                        </button>
                                      ))}
                                    </div>
                                    <textarea
                                      value={memoData.memo}
                                      onChange={(e) => updateMemo(key, 'memo', e.target.value)}
                                      placeholder="대응 내역, 특이사항 등을 입력하세요"
                                      style={{ border: `1px solid ${C.line}`, color: C.ink }}
                                      className="w-full text-xs rounded-md px-3 py-2 resize-none h-16 focus:outline-none"
                                    />
                                    <button
                                      onClick={() => saveMemo(h)}
                                      disabled={isSaving}
                                      style={{ background: C.purple, color: '#fff' }}
                                      className="mt-1.5 text-xs px-4 py-1.5 rounded-md font-medium disabled:opacity-50"
                                    >
                                      {isSaving ? '저장 중...' : memoData.docId ? '수정 저장' : '저장'}
                                    </button>
                                  </div>

                                  {(memoData.memo || memoData.status !== '미대응') && (
                                    <div className="hidden print:block pl-4 text-xs text-gray-600">
                                      상태: {memoData.status}
                                      {memoData.memo ? ` · 메모: ${memoData.memo}` : ''}
                                    </div>
                                  )}
                                </div>
                              );
                            });
                          })()}
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

      <div className="print:hidden">
        <TabBar active="inspect" />
      </div>
    </>
  );
}
