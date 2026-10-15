import { format, parseISO } from 'date-fns'
import { it } from 'date-fns/locale'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Dot,
} from 'recharts'
import type { AdminBooking } from '@/pages/Admin'

interface SpaceOption {
  id: string
  name: string
}

interface UsageChartProps {
  bookings: AdminBooking[]
  spaces?: SpaceOption[]
}

const SPACE_COLORS = [
  'var(--primary)',
  '#f97316',
  '#22c55e',
  '#a855f7',
  '#eab308',
  '#ec4899',
]

export function UsageChart({ bookings, spaces }: UsageChartProps) {
  const isMultiSpace = spaces && spaces.length > 1

  if (isMultiSpace) {
    // Build date → { [spaceName]: count } map
    const dateSpaceMap: Record<string, Record<string, number>> = {}

    for (const b of bookings) {
      if (!b.slots) continue
      const date = b.slots.date
      const spaceName = b.slots.spaces?.name ?? b.slots.space_id
      if (!dateSpaceMap[date]) dateSpaceMap[date] = {}
      dateSpaceMap[date][spaceName] = (dateSpaceMap[date][spaceName] ?? 0) + 1
    }

    const data = Object.entries(dateSpaceMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, spaceMap]) => ({
        label: format(parseISO(date), 'EEE d', { locale: it }),
        ...spaceMap,
      }))

    if (data.length === 0) {
      return (
        <div className="flex h-48 items-center justify-center rounded-lg border border-dashed text-muted-foreground">
          Nessun dato da visualizzare
        </div>
      )
    }

    return (
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} className="fill-muted-foreground" />
          <YAxis allowDecimals={false} tick={{ fontSize: 11 }} className="fill-muted-foreground" />
          <Tooltip
            contentStyle={{
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'var(--card)',
            }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {spaces.map((space, i) => (
            <Line
              key={space.id}
              type="monotone"
              dataKey={space.name}
              stroke={SPACE_COLORS[i % SPACE_COLORS.length]}
              strokeWidth={2}
              dot={<Dot r={3} fill={SPACE_COLORS[i % SPACE_COLORS.length]} />}
              activeDot={{ r: 5 }}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    )
  }

  // Single-space / aggregate view
  const dateMap: Record<string, number> = {}

  for (const b of bookings) {
    if (!b.slots) continue
    const date = b.slots.date
    dateMap[date] = (dateMap[date] ?? 0) + 1
  }

  const data = Object.entries(dateMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({
      label: format(parseISO(date), 'EEE d', { locale: it }),
      count,
    }))

  if (data.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center rounded-lg border border-dashed text-muted-foreground">
        Nessun dato da visualizzare
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
        <XAxis dataKey="label" tick={{ fontSize: 11 }} className="fill-muted-foreground" />
        <YAxis allowDecimals={false} tick={{ fontSize: 11 }} className="fill-muted-foreground" />
        <Tooltip
          contentStyle={{
            borderRadius: 8,
            border: '1px solid var(--border)',
            background: 'var(--card)',
          }}
          formatter={(value) => [`${value} prenotazioni`, 'Giorno']}
        />
        <Line
          type="monotone"
          dataKey="count"
          stroke="var(--primary)"
          strokeWidth={2}
          dot={<Dot r={3} fill="var(--primary)" />}
          activeDot={{ r: 5 }}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}
