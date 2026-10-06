import { botRoute } from "@/lib/bot/http";
import { getSchedule } from "@/lib/bot/tools";

export const POST = botRoute("schedule", getSchedule);
