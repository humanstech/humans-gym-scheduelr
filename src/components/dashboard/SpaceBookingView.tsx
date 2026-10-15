import { useState, useMemo, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { format } from 'date-fns'
import { ChevronLeft } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { DateSelector } from '@/components/dashboard/DateSelector'
import { SlotSection } from '@/components/dashboard/SlotSection'
import { useActiveSpaces } from '@/hooks/useActiveSpaces'
import { useSlots } from '@/hooks/useSlots'
import { useMyBookings, useCreateBooking } from '@/hooks/useBookings'
import { getNextWeekdays } from '@/lib/calendar'

export function SpaceBookingView() {
  const { spaceId } = useParams<{ spaceId: string }>()
  const navigate = useNavigate()
  const { data: spaces = [] } = useActiveSpaces()

  const space = spaces.find(s => s.id === spaceId)
  const isMultiSpace = spaces.length > 1

  const availableDays = space?.available_days ?? []
  const availableDaysKey = availableDays.join(',')

  const days = useMemo(
    () => getNextWeekdays(14, availableDays.length > 0 ? availableDays : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [availableDaysKey]
  )

  const [selectedDate, setSelectedDate] = useState<Date>(() => days[0] ?? getNextWeekdays(14)[0])

  useEffect(() => {
    if (days.length > 0) setSelectedDate(days[0])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableDaysKey])

  const { data: slots, isLoading: slotsLoading } = useSlots(selectedDate, spaceId)
  const { data: myBookings = [] } = useMyBookings()
  const createBooking = useCreateBooking()

  const dateStr = format(selectedDate, 'yyyy-MM-dd')

  const { bookingIdMap, bookedSlotIds } = useMemo(() => {
    const currentSpaceSlotIds = new Set(slots?.map(s => s.id) ?? [])
    const bookingIdMap: Record<string, string> = {}
    const bookedSlotIds: string[] = []
    for (const b of myBookings) {
      bookingIdMap[b.slot_id] = b.id
      if (b.slots?.date === dateStr && currentSpaceSlotIds.has(b.slot_id)) {
        bookedSlotIds.push(b.slot_id)
      }
    }
    return { bookingIdMap, bookedSlotIds }
  }, [myBookings, dateStr, slots])

  const allowMultipleBookings = space?.allow_multiple_bookings ?? false
  // PT sessions are independent of the one-booking-per-day rule: they neither consume it nor are blocked by it.
  const regularBookedCount = useMemo(() => {
    const ptSlotIds = new Set(slots?.filter(s => s.pt_status === 'active').map(s => s.id) ?? [])
    return bookedSlotIds.filter(id => !ptSlotIds.has(id)).length
  }, [bookedSlotIds, slots])
  const hasBookingForDay = !allowMultipleBookings && regularBookedCount > 0

  const handleBook = async (slotId: string) => {
    await createBooking.mutateAsync({
      slotId,
    })
  }

  const morningSlots = useMemo(
    () => slots?.filter(s => parseInt(s.start_time.split(':')[0]) < 12),
    [slots]
  )
  const eveningSlots = useMemo(
    () => slots?.filter(s => parseInt(s.start_time.split(':')[0]) >= 12),
    [slots]
  )

  // If spaces loaded but this spaceId doesn't exist, redirect home
  if (spaces.length > 0 && !space) {
    navigate('/', { replace: true })
    return null
  }

  return (
    <div className="space-y-6">
      {isMultiSpace && (
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="h-4 w-4" />
          Torna agli spazi
        </button>
      )}

      <div>
        <h1 className="text-2xl font-bold">
          {space?.name ? `Prenota in ${space.name}` : 'Prenota una sessione'}
        </h1>
        {space?.description && (
          <p className="mt-0.5 text-sm text-muted-foreground">{space.description}</p>
        )}
        <p className="mt-1 text-muted-foreground">Scegli lo slot che preferisci</p>
      </div>

      <DateSelector days={days} selected={selectedDate} onSelect={setSelectedDate} />

      {slotsLoading ? (
        <div className="space-y-6">
          {[0, 1].map(g => (
            <div key={g} className="space-y-3">
              <Skeleton className="h-4 w-24" />
              {[0, 1, 2].map(i => (
                <Skeleton key={i} className="h-16 w-full rounded-lg" />
              ))}
            </div>
          ))}
        </div>
      ) : !slots || slots.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-card p-8 text-center">
          <p className="text-muted-foreground">
            Nessuno slot disponibile per questo giorno.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          <SlotSection
            title="Mattina"
            slots={morningSlots}
            bookedSlotIds={bookedSlotIds}
            bookingIdMap={bookingIdMap}
            hasBookingForDay={hasBookingForDay}
            onBook={handleBook}
            isAnyBookingPending={createBooking.isPending}
          />
          <SlotSection
            title="Sera"
            slots={eveningSlots}
            bookedSlotIds={bookedSlotIds}
            bookingIdMap={bookingIdMap}
            hasBookingForDay={hasBookingForDay}
            onBook={handleBook}
            isAnyBookingPending={createBooking.isPending}
          />
        </div>
      )}
    </div>
  )
}
