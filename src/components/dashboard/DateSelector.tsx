import { format } from 'date-fns'
import { it } from 'date-fns/locale'
import { cn } from '@/lib/utils'

export function DateSelector({
  days,
  selected,
  onSelect,
}: {
  days: Date[]
  selected: Date
  onSelect: (d: Date) => void
}) {
  return (
    <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
      {days.map(day => {
        const isSelected = format(day, 'yyyy-MM-dd') === format(selected, 'yyyy-MM-dd')
        return (
          <button
            key={day.toISOString()}
            data-date={format(day, 'yyyy-MM-dd')}
            onClick={() => onSelect(day)}
            className={cn(
              'flex shrink-0 flex-col items-center rounded-lg border px-3 py-2 text-sm transition-colors',
              isSelected
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-card hover:border-primary/50 hover:bg-accent'
            )}
          >
            <span className="text-[10px] font-medium uppercase opacity-70 leading-tight">
              {format(day, 'EEE', { locale: it })}
            </span>
            <span className="text-base font-bold leading-tight">
              {format(day, 'd')}
            </span>
            <span className="text-[10px] opacity-70 leading-tight">
              {format(day, 'MMM', { locale: it })}
            </span>
          </button>
        )
      })}
    </div>
  )
}
