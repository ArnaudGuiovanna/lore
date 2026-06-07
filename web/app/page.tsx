import { redirect } from "next/navigation";
import { getSession, roleHome } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await getSession();
  redirect(session ? roleHome(session.role) : "/login");
}
