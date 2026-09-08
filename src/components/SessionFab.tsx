interface SessionFabProps {
  isRecording: boolean;
  onClick: () => void;
}

/** Floating action button that opens the session modal. Only entry point to Claim/Reinforce
 *  controls — the map stays the full, uncluttered surface otherwise. Pulses while a session is
 *  actively being recorded so the player still has a persistent "recording" cue after closing
 *  the modal to go look at the map/path. */
export function SessionFab({ isRecording, onClick }: SessionFabProps) {
  return (
    <button
      type="button"
      className={`session-fab ${isRecording ? "is-recording" : ""}`}
      onClick={onClick}
      aria-label="Open session controls"
    >
      {isRecording ? (
        <span className="session-fab-pulse" />
      ) : null}
      <svg width="26" height="26" viewBox="0 0 26 26" xmlns="http://www.w3.org/2000/svg">
        <circle cx="13" cy="13" r="10.5" fill="none" stroke="currentColor" strokeWidth="2" />
        <circle cx="13" cy="13" r="3.2" fill="currentColor" />
      </svg>
    </button>
  );
}
