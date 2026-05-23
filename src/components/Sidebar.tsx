'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Activity, Bell, LayoutDashboard, Server, Settings, LogOut, BookOpen } from 'lucide-react';
import { Logo } from './Logo';
import { ThemeToggle } from './ThemeToggle';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';

const NAV = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/servers',   label: 'Servers',   icon: Server },
  { href: '/uptime',    label: 'Uptime',    icon: Activity },
  { href: '/alerts',    label: 'Alerts',    icon: Bell },
  { href: '/settings',  label: 'Settings',  icon: Settings },
];

export function Sidebar({ username, role }: { username: string; role?: string }) {
  const pathname = usePathname();
  const router = useRouter();

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    toast.success('Signed out');
    router.push('/login');
    router.refresh();
  };

  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-border bg-bg-soft/60 backdrop-blur-xl lg:flex">
      <div className="px-5 py-5">
        <Logo />
      </div>

      <nav className="flex-1 space-y-0.5 px-3">
        {NAV.map((item) => {
          const Icon = item.icon;
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all',
                active
                  ? 'bg-bg-muted text-ink ring-1 ring-inset ring-border'
                  : 'text-ink-muted hover:bg-bg-muted hover:text-ink'
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-border p-3">
        <Link
          href="/docs"
          className="mb-2 flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-ink-muted hover:bg-bg-muted hover:text-ink"
        >
          <BookOpen className="h-4 w-4" />
          Install guide
        </Link>
        <div className="flex items-center justify-between rounded-lg bg-bg-muted/60 px-3 py-2.5">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-ink">{username}</div>
            <div className="text-xs capitalize text-ink-soft">{role ?? 'member'}</div>
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            <ThemeToggle />
            <button
              onClick={logout}
              className="rounded-md p-1.5 text-ink-soft hover:bg-bg-soft hover:text-danger"
              title="Sign out"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
