// @ts-check
const getPrisma = () => {
  try {
    return require(process.cwd() + '/prisma/generated/prisma').PrismaClient;
  } catch (e) {
    try {
      return require(process.cwd() + '/generated/prisma').PrismaClient;
    } catch (e2) {
      return require('@prisma/client').PrismaClient;
    }
  }
};
const PrismaClient = getPrisma();
const prisma = new PrismaClient();

async function main() {
  // Upsert categories
  const roses = await prisma.category.upsert({
    where: { slug: 'roses' },
    update: {},
    create: {
      name: 'Roses',
      slug: 'roses',
      image: null,
    },
  });

  const bouquets = await prisma.category.upsert({
    where: { slug: 'bouquets' },
    update: {},
    create: {
      name: 'Bouquets',
      slug: 'bouquets',
      image: null,
      parentId: roses.id,
    },
  });

  // Upsert a product
  await prisma.product.upsert({
    where: { slug: 'red-roses' },
    update: { price: 29.99 },
    create: {
      name: 'Red Roses Bouquet',
      slug: 'red-roses',
      description: 'A bouquet of fresh red roses',
      price: 29.99,
      categoryId: bouquets.id,
    },
  });

  // Upsert a test user
  await prisma.user.upsert({
    where: { email: 'test@example.com' },
    update: {},
    create: {
      name: 'Test User',
      email: 'test@example.com',
      password: 'password',
      phone: null,
    },
  });

  // Add many more categories (top-level + children) for testing
  const topCategories = [
    { name: 'Flowers', slug: 'flowers' },
    { name: 'Cakes', slug: 'cakes' },
    { name: 'Combos', slug: 'combos' },
    { name: 'Birthday', slug: 'birthday' },
    { name: 'Anniversary', slug: 'anniversary' },
    { name: 'Gifts', slug: 'gifts' },
    { name: 'Personalised', slug: 'personalised' },
    { name: 'Plants', slug: 'plants' },
    { name: 'Occasions', slug: 'occasions' },
    { name: 'International', slug: 'international' },
    { name: 'Sympathy', slug: 'sympathy' },
    { name: 'Corporate', slug: 'corporate' },
    { name: 'Seasonal', slug: 'seasonal' },
    { name: 'Deals', slug: 'deals' },
    { name: 'New Arrivals', slug: 'new-arrivals' },
    { name: 'Best Sellers', slug: 'best-sellers' },
    { name: 'Fruit Baskets', slug: 'fruit-baskets' },
    { name: 'Chocolates', slug: 'chocolates' },
    { name: 'Hampers', slug: 'hampers' },
    { name: 'Weddings', slug: 'weddings' },
    { name: 'Housewarming', slug: 'housewarming' },
    { name: 'Thank You', slug: 'thank-you' },
    { name: 'Get Well Soon', slug: 'get-well-soon' },
    { name: 'Love & Romance', slug: 'love-romance' },
    { name: "Mother's Day", slug: 'mothers-day' },
    { name: "Father's Day", slug: 'fathers-day' },
    { name: 'Valentines', slug: 'valentines' },
    { name: 'Diwali', slug: 'diwali' },
    { name: 'Christmas', slug: 'christmas' },
    { name: 'Easter', slug: 'easter' },
    { name: 'New Year', slug: 'new-year' },
    { name: 'Graduation', slug: 'graduation' },
    { name: 'Baby Shower', slug: 'baby-shower' },
    { name: 'Eco-Friendly', slug: 'eco-friendly' },
    { name: 'Luxury', slug: 'luxury' },
    { name: 'Budget', slug: 'budget' },
    { name: 'Subscription', slug: 'subscription' },
    { name: 'DIY Kits', slug: 'diy-kits' },
  ];

  const createdTop = {};
  for (const tc of topCategories) {
    const cat = await prisma.category.upsert({
      where: { slug: tc.slug },
      update: {},
      create: { name: tc.name, slug: tc.slug, image: null },
    });
    createdTop[tc.slug] = cat;
  }

  // Add children/subcategories for a few top categories to create depth
  const flowerChildren = ['Roses', 'Lilies', 'Orchids', 'Sunflowers', 'Mixed Flower Bouquet', 'Carnations', 'Gerberas', 'Hydrangeas'];
  for (const name of flowerChildren) {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    await prisma.category.upsert({
      where: { slug },
      update: {},
      create: { name, slug, parentId: createdTop['flowers'].id },
    });
  }

  const cakeChildren = ['Chocolate', 'Vanilla', 'Red Velvet', 'Black Forest', 'Eggless', 'Photo Cake', 'Designer Cakes'];
  for (const name of cakeChildren) {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    await prisma.category.upsert({
      where: { slug },
      update: {},
      create: { name, slug, parentId: createdTop['cakes'].id },
    });
  }

  const plantChildren = ['Indoor Plants', 'Outdoor Plants', 'Succulents', 'Air-purifying Plants', 'Flowering Plants'];
  for (const name of plantChildren) {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    await prisma.category.upsert({
      where: { slug },
      update: {},
      create: { name, slug, parentId: createdTop['plants'].id },
    });
  }

  // Some combos and popular child categories
  const combosChildren = ['Flowers & Cakes', 'Flowers & Chocolates', 'Flowers & Teddy', 'Combo Hampers'];
  for (const name of combosChildren) {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    await prisma.category.upsert({
      where: { slug },
      update: {},
      create: { name, slug, parentId: createdTop['combos'].id },
    });
  }

  // Upsert some slider/banner entries for the homepage
  const sliders = [
    {
      eyebrow: 'BRIGHTEN THEIR DAY',
      title: 'Fresh Flowers Delivered',
      subtitle: 'Same-day delivery available',
      alt: 'Fresh bouquet on wooden table',
  // Use absolute URL pointing at frontend dev server so images resolve correctly
  image: 'http://localhost:3000/assets/slider1.png',
      href: '/products?category=flowers',
      sortOrder: 0,
      config: {
        bg: 'from-amber-50 to-amber-100',
        overlay: {
          combined: true,
          position: 'center-right',
          textColor: '#1f2937',
          eyebrow: 'BRIGHTEN THEIR DAY',
          title: 'Fresh Flowers Delivered',
          subtitle: 'Same-day delivery available',
          cta: { label: 'Shop Flowers' },
          button: { bg: '#065f46', text: '#ffffff' }
        }
      },
    },
    {
      eyebrow: 'LIMITED OFFER',
      title: 'Autumn Specials',
      subtitle: 'Up to 30% off',
      alt: 'Autumn bouquet with warm tones',
  image: 'http://localhost:3000/assets/slider4.png',
      href: '/deals',
      sortOrder: 1,
      config: {
        bg: 'from-indigo-50 to-indigo-100',
        overlay: {
          combined: true,
          position: 'bottom-right',
          textClass: 'text-white',
          eyebrow: 'LIMITED OFFER',
          title: 'Autumn Specials',
          subtitle: 'Up to 30% off',
          cta: { label: 'See Offers' },
          buttonClass: 'inline-block bg-white text-pink-600 px-5 py-2 rounded-md shadow hover:opacity-95'
        }
      },
    },
    {
      eyebrow: 'NEW',
      title: 'Personalised Gifts',
      subtitle: 'Add a custom message',
      alt: 'Gift box with flowers',
  image: 'http://localhost:3000/assets/slider7.png',
      href: '/gifts/personalised',
      sortOrder: 2,
      config: {
        bg: 'from-rose-50 to-rose-100',
        overlay: {
          combined: true,
          position: 'center',
          eyebrow: 'NEW',
          title: 'Personalised Gifts',
          subtitle: 'Add a custom message',
          cta: { label: 'Customize' },
          button: { bg: '#be123c', text: '#ffffff' }
        }
      },
    },
  ];

  for (const s of sliders) {
    await prisma.slider.upsert({
      where: { id: s.sortOrder + 1 },
      update: { ...s },
      create: { ...s },
    });
  }

  console.log('Seed complete');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
