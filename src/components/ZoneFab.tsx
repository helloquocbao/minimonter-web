interface ZoneFabProps {
  onClick: () => void;
}

/** Opens the Sponsored Zone modal — where a local business can pay CTC to reward foot traffic
 *  in an area. Placed opposite the settings FAB (top-left) so it doesn't compete with the
 *  primary session FAB for thumb reach. */
export function ZoneFab({ onClick }: ZoneFabProps) {
  return (
    <button type="button" className="zone-fab" onClick={onClick} aria-label="Sponsor a zone">
      <svg width="20" height="20" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path
          d="M12 7 L12 17 M8.5 9.3 C8.5 8 10 7.2 12 7.2 C14 7.2 15.3 8 15.3 9.3 C15.3 10.6 14 11.2 12 12 C10 12.8 8.7 13.4 8.7 14.7 C8.7 16 10 16.8 12 16.8 C14 16.8 15.5 16 15.5 14.7"
          stroke="currentColor"
          strokeWidth="1.4"
          fill="none"
          strokeLinecap="round"
        />
      </svg>
    </button>
  );
}
