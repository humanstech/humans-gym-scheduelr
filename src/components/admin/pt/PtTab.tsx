import { LowBalanceCard } from './LowBalanceCard'
import { WeekSessions } from './WeekSessions'
import { PtSettingsCard } from './PtSettingsCard'
import { TrainersCard } from './TrainersCard'

export function PtTab({ onOpenUser }: { onOpenUser: (userId: string) => void }) {
  return (
    <div className="space-y-6">
      <div className="rounded-lg border bg-card p-4 sm:p-6">
        <LowBalanceCard onOpenUser={onOpenUser} />
      </div>
      <div className="rounded-lg border bg-card p-4 sm:p-6">
        <WeekSessions />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-lg border bg-card p-4 sm:p-6">
          <PtSettingsCard />
        </div>
        <div className="rounded-lg border bg-card p-4 sm:p-6">
          <TrainersCard />
        </div>
      </div>
    </div>
  )
}
