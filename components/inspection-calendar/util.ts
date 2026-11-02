// ─────────────────────────────────────────────
// 점검 캘린더 공용 날짜 유틸 (로컬 시간대 기준)
// ─────────────────────────────────────────────

export const WEEK_KO = ['일', '월', '화', '수', '목', '금', '토'];

export const pad = (n: number) => String(n).padStart(2, '0');

export const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

/** 'YYYY-MM-DD' → 로컬 자정 Date (문자열을 new Date()에 바로 넣으면 UTC로 밀리는 문제 방지) */
export function toDate(s: string): Date {
  const [y, m, d] = String(s || '').split('-').map(Number);
  return new Date(y || 1970, (m || 1) - 1, d || 1);
}

export const fromDate = (d: Date) => ymd(d.getFullYear(), d.getMonth() + 1, d.getDate());

export const todayStr = () => fromDate(new Date());

export function addDays(s: string, n: number): string {
  const d = toDate(s);
  d.setDate(d.getDate() + n);
  return fromDate(d);
}

/** n개월 뒤 — 31일처럼 없는 날짜는 그 달 마지막 날로 맞춤 (매월 반복용) */
export function addMonths(s: string, n: number): string {
  const d = toDate(s);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return fromDate(d);
}

/**
 * 시작일 기준 n개월 뒤 — 매월 반복에서 날짜가 밀리지 않게(1/31 → 2/28 → 3/31)
 * 반드시 '원래 시작일'을 기준으로 계산해야 함
 */
export function addMonthsAnchored(start: string, n: number): string {
  const s = toDate(start);
  const y = s.getFullYear();
  const m0 = s.getMonth() + n;
  const last = new Date(y, m0 + 1, 0).getDate();
  return fromDate(new Date(y, m0, Math.min(s.getDate(), last)));
}

export const daysBetween = (a: string, b: string) =>
  Math.round((toDate(b).getTime() - toDate(a).getTime()) / 86400000);

export const minS = (a: string, b: string) => (a < b ? a : b);
export const maxS = (a: string, b: string) => (a > b ? a : b);

export const monthRange = (y: number, m: number) => ({
  start: ymd(y, m, 1),
  end: ymd(y, m, new Date(y, m, 0).getDate()),
});

/** 월간 그리드 6주 (앞/뒤 달 날짜 포함) — 각 주는 7일 문자열 배열 */
export function monthWeeks(y: number, m: number): string[][] {
  const first = new Date(y, m - 1, 1);
  const pad0 = first.getDay();
  const start = addDays(ymd(y, m, 1), -pad0);
  const weeks: string[][] = [];
  for (let w = 0; w < 6; w++) {
    const row: string[] = [];
    for (let i = 0; i < 7; i++) row.push(addDays(start, w * 7 + i));
    weeks.push(row);
    // 다음 주가 전부 다음 달이면 6주를 다 그리지 않음
    if (w >= 3 && row[6].slice(0, 7) !== `${y}-${pad(m)}` && row[0].slice(0, 7) !== `${y}-${pad(m)}`) {
      weeks.pop();
      break;
    }
  }
  return weeks;
}

export const fmtDate = (s: string) => {
  if (!s) return '';
  const [y, m, d] = s.split('-');
  return `${Number(m)}월 ${Number(d)}일`;
};

export const fmtRange = (s: string, e: string) => {
  if (!e || e === s) return fmtDate(s);
  if (s.slice(0, 7) === e.slice(0, 7)) return `${fmtDate(s)} ~ ${Number(e.slice(8, 10))}일`;
  return `${fmtDate(s)} ~ ${fmtDate(e)}`;
};

export const dowOf = (s: string) => toDate(s).getDay();

export const isWeekend = (s: string) => [0, 6].includes(dowOf(s));

/** 반복 일정을 [rangeStart, rangeEnd] 안의 실제 발생일들로 펼침 */
export type Occ = { ev: any; start: string; end: string; key: string };

export function expandOccurrences(ev: any, rangeStart: string, rangeEnd: string): Occ[] {
  const start = ev.start_date;
  if (!start) return [];
  const end = ev.end_date && ev.end_date >= start ? ev.end_date : start;
  const dur = Math.max(0, daysBetween(start, end));
  const rule = ev.repeat_rule || 'none';
  const until = ev.repeat_until || '';

  if (rule !== 'weekly' && rule !== 'monthly') {
    return end >= rangeStart && start <= rangeEnd
      ? [{ ev, start, end, key: `${ev.id}|${start}` }]
      : [];
  }

  let cur = start;
  let step = 0; // 몇 번째 반복인지 (매월: 시작일 기준으로 계산해 날짜 밀림 방지)
  // 조회 범위 근처까지 빠르게 건너뛰기
  if (rule === 'monthly') {
    const months =
      (toDate(rangeStart).getFullYear() - toDate(start).getFullYear()) * 12 +
      (toDate(rangeStart).getMonth() - toDate(start).getMonth()) - 1;
    if (months > 0) step = months;
    cur = addMonthsAnchored(start, step);
  } else {
    const weeksGap = Math.floor(daysBetween(cur, addDays(rangeStart, -dur)) / 7);
    if (weeksGap > 0) { cur = addDays(cur, weeksGap * 7); step = weeksGap; }
  }

  const out: Occ[] = [];
  for (let guard = 0; guard < 500; guard++) {
    if (until && cur > until) break;
    if (cur > rangeEnd) break;
    const e = addDays(cur, dur);
    if (e >= rangeStart) out.push({ ev, start: cur, end: e, key: `${ev.id}|${cur}` });
    step += 1;
    cur = rule === 'weekly' ? addDays(start, step * 7) : addMonthsAnchored(start, step);
  }
  return out;
}
