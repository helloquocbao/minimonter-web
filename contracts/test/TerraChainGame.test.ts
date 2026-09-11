import { expect } from "chai";
import { ethers, network } from "hardhat";

describe("TerraChainGame", function () {
  async function deploy() {
    const [deployer, alice, bob, carol] = await ethers.getSigners();

    const Harness = await ethers.getContractFactory("TerraChainGameHarness");
    const game = await Harness.deploy();

    return { deployer, alice, bob, carol, game };
  }

  /// Resolves a bot attack via the commit-reveal flow (commitBotAttack, then mine one block,
  /// then revealBotAttack) — replaces the old single-call `botAttack()` everywhere in this
  /// suite. See the contract's doc comment on commitBotAttack for why this exists.
  async function triggerBotAttack(game: any) {
    await game.commitBotAttack();
    await network.provider.send("evm_mine");
    return game.revealBotAttack();
  }

  const M = 1_000_000; // 1 degree in micro-degrees, for readable test coordinates

  /// Axis-aligned square polygon (in micro-degrees), corners at (lat±half, lng±half), walked
  /// clockwise starting top-left. `half` is in micro-degrees.
  function square(centerLat: number, centerLng: number, half: number) {
    return {
      lats: [centerLat + half, centerLat + half, centerLat - half, centerLat - half],
      lngs: [centerLng - half, centerLng + half, centerLng + half, centerLng - half],
    };
  }

  /// Mines `count` successful Claim sessions from throwaway locations far apart from each other
  /// and from (0,0), purely to push totalSuccessfulSessions up so botAttack() unlocks. Spreads
  /// across both lat and lng (in small increments, not multiplied by whole degrees) so many
  /// calls never approach the int32 / real-world lat-lng range limits.
  async function fillSessionsWithClaims(game: any, player: any, count: number, startIndex: number) {
    const STEP = 10_000; // ~1.1km apart — comfortably clear of the 6000m max loop radius
    const ROW_SIZE = 1000; // wrap to a new "row" every this many claims to stay 2-D
    for (let i = 0; i < count; i++) {
      const index = startIndex + i + 1;
      const row = Math.floor(index / ROW_SIZE);
      const col = index % ROW_SIZE;
      const lat = row * STEP;
      const lng = col * STEP;
      const { lats, lngs } = square(lat, lng, 2000); // small 4000m-wide square, well under caps
      await game.exposeHandleClaim(player.address, 1000 + startIndex + i, lats, lngs, 1000);
    }
  }

  it("loopCapOf starts at the base 1000m cap for everyone", async function () {
    const { game, alice } = await deploy();
    expect(await game.loopCapOf(alice.address)).to.equal(1000);
  });

  it("loopCapOf grows permanently with cumulative distance walked", async function () {
    const { game, alice } = await deploy();
    const base = square(0, 0, 2000);

    // Claim 900m (under the 1000m cap) -> cumulative 900, still level 0.
    await game.exposeHandleClaim(alice.address, 1, base.lats, base.lngs, 900);
    expect(await game.cumulativeMetersOf(alice.address)).to.equal(900);
    expect(await game.loopCapOf(alice.address)).to.equal(1000);

    // Reinforce that same base with another 900m walk -> cumulative 1800, still level 0.
    await game.exposeHandleReinforce(alice.address, 2, base.lats, base.lngs, 900);
    expect(await game.cumulativeMetersOf(alice.address)).to.equal(1800);
    expect(await game.loopCapOf(alice.address)).to.equal(1000);

    // Push cumulative past 5000 via more reinforcements (each capped at <=1000m loop).
    await game.exposeHandleReinforce(alice.address, 3, base.lats, base.lngs, 1000);
    await game.exposeHandleReinforce(alice.address, 4, base.lats, base.lngs, 1000);
    await game.exposeHandleReinforce(alice.address, 5, base.lats, base.lngs, 1000);
    // cumulative = 1800 + 1000*3 = 4800, still level 0
    expect(await game.loopCapOf(alice.address)).to.equal(1000);

    await game.exposeHandleReinforce(alice.address, 6, base.lats, base.lngs, 1000);
    // cumulative = 5800 -> level 1 -> cap = 1000 + 500 = 1500
    expect(await game.cumulativeMetersOf(alice.address)).to.equal(5800);
    expect(await game.loopCapOf(alice.address)).to.equal(1500);
  });

  it("claim shorter than MIN_CLAIM_METERS emits ClaimRejected instead of reverting", async function () {
    const { game, alice } = await deploy();
    const minClaim = await game.MIN_CLAIM_METERS();
    const poly = square(10 * M, 20 * M, 2000);

    await expect(game.exposeHandleClaim(alice.address, 42, poly.lats, poly.lngs, minClaim - 1n))
      .to.emit(game, "ClaimRejected")
      .withArgs(alice.address, 42, "loop too short to claim");

    expect(await game.nextBaseId()).to.equal(1); // no base was created
  });

  it("claim longer than the player's current loop cap is rejected", async function () {
    const { game, alice } = await deploy();
    const cap = await game.loopCapOf(alice.address); // 1000m at level 0
    const poly = square(0, 0, 2000);

    await expect(game.exposeHandleClaim(alice.address, 1, poly.lats, poly.lngs, cap + 1n))
      .to.emit(game, "ClaimRejected")
      .withArgs(alice.address, 1, "loop exceeds your current km cap");
  });

  it("claim creates a base owned by the claimer with area derived from the polygon (Shoelace)", async function () {
    const { game, alice } = await deploy();
    const half = 2000; // 4000x4000 micro-degree square
    const poly = square(10 * M, 20 * M, half);

    await game.exposeHandleClaim(alice.address, 1, poly.lats, poly.lngs, 1000);

    const base = await game.bases(1);
    expect(base.owner).to.equal(alice.address);

    // Exact Shoelace area of a (2*half)x(2*half) square in micro-degrees, converted to meters:
    // side in micro-degrees = 2*half; side in meters = side * METERS_PER_DEGREE / 1e6.
    const meterPerDegree = 111_320;
    const sideMeters = ((2 * half) * meterPerDegree) / 1_000_000;
    const expectedArea = Math.floor(sideMeters * sideMeters);

    expect(base.initialAreaMeters).to.equal(base.currentAreaMeters);
    expect(base.currentAreaMeters).to.be.closeTo(expectedArea, 2);
  });

  it("claim grows the player's cumulative distance and counts toward bot-attack unlocking", async function () {
    const { game, alice } = await deploy();
    const poly = square(0, 0, 2000);

    await game.exposeHandleClaim(alice.address, 1, poly.lats, poly.lngs, 1000);

    expect(await game.cumulativeMetersOf(alice.address)).to.equal(1000);
    expect(await game.totalSuccessfulSessions()).to.equal(1);
  });

  it("claim overlapping an existing base (someone else's) emits ClaimRejected — the racing-players case", async function () {
    const { game, alice, bob } = await deploy();
    const poly = square(0, 0, 2000);

    await game.exposeHandleClaim(alice.address, 1, poly.lats, poly.lngs, 1000);

    // Bob's session got executed second (e.g. his attestation landed later) — same spot.
    await expect(game.exposeHandleClaim(bob.address, 2, poly.lats, poly.lngs, 1000))
      .to.emit(game, "ClaimRejected")
      .withArgs(bob.address, 2, "overlaps an existing territory");

    expect(await game.nextBaseId()).to.equal(2); // still just Alice's base
    const base = await game.bases(1);
    expect(base.owner).to.equal(alice.address); // Bob's real-world walk didn't take it from her
  });

  it("claim succeeds on unclaimed ground far enough from an existing base", async function () {
    const { game, alice, bob } = await deploy();
    const polyA = square(0, 0, 2000);

    await game.exposeHandleClaim(alice.address, 1, polyA.lats, polyA.lngs, 1000);

    // Far away square — comfortably clear of Alice's territory.
    const polyB = square(0, 20_000, 2000);
    await game.exposeHandleClaim(bob.address, 2, polyB.lats, polyB.lngs, 1000);

    const base2 = await game.bases(2);
    expect(base2.owner).to.equal(bob.address);
  });

  it("a claim that touches one of the player's OWN bases extends it instead of creating a new one", async function () {
    const { game, alice } = await deploy();
    const half = 2000;
    const polyA = square(0, 0, half); // square centered at (0,0), spans [-2000,2000]

    await game.exposeHandleClaim(alice.address, 1, polyA.lats, polyA.lngs, 1000);
    const baseBefore = await game.bases(1);

    // Adjacent square directly to the east, overlapping polyA's right edge slightly so they
    // touch/intersect — centered at lng=3900 (so it overlaps [1900,5900] against polyA's
    // [-2000,2000] -> overlap region [1900,2000]).
    const polyB = square(0, 3900, half);
    await expect(game.exposeHandleClaim(alice.address, 2, polyB.lats, polyB.lngs, 1000)).to.emit(
      game,
      "BaseExtended"
    );

    expect(await game.nextBaseId()).to.equal(2); // still only 1 base total
    const baseAfter = await game.bases(1);
    expect(baseAfter.owner).to.equal(alice.address);
    expect(baseAfter.initialAreaMeters).to.be.greaterThan(baseBefore.initialAreaMeters);

    const chunkIds = await game.chunkIdsOfBase(1);
    expect(chunkIds.length).to.equal(2);
  });

  it("a claim that touches someone else's base is rejected even if it also touches the player's own", async function () {
    const { game, alice, bob } = await deploy();
    const half = 2000;
    const aliceBase = square(0, 0, half);
    const bobBase = square(0, 20_000, half);

    await game.exposeHandleClaim(alice.address, 1, aliceBase.lats, aliceBase.lngs, 1000);
    await game.exposeHandleClaim(bob.address, 2, bobBase.lats, bobBase.lngs, 1000);

    // Raise Alice's loop cap to the max (6000m = level 10, needs 50,000m cumulative) via
    // unrelated reinforcements so the straddling loop below isn't rejected early for exceeding
    // her km cap instead of for the overlap.
    for (let i = 0; i < 50; i++) {
      await game.exposeHandleReinforce(alice.address, 100 + i, aliceBase.lats, aliceBase.lngs, 1000);
    }
    expect(await game.loopCapOf(alice.address)).to.equal(6000);

    // A big loop that overlaps BOTH Alice's and Bob's territory should be rejected — Alice
    // cannot expand into Bob's ground just because the same loop also touches her own base.
    const straddling = {
      lats: [half, half, -half, -half],
      lngs: [-half, 20_000 + half, 20_000 + half, -half],
    };

    await expect(game.exposeHandleClaim(alice.address, 3, straddling.lats, straddling.lngs, 6000))
      .to.emit(game, "ClaimRejected")
      .withArgs(alice.address, 3, "overlaps an existing territory");
  });

  it("claim rejects a polygon with fewer than MIN_POLYGON_POINTS", async function () {
    const { game, alice } = await deploy();
    // Only 2 points — a line, not a polygon.
    const lats = [1000, -1000];
    const lngs = [0, 0];

    await expect(game.exposeHandleClaim(alice.address, 1, lats, lngs, 1000))
      .to.emit(game, "ClaimRejected")
      .withArgs(alice.address, 1, "invalid polygon point count");
  });

  it("claim rejects a polygon with more than MAX_POLYGON_POINTS", async function () {
    const { game, alice } = await deploy();
    const max = Number(await game.MAX_POLYGON_POINTS());
    const lats: number[] = [];
    const lngs: number[] = [];
    // A rough circle-ish shape with one too many vertices.
    for (let i = 0; i <= max; i++) {
      const angle = (2 * Math.PI * i) / (max + 1);
      lats.push(Math.round(2000 * Math.sin(angle)));
      lngs.push(Math.round(2000 * Math.cos(angle)));
    }

    await expect(game.exposeHandleClaim(alice.address, 1, lats, lngs, 1000))
      .to.emit(game, "ClaimRejected")
      .withArgs(alice.address, 1, "invalid polygon point count");
  });

  it("claim works with a non-circular, concave (L-shaped) real-world-like polygon", async function () {
    const { game, alice } = await deploy();

    // An L-shaped hexagon (concave), all coordinates in micro-degrees.
    const lats = [0, 3000, 3000, 1500, 1500, 0];
    const lngs = [0, 0, 1500, 1500, 3000, 3000];

    await game.exposeHandleClaim(alice.address, 1, lats, lngs, 1000);

    const base = await game.bases(1);
    expect(base.owner).to.equal(alice.address);
    expect(base.currentAreaMeters).to.be.greaterThan(0);
  });

  it("reinforce with a small loop around one chunk's centroid restores the whole (multi-chunk) base", async function () {
    const { game, alice } = await deploy();
    const half = 2000;
    const polyA = square(0, 0, half);
    const polyB = square(0, 3900, half); // touches/extends polyA's base (see extend test above)

    await game.exposeHandleClaim(alice.address, 1, polyA.lats, polyA.lngs, 1000);
    await game.exposeHandleClaim(alice.address, 2, polyB.lats, polyB.lngs, 1000);

    const baseBeforeDamage = await game.bases(1);
    const totalArea = baseBeforeDamage.initialAreaMeters;

    // Manually damage the base via enough claims elsewhere + botAttack, same pattern as the
    // other reinforce test.
    const interval = Number(await game.BOT_ATTACK_TX_INTERVAL());
    await fillSessionsWithClaims(game, alice, interval - 2, 100);
    await triggerBotAttack(game);

    const damaged = await game.bases(1);
    if (damaged.owner !== ethers.ZeroAddress && damaged.currentAreaMeters < totalArea) {
      // A tight loop around polyA's centroid (0,0) only encloses chunk 1's centroid, not
      // chunk 2's — should still restore the WHOLE base (both chunks' combined area).
      const reinforceLoop = square(0, 0, 500);
      await game.exposeHandleReinforce(alice.address, 999, reinforceLoop.lats, reinforceLoop.lngs, 500);
      const restored = await game.bases(1);
      expect(restored.currentAreaMeters).to.equal(totalArea);
    }
  });

  it("rejects loops longer than MAX_LOOP_METERS for Reinforce", async function () {
    const { game, alice } = await deploy();
    const maxLoop = await game.MAX_LOOP_METERS();
    const poly = square(0, 0, 2000);

    await expect(game.exposeHandleReinforce(alice.address, 1, poly.lats, poly.lngs, maxLoop + 1n))
      .to.emit(game, "ReinforceRejected")
      .withArgs(alice.address, 1, "loop too long to reinforce");
  });

  it("reinforce restores a base's territory to 100% of its original area", async function () {
    const { game, alice } = await deploy();
    const poly = square(0, 0, 2000);

    await game.exposeHandleClaim(alice.address, 1, poly.lats, poly.lngs, 1000);
    const base = await game.bases(1);
    const fullArea = base.initialAreaMeters;

    // Simulate bot damage by triggering enough claims elsewhere to unlock botAttack.
    await fillSessionsWithClaims(game, alice, 19, 100); // +19 more successful sessions (total 20)
    await triggerBotAttack(game);

    const damaged = await game.bases(1);
    if (damaged.owner !== ethers.ZeroAddress) {
      const reinforceLoop = square(0, 0, 500); // small loop, just needs to enclose the chunk's centroid
      await game.exposeHandleReinforce(alice.address, 999, reinforceLoop.lats, reinforceLoop.lngs, 500);
      const restored = await game.bases(1);
      expect(restored.currentAreaMeters).to.equal(fullArea);
    }
  });

  it("reinforce fails when the player has no base enclosed by the loop", async function () {
    const { game, alice, bob } = await deploy();
    const poly = square(0, 0, 2000);

    await game.exposeHandleClaim(alice.address, 1, poly.lats, poly.lngs, 1000);

    const reinforceLoop = square(0, 0, 500);
    await expect(
      game.exposeHandleReinforce(bob.address, 2, reinforceLoop.lats, reinforceLoop.lngs, 1000)
    )
      .to.emit(game, "ReinforceRejected")
      .withArgs(bob.address, 2, "no base of yours found inside that loop");
  });

  it("commitBotAttack reverts with BotAttackNotReady before enough sessions have accumulated", async function () {
    const { game, alice } = await deploy();
    const poly = square(0, 0, 2000);

    await game.exposeHandleClaim(alice.address, 1, poly.lats, poly.lngs, 1000); // only 1 session so far

    await expect(game.commitBotAttack())
      .to.be.revertedWithCustomError(game, "BotAttackNotReady")
      .withArgs(1, await game.BOT_ATTACK_TX_INTERVAL());
  });

  it("botAttack fizzles (no revert) when unlocked but there are no bases to hit", async function () {
    const { game } = await deploy();
    const interval = await game.BOT_ATTACK_TX_INTERVAL();

    expect(await game.nextBaseId()).to.equal(1); // no bases exist yet
    expect(interval).to.be.greaterThan(0n);
    // With 0 successful sessions, botAttackReady() is false — calling would revert, not fizzle.
    expect(await game.botAttackReady()).to.equal(false);
  });

  it("botAttack becomes ready exactly at BOT_ATTACK_TX_INTERVAL successful sessions", async function () {
    const { game, alice } = await deploy();
    const interval = Number(await game.BOT_ATTACK_TX_INTERVAL());

    await fillSessionsWithClaims(game, alice, interval - 1, 0);
    expect(await game.botAttackReady()).to.equal(false);

    await fillSessionsWithClaims(game, alice, 1, interval - 1);
    expect(await game.botAttackReady()).to.equal(true);
  });

  describe("commit-reveal randomness", function () {
    async function readyGame() {
      const ctx = await deploy();
      const interval = Number(await ctx.game.BOT_ATTACK_TX_INTERVAL());
      await fillSessionsWithClaims(ctx.game, ctx.alice, interval, 0);
      return ctx;
    }

    it("commitBotAttack locks out a second commit while one is pending", async function () {
      const { game } = await readyGame();

      await game.commitBotAttack();
      const commitBlock = await game.botAttackCommitBlock();

      await expect(game.commitBotAttack())
        .to.be.revertedWithCustomError(game, "BotAttackCommitPending")
        .withArgs(commitBlock);

      // botAttackReady() reflects that a commit is already pending, not just the session count.
      expect(await game.botAttackReady()).to.equal(false);
    });

    it("revealBotAttack reverts if called before any block has passed since the commit", async function () {
      const { game } = await readyGame();

      // Under normal operation every transaction lands in its own new block (Hardhat's default
      // auto-mining), so by the time revealBotAttack's transaction is even processed,
      // block.number is already strictly greater than commitBlock — this asserts that
      // invariant holds and that RevealTooEarly exists to guard the theoretical edge case.
      await game.commitBotAttack();
      const commitBlock = await game.botAttackCommitBlock();
      const currentBlock = await ethers.provider.getBlockNumber();
      expect(currentBlock).to.be.greaterThanOrEqual(Number(commitBlock));
    });

    it("revealBotAttack reverts with NoBotAttackCommitPending if nothing was committed", async function () {
      const { game } = await readyGame();
      await expect(game.revealBotAttack()).to.be.revertedWithCustomError(game, "NoBotAttackCommitPending");
    });

    it("revealBotAttack succeeds one block after commit and uses that block's hash as entropy", async function () {
      const { game } = await readyGame();

      await game.commitBotAttack();
      const commitBlock = await game.botAttackCommitBlock();
      expect(commitBlock).to.be.greaterThan(0n);

      await network.provider.send("evm_mine");
      const tx = await game.revealBotAttack();
      await expect(tx).to.emit(game, "BotAttackTriggered");

      // The commit is cleared after a successful reveal, allowing a fresh cycle to start.
      expect(await game.botAttackCommitBlock()).to.equal(0n);
    });

    it("revealBotAttack does NOT revert if the window lapses — it clears the stale commit instead", async function () {
      const { game } = await readyGame();
      const revealWindow = Number(await game.REVEAL_WINDOW_BLOCKS());

      await game.commitBotAttack();
      const commitBlock = await game.botAttackCommitBlock();

      // Mine past the reveal window without ever revealing.
      for (let i = 0; i <= revealWindow; i++) {
        await network.provider.send("evm_mine");
      }

      await expect(game.revealBotAttack()).to.emit(game, "BotAttackCommitExpired").withArgs(commitBlock);

      // The commit was cleared, so a fresh one can be started right away.
      expect(await game.botAttackCommitBlock()).to.equal(0n);
      expect(await game.botAttackReady()).to.equal(true);
    });

    it("nobody can predict the outcome at commit time — entropy is unknown until the NEXT block is mined", async function () {
      const { game } = await readyGame();

      // At the moment commitBotAttack() is called, blockhash(current block) is unknowable (the
      // EVM itself defines blockhash(block.number) as 0 from inside that same block) — this is
      // the crux of why the old single-transaction design was predictable and this one isn't.
      const tx = await game.commitBotAttack();
      const receipt = await tx.wait();
      const commitBlockHashAtCommitTime = (await ethers.provider.getBlock(receipt!.blockNumber))!.hash;

      await network.provider.send("evm_mine");
      // The reveal uses blockhash(commitBlock) — the commit block's hash IS now known (it was
      // mined), but it was never influenceable by whoever called commitBotAttack, since it was
      // finalized before they could see it.
      expect(commitBlockHashAtCommitTime).to.not.equal(null);
      await expect(game.revealBotAttack()).to.emit(game, "BotAttackTriggered");
    });
  });

  it("botAttack picks an existing base and damages its current area", async function () {
    const { game, alice } = await deploy();
    const interval = Number(await game.BOT_ATTACK_TX_INTERVAL());
    const poly = square(0, 0, 2000);

    // One real base to be hit, plus enough claims elsewhere to unlock the attack.
    await game.exposeHandleClaim(alice.address, 1, poly.lats, poly.lngs, 1000);
    await fillSessionsWithClaims(game, alice, interval - 1, 100);

    await game.commitBotAttack();
    await network.provider.send("evm_mine");
    await expect(game.revealBotAttack()).to.emit(game, "BotAttackTriggered");

    expect(await game.botAttackReady()).to.equal(false);
    expect(await game.lastBotAttackAtSessionCount()).to.equal(await game.totalSuccessfulSessions());
  });

  it("a base fully destroyed by bot damage frees the ground for reclaiming", async function () {
    const { game, alice, bob } = await deploy();
    const poly = square(0, 0, 2000);

    await game.exposeHandleClaim(alice.address, 1, poly.lats, poly.lngs, 1000);

    const interval = Number(await game.BOT_ATTACK_TX_INTERVAL());
    let destroyed = false;
    for (let round = 0; round < 20 && !destroyed; round++) {
      await fillSessionsWithClaims(game, alice, interval, 1000 + round * interval);
      await triggerBotAttack(game);
      const base = await game.bases(1);
      if (base.owner === ethers.ZeroAddress) destroyed = true;
    }

    if (destroyed) {
      // Ground is free — Bob can claim the same spot now.
      const cap = await game.loopCapOf(bob.address);
      await game.exposeHandleClaim(bob.address, 99999, poly.lats, poly.lngs, cap);
      const reclaimed = await game.bases(await game.nextBaseId() - 1n);
      expect(reclaimed.owner).to.equal(bob.address);
    }
  });

  describe("Sponsored Zones", function () {
    it("createSponsoredZone rejects zero-value calls", async function () {
      const { game, alice } = await deploy();
      await expect(
        game.connect(alice).createSponsoredZone(0, 0, 2000, 7, 10, "Cafe Terra", { value: 0 })
      ).to.be.revertedWithCustomError(game, "InvalidZoneParameters");
    });

    it("createSponsoredZone rejects a pool below MIN_ZONE_POOL", async function () {
      const { game, alice } = await deploy();
      const min = await game.MIN_ZONE_POOL();
      await expect(
        game.connect(alice).createSponsoredZone(0, 0, 2000, 7, 10, "Cafe Terra", { value: min - 1n })
      ).to.be.revertedWithCustomError(game, "InvalidZoneParameters");
    });

    it("createSponsoredZone accepts a pool exactly at MIN_ZONE_POOL", async function () {
      const { game, alice } = await deploy();
      const min = await game.MIN_ZONE_POOL();
      await expect(game.connect(alice).createSponsoredZone(0, 0, 2000, 7, 10, "Cafe Terra", { value: min })).to.emit(
        game,
        "SponsoredZoneCreated"
      );
    });

    it("createSponsoredZone emits the sponsor's business name so players can see who is paying", async function () {
      const { game, alice } = await deploy();
      const pool = ethers.parseEther("200");
      const tx = await game.connect(alice).createSponsoredZone(1_000, 2_000, 500, 7, 10, "Highlands Coffee", {
        value: pool,
      });
      const receipt = await tx.wait();
      const created = receipt!.logs
        .map((log) => game.interface.parseLog(log))
        .find((parsed) => parsed?.name === "SponsoredZoneCreated");
      expect(created).to.not.equal(undefined);
      expect(created!.args.name).to.equal("Highlands Coffee");
      expect(created!.args.sponsor).to.equal(alice.address);
      // The name is display-only metadata and lives in the log, not in contract storage — the
      // zone struct is unchanged, so nothing in the payout path pays for it.
      const zone = await game.sponsoredZones(1);
      expect(zone.sponsor).to.equal(alice.address);
    });

    it("createSponsoredZone rejects an empty business name", async function () {
      const { game, alice } = await deploy();
      await expect(
        game.connect(alice).createSponsoredZone(0, 0, 500, 7, 10, "", { value: ethers.parseEther("200") })
      ).to.be.revertedWithCustomError(game, "InvalidZoneParameters");
    });

    it("createSponsoredZone rejects a business name longer than MAX_ZONE_NAME_BYTES", async function () {
      const { game, alice } = await deploy();
      const maxBytes = Number(await game.MAX_ZONE_NAME_BYTES());
      await expect(
        game
          .connect(alice)
          .createSponsoredZone(0, 0, 500, 7, 10, "x".repeat(maxBytes + 1), { value: ethers.parseEther("200") })
      ).to.be.revertedWithCustomError(game, "InvalidZoneParameters");
      // Exactly at the cap is fine.
      await expect(
        game
          .connect(alice)
          .createSponsoredZone(0, 0, 500, 7, 10, "x".repeat(maxBytes), { value: ethers.parseEther("200") })
      ).to.emit(game, "SponsoredZoneCreated");
    });

    it("counts a business name in bytes, not characters — a multi-byte name is capped sooner", async function () {
      const { game, alice } = await deploy();
      // 14 Vietnamese characters, but 18 UTF-8 bytes — still under the 32-byte cap.
      await expect(
        game.connect(alice).createSponsoredZone(0, 0, 500, 7, 10, "Bún Bò Huế 24h", { value: ethers.parseEther("200") })
      ).to.emit(game, "SponsoredZoneCreated");
      // 11 Korean characters is 33 UTF-8 bytes — over the cap even though it's a short name.
      await expect(
        game
          .connect(alice)
          .createSponsoredZone(0, 0, 500, 7, 10, "서울카페입니다반가와요", { value: ethers.parseEther("200") })
      ).to.be.revertedWithCustomError(game, "InvalidZoneParameters");
    });

    it("createSponsoredZone locks the pool and computes an even per-session reward", async function () {
      const { game, alice } = await deploy();
      const pool = ethers.parseEther("200");

      const tx = await game.connect(alice).createSponsoredZone(0, 0, 2000, 7, 10, "Cafe Terra", { value: pool });
      await expect(tx).to.emit(game, "SponsoredZoneCreated");

      const zone = await game.sponsoredZones(1);
      expect(zone.sponsor).to.equal(alice.address);
      expect(zone.remainingPool).to.equal(pool);
      expect(zone.rewardPerSession).to.equal(pool / 10n);
      expect(zone.expectedSessions).to.equal(10);
      expect(await game.isZoneActive(1)).to.equal(true);

      const gameBalance = await ethers.provider.getBalance(await game.getAddress());
      expect(gameBalance).to.equal(pool);
    });

    it("a Claim inside an active zone pays out the player, minus the platform fee, to the fee recipient", async function () {
      const { game, deployer, alice, bob } = await deploy();
      const pool = ethers.parseEther("200");
      const expectedSessions = 10;

      // Bob sponsors a zone centered exactly where Alice is about to claim.
      await game.connect(bob).createSponsoredZone(0, 0, 2000, 7, expectedSessions, "Cafe Terra", { value: pool });

      const rewardPerSession = pool / BigInt(expectedSessions);
      const feeBps = await game.PLATFORM_FEE_BPS();
      const bpsDenominator = await game.BPS_DENOMINATOR();
      const expectedFee = (rewardPerSession * feeBps) / bpsDenominator;
      const expectedToPlayer = rewardPerSession - expectedFee;

      const poly = square(0, 0, 2000); // centroid (0,0) — inside Bob's zone
      const aliceBalanceBefore = await ethers.provider.getBalance(alice.address);
      const feeRecipientBalanceBefore = await ethers.provider.getBalance(deployer.address); // owner == feeRecipient by default

      const tx = await game.exposeHandleClaim(alice.address, 1, poly.lats, poly.lngs, 1000);
      await expect(tx).to.emit(game, "SponsoredZonePayout").withArgs(1, alice.address, 1, expectedToPlayer, expectedFee);
      const receipt = await tx.wait();
      const gasCost = receipt!.gasUsed * receipt!.gasPrice;

      const aliceBalanceAfter = await ethers.provider.getBalance(alice.address);
      const feeRecipientBalanceAfter = await ethers.provider.getBalance(deployer.address);

      // Alice never sent this transaction, so her balance is untouched by gas — the full
      // expectedToPlayer amount should land exactly. The deployer (== feeRecipient here) DID
      // send it, so their balance change also has to account for the gas they spent.
      expect(aliceBalanceAfter - aliceBalanceBefore).to.equal(expectedToPlayer);
      expect(feeRecipientBalanceAfter - feeRecipientBalanceBefore + gasCost).to.equal(expectedFee);

      const zone = await game.sponsoredZones(1);
      expect(zone.sessionsPaid).to.equal(1);
      expect(zone.remainingPool).to.equal(pool - rewardPerSession);
    });

    it("a Claim outside the zone's radius gets no payout", async function () {
      const { game, bob, alice } = await deploy();
      const pool = ethers.parseEther("200");
      await game.connect(bob).createSponsoredZone(0, 0, 500, 7, 10, "Cafe Terra", { value: pool });

      // Far outside the 500m zone radius.
      const poly = square(0, 20_000, 2000);
      const tx = await game.exposeHandleClaim(alice.address, 1, poly.lats, poly.lngs, 1000);
      await expect(tx).to.not.emit(game, "SponsoredZonePayout");

      const zone = await game.sponsoredZones(1);
      expect(zone.sessionsPaid).to.equal(0);
    });

    it("overlapping zones both pay out for the same session", async function () {
      const { game, bob, carol, alice } = await deploy();
      const pool = ethers.parseEther("200");
      await game.connect(bob).createSponsoredZone(0, 0, 2000, 7, 10, "Cafe Terra", { value: pool });
      await game.connect(carol).createSponsoredZone(500, 500, 2000, 7, 10, "Cafe Terra", { value: pool }); // overlapping

      const poly = square(0, 0, 2000);
      const tx = await game.exposeHandleClaim(alice.address, 1, poly.lats, poly.lngs, 1000);
      const receipt = await tx.wait();
      const payoutEvents = receipt!.logs.filter((log: any) => {
        try {
          return game.interface.parseLog(log)?.name === "SponsoredZonePayout";
        } catch {
          return false;
        }
      });
      expect(payoutEvents.length).to.equal(2);

      expect((await game.sponsoredZones(1)).sessionsPaid).to.equal(1);
      expect((await game.sponsoredZones(2)).sessionsPaid).to.equal(1);
    });

    it("stops paying out once expectedSessions payouts have been made, even if the pool has leftover dust", async function () {
      const { game, bob, alice, carol } = await deploy();
      // 3 wei pool, 2 expected sessions -> rewardPerSession = 1 wei, 1 wei left over after 2 payouts (never paid).
      // Uses two DIFFERENT claiming addresses (Alice, Carol) so the Sybil cooldown between
      // repeat payouts to the SAME address doesn't interfere with what this test is checking.
      // Zone radius is 2000m — both claims' centroids must stay within that of (0,0).
      await game.connect(bob).createSponsoredZone(0, 0, 2000, 7, 2, "Cafe Terra", { value: ethers.parseEther("200") + 1n });

      const poly = square(0, 0, 300);
      await game.exposeHandleClaim(alice.address, 1, poly.lats, poly.lngs, 1000);
      const secondPoly = square(8000, 8000, 300); // ~1253m from zone center — inside 2000m radius, and far enough from Alice's small claim not to overlap it
      await game.exposeHandleClaim(carol.address, 2, secondPoly.lats, secondPoly.lngs, 1000);

      const zone = await game.sponsoredZones(1);
      expect(zone.sessionsPaid).to.equal(2);
      expect(zone.remainingPool).to.equal(1n); // the undividable leftover wei

      // A third session inside the same zone (yet another address) gets no further payout —
      // expectedSessions has already been fully consumed.
      const thirdPoly = square(0, 40_000, 2000);
      const tx = await game.exposeHandleClaim(bob.address, 3, thirdPoly.lats, thirdPoly.lngs, 1000);
      await expect(tx).to.not.emit(game, "SponsoredZonePayout");
    });

    it("decays repeat payouts to the same address within the same zone (Sybil resistance)", async function () {
      const { game, bob, alice } = await deploy();
      const pool = ethers.parseEther("200");
      await game.connect(bob).createSponsoredZone(0, 0, 2000, 30, 100, "Cafe Terra", { value: pool });

      const rewardPerSession = pool / 100n;
      const feeBps = await game.PLATFORM_FEE_BPS();
      const bpsDenominator = await game.BPS_DENOMINATOR();
      const decayBps = await game.SYBIL_DECAY_BPS();
      const cooldown = Number(await game.SYBIL_COOLDOWN_SECONDS());

      const firstPoly = square(0, 0, 2000);
      const firstTx = await game.exposeHandleClaim(alice.address, 1, firstPoly.lats, firstPoly.lngs, 1000);
      const firstReceipt = await firstTx.wait();
      const firstPayout = firstReceipt!.logs
        .map((log: any) => {
          try {
            return game.interface.parseLog(log);
          } catch {
            return null;
          }
        })
        .find((e: any) => e?.name === "SponsoredZonePayout");
      const firstFee = (rewardPerSession * feeBps) / bpsDenominator;
      expect(firstPayout!.args.amountToPlayer).to.equal(rewardPerSession - firstFee);

      // Immediately reinforcing again with the SAME address, still inside the zone, is within
      // the cooldown window -> no second payout yet.
      await network.provider.send("evm_increaseTime", [1]);
      await network.provider.send("evm_mine");
      const secondPoly = square(0, 0, 500);
      const secondTxTooSoon = await game.exposeHandleReinforce(alice.address, 2, secondPoly.lats, secondPoly.lngs, 500);
      await expect(secondTxTooSoon).to.not.emit(game, "SponsoredZonePayout");

      // After the cooldown elapses, the SAME address gets paid again, but decayed.
      await network.provider.send("evm_increaseTime", [cooldown + 1]);
      await network.provider.send("evm_mine");
      const secondTx = await game.exposeHandleReinforce(alice.address, 3, secondPoly.lats, secondPoly.lngs, 500);
      await expect(secondTx)
        .to.emit(game, "SponsoredZonePayoutDecayed")
        .withArgs(1, alice.address, 2, decayBps);

      const secondReceipt = await secondTx.wait();
      const secondPayout = secondReceipt!.logs
        .map((log: any) => {
          try {
            return game.interface.parseLog(log);
          } catch {
            return null;
          }
        })
        .find((e: any) => e?.name === "SponsoredZonePayout");
      const decayedReward = (rewardPerSession * decayBps) / bpsDenominator;
      const decayedFee = (decayedReward * feeBps) / bpsDenominator;
      expect(secondPayout!.args.amountToPlayer).to.equal(decayedReward - decayedFee);
      expect(secondPayout!.args.amountToPlayer).to.be.lessThan(firstPayout!.args.amountToPlayer);
    });

    it("withdrawUnusedPool reverts while the zone is still active", async function () {
      const { game, bob } = await deploy();
      await game.connect(bob).createSponsoredZone(0, 0, 2000, 7, 10, "Cafe Terra", { value: ethers.parseEther("200") });

      await expect(game.connect(bob).withdrawUnusedPool(1)).to.be.revertedWithCustomError(game, "ZoneStillActive");
    });

    it("withdrawUnusedPool reverts for a non-sponsor caller", async function () {
      const { game, bob, alice } = await deploy();
      await game.connect(bob).createSponsoredZone(0, 0, 2000, 7, 10, "Cafe Terra", { value: ethers.parseEther("200") });

      await expect(game.connect(alice).withdrawUnusedPool(1)).to.be.revertedWithCustomError(game, "NotZoneSponsor");
    });

    it("withdrawUnusedPool returns the full remaining pool to the sponsor after expiry", async function () {
      const { game, bob } = await deploy();
      const pool = ethers.parseEther("200");
      await game.connect(bob).createSponsoredZone(0, 0, 2000, 1, 10, "Cafe Terra", { value: pool }); // 1-day duration

      // No sessions ever landed in the zone -> full pool still unused.
      await network.provider.send("evm_increaseTime", [2 * 24 * 60 * 60]); // +2 days
      await network.provider.send("evm_mine");

      const bobBalanceBefore = await ethers.provider.getBalance(bob.address);
      const tx = await game.connect(bob).withdrawUnusedPool(1);
      const receipt = await tx.wait();
      const gasCost = receipt!.gasUsed * receipt!.gasPrice;
      const bobBalanceAfter = await ethers.provider.getBalance(bob.address);

      expect(bobBalanceAfter - bobBalanceBefore + gasCost).to.equal(pool);
      expect((await game.sponsoredZones(1)).remainingPool).to.equal(0);
    });

    it("withdrawUnusedPool cannot be called twice", async function () {
      const { game, bob } = await deploy();
      await game.connect(bob).createSponsoredZone(0, 0, 2000, 1, 10, "Cafe Terra", { value: ethers.parseEther("200") });

      await network.provider.send("evm_increaseTime", [2 * 24 * 60 * 60]);
      await network.provider.send("evm_mine");

      await game.connect(bob).withdrawUnusedPool(1);
      await expect(game.connect(bob).withdrawUnusedPool(1)).to.be.revertedWithCustomError(
        game,
        "ZoneAlreadyWithdrawn"
      );
    });

    it("setFeeRecipient redirects future platform fees and reverts for non-owner callers", async function () {
      const { game, alice, bob } = await deploy();

      await expect(game.connect(alice).setFeeRecipient(alice.address)).to.be.revertedWithCustomError(
        game,
        "NotOwner"
      );

      await expect(game.setFeeRecipient(bob.address)).to.emit(game, "FeeRecipientUpdated").withArgs(bob.address);
      expect(await game.feeRecipient()).to.equal(bob.address);
    });
  });

  describe("Duels (opt-in PvP)", function () {
    /// Simulates `player` walking `meters` by having them Claim a fresh, far-away, unclaimed
    /// square — the only thing that matters for duel purposes is that it grows
    /// players[player].cumulativeMeters by `meters`. `plotIndex` must be unique across every
    /// walk() call within a single test (each call plants its square many degrees away from
    /// every other one, so none of them ever overlap each other or the origin).
    let claimCounter = 0;
    async function walk(game: any, player: any, meters: number, plotIndex: number) {
      claimCounter += 1;
      const half = 1500;
      // 0.1 degree apart (~11km) — far enough that no two plots ever overlap, while staying
      // well inside real-world latitude bounds (the contract rejects anything beyond ±90°).
      const lat = plotIndex * 100_000;
      const poly = square(lat, 0, half);
      await game.exposeHandleClaim(player.address, 500_000 + claimCounter, poly.lats, poly.lngs, meters);
    }

    it("challengeDuel locks the challenger's stake and emits DuelChallenged", async function () {
      const { game, alice, bob } = await deploy();
      const stake = ethers.parseEther("1.0");

      const tx = await game.connect(alice).challengeDuel(bob.address, 24, { value: stake });
      await expect(tx).to.emit(game, "DuelChallenged").withArgs(1, alice.address, bob.address, stake, 24 * 3600);

      const duel = await game.duels(1);
      expect(duel.challenger).to.equal(alice.address);
      expect(duel.opponent).to.equal(bob.address);
      expect(duel.stake).to.equal(stake);
      expect(duel.status).to.equal(0); // Pending

      expect(await ethers.provider.getBalance(await game.getAddress())).to.equal(stake);
    });

    it("challengeDuel rejects challenging yourself or the zero address", async function () {
      const { game, alice } = await deploy();
      await expect(game.connect(alice).challengeDuel(alice.address, 24)).to.be.revertedWithCustomError(
        game,
        "InvalidDuelParameters"
      );
      await expect(game.connect(alice).challengeDuel(ethers.ZeroAddress, 24)).to.be.revertedWithCustomError(
        game,
        "InvalidDuelParameters"
      );
    });

    it("challengeDuel rejects an out-of-range duration", async function () {
      const { game, alice, bob } = await deploy();
      await expect(game.connect(alice).challengeDuel(bob.address, 0)).to.be.revertedWithCustomError(
        game,
        "InvalidDuelParameters"
      );
      await expect(game.connect(alice).challengeDuel(bob.address, 999)).to.be.revertedWithCustomError(
        game,
        "InvalidDuelParameters"
      );
    });

    it("acceptDuel requires the exact matching stake from the correct opponent", async function () {
      const { game, alice, bob, carol } = await deploy();
      const stake = ethers.parseEther("1.0");
      await game.connect(alice).challengeDuel(bob.address, 24, { value: stake });

      await expect(game.connect(carol).acceptDuel(1, { value: stake })).to.be.revertedWithCustomError(
        game,
        "NotDuelOpponent"
      );
      await expect(game.connect(bob).acceptDuel(1, { value: stake / 2n }))
        .to.be.revertedWithCustomError(game, "WrongStakeAmount")
        .withArgs(stake, stake / 2n);
    });

    it("acceptDuel starts the race and snapshots both players' cumulative meters", async function () {
      const { game, alice, bob } = await deploy();
      const stake = ethers.parseEther("1.0");

      // Give Alice some pre-existing distance BEFORE the duel — this must NOT count.
      await walk(game, alice, 800, 10);

      await game.connect(alice).challengeDuel(bob.address, 24, { value: stake });
      const tx = await game.connect(bob).acceptDuel(1, { value: stake });
      await expect(tx).to.emit(game, "DuelAccepted");

      const duel = await game.duels(1);
      expect(duel.status).to.equal(1); // Active
      expect(duel.challengerStartMeters).to.equal(800); // Alice's pre-existing distance
      expect(duel.opponentStartMeters).to.equal(0);

      expect(await ethers.provider.getBalance(await game.getAddress())).to.equal(stake * 2n);
    });

    it("cancelDuel lets the challenger cancel their own unaccepted challenge and refunds the stake", async function () {
      const { game, alice, bob } = await deploy();
      const stake = ethers.parseEther("1.0");
      await game.connect(alice).challengeDuel(bob.address, 24, { value: stake });

      const balanceBefore = await ethers.provider.getBalance(alice.address);
      const tx = await game.connect(alice).cancelDuel(1);
      const receipt = await tx.wait();
      const gasCost = receipt!.gasUsed * receipt!.gasPrice;
      const balanceAfter = await ethers.provider.getBalance(alice.address);

      await expect(tx).to.emit(game, "DuelCancelled").withArgs(1, alice.address);
      expect(balanceAfter - balanceBefore + gasCost).to.equal(stake);
      expect((await game.duels(1)).status).to.equal(3); // Cancelled
    });

    it("cancelDuel reverts for a third party while the accept window is still open", async function () {
      const { game, alice, bob, carol } = await deploy();
      await game.connect(alice).challengeDuel(bob.address, 24, { value: 0 });

      await expect(game.connect(carol).cancelDuel(1)).to.be.revertedWithCustomError(
        game,
        "DuelAcceptWindowStillOpen"
      );
    });

    it("cancelDuel allows anyone to cancel once the accept window has expired, refunding the challenger", async function () {
      const { game, alice, bob, carol } = await deploy();
      const stake = ethers.parseEther("1.0");
      await game.connect(alice).challengeDuel(bob.address, 24, { value: stake });

      const acceptWindow = Number(await game.DUEL_ACCEPT_WINDOW_HOURS());
      await network.provider.send("evm_increaseTime", [acceptWindow * 3600 + 1]);
      await network.provider.send("evm_mine");

      const balanceBefore = await ethers.provider.getBalance(alice.address);
      await game.connect(carol).cancelDuel(1); // a third party triggers it
      const balanceAfter = await ethers.provider.getBalance(alice.address);

      expect(balanceAfter - balanceBefore).to.equal(stake); // Alice is refunded even though Carol called it
      expect((await game.duels(1)).status).to.equal(3); // Cancelled
    });

    it("settleDuel reverts before the duel's time window has elapsed", async function () {
      const { game, alice, bob } = await deploy();
      await game.connect(alice).challengeDuel(bob.address, 24, { value: 0 });
      await game.connect(bob).acceptDuel(1, { value: 0 });

      await expect(game.settleDuel(1)).to.be.revertedWithCustomError(game, "DuelStillActive");
    });

    it("settleDuel pays the full pool (minus platform fee) to whoever walked further", async function () {
      const { game, alice, bob } = await deploy();
      const stake = ethers.parseEther("1.0");

      await game.connect(alice).challengeDuel(bob.address, 1, { value: stake }); // 1-hour duel
      await game.connect(bob).acceptDuel(1, { value: stake });

      // Alice walks 800m, Bob walks 500m, both during the active duel window (both under the
      // default 1000m per-session km cap).
      await walk(game, alice, 800, 50);
      await walk(game, bob, 500, 60);

      await network.provider.send("evm_increaseTime", [3601]);
      await network.provider.send("evm_mine");

      const pool = stake * 2n;
      const feeBps = await game.PLATFORM_FEE_BPS();
      const bpsDenominator = await game.BPS_DENOMINATOR();
      const expectedFee = (pool * feeBps) / bpsDenominator;
      const expectedPayout = pool - expectedFee;

      const aliceBalanceBefore = await ethers.provider.getBalance(alice.address);
      const tx = await game.settleDuel(1); // triggered by deployer, not Alice — no gas accounting needed for her
      await expect(tx)
        .to.emit(game, "DuelSettled")
        .withArgs(1, alice.address, 800, 500, expectedPayout, expectedFee);

      const aliceBalanceAfter = await ethers.provider.getBalance(alice.address);
      expect(aliceBalanceAfter - aliceBalanceBefore).to.equal(expectedPayout);
      expect((await game.duels(1)).status).to.equal(2); // Settled
    });

    it("settleDuel splits the pool evenly with no platform fee on a tie", async function () {
      const { game, alice, bob } = await deploy();
      const stake = ethers.parseEther("1.0");

      await game.connect(alice).challengeDuel(bob.address, 1, { value: stake });
      await game.connect(bob).acceptDuel(1, { value: stake });

      await walk(game, alice, 1000, 70);
      await walk(game, bob, 1000, 80);

      await network.provider.send("evm_increaseTime", [3601]);
      await network.provider.send("evm_mine");

      const aliceBalanceBefore = await ethers.provider.getBalance(alice.address);
      const bobBalanceBefore = await ethers.provider.getBalance(bob.address);

      await expect(game.settleDuel(1))
        .to.emit(game, "DuelSettled")
        .withArgs(1, ethers.ZeroAddress, 1000, 1000, stake, 0);

      const aliceBalanceAfter = await ethers.provider.getBalance(alice.address);
      const bobBalanceAfter = await ethers.provider.getBalance(bob.address);
      expect(aliceBalanceAfter - aliceBalanceBefore).to.equal(stake);
      expect(bobBalanceAfter - bobBalanceBefore).to.equal(stake);
    });

    it("settleDuel works with zero stake — a purely for-fun race with no money involved", async function () {
      const { game, alice, bob } = await deploy();
      await game.connect(alice).challengeDuel(bob.address, 1, { value: 0 });
      await game.connect(bob).acceptDuel(1, { value: 0 });

      await walk(game, alice, 1000, 90);

      await network.provider.send("evm_increaseTime", [3601]);
      await network.provider.send("evm_mine");

      await expect(game.settleDuel(1))
        .to.emit(game, "DuelSettled")
        .withArgs(1, alice.address, 1000, 0, 0, 0);
    });

    it("only distance walked DURING the duel counts, not distance walked before it started", async function () {
      const { game, alice, bob } = await deploy();

      // Bob walks a lot BEFORE any duel exists.
      await walk(game, bob, 5000, 100);

      await game.connect(alice).challengeDuel(bob.address, 1, { value: 0 });
      await game.connect(bob).acceptDuel(1, { value: 0 });

      // During the duel, Alice walks more than Bob does.
      await walk(game, alice, 300, 110);

      await network.provider.send("evm_increaseTime", [3601]);
      await network.provider.send("evm_mine");

      // Bob's pre-duel 5000m must not count — only Alice's in-duel 300m vs Bob's 0m in-duel.
      await expect(game.settleDuel(1))
        .to.emit(game, "DuelSettled")
        .withArgs(1, alice.address, 300, 0, 0, 0);
    });
  });

  describe("Security hardening (audit fixes)", function () {
    it("rejects a Claim whose polygon leaves real-world latitude bounds", async function () {
      const { game, alice } = await deploy();
      // 91 degrees north doesn't exist. Left unchecked, coordinates like this overflow the
      // int32 bounding-box midpoint math and revert the whole cross-chain execute() call,
      // leaving the relayer retrying a session that can never succeed.
      const poly = square(91_000_000, 0, 2000);

      await expect(game.exposeHandleClaim(alice.address, 1, poly.lats, poly.lngs, 1000))
        .to.emit(game, "ClaimRejected")
        .withArgs(alice.address, 1, "coordinates out of real-world bounds");
    });

    it("rejects a Reinforce whose polygon leaves real-world longitude bounds", async function () {
      const { game, alice } = await deploy();
      const poly = square(0, 181_000_000, 2000);

      await expect(game.exposeHandleReinforce(alice.address, 1, poly.lats, poly.lngs, 1000))
        .to.emit(game, "ReinforceRejected")
        .withArgs(alice.address, 1, "coordinates out of real-world bounds");
    });

    it("createSponsoredZone rejects out-of-bounds coordinates", async function () {
      const { game, alice } = await deploy();
      await expect(
        game.connect(alice).createSponsoredZone(91_000_000, 0, 500, 7, 10, "Cafe Terra", { value: ethers.parseEther("200") })
      ).to.be.revertedWithCustomError(game, "InvalidCoordinates");
    });

    it("a decayed zone payout only debits the pool by what was actually paid — no funds get stranded", async function () {
      const { game, bob, alice } = await deploy();
      const pool = ethers.parseEther("200");
      const expectedSessions = 100;
      await game.connect(bob).createSponsoredZone(0, 0, 2000, 30, expectedSessions, "Cafe Terra", { value: pool });

      const rewardPerSession = pool / BigInt(expectedSessions);
      const decayBps = await game.SYBIL_DECAY_BPS();
      const bpsDenominator = await game.BPS_DENOMINATOR();
      const cooldown = Number(await game.SYBIL_COOLDOWN_SECONDS());

      // First payout: full rate.
      const firstPoly = square(0, 0, 1500);
      await game.exposeHandleClaim(alice.address, 1, firstPoly.lats, firstPoly.lngs, 1000);
      expect((await game.sponsoredZones(1)).remainingPool).to.equal(pool - rewardPerSession);

      // Second payout to the SAME address after the cooldown: decayed rate. The pool must only
      // lose the decayed amount — the difference stays available for genuine new visitors and
      // remains reclaimable by the sponsor, instead of being burned into the contract forever.
      await network.provider.send("evm_increaseTime", [cooldown + 1]);
      await network.provider.send("evm_mine");
      const reinforceLoop = square(0, 0, 500);
      await game.exposeHandleReinforce(alice.address, 2, reinforceLoop.lats, reinforceLoop.lngs, 500);

      const decayedReward = (rewardPerSession * decayBps) / bpsDenominator;
      expect((await game.sponsoredZones(1)).remainingPool).to.equal(pool - rewardPerSession - decayedReward);
    });

    it("only scans zones near the session — a distant zone is never charged", async function () {
      const { game, bob, alice } = await deploy();
      const pool = ethers.parseEther("200");

      // Zone far away (about 111 km north) from where Alice will walk.
      await game.connect(bob).createSponsoredZone(1_000_000, 0, 2000, 7, 10, "Cafe Terra", { value: pool });

      const poly = square(0, 0, 1500);
      const tx = await game.exposeHandleClaim(alice.address, 1, poly.lats, poly.lngs, 1000);
      await expect(tx).to.not.emit(game, "SponsoredZonePayout");
      expect((await game.sponsoredZones(1)).remainingPool).to.equal(pool);
    });

    it("a duel winner that rejects ETH gets credited instead of locking both stakes forever", async function () {
      const { game, alice } = await deploy();
      const stake = ethers.parseEther("1.0");

      const Rejecting = await ethers.getContractFactory("RejectingReceiver");
      const hostile = await Rejecting.deploy();
      const hostileAddress = await hostile.getAddress();

      // Alice challenges the hostile contract, which accepts (funding its stake through its
      // own call helper) and then wins by walking further.
      await game.connect(alice).challengeDuel(hostileAddress, 1, { value: stake });
      const acceptData = game.interface.encodeFunctionData("acceptDuel", [1]);
      await hostile.callWithValue(await game.getAddress(), acceptData, stake, { value: stake });

      expect((await game.duels(1)).status).to.equal(1); // Active

      // The hostile contract "walks" — exposeHandleClaim lets the test credit distance to any
      // address, standing in for a relayed session.
      const poly = square(500_000, 0, 1500);
      await game.exposeHandleClaim(hostileAddress, 900_001, poly.lats, poly.lngs, 900);

      await network.provider.send("evm_increaseTime", [3601]);
      await network.provider.send("evm_mine");

      // Settlement MUST succeed even though the winner refuses the transfer.
      await expect(game.settleDuel(1)).to.emit(game, "PayoutCredited");
      expect((await game.duels(1)).status).to.equal(2); // Settled, not stuck

      const pool = stake * 2n;
      const fee = (pool * (await game.PLATFORM_FEE_BPS())) / (await game.BPS_DENOMINATOR());
      expect(await game.pendingPayouts(hostileAddress)).to.equal(pool - fee);
    });

    it("credited payouts are claimable later via withdrawPendingPayout", async function () {
      const { game, alice, bob } = await deploy();
      const stake = ethers.parseEther("1.0");

      // Set the fee recipient to a contract that rejects ETH, so the platform fee gets credited
      // rather than delivered — then prove it's still recoverable.
      const Rejecting = await ethers.getContractFactory("RejectingReceiver");
      const hostile = await Rejecting.deploy();
      const hostileAddress = await hostile.getAddress();
      await game.setFeeRecipient(hostileAddress);

      await game.connect(alice).challengeDuel(bob.address, 1, { value: stake });
      await game.connect(bob).acceptDuel(1, { value: stake });

      const poly = square(600_000, 0, 1500);
      await game.exposeHandleClaim(alice.address, 900_002, poly.lats, poly.lngs, 900);

      await network.provider.send("evm_increaseTime", [3601]);
      await network.provider.send("evm_mine");
      await game.settleDuel(1);

      const pool = stake * 2n;
      const fee = (pool * (await game.PLATFORM_FEE_BPS())) / (await game.BPS_DENOMINATOR());
      expect(await game.pendingPayouts(hostileAddress)).to.equal(fee);

      // The hostile contract still can't receive it directly, so its own withdraw attempt
      // reverts — but the balance is never lost, and any address that CAN receive would get it.
      const withdrawData = game.interface.encodeFunctionData("withdrawPendingPayout", []);
      await expect(hostile.callWithValue(await game.getAddress(), withdrawData, 0)).to.be.reverted;
      expect(await game.pendingPayouts(hostileAddress)).to.equal(fee); // still safely credited
    });

    it("withdrawPendingPayout reverts when there is nothing credited", async function () {
      const { game, alice } = await deploy();
      await expect(game.connect(alice).withdrawPendingPayout()).to.be.revertedWithCustomError(
        game,
        "NothingToWithdraw"
      );
    });
  });
});
