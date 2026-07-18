import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});

// ── 타입 헬퍼 ──────────────────────────────────────
export type UserRow = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  role: string;
  team: string | null;
  team_name: string | null;
  company_id: string | null;
  company_display_name: string | null;
  super_admin: boolean;
  status: string;
  subscription_plan: string;
  subscription_status: string;
  subscription_is_pro: boolean;
  subscription_end_date: string | null;
  subscription_max_members: number;
  created_at: string;
};

export type SiteRow = {
  id: string;
  company_id: string;
  name: string;
  address: string | null;
  contract_number: string | null;
  maintenance_fee: number | null;
  elevator_count: number;
  contract_start: string | null;
  contract_end: string | null;
  contract_type: string | null;
  contract_person: string | null;
  company_name: string | null;
  phone: string | null;
  email: string | null;
  region: string | null;
  team_name: string | null;
  manager_name: string | null;
  memo: string | null;
  source: 'admin' | 'member';
  created_at: string;
};

export type FaultReportRow = {
  id: string;
  company_id: string;
  site_id: string;
  site_name: string | null;
  hogi_no: string | null;
  content: string | null;
  reporter_phone: string | null;
  extra: string | null;
  assigned_to: string | null;
  assigned_name: string | null;
  team: string | null;
  status: '접수대기' | '접수' | '처리중' | '완료';
  fault_cause: string | null;
  fault_action: string | null;
  fault_note: string | null;
  received_at: string | null;
  arrived_at: string | null;
  completed_at: string | null;
  created_at: string;
};

export type MaterialRequestRow = {
  id: string;
  company_id: string;
  team: string | null;
  site_id: string | null;
  site_name: string | null;
  hogi_no: string | null;
  material_name: string | null;
  part_number: string | null;
  spec: string | null;
  quantity: number;
  unit: string;
  reason: string | null;
  contract_type: string | null;
  requester_id: string | null;
  requester_name: string | null;
  receiver_id: string | null;
  receiver_name: string | null;
  dispatcher_id: string | null;
  dispatcher_name: string | null;
  replacer_id: string | null;
  replacer_name: string | null;
  status: '신청중' | '접수' | '자재분출' | '자재교체';
  note: string | null;
  requested_at: string | null;
  received_at: string | null;
  dispatched_at: string | null;
  replaced_at: string | null;
  created_at: string;
};

export type InspectionRow = {
  id: string;
  company_id: string;
  site_id: string | null;
  site_name: string | null;
  team_name: string | null;
  scheduled_date: string | null;
  completed_date: string | null;
  total_count: number;
  completed_count: number;
  status: '예정' | '진행중' | '완료';
  note: string | null;
  created_at: string;
};

export type CompanyRow = {
  id: string;
  name: string;
  display_name: string | null;
  owner_uid: string;
  created_at: string;
};

export type InvitationRow = {
  id: string;
  code: string;
  company_id: string | null;
  created_by: string | null;
  used: boolean;
  used_by: string | null;
  created_at: string;
};

export type TeamRow = {
  id: string;
  company_id: string;
  name: string;
  created_at: string;
};

export type QnaRow = {
  id: string;
  title: string | null;
  content: string | null;
  tag: string | null;
  brand: string | null;
  brand_label: string | null;
  model_name: string | null;
  author_name: string | null;
  author_uid: string | null;
  company_name: string | null;
  is_public: boolean;
  answer_count: number;
  created_at: string;
};

export type QnaAnswerRow = {
  id: string;
  qna_id: string;
  content: string | null;
  author_name: string | null;
  author_uid: string | null;
  created_at: string;
};

export type LeaveRequestRow = {
  id: string;
  company_id: string;
  user_id: string | null;
  user_name: string | null;
  type: string | null;
  start_date: string | null;
  end_date: string | null;
  reason: string | null;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
};

export type ElevatorRow = {
  id: string;
  site_id: string;
  company_id: string;
  hogi_no: string | null;
  type: string | null;
  status: string;
  install_date: string | null;
  inspection_date: string | null;
  created_at: string;
};
