import { useState } from 'react'
import { format } from 'date-fns'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { ptErrorMessage, useConvertibleSlots, useCreateSession } from '@/hooks/usePtAdmin'
import { fmtTime, formatDay, todayISO } from '@/components/admin/ptFormat'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called with the date of the created session so the week view can jump there. */
  onCreated?: (date: string) => void
}

export function AddSessionDialog({ open, onOpenChange, onCreated }: Props) {
  const today = todayISO()
  const [date, setDate] = useState(today)
  const [slotId, setSlotId] = useState<string | null>(null)
  const { data: slots = [], isLoading } = useConvertibleSlots(open && date >= today ? date : null)
  const create = useCreateSession()

  const nowTime = format(new Date(), 'HH:mm:ss')
  const available = slots.filter(s => date > today || s.start_time > nowTime)

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setDate(todayISO())
      setSlotId(null)
    }
    onOpenChange(next)
  }

  const handleCreate = () => {
    if (!slotId) return
    create.mutate(slotId, {
      onSuccess: () => {
        toast.success('Seduta PT aggiunta')
        onCreated?.(date)
        handleOpenChange(false)
      },
      onError: err => toast.error(ptErrorMessage(err)),
    })
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Aggiungi seduta PT</DialogTitle>
          <DialogDescription>
            Converti un singolo slot futuro in seduta PT. Sarà prenotabile solo dagli iscritti, fino alla capienza PT.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor="add-session-date">Data</Label>
          <Input
            id="add-session-date"
            type="date"
            value={date}
            min={today}
            onChange={e => {
              setDate(e.target.value)
              setSlotId(null)
            }}
            className="w-44"
          />
        </div>

        <fieldset className="space-y-1.5">
          <legend className="mb-1.5 text-sm font-medium">Slot</legend>
          {!date || date < today ? (
            <p className="text-sm text-muted-foreground">Scegli una data da oggi in poi.</p>
          ) : isLoading ? (
            <div className="space-y-1.5">
              {[0, 1, 2].map(i => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : available.length === 0 ? (
            <div className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
              Nessuno slot disponibile {formatDay(date, 'EEEE d MMMM')}.
            </div>
          ) : (
            <div className="space-y-1.5" role="radiogroup">
              {available.map(s => (
                <label
                  key={s.id}
                  className={cn(
                    'flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-sm transition-colors',
                    slotId === s.id ? 'border-violet-500/50 bg-violet-500/10' : 'hover:bg-accent/40'
                  )}
                >
                  <input
                    type="radio"
                    name="add-session-slot"
                    value={s.id}
                    checked={slotId === s.id}
                    onChange={() => setSlotId(s.id)}
                    className="accent-violet-600"
                  />
                  <span className="font-mono text-xs">{fmtTime(s.start_time)}–{fmtTime(s.end_time)}</span>
                  <span className="truncate">{s.space_name}</span>
                </label>
              ))}
            </div>
          )}
        </fieldset>

        <DialogFooter>
          <DialogClose render={<Button type="button" variant="outline" />}>Annulla</DialogClose>
          <Button onClick={handleCreate} disabled={!slotId || create.isPending}>
            {create.isPending ? 'Conversione…' : 'Aggiungi seduta'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
