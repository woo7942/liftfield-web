'use client';

/**
 * app/inspection/schedule/page.tsx — 점검 탭 안의 '일정(캘린더)'
 *
 * · 점검 화면(app/inspection/page.tsx) 상단의 서브탭(점검 | 일정)에서 '일정'을 누르면 옵니다.
 * · 데이터: schedule_events  (supabase/schedule_events.sql 로 생성)
 * · 공휴일/국경일/기념일: components/inspection-calendar/holidays.ts
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { C } from '@/lib/theme';
import TabBar from '@/components/TabBar';
import ScheduleTab from '@/components/inspection-calendar/ScheduleTab';
import InspectionSubtabs from '@/components/inspection-calendar/InspectionSubtabs';

export default function InspectionSchedulePage() {
  const router = useRouter();
  // 점검 화면에서 보던 연/월(?y=2026&m=11)을 그대로 이어받음
  // ※ useSearchParams 는 빌드 시 Suspense 요구가 있어 window.location 으로 읽습니다.
  const [initYM] = useState(() => {
    if (typeof window === 'undefined') return { y: undefined as number | undefined, m: undefined as number | undefined };
    const q = new URLSearchParams(window.location.search);
    const y = Number(q.get('y') || 0), m = Number(q.get('m') || 0);
    return {
      y: y >= 2000 && y <= 2100 ? y : undefined,
      m: m >= 1 && m <= 12 ? m : undefined,
    };
  });
  const initYear = initYM.y;
  const initMonth = initYM.m;

  const [userInfo, setUserInfo] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [sites, setSites] = useState<any[]>([]);
  const [elevators, setElevators] = useState<any[]>([]);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.push('/login'); setLoading(false); return; }

      const { data: u, error } = await supabase
        .from('users')
        .select('name, company_id, company_display_name, role, super_admin, team')
        .eq('id', session.user.id)
        .single();
      if (error || !u) { router.push('/login'); setLoading(false); return; }

      const info = {
        uid: session.user.id,
        name: u.name || '',
        companyId: u.company_id || '',
        companyDisplayName: u.company_display_name || '',
        role: u.role || 'member',
        superAdmin: u.super_admin === true,
        team: u.team || '',
      };
      setUserInfo(info);

      // 현장 목록 (일정 등록 시 선택)
      const siteRows: any[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error: sErr } = await supabase
          .from('sites')
          .select('id, site_name, name, address, team')
          .eq('company_id', info.companyId)
          .order('id')
          .range(from, from + 999);
        if (sErr) break;
        siteRows.push(...(data || []));
        if (!data || data.length < 1000) break;
      }

      const isAdmin = info.role === 'admin' || info.superAdmin;
      const mappedSites = siteRows
        .map((s) => ({ id: s.id, siteName: s.name || s.site_name, name: s.name, address: s.address || '', teamName: s.team }))
        .filter((s) => isAdmin || !s.teamName || s.teamName === info.team);

      setSites(mappedSites);

      // 호기 목록 (현장 선택 후 호기까지 지정할 때)
      const ids = mappedSites.map((s) => s.id);
      if (ids.length) {
        const elevRows: any[] = [];
        for (let i = 0; i < ids.length; i += 150) {
          const { data } = await supabase
            .from('elevators')
            .select('id, hogi_no, elevator_no, dong, site_id')
            .in('site_id', ids.slice(i, i + 150))
            .order('hogi_no');
          elevRows.push(...(data || []));
        }
        setElevators(elevRows);
      }

      setLoading(false);
    })();
  }, [router]);

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.ink, paddingBottom: 130 }}>
      {/* 상단 헤더 (점검 화면과 같은 스타일) */}
      <div style={{ padding: '24px 20px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            onClick={() => router.push('/inspection')}
            style={{
              width: 40, height: 40, borderRadius: 12, background: C.primary, color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: `0 4px 12px ${C.primary}44`, cursor: 'pointer', fontSize: 18,
            }}
          >
            🗓️
          </div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800, color: C.ink }}>점검 일정</div>
            {userInfo?.companyDisplayName && (
              <div style={{ fontSize: 11, color: C.inkDim, fontWeight: 600 }}>🏢 {userInfo.companyDisplayName}</div>
            )}
          </div>
        </div>
      </div>

      {/* 점검 | 일정 서브탭 */}
      <div style={{ maxWidth: 960, margin: '0 auto', padding: '0 16px' }}>
        <InspectionSubtabs active="schedule" />
      </div>

      <div style={{ maxWidth: 960, margin: '0 auto', padding: '0 16px' }}>
        {loading ? (
          <div style={{ padding: 60, textAlign: 'center', color: C.inkFaint, fontSize: 13 }}>로딩 중...</div>
        ) : (
          <ScheduleTab userInfo={userInfo} elevators={elevators} sites={sites} initYear={initYear} initMonth={initMonth} />
        )}
      </div>

      <TabBar active="inspection" />
    </div>
  );
}
