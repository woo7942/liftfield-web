import { supabase } from '@/lib/supabase';

interface OnboardingMeta {
  name?: string;
  phone?: string;
  pending_invite_code?: string | null;
  pending_company_name?: string | null;
  agree_marketing?: boolean;
}

export async function completeOnboarding(uid: string, email: string, meta: OnboardingMeta) {
  const { data: existing } = await supabase
    .from('users')
    .select('id')
    .eq('id', uid)
    .maybeSingle();

  if (existing) return { ok: true };

  const now = new Date().toISOString();
  const inviteCode = (meta.pending_invite_code || '').trim().toUpperCase();

  if (inviteCode) {
    const { data: invRows, error: invError } = await supabase
      .from('invitations')
      .select('*')
      .eq('code', inviteCode)
      .eq('status', 'active');

    if (invError || !invRows || invRows.length === 0) {
      throw new Error('초대코드가 유효하지 않아요. 관리자에게 새 코드를 요청해주세요.');
    }
    const inv = invRows[0];
    const expireAt = inv.expire_at ? new Date(inv.expire_at) : null;
    if (expireAt && expireAt < new Date()) {
      throw new Error('초대코드가 만료됐어요. 관리자에게 새 코드를 요청해주세요.');
    }
    if ((inv.used_count || 0) >= inv.max_members) {
      throw new Error('초대 가능 인원이 초과됐어요. 관리자에게 문의해주세요.');
    }

    const { error: insertError } = await supabase.from('users').insert({
      id: uid,
      email,
      name: meta.name || '',
      phone: meta.phone || '',
      role: 'member',
      team: inv.team_name || '',
      status: 'approved',
      permissions: {},
      company_id: inv.company_id,
      company_display_name: inv.company_display_name || '',
      super_admin: false,
      subscription_plan: 'company',
      subscription_status: 'active',
      subscription: 'company',
      max_members: 1,
      joined_at: now,
      created_at: now,
      updated_at: now,
      agree_marketing: meta.agree_marketing || false,
      created_from: 'web_signup',
    });
    if (insertError) throw insertError;

    await supabase.rpc('increment_invitation_used_count', { invitation_id: inv.id });
    return { ok: true, companyId: inv.company_id, team: inv.team_name };
  }

  // 초대코드 없음 → 신규 회사 관리자로 가입
  const newCompanyId = crypto.randomUUID();
  const { error: insertError } = await supabase.from('users').insert({
    id: uid,
    email,
    name: meta.name || '',
    phone: meta.phone || '',
    role: 'admin',
    team: '',
    status: 'approved',
    permissions: {},
    company_id: newCompanyId,
    company_display_name: meta.pending_company_name || '',
    super_admin: false,
    subscription_plan: 'trial',
    subscription_status: 'active',
    subscription: 'trial',
    max_members: 5,
    joined_at: now,
    created_at: now,
    updated_at: now,
    agree_marketing: meta.agree_marketing || false,
    created_from: 'web_signup',
  });
  if (insertError) throw insertError;

  return { ok: true, companyId: newCompanyId, team: '' };
}
