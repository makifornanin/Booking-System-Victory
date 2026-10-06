import { botRoute } from "@/lib/bot/http";
import { verifyUser } from "@/lib/bot/tools";

export const POST = botRoute("verify-user", verifyUser);
