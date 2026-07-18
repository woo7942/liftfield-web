-- ================================================================
-- LiftField Supabase Schema
-- Firebase → Supabase 마이그레이션
-- ================================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ================================================================
-- 1. companies (회사)
-- ================================================================
CREATE TABLE IF NOT EXISTS companies (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  name          TEXT NOT NULL,
  display_name  TEXT,
  owner_uid     TEXT NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ================================================================
-- 2. users (사용자)
-- ================================================================
CREATE TABLE IF NOT EXISTS users (
  id                    TEXT PRIMARY KEY,  -- Supabase auth.users.id (UUID)
  name                  TEXT,
  email                 TEXT UNIQUE,
  phone                 TEXT,
  role                  TEXT DEFAULT 'member',  -- 'admin' | 'member'
  team                  TEXT,
  team_name             TEXT,
  company_id            TEXT REFERENCES companies(id) ON DELETE SET NULL,
  company_display_name  TEXT,
  super_admin           BOOLEAN DEFAULT FALSE,
  status                TEXT DEFAULT 'active',
  created_from          TEXT,
  subscription_plan     TEXT DEFAULT 'trial',
  subscription_status   TEXT DEFAULT 'inactive',
  subscription_is_pro   BOOLEAN DEFAULT FALSE,
  subscription_end_date TIMESTAMPTZ,
  subscription_start_date TIMESTAMPTZ,
  subscription_max_members INT DEFAULT 5,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

-- ================================================================
-- 3. invitations (초대코드)
-- ================================================================
CREATE TABLE IF NOT EXISTS invitations (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  code        TEXT UNIQUE NOT NULL,
  company_id  TEXT REFERENCES companies(id) ON DELETE CASCADE,
  created_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  used        BOOLEAN DEFAULT FALSE,
  used_by     TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ================================================================
-- 4. teams (팀)
-- ================================================================
CREATE TABLE IF NOT EXISTS teams (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  company_id  TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ================================================================
-- 5. sites (현장)
-- ================================================================
CREATE TABLE IF NOT EXISTS sites (
  id                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  company_id        TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  address           TEXT,
  contract_number   TEXT,
  maintenance_fee   NUMERIC,
  elevator_count    INT DEFAULT 0,
  contract_start    TEXT,
  contract_end      TEXT,
  contract_type     TEXT,
  contract_person   TEXT,
  company_name      TEXT,
  phone             TEXT,
  email             TEXT,
  region            TEXT,
  team_name         TEXT,
  manager_name      TEXT,
  memo              TEXT,
  source            TEXT DEFAULT 'admin',  -- 'admin' | 'member'
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ================================================================
-- 6. elevators (승강기)
-- ================================================================
CREATE TABLE IF NOT EXISTS elevators (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  site_id         TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  company_id      TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  hogi_no         TEXT,
  type            TEXT,
  status          TEXT DEFAULT '정상',
  install_date    TEXT,
  inspection_date TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ================================================================
-- 7. fault_reports (고장접수)
-- ================================================================
CREATE TABLE IF NOT EXISTS fault_reports (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  company_id      TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  site_id         TEXT NOT NULL,
  site_name       TEXT,
  hogi_no         TEXT,
  content         TEXT,
  reporter_phone  TEXT,
  extra           TEXT,
  assigned_to     TEXT,
  assigned_name   TEXT,
  team            TEXT,
  status          TEXT DEFAULT '접수대기',  -- '접수대기'|'접수'|'처리중'|'완료'
  fault_cause     TEXT,
  fault_action    TEXT,
  fault_note      TEXT,
  received_at     TIMESTAMPTZ,
  arrived_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ================================================================
-- 8. material_requests (자재신청)
-- ================================================================
CREATE TABLE IF NOT EXISTS material_requests (
  id               TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  company_id       TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  team             TEXT,
  site_id          TEXT,
  site_name        TEXT,
  hogi_no          TEXT,
  material_name    TEXT,
  part_number      TEXT,
  spec             TEXT,
  quantity         INT DEFAULT 1,
  unit             TEXT DEFAULT '개',
  reason           TEXT,
  contract_type    TEXT,
  requester_id     TEXT,
  requester_name   TEXT,
  receiver_id      TEXT,
  receiver_name    TEXT,
  dispatcher_id    TEXT,
  dispatcher_name  TEXT,
  replacer_id      TEXT,
  replacer_name    TEXT,
  status           TEXT DEFAULT '신청중',  -- '신청중'|'접수'|'자재분출'|'자재교체'
  note             TEXT,
  requested_at     TIMESTAMPTZ,
  received_at      TIMESTAMPTZ,
  dispatched_at    TIMESTAMPTZ,
  replaced_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ================================================================
-- 9. inspections (점검 일정)
-- ================================================================
CREATE TABLE IF NOT EXISTS inspections (
  id               TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  company_id       TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  site_id          TEXT,
  site_name        TEXT,
  team_name        TEXT,
  scheduled_date   TEXT,
  completed_date   TEXT,
  total_count      INT DEFAULT 0,
  completed_count  INT DEFAULT 0,
  status           TEXT DEFAULT '예정',  -- '예정'|'진행중'|'완료'
  note             TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ================================================================
-- 10. safety_inspections (안전검사 / 검사지적)
-- ================================================================
CREATE TABLE IF NOT EXISTS safety_inspections (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  company_id    TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  site_id       TEXT,
  site_name     TEXT,
  elevator_id   TEXT,
  hogi_no       TEXT,
  inspector     TEXT,
  result        TEXT,
  note          TEXT,
  inspected_at  TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ================================================================
-- 11. chat_rooms (채팅방)
-- ================================================================
CREATE TABLE IF NOT EXISTS chat_rooms (
  id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  company_id   TEXT REFERENCES companies(id) ON DELETE CASCADE,
  name         TEXT,
  members      TEXT[] DEFAULT '{}',
  last_message TEXT,
  last_at      TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ================================================================
-- 12. chat_messages (채팅 메시지)
-- ================================================================
CREATE TABLE IF NOT EXISTS chat_messages (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  room_id     TEXT NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
  sender_id   TEXT,
  sender_name TEXT,
  content     TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ================================================================
-- 13. notices (공지사항)
-- ================================================================
CREATE TABLE IF NOT EXISTS notices (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  company_id  TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  title       TEXT,
  content     TEXT,
  author_id   TEXT,
  author_name TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ================================================================
-- 14. leave_requests (연차 신청)
-- ================================================================
CREATE TABLE IF NOT EXISTS leave_requests (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  company_id  TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id     TEXT REFERENCES users(id) ON DELETE CASCADE,
  user_name   TEXT,
  type        TEXT,
  start_date  TEXT,
  end_date    TEXT,
  reason      TEXT,
  status      TEXT DEFAULT 'pending',  -- 'pending'|'approved'|'rejected'
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ================================================================
-- 15. qna (Q&A)
-- ================================================================
CREATE TABLE IF NOT EXISTS qna (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  title         TEXT,
  content       TEXT,
  tag           TEXT,
  brand         TEXT,
  brand_label   TEXT,
  model_name    TEXT,
  author_name   TEXT,
  author_uid    TEXT REFERENCES users(id) ON DELETE SET NULL,
  company_name  TEXT,
  is_public     BOOLEAN DEFAULT TRUE,
  answer_count  INT DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ================================================================
-- 16. qna_answers (Q&A 답변)
-- ================================================================
CREATE TABLE IF NOT EXISTS qna_answers (
  id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  qna_id       TEXT NOT NULL REFERENCES qna(id) ON DELETE CASCADE,
  content      TEXT,
  author_name  TEXT,
  author_uid   TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ================================================================
-- 17. inspection_groups (검사 그룹)
-- ================================================================
CREATE TABLE IF NOT EXISTS inspection_groups (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  company_id  TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name        TEXT,
  items       JSONB DEFAULT '[]',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ================================================================
-- 18. inspection_schedules (검사 일정)
-- ================================================================
CREATE TABLE IF NOT EXISTS inspection_schedules (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  company_id    TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  site_id       TEXT,
  site_name     TEXT,
  group_id      TEXT,
  scheduled_at  TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ,
  status        TEXT DEFAULT '예정',
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ================================================================
-- 19. material_usages (자재 사용 이력)
-- ================================================================
CREATE TABLE IF NOT EXISTS material_usages (
  id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  company_id   TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  site_id      TEXT,
  site_name    TEXT,
  material_name TEXT,
  quantity     INT,
  used_by      TEXT,
  used_at      TIMESTAMPTZ DEFAULT NOW(),
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ================================================================
-- INDEXES
-- ================================================================
CREATE INDEX IF NOT EXISTS idx_users_company_id      ON users(company_id);
CREATE INDEX IF NOT EXISTS idx_users_email           ON users(email);
CREATE INDEX IF NOT EXISTS idx_sites_company_id      ON sites(company_id);
CREATE INDEX IF NOT EXISTS idx_sites_source          ON sites(source);
CREATE INDEX IF NOT EXISTS idx_elevators_site_id     ON elevators(site_id);
CREATE INDEX IF NOT EXISTS idx_elevators_company_id  ON elevators(company_id);
CREATE INDEX IF NOT EXISTS idx_fault_reports_company ON fault_reports(company_id);
CREATE INDEX IF NOT EXISTS idx_fault_reports_status  ON fault_reports(status);
CREATE INDEX IF NOT EXISTS idx_material_requests_co  ON material_requests(company_id);
CREATE INDEX IF NOT EXISTS idx_inspections_company   ON inspections(company_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_room    ON chat_messages(room_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_at      ON chat_messages(created_at);
CREATE INDEX IF NOT EXISTS idx_qna_author            ON qna(author_uid);
CREATE INDEX IF NOT EXISTS idx_leave_requests_co     ON leave_requests(company_id);
CREATE INDEX IF NOT EXISTS idx_leave_requests_user   ON leave_requests(user_id);

-- ================================================================
-- ROW LEVEL SECURITY (RLS)
-- ================================================================

-- Enable RLS on all tables
ALTER TABLE companies          ENABLE ROW LEVEL SECURITY;
ALTER TABLE users              ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitations        ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams              ENABLE ROW LEVEL SECURITY;
ALTER TABLE sites              ENABLE ROW LEVEL SECURITY;
ALTER TABLE elevators          ENABLE ROW LEVEL SECURITY;
ALTER TABLE fault_reports      ENABLE ROW LEVEL SECURITY;
ALTER TABLE material_requests  ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspections        ENABLE ROW LEVEL SECURITY;
ALTER TABLE safety_inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_rooms         ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages      ENABLE ROW LEVEL SECURITY;
ALTER TABLE notices            ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_requests     ENABLE ROW LEVEL SECURITY;
ALTER TABLE qna                ENABLE ROW LEVEL SECURITY;
ALTER TABLE qna_answers        ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspection_groups  ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspection_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE material_usages    ENABLE ROW LEVEL SECURITY;

-- ── users RLS ──
CREATE POLICY "users_select_own" ON users
  FOR SELECT USING (id = auth.uid()::TEXT OR
    company_id IN (SELECT company_id FROM users WHERE id = auth.uid()::TEXT));

CREATE POLICY "users_insert_own" ON users
  FOR INSERT WITH CHECK (id = auth.uid()::TEXT);

CREATE POLICY "users_update_own" ON users
  FOR UPDATE USING (
    id = auth.uid()::TEXT OR
    company_id IN (
      SELECT company_id FROM users
      WHERE id = auth.uid()::TEXT AND role = 'admin'
    )
  );

CREATE POLICY "users_delete_admin" ON users
  FOR DELETE USING (
    company_id IN (
      SELECT company_id FROM users
      WHERE id = auth.uid()::TEXT AND role = 'admin'
    )
  );

-- ── companies RLS ──
CREATE POLICY "companies_select" ON companies
  FOR SELECT USING (
    id IN (SELECT company_id FROM users WHERE id = auth.uid()::TEXT)
  );

CREATE POLICY "companies_insert" ON companies
  FOR INSERT WITH CHECK (owner_uid = auth.uid()::TEXT);

CREATE POLICY "companies_update" ON companies
  FOR UPDATE USING (
    id IN (SELECT company_id FROM users WHERE id = auth.uid()::TEXT AND role = 'admin')
  );

-- ── 공통: 같은 company 접근 허용 헬퍼 함수 ──
CREATE OR REPLACE FUNCTION my_company_id() RETURNS TEXT AS $$
  SELECT company_id FROM users WHERE id = auth.uid()::TEXT LIMIT 1;
$$ LANGUAGE SQL STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION is_admin() RETURNS BOOLEAN AS $$
  SELECT COALESCE((SELECT role = 'admin' OR super_admin = TRUE
    FROM users WHERE id = auth.uid()::TEXT LIMIT 1), FALSE);
$$ LANGUAGE SQL STABLE SECURITY DEFINER;

-- ── sites RLS ──
CREATE POLICY "sites_company_access" ON sites
  FOR ALL USING (company_id = my_company_id());

-- ── elevators RLS ──
CREATE POLICY "elevators_company_access" ON elevators
  FOR ALL USING (company_id = my_company_id());

-- ── fault_reports RLS ──
CREATE POLICY "fault_reports_company_access" ON fault_reports
  FOR ALL USING (company_id = my_company_id());

-- ── material_requests RLS ──
CREATE POLICY "material_requests_company_access" ON material_requests
  FOR ALL USING (company_id = my_company_id());

-- ── inspections RLS ──
CREATE POLICY "inspections_company_access" ON inspections
  FOR ALL USING (company_id = my_company_id());

-- ── safety_inspections RLS ──
CREATE POLICY "safety_inspections_company_access" ON safety_inspections
  FOR ALL USING (company_id = my_company_id());

-- ── teams RLS ──
CREATE POLICY "teams_company_access" ON teams
  FOR ALL USING (company_id = my_company_id());

-- ── chat_rooms RLS ──
CREATE POLICY "chat_rooms_company_access" ON chat_rooms
  FOR ALL USING (company_id = my_company_id() OR auth.uid()::TEXT = ANY(members));

-- ── chat_messages RLS ──
CREATE POLICY "chat_messages_room_access" ON chat_messages
  FOR ALL USING (
    room_id IN (
      SELECT id FROM chat_rooms WHERE company_id = my_company_id() OR auth.uid()::TEXT = ANY(members)
    )
  );

-- ── notices RLS ──
CREATE POLICY "notices_company_access" ON notices
  FOR ALL USING (company_id = my_company_id());

-- ── leave_requests RLS ──
CREATE POLICY "leave_requests_access" ON leave_requests
  FOR ALL USING (company_id = my_company_id());

-- ── qna RLS ──
CREATE POLICY "qna_public_or_own" ON qna
  FOR SELECT USING (is_public = TRUE OR author_uid = auth.uid()::TEXT OR is_admin());

CREATE POLICY "qna_insert_auth" ON qna
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "qna_update_own" ON qna
  FOR UPDATE USING (author_uid = auth.uid()::TEXT OR is_admin());

CREATE POLICY "qna_delete_own" ON qna
  FOR DELETE USING (author_uid = auth.uid()::TEXT OR is_admin());

-- ── qna_answers RLS ──
CREATE POLICY "qna_answers_select" ON qna_answers
  FOR SELECT USING (TRUE);

CREATE POLICY "qna_answers_insert" ON qna_answers
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "qna_answers_delete_own" ON qna_answers
  FOR DELETE USING (author_uid = auth.uid()::TEXT OR is_admin());

-- ── invitations RLS ──
CREATE POLICY "invitations_company_access" ON invitations
  FOR ALL USING (company_id = my_company_id());

-- ── inspection_groups RLS ──
CREATE POLICY "inspection_groups_company_access" ON inspection_groups
  FOR ALL USING (company_id = my_company_id());

-- ── inspection_schedules RLS ──
CREATE POLICY "inspection_schedules_company_access" ON inspection_schedules
  FOR ALL USING (company_id = my_company_id());

-- ── material_usages RLS ──
CREATE POLICY "material_usages_company_access" ON material_usages
  FOR ALL USING (company_id = my_company_id());

-- ================================================================
-- REALTIME: 실시간 구독 활성화
-- ================================================================
ALTER PUBLICATION supabase_realtime ADD TABLE fault_reports;
ALTER PUBLICATION supabase_realtime ADD TABLE material_requests;
ALTER PUBLICATION supabase_realtime ADD TABLE chat_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE inspections;
ALTER PUBLICATION supabase_realtime ADD TABLE safety_inspections;
ALTER PUBLICATION supabase_realtime ADD TABLE users;
ALTER PUBLICATION supabase_realtime ADD TABLE sites;

