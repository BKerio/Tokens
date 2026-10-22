import PublicLayout from '@/components/public/PublicLayout';
import BuyTokensPanel from '@/components/public/BuyTokensPanel';

function BuyTokensPage() {
  return (
    <PublicLayout>
      <div className="col" style={{ gap: 18, maxWidth: 520, margin: '0 auto' }}>
        <div>
          <p className="eyebrow">Lipa na M-Pesa</p>
          <h1 className="text-2xl font-bold mt-1" style={{ color: 'var(--ink)' }}>Buy tokens</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>Pay for any TokenPap meter - your token appears here and arrives by SMS.</p>
        </div>
        <div className="card"><BuyTokensPanel /></div>
      </div>
    </PublicLayout>
  );
}

export default BuyTokensPage;
