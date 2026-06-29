import { NextResponse } from 'next/server';
import { INBOX_SESSION_COOKIE } from '../../../lib/inbox-auth';

export async function POST() {
  const response = NextResponse.json({ ok: true });

  response.cookies.set({
    name: INBOX_SESSION_COOKIE,
    value: '',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  });

  return response;
}
