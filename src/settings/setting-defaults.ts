/**
 * Single source of truth for setting defaults. The public `/settings` endpoint exposes these when a row is
 * missing, and order totals fall back to the SAME values, so the storefront can never advertise a shipping
 * rate or free-shipping threshold that the order calculation would not apply.
 *
 * Contact placeholders are deliberately blank: nothing placeholder-like is shown publicly. (The phone and
 * WhatsApp number is the owner's real customer-care line.)
 */
export const SETTING_DEFAULTS: Record<string, string> = {
  'store.name': 'Fresh Petals India',
  'store.email': '',
  'store.phone': '+91 93540 16059',
  'store.whatsapp': '+91 93540 16059',
  'store.address': '',
  'store.instagram': '',
  'store.gstin': '',
  'shipping.flatRate': '99',
  'shipping.freeThreshold': '1499',
  // Comma/whitespace/newline separated 6-digit PINs and prefix patterns (e.g. "110001, 1100*"). Empty = unrestricted.
  'delivery.supportedPincodes': '',
  // Delivery dates (all in India time). Orders placed at/after the cut-off start counting from the next day.
  'delivery.cutoffTime': '15:00',
  'delivery.leadTimeDays': '0',
  // Comma/space/newline separated YYYY-MM-DD dates we cannot deliver on.
  'delivery.blackoutDates': '',
  // How many days after the earliest date a customer may choose.
  'delivery.daysAhead': '14',
};
