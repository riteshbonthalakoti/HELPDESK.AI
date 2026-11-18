import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useLocation
} from "react-router-dom";
import React, { useEffect } from "react";
import { AnimatePresence } from "framer-motion";
import { NotFound } from "./components/ui/not-found-2";
import useTicketStore from "./store/ticketStore";
import Toaster from "./components/shared/Toaster";
import BugReportWidget from "./components/shared/BugReportWidget";
import useRealtimeNotifications from "./hooks/useRealtimeNotifications";

// Auth Components
import Login from "./pages/Login";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import VerifyEmailChange from "./pages/VerifyEmailChange";
import Signup from "./pages/Signup";
import AdminSignup from "./pages/AdminSignup";
import AdminLobby from "./pages/AdminLobby";
import UserLobby from "./pages/UserLobby";
import LandingPage from "./pages/LandingPage";
import ContactSales from "./pages/ContactSales";

// Legacy components
import DuplicateDetection from "./user/pages/DuplicateDetection";
import AutoResolveChat from "./user/pages/AutoResolveChat";
import Resolved from "./user/pages/Resolved";
import TicketTracking from "./user/pages/TicketTracking";
// Layouts
import UserLayout from "./user/UserLayout";
import AdminLayout from "./admin/layout/AdminLayout";

// User Pages
import Dashboard from "./user/pages/Dashboard";
import CreateTicket from "./user/pages/CreateTicket";
import MyTickets from "./user/pages/MyTickets";
import TicketResult from "./user/pages/TicketResult";
import Profile from "./user/pages/Profile";
import TicketDetail from "./user/pages/TicketDetail";
import TicketProcessing from "./user/pages/AIProcessing"; // Renamed generic import just in case, but keeping AIProcessing
import AIProcessing from "./user/pages/AIProcessing";
import AIUnderstanding from "./user/pages/AIUnderstanding";
import Notifications from "./user/pages/Notifications";
import Help from "./user/pages/Help";
import DocsPortal from "./docs/pages/DocsPortal";

// New Showcase Pages
import ApiReference from "./pages/ApiReference";
import Changelog from "./pages/Changelog";
import StatusPage from "./pages/StatusPage";
import AboutUs from "./pages/AboutUs";
import Careers from "./pages/Careers";
import CookiePolicy from "./pages/legal/CookiePolicy";

// NEW Admin Pages (Refactored)
import AdminDashboard from "./admin/pages/AdminDashboard";
import AdminTickets from "./admin/pages/AdminTickets";
import AdminTicketDetail from "./admin/pages/AdminTicketDetail";
import AdminUsers from "./admin/pages/AdminUsers";
import AdminAnalytics from "./admin/pages/AdminAnalytics";
import AdminProfile from "./admin/pages/AdminProfile";
import AdminSettings from "./admin/pages/AdminSettings";
import MasterBugReports from "./master-admin/pages/MasterBugReports";

// Feature Pages
import AutoCategorizationFeature from "./pages/features/AutoCategorizationFeature";
import PriorityDetectionFeature from "./pages/features/PriorityDetectionFeature";
import SmartResolutionFeature from "./pages/features/SmartResolutionFeature";

// Legal Pages
import TermsOfService from "./pages/legal/TermsOfService";
import PrivacyPolicy from "./pages/legal/PrivacyPolicy";
import Security from "./pages/legal/Security";
import AdminProtectedRoute from "./components/shared/AdminProtectedRoute";
import MasterAdminProtectedRoute from "./components/shared/MasterAdminProtectedRoute";
import ProtectedRoute from "./components/shared/ProtectedRoute";
import useAuthStore from "./store/authStore";
import NotApproved from "./pages/NotApproved";

// Master Admin Components
import MasterAdminLogin from "./pages/MasterAdminLogin";
import MasterAdminLayout from "./master-admin/layout/MasterAdminLayout";
import MasterAdminDashboard from "./master-admin/pages/MasterAdminDashboard";
import PendingAdminRequests from "./master-admin/pages/PendingAdminRequests";
import AllCompanies from "./master-admin/pages/AllCompanies";
import AllAdmins from "./master-admin/pages/AllAdmins";


function TitleUpdater() {
  const location = useLocation();

  useEffect(() => {
    const path = location.pathname;
    let title = 'HELPDESK.AI';

    // Admin Routes
    if (path.startsWith('/admin/ticket/')) title = 'Ticket Detail | Admin';
    else if (path.startsWith('/admin/dashboard')) title = 'Admin Dashboard';
    else if (path.startsWith('/admin/tickets')) title = 'Admin Tickets';
    else if (path.startsWith('/admin/users')) title = 'Manage Users | Admin';
    else if (path.startsWith('/admin/analytics')) title = 'Analytics | Admin';
    else if (path.startsWith('/admin/profile')) title = 'Admin Profile';
    else if (path.startsWith('/admin/settings')) title = 'Settings | Admin';
    // Master Admin Routes
    else if (path.startsWith('/master-admin/dashboard')) title = 'Master Dashboard';
    else if (path.startsWith('/master-admin/admin-requests')) title = 'Pending Requests | Master Admin';
    else if (path.startsWith('/master-admin/companies')) title = 'Companies | Master Admin';
    else if (path.startsWith('/master-admin/all-admins')) title = 'All Admins | Master Admin';
    else if (path.startsWith('/master-admin/bug-reports')) title = 'System Bug Radar | Master Admin';
    // User Routes
    else if (path.startsWith('/ticket/')) title = 'Ticket Detail';
    else if (path.startsWith('/ai-understanding')) title = 'AI Understanding';
    else if (path.startsWith('/ai-processing')) title = 'AI Processing';
    else if (path === '/dashboard') title = 'User Dashboard';
    else if (path === '/create-ticket') title = 'Create Ticket';
    else if (path === '/my-tickets') title = 'My Tickets';
    else if (path === '/profile') title = 'User Profile';
    else if (path === '/notifications') title = 'Notifications';
    else if (path === '/docs') title = 'Documentation';
    else if (path === '/api-reference') title = 'API Reference';
    else if (path === '/changelog') title = 'Changelog';
    else if (path === '/status') title = 'Status';
    else if (path === '/about') title = 'About Us';
    else if (path === '/careers') title = 'Careers';
    else if (path === '/cookie-policy') title = 'Cookie Policy';
    // Public / Lobby Routes
    else if (path === '/login') title = 'Login';
    else if (path === '/signup') title = 'Create Account';
    else if (path === '/admin-signup') title = 'Admin Signup';
    else if (path === '/user-lobby') title = 'User Lobby';
    else if (path === '/admin-lobby') title = 'Admin Lobby';
    else if (path === '/') title = 'Welcome';

    document.title = title === 'HELPDESK.AI' ? title : `${title} | HELPDESK.AI`;
  }, [location]);

  return null;
}

// Scrolls to top on every route change
function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [pathname]);
  return null;
}

function AppLayout() {
  const { user, profile } = useAuthStore();

  // Initialize Global Realtime Notifications Listener
  useRealtimeNotifications();

  useEffect(() => {
    if (!user) return;
    const handleFocus = () => {
      useTicketStore.persist.rehydrate();
    };

    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [user]);

  // ProtectedRoute handles the redirect to /login if user is not present
  // but we still need to handle role-based navigation here
  return (
    <>
      <Routes>
        <Route path="/knowledge-check" element={<DuplicateDetection />} />
        <Route path="/auto-resolve" element={<AutoResolveChat />} />
        <Route path="/resolved" element={<Resolved />} />

        {/* --- User Portal --- */}
        <Route element={
          profile?.role === 'master_admin' ? <Navigate to="/master-admin/dashboard" replace /> :
            (profile?.role === 'admin' || profile?.role === 'super_admin') ? <Navigate to="/admin/dashboard" replace /> :
              profile?.status === 'pending_approval' ? <Navigate to="/user-lobby" replace /> :
                profile?.status === 'rejected' ? <Navigate to="/not-approved" replace /> :
                  <UserLayout />
        }>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/create-ticket" element={<CreateTicket />} />
          <Route path="/my-tickets" element={<MyTickets />} />
          <Route path="/ticket/:ticket_id" element={<TicketDetail />} />
          <Route path="/ai-processing" element={<AIProcessing />} />
          <Route path="/ai-understanding" element={<AIUnderstanding />} />
          <Route path="/ticket-tracking" element={<TicketTracking />} />
          <Route path="/ticket-result" element={<TicketResult />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/help" element={<Help />} />
          <Route path="/notifications" element={<Notifications />} />
        </Route>

        {/* --- Admin Portal (Protected) --- */}
        <Route element={<AdminProtectedRoute />}>
          <Route element={<AdminLayout />}>
            <Route path="/admin" element={<Navigate to="/admin/dashboard" replace />} />
            <Route path="/admin/dashboard" element={<AdminDashboard />} />
            <Route path="/admin/tickets" element={<AdminTickets />} />
            <Route path="/admin/ticket/:ticket_id" element={<AdminTicketDetail />} />
            <Route path="/admin/users" element={<AdminUsers />} />
            <Route path="/admin/analytics" element={<AdminAnalytics />} />
            <Route path="/admin/profile" element={<AdminProfile />} />
            <Route path="/admin/settings" element={<AdminSettings />} />
          </Route>
        </Route>

        <Route path="*" element={<NotFound />} />
      </Routes>
    </>
  );
}


function App() {
  const { initialize } = useAuthStore();

  useEffect(() => {
    initialize();
  }, [initialize]);

  const isDocsSubdomain = window.location.hostname.startsWith('docs.');

  if (isDocsSubdomain) {
    return (
      <BrowserRouter>
        <TitleUpdater />
        <ScrollToTop />
        <Toaster />
        <BugReportWidget />
        <Routes>
          <Route path="/" element={<DocsPortal />} />
          <Route path="/docs" element={<Navigate to="/" replace />} />
          <Route path="/api-reference" element={<ApiReference />} />
          <Route path="/changelog" element={<Changelog />} />
          <Route path="/status" element={<StatusPage />} />
          <Route path="*" element={<DocsPortal />} />
        </Routes>
      </BrowserRouter>
    );
  }

  return (
    <BrowserRouter>
      <TitleUpdater />
      <ScrollToTop />
      <Toaster />
      <BugReportWidget />
      <Routes>
        {/* Public */}
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<Login />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/verify-email-change" element={<VerifyEmailChange />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/admin-signup" element={<AdminSignup />} />
        <Route path="/admin-lobby" element={<AdminLobby />} />
        <Route path="/user-lobby" element={<UserLobby />} />
        <Route path="/not-approved" element={<NotApproved />} />
        <Route path="/contact-sales" element={<ContactSales />} />
        <Route path="/docs" element={<DocsPortal />} />
        <Route path="/api-reference" element={<ApiReference />} />
        <Route path="/changelog" element={<Changelog />} />
        <Route path="/status" element={<StatusPage />} />
        <Route path="/about" element={<AboutUs />} />
        <Route path="/careers" element={<Careers />} />
        <Route path="/cookie-policy" element={<CookiePolicy />} />

        {/* Feature Pages */}
        <Route path="/features/categorization" element={<AutoCategorizationFeature />} />
        <Route path="/features/priority" element={<PriorityDetectionFeature />} />
        <Route path="/features/resolution" element={<SmartResolutionFeature />} />

        {/* Legal Pages */}
        <Route path="/terms" element={<TermsOfService />} />
        <Route path="/privacy" element={<PrivacyPolicy />} />
        <Route path="/security" element={<Security />} />

        {/* Master Admin Portal */}
        <Route path="/master-admin-login" element={<MasterAdminLogin />} />

        <Route element={<MasterAdminProtectedRoute />}>
          <Route element={<MasterAdminLayout />}>
            <Route path="/master-admin/dashboard" element={<MasterAdminDashboard />} />
            <Route path="/master-admin/admin-requests" element={<PendingAdminRequests />} />
            <Route path="/master-admin/companies" element={<AllCompanies />} />
            <Route path="/master-admin/all-admins" element={<AllAdmins />} />
            <Route path="/master-admin/bug-reports" element={<MasterBugReports />} />
          </Route>
        </Route>

        {/* Protected */}
        <Route element={<ProtectedRoute />}>
          <Route path="/*" element={<AppLayout />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;

