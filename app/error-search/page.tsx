'use client';

/**
 * app/error-search/page.tsx — 에러검색
 * 제조사 + 모델 + 에러코드로 우리 회사 고장처리 기록을 검색·분석
 *  - 자주 나온 원인 / 처리 방법 / 재발 호기 / 전체 사례
 *  - 에러코드 없이 제조사·모델만 고르면 그 모델에서 자주 나는 에러 TOP
 */

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { supabase } from '@/lib/supabase';
import TabBar from '@/components/TabBar';
import MakerModelPicker, { normalizeMaker, normalizeModel } from '@/components/fault/MakerModelPicker';
import { analyze, fetchCodedFaults, normCode, shortDate, cleanAction, type FaultRow } from '@/components/fault/faultAnalysis';

function ErrorSearchInner() {
  const router = useRouter();
  const params = useSearchParams();
  const [companyId, setCompanyId] = useState('');
  const [rows, setRows] = useState<FaultRow[] | null>(null);

  const [maker, setMaker] = useState(params.get('maker') || '');
  const [model, setModel] = useState(params.get('model') || '');
  const [codeText, setCodeText] = useState(params.get('code') || '');
  const [strict, setStrict] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.push('/login'); return; }
      const { data: me } = await supabase.from('users').select('company_id').eq('id', session.user.id).single();
      if (!me?.company_id) { router.push('/'); return; }
      setCompanyId(me.company_id);
      setRows(await fetchCodedFaults(me.company_id));
    })();
  }, []);

  const codes = useMemo(() => codeText.split(/[,\s]+/).map(normCode).filter(Boolean), [codeText]);

  // 주소에 검색 조건 유지 (새로고침·공유용)
  useEffect(() => {
    const q = new URLSearchParams();
    if (maker) q.set('maker', maker);
    if (model) q.set('model', model);
    if (codes.length) q.set('code', codes.join(','));
    window.history.replaceState(null, '', `/error-search${q.toString() ? `?${q}` : ''}`);
  }, [maker, model, codes.join(',')]);

  const result = useMemo(() => rows && codes.length > 0 ? analyze(rows, { codes, maker, model, strict }) : null,
    [rows, codes.join('|'), maker, model, strict]);

  // 에러코드 없이: 이 제조사/모델에서 자주 나는 에러
  const topCodes = useMemo(() => {
    if (!rows || codes.length) return [];
    const md = normalizeModel(model);
    const scope = rows.filter((r) => (!maker || normalizeMaker(r.maker) === maker) && (!md || normalizeModel(r.model) === md));
    const cnt: Record<string, { code: string; count: number; cause: Record<string, number> }> = {};
    scope.forEach((r) => (r.error_codes || []).forEach((c) => {
      const k = normCode(c); if (!k) return;
      cnt[k] = cnt[k] || { code: k, count: 0, cause: {} };
      cnt[k].count++;
      const cs = (r.fault_cause || '').trim(); if (cs) cnt[k].cause[cs] = (cnt[k].cause[cs] || 0) + 1;
    }));
    return Object.values(cnt).sort((a, b) => b.count - a.count).slice(0, 15)
      .map((x) => ({ ...x, topCause: Object.entries(x.cause).sort((a, b) => b[1] - a[1])[0]?.[0] || '' }));
  }, [rows, maker, model, codes.length]);

  const levelText = result?.level === 1 ? `${maker} ${normalizeModel(model)}` : result?.level === 2 ? `${maker} 전체 모델` : '전체 제조사';
  const cases = result ? (showAll ? result.pool : result.pool.slice(0, 20)) : [];

  return (
    <div className="min-h-screen bg-gray-50 pb-28">
      <div className="max-w-3xl mx-auto px-4 pt-6 space-y-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">에러검색</h1>
          <p className="text-sm text-gray-500">제조사 · 모델 · 에러코드로 우리 회사 고장처리 기록을 찾아 분석해요.</p>
        </div>

        {/* 검색 조건 */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-4">
          <MakerModelPicker maker={maker} model={model} companyId={companyId}
            onChange={(v) => { setMaker(v.maker); setModel(v.model); }} />
          <div>
            <label className="text-sm font-semibold text-gray-700 mb-1 block">에러코드</label>
            <input value={codeText} onChange={(e) => setCodeText(e.target.value)}
              placeholder="예: E21  (여러 개는 쉼표로)"
              className="w-full px-3 py-3 border rounded-xl text-base font-mono uppercase outline-none focus:border-blue-400" />
          </div>
          {maker && codes.length > 0 && (
            <label className="flex items-center gap-2 text-xs text-gray-500">
              <input type="checkbox" checked={strict} onChange={(e) => setStrict(e.target.checked)} />
              선택한 {model ? '모델' : '제조사'} 기록만 보기 (기록이 적어도 범위를 넓히지 않음)
            </label>
          )}
        </div>

        {!rows ? (
          <p className="text-center text-sm text-gray-400 py-10">고장처리 기록을 불러오는 중...</p>
        ) : codes.length === 0 ? (
          /* 에러코드 미입력 → 자주 나는 에러 */
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100">
              <p className="font-bold text-gray-800 text-sm">
                {maker ? `${maker}${model ? ' ' + normalizeModel(model) : ''}` : '우리 회사'} 자주 나는 에러
              </p>
              <p className="text-xs text-gray-400">누르면 그 에러를 분석해요 · 기록 {rows.length.toLocaleString()}건 기준</p>
            </div>
            {topCodes.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-gray-400">에러코드가 입력된 기록이 아직 없어요.</p>
            ) : topCodes.map((c, i) => (
              <button key={c.code} onClick={() => setCodeText(c.code)}
                className="w-full flex items-center gap-3 px-4 py-3 border-b border-gray-50 text-left hover:bg-blue-50/50">
                <span className="w-5 text-xs text-gray-400">{i + 1}</span>
                <span className="font-mono font-bold text-blue-700 w-20">{c.code}</span>
                <span className="flex-1 min-w-0 text-sm text-gray-600 truncate">{c.topCause}</span>
                <span className="text-xs text-gray-400">{c.count}건</span>
              </button>
            ))}
          </div>
        ) : !result || result.total === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-10 text-center">
            <p className="text-3xl mb-2">🔍</p>
            <p className="text-sm text-gray-500"><b className="font-mono">{codes.join(', ')}</b> 로 처리한 기록이 아직 없어요.</p>
          </div>
        ) : (
          <>
            {/* 요약 */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-4">
              <div className="flex items-baseline justify-between gap-2 flex-wrap">
                <p className="font-bold text-gray-800">
                  <span className="font-mono text-blue-700">{codes.join(', ')}</span> 분석
                </p>
                <p className="text-xs text-gray-500">기준 <b className="text-gray-700">{levelText}</b> · {result.pool.length}건
                  {result.level === 3 && maker && !strict && <span className="text-gray-400"> (같은 {model ? '모델' : '제조사'} 기록이 부족해 범위를 넓혔어요)</span>}
                </p>
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <p className="text-xs font-semibold text-gray-500 mb-2">자주 나온 원인</p>
                  <ul className="space-y-2">
                    {result.causes.map((c, i) => {
                      const pct = Math.round((c.count / result.pool.length) * 100);
                      return (
                        <li key={i}>
                          <div className="flex justify-between text-sm gap-2">
                            <span className="text-gray-800 min-w-0 truncate" title={c.text}>{c.text}</span>
                            <span className="shrink-0 text-xs font-bold text-blue-700">{pct}% · {c.count}건</span>
                          </div>
                          <div className="h-1.5 bg-gray-100 rounded-full mt-1"><div className="h-full bg-blue-500 rounded-full" style={{ width: `${pct}%` }} /></div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
                <div>
                  <p className="text-xs font-semibold text-gray-500 mb-2">주로 한 처리</p>
                  <ul className="space-y-2">
                    {result.actions.map((x, i) => {
                      const pct = Math.round((x.count / result.pool.length) * 100);
                      return (
                        <li key={i}>
                          <div className="flex justify-between text-sm gap-2">
                            <span className="text-gray-800 min-w-0 truncate" title={x.text}>{x.text}</span>
                            <span className="shrink-0 text-xs font-bold text-green-700">{x.count}건</span>
                          </div>
                          <div className="h-1.5 bg-gray-100 rounded-full mt-1"><div className="h-full bg-green-500 rounded-full" style={{ width: `${pct}%` }} /></div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </div>

              {result.repeatUnits.length > 0 && (
                <div className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2.5">
                  <p className="text-xs font-bold text-amber-800 mb-1">⚠️ 재발 호기</p>
                  <div className="flex flex-wrap gap-1.5">
                    {result.repeatUnits.slice(0, 10).map((u) => (
                      <span key={u.site + u.hogi} className="text-xs bg-white border border-amber-200 text-amber-800 rounded-full px-2 py-0.5">
                        {u.site} {u.hogi} · {u.count}회
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* 사례 */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              <p className="px-4 py-3 border-b border-gray-100 font-bold text-gray-800 text-sm">처리 사례 {result.pool.length}건</p>
              {cases.map((r) => {
                const open = openId === r.id;
                return (
                  <button key={r.id} onClick={() => setOpenId(open ? null : r.id)}
                    className="w-full text-left px-4 py-3 border-b border-gray-50 hover:bg-gray-50">
                    <div className="flex items-center gap-2 text-xs text-gray-400">
                      <span>{shortDate(r.created_at)}</span>
                      <span>·</span>
                      <span className="text-gray-600 font-semibold truncate">{r.site_name} {r.hogi_no}</span>
                      <span className="ml-auto shrink-0">{[normalizeMaker(r.maker), r.model].filter(Boolean).join(' ') || '제조사 미입력'}</span>
                    </div>
                    <p className={`text-sm text-gray-800 mt-1 ${open ? '' : 'truncate'}`}><b className="text-gray-500 font-semibold mr-1">원인</b>{r.fault_cause}</p>
                    <p className={`text-sm text-gray-600 ${open ? '' : 'truncate'}`}><b className="text-gray-500 font-semibold mr-1">처리</b>{cleanAction(r.fault_action)}</p>
                    {open && (
                      <p className="text-xs text-gray-400 mt-1">
                        에러 {(r.error_codes || []).join(', ')}{r.assigned_name && ` · 담당 ${r.assigned_name}`}{r.team && ` · ${r.team}`}
                      </p>
                    )}
                  </button>
                );
              })}
              {!showAll && result.pool.length > 20 && (
                <button onClick={() => setShowAll(true)} className="w-full py-3 text-sm font-semibold text-blue-600 hover:bg-blue-50">
                  {result.pool.length - 20}건 더 보기
                </button>
              )}
            </div>
          </>
        )}
      </div>
      <TabBar active="errorsearch" />
    </div>
  );
}

export default function ErrorSearchPage() {
  return <Suspense fallback={null}><ErrorSearchInner /></Suspense>;
}
