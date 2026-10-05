'use client';

/**
 * app/error-search/page.tsx — 에러검색 (에러집 + 우리 처리기록 한 화면)
 *  - 에러코드를 여러 개 한 번에 입력 (스페이스·쉼표·엔터로 구분)
 *  - 코드마다: 매뉴얼(error_code_book) 뜻·원인·처리 + 우리 회사 고장처리 기록(원인 %, 처리, 재발 호기, 사례)
 *  - 판단 요약: 코드별 한 줄 + 여러 코드가 함께 뜬 기록의 주 원인
 *  - 코드 없이: 이 제조사/모델에서 자주 나는 에러 TOP (눌러서 추가)
 *  - 한글을 치면 증상으로 에러집 검색 → 눌러서 코드 추가
 *  - 동양은 티케이에 포함 (칩에서 제외, 기록의 '동양'도 티케이로 집계)
 *  - 제조사·모델 칩은 error_code_book_catalog 뷰 기준 → 새 제조사 자료를 넣으면 자동으로 켜짐
 */

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import TabBar from '@/components/TabBar';
import { MAKERS, normalizeMaker, normalizeModel } from '@/components/fault/MakerModelPicker';
import { analyze, fetchCodedFaults, normCode, shortDate, cleanAction, topTexts, type FaultRow } from '@/components/fault/faultAnalysis';

interface BookRow {
  id: string; maker: string; model: string | null; code: string; code_norm: string;
  title: string | null; cause: string | null; action: string | null;
  severity: string | null; note: string | null; source: string | null; source_file: string | null; verified: boolean;
}
type Catalog = Record<string, { total: number; models: { model: string; cnt: number }[] }>;

// 다른 제조사에 포함된 제조사 (칩에서 빼고 기록도 합쳐서 집계)
const MAKER_MERGE: Record<string, string> = { '동양': '티케이' };
const PICK_MAKERS = MAKERS.filter((m) => !MAKER_MERGE[m]);
const mergeMaker = (m?: string | null) => { const n = normalizeMaker(m); return MAKER_MERGE[n] || n; };

const LS_KEY = 'lf.errsearch.v2';
const modelKey = (m?: string | null) => (m || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const sameModel = (a?: string | null, b?: string | null) => { const x = modelKey(a), y = modelKey(b); return !!x && !!y && (x.includes(y) || y.includes(x)); };
const isCodeLike = (s: string) => /^[A-Za-z0-9\-_.,\s]+$/.test(s) && /[A-Za-z0-9]/.test(s);
const splitCodes = (s: string) => s.split(/[,\s]+/).map(normCode).filter(Boolean);
// 표기 차이 흡수: F3 ↔ F3H, 035 ↔ 35, E35 ↔ 35
const variants = (c: string) => Array.from(new Set([c, c + 'H', c.replace(/^0+(?=.)/, ''), c.replace(/^E-?/, '')])).filter(Boolean);
// 매뉴얼의 설명용 줄(예: "4n · 40번대 에러는...")은 검색 결과에서 제외
const isJunk = (r: BookRow) => /^\d+N$/.test(r.code_norm);
const paras = (s?: string | null) => (s || '').split('‖').map((p) => p.replace(/\s*\/\s*/g, ' ').replace(/\s{2,}/g, ' ').trim()).filter(Boolean);
const splitTitle = (t?: string | null): [string, string] => {
  const p = (t || '').split(/\s\/\s/);
  return p.length > 1 ? [p.slice(1).join(' / ').replace(/^-\s*/, ''), p[0]] : [t || '', ''];
};
const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);

function loadLS(): { maker?: string; model?: string; recent?: string[] } {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch { return {}; }
}
function saveLS(p: object) { try { localStorage.setItem(LS_KEY, JSON.stringify({ ...loadLS(), ...p })); } catch {} }

function Sev({ r }: { r?: BookRow }) {
  if (r?.severity === '운행정지') return <span className="text-[10.5px] px-1.5 py-0.5 rounded font-semibold bg-red-50 text-red-600">운행정지</span>;
  if (r?.severity === '경고') return <span className="text-[10.5px] px-1.5 py-0.5 rounded font-semibold bg-amber-50 text-amber-700">경고</span>;
  return null;
}

function ErrorSearchInner() {
  const router = useRouter();
  const params = useSearchParams();
  const [companyId, setCompanyId] = useState('');
  const [records, setRecords] = useState<FaultRow[] | null>(null);
  const [cat, setCat] = useState<Catalog | null>(null);

  const [maker, setMaker] = useState(mergeMaker(params.get('maker')) || '');
  const [model, setModel] = useState(params.get('model') || '');
  const [codes, setCodes] = useState<string[]>(() => splitCodes(params.get('code') || ''));
  const [text, setText] = useState('');
  const [recent, setRecent] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const [book, setBook] = useState<BookRow[] | null>(null);
  const [symptom, setSymptom] = useState<BookRow[] | null>(null);

  // 로그인 · 기록 · 카탈로그
  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.push('/login'); return; }
      const { data: me } = await supabase.from('users').select('company_id').eq('id', session.user.id).single();
      if (!me?.company_id) { router.push('/'); return; }
      setCompanyId(me.company_id);
      fetchCodedFaults(me.company_id).then(setRecords);
    })();
    (async () => {
      const { data, error } = await supabase.from('error_code_book_catalog').select('maker, model, cnt');
      if (error) console.warn('[에러집] 카탈로그 실패:', error.message);
      const c: Catalog = {};
      (data || []).forEach((r: any) => {
        const mk = MAKER_MERGE[r.maker] || r.maker;
        const m = (c[mk] ||= { total: 0, models: [] });
        m.total += r.cnt; m.models.push({ model: r.model || '', cnt: r.cnt });
      });
      Object.values(c).forEach((m) => m.models.sort((a, b) => b.cnt - a.cnt));
      setCat(c);
    })();
    const s = loadLS();
    setRecent(s.recent || []);
    if (!params.get('maker') && s.maker) { setMaker(s.maker); setModel(s.model || ''); }
    else if (!params.get('maker')) setMaker('티케이');
  }, []);

  // 현장 모델명(TAC50K 등)이 넘어오면 에러집 모델로 맞춤
  useEffect(() => {
    if (!cat || !model) return;
    const list = cat[maker]?.models || [];
    if (list.some((m) => m.model === model)) return;
    setModel(list.find((m) => m.model && sameModel(m.model, model))?.model || '');
  }, [cat, maker]);

  // 우리 기록: 동양→티케이, 모델명을 에러집 모델로 정규화
  const recs = useMemo(() => {
    if (!records || !cat) return null;
    return records.map((r) => {
      const mk = mergeMaker(r.maker);
      const bm = cat[mk]?.models.find((m) => m.model && sameModel(m.model, r.model));
      return { ...r, maker: mk, model: bm ? bm.model : r.model };
    });
  }, [records, cat]);

  // 주소 유지 (FaultInsight 의 "에러검색에서 자세히" 링크와 호환)
  useEffect(() => {
    const q = new URLSearchParams();
    if (maker) q.set('maker', maker);
    if (model) q.set('model', model);
    if (codes.length) q.set('code', codes.join(','));
    window.history.replaceState(null, '', `/error-search${q.toString() ? `?${q}` : ''}`);
    if (maker) saveLS({ maker, model });
  }, [maker, model, codes.join(',')]);

  // 최근 검색 저장
  useEffect(() => {
    if (!codes.length) return;
    const key = codes.join(',');
    const next = [key, ...recent.filter((x) => x !== key)].slice(0, 6);
    setRecent(next); saveLS({ recent: next });
  }, [codes.join(',')]);

  // 매뉴얼 조회 (코드들)
  useEffect(() => {
    if (!codes.length || !maker) { setBook([]); return; }
    let alive = true; setBook(null);
    (async () => {
      const { data, error } = await supabase.from('error_code_book').select('*')
        .eq('maker', maker).in('code_norm', codes.flatMap(variants)).limit(300);
      if (!alive) return;
      if (error) console.warn('[에러집] 조회 실패:', error.message);
      setBook(((data || []) as BookRow[]).filter((r) => !isJunk(r)));
    })();
    return () => { alive = false; };
  }, [codes.join('|'), maker]);

  // 증상(한글)으로 매뉴얼 검색
  const word = text.trim();
  const symptomMode = word.length >= 2 && !isCodeLike(word);
  useEffect(() => {
    if (!symptomMode) { setSymptom(null); return; }
    let alive = true;
    const t = setTimeout(async () => {
      const w = word.replace(/[(),*%\\]/g, ' ').trim();
      let qb = supabase.from('error_code_book').select('*').eq('maker', maker)
        .or(['title', 'cause', 'action', 'note'].map((c) => `${c}.ilike.*${w}*`).join(','));
      if (model) qb = qb.eq('model', model);
      const { data } = await qb.limit(40);
      if (alive) setSymptom(((data || []) as BookRow[]).filter((r) => !isJunk(r)));
    }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [word, symptomMode, maker, model]);

  const addCodes = (s: string) => {
    const add = splitCodes(s); if (!add.length) return;
    setCodes((p) => Array.from(new Set([...p, ...add]))); setText('');
  };
  const removeCode = (c: string) => setCodes((p) => p.filter((x) => x !== c));
  const pickMaker = (m: string) => { setMaker(m); setModel(''); };

  // ── 코드별 분석 ──
  const perCode = useMemo(() => codes.map((c) => {
    const vs = variants(c);
    const hit = (book || []).filter((r) => vs.includes(r.code_norm));
    const exact = model ? hit.filter((r) => (r.model || '') === model) : hit;
    const manual = exact.length ? exact : hit;
    const a = recs ? analyze(recs, { codes: vs, maker, model }) : null;
    return { code: c, manual, fallback: !!model && !exact.length && hit.length > 0, a };
  }), [codes.join('|'), book, recs, maker, model]);

  // ── 함께 뜬 기록 (2개 이상 코드가 한 건에) ──
  const combo = useMemo(() => {
    if (!recs || codes.length < 2) return null;
    const sets = codes.map((c) => new Set(variants(c)));
    const both = (pool: FaultRow[]) => pool.filter((r) => {
      const rc = (r.error_codes || []).map(normCode);
      return sets.filter((s) => rc.some((x) => s.has(x))).length >= 2;
    });
    let level = model ? 1 : 2;
    let pool = both(recs.filter((r) => r.maker === maker && (!model || r.model === model)));
    if (pool.length < 2 && model) { pool = both(recs.filter((r) => r.maker === maker)); level = 2; }
    if (pool.length < 2) { pool = both(recs); level = 3; }
    return { pool, level, causes: topTexts(pool, 'fault_cause', 3), actions: topTexts(pool, 'fault_action', 3) };
  }, [recs, codes.join('|'), maker, model]);

  // ── 먼저 확인할 곳 (우리 기록 기준) ──
  const first = useMemo(() => {
    if (combo && combo.pool.length >= 2 && combo.causes[0])
      return { text: combo.causes[0].text, action: combo.actions[0]?.text, n: combo.causes[0].count, d: combo.pool.length, why: '함께 뜬 기록' };
    let best: { text: string; action?: string; n: number; d: number; why: string } | null = null;
    perCode.forEach(({ code, a }) => {
      const c = a?.causes[0]; if (!a || !c || a.pool.length < 2) return;
      if (!best || c.count / a.pool.length > best.n / best.d) best = { text: c.text, action: a.actions[0]?.text, n: c.count, d: a.pool.length, why: code };
    });
    return best;
  }, [combo, perCode]);

  // ── 코드 없을 때: 자주 나는 에러 ──
  const topCodes = useMemo(() => {
    if (!recs || codes.length) return [];
    const scope = recs.filter((r) => (!maker || r.maker === maker) && (!model || r.model === model));
    const cnt: Record<string, { code: string; count: number; cause: Record<string, number> }> = {};
    scope.forEach((r) => (r.error_codes || []).forEach((c) => {
      const k = normCode(c); if (!k) return;
      cnt[k] ||= { code: k, count: 0, cause: {} }; cnt[k].count++;
      const cs = (r.fault_cause || '').trim(); if (cs) cnt[k].cause[cs] = (cnt[k].cause[cs] || 0) + 1;
    }));
    return Object.values(cnt).sort((a, b) => b.count - a.count).slice(0, 12)
      .map((x) => ({ ...x, topCause: Object.entries(x.cause).sort((a, b) => b[1] - a[1])[0]?.[0] || '' }));
  }, [recs, maker, model, codes.length]);

  const hasBook = (m: string) => !!cat?.[m];
  const makerOrder = useMemo(() => [...PICK_MAKERS].sort((a, b) => Number(hasBook(b)) - Number(hasBook(a))), [cat]);
  const levelText = (lv: number) => lv === 1 ? `${maker} ${model}` : lv === 2 ? `${maker} 전체 모델` : '전체 제조사';
  const chip = (on: boolean, dim?: boolean) => `shrink-0 h-9 px-3 rounded-full text-[13px] font-semibold border inline-flex items-center gap-1.5 whitespace-nowrap transition ${
    on ? 'bg-gray-900 border-gray-900 text-white' : dim ? 'bg-white border-dashed border-gray-200 text-gray-300' : 'bg-white border-gray-200 text-gray-700 hover:border-blue-300'}`;

  return (
    <div className="min-h-screen bg-gray-50 pb-28">
      <div className="max-w-3xl mx-auto px-4 pt-6 space-y-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">에러검색</h1>
          <p className="text-sm text-gray-500">매뉴얼과 우리 회사 고장처리 기록을 함께 보고 판단해요.</p>
        </div>

        {/* 검색 조건 */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm py-4">
          <div className="flex items-center justify-between px-4 mb-2">
            <label className="text-sm font-semibold text-gray-700">제조사</label>
            {cat && <span className="text-[11.5px] text-gray-400">에러집 {Object.keys(cat).length}개사</span>}
          </div>
          <div className="flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none]">
            {makerOrder.map((m) => (
              <button key={m} type="button" onClick={() => pickMaker(m)} className={chip(maker === m, !hasBook(m))}>
                {m}
                {cat && <span className={`text-[11px] font-medium ${maker === m ? 'text-white/60' : hasBook(m) ? 'text-gray-400' : 'text-gray-300'}`}>
                  {hasBook(m) ? cat[m].total.toLocaleString() : '기록만'}</span>}
              </button>
            ))}
          </div>

          {cat?.[maker] && (
            <>
              <div className="flex items-center justify-between px-4 mt-3.5 mb-2">
                <label className="text-sm font-semibold text-gray-700">모델</label>
                <span className="text-[11.5px] text-gray-400">모르면 전체</span>
              </div>
              <div className="flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none]">
                {[{ model: '', cnt: cat[maker].total }, ...cat[maker].models].map((x) => (
                  <button key={x.model || '__all'} type="button" onClick={() => setModel(x.model)}
                    className={`${chip(model === x.model)} ${x.model ? 'font-mono text-[12.5px]' : ''}`}>
                    {x.model || '전체'}
                  </button>
                ))}
              </div>
            </>
          )}

          {/* 코드 입력 (여러 개) */}
          <div onClick={() => inputRef.current?.focus()}
            className="mx-4 mt-3.5 min-h-[52px] border border-gray-200 rounded-xl px-2 py-1.5 flex flex-wrap items-center gap-1.5 focus-within:border-blue-400 focus-within:ring-4 focus-within:ring-blue-50 cursor-text">
            <svg className="text-gray-400 ml-1.5 shrink-0" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="10.5" cy="10.5" r="6.5" /><path d="M20 20l-4.6-4.6" /></svg>
            {codes.map((c) => (
              <span key={c} className="h-9 pl-2.5 pr-1 rounded-lg bg-blue-50 text-blue-700 font-mono font-bold text-[15px] inline-flex items-center gap-0.5">
                {c}
                <button type="button" onClick={(e) => { e.stopPropagation(); removeCode(c); }} aria-label={`${c} 빼기`}
                  className="w-7 h-7 grid place-items-center rounded-md text-blue-400 hover:bg-blue-100">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
                </button>
              </span>
            ))}
            <input ref={inputRef} value={text} enterKeyHint="search" autoComplete="off" spellCheck={false}
              onChange={(e) => {
                const v = e.target.value;
                if (/[,\s]$/.test(v) && isCodeLike(v)) addCodes(v); else setText(v);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && isCodeLike(text)) { e.preventDefault(); addCodes(text); }
                if (e.key === 'Backspace' && !text && codes.length) setCodes((p) => p.slice(0, -1));
              }}
              onBlur={() => { if (isCodeLike(text)) addCodes(text); }}
              placeholder={codes.length ? '코드 추가' : '에러코드 여러 개 (예: 1007 1620) · 증상'}
              className="flex-1 min-w-[120px] h-9 px-1.5 text-[17px] font-semibold font-mono uppercase outline-none placeholder:font-sans placeholder:normal-case placeholder:text-[14.5px] placeholder:font-normal placeholder:text-gray-300" />
            {(codes.length > 0 || text) && (
              <button type="button" onClick={(e) => { e.stopPropagation(); setCodes([]); setText(''); }}
                className="h-9 px-2.5 text-xs font-semibold text-gray-400 hover:text-gray-600">지우기</button>
            )}
          </div>
          {!codes.length && !text && recent.length > 0 && (
            <div className="flex gap-1.5 items-center overflow-x-auto px-4 pt-2.5 [scrollbar-width:none]">
              <span className="shrink-0 text-[11.5px] text-gray-400 mr-0.5">최근</span>
              {recent.map((r) => (
                <button key={r} type="button" onClick={() => setCodes(r.split(','))}
                  className="shrink-0 h-[30px] px-2.5 rounded-lg bg-gray-100 font-mono text-[12.5px] font-bold text-gray-700">{r.replace(/,/g, ' + ')}</button>
              ))}
            </div>
          )}
        </div>

        {/* 증상 검색 결과 */}
        {symptomMode && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-baseline justify-between">
              <p className="font-bold text-gray-800 text-sm">‘{word}’ 증상이 있는 에러</p>
              <span className="text-xs text-gray-400">눌러서 코드 추가</span>
            </div>
            {symptom === null ? <p className="py-8 text-center text-sm text-gray-400">찾는 중...</p>
            : !cat?.[maker] ? <p className="py-8 text-center text-sm text-gray-400">{maker} 에러집은 아직 등록 전이에요.</p>
            : symptom.length === 0 ? <p className="py-8 text-center text-sm text-gray-400">일치하는 에러가 없어요.</p>
            : symptom.map((r) => (
              <button key={r.id} type="button" onClick={() => addCodes(r.code_norm)}
                className="w-full grid grid-cols-[64px_1fr_auto] gap-3 items-center text-left px-4 py-3 border-b border-gray-50 last:border-0 hover:bg-gray-50">
                <span className="font-mono font-extrabold text-blue-700">{r.code}</span>
                <span className="min-w-0 text-sm font-semibold text-gray-900 line-clamp-2">{splitTitle(r.title)[0]}</span>
                <span className="flex gap-1">{!model && r.model && <span className="text-[10.5px] px-1.5 py-0.5 rounded font-mono font-semibold bg-gray-100 text-gray-600">{r.model}</span>}<Sev r={r} /></span>
              </button>
            ))}
          </div>
        )}

        {/* 코드 없음 → 자주 나는 에러 */}
        {!codes.length && !symptomMode && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100">
              <p className="font-bold text-gray-800 text-sm">{maker}{model ? ` ${model}` : ''} 자주 나는 에러</p>
              <p className="text-xs text-gray-400">우리 회사 고장처리 기록 기준 · 누르면 추가돼요</p>
            </div>
            {!recs ? <p className="py-8 text-center text-sm text-gray-400">기록을 불러오는 중...</p>
            : topCodes.length === 0 ? <p className="py-8 text-center text-sm text-gray-400">에러코드가 입력된 기록이 아직 없어요.</p>
            : topCodes.map((c, i) => (
              <button key={c.code} type="button" onClick={() => addCodes(c.code)}
                className="w-full flex items-center gap-3 px-4 py-3 border-b border-gray-50 last:border-0 text-left hover:bg-blue-50/50">
                <span className="w-5 text-xs text-gray-400">{i + 1}</span>
                <span className="font-mono font-bold text-blue-700 w-20">{c.code}</span>
                <span className="flex-1 min-w-0 text-sm text-gray-600 truncate">{c.topCause}</span>
                <span className="text-xs text-gray-400">{c.count}건</span>
              </button>
            ))}
          </div>
        )}

        {/* ── 판단 요약 ── */}
        {codes.length > 0 && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-baseline justify-between">
              <p className="font-bold text-gray-900">판단 요약</p>
              <span className="text-xs text-gray-400">{maker}{model ? ` ${model}` : ''} · 에러 {codes.length}개</span>
            </div>

            {first && (
              <div className="mx-4 mt-3.5 rounded-xl bg-gray-900 text-white px-4 py-3.5">
                <p className="text-[11.5px] font-semibold text-white/50">먼저 확인 · 우리 기록 {first.why === '함께 뜬 기록' ? '함께 뜬 기록' : first.why} 기준</p>
                <p className="text-[16px] font-bold mt-1 leading-snug">{first.text}</p>
                <p className="text-xs text-white/60 mt-1">{first.d}건 중 {first.n}건 ({pct(first.n, first.d)}%){first.action && <> · 주로 <b className="text-white/90 font-semibold">{cleanAction(first.action)}</b></>}</p>
              </div>
            )}

            <div className="divide-y divide-gray-100">
              {perCode.map(({ code, manual, a }) => {
                const m = manual[0], c0 = a?.causes[0];
                return (
                  <a key={code} href={`#code-${code}`} className="flex gap-3 px-4 py-3 hover:bg-gray-50">
                    <span className="w-16 shrink-0 font-mono font-extrabold text-blue-700 pt-0.5">{code}</span>
                    <span className="flex-1 min-w-0 space-y-1">
                      <span className="flex items-center gap-1.5">
                        <span className="text-[11px] text-gray-400 w-12 shrink-0">매뉴얼</span>
                        <span className="text-sm text-gray-900 font-semibold truncate">{book === null ? '...' : m ? splitTitle(m.title)[0] : '에러집에 없음'}</span>
                        <Sev r={m} />
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span className="text-[11px] text-gray-400 w-12 shrink-0">우리기록</span>
                        <span className="text-sm text-gray-700 truncate">{!a ? '...' : c0 ? c0.text : '처리 기록 없음'}</span>
                        {a && c0 && <span className="shrink-0 text-xs font-bold text-blue-700">{pct(c0.count, a.pool.length)}%</span>}
                      </span>
                    </span>
                  </a>
                );
              })}
            </div>

            {combo && (
              <div className="border-t border-gray-100 px-4 py-3.5 bg-gray-50/60">
                <p className="text-xs font-semibold text-gray-500 mb-1.5">
                  함께 뜬 기록 {combo.pool.length}건
                  {combo.pool.length > 0 && <span className="font-normal text-gray-400"> · {levelText(combo.level)} 기준</span>}
                </p>
                {combo.pool.length === 0 ? <p className="text-sm text-gray-400">이 코드들이 한 번에 뜬 기록은 아직 없어요.</p> : (
                  <ul className="space-y-1">
                    {combo.causes.map((c, i) => (
                      <li key={i} className="flex gap-2 text-sm">
                        <span className="w-10 text-right shrink-0 text-xs font-bold text-blue-700 pt-0.5">{pct(c.count, combo.pool.length)}%</span>
                        <span className="text-gray-800 min-w-0 truncate">{c.text}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── 코드별 상세 ── */}
        {perCode.map((p) => <CodeCard key={p.code} {...p} model={model} bookLoading={book === null} hasBookMaker={!!cat?.[maker]} levelText={levelText} />)}
      </div>
      <TabBar active="errorsearch" />
    </div>
  );
}

function CodeCard({ code, manual, fallback, a, model, bookLoading, hasBookMaker, levelText }: {
  code: string; manual: BookRow[]; fallback: boolean; a: ReturnType<typeof analyze> | null;
  model: string; bookLoading: boolean; hasBookMaker: boolean; levelText: (lv: number) => string;
}) {
  const [pick, setPick] = useState(0);
  const [more, setMore] = useState(false);
  const [allCases, setAllCases] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const m = manual[Math.min(pick, manual.length - 1)];
  const [ko, en] = splitTitle(m?.title);
  const cause = paras(m?.cause), action = paras(m?.action);
  const long = cause.join('').length + action.join('').length > 160;
  const cases = a ? (allCases ? a.pool : a.pool.slice(0, 3)) : [];

  return (
    <div id={`code-${code}`} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden scroll-mt-4">
      {/* 머리 */}
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[28px] font-extrabold tracking-tight text-blue-700 leading-none">{m?.code || code}</span>
          {m?.model && <span className="text-[11px] px-1.5 py-0.5 rounded font-mono font-semibold bg-gray-100 text-gray-600">{m.model}</span>}
          <Sev r={m} />
        </div>
        {m && <p className="text-[15px] font-bold text-gray-900 mt-2 leading-snug">{ko}</p>}
        {m && en && <p className="text-xs text-gray-500 mt-0.5">{en}</p>}
        {manual.length > 1 && (
          <div className="flex flex-wrap gap-1 mt-2.5">
            {manual.map((x, i) => (
              <button key={x.id} type="button" onClick={() => setPick(i)}
                className={`h-7 px-2 rounded-md text-[11.5px] font-mono font-semibold border ${i === pick ? 'bg-gray-900 border-gray-900 text-white' : 'border-gray-200 text-gray-600'}`}>
                {x.model || '공통'}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 매뉴얼 */}
      <div className="px-4 pb-4">
        <p className="text-xs font-semibold text-gray-400 mb-1.5">매뉴얼</p>
        {bookLoading ? <p className="text-sm text-gray-400">불러오는 중...</p>
        : !hasBookMaker ? <p className="text-sm text-gray-400">이 제조사 에러집은 아직 등록 전이에요.</p>
        : !m ? <p className="text-sm text-gray-400">에러집에 없는 코드예요. 표기(예: 0035 / 35)를 확인해 보세요.</p>
        : (
          <div className="rounded-xl bg-gray-50 px-3.5 py-3">
            {fallback && <p className="text-[11.5px] text-blue-600 mb-1.5">{model} 자료가 없어 같은 제조사 다른 모델 기준이에요.</p>}
            <div className={!more && long ? 'line-clamp-4' : ''}>
              {cause.map((t, i) => <p key={'c' + i} className="text-sm text-gray-800 leading-relaxed"><b className="text-gray-500 font-semibold mr-1">원인</b>{t}</p>)}
              {action.map((t, i) => <p key={'a' + i} className="text-sm text-gray-800 leading-relaxed mt-1"><b className="text-gray-500 font-semibold mr-1">처리</b>{t}</p>)}
              {!cause.length && !action.length && <p className="text-sm text-gray-400">원인·처리 내용이 없는 코드예요.</p>}
            </div>
            {m.note && <p className="text-[13px] font-semibold text-red-600 mt-1.5">비고 · {m.note}</p>}
            {long && <button type="button" onClick={() => setMore(!more)} className="text-xs font-semibold text-blue-600 mt-1.5">{more ? '접기' : '전체 보기'}</button>}
          </div>
        )}
      </div>

      {/* 우리 기록 */}
      <div className="border-t border-gray-100 px-4 py-4">
        <div className="flex items-baseline justify-between mb-2">
          <p className="text-xs font-semibold text-gray-400">우리 회사 처리기록</p>
          {a && a.pool.length > 0 && <p className="text-[11.5px] text-gray-400">{levelText(a.level)} · {a.pool.length}건
            {a.level === 3 && <span> (같은 제조사 기록이 부족해 넓혔어요)</span>}</p>}
        </div>
        {!a ? <p className="text-sm text-gray-400">기록을 불러오는 중...</p>
        : a.pool.length === 0 ? <p className="text-sm text-gray-400">이 코드로 처리한 기록이 아직 없어요.</p>
        : (
          <>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <p className="text-[11.5px] font-semibold text-gray-500 mb-1.5">자주 나온 원인</p>
                <ul className="space-y-2">
                  {a.causes.slice(0, 4).map((c, i) => (
                    <li key={i}>
                      <div className="flex justify-between text-sm gap-2">
                        <span className="text-gray-800 min-w-0 truncate" title={c.text}>{c.text}</span>
                        <span className="shrink-0 text-xs font-bold text-blue-700">{pct(c.count, a.pool.length)}% · {c.count}</span>
                      </div>
                      <div className="h-1.5 bg-gray-100 rounded-full mt-1"><div className="h-full bg-blue-500 rounded-full" style={{ width: `${pct(c.count, a.pool.length)}%` }} /></div>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="text-[11.5px] font-semibold text-gray-500 mb-1.5">주로 한 처리</p>
                <ul className="space-y-2">
                  {a.actions.slice(0, 4).map((x, i) => (
                    <li key={i}>
                      <div className="flex justify-between text-sm gap-2">
                        <span className="text-gray-800 min-w-0 truncate" title={x.text}>{x.text}</span>
                        <span className="shrink-0 text-xs font-bold text-green-700">{x.count}건</span>
                      </div>
                      <div className="h-1.5 bg-gray-100 rounded-full mt-1"><div className="h-full bg-green-500 rounded-full" style={{ width: `${pct(x.count, a.pool.length)}%` }} /></div>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {a.repeatUnits.length > 0 && (
              <div className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2.5 mt-3.5">
                <p className="text-xs font-bold text-amber-800 mb-1">재발 호기</p>
                <div className="flex flex-wrap gap-1.5">
                  {a.repeatUnits.slice(0, 8).map((u) => (
                    <span key={u.site + u.hogi} className="text-xs bg-white border border-amber-200 text-amber-800 rounded-full px-2 py-0.5">{u.site} {u.hogi} · {u.count}회</span>
                  ))}
                </div>
              </div>
            )}

            <p className="text-[11.5px] font-semibold text-gray-500 mt-4 mb-1">최근 사례</p>
            <div className="-mx-4">
              {cases.map((r) => {
                const open = openId === r.id;
                return (
                  <button key={r.id} type="button" onClick={() => setOpenId(open ? null : r.id)}
                    className="w-full text-left px-4 py-2.5 border-t border-gray-50 hover:bg-gray-50">
                    <div className="flex items-center gap-2 text-xs text-gray-400">
                      <span>{shortDate(r.created_at)}</span><span>·</span>
                      <span className="text-gray-600 font-semibold truncate">{r.site_name} {r.hogi_no}</span>
                      <span className="ml-auto shrink-0">{r.model || ''}</span>
                    </div>
                    <p className={`text-sm text-gray-800 mt-0.5 ${open ? '' : 'truncate'}`}><b className="text-gray-500 font-semibold mr-1">원인</b>{r.fault_cause}</p>
                    <p className={`text-sm text-gray-600 ${open ? '' : 'truncate'}`}><b className="text-gray-500 font-semibold mr-1">처리</b>{cleanAction(r.fault_action)}</p>
                    {open && <p className="text-xs text-gray-400 mt-1">에러 {(r.error_codes || []).join(', ')}{r.assigned_name && ` · 담당 ${r.assigned_name}`}{r.team && ` · ${r.team}`}</p>}
                  </button>
                );
              })}
            </div>
            {a.pool.length > 3 && (
              <button type="button" onClick={() => setAllCases(!allCases)}
                className="w-[calc(100%+2rem)] -mx-4 -mb-4 h-11 text-[13px] font-semibold text-blue-600 border-t border-gray-100 hover:bg-blue-50/50">
                {allCases ? '접기' : `사례 ${a.pool.length - 3}건 더 보기`}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function ErrorSearchPage() {
  return <Suspense fallback={null}><ErrorSearchInner /></Suspense>;
}
