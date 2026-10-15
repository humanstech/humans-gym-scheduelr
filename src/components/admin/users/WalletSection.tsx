import { useState } from 'react'
import type React from 'react'
import { Wallet } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { formatEUR, parseEURToCents } from '@/lib/money'
import { formatSignedEUR } from '@/components/pt/WalletLedger'
import { ptErrorMessage, useAddWalletEntry, usePtSettings } from '@/hooks/usePtAdmin'
import { balanceTone } from '@/components/admin/ptFormat'

function TopupForm({ userId }: { userId: string }) {
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const add = useAddWalletEntry()
  const cents = parseEURToCents(amount)
  const invalid = amount.trim() !== '' && (cents === null || cents <= 0)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (cents === null || cents <= 0) return
    add.mutate(
      { userId, amountCents: cents, kind: 'topup', note: note.trim() },
      {
        onSuccess: () => {
          toast.success(`Ricarica di ${formatEUR(cents)} registrata`)
          setAmount('')
          setNote('')
        },
        onError: err => toast.error(ptErrorMessage(err)),
      }
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-1.5">
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label htmlFor="topup-amount" className="text-xs font-normal text-muted-foreground">Importo (€)</Label>
          <Input
            id="topup-amount"
            inputMode="decimal"
            placeholder="50,00"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            aria-invalid={invalid || undefined}
            className="w-28"
          />
        </div>
        <div className="min-w-32 flex-1 space-y-1">
          <Label htmlFor="topup-note" className="text-xs font-normal text-muted-foreground">Nota (opzionale)</Label>
          <Input id="topup-note" placeholder="Bonifico" value={note} onChange={e => setNote(e.target.value)} />
        </div>
        <Button type="submit" disabled={cents === null || cents <= 0 || add.isPending}>
          {add.isPending ? 'Ricarica…' : 'Ricarica'}
        </Button>
      </div>
      {invalid && <p className="text-xs text-destructive">Inserisci un importo positivo, es. 50 o 12,50.</p>}
    </form>
  )
}

function ManualForm({ userId, onDone }: { userId: string; onDone: () => void }) {
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const add = useAddWalletEntry()
  const cents = parseEURToCents(amount.replace('−', '-'))
  const invalidAmount = amount.trim() !== '' && (cents === null || cents === 0)
  const canSubmit = cents !== null && cents !== 0 && note.trim() !== '' && !add.isPending

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit || cents === null) return
    add.mutate(
      { userId, amountCents: cents, kind: 'manual', note: note.trim() },
      {
        onSuccess: () => {
          toast.success(`Rettifica di ${formatSignedEUR(cents)} registrata`)
          onDone()
        },
        onError: err => toast.error(ptErrorMessage(err)),
      }
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2 rounded-lg border bg-muted/30 p-3">
      <p className="text-xs text-muted-foreground">
        Usa un importo negativo per togliere credito (es. -5,00). Il motivo resta visibile nei movimenti dell'utente.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label htmlFor="manual-amount" className="text-xs font-normal text-muted-foreground">Importo (€, con segno)</Label>
          <Input
            id="manual-amount"
            inputMode="decimal"
            placeholder="-5,00"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            aria-invalid={invalidAmount || undefined}
            className="w-32"
          />
        </div>
        <div className="min-w-32 flex-1 space-y-1">
          <Label htmlFor="manual-note" className="text-xs font-normal text-muted-foreground">Motivo (obbligatorio)</Label>
          <Input
            id="manual-note"
            placeholder="Es. seduta pagata in contanti"
            value={note}
            onChange={e => setNote(e.target.value)}
            required
          />
        </div>
      </div>
      {invalidAmount && <p className="text-xs text-destructive">Inserisci un importo diverso da zero, es. -5 o 10,50.</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={onDone} disabled={add.isPending}>Annulla</Button>
        <Button type="submit" size="sm" variant="secondary" disabled={!canSubmit}>
          {add.isPending ? 'Salvataggio…' : 'Registra rettifica'}
        </Button>
      </div>
    </form>
  )
}

export function WalletSection({ userId, balanceCents }: { userId: string; balanceCents: number }) {
  const { data: settings } = usePtSettings()
  const [manualOpen, setManualOpen] = useState(false)
  const threshold = settings?.low_balance_threshold_cents

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <Wallet className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">Wallet</h3>
      </div>
      <div>
        <p className={cn('text-3xl font-bold tabular-nums', balanceTone(balanceCents, threshold))}>
          {formatEUR(balanceCents)}
        </p>
        {threshold !== undefined && balanceCents < threshold && (
          <p className="mt-0.5 text-xs text-muted-foreground">Sotto la soglia di {formatEUR(threshold)}</p>
        )}
      </div>
      <TopupForm userId={userId} />
      {manualOpen ? (
        <ManualForm userId={userId} onDone={() => setManualOpen(false)} />
      ) : (
        <Button variant="link" size="sm" className="h-auto px-0" onClick={() => setManualOpen(true)}>
          Rettifica manuale
        </Button>
      )}
    </section>
  )
}
