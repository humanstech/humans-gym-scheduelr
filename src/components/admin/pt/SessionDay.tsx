import { cn } from '@/lib/utils'
import { formatEUR } from '@/lib/money'
import type { AdminSession } from '@/hooks/usePtAdmin'
import { formatDay, todayISO } from '@/components/admin/ptFormat'
import { DAY_STATE_LABEL, dayExplanation, dayState, dayTotalCents, type DayState } from './sessionUtils'
import { SessionRow, type SessionAction } from './SessionRow'

const STATE_CLASSES: Record<DayState, string> = {
  future: 'bg-sky-500/10 text-sky-700 dark:text-sky-300',
  live: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  closed: 'bg-muted text-muted-foreground',
}

interface SessionDayProps {
  date: string
  sessions: AdminSession[]
  fullSessionMin?: number
  onAction: (action: SessionAction, session: AdminSession) => void
}

export function SessionDay({ date, sessions, fullSessionMin, onAction }: SessionDayProps) {
  const today = todayISO()
  const state = dayState(date, sessions.some(s => s.day_closed), today)
  const total = dayTotalCents(sessions)
  const hasActive = sessions.some(s => s.status === 'active')

  return (
    <section className="overflow-hidden rounded-lg border bg-card" aria-label={formatDay(date, 'EEEE d MMMM')}>
      <header className="border-b bg-muted/30 px-3 py-2.5 sm:px-4">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <div className="flex items-center gap-2">
            <h4 className={cn('text-sm font-semibold capitalize', date === today && 'text-primary')}>
              {formatDay(date, 'EEEE d MMMM')}
            </h4>
            <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', STATE_CLASSES[state])}>
              {DAY_STATE_LABEL[state]}
            </span>
          </div>
          {hasActive && (
            <span className="text-sm tabular-nums">
              <span className="text-muted-foreground">{state === 'closed' ? 'Totale' : 'Stima'} </span>
              <span className="font-semibold">{formatEUR(total)}</span>
            </span>
          )}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">{dayExplanation(sessions, fullSessionMin)}</p>
      </header>
      <ul className="divide-y">
        {sessions.map(s => <SessionRow key={s.slot_id} session={s} onAction={onAction} />)}
      </ul>
    </section>
  )
}
