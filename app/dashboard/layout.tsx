import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getAuthContext } from "@/lib/supabase/server";

export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  if (!(await getAuthContext())) {
    redirect("/login");
  }

  return <>{children}</>;
}
