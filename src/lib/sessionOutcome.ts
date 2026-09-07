import type { EventLog } from "ethers";
import type { SessionTypeName } from "../config";
import { getTerraChainGameReadContract } from "./web3";

const POLL_INTERVAL_MS = 15_000;
// Matches the worker's own attestation-wait ceiling (see worker/src/index.ts) — if nothing shows
// up by then, the session is stuck (worker down, or attestation genuinely failed), not just slow.
const TIMEOUT_MS = 20 * 60 * 1000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface SessionOutcome {
  success: boolean;
  message: string;
}

/**
 * Polls TerraChainGame on Creditcoin for the outcome of a specific session, matched by
 * (player, sessionId) — the same sessionId the player got back from TerraSession on Sepolia.
 * Every session type resolves to exactly one outcome event on-chain (success or a documented
 * rejection), so this never has to guess.
 */
export async function pollSessionOutcome(
  mode: SessionTypeName,
  player: string,
  sessionId: bigint,
  fromBlock: number,
  onTick?: (elapsedMs: number) => void
): Promise<SessionOutcome> {
  const game = getTerraChainGameReadContract();
  const deadline = Date.now() + TIMEOUT_MS;
  const startedAt = Date.now();

  while (Date.now() < deadline) {
    onTick?.(Date.now() - startedAt);

    if (mode === "Bank") {
      const events = await game.queryFilter(game.filters.MetersBanked(player, sessionId), fromBlock);
      if (events.length > 0) {
        const e = events[0] as EventLog;
        return {
          success: true,
          message: `Đã nạp ${e.args.metersAdded}m vào khiên (hiện có ${e.args.newBalance}m trong túi).`,
        };
      }
    } else if (mode === "Claim") {
      const [claimed, rejected] = await Promise.all([
        game.queryFilter(game.filters.BaseClaimed(undefined, player, sessionId), fromBlock),
        game.queryFilter(game.filters.ClaimRejected(player, sessionId), fromBlock),
      ]);
      if (claimed.length > 0) {
        const e = claimed[0] as EventLog;
        return { success: true, message: `Chiếm thành công! Base #${e.args.baseId}.` };
      }
      if (rejected.length > 0) {
        const e = rejected[0] as EventLog;
        return {
          success: false,
          message: `Claim thất bại: ${e.args.reason} — bạn đã mất quãng đường vừa đi, không có gì được tạo ra.`,
        };
      }
    } else {
      const [attacked, missed, rejected] = await Promise.all([
        game.queryFilter(game.filters.BaseAttacked(undefined, player), fromBlock),
        game.queryFilter(game.filters.AttackMissed(player, sessionId), fromBlock),
        game.queryFilter(game.filters.AttackRejected(player, sessionId), fromBlock),
      ]);
      const mine = (attacked as EventLog[]).filter((e) => e.args.sessionId === sessionId);
      if (mine.length > 0) {
        const captured = mine.filter((e) => e.args.captured).length;
        const repelled = mine.length - captured;
        return {
          success: true,
          message: `Tấn công trúng ${mine.length} căn cứ — chiếm được ${captured}, bị đẩy lùi ${repelled}.`,
        };
      }
      if (missed.length > 0) {
        return {
          success: false,
          message: "Không có căn cứ nào trong vòng bạn vừa đi — quãng đường đã mất, không có gì xảy ra.",
        };
      }
      if (rejected.length > 0) {
        const e = rejected[0] as EventLog;
        return { success: false, message: `Tấn công thất bại: ${e.args.reason}.` };
      }
    }

    await sleep(POLL_INTERVAL_MS);
  }

  return {
    success: false,
    message: "Chưa thấy kết quả sau 20 phút — kiểm tra worker relayer có đang chạy không.",
  };
}
