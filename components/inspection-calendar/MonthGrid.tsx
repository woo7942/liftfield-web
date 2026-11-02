import { useEffect, useMemo, useState } from 'react';
import { C } from '@/lib/theme';
import { Panel } from './ui';
import { holidayOf } from './holidays';
import { WEEK_KO, addDays, dowOf, fmtRange, todayStr } from './util';

// ─────────────────────────────────────────────
// 월간 그리드
//  · PC  : 한 주 안에서 기간 일정을 '바'로 이어서 표시 (최대 3줄)
//  · 모바일: 날짜 칸에는 점만, 날짜를 누르면 아래에 그날 일정 목록
// ─────────────────────────────────────────────

export const KIND: Record<string, { label: string; color: string; soft: string }> = {
  inspection: { label: '점검', color: '#3b5bdb', soft: '#eaefff' },
  work: { label: '공사', color: '#d9630b', soft: '#fff1e6' },
  etc: { label: '기타', color: '#0ca678', soft: '#e6f7ee' },
};
export const kindStyle = (k: string) => KIND[k] || KIND.inspection;

type Bar = { key: string; ev: any; start: string; end: string; col: number; span: number; lane: number; contL: boolean; contR: boolean };

const MAX_LANE = 3;
const LANE_H = 19;

export default function MonthGrid({
  y, m, weeks, occ, picked, onPick, onOpenEvent, onQuickAdd, teamColor, elevators,
}: {
  y: number; m: number; weeks: string[][]; occ: any[];
  picked: string[]; onPick: (ds: string) => void;
  onOpenEvent: (ev: any) => void;
  onQuickAdd: (ds: string) => void;
  teamColor: (t: string) => string;
  elevators?: any[];
}) {
  // 호기 id → 이름 (날짜별 호기 표시용)
  const elevName = (id: string) => {
    const e = (elevators || []).find((x: any) => x.id === id);
    return e ? `${e.dong ? e.dong + ' ' : ''}${e.hogi_no || '호기'}` : '';
  };
  // SSR 안전: 처음엔 모바일 레이아웃으로 그리고, 마운트 후 폭을 측정
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const f = () => setWide(window.innerWidth >= 760);
    f();
    window.addEventListener('resize', f);
    return () => window.removeEventListener('resize', f);
  }, []);

  const today = todayStr();
  const [selDay, setSelDay] = useState<string>(today);
  useEffect(() => { setSelDay(today); }, [y, m, today]);

  // 날짜별 발생 목록
  const byDay = useMemo(() => {
    const map: Record<string, any[]> = {};
    occ.forEach((o: any) => {
      let d = o.start;
      for (let g = 0; g < 400 && d <= o.end; g++) {
        (map[d] = map[d] || []).push(o);
        d = addDays(d, 1);
      }
    });
    return map;
  }, [occ]);

  const monthKey = `${y}-${String(m).padStart(2, '0')}`;

  const weekLines = useMemo(() => weeks.map((wk) => {
    const segs: Bar[] = occ
      .filter((o: any) => o.end >= wk[0] && o.start <= wk[6])
      .map((o: any) => {
        const s = o.start < wk[0] ? wk[0] : o.start;
        const e = o.end > wk[6] ? wk[6] : o.end;
        return {
          key: o.key, ev: o.ev, start: o.start, end: o.end,
          col: wk.indexOf(s) + 1, span: wk.indexOf(e) - wk.indexOf(s) + 1,
          lane: 0, contL: o.start < wk[0], contR: o.end > wk[6],
        };
      })
      .sort((a, b) => (a.col - b.col) || (b.span - a.span));

    const lanes: Bar[][] = [];
    segs.forEach((s) => {
      for (let i = 0; ; i++) {
        lanes[i] = lanes[i] || [];
        if (!lanes[i].some((b) => s.col < b.col + b.span && b.col < s.col + s.span)) { s.lane = i; lanes[i].push(s); break; }
      }
    });
    return {
      wk,
      segs: segs.filter((s) => s.lane < MAX_LANE),
      laneCount: Math.min(lanes.length, MAX_LANE),
      hiddenCount: segs.filter((s) => s.lane >= MAX_LANE).length,
    };
  }), [weeks, occ]);

  const dayList = byDay[selDay] || [];
  const hol = holidayOf(selDay);
  // 모든 주를 같은 높이로 (주마다 높이가 달라 들쭉날쭉해 보이는 문제 방지)
  const rowLane = Math.max(0, ...weekLines.map((w) => w.laneCount));

  return (
    <>
      <Panel>
        {/* 요일 헤더 */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0,1fr))', borderBottom: `1px solid ${C.line}` }}>
          {WEEK_KO.map((w, i) => (
            <div key={w} style={{
              padding: '9px 0', textAlign: 'center', fontSize: 12, fontWeight: 700,
              color: i === 0 ? '#e03131' : i === 6 ? C.primary : C.inkDim,
            }}>{w}</div>
          ))}
        </div>

        {weekLines.map(({ wk, segs, laneCount, hiddenCount }, wi) => (
          <div key={wi} style={{ position: 'relative', borderBottom: wi === weekLines.length - 1 ? 'none' : `1px solid ${C.line}` }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0,1fr))' }}>
              {wk.map((ds, di) => {
                const d = Number(ds.slice(8));
                const inMonth = ds.slice(0, 7) === monthKey;
                const h = holidayOf(ds);
                const isToday = ds === today;
                const isPicked = picked.includes(ds);
                const dow = dowOf(ds);
                const red = dow === 0 || h?.kind === 'public';
                const dots = (byDay[ds] || []).slice(0, 4);

                return (
                  <div
                    key={ds}
                    onClick={() => { onPick(ds); setSelDay(ds); }}
                    style={{
                      minHeight: wide ? 96 + rowLane * LANE_H : 60,
                      padding: wide ? '6px 6px 4px' : '6px 2px',
                      borderRight: di < 6 ? `1px solid ${C.bg}` : 'none',
                      background: isPicked ? `${C.primary}0d` : !inMonth ? '#fbfcfd' : (h?.kind === 'public' || dow === 0) ? '#fffafa' : '#fff',
                      cursor: 'pointer', transition: 'background .12s',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: wide ? 'flex-start' : 'center', minWidth: 0 }}>
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        minWidth: 21, height: 21, borderRadius: 999, padding: '0 4px', flexShrink: 0,
                        fontSize: 12, fontWeight: isToday ? 800 : 700,
                        background: isToday ? C.primary : 'transparent',
                        color: isToday ? '#fff' : !inMonth ? '#c8ccd3' : red ? '#e03131' : dow === 6 ? C.primary : C.inkSoft,
                      }}>{d}</span>
                      {wide && h && (
                        <span title={h.name} style={{
                          fontSize: 10, fontWeight: h.kind === 'public' ? 700 : 500, lineHeight: 1.2,
                          color: h.kind === 'public' ? '#e03131' : h.kind === 'national' ? C.inkSoft : C.inkFaint,
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0,
                        }}>{h.name}</span>
                      )}
                    </div>

                    {!wide && (
                      <div style={{ display: 'flex', gap: 2.5, justifyContent: 'center', flexWrap: 'wrap', paddingTop: 4 }}>
                        {dots.map((o: any) => (
                          <span key={o.key} style={{ width: 5, height: 5, borderRadius: 2, background: kindStyle(o.ev.kind).color }} />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* PC 기간 바 */}
            {wide && laneCount > 0 && (
              <div style={{ position: 'absolute', left: 0, right: 0, top: 30, height: laneCount * LANE_H, pointerEvents: 'none' }}>
                {segs.map((s) => {
                  const k = kindStyle(s.ev.kind);
                  const tc = teamColor(s.ev.team);
                  return (
                    <button
                      key={s.key}
                      onClick={(e) => { e.stopPropagation(); onOpenEvent(s.ev); }}
                      title={`${s.ev.title}${s.ev.site_name ? ` · ${s.ev.site_name}` : ''} (${fmtRange(s.start, s.end)})`}
                      style={{
                        position: 'absolute', top: s.lane * LANE_H, height: 17,
                        left: `calc(${((s.col - 1) / 7) * 100}% + 3px)`,
                        width: `calc(${(s.span / 7) * 100}% - 6px)`,
                        pointerEvents: 'auto', display: 'flex', alignItems: 'center', gap: 3,
                        padding: '0 4px', background: k.soft, color: k.color,
                        border: 'none', borderLeft: `3px solid ${tc}`,
                        borderRadius: s.contL ? '2px 5px 5px 2px' : s.contR ? '5px 2px 2px 5px' : 5,
                        fontSize: 10.5, fontWeight: 700, cursor: 'pointer', overflow: 'hidden',
                        whiteSpace: 'nowrap', textAlign: 'left',
                      }}
                    >
                      {s.contL && <span style={{ opacity: 0.45, marginLeft: -1 }}>‹</span>}
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.ev.title}</span>
                      {s.ev.plans && s.ev.elevator_id && (
                        <span style={{ opacity: 0.75, fontWeight: 800 }}>{s.ev.elevator_id}대</span>
                      )}
                      {s.ev.site_name && s.span > 2 && <span style={{ opacity: 0.6, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis' }}>· {s.ev.site_name}</span>}
                      {s.contR && <span style={{ opacity: 0.45, marginLeft: 'auto' }}>›</span>}
                    </button>
                  );
                })}
              </div>
            )}

            {/* 일정이 3줄 넘게 겹칠 때 */}
            {wide && hiddenCount > 0 && (
              <div style={{ position: 'absolute', right: 5, bottom: 2, fontSize: 9.5, fontWeight: 700, color: C.inkFaint, background: '#fff', padding: '0 3px', borderRadius: 3 }}>
                +{hiddenCount}
              </div>
            )}
          </div>
        ))}
      </Panel>

      {/* 선택한 날짜 상세 */}
      <Panel style={{ marginTop: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', borderBottom: `1px solid ${C.line}`, background: '#fafbfc', flexWrap: 'wrap' }}>
          <b style={{ fontSize: 14.5 }}>{Number(selDay.slice(5, 7))}월 {Number(selDay.slice(8, 10))}일</b>
          <span style={{ fontSize: 12, color: C.inkFaint }}>{WEEK_KO[dowOf(selDay)]}요일</span>
          {hol && (
            <span style={{
              fontSize: 11.5, fontWeight: 700, padding: '2px 7px', borderRadius: 5,
              background: hol.kind === 'public' ? '#ffe8e8' : '#f1f3f5',
              color: hol.kind === 'public' ? '#e03131' : C.inkDim,
            }}>{hol.name}</span>
          )}
          <button onClick={() => onQuickAdd(selDay)} style={{
            marginLeft: 'auto', height: 28, padding: '0 10px', borderRadius: 8,
            border: `1px solid ${C.line}`, background: '#fff', color: C.inkDim,
            fontSize: 12, fontWeight: 700, cursor: 'pointer',
          }}>+ 이 날 일정</button>
        </div>

        {dayList.length === 0 ? (
          <div style={{ padding: '28px 16px', textAlign: 'center', color: C.inkFaint, fontSize: 13 }}>일정이 없어요</div>
        ) : dayList.map((o: any) => {
          const plan = (o.ev.plans || []).find((p: any) => p.date === selDay);
          const k = kindStyle(o.ev.kind);
          const planNames = plan
            ? (plan.labels?.length ? plan.labels.join(', ') : plan.elevator_ids.map(elevName).filter(Boolean).join(', '))
            : '';
          const meta = [
            o.start !== o.end ? fmtRange(o.start, o.end) : '',
            o.ev.site_name,
            planNames || (o.ev.elevator_id && !o.ev.plans ? '호기 지정' : ''),
            o.ev.team,
            o.ev.assignee,
          ].filter(Boolean).join(' · ');
          return (
            <button key={o.key} onClick={() => onOpenEvent(o.ev)} style={{
              width: '100%', display: 'flex', alignItems: 'stretch', gap: 10, padding: '11px 16px',
              border: 'none', borderTop: `1px solid ${C.bg}`, background: 'none', textAlign: 'left', cursor: 'pointer',
            }}>
              <span style={{ width: 3, borderRadius: 3, background: k.color, flexShrink: 0 }} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <b style={{ fontSize: 13.5, color: C.ink }}>{o.ev.title}</b>
                  <span style={{ fontSize: 10.5, fontWeight: 800, padding: '1px 6px', borderRadius: 5, background: k.soft, color: k.color }}>{k.label}</span>
                  {o.ev.repeat_rule && o.ev.repeat_rule !== 'none' && (
                    <span style={{ fontSize: 10.5, color: C.inkFaint, fontWeight: 600 }}>{o.ev.repeat_rule === 'weekly' ? '매주' : '매월'} 반복</span>
                  )}
                </div>
                {meta && (
                  <div style={{ fontSize: 11.5, color: C.inkFaint, marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{meta}</div>
                )}
              </div>
            </button>
          );
        })}
      </Panel>
    </>
  );
}
