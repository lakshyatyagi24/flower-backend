// Default store settings written by prisma/seed.js on FRESH databases only
// (the seed upserts with `update: {}`, so existing rows are never overwritten).
// Contact email and address are intentionally blank: no placeholder such as
// orders@example.com may ever reach a public page. The admin fills them in.
const DEFAULT_SETTINGS = {
  'store.name': 'Fresh Petals India',
  'store.email': '',
  'store.phone': '+91 93540 16059',
  'store.whatsapp': '+91 93540 16059',
  'store.address': '',
  'store.instagram': '',
  'store.gstin': '',
  'shipping.flatRate': '99',
  'shipping.freeThreshold': '1499',
};

module.exports = { DEFAULT_SETTINGS };
