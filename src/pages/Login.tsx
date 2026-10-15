import { useState, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { LegalLinks } from '@/components/LegalLinks'
import { Navigate } from 'react-router-dom'
import { AlertCircle, Mail, ArrowLeft, CheckCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAuth } from '@/hooks/useAuth'
import { GoogleIcon } from '@/components/icons/GoogleIcon'

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
  const [signing, setSigning] = useState(false)
  const [guestMode, setGuestMode] = useState(false)
  const [guestEmail, setGuestEmail] = useState('')
  const [sent, setSent] = useState(false)

  const handleGoogleSignIn = useCallback(async () => {
    setSigning(true)
    setError(null)
    const err = await signIn()
    if (err) setError('Errore durante il login. Riprova.')
    setSigning(false)
  }, [signIn])

  const handleMagicLink = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    if (!guestEmail.trim()) return
    setSigning(true)
    setError(null)
    const err = await signInWithMagicLink(guestEmail.trim())
    if (err) {
      setError('Email non autorizzata o errore nell\'invio. Contatta un amministratore.')
    } else {
      setSent(true)
    }
    setSigning(false)
  }, [guestEmail, signInWithMagicLink])

  const handleBackToLogin = useCallback(() => {
    setGuestMode(false)
    setSent(false)
    setGuestEmail('')
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
          {!guestMode && googleEnabled ? (
            <>
              <div>
                <h2 className="text-lg font-semibold">Accesso riservato</h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  Accesso riservato agli utenti autorizzati.
                  <br />
                  Usa il tuo account Google per accedere.
                </p>
              </div>

              {error && (
                <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {error}
                </div>
              )}

              <Button
                variant="outline"
                onClick={handleGoogleSignIn}
                disabled={signing}
                className="w-full gap-2"
                size="lg"
              >
                {signing ? (
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-foreground border-t-transparent" />
                ) : (
                  <GoogleIcon className="h-4 w-4" />
                )}
                Accedi con Google
              </Button>

              <button
                onClick={() => setGuestMode(true)}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Sei un ospite? <span className="font-semibold">Accedi qui</span>
              </button>
            </>
          ) : sent ? (
            <>
              <div className="flex flex-col items-center gap-3">
                <CheckCircle className="h-10 w-10 text-primary" />
                <h2 className="text-lg font-semibold">Controlla la tua email</h2>
                <p className="text-sm text-muted-foreground">
                  Abbiamo inviato un link di accesso a <span className="font-medium text-foreground">{guestEmail}</span>.
                  <br />
                  Clicca il link per accedere.
                </p>
              </div>
              {googleEnabled && <button
                onClick={handleBackToLogin}
                className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mx-auto"
              >
                <ArrowLeft className="h-3 w-3" />
                Torna al login
              </button>}
            </>
          ) : (
            <>
              <div>
                <h2 className="text-lg font-semibold">{googleEnabled ? 'Accesso ospite' : 'Accedi a Gym'}</h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  Inserisci la tua email. Ti invieremo un link di accesso diretto.
                </p>
              </div>

              {error && (
                <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {error}
                </div>
              )}

              <form onSubmit={handleMagicLink} className="space-y-3">
                <Input
                  type="email"
                  placeholder="tua@email.com"
                  value={guestEmail}
                  onChange={e => setGuestEmail(e.target.value)}
                  required
                  autoFocus
                />
                <Button
                  type="submit"
                  disabled={signing || !guestEmail.trim()}
                  className="w-full gap-2"
                  size="lg"
                >
                  {signing ? (
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
                  ) : (
                    <Mail className="h-4 w-4" />
                  )}
                  Invia magic link
                </Button>
              </form>

              {googleEnabled && <button
                onClick={handleBackToLogin}
                className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mx-auto"
              >
                <ArrowLeft className="h-3 w-3" />
                Torna al login
              </button>}
            </>
          )}
        </div>
        <LegalLinks />
      </div>
    </div>
  )
}
