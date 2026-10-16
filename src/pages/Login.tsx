import { useState, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { LegalLinks } from '@/components/LegalLinks'
import { Navigate } from 'react-router-dom'
import { AlertCircle, Mail, ArrowLeft, CheckCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAuth } from '@/hooks/useAuth'
import { GoogleIcon } from '@/components/icons/GoogleIcon'
import { DevLogin } from '@/components/DevLogin'

export function Login() {
  const { session, loading, signIn, signInWithMagicLink } = useAuth()
  const { data: googleEnabled = false } = useQuery({
    queryKey: ['auth-settings'],
    queryFn: async () => {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/auth/v1/settings`, {
        headers: { apikey: import.meta.env.VITE_SUPABASE_ANON_KEY },
      })
      if (!response.ok) throw new Error('Auth settings unavailable')
      const settings = await response.json()
      return settings.external?.google === true
    },
    staleTime: 60_000,
  })
  const [error, setError] = useState<string | null>(null)
  const [signing, setSigning] = useState<'google' | 'email' | null>(null)
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)

  const handleGoogleSignIn = useCallback(async () => {
    setSigning('google')
    setError(null)
    try {
      const err = await signIn()
      if (err) throw err
    } catch {
      setError('Errore durante il login con Google. Riprova.')
    } finally {
      setSigning(null)
    }
  }, [signIn])

  const handleMagicLink = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim()) return
    setSigning('email')
    setError(null)
    try {
      const err = await signInWithMagicLink(email.trim())
      if (err) throw err
      setSent(true)
    } catch {
      setError('Email non autorizzata o errore nell\'invio. Contatta un amministratore.')
    } finally {
      setSigning(null)
    }
  }, [email, signInWithMagicLink])

  const handleBackToLogin = useCallback(() => {
    setSent(false)
    setEmail('')
    setError(null)
  }, [])

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    )
  }

  if (session) {
    return <Navigate to="/" replace />
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground text-3xl font-black">
            G
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Gym</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Gym è il servizio di Humans per consultare le disponibilità della palestra
            e degli spazi aziendali, prenotare una sessione e gestire le proprie prenotazioni.
          </p>
        </div>

        <div className="rounded-xl border bg-card p-8 shadow-sm space-y-6 text-center">
          {sent ? (
            <>
              <div className="flex flex-col items-center gap-3">
                <CheckCircle className="h-10 w-10 text-primary" />
                <h2 className="text-lg font-semibold">Controlla la tua email</h2>
                <p className="text-sm text-muted-foreground">
                  Abbiamo inviato un link di accesso a <span className="font-medium text-foreground">{email}</span>.
                  <br />
                  Clicca il link per accedere.
                </p>
              </div>
              <button
                onClick={handleBackToLogin}
                className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mx-auto"
              >
                <ArrowLeft className="h-3 w-3" />
                Torna al login
              </button>
            </>
          ) : (
            <>
              <div>
                <h2 className="text-lg font-semibold">Accedi a Gym</h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  Accesso riservato agli utenti autorizzati.
                </p>
              </div>

              {error && (
                <div role="alert" className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {error}
                </div>
              )}

              {googleEnabled && (
                <>
                  <Button
                    variant="outline"
                    onClick={handleGoogleSignIn}
                    disabled={signing !== null}
                    className="w-full gap-2"
                    size="lg"
                  >
                    {signing === 'google' ? (
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-foreground border-t-transparent" />
                    ) : (
                      <GoogleIcon className="h-4 w-4" />
                    )}
                    Accedi con Google
                  </Button>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <div className="h-px flex-1 bg-border" />
                    <span>oppure con email</span>
                    <div className="h-px flex-1 bg-border" />
                  </div>
                </>
              )}

              <form onSubmit={handleMagicLink} className="space-y-3">
                <label htmlFor="login-email" className="block text-left text-sm font-medium">Email</label>
                <Input
                  id="login-email"
                  name="email"
                  autoComplete="email"
                  type="email"
                  placeholder="tua@email.com"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  disabled={signing !== null}
                  aria-describedby="magic-link-description"
                />
                <p id="magic-link-description" className="text-left text-xs text-muted-foreground">
                  Ti invieremo un link per accedere, senza password.
                </p>
                <Button
                  type="submit"
                  disabled={signing !== null || !email.trim()}
                  className="w-full gap-2"
                  size="lg"
                >
                  {signing === 'email' ? (
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
                  ) : (
                    <Mail className="h-4 w-4" />
                  )}
                  Invia magic link
                </Button>
              </form>
            </>
          )}
        </div>
        {import.meta.env.VITE_DEV_LOGIN === 'true' && <DevLogin />}
        <LegalLinks />
      </div>
    </div>
  )
}
