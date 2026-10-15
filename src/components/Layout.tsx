import { type ReactNode, useMemo } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Calendar, Dumbbell, LayoutDashboard, ShieldCheck, LogOut, Wallet } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { useAuth } from '@/hooks/useAuth'
import { useIsAdmin } from '@/hooks/useIsAdmin'
import { useTrainerMode } from '@/hooks/useRoles'
import { isLowBalance, usePtStatus } from '@/hooks/usePersonalTrainer'
import { formatEUR } from '@/lib/money'
import { LegalLinks } from '@/components/LegalLinks'
import { cn } from '@/lib/utils'

interface LayoutProps {
  children: ReactNode
}

export function Layout({ children }: LayoutProps) {
  const { user, signOut } = useAuth()
  const { data: isAdmin } = useIsAdmin(user?.email)
  const { isTrainerOnly } = useTrainerMode()
  const { data: ptStatus } = usePtStatus()
  const location = useLocation()

  const showWallet = !isTrainerOnly && !!ptStatus && (ptStatus.is_member || ptStatus.ever_member)

  const navLinks = useMemo(() => isTrainerOnly
    ? [{ to: '/', label: 'Sedute', icon: Dumbbell }]
    : [
        { to: '/', label: 'Dashboard', icon: LayoutDashboard },
        { to: '/my-bookings', label: 'Le mie prenotazioni', icon: Calendar },
        ...(showWallet ? [{ to: '/wallet', label: 'Wallet', icon: Wallet }] : []),
        ...(isAdmin ? [{ to: '/admin', label: 'Admin', icon: ShieldCheck }] : []),
      ], [isAdmin, isTrainerOnly, showWallet])

  const navigate = useNavigate()
  const initials = user?.user_metadata?.full_name
    ? (user.user_metadata.full_name as string)
        .split(' ')
        .slice(0, 2)
        .map((n: string) => n[0])
        .join('')
        .toUpperCase()
    : user?.email?.[0]?.toUpperCase() ?? '?'

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <div className="flex items-center gap-6">
            <Link to="/" className="flex items-center gap-2 font-semibold">
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground text-sm font-black">
                G
              </div>
              <span>Gym</span>
            </Link>
            <nav className="hidden items-center gap-1 sm:flex">
              {navLinks.map(({ to, label, icon: Icon }) => (
                <Link key={to} to={to}>
                  <Button
                    variant={location.pathname === to ? 'secondary' : 'ghost'}
                    size="sm"
                    className={cn(
                      'gap-2',
                      location.pathname === to && 'font-medium'
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {label}
                  </Button>
                </Link>
              ))}
            </nav>
          </div>

          <div className="flex items-center gap-2">
            {showWallet && ptStatus && (
              <Link
                to="/wallet"
                aria-label={`Saldo wallet ${formatEUR(ptStatus.balance_cents)}`}
                className={cn(
                  'rounded-full border px-2.5 py-1 text-xs font-semibold tabular-nums transition-colors hover:bg-muted',
                  isLowBalance(ptStatus) && 'border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/15'
                )}
              >
                {formatEUR(ptStatus.balance_cents)}
              </Link>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger className="relative h-9 w-9 rounded-full p-0 border-0 bg-transparent cursor-pointer">
                <Avatar className="h-9 w-9">
                  <AvatarImage
                    src={user?.user_metadata?.avatar_url as string | undefined}
                    alt={user?.user_metadata?.full_name as string | undefined}
                    referrerPolicy="no-referrer"
                  />
                  <AvatarFallback>{initials}</AvatarFallback>
                </Avatar>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <div className="px-2 py-1.5">
                  <p className="text-sm font-medium leading-none">
                    {(user?.user_metadata?.full_name as string) ?? 'Utente'}
                  </p>
                  <p className="mt-1 text-xs leading-none text-muted-foreground">
                    {user?.email}
                  </p>
                </div>
                <DropdownMenuSeparator />
                <div className="flex flex-col gap-0.5 sm:hidden">
                  {navLinks.map(({ to, label, icon: Icon }) => (
                    <DropdownMenuItem key={to} onClick={() => navigate(to)}>
                      <Icon className="h-4 w-4" />
                      {label}
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                </div>
                <DropdownMenuItem
                  onClick={signOut}
                  className="cursor-pointer text-destructive focus:text-destructive"
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  Esci
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 pt-8 pb-24 sm:pb-12">
        {children}
      </main>
      <div className="px-4 pb-6"><LegalLinks /></div>
    </div>
  )
}
