import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { format } from 'date-fns'

export interface SlotWithCount {
  id: string
  date: string
  start_time: string
  end_time: string
  max_capacity: number
  min_capacity: number
  is_cancelled: boolean
  booking_count: number
  bookers: { name: string; avatarUrl?: string }[]
  space_name?: string
}

export function useSlots(date: Date, spaceId?: string) {
  const dateStr = format(date, 'yyyy-MM-dd')
  const queryClient = useQueryClient()

  // Supabase Realtime: invalidate cache when any booking changes for this date/space
  useEffect(() => {
    const channelName = spaceId ? `bookings:${dateStr}:${spaceId}` : `bookings:${dateStr}`
    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'slots' },
        () => {
          queryClient.invalidateQueries({ queryKey: ['slots', dateStr, spaceId] })
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [dateStr, spaceId, queryClient])

  return useQuery({
    queryKey: ['slots', dateStr, spaceId],
    queryFn: async (): Promise<SlotWithCount[]> => {
      let query = supabase
        .from('slots')
        .select('id, date, start_time, end_time, max_capacity, min_capacity, is_cancelled, spaces(name)')
        .eq('date', dateStr)
        .order('start_time')

      if (spaceId) {
        query = query.eq('space_id', spaceId)
      }

      const { data: slots, error } = await query

      if (error) throw error
      if (!slots) return []

      const slotIds = slots.map(s => s.id)
      const { data: bookings, error: bError } = await supabase
        .rpc('get_slot_bookers', { slot_ids: slotIds })

      if (bError) throw bError

      const countMap: Record<string, number> = {}
      const bookersMap: Record<string, { name: string; avatarUrl?: string }[]> = {}
      for (const b of bookings ?? []) {
        countMap[b.slot_id] = (countMap[b.slot_id] ?? 0) + 1
        if (!bookersMap[b.slot_id]) bookersMap[b.slot_id] = []
        bookersMap[b.slot_id].push({ name: b.user_name ?? '', avatarUrl: b.user_avatar_url ?? undefined })
      }

      return slots.map(s => {
        const { spaces, ...rest } = s
        return {
          ...rest,
          booking_count: countMap[s.id] ?? 0,
          bookers: bookersMap[s.id] ?? [],
          space_name: spaces?.name,
        }
      })
    },
    staleTime: 0,
    refetchInterval: 10 * 1000,
  })
}
