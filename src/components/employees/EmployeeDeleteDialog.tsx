'use client'

/**
 * EmployeeDeleteDialog — kalıcı silme onayı (shadcn AlertDialog).
 * Çalışanın bağlı kayıtları varsa (FK_VIOLATION) silme yerine pasifleştirme önerilir.
 */
import { useState } from 'react'
import { Archive, Trash2, TriangleAlert } from 'lucide-react'

import type { EmployeeWithRole } from '@/types/employee'
import { deleteEmployee } from '@/lib/api/employees'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogMedia,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'

type DeleteError = { message: string; isFkViolation: boolean }

export function EmployeeDeleteDialog({ employee, onClose, onDone, onOffboard }: {
  employee: EmployeeWithRole | null
  onClose: () => void
  onDone: (result: 'deleted', employee: EmployeeWithRole) => Promise<void> | void
  /** Kayıtlı geçmişi olan çalışan için "İşten çıkış" akışını açar */
  onOffboard: (employee: EmployeeWithRole) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<DeleteError | null>(null)

  const close = () => {
    if (busy) return
    setError(null)
    onClose()
  }

  const handleDelete = async () => {
    if (!employee) return
    setBusy(true)
    setError(null)
    try {
      await deleteEmployee(employee.id)
      await onDone('deleted', employee)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Bir hata oluştu.'
      const code = (err as { code?: string }).code
      const isFk = code === 'HAS_RECORDS' || code === 'FK_VIOLATION'
      setError({ message: msg, isFkViolation: isFk })
    } finally {
      setBusy(false)
    }
  }

  const fk = error?.isFkViolation

  return (
    <AlertDialog open={!!employee} onOpenChange={(next) => { if (!next) close() }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia className={fk ? 'bg-warning/10 text-warning' : 'bg-destructive/10 text-destructive'}>
            {fk ? <Archive /> : <Trash2 />}
          </AlertDialogMedia>
          <AlertDialogTitle>{fk ? 'Silinemez, işten çıkış yapılsın mı?' : 'Çalışan silinsin mi?'}</AlertDialogTitle>
          <AlertDialogDescription>
            {fk ? (
              <>
                <span className="font-medium text-foreground">{employee?.full_name}</span> kayıtlı geçmişi (vardiya, devam, izin) olduğu için silinemez.
                Yasal kayıtlar korunur; bunun yerine işten çıkış işlemi yapılır.
              </>
            ) : (
              <>
                <span className="font-medium text-foreground">{employee?.full_name}</span> kalıcı olarak silinecek.
                Bu işlem geri alınamaz.
              </>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {error && (
          <Alert variant={fk ? 'default' : 'destructive'} tone={fk ? 'warning' : undefined}>
            <TriangleAlert />
            <AlertTitle>{fk ? 'Geçmiş kayıtlar var' : 'Silinemedi'}</AlertTitle>
            <AlertDescription>{error.message}</AlertDescription>
          </Alert>
        )}

        <AlertDialogFooter>
          <Button type="button" variant="outline" onClick={close} disabled={busy}>
            İptal
          </Button>
          {fk ? (
            <Button type="button" onClick={() => { if (employee) { onOffboard(employee) } }} disabled={busy}>
              İşten çıkış başlat
            </Button>
          ) : (
            <Button type="button" variant="destructive" onClick={() => void handleDelete()} disabled={busy}>
              {busy && <Spinner />}
              Sil
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
