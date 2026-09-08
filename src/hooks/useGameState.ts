import { useCallback, useEffect, useState } from "react";
import { INDEXER_URL } from "../config";
import type { LatLng } from "../lib/geo";

export interface ChunkInfo {
  id: number;
  /** Polygon vertices, in degrees (already converted from the indexer's micro-degrees). */
  points: LatLng[];
}

export interface BaseInfo {
  id: number;
  owner: string;
  chunks: ChunkInfo[];
  initialAreaMeters: number;
  currentAreaMeters: number;
}

interface IndexerChunk {
  id: number;
  lats: number[];
  lngs: number[];
  areaMeters: number;
}

interface IndexerBase {
  id: number;
  owner: string;
  chunks: IndexerChunk[];
  initialAreaMeters: number;
  currentAreaMeters: number;
}

const REFRESH_INTERVAL_MS = 15_000;

/// Reads come from the indexer service (see ../../../indexer), not raw RPC — looping one
/// `bases(id)` call per Base directly against the chain doesn't scale past a handful of players
/// polling every 15s. The indexer keeps an in-memory mirror of on-chain events and serves it
/// over a small REST API instead.

export function useBases() {
  const [bases, setBases] = useState<BaseInfo[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const response = await fetch(`${INDEXER_URL}/bases`);
    const data: IndexerBase[] = await response.json();

    setBases(
      data
        // Bases fully destroyed by a bot attack are freed (owner == zero address) — hide them
        // from the map instead of drawing an empty/unclaimed shape.
        .filter((b) => b.owner !== "0x0000000000000000000000000000000000000000")
        .map((b) => ({
          id: b.id,
          owner: b.owner,
          initialAreaMeters: b.initialAreaMeters,
          currentAreaMeters: b.currentAreaMeters,
          chunks: b.chunks.map((c) => ({
            id: c.id,
            points: c.lats.map((lat, i) => ({ lat: lat / 1e6, lng: c.lngs[i] / 1e6 })),
          })),
        }))
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [refresh]);

  return { bases, loading, refresh };
}

export function usePlayerState(address: string | null) {
  const [cumulativeMeters, setCumulativeMeters] = useState(0);
  const [loopCapMeters, setLoopCapMeters] = useState(0);

  const refresh = useCallback(async () => {
    if (!address) return;
    const response = await fetch(`${INDEXER_URL}/players/${address}`);
    const data: { cumulativeMeters: number; loopCapMeters: number } = await response.json();
    setCumulativeMeters(data.cumulativeMeters);
    setLoopCapMeters(data.loopCapMeters);
  }, [address]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [refresh]);

  return { cumulativeMeters, loopCapMeters, refresh };
}

export interface ZoneInfo {
  id: number;
  sponsor: string;
  lat: number;
  lng: number;
  radiusMeters: number;
  totalPool: string;
  remainingPool: string;
  rewardPerSession: string;
  sessionsPaid: number;
  expectedSessions: number;
  endsAt: number;
  withdrawn: boolean;
}

interface IndexerZone {
  id: number;
  sponsor: string;
  lat: number;
  lng: number;
  radiusMeters: number;
  totalPool: string;
  remainingPool: string;
  rewardPerSession: string;
  sessionsPaid: number;
  expectedSessions: number;
  endsAt: number;
  withdrawn: boolean;
}

/// Sponsored Zones — local businesses pay CTC to reward real foot traffic (Claim/Reinforce
/// sessions) inside a chosen area. Read the same way as Bases: replayed by the indexer,
/// polled here, never computed client-side.
export function useZones() {
  const [zones, setZones] = useState<ZoneInfo[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const response = await fetch(`${INDEXER_URL}/zones`);
    const data: IndexerZone[] = await response.json();
    setZones(
      data.map((z) => ({
        ...z,
        lat: z.lat / 1e6,
        lng: z.lng / 1e6,
      }))
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [refresh]);

  return { zones, loading, refresh };
}

export type DuelStatus = "Pending" | "Active" | "Settled" | "Cancelled";

export interface DuelInfo {
  id: number;
  challenger: string;
  opponent: string;
  stake: string; // wei, per side (as a string — BigInt from the indexer)
  durationSeconds: number;
  challengedAt: number;
  startedAt: number; // 0 while Pending
  endsAt: number; // 0 while Pending
  status: DuelStatus;
  winner: string | null;
  challengerMetersWalked: number | null;
  opponentMetersWalked: number | null;
}

/// Duels — simple, opt-in PvP: two players wager CTC on who walks further within a time
/// window. Read the same way as everything else here: replayed by the indexer from
/// DuelChallenged/DuelAccepted/DuelCancelled/DuelSettled events, never computed client-side.
export function useDuels(address: string | null) {
  const [duels, setDuels] = useState<DuelInfo[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!address) {
      setDuels([]);
      setLoading(false);
      return;
    }
    const response = await fetch(`${INDEXER_URL}/duels/${address}`);
    const data: DuelInfo[] = await response.json();
    setDuels(data);
    setLoading(false);
  }, [address]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [refresh]);

  return { duels, loading, refresh };
}
