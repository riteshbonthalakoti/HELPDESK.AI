import React, { useState, useRef, useEffect } from 'react';
import { Search, Menu, ChevronDown, Settings, LogOut, UserCircle, X, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import NotificationPopover from '../../user/components/NotificationPopover';
import useAuthStore from '../../store/authStore';
import { Avatar, AvatarFallback, AvatarImage } from "../../components/ui/avatar";

const AdminHeader = ({ onMobileNavToggle, isSidebarCollapsed, onToggleSidebar }) => {
    const [isProfileOpen, setIsProfileOpen] = useState(false);
    const [isMobileSearchOpen, setIsMobileSearchOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const dropdownRef = useRef(null);
    const searchRef = useRef(null);
    const mobileSearchRef = useRef(null);
    const navigate = useNavigate();
    const { logout, profile: adminProfile } = useAuthStore();
    const initials = adminProfile?.full_name
        ? adminProfile.full_name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
        : 'AD';

    const handleSearchKeyDown = (e) => {
        if (e.key === 'Enter' && searchQuery.trim()) {
            navigate(`/admin/tickets?q=${encodeURIComponent(searchQuery.trim())}`);
            searchRef.current?.blur();
            mobileSearchRef.current?.blur();
            setIsMobileSearchOpen(false);
        } else if (e.key === 'Escape') {
            setSearchQuery('');
            searchRef.current?.blur();
            setIsMobileSearchOpen(false);
        }
    };

    const handleSearchClear = () => {
        setSearchQuery('');
        searchRef.current?.focus();
    };

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
                setIsProfileOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    useEffect(() => {
        if (isMobileSearchOpen) {
            setTimeout(() => mobileSearchRef.current?.focus(), 60);
        }
    }, [isMobileSearchOpen]);

    const handleLogout = async () => {
        await logout();
        navigate('/login');
    };

    return (
        <header className="bg-white/90 backdrop-blur-lg border-b border-emerald-950/[0.06] sticky top-0 z-30 pt-safe">
            <div className="h-14 md:h-16 px-4 sm:px-6 md:px-10 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5 sm:gap-4 flex-1 min-w-0">
                    {/* Mobile Drawer Toggle (< md) */}
                    <button
                        type="button"
                        onClick={onMobileNavToggle}
                        aria-label="Open Navigation"
                        className="md:hidden w-9 h-9 rounded-xl bg-slate-50 border border-slate-200/80 flex items-center justify-center text-slate-700 active:scale-95 transition-all shrink-0"
                    >
                        <Menu size={19} />
                    </button>

                    {/* Mobile Compact Brand */}
                    <div
                        className="md:hidden flex items-center gap-2 min-w-0 cursor-pointer"
                        onClick={() => navigate('/admin/dashboard')}
                    >
                        <img src="/favicon.png" alt="Logo" className="w-6 h-6 object-contain shrink-0" />
                        <div className="min-w-0">
                            <p className="text-sm font-black italic tracking-tight text-slate-900 leading-none truncate">
                                HELPDESK<span className="text-emerald-600">.AI</span>
                            </p>
                            <p className="text-[10px] font-bold text-emerald-700/80 uppercase tracking-wider truncate">
                                {adminProfile?.company || 'RITESH PVT LTD'}
                            </p>
                        </div>
                    </div>

                    {/* Desktop Sidebar Toggle */}
                    {onToggleSidebar && (
                        <button
                            type="button"
                            onClick={onToggleSidebar}
                            className="hidden md:flex p-2 hover:bg-emerald-50 rounded-xl text-slate-400 hover:text-emerald-600 transition-all"
                            title={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                        >
                            {isSidebarCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
                        </button>
                    )}

                    {/* Desktop Search Terminal */}
                    <div className="flex-1 max-w-xl relative hidden md:block">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4 pointer-events-none" />
                        <input
                            ref={searchRef}
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            onKeyDown={handleSearchKeyDown}
                            placeholder="Search tickets, users… (press Enter)"
                            className="w-full bg-slate-50/60 border border-slate-200 rounded-xl pl-11 pr-9 py-2 text-sm font-medium tracking-tight focus:outline-none focus:ring-4 focus:ring-emerald-600/5 focus:border-emerald-600 focus:bg-white transition-all text-slate-600 placeholder:text-slate-400"
                        />
                        {searchQuery && (
                            <button
                                type="button"
                                onClick={handleSearchClear}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500 transition-colors"
                                tabIndex={-1}
                            >
                                <X size={14} />
                            </button>
                        )}
                    </div>
                </div>

                {/* Right Header Operations */}
                <div className="flex items-center gap-2 sm:gap-4 lg:gap-6 shrink-0">
                    {/* Mobile Search Toggle */}
                    <button
                        type="button"
                        onClick={() => setIsMobileSearchOpen(!isMobileSearchOpen)}
                        aria-label="Search Tickets"
                        className={`md:hidden w-9 h-9 rounded-xl flex items-center justify-center transition-all active:scale-95 ${
                            isMobileSearchOpen
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                : 'bg-slate-50 text-slate-600 border border-slate-200/80'
                        }`}
                    >
                        {isMobileSearchOpen ? <X size={17} /> : <Search size={17} />}
                    </button>

                    {/* Notifications (Always Visible) */}
                    <div className="relative sm:border-r sm:border-slate-200 sm:pr-4 lg:pr-6">
                        <NotificationPopover isAdmin={true} />
                    </div>

                    {/* Profile Avatar & Dropdown */}
                    <div className="relative" ref={dropdownRef}>
                        <button
                            type="button"
                            onClick={() => setIsProfileOpen(!isProfileOpen)}
                            className="flex items-center gap-2.5 hover:bg-slate-50 p-1 rounded-2xl border border-transparent hover:border-slate-100 transition-all group"
                        >
                            <Avatar className="w-8 h-8 rounded-xl shadow-xs group-hover:scale-105 transition-transform">
                                <AvatarImage src={adminProfile?.profile_picture} className="object-cover" />
                                <AvatarFallback className="bg-slate-900 text-white font-black text-xs rounded-xl">
                                    {initials}
                                </AvatarFallback>
                            </Avatar>
                            <div className="hidden lg:block text-left">
                                <div className="flex items-center gap-1">
                                    <p className="text-xs font-black text-slate-900 tracking-tight leading-none italic uppercase">Admin</p>
                                    <ChevronDown size={12} className={`text-slate-400 transition-transform duration-300 ${isProfileOpen ? 'rotate-180' : ''}`} />
                                </div>
                            </div>
                        </button>

                        {isProfileOpen && (
                            <div className="absolute right-0 mt-2 w-52 bg-white border border-slate-200 rounded-2xl shadow-xl shadow-slate-900/10 py-2 z-50 animate-in fade-in zoom-in-95 duration-150">
                                <div className="px-4 py-2 border-b border-slate-100 mb-1">
                                    <p className="text-xs font-bold text-slate-900 truncate">{adminProfile?.full_name || 'Admin'}</p>
                                    <p className="text-[11px] text-slate-400 truncate">{adminProfile?.email}</p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => { navigate('/admin/profile'); setIsProfileOpen(false); }}
                                    className="w-full flex items-center gap-3 px-4 py-2.5 text-xs font-bold text-slate-600 hover:bg-slate-50 hover:text-emerald-600 transition-colors"
                                >
                                    <UserCircle size={16} /> Profile
                                </button>
                                <button
                                    type="button"
                                    onClick={() => { navigate('/admin/settings'); setIsProfileOpen(false); }}
                                    className="w-full flex items-center gap-3 px-4 py-2.5 text-xs font-bold text-slate-600 hover:bg-slate-50 hover:text-emerald-600 transition-colors"
                                >
                                    <Settings size={16} /> Settings
                                </button>
                                <div className="my-1 border-t border-slate-100" />
                                <button
                                    type="button"
                                    onClick={handleLogout}
                                    className="w-full flex items-center gap-3 px-4 py-2.5 text-xs font-bold text-red-500 hover:bg-red-50 transition-colors"
                                >
                                    <LogOut size={16} /> Logout
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Expandable Mobile Search Bar */}
            {isMobileSearchOpen && (
                <div className="md:hidden px-4 pb-3 pt-1 border-t border-slate-100 bg-white animate-in fade-in slide-in-from-top-1 duration-150">
                    <div className="relative">
                        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-emerald-600 w-4 h-4 pointer-events-none" />
                        <input
                            ref={mobileSearchRef}
                            type="search"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            onKeyDown={handleSearchKeyDown}
                            placeholder="Search tickets or users…"
                            className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-10 pr-9 py-2.5 text-sm font-medium text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-emerald-500 focus:bg-white"
                        />
                        {searchQuery && (
                            <button
                                type="button"
                                onClick={() => setSearchQuery('')}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400"
                            >
                                <X size={15} />
                            </button>
                        )}
                    </div>
                </div>
            )}
        </header>
    );
};

export default AdminHeader;
