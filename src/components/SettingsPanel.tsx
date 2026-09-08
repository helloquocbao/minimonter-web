import { useTranslation } from "react-i18next";
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from "../i18n";

interface SettingsPanelProps {
  address: string | null;
  onConnect: () => void;
}

/** Modal content for wallet connect + language — pulled out of the always-visible top bar so
 *  the map/gameplay stays the primary surface. Opened via SettingsFab. */
export function SettingsPanel({ address, onConnect }: SettingsPanelProps) {
  const { t, i18n } = useTranslation();

  return (
    <div className="settings-panel">
      <div className="settings-row">
        <span className="settings-label">{t("settings.wallet")}</span>
        {address ? (
          <span className="wallet-address">
            {address.slice(0, 6)}...{address.slice(-4)}
          </span>
        ) : (
          <button onClick={onConnect}>{t("connectWallet")}</button>
        )}
      </div>

      <div className="settings-row">
        <span className="settings-label">{t("settings.language")}</span>
        <select
          className="lang-switcher"
          value={i18n.language}
          onChange={(e) => i18n.changeLanguage(e.target.value as SupportedLanguage)}
          aria-label="Language"
        >
          {SUPPORTED_LANGUAGES.map((lng) => (
            <option key={lng} value={lng}>
              {t(`lang.${lng}`)}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
