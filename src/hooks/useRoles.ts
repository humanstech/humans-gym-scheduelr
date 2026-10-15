import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { useIsAdmin } from '@/hooks/useIsAdmin'

export function useIsTrainer() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['pt', 'isTrainer', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('is_trainer')
      if (error) throw error
      return !!data
    },
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
    retry: false,
  })
}

/**
 * A trainer who is not an admin uses the app in trainer-only mode:
 * they only see their PT sessions.
 */
export function useTrainerMode() {
  const { user, loading: authLoading } = useAuth()
  const isTrainer = useIsTrainer()
  const isAdmin = useIsAdmin(user?.email)
  const isLoading = authLoading || (!!user && (isTrainer.isPending || isAdmin.isPending))
  return {
    isTrainerOnly: !isLoading && isTrainer.data === true && !isAdmin.data,
    isLoading,
  }
}
