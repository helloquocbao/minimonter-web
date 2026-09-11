interface ProfileFabProps {
  isConnected: boolean;
  onClick: () => void;
}

/** Opens the player's profile: wallet, CTC balance, Bases owned and walking progress. Sits at the
 *  top of the FAB stack because "how am I doing" is the question a player asks most often after
 *  "how do I play" — which is the session button's job. */
export function ProfileFab({ isConnected, onClick }: ProfileFabProps) {
  return (
    <button type="button" className="hud-fab profile-fab" onClick={onClick} aria-label="Open profile">
      <svg width="20" height="20" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <circle cx="12" cy="8.2" r="3.9" fill="currentColor" />
        {/* Shoulders as a capped arc rather than a full ellipse, so the bust reads at small size. */}
        <path d="M4.2 20.4 C4.2 16.1 7.7 13.6 12 13.6 C16.3 13.6 19.8 16.1 19.8 20.4 Z" fill="currentColor" />
      </svg>
      {isConnected ? <span className="hud-fab-pip" /> : null}
    </button>
  );
}
