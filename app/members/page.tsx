'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

interface Member {
  id: string;
  name: string;
  email: string;
  role: string;
  team: string;
  phone?: string;
  annual_leave?: number;
}

interface LeaveRequest {
  id: string;
  user_id: string;
  user_name: string;
  type: string;
  start_date: string;
  end_date: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  created_at?: string;
}

type TabType = 'members' | 'leave';

export default function MembersPage() {
  const router = useRouter();
  const [userInfo, setUserInfo] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [members, setMembers] = useState<Member[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [teams, setTeams] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<TabType>('members');
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const [showMemberModal, setShowMemberModal] = useState(false);
  const [editRole, setEditRole] = useState('');
  const [editTeam, setEditTeam] = useState('');
  const [editAnnualLeave, setEditAnnualLeave] = useState(0);
  const [saving, setSaving] = useState(false);

  const canEdit = userInfo?.role === 'admin' || userInfo?.super_admin === true;

  // ─── 인증 ───
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!session) { router.push('/login'); return; }

      const { data: userData, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', session.user.id)
        .single();

      if (error || !userData) { router.push('/login'); return; }
      if (!userData.company_id) { router.push('/'); return; }

      setUserInfo({ uid: session.user.id, ...userData });
      await loadData(userData.company_id);
    });
    return () => subscription.unsubscribe();
  }, []);

  const loadData = async (companyId: string) => {
    try {
      // 직원 목록
      const { data: memberData } = await supabase
        .from('users')
        .select('*')
        .eq('company_id', companyId);

      const list: Member[] = (memberData || []).map(d => ({
        id: d.id,
        name: d.name || '',
        email: d.email || '',
        role: d.role || 'member',
        team: d.team || '',
        phone: d.phone || '',
        annual_leave: d.annual_leave ?? 15,
      }));
      setMembers(list);

      // 팀 목록 (teams 테이블 또는 users에서 추출)
      const { data: teamData } = await supabase
        .from('teams')
        .select('name')
        .eq('company_id', companyId);

      if (teamData && teamData.length > 0) {
        setTeams(teamData.map(t => t.name).filter(Boolean));
      } else {
        // teams 테이블이 없으면 members의 team 값에서 추출
        const teamSet = new Set(list.map(m => m.team).filter(Boolean));
        setTeams(Array.from(teamSet));
      }

      // 휴가 신청 목록
      const { data: leaveData } = await supabase
        .from('leave_requests')
        .select('*')
        .eq('company_id', companyId)
        .order('created_at', { ascending: false });

      setLeaveRequests((leaveData || []) as LeaveRequest[]);

    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  // ─── 직원 수정 ───
  async function handleSaveMember() {
    if (!selectedMember) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from('users')
        .update({ role: editRole, team: editTeam, annual_leave: editAnnualLeave })
        .eq('id', selectedMember.id);

      if (error) throw error;

      setMembers(prev => prev.map(m =>
        m.id === selectedMember.id
          ? { ...m, role: editRole, team: editTeam, annual_leave: editAnnualLeave }
          : m
      ));
      setShowMemberModal(false);
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  }

  // ─── 직원 삭제 ───
  async function handleDeleteMember(memberId: string) {
    if (!confirm('직원을 삭제할까요?')) return;
    try {
      const { error } = await supabase.from('users').delete().eq('id', memberId);
      if (error) throw error;
      setMembers(prev => prev.filter(m => m.id !== memberId));
      setShowMemberModal(false);
    } catch (e) {
      console.error(e);
    }
  }

  // ─── 휴가 승인/거절 ───
  async function handleLeaveStatus(leaveId: string, status: 'approved' | 'rejected') {
    try {
      const { error } = await supabase
        .from('leave_requests')
        .update({ status })
        .eq('id', leaveId);

      if (error) throw error;
      setLeaveRequests(prev => prev.map(l => l.id === leaveId ? { ...l, status } : l));
    } catch (e) {
      console.error(e);
    }
  }

  // ─── 휴가 삭제 ───
  async function handleDeleteLeave(leaveId: string) {
    if (!confirm('휴가 신청을 삭제할까요?')) return;
    try {
      const { error } = await supabase.from('leave_requests').delete().eq('id', leaveId);
      if (error) throw error;
      setLeaveRequests(prev => prev.filter(l => l.id !== leaveId));
    } catch (e) {
      console.error(e);
    }
  }

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <p className="text-gray-500">로딩 중...</p>
    </div>
  );

  const pendingLeave = leaveRequests.filter(l => l.status === 'pending').length;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b px-4 py-3 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-2">
          <button onClick={() => router.push('/dashboard')} className="text-gray-500 hover:text-gray-700 text-lg">←</button>
          <h1 className="font-bold text-lg">👥 직원 관리</h1>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 py-4">
        {/* 탭 */}
        <div className="flex gap-2 mb-4">
          <button onClick={() => setActiveTab('members')}
            className={`px-4 py-1.5 rounded-xl text-sm font-medium transition-colors ${
              activeTab === 'members' ? 'bg-blue-500 text-white' : 'bg-white text-gray-600 border'}`}>
            👥 직원 목록 ({members.length})
          </button>
          <button onClick={() => setActiveTab('leave')}
            className={`px-4 py-1.5 rounded-xl text-sm font-medium transition-colors relative ${
              activeTab === 'leave' ? 'bg-blue-500 text-white' : 'bg-white text-gray-600 border'}`}>
            📅 연차/휴가 관리
            {pendingLeave > 0 && (
              <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs w-4 h-4 rounded-full flex items-center justify-center">
                {pendingLeave}
              </span>
            )}
          </button>
        </div>

        {/* ─── 직원 목록 탭 ─── */}
        {activeTab === 'members' && (
          <div className="bg-white rounded-xl border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b">
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">이름</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">이메일</th>
                  <th className="text-center px-4 py-3 font-semibold text-gray-600">역할</th>
                  <th className="text-center px-4 py-3 font-semibold text-gray-600">팀</th>
                  <th className="text-center px-4 py-3 font-semibold text-gray-600">연차</th>
                  {canEdit && <th className="text-center px-4 py-3 font-semibold text-gray-600">관리</th>}
                </tr>
              </thead>
              <tbody>
                {members.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center py-16 text-gray-400">
                      <p className="text-3xl mb-2">👥</p><p>직원이 없어요</p>
                    </td>
                  </tr>
                ) : members.map((member, idx) => (
                  <tr key={member.id} className={`border-b last:border-0 ${idx % 2 === 0 ? '' : 'bg-gray-50/50'}`}>
                    <td className="px-4 py-3 font-medium text-gray-800">{member.name}</td>
                    <td className="px-4 py-3 text-gray-500">{member.email}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        member.role === 'admin' ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-600'
                      }`}>
                        {member.role === 'admin' ? '관리자' : '팀원'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {member.team
                        ? <span className="text-xs bg-green-100 text-green-600 px-2 py-0.5 rounded-full">{member.team}</span>
                        : '-'}
                    </td>
                    <td className="px-4 py-3 text-center text-gray-600">{member.annual_leave ?? 15}일</td>
                    {canEdit && (
                      <td className="px-4 py-3 text-center">
                        <button onClick={() => {
                          setSelectedMember(member);
                          setEditRole(member.role);
                          setEditTeam(member.team);
                          setEditAnnualLeave(member.annual_leave ?? 15);
                          setShowMemberModal(true);
                        }} className="text-xs bg-blue-50 text-blue-600 px-3 py-1 rounded-lg hover:bg-blue-100">
                          수정
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ─── 연차/휴가 탭 ─── */}
        {activeTab === 'leave' && (
          <div className="space-y-3">
            {leaveRequests.length === 0 ? (
              <div className="bg-white rounded-xl border p-16 text-center text-gray-400">
                <p className="text-3xl mb-2">📅</p><p>휴가 신청이 없어요</p>
              </div>
            ) : leaveRequests.map(leave => (
              <div key={leave.id} className="bg-white rounded-xl border p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold text-gray-800">{leave.user_name}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        leave.type === '연차' ? 'bg-blue-100 text-blue-600' :
                        leave.type === '반차' ? 'bg-purple-100 text-purple-600' :
                        'bg-orange-100 text-orange-600'
                      }`}>{leave.type}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        leave.status === 'pending' ? 'bg-yellow-100 text-yellow-600' :
                        leave.status === 'approved' ? 'bg-green-100 text-green-600' :
                        'bg-red-100 text-red-600'
                      }`}>
                        {leave.status === 'pending' ? '대기' : leave.status === 'approved' ? '승인' : '거절'}
                      </span>
                    </div>
                    <p className="text-sm text-gray-500">📅 {leave.start_date} ~ {leave.end_date}</p>
                    {leave.reason && <p className="text-sm text-gray-600 mt-1">💬 {leave.reason}</p>}
                  </div>
                  {canEdit && (
                    <div className="flex gap-2">
                      {leave.status === 'pending' && (
                        <>
                          <button onClick={() => handleLeaveStatus(leave.id, 'approved')}
                            className="text-xs bg-green-500 text-white px-3 py-1.5 rounded-lg hover:bg-green-600">승인</button>
                          <button onClick={() => handleLeaveStatus(leave.id, 'rejected')}
                            className="text-xs bg-red-500 text-white px-3 py-1.5 rounded-lg hover:bg-red-600">거절</button>
                        </>
                      )}
                      <button onClick={() => handleDeleteLeave(leave.id)}
                        className="text-xs bg-gray-100 text-red-500 px-3 py-1.5 rounded-lg hover:bg-red-50">
                        🗑 삭제
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ─── 직원 수정 모달 ─── */}
      {showMemberModal && selectedMember && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-lg">{selectedMember.name}</h2>
              <button onClick={() => setShowMemberModal(false)} className="text-gray-400 text-xl">✕</button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-sm text-gray-600 mb-1 block">역할</label>
                <select value={editRole} onChange={e => setEditRole(e.target.value)}
                  className="w-full border rounded-xl px-3 py-2 text-sm">
                  <option value="member">팀원</option>
                  <option value="admin">관리자</option>
                </select>
              </div>
              <div>
                <label className="text-sm text-gray-600 mb-1 block">팀 배정</label>
                <select value={editTeam} onChange={e => setEditTeam(e.target.value)}
                  className="w-full border rounded-xl px-3 py-2 text-sm">
                  <option value="">팀 미배정</option>
                  {teams.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="text-sm text-gray-600 mb-1 block">연차 일수</label>
                <input type="number" value={editAnnualLeave} onChange={e => setEditAnnualLeave(Number(e.target.value))}
                  className="w-full border rounded-xl px-3 py-2 text-sm" />
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={() => handleDeleteMember(selectedMember.id)}
                className="flex-1 py-2 border border-red-300 text-red-500 rounded-xl text-sm">삭제</button>
              <button onClick={handleSaveMember} disabled={saving}
                className="flex-1 py-2 bg-blue-500 text-white rounded-xl text-sm font-medium disabled:opacity-50">
                {saving ? '저장 중...' : '저장'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
