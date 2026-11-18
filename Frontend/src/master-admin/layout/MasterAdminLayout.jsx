import React from "react";
import { Link, useNavigate, useLocation, Outlet } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import useAuthStore from "../../store/authStore";
import {
    ShieldCheck,
    LayoutDashboard,
    Users,
    Building2,
    Bell,
    LogOut,
    Search,
    UserCircle,
    Bug,
    Mail,
    Menu,
    X
} from "lucide-react";
import EmailChangeModal from "../../components/shared/EmailChangeModal";

/**
 * MasterAdminLayout — Responsive platform oversight shell:
 * desktop glassmorphic sidebar + mobile slide-over drawer & dark bottom navigation dock.
 */
function MasterAdminLayout() {
    const { profile, logout } = useAuthStore();
    const navigate = useNavigate();
    const location = useLocation();

    const handleLogout = async () => {
        await logout();
        navigate("/master-admin-login");
    };

    const [pendingCount, setPendingCount] = React.useState(0);
    const [showEmailModal, setShowEmailModal] = React.useState(false);
    const [isMobileDrawerOpen, setIsMobileDrawerOpen] = React.useState(false);

    React.useEffect(() => {
        const fetchCount = async () => {
            const { count } = await supabase
                .from('admin_requests')
                .select('*', { count: 'exact', head: true })
                .eq('status', 'pending');
            setPendingCount(count || 0);
        };
        fetchCount();

        const sub = supabase.channel('pending_badge')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'admin_requests' }, () => fetchCount())
            .subscribe();

        return () => supabase.removeChannel(sub);
    }, []);

    const navItems = [
        { path: "/master-admin/dashboard", icon: LayoutDashboard, label: "Overview", shortLabel: "Home" },
        { path: "/master-admin/admin-requests", icon: Bell, label: "Pending Requests", shortLabel: "Requests", count: pendingCount },
        { path: "/master-admin/companies", icon: Building2, label: "All Companies", shortLabel: "Companies" },
        { path: "/master-admin/all-admins", icon: Users, label: "All Admins", shortLabel: "Admins" },
        { path: "/master-admin/bug-reports", icon: Bug, label: "Bug Radar", shortLabel: "Bugs" },
    ];

    const renderSidebarContent = (isMobile = false) => (
        <div className="flex flex-col h-full">
            <div className="p-5 sm:p-6 border-b border-white/5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center shadow-[0_0_15px_rgba(99,102,241,0.2)]">
                        <ShieldCheck className="w-5 h-5 text-indigo-400" />
                    </div>
                    <div>
                        <h1 className="text-white font-bold tracking-tight">HelpDesk.ai</h1>
                        <p className="text-[10px] text-indigo-400 uppercase tracking-widest font-semibold">Master Admin</p>
                    </div>
                </div>
                {isMobile && (
                    <button
                        type="button"
                        onClick={() => setIsMobileDrawerOpen(false)}
                        className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/10"
                    >
                        <X className="w-5 h-5" />
                    </button>
                )}
            </div>

            <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
                {navItems.map((item) => {
                    const isActive = location.pathname === item.path;
                    const IconComponent = item.icon;
                    return (
                        <Link
                            key={item.path}
                            to={item.path}
                            onClick={isMobile ? () => setIsMobileDrawerOpen(false) : undefined}
                            className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all group ${isActive
                                ? "bg-indigo-500/15 text-indigo-300 border border-indigo-500/25"
                                : "text-slate-400 hover:text-white hover:bg-white/5 border border-transparent"
                                }`}
                        >
                            <IconComponent
                                className={`w-5 h-5 transition-colors ${isActive ? "text-indigo-400" : "text-slate-500 group-hover:text-slate-300"}`}
                            />
                            {item.label}
                            {item.count > 0 && (
                                <span className="ml-auto px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 text-[10px] font-black border border-emerald-500/25">
                                    {item.count}
                                </span>
                            )}
                            {item.label === "Pending Requests" && item.count === 0 && (
                                <span className="ml-auto w-1.5 h-1.5 rounded-full bg-slate-700" />
                            )}
                        </Link>
                    );
                })}
            </nav>

            <div className="p-4 border-t border-white/5 space-y-2 pb-safe">
                <button
                    type="button"
                    onClick={() => {
                        setIsMobileDrawerOpen(false);
                        setShowEmailModal(true);
                    }}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 transition-all group cursor-pointer"
                >
                    <Mail className="w-5 h-5 text-emerald-400 transition-colors" />
                    Change Email
                </button>
                <button
                    type="button"
                    onClick={handleLogout}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-all group"
                >
                    <LogOut className="w-5 h-5 text-slate-500 group-hover:text-red-400 transition-colors" />
                    Sign Out
                </button>
            </div>
        </div>
    );

    return (
        <div className="h-[100dvh] bg-[#050508] flex font-sans overflow-hidden text-slate-300">
            {/* Ambient Background Glows */}
            <div className="fixed inset-0 pointer-events-none z-0">
                <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-indigo-600/5 rounded-full blur-[150px] mix-blend-screen" />
                <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-emerald-600/5 rounded-full blur-[120px] mix-blend-screen" />
            </div>

            {/* Desktop Sidebar (>= md) */}
            <aside className="hidden md:flex w-64 border-r border-white/5 bg-white/[0.02] backdrop-blur-xl z-20 flex-col shrink-0">
                {renderSidebarContent(false)}
            </aside>

            {/* Mobile Slide-Over Drawer (< md) */}
            {isMobileDrawerOpen && (
                <div
                    className="md:hidden fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex"
                    onClick={() => setIsMobileDrawerOpen(false)}
                >
                    <aside
                        className="w-[82%] max-w-[290px] h-full bg-[#0a0d16] border-r border-white/10 shadow-2xl animate-in slide-in-from-left duration-200"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {renderSidebarContent(true)}
                    </aside>
                </div>
            )}

            {/* Main Content Area */}
            <main className="flex-1 flex flex-col min-w-0 relative z-10 h-full overflow-hidden">
                {/* Top Bar */}
                <header className="h-14 md:h-16 border-b border-white/5 bg-[#070910]/85 backdrop-blur-lg flex items-center justify-between px-4 sm:px-6 md:px-8 shrink-0 gap-3 pt-safe">
                    <div className="flex items-center gap-3 flex-1 min-w-0 max-w-xl">
                        {/* Mobile Menu Toggle */}
                        <button
                            type="button"
                            onClick={() => setIsMobileDrawerOpen(true)}
                            aria-label="Open Master Admin Menu"
                            className="md:hidden w-9 h-9 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-slate-300 active:scale-95 shrink-0"
                        >
                            <Menu className="w-5 h-5" />
                        </button>

                        {/* Mobile Brand */}
                        <div className="md:hidden flex items-center gap-2 min-w-0">
                            <ShieldCheck className="w-5 h-5 text-indigo-400 shrink-0" />
                            <div className="min-w-0">
                                <p className="text-sm font-bold text-white leading-none truncate">HelpDesk.ai</p>
                                <p className="text-[10px] text-indigo-400 font-semibold uppercase tracking-wider truncate">Master Admin</p>
                            </div>
                        </div>

                        {/* Desktop Search */}
                        <div className="hidden md:block relative w-full group">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 group-focus-within:text-indigo-400 transition-colors" />
                            <input
                                type="text"
                                placeholder="Global search admins, companies, or IDs..."
                                className="w-full bg-white/5 border border-white/10 rounded-lg py-2 pl-10 pr-4 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500/50 transition-all text-slate-200"
                                onChange={(e) => console.log("Global search:", e.target.value)}
                            />
                        </div>
                    </div>

                    <div className="flex items-center gap-2.5 sm:gap-5 shrink-0">
                        <button
                            type="button"
                            onClick={() => setShowEmailModal(true)}
                            className="md:hidden inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs font-semibold active:scale-95"
                        >
                            <Mail className="w-3.5 h-3.5" /> Email
                        </button>
                        <div className="flex items-center gap-3 md:pl-6 md:border-l md:border-white/10">
                            <div className="text-right hidden sm:block">
                                <p className="text-sm font-semibold text-white truncate max-w-[150px]">{profile?.full_name}</p>
                                <p className="text-[10px] text-emerald-400 font-medium uppercase tracking-wider">Superuser Access</p>
                            </div>
                            <div className="w-9 h-9 md:w-10 md:h-10 rounded-full bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center overflow-hidden">
                                <UserCircle className="w-5 h-5 md:w-6 md:h-6 text-indigo-400" />
                            </div>
                        </div>
                    </div>
                </header>

                {/* Page Content */}
                <div className="flex-1 overflow-y-auto p-4 sm:p-6 md:p-8 pb-24 md:pb-8 custom-scrollbar">
                    <Outlet />
                </div>
            </main>

            {/* Dark Native Mobile Bottom Dock (< md) */}
            <nav
                aria-label="Master Admin Mobile Navigation"
                className="md:hidden fixed bottom-0 inset-x-0 z-40 mobile-dark-dock border-t border-white/10 px-1.5 pt-1.5 pb-safe"
            >
                <div className="max-w-lg mx-auto grid grid-cols-5 items-center">
                    {navItems.map((item) => {
                        const isActive = location.pathname === item.path;
                        const IconComponent = item.icon;
                        return (
                            <Link
                                key={item.path}
                                to={item.path}
                                className={`relative flex flex-col items-center justify-center gap-1 py-1.5 px-1 rounded-2xl transition-all active:scale-95 ${
                                    isActive ? "text-indigo-300" : "text-slate-500 hover:text-slate-300"
                                }`}
                            >
                                <div
                                    className={`relative flex items-center justify-center w-9 h-7 rounded-full transition-all ${
                                        isActive ? "bg-indigo-500/20 text-indigo-300" : ""
                                    }`}
                                >
                                    <IconComponent className="w-[18px] h-[18px]" />
                                    {item.count > 0 && (
                                        <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-emerald-500 text-[9px] font-black text-slate-950 flex items-center justify-center">
                                            {item.count}
                                        </span>
                                    )}
                                </div>
                                <span className={`text-[10px] leading-none ${isActive ? "font-bold text-indigo-200" : "font-medium"}`}>
                                    {item.shortLabel}
                                </span>
                            </Link>
                        );
                    })}
                </div>
            </nav>

            <EmailChangeModal
                isOpen={showEmailModal}
                onClose={() => setShowEmailModal(false)}
                currentEmail={profile?.email || ""}
            />
        </div>
    );
}

export default MasterAdminLayout;
