'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';

/* ------------------------------------------------------------------
   LiftField Home v2 · Product-info landing
   - Preserves the original Supabase session flow from the legacy home.
   - Sections: Hero (with real dashboard screenshot, blurred) →
     Screens carousel → Manifesto → Modules → Personas → Pricing →
     Getting started → FAQ → CTA → Footer.
   ------------------------------------------------------------------ */

type UserInfo = {
  uid: string;
  name?: string;
  role?: string;
  company_id?: string | null;
  company_display_name?: string | null;
  team?: string | null;
  super_admin?: boolean;
  subscription?: { plan?: string } | null;
};

export default function HomePage() {
  const router = useRouter();
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  // ── auth (동일 로직 계승) ──
  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        const { data: userData } = await supabase
          .from('users')
          .select('name, role, company_id, company_display_name, team, super_admin, subscription')
          .eq('id', session.user.id)
          .single();

        if (userData) {
          setUserInfo({ ...(userData as UserInfo), uid: session.user.id });

          if (userData.company_id && userData.role !== 'admin' && !userData.super_admin) {
            router.push('/work');
            return;
          }
          const subPlan = userData.subscription?.plan || 'trial';
          const hasCompany = userData.company_id && String(userData.company_id).trim() !== '';
          if (!hasCompany && (subPlan === 'pro' || subPlan === 'company')) {
            router.push('/setup');
            return;
          }
        }
      }
      setAuthLoading(false);
    };
    init();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_OUT') {
        setUserInfo(null);
        setAuthLoading(false);
      }
      if (event === 'SIGNED_IN' && session) {
        const { data: userData } = await supabase
          .from('users')
          .select('name, role, company_id, company_display_name, team, super_admin, subscription')
          .eq('id', session.user.id)
          .single();

        if (userData) {
          setUserInfo({ ...(userData as UserInfo), uid: session.user.id });
          const subPlan = userData.subscription?.plan || 'trial';
          const hasCompany = userData.company_id && String(userData.company_id).trim() !== '';
          if (!hasCompany && (subPlan === 'pro' || subPlan === 'company')) {
            router.push('/setup');
          }
        }
        setAuthLoading(false);
      }
    });
    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hasCompany = !!(userInfo?.company_id && String(userInfo.company_id).trim() !== '');
  const isSuperAdmin = userInfo?.super_admin === true;
  const isAdmin = userInfo?.role === 'admin';

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setUserInfo(null);
  };

  // ── reveal on scroll (robust) ──
  useEffect(() => {
    const els = Array.from(document.querySelectorAll('.reveal, .reveal-r, .reveal-l, .reveal-scale, .stagger'));
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduced || typeof IntersectionObserver === 'undefined') {
      els.forEach((el) => el.classList.add('in'));
      return;
    }
    // 1) show anything already in the initial viewport
    els.forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.top < window.innerHeight && r.bottom > 0) el.classList.add('in');
    });
    // 2) observe rest
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add('in');
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0, rootMargin: '0px 0px 0px 0px' },
    );
    els.forEach((el) => { if (!el.classList.contains('in')) io.observe(el); });
    // 3) safety fallback
    const t = window.setTimeout(() => els.forEach((el) => el.classList.add('in')), 2000);
    return () => { io.disconnect(); clearTimeout(t); };
  }, []);

  // ── scrollspy for nav ──
  useEffect(() => {
    const ids = ['screens', 'why', 'manual', 'personas', 'pricing', 'start', 'faq'];
    const links = Array.from(document.querySelectorAll('header nav a'));
    const spy = new IntersectionObserver(
      (entries) => {
        entries.forEach((en) => {
          if (en.isIntersecting) {
            const id = en.target.id;
            links.forEach((a) => a.classList.toggle('active', a.getAttribute('href') === '#' + id));
          }
        });
      },
      { rootMargin: '-40% 0px -55% 0px' },
    );
    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (el) spy.observe(el);
    });
    return () => spy.disconnect();
  }, []);

  return (
    <div className="bg-white text-[color:var(--color-ink)]">
      {/* Google Fonts for serif accent */}
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link
        href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,500;0,700;1,500&display=swap"
        rel="stylesheet"
      />

      {/* ─────────── HEADER ─────────── */}
      <header className="sticky top-0 z-50 bg-white/85 backdrop-blur border-b border-[color:var(--color-line)]">
        <div className="max-w-6xl mx-auto px-5 sm:px-6 h-16 flex items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-2.5 shrink-0">
  <Image src="/icon-192.png" alt="LiftField 로고" width={32} height={32} className="rounded-lg" />
  <span className="font-black tracking-tightest text-lg">LiftField</span>
</Link>


          <nav className="hidden md:flex items-center gap-7 text-[13.5px] font-medium text-[color:var(--color-ink-soft)]">
            <a href="#screens" className="navlink hover:text-[color:var(--color-brand)]">화면 미리보기</a>
            <a href="#why" className="navlink hover:text-[color:var(--color-brand)]">만든 이유</a>
            <a href="#manual" className="navlink hover:text-[color:var(--color-brand)]">기능 설명서</a>
            <a href="#personas" className="navlink hover:text-[color:var(--color-brand)]">누가 쓰나요</a>
            <a href="#pricing" className="navlink hover:text-[color:var(--color-brand)]">요금제</a>
            <a href="#faq" className="navlink hover:text-[color:var(--color-brand)]">FAQ</a>
          </nav>

          <div className="flex items-center gap-2">
            {!authLoading && userInfo ? (
              <>
                <div className="hidden md:flex flex-col items-end leading-tight mr-1">
                  <span className="text-sm font-semibold text-[color:var(--color-ink)]">{userInfo.name} 님</span>
                  <span className="text-xs font-bold text-[color:var(--color-brand)]">
                    {isSuperAdmin
                      ? 'SuperAdmin'
                      : hasCompany && userInfo?.company_display_name
                        ? `${userInfo.company_display_name}${userInfo.team ? ` · ${userInfo.team}` : ''}`
                        : hasCompany ? 'Pro' : '체험판'}
                  </span>
                </div>
                {((hasCompany && isAdmin) || isSuperAdmin) && (
                  <button
                    onClick={() => router.push('/dashboard')}
                    className="text-sm font-bold bg-[color:var(--color-brand)] hover:bg-[color:var(--color-brand-deep)] text-white px-3 py-2 rounded-xl transition-colors"
                  >
                    운영 페이지
                  </button>
                )}
                <button
                  onClick={handleLogout}
                  className="text-sm text-[color:var(--color-ink-faint)] hover:text-[color:var(--color-ink)] transition-colors ml-1"
                >
                  로그아웃
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => router.push('/login')}
                  className="hidden sm:inline-flex text-sm font-semibold text-[color:var(--color-ink-soft)] hover:text-[color:var(--color-brand)] px-3 py-2 rounded-lg transition-colors"
                >
                  로그인
                </button>
                <button
                  onClick={() => router.push('/signup')}
                  className="text-sm font-bold bg-[color:var(--color-brand)] hover:bg-[color:var(--color-brand-deep)] text-white px-4 py-2.5 rounded-xl transition-colors shadow-sm"
                >
                  시작하기
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      <main id="top">
        <Hero
  authed={!!userInfo}
  onSignup={() => router.push('/signup')}
  onLogin={() => {
    if (!userInfo) { router.push('/login'); return; }
    if (isAdmin || isSuperAdmin) { router.push('/dashboard'); } else { router.push('/work'); }
  }}
/>

        <ScreensCarousel />
        <Manifesto />
        <Modules />
        <Personas />
        <Pricing onSignup={() => router.push('/signup')} onContact={() => router.push('/contact')} />
        <GettingStarted />
        <FAQ />
        <FinalCTA onSignup={() => router.push('/signup')} onContact={() => router.push('/contact')} />
      </main>

      <Footer router={router} />
    </div>
  );
}

/* ============================================================
   HERO
   ============================================================ */
function Hero({ authed, onSignup, onLogin }: { authed: boolean; onSignup: () => void; onLogin: () => void }) {
  return (
    <section className="relative overflow-hidden">
      <div className="absolute inset-0 hero-grid pointer-events-none" />
      <div className="relative max-w-6xl mx-auto px-5 sm:px-6 pt-16 pb-20 md:pt-24 md:pb-28">
        <div className="grid lg:grid-cols-12 gap-10 lg:gap-14 items-center">
          {/* copy */}
          <div className="lg:col-span-6 reveal-r">
            <div className="inline-flex items-center gap-2 text-[12px] font-bold text-[color:var(--color-brand-deep)] bg-[color:var(--color-brand-soft)]/70 border border-[color:var(--color-brand)]/20 px-3 py-1.5 rounded-full mb-8">
              <span className="w-1.5 h-1.5 rounded-full bg-[color:var(--color-brand)] softpulse" />
              승강기 현장 관리 · 사용 설명서
            </div>
            <h1 className="font-black text-4xl sm:text-5xl md:text-[60px] leading-[1.05] tracking-tightest balance mb-6">
              승강기 관리자의<br className="hidden sm:block" />
              <span className="text-[color:var(--color-brand)]">종이 뭉치</span>와<br className="hidden sm:block" />
              카톡 스크롤을 하나로.
            </h1>
            <p className="text-lg text-[color:var(--color-ink-dim)] leading-relaxed pretty max-w-xl mb-10">
              <b className="text-[color:var(--color-ink-soft)]">LiftField</b>는 고장접수·정기점검·자재신청·검사서류까지 현장에서 오가는 모든 기록을 한 곳에 담는 웹 서비스입니다. 설치 없이 브라우저에서 바로.
            </p>

            <div className="grid sm:grid-cols-2 gap-3 max-w-2xl mb-10">
              <button
                onClick={onSignup}
                className="group flex items-center justify-between bg-[color:var(--color-brand)] hover:bg-[color:var(--color-brand-deep)] text-white text-left px-5 py-4 rounded-2xl transition-all hover:-translate-y-0.5 shadow-lg shadow-[color:var(--color-brand)]/20"
              >
                <div>
                  <div className="text-[11px] uppercase tracking-wider font-bold text-[color:var(--color-brand-soft)]">처음이신가요</div>
                  <div className="text-base font-black mt-0.5">무료로 시작하기</div>
                  <div className="text-[11px] text-[color:var(--color-brand-soft)]/90 mt-0.5">14일 체험 · 카드 등록 불필요</div>
                </div>
                <ArrowRightIcon />
              </button>
              <button
                onClick={onLogin}
                className="group flex items-center justify-between bg-white hover:bg-[color:var(--color-panel)] border border-[color:var(--color-line)] hover:border-[color:var(--color-ink)] text-[color:var(--color-ink)] text-left px-5 py-4 rounded-2xl transition-all hover:-translate-y-0.5"
              >
                <div>
                  <div className="text-[11px] uppercase tracking-wider font-bold text-[color:var(--color-ink-dim)]">
                    {authed ? '이미 사용중' : '이미 사용중'}
                  </div>
                  <div className="text-base font-black mt-0.5">
                    {authed ? '내 작업으로' : '로그인'}
                  </div>
                  <div className="text-[11px] text-[color:var(--color-ink-dim)] mt-0.5">
                    {authed ? '오늘 할 일 확인' : '기존 계정으로 로그인'}
                  </div>
                </div>
                <ArrowRightIcon />
              </button>
            </div>

            <div className="grid grid-cols-3 max-w-md gap-6 sm:gap-8 pt-6 border-t border-[color:var(--color-line)]">
              <MiniStat n="8+" label="현장 관리 기능" />
              <MiniStat n="2" label="사용자 유형별 흐름" />
              <MiniStat n="A4" label="서류 자동 출력" />
            </div>
          </div>

          {/* screenshot */}
          <div className="lg:col-span-6 reveal-l">
            <div className="relative floaty">
              <div className="rounded-2xl overflow-hidden border border-[color:var(--color-line)] bg-white shadow-2xl shadow-[color:var(--color-brand)]/10">
                <div className="flex items-center justify-between px-4 py-3 border-b border-[color:var(--color-line)] bg-[color:var(--color-panel)]">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-red-400" />
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
                  </div>
                  <div className="font-mono text-[11px] text-[color:var(--color-ink-dim)] flex items-center gap-1.5">
                    <LockIcon />
                    liftfield.co.kr/dashboard
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-6 h-6 rounded-full bg-[color:var(--color-brand)] text-white grid place-items-center text-[10px] font-bold">우</span>
                  </div>
                </div>

                <div className="relative bg-white">
                  <Image
                    src="/dashboard-blurred.png"
                    alt="LiftField 운영 대시보드 실제 화면 (텍스트 블러 처리)"
                    width={1024}
                    height={758}
                    priority
                    className="block w-full h-auto"
                  />
                  <div className="absolute top-3 right-3 flex items-center gap-1.5 bg-white/90 backdrop-blur border border-[color:var(--color-line)] rounded-full px-2.5 py-1 shadow-sm">
                    <LockIcon small />
                    <span className="font-mono text-[10px] font-bold text-[color:var(--color-ink-soft)] uppercase tracking-wider">
                      실제 화면 · 개인정보 블러
                    </span>
                  </div>
                </div>

                <div className="px-4 py-2 border-t border-[color:var(--color-line)] bg-[color:var(--color-panel)] flex items-center justify-between text-[10px] font-mono text-[color:var(--color-ink-dim)]">
                  <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 softpulse" /> connected</span>
                  <span>synced · 방금 전</span>
                  <span className="hidden sm:inline">v2.4.1</span>
                </div>
              </div>

              <div className="hidden md:flex absolute -top-3 -right-3 items-center gap-2 bg-white border border-[color:var(--color-line)] rounded-full pl-1 pr-3 py-1 shadow-lg text-xs">
                <span className="w-5 h-5 rounded-full bg-emerald-500 text-white grid place-items-center text-[10px]">✓</span>
                <span className="font-bold text-[color:var(--color-ink)]">실시간 동기화</span>
              </div>
              <div className="hidden md:flex absolute -bottom-3 -left-3 items-center gap-2 bg-white border border-[color:var(--color-line)] rounded-full pl-1 pr-3 py-1 shadow-lg text-xs">
                <span className="w-5 h-5 rounded-full bg-[color:var(--color-brand)] text-white grid place-items-center text-[10px]">⚡</span>
                <span className="font-bold text-[color:var(--color-ink)]">설치 없이 바로</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ============================================================
   SCREENS CAROUSEL
   ============================================================ */
type Slide = {
  key: string;
  title: string;
  route: string;
  src: string;
  alt: string;
  icon: React.ReactNode;
  tab: string;
};

const SLIDES: Slide[] = [
  { key: 'fault',      title: '고장접수',           route: '/ fault',      tab: '고장접수', src: '/screens/fault-blurred.png',
    alt: '고장접수 화면 (실제 서비스, 텍스트 블러 처리)',
    icon: <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z" /></svg> },
  { key: 'inspection', title: '정기점검 · 지도',    route: '/ inspection', tab: '정기점검', src: '/screens/inspection-blurred.png',
    alt: '정기점검 지도 화면 (실제 서비스, 텍스트 블러 처리)',
    icon: <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg> },
  { key: 'material',   title: '자재신청 관리',      route: '/ material',   tab: '자재신청', src: '/screens/material-blurred.png',
    alt: '자재신청 관리 화면 (실제 서비스, 텍스트 블러 처리)',
    icon: <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}><path d="M21 8L12 3 3 8l9 5 9-5z" /><path d="M3 8v8l9 5 9-5V8" /></svg> },
  { key: 'mobile',     title: '기사 · 모바일 홈',   route: 'mobile',       tab: '모바일 홈', src: '/screens/mobile-home-blurred.png',
    alt: '기사 모바일 홈 화면 (실제 서비스, 텍스트 블러 처리)',
    icon: <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}><rect x="6" y="2" width="12" height="20" rx="2" /><path d="M11 18h2" /></svg> },
  { key: 'inspect',    title: '검사지적 알림',      route: '/ inspect',    tab: '검사지적', src: '/screens/inspect-blurred.png',
    alt: '검사지적 예정 알림 화면 (실제 서비스, 텍스트 블러 처리)',
    icon: <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}><rect x="6" y="4" width="12" height="16" rx="2" /><path d="M9 4V2h6v2M9 12h6M9 16h4" /></svg> },
  { key: 'sites',      title: '현장 계약 목록',     route: '/ sites',      tab: '현장관리', src: '/screens/sites-blurred.png',
    alt: '현장 계약 목록 화면 (실제 서비스, 텍스트 블러 처리)',
    icon: <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}><rect x="4" y="3" width="16" height="18" /><path d="M9 21v-4h6v4" /></svg> },
];

function ScreensCarousel() {
  const [cur, setCur] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const total = SLIDES.length;

  const go = useCallback((delta: number) => setCur((c) => ((c + delta) % total + total) % total), [total]);

  // autoplay + pause on hover
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused) return;
    const t = window.setInterval(() => setCur((c) => (c + 1) % total), 6000);
    return () => clearInterval(t);
  }, [paused, total]);

  // keyboard
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
      if (e.key === 'ArrowRight') { e.preventDefault(); go(+1); }
    };
    el.addEventListener('keydown', onKey);
    return () => el.removeEventListener('keydown', onKey);
  }, [go]);

  // simple swipe
  const touchX = useRef<number | null>(null);
  const onTouchStart = (e: React.TouchEvent) => { touchX.current = e.touches[0].clientX; setPaused(true); };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchX.current == null) return;
    const dx = e.changedTouches[0].clientX - touchX.current;
    if (Math.abs(dx) > 40) go(dx < 0 ? +1 : -1);
    touchX.current = null;
  };

  const active = SLIDES[cur];

  return (
    <section id="screens" className="border-t border-[color:var(--color-line)] bg-[color:var(--color-panel)]/60">
      <div className="max-w-6xl mx-auto px-5 sm:px-6 py-20 md:py-24">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6 mb-10 reveal">
          <div>
            <div className="text-[11px] font-mono uppercase tracking-widest text-[color:var(--color-ink-dim)] mb-3">Live · Real screens</div>
            <h2 className="font-black text-3xl md:text-5xl tracking-tightest leading-tight balance">
              실제 사용 중인 화면들.
            </h2>
            <p className="text-[color:var(--color-ink-dim)] text-lg mt-4 max-w-xl pretty">
              현장 데이터 보호를 위해 <b>텍스트만 블러 처리</b>했습니다.
              UI 구조와 색상, 레이아웃은 실제 서비스 그대로입니다.
            </p>
          </div>
          <div className="flex items-center gap-2 text-[11px] font-mono text-[color:var(--color-ink-dim)] shrink-0">
            <LockIcon />
            <span className="uppercase tracking-widest font-bold">개인정보 블러</span>
          </div>
        </div>

        <div
          className="reveal"
          ref={rootRef}
          tabIndex={0}
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
        >
          <div className="relative rounded-2xl border border-[color:var(--color-line)] bg-white shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-[color:var(--color-line)] bg-[color:var(--color-panel)]">
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-red-400" />
                <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
              </div>
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-6 h-6 rounded-md bg-[color:var(--color-brand-soft)] text-[color:var(--color-brand)] grid place-items-center shrink-0">
                  {active.icon}
                </span>
                <span className="text-sm font-bold text-[color:var(--color-ink)] truncate">{active.title}</span>
                <span className="font-mono text-[10px] text-[color:var(--color-ink-dim)] hidden sm:inline shrink-0">{active.route}</span>
              </div>
              <div className="font-mono text-[10px] text-[color:var(--color-ink-dim)] shrink-0">
                {cur + 1} / {total}
              </div>
            </div>

            <div className="relative aspect-[16/10] bg-[color:var(--color-panel)]/40 grid place-items-center overflow-hidden">
              {SLIDES.map((s, i) => (
                <div
                  key={s.key}
                  className={`absolute inset-0 grid place-items-center p-4 transition-opacity duration-500 ${i === cur ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
                >
                  {/* Image with unbounded intrinsic size: rely on max-w/max-h + w-auto/h-auto via wrapper */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={s.src}
                    alt={s.alt}
                    className="max-w-full max-h-full w-auto h-auto rounded-lg border border-[color:var(--color-line)] shadow-sm"
                    loading={i === 0 ? 'eager' : 'lazy'}
                  />
                </div>
              ))}

              <button
                type="button"
                onClick={() => go(-1)}
                aria-label="이전 화면"
                className="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/95 hover:bg-white border border-[color:var(--color-line)] shadow-md grid place-items-center text-[color:var(--color-ink-soft)] hover:text-[color:var(--color-ink)] transition-colors"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4}><path d="M15 6l-6 6 6 6" /></svg>
              </button>
              <button
                type="button"
                onClick={() => go(+1)}
                aria-label="다음 화면"
                className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/95 hover:bg-white border border-[color:var(--color-line)] shadow-md grid place-items-center text-[color:var(--color-ink-soft)] hover:text-[color:var(--color-ink)] transition-colors"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4}><path d="M9 6l6 6-6 6" /></svg>
              </button>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap gap-1.5" role="tablist">
              {SLIDES.map((s, i) => (
                <button
                  key={s.key}
                  onClick={() => setCur(i)}
                  className={
                    i === cur
                      ? 'px-3 py-1.5 rounded-full text-xs font-bold border border-[color:var(--color-brand)] bg-[color:var(--color-brand)] text-white transition-colors'
                      : 'px-3 py-1.5 rounded-full text-xs font-medium border border-[color:var(--color-line)] text-[color:var(--color-ink-soft)] hover:border-[color:var(--color-ink)] hover:text-[color:var(--color-ink)] transition-colors'
                  }
                >
                  {s.tab}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1.5">
              {SLIDES.map((s, i) => (
                <button
                  key={s.key}
                  onClick={() => setCur(i)}
                  aria-label={`${i + 1}번 화면`}
                  className={
                    i === cur
                      ? 'w-6 h-1.5 rounded-full bg-[color:var(--color-brand)] transition-all'
                      : 'w-1.5 h-1.5 rounded-full bg-[color:var(--color-line)] hover:bg-[color:var(--color-ink-dim)] transition-all'
                  }
                />
              ))}
            </div>
          </div>
        </div>

        <p className="mt-8 text-center text-xs text-[color:var(--color-ink-faint)] pretty">
          모든 이미지는 실제 운영 중인 화면이며, 개인정보 보호를 위해 텍스트만 흐림 처리되었습니다.
        </p>
      </div>
    </section>
  );
}

/* ============================================================
   MANIFESTO
   ============================================================ */
function Manifesto() {
  return (
    <section id="why" className="border-t border-[color:var(--color-line)] bg-[color:var(--color-panel)]">
      <div className="max-w-6xl mx-auto px-5 sm:px-6 py-20 md:py-28">
        <div className="grid md:grid-cols-12 gap-10 md:gap-14">
          <div className="md:col-span-4 reveal-r">
            <div className="text-[11px] font-mono uppercase tracking-widest text-[color:var(--color-ink-dim)] mb-4">01 · Manifesto</div>
            <h2 className="font-display text-4xl md:text-5xl leading-tight text-[color:var(--color-ink)]">
              왜 이걸<br /><i>만들었나요.</i>
            </h2>
          </div>
          <div className="md:col-span-8 space-y-8 reveal">
            <p className="text-xl md:text-2xl leading-relaxed text-[color:var(--color-ink-soft)] balance">
              승강기 관리 현장은 아직도 <b>종이 점검표</b>와 <b>카카오톡 사진</b>, 흩어진 <b>엑셀 파일</b>로 굴러갑니다.
              누가 언제 뭘 했는지 되짚으려면 하루가 사라집니다.
            </p>
            <div className="grid sm:grid-cols-3 gap-5 pt-2 stagger">
              <ManifestoCard label="문제" title="기록이 흩어져 있어요" body="현장·기사·본사가 서로 다른 채널을 쓰고, 서류는 결국 손으로 옮겨 적습니다." />
              <ManifestoCard label="해결" title="한 곳에 실시간으로"  body="고장·점검·자재·견적을 같은 데이터베이스에 쌓아 담당자 알림까지 자동으로." />
              <ManifestoCard label="결과" title="정산·통계까지 연결"  body="쌓인 데이터로 월별 통계, 정기 서류, 견적서를 클릭 몇 번에 생성합니다." />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function ManifestoCard({ label, title, body }: { label: string; title: string; body: string }) {
  return (
    <div className="p-5 rounded-2xl bg-white border border-[color:var(--color-line)] reveal">
      <div className="text-[11px] font-mono uppercase tracking-wider text-[color:var(--color-ink-dim)] mb-2">{label}</div>
      <div className="font-bold text-[color:var(--color-ink)] leading-snug">{title}</div>
      <p className="text-sm text-[color:var(--color-ink-dim)] mt-2 leading-relaxed">{body}</p>
    </div>
  );
}

/* ============================================================
   MODULES (8 feature cards)
   ============================================================ */
type Module = { route: string; title: string; body: string; bullets: string[]; icon: React.ReactNode };

const MODULES: Module[] = [
  { route: '/ fault',      title: '고장접수',       body: '현장에서 발생한 고장을 사진과 함께 즉시 접수하고, 담당 기사에게 푸시 알림으로 배정합니다.',
    bullets: ['현장·호기 선택 후 증상 입력', '사진 첨부 및 담당자 자동 배정', '진행 상태별 필터로 이력 추적'],
    icon: <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z" /></svg> },
  { route: '/ inspection', title: '정기점검',       body: '월별 점검 일정을 등록하고, 완료 여부와 특이사항을 리포트로 남깁니다.',
    bullets: ['현장별 월 점검 캘린더', '특이사항 기록 · PDF 리포트', '완료율 자동 계산'],
    icon: <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg> },
  { route: '/ inspect',    title: '검사지적',       body: '자체·정기검사에서 지적된 항목을 코드로 관리하고, 조치 완료까지 체크합니다.',
    bullets: ['조건부합격/불합격 지적사항 등록', '동·호기별 그룹화 및 검색', '조치 결과 사진으로 마감'],
    icon: <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><rect x="6" y="4" width="12" height="16" rx="2" /><path d="M9 4V2h6v2M9 12h6M9 16h4" /></svg> },
  { route: '/ material',   title: '자재신청',       body: '현장에서 필요한 자재를 호기 단위로 신청하고 승인·출고 이력을 남깁니다.',
    bullets: ['자재명·수량 신청 및 사유 기록', '담당자 승인 흐름', 'PDF 출력으로 전달'],
    icon: <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M21 8L12 3 3 8l9 5 9-5z" /><path d="M3 8v8l9 5 9-5V8" /><path d="M12 13v8" /></svg> },
  { route: '/ quote',      title: '견적서',         body: '공사·부품 교체 견적을 표준 양식에 맞춰 작성하고 A4 PDF로 출력합니다.',
    bullets: ['현장·품목 자동 채우기', '발신·수신·반려 흐름 관리', 'A4 규격 그대로 PDF 저장'],
    icon: <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><path d="M14 2v6h6M9 13h6M9 17h4" /></svg> },
  { route: '/ sites',      title: '현장관리',       body: '담당 현장과 호기, 계약 정보를 등록하고 팀별로 분배합니다.',
    bullets: ['현장·호기·등록번호 관리', '지도 연동 · 길찾기'],
    icon: <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><rect x="4" y="3" width="16" height="18" /><path d="M9 21v-4h6v4M9 7h.01M15 7h.01M9 11h.01M15 11h.01" /></svg> },
  { route: '/ team',       title: '팀·인원 관리',  body: '팀을 만들고 초대코드로 기사를 합류시킵니다. 역할별 권한을 부여합니다.',
    bullets: ['팀 생성 · 초대코드 발급', '관리자 / 기사 권한 구분', '팀별 현장 분배'],
    icon: <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" /></svg> },
  { route: '/ stats',      title: '통계',           body: '점검 완료율, 고장 추이, 팀별 실적을 월 단위로 시각화합니다.',
    bullets: ['월별 점검 완료율', '팀별 고장 처리 건수', '기간 필터로 리포트 추출'],
    icon: <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M3 3v18h18" /><path d="M7 15l4-4 4 4 5-6" /></svg> },
];

function Modules() {
  return (
    <section id="manual" className="border-t border-[color:var(--color-line)]">
      <div className="max-w-6xl mx-auto px-5 sm:px-6 py-20 md:py-28">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6 mb-14 reveal">
          <div>
            <div className="text-[11px] font-mono uppercase tracking-widest text-[color:var(--color-ink-dim)] mb-3">02 · Manual</div>
            <h2 className="font-black text-3xl md:text-5xl tracking-tightest leading-tight balance">각 탭은 무엇을 하나요?</h2>
            <p className="text-[color:var(--color-ink-dim)] text-lg mt-4 max-w-xl pretty">
              모든 기능은 하나의 웹에서 동작하는 <b>8개의 탭</b>으로 구성됩니다. 각각의 목적과 실제 사용 방법을 정리했습니다.
            </p>
          </div>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-5 stagger">
          {MODULES.map((m) => (
            <article key={m.route} className="reveal group rounded-2xl border border-[color:var(--color-line)] bg-white p-6 hover:border-[color:var(--color-brand)] transition-colors flex flex-col">
              <div className="flex items-start justify-between mb-5">
                <div className="w-11 h-11 rounded-xl bg-[color:var(--color-brand-soft)] grid place-items-center text-[color:var(--color-brand)]">
                  {m.icon}
                </div>
              </div>
              <div className="text-[11px] font-mono uppercase tracking-wider text-[color:var(--color-ink-dim)] mb-1">{m.route}</div>
              <h3 className="font-black text-lg text-[color:var(--color-ink)] mb-2">{m.title}</h3>
              <p className="text-sm text-[color:var(--color-ink-dim)] leading-relaxed mb-4 pretty">{m.body}</p>
              <ul className="text-[13px] text-[color:var(--color-ink-soft)] space-y-1.5 mt-auto">
                {m.bullets.map((b) => (
                  <li key={b} className="flex gap-2"><span className="text-[color:var(--color-brand)] shrink-0">→</span>{b}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ============================================================
   PERSONAS
   ============================================================ */
function Personas() {
  return (
    <section id="personas" className="border-t border-[color:var(--color-line)] bg-[color:var(--color-ink)] text-white">
      <div className="max-w-6xl mx-auto px-5 sm:px-6 py-20 md:py-28">
        <div className="mb-14 reveal">
          <div className="text-[11px] font-mono uppercase tracking-widest text-white/40 mb-3">03 · Who uses it</div>
          <h2 className="font-black text-3xl md:text-5xl tracking-tightest leading-tight balance">누가, 어떻게 쓰나요.</h2>
          <p className="text-white/60 text-lg mt-4 max-w-xl pretty">
            LiftField는 <b className="text-white">회사 관리자</b>와 <b className="text-white">현장 기사</b> 두 가지 흐름을 지원합니다.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-4 md:gap-5 stagger">
          <PersonaCard n={1} title="회사 관리자 · 팀장" subtitle="Company 플랜"
            body="여러 팀·기사를 두고 회사 전체 현장을 총괄합니다. 웹 운영 페이지가 주 무대입니다."
            steps={['팀 생성 · 초대코드로 기사 합류', '현장을 팀별로 분배', '실시간 점검·고장 현황 모니터링']} />
          <PersonaCard n={2} title="현장 기사" subtitle="Company 소속"
            body="하루종일 현장을 오가며 접수·점검을 처리하는 기사입니다. 스마트폰 브라우저에서 바로 로그인해 사용합니다."
            steps={['초대코드로 팀에 합류', '배정된 현장에서 고장·점검 처리', '자재 신청 · 검사지적 조치 기록']} />
        </div>
      </div>
    </section>
  );
}

function PersonaCard({ n, title, subtitle, body, steps }: { n: number; title: string; subtitle: string; body: string; steps: string[] }) {
  return (
    <div className="reveal rounded-2xl bg-white/[0.04] border border-white/10 p-6 hover:bg-white/[0.06] transition-colors">
      <div className="flex items-center gap-3 mb-5">
        <div className="w-10 h-10 rounded-full bg-[color:var(--color-brand)] grid place-items-center font-black">{n}</div>
        <div>
          <div className="font-black">{title}</div>
          <div className="text-xs text-white/50">{subtitle}</div>
        </div>
      </div>
      <p className="text-sm text-white/70 leading-relaxed mb-5 pretty">{body}</p>
      <ol className="space-y-2.5 text-sm">
        {steps.map((s, i) => (
          <li key={s} className="flex gap-3">
            <span className="font-mono text-white/40 shrink-0 w-6">{String(i + 1).padStart(2, '0')}</span>
            {s}
          </li>
        ))}
      </ol>
    </div>
  );
}

/* ============================================================
   PRICING (4 tiers)
   ============================================================ */
function Pricing({ onSignup, onContact }: { onSignup: () => void; onContact: () => void }) {
  return (
    <section id="pricing" className="border-t border-[color:var(--color-line)]">
      <div className="max-w-6xl mx-auto px-5 sm:px-6 py-20 md:py-28">
        <div className="grid md:grid-cols-12 gap-10 md:gap-14 mb-14">
          <div className="md:col-span-5 reveal-r">
            <div className="text-[11px] font-mono uppercase tracking-widest text-[color:var(--color-ink-dim)] mb-3">04 · Pricing</div>
            <h2 className="font-black text-3xl md:text-5xl tracking-tightest leading-tight balance mb-4">
              회사 규모에 맞춰<br /><span className="text-[color:var(--color-brand)]">필요한 만큼만.</span>
            </h2>
          </div>
          <div className="md:col-span-7 space-y-4 text-[color:var(--color-ink-soft)] leading-relaxed pretty reveal">
            <p>LiftField는 <b>회사 단위 구독</b>으로 운영됩니다. 인원수와 관리 호기 수에 따라 네 가지 티어 중에서 선택하세요.</p>
            <p>먼저 <b>14일 무료 체험</b>으로 팀 전체가 실제 현장에서 써보고, 맞다고 판단되면 회사에 맞는 티어로 전환하면 됩니다.</p>
            <p className="text-sm text-[color:var(--color-ink-dim)] border-l-2 border-[color:var(--color-brand)] pl-4">
              서버·데이터베이스·푸시 알림·지도 API를 매일 유지하는 데 드는 실비를 구독료로 충당합니다. 광고는 붙이지 않고, 여러분의 현장 데이터는 팔지 않습니다.
            </p>
          </div>
        </div>

        <div className="rounded-2xl bg-[color:var(--color-panel)] border border-[color:var(--color-line)] px-6 py-5 mb-6 flex flex-wrap items-center justify-between gap-4 reveal">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-white border border-[color:var(--color-line)] grid place-items-center text-[color:var(--color-brand)]">
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
            </div>
            <div>
              <div className="font-black text-[color:var(--color-ink)]">14일 무료 체험</div>
              <div className="text-sm text-[color:var(--color-ink-dim)]">모든 기능 사용 가능 · 카드 등록 불필요</div>
            </div>
          </div>
          <button onClick={onSignup} className="text-sm font-bold text-[color:var(--color-brand)] hover:text-[color:var(--color-brand-deep)] px-4 py-2.5 rounded-xl border border-[color:var(--color-line)] hover:border-[color:var(--color-brand)] transition-colors">
            체험 시작하기 →
          </button>
        </div>

        <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-4 md:gap-5 stagger">
          <TierCard tier="Tier 01" name="Starter"    caption="소규모 팀" price="₩55,000"   perUnit="약 ₩110" units="500대 이하"   people="15명까지" bullets={STARTER_BULLETS} cta="Starter 시작하기" onClick={onSignup} />
          <TierCard tier="Tier 02" name="Standard"   caption="중견 규모 회사" price="₩88,000" perUnit="약 ₩59"  units="1,500대 이하" people="30명까지" bullets={STANDARD_BULLETS} cta="Standard 시작하기" onClick={onSignup} highlight />
          <TierCard tier="Tier 03" name="Pro"        caption="대형 관리업체" price="₩132,000" perUnit="약 ₩44" units="3,000대 이하" people="무제한"    bullets={PRO_BULLETS} cta="Pro 시작하기" onClick={onSignup} />
          <TierCard tier="Tier 04" name="Enterprise" caption="3,000대 초과 규모" price="별도 협의" perUnit="협의" units="3,000대 초과" people="무제한"   bullets={ENT_BULLETS} cta="도입 상담하기" onClick={onContact} enterprise />
        </div>

        <div className="mt-8 rounded-2xl border border-[color:var(--color-line)] overflow-hidden overflow-x-auto reveal">
          <div className="min-w-[720px] grid grid-cols-5 text-[13px]">
            <div className="px-5 py-4 font-mono text-[11px] uppercase tracking-wider text-[color:var(--color-ink-dim)] bg-[color:var(--color-panel)] border-b border-[color:var(--color-line)]" />
            <div className="px-5 py-4 font-black text-[color:var(--color-ink)] bg-[color:var(--color-panel)] border-b border-[color:var(--color-line)] text-center">Starter</div>
            <div className="px-5 py-4 font-black text-[color:var(--color-ink)] bg-[color:var(--color-panel)] border-b border-[color:var(--color-line)] text-center relative">
              Standard
              <span className="absolute top-1 right-2 text-[9px] font-mono font-bold text-amber-600 uppercase tracking-wider">주력</span>
            </div>
            <div className="px-5 py-4 font-black text-[color:var(--color-ink)] bg-[color:var(--color-panel)] border-b border-[color:var(--color-line)] text-center">Pro</div>
            <div className="px-5 py-4 font-black text-[color:var(--color-brand)] bg-[color:var(--color-panel)] border-b border-[color:var(--color-line)] text-center">Enterprise</div>

            {['월 요금', '호기 수', '인원', '호기당 단가'].map((label, ri) => (
              <RowFragment key={label} label={label} row={COMPARE_ROWS[ri]} last={ri === 3} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

const STARTER_BULLETS  = ['8개 핵심 기능 모두 사용', '웹 운영 페이지', '팀 · 초대코드 발급', '서류 · 견적서 PDF', '기본 이메일 지원'];
const STANDARD_BULLETS = ['Starter 모든 기능', '다중 팀 운영', '팀별 현장 분배', '월별 통계 · 리포트', '우선 이메일 지원'];
const PRO_BULLETS      = ['Standard 모든 기능', '사용자 무제한', '전체 현장 통합 관리', '고급 통계 · 커스텀 필터', '우선 지원 (평일 4시간 내)'];
const ENT_BULLETS      = ['Pro 모든 기능', '전용 담당자 배정', '도입 컨설팅 · 온보딩', 'SLA · 보안 감사 대응', '맞춤 기능 협의 가능'];
const COMPARE_ROWS = [
  ['₩55,000', '₩88,000', '₩132,000', '별도 협의'],
  ['500대 이하', '1,500대 이하', '3,000대 이하', '3,000대 초과'],
  ['15명까지', '30명까지', '무제한', '무제한'],
  ['약 ₩110', '약 ₩59', '약 ₩44', '협의'],
];

function RowFragment({ label, row, last }: { label: string; row: string[]; last: boolean }) {
  const border = last ? '' : ' border-b border-[color:var(--color-line)]';
  return (
    <>
      <div className={`px-5 py-4 text-[color:var(--color-ink-dim)]${border}`}>{label}</div>
      <div className={`px-5 py-4 text-center font-mono font-bold${border}`}>{row[0]}</div>
      <div className={`px-5 py-4 text-center font-mono font-bold${border} bg-amber-50/50`}>{row[1]}</div>
      <div className={`px-5 py-4 text-center font-mono font-bold${border}`}>{row[2]}</div>
      <div className={`px-5 py-4 text-center font-mono font-bold text-[color:var(--color-brand)]${border}`}>{row[3]}</div>
    </>
  );
}

function TierCard(props: {
  tier: string; name: string; caption: string; price: string; perUnit: string;
  units: string; people: string; bullets: string[]; cta: string; onClick: () => void;
  highlight?: boolean; enterprise?: boolean;
}) {
  const { tier, name, caption, price, perUnit, units, people, bullets, cta, onClick, highlight, enterprise } = props;

  if (highlight) {
    return (
      <div className="reveal relative rounded-3xl bg-[color:var(--color-ink)] text-white p-7 flex flex-col shadow-2xl shadow-[color:var(--color-brand)]/20">
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-amber-400 text-amber-950 text-[11px] font-black uppercase tracking-wider px-3 py-1 rounded-full">
          주력 · 가장 많이 선택
        </div>
        <div className="font-mono text-[10px] uppercase tracking-widest text-white/50 mb-1">{tier}</div>
        <h3 className="font-black text-2xl mb-1">{name}</h3>
        <p className="text-sm text-white/60 mb-6">{caption}</p>
        <div className="flex items-baseline gap-1 mb-1">
          <span className="font-mono text-3xl font-bold">{price}</span>
          <span className="font-mono text-sm text-white/50">/월</span>
        </div>
        <p className="text-xs text-white/60 mb-6">부가세 별도 · 호기당 <b className="text-[color:var(--color-brand-soft)]">{perUnit}</b></p>
        <div className="space-y-2 mb-6 py-4 border-y border-white/10">
          <StatRow label="호기 수" value={units} />
          <StatRow label="인원"    value={people} />
        </div>
        <ul className="space-y-2.5 text-sm text-white/85 mb-8 flex-1">
          {bullets.map((b) => (<li key={b} className="flex gap-2"><span className="text-[color:var(--color-brand)] shrink-0 font-bold">✓</span>{b}</li>))}
        </ul>
        <button onClick={onClick} className="w-full py-3 rounded-xl bg-white text-[color:var(--color-ink)] hover:bg-[color:var(--color-brand-soft)] font-black text-sm transition-colors">{cta}</button>
      </div>
    );
  }

  const wrapCls = enterprise
    ? 'reveal rounded-3xl border-2 border-[color:var(--color-brand)]/30 bg-[color:var(--color-brand-soft)]/20 p-7 flex flex-col'
    : 'reveal rounded-3xl border border-[color:var(--color-line)] bg-white p-7 flex flex-col';

  return (
    <div className={wrapCls}>
      <div className={`font-mono text-[10px] uppercase tracking-widest ${enterprise ? 'text-[color:var(--color-brand)]' : 'text-[color:var(--color-ink-dim)]'} mb-1`}>{tier}</div>
      <h3 className="font-black text-2xl mb-1 text-[color:var(--color-ink)]">{name}</h3>
      <p className="text-sm text-[color:var(--color-ink-dim)] mb-6">{caption}</p>
      <div className="flex items-baseline gap-1 mb-1">
        <span className="font-mono text-3xl font-bold text-[color:var(--color-ink)]">{price}</span>
        {!enterprise && <span className="font-mono text-sm text-[color:var(--color-ink-dim)]">/월</span>}
      </div>
      <p className="text-xs text-[color:var(--color-ink-dim)] mb-6">
        {enterprise
          ? <>규모에 맞춰 <b className="text-[color:var(--color-brand)]">개별 견적</b></>
          : <>부가세 별도 · 호기당 <b className="text-[color:var(--color-ink-soft)]">{perUnit}</b></>}
      </p>
      <div className={`space-y-2 mb-6 py-4 border-y ${enterprise ? 'border-[color:var(--color-brand)]/20' : 'border-[color:var(--color-line)]'}`}>
        <StatRow label="호기 수" value={units} light />
        <StatRow label="인원"    value={people} light />
      </div>
      <ul className="space-y-2.5 text-sm text-[color:var(--color-ink-soft)] mb-8 flex-1">
        {bullets.map((b) => (
          <li key={b} className="flex gap-2">
            <span className={`font-bold shrink-0 ${enterprise ? 'text-[color:var(--color-brand)]' : 'text-emerald-600'}`}>✓</span>
            {b}
          </li>
        ))}
      </ul>
      <button
        onClick={onClick}
        className={enterprise
          ? 'w-full py-3 rounded-xl bg-[color:var(--color-brand)] hover:bg-[color:var(--color-brand-deep)] text-white font-black text-sm transition-colors'
          : 'w-full py-3 rounded-xl border border-[color:var(--color-line)] hover:border-[color:var(--color-ink)] font-bold text-sm transition-colors'
        }
      >
        {cta}
      </button>
    </div>
  );
}

function StatRow({ label, value, light }: { label: string; value: string; light?: boolean }) {
  return (
    <div className="flex justify-between text-sm">
      <span className={light ? 'text-[color:var(--color-ink-dim)]' : 'text-white/60'}>{label}</span>
      <span className={`font-mono font-bold ${light ? 'text-[color:var(--color-ink)]' : ''}`}>{value}</span>
    </div>
  );
}

/* ============================================================
   GETTING STARTED
   ============================================================ */
function GettingStarted() {
  return (
    <section id="start" className="border-t border-[color:var(--color-line)] bg-[color:var(--color-panel)]">
      <div className="max-w-6xl mx-auto px-5 sm:px-6 py-20 md:py-28">
        <div className="mb-14 reveal">
          <div className="text-[11px] font-mono uppercase tracking-widest text-[color:var(--color-ink-dim)] mb-3">05 · Getting started</div>
          <h2 className="font-black text-3xl md:text-5xl tracking-tightest leading-tight balance">4단계로 시작합니다.</h2>
        </div>

        <div className="grid md:grid-cols-4 gap-4 stagger">
          <StepCard n="01" title="가입"      body="이메일로 가입하고 14일 무료 체험을 시작합니다." />
          <StepCard n="02" title="회사 설정" body="회사 이름과 대표 관리자를 등록합니다." />
          <StepCard n="03" title="팀 초대"   body="초대코드를 발급하고 기사·직원에게 전달합니다." />
          <StepCard n="04" title="바로 사용" body={<>별도 설치 없이 PC·모바일 브라우저에서 <b>liftfield.co.kr</b>로 접속하면 끝입니다.</>} />
        </div>

        <div className="mt-8 rounded-2xl border border-[color:var(--color-line)] bg-white px-6 py-5 flex flex-wrap items-center justify-between gap-4 reveal">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-[color:var(--color-brand-soft)] grid place-items-center text-[color:var(--color-brand)]">
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}><rect x="3" y="4" width="18" height="14" rx="2" /><path d="M8 21h8M12 18v3" /></svg>
            </div>
            <div>
              <div className="font-black text-[color:var(--color-ink)]">웹 브라우저에서 바로 동작합니다</div>
              <div className="text-sm text-[color:var(--color-ink-dim)]">Chrome · Safari · Edge · 모바일 브라우저 모두 지원 · 별도 설치 불필요</div>
            </div>
          </div>
          <span className="font-mono text-[12px] text-[color:var(--color-ink-dim)] px-3 py-1.5 rounded-lg bg-[color:var(--color-panel)] border border-[color:var(--color-line)]">liftfield.co.kr</span>
        </div>
      </div>
    </section>
  );
}

function StepCard({ n, title, body }: { n: string; title: string; body: React.ReactNode }) {
  return (
    <div className="reveal rounded-2xl bg-white border border-[color:var(--color-line)] p-6">
      <div className="font-mono text-xs text-[color:var(--color-brand)] font-bold mb-3">STEP {n}</div>
      <div className="font-black text-lg mb-2">{title}</div>
      <p className="text-sm text-[color:var(--color-ink-dim)] leading-relaxed">{body}</p>
    </div>
  );
}

/* ============================================================
   FAQ
   ============================================================ */
const FAQS: { q: string; a: React.ReactNode; open?: boolean }[] = [
  { q: '설치가 필요한가요?', open: true,
    a: <>아니요. LiftField는 <b>웹 서비스</b>입니다. Chrome, Safari, Edge 등 어떤 브라우저에서도 <b>liftfield.co.kr</b>로 접속해 바로 로그인하면 됩니다. 앱스토어 설치는 필요 없습니다.</> },
  { q: '현장은 어떻게 추가하나요?',
    a: <>로그인 후 <b>현장관리</b> 메뉴에서 + 버튼을 눌러 현장과 호기를 등록할 수 있습니다.</> },
  { q: '고장신고는 어떻게 하나요?',
    a: <><b>고장접수</b> 탭에서 현장과 호기를 선택한 후 내용을 입력하고 접수하세요. 담당자에게 즉시 알림이 발송됩니다. 모바일 브라우저에서도 동일하게 동작합니다.</> },
  { q: '팀원은 어떻게 초대하나요?',
    a: <>회사 관리자는 웹 운영 페이지의 <b>팀 관리</b> 메뉴에서 팀별 초대코드를 발급할 수 있습니다.</> },
  { q: '웹 운영 페이지는 어떻게 사용하나요?',
    a: <><b>liftfield.co.kr</b>에 로그인하면 됩니다. PC 브라우저에서 사용하는 것이 가장 편리하지만, 모바일 브라우저도 지원합니다.</> },
  { q: '데이터는 안전한가요?',
    a: <>모든 데이터는 암호화되어 저장되고, 회사별로 완전히 분리됩니다. 제3자에게 판매하거나 광고에 활용하지 않습니다.</> },
];

function FAQ() {
  return (
    <section id="faq" className="border-t border-[color:var(--color-line)]">
      <div className="max-w-3xl mx-auto px-5 sm:px-6 py-20 md:py-28">
        <div className="mb-12 text-center reveal">
          <div className="text-[11px] font-mono uppercase tracking-widest text-[color:var(--color-ink-dim)] mb-3">06 · FAQ</div>
          <h2 className="font-black text-3xl md:text-5xl tracking-tightest leading-tight balance">자주 묻는 질문.</h2>
        </div>
        <div className="space-y-3 stagger">
          {FAQS.map((f) => (
            <details key={f.q} open={f.open} className="reveal group bg-white border border-[color:var(--color-line)] hover:border-[color:var(--color-ink)] rounded-2xl px-6 py-4 transition-colors">
              <summary className="flex items-center justify-between cursor-pointer">
                <span className="flex items-start gap-3 font-bold text-[color:var(--color-ink)] pr-3">
                  <span className="font-mono text-[color:var(--color-brand)] shrink-0">Q.</span>
                  <span>{f.q}</span>
                </span>
                <svg className="chev w-4 h-4 shrink-0 text-[color:var(--color-ink-dim)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><path d="M6 9l6 6 6-6" /></svg>
              </summary>
              <div className="mt-3 pt-3 border-t border-[color:var(--color-line)] flex items-start gap-3 text-sm text-[color:var(--color-ink-dim)] leading-relaxed">
                <span className="font-mono text-emerald-600 font-bold shrink-0">A.</span>
                <p className="min-w-0">{f.a}</p>
              </div>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ============================================================
   FINAL CTA
   ============================================================ */
function FinalCTA({ onSignup, onContact }: { onSignup: () => void; onContact: () => void }) {
  return (
    <section className="border-t border-[color:var(--color-line)]">
      <div className="max-w-5xl mx-auto px-5 sm:px-6 py-16 md:py-24">
        <div className="rounded-3xl bg-[color:var(--color-brand)] relative overflow-hidden p-10 md:p-14 text-white reveal-scale">
          <div className="absolute inset-0 hero-grid opacity-30 pointer-events-none" />
          <div className="relative max-w-2xl">
            <h3 className="font-black text-3xl md:text-4xl leading-tight tracking-tightest balance mb-4">
              지금 종이 점검표를 덮고,<br />LiftField를 켜세요.
            </h3>
            <p className="text-[color:var(--color-brand-soft)]/90 text-base md:text-lg mb-8 pretty">
              14일 동안 카드 등록 없이 모든 기능을 써볼 수 있습니다.
            </p>
            <div className="flex flex-wrap gap-3">
              <button onClick={onSignup} className="bg-white text-[color:var(--color-brand-deep)] hover:bg-[color:var(--color-brand-soft)] font-black px-7 py-3.5 rounded-xl transition-colors">
                무료로 시작하기 →
              </button>
              <button onClick={onContact} className="bg-white/10 hover:bg-white/20 text-white border border-white/30 font-bold px-7 py-3.5 rounded-xl transition-colors">
                도입 상담하기
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ============================================================
   FOOTER
   ============================================================ */
function Footer({ router }: { router: ReturnType<typeof useRouter> }) {
  return (
    <footer className="bg-[color:var(--color-ink)] text-white/60">
      <div className="max-w-6xl mx-auto px-5 sm:px-6 py-16">
        <div className="grid md:grid-cols-4 gap-10 mb-12">
          <div className="md:col-span-1">
            <div className="flex items-center gap-2.5 mb-4">
  <Image src="/icon-192.png" alt="LiftField 로고" width={32} height={32} className="rounded-lg" />
  <span className="font-black text-white text-lg tracking-tightest">LiftField</span>
</div>

            <p className="text-sm leading-relaxed">승강기 현장 관리 솔루션.<br />종이 뭉치 대신 하나의 화면.</p>
          </div>
          <div>
            <h4 className="text-white font-black text-sm mb-4">서비스</h4>
            <ul className="space-y-2 text-sm">
              <li><a href="#manual" className="hover:text-white transition-colors">기능 설명서</a></li>
              <li><a href="#pricing" className="hover:text-white transition-colors">요금제</a></li>
              <li><a href="#personas" className="hover:text-white transition-colors">사용자 유형</a></li>
            </ul>
          </div>
          <div>
            <h4 className="text-white font-black text-sm mb-4">지원</h4>
            <ul className="space-y-2 text-sm">
              <li><a href="#faq" className="hover:text-white transition-colors">FAQ</a></li>
              <li><button onClick={() => router.push('/contact')} className="hover:text-white transition-colors">문의하기</button></li>
            </ul>
          </div>
          <div>
            <h4 className="text-white font-black text-sm mb-4">법적 고지</h4>
            <ul className="space-y-2 text-sm">
              <li><button onClick={() => router.push('/terms')}   className="hover:text-white transition-colors">이용약관</button></li>
              <li><button onClick={() => router.push('/privacy')} className="hover:text-white transition-colors">개인정보처리방침</button></li>
              <li><button onClick={() => router.push('/refund')}  className="hover:text-white transition-colors">환불정책</button></li>
            </ul>
          </div>
        </div>

        <div className="border-t border-white/10 pt-8 text-[11px] font-mono leading-relaxed text-white/40 text-center space-y-1">
          <p>상호명: (주)LiftField &nbsp;|&nbsp; 대표자: — &nbsp;|&nbsp; 사업자등록번호: 000-00-00000</p>
          <p>주소: — &nbsp;|&nbsp; 고객센터: — &nbsp;|&nbsp; 이메일: support@liftfield.co.kr</p>
          <p className="pt-3">© 2026 LiftField. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}

/* ============================================================
   Small helpers
   ============================================================ */
function MiniStat({ n, label }: { n: string; label: string }) {
  return (
    <div>
      <div className="font-mono text-2xl md:text-3xl font-bold text-[color:var(--color-ink)]">
        {n.includes('+') ? <>{n.replace('+', '')}<span className="text-[color:var(--color-brand)]">+</span></> : n}
      </div>
      <div className="text-xs text-[color:var(--color-ink-dim)] mt-1">{label}</div>
    </div>
  );
}

function ArrowRightIcon() {
  return (
    <svg className="w-5 h-5 shrink-0 transition-transform group-hover:translate-x-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

function LockIcon({ small }: { small?: boolean } = {}) {
  const size = small ? 'w-3 h-3' : 'w-3 h-3';
  return (
    <svg className={`${size} text-[color:var(--color-ink-dim)]`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4}>
      <rect x="3" y="11" width="18" height="10" rx="2" />
      <path d="M7 11V7a5 5 0 0110 0v4" />
    </svg>
  );
}
