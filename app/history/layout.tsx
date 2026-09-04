import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/supabase/server";

export default async function HistoryLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const auth = await getAuthContext();
  if (!auth) {
    redirect("/login");
  }
  return <>{children}</>;
}
