import { useMemo } from 'react'
import { format, parseISO } from 'date-fns'
import { it } from 'date-fns/locale'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { formatEUR } from '@/lib/money'
import { cn } from '@/lib/utils'
import type { Tables } from '@/lib/database.types'

type WalletEntry = Tables<'pt_wallet_entries'>
export type WalletEntryKind = WalletEntry['kind']

const KIND_LABELS: Record<WalletEntryKind, string> = {
  topup: 'Ricarica',
  charge: 'Addebito',
  adjustment: 'Rettifica',
  manual: 'Correzione manuale',
}

// eslint-disable-next-line react-refresh/only-export-components
export function kindLabel(kind: WalletEntryKind): string {
  return KIND_LABELS[kind] ?? kind
}

const KIND_CLASSES: Record<WalletEntryKind, string> = {
  topup: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  charge: 'bg-secondary text-secondary-foreground',
  adjustment: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  manual: 'bg-sky-500/10 text-sky-700 dark:text-sky-300',
}

/** "+50,00 €" / "−13,33 €" (typographic minus). */
// eslint-disable-next-line react-refresh/only-export-components
export function formatSignedEUR(cents: number): string {
  if (cents === 0) return formatEUR(0)
  return `${cents > 0 ? '+' : '−'}${formatEUR(Math.abs(cents))}`
}

interface WalletLedgerProps {
  entries: WalletEntry[]
  loading?: boolean
  emptyText?: string
  /** Show only these kinds; the running balance is still computed from all entries. */
  kinds?: WalletEntryKind[]
}

export function WalletLedger({ entries, loading, emptyText = 'Nessun movimento', kinds }: WalletLedgerProps) {
  const groups = useMemo(() => {
    // Newest first; balance after each movement = sum of it and everything older.
    const sorted = [...entries].sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0))
    const balances: number[] = new Array(sorted.length)
    let running = 0
    for (let i = sorted.length - 1; i >= 0; i--) {
      running += sorted[i].amount_cents
      balances[i] = running
    }

    const result: { key: string; label: string; rows: { entry: WalletEntry; balance: number }[] }[] = []
    sorted.forEach((entry, i) => {
      if (kinds && !kinds.includes(entry.kind)) return
      const date = parseISO(entry.created_at)
      const key = format(date, 'yyyy-MM')
      let group = result[result.length - 1]
      if (!group || group.key !== key) {
        group = { key, label: format(date, 'LLLL yyyy', { locale: it }), rows: [] }
        result.push(group)
      }
      group.rows.push({ entry, balance: balances[i] })
    })
    return result
  }, [entries, kinds])

  if (loading) {
    return (
      <div className="space-y-2">
        {[0, 1, 2].map(i => <Skeleton key={i} className="h-16 w-full" />)}
      </div>
    )
  }

  if (groups.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        {emptyText}
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {groups.map(group => (
        <section key={group.key}>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {group.label}
          </h3>
          <ul className="divide-y rounded-lg border bg-card">
            {group.rows.map(({ entry, balance }) => {
              const date = parseISO(entry.created_at)
              return (
                <li key={entry.id} className="flex items-start justify-between gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <Badge className={cn('mb-1', KIND_CLASSES[entry.kind])}>{kindLabel(entry.kind)}</Badge>
                    <p className="text-sm font-medium leading-snug break-words">{entry.description}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {format(date, 'd MMM yyyy · HH:mm', { locale: it })}
                      {entry.created_by_name ? ` · da ${entry.created_by_name}` : ''}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p
                      className={cn(
                        'text-sm font-semibold tabular-nums',
                        entry.amount_cents > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-foreground'
                      )}
                    >
                      {formatSignedEUR(entry.amount_cents)}
                    </p>
                    <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">
                      Saldo {formatEUR(balance)}
                    </p>
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}
