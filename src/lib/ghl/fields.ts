import "server-only";
import { z } from "zod";
import { getGhlEnv, type GhlEnv } from "@/lib/env";
import { GHL_API_VERSION, ghlRequest } from "@/lib/ghl/client";
import { GhlError } from "@/lib/ghl/errors";

export interface BookingFieldValues {
  room: string;
  event: string;
  date: string;
  time: string;
  denialReason: string;
}

export interface AccountFieldValues {
  accessReason: string;
  status: string;
}

export type ContactFieldName = keyof BookingFieldValues | `account${Capitalize<keyof AccountFieldValues>}`;
export type ContactFieldValues = Partial<Record<ContactFieldName, string>>;

interface FieldSpec {
  env: keyof GhlEnv;
  fieldKey: string;
  label: string;
  required: boolean;
}

const FIELDS: Record<ContactFieldName, FieldSpec> = {
  room: { env: "GHL_FIELD_BOOKING_ROOM_ID", fieldKey: "contact.booking_room", label: "Booking Room", required: true },
  event: { env: "GHL_FIELD_BOOKING_EVENT_ID", fieldKey: "contact.booking_event", label: "Booking Event", required: true },
  date: { env: "GHL_FIELD_BOOKING_DATE_ID", fieldKey: "contact.booking_date", label: "Booking Date", required: true },
  time: { env: "GHL_FIELD_BOOKING_TIME_ID", fieldKey: "contact.booking_time", label: "Booking Time", required: true },
  denialReason: { env: "GHL_FIELD_BOOKING_DENIAL_REASON_ID", fieldKey: "contact.booking_denial_reason", label: "Booking Denial Reason", required: true },
  accountAccessReason: { env: "GHL_FIELD_ACCOUNT_ACCESS_REASON_ID", fieldKey: "contact.account_access_reason", label: "Account Access Reason", required: false },
  accountStatus: { env: "GHL_FIELD_ACCOUNT_STATUS_ID", fieldKey: "contact.account_status", label: "Account Status", required: false },
};

const customFieldsSchema = z.object({
  customFields: z.array(z.object({ id: z.string(), fieldKey: z.string().optional() }).loose()),
});

type FieldIds = Partial<Record<ContactFieldName, string>>;
const globalForFields = globalThis as typeof globalThis & { __victoryGhlFieldIds?: FieldIds };

/**
 * Real custom field IDs. Uses the GHL_FIELD_* env values; blank ones are looked
 * up once by field key and cached for the process. Booking fields are required;
 * account fields are optional (absent ones are simply not available).
 */
export async function getContactFieldIds(): Promise<FieldIds> {
  if (globalForFields.__victoryGhlFieldIds) return globalForFields.__victoryGhlFieldIds;

  const env = getGhlEnv();
  const ids: FieldIds = {};
  const missing: ContactFieldName[] = [];
  for (const [name, spec] of Object.entries(FIELDS) as [ContactFieldName, FieldSpec][]) {
    const value = env[spec.env];
    if (typeof value === "string" && value) ids[name] = value;
    else missing.push(name);
  }

  if (missing.length > 0) {
    const { customFields } = await ghlRequest(`/locations/${encodeURIComponent(env.GHL_LOCATION_ID)}/customFields`, {
      version: GHL_API_VERSION.contacts,
      query: { model: "contact" },
      schema: customFieldsSchema,
    });
    for (const name of missing) {
      const match = customFields.find((field) => field.fieldKey === FIELDS[name].fieldKey);
      if (match) ids[name] = match.id;
      else if (FIELDS[name].required) {
        throw new GhlError("config", `The GHL custom field "${FIELDS[name].label}" (${FIELDS[name].fieldKey}) doesn't exist in this location.`);
      }
    }
  }

  globalForFields.__victoryGhlFieldIds = ids;
  return ids;
}

/** Turns named values into the API's custom field payload, failing clearly if a field isn't configured. */
export async function toCustomFieldPayload(values: ContactFieldValues): Promise<{ id: string; field_value: string }[]> {
  const ids = await getContactFieldIds();
  const entries = (Object.entries(values) as [ContactFieldName, string][]).filter(
    // Account Status is optional: skip it quietly when the location doesn't have that field.
    ([name]) => ids[name] || name !== "accountStatus",
  );
  return entries.map(([name, value]) => {
    const id = ids[name];
    if (!id) {
      throw new GhlError(
        "config",
        `The GHL custom field "${FIELDS[name].label}" isn't set up. Create it (key ${FIELDS[name].fieldKey}) or set ${FIELDS[name].env}.`,
      );
    }
    return { id, field_value: value };
  });
}
