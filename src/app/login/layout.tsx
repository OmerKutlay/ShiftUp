/**
 * Login route group layout — AppShell olmadan sadece içerik render eder.
 * RootLayout'taki AppShell'i override etmek için bu layout dosyası gereklidir.
 */
export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
