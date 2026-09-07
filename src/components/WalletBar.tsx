import { useTranslation } from "react-i18next";
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from "../i18n";

interface WalletBarProps {
  address: string | null;
  onConnect: () => void;
}

export function WalletBar({ address, onConnect }: WalletBarProps) {
  const { t, i18n } = useTranslation();

  return (
    <div className="wallet-bar">
      <strong>
        <span className="app-title-full">{t("appTitleFull")}</span>
        <span className="app-title-short">{t("appTitleShort")}</span>
      </strong>

      <div className="wallet-bar-right">
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

        {address ? (
          <span className="wallet-address">
            {address.slice(0, 6)}...{address.slice(-4)}
          </span>
        ) : (
          <button onClick={onConnect}>{t("connectWallet")}</button>
        )}
      </div>
    </div>
  );
}
