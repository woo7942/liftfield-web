'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

export default function CompanyInfoPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [denied, setDenied] = useState(false);
  const [companyId, setCompanyId] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [form, setForm] = useState({
    company_name: '',
    ceo_name: '',
    biz_no: '',
    address: '',
    phone: '',
    logo_image_url: '',
    stamp_image_url: '',
  });

  const [logoUploading, setLogoUploading] = useState(false);
  const [stampUploading, setStampUploading] = useState(false);

  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) { router.push('/login'); return; }

      const { data: userData } = await supabase
        .from('users')
        .select('role, super_admin, company_id')
        .eq('id', session.user.id)
        .single();

      const isAdmin = userData?.role === 'admin' || userData?.super_admin === true;
      if (!isAdmin || !userData?.company_id) {
        setDenied(true);
        setLoading(false);
        return;
      }

      setCompanyId(userData.company_id);

      const { data: companyData } = await supabase
        .from('companies')
        .select('company_name, ceo_name, biz_no, address, phone, logo_image_url, stamp_image_url')
        .eq('id', userData.company_id)
        .single();

      if (companyData) {
        setForm({
          company_name: companyData.company_name || '',
          ceo_name: companyData.ceo_name || '',
          biz_no: companyData.biz_no || '',
          address: companyData.address || '',
          phone: companyData.phone || '',
          logo_image_url: companyData.logo_image_url || '',
          stamp_image_url: companyData.stamp_image_url || '',
        });
      }
      setLoading(false);
    };
    init();
  }, [router]);

  const uploadImage = async (file: File, kind: 'logo' | 'stamp') => {
    const setUploading = kind === 'logo' ? setLogoUploading : setStampUploading;
    setUploading(true);
    setError('');
    try {
      const ext = file.name.split('.').pop();
      const path = `${companyId}/${kind}-${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from('company-assets')
        .upload(path, file, { upsert: true });
      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from('company-assets')
        .getPublicUrl(path);

      setForm(prev => ({
        ...prev,
        [kind === 'logo' ? 'logo_image_url' : 'stamp_image_url']: urlData.publicUrl,
      }));
    } catch (e: any) {
      console.error(e);
      setError('이미지 업로드에 실패했어요. 다시 시도해주세요.');
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async () => {
    if (!form.company_name.trim()) {
      setError('회사명을 입력해주세요.');
      return;
    }
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const { error: updateError } = await supabase
        .from('companies')
        .update({
          company_name: form.company_name.trim(),
          ceo_name: form.ceo_name.trim(),
          biz_no: form.biz_no.trim(),
          address: form.address.trim(),
          phone: form.phone.trim(),
          logo_image_url: form.logo_image_url,
          stamp_image_url: form.stamp_image_url,
          updated_at: new Date().toISOString(),
        })
        .eq('id', companyId);

      if (updateError) throw updateError;
      setSuccess('저장됐어요.');
    } catch (e: any) {
      console.error(e);
      setError('저장 중 오류가 발생했어요.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-gray-400 text-sm">확인 중...</p>
      </div>
    );
  }

  if (denied) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="text-4xl mb-3">🔒</div>
          <p className="text-gray-600 font-bold mb-1">접근 권한이 없어요</p>
          <p className="text-gray-400 text-sm mb-4">운영자만 회사정보를 관리할 수 있어요.</p>
          <button
            onClick={() => router.push('/')}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-bold"
          >
            홈으로
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-lg mx-auto bg-white rounded-2xl shadow-sm p-6 space-y-5">
        <div className="flex items-center gap-2 mb-2">
          <button onClick={() => router.push('/team')} className="text-gray-400 text-sm">← 뒤로</button>
        </div>

        <h1 className="text-xl font-black text-gray-800">🏢 회사정보 관리</h1>
        <p className="text-sm text-gray-400">
          여기에 등록한 정보와 로고·직인이 견적서에 자동으로 들어가요.
        </p>

        <div>
          <label className="block text-sm font-bold text-gray-700 mb-1.5">회사명 *</label>
          <input
            value={form.company_name}
            onChange={e => setForm({ ...form, company_name: e.target.value })}
            className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm"
            placeholder="예: (주)한국엘리베이터"
          />
        </div>

        <div>
          <label className="block text-sm font-bold text-gray-700 mb-1.5">대표자명</label>
          <input
            value={form.ceo_name}
            onChange={e => setForm({ ...form, ceo_name: e.target.value })}
            className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm"
            placeholder="예: 홍길동"
          />
        </div>

        <div>
          <label className="block text-sm font-bold text-gray-700 mb-1.5">사업자등록번호</label>
          <input
            value={form.biz_no}
            onChange={e => setForm({ ...form, biz_no: e.target.value })}
            className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm"
            placeholder="000-00-00000"
          />
        </div>

        <div>
          <label className="block text-sm font-bold text-gray-700 mb-1.5">주소</label>
          <input
            value={form.address}
            onChange={e => setForm({ ...form, address: e.target.value })}
            className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm"
            placeholder="회사 주소"
          />
        </div>

        <div>
          <label className="block text-sm font-bold text-gray-700 mb-1.5">전화번호</label>
          <input
            value={form.phone}
            onChange={e => setForm({ ...form, phone: e.target.value })}
            className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm"
            placeholder="02-000-0000"
          />
        </div>

        <div>
          <label className="block text-sm font-bold text-gray-700 mb-1.5">로고 이미지</label>
          {form.logo_image_url && (
            <img src={form.logo_image_url} alt="로고" className="h-16 mb-2 object-contain border rounded-lg p-1" />
          )}
          <input
            type="file"
            accept="image/*"
            onChange={e => e.target.files?.[0] && uploadImage(e.target.files[0], 'logo')}
            className="text-sm"
          />
          {logoUploading && <p className="text-xs text-blue-500 mt-1">업로드 중...</p>}
        </div>

        <div>
          <label className="block text-sm font-bold text-gray-700 mb-1.5">직인 이미지</label>
          {form.stamp_image_url && (
            <img src={form.stamp_image_url} alt="직인" className="h-16 mb-2 object-contain border rounded-lg p-1" />
          )}
          <input
            type="file"
            accept="image/*"
            onChange={e => e.target.files?.[0] && uploadImage(e.target.files[0], 'stamp')}
            className="text-sm"
          />
          {stampUploading && <p className="text-xs text-blue-500 mt-1">업로드 중...</p>}
        </div>

        {error && <p className="text-red-500 text-sm text-center">{error}</p>}
        {success && <p className="text-green-600 text-sm text-center">{success}</p>}

        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full bg-blue-600 text-white py-3 rounded-xl font-black disabled:opacity-40"
        >
          {saving ? '저장 중...' : '저장하기'}
        </button>
      </div>
    </div>
  );
}
