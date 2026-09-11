interface ZoneFabProps {
  onClick: () => void;
}

/** Opens the Sponsored Zone modal — where a business pays CTC to reward foot traffic in an area.
 *  Drawn as a coin, because that is what the button is about; the previous outlined circle-with-$
 *  was indistinguishable from a generic info badge at this size. */
export function ZoneFab({ onClick }: ZoneFabProps) {
  return (
    <button type="button" className="hud-fab zone-fab" onClick={onClick} aria-label="Sponsor a zone">
      <svg width="20" height="20" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <circle cx="12" cy="12" r="8.6" fill="rgba(255,255,255,0.22)" stroke="currentColor" strokeWidth="2.1" />
        <path
          d="M12 6.6 V17.4 M9.1 9.1 C9.1 7.9 10.4 7.3 12 7.3 C13.6 7.3 14.9 7.9 14.9 9.1 C14.9 10.3 13.6 10.9 12 11.6 C10.4 12.3 9.1 12.9 9.1 14.1 C9.1 15.3 10.4 15.9 12 15.9 C13.6 15.9 14.9 15.3 14.9 14.1"
          stroke="currentColor"
          strokeWidth="2"
          fill="none"
          strokeLinecap="round"
        />
      </svg>
    </button>
  );
}
