'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';

export default function HomePage() {
  const router = useRouter();
  const [userInfo, setUserInfo] = useState<any>(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
  const unsub = onAuthStateChanged(auth, async (user) => {
    if (user) {
      const snap = await getDoc(doc(db, 'users', user.uid));
      if (snap.exists()) {
        const data = snap.data();
        setUserInfo(data);

        // ✅ pro/company인데 companyId 없으면 setup으로
        const subPlan = data.subscription?.plan || 'trial';
        const hasCompany = data.companyId && data.companyId.trim() !== '';
        if (!hasCompany && (subPlan === 'pro' || subPlan === 'company')) {
          router.push('/setup');
          return;
        }
      }
    }
    setAuthLoading(false);
  });
  return () => unsub();
}, []);


  const isPro = userInfo?.subscription?.plan === 'pro';
  const isCompany = userInfo?.subscription?.plan === 'company';
  const isSuperAdmin = userInfo?.superAdmin === true;
  const isAdmin = userInfo?.role === 'admin';
  const canQna = isPro || isCompany || isSuperAdmin;

  const handleLogout = async () => {
    await signOut(auth);
    setUserInfo(null);
  };

  const features = [
    { icon: '🔧', title: '고장신고', desc: '현장에서 바로 접수하고 담당자에게 즉시 알림' },
    { icon: '📋', title: '점검관리', desc: '정기 점검 일정 등록 및 완료 여부 실시간 확인' },
    { icon: '🏢', title: '현장관리', desc: '여러 현장과 호기를 한눈에 모니터링' },
    { icon: '👥', title: '팀원관리', desc: '역할별 권한 부여로 효율적인 협업' },
    { icon: '💬', title: '채팅', desc: '현장 담당자와 실시간 소통 및 현황 공유' },
    { icon: '📄', title: '검사서류 출력', desc: '정기·자체검사 서류 자동 생성 및 PDF 출력' },
    { icon: '📊', title: '통계', desc: '고장 발생 및 처리 현황을 통계로 확인' },
    { icon: '🗺️', title: '길찾기', desc: '카카오맵 연동으로 현장 빠르게 이동' },
  ];

  const guideQna = [
    { q: '앱은 어떻게 설치하나요?', a: 'App Store 또는 Google Play에서 "LiftField"를 검색하여 설치하세요.' },
    { q: '현장은 어떻게 추가하나요?', a: '앱 또는 웹 운영 페이지의 현장관리 메뉴에서 + 버튼을 눌러 현장을 등록할 수 있습니다.' },
    { q: '고장신고는 어떻게 하나요?', a: '앱 하단 고장신고 탭에서 현장과 호기를 선택한 후 내용을 입력하고 접수하세요.' },
    { q: '팀원은 어떻게 초대하나요?', a: 'Company 플랜 관리자는 웹 운영 페이지 팀 관리 메뉴에서 팀별 초대코드를 발급할 수 있습니다.' },
    { q: '점검 일정은 어떻게 등록하나요?', a: '점검관리 메뉴에서 날짜와 현장을 선택한 후 일정을 등록하면 됩니다.' },
    { q: '웹 운영 페이지는 어떻게 사용하나요?', a: 'Company 구독 이상에서 liftfield.co.kr 로그인 후 이용 가능합니다.' },
  ];

  return (
    <div className="min-h-screen bg-white text-gray-900">

      {/* ───── 헤더 ───── */}
      <header className="sticky top-0 z-50 bg-white/90 backdrop-blur border-b border-gray-100">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">

          {/* 로고 */}
          <button
            onClick={() => router.push('/')}
            className="text-xl font-black text-blue-600 tracking-tight flex items-center gap-2"
          >
            🛗 LiftField
          </button>

          {/* 중앙 네비 */}
          <nav className="hidden md:flex items-center gap-8 text-sm font-medium text-gray-600">
            <a href="#features" className="hover:text-blue-600 transition-colors">기능</a>
            <a href="#pricing" className="hover:text-blue-600 transition-colors">요금제</a>
            <a href="#guide" className="hover:text-blue-600 transition-colors">사용 가이드</a>
          </nav>

          {/* 우측 유저 영역 */}
          <div className="flex items-center gap-2">
            {!authLoading && userInfo ? (
              <>
                {/* 유저 이름 + 플랜 뱃지 */}
                <div className="flex flex-col items-end leading-tight mr-1">
                  <span className="text-sm font-semibold text-gray-800">{userInfo.name} 님</span>
                  <span className="text-xs font-bold text-blue-500">
  {isSuperAdmin ? '👑 SuperAdmin' 
    : isCompany && userInfo?.companyDisplayName 
      ? `🏢 ${userInfo.companyDisplayName}${userInfo.team ? ` · ${userInfo.team}` : ''}` 
      : isPro ? '⭐ Pro' 
      : '체험판'}
</span>
                </div>

                {/* 기술 Q&A */}
                {canQna && (
                  <button
                    onClick={() => router.push('/qna')}
                    className="text-sm font-bold bg-emerald-500 hover:bg-emerald-600 text-white px-3 py-2 rounded-xl transition-colors"
                  >
                    💬 기술 Q&A
                  </button>
                )}



                {/* 팀 관리 — Company 관리자 또는 SuperAdmin만 표시 */}
                {(isCompany && isAdmin || isSuperAdmin) && (
                  <button
                    onClick={() => router.push('/team')}
                    className="text-sm font-bold bg-purple-500 hover:bg-purple-600 text-white px-3 py-2 rounded-xl transition-colors"
                  >
                    🔗 팀 초대하기
                  </button>
                )}

                {/* 👇 여기에 추가 ↓↓↓ */}
{(isPro || isCompany) && !userInfo?.companyId && (
  <button
    onClick={() => router.push('/join')}
    className="px-3 py-2 text-sm font-semibold bg-orange-100 hover:bg-orange-200 text-orange-700 rounded-xl transition-colors animate-pulse"
  >
    🏢 팀 합류하기
  </button>
)}

                {/* 대시보드 */}
{(isCompany && isAdmin || isSuperAdmin) && (
  <button
    onClick={() => router.push('/dashboard')}
    className="text-sm font-bold bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded-xl transition-colors"
  >
    🖥️ 운영 페이지
  </button>
)}

                {/* 슈퍼어드민 전용 */}
{isSuperAdmin && (
  <button
    onClick={() => router.push('/admin')}
    className="text-sm font-bold bg-yellow-400 hover:bg-yellow-500 text-yellow-900 px-3 py-2 rounded-xl transition-colors"
  >
    👑 관리자
  </button>
)}

{/* 로그아웃 */}
<button
  onClick={handleLogout}
  className="text-sm text-gray-400 hover:text-gray-700 transition-colors ml-1"
>
  로그아웃
</button>

              </>
            ) : (
              <>
                <button
                  onClick={() => router.push('/login')}
                  className="text-sm font-semibold text-gray-600 hover:text-blue-600 transition-colors"
                >
                  로그인
                </button>
                <button
                  onClick={() => router.push('/signup')}
                  className="text-sm font-bold bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-xl transition-colors shadow-sm"
                >
                  회원가입
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      {/* ───── 히어로 ───── */}
      <section className="relative overflow-hidden bg-gradient-to-br from-blue-50 via-white to-indigo-50 py-28 px-6 text-center">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-blue-100/60 via-transparent to-transparent pointer-events-none" />
        <div className="relative max-w-3xl mx-auto">
          <div className="inline-flex items-center gap-2 bg-blue-100 text-blue-700 text-sm font-semibold px-4 py-1.5 rounded-full mb-8">
            🚀 승강기 현장 관리 솔루션
          </div>
          <h1 className="text-5xl md:text-6xl font-black text-gray-900 mb-6 leading-tight">
            승강기 관리,<br />
            <span className="text-blue-600">더 스마트하게</span>
          </h1>
          <p className="text-xl text-gray-500 mb-10 leading-relaxed">
            고장신고부터 점검관리, 서류 출력까지<br />
            LiftField 하나로 모든 현장을 관리하세요
          </p>
          <div className="flex justify-center gap-4 flex-wrap">
            <button
              onClick={() => router.push('/signup')}
              className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-8 py-4 rounded-2xl transition-all shadow-lg hover:shadow-blue-200 hover:-translate-y-0.5 text-lg"
            >
              무료로 시작하기 →
            </button>
            <a
              href="#features"
              className="bg-white border border-gray-200 hover:border-blue-300 text-gray-700 font-bold px-8 py-4 rounded-2xl transition-all text-lg hover:-translate-y-0.5"
            >
              기능 살펴보기
            </a>
          </div>
        </div>
      </section>

      {/* ───── 주요 기능 ───── */}
      <section id="features" className="py-24 px-6 bg-white">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-black text-gray-900 mb-4">주요 기능</h2>
            <p className="text-gray-400 text-lg">현장 관리에 필요한 모든 것을 담았습니다</p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
            {features.map((f, i) => (
              <div
                key={i}
                className="group bg-gray-50 hover:bg-blue-50 border border-transparent hover:border-blue-200 rounded-2xl p-6 text-center transition-all hover:-translate-y-1 cursor-default"
              >
                <div className="text-4xl mb-4 group-hover:scale-110 transition-transform">{f.icon}</div>
                <h3 className="font-bold text-gray-900 mb-2 text-sm">{f.title}</h3>
                <p className="text-xs text-gray-500 leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ───── 요금제 ───── */}
      <section id="pricing" className="py-24 px-6 bg-gray-50">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-black text-gray-900 mb-4">요금제</h2>
            <p className="text-gray-400 text-lg">필요에 맞는 플랜을 선택하세요</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

            {/* Trial */}
            <div className="bg-white border border-gray-200 rounded-3xl p-8 flex flex-col">
              <div className="text-3xl mb-3">🆓</div>
              <h3 className="text-xl font-black text-gray-900 mb-1">Trial</h3>
              <p className="text-gray-400 text-sm mb-5">14일 무료 체험</p>
              <div className="text-3xl font-black text-gray-900 mb-6">₩0</div>
              <ul className="space-y-2.5 text-sm text-gray-600 flex-1">
                {['고장신고', '점검관리', '현장관리', '검사서류 출력'].map((t) => (
                  <li key={t} className="flex items-center gap-2">
                    <span className="text-green-500 font-bold">✓</span>{t}
                  </li>
                ))}
                {['채팅', '팀원 초대', '기술 Q&A', '웹 운영 페이지'].map((t) => (
                  <li key={t} className="flex items-center gap-2 text-gray-300">
                    <span className="font-bold">✗</span>
                    <span className="line-through">{t}</span>
                  </li>
                ))}
              </ul>
              <button
                onClick={() => router.push('/signup')}
                className="mt-6 w-full py-3 rounded-xl border border-gray-200 hover:border-blue-300 text-gray-700 font-bold text-sm transition-colors"
              >
                무료 시작
              </button>
            </div>

            {/* Pro */}
            <div className="bg-blue-600 border border-blue-600 rounded-3xl p-8 flex flex-col relative shadow-xl shadow-blue-100">
              <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-amber-400 text-amber-900 text-xs font-black px-4 py-1 rounded-full">
                인기
              </div>
              <div className="text-3xl mb-3">⭐</div>
              <h3 className="text-xl font-black text-white mb-1">Pro</h3>
              <p className="text-blue-200 text-sm mb-5">개인 / 소규모 팀</p>
              <div className="text-3xl font-black text-white mb-6">
                ₩9,900<span className="text-base font-normal text-blue-300">/월</span>
              </div>
              <ul className="space-y-2.5 text-sm text-blue-100 flex-1">
                {['Trial 모든 기능 포함', '채팅', '팀원 1명 추가', '기술 Q&A 참여'].map((t) => (
                  <li key={t} className="flex items-center gap-2">
                    <span className="text-blue-200 font-bold">✓</span>{t}
                  </li>
                ))}
                <li className="flex items-center gap-2 text-blue-300">
                  <span className="font-bold">✗</span>
                  <span className="line-through">웹 운영 페이지</span>
                  <span className="text-xs bg-blue-700 text-blue-200 px-2 py-0.5 rounded-full">
                    Company만
                  </span>
                </li>
              </ul>
              <button
                onClick={() => router.push('/signup')}
                className="mt-6 w-full py-3 rounded-xl bg-white hover:bg-blue-50 text-blue-700 font-black text-sm transition-colors"
              >
                Pro 시작하기
              </button>
            </div>

            {/* Company */}
            <div className="bg-white border border-purple-200 rounded-3xl p-8 flex flex-col">
              <div className="text-3xl mb-3">🏢</div>
              <h3 className="text-xl font-black text-gray-900 mb-1">Company</h3>
              <p className="text-gray-400 text-sm mb-5">회사 / 다수 현장 관리</p>
              <div className="mb-6">
                <div className="text-3xl font-black text-purple-600">
                  ₩60,000~<span className="text-base font-normal text-gray-400">/월</span>
                </div>
                <p className="text-xs text-gray-400 mt-1">인원수에 따라 가격 변동</p>
              </div>
              <ul className="space-y-2.5 text-sm text-gray-600 flex-1">
                {[
                  'Pro 모든 기능 포함',
                  '웹 운영 페이지',
                  '팀원 인원수 선택',
                  '팀별 초대코드 발급',
                  '전체 현장 통합 관리',
                  '점검 현황 모니터링',
                ].map((t) => (
                  <li key={t} className="flex items-center gap-2">
                    <span className="text-green-500 font-bold">✓</span>{t}
                  </li>
                ))}
              </ul>
              <button
                onClick={() => router.push('/signup')}
                className="mt-6 w-full py-3 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-black text-sm transition-colors"
              >
                Company 시작하기
              </button>
            </div>

          </div>
        </div>
      </section>

      {/* ───── 앱 다운로드 ───── */}
      <section className="py-24 px-6 bg-gray-900 text-white">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-4xl font-black mb-4">지금 바로 시작하세요</h2>
          <p className="text-gray-400 text-lg mb-12">
            App Store와 Google Play에서 LiftField를 무료로 다운로드하세요
          </p>
          <div className="flex justify-center gap-5 flex-wrap">

            {/* App Store */}
            <a
              href="https://apps.apple.com"
              target="_blank"
              rel="noreferrer"
              className="group flex items-center gap-4 bg-black hover:bg-gray-800 border border-gray-700 hover:border-gray-500 text-white px-8 py-5 rounded-2xl transition-all hover:-translate-y-1 hover:shadow-xl hover:shadow-black/30 w-56"
            >
              <div className="text-4xl leading-none">🍎</div>
              <div className="text-left">
                <div className="text-xs text-gray-400 font-medium">Download on the</div>
                <div className="text-xl font-black tracking-tight">App Store</div>
              </div>
            </a>

            {/* Google Play */}
            <a
              href="https://play.google.com"
              target="_blank"
              rel="noreferrer"
              className="group flex items-center gap-4 bg-white hover:bg-gray-50 border border-gray-200 hover:border-gray-300 text-gray-900 px-8 py-5 rounded-2xl transition-all hover:-translate-y-1 hover:shadow-xl hover:shadow-gray-200/60 w-56"
            >
              <div className="text-4xl leading-none">▶️</div>
              <div className="text-left">
                <div className="text-xs text-gray-400 font-medium">Get it on</div>
                <div className="text-xl font-black tracking-tight">Google Play</div>
              </div>
            </a>

          </div>
        </div>
      </section>

      {/* ───── 앱·웹 사용 Q&A ───── */}
      <section id="guide" className="py-24 px-6 bg-white">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-black text-gray-900 mb-4">📖 앱·웹 사용 Q&A</h2>
            <p className="text-gray-400 text-lg">LiftField 사용법에 대한 자주 묻는 질문을 확인하세요</p>
          </div>
          <div className="space-y-3">
            {guideQna.map((item, i) => (
              <details
                key={i}
                className="group bg-gray-50 hover:bg-blue-50 border border-gray-100 hover:border-blue-200 rounded-2xl px-6 py-4 transition-all cursor-pointer"
              >
                <summary className="flex items-center justify-between font-semibold text-gray-800 text-sm list-none">
                  <span className="flex items-center gap-2">
                    <span className="text-blue-500 font-black">Q.</span>{item.q}
                  </span>
                  <span className="text-gray-400 group-open:rotate-180 transition-transform text-xs ml-4 shrink-0">▼</span>
                </summary>
                <div className="mt-3 pt-3 border-t border-gray-100 flex items-start gap-2 text-sm text-gray-600">
                  <span className="text-green-500 font-black shrink-0">A.</span>
                  <p className="leading-relaxed">{item.a}</p>
                </div>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ───── 기술 Q&A 배너 ───── */}
      <section className="py-24 px-6 bg-gray-50">
        <div className="max-w-4xl mx-auto">
          <div className="relative overflow-hidden bg-gradient-to-br from-emerald-500 to-green-700 rounded-3xl p-12 text-white text-center">
            <div className="absolute top-0 right-0 text-[160px] opacity-10 leading-none pointer-events-none select-none">🔩</div>
            <div className="relative">
              <div className="text-5xl mb-5">🔩</div>
              <h2 className="text-4xl font-black mb-4">승강기 기술 Q&A</h2>
              <p className="text-green-100 text-lg mb-8 leading-relaxed">
                고장 대응, 부품 교체, 점검 노하우까지<br />
                Pro 이상 구독자들과 기술 정보를 공유하세요
              </p>
              {canQna ? (
                <button
                  onClick={() => router.push('/qna')}
                  className="bg-white text-emerald-700 font-black px-10 py-4 rounded-2xl hover:bg-emerald-50 transition-colors text-lg shadow-lg"
                >
                  💬 기술 Q&A 바로가기
                </button>
              ) : (
                <div className="space-y-3">
                  <p className="text-green-200 text-sm">Pro 이상 구독 시 이용 가능합니다</p>
                  <button
                    onClick={() => router.push('/signup')}
                    className="bg-white text-emerald-700 font-black px-10 py-4 rounded-2xl hover:bg-emerald-50 transition-colors text-lg shadow-lg"
                  >
                    회원가입 후 이용하기
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ───── 법적 고지 ───── */}
      <section className="py-16 px-6 bg-white border-t border-gray-100">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-10">
            <h2 className="text-2xl font-black text-gray-900 mb-2">법적 고지</h2>
            <p className="text-gray-400 text-sm">LiftField 서비스 이용에 관한 법적 정보입니다</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              { icon: '📜', title: '이용약관', desc: '서비스 이용에 관한 권리와 의무 사항을 확인하세요', path: '/terms' },
              { icon: '🔒', title: '개인정보처리방침', desc: '개인정보 수집·이용·보관에 관한 방침을 확인하세요', path: '/privacy' },
              { icon: '💳', title: '환불정책', desc: '구독 결제 및 환불에 관한 정책을 확인하세요', path: '/refund' },
            ].map((item) => (
              <button
                key={item.path}
                onClick={() => router.push(item.path)}
                className="group bg-gray-50 hover:bg-blue-50 border border-gray-100 hover:border-blue-200 rounded-2xl p-6 text-left transition-all"
              >
                <div className="text-2xl mb-3">{item.icon}</div>
                <h3 className="font-black text-gray-900 mb-1">{item.title}</h3>
                <p className="text-xs text-gray-400 leading-relaxed">{item.desc}</p>
                <div className="mt-3 text-blue-500 text-xs font-bold group-hover:underline">자세히 보기 →</div>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* ───── 푸터 ───── */}
      <footer className="bg-gray-950 text-gray-500 py-14 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-10">
            <div className="col-span-2 md:col-span-1">
              <div className="text-white font-black text-xl mb-3">🛗 LiftField</div>
              <p className="text-sm leading-relaxed">승강기 현장 관리 솔루션</p>
            </div>
            <div>
              <h4 className="text-white font-bold mb-4 text-sm">서비스</h4>
              <ul className="space-y-2 text-sm">
                <li><a href="#features" className="hover:text-white transition-colors">주요 기능</a></li>
                <li><a href="#pricing" className="hover:text-white transition-colors">요금제</a></li>
                <li>
                  <button onClick={() => router.push('/login')} className="hover:text-white transition-colors">
                    로그인
                  </button>
                </li>
                <li>
                  <button onClick={() => router.push('/signup')} className="hover:text-white transition-colors">
                    회원가입
                  </button>
                </li>
              </ul>
            </div>
            <div>
              <h4 className="text-white font-bold mb-4 text-sm">지원</h4>
              <ul className="space-y-2 text-sm">
                <li><a href="#guide" className="hover:text-white transition-colors">사용 가이드</a></li>
                {canQna && (
                  <li>
                    <button onClick={() => router.push('/qna')} className="hover:text-white transition-colors">
                      기술 Q&A
                    </button>
                  </li>
                )}
                {(isCompany && isAdmin || isSuperAdmin) && (
                  <li>
                    <button onClick={() => router.push('/team')} className="hover:text-white transition-colors">
                      팀 관리
                    </button>
                  </li>
                )}
                {(isCompany || isSuperAdmin) && (
                  <li>
                    <button onClick={() => router.push('/inspection')} className="hover:text-white transition-colors">
                      점검 현황
                    </button>
                  </li>
                )}
              </ul>
            </div>
            <div>
              <h4 className="text-white font-bold mb-4 text-sm">법적 고지</h4>
              <ul className="space-y-2 text-sm">
                <li>
                  <button onClick={() => router.push('/terms')} className="hover:text-white transition-colors">
                    이용약관
                  </button>
                </li>
                <li>
                  <button onClick={() => router.push('/privacy')} className="hover:text-white transition-colors">
                    개인정보처리방침
                  </button>
                </li>
                <li>
                  <button onClick={() => router.push('/refund')} className="hover:text-white transition-colors">
                    환불정책
                  </button>
                </li>
              </ul>
            </div>
          </div>

          {/* 사업자 정보 */}
          <div className="border-t border-gray-800 pt-8 space-y-1 text-xs text-gray-600 text-center">
            <p>상호명: (주)LiftField &nbsp;|&nbsp; 대표자: &nbsp;|&nbsp; 사업자등록번호: 000-00-00000</p>
            <p>주소: &nbsp;|&nbsp; 고객센터: &nbsp;|&nbsp; 이메일: support@liftfield.co.kr</p>
            <p className="mt-3 text-gray-700">© 2025 LiftField. All rights reserved.</p>
          </div>
        </div>
      </footer>

    </div>
  );
}
