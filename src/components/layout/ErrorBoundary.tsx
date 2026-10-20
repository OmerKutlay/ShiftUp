'use client'

import { Component, type ReactNode, type ErrorInfo } from 'react'
import { AlertTriangle, RotateCw } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface Props {
  children: ReactNode
  fallbackTitle?: string
}

interface State {
  hasError: boolean
  errorMessage: string
}

/**
 * React Error Boundary — FAZ 8
 * Render hatalarını yakalar, beyaz ekran yerine kullanışlı hata gösterir.
 * Class component zorunlu — hooks error boundary desteklemiyor.
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, errorMessage: '' }
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      errorMessage: error.message || 'Beklenmeyen bir hata oluştu.',
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  handleReset = () => {
    this.setState({ hasError: false, errorMessage: '' })
  }

  render() {
    if (this.state.hasError) {
      return (
        <div role="alert" className="flex min-h-[60vh] items-center justify-center p-4 text-ink">
          <div className="flex w-full max-w-sm flex-col items-center gap-3 rounded-2xl border bg-card px-6 py-8 text-center">
            <span className="flex size-12 items-center justify-center rounded-full bg-danger-soft text-danger">
              <AlertTriangle className="size-6" aria-hidden />
            </span>
            <h2 className="text-lg font-bold">{this.props.fallbackTitle ?? 'Bir şeyler ters gitti'}</h2>
            <p className="text-sm text-ink-secondary [overflow-wrap:anywhere]">{this.state.errorMessage}</p>
            <Button variant="outline" onClick={this.handleReset} className="mt-2">
              <RotateCw />
              Tekrar Dene
            </Button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
