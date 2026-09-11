# Deploying for remote users (VPS)

This covers running `worker/` + `indexer/` continuously on a VPS you control, with the indexer
exposed over HTTPS (required — once the frontend is served over HTTPS, browsers block it from
calling a plain `http://` API as "mixed content"), and the frontend on a static host.

Skip this whole doc for a local/offline demo — `README.md`'s "Setup" section (running everything
on your own machine) is enough for that.

## 0. What you'll need before starting

- A VPS running Ubuntu 22.04+ (1 vCPU / 1GB RAM is plenty — both processes are lightweight
  Node scripts, not heavy servers). DigitalOcean, Linode, Hetzner — any of these work identically.
- A domain (or subdomain) you control, e.g. `api.yourdomain.com`, that you can point at the VPS's
  IP address via a DNS **A record**. Caddy (below) needs this to issue a free HTTPS certificate.
- SSH access to the VPS.
- Everything from the README's "Chuẩn bị" checklist already done: wallet + private key, Sepolia
  RPC key, both testnets funded, contracts already deployed (`npm run deploy:sepolia` /
  `deploy:creditcoin` from your own machine), so you have a filled-in `deployed-addresses.json`.

## 1. Point DNS at the VPS

In your domain registrar / DNS provider, add:

```
Type: A
Name: api  (or whatever subdomain you want — this doc assumes "api")
Value: <your VPS's public IP>
```

DNS propagation can take a few minutes to a few hours. You can move on while it propagates —
just don't expect the HTTPS cert step (§4) to succeed until it has.

## 2. SSH in and install Docker

```sh
ssh root@<your-vps-ip>

# Docker Engine + Compose plugin (official convenience script)
curl -fsSL https://get.docker.com | sh
```

## 3. Get the code and secrets onto the VPS

From your **local machine** (where you already ran the contract deploy scripts):

```sh
# Copy the whole project, including deployed-addresses.json, to the VPS
scp -r /path/to/hackathon root@<your-vps-ip>:/opt/terrachain
```

Then back on the VPS:

```sh
cd /opt/terrachain

cp worker/.env.example worker/.env
cp indexer/.env.example indexer/.env
```

Edit `worker/.env` and `indexer/.env` (`nano worker/.env`) and fill in real values. **Important:**
inside Docker, the `TERRA_SESSION_CONTRACT_ADDRESS` / `TERRA_CHAIN_GAME_CONTRACT_ADDRESS`
auto-load-from-`deployed-addresses.json` fallback does **not** apply (the Docker build only copies
each service's own folder, not the repo root) — you must set these explicitly:

```env
# worker/.env
CREDITCOIN_WALLET_PRIVATE_KEY=0x...
SOURCE_CHAIN_RPC_URL=https://sepolia.infura.io/v3/...
CREDITCOIN_RPC_URL=https://rpc.cc3-testnet.creditcoin.network
PROOF_BUILDER_URL=https://proof-gen-api.cc3-testnet.creditcoin.network/
SOURCE_CHAIN_KEY=1
TERRA_SESSION_CONTRACT_ADDRESS=0x...      # from deployed-addresses.json -> sepolia.TerraSession
TERRA_CHAIN_GAME_CONTRACT_ADDRESS=0x...   # from deployed-addresses.json -> creditcoin.TerraChainGame
MAX_CONCURRENT_SESSIONS=20
```

```env
# indexer/.env
CREDITCOIN_RPC_URL=https://rpc.cc3-testnet.creditcoin.network
TERRA_CHAIN_GAME_CONTRACT_ADDRESS=0x...   # same as above
INDEXER_START_BLOCK=0                     # or the exact block you deployed at, to skip ahead
PORT=4000
```

## 4. Point Caddy at your domain and start everything

Edit `deploy/Caddyfile`, replacing `indexer.example.com` with your real subdomain from step 1.

```sh
docker compose up -d --build
docker compose logs -f
```

You should see the worker connect and the indexer print `Initial replay done: ...`. Caddy will
automatically request a Let's Encrypt certificate for your domain on first request — this only
works if DNS (step 1) has propagated and ports 80/443 are reachable from the internet.

Verify:

```sh
curl https://api.yourdomain.com/health
# {"ok":true,"lastProcessedBlock":...,"baseCount":0,"playerCount":0}
```

## 5. Firewall (recommended)

```sh
ufw allow 22    # SSH
ufw allow 80    # HTTP (Caddy uses this for the Let's Encrypt challenge, then redirects to 443)
ufw allow 443   # HTTPS
ufw enable
```

Nothing else needs to be open — the worker makes outbound connections only, and the indexer is
only reachable through Caddy (its port 4000 is `expose`d to the Docker network, not published to
the host).

## 6. Deploy the frontend

The frontend is static — it doesn't belong on this VPS. Vercel or Netlify (either's free tier is
enough): connect the repo, set the project root to `frontend/`, and set these environment
variables in their dashboard:

```
VITE_SEPOLIA_RPC_URL=...
VITE_TERRA_SESSION_ADDRESS=0x9c8cB305903708b2022dF25afc7e5f810567Ee97
VITE_TERRA_CHAIN_GAME_ADDRESS=0x9Cd25e1b88F21033f4b0338574dC5a2AE7A032cc
VITE_INDEXER_URL=https://api.yourdomain.com
VITE_MAPBOX_TOKEN=pk....
```

Both give you HTTPS automatically on their own subdomain (or a custom domain if you add one) —
which is what makes Geolocation work on players' phones.

## Maintenance

```sh
# view logs
docker compose logs -f worker
docker compose logs -f indexer

# restart after editing .env
docker compose restart worker indexer

# pull code changes and rebuild
git pull   # or scp the updated files again
docker compose up -d --build
```

`restart: unless-stopped` means both services come back automatically after a VPS reboot or a
crash — you don't need a separate systemd unit or process manager on top of Docker for this.
