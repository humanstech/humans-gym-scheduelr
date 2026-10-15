import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts'
import type { AdminBooking } from '@/pages/Admin'

interface UserChartProps {
  bookings: AdminBooking[]
}

export function UserChart({ bookings }: UserChartProps) {
  const userMap: Record<string, number> = {}

  for (const b of bookings) {
    const name = b.user_name || b.user_email
    userMap[name] = (userMap[name] ?? 0) + 1
  }

  const data = Object.entries(userMap)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([name, count]) => ({ name: name.split(' ')[0], fullName: name, count }))

  if (data.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center rounded-lg border border-dashed text-muted-foreground">
        Nessun dato da visualizzare
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart
        layout="vertical"
        data={data}
        margin={{ top: 4, right: 24, left: 8, bottom: 4 }}
      >
        <CartesianGrid strokeDasharray="3 3" horizontal={false} className="stroke-border" />
        <XAxis
          type="number"
          allowDecimals={false}
          tick={{ fontSize: 11 }}
          className="fill-muted-foreground"
        />
        <YAxis
          type="category"
          dataKey="name"
          width={64}
          tick={{ fontSize: 12 }}
          className="fill-muted-foreground"
        />
        <Tooltip
          contentStyle={{
            borderRadius: 8,
            border: '1px solid var(--border)',
            background: 'var(--card)',
          }}
          formatter={(value, _, props) => [
            `${value} prenotazioni`,
            props.payload?.fullName,
          ]}
        />
        <Bar dataKey="count" radius={[0, 4, 4, 0]} maxBarSize={28}>
          {data.map((_, i) => {
            const BAR_OPACITY_BASE = 0.85
            const BAR_OPACITY_STEP = 0.06
            return <Cell key={i} fill="var(--primary)" opacity={BAR_OPACITY_BASE - i * BAR_OPACITY_STEP} />
          })}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
