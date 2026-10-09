'use client'

import { Component, type ReactNode, type ErrorInfo } from 'react'
import { Box, Typography, Button } from '@mui/material'
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline'

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
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '60vh',
            p: 4,
            gap: 2,
            color: 'text.primary',
          }}
        >
          <ErrorOutlineIcon sx={{ fontSize: 56, color: 'error.main', opacity: 0.7 }} />
          <Typography variant="h6" fontWeight={700} textAlign="center">
            {this.props.fallbackTitle ?? 'Bir şeyler ters gitti'}
          </Typography>
          <Typography variant="body2" color="text.secondary" textAlign="center" maxWidth={400}>
            {this.state.errorMessage}
          </Typography>
          <Button variant="outlined" onClick={this.handleReset} sx={{ mt: 1 }}>
            Tekrar Dene
          </Button>
        </Box>
      )
    }

    return this.props.children
  }
}
