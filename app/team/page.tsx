'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import {
  collection, query, where, onSnapshot,
  addDoc, updateDoc, doc, serverTimestamp,
  getDocs, getDoc,
} from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';

interface UserInfo {
  uid: string;
  name: string;
  email: string;
  role: string;
  team: string;
  companyId: string;
  companyDisplayName: string;
  superAdmin: boolean;
  maxMembers?: number;
  subscription?: { plan: string; status: string; endDate?: Date };
}

interface TeamMember {
  uid: string;
  name: string;
  email: string;
  phone?: string;
  role: string;
  team: string;
  createdAt?: Date;
}

interface TeamItem {
  id: string;
  name: string;
  companyId: string;
  createdAt?: Date;
}

interface InviteInfo {
  docId: string;
  code: string;
  status: string;
  expireAt?: Date;
  usedCount: number;
  maxMembers: number;
}

function toDate(v: unknown): Date | undefined {
  if (!v) return undefined;
  if (v instanceof Date) return v;
  if (typeof v === 'object' && 'toDate' in (v as object))
    return (v as { toDate: () => Date }).toDate();
  return undefined;
}

function formatDate(d?: Date) {
  if (!d) return '-';
  return d.toLocaleDateString('ko-KR', {
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
}

function generateCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

export default function TeamPage() {
  const router = useRouter();
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(true);

  const [teams, setTeams] = useState<TeamItem[]>([]);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [invitations, setInvitations] = useState<Record<string, InviteInfo>>({});

  const [selectedTeam, setSelectedTeam] = useState<TeamItem | null>(null);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newTeamName, setNewTeamName] = useState('');
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState('');

  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteTeam, setInviteTeam] = useState<TeamItem | null>(null);
  const [inviteMaxMembers, setInviteMaxMembers] = useState(5);
  const [inviteLoading, setInviteLoading] = useState(false);

  const [selectedMember, setSelectedMember] = useState<TeamMember | null>(null);

  // ── 인증 ──
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) { router.push('/login'); return; }
      const snap = await getDoc(doc(db, 'users', user.uid));
      if (!snap.exists()) { router.push('/login'); return; }

      const data = snap.data();
      const sub = data.subscription || {};
      const endDate = toDate(sub.endDate);
      const now = new Date();
      const isSuperAdmin = data.superAdmin === true;
      // 변경 후 - admin 역할이면 플랜 상관없이 접근 가능
const isAdmin = data.role === 'admin';

if (!isSuperAdmin && !isAdmin) {
  router.push('/');
  return;
}


      setUserInfo({
        uid: user.uid,
        name: data.name || '',
        email: data.email || '',
        role: data.role || 'user',
        team: data.team || '',
        companyId: data.companyId || '',
        companyDisplayName: data.companyDisplayName || '',
        superAdmin: isSuperAdmin,
        maxMembers: data.maxMembers || 1,
        subscription: { plan: sub.plan, status: sub.status, endDate },
      });
      setLoading(false);
    });
    return () => unsub();
  }, [router]);

  // ── 팀 목록 실시간 구독 ──
  useEffect(() => {
    if (!userInfo) return;
    const q = query(collection(db, 'companies', userInfo.companyId, 'teams'));
    getDocs(q).then(snap => {
      const list: TeamItem[] = snap.docs.map((d) => ({
        id: d.id,
        name: d.data().name || '',
        companyId: d.data().companyId || '',
        createdAt: toDate(d.data().createdAt),
      }));
      list.sort((a, b) => (a.createdAt?.getTime() || 0) - (b.createdAt?.getTime() || 0));
      setTeams(list);
    }).catch(console.error);
  }, [userInfo]);

  // ── 초대코드 실시간 구독 ──
  useEffect(() => {
    if (!userInfo) return;
    const q = query(
      collection(db, 'invitations'),
      where('companyId', '==', userInfo.companyId)
    );
    getDocs(q).then(snap => {
      const map: Record<string, InviteInfo> = {};
      snap.docs.forEach((d) => {
        const data = d.data();
        const expireAt = toDate(data.expireAt);
        const isExpired =
          data.status !== 'active' || (expireAt && expireAt < new Date());
        if (!isExpired) {
          map[data.teamName] = {
            docId: d.id,
            code: data.code,
            status: data.status,
            expireAt,
            usedCount: data.usedCount || 0,
            maxMembers: data.maxMembers || 0,
          };
        }
      });
      setInvitations(map);
    }).catch(console.error);
  }, [userInfo]);

  // ── 멤버 실시간 구독 ──
  useEffect(() => {
    if (!userInfo) return;
    const q = query(
  collection(db, 'users'),
  where('companyId', '==', userInfo.companyId)
);
    getDocs(q).then(snap => {
      const list: TeamMember[] = snap.docs.map((d) => ({
        uid: d.id,
        name: d.data().name || '',
        email: d.data().email || '',
        phone: d.data().phone || '',
        role: d.data().role || 'member',
        team: d.data().team || '',
        createdAt: toDate(d.data().createdAt),
      }));
      setMembers(list);
    }).catch(console.error);
  }, [userInfo]);

  // ── 팀 생성 ──
  const handleCreateTeam = async () => {
    if (!newTeamName.trim()) { setCreateError('팀 이름을 입력해주세요.'); return; }
    if (!userInfo) return;
    if (teams.find((t) => t.name === newTeamName.trim())) {
      setCreateError('이미 존재하는 팀 이름이에요.');
      return;
    }
    setCreateLoading(true);
    setCreateError('');
    try {
      await addDoc(collection(db, 'companies', userInfo.companyId, 'teams'), {
        name: newTeamName.trim(),
        companyId: userInfo.companyId,
        createdBy: userInfo.uid,
        createdAt: serverTimestamp(),
      });
      setShowCreateModal(false);
      setNewTeamName('');
    } catch {
      setCreateError('팀 생성 중 오류가 발생했어요.');
    } finally {
      setCreateLoading(false);
    }
  };

  // ── 초대코드 발급 ──
  const handleIssueInvite = async () => {
    if (!inviteTeam || !userInfo) return;
    setInviteLoading(true);
    try {
      const expireAt = new Date();
      expireAt.setDate(expireAt.getDate() + 7);

      const q = query(
        collection(db, 'invitations'),
        where('companyId', '==', userInfo.companyId),
        where('teamName', '==', inviteTeam.name),
        where('status', '==', 'active')
      );
      const snap = await getDocs(q);

      if (!snap.empty) {
  await updateDoc(doc(db, 'invitations', snap.docs[0].id), {
    expireAt,
    maxMembers: inviteMaxMembers,
    code: generateCode(), // ✅ 코드도 새로 발급
  });
      } else {
        await addDoc(collection(db, 'invitations'), {
          code: generateCode(),
          companyId: userInfo.companyId,
          companyDisplayName: userInfo.companyDisplayName,
          teamName: inviteTeam.name,
          ownerName: userInfo.name,
          status: 'active',
          maxMembers: inviteMaxMembers,
          usedCount: 0,
          createdAt: serverTimestamp(),
          expireAt,
        });
      }
      setShowInviteModal(false);
      setInviteTeam(null);
    } catch (e) {
      alert('초대코드 발급 중 오류: ' + e);
    } finally {
      setInviteLoading(false);
    }
  };

  // ── 초대코드 만료 ──
  const handleExpireInvite = async (inviteDocId: string) => {
    if (!confirm('이 초대코드를 만료시킬까요?')) return;
    await updateDoc(doc(db, 'invitations', inviteDocId), { status: 'expired' });
  };

  // ── 코드만 복사 ──
  const copyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      alert('코드가 복사됐어요! 📋');
    } catch {
      alert(`초대코드: ${code}`);
    }
  };

  // ── 링크 복사 ──
  const copyInviteLink = async (code: string) => {
    const link = `${window.location.origin}/join?code=${code}`;
    try {
      await navigator.clipboard.writeText(link);
      alert('초대 링크가 복사됐어요! 🔗\n카카오톡, 문자 등에 붙여넣기 하세요.');
    } catch {
      prompt('아래 링크를 복사하세요:', link);
    }
  };

  // ── 문자 공유 ──
  const shareViaSms = (code: string, teamName: string) => {
    const link = `${window.location.origin}/join?code=${code}`;
    const text = `[LiftField] ${userInfo?.companyDisplayName || '회사'} · ${teamName} 팀 초대\n\n아래 링크로 접속해 팀에 합류하세요!\n${link}`;
    window.open(`sms:?body=${encodeURIComponent(text)}`);
  };

  // ── 공유 API (카카오톡 포함) ──
  const shareLink = async (code: string) => {
    const link = `${window.location.origin}/join?code=${code}`;
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'LiftField 팀 초대',
          url: link,
        });
        return;
      } catch {
        return;
      }
    }
    try {
      await navigator.clipboard.writeText(link);
      alert('링크 복사 완료!\n카카오톡에 붙여넣기 하세요.');
    } catch {
      prompt('아래 링크를 복사하세요:', link);
    }
  };

  // ── 멤버 팀 변경 ──
  const handleChangeTeam = async (uid: string, newTeam: string) => {
    await updateDoc(doc(db, 'users', uid), { team: newTeam });
    setSelectedMember((prev) => prev ? { ...prev, team: newTeam } : null);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const teamMembers = selectedTeam
    ? members.filter((m) => m.team === selectedTeam.name)
    : [];

  const unassignedMembers = members.filter((m) => !m.team);

  return (
    <div className="min-h-screen bg-gray-50">

      {/* 헤더 */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => router.push('/')} className="text-gray-400 hover:text-gray-600 text-sm">
              ← 홈
            </button>
            <span className="text-gray-300">|</span>
            <h1 className="text-lg font-bold text-gray-800">👥 팀 관리</h1>
            {userInfo?.companyDisplayName && (
              <span className="bg-purple-100 text-purple-700 text-xs px-2 py-1 rounded-full font-semibold">
                🏢 {userInfo.companyDisplayName}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <div className="flex flex-col items-end">
              <span className="text-sm font-medium text-gray-700">{userInfo?.name} 님</span>
              <span className="text-xs text-purple-500 font-semibold">🏢 Company</span>
            </div>
            <button
              onClick={() => signOut(auth).then(() => router.push('/login'))}
              className="text-xs text-gray-400 hover:text-gray-600"
            >
              로그아웃
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6">

        {/* 요약 카드 */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
          {[
            { label: '전체 멤버', value: `${members.length}명`, sub: `최대 ${userInfo?.maxMembers || 0}명`, color: 'blue' },
            { label: '팀 수', value: `${teams.length}개`, sub: '등록된 팀', color: 'green' },
            { label: '활성 초대코드', value: `${Object.keys(invitations).length}개`, sub: '7일 유효', color: 'yellow' },
            { label: '잔여 인원', value: `${(userInfo?.maxMembers || 0) - members.length}명`, sub: '초대 가능', color: 'purple' },
          ].map((card) => (
            <div key={card.label} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
              <p className="text-xs text-gray-500 mb-1">{card.label}</p>
              <p className={`text-2xl font-bold ${
                card.color === 'blue' ? 'text-blue-600' :
                card.color === 'green' ? 'text-green-600' :
                card.color === 'yellow' ? 'text-yellow-600' : 'text-purple-600'
              }`}>{card.value}</p>
              <p className="text-xs text-gray-400 mt-1">{card.sub}</p>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

          {/* 왼쪽: 팀 목록 */}
          <div className="md:col-span-1">
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="p-4 border-b border-gray-100 flex items-center justify-between">
                <h2 className="font-bold text-gray-800">팀 목록</h2>
                <button
                  onClick={() => { setShowCreateModal(true); setCreateError(''); setNewTeamName(''); }}
                  className="bg-blue-600 text-white text-xs px-3 py-1.5 rounded-xl font-semibold hover:bg-blue-700 transition"
                >
                  + 새 팀
                </button>
              </div>

              {teams.length === 0 ? (
                <div className="p-8 text-center text-gray-400">
                  <p className="text-3xl mb-2">👥</p>
                  <p className="text-sm mb-3">아직 팀이 없어요.</p>
                  <button
                    onClick={() => setShowCreateModal(true)}
                    className="text-blue-500 text-sm hover:underline"
                  >
                    첫 번째 팀 만들기 →
                  </button>
                </div>
              ) : (
                <div className="divide-y divide-gray-50">
                  {teams.map((team) => {
                    const count = members.filter((m) => m.team === team.name).length;
                    const isSelected = selectedTeam?.id === team.id;
                    const inv = invitations[team.name];
                    return (
                      <button
                        key={team.id}
                        onClick={() => setSelectedTeam(isSelected ? null : team)}
                        className={`w-full text-left p-4 transition-all ${isSelected ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="font-semibold text-gray-800 text-sm">{team.name}</p>
                            <p className="text-xs text-gray-400 mt-0.5">👤 {count}명</p>
                          </div>
                          <div className="flex flex-col items-end gap-1">
                            {inv ? (
                              <span className="bg-green-100 text-green-700 text-xs px-2 py-0.5 rounded-full font-semibold">
                                코드 활성
                              </span>
                            ) : (
                              <span className="bg-gray-100 text-gray-400 text-xs px-2 py-0.5 rounded-full">
                                코드 없음
                              </span>
                            )}
                            <span className={`text-xs ${isSelected ? 'text-blue-500' : 'text-gray-300'}`}>
                              {isSelected ? '▼' : '›'}
                            </span>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* 오른쪽: 팀 상세 */}
          <div className="md:col-span-2">
            {!selectedTeam ? (
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-12 text-center text-gray-400">
                <p className="text-4xl mb-3">👈</p>
                <p className="text-sm">왼쪽에서 팀을 선택하면<br />상세 정보를 볼 수 있어요.</p>
              </div>
            ) : (
              <div className="space-y-4">

                {/* 팀 헤더 + 초대코드 */}
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h2 className="text-xl font-black text-gray-800">{selectedTeam.name}</h2>
                      <p className="text-xs text-gray-400 mt-0.5">생성일: {formatDate(selectedTeam.createdAt)}</p>
                    </div>
                    <button
                      onClick={() => {
  const currentMax = invitations[selectedTeam.name]?.maxMembers || 5;
  setInviteMaxMembers(currentMax);
  setInviteTeam(selectedTeam);
  setShowInviteModal(true);
}}
                      className="bg-blue-600 text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-blue-700 transition"
                    >
                      🔗 초대코드 {invitations[selectedTeam.name] ? '갱신' : '발급'}
                    </button>
                  </div>

                  {/* 초대코드 현황 */}
                  {(() => {
                    const inv = invitations[selectedTeam.name];
                    if (inv) {
                      return (
                        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                          <div className="flex items-start justify-between">
                            <div>
                              <p className="text-xs text-blue-500 font-semibold mb-1">활성 초대코드</p>
                              <p className="text-2xl font-mono font-black text-blue-700 tracking-widest">
                                {inv.code}
                              </p>
                              <p className="text-xs text-blue-400 mt-1">
                                👥 {inv.usedCount}/{inv.maxMembers}명 · 만료: {formatDate(inv.expireAt)}
                              </p>
                            </div>
                            <div className="flex flex-col gap-2">
                              <button
                                onClick={() => copyCode(inv.code)}
                                className="bg-blue-600 text-white text-xs px-3 py-1.5 rounded-lg hover:bg-blue-700 transition"
                              >
                                📋 코드 복사
                              </button>
                              <button
                                onClick={() => handleExpireInvite(inv.docId)}
                                className="text-xs text-red-400 hover:text-red-600 transition text-center"
                              >
                                만료시키기
                              </button>
                            </div>
                          </div>

                          {/* 공유 버튼 그룹 */}
                          <div className="mt-3 pt-3 border-t border-blue-200">
                            <p className="text-xs text-blue-400 mb-2">📤 초대링크 공유하기</p>
                            <div className="flex gap-2">

                              {/* 🔗 링크 복사 */}
                              <button
                                onClick={() => copyInviteLink(inv.code)}
                                className="flex-1 flex items-center justify-center gap-1 px-3 py-2 bg-white hover:bg-blue-100 border border-blue-200 text-blue-700 text-xs font-semibold rounded-xl transition-colors"
                              >
                                🔗 링크 복사
                              </button>

                              {/* 💬 문자 */}
                              <button
                                onClick={() => shareViaSms(inv.code, selectedTeam.name)}
                                className="flex-1 flex items-center justify-center gap-1 px-3 py-2 bg-green-50 hover:bg-green-100 border border-green-200 text-green-700 text-xs font-semibold rounded-xl transition-colors"
                              >
                                💬 문자
                              </button>

                              {/* 📤 공유 (카카오톡 포함) */}
                              <button
                                onClick={() => shareLink(inv.code)}
                                className="flex-1 flex items-center justify-center gap-1 px-3 py-2 bg-yellow-50 hover:bg-yellow-100 border border-yellow-200 text-yellow-700 text-xs font-semibold rounded-xl transition-colors"
                              >
                                📤 공유
                              </button>

                            </div>

                            {/* 링크 미리보기 — 직접 복사용 */}
                            <div className="mt-2 bg-white border border-blue-100 rounded-xl px-3 py-2 flex items-center gap-2">
                              <p className="text-xs text-gray-400 flex-1 truncate">
                                {typeof window !== 'undefined'
                                  ? `${window.location.origin}/join?code=${inv.code}`
                                  : `/join?code=${inv.code}`}
                              </p>
                              <button
                                onClick={() => copyInviteLink(inv.code)}
                                className="text-xs text-blue-500 hover:text-blue-700 font-semibold shrink-0"
                              >
                                복사
                              </button>
                            </div>

                          </div>
                        </div>
                      );
                    }
                    return (
                      <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-center">
                        <p className="text-sm text-gray-400 mb-2">발급된 초대코드가 없어요.</p>
                        <button
                          onClick={() => {
                            setInviteTeam(selectedTeam);
                            setShowInviteModal(true);
                          }}
                          className="text-blue-500 text-sm hover:underline"
                        >
                          초대코드 발급하기 →
                        </button>
                      </div>
                    );
                  })()}
                </div>

                {/* 멤버 목록 */}
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                  <div className="p-4 border-b border-gray-100">
                    <h3 className="font-bold text-gray-800">
                      팀원 <span className="text-blue-600">{teamMembers.length}</span>명
                    </h3>
                  </div>
                  {teamMembers.length === 0 ? (
                    <div className="p-8 text-center text-gray-400">
                      <p className="text-3xl mb-2">👤</p>
                      <p className="text-sm">아직 팀원이 없어요.<br />초대코드로 팀원을 초대하세요!</p>
                    </div>
                  ) : (
                    <div className="divide-y divide-gray-50">
                      {teamMembers.map((m) => (
                        <div
                          key={m.uid}
                          onClick={() => setSelectedMember(m)}
                          className="flex items-center justify-between p-4 hover:bg-gray-50 cursor-pointer transition"
                        >
                          <div className="flex items-center gap-3">
                            <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold ${
                              m.role === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'
                            }`}>
                              {m.name.charAt(0)}
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-semibold text-gray-800">{m.name}</span>
                                {m.role === 'admin' && (
                                  <span className="bg-purple-100 text-purple-600 text-xs px-1.5 py-0.5 rounded-full">관리자</span>
                                )}
                                {m.uid === userInfo?.uid && (
                                  <span className="bg-green-100 text-green-600 text-xs px-1.5 py-0.5 rounded-full">나</span>
                                )}
                              </div>
                              <p className="text-xs text-gray-400">{m.email}</p>
                            </div>
                          </div>
                          <span className="text-gray-300">›</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

              </div>
            )}
          </div>
        </div>

        {/* 팀 미배정 멤버 */}
        {unassignedMembers.length > 0 && (
          <div className="mt-6 bg-orange-50 border border-orange-200 rounded-2xl p-4">
            <p className="text-sm font-semibold text-orange-700 mb-2">
              ⚠️ 팀 미배정 멤버 {unassignedMembers.length}명
            </p>
            <div className="flex flex-wrap gap-2">
              {unassignedMembers.map((m) => (
                <button
                  key={m.uid}
                  onClick={() => setSelectedMember(m)}
                  className="bg-white border border-orange-200 text-orange-700 text-xs px-3 py-1 rounded-full hover:bg-orange-100 transition"
                >
                  {m.name}
                </button>
              ))}
            </div>
          </div>
        )}

      </main>

      {/* 팀 생성 모달 */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-gray-800">👥 새 팀 만들기</h3>
              <button onClick={() => setShowCreateModal(false)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">팀 이름 *</label>
              <input
                type="text"
                value={newTeamName}
                onChange={(e) => setNewTeamName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreateTeam()}
                placeholder="예: 서울팀, 경기팀, 1팀"
                className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                autoFocus
              />
              {createError && <p className="text-red-500 text-xs mt-1">{createError}</p>}
            </div>
            <p className="text-xs text-gray-400">팀 생성 후 초대코드를 발급해서 팀원을 초대할 수 있어요.</p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowCreateModal(false)}
                className="flex-1 border border-gray-300 text-gray-600 py-3 rounded-xl font-semibold hover:bg-gray-50 transition"
              >
                취소
              </button>
              <button
                onClick={handleCreateTeam}
                disabled={createLoading}
                className="flex-1 bg-blue-600 text-white py-3 rounded-xl font-semibold hover:bg-blue-700 transition disabled:opacity-50"
              >
                {createLoading ? '생성 중...' : '팀 만들기'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 초대코드 발급 모달 */}
      {showInviteModal && inviteTeam && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-gray-800">🔗 초대코드 발급</h3>
              <button onClick={() => setShowInviteModal(false)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>
            <div className="bg-blue-50 rounded-xl p-3 text-sm font-semibold text-blue-700">
              📌 {inviteTeam.name}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">초대할 인원</label>
              <div className="grid grid-cols-4 gap-2">
                {[3, 5, 10, 15, 20, 30, 50].map((n) => (
                  <button
                    key={n}
                    onClick={() => setInviteMaxMembers(n)}
                    className={`py-2 rounded-xl text-sm font-semibold border-2 transition-all ${
                      inviteMaxMembers === n
                        ? 'border-blue-500 bg-blue-600 text-white'
                        : 'border-gray-200 text-gray-600 hover:border-blue-300'
                    }`}
                  >
                    {n}명
                  </button>
                ))}
              </div>
            </div>
            <div className="bg-yellow-50 rounded-xl p-3 text-xs text-yellow-700">
              ⚠️ 초대코드는 <strong>7일간</strong> 유효해요. 기존 코드가 있으면 갱신돼요.
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setShowInviteModal(false)}
                className="flex-1 border border-gray-300 text-gray-600 py-3 rounded-xl font-semibold hover:bg-gray-50 transition"
              >
                취소
              </button>
              <button
                onClick={handleIssueInvite}
                disabled={inviteLoading}
                className="flex-1 bg-blue-600 text-white py-3 rounded-xl font-semibold hover:bg-blue-700 transition disabled:opacity-50"
              >
                {inviteLoading ? '발급 중...' : '발급하기'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 멤버 상세 모달 */}
      {selectedMember && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-gray-800">👤 멤버 정보</h3>
              <button onClick={() => setSelectedMember(null)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>
            <div className="flex items-center gap-4">
              <div className={`w-14 h-14 rounded-full flex items-center justify-center text-xl font-bold ${
                selectedMember.role === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'
              }`}>
                {selectedMember.name.charAt(0)}
              </div>
              <div>
                <p className="font-bold text-gray-800 text-lg">{selectedMember.name}</p>
                <p className="text-sm text-gray-500">{selectedMember.email}</p>
              </div>
            </div>
            <div className="space-y-2 text-sm">
              {[
                { label: '휴대폰', value: selectedMember.phone || '-' },
                { label: '가입일', value: formatDate(selectedMember.createdAt) },
                { label: '현재 팀', value: selectedMember.team || '미배정' },
              ].map((item) => (
                <div key={item.label} className="flex justify-between py-2 border-b border-gray-100">
                  <span className="text-gray-500">{item.label}</span>
                  <span className="font-medium text-gray-800">{item.value}</span>
                </div>
              ))}
            </div>
            {selectedMember.uid !== userInfo?.uid && teams.length > 0 && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">팀 변경</label>
                <div className="flex gap-2 flex-wrap">
                  {teams.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => handleChangeTeam(selectedMember.uid, t.name)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-semibold border-2 transition-all ${
                        selectedMember.team === t.name
                          ? 'border-blue-500 bg-blue-600 text-white'
                          : 'border-gray-200 text-gray-600 hover:border-blue-300'
                      }`}
                    >
                      {t.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <button
              onClick={() => setSelectedMember(null)}
              className="w-full bg-gray-100 text-gray-700 py-2.5 rounded-xl font-semibold hover:bg-gray-200 transition"
            >
              닫기
            </button>
          </div>
        </div>
      )}

    </div>
  );
}
