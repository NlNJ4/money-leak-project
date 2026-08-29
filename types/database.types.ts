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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      dashboard_summary: {
        Args: {
          p_from: string
          p_to: string
        }
        Returns: Json
      }
      redeem_linking_code: {
        Args: {
          p_code: string
          p_provider: string
          p_provider_user_id: string
        }
        Returns: string
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
