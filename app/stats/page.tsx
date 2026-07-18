'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

interface Inspection {
  id: string;
  company_id: string;
  scheduled_date: string;
  status: string;
  team_name: string;
  total_count: number;
  completed_count: number;
}

interface FaultReport {
  id: string;
  company_id: string;
  status: string;
  team: string;
}

export default function StatsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [inspections, setInspections] = useState<Inspection[]>([]);
  const [faultReports, setFaultReports] = useState<FaultReport[]>([]);

  // ─── 인증 + 데이터 로드 ───
  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/login'); return; }

      const { data: userData } = await supabase
        .from('users')
        .select('*')
        .eq('id', user.id)
        .single();
      if (!userData) { router.push('/login'); return; }

      const cid = userData.company_id;
      if (!cid) { router.push('/'); return; }

      // 점검 + 고장 동시 로드 (useNewStructure 패턴 제거)
      const [{ data: inspData }, { data: faultData }] = await Promise.all([
        supabase
          .from('inspections')
          .select('*')
          .eq('company_id', cid)
          .order('scheduled_date', { ascending: false }),
        supabase
          .from('fault_reports')
          .select('*')
          .eq('company_id', cid)
          .order('created_at', { ascending: false }),
      ]);

      setInspections((inspData || []) as Inspection[]);
      setFaultReports((faultData || []) as FaultReport[]);
      setLoading(false);
    };

    init();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') router.push('/login');
    });
    return () => subscription.unsubscribe();
  }, []);

  // ─── 점검 통계 ───
  const totalInspections      = inspections.length;
  const completedInspections  = inspections.filter(i => i.status === '완료').length;
  const pendingInspections    = inspections.filter(i => i.status === '예정').length;
  const inProgressInspections = inspections.filter(i => i.status === '진행중').length;
  const completionRate = totalInspections > 0
    ? Math.round((completedInspections / totalInspections) * 100) : 0;

  // ─── 고장 통계 ───
  const totalFaults     = faultReports.length;
  const resolvedFaults  = faultReports.filter(f => f.status === '완료' || f.status === '처리완료').length;
  const pendingFaults   = faultReports.filter(f => f.status === '접수' || f.status === '신규' || f.status === '신청중').length;
  const faultResolveRate = totalFaults > 0
    ? Math.round((resolvedFaults / totalFaults) * 100) : 0;

  // ─── 월별 통계 ───
  const monthlyStats = (() => {
    const map: Record<string, { total: number; completed: number }> = {};
    inspections.forEach(i => {
      if (!i.scheduled_date) return;
      const month = i.scheduled_date.slice(0, 7);
      if (!map[month]) map[month] = { total: 0, completed: 0 };
      map[month].total++;
      if (i.status === '완료') map[month].completed++;
    });
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b)).slice(-6);
  })();

  // ─── 팀별 점검 통계 ───
  const teamStats = (() => {
    const map: Record<string, { total: number; completed: number }> = {};
    inspections.forEach(i => {
      const team = i.team_name || '미배정';
      if (!map[team]) map[team] = { total: 0, completed: 0 };
      map[team].total++;
      if (i.status === '완료') map[team].completed++;
    });
    return Object.entries(map).sort(([, a], [, b]) => b.total - a.total);
  })();

  // ─── 팀별 고장 통계 ───
  const teamFaultStats = (() => {
    const map: Record<string, { total: number; resolved: number; pending: number }> = {};
    faultReports.forEach(f => {
      const team = f.team || '미배정';
      if (!map[team]) map[team] = { total: 0, resolved: 0, pending: 0 };
      map[team].total++;
      if (f.status === '완료' || f.status === '처리완료') map[team].resolved++;
      if (f.status === '접수' || f.status === '신규' || f.status === '신청중') map[team].pending++;
    });
    return Object.entries(map).sort(([, a], [, b]) => b.total - a.total);
  })();

  const maxMonthly = Math.max(...monthlyStats.map(([, v]) => v.total), 1);

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <p className="text-gray-500">로딩 중...</p>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 헤더 */}
      <header className="bg-white border-b px-4 py-3 flex items-center gap-2 sticky top-0 z-10">
        <button onClick={() => router.push('/')} className="text-gray-500 hover:text-gray-700 text-lg">←</button>
        <h1 className="font-bold text-lg">📊 통계</h1>
      </header>

      <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">

        {/* ── 점검 요약 카드 ── */}
        <div>
          <h2 className="text-sm font-bold text-gray-500 mb-3">📋 점검 현황</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: '전체 점검', value: totalInspections,     color: 'blue',   icon: '📋' },
              { label: '완료',      value: completedInspections,  color: 'green',  icon: '✅' },
              { label: '예정',      value: pendingInspections,    color: 'yellow', icon: '📅' },
              { label: '완료율',    value: `${completionRate}%`,  color: 'purple', icon: '📈' },
            ].map(card => (
              <div key={card.label} className="bg-white rounded-2xl border p-4 shadow-sm">
                <div className="flex items-center gap-2 mb-1">
                  <span>{card.icon}</span>
                  <p className="text-xs text-gray-500">{card.label}</p>
                </div>
                <p className={`text-2xl font-bold ${
                  card.color === 'blue' ? 'text-blue-600' :
                  card.color === 'green' ? 'text-green-600' :
                  card.color === 'yellow' ? 'text-yellow-600' :
                  'text-purple-600'
                }`}>{card.value}</p>
              </div>
            ))}
          </div>
        </div>

        {/* ── 고장접수 요약 카드 ── */}
        <div>
          <h2 className="text-sm font-bold text-gray-500 mb-3">🔧 고장접수 현황</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: '전체 고장',  value: totalFaults,            color: 'gray',   icon: '🔧' },
              { label: '처리완료',   value: resolvedFaults,         color: 'green',  icon: '✅' },
              { label: '접수/대기',  value: pendingFaults,          color: 'red',    icon: '🚨' },
              { label: '처리율',     value: `${faultResolveRate}%`, color: 'purple', icon: '📊' },
            ].map(card => (
              <div key={card.label} className="bg-white rounded-2xl border p-4 shadow-sm">
                <div className="flex items-center gap-2 mb-1">
                  <span>{card.icon}</span>
                  <p className="text-xs text-gray-500">{card.label}</p>
                </div>
                <p className={`text-2xl font-bold ${
                  card.color === 'gray'   ? 'text-gray-600'   :
                  card.color === 'green'  ? 'text-green-600'  :
                  card.color === 'red'    ? 'text-red-600'    :
                  'text-purple-600'
                }`}>{card.value}</p>
              </div>
            ))}
          </div>
        </div>

        {/* ── 완료율 게이지 ── */}
        <div className="bg-white rounded-2xl border p-5 shadow-sm">
          <h2 className="font-bold text-gray-800 mb-4">📈 점검 완료율</h2>
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <div className="flex justify-between text-sm text-gray-500 mb-1">
                <span>완료 {completedInspections}건</span>
                <span>전체 {totalInspections}건</span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-4">
                <div className="bg-green-500 h-4 rounded-full transition-all duration-500"
                  style={{ width: `${completionRate}%` }} />
              </div>
              <div className="flex justify-between text-xs text-gray-400 mt-1">
                <span>0%</span>
                <span className="font-bold text-green-600">{completionRate}%</span>
                <span>100%</span>
              </div>
            </div>
          </div>
          <div className="flex gap-4 mt-4 text-sm">
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-full bg-green-500"></div>
              <span className="text-gray-600">완료 {completedInspections}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-full bg-yellow-400"></div>
              <span className="text-gray-600">예정 {pendingInspections}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-full bg-blue-400"></div>
              <span className="text-gray-600">진행중 {inProgressInspections}</span>
            </div>
          </div>
        </div>

        {/* ── 월별 점검 현황 ── */}
        <div className="bg-white rounded-2xl border p-5 shadow-sm">
          <h2 className="font-bold text-gray-800 mb-4">📅 월별 점검 현황 (최근 6개월)</h2>
          {monthlyStats.length === 0 ? (
            <p className="text-center text-gray-400 py-8">데이터가 없어요</p>
          ) : (
            <div className="space-y-3">
              {monthlyStats.map(([month, data]) => (
                <div key={month}>
                  <div className="flex justify-between text-sm text-gray-600 mb-1">
                    <span className="font-medium">{month}</span>
                    <span>{data.completed}/{data.total}건 완료</span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-6 relative">
                    <div className="bg-blue-200 h-6 rounded-full"
                      style={{ width: `${(data.total / maxMonthly) * 100}%` }} />
                    <div className="bg-blue-500 h-6 rounded-full absolute top-0 left-0"
                      style={{ width: `${(data.completed / maxMonthly) * 100}%` }} />
                    <span className="absolute right-2 top-0 h-6 flex items-center text-xs text-gray-600 font-medium">
                      {data.total > 0 ? Math.round((data.completed / data.total) * 100) : 0}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── 팀별 점검 현황 ── */}
        <div className="bg-white rounded-2xl border p-5 shadow-sm">
          <h2 className="font-bold text-gray-800 mb-4">👥 팀별 점검 현황</h2>
          {teamStats.length === 0 ? (
            <p className="text-center text-gray-400 py-8">데이터가 없어요</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b">
                    <th className="text-left px-4 py-2.5 font-semibold text-gray-600">팀명</th>
                    <th className="text-center px-4 py-2.5 font-semibold text-gray-600">전체</th>
                    <th className="text-center px-4 py-2.5 font-semibold text-gray-600">완료</th>
                    <th className="text-center px-4 py-2.5 font-semibold text-gray-600">완료율</th>
                    <th className="px-4 py-2.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {teamStats.map(([team, data]) => {
                    const rate = data.total > 0 ? Math.round((data.completed / data.total) * 100) : 0;
                    return (
                      <tr key={team} className="border-b last:border-0">
                        <td className="px-4 py-3 font-medium text-gray-800">{team}</td>
                        <td className="px-4 py-3 text-center text-gray-600">{data.total}</td>
                        <td className="px-4 py-3 text-center text-green-600 font-medium">{data.completed}</td>
                        <td className="px-4 py-3 text-center">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                            rate >= 80 ? 'bg-green-100 text-green-600' :
                            rate >= 50 ? 'bg-yellow-100 text-yellow-600' :
                            'bg-red-100 text-red-600'
                          }`}>{rate}%</span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="w-24 bg-gray-100 rounded-full h-2">
                            <div className="bg-blue-500 h-2 rounded-full" style={{ width: `${rate}%` }} />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── 팀별 고장 현황 ── */}
        <div className="bg-white rounded-2xl border p-5 shadow-sm">
          <h2 className="font-bold text-gray-800 mb-4">🔧 팀별 고장접수 현황</h2>
          {teamFaultStats.length === 0 ? (
            <p className="text-center text-gray-400 py-8">고장접수 데이터가 없어요</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b">
                    <th className="text-left px-4 py-2.5 font-semibold text-gray-600">팀명</th>
                    <th className="text-center px-4 py-2.5 font-semibold text-gray-600">전체</th>
                    <th className="text-center px-4 py-2.5 font-semibold text-gray-600">처리완료</th>
                    <th className="text-center px-4 py-2.5 font-semibold text-gray-600">대기중</th>
                    <th className="text-center px-4 py-2.5 font-semibold text-gray-600">처리율</th>
                    <th className="px-4 py-2.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {teamFaultStats.map(([team, data]) => {
                    const rate = data.total > 0 ? Math.round((data.resolved / data.total) * 100) : 0;
                    return (
                      <tr key={team} className="border-b last:border-0">
                        <td className="px-4 py-3 font-medium text-gray-800">{team}</td>
                        <td className="px-4 py-3 text-center text-gray-600">{data.total}</td>
                        <td className="px-4 py-3 text-center text-green-600 font-medium">{data.resolved}</td>
                        <td className="px-4 py-3 text-center text-red-500 font-medium">{data.pending}</td>
                        <td className="px-4 py-3 text-center">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                            rate >= 80 ? 'bg-green-100 text-green-600' :
                            rate >= 50 ? 'bg-yellow-100 text-yellow-600' :
                            'bg-red-100 text-red-600'
                          }`}>{rate}%</span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="w-24 bg-gray-100 rounded-full h-2">
                            <div className="bg-red-400 h-2 rounded-full" style={{ width: `${rate}%` }} />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
