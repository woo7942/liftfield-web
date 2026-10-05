-- ════════════════════════════════════════════════════════════════
--  전체 회사 고장처리 기록 공유 (에러검색 · 고장처리 에러분석용)
--  Supabase 대시보드 → SQL Editor 에 통째로 붙여넣고 [Run] 한 번만 실행하세요.
--
--  왜 함수로?
--   fault_reports 는 RLS 때문에 내 회사 행만 보입니다.
--   서버 권한(SECURITY DEFINER) 함수가 모든 회사 기록을 읽되,
--   다른 회사 기록은 "분석에 필요한 칸만" 익명으로 내보냅니다.
--
--  다른 회사 기록에서 나가는 것
--   제조사 · 모델 · 에러코드 · 고장원인 · 처리내용 · 날짜
--  다른 회사 기록에서 가리는 것
--   현장명 · 호기 · 담당자 · 팀 · 행 id (→ 암호화 키로만 전달, 되돌릴 수 없음)
--   * 재발 호기 집계를 위해 "회사+현장+호기" 를 md5 로 묶은 키만 내보냄
-- ════════════════════════════════════════════════════════════════

-- 코드 검색 속도용 (정규화한 에러코드 배열)
create or replace function public._norm_codes(arr text[])
returns text[] language sql immutable as $$
  select coalesce(array_agg(upper(regexp_replace(c, '\s+', '', 'g'))), '{}')
  from unnest(coalesce(arr, '{}')) c
$$;

create index if not exists fault_reports_norm_codes_idx
  on public.fault_reports using gin (public._norm_codes(error_codes));

drop function if exists public.fault_records_shared(text[], int);

create or replace function public.fault_records_shared(p_codes text[] default null, p_limit int default 6000)
returns table (
  id text, created_at timestamptz, completed_at timestamptz,
  site_id text, site_name text, hogi_no text,
  maker text, model text, error_codes text[],
  fault_cause text, fault_action text, assigned_name text, team text,
  mine boolean, company_key text
)
language plpgsql stable security definer set search_path = public as $$
declare
  my_company text;
  wanted text[];
begin
  select u.company_id::text into my_company
  from public.users u where u.id::text = auth.uid()::text;
  if my_company is null then
    raise exception '회사에 소속된 로그인 사용자만 조회할 수 있어요';
  end if;

  wanted := case when p_codes is null or cardinality(p_codes) = 0 then null
                 else public._norm_codes(p_codes) end;

  return query
  select
    case when x.is_mine then x.id::text else md5('r|' || x.id::text) end,
    x.created_at::timestamptz,
    x.completed_at::timestamptz,
    case when x.is_mine then x.site_id::text
         else md5('u|' || x.company_id::text || '|' || coalesce(x.site_id::text, '') || '|' || coalesce(x.hogi_no::text, '')) end,
    case when x.is_mine then x.site_name::text else null end,
    case when x.is_mine then x.hogi_no::text   else null end,
    x.maker::text, x.model::text, x.error_codes::text[],
    x.fault_cause::text, x.fault_action::text,
    case when x.is_mine then x.assigned_name::text else null end,
    case when x.is_mine then x.team::text          else null end,
    x.is_mine,
    md5('c|' || x.company_id::text)
  from (
    select f.*, (f.company_id::text = my_company) as is_mine
    from public.fault_reports f
    where f.fault_cause is not null
      and coalesce(cardinality(f.error_codes), 0) > 0
      and (wanted is null or public._norm_codes(f.error_codes) && wanted)
    order by f.created_at desc
    limit greatest(1, least(coalesce(p_limit, 6000), 20000))
  ) x;
end; $$;

revoke all on function public.fault_records_shared(text[], int) from public, anon;
grant execute on function public.fault_records_shared(text[], int) to authenticated;

-- 확인 (SQL Editor 에서는 auth.uid() 가 없어 에러가 정상입니다 — 앱에서 확인하세요)
-- select company_key, count(*) from public.fault_records_shared(array['1007'], 1000) group by 1;
