import { Link } from 'react-router-dom';
import PublicLayout from '@/components/public/PublicLayout';

type Kind = 'privacy' | 'terms' | 'help';

const CONTENT: Record<Kind, { eyebrow: string; title: string; sub: string; sections: { heading: string; body: string[] }[] }> = {
  privacy: {
    eyebrow: 'Legal',
    title: 'Privacy Policy',
    sub: 'Last updated: May 2026',
    sections: [
      {
        heading: '1. Information We Collect',
        body: [
          'At TokenPap, we collect information essential for providing smart metering services. This includes:',
          'Contact Information: Name, email address, and phone number.',
          'Meter Data: Meter numbers, consumption history, and location data.',
          'Payment Information: M-Pesa transaction IDs and billing history.',
        ],
      },
      {
        heading: '2. How We Use Your Data',
        body: [
          'Your data is used solely to facilitate utility vending, monitor meter health, and improve our services. We do not sell your personal information to third parties.',
        ],
      },
      {
        heading: '3. Data Retention',
        body: ['We retain transaction records for as long as required by law to support utility audits and revenue recovery processes.'],
      },
      {
        heading: 'Questions about your privacy?',
        body: ['If you have any questions or concerns regarding this policy, please contact our data protection officer at info@tokenpap.com.'],
      },
    ],
  },
  terms: {
    eyebrow: 'Legal',
    title: 'Terms of Service',
    sub: 'Agreement for TokenPap Services',
    sections: [
      {
        heading: '1. Acceptance of Terms',
        body: ['By accessing or using the TokenPap platform, you agree to be bound by these Terms of Service. Our platform facilitates the vending of utility tokens and management of smart meters.'],
      },
      {
        heading: '2. User Responsibilities',
        body: ['Users are responsible for the accuracy of the meter numbers entered during transactions. TokenPap is not liable for tokens generated for incorrectly entered meter numbers.'],
      },
      {
        heading: '3. Service Limitations',
        body: ['While we strive for 99.9% uptime, TokenPap does not guarantee uninterrupted service during third-party utility network outages or maintenance.'],
      },
      {
        heading: 'Governing Law',
        body: ['These terms are governed by the laws of Kenya. Any disputes arising from the use of TokenPap shall be settled through arbitration in Nairobi.'],
      },
    ],
  },
  help: {
    eyebrow: 'Support',
    title: 'Help Center',
    sub: 'Answers to common questions.',
    sections: [
      {
        heading: 'How do I buy tokens?',
        body: [
          'Use Buy tokens on this site and pay with M-Pesa, or pay to your vendor\'s paybill using your meter number as the account. Your token is sent by SMS as soon as the payment is confirmed.',
        ],
      },
      {
        heading: 'I paid but did not receive my token',
        body: ['Open Track token and search with your meter number or phone number - your latest tokens are listed there. If nothing appears after a few minutes, contact your vendor or info@tokenpap.com with your M-Pesa receipt.'],
      },
      {
        heading: 'How do I enter a token?',
        body: ['Type the 20-digit token on your meter\'s keypad and press Enter. If the meter rejects it, check that the meter number on the SMS matches your meter.'],
      },
      {
        heading: 'How do I sign in as a customer?',
        body: ['Choose Customer on the sign-in page and enter the phone number registered with your meter. We\'ll text you a one-time code.'],
      },
      {
        heading: 'I want to sell tokens',
        body: ['Register as a vendor - an administrator will review your application and activate your account.'],
      },
    ],
  },
};

function LegalPage({ kind }: { kind: Kind }) {
  const page = CONTENT[kind];
  return (
    <PublicLayout>
      <article className="card card-pad col" style={{ gap: 18, maxWidth: 760, margin: '0 auto' }}>
        <div>
          <p className="eyebrow">{page.eyebrow}</p>
          <h1 className="text-2xl font-bold mt-1" style={{ color: 'var(--ink)' }}>{page.title}</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>{page.sub}</p>
        </div>
        {page.sections.map((s) => (
          <section key={s.heading} className="col" style={{ gap: 6 }}>
            <h2 className="text-base font-bold" style={{ color: 'var(--ink)' }}>{s.heading}</h2>
            {s.body.map((p) => <p key={p} className="text-sm" style={{ color: 'var(--muted)', lineHeight: 1.6 }}>{p}</p>)}
          </section>
        ))}
        {kind === 'help' && (
          <div className="flex gap-2 flex-wrap">
            <Link to="/track-token" className="btn btn-primary btn-sm">Track token</Link>
            <Link to="/buy" className="btn btn-ghost btn-sm">Buy tokens</Link>
            <Link to="/register" className="btn btn-ghost btn-sm">Become a vendor</Link>
          </div>
        )}
      </article>
    </PublicLayout>
  );
}

export default LegalPage;
