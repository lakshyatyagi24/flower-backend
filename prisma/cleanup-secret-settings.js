// One-off, owner-run: find (and optionally delete) credential-looking rows in the "Setting" table.
//
// Why: the original seed/admin page could store payment.razorpayKeyId / razorpayKeySecret / stripeKey in the
// database. Secrets now live only in the server environment, and the API never returns or accepts such keys
// (src/settings/secret-keys.ts). This script removes leftovers from a live DB.
//
// SAFE BY DEFAULT: with no flags it only PREVIEWS: key names and value lengths. Values are NEVER printed.
//
//   cd /app/backend            (in the container; or flower-backend/ locally with DATABASE_URL set)
//   node prisma/cleanup-secret-settings.js                                  # preview, deletes nothing
//   node prisma/cleanup-secret-settings.js --apply --backup /tmp/setting-secrets.json
//
// BEFORE --apply: the preview does not show the values, so if a row holds a real key that is still needed, copy it from
// the old admin Settings page / a database backup into .env.production FIRST (or confirm it is not needed).
//
// --apply REQUIRES --backup <file>: the deleted rows (including values) are written there first (mode 0600) so the
// delete is reversible: restore with  node prisma/cleanup-secret-settings.js --restore <file>   (one transaction).
// The backup lives inside the container's /tmp and DISAPPEARS the next time the container is recreated (every deploy).
// Copy it out first if you want to keep it:  docker compose cp app:/tmp/setting-secrets.json ~/setting-secrets.json
// then `chmod 600` it, and delete it once the keys are safely in .env.production. It contains secrets.
// If a preview shows a row that is NOT a credential, do not run --apply; tell the developer.
const path = require('path');
const fs = require('fs');

// Keep in sync with src/settings/secret-keys.ts (a unit test asserts both agree).
const SECRET_KEY_SUFFIX = /(secret|key|token|password|passwd|pwd|pass)$/i;
const SECRET_KEY_ANYWHERE = /(credential|private)/i;
function isSecretSettingKey(key) {
  const k = String(key == null ? '' : key).trim();
  if (/^payment[._:\-\s]/i.test(k) || k.toLowerCase() === 'payment') return true;
  return SECRET_KEY_SUFFIX.test(k) || SECRET_KEY_ANYWHERE.test(k);
}

/** Value of `--flag <value>`; undefined if the flag is absent. Throws if the value is missing or looks like another flag. */
function argValue(args, flag) {
  const i = args.indexOf(flag);
  if (i < 0) return undefined;
  const v = args[i + 1];
  if (v === undefined || v === '' || v.startsWith('--')) throw new Error(`${flag} needs a file path (got "${v === undefined ? '' : v}")`);
  return v;
}

/** Write the backup file with mode 0600 even when it already exists (writeFileSync's mode only applies on creation). */
function writePrivateFile(file, text) {
  fs.writeFileSync(file, text, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

module.exports = { isSecretSettingKey, argValue, writePrivateFile };

function loadPrisma() {
  try {
    return require(path.join(process.cwd(), 'prisma/generated/prisma')).PrismaClient;
  } catch (e) {
    return require('@prisma/client').PrismaClient;
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set.');
  // Validate flags before touching the database.
  const restore = args.includes('--restore') ? argValue(args, '--restore') : undefined;
  const backup = args.includes('--backup') ? argValue(args, '--backup') : undefined;
  const prisma = new (loadPrisma())();
  try {
    if (restore) {
      const rows = JSON.parse(fs.readFileSync(restore, 'utf8'));
      if (!Array.isArray(rows)) throw new Error('backup file is not a list of rows');
      await prisma.$transaction(
        rows.map((r) =>
          prisma.setting.upsert({ where: { key: r.key }, create: { key: r.key, value: r.value }, update: { value: r.value } }),
        ),
      );
      console.log(`restored ${rows.length} row(s) from ${restore} (single transaction)`);
      return;
    }

    const all = await prisma.setting.findMany();
    const hits = all.filter((r) => isSecretSettingKey(r.key));
    console.log(`${all.length} setting row(s) in total; ${hits.length} look like credentials:`);
    for (const r of hits) console.log(`  - ${r.key}  (value length ${String(r.value).length}, value not shown)`);

    if (!args.includes('--apply')) {
      console.log('Preview only. Nothing was changed. To delete: add --apply --backup <file>.');
      console.log('Values are not shown: before deleting, make sure any real key you still need is in .env.production.');
      return;
    }
    if (!backup) throw new Error('--apply requires --backup <file> so the delete can be undone.');
    if (hits.length === 0) {
      console.log('Nothing to delete.');
      return;
    }
    writePrivateFile(backup, JSON.stringify(hits.map((r) => ({ key: r.key, value: r.value })), null, 2));
    const res = await prisma.setting.deleteMany({ where: { key: { in: hits.map((r) => r.key) } } });
    console.log(`deleted ${res.count} row(s); backup written to ${backup} (mode 600, contains the secret values).`);
    console.log('That file is inside the container and is lost when the container is recreated (next deploy).');
    console.log('Copy it out now if you want to keep it:  docker compose cp app:' + backup + ' ~/setting-secrets.json && chmod 600 ~/setting-secrets.json');
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
