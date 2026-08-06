'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';

// ✅ 상태 흐름: 신청중 → 분출(발송) → 수령완료 → 교체완료
const STATUS_STYLE: Record<string, { bg: string; text: string; border: string; label: string }> = {
  '신청중':   { bg: 'bg-yellow-50',  text: 'text-yellow-800', border: 'border-yellow-300', label: '신청중' },
  '분출':     { bg: 'bg-purple-50',  text: 'text-purple-800', border: 'border-purple-300', label: '분출(발송)' },
  '수령':     { bg: 'bg-green-50',   text: 'text-green-800',  border: 'border-green-300',  label: '수령완료' },
  '교체완료': { bg: 'bg-blue-50',    text: 'text-blue-800',   border: 'border-blue-300',   label: '교체완료' },
  '반려':     { bg: 'bg-red-50',     text: 'text-red-800',    border: 'border-red-300',    label: '반려' },
};

type MaterialRequest = {
  id: string;
  company_id: string;
  site_id: string;
  site_name: string;
  team?: string;
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
};

type UserInfo = {
  id: string;
  email: string;
  company_id: string;
  role: string;
  name?: string;
};

export default function MaterialPage() {
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  const [requests, setRequests] = useState<MaterialRequest[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
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

  const chanRef = useRef<any>(null);

  // ✅ 핵심: site_id 기준으로 조회
  const loadAll = async (uid?: string, cid?: string) => {
    try {
      setLoading(true);
      const targetCid = cid || userInfo?.company_id;
      if (!targetCid) return;

      // 1. 내 회사 현장 목록
      const { data: siteData } = await supabase
        .from('sites')
        .select('id, site_name, company_id')
        .eq('company_id', targetCid);
      const siteList = siteData || [];
      setSites(siteList);
      const siteIds = siteList.map((s: Site) => s.id);

      // 2. site_id 기준으로 자재신청 조회
      if (siteIds.length === 0) {
        setRequests([]);
        return;
      }
      const { data, error } = await supabase
        .from('material_requests')
        .select('*')
        .in('site_id', siteIds)  // ✅ 핵심 변경
        .order('created_at', { ascending: false });

      if (error) throw error;
      setRequests(data || []);
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
      // 각 상태별 날짜 자동 기록
      if (newStatus === '분출')     updateData.dispatched_at = new Date().toISOString();
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
        <td>${r.hogi_no}</td>
        <td>${r.material_name}${r.spec ? ` (${r.spec})` : ''}</td>
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
        table { width: 100%; border-collapse: collapse; font-size: 11px; margin-top: 16px; }
        th, td { border: 1px solid #ccc; padding: 5px 7px; text-align: center; }
        th { background: #f3f4f6; font-weight: bold; }
        tr:nth-child(even) { background: #f9fafb; }
      </style></head>
      <body>
        <h1>자재신청 내역</h1>
        <p style="text-align:center;color:#666;">총 ${list.length}건</p>
        <table>
          <thead><tr>
            <th>#</th><th>신청일</th><th>현장</th><th>호기</th><th>자재명</th>
            <th>수량</th><th>사유</th><th>상태</th><th>신청자</th>
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
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">자재신청 내역 불러오는 중...</div>
      </div>
    );
  }

  return (
    <div className="p-4 max-w-7xl mx-auto">
      {/* 헤더 */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">자재신청 관리</h1>
        <button
          onClick={() => setPdfModal(true)}
          className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200"
        >
          📄 PDF 출력
        </button>
      </div>

      {/* 상태 요약 카드 */}
      <div className="grid grid-cols-5 gap-3 mb-6">
        {['신청중', '분출', '수령', '교체완료', '반려'].map(s => {
          const cnt = requests.filter(r => r.status === s).length;
          const style = STATUS_STYLE[s];
          return (
            <button key={s}
              onClick={() => { setStatusFilter(s === statusFilter ? '전체' : s); setPage(1); }}
              className={`p-3 rounded-xl border-2 text-center transition-all ${
                statusFilter === s
                  ? `${style.bg} ${style.border} ${style.text}`
                  : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
              }`}>
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
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm w-72"
        />
        <select
          value={statusFilter}
          onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
        >
          <option value="전체">전체 상태</option>
          {Object.entries(STATUS_STYLE).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
        <select
          value={teamFilter}
          onChange={e => { setTeamFilter(e.target.value); setPage(1); }}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
        >
          {teams.map(t => <option key={t} value={t}>{t === '전체' ? '전체 팀' : t}</option>)}
        </select>
        <span className="ml-auto text-sm text-gray-500 self-center">
          총 {filtered.length}건
        </span>
      </div>

      {/* 테이블 */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">신청일</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">현장 / 호기</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">자재명</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">수량</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">신청자</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">상태</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">처리</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {paginated.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-gray-400">
                  자재신청 내역이 없습니다.
                </td>
              </tr>
            ) : paginated.map(item => {
              const style = STATUS_STYLE[item.status] || STATUS_STYLE['신청중'];
              return (
                <tr key={item.id} className="hover:bg-gray-50 cursor-pointer"
                  onClick={() => setDetailItem(item)}>
                  <td className="px-4 py-3 text-gray-500 text-xs">
                    {item.request_at ? item.request_at.slice(0, 10) : item.created_at?.slice(0, 10)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900">{item.site_name}</div>
                    <div className="text-xs text-gray-400">{item.hogi_no}호기 {item.team ? `· ${item.team}` : ''}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900">{item.material_name}</div>
                    {item.spec && <div className="text-xs text-gray-400">{item.spec}</div>}
                  </td>
                  <td className="px-4 py-3 font-semibold text-amber-600">
                    {item.quantity}{item.unit}
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{item.requester_name || '-'}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded-full text-xs font-semibold border ${style.bg} ${style.text} ${style.border}`}>
                      {style.label}
                    </span>
                  </td>
                  <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                    {/* ✅ 웹 운영자 전용 분출 버튼 */}
                    {item.status === '신청중' && (
                      <button
                        onClick={() => handleStatusChange(item, '분출')}
                        className="px-3 py-1 bg-purple-600 text-white rounded-lg text-xs font-semibold hover:bg-purple-700"
                      >
                        📦 분출처리
                      </button>
                    )}
                    {item.status === '분출' && (
                      <span className="text-xs text-purple-600 font-medium">
                        발송완료<br/>
                        <span className="text-gray-400">{item.dispatched_at ? item.dispatched_at.slice(0,10) : ''}</span>
                      </span>
                    )}
                    {item.status === '수령' && (
                      <span className="text-xs text-green-600 font-medium">
                        수령완료<br/>
                        <span className="text-gray-400">{item.received_at ? item.received_at.slice(0,10) : ''}</span>
                      </span>
                    )}
                    {item.status === '교체완료' && (
                      <span className="text-xs text-blue-600 font-medium">
                        교체완료<br/>
                        <span className="text-gray-400">{item.replaced_at ? item.replaced_at.slice(0,10) : ''}</span>
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
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
            className="px-3 py-1 rounded border text-sm disabled:opacity-40">이전</button>
          {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
            const p = Math.max(1, Math.min(page - 2, totalPages - 4)) + i;
            return (
              <button key={p} onClick={() => setPage(p)}
                className={`px-3 py-1 rounded border text-sm ${page === p ? 'bg-amber-500 text-white border-amber-500' : ''}`}>
                {p}
              </button>
            );
          })}
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
            className="px-3 py-1 rounded border text-sm disabled:opacity-40">다음</button>
        </div>
      )}

      {/* 상세 모달 */}
      {detailItem && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold text-gray-900">자재신청 상세</h2>
                <button onClick={() => setDetailItem(null)} className="text-gray-400 hover:text-gray-600 text-2xl">×</button>
              </div>

              {/* 상태 배지 */}
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

              {/* 상세 정보 */}
              <div className="space-y-3 text-sm">
                <div className="grid grid-cols-2 gap-3">
                  <div><span className="text-gray-400">현장</span><p className="font-medium">{detailItem.site_name}</p></div>
                  <div><span className="text-gray-400">호기</span><p className="font-medium">{detailItem.hogi_no}호기</p></div>
                  <div><span className="text-gray-400">자재명</span><p className="font-medium">{detailItem.material_name}</p></div>
                  <div><span className="text-gray-400">수량</span><p className="font-medium">{detailItem.quantity}{detailItem.unit}</p></div>
                  {detailItem.spec && <div><span className="text-gray-400">규격</span><p className="font-medium">{detailItem.spec}</p></div>}
                  {detailItem.part_number && <div><span className="text-gray-400">부품번호</span><p className="font-medium">{detailItem.part_number}</p></div>}
                  <div><span className="text-gray-400">신청자</span><p className="font-medium">{detailItem.requester_name || '-'}</p></div>
                  <div><span className="text-gray-400">팀</span><p className="font-medium">{detailItem.team || '-'}</p></div>
                  {detailItem.reason && <div className="col-span-2"><span className="text-gray-400">사유</span><p className="font-medium">{detailItem.reason}</p></div>}
                  {detailItem.note && <div className="col-span-2"><span className="text-gray-400">비고</span><p className="font-medium">{detailItem.note}</p></div>}
                </div>

                {/* ✅ 날짜/시간 타임라인 */}
                <div className="mt-4 pt-4 border-t border-gray-100">
                  <p className="text-xs font-semibold text-gray-400 mb-2">처리 이력</p>
                  <div className="space-y-1 text-xs">
                    <div className="flex justify-between">
                      <span className="text-gray-500">📋 신청일시</span>
                      <span className="font-medium">{fmtDate(detailItem.request_at || detailItem.created_at)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">📦 분출일시</span>
                      <span className={`font-medium ${detailItem.dispatched_at ? 'text-purple-600' : 'text-gray-300'}`}>
                        {fmtDate(detailItem.dispatched_at)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">✅ 수령일시</span>
                      <span className={`font-medium ${detailItem.received_at ? 'text-green-600' : 'text-gray-300'}`}>
                        {fmtDate(detailItem.received_at)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">🔧 교체일시</span>
                      <span className={`font-medium ${detailItem.replaced_at ? 'text-blue-600' : 'text-gray-300'}`}>
                        {fmtDate(detailItem.replaced_at)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* ✅ 웹 운영자 액션 버튼 */}
              <div className="mt-6 space-y-2">
                {detailItem.status === '신청중' && (
                  <button
                    onClick={() => handleStatusChange(detailItem, '분출')}
                    disabled={actionLoading}
                    className="w-full py-3 bg-purple-600 text-white rounded-xl font-semibold hover:bg-purple-700 disabled:opacity-50"
                  >
                    📦 분출처리 (발송)
                  </button>
                )}
                {detailItem.status === '분출' && (
                  <button
                    onClick={() => handleStatusChange(detailItem, '수령')}
                    disabled={actionLoading}
                    className="w-full py-3 bg-green-600 text-white rounded-xl font-semibold hover:bg-green-700 disabled:opacity-50"
                  >
                    ✅ 수령완료 처리
                  </button>
                )}
                {detailItem.status === '수령' && (
                  <button
                    onClick={() => handleStatusChange(detailItem, '교체완료')}
                    disabled={actionLoading}
                    className="w-full py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 disabled:opacity-50"
                  >
                    🔧 교체완료 처리
                  </button>
                )}
                {(detailItem.status === '신청중' || detailItem.status === '분출') && (
                  <button
                    onClick={() => handleStatusChange(detailItem, '반려')}
                    disabled={actionLoading}
                    className="w-full py-3 bg-red-50 text-red-600 border border-red-200 rounded-xl font-semibold hover:bg-red-100 disabled:opacity-50"
                  >
                    ✕ 반려 처리
                  </button>
                )}
                <button
                  onClick={() => handleDelete(detailItem.id)}
                  className="w-full py-2 text-gray-400 text-sm hover:text-red-500"
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
          <div className="bg-white rounded-2xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold">PDF 출력 옵션</h2>
              <button onClick={() => setPdfModal(false)} className="text-gray-400 text-2xl">×</button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-gray-500">현장 선택 (선택 안 하면 전체)</label>
                <select value={pdfSiteId} onChange={e => setPdfSiteId(e.target.value)}
                  className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-lg text-sm">
                  <option value="">전체 현장</option>
                  {sites.map(s => <option key={s.id} value={s.id}>{s.site_name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-semibold text-gray-500">시작일</label>
                  <input type="date" value={pdfStart} onChange={e => setPdfStart(e.target.value)}
                    className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-500">종료일</label>
                  <input type="date" value={pdfEnd} onChange={e => setPdfEnd(e.target.value)}
                    className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500">상태 필터</label>
                <select value={pdfStatus} onChange={e => setPdfStatus(e.target.value)}
                  className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-lg text-sm">
                  <option value="전체">전체 상태</option>
                  {Object.entries(STATUS_STYLE).map(([k, v]) => (
                    <option key={k} value={k}>{v.label}</option>
                  ))}
                </select>
              </div>
              <button onClick={exportPDF}
                className="w-full py-3 bg-amber-500 text-white rounded-xl font-semibold hover:bg-amber-600">
                📄 PDF 출력
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
