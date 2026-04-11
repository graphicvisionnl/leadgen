import { NextRequest, NextResponse } from 'next/server'

const ACCESS_CODE = process.env.ACCESS_CODE ?? '9689'
const COOKIE_NAME = 'gv_auth'
const COOKIE_VALUE = 'authorized'

export async function POST(request: NextRequest) {
  const { code } = await request.json()

  if (code !== ACCESS_CODE) {
    return NextResponse.json({ error: 'Verkeerde code' }, { status: 401 })
  }

  const res = NextResponse.json({ success: true })
  res.cookies.set(COOKIE_NAME, COOKIE_VALUE, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 30, // 30 days
    path: '/',
  })
  return res
}

export async function DELETE() {
  const res = NextResponse.json({ success: true })
  res.cookies.delete(COOKIE_NAME)
  return res
}
