import { useState } from "react";
import { useTranslation } from "react-i18next";
import { formatEther, parseEther } from "ethers";
import type { LatLng } from "../lib/geo";
import { toMicroDegrees } from "../lib/geo";
import type { ZoneInfo } from "../hooks/useGameState";
import { CREDITCOIN_CHAIN_ID } from "../config";
import { getTerraChainGameWriteContract, switchToChain } from "../lib/web3";

interface ZonePanelProps {
  center: LatLng;
  zones: ZoneInfo[];
  myAddress: string | null;
  onCreated: () => void;
}

/** Mirrors MIN_ZONE_POOL in TerraChainGame.sol — validated client-side too so the player gets an
 *  instant, readable error instead of paying gas for a guaranteed revert. */
const MIN_ZONE_POOL_CTC = 200;

/** Mirrors MAX_ZONE_NAME_BYTES in TerraChainGame.sol. The contract counts UTF-8 *bytes*, not
 *  characters, so a Vietnamese or Korean name hits the cap sooner than its length suggests —
 *  measured the same way here so the sponsor sees the real budget before paying gas. */
const MAX_ZONE_NAME_BYTES = 32;

function nameByteLength(name: string): number {
  return new TextEncoder().encode(name).length;
}

/** Sponsored Zones let a local business pay native CTC to reward real foot traffic (any
 *  Claim/Reinforce session landing inside the zone) — the DePIN monetization layer: real-world
 *  GPS activity becomes something a business will actually pay for. */
export function ZonePanel({ center, zones, myAddress, onCreated }: ZonePanelProps) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [poolCtc, setPoolCtc] = useState(String(MIN_ZONE_POOL_CTC));
  const [radiusMeters, setRadiusMeters] = useState("500");
  const [durationDays, setDurationDays] = useState("7");
  const [expectedSessions, setExpectedSessions] = useState("20");
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [statusIsError, setStatusIsError] = useState(false);

  const now = Math.floor(Date.now() / 1000);
  const activeZones = zones.filter((z) => !z.withdrawn && z.endsAt > now);
  const myZones = zones.filter((z) => myAddress && z.sponsor.toLowerCase() === myAddress.toLowerCase());

  async function handleCreate() {
    const trimmedName = name.trim();
    const nameBytes = nameByteLength(trimmedName);
    if (nameBytes === 0) {
      setStatus(t("zone.nameRequired"));
      setStatusIsError(true);
      return;
    }
    if (nameBytes > MAX_ZONE_NAME_BYTES) {
      setStatus(t("zone.nameTooLong", { used: nameBytes, max: MAX_ZONE_NAME_BYTES }));
      setStatusIsError(true);
      return;
    }
    if (!(Number(poolCtc) >= MIN_ZONE_POOL_CTC)) {
      setStatus(t("zone.poolTooSmall", { min: MIN_ZONE_POOL_CTC }));
      setStatusIsError(true);
      return;
    }
    setSubmitting(true);
    setStatusIsError(false);
    setStatus(t("zone.creating"));
    try {
      await switchToChain(CREDITCOIN_CHAIN_ID);
      const contract = await getTerraChainGameWriteContract();

      const tx = await contract.createSponsoredZone(
        toMicroDegrees(center.lat),
        toMicroDegrees(center.lng),
        Math.round(Number(radiusMeters)),
        Math.round(Number(durationDays)),
        Math.round(Number(expectedSessions)),
        trimmedName,
        { value: parseEther(poolCtc) }
      );
      setStatus(t("zone.waitingTx", { hash: tx.hash.slice(0, 10) }));
      await tx.wait();
      setStatus(t("zone.created"));
      onCreated();
    } catch (err) {
      setStatus(t("session.errorPrefix", { message: (err as Error).message }));
      setStatusIsError(true);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleWithdraw(zoneId: number) {
    setSubmitting(true);
    setStatusIsError(false);
    setStatus(t("zone.withdrawing"));
    try {
      await switchToChain(CREDITCOIN_CHAIN_ID);
      const contract = await getTerraChainGameWriteContract();
      const tx = await contract.withdrawUnusedPool(zoneId);
      await tx.wait();
      setStatus(t("zone.withdrawn"));
      onCreated();
    } catch (err) {
      setStatus(t("session.errorPrefix", { message: (err as Error).message }));
      setStatusIsError(true);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="zone-panel">
      <p className="hint">{t("zone.hint")}</p>

      <label className="field-label">{t("zone.nameLabel")}</label>
      <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
      <p className="hint">
        {t("zone.nameBudget", { used: nameByteLength(name.trim()), max: MAX_ZONE_NAME_BYTES })}
      </p>

      <label className="field-label">{t("zone.poolLabel", { min: MIN_ZONE_POOL_CTC })}</label>
      <input
        type="number"
        min={MIN_ZONE_POOL_CTC}
        step="1"
        value={poolCtc}
        onChange={(e) => setPoolCtc(e.target.value)}
      />

      <label className="field-label">{t("zone.radiusLabel")}</label>
      <input
        type="number"
        min="1"
        max="2000"
        step="1"
        value={radiusMeters}
        onChange={(e) => setRadiusMeters(e.target.value)}
      />

      <label className="field-label">{t("zone.durationLabel")}</label>
      <input type="number" min="1" step="1" value={durationDays} onChange={(e) => setDurationDays(e.target.value)} />

      <label className="field-label">{t("zone.sessionsLabel")}</label>
      <input
        type="number"
        min="1"
        step="1"
        value={expectedSessions}
        onChange={(e) => setExpectedSessions(e.target.value)}
      />

      <p className="hint">{t("zone.centeredHint", { lat: center.lat.toFixed(5), lng: center.lng.toFixed(5) })}</p>

      <button onClick={handleCreate} disabled={submitting}>
        {t("zone.createButton")}
      </button>

      {status && <p className={statusIsError ? "error" : "status"}>{status}</p>}

      {myZones.length > 0 && (
        <div className="zone-list">
          <p className="field-label">{t("zone.myZonesTitle")}</p>
          {myZones.map((z) => {
            const expired = z.endsAt <= now;
            return (
              <div key={z.id} className="zone-list-item">
                <span>
                  {z.name} — {formatEther(z.remainingPool)} / {formatEther(z.totalPool)} CTC — {z.sessionsPaid}/
                  {z.expectedSessions}
                </span>
                {expired && !z.withdrawn && (
                  <button onClick={() => handleWithdraw(z.id)} disabled={submitting}>
                    {t("zone.withdrawButton")}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <p className="hint">{t("zone.activeCount", { count: activeZones.length })}</p>
    </div>
  );
}
