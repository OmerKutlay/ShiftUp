/**
 * requestTrace — Cloudflare Workers Logs için adım adım yapılandırılmış log.
 *
 * Her adım tamamlanınca tek satır JSON yazılır; Workers Logs JSON alanlarını ayrıştırır
 * (Observability'de `trace = "qr_process"`, `step = "consume"` gibi filtrelenebilir).
 * İstek CPU sınırını aşıp kesilirse (Error 1102, outcome: exceededCpu) son yazılan adım,
 * isteğin nerede öldüğünü gösterir. Satırlar `ray` (cf-ray) ile aynı isteğe bağlanır.
 *
 * NOT: Workers'ta Date.now() yalnızca I/O sırasında ilerler; `ms` alanı CPU değil, büyük
 * ölçüde ağ bekleme süresidir. CPU süresi isteğin invocation logundaki cpuTimeMs'dedir.
 *
 * QR verisi, token, konum gibi hassas alanlar loglanmaz.
 */

type Fields = Record<string, string | number | boolean | null | undefined>

export interface RequestTrace {
  /** Bir adımın bittiğini loglar (süre: önceki adımdan bu yana) */
  step(name: string, fields?: Fields): void
  /** İsteğin sonucunu loglar (toplam süre + yanıt durumu) */
  end(status: number, fields?: Fields): void
}

export function startTrace(
  trace: string,
  req: { headers: { get(name: string): string | null } },
  fields: Fields = {}
): RequestTrace {
  const ray = req.headers.get('cf-ray') ?? undefined
  const startedAt = Date.now()
  let last = startedAt
  const base = { trace, ray, ...fields }

  const write = (entry: Record<string, unknown>) => {
    if (process.env.NODE_ENV === 'test') return
    try {
      console.log(JSON.stringify(entry))
    } catch {
      // log yazımı isteği asla bozmamalı
    }
  }

  return {
    step(name, extra) {
      const now = Date.now()
      write({ ...base, ...extra, step: name, ms: now - last, total_ms: now - startedAt })
      last = now
    },
    end(status, extra) {
      write({ ...base, ...extra, step: 'end', status, total_ms: Date.now() - startedAt })
    },
  }
}
