import { useState } from 'react'
import type React from 'react'
import { Plus, Trash2, UserCog } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useAddTrainer, useRemoveTrainer, useTrainers } from '@/hooks/usePtAdmin'

export function TrainersCard() {
  const { data: trainers = [], isLoading } = useTrainers()
  const add = useAddTrainer()
  const remove = useRemoveTrainer()
  const [email, setEmail] = useState('')
  const normalized = email.trim().toLowerCase()
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault()
    if (!valid) return
    add.mutate(normalized, {
      onSuccess: () => {
        setEmail('')
        toast.success('Trainer aggiunto')
      },
      onError: () => toast.error('Errore: email già presente o non valida'),
    })
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <UserCog className="h-4 w-4 text-muted-foreground" />
        <h3 className="font-semibold">Account trainer</h3>
      </div>
      <p className="text-sm text-muted-foreground">
        Il trainer accede con il link email e vede solo le sedute PT e gli iscritti.
      </p>
      <form onSubmit={handleAdd} className="flex gap-2">
        <label htmlFor="trainer-email" className="sr-only">Email del trainer</label>
        <Input
          id="trainer-email"
          type="email"
          placeholder="trainer@esempio.com"
          value={email}
          onChange={e => setEmail(e.target.value)}
          className="flex-1"
        />
        <Button type="submit" size="icon" disabled={!valid || add.isPending} aria-label="Aggiungi trainer">
          <Plus />
        </Button>
      </form>
      {isLoading ? (
        <Skeleton className="h-10 w-full" />
      ) : trainers.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nessun trainer configurato.</p>
      ) : (
        <ul className="space-y-1.5">
          {trainers.map(t => (
            <li key={t.id} className="flex items-center justify-between rounded-md border bg-card px-3 py-2 text-sm">
              <span className="truncate font-mono">{t.email}</span>
              <button
                type="button"
                onClick={() =>
                  remove.mutate(t.id, {
                    onSuccess: () => toast.success('Trainer rimosso'),
                    onError: () => toast.error('Errore durante la rimozione'),
                  })
                }
                disabled={remove.isPending}
                className="text-muted-foreground hover:text-destructive disabled:opacity-50"
                aria-label={`Rimuovi trainer ${t.email}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
