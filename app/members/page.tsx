'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { auth, db } from '@/lib/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import {
  collection, query, onSnapshot, doc, getDoc,
  updateDoc, deleteDoc, getDocs, orderBy
} from 'firebase/firestore';

interface UserInfo {
  uid: string;
  name: string;
  email: string;
  companyId: string;
  role: string;
  superAdmin?: boolean;
}

interface Member {
  id: string;
  name: string;
  email: string;
  role: string;
  team: string;
  phone?: string;
  joinedAt?: string;
  annualLeave?: number;
}

interface LeaveRequest {
  id: string;
  userId: string;
  userName: string;
  type: string;
  startDate: string;
  endDate: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt?: unknown;
}

type TabType = 'members' | 'leave';

export default function MembersPage() {
  const router = useRouter();
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
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

  const isAdmin = userInfo?.role === 'admin';
  const isSuperAdmin = userInfo?.superAdmin === true;
  const canEdit = isAdmin || isSuperAdmin;

  // ─── 인증 ───
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) { router.push('/login'); return; }
      try {
        const snap = await getDoc(doc(db, 'users', user.uid));
        if (!snap.exists()) { router.push('/login'); return; }
        const data = snap.data();
        if (!data.companyId) { router.push('/'); return; }
        setUserInfo({
          uid: user.uid,
          name: data.name || '',
          email: user.email || '',
          companyId: data.companyId,
          role: data.role || 'member',
          superAdmin: data.superAdmin || false,
        });
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    });
    return () => unsub();
  }, [router]);

  // ─── 직원 목록 구독 ───
  useEffect(() => {
    if (!userInfo?.companyId) return;
    const q = query(collection(db, 'users'));
    getDocs(q).then(snap => {
      const list: Member[] = snap.docs
        .filter(d => d.data().companyId === userInfo.companyId)
        .map(d => ({
          id: d.id,
          name: d.data().name || '',
          email: d.data().email || '',
          role: d.data().role || 'member',
          team: d.data().team || '',
          phone: d.data().phone || '',
          annualLeave: d.data().annualLeave ?? 15,
        }));
      setMembers(list);
      const teamSet = new Set(list.map(m => m.team).filter(Boolean));
      setTeams(Array.from(teamSet));
    }).catch(console.error);
  }, [userInfo?.companyId]);

  // ─── 휴가 신청 목록 구독 ───
  useEffect(() => {
    if (!userInfo?.companyId) return;
    const q = query(
      collection(db, 'companies', userInfo.companyId, 'leaveRequests'),
      orderBy('createdAt', 'desc')
    );
    getDocs(q).then(snap => {
      const list: LeaveRequest[] = snap.docs.map(d => ({
        id: d.id,
        ...d.data(),
      } as LeaveRequest));
      setLeaveRequests(list);
    }).catch(console.error);
  }, [userInfo?.companyId]);

  // ─── 직원 수정 ───
  async function handleSaveMember() {
    if (!selectedMember || !userInfo?.companyId) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, 'users', selectedMember.id), {
        role: editRole,
        team: editTeam,
        annualLeave: editAnnualLeave,
      });
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
      await deleteDoc(doc(db, 'users', memberId));
      setShowMemberModal(false);
    } catch (e) {
      console.error(e);
    }
  }

  // ─── 휴가 승인/거절 ───
  async function handleLeaveStatus(leaveId: string, status: 'approved' | 'rejected') {
    if (!userInfo?.companyId) return;
    try {
      await updateDoc(
        doc(db, 'companies', userInfo.companyId, 'leaveRequests', leaveId),
        { status }
      );
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
      {/* 헤더 */}
      <header className="bg-white border-b px-4 py-3 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-2">
          <button onClick={() => router.push('/')} className="text-gray-500 hover:text-gray-700 text-lg">←</button>
          <h1 className="font-bold text-lg">👥 직원 관리</h1>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 py-4">

        {/* 탭 */}
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setActiveTab('members')}
            className={`px-4 py-1.5 rounded-xl text-sm font-medium transition-colors ${activeTab === 'members' ? 'bg-blue-500 text-white' : 'bg-white text-gray-600 border'}`}
          >
            👥 직원 목록 ({members.length})
          </button>
          <button
            onClick={() => setActiveTab('leave')}
            className={`px-4 py-1.5 rounded-xl text-sm font-medium transition-colors relative ${activeTab === 'leave' ? 'bg-blue-500 text-white' : 'bg-white text-gray-600 border'}`}
          >
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
                      <p className="text-3xl mb-2">👥</p>
                      <p>직원이 없어요</p>
                    </td>
                  </tr>
                ) : (
                  members.map((member, idx) => (
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
                        {member.team ? (
                          <span className="text-xs bg-green-100 text-green-600 px-2 py-0.5 rounded-full">
                            {member.team}
                          </span>
                        ) : '-'}
                      </td>
                      <td className="px-4 py-3 text-center text-gray-600">
                        {member.annualLeave ?? 15}일
                      </td>
                      {canEdit && (
                        <td className="px-4 py-3 text-center">
                          <button
                            onClick={() => {
                              setSelectedMember(member);
                              setEditRole(member.role);
                              setEditTeam(member.team);
                              setEditAnnualLeave(member.annualLeave ?? 15);
                              setShowMemberModal(true);
                            }}
                            className="text-xs bg-blue-50 text-blue-600 px-3 py-1 rounded-lg hover:bg-blue-100"
                          >
                            수정
                          </button>
                        </td>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* ─── 연차/휴가 탭 ─── */}
        {activeTab === 'leave' && (
          <div className="space-y-3">
            {leaveRequests.length === 0 ? (
              <div className="bg-white rounded-xl border p-16 text-center text-gray-400">
                <p className="text-3xl mb-2">📅</p>
                <p>휴가 신청이 없어요</p>
              </div>
            ) : (
              leaveRequests.map(leave => (
                <div key={leave.id} className="bg-white rounded-xl border p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-semibold text-gray-800">{leave.userName}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          leave.type === '연차' ? 'bg-blue-100 text-blue-600' :
                          leave.type === '반차' ? 'bg-purple-100 text-purple-600' :
                          'bg-orange-100 text-orange-600'
                        }`}>
                          {leave.type}
                        </span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          leave.status === 'pending' ? 'bg-yellow-100 text-yellow-600' :
                          leave.status === 'approved' ? 'bg-green-100 text-green-600' :
                          'bg-red-100 text-red-600'
                        }`}>
                          {leave.status === 'pending' ? '대기' :
                           leave.status === 'approved' ? '승인' : '거절'}
                        </span>
                      </div>
                      <p className="text-sm text-gray-500">
                        📅 {leave.startDate} ~ {leave.endDate}
                      </p>
                      {leave.reason && (
                        <p className="text-sm text-gray-600 mt-1">💬 {leave.reason}</p>
                      )}
                    </div>
                    {canEdit && leave.status === 'pending' && (
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleLeaveStatus(leave.id, 'approved')}
                          className="text-xs bg-green-500 text-white px-3 py-1.5 rounded-lg hover:bg-green-600"
                        >
                          승인
                        </button>
                        <button
                          onClick={() => handleLeaveStatus(leave.id, 'rejected')}
                          className="text-xs bg-red-500 text-white px-3 py-1.5 rounded-lg hover:bg-red-600"
                        >
                          거절
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
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
                <select
                  value={editRole}
                  onChange={e => setEditRole(e.target.value)}
                  className="w-full border rounded-xl px-3 py-2 text-sm"
                >
                  <option value="member">팀원</option>
                  <option value="admin">관리자</option>
                </select>
              </div>
              <div>
                <label className="text-sm text-gray-600 mb-1 block">팀 배정</label>
                <select
                  value={editTeam}
                  onChange={e => setEditTeam(e.target.value)}
                  className="w-full border rounded-xl px-3 py-2 text-sm"
                >
                  <option value="">팀 미배정</option>
                  {teams.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="text-sm text-gray-600 mb-1 block">연차 일수</label>
                <input
                  type="number"
                  value={editAnnualLeave}
                  onChange={e => setEditAnnualLeave(Number(e.target.value))}
                  className="w-full border rounded-xl px-3 py-2 text-sm"
                />
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => handleDeleteMember(selectedMember.id)}
                className="flex-1 py-2 border border-red-300 text-red-500 rounded-xl text-sm"
              >
                삭제
              </button>
              <button
                onClick={handleSaveMember}
                disabled={saving}
                className="flex-1 py-2 bg-blue-500 text-white rounded-xl text-sm font-medium disabled:opacity-50"
              >
                {saving ? '저장 중...' : '저장'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
