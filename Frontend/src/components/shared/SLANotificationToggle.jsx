import React from 'react';
import { Volume2, VolumeX, Bell, BellOff, ShieldAlert } from 'lucide-react';
import useSLAStore from '../../store/slaStore';

/**
 * SLANotificationToggle — Control bar or header widget to toggle
 * audio alerts and desktop notifications when tickets breach SLA.
 */
export default function SLANotificationToggle({ className = '', compact = false }) {
    const {
        soundEnabled,
        toggleSound,
        desktopNotificationsEnabled,
        toggleDesktopNotifications,
    } = useSLAStore();

    return (
        <div className={`inline-flex items-center gap-2 p-1.5 bg-slate-50 border border-slate-200 rounded-2xl shadow-sm ${className}`}>
            {!compact && (
                <div className="flex items-center gap-1.5 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-slate-500">
                    <ShieldAlert size={13} className="text-amber-500" />
                    <span>SLA Alerts</span>
                </div>
            )}

            {/* Sound Toggle */}
            <button
                type="button"
                onClick={toggleSound}
                title={soundEnabled ? 'SLA breach sound alert is ON (click to mute)' : 'SLA breach sound alert is MUTED (click to enable)'}
                className={`p-1.5 rounded-xl transition-all flex items-center gap-1 text-[10px] font-bold ${
                    soundEnabled
                        ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200'
                        : 'bg-slate-200 text-slate-500 hover:bg-slate-300'
                }`}
                aria-label="Toggle SLA sound alert"
            >
                {soundEnabled ? <Volume2 size={14} /> : <VolumeX size={14} />}
                {!compact && <span>{soundEnabled ? 'Sound ON' : 'Muted'}</span>}
            </button>

            {/* Desktop Notification Toggle */}
            <button
                type="button"
                onClick={toggleDesktopNotifications}
                title={
                    desktopNotificationsEnabled
                        ? 'Desktop notifications are ON (click to disable)'
                        : 'Desktop notifications are OFF (click to enable)'
                }
                className={`p-1.5 rounded-xl transition-all flex items-center gap-1 text-[10px] font-bold ${
                    desktopNotificationsEnabled
                        ? 'bg-indigo-100 text-indigo-800 hover:bg-indigo-200'
                        : 'bg-slate-200 text-slate-500 hover:bg-slate-300'
                }`}
                aria-label="Toggle SLA desktop notification"
            >
                {desktopNotificationsEnabled ? <Bell size={14} /> : <BellOff size={14} />}
                {!compact && <span>{desktopNotificationsEnabled ? 'Desktop ON' : 'Desktop OFF'}</span>}
            </button>
        </div>
    );
}
