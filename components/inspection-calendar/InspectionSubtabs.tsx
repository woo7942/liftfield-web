'use client';

import { useRouter } from 'next/navigation';
import { C } from '@/lib/theme';

/**
 * 점검 탭 안의 서브탭 (점검 | 일정)
 *
 * · 점검 화면(app/inspection/page.tsx)의 상단 필터 영역 위에 한 줄로 들어갑니다.
 * · 캘린더 화면(app/inspection/schedule/page.tsx)에서도 같은 탭을 씁니다.
 * · 점검 화면에서 보고 있던 연/월을 그대로 넘겨서, '일정'을 눌러도 같은 달이 열립니다.
 */
export default function InspectionSubtabs({
  active, year, month,
}: { active: 'inspection' | 'schedule'; year?: number; month?: number }) {
  const router = useRouter();

  const qs = active === 'inspection' && year && month ? `?y=${year}&m=${month}` : '';
  const items = [
    { key: 'inspection' as const, label: '점검', path: '/inspection' },
    { key: 'schedule' as const, label: '일정', path: `/inspection/schedule${qs}` },
  ];

  return (
    <div style={{ display: 'flex', gap: 4, borderBottom: `1px solid ${C.line}`, marginBottom: 14 }}>
      {items.map((it) => {
        const on = it.key === active;
        return (
          <button
            key={it.key}
            onClick={() => { if (!on) router.push(it.path); }}
            style={{
              position: 'relative', height: 38, padding: '0 4px', marginRight: 14, border: 'none',
              background: 'none', cursor: on ? 'default' : 'pointer',
              color: on ? C.ink : C.inkFaint, fontSize: 14.5, fontWeight: on ? 800 : 600,
            }}
          >
            {it.label}
            {on && (
              <span style={{
                position: 'absolute', left: 0, right: 0, bottom: -1, height: 2.5,
                background: C.primary, borderRadius: 2,
              }} />
            )}
          </button>
        );
      })}
    </div>
  );
}
