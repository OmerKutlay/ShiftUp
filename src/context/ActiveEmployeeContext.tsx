'use client'

/**
 * ActiveEmployeeContext — FAZ 10 Fix
 *
 * Auth sistemi olmayan mevcut mimaride "aktif kullanıcı" seçimini yönetir.
 * Kullanıcı sidebar'dan çalışan seçer → bu ID tüm app'te kullanılır.
 * Gerçek auth entegre edildiğinde sadece bu context değiştirilir.
 */
import { createContext, useContext, useState, useCallback, ReactNode } from 'react'

interface ActiveEmployee {
  id: string
  full_name: string
}

interface ActiveEmployeeContextValue {
  activeEmployee: ActiveEmployee | null
  setActiveEmployee: (emp: ActiveEmployee | null) => void
}

const ActiveEmployeeContext = createContext<ActiveEmployeeContextValue>({
  activeEmployee: null,
  setActiveEmployee: () => {},
})

export function ActiveEmployeeProvider({ children }: { children: ReactNode }) {
  const [activeEmployee, setActiveEmployeeState] = useState<ActiveEmployee | null>(() => {
    // sessionStorage'dan kurtarma — sayfa yenilemede seçimi koru
    if (typeof window !== 'undefined') {
      try {
        const saved = sessionStorage.getItem('activeEmployee')
        if (saved) return JSON.parse(saved) as ActiveEmployee
      } catch { /* ignore */ }
    }
    return null
  })

  const setActiveEmployee = useCallback((emp: ActiveEmployee | null) => {
    setActiveEmployeeState(emp)
    if (typeof window !== 'undefined') {
      if (emp) {
        sessionStorage.setItem('activeEmployee', JSON.stringify(emp))
      } else {
        sessionStorage.removeItem('activeEmployee')
      }
    }
  }, [])

  return (
    <ActiveEmployeeContext.Provider value={{ activeEmployee, setActiveEmployee }}>
      {children}
    </ActiveEmployeeContext.Provider>
  )
}

export function useActiveEmployee() {
  return useContext(ActiveEmployeeContext)
}
