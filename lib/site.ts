// Single source of truth for contact + booking targets.
//
// audit@rabbitholeai.ai is live (Namecheap, delivery to Gmail verified
// 2026-08-31). Remaining TODO (Jerry): create the 90-min Cal.com event and
// set BOOKING_CALENDAR_URL — until then the booking CTA falls back to a
// scoping email.

export const CONTACT_EMAIL = "audit@rabbitholeai.ai";

/** Calendar link for the paid 90-minute review. Empty string = fall back to email. */
export const BOOKING_CALENDAR_URL = "";

export const SCOPING_MAILTO = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(
  "Reconstructability review — booking"
)}`;

/** The primary CTA target: calendar if configured, scoping email otherwise. */
export const BOOKING_URL = BOOKING_CALENDAR_URL || SCOPING_MAILTO;

export const GITHUB_URL = "https://github.com/uu2142-dev/alice-evidence";
