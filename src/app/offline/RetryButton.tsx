'use client'

import { RotateCw } from 'lucide-react'
import { Button } from '@/components/ui/button'

/** Çevrimdışı sayfasında yeniden deneme: sayfayı yeniden yükler (bağlantı geldiyse asıl sayfa açılır) */
export function RetryButton() {
  return (
    <Button variant="outline" onClick={() => window.location.reload()}>
      <RotateCw />
      Yeniden dene
    </Button>
  )
}
