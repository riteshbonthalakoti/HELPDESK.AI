import React, { useState } from 'react';
import {
    Settings,
    Cpu,
    Inbox,
    Bell,
    Save,
    ShieldCheck,
    Mail
} from 'lucide-react';
import useAdminStore from '../store/adminStore';
import useAuthStore from '../../store/authStore';
import { Card, CardContent } from "../../components/ui/card";
import { Select } from "../../components/ui/select";
import EmailChangeModal from "../../components/shared/EmailChangeModal";

/**
 * AdminSettings Page
 * Comprehensive configuration for account email verification, system parameters, AI thresholds, and notifications.
 */
const AdminSettings = () => {
    const { settings, updateSettings } = useAdminStore();
    const { profile, user } = useAuthStore();
    const [showEmailModal, setShowEmailModal] = useState(false);
    const currentEmail = profile?.email || user?.email || '';

    // Handlers
    const handleChange = (key, value) => {
        updateSettings({ [key]: value });
    };

    return (
        <div className="max-w-4xl mx-auto py-2 sm:py-6 space-y-6 sm:space-y-10 pb-8 sm:pb-20 animate-in fade-in duration-500">
            {/* 1. Header Area */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 sm:gap-6">
                <div>
                    <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight italic uppercase flex items-center gap-2.5 sm:gap-3">
                        <Settings size={24} className="text-indigo-600 sm:w-7 sm:h-7" /> Settings
                    </h1>
                    <p className="text-xs sm:text-sm font-bold text-slate-400 mt-1 flex items-center gap-2 uppercase tracking-[0.16em] sm:tracking-[0.2em]">
                        <ShieldCheck size={14} className="text-emerald-500" /> Administrator Account
                    </p>
                </div>
            </div>

            <div className="space-y-5 sm:space-y-8">
                {/* 1b. Account & Verified Gmail Settings */}
                <Card className="border-none shadow-lg sm:shadow-2xl shadow-slate-200/40 rounded-2xl sm:rounded-[2rem] overflow-hidden bg-white">
                    <div className="px-5 sm:px-8 py-4 sm:py-6 bg-gradient-to-r from-slate-900 to-emerald-950 text-white flex items-center justify-between border-b border-slate-800">
                        <h3 className="text-xs sm:text-sm font-black uppercase italic tracking-tight flex items-center gap-2.5 sm:gap-3">
                            <Mail size={17} className="text-emerald-400 shrink-0" /> Account Email / Gmail Verification
                        </h3>
                    </div>
                    <CardContent className="p-5 sm:p-8 flex flex-col md:flex-row md:items-center justify-between gap-4 sm:gap-6">
                        <div className="space-y-1.5 min-w-0">
                            <h4 className="text-[11px] sm:text-xs font-black text-slate-700 uppercase tracking-widest">
                                Registered Company Admin Email
                            </h4>
                            <p className="text-sm font-mono font-bold text-slate-900 break-all">
                                {currentEmail || 'Not configured'}
                            </p>
                            <p className="text-xs text-slate-500 leading-relaxed">
                                Switch your {profile?.company || 'RITESH PVT LTD'} email directly using a 6-digit OTP sent to your new email.
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={() => setShowEmailModal(true)}
                            className="w-full md:w-auto inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black uppercase tracking-widest shadow-lg shadow-emerald-600/20 active:scale-[0.98] transition shrink-0 cursor-pointer"
                        >
                            <Mail size={15} /> Change &amp; Verify Email
                        </button>
                    </CardContent>
                </Card>

                {/* 2. System Settings (AI Parameters) */}
                <Card className="border-none shadow-lg sm:shadow-2xl shadow-slate-200/40 rounded-2xl sm:rounded-[2rem] overflow-hidden bg-white">
                    <div className="px-5 sm:px-8 py-4 sm:py-6 bg-slate-900 text-white flex items-center justify-between border-b border-slate-800">
                        <h3 className="text-xs sm:text-sm font-black uppercase italic tracking-tight flex items-center gap-2.5 sm:gap-3">
                            <Cpu size={17} className="text-indigo-400" /> AI Settings
                        </h3>
                    </div>
                    <CardContent className="p-5 sm:p-8 space-y-6 sm:space-y-8">
                        {/* AI Confidence Threshold */}
                        <div className="space-y-4">
                            <div className="flex justify-between items-center">
                                <label className="text-xs font-black text-slate-700 uppercase tracking-widest">
                                    AI Confidence Threshold (<span className="text-indigo-600">{(settings.aiConfidenceThreshold * 100).toFixed(0)}%</span>)
                                </label>
                            </div>
                            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest max-w-lg mb-2">
                                Minimum confidence required for AI to process and categorize tickets automatically.
                            </p>
                            <input
                                type="range"
                                min="0"
                                max="1"
                                step="0.05"
                                value={settings.aiConfidenceThreshold}
                                onChange={(e) => handleChange('aiConfidenceThreshold', parseFloat(e.target.value))}
                                className="w-full h-2 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                            />
                        </div>

                        {/* Duplicate Detection Sensitivity */}
                        <div className="space-y-4 pt-4 border-t border-slate-100">
                            <div className="flex justify-between items-center">
                                <label className="text-xs font-black text-slate-700 uppercase tracking-widest">
                                    Duplicate Detection (<span className="text-indigo-600">{(settings.duplicateSensitivity * 100).toFixed(0)}%</span>)
                                </label>
                            </div>
                            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest max-w-lg mb-2">
                                Semantic similarity score needed to flag incoming tickets as duplicates.
                            </p>
                            <input
                                type="range"
                                min="0"
                                max="1"
                                step="0.05"
                                value={settings.duplicateSensitivity}
                                onChange={(e) => handleChange('duplicateSensitivity', parseFloat(e.target.value))}
                                className="w-full h-2 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                            />
                        </div>

                        {/* Auto Resolve Toggle */}
                        <div className="flex items-center justify-between pt-4 border-t border-slate-100">
                            <div>
                                <h4 className="text-xs font-black text-slate-700 uppercase tracking-widest">Enable Auto Resolve</h4>
                                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1">Allow AI to close easily solved requests.</p>
                            </div>
                            <button
                                onClick={() => handleChange('enableAutoResolve', !settings.enableAutoResolve)}
                                className={`w-14 h-8 rounded-full relative transition-all duration-300 shadow-inner shrink-0 ${settings.enableAutoResolve ? 'bg-indigo-600' : 'bg-slate-200'}`}
                            >
                                <div className={`absolute top-1 w-6 h-6 bg-white rounded-full transition-all duration-300 shadow-md ${settings.enableAutoResolve ? 'right-1' : 'left-1'}`}></div>
                            </button>
                        </div>
                    </CardContent>
                </Card>

                {/* 3. Ticket Settings */}
                <Card className="border-none shadow-2xl shadow-slate-200/40 rounded-[2rem] overflow-hidden bg-white">
                    <div className="px-8 py-6 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
                        <h3 className="text-sm font-black text-slate-900 uppercase italic tracking-tight flex items-center gap-3">
                            <Inbox size={18} className="text-emerald-500" /> Ticket Settings
                        </h3>
                    </div>
                    <CardContent className="p-8 space-y-6">
                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                            <div>
                                <h4 className="text-xs font-black text-slate-700 uppercase tracking-widest">Auto-Close Tickets</h4>
                                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1">Automatically archive resolved tickets after inactivity.</p>
                            </div>
                            <Select
                                value={settings.autoCloseDays}
                                onChange={(e) => handleChange('autoCloseDays', parseInt(e.target.value))}
                                className="w-full md:w-auto"
                                buttonClassName="w-full md:w-auto min-w-[140px] bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-black text-slate-700 uppercase outline-none focus:border-indigo-600 transition-colors flex justify-between items-center"
                                options={[
                                    { value: 3, label: "3 Days" },
                                    { value: 7, label: "7 Days" },
                                    { value: 14, label: "14 Days" }
                                ]}
                            />
                        </div>
                    </CardContent>
                </Card>

                {/* 4. Notification Settings */}
                <Card className="border-none shadow-2xl shadow-slate-200/40 rounded-[2rem] overflow-hidden bg-white">
                    <div className="px-8 py-6 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
                        <h3 className="text-sm font-black text-slate-900 uppercase italic tracking-tight flex items-center gap-3">
                            <Bell size={18} className="text-amber-500" /> Notifications
                        </h3>
                    </div>
                    <CardContent className="p-8 space-y-6">
                        {/* Email Notifications toggle */}
                        <div className="flex items-center justify-between pb-4 border-b border-slate-100">
                            <div>
                                <h4 className="text-xs font-black text-slate-700 uppercase tracking-widest">Email Notifications</h4>
                                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1">Receive daily system digests via email.</p>
                            </div>
                            <button
                                onClick={() => handleChange('emailNotifications', !settings.emailNotifications)}
                                className={`w-14 h-8 rounded-full relative transition-all duration-300 shadow-inner shrink-0 ${settings.emailNotifications ? 'bg-amber-500' : 'bg-slate-200'}`}
                            >
                                <div className={`absolute top-1 w-6 h-6 bg-white rounded-full transition-all duration-300 shadow-md ${settings.emailNotifications ? 'right-1' : 'left-1'}`}></div>
                            </button>
                        </div>

                        {/* Admin Alert Notifications toggle */}
                        <div className="flex items-center justify-between">
                            <div>
                                <h4 className="text-xs font-black text-slate-700 uppercase tracking-widest">Critical Admin Alerts</h4>
                                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1">Push notifications for Priority 1 system events.</p>
                            </div>
                            <button
                                onClick={() => handleChange('adminAlerts', !settings.adminAlerts)}
                                className={`w-14 h-8 rounded-full relative transition-all duration-300 shadow-inner shrink-0 ${settings.adminAlerts ? 'bg-amber-500' : 'bg-slate-200'}`}
                            >
                                <div className={`absolute top-1 w-6 h-6 bg-white rounded-full transition-all duration-300 shadow-md ${settings.adminAlerts ? 'right-1' : 'left-1'}`}></div>
                            </button>
                        </div>
                    </CardContent>
                </Card>
            </div>

            <EmailChangeModal
                isOpen={showEmailModal}
                onClose={() => setShowEmailModal(false)}
                currentEmail={currentEmail}
            />
        </div>
    );
};

export default AdminSettings;
