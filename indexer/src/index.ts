import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import express from "express";
import { Contract, EventLog, JsonRpcProvider } from "ethers";

import terraChainGameAbi from "./abi/TerraChainGame.json";

dotenv.config();

/// Read-side backend for TerraChain. Reading game state directly from the frontend (one RPC
/// call per Base, every few seconds, per connected player) doesn't scale — this service instead
/// replays TerraChainGame's events once into memory, keeps that in sync with a light poll, and
/// serves it over a tiny REST API. It has zero authority: every field it returns is a direct
/// mirror of an on-chain event, nothing is computed or trusted beyond what the contract already
/// emitted. Losing/restarting this process can't corrupt game state — it just re-replays.

const MAX_LOG_BLOCK_RANGE = 500;
const POLL_INTERVAL_MS = 15_000;
const EVENT_NAMES = [
  "BaseClaimed",
  "BaseExtended",
  "BaseReinforced",
  "BaseDamaged",
  "LoopCapIncreased",
  "SponsoredZoneCreated",
  "SponsoredZonePayout",
  "SponsoredZoneWithdrawn",
  "DuelChallenged",
  "DuelAccepted",
  "DuelCancelled",
  "DuelSettled",
] as const;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

interface ChunkRecord {
  id: number;
  lats: number[];
  lngs: number[];
  areaMeters: number;
}

interface BaseRecord {
  id: number;
  owner: string;
  chunks: ChunkRecord[];
  initialAreaMeters: number;
  currentAreaMeters: number;
}

interface PlayerRecord {
  cumulativeMeters: number;
  loopCapMeters: number;
}

interface ZoneRecord {
  id: number;
  sponsor: string;
  /// Sponsor-supplied business name, straight from the SponsoredZoneCreated log. Untrusted,
  /// unverified text from whoever paid for the zone — nothing on-chain proves the sponsor is
  /// really that business, so clients must render it as inert text, never as markup.
  name: string;
  lat: number;
  lng: number;
  radiusMeters: number;
  totalPool: string; // wei, as a string (BigInt doesn't survive JSON.stringify)
  remainingPool: string;
  rewardPerSession: string;
  sessionsPaid: number;
  expectedSessions: number;
  endsAt: number; // unix seconds
  withdrawn: boolean;
}

type DuelStatus = "Pending" | "Active" | "Settled" | "Cancelled";

interface DuelRecord {
  id: number;
  challenger: string;
  opponent: string;
  stake: string; // wei, per side
  durationSeconds: number;
  challengedAt: number;
  startedAt: number; // 0 while Pending
  endsAt: number; // 0 while Pending; startedAt + durationSeconds once Active
  status: DuelStatus;
  // Only populated once Settled:
  winner: string | null; // null = tie or not yet settled
  challengerMetersWalked: number | null;
  opponentMetersWalked: number | null;
}

interface State {
  bases: Map<number, BaseRecord>;
  players: Map<string, PlayerRecord>;
  zones: Map<number, ZoneRecord>;
  duels: Map<number, DuelRecord>;
  lastProcessedBlock: number;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} environment variable is not configured`);
  return value;
}

function loadDeployedAddress(): string | undefined {
  const file = path.join(__dirname, "..", "..", "deployed-addresses.json");
  if (!fs.existsSync(file)) return undefined;
  const addresses = JSON.parse(fs.readFileSync(file, "utf-8"));
  return addresses?.creditcoin?.TerraChainGame;
}

function upsertPlayer(state: State, address: string): PlayerRecord {
  const key = address.toLowerCase();
  let record = state.players.get(key);
  if (!record) {
    record = { cumulativeMeters: 0, loopCapMeters: 1000 };
    state.players.set(key, record);
  }
  return record;
}

async function fetchEvents(
  contract: Contract,
  eventName: string,
  fromBlock: number,
  toBlock: number
): Promise<EventLog[]> {
  const events: EventLog[] = [];
  let start = fromBlock;
  while (start <= toBlock) {
    const end = Math.min(start + MAX_LOG_BLOCK_RANGE - 1, toBlock);
    const batch = await contract.queryFilter(eventName, start, end);
    for (const e of batch) {
      if (e instanceof EventLog) events.push(e);
    }
    start = end + 1;
  }
  return events;
}

/** Every event type here carries the FINAL value for whatever it touched (not a delta), because
 *  the contract already did the math on-chain — the indexer only has to apply events in true
 *  chronological order (block, then log index) and keep whatever landed last. No game logic is
 *  reimplemented here on purpose: this process should never be able to disagree with the chain.
 *
 *  BaseClaimed/BaseExtended only carry a `chunkId` (not the polygon itself, to keep event data
 *  small) — the indexer fetches the actual polygon geometry via the `chunkPolygon` view once per
 *  new chunk and caches it forever (a chunk's shape never changes after creation). */
async function applyEvent(event: EventLog, state: State, contract: Contract) {
  switch (event.eventName) {
    case "BaseClaimed": {
      const { baseId, owner, chunkId, areaMeters } = event.args;
      const chunk = await fetchChunk(contract, chunkId);
      state.bases.set(Number(baseId), {
        id: Number(baseId),
        owner: (owner as string).toLowerCase(),
        chunks: [chunk],
        initialAreaMeters: Number(areaMeters),
        currentAreaMeters: Number(areaMeters),
      });
      break;
    }
    case "BaseExtended": {
      const { baseId, chunkId, newTotalAreaMeters } = event.args;
      const chunk = await fetchChunk(contract, chunkId);
      const base = state.bases.get(Number(baseId));
      if (base) {
        base.chunks.push(chunk);
        base.initialAreaMeters = Number(newTotalAreaMeters);
        base.currentAreaMeters = Number(newTotalAreaMeters); // extending counts as fresh ground
      }
      break;
    }
    case "BaseReinforced": {
      const { baseId, restoredAreaMeters } = event.args;
      const base = state.bases.get(Number(baseId));
      if (base) base.currentAreaMeters = Number(restoredAreaMeters);
      break;
    }
    case "BaseDamaged": {
      const { baseId, areaRemaining, destroyed } = event.args;
      const base = state.bases.get(Number(baseId));
      if (base) {
        base.currentAreaMeters = Number(areaRemaining);
        if (destroyed) base.owner = ZERO_ADDRESS; // ground freed — reclaimable via Claim
      }
      break;
    }
    case "LoopCapIncreased": {
      const { player, newCumulativeMeters, newLoopCapMeters } = event.args;
      const record = upsertPlayer(state, player as string);
      record.cumulativeMeters = Number(newCumulativeMeters);
      record.loopCapMeters = Number(newLoopCapMeters);
      break;
    }
    case "SponsoredZoneCreated": {
      const { zoneId, sponsor, name, lat, lng, radiusMeters, totalPool, expectedSessions, endsAt } = event.args;
      const expected = Number(expectedSessions);
      state.zones.set(Number(zoneId), {
        id: Number(zoneId),
        sponsor: (sponsor as string).toLowerCase(),
        name: name as string,
        lat: Number(lat),
        lng: Number(lng),
        radiusMeters: Number(radiusMeters),
        totalPool: (totalPool as bigint).toString(),
        remainingPool: (totalPool as bigint).toString(),
        rewardPerSession: ((totalPool as bigint) / BigInt(expected)).toString(),
        sessionsPaid: 0,
        expectedSessions: expected,
        endsAt: Number(endsAt),
        withdrawn: false,
      });
      break;
    }
    case "SponsoredZonePayout": {
      const { zoneId } = event.args;
      const zone = state.zones.get(Number(zoneId));
      if (zone) {
        zone.remainingPool = (BigInt(zone.remainingPool) - BigInt(zone.rewardPerSession)).toString();
        zone.sessionsPaid += 1;
      }
      break;
    }
    case "SponsoredZoneWithdrawn": {
      const { zoneId } = event.args;
      const zone = state.zones.get(Number(zoneId));
      if (zone) {
        zone.remainingPool = "0";
        zone.withdrawn = true;
      }
      break;
    }
    case "DuelChallenged": {
      const { duelId, challenger, opponent, stake, durationSeconds } = event.args;
      const block = await event.getBlock();
      state.duels.set(Number(duelId), {
        id: Number(duelId),
        challenger: (challenger as string).toLowerCase(),
        opponent: (opponent as string).toLowerCase(),
        stake: (stake as bigint).toString(),
        durationSeconds: Number(durationSeconds),
        challengedAt: block.timestamp,
        startedAt: 0,
        endsAt: 0,
        status: "Pending",
        winner: null,
        challengerMetersWalked: null,
        opponentMetersWalked: null,
      });
      break;
    }
    case "DuelAccepted": {
      const { duelId, startedAt, endsAt } = event.args;
      const duel = state.duels.get(Number(duelId));
      if (duel) {
        duel.status = "Active";
        duel.startedAt = Number(startedAt);
        duel.endsAt = Number(endsAt);
      }
      break;
    }
    case "DuelCancelled": {
      const { duelId } = event.args;
      const duel = state.duels.get(Number(duelId));
      if (duel) duel.status = "Cancelled";
      break;
    }
    case "DuelSettled": {
      const { duelId, winner, challengerMetersWalked, opponentMetersWalked } = event.args;
      const duel = state.duels.get(Number(duelId));
      if (duel) {
        duel.status = "Settled";
        duel.winner = winner === ZERO_ADDRESS ? null : (winner as string).toLowerCase();
        duel.challengerMetersWalked = Number(challengerMetersWalked);
        duel.opponentMetersWalked = Number(opponentMetersWalked);
      }
      break;
    }
  }
}

const chunkCache = new Map<number, ChunkRecord>();

async function fetchChunk(contract: Contract, chunkId: bigint): Promise<ChunkRecord> {
  const id = Number(chunkId);
  const cached = chunkCache.get(id);
  if (cached) return cached;

  const [lats, lngs] = await contract.chunkPolygon(chunkId);
  const record: ChunkRecord = {
    id,
    lats: lats.map((v: bigint) => Number(v)),
    lngs: lngs.map((v: bigint) => Number(v)),
    areaMeters: 0, // not needed standalone; base-level area fields are authoritative
  };
  chunkCache.set(id, record);
  return record;
}

async function syncTo(contract: Contract, state: State, toBlock: number): Promise<void> {
  if (toBlock < state.lastProcessedBlock) return;

  const perType = await Promise.all(
    EVENT_NAMES.map((name) => fetchEvents(contract, name, state.lastProcessedBlock, toBlock))
  );
  const merged = perType.flat().sort((a, b) => a.blockNumber - b.blockNumber || a.index - b.index);

  // Applied strictly in order (not Promise.all) — BaseExtended must never be processed before
  // the BaseClaimed that created its Base, and both need each chunk's polygon fetched in turn.
  for (const event of merged) await applyEvent(event, state, contract);

  state.lastProcessedBlock = toBlock + 1;
}

async function main() {
  const rpcUrl = requireEnv("CREDITCOIN_RPC_URL");
  const gameAddress = process.env.TERRA_CHAIN_GAME_CONTRACT_ADDRESS || loadDeployedAddress();
  if (!gameAddress) throw new Error("TerraChainGame address not found (env or deployed-addresses.json)");

  const startBlock = Number(process.env.INDEXER_START_BLOCK ?? 0);
  const port = Number(process.env.PORT ?? 4000);

  const provider = new JsonRpcProvider(rpcUrl);
  const gameContract = new Contract(gameAddress, terraChainGameAbi, provider);

  const state: State = {
    bases: new Map(),
    players: new Map(),
    zones: new Map(),
    duels: new Map(),
    lastProcessedBlock: startBlock,
  };

  console.log(`TerraChain indexer starting — TerraChainGame @ ${gameAddress}`);
  console.log(`Replaying events from block ${startBlock}...`);

  const currentBlock = await provider.getBlockNumber();
  await syncTo(gameContract, state, currentBlock);
  console.log(`Initial replay done: ${state.bases.size} bases, ${state.players.size} players known.`);

  setInterval(async () => {
    try {
      const latest = await provider.getBlockNumber();
      await syncTo(gameContract, state, latest);
    } catch (error: any) {
      console.error(`[error] sync: ${error.shortMessage ?? error.message}`);
    }
  }, POLL_INTERVAL_MS);

  const app = express();
  app.use((_req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    next();
  });

  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      lastProcessedBlock: state.lastProcessedBlock,
      baseCount: state.bases.size,
      playerCount: state.players.size,
      zoneCount: state.zones.size,
      duelCount: state.duels.size,
    });
  });

  app.get("/bases", (_req, res) => {
    res.json(Array.from(state.bases.values()));
  });

  app.get("/zones", (_req, res) => {
    res.json(Array.from(state.zones.values()));
  });

  app.get("/duels", (_req, res) => {
    res.json(Array.from(state.duels.values()));
  });

  app.get("/duels/:address", (req, res) => {
    const address = req.params.address.toLowerCase();
    const mine = Array.from(state.duels.values()).filter(
      (d) => d.challenger === address || d.opponent === address
    );
    res.json(mine);
  });

  app.get("/players/:address", (req, res) => {
    const address = req.params.address.toLowerCase();
    const record = state.players.get(address);
    res.json({
      address,
      cumulativeMeters: record?.cumulativeMeters ?? 0,
      loopCapMeters: record?.loopCapMeters ?? 1000,
    });
  });

  app.listen(port, () => {
    console.log(`Indexer API listening on http://localhost:${port}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
