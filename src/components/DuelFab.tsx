interface DuelFabProps {
  onClick: () => void;
  hasActiveDuel: boolean;
}

/** Opens the Duel modal — challenge another player to a friendly walking race. Highlighted
 *  (red-tinted, like the session FAB's recording state) when the player has at least one
 *  Active duel running, so they remember to keep walking. */
export function DuelFab({ onClick, hasActiveDuel }: DuelFabProps) {
  return (
    <button
      type="button"
      className={`duel-fab ${hasActiveDuel ? "is-active" : ""}`}
      onClick={onClick}
      aria-label="Duel another player"
    >
      <svg width="20" height="20" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        {/* Two crossed swords — simple PvP glyph */}
        <path
          d="M4 20 L14 10 M14 10 L11 7 M14 10 L17 13 M4 4 L14 14 M14 14 L11 17 M14 14 L17 11"
          stroke="currentColor"
          strokeWidth="1.6"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
