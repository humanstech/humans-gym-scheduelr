import { useState } from 'react'
import type React from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ptErrorMessage, useAdminUsers, useSetExclusion, type AdminSession } from '@/hooks/usePtAdmin'
import { formatDay } from '@/components/admin/ptFormat'
import { sessionLabel, updatedMessage } from './sessionUtils'
import { memberOptions } from './memberOptions'

interface Props {
  session: AdminSession
  onClose: () => void
}

const selectClass =
  'h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50'

export function ExclusionsDialog({ session, onClose }: Props) {
  const { data: users = [], isLoading } = useAdminUsers()
  const setExclusion = useSetExclusion()
  const [userId, setUserId] = useState('')
  const [reason, setReason] = useState('')
  const [pendingId, setPendingId] = useState<string | null>(null)

  const excludedIds = new Set(session.exclusions.map(e => e.user_id))
  const candidates = memberOptions(session, users).filter(o => !excludedIds.has(o.user_id))
  const booked = candidates.filter(c => c.booked)
  const others = candidates.filter(c => !c.booked)

  const run = (targetId: string, excluded: boolean, why: string | null, onDone?: () => void) => {
    setPendingId(targetId)
    setExclusion.mutate(
      { slotId: session.slot_id, userId: targetId, excluded, reason: why },
      {
        onSuccess: () => {
          toast.success(updatedMessage(session))
          onDone?.()
        },
        onError: err => toast.error(ptErrorMessage(err)),
        onSettled: () => setPendingId(null),
      }
    )
  }

  const handleExclude = (e: React.FormEvent) => {
    e.preventDefault()
    if (!userId) return
    run(userId, true, reason.trim() || null, () => {
      setUserId('')
      setReason('')
    })
  }

  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Escludi dal costo</DialogTitle>
          <DialogDescription>
            {formatDay(session.date, 'EEEE d MMMM')} · {sessionLabel(session)}. Chi è escluso non paga questa
            seduta e non conta tra i presenti; nei giorni senza seduta piena non paga nemmeno la quota condivisa.
          </DialogDescription>
        </DialogHeader>

        <section className="space-y-2">
          <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Esclusi</h4>
          {session.exclusions.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nessuno è escluso da questa seduta.</p>
          ) : (
            <ul className="space-y-1.5">
              {session.exclusions.map(ex => (
                <li key={ex.user_id} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{ex.name}</p>
                    {ex.reason && <p className="truncate text-xs text-muted-foreground">{ex.reason}</p>}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => run(ex.user_id, false, null)}
                    disabled={setExclusion.isPending}
                  >
                    {pendingId === ex.user_id ? 'Reintegro…' : 'Reintegra'}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <form onSubmit={handleExclude} className="space-y-3 border-t pt-4">
          <div className="space-y-1.5">
            <Label htmlFor="exclude-user">Persona</Label>
            <select
              id="exclude-user"
              value={userId}
              onChange={e => setUserId(e.target.value)}
              className={selectClass}
              disabled={isLoading || candidates.length === 0}
            >
              <option value="">{candidates.length === 0 ? 'Nessun iscritto da escludere' : '— scegli —'}</option>
              {booked.length > 0 && (
                <optgroup label="Prenotati">
                  {booked.map(o => <option key={o.user_id} value={o.user_id}>{o.name}</option>)}
                </optgroup>
              )}
              {others.length > 0 && (
                <optgroup label="Altri iscritti PT">
                  {others.map(o => <option key={o.user_id} value={o.user_id}>{o.name}</option>)}
                </optgroup>
              )}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="exclude-reason">Motivo (opzionale)</Label>
            <Input
              id="exclude-reason"
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="Es. infortunio"
            />
          </div>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>Chiudi</DialogClose>
            <Button type="submit" disabled={!userId || setExclusion.isPending}>
              {setExclusion.isPending && pendingId === userId ? 'Esclusione…' : 'Escludi'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
