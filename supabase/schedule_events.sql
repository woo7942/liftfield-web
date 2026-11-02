-- ─────────────────────────────────────────────
-- 점검 탭 · 일정(캘린더) 테이블  (다시 실행해도 안전)
--
-- 저장 실패가 나면 이 파일 "전체"를 Supabase > SQL Editor 에 붙여 넣고 RUN 하세요.
-- 이미 만들어져 있어도 빠진 칸/권한/캐시를 스스로 고칩니다.
-- ─────────────────────────────────────────────

-- 1) 테이블 (없을 때만 생성)
create table if not exists public.schedule_events (
  id              uuid primary key default gen_random_uuid(),
  company_id      text not null,
  kind            text default 'inspection',
  title           text,
  start_date      date,
  end_date        date,
  all_day         boolean default true,
  site_id         text,
  site_name       text,
  elevator_id     text,
  team            text,
  assignee        text,
  memo            text,
  repeat_rule     text default 'none',
  repeat_until    date,
  color           text,
  created_by      text,
  created_by_name text,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

-- 2) 예전에 일부 칸만 만들어진 경우 채우기 (있으면 무시)
alter table public.schedule_events add column if not exists kind            text default 'inspection';
alter table public.schedule_events add column if not exists title            text;
alter table public.schedule_events add column if not exists end_date         date;
alter table public.schedule_events add column if not exists all_day          boolean default true;
alter table public.schedule_events add column if not exists site_id          text;
alter table public.schedule_events add column if not exists site_name        text;
alter table public.schedule_events add column if not exists elevator_id      text;
alter table public.schedule_events add column if not exists team             text;
alter table public.schedule_events add column if not exists assignee         text;
alter table public.schedule_events add column if not exists memo             text;
alter table public.schedule_events add column if not exists repeat_rule      text default 'none';
alter table public.schedule_events add column if not exists repeat_until     date;
alter table public.schedule_events add column if not exists color            text;
alter table public.schedule_events add column if not exists created_by       text;
alter table public.schedule_events add column if not exists created_by_name  text;
alter table public.schedule_events add column if not exists created_at       timestamptz default now();
alter table public.schedule_events add column if not exists updated_at       timestamptz default now();

-- 3) 검색 속도
create index if not exists schedule_events_company_start
  on public.schedule_events (company_id, start_date);

-- 4) RLS 정책 (같은 회사 사람끼리 공유 — 기존 테이블들과 같은 수준)
alter table public.schedule_events enable row level security;

drop policy if exists "schedule read"   on public.schedule_events;
drop policy if exists "schedule insert" on public.schedule_events;
drop policy if exists "schedule update" on public.schedule_events;
drop policy if exists "schedule delete" on public.schedule_events;

create policy "schedule read"   on public.schedule_events for select using (true);
create policy "schedule insert" on public.schedule_events for insert with check (true);
create policy "schedule update" on public.schedule_events for update using (true);
create policy "schedule delete" on public.schedule_events for delete using (true);

-- 5) PostgREST 스키마 캐시 새로고침
--    (칸을 추가한 직후 "column not found" 가 뜨는 문제 방지)
notify pgrst, 'reload schema';

-- 확인: 아래를 따로 실행하면 테이블·정책이 제대로 있는지 볼 수 있습니다.
--   select column_name, data_type from information_schema.columns
--    where table_name = 'schedule_events' order by ordinal_position;
--   select policyname, cmd from pg_policies where tablename = 'schedule_events';
