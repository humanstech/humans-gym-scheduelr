import { useEffect, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Navigate } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'

export function AuthGuard({ children }: { children: ReactNode }) {
  const { session, loading, signOut } = useAuth()
  const access = useQuery({
    queryKey: ['access', session?.user.id, session?.user.email],
    enabled: !!session,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('is_allowed')
      if (error) throw error
      return data
    },
    retry: false,
    refetchInterval: 60_000,
  })
  const denied = !!session && (access.data === false || access.isError)
  useEffect(() => {
    if (denied) void signOut()
  }, [denied, signOut])

  if (loading || (session && access.isPending)) {
    return <div className="flex min-h-screen items-center justify-center" role="status">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
    </div>
  }
  if (!session) return <Navigate to="/login" replace />
  if (denied) return <p role="alert">Accesso non autorizzato</p>
  return <>{children}</>
}
