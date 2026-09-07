import { useCallback, useEffect, useState } from "react";
import { INDEXER_URL } from "../config";

export interface BaseInfo {
  id: number;
  owner: string;
  lat: number;
  lng: number;
  radiusMeters: number;
  powerMeters: number;
}

interface IndexerBase {
  id: number;
  owner: string;
  lat: number;
  lng: number;
  radiusMeters: number;
  powerMeters: number;
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
      data.map((b) => ({
        id: b.id,
        owner: b.owner,
        lat: b.lat / 1e6,
        lng: b.lng / 1e6,
        radiusMeters: b.radiusMeters,
        powerMeters: b.powerMeters,
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
  const [walletMeters, setWalletMeters] = useState(0);
  const [capacityMeters, setCapacityMeters] = useState(0);

  const refresh = useCallback(async () => {
    if (!address) return;
    const response = await fetch(`${INDEXER_URL}/players/${address}`);
    const data: { walletMeters: number; capacityMeters: number } = await response.json();
    setWalletMeters(data.walletMeters);
    setCapacityMeters(data.capacityMeters);
  }, [address]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [refresh]);

  return { walletMeters, capacityMeters, refresh };
}
