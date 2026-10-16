import { SpaceOverview } from '@/components/dashboard/SpaceOverview'
import { MyTrainerWallet } from '@/components/pt/MyTrainerWallet'
import { useIsTrainer } from '@/hooks/useRoles'

export function Dashboard() {
  const { data: isTrainer } = useIsTrainer()
  return <div className="space-y-6">{isTrainer && <MyTrainerWallet compact />}<SpaceOverview /></div>
}
