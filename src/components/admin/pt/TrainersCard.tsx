import { useState } from 'react'
import { Plus, Trash2, Wallet } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { ptErrorMessage, useAddTrainer, useRemoveTrainer } from '@/hooks/usePtAdmin'
import { useSaveTrainerRate, useSetTrainerDefaults, useTrainerAccounts, useTrainerDefaults, type TrainerAccount } from '@/hooks/useTrainerWallet'
import { formatEUR, parseEURToCents } from '@/lib/money'
import { TrainerWalletSheet } from './TrainerWalletSheet'

function TrainerRow({ trainer, isDefault, onWallet }: { trainer: TrainerAccount; isDefault: boolean; onWallet: () => void }) {
  const [fee, setFee] = useState(trainer.default_fee_cents === null ? '' : String(trainer.default_fee_cents / 100))
  const [savedFee, setSavedFee] = useState(trainer.default_fee_cents)
  if (savedFee !== trainer.default_fee_cents) {
    setSavedFee(trainer.default_fee_cents)
    setFee(trainer.default_fee_cents === null ? '' : String(trainer.default_fee_cents / 100))
  }
  const save = useSaveTrainerRate()
  const setDefault = useSetTrainerDefaults()
  const remove = useRemoveTrainer()
  const cents = parseEURToCents(fee)
  return (
    <li className="space-y-3 rounded-lg border bg-card p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="break-all text-sm font-medium">{trainer.email}</p>
          {isDefault && <Badge variant="secondary" className="mt-1">Trainer predefinito</Badge>}
        </div>
        <Button size="icon-sm" variant="ghost" disabled={remove.isPending}
          aria-label={`Rimuovi trainer ${trainer.email}`}
          onClick={() => remove.mutate(trainer.trainer_id, {
            onSuccess: () => toast.success('Trainer rimosso'),
            onError: () => toast.error('Il trainer non può essere rimosso se ha sedute assegnate o movimenti registrati.'),
          })}><Trash2 /></Button>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="space-y-1 text-xs text-muted-foreground">
          <span>Compenso per seduta (€)</span>
          <Input aria-label={`Compenso di ${trainer.email}`} className="w-28" inputMode="decimal" value={fee} onChange={e => setFee(e.target.value)} placeholder="Es. 40" />
        </label>
        <Button size="sm" variant="outline" disabled={cents === null || cents < 0 || cents === trainer.default_fee_cents || save.isPending}
          onClick={() => save.mutate({ trainer_id: trainer.trainer_id, fee_cents: cents! }, {
            onSuccess: () => toast.success('Compenso aggiornato per le nuove sedute'),
            onError: e => toast.error(ptErrorMessage(e)),
          })}>Salva compenso</Button>
      </div>
      <dl className="grid grid-cols-3 gap-2 text-xs">
        <div><dt className="text-muted-foreground">Maturato</dt><dd className="mt-1 font-medium tabular-nums">{formatEUR(trainer.earned_cents)}</dd></div>
        <div><dt className="text-muted-foreground">Pagato</dt><dd className="mt-1 font-medium tabular-nums">{formatEUR(trainer.paid_cents)}</dd></div>
        <div><dt className="text-muted-foreground">{trainer.balance_cents < 0 ? 'Anticipo' : 'Da pagare'}</dt><dd className="mt-1 font-semibold tabular-nums">{formatEUR(Math.abs(trainer.balance_cents))}</dd></div>
      </dl>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={onWallet}><Wallet /> Movimenti e pagamenti</Button>
        {!isDefault && <Button variant="ghost" size="sm" disabled={trainer.default_fee_cents === null || setDefault.isPending}
          onClick={() => setDefault.mutate(trainer.trainer_id, {
            onSuccess: () => toast.success('Trainer predefinito aggiornato'),
            onError: e => toast.error(ptErrorMessage(e)),
          })}>Usa per le sedute programmate</Button>}
      </div>
    </li>
  )
}

export function TrainersCard() {
  const { data: trainers = [], isLoading, isError } = useTrainerAccounts()
  const { data: defaults } = useTrainerDefaults()
  const add = useAddTrainer()
  const [email, setEmail] = useState('')
  const [fee, setFee] = useState('')
  const [walletId, setWalletId] = useState<string | null>(null)
  const normalized = email.trim().toLowerCase()
  const cents = parseEURToCents(fee)
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) && cents !== null && cents >= 0

  return (
    <section className="space-y-4">
      <div>
        <h3 className="font-semibold">Trainer e pagamenti</h3>
        <p className="mt-1 text-sm text-muted-foreground">I partecipanti pagano la cassa; qui registri i compensi e i pagamenti della cassa ai trainer.</p>
      </div>
      <p className="text-xs text-muted-foreground">Il compenso dell’account viene proposto per le nuove sedute. Ogni seduta mantiene il proprio importo, modificabile dall’admin. Il trainer vede solo le sedute assegnate e i partecipanti.</p>
      {!isLoading && !isError && !defaults?.default_trainer_id && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">Configura un compenso e scegli il trainer predefinito per generare le sedute programmate. La scelta assegna anche le sedute future ancora senza trainer.</p>
      )}
      {isLoading ? <Skeleton className="h-32" /> : isError ? (
        <p role="alert" className="text-sm text-destructive">Impossibile caricare i conti dei trainer. Riprova.</p>
      ) : trainers.length === 0 ? <p className="text-sm text-muted-foreground">Nessun trainer configurato.</p> : (
        <ul className="space-y-3">
          {trainers.map(t => <TrainerRow key={t.trainer_id} trainer={t} isDefault={defaults?.default_trainer_id === t.trainer_id} onWallet={() => setWalletId(t.trainer_id)} />)}
        </ul>
      )}
      <form className="space-y-2 border-t pt-4" onSubmit={e => {
        e.preventDefault()
        if (!valid) return
        add.mutate({ email: normalized, fee_cents: cents! }, {
          onSuccess: () => { setEmail(''); setFee(''); toast.success('Trainer aggiunto') },
          onError: () => toast.error('Impossibile aggiungere il trainer: verifica email e compenso.'),
        })
      }}>
        <h4 className="text-sm font-medium">Aggiungi trainer</h4>
        <label className="block space-y-1 text-xs text-muted-foreground"><span>Email del trainer</span>
          <Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="trainer@esempio.com" required />
        </label>
        <div className="flex flex-wrap items-end gap-2">
          <label className="space-y-1 text-xs text-muted-foreground"><span>Compenso per seduta (€)</span>
            <Input className="w-36" inputMode="decimal" value={fee} onChange={e => setFee(e.target.value)} placeholder="Es. 40" required />
          </label>
          <Button type="submit" size="sm" disabled={!valid || add.isPending}><Plus /> Aggiungi trainer</Button>
        </div>
      </form>
      {walletId && <TrainerWalletSheet trainerId={walletId} onClose={() => setWalletId(null)} />}
    </section>
  )
}
