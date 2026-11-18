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
    ExternalLink,
    Search,
    UserCircle,
    Bug,
    Settings,
    Activity,
    Mail
} from "lucide-react";
import EmailChangeModal from "../../components/shared/EmailChangeModal";

/**
 * MasterAdminLayout — Professional sidebar-based layout for platform oversight.
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
        { path: "/master-admin/dashboard", icon: <LayoutDashboard />, label: "Overview" },
        { path: "/master-admin/admin-requests", icon: <Bell />, label: "Pending Requests", count: pendingCount },
        { path: "/master-admin/companies", icon: <Building2 />, label: "All Companies" },
        { path: "/master-admin/all-admins", icon: <Users />, label: "All Admins" },
        { path: "/master-admin/bug-reports", icon: <Bug />, label: "Bug Radar" },
    ];

    return (
        <div className="min-h-screen bg-[#050508] flex font-sans overflow-hidden text-slate-300">
            {/* Ambient Background Glows */}
            <div className="fixed inset-0 pointer-events-none z-0">
                <div className="absolute top-0 right-0 w-[800px] h-[800px] bg-indigo-600/5 rounded-full blur-[150px] mix-blend-screen" />
                <div className="absolute bottom-0 left-0 w-[600px] h-[600px] bg-emerald-600/5 rounded-full blur-[120px] mix-blend-screen" />
                <div className="absolute top-0 left-0 w-full h-full bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-[0.03]"></div>
            </div>

            {/* Sidebar */}
            <aside className="w-64 border-r border-white/5 bg-white/[0.02] backdrop-blur-xl z-20 flex flex-col shrink-0">
                <div className="p-6 border-b border-white/5">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center shadow-[0_0_15px_rgba(99,102,241,0.2)]">
                            <ShieldCheck className="w-5 h-5 text-indigo-400" />
                        </div>
                        <div>
                            <h1 className="text-white font-bold tracking-tight">HelpDesk.ai</h1>
                            <p className="text-[10px] text-indigo-400 uppercase tracking-widest font-semibold">Master Admin</p>
                        </div>
                    </div>
                </div>

                <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
                    {navItems.map((item) => {
                        const isActive = location.pathname === item.path;
                        return (
                            <Link
                                key={item.path}
                                to={item.path}
                                className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all group ${isActive
                                    ? "bg-indigo-500/10 text-indigo-300 border border-indigo-500/20"
                                    : "text-slate-400 hover:text-white hover:bg-white/5 border border-transparent"
                                    }`}
                            >
                                {React.cloneElement(item.icon, {
                                    className: `w-5 h-5 transition-colors ${isActive ? "text-indigo-400" : "text-slate-500 group-hover:text-slate-300"}`
                                })}
                                {item.label}
                                {item.count > 0 && (
                                    <span className="ml-auto px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 text-[10px] font-black border border-emerald-500/20">
                                        {item.count}
                                    </span>
                                )}
                                {item.label === "Pending Requests" && item.count === 0 && (
                                    <span className="ml-auto w-1.5 h-1.5 rounded-full bg-slate-700"></span>
                                )}
                            </Link>
                        );
                    })}
                </nav>

                <div className="p-4 border-t border-white/5 space-y-1.5">
                    <button
                        type="button"
                        onClick={() => setShowEmailModal(true)}
                        className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 transition-all group cursor-pointer"
                    >
                        <Mail className="w-5 h-5 text-emerald-400 transition-colors" />
                        Change Email
                    </button>
                    <button
                        onClick={handleLogout}
                        className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-slate-400 hover:text-red-400 hover:bg-red-500/5 transition-all group"
                    >
                        <LogOut className="w-5 h-5 text-slate-500 group-hover:text-red-400 transition-colors" />
                        Sign Out
                    </button>
                </div>
            </aside>

            {/* Main Content Area */}
            <main className="flex-1 flex flex-col min-w-0 relative z-10 h-screen overflow-hidden">
                {/* Top Bar */}
                <header className="h-16 border-b border-white/5 bg-white/[0.01] backdrop-blur-md flex items-center justify-between px-8 shrink-0">
                    <div className="flex items-center gap-4 flex-1 max-w-xl">
                        <div className="relative w-full group">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 group-focus-within:text-indigo-400 transition-colors" />
                            <input
                                type="text"
                                placeholder="Global search admins, companies, or IDs..."
                                className="w-full bg-white/5 border border-white/10 rounded-lg py-2 pl-10 pr-4 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500/50 transition-all"
                                onChange={(e) => console.log("Global search:", e.target.value)}
                            />
                        </div>
                    </div>

                    <div className="flex items-center gap-6">
                        <div className="flex items-center gap-3 pl-6 border-l border-white/10">
                            <div className="text-right hidden sm:block">
                                <p className="text-sm font-semibold text-white truncate max-w-[150px]">{profile?.full_name}</p>
                                <p className="text-[10px] text-emerald-400 font-medium uppercase tracking-wider">Superuser Access</p>
                            </div>
                            <div className="w-10 h-10 rounded-full bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center overflow-hidden">
                                <UserCircle className="w-6 h-6 text-indigo-400" />
                            </div>
                        </div>
                    </div>
                </header>

                {/* Page Content */}
                <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
                    <Outlet />
                </div>
            </main>

            <EmailChangeModal
                isOpen={showEmailModal}
                onClose={() => setShowEmailModal(false)}
                currentEmail={profile?.email || ""}
            />
        </div>
    );
}

export default MasterAdminLayout;
