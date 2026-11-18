import React, { useState } from 'react';
import { Box, MessageSquare, Menu, X, LogOut, User as UserIcon, BookOpen, HelpCircle, PlusCircle } from 'lucide-react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { Avatar, AvatarFallback, AvatarImage } from "../../components/ui/avatar";
import NotificationPopover from "./NotificationPopover";
import useAuthStore from "../../store/authStore";

const TopNav = () => {
    const navigate = useNavigate();
    const { profile, logout } = useAuthStore();
    const [isMenuOpen, setIsMenuOpen] = useState(false);

    const initials = profile?.full_name
        ? profile.full_name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
        : (profile?.email ? profile.email[0].toUpperCase() : 'U');

    const handleLogout = async () => {
        setIsMenuOpen(false);
        await logout();
        navigate('/login');
    };

    const navLinkClass = ({ isActive }) =>
        `text-sm font-semibold transition-colors ${
            isActive ? 'text-emerald-700' : 'text-gray-500 hover:text-gray-900'
        }`;

    return (
        <header className="w-full bg-white/90 backdrop-blur-lg border-b border-emerald-950/[0.06] sticky top-0 z-40 pt-safe">
            <div className="max-w-[1100px] mx-auto px-4 md:px-6 h-14 md:h-16 flex items-center justify-between">
                {/* Left: Logo */}
                <div
                    className="flex items-center gap-2.5 cursor-pointer select-none active:scale-[0.98] transition-transform"
                    onClick={() => navigate('/dashboard')}
                >
                    <div className="w-8 h-8 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-center overflow-hidden shadow-xs">
                        <img src="/favicon.png" alt="HELPDESK.AI Logo" className="w-5 h-5 object-contain" />
                    </div>
                    <div className="flex flex-col">
                        <h1 className="text-base md:text-xl font-black tracking-tighter text-gray-900 italic leading-none">
                            HELPDESK<span className="text-emerald-600">.AI</span>
                        </h1>
                        <span className="md:hidden text-[10px] font-semibold text-emerald-700/80 tracking-wide truncate max-w-[140px]">
                            {profile?.company || 'RITESH PVT LTD'}
                        </span>
                    </div>
                </div>

                {/* Center: Desktop Navigation Links */}
                <nav className="hidden md:flex items-center gap-8">
                    <NavLink className={navLinkClass} to="/dashboard">Dashboard</NavLink>
                    <NavLink className={navLinkClass} to="/my-tickets">My Tickets</NavLink>
                    <NavLink className={navLinkClass} to="/help">Help</NavLink>
                    <NavLink className={navLinkClass} to="/docs">Documentation</NavLink>
                </nav>

                {/* Right: Notifications, Avatar & Mobile Menu */}
                <div className="flex items-center gap-2 md:gap-3">
                    <NotificationPopover />
                    <Avatar
                        onClick={() => navigate('/profile')}
                        className="size-8 md:size-9 border border-emerald-200 cursor-pointer hover:ring-2 hover:ring-emerald-500 hover:ring-offset-2 transition-all"
                    >
                        <AvatarImage src={profile?.profile_picture} />
                        <AvatarFallback className="bg-emerald-50 font-bold text-emerald-700 text-xs">{initials}</AvatarFallback>
                    </Avatar>
                    <button
                        type="button"
                        onClick={() => setIsMenuOpen(!isMenuOpen)}
                        aria-label="Toggle Menu"
                        className="md:hidden w-9 h-9 rounded-xl bg-slate-50 border border-slate-200/80 flex items-center justify-center text-slate-700 active:scale-95 transition-all"
                    >
                        {isMenuOpen ? <X size={19} /> : <Menu size={19} />}
                    </button>
                </div>
            </div>

            {/* Mobile Quick Sheet Menu */}
            {isMenuOpen && (
                <>
                    <div
                        className="md:hidden fixed inset-0 top-14 bg-slate-950/40 backdrop-blur-xs z-40"
                        onClick={() => setIsMenuOpen(false)}
                    />
                    <div className="md:hidden bg-white border-t border-slate-100 absolute inset-x-0 shadow-2xl z-50 rounded-b-3xl animate-in fade-in slide-in-from-top-2 duration-200">
                        <div className="px-5 py-5 space-y-4">
                            <div className="flex items-center gap-3.5 p-3.5 rounded-2xl bg-slate-50 border border-slate-100">
                                <Avatar className="size-11 border border-emerald-100">
                                    <AvatarImage src={profile?.profile_picture} />
                                    <AvatarFallback className="bg-emerald-100 text-emerald-800 font-black text-sm">{initials}</AvatarFallback>
                                </Avatar>
                                <div className="min-w-0 flex-1">
                                    <p className="font-bold text-slate-900 text-sm truncate">{profile?.full_name || 'User'}</p>
                                    <p className="text-xs text-slate-500 font-medium truncate">{profile?.email}</p>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-2.5">
                                <Link
                                    to="/create-ticket"
                                    onClick={() => setIsMenuOpen(false)}
                                    className="col-span-2 flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white font-bold text-sm shadow-md shadow-emerald-600/20 active:scale-[0.98] transition-all"
                                >
                                    <PlusCircle size={17} /> Report New Issue
                                </Link>
                                <Link
                                    to="/dashboard"
                                    onClick={() => setIsMenuOpen(false)}
                                    className="flex items-center gap-2.5 p-3 rounded-xl bg-slate-50 text-slate-700 font-semibold text-sm active:scale-95 transition-all"
                                >
                                    <Box size={17} className="text-emerald-600" /> Dashboard
                                </Link>
                                <Link
                                    to="/my-tickets"
                                    onClick={() => setIsMenuOpen(false)}
                                    className="flex items-center gap-2.5 p-3 rounded-xl bg-slate-50 text-slate-700 font-semibold text-sm active:scale-95 transition-all"
                                >
                                    <MessageSquare size={17} className="text-emerald-600" /> Tickets
                                </Link>
                                <Link
                                    to="/help"
                                    onClick={() => setIsMenuOpen(false)}
                                    className="flex items-center gap-2.5 p-3 rounded-xl bg-slate-50 text-slate-700 font-semibold text-sm active:scale-95 transition-all"
                                >
                                    <HelpCircle size={17} className="text-emerald-600" /> Help Center
                                </Link>
                                <Link
                                    to="/docs"
                                    onClick={() => setIsMenuOpen(false)}
                                    className="flex items-center gap-2.5 p-3 rounded-xl bg-slate-50 text-slate-700 font-semibold text-sm active:scale-95 transition-all"
                                >
                                    <BookOpen size={17} className="text-emerald-600" /> Docs
                                </Link>
                                <Link
                                    to="/profile"
                                    onClick={() => setIsMenuOpen(false)}
                                    className="col-span-2 flex items-center gap-2.5 p-3 rounded-xl bg-slate-50 text-slate-700 font-semibold text-sm active:scale-95 transition-all"
                                >
                                    <UserIcon size={17} className="text-emerald-600" /> My Profile &amp; Email Settings
                                </Link>
                            </div>

                            <button
                                type="button"
                                onClick={handleLogout}
                                className="w-full py-3 bg-red-50 border border-red-100 rounded-xl flex items-center justify-center gap-2 text-red-600 font-bold text-sm active:scale-95 transition-all"
                            >
                                <LogOut size={16} /> Sign Out
                            </button>
                        </div>
                    </div>
                </>
            )}
        </header>
    );
};

export default TopNav;
