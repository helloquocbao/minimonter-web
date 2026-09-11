# Product roadmap — beyond Phase 1

Phase 1 (shipped, see [README.md](README.md)) is territory painting: walk a loop, prove it
cross-chain through the Attestcoin Protocol, own the ground. The only threat is a permissionless
bot, and no player can ever take another player's territory.

This document covers the five features that come next. It is written for the same audience as
[PITCH.md](PITCH.md), but at implementation depth: for each feature, what it is, why it earns its
place, how it actually lands on the contracts, and the part that is genuinely hard. Nothing here
is built yet — the honest engineering notes are the point of the document, not a disclaimer on it.

**Two constraints shape all five**, so they are stated once here rather than repeated:

- **`TerraChainGame` has ~409 bytes of deployment headroom.** It compiles to 24167 bytes against
  the 24576-byte EIP-170 limit — 98.3% full. Features 3, 4 and 5 are all new contract logic, so
  the split has to be designed before the gameplay is: extract the polygon geometry into an
  external `library` (its code deploys separately and is `DELEGATECALL`ed, so it stops counting
  against this contract's size), and/or move combat into a second contract that `TerraChainGame`
  authorises. This is a prerequisite, not a cleanup task.
- **Anti-cheat stops being optional.** Phase 1 tolerates GPS spoofing because the worst a cheater
  gains is undoing bot damage — nobody else loses anything. Features 3 and 4 pay out *defense* for
  where your phone claims to be, and feature 5 lets that translate into taking someone else's
  ground. Proof-of-presence moves from "future work" in the README's limitations to a hard
  dependency, and the sequencing at the end of this document reflects that.

---

## 1. Daily walking allowance — the economy

**What it is.** Every player gets **3km of walking allowance per day**, free. It resets each day
and does **not** carry over — unused free allowance is gone at reset. When a player runs out they
either wait for tomorrow or **buy more allowance with CTC**, and purchased allowance is the
opposite: it never resets, and sits there until it is used.

The existing per-session distance cap (`BASE_LOOP_CAP_METERS` growing to 6000m with
`cumulativeMeters`) is **removed** and replaced by this. Two competing distance limits would be
one too many for a player to reason about.

**Why it earns its place.** It is the only thing on this roadmap that turns the game into an
economy rather than a rewards programme. Today nothing a player does costs them anything: walking
is free, the cap rises for free, and the relayer even pays their gas. Money flows in from sponsors
and out to players, with no loop. A daily allowance creates the sink, and selling more of it
creates a **second revenue line that does not depend on selling zones to businesses** — today the
5% `PLATFORM_FEE_BPS` on zone payouts is the only revenue there is.

The daily reset is also the retention mechanic. A budget that expires gives a reason to open the
app today rather than at the weekend, and 3km — roughly 40 minutes of walking — is deliberately
tight enough that a committed player meets the paywall.

**How it lands on-chain.** Per player: remaining free allowance, remaining purchased allowance,
and the day index the free figure was last reset for. A session spends free allowance first, then
purchased.

The reset has to be **lazy**. Nothing on-chain can iterate every player at midnight — there is no
cron, and the gas would be unbounded. Instead the current day index (`block.timestamp / 1 days`,
UTC) is compared against the stored one whenever a player's allowance is read or spent, and the
free figure is refilled at that moment. The player experiences a daily reset; the contract only
ever touches one player's record.

Enforcement belongs in the contract, not the backend — a point worth recording because it came
up as a design question. The contract is public and `execute()` is permissionless by design, so
anyone can submit a session without going near this project's frontend or indexer; and the indexer
only ever *replays* what already happened on chain, so it has no power to reject anything. If
allowance were only checked off-chain, ordinary players would be limited to 3km and anyone
technical would walk unlimited and never buy a thing. The backend's job is to *show* the remaining
allowance; the contract's job is to decide. (A backend-signed permit would also work, but it makes
the server a single trusted point — down means nobody can play — which trades away the
permissionless property the rest of the design is built on.)

Buying is a `payable` call that credits purchased allowance and forwards the CTC to
`feeRecipient` — the same address the platform fee already goes to. Price should be owner-settable
within hard bounds rather than a constant, because a fixed CTC price drifts with the CTC price.

Keep `MAX_LOOP_METERS` (6000) as an absolute per-loop sanity bound even after the progression cap
goes. It is what stops a single absurd polygon from entering the geometry maths, and that job is
unrelated to the economy. `cumulativeMeters` also stays — Duels snapshot it.

**The hard part.**

- **Purchased allowance must not earn Sponsored Zone rewards.** This is settled design, and it is
  settled this way for a reason worth writing down: a sponsor pays for *real foot traffic in their
  neighbourhood*. If bought kilometres collected zone payouts, the player who spends most would
  drain the pool, and worse, buying 1km for X CTC to earn Y CTC from a zone is a straight
  arbitrage whenever Y > X — the project would be selling allowance and handing the proceeds
  back out of sponsors' pools. So: purchased allowance claims territory, walks, and duels
  normally, but **only free daily allowance is eligible for zone payouts**.
- **That decision moves the Sybil attack rather than removing it.** Once zone rewards come only
  from free allowance, the way to farm a sponsor is many accounts each harvesting their free 3km.
  `SYBIL_DECAY_BPS` does not touch this — it decays repeat payouts to the *same* address, and
  these are all different addresses on their first payout each. This is the same gap the README
  already admits, but the daily allowance sharpens it into the primary attack. The flip side is a
  real gain: a per-account daily ceiling **bounds** what any one cheater extracts per day, which
  is more than the current design does.
- **A rejected session must not burn allowance.** Today a Claim that loses an overlap race is a
  documented sunk cost — the player walked for nothing. That is tolerable when walking is free.
  Once allowance is a paid resource, a rejection costs real money for an outcome the player could
  not have predicted (attestation ordering decides it). Allowance should be refunded on
  `ClaimRejected` / `ReinforceRejected`, or reserved and only spent on success.
- **Tuning risk.** 3km is intentionally tight, but a player who hits the wall before the game has
  hooked them churns instead of paying. This wants a real number from real players, and the
  constant should be owner-settable so it can move without a redeploy.

---

## 2. Sponsored Zone brand kits — logo, story, mission

**What it is.** Today a sponsor supplies a business name (up to `MAX_ZONE_NAME_BYTES`, 32 bytes),
which players read off the map. A brand kit extends that to what a business actually wants: a
logo, a short story, and a mission statement — so a zone becomes a place with an identity rather
than a labelled circle.

**Why it earns its place.** This is the revenue feature. A business sponsoring a zone is not
buying anonymous foot traffic, it is buying being *seen* by the people walking past — and a name
alone is a thin version of that. It also opens a second revenue line beyond the existing 5%
`PLATFORM_FEE_BPS` on payouts: a **verified brand** tier is something a real business will pay for
directly, and verification is the thing that makes a logo trustworthy anyway (see below).

**How it lands on-chain.** Media cannot live in contract storage, and it does not need to. The
zone name is already emitted in `SponsoredZoneCreated` rather than stored, precisely because the
indexer replays events and no contract logic ever reads it. A brand kit follows the identical
pattern: a content hash (IPFS/Arweave CID) covering a small JSON manifest of `{logo, story,
mission}`, emitted in an event — either as a parameter on zone creation, or via a
`setZoneBrandKit(zoneId, cid)` callable only by that zone's sponsor so a brand can be updated
without recreating the zone. Because the reference is content-addressed, a sponsor cannot silently
swap the image behind an approved CID; changing the artwork means emitting a new event, which is a
permanent audit trail of what was displayed when. Cost to the contract: one event, no `SSTORE`,
which is what the remaining EIP-170 headroom can actually afford.

**The hard part.** Three things, and the first is a launch blocker:

- **Impersonation stops being cosmetic.** The README already notes that zone names are unverified —
  anyone with 200 CTC can create a zone called "Highlands Coffee". With a real logo attached, that
  goes from a misleading label to something usable for fraud, because a logo is what people
  actually authenticate a brand by. Verification has to ship *with* brand kits, not after: a
  signature from a key committed in a DNS TXT record on the business's own domain is the
  lowest-friction option that needs no KYC oracle and keeps the permissionless property. Unverified
  zones keep the name-only treatment.
- **Moderation, on immutable storage.** Someone will upload abusive or illegal imagery, and IPFS
  content cannot be deleted. The contract must not be the moderation layer; the indexer needs a
  flag and the client a blocklist, so a CID can be refused at render time even though it exists
  forever. Deciding who operates that list is a governance question worth answering before launch,
  not during an incident.
- **Availability.** A CID nobody pins is a broken image. Pinning is an ongoing cost, and the
  natural answer is to fold it into the paid verified tier.

---

## 3. Proximity defense — being there makes your ground harder to take

**What it is.** Standing near a Base you own raises its effective defense, reducing how much a bot
attack takes off it. Presence, not just past effort, protects territory.

**Why it earns its place.** It closes a real gap in the Phase 1 loop. Right now the only response
to bot damage is walking a full Reinforce loop, which means the game asks nothing of you between
sessions and rewards nothing for actually being in the neighbourhood you claimed. Proximity
defense makes territory feel like somewhere you live rather than a shape you once drew, and it is
the mechanic features 4 and 5 build on.

**How it lands on-chain.** The bot attack damage roll — currently `BOT_MIN_DAMAGE_PERCENT` to
`BOT_MAX_DAMAGE_PERCENT` resolved via commit-reveal — gains a defense modifier read from a recent
presence record per (player, Base).

The design decision that matters is **where presence proofs come from**. Phase 1 proves *completed
walk sessions*: a session is recorded on Sepolia, attested, and executed on Creditcoin. "I am near
my Base right now" is a different claim, and the expensive way to prove it is a heartbeat — a
Sepolia transaction plus an attestation plus a Creditcoin execution, per ping, per player. At one
ping every five minutes that is 288 proofs per player per day, which is not a rounding error on
anyone's gas budget.

The cheap way is to make presence a **byproduct of the sessions that already exist**: a session
whose start or end point falls within R metres of one of your Bases grants that Base a defense
buff that decays with a half-life measured in hours. It rides a proof the system is already paying
for, needs no new proof type, and still rewards playing near your own ground. That is the
recommended v1; batched heartbeats (many pings under one Merkle proof) are the upgrade path if
finer-grained presence turns out to matter.

**The hard part.** This mechanic rewards *standing still*, which is the single easiest thing to
fake. `MAX_SPEED_METERS_PER_SECOND` (6) catches a cheater teleporting between distant points, but
a stationary spoofed location sails through every check in the contract, because there is nothing
suspicious about not moving. The consequence is a hard design ceiling: **a proximity buff must
never be worth more than walking a real Reinforce loop.** If it is, the cheapest and most
spoofable strategy becomes the dominant one, and the game quietly stops being about walking.

---

## 4. Teams — shared bases, shared presence

**What it is.** Players form a team. When several members are near the same Base, that Base gets a
larger power and defense bonus than any one of them could provide alone.

**Why it earns its place.** It is the retention and growth mechanic. Phase 1 is a solo loop with an
optional duel; nothing in it gives a player a reason to bring a friend. Teams also give the DePIN
side something sponsors want: a group that coordinates where it walks is far more valuable to a
business than the same number of unconnected individuals, and a team treasury that funds its own
Sponsored Zones turns the social layer back into revenue.

**How it lands on-chain.** A team registry (create, join, leave, with a member cap), an optional
team owner on a Base, and a bonus that scales with the number of *distinct members* whose recent
presence covers that Base — reusing whatever presence record feature 3 establishes rather than
inventing a second one.

**The hard part.** Sybil resistance, and this is the weakest link of the four features.

"Five members are near Base X" is indistinguishable on-chain from one person with five wallets and
one phone. The Sponsored Zone defence does not transfer: `SYBIL_DECAY_BPS` and
`SYBIL_COOLDOWN_SECONDS` work because the thing being farmed is *money*, so decaying the payout
makes farming uneconomic. Here the thing being farmed is *defense*, which has no price to decay —
the attacker is not trying to extract a pool, they are trying to make their own ground
unassailable, and one extra wallet costs them nothing.

What might actually work is requiring **independent history** rather than independent addresses: a
member only counts toward the bonus if their own `cumulativeMeters` clears a threshold accumulated
across distinct calendar days, which costs real elapsed time to manufacture even with a spoofer,
and counting members by the *diversity of their GPS traces* rather than by membership alone. Both
are heuristics, not proofs. The honest recommendation is to prototype and adversarially test the
anti-Sybil model *before* building the team gameplay on top of it — the fun part is easy and the
model is the hard part, so building them in that order would be backwards.

---

## 5. PvP invasion — solo and team

**What it is.** Walking a loop over someone else's Base as an act of invasion, contested by their
accumulated defense from features 3 and 4. Solo first, then team versus team.

**Why it earns its place.** It is the endgame the rest of the systems point at, and it is what makes
territory genuinely scarce: ground that can only be gained from an empty map has a ceiling, ground
that can change hands does not.

It is also the largest design shift in this document, and worth naming plainly: **Phase 1
deliberately has no territory combat.** Duels are opt-in, wager only, and the README is explicit
that no territory is ever at risk. Invasion inverts that guarantee, so it inherits the burden of
proof — it has to be demonstrably fair before it is fun.

**How it lands on-chain.** An invasion is a session type, resolved by comparing attacker effort
against the defender's accumulated defense, with the outcome being a *partial* territory transfer.
Two Phase 1 patterns carry over directly: the `ClaimRejected` / `ReinforceRejected` design — every
session resolves to a real event carrying the same `sessionId`, so the frontend always shows a
concrete reason instead of a silent revert — becomes `InvasionRepelled` / `InvasionSucceeded`; and
the bot attack's commit-reveal is the template for any randomness in combat resolution, for exactly
the reason it was built: whoever chooses when to submit must not be able to see the entropy first.

**The hard part.** Three problems, in descending order of how badly they break things:

- **First-proof-wins is not a fair combat rule.** Phase 1's concurrent-claim semantics are
  documented and accepted: if two players claim overlapping ground, whoever's proof executes on
  Creditcoin first wins, and attestation timing is not perfectly predictable. That is tolerable
  when the stake is unclaimed ground. It is not tolerable in combat, where the loser walked a real
  loop in the real world and loses real territory to what is effectively proof-relay latency.
  Invasion needs explicit attack windows and deterministic ordering *within* a window, not a race.
- **Loss aversion will churn new players.** A newcomer whose first Base is farmed by an organised
  team does not learn the game, they uninstall it. This needs shields designed in from the start,
  not patched in after the numbers get bad: an immunity period on newly planted Bases, a per-target
  attack cooldown, a daily cap on territory lost, and a hard floor so invasion can never take a
  Base to zero — ground should only ever be *fully* lost to the bot, never to another player.
- **Collusion.** Two wallets trading a Base back and forth farm any reward attached to invading.
  The simplest defence is to attach none: make invasion strictly zero-sum in territory, with no
  side payment, so the only thing to gain is the ground itself.

Given all three, invasion should ship the way Duels did — **opt-in and region-scoped first**, with
players choosing to make their Bases contestable, and only ever become global once the fairness
and shield mechanics have survived real players.

---

## Suggested sequencing

The order is dictated by dependencies and by where the risk sits, not by which feature demos best.

| # | Work | Why here |
|---|---|---|
| 0 | **Contract size split** — geometry into an external library, combat into a second authorised contract | 409 bytes of headroom. Every feature below is blocked on this, and retrofitting a split after writing the logic means writing it twice. |
| 1 | **Daily walking allowance + selling allowance** | The economy, and the only row that adds a revenue line independent of selling zones. No dependency on presence proofs or teams. Ship the rejected-session refund with it, not after. |
| 2 | **Brand kits + brand verification** | No dependency on presence proofs or anti-cheat, and the verified-brand tier is the other half of the revenue story alongside row 1. Verification ships with it, not after. |
| 3 | **Proof-of-presence + proximity defense (solo)** | Establishes the presence record features 4 and 5 both read. Start with session-derived presence; it needs no new proof type. |
| 4 | **Anti-Sybil model for teams, adversarially tested** | Deliberately ahead of team gameplay: the model is the hard part and everything social is built on it. |
| 5 | **Teams** | Cheap once 3 and 4 exist. |
| 6 | **Stronger anti-cheat (proof-of-presence hardening)** | Hard prerequisite for invasion, not for anything above it. Territory changing hands on spoofable GPS is the one failure the game cannot absorb. |
| 7 | **PvP invasion — opt-in, region-scoped, then global** | Last, because it depends on every row above and carries the most design risk. |

Two items from [PITCH.md](PITCH.md)'s production checklist become hard dependencies rather than
parallel work: **indexer persistence** (teams and combat history are stateful — in-memory replay
from genesis stops being viable) and **the security audit** (invasion is the first mechanic where a
contract bug costs players assets they earned, rather than costing the protocol testnet gas).
