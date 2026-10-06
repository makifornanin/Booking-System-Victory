import "server-only";
import { cache } from "react";
import { getRepository } from "@/lib/data";

/**
 * Request-memoized reads shared by layouts and pages (e.g. the admin sidebar
 * counts and the page that shows the same numbers), so each runs once per request.
 */
export const getRepositoryForRequest = cache(getRepository);

/** Admin request counts: new bookings plus reschedule requests, by status. */
export const getBookingCounts = cache(async () => {
  const repo = await getRepositoryForRequest();
  const [bookings, reschedules] = await Promise.all([repo.countBookingsByStatus(), repo.countRescheduleRequestsByStatus()]);
  return {
    ...bookings,
    pending: bookings.pending + reschedules.pending,
    approved: bookings.approved + reschedules.approved,
    denied: bookings.denied + reschedules.denied,
  };
});

export const getUserCounts = cache(async () => (await getRepositoryForRequest()).countUsersByAccessStatus());

export const getActiveRooms = cache(async () => (await getRepositoryForRequest()).listActiveRooms());
