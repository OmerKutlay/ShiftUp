/**
 * AnnouncementBody — duyuru metnini güvenle gösterir.
 * Metin React düğümü olarak basılır (HTML yorumlanmaz); satır sonları korunur; yalnızca
 * http/https URL'leri bağlantı olur (bkz. linkifyParts).
 */
import { linkifyParts } from '@/lib/announcementText'

export function AnnouncementBody({ text, className }: { text: string; className?: string }) {
  return (
    <p className={`whitespace-pre-wrap break-words ${className ?? ''}`}>
      {linkifyParts(text).map((p, i) =>
        p.type === 'link' ? (
          <a
            key={i}
            href={p.href}
            target="_blank"
            rel="noopener noreferrer nofollow ugc"
            className="text-primary underline underline-offset-2 break-all"
          >
            {p.value}
          </a>
        ) : (
          <span key={i}>{p.value}</span>
        ),
      )}
    </p>
  )
}
