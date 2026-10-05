'use client';

/**
 * components/AnnouncementBar.tsx
 *  1) 공지사항 띠 — 개발자가 등록한 공지를 모든 회사(또는 지정 회사) 화면 위쪽에 표시
 *  2) '회사로 보기' 띠 — 개발자가 다른 회사 화면을 보는 중일 때 표시 + 돌아가기
 * TabBar 안에서 모든 사용자에게 렌더링됩니다.
 */

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

interface Ann { id: string; title: string; body?: string; level?: 'info' | 'warn' | 'urgent' }

const HIDE_KEY = 'lf_ann_hidden';
const LEVEL: Record<string, { bg: string; fg: string; icon: string }> = {
  info:   { bg: '#eff6ff', fg: '#1d4ed8', icon: '📢' },
  warn:   { bg: '#fffbeb', fg: '#b45309', icon: '⚠️' },
  urgent: { bg: '#fef2f2', fg: '#b91c1c', icon: '🚨' },
};

export default function AnnouncementBar() {
  const [anns, setAnns] = useState<Ann[]>([]);
  const [hidden, setHidden] = useState<string[]>([]);
  const [viewing, setViewing] = useState<{ name: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    try { setHidden(JSON.parse(localStorage.getItem(HIDE_KEY) || '[]')); } catch {}
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const { data: me } = await supabase.from('users').select('*').eq('id', session.user.id).single();
      if (!me) return;

      if (me.super_admin && me.home_company_id && me.home_company_id !== me.company_id) {
        setViewing({ name: me.company_display_name || me.company_id });
      }

      const nowIso = new Date().toISOString();
      const { data, error } = await supabase
        .from('announcements')
        .select('id, title, body, level, target_company_id, starts_at, ends_at')
        .eq('active', true)
        .lte('starts_at', nowIso)
        .order('created_at', { ascending: false })
        .limit(5);
      if (error) return; // 테이블이 아직 없으면 조용히 무시
      setAnns((data || []).filter((a: any) =>
        (!a.ends_at || a.ends_at > nowIso) && (!a.target_company_id || a.target_company_id === me.company_id)));
    })();
  }, []);

  const shown = anns.filter((a) => !hidden.includes(a.id));
  const barCount = shown.length + (viewing ? 1 : 0);

  // 위쪽 띠 높이만큼 화면을 내려서 가리지 않게
  useEffect(() => {
    const h = barCount * 40;
    document.documentElement.style.setProperty('--lf-ann-h', `${h}px`);
    const prev = document.body.style.paddingTop;
    document.body.style.paddingTop = h ? `${h}px` : prev;
    return () => { document.body.style.paddingTop = prev; document.documentElement.style.setProperty('--lf-ann-h', '0px'); };
  }, [barCount]);

  const hide = (id: string) => {
    const next = [...hidden, id];
    setHidden(next);
    localStorage.setItem(HIDE_KEY, JSON.stringify(next.slice(-50)));
  };

  const backHome = async () => {
    setBusy(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const { data: me } = await supabase.from('users').select('home_company_id, home_company_display_name').eq('id', session.user.id).single();
      if (!me?.home_company_id) return;
      const { error } = await supabase.from('users').update({
        company_id: me.home_company_id,
        company_display_name: me.home_company_display_name || null,
        home_company_id: null,
        home_company_display_name: null,
      }).eq('id', session.user.id);
      if (error) throw error;
      sessionStorage.clear();
      window.location.href = '/admin';
    } catch (e: any) {
      alert('돌아가기 실패: ' + (e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  if (barCount === 0) return null;

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 90 }}>
      {viewing && (
        <div style={{ height: 40, background: '#6d28d9', color: '#fff', display: 'flex', alignItems: 'center', gap: 10, padding: '0 14px', fontSize: 13, fontWeight: 700 }}>
          <span>👀 <b>{viewing.name}</b> 회사 화면 · 스텔스 방문 중</span>
          <span style={{ opacity: 0.75, fontWeight: 500, display: 'none' }} className="sm:inline">· 이 회사의 데이터가 실제로 보이고 수정도 반영돼요</span>
          <button onClick={backHome} disabled={busy} style={{ marginLeft: 'auto', background: '#fff', color: '#6d28d9', border: 'none', borderRadius: 8, padding: '5px 12px', fontSize: 12.5, fontWeight: 800, cursor: 'pointer' }}>
            {busy ? '돌아가는 중...' : '내 회사로 돌아가기'}
          </button>
        </div>
      )}
      {shown.map((a) => {
        const st = LEVEL[a.level || 'info'] || LEVEL.info;
        return (
          <div key={a.id} style={{ height: 40, background: st.bg, color: st.fg, borderBottom: `1px solid ${st.fg}22`, display: 'flex', alignItems: 'center', gap: 8, padding: '0 14px', fontSize: 13 }}>
            <span>{st.icon}</span>
            <b style={{ whiteSpace: 'nowrap' }}>{a.title}</b>
            {a.body && <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: 0.85 }}>{a.body}</span>}
            {!a.body && <span style={{ flex: 1 }} />}
            <button onClick={() => hide(a.id)} title="닫기" style={{ background: 'none', border: 'none', color: st.fg, fontSize: 18, cursor: 'pointer', lineHeight: 1 }}>×</button>
          </div>
        );
      })}
    </div>
  );
}
