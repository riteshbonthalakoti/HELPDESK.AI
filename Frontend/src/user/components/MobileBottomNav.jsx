import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { Home, Ticket, Plus, Bell, User } from 'lucide-react';

const MobileBottomNav = () => {
    const navigate = useNavigate();

    const leftItems = [
        { label: 'Home', path: '/dashboard', icon: Home },
        { label: 'Tickets', path: '/my-tickets', icon: Ticket },
    ];

    const rightItems = [
        { label: 'Alerts', path: '/notifications', icon: Bell },
        { label: 'Profile', path: '/profile', icon: User },
    ];

    const renderNavItem = (item) => (
        <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) =>
                `flex flex-col items-center justify-center gap-1 py-1.5 px-2 rounded-2xl min-w-[60px] transition-all active:scale-95 ${
                    isActive
                        ? 'text-emerald-700'
                        : 'text-slate-400 hover:text-slate-600'
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
                        <item.icon size={19} strokeWidth={isActive ? 2.4 : 1.9} />
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
    );

    return (
        <nav
            aria-label="Mobile Navigation"
            className="md:hidden fixed bottom-0 inset-x-0 z-50 mobile-glass-dock border-t border-emerald-950/[0.06] px-2 pt-1.5 pb-safe"
        >
            <div className="max-w-md mx-auto grid grid-cols-5 items-center">
                {leftItems.map(renderNavItem)}

                {/* Center Elevated New Ticket FAB */}
                <div className="flex flex-col items-center justify-center -mt-6">
                    <button
                        type="button"
                        onClick={() => navigate('/create-ticket')}
                        aria-label="Create New Ticket"
                        className="w-14 h-14 rounded-2xl bg-gradient-to-br from-emerald-500 via-emerald-600 to-teal-600 text-white flex items-center justify-center shadow-[0_8px_24px_rgba(16,185,129,0.45)] ring-4 ring-white active:scale-90 transition-transform"
                    >
                        <Plus size={26} strokeWidth={2.6} />
                    </button>
                    <span className="text-[10px] font-bold text-emerald-700 mt-1 leading-none">
                        New
                    </span>
                </div>

                {rightItems.map(renderNavItem)}
            </div>
        </nav>
    );
};

export default MobileBottomNav;
