import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { copyText, fmtToken } from '@/lib/format';

/** Large, copyable STS token codes. */
function TokenList({ tokens }: { tokens: string[] }) {
  const [copied, setCopied] = useState<string | null>(null);

  const copy = async (token: string) => {
    if (await copyText(token)) {
      setCopied(token);
      setTimeout(() => setCopied(null), 2000);
    }
  };

  return (
    <div className="col" style={{ gap: 8 }}>
      {tokens.map((t) => (
        <div key={t} className="flex items-center justify-between gap-2" style={{ background: 'var(--green-light)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '10px 12px' }}>
          <span className="mono" style={{ fontSize: 18, fontWeight: 600, letterSpacing: '.06em', color: 'var(--ink)' }}>{fmtToken(t)}</span>
          <button type="button" className="icon-btn" title="Copy token" onClick={() => copy(t)}>
            {copied === t ? <Check size={15} /> : <Copy size={15} />}
          </button>
        </div>
      ))}
    </div>
  );
}

export default TokenList;
