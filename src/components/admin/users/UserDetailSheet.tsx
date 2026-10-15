import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { WalletLedger } from '@/components/pt/WalletLedger'
import { useAdminUsers, useUserWallet } from '@/hooks/usePtAdmin'
import { displayName } from '@/components/admin/ptFormat'
import { UserAvatar } from './UserAvatar'
import { MembershipSection } from './MembershipSection'
import { WalletSection } from './WalletSection'

interface UserDetailSheetProps {
  userId: string | null
  onOpenChange: (open: boolean) => void
}

export function UserDetailSheet({ userId, onOpenChange }: UserDetailSheetProps) {
  // Keep the last user rendered while the sheet animates closed.
  const [shownId, setShownId] = useState(userId)
  if (userId && userId !== shownId) setShownId(userId)
  const { data: users = [], isLoading: usersLoading } = useAdminUsers()
  const { data: entries = [], isLoading: walletLoading } = useUserWallet(shownId)
  const user = users.find(u => u.user_id === shownId)

  return (
    <Sheet open={!!userId} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="gap-0 overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-lg"
      >
        <SheetHeader className="border-b pr-12">
          <SheetTitle>Dettaglio utente</SheetTitle>
          {user ? (
            <div className="mt-3 flex items-center gap-3">
              <UserAvatar name={user.full_name} email={user.email} avatarUrl={user.avatar_url} size="lg" />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="truncate font-medium">{displayName(user)}</span>
                  {user.is_admin && <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">Admin</Badge>}
                  {user.is_trainer && (
                    <Badge className="h-4 bg-violet-500/10 px-1.5 text-[10px] text-violet-700 dark:text-violet-300">Trainer</Badge>
                  )}
                </div>
                <SheetDescription className="truncate">{user.email}</SheetDescription>
              </div>
            </div>
          ) : usersLoading ? (
            <div className="mt-3 flex items-center gap-3">
              <Skeleton className="size-10 rounded-full" />
              <div className="space-y-1.5">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-44" />
              </div>
            </div>
          ) : (
            <SheetDescription>Utente non trovato.</SheetDescription>
          )}
        </SheetHeader>

        {user && (
          <div key={user.user_id} className="space-y-8 p-4">
            <MembershipSection userId={user.user_id} />
            <WalletSection
              userId={user.user_id}
              balanceCents={walletLoading ? user.balance_cents : entries.reduce((s, e) => s + e.amount_cents, 0)}
            />
            <section className="space-y-3">
              <h3 className="text-sm font-semibold">Movimenti</h3>
              <WalletLedger
                entries={entries}
                loading={walletLoading}
                emptyText="Nessun movimento nel wallet."
              />
            </section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
