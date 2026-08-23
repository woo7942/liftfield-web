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

const truncateHundred = (n: number) => Math.floor(n / 100) * 100;

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
  const [siteSearch, setSiteSearch] = useState('');
  const [siteResults, setSiteResults] = useState<any[]>([]);
  const [selectedSite, setSelectedSite] = useState<any>(null);
  const [title, setTitle] = useState('');
  const [materials, setMaterials] = useState<MaterialItem[]>([
    { name: '', unit: '', qty: 1, unit_price: 0, note: '' },
  ]);
  const [laborDirect, setLaborDirect] = useState(0);
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
    const t = setTimeout(async () => {
      let q = supabase.from('sites').select('id, name, site_name, address, phone, manager_name, team')
        .eq('company_id', userInfo.company_id);
      if (!isAdmin) q = q.eq('team', userInfo.team);
      const { data } = await q;
      const kw = siteSearch.toLowerCase();
      const filtered = (data || []).filter((s: any) =>
        (s.site_name || s.name || '').toLowerCase().includes(kw) ||
        (s.address || '').toLowerCase().includes(kw)
      );
      setSiteResults(filtered.slice(0, 20));
    }, 300);
    return () => clearTimeout(t);
  }, [siteSearch, showCreate, userInfo, isAdmin]);

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
    const laborIndirect = laborDirect * rates.labor_indirect;
    const laborSubtotal = laborDirect + laborIndirect;
    const overhead = (materialsSubtotal + laborSubtotal) * rates.overhead;
    const profit = (materialsSubtotal + overhead) * rates.profit;
    const supplyAmount = materialsSubtotal + laborSubtotal + overhead + profit;
    const vat = supplyAmount * rates.vat;
    const total = truncateHundred(supplyAmount + vat);
    return { materialsSubtotal, laborIndirect, laborSubtotal, overhead, profit, supplyAmount, vat, total };
  }, [materials, laborDirect, rates]);

  const resetCreateForm = () => {
    setSiteSearch(''); setSiteResults([]); setSelectedSite(null);
    setTitle(''); setMaterials([{ name: '', unit: '', qty: 1, unit_price: 0, note: '' }]);
    setLaborDirect(0); setRemarks('');
  };

  const handleSaveQuote = async () => {
    if (!selectedSite) { alert('현장을 선택해주세요.'); return; }
    if (!title.trim()) { alert('제목을 입력해주세요.'); return; }
    setSaving(true);
    try {
      const siteName = selectedSite.site_name || selectedSite.name || '';
      const itemsPayload = {
        materials,
        labor_direct: laborDirect,
        rates,
        client_name: `${siteName} 귀중`,
        title: title.trim(),
        remarks,
        breakdown: calc,
      };
      const { error } = await supabase.from('quotes').insert({
        site_id: selectedSite.id,
        title: title.trim(),
        amount: calc.total,
        status: '승인대기',
        team_id: userInfo.team,
        created_by: userInfo.uid,
        items: itemsPayload,
        created_at: new Date().toISOString(),
      });
      if (error) throw error;
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
      alert('저장됐어요.');
    } catch (e: any) {
      alert('저장 실패: ' + e.message);
    } finally {
      setCompanySaving(false);
    }
  };

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>로딩 중...</div>;

  const won = (n: number) => Math.round(n).toLocaleString('ko-KR');

  return (
    <div style={{ minHeight: '100vh', background: '#f1f5f9', paddingBottom: 40 }}>
      <header style={{ background: '#0f172a', padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={() => router.push('/work')} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 13 }}>← 뒤로</button>
        <span style={{ color: '#f8fafc', fontWeight: 800, fontSize: 16 }}>📄 견적서</span>
      </header>

      <div style={{ maxWidth: 1000, margin: '0 auto', padding: 16 }}>
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
              🏢 회사정보 설정
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
              <button onClick={() => setShowCreate(true)}
                style={{ marginLeft: 'auto', background: '#3b82f6', color: '#fff', border: 'none',
                  padding: '9px 16px', borderRadius: 8, fontWeight: 700, fontSize: 13 }}>
                + 견적서 작성
              </button>
            </div>

            <div style={{ background: '#fff', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,.05)' }}>
              {quotes.length === 0 ? (
                <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>견적서가 없어요.</div>
              ) : quotes.map(q => (
                <div key={q.id} onClick={() => setSelectedQuote(q)}
                  style={{ padding: 14, borderBottom: '1px solid #f1f5f9', cursor: 'pointer', display: 'flex',
                    justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14, color: '#1e293b' }}>{q.title}</div>
                    <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 3 }}>
                      {q.team_id} · {won(q.amount || 0)}원 · {(q.created_at || '').slice(0, 10)}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <span style={{
                      fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 10,
                      background: q.status === '승인' ? '#dcfce7' : q.status === '반려' ? '#fee2e2' : '#fef9c3',
                      color: q.status === '승인' ? '#15803d' : q.status === '반려' ? '#b91c1c' : '#a16207',
                    }}>{q.status}</span>
                    {q.invoice_issued && <span style={{ fontSize: 11, background: '#eff6ff', color: '#2563eb', padding: '3px 8px', borderRadius: 10 }}>계산서✓</span>}
                    {q.payment_confirmed && <span style={{ fontSize: 11, background: '#f0fdf4', color: '#16a34a', padding: '3px 8px', borderRadius: 10 }}>입금✓</span>}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {tab === 'company' && isAdmin && (
          <div style={{ background: '#fff', borderRadius: 16, padding: 24, maxWidth: 480 }}>
            <h2 style={{ fontWeight: 900, fontSize: 18, marginBottom: 4 }}>🏢 회사정보 설정</h2>
            <p style={{ fontSize: 12, color: '#94a3b8', marginBottom: 16 }}>여기 등록한 정보가 견적서에 자동으로 들어가요.</p>

            {[
              { key: 'company_name', label: '회사명' },
              { key: 'ceo_name', label: '대표자명' },
              { key: 'biz_no', label: '사업자등록번호' },
              { key: 'license_no', label: '보수업등록번호' },
              { key: 'address', label: '주소' },
              { key: 'phone', label: '전화번호' },
              { key: 'fax', label: '팩스번호' },
            ].map(f => (
              <div key={f.key} style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 13, fontWeight: 700, color: '#374151', display: 'block', marginBottom: 5 }}>{f.label}</label>
                <input value={companyForm[f.key] || ''} onChange={e => setCompanyForm({ ...companyForm, [f.key]: e.target.value })}
                  style={{ width: '100%', border: '1px solid #d1d5db', borderRadius: 10, padding: '9px 12px', fontSize: 13 }} />
              </div>
            ))}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
              {[
                { key: 'labor_indirect_rate', label: '간접인건비 %' },
                { key: 'overhead_rate', label: '경비/관리비 %' },
                { key: 'profit_rate', label: '기업이윤 %' },
                { key: 'vat_rate', label: '부가세 %' },
              ].map(f => (
                <div key={f.key}>
                  <label style={{ fontSize: 12, fontWeight: 700, color: '#374151', display: 'block', marginBottom: 5 }}>{f.label}</label>
                  <input type="number" step="0.01"
                    value={companyForm[f.key] ?? ''}
                    onChange={e => setCompanyForm({ ...companyForm, [f.key]: e.target.value })}
                    style={{ width: '100%', border: '1px solid #d1d5db', borderRadius: 10, padding: '9px 12px', fontSize: 13 }} />
                </div>
              ))}
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 13, fontWeight: 700, color: '#374151', display: 'block', marginBottom: 5 }}>로고 이미지</label>
              {companyForm.logo_image_url && <img src={companyForm.logo_image_url} alt="로고" style={{ height: 60, marginBottom: 6, objectFit: 'contain' }} />}
              <input type="file" accept="image/*" onChange={e => e.target.files?.[0] && uploadCompanyImage(e.target.files[0], 'logo')} />
              {logoUploading && <p style={{ fontSize: 11, color: '#3b82f6' }}>업로드 중...</p>}
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 13, fontWeight: 700, color: '#374151', display: 'block', marginBottom: 5 }}>직인 이미지</label>
              {companyForm.stamp_image_url && <img src={companyForm.stamp_image_url} alt="직인" style={{ height: 60, marginBottom: 6, objectFit: 'contain' }} />}
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
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16 }}>
          <div style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 640, maxHeight: '90vh',
            overflowY: 'auto', padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14 }}>
              <h3 style={{ fontWeight: 900, fontSize: 17 }}>📄 견적서 작성</h3>
              <button onClick={() => { setShowCreate(false); resetCreateForm(); }} style={{ border: 'none', background: 'none', fontSize: 18 }}>✕</button>
            </div>

            {!selectedSite ? (
              <div>
                <input value={siteSearch} onChange={e => setSiteSearch(e.target.value)}
                  placeholder="🔍 현장명, 주소 검색"
                  style={{ width: '100%', border: '1px solid #e2e8f0', borderRadius: 10, padding: '10px 12px', fontSize: 14, marginBottom: 8 }} />
                <div style={{ maxHeight: 240, overflowY: 'auto' }}>
                  {siteResults.map(s => (
                    <div key={s.id} onClick={() => setSelectedSite(s)}
                      style={{ padding: 10, borderBottom: '1px solid #f1f5f9', cursor: 'pointer' }}>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>{s.site_name || s.name}</div>
                      <div style={{ fontSize: 12, color: '#94a3b8' }}>{s.address}</div>
                    </div>
                  ))}
                  {siteSearch && siteResults.length === 0 && (
                    <div style={{ padding: 16, textAlign: 'center', color: '#94a3b8', fontSize: 12 }}>검색 결과 없음</div>
                  )}
                </div>
              </div>
            ) : (
              <>
                <div style={{ background: '#eff6ff', borderRadius: 10, padding: 12, marginBottom: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: 14, color: '#1e3a8a' }}>{selectedSite.site_name || selectedSite.name} 귀중</div>
                    <div style={{ fontSize: 12, color: '#60a5fa' }}>{selectedSite.address}</div>
                  </div>
                  <button onClick={() => setSelectedSite(null)} style={{ fontSize: 12, color: '#3b82f6', background: 'none', border: 'none' }}>변경</button>
                </div>

                <div style={{ marginBottom: 12 }}>
                  <label style={{ fontSize: 13, fontWeight: 700, marginBottom: 5, display: 'block' }}>제목 *</label>
                  <input value={title} onChange={e => setTitle(e.target.value)} placeholder="예: 승강기 노후 부품 교체공사"
                    style={{ width: '100%', border: '1px solid #d1d5db', borderRadius: 10, padding: '9px 12px', fontSize: 13 }} />
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
      <input value={m.name} onChange={e => updateMaterial(i, 'name', e.target.value)} style={{ width: '100%', border: '1px solid #e5e7eb', borderRadius: 6, padding: '5px 6px', fontSize: 12, boxSizing: 'border-box' }} />
      <input value={m.unit} onChange={e => updateMaterial(i, 'unit', e.target.value)} style={{ width: '100%', border: '1px solid #e5e7eb', borderRadius: 6, padding: '5px 6px', fontSize: 12, boxSizing: 'border-box' }} />
      <input type="number" value={m.qty} onChange={e => updateMaterial(i, 'qty', Number(e.target.value))} style={{ width: '100%', border: '1px solid #e5e7eb', borderRadius: 6, padding: '5px 6px', fontSize: 12, boxSizing: 'border-box' }} />
      <input type="number" value={m.unit_price} onChange={e => updateMaterial(i, 'unit_price', Number(e.target.value))} style={{ width: '100%', border: '1px solid #e5e7eb', borderRadius: 6, padding: '5px 6px', fontSize: 12, boxSizing: 'border-box' }} />
      <span style={{ fontSize: 12, textAlign: 'right', paddingRight: 4 }}>{won(m.qty * m.unit_price)}</span>
      <input value={m.note} onChange={e => updateMaterial(i, 'note', e.target.value)} placeholder="비고" style={{ width: '100%', border: '1px solid #e5e7eb', borderRadius: 6, padding: '5px 6px', fontSize: 12, boxSizing: 'border-box' }} />
      <button onClick={() => removeMaterialRow(i)} style={{ border: 'none', background: 'none', color: '#ef4444', fontSize: 14 }}>✕</button>
    </div>
  ))}
</div>
<div style={{ textAlign: 'right', fontSize: 12, color: '#64748b', marginBottom: 14 }}>자재비 소계: <strong>{won(calc.materialsSubtotal)}원</strong></div>


                <div style={{ marginBottom: 14 }}>
                  <label style={{ fontSize: 13, fontWeight: 700, marginBottom: 5, display: 'block' }}>2. 직접인건비</label>
                  <input type="number" value={laborDirect} onChange={e => setLaborDirect(Number(e.target.value))}
                    style={{ width: '100%', border: '1px solid #d1d5db', borderRadius: 10, padding: '9px 12px', fontSize: 13 }} />
                </div>

                <div style={{ marginBottom: 14 }}>
                  <label style={{ fontSize: 13, fontWeight: 700, marginBottom: 5, display: 'block' }}>특기사항</label>
                  <textarea value={remarks} onChange={e => setRemarks(e.target.value)} rows={2}
                    style={{ width: '100%', border: '1px solid #d1d5db', borderRadius: 10, padding: '9px 12px', fontSize: 13 }} />
                </div>

                <div style={{ background: '#f8fafc', borderRadius: 10, padding: 14, fontSize: 13, color: '#374151' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}><span>자재비 소계</span><span>{won(calc.materialsSubtotal)}원</span></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}><span>인건비 소계 (직접+간접{rates.labor_indirect * 100}%)</span><span>{won(calc.laborSubtotal)}원</span></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}><span>경비및일반관리비 ({rates.overhead * 100}%)</span><span>{won(calc.overhead)}원</span></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}><span>기업이윤 ({rates.profit * 100}%)</span><span>{won(calc.profit)}원</span></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, borderTop: '1px solid #e2e8f0', paddingTop: 6 }}><span>공급가액</span><span>{won(calc.supplyAmount)}원</span></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}><span>부가세 ({rates.vat * 100}%)</span><span>{won(calc.vat)}원</span></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 900, fontSize: 15, borderTop: '1px solid #e2e8f0', paddingTop: 8, marginTop: 4 }}>
                    <span>합계금액</span><span style={{ color: '#3b82f6' }}>{won(calc.total)}원</span>
                  </div>
                </div>

                <button onClick={handleSaveQuote} disabled={saving}
                  style={{ width: '100%', marginTop: 16, background: '#3b82f6', color: '#fff', border: 'none',
                    borderRadius: 10, padding: '13px', fontWeight: 800, fontSize: 14 }}>
                  {saving ? '저장 중...' : '견적서 저장 (승인요청)'}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {selectedQuote && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16 }}>
          <div style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 520, maxHeight: '85vh', overflowY: 'auto', padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
              <h3 style={{ fontWeight: 900, fontSize: 16 }}>{selectedQuote.title}</h3>
              <button onClick={() => { setSelectedQuote(null); setShowRejectInput(false); }} style={{ border: 'none', background: 'none', fontSize: 18 }}>✕</button>
            </div>

            <div style={{ fontSize: 13, color: '#64748b', marginBottom: 12 }}>
              {selectedQuote.items?.client_name} · {selectedQuote.team_id} · {(selectedQuote.created_at || '').slice(0, 10)}
            </div>

            <div style={{ background: '#f8fafc', borderRadius: 10, padding: 14, fontSize: 13, marginBottom: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 900, fontSize: 15 }}>
                <span>합계금액</span><span style={{ color: '#3b82f6' }}>{won(selectedQuote.amount || 0)}원</span>
              </div>
            </div>

            {selectedQuote.items?.remarks && (
              <div style={{ fontSize: 12, color: '#64748b', marginBottom: 14 }}>특기사항: {selectedQuote.items.remarks}</div>
            )}

            <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
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
            {selectedQuote.status === '반려' && selectedQuote.rejected_reason && (
              <div style={{ background: '#fef2f2', color: '#b91c1c', fontSize: 12, padding: 10, borderRadius: 8, marginBottom: 14 }}>
                반려사유: {selectedQuote.rejected_reason}
              </div>
            )}

            {isAdmin && selectedQuote.status === '승인대기' && !showRejectInput && (
              <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
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
              <div style={{ marginBottom: 14 }}>
                <textarea value={rejectReasonInput} onChange={e => setRejectReasonInput(e.target.value)}
                  placeholder="반려 사유를 입력하세요" rows={2}
                  style={{ width: '100%', border: '1px solid #d1d5db', borderRadius: 10, padding: '9px 12px', fontSize: 13, marginBottom: 8 }} />
                <button onClick={() => handleReject(selectedQuote)}
                  style={{ width: '100%', background: '#ef4444', color: '#fff', border: 'none', borderRadius: 10, padding: '11px', fontWeight: 800, fontSize: 13 }}>
                  반려 확정
                </button>
              </div>
            )}

            {isAdmin && selectedQuote.status === '승인' && (
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => toggleInvoice(selectedQuote)}
                  style={{ flex: 1, background: selectedQuote.invoice_issued ? '#dbeafe' : '#f1f5f9',
                    color: selectedQuote.invoice_issued ? '#2563eb' : '#64748b', border: 'none', borderRadius: 10, padding: '11px', fontWeight: 700, fontSize: 12 }}>
                  {selectedQuote.invoice_issued ? '✓ 계산서 발급됨' : '계산서 발급 처리'}
                </button>
                <button onClick={() => togglePayment(selectedQuote)}
                  style={{ flex: 1, background: selectedQuote.payment_confirmed ? '#dcfce7' : '#f1f5f9',
                    color: selectedQuote.payment_confirmed ? '#16a34a' : '#64748b', border: 'none', borderRadius: 10, padding: '11px', fontWeight: 700, fontSize: 12 }}>
                  {selectedQuote.payment_confirmed ? '✓ 입금 확인됨' : '입금 확인 처리'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
