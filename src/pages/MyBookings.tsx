import { useMemo } from 'react'
import { format, parseISO } from 'date-fns'
import { it } from 'date-fns/locale'
import { Calendar, Clock, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useMyBookings, useDeleteBooking } from '@/hooks/useBookings'
import { useActiveSpaces } from '@/hooks/useActiveSpaces'
import type { Booking } from '@/hooks/useBookings'

function BookingRow({
  booking,
  onCancel,
  isPending,
}: {
  booking: Booking
  onCancel: (id: string) => void
  isPending: boolean
}) {
  const date = booking.slots ? parseISO(booking.slots.date) : null
  return (
    <div className="flex items-center justify-between rounded-lg border bg-card p-4">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-full bg-primary/10">
          <span className="text-xs font-bold text-primary leading-none">
            {date ? format(date, 'd') : '?'}
          </span>
          <span className="text-[10px] uppercase text-primary/70 leading-none">
            {date ? format(date, 'MMM', { locale: it }) : ''}
          </span>
        </div>
        <div>
          <p className="font-medium">
            {date ? format(date, 'EEEE d MMMM', { locale: it }) : 'Data sconosciuta'}
          </p>
          <div className="mt-0.5 flex items-center gap-1.5 text-sm text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />
            {booking.slots
              ? `${booking.slots.start_time.slice(0, 5)} – ${booking.slots.end_time.slice(0, 5)}`
              : '—'}
          </div>
        </div>
      </div>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Cancella prenotazione"
        onClick={() => onCancel(booking.id)}
        disabled={isPending}
        className="text-muted-foreground hover:text-destructive"
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  )
}

export function MyBookings() {
  const { data: bookings, isLoading } = useMyBookings()
  const { data: spaces = [] } = useActiveSpaces()
  const deleteBooking = useDeleteBooking()
  const isMultiSpace = spaces.length > 1

  const handleCancel = async (bookingId: string) => {
    try {
      await deleteBooking.mutateAsync(bookingId)
      toast.success('Prenotazione cancellata.')
    } catch {
      toast.error('Errore durante la cancellazione. Riprova.')
    }
  }

  // Group bookings by space name when multi-space
  const groupedBookings = useMemo(() => {
    if (!isMultiSpace || !bookings) return null
    const groups: Record<string, Booking[]> = {}
    for (const b of bookings) {
      const spaceName = b.slots?.spaces?.name ?? 'Altro'
      ;(groups[spaceName] ??= []).push(b)
    }
    return groups
  }, [bookings, isMultiSpace])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Le mie prenotazioni</h1>
        <p className="mt-1 text-muted-foreground">Le tue prenotazioni future</p>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2].map(i => (
            <Skeleton key={i} className="h-20 w-full rounded-lg" />
          ))}
        </div>
      ) : !bookings || bookings.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-card p-12 text-center">
          <Calendar className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" />
          <p className="font-medium text-muted-foreground">Nessuna prenotazione</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Vai nella dashboard per prenotare uno slot
          </p>
        </div>
      ) : groupedBookings ? (
        <div className="space-y-6">
          {Object.entries(groupedBookings).map(([spaceName, spaceBookings]) => (
            <div key={spaceName} className="space-y-2">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {spaceName}
              </h2>
              {spaceBookings.map(b => (
                <BookingRow
                  key={b.id}
                  booking={b}
                  onCancel={handleCancel}
                  isPending={deleteBooking.isPending}
                />
              ))}
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {bookings.map(b => (
            <BookingRow
              key={b.id}
              booking={b}
              onCancel={handleCancel}
              isPending={deleteBooking.isPending}
            />
          ))}
        </div>
      )}
    </div>
  )
}
