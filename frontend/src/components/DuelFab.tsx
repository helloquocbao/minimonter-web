interface DuelFabProps {
  onClick: () => void;
  hasActiveDuel: boolean;
}

/** Opens the Duel modal — challenge another player to a friendly walking race.
 *
 *  The swords are drawn as solid shapes with a crossguard, grip and pommel. The old version was
 *  six thin strokes, which at this size collapsed into what looked like a stray ">>" chevron —
 *  the icon has to be readable as *swords* for the button to say "player versus player".
 *
 *  A pulsing pip marks at least one Active duel, so the player remembers to keep walking. */
export function DuelFab({ onClick, hasActiveDuel }: DuelFabProps) {
  const sword = (
    <>
      {/* Tapered blade, from tip down to the crossguard. */}
      <path d="M12 2.4 L13.5 5.6 L13.5 14 L10.5 14 L10.5 5.6 Z" fill="currentColor" />
      <rect x="8.1" y="14" width="7.8" height="1.9" rx="0.7" fill="currentColor" />
      <rect x="11.1" y="15.9" width="1.8" height="3.9" rx="0.7" fill="currentColor" />
      <circle cx="12" cy="20.5" r="1.3" fill="currentColor" />
    </>
  );
  return (
    <button
      type="button"
      className="hud-fab duel-fab"
      onClick={onClick}
      aria-label="Duel another player"
    >
      <svg width="20" height="20" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <g transform="rotate(45 12 12)">{sword}</g>
        <g transform="rotate(-45 12 12)">{sword}</g>
      </svg>
      {hasActiveDuel ? <span className="hud-fab-pip is-alert" /> : null}
    </button>
  );
}
