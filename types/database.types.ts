export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      line_users: {
        Row: {
          id: string;
          line_user_id: string;
          display_name: string | null;
          daily_budget_baht: number;
          monthly_budget_baht: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          line_user_id: string;
          display_name?: string | null;
          daily_budget_baht?: number;
          monthly_budget_baht?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          line_user_id?: string;
          display_name?: string | null;
          daily_budget_baht?: number;
          monthly_budget_baht?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      expenses: {
        Row: {
          id: string;
          line_user_id: string;
          title: string;
          amount_baht: number;
          category: string;
          is_need: boolean;
          spent_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          line_user_id: string;
          title: string;
          amount_baht: number;
          category: string;
          is_need?: boolean;
          spent_at?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          line_user_id?: string;
          title?: string;
          amount_baht?: number;
          category?: string;
          is_need?: boolean;
          spent_at?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "expenses_line_user_id_fkey";
            columns: ["line_user_id"];
            isOneToOne: false;
            referencedRelation: "line_users";
            referencedColumns: ["line_user_id"];
          },
        ];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
