# MiniMonster Terra — Pitch Deck

**BUIDL CTC 2026 Fall** · Tracks: **DePIN + Gaming** · Powered by **Attestcoin Protocol**

---

## Slide 1 — Title

**MiniMonster Terra**
*Walk the real world. Paint it on-chain.*

- A GPS territory-painting game where your phone is the only hardware you need
- Built on Creditcoin, cross-chain-verified through the Attestcoin Protocol
- Team: [tên team] · Submission: BUIDL CTC 2026 Fall

---

## Slide 2 — The Problem

- **DePIN today** mostly rewards static hardware (sensors, routers, storage nodes) — expensive to deploy, slow to scale, and easy to fake at the edges (Sybil farming).
- **On-chain games** either fake "real-world" mechanics entirely, or bolt on GPS with zero cryptographic guarantee it's real.
- **Local businesses** have no cheap, permissionless way to pay for real foot traffic without building their own loyalty infra.
- **On-chain randomness** in most games is still naive (`blockhash`-based) — theoretically biased by whoever controls block production.

We built a project that treats **all four** of these as one connected problem, not four separate features.

---

## Slide 3 — The Idea

Turn **your own two feet** into a DePIN sensor network — and a game.

- Walk a closed loop around a spot → it becomes your territory (**Claim**)
- Walk around your own territory → restore it after damage (**Reinforce**)
- No PvP. The only enemy is **the chain itself** — a permissionless bot that periodically damages territory once enough real activity has piled up
- Every walk is proven real via **cross-chain attestation**, not trusted client input

---

## Slide 4 — Why Attestcoin Protocol (core mechanic, not an add-on)

```
Player walks  →  TerraSession.sol (Sepolia)      "I walked this shape, this far, this long"
                        │
                        ▼  Attestcoin Protocol proves the event happened
                        │  (Merkle + continuity proof, cross-chain)
                        ▼
              TerraChainGame.sol (Creditcoin)     re-verifies via native BlockProver
                                                    precompile — trusts NOTHING from the
                                                    relayer until proven on-chain
```

- The relayer (`worker/`) is **not trusted** — it can only delay a real session, never forge one
- No bridge, no custom oracle — Attestcoin Protocol IS the trust layer
- This is what makes "GPS walk → on-chain territory" actually credible instead of a client-side claim

---

## Slide 5 — Real Geometry, Not Circles

Most "walk to claim land" games fake it with a radius around a center point. We don't.

- Every loop is a **real walked polygon** (up to 16 points, simplified client-side via Ramer-Douglas-Peucker from the raw GPS path)
- On-chain: **Shoelace formula** for area, **ray-casting point-in-polygon** + **segment intersection** for overlap/containment — all in Solidity, no off-chain computation
- A Base can grow into genuinely irregular shapes over multiple sessions (multi-chunk territory)
- Spatial grid index keeps gas **O(1)-ish** as the world fills up — not O(n) over every claim ever made

---

## Slide 6 — Solving 3 Real Blockchain Problems, Not Just Building a Demo

| Problem | Naive approach | What we built |
|---|---|---|
| **On-chain randomness** for bot attacks | `blockhash(block.number-1) + timestamp` in one tx — theoretically biasable by a block producer | **Commit-reveal**: `commitBotAttack()` opens before the entropy block even exists → `revealBotAttack()` resolves it after it's permanently mined. No oracle, no VRF fee, fully permissionless. |
| **Sybil farming** in DePIN rewards | Require KYC/identity to reward "real" activity | **Geometric payout decay** + cooldown per (address, zone) — farming one zone with one address stops being profitable long before it drains the pool. Zero identity dependency. |
| **Cross-chain trust** for real-world claims | Trust a relayer / centralized oracle | **Attestcoin Protocol** — proof re-verified on-chain via native precompile; relayer is provably unable to forge state. |

Each of these has a **unit test proving the fix works** — not just a design doc.

---

## Slide 7 — DePIN Monetization: Sponsored Zones

Turning foot traffic into real revenue, permissionlessly.

- Any business pays **native CTC** to sponsor a circular zone for N days
- The sponsor's **business name shows on every player's map** — they're buying visibility to the people walking past, not just anonymous foot traffic
- Every Claim/Reinforce landing inside it **automatically pays the player** a share of the pool
- **5% platform fee** on every payout → protocol revenue, from day one, no token launch needed
- Overlapping zones stack; unused pool returns to the sponsor after expiry
- This is the DePIN thesis in practice: **real-world GPS activity becomes something a business will pay for**

---

## Slide 8 — Game Loop (What It Feels Like)

1. Open the app — map is the whole screen, no clutter
2. One FAB to start walking. No mode picker — Claim vs Reinforce is inferred automatically from your loop's shape and position
3. Walk a loop outside → close it → submit
4. ~8-15 min later: your territory appears, painted in your real walked shape
5. Every 20 sessions, the world bot-attacks a random Base — walk back to Reinforce and undo it
6. A local café sponsors the block you're standing on → you just got paid in CTC for a walk you were doing anyway

---

## Slide 9 — Architecture at a Glance

```
Phone (GPS) → TerraSession.sol (Sepolia)
                    │ Attestcoin Protocol proof
                    ▼
            TerraChainGame.sol (Creditcoin CC3)
              ├─ Bases / polygon geometry / spatial grid
              ├─ commit-reveal bot attacks
              └─ Sponsored Zones (Sybil-resistant payouts)
                    │ events replayed
                    ▼
            Indexer (in-memory, REST API)
                    │
                    ▼
            Frontend (React + Mapbox, i18n: EN/VI/KO)
```

- Fully permissionless relaying — anyone can run a `worker/` instance
- Reads never hit RPC per-Base — indexer serves everything from memory, O(1) regardless of player count
- 41 passing unit tests across game logic, commit-reveal, and Sponsored Zones

---

## Slide 10 — Live Deployment

- **TerraSession** (Sepolia): `0x9c8cB305903708b2022dF25afc7e5f810567Ee97`
- **TerraChainGame** (Creditcoin CC3 Testnet): `0x9Cd25e1b88F21033f4b0338574dC5a2AE7A032cc`
- Fully working end-to-end: walk → attest → territory → bot attack → reinforce → sponsored payout
- 3 languages, mobile-first, works on any phone with a browser — zero app install

---

## Slide 11 — What's Next (Path to Production)

- Stronger anti-cheat: photo/video proof-of-presence, cross-player corroboration
- Persistent indexer (Postgres) + horizontal scaling for read replicas
- Security audit (CertiK credits available through this hackathon's winner track)
- Mainnet deployment (Ethereum + Creditcoin CC3 Mainnet)
- Sustainable relayer gas funding model — sponsorship or community-run relayers

---

## Slide 12 — Product Roadmap (What The Game Becomes)

Phase 1 ships territory you own. Next is territory worth fighting for. Full engineering detail in [ROADMAP.md](ROADMAP.md).

- **A real economy** — 3km of free walking allowance per day, reset daily and non-cumulative; run out and you buy more with CTC. Replaces the current per-session cap, creates the first sink the game has had, and adds a revenue line that does not depend on selling zones. Bought allowance deliberately earns **no** sponsor rewards — sponsors pay for real foot traffic, not for whoever spends most
- **Brand kits** — sponsors upload a logo, story and mission, not just a name. Content-addressed (IPFS CID in an event), with **domain-signed brand verification** as a paid tier → second revenue line beyond the 5% fee
- **Proximity defense** — being near your own Base makes it harder for the bot to take. Derived from sessions you already prove, so it costs no new attestations
- **Teams** — several members near the same Base beat any one of them alone. The retention mechanic, and a team treasury that funds its own Sponsored Zones
- **PvP invasion, solo and team** — territory finally changes hands. Ships opt-in and region-scoped first, exactly the way Duels did

**The two things that gate all of it, stated up front:** `TerraChainGame` is at 98.3% of the EIP-170 size limit (409 bytes left), so the library/module split comes first — and anti-cheat stops being optional the moment spoofed GPS can buy defense or take someone else's ground.

---

## Slide 13 — Why This Wins

- **Attestcoin Protocol is the core mechanic**, not a checkbox integration
- **DePIN**: real sensor data (GPS) with actual settlement (Sponsored Zones) and Sybil resistance — not just "we used a phone"
- **Gaming**: real asset ownership on-chain, a living world with a non-PvP threat, zero-friction UX
- **Technical depth**: on-chain polygon geometry, commit-reveal randomness, geometric Sybil decay — each backed by tests, not slideware
- **Revenue from day one**: 5% platform fee on Sponsored Zone payouts, no token launch required

**MiniMonster Terra — real steps, real proof, real value.**
