'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

const MENUS = [
  { icon: '🏢', label: '내 현장',   path: '/team-sites' },
  { icon: '🔧', label: '고장접수',  path: '/fault',      badgeKey: 'fault' },
  { icon: '📋', label: '점검관리',  path: '/inspection' },
  { icon: '🔍', label: '검사지적',  path: '/inspect' },
  { icon: '📦', label: '자재신청',  path: '/material',   badgeKey: 'material' },
];

const siteName = (s: any) => s.site_name || s.name || '';
const dday = (d?: string) => {
  if (!d) return null;
  const t = new Date(); t.setHours(0,0,0,0);
  const x = new Date(d); x.setHours(0,0,0,0);
  return Math.ceil((x.getTime() - t.getTime()) / 86400000);
};
const timeAgo = (v: any) => {
  if (!v) return '-';
  const m = Math.floor((Date.now() - new Date(v).getTime()) / 60000);
  if (m < 1) return '방금 전';
  if (m < 60) return `${m}분 전`;
  if (m < 1440) return `${Math.floor(m/60)}시간 전`;
  return `${Math.floor(m/1440)}일 전`;
};

export default function WorkPage() {
  const router = useRouter();
  const [userInfo, setUserInfo] = useState<any>(null);
  const [loading, setLoading]   = useState(true);
  const [sites, setSites]       = useState<any[]>([]);
  const [elevCount, setElevCount] = useState(0);
  const [faults, setFaults]     = useState<any[]>([]);
  const [materials, setMaterials] = useState<any[]>([]);
  const [search, setSearch]     = useState('');
  const [today, setToday]       = useState('');

  useEffect(() => {
    setToday(new Date().toLocaleDateString('ko-KR', { month:'long', day:'numeric', weekday:'short' }));
  }, []);

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
  const expiring = sites.filter(s => { const d = dday(s.contract_end); return d !== null && d <= 60; });
  const filtered = sites.filter(s => {
    if (!search) return true;
    const q = search.toLowerCase();
    return siteName(s).toLowerCase().includes(q) || (s.address || '').toLowerCase().includes(q);
  });

  if (loading) return (
    <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'#f8fafc' }}>
      <div style={{ textAlign:'center' }}>
        <div style={{ fontSize:36 }}>🛗</div>
        <p style={{ color:'#94a3b8', fontSize:13, marginTop:10 }}>로딩 중...</p>
      </div>
    </div>
  );

  return (
    <div style={{ height:'100vh', overflow:'hidden', display:'flex', flexDirection:'column',
      fontFamily:'-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans KR", sans-serif', background:'#0f172a' }}>

      <header style={{ height:50, background:'#0f172a', borderBottom:'1px solid #1e293b',
        display:'flex', alignItems:'center', justifyContent:'space-between', padding:'0 20px', flexShrink:0 }}>
        <div style={{ display:'flex', alignItems:'center', gap:12 }}>
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <div style={{ width:28, height:28, borderRadius:7, background:'linear-gradient(135deg,#3b82f6,#6366f1)',
              display:'flex', alignItems:'center', justifyContent:'center', fontSize:14 }}>🛗</div>
            <span style={{ color:'#f8fafc', fontWeight:800, fontSize:16 }}>LiftField</span>
          </div>
          <div style={{ width:1, height:16, background:'#334155' }} />
          <span style={{ color:'#64748b', fontSize:13, fontWeight:600 }}>현장 업무</span>
          {userInfo?.team && (
            <span style={{ background:'#1e3a5f', color:'#93c5fd', fontSize:11, fontWeight:700, padding:'2px 8px', borderRadius:12 }}>
              {userInfo.team}
            </span>
          )}
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <span style={{ fontSize:13, color:'#cbd5e1', fontWeight:600 }}>{userInfo?.name}님</span>
          <button onClick={async () => { await supabase.auth.signOut(); router.push('/'); }}
            style={{ background:'none', border:'1px solid #334155', borderRadius:6, color:'#64748b',
              fontSize:12, padding:'4px 10px', cursor:'pointer', fontFamily:'inherit' }}>로그아웃</button>
        </div>
      </header>

      <div style={{ display:'flex', flex:1, overflow:'hidden' }}>
        <aside style={{ width:188, background:'#0f172a', borderRight:'1px solid #1e293b',
          display:'flex', flexDirection:'column', padding:'12px 0', flexShrink:0 }}>
          <div style={{ padding:'0 10px 6px', fontSize:10, fontWeight:700, color:'#334155', letterSpacing:'1.2px' }}>MENU</div>
          {MENUS.map(m => {
            const cnt = m.badgeKey ? (counts as any)[m.badgeKey] : 0;
            return (
              <button key={m.path} onClick={() => router.push(m.path)}
                style={{ width:'100%', display:'flex', alignItems:'center', gap:8, padding:'10px',
                  border:'none', borderLeft:'2px solid transparent', background:'none',
                  cursor:'pointer', textAlign:'left', fontFamily:'inherit' }}
                onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.background = '#1e293b'}
                onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.background = 'none'}>
                <div style={{ width:26, height:26, borderRadius:6, background:'#1e293b', fontSize:12,
                  display:'flex', alignItems:'center', justifyContent:'center' }}>{m.icon}</div>
                <span style={{ fontSize:13, fontWeight:500, color:'#64748b', flex:1 }}>{m.label}</span>
                {cnt > 0 && <span style={{ fontSize:9, fontWeight:800, color:'#fff', padding:'2px 7px',
                  borderRadius:10, background:'#ef4444' }}>{cnt}</span>}
              </button>
            );
          })}
          <div style={{ flex:1 }} />
          <div style={{ padding:10, borderTop:'1px solid #1e293b' }}>
            <button onClick={() => router.push('/')} style={{ display:'flex', alignItems:'center', gap:6,
              fontSize:12, color:'#475569', background:'none', border:'none', cursor:'pointer', fontFamily:'inherit' }}>
              ← 홈으로
            </button>
          </div>
        </aside>

        <main style={{ flex:1, background:'#f1f5f9', display:'flex', flexDirection:'column',
          padding:'16px 20px 12px', gap:12, overflow:'hidden' }}>

          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', flexShrink:0 }}>
            <div>
              <h1 style={{ fontSize:19, fontWeight:800, color:'#0f172a', margin:0 }}>
                안녕하세요, {userInfo?.name}님 👋
              </h1>
              <p style={{ fontSize:13, color:'#94a3b8', marginTop:2 }}>
                {userInfo?.team || userInfo?.company_display_name} · 담당 현장 {sites.length}개
              </p>
            </div>
            <div style={{ background:'#fff', border:'1px solid #e2e8f0', borderRadius:16,
              padding:'5px 12px', fontSize:12, color:'#64748b', fontWeight:600 }}>{today}</div>
          </div>

          <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:10, flexShrink:0 }}>
            {[
              { ic:'🏢', val:sites.length,       lbl:'담당 현장',   c:'#10b981', path:'/team-sites' },
              { ic:'🛗', val:elevCount,          lbl:'담당 승강기', c:'#3b82f6', path:'/team-sites' },
              { ic:'🔧', val:counts.fault,       lbl:'처리할 고장', c:'#ef4444', path:'/fault' },
              { ic:'📦', val:counts.material,    lbl:'자재 신청중', c:'#8b5cf6', path:'/material' },
            ].map((k,i) => (
              <div key={i} onClick={() => router.push(k.path)}
                style={{ background:'#fff', borderRadius:12, padding:'14px 16px', display:'flex',
                  alignItems:'center', gap:12, cursor:'pointer', borderTop:`3px solid ${k.c}`,
                  boxShadow:'0 1px 3px rgba(0,0,0,.05)' }}>
                <div style={{ width:38, height:38, borderRadius:10, background:'#f8fafc', fontSize:17,
                  display:'flex', alignItems:'center', justifyContent:'center' }}>{k.ic}</div>
                <div>
                  <div style={{ fontSize:28, fontWeight:900, lineHeight:1, color:'#0f172a' }}>{k.val}</div>
                  <div style={{ fontSize:12, color:'#94a3b8', fontWeight:600, marginTop:3 }}>{k.lbl}</div>
                </div>
              </div>
            ))}
          </div>

          <div style={{ display:'grid', gridTemplateColumns:'1fr 380px', gap:12, flex:1, minHeight:0 }}>

            <div style={{ background:'#fff', borderRadius:14, display:'flex', flexDirection:'column',
              overflow:'hidden', boxShadow:'0 1px 3px rgba(0,0,0,.05)' }}>
              <div style={{ display:'flex', alignItems:'center', gap:7, padding:'12px 14px 10px',
                borderBottom:'1px solid #f1f5f9', flexShrink:0 }}>
                <div style={{ width:3, height:14, borderRadius:2, background:'#3b82f6' }} />
                <span style={{ fontSize:13, fontWeight:700, color:'#334155', flex:1 }}>내 현장</span>
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 현장 검색"
                  style={{ border:'1px solid #e2e8f0', borderRadius:7, padding:'4px 8px', fontSize:12,
                    background:'#f8fafc', outline:'none', width:160, fontFamily:'inherit' }} />
              </div>
              <div style={{ flex:1, overflowY:'auto' }}>
                <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
                  <thead>
                    <tr style={{ background:'#f8fafc', position:'sticky', top:0 }}>
                      {['현장명','주소','대수','현관번호','비상통화'].map(h => (
                        <th key={h} style={{ padding:'7px 8px', textAlign:'left', fontWeight:700,
                          color:'#64748b', fontSize:11, borderBottom:'1px solid #f1f5f9' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.length === 0 ? (
                      <tr><td colSpan={5} style={{ textAlign:'center', padding:'28px 0', color:'#94a3b8' }}>
                        <div style={{ fontSize:24, marginBottom:6 }}>🏢</div>담당 현장이 없어요
                      </td></tr>
                    ) : filtered.map(s => (
                      <tr key={s.id} style={{ borderBottom:'1px solid #f8fafc' }}>
                        <td style={{ padding:'6px 8px', fontWeight:700, color:'#1e293b' }}>{siteName(s)}</td>
                        <td style={{ padding:'6px 8px', color:'#64748b', fontSize:11 }}>{s.address || '-'}</td>
                        <td style={{ padding:'6px 8px', color:'#475569', fontSize:11 }}>{s.elevator_count ? `${s.elevator_count}대` : '-'}</td>
                        <td style={{ padding:'6px 8px', color:'#475569', fontSize:11, fontWeight:700 }}>{s.access_code || '-'}</td>
                        <td style={{ padding:'6px 8px', color:'#475569', fontSize:11 }}>{s.emergency_phone || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ padding:'6px 10px', background:'#f8fafc', borderTop:'1px solid #f1f5f9',
                display:'flex', gap:14, fontSize:11, color:'#64748b', flexShrink:0 }}>
                <span>현장 <strong style={{ color:'#334155' }}>{filtered.length}</strong>개</span>
                <span>승강기 <strong style={{ color:'#334155' }}>{elevCount}</strong>대</span>
                {expiring.length > 0 && <span style={{ color:'#f97316' }}>계약 만료 임박 {expiring.length}건</span>}
              </div>
            </div>

            <div style={{ display:'flex', flexDirection:'column', gap:10, minHeight:0 }}>
              {[
                { title:'🔧 고장 접수', color:'#ef4444', bg:'#fef2f2', list:faults, path:'/fault',
                  render:(x:any) => (<>
                    <div style={{ fontSize:12, fontWeight:700, color:'#1e293b' }}>{x.site_name} · {x.hogi_no}</div>
                    <div style={{ fontSize:10, color:'#78716c', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{x.content}</div>
                    <div style={{ fontSize:10, color:'#94a3b8', marginTop:2 }}>담당: {x.assigned_name || '미배정'} · {timeAgo(x.created_at)}</div>
                  </>) },
                { title:'📦 자재 신청', color:'#8b5cf6', bg:'#faf5ff', list:materials, path:'/material',
                  render:(x:any) => (<>
                    <div style={{ fontSize:12, fontWeight:700, color:'#1e293b' }}>{x.site_name}</div>
                    <div style={{ fontSize:11, color:'#6d28d9' }}>{x.item_name}</div>
                    <div style={{ fontSize:10, color:'#94a3b8', marginTop:2 }}>{x.requester_name || '-'} · {timeAgo(x.created_at)}</div>
                  </>) },
              ].map(sec => (
                <div key={sec.title} style={{ background:'#fff', borderRadius:14, flex:1, minHeight:0,
                  display:'flex', flexDirection:'column', overflow:'hidden', boxShadow:'0 1px 3px rgba(0,0,0,.05)' }}>
                  <div style={{ padding:'12px 14px 10px', borderBottom:'1px solid #f1f5f9', display:'flex',
                    alignItems:'center', gap:6, flexShrink:0 }}>
                    <span style={{ fontSize:13, fontWeight:700, color:'#334155', flex:1 }}>{sec.title}</span>
                    {sec.list.length > 0 && <span style={{ fontSize:9, fontWeight:800, color:'#fff',
                      padding:'2px 7px', borderRadius:10, background:sec.color }}>{sec.list.length}</span>}
                  </div>
                  <div style={{ flex:1, overflowY:'auto', padding:'8px 10px', display:'flex',
                    flexDirection:'column', gap:6 }}>
                    {sec.list.length === 0 ? (
                      <div style={{ textAlign:'center', color:'#94a3b8', fontSize:11, padding:'20px 0' }}>
                        <div style={{ fontSize:22, marginBottom:6 }}>✅</div>대기 중인 항목 없음
                      </div>
                    ) : sec.list.map((x:any) => (
                      <div key={x.id} onClick={() => router.push(sec.path)}
                        style={{ padding:'9px 10px', borderRadius:9, background:sec.bg,
                          borderLeft:`3px solid ${sec.color}`, cursor:'pointer' }}>
                        {sec.render(x)}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </main>
      </div>

      <style>{`
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 4px; height: 4px; }
        ::-webkit-scrollbar-thumb { background: #e2e8f0; border-radius: 4px; }
      `}</style>
    </div>
  );
}
