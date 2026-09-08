import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { GameMap } from "./components/GameMap";
import { SessionPanel } from "./components/SessionPanel";
import { SessionFab } from "./components/SessionFab";
import { SettingsFab } from "./components/SettingsFab";
import { SettingsPanel } from "./components/SettingsPanel";
import { ZoneFab } from "./components/ZoneFab";
import { ZonePanel } from "./components/ZonePanel";
import { DuelFab } from "./components/DuelFab";
import { DuelPanel } from "./components/DuelPanel";
import { Joystick } from "./components/Joystick";
import { Modal } from "./components/Modal";
import { useSessionRecorder } from "./hooks/useSessionRecorder";
import { useBases, usePlayerState, useZones, useDuels } from "./hooks/useGameState";
import { useJoystickMovement } from "./lib/joystickMovement";
import { connectWallet } from "./lib/web3";
import type { LatLng } from "./lib/geo";

const DEFAULT_CENTER: LatLng = { lat: 21.0278, lng: 105.8342 }; // Hanoi, used until GPS is available

export default function App() {
  const { t } = useTranslation();
  const [address, setAddress] = useState<string | null>(null);
  const [center, setCenter] = useState<LatLng>(DEFAULT_CENTER);
  const [sessionModalOpen, setSessionModalOpen] = useState(false);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [zoneModalOpen, setZoneModalOpen] = useState(false);
  const [duelModalOpen, setDuelModalOpen] = useState(false);

  const recorder = useSessionRecorder();
  const { bases, refresh: refreshBases } = useBases();
  const { zones, refresh: refreshZones } = useZones();
  const { duels, refresh: refreshDuels } = useDuels(address);
  const { loopCapMeters, refresh: refreshPlayer } = usePlayerState(address);

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

  // Virtual joystick: drives `center` continuously while held, and — while a session is
  // actively recording — also feeds each simulated step into the recorder exactly like a real
  // GPS fix would, so the player can walk a loop without physically moving.
  const handleJoystickMove = useCallback(
    (next: LatLng) => {
      setCenter(next);
      recorder.pushManualPosition(next);
    },
    [recorder]
  );
  const { setDirection } = useJoystickMovement(center, handleJoystickMove);

  async function handleConnect() {
    const account = await connectWallet();
    setAddress(account);
  }

  function handleRefreshAll() {
    refreshBases();
    refreshPlayer();
    refreshZones();
    refreshDuels();
  }

  const hasActiveDuel = duels.some((d) => d.status === "Active");

  return (
    <div className="app-layout">
      <div className="app-body">
        <div className="map-container">
          <GameMap
            center={center}
            bases={bases}
            zones={zones}
            currentPath={recorder.path}
            myAddress={address}
          />
        </div>

        <SettingsFab isConnected={!!address} onClick={() => setSettingsModalOpen(true)} />
        <ZoneFab onClick={() => setZoneModalOpen(true)} />
        <DuelFab hasActiveDuel={hasActiveDuel} onClick={() => setDuelModalOpen(true)} />
        <SessionFab isRecording={recorder.isRecording} onClick={() => setSessionModalOpen(true)} />

        {/* Dev/local-only: lets you simulate walking without physically moving, for testing
            Claim/Reinforce loops at a desk. Never present in a production build — gated by
            Vite's import.meta.env.DEV, which is statically false (and dead-code-eliminated) in
            `npm run build`. Real gameplay always requires an actual GPS-tracked walk. */}
        {import.meta.env.DEV && (
          <div className="joystick-container">
            <Joystick onChange={setDirection} />
          </div>
        )}

        {settingsModalOpen && (
          <Modal title={t("settings.title")} onClose={() => setSettingsModalOpen(false)}>
            <SettingsPanel address={address} onConnect={handleConnect} />
          </Modal>
        )}

        {zoneModalOpen && (
          <Modal title={t("zone.title")} onClose={() => setZoneModalOpen(false)}>
            <ZonePanel center={center} zones={zones} myAddress={address} onCreated={handleRefreshAll} />
          </Modal>
        )}

        {duelModalOpen && (
          <Modal title={t("duel.title")} onClose={() => setDuelModalOpen(false)}>
            <DuelPanel duels={duels} myAddress={address} onChanged={handleRefreshAll} />
          </Modal>
        )}

        {sessionModalOpen && (
          <Modal title={t("session.title")} onClose={() => setSessionModalOpen(false)}>
            <SessionPanel
              isRecording={recorder.isRecording}
              distanceMeters={recorder.distanceMeters}
              pathLength={recorder.path.length}
              loopCapMeters={loopCapMeters || 1000}
              bases={bases}
              myAddress={address}
              onStart={recorder.start}
              onStarted={() => setSessionModalOpen(false)}
              onStop={recorder.stop}
              onSubmitted={handleRefreshAll}
            />
          </Modal>
        )}
      </div>
    </div>
  );
}
