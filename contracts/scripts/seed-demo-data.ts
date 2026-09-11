import { ethers } from "hardhat";
import { HDNodeWallet, Mnemonic, JsonRpcProvider, Wallet, formatEther, parseEther, Contract } from "ethers";
import * as fs from "fs";
import * as path from "path";
import { loadAddresses } from "./addresses";

/**
 * Seeds the live testnet deployment with demo data so the map looks alive on camera:
 * several distinct players owning territory in different colours, a couple of Sponsored Zones,
 * and a duel or two.
 *
 * Everything goes through the REAL pipeline — sessions are recorded on Sepolia and only become
 * territory once the Attestcoin Protocol attests them and the relayer submits the proof. There is
 * deliberately no shortcut: Bases cannot be minted directly, so seeding takes as long as real
 * attestation does (~8-15 minutes for a batch).
 *
 * Usage (from contracts/):
 *   npx hardhat run scripts/seed-demo-data.ts --network sepolia   # phase 1: fund + record sessions
 *   npx hardhat run scripts/seed-demo-data.ts --network creditcoin # phase 2: zones + duels
 *
 * Tune DEMO_CENTER to wherever the demo will actually be filmed — territory that isn't near the
 * camera's map view is useless.
 */

// Hanoi, matching the frontend's DEFAULT_CENTER so seeded territory is visible immediately.
const DEMO_CENTER = { lat: 21.0278, lng: 105.8342 };

/** Demo player wallets are derived from a mnemonic generated on first run and cached in
 *  `.demo-wallets.json` (gitignored). It MUST be a private, freshly generated phrase: well-known
 *  test mnemonics (Hardhat's "test test ... junk", for instance) are continuously swept by bots on
 *  public testnets, so anything funded there disappears within seconds — learned the hard way. */
const WALLETS_FILE = path.join(__dirname, "..", ".demo-wallets.json");
const PLAYER_COUNT = 5;

/** Per-player funding. Sepolia ETH pays for recordSession txs; tCTC covers zone pools/duel stakes. */
const FUND_SEPOLIA_ETH = "0.005";
const FUND_CTC = "260";

const SESSION_TYPE_CLAIM = 0;
const MICRO = 1_000_000;

const CHECKPOINT = path.join(__dirname, "..", ".demo-seed-state.json");

interface SeedState {
  sessionsSubmitted?: { player: string; sessionId: string; txHash: string }[];
  zonesCreated?: number[];
  duelsCreated?: number[];
}

function loadState(): SeedState {
  if (!fs.existsSync(CHECKPOINT)) return {};
  try {
    return JSON.parse(fs.readFileSync(CHECKPOINT, "utf-8"));
  } catch {
    return {};
  }
}

function saveState(state: SeedState) {
  fs.writeFileSync(CHECKPOINT, JSON.stringify(state, null, 2));
}

function demoPlayers(): HDNodeWallet[] {
  let phrase: string;

  if (fs.existsSync(WALLETS_FILE)) {
    phrase = JSON.parse(fs.readFileSync(WALLETS_FILE, "utf-8")).mnemonic;
  } else {
    // Fresh, private phrase — see WALLETS_FILE's comment for why a well-known one is unusable.
    phrase = Wallet.createRandom().mnemonic!.phrase;
    fs.writeFileSync(WALLETS_FILE, JSON.stringify({ mnemonic: phrase }, null, 2));
    console.log(`Generated a new demo mnemonic -> ${path.basename(WALLETS_FILE)} (gitignored)`);
  }

  const mnemonic = Mnemonic.fromPhrase(phrase);
  return Array.from({ length: PLAYER_COUNT }, (_, i) =>
    HDNodeWallet.fromMnemonic(mnemonic, `m/44'/60'/0'/0/${i}`)
  );
}

/** An axis-aligned square polygon in micro-degrees, `sideMeters` on each side, centred on the
 *  given offset from DEMO_CENTER. Walked clockwise; the loop is implicitly closed on-chain. */
function squareLoop(latOffsetDeg: number, lngOffsetDeg: number, sideMeters: number) {
  const centerLat = DEMO_CENTER.lat + latOffsetDeg;
  const centerLng = DEMO_CENTER.lng + lngOffsetDeg;
  const halfLatDeg = sideMeters / 2 / 111_320;
  const halfLngDeg = halfLatDeg / Math.cos((centerLat * Math.PI) / 180);

  const corners = [
    [centerLat + halfLatDeg, centerLng - halfLngDeg],
    [centerLat + halfLatDeg, centerLng + halfLngDeg],
    [centerLat - halfLatDeg, centerLng + halfLngDeg],
    [centerLat - halfLatDeg, centerLng - halfLngDeg],
  ];

  return {
    lats: corners.map(([lat]) => Math.round(lat * MICRO)),
    lngs: corners.map(([, lng]) => Math.round(lng * MICRO)),
    // Perimeter of the square = the distance actually "walked".
    distanceMeters: Math.round(sideMeters * 4),
  };
}

/**
 * A realistic "walked around the block" loop: a rounded rectangle traced with many vertices and
 * a little wobble, the way a real GPS track looks after simplification. A bare 4-corner square
 * renders as an obviously synthetic shape on the map; this reads as an actual route someone
 * followed along the pavement, which is the whole point of storing real polygons.
 *
 * `seed` makes each plot's wobble deterministic but different, so no two territories look
 * identically machine-generated.
 */
function blockWalkLoop(
  latOffsetDeg: number,
  lngOffsetDeg: number,
  widthMeters: number,
  heightMeters: number,
  seed: number,
  vertexTarget = 24
) {
  const centerLat = DEMO_CENTER.lat + latOffsetDeg;
  const centerLng = DEMO_CENTER.lng + lngOffsetDeg;
  const metersPerDegLat = 111_320;
  const metersPerDegLng = 111_320 * Math.cos((centerLat * Math.PI) / 180);

  // Deterministic pseudo-random in [-1, 1], so repeated seeding produces identical territory.
  let state = seed * 9301 + 49297;
  const wobble = () => {
    state = (state * 9301 + 49297) % 233280;
    return (state / 233280) * 2 - 1;
  };

  const halfW = widthMeters / 2;
  const halfH = heightMeters / 2;
  const cornerRadius = Math.min(halfW, halfH) * 0.35;

  // Trace the rounded rectangle as a parametric outline, sampling `vertexTarget` points.
  const points: [number, number][] = [];
  for (let i = 0; i < vertexTarget; i++) {
    const t = (i / vertexTarget) * 2 * Math.PI;
    // Superellipse: exponent > 2 gives straight-ish sides with rounded corners, which is what a
    // walk around a city block actually traces.
    const exponent = 4;
    const cos = Math.cos(t);
    const sin = Math.sin(t);
    const sx = Math.sign(cos) * Math.abs(cos) ** (2 / exponent);
    const sy = Math.sign(sin) * Math.abs(sin) ** (2 / exponent);

    // A metre or two of side-to-side drift, like walking the pavement rather than a survey line.
    const driftMeters = 2.5;
    const xMeters = sx * (halfW - cornerRadius * 0.1) + wobble() * driftMeters;
    const yMeters = sy * (halfH - cornerRadius * 0.1) + wobble() * driftMeters;

    points.push([centerLat + yMeters / metersPerDegLat, centerLng + xMeters / metersPerDegLng]);
  }

  // Distance walked = the traced perimeter, computed from the points themselves so the
  // anti-cheat speed check and the km cap see a number consistent with the shape.
  let perimeter = 0;
  for (let i = 0; i < points.length; i++) {
    const [aLat, aLng] = points[i];
    const [bLat, bLng] = points[(i + 1) % points.length];
    const dLat = (bLat - aLat) * metersPerDegLat;
    const dLng = (bLng - aLng) * metersPerDegLng;
    perimeter += Math.hypot(dLat, dLng);
  }

  return {
    lats: points.map(([lat]) => Math.round(lat * MICRO)),
    lngs: points.map(([, lng]) => Math.round(lng * MICRO)),
    distanceMeters: Math.round(perimeter),
  };
}

/** An L-shaped (concave) loop — proves on the map that territory is a real walked polygon, not a
 *  circle approximation. */
function lShapedLoop(latOffsetDeg: number, lngOffsetDeg: number, armMeters: number) {
  const baseLat = DEMO_CENTER.lat + latOffsetDeg;
  const baseLng = DEMO_CENTER.lng + lngOffsetDeg;
  const dLat = armMeters / 111_320;
  const dLng = dLat / Math.cos((baseLat * Math.PI) / 180);

  const pts = [
    [baseLat, baseLng],
    [baseLat + dLat, baseLng],
    [baseLat + dLat, baseLng + dLng / 2],
    [baseLat + dLat / 2, baseLng + dLng / 2],
    [baseLat + dLat / 2, baseLng + dLng],
    [baseLat, baseLng + dLng],
  ];

  return {
    lats: pts.map(([lat]) => Math.round(lat * MICRO)),
    lngs: pts.map(([, lng]) => Math.round(lng * MICRO)),
    distanceMeters: Math.round(armMeters * 6),
  };
}

/** Session plan. Offsets are in degrees; ~0.0045 deg latitude ≈ 500m, enough that separate
 *  players' squares never touch (touching another player's ground would be rejected, and touching
 *  your OWN ground extends that Base instead of planting a new one — both used deliberately
 *  below). distanceMeters must stay within the level-0 km cap (1000m) and imply a walking pace
 *  under MAX_SPEED_METERS_PER_SECOND. */
function sessionPlan() {
  const plan: {
    playerIndex: number;
    loop: ReturnType<typeof squareLoop>;
    label: string;
  }[] = [];

  // Every territory is traced as a many-vertex "walk around the block" so the map shows real
  // routes rather than synthetic squares. Sizes are kept modest to stay inside the level-0
  // 1000m km cap (the traced perimeter is what counts as distance walked).
  // Player 0: three separate Bases spread north.
  plan.push({ playerIndex: 0, loop: blockWalkLoop(0.0, 0.0, 190, 150, 11), label: "P0 base A (centre)" });
  plan.push({ playerIndex: 0, loop: blockWalkLoop(0.006, 0.0, 170, 170, 12), label: "P0 base B" });
  plan.push({ playerIndex: 0, loop: blockWalkLoop(0.012, 0.0, 150, 130, 13), label: "P0 base C" });

  // Player 1: one Base, then a second loop that TOUCHES it -> extends into a multi-chunk Base.
  plan.push({ playerIndex: 1, loop: blockWalkLoop(0.0, 0.006, 180, 160, 21), label: "P1 base A" });
  plan.push({ playerIndex: 1, loop: blockWalkLoop(0.0, 0.0075, 180, 160, 22), label: "P1 extends base A" });

  // Player 2: a deliberately elongated street-strip shape + a compact one.
  plan.push({ playerIndex: 2, loop: blockWalkLoop(0.006, 0.006, 240, 110, 31), label: "P2 street strip" });
  plan.push({ playerIndex: 2, loop: blockWalkLoop(0.012, 0.007, 160, 160, 32), label: "P2 compact block" });

  // Player 3: two Bases west.
  plan.push({ playerIndex: 3, loop: blockWalkLoop(0.0, -0.007, 175, 165, 41), label: "P3 base A" });
  plan.push({ playerIndex: 3, loop: blockWalkLoop(0.006, -0.007, 185, 145, 42), label: "P3 base B" });

  // Player 4: two Bases south.
  plan.push({ playerIndex: 4, loop: blockWalkLoop(-0.006, 0.0, 170, 170, 51), label: "P4 base A" });
  plan.push({ playerIndex: 4, loop: blockWalkLoop(-0.006, 0.007, 200, 130, 52), label: "P4 base B" });

  return plan;
}

async function fundPlayers(funder: Wallet, players: HDNodeWallet[], provider: JsonRpcProvider, chain: "sepolia" | "creditcoin") {
  const amount = chain === "sepolia" ? parseEther(FUND_SEPOLIA_ETH) : parseEther(FUND_CTC);
  const symbol = chain === "sepolia" ? "ETH" : "tCTC";

  for (const player of players) {
    const balance = await provider.getBalance(player.address);
    if (balance >= amount) {
      console.log(`  ${player.address} already funded (${formatEther(balance)} ${symbol}) — skipping`);
      continue;
    }
    const topUp = amount - balance;
    console.log(`  funding ${player.address} with ${formatEther(topUp)} ${symbol}...`);
    const tx = await funder.sendTransaction({ to: player.address, value: topUp });
    await tx.wait();
  }
}

async function phaseSepolia() {
  const addresses = loadAddresses();
  const sessionAddress = addresses.sepolia?.TerraSession;
  if (!sessionAddress) throw new Error("TerraSession address missing — deploy first");

  const [funder] = await ethers.getSigners();
  const provider = ethers.provider as unknown as JsonRpcProvider;
  const players = demoPlayers();

  console.log(`\n=== Phase 1 (Sepolia): fund ${players.length} demo players + record sessions ===`);
  console.log(`TerraSession @ ${sessionAddress}`);
  console.log(`Funder: ${funder.address} (${formatEther(await provider.getBalance(funder.address))} ETH)\n`);

  await fundPlayers(funder as unknown as Wallet, players, provider, "sepolia");

  const sessionAbi = require("../artifacts/contracts/TerraSession.sol/TerraSession.json").abi;
  const state = loadState();
  state.sessionsSubmitted = state.sessionsSubmitted ?? [];

  const plan = sessionPlan();
  console.log(`\nRecording ${plan.length} sessions...`);

  for (const [i, item] of plan.entries()) {
    const player = players[item.playerIndex].connect(provider);
    const contract = new Contract(sessionAddress, sessionAbi, player);

    // Pace it like a real walk so the on-chain average-speed anti-cheat check passes.
    const durationSeconds = Math.max(120, Math.round(item.loop.distanceMeters / 1.3));

    try {
      const tx = await contract.recordSession(
        SESSION_TYPE_CLAIM,
        item.loop.lats,
        item.loop.lngs,
        item.loop.distanceMeters,
        durationSeconds
      );
      const receipt = await tx.wait();
      const parsed = receipt!.logs
        .map((log: any) => {
          try {
            return contract.interface.parseLog(log);
          } catch {
            return null;
          }
        })
        .find((e: any) => e?.name === "SessionRecorded");

      const sessionId = parsed?.args?.sessionId?.toString() ?? "?";
      console.log(
        `  [${i + 1}/${plan.length}] ${item.label} — player ${player.address.slice(0, 8)} ` +
          `${item.loop.distanceMeters}m -> sessionId ${sessionId} (tx ${tx.hash.slice(0, 12)})`
      );
      state.sessionsSubmitted.push({ player: player.address, sessionId, txHash: tx.hash });
      saveState(state);
    } catch (error: any) {
      console.error(`  [${i + 1}/${plan.length}] ${item.label} FAILED: ${error.shortMessage ?? error.message}`);
    }
  }

  console.log(
    `\nDone. ${state.sessionsSubmitted.length} sessions recorded on Sepolia.\n` +
      `The relayer will pick them up and they'll appear as territory after Attestcoin attestation ` +
      `(~8-15 min). Watch: tail -f /tmp/tc-worker.log`
  );
}

async function phaseCreditcoin() {
  const addresses = loadAddresses();
  const gameAddress = addresses.creditcoin?.TerraChainGame;
  if (!gameAddress) throw new Error("TerraChainGame address missing — deploy first");

  const [funder] = await ethers.getSigners();
  const provider = ethers.provider as unknown as JsonRpcProvider;
  const players = demoPlayers();
  const gameAbi = require("../artifacts/contracts/TerraChainGame.sol/TerraChainGame.json").abi;

  console.log(`\n=== Phase 2 (Creditcoin): fund players + create Sponsored Zones and Duels ===`);
  console.log(`TerraChainGame @ ${gameAddress}`);
  console.log(`Funder: ${funder.address} (${formatEther(await provider.getBalance(funder.address))} tCTC)\n`);

  await fundPlayers(funder as unknown as Wallet, players, provider, "creditcoin");

  const state = loadState();
  state.zonesCreated = state.zonesCreated ?? [];
  state.duelsCreated = state.duelsCreated ?? [];

  const game = new Contract(gameAddress, gameAbi, funder);
  const minPool = await game.MIN_ZONE_POOL();

  // Two zones over the seeded territory, sponsored by two different "businesses". `label` is the
  // on-chain display name players read off the map, so it's kept under MAX_ZONE_NAME_BYTES (32).
  const zonePlan = [
    { sponsorIndex: 0, latOffset: 0.0, lngOffset: 0.0, radius: 800, days: 30, sessions: 40, label: "Highlands Coffee" },
    {
      sponsorIndex: 1,
      latOffset: 0.006,
      lngOffset: 0.0,
      radius: 600,
      days: 30,
      sessions: 30,
      label: "California Fitness",
    },
  ];

  console.log(`\nCreating ${zonePlan.length} Sponsored Zones (${formatEther(minPool)} CTC each)...`);
  for (const z of zonePlan) {
    const sponsor = players[z.sponsorIndex].connect(provider);
    const asSponsor = game.connect(sponsor) as any;
    try {
      const tx = await asSponsor.createSponsoredZone(
        Math.round((DEMO_CENTER.lat + z.latOffset) * MICRO),
        Math.round((DEMO_CENTER.lng + z.lngOffset) * MICRO),
        z.radius,
        z.days,
        z.sessions,
        z.label,
        { value: minPool }
      );
      const receipt = await tx.wait();
      const parsed = receipt!.logs
        .map((log: any) => {
          try {
            return game.interface.parseLog(log);
          } catch {
            return null;
          }
        })
        .find((e: any) => e?.name === "SponsoredZoneCreated");
      const zoneId = Number(parsed?.args?.zoneId ?? 0);
      console.log(`  zone #${zoneId} "${z.label}" r=${z.radius}m by ${sponsor.address.slice(0, 8)}`);
      state.zonesCreated.push(zoneId);
      saveState(state);
    } catch (error: any) {
      console.error(`  zone "${z.label}" FAILED: ${error.shortMessage ?? error.message}`);
    }
  }

  // A live duel (accepted, running) plus an open challenge waiting for a response.
  console.log(`\nCreating duels...`);
  try {
    const challenger = players[2].connect(provider);
    const opponent = players[3].connect(provider);
    const stake = parseEther("5");

    const challengeTx = await (game.connect(challenger) as any).challengeDuel(opponent.address, 48, { value: stake });
    const challengeReceipt = await challengeTx.wait();
    const challengedId = Number(
      challengeReceipt!.logs
        .map((log: any) => {
          try {
            return game.interface.parseLog(log);
          } catch {
            return null;
          }
        })
        .find((e: any) => e?.name === "DuelChallenged")?.args?.duelId ?? 0
    );
    console.log(`  duel #${challengedId}: P2 -> P3, 5 CTC, 48h`);

    const acceptTx = await (game.connect(opponent) as any).acceptDuel(challengedId, { value: stake });
    await acceptTx.wait();
    console.log(`  duel #${challengedId} accepted — now live`);
    state.duelsCreated.push(challengedId);

    // A second, still-pending challenge so the UI shows an incoming invite too.
    const openTx = await (game.connect(players[4].connect(provider)) as any).challengeDuel(
      players[0].address,
      24,
      { value: parseEther("2") }
    );
    const openReceipt = await openTx.wait();
    const openId = Number(
      openReceipt!.logs
        .map((log: any) => {
          try {
            return game.interface.parseLog(log);
          } catch {
            return null;
          }
        })
        .find((e: any) => e?.name === "DuelChallenged")?.args?.duelId ?? 0
    );
    console.log(`  duel #${openId}: P4 -> P0, 2 CTC, 24h (pending acceptance)`);
    state.duelsCreated.push(openId);
    saveState(state);
  } catch (error: any) {
    console.error(`  duels FAILED: ${error.shortMessage ?? error.message}`);
  }

  console.log(`\nDemo players (import any of these into a wallet to play as them):`);
  for (const [i, p] of players.entries()) {
    console.log(`  P${i}  ${p.address}`);
  }
  console.log(`\nDone.`);
}

async function main() {
  const network = await ethers.provider.getNetwork();
  const chainId = Number(network.chainId);

  if (chainId === 11155111) {
    await phaseSepolia();
  } else {
    await phaseCreditcoin();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
