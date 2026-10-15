import { format, parseISO } from 'date-fns'
import { it } from 'date-fns/locale'
import type { AdminUser, PtMembership } from '@/hooks/usePtAdmin'

export function todayISO(): string {
  return format(new Date(), 'yyyy-MM-dd')
}

/** "2026-10-01" → "1 ott 2026" (or a custom date-fns pattern). */
export function formatDay(iso: string, pattern = 'd MMM yyyy'): string {
  return format(parseISO(iso), pattern, { locale: it })
}

export function initials(name: string | null | undefined, email?: string): string {
  const source = (name || email || '?').trim()
  const parts = source.split(/[\s.@_-]+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '?') + (parts[1]?.[0] ?? '')).toUpperCase()
}

export function displayName(user: { full_name: string | null; email: string }): string {
  return user.full_name || user.email.split('@')[0]
}

export function isMembershipActive(m: Pick<PtMembership, 'valid_from' | 'valid_to'>, today = todayISO()): boolean {
  return m.valid_from <= today && (m.valid_to === null || m.valid_to >= today)
}

/** "PT attivo dal 1 ott" / "PT terminato il 30 set" / "PT dal 1 nov" / null. */
export function ptStatusLabel(user: AdminUser, today = todayISO()): string | null {
  if (!user.pt_valid_from) return null
  if (user.pt_active) return `PT attivo dal ${formatDay(user.pt_valid_from, 'd MMM')}`
  if (user.pt_valid_from > today) return `PT dal ${formatDay(user.pt_valid_from, 'd MMM')}`
  if (user.pt_valid_to) return `PT terminato il ${formatDay(user.pt_valid_to, 'd MMM')}`
  return null
}

/** Ever-members only: a non-member's 0 € balance carries no meaning. */
export function isEverMember(user: Pick<AdminUser, 'pt_valid_from'>): boolean {
  return user.pt_valid_from !== null
}

export function balanceTone(cents: number, thresholdCents: number | undefined): string {
  if (cents < 0) return 'text-destructive'
  if (thresholdCents !== undefined && cents < thresholdCents) return 'text-amber-600 dark:text-amber-400'
  return 'text-foreground'
}

export const fmtTime = (t: string) => t.slice(0, 5)
