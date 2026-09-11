import { ethers } from "hardhat";
import { HDNodeWallet, Mnemonic, JsonRpcProvider, Contract } from "ethers";
import * as fs from "fs";
import * as path from "path";
import { loadAddresses } from "./addresses";

/**
 * Second seeding pass: records Reinforce sessions for territory the demo players already own.
 *
 * Two reasons this exists separately from seed-demo-data.ts:
 *  - Reinforce needs Bases to already exist on Creditcoin, so it can only run after the first
 *    batch has finished attesting.
 *  - It's the cheapest way to push the global session counter past BOT_ATTACK_TX_INTERVAL (20),
 *    which is what unlocks the permissionless bot attack the demo wants to show off — and it
 *    simultaneously produces real distance numbers for any duel that's currently running.
 *
 * Usage (from contracts/, after the first batch has landed):
 *   npx hardhat run scripts/seed-reinforce.ts --network sepolia
 */

const DEMO_CENTER = { lat: 21.0278, lng: 105.8342 };
const WALLETS_FILE = path.join(__dirname, "..", ".demo-wallets.json");
const SESSION_TYPE_REINFORCE = 1;
const MICRO = 1_000_000;
const INDEXER_URL = process.env.INDEXER_URL ?? "http://localhost:4000";

function demoPlayers(): HDNodeWallet[] {
  const phrase = JSON.parse(fs.readFileSync(WALLETS_FILE, "utf-8")).mnemonic;
  const mnemonic = Mnemonic.fromPhrase(phrase);
  return Array.from({ length: 5 }, (_, i) => HDNodeWallet.fromMnemonic(mnemonic, `m/44'/60'/0'/0/${i}`));
}

/** Small square centred on a point — used as the Reinforce loop. It only has to enclose the
 *  centroid of a chunk the player already owns, so a tight loop is enough (and cheap in walked
 *  distance, keeping every session inside the level-0 km cap). */
function tightLoop(centerLat: number, centerLng: number, sideMeters: number) {
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
    distanceMeters: Math.round(sideMeters * 4),
  };
}

interface IndexerBase {
  id: number;
  owner: string;
  chunks: { lats: number[]; lngs: number[] }[];
}

/** Reads real Base positions from the indexer rather than assuming the seed plan landed exactly
 *  as written — a rejected Claim (say, an unlucky overlap) would otherwise make every Reinforce
 *  here miss its target. */
async function fetchBases(): Promise<IndexerBase[]> {
  const response = await fetch(`${INDEXER_URL}/bases`);
  if (!response.ok) throw new Error(`indexer returned ${response.status}`);
  return (await response.json()) as IndexerBase[];
}

function chunkCentroid(chunk: { lats: number[]; lngs: number[] }) {
  const lat = chunk.lats.reduce((a, b) => a + b, 0) / chunk.lats.length / MICRO;
  const lng = chunk.lngs.reduce((a, b) => a + b, 0) / chunk.lngs.length / MICRO;
  return { lat, lng };
}

async function main() {
  const addresses = loadAddresses();
  const sessionAddress = addresses.sepolia?.TerraSession;
  if (!sessionAddress) throw new Error("TerraSession address missing");

  const provider = ethers.provider as unknown as JsonRpcProvider;
  const players = demoPlayers();
  const sessionAbi = require("../artifacts/contracts/TerraSession.sol/TerraSession.json").abi;

  const bases = await fetchBases();
  console.log(`\nIndexer reports ${bases.length} bases. Building Reinforce plan...\n`);

  const byOwner = new Map<string, IndexerBase[]>();
  for (const base of bases) {
    const key = base.owner.toLowerCase();
    byOwner.set(key, [...(byOwner.get(key) ?? []), base]);
  }

  // Two Reinforce rounds across every owned Base: enough to clear the 20-session bot-attack
  // threshold given the first batch already landed ~11.
  const ROUNDS = 2;
  let submitted = 0;

  for (let round = 1; round <= ROUNDS; round++) {
    for (const player of players) {
      const owned = byOwner.get(player.address.toLowerCase()) ?? [];
      if (owned.length === 0) continue;

      // Rotate which Base gets reinforced each round so the activity looks natural rather than
      // hammering a single spot.
      const base = owned[(round - 1) % owned.length];
      const centre = chunkCentroid(base.chunks[0]);
      const loop = tightLoop(centre.lat, centre.lng, 120);
      const durationSeconds = Math.max(120, Math.round(loop.distanceMeters / 1.3));

      const contract = new Contract(sessionAddress, sessionAbi, player.connect(provider));
      try {
        const tx = await contract.recordSession(
          SESSION_TYPE_REINFORCE,
          loop.lats,
          loop.lngs,
          loop.distanceMeters,
          durationSeconds
        );
        await tx.wait();
        submitted++;
        console.log(
          `  round ${round}: ${player.address.slice(0, 8)} reinforces base #${base.id} ` +
            `(${loop.distanceMeters}m) tx ${tx.hash.slice(0, 12)}`
        );
      } catch (error: any) {
        console.error(`  round ${round}: ${player.address.slice(0, 8)} FAILED: ${error.shortMessage ?? error.message}`);
      }
    }
  }

  console.log(
    `\n${submitted} Reinforce sessions recorded. Once they attest and relay, the global session ` +
      `count should cross BOT_ATTACK_TX_INTERVAL and the worker will fire commitBotAttack() ` +
      `followed by revealBotAttack() on its next polling ticks.`
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
