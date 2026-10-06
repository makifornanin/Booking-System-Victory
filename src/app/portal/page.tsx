import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";

/** Sends a signed-in person to the right place: admin console, member home, or the access screen. */
export default async function PortalPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.accessStatus !== "active") redirect("/pending");
  redirect(user.role === "admin" ? "/admin" : "/dashboard");
}
