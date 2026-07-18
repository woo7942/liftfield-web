'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';

type MaterialStatus = '신청중' | '접수' | '자재분출' | '자재교체';

type MaterialRequest = {
  id: string;
  company_id: string;
  team?: string;
  site_id: string;
  site_name: string;
  hogi_no: string;
  material_name: string;
  part_number?: string;
  spec?: string;
  quantity: number;
  unit: string;
  reason?: string;
  contract_type?: string;
  requester_id?: string;
  requester_name?: string;
  receiver_id?: string;
  receiver_name?: string;
  dispatcher_id?: string;
  dispatcher_name?: string;
  replacer_id?: string;
  replacer_name?: string;
  status: MaterialStatus;
  requested_at?: string | null;
  received_at?: string | null;
  dispatched_at?: string | null;
  replaced_at?: string | null;
  note?: string;
  created_at?: string | null;
};

type Site = {
  id: string;
  name: string;
  company_id?: string;
  team_name?: string;
  contract_type?: string;
};

const STATUS_STYLE: Record<MaterialStatus, { bg: string; text: string; border: string; label: string }> = {
  신청중:   { bg: '#FEF3C7', text: '#92400E', border: '#F59E0B', label: '신청중'   },
  접수:     { bg: '#EDE9FE', text: '#5B21B6', border: '#8B5CF6', label: '접수'     },
  자재분출: { bg: '#DBEAFE', text: '#1E40AF', border: '#3B82F6', label: '자재분출' },
  자재교체: { bg: '#D1FAE5', text: '#065F46', border: '#10B981', label: '교체완료' },
};

const formatTs = (ts: string | null | undefined): string => {
  if (!ts) return '-';
  try {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return '-';
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  } catch { return '-'; }
};

const formatTsTwo = (ts: string | null | undefined): { date: string; time: string } => {
  if (!ts) return { date: '-', time: '' };
  try {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return { date: '-', time: '' };
    return {
      date: `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`,
      time: `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`,
    };
  } catch { return { date: '-', time: '' }; }
};

const tsToDateStr = (ts: string | null | undefined): string => {
  if (!ts) return '';
  try {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return '';
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  } catch { return ''; }
};

const printHtml = (html: string) => {
  const w = window.open('', '_blank');
  if (!w) return;
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 500);
};

export default function MaterialPage() {
  const [userInfo, setUserInfo]   = useState<any>(null);
  const [loading, setLoading]     = useState(true);
  const [requests, setRequests]   = useState<MaterialRequest[]>([]);
  const [sites, setSites]         = useState<Site[]>([]);
  const [search, setSearch]       = useState('');
  const [statusFilter, setStatusFilter] = useState<MaterialStatus | '전체'>('전체');
  const [teamFilter, setTeamFilter]     = useState('전체');
  const [detailModal, setDetailModal]   = useState(false);
  const [selected, setSelected]         = useState<MaterialRequest | null>(null);
  const [pdfModal, setPdfModal]         = useState(false);
  const [pdfSiteId, setPdfSiteId]       = useState('');
  const [pdfSiteName, setPdfSiteName]   = useState('');
  const [pdfSiteSearch, setPdfSiteSearch] = useState('');
  const [pdfDateFrom, setPdfDateFrom]   = useState('');
  const [pdfDateTo, setPdfDateTo]       = useState('');
  const [pdfStatusFilter, setPdfStatusFilter] = useState<MaterialStatus | '전체'>('전체');

  useEffect(() => {
    let matChannel: ReturnType<typeof supabase.channel> | null = null;

    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { window.location.href = '/login'; return; }

      const { data: userData } = await supabase
        .from('users')
        .select('*')
        .eq('id', user.id)
        .single();
      if (!userData) { window.location.href = '/login'; return; }

      if (!['admin', 'superadmin'].includes(userData.role) && userData.super_admin !== true) {
        alert('관리자만 접근 가능합니다.');
        window.location.href = '/';
        return;
      }
      setUserInfo({ ...userData, uid: user.id });

      const cid = userData.company_id || '';

      // material_requests 초기 로드
      const { data: matData } = await supabase
        .from('material_requests')
        .select('*')
        .eq('company_id', cid)
        .order('created_at', { ascending: false });
      setRequests((matData || []) as MaterialRequest[]);

      // sites 로드
      const { data: sitesData } = await supabase
        .from('sites')
        .select('id, name, company_id, team_name, contract_type')
        .eq('company_id', cid);
      setSites((sitesData || []) as Site[]);

      setLoading(false);

      // Realtime: material_requests
      matChannel = supabase
        .channel(`material-channel-${cid}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'material_requests', filter: `company_id=eq.${cid}` }, async () => {
          const { data } = await supabase
            .from('material_requests')
            .select('*')
            .eq('company_id', cid)
            .order('created_at', { ascending: false });
          setRequests((data || []) as MaterialRequest[]);
        })
        .subscribe();
    };

    init();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') window.location.href = '/login';
    });

    return () => {
      subscription.unsubscribe();
      if (matChannel) supabase.removeChannel(matChannel);
    };
  }, []);

  const teams = useMemo(() => {
    const set = new Set(requests.map((r) => r.team).filter(Boolean) as string[]);
    return ['전체', ...Array.from(set)];
  }, [requests]);

  const filtered = useMemo(() => {
    let list = requests;
    if (teamFilter !== '전체')   list = list.filter((r) => r.team === teamFilter);
    if (statusFilter !== '전체') list = list.filter((r) => r.status === statusFilter);
    if (search.trim()) {
      const s = search.toLowerCase();
      list = list.filter((r) =>
        r.site_name?.toLowerCase().includes(s) ||
        r.material_name?.toLowerCase().includes(s) ||
        r.hogi_no?.toLowerCase().includes(s) ||
        r.requester_name?.toLowerCase().includes(s) ||
        r.part_number?.toLowerCase().includes(s) ||
        r.contract_type?.toLowerCase().includes(s)
      );
    }
    return list;
  }, [requests, search, statusFilter, teamFilter]);

  const stats = useMemo(() => ({
    전체:     requests.length,
    신청중:   requests.filter((r) => r.status === '신청중').length,
    접수:     requests.filter((r) => r.status === '접수').length,
    자재분출: requests.filter((r) => r.status === '자재분출').length,
    자재교체: requests.filter((r) => r.status === '자재교체').length,
  }), [requests]);

  // ✅ 접수 처리
  const handleReceive = async (item: MaterialRequest) => {
    if (!confirm(`${item.material_name} 접수 처리하시겠습니까?`)) return;
    try {
      const { error } = await supabase.from('material_requests').update({
        status:        '접수',
        received_at:   new Date().toISOString(),
        receiver_id:   userInfo?.uid  || '',
        receiver_name: userInfo?.name || '',
      }).eq('id', item.id);
      if (error) throw error;
    } catch { alert('접수 처리 실패'); }
  };

  const handleDispatch = async (item: MaterialRequest) => {
    if (!confirm(`${item.material_name} 자재분출 처리하시겠습니까?`)) return;
    try {
      const { error } = await supabase.from('material_requests').update({
        status:          '자재분출',
        dispatched_at:   new Date().toISOString(),
        dispatcher_id:   userInfo?.uid  || '',
        dispatcher_name: userInfo?.name || '',
      }).eq('id', item.id);
      if (error) throw error;
    } catch { alert('자재분출 처리 실패'); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('이 자재신청을 삭제하시겠습니까?')) return;
    try {
      const { error } = await supabase.from('material_requests').delete().eq('id', id);
      if (error) throw error;
      setDetailModal(false);
    } catch { alert('삭제 실패'); }
  };

  const pdfFiltered = useMemo(() => {
    let list = requests;
    if (pdfSiteId)          list = list.filter((r) => r.site_id === pdfSiteId);
    if (pdfStatusFilter !== '전체') list = list.filter((r) => r.status === pdfStatusFilter);
    if (pdfDateFrom)        list = list.filter((r) => tsToDateStr(r.requested_at) >= pdfDateFrom);
    if (pdfDateTo)          list = list.filter((r) => tsToDateStr(r.requested_at) <= pdfDateTo);
    return list;
  }, [requests, pdfSiteId, pdfStatusFilter, pdfDateFrom, pdfDateTo]);

  const exportPDF = () => {
    if (pdfFiltered.length === 0) { alert('출력할 내역이 없습니다.'); return; }
    const titleSite   = pdfSiteId ? (sites.find((s) => s.id === pdfSiteId)?.name || '') : '전체 현장';
    const titlePeriod = pdfDateFrom && pdfDateTo ? `${pdfDateFrom} ~ ${pdfDateTo}`
      : pdfDateFrom ? `${pdfDateFrom} 이후` : pdfDateTo ? `${pdfDateTo} 이전` : '전체 기간';

    const rows = pdfFiltered.map((r, i) => `
      <tr>
        <td style="text-align:center">${i+1}</td>
        <td>${formatTs(r.requested_at)}</td>
        <td>${r.site_name}</td>
        <td style="text-align:center">${r.hogi_no}</td>
        <td>${r.contract_type || '-'}</td>
        <td>${r.material_name}${r.spec ? ` (${r.spec})` : ''}</td>
        <td>${r.part_number || '-'}</td>
        <td style="text-align:center">${r.quantity}${r.unit}</td>
        <td>${r.reason || '-'}</td>
        <td style="text-align:center">
          <span style="padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600;
            background:${r.status==='신청중'?'#FEF3C7':r.status==='접수'?'#EDE9FE':r.status==='자재분출'?'#DBEAFE':'#D1FAE5'};
            color:${r.status==='신청중'?'#92400E':r.status==='접수'?'#5B21B6':r.status==='자재분출'?'#1E40AF':'#065F46'}">
            ${r.status}
          </span>
        </td>
        <td>${r.requester_name || '-'}</td>
        <td>${formatTs(r.received_at)}</td>
        <td>${formatTs(r.dispatched_at)}</td>
        <td>${formatTs(r.replaced_at)}</td>
      </tr>`).join('');

    printHtml(`
      <html><head><meta charset="utf-8"/>
        <style>
          @page { size: A4 landscape; margin: 15mm; }
          body { font-family: Arial, sans-serif; }
          h1 { text-align:center; font-size:20px; margin-bottom:4px; }
          h3 { text-align:center; color:#6B7280; font-weight:normal; margin-top:0; margin-bottom:16px; font-size:13px; }
          table { width:100%; border-collapse:collapse; font-size:10px; }
          th,td { border:1px solid #ddd; padding:4px 6px; }
          th { background:#F3F4F6; }
          tr:nth-child(even) { background:#F9FAFB; }
        </style>
      </head>
      <body>
        <h1>자재신청 내역</h1>
        <h3>${titleSite} / ${titlePeriod} (총 ${pdfFiltered.length}건)</h3>
        <table>
          <thead><tr>
            <th>번호</th><th>신청일시</th><th>현장</th><th>호기</th>
            <th>계약종류</th><th>자재명</th><th>파트번호</th><th>수량</th>
            <th>사유</th><th>상태</th><th>신청자</th>
            <th>접수일시</th><th>분출일시</th><th>교체완료일시</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </body></html>`);
    setPdfModal(false);
  };

  const currentSelected = useMemo(() =>
    selected ? (requests.find((r) => r.id === selected.id) || selected) : null,
  [selected, requests]);

  if (loading) return (
    <div className="flex items-center justify-center h-screen">
      <div className="text-center">
        <div className="w-10 h-10 border-4 border-yellow-400 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-gray-500">자재신청 내역 불러오는 중...</p>
      </div>
    </div>
  );

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* 헤더 */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">자재신청 관리</h1>
          <p className="text-sm text-gray-500 mt-1">앱에서 신청된 자재를 확인하고 처리하세요</p>
        </div>
        <button onClick={() => setPdfModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 font-semibold text-sm">
          📄 PDF 출력
        </button>
      </div>

      {/* 통계 카드 */}
      <div className="grid grid-cols-5 gap-3 mb-6">
        {([
          { label: '전체',     value: stats.전체,     color: 'text-gray-700',   bg: 'bg-gray-50',    border: 'border-gray-200'   },
          { label: '신청중',   value: stats.신청중,   color: 'text-yellow-700', bg: 'bg-yellow-50',  border: 'border-yellow-200' },
          { label: '접수',     value: stats.접수,     color: 'text-purple-700', bg: 'bg-purple-50',  border: 'border-purple-200' },
          { label: '자재분출', value: stats.자재분출, color: 'text-blue-700',   bg: 'bg-blue-50',    border: 'border-blue-200'   },
          { label: '교체완료', value: stats.자재교체, color: 'text-green-700',  bg: 'bg-green-50',   border: 'border-green-200'  },
        ] as const).map((s) => (
          <div key={s.label} className={`${s.bg} rounded-xl p-4 border ${s.border}`}>
            <p className={`text-3xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-sm text-gray-500 mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      {/* 필터 */}
      <div className="flex flex-wrap gap-3 mb-4">
        <input type="text" placeholder="현장명, 자재명, 파트번호, 계약종류, 신청자 검색"
          value={search} onChange={(e) => setSearch(e.target.value)}
          className="border border-gray-200 rounded-lg px-4 py-2 text-sm w-80 focus:outline-none focus:ring-2 focus:ring-yellow-400" />
        <div className="flex gap-2">
          {(['전체', '신청중', '접수', '자재분출', '자재교체'] as const).map((s) => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={`px-3 py-2 rounded-lg text-sm font-semibold border transition-colors ${
                statusFilter === s ? 'bg-yellow-400 text-white border-yellow-400' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
              }`}>
              {s === '자재교체' ? '교체완료' : s}
            </button>
          ))}
        </div>
        {teams.length > 1 && (
          <select value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400">
            {teams.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        )}
      </div>

      {/* 테이블 */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {['상태','신청일시','현장','호기','계약종류','자재명','파트번호','수량','신청자','접수일시','분출일시','교체완료일시','처리'].map((h) => (
                  <th key={h} className="px-3 py-3 text-left text-xs font-semibold text-gray-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.length === 0 ? (
                <tr><td colSpan={13} className="text-center py-16 text-gray-400">
                  <div className="text-4xl mb-2">📦</div>
                  <p>자재신청 내역이 없습니다.</p>
                </td></tr>
              ) : filtered.map((r) => {
                const st = STATUS_STYLE[r.status] || STATUS_STYLE['신청중'];
                return (
                  <tr key={r.id} className="hover:bg-gray-50 cursor-pointer"
                    onClick={() => { setSelected(r); setDetailModal(true); }}>
                    <td className="px-3 py-3">
                      <span style={{ background: st.bg, color: st.text, border: `1px solid ${st.border}` }}
                        className="px-2 py-1 rounded-full text-xs font-semibold whitespace-nowrap">
                        {st.label}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-xs">
                      {(() => { const t = formatTsTwo(r.requested_at); return (
                        <><p className="text-gray-600 font-medium">{t.date}</p>
                          <p className="text-gray-400">{t.time}</p></>
                      ); })()}
                    </td>
                    <td className="px-3 py-3 font-semibold text-gray-900">{r.site_name}</td>
                    <td className="px-3 py-3 text-gray-700 text-xs font-semibold">{r.hogi_no}</td>
                    <td className="px-3 py-3 text-blue-700 text-xs font-semibold">{r.contract_type || '-'}</td>
                    <td className="px-3 py-3 text-gray-900 text-sm">{r.material_name}{r.spec ? ` (${r.spec})` : ''}</td>
                    <td className="px-3 py-3 text-gray-500 text-xs font-mono">{r.part_number || '-'}</td>
                    <td className="px-3 py-3 font-semibold text-yellow-700">{r.quantity}{r.unit}</td>
                    <td className="px-3 py-3 text-gray-600">{r.requester_name || '-'}</td>
                    <td className="px-3 py-3 text-xs">
                      {(() => { const t = formatTsTwo(r.received_at); return (
                        <><p className="text-gray-600 font-medium">{t.date}</p>
                          <p className="text-gray-400">{t.time}</p></>
                      ); })()}
                    </td>
                    <td className="px-3 py-3 text-xs">
                      {(() => { const t = formatTsTwo(r.dispatched_at); return (
                        <><p className="text-gray-600 font-medium">{t.date}</p>
                          <p className="text-gray-400">{t.time}</p></>
                      ); })()}
                    </td>
                    <td className="px-3 py-3 text-xs">
                      {(() => { const t = formatTsTwo(r.replaced_at); return (
                        <><p className="text-gray-600 font-medium">{t.date}</p>
                          <p className="text-gray-400">{t.time}</p></>
                      ); })()}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                      {r.status === '신청중' && (
                        <button onClick={() => handleReceive(r)}
                          className="px-3 py-1.5 bg-purple-100 text-purple-700 rounded-lg text-xs font-semibold hover:bg-purple-200">
                          📬 접수
                        </button>
                      )}
                      {r.status === '접수' && (
                        <button onClick={() => handleDispatch(r)}
                          className="px-3 py-1.5 bg-blue-100 text-blue-700 rounded-lg text-xs font-semibold hover:bg-blue-200">
                          📦 자재분출
                        </button>
                      )}
                      {r.status === '자재분출' && (
                        <span className="text-xs text-blue-500 font-semibold">앱에서 처리</span>
                      )}
                      {r.status === '자재교체' && (
                        <span className="text-xs text-gray-400">완료</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── 상세 모달 ── */}
      {detailModal && currentSelected && (() => {
        const st = STATUS_STYLE[currentSelected.status] || STATUS_STYLE['신청중'];
        return (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden">
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
                <h2 className="text-lg font-bold text-gray-900">자재신청 상세</h2>
                <button onClick={() => setDetailModal(false)} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
              </div>
              <div className="p-6 overflow-y-auto max-h-[70vh]">
                <div className="flex justify-center mb-6">
                  <span style={{ background: st.bg, color: st.text, border: `1px solid ${st.border}` }}
                    className="px-6 py-2 rounded-full text-sm font-bold">{st.label}</span>
                </div>

                <div className="bg-gray-50 rounded-xl p-4 mb-4">
                  <p className="text-xs font-bold text-blue-600 mb-3">📋 신청 정보</p>
                  {[
                    { label: '현장',     value: currentSelected.site_name },
                    { label: '호기',     value: currentSelected.hogi_no },
                    { label: '계약종류', value: currentSelected.contract_type || '-' },
                    { label: '자재명',   value: `${currentSelected.material_name}${currentSelected.spec ? ` (${currentSelected.spec})` : ''}` },
                    { label: '파트번호', value: currentSelected.part_number || '-' },
                    { label: '수량',     value: `${currentSelected.quantity}${currentSelected.unit}` },
                    { label: '사유',     value: currentSelected.reason || '-' },
                    { label: '비고',     value: currentSelected.note   || '-' },
                  ].map((row) => (
                    <div key={row.label} className="flex py-2 border-b border-gray-100 last:border-0">
                      <span className="w-20 text-xs text-gray-500 font-semibold shrink-0">{row.label}</span>
                      <span className={`text-sm flex-1 ${row.label==='파트번호'?'font-mono text-gray-600':row.label==='계약종류'?'text-blue-700 font-semibold':'text-gray-900'}`}>
                        {row.value}
                      </span>
                    </div>
                  ))}
                </div>

                <div className="bg-gray-50 rounded-xl p-4 mb-4">
                  <p className="text-xs font-bold text-blue-600 mb-3">⏱ 처리 이력</p>
                  {[
                    { label: '신청일시', value: formatTs(currentSelected.requested_at),  sub: currentSelected.requester_name },
                    { label: '접수일시', value: formatTs(currentSelected.received_at),   sub: currentSelected.receiver_name  },
                    { label: '분출일시', value: formatTs(currentSelected.dispatched_at), sub: currentSelected.dispatcher_name },
                    { label: '교체완료', value: formatTs(currentSelected.replaced_at),   sub: currentSelected.replacer_name  },
                  ].map((row) => (
                    <div key={row.label} className="flex py-2 border-b border-gray-100 last:border-0">
                      <span className="w-20 text-xs text-gray-500 font-semibold shrink-0">{row.label}</span>
                      <div className="flex-1">
                        <p className="text-sm text-gray-900">{row.value}</p>
                        {row.sub && <p className="text-xs text-gray-400 mt-0.5">{row.sub}</p>}
                      </div>
                    </div>
                  ))}
                </div>

                {currentSelected.status === '신청중' && (
                  <button onClick={() => handleReceive(currentSelected)}
                    className="w-full py-3 bg-purple-600 text-white rounded-xl font-bold hover:bg-purple-700 mb-2">
                    📬 접수 처리
                  </button>
                )}
                {currentSelected.status === '접수' && (
                  <button onClick={() => handleDispatch(currentSelected)}
                    className="w-full py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 mb-2">
                    📦 자재분출 처리
                  </button>
                )}
                {currentSelected.status === '자재분출' && (
                  <div className="w-full py-3 bg-blue-50 text-blue-600 rounded-xl text-sm font-semibold text-center mb-2">
                    🛗 교체완료는 앱에서 처리해주세요
                  </div>
                )}
                <button onClick={() => handleDelete(currentSelected.id)}
                  className="w-full py-2.5 bg-red-50 text-red-600 rounded-xl font-semibold hover:bg-red-100 text-sm mt-1">
                  🗑 삭제
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── PDF 모달 ── */}
      {pdfModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="text-lg font-bold text-gray-900">PDF 출력 옵션</h2>
              <button onClick={() => setPdfModal(false)} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
            </div>
            <div className="p-6 overflow-y-auto max-h-[75vh]">
              <p className="text-xs font-semibold text-gray-500 mb-2">출력 기간</p>
              <div className="flex flex-wrap gap-2 mb-3">
                {[
                  { label: '이번 달', action: () => {
                    const t = new Date(), y = t.getFullYear(), m = String(t.getMonth()+1).padStart(2,'0');
                    const last = new Date(y, t.getMonth()+1, 0).getDate();
                    setPdfDateFrom(`${y}-${m}-01`); setPdfDateTo(`${y}-${m}-${String(last).padStart(2,'0')}`);
                  }},
                  { label: '지난 달', action: () => {
                    const t = new Date(), prev = new Date(t.getFullYear(), t.getMonth()-1, 1);
                    const y = prev.getFullYear(), m = String(prev.getMonth()+1).padStart(2,'0');
                    const last = new Date(y, prev.getMonth()+1, 0).getDate();
                    setPdfDateFrom(`${y}-${m}-01`); setPdfDateTo(`${y}-${m}-${String(last).padStart(2,'0')}`);
                  }},
                  { label: '최근 3개월', action: () => {
                    const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
                    const end = new Date(), start = new Date(); start.setMonth(start.getMonth()-3);
                    setPdfDateFrom(fmt(start)); setPdfDateTo(fmt(end));
                  }},
                  { label: '전체 기간', action: () => { setPdfDateFrom(''); setPdfDateTo(''); }},
                ].map((btn) => (
                  <button key={btn.label} onClick={btn.action}
                    className="px-3 py-1.5 bg-yellow-50 border border-yellow-300 text-yellow-800 rounded-full text-xs font-semibold hover:bg-yellow-100">
                    {btn.label}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">시작일</label>
                  <input type="date" value={pdfDateFrom} onChange={(e) => setPdfDateFrom(e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">종료일</label>
                  <input type="date" value={pdfDateTo} onChange={(e) => setPdfDateTo(e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400" />
                </div>
              </div>

              <p className="text-xs font-semibold text-gray-500 mb-2">상태 필터</p>
              <div className="flex flex-wrap gap-2 mb-4">
                {(['전체', '신청중', '접수', '자재분출', '자재교체'] as const).map((s) => (
                  <button key={s} onClick={() => setPdfStatusFilter(s)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                      pdfStatusFilter === s ? 'bg-yellow-400 text-white border-yellow-400' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                    }`}>
                    {s === '자재교체' ? '교체완료' : s}
                  </button>
                ))}
              </div>

              <p className="text-xs font-semibold text-gray-500 mb-2">현장 선택 (선택 안 하면 전체)</p>
              {pdfSiteName ? (
                <div className="flex items-center justify-between bg-yellow-50 border border-yellow-300 rounded-lg px-3 py-2 mb-4">
                  <span className="text-sm font-semibold text-gray-800">{pdfSiteName}</span>
                  <button onClick={() => { setPdfSiteId(''); setPdfSiteName(''); }}
                    className="text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
                </div>
              ) : (
                <div className="relative mb-4">
                  <input
                    type="text"
                    placeholder="현장명 검색 (2글자 이상)"
                    value={pdfSiteSearch}
                    onChange={(e) => setPdfSiteSearch(e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400"
                  />
                  {pdfSiteSearch.trim().length >= 2 && (
                    <div className="absolute z-10 w-full bg-white border border-gray-200 rounded-lg mt-1 max-h-48 overflow-y-auto shadow-lg">
                      {sites
                        .filter((s) => s.name?.trim().toLowerCase().includes(pdfSiteSearch.toLowerCase()))
                        .slice(0, 20)
                        .length === 0 ? (
                        <p className="text-sm text-gray-400 px-3 py-2">검색 결과 없음</p>
                      ) : (
                        sites
                          .filter((s) => s.name?.trim().toLowerCase().includes(pdfSiteSearch.toLowerCase()))
                          .slice(0, 20)
                          .map((s) => (
                            <button key={s.id}
                              onClick={() => { setPdfSiteId(s.id); setPdfSiteName(s.name?.trim()); setPdfSiteSearch(''); }}
                              className="w-full text-left px-3 py-2 text-sm hover:bg-yellow-50 border-b border-gray-50 last:border-0">
                              {s.name?.trim()}
                            </button>
                          ))
                      )}
                    </div>
                  )}
                </div>
              )}

              <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-3 mb-4 text-sm text-yellow-800">
                출력 대상: <strong>{pdfFiltered.length}건</strong>
              </div>
              <button onClick={exportPDF}
                className="w-full py-3 bg-yellow-400 text-white rounded-xl font-bold hover:bg-yellow-500">
                📄 PDF 출력
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
