import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { useAdminUsers, usePtSettings, type AdminUser } from '@/hooks/usePtAdmin'
import { isEverMember } from '@/components/admin/ptFormat'
import { UserList } from './UserList'

type Filter = 'all' | 'pt' | 'low'

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'Tutti' },
  { value: 'pt', label: 'Iscritti PT' },
  { value: 'low', label: 'Saldo basso' },
]

export function UsersTab({ onOpenUser }: { onOpenUser: (userId: string) => void }) {
  const { data: users = [], isLoading, isError } = useAdminUsers()
  const { data: settings } = usePtSettings()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const threshold = settings?.low_balance_threshold_cents

  const isLow = (u: AdminUser) =>
    isEverMember(u) && threshold !== undefined && u.balance_cents < threshold

  const counts = useMemo(() => ({
    all: users.length,
    pt: users.filter(u => u.pt_active).length,
    low: users.filter(u => isEverMember(u) && threshold !== undefined && u.balance_cents < threshold).length,
  }), [users, threshold])

  const q = query.trim().toLowerCase()
  const visible = users
    .filter(u => filter === 'all' || (filter === 'pt' ? u.pt_active : isLow(u)))
    .filter(u => !q || (u.full_name ?? '').toLowerCase().includes(q) || u.email.toLowerCase().includes(q))
    .sort((a, b) => (a.full_name || a.email).localeCompare(b.full_name || b.email, 'it'))

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative sm:w-72">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <label htmlFor="user-search" className="sr-only">Cerca per nome o email</label>
          <Input
            id="user-search"
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Cerca per nome o email"
            className="pl-8"
          />
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtra utenti">
          {FILTERS.map(f => (
            <button
              key={f.value}
              type="button"
              aria-pressed={filter === f.value}
              onClick={() => setFilter(f.value)}
              className={cn(
                'inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors',
                filter === f.value
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-input bg-background text-muted-foreground hover:bg-accent hover:text-foreground'
              )}
            >
              {f.label}
              {!isLoading && (
                <span className={cn('tabular-nums', filter === f.value ? 'opacity-80' : 'opacity-60')}>
                  {counts[f.value]}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3, 4].map(i => <Skeleton key={i} className="h-14 w-full" />)}
        </div>
      ) : isError ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          Non è stato possibile caricare gli utenti. Riprova tra poco.
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          {q ? `Nessun utente corrisponde a “${query.trim()}”.` : 'Nessun utente in questo filtro.'}
        </div>
      ) : (
        <UserList users={visible} threshold={threshold} onOpenUser={onOpenUser} />
      )}

      <p className="text-xs text-muted-foreground">
        Compaiono gli utenti che hanno effettuato almeno un accesso.
      </p>
    </div>
  )
}
