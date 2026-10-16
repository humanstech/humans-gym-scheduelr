import type { ReactNode } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import { AuthGuard } from '@/components/AuthGuard'
import { AdminGuard } from '@/components/AdminGuard'
import { Layout } from '@/components/Layout'
import { Login } from '@/pages/Login'
import { Dashboard } from '@/pages/Dashboard'
import { MyBookings } from '@/pages/MyBookings'
import { SpaceBookingView } from '@/components/dashboard/SpaceBookingView'
import { Admin } from '@/pages/Admin'
import { Wallet } from '@/pages/Wallet'
import { TrainerHome } from '@/pages/TrainerHome'
import { TrainerWallet } from '@/pages/TrainerWallet'
import { useAuth } from '@/hooks/useAuth'
import { useTrainerMode } from '@/hooks/useRoles'

function Spinner() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center" role="status">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
    </div>
  )
}

/** Trainer-only users (trainer, not admin) see just their PT sessions at `/`. */
function HomeRoute() {
  const { isTrainerOnly, isLoading } = useTrainerMode()
  if (isLoading) return <Spinner />
  return isTrainerOnly ? <TrainerHome /> : <Dashboard />
}

/** Member pages: trainer-only users are sent back to `/`. */
function MemberRoute({ children }: { children: ReactNode }) {
  const { isTrainerOnly, isLoading } = useTrainerMode()
  if (isLoading) return <Spinner />
  if (isTrainerOnly) return <Navigate to="/" replace />
  return <>{children}</>
}

function AuthCallback() {
  const { session, loading } = useAuth()
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    )
  }
  return <Navigate to={session ? '/' : '/login'} replace />
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/auth/callback" element={<AuthCallback />} />
          <Route
            path="/"
            element={
              <AuthGuard>
                <Layout>
                  <HomeRoute />
                </Layout>
              </AuthGuard>
            }
          />
          <Route
            path="/space/:spaceId"
            element={
              <AuthGuard>
                <Layout>
                  <MemberRoute>
                    <SpaceBookingView />
                  </MemberRoute>
                </Layout>
              </AuthGuard>
            }
          />
          <Route
            path="/my-bookings"
            element={
              <AuthGuard>
                <Layout>
                  <MemberRoute>
                    <MyBookings />
                  </MemberRoute>
                </Layout>
              </AuthGuard>
            }
          />
          <Route
            path="/wallet"
            element={
              <AuthGuard>
                <Layout>
                  <MemberRoute>
                    <Wallet />
                  </MemberRoute>
                </Layout>
              </AuthGuard>
            }
          />
          <Route
            path="/trainer-wallet"
            element={<AuthGuard><Layout><TrainerWallet /></Layout></AuthGuard>}
          />
          <Route
            path="/admin"
            element={
              <AuthGuard>
                <AdminGuard>
                  <Layout>
                    <Admin />
                  </Layout>
                </AdminGuard>
              </AuthGuard>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
      <Toaster richColors position="top-right" />
    </QueryClientProvider>
  )
}
