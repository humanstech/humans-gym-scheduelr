import { Navigate } from 'react-router-dom'
import { MyTrainerWallet } from '@/components/pt/MyTrainerWallet'
import { useIsTrainer } from '@/hooks/useRoles'
import { Button } from '@/components/ui/button'

export function TrainerWallet() {
  const { data: isTrainer, isPending, isError, refetch } = useIsTrainer()
  if (isError) return <div role="alert" className="space-y-3"><p>Impossibile verificare l’accesso al wallet.</p><Button onClick={() => void refetch()}>Riprova</Button></div>
  if (isPending) return <p role="status">Caricamento…</p>
  if (!isTrainer) return <Navigate to="/" replace />
  return (
    <div className="space-y-6">
      <div><h1 className="text-2xl font-bold">Compensi PT</h1><p className="mt-1 text-muted-foreground">Il riepilogo dei tuoi compensi e dei pagamenti ricevuti.</p></div>
      <MyTrainerWallet />
    </div>
  )
}
