import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ptErrorMessage, type AdminSession } from '@/hooks/usePtAdmin'
import { useSetSessionTrainer, useTrainerAccounts } from '@/hooks/useTrainerWallet'
import { parseEURToCents } from '@/lib/money'
import { sessionLabel } from './sessionUtils'
import { SessionTrainerFields } from './SessionTrainerFields'

export function SessionTrainerDialog({ session, onClose }: { session: AdminSession; onClose: () => void }) {
  const { data: trainers = [] } = useTrainerAccounts()
  const save = useSetSessionTrainer()
  const [trainerId, setTrainerId] = useState(session.trainer?.trainer_id ?? '')
  const [fee, setFee] = useState(session.trainer ? String(session.trainer.fee_cents / 100) : '')
  const [reason, setReason] = useState('')
  const cents = parseEURToCents(fee)
  return (
    <Dialog open onOpenChange={open => { if (!open && !save.isPending) onClose() }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Trainer e compenso</DialogTitle><DialogDescription>{sessionLabel(session)}. Se la seduta è terminata e non è annullata, il saldo del trainer viene aggiornato. Le rettifiche restano nello storico.</DialogDescription></DialogHeader>
        <SessionTrainerFields trainers={trainers} trainerId={trainerId} fee={fee} onTrainerChange={setTrainerId} onFeeChange={setFee} />
        <label className="space-y-1 text-sm"><span>Motivo dell’assegnazione o modifica</span><Textarea value={reason} onChange={e => setReason(e.target.value)} /></label>
        <DialogFooter>
          <Button variant="outline" disabled={save.isPending} onClick={onClose}>Annulla</Button>
          <Button disabled={!trainerId || cents === null || cents < 0 || !reason.trim() || save.isPending} onClick={() => save.mutate({ slot_id: session.slot_id, trainer_id: trainerId, fee_cents: cents!, reason: reason.trim() }, {
            onSuccess: () => { toast.success('Trainer e compenso aggiornati'); onClose() },
            onError: e => toast.error(ptErrorMessage(e)),
          })}>{save.isPending ? 'Salvataggio…' : 'Salva assegnazione'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
