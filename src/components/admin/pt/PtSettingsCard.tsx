import { useState } from 'react'
import type React from 'react'
import { Settings2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { parseEURToCents } from '@/lib/money'
import { ptErrorMessage, usePtSettings, useUpdatePtSettings, type PtSettings } from '@/hooks/usePtAdmin'

const centsToInput = (cents: number) => (cents / 100).toFixed(2).replace('.', ',')

function SettingsForm({ settings }: { settings: PtSettings }) {
  const [price, setPrice] = useState(centsToInput(settings.session_price_cents))
  const [threshold, setThreshold] = useState(centsToInput(settings.low_balance_threshold_cents))
  const [maxParticipants, setMaxParticipants] = useState(String(settings.max_participants))
  const update = useUpdatePtSettings()

  const priceCents = parseEURToCents(price)
  const thresholdCents = parseEURToCents(threshold)
  const max = Number(maxParticipants)
  const priceInvalid = priceCents === null || priceCents <= 0
  const thresholdInvalid = thresholdCents === null || thresholdCents < 0
  const maxInvalid = !Number.isInteger(max) || max < 1
  const dirty =
    priceCents !== settings.session_price_cents ||
    thresholdCents !== settings.low_balance_threshold_cents ||
    max !== settings.max_participants

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (priceInvalid || thresholdInvalid || maxInvalid || priceCents === null || thresholdCents === null) return
    update.mutate(
      { sessionPriceCents: priceCents, lowBalanceThresholdCents: thresholdCents, maxParticipants: max },
      {
        onSuccess: () => toast.success('Impostazioni salvate'),
        onError: err => toast.error(ptErrorMessage(err)),
      }
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor="pt-price" className="text-xs font-normal text-muted-foreground">Prezzo seduta (€)</Label>
          <Input id="pt-price" inputMode="decimal" value={price} onChange={e => setPrice(e.target.value)} aria-invalid={priceInvalid || undefined} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="pt-threshold" className="text-xs font-normal text-muted-foreground">Soglia saldo basso (€)</Label>
          <Input id="pt-threshold" inputMode="decimal" value={threshold} onChange={e => setThreshold(e.target.value)} aria-invalid={thresholdInvalid || undefined} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="pt-max" className="text-xs font-normal text-muted-foreground">Partecipanti massimi</Label>
          <Input id="pt-max" type="number" min={1} step={1} value={maxParticipants} onChange={e => setMaxParticipants(e.target.value)} aria-invalid={maxInvalid || undefined} />
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">Il nuovo prezzo vale per le giornate non ancora chiuse.</p>
        <Button type="submit" size="sm" disabled={!dirty || priceInvalid || thresholdInvalid || maxInvalid || update.isPending}>
          {update.isPending ? 'Salvataggio…' : 'Salva'}
        </Button>
      </div>
    </form>
  )
}

export function PtSettingsCard() {
  const { data: settings, isLoading } = usePtSettings()

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <Settings2 className="h-4 w-4 text-muted-foreground" />
        <h3 className="font-semibold">Impostazioni</h3>
      </div>
      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-3">
          {[0, 1, 2].map(i => <Skeleton key={i} className="h-12 w-full" />)}
        </div>
      ) : settings ? (
        <SettingsForm key={settings.updated_at} settings={settings} />
      ) : (
        <p className="text-sm text-muted-foreground">Impostazioni non disponibili.</p>
      )}
    </section>
  )
}
