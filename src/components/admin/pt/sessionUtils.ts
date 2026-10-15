import type { AdminSession } from '@/hooks/usePtAdmin'
import { fmtTime } from '@/components/admin/ptFormat'

export type DayState = 'future' | 'live' | 'closed'

export const DAY_STATE_LABEL: Record<DayState, string> = {
  future: 'Futura',
  live: 'In corso',
  closed: 'Chiusa',
}

/** A day is closed once the DB wrote its charges; until then today/past days are "in corso". */
export function dayState(date: string, dayClosed: boolean, today: string): DayState {
  if (dayClosed) return 'closed'
  return date > today ? 'future' : 'live'
}

export function sessionStarted(s: Pick<AdminSession, 'date' | 'start_time'>): boolean {
  return new Date(`${s.date}T${s.start_time}`) <= new Date()
}

const names = (list: { name: string }[]) => list.map(p => p.name).join(', ')

/** One-line plain explanation of how the day is split, derived from the DB's `mode`s. */
export function dayExplanation(sessions: AdminSession[], fullSessionMin?: number): string {
  const active = sessions.filter(s => s.status === 'active')
  if (active.length === 0) return 'Annullata'

  const modes = new Set(active.map(s => s.mode))
  const parts: string[] = []
  if (modes.has('shared')) {
    parts.push(modes.has('pooled')
      ? 'Nessuna seduta piena: una quota divisa tra tutti gli iscritti, le altre tra i presenti'
      : 'Nessuna seduta piena: quota divisa tra tutti gli iscritti')
  } else if (modes.has('pooled')) {
    const hasFull = fullSessionMin === undefined
      || active.some(s => s.participants.filter(p => p.counted).length >= fullSessionMin)
    parts.push(hasFull ? 'Seduta piena: quota divisa tra i presenti' : 'Quota divisa tra i presenti')
  }

  const customs = active.filter(s => s.mode === 'custom')
  customs.forEach(s => {
    const who = names(s.payers) || 'nessuno'
    parts.push(parts.length === 0 && customs.length === 1
      ? `A carico di ${who}`
      : `${fmtTime(s.start_time)} a carico di ${who}`)
  })

  return parts.length > 0 ? parts.join(' · ') : 'Gratuita'
}

export function dayTotalCents(sessions: AdminSession[]): number {
  return sessions.filter(s => s.status === 'active').reduce((sum, s) => sum + s.total_cents, 0)
}

export function updatedMessage(s: Pick<AdminSession, 'day_closed'>): string {
  return s.day_closed ? 'Seduta aggiornata · giornata ricalcolata' : 'Seduta aggiornata'
}

export function sessionLabel(s: Pick<AdminSession, 'start_time' | 'end_time' | 'space_name'>): string {
  return `${fmtTime(s.start_time)}–${fmtTime(s.end_time)} · ${s.space_name}`
}
