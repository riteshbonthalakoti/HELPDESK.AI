import React from 'react';
import { Outlet } from 'react-router-dom';
import TopNav from './components/TopNav';
import MobileBottomNav from './components/MobileBottomNav';
import NotificationToast from './components/NotificationToast';

const UserLayout = () => {
    return (
        <div className="bg-[#f6f8f7] min-h-[100dvh] flex flex-col text-slate-900 transition-colors duration-200 antialiased font-sans">
            <TopNav />
            {/* Routed content with safe bottom clearance for native mobile dock */}
            <div className="flex-1 flex flex-col pb-24 md:pb-0">
                <Outlet />
            </div>

            {/* Native-feel Mobile Bottom Navigation */}
            <MobileBottomNav />

            {/* Global real-time notifications popup */}
            <NotificationToast />
        </div>
    );
};

export default UserLayout;
