import { useState } from 'react'
import { addWeeks, endOfWeek, format, isSameMonth, parseISO, startOfWeek } from 'date-fns'
import { it } from 'date-fns/locale'
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { useAdminSessions, usePtSettings, type AdminSession } from '@/hooks/usePtAdmin'
import { SessionDay } from './SessionDay'
import { VoidSessionDialog } from './VoidSessionDialog'
import { ExclusionsDialog } from './ExclusionsDialog'
import { PayersDialog } from './PayersDialog'
import { AddSessionDialog } from './AddSessionDialog'
import type { SessionAction } from './SessionRow'
import { SessionTrainerDialog } from './SessionTrainerDialog'
import { useTrainerAccounts } from '@/hooks/useTrainerWallet'

const weekStartOf = (d: Date) => startOfWeek(d, { weekStartsOn: 1 })

function weekLabel(start: Date): string {
  const end = endOfWeek(start, { weekStartsOn: 1 })
  const first = isSameMonth(start, end) ? format(start, 'd') : format(start, 'd MMM', { locale: it })
  return `${first} – ${format(end, 'd MMM yyyy', { locale: it })}`
}

export function WeekSessions() {
  const [weekStart, setWeekStart] = useState(() => weekStartOf(new Date()))
  const [action, setAction] = useState<{ kind: SessionAction; slotId: string } | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [trainerFilter, setTrainerFilter] = useState('all')
  const { data: trainers = [] } = useTrainerAccounts()
  const from = format(weekStart, 'yyyy-MM-dd')
  const to = format(endOfWeek(weekStart, { weekStartsOn: 1 }), 'yyyy-MM-dd')
  const { data: sessions = [], isLoading, isFetching, isError } = useAdminSessions(from, to)
  const { data: settings } = usePtSettings()
  const isCurrentWeek = from === format(weekStartOf(new Date()), 'yyyy-MM-dd')

  const days = new Map<string, AdminSession[]>()
  ;[...sessions]
    .filter(s => trainerFilter === 'all' || (trainerFilter === 'unassigned' ? !s.trainer : s.trainer?.trainer_id === trainerFilter))
    .sort((a, b) => (a.date + a.start_time).localeCompare(b.date + b.start_time))
    .forEach(s => days.set(s.date, [...(days.get(s.date) ?? []), s]))

  // Dialogs read the live row so they reflect the refetch after each change.
  const target = action ? sessions.find(s => s.slot_id === action.slotId) : undefined
  const closeAction = () => setAction(null)

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold">Sedute</h3>
          <p className="text-sm text-muted-foreground">Le giornate future mostrano una stima; gli addebiti si scrivono a fine giornata.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setAddOpen(true)}>
          <Plus /> Aggiungi seduta PT
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-1">
        <Button size="icon-sm" variant="ghost" onClick={() => setWeekStart(w => addWeeks(w, -1))} aria-label="Settimana precedente">
          <ChevronLeft />
        </Button>
        <span className="min-w-40 text-center text-sm font-medium tabular-nums" aria-live="polite">
          {weekLabel(weekStart)}
        </span>
        <Button size="icon-sm" variant="ghost" onClick={() => setWeekStart(w => addWeeks(w, 1))} aria-label="Settimana successiva">
          <ChevronRight />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setWeekStart(weekStartOf(new Date()))}
          disabled={isCurrentWeek}
          className="ml-1"
        >
          Oggi
        </Button>
        <select aria-label="Filtra sedute per trainer" value={trainerFilter} onChange={e => setTrainerFilter(e.target.value)} className="ml-auto h-9 max-w-full rounded-md border border-input bg-background px-2 text-sm">
          <option value="all">Tutti i trainer</option>
          <option value="unassigned">Da assegnare</option>
          {trainers.map(t => <option key={t.trainer_id} value={t.trainer_id}>{t.email}</option>)}
        </select>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[0, 1].map(i => <Skeleton key={i} className="h-36 w-full rounded-lg" />)}
        </div>
      ) : isError ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          Non è stato possibile caricare le sedute. Riprova tra poco.
        </div>
      ) : days.size === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          Nessuna seduta PT in questa settimana.
        </div>
      ) : (
        <div className={cn('space-y-3 transition-opacity', isFetching && 'opacity-60')}>
          {[...days.entries()].map(([date, list]) => (
            <SessionDay
              key={date}
              date={date}
              sessions={list}
              fullSessionMin={settings?.full_session_min}
              onAction={(kind, s) => setAction({ kind, slotId: s.slot_id })}
            />
          ))}
        </div>
      )}

      {target && action?.kind === 'void' && <VoidSessionDialog session={target} onClose={closeAction} />}
      {target && action?.kind === 'exclude' && <ExclusionsDialog session={target} onClose={closeAction} />}
      {target && action?.kind === 'payers' && <PayersDialog session={target} onClose={closeAction} />}
      {target && action?.kind === 'trainer' && <SessionTrainerDialog key={target.slot_id} session={target} onClose={closeAction} />}

      <AddSessionDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onCreated={date => setWeekStart(weekStartOf(parseISO(date)))}
      />
    </section>
  )
}
