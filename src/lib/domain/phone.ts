const E164 = /^\+[1-9]\d{7,14}$/;

/**
 * Normalizes what people actually type into E.164 (+639171234567). Accepts local
 * Philippine formats (0917 123 4567, 917-123-4567, 63 917 …) and international
 * numbers written with + or 00. Returns null when it can't be a phone number.
 */
export function normalizePhone(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed || /[a-z]/i.test(trimmed)) return null;
  let digits = trimmed.replace(/[^\d+]/g, "");
  if (digits.lastIndexOf("+") > 0) return null;

  if (digits.startsWith("00")) digits = `+${digits.slice(2)}`;

  if (!digits.startsWith("+")) {
    if (/^0\d{10}$/.test(digits)) digits = `+63${digits.slice(1)}`; // 09171234567
    else if (/^9\d{9}$/.test(digits)) digits = `+63${digits}`; // 9171234567
    else if (/^63\d{10}$/.test(digits)) digits = `+${digits}`; // 639171234567
    else return null;
  }

  return E164.test(digits) ? digits : null;
}

/** Friendly display: +63 917 123 4567 for PH mobiles, otherwise the E.164 value. */
export function formatPhone(value: string | null | undefined): string {
  if (!value) return "—";
  const ph = /^\+63(\d{3})(\d{3})(\d{4})$/.exec(value);
  return ph ? `+63 ${ph[1]} ${ph[2]} ${ph[3]}` : value;
}
