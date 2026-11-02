import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { C } from '@/lib/theme';
import { Modal, field, fieldLabel } from './ui';
import { KIND } from './MonthGrid';
import { addDays, daysBetween, fmtDate, todayStr, WEEK_KO, dowOf } from './util';

// ─────────────────────────────────────────────
// 일정 등록 / 수정 — 아파트 점검용 '동별 배정'
//
//  ① 기간을 정한다 (11/2 ~ 11/5)
//  ② 현장을 고른다
//  ③ 동 목록이 나오면  [101동] [102동] [103동] 을 누른다  ← 끝
//     → 고른 동의 호기가 기간 안에 자동으로 나눠 배정된다
//     (예: 3일 × 101동 4대 → 11/2 2대, 11/3 1대, 11/4 1대)
//
//  · 자동 배분이 마음에 안 들면 '날짜 직접 지정'을 눌러 손으로 바꾼다
//  · 날짜 칸에 그날 점검할 호기가 그대로 보인다
// ─────────────────────────────────────────────

type Plan = { date: string; elevator_ids: string[]; labels: string[] };

// 기간 빠른 선택 (타입 추론에 기대지 않도록 객체 배열로 고정)
const repeatOptions: { key: string; label: string }[] = [
  { key: 'none', label: '없음' },
  { key: 'weekly', label: '매주' },
  { key: 'monthly', label: '매월' },
];

const spanOptions: { label: string; days: number }[] = [
  { label: '당일', days: 0 },
  { label: '2일', days: 1 },
  { label: '3일', days: 2 },
  { label: '일주일', days: 6 },
];

export default function EventSheet({
  init, sites, elevators, teams, myTeam, onClose, onSave, onDelete,
}: {
  init: any | null;
  sites: any[];
  elevators: any[];
  teams: string[];
  myTeam: string;
  onClose: () => void;
  onSave: (form: any) => Promise<void> | void;
  onDelete: (form: any) => Promise<void> | void;
}) {
  const isEdit = !!init?.id;

  const [form, setForm] = useState<any>({
    kind: init?.kind || 'inspection',
    title: init?.title || '',
    start_date: init?.start_date || todayStr(),
    end_date: init?.end_date || init?.start_date || todayStr(),
    site_id: init?.site_id || '',
    site_name: init?.site_name || '',
    team: init?.team || myTeam || '',
    assignee: init?.assignee || '',
    memo: init?.memo || '',
    repeat_rule: init?.repeat_rule || 'none',
    repeat_until: init?.repeat_until || '',
    id: init?.id,
    // 날짜별로 묶인 일정은 이 키로 전체를 삭제/수정한다
    group_key: init?.group_key || (init?._grouped ? init?.id : undefined),
  });
  const [saving, setSaving] = useState(false);
  const [siteQ, setSiteQ] = useState('');
  const [siteOpen, setSiteOpen] = useState(false);

  // 동별 선택 상태 + 날짜별 배정
  const [pickedDongs, setPickedDongs] = useState<string[]>([]);
  const [plans, setPlans] = useState<Record<string, string[]>>({});
  const [manual, setManual] = useState(false);      // 날짜 직접 지정 모드
  const [openDay, setOpenDay] = useState<string | null>(null);

  const set = (patch: any) => setForm((f: any) => ({ ...f, ...patch }));

  // ── 현장 호기: 그 현장만 DB에서 끝까지 ──
  const [fetchedElevs, setFetchedElevs] = useState<any[] | null>(null);
  const [elevLoading, setElevLoading] = useState(false);

  useEffect(() => {
    if (!form.site_id) { setFetchedElevs(null); return; }
    let alive = true;
    setElevLoading(true);
    (async () => {
      const all: any[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase
          .from('elevators')
          .select('id, hogi_no, elevator_no, dong, site_id')
          .eq('site_id', form.site_id)
          .order('hogi_no')
          .range(from, from + 999);
        if (error) break;
        all.push(...(data || []));
        if (!data || data.length < 1000) break;
      }
      if (!alive) return;
      setFetchedElevs(all.length > 0 ? all : (elevators || []).filter((e: any) => e.site_id === form.site_id));
      setElevLoading(false);
    })();
    return () => { alive = false; };
  }, [form.site_id]);

  const siteElevs = useMemo(() => {
    const base = fetchedElevs ?? (elevators || []).filter((e: any) => e.site_id === form.site_id);
    return [...base].sort((a: any, b: any) =>
      String(a.dong || '').localeCompare(String(b.dong || ''), 'ko', { numeric: true }) ||
      String(a.hogi_no || '').localeCompare(String(b.hogi_no || ''), 'ko', { numeric: true })
    );
  }, [fetchedElevs, elevators, form.site_id]);

  // 동 목록
  const dongs = useMemo(() => {
    const map: Record<string, any[]> = {};
    siteElevs.forEach((e: any) => {
      const k = e.dong || '동 미지정';
      (map[k] = map[k] || []).push(e);
    });
    return Object.entries(map);
  }, [siteElevs]);

  const elevLabel = (e: any) => `${e.hogi_no || '호기'}`;
  const elevById = useMemo(() => {
    const m: Record<string, any> = {};
    siteElevs.forEach((e: any) => { m[e.id] = e; });
    return m;
  }, [siteElevs]);

  const dateList = useMemo(() => {
    const n = daysBetween(form.start_date, form.end_date || form.start_date);
    if (n < 0) return [form.start_date];
    return Array.from({ length: Math.min(n + 1, 62) }, (_, i) => addDays(form.start_date, i));
  }, [form.start_date, form.end_date]);

  // ── 동을 고르면 기간에 자동 분배 ──
  const autoDistribute = (dongsSel: string[], dates: string[]) => {
    const ids: string[] = [];
    siteElevs.forEach((e: any) => {
      const d = e.dong || '동 미지정';
      if (dongsSel.includes(d)) ids.push(e.id);
    });
    if (ids.length === 0 || dates.length === 0) return {};
    const per = Math.ceil(ids.length / dates.length);
    const next: Record<string, string[]> = {};
    dates.forEach((dt, i) => { next[dt] = ids.slice(i * per, (i + 1) * per); });
    return next;
  };

  const toggleDong = (dong: string) => {
    const next = pickedDongs.includes(dong) ? pickedDongs.filter((d) => d !== dong) : [...pickedDongs, dong];
    setPickedDongs(next);
    if (!manual) setPlans(autoDistribute(next, dateList));
    else {
      // 수동 모드에서도 새로 고른 동은 남은 날짜에 채워 준다
      const ids = siteElevs.filter((e: any) => (e.dong || '동 미지정') === dong).map((e: any) => e.id);
      setPlans((prev) => {
        const out: Record<string, string[]> = { ...prev };
        if (pickedDongs.includes(dong)) {
          // 해제: 그 동 호기 제거
          Object.keys(out).forEach((d) => { out[d] = (out[d] || []).filter((x) => !ids.includes(x)); });
        } else {
          const empty = dateList.find((d) => !(out[d] || []).length) || dateList[0];
          out[empty] = [...new Set([...(out[empty] || []), ...ids])];
        }
        return out;
      });
    }
  };

  // 기간이 바뀌면 다시 분배
  useEffect(() => {
    if (!manual && pickedDongs.length > 0) setPlans(autoDistribute(pickedDongs, dateList));
    if (manual) setPlans((prev) => {
      const out: Record<string, string[]> = {};
      dateList.forEach((d) => { out[d] = prev[d] || []; });
      return out;
    });
  }, [dateList.join('|'), manual]);

  // 수정: 기존 배정 불러오기
  useEffect(() => {
    if (!isEdit || !init?.plans) return;
    const p: Record<string, string[]> = {};
    const dSet = new Set<string>();
    init.plans.forEach((pl: any) => {
      p[pl.date] = pl.elevator_ids || [];
      (pl.elevator_ids || []).forEach((id: string) => {
        const e = elevById[id];
        if (e?.dong) dSet.add(e.dong);
      });
    });
    setPlans(p);
    setPickedDongs([...dSet]);
  }, [isEdit]);

  const toggleElevOnDay = (date: string, id: string) =>
    setPlans((prev) => {
      const cur = prev[date] || [];
      return { ...prev, [date]: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] };
    });

  const filteredSites = useMemo(() => {
    const q = siteQ.trim().toLowerCase().replace(/\s+/g, '');
    const list = q
      ? sites.filter((s: any) => [s.siteName, s.name, s.address].some((v) => String(v || '').toLowerCase().replace(/\s+/g, '').includes(q)))
      : sites;
    return list.slice(0, 60);
  }, [sites, siteQ]);

  const pickedSite = sites.find((s: any) => s.id === form.site_id);
  const totalElevs = Object.values(plans).reduce((a, v) => a + v.length, 0);
  const assignedDays = Object.values(plans).filter((v) => v.length > 0).length;

  const submit = async () => {
    if (!form.title.trim()) { return; }
    setSaving(true);
    try {
      await onSave({
        ...form,
        day_plans: dateList
          .map((d) => ({
            date: d,
            elevator_ids: plans[d] || [],
            labels: (plans[d] || []).map((id) => {
              const e = elevById[id];
              return e ? `${e.dong ? e.dong + ' ' : ''}${e.hogi_no || '호기'}` : id;
            }),
          }))
          .filter((x) => x.elevator_ids.length > 0),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal onClose={onClose} title={isEdit ? '일정 수정' : '일정 등록'} width={480}>
      <div style={{ padding: 18, display: 'grid', gap: 15 }}>

        {/* 구분 */}
        <div style={{ display: 'flex', gap: 6 }}>
          {(Object.keys(KIND) as string[]).map((k) => {
            const s = KIND[k];
            const on = form.kind === k;
            return (
              <button key={k} onClick={() => set({ kind: k })} style={{
                flex: 1, height: 38, borderRadius: 10, cursor: 'pointer',
                border: `1px solid ${on ? s.color : C.line}`,
                background: on ? s.soft : '#fff', color: on ? s.color : C.inkDim,
                fontSize: 13, fontWeight: 800,
              }}>{s.label}</button>
            );
          })}
        </div>

        {/* 이름 */}
        <div>
          <label style={fieldLabel}>일정 이름</label>
          <input
            autoFocus
            value={form.title}
            onChange={(e) => set({ title: e.target.value })}
            placeholder="예: 에코빌 정기점검"
            style={field}
          />
        </div>

        {/* 기간 */}
        <div>
          <label style={fieldLabel}>점검 기간</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="date" value={form.start_date} onChange={(e) => {
              const v = e.target.value;
              set({ start_date: v, end_date: form.end_date && form.end_date < v ? v : form.end_date });
            }} style={{ ...field, flex: 1 }} />
            <span style={{ color: C.inkFaint, fontSize: 13 }}>~</span>
            <input type="date" value={form.end_date || form.start_date} min={form.start_date}
              onChange={(e) => set({ end_date: e.target.value })} style={{ ...field, flex: 1 }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
            {spanOptions.map(({ label, days: d }) => (
              <button key={label} onClick={() => set({ end_date: addDays(form.start_date, d) })} style={{
                height: 26, padding: '0 9px', borderRadius: 7, cursor: 'pointer',
                border: `1px solid ${C.line}`, background: '#fff', color: C.inkDim, fontSize: 11.5, fontWeight: 700,
              }}>{label}</button>
            ))}
            <span style={{ marginLeft: 'auto', fontSize: 12, color: C.inkFaint }}>
              {fmtDate(form.start_date)} · {dateList.length}일
            </span>
          </div>
        </div>

        {/* 현장 */}
        <div>
          <label style={fieldLabel}>현장</label>
          <button onClick={() => { setSiteOpen((v) => !v); setSiteQ(''); }} style={{
            ...field, textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
            color: pickedSite ? C.ink : C.inkFaint,
          }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, textAlign: 'left' }}>
              {pickedSite ? (pickedSite.siteName || pickedSite.name) : '현장 선택'}
            </span>
            <span style={{ color: C.inkFaint, fontSize: 11 }}>▾</span>
          </button>

          {siteOpen && (
            <div style={{ marginTop: 6, background: '#fff', border: `1px solid ${C.line}`, borderRadius: 12, overflow: 'hidden' }}>
              <input
                autoFocus value={siteQ} onChange={(e) => setSiteQ(e.target.value)}
                placeholder="현장명·주소 검색"
                style={{ ...field, border: 'none', borderBottom: `1px solid ${C.line}`, borderRadius: 0, height: 40 }}
              />
              <div style={{ maxHeight: 200, overflowY: 'auto' }}>
                {filteredSites.length === 0 && (
                  <div style={{ padding: '16px 14px', fontSize: 12.5, color: C.inkFaint, textAlign: 'center' }}>검색 결과가 없어요</div>
                )}
                {filteredSites.map((s: any) => (
                  <button key={s.id} onClick={() => {
                    set({ site_id: s.id, site_name: s.siteName || s.name || '' });
                    setSiteOpen(false); setSiteQ('');
                    setPickedDongs([]); setPlans({}); setManual(false);
                  }} style={{
                    width: '100%', textAlign: 'left', padding: '10px 14px', border: 'none', background: 'none',
                    cursor: 'pointer', borderTop: `1px solid ${C.bg}`,
                  }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: C.ink }}>{s.siteName || s.name}</div>
                    {s.address && <div style={{ fontSize: 11.5, color: C.inkFaint, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.address}</div>}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 동 선택 — 핵심 */}
        {form.site_id && (
          <div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 7 }}>
              <label style={{ ...fieldLabel, marginBottom: 0 }}>점검할 동</label>
              <span style={{ fontSize: 11.5, color: C.inkFaint }}>
                {elevLoading ? '불러오는 중...' : `누르면 ${dateList.length}일에 자동으로 나눠 배정돼요`}
              </span>
            </div>

            {elevLoading ? (
              <div style={{ padding: '16px 12px', textAlign: 'center', fontSize: 12.5, color: C.inkFaint }}>호기를 불러오는 중...</div>
            ) : dongs.length === 0 ? (
              <div style={{ padding: '16px 12px', borderRadius: 11, background: '#fafbfc', border: `1px dashed ${C.line}`, fontSize: 12.5, color: C.inkFaint, textAlign: 'center' }}>
                이 현장에 등록된 호기가 없어요
              </div>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {dongs.map(([dong, list]) => {
                  const on = pickedDongs.includes(dong);
                  return (
                    <button key={dong} onClick={() => toggleDong(dong)} style={{
                      height: 40, padding: '0 13px', borderRadius: 10, cursor: 'pointer',
                      border: `1px solid ${on ? C.primary : C.line}`,
                      background: on ? C.primary : '#fff', color: on ? '#fff' : C.inkSoft,
                      display: 'flex', alignItems: 'center', gap: 6,
                    }}>
                      <span style={{ fontSize: 13.5, fontWeight: 800 }}>{dong}</span>
                      <span style={{ fontSize: 11, opacity: 0.75 }}>{list.length}대</span>
                      {on && <span style={{ fontSize: 12 }}>✓</span>}
                    </button>
                  );
                })}
              </div>
            )}

            {pickedDongs.length > 0 && (
              <div style={{ fontSize: 11.5, color: C.primary, fontWeight: 700, marginTop: 8 }}>
                {pickedDongs.join(' · ')} · 총 {totalElevs}대 / {dateList.length}일
              </div>
            )}
          </div>
        )}

        {/* 날짜별 결과 */}
        {pickedDongs.length > 0 && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 7 }}>
              <label style={{ ...fieldLabel, marginBottom: 0 }}>날짜별 배정</label>
              <button onClick={() => {
                if (!manual) setManual(true);
                else { setManual(false); setPlans(autoDistribute(pickedDongs, dateList)); }
              }} style={{
                marginLeft: 'auto', height: 26, padding: '0 10px', borderRadius: 7, cursor: 'pointer',
                border: `1px solid ${manual ? C.primary : C.line}`,
                background: manual ? `${C.primary}12` : '#fff',
                color: manual ? C.primary : C.inkDim, fontSize: 11.5, fontWeight: 700,
              }}>{manual ? '자동 배분으로' : '날짜 직접 지정'}</button>
            </div>

            <div style={{ display: 'grid', gap: 6 }}>
              {dateList.map((d) => {
                const ids = plans[d] || [];
                const open = openDay === d;
                return (
                  <div key={d} style={{
                    border: `1px solid ${open ? C.primary + '66' : C.line}`, borderRadius: 10,
                    background: open ? `${C.primary}05` : '#fff', overflow: 'hidden',
                  }}>
                    <div
                      onClick={() => { if (manual) setOpenDay(open ? null : d); }}
                      style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 11px', cursor: manual ? 'pointer' : 'default' }}
                    >
                      <div style={{
                        width: 34, flexShrink: 0, textAlign: 'center', borderRadius: 7,
                        background: ids.length ? C.primary : '#f1f3f5', color: ids.length ? '#fff' : C.inkFaint,
                        padding: '3px 0',
                      }}>
                        <div style={{ fontSize: 9.5, lineHeight: 1.3, opacity: 0.85 }}>{Number(d.slice(5, 7))}월</div>
                        <div style={{ fontSize: 14, fontWeight: 800, lineHeight: 1.1 }}>{Number(d.slice(8, 10))}</div>
                      </div>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 700, color: ids.length ? C.ink : C.inkFaint }}>
                          {WEEK_KO[dowOf(d)]}요일 · {ids.length ? `${ids.length}대` : '없음'}
                        </div>
                        <div style={{ fontSize: 11.5, color: C.inkFaint, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {ids.length
                            ? ids.map((id) => `${elevById[id]?.dong || ''} ${elevById[id]?.hogi_no || ''}`.trim()).join(', ')
                            : '이 날은 점검 없음'}
                        </div>
                      </div>
                      {manual && <span style={{ fontSize: 11, color: C.inkFaint }}>{open ? '▲' : '▼'}</span>}
                    </div>

                    {manual && open && (
                      <div style={{ borderTop: `1px solid ${C.line}`, padding: '8px 10px', background: '#fff' }}>
                        {dongs.filter(([dg]) => pickedDongs.includes(dg)).map(([dong, list]) => (
                          <div key={dong} style={{ marginBottom: 6 }}>
                            <div style={{ fontSize: 10.5, fontWeight: 800, color: C.inkFaint, marginBottom: 4 }}>{dong}</div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(78px, 1fr))', gap: 4 }}>
                              {list.map((e: any) => {
                                const on = ids.includes(e.id);
                                return (
                                  <button key={e.id} onClick={() => toggleElevOnDay(d, e.id)} style={{
                                    height: 30, borderRadius: 7, cursor: 'pointer', fontSize: 11.5, fontWeight: 700,
                                    border: `1px solid ${on ? C.primary : C.line}`,
                                    background: on ? C.primary : '#fff', color: on ? '#fff' : C.inkDim,
                                  }}>{elevLabel(e)}</button>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 담당 */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div>
            <label style={fieldLabel}>팀</label>
            <select value={form.team} onChange={(e) => set({ team: e.target.value })} style={{ ...field, cursor: 'pointer' }}>
              <option value="">팀 없음</option>
              {teams.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label style={fieldLabel}>담당자</label>
            <input value={form.assignee} onChange={(e) => set({ assignee: e.target.value })} placeholder="이름" style={field} />
          </div>
        </div>

        {/* 반복 */}
        <div>
          <label style={fieldLabel}>반복</label>
          <div style={{ display: 'flex', gap: 6 }}>
            {repeatOptions.map(({ key: k, label }) => {
              const on = (form.repeat_rule || 'none') === k;
              return (
                <button key={k} onClick={() => set({ repeat_rule: k })} style={{
                  flex: 1, height: 34, borderRadius: 9, cursor: 'pointer',
                  border: `1px solid ${on ? C.ink : C.line}`, background: on ? C.ink : '#fff',
                  color: on ? '#fff' : C.inkDim, fontSize: 12.5, fontWeight: 700,
                }}>{label}</button>
              );
            })}
          </div>
          {form.repeat_rule !== 'none' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
              <span style={{ fontSize: 12.5, color: C.inkDim, whiteSpace: 'nowrap' }}>종료일</span>
              <input type="date" value={form.repeat_until || ''} min={form.start_date}
                onChange={(e) => set({ repeat_until: e.target.value })} style={{ ...field, height: 36, flex: 1 }} />
              {!form.repeat_until && <span style={{ fontSize: 11.5, color: C.inkFaint, whiteSpace: 'nowrap' }}>계속</span>}
            </div>
          )}
        </div>

        {/* 메모 */}
        <div>
          <label style={fieldLabel}>메모 <span style={{ color: C.inkFaint, fontWeight: 500 }}>(선택)</span></label>
          <textarea
            value={form.memo} onChange={(e) => set({ memo: e.target.value })}
            placeholder="작업 내용, 준비물 등"
            rows={2}
            style={{
              width: '100%', borderRadius: 10, border: `1px solid ${C.line}`, padding: '10px 12px',
              fontSize: 13, color: C.ink, background: '#fff', outline: 'none', resize: 'vertical',
              boxSizing: 'border-box', fontFamily: 'inherit', lineHeight: 1.55,
            }}
          />
        </div>
      </div>

      {/* 하단 버튼 */}
      <div style={{
        position: 'sticky', bottom: 0, display: 'flex', gap: 8, padding: '12px 18px',
        borderTop: `1px solid ${C.line}`, background: C.surface,
      }}>
        {isEdit ? (
          <button onClick={() => onDelete(form)} style={{
            height: 44, padding: '0 14px', borderRadius: 11, border: `1px solid ${C.line}`,
            background: '#fff', color: '#ef4444', fontSize: 13.5, fontWeight: 700, cursor: 'pointer',
          }}>삭제</button>
        ) : <div style={{ flex: 1 }} />}
        <button onClick={onClose} style={{
          height: 44, padding: '0 16px', borderRadius: 11, border: `1px solid ${C.line}`,
          background: '#fff', color: C.inkDim, fontSize: 13.5, fontWeight: 700, cursor: 'pointer',
        }}>취소</button>
        <button onClick={submit} disabled={saving || !form.title.trim()} style={{
          flex: 2, height: 44, borderRadius: 11, border: 'none', background: C.ink, color: '#fff',
          fontSize: 14.5, fontWeight: 800, cursor: 'pointer', opacity: saving || !form.title.trim() ? 0.5 : 1,
        }}>{saving ? '저장 중...' : isEdit ? '수정' : '등록'}</button>
      </div>
    </Modal>
  );
}
