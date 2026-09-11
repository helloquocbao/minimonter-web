import { useTranslation } from "react-i18next";

interface SessionFabProps {
  isRecording: boolean;
  onClick: () => void;
}

/** The primary action button: starts a Claim/Reinforce session, and the only entry point to those
 *  controls — the map stays a full, uncluttered surface otherwise.
 *
 *  Deliberately unlike the other FABs. They are small white circles parked in the corners because
 *  a player touches them rarely; this one is centred at the bottom of the screen, larger, filled
 *  with colour and captioned, because walking a loop is the thing the game is *for*. That is the
 *  casual-game convention — one obvious button under the thumb — and it is also just honest
 *  hierarchy: a new player should not have to hunt for how to play.
 *
 *  Keeps pulsing red while a session records, so the "recording" cue survives closing the modal
 *  to go look at the map. */
export function SessionFab({ isRecording, onClick }: SessionFabProps) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      className={`session-fab ${isRecording ? "is-recording" : ""}`}
      onClick={onClick}
      aria-label={isRecording ? t("session.fabRecording") : t("session.fabStart")}
    >
      {isRecording ? <span className="session-fab-pulse" /> : null}
      <span className="session-fab-inner">
        {isRecording ? (
          // A filled square reads as "stop/recording" at a glance, the way a record indicator does.
          <svg width="22" height="22" viewBox="0 0 22 22" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <rect x="6" y="6" width="10" height="10" rx="2" fill="currentColor" />
          </svg>
        ) : (
          // A walking figure, not an abstract target: it says what the button starts.
          <svg width="26" height="26" viewBox="0 0 26 26" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <circle cx="13.4" cy="4.3" r="2.5" fill="currentColor" />
            <path
              d="M13.6 7.6 L16.8 10.4 L20 11.6 M13.6 7.6 L10.6 10.2 L9 14.2 M13.6 7.6 L13 14.4 L16.4 18.2 L17.6 22.4 M13 14.4 L9.4 17.4 L6.6 21.6"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
        <span className="session-fab-label">{isRecording ? t("session.fabRecording") : t("session.fabStart")}</span>
      </span>
    </button>
  );
}
