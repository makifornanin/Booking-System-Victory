import { botRoute } from "@/lib/bot/http";
import { createBooking } from "@/lib/bot/tools";

export const POST = botRoute("create-booking", createBooking, { createsBooking: true });
