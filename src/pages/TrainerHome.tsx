import { useMemo, useState } from 'react'
import { format, isToday, isTomorrow, isYesterday, parseISO } from 'date-fns'
import { it } from 'date-fns/locale'
import { CalendarX2, Users } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { useNow, usePtStatus, useTrainerSessions, type PtTrainerSession } from '@/hooks/usePersonalTrainer'
import { cn } from '@/lib/utils'

type Range = 'upcoming' | 'past'

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/)
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
  return name.slice(0, 2).toUpperCase() || '?'
}

function dayLabel(date: string) {
  const d = parseISO(date)
  if (isToday(d)) return 'Oggi'
  if (isTomorrow(d)) return 'Domani'
  if (isYesterday(d)) return 'Ieri'
  return format(d, 'EEEE d MMMM', { locale: it })
}

function endsAt(s: PtTrainerSession) {
  return new Date(`${s.date}T${s.end_time}`).getTime()
}

function SessionCard({ session, capacity }: { session: PtTrainerSession; capacity: number }) {
  const voided = session.status === 'voided'
  const today = isToday(parseISO(session.date))
  const participants = session.participants ?? []
  return (
    <div
      className={cn(
        'rounded-lg border bg-card p-4',
        today && !voided && 'border-violet-500/40 bg-violet-500/5',
        voided && 'border-dashed bg-muted/40 opacity-70'
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className={cn('text-2xl font-bold tracking-tight leading-none tabular-nums', voided && 'text-muted-foreground line-through')}>
            {session.start_time.slice(0, 5)} – {session.end_time.slice(0, 5)}
          </p>
          <p className="mt-1.5 truncate text-sm text-muted-foreground">{session.space_name}</p>
        </div>
        {voided ? (
          <Badge variant="secondary" className="shrink-0">Annullata</Badge>
        ) : (
          <span className="flex shrink-0 items-center gap-1 text-sm font-medium tabular-nums">
            <Users className="h-4 w-4 text-muted-foreground" />
            {participants.length}/{capacity} iscritti
          </span>
        )}
      </div>

      {participants.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">Nessun iscritto</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {participants.map((p, i) => (
            <li key={`${p.name}-${i}`} className="flex items-center gap-2.5">
              <Avatar size="sm">
                {p.avatar_url && <AvatarImage src={p.avatar_url} alt={p.name} referrerPolicy="no-referrer" />}
                <AvatarFallback className="text-[10px]">{getInitials(p.name)}</AvatarFallback>
              </Avatar>
              <span className="truncate text-sm">{p.name}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function TrainerHome() {
  const [range, setRange] = useState<Range>('upcoming')
  const { data: sessions, isLoading } = useTrainerSessions(range)
  const { data: status } = usePtStatus()
  const capacity = status?.max_participants ?? 4
  const now = useNow()

  const groups = useMemo(() => {
    const list = (sessions ?? [])
      .filter(s => (range === 'upcoming' ? endsAt(s) >= now : endsAt(s) < now))
      .sort((a, b) => {
        const ka = `${a.date}T${a.start_time}`
        const kb = `${b.date}T${b.start_time}`
        const cmp = ka < kb ? -1 : ka > kb ? 1 : 0
        return range === 'upcoming' ? cmp : -cmp
      })
    const result: { date: string; sessions: PtTrainerSession[] }[] = []
    for (const s of list) {
      const last = result[result.length - 1]
      if (last?.date === s.date) last.sessions.push(s)
      else result.push({ date: s.date, sessions: [s] })
    }
    return result
  }, [sessions, range, now])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Le tue sedute</h1>
        <p className="mt-1 text-muted-foreground">Sedute di personal training e chi si è iscritto</p>
      </div>

      <div className="inline-flex rounded-lg bg-muted p-1" role="tablist">
        {([['upcoming', 'Prossime'], ['past', 'Passate']] as const).map(([value, label]) => (
          <button
            key={value}
            role="tab"
            aria-selected={range === value}
            onClick={() => setRange(value)}
            className={cn(
              'rounded-md px-4 py-1.5 text-sm font-medium transition-colors',
              range === value ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-4 w-32" />
          {[0, 1, 2].map(i => <Skeleton key={i} className="h-28 w-full rounded-lg" />)}
        </div>
      ) : groups.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-card p-12 text-center">
          <CalendarX2 className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" />
          <p className="font-medium text-muted-foreground">
            {range === 'upcoming' ? 'Nessuna seduta in programma' : 'Nessuna seduta negli ultimi 30 giorni'}
          </p>
          {range === 'upcoming' && (
            <p className="mt-1 text-sm text-muted-foreground">Le sedute dei prossimi 30 giorni compariranno qui</p>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map(group => (
            <section key={group.date} className="space-y-2">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                {dayLabel(group.date)}
              </h2>
              {group.sessions.map(s => (
                <SessionCard key={s.slot_id} session={s} capacity={capacity} />
              ))}
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
