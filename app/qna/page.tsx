'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

// ─── 타입 ───
interface QnaItem {
  id: string;
  title: string;
  content: string;
  tag: string;
  brand: string;
  brandLabel: string;
  modelName: string;
  customBrandName: string;
  authorUid: string;
  authorName: string;
  companyId: string;
  companyName: string;
  isPublic: boolean;
  answerCount: number;
  createdAt: string;
}

interface Answer {
  id: string;
  qnaId: string;
  content: string;
  authorName: string;
  authorUid: string;
  companyName: string;
  createdAt: string;
}

// ─── 제조사 ───
const BRANDS = [
  { id: 'otis',       label: 'OTIS',     fullLabel: 'OTIS (오티스)',       icon: '🔵', color: 'bg-blue-100 text-blue-700 border-blue-200'     },
  { id: 'hyundai',    label: '현대',     fullLabel: '현대엘리베이터',       icon: '🟢', color: 'bg-green-100 text-green-700 border-green-200'   },
  { id: 'tke',        label: 'TKE',      fullLabel: 'TKE (티센크루프)',     icon: '🟡', color: 'bg-yellow-100 text-yellow-700 border-yellow-200' },
  { id: 'mitsubishi', label: '미쓰비시', fullLabel: '미쓰비시 엘리베이터',  icon: '🔴', color: 'bg-red-100 text-red-700 border-red-200'         },
  { id: 'schindler',  label: '쉰들러',   fullLabel: '쉰들러',               icon: '🟠', color: 'bg-orange-100 text-orange-700 border-orange-200' },
  { id: 'kone',       label: 'KONE',     fullLabel: 'KONE (코네)',          icon: '🔷', color: 'bg-indigo-100 text-indigo-700 border-indigo-200' },
  { id: 'other',      label: '그 외',    fullLabel: '그 외 기종',           icon: '⚙️', color: 'bg-gray-100 text-gray-600 border-gray-200'      },
];

// ─── 태그 ───
const TAGS = ['전체','도어 고장','센서 오류','전기 계통','로프/권상기','점검','부품 교체','기타'];

const TAG_COLORS: Record<string, string> = {
  '도어 고장':   'bg-red-100 text-red-700',
  '센서 오류':   'bg-orange-100 text-orange-700',
  '전기 계통':   'bg-yellow-100 text-yellow-700',
  '로프/권상기': 'bg-blue-100 text-blue-700',
  '점검':        'bg-green-100 text-green-700',
  '부품 교체':   'bg-purple-100 text-purple-700',
  '기타':        'bg-gray-100 text-gray-600',
};

const toDateStr = (v: string | null | undefined) => {
  if (!v) return '';
  const d = new Date(v);
  return `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
};

const getBrand = (id: string) => BRANDS.find(b => b.id === id) || BRANDS[BRANDS.length - 1];

// ─── 메인 컴포넌트 ───
export default function QnaPage() {
  const router = useRouter();

  const [userInfo, setUserInfo]     = useState<any>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [qnaList, setQnaList]       = useState<QnaItem[]>([]);
  const [answers, setAnswers]       = useState<Answer[]>([]);
  const [selected, setSelected]     = useState<QnaItem | null>(null);

  // 필터
  const [activeBrand, setActiveBrand]   = useState('all');
  const [activeTag, setActiveTag]       = useState('전체');
  const [filterMode, setFilterMode]     = useState<'all' | 'myCompany'>('all');
  const [searchText, setSearchText]     = useState('');

  // 모달 / 폼
  const [showWrite, setShowWrite] = useState(false);
  const [form, setForm] = useState({
    title: '', content: '', tag: '기타',
    brand: '', modelName: '', customBrandName: '', isPublic: true,
  });
  const [answerText, setAnswerText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const answerChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // ─── 인증 ───
  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.push('/login'); return; }

      const { data: userData, error } = await supabase
        .from('users')
        .select('name, role, company_id, company_display_name, super_admin, subscription')
        .eq('id', session.user.id)
        .single();

      if (error || !userData) { router.push('/login'); return; }

      const plan = userData.subscription?.plan;
      const isPro       = plan === 'pro' || plan === 'company';
      const isSuperAdmin = userData.super_admin === true;
      if (!isPro && !isSuperAdmin) { router.push('/'); return; }

      setUserInfo({
        ...userData,
        uid:        session.user.id,
        companyId:  userData.company_id || '',
        companyDisplayName: userData.company_display_name || '',
      });
      setAuthLoading(false);
    };

    init();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => { if (!session) router.push('/login'); }
    );
    return () => subscription.unsubscribe();
  }, []);

  // ─── Q&A 목록 로드 ───
  useEffect(() => {
    if (!userInfo) return;
    const loadQna = async () => {
      const { data, error } = await supabase
        .from('qna')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) { console.error(error); return; }
      setQnaList(
        (data || []).map((d: any) => ({
          id:              d.id,
          title:           d.title,
          content:         d.content,
          tag:             d.tag,
          brand:           d.brand,
          brandLabel:      d.brand_label,
          modelName:       d.model_name     || '',
          customBrandName: d.custom_brand_name || '',
          authorUid:       d.author_uid,
          authorName:      d.author_name,
          companyId:       d.company_id,
          companyName:     d.company_name,
          isPublic:        d.is_public,
          answerCount:     d.answer_count   || 0,
          createdAt:       d.created_at,
        }))
      );
    };
    loadQna();
  }, [userInfo]);

  // ─── 답변 로드 + 실시간 구독 ───
  useEffect(() => {
    // 기존 채널 정리
    if (answerChannelRef.current) {
      supabase.removeChannel(answerChannelRef.current);
      answerChannelRef.current = null;
    }
    if (!selected) { setAnswers([]); return; }

    const loadAnswers = async () => {
      const { data, error } = await supabase
        .from('qna_answers')
        .select('*')
        .eq('qna_id', selected.id)
        .order('created_at', { ascending: true });

      if (error) { console.error(error); return; }
      setAnswers(
        (data || []).map((d: any) => ({
          id:          d.id,
          qnaId:       d.qna_id,
          content:     d.content,
          authorName:  d.author_name,
          authorUid:   d.author_uid,
          companyName: d.company_name,
          createdAt:   d.created_at,
        }))
      );
    };
    loadAnswers();

    // Realtime 구독 (답변 추가 시 자동 반영)
    const channel = supabase
      .channel(`qna_answers_${selected.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'qna_answers', filter: `qna_id=eq.${selected.id}` },
        (payload) => {
          const d = payload.new as any;
          setAnswers(prev => [
            ...prev,
            {
              id:          d.id,
              qnaId:       d.qna_id,
              content:     d.content,
              authorName:  d.author_name,
              authorUid:   d.author_uid,
              companyName: d.company_name,
              createdAt:   d.created_at,
            },
          ]);
        }
      )
      .subscribe();

    answerChannelRef.current = channel;
    return () => { supabase.removeChannel(channel); };
  }, [selected]);

  const isSuperAdmin  = userInfo?.super_admin === true;
  const myCompanyId   = userInfo?.companyId   || '';
  const myCompanyName = userInfo?.company_display_name || userInfo?.name || '';

  // ─── 필터링 ───
  const filtered = qnaList.filter(item => {
    if (!item.isPublic && item.companyId !== myCompanyId && !isSuperAdmin) return false;
    if (filterMode === 'myCompany' && item.companyId !== myCompanyId) return false;
    if (activeBrand !== 'all' && item.brand !== activeBrand) return false;
    if (activeTag !== '전체' && item.tag !== activeTag) return false;
    if (searchText.trim()) {
      const s = searchText.toLowerCase();
      return (
        item.title.toLowerCase().includes(s)           ||
        item.content.toLowerCase().includes(s)         ||
        item.modelName?.toLowerCase().includes(s)      ||
        item.customBrandName?.toLowerCase().includes(s)
      );
    }
    return true;
  });

  // ─── 질문 등록 ───
  const submitQuestion = async () => {
    if (!form.title.trim() || !form.content.trim() || !form.brand) return;
    if (form.brand === 'other' && !form.customBrandName.trim()) return;
    setSubmitting(true);
    try {
      const brandInfo = getBrand(form.brand);
      const now = new Date().toISOString();

      const { data: newQna, error } = await supabase
        .from('qna')
        .insert({
          title:             form.title.trim(),
          content:           form.content.trim(),
          tag:               form.tag,
          brand:             form.brand,
          brand_label:       form.brand === 'other' ? form.customBrandName.trim() : brandInfo.label,
          model_name:        form.modelName.trim(),
          custom_brand_name: form.brand === 'other' ? form.customBrandName.trim() : '',
          is_public:         form.isPublic,
          author_uid:        userInfo.uid,
          author_name:       userInfo.name || '',
          company_id:        myCompanyId,
          company_name:      myCompanyName,
          answer_count:      0,
          created_at:        now,
        })
        .select()
        .single();

      if (error) throw error;

      // 로컬 목록 prepend
      setQnaList(prev => [{
        id:              newQna.id,
        title:           newQna.title,
        content:         newQna.content,
        tag:             newQna.tag,
        brand:           newQna.brand,
        brandLabel:      newQna.brand_label,
        modelName:       newQna.model_name     || '',
        customBrandName: newQna.custom_brand_name || '',
        authorUid:       newQna.author_uid,
        authorName:      newQna.author_name,
        companyId:       newQna.company_id,
        companyName:     newQna.company_name,
        isPublic:        newQna.is_public,
        answerCount:     0,
        createdAt:       newQna.created_at,
      }, ...prev]);

      setForm({ title: '', content: '', tag: '기타', brand: '', modelName: '', customBrandName: '', isPublic: true });
      setShowWrite(false);
    } catch (e: any) {
      alert(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  // ─── 답변 등록 ───
  const submitAnswer = async () => {
    if (!answerText.trim() || !selected) return;
    setSubmitting(true);
    try {
      const now = new Date().toISOString();

      const { error: ansError } = await supabase
        .from('qna_answers')
        .insert({
          qna_id:      selected.id,
          content:     answerText.trim(),
          author_uid:  userInfo.uid,
          author_name: userInfo.name || '',
          company_name: myCompanyName,
          created_at:  now,
        });

      if (ansError) throw ansError;

      // answer_count 증가
      await supabase.rpc('increment_answer_count', { qna_id: selected.id });

      // 로컬 qnaList answerCount 업데이트
      setQnaList(prev =>
        prev.map(q => q.id === selected.id ? { ...q, answerCount: q.answerCount + 1 } : q)
      );
      setSelected(prev => prev ? { ...prev, answerCount: prev.answerCount + 1 } : prev);
      setAnswerText('');
    } catch (e: any) {
      alert(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  // ─── 삭제 ───
  const deleteQna = async (id: string) => {
    if (!isSuperAdmin) return;
    if (!confirm('정말 삭제하시겠습니까?')) return;

    const { error } = await supabase.from('qna').delete().eq('id', id);
    if (error) { alert(error.message); return; }

    setQnaList(prev => prev.filter(q => q.id !== id));
    if (selected?.id === id) setSelected(null);
  };

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="w-10 h-10 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-gray-400 text-sm">로딩 중...</p>
        </div>
      </div>
    );
  }

  // ─── 브랜드 뱃지 ───
  const BrandBadge = ({ item }: { item: QnaItem }) => {
    const brand = getBrand(item.brand);
    const label = item.brand === 'other'
      ? `⚙️ ${item.customBrandName || '그 외'}`
      : `${brand.icon} ${brand.label}`;
    const modelStr = item.modelName ? ` · ${item.modelName}` : '';
    return (
      <span className={`text-xs font-bold px-2.5 py-1 rounded-full border ${brand.color}`}>
        {label}{modelStr}
      </span>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50">

      {/* 헤더 */}
      <header className="sticky top-0 z-50 bg-white border-b border-gray-100 shadow-sm">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => selected ? setSelected(null) : router.push('/')}
              className="text-gray-400 hover:text-gray-700 transition-colors text-xl leading-none"
            >←</button>
            <span className="font-black text-gray-900 text-sm">🔩 승강기 기술 Q&A</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400 hidden sm:block">
              {userInfo?.name}
              {myCompanyName && myCompanyName !== userInfo?.name && <> · {myCompanyName}</>}
            </span>
            <button
              onClick={() => setShowWrite(true)}
              className="bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-bold px-4 py-2 rounded-xl transition-colors"
            >
              + 질문하기
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 py-6">

        {/* ── 목록 화면 ── */}
        {!selected && (
          <>
            {/* 필터 패널 */}
            <div className="bg-white rounded-2xl p-4 mb-4 shadow-sm space-y-4">
              <input
                type="text"
                value={searchText}
                onChange={e => setSearchText(e.target.value)}
                placeholder="🔍  제목, 내용, 기종명 검색..."
                className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-400"
              />

              {/* 제조사 필터 */}
              <div>
                <p className="text-xs font-bold text-gray-400 mb-2">제조사</p>
                <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
                  <button
                    onClick={() => setActiveBrand('all')}
                    className={`shrink-0 px-4 py-2 rounded-xl text-xs font-bold border transition-all ${
                      activeBrand === 'all'
                        ? 'bg-gray-900 text-white border-gray-900'
                        : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    🌐 전체
                  </button>
                  {BRANDS.map(brand => (
                    <button
                      key={brand.id}
                      onClick={() => setActiveBrand(brand.id)}
                      className={`shrink-0 px-4 py-2 rounded-xl text-xs font-bold border transition-all ${
                        activeBrand === brand.id
                          ? brand.color + ' border-current'
                          : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      {brand.icon} {brand.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* 회사 필터 + 태그 필터 */}
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="flex gap-2">
                  <button
                    onClick={() => setFilterMode('all')}
                    className={`flex-1 sm:flex-none px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                      filterMode === 'all' ? 'bg-emerald-500 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                    }`}
                  >
                    🌐 전체
                  </button>
                  <button
                    onClick={() => setFilterMode('myCompany')}
                    className={`flex-1 sm:flex-none px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                      filterMode === 'myCompany' ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                    }`}
                  >
                    🏢 우리 회사만
                  </button>
                </div>
                <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide flex-1">
                  {TAGS.map(tag => (
                    <button
                      key={tag}
                      onClick={() => setActiveTag(tag)}
                      className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-bold transition-all ${
                        activeTag === tag ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                      }`}
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* 결과 수 */}
            <div className="px-1 mb-3">
              <p className="text-xs text-gray-400">
                {activeBrand !== 'all' && `${getBrand(activeBrand).icon} ${getBrand(activeBrand).fullLabel} · `}
                {filtered.length}개의 질문
              </p>
            </div>

            {/* 질문 목록 */}
            {filtered.length === 0 ? (
              <div className="bg-white rounded-2xl p-16 text-center shadow-sm">
                <div className="text-5xl mb-4">💬</div>
                <p className="text-gray-400 font-semibold mb-1">질문이 없습니다</p>
                <p className="text-gray-300 text-sm mb-6">첫 번째 질문을 남겨보세요!</p>
                <button
                  onClick={() => setShowWrite(true)}
                  className="bg-emerald-500 hover:bg-emerald-600 text-white font-bold px-6 py-3 rounded-xl text-sm transition-colors"
                >
                  + 질문하기
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {filtered.map(item => (
                  <button
                    key={item.id}
                    onClick={() => setSelected(item)}
                    className="w-full bg-white hover:bg-emerald-50 border border-transparent hover:border-emerald-200 rounded-2xl p-5 text-left transition-all shadow-sm hover:shadow-md group"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-2">
                          <BrandBadge item={item} />
                          <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${TAG_COLORS[item.tag] || 'bg-gray-100 text-gray-600'}`}>
                            {item.tag}
                          </span>
                          {!item.isPublic && (
                            <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-600">
                              🔒 우리 회사만
                            </span>
                          )}
                          {item.authorUid === userInfo?.uid && (
                            <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                              내 질문
                            </span>
                          )}
                        </div>
                        <h3 className="font-bold text-gray-900 text-sm leading-snug line-clamp-2 group-hover:text-emerald-700 transition-colors mb-1">
                          {item.title}
                        </h3>
                        <p className="text-xs text-gray-400 line-clamp-1">{item.content}</p>
                      </div>
                      <div className="text-right shrink-0 space-y-1">
                        <div className={`text-sm font-black ${item.answerCount > 0 ? 'text-emerald-600' : 'text-gray-300'}`}>
                          💬 {item.answerCount}
                        </div>
                        <div className="text-xs text-gray-400">{item.authorName}</div>
                        <div className="text-xs text-gray-300">{toDateStr(item.createdAt).slice(0, 10)}</div>
                      </div>
                    </div>
                    {isSuperAdmin && (
                      <div className="mt-3 flex justify-end">
                        <button
                          onClick={e => { e.stopPropagation(); deleteQna(item.id); }}
                          className="text-xs text-red-400 hover:text-red-600 transition-colors"
                        >
                          🗑 삭제
                        </button>
                      </div>
                    )}
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {/* ── 상세 화면 ── */}
        {selected && (
          <div className="max-w-3xl mx-auto">
            {/* 질문 카드 */}
            <div className="bg-white rounded-2xl p-6 shadow-sm mb-4">
              <div className="flex items-center gap-2 flex-wrap mb-3">
                <BrandBadge item={selected} />
                <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${TAG_COLORS[selected.tag] || 'bg-gray-100 text-gray-600'}`}>
                  {selected.tag}
                </span>
                {!selected.isPublic && (
                  <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-red-100 text-red-600">
                    🔒 우리 회사만
                  </span>
                )}
              </div>
              <h2 className="text-xl font-black text-gray-900 mb-3 leading-snug">{selected.title}</h2>
              <p className="text-gray-600 text-sm leading-relaxed whitespace-pre-wrap bg-gray-50 rounded-xl p-4 mb-4">
                {selected.content}
              </p>
              <div className="flex items-center justify-between text-xs text-gray-400">
                <span>✍️ {selected.authorName} · {selected.companyName}</span>
                <span>{toDateStr(selected.createdAt)}</span>
              </div>
            </div>

            {/* 답변 목록 */}
            <div className="mb-4">
              <h3 className="text-sm font-black text-gray-700 mb-3 px-1">
                💬 답변 {answers.length}개
              </h3>
              {answers.length === 0 ? (
                <div className="bg-white rounded-2xl p-8 text-center shadow-sm">
                  <div className="text-3xl mb-2">🤔</div>
                  <p className="text-gray-400 text-sm">아직 답변이 없습니다. 첫 번째 답변을 남겨보세요!</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {answers.map((ans, idx) => (
                    <div
                      key={ans.id}
                      className={`rounded-2xl p-5 shadow-sm ${
                        ans.authorUid === userInfo?.uid
                          ? 'bg-emerald-50 border border-emerald-100'
                          : 'bg-white border border-gray-100'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3 mb-3">
                        <div className="flex items-center gap-2">
                          <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-black text-white shrink-0 ${
                            ans.authorUid === userInfo?.uid ? 'bg-emerald-500' : 'bg-blue-400'
                          }`}>
                            {idx + 1}
                          </div>
                          <div>
                            <span className="text-sm font-bold text-gray-800">{ans.authorName}</span>
                            {ans.companyName && (
                              <span className="ml-1.5 text-xs text-gray-400">· {ans.companyName}</span>
                            )}
                            {ans.authorUid === userInfo?.uid && (
                              <span className="ml-1.5 text-xs bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full font-bold">
                                내 답변
                              </span>
                            )}
                          </div>
                        </div>
                        <span className="text-xs text-gray-400 shrink-0">{toDateStr(ans.createdAt)}</span>
                      </div>
                      <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap pl-9">
                        {ans.content}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 답변 입력 */}
            <div className="bg-white rounded-2xl p-5 shadow-sm">
              <h3 className="text-sm font-black text-gray-700 mb-3">✍️ 답변 작성</h3>
              <textarea
                value={answerText}
                onChange={e => setAnswerText(e.target.value)}
                placeholder="고장 대응 경험이나 해결 방법을 공유해주세요..."
                rows={4}
                className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-400 resize-none leading-relaxed"
              />
              <div className="flex justify-between items-center mt-3">
                <span className="text-xs text-gray-400">{myCompanyName} · {userInfo?.name}</span>
                <button
                  onClick={submitAnswer}
                  disabled={!answerText.trim() || submitting}
                  className="bg-emerald-500 hover:bg-emerald-600 disabled:bg-gray-200 disabled:text-gray-400 text-white font-bold px-5 py-2.5 rounded-xl text-sm transition-colors"
                >
                  {submitting ? '등록 중...' : '답변 등록'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── 질문 작성 모달 ── */}
      {showWrite && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-lg font-black text-gray-900">🔩 기술 질문하기</h3>
                <button
                  onClick={() => setShowWrite(false)}
                  className="text-gray-400 hover:text-gray-700 text-2xl leading-none"
                >×</button>
              </div>

              <div className="space-y-5">
                {/* 제조사 선택 */}
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-2">
                    제조사 선택 <span className="text-red-400">*</span>
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {BRANDS.map(brand => (
                      <button
                        key={brand.id}
                        type="button"
                        onClick={() => setForm(f => ({ ...f, brand: brand.id, customBrandName: '' }))}
                        className={`flex items-center gap-2 px-3 py-3 rounded-xl border-2 text-sm font-bold transition-all text-left ${
                          form.brand === brand.id
                            ? brand.color + ' border-current'
                            : 'border-gray-100 bg-gray-50 text-gray-500 hover:border-gray-200'
                        }`}
                      >
                        <span className="text-lg">{brand.icon}</span>
                        <span className="text-xs leading-tight">{brand.fullLabel}</span>
                        {form.brand === brand.id && <span className="ml-auto text-xs font-black">✓</span>}
                      </button>
                    ))}
                  </div>
                  {form.brand === 'other' && (
                    <div className="mt-3">
                      <input
                        type="text"
                        value={form.customBrandName}
                        onChange={e => setForm(f => ({ ...f, customBrandName: e.target.value }))}
                        placeholder="제조사명 입력 (예: 금성엘리베이터, 예스코 등)"
                        className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-400"
                      />
                    </div>
                  )}
                </div>

                {/* 기종/모델명 */}
                {form.brand && (
                  <div>
                    <label className="block text-xs font-bold text-gray-700 mb-1.5">
                      기종 / 모델명
                      <span className="ml-1.5 text-gray-400 font-normal">(선택사항)</span>
                    </label>
                    <input
                      type="text"
                      value={form.modelName}
                      onChange={e => setForm(f => ({ ...f, modelName: e.target.value }))}
                      placeholder={
                        form.brand === 'otis'       ? '예) Gen2, GeN2 Plus, 506 NCE...' :
                        form.brand === 'hyundai'    ? '예) H시리즈, G시리즈, HMR...' :
                        form.brand === 'tke'        ? '예) Evolution, Synergy...' :
                        form.brand === 'mitsubishi' ? '예) GPS-III, LEHY-II...' :
                        form.brand === 'schindler'  ? '예) 3300, 5500...' :
                        form.brand === 'kone'       ? '예) MonoSpace, EcoDisc...' :
                        '예) 모델명 또는 기종명 입력'
                      }
                      className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-400"
                    />
                  </div>
                )}

                {/* 태그 */}
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-2">태그 선택</label>
                  <div className="flex flex-wrap gap-2">
                    {TAGS.filter(t => t !== '전체').map(tag => (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => setForm(f => ({ ...f, tag }))}
                        className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all ${
                          form.tag === tag
                            ? TAG_COLORS[tag] + ' ring-2 ring-offset-1 ring-current'
                            : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                        }`}
                      >
                        {tag}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 제목 */}
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1.5">
                    제목 <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    value={form.title}
                    onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                    placeholder="예) 도어가 중간에서 멈추고 다시 열려요"
                    className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-400"
                  />
                </div>

                {/* 내용 */}
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1.5">
                    상세 내용 <span className="text-red-400">*</span>
                  </label>
                  <textarea
                    value={form.content}
                    onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
                    placeholder="증상, 발생 상황, 시도해본 방법 등 자세히 적어주세요"
                    rows={5}
                    className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-400 resize-none"
                  />
                </div>

                {/* 공개 범위 */}
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-2">공개 범위</label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setForm(f => ({ ...f, isPublic: true }))}
                      className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-all ${
                        form.isPublic ? 'bg-emerald-500 text-white' : 'bg-gray-100 text-gray-500'
                      }`}
                    >
                      🌐 전체 공개
                    </button>
                    <button
                      type="button"
                      onClick={() => setForm(f => ({ ...f, isPublic: false }))}
                      className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-all ${
                        !form.isPublic ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-500'
                      }`}
                    >
                      🔒 우리 회사만
                    </button>
                  </div>
                  <p className="text-xs text-gray-400 mt-1.5">
                    {form.isPublic
                      ? '모든 Pro 이상 구독자가 볼 수 있습니다'
                      : `${myCompanyName} 소속 멤버만 볼 수 있습니다`}
                  </p>
                </div>
              </div>

              {/* 등록 버튼 */}
              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => setShowWrite(false)}
                  className="flex-1 py-3 rounded-2xl border border-gray-200 text-gray-600 font-bold text-sm"
                >
                  취소
                </button>
                <button
                  onClick={submitQuestion}
                  disabled={
                    !form.title.trim() || !form.content.trim() || !form.brand ||
                    (form.brand === 'other' && !form.customBrandName.trim()) || submitting
                  }
                  className="flex-[2] bg-emerald-500 hover:bg-emerald-600 disabled:bg-gray-200 disabled:text-gray-400 text-white font-black py-3 rounded-2xl text-sm transition-colors"
                >
                  {submitting ? '등록 중...' : '질문 등록하기'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
