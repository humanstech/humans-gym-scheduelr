import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useRecordTrainerPayment, useReverseTrainerPayment, useTrainerAccounts, useTrainerWallet, type TrainerWalletEntry } from '@/hooks/useTrainerWallet'
import { ptErrorMessage } from '@/hooks/usePtAdmin'
import { formatEUR, parseEURToCents } from '@/lib/money'
import { formatDay, todayISO } from '@/components/admin/ptFormat'

const KINDS = { earning: 'Compenso', adjustment: 'Rettifica', payment: 'Pagamento', payment_reversal: 'Storno pagamento' }
const METHODS = { bank_transfer: 'Bonifico', cash: 'Contanti', other: 'Altro' }
const selectClass = 'h-9 w-full rounded-md border border-input bg-background px-3 text-sm'

export function TrainerWalletSheet({ trainerId, onClose }: { trainerId: string; onClose: () => void }) {
  const { data: accounts = [] } = useTrainerAccounts()
  const { data: entries = [], isLoading, isError } = useTrainerWallet(trainerId)
  const trainer = accounts.find(t => t.trainer_id === trainerId)
  const record = useRecordTrainerPayment()
  const reverse = useReverseTrainerPayment()
  const [amount, setAmount] = useState('')
  const [paidOn, setPaidOn] = useState(todayISO())
  const [method, setMethod] = useState('bank_transfer')
  const [note, setNote] = useState('')
  const [reversing, setReversing] = useState<TrainerWalletEntry | null>(null)
  const [reason, setReason] = useState('')
  const request = useRef<{ signature: string; id: string } | null>(null)
  const cents = parseEURToCents(amount)
  const valid = cents !== null && cents > 0 && paidOn && paidOn <= todayISO() && note.trim()
  const reversed = new Set(entries.map(e => e.reverses_entry_id).filter(Boolean))
  const earned = entries.filter(e => e.kind === 'earning' || e.kind === 'adjustment').reduce((sum, e) => sum + e.amount_cents, 0)
  const paid = -entries.filter(e => e.kind === 'payment' || e.kind === 'payment_reversal').reduce((sum, e) => sum + e.amount_cents, 0)
  const balance = earned - paid

  return (
    <Sheet open onOpenChange={open => { if (!open && !record.isPending && !reverse.isPending) onClose() }}>
      <SheetContent className="overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Conto trainer</SheetTitle>
          <SheetDescription className="break-all">{trainer?.email}</SheetDescription>
        </SheetHeader>
        <div className="space-y-6 px-4 pb-6">
          {!isLoading && !isError && <dl className="grid grid-cols-3 gap-2 rounded-lg bg-muted/40 p-3 text-sm">
            <div><dt className="text-xs text-muted-foreground">Maturato</dt><dd className="mt-1 font-semibold tabular-nums">{formatEUR(earned)}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Pagato</dt><dd className="mt-1 font-semibold tabular-nums">{formatEUR(paid)}</dd></div>
            <div><dt className="text-xs text-muted-foreground">{balance < 0 ? 'Anticipo disponibile' : 'Da pagare'}</dt><dd className="mt-1 font-semibold tabular-nums">{formatEUR(Math.abs(balance))}</dd></div>
          </dl>}
          <form className="space-y-3 rounded-lg border p-3" onSubmit={e => {
            e.preventDefault()
            if (!valid || record.isPending) return
            const args = { trainer_id: trainerId, amount_cents: cents!, paid_on: paidOn, payment_method: method, note: note.trim() }
            const signature = JSON.stringify(args)
            if (request.current?.signature !== signature) request.current = { signature, id: crypto.randomUUID() }
            record.mutate({ ...args, request_id: request.current.id }, {
              onSuccess: () => { request.current = null; setAmount(''); setNote(''); toast.success('Pagamento registrato') },
              onError: e => toast.error(ptErrorMessage(e, 'Impossibile registrare il pagamento. Riprova.')),
            })
          }}>
            <h3 className="text-sm font-semibold">Registra pagamento della cassa</h3>
            <p className="text-xs text-muted-foreground">Registra un versamento già effettuato. Può coprire più sedute o essere un anticipo; non viene disposto alcun trasferimento di denaro.</p>
            <fieldset disabled={record.isPending} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <label className="space-y-1 text-xs"><span>Importo (€)</span><Input inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} required /></label>
                <label className="space-y-1 text-xs"><span>Data pagamento</span><Input type="date" max={todayISO()} value={paidOn} onChange={e => setPaidOn(e.target.value)} required /></label>
              </div>
              <label className="block space-y-1 text-xs"><span>Metodo</span><select className={selectClass} value={method} onChange={e => setMethod(e.target.value)}>{Object.entries(METHODS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label className="block space-y-1 text-xs"><span>Nota o riferimento</span><Textarea value={note} onChange={e => setNote(e.target.value)} placeholder="Es. Bonifico sedute di ottobre, riferimento…" required /></label>
              <Button type="submit" disabled={!valid || record.isPending}>{record.isPending ? 'Registrazione…' : 'Registra pagamento'}</Button>
            </fieldset>
          </form>
          <section className="space-y-3">
            <h3 className="text-sm font-semibold">Movimenti</h3>
            {isLoading ? <p className="text-sm text-muted-foreground">Caricamento…</p> : isError ? <p role="alert" className="text-sm text-destructive">Impossibile caricare i movimenti. Riprova.</p> : entries.length === 0 ? <p className="text-sm text-muted-foreground">Nessun movimento registrato.</p> : (
              <ul className="divide-y rounded-lg border">
                {entries.map(entry => <li key={entry.id} className="space-y-1 p-3 text-sm">
                  <div className="flex justify-between gap-2"><span className="font-medium">{KINDS[entry.kind]}</span><span className="shrink-0 font-semibold tabular-nums">{entry.amount_cents > 0 ? '+' : '−'}{formatEUR(Math.abs(entry.amount_cents))}</span></div>
                  <p className="break-words text-xs">{entry.description}</p>
                  {entry.space_name && <p className="text-xs text-muted-foreground">{entry.space_name}</p>}
                  <p className="text-xs text-muted-foreground">{formatDay(entry.occurred_on, 'd MMM yyyy')}{entry.payment_method && ` · ${METHODS[entry.payment_method]}`}{entry.created_by_name && ` · ${entry.created_by_name}`}</p>
                  {entry.kind === 'payment' && (reversed.has(entry.id)
                    ? <p className="text-xs text-muted-foreground">Pagamento stornato</p>
                    : <Button size="sm" variant="ghost" onClick={() => { setReversing(entry); setReason('') }}>Storna pagamento</Button>)}
                </li>)}
              </ul>
            )}
          </section>
        </div>
        <Dialog open={!!reversing} onOpenChange={open => { if (!open && !reverse.isPending) setReversing(null) }}>
          <DialogContent>
            <DialogHeader><DialogTitle>Storna pagamento</DialogTitle><DialogDescription>Il pagamento resta nello storico. Lo storno ripristina il saldo per {formatEUR(Math.abs(reversing?.amount_cents ?? 0))}.</DialogDescription></DialogHeader>
            <label className="space-y-1 text-sm"><span>Motivo dello storno</span><Textarea value={reason} onChange={e => setReason(e.target.value)} /></label>
            <DialogFooter>
              <Button variant="outline" disabled={reverse.isPending} onClick={() => setReversing(null)}>Annulla</Button>
              <Button disabled={!reason.trim() || reverse.isPending} onClick={() => reversing && reverse.mutate({ entry_id: reversing.id, reason: reason.trim() }, {
                onSuccess: () => { setReversing(null); toast.success('Pagamento stornato') },
                onError: e => toast.error(ptErrorMessage(e)),
              })}>{reverse.isPending ? 'Salvataggio…' : 'Conferma storno'}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </SheetContent>
    </Sheet>
  )
}
