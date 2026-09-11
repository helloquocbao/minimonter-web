# MiniMonster Terra

Built for **BUIDL CTC 2026 Fall** (Creditcoin & Credit Labs) — tracks **DePIN + Gaming**, integrating the **Attestcoin Protocol** as a core mechanic.

Your phone is the only hardware you need. Walk a loop around a spot in the real world to paint it
as your territory. There's no territory combat in Phase 1 — the main threat is a permissionless
bot that periodically damages territory once enough real-world activity has piled up on-chain,
and the only defense is walking another loop to reinforce what's yours. Players who want a bit
of direct rivalry can also **Duel** each other — a friendly, opt-in wager on who walks further
in a time window, with no territory ever at risk. No app-only cheating: every claim is a real
GPS-tracked walk, proven cross-chain through the Attestcoin Protocol before it touches the game.

## Game rules (Phase 1 — territory painting)

TerraChain Phase 1 (the on-chain game logic powering MiniMonster Terra) has no territory-vs-
territory combat. The main opponent is the chain itself: a permissionless bot that periodically
damages territory once enough real-world activity has accumulated on-chain.

- **Claim** — walk a closed loop around a real-world spot that isn't already claimed (any
  shape, not just circular). The walked polygon becomes a new **Base** there, and its enclosed
  area is painted as your territory. If the loop instead touches one of your own existing
  Bases, it extends that Base with an extra chunk rather than planting a separate one. Rejected
  if the loop overlaps anyone else's Base, or if it's longer than your current **km cap** (see
  below) — see "Real polygons, not circles" below for how this is represented on-chain.
- **Reinforce** — walk a closed loop around a Base you already own. On success, that Base's
  territory is instantly restored to 100% of its original area — the only way to undo bot
  damage. There's no partial credit for a longer loop; completing a valid loop around your own
  Base is what matters.
- **Km cap** — every player has a per-session walking cap that starts at 1000m and only ever
  grows, based on their **cumulative distance walked** across every session (Claim or
  Reinforce) they've ever completed: +500m every 5km walked, up to +5000m (10 levels). Nothing
  to buy, nothing to manage — it's a permanent, one-way progression that rewards playing more.
- **Bot attacks** — there are no other players to fight, but the world isn't static either. Once
  the contract has processed `BOT_ATTACK_TX_INTERVAL` (20) successful Claim/Reinforce sessions
  since the last bot attack, **anyone** can call `commitBotAttack()` — permissionless, not run
  by any privileged account — to open a commit. A separate `revealBotAttack()` call, in a LATER
  block, resolves it: picks an existing Base and destroys 10-40% of its *current* territory,
  using the commit block's now-immutable hash as entropy (see "Commit-reveal randomness" below
  for why this is two steps instead of one). A Base whose territory is fully destroyed loses the
  ground entirely — it's freed back to unclaimed and anyone (including a different player) can
  Claim it again. In practice, the `worker/` relayer polls `botAttackReady()` /
  `botAttackRevealReady()` every cycle and drives both steps automatically, but nothing stops a
  player or a third party from doing either half themselves.

### Outcomes & concurrent claims

Every session resolves to exactly one on-chain outcome — there's no revert-and-vanish. Success
(`BaseClaimed`, `BaseReinforced`) and rejection (`ClaimRejected`, `ReinforceRejected`) are both
real events, each carrying the same `sessionId` the player got back on Sepolia, so the frontend
always shows a concrete reason instead of leaving a session in limbo.

This matters most for the race case: if two players Claim overlapping ground around the same
time, neither knows about the other until attestation lands — **whoever's proof gets executed
on Creditcoin first wins**, not whoever walked first in the real world (attestation timing isn't
perfectly predictable). The loser's `ClaimRejected` event fires with `"overlaps an existing
territory"`, and the frontend surfaces that as a clear warning — their walk is a sunk cost.

### Real polygons, not circles

Every Claim/Reinforce loop is submitted as an actual walked polygon (up to 16 vertices,
simplified client-side from the raw GPS path via Ramer-Douglas-Peucker) — not a circle
approximation. Area is computed on-chain with the Shoelace formula; overlap and containment use
real polygon geometry (segment intersection + ray-casting point-in-polygon), so an L-shaped or
otherwise irregular real-world walking loop is represented faithfully instead of being flattened
into "radius = circumference / 2π". A Base can be made of multiple such polygons ("chunks") —
walking a new loop that touches one of your own Bases extends it with an extra chunk instead of
planting a separate Base, so territory can grow into genuinely irregular shapes over multiple
sessions.

### Commit-reveal randomness for bot attacks

Picking which Base a bot attack hits — and how much damage it does — needs unpredictable
on-chain randomness. A naive single-transaction design (entropy = `blockhash(block.number - 1) +
block.timestamp`) has a real weakness: whoever decides *when* to submit the triggering
transaction already knows that entropy source, and a block producer controls `block.timestamp`
and whether to include the transaction at all — enough to bias the outcome in theory, even with
no economic incentive to.

`TerraChainGame` instead splits it into two steps:

1. **`commitBotAttack()`** — permissionless, opens once enough sessions have accumulated. At
   this moment, the entropy that will eventually be used (`blockhash` of the current block)
   doesn't exist yet — that block hasn't finished being mined.
2. **`revealBotAttack()`** — permissionless, callable once at least one block has passed. Uses
   `blockhash(commitBlock)`, which by now is permanently fixed and could not have been
   influenced by anyone at commit time, including the block's own producer.

No oracle, no off-chain dependency, still fully permissionless — the `worker/` relayer polls
`botAttackReady()` / `botAttackRevealReady()` and drives both steps automatically, but anyone
(not necessarily the same caller for both steps) could do either half manually.

### Sponsored Zones — DePIN monetization, with Sybil resistance

A local business (or anyone) can pay native CTC via `createSponsoredZone(...)` to sponsor a
circular area (up to `MAX_ZONE_RADIUS_METERS`, 2km) for a fixed number of days, funding it with at
least `MIN_ZONE_POOL` (200 CTC) so each zone is a real commitment rather than dust. Every
Claim/Reinforce that lands inside an active zone automatically pays the player a share of that
zone's pool — turning the same real-world GPS activity that powers the game into something a
business will actually pay for, settled entirely on Creditcoin. A `PLATFORM_FEE_BPS` cut (5%) of
every payout goes to the protocol as revenue; the sponsor can reclaim any unused pool via
`withdrawUnusedPool(...)` once the zone expires.

A sponsor also supplies a **business name** (up to `MAX_ZONE_NAME_BYTES`, 32 bytes — counted in
UTF-8 bytes, so an accented or non-Latin name gets fewer visible characters). That name is what
players read off the map, which is the actual point of sponsoring: a business isn't buying
anonymous foot traffic, it's buying being seen by the people walking past. The name is emitted in
`SponsoredZoneCreated` rather than written to contract storage — the indexer replays events
anyway, no contract logic ever reads it, and keeping it out of storage saves the sponsor an
`SSTORE` and keeps `TerraChainGame` inside the 24576-byte EIP-170 deployment limit, which it sits
close to (~24.2KB). Event logs are just as permanent and just as public, so nothing about the
name's availability is weaker for it.

The obvious attack on any "pay for real-world activity" system is Sybil farming — one person
submitting the same claim over and over from many addresses (or one address repeatedly) to drain
a pool meant for genuinely new foot traffic. Rather than requiring an identity/KYC oracle (which
would undermine the permissionless, privacy-preserving point of the whole system), repeat
payouts to the **same address** in the **same zone** decay geometrically (`SYBIL_DECAY_BPS`,
floored at `SYBIL_MIN_PAYOUT_BPS`) and are subject to a cooldown (`SYBIL_COOLDOWN_SECONDS`) —
farming one zone with one address stops being worth it long before it can drain a sponsor's pool,
purely through economics.

### Duels — friendly, opt-in PvP

Two players can wager native CTC on who walks further within a fixed time window —
`challengeDuel(opponent, durationHours)` locks the challenger's stake, `acceptDuel(duelId)`
matches it and snapshots both players' `cumulativeMeters` as the starting line. Every subsequent
Claim/Reinforce (completely normal gameplay, nothing duel-specific to do) grows that number, and
`settleDuel(duelId)` — permissionless, callable by anyone once the window closes — pays the
whole pool (minus the platform fee) to whoever's distance grew more, or splits it evenly on a
tie. No territory or Base is ever at risk; a duel can also be run with a 0 stake for a purely
for-fun race. Nothing here happens unless both sides explicitly opted in via challenge + accept.

## Architecture

```
   Player's phone (browser, GPS)
          │  1. walk a loop; distance + duration + type recorded
          ▼
 ┌────────────────────┐
 │ TerraSession.sol    │   Sepolia (source chain)
 │ emits               │
 │ SessionRecorded(...) │
 └─────────┬───────────┘
          │  2. worker watches for the event, waits for
          │     Attestcoin Protocol attestation, builds a
          │     Merkle + continuity proof (@gluwa/usc-sdk)
          ▼
 ┌────────────────────┐
 │ Relayer worker       │   permissionless off-chain process
 │ (worker/)            │
 └─────────┬───────────┘
          │  3. execute(action, chainKey, height, txBytes,
          │             merkleProof, continuityProof, ...)
          ▼
 ┌────────────────────┐
 │ TerraChainGame.sol   │   Creditcoin CC3 Testnet (execution chain)
 │ extends ASCBase      │   re-verifies the proof on-chain via the
 │  - Bases (territory,  │  native BlockProver precompile before
 │    spatial grid)      │  trusting anything the relayer says
 │  - Claim/Reinforce    │
 │  - permissionless     │
 │    commit/reveal       │
 │    botAttack           │
 │  - Sponsored Zones     │
 └─────────┬───────────┘
          │  4. events replayed + kept in sync by
          ▼
 ┌────────────────────┐
 │ Indexer (indexer/)    │   in-memory read cache + small REST API
 │  GET /bases            │
 │  GET /players/:address │
 │  GET /zones            │
 └─────────┬───────────┘
          │  5. polled by
          ▼
 ┌────────────────────┐
 │ Frontend (Leaflet map)│
 └────────────────────┘
```

The relayer is **not a trusted party** — `execute()` independently re-verifies the cross-chain
proof against Creditcoin's native precompile (`0x...FD2`) before any game state changes. A
malicious relayer can at worst refuse to relay a real session promptly; it cannot forge one.

The indexer has **zero authority** either — every field it serves is a direct mirror of an
on-chain event; it never computes or trusts anything beyond what the contract already emitted.
Losing/restarting it can't corrupt game state, it just replays from chain again. It exists purely
because looping one RPC call per Base per connected player doesn't scale (see "Scaling to many
users" below) — writes still go straight from the player's wallet to Sepolia, untouched by any
backend.

## Folder structure

- `contracts/` — Hardhat + Solidity. `TerraSession.sol` (Sepolia), `TerraChainGame.sol`
  (Creditcoin). `TerraToken.sol` is retired (Phase 1 has no token/Bank/Slot economy) but kept in
  the repo unused rather than deleted, to avoid churn for anyone with old references to it. Unit
  tests in `test/` exercise the game logic via a harness (no live precompile needed locally).
- `worker/` — the relayer: watches Sepolia for `SessionRecorded`, waits for attestation, submits
  the proof to `TerraChainGame.execute()` on Creditcoin. Processes many sessions concurrently
  (bounded by `MAX_CONCURRENT_SESSIONS`). Also polls the permissionless `botAttackReady()` /
  `botAttackRevealReady()` views every cycle and drives `commitBotAttack()` /
  `revealBotAttack()` as soon as each unlocks.
- `indexer/` — read-side backend: replays `TerraChainGame` events into memory, serves `/bases` and
  `/players/:address` over REST. Optional for a single-player demo, required once more than a
  handful of people are using the app at once.
- `frontend/` — Vite + React + Leaflet. GPS session recording, wallet connect, map of Bases
  colored by owner with a damage overlay. Reads go through the indexer; writes go straight to
  the player's own wallet → Sepolia.

## Setup

You'll need one funded wallet (same private key works on both chains — they're independent EVM
networks) and two RPC URLs.

### 1. Wallet + funds

```sh
cast wallet new   # or any EVM wallet generator — save the address + private key
```

- Sepolia ETH: any public Sepolia faucet (e.g. the Google Cloud Web3 faucet).
- Creditcoin CC3 Testnet tCTC: Creditcoin's Discord faucet — `/faucet address: <your address>`
  (~100 tCTC/24h; each `execute()` call costs a fraction of a cent).
- Sepolia RPC: an Infura/Alchemy API key.

### 2. Contracts

```sh
cd contracts
cp .env.example .env   # fill in CREDITCOIN_WALLET_PRIVATE_KEY and SOURCE_CHAIN_RPC_URL
npm install
npm run compile
npm test                     # optional — runs the game-logic unit tests
npm run deploy:sepolia       # deploys TerraSession, writes to ../deployed-addresses.json
npm run deploy:creditcoin    # deploys TerraChainGame, wires it to TerraSession
```

`deployed-addresses.json` at the repo root now has every address the worker and frontend need.

### 3. Worker (relayer)

```sh
cd worker
cp .env.example .env   # same private key + RPC URLs as above
npm install
npm start
```

Leave this running — it picks up new sessions automatically. **Attestation on Creditcoin lands
roughly every ~8 minutes in practice**, so a session won't show up in the game until a few minutes
after you record it. Plan demo timing around this.

### 4. Indexer (read-side backend)

```sh
cd indexer
cp .env.example .env   # CREDITCOIN_RPC_URL is enough; address auto-loads from deployed-addresses.json
npm install
npm start
```

Also leave this running. It prints how many Bases/players it knows about on startup and after
each sync. For a single-player local demo you could skip this and point the frontend straight at
RPC again, but the setup below assumes it's running.

### 5. Frontend

```sh
cd frontend
cp .env.example .env
# fill in VITE_TERRA_SESSION_ADDRESS / VITE_TERRA_CHAIN_GAME_ADDRESS from
# ../deployed-addresses.json, plus VITE_SEPOLIA_RPC_URL and VITE_INDEXER_URL
npm install
npm run dev
```

Open the printed local URL on a phone (same LAN, or deploy the built frontend somewhere with
HTTPS — browser Geolocation requires a secure context on most devices).

## Demo flow

1. Connect wallet.
2. Walk a small loop around a real spot outside, then hit "Kết thúc" — the app automatically
   decides Claim vs Reinforce for you based on the loop's shape, no mode picker needed.
3. Wait for the worker to relay + Creditcoin to attest (~8-15 min) — good moment to explain the
   Attestcoin Protocol integration on camera while it processes.
4. Refresh the map — your Base appears, colored green, painted with the loop's actual walked
   shape (not a circle).
5. Repeat a few more times (with the same or a second wallet) to rack up successful sessions.
   Once 20 have landed since the last bot attack, the worker's next two polling ticks fire
   `commitBotAttack()` then `revealBotAttack()` automatically — watch a random Base's territory
   shrink (dashed outline, lower opacity) live on the map.
6. Walk a loop that encloses one of your own damaged Bases — on confirmation its territory snaps
   back to 100%, undoing the bot's damage.
7. Optionally, sponsor a zone (pay CTC via `createSponsoredZone`) around wherever you're standing
   — the next few Claim/Reinforce sessions that land inside it will automatically receive a CTC
   payout on top of the game's normal outcome.

## Scaling to many users

The core loop (contract + worker + indexer) is designed to hold up past a hackathon demo, not
just survive it:

- **Reads don't hit RPC per Base anymore.** The indexer replays events once and serves everything
  from memory — the frontend never loops `bases(id)` calls, so map load time and RPC usage stay
  flat as the player count grows, not linear in `players × bases`.
- **The relayer doesn't serialize sessions.** Attestation waits (minutes) run fully in parallel
  across sessions (bounded by `MAX_CONCURRENT_SESSIONS` in `worker/`); only the final on-chain
  submission is serialized (via a nonce queue), and that step takes seconds, not minutes. A burst
  of many players claiming/reinforcing at once doesn't create a growing backlog.
- **Claim/Reinforce are O(1)-ish, not O(n).** Bases are bucketed into a lat/lng grid
  (`CELL_SIZE_MICRO_DEGREES` in `TerraChainGame.sol`); overlap/containment checks only ever scan
  the 3x3 cell neighborhood around a loop's center, not every Base ever claimed. This is what
  `MAX_LOOP_METERS` (6km) enforces — it's the bound that guarantees the neighborhood search can
  never miss a real overlap. Gas cost per Claim/Reinforce stays roughly constant as the world
  fills up with Bases, instead of growing with total Base count. `revealBotAttack()` is O(1)
  too — it seeks forward from one starting id (derived from the commit block's hash), not a
  full scan.
- Relaying is **permissionless by design** — running more than one `worker/` instance (different
  wallets) to split load, or letting the community run their own relayers, works without any
  contract changes.

## Security review

The contract was reviewed end-to-end before release. Four issues were found and fixed; each has
a regression test in `contracts/test/` under "Security hardening (audit fixes)":

- **Denial of service via zone spam (critical).** `_payoutSponsoredZones` used to scan every
  Sponsored Zone ever created on every Claim/Reinforce. Since zone creation is permissionless and
  costs almost nothing, anyone could have created thousands of tiny zones until that loop
  exceeded the block gas limit — which would have broken *every player's* sessions permanently.
  Zones are now bucketed in the same lat/lng grid the chunks use, so only a 3x3 neighbourhood is
  ever scanned (`MAX_ZONE_RADIUS_METERS` is capped to one cell width to make that sound).
- **Stranded funds in the Sybil decay path (critical).** A decayed repeat payout debited the pool
  by the *full* per-session share while only paying out the decayed amount, leaving the difference
  permanently unreachable — not claimable by the player, not refundable to the sponsor. The pool
  is now debited by exactly what was paid.
- **Duel stakes could be frozen forever (critical).** Settlement pushed native CTC with a
  `require(success)`, so a recipient that rejects transfers (trivially arranged with a contract
  wallet) made `settleDuel` revert forever, locking both stakes. On a tie this was a griefing
  vector against an honest opponent. All payouts now go through a never-reverting delivery path
  that credits `pendingPayouts` on failure, claimable any time via `withdrawPendingPayout()`.
- **Unvalidated coordinates (high).** Nothing enforced real-world lat/lng bounds, so extreme
  values could overflow the `int32` bounding-box midpoint math and revert the whole cross-chain
  `execute()` — leaving the relayer retrying a session that could never succeed. Coordinates are
  now range-checked, and out-of-bounds sessions get a normal `ClaimRejected`/`ReinforceRejected`
  outcome like any other invalid input.

Two relayer reliability bugs were fixed at the same time, both of which would have cost players
walks they genuinely did:

- The worker resumed from the *current* block on restart, silently skipping every session
  recorded while it was down. It now persists its scan position to `.relayer-checkpoint.json`.
- A transient proof-builder/RPC failure dropped a session permanently. Sessions are now retried
  with exponential backoff (`MAX_SESSION_ATTEMPTS`); replay is safe because `execute()` is
  idempotent thanks to the on-chain replay guard.

## Anti-cheat & known limitations (MVP scope)

- Average-speed cap (`MAX_SPEED_METERS_PER_SECOND` in `TerraChainGame.sol`) rejects sessions
  reporting faster-than-running pace — a basic defense against teleport/GPS-jump spoofing, not a
  full solution (a determined attacker with a fake-GPS app can still cheat). Flagged as future
  work: require photo/video proof-of-presence, or cross-check against nearby players.
- Distance between two points (used for overlap/containment checks, area math, and the spatial
  grid) is a **flat-earth approximation** (`METERS_PER_DEGREE = 111_320`, no `cos(latitude)`
  correction) — accurate enough at city scale, not survey-grade. Fine for a single-city demo;
  would drift at very high latitudes or continent-spanning distances.
- A Base made of multiple chunks (see "Real polygons, not circles" above) reports its total area
  as the **sum of its chunks' areas**, not an exact polygon union — computing a true union
  on-chain for arbitrary (possibly concave, possibly self-touching) polygons is prohibitively
  complex. If a player deliberately walks a new loop that re-overlaps their own existing ground,
  that overlapping sliver gets double-counted. There's no incentive to actually do this (it
  doesn't gain any new territory), so it's a theoretical rather than practical exploit.
- The indexer keeps state **in memory only** — a restart replays from `INDEXER_START_BLOCK`, which
  is correct but gets slower to catch up as the chain's history grows. Fine for MVP; a real
  deployment would add a persistence layer (Postgres/SQLite snapshot) so restarts are instant.
- **Zone business names are unverified.** Nothing on-chain proves a sponsor is the business they
  name — anyone with 200 CTC can create a zone called "Highlands Coffee". The name is a label
  paid for by whoever created the zone, not an attestation, and the zone's tooltip shows the
  sponsor's address alongside it precisely so a player can tell two same-named zones apart. A
  production deployment would need a claim/verification step (a signature from a domain the
  business controls, or a registry) before the name can be trusted; clients must also render it
  as inert text, never as markup, since it's attacker-controlled input.
- Sponsored Zone Sybil resistance (decay + cooldown, see above) raises the cost of farming a
  zone with a **single address**, but doesn't stop someone from spreading the same walk across
  a handful of freshly-generated wallets — the tradeoff deliberately made to avoid any
  identity/KYC dependency. A production deployment expecting adversarial sponsors might layer on
  a per-zone claim cap or a lightweight proof-of-uniqueness signal on top of this.

## Where this goes next

Four features are designed but not built — Sponsored Zone brand kits (logo/story/mission),
proximity-based Base defense, teams, and PvP invasion. [ROADMAP.md](ROADMAP.md) covers each at
implementation depth: how it lands on the contracts, and the part that is genuinely hard. Two
constraints gate all of them and are worth knowing before reading further here: `TerraChainGame`
compiles to 24167 of the 24576 bytes EIP-170 allows, and the GPS-spoofing limitation below stops
being tolerable once presence buys defense.

## Path to production checklist

These need real-world action (money, real keys, external review) rather than more code — tracked
here so they don't get lost between the hackathon submission and an eventual real launch:

- [ ] **Gas funding for the relayer.** Right now the worker's wallet needs continuous testnet
  faucet top-ups — it pays gas both for relaying player sessions and for the
  `commitBotAttack()` / `revealBotAttack()` calls it fires once unlocked. A real deployment needs a sustainable model: sponsorship, or leaning
  fully on the permissionless-relaying/permissionless-botAttack properties and letting community
  operators cover their own costs.
- [ ] **Stronger anti-cheat.** GPS spoofing apps are trivial to get for a public audience (unlike
  a room of hackathon judges). Consider: photo/video proof-of-presence with timestamp+geotag,
  cross-corroboration from nearby players' phones, or anomaly detection on session patterns.
- [ ] **Security audit.** CertiK audit credits are part of this hackathon's winner benefits —
  worth using before any mainnet deployment, given real value would be on the line.
- [ ] **Mainnet deployment.** Currently Sepolia + Creditcoin CC3 Testnet only. Moving to Ethereum
  mainnet + Creditcoin CC3 Mainnet needs its own `.env`, real funds, and a re-check of the
  Attestcoin Protocol mainnet chain keys/precompile addresses (see docs.attestcoin.org).
- [ ] **Indexer persistence + horizontal scaling.** In-memory + single-process is fine for MVP;
  add a real datastore and consider read replicas once traffic actually demands it.
