'use client';

/**
 * app/ops/page.tsx — 관리자 운영 홈 (새 디자인)
 *
 * - 관리자 사이드바(TabBar)의 '홈'이 이 페이지로 연결됩니다.
 * - 기존 /dashboard 는 건드리지 않습니다 (비교 후 교체 결정).
 * - 확인된 테이블: users, teams, sites, elevators, site_inspection_units
 * - 고장(fault_reports): 완료 여부는 completed_at 또는 status로 판단
 *   (테이블/컬럼이 다르면 고장 카드만 비고 나머지는 정상 동작)
 */

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { C } from '@/lib/theme';
import TabBar from '@/components/TabBar';

// ── 타입 ─────────────────────────────────────
interface Me { uid: string; name: string; companyId: string; companyName: string; }
interface Site { id: string; name: string; address: string; team: string; contractType: string; }
interface Elev { id: string; siteId: string; }
interface Unit { elevatorId: string; year: number; month: number; completed: boolean; completedBy: string; }
interface Member { name: string; team: string; role: string; }
interface Fault { id: string; siteName: string; siteId: string; team: string; symptom: string; done: boolean; createdAt: string; }

const RED = '#ef4444';
// 홈 화면에서 숨길 팀 (관리용 팀 등)
const HIDDEN_TEAMS = ['운영팀'];
const TEAM_COLORS = ['#3b5bdb', '#0ca678', '#f08c00', '#ae3ec9', '#1098ad', '#e8590c', '#5c7cfa', '#2b8a3e'];

// ── 헬퍼 ─────────────────────────────────────
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
function ago(v: string) {
  if (!v) return '';
  const m = Math.floor((Date.now() - new Date(v).getTime()) / 60000);
  if (m < 1) return '방금';
  if (m < 60) return `${m}분 전`;
  if (m < 1440) return `${Math.floor(m / 60)}시간 전`;
  return `${Math.floor(m / 1440)}일 전`;
}

export default function OpsHomePage() {
  const router = useRouter();
  const now = new Date();
  const Y = now.getFullYear();
  const M = now.getMonth() + 1;

  const [me, setMe] = useState<Me | null>(null);
  const [teams, setTeams] = useState<string[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [elevs, setElevs] = useState<Elev[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [faults, setFaults] = useState<Fault[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [team, setTeam] = useState('전체');

  useEffect(() => {
    const t = localStorage.getItem('lf_ops_team');
    if (t) setTeam(t);
  }, []);
  const chooseTeam = (t: string) => { setTeam(t); localStorage.setItem('lf_ops_team', t); };

  // ── 인증 + 관리자 체크 ──
  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.push('/login'); return; }
      const { data: u } = await supabase
        .from('users')
        .select('name, company_id, company_display_name, role, super_admin')
        .eq('id', session.user.id)
        .single();
      if (!u) { router.push('/login'); return; }
      if (!(u.role === 'admin' || u.super_admin === true)) { router.push('/work'); return; }
      setMe({ uid: session.user.id, name: u.name || '', companyId: u.company_id || '', companyName: u.company_display_name || '' });
    })();
  }, [router]);

  // ── 데이터 로드 ──
  useEffect(() => {
    if (!me) return;
    const cid = me.companyId;
    (async () => {
      // 최근 6개월 범위
      const from = new Date(Y, M - 6, 1);
      const fromY = from.getFullYear();

      const [tRes, sRes, eRes, uRes, mRes] = await Promise.all([
        supabase.from('teams').select('name').eq('company_id', cid).order('name'),
        supabase.from('sites').select('id, site_name, name, address, team, contract_type').eq('company_id', cid),
        supabase.from('elevators').select('id, site_id').eq('company_id', cid),
        supabase.from('site_inspection_units')
          .select('elevator_id, year, month, completed, completed_by')
          .eq('company_id', cid).gte('year', fromY).eq('completed', true),
        supabase.from('users').select('name, team, role').eq('company_id', cid),
      ]);

      setTeams((tRes.data || []).map((t: any) => t.name).filter(Boolean));
      setSites((sRes.data || []).map((s: any) => ({
        id: s.id, name: s.name || s.site_name || '', address: s.address || '',
        team: s.team || '', contractType: s.contract_type || '',
      })));
      setElevs((eRes.data || []).map((e: any) => ({ id: e.id, siteId: e.site_id })));
      setUnits((uRes.data || []).filter((r: any) => r.elevator_id).map((r: any) => ({
        elevatorId: r.elevator_id, year: r.year, month: r.month, completed: !!r.completed, completedBy: r.completed_by || '',
      })));
      setMembers((mRes.data || []).map((m: any) => ({ name: m.name || '', team: m.team || '', role: m.role || 'member' })));
      setLoading(false);

      // 고장 (컬럼 미확인 → 방어적으로)
      const fRes = await supabase.from('fault_reports').select('*').eq('company_id', cid)
        .order('created_at', { ascending: false }).limit(50);
      if (fRes.error) { console.warn('[ops] fault_reports 읽기 실패:', fRes.error.message); setFaults([]); return; }
      // fault_reports 확인된 컬럼: site_id, site_name, hogi_no, content, team, team_name, status, created_at, completed_at ...
      setFaults((fRes.data || []).map((f: any) => {
        const st = String(f.status || '').toLowerCase();
        const hogi = f.hogi_no || f.elevator_no || '';
        return {
          id: f.id,
          siteId: f.site_id || '',
          siteName: [f.site_name, hogi && (String(hogi).includes('호기') ? hogi : `${hogi}호기`)].filter(Boolean).join(' '),
          team: f.team_name || f.team || '',
          symptom: f.content || f.fault_cause || '',
          done: !!f.completed_at || ['done', 'completed', 'complete', 'resolved', '완료', '처리완료'].includes(st),
          createdAt: f.created_at || f.received_at || '',
        };
      }));
    })();
  }, [me, Y, M]);

  // ── 파생 데이터 ──
  const siteById = useMemo(() => Object.fromEntries(sites.map(s => [s.id, s])), [sites]);
  const elevSite = useMemo(() => Object.fromEntries(elevs.map(e => [e.id, e.siteId])), [elevs]);
  const teamList = useMemo(() => {
    const fromSites = Array.from(new Set(sites.map(s => s.team).filter(Boolean)));
    return (teams.length ? teams : fromSites)
      .filter(t => fromSites.includes(t) || teams.includes(t))
      .filter(t => !HIDDEN_TEAMS.includes(t));
  }, [teams, sites]);
  const teamColor = (t: string) => TEAM_COLORS[Math.max(0, teamList.indexOf(t)) % TEAM_COLORS.length];

  const inTeam = (t: string) => team === '전체' || t === team;

  // 현장별 이번 달 완료 수
  const doneThisMonth = useMemo(() => {
    const set = new Set(units.filter(u => u.year === Y && u.month === M).map(u => u.elevatorId));
    return set;
  }, [units, Y, M]);

  const siteStats = useMemo(() => {
    const map: Record<string, { total: number; done: number }> = {};
    elevs.forEach(e => {
      if (!map[e.siteId]) map[e.siteId] = { total: 0, done: 0 };
      map[e.siteId].total++;
      if (doneThisMonth.has(e.id)) map[e.siteId].done++;
    });
    return map;
  }, [elevs, doneThisMonth]);

  const statOf = (t: string) => {
    const ss = sites.filter(s => t === '전체' || s.team === t);
    let total = 0, done = 0, doneSites = 0, zero = 0;
    ss.forEach(s => {
      const x = siteStats[s.id]; if (!x) return;
      total += x.total; done += x.done;
      if (x.total && x.done === x.total) doneSites++;
      if (x.total && x.done === 0) zero++;
    });
    const fs = (faults || []).filter(f => t === '전체' || (f.team || siteById[f.siteId]?.team) === t);
    return {
      sites: ss.length, total, done, left: total - done, pct: pct(done, total), doneSites, zero,
      open: fs.filter(f => !f.done).length, faultsAll: fs.length,
      full: ss.filter(s => s.contractType.includes('종합')).length,
    };
  };
  const st = statOf(team);

  const lowSites = useMemo(() => sites
    .filter(s => inTeam(s.team) && siteStats[s.id]?.total && siteStats[s.id].done < siteStats[s.id].total)
    .map(s => ({ ...s, ...siteStats[s.id], p: pct(siteStats[s.id].done, siteStats[s.id].total) }))
    .sort((a, b) => a.p - b.p || b.total - a.total)
    .slice(0, 7), [sites, siteStats, team]);

  const recentFaults = (faults || []).filter(f => inTeam(f.team || siteById[f.siteId]?.team || '')).slice(0, 6);

  const monthly = useMemo(() => {
    const totalElev = elevs.filter(e => inTeam(siteById[e.siteId]?.team || '')).length;
    const out: { label: string; p: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(Y, M - 1 - i, 1);
      const y = d.getFullYear(), m = d.getMonth() + 1;
      const set = new Set(units.filter(u => u.year === y && u.month === m
        && inTeam(siteById[elevSite[u.elevatorId]]?.team || '')).map(u => u.elevatorId));
      out.push({ label: `${m}월`, p: pct(set.size, totalElev) });
    }
    return out;
  }, [units, elevs, siteById, elevSite, team, Y, M]);

  const memberRows = useMemo(() => {
    const cnt: Record<string, number> = {};
    units.filter(u => u.year === Y && u.month === M).forEach(u => { cnt[u.completedBy] = (cnt[u.completedBy] || 0) + 1; });
    return members.filter(m => inTeam(m.team)).map(m => ({ ...m, n: cnt[m.name] || 0 })).sort((a, b) => b.n - a.n);
  }, [members, units, team, Y, M]);

  // ── 렌더 ──
  if (!me || loading) {
    return (
      <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.inkDim }}>
        로딩 중...
        <TabBar active="home" />
      </div>
    );
  }

  const card: React.CSSProperties = { background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14, overflow: 'hidden' };
  const cardH: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, padding: '14px 18px', borderBottom: `1px solid ${C.line}` };
  const h3: React.CSSProperties = { fontSize: 15, fontWeight: 800, color: C.ink, margin: 0 };
  const sub: React.CSSProperties = { fontSize: 12, color: C.inkFaint };
  const more = (path: string, label = '전체 →') => (
    <button onClick={() => router.push(path)} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: C.primary, fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>{label}</button>
  );
  const bar = (p: number, color: string, w: number | string = '100%', h = 8) => (
    <div style={{ width: w, height: h, borderRadius: h, background: C.bg, overflow: 'hidden', flexShrink: 0 }}>
      <div style={{ width: `${p}%`, height: '100%', background: color, borderRadius: h, transition: 'width .3s' }} />
    </div>
  );
  const kpi = (label: string, value: React.ReactNode, unit: string, foot: React.ReactNode, color?: string, onClick?: () => void) => (
    <div onClick={onClick} style={{ ...card, padding: '16px 18px', cursor: onClick ? 'pointer' : 'default' }}>
      <div style={{ fontSize: 12.5, color: C.inkDim, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 800, color: color || C.ink, marginTop: 6, letterSpacing: -0.5 }}>
        {value}<span style={{ fontSize: 14, color: C.inkFaint, fontWeight: 600, marginLeft: 2 }}>{unit}</span>
      </div>
      <div style={{ ...sub, marginTop: 4 }}>{foot}</div>
    </div>
  );

  const gen = st.sites - st.full;

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.ink }}>
      {/* 상단 헤더 */}
      <header style={{
        position: 'sticky', top: 0, zIndex: 20, background: `${C.bg}ee`, backdropFilter: 'blur(8px)',
        borderBottom: `1px solid ${C.line}`, height: 64, display: 'flex', alignItems: 'center', gap: 16, padding: '0 28px',
      }}>
        <div>
          <div style={sub}>{me.companyName || '운영'}</div>
          <div style={{ fontSize: 18, fontWeight: 800 }}>홈</div>
        </div>
        {/* 팀 전환 */}
        <div style={{ display: 'flex', background: C.line, borderRadius: 10, padding: 3, gap: 2, marginLeft: 8, overflowX: 'auto' }}>
          {['전체', ...teamList].map(t => {
            const on = t === team;
            return (
              <button key={t} onClick={() => chooseTeam(t)} style={{
                height: 32, padding: '0 14px', borderRadius: 8, border: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
                background: on ? '#fff' : 'transparent', color: on ? C.ink : C.inkDim, fontWeight: 700, fontSize: 13,
                boxShadow: on ? '0 1px 3px rgba(0,0,0,.08)' : 'none', display: 'flex', alignItems: 'center', gap: 6,
              }}>
                {t !== '전체' && <span style={{ width: 8, height: 8, borderRadius: '50%', background: teamColor(t) }} />}
                {t}
                <span style={{ fontSize: 11.5, color: C.inkFaint, fontWeight: 600 }}>{statOf(t).sites}</span>
              </button>
            );
          })}
        </div>
        <div style={{ marginLeft: 'auto', ...sub, whiteSpace: 'nowrap' }}>
          {Y}년 {M}월 {now.getDate()}일
        </div>
      </header>

      <main style={{ padding: '22px 28px 60px', maxWidth: 1400 }}>
        {/* KPI */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 14 }}>
          {kpi(`${M}월 점검 완료율`, st.pct, '%', `${st.done} / ${st.total}대 완료`)}
          {kpi('남은 점검', st.left, '대', <span style={{ color: st.zero ? RED : undefined }}>미착수 현장 {st.zero}곳</span>, undefined, () => router.push('/inspection'))}
          {kpi('미처리 고장', faults ? st.open : '—', '건', `최근 접수 ${faults ? st.faultsAll : '—'}건`, st.open ? RED : undefined, () => router.push('/fault'))}
          {kpi('관리 현장', st.sites, '곳', `점검 완료 현장 ${st.doneSites}곳`)}
          {kpi('관리 승강기', st.total, '대', `종합계약 ${st.full}곳 · 일반 ${gen}곳`)}
        </div>

        {/* 팀 카드 (전체일 때만) */}
        {team === '전체' && teamList.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(240px, 1fr))`, gap: 12, marginBottom: 14 }}>
            {teamList.map(t => {
              const x = statOf(t); const c = teamColor(t);
              return (
                <div key={t} onClick={() => chooseTeam(t)} style={{ ...card, padding: '16px 18px', cursor: 'pointer', borderTop: `3px solid ${c}` }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <b style={{ fontSize: 16 }}>{t}</b>
                    <span style={sub}>{members.filter(m => m.team === t).length}명</span>
                    <b style={{ marginLeft: 'auto', fontSize: 24, letterSpacing: -0.5 }}>{x.pct}%</b>
                  </div>
                  <div style={{ margin: '10px 0 14px' }}>{bar(x.pct, c)}</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 6 }}>
                    {[['현장', `${x.sites}곳`], ['승강기', `${x.total}대`], ['남은 점검', `${x.left}대`], ['고장', `${faults ? x.open : '—'}건`]].map(([k, v], i) => (
                      <div key={k} style={{ fontSize: 11, color: C.inkFaint, whiteSpace: 'nowrap', minWidth: 0 }}>{k}
                        <div style={{ fontSize: 15, fontWeight: 800, marginTop: 2, whiteSpace: 'nowrap', color: i === 3 && x.open ? RED : C.ink }}>{v}</div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* 점검 미완료 / 최근 고장 */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 14, marginBottom: 14 }}>
          <div style={card}>
            <div style={cardH}><h3 style={h3}>점검 미완료 현장</h3><span style={sub}>진행률 낮은 순</span>{more('/inspection', '점검 화면 →')}</div>
            {lowSites.length === 0 && <div style={{ padding: 40, textAlign: 'center', color: C.inkFaint }}>모든 현장 점검 완료</div>}
            {lowSites.map(s => (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 18px', borderBottom: `1px solid ${C.bg}` }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</div>
                  <div style={sub}>{s.team || '팀 미지정'} · {s.total}대 · {s.done}대 완료</div>
                </div>
                {bar(s.p, teamColor(s.team), 90, 6)}
                <b style={{ width: 42, textAlign: 'right', color: s.p === 0 ? RED : C.ink }}>{s.p}%</b>
              </div>
            ))}
          </div>

          <div style={card}>
            <div style={cardH}><h3 style={h3}>최근 고장 접수</h3>{faults && <span style={sub}>미처리 {st.open}건</span>}{more('/fault')}</div>
            {faults === null && <div style={{ padding: 40, textAlign: 'center', color: C.inkFaint }}>불러오는 중...</div>}
            {faults && recentFaults.length === 0 && <div style={{ padding: 40, textAlign: 'center', color: C.inkFaint }}>접수된 고장이 없습니다</div>}
            {recentFaults.map(f => (
              <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 18px', borderBottom: `1px solid ${C.bg}` }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: f.done ? C.green : RED, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {f.siteName || siteById[f.siteId]?.name || '현장 미상'}
                  </div>
                  <div style={sub}>{f.symptom || '-'}{(f.team || siteById[f.siteId]?.team) ? ` · ${f.team || siteById[f.siteId]?.team}` : ''}</div>
                </div>
                <span style={{ ...sub, whiteSpace: 'nowrap' }}>{f.done ? '처리완료' : ago(f.createdAt)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* 월별 / 계약 / 팀원 */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 14 }}>
          <div style={card}>
            <div style={cardH}><h3 style={h3}>월별 점검 완료율</h3><span style={sub}>최근 6개월</span></div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, height: 180, padding: '18px 18px 12px' }}>
              {monthly.map((m, i) => (
                <div key={m.label} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', gap: 6, height: '100%' }}>
                  <b style={{ fontSize: 11.5, color: C.inkSoft }}>{m.p}%</b>
                  <div style={{ width: '100%', maxWidth: 34, height: Math.max(4, m.p * 1.1), borderRadius: '5px 5px 2px 2px', background: i === monthly.length - 1 ? C.primary : C.line }} />
                  <span style={{ fontSize: 11, color: C.inkFaint }}>{m.label}</span>
                </div>
              ))}
            </div>
          </div>

          <div style={card}>
            <div style={cardH}><h3 style={h3}>계약 현황</h3>{more('/team-sites', '팀별현장 →')}</div>
            <div style={{ padding: '18px' }}>
              <div style={{ display: 'flex', height: 12, borderRadius: 6, overflow: 'hidden', gap: 2, marginBottom: 14, background: C.bg }}>
                <div style={{ flex: st.full || 0.0001, background: C.primary }} />
                <div style={{ flex: gen || 0.0001, background: C.line }} />
              </div>
              {[['종합계약', st.full, C.primary], ['일반계약', gen, C.line]].map(([k, v, c]) => (
                <div key={k as string} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', fontSize: 13 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 3, background: c as string }} />{k}
                  <b style={{ marginLeft: 'auto' }}>{v as number}곳</b>
                  <span style={{ ...sub, width: 44, textAlign: 'right' }}>{pct(v as number, st.sites)}%</span>
                </div>
              ))}
            </div>
          </div>

          <div style={card}>
            <div style={cardH}><h3 style={h3}>팀원 현황</h3><span style={sub}>{memberRows.length}명 · 이번 달 점검</span></div>
            {memberRows.slice(0, 6).map(m => (
              <div key={m.name + m.team} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 18px', borderBottom: `1px solid ${C.bg}` }}>
                <div style={{ width: 30, height: 30, borderRadius: '50%', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 12, color: C.inkSoft }}>
                  {m.name[0] || '?'}
                </div>
                <div style={{ minWidth: 0 }}>
                  <b style={{ fontSize: 13.5 }}>{m.name}</b>{' '}
                  <span style={sub}>{m.team || '팀 미지정'}{m.role === 'admin' ? ' · 관리자' : ''}</span>
                </div>
                <b style={{ marginLeft: 'auto' }}>{m.n}<span style={{ ...sub, fontWeight: 500 }}> 대</span></b>
              </div>
            ))}
            {memberRows.length === 0 && <div style={{ padding: 40, textAlign: 'center', color: C.inkFaint }}>팀원이 없습니다</div>}
          </div>
        </div>
      </main>

      <TabBar active="home" />
    </div>
  );
}
