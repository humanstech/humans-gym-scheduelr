import { cn } from "@/lib/utils"
import type { SpaceTimeSlot } from "@/hooks/useSpaceConfig"

const DAYS = [
  { num: 1, label: "L" },
  { num: 2, label: "M" },
  { num: 3, label: "M" },
  { num: 4, label: "G" },
  { num: 5, label: "V" },
  { num: 6, label: "S" },
  { num: 7, label: "D" },
]

type Props = {
  availableDays: number[]
  timeSlots: SpaceTimeSlot[]
}

export function WeeklySchedulePreview({ availableDays, timeSlots }: Props) {
  const availableSet = new Set(availableDays)
  const hasPt = timeSlots.some(s => s.is_pt && availableSet.has(s.day_of_week))

  return (
    <div className="mt-2">
      <div className="grid grid-cols-7 gap-1" aria-label="Anteprima settimanale">
        {DAYS.map(({ num, label }) => {
          const isAvailable = availableSet.has(num)
          const daySlotsForDay = timeSlots.filter(s => s.day_of_week === num)

          return (
            <div key={num} className="flex flex-col items-center gap-0.5">
              <span
                className={cn(
                  "text-[10px] font-medium leading-none",
                  isAvailable ? "text-muted-foreground" : "text-muted-foreground/40"
                )}
              >
                {label}
              </span>
              <div className="flex w-full flex-col gap-px">
                {!isAvailable ? (
                  <div className="h-1.5 w-full rounded-sm bg-muted/40" />
                ) : daySlotsForDay.length === 0 ? (
                  <div className="h-1.5 w-full rounded-sm bg-primary/15" />
                ) : (
                  daySlotsForDay.map(slot => (
                    <div
                      key={slot.id}
                      title={`${slot.start_time.slice(0, 5)}–${slot.end_time.slice(0, 5)}${slot.is_pt ? " · PT" : ""}`}
                      className={cn("h-1.5 w-full rounded-sm", slot.is_pt ? "bg-violet-500/70" : "bg-primary/60")}
                    />
                  ))
                )}
              </div>
            </div>
          )
        })}
      </div>
      {hasPt && (
        <div className="mt-1.5 flex items-center gap-3 text-[10px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <span className="h-1.5 w-2.5 rounded-sm bg-primary/60" aria-hidden />
            Fascia
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-1.5 w-2.5 rounded-sm bg-violet-500/70" aria-hidden />
            Personal trainer
          </span>
        </div>
      )}
    </div>
  )
}
