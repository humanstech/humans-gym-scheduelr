import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { format } from 'date-fns'
import { ptStatusOf } from '@/hooks/useSlots'

export interface Booking {
  id: string
  slot_id: string
  user_id: string
  user_email: string
  user_name: string
  user_avatar_url: string | null
  created_at: string | null
  slots: {
    date: string
    start_time: string
    end_time: string
    spaces: { name: string } | null
    pt_sessions: { status: 'active' | 'voided' } | { status: 'active' | 'voided' }[] | null
  } | null
}

/** True when the booking is on an active personal-trainer session. */
export function isPtBooking(booking: Booking) {
  return ptStatusOf(booking.slots?.pt_sessions) === 'active'
}

export function useMyBookings() {
  return useQuery({
    queryKey: ['myBookings'],
    queryFn: async (): Promise<Booking[]> => {
      const today = format(new Date(), 'yyyy-MM-dd')
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return []

      const { data, error } = await supabase
        .from('bookings')
        .select('*, slots(date, start_time, end_time, spaces(name), pt_sessions(status))')
        .eq('user_id', user.id)
        .gte('slots.date', today)

      if (error) throw error
      return ((data ?? []).filter(b => b.slots !== null) as Booking[]).sort((a, b) => {
        const da = `${a.slots!.date}T${a.slots!.start_time}`
        const db = `${b.slots!.date}T${b.slots!.start_time}`
        return da < db ? -1 : 1
      })
    },
    staleTime: 0,
  })
}

export function useUserBookingForDate(date: Date) {
  const dateStr = format(date, 'yyyy-MM-dd')
  return useQuery({
    queryKey: ['userBookingsForDate', dateStr],
    queryFn: async (): Promise<string[]> => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return []

      const { data, error } = await supabase
        .from('bookings')
        .select('slot_id, slots!inner(date)')
        .eq('user_id', user.id)
        .eq('slots.date', dateStr)

      if (error) throw error
      return (data ?? []).map(b => b.slot_id)
    },
    staleTime: 30 * 1000,
  })
}

export function useCreateBooking() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (params: {
      slotId: string
    }) => {
      const { error } = await supabase.rpc('create_booking', { slot_id: params.slotId })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['slots'] })
      queryClient.invalidateQueries({ queryKey: ['myBookings'] })
      queryClient.invalidateQueries({ queryKey: ['userBookingsForDate'] })
      queryClient.invalidateQueries({ queryKey: ['adminBookings'] })
      queryClient.invalidateQueries({ queryKey: ['pt'] })
    },
  })
}

export function useDeleteBooking() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (bookingId: string) => {
      const { error } = await supabase.rpc('cancel_booking', { booking_id: bookingId })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['slots'] })
      queryClient.invalidateQueries({ queryKey: ['myBookings'] })
      queryClient.invalidateQueries({ queryKey: ['userBookingsForDate'] })
      queryClient.invalidateQueries({ queryKey: ['adminBookings'] })
      queryClient.invalidateQueries({ queryKey: ['pt'] })
    },
  })
}
