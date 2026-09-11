import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatEther } from "ethers";
import { getCreditcoinReadProvider } from "../lib/web3";
import type { BaseInfo } from "../hooks/useGameState";

interface ProfilePanelProps {
  address: string | null;
  bases: BaseInfo[];
  cumulativeMeters: number;
  loopCapMeters: number;
  onConnect: () => void;
}

/// Mirrors the km-cap progression in TerraChainGame.sol (METERS_PER_LEVEL, MAX_LOOP_CAP_LEVELS).
/// Only used to show how far the player is from their next cap increase — the cap itself comes
/// from the chain via the indexer, so these constants never decide anything.
const METERS_PER_LEVEL = 5_000;
const MAX_LOOP_CAP_LEVELS = 10;

function formatKm(meters: number): string {
  return `${(meters / 1000).toFixed(2)} km`;
}

/** The player's own numbers in one place: wallet, spendable CTC, territory held, and walking
 *  progress.
 *
 *  Note on "distance remaining": nothing in the game depletes. The per-session cap is a ceiling on
 *  how far one Claim/Reinforce loop may be, and it only ever grows — so this shows the ceiling
 *  itself alongside how much further the player has to walk to raise it, which is the question
 *  "how much have I got left?" actually means here. */
export function ProfilePanel({ address, bases, cumulativeMeters, loopCapMeters, onConnect }: ProfilePanelProps) {
  const { t } = useTranslation();
  const [balance, setBalance] = useState<bigint | null>(null);

  const refreshBalance = useCallback(async () => {
    if (!address) {
      setBalance(null);
      return;
    }
    try {
      setBalance(await getCreditcoinReadProvider().getBalance(address));
    } catch {
      // A balance read failure is cosmetic — show a dash rather than an error state.
      setBalance(null);
    }
  }, [address]);

  useEffect(() => {
    refreshBalance();
  }, [refreshBalance]);

  if (!address) {
    return (
      <div className="profile-panel">
        <p className="hint">{t("profile.connectHint")}</p>
        <button onClick={onConnect}>{t("connectWallet")}</button>
      </div>
    );
  }

  const myBases = bases.filter((base) => base.owner.toLowerCase() === address.toLowerCase());
  const myArea = myBases.reduce((total, base) => total + base.currentAreaMeters, 0);

  const level = Math.min(Math.floor(cumulativeMeters / METERS_PER_LEVEL), MAX_LOOP_CAP_LEVELS);
  const atMaxLevel = level >= MAX_LOOP_CAP_LEVELS;
  const metersToNextLevel = atMaxLevel ? 0 : METERS_PER_LEVEL - (cumulativeMeters % METERS_PER_LEVEL);

  return (
    <div className="profile-panel">
      <div className="profile-wallet">
        <span className="field-label">{t("profile.wallet")}</span>
        <code>{`${address.slice(0, 6)}...${address.slice(-4)}`}</code>
      </div>

      <div className="profile-stats">
        <div className="profile-stat">
          <span className="profile-stat-value">{balance === null ? "—" : Number(formatEther(balance)).toFixed(2)}</span>
          <span className="profile-stat-label">{t("profile.balance")}</span>
        </div>
        <div className="profile-stat">
          <span className="profile-stat-value">{myBases.length}</span>
          <span className="profile-stat-label">{t("profile.bases")}</span>
        </div>
        <div className="profile-stat">
          <span className="profile-stat-value">{loopCapMeters}m</span>
          <span className="profile-stat-label">{t("profile.loopCap")}</span>
        </div>
      </div>

      <p className="hint">{t("profile.loopCapHint")}</p>

      <div className="profile-progress">
        <div className="profile-progress-head">
          <span className="field-label">
            {t("profile.level", { level, max: MAX_LOOP_CAP_LEVELS })}
          </span>
          <span className="profile-stat-label">{formatKm(cumulativeMeters)} {t("profile.walkedTotal")}</span>
        </div>
        <div className="profile-progress-track">
          <div
            className="profile-progress-fill"
            style={{
              width: `${atMaxLevel ? 100 : ((cumulativeMeters % METERS_PER_LEVEL) / METERS_PER_LEVEL) * 100}%`,
            }}
          />
        </div>
        <p className="hint">
          {atMaxLevel
            ? t("profile.capMaxed")
            : t("profile.toNextLevel", { meters: metersToNextLevel })}
        </p>
      </div>

      {myBases.length > 0 && <p className="hint">{t("profile.territory", { area: myArea })}</p>}
    </div>
  );
}
