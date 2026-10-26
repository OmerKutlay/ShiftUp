'use client'

/**
 * Aydınlatma sayfasının oturuma bağlı parçaları: yöneticiye "şablondur" notu, oturumsuzken girişe dönüş.
 */
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { ACCESS, roleAtLeast } from '@/lib/auth/roles'
import { resolveCompany, type CompanySettings } from '@/lib/kvkk'

export function PrivacyAdminNote({ company }: { company: Partial<CompanySettings> | null }) {
  const { employee } = useAuth()
  if (!roleAtLeast(employee?.roles?.access_level, ACCESS.STORE_MANAGER)) return null
  const { missing } = resolveCompany(company)
  return (
    <div role="note" className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
      <p className="font-medium">Yönetici notu (çalışanlara görünmez)</p>
      <p className="text-muted-foreground">
        Bu metin bir şablondur; yayına almadan önce şirketin hukuk müşaviri tarafından gözden geçirilmelidir
        (özellikle saklama süreleri ve yurt dışı aktarım dayanağı). Yurt dışı aktarımda standart sözleşme imzalandıysa
        imzadan itibaren 5 iş günü içinde Kurum&apos;a bildirilmelidir.
        {missing.length > 0 && ' Şirket bilgileri henüz eksik: Ayarlar › KVKK bölümünden girin.'}
      </p>
    </div>
  )
}

export function PrivacyBackLink() {
  const { status } = useAuth()
  if (status === 'loading') return null
  const authed = status === 'authenticated'
  return (
    <Link
      href={authed ? '/more' : '/login'}
      prefetch={false}
      className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="size-4" aria-hidden />
      {authed ? 'Geri dön' : 'Giriş sayfasına dön'}
    </Link>
  )
}
