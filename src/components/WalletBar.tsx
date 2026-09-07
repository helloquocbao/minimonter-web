interface WalletBarProps {
  address: string | null;
  onConnect: () => void;
}

export function WalletBar({ address, onConnect }: WalletBarProps) {
  return (
    <div className="wallet-bar">
      <strong>TerraChain: Circle Wars</strong>
      {address ? (
        <span className="wallet-address">
          {address.slice(0, 6)}...{address.slice(-4)}
        </span>
      ) : (
        <button onClick={onConnect}>Kết nối Wallet</button>
      )}
    </div>
  );
}
