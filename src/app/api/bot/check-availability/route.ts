import { botRoute } from "@/lib/bot/http";
import { checkAvailability } from "@/lib/bot/tools";

export const POST = botRoute("check-availability", checkAvailability);
