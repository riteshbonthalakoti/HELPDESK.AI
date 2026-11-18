import React from 'react';
import { TrendingUp, TrendingDown } from "lucide-react";

/**
 * Reusable StatCard for Admin Metrics — tuned for 2x2 mobile bento grids and 4-column desktop rows.
 */
const StatCard = ({ label, value, subtitle, icon: Icon, trend, color = 'indigo', customIcon }) => {
    const semanticColors = {
        indigo: { bg: '#EEF2FF', text: '#6366f1', ring: 'border-indigo-100/80' },
        amber: { bg: '#FFF7ED', text: '#f97316', ring: 'border-amber-100/80' },
        emerald: { bg: '#F0FDF4', text: '#16a34a', ring: 'border-emerald-100/80' },
        red: { bg: '#FEF2F2', text: '#dc2626', ring: 'border-red-100/80' },
        slate: { bg: '#F8FAFC', text: '#64748B', ring: 'border-slate-100' }
    };
    const currentStyle = semanticColors[color] || semanticColors.slate;

    return (
        <div
            className={`bg-white rounded-2xl border ${currentStyle.ring} p-4 sm:p-5 md:p-6 shadow-xs hover:shadow-lg transition-all duration-200 active:scale-[0.98] md:hover:-translate-y-1 group relative overflow-hidden h-full`}
        >
            <div className="flex justify-between items-start gap-2">
                <div className="min-w-0 flex-1">
                    <p className="text-[10px] sm:text-[11px] text-slate-400 tracking-[0.08em] sm:tracking-[0.1em] font-bold uppercase mb-1.5 truncate">
                        {label}
                    </p>
                    <div className="flex items-baseline gap-1.5 sm:gap-2">
                        <p className="text-2xl sm:text-3xl md:text-4xl font-extrabold text-[#0f1f12] leading-none tracking-tight tabular-nums my-1">
                            {value}
                        </p>
                        {trend && (
                            <span className={`text-[10px] sm:text-[11px] font-bold inline-flex items-center gap-0.5 ${trend.startsWith('+') ? 'text-emerald-500' : 'text-red-500'}`}>
                                {trend.startsWith('+') ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
                                {trend}
                            </span>
                        )}
                    </div>
                    {subtitle && (
                        <p className="text-[11px] sm:text-xs text-slate-400 font-medium truncate mt-1">
                            {subtitle}
                        </p>
                    )}
                </div>
                <div
                    style={{ background: currentStyle.bg, color: currentStyle.text }}
                    className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center shrink-0 transition-transform duration-300 group-hover:scale-110"
                >
                    {customIcon || (Icon && <Icon size={18} />)}
                </div>
            </div>
        </div>
    );
};

export default StatCard;
