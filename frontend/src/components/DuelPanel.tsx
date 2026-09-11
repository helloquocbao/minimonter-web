import { useState } from "react";
import { useTranslation } from "react-i18next";
import { formatEther, parseEther, isAddress } from "ethers";
import type { DuelInfo } from "../hooks/useGameState";
import { CREDITCOIN_CHAIN_ID } from "../config";
import { getTerraChainGameWriteContract, switchToChain } from "../lib/web3";

interface DuelPanelProps {
  duels: DuelInfo[];
  myAddress: string | null;
  onChanged: () => void;
}

/** Duels: simple, opt-in PvP. Challenge another wallet to a friendly race — whoever's
 *  cumulativeMeters grows more (via completely normal Claim/Reinforce walking) within the
 *  chosen time window wins the pool. No territory or Base is ever at risk. */
export function DuelPanel({ duels, myAddress, onChanged }: DuelPanelProps) {
  const { t } = useTranslation();
  const [opponent, setOpponent] = useState("");
  const [stakeCtc, setStakeCtc] = useState("0");
  const [durationHours, setDurationHours] = useState("24");
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [statusIsError, setStatusIsError] = useState(false);

  const now = Math.floor(Date.now() / 1000);
  const me = myAddress?.toLowerCase();

  async function runTx(label: string, action: (contract: any) => Promise<any>) {
    setSubmitting(true);
    setStatusIsError(false);
    setStatus(label);
    try {
      await switchToChain(CREDITCOIN_CHAIN_ID);
      const contract = await getTerraChainGameWriteContract();
      const tx = await action(contract);
      await tx.wait();
      onChanged();
    } catch (err) {
      setStatus(t("session.errorPrefix", { message: (err as Error).message }));
      setStatusIsError(true);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleChallenge() {
    if (!isAddress(opponent)) {
      setStatus(t("duel.invalidOpponent"));
      setStatusIsError(true);
      return;
    }
    await runTx(t("duel.challenging"), (contract) =>
      contract.challengeDuel(opponent, Math.round(Number(durationHours)), {
        value: parseEther(stakeCtc || "0"),
      })
    );
  }

  async function handleAccept(duel: DuelInfo) {
    await runTx(t("duel.accepting"), (contract) => contract.acceptDuel(duel.id, { value: BigInt(duel.stake) }));
  }

  async function handleCancel(duelId: number) {
    await runTx(t("duel.cancelling"), (contract) => contract.cancelDuel(duelId));
  }

  async function handleSettle(duelId: number) {
    await runTx(t("duel.settling"), (contract) => contract.settleDuel(duelId));
  }

  const pendingIncoming = duels.filter((d) => d.status === "Pending" && d.opponent === me);
  const pendingOutgoing = duels.filter((d) => d.status === "Pending" && d.challenger === me);
  const active = duels.filter((d) => d.status === "Active");
  const settled = duels
    .filter((d) => d.status === "Settled")
    .slice(-5)
    .reverse();

  return (
    <div className="duel-panel">
      <p className="hint">{t("duel.hint")}</p>

      <label className="field-label">{t("duel.opponentLabel")}</label>
      <input type="text" placeholder="0x..." value={opponent} onChange={(e) => setOpponent(e.target.value)} />

      <label className="field-label">{t("duel.stakeLabel")}</label>
      <input type="number" min="0" step="0.01" value={stakeCtc} onChange={(e) => setStakeCtc(e.target.value)} />

      <label className="field-label">{t("duel.durationLabel")}</label>
      <input
        type="number"
        min="1"
        step="1"
        value={durationHours}
        onChange={(e) => setDurationHours(e.target.value)}
      />

      <button onClick={handleChallenge} disabled={submitting}>
        {t("duel.challengeButton")}
      </button>

      {status && <p className={statusIsError ? "error" : "status"}>{status}</p>}

      {pendingIncoming.length > 0 && (
        <div className="duel-list">
          <p className="field-label">{t("duel.incomingTitle")}</p>
          {pendingIncoming.map((d) => (
            <div key={d.id} className="duel-list-item">
              <span>
                #{d.id} — {d.challenger.slice(0, 6)}...{d.challenger.slice(-4)} — {formatEther(d.stake)} CTC —{" "}
                {Math.round(d.durationSeconds / 3600)}h
              </span>
              <button onClick={() => handleAccept(d)} disabled={submitting}>
                {t("duel.acceptButton")}
              </button>
            </div>
          ))}
        </div>
      )}

      {pendingOutgoing.length > 0 && (
        <div className="duel-list">
          <p className="field-label">{t("duel.outgoingTitle")}</p>
          {pendingOutgoing.map((d) => (
            <div key={d.id} className="duel-list-item">
              <span>
                #{d.id} — {t("duel.waitingFor", { opponent: `${d.opponent.slice(0, 6)}...${d.opponent.slice(-4)}` })}
              </span>
              <button onClick={() => handleCancel(d.id)} disabled={submitting}>
                {t("duel.cancelButton")}
              </button>
            </div>
          ))}
        </div>
      )}

      {active.length > 0 && (
        <div className="duel-list">
          <p className="field-label">{t("duel.activeTitle")}</p>
          {active.map((d) => {
            const isChallenger = d.challenger === me;
            const opponentAddress = isChallenger ? d.opponent : d.challenger;
            const canSettle = now >= d.endsAt;
            return (
              <div key={d.id} className="duel-list-item">
                <span>
                  #{d.id} vs {opponentAddress.slice(0, 6)}...{opponentAddress.slice(-4)} —{" "}
                  {canSettle
                    ? t("duel.readyToSettle")
                    : t("duel.timeLeft", { minutes: Math.max(0, Math.ceil((d.endsAt - now) / 60)) })}
                </span>
                {canSettle && (
                  <button onClick={() => handleSettle(d.id)} disabled={submitting}>
                    {t("duel.settleButton")}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {settled.length > 0 && (
        <div className="duel-list">
          <p className="field-label">{t("duel.recentTitle")}</p>
          {settled.map((d) => {
            const won = d.winner === me;
            const tie = d.winner === null;
            return (
              <div key={d.id} className="duel-list-item">
                <span>
                  #{d.id} — {tie ? t("duel.resultTie") : won ? t("duel.resultWon") : t("duel.resultLost")} (
                  {d.challengerMetersWalked}m vs {d.opponentMetersWalked}m)
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
