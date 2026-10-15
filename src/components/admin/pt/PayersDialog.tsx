import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { formatEUR } from '@/lib/money'
import { ptErrorMessage, useAdminUsers, useSetPayers, type AdminSession } from '@/hooks/usePtAdmin'
import { formatDay } from '@/components/admin/ptFormat'
import { sessionLabel, updatedMessage } from './sessionUtils'
import { memberOptions } from './memberOptions'

interface Props {
  session: AdminSession
  onClose: () => void
}

function initialSelection(session: AdminSession): Set<string> {
  if (session.billing_mode === 'custom') return new Set(session.payers.map(p => p.user_id))
  return new Set(session.participants.filter(p => !p.excluded).map(p => p.user_id))
}

export function PayersDialog({ session, onClose }: Props) {
  const { data: users = [], isLoading } = useAdminUsers()
  const setPayers = useSetPayers()
  const [selected, setSelected] = useState(() => initialSelection(session))
  const [reason, setReason] = useState('')
  const [pending, setPending] = useState<'save' | 'reset' | null>(null)
  const options = memberOptions(session, users)
  const n = selected.size
  const share = n > 0 ? Math.round(session.price_cents / n) : 0
  const exact = n > 0 && session.price_cents % n === 0

  const toggle = (id: string, checked: boolean) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  const submit = (userIds: string[], kind: 'save' | 'reset') => {
    setPending(kind)
    setPayers.mutate(
      { slotId: session.slot_id, userIds, reason: reason.trim() || null },
      {
        onSuccess: () => {
          toast.success(updatedMessage(session))
          onClose()
        },
        onError: err => toast.error(ptErrorMessage(err)),
        onSettled: () => setPending(null),
      }
    )
  }

  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Scegli chi paga</DialogTitle>
          <DialogDescription>
            {formatDay(session.date, 'EEEE d MMMM')} · {sessionLabel(session)}. Il prezzo della seduta viene diviso
            solo tra le persone scelte e la seduta esce dal calcolo automatico della giornata.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-2">
            {[0, 1, 2].map(i => <Skeleton key={i} className="h-8 w-full" />)}
          </div>
        ) : options.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nessun iscritto PT attivo.</p>
        ) : (
          <ul className="max-h-64 space-y-0.5 overflow-y-auto rounded-md border p-1">
            {options.map((o, i) => {
              const firstOther = !o.booked && (i === 0 || options[i - 1].booked)
              return (
                <li key={o.user_id}>
                  {firstOther && i > 0 && <div className="my-1 border-t" />}
                  <Label className="flex cursor-pointer items-center gap-2.5 rounded px-2 py-1.5 font-normal hover:bg-accent/50">
                    <Checkbox
                      checked={selected.has(o.user_id)}
                      onCheckedChange={checked => toggle(o.user_id, checked)}
                    />
                    <span className="flex-1 truncate">{o.name}</span>
                    {o.booked && <span className="text-[10px] uppercase tracking-wide text-muted-foreground">prenotato</span>}
                  </Label>
                </li>
              )
            })}
          </ul>
        )}

        <p className="rounded-md bg-muted/50 px-3 py-2 text-sm tabular-nums" aria-live="polite">
          {n === 0
            ? 'Seleziona almeno una persona.'
            : `${formatEUR(session.price_cents)} ÷ ${n} = ${exact ? '' : '≈ '}${formatEUR(share)} a testa`}
        </p>

        <div className="space-y-1.5">
          <Label htmlFor="payers-reason">Motivo (opzionale)</Label>
          <Input
            id="payers-reason"
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="Es. seduta offerta da Anna e Luca"
          />
        </div>

        <DialogFooter className="sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            onClick={() => submit([], 'reset')}
            disabled={session.billing_mode !== 'custom' || setPayers.isPending}
          >
            {pending === 'reset' ? 'Ripristino…' : 'Torna al calcolo automatico'}
          </Button>
          <Button type="button" onClick={() => submit([...selected], 'save')} disabled={n === 0 || setPayers.isPending}>
            {pending === 'save' ? 'Salvataggio…' : 'Salva'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
