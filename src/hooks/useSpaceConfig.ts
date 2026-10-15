import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

export interface SpaceConfig {
  id: string
  name: string
  description: string | null
  is_active: boolean | null
  max_capacity: number
  min_capacity: number
  available_days: number[]
  allow_multiple_bookings: boolean
  booking_count: number
  sort_order: number
}

export interface SpaceTimeSlot {
  id: string
  space_id: string
  start_time: string
  end_time: string
  day_of_week: number
  is_pt: boolean
}

export function useSpaces() {
  return useQuery({
    queryKey: ['spaces'],
    queryFn: async (): Promise<SpaceConfig[]> => {
      const { data, error } = await supabase
        .from('spaces')
        .select(
          'id, name, description, is_active, max_capacity, min_capacity, available_days, allow_multiple_bookings, sort_order, slots(bookings(id))'
        )
        .order('sort_order')
        .order('created_at')
      if (error) throw error
      return (data ?? []).map(s => ({
        id: s.id,
        name: s.name,
        description: s.description,
        is_active: s.is_active,
        max_capacity: s.max_capacity,
        min_capacity: s.min_capacity,
        available_days: s.available_days ?? [],
        allow_multiple_bookings: s.allow_multiple_bookings,
        sort_order: s.sort_order ?? 0,
        booking_count: (s.slots ?? []).reduce(
          (sum, slot) => sum + (slot.bookings?.length ?? 0),
          0
        ),
      }))
    },
  })
}

export function useSpaceTimeSlots(spaceId: string) {
  return useQuery({
    queryKey: ['space_time_slots', spaceId],
    queryFn: async (): Promise<SpaceTimeSlot[]> => {
      const { data, error } = await supabase
        .from('space_time_slots')
        .select('id, space_id, start_time, end_time, day_of_week, is_pt')
        .eq('space_id', spaceId)
        .order('day_of_week')
        .order('start_time')
      if (error) throw error
      return data ?? []
    },
    enabled: !!spaceId,
  })
}

type UpdateSpaceConfigArgs = {
  id: string
  name?: string
  description?: string | null
  is_active?: boolean
  max_capacity?: number
  min_capacity?: number
  available_days?: number[]
  allow_multiple_bookings?: boolean
}

export function useUpdateSpaceConfig() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...updates }: UpdateSpaceConfigArgs) => {
      const { error } = await supabase.from('spaces').update(updates).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['spaces'] })
    },
  })
}

export function useAddTimeSlot() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      spaceId,
      startTime,
      endTime,
      dayOfWeek,
    }: {
      spaceId: string
      startTime: string
      endTime: string
      dayOfWeek: number
    }) => {
      const { error } = await supabase
        .from('space_time_slots')
        .insert({ space_id: spaceId, start_time: startTime, end_time: endTime, day_of_week: dayOfWeek })
      if (error) throw error
    },
    onSuccess: (_data, { spaceId }) => {
      queryClient.invalidateQueries({ queryKey: ['space_time_slots', spaceId] })
    },
  })
}

export function useCopyDaySlots() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      spaceId,
      slots,
      targetDay,
    }: {
      spaceId: string
      slots: { start_time: string; end_time: string; is_pt: boolean }[]
      targetDay: number
    }) => {
      const rows = slots.map(s => ({
        space_id: spaceId,
        start_time: s.start_time,
        end_time: s.end_time,
        day_of_week: targetDay,
        is_pt: s.is_pt,
      }))
      const { error } = await supabase
        .from('space_time_slots')
        .upsert(rows, { onConflict: 'space_id,day_of_week,start_time,end_time', ignoreDuplicates: true })
      if (error) throw error
    },
    onSuccess: (_data, { spaceId }) => {
      queryClient.invalidateQueries({ queryKey: ['space_time_slots', spaceId] })
    },
  })
}

export function useToggleTimeSlotPt() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, isPt }: { id: string; spaceId: string; isPt: boolean }) => {
      const { error } = await supabase.from('space_time_slots').update({ is_pt: isPt }).eq('id', id)
      if (error) throw error
    },
    onSuccess: (_data, { spaceId }) => {
      queryClient.invalidateQueries({ queryKey: ['space_time_slots', spaceId] })
    },
  })
}

export function useRemoveTimeSlot() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, spaceId }: { id: string; spaceId: string }) => {
      const { error } = await supabase.from('space_time_slots').delete().eq('id', id)
      if (error) throw error
      return spaceId
    },
    onSuccess: (_data, { spaceId }) => {
      queryClient.invalidateQueries({ queryKey: ['space_time_slots', spaceId] })
    },
  })
}

export function useRegenerateSlots() {
  return useMutation({
    mutationFn: async (daysAhead: number = 14) => {
      const { error } = await supabase.rpc('generate_slots', { days_ahead: daysAhead })
      if (error) throw error
    },
  })
}

export function useDeleteSpace() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('spaces').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['spaces'] })
      queryClient.invalidateQueries({ queryKey: ['slots'] })
      queryClient.invalidateQueries({ queryKey: ['bookings'] })
    },
  })
}

export function useReorderSpace() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ spaces }: { spaces: { id: string; sort_order: number }[] }) => {
      const updates = spaces.map(({ id, sort_order }) =>
        supabase.from('spaces').update({ sort_order }).eq('id', id)
      )
      const results = await Promise.all(updates)
      const err = results.find(r => r.error)?.error
      if (err) throw err
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['spaces'] })
    },
  })
}
