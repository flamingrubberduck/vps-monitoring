import { NextResponse, type NextRequest } from 'next/server';
import { jwtVerify } from 'jose';
import { env } from '@/lib/env';

const COOKIE_NAME = 'vpsmon_session';

const PROTECTED_ROUTES = ['/dashboard', '/servers', '/settings', '/alerts'];
const AUTH_ROUTES = ['/login'];

async function isAuthed(req: NextRequest): Promise<boolean> {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  if (!token) return false;
  try {
    await jwtVerify(token, new TextEncoder().encode(env.JWT_SECRET));
    return true;
  } catch {
    return false;
  }
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const isProtected = PROTECTED_ROUTES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  const isAuthPage = AUTH_ROUTES.some((p) => pathname === p);

  const authed = await isAuthed(req);

  if (isProtected && !authed) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('redirect', pathname);
    return NextResponse.redirect(url);
  }

  if (isAuthPage && authed) {
    const url = req.nextUrl.clone();
    url.pathname = '/dashboard';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next|favicon.ico|.*\\..*).*)'],
};
