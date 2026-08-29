import { supabase } from '@/lib/supabase';

export type TenantGateResult =
  | { ok: true; banner?: string }
  | { ok: false; message: string };

export async function checkTenantGate(
  companyId: string | null | undefined,
  isSuperAdmin?: boolean
): Promise<TenantGateResult> {
  if (isSuperAdmin) return { ok: true };
  if (!companyId || companyId === '__system__') return { ok: true };

  const { data, error } = await supabase.rpc('get_company_subscription', {
    p_company_id: companyId,
  });

  if (error || !data || data.length === 0) return { ok: true }; // 정보 없으면 일단 통과 (기존 고객 보호)

  const admin = data[0];
  const status = admin.subscription_status;
  const plan = admin.subscription_plan;
  const endDate = admin.subscription_end_date ? new Date(admin.subscription_end_date) : null;
  const deletionAt = admin.data_deletion_at ? new Date(admin.data_deletion_at) : null;
  const now = new Date();

  if (status === 'cancelled') {
    return { ok: false, message: '이 회사는 이용이 정지됐어요. 관리자에게 문의해주세요.' };
  }

  const isExpired = endDate ? endDate < now : false;

  if (status === 'active' && !isExpired) {
    if (plan === 'trial' && endDate) {
      const daysLeft = Math.ceil((endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      if (daysLeft <= 5) {
        return { ok: true, banner: `무료 체험 ${daysLeft}일 남았어요. 곧 만료돼요!` };
      }
    }
    return { ok: true };
  }

  // 체험/구독이 만료된 상태
  if (deletionAt) {
    const daysToDelete = Math.ceil((deletionAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    if (daysToDelete > 0) {
      return {
        ok: false,
        message: `체험 기간이 종료됐어요. 결제를 진행해주세요.\n결제하지 않으면 ${daysToDelete}일 후 모든 데이터가 삭제될 예정이에요.`,
      };
    }
    return {
      ok: false,
      message: '체험 기간이 종료되고 데이터 삭제 예정일이 지났어요. 곧 데이터가 정리될 예정입니다. 문의해주세요.',
    };
  }

  return {
    ok: false,
    message: '체험 기간이 종료됐어요. 결제를 진행해주세요. 관리자에게 문의하시면 안내해드릴게요.',
  };
}
