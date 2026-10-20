'use client'

import { Component, type ReactNode, type ErrorInfo } from 'react'
import { AlertTriangle, RotateCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'

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
        <div role="alert" className="flex min-h-[60vh] items-center justify-center p-4">
          <Empty className="max-w-sm">
            <EmptyHeader>
              <EmptyMedia variant="icon" className="bg-destructive/10 text-destructive">
                <AlertTriangle aria-hidden />
              </EmptyMedia>
              <EmptyTitle>{this.props.fallbackTitle ?? 'Bir şeyler ters gitti'}</EmptyTitle>
              <EmptyDescription className="[overflow-wrap:anywhere]">{this.state.errorMessage}</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button variant="outline" onClick={this.handleReset}>
                <RotateCw />
                Tekrar dene
              </Button>
            </EmptyContent>
          </Empty>
        </div>
      )
    }

    return this.props.children
  }
}
