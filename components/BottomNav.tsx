// components/BottomNav.tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const tabs = [
  { href: '/fault', label: '고장신고', icon: '🔧' },
  { href: '/list', label: '등록현황', icon: '📋' },
  { href: '/settings', label: '설정', icon: '⚙️' },
  // 실제 팀에서 쓰는 탭 경로/라벨/아이콘으로 교체하세요
];

export default function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="bottomNav">
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          className={`bottomNavItem ${pathname === tab.href ? 'active' : ''}`}
        >
          <span className="bottomNavIcon">{tab.icon}</span>
          <span className="bottomNavLabel">{tab.label}</span>
        </Link>
      ))}

      <style jsx>{`
        .bottomNav {
          position: fixed;
          bottom: 0;
          left: 0;
          right: 0;
          height: 60px;
          display: flex;
          background: #0f172a;
          border-top: 1px solid #1e293b;
          z-index: 1000;
          padding-bottom: env(safe-area-inset-bottom, 0px);
        }
        .bottomNavItem {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 2px;
          text-decoration: none;
          color: #64748b;
          font-size: 11px;
        }
        .bottomNavItem.active {
          color: #60a5fa;
        }
        .bottomNavIcon {
          font-size: 18px;
        }
      `}</style>
    </nav>
  );
}
