import { TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { formatEUR } from '@/lib/money'
import { useLowBalances, usePtSettings } from '@/hooks/usePtAdmin'
import { balanceTone, displayName } from '@/components/admin/ptFormat'
import { UserAvatar } from '@/components/admin/users/UserAvatar'

export function LowBalanceCard({ onOpenUser }: { onOpenUser: (userId: string) => void }) {
  const { data: rows = [], isLoading } = useLowBalances()
  const { data: settings } = usePtSettings()
  const threshold = settings?.low_balance_threshold_cents

  return (
    <section className="space-y-3">
      <div>
        <div className="flex items-center gap-2">
          <TriangleAlert className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          <h3 className="font-semibold">Saldo basso</h3>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {threshold !== undefined
            ? `Iscritti con saldo sotto ${formatEUR(threshold)}, dal più basso.`
            : 'Iscritti con saldo sotto la soglia, dal più basso.'}
        </p>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[0, 1].map(i => <Skeleton key={i} className="h-12 w-full" />)}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          Tutti gli iscritti hanno credito sufficiente.
        </div>
      ) : (
        <ul className="divide-y rounded-lg border bg-background">
          {rows.map(r => (
            <li key={r.user_id} className="flex items-center gap-3 px-3 py-2.5">
              <UserAvatar name={r.full_name} email={r.email} avatarUrl={r.avatar_url} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{displayName(r)}</p>
                {!r.pt_active && <p className="text-xs text-muted-foreground">Iscrizione terminata</p>}
              </div>
              <span className={cn('text-sm font-semibold tabular-nums', balanceTone(r.balance_cents, threshold))}>
                {formatEUR(r.balance_cents)}
              </span>
              <Button size="sm" variant="outline" onClick={() => onOpenUser(r.user_id)}>
                Ricarica
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
