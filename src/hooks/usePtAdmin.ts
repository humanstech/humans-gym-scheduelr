import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Database, Tables } from '@/lib/database.types'
import type { TrainerSessionDetails } from './useTrainerWallet'

type Fns = Database['public']['Functions']
export type AdminUser = Fns['admin_list_users']['Returns'][number]
export type LowBalance = Fns['pt_low_balances']['Returns'][number]
export type AdminSession = Fns['pt_admin_sessions']['Returns'][number] & { trainer: TrainerSessionDetails | null }
export type PtSettings = Tables<'pt_settings'>
export type PtMembership = Tables<'pt_memberships'>
export type PtTrainer = Tables<'pt_trainers'>

const PT_ERRORS: [string, string][] = [
  ['Trainer required', 'Seleziona un trainer. Per le sedute programmate, configura il trainer predefinito.'],
  ['Trainer rate required', 'Configura prima il compenso sull’account del trainer'],
  ['Reason required', 'Inserisci un motivo o una nota'],
  ['Invalid payment date', 'La data del pagamento non può essere futura'],
  ['Session already exists', 'Questa seduta PT esiste già'],
  ['Membership overlap', "Il periodo si sovrappone a un'altra iscrizione"],
  ['Slot has incompatible bookings', 'Lo slot ha prenotazioni di persone non iscritte al PT o oltre la capienza'],
  ['Invalid amount', 'Importo non valido'],
  ['Session not found', 'Seduta non trovata'],
  ['Admin required', 'Serve un account admin'],
  ['Slot full', 'La seduta è al completo'],
  ['PT membership required', "Serve un'iscrizione PT attiva in quella data"],
]

/** Maps the RAISE EXCEPTION messages of the PT RPCs to Italian copy. */
export function ptErrorMessage(err: unknown, fallback = 'Qualcosa è andato storto. Riprova.'): string {
  const message = (err as { message?: string } | null)?.message ?? ''
  return PT_ERRORS.find(([key]) => message.includes(key))?.[1] ?? fallback
}

// Queries

export function usePtSettings() {
  return useQuery({
    queryKey: ['pt-admin', 'settings'],
    queryFn: async (): Promise<PtSettings | null> => {
      const { data, error } = await supabase.from('pt_settings').select('*').maybeSingle()
      if (error) throw error
      return data
    },
    staleTime: 60 * 1000,
  })
}

export function useAdminUsers() {
  return useQuery({
    queryKey: ['pt-admin', 'users'],
    queryFn: async (): Promise<AdminUser[]> => {
      const { data, error } = await supabase.rpc('admin_list_users')
      if (error) throw error
      return data ?? []
    },
  })
}

export function useLowBalances() {
  return useQuery({
    queryKey: ['pt-admin', 'low-balances'],
    queryFn: async (): Promise<LowBalance[]> => {
      const { data, error } = await supabase.rpc('pt_low_balances')
      if (error) throw error
      return [...(data ?? [])].sort((a, b) => a.balance_cents - b.balance_cents)
    },
  })
}

export function useUserMemberships(userId: string | null) {
  return useQuery({
    queryKey: ['pt-admin', 'memberships', userId],
    queryFn: async (): Promise<PtMembership[]> => {
      const { data, error } = await supabase
        .from('pt_memberships')
        .select('*')
        .eq('user_id', userId!)
        .order('valid_from', { ascending: false })
      if (error) throw error
      return data ?? []
    },
    enabled: !!userId,
  })
}

export function useUserWallet(userId: string | null) {
  return useQuery({
    queryKey: ['pt-admin', 'wallet', userId],
    queryFn: async (): Promise<Tables<'pt_wallet_entries'>[]> => {
      const { data, error } = await supabase
        .from('pt_wallet_entries')
        .select('*')
        .eq('user_id', userId!)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data ?? []
    },
    enabled: !!userId,
  })
}

export function useAdminSessions(from: string, to: string) {
  return useQuery({
    queryKey: ['pt-admin', 'sessions', from, to],
    queryFn: async (): Promise<AdminSession[]> => {
      const [sessions, trainers] = await Promise.all([
        supabase.rpc('pt_admin_sessions', { from_date: from, to_date: to }),
        supabase.rpc('pt_trainer_session_details', { from_date: from, to_date: to }),
      ])
      if (sessions.error) throw sessions.error
      if (trainers.error) throw trainers.error
      const bySlot = new Map((trainers.data ?? []).map(t => [t.slot_id, t]))
      return (sessions.data ?? []).map(s => ({ ...s, trainer: bySlot.get(s.slot_id) ?? null }))
    },
    placeholderData: prev => prev,
    refetchInterval: 60_000,
  })
}

export function useTrainers() {
  return useQuery({
    queryKey: ['pt-admin', 'trainers'],
    queryFn: async (): Promise<PtTrainer[]> => {
      const { data, error } = await supabase.from('pt_trainers').select('*').order('email')
      if (error) throw error
      return data ?? []
    },
  })
}

export interface ConvertibleSlot {
  id: string
  start_time: string
  end_time: string
  space_id: string
  space_name: string
}

/** Regular (non-PT) slots of a date that can be turned into a PT session. */
export function useConvertibleSlots(date: string | null) {
  return useQuery({
    queryKey: ['pt-admin', 'convertible-slots', date],
    queryFn: async (): Promise<ConvertibleSlot[]> => {
      const { data, error } = await supabase
        .from('slots')
        .select('id, start_time, end_time, space_id, is_cancelled, spaces(name), pt_sessions(status)')
        .eq('date', date!)
        .eq('is_cancelled', false)
        .order('start_time')
      if (error) throw error
      return (data ?? [])
        .filter(s => {
          const pt = s.pt_sessions as { status: string } | { status: string }[] | null
          const status = Array.isArray(pt) ? pt[0]?.status : pt?.status
          return status !== 'active'
        })
        .map(s => ({
          id: s.id,
          start_time: s.start_time,
          end_time: s.end_time,
          space_id: s.space_id,
          space_name: (s.spaces as { name: string } | null)?.name ?? '—',
        }))
    },
    enabled: !!date,
  })
}

// Mutations

/** Every PT write can change balances, sessions and slot capacity: refresh admin + user views. */
function usePtMutation<TArgs, TResult = void>(fn: (args: TArgs) => Promise<TResult>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pt-admin'] })
      queryClient.invalidateQueries({ queryKey: ['pt'] })
      queryClient.invalidateQueries({ queryKey: ['slots'] })
    },
  })
}

export function useSaveMembership() {
  return usePtMutation(async (args: { membershipId: string | null; userId: string; validFrom: string; validTo: string | null }) => {
    const { data, error } = await supabase.rpc('pt_save_membership', {
      membership_id: args.membershipId,
      user_id: args.userId,
      valid_from: args.validFrom,
      valid_to: args.validTo,
    })
    if (error) throw error
    return data
  })
}

export function useDeleteMembership() {
  return usePtMutation(async (membershipId: string) => {
    const { error } = await supabase.rpc('pt_delete_membership', { membership_id: membershipId })
    if (error) throw error
  })
}

export function useAddWalletEntry() {
  return usePtMutation(async (args: { userId: string; amountCents: number; kind: 'topup' | 'manual'; note: string }) => {
    const { error } = await supabase.rpc('pt_add_wallet_entry', {
      user_id: args.userId,
      amount_cents: args.amountCents,
      kind: args.kind,
      note: args.note,
    })
    if (error) throw error
  })
}

export function useVoidSession() {
  return usePtMutation(async (args: { slotId: string; reason: string }) => {
    const { error } = await supabase.rpc('pt_void_session', { slot_id: args.slotId, reason: args.reason })
    if (error) throw error
  })
}

export function useRestoreSession() {
  return usePtMutation(async (slotId: string) => {
    const { error } = await supabase.rpc('pt_restore_session', { slot_id: slotId })
    if (error) throw error
  })
}

export function useCreateSession() {
  return usePtMutation(async (args: Fns['pt_create_assigned_session']['Args']) => {
    const { error } = await supabase.rpc('pt_create_assigned_session', args)
    if (error) throw error
  })
}

export function useSetExclusion() {
  return usePtMutation(async (args: { slotId: string; userId: string; excluded: boolean; reason: string | null }) => {
    const { error } = await supabase.rpc('pt_set_exclusion', {
      slot_id: args.slotId,
      user_id: args.userId,
      excluded: args.excluded,
      reason: args.reason,
    })
    if (error) throw error
  })
}

export function useSetPayers() {
  return usePtMutation(async (args: { slotId: string; userIds: string[]; reason: string | null }) => {
    const { error } = await supabase.rpc('pt_set_payers', {
      slot_id: args.slotId,
      user_ids: args.userIds,
      reason: args.reason,
    })
    if (error) throw error
  })
}

export function useUpdatePtSettings() {
  return usePtMutation(async (args: { sessionPriceCents: number; lowBalanceThresholdCents: number; maxParticipants: number }) => {
    const { error } = await supabase.rpc('pt_update_settings', {
      session_price_cents: args.sessionPriceCents,
      low_balance_threshold_cents: args.lowBalanceThresholdCents,
      max_participants: args.maxParticipants,
    })
    if (error) throw error
  })
}

export function useAddTrainer() {
  return usePtMutation(async (args: { email: string; fee_cents: number }) => {
    const { error } = await supabase.rpc('pt_add_trainer', args)
    if (error) throw error
  })
}

export function useRemoveTrainer() {
  return usePtMutation(async (id: string) => {
    const { error } = await supabase.from('pt_trainers').delete().eq('id', id)
    if (error) throw error
  })
}

/** Aligns future PT sessions of a space with its `is_pt` fasce. Returns how many sessions changed. */
export function useSyncPtSchedule() {
  return usePtMutation(async (spaceId: string) => {
    const { data, error } = await supabase.rpc('pt_sync_schedule', { space_id: spaceId })
    if (error) throw error
    return data ?? 0
  })
}
