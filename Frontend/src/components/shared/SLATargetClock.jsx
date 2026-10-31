import React, { useState, useEffect } from 'react';
import { Clock, AlertTriangle, Flame, CheckCircle2, ShieldCheck } from 'lucide-react';
import {
  calculateSlaCountdown,
  formatTickingOffset,
  getSlaStatusTheme,
} from '../../utils/slaUtils.js';

/**
 * SLATargetClock — Visual Target Clock & Ticking Countdown Indicator (issue #3904)
 *
 * Displays a real-time ticking instrument dial showing duration offsets left to resolve
 * ticket bounds, with dynamic color transitions and priority bounds.
 *
 * Props:
 * - createdAt: ISO string or timestamp
 * - priority: 'critical' | 'high' | 'medium' | 'low'
 * - status: ticket status string (e.g. 'open', 'in_progress', 'resolved', 'closed')
 * - resolvedAt: optional resolution timestamp
 * - customHours: optional override for target bound hours
 * - variant: 'dial' | 'compact' | 'badge' (default: 'compact')
 * - showTargetBound: boolean (default: true)
 */
export default function SLATargetClock({
  createdAt,
  priority = 'normal',
  status = 'open',
  resolvedAt = null,
  customHours = null,
  variant = 'compact',
  showTargetBound = true,
  className = '',
}) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    // Tick every second for live duration offsets
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const info = calculateSlaCountdown(createdAt, priority, {
    now,
    ticketStatus: status,
    customHours,
    resolvedAt,
  });

  const theme = getSlaStatusTheme(info.status);

  if (!info.isValid) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-mono text-slate-400">
        <Clock size={12} />
        --:--:--
      </span>
    );
  }

  // Visual dial dimensions
  const size = variant === 'dial' ? 120 : 36;
  const strokeWidth = variant === 'dial' ? 8 : 3.5;
  const radius = (size - strokeWidth * 2) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (info.progressPct / 100) * circumference;

  // Format ticking readout
  const offsetTimeStr = info.isBreached
    ? formatTickingOffset(info.remainingMs, { showSign: true })
    : formatTickingOffset(info.remainingMs);

  // Status icon selector
  const StatusIcon = info.isResolved
    ? ShieldCheck
    : info.isBreached
    ? Flame
    : info.status === 'critical'
    ? AlertTriangle
    : Clock;

  // Compact variant: for table rows, compact lists, and headers
  if (variant === 'compact') {
    return (
      <div
        className={`inline-flex items-center gap-2 px-2.5 py-1 rounded-full border text-xs font-mono font-bold transition-all ${className}`}
        style={{
          backgroundColor: theme.bg,
          borderColor: theme.border,
          color: theme.text,
        }}
        title={`Target: ${priority?.toUpperCase()} SLA • Bound: ${info.deadline.toLocaleTimeString()} • ${theme.label}`}
      >
        {/* Mini SVG Target Dial */}
        <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
          <svg width={size} height={size} className="-rotate-90">
            {/* Background track */}
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="transparent"
              stroke="#e2e8f0"
              strokeWidth={strokeWidth}
            />
            {/* Ticking Progress Arc */}
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="transparent"
              stroke={theme.primary}
              strokeWidth={strokeWidth}
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              strokeLinecap="round"
              className="transition-[stroke-dashoffset] duration-500 ease-linear"
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <StatusIcon
              size={14}
              color={theme.primary}
              className={theme.pulse ? 'animate-pulse' : ''}
            />
          </div>
        </div>

        {/* Ticking readout & label */}
        <div className="flex flex-col leading-none">
          <span className="text-[11px] tracking-tight">
            {info.isResolved ? 'MET' : offsetTimeStr}
          </span>
          {showTargetBound && (
            <span className="text-[9px] uppercase font-sans font-semibold tracking-wider opacity-75">
              {info.isResolved ? 'SLA Passed' : info.isBreached ? 'Breached' : 'To Resolve'}
            </span>
          )}
        </div>
      </div>
    );
  }

  // Badge variant: minimal pill
  if (variant === 'badge') {
    return (
      <span
        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[10px] font-mono font-bold uppercase tracking-wider ${className}`}
        style={{
          backgroundColor: theme.bg,
          borderColor: theme.border,
          color: theme.text,
        }}
        title={`SLA Target: ${priority} • Deadline: ${info.deadline.toLocaleString()}`}
      >
        <span
          className={`w-1.5 h-1.5 rounded-full ${theme.pulse ? 'animate-ping' : ''}`}
          style={{ backgroundColor: theme.primary }}
        />
        <StatusIcon size={11} color={theme.primary} />
        {info.isResolved ? 'SLA Met' : offsetTimeStr}
      </span>
    );
  }

  // Full 'dial' instrument variant: for ticket detail pages and dashboard analytics
  const quadrantTicks = [0, 90, 180, 270];

  return (
    <div
      className={`flex flex-col items-center p-4 rounded-2xl border bg-white/90 shadow-sm backdrop-blur-sm ${className}`}
      style={{ borderColor: theme.border }}
    >
      {/* Dial Header */}
      <div className="w-full flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-1.5">
          <StatusIcon
            size={16}
            color={theme.primary}
            className={theme.pulse ? 'animate-bounce' : ''}
          />
          <span className="text-xs font-black uppercase tracking-wider text-slate-800">
            Target SLA Clock
          </span>
        </div>
        <span
          className="text-[10px] font-black uppercase px-2 py-0.5 rounded-md"
          style={{
            backgroundColor: theme.bg,
            color: theme.text,
            border: `1px solid ${theme.border}`,
          }}
        >
          {info.status.replace('_', ' ')}
        </span>
      </div>

      {/* Radial Target Clock Instrument */}
      <div className="relative my-2 flex items-center justify-center" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          {/* Subtle outer track */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="transparent"
            stroke="#f1f5f9"
            strokeWidth={strokeWidth}
          />

          {/* Quadrant instrument ticks */}
          {quadrantTicks.map((deg) => (
            <line
              key={deg}
              x1={size / 2}
              y1={strokeWidth / 2}
              x2={size / 2}
              y2={strokeWidth * 1.5}
              stroke="#cbd5e1"
              strokeWidth={1.5}
              transform={`rotate(${deg} ${size / 2} ${size / 2})`}
            />
          ))}

          {/* Animated active progress arc */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="transparent"
            stroke={theme.primary}
            strokeWidth={strokeWidth}
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            className="transition-[stroke-dashoffset] duration-700 ease-out"
          />
        </svg>

        {/* Center Digital Readout */}
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center select-none pointer-events-none">
          <span
            className="font-mono font-black text-sm tracking-tight"
            style={{ color: theme.text }}
          >
            {info.isResolved ? '00:00:00' : offsetTimeStr}
          </span>
          <span className="text-[9px] uppercase font-bold tracking-widest text-slate-400 mt-0.5">
            {info.isResolved ? 'RESOLVED' : info.isBreached ? 'OVERDUE' : 'OFFSET LEFT'}
          </span>
        </div>
      </div>

      {/* Target bounds summary */}
      <div className="w-full mt-3 pt-3 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500 font-medium">
        <span>Target Bound:</span>
        <span className="font-bold text-slate-800">
          {priority.toUpperCase()} ({Math.round(info.targetMs / 3600000)}h SLA)
        </span>
      </div>
      <div className="w-full flex items-center justify-between text-[11px] text-slate-500 font-medium mt-1">
        <span>Target Deadline:</span>
        <span className="font-mono font-bold text-slate-700">
          {info.deadline.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
    </div>
  );
}
