import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { LoginPanel } from "@/components/auth/login-panel";

export default async function LoginPage({
  searchParams,
}: PageProps<"/login">) {
  const { error } = await searchParams;

  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (data.user) {
    redirect("/dashboard");
  }

  return <LoginPanel hasError={error === "auth"} />;
}
