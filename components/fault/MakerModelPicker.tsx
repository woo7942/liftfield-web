'use client';

/**
 * components/fault/MakerModelPicker.tsx
 * 고장 처리 모달 — 제조회사 / 승강기 모델 선택
 *  - 승강기 정보(elevators.manufacturer_name, elvtr_model)가 있으면 자동으로 채워짐
 *  - 제조사는 칩으로 고르고, 모델은 같은 제조사로 예전에 입력된 모델을 추천
 * 저장 컬럼: fault_reports.maker / fault_reports.model
 */

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';

export const MAKERS = ['현대', '티케이', '오티스', '미쓰비시', '쉰들러', '코네', '히타치', '후지텍', '동양', '기타'] as const;

// 승강기 DB 제조사명(예: "현대엘리베이터(주)", "TK엘리베이터코리아") → 표준 이름
export function normalizeMaker(raw?: string | null): string {
  const s = (raw || '').replace(/\s|\(주\)|㈜|주식회사/g, '').toLowerCase();
  if (!s) return '';
  if (/현대|hyundai/.test(s)) return '현대';
  if (/티케이|tk|티센|thyssen/.test(s)) return '티케이';
  if (/오티스|otis|lg|엘지|시그마|sigma/.test(s)) return '오티스';
  if (/미쓰비시|미츠비시|mitsubishi/.test(s)) return '미쓰비시';
  if (/쉰들러|schindler/.test(s)) return '쉰들러';
  if (/코네|kone/.test(s)) return '코네';
  if (/히타치|hitachi/.test(s)) return '히타치';
  if (/후지텍|fujitec/.test(s)) return '후지텍';
  if (/동양|dongyang/.test(s)) return '동양';
  return '기타';
}

export const normalizeModel = (m?: string | null) => (m || '').trim().toUpperCase().replace(/\s+/g, ' ');

export default function MakerModelPicker({
  maker, model, onChange, companyId, autoFilled,
}: {
  maker: string;
  model: string;
  onChange: (v: { maker: string; model: string }) => void;
  companyId?: string;
  autoFilled?: boolean;
}) {
  const [models, setModels] = useState<string[]>([]);
  const [focus, setFocus] = useState(false);

  // 같은 제조사로 예전에 입력된 모델 목록 (고장 기록 + 승강기 대장)
  useEffect(() => {
    if (!maker || !companyId) { setModels([]); return; }
    let alive = true;
    (async () => {
      const { data } = await supabase.from('fault_reports')
        .select('model').eq('company_id', companyId).eq('maker', maker)
        .not('model', 'is', null).limit(500);
      if (!alive) return;
      const cnt: Record<string, number> = {};
      (data || []).forEach((r: any) => { const m = normalizeModel(r.model); if (m) cnt[m] = (cnt[m] || 0) + 1; });
      setModels(Object.entries(cnt).sort((a, b) => b[1] - a[1]).map(([m]) => m));
    })();
    return () => { alive = false; };
  }, [maker, companyId]);

  const suggestions = useMemo(() => {
    const q = normalizeModel(model);
    return models.filter((m) => !q || (m.includes(q) && m !== q)).slice(0, 8);
  }, [models, model]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-sm font-semibold text-gray-700">제조회사 · 모델</label>
        {autoFilled && <span className="text-[11px] text-blue-500">승강기 정보에서 자동 입력됨</span>}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {MAKERS.map((m) => {
          const on = maker === m;
          return (
            <button key={m} type="button"
              onClick={() => onChange({ maker: on ? '' : m, model: on ? model : (m === maker ? model : '') })}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition ${
                on ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-gray-200 text-gray-600 hover:border-blue-300'}`}>
              {m}
            </button>
          );
        })}
      </div>

      <div className="relative">
        <input
          value={model}
          onChange={(e) => onChange({ maker, model: e.target.value })}
          onFocus={() => setFocus(true)}
          onBlur={() => setTimeout(() => setFocus(false), 150)}
          placeholder={maker ? `${maker} 모델명 (예: ${maker === '현대' ? 'YZER, LUXEN' : maker === '오티스' ? 'GEN2, GEN3' : '모델명'})` : '제조회사를 먼저 고르세요'}
          disabled={!maker}
          className="w-full px-3 py-2.5 border rounded-xl text-sm outline-none focus:border-blue-400 disabled:bg-gray-50"
        />
        {focus && suggestions.length > 0 && (
          <div className="absolute z-20 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden">
            {suggestions.map((s) => (
              <button key={s} type="button" onMouseDown={() => onChange({ maker, model: s })}
                className="block w-full text-left px-3 py-2 text-sm hover:bg-blue-50">
                {s}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
