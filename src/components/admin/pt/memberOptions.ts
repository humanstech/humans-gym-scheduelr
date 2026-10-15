import type { AdminSession, AdminUser } from '@/hooks/usePtAdmin'
import { displayName } from '@/components/admin/ptFormat'

export interface MemberOption {
  user_id: string
  name: string
  booked: boolean
}

/**
 * Session participants first (in booking order), then the other active PT members alphabetically.
 * `pt_active` reflects today, which is an acceptable approximation for the session date.
 */
export function memberOptions(session: AdminSession, users: AdminUser[]): MemberOption[] {
  const booked: MemberOption[] = session.participants.map(p => ({ user_id: p.user_id, name: p.name, booked: true }))
  const bookedIds = new Set(booked.map(b => b.user_id))
  const others = users
    .filter(u => u.pt_active && !bookedIds.has(u.user_id))
    .map(u => ({ user_id: u.user_id, name: displayName(u), booked: false }))
    .sort((a, b) => a.name.localeCompare(b.name, 'it'))
  return [...booked, ...others]
}
