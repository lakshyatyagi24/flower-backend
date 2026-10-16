// DRAFT home hero slides, for the owner to review. Created by `prisma/apply-catalogue-content.js --sliders`,
// and ONLY when the Slider table is empty (so it can never duplicate or overwrite slides the owner made in the admin).
//
// Copy rules: no delivery-time, freshness, price or stock claims; links only to pages that exist.
//
// IMAGES: interim Pexels stock photos shipped in the storefront's public/images/hero/ (16:9, 1920x1080, no text in the
// picture; credits in frontend/public/images/CREDITS.md). The hero box is cropped with object-fit: cover, so keep the
// subject left of centre. The script refuses to create ACTIVE slides whose image file is missing: it creates them
// INACTIVE instead (see planSliders), so the home page keeps its built-in static hero until the files are in place.
//
// ALT TEXT: describes what each photo actually shows. If the owner swaps in their own photo in the admin, edit the alt too.
// The catalogue has no peonies or dahlias: those two photos set a mood only, so the copy never names the flowers shown.
//
// The storefront hero shows ONE slide (the first active slide with a usable image and title); the others are kept in
// the admin for rotation later or for the owner to reorder.

const HERO_SLIDES = [
  {
    eyebrow: 'Fresh Petals India',
    title: 'Cut flowers for every occasion',
    subtitle: 'Roses, lilies, orchids, chrysanthemums and more, in a range of colours.',
    alt: 'Pink roses in a glass vase on a white table, with white chairs against a pale wall',
    image: '/images/hero/hero-1.webp',
    href: '/products',
    ctaLabel: 'Shop flowers',
    sortOrder: 1,
  },
  {
    eyebrow: 'By occasion',
    title: 'Flowers for birthdays and anniversaries',
    subtitle: 'Browse by the occasion you are buying for, then pick a flower and colour.',
    alt: 'White peony-like blooms with yellow centres against a soft pink-ivory background',
    image: '/images/hero/hero-2.webp',
    href: '/occasions/birthday',
    ctaLabel: 'Shop birthday flowers',
    sortOrder: 2,
  },
  {
    eyebrow: 'Offices and events',
    title: 'Flowers for offices and events',
    subtitle: 'Planning flowers for a workplace, a launch or a celebration? Send us an enquiry.',
    alt: 'Two cream-yellow dahlias, one in a white textured vase, beside a ribbed white vase on a grey backdrop',
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
