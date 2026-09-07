interface WalletBarProps {
  address: string | null;
  onConnect: () => void;
}

export function WalletBar({ address, onConnect }: WalletBarProps) {
  return (
    <div className="wallet-bar">
      <strong>
        <span className="app-title-full">TerraChain: Circle Wars</span>
        <span className="app-title-short">TerraChain</span>
      </strong>
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
