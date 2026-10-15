import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertCircle, FlaskConical, LogIn } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabase'

// Keep in sync with DEV_PERSONAS in scripts/stack.py (checked by scripts/tests).
const PERSONAS = [
  { email: 'marco.ciotoli@humans.tech', name: 'Marco Ciotoli', role: 'Admin + PT' },
  { email: 'anna.rossi@humans.tech', name: 'Anna Rossi', role: 'Iscritta PT' },
  { email: 'luca.bianchi@humans.tech', name: 'Luca Bianchi', role: 'Iscritto PT' },
  { email: 'sara.verdi@humans.tech', name: 'Sara Verdi', role: 'Iscritta PT' },
  { email: 'giulia.neri@humans.tech', name: 'Giulia Neri', role: 'Utente senza PT' },
  { email: 'trainer.pt@example.com', name: 'Paolo Trainer', role: 'Trainer' },
]

function initials(name: string) {
  return name.split(' ').map(part => part[0]).join('').slice(0, 2).toUpperCase()
}

/** Local-only one-click login; rendered only when VITE_DEV_LOGIN is 'true'. */
export function DevLogin() {
  const navigate = useNavigate()
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const signInAs = async (email: string) => {
    setPending(email)
    setError(null)
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password: import.meta.env.VITE_DEV_LOGIN_PASSWORD,
    })
    setPending(null)
    if (!error) {
      navigate('/', { replace: true })
    } else if (error.code === 'invalid_credentials') {
      setError('Utente non trovato: esegui scripts/local.sh dev-users')
    } else {
      setError(`Accesso non riuscito: ${error.message}`)
    }
  }

  return (
    <section className="rounded-xl border-2 border-dashed border-amber-500/70 bg-amber-50/50 p-4 space-y-3 dark:bg-amber-950/20">
      <div>
        <h2 className="flex items-center gap-2 text-sm font-semibold text-amber-700 dark:text-amber-400">
          <FlaskConical className="h-4 w-4" />
          Accesso rapido · solo ambiente locale
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Nessuna email inviata. Per cambiare profilo, esci e scegline un altro.
        </p>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      <div className="space-y-1.5">
        {PERSONAS.map(persona => (
          <Button
            key={persona.email}
            variant="outline"
            onClick={() => signInAs(persona.email)}
            disabled={pending !== null}
            className="h-auto w-full justify-start gap-3 py-2 text-left"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
              {initials(persona.name)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{persona.name}</span>
              <span className="block truncate text-xs font-normal text-muted-foreground">
                {persona.role} · {persona.email}
              </span>
            </span>
            {pending === persona.email ? (
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-foreground border-t-transparent" />
            ) : (
              <LogIn className="h-4 w-4 text-muted-foreground" />
            )}
          </Button>
        ))}
      </div>
    </section>
  )
}
