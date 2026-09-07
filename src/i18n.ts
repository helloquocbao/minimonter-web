import i18n from "i18next";
import { initReactI18next } from "react-i18next";

const resources = {
  en: {
    translation: {
      appTitleFull: "TerraChain: Circle Wars",
      appTitleShort: "TerraChain",
      connectWallet: "Connect Wallet",

      progress: {
        title: "Progress",
        totalDistance: "Total distance walked: {{meters}}m",
        loopCap: "Current per-session cap: {{meters}}m",
      },

      session: {
        title: "Record a session",
        loopCapHint: "Your current per-session distance cap: {{meters}}m (grows the more you walk).",
        modeClaim: "Claim — walk a loop around unclaimed ground to paint your territory",
        modeReinforce: "Reinforce — walk a loop around your own Base to restore 100% territory",
        reinforceHint: "The loop must enclose the center of one of your own Bases — success fully restores territory lost to bot damage.",
        start: "Start moving",
        stop: "Finish ({{meters}}m, {{points}} points)",
        noGps: "Couldn't record any position — try again somewhere with better GPS signal.",
        sendingToSepolia: "Sending transaction to Sepolia...",
        sentWaitingAttestation: "Sent (tx: {{hash}}...). Waiting for Attestcoin Protocol cross-chain attestation...",
        sepoliaNoSessionId: "Sent to Sepolia but couldn't read the sessionId — check manually on the block explorer.",
        waitingOutcome: "Waiting for outcome of session #{{sessionId}}... ({{minutes}} min)",
        recordedWaiting: "Recorded (session #{{sessionId}}). Waiting for Attestcoin Protocol cross-chain attestation — usually takes 8-15 minutes...",
        errorPrefix: "Error: {{message}}",
      },

      outcome: {
        claimSuccess: "Claimed successfully! Base #{{baseId}} — area {{area}}m².",
        claimRejected: "Claim failed: {{reason}} — your walk is lost, nothing was created.",
        reinforceSuccess: "Reinforced successfully! Base #{{baseId}} restored to 100% territory ({{area}}m²).",
        reinforceRejected: "Reinforce failed: {{reason}}.",
        timeout: "No result after 20 minutes — check whether the worker relayer is running.",
      },

      map: {
        baseTooltip: "Base #{{id}} — owner: {{owner}} — territory: {{current}}m² / {{initial}}m² ({{pct}}%)",
      },

      lang: {
        en: "EN",
        vi: "VI",
        ko: "KO",
      },
    },
  },
  vi: {
    translation: {
      appTitleFull: "TerraChain: Circle Wars",
      appTitleShort: "TerraChain",
      connectWallet: "Kết nối Wallet",

      progress: {
        title: "Tiến độ",
        totalDistance: "Tổng quãng đường đã đi: {{meters}}m",
        loopCap: "Giới hạn mỗi lần đi hiện tại: {{meters}}m",
      },

      session: {
        title: "Ghi hành trình",
        loopCapHint: "Giới hạn quãng đường mỗi lần đi hiện tại: {{meters}}m (tăng dần theo tổng km đã đi).",
        modeClaim: "Chiếm đất (Claim) — đi vòng quanh 1 khu chưa ai chiếm để tô màu lãnh thổ",
        modeReinforce: "Gia cố (Reinforce) — đi vòng quanh Base của mình để hồi 100% lãnh thổ",
        reinforceHint: "Vòng đi phải bao quanh tâm 1 Base của chính bạn — thành công sẽ hồi 100% lãnh thổ bị bot phá.",
        start: "Bắt đầu di chuyển",
        stop: "Kết thúc ({{meters}}m, {{points}} điểm)",
        noGps: "Không ghi được vị trí nào — thử lại ở nơi có tín hiệu GPS tốt hơn.",
        sendingToSepolia: "Đang gửi giao dịch lên Sepolia...",
        sentWaitingAttestation: "Đã gửi (tx: {{hash}}...). Đang chờ Attestcoin Protocol xác thực cross-chain...",
        sepoliaNoSessionId: "Đã gửi lên Sepolia nhưng không đọc được sessionId — kiểm tra thủ công trên block explorer.",
        waitingOutcome: "Đang chờ kết quả session #{{sessionId}}... ({{minutes}} phút)",
        recordedWaiting: "Đã ghi nhận (session #{{sessionId}}). Đang chờ Attestcoin Protocol xác thực cross-chain — thường mất 8-15 phút...",
        errorPrefix: "Lỗi: {{message}}",
      },

      outcome: {
        claimSuccess: "Chiếm thành công! Base #{{baseId}} — diện tích {{area}}m².",
        claimRejected: "Claim thất bại: {{reason}} — bạn đã mất quãng đường vừa đi, không có gì được tạo ra.",
        reinforceSuccess: "Gia cố thành công! Base #{{baseId}} đã hồi phục 100% lãnh thổ ({{area}}m²).",
        reinforceRejected: "Gia cố thất bại: {{reason}}.",
        timeout: "Chưa thấy kết quả sau 20 phút — kiểm tra worker relayer có đang chạy không.",
      },

      map: {
        baseTooltip: "Base #{{id}} — chủ: {{owner}} — lãnh thổ: {{current}}m² / {{initial}}m² ({{pct}}%)",
      },

      lang: {
        en: "EN",
        vi: "VI",
        ko: "KO",
      },
    },
  },
  ko: {
    translation: {
      appTitleFull: "TerraChain: Circle Wars",
      appTitleShort: "TerraChain",
      connectWallet: "지갑 연결",

      progress: {
        title: "진행 상황",
        totalDistance: "총 이동 거리: {{meters}}m",
        loopCap: "현재 1회 이동 제한: {{meters}}m",
      },

      session: {
        title: "이동 기록",
        loopCapHint: "현재 1회 이동 거리 제한: {{meters}}m (누적 거리가 늘어날수록 증가합니다).",
        modeClaim: "점령 (Claim) — 아직 아무도 점령하지 않은 구역을 한 바퀴 돌아 영토로 만듭니다",
        modeReinforce: "보강 (Reinforce) — 자신의 Base를 한 바퀴 돌아 영토를 100% 복구합니다",
        reinforceHint: "이동 경로는 자신의 Base 중심을 둘러싸야 합니다 — 성공하면 봇 공격으로 잃은 영토가 100% 복구됩니다.",
        start: "이동 시작",
        stop: "종료 ({{meters}}m, {{points}}개 지점)",
        noGps: "위치를 기록할 수 없습니다 — GPS 신호가 더 좋은 곳에서 다시 시도해 주세요.",
        sendingToSepolia: "Sepolia에 트랜잭션을 전송 중입니다...",
        sentWaitingAttestation: "전송 완료 (tx: {{hash}}...). Attestcoin Protocol 크로스체인 검증을 기다리는 중...",
        sepoliaNoSessionId: "Sepolia에는 전송되었지만 sessionId를 읽을 수 없습니다 — 블록 익스플로러에서 직접 확인하세요.",
        waitingOutcome: "세션 #{{sessionId}} 결과 대기 중... ({{minutes}}분)",
        recordedWaiting: "기록됨 (세션 #{{sessionId}}). Attestcoin Protocol 크로스체인 검증 대기 중 — 보통 8-15분 정도 걸립니다...",
        errorPrefix: "오류: {{message}}",
      },

      outcome: {
        claimSuccess: "점령 성공! Base #{{baseId}} — 면적 {{area}}m².",
        claimRejected: "점령 실패: {{reason}} — 방금 이동한 거리는 소실되었으며, 아무것도 생성되지 않았습니다.",
        reinforceSuccess: "보강 성공! Base #{{baseId}}의 영토가 100% 복구되었습니다 ({{area}}m²).",
        reinforceRejected: "보강 실패: {{reason}}.",
        timeout: "20분이 지나도 결과가 없습니다 — worker relayer가 실행 중인지 확인하세요.",
      },

      map: {
        baseTooltip: "Base #{{id}} — 소유자: {{owner}} — 영토: {{current}}m² / {{initial}}m² ({{pct}}%)",
      },

      lang: {
        en: "EN",
        vi: "VI",
        ko: "KO",
      },
    },
  },
} as const;

const STORAGE_KEY = "terrachain_lang";

function detectInitialLanguage(): string {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored && stored in resources) return stored;

  const browserLang = navigator.language.slice(0, 2);
  if (browserLang in resources) return browserLang;

  return "en";
}

i18n.use(initReactI18next).init({
  resources,
  lng: detectInitialLanguage(),
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

i18n.on("languageChanged", (lng) => {
  localStorage.setItem(STORAGE_KEY, lng);
});

export default i18n;
export const SUPPORTED_LANGUAGES = ["en", "vi", "ko"] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];
