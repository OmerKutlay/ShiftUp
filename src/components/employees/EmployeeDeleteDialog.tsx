'use client'

/**
 * EmployeeDeleteDialog — kalıcı silme onayı (shadcn AlertDialog).
 * Çalışanın bağlı kayıtları varsa (FK_VIOLATION) silme yerine pasifleştirme önerilir.
 */
import { useState } from 'react'
import { Archive, Trash2, TriangleAlert } from 'lucide-react'

import type { EmployeeWithRole } from '@/types/employee'
import { deactivateEmployee, deleteEmployee } from '@/lib/api/employees'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogMedia,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'

type DeleteError = { message: string; isFkViolation: boolean }

export function EmployeeDeleteDialog({ employee, onClose, onDone }: {
  employee: EmployeeWithRole | null
  onClose: () => void
  /** İşlem tamamlandı: 'deleted' ya da 'deactivated' */
  onDone: (result: 'deleted' | 'deactivated', employee: EmployeeWithRole) => Promise<void> | void
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
      const isFk = (err as { code?: string }).code === 'FK_VIOLATION'
      setError({ message: msg, isFkViolation: isFk })
    } finally {
      setBusy(false)
    }
  }

  const handleDeactivate = async () => {
    if (!employee) return
    setBusy(true)
    setError(null)
    try {
      await deactivateEmployee(employee.id)
      await onDone('deactivated', employee)
    } catch (err) {
      setError({ message: err instanceof Error ? err.message : 'Pasifleştirme başarısız.', isFkViolation: false })
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
          <AlertDialogTitle>{fk ? 'Çalışan pasifleştirilsin mi?' : 'Çalışan silinsin mi?'}</AlertDialogTitle>
          <AlertDialogDescription>
            {fk ? (
              <>
                <span className="font-medium text-foreground">{employee?.full_name}</span> silinemiyor ama
                pasifleştirilebilir: geçmiş kayıtları korunur, yeni vardiyalara atanmaz.
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
            <AlertTitle>{fk ? 'Bağlı kayıtlar var' : 'Silinemedi'}</AlertTitle>
            <AlertDescription>{error.message}</AlertDescription>
          </Alert>
        )}

        <AlertDialogFooter>
          <Button type="button" variant="outline" onClick={close} disabled={busy}>
            İptal
          </Button>
          {fk ? (
            <Button type="button" onClick={() => void handleDeactivate()} disabled={busy}>
              {busy && <Spinner />}
              Pasifleştir
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
