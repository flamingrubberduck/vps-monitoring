import { redirect } from 'next/navigation';
import { getSessionFromCookies } from '@/lib/auth';
import { isSetupComplete } from '@/lib/setup';
import { Sidebar } from '@/components/Sidebar';
import { MobileNav } from '@/components/MobileNav';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  if (!(await isSetupComplete())) redirect('/setup');
  const session = await getSessionFromCookies();
  if (!session) redirect('/login');

  return (
    <div className="min-h-screen">
      <Sidebar username={session.username} role={session.role} />
      <MobileNav />
      <div className="lg:pl-64">
        <main className="mx-auto w-full max-w-7xl px-4 pb-24 pt-6 sm:px-6 lg:pb-10 lg:pt-8">
          {children}
        </main>
      </div>
    </div>
  );
}
