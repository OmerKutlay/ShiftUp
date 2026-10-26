/**
 * GET /api/announcements/unread-count — Navigasyon rozeti için okunmamış duyuru sayısı (hafif)
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabaseAdmin'
import { requireAuth } from '@/lib/auth'
import { serverError } from '@/lib/apiErrors'
import { countUnread } from '@/lib/announcementService'

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if ('response' in auth) return auth.response
  try {
    const unread_count = await countUnread(createAdminClient(), auth.employee)
    return NextResponse.json({ unread_count })
  } catch (err) {
    return serverError('GET /api/announcements/unread-count', err)
  }
}
