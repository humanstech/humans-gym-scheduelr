import { Link } from 'react-router-dom'
import { Wallet } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useMyTrainerWallet } from '@/hooks/useTrainerWallet'
import { formatEUR } from '@/lib/money'
import { format, parseISO } from 'date-fns'
import { it } from 'date-fns/locale'

const KINDS = { earning: 'Compenso', adjustment: 'Rettifica', payment: 'Pagamento ricevuto', payment_reversal: 'Storno pagamento' }
const METHODS = { bank_transfer: 'Bonifico', cash: 'Contanti', other: 'Altro' }

export function MyTrainerWallet({ compact = false }: { compact?: boolean }) {
  const { data, isPending, isError, refetch } = useMyTrainerWallet()
  const reversed = new Set(data?.entries.map(e => e.reverses_entry_id).filter(Boolean))

  return (
    <section aria-label="Il tuo wallet PT" className="space-y-4 rounded-xl border bg-card p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold"><Wallet className="h-5 w-5" />Il tuo wallet PT</h2>
        {compact && <Link to="/trainer-wallet" className="text-sm font-medium text-primary underline-offset-4 hover:underline">Vedi movimenti</Link>}
      </div>
      <p className="text-sm text-muted-foreground">Il compenso matura alla fine di ogni seduta non annullata. I pagamenti sono registrati dalla cassa.</p>
      {isError ? (
        <div role="alert" className="space-y-2">
          <p className="text-sm text-destructive">Impossibile caricare il wallet.</p>
          <Button variant="outline" size="sm" onClick={() => void refetch()}>Riprova</Button>
        </div>
      ) : isPending ? (
        <div role="status" aria-label="Caricamento wallet" className="grid gap-3 sm:grid-cols-3">
          {[0, 1, 2].map(i => <Skeleton key={i} className="h-24 rounded-lg" />)}
        </div>
      ) : data && (
        <>
          <dl className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg bg-muted/40 p-4"><dt className="text-sm text-muted-foreground">Maturato</dt><dd className="mt-1 text-2xl font-semibold tabular-nums">{formatEUR(data.earned_cents)}</dd></div>
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-4"><dt className="text-sm text-muted-foreground">{data.balance_cents < 0 ? 'Anticipo ricevuto' : 'Da ricevere'}</dt><dd className="mt-1 text-2xl font-semibold tabular-nums">{formatEUR(Math.abs(data.balance_cents))}</dd></div>
            <div className="rounded-lg bg-muted/40 p-4"><dt className="text-sm text-muted-foreground">Ricevuto</dt><dd className="mt-1 text-2xl font-semibold tabular-nums">{formatEUR(data.paid_cents)}</dd></div>
          </dl>
          {!compact && (
            <div className="space-y-3">
              <h3 className="font-semibold">Movimenti</h3>
              <p className="text-xs text-muted-foreground">Compensi e rettifiche aggiornano il maturato; pagamenti e storni aggiornano il ricevuto. Il saldo tiene conto di tutti i movimenti.</p>
              {data.entries.length === 0 ? <p className="text-sm text-muted-foreground">Nessun movimento registrato.</p> : (
                <ul className="divide-y rounded-lg border">
                  {data.entries.map(entry => (
                    <li key={entry.id} className="space-y-1 p-3 text-sm">
                      <div className="flex justify-between gap-2"><span className="font-medium">{KINDS[entry.kind]}</span><span className="shrink-0 font-semibold tabular-nums">{entry.amount_cents > 0 ? '+' : '−'}{formatEUR(Math.abs(entry.amount_cents))}</span></div>
                      <p className="break-words">{entry.description}</p>
                      {entry.space_name && <p className="text-xs text-muted-foreground">{entry.space_name}</p>}
                      <p className="text-xs text-muted-foreground">{format(parseISO(entry.occurred_on), 'd MMM yyyy', { locale: it })}{entry.payment_method && ` · ${METHODS[entry.payment_method]}`}</p>
                      {entry.kind === 'payment' && reversed.has(entry.id) && <p className="text-xs text-muted-foreground">Pagamento stornato</p>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </section>
  )
}
