import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { format, subDays } from 'date-fns'
import type React from 'react'
import { ShieldCheck, Users, TrendingUp } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { BookingsTable } from '@/components/admin/BookingsTable'
import { UsageChart } from '@/components/admin/UsageChart'
import { UserChart } from '@/components/admin/UserChart'
import { ExportButton } from '@/components/admin/ExportButton'
import { AccessControl } from '@/components/admin/AccessControl'
import { Spaces } from '@/components/admin/Spaces'
import { SpaceComparisonChart } from '@/components/admin/SpaceComparisonChart'
import { UsersTab } from '@/components/admin/users/UsersTab'
import { UserDetailSheet } from '@/components/admin/users/UserDetailSheet'
import { PtTab } from '@/components/admin/pt/PtTab'
import { LowBalanceBanner } from '@/components/admin/pt/LowBalanceBanner'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { useAdminBookings } from '@/hooks/useAdminBookings'

export interface AdminBooking {
  id: string
  slot_id: string
  user_id: string
  user_email: string
  user_name: string
  user_avatar_url: string | null
  created_at: string | null
  slots: {
    date: string
    start_time: string
    end_time: string
    space_id: string
    spaces: { name: string } | null
  } | null
}

interface SpaceOption {
  id: string
  name: string
}

function useSpaces() {
  return useQuery({
    queryKey: ['spaces', 'all'],
    queryFn: async (): Promise<SpaceOption[]> => {
      const { data } = await supabase
        .from('spaces')
        .select('id, name')
        .eq('is_active', true)
        .order('created_at')
      return (data ?? []) as SpaceOption[]
    },
    staleTime: 60 * 1000,
  })
}

const TABS = ['statistiche', 'spazi', 'utenti', 'pt', 'accessi'] as const
type AdminTab = (typeof TABS)[number]

const isAdminTab = (v: string | null): v is AdminTab => TABS.includes(v as AdminTab)

const RANGES = [
  { label: 'Ultimi 7 giorni', days: 7 },
  { label: 'Ultimi 30 giorni', days: 30 },
  { label: 'Ultimi 90 giorni', days: 90 },
]

function StatCard({ icon: Icon, label, value }: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string | number
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="h-4 w-4" />
        <span className="text-sm">{label}</span>
      </div>
      <p className="mt-2 text-2xl font-bold">{value}</p>
    </div>
  )
}

export function Admin() {
  const [searchParams, setSearchParams] = useSearchParams()
  const tabParam = searchParams.get('tab')
  const tab: AdminTab = isAdminTab(tabParam) ? tabParam : 'statistiche'
  const setTab = (next: AdminTab) => {
    setSearchParams(prev => {
      const params = new URLSearchParams(prev)
      if (next === 'statistiche') params.delete('tab')
      else params.set('tab', next)
      return params
    }, { replace: true })
  }
  const [openUserId, setOpenUserId] = useState<string | null>(null)
  const [rangeDays, setRangeDays] = useState(7)
  const [spaceId, setSpaceId] = useState<string | undefined>(undefined)
  // Stable date string — no milliseconds, queryKey doesn't change on every render
  const from = format(subDays(new Date(), rangeDays - 1), 'yyyy-MM-dd')
  const { data: bookings = [], isLoading } = useAdminBookings(from, spaceId)
  const { data: spaces = [] } = useSpaces()

  const uniqueUsers = new Set(bookings.map(b => b.user_id)).size
  const avgPerSlot =
    bookings.length > 0
      ? (bookings.length / new Set(bookings.map(b => b.slot_id)).size).toFixed(1)
      : '0'

  const showAllSpaces = !spaceId && spaces.length > 1

  // Per-space breakdown (only when "Tutti gli spazi" is active)
  const spaceStats = showAllSpaces
    ? spaces.map(space => {
        const sb = bookings.filter(b => b.slots?.space_id === space.id)
        const slotIds = new Set(sb.map(b => b.slot_id))
        const utilization = slotIds.size > 0 ? (sb.length / slotIds.size).toFixed(1) : '0'
        return {
          id: space.id,
          name: space.name,
          bookings: sb.length,
          users: new Set(sb.map(b => b.user_id)).size,
          utilization,
        }
      })
    : []

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            <h1 className="text-2xl font-bold">Area Admin</h1>
          </div>
          <p className="mt-1 text-muted-foreground">Gestione spazi aziendali</p>
        </div>
      </div>

      <LowBalanceBanner onView={() => setTab('pt')} />

      <Tabs value={tab} onValueChange={value => setTab(value as AdminTab)}>
        <TabsList variant="line">
          <TabsTrigger value="statistiche">Statistiche</TabsTrigger>
          <TabsTrigger value="spazi">Spazi</TabsTrigger>
          <TabsTrigger value="utenti">Utenti</TabsTrigger>
          <TabsTrigger value="pt">
            <span className="sm:hidden">PT</span>
            <span className="hidden sm:inline">Personal trainer</span>
          </TabsTrigger>
          <TabsTrigger value="accessi">Accessi</TabsTrigger>
        </TabsList>

        <TabsContent value="statistiche" className="space-y-6 pt-6">
          <div className="flex flex-wrap items-center justify-end gap-2">
            {spaces.length > 1 && (
              <select
                value={spaceId ?? ''}
                onChange={e => setSpaceId(e.target.value || undefined)}
                className="rounded-lg border bg-background px-3 py-1.5 text-sm"
              >
                <option value="">Tutti gli spazi</option>
                {spaces.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            )}
            <div className="flex rounded-lg border overflow-hidden">
              {RANGES.map(r => (
                <button
                  key={r.days}
                  onClick={() => setRangeDays(r.days)}
                  className={`px-3 py-1.5 text-sm transition-colors ${
                    rangeDays === r.days
                      ? 'bg-primary text-primary-foreground'
                      : 'hover:bg-accent'
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
            {!isLoading && <ExportButton bookings={bookings} />}
          </div>

          {isLoading ? (
            <div className="grid gap-4 sm:grid-cols-3">
              {[0, 1, 2].map(i => <Skeleton key={i} className="h-24 rounded-lg" />)}
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-3">
              <StatCard icon={Users} label="Totale prenotazioni" value={bookings.length} />
              <StatCard icon={Users} label="Utenti unici" value={uniqueUsers} />
              <StatCard icon={TrendingUp} label="Media per slot" value={avgPerSlot} />
            </div>
          )}

          {showAllSpaces && (
            <div className="space-y-2">
              <h2 className="font-semibold">Confronto spazi</h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {spaceStats.map(s => (
                  <div key={s.id} className="rounded-lg border bg-card p-4">
                    <p className="text-sm font-medium text-muted-foreground">{s.name}</p>
                    <div className="mt-2 flex gap-6">
                      <div>
                        <p className="text-2xl font-bold">{s.bookings}</p>
                        <p className="text-xs text-muted-foreground">prenotazioni</p>
                      </div>
                      <div>
                        <p className="text-2xl font-bold">{s.users}</p>
                        <p className="text-xs text-muted-foreground">utenti</p>
                      </div>
                      <div>
                        <p className="text-2xl font-bold">{s.utilization}</p>
                        <p className="text-xs text-muted-foreground">media/slot</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-lg border bg-card p-4">
              <h2 className="mb-4 font-semibold">Prenotazioni nel tempo</h2>
              {isLoading ? (
                <Skeleton className="h-56 w-full" />
              ) : (
                <UsageChart bookings={bookings} spaces={showAllSpaces ? spaces : undefined} />
              )}
            </div>
            {showAllSpaces ? (
              <div className="rounded-lg border bg-card p-4">
                <h2 className="mb-4 font-semibold">Prenotazioni per spazio</h2>
                {isLoading ? (
                  <Skeleton className="h-56 w-full" />
                ) : (
                  <SpaceComparisonChart bookings={bookings} spaces={spaces} />
                )}
              </div>
            ) : (
              <div className="rounded-lg border bg-card p-4">
                <h2 className="mb-4 font-semibold">Top utenti</h2>
                {isLoading ? <Skeleton className="h-56 w-full" /> : <UserChart bookings={bookings} />}
              </div>
            )}
          </div>

          <div className="space-y-3">
            <h2 className="font-semibold">Prenotazioni</h2>
            {isLoading ? (
              <div className="space-y-2">
                {[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-12 w-full" />)}
              </div>
            ) : (
              <BookingsTable bookings={bookings} />
            )}
          </div>
        </TabsContent>

        <TabsContent value="spazi" className="pt-6">
          <div className="rounded-lg border bg-card p-6">
            <Spaces />
          </div>
        </TabsContent>

        <TabsContent value="utenti" className="pt-6">
          <div className="rounded-lg border bg-card p-4 sm:p-6">
            <UsersTab onOpenUser={setOpenUserId} />
          </div>
        </TabsContent>

        <TabsContent value="pt" className="pt-6">
          <PtTab onOpenUser={setOpenUserId} />
        </TabsContent>

        <TabsContent value="accessi" className="pt-6">
          <div className="rounded-lg border bg-card p-6">
            <AccessControl />
          </div>
        </TabsContent>
      </Tabs>

      <UserDetailSheet userId={openUserId} onOpenChange={open => !open && setOpenUserId(null)} />
    </div>
  )
}
