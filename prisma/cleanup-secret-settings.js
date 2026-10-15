// One-off, owner-run: find (and optionally delete) credential-looking rows in the "Setting" table.
//
// Why: the original seed/admin page could store payment.razorpayKeyId / razorpayKeySecret / stripeKey in the
// database. Secrets now live only in the server environment, and the API never returns or accepts such keys
// (src/settings/secret-keys.ts). This script removes leftovers from a live DB.
//
// SAFE BY DEFAULT: with no flags it only PREVIEWS (key names, value length; values are never printed).
//
//   cd /app/backend            (in the container; or flower-backend/ locally with DATABASE_URL set)
//   node prisma/cleanup-secret-settings.js                                  # preview, deletes nothing
//   node prisma/cleanup-secret-settings.js --apply --backup /tmp/setting-secrets.json
//
// --apply REQUIRES --backup <file>: the deleted rows (including values) are written there first (mode 0600) so the
// delete is reversible: restore with  node prisma/cleanup-secret-settings.js --restore <file>
// Delete the backup file once you have confirmed the keys are in .env.production (it contains the secrets).
// If a preview shows a row that is NOT a secret, do not run --apply; tell the developer.
const path = require('path');
const fs = require('fs');

// Keep in sync with src/settings/secret-keys.ts (a unit test asserts both agree).
const SECRET_KEY_SUFFIX = /(secret|key|token|password|passwd|pwd)$/i;
function isSecretSettingKey(key) {
  const k = String(key == null ? '' : key).trim();
  if (/^payment[._:\-\s]/i.test(k) || k.toLowerCase() === 'payment') return true;
  return SECRET_KEY_SUFFIX.test(k);
}
module.exports = { isSecretSettingKey };

function loadPrisma() {
  try {
    return require(path.join(process.cwd(), 'prisma/generated/prisma')).PrismaClient;
  } catch (e) {
    return require('@prisma/client').PrismaClient;
  }
}

function argValue(args, flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main() {
  const args = process.argv.slice(2);
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set.');
  const prisma = new (loadPrisma())();
  try {
    const restore = argValue(args, '--restore');
    if (args.includes('--restore')) {
      if (!restore) throw new Error('--restore needs a file path');
      const rows = JSON.parse(fs.readFileSync(restore, 'utf8'));
      for (const r of rows) {
        await prisma.setting.upsert({ where: { key: r.key }, create: { key: r.key, value: r.value }, update: { value: r.value } });
      }
      console.log(`restored ${rows.length} row(s) from ${restore}`);
      return;
    }

    const all = await prisma.setting.findMany();
    const hits = all.filter((r) => isSecretSettingKey(r.key));
    console.log(`${all.length} setting row(s) in total; ${hits.length} look like credentials:`);
    for (const r of hits) console.log(`  - ${r.key}  (value length ${String(r.value).length}, not shown)`);

    if (!args.includes('--apply')) {
      console.log('Preview only. Nothing was changed. To delete: add --apply --backup <file>.');
      return;
    }
    const backup = argValue(args, '--backup');
    if (!backup) throw new Error('--apply requires --backup <file> so the delete can be undone.');
    if (hits.length === 0) {
      console.log('Nothing to delete.');
      return;
    }
    fs.writeFileSync(backup, JSON.stringify(hits.map((r) => ({ key: r.key, value: r.value })), null, 2), { mode: 0o600 });
    const res = await prisma.setting.deleteMany({ where: { key: { in: hits.map((r) => r.key) } } });
    console.log(`deleted ${res.count} row(s); backup written to ${backup} (contains secrets: remove it when done).`);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error(String(e && e.message ? e.message : e));
    process.exit(1);
  });
}
