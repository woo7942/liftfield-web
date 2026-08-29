import { supabase } from '@/lib/supabase';

export type TenantGateResult =
  | { ok: true; banner?: string }
  | { ok: false; message: string };

export async function checkTenantGate(
  companyId: string | null | undefined,
  isSuperAdmin?: boolean
): Promise<TenantGateResult> {
  if (isSuperAdmin) return { ok: true }; // 슈퍼 관리자(개발자)는 항상 통과
  if (!companyId) return { ok: true };

  const { data: tenant, error } = await supabase
    .from('tenants')
    .select('*')
    .eq('id', companyId)
    .maybeSingle();

  if (error || !tenant) return { ok: true };

  if (tenant.subscription_status === 'active') return { ok: true };
  if (tenant.subscription_status === 'deleted') {
    return { ok: false, message: '구독이 만료되어 서비스 이용이 중단됐어요. 문의해주세요.' };
  }

  const now = new Date();
  const trialEnd = tenant.trial_ends_at ? new Date(tenant.trial_ends_at) : null;

  if (trialEnd && now < trialEnd) {
    const daysLeft = Math.ceil((trialEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    return { ok: true, banner: `무료 체험 ${daysLeft}일 남았어요` };
  }

  return {
    ok: false,
    message: '무료 체험이 종료됐어요. 결제를 진행해주세요.\n결제 확인 전까지는 서비스 이용이 제한돼요.',
  };
}
