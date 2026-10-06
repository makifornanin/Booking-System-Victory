import { botRoute } from "@/lib/bot/http";
import { suggestAlternatives } from "@/lib/bot/tools";

export const POST = botRoute("suggest-alternatives", suggestAlternatives);
