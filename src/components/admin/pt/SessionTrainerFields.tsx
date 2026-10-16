import { Input } from '@/components/ui/input'
import type { TrainerAccount } from '@/hooks/useTrainerWallet'

export function SessionTrainerFields({ trainers, trainerId, fee, onTrainerChange, onFeeChange }: {
  trainers: TrainerAccount[]
  trainerId: string
  fee: string
  onTrainerChange: (id: string) => void
  onFeeChange: (value: string) => void
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="space-y-1 text-sm"><span>Trainer assegnato</span>
        <select aria-label="Trainer assegnato" className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm" value={trainerId} onChange={e => {
          onTrainerChange(e.target.value)
          const rate = trainers.find(t => t.trainer_id === e.target.value)?.default_fee_cents
          onFeeChange(rate === null || rate === undefined ? '' : String(rate / 100))
        }} required>
          <option value="">Seleziona trainer</option>
          {trainers.map(t => <option key={t.trainer_id} value={t.trainer_id}>{t.email}</option>)}
        </select>
      </label>
      <label className="space-y-1 text-sm"><span>Compenso seduta (€)</span><Input inputMode="decimal" value={fee} onChange={e => onFeeChange(e.target.value)} placeholder="Compenso del trainer" required /></label>
      {trainers.length === 0 && <p className="text-sm text-muted-foreground sm:col-span-2">Aggiungi prima un account nella sezione Trainer e pagamenti.</p>}
    </div>
  )
}
