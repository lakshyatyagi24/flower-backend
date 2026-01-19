# Backend Deploy Artifact

`backend.tar.gz` — Nest API production build (dist/, package*.json, prisma/schema.prisma, prisma/seed.js)

Built on 2026-01-19.

## Server deployment

```bash
sudo mkdir -p /var/www/flower-backend
cd /var/www/flower-backend
sudo tar -xzf /path/to/backend.tar.gz -C .
```

Add `.env`:
```
PORT=3001
DATABASE_URL=postgresql://user:password@host:5432/flower_db
NODE_ENV=production
```

Install production deps (prisma postinstall will generate client):
```bash
npm ci --omit=dev
```

Run:
```bash
node dist/main.js
# or pm2
pm2 start dist/main.js --name "flower-api"
# or systemd (create /etc/systemd/system/flower-api.service)
```

## Cleanup commands
```bash
sudo apt-get clean && sudo apt-get autoremove --purge -y
sudo journalctl --vacuum-size=100M
sudo find /var/www -maxdepth 3 \( -name "node_modules" -o -name ".next" -o -name "dist" -o -name ".turbo" -o -name ".cache" \) -prune -print -exec rm -rf {} +
npm cache clean --force
docker system prune -a -f  # if Docker is present
```
