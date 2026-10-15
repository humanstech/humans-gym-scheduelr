import { useState } from 'react'
import { Globe, Mail, Plus, Trash2 } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'

interface AllowedDomain { id: string; domain: string }
interface AllowedEmail { id: string; email: string; note: string | null }

function useAllowedDomains() {
  return useQuery({
    queryKey: ['allowedDomains'],
    queryFn: async (): Promise<AllowedDomain[]> => {
      const { data, error } = await supabase
        .from('allowed_domains')
        .select('id, domain')
        .order('domain')
      if (error) throw error
      return data ?? []
    },
  })
}

function useAllowedEmails() {
  return useQuery({
    queryKey: ['allowedEmails'],
    queryFn: async (): Promise<AllowedEmail[]> => {
      const { data, error } = await supabase
        .from('allowed_emails')
        .select('id, email, note')
        .order('email')
      if (error) throw error
      return data ?? []
    },
  })
}

function DomainSection() {
  const qc = useQueryClient()
  const { data: domains = [], isLoading } = useAllowedDomains()
  const [input, setInput] = useState('')

  const add = useMutation({
    mutationFn: async (domain: string) => {
      const { error } = await supabase.from('allowed_domains').insert({ domain })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['allowedDomains'] })
      setInput('')
      toast.success('Dominio aggiunto')
    },
    onError: () => toast.error('Errore: dominio già presente o non valido'),
  })

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('allowed_domains').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['allowedDomains'] })
      toast.success('Dominio rimosso')
    },
  })

  const handleAdd = () => {
    const d = input.trim().toLowerCase().replace(/^@/, '')
    if (!d) return
    add.mutate(d)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Globe className="h-4 w-4 text-muted-foreground" />
        <h3 className="font-semibold">Domini Google SSO</h3>
      </div>
      <p className="text-sm text-muted-foreground">
        Chiunque abbia un account Google con questi domini potrà accedere.
      </p>
      <div className="flex gap-2">
        <label htmlFor="domain-input" className="sr-only">Dominio da aggiungere</label>
        <input
          id="domain-input"
          className="flex-1 rounded-md border bg-background px-3 py-1.5 text-sm outline-none ring-offset-background focus:ring-2 focus:ring-ring focus:ring-offset-2"
          placeholder="esempio.com"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleAdd()}
        />
        <Button size="sm" onClick={handleAdd} disabled={add.isPending || !input.trim()} aria-label="Aggiungi dominio">
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Caricamento...</p>
      ) : (
        <ul className="space-y-1.5">
          {domains.map(d => (
            <li key={d.id} className="flex items-center justify-between rounded-md border bg-card px-3 py-2 text-sm">
              <span className="font-mono">@{d.domain}</span>
              {d.domain !== 'humans.tech' && (
                <button
                  onClick={() => remove.mutate(d.id)}
                  disabled={remove.isPending}
                  className="text-muted-foreground hover:text-destructive"
                  aria-label={`Elimina dominio ${d.domain}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function EmailSection() {
  const qc = useQueryClient()
  const { data: emails = [], isLoading } = useAllowedEmails()
  const [emailInput, setEmailInput] = useState('')
  const [noteInput, setNoteInput] = useState('')

  const add = useMutation({
    mutationFn: async ({ email, note }: { email: string; note: string }) => {
      const { error } = await supabase
        .from('allowed_emails')
        .insert({ email, note: note || null })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['allowedEmails'] })
      setEmailInput('')
      setNoteInput('')
      toast.success('Email autorizzata. L’ospite può accedere tramite il link inviato via email.')
    },
    onError: () => toast.error('Errore: email già presente o non valida'),
  })

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('allowed_emails').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['allowedEmails'] })
      toast.success('Email rimossa')
    },
  })

  const handleAdd = () => {
    const e = emailInput.trim().toLowerCase()
    if (!e || !e.includes('@')) return
    add.mutate({ email: e, note: noteInput.trim() })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Mail className="h-4 w-4 text-muted-foreground" />
        <h3 className="font-semibold">Email specifiche</h3>
      </div>
      <p className="text-sm text-muted-foreground">
        Autorizza gli ospiti ad accedere con il link ricevuto via email.
        Dopo aver aggiunto un indirizzo, l’ospite può usare “Sei un ospite?” nella pagina di accesso.
      </p>
      <div className="flex gap-2">
        <label htmlFor="email-input" className="sr-only">Email ospite da aggiungere</label>
        <input
          id="email-input"
          className="flex-1 rounded-md border bg-background px-3 py-1.5 text-sm outline-none ring-offset-background focus:ring-2 focus:ring-ring focus:ring-offset-2"
          placeholder="utente@dominio.com"
          value={emailInput}
          onChange={e => setEmailInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleAdd()}
        />
        <label htmlFor="note-input" className="sr-only">Nota opzionale</label>
        <input
          id="note-input"
          className="w-40 rounded-md border bg-background px-3 py-1.5 text-sm outline-none ring-offset-background focus:ring-2 focus:ring-ring focus:ring-offset-2"
          placeholder="Nota (opz.)"
          value={noteInput}
          onChange={e => setNoteInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleAdd()}
        />
        <Button size="sm" onClick={handleAdd} disabled={add.isPending || !emailInput.trim()} aria-label="Aggiungi email">
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Caricamento...</p>
      ) : (
        <ul className="space-y-1.5">
          {emails.map(e => (
            <li key={e.id} className="flex items-center justify-between rounded-md border bg-card px-3 py-2 text-sm">
              <div>
                <span className="font-mono">{e.email}</span>
                {e.note && <span className="ml-2 text-muted-foreground">— {e.note}</span>}
              </div>
              <button
                onClick={() => remove.mutate(e.id)}
                disabled={remove.isPending}
                className="text-muted-foreground hover:text-destructive"
                aria-label={`Elimina email ${e.email}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
          {emails.length === 0 && (
            <li className="text-sm text-muted-foreground">Nessuna email specifica configurata.</li>
          )}
        </ul>
      )}
    </div>
  )
}

export function AccessControl() {
  return (
    <div className="space-y-8">
      <DomainSection />
      <div className="border-t" />
      <EmailSection />
    </div>
  )
}
