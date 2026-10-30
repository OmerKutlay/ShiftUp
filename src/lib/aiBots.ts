/**
 * Yapay zekâ tarayıcıları (eğitim verisi toplayan, AI arama / asistan adına sayfa çeken botlar).
 *
 * robots.txt tüm botlara kapalıdır, ancak robots.txt yalnızca bir ricadır; bu liste middleware'de
 * User-Agent'a bakılarak 403 döndürmek için kullanılır. Arama motoru botları (Googlebot, Bingbot)
 * burada YOK: onlar robots.txt + X-Robots-Tag: noindex ile dizin dışı tutulur.
 *
 * Google-Extended / Applebot-Extended yalnızca robots.txt jetonudur (ayrı User-Agent ile gelmez).
 */
const AI_BOT_TOKENS = [
  // OpenAI
  'GPTBot', 'ChatGPT-User', 'OAI-SearchBot',
  // Anthropic
  'ClaudeBot', 'Claude-User', 'Claude-SearchBot', 'Claude-Web', 'anthropic-ai',
  // Perplexity
  'PerplexityBot', 'Perplexity-User',
  // Google (AI / genel amaçlı; Googlebot değil)
  'Google-CloudVertexBot', 'GoogleOther',
  // Meta
  'Meta-ExternalAgent', 'Meta-ExternalFetcher', 'FacebookBot',
  // Diğer
  'Amazonbot', 'Bytespider', 'TikTokSpider', 'CCBot', 'cohere-ai',
  'cohere-training-data-crawler', 'Diffbot', 'DuckAssistBot', 'MistralAI-User', 'YouBot',
  'AI2Bot', 'Ai2Bot-Dolma', 'ImagesiftBot', 'Omgilibot', 'Timpibot', 'Kangaroo Bot', 'PanguBot',
  'Webzio-Extended', 'iaskspider', 'img2dataset', 'Brightbot', 'VelenPublicWebCrawler',
]

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const AI_BOT_PATTERN = new RegExp(`(?:^|[^a-z0-9-])(?:${AI_BOT_TOKENS.map(escape).join('|')})(?![a-z0-9-])`, 'i')

/** User-Agent bilinen bir AI tarayıcısına mı ait? */
export function isAiBot(userAgent: string | null): boolean {
  return !!userAgent && AI_BOT_PATTERN.test(userAgent)
}
