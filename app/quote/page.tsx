'use client';

import { useEffect, useState, useMemo } from 'react';
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
  const [createTeam, setCreateTeam] = useState(''); // 운영자가 견적서 작성 시 선택하는 담당 팀
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

  // ── 레고 기능: 간접인건비 / 경비및일반관리비 / 기업이윤 포함 여부 (기본값 전체 체크) ──
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

  // 일반 팀원은 담당 팀이 자기 팀으로 고정
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

  // ── 계산 로직: 천단위 절사는 최종 합계금액(total)에만 적용, 중간 항목은 절사 없이 그대로 계산 ──
  // ── 체크 해제 시 해당 항목은 0으로 처리되어 뒤이은 계산의 기준액도 자동으로 줄어듦 (레고 방식) ──
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
    setIncludeIndirectLabor(true); setIncludeOverhead(true); setIncludeProfit(true); // 새 견적서는 항상 전체 체크
    setRemarks('');
    setEditingQuoteId(null);
    setCreateTeam(isAdmin ? '' : (userInfo?.team || ''));
  };

  // ── 견적서 수정 모드 진입 ──
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
    setTitle(q.title || '');
    setMaterials(items.materials && items.materials.length ? items.materials : [{ name: '', unit: '', qty: 1, unit_price: 0, note: '' }]);
    setLaborType(items.labor?.type || '공');
    setLaborQty(items.labor?.qty ?? 1);
    setLaborUnitPrice(items.labor?.unit_price ?? 0);
    // 기존 견적서(체크 필드 없음)는 기본값 true로 처리, 저장된 값이 있으면 그대로 반영
    setIncludeIndirectLabor(items.includeIndirectLabor !== false);
    setIncludeOverhead(items.includeOverhead !== false);
    setIncludeProfit(items.includeProfit !== false);
    setRemarks(items.remarks || '');
    setSelectedQuote(null);
    setShowCreate(true);
  };

  const handleSaveQuote = async () => {
    const effectiveTeam = isAdmin ? createTeam : userInfo.team;
    if (isAdmin && !effectiveTeam) { alert('담당 팀을 선택해주세요.'); return; }
    if (!selectedSite) { alert('현장을 선택해주세요.'); return; }
    if (!title.trim()) { alert('제목을 입력해주세요.'); return; }
    setSaving(true);
    try {
      const siteName = selectedSite.site_name || selectedSite.name || '';
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
        // 수정 저장: 재검토를 위해 승인대기로 초기화 (팀도 변경 가능)
        const { error } = await supabase.from('quotes').update({
          site_id: selectedSite.id,
          team_id: effectiveTeam,
          title: title.trim(),
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
          title: title.trim(),
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

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>불러오는 중...</div>;

  const won = (n: number) => Math.round(n || 0).toLocaleString('ko-KR');
  // ── 승인 여부와 관계없이 운영자 또는 작성자 본인이면 수정 가능 ──
  const canEdit = (q: any) => isAdmin || q.created_by === userInfo.uid;
  const fmtDate = (iso: string) => {
    if (!iso) return '';
    const d = new Date(iso);
    return `${d.getFullYear()}. ${String(d.getMonth() + 1).padStart(2, '0')}. ${String(d.getDate()).padStart(2, '0')}`;
  };

  // 상세보기(견적서 문서)에서 각 항목 표시 여부 (기존 견적서는 필드 없으므로 기본 true)
  const inclIndirect = selectedQuote?.items?.includeIndirectLabor !== false;
  const inclOverhead = selectedQuote?.items?.includeOverhead !== false;
  const inclProfit = selectedQuote?.items?.includeProfit !== false;

  return (
    <div style={{ minHeight: '100vh', background: '#f1f5f9', paddingBottom: 40 }}>
      <header className="no-print" style={{ background: '#0f172a', padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={() => router.push('/work')} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 13 }}>← 작업화면</button>
        <span style={{ color: '#f8fafc', fontWeight: 800, fontSize: 16 }}>견적서 관리</span>
      </header>

      <div className="no-print" style={{ maxWidth: 1000, margin: '0 auto', padding: 16 }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <button onClick={() => setTab('list')}
            style={{ padding: '8px 16px', borderRadius: 8, border: 'none', fontWeight: 700, fontSize: 13,
              background: tab === 'list' ? '#3b82f6' : '#fff', color: tab === 'list' ? '#fff' : '#64748b' }}>
            견적서 목록
          </button>
          {isAdmin && (
            <button onClick={() => setTab('company')}
              style={{ padding: '8px 16px', borderRadius: 8, border: 'none', fontWeight: 700, fontSize: 13,
                background: tab === 'company' ? '#3b82f6' : '#fff', color: tab === 'company' ? '#fff' : '#64748b' }}>
              회사정보 설정
            </button>
          )}
        </div>

        {tab === 'list' && (
          <>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
              {isAdmin && (
                <select value={filterTeam} onChange={e => setFilterTeam(e.target.value)}
                  style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 13 }}>
                  <option value="all">전체 팀</option>
                  {teams.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
                </select>
              )}
              <input type="month" value={filterMonth} onChange={e => setFilterMonth(e.target.value)}
                style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 13 }} />
              <button onClick={() => { resetCreateForm(); setShowCreate(true); }}
                style={{ marginLeft: 'auto', background: '#3b82f6', color: '#fff', border: 'none',
                  padding: '9px 16px', borderRadius: 8, fontWeight: 700, fontSize: 13 }}>
                + 새 견적서
              </button>
            </div>

            <div style={{ background: '#fff', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,.05)' }}>
              {quotes.length === 0 ? (
  <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>등록된 견적서가 없습니다.</div>
) : quotes.map(q => (
  <div key={q.id} onClick={() => setSelectedQuote(q)}
    style={{ padding: 14, borderBottom: '1px solid #f1f5f9', cursor: 'pointer', display: 'flex',
      justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
    <div>
      <div style={{ fontWeight: 700, fontSize: 14, color: '#1e293b' }}>
        {q.items?.site_name ? `[${q.items.site_name}] ${q.title}` : q.title}
      </div>
      <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 3 }}>
        {q.team_id} · {won(q.amount)}원 · {(q.created_at || '').slice(0, 10)}
      </div>
    </div>
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <span style={{
        fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 10,
        background: q.status === '승인' ? '#dcfce7' : q.status === '반려' ? '#fee2e2' : '#fef9c3',
        color: q.status === '승인' ? '#15803d' : q.status === '반려' ? '#b91c1c' : '#a16207',
      }}>{q.status}</span>
      {q.invoice_issued && <span style={{ fontSize: 11, background: '#eff6ff', color: '#2563eb', padding: '3px 8px', borderRadius: 10 }}>계산서 발급</span>}
      {q.payment_confirmed && <span style={{ fontSize: 11, background: '#f0fdf4', color: '#16a34a', padding: '3px 8px', borderRadius: 10 }}>결제완료</span>}
    </div>
  </div>
))}

            </div>
          </>
        )}

        {tab === 'company' && isAdmin && (
          <div style={{ background: '#fff', borderRadius: 16, padding: 24, maxWidth: 480 }}>
            <h2 style={{ fontWeight: 900, fontSize: 18, marginBottom: 4 }}>회사 정보 설정</h2>
            <p style={{ fontSize: 12, color: '#94a3b8', marginBottom: 16 }}>견적서에 표시될 회사 정보를 등록해주세요.</p>

            {[
              { key: 'company_name', label: '회사명' },
              { key: 'ceo_name', label: '대표자명' },
              { key: 'biz_no', label: '사업자등록번호' },
              { key: 'license_no', label: '보수업 등록번호' },
              { key: 'address', label: '주소' },
              { key: 'phone', label: '전화번호' },
              { key: 'fax', label: '팩스번호' },
            ].map(f => (
              <div key={f.key} style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 13, fontWeight: 700, color: '#374151', display: 'block', marginBottom: 5 }}>{f.label}</label>
                <input value={companyForm[f.key] || ''} onChange={e => setCompanyForm({ ...companyForm, [f.key]: e.target.value })}
                  style={{ width: '100%', border: '1px solid #d1d5db', borderRadius: 10, padding: '9px 12px', fontSize: 13, boxSizing: 'border-box' }} />
              </div>
            ))}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
              {[
                { key: 'labor_indirect_rate', label: '간접노무비 비율' },
                { key: 'overhead_rate', label: '경비/일반관리비 비율' },
                { key: 'profit_rate', label: '기업이윤 비율' },
                { key: 'vat_rate', label: '부가세 비율' },
              ].map(f => (
                <div key={f.key}>
                  <label style={{ fontSize: 12, fontWeight: 700, color: '#374151', display: 'block', marginBottom: 5 }}>{f.label}</label>
                  <input type="number" step="0.01"
                    value={companyForm[f.key] ?? ''}
                    onChange={e => setCompanyForm({ ...companyForm, [f.key]: e.target.value })}
                    style={{ width: '100%', border: '1px solid #d1d5db', borderRadius: 10, padding: '9px 12px', fontSize: 13, boxSizing: 'border-box' }} />
                </div>
              ))}
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 13, fontWeight: 700, color: '#374151', display: 'block', marginBottom: 5 }}>로고 이미지</label>
              {companyForm.logo_image_url && <img src={companyForm.logo_image_url} alt="" style={{ height: 60, marginBottom: 6, objectFit: 'contain' }} />}
              <input type="file" accept="image/*" onChange={e => e.target.files?.[0] && uploadCompanyImage(e.target.files[0], 'logo')} />
              {logoUploading && <p style={{ fontSize: 11, color: '#3b82f6' }}>업로드 중...</p>}
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 13, fontWeight: 700, color: '#374151', display: 'block', marginBottom: 5 }}>직인 이미지</label>
              {companyForm.stamp_image_url && <img src={companyForm.stamp_image_url} alt="" style={{ height: 60, marginBottom: 6, objectFit: 'contain' }} />}
              <input type="file" accept="image/*" onChange={e => e.target.files?.[0] && uploadCompanyImage(e.target.files[0], 'stamp')} />
              {stampUploading && <p style={{ fontSize: 11, color: '#3b82f6' }}>업로드 중...</p>}
            </div>

            <button onClick={saveCompanyInfo} disabled={companySaving}
              style={{ width: '100%', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 10,
                padding: '12px', fontWeight: 800, fontSize: 14 }}>
              {companySaving ? '저장 중...' : '저장하기'}
            </button>
          </div>
        )}
      </div>

      {showCreate && (
        <div className="no-print" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16 }}>
          <div style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 640, maxHeight: '90vh',
            overflowY: 'auto', padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14 }}>
              <h3 style={{ fontWeight: 900, fontSize: 17 }}>{editingQuoteId ? '견적서 수정' : '새 견적서 작성'}</h3>
              <button onClick={() => { setShowCreate(false); resetCreateForm(); }} style={{ border: 'none', background: 'none', fontSize: 18 }}>✕</button>
            </div>

            {isAdmin && (
              <div style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 13, fontWeight: 700, marginBottom: 5, display: 'block' }}>담당 팀 *</label>
                <select value={createTeam}
                  onChange={e => { setCreateTeam(e.target.value); if (!editingQuoteId) setSelectedSite(null); }}
                  style={{ width: '100%', border: '1px solid #d1d5db', borderRadius: 10, padding: '9px 12px', fontSize: 13, boxSizing: 'border-box' }}>
                  <option value="">팀을 선택하세요</option>
                  {teams.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
                </select>
              </div>
            )}

            {isAdmin && !createTeam ? (
              <div style={{ padding: '30px 10px', textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
                담당 팀을 먼저 선택해주세요.
              </div>
            ) : !selectedSite ? (
              <div>
                <input value={siteSearch} onChange={e => setSiteSearch(e.target.value)}
                  placeholder="현장명, 주소로 검색"
                  style={{ width: '100%', border: '1px solid #e2e8f0', borderRadius: 10, padding: '10px 12px', fontSize: 14, marginBottom: 8, boxSizing: 'border-box' }} />
                <div style={{ maxHeight: 240, overflowY: 'auto' }}>
                  {siteResults.map(s => (
                    <div key={s.id} onClick={() => setSelectedSite(s)}
                      style={{ padding: 10, borderBottom: '1px solid #f1f5f9', cursor: 'pointer' }}>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>{s.site_name || s.name}</div>
                      <div style={{ fontSize: 12, color: '#94a3b8' }}>{s.address}</div>
                    </div>
                  ))}
                  {siteSearch && siteResults.length === 0 && (
                    <div style={{ padding: 16, textAlign: 'center', color: '#94a3b8', fontSize: 12 }}>검색 결과가 없습니다</div>
                  )}
                </div>
              </div>
            ) : (
              <>
                <div style={{ background: '#eff6ff', borderRadius: 10, padding: 12, marginBottom: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: 14, color: '#1e3a8a' }}>{selectedSite.site_name || selectedSite.name}</div>
                    <div style={{ fontSize: 12, color: '#60a5fa' }}>{selectedSite.address}</div>
                  </div>
                  {!editingQuoteId && (
                    <button onClick={() => setSelectedSite(null)} style={{ fontSize: 12, color: '#3b82f6', background: 'none', border: 'none' }}>변경</button>
                  )}
                </div>

                <div style={{ marginBottom: 12 }}>
                  <label style={{ fontSize: 13, fontWeight: 700, marginBottom: 5, display: 'block' }}>제목 *</label>
                  <input value={title} onChange={e => setTitle(e.target.value)} placeholder="예: 승강기 노후 부품 교체공사"
                    style={{ width: '100%', border: '1px solid #d1d5db', borderRadius: 10, padding: '9px 12px', fontSize: 13, boxSizing: 'border-box' }} />
                </div>

                <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label style={{ fontSize: 13, fontWeight: 700 }}>1. 자재비</label>
                  <button onClick={addMaterialRow} style={{ fontSize: 12, color: '#3b82f6', border: '1px solid #93c5fd', borderRadius: 6, padding: '3px 8px', background: '#fff' }}>+ 품목추가</button>
                </div>

                <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden', marginBottom: 6 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '2fr 0.8fr 0.8fr 1fr 1.2fr 1.5fr 0.4fr', gap: 4, background: '#f8fafc', padding: '6px 8px', fontSize: 11, fontWeight: 700, color: '#64748b' }}>
                    <span>품명</span><span>단위</span><span>수량</span><span>단가</span><span>금액</span><span>비고</span><span></span>
                  </div>
                  {materials.map((m, i) => (
                    <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 0.8fr 0.8fr 1fr 1.2fr 1.5fr 0.4fr', padding: '5px 8px', gap: 4, borderTop: '1px solid #f1f5f9', alignItems: 'center', boxSizing: 'border-box' }}>
                      <input value={m.name} onChange={e => updateMaterial(i, 'name', e.target.value)}
                        style={{ width: '100%', border: '1px solid #e5e7eb', borderRadius: 6, padding: '5px 6px', fontSize: 12, boxSizing: 'border-box' }} />
                      <input value={m.unit} onChange={e => updateMaterial(i, 'unit', e.target.value)}
                        style={{ width: '100%', border: '1px solid #e5e7eb', borderRadius: 6, padding: '5px 6px', fontSize: 12, boxSizing: 'border-box' }} />
                      <input
                        type="number"
                        value={m.qty === 0 ? '' : m.qty}
                        onFocus={e => e.target.select()}
                        onChange={e => updateMaterial(i, 'qty', e.target.value === '' ? 0 : Number(e.target.value))}
                        style={{ width: '100%', border: '1px solid #e5e7eb', borderRadius: 6, padding: '5px 6px', fontSize: 12, boxSizing: 'border-box' }} />
                      <input
                        type="number"
                        value={m.unit_price === 0 ? '' : m.unit_price}
                        onFocus={e => e.target.select()}
                        onChange={e => updateMaterial(i, 'unit_price', e.target.value === '' ? 0 : Number(e.target.value))}
                        style={{ width: '100%', border: '1px solid #e5e7eb', borderRadius: 6, padding: '5px 6px', fontSize: 12, boxSizing: 'border-box' }} />
                      <span style={{ fontSize: 12, textAlign: 'right', paddingRight: 4 }}>{won(m.qty * m.unit_price)}</span>
                      <input value={m.note} onChange={e => updateMaterial(i, 'note', e.target.value)} placeholder="비고"
                        style={{ width: '100%', border: '1px solid #e5e7eb', borderRadius: 6, padding: '5px 6px', fontSize: 12, boxSizing: 'border-box' }} />
                      <button onClick={() => removeMaterialRow(i)} style={{ border: 'none', background: 'none', color: '#ef4444', fontSize: 14 }}>✕</button>
                    </div>
                  ))}
                </div>
                <div style={{ textAlign: 'right', fontSize: 12, color: '#64748b', marginBottom: 14 }}>자재비 소계: <strong>{won(calc.materialsSubtotal)}원</strong></div>

                <div style={{ marginBottom: 8 }}>
                  <label style={{ fontSize: 13, fontWeight: 700 }}>2. 직접인건비</label>
                </div>
                <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden', marginBottom: 14 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.2fr 1.2fr', gap: 4, background: '#f8fafc', padding: '6px 8px', fontSize: 11, fontWeight: 700, color: '#64748b' }}>
                    <span>구분</span><span>수량</span><span>단가</span><span>금액</span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.2fr 1.2fr', gap: 4, padding: '5px 8px', borderTop: '1px solid #f1f5f9', alignItems: 'center', boxSizing: 'border-box' }}>
                    <select value={laborType} onChange={e => setLaborType(e.target.value as LaborType)}
                      style={{ width: '100%', border: '1px solid #e5e7eb', borderRadius: 6, padding: '5px 6px', fontSize: 12, boxSizing: 'border-box' }}>
                      <option value="공">공</option>
                      <option value="식">식</option>
                    </select>
                    <input
                      type="number"
                      value={laborQty === 0 ? '' : laborQty}
                      onFocus={e => e.target.select()}
                      onChange={e => setLaborQty(e.target.value === '' ? 0 : Number(e.target.value))}
                      style={{ width: '100%', border: '1px solid #e5e7eb', borderRadius: 6, padding: '5px 6px', fontSize: 12, boxSizing: 'border-box' }} />
                    <input
                      type="number"
                      value={laborUnitPrice === 0 ? '' : laborUnitPrice}
                      onFocus={e => e.target.select()}
                      onChange={e => setLaborUnitPrice(e.target.value === '' ? 0 : Number(e.target.value))}
                      style={{ width: '100%', border: '1px solid #e5e7eb', borderRadius: 6, padding: '5px 6px', fontSize: 12, boxSizing: 'border-box' }} />
                    <span style={{ fontSize: 12, textAlign: 'right', paddingRight: 4 }}>{won(calc.laborDirect)}</span>
                  </div>
                </div>

                <div style={{ marginBottom: 14 }}>
                  <label style={{ fontSize: 13, fontWeight: 700, marginBottom: 5, display: 'block' }}>특기사항</label>
                  <textarea value={remarks} onChange={e => setRemarks(e.target.value)} rows={2}
                    style={{ width: '100%', border: '1px solid #d1d5db', borderRadius: 10, padding: '9px 12px', fontSize: 13, boxSizing: 'border-box' }} />
                </div>

                <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden', fontSize: 13, color: '#374151' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 14px' }}>
                    <span>자재비 소계</span><span>{won(calc.materialsSubtotal)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 14px' }}>
                    <span>직접인건비</span><span>{won(calc.laborDirect)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 14px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                      <input type="checkbox" checked={includeIndirectLabor} onChange={e => setIncludeIndirectLabor(e.target.checked)} />
                      간접인건비 (직접인건비 × {(rates.labor_indirect * 100).toFixed(0)}%)
                    </label>
                    <span>{won(calc.laborIndirect)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 14px', background: '#f8fafc', fontWeight: 700 }}>
                    <span>인건비 소계</span><span>{won(calc.laborSubtotal)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 14px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                      <input type="checkbox" checked={includeOverhead} onChange={e => setIncludeOverhead(e.target.checked)} />
                      경비 및 일반관리비 ({(rates.overhead * 100).toFixed(0)}%)
                    </label>
                    <span>{won(calc.overhead)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 14px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                      <input type="checkbox" checked={includeProfit} onChange={e => setIncludeProfit(e.target.checked)} />
                      기업이윤 ({(rates.profit * 100).toFixed(0)}%)
                    </label>
                    <span>{won(calc.profit)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 14px', background: '#f8fafc', fontWeight: 700 }}>
                    <span>공급가액</span><span>{won(calc.supplyAmount)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 14px', background: '#f8fafc', fontWeight: 700 }}>
                    <span>부가세 ({(rates.vat * 100).toFixed(0)}%)</span><span>{won(calc.vat)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 14px', background: '#eff6ff', fontWeight: 900, fontSize: 15, color: '#2563eb' }}>
                    <span>합계금액</span><span>{won(calc.total)}</span>
                  </div>
                </div>
                <p style={{ fontSize: 11, color: '#94a3b8', marginTop: 6 }}>
                  ※ 체크 해제 시 해당 항목이 견적서에서 완전히 제외되고 합계금액에서도 차감됩니다. (현장 협의 시 활용)
                </p>

                <button onClick={handleSaveQuote} disabled={saving}
                  style={{ width: '100%', marginTop: 16, background: '#3b82f6', color: '#fff', border: 'none',
                    borderRadius: 10, padding: '13px', fontWeight: 800, fontSize: 14 }}>
                  {saving ? '저장 중...' : editingQuoteId ? '수정 저장 (재승인 요청)' : '견적서 저장 (승인요청)'}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {selectedQuote && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16 }}>
          <div style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 680, maxHeight: '90vh', overflowY: 'auto', padding: 20 }}>
            <div className="no-print" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
              <h3 style={{ fontWeight: 900, fontSize: 16 }}>견적서 상세</h3>
              <button onClick={() => { setSelectedQuote(null); setShowRejectInput(false); }} style={{ border: 'none', background: 'none', fontSize: 18 }}>✕</button>
            </div>

            <div className="no-print" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <span style={{ fontSize: 12, fontWeight: 700, padding: '4px 10px', borderRadius: 10,
                  background: selectedQuote.status === '승인' ? '#dcfce7' : selectedQuote.status === '반려' ? '#fee2e2' : '#fef9c3',
                  color: selectedQuote.status === '승인' ? '#15803d' : selectedQuote.status === '반려' ? '#b91c1c' : '#a16207' }}>
                  {selectedQuote.status}
                </span>
                {selectedQuote.status !== '승인대기' && (
                  <span style={{ fontSize: 11, color: '#94a3b8' }}>
                    {selectedQuote.approved_by} · {(selectedQuote.approved_at || '').slice(0, 16).replace('T', ' ')}
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {selectedQuote.status === '승인' && (
                  <button onClick={() => window.print()}
                    style={{ fontSize: 12, fontWeight: 700, color: '#475569', border: '1px solid #cbd5e1', borderRadius: 8, padding: '5px 10px', background: '#fff' }}>
                    🖨️ 인쇄
                  </button>
                )}
                {canEdit(selectedQuote) && (
                  <button onClick={() => openEdit(selectedQuote)}
                    style={{ fontSize: 12, fontWeight: 700, color: '#3b82f6', border: '1px solid #93c5fd', borderRadius: 8, padding: '5px 10px', background: '#fff' }}>
                    ✏️ 수정
                  </button>
                )}
              </div>
            </div>

            {selectedQuote.status === '반려' && selectedQuote.rejected_reason && (
              <div className="no-print" style={{ background: '#fef2f2', color: '#b91c1c', fontSize: 12, padding: 10, borderRadius: 8, marginBottom: 14 }}>
                반려 사유: {selectedQuote.rejected_reason}
              </div>
            )}

            {/* ══════════════ 견적서 문서 미리보기 (실제 양식 재현) ══════════════ */}
            <div id="quote-document" style={{ border: '1px solid #cbd5e1', borderRadius: 4, padding: 24, marginBottom: 14, background: '#fff', fontFamily: 'inherit' }}>

              {/* 제목 */}
              <div style={{ textAlign: 'center', fontSize: 22, fontWeight: 900, letterSpacing: 10, marginBottom: 22 }}>
                견 적 서
              </div>

              {/* 상단: 좌측 여백 / 우측 회사정보+대표+직인 */}
              <div style={{ position: 'relative', minHeight: 74, marginBottom: 10 }}>
                <div style={{ position: 'absolute', top: 0, right: 0, textAlign: 'right', fontSize: 13, lineHeight: 1.7 }}>
                  <div style={{ fontWeight: 800, display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 6 }}>
                    {company?.logo_image_url && <img src={company.logo_image_url} alt="로고" style={{ height: 26, objectFit: 'contain' }} />}
                    {company?.company_name}
                  </div>
                  <div style={{ color: '#475569' }}>{fmtDate(selectedQuote.created_at)}</div>
                  <div style={{ position: 'relative', display: 'inline-block', marginTop: 4, paddingRight: 44 }}>
                    대 표 : {company?.ceo_name}
                    {company?.stamp_image_url && (
                      <img src={company.stamp_image_url} alt="직인"
                        style={{ position: 'absolute', top: -12, right: 2, width: 42, height: 42, objectFit: 'contain', opacity: 0.85 }} />
                    )}
                  </div>
                </div>
              </div>

              {/* 귀중 */}
              <div style={{ fontSize: 17, fontWeight: 900, marginTop: 10, marginBottom: 12, borderBottom: '2px solid #1e293b', paddingBottom: 10 }}>
                {(selectedQuote.items?.client_name) || `${selectedQuote.items?.site_name || ''} 귀중`}
              </div>

              {/* 사업자등록번호 / 보수업등록번호 */}
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#334155', marginBottom: 4 }}>
                <span>사업자등록번호 : {company?.biz_no}</span>
                <span>보수업등록번호 : {company?.license_no}</span>
              </div>
              {/* 주소 */}
              <div style={{ fontSize: 12, color: '#334155', marginBottom: 4 }}>{company?.address}</div>
              {/* 전화/팩스 */}
              <div style={{ fontSize: 12, color: '#334155', marginBottom: 14 }}>
                ☎ {company?.phone}{company?.fax ? `   Fax ${company.fax}` : ''}
              </div>

              {/* 견적금액 - 라벨과 숫자 크기 동일 */}
              <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <span style={{ fontSize: 16, fontWeight: 800, color: '#1e3a8a' }}>견적금액</span>
                <span style={{ fontSize: 16, fontWeight: 800, color: '#2563eb' }}>₩ {won(selectedQuote.amount)} 원</span>
              </div>
              <div style={{ fontSize: 11, color: '#94a3b8', textAlign: 'right', marginBottom: 16 }}>※상기금액은 부가세 포함 합계금액임.</div>

              {/* 제목 (공사명) */}
              <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 10 }}>▣ 제목 : {selectedQuote.title}</div>

              {/* 자재비 표 */}
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginBottom: 4 }}>
                <thead>
                  <tr style={{ background: '#f1f5f9' }}>
                    <th style={{ padding: '6px 6px', textAlign: 'left', border: '1px solid #e2e8f0' }}>품명</th>
                    <th style={{ padding: '6px 6px', textAlign: 'center', border: '1px solid #e2e8f0', width: 50 }}>단위</th>
                    <th style={{ padding: '6px 6px', textAlign: 'right', border: '1px solid #e2e8f0', width: 55 }}>수량</th>
                    <th style={{ padding: '6px 6px', textAlign: 'right', border: '1px solid #e2e8f0', width: 80 }}>단가</th>
                    <th style={{ padding: '6px 6px', textAlign: 'right', border: '1px solid #e2e8f0', width: 90 }}>금액</th>
                    <th style={{ padding: '6px 6px', textAlign: 'left', border: '1px solid #e2e8f0', width: 90 }}>비고</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td colSpan={6} style={{ padding: '5px 6px', border: '1px solid #e2e8f0', background: '#fafafa', fontWeight: 700 }}>1. 자재비</td>
                  </tr>
                  {(selectedQuote.items?.materials || []).map((m: any, i: number) => (
                    <tr key={i}>
                      <td style={{ padding: '5px 6px', border: '1px solid #e2e8f0' }}>{m.name}</td>
                      <td style={{ padding: '5px 6px', border: '1px solid #e2e8f0', textAlign: 'center' }}>{m.unit}</td>
                      <td style={{ padding: '5px 6px', border: '1px solid #e2e8f0', textAlign: 'right' }}>{m.qty}</td>
                      <td style={{ padding: '5px 6px', border: '1px solid #e2e8f0', textAlign: 'right' }}>{won(m.unit_price)}</td>
                      <td style={{ padding: '5px 6px', border: '1px solid #e2e8f0', textAlign: 'right' }}>{won(m.qty * m.unit_price)}</td>
                      <td style={{ padding: '5px 6px', border: '1px solid #e2e8f0' }}>{m.note}</td>
                    </tr>
                  ))}
                  <tr style={{ background: '#f8fafc' }}>
                    <td colSpan={4} style={{ padding: '5px 6px', border: '1px solid #e2e8f0', textAlign: 'right', fontWeight: 700 }}>소 계</td>
                    <td style={{ padding: '5px 6px', border: '1px solid #e2e8f0', textAlign: 'right', fontWeight: 700 }}>{won(selectedQuote.items?.breakdown?.materialsSubtotal)}</td>
                    <td style={{ padding: '5px 6px', border: '1px solid #e2e8f0' }}></td>
                  </tr>

                  <tr>
                    <td colSpan={6} style={{ padding: '5px 6px', border: '1px solid #e2e8f0', background: '#fafafa', fontWeight: 700 }}>2. 인건비</td>
                  </tr>
                  <tr>
                    <td style={{ padding: '5px 6px', border: '1px solid #e2e8f0' }}>직접인건비</td>
                    <td style={{ padding: '5px 6px', border: '1px solid #e2e8f0', textAlign: 'center' }}>{selectedQuote.items?.labor?.type}</td>
                    <td style={{ padding: '5px 6px', border: '1px solid #e2e8f0', textAlign: 'right' }}>{selectedQuote.items?.labor?.qty}</td>
                    <td style={{ padding: '5px 6px', border: '1px solid #e2e8f0', textAlign: 'right' }}>{won(selectedQuote.items?.labor?.unit_price)}</td>
                    <td style={{ padding: '5px 6px', border: '1px solid #e2e8f0', textAlign: 'right' }}>{won(selectedQuote.items?.breakdown?.laborDirect)}</td>
                    <td style={{ padding: '5px 6px', border: '1px solid #e2e8f0' }}></td>
                  </tr>
                  {/* 간접인건비: 체크 해제 시 줄 자체를 숨김 (레고 방식) */}
                  {inclIndirect && (
                    <tr>
                      <td colSpan={4} style={{ padding: '5px 6px', border: '1px solid #e2e8f0' }}>
                        간접인건비 (직접인건비 × {(((selectedQuote.items?.rates?.labor_indirect) ?? rates.labor_indirect) * 100).toFixed(0)}%)
                      </td>
                      <td style={{ padding: '5px 6px', border: '1px solid #e2e8f0', textAlign: 'right' }}>{won(selectedQuote.items?.breakdown?.laborIndirect)}</td>
                      <td style={{ padding: '5px 6px', border: '1px solid #e2e8f0' }}></td>
                    </tr>
                  )}
                  <tr style={{ background: '#f8fafc' }}>
                    <td colSpan={4} style={{ padding: '5px 6px', border: '1px solid #e2e8f0', textAlign: 'right', fontWeight: 700 }}>소 계</td>
                    <td style={{ padding: '5px 6px', border: '1px solid #e2e8f0', textAlign: 'right', fontWeight: 700 }}>{won(selectedQuote.items?.breakdown?.laborSubtotal)}</td>
                    <td style={{ padding: '5px 6px', border: '1px solid #e2e8f0' }}></td>
                  </tr>

                  {/* 경비및일반관리비: 체크 해제 시 줄 자체를 숨김 */}
                  {inclOverhead && (
                    <tr>
                      <td colSpan={4} style={{ padding: '5px 6px', border: '1px solid #e2e8f0' }}>
                        3. 경비 및 일반관리비 ((1+2항) × {(((selectedQuote.items?.rates?.overhead) ?? rates.overhead) * 100).toFixed(0)}%)
                      </td>
                      <td style={{ padding: '5px 6px', border: '1px solid #e2e8f0', textAlign: 'right', fontWeight: 700 }}>{won(selectedQuote.items?.breakdown?.overhead)}</td>
                      <td style={{ padding: '5px 6px', border: '1px solid #e2e8f0' }}></td>
                    </tr>
                  )}
                  {/* 기업이윤: 체크 해제 시 줄 자체를 숨김 */}
                  {inclProfit && (
                    <tr>
                      <td colSpan={4} style={{ padding: '5px 6px', border: '1px solid #e2e8f0' }}>
                        4. 기업이윤 ((1+3항) × {(((selectedQuote.items?.rates?.profit) ?? rates.profit) * 100).toFixed(0)}%)
                      </td>
                      <td style={{ padding: '5px 6px', border: '1px solid #e2e8f0', textAlign: 'right', fontWeight: 700 }}>{won(selectedQuote.items?.breakdown?.profit)}</td>
                      <td style={{ padding: '5px 6px', border: '1px solid #e2e8f0' }}></td>
                    </tr>
                  )}
                  <tr style={{ background: '#f1f5f9' }}>
                    <td colSpan={4} style={{ padding: '5px 6px', border: '1px solid #e2e8f0', textAlign: 'right', fontWeight: 700 }}>금 액</td>
                    <td style={{ padding: '5px 6px', border: '1px solid #e2e8f0', textAlign: 'right', fontWeight: 700 }}>{won(selectedQuote.items?.breakdown?.supplyAmount)}</td>
                    <td style={{ padding: '5px 6px', border: '1px solid #e2e8f0' }}></td>
                  </tr>
                  <tr style={{ background: '#f1f5f9' }}>
                    <td colSpan={4} style={{ padding: '5px 6px', border: '1px solid #e2e8f0', textAlign: 'right', fontWeight: 700 }}>
                      부 가 세 ({(((selectedQuote.items?.rates?.vat) ?? rates.vat) * 100).toFixed(0)}%)
                    </td>
                    <td style={{ padding: '5px 6px', border: '1px solid #e2e8f0', textAlign: 'right', fontWeight: 700 }}>{won(selectedQuote.items?.breakdown?.vat)}</td>
                    <td style={{ padding: '5px 6px', border: '1px solid #e2e8f0' }}></td>
                  </tr>
                  <tr>
                    <td colSpan={4} style={{ padding: '7px 6px', border: '1px solid #e2e8f0', textAlign: 'right', fontWeight: 900, background: '#eff6ff' }}>합 계 금 액</td>
                    <td style={{ padding: '7px 6px', border: '1px solid #e2e8f0', textAlign: 'right', fontWeight: 900, background: '#eff6ff', color: '#2563eb' }}>{won(selectedQuote.amount)}</td>
                    <td style={{ padding: '7px 6px', border: '1px solid #e2e8f0', background: '#eff6ff', fontSize: 10, color: '#94a3b8' }}>백단위절사</td>
                  </tr>
                </tbody>
              </table>

              {selectedQuote.items?.remarks && (
                <div style={{ fontSize: 12, color: '#64748b', marginTop: 12 }}>
                  <strong>[특기사항]</strong> {selectedQuote.items.remarks}
                </div>
              )}
            </div>
            {/* ══════════════ 견적서 문서 미리보기 끝 ══════════════ */}

            {isAdmin && selectedQuote.status === '승인대기' && !showRejectInput && (
              <div className="no-print" style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
                <button onClick={() => handleApprove(selectedQuote)}
                  style={{ flex: 1, background: '#22c55e', color: '#fff', border: 'none', borderRadius: 10, padding: '11px', fontWeight: 800, fontSize: 13 }}>
                  승인
                </button>
                <button onClick={() => setShowRejectInput(true)}
                  style={{ flex: 1, background: '#ef4444', color: '#fff', border: 'none', borderRadius: 10, padding: '11px', fontWeight: 800, fontSize: 13 }}>
                  반려
                </button>
              </div>
            )}

            {isAdmin && showRejectInput && (
              <div className="no-print" style={{ marginBottom: 14 }}>
                <textarea value={rejectReasonInput} onChange={e => setRejectReasonInput(e.target.value)}
                  placeholder="반려 사유를 입력하세요" rows={2}
                  style={{ width: '100%', border: '1px solid #d1d5db', borderRadius: 10, padding: '9px 12px', fontSize: 13, marginBottom: 8, boxSizing: 'border-box' }} />
                <button onClick={() => handleReject(selectedQuote)}
                  style={{ width: '100%', background: '#ef4444', color: '#fff', border: 'none', borderRadius: 10, padding: '11px', fontWeight: 800, fontSize: 13 }}>
                  반려 처리
                </button>
              </div>
            )}

            {isAdmin && selectedQuote.status === '승인' && (
              <div className="no-print" style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => toggleInvoice(selectedQuote)}
                  style={{ flex: 1, background: selectedQuote.invoice_issued ? '#dbeafe' : '#f1f5f9',
                    color: selectedQuote.invoice_issued ? '#2563eb' : '#64748b', border: 'none', borderRadius: 10, padding: '11px', fontWeight: 700, fontSize: 12 }}>
                  {selectedQuote.invoice_issued ? '계산서 발급 취소' : '계산서 발급'}
                </button>
                <button onClick={() => togglePayment(selectedQuote)}
                  style={{ flex: 1, background: selectedQuote.payment_confirmed ? '#dcfce7' : '#f1f5f9',
                    color: selectedQuote.payment_confirmed ? '#16a34a' : '#64748b', border: 'none', borderRadius: 10, padding: '11px', fontWeight: 700, fontSize: 12 }}>
                  {selectedQuote.payment_confirmed ? '결제 확인 취소' : '결제 확인'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      <style>{`
        input[type=number]::-webkit-outer-spin-button,
        input[type=number]::-webkit-inner-spin-button {
          -webkit-appearance: none;
          margin: 0;
        }
        input[type=number] {
          -moz-appearance: textfield;
        }

        @page {
          size: A4;
          margin: 0;
        }

        @media print {
          body * { visibility: hidden; }
          #quote-document, #quote-document * { visibility: visible; }
          #quote-document {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            padding: 15mm;
            border: none !important;
            box-shadow: none !important;
          }
          .no-print { display: none !important; }
        }
      `}</style>
    </div>
  );
}
