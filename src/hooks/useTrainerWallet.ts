import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Database, Tables } from '@/lib/database.types'
import { useAuth } from './useAuth'
import { useIsTrainer } from './useRoles'

type Fns = Database['public']['Functions']
export type TrainerAccount = Fns['pt_trainer_accounts']['Returns'][number]
export type TrainerSessionDetails = Fns['pt_trainer_session_details']['Returns'][number]
export type TrainerWalletEntry = Tables<'pt_trainer_wallet_entries'>

export function useMyTrainerWallet() {
  const { user } = useAuth()
  const { data: isTrainer } = useIsTrainer()
  return useQuery({
    queryKey: ['pt', 'my-trainer-wallet', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('pt_my_trainer_wallet')
      if (error) throw error
      return data
    },
    enabled: !!user && isTrainer === true,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  })
}

export function useTrainerAccounts() {
  return useQuery({
    queryKey: ['pt-admin', 'trainer-accounts'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('pt_trainer_accounts')
      if (error) throw error
      return data ?? []
    },
    refetchInterval: 60_000,
  })
}

export function useTrainerDefaults() {
  return useQuery({
    queryKey: ['pt-admin', 'trainer-defaults'],
    queryFn: async () => {
      const { data, error } = await supabase.from('pt_trainer_settings').select('*').single()
      if (error) throw error
      return data
    },
  })
}

export function useTrainerWallet(trainerId: string | null) {
  return useQuery({
    queryKey: ['pt-admin', 'trainer-wallet', trainerId],
    queryFn: async () => {
      // Reconcile before reading so a newly finished session is included immediately.
      const accounts = await supabase.rpc('pt_trainer_accounts')
      if (accounts.error) throw accounts.error
      const { data, error } = await supabase.from('pt_trainer_wallet_entries').select('*')
        .eq('trainer_id', trainerId!).order('created_at', { ascending: false }).order('id')
      if (error) throw error
      return data ?? []
    },
    enabled: !!trainerId,
    refetchInterval: 60_000,
  })
}

function useTrainerMutation<T>(fn: (args: T) => Promise<unknown>) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['pt-admin'] }),
        client.invalidateQueries({ queryKey: ['pt'] }),
        client.invalidateQueries({ queryKey: ['slots'] }),
      ])
    },
  })
}

export function useSaveTrainerRate() {
  return useTrainerMutation(async (args: Fns['pt_save_trainer_rate']['Args']) => {
    const { error } = await supabase.rpc('pt_save_trainer_rate', args)
    if (error) throw error
  })
}

export function useSetTrainerDefaults() {
  return useTrainerMutation(async (trainerId: string) => {
    const { error } = await supabase.rpc('pt_set_trainer_defaults', { trainer_id: trainerId })
    if (error) throw error
  })
}

export function useSetSessionTrainer() {
  return useTrainerMutation(async (args: Fns['pt_set_session_trainer']['Args']) => {
    const { error } = await supabase.rpc('pt_set_session_trainer', args)
    if (error) throw error
  })
}

export function useRecordTrainerPayment() {
  return useTrainerMutation(async (args: Fns['pt_record_trainer_payment']['Args']) => {
    const { error } = await supabase.rpc('pt_record_trainer_payment', args)
    if (error) throw error
  })
}

export function useReverseTrainerPayment() {
  return useTrainerMutation(async (args: Fns['pt_reverse_trainer_payment']['Args']) => {
    const { error } = await supabase.rpc('pt_reverse_trainer_payment', args)
    if (error) throw error
  })
}
