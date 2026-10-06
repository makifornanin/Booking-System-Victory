import { botRoute } from "@/lib/bot/http";
import { findAvailableRooms } from "@/lib/bot/tools";

export const POST = botRoute("find-available-rooms", findAvailableRooms);
