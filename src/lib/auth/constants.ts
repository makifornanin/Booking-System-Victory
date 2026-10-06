/** Paths that require a signed-in user. Checked optimistically in the proxy and verified on each page. */
export const PROTECTED_PREFIXES = ["/portal", "/dashboard", "/rooms", "/bookings", "/account", "/admin", "/pending"];

export const DEMO_SESSION_COOKIE = "vr_demo_session";
