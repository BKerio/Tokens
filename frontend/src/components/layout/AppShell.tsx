import { Outlet, Navigate } from 'react-router-dom';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { PageLoader } from '@/components/shared/ui';
import { useQueryClient } from '@tanstack/react-query';
import Sidebar from '@/components/layout/Sidebar';
import TopBar from '@/components/layout/TopBar';
import { socket } from '@/lib/socket';
import { useAuthStore } from '@/stores/authStore';
import { useNotificationStore } from '@/stores/notificationStore';
import { fmtKes } from '@/lib/format';
import { useIsMobile } from '@/hooks/useIsMobile';

interface TransactionEvent {
  meterNumber: string;
  tokenType: string;
  amount: number | null;
  status: 'SUCCESS' | 'FAILED';
}

function AppShell() {
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();
  const addNotification = useNotificationStore((s) => s.addNotification);

  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('sidebar-collapsed') === 'true');
  const [theme, setTheme] = useState<'light' | 'dark'>(() => (localStorage.getItem('theme') as 'light' | 'dark') ?? 'light');
  const [isConnected, setIsConnected] = useState(socket.connected);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const isMobile = useIsMobile();
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('theme', theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem('sidebar-collapsed', String(collapsed));
  }, [collapsed]);

  // Live vend feed: admins and the meter's owner are told the moment a token
  // is issued (manually or from a payment), and token/stat views refresh.
  useEffect(() => {
    if (!token || !user) return;

    socket.connect();
    const onConnect = () => setIsConnected(true);
    const onDisconnect = () => setIsConnected(false);
    const onTransaction = (e: TransactionEvent) => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['admin-stats'] });
      queryClient.invalidateQueries({ queryKey: ['vendor-profile'] });
      queryClient.invalidateQueries({ queryKey: ['landlord-dashboard'] });
      addNotification({
        type: e.status === 'SUCCESS' ? 'success' : 'warning',
        title: e.status === 'SUCCESS' ? 'Token issued' : 'Token vend failed',
        message: `Meter ${e.meterNumber}${e.amount ? ` · ${fmtKes(e.amount)}` : ''}`,
      });
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onDisconnect);
    socket.on('transaction:created', onTransaction);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('connect_error', onDisconnect);
      socket.off('transaction:created', onTransaction);
      socket.disconnect();
    };
  }, [token, user, queryClient, addNotification]);

  if (!token || !user) return <Navigate to="/login" replace />;

  return (
    <div className="app">
      <Sidebar
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed((c) => !c)}
        connected={isConnected}
        drawerOpen={drawerOpen}
        onCloseDrawer={closeDrawer}
      />
      <div className="main">
        <TopBar
          theme={theme}
          onThemeToggle={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
          onToggleSidebar={() => (isMobile ? setDrawerOpen(true) : setCollapsed((c) => !c))}
        />
        {!isConnected && (
          <div className="banner-warn">
            <span style={{ width: 8, height: 8, borderRadius: '99px', background: 'var(--amber)', flexShrink: 0, display: 'inline-block', animation: 'pulse 2s infinite' }} />
            Live updates paused - reconnecting…
          </div>
        )}
        <main className="content">
          <Suspense fallback={<PageLoader />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
}

export default AppShell;
