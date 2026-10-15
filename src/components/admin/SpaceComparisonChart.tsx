import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import type { AdminBooking } from '@/pages/Admin'

interface SpaceOption {
  id: string
  name: string
}

interface SpaceComparisonChartProps {
  bookings: AdminBooking[]
  spaces: SpaceOption[]
}

export function SpaceComparisonChart({ bookings, spaces }: SpaceComparisonChartProps) {
  const data = spaces.map(space => {
    const spaceBookings = bookings.filter(b => b.slots?.space_id === space.id)
    const uniqueUsers = new Set(spaceBookings.map(b => b.user_id)).size
    return {
      name: space.name,
      prenotazioni: spaceBookings.length,
      utenti: uniqueUsers,
    }
  })

  if (data.every(d => d.prenotazioni === 0)) {
    return (
      <div className="flex h-48 items-center justify-center rounded-lg border border-dashed text-muted-foreground">
        Nessun dato da visualizzare
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
        <XAxis dataKey="name" tick={{ fontSize: 11 }} className="fill-muted-foreground" />
        <YAxis allowDecimals={false} tick={{ fontSize: 11 }} className="fill-muted-foreground" />
        <Tooltip
          contentStyle={{
            borderRadius: 8,
            border: '1px solid var(--border)',
            background: 'var(--card)',
          }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="prenotazioni" fill="var(--primary)" radius={[4, 4, 0, 0]} />
        <Bar dataKey="utenti" fill="#22c55e" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}
