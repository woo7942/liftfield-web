'use client';

import { useEffect, useState, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

interface MaterialItem {
  name: string;
  unit: string;
  qty: number;
  unit_price: number;
  note: string;
}

type LaborType = '공' | '식';

const truncateThousand = (n: number) => Math.floor(n / 1000) * 1000;

// ── E안 SVG 컴포넌트 ──
function ElevatorLogo({ size = 40, color = '#1B1B1B', accent = '#8A6E4B' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none">
      <rect x="6" y="4" width="36" height="40" rx="1" stroke={color} strokeWidth="1.8"/>
      <line x1="24" y1="8" x2="24" y2="40" stroke={color} strokeWidth="1.2"/>
      <path d="M14 16 L18 12 L22 16" stroke={accent} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M26 32 L30 36 L34 32" stroke={accent} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
      <line x1="10" y1="24" x2="14" y2="24" stroke={color} strokeWidth="1.2"/>
      <line x1="34" y1="24" x2="38" y2="24" stroke={color} strokeWidth="1.2"/>
    </svg>
  );
}

export default function QuotePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [userInfo, setUserInfo] = useState<any>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [company, setCompany] = useState<any>(null);

  const [tab, setTab] = useState<'list' | 'company'>('list');

  const [quotes, setQuotes] = useState<any[]>([]);
  const [teams, setTeams] = useState<any[]>([]);
  const [filterTeam, setFilterTeam] = useState('all');
  const [filterMonth, setFilterMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });

  const [showCreate, setShowCreate] = useState(false);
  const [editingQuoteId, setEditingQuoteId] = useState<string | null>(null);
  const [createTeam, setCreateTeam] = useState('');
  const [siteSearch, setSiteSearch] = useState('');
  const [siteResults, setSiteResults] = useState<any[]>([]);
  const [selectedSite, setSelectedSite] = useState<any>(null);
  const [title, setTitle] = useState('');
  const [materials, setMaterials] = useState<MaterialItem[]>([
    { name: '', unit: '', qty: 1, unit_price: 0, note: '' },
  ]);

  const [laborType, setLaborType] = useState<LaborType>('공');
  const [laborQty, setLaborQty] = useState<number>(1);
  const [laborUnitPrice, setLaborUnitPrice] = useState<number>(0);

  const [includeIndirectLabor, setIncludeIndirectLabor] = useState(true);
  const [includeOverhead, setIncludeOverhead] = useState(true);
  const [includeProfit, setIncludeProfit] = useState(true);

  const [remarks, setRemarks] = useState('');
  const [saving, setSaving] = useState(false);

  const [selectedQuote, setSelectedQuote] = useState<any>(null);
  const [rejectReasonInput, setRejectReasonInput] = useState('');
  const [showRejectInput, setShowRejectInput] = useState(false);

  const [companyForm, setCompanyForm] = useState<any>({});
  const [companySaving, setCompanySaving] = useState(false);
  const [logoUploading, setLogoUploading] = useState(false);
  const [stampUploading, setStampUploading] = useState(false);

  const [pdfLoading, setPdfLoading] = useState(false);
  const printDocRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) { router.push('/login'); return; }
      const { data } = await supabase.from('users')
        .select('name, role, company_id, team, super_admin')
        .eq('id', session.user.id).single();
      if (!data?.company_id) { router.push('/'); return; }
      const admin = data.role === 'admin' || data.super_admin === true;
      setUserInfo({ ...data, uid: session.user.id });
      setIsAdmin(admin);

      const { data: companyData } = await supabase.from('companies')
        .select('*').eq('id', data.company_id).single();
      setCompany(companyData || null);
      setCompanyForm(companyData || {});

      if (admin) {
        const { data: teamData } = await supabase.from('teams')
          .select('id, name').eq('company_id', data.company_id);
        setTeams(teamData || []);
      }
      setLoading(false);
    };
    init();
  }, [router]);

  useEffect(() => {
    if (userInfo && !isAdmin) setCreateTeam(userInfo.team);
  }, [userInfo, isAdmin]);

  const loadQuotes = async () => {
    if (!userInfo) return;
    let q = supabase.from('quotes').select('*').order('created_at', { ascending: false });
    if (!isAdmin) {
      q = q.eq('team_id', userInfo.team);
    } else if (filterTeam !== 'all') {
      q = q.eq('team_id', filterTeam);
    }
    const { data } = await q;
    let list = data || [];
    if (filterMonth) {
      list = list.filter((x: any) => (x.created_at || '').slice(0, 7) === filterMonth);
    }
    setQuotes(list);
  };

  useEffect(() => { loadQuotes(); }, [userInfo, isAdmin, filterTeam, filterMonth]);

  useEffect(() => {
    if (!showCreate || !siteSearch.trim() || !userInfo) { setSiteResults([]); return; }
    if (isAdmin && !createTeam) { setSiteResults([]); return; }
    const t = setTimeout(async () => {
      let q = supabase.from('sites').select('id, name, site_name, address, phone, manager_name, team')
        .eq('company_id', userInfo.company_id);
      if (!isAdmin) q = q.eq('team', userInfo.team);
      else if (createTeam) q = q.eq('team', createTeam);
      const { data } = await q;
      const kw = siteSearch.toLowerCase();
      const filtered = (data || []).filter((s: any) =>
        (s.site_name || s.name || '').toLowerCase().includes(kw) ||
        (s.address || '').toLowerCase().includes(kw)
      );
      setSiteResults(filtered.slice(0, 20));
    }, 300);
    return () => clearTimeout(t);
  }, [siteSearch, showCreate, userInfo, isAdmin, createTeam]);

  const addMaterialRow = () => setMaterials(prev => [...prev, { name: '', unit: '', qty: 1, unit_price: 0, note: '' }]);
  const removeMaterialRow = (idx: number) => setMaterials(prev => prev.filter((_, i) => i !== idx));
  const updateMaterial = (idx: number, key: keyof MaterialItem, value: any) => {
    setMaterials(prev => prev.map((m, i) => i === idx ? { ...m, [key]: value } : m));
  };

  const rates = {
    labor_indirect: company?.labor_indirect_rate ?? 0.15,
    overhead: company?.overhead_rate ?? 0.12,
    profit: company?.profit_rate ?? 0.10,
    vat: company?.vat_rate ?? 0.10,
  };

  const calc = useMemo(() => {
    const materialsSubtotal = materials.reduce((sum, m) => sum + (Number(m.qty) || 0) * (Number(m.unit_price) || 0), 0);
    const laborDirect = (Number(laborQty) || 0) * (Number(laborUnitPrice) || 0);
    const laborIndirect = includeIndirectLabor ? laborDirect * rates.labor_indirect : 0;
    const laborSubtotal = laborDirect + laborIndirect;
    const overhead = includeOverhead ? (materialsSubtotal + laborSubtotal) * rates.overhead : 0;
    const profit = includeProfit ? (materialsSubtotal + overhead) * rates.profit : 0;
    const supplyAmount = materialsSubtotal + laborSubtotal + overhead + profit;
    const vat = supplyAmount * rates.vat;
    const total = truncateThousand(supplyAmount + vat);
    return { materialsSubtotal, laborDirect, laborIndirect, laborSubtotal, overhead, profit, supplyAmount, vat, total };
  }, [materials, laborQty, laborUnitPrice, rates, includeIndirectLabor, includeOverhead, includeProfit]);

  const resetCreateForm = () => {
    setSiteSearch(''); setSiteResults([]); setSelectedSite(null);
    setTitle(''); setMaterials([{ name: '', unit: '', qty: 1, unit_price: 0, note: '' }]);
    setLaborType('공'); setLaborQty(1); setLaborUnitPrice(0);
    setIncludeIndirectLabor(true); setIncludeOverhead(true); setIncludeProfit(true);
    setRemarks('');
    setEditingQuoteId(null);
    setCreateTeam(isAdmin ? '' : (userInfo?.team || ''));
  };

  const openEdit = (q: any) => {
    const items = q.items || {};
    setEditingQuoteId(q.id);
    setCreateTeam(q.team_id || (isAdmin ? '' : userInfo?.team || ''));
    setSelectedSite({
      id: q.site_id,
      site_name: items.site_name || (items.client_name || '').replace(' 귀중', ''),
      name: items.site_name || (items.client_name || '').replace(' 귀중', ''),
      address: items.site_address || '',
      phone: items.site_phone || '',
      manager_name: items.site_manager || '',
    });
    setTitle(items.title ?? q.title ?? '');
    setMaterials(items.materials && items.materials.length ? items.materials : [{ name: '', unit: '', qty: 1, unit_price: 0, note: '' }]);
    setLaborType(items.labor?.type || '공');
    setLaborQty(items.labor?.qty ?? 1);
    setLaborUnitPrice(items.labor?.unit_price ?? 0);
    setIncludeIndirectLabor(items.includeIndirectLabor !== false);
    setIncludeOverhead(items.includeOverhead !== false);
    setIncludeProfit(items.includeProfit !== false);
    setRemarks(items.remarks || '');
    setSelectedQuote(null);
    setShowCreate(true);
  };

  // ── 인쇄: html2canvas로 화면을 캡처해서 jsPDF로 A4 한 장 PDF 생성 ──
  // 브라우저 네이티브 인쇄(window.print())는 배경색 인쇄 여부와 페이지 분할이
  // 브라우저 설정/렌더링 타이밍에 따라 불안정하게 달라지는 문제가 있어,
  // 화면을 그대로 이미지로 캡처해 PDF에 삽입하는 방식으로 완전히 대체한다.
  const handlePrint = async () => {
  if (!printDocRef.current) return;
  setPdfLoading(true);
  try {
    const html2canvas = (await import('html2canvas')).default;
    const { jsPDF } = await import('jspdf');

    const el = printDocRef.current;
    const canvas = await html2canvas(el, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#FAF7F0',
    });

    const imgData = canvas.toDataURL('image/png');
    const pdf = new jsPDF('p', 'mm', 'a4');

    const pageWidth = 210;   // A4 가로 (mm) - 절대 줄이지 않음
    const pageHeight = 297;  // A4 세로 (mm)

    // 항상 가로는 페이지 전체 폭으로 고정
    const imgWidth = pageWidth;
    const imgHeight = (canvas.height * imgWidth) / canvas.width; // 원본 비율 그대로일 때의 세로 길이

    if (imgHeight <= pageHeight) {
      // 한 페이지 안에 자연스럽게 들어가는 경우: 위쪽 정렬, 가로는 항상 풀폭
      pdf.addImage(imgData, 'PNG', 0, 0, imgWidth, imgHeight);
    } else {
      // 내용이 길어서 넘치는 경우: 가로는 절대 줄이지 않고,
      // 세로만 페이지 높이(297mm)에 맞춰 강제로 눌러서 채움 (좌우 여백 발생 원인 제거)
      pdf.addImage(imgData, 'PNG', 0, 0, imgWidth, pageHeight);
    }

    window.open(pdf.output('bloburl'), '_blank');
  } catch (e) {
    console.error(e);
    alert('PDF 생성 중 오류가 발생했습니다.');
  } finally {
    setPdfLoading(false);
  }
};


  const handleSaveQuote = async () => {
    const effectiveTeam = isAdmin ? createTeam : userInfo.team;
    if (isAdmin && !effectiveTeam) { alert('담당 팀을 선택해주세요.'); return; }
    if (!selectedSite) { alert('현장을 선택해주세요.'); return; }
    if (!title.trim()) { alert('제목을 입력해주세요.'); return; }
    setSaving(true);
    try {
      const siteName = selectedSite.site_name || selectedSite.name || '';
      const finalTitle = siteName ? `[${siteName}] ${title.trim()}` : title.trim();
      const itemsPayload = {
        materials,
        labor: { type: laborType, qty: laborQty, unit_price: laborUnitPrice, amount: calc.laborDirect },
        labor_direct: calc.laborDirect,
        rates,
        includeIndirectLabor,
        includeOverhead,
        includeProfit,
        client_name: `${siteName} 귀중`,
        site_name: siteName,
        site_address: selectedSite.address || '',
        site_phone: selectedSite.phone || '',
        site_manager: selectedSite.manager_name || '',
        title: title.trim(),
        remarks,
        breakdown: calc,
      };

      if (editingQuoteId) {
        const { error } = await supabase.from('quotes').update({
          site_id: selectedSite.id,
          team_id: effectiveTeam,
          title: finalTitle,
          amount: calc.total,
          items: itemsPayload,
          status: '승인대기',
          approved_by: null,
          approved_at: null,
          rejected_reason: null,
          updated_at: new Date().toISOString(),
        }).eq('id', editingQuoteId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('quotes').insert({
          site_id: selectedSite.id,
          title: finalTitle,
          amount: calc.total,
          status: '승인대기',
          team_id: effectiveTeam,
          created_by: userInfo.uid,
          items: itemsPayload,
          created_at: new Date().toISOString(),
        });
        if (error) throw error;
      }

      setShowCreate(false);
      resetCreateForm();
      loadQuotes();
    } catch (e: any) {
      alert('저장 실패: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleApprove = async (q: any) => {
    const { error } = await supabase.from('quotes').update({
      status: '승인',
      approved_by: userInfo.name,
      approved_at: new Date().toISOString(),
      rejected_reason: null,
    }).eq('id', q.id);
    if (error) { alert(error.message); return; }
    setSelectedQuote(null);
    loadQuotes();
  };

  const handleReject = async (q: any) => {
    if (!rejectReasonInput.trim()) { alert('반려 사유를 입력해주세요.'); return; }
    const { error } = await supabase.from('quotes').update({
      status: '반려',
      approved_by: userInfo.name,
      approved_at: new Date().toISOString(),
      rejected_reason: rejectReasonInput.trim(),
    }).eq('id', q.id);
    if (error) { alert(error.message); return; }
    setSelectedQuote(null);
    setShowRejectInput(false);
    setRejectReasonInput('');
    loadQuotes();
  };

  const toggleInvoice = async (q: any) => {
    const next = !q.invoice_issued;
    const { error } = await supabase.from('quotes').update({
      invoice_issued: next,
      invoice_issued_at: next ? new Date().toISOString() : null,
    }).eq('id', q.id);
    if (error) { alert(error.message); return; }
    setSelectedQuote((prev: any) => prev ? { ...prev, invoice_issued: next, invoice_issued_at: next ? new Date().toISOString() : null } : prev);
    loadQuotes();
  };

  const togglePayment = async (q: any) => {
    const next = !q.payment_confirmed;
    const { error } = await supabase.from('quotes').update({
      payment_confirmed: next,
      payment_confirmed_at: next ? new Date().toISOString() : null,
    }).eq('id', q.id);
    if (error) { alert(error.message); return; }
    setSelectedQuote((prev: any) => prev ? { ...prev, payment_confirmed: next, payment_confirmed_at: next ? new Date().toISOString() : null } : prev);
    loadQuotes();
  };

  const handleDeleteQuote = async (q: any, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(`"${q.title}" 견적서를 삭제하시겠습니까?\n삭제 후에는 복구할 수 없습니다.`)) return;
    const { error } = await supabase.from('quotes').delete().eq('id', q.id);
    if (error) { alert('삭제 실패: ' + error.message); return; }
    loadQuotes();
  };

  const uploadCompanyImage = async (file: File, kind: 'logo' | 'stamp') => {
    const setUploading = kind === 'logo' ? setLogoUploading : setStampUploading;
    setUploading(true);
    try {
      const ext = file.name.split('.').pop();
      const path = `${userInfo.company_id}/${kind}-${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage.from('company-assets').upload(path, file, { upsert: true });
      if (uploadError) throw uploadError;
      const { data: urlData } = supabase.storage.from('company-assets').getPublicUrl(path);
      setCompanyForm((prev: any) => ({ ...prev, [kind === 'logo' ? 'logo_image_url' : 'stamp_image_url']: urlData.publicUrl }));
    } catch (e: any) {
      alert('업로드 실패: ' + e.message);
    } finally {
      setUploading(false);
    }
  };

  const saveCompanyInfo = async () => {
    setCompanySaving(true);
    try {
      const { error } = await supabase.from('companies').update({
        company_name: companyForm.company_name,
        ceo_name: companyForm.ceo_name,
        biz_no: companyForm.biz_no,
        license_no: companyForm.license_no,
        address: companyForm.address,
        phone: companyForm.phone,
        fax: companyForm.fax,
        logo_image_url: companyForm.logo_image_url,
        stamp_image_url: companyForm.stamp_image_url,
        labor_indirect_rate: Number(companyForm.labor_indirect_rate) || 0.15,
        overhead_rate: Number(companyForm.overhead_rate) || 0.12,
        profit_rate: Number(companyForm.profit_rate) || 0.10,
        vat_rate: Number(companyForm.vat_rate) || 0.10,
        updated_at: new Date().toISOString(),
      }).eq('id', userInfo.company_id);
      if (error) throw error;
      setCompany(companyForm);
      alert('저장되었습니다.');
    } catch (e: any) {
      alert('저장 실패: ' + e.message);
    } finally {
      setCompanySaving(false);
    }
  };

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: '#8A6E4B', fontFamily: 'serif' }}>불러오는 중...</div>;

  const won = (n: number) => Math.round(n || 0).toLocaleString('ko-KR');
  const canEdit = (q: any) => isAdmin || q.created_by === userInfo.uid;
  const fmtDate = (iso: string) => {
    if (!iso) return '';
    const d = new Date(iso);
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
  };

  const inclIndirect = selectedQuote?.items?.includeIndirectLabor !== false;
  const inclOverhead = selectedQuote?.items?.includeOverhead !== false;
  const inclProfit = selectedQuote?.items?.includeProfit !== false;

  return (
    <div className="theme-e">
      <div className="page-frame">

        {/* ===== 브랜드 헤더 ===== */}
        <div className="brand-header">
          <ElevatorLogo size={40} />
          <div>
            <div className="brand-title">{company?.company_name || '견 적 서 관 리'}</div>
            <div className="brand-sub">Estimate Management System</div>
          </div>
          <div className="brand-meta">
            <strong>{userInfo?.name}</strong>
            {isAdmin ? '관리자' : userInfo?.team}
          </div>
        </div>

        {/* ===== 탭 바 ===== */}
        <div className="tab-bar">
          <button className={`tab-btn ${tab === 'list' ? 'active' : ''}`} onClick={() => setTab('list')}>
            견적서 목록
          </button>
          {isAdmin && (
            <button className={`tab-btn ${tab === 'company' ? 'active' : ''}`} onClick={() => setTab('company')}>
              회사정보 설정
            </button>
          )}
          <button className="tab-btn" style={{ marginLeft: 'auto' }} onClick={() => router.push('/work')}>
            ← 작업화면
          </button>
        </div>

        {/* ===== 목록 뷰 ===== */}
        {tab === 'list' && (
          <div className="panel">
            <div className="panel-title">
              견적서 목록 <span className="num">№ LIST</span>
              <span className="en">Estimate Archive</span>
            </div>

            <div className="filter-bar">
              {isAdmin && (
                <select value={filterTeam} onChange={e => setFilterTeam(e.target.value)}>
                  <option value="all">전체 팀</option>
                  {teams.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
                </select>
              )}
              <input type="month" value={filterMonth} onChange={e => setFilterMonth(e.target.value)} />
              <button className="btn-primary accent" style={{ marginLeft: 'auto' }}
                onClick={() => { resetCreateForm(); setShowCreate(true); }}>
                + 새 견적서
              </button>
            </div>

            <table className="quote-table">
              <thead>
                <tr>
                  <th style={{ width: 70 }}>No.</th>
                  <th>공사명 · 현장</th>
                  <th className="center" style={{ width: 100 }}>팀</th>
                  <th className="num" style={{ width: 130 }}>금액</th>
                  <th className="center" style={{ width: 110 }}>일자</th>
                  <th className="center" style={{ width: 100 }}>상태</th>
                  <th style={{ width: 40 }}></th>
                </tr>
              </thead>
              <tbody>
                {quotes.length === 0 ? (
                  <tr><td colSpan={7} style={{ textAlign: 'center', padding: 48, color: 'var(--text-dim)', fontFamily: 'var(--sans)' }}>등록된 견적서가 없습니다.</td></tr>
                ) : quotes.map((q, idx) => (
                  <tr key={q.id} onClick={() => setSelectedQuote(q)}>
                    <td><span className="qt-num">№ {String(quotes.length - idx).padStart(3, '0')}</span></td>
                    <td>
                      <div className="qt-title">
                        {q.title}
                        {q.invoice_issued && <span className="mini-tag">계산서</span>}
                        {q.payment_confirmed && <span className="mini-tag">결제완료</span>}
                      </div>
                    </td>
                    <td className="qt-team" style={{ textAlign: 'center' }}>{q.team_id}</td>
                    <td className="qt-amount">{won(q.amount)}</td>
                    <td className="qt-date">{fmtDate(q.created_at)}</td>
                    <td style={{ textAlign: 'center' }}>
                      <span className={`status-badge ${q.status === '승인' ? 'status-ok' : q.status === '반려' ? 'status-rej' : 'status-pend'}`}>
                        {q.status}
                      </span>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      {canEdit(q) && (
                        <button onClick={(e) => handleDeleteQuote(q, e)}
                          style={{ color: 'var(--text-dim)', fontSize: 16, cursor: 'pointer' }} title="삭제">✕</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ===== 회사정보 뷰 ===== */}
        {tab === 'company' && isAdmin && (
          <div className="panel" style={{ maxWidth: 780 }}>
            <div className="panel-title">
              회사 정보 설정 <span className="en">Company Profile</span>
            </div>
            <div className="form-section">
              <p style={{ fontFamily: 'var(--sans)', fontSize: 12, color: 'var(--text-dim)', marginBottom: 24 }}>
                견적서에 표시될 회사 정보를 등록해주세요.
              </p>

              <div className="form-grid-2">
                {[
                  { key: 'company_name', label: '회사명' },
                  { key: 'ceo_name', label: '대표자명' },
                  { key: 'biz_no', label: '사업자등록번호' },
                  { key: 'license_no', label: '보수업 등록번호' },
                  { key: 'address', label: '주소' },
                  { key: 'phone', label: '전화번호' },
                  { key: 'fax', label: '팩스번호' },
                ].map(f => (
                  <div className="form-item" key={f.key}>
                    <label className="form-label">{f.label}</label>
                    <input className="form-input" value={companyForm[f.key] || ''}
                      onChange={e => setCompanyForm({ ...companyForm, [f.key]: e.target.value })} />
                  </div>
                ))}
              </div>

              <div className="form-grid-3" style={{ margin: '24px 0' }}>
                {[
                  { key: 'labor_indirect_rate', label: '간접노무비 비율' },
                  { key: 'overhead_rate', label: '경비/일반관리비 비율' },
                  { key: 'profit_rate', label: '기업이윤 비율' },
                  { key: 'vat_rate', label: '부가세 비율' },
                ].map(f => (
                  <div className="form-item" key={f.key}>
                    <label className="form-label">{f.label}</label>
                    <input className="form-input" type="number" step="0.01"
                      value={companyForm[f.key] ?? ''}
                      onChange={e => setCompanyForm({ ...companyForm, [f.key]: e.target.value })} />
                  </div>
                ))}
              </div>

              <div className="form-grid-2">
                <div className="asset-slot">
                  <div className="slot-preview">
                    {companyForm.logo_image_url ? <img src={companyForm.logo_image_url} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} /> : <ElevatorLogo size={32} />}
                  </div>
                  <label className="form-label" style={{ marginBottom: 10 }}>로고 이미지</label>
                  <input type="file" accept="image/*" style={{ fontSize: 11 }}
                    onChange={e => e.target.files?.[0] && uploadCompanyImage(e.target.files[0], 'logo')} />
                  {logoUploading && <p style={{ fontSize: 10, color: 'var(--champagne)', marginTop: 6 }}>업로드 중...</p>}
                </div>
                <div className="asset-slot">
                  <div className="slot-preview">
                    {companyForm.stamp_image_url ? <img src={companyForm.stamp_image_url} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} /> : <span style={{ fontFamily: 'var(--serif)', fontStyle: 'italic', color: 'var(--champagne)', fontSize: 11 }}>직인 없음</span>}
                  </div>
                  <label className="form-label" style={{ marginBottom: 10 }}>직인 이미지</label>
                  <input type="file" accept="image/*" style={{ fontSize: 11 }}
                    onChange={e => e.target.files?.[0] && uploadCompanyImage(e.target.files[0], 'stamp')} />
                  {stampUploading && <p style={{ fontSize: 10, color: 'var(--champagne)', marginTop: 6 }}>업로드 중...</p>}
                </div>
              </div>

              <button className="btn-primary" style={{ width: '100%', marginTop: 28, padding: '14px' }}
                onClick={saveCompanyInfo} disabled={companySaving}>
                {companySaving ? '저장 중...' : '저장하기'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ===== 새 견적서 작성 모달 ===== */}
      {showCreate && (
        <div className="modal-overlay">
          <div className="modal-box">
            <button className="modal-close" onClick={() => { setShowCreate(false); resetCreateForm(); }}>✕</button>
            <div className="panel-title" style={{ paddingRight: 60 }}>
              {editingQuoteId ? '견적서 수정' : '새 견적서 작성'}
              <span className="en">{editingQuoteId ? 'Edit' : 'New Estimate'}</span>
            </div>

            <div className="form-section">
              {isAdmin && (
                <div className="form-item">
                  <label className="form-label">담당 팀 <span className="req">*</span></label>
                  <select className="form-select" value={createTeam}
                    onChange={e => { setCreateTeam(e.target.value); if (!editingQuoteId) setSelectedSite(null); }}>
                    <option value="">팀을 선택하세요</option>
                    {teams.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
                  </select>
                </div>
              )}

              {isAdmin && !createTeam ? (
                <div style={{ padding: '40px 10px', textAlign: 'center', color: 'var(--text-dim)', fontFamily: 'var(--sans)', fontSize: 13 }}>
                  담당 팀을 먼저 선택해주세요.
                </div>
              ) : !selectedSite ? (
                <div>
                  <input className="form-input" value={siteSearch} onChange={e => setSiteSearch(e.target.value)}
                    placeholder="현장명, 주소로 검색" style={{ marginBottom: 16 }} />
                  <div style={{ maxHeight: 260, overflowY: 'auto' }}>
                    {siteResults.map(s => (
                      <div key={s.id} className="site-search-result" onClick={() => setSelectedSite(s)}>
                        <div className="name">{s.site_name || s.name}</div>
                        <div className="addr">{s.address}</div>
                      </div>
                    ))}
                    {siteSearch && siteResults.length === 0 && (
                      <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-dim)', fontSize: 12, fontFamily: 'var(--sans)' }}>검색 결과가 없습니다</div>
                    )}
                  </div>
                </div>
              ) : (
                <>
                  <div className="selected-site-box">
                    <div>
                      <div className="name">{selectedSite.site_name || selectedSite.name}</div>
                      <div className="addr">{selectedSite.address}</div>
                    </div>
                    {!editingQuoteId && (
                      <button style={{ fontSize: 11, color: 'var(--champagne)', fontFamily: 'var(--sans)', fontWeight: 600, letterSpacing: 2, textTransform: 'uppercase' }}
                        onClick={() => setSelectedSite(null)}>변경</button>
                    )}
                  </div>

                  <div className="form-item">
                    <label className="form-label">제목 <span className="req">*</span></label>
                    <input className="form-input" value={title} onChange={e => setTitle(e.target.value)}
                      placeholder="예: 승강기 노후 부품 교체공사" />
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', margin: '28px 0 12px' }}>
                    <span className="section-label"><i>i.</i><b>자재비</b></span>
                    <button className="btn-secondary" onClick={addMaterialRow}>+ 품목추가</button>
                  </div>

                  <table className="edit-table">
                    <thead>
                      <tr>
                        <th style={{ textAlign: 'left' }}>품명</th><th>단위</th><th>수량</th><th>단가</th><th>금액</th><th>비고</th><th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {materials.map((m, i) => (
                        <tr key={i}>
                          <td><input value={m.name} onChange={e => updateMaterial(i, 'name', e.target.value)} /></td>
                          <td>
                            <select value={m.unit} onChange={e => updateMaterial(i, 'unit', e.target.value)}>
                              <option value="">선택</option>
                              <option value="EA">EA</option>
                              <option value="SET">SET</option>
                              <option value="M">M</option>
                            </select>
                          </td>
                          <td><input type="number" value={m.qty === 0 ? '' : m.qty} onFocus={e => e.target.select()}
                            onChange={e => updateMaterial(i, 'qty', e.target.value === '' ? 0 : Number(e.target.value))} /></td>
                          <td><input type="number" value={m.unit_price === 0 ? '' : m.unit_price} onFocus={e => e.target.select()}
                            onChange={e => updateMaterial(i, 'unit_price', e.target.value === '' ? 0 : Number(e.target.value))} /></td>
                          <td className="amount">{won(m.qty * m.unit_price)}</td>
                          <td><input value={m.note} onChange={e => updateMaterial(i, 'note', e.target.value)} placeholder="비고" /></td>
                          <td><button className="del-btn" onClick={() => removeMaterialRow(i)}>✕</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div style={{ textAlign: 'right', fontFamily: 'var(--sans)', fontSize: 12, color: 'var(--text-dim)', margin: '10px 0 28px' }}>
                    자재비 소계: <strong style={{ fontFamily: 'var(--serif)', color: 'var(--ink)' }}>{won(calc.materialsSubtotal)}원</strong>
                  </div>

                  <div className="section-label" style={{ marginBottom: 12 }}><i>ii.</i><b>직접인건비</b></div>
                  <table className="edit-table" style={{ marginBottom: 28 }}>
                    <thead><tr><th>구분</th><th>수량</th><th>단가</th><th>금액</th></tr></thead>
                    <tbody>
                      <tr>
                        <td>
                          <select value={laborType} onChange={e => setLaborType(e.target.value as LaborType)}>
                            <option value="공">공</option><option value="식">식</option>
                          </select>
                        </td>
                        <td><input type="number" value={laborQty === 0 ? '' : laborQty} onFocus={e => e.target.select()}
                          onChange={e => setLaborQty(e.target.value === '' ? 0 : Number(e.target.value))} /></td>
                        <td><input type="number" value={laborUnitPrice === 0 ? '' : laborUnitPrice} onFocus={e => e.target.select()}
                          onChange={e => setLaborUnitPrice(e.target.value === '' ? 0 : Number(e.target.value))} /></td>
                        <td className="amount">{won(calc.laborDirect)}</td>
                      </tr>
                    </tbody>
                  </table>

                  <div className="form-item">
                    <label className="form-label">특기사항</label>
                    <textarea className="form-textarea" rows={2} value={remarks} onChange={e => setRemarks(e.target.value)} />
                  </div>

                  <div className="calc-summary" style={{ marginTop: 28 }}>
                    <div className="calc-row"><span>자재비 소계</span><span className="val">{won(calc.materialsSubtotal)}</span></div>
                    <div className="calc-row"><span>직접인건비</span><span className="val">{won(calc.laborDirect)}</span></div>
                    <div className="calc-row">
                      <label><input type="checkbox" checked={includeIndirectLabor} onChange={e => setIncludeIndirectLabor(e.target.checked)} />
                        간접인건비 ({(rates.labor_indirect * 100).toFixed(0)}%)</label>
                      <span className="val">{won(calc.laborIndirect)}</span>
                    </div>
                    <div className="calc-row subtotal"><span>인건비 소계</span><span className="val">{won(calc.laborSubtotal)}</span></div>
                    <div className="calc-row">
                      <label><input type="checkbox" checked={includeOverhead} onChange={e => setIncludeOverhead(e.target.checked)} />
                        경비 및 일반관리비 ({(rates.overhead * 100).toFixed(0)}%)</label>
                      <span className="val">{won(calc.overhead)}</span>
                    </div>
                    <div className="calc-row">
                      <label><input type="checkbox" checked={includeProfit} onChange={e => setIncludeProfit(e.target.checked)} />
                        기업이윤 ({(rates.profit * 100).toFixed(0)}%)</label>
                      <span className="val">{won(calc.profit)}</span>
                    </div>
                    <div className="calc-row subtotal"><span>공급가액</span><span className="val">{won(calc.supplyAmount)}</span></div>
                    <div className="calc-row subtotal"><span>부가세 ({(rates.vat * 100).toFixed(0)}%)</span><span className="val">{won(calc.vat)}</span></div>
                    <div className="calc-row total"><span>합계금액</span><span className="val">{won(calc.total)}</span></div>
                  </div>
                  <p style={{ fontFamily: 'var(--sans)', fontSize: 10.5, color: 'var(--text-dim)', marginTop: 10 }}>
                    ※ 체크 해제 시 해당 항목이 견적서에서 완전히 제외되고 합계금액에서도 차감됩니다.
                  </p>

                  <button className="btn-primary" style={{ width: '100%', marginTop: 24, padding: '16px' }}
                    onClick={handleSaveQuote} disabled={saving}>
                    {saving ? '저장 중...' : editingQuoteId ? '수정 저장 (재승인 요청)' : '견적서 저장 (승인요청)'}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ===== 상세 / 인쇄 모달 ===== */}
      {selectedQuote && (
        <div className="modal-overlay">
          <div className="modal-box" style={{ maxWidth: 900 }}>
            <button className="modal-close" onClick={() => { setSelectedQuote(null); setShowRejectInput(false); }}>✕</button>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '24px 40px 0' }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <span className={`status-badge ${selectedQuote.status === '승인' ? 'status-ok' : selectedQuote.status === '반려' ? 'status-rej' : 'status-pend'}`}>
                  {selectedQuote.status}
                </span>
                {selectedQuote.status !== '승인대기' && (
                  <span style={{ fontFamily: 'var(--sans)', fontSize: 11, color: 'var(--text-dim)' }}>
                    {selectedQuote.approved_by} · {(selectedQuote.approved_at || '').slice(0, 16).replace('T', ' ')}
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {selectedQuote.status === '승인' && (
                  <button className="btn-secondary" onClick={handlePrint} disabled={pdfLoading}>
                    {pdfLoading ? 'PDF 생성 중...' : '🖨 인쇄'}
                  </button>
                )}
                {canEdit(selectedQuote) && (
                  <button className="btn-secondary" onClick={() => openEdit(selectedQuote)}>✏ 수정</button>
                )}
              </div>
            </div>

            {selectedQuote.status === '반려' && selectedQuote.rejected_reason && (
              <div style={{ margin: '16px 40px 0', background: 'var(--rej-bg)', color: 'var(--rej)', fontFamily: 'var(--sans)', fontSize: 12, padding: 14, border: '1px solid var(--rej)' }}>
                반려 사유: {selectedQuote.rejected_reason}
              </div>
            )}

            {/* ══ 견적서 문서 (E안) ══ */}
            <div
              className="quote-doc"
              style={{ margin: '24px auto', boxShadow: 'none', border: 'none' }}
              id="quote-document"
              ref={printDocRef}
            >
              <div className="doc-hero">
                <div className="doc-monogram">— H · E —</div>
                <div className="doc-title">견 적 서</div>
                <div className="doc-title-en">Estimate · Quotation</div>
              </div>

              <div className="doc-header-grid">
                <div className="doc-client-block">
                  <div className="lbl">To · 수신처</div>
                  <div className="val">{(selectedQuote.items?.client_name) || `${selectedQuote.items?.site_name || ''} 귀중`}</div>
                  <div className="sub">
                    {selectedQuote.items?.site_address}<br />
                    {selectedQuote.items?.site_manager && `담당: ${selectedQuote.items.site_manager}`}
                  </div>
                </div>
                <div className="doc-supplier">
                  <div className="lbl">From · 발행처</div>
                  <div className="sup-name">
                    {company?.logo_image_url && <img src={company.logo_image_url} alt="" style={{ height: 30, objectFit: 'contain' }} />}
                    {company?.company_name}
                  </div>
                  <div className="sup-lines">
                    발행일 : <span className="val">{fmtDate(selectedQuote.created_at)}</span><br />
                    사업자등록번호 : <span className="val">{company?.biz_no}</span><br />
                    보수업등록번호 : <span className="val">{company?.license_no}</span><br />
                    {company?.address}<br />
                    ☎ {company?.phone}{company?.fax ? `  Fax ${company.fax}` : ''}
                  </div>
                  <div className="sup-ceo">
                    대 표 : {company?.ceo_name}
                    {company?.stamp_image_url && (
                      <img className="stamp" src={company.stamp_image_url} alt="직인" style={{ width: 46, height: 46, objectFit: 'contain' }} />
                    )}
                  </div>
                </div>
              </div>

              <div className="doc-amount-box">
                <div className="doc-amount-label">Total Amount</div>
                <div className="doc-amount-value"><span className="accent">₩</span>{won(selectedQuote.amount)}<span style={{ fontFamily: 'var(--serif)', fontStyle: 'italic', color: 'var(--champagne)', fontSize: 15, marginLeft: 6 }}>원</span></div>
              </div>
              <div className="doc-note">※ 상기 금액은 부가세 포함 합계금액임</div>

              <div className="doc-project-title">
                <span className="lbl">Project · 공사명</span>
                {selectedQuote.items?.title || selectedQuote.title}
              </div>

              <table className="doc-table">
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left' }}>품명</th><th style={{ width: 50 }}>단위</th><th style={{ width: 55 }}>수량</th>
                    <th style={{ width: 80 }}>단가</th><th style={{ width: 90 }}>금액</th><th style={{ width: 100, textAlign: 'left' }}>비고</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="section-row"><td colSpan={6}><span className="num">i.</span>자재비</td></tr>
                  {(selectedQuote.items?.materials || []).map((m: any, i: number) => (
                    <tr key={i}>
                      <td>{m.name}</td>
                      <td className="center">{m.unit}</td>
                      <td className="right">{m.qty}</td>
                      <td className="right">{won(m.unit_price)}</td>
                      <td className="right">{won(m.qty * m.unit_price)}</td>
                      <td>{m.note}</td>
                    </tr>
                  ))}
                  <tr className="subtotal-row">
                    <td colSpan={4} className="right" style={{ fontFamily: 'var(--serif)' }}>소 계</td>
                    <td className="right">{won(selectedQuote.items?.breakdown?.materialsSubtotal)}</td>
                    <td></td>
                  </tr>

                  <tr className="section-row"><td colSpan={6}><span className="num">ii.</span>인건비</td></tr>
                  <tr>
                    <td>직접인건비</td>
                    <td className="center">{selectedQuote.items?.labor?.type}</td>
                    <td className="right">{selectedQuote.items?.labor?.qty}</td>
                    <td className="right">{won(selectedQuote.items?.labor?.unit_price)}</td>
                    <td className="right">{won(selectedQuote.items?.breakdown?.laborDirect)}</td>
                    <td></td>
                  </tr>
                  {inclIndirect && (
                    <tr>
                      <td colSpan={4}>간접인건비 (직접인건비 × {(((selectedQuote.items?.rates?.labor_indirect) ?? rates.labor_indirect) * 100).toFixed(0)}%)</td>
                      <td className="right">{won(selectedQuote.items?.breakdown?.laborIndirect)}</td>
                      <td></td>
                    </tr>
                  )}
                  <tr className="subtotal-row">
                    <td colSpan={4} className="right" style={{ fontFamily: 'var(--serif)' }}>소 계</td>
                    <td className="right">{won(selectedQuote.items?.breakdown?.laborSubtotal)}</td>
                    <td></td>
                  </tr>

                  {inclOverhead && (
                    <tr>
                      <td colSpan={4}>iii. 경비 및 일반관리비 ((1+2항) × {(((selectedQuote.items?.rates?.overhead) ?? rates.overhead) * 100).toFixed(0)}%)</td>
                      <td className="right" style={{ fontFamily: 'var(--serif)', fontWeight: 500 }}>{won(selectedQuote.items?.breakdown?.overhead)}</td>
                      <td></td>
                    </tr>
                  )}
                  {inclProfit && (
                    <tr>
                      <td colSpan={4}>iv. 기업이윤 ((1+3항) × {(((selectedQuote.items?.rates?.profit) ?? rates.profit) * 100).toFixed(0)}%)</td>
                      <td className="right" style={{ fontFamily: 'var(--serif)', fontWeight: 500 }}>{won(selectedQuote.items?.breakdown?.profit)}</td>
                      <td></td>
                    </tr>
                  )}
                  <tr className="subtotal-row">
                    <td colSpan={4} className="right" style={{ fontFamily: 'var(--serif)' }}>금 액</td>
                    <td className="right">{won(selectedQuote.items?.breakdown?.supplyAmount)}</td>
                    <td></td>
                  </tr>
                  <tr className="subtotal-row">
                    <td colSpan={4} className="right" style={{ fontFamily: 'var(--serif)' }}>부 가 세 ({(((selectedQuote.items?.rates?.vat) ?? rates.vat) * 100).toFixed(0)}%)</td>
                    <td className="right">{won(selectedQuote.items?.breakdown?.vat)}</td>
                    <td></td>
                  </tr>
                  <tr className="total-row">
                    <td colSpan={4} className="right">합 계 금 액</td>
                    <td className="right">{won(selectedQuote.amount)}</td>
                    <td style={{ fontFamily: 'var(--sans)', fontSize: 9, textTransform: 'uppercase', letterSpacing: 1 }}>백단위절사</td>
                  </tr>
                </tbody>
              </table>

              {selectedQuote.items?.remarks && (
                <div className="doc-remarks">
                  <div className="rmk-title">Remarks · 특기사항</div>
                  <div>{selectedQuote.items.remarks}</div>
                </div>
              )}

              <div className="doc-footer">
                {company?.company_name}<span className="divider">❦</span>THANK YOU FOR YOUR BUSINESS
              </div>
            </div>
            {/* ══ 문서 끝 ══ */}

            {isAdmin && selectedQuote.status === '승인대기' && !showRejectInput && (
              <div className="action-panel">
                <button className="btn-primary accent" style={{ background: 'var(--ok)', borderColor: 'var(--ok)' }} onClick={() => handleApprove(selectedQuote)}>승인</button>
                <button className="btn-primary" style={{ background: 'var(--rej)', borderColor: 'var(--rej)' }} onClick={() => setShowRejectInput(true)}>반려</button>
              </div>
            )}

            {isAdmin && showRejectInput && (
              <div style={{ padding: '0 40px 24px' }}>
                <textarea className="form-textarea" rows={2} value={rejectReasonInput}
                  onChange={e => setRejectReasonInput(e.target.value)} placeholder="반려 사유를 입력하세요"
                  style={{ marginBottom: 10 }} />
                <button className="btn-primary" style={{ width: '100%', background: 'var(--rej)', borderColor: 'var(--rej)' }}
                  onClick={() => handleReject(selectedQuote)}>반려 처리</button>
              </div>
            )}

            {isAdmin && selectedQuote.status === '승인' && (
              <div className="action-panel">
                <button className="btn-secondary" onClick={() => toggleInvoice(selectedQuote)}>
                  {selectedQuote.invoice_issued ? '계산서 발급 취소' : '계산서 발급'}
                </button>
                <button className="btn-secondary" onClick={() => togglePayment(selectedQuote)}>
                  {selectedQuote.payment_confirmed ? '결제 확인 취소' : '결제 확인'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      <style>{`
        input[type=number]::-webkit-outer-spin-button,
        input[type=number]::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
        input[type=number] { -moz-appearance: textfield; }
      `}</style>
    </div>
  );
}
