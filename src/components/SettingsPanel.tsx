import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatEther } from "ethers";
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from "../i18n";
import { CREDITCOIN_CHAIN_ID } from "../config";
import {
  getTerraChainGameReadContract,
  getTerraChainGameWriteContract,
  switchToChain,
} from "../lib/web3";

interface SettingsPanelProps {
  address: string | null;
  onConnect: () => void;
}

/** Modal content for wallet connect + language — pulled out of the always-visible top bar so
 *  the map/gameplay stays the primary surface. Also surfaces any pending (credited) payouts:
 *  the contract falls back to crediting a reward when a direct transfer fails, so there has to
 *  be a way for the player to actually claim it, otherwise "not lost" would still mean
 *  "unreachable" in practice. */
export function SettingsPanel({ address, onConnect }: SettingsPanelProps) {
  const { t, i18n } = useTranslation();
  const [pending, setPending] = useState<bigint>(0n);
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [statusIsError, setStatusIsError] = useState(false);

  const refreshPending = useCallback(async () => {
    if (!address) {
      setPending(0n);
      return;
    }
    try {
      const game = getTerraChainGameReadContract();
      setPending(await game.pendingPayouts(address));
    } catch {
      // A read failure here is cosmetic — leave the last known value alone.
    }
  }, [address]);

  useEffect(() => {
    refreshPending();
  }, [refreshPending]);

  async function handleWithdraw() {
    setSubmitting(true);
    setStatusIsError(false);
    setStatus(t("settings.withdrawing"));
    try {
      await switchToChain(CREDITCOIN_CHAIN_ID);
      const contract = await getTerraChainGameWriteContract();
      const tx = await contract.withdrawPendingPayout();
      await tx.wait();
      setStatus(t("settings.withdrawn"));
      await refreshPending();
    } catch (err) {
      setStatus(t("session.errorPrefix", { message: (err as Error).message }));
      setStatusIsError(true);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="settings-panel">
      <div className="settings-row">
        <span className="settings-label">{t("settings.wallet")}</span>
        {address ? (
          <span className="wallet-address">
            {address.slice(0, 6)}...{address.slice(-4)}
          </span>
        ) : (
          <button onClick={onConnect}>{t("connectWallet")}</button>
        )}
      </div>

      <div className="settings-row">
        <span className="settings-label">{t("settings.language")}</span>
        <select
          className="lang-switcher"
          value={i18n.language}
          onChange={(e) => i18n.changeLanguage(e.target.value as SupportedLanguage)}
          aria-label="Language"
        >
          {SUPPORTED_LANGUAGES.map((lng) => (
            <option key={lng} value={lng}>
              {t(`lang.${lng}`)}
            </option>
          ))}
        </select>
      </div>

      {pending > 0n && (
        <>
          <div className="settings-row">
            <span className="settings-label">{t("settings.pendingPayout")}</span>
            <span className="wallet-address">{formatEther(pending)} CTC</span>
          </div>
          <p className="hint">{t("settings.pendingPayoutHint")}</p>
          <button onClick={handleWithdraw} disabled={submitting}>
            {t("settings.withdrawButton")}
          </button>
        </>
      )}

      {status && <p className={statusIsError ? "error" : "status"}>{status}</p>}
    </div>
  );
}
