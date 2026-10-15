import { TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatEUR } from '@/lib/money'
import { useLowBalances, usePtSettings } from '@/hooks/usePtAdmin'
import { displayName } from '@/components/admin/ptFormat'

export function LowBalanceBanner({ onView }: { onView: () => void }) {
  const { data: rows = [] } = useLowBalances()
  const { data: settings } = usePtSettings()
  if (rows.length === 0) return null

  const threshold = settings ? formatEUR(settings.low_balance_threshold_cents) : 'soglia'
  const top = rows.slice(0, 3)

  return (
    <div
      role="status"
      className="flex flex-col gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex gap-3">
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <div className="min-w-0 text-sm">
          <p className="font-medium text-amber-900 dark:text-amber-200">
            {rows.length === 1 ? '1 iscritto PT' : `${rows.length} iscritti PT`} con saldo sotto {threshold}
          </p>
          <p className="mt-0.5 text-amber-800/90 dark:text-amber-300/90">
            {top.map((r, i) => (
              <span key={r.user_id}>
                {i > 0 && ' · '}
                {displayName(r)} <span className="tabular-nums">{formatEUR(r.balance_cents)}</span>
              </span>
            ))}
            {rows.length > top.length && ` · e altri ${rows.length - top.length}`}
          </p>
        </div>
      </div>
      <Button size="sm" variant="outline" onClick={onView} className="self-start bg-background/60 sm:self-auto">
        Vedi
      </Button>
    </div>
  )
}
