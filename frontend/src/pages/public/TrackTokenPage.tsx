import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search } from 'lucide-react';
import { trackToken } from '@/api/meters';
import { errorMessage } from '@/api/client';
import { fmtDateTime } from '@/lib/datetime';
import { fmtKes, humanize, statusPill } from '@/lib/format';
import AppLoader from '@/components/shared/AppLoader';
import TokenList from '@/components/public/TokenList';
import PublicLayout from '@/components/public/PublicLayout';
import type { PublicTokenResult } from '@/types/api';

/** Search box + results - also embedded on the landing page. */
export function TrackTokenSearch({ initial = '' }: { initial?: string }) {
  const [query, setQuery] = useState(initial);
  const [results, setResults] = useState<PublicTokenResult[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (query.trim().length < 3) return setError('Enter your full meter number or phone number.');
    setError('');
    setBusy(true);
    try {
      setResults(await trackToken(query.trim()));
    } catch (err) {
      setResults(null);
      setError(errorMessage(err, 'No matching meter or customer found.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="col" style={{ gap: 16 }}>
      <form onSubmit={onSubmit} className="flex gap-2 flex-wrap">
        <input className="input" style={{ flex: 1, minWidth: 220 }} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Meter number or phone number" />
        <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? <AppLoader size={16} /> : <><Search size={15} /> Find my token</>}</button>
      </form>
      {error && <p className="text-sm" style={{ color: 'var(--red)' }}>{error}</p>}
      {results && results.length === 0 && <p className="text-sm" style={{ color: 'var(--muted)' }}>No token purchases found for this meter yet.</p>}
      {results?.map((r) => (
        <div key={r.id} className="card card-pad col" style={{ gap: 10 }}>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="text-sm font-bold" style={{ color: 'var(--ink)' }}>
              Meter <span className="mono">{r.meter?.meterNumber ?? '-'}</span> · {humanize(r.tokenType)}
              {r.amount ? ` · ${fmtKes(r.amount)}` : ''}
            </span>
            <span className="flex items-center gap-2">
              <span className={statusPill(r.status)}>{r.status}</span>
              <span className="text-xs" style={{ color: 'var(--muted)' }}>{fmtDateTime(r.createdAt)}</span>
            </span>
          </div>
          {r.tokens.length ? <TokenList tokens={r.tokens} /> : <p className="text-sm" style={{ color: 'var(--muted)' }}>{r.description ?? 'No token was issued for this transaction.'}</p>}
        </div>
      ))}
    </div>
  );
}

function TrackTokenPage() {
  const [params] = useSearchParams();
  return (
    <PublicLayout>
      <div className="col" style={{ gap: 18, maxWidth: 720, margin: '0 auto' }}>
        <div>
          <p className="eyebrow">Self-service</p>
          <h1 className="text-2xl font-bold mt-1" style={{ color: 'var(--ink)' }}>Track your token</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>Lost the SMS? Look up your latest tokens with your meter number or the phone number registered to it.</p>
        </div>
        <TrackTokenSearch initial={params.get('q') ?? ''} />
      </div>
    </PublicLayout>
  );
}

export default TrackTokenPage;
