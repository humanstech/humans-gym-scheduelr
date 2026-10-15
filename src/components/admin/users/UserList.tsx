import type React from 'react'
import { formatDistanceToNow, parseISO } from 'date-fns'
import { it } from 'date-fns/locale'
import { ChevronRight } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { formatEUR } from '@/lib/money'
import type { AdminUser } from '@/hooks/usePtAdmin'
import { balanceTone, displayName, isEverMember, ptStatusLabel } from '@/components/admin/ptFormat'
import { UserAvatar } from './UserAvatar'

interface UserListProps {
  users: AdminUser[]
  threshold: number | undefined
  onOpenUser: (userId: string) => void
}

function lastAccess(user: AdminUser): string {
  if (!user.last_sign_in_at) return 'Mai'
  return formatDistanceToNow(parseISO(user.last_sign_in_at), { addSuffix: true, locale: it })
}

function RoleBadges({ user }: { user: AdminUser }) {
  if (!user.is_admin && !user.is_trainer) return null
  return (
    <span className="inline-flex gap-1">
      {user.is_admin && <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">Admin</Badge>}
      {user.is_trainer && (
        <Badge className="h-4 bg-violet-500/10 px-1.5 text-[10px] text-violet-700 dark:text-violet-300">Trainer</Badge>
      )}
    </span>
  )
}

function PtStatus({ user }: { user: AdminUser }) {
  const label = ptStatusLabel(user)
  if (!label) return <span className="text-muted-foreground">—</span>
  return (
    <span className={cn(user.pt_active ? 'text-foreground' : 'text-muted-foreground')}>
      {user.pt_active && <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-violet-500 align-middle" aria-hidden />}
      {label}
    </span>
  )
}

function Balance({ user, threshold }: { user: AdminUser; threshold: number | undefined }) {
  if (!isEverMember(user)) return <span className="text-muted-foreground">—</span>
  return (
    <span className={cn('font-medium tabular-nums', balanceTone(user.balance_cents, threshold))}>
      {formatEUR(user.balance_cents)}
    </span>
  )
}

export function UserList({ users, threshold, onOpenUser }: UserListProps) {
  const onKey = (userId: string) => (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onOpenUser(userId)
    }
  }

  return (
    <>
      {/* Desktop */}
      <div className="hidden rounded-lg border md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Utente</TableHead>
              <TableHead>Ultimo accesso</TableHead>
              <TableHead>Personal trainer</TableHead>
              <TableHead className="text-right">Saldo</TableHead>
              <TableHead className="w-8"><span className="sr-only">Apri</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map(u => (
              <TableRow
                key={u.user_id}
                tabIndex={0}
                role="button"
                aria-label={`Apri dettaglio di ${displayName(u)}`}
                onClick={() => onOpenUser(u.user_id)}
                onKeyDown={onKey(u.user_id)}
                className="cursor-pointer focus-visible:bg-muted/50 focus-visible:outline-none"
              >
                <TableCell>
                  <div className="flex items-center gap-3">
                    <UserAvatar name={u.full_name} email={u.email} avatarUrl={u.avatar_url} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium">{displayName(u)}</span>
                        <RoleBadges user={u} />
                      </div>
                      <p className="truncate text-xs text-muted-foreground">{u.email}</p>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground">{lastAccess(u)}</TableCell>
                <TableCell><PtStatus user={u} /></TableCell>
                <TableCell className="text-right"><Balance user={u} threshold={threshold} /></TableCell>
                <TableCell><ChevronRight className="h-4 w-4 text-muted-foreground" /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Mobile */}
      <ul className="divide-y rounded-lg border bg-card md:hidden">
        {users.map(u => (
          <li key={u.user_id}>
            <button
              type="button"
              onClick={() => onOpenUser(u.user_id)}
              className="flex w-full items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-accent/40"
            >
              <UserAvatar name={u.full_name} email={u.email} avatarUrl={u.avatar_url} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{displayName(u)}</span>
                  <RoleBadges user={u} />
                </div>
                <p className="truncate text-xs text-muted-foreground">{u.email}</p>
                <p className="mt-1 text-xs"><PtStatus user={u} /></p>
              </div>
              <div className="shrink-0 text-right text-sm">
                <Balance user={u} threshold={threshold} />
                <p className="mt-0.5 text-[11px] text-muted-foreground">{lastAccess(u)}</p>
              </div>
            </button>
          </li>
        ))}
      </ul>
    </>
  )
}
