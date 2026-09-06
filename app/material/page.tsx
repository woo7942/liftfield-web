'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { C, Icon } from '@/lib/theme';
import TabBar from '@/components/TabBar';

// ✅ 상태 흐름: 신청중 → 분출(발송) → 수령완료 → 교체완료
const STATUS_STYLE: Record<string, { bg: string; text: string; border: string; label: string }> = {
  '신청중':   { bg: 'bg-yellow-50',  text: 'text-yellow-800', border: 'border-yellow-300', label: '신청중' },
  '접수':     { bg: 'bg-purple-50',  text: 'text-purple-800', border: 'border-purple-300', label: '접수완료' },
  '수령':     { bg: 'bg-green-50',   text: 'text-green-800',  border: 'border-green-300',  label: '수령완료' },
  '교체완료': { bg: 'bg-blue-50',    text: 'text-blue-800',   border: 'border-blue-300',   label: '교체완료' },
  '반려':     { bg: 'bg-red-50',     text: 'text-red-800',    border: 'border-red-300',    label: '반려' },
};

// ✅ 단위 옵션
const UNIT_OPTIONS = ['EA', 'SET', 'M'];

type MaterialRequest = {
  id: string;
  company_id: string;
  site_id: string;
  site_name: string;
  team?: string;
  contract_type?: string;
  hogi_no: string;
  material_name: string;
  part_number?: string;
  spec?: string;
  quantity: number;
  unit: string;
  reason?: string;
  requester_name?: string;
  requester_uid?: string;
  status: string;
  note?: string;
  request_at?: string;
  dispatched_at?: string;
  received_at?: string;
  replaced_at?: string;
  created_at?: string;
  updated_at?: string;
};

type Site = {
  id: string;
  site_name: string;
  company_id: string;
  team?: string;
  contract_type?: string;
};

// ✅ 승강기(호기) 정보
type Elevator = {
  id: string;
  site_id: string;
  dong?: string;
  hogi_no: string;
  installation_place?: string;
};

type UserInfo = {
  id: string;
  email: string;
  company_id: string;
  role: string;
  name?: string;
  team?: string;
};

export default function MaterialPage() {
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  const [requests, setRequests] = useState<MaterialRequest[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [elevatorsAll, setElevatorsAll] = useState<Elevator[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('전체');
  const [teamFilter, setTeamFilter] = useState('전체');
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;

  const [detailItem, setDetailItem] = useState<MaterialRequest | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const [pdfModal, setPdfModal] = useState(false);
  const [pdfSiteId, setPdfSiteId] = useState('');
  const [pdfStart, setPdfStart] = useState('');
  const [pdfEnd, setPdfEnd] = useState('');
  const [pdfStatus, setPdfStatus] = useState('전체');

  // ✅ 자재신청 등록 모달 관련 상태
  const [registerModal, setRegisterModal] = useState(false);

  // 현장 검색(콤보박스)
  const [regSiteId, setRegSiteId] = useState('');
  const [regSiteQuery, setRegSiteQuery] = useState('');
  const [regSiteOpen, setRegSiteOpen] = useState(false);

  // 호기 검색(콤보박스)
  const [regHogi, setRegHogi] = useState('');
  const [regHogiOpen, setRegHogiOpen] = useState(false);

  const [regMaterial, setRegMaterial] = useState('');
  const [regPartNumber, setRegPartNumber] = useState('');
  const [regSpec, setRegSpec] = useState('');
  const [regQuantity, setRegQuantity] = useState(1);
  const [regUnit, setRegUnit] = useState('EA');
  const [regReason, setRegReason] = useState('');
  const [registerLoading, setRegisterLoading] = useState(false);

  const chanRef = useRef<any>(null);

  // ✅ 핵심: site_id 기준으로 조회
  const loadAll = async (uid?: string, cid?: string) => {
    try {
      setLoading(true);
      const targetCid = cid || userInfo?.company_id;
      if (!targetCid) return;

      // 1. 내 회사 현장 목록 (team, contract_type 포함)
      const { data: siteData } = await supabase
        .from('sites')
        .select('id, site_name, company_id, team, contract_type')
        .eq('company_id', targetCid);
      setSites(siteData || []);

      // 2. 승강기(호기) 목록 - 등록 모달의 호기 검색용
      const { data: elevData, error: elevError } = await supabase
        .from('elevators')
        .select('id, site_id, dong, hogi_no, installation_place')
        .eq('company_id', targetCid);

      if (elevError) {
        console.error('엘리베이터 로딩 실패:', elevError);
      } else {
        setElevatorsAll(elevData || []);
      }

      // 3. company_id 기준으로 자재신청 조회 (site_id 매칭 실패로 누락되는 문제 방지)
      const { data: reqData, error: reqError } = await supabase
        .from('material_requests')
        .select('*')
        .eq('company_id', targetCid)
        .order('created_at', { ascending: false });

      if (reqError) throw reqError;
      setRequests(reqData || []);
    } catch (e) {
      console.error('로드 실패:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: userData } = await supabase
        .from('users')
        .select('*')
        .eq('id', user.id)
        .single();
      if (userData) {
        setUserInfo(userData);
        await loadAll(user.id, userData.company_id);
        subscribeRealtime(userData.company_id);
      }
    };
    init();
    return () => { if (chanRef.current) supabase.removeChannel(chanRef.current); };
  }, []);

  const subscribeRealtime = (cid: string) => {
    if (chanRef.current) supabase.removeChannel(chanRef.current);
    const chan = supabase
      .channel(`material-web-${cid}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'material_requests',
      }, () => loadAll(undefined, cid))
      .subscribe();
    chanRef.current = chan;
  };

  // ✅ 웹 운영자 전용 상태 변경
  const handleStatusChange = async (item: MaterialRequest, newStatus: string) => {
    setActionLoading(true);
    try {
      const updateData: any = {
        status: newStatus,
        updated_at: new Date().toISOString(),
      };
      if (newStatus === '접수')     updateData.dispatched_at = new Date().toISOString();
      if (newStatus === '수령')     updateData.received_at   = new Date().toISOString();
      if (newStatus === '교체완료') updateData.replaced_at   = new Date().toISOString();
      if (newStatus === '반려')     updateData.note = item.note || '';

      const { error } = await supabase
        .from('material_requests')
        .update(updateData)
        .eq('id', item.id);

      if (error) throw error;
      setDetailItem(null);
      await loadAll();
    } catch (e) {
      alert('상태 변경 실패');
    } finally {
      setActionLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('삭제하시겠습니까?')) return;
    await supabase.from('material_requests').delete().eq('id', id);
    setDetailItem(null);
    await loadAll();
  };

  // ✅ 자재신청 등록 폼 초기화
  const resetRegisterForm = () => {
    setRegSiteId('');
    setRegSiteQuery('');
    setRegSiteOpen(false);
    setRegHogi('');
    setRegHogiOpen(false);
    setRegMaterial('');
    setRegPartNumber('');
    setRegSpec('');
    setRegQuantity(1);
    setRegUnit('EA');
    setRegReason('');
  };

  // ✅ 자재신청 등록 처리 (team, contract_type은 선택한 현장에서 자동으로 가져옴)
  const handleRegister = async () => {
    if (!regSiteId || !regMaterial.trim()) {
      alert('현장과 자재명을 입력해주세요.');
      return;
    }
    setRegisterLoading(true);
    try {
      const site = sites.find(s => s.id === regSiteId);
      const { error } = await supabase.from('material_requests').insert({
        company_id: userInfo?.company_id,
        site_id: regSiteId,
        site_name: site?.site_name || '',
        team: site?.team || null,
        contract_type: site?.contract_type || null,
        hogi_no: regHogi,
        material_name: regMaterial,
        part_number: regPartNumber || null,
        spec: regSpec || null,
        quantity: regQuantity,
        unit: regUnit,
        reason: regReason || null,
        requester_name: userInfo?.name || userInfo?.email,
        requester_uid: userInfo?.id,
        status: '신청중',
        request_at: new Date().toISOString(),
      });
      if (error) throw error;
      setRegisterModal(false);
      resetRegisterForm();
      await loadAll();
    } catch (e) {
      console.error('등록 실패:', e);
      alert('자재신청 등록에 실패했습니다.');
    } finally {
      setRegisterLoading(false);
    }
  };

  // ✅ 관리자는 전체 현장, 팀원은 자기 팀 현장만
  const availableSites = useMemo(() => {
    return sites.filter(s => userInfo?.role === 'admin' ? true : s.team === userInfo?.team);
  }, [sites, userInfo]);

  // ✅ 입력한 검색어로 현장 목록 필터링 (site_name이 null인 경우 방어)
  const filteredSiteOptions = useMemo(() => {
    const list = availableSites;
    if (!regSiteQuery.trim()) return list;
    const q = regSiteQuery.toLowerCase();
    return list.filter(s => (s.site_name || '').toLowerCase().includes(q));
  }, [availableSites, regSiteQuery]);

  // ✅✅ 선택한 현장에 속한 호기 목록
  // - 점검 페이지와 동일한 우선순위 적용:
  //   1) installation_place(설치위치)가 있으면 그 값을 그대로 사용 (이미 완성된 정답 라벨)
  //   2) 없으면 dong + hogi_no 조합으로 대체 표시
  const getHogiNum = (h: string) =>
    parseInt((h || '').replace(/[^0-9]/g, '') || '0');

  const hogiOptions = useMemo(() => {
    const list = elevatorsAll.filter(e => e.site_id === regSiteId);

    const sorted = [...list].sort((a, b) => {
      const dongA = a.dong || '';
      const dongB = b.dong || '';
      if (dongA !== dongB) return dongA.localeCompare(dongB, 'ko', { numeric: true });
      return getHogiNum(a.hogi_no) - getHogiNum(b.hogi_no);
    });

    return sorted.map(e => ({
      id: e.id,
      label: e.installation_place
        ? e.installation_place
        : e.dong
        ? `${e.dong} ${e.hogi_no || '호기'}`
        : (e.hogi_no || '호기'),
    }));
  }, [elevatorsAll, regSiteId]);

  // ✅ 입력한 검색어로 호기 목록 필터링
  const filteredHogiOptions = useMemo(() => {
    if (!regHogi.trim()) return hogiOptions;
    const q = regHogi.toLowerCase();
    return hogiOptions.filter(o => o.label.toLowerCase().includes(q));
  }, [hogiOptions, regHogi]);

  // 필터링
  const filtered = useMemo(() => {
    let list = requests;
    if (statusFilter !== '전체') list = list.filter(r => r.status === statusFilter);
    if (teamFilter !== '전체') list = list.filter(r => r.team === teamFilter);
    if (search.trim()) {
      const s = search.toLowerCase();
      list = list.filter(r =>
        r.site_name?.toLowerCase().includes(s) ||
        r.material_name?.toLowerCase().includes(s) ||
        r.hogi_no?.toLowerCase().includes(s) ||
        r.requester_name?.toLowerCase().includes(s)
      );
    }
    return list;
  }, [requests, statusFilter, teamFilter, search]);

  const teams = useMemo(() => {
    const t = new Set(requests.map(r => r.team).filter(Boolean));
    return ['전체', ...Array.from(t)] as string[];
  }, [requests]);

  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);

  const fmtDate = (iso?: string) => {
    if (!iso) return '-';
    return iso.slice(0, 16).replace('T', ' ');
  };

  const formatHogi = (v?: string) => {
    if (!v) return '';
    return v.includes('호기') ? v : `${v}호기`;
  };

  // PDF 출력
  const exportPDF = () => {
    let list = requests;
    if (pdfSiteId) list = list.filter(r => r.site_id === pdfSiteId);
    if (pdfStart) list = list.filter(r => (r.request_at || r.created_at || '') >= pdfStart);
    if (pdfEnd) list = list.filter(r => (r.request_at || r.created_at || '') <= pdfEnd + 'T23:59:59');
    if (pdfStatus !== '전체') list = list.filter(r => r.status === pdfStatus);

    const rows = list.map((r, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${r.request_at ? r.request_at.slice(0, 10) : ''}</td>
        <td>${r.site_name}</td>
        <td>${r.contract_type || '-'}</td>
        <td>${formatHogi(r.hogi_no)}</td>
        <td>${r.material_name}${r.spec ? ` (${r.spec})` : ''}</td>
        <td>${r.part_number || '-'}</td>
        <td>${r.quantity}${r.unit}</td>
        <td>${r.reason || '-'}</td>
        <td>${STATUS_STYLE[r.status]?.label || r.status}</td>
        <td>${r.requester_name || '-'}</td>
        <td>${r.dispatched_at ? r.dispatched_at.slice(0,10) : '-'}</td>
        <td>${r.received_at ? r.received_at.slice(0,10) : '-'}</td>
        <td>${r.replaced_at ? r.replaced_at.slice(0,10) : '-'}</td>
      </tr>`).join('');

    const html = `
      <html><head><meta charset="utf-8">
      <style>
        body { font-family: sans-serif; padding: 20px; }
        h1 { text-align: center; font-size: 20px; }
        table { width: 100%; border-collapse: collapse; font-size: 10.5px; margin-top: 16px; }
        th, td { border: 1px solid #ccc; padding: 5px 6px; text-align: center; }
        th { background: #f3f4f6; font-weight: bold; }
        tr:nth-child(even) { background: #f9fafb; }
      </style></head>
      <body>
        <h1>자재신청 내역</h1>
        <p style="text-align:center;color:#666;">총 ${list.length}건</p>
        <table>
          <thead><tr>
            <th>#</th><th>신청일</th><th>현장</th><th>계약종류</th><th>호기</th><th>자재명</th>
            <th>파트넘버</th><th>수량</th><th>사유</th><th>상태</th><th>신청자</th>
            <th>분출일</th><th>수령일</th><th>교체일</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </body></html>`;

    printHtml(html);
    setPdfModal(false);
  };

  const printHtml = (html: string) => {
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => { w.print(); }, 500);
  };

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: C.inkDim, fontSize: 14 }}>자재신청 내역 불러오는 중...</div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.ink, paddingBottom: 130 }}>
      {/* 헤더 */}
      <header
        className="sticky top-0 z-10"
        style={{ background: C.surface, borderBottom: `1px solid ${C.line}` }}
      >
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: 10,
                background: C.primaryLight,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: C.primary,
              }}
            >
              {Icon.box(18)}
            </div>
            <div>
              <h1 style={{ fontSize: 17, fontWeight: 800, color: C.ink }}>자재신청 관리</h1>
              <p style={{ fontSize: 12, color: C.inkDim, marginTop: 2 }}>
                신청부터 교체완료까지 한눈에 확인하세요
              </p>
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => setRegisterModal(true)}
              style={{
                padding: '9px 16px',
                borderRadius: 10,
                background: C.amber,
                color: '#fff',
                fontSize: 13,
                fontWeight: 700,
              }}
            >
              + 자재신청하기
            </button>
            <button
              onClick={() => setPdfModal(true)}
              style={{
                padding: '9px 16px',
                borderRadius: 10,
                background: C.bg,
                border: `1px solid ${C.line}`,
                color: C.inkSoft,
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              📄 PDF 출력
            </button>
          </div>
        </div>
      </header>

      <div className="p-4 max-w-7xl mx-auto">
        {/* 상태 요약 카드 */}
        <div className="grid grid-cols-5 gap-3 mb-6">
          {['신청중', '접수', '수령', '교체완료', '반려'].map(s => {
            const cnt = requests.filter(r => r.status === s).length;
            const style = STATUS_STYLE[s];
            const active = statusFilter === s;
            return (
              <button
                key={s}
                onClick={() => { setStatusFilter(s === statusFilter ? '전체' : s); setPage(1); }}
                className={`p-3 rounded-xl border-2 text-center transition-all ${
                  active ? `${style.bg} ${style.border} ${style.text}` : ''
                }`}
                style={!active ? { background: C.surface, borderColor: C.line, color: C.inkDim } : undefined}
              >
                <div className="text-2xl font-bold">{cnt}</div>
                <div className="text-xs mt-1">{style.label}</div>
              </button>
            );
          })}
        </div>

        {/* 필터 */}
        <div className="flex flex-wrap gap-3 mb-4">
          <input
            type="text"
            placeholder="현장명, 자재명, 호기, 신청자 검색"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            className="px-3 py-2 rounded-lg text-sm w-72"
            style={{ background: C.surface, border: `1px solid ${C.line}`, color: C.ink }}
          />
          <select
            value={statusFilter}
            onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
            className="px-3 py-2 rounded-lg text-sm"
            style={{ background: C.surface, border: `1px solid ${C.line}`, color: C.ink }}
          >
            <option value="전체">전체 상태</option>
            {Object.entries(STATUS_STYLE).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
          <select
            value={teamFilter}
            onChange={e => { setTeamFilter(e.target.value); setPage(1); }}
            className="px-3 py-2 rounded-lg text-sm"
            style={{ background: C.surface, border: `1px solid ${C.line}`, color: C.ink }}
          >
            {teams.map(t => <option key={t} value={t}>{t === '전체' ? '전체 팀' : t}</option>)}
          </select>
          <span className="ml-auto text-sm self-center" style={{ color: C.inkDim }}>
            총 {filtered.length}건
          </span>
        </div>

        {/* 테이블 */}
        <div className="rounded-xl overflow-x-auto" style={{ background: C.surface, border: `1px solid ${C.line}` }}>
          <table className="w-full text-sm min-w-[820px]">
            <thead style={{ background: C.bg }}>
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold whitespace-nowrap" style={{ color: C.inkDim }}>신청일</th>
                <th className="px-4 py-3 text-left text-xs font-semibold whitespace-nowrap" style={{ color: C.inkDim }}>현장 / 호기</th>
                <th className="px-4 py-3 text-left text-xs font-semibold whitespace-nowrap" style={{ color: C.inkDim }}>자재명</th>
                <th className="px-4 py-3 text-left text-xs font-semibold whitespace-nowrap" style={{ color: C.inkDim }}>수량</th>
                <th className="px-4 py-3 text-left text-xs font-semibold whitespace-nowrap" style={{ color: C.inkDim }}>신청자</th>
                <th className="px-4 py-3 text-left text-xs font-semibold whitespace-nowrap" style={{ color: C.inkDim }}>상태</th>
                <th className="px-4 py-3 text-left text-xs font-semibold whitespace-nowrap" style={{ color: C.inkDim }}>처리</th>
              </tr>
            </thead>
            <tbody className="divide-y" style={{ borderColor: C.line }}>
              {paginated.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center" style={{ color: C.inkFaint }}>
                    자재신청 내역이 없습니다.
                  </td>
                </tr>
              ) : paginated.map(item => {
                const style = STATUS_STYLE[item.status] || STATUS_STYLE['신청중'];
                return (
                  <tr
                    key={item.id}
                    className="cursor-pointer"
                    style={{ transition: 'background 0.15s' }}
                    onMouseEnter={e => (e.currentTarget.style.background = C.bg)}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    onClick={() => setDetailItem(item)}
                  >
                    <td className="px-4 py-3 text-xs whitespace-nowrap" style={{ color: C.inkDim }}>
                      {item.request_at ? item.request_at.slice(0, 10) : item.created_at?.slice(0, 10)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="font-medium" style={{ color: C.ink }}>{item.site_name}</div>
                      <div className="text-xs flex items-center gap-1 flex-wrap mt-0.5" style={{ color: C.inkFaint }}>
                        <span>{formatHogi(item.hogi_no)}</span>
                        {item.team && <span>· {item.team}</span>}
                        {item.contract_type && (
                          <span
                            className="px-1.5 py-0.5 rounded text-[10px] font-medium"
                            style={{ background: C.bg, color: C.inkDim }}
                          >
                            {item.contract_type}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="font-medium" style={{ color: C.ink }}>{item.material_name}</div>
                      {item.spec && <div className="text-xs" style={{ color: C.inkFaint }}>{item.spec}</div>}
                      {item.part_number && <div className="text-xs" style={{ color: C.inkFaint }}>P/N: {item.part_number}</div>}
                    </td>
                    <td className="px-4 py-3 font-semibold whitespace-nowrap" style={{ color: C.amber }}>
                      {item.quantity}{item.unit}
                    </td>
                    <td className="px-4 py-3 text-xs whitespace-nowrap" style={{ color: C.inkDim }}>{item.requester_name || '-'}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className={`px-2 py-1 rounded-full text-xs font-semibold border whitespace-nowrap ${style.bg} ${style.text} ${style.border}`}>
                        {style.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap" onClick={e => e.stopPropagation()}>
                      {item.status === '신청중' && userInfo?.role === 'admin' && (
                        <button
                          onClick={() => handleStatusChange(item, '접수')}
                          className="px-3 py-1 rounded-lg text-xs font-semibold whitespace-nowrap"
                          style={{ background: C.purple, color: '#fff' }}
                        >
                          ✅ 접수처리
                        </button>
                      )}
                      {item.status === '접수' && (
                        <button
                          onClick={() => handleStatusChange(item, '수령')}
                          className="px-3 py-1 rounded-lg text-xs font-semibold whitespace-nowrap"
                          style={{ background: C.green, color: '#fff' }}
                        >
                          📥 수령처리
                        </button>
                      )}
                      {item.status === '수령' && (
                        <button
                          onClick={() => handleStatusChange(item, '교체완료')}
                          className="px-3 py-1 rounded-lg text-xs font-semibold whitespace-nowrap"
                          style={{ background: C.primary, color: '#fff' }}
                        >
                          🔧 교체완료 처리
                        </button>
                      )}
                      {item.status === '교체완료' && (
                        <span className="text-xs font-medium whitespace-nowrap" style={{ color: C.primary }}>
                          교체완료{' '}
                          <span style={{ color: C.inkFaint }}>{item.replaced_at ? item.replaced_at.slice(0,10) : ''}</span>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* 페이지네이션 */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 mt-4">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-1 rounded text-sm disabled:opacity-40"
              style={{ border: `1px solid ${C.line}`, color: C.inkDim }}
            >이전</button>
            {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
              const p = Math.max(1, Math.min(page - 2, totalPages - 4)) + i;
              const active = page === p;
              return (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  className="px-3 py-1 rounded text-sm"
                  style={active
                    ? { background: C.amber, color: '#fff', border: `1px solid ${C.amber}` }
                    : { border: `1px solid ${C.line}`, color: C.inkDim }}
                >
                  {p}
                </button>
              );
            })}
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="px-3 py-1 rounded text-sm disabled:opacity-40"
              style={{ border: `1px solid ${C.line}`, color: C.inkDim }}
            >다음</button>
          </div>
        )}
      </div>

      {/* 상세 모달 */}
      {detailItem && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" style={{ background: C.surface }}>
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold" style={{ color: C.ink }}>자재신청 상세</h2>
                <button onClick={() => setDetailItem(null)} className="text-2xl" style={{ color: C.inkFaint }}>×</button>
              </div>

              <div className="mb-4">
                {(() => {
                  const style = STATUS_STYLE[detailItem.status] || STATUS_STYLE['신청중'];
                  return (
                    <span className={`px-3 py-1 rounded-full text-sm font-semibold border ${style.bg} ${style.text} ${style.border}`}>
                      {style.label}
                    </span>
                  );
                })()}
              </div>

              <div className="space-y-3 text-sm">
                <div className="grid grid-cols-2 gap-3">
                  <div><span style={{ color: C.inkFaint }}>현장</span><p className="font-medium" style={{ color: C.ink }}>{detailItem.site_name}</p></div>
                  <div><span style={{ color: C.inkFaint }}>호기</span><p className="font-medium" style={{ color: C.ink }}>{formatHogi(detailItem.hogi_no)}</p></div>
                  <div><span style={{ color: C.inkFaint }}>계약종류</span><p className="font-medium" style={{ color: C.ink }}>{detailItem.contract_type || '-'}</p></div>
                  <div><span style={{ color: C.inkFaint }}>팀</span><p className="font-medium" style={{ color: C.ink }}>{detailItem.team || '-'}</p></div>
                  <div><span style={{ color: C.inkFaint }}>자재명</span><p className="font-medium" style={{ color: C.ink }}>{detailItem.material_name}</p></div>
                  <div><span style={{ color: C.inkFaint }}>수량</span><p className="font-medium" style={{ color: C.ink }}>{detailItem.quantity}{detailItem.unit}</p></div>
                  {detailItem.spec && <div><span style={{ color: C.inkFaint }}>규격</span><p className="font-medium" style={{ color: C.ink }}>{detailItem.spec}</p></div>}
                  {detailItem.part_number && <div><span style={{ color: C.inkFaint }}>파트넘버</span><p className="font-medium" style={{ color: C.ink }}>{detailItem.part_number}</p></div>}
                  <div><span style={{ color: C.inkFaint }}>신청자</span><p className="font-medium" style={{ color: C.ink }}>{detailItem.requester_name || '-'}</p></div>
                  {detailItem.reason && <div className="col-span-2"><span style={{ color: C.inkFaint }}>사유</span><p className="font-medium" style={{ color: C.ink }}>{detailItem.reason}</p></div>}
                  {detailItem.note && <div className="col-span-2"><span style={{ color: C.inkFaint }}>비고</span><p className="font-medium" style={{ color: C.ink }}>{detailItem.note}</p></div>}
                </div>

                <div className="mt-4 pt-4" style={{ borderTop: `1px solid ${C.line}` }}>
                  <p className="text-xs font-semibold mb-2" style={{ color: C.inkFaint }}>처리 이력</p>
                  <div className="space-y-1 text-xs">
                    <div className="flex justify-between">
                      <span style={{ color: C.inkDim }}>✅ 접수일시</span>
                      <span className="font-medium" style={{ color: detailItem.dispatched_at ? C.purple : C.inkFaint }}>
                        {fmtDate(detailItem.dispatched_at)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span style={{ color: C.inkDim }}>📦 분출일시</span>
                      <span className="font-medium" style={{ color: detailItem.dispatched_at ? C.purple : C.inkFaint }}>
                        {fmtDate(detailItem.dispatched_at)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span style={{ color: C.inkDim }}>✅ 수령일시</span>
                      <span className="font-medium" style={{ color: detailItem.received_at ? C.green : C.inkFaint }}>
                        {fmtDate(detailItem.received_at)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span style={{ color: C.inkDim }}>🔧 교체일시</span>
                      <span className="font-medium" style={{ color: detailItem.replaced_at ? C.primary : C.inkFaint }}>
                        {fmtDate(detailItem.replaced_at)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-6 space-y-2">
                {detailItem.status === '신청중' && userInfo?.role === 'admin' && (
                  <button
                    onClick={() => handleStatusChange(detailItem, '접수')}
                    disabled={actionLoading}
                    className="w-full py-3 rounded-xl font-semibold disabled:opacity-50"
                    style={{ background: C.purple, color: '#fff' }}
                  >
                    ✅ 접수처리
                  </button>
                )}
                {detailItem.status === '접수' && (
                  <button
                    onClick={() => handleStatusChange(detailItem, '수령')}
                    disabled={actionLoading}
                    className="w-full py-3 rounded-xl font-semibold disabled:opacity-50"
                    style={{ background: C.green, color: '#fff' }}
                  >
                    📥 수령처리
                  </button>
                )}
                {detailItem.status === '수령' && (
                  <button
                    onClick={() => handleStatusChange(detailItem, '교체완료')}
                    disabled={actionLoading}
                    className="w-full py-3 rounded-xl font-semibold disabled:opacity-50"
                    style={{ background: C.primary, color: '#fff' }}
                  >
                    🔧 교체완료 처리
                  </button>
                )}
                {(detailItem.status === '신청중' || detailItem.status === '접수') && userInfo?.role === 'admin' && (
                  <button
                    onClick={() => handleStatusChange(detailItem, '반려')}
                    disabled={actionLoading}
                    className="w-full py-3 rounded-xl font-semibold disabled:opacity-50"
                    style={{ background: '#fef2f2', color: C.red, border: '1px solid #fecaca' }}
                  >
                    ✕ 반려 처리
                  </button>
                )}

                <button
                  onClick={() => handleDelete(detailItem.id)}
                  className="w-full py-2 text-sm"
                  style={{ color: C.inkFaint }}
                >
                  삭제
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* PDF 모달 */}
      {pdfModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="rounded-2xl w-full max-w-md p-6" style={{ background: C.surface }}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold" style={{ color: C.ink }}>PDF 출력 옵션</h2>
              <button onClick={() => setPdfModal(false)} className="text-2xl" style={{ color: C.inkFaint }}>×</button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold" style={{ color: C.inkDim }}>현장 선택 (선택 안 하면 전체)</label>
                <select
                  value={pdfSiteId}
                  onChange={e => setPdfSiteId(e.target.value)}
                  className="w-full mt-1 px-3 py-2 rounded-lg text-sm"
                  style={{ border: `1px solid ${C.line}`, color: C.ink }}
                >
                  <option value="">전체 현장</option>
                  {sites.map(s => <option key={s.id} value={s.id}>{s.site_name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-semibold" style={{ color: C.inkDim }}>시작일</label>
                  <input
                    type="date"
                    value={pdfStart}
                    onChange={e => setPdfStart(e.target.value)}
                    className="w-full mt-1 px-3 py-2 rounded-lg text-sm"
                    style={{ border: `1px solid ${C.line}`, color: C.ink }}
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold" style={{ color: C.inkDim }}>종료일</label>
                  <input
                    type="date"
                    value={pdfEnd}
                    onChange={e => setPdfEnd(e.target.value)}
                    className="w-full mt-1 px-3 py-2 rounded-lg text-sm"
                    style={{ border: `1px solid ${C.line}`, color: C.ink }}
                  />
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold" style={{ color: C.inkDim }}>상태 필터</label>
                <select
                  value={pdfStatus}
                  onChange={e => setPdfStatus(e.target.value)}
                  className="w-full mt-1 px-3 py-2 rounded-lg text-sm"
                  style={{ border: `1px solid ${C.line}`, color: C.ink }}
                >
                  <option value="전체">전체 상태</option>
                  {Object.entries(STATUS_STYLE).map(([k, v]) => (
                    <option key={k} value={k}>{v.label}</option>
                  ))}
                </select>
              </div>
              <button
                onClick={exportPDF}
                className="w-full py-3 rounded-xl font-semibold"
                style={{ background: C.amber, color: '#fff' }}
              >
                📄 PDF 출력
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ✅ 자재신청 등록 모달 */}
      {registerModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="rounded-2xl w-full max-w-md max-h-[90vh] flex flex-col overflow-hidden" style={{ background: C.surface }}>
            <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: `1px solid ${C.line}` }}>
              <h2 className="text-lg font-bold" style={{ color: C.ink }}>자재신청 등록</h2>
              <button
                onClick={() => { setRegisterModal(false); resetRegisterForm(); }}
                className="text-2xl leading-none"
                style={{ color: C.inkFaint }}
              >×</button>
            </div>

            <div className="px-6 py-5 overflow-y-auto space-y-5">
              <div className="rounded-xl p-4 space-y-3" style={{ background: C.bg }}>
                <p className="text-xs font-bold tracking-wide" style={{ color: C.inkDim }}>현장 정보</p>

                <div className="relative">
                  <label className="text-xs font-semibold" style={{ color: C.inkSoft }}>
                    현장 선택 <span style={{ color: C.red }}>*</span>
                  </label>
                  <input
                    type="text"
                    value={regSiteQuery}
                    onChange={e => {
                      setRegSiteQuery(e.target.value);
                      setRegSiteOpen(true);
                      if (regSiteId) { setRegSiteId(''); setRegHogi(''); }
                    }}
                    onFocus={() => setRegSiteOpen(true)}
                    onBlur={() => setTimeout(() => setRegSiteOpen(false), 150)}
                    placeholder="현장명을 검색하세요"
                    className="w-full mt-1 px-3 py-2 rounded-lg text-sm focus:outline-none"
                    style={{ background: C.surface, border: `1px solid ${C.line}`, color: C.ink }}
                  />
                  {regSiteOpen && filteredSiteOptions.length > 0 && (
                    <div
                      className="absolute z-10 mt-1 w-full rounded-lg shadow-lg max-h-48 overflow-y-auto"
                      style={{ background: C.surface, border: `1px solid ${C.line}` }}
                    >
                      {filteredSiteOptions.map(s => (
                        <div
                          key={s.id}
                          onMouseDown={() => {
                            setRegSiteId(s.id);
                            setRegSiteQuery(s.site_name || '');
                            setRegSiteOpen(false);
                            setRegHogi('');
                          }}
                          className="px-3 py-2 text-sm cursor-pointer"
                          style={{ color: C.ink }}
                          onMouseEnter={e => (e.currentTarget.style.background = C.bg)}
                          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                        >
                          {s.site_name || '(이름 없음)'}
                        </div>
                      ))}
                    </div>
                  )}
                  {regSiteOpen && filteredSiteOptions.length === 0 && (
                    <div
                      className="absolute z-10 mt-1 w-full rounded-lg shadow-lg px-3 py-2 text-xs"
                      style={{ background: C.surface, border: `1px solid ${C.line}`, color: C.inkFaint }}
                    >
                      일치하는 현장이 없습니다.
                    </div>
                  )}

                  {regSiteId && (() => {
                    const site = sites.find(s => s.id === regSiteId);
                    return (
                      <p className="mt-1 text-xs" style={{ color: C.inkFaint }}>
                        소속팀: {site?.team || '미지정'} · 계약종류: {site?.contract_type || '미지정'}
                      </p>
                    );
                  })()}
                </div>

                <div className="relative">
                  <label className="text-xs font-semibold" style={{ color: C.inkSoft }}>호기</label>
                  <input
                    type="text"
                    value={regHogi}
                    onChange={e => { setRegHogi(e.target.value); setRegHogiOpen(true); }}
                    onFocus={() => setRegHogiOpen(true)}
                    onBlur={() => setTimeout(() => setRegHogiOpen(false), 150)}
                    disabled={!regSiteId}
                    placeholder={regSiteId ? '호기 검색 (예: 901동 1호기)' : '먼저 현장을 선택하세요'}
                    className="w-full mt-1 px-3 py-2 rounded-lg text-sm focus:outline-none disabled:opacity-50"
                    style={{ background: C.surface, border: `1px solid ${C.line}`, color: C.ink }}
                  />
                  {regHogiOpen && regSiteId && filteredHogiOptions.length > 0 && (
                    <div
                      className="absolute z-10 mt-1 w-full rounded-lg shadow-lg max-h-44 overflow-y-auto"
                      style={{ background: C.surface, border: `1px solid ${C.line}` }}
                    >
                      {filteredHogiOptions.map(o => (
                        <div
                          key={o.id}
                          onMouseDown={() => { setRegHogi(o.label); setRegHogiOpen(false); }}
                          className="px-3 py-2 text-sm cursor-pointer"
                          style={{ color: C.ink }}
                          onMouseEnter={e => (e.currentTarget.style.background = C.bg)}
                          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                        >
                          {o.label}
                        </div>
                      ))}
                    </div>
                  )}
                  {regHogiOpen && regSiteId && filteredHogiOptions.length === 0 && (
                    <div
                      className="absolute z-10 mt-1 w-full rounded-lg shadow-lg px-3 py-2 text-xs"
                      style={{ background: C.surface, border: `1px solid ${C.line}`, color: C.inkFaint }}
                    >
                      일치하는 호기가 없습니다. 직접 입력한 값으로 등록됩니다.
                    </div>
                  )}
                </div>
              </div>

              <div className="rounded-xl p-4 space-y-3" style={{ background: C.bg }}>
                <p className="text-xs font-bold tracking-wide" style={{ color: C.inkDim }}>자재 정보</p>

                <div>
                  <label className="text-xs font-semibold" style={{ color: C.inkSoft }}>
                    자재명 <span style={{ color: C.red }}>*</span>
                  </label>
                  <input
                    type="text"
                    value={regMaterial}
                    onChange={e => setRegMaterial(e.target.value)}
                    placeholder="예: 비상구출배터리"
                    className="w-full mt-1 px-3 py-2 rounded-lg text-sm focus:outline-none"
                    style={{ background: C.surface, border: `1px solid ${C.line}`, color: C.ink }}
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold" style={{ color: C.inkSoft }}>파트넘버</label>
                    <input
                      type="text"
                      value={regPartNumber}
                      onChange={e => setRegPartNumber(e.target.value)}
                      className="w-full mt-1 px-3 py-2 rounded-lg text-sm focus:outline-none"
                      style={{ background: C.surface, border: `1px solid ${C.line}`, color: C.ink }}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold" style={{ color: C.inkSoft }}>규격</label>
                    <input
                      type="text"
                      value={regSpec}
                      onChange={e => setRegSpec(e.target.value)}
                      className="w-full mt-1 px-3 py-2 rounded-lg text-sm focus:outline-none"
                      style={{ background: C.surface, border: `1px solid ${C.line}`, color: C.ink }}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold" style={{ color: C.inkSoft }}>수량</label>
                    <input
                      type="number"
                      min={1}
                      value={regQuantity}
                      onChange={e => setRegQuantity(Number(e.target.value))}
                      className="w-full mt-1 px-3 py-2 rounded-lg text-sm focus:outline-none"
                      style={{ background: C.surface, border: `1px solid ${C.line}`, color: C.ink }}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold" style={{ color: C.inkSoft }}>단위</label>
                    <select
                      value={regUnit}
                      onChange={e => setRegUnit(e.target.value)}
                      className="w-full mt-1 px-3 py-2 rounded-lg text-sm"
                      style={{ background: C.surface, border: `1px solid ${C.line}`, color: C.ink }}
                    >
                      {UNIT_OPTIONS.map(u => <option key={u} value={u}>{u}</option>)}
                    </select>
                  </div>
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold" style={{ color: C.inkSoft }}>신청 사유</label>
                <textarea
                  value={regReason}
                  onChange={e => setRegReason(e.target.value)}
                  rows={3}
                  placeholder="자재가 필요한 이유를 입력하세요 (선택)"
                  className="w-full mt-1 px-3 py-2 rounded-lg text-sm resize-none focus:outline-none"
                  style={{ background: C.surface, border: `1px solid ${C.line}`, color: C.ink }}
                />
              </div>
            </div>

            <div className="px-6 py-4 flex gap-2" style={{ borderTop: `1px solid ${C.line}` }}>
              <button
                onClick={() => { setRegisterModal(false); resetRegisterForm(); }}
                className="flex-1 py-3 rounded-xl font-semibold"
                style={{ background: C.bg, color: C.inkDim }}
              >
                취소
              </button>
              <button
                onClick={handleRegister}
                disabled={registerLoading || !regSiteId || !regMaterial.trim()}
                className="flex-[2] py-3 rounded-xl font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ background: C.amber, color: '#fff' }}
              >
                {registerLoading ? '등록 중...' : '자재신청 등록'}
              </button>
            </div>
          </div>
        </div>
      )}

      <TabBar active="material" />
    </div>
  );
}
