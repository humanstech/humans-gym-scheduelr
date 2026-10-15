import { useState } from 'react'
import type React from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ptErrorMessage, useVoidSession, type AdminSession } from '@/hooks/usePtAdmin'
import { formatDay } from '@/components/admin/ptFormat'
import { sessionLabel, sessionStarted, updatedMessage } from './sessionUtils'

interface Props {
  session: AdminSession
  onClose: () => void
}

export function VoidSessionDialog({ session, onClose }: Props) {
  const [reason, setReason] = useState('')
  const voidSession = useVoidSession()
  const started = sessionStarted(session)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!reason.trim()) return
    voidSession.mutate(
      { slotId: session.slot_id, reason: reason.trim() },
      {
        onSuccess: () => {
          toast.success(updatedMessage(session))
          onClose()
        },
        onError: err => toast.error(ptErrorMessage(err)),
      }
    )
  }

  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Annulla seduta</DialogTitle>
            <DialogDescription>
              {formatDay(session.date, 'EEEE d MMMM')} · {sessionLabel(session)}
            </DialogDescription>
          </DialogHeader>
          <p className="rounded-md bg-muted/50 px-3 py-2 text-sm">
            {started
              ? 'Gli addebiti di questa seduta verranno stornati con una rettifica nel wallet di ciascuno.'
              : 'Lo slot tornerà prenotabile da tutti con la capienza normale. Nessuno pagherà questa seduta.'}
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="void-reason">Motivo</Label>
            <Textarea
              id="void-reason"
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="Es. trainer assente"
              required
              autoFocus
            />
            {started && (
              <p className="text-xs text-muted-foreground">Il motivo comparirà nella rettifica di ciascuno.</p>
            )}
          </div>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>Indietro</DialogClose>
            <Button type="submit" variant="destructive" disabled={!reason.trim() || voidSession.isPending}>
              {voidSession.isPending ? 'Annullamento…' : 'Annulla seduta'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
