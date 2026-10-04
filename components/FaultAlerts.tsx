'use client';

/**
 * components/FaultAlerts.tsx — 고장 접수 실시간 알림 (팀원·관리자 공용)
 *
 * 새 고장이 등록되면 어느 화면에 있든
 *   1) 알림음(/sounds/alert.mp3)  2) 음성 "고장이 접수되었습니다"  3) 오른쪽 위 알림 카드
 * 대상: 내 팀 현장의 고장 (관리자는 회사 전체)
 * 고장접수 화면(/fault)에서는 그 화면이 직접 알려주므로 여기서는 생략합니다.
 */

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

const SOUND_KEY = 'lf_fault_alert_sound';
export const FAULT_SPEECH = '고장이 접수되었습니다';

export function speakKo(text: string) {
  try {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'ko-KR';
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  } catch {}
}

type Toast = { id: number; title: string; body: string };

export default function FaultAlerts() {
  const router = useRouter();
  const pathname = usePathname();
  const pathRef = useRef(pathname);
  pathRef.current = pathname;

  const [toasts, setToasts] = useState<Toast[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const me = useRef<{ id: string; companyId: string; team: string; admin: boolean } | null>(null);

  useEffect(() => {
    audioRef.current = new Audio('/sounds/alert.mp3');
    const unlock = () => {
      const a = audioRef.current;
      if (!a) return;
      a.muted = true;
      a.play().then(() => { a.pause(); a.currentTime = 0; a.muted = false; }).catch(() => {});
      window.removeEventListener('pointerdown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    return () => window.removeEventListener('pointerdown', unlock);
  }, []);

  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let alive = true;

    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const { data: u } = await supabase.from('users')
        .select('company_id, team, role, super_admin').eq('id', session.user.id).single();
      if (!u?.company_id || !alive) return;
      me.current = {
        id: session.user.id, companyId: u.company_id, team: u.team || '',
        admin: u.role === 'admin' || u.super_admin === true,
      };

      channel = supabase.channel('fault-alerts-global')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'fault_reports' }, (payload) => {
          const f: any = payload.new || {};
          const m = me.current;
          if (!m || f.company_id !== m.companyId) return;
          const myTeamFault = m.admin || !f.team || f.team === m.team;
          if (!myTeamFault) return;
          if (pathRef.current?.startsWith('/fault')) return; // 고장 화면이 직접 알림

          const t: Toast = {
            id: Date.now() + Math.random(),
            title: [f.site_name, f.hogi_no].filter(Boolean).join(' '),
            body: f.content || '',
          };
          setToasts((p) => [t, ...p].slice(0, 3));
          setTimeout(() => setToasts((p) => p.filter((x) => x.id !== t.id)), 15000);

          if (localStorage.getItem(SOUND_KEY) === 'off') return;
          const a = audioRef.current;
          if (a) {
            a.currentTime = 0;
            a.play().then(() => setTimeout(() => speakKo(FAULT_SPEECH), 900)).catch(() => speakKo(FAULT_SPEECH));
          } else speakKo(FAULT_SPEECH);
        })
        .subscribe();
    })();

    return () => { alive = false; if (channel) supabase.removeChannel(channel); };
  }, []);

  if (toasts.length === 0) return null;
  return (
    <div style={{ position: 'fixed', top: 14, left: '50%', transform: 'translateX(-50%)', zIndex: 81, display: 'flex', flexDirection: 'column', gap: 8, width: 340, maxWidth: 'calc(100vw - 24px)' }}>
      {toasts.map((t) => (
        <div key={t.id} style={{
          background: '#fff', borderRadius: 14, border: '1px solid #fecaca', borderLeft: '4px solid #ef4444',
          boxShadow: '0 12px 30px -10px rgba(239,68,68,.45)', padding: '12px 14px', display: 'flex', gap: 10,
        }}>
          <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={() => { setToasts((p) => p.filter((x) => x.id !== t.id)); router.push('/fault'); }}>
            <div style={{ fontSize: 11.5, fontWeight: 800, color: '#ef4444' }}>🚨 고장이 접수되었습니다</div>
            <div style={{ fontSize: 14.5, fontWeight: 800, color: '#111827', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title || '현장 미상'}</div>
            {t.body && <div style={{ fontSize: 12.5, color: '#6b7280', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.body}</div>}
            <div style={{ fontSize: 11.5, color: '#ef4444', fontWeight: 700, marginTop: 6 }}>고장접수로 가기 →</div>
          </div>
          <button onClick={() => setToasts((p) => p.filter((x) => x.id !== t.id))} style={{ background: 'none', border: 'none', color: '#9ca3af', fontSize: 16, cursor: 'pointer' }}>×</button>
        </div>
      ))}
    </div>
  );
}
