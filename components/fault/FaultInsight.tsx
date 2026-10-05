'use client';

/**
 * components/fault/FaultInsight.tsx
 * 고장처리 모달 안 — 에러 분석 요약 (보기 전용)
 * 자세한 검색은 [에러검색] 메뉴(/error-search)에서
 */

import { useEffect, useMemo, useState } from 'react';
import { analyze, fetchCodedFaults, shortDate, errorSearchUrl, sourceText, type FaultRow } from './faultAnalysis';
import { normalizeModel } from './MakerModelPicker';

// 같은 화면에서 모달을 여러 번 열어도 한 번만 불러오기
const cache: Record<string, { at: number; rows: FaultRow[] }> = {};

export default function FaultInsight({
  companyId, maker, model, codes, currentId, siteId, hogiNo,
}: {
  companyId?: string; maker: string; model: string; codes: string[];
  currentId?: string; siteId?: string; hogiNo?: string;
}) {
  const [rows, setRows] = useState<FaultRow[] | null>(null);
  const hasCode = codes.some((c) => c.trim());

  useEffect(() => {
    if (!companyId || !hasCode) return;
    const c = cache[companyId];
    if (c && Date.now() - c.at < 5 * 60e3) { setRows(c.rows); return; }
    let alive = true;
    fetchCodedFaults(companyId, 'all').then((r) => { cache[companyId] = { at: Date.now(), rows: r }; if (alive) setRows(r); });
    return () => { alive = false; };
  }, [companyId, hasCode]);

  const a = useMemo(() => rows && analyze(rows, { codes, maker, model, excludeId: currentId, siteId, hogiNo }),
    [rows, codes.join('|'), maker, model, currentId, siteId, hogiNo]);

  if (!hasCode) {
    return (
      <div className="rounded-xl border border-dashed border-gray-200 px-3 py-3 text-xs text-gray-400">
        🔎 에러코드를 입력하면 전체 회사 고장처리 기록을 분석해 보여드려요.
      </div>
    );
  }

  const levelText = a?.level === 1 ? `${maker} ${normalizeModel(model)}` : a?.level === 2 ? `${maker} 전체 모델` : '전체 제조사';

  return (
    <div className="rounded-xl border border-blue-100 bg-blue-50/60 overflow-hidden">
      <div className="px-3 py-2.5 flex items-center justify-between gap-2 border-b border-blue-100">
        <p className="text-sm font-bold text-blue-800">🔎 에러 분석 <span className="font-medium text-blue-500">{a?.wanted.join(', ')}</span></p>
        <a href={errorSearchUrl({ maker, model, codes })} target="_blank" rel="noreferrer"
          className="text-[11px] font-semibold text-blue-600 hover:underline">에러검색에서 자세히 ↗</a>
      </div>

      {!a ? (
        <p className="px-3 py-3 text-xs text-gray-500">예전 기록을 분석하는 중이에요...</p>
      ) : a.total === 0 ? (
        <p className="px-3 py-3 text-xs text-gray-500">이 에러코드로 처리한 기록이 아직 없어요. 이번 기록이 다음 분석에 쓰여요.</p>
      ) : (
        <div className="px-3 py-3 space-y-3 text-sm">
          <p className="text-xs text-gray-500">기준: <b className="text-gray-700">{levelText}</b> · {a.pool.length}건 분석 <span className="text-gray-400">({sourceText(a.pool)})</span></p>

          {a.sameUnit.length > 0 && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 px-2.5 py-2 text-xs text-amber-800">
              ⚠️ <b>이 호기 재발 {a.sameUnit.length}회</b> · 마지막 {shortDate(a.sameUnit[0].created_at)}
              {a.sameUnit[0].fault_cause && <> — {a.sameUnit[0].fault_cause}</>}
            </div>
          )}

          <div>
            <p className="text-xs font-semibold text-gray-600 mb-1">자주 나온 원인</p>
            <ul className="space-y-1">
              {a.causes.slice(0, 3).map((c, i) => (
                <li key={i} className="flex items-center gap-2">
                  <span className="shrink-0 w-10 text-right text-xs font-bold text-blue-700">{Math.round((c.count / a.pool.length) * 100)}%</span>
                  <span className="flex-1 min-w-0 text-gray-800 truncate" title={c.text}>{c.text}</span>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="text-xs font-semibold text-gray-600 mb-1">주로 한 처리</p>
            <ul className="space-y-1">
              {a.actions.slice(0, 3).map((x, i) => (
                <li key={i} className="flex items-center gap-2">
                  <span className="shrink-0 w-10 text-right text-xs font-bold text-green-700">{x.count}건</span>
                  <span className="flex-1 min-w-0 text-gray-800 truncate" title={x.text}>{x.text}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
