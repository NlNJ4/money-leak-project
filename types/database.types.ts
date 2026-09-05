export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      categories: {
        Row: {
          created_at: string
          icon: string
          id: string
          name_en: string
          name_th: string
          slug: string
          sort_order: number
          type: string
        }
        Insert: {
          created_at?: string
          icon?: string
          id?: string
          name_en: string
          name_th: string
          slug: string
          sort_order?: number
          type: string
        }
        Update: {
          created_at?: string
          icon?: string
          id?: string
          name_en?: string
          name_th?: string
          slug?: string
          sort_order?: number
          type?: string
        }
        Relationships: []
      }
      linking_codes: {
        Row: {
          code: string
          created_at: string
          expires_at: string
          user_id: string
        }
        Insert: {
          code: string
          created_at?: string
          expires_at: string
          user_id: string
        }
        Update: {
          code?: string
          created_at?: string
          expires_at?: string
          user_id?: string
        }
        Relationships: []
      }
      transactions: {
        Row: {
          amount: number
          category_id: string
          created_at: string
          currency: string
          description: string
          id: string
          source: string
          transaction_date: string
          type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount: number
          category_id: string
          created_at?: string
          currency?: string
          description?: string
          id?: string
          source?: string
          transaction_date?: string
          type: string
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          category_id?: string
          created_at?: string
          currency?: string
          description?: string
          id?: string
          source?: string
          transaction_date?: string
          type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transactions_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      user_identities: {
        Row: {
          created_at: string
          id: string
          provider: string
          provider_user_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          provider: string
          provider_user_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          provider?: string
          provider_user_id?: string
          user_id?: string
        }
        Relationships: []
      }
      line_jobs: {
        Row: {
          id: string
          line_user_id: string
          reply_token: string | null
          text: string | null
          status: string
          attempts: number
          next_retry_at: string
          claimed_at: string | null
          last_error: string | null
          received_at: string
          processed_at: string | null
          reply_text: string | null
          line_timestamp: number
          batch_seq: number
        }
        Insert: {
          id: string
          line_user_id: string
          reply_token: string
          text: string
          status?: string
          attempts?: number
          next_retry_at?: string
          claimed_at?: string | null
          last_error?: string | null
          received_at?: string
          processed_at?: string | null
          reply_text?: string | null
          line_timestamp?: number
          batch_seq?: number
        }
        Update: {
          id?: string
          line_user_id?: string
          reply_token?: string | null
          text?: string | null
          status?: string
          attempts?: number
          next_retry_at?: string
          claimed_at?: string | null
          last_error?: string | null
          received_at?: string
          processed_at?: string | null
          reply_text?: string | null
          line_timestamp?: number
          batch_seq?: number
        }
        Relationships: []
      }
      line_command_results: {
        Row: {
          event_key: string
          result: Json
          created_at: string
        }
        Insert: {
          event_key: string
          result: Json
          created_at?: string
        }
        Update: {
          event_key?: string
          result?: Json
          created_at?: string
        }
        Relationships: []
      }
      line_worker_tokens: {
        Row: {
          token: string
          created_at: string
        }
        Insert: {
          token: string
          created_at?: string
        }
        Update: {
          token?: string
          created_at?: string
        }
        Relationships: []
      }
      webhook_events: {
        Row: {
          id: string
          received_at: string
        }
        Insert: {
          id: string
          received_at?: string
        }
        Update: {
          id?: string
          received_at?: string
        }
        Relationships: []
      }
      deleted_transaction_staging: {
        Row: {
          id: string
          user_id: string
          payload: Json
          deleted_at: string
        }
        Insert: {
          id: string
          user_id: string
          payload: Json
          deleted_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          payload?: Json
          deleted_at?: string
        }
        Relationships: []
      }
      line_redeem_attempts: {
        Row: {
          line_user_id: string
          window_start: string
          count: number
        }
        Insert: {
          line_user_id: string
          window_start?: string
          count?: number
        }
        Update: {
          line_user_id?: string
          window_start?: string
          count?: number
        }
        Relationships: []
      }
      line_metrics: {
        Row: {
          day: string
          key: string
          count: number
        }
        Insert: {
          day: string
          key: string
          count?: number
        }
        Update: {
          day?: string
          key?: string
          count?: number
        }
        Relationships: []
      }
      worker_heartbeat: {
        Row: {
          id: number
          last_run_at: string
        }
        Insert: {
          id?: number
          last_run_at?: string
        }
        Update: {
          id?: number
          last_run_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      claim_due_line_jobs: {
        Args: {
          p_limit: number
        }
        Returns: line_jobs[]
      }
      dashboard_summary: {
        Args: {
          p_from: string
          p_to: string
        }
        Returns: Json
      }
      delete_latest_line_transaction: {
        Args: {
          p_event_key: string
          p_line_user_id: string
        }
        Returns: Json
      }
      create_linking_code: {
        Args: {
          p_user_id: string
          p_code: string
          p_expires_at: string
        }
        Returns: undefined
      }
      line_range_summary: {
        Args: {
          p_user_id: string
          p_from: string
          p_to: string
        }
        Returns: Json
      }
      restore_latest_line_transaction: {
        Args: {
          p_event_key: string
          p_line_user_id: string
        }
        Returns: Json
      }
      update_latest_line_transaction_amount: {
        Args: {
          p_event_key: string
          p_line_user_id: string
          p_amount: number
        }
        Returns: Json
      }
      redeem_linking_code: {
        Args: {
          p_event_key: string
          p_code: string
          p_provider: string
          p_provider_user_id: string
        }
        Returns: string
      }
      register_redeem_attempt: {
        Args: {
          p_line_user_id: string
        }
        Returns: boolean
      }
      bump_metrics: {
        Args: {
          p_keys: string[]
        }
        Returns: undefined
      }
      touch_heartbeat: {
        Args: Record<string, never>
        Returns: undefined
      }
      save_line_transaction: {
        Args: {
          p_event_key: string
          p_user_id: string
          p_type: string
          p_amount: number
          p_category_slug: string
          p_description: string
          p_transaction_date: string
        }
        Returns: string
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

export const Constants = {
  public: {
    Enums: {},
  },
} as const

export type line_jobs = Database["public"]["Tables"]["line_jobs"]["Row"]
