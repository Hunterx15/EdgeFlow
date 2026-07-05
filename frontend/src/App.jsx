/**
 * EdgeFlow - Root App component with routing
 */

import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { ToastProvider } from './utils/toast';
import MainLayout from './layouts/MainLayout';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import ServicesPage from './pages/ServicesPage';
import RoutesPage from './pages/RoutesPage';
import ApiKeysPage from './pages/ApiKeysPage';
import PlaygroundPage from './pages/PlaygroundPage';
import PipelinePage from './pages/PipelinePage';
import TimelinePage from './pages/TimelinePage';
import DependencyGraphPage from './pages/DependencyGraphPage';
import LogsPage from './pages/LogsPage';
import AnalyticsPage from './pages/AnalyticsPage';
import MonitoringPage from './pages/MonitoringPage';
import SettingsPage from './pages/SettingsPage';
import { Logo } from './components/layout/Logo';

function Protected({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <SplashScreen />;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function SplashScreen() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-slate-950">
      <div className="animate-pulse"><Logo size={48} /></div>
      <div className="text-sm text-slate-500">Loading EdgeFlow...</div>
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<Protected><MainLayout /></Protected>}>
          <Route index element={<DashboardPage />} />
          <Route path="services" element={<ServicesPage />} />
          <Route path="routes" element={<RoutesPage />} />
          <Route path="api-keys" element={<ApiKeysPage />} />
          <Route path="playground" element={<PlaygroundPage />} />
          <Route path="pipeline" element={<PipelinePage />} />
          <Route path="timeline" element={<TimelinePage />} />
          <Route path="dependency-graph" element={<DependencyGraphPage />} />
          <Route path="logs" element={<LogsPage />} />
          <Route path="analytics" element={<AnalyticsPage />} />
          <Route path="monitoring" element={<MonitoringPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ToastProvider>
  );
}
