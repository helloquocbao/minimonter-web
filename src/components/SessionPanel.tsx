import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Log, LogDescription } from "ethers";
import type { RecordedSession } from "../hooks/useSessionRecorder";
import type { BaseInfo } from "../hooks/useGameState";
import { toMicroDegrees, type LatLng } from "../lib/geo";
import { isLoopClosed, simplifyLoopForChain, MIN_POLYGON_POINTS } from "../lib/polygonSimplify";
import { SEPOLIA_CHAIN_ID, SESSION_TYPE, type SessionTypeName } from "../config";
import { getCreditcoinReadProvider, getTerraSessionWriteContract, switchToChain } from "../lib/web3";
import { pollSessionOutcome } from "../lib/sessionOutcome";

interface SessionPanelProps {
  isRecording: boolean;
  distanceMeters: number;
  pathLength: number;
  loopCapMeters: number;
  bases: BaseInfo[];
  myAddress: string | null;
  onStart: () => void;
  onStop: () => RecordedSession | null;
  onSubmitted: () => void;
  /** Called right after onStart fires — lets the parent close the modal so the map (and the
   *  player's live walking path) is fully visible while a session is being recorded. */
  onStarted?: () => void;
}

/** Even-odd ray-casting point-in-polygon test — mirrors the on-chain check exactly (see
 *  _pointInPolygon in TerraChainGame.sol) so the frontend's Claim/Reinforce guess matches what
 *  the contract will actually decide. */
function pointInPolygon(point: LatLng, polygon: LatLng[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    const crosses = a.lat > point.lat !== b.lat > point.lat;
    if (crosses) {
      const lngIntersect = a.lng + ((b.lng - a.lng) * (point.lat - a.lat)) / (b.lat - a.lat);
      if (point.lng < lngIntersect) inside = !inside;
    }
  }
  return inside;
}

function chunkCentroid(points: LatLng[]): LatLng {
  const sum = points.reduce((acc, p) => ({ lat: acc.lat + p.lat, lng: acc.lng + p.lng }), { lat: 0, lng: 0 });
  return { lat: sum.lat / points.length, lng: sum.lng / points.length };
}

/**
 * Decide Claim vs Reinforce automatically from the shape just walked — no manual mode picker.
 * If the loop encloses the centroid of any of the player's own (undestroyed) Base chunks, it's
 * a Reinforce attempt; otherwise it's treated as a Claim (which may also just extend one of the
 * player's own Bases on-chain, if it touches one without fully enclosing it). The contract is
 * still the final authority (ClaimRejected/ReinforceRejected can always happen) — this only
 * decides which function gets called.
 */
function inferMode(loop: LatLng[], bases: BaseInfo[], myAddress: string | null): SessionTypeName {
  if (!myAddress) return "Claim";
  const ownsEnclosedChunk = bases.some(
    (b) =>
      b.owner.toLowerCase() === myAddress.toLowerCase() &&
      b.chunks.some((chunk) => pointInPolygon(chunkCentroid(chunk.points), loop))
  );
  return ownsEnclosedChunk ? "Reinforce" : "Claim";
}

export function SessionPanel({
  isRecording,
  distanceMeters,
  pathLength,
  loopCapMeters,
  bases,
  myAddress,
  onStart,
  onStop,
  onSubmitted,
  onStarted,
}: SessionPanelProps) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<string | null>(null);
  const [statusIsError, setStatusIsError] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [needsRetry, setNeedsRetry] = useState(false);

  const modeLabel: Record<SessionTypeName, string> = {
    Claim: t("session.modeClaimShort"),
    Reinforce: t("session.modeReinforceShort"),
  };

  function handleStart() {
    setStatus(null);
    setStatusIsError(false);
    setNeedsRetry(false);
    onStart();
    onStarted?.();
  }

  /** Discards the in-progress walk and lets the player start recording again from scratch.
   *  Safe to do freely: distance walked in a loop that never gets submitted never touches
   *  cumulativeMeters or the km cap on-chain — nothing here was ever "spent" to begin with.
   *  The stale path itself is cleared automatically the next time onStart() runs. */
  function handleRetry() {
    setStatus(null);
    setStatusIsError(false);
    setNeedsRetry(false);
  }

  async function handleStop() {
    const session = onStop();
    if (!session) {
      setStatus(t("session.noGps"));
      setStatusIsError(true);
      return;
    }

    if (!isLoopClosed(session.path)) {
      setStatus(t("session.loopNotClosed"));
      setStatusIsError(true);
      setNeedsRetry(true);
      return;
    }

    const loop = simplifyLoopForChain(session.path);
    if (loop.length < MIN_POLYGON_POINTS) {
      setStatus(t("session.loopTooSimple"));
      setStatusIsError(true);
      setNeedsRetry(true);
      return;
    }

    setSubmitting(true);
    setStatusIsError(false);
    try {
      // Pin the block Creditcoin is at right now so the outcome poll only looks forward —
      // sessionIds are unique anyway, but this keeps each query fast and cheap.
      const fromBlock = await getCreditcoinReadProvider().getBlockNumber();

      // The mode itself is inferred here rather than picked by the player — no UI toggle
      // needed. The walked polygon (simplified, capped at MAX_POLYGON_POINTS) is what actually
      // gets submitted — not just its centroid — so irregular real-world shapes (not just
      // circles) are represented on-chain.
      const mode = inferMode(loop, bases, myAddress);
      setStatus(t("session.sendingToSepolia", { mode: modeLabel[mode] }));

      await switchToChain(SEPOLIA_CHAIN_ID);
      const contract = await getTerraSessionWriteContract();

      const lats = loop.map((p) => toMicroDegrees(p.lat));
      const lngs = loop.map((p) => toMicroDegrees(p.lng));

      const tx = await contract.recordSession(
        SESSION_TYPE[mode],
        lats,
        lngs,
        session.distanceMeters,
        session.durationSeconds
      );

      setStatus(t("session.sentWaitingAttestation", { hash: tx.hash.slice(0, 10) }));
      const receipt = await tx.wait();

      const sessionRecordedLog = receipt!.logs
        .map((log: Log): LogDescription | null => {
          try {
            return contract.interface.parseLog(log);
          } catch {
            return null;
          }
        })
        .find((parsed: LogDescription | null) => parsed?.name === "SessionRecorded");

      if (!sessionRecordedLog) {
        setStatus(t("session.sepoliaNoSessionId"));
        setStatusIsError(true);
        return;
      }

      const sessionId = sessionRecordedLog.args.sessionId as bigint;
      const player = sessionRecordedLog.args.player as string;

      setStatus(t("session.recordedWaiting", { sessionId: sessionId.toString() }));

      const outcome = await pollSessionOutcome(mode, player, sessionId, fromBlock, t, (elapsedMs) => {
        const minutes = Math.floor(elapsedMs / 60_000);
        setStatus(t("session.waitingOutcome", { sessionId: sessionId.toString(), minutes }));
      });

      setStatus(outcome.message);
      setStatusIsError(!outcome.success);
      onSubmitted();
    } catch (err) {
      setStatus(t("session.errorPrefix", { message: (err as Error).message }));
      setStatusIsError(true);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="session-panel">
      <p className="hint">{t("session.loopCapHint", { meters: loopCapMeters })}</p>

      {!isRecording ? (
        <button onClick={handleStart} disabled={submitting}>
          {t("session.start")}
        </button>
      ) : (
        <button className="is-recording" onClick={handleStop} disabled={submitting}>
          {t("session.stop", { meters: Math.round(distanceMeters), points: pathLength })}
        </button>
      )}

      {status && <p className={statusIsError ? "error" : "status"}>{status}</p>}

      {needsRetry && (
        <button className="is-recording" onClick={handleRetry}>
          {t("session.retry")}
        </button>
      )}
    </div>
  );
}
