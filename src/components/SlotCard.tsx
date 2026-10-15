import { useEffect, useState } from 'react'
import { Users, AlertTriangle, XCircle, Lock } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage, AvatarGroup, AvatarGroupCount } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'
import type { SlotWithCount } from '@/hooks/useSlots'
import { useDeleteBooking } from '@/hooks/useBookings'

interface SlotCardProps {
  slot: SlotWithCount
  isBooked: boolean
  bookingId?: string
  hasBookingForDay?: boolean
  onBook: (slotId: string) => Promise<void>
  isAnyBookingPending: boolean
}

function formatTime(t: string) {
  return t.slice(0, 5)
}

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/)
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
  return name.slice(0, 2).toUpperCase() || '?'
}

const MAX_VISIBLE = 5

function firstName(fullName: string) {
  return fullName.trim().split(/\s+/)[0] ?? fullName.trim()
}

function BookerPile({ bookers }: { bookers: { name: string; avatarUrl?: string }[] }) {
  if (bookers.length === 0) return null
  const visible = bookers.slice(0, MAX_VISIBLE)
  const overflow = bookers.length - MAX_VISIBLE
  const firstNames = bookers.map(b => firstName(b.name)).filter(Boolean)
  return (
    <div className="mt-3 flex items-center gap-2.5 min-w-0">
      <AvatarGroup className="shrink-0">
        {visible.map((b) => (
          <div key={b.name} className="group/tip relative">
            <Avatar size="sm">
              {b.avatarUrl && <AvatarImage src={b.avatarUrl} alt={b.name} referrerPolicy="no-referrer" />}
              <AvatarFallback>{getInitials(b.name)}</AvatarFallback>
            </Avatar>
            <div className="pointer-events-none absolute bottom-full left-1/2 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded bg-foreground px-2 py-1 text-xs text-background opacity-0 transition-opacity group-hover/tip:opacity-100 z-10 hidden sm:block">
              {b.name}
            </div>
          </div>
        ))}
        {overflow > 0 && (
          <AvatarGroupCount className="text-xs">+{overflow}</AvatarGroupCount>
        )}
      </AvatarGroup>
      <p className="truncate text-xs text-muted-foreground">
        {firstNames.slice(0, MAX_VISIBLE).join(', ')}{overflow > 0 ? ` +${overflow}` : ''}
      </p>
    </div>
  )
}

export function SlotCard({ slot, isBooked, bookingId, hasBookingForDay, onBook, isAnyBookingPending }: SlotCardProps) {
  const available = slot.max_capacity - slot.booking_count
  const isFull = available <= 0
  const isUnderMin = slot.booking_count < slot.min_capacity

  const slotStart = new Date(`${slot.date}T${slot.start_time}`)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15_000)
    return () => window.clearInterval(timer)
  }, [])
  const isCutoffPassed = slotStart.getTime() - now <= 15 * 60 * 1000
  const deleteBooking = useDeleteBooking()

  const handleBook = async () => {
    try {
      await onBook(slot.id)
      toast.success('Prenotazione confermata!')
    } catch {
      toast.error('Errore durante la prenotazione. Riprova.')
    }
  }

  const handleCancel = async () => {
    if (!bookingId) return
    try {
      await deleteBooking.mutateAsync(bookingId)
      toast.success('Prenotazione cancellata.')
    } catch {
      toast.error('Errore durante la cancellazione. Riprova.')
    }
  }

  // "Chiuso" → grafica prominente tratteggiata
  if (isCutoffPassed && !isBooked) {
    return (
      <div className="rounded-lg border border-dashed bg-muted/40 p-4 opacity-60">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-xl font-bold tracking-tight leading-none text-muted-foreground">
              {formatTime(slot.start_time)} – {formatTime(slot.end_time)}
            </p>
            <p className="mt-1.5 text-xs text-muted-foreground flex items-center gap-1">
              <Lock className="h-3 w-3 shrink-0" />
              Prenotazioni chiuse per questo slot
            </p>
          </div>
          <Badge variant="secondary" className="shrink-0">Chiuso</Badge>
        </div>
      </div>
    )
  }

  return (
    <div
      className={cn(
        'rounded-lg border bg-card p-4 transition-colors',
        isBooked && 'border-primary/30 bg-primary/5',
        isFull && !isBooked && 'opacity-60'
      )}
    >
      {/* Row 1: time + status/action */}
      <div className="flex items-start justify-between gap-2">
        <p className="text-xl font-bold tracking-tight leading-none">
          {formatTime(slot.start_time)} – {formatTime(slot.end_time)}
        </p>
        <div className="flex shrink-0 items-center gap-1.5">
          {isBooked ? (
            <Badge variant="default" className="bg-primary/20 text-primary hover:bg-primary/20 shrink-0">
              Prenotato
            </Badge>
          ) : slot.is_cancelled ? (
            <Badge variant="secondary" className="flex items-center gap-1 shrink-0">
              <XCircle className="h-3 w-3" />Annullato
            </Badge>
          ) : isFull ? (
            <Badge variant="secondary">Completo</Badge>
          ) : hasBookingForDay ? (
            <Badge variant="secondary" className="text-[11px]">Hai già uno slot</Badge>
          ) : (
            <Button size="sm" onClick={handleBook} disabled={isAnyBookingPending}>
              Prenota
            </Button>
          )}
        </div>
      </div>

      {/* Row 2: meta */}
      <div className="mt-1.5 flex items-center gap-3 text-xs text-muted-foreground">
        {slot.space_name && <span>{slot.space_name}</span>}
        <span>+15 min uscita</span>
        <span className="flex items-center gap-1">
          <Users className="h-3 w-3" />
          {slot.booking_count}/{slot.max_capacity} posti
        </span>
      </div>

      {/* Bookers */}
      <BookerPile bookers={slot.bookers} />

      {/* Cancel button — own row when booked */}
      {isBooked && (
        <div className="mt-3 flex justify-end">
          <Button
            variant="outline"
            size="sm"
            onClick={handleCancel}
            disabled={deleteBooking.isPending || isCutoffPassed}
            className="text-destructive hover:text-destructive"
          >
            Cancella prenotazione
          </Button>
        </div>
      )}

      {/* Under-minimum warning */}
      {!isFull && isUnderMin && (
        <div className="mt-3 flex items-start gap-1.5 rounded-md border border-yellow-200 bg-yellow-50 px-3 py-2 text-xs text-yellow-700 dark:border-yellow-800/50 dark:bg-yellow-900/20 dark:text-yellow-400">
          <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
          <span>
            Min. {slot.min_capacity} partecipanti — attualmente {slot.booking_count}.
            Annullato se non raggiunto entro 15 min dall'inizio.
          </span>
        </div>
      )}
    </div>
  )
}
