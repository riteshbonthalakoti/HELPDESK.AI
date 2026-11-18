import React from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Inbox, Users, BarChart3, Settings } from 'lucide-react';

const AdminMobileBottomNav = () => {
    const items = [
        { label: 'Overview', path: '/admin/dashboard', icon: LayoutDashboard },
        { label: 'Tickets', path: '/admin/tickets', icon: Inbox },
        { label: 'Users', path: '/admin/users', icon: Users },
        { label: 'Analytics', path: '/admin/analytics', icon: BarChart3 },
        { label: 'Settings', path: '/admin/settings', icon: Settings },
    ];

    return (
        <nav
            aria-label="Admin Mobile Navigation"
            className="md:hidden fixed bottom-0 inset-x-0 z-40 mobile-glass-dock border-t border-emerald-950/[0.06] px-1.5 pt-1.5 pb-safe"
        >
            <div className="max-w-lg mx-auto grid grid-cols-5 items-center">
                {items.map((item) => (
                    <NavLink
                        key={item.path}
                        to={item.path}
                        className={({ isActive }) =>
                            `flex flex-col items-center justify-center gap-1 py-1.5 px-1 rounded-2xl transition-all active:scale-95 ${
                                isActive ? 'text-emerald-700' : 'text-slate-400 hover:text-slate-600'
                            }`
                        }
                    >
                        {({ isActive }) => (
                            <>
                                <div
                                    className={`flex items-center justify-center w-9 h-7 rounded-full transition-all ${
                                        isActive ? 'bg-emerald-100/90 text-emerald-700' : 'bg-transparent'
                                    }`}
                                >
                                    <item.icon size={18} strokeWidth={isActive ? 2.4 : 1.9} />
                                </div>
                                <span
                                    className={`text-[10px] leading-none tracking-tight ${
                                        isActive ? 'font-bold text-emerald-800' : 'font-medium text-slate-500'
                                    }`}
                                >
                                    {item.label}
                                </span>
                            </>
                        )}
                    </NavLink>
                ))}
            </div>
        </nav>
    );
};

export default AdminMobileBottomNav;
