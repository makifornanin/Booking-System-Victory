import "server-only";
import { cache } from "react";
import { getRepository } from "@/lib/data";

/**
 * Request-memoized reads shared by layouts and pages (e.g. the admin sidebar
 * counts and the page that shows the same numbers), so each runs once per request.
 */
export const getRepositoryForRequest = cache(getRepository);

export const getBookingCounts = cache(async () => (await getRepositoryForRequest()).countBookingsByStatus());

export const getUserCounts = cache(async () => (await getRepositoryForRequest()).countUsersByAccessStatus());

export const getActiveRooms = cache(async () => (await getRepositoryForRequest()).listActiveRooms());
