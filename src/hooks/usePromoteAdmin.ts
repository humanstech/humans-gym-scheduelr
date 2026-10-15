import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

export function usePromoteAdmin() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await supabase.rpc('admin_promote_user', { user_id: userId })
      if (error) throw error
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['pt-admin', 'users'] }),
        queryClient.invalidateQueries({ queryKey: ['isAdmin'] }),
      ])
    },
  })
}
