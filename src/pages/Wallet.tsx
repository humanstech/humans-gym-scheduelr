import { useMemo, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import { it } from 'date-fns/locale'
import { AlertTriangle, ChevronDown, Clock, Dumbbell } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { WalletLedger, type WalletEntryKind } from '@/components/pt/WalletLedger'
import { useMyBookings, isPtBooking, type Booking } from '@/hooks/useBookings'
import {
  isLowBalance,
  isPtMemberOn,
  useDayPreview,
  useMyWalletEntries,
  useNow,
  usePtStatus,
  type PtStatus,
} from '@/hooks/usePersonalTrainer'
import { formatEUR } from '@/lib/money'
import { cn } from '@/lib/utils'

type Filter = 'all' | 'charges' | 'topups'

const FILTERS: { value: Filter; label: string; kinds?: WalletEntryKind[] }[] = [
  { value: 'all', label: 'Tutti' },
  { value: 'charges', label: 'Addebiti', kinds: ['charge', 'adjustment'] },
  { value: 'topups', label: 'Ricariche', kinds: ['topup', 'manual'] },
]

function shortDate(date: string) {
  return format(parseISO(date), 'd MMM yyyy', { locale: it })
}

function membershipText(status: PtStatus) {
  const today = format(new Date(), 'yyyy-MM-dd')
  const { valid_from: from, valid_to: to } = status
  if (!from) return null
  if (to && to < today) return `Iscrizione terminata il ${shortDate(to)}`
  if (from > today) return to ? `Iscrizione dal ${shortDate(from)} al ${shortDate(to)}` : `Iscrizione dal ${shortDate(from)}`
  return to ? `Iscrizione dal ${shortDate(from)} al ${shortDate(to)}` : `Iscritto dal ${shortDate(from)}`
}

function BalanceCard({ status }: { status: PtStatus }) {
  const negative = status.balance_cents < 0
  const low = !negative && isLowBalance(status)
  return (
    <div className={cn('rounded-xl border bg-card p-5', negative && 'border-destructive/40 bg-destructive/5')}>
      <p className="text-sm text-muted-foreground">Saldo disponibile</p>
      <p className={cn('mt-1 text-4xl font-bold tracking-tight tabular-nums', negative && 'text-destructive')}>
        {formatEUR(status.balance_cents)}
      </p>
      {negative ? (
        <p className="mt-3 flex items-start gap-1.5 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          Saldo negativo: chiedi una ricarica a un amministratore
        </p>
      ) : low ? (
        <p className="mt-3 flex items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-800/50 dark:bg-amber-900/20 dark:text-amber-400">
          <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
          Saldo sotto {formatEUR(status.low_balance_threshold_cents)}: chiedi una ricarica a un amministratore
        </p>
      ) : null}
    </div>
  )
}

function UpcomingPtRow({ booking, isMember }: { booking: Booking; isMember: boolean }) {
  const slot = booking.slots!
  const { data: preview } = useDayPreview(slot.date, isMember)
  const row = preview?.[booking.slot_id]
  const quota = row && !row.day_closed && row.my_cents != null && row.my_cents > 0 ? row.my_cents : null
  return (
    <li className="flex items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium first-letter:uppercase">
          {format(parseISO(slot.date), 'EEEE d MMMM', { locale: it })}
        </p>
        <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Clock className="h-3 w-3" />
          {slot.start_time.slice(0, 5)} – {slot.end_time.slice(0, 5)}
          {slot.spaces?.name ? ` · ${slot.spaces.name}` : ''}
        </p>
      </div>
      {quota != null && (
        <div className="shrink-0 text-right">
          <p className="text-sm font-medium tabular-nums">{formatEUR(quota)}</p>
          <p className="text-[11px] text-muted-foreground">stima</p>
        </div>
      )}
    </li>
  )
}

function UpcomingPtSessions({ status }: { status: PtStatus }) {
  const { data: bookings, isLoading } = useMyBookings()
  const now = useNow()
  const upcoming = useMemo(() => {
    return (bookings ?? [])
      .filter(b => b.slots && isPtBooking(b) && new Date(`${b.slots.date}T${b.slots.start_time}`).getTime() > now)
      .slice(0, 5)
  }, [bookings, now])

  return (
    <section className="space-y-2">
      <h2 className="text-lg font-semibold">Prossime sedute PT</h2>
      {isLoading ? (
        <Skeleton className="h-16 w-full rounded-lg" />
      ) : upcoming.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          Nessuna seduta prenotata.{' '}
          {status.is_member && <Link to="/" className="font-medium text-foreground underline underline-offset-4">Prenota una seduta</Link>}
        </div>
      ) : (
        <ul className="divide-y rounded-lg border bg-card">
          {upcoming.map(b => (
            <UpcomingPtRow key={b.id} booking={b} isMember={isPtMemberOn(status, b.slots!.date)} />
          ))}
        </ul>
      )}
    </section>
  )
}

function HowItWorks({ status }: { status: PtStatus }) {
  const price = formatEUR(status.session_price_cents)
  return (
    <details className="group rounded-lg border bg-card">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
        Come si calcola la quota
        <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <ul className="list-disc space-y-1.5 px-4 pb-4 pl-8 text-sm text-muted-foreground">
        <li>Ogni seduta costa {price}.</li>
        <li>
          Se nella giornata c'è almeno una seduta con 3 o più presenze, il costo delle sedute svolte si divide
          tra i presenti (chi fa due sedute paga due quote).
        </li>
        <li>
          Altrimenti il costo di una seduta si divide tra tutti gli iscritti PT del giorno; le altre sedute
          svolte si dividono tra i presenti.
        </li>
        <li>Le sedute in più senza nessun iscritto sono gratuite.</li>
        <li>
          L'addebito arriva alla chiusura della giornata, dopo l'ultima seduta. Fino ad allora vedi solo una stima.
        </li>
        <li>Se un amministratore corregge una giornata già chiusa, la differenza compare come rettifica.</li>
      </ul>
    </details>
  )
}

export function Wallet() {
  // isPending (not isLoading): the query is disabled until auth resolves, and a
  // disabled query is not "loading", which would redirect before the status arrives.
  const { data: status, isPending } = usePtStatus()
  const visible = !!status && (status.is_member || status.ever_member)
  const { data: entries = [], isLoading: entriesLoading } = useMyWalletEntries(visible)
  const [filter, setFilter] = useState<Filter>('all')
  const activeFilter = FILTERS.find(f => f.value === filter)!

  if (isPending) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-32 w-full rounded-xl" />
        <Skeleton className="h-40 w-full rounded-lg" />
      </div>
    )
  }

  if (!visible) return <Navigate to="/" replace />

  const membership = membershipText(status)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Dumbbell className="h-6 w-6 text-violet-600 dark:text-violet-400" />
          Wallet Personal Trainer
        </h1>
        {membership && <p className="mt-1 text-muted-foreground">{membership}</p>}
      </div>

      <BalanceCard status={status} />

      <UpcomingPtSessions status={status} />

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Movimenti</h2>
          <div className="flex gap-1.5">
            {FILTERS.map(f => (
              <button
                key={f.value}
                onClick={() => setFilter(f.value)}
                aria-pressed={filter === f.value}
                className={cn(
                  'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                  filter === f.value
                    ? 'border-foreground bg-foreground text-background'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
        <WalletLedger
          entries={entries}
          loading={entriesLoading}
          kinds={activeFilter.kinds}
          emptyText={filter === 'all' ? 'Ancora nessun movimento' : 'Nessun movimento di questo tipo'}
        />
      </section>

      <HowItWorks status={status} />
    </div>
  )
}
