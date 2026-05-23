'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Activity, Bell, LayoutDashboard, Server, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ThemeToggle } from '@/components/ThemeToggle';

const NAV = [
  { href: '/dashboard', label: 'Home',     icon: LayoutDashboard },
  { href: '/servers',   label: 'Servers',  icon: Server },
  { href: '/uptime',    label: 'Uptime',   icon: Activity },
  { href: '/alerts',    label: 'Alerts',   icon: Bell },
  { href: '/settings',  label: 'Settings', icon: Settings },
];

export function MobileNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 flex items-stretch gap-1 border-t border-border bg-bg-soft/80 px-2 py-2 backdrop-blur-xl lg:hidden">
      <div className="flex flex-1 justify-around">
        {NAV.map((item) => {
          const Icon = item.icon;
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex flex-1 flex-col items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-medium transition-colors',
                active ? 'text-ink' : 'text-ink-muted'
              )}
            >
              <Icon className="h-5 w-5" />
              {item.label}
            </Link>
          );
        })}
      </div>
      <div className="flex items-center border-l border-border pl-1">
        <ThemeToggle />
      </div>
    </nav>
  );
}
