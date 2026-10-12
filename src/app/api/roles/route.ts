/**
 * GET /api/roles — sistem rolleri (dropdown'lar için). Oturum gerektirir.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { fetchRoles } from '@/lib/employeeRepository'
import { serverError } from '@/lib/apiErrors'

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if ('response' in auth) return auth.response

  try {
    return NextResponse.json({ roles: await fetchRoles() })
  } catch (err) {
    return serverError('GET /api/roles', err)
  }
}
