import { botRoute } from "@/lib/bot/http";
import { myBookings } from "@/lib/bot/tools";

export const POST = botRoute("my-bookings", myBookings);
