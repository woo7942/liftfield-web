'use client';

/**
 * components/AdminAlerts.tsx — 관리자 실시간 알림 (알림음 + 음성 안내 + 화면 알림)
 *
 * 팀원이 자재·견적서·연차/휴가를 신청하면 관리자 화면 어디에 있든
 *   1) 알림음(/sounds/alert.mp3)  2) 음성 안내("자재신청이 되었습니다")  3) 오른쪽 위 알림 카드
 * 를 띄웁니다. TabBar 안에서 관리자일 때만 렌더링됩니다.
 *
 * ※ Supabase Realtime 이 켜져 있어야 동작합니다 (SQL 안내 참고).
 */

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { unlockSpeech, unlockVoices, playVoice, VOICE_FILES } from '@/components/FaultAlerts';

// ── 감시할 테이블 (테이블 이름이 다르면 여기만 고치세요) ──
const WATCH = [
  {
    table: 'material_requests',
    kind: '자재',
    voice: VOICE_FILES.material,
    path: '/material',
    speak: '자재 신청이 되었습니다',
    title: (r: any) => `자재 신청 · ${r.site_name || r.siteName || ''}`.trim(),
    body: (r: any) => [r.requester_name || r.user_name || r.created_by_name, r.item_name || r.material_name || r.content].filter(Boolean).join(' · '),
  },
  {
    table: 'quotes',
    kind: '견적서',
    voice: VOICE_FILES.quote,
    path: '/quote',
    speak: '견적서가 접수되어 승인을 기다립니다',
    title: (r: any) => `견적서 승인 대기`,
    body: (r: any) => [r.team_id, r.title].filter(Boolean).join(' · '),
  },
  {
    table: 'leave_requests',
    kind: '연차/휴가',
    voice: VOICE_FILES.leave,
    path: '/leave',
    speak: '연차 휴가가 등록되었습니다',
    title: (r: any) => `${r.type || '휴가'} 신청 · ${r.user_name || ''}`.trim(),
    body: (r: any) => [r.start_date, r.end_date && r.end_date !== r.start_date ? `~ ${r.end_date}` : ''].filter(Boolean).join(' '),
  },
] as const;

type Toast = { id: number; kind: string; title: string; body: string; path: string };

const SOUND_KEY = 'lf_admin_alert_sound';

// ※ /sounds/alert.mp3 는 "고장접수" 음성이 녹음된 파일이라 신청 알림에는 쓰지 않음.
//    대신 짧은 '딩동' 차임음을 직접 만들어 재생합니다.
let audioCtx: AudioContext | null = null;
function getCtx() {
  if (typeof window === 'undefined') return null;
  const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
  if (!AC) return null;
  if (!audioCtx) audioCtx = new AC();
  return audioCtx;
}
async function playChime(): Promise<boolean> {
  const ctx = getCtx();
  if (!ctx) return false;
  if (ctx.state === 'suspended') { try { await ctx.resume(); } catch { return false; } }
  if (ctx.state !== 'running') return false;
  const notes = [880, 660]; // 딩 - 동
  notes.forEach((freq, i) => {
    const t0 = ctx.currentTime + i * 0.22;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.35, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.5);
    o.connect(g).connect(ctx.destination);
    o.start(t0);
    o.stop(t0 + 0.55);
  });
  return true;
}

export default function AdminAlerts() {
  const router = useRouter();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [soundOn, setSoundOn] = useState(true);
  const [needTap, setNeedTap] = useState(false); // 브라우저가 소리 재생을 막았을 때
  const memberIds = useRef<Set<string>>(new Set());
  const companyId = useRef<string>('');
  const myId = useRef<string>('');
  const seen = useRef<Set<string>>(new Set());

  // 소리 설정 불러오기 + 오디오 준비
  useEffect(() => {
    setSoundOn(localStorage.getItem(SOUND_KEY) !== 'off');
    // 첫 터치/클릭 때 오디오 잠금 해제 (모바일 브라우저 정책)
    const unlock = () => {
      unlockSpeech();
      unlockVoices([VOICE_FILES.material, VOICE_FILES.quote, VOICE_FILES.leave]);
      const ctx = getCtx();
      ctx?.resume().then(() => setNeedTap(false)).catch(() => {});
      window.removeEventListener('pointerdown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    return () => window.removeEventListener('pointerdown', unlock);
  }, []);

  const notify = (w: (typeof WATCH)[number], row: any) => {
    const key = `${w.table}:${row.id}`;
    if (seen.current.has(key)) return;
    seen.current.add(key);

    const t: Toast = { id: Date.now() + Math.random(), kind: w.kind, title: w.title(row), body: w.body(row), path: w.path };
    setToasts((prev) => [t, ...prev].slice(0, 4));
    setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== t.id)), 12000);

    if (localStorage.getItem(SOUND_KEY) === 'off') return;
    const speak = () => playVoice(w.voice, w.speak);
    playChime().then((ok) => {
      if (!ok) setNeedTap(true);
      setTimeout(speak, ok ? 650 : 0);
    });

    // 탭이 백그라운드일 때 OS 알림
    if (document.visibilityState !== 'visible' && 'Notification' in window && Notification.permission === 'granted') {
      try { new Notification(t.title, { body: t.body || w.speak, icon: '/icon-192.png' }); } catch {}
    }
  };

  // 실시간 구독
  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let alive = true;

    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      myId.current = session.user.id;
      const { data: me } = await supabase.from('users').select('company_id').eq('id', session.user.id).single();
      if (!me?.company_id || !alive) return;
      companyId.current = me.company_id;
      const { data: mem } = await supabase.from('users').select('id').eq('company_id', me.company_id).or('super_admin.is.null,super_admin.eq.false');
      memberIds.current = new Set((mem || []).map((m: any) => m.id));

      if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission().catch(() => {});
      }

      channel = supabase.channel('admin-alerts');
      WATCH.forEach((w) => {
        channel!.on('postgres_changes', { event: 'INSERT', schema: 'public', table: w.table }, (payload) => {
          const r: any = payload.new || {};
          // 우리 회사 것만 (company_id 가 있으면 그걸로, 없으면 신청자가 우리 회사 사람인지로 판단)
          const uid = r.user_id || r.created_by || r.requester_id || r.uid;
          const mine = r.company_id ? r.company_id === companyId.current : (uid && memberIds.current.has(uid));
          if (!mine) return;
          if (uid && uid === myId.current) return; // 내가 올린 건 알리지 않음
          if (w.table === 'quotes' && r.status && r.status !== '승인대기') return;
          notify(w, r);
        });
      });
      channel.subscribe();
    })();

    return () => { alive = false; if (channel) supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleSound = () => {
    const next = !soundOn;
    setSoundOn(next);
    localStorage.setItem(SOUND_KEY, next ? 'on' : 'off');
    if (next) playChime().then((ok) => setNeedTap(!ok));
  };

  const KIND_COLOR: Record<string, string> = { '자재': '#7c3aed', '견적서': '#2563eb', '연차/휴가': '#059669' };

  return (
    <>
      {/* 알림 카드 */}
      <div style={{ position: 'fixed', top: 14, right: 14, zIndex: 80, display: 'flex', flexDirection: 'column', gap: 8, width: 320, maxWidth: 'calc(100vw - 28px)', pointerEvents: 'none' }}>
        {toasts.map((t) => (
          <div key={t.id} style={{
            pointerEvents: 'auto', background: '#fff', borderRadius: 14, boxShadow: '0 12px 30px -10px rgba(15,23,42,.35)',
            border: '1px solid #e5e7eb', borderLeft: `4px solid ${KIND_COLOR[t.kind] || '#111827'}`, padding: '12px 14px',
            display: 'flex', gap: 10, alignItems: 'flex-start', animation: 'lfToastIn .2s ease',
          }}>
            <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={() => { setToasts((p) => p.filter((x) => x.id !== t.id)); router.push(t.path); }}>
              <div style={{ fontSize: 11.5, fontWeight: 800, color: KIND_COLOR[t.kind] || '#111827' }}>🔔 {t.kind}</div>
              <div style={{ fontSize: 14, fontWeight: 800, color: '#111827', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</div>
              {t.body && <div style={{ fontSize: 12.5, color: '#6b7280', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.body}</div>}
              <div style={{ fontSize: 11.5, color: '#2563eb', fontWeight: 700, marginTop: 6 }}>확인하러 가기 →</div>
            </div>
            <button onClick={() => setToasts((p) => p.filter((x) => x.id !== t.id))} style={{ background: 'none', border: 'none', color: '#9ca3af', fontSize: 16, cursor: 'pointer', lineHeight: 1 }}>×</button>
          </div>
        ))}
        {needTap && soundOn && (
          <button onClick={toggleSound} style={{ pointerEvents: 'auto', alignSelf: 'flex-end', background: '#111827', color: '#fff', border: 'none', borderRadius: 10, padding: '8px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
            🔇 화면을 한 번 눌러야 알림음이 나와요
          </button>
        )}
      </div>

      {/* 알림음 켜기/끄기 (왼쪽 아래, 작게) */}
      <button
        onClick={toggleSound}
        title={soundOn ? '알림음 끄기' : '알림음 켜기'}
        style={{
          position: 'fixed', right: 14, bottom: 96, zIndex: 79, width: 38, height: 38, borderRadius: '50%',
          border: '1px solid #e5e7eb', background: '#fff', boxShadow: '0 4px 12px rgba(15,23,42,.12)', cursor: 'pointer', fontSize: 16,
        }}
      >
        {soundOn ? '🔔' : '🔕'}
      </button>
      <style>{`@keyframes lfToastIn{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}`}</style>
    </>
  );
}
