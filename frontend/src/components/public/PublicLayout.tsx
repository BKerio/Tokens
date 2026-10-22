import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Zap } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { homePath } from '@/lib/session';

/** Header + footer frame for the public (signed-out) pages. */
function PublicLayout({ children }: { children: ReactNode }) {
  const user = useAuthStore((s) => s.user);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', flexDirection: 'column' }}>
      <header style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
        <div className="flex items-center justify-between gap-3 flex-wrap" style={{ maxWidth: 1120, margin: '0 auto', padding: '14px 20px' }}>
          <Link to="/" className="flex items-center gap-2" style={{ textDecoration: 'none' }}>
            <Zap size={22} style={{ color: 'var(--green)' }} />
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 19, color: 'var(--ink)' }}>TokenPap</span>
          </Link>
          <nav className="flex items-center gap-2 flex-wrap">
            <Link to="/track-token" className="btn btn-ghost btn-sm">Track token</Link>
            <Link to="/buy" className="btn btn-ghost btn-sm">Buy tokens</Link>
            {user ? (
              <Link to={homePath(user.role)} className="btn btn-primary btn-sm">Dashboard</Link>
            ) : (
              <>
                <Link to="/register" className="btn btn-ghost btn-sm">Become a vendor</Link>
                <Link to="/login" className="btn btn-primary btn-sm">Sign in</Link>
              </>
            )}
          </nav>
        </div>
      </header>

      <main style={{ flex: 1, width: '100%', maxWidth: 1120, margin: '0 auto', padding: '28px 20px' }}>{children}</main>

      <footer style={{ borderTop: '1px solid var(--border)', background: 'var(--surface)' }}>
        <div className="flex items-center justify-between gap-3 flex-wrap text-sm" style={{ maxWidth: 1120, margin: '0 auto', padding: '18px 20px', color: 'var(--muted)' }}>
          <span>© {new Date().getFullYear()} TokenPap · Smart prepaid metering</span>
          <div className="flex gap-4">
            <Link to="/help" style={{ color: 'var(--muted)' }}>Help</Link>
            <Link to="/privacy" style={{ color: 'var(--muted)' }}>Privacy</Link>
            <Link to="/terms" style={{ color: 'var(--muted)' }}>Terms</Link>
            <a href="mailto:info@tokenpap.com" style={{ color: 'var(--muted)' }}>info@tokenpap.com</a>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default PublicLayout;
