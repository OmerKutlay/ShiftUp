'use client'

/**
 * Aydınlatma sayfasının oturuma bağlı parçaları: yöneticiye "şablondur" notu, oturumsuzken girişe dönüş.
 */
import Link from 'next/link'
import { ArrowLeft, CircleAlert } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { ACCESS, roleAtLeast } from '@/lib/auth/roles'
import { resolveCompany, type CompanySettings } from '@/lib/kvkk'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'

export function PrivacyAdminNote({ company }: { company: Partial<CompanySettings> | null }) {
  const { employee } = useAuth()
  if (!roleAtLeast(employee?.roles?.access_level, ACCESS.STORE_MANAGER)) return null
  const { missing } = resolveCompany(company)
  return (
    <Alert tone="warning" role="note">
      <CircleAlert />
      <AlertTitle>Yönetici notu (çalışanlara görünmez)</AlertTitle>
      <AlertDescription>
        Bu metin bir şablondur; yayına almadan önce şirketin hukuk müşaviri tarafından gözden geçirilmelidir
        (özellikle saklama süreleri ve yurt dışı aktarım dayanağı). Yurt dışı aktarımda standart sözleşme imzalandıysa
        imzadan itibaren 5 iş günü içinde Kurum&apos;a bildirilmelidir.
        {missing.length > 0 && ' Şirket bilgileri henüz eksik: Ayarlar › KVKK bölümünden girin.'}
      </AlertDescription>
    </Alert>
  )
}

export function PrivacyBackLink() {
  const { status } = useAuth()
  if (status === 'loading') return null
  const authed = status === 'authenticated'
  return (
    <Button variant="ghost" size="sm" asChild className="-ml-2 w-fit text-muted-foreground">
      <Link href={authed ? '/more' : '/login'} prefetch={false}>
        <ArrowLeft />
        {authed ? 'Geri dön' : 'Giriş sayfasına dön'}
      </Link>
    </Button>
  )
}
