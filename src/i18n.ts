import i18n from "i18next";
import { initReactI18next } from "react-i18next";

const resources = {
  en: {
    translation: {
      appTitleFull: "MiniMonster Terra",
      appTitleShort: "MiniMonster",
      connectWallet: "Connect Wallet",

      settings: {
        title: "Settings",
        wallet: "Wallet",
        language: "Language",
      },

      session: {
        title: "Record a session",
        loopCapHint: "Your current per-session distance cap: {{meters}}m (grows the more you walk).",
        modeClaimShort: "Claim",
        modeReinforceShort: "Reinforce",
        start: "Start moving",
        stop: "Finish ({{meters}}m, {{points}} points)",
        noGps: "Couldn't record any position — try again somewhere with better GPS signal.",
        loopNotClosed: "This walk didn't loop back to where you started — it can't become territory. Retry and make sure to return close to your starting point.",
        loopTooSimple: "This walk didn't cover enough distinct ground to form a shape. Retry with a wider loop.",
        retry: "Retry (discard this walk)",
        sendingToSepolia: "Sending {{mode}} to Sepolia...",
        sentWaitingAttestation: "Sent (tx: {{hash}}...). Waiting for Attestcoin Protocol cross-chain attestation...",
        sepoliaNoSessionId: "Sent to Sepolia but couldn't read the sessionId — check manually on the block explorer.",
        waitingOutcome: "Waiting for outcome of session #{{sessionId}}... ({{minutes}} min)",
        recordedWaiting: "Recorded (session #{{sessionId}}). Waiting for Attestcoin Protocol cross-chain attestation — usually takes 8-15 minutes...",
        errorPrefix: "Error: {{message}}",
      },

      outcome: {
        claimSuccess: "Claimed successfully! Base #{{baseId}} — area {{area}}m².",
        claimExtended: "Extended your own Base #{{baseId}}! New total area {{area}}m².",
        claimRejected: "Claim failed: {{reason}} — your walk is lost, nothing was created.",
        reinforceSuccess: "Reinforced successfully! Base #{{baseId}} restored to 100% territory ({{area}}m²).",
        reinforceRejected: "Reinforce failed: {{reason}}.",
        timeout: "No result after 20 minutes — check whether the worker relayer is running.",
      },

      map: {
        baseTooltip: "Base #{{id}} — owner: {{owner}} — territory: {{current}}m² / {{initial}}m² ({{pct}}%)",
        zoneTooltip: "Sponsored Zone #{{id}} — pool {{remaining}}/{{total}} CTC — {{paid}}/{{expected}} sessions paid",
        zoneLabel: "$ #{{id}}",
      },

      zone: {
        title: "Sponsor a Zone",
        hint: "Pay CTC to reward real foot traffic — anyone who Claims or Reinforces a Base inside this zone earns a share of the pool while it's active.",
        poolLabel: "Pool amount (CTC)",
        radiusLabel: "Zone radius (meters)",
        durationLabel: "Duration (days)",
        sessionsLabel: "Expected sessions (pool is split evenly across this many payouts)",
        centeredHint: "Zone will be centered on your current position ({{lat}}, {{lng}}).",
        createButton: "Create zone",
        creating: "Creating zone...",
        waitingTx: "Sent (tx: {{hash}}...). Waiting for confirmation...",
        created: "Zone created! It's now active on the map.",
        withdrawing: "Withdrawing unused pool...",
        withdrawn: "Unused pool returned to your wallet.",
        withdrawButton: "Withdraw unused pool",
        myZonesTitle: "Your zones",
        activeCount: "{{count}} active zone(s) on the map right now.",
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
      appTitleFull: "MiniMonster Terra",
      appTitleShort: "MiniMonster",
      connectWallet: "Kết nối Wallet",

      settings: {
        title: "Cài đặt",
        wallet: "Wallet",
        language: "Ngôn ngữ",
      },

      session: {
        title: "Ghi hành trình",
        loopCapHint: "Giới hạn quãng đường mỗi lần đi hiện tại: {{meters}}m (tăng dần theo tổng km đã đi).",
        modeClaimShort: "Chiếm đất",
        modeReinforceShort: "Gia cố",
        start: "Bắt đầu di chuyển",
        stop: "Kết thúc ({{meters}}m, {{points}} điểm)",
        noGps: "Không ghi được vị trí nào — thử lại ở nơi có tín hiệu GPS tốt hơn.",
        loopNotClosed: "Đường đi này chưa khép lại về điểm bắt đầu — không thể trở thành lãnh thổ. Hãy thử lại và nhớ đi vòng về gần điểm xuất phát.",
        loopTooSimple: "Đường đi này chưa đủ rộng để tạo thành một hình dạng. Hãy thử lại với vòng đi rộng hơn.",
        retry: "Thử lại (bỏ đường đi này)",
        sendingToSepolia: "Đang gửi {{mode}} lên Sepolia...",
        sentWaitingAttestation: "Đã gửi (tx: {{hash}}...). Đang chờ Attestcoin Protocol xác thực cross-chain...",
        sepoliaNoSessionId: "Đã gửi lên Sepolia nhưng không đọc được sessionId — kiểm tra thủ công trên block explorer.",
        waitingOutcome: "Đang chờ kết quả session #{{sessionId}}... ({{minutes}} phút)",
        recordedWaiting: "Đã ghi nhận (session #{{sessionId}}). Đang chờ Attestcoin Protocol xác thực cross-chain — thường mất 8-15 phút...",
        errorPrefix: "Lỗi: {{message}}",
      },

      outcome: {
        claimSuccess: "Chiếm thành công! Base #{{baseId}} — diện tích {{area}}m².",
        claimExtended: "Đã mở rộng Base #{{baseId}} của bạn! Tổng diện tích mới {{area}}m².",
        claimRejected: "Claim thất bại: {{reason}} — bạn đã mất quãng đường vừa đi, không có gì được tạo ra.",
        reinforceSuccess: "Gia cố thành công! Base #{{baseId}} đã hồi phục 100% lãnh thổ ({{area}}m²).",
        reinforceRejected: "Gia cố thất bại: {{reason}}.",
        timeout: "Chưa thấy kết quả sau 20 phút — kiểm tra worker relayer có đang chạy không.",
      },

      map: {
        baseTooltip: "Base #{{id}} — chủ: {{owner}} — lãnh thổ: {{current}}m² / {{initial}}m² ({{pct}}%)",
        zoneTooltip: "Khu Sponsor #{{id}} — pool {{remaining}}/{{total}} CTC — đã trả {{paid}}/{{expected}} lượt",
        zoneLabel: "$ #{{id}}",
      },

      zone: {
        title: "Sponsor một khu vực",
        hint: "Trả CTC để thưởng cho lượt đi thật — ai Claim hoặc Reinforce một Base trong khu này sẽ nhận được một phần pool trong thời gian khu còn hoạt động.",
        poolLabel: "Số CTC trong pool",
        radiusLabel: "Bán kính khu (mét)",
        durationLabel: "Thời hạn (ngày)",
        sessionsLabel: "Số lượt dự kiến (pool chia đều cho số lượt này)",
        centeredHint: "Khu vực sẽ đặt tại vị trí hiện tại của bạn ({{lat}}, {{lng}}).",
        createButton: "Tạo khu vực",
        creating: "Đang tạo khu vực...",
        waitingTx: "Đã gửi (tx: {{hash}}...). Đang chờ xác nhận...",
        created: "Đã tạo khu vực! Khu vực đang hoạt động trên bản đồ.",
        withdrawing: "Đang rút phần pool chưa dùng...",
        withdrawn: "Đã rút phần pool chưa dùng về wallet của bạn.",
        withdrawButton: "Rút phần chưa dùng",
        myZonesTitle: "Khu vực của bạn",
        activeCount: "{{count}} khu vực đang hoạt động trên bản đồ.",
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
      appTitleFull: "MiniMonster Terra",
      appTitleShort: "MiniMonster",
      connectWallet: "지갑 연결",

      settings: {
        title: "설정",
        wallet: "지갑",
        language: "언어",
      },

      session: {
        title: "이동 기록",
        loopCapHint: "현재 1회 이동 거리 제한: {{meters}}m (누적 거리가 늘어날수록 증가합니다).",
        modeClaimShort: "점령",
        modeReinforceShort: "보강",
        start: "이동 시작",
        stop: "종료 ({{meters}}m, {{points}}개 지점)",
        noGps: "위치를 기록할 수 없습니다 — GPS 신호가 더 좋은 곳에서 다시 시도해 주세요.",
        loopNotClosed: "이동 경로가 시작 지점으로 돌아오지 않았습니다 — 영토가 될 수 없습니다. 시작 지점 근처로 돌아오도록 다시 시도해 주세요.",
        loopTooSimple: "이동 경로가 하나의 도형을 이루기에 충분하지 않습니다. 더 넓게 돌아 다시 시도해 주세요.",
        retry: "다시 시도 (이번 이동 취소)",
        sendingToSepolia: "Sepolia에 {{mode}} 트랜잭션을 전송 중입니다...",
        sentWaitingAttestation: "전송 완료 (tx: {{hash}}...). Attestcoin Protocol 크로스체인 검증을 기다리는 중...",
        sepoliaNoSessionId: "Sepolia에는 전송되었지만 sessionId를 읽을 수 없습니다 — 블록 익스플로러에서 직접 확인하세요.",
        waitingOutcome: "세션 #{{sessionId}} 결과 대기 중... ({{minutes}}분)",
        recordedWaiting: "기록됨 (세션 #{{sessionId}}). Attestcoin Protocol 크로스체인 검증 대기 중 — 보통 8-15분 정도 걸립니다...",
        errorPrefix: "오류: {{message}}",
      },

      outcome: {
        claimSuccess: "점령 성공! Base #{{baseId}} — 면적 {{area}}m².",
        claimExtended: "내 Base #{{baseId}}를 확장했습니다! 새로운 총 면적 {{area}}m².",
        claimRejected: "점령 실패: {{reason}} — 방금 이동한 거리는 소실되었으며, 아무것도 생성되지 않았습니다.",
        reinforceSuccess: "보강 성공! Base #{{baseId}}의 영토가 100% 복구되었습니다 ({{area}}m²).",
        reinforceRejected: "보강 실패: {{reason}}.",
        timeout: "20분이 지나도 결과가 없습니다 — worker relayer가 실행 중인지 확인하세요.",
      },

      map: {
        baseTooltip: "Base #{{id}} — 소유자: {{owner}} — 영토: {{current}}m² / {{initial}}m² ({{pct}}%)",
        zoneTooltip: "스폰서 구역 #{{id}} — 풀 {{remaining}}/{{total}} CTC — {{paid}}/{{expected}}회 지급됨",
        zoneLabel: "$ #{{id}}",
      },

      zone: {
        title: "구역 스폰서하기",
        hint: "CTC를 지불해 실제 이동을 보상하세요 — 이 구역 안에서 Claim 또는 Reinforce를 하는 누구나 활성 기간 동안 풀의 일부를 받습니다.",
        poolLabel: "풀 금액 (CTC)",
        radiusLabel: "구역 반경 (미터)",
        durationLabel: "기간 (일)",
        sessionsLabel: "예상 횟수 (풀이 이 횟수만큼 균등하게 분배됩니다)",
        centeredHint: "구역은 현재 위치({{lat}}, {{lng}})를 중심으로 생성됩니다.",
        createButton: "구역 생성",
        creating: "구역 생성 중...",
        waitingTx: "전송 완료 (tx: {{hash}}...). 확인 대기 중...",
        created: "구역이 생성되었습니다! 지도에 표시됩니다.",
        withdrawing: "미사용 풀 회수 중...",
        withdrawn: "미사용 풀이 지갑으로 반환되었습니다.",
        withdrawButton: "미사용 풀 회수",
        myZonesTitle: "내 구역",
        activeCount: "현재 지도에 활성 구역 {{count}}개.",
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
