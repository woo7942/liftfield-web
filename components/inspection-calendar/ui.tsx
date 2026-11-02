import { useCallback, useEffect, useRef, useState } from 'react';
import { C } from '@/lib/theme';

// ─────────────────────────────────────────────
// 캘린더 공용 UI 조각 (앱의 기존 카드/색상감에 맞춤)
// ─────────────────────────────────────────────

export const card: React.CSSProperties = {
  background: C.surface,
  border: `1px solid ${C.line}`,
  borderRadius: 14,
  overflow: 'hidden',
};

export function Panel({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={{ ...card, ...style }}>{children}</div>;
}

/** 세그먼트 탭 — [['key','라벨'], ...] */
export function Tabs<T extends string>({ items, value, onChange }: {
  items: readonly (readonly [T, string])[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div style={{ display: 'flex', background: C.line, borderRadius: 10, padding: 3, gap: 2 }}>
      {items.map(([k, label]) => {
        const on = k === value;
        return (
          <button key={k} onClick={() => onChange(k as T)} style={{
            height: 30, padding: '0 12px', borderRadius: 8, border: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
            background: on ? '#fff' : 'transparent', color: on ? C.ink : C.inkDim,
            fontWeight: 700, fontSize: 13, boxShadow: on ? '0 1px 3px rgba(0,0,0,.08)' : 'none',
          }}>{label}</button>
        );
      })}
    </div>
  );
}

/** 하단에서 올라오는 시트 (모바일) / 가운데 모달 (PC) */
export function Modal({ children, onClose, width = 460, title }: {
  children: React.ReactNode; onClose: () => void; width?: number; title?: string;
}) {
  // SSR 에서 window 접근 금지 → 처음엔 false, 마운트 후 측정
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const f = () => setWide(window.innerWidth >= 720);
    f();
    window.addEventListener('resize', f);
    return () => window.removeEventListener('resize', f);
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(16,19,25,.42)',
        display: 'flex', alignItems: wide ? 'center' : 'flex-end', justifyContent: 'center',
        padding: wide ? 24 : 0,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: wide ? width : '100%', maxHeight: wide ? '86vh' : '92vh',
          background: C.surface, borderRadius: wide ? 16 : '18px 18px 0 0', overflow: 'hidden',
          display: 'flex', flexDirection: 'column', boxShadow: '0 24px 64px -16px rgba(16,19,25,.32)',
        }}
      >
        {title && (
          <div style={{ display: 'flex', alignItems: 'center', padding: '16px 18px', borderBottom: `1px solid ${C.line}`, flexShrink: 0 }}>
            <b style={{ fontSize: 15.5 }}>{title}</b>
            <button onClick={onClose} aria-label="닫기" style={{
              marginLeft: 'auto', width: 30, height: 30, borderRadius: 8, border: 'none', background: 'none',
              color: C.inkFaint, fontSize: 18, cursor: 'pointer', lineHeight: 1,
            }}>✕</button>
          </div>
        )}
        <div style={{ overflowY: 'auto', WebkitOverflowScrolling: 'touch', flex: 1 }}>{children}</div>
      </div>
    </div>
  );
}

/** 토스트 — 저장/삭제 결과 알림 */
export function useToast() {
  const [msg, setMsg] = useState('');
  const timer = useRef<any>(null);
  const toast = useCallback((t: string, ms = 2200) => {
    setMsg(t);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setMsg(''), ms);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);

  const node = msg ? (
    <div style={{
      position: 'fixed', left: '50%', bottom: 92, transform: 'translateX(-50%)', zIndex: 400,
      background: '#16191f', color: '#fff', fontSize: 13, fontWeight: 600, padding: '10px 16px',
      borderRadius: 10, boxShadow: '0 10px 28px -8px rgba(0,0,0,.4)',
      maxWidth: 'min(520px, 88vw)', lineHeight: 1.5, whiteSpace: 'normal',
    }}>{msg}</div>
  ) : null;

  return { toast, node };
}

/** 입력 필드 공통 스타일 */
export const field: React.CSSProperties = {
  width: '100%', height: 42, borderRadius: 10, border: `1px solid ${C.line}`,
  padding: '0 12px', fontSize: 14, color: C.ink, background: '#fff',
  outline: 'none', boxSizing: 'border-box',
};

export const fieldLabel: React.CSSProperties = {
  display: 'block', fontSize: 12.5, fontWeight: 700, color: C.inkDim, marginBottom: 6,
};
