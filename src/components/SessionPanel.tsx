import { useState } from "react";
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
  onStart: () => void;
  onStop: () => RecordedSession | null;
  onSubmitted: () => void;
}

const MODE_LABEL: Record<SessionTypeName, string> = {
  Bank: "Tích km (Bank) — nạp khiên",
  Claim: "Chiếm căn cứ (Claim) — đi vòng quanh 1 điểm chưa ai chiếm",
  Attack: "Tấn công (Attack) — đi vòng quanh (các) căn cứ muốn đánh",
};

export function SessionPanel({ isRecording, distanceMeters, pathLength, onStart, onStop, onSubmitted }: SessionPanelProps) {
  const [mode, setMode] = useState<SessionTypeName>("Bank");
  const [status, setStatus] = useState<string | null>(null);
  const [statusIsError, setStatusIsError] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  function handleStart() {
    setStatus(null);
    setStatusIsError(false);
    onStart();
  }

  async function handleStop() {
    const session = onStop();
    if (!session) {
      setStatus("Không ghi được vị trí nào — thử lại ở nơi có tín hiệu GPS tốt hơn.");
      setStatusIsError(true);
      return;
    }

    setSubmitting(true);
    setStatusIsError(false);
    setStatus("Đang gửi giao dịch lên Sepolia...");
    try {
      // Pin the block Creditcoin is at right now so the outcome poll only looks forward —
      // sessionIds are unique anyway, but this keeps each query fast and cheap.
      const fromBlock = await getCreditcoinReadProvider().getBlockNumber();

      await switchToChain(SEPOLIA_CHAIN_ID);
      const contract = await getTerraSessionWriteContract();

      // Bank doesn't care about location; Claim/Attack both resolve against the loop's center.
      const point = mode === "Bank" ? session.startedAt : centroid(session.path);
      const tx = await contract.recordSession(
        SESSION_TYPE[mode],
        toMicroDegrees(point.lat),
        toMicroDegrees(point.lng),
        session.distanceMeters,
        session.durationSeconds
      );

      setStatus(`Đã gửi (tx: ${tx.hash.slice(0, 10)}...). Đang chờ Attestcoin Protocol xác thực cross-chain...`);
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
        setStatus("Đã gửi lên Sepolia nhưng không đọc được sessionId — kiểm tra thủ công trên block explorer.");
        setStatusIsError(true);
        return;
      }

      const sessionId = sessionRecordedLog.args.sessionId as bigint;
      const player = sessionRecordedLog.args.player as string;

      setStatus(
        `Đã ghi nhận (session #${sessionId}). Đang chờ Attestcoin Protocol xác thực cross-chain — thường mất 8-15 phút...`
      );

      const outcome = await pollSessionOutcome(mode, player, sessionId, fromBlock, (elapsedMs) => {
        const minutes = Math.floor(elapsedMs / 60_000);
        setStatus(`Đang chờ kết quả session #${sessionId}... (${minutes} phút)`);
      });

      setStatus(outcome.message);
      setStatusIsError(!outcome.success);
      onSubmitted();
    } catch (err) {
      setStatus(`Lỗi: ${(err as Error).message}`);
      setStatusIsError(true);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="panel session-panel">
      <h3>Ghi hành trình</h3>

      <select value={mode} onChange={(e) => setMode(e.target.value as SessionTypeName)} disabled={isRecording}>
        {Object.entries(MODE_LABEL).map(([key, label]) => (
          <option key={key} value={key}>
            {label}
          </option>
        ))}
      </select>

      {mode === "Attack" && (
        <p className="hint">Mọi căn cứ có tâm nằm trong vòng bạn đi đều sẽ bị tấn công cùng lúc — không cần chọn trước.</p>
      )}

      {!isRecording ? (
        <button onClick={handleStart} disabled={submitting}>
          Bắt đầu di chuyển
        </button>
      ) : (
        <button onClick={handleStop} disabled={submitting}>
          Kết thúc ({Math.round(distanceMeters)}m, {pathLength} điểm)
        </button>
      )}

      {status && <p className={statusIsError ? "error" : "status"}>{status}</p>}
    </div>
  );
}
