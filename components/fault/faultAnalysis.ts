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
}

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

/** 회사 전체 완료 기록 중 에러코드가 있는 것 (최근 3000건) */
export async function fetchCodedFaults(companyId: string): Promise<FaultRow[]> {
  const { data } = await supabase.from('fault_reports')
    .select('id, created_at, completed_at, site_id, site_name, hogi_no, maker, model, error_codes, fault_cause, fault_action, assigned_name, team')
    .eq('company_id', companyId)
    .not('fault_cause', 'is', null)
    .order('created_at', { ascending: false })
    .limit(3000);
  return ((data || []) as FaultRow[]).filter((r) => (r.error_codes || []).length > 0);
}

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
  const unitMap: Record<string, { site: string; hogi: string; count: number; last: string }> = {};
  pool.forEach((r) => {
    const k = `${r.site_id}|${r.hogi_no}`;
    if (!unitMap[k]) unitMap[k] = { site: r.site_name, hogi: r.hogi_no, count: 0, last: r.created_at };
    unitMap[k].count++;
  });
  const repeatUnits = Object.values(unitMap).filter((u) => u.count > 1).sort((a, b) => b.count - a.count);

  return {
    wanted, level, pool, total: hit.length,
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

export const errorSearchUrl = (p: { maker?: string; model?: string; codes?: string[] }) => {
  const q = new URLSearchParams();
  if (p.maker) q.set('maker', p.maker);
  if (p.model) q.set('model', p.model);
  if (p.codes?.length) q.set('code', p.codes.join(','));
  return `/error-search${q.toString() ? `?${q}` : ''}`;
};
