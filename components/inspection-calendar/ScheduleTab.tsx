import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { C } from '@/lib/theme';
import { Tabs, Panel, useToast } from './ui';
import MonthGrid, { kindStyle } from './MonthGrid';
import AgendaList from './AgendaList';
import EventSheet from './EventSheet';
import { holidaysInMonth } from './holidays';
import { expandOccurrences, monthRange, monthWeeks, todayStr, toDate } from './util';

// ─────────────────────────────────────────────
// 점검 탭 · 일정(캘린더)
//
// 파일 구성
//   components/inspection-calendar/ScheduleTab.tsx   ← 이 화면
//     ├ ui.tsx            공용 UI (세그먼트 탭 · 카드 · 모달 · 토스트)
//     ├ MonthGrid.tsx     월간 그리드 (기간 일정 바 + 날짜별 목록)
//     ├ AgendaList.tsx    목록 보기
//     ├ EventSheet.tsx    일정 등록/수정 시트
//     ├ util.ts           날짜 · 반복 계산
//     └ holidays.ts       공휴일 · 국경일 · 기념일
//   supabase/schedule_events.sql
//   release/inspection-calendar/  적용 스크립트
// ─────────────────────────────────────────────

// 팀 색 (연차 화면과 동일 팔레트)
const TEAM_COLORS = ['#3b5bdb', '#0ca678', '#f08c00', '#ae3ec9', '#1098ad', '#e8590c', '#5c7cfa', '#2b8a3e'];
const makeTeamColor = (teams: string[]) => (name: string) =>
  name ? TEAM_COLORS[Math.max(0, teams.indexOf(name)) % TEAM_COLORS.length] : C.inkFaint;

// ── 날짜별로 나뉘어 저장된 일정(group_key)을 하나의 기간 일정으로 합치기 ──
//   11/2 1·2호기 + 11/3 3호기 + 11/4 4호기  →  '11/2~11/4 한 막대' + 날짜별 호기
function mergeGroups(rows: any[]): any[] {
  const plain: any[] = [];
  const groups: Record<string, any[]> = {};
  rows.forEach((r) => {
    if (r.group_key) (groups[r.group_key] = groups[r.group_key] || []).push(r);
    else plain.push(r);
  });

  const merged = Object.entries(groups).map(([key, list]) => {
    const sorted = [...list].sort((a, b) => String(a.start_date).localeCompare(String(b.start_date)));
    const first = sorted[0];
    const dates = sorted.map((r) => r.start_date).sort();
    const plans = sorted.map((r) => {
      const j = Array.isArray(r.day_plans) ? r.day_plans[0] : null;
      return {
        date: r.start_date,
        elevator_ids: j?.ids || (r.elevator_id ? String(r.elevator_id).split(',').filter(Boolean) : []),
        labels: j?.labels || [],
      };
    });
    const allCount = plans.reduce((a, p) => a + p.elevator_ids.length, 0);
    return {
      ...first,
      id: key,
      start_date: dates[0],
      end_date: dates[dates.length - 1],
      repeat_rule: 'none',
      repeat_until: null,
      elevator_id: allCount ? String(allCount) : null, // 대수 표시용
      plans,
      _grouped: true,
    };
  });

  return [...plain, ...merged];
}

// ── 저장 에러를 사람이 읽을 수 있는 안내로 바꿔 주기 ──
//  42P01 : 테이블 없음 / 42501 : RLS 권한 없음 / 42703 : 컬럼 없음 / PGRST204 : 스키마 캐시에 없는 컬럼
function explainSaveError(err: any): string {
  const code = String(err?.code || '');
  const msg = String(err?.message || '');
  if (code === '42P01' || msg.includes('does not exist') && msg.includes('schedule_events'))
    return '일정 테이블이 없어요. Supabase SQL Editor에서 supabase/schedule_events.sql을 실행해 주세요.';
  if (code === '42501' || msg.toLowerCase().includes('row-level security'))
    return '저장 권한이 막혀 있어요(RLS). Supabase에서 schedule_events.sql을 다시 실행해 정책을 만들어 주세요.';
  if (code === '42703' || code === 'PGRST204')
    return `테이블에 빠진 칸이 있어요 (${msg.slice(0, 80)}). Supabase에서 schedule_events.sql의 alter 문까지 실행해 주세요.`;
  if (code === '23505') return '같은 일정이 이미 있어요.';
  return `저장 실패: ${msg}`;
}

const navBtn: React.CSSProperties = {
  width: 32, height: 32, borderRadius: 8, border: 'none', background: 'transparent',
  color: C.inkDim, fontSize: 20, lineHeight: 1, cursor: 'pointer',
};

export default function ScheduleTab(props: {
  userInfo: any; elevators: any[]; sites: any[];
  initYear?: number; initMonth?: number;
}) {
  const { userInfo, elevators, sites, initYear, initMonth } = props;
  const { toast, node: toastNode } = useToast();

  const now = new Date();
  const [cal, setCal] = useState({
    y: initYear || now.getFullYear(),
    m: initMonth || now.getMonth() + 1,
  });
  const [view, setView] = useState<'month' | 'list'>('month');
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [needSql, setNeedSql] = useState(false);
  const [loadErr, setLoadErr] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [editing, setEditing] = useState<any | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const teams = useMemo(
    () => Array.from(new Set([userInfo?.team, ...sites.map((s: any) => s.teamName || s.team)].filter(Boolean))) as string[],
    [userInfo?.team, sites]
  );
  const teamColor = useMemo(() => makeTeamColor(teams), [teams]);
  const myTeam = userInfo?.team || '';

  // ── 일정 조회 ──
  const load = useCallback(async () => {
    if (!userInfo?.companyId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('schedule_events')
        .select('*')
        .eq('company_id', userInfo.companyId)
        .order('start_date', { ascending: false })
        .limit(2000);
      if (error) {
        const msg = String(error.message || '').toLowerCase();
        const code = String(error.code || '');
        // 테이블 없음 / 권한 없음 / 칸 없음 → 모두 "설정 필요" 안내로
        if (msg.includes('schedule_events') || ['42P01', '42501', '42703', 'PGRST204'].includes(code) || msg.includes('does not exist')) {
          setNeedSql(true);
          setLoadErr(explainSaveError(error));
          setEvents([]);
          return;
        }
        throw error;
      }
      setNeedSql(false);
      setLoadErr('');
      setEvents(mergeGroups(data || []));
    } catch (e: any) {
      console.error('일정 조회 실패', e);
      toast('일정을 불러오지 못했어요: ' + (e?.message || e));
    } finally {
      setLoading(false);
    }
  }, [userInfo?.companyId]);

  useEffect(() => { load(); }, [load]);

  const { start: mStart, end: mEnd } = monthRange(cal.y, cal.m);
  const weeks = useMemo(() => monthWeeks(cal.y, cal.m), [cal.y, cal.m]);
  const gridFrom = weeks[0][0];
  const gridTo = weeks[weeks.length - 1][6];

  // 반복 일정 전개
  const occurrences = useMemo(
    () => events
      .flatMap((ev: any) => expandOccurrences(ev, gridFrom, gridTo))
      .sort((a: any, b: any) => (a.start === b.start ? b.end.localeCompare(a.end) : a.start.localeCompare(b.start))),
    [events, gridFrom, gridTo]
  );

  const monthOcc = occurrences.filter((o) => o.end >= mStart && o.start <= mEnd);
  const today = todayStr();
  const todayOcc = occurrences.filter((o) => o.start <= today && o.end >= today);

  const openNew = (dates?: string[]) => {
    setEditing(dates ? { start_date: dates[0], end_date: dates[dates.length - 1] } : null);
    setSheetOpen(true);
  };
  const openEdit = (ev: any) => { setEditing(ev); setSheetOpen(true); };

  // 날짜 두 번 누르면 기간 선택
  const togglePick = (ds: string) =>
    setPicked((prev) => {
      if (prev.length === 1) {
        const [a] = prev;
        if (a === ds) return [];
        if (a.slice(0, 7) === ds.slice(0, 7)) return a < ds ? [a, ds] : [ds, a];
        return [ds];
      }
      return [ds];
    });

  const save = async (form: any) => {
    if (!userInfo?.companyId) { toast('회사 정보를 못 읽었어요. 새로고침 후 다시 시도해 주세요'); return; }
    if (!form.title?.trim()) { toast('일정 이름을 입력해 주세요'); return; }
    if (form.end_date && form.end_date < form.start_date) { toast('종료일이 시작일보다 빨라요'); return; }

    const base: any = {
      company_id: userInfo.companyId,
      kind: form.kind,
      title: form.title.trim(),
      all_day: true,
      site_id: form.site_id || null,
      site_name: form.site_name || '',
      team: form.team || myTeam,
      assignee: form.assignee || '',
      memo: form.memo || '',
      repeat_rule: form.repeat_rule || 'none',
      repeat_until: form.repeat_rule && form.repeat_rule !== 'none' ? (form.repeat_until || null) : null,
      updated_at: new Date().toISOString(),
    };

    const plans: { date: string; elevator_ids: string[]; labels?: string[] }[] = Array.isArray(form.day_plans)
      ? form.day_plans.filter((x: any) => x.elevator_ids?.length)
      : [];

    let error: any = null;

    if (plans.length > 0) {
      // ── 날짜별 동·호기: 날짜마다 한 행씩 (group_key 로 묶어서 달력에서 한 막대로 보임) ──
      const groupKey = form.id || (crypto?.randomUUID ? crypto.randomUUID() : String(Date.now()));
      if (form.id) {
        // 수정: 이 묶음의 기존 행을 모두 지우고 다시 넣는다
        await supabase.from('schedule_events').delete().eq('group_key', form.id);
      }
      const rows = plans.map((pl) => ({
        ...base,
        group_key: groupKey,
        start_date: pl.date,
        end_date: pl.date,
        elevator_id: pl.elevator_ids.join(','),
        day_plans: [{ date: pl.date, ids: pl.elevator_ids, labels: pl.labels || [] }],
        created_by: userInfo.uid,
        created_by_name: userInfo.name,
      }));
      const { error: insErr } = await supabase.from('schedule_events').insert(rows);
      error = insErr;
    } else if (form.id) {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(form.id));
      if (!isUuid) {
        // 날짜별 묶음 → 날짜별 배정이 모두 지워졌으면 그룹 전체 삭제
        const { error: delErr } = await supabase.from('schedule_events').delete().eq('group_key', form.id);
        error = delErr;
        if (!error) {
          const { error: insErr } = await supabase.from('schedule_events').insert({
            ...base,
            start_date: form.start_date,
            end_date: form.end_date || form.start_date,
            created_by: userInfo.uid,
            created_by_name: userInfo.name,
          });
          error = insErr;
        }
      } else {
        const { error: upErr } = await supabase
          .from('schedule_events')
          .update({ ...base, start_date: form.start_date, end_date: form.end_date || form.start_date, elevator_id: null })
          .eq('id', form.id);
        error = upErr;
      }
    } else {
      const { error: insErr } = await supabase.from('schedule_events').insert({
        ...base,
        start_date: form.start_date,
        end_date: form.end_date || form.start_date,
        elevator_id: null,
        created_by: userInfo.uid,
        created_by_name: userInfo.name,
      });
      error = insErr;
    }

    if (error) { toast(explainSaveError(error), 6000); return; }
    setSheetOpen(false); setEditing(null); setPicked([]);
    toast(
      plans.length > 1
        ? `${plans.length}일치를 날짜별로 등록했어요`
        : form.id ? '일정을 수정했어요' : '일정을 등록했어요'
    );
    await load();
  };

  const remove = async (form: any) => {
    if (!form.id) { toast('삭제할 일정을 찾지 못했어요'); return; }
    if (!confirm('이 일정을 삭제할까요?\n날짜별로 나뉜 일정은 전체가 함께 삭제됩니다.')) return;

    // 날짜별로 묶인 일정(group_key)은 id 가 uuid 가 아니라 그룹키라서
    // id 로 지우면 DB가 거부한다 → group_key 로 지운다.
    const groupKey = form.group_key || (form._grouped ? form.id : null);
    const isGroup = !!groupKey;

    let error: any = null;
    if (isGroup) {
      const { error: e1 } = await supabase.from('schedule_events').delete().eq('group_key', groupKey);
      error = e1;
      // 혹시 group_key 로 못 지웠으면 id 로 한 번 더
      if (error) {
        const { error: e2 } = await supabase.from('schedule_events').delete().eq('id', form.id);
        error = e2;
      }
    } else {
      const { error: e1 } = await supabase.from('schedule_events').delete().eq('id', form.id);
      error = e1;
    }

    if (error) { toast('삭제 실패: ' + (error.message || '권한을 확인해 주세요'), 6000); return; }
    setSheetOpen(false); setEditing(null);
    toast('삭제했어요');
    await load();
  };

  const moveCal = (n: number) => {
    const d = toDate(`${cal.y}-${String(cal.m).padStart(2, '0')}-01`);
    d.setMonth(d.getMonth() + n);
    setCal({ y: d.getFullYear(), m: d.getMonth() + 1 });
    setPicked([]);
  };

  // 좌우 배치 여부는 JS 로 결정 (CSS 미디어쿼리와 어긋나면 그리드가 찌그러짐)
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const f = () => setWide(window.innerWidth >= 1024);
    f();
    window.addEventListener('resize', f);
    return () => window.removeEventListener('resize', f);
  }, []);

  return (
    <>
      {/* 오늘 일정 알림 */}
      {!loading && todayOcc.length > 0 && <TodayBar occ={todayOcc} onOpen={openEdit} />}
      {needSql && (
        <div style={{ padding: '12px 14px', marginBottom: 12, borderRadius: 12, background: '#fffbeb', border: '1px solid #fde68a', fontSize: 12.5, color: '#92400e', lineHeight: 1.65 }}>
          <b>일정 저장소 설정이 필요해요.</b>
          <div style={{ marginTop: 3 }}>{loadErr || 'Supabase SQL Editor에서 supabase/schedule_events.sql을 실행해 주세요.'}</div>
          <div style={{ marginTop: 6, color: '#a16207' }}>SQL Editor → supabase/schedule_events.sql 전체 붙여넣기 → RUN → 새로고침</div>
        </div>
      )}

      {/* 툴바 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap', rowGap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <button onClick={() => moveCal(-1)} style={navBtn} aria-label="이전 달">‹</button>
          <div style={{ minWidth: 112, textAlign: 'center', fontSize: 17, fontWeight: 800, letterSpacing: -0.3 }}>
            {cal.y}년 {cal.m}월
          </div>
          <button onClick={() => moveCal(1)} style={navBtn} aria-label="다음 달">›</button>
          <button
            onClick={() => { setCal({ y: now.getFullYear(), m: now.getMonth() + 1 }); setPicked([]); }}
            style={{ marginLeft: 4, height: 32, padding: '0 10px', borderRadius: 8, border: `1px solid ${C.line}`, background: '#fff', color: C.inkDim, fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}
          >오늘</button>
        </div>

        {picked.length > 0 && (
          <span style={{ fontSize: 11.5, color: C.primary, fontWeight: 700, background: `${C.primary}12`, padding: '3px 8px', borderRadius: 6 }}>
            {picked.length === 1 ? `${Number(picked[0].slice(8, 10))}일 선택` : `${Number(picked[0].slice(8, 10))}~${Number(picked[1].slice(8, 10))}일 선택`}
          </span>
        )}

        <div style={{ flex: 1 }} />
        {/* 보기 전환 + 등록 (좁은 화면에서 한 덩어리로 줄바꿈) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
          <Tabs items={[['month', '월간'], ['list', '목록']]} value={view} onChange={(v) => setView(v as any)} />
          <button
            onClick={() => openNew(picked.length ? picked : undefined)}
            style={{ height: 36, padding: '0 14px', borderRadius: 10, border: 'none', background: C.ink, color: '#fff', fontSize: 13, fontWeight: 800, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}
          >
            <span style={{ fontSize: 15, fontWeight: 700, lineHeight: 1, marginTop: -1 }}>+</span> 일정
          </button>
        </div>
      </div>

      {loading ? (
        <Panel><div style={{ padding: 48, textAlign: 'center', color: C.inkFaint, fontSize: 13 }}>일정을 불러오는 중...</div></Panel>
      ) : view === 'month' ? (
        <div style={{
          display: 'grid', gap: 14, alignItems: 'start',
          gridTemplateColumns: wide ? 'minmax(0, 1fr) 296px' : 'minmax(0, 1fr)',
        }}>
          <div style={{ minWidth: 0 }}>
            <MonthGrid
              y={cal.y} m={cal.m} weeks={weeks} occ={occurrences}
              elevators={elevators}
              picked={picked} onPick={togglePick}
              onOpenEvent={openEdit}
              onQuickAdd={(ds) => openNew([ds])}
              teamColor={teamColor}
            />
          </div>
          {wide && (
            <div>
              <MonthSide y={cal.y} m={cal.m} occ={monthOcc} onOpenEvent={openEdit} />
            </div>
          )}
        </div>
      ) : (
        <AgendaList occ={occurrences.filter((o) => o.end >= mStart)} onOpenEvent={openEdit} teamColor={teamColor} elevators={elevators} />
      )}

      {sheetOpen && (
        <EventSheet
          init={editing}
          sites={sites}
          elevators={elevators}
          teams={teams}
          myTeam={myTeam}
          onClose={() => { setSheetOpen(false); setEditing(null); }}
          onSave={save}
          onDelete={remove}
        />
      )}

      <style>{`
        .sc-wrap { display: grid; grid-template-columns: minmax(0, 1fr); gap: 14px; align-items: start; }
      `}</style>
      {toastNode}
    </>
  );
}

// ── 오늘 일정 알림 (앱 안에서만) ──
function TodayBar({ occ, onOpen }: { occ: any[]; onOpen: (ev: any) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 14px', marginBottom: 12, borderRadius: 12, background: '#fff8ed', border: '1px solid #fde3be' }}>
      <span style={{
        width: 22, height: 22, borderRadius: 7, background: '#f59f00', color: '#fff', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 900, marginTop: 1,
      }}>오</span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 12.5, fontWeight: 800, color: '#b45309', marginBottom: 6 }}>오늘 일정 {occ.length}건</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {occ.map((o) => {
            const k = kindStyle(o.ev.kind);
            return (
              <button key={o.key} onClick={() => onOpen(o.ev)} style={{
                display: 'inline-flex', alignItems: 'center', gap: 5, height: 27, padding: '0 9px', borderRadius: 7,
                border: `1px solid ${k.color}33`, background: '#fff', color: C.ink, fontSize: 12, fontWeight: 700, cursor: 'pointer',
              }}>
                <span style={{ width: 6, height: 6, borderRadius: 2, background: k.color, flexShrink: 0 }} />
                {o.ev.title}
                {o.ev.site_name && <span style={{ color: C.inkFaint, fontWeight: 500 }}>· {o.ev.site_name}</span>}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── 우측: 이번 달 요약 · 공휴일 · 다가오는 일정 ──
function MonthSide({ y, m, occ, onOpenEvent }: { y: number; m: number; occ: any[]; onOpenEvent: (ev: any) => void }) {
  const hol = holidaysInMonth(y, m);
  const today = todayStr();
  const upcoming = occ.filter((o) => o.end >= today).slice(0, 6);
  const insp = occ.filter((o) => o.ev.kind === 'inspection').length;
  const work = occ.filter((o) => o.ev.kind === 'work').length;
  const etc = occ.length - insp - work;

  const stats: [string, number, string][] = [['점검', insp, '#3b5bdb'], ['공사', work, '#d9630b'], ['기타', etc, '#0ca678']];

  return (
    <Panel>
      <div style={{ padding: '13px 16px', borderBottom: `1px solid ${C.line}`, display: 'flex', gap: 16 }}>
        {stats.map(([k, v, c]) => (
          <div key={k}>
            <div style={{ fontSize: 11.5, color: C.inkFaint, fontWeight: 600 }}>{k}</div>
            <div style={{ fontSize: 19, fontWeight: 800, color: v ? c : C.inkFaint, letterSpacing: -0.4 }}>{v}</div>
          </div>
        ))}
      </div>

      {hol.length > 0 && (
        <div style={{ padding: '12px 16px', borderBottom: `1px solid ${C.line}` }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: C.ink, marginBottom: 8 }}>{m}월 공휴일 · 기념일</div>
          {hol.map((h) => (
            <div key={h.date} style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '3px 0', minWidth: 0 }}>
              <span style={{ fontSize: 11.5, fontWeight: 800, width: 30, flexShrink: 0, color: h.kind === 'public' ? '#e03131' : C.inkFaint }}>
                {Number(h.date.slice(8))}일
              </span>
              <span style={{
                fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                fontWeight: h.kind === 'public' ? 700 : 500,
                color: h.kind === 'public' ? '#e03131' : h.kind === 'national' ? C.inkSoft : C.inkFaint,
              }}>{h.name}</span>
            </div>
          ))}
        </div>
      )}

      <div style={{ padding: '12px 16px 4px', fontSize: 12, fontWeight: 800, color: C.ink }}>다가오는 일정</div>
      <div style={{ padding: '0 8px 8px' }}>
        {upcoming.length === 0 && <div style={{ padding: '10px 8px 14px', fontSize: 12.5, color: C.inkFaint }}>이번 달 남은 일정이 없어요</div>}
        {upcoming.map((o) => {
          const k = kindStyle(o.ev.kind);
          const d = o.start < today ? today : o.start;
          return (
            <button key={o.key} onClick={() => onOpenEvent(o.ev)} style={{
              width: '100%', display: 'flex', alignItems: 'center', gap: 9, padding: 8, borderRadius: 9,
              border: 'none', background: 'none', cursor: 'pointer', textAlign: 'left',
            }}>
              <div style={{ width: 34, flexShrink: 0, textAlign: 'center' }}>
                <div style={{ fontSize: 10.5, color: C.inkFaint, lineHeight: 1.5 }}>{Number(d.slice(5, 7))}월</div>
                <div style={{ fontSize: 16, fontWeight: 800, lineHeight: 1.1 }}>{Number(d.slice(8, 10))}</div>
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: C.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.ev.title}</div>
                <div style={{ fontSize: 11, color: C.inkFaint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {k.label}{o.ev.site_name ? ` · ${o.ev.site_name}` : ''}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </Panel>
  );
}
