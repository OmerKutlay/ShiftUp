/**
 * fake-supabase — e2e testleri için yerel, sahte Supabase uç noktası (gerçek ağ yok).
 *
 * Production build (`next start`) dev oturumunu kabul etmez (AUTH_MODE=development yalnızca
 * NODE_ENV !== 'production' iken etkin). Middleware oturumu `auth.getUser()` ile doğrular ve
 * çalışanın aktifliğini/rolünü PostgREST'ten (`employees?auth_user_id=eq.…`) okur. Bu sunucu
 * yalnızca bu iki çağrıyı yanıtlar:
 *
 *   GET /auth/v1/user        Bearer e2e-<persona> → sabit kullanıcı
 *   GET /rest/v1/employees   auth_user_id=eq.<id> → { active, roles: { access_level } }
 *
 * Diğer her şey 404 döner. Sayfaların /api/* verisi tarayıcıda route() ile taklit edilir.
 * Persona listesi e2e/support/fixtures.ts ile aynı olmalıdır.
 */
import http from 'node:http'

const port = Number(process.env.FAKE_SUPABASE_PORT ?? 54329)

const PERSONAS = {
  employee: { userId: '00000000-0000-4000-8000-0000000000e1', accessLevel: 'employee' },
  manager: { userId: '00000000-0000-4000-8000-0000000000e2', accessLevel: 'store_manager' },
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`)

  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    res.end('ok')
    return
  }

  if (req.method === 'GET' && url.pathname === '/auth/v1/user') {
    const token = (req.headers.authorization ?? '').replace(/^Bearer /, '')
    const persona = PERSONAS[token.replace(/^e2e-/, '')]
    if (!token.startsWith('e2e-') || !persona) return send(res, 401, { code: 401, msg: 'invalid token' })
    return send(res, 200, {
      id: persona.userId,
      aud: 'authenticated',
      role: 'authenticated',
      email: `${token}@example.com`,
      app_metadata: { provider: 'email' },
      user_metadata: {},
      created_at: '2026-01-01T00:00:00.000Z',
    })
  }

  if (req.method === 'GET' && url.pathname === '/rest/v1/employees') {
    const authUserId = (url.searchParams.get('auth_user_id') ?? '').replace(/^eq\./, '')
    const persona = Object.values(PERSONAS).find((p) => p.userId === authUserId)
    const rows = persona ? [{ active: true, roles: { access_level: persona.accessLevel } }] : []
    // maybeSingle() → Accept: application/vnd.pgrst.object+json
    if ((req.headers.accept ?? '').includes('vnd.pgrst.object')) {
      return rows[0] ? send(res, 200, rows[0]) : send(res, 406, { code: 'PGRST116', message: 'no rows' })
    }
    return send(res, 200, rows)
  }

  send(res, 404, { message: 'e2e fake supabase: not implemented', path: url.pathname })
})

server.listen(port, '127.0.0.1', () => {
  console.log(`fake-supabase listening on http://127.0.0.1:${port}`)
})
