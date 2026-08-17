'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

const MENUS = [
  { icon: '🏢', label: '현장',   path: '/team-sites' },
  { icon: '🔧', label: '고장',   path: '/fault',      badgeKey: 'fault' },
  { icon: '📋', label: '점검',   path: '/inspection' },
  { icon: '🔍', label: '검사',   path: '/inspect' },
  { icon: '📦', label: '자재',   path: '/material',   badgeKey: 'material' },
];

const siteName = (s: any) => s.site_name || s.name || '';
const timeAgo = (v: any) => {
  if (!v) return '-';
  const m = Math.floor((Date.now() - new Date(v).getTime()) / 60000);
  if (m < 1) return '방금 전';
  if (m < 60) return `${m}분 전`;
  if (m < 1440) return `${Math.floor(m / 60)}시간 전`;
  return `${Math.floor(m / 1440)}일 전`;
};

export default function WorkPage() {
  const router = useRouter();
  const [userInfo, setUserInfo] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [sites, setSites] = useState<any[]>([]);
  const [elevCount, setElevCount] = useState(0);
  const [faults, setFaults] = useState<any[]>([]);
  const [materials, setMaterials] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<'site' | 'alert'>('site');

  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) { router.push('/login'); return; }
      const { data } = await supabase.from('users')
        .select('name, role, company_id, company_display_name, team, super_admin')
        .eq('id', session.user.id).single();
      if (!data?.company_id) { router.push('/'); return; }
      setUserInfo({ ...data, uid: session.user.id });
      setLoading(false);
    };
    init();
  }, []);

  useEffect(() => {
    if (!userInfo) return;
    const load = async () => {
      const isAdmin = userInfo.role === 'admin' || userInfo.super_admin === true;
      let q = supabase.from('sites').select('*').eq('company_id', userInfo.company_id);
      if (!isAdmin && userInfo.team) q = q.eq('team', userInfo.team);
      const { data: siteData } = await q;
      const list = siteData || [];
      setSites(list);

      const ids = list.map((s: any) => s.id);
      if (ids.length) {
        const { count } = await supabase.from('elevators')
          .select('id', { count: 'exact' }).in('site_id', ids);
        setElevCount(count || 0);
      } else setElevCount(0);

      const names = new Set(list.map(siteName));
      const { data: f } = await supabase.from('fault_reports').select('*')
        .eq('company_id', userInfo.company_id)
        .in('status', ['접수대기', '진행중'])
        .order('created_at', { ascending: false });
      setFaults((f || []).filter((x: any) => names.has(x.site_name || x.siteName)));

      const { data: m } = await supabase.from('material_usages').select('*')
        .eq('company_id', userInfo.company_id)
        .eq('status', '신청중')
        .order('created_at', { ascending: false });
      setMaterials((m || []).filter((x: any) => names.has(x.site_name || x.siteName)));
    };
    load();
    const iv = setInterval(load, 60000);
    return () => clearInterval(iv);
  }, [userInfo]);

  const counts = { fault: faults.length, material: materials.length };
  const filtered = sites.filter(s => {
    if (!search) return true;
    const q = search.toLowerCase();
    return siteName(s).toLowerCase().includes(q) || (s.address || '').toLowerCase().includes(q);
  });

  if (loading) return (
    <div className="wLoad"><div><div style={{ fontSize: 36 }}>🛗</div><p>로딩 중...</p></div></div>
  );

  return (
    <div className="wRoot">
      <header className="wHead">
        <div className="wHeadTop">
          <span className="wLogo">🛗 LiftField</span>
          <button className="wOut" onClick={async () => { await supabase.auth.signOut(); router.push('/'); }}>
            로그아웃
          </button>
        </div>
        <div className="wHeadSub">
          <strong>{userInfo?.name}님</strong>
          {userInfo?.team && <span className="wTeam">{userInfo.team}</span>}
          <span className="wDate">{new Date().toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric', weekday: 'short' })}</span>
        </div>
      </header>

      <main className="wMain">
        <div className="wKpi">
          {[
            { ic: '🏢', val: sites.length,    lbl: '담당 현장',   c: '#10b981' },
            { ic: '🛗', val: elevCount,       lbl: '담당 승강기', c: '#3b82f6' },
            { ic: '🔧', val: counts.fault,    lbl: '처리할 고장', c: '#ef4444' },
            { ic: '📦', val: counts.material, lbl: '자재 신청중', c: '#8b5cf6' },
          ].map((k, i) => (
            <div key={i} className="wKpiCard" style={{ borderTopColor: k.c }}>
              <span className="wKpiIc">{k.ic}</span>
              <span className="wKpiVal">{k.val}</span>
              <span className="wKpiLbl">{k.lbl}</span>
            </div>
          ))}
        </div>

        <div className="wTabs">
          <button className={tab === 'site' ? 'wTab on' : 'wTab'} onClick={() => setTab('site')}>
            내 현장 {sites.length}
          </button>
          <button className={tab === 'alert' ? 'wTab on' : 'wTab'} onClick={() => setTab('alert')}>
            알림 {counts.fault + counts.material}
          </button>
        </div>

        {tab === 'site' && (
          <>
            <input className="wSearch" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="🔍 현장명 또는 주소 검색" />
            <div className="wList">
              {filtered.length === 0 ? (
                <div className="wEmpty"><div style={{ fontSize: 28 }}>🏢</div>담당 현장이 없어요</div>
              ) : filtered.map(s => (
                <div key={s.id} className="wCard">
                  <div className="wCardTop">
                    <span className="wCardName">{siteName(s)}</span>
                    {s.elevator_count ? <span className="wPill">{s.elevator_count}대</span> : null}
                  </div>
                  {s.address && <div className="wAddr">{s.address}</div>}
                  <div className="wRow">
                    {s.access_code && <span className="wKey">🔑 {s.access_code}</span>}
                    {s.emergency_phone && (
                      <a className="wCall" href={`tel:${String(s.emergency_phone).replace(/[^0-9+]/g, '')}`}>
                        📞 {s.emergency_phone}
                      </a>
                    )}
                    {s.address && (
                      <a className="wNav" target="_blank" rel="noreferrer"
                        href={`https://map.kakao.com/link/search/${encodeURIComponent(s.address)}`}>
                        🗺️ 길찾기
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {tab === 'alert' && (
          <div className="wList">
            {counts.fault + counts.material === 0 ? (
              <div className="wEmpty"><div style={{ fontSize: 28 }}>✅</div>대기 중인 항목 없음</div>
            ) : (
              <>
                {faults.map(x => (
                  <div key={x.id} className="wCard alert red" onClick={() => router.push('/fault')}>
                    <div className="wCardTop">
                      <span className="wCardName">{x.site_name} · {x.hogi_no}</span>
                      <span className="wAgo">{timeAgo(x.created_at)}</span>
                    </div>
                    <div className="wDesc">{x.content}</div>
                    <div className="wMeta">🔧 {x.status} · 담당 {x.assigned_name || '미배정'}</div>
                  </div>
                ))}
                {materials.map(x => (
                  <div key={x.id} className="wCard alert purple" onClick={() => router.push('/material')}>
                    <div className="wCardTop">
                      <span className="wCardName">{x.site_name}</span>
                      <span className="wAgo">{timeAgo(x.created_at)}</span>
                    </div>
                    <div className="wDesc">📦 {x.item_name}</div>
                    <div className="wMeta">신청자 {x.requester_name || '-'}</div>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </main>

      <nav className="wNavBar">
        {MENUS.map(m => {
          const cnt = m.badgeKey ? (counts as any)[m.badgeKey] : 0;
          return (
            <button key={m.path} onClick={() => router.push(m.path)}>
              <span className="wNavIc">{m.icon}{cnt > 0 && <i className="wDot">{cnt}</i>}</span>
              <span className="wNavLbl">{m.label}</span>
            </button>
          );
        })}
      </nav>

      <style>{`
        * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
        .wLoad { min-height:100vh; display:flex; align-items:center; justify-content:center;
          background:#f8fafc; text-align:center; color:#94a3b8; font-size:13px; }
        .wRoot { min-height:100dvh; background:#f1f5f9; padding-bottom:calc(66px + env(safe-area-inset-bottom));
          font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans KR",sans-serif; }

        .wHead { position:sticky; top:0; z-index:20; background:#0f172a; padding:10px 14px 8px; }
        .wHeadTop { display:flex; align-items:center; justify-content:space-between; }
        .wLogo { color:#f8fafc; font-weight:800; font-size:15px; }
        .wOut { background:none; border:1px solid #334155; border-radius:6px; color:#64748b;
          font-size:11px; padding:4px 9px; font-family:inherit; }
        .wHeadSub { display:flex; align-items:center; gap:7px; margin-top:6px; font-size:12px; color:#94a3b8; flex-wrap:wrap; }
        .wHeadSub strong { color:#e2e8f0; font-size:13px; }
        .wTeam { background:#1e3a5f; color:#93c5fd; font-size:11px; font-weight:700; padding:2px 8px; border-radius:10px; }
        .wDate { margin-left:auto; font-size:11px; }

        .wMain { padding:12px 12px 0; }
        .wKpi { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
        .wKpiCard { background:#fff; border-radius:12px; border-top:3px solid; padding:12px 10px;
          display:flex; flex-direction:column; align-items:flex-start; box-shadow:0 1px 3px rgba(0,0,0,.05); }
        .wKpiIc { font-size:15px; }
        .wKpiVal { font-size:26px; font-weight:900; line-height:1.1; color:#0f172a; }
        .wKpiLbl { font-size:11px; color:#94a3b8; font-weight:600; margin-top:2px; }

        .wTabs { display:flex; gap:8px; margin:14px 0 10px; }
        .wTab { flex:1; padding:10px; border-radius:10px; border:1px solid #e2e8f0; background:#fff;
          font-size:13px; font-weight:700; color:#64748b; font-family:inherit; }
        .wTab.on { background:#3b82f6; border-color:#3b82f6; color:#fff; }

        .wSearch { width:100%; border:1px solid #e2e8f0; border-radius:10px; padding:11px 12px;
          font-size:15px; background:#fff; outline:none; font-family:inherit; margin-bottom:10px; }

        .wList { display:flex; flex-direction:column; gap:8px; }
        .wEmpty { text-align:center; color:#94a3b8; font-size:13px; padding:40px 0; }
        .wCard { background:#fff; border-radius:12px; padding:12px; box-shadow:0 1px 3px rgba(0,0,0,.05); }
        .wCard.alert { border-left:3px solid; }
        .wCard.red { border-left-color:#ef4444; background:#fef2f2; }
        .wCard.purple { border-left-color:#8b5cf6; background:#faf5ff; }
        .wCardTop { display:flex; align-items:center; gap:8px; }
        .wCardName { font-size:15px; font-weight:700; color:#1e293b; flex:1;
          overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .wPill { font-size:11px; font-weight:700; background:#eff6ff; color:#3b82f6;
          padding:2px 7px; border-radius:7px; flex-shrink:0; }
        .wAgo { font-size:11px; color:#94a3b8; flex-shrink:0; }
        .wAddr { font-size:12px; color:#64748b; margin-top:4px; line-height:1.4; }
        .wDesc { font-size:13px; color:#475569; margin-top:5px; line-height:1.4; }
        .wMeta { font-size:11px; color:#94a3b8; margin-top:5px; }
        .wRow { display:flex; gap:6px; margin-top:9px; flex-wrap:wrap; }
        .wKey, .wCall, .wNav { font-size:13px; font-weight:700; padding:7px 11px; border-radius:9px;
          text-decoration:none; display:inline-block; }
        .wKey { background:#fef9c3; color:#a16207; }
        .wCall { background:#dcfce7; color:#15803d; }
        .wNav { background:#eff6ff; color:#2563eb; }

        .wNavBar { position:fixed; bottom:0; left:0; right:0; z-index:30; background:#0f172a;
          display:flex; border-top:1px solid #1e293b; padding-bottom:env(safe-area-inset-bottom); }
        .wNavBar button { flex:1; background:none; border:none; padding:9px 0 8px; display:flex;
          flex-direction:column; align-items:center; gap:3px; font-family:inherit; }
        .wNavIc { font-size:19px; position:relative; }
        .wDot { position:absolute; top:-4px; right:-9px; background:#ef4444; color:#fff; font-size:9px;
          font-weight:800; font-style:normal; min-width:15px; height:15px; line-height:15px;
          border-radius:8px; padding:0 3px; }
        .wNavLbl { font-size:10px; color:#94a3b8; font-weight:600; }

        @media (min-width:768px) {
          .wRoot { padding-bottom:0; display:flex; flex-direction:column; min-height:100vh; }
          .wKpi { grid-template-columns:repeat(4,1fr); gap:10px; }
          .wKpiVal { font-size:30px; }
          .wMain { max-width:1100px; width:100%; margin:0 auto; padding:16px 20px 90px; flex:1; }
          .wTabs { max-width:400px; }
          .wNavBar { justify-content:center; gap:10px; }
          .wNavBar button { flex:0 0 96px; }
        }
      `}</style>
    </div>
  );
}
