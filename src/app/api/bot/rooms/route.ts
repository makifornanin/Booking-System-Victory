import { botRoute } from "@/lib/bot/http";
import { listRooms } from "@/lib/bot/tools";

export const POST = botRoute("rooms", listRooms);
