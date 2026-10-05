/**
 * components/fault/faultAnalysis.ts
 * 고장처리 기록 분석 공용 로직 — 고장처리 모달(요약)과 에러검색 메뉴(전체)에서 같이 사용
 */
import { supabase } from '@/lib/supabase';
import { normalizeMaker, normalizeModel } from './MakerModelPicker';

export interface FaultRow {
  id: string; created_at: string; completed_at: string | null;
  site_id: string; site_name: string; hogi_no: string;
  maker: string | null; model: string | null; error_codes: string[] | null;
  fault_cause: string | null; fault_action: string | null; assigned_name: string | null; team?: string | null;
  /** 우리 회사 기록인지 (다른 회사 기록은 현장명·호기·담당자가 비어 있음) */
  mine?: boolean;
  /** 회사 구분용 익명 키 (몇 개 회사 기록인지 세는 용도) */
  company_key?: string | null;
}

export type FaultScope = 'all' | 'mine';

export const normCode = (c: string) => (c || '').trim().toUpperCase().replace(/\s+/g, '');
const textKey = (t: string) => t.replace(/\(부품 대기\)/g, '').replace(/[\s.,·~!\-]/g, '').toLowerCase();
export const cleanAction = (t?: string | null) => (t || '').replace(/\s*\(부품 대기\)$/, '').trim();

export function topTexts(rows: FaultRow[], field: 'fault_cause' | 'fault_action', n = 5) {
  const map: Record<string, { text: string; count: number }> = {};
  rows.forEach((r) => {
    const t = field === 'fault_action' ? cleanAction(r[field]) : (r[field] || '').trim();
    if (!t) return;
    const k = textKey(t);
    if (!map[k]) map[k] = { text: t, count: 0 };
    map[k].count++;
  });
  return Object.values(map).sort((a, b) => b.count - a.count).slice(0, n);
}

/**
 * 에러코드가 있는 완료 기록
 *  scope 'all'  → 앱을 쓰는 모든 회사 기록 (fault_records_shared 함수, 다른 회사는 익명)
 *  scope 'mine' → 우리 회사 기록만
 *  함수가 아직 설치 전이면 자동으로 우리 회사 기록으로 대체
 */
export async function fetchCodedFaults(companyId: string, scope: FaultScope = 'all'): Promise<FaultRow[]> {
  if (scope === 'all') {
    const { data, error } = await supabase.rpc('fault_records_shared', { p_codes: null, p_limit: 6000 });
    if (!error && data) return (data as FaultRow[]).filter((r) => (r.error_codes || []).length > 0);
    console.warn('[에러분석] 전체 회사 기록 실패 → 우리 회사 기록으로 대체:', error?.message);
  }
  const { data } = await supabase.from('fault_reports')
    .select('id, created_at, completed_at, site_id, site_name, hogi_no, maker, model, error_codes, fault_cause, fault_action, assigned_name, team')
    .eq('company_id', companyId)
    .not('fault_cause', 'is', null)
    .order('created_at', { ascending: false })
    .limit(3000);
  return ((data || []) as FaultRow[])
    .filter((r) => (r.error_codes || []).length > 0)
    .map((r) => ({ ...r, mine: true, company_key: 'mine' }));
}

/** 기록 묶음의 출처 — 우리 n건 · 다른 회사 m곳 k건 */
export function sourceMix(rows: FaultRow[]) {
  const mine = rows.filter((r) => r.mine !== false).length;
  const others = rows.filter((r) => r.mine === false);
  const companies = new Set(others.map((r) => r.company_key || '?')).size;
  return { mine, others: others.length, companies };
}
export const sourceText = (rows: FaultRow[]) => {
  const s = sourceMix(rows);
  if (!s.others) return `우리 회사 ${s.mine}건`;
  return `우리 ${s.mine}건 · 다른 회사 ${s.companies}곳 ${s.others}건`;
};
/** 현장·호기 표시 (다른 회사 기록은 가려짐) */
export const unitLabel = (r: { mine?: boolean; site_name?: string | null; hogi_no?: string | null }) =>
  r.mine === false ? '다른 회사 현장' : `${r.site_name || ''} ${r.hogi_no || ''}`.trim();

export function analyze(rows: FaultRow[], opt: { codes: string[]; maker?: string; model?: string; excludeId?: string; siteId?: string; hogiNo?: string; strict?: boolean }) {
  const wanted = Array.from(new Set(opt.codes.map(normCode).filter(Boolean)));
  const hit = rows.filter((r) => r.id !== opt.excludeId && (wanted.length === 0 || (r.error_codes || []).some((c) => wanted.includes(normCode(c)))));
  const mk = opt.maker || '';
  const md = normalizeModel(opt.model);
  const sameMaker = (r: FaultRow) => !!mk && normalizeMaker(r.maker) === mk;
  const sameModel = (r: FaultRow) => !!md && normalizeModel(r.model) === md;

  const t1 = hit.filter((r) => sameMaker(r) && sameModel(r));
  const t2 = hit.filter(sameMaker);
  let pool: FaultRow[]; let level: 1 | 2 | 3;
  if (opt.strict) { pool = md ? t1 : mk ? t2 : hit; level = md ? 1 : mk ? 2 : 3; }
  else if (md && t1.length >= 2) { pool = t1; level = 1; }
  else if (mk && t2.length >= 2) { pool = t2; level = 2; }
  else { pool = hit; level = 3; }

  const sameUnit = opt.siteId ? hit.filter((r) => r.site_id === opt.siteId && r.hogi_no === opt.hogiNo) : [];

  // 같은 호기 재발: 같은 현장·호기에서 2번 이상
  const unitMap: Record<string, { site: string; hogi: string; count: number; last: string; mine: boolean }> = {};
  pool.forEach((r) => {
    const k = `${r.site_id}|${r.hogi_no || ''}`;
    const mine = r.mine !== false;
    if (!unitMap[k]) unitMap[k] = { site: mine ? r.site_name : '다른 회사', hogi: mine ? r.hogi_no : '현장', count: 0, last: r.created_at, mine };
    unitMap[k].count++;
  });
  // 우리 호기를 먼저, 다른 회사 재발은 뒤에
  const repeatUnits = Object.values(unitMap).filter((u) => u.count > 1)
    .sort((a, b) => Number(b.mine) - Number(a.mine) || b.count - a.count);

  return {
    wanted, level, pool, total: hit.length, mix: sourceMix(pool),
    causes: topTexts(pool, 'fault_cause'),
    actions: topTexts(pool, 'fault_action'),
    sameUnit, repeatUnits,
  };
}

export const shortDate = (v?: string | null) => {
  if (!v) return '-';
  const d = new Date(v);
  return isNaN(d.getTime()) ? '-' : `${String(d.getFullYear()).slice(2)}.${d.getMonth() + 1}.${d.getDate()}`;
};

export const errorSearchUrl = (p: { maker?: string; model?: string; codes?: string[]; scope?: FaultScope }) => {
  const q = new URLSearchParams();
  if (p.maker) q.set('maker', p.maker);
  if (p.model) q.set('model', p.model);
  if (p.codes?.length) q.set('code', p.codes.join(','));
  if (p.scope === 'mine') q.set('scope', 'mine');
  return `/error-search${q.toString() ? `?${q}` : ''}`;
};
