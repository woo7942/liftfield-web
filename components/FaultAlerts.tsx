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

// ── 음성 안내 ──
// 휴대폰(특히 아이폰 Safari)은 "사용자가 화면을 누른 순간"에 한 번 말해 본 적이 있어야
// 그 뒤 자동 음성이 나옵니다. 그래서 첫 터치 때 빈 문장을 한 번 읽어 잠금을 풉니다.
let speechUnlocked = false;
function koVoice(): SpeechSynthesisVoice | undefined {
  try {
    const vs = window.speechSynthesis.getVoices();
    return vs.find((v) => v.lang?.toLowerCase().startsWith('ko')) || undefined;
  } catch { return undefined; }
}
export function unlockSpeech() {
  if (speechUnlocked || typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  try {
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    u.lang = 'ko-KR';
    window.speechSynthesis.speak(u);
    speechUnlocked = true;
  } catch {}
}
export function speakKo(text: string) {
  try {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    const synth = window.speechSynthesis;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'ko-KR';
    const v = koVoice();
    if (v) u.voice = v;
    u.rate = 1;
    u.volume = 1;
    synth.cancel();
    synth.resume(); // 안드로이드 크롬: 일시정지 상태로 멈춰 있는 경우 대비
    // cancel 직후 바로 speak 하면 무시되는 기기가 있어 약간 늦춤
    setTimeout(() => synth.speak(u), 120);
  } catch {}
}
// ── 녹음된 음성 파일 재생 (휴대폰에서 확실하게 나오는 방식) ──
// public/sounds/ 에 파일이 있으면 그 파일을 재생하고, 없으면 기기 음성(speakKo)으로 대신 읽음
const voiceCache: Record<string, HTMLAudioElement> = {};
export function unlockVoices(files: string[]) {
  files.forEach((f) => {
    try {
      const a = voiceCache[f] || new Audio(f);
      voiceCache[f] = a;
      a.muted = true;
      a.play().then(() => { a.pause(); a.currentTime = 0; a.muted = false; }).catch(() => {});
    } catch {}
  });
}
export function playVoice(file: string, fallbackText: string) {
  try {
    const a = voiceCache[file] || new Audio(file);
    voiceCache[file] = a;
    a.muted = false;
    a.currentTime = 0;
    a.play().catch(() => speakKo(fallbackText));
    a.onerror = () => speakKo(fallbackText); // 파일이 없을 때
  } catch { speakKo(fallbackText); }
}
export const VOICE_FILES = {
  fault: '/sounds/voice-fault.mp3',
  material: '/sounds/voice-material.mp3',
  leave: '/sounds/voice-leave.mp3',
  quote: '/sounds/voice-quote.mp3',
};

// 목소리 목록은 늦게 로드되는 기기가 많아서 미리 한 번 불러둠
if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  try { window.speechSynthesis.getVoices(); window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices(); } catch {}
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
      unlockSpeech();
      unlockVoices(Object.values(VOICE_FILES));
      const a = audioRef.current;
      if (a) {
        a.muted = true;
        a.play().then(() => { a.pause(); a.currentTime = 0; a.muted = false; }).catch(() => {});
      }
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('touchend', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('touchend', unlock);
    return () => { window.removeEventListener('pointerdown', unlock); window.removeEventListener('touchend', unlock); };
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
            a.play().then(() => setTimeout(() => playVoice(VOICE_FILES.fault, FAULT_SPEECH), 900)).catch(() => playVoice(VOICE_FILES.fault, FAULT_SPEECH));
          } else playVoice(VOICE_FILES.fault, FAULT_SPEECH);
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
