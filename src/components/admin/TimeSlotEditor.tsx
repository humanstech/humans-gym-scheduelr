import { useState } from 'react'
import { Plus, Trash2, Copy, Dumbbell } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { toast } from 'sonner'
import { useSpaceTimeSlots, useAddTimeSlot, useRemoveTimeSlot, useCopyDaySlots, useToggleTimeSlotPt } from '@/hooks/useSpaceConfig'

const DAY_LABELS: Record<number, string> = {
  1: "Lun", 2: "Mar", 3: "Mer", 4: "Gio", 5: "Ven", 6: "Sab", 7: "Dom",
}

const DURATIONS = [
  { label: '30 min', minutes: 30 },
  { label: '1h', minutes: 60 },
  { label: '1h 30', minutes: 90 },
  { label: '2h', minutes: 120 },
]

function buildTimeOptions(): string[] {
  const options: string[] = []
  for (let h = 5; h <= 23; h++) {
    for (let m = 0; m < 60; m += 15) {
      options.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`)
    }
  }
  return options
}

const TIME_OPTIONS = buildTimeOptions()

function addMinutes(time: string, minutes: number): string | null {
  const [h, m] = time.split(':').map(Number)
  const total = h * 60 + m + minutes
  if (total > 24 * 60) return null
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

const fmt = (t: string) => t.slice(0, 5)

interface TimeSlotEditorProps {
  spaceId: string
  availableDays: number[]
}

export function TimeSlotEditor({ spaceId, availableDays }: TimeSlotEditorProps) {
  const sortedDays = [...availableDays].sort((a, b) => a - b)
  const [selectedDay, setSelectedDay] = useState<number>(sortedDays[0] ?? 1)
  const [startTime, setStartTime] = useState('07:00')
  const [durationMinutes, setDurationMinutes] = useState(60)
  const [copyTarget, setCopyTarget] = useState<string>('')

  const { data: slots = [], isLoading } = useSpaceTimeSlots(spaceId)
  const addSlot = useAddTimeSlot()
  const removeSlot = useRemoveTimeSlot()
  const copySlots = useCopyDaySlots()
  const togglePt = useToggleTimeSlotPt()

  const daySlots = slots.filter(s => s.day_of_week === selectedDay)
  const endTime = addMinutes(startTime, durationMinutes)
  const otherDays = sortedDays.filter(d => d !== selectedDay)

  const handleAdd = () => {
    if (!endTime) {
      toast.error("L'orario di fine supera la mezzanotte.")
      return
    }
    const duplicate = daySlots.some(s => fmt(s.start_time) === startTime && fmt(s.end_time) === endTime)
    if (duplicate) {
      toast.error('Questa fascia oraria esiste già per questo giorno.')
      return
    }
    addSlot.mutate(
      { spaceId, startTime, endTime, dayOfWeek: selectedDay },
      {
        onSuccess: () => toast.success('Fascia oraria aggiunta.'),
        onError: () => toast.error("Errore durante l'aggiunta."),
      }
    )
  }

  const handleCopy = async () => {
    if (!copyTarget || daySlots.length === 0) return
    const targets = copyTarget === 'all' ? otherDays : [Number(copyTarget)]
    try {
      await Promise.all(
        targets.map(targetDay =>
          copySlots.mutateAsync({ spaceId, slots: daySlots, targetDay })
        )
      )
      const label = copyTarget === 'all'
        ? 'tutti i giorni'
        : DAY_LABELS[Number(copyTarget)]
      toast.success(`Fasce copiate su ${label}.`)
      setCopyTarget('')
    } catch {
      toast.error('Errore durante la copia.')
    }
  }

  const handleTogglePt = (id: string, isPt: boolean) => {
    togglePt.mutate(
      { id, spaceId, isPt },
      { onError: () => toast.error("Errore durante l'aggiornamento della fascia.") }
    )
  }

  const handleRemove = (id: string) => {
    removeSlot.mutate(
      { id, spaceId },
      {
        onSuccess: () => toast.success('Fascia oraria rimossa.'),
        onError: () => toast.error('Errore durante la rimozione.'),
      }
    )
  }

  if (sortedDays.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-4 text-center">
        <p className="text-sm text-muted-foreground">
          Abilita almeno un giorno per configurare le fasce orarie.
        </p>
      </div>
    )
  }

  return (
    <Tabs
      value={String(selectedDay)}
      onValueChange={v => setSelectedDay(Number(v))}
    >
      <TabsList className="mb-3 flex-wrap h-auto gap-1">
        {sortedDays.map(day => {
          const count = slots.filter(s => s.day_of_week === day).length
          return (
            <TabsTrigger key={day} value={String(day)} className="text-xs px-3 py-1.5 gap-1.5">
              {DAY_LABELS[day]}
              {count > 0 && (
                <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary/15 px-1 text-[10px] font-medium text-primary">
                  {count}
                </span>
              )}
            </TabsTrigger>
          )
        })}
      </TabsList>

      {sortedDays.map(day => (
        <TabsContent key={day} value={String(day)} className="space-y-3 mt-0">
          {/* Slot list */}
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Caricamento…</p>
          ) : daySlots.length === 0 ? (
            <div className="rounded-md border border-dashed py-3 px-4 text-center">
              <p className="text-xs text-muted-foreground">
                Nessuna fascia per {DAY_LABELS[day]} — aggiungi la prima qui sotto.
              </p>
            </div>
          ) : (
            <ul className="space-y-1">
              {daySlots.map(slot => (
                <li
                  key={slot.id}
                  className="group flex items-center justify-between rounded-md border bg-background px-3 py-2 text-sm hover:border-border/80 transition-colors"
                >
                  <div className="flex items-center gap-2.5">
                    <span className="font-mono text-xs tracking-wide">
                      {fmt(slot.start_time)} – {fmt(slot.end_time)}
                    </span>
                    <button
                      type="button"
                      aria-pressed={slot.is_pt}
                      onClick={() => handleTogglePt(slot.id, !slot.is_pt)}
                      disabled={togglePt.isPending && togglePt.variables?.id === slot.id}
                      title={slot.is_pt ? 'Fascia riservata al Personal Trainer' : 'Riserva questa fascia al Personal Trainer'}
                      aria-label={`${slot.is_pt ? 'Rimuovi' : 'Riserva'} PT per la fascia ${fmt(slot.start_time)}–${fmt(slot.end_time)}`}
                      className={cn(
                        'inline-flex h-5 items-center gap-1 rounded-full border px-1.5 text-[10px] font-medium transition-colors disabled:opacity-50',
                        slot.is_pt
                          ? 'border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300'
                          : 'border-dashed border-input text-muted-foreground/70 hover:border-violet-500/40 hover:text-violet-700 dark:hover:text-violet-300'
                      )}
                    >
                      <Dumbbell className="h-3 w-3" />
                      PT
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemove(slot.id)}
                    disabled={removeSlot.isPending}
                    className="p-1 text-muted-foreground/50 hover:text-destructive transition-colors disabled:opacity-30 disabled:cursor-not-allowed group-hover:text-muted-foreground"
                    aria-label={`Rimuovi fascia ${fmt(slot.start_time)}–${fmt(slot.end_time)}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/* Add new slot */}
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={startTime}
              onChange={e => setStartTime(e.target.value)}
              className="h-8 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
              aria-label="Orario inizio"
            >
              {TIME_OPTIONS.map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            <select
              value={durationMinutes}
              onChange={e => setDurationMinutes(Number(e.target.value))}
              className="h-8 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
              aria-label="Durata"
            >
              {DURATIONS.map(d => (
                <option key={d.minutes} value={d.minutes}>{d.label}</option>
              ))}
            </select>
            {endTime && (
              <span className="font-mono text-xs text-muted-foreground">
                → {endTime}
              </span>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={handleAdd}
              disabled={addSlot.isPending || !endTime}
              className="shrink-0 h-8 text-xs"
            >
              <Plus className="h-3.5 w-3.5" />
              Aggiungi
            </Button>
          </div>

          {daySlots.some(s => s.is_pt) && (
            <p className="text-xs text-muted-foreground">
              Le fasce <span className="font-medium text-violet-700 dark:text-violet-300">PT</span> diventano
              sedute riservate agli iscritti quando salvi lo spazio.
            </p>
          )}

          {/* Copy to another day */}
          {daySlots.length > 0 && otherDays.length > 0 && (
            <div className={cn(
              "flex flex-wrap items-center gap-2 rounded-md bg-muted/50 px-3 py-2"
            )}>
              <Copy className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Copia su</span>
              <select
                value={copyTarget}
                onChange={e => setCopyTarget(e.target.value)}
                className="h-7 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                aria-label="Giorno di destinazione"
              >
                <option value="">— scegli —</option>
                {otherDays.map(d => (
                  <option key={d} value={String(d)}>{DAY_LABELS[d]}</option>
                ))}
                <option value="all">Tutti gli altri</option>
              </select>
              <Button
                size="sm"
                variant="ghost"
                onClick={handleCopy}
                disabled={!copyTarget || copySlots.isPending}
                className="shrink-0 h-7 text-xs px-2"
              >
                Copia
              </Button>
            </div>
          )}
        </TabsContent>
      ))}
    </Tabs>
  )
}
