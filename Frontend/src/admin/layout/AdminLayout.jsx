import React, { useState } from 'react';
import { Outlet } from 'react-router-dom';
import AdminSidebar from '../components/AdminSidebar';
import AdminHeader from '../components/AdminHeader';
import AdminMobileBottomNav from '../components/AdminMobileBottomNav';
import NotificationToast from '../../user/components/NotificationToast';

/**
 * AdminLayout Component
 * Responsive administrative shell: fixed desktop sidebar + native mobile bottom dock & slide-over drawer.
 */
const AdminLayout = () => {
    const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
    const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

    return (
        <div className="flex h-[100dvh] bg-[#f6f8f7] overflow-hidden font-sans">
            {/* Desktop Sidebar (>= md) */}
            <div
                className="hidden md:block flex-shrink-0 relative z-40 transition-all duration-300"
                style={{ width: isSidebarCollapsed ? '80px' : '260px' }}
            >
                <AdminSidebar
                    isCollapsed={isSidebarCollapsed}
                    onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
                />
            </div>

            {/* Viewport Execution Layer */}
            <div className="flex-1 flex flex-col min-w-0 relative h-full">
                {/* Global Command Header */}
                <AdminHeader
                    onMobileNavToggle={() => setIsMobileNavOpen(!isMobileNavOpen)}
                    isSidebarCollapsed={isSidebarCollapsed}
                    onToggleSidebar={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
                />

                {/* Operational Workspace */}
                <main className="flex-1 overflow-x-hidden overflow-y-auto custom-scrollbar relative">
                    <div className="max-w-[1280px] w-full mx-auto px-4 sm:px-6 md:px-10 py-4 sm:py-6 md:py-10 pb-24 md:pb-12 animate-in fade-in duration-500">
                        <Outlet />
                    </div>
                </main>
            </div>

            {/* Native Mobile Bottom Dock (< md) */}
            <AdminMobileBottomNav />

            {/* Real-time System Notifications */}
            <NotificationToast />

            {/* Mobile Slide-Over Drawer (< md) */}
            {isMobileNavOpen && (
                <div
                    className="fixed inset-0 bg-slate-950/65 backdrop-blur-sm z-50 md:hidden flex transition-opacity duration-200"
                    onClick={() => setIsMobileNavOpen(false)}
                >
                    <div
                        className="w-[82%] max-w-[290px] h-full shadow-2xl animate-in slide-in-from-left duration-200"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <AdminSidebar isMobile={true} onClose={() => setIsMobileNavOpen(false)} />
                    </div>
                </div>
            )}
        </div>
    );
};

export default AdminLayout;
