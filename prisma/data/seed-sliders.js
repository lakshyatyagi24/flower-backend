// DRAFT home hero slides, for the owner to review. Created by `prisma/apply-catalogue-content.js --sliders`,
// and ONLY when the Slider table is empty (so it can never duplicate or overwrite slides the owner made in the admin).
//
// Copy rules: no delivery-time, freshness, price or stock claims; links only to pages that exist.
//
// IMAGES: files are expected under the storefront's public/ folder (public/images/hero/hero-N.webp, portrait about
// 4:5 such as 960x1200, no text baked into the picture). They arrive later. The script refuses to create ACTIVE slides
// whose image file is missing: it creates them INACTIVE instead (see planSliders), so the home page keeps its built-in
// static hero until the photos are in place and the owner switches the slides on in the admin.
//
// ALT TEXT: the `alt` values below are generic stand-ins written before any photo exists. When the real photo is chosen,
// edit the alt in the admin so it describes what the picture actually shows.
//
// The storefront hero shows ONE slide (the first active slide with a usable image and title); the others are kept in
// the admin for rotation later or for the owner to reorder.

const HERO_SLIDES = [
  {
    eyebrow: 'Fresh Petals India',
    title: 'Cut flowers for every occasion',
    subtitle: 'Roses, lilies, orchids, chrysanthemums and more, in a range of colours.',
    alt: 'A bunch of cut flowers in a glass vase',
    image: '/images/hero/hero-1.webp',
    href: '/products',
    ctaLabel: 'Shop flowers',
    sortOrder: 1,
  },
  {
    eyebrow: 'By occasion',
    title: 'Flowers for birthdays and anniversaries',
    subtitle: 'Browse by the occasion you are buying for, then pick a flower and colour.',
    alt: 'A mixed bouquet of cut flowers',
    image: '/images/hero/hero-2.webp',
    href: '/occasions/birthday',
    ctaLabel: 'Shop birthday flowers',
    sortOrder: 2,
  },
  {
    eyebrow: 'Offices and events',
    title: 'Flowers for offices and events',
    subtitle: 'Planning flowers for a workplace, a launch or a celebration? Send us an enquiry.',
    alt: 'Cut flowers arranged on a table',
    image: '/images/hero/hero-3.webp',
    href: '/corporate',
    ctaLabel: 'Corporate orders',
    sortOrder: 3,
  },
];

/** The shape the Slider table stores (the CTA label lives in config.overlay.cta.label, where lib/hero.ts reads it). */
function sliderRow(slide, active) {
  return {
    title: slide.title,
    eyebrow: slide.eyebrow,
    subtitle: slide.subtitle,
    alt: slide.alt,
    image: slide.image,
    href: slide.href,
    config: { overlay: { cta: { label: slide.ctaLabel } } },
    sortOrder: slide.sortOrder,
    active,
  };
}

module.exports = { HERO_SLIDES, sliderRow };
