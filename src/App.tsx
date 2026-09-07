import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { WalletBar } from "./components/WalletBar";
import { GameMap } from "./components/GameMap";
import { SessionPanel } from "./components/SessionPanel";
import { useSessionRecorder } from "./hooks/useSessionRecorder";
import { useBases, usePlayerState } from "./hooks/useGameState";
import { connectWallet } from "./lib/web3";
import type { LatLng } from "./lib/geo";

const DEFAULT_CENTER: LatLng = { lat: 21.0278, lng: 105.8342 }; // Hanoi, used until GPS is available

export default function App() {
  const { t } = useTranslation();
  const [address, setAddress] = useState<string | null>(null);
  const [center, setCenter] = useState<LatLng>(DEFAULT_CENTER);

  const recorder = useSessionRecorder();
  const { bases, refresh: refreshBases } = useBases();
  const { cumulativeMeters, loopCapMeters, refresh: refreshPlayer } = usePlayerState(address);

  useEffect(() => {
    if (!("geolocation" in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      (position) => setCenter({ lat: position.coords.latitude, lng: position.coords.longitude }),
      () => {}
    );
  }, []);

  useEffect(() => {
    if (recorder.path.length > 0) setCenter(recorder.path[recorder.path.length - 1]);
  }, [recorder.path]);

  async function handleConnect() {
    const account = await connectWallet();
    setAddress(account);
  }

  function handleRefreshAll() {
    refreshBases();
    refreshPlayer();
  }

  return (
    <div className="app-layout">
      <WalletBar address={address} onConnect={handleConnect} />

      <div className="app-body">
        <div className="map-container">
          <GameMap center={center} bases={bases} currentPath={recorder.path} myAddress={address} />
        </div>

        <div className="side-panels">
          <SessionPanel
            isRecording={recorder.isRecording}
            distanceMeters={recorder.distanceMeters}
            pathLength={recorder.path.length}
            loopCapMeters={loopCapMeters || 1000}
            onStart={recorder.start}
            onStop={recorder.stop}
            onSubmitted={handleRefreshAll}
          />

          <div className="panel">
            <h3>{t("progress.title")}</h3>
            <p>{t("progress.totalDistance", { meters: cumulativeMeters })}</p>
            <p>{t("progress.loopCap", { meters: loopCapMeters || 1000 })}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
