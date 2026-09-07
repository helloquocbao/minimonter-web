import { useState } from "react";
import { CREDITCOIN_CHAIN_ID } from "../config";
import { getTerraChainGameWriteContract, getTerraTokenWriteContract, switchToChain } from "../lib/web3";

interface SlotShopProps {
  walletMeters: number;
  capacityMeters: number;
  onChanged: () => void;
}

export function SlotShop({ walletMeters, capacityMeters, onChanged }: SlotShopProps) {
  const [busy, setBusy] = useState<"faucet" | "buy" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleFaucet() {
    setError(null);
    setBusy("faucet");
    try {
      await switchToChain(CREDITCOIN_CHAIN_ID);
      const token = await getTerraTokenWriteContract();
      const tx = await token.faucet();
      await tx.wait();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function handleBuySlot() {
    setError(null);
    setBusy("buy");
    try {
      await switchToChain(CREDITCOIN_CHAIN_ID);
      const token = await getTerraTokenWriteContract();
      const game = await getTerraChainGameWriteContract();
      const slotPrice: bigint = await game.SLOT_PRICE();

      const approveTx = await token.approve(await game.getAddress(), slotPrice);
      await approveTx.wait();

      const buyTx = await game.buySlot(1);
      await buyTx.wait();

      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="panel slot-shop">
      <h3>Km wallet (khiên phòng thủ)</h3>
      <p>
        {walletMeters}m / {capacityMeters}m
      </p>
      <div className="button-row">
        <button onClick={handleFaucet} disabled={busy !== null}>
          {busy === "faucet" ? "Đang nhận..." : "Nhận $TERRA (faucet)"}
        </button>
        <button onClick={handleBuySlot} disabled={busy !== null}>
          {busy === "buy" ? "Đang mua..." : "Mua Slot (+2000m, 10 TERRA)"}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
