// DRAFT: original product descriptions for the 95 cut-flower products. FOR OWNER REVIEW BEFORE LAUNCH.
//
// Replaces the descriptions copied from a competitor snapshot ("What you get / Bunch of 12 or 24 ... brown paper ...
// flower food and a care card"). Everything here was written from general florist and botanical knowledge; none of it
// comes from that text.
//
// HONESTY RULES (enforced by src/catalog/product-copy.spec.ts, which also scans for banned phrases):
//   - No statements about freshness timing, sourcing, delivery speed, packaging, "care card" or "flower food".
//   - No stem counts per bunch (the product's own unit / minOrderQty fields say what is sold).
//   - No guarantees, no "premium" / "luxury", no health or allergy claims, no exclamation marks.
//   - Care tips are general florist practice, not promises about vase life.
//
// STRUCTURE: each description is 4 short sentences composed of
//   1. a flower lead (what it is, in this colour),
//   2. what the flower is typically used for,
//   3. a colour-pairing line (omitted for products whose name has no colour),
//   4. one modest care tip.
// The result is a plain single paragraph (no label lines), which is what the storefront's description renderer expects.
//
// Exports PRODUCT_COPY: { [slug]: { description } }. Applied to a live database by prisma/apply-catalogue-content.js,
// which never overwrites a description the owner has edited.

const { cutFlowerProducts } = require('./cut-flowers');

const COPY_STATUS = 'DRAFT';

// Colour key (the slug suffix after the flower prefix) -> { desc: used in the lead, pair: the colour line }.
const COLOURS = {
  'ruby-red': { desc: 'a deep, rich red', pair: 'Deep red reads as formal and romantic, and looks strongest beside plain green foliage.' },
  red: { desc: 'red', pair: 'Red is bold and pairs easily with white or green.' },
  'red-bicolour': { desc: 'a two-tone red', pair: 'The two-tone colouring is the feature here, so the vase needs little else.' },
  'blush-pink': { desc: 'a soft, pale pink', pair: 'Pale pink is gentle and combines well with white, cream or green.' },
  'hot-pink': { desc: 'a bright, saturated pink', pair: 'A strong pink like this stands out in a mixed bunch and pairs well with white or green.' },
  'pearl-white': { desc: 'a clean white', pair: 'White keeps a vase looking tidy and combines with almost any other colour.' },
  white: { desc: 'white', pair: 'White looks clean on its own and combines with almost any other colour.' },
  'blazing-yellow': { desc: 'a bright yellow', pair: 'Bright yellow lifts a room and pairs well with green and with white.' },
  'real-peach': { desc: 'a soft peach', pair: 'Peach sits between pink and orange and blends well with cream and soft greens.' },
  'sunset-orange': { desc: 'a warm orange', pair: 'Warm orange stands out against green and looks good beside yellow or deep red.' },
  orange: { desc: 'orange', pair: 'Orange is warm and lively, and pairs well with yellow or green.' },
  'dusty-mauve': { desc: 'a muted mauve, a greyed pink-purple', pair: 'A muted mauve is subtle and goes well with white, cream and grey-green foliage.' },
  'fresh-green': { desc: 'green', pair: 'Green is easy to mix: it softens brighter flowers and also works as a calm single-colour bunch.' },
  'powder-blue': { desc: 'a pale blue', pair: 'Pale blue is cool and restful and goes well with white and soft pink.' },
  'royal-purple': { desc: 'a deep purple', pair: 'Deep purple adds depth to a bunch and pairs well with white or pale pink.' },
  purple: { desc: 'purple', pair: 'Purple adds depth to a bunch and pairs well with white or yellow.' },
  'pink-and-white': { desc: 'pink and white', pair: 'The pink and white mix is gentle and suits a vase on its own.' },
  'bi-colour': { desc: 'two tones', pair: 'The two-tone colouring is the feature here, so the vase needs little else.' },
};

const TRIM = 'trim the stems at an angle, strip any leaves below the waterline and use a clean vase';

// Flower types. `prefix` is the slug prefix (colour key follows it); `exact` marks products with no colour in the slug.
// Order matters only in that prefixes are tested against the slug with a trailing "-" (or equality for exact types).
const TYPES = [
  {
    key: 'rose',
    prefix: 'rose-',
    lead: (c) => `Cut roses in ${c}, with full, layered blooms on firm, upright stems.`,
    use: 'Roses suit anniversaries, birthdays and simple gifting, and a single shade in a vase looks tidy.',
    care: `To look after them, ${TRIM}, and change the water every couple of days.`,
  },
  {
    key: 'jumilla',
    exact: 'jumilla-roses',
    lead: () => 'Jumilla is a named rose variety, with the rounded, layered blooms typical of cut roses.',
    use: 'It works well on its own or with eucalyptus and other greenery for a fuller look.',
    care: `To look after them, ${TRIM}, and change the water every couple of days.`,
  },
  {
    key: 'spray-rose',
    prefix: 'spray-roses-',
    lead: (c) => `Spray roses in ${c}: each stem carries several small blooms and buds rather than a single large head.`,
    use: 'They suit table arrangements and mixed bunches where a lighter, more delicate look is wanted than a large rose gives.',
    care: `${cap(TRIM)}, and keep the vase out of direct sun.`,
  },
  {
    key: 'tuberose',
    exact: 'tube-roses-rajnigandha',
    lead: () => 'Tube roses, known in India as rajnigandha, carry waxy white flowers along a tall spike, with a strong, sweet fragrance that is most noticeable in the evening.',
    use: 'A few spikes can scent a small room, and they are a common choice for weddings, pujas and festive decoration.',
    care: `${cap(TRIM)}, and keep the vase away from heat.`,
  },
  {
    key: 'hydrangea',
    prefix: 'hydrangea-',
    lead: (c) => `Hydrangea in ${c}, with a large, rounded head made up of many small florets.`,
    use: 'One or two stems fill a vase, and they work well alone or as the centrepiece of a mixed arrangement.',
    care: `Hydrangeas take up a lot of water, so ${TRIM}, and top the vase up often.`,
  },
  {
    key: 'oriental-lily',
    prefix: 'oriental-lily-',
    lead: (c) => `Oriental lilies in ${c}, with large, open flowers and several buds on each stem that open over a few days.`,
    use: 'Oriental lilies usually have a noticeable fragrance, so one or two stems are often enough for a room.',
    care: `Pull off the pollen-bearing anthers as the flowers open to avoid stains on petals and fabric, and ${TRIM}.`,
  },
  {
    key: 'asiatic-lily',
    prefix: 'asiatic-lily-',
    lead: (c) => `Asiatic lilies in ${c}, with upward-facing flowers on straight stems.`,
    use: 'Asiatic lilies generally have little or no scent, which suits a dining table or a room where strong fragrance is unwelcome.',
    care: `Remove the pollen-bearing anthers if you want clean petals and hands, and ${TRIM}.`,
  },
  {
    key: 'alstroemeria',
    prefix: 'alstroemeria-',
    lead: (c) => `Alstroemeria, sometimes called Peruvian lily, in ${c}: each stem carries a cluster of small lily-like flowers, often marked with fine streaks.`,
    use: 'It is useful in mixed bunches and for filling gaps in an arrangement.',
    care: `${cap(TRIM)}, and pick off flowers as they fade so the remaining buds can open.`,
  },
  {
    key: 'dendrobium',
    prefix: 'dendrobium-orchids-',
    lead: (c) => `Dendrobium orchid sprays in ${c}: many small orchid flowers open along a slim, arching stem.`,
    use: 'A single spray in a tall, narrow vase is enough, and they also combine well with roses and lilies in larger arrangements.',
    care: 'Trim the stem end before placing it in water, and keep the vase away from ripening fruit and direct heat.',
  },
  {
    key: 'mokara',
    prefix: 'mokara-orchids-',
    lead: (c) => `Mokara orchids in ${c}. Mokara is a hybrid orchid that carries small, star-shaped flowers close together on a stiff stem.`,
    use: 'The firm stems make them easy to place in a vase or arrangement, and they are often used in table pieces and office settings.',
    care: 'Re-cut the stem end, use clean water and keep them away from ripening fruit and strong heat.',
  },
  {
    key: 'anthurium',
    prefix: 'anthuriums-',
    lead: (c) => `Anthuriums in ${c}, with a glossy, heart-shaped bract and a slim spike at the centre.`,
    use: 'The shape is bold enough to stand alone in a simple vase, and suits modern interiors and offices.',
    care: 'Anthuriums are tropical, so avoid cold draughts and air-conditioning vents, and trim the stem ends before putting them in water.',
  },
  {
    key: 'lisianthus',
    prefix: 'lisianthus-',
    lead: (c) => `Lisianthus in ${c}, with soft, ruffled flowers that resemble a small rose or poppy, and several buds on each stem that open one after another.`,
    use: 'It mixes easily with roses and spray roses, or looks good on its own.',
    care: `${cap(TRIM)}, and remove spent flowers so the buds can open.`,
  },
  {
    key: 'chrysanthemum',
    prefix: 'chrysanthemum-',
    lead: (c) => `Chrysanthemums in ${c}, with full, layered flower heads on firm, leafy stems.`,
    use: 'Chrysanthemums are common in festive decoration and everyday vases, and mix easily into bunches.',
    care: `${cap(TRIM)}.`,
  },
  {
    key: 'button-chrysanthemum',
    prefix: 'button-chrysanthemums-',
    lead: (c) => `Button chrysanthemums in ${c}: small, round, compact flowers, many on each branching stem.`,
    use: 'Their size suits low arrangements, tight posies and small vases.',
    care: `${cap(TRIM)}.`,
  },
  {
    key: 'disbud-chrysanthemum',
    prefix: 'disbud-chrysanthemums-',
    lead: (c) => `Disbud chrysanthemums in ${c}. The side buds are removed as the plant grows, so each stem carries one large bloom.`,
    use: 'A few stems in a vase give a bold, round shape that holds its own in mixed arrangements.',
    care: `${cap(TRIM)}.`,
  },
  {
    key: 'santini',
    prefix: 'santini-chrysanthemums-',
    lead: (c) => `Santini chrysanthemums in ${c}: small, daisy-like flowers, many to a stem, often with a contrasting centre.`,
    use: 'They bring a casual, filler-like texture to bunches and suit small vases.',
    care: `${cap(TRIM)}.`,
  },
  {
    key: 'carnation',
    prefix: 'carnations-',
    lead: (c) => `Carnations in ${c}, with ruffled, layered petals and one bloom per stem.`,
    use: 'Carnations generally last well in a vase and often have a light, clove-like scent, and they suit birthdays and everyday bunches.',
    care: `${cap(TRIM)}, and refresh the water every few days.`,
  },
  {
    key: 'spray-carnation',
    prefix: 'spray-carnations-',
    lead: (c) => `Spray carnations in ${c}: several smaller, ruffled blooms branch from each stem.`,
    use: 'They fill a vase generously and suit mixed bunches and simple table flowers.',
    care: `${cap(TRIM)}, and refresh the water every few days.`,
  },
  {
    key: 'heliconia',
    exact: 'heliconia',
    lead: () => 'Heliconia is a tropical flower with bold, waxy bracts arranged along a stem, often in red, orange or yellow.',
    use: 'A single stem or a few in a tall vase make a strong, architectural statement, and they pair well with large leaves.',
    care: 'Keep them out of cold air, use a deep vase with clean water and trim the stem end at an angle.',
  },
  {
    key: 'agapanthus',
    prefix: 'agapanthus-',
    lead: (c) => `Agapanthus, also called African lily, in ${c}: a rounded cluster of small trumpet-shaped flowers on a tall, bare stem.`,
    use: 'A few stems in a tall vase give height and suit wedding-style and large arrangements.',
    care: 'Trim the stem ends at an angle and keep the vase filled with clean water.',
  },
  {
    key: 'liatris',
    exact: 'liatris',
    lead: () => 'Liatris, also called blazing star or gayfeather, forms a tall, feathery spike of small flowers, usually in shades of purple. Unlike most flower spikes, it opens from the top downwards.',
    use: 'It adds height and a strong vertical line to mixed bunches, and holds well on its own in a tall vase.',
    care: 'Trim the stems at an angle and change the water every few days.',
  },
  {
    key: 'helichrysum',
    prefix: 'helichrysms-',
    lead: (c) => `Helichrysums, also called strawflowers, in ${c}: papery, daisy-like flowers with a firm, almost crisp feel.`,
    use: 'They suit mixed bunches, and because the petals are papery they can be dried and kept afterwards.',
    care: `${cap(TRIM)}. To dry them, hang the stems upside down in a dry, shaded place.`,
  },
  {
    key: 'sunflower',
    exact: 'sunflowers',
    lead: () => 'Sunflowers have large, golden-yellow petals around a dark, textured centre, on tall, sturdy stems.',
    use: 'A few stems brighten a room on their own, and they pair well with green foliage.',
    care: 'Sunflowers drink a lot of water, so use a tall, clean vase, trim the stems at an angle and top it up often.',
  },
  {
    key: 'sunflower-bicolor',
    exact: 'sunflowers-bicolor',
    lead: () => 'Bi-colour sunflowers have petals in two tones around a dark, textured centre, on tall, sturdy stems.',
    use: 'The two-tone petals are the feature, so a few stems in a plain vase are enough.',
    care: 'Sunflowers drink a lot of water, so use a tall, clean vase, trim the stems at an angle and top it up often.',
  },
  {
    key: 'snapdragon',
    prefix: 'snapdragon-',
    lead: (c) => `Snapdragons in ${c}: tall spikes of small, hinged flowers that open from the bottom upward.`,
    use: 'Snapdragons add height and a vertical line to mixed bunches and tall vases.',
    care: 'Keep the stems upright, as they tend to curve upward if laid on their side, and keep them away from ripening fruit.',
  },
  {
    key: 'gladioli',
    prefix: 'gladioli-',
    lead: (c) => `Gladioli in ${c}: a tall spike with large, funnel-shaped florets that open from the bottom up.`,
    use: 'Their height suits tall vases, entrances and large arrangements, and one or two spikes are often enough.',
    care: 'Trim the stem ends at an angle, use a tall, heavy vase and remove the lower florets as they fade.',
  },
  {
    key: 'assorted',
    exact: 'assorted-bunch-of-cut-flowers',
    lead: () => 'A mixed bunch of cut flowers. The varieties and colours included can vary from one bunch to the next.',
    use: 'It suits a gift or a vase when you would rather receive a mix than choose a single flower.',
    care: `${cap(TRIM)}, and change the water every couple of days.`,
  },
];

function cap(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Finds the flower type and colour key for a slug. Returns null when the slug is unknown. */
function classify(slug) {
  for (const type of TYPES) {
    if (type.exact) {
      if (slug === type.exact) return { type, colour: null };
      continue;
    }
    if (slug.startsWith(type.prefix)) {
      const colour = slug.slice(type.prefix.length);
      return COLOURS[colour] ? { type, colour } : null;
    }
  }
  return null;
}

/** Description for one slug; throws on an unknown slug so a catalogue change cannot silently go uncovered. */
function descriptionFor(slug) {
  const hit = classify(slug);
  if (!hit) throw new Error(`product-copy: no copy rule for slug "${slug}"`);
  const { type, colour } = hit;
  const c = colour ? COLOURS[colour] : null;
  const parts = [type.lead(c ? c.desc : ''), type.use];
  if (c) parts.push(c.pair);
  parts.push(type.care);
  return parts.join(' ');
}

const PRODUCT_COPY = {};
for (const p of cutFlowerProducts) PRODUCT_COPY[p.slug] = { description: descriptionFor(p.slug) };

module.exports = { COPY_STATUS, PRODUCT_COPY, descriptionFor, classify, COLOURS, TYPES };
