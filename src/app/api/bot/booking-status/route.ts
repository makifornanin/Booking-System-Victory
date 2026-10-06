import { botRoute } from "@/lib/bot/http";
import { bookingStatus } from "@/lib/bot/tools";

export const POST = botRoute("booking-status", bookingStatus);
