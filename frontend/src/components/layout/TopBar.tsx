import { Bell, LogOut as SignOut, Menu as List, Sun, Moon, Search as MagnifyingGlass } from 'lucide-react';
import { useState, useEffect, type FormEvent } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { useNotificationStore } from '@/stores/notificationStore';
import NotificationDrawer from '@/components/shared/NotificationDrawer';
import { useNavigate } from 'react-router-dom';
import { confirmAndSignOut } from '@/lib/session';

interface TopBarProps {
  theme: 'light' | 'dark';
  onThemeToggle: () => void;
  onToggleSidebar: () => void;
}

function TopBar({ theme, onThemeToggle, onToggleSidebar }: TopBarProps) {
  const [isNotificationOpen, setIsNotificationOpen] = useState(false);
  const [show, setShow] = useState(true);
  const [lastScrollY, setLastScrollY] = useState(0);
  const [query, setQuery] = useState('');

  const { notifications } = useNotificationStore();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();
  const unreadCount = notifications.filter((n) => !n.read).length;
  const canVend = user && user.role !== 'CUSTOMER';

  useEffect(() => {
    const handleScroll = () => {
      const currentScrollY = window.scrollY;
      setShow(!(currentScrollY > lastScrollY && currentScrollY > 60));
      setLastScrollY(currentScrollY);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [lastScrollY]);

  // Quick meter lookup → opens Token Vending with the search pre-filled.
  const onSearch = (e: FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (q.length >= 2) navigate(`/tokens?q=${encodeURIComponent(q)}`);
  };

  return (
    <>
      <header className="topbar" style={{ transform: show ? 'none' : 'translateY(-100%)', transition: 'transform .3s' }}>
        <button onClick={onToggleSidebar} className="icon-btn" style={{ border: 0, background: 'transparent' }} title="Toggle sidebar">
          <List size={20} />
        </button>

        {canVend && (
          <form className="searchbox" style={{ display: 'flex' }} onSubmit={onSearch}>
            <MagnifyingGlass size={16} />
            <input placeholder="Find a meter or customer phone…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </form>
        )}

        <div style={{ flex: 1 }} />

        <button className="icon-btn" onClick={onThemeToggle} title={theme === 'dark' ? 'Light mode' : 'Dark mode'}>
          {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        </button>

        <button className="icon-btn" style={{ position: 'relative' }} onClick={() => setIsNotificationOpen(true)} title="Notifications">
          <Bell size={18} />
          {unreadCount > 0 && (
            <span style={{ position: 'absolute', top: 6, right: 6, width: 8, height: 8, borderRadius: '99px', background: 'var(--red)', border: '1.5px solid var(--surface)' }} />
          )}
        </button>

        <button className="icon-btn" onClick={() => confirmAndSignOut(logout, navigate)} title="Sign Out" style={{ borderColor: 'transparent' }}>
          <SignOut size={18} />
        </button>
      </header>

      <NotificationDrawer isOpen={isNotificationOpen} onClose={() => setIsNotificationOpen(false)} />
    </>
  );
}

export default TopBar;
