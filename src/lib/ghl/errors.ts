export type GhlErrorKind =
  | "config"
  | "auth"
  | "not_found"
  | "rate_limited"
  | "rejected"
  | "unavailable"
  | "invalid_response";

export class GhlError extends Error {
  constructor(
    public readonly kind: GhlErrorKind,
    message: string,
    public readonly status?: number,
    /** True when a write may have succeeded on GHL's side (timeout, dropped connection, 5xx). */
    public readonly ambiguous = false,
  ) {
    super(message);
    this.name = "GhlError";
  }
}

/** GHL refuses to create/update a contact because another contact already has that email or phone. */
export function isDuplicateContactError(error: unknown): error is GhlError {
  return error instanceof GhlError && error.kind === "rejected" && /duplicat/i.test(error.message);
}

/** Message safe to show an admin or member. Never includes tokens or raw responses. */
export function ghlUserMessage(error: unknown): string {
  if (!(error instanceof GhlError)) return "The church calendar could not be reached. Please try again.";
  switch (error.kind) {
    case "config":
      return error.message;
    case "auth":
      return "GHL rejected the integration credentials. Check the private integration token and its scopes.";
    case "not_found":
      return "GHL couldn't find the requested record (calendar or contact). Check the room's calendar ID.";
    case "rate_limited":
      return "GHL is rate limiting requests right now. Wait a moment and try again.";
    case "rejected":
      return `GHL rejected the request: ${error.message}`;
    case "invalid_response":
      return "GHL returned an unexpected response. Please try again.";
    case "unavailable":
    default:
      return "GHL is unavailable right now. Please try again in a few minutes.";
  }
}
