import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Log, LogDescription } from "ethers";
import type { RecordedSession } from "../hooks/useSessionRecorder";
import { centroid, toMicroDegrees } from "../lib/geo";
import { SEPOLIA_CHAIN_ID, SESSION_TYPE, type SessionTypeName } from "../config";
import { getCreditcoinReadProvider, getTerraSessionWriteContract, switchToChain } from "../lib/web3";
import { pollSessionOutcome } from "../lib/sessionOutcome";

interface SessionPanelProps {
  isRecording: boolean;
  distanceMeters: number;
  pathLength: number;
  loopCapMeters: number;
  onStart: () => void;
  onStop: () => RecordedSession | null;
  onSubmitted: () => void;
}

export function SessionPanel({
  isRecording,
  distanceMeters,
  pathLength,
  loopCapMeters,
  onStart,
  onStop,
  onSubmitted,
}: SessionPanelProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<SessionTypeName>("Claim");
  const [status, setStatus] = useState<string | null>(null);
  const [statusIsError, setStatusIsError] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const modeLabel: Record<SessionTypeName, string> = {
    Claim: t("session.modeClaim"),
    Reinforce: t("session.modeReinforce"),
  };

  function handleStart() {
    setStatus(null);
    setStatusIsError(false);
    onStart();
  }

  async function handleStop() {
    const session = onStop();
    if (!session) {
      setStatus(t("session.noGps"));
      setStatusIsError(true);
      return;
    }

    setSubmitting(true);
    setStatusIsError(false);
    setStatus(t("session.sendingToSepolia"));
    try {
      // Pin the block Creditcoin is at right now so the outcome poll only looks forward —
      // sessionIds are unique anyway, but this keeps each query fast and cheap.
      const fromBlock = await getCreditcoinReadProvider().getBlockNumber();

      await switchToChain(SEPOLIA_CHAIN_ID);
      const contract = await getTerraSessionWriteContract();

      // Both Claim and Reinforce resolve against the loop's center.
      const point = centroid(session.path);
      const tx = await contract.recordSession(
        SESSION_TYPE[mode],
        toMicroDegrees(point.lat),
        toMicroDegrees(point.lng),
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
    <div className="panel session-panel">
      <h3>{t("session.title")}</h3>

      <p className="hint">{t("session.loopCapHint", { meters: loopCapMeters })}</p>

      <select value={mode} onChange={(e) => setMode(e.target.value as SessionTypeName)} disabled={isRecording}>
        {Object.entries(modeLabel).map(([key, label]) => (
          <option key={key} value={key}>
            {label}
          </option>
        ))}
      </select>

      {mode === "Reinforce" && <p className="hint">{t("session.reinforceHint")}</p>}

      {!isRecording ? (
        <button onClick={handleStart} disabled={submitting}>
          {t("session.start")}
        </button>
      ) : (
        <button onClick={handleStop} disabled={submitting}>
          {t("session.stop", { meters: Math.round(distanceMeters), points: pathLength })}
        </button>
      )}

      {status && <p className={statusIsError ? "error" : "status"}>{status}</p>}
    </div>
  );
}
