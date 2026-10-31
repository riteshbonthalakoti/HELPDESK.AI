import React, { useMemo, useState } from 'react';
import {
    ResponsiveContainer,
    ComposedChart,
    Bar,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    Legend,
    ReferenceLine,
    Cell
} from 'recharts';
import {
    Clock,
    BarChart3,
    TrendingUp,
    Calendar,
    Zap,
    CheckCircle2,
    Sliders,
    ArrowUpRight,
    Sparkles,
    ShieldCheck
} from 'lucide-react';
import {
    groupResolutionByWeekdayRange,
    formatDurationHours
} from '../../utils/performanceAnalyticsUtils';

const RANGE_MODES = [
    { id: 'daily', label: '7-Day Breakdown' },
    { id: 'tri_range', label: 'Early / Mid / Weekend' },
    { id: 'weekday_weekend', label: 'Weekday vs Weekend' }
];

const METRIC_VIEWS = [
    { id: 'dual', label: 'Duration & Compliance' },
    { id: 'duration', label: 'Duration Only' },
    { id: 'compliance', label: 'SLA Compliance' }
];

const CustomPerformanceTooltip = ({ active, payload, label }) => {
    if (!active || !payload || !payload.length) return null;
    const data = payload[0]?.payload;
    if (!data) return null;

    const complianceColor =
        data.slaComplianceRate >= 80 ? '#16a34a' :
        data.slaComplianceRate >= 60 ? '#f59e0b' : '#dc2626';

    return (
        <div style={{
            background: '#ffffff',
            borderRadius: '16px',
            border: '1px solid #f0fdf4',
            boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
            padding: '16px',
            minWidth: '220px'
        }}>
            <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-100">
                <span style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, color: '#0f1f12', fontSize: '13px' }}>
                    {data.label || label}
                </span>
                <span style={{
                    fontSize: '10px',
                    fontWeight: 700,
                    padding: '2px 8px',
                    borderRadius: '999px',
                    background: `${complianceColor}15`,
                    color: complianceColor
                }}>
                    {data.slaComplianceRate}% SLA
                </span>
            </div>

            <div className="space-y-1.5 text-xs">
                <div className="flex justify-between items-center text-slate-600">
                    <span className="flex items-center gap-1.5 text-slate-500">
                        <Clock size={12} className="text-emerald-600" /> Avg Resolution:
                    </span>
                    <strong className="text-slate-900 font-bold">{data.formattedAvg}</strong>
                </div>

                <div className="flex justify-between items-center text-slate-600">
                    <span className="flex items-center gap-1.5 text-slate-500">
                        <CheckCircle2 size={12} className="text-blue-600" /> Resolved Tickets:
                    </span>
                    <strong className="text-slate-900 font-bold">{data.totalResolved}</strong>
                </div>

                <div className="flex justify-between items-center text-slate-600">
                    <span className="flex items-center gap-1.5 text-slate-500">
                        <ShieldCheck size={12} className="text-purple-600" /> SLA Target:
                    </span>
                    <span className="text-slate-700 font-medium">{data.slaTargetHours}h Benchmark</span>
                </div>

                {data.totalResolved > 0 && (
                    <div className="pt-2 mt-2 border-t border-dashed border-slate-100 text-[10px] text-slate-400 flex justify-between">
                        <span>Fastest: {formatDurationHours(data.minDurationHours)}</span>
                        <span>Slowest: {formatDurationHours(data.maxDurationHours)}</span>
                    </div>
                )}
            </div>
        </div>
    );
};

export const PerformanceResolutionChart = ({
    tickets = [],
    title = 'Resolution Performance by Weekday',
    defaultTargetSlaHours = 4
}) => {
    const [rangeMode, setRangeMode] = useState('daily');
    const [metricView, setMetricView] = useState('dual');
    const [targetSlaHours, setTargetSlaHours] = useState(defaultTargetSlaHours);

    const chartData = useMemo(() => {
        return groupResolutionByWeekdayRange(tickets, rangeMode, { targetSlaHours });
    }, [tickets, rangeMode, targetSlaHours]);

    const summaryKPIs = useMemo(() => {
        const activeDays = chartData.filter(d => d.totalResolved > 0);
        if (!activeDays.length) {
            return {
                overallAvgHours: 0,
                fastestDay: 'N/A',
                slowestDay: 'N/A',
                overallCompliance: 100,
                totalResolvedCount: 0
            };
        }

        const totalResolved = activeDays.reduce((acc, d) => acc + d.totalResolved, 0);
        const weightedHours = activeDays.reduce((acc, d) => acc + (d.avgDurationHours * d.totalResolved), 0);
        const overallAvgHours = parseFloat((weightedHours / totalResolved).toFixed(2));

        const weightedCompliance = activeDays.reduce((acc, d) => acc + (d.slaComplianceRate * d.totalResolved), 0);
        const overallCompliance = parseFloat((weightedCompliance / totalResolved).toFixed(1));

        const sortedBySpeed = [...activeDays].sort((a, b) => a.avgDurationHours - b.avgDurationHours);
        const fastestDay = sortedBySpeed[0]?.day || 'N/A';
        const slowestDay = sortedBySpeed[sortedBySpeed.length - 1]?.day || 'N/A';

        return {
            overallAvgHours,
            fastestDay,
            slowestDay,
            overallCompliance,
            totalResolvedCount: totalResolved
        };
    }, [chartData]);

    const maxDurationInDataset = useMemo(() => {
        const max = Math.max(...chartData.map(d => d.avgDurationHours), targetSlaHours);
        return Math.ceil(max * 1.25) || 10;
    }, [chartData, targetSlaHours]);

    return (
        <div style={{
            background: '#ffffff',
            borderRadius: '20px',
            border: '1px solid #f0fdf4',
            boxShadow: '0 2px 16px rgba(0,0,0,0.05)',
            padding: '24px'
        }} className="w-full transition-all">
            {/* Header & Controls Bar */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
                <div>
                    <h3 style={{
                        fontFamily: 'Syne, sans-serif',
                        fontSize: '16px',
                        fontWeight: 700,
                        color: '#0f1f12',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        margin: 0
                    }}>
                        <Clock size={18} color="#22c55e" /> {title}
                    </h3>
                    <p style={{ fontSize: '11px', color: '#9ca3af', fontWeight: 600, marginTop: '4px' }}>
                        Average ticket resolution hours and SLA compliance across weekday ranges
                    </p>
                </div>

                {/* Range and Mode Toggles */}
                <div className="flex flex-wrap items-center gap-2">
                    {/* Range Selector */}
                    <div className="flex bg-slate-100/80 p-1 rounded-xl">
                        {RANGE_MODES.map((m) => (
                            <button
                                key={m.id}
                                onClick={() => setRangeMode(m.id)}
                                style={{
                                    fontSize: '11px',
                                    fontWeight: 700,
                                    padding: '4px 10px',
                                    borderRadius: '8px',
                                    border: 'none',
                                    background: rangeMode === m.id ? '#ffffff' : 'transparent',
                                    color: rangeMode === m.id ? '#0f1f12' : '#64748b',
                                    boxShadow: rangeMode === m.id ? '0 1px 4px rgba(0,0,0,0.06)' : 'none',
                                    cursor: 'pointer',
                                    transition: 'all 0.15s ease'
                                }}
                            >
                                {m.label}
                            </button>
                        ))}
                    </div>

                    {/* Metric View Selector */}
                    <div className="flex bg-emerald-50/60 p-1 rounded-xl">
                        {METRIC_VIEWS.map((v) => (
                            <button
                                key={v.id}
                                onClick={() => setMetricView(v.id)}
                                style={{
                                    fontSize: '11px',
                                    fontWeight: 700,
                                    padding: '4px 10px',
                                    borderRadius: '8px',
                                    border: 'none',
                                    background: metricView === v.id ? '#16a34a' : 'transparent',
                                    color: metricView === v.id ? '#ffffff' : '#15803d',
                                    boxShadow: metricView === v.id ? '0 1px 4px rgba(22,163,74,0.3)' : 'none',
                                    cursor: 'pointer',
                                    transition: 'all 0.15s ease'
                                }}
                            >
                                {v.label}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* Quick KPI Strip */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6 p-4 rounded-xl bg-slate-50/70 border border-slate-100">
                <div>
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Average Resolution</span>
                    <span className="text-base font-extrabold text-slate-900" style={{ fontFamily: 'Syne, sans-serif' }}>
                        {formatDurationHours(summaryKPIs.overallAvgHours)}
                    </span>
                </div>
                <div>
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">SLA Compliance</span>
                    <span className={`text-base font-extrabold ${summaryKPIs.overallCompliance >= 80 ? 'text-emerald-600' : 'text-amber-600'}`} style={{ fontFamily: 'Syne, sans-serif' }}>
                        {summaryKPIs.overallCompliance}%
                    </span>
                </div>
                <div>
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Fastest Day</span>
                    <span className="text-base font-extrabold text-emerald-600" style={{ fontFamily: 'Syne, sans-serif' }}>
                        {summaryKPIs.fastestDay}
                    </span>
                </div>
                <div>
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Resolved Volume</span>
                    <span className="text-base font-extrabold text-slate-900" style={{ fontFamily: 'Syne, sans-serif' }}>
                        {summaryKPIs.totalResolvedCount} tickets
                    </span>
                </div>
            </div>

            {/* Main Interactive Recharts Chart Area */}
            <div className="h-[320px] w-full">
                {chartData.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                            <defs>
                                <linearGradient id="colorPerfGreen" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor="#22c55e" stopOpacity={1} />
                                    <stop offset="100%" stopColor="#16a34a" stopOpacity={0.85} />
                                </linearGradient>
                                <linearGradient id="colorPerfAmber" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor="#fbbf24" stopOpacity={1} />
                                    <stop offset="100%" stopColor="#d97706" stopOpacity={0.85} />
                                </linearGradient>
                            </defs>

                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />

                            <XAxis
                                dataKey="day"
                                axisLine={false}
                                tickLine={false}
                                tick={{ fill: '#64748b', fontSize: 11, fontWeight: 700 }}
                                dy={8}
                            />

                            {/* Left Y-Axis: Duration (Hours) */}
                            {(metricView === 'dual' || metricView === 'duration') && (
                                <YAxis
                                    yAxisId="left"
                                    domain={[0, maxDurationInDataset]}
                                    axisLine={false}
                                    tickLine={false}
                                    tick={{ fill: '#9ca3af', fontSize: 10, fontWeight: 600 }}
                                    unit="h"
                                />
                            )}

                            {/* Right Y-Axis: Compliance Rate (%) */}
                            {(metricView === 'dual' || metricView === 'compliance') && (
                                <YAxis
                                    yAxisId="right"
                                    orientation="right"
                                    domain={[0, 100]}
                                    axisLine={false}
                                    tickLine={false}
                                    tick={{ fill: '#9ca3af', fontSize: 10, fontWeight: 600 }}
                                    unit="%"
                                />
                            )}

                            <Tooltip content={<CustomPerformanceTooltip />} />

                            <Legend
                                verticalAlign="top"
                                align="right"
                                height={36}
                                iconType="circle"
                                formatter={(value) => (
                                    <span style={{ fontSize: '11px', color: '#475569', fontWeight: 600 }}>
                                        {value}
                                    </span>
                                )}
                            />

                            {/* Target SLA Reference Line */}
                            {(metricView === 'dual' || metricView === 'duration') && (
                                <ReferenceLine
                                    yAxisId="left"
                                    y={targetSlaHours}
                                    stroke="#ef4444"
                                    strokeDasharray="4 4"
                                    strokeWidth={1.5}
                                    label={{
                                        value: `Target SLA (${targetSlaHours}h)`,
                                        position: 'insideTopRight',
                                        fill: '#ef4444',
                                        fontSize: 10,
                                        fontWeight: 700
                                    }}
                                />
                            )}

                            {/* Bar: Average Resolution Hours */}
                            {(metricView === 'dual' || metricView === 'duration') && (
                                <Bar
                                    yAxisId="left"
                                    dataKey="avgDurationHours"
                                    name="Avg Resolution (Hours)"
                                    radius={[8, 8, 0, 0]}
                                    barSize={rangeMode === 'daily' ? 28 : 52}
                                >
                                    {chartData.map((entry, index) => {
                                        const exceedsSla = entry.avgDurationHours > targetSlaHours;
                                        return (
                                            <Cell
                                                key={`cell-${index}`}
                                                fill={exceedsSla ? 'url(#colorPerfAmber)' : 'url(#colorPerfGreen)'}
                                            />
                                        );
                                    })}
                                </Bar>
                            )}

                            {/* Line: SLA Compliance % */}
                            {(metricView === 'dual' || metricView === 'compliance') && (
                                <Line
                                    yAxisId="right"
                                    type="monotone"
                                    dataKey="slaComplianceRate"
                                    name="SLA Compliance (%)"
                                    stroke="#3b82f6"
                                    strokeWidth={3}
                                    dot={{ r: 4, strokeWidth: 2, fill: '#ffffff', stroke: '#3b82f6' }}
                                    activeDot={{ r: 6, stroke: '#1d4ed8', strokeWidth: 2, fill: '#60a5fa' }}
                                />
                            )}
                        </ComposedChart>
                    </ResponsiveContainer>
                ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center text-slate-300">
                        <BarChart3 className="w-10 h-10 mb-2 opacity-50" />
                        <span className="font-bold text-xs uppercase tracking-widest italic">No Resolution History Available</span>
                    </div>
                )}
            </div>
        </div>
    );
};

export default PerformanceResolutionChart;
