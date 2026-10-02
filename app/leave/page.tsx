'use client';

/**
 * app/leave/page.tsx — 연차/휴가 관리 (v2 디자인: 관리자 홈과 같은 스타일)
 * - 데이터: leave_requests, users.annual_leave, teams (기존과 동일)
 * - 승인/거절/삭제 로직은 기존 코드 그대로
 */

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { C } from '@/lib/theme';
import TabBar from '@/components/TabBar';

interface Member { id: string; name: string; team: string; annual_leave: number; }
interface LeaveRequest {
  id: string; user_id: string; user_name: string; type: string;
  start_date: string; end_date: string; reason: string;
  status: 'pending' | 'approved' | 'rejected'; created_at?: string;
}
type View = 'requests' | 'calendar' | 'balance';
type Hist = 'all' | 'approved' | 'rejected';

const RED = '#ef4444';
const HIDDEN_TEAMS = ['운영팀'];
const TEAM_COLORS = ['#3b5bdb', '#0ca678', '#f08c00', '#ae3ec9', '#1098ad', '#e8590c', '#5c7cfa', '#2b8a3e'];
const TYPE_STYLE: Record<string, { bg: string; fg: string }> = {
  연차: { bg: '#e7f0ff', fg: '#2f6fed' },
  반차: { bg: '#f3e8ff', fg: '#8b3fd9' },
  휴가: { bg: '#e6f7ee', fg: '#12805c' },
};
const typeStyle = (t: string) => TYPE_STYLE[t] || { bg: '#fff1e6', fg: '#d9630b' };
const WEEK = ['일', '월', '화', '수', '목', '금', '토'];

// ─── 법정 공휴일 (대체공휴일·임시공휴일 포함) ───
// 음력 공휴일(설날·부처님오신날·추석)은 매년 바뀌므로 해마다 추가해 주세요.
// 정부가 임시공휴일을 새로 지정하면 여기에 한 줄 추가하면 됩니다.
const HOLIDAYS: Record<string, string> = {
  // 2025
  '2025-01-01': '신정',
  '2025-01-27': '임시공휴일', '2025-01-28': '설날 연휴', '2025-01-29': '설날', '2025-01-30': '설날 연휴',
  '2025-03-01': '삼일절', '2025-03-03': '대체공휴일',
  '2025-05-05': '어린이날·부처님오신날', '2025-05-06': '대체공휴일',
  '2025-06-03': '대통령선거', '2025-06-06': '현충일',
  '2025-08-15': '광복절',
  '2025-10-03': '개천절', '2025-10-05': '추석 연휴', '2025-10-06': '추석', '2025-10-07': '추석 연휴', '2025-10-08': '대체공휴일',
  '2025-10-09': '한글날', '2025-12-25': '성탄절',
  // 2026
  '2026-01-01': '신정',
  '2026-02-16': '설날 연휴', '2026-02-17': '설날', '2026-02-18': '설날 연휴',
  '2026-03-01': '삼일절', '2026-03-02': '대체공휴일',
  '2026-05-05': '어린이날',
  '2026-05-24': '부처님오신날', '2026-05-25': '대체공휴일',
  '2026-06-03': '지방선거', '2026-06-06': '현충일',
  '2026-08-15': '광복절', '2026-08-17': '대체공휴일',
  '2026-09-24': '추석 연휴', '2026-09-25': '추석', '2026-09-26': '추석 연휴',
  '2026-10-03': '개천절', '2026-10-05': '대체공휴일',
  '2026-10-09': '한글날', '2026-12-25': '성탄절',
  // 2027
  '2027-01-01': '신정',
  '2027-02-06': '설날 연휴', '2027-02-07': '설날', '2027-02-08': '설날 연휴', '2027-02-09': '대체공휴일',
  '2027-03-01': '삼일절',
  '2027-05-05': '어린이날', '2027-05-13': '부처님오신날',
  '2027-06-06': '현충일',
  '2027-08-15': '광복절', '2027-08-16': '대체공휴일',
  '2027-09-14': '추석 연휴', '2027-09-15': '추석', '2027-09-16': '추석 연휴',
  '2027-10-03': '개천절', '2027-10-04': '대체공휴일',
  '2027-10-09': '한글날', '2027-10-11': '대체공휴일',
  '2027-12-25': '성탄절', '2027-12-27': '대체공휴일',
};
const holidayOf = (ds: string) => HOLIDAYS[ds] || '';

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const todayStr = () => { const d = new Date(); return ymd(d.getFullYear(), d.getMonth() + 1, d.getDate()); };
const endOf = (l: LeaveRequest) => l.end_date || l.start_date;
const covers = (l: LeaveRequest, ds: string) => l.start_date <= ds && endOf(l) >= ds;
function leaveDays(l: LeaveRequest) {
  if (l.type === '반차') return 0.5;
  const s = new Date(l.start_date), e = new Date(endOf(l));
  if (isNaN(s.getTime()) || isNaN(e.getTime())) return 0;
  return Math.max(1, Math.round((e.getTime() - s.getTime()) / 86400000) + 1);
}
const fmtRange = (l: LeaveRequest) => {
  const s = l.start_date.slice(5).replace('-', '.'), e = endOf(l).slice(5).replace('-', '.');
  return s === e ? s : `${s} ~ ${e}`;
};

export default function LeavePage() {
  const router = useRouter();
  const [userInfo, setUserInfo] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [members, setMembers] = useState<Member[]>([]);
  const [teams, setTeams] = useState<string[]>([]);
  const [leaves, setLeaves] = useState<LeaveRequest[]>([]);
  const [view, setView] = useState<View>('requests');
  const [hist, setHist] = useState<Hist>('all');
  const [team, setTeam] = useState('전체');
  const [busy, setBusy] = useState<string | null>(null);
  const now = new Date();
  const [cal, setCal] = useState({ y: now.getFullYear(), m: now.getMonth() + 1 });

  const canEdit = userInfo?.role === 'admin' || userInfo?.super_admin === true;

  // ─── 인증 ───
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!session) { router.push('/login'); return; }
      const { data: userData, error } = await supabase.from('users').select('*').eq('id', session.user.id).single();
      if (error || !userData) { router.push('/login'); return; }
      if (!userData.company_id) { router.push('/'); return; }
      // 관리자 전용 화면 — 팀원은 본인 휴가 신청 화면으로
      if (!(userData.role === 'admin' || userData.super_admin === true)) { router.replace('/my-leave'); return; }
      setUserInfo({ uid: session.user.id, ...userData });
      await loadData(userData.company_id);
    });
    return () => subscription.unsubscribe();
  }, []);

  const loadData = async (companyId: string) => {
    try {
      const [mRes, tRes, lRes] = await Promise.all([
        supabase.from('users').select('id, name, team, annual_leave').eq('company_id', companyId),
        supabase.from('teams').select('name').eq('company_id', companyId).order('name'),
        supabase.from('leave_requests').select('*').eq('company_id', companyId).order('created_at', { ascending: false }),
      ]);
      const list: Member[] = (mRes.data || []).map((d: any) => ({
        id: d.id, name: d.name || '', team: d.team || '', annual_leave: d.annual_leave ?? 15,
      }));
      setMembers(list);
      const tn = (tRes.data || []).map((t: any) => t.name).filter(Boolean);
      setTeams((tn.length ? tn : Array.from(new Set(list.map(m => m.team).filter(Boolean)))).filter((t: string) => !HIDDEN_TEAMS.includes(t)));
      setLeaves((lRes.data || []) as LeaveRequest[]);
    } catch (e) { console.error(e); } finally { setLoading(false); }
  };

  // ─── 승인/거절 (기존 로직) ───
  async function handleLeaveStatus(leaveId: string, status: 'approved' | 'rejected') {
    setBusy(leaveId);
    try {
      const { error } = await supabase.from('leave_requests').update({ status }).eq('id', leaveId);
      if (error) throw error;
      setLeaves(prev => prev.map(l => l.id === leaveId ? { ...l, status } : l));
    } catch (e) { console.error(e); alert('처리 실패: ' + e); } finally { setBusy(null); }
  }
  // ─── 삭제 (기존 로직) ───
  async function handleDeleteLeave(leaveId: string) {
    if (!confirm('휴가 신청을 삭제할까요?')) return;
    try {
      const { error } = await supabase.from('leave_requests').delete().eq('id', leaveId);
      if (error) throw error;
      setLeaves(prev => prev.filter(l => l.id !== leaveId));
    } catch (e) { console.error(e); }
  }

  // ─── 파생 데이터 ───
  const memberById = useMemo(() => Object.fromEntries(members.map(m => [m.id, m])), [members]);
  const teamOf = (l: LeaveRequest) => memberById[l.user_id]?.team || '';
  const teamColor = (t: string) => (t ? TEAM_COLORS[Math.max(0, teams.indexOf(t)) % TEAM_COLORS.length] : C.inkFaint);
  const inTeam = (t: string) => team === '전체' || t === team;
  const year = now.getFullYear();
  const today = todayStr();

  const tl = leaves.filter(l => inTeam(teamOf(l)));
  const pending = tl.filter(l => l.status === 'pending').sort((a, b) => a.start_date.localeCompare(b.start_date));
  const approved = tl.filter(l => l.status === 'approved');
  const onToday = approved.filter(l => covers(l, today));
  const upcoming = approved.filter(l => l.start_date > today).sort((a, b) => a.start_date.localeCompare(b.start_date));
  const in7 = (() => { const d = new Date(); d.setDate(d.getDate() + 7); return ymd(d.getFullYear(), d.getMonth() + 1, d.getDate()); })();
  const weekCount = upcoming.filter(l => l.start_date <= in7).length;
  const history = tl.filter(l => l.status !== 'pending' && (hist === 'all' || l.status === hist));

  const balances = useMemo(() => members.filter(m => inTeam(m.team) && !HIDDEN_TEAMS.includes(m.team)).map(m => {
    const mine = leaves.filter(l => l.user_id === m.id && l.status === 'approved' && (l.start_date || '').startsWith(String(year)));
    const used = mine.filter(l => l.type === '연차' || l.type === '반차').reduce((a, l) => a + leaveDays(l), 0);
    const other = mine.filter(l => l.type !== '연차' && l.type !== '반차').reduce((a, l) => a + leaveDays(l), 0);
    const pend = leaves.filter(l => l.user_id === m.id && l.status === 'pending').length;
    return { ...m, used, other, left: m.annual_leave - used, pend };
  }).sort((a, b) => a.left - b.left), [members, leaves, team, year]);
  const avgUse = balances.length ? Math.round(balances.reduce((a, b) => a + (b.annual_leave ? b.used / b.annual_leave : 0), 0) / balances.length * 100) : 0;

  // 달력
  const calDays = useMemo(() => {
    const first = new Date(cal.y, cal.m - 1, 1).getDay();
    const last = new Date(cal.y, cal.m, 0).getDate();
    const cells: (null | { d: number; ds: string; hol: string; list: LeaveRequest[] })[] = [];
    for (let i = 0; i < first; i++) cells.push(null);
    for (let d = 1; d <= last; d++) {
      const ds = ymd(cal.y, cal.m, d);
      cells.push({ d, ds, hol: holidayOf(ds), list: tl.filter(l => l.status !== 'rejected' && covers(l, ds)) });
    }
    while (cells.length % 7) cells.push(null);
    return cells;
  }, [cal, tl]);
  const moveCal = (n: number) => setCal(c => { const d = new Date(c.y, c.m - 1 + n, 1); return { y: d.getFullYear(), m: d.getMonth() + 1 }; });

  // ─── 스타일 헬퍼 ───
  const card: React.CSSProperties = { background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14, overflow: 'hidden' };
  const cardH: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, padding: '14px 18px', borderBottom: `1px solid ${C.line}` };
  const h3: React.CSSProperties = { fontSize: 15, fontWeight: 800, color: C.ink, margin: 0 };
  const sub: React.CSSProperties = { fontSize: 12, color: C.inkFaint };
  const empty = (t: string) => <div style={{ padding: '40px 16px', textAlign: 'center', color: C.inkFaint, fontSize: 13 }}>{t}</div>;
  const avatar = (name: string, t: string, size = 36) => (
    <div style={{ width: size, height: size, borderRadius: '50%', background: `${teamColor(t)}1a`, color: teamColor(t), display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: size * 0.38, flexShrink: 0 }}>
      {name?.[0] || '?'}
    </div>
  );
  const typeChip = (t: string) => { const s = typeStyle(t); return <span style={{ fontSize: 11.5, fontWeight: 700, padding: '2px 8px', borderRadius: 6, background: s.bg, color: s.fg, whiteSpace: 'nowrap' }}>{t}</span>; };
  const teamChip = (t: string) => t ? (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: C.inkDim, whiteSpace: 'nowrap' }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: teamColor(t) }} />{t}
    </span>
  ) : <span style={sub}>팀 미지정</span>;
  const kpi = (label: string, value: React.ReactNode, unit: string, foot: React.ReactNode, color?: string, onClick?: () => void) => (
    <div onClick={onClick} style={{ ...card, padding: '16px 18px', cursor: onClick ? 'pointer' : 'default' }}>
      <div style={{ fontSize: 12.5, color: C.inkDim, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 800, color: color || C.ink, marginTop: 6, letterSpacing: -0.5 }}>
        {value}<span style={{ fontSize: 14, color: C.inkFaint, fontWeight: 600, marginLeft: 2 }}>{unit}</span>
      </div>
      <div style={{ ...sub, marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{foot}</div>
    </div>
  );
  const seg = <T extends string>(items: [T, string, number?][], val: T, set: (v: T) => void) => (
    <div style={{ display: 'flex', background: C.line, borderRadius: 10, padding: 3, gap: 2 }}>
      {items.map(([k, label, n]) => {
        const on = k === val;
        return (
          <button key={k} onClick={() => set(k)} style={{
            height: 30, padding: '0 12px', borderRadius: 8, border: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
            background: on ? '#fff' : 'transparent', color: on ? C.ink : C.inkDim, fontWeight: 700, fontSize: 13,
            boxShadow: on ? '0 1px 3px rgba(0,0,0,.08)' : 'none', display: 'flex', alignItems: 'center', gap: 6,
          }}>
            {label}{n != null && n > 0 && <span style={{ fontSize: 11, fontWeight: 800, background: RED, color: '#fff', borderRadius: 9, padding: '0 6px', lineHeight: '17px' }}>{n}</span>}
          </button>
        );
      })}
    </div>
  );

  if (loading) return (
    <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.inkDim }}>
      로딩 중...<TabBar active="leave" />
    </div>
  );

  // ─── 승인 대기 카드 ───
  const pendingCard = (l: LeaveRequest) => {
    const t = teamOf(l);
    const m = memberById[l.user_id];
    const bal = balances.find(b => b.id === l.user_id);
    const overlap = approved.filter(o => o.user_id !== l.user_id && teamOf(o) === t && o.start_date <= endOf(l) && endOf(o) >= l.start_date);
    return (
      <div key={l.id} style={{ border: `1px solid ${C.line}`, borderRadius: 12, padding: 14, background: '#fff' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {avatar(l.user_name, t)}
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <b style={{ fontSize: 14.5, color: C.ink }}>{l.user_name}</b>{typeChip(l.type)}
            </div>
            <div style={{ marginTop: 2 }}>{teamChip(t)}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: C.ink }}>{fmtRange(l)}</div>
            <div style={sub}>{leaveDays(l)}일{bal && (l.type === '연차' || l.type === '반차') ? ` · 잔여 ${bal.left}일` : ''}</div>
          </div>
        </div>
        {l.reason && <div style={{ marginTop: 10, fontSize: 13, color: C.inkSoft, background: C.bg, borderRadius: 8, padding: '8px 10px' }}>{l.reason}</div>}
        {overlap.length > 0 && (
          <div style={{ marginTop: 8, fontSize: 12, color: '#b45309' }}>
            같은 팀 {overlap.map(o => o.user_name).join(', ')} 님과 기간이 겹쳐요
          </div>
        )}
        {bal && bal.left - leaveDays(l) < 0 && (l.type === '연차' || l.type === '반차') && (
          <div style={{ marginTop: 6, fontSize: 12, color: RED }}>승인하면 잔여 연차가 부족해요 ({bal.left - leaveDays(l)}일)</div>
        )}
        {canEdit && (
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button disabled={busy === l.id} onClick={() => handleLeaveStatus(l.id, 'rejected')}
              style={{ flex: 1, height: 38, borderRadius: 10, border: `1px solid ${C.line}`, background: '#fff', color: C.inkDim, fontWeight: 700, cursor: 'pointer' }}>거절</button>
            <button disabled={busy === l.id} onClick={() => handleLeaveStatus(l.id, 'approved')}
              style={{ flex: 2, height: 38, borderRadius: 10, border: 'none', background: C.primary, color: '#fff', fontWeight: 800, cursor: 'pointer', opacity: busy === l.id ? 0.6 : 1 }}>
              {busy === l.id ? '처리 중...' : '승인'}
            </button>
          </div>
        )}
        {!m && <div style={{ ...sub, marginTop: 6 }}>※ 직원 목록에 없는 신청자</div>}
      </div>
    );
  };

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.ink, paddingBottom: 120 }}>
      {/* 헤더 */}
      <header style={{
        position: 'sticky', top: 0, zIndex: 20, background: `${C.bg}ee`, backdropFilter: 'blur(8px)',
        borderBottom: `1px solid ${C.line}`, minHeight: 64, display: 'flex', alignItems: 'center', gap: 14, padding: '10px 28px', flexWrap: 'wrap',
      }}>
        <div>
          <div style={sub}>팀 관리</div>
          <div style={{ fontSize: 18, fontWeight: 800 }}>연차/휴가</div>
        </div>
        <div style={{ display: 'flex', background: C.line, borderRadius: 10, padding: 3, gap: 2, overflowX: 'auto', maxWidth: '100%' }}>
          {['전체', ...teams].map(t => {
            const on = t === team;
            return (
              <button key={t} onClick={() => setTeam(t)} style={{
                height: 32, padding: '0 14px', borderRadius: 8, border: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
                background: on ? '#fff' : 'transparent', color: on ? C.ink : C.inkDim, fontWeight: 700, fontSize: 13,
                boxShadow: on ? '0 1px 3px rgba(0,0,0,.08)' : 'none', display: 'flex', alignItems: 'center', gap: 6,
              }}>
                {t !== '전체' && <span style={{ width: 8, height: 8, borderRadius: '50%', background: teamColor(t) }} />}{t}
              </button>
            );
          })}
        </div>
        <div style={{ marginLeft: 'auto' }}>
          {seg<View>([['requests', '신청', pending.length], ['calendar', '달력'], ['balance', '연차 현황']], view, setView)}
        </div>
      </header>

      <main style={{ padding: '22px 28px 40px', maxWidth: 1400 }}>
        {/* KPI */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12, marginBottom: 14 }}>
          {kpi('승인 대기', pending.length, '건', pending.length ? `가장 빠른 휴가 ${pending[0].start_date.slice(5).replace('-', '.')}` : '처리할 신청 없음', pending.length ? '#d97706' : undefined, () => setView('requests'))}
          {kpi('오늘 휴가 중', onToday.length, '명', onToday.map(l => l.user_name).join(', ') || '전원 근무')}
          {kpi('7일 내 휴가', weekCount, '건', upcoming[0] ? `다음: ${upcoming[0].user_name} ${upcoming[0].start_date.slice(5).replace('-', '.')}` : '예정 없음', undefined, () => setView('calendar'))}
          {kpi(`${year}년 평균 연차 사용률`, avgUse, '%', `${balances.length}명 기준 · 잔여 3일 이하 ${balances.filter(b => b.left <= 3).length}명`, undefined, () => setView('balance'))}
        </div>

        {/* ─── 신청 ─── */}
        {view === 'requests' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 14, alignItems: 'start' }}>
            <div style={card}>
              <div style={cardH}><h3 style={h3}>승인 대기</h3><span style={sub}>{pending.length}건 · 휴가 시작일 순</span></div>
              <div style={{ padding: 14, display: 'grid', gap: 10 }}>
                {pending.length ? pending.map(pendingCard) : empty('승인을 기다리는 신청이 없어요')}
              </div>
            </div>

            <div style={card}>
              <div style={cardH}>
                <h3 style={h3}>처리 내역</h3>
                <div style={{ marginLeft: 'auto' }}>{seg<Hist>([['all', '전체'], ['approved', '승인'], ['rejected', '거절']], hist, setHist)}</div>
              </div>
              {history.length === 0 ? empty('처리된 신청이 없어요') : history.slice(0, 40).map(l => (
                <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 18px', borderBottom: `1px solid ${C.bg}` }}>
                  {avatar(l.user_name, teamOf(l), 30)}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <b style={{ fontSize: 13.5 }}>{l.user_name}</b>{typeChip(l.type)}
                    </div>
                    <div style={{ ...sub, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {fmtRange(l)} · {leaveDays(l)}일{l.reason ? ` · ${l.reason}` : ''}
                    </div>
                  </div>
                  <span style={{
                    fontSize: 11.5, fontWeight: 700, padding: '3px 8px', borderRadius: 6, whiteSpace: 'nowrap',
                    background: l.status === 'approved' ? '#e6f7ee' : '#fdecec', color: l.status === 'approved' ? '#12805c' : RED,
                  }}>{l.status === 'approved' ? '승인' : '거절'}</span>
                  {canEdit && (
                    <button onClick={() => handleDeleteLeave(l.id)} title="삭제"
                      style={{ background: 'none', border: 'none', color: C.inkFaint, cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>삭제</button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ─── 달력 ─── */}
        {view === 'calendar' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 3fr) minmax(260px, 1fr)', gap: 14, alignItems: 'start' }}>
            <div style={card}>
              <div style={cardH}>
                <button onClick={() => moveCal(-1)} style={{ border: `1px solid ${C.line}`, background: '#fff', borderRadius: 8, width: 30, height: 30, cursor: 'pointer', color: C.inkDim, fontWeight: 800 }}>‹</button>
                <h3 style={{ ...h3, minWidth: 110, textAlign: 'center' }}>{cal.y}년 {cal.m}월</h3>
                <button onClick={() => moveCal(1)} style={{ border: `1px solid ${C.line}`, background: '#fff', borderRadius: 8, width: 30, height: 30, cursor: 'pointer', color: C.inkDim, fontWeight: 800 }}>›</button>
                <button onClick={() => setCal({ y: now.getFullYear(), m: now.getMonth() + 1 })} style={{ marginLeft: 6, background: 'none', border: 'none', color: C.primary, fontWeight: 700, fontSize: 12.5, cursor: 'pointer' }}>오늘</button>
                <span style={{ ...sub, marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: '#e7f0ff', marginRight: 4, verticalAlign: -1 }} />승인</span>
                  <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, border: '1px dashed #d97706', marginRight: 4, verticalAlign: -1 }} />대기</span>
                  <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: '#fde2e2', marginRight: 4, verticalAlign: -1 }} />공휴일</span>
                </span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0,1fr))' }}>
                {WEEK.map((w, i) => (
                  <div key={w} style={{ padding: '8px 10px', fontSize: 12, fontWeight: 700, color: i === 0 ? RED : i === 6 ? C.primary : C.inkDim, borderBottom: `1px solid ${C.line}` }}>{w}</div>
                ))}
                {calDays.map((c, i) => {
                  const dow = i % 7;
                  const isToday = c?.ds === today;
                  return (
                    <div key={i} style={{
                      minHeight: 96, padding: 6, borderRight: dow < 6 ? `1px solid ${C.bg}` : 'none', borderBottom: `1px solid ${C.bg}`,
                      background: c ? (c.hol ? '#fff5f5' : dow === 0 || dow === 6 ? '#fafbfc' : '#fff') : C.bg,
                    }}>
                      {c && (
                        <>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4, minWidth: 0 }}>
                            <div style={{
                              fontSize: 12, fontWeight: 700, width: 22, height: 22, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                              background: isToday ? C.primary : 'transparent', color: isToday ? '#fff' : (dow === 0 || c.hol) ? RED : dow === 6 ? C.primary : C.inkSoft,
                            }}>{c.d}</div>
                            {c.hol && (
                              <span title={c.hol} style={{ fontSize: 10.5, fontWeight: 700, color: RED, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.hol}</span>
                            )}
                          </div>
                          {c.list.slice(0, 3).map(l => {
                            const s = typeStyle(l.type);
                            const isP = l.status === 'pending';
                            return (
                              <div key={l.id} title={`${l.user_name} · ${l.type}${isP ? ' (대기)' : ''}`} style={{
                                fontSize: 11, fontWeight: 700, padding: '2px 6px', borderRadius: 5, marginBottom: 2,
                                background: isP ? '#fff' : s.bg, color: isP ? '#b45309' : s.fg, border: isP ? '1px dashed #d97706' : '1px solid transparent',
                                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                              }}>{l.user_name}{l.type === '반차' ? ' ½' : ''}</div>
                            );
                          })}
                          {c.list.length > 3 && <div style={{ fontSize: 11, color: C.inkFaint, paddingLeft: 4 }}>+{c.list.length - 3}명</div>}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <div style={card}>
              {(() => {
                const pre = `${cal.y}-${pad(cal.m)}-`;
                const hs = Object.entries(HOLIDAYS).filter(([d]) => d.startsWith(pre)).sort();
                return hs.length > 0 && (
                  <div style={{ padding: '12px 16px', borderBottom: `1px solid ${C.line}`, background: '#fffafa' }}>
                    <div style={{ fontSize: 12, fontWeight: 800, color: RED, marginBottom: 6 }}>{cal.m}월 공휴일</div>
                    {hs.map(([d, n]) => (
                      <div key={d} style={{ display: 'flex', fontSize: 12.5, padding: '2px 0', color: C.inkSoft }}>
                        <span style={{ width: 64, color: C.inkDim }}>{Number(d.slice(8))}일 ({WEEK[new Date(d).getDay()]})</span>{n}
                      </div>
                    ))}
                  </div>
                );
              })()}
              <div style={cardH}><h3 style={h3}>다가오는 휴가</h3><span style={sub}>{upcoming.length}건</span></div>
              {upcoming.length === 0 ? empty('예정된 휴가가 없어요') : upcoming.slice(0, 12).map(l => (
                <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderBottom: `1px solid ${C.bg}` }}>
                  <div style={{ width: 44, textAlign: 'center', flexShrink: 0 }}>
                    <div style={{ fontSize: 11, color: C.inkFaint }}>{Number(l.start_date.slice(5, 7))}월</div>
                    <div style={{ fontSize: 18, fontWeight: 800, lineHeight: 1.1 }}>{Number(l.start_date.slice(8, 10))}</div>
                  </div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><b style={{ fontSize: 13.5 }}>{l.user_name}</b>{typeChip(l.type)}</div>
                    <div style={sub}>{teamOf(l) || '팀 미지정'} · {leaveDays(l)}일</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ─── 연차 현황 ─── */}
        {view === 'balance' && (
          <>
            <div style={{ ...sub, margin: '0 2px 10px' }}>
              {year}년 승인된 연차·반차 기준 · 반차 0.5일 · 잔여 적은 순 · 총 연차는 팀원 관리에서 수정
            </div>
            {balances.length === 0 ? <div style={card}>{empty('직원이 없어요')}</div> : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 12 }}>
                {balances.map(b => {
                  const usedP = b.annual_leave ? Math.min(100, (b.used / b.annual_leave) * 100) : 0;
                  const leftColor = b.left <= 0 ? RED : b.left <= 3 ? '#d97706' : C.ink;
                  return (
                    <div key={b.id} style={{ ...card, padding: 16 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        {avatar(b.name, b.team, 34)}
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <b style={{ fontSize: 14 }}>{b.name}</b>
                          <div>{teamChip(b.team)}</div>
                        </div>
                        {b.pend > 0 && <span style={{ fontSize: 11, fontWeight: 700, color: '#b45309', background: '#fff7e6', padding: '2px 8px', borderRadius: 6 }}>대기 {b.pend}</span>}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginTop: 14 }}>
                        <span style={{ fontSize: 28, fontWeight: 800, color: leftColor, letterSpacing: -0.5 }}>{b.left}</span>
                        <span style={{ fontSize: 13, color: C.inkFaint, fontWeight: 600 }}>/ {b.annual_leave}일 남음</span>
                      </div>
                      <div style={{ height: 8, borderRadius: 4, background: C.bg, overflow: 'hidden', margin: '8px 0 10px' }}>
                        <div style={{ width: `${usedP}%`, height: '100%', background: b.left <= 0 ? RED : teamColor(b.team), borderRadius: 4 }} />
                      </div>
                      <div style={{ display: 'flex', fontSize: 12, color: C.inkDim, gap: 12 }}>
                        <span>사용 <b style={{ color: C.ink }}>{b.used}일</b></span>
                        <span>기타 휴가 <b style={{ color: C.ink }}>{b.other}일</b></span>
                        <span style={{ marginLeft: 'auto', color: C.inkFaint }}>{Math.round(usedP)}%</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </main>

      <TabBar active="leave" />
    </div>
  );
}
