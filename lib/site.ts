// Single source of truth for contact + booking targets.
//
// TODO (Jerry, account setup — one-line swaps once done):
//  1. Domain email: create audit@rabbitholeai.ai (or jerry@) as an alias and
//     change CONTACT_EMAIL below. A personal Gmail on a chain-of-custody
//     product is a trust leak — but a dead alias is worse, so the Gmail stays
//     until the alias actually receives mail.
//  2. Booking: create a free Cal.com/Calendly event ("Reconstructability
//     review — 90 min") and set BOOKING_URL to it. Until then the booking CTA
//     falls back to a scoping email.

export const CONTACT_EMAIL = "jtdawson015@gmail.com";

/** Calendar link for the paid 90-minute review. Empty string = fall back to email. */
export const BOOKING_CALENDAR_URL = "";

export const SCOPING_MAILTO = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(
  "Reconstructability review — booking"
)}`;

/** The primary CTA target: calendar if configured, scoping email otherwise. */
export const BOOKING_URL = BOOKING_CALENDAR_URL || SCOPING_MAILTO;

export const GITHUB_URL = "https://github.com/uu2142-dev/alice-evidence";
