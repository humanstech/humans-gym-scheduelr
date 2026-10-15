import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { addDays, format } from 'date-fns'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import type { Database } from '@/lib/database.types'

type Functions = Database['public']['Functions']
export type PtStatus = Functions['pt_my_status']['Returns'][number]
export type PtDayPreview = Functions['pt_day_preview']['Returns'][number]
export type PtTrainerSession = Functions['pt_trainer_sessions']['Returns'][number]

/** Current timestamp, refreshed every `intervalMs`. */
export function useNow(intervalMs = 60_000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(timer)
  }, [intervalMs])
  return now
}

/** True when the membership period in `status` covers `date` (yyyy-MM-dd). */
export function isPtMemberOn(status: PtStatus | null | undefined, date: string) {
  if (!status?.valid_from) return false
  return status.valid_from <= date && (!status.valid_to || date <= status.valid_to)
}

export function isLowBalance(status: PtStatus) {
  return status.balance_cents < status.low_balance_threshold_cents
}

export function usePtStatus() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['pt', 'status', user?.id],
    queryFn: async (): Promise<PtStatus | null> => {
      const { data, error } = await supabase.rpc('pt_my_status')
      if (error) throw error
      return data?.[0] ?? null
    },
    enabled: !!user,
    staleTime: 30 * 1000,
    retry: false,
  })
}

export function useMyWalletEntries(enabled = true) {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['pt', 'wallet', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pt_wallet_entries')
        .select('*')
        .eq('user_id', user!.id)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data ?? []
    },
    enabled: !!user && enabled,
  })
}

/** Current estimate for the PT sessions of a day, keyed by slot_id. Members/admins only. */
export function useDayPreview(date: string, enabled: boolean) {
  return useQuery({
    queryKey: ['pt', 'preview', date],
    queryFn: async (): Promise<Record<string, PtDayPreview>> => {
      const { data, error } = await supabase.rpc('pt_day_preview', { d: date })
      if (error) throw error
      return Object.fromEntries((data ?? []).map(row => [row.slot_id, row]))
    },
    enabled,
    staleTime: 0,
    refetchInterval: enabled ? 30 * 1000 : false,
    retry: false,
  })
}

export function useTrainerSessions(range: 'upcoming' | 'past') {
  const queryClient = useQueryClient()

  useEffect(() => {
    const channel = supabase
      .channel(`pt-trainer:${range}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'slots' }, () => {
        queryClient.invalidateQueries({ queryKey: ['pt', 'trainer'] })
      })
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [range, queryClient])

  return useQuery({
    queryKey: ['pt', 'trainer', range],
    queryFn: async (): Promise<PtTrainerSession[]> => {
      const today = new Date()
      const [from, to] = range === 'upcoming'
        ? [today, addDays(today, 30)]
        : [addDays(today, -30), today]
      const { data, error } = await supabase.rpc('pt_trainer_sessions', {
        from_date: format(from, 'yyyy-MM-dd'),
        to_date: format(to, 'yyyy-MM-dd'),
      })
      if (error) throw error
      return data ?? []
    },
    refetchInterval: 30 * 1000,
  })
}
