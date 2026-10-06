import { getNeonAuth } from "@/lib/auth/neon-instance";

type Context = { params: Promise<{ path: string[] }> };

// Proxies auth requests (session refresh, sign-out, password reset links) to Neon Auth.
export const GET = (request: Request, context: Context) => getNeonAuth().handler().GET(request, context);
export const POST = (request: Request, context: Context) => getNeonAuth().handler().POST(request, context);
