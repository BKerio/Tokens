import PublicLayout from '@/components/public/PublicLayout';
import BuyTokensPanel from '@/components/public/BuyTokensPanel';

function BuyTokensPage() {
  return (
    <PublicLayout>
      <div style={{ maxWidth: 480, margin: '0 auto', padding: '8px 0 24px' }}>
        <BuyTokensPanel />
      </div>
    </PublicLayout>
  );
}

export default BuyTokensPage;
