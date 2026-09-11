interface SettingsFabProps {
  isConnected: boolean;
  onClick: () => void;
}

/** Opens settings (language + claiming credited rewards). A solid gear rather than a hairline
 *  outline: at 48px over a busy map, a 1.6px stroke dissolves into the streets behind it. */
export function SettingsFab({ isConnected, onClick }: SettingsFabProps) {
  return (
    <button type="button" className="hud-fab settings-fab" onClick={onClick} aria-label="Open settings">
      <svg width="20" height="20" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        {/* One path, two subpaths: the centre circle comes first, so evenodd punches it out as a
            hole instead of filling the gear solid. */}
        <path
          d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm8.94 3a7.97 7.97 0 0 0-.14-1.5l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a8.1 8.1 0 0 0-1.3-.75l-.36-2.54a.5.5 0 0 0-.5-.41h-3.84a.5.5 0 0 0-.5.41l-.36 2.54c-.47.2-.9.45-1.3.75l-2.39-.96a.5.5 0 0 0-.6.22L2.07 7.28a.5.5 0 0 0 .12.64l2.03 1.58A7.97 7.97 0 0 0 4 11c0 .51.05 1.01.14 1.5l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32c.13.22.4.31.6.22l2.39-.96c.4.3.83.55 1.3.75l.36 2.54c.05.24.26.41.5.41h3.84c.24 0 .45-.17.5-.41l.36-2.54c.47-.2.9-.45 1.3-.75l2.39.96c.2.09.47 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58c.09-.49.14-.99.14-1.5Z"
          fill="currentColor"
          fillRule="evenodd"
        />
      </svg>
      {isConnected ? <span className="hud-fab-pip" /> : null}
    </button>
  );
}
