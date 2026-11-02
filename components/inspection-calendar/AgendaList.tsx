import { useMemo } from 'react';
import { C } from '@/lib/theme';
import { Panel } from './ui';
import { kindStyle } from './MonthGrid';
import { WEEK_KO, dowOf, fmtDate, fmtRange, todayStr } from './util';

// ─────────────────────────────────────────────
// 목록 보기 — 날짜별로 묶어서 한 달 일정을 위에서 아래로
// ─────────────────────────────────────────────

export default function AgendaList({
  occ, onOpenEvent, teamColor, elevators,
}: {
  occ: any[]; onOpenEvent: (ev: any) => void; teamColor: (t: string) => string; elevators?: any[];
}) {
  const elevName = (id: string) => {
    const e = (elevators || []).find((x: any) => x.id === id);
    return e ? `${e.dong ? e.dong + ' ' : ''}${e.hogi_no || '호기'}` : '';
  };
  const today = todayStr();

  const groups = useMemo(() => {
    const byStart: Record<string, any[]> = {};
    occ.forEach((o) => { (byStart[o.start] = byStart[o.start] || []).push(o); });
    return Object.entries(byStart).sort(([a], [b]) => a.localeCompare(b));
  }, [occ]);

  if (groups.length === 0) {
    return (
      <Panel>
        <div style={{ padding: '52px 16px', textAlign: 'center', color: C.inkFaint, fontSize: 13 }}>
          이 기간에 등록된 일정이 없어요.<br />
          <span style={{ fontSize: 12 }}>오른쪽 위 <b>+ 일정</b>으로 추가할 수 있어요.</span>
        </div>
      </Panel>
    );
  }

  return (
    <Panel>
      {groups.map(([date, list], gi) => {
        const past = date < today;
        return (
          <div key={date} style={{ borderTop: gi ? `1px solid ${C.line}` : 'none', opacity: past ? 0.55 : 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 16px', background: '#fafbfc' }}>
              <b style={{ fontSize: 13, color: date === today ? C.primary : C.ink }}>
                {fmtDate(date)}
              </b>
              <span style={{ fontSize: 11.5, color: C.inkFaint }}>{WEEK_KO[dowOf(date)]}</span>
              {date === today && <span style={{ fontSize: 10.5, fontWeight: 800, color: '#fff', background: C.primary, padding: '1px 6px', borderRadius: 5 }}>오늘</span>}
              <span style={{ marginLeft: 'auto', fontSize: 11.5, color: C.inkFaint }}>{list.length}건</span>
            </div>
            {list.map((o: any) => {
              const k = kindStyle(o.ev.kind);
              const multi = o.start !== o.end;
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
                      {multi && <span style={{ fontSize: 11, color: C.inkDim, fontWeight: 600 }}>{fmtRange(o.start, o.end)}</span>}
                      {o.ev.repeat_rule && o.ev.repeat_rule !== 'none' && (
                        <span style={{ fontSize: 10.5, color: C.inkFaint, fontWeight: 600 }}>{o.ev.repeat_rule === 'weekly' ? '매주' : '매월'} 반복</span>
                      )}
                    </div>
                    {(() => {
                      const plan = (o.ev.plans || []).find((p: any) => p.date === date);
                      const names = plan ? (plan.labels?.length ? plan.labels : plan.elevator_ids.map(elevName).filter(Boolean)) : [];
                      if (!names.length) return null;
                      return (
                        <div style={{ fontSize: 11.5, color: C.primary, fontWeight: 700, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {names.join(', ')}
                        </div>
                      );
                    })()}
                    {(o.ev.site_name || o.ev.team || o.ev.assignee) && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: C.inkFaint, marginTop: 3, flexWrap: 'wrap' }}>
                        {o.ev.site_name && <span>{o.ev.site_name}</span>}
                        {o.ev.team && (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <span style={{ width: 6, height: 6, borderRadius: '50%', background: teamColor(o.ev.team) }} />{o.ev.team}
                          </span>
                        )}
                        {o.ev.assignee && <span>· {o.ev.assignee}</span>}
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        );
      })}
    </Panel>
  );
}
