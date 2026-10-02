'use client';

/**
 * app/my-leave/page.tsx — 팀원 휴가 신청 (모바일 우선)
 * - 저장: leave_requests (관리자 /leave 화면과 같은 테이블)
 *   컬럼: company_id, user_id, user_name, type, start_date, end_date, reason, status
 * - 잔여 연차: users.annual_leave − 올해 승인된 연차·반차
 * - 대기 중인 신청만 본인이 취소(삭제) 가능
 */

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { C } from '@/lib/theme';
import TabBar from '@/components/TabBar';

interface LeaveRequest {
  id: string; user_id: string; user_name: string; type: string;
  start_date: string; end_date: string; reason: string;
  status: 'pending' | 'approved' | 'rejected'; created_at?: string;
}

const TYPES = ['연차', '휴가', '병가', '경조사', '기타'] as const;
// 연차에서 차감되는 종류 (휴가를 연차에서 빼려면 '휴가' 추가)
const DEDUCT = ['연차', '반차'];
const RED = '#ef4444';
const TYPE_STYLE: Record<string, { bg: string; fg: string }> = {
  연차: { bg: '#e7f0ff', fg: '#2f6fed' },
  반차: { bg: '#f3e8ff', fg: '#8b3fd9' },
  휴가: { bg: '#e6f7ee', fg: '#12805c' },
};
const typeStyle = (t: string) => TYPE_STYLE[t] || { bg: '#fff1e6', fg: '#d9630b' };
const STATUS: Record<string, { label: string; bg: string; fg: string }> = {
  pending:  { label: '승인 대기', bg: '#fff7e6', fg: '#b45309' },
  approved: { label: '승인',     bg: '#e6f7ee', fg: '#12805c' },
  rejected: { label: '거절',     bg: '#fdecec', fg: RED },
};
const WEEK = ['일', '월', '화', '수', '목', '금', '토'];

const pad = (n: number) => String(n).padStart(2, '0');
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const endOf = (l: { start_date: string; end_date: string }) => l.end_date || l.start_date;
function daysOf(type: string, s: string, e: string) {
  if (type === '반차') return 0.5;
  const a = new Date(s), b = new Date(e || s);
  if (isNaN(a.getTime()) || isNaN(b.getTime())) return 0;
  return Math.max(1, Math.round((b.getTime() - a.getTime()) / 86400000) + 1);
}
const fmt = (ds: string) => { const d = new Date(ds); return isNaN(d.getTime()) ? ds : `${d.getMonth() + 1}.${d.getDate()} (${WEEK[d.getDay()]})`; };

export default function MyLeavePage() {
  const router = useRouter();
  const [me, setMe] = useState<{ uid: string; name: string; companyId: string; team: string; annual: number } | null>(null);
  const [list, setList] = useState<LeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [sheet, setSheet] = useState(false);

  // 폼
  const [type, setType] = useState<string>('연차');
  const [start, setStart] = useState(todayStr());
  const [end, setEnd] = useState(todayStr());
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  // ─── 인증 ───
  // 다른 페이지(members 등)와 같은 방식: onAuthStateChange 로 세션 복원을 기다린 뒤 판단
  // (getSession 을 바로 부르면 새로고침 직후 세션이 아직 없어서 로그인으로 튕기는 경우가 있음)
  const [loadErr, setLoadErr] = useState('');
  useEffect(() => {
    let done = false;
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (done) return;
      if (!session) {
        if (event === 'INITIAL_SESSION' || event === 'SIGNED_OUT') router.push('/login');
        return;
      }
      done = true;
      // select('*') — 특정 컬럼이 없어도 에러 나지 않게
      const { data: u, error } = await supabase.from('users').select('*').eq('id', session.user.id).single();
      if (error || !u) {
        console.error('[my-leave] users 조회 실패', error);
        setLoadErr('내 정보를 불러오지 못했어요: ' + (error?.message || '사용자 없음'));
        setLoading(false);
        return;
      }
      if (!u.company_id) { router.push('/'); return; }
      const info = { uid: session.user.id, name: u.name || '', companyId: u.company_id, team: u.team || '', annual: u.annual_leave ?? 15 };
      setMe(info);
      await load(info.uid, info.companyId);
    });
    return () => subscription.unsubscribe();
  }, [router]);

  const load = async (uid: string, cid: string) => {
    const { data, error } = await supabase
      .from('leave_requests').select('*')
      .eq('company_id', cid).eq('user_id', uid)
      .order('start_date', { ascending: false });
    if (error) { console.error('[my-leave] leave_requests 조회 실패', error); setLoadErr('휴가 내역을 불러오지 못했어요: ' + error.message); }
    setList((data || []) as LeaveRequest[]);
    setLoading(false);
  };

  // ─── 계산 ───
  const year = new Date().getFullYear();
  const today = todayStr();
  const usedYear = useMemo(() => list
    .filter(l => l.status === 'approved' && DEDUCT.includes(l.type) && (l.start_date || '').startsWith(String(year)))
    .reduce((a, l) => a + daysOf(l.type, l.start_date, endOf(l)), 0), [list, year]);
  const pendingDays = useMemo(() => list
    .filter(l => l.status === 'pending' && DEDUCT.includes(l.type))
    .reduce((a, l) => a + daysOf(l.type, l.start_date, endOf(l)), 0), [list]);
  const annual = me?.annual ?? 15;
  const left = annual - usedYear;
  const usedP = annual ? Math.min(100, (usedYear / annual) * 100) : 0;
  const pendP = annual ? Math.min(100 - usedP, (pendingDays / annual) * 100) : 0;

  const effEnd = end;
  const reqDays = daysOf(type, start, effEnd);
  const countsLeave = DEDUCT.includes(type);
  const overlap = list.find(l => l.status !== 'rejected' && l.start_date <= effEnd && endOf(l) >= start);

  const upcoming = list.filter(l => l.status !== 'rejected' && endOf(l) >= today).sort((a, b) => a.start_date.localeCompare(b.start_date));
  const past = list.filter(l => !(l.status !== 'rejected' && endOf(l) >= today));

  const openSheet = () => {
    setType('연차'); setStart(todayStr()); setEnd(todayStr()); setReason(''); setErr(''); setSheet(true);
  };

  // ─── 신청 ───
  async function submit() {
    if (!me) return;
    setErr('');
    if (!start) { setErr('날짜를 선택해 주세요'); return; }
    if (effEnd < start) { setErr('종료일이 시작일보다 빨라요'); return; }
    if (overlap) { setErr(`이미 ${fmt(overlap.start_date)} 신청 건과 기간이 겹쳐요`); return; }
    if (countsLeave && left - pendingDays - reqDays < 0 &&
        !confirm(`잔여 연차보다 많아요 (신청 후 ${left - pendingDays - reqDays}일). 그래도 신청할까요?`)) return;

    setSaving(true);
    try {
      const fullReason = reason.trim();
      const { data, error } = await supabase.from('leave_requests').insert({
        company_id: me.companyId,
        user_id: me.uid,
        user_name: me.name,
        type,
        start_date: start,
        end_date: effEnd,
        reason: fullReason,
        status: 'pending',
      }).select().single();
      if (error) throw error;
      setList(prev => [data as LeaveRequest, ...prev]);
      setSheet(false);
    } catch (e: any) {
      setErr('신청 실패: ' + (e?.message || e));
    } finally {
      setSaving(false);
    }
  }

  // ─── 취소 (대기 중만) ───
  async function cancel(l: LeaveRequest) {
    if (l.status !== 'pending') return;
    if (!confirm(`${fmt(l.start_date)} ${l.type} 신청을 취소할까요?`)) return;
    const { error } = await supabase.from('leave_requests').delete().eq('id', l.id).eq('user_id', me!.uid);
    if (error) { alert('취소 실패: ' + error.message); return; }
    setList(prev => prev.filter(x => x.id !== l.id));
  }

  if (loading) return (
    <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.inkDim }}>
      로딩 중...<TabBar active="myleave" />
    </div>
  );

  // ─── UI 조각 ───
  const card: React.CSSProperties = { background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16 };
  const sub: React.CSSProperties = { fontSize: 12, color: C.inkFaint };
  const chip = (t: string) => { const s = typeStyle(t); return <span style={{ fontSize: 11.5, fontWeight: 700, padding: '2px 8px', borderRadius: 6, background: s.bg, color: s.fg }}>{t}</span>; };
  const statusChip = (st: string) => { const s = STATUS[st] || STATUS.pending; return <span style={{ fontSize: 11.5, fontWeight: 700, padding: '3px 8px', borderRadius: 6, background: s.bg, color: s.fg, whiteSpace: 'nowrap' }}>{s.label}</span>; };
  const row = (l: LeaveRequest) => (
    <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px', borderTop: `1px solid ${C.bg}` }}>
      <div style={{ width: 46, textAlign: 'center', flexShrink: 0 }}>
        <div style={{ fontSize: 11, color: C.inkFaint }}>{Number(l.start_date.slice(5, 7))}월</div>
        <div style={{ fontSize: 19, fontWeight: 800, lineHeight: 1.1, color: C.ink }}>{Number(l.start_date.slice(8, 10))}</div>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {chip(l.type)}
          <span style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>
            {endOf(l) !== l.start_date ? `${fmt(l.start_date)} ~ ${fmt(endOf(l))}` : fmt(l.start_date)}
          </span>
        </div>
        <div style={{ ...sub, marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {daysOf(l.type, l.start_date, endOf(l))}일{l.reason ? ` · ${l.reason}` : ''}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
        {statusChip(l.status)}
        {l.status === 'pending' && (
          <button onClick={() => cancel(l)} style={{ background: 'none', border: 'none', color: C.inkFaint, fontSize: 12, fontWeight: 700, cursor: 'pointer', padding: 0 }}>취소</button>
        )}
      </div>
    </div>
  );
  const input: React.CSSProperties = {
    width: '100%', height: 46, borderRadius: 12, border: `1px solid ${C.line}`, padding: '0 12px',
    fontSize: 15, color: C.ink, background: '#fff', outline: 'none', boxSizing: 'border-box',
  };
  const label: React.CSSProperties = { fontSize: 12.5, fontWeight: 700, color: C.inkDim, marginBottom: 6, display: 'block' };

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.ink, paddingBottom: 130 }}>
      {loadErr && (
        <div style={{ margin: '16px 16px 0', padding: '12px 14px', borderRadius: 12, background: '#fdecec', color: RED, fontSize: 13, fontWeight: 600 }}>
          {loadErr}
        </div>
      )}
      {/* 헤더 */}
      <div style={{ padding: '24px 20px 12px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 800 }}>휴가 신청</div>
          <div style={sub}>{me?.name}{me?.team ? ` · ${me.team}` : ''}</div>
        </div>
      </div>

      <div style={{ maxWidth: 560, margin: '0 auto', padding: '0 16px', display: 'grid', gap: 12 }}>
        {/* 잔여 연차 */}
        <div style={{ ...card, padding: 18, background: C.primary, border: 'none', color: '#fff' }}>
          <div style={{ fontSize: 12.5, opacity: 0.85, fontWeight: 600 }}>{year}년 남은 연차</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 4 }}>
            <span style={{ fontSize: 38, fontWeight: 800, letterSpacing: -1 }}>{left}</span>
            <span style={{ fontSize: 15, opacity: 0.85, fontWeight: 600 }}>/ {annual}일</span>
          </div>
          <div style={{ height: 8, borderRadius: 4, background: 'rgba(255,255,255,.25)', overflow: 'hidden', display: 'flex', margin: '12px 0 8px' }}>
            <div style={{ width: `${usedP}%`, background: '#fff' }} />
            <div style={{ width: `${pendP}%`, background: 'rgba(255,255,255,.55)' }} />
          </div>
          <div style={{ display: 'flex', gap: 14, fontSize: 12.5, opacity: 0.9 }}>
            <span>사용 {usedYear}일</span>
            {pendingDays > 0 && <span>승인 대기 {pendingDays}일</span>}
          </div>
        </div>

        {/* 신청 버튼 */}
        <button onClick={openSheet} style={{
          height: 54, borderRadius: 14, border: 'none', background: C.ink, color: '#fff',
          fontSize: 16, fontWeight: 800, cursor: 'pointer', boxShadow: '0 6px 16px -8px rgba(0,0,0,.4)',
        }}>
          + 휴가 신청하기
        </button>

        {/* 예정 */}
        <div style={card}>
          <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <b style={{ fontSize: 15 }}>예정·대기</b><span style={sub}>{upcoming.length}건</span>
          </div>
          {upcoming.length ? upcoming.map(row) : (
            <div style={{ padding: '24px 16px 28px', textAlign: 'center', color: C.inkFaint, fontSize: 13, borderTop: `1px solid ${C.bg}` }}>예정된 휴가가 없어요</div>
          )}
        </div>

        {/* 지난 내역 */}
        {past.length > 0 && (
          <div style={card}>
            <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
              <b style={{ fontSize: 15 }}>지난 내역</b><span style={sub}>{past.length}건</span>
            </div>
            {past.slice(0, 30).map(row)}
          </div>
        )}
      </div>

      {/* 신청 시트 */}
      {sheet && <div onClick={() => !saving && setSheet(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.4)', zIndex: 60 }} />}
      <div style={{
        position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 61,
        transform: sheet ? 'translateY(0)' : 'translateY(105%)', transition: 'transform .22s ease',
        background: '#fff', borderRadius: '22px 22px 0 0', boxShadow: '0 -10px 30px rgba(15,23,42,.18)',
        maxHeight: '92vh', overflowY: 'auto',
      }}>
        <div style={{ maxWidth: 560, margin: '0 auto', padding: '10px 20px calc(20px + env(safe-area-inset-bottom))' }}>
          <div style={{ width: 40, height: 4, borderRadius: 2, background: C.line, margin: '0 auto 14px' }} />
          <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 16 }}>휴가 신청</div>

          <span style={label}>종류</span>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
            {TYPES.map(t => {
              const on = t === type; const s = typeStyle(t);
              return (
                <button key={t} onClick={() => setType(t)} style={{
                  height: 40, padding: '0 16px', borderRadius: 20, cursor: 'pointer', fontSize: 14, fontWeight: 700,
                  border: `1px solid ${on ? s.fg : C.line}`, background: on ? s.bg : '#fff', color: on ? s.fg : C.inkDim,
                }}>{t}</button>
              );
            })}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
              <div><span style={label}>시작일</span>
                <input type="date" value={start} onChange={e => { setStart(e.target.value); if (end < e.target.value) setEnd(e.target.value); }} style={input} /></div>
              <div><span style={label}>종료일</span>
                <input type="date" value={end} min={start} onChange={e => setEnd(e.target.value)} style={input} /></div>
          </div>

          <span style={label}>사유 <span style={{ color: C.inkFaint, fontWeight: 500 }}>(선택)</span></span>
          <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} placeholder="예: 개인 사정, 병원 진료"
            style={{ ...input, height: 'auto', padding: '10px 12px', resize: 'none', fontFamily: 'inherit', marginBottom: 14 }} />

          {/* 요약 */}
          <div style={{ background: C.bg, borderRadius: 12, padding: '12px 14px', fontSize: 13.5, color: C.inkSoft, marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>신청 일수</span><b style={{ color: C.ink }}>{reqDays}일</b>
            </div>
            {countsLeave && (
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                <span>승인 후 남는 연차</span>
                <b style={{ color: left - pendingDays - reqDays < 0 ? RED : C.ink }}>{left - pendingDays - reqDays}일</b>
              </div>
            )}
            {!countsLeave && <div style={{ ...sub, marginTop: 4 }}>{type}는 연차에서 차감되지 않아요</div>}
          </div>

          {err && <div style={{ color: RED, fontSize: 13, fontWeight: 600, marginBottom: 10 }}>{err}</div>}

          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setSheet(false)} disabled={saving} style={{
              flex: 1, height: 50, borderRadius: 14, border: `1px solid ${C.line}`, background: '#fff', color: C.inkDim, fontWeight: 700, fontSize: 15, cursor: 'pointer',
            }}>닫기</button>
            <button onClick={submit} disabled={saving} style={{
              flex: 2, height: 50, borderRadius: 14, border: 'none', background: C.primary, color: '#fff', fontWeight: 800, fontSize: 15, cursor: 'pointer', opacity: saving ? 0.6 : 1,
            }}>{saving ? '신청 중...' : '신청하기'}</button>
          </div>
        </div>
      </div>

      <TabBar active="myleave" />
    </div>
  );
}
