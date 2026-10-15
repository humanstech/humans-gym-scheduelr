export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type PtMode = 'pooled' | 'shared' | 'custom' | 'free' | 'voided'

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      admins: {
        Row: {
          created_at: string | null
          email: string
          id: string
        }
        Insert: {
          created_at?: string | null
          email: string
          id?: string
        }
        Update: {
          created_at?: string | null
          email?: string
          id?: string
        }
        Relationships: []
      }
      allowed_domains: {
        Row: {
          created_at: string | null
          domain: string
          id: string
        }
        Insert: {
          created_at?: string | null
          domain: string
          id?: string
        }
        Update: {
          created_at?: string | null
          domain?: string
          id?: string
        }
        Relationships: []
      }
      allowed_emails: {
        Row: {
          created_at: string | null
          email: string
          id: string
          note: string | null
        }
        Insert: {
          created_at?: string | null
          email: string
          id?: string
          note?: string | null
        }
        Update: {
          created_at?: string | null
          email?: string
          id?: string
          note?: string | null
        }
        Relationships: []
      }
      bookings: {
        Row: {
          created_at: string | null
          id: string
          slot_id: string
          user_avatar_url: string | null
          user_email: string
          user_id: string
          user_name: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          slot_id: string
          user_avatar_url?: string | null
          user_email: string
          user_id: string
          user_name: string
        }
        Update: {
          created_at?: string | null
          id?: string
          slot_id?: string
          user_avatar_url?: string | null
          user_email?: string
          user_id?: string
          user_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "bookings_slot_id_fkey"
            columns: ["slot_id"]
            isOneToOne: false
            referencedRelation: "slots"
            referencedColumns: ["id"]
          },
        ]
      }
      pt_memberships: {
        Row: {
          created_at: string
          id: string
          note: string | null
          user_id: string
          valid_from: string
          valid_to: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          note?: string | null
          user_id: string
          valid_from: string
          valid_to?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          note?: string | null
          user_id?: string
          valid_from?: string
          valid_to?: string | null
        }
        Relationships: []
      }
      pt_session_exclusions: {
        Row: {
          created_at: string
          reason: string | null
          slot_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          reason?: string | null
          slot_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          reason?: string | null
          slot_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pt_session_exclusions_slot_id_fkey"
            columns: ["slot_id"]
            isOneToOne: false
            referencedRelation: "slots"
            referencedColumns: ["id"]
          },
        ]
      }
      pt_session_payers: {
        Row: {
          created_at: string
          slot_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          slot_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          slot_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pt_session_payers_slot_id_fkey"
            columns: ["slot_id"]
            isOneToOne: false
            referencedRelation: "slots"
            referencedColumns: ["id"]
          },
        ]
      }
      pt_sessions: {
        Row: {
          billing_mode: 'auto' | 'custom'
          created_at: string
          price_cents: number
          slot_id: string
          source: 'schedule' | 'manual'
          status: 'active' | 'voided'
          voided_at: string | null
          voided_reason: string | null
        }
        Insert: {
          billing_mode?: 'auto' | 'custom'
          created_at?: string
          price_cents: number
          slot_id: string
          source?: 'schedule' | 'manual'
          status?: 'active' | 'voided'
          voided_at?: string | null
          voided_reason?: string | null
        }
        Update: {
          billing_mode?: 'auto' | 'custom'
          created_at?: string
          price_cents?: number
          slot_id?: string
          source?: 'schedule' | 'manual'
          status?: 'active' | 'voided'
          voided_at?: string | null
          voided_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pt_sessions_slot_id_fkey"
            columns: ["slot_id"]
            isOneToOne: true
            referencedRelation: "slots"
            referencedColumns: ["id"]
          },
        ]
      }
      pt_settings: {
        Row: {
          id: boolean
          low_balance_threshold_cents: number
          max_participants: number
          full_session_min: number
          session_price_cents: number
          updated_at: string
        }
        Insert: {
          id?: boolean
          low_balance_threshold_cents?: number
          max_participants?: number
          full_session_min?: number
          session_price_cents?: number
          updated_at?: string
        }
        Update: {
          id?: boolean
          low_balance_threshold_cents?: number
          max_participants?: number
          full_session_min?: number
          session_price_cents?: number
          updated_at?: string
        }
        Relationships: []
      }
      pt_trainers: {
        Row: {
          created_at: string | null
          email: string
          id: string
        }
        Insert: {
          created_at?: string | null
          email: string
          id?: string
        }
        Update: {
          created_at?: string | null
          email?: string
          id?: string
        }
        Relationships: []
      }
      pt_wallet_entries: {
        Row: {
          amount_cents: number
          created_at: string
          created_by_name: string | null
          description: string
          details: Json
          id: string
          kind: 'topup' | 'manual' | 'charge' | 'adjustment'
          session_date: string | null
          session_start: string | null
          slot_id: string | null
          user_id: string
        }
        Insert: {
          amount_cents: number
          created_at?: string
          created_by_name?: string | null
          description: string
          details?: Json
          id?: string
          kind: 'topup' | 'manual' | 'charge' | 'adjustment'
          session_date?: string | null
          session_start?: string | null
          slot_id?: string | null
          user_id: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          created_by_name?: string | null
          description?: string
          details?: Json
          id?: string
          kind?: 'topup' | 'manual' | 'charge' | 'adjustment'
          session_date?: string | null
          session_start?: string | null
          slot_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pt_wallet_entries_slot_id_fkey"
            columns: ["slot_id"]
            isOneToOne: false
            referencedRelation: "slots"
            referencedColumns: ["id"]
          },
        ]
      }
      slots: {
        Row: {
          created_at: string | null
          date: string
          end_time: string
          id: string
          is_cancelled: boolean
          max_capacity: number
          min_capacity: number
          space_id: string
          start_time: string
          updated_at: string
        }
        Insert: {
          created_at?: string | null
          date: string
          end_time: string
          id?: string
          is_cancelled?: boolean
          max_capacity?: number
          min_capacity?: number
          space_id: string
          start_time: string
        }
        Update: {
          created_at?: string | null
          date?: string
          end_time?: string
          id?: string
          is_cancelled?: boolean
          max_capacity?: number
          min_capacity?: number
          space_id?: string
          start_time?: string
        }
        Relationships: [
          {
            foreignKeyName: "slots_space_id_fkey"
            columns: ["space_id"]
            isOneToOne: false
            referencedRelation: "spaces"
            referencedColumns: ["id"]
          },
        ]
      }
      space_time_slots: {
        Row: {
          created_at: string | null
          day_of_week: number
          end_time: string
          id: string
          is_pt: boolean
          space_id: string
          start_time: string
        }
        Insert: {
          created_at?: string | null
          day_of_week: number
          is_pt?: boolean
          end_time: string
          id?: string
          space_id: string
          start_time: string
        }
        Update: {
          created_at?: string | null
          day_of_week?: number
          end_time?: string
          id?: string
          is_pt?: boolean
          space_id?: string
          start_time?: string
        }
        Relationships: [
          {
            foreignKeyName: "space_time_slots_space_id_fkey"
            columns: ["space_id"]
            isOneToOne: false
            referencedRelation: "spaces"
            referencedColumns: ["id"]
          },
        ]
      }
      spaces: {
        Row: {
          allow_multiple_bookings: boolean
          available_days: number[]
          created_at: string | null
          description: string | null
          id: string
          is_active: boolean | null
          max_capacity: number
          min_capacity: number
          name: string
          sort_order: number
        }
        Insert: {
          allow_multiple_bookings?: boolean
          available_days?: number[]
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          max_capacity?: number
          min_capacity?: number
          name: string
          sort_order?: number
        }
        Update: {
          allow_multiple_bookings?: boolean
          available_days?: number[]
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          max_capacity?: number
          min_capacity?: number
          name?: string
          sort_order?: number
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      create_booking: { Args: { slot_id: string }; Returns: string }
      cancel_booking: { Args: { booking_id: string }; Returns: undefined }
      get_slot_bookers: {
        Args: { slot_ids: string[] }
        Returns: { slot_id: string; user_name: string; user_avatar_url: string | null }[]
      }
      is_allowed: { Args: never; Returns: boolean }
      easter_date: { Args: { year: number }; Returns: string }
      generate_slots: { Args: { days_ahead?: number }; Returns: undefined }
      is_admin: { Args: never; Returns: boolean }
      is_italian_holiday: { Args: { d: string }; Returns: boolean }
      is_trainer: { Args: never; Returns: boolean }
      pt_my_status: {
        Args: never
        Returns: {
          is_member: boolean
          valid_from: string | null
          valid_to: string | null
          ever_member: boolean
          balance_cents: number
          low_balance_threshold_cents: number
          session_price_cents: number
          max_participants: number
        }[]
      }
      pt_day_preview: {
        Args: { d: string }
        Returns: {
          slot_id: string
          status: 'active' | 'voided'
          presences: number
          mode: PtMode
          unit_cents: number | null
          my_cents: number | null
          members: number
          next_unit_cents: number | null
          day_closed: boolean
        }[]
      }
      pt_trainer_sessions: {
        Args: { from_date: string; to_date: string }
        Returns: {
          slot_id: string
          date: string
          start_time: string
          end_time: string
          space_name: string
          status: 'active' | 'voided'
          participants: { name: string; avatar_url: string | null }[]
        }[]
      }
      admin_promote_user: { Args: { user_id: string }; Returns: undefined }
      admin_list_users: {
        Args: never
        Returns: {
          user_id: string
          email: string
          full_name: string | null
          avatar_url: string | null
          last_sign_in_at: string | null
          is_admin: boolean
          is_trainer: boolean
          pt_active: boolean
          pt_valid_from: string | null
          pt_valid_to: string | null
          balance_cents: number
        }[]
      }
      pt_save_membership: {
        Args: { membership_id: string | null; user_id: string; valid_from: string; valid_to: string | null }
        Returns: string
      }
      pt_delete_membership: { Args: { membership_id: string }; Returns: undefined }
      pt_add_wallet_entry: {
        Args: { user_id: string; amount_cents: number; kind: 'topup' | 'manual'; note: string }
        Returns: string
      }
      pt_void_session: { Args: { slot_id: string; reason: string }; Returns: undefined }
      pt_restore_session: { Args: { slot_id: string }; Returns: undefined }
      pt_create_session: { Args: { slot_id: string }; Returns: undefined }
      pt_set_exclusion: {
        Args: { slot_id: string; user_id: string; excluded: boolean; reason: string | null }
        Returns: undefined
      }
      pt_set_payers: { Args: { slot_id: string; user_ids: string[]; reason: string | null }; Returns: undefined }
      pt_update_settings: {
        Args: { session_price_cents: number; low_balance_threshold_cents: number; max_participants: number }
        Returns: undefined
      }
      pt_sync_schedule: { Args: { space_id: string }; Returns: number }
      pt_admin_sessions: {
        Args: { from_date: string; to_date: string }
        Returns: {
          slot_id: string
          space_id: string
          space_name: string
          date: string
          start_time: string
          end_time: string
          status: 'active' | 'voided'
          source: 'schedule' | 'manual'
          billing_mode: 'auto' | 'custom'
          price_cents: number
          voided_reason: string | null
          day_closed: boolean
          mode: PtMode
          participants: {
            user_id: string
            name: string
            email: string
            avatar_url: string | null
            excluded: boolean
            counted: boolean
          }[]
          exclusions: { user_id: string; name: string; reason: string | null }[]
          payers: { user_id: string; name: string }[]
          charges: { user_id: string; name: string; amount_cents: number }[]
          total_cents: number
        }[]
      }
      pt_low_balances: {
        Args: never
        Returns: {
          user_id: string
          email: string
          full_name: string | null
          avatar_url: string | null
          balance_cents: number
          pt_active: boolean
        }[]
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const

// Convenience aliases used across the codebase
export type InsertDto<T extends keyof DefaultSchema["Tables"]> =
  DefaultSchema["Tables"][T]["Insert"]
export type UpdateDto<T extends keyof DefaultSchema["Tables"]> =
  DefaultSchema["Tables"][T]["Update"]
