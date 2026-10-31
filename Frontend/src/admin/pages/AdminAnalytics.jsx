import React, { useMemo, useState, useEffect } from 'react';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
    PieChart, Pie, Cell, LineChart, Line, AreaChart, Area, RadialBarChart, RadialBar
} from 'recharts';
import {
    BarChart3, PieChart as PieChartIcon, LineChart as LineChartIcon,
    TrendingUp, Users, ShieldCheck, Zap, AlertCircle, Clock, Activity,
    Layers, Inbox, User, Loader2, Bot, Star, Target
} from 'lucide-react';
import { supabase } from "../../lib/supabaseClient";
import StatCard from '../components/StatCard';
import PerformanceResolutionChart from '../components/PerformanceResolutionChart';
import { Card, CardContent } from "../../components/ui/card";
import useAuthStore from "../../store/authStore";
import { formatTimelineDate } from "../../utils/dateUtils";

const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#a855f7', '#ec4899'];

const AdminAnalytics = () => {
    const { profile } = useAuthStore();
    const [tickets, setTickets] = useState([]);
    const [loading, setLoading] = useState(true);

    const fetchAnalytics = async () => {
        setLoading(true);
        try {
            let query = supabase
                .from('tickets')
                .select(`
                    *,
                    creator:profiles!tickets_user_id_fkey(full_name, email, profile_picture)
                `);
            
            if (profile?.role === 'admin' && profile?.company) {
                query = query.eq('company', profile.company);
            }
            
            const { data, error: sbError } = await query.order('created_at', { ascending: false });

            if (sbError) {
                console.warn("Analytics relationship join failed, retrying simple select...", sbError);
                const { data: basicData, error: basicError } = await supabase
                    .from('tickets')
                    .select('*')
                    .eq('company', profile?.company)
                    .order('created_at', { ascending: false });
                if (basicError) throw basicError;
                setTickets(basicData || []);
            } else {
                setTickets(data || []);
            }
        } catch (err) {
            console.error("Analytics fetch error:", err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (profile) {
            fetchAnalytics();
        }
     
    }, [profile]);

    const stats = useMemo(() => {
        if (!tickets.length) return {
            total: 0, open: 0, resolved: 0, highPriority: 0,
            volumeTimeline: [], categoryData: [], teamData: [], resolutionData: [], liveFeed: []
        };

        const total = tickets.length;
        const resolved = tickets.filter(t => t.status?.toLowerCase().includes('resolv')).length;
        const open = tickets.filter(t => !t.status?.toLowerCase().includes('resolv')).length;
        const highPriority = tickets.filter(t => t.priority?.toLowerCase() === 'high').length;

        // 1. Tickets Per Day (Volume Timeline)
        const timeMap = {};
        tickets.forEach(t => {
            if (t.created_at) {
                const date = formatTimelineDate(t.created_at).split(',')[0]; // Extract just the date part for the axis
                timeMap[date] = (timeMap[date] || 0) + 1;
            }
        });
        const volumeTimeline = Object.keys(timeMap).map(key => ({ date: key, count: timeMap[key] }))
            .sort((a, b) => new Date(a.date) - new Date(b.date));

        // 2. Tickets Per Category
        const catMap = {};
        tickets.forEach(t => {
            const cat = t.category || 'Uncategorized';
            catMap[cat] = (catMap[cat] || 0) + 1;
        });
        const categoryData = Object.keys(catMap).map(key => ({ name: key, count: catMap[key] }))
            .sort((a, b) => b.count - a.count);

        // 3. Tickets Per Team
        const teamMap = {};
        tickets.forEach(t => {
            const team = t.assigned_team || 'Unassigned';
            teamMap[team] = (teamMap[team] || 0) + 1;
        });
        const teamData = Object.keys(teamMap).map(key => ({ name: key, value: teamMap[key] }))
            .sort((a, b) => b.value - a.value);

        // 4. Resolution Distribution (Open vs Resolved vs In Progress)
        const statusMap = {};
        tickets.forEach(t => {
            const s = t.status?.charAt(0).toUpperCase() + t.status?.slice(1) || 'Unknown';
            statusMap[s] = (statusMap[s] || 0) + 1;
        });
        const resolutionData = Object.keys(statusMap).map(key => ({ name: key, value: statusMap[key] }));

        // 5. Live Activity Feed (Latest 10)
        const liveFeed = tickets.slice(0, 10).map(t => ({
            ticket_id: t.id,
            user: t.creator?.full_name || t.profiles?.full_name || (t.user_id ? `User ${t.user_id.slice(0, 5)}` : 'Anonymous'),
            action: `Ticket ${t.status || 'Updated'}`,
            type: t.status === 'open' ? 'create' : t.status === 'resolved' ? 'resolve' : 'assign',
            timeFormatted: formatTimelineDate(t.created_at),
            time: new Date(t.created_at).getTime()
        }));

        return {
            total, open, resolved, highPriority,
            volumeTimeline, categoryData, teamData, resolutionData, liveFeed
        };
    }, [tickets]);

    // AI-specific metrics
    const aiStats = useMemo(() => {
        if (!tickets.length) return {
            accuracyRate: 0,
            resolutionSplit: [],
            misclassifiedCategories: [],
            avgCsatScore: null,
            avgResponseTime: 0,
        };

        // AI Accuracy: tickets that were NOT manually corrected by admin
        const corrected = tickets.filter(t => t.metadata?.corrected_at).length;
        const accuracyRate = tickets.length ? (((tickets.length - corrected) / tickets.length) * 100).toFixed(1) : 0;

        // AI vs Manual resolution split
        const aiResolved = tickets.filter(t => t.status?.toLowerCase()?.includes('auto')).length;
        const humanResolved = tickets.filter(t => ['resolved', 'closed'].includes(t.status?.toLowerCase()) && !t.status?.toLowerCase()?.includes('auto')).length;
        const resolutionSplit = [
            { name: 'AI Auto-Resolved', value: aiResolved, fill: '#10b981' },
            { name: 'Human Resolved', value: humanResolved, fill: '#6366f1' },
            { name: 'Open/Pending', value: tickets.length - aiResolved - humanResolved, fill: '#f59e0b' },
        ].filter(d => d.value > 0);

        // Top categories that were corrected by admins
        const correctedTickets = tickets.filter(t => t.metadata?.corrected_at);
        const misclassMap = {};
        correctedTickets.forEach(t => {
            const cat = t.category || 'Unknown';
            misclassMap[cat] = (misclassMap[cat] || 0) + 1;
        });
        const misclassifiedCategories = Object.keys(misclassMap)
            .map(key => ({ name: key, corrections: misclassMap[key] }))
            .sort((a, b) => b.corrections - a.corrections)
            .slice(0, 6);

        // Average CSAT
        const ratedTickets = tickets.filter(t => t.csat_rating);
        const avgCsatScore = ratedTickets.length
            ? (ratedTickets.reduce((sum, t) => sum + t.csat_rating, 0) / ratedTickets.length).toFixed(1)
            : null;

        return { accuracyRate, resolutionSplit, misclassifiedCategories, avgCsatScore };
    }, [tickets]);

    // Removed tab state - moving to single dashboard layout
    if (loading) return (
        <div className="flex flex-col items-center justify-center min-h-[400px]">
            <Loader2 className="w-10 h-10 text-indigo-600 animate-spin mb-4" />
            <p className="text-slate-400 font-black uppercase tracking-widest italic text-center">Analyzing ticket data...</p>
        </div>
    );

    return (
        <div style={{ background: '#f8faf9', minHeight: '100vh', paddingBottom: '80px' }} className="space-y-10 -m-6 p-6 md:-m-10 md:p-10 animate-in fade-in duration-700">
            {/* Header section */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
                <div>
                    <h1 style={{ fontFamily: 'Syne, sans-serif', fontSize: '26px', fontWeight: 800, color: '#0f1f12', margin: 0 }}>
                        Analytics
                    </h1>
                    <p style={{ fontSize: '11px', letterSpacing: '0.14em', color: '#9ca3af', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px', textTransform: 'uppercase' }}>
                        <Activity size={14} color="#16a34a" /> AI & System Insights
                    </p>
                </div>
            </div>

            {/* Combined KPI Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <StatCard
                    label="Total Tickets"
                    value={stats.total}
                    subtitle="Lifetime generated"
                    icon={Layers}
                    color="slate"
                />
                <StatCard
                    label="AI Accuracy"
                    value={<span style={{ color: '#16a34a' }}>{aiStats.accuracyRate}%</span>}
                    subtitle="Correct auto-classifications"
                    icon={Target}
                    color="emerald"
                />
                <StatCard
                    label="Average CSAT"
                    value={aiStats.avgCsatScore ? aiStats.avgCsatScore : <span style={{ color: '#9ca3af', fontSize: '24px' }}>No data</span>}
                    subtitle="Customer satisfaction score"
                    icon={Star}
                    color="indigo"
                />
                <StatCard
                    label="High Priority"
                    value={<span style={{ color: '#dc2626' }}>{stats.highPriority}</span>}
                    subtitle="Tickets needing attention"
                    icon={AlertCircle}
                    color="red"
                />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
                {/* Main Content (8 cols) */}
                <div className="lg:col-span-8 space-y-10">
                    {/* Volume Timeline Chart */}
                    <div style={{ background: '#ffffff', borderRadius: '20px', border: '1px solid #f0fdf4', boxShadow: '0 2px 16px rgba(0,0,0,0.05)', padding: '24px' }}>
                        <div className="flex items-center justify-between mb-8">
                            <h3 style={{ fontFamily: 'Syne, sans-serif', fontSize: '16px', fontWeight: 700, color: '#0f1f12', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2" className="shrink-0"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
                                Daily Ticket Volume
                            </h3>
                        </div>
                        <div className="h-[300px] w-full">
                            {stats.volumeTimeline.length > 0 ? (
                                <ResponsiveContainer width="100%" height="100%">
                                    <AreaChart data={stats.volumeTimeline}>
                                        <defs>
                                            <linearGradient id="colorCount" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="rgba(34,160,69,0.08)" stopOpacity={1}/>
                                                <stop offset="95%" stopColor="rgba(34,160,69,0.01)" stopOpacity={1}/>
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                        <XAxis dataKey="date" fontSize={10} axisLine={false} tickLine={false} tick={{ fill: '#9ca3af', fontWeight: 600 }} dy={10} />
                                        <YAxis fontSize={10} axisLine={false} tickLine={false} tick={{ fill: '#9ca3af', fontWeight: 600 }} />
                                        <Tooltip contentStyle={{ backgroundColor: '#fff', borderRadius: '12px', border: '1px solid #f0fdf4', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }} itemStyle={{ color: '#16a34a', fontWeight: 700 }} />
                                        <Area type="monotone" dataKey="count" stroke="#22c55e" strokeWidth={3} fillOpacity={1} fill="url(#colorCount)" activeDot={{ r: 6, strokeWidth: 0, fill: '#16a34a' }} />
                                    </AreaChart>
                                </ResponsiveContainer>
                            ) : (
                                <div className="w-full h-full flex items-center justify-center text-slate-300 font-black uppercase text-[10px] italic tracking-widest">No activity data</div>
                            )}
                        </div>
                    </div>

                    {/* Interactive Performance Resolution by Weekday Ranges Chart */}
                    <PerformanceResolutionChart tickets={tickets} />

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                        {/* Resolution Split Chart */}
                        <div style={{ background: '#ffffff', borderRadius: '20px', border: '1px solid #f0fdf4', boxShadow: '0 2px 16px rgba(0,0,0,0.05)', padding: '24px' }}>
                            <div className="mb-8">
                                <h3 style={{ fontFamily: 'Syne, sans-serif', fontSize: '16px', fontWeight: 700, color: '#0f1f12', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <Bot size={18} color="#22c55e" /> Resolution Status
                                </h3>
                            </div>
                            <div className="h-[250px]">
                                {aiStats.resolutionSplit.length > 0 ? (
                                    <ResponsiveContainer width="100%" height="100%">
                                        <PieChart>
                                            <Pie data={aiStats.resolutionSplit} cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={4} dataKey="value" stroke="none">
                                                {aiStats.resolutionSplit.map((entry, index) => (
                                                    <Cell key={index} fill={index === 0 ? '#16a34a' : index === 1 ? '#3b82f6' : '#f59e0b'} cornerRadius={4} />
                                                ))}
                                            </Pie>
                                            <Tooltip contentStyle={{ backgroundColor: '#fff', borderRadius: '12px', border: '1px solid #f0fdf4', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }} />
                                            <Legend verticalAlign="bottom" height={36} formatter={(value) => <span style={{ fontSize: '12px', color: '#374151', fontWeight: 500 }}>{value}</span>} />
                                        </PieChart>
                                    </ResponsiveContainer>
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center text-slate-300 font-black uppercase text-[10px] italic tracking-widest">No resolution data</div>
                                )}
                            </div>
                        </div>

                        {/* Category Breakdown */}
                        <div style={{ background: '#ffffff', borderRadius: '20px', border: '1px solid #f0fdf4', boxShadow: '0 2px 16px rgba(0,0,0,0.05)', padding: '24px' }}>
                            <div className="mb-8">
                                <h3 style={{ fontFamily: 'Syne, sans-serif', fontSize: '16px', fontWeight: 700, color: '#0f1f12', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <BarChart3 size={18} color="#22c55e" /> Tickets by Category
                                </h3>
                            </div>
                            <div className="h-[250px]">
                                {stats.categoryData.length > 0 ? (
                                    <ResponsiveContainer width="100%" height="100%">
                                        <BarChart data={stats.categoryData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                                            <defs>
                                                <linearGradient id="colorGreenBar" x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="0%" stopColor="#22c55e" stopOpacity={1}/>
                                                    <stop offset="100%" stopColor="#16a34a" stopOpacity={1}/>
                                                </linearGradient>
                                            </defs>
                                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                            <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#9ca3af', fontSize: 10, fontWeight: 600 }} />
                                            <YAxis axisLine={false} tickLine={false} tick={{ fill: '#9ca3af', fontSize: 10, fontWeight: 600 }} />
                                            <Tooltip cursor={{ fill: '#f8faf9' }} contentStyle={{ backgroundColor: '#fff', borderRadius: '12px', border: '1px solid #f0fdf4', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }} />
                                            <Bar dataKey="count" fill="url(#colorGreenBar)" radius={[4, 4, 0, 0]} barSize={24} />
                                        </BarChart>
                                    </ResponsiveContainer>
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center text-slate-300 font-black uppercase text-[10px] italic tracking-widest">No category data</div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* AI Correction Log */}
                    <Card className="p-8 border-none shadow-xl shadow-slate-200/50 rounded-[2rem] bg-white">
                        <div className="mb-8">
                            <h3 className="text-lg font-black text-slate-900 tracking-tight flex items-center gap-2 uppercase italic">
                                <AlertCircle size={18} className="text-amber-500" /> AI Correction Log
                            </h3>
                            <p className="text-[10px] text-slate-400 uppercase tracking-widest mt-1">Categories with manual corrections</p>
                        </div>
                        <div className="h-[250px]">
                            {aiStats.misclassifiedCategories.length > 0 ? (
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={aiStats.misclassifiedCategories} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                        <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 9, fontWeight: 900 }} />
                                        <YAxis axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 9 }} allowDecimals={false} />
                                        <Tooltip cursor={{ fill: '#f8fafc' }} contentStyle={{ backgroundColor: '#fff', borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }} />
                                        <Bar dataKey="corrections" fill="#f59e0b" radius={[4, 4, 0, 0]} barSize={40} />
                                    </BarChart>
                                </ResponsiveContainer>
                            ) : (
                                <div className="w-full h-full flex items-center justify-center flex-col gap-3">
                                    <ShieldCheck className="w-12 h-12 text-emerald-200" />
                                    <p className="text-slate-300 font-black uppercase text-[10px] italic tracking-widest text-center">AI classifications are performing optimally.</p>
                                </div>
                            )}
                        </div>
                    </Card>
                </div>

                {/* Live Activity (4 cols) */}
                <div className="lg:col-span-4">
                    <div style={{ background: '#ffffff', borderRadius: '20px', border: '1px solid #f0fdf4', boxShadow: '0 2px 16px rgba(0,0,0,0.05)', height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                        <div style={{ background: '#0f1f12', padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <h3 style={{ fontFamily: 'Syne, sans-serif', fontSize: '15px', fontWeight: 700, color: '#ffffff', display: 'flex', alignItems: 'center', gap: '8px', margin: 0, textTransform: 'uppercase' }}>
                                <Activity size={16} color="#22c55e" /> Recent Ticket Actions
                            </h3>
                            <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse shadow-[0_0_10px_rgba(34,197,94,0.5)]"></div>
                        </div>
                        <div className="overflow-y-auto custom-scrollbar flex-1 p-6" style={{ maxHeight: '450px' }}>
                            {stats.liveFeed.length > 0 ? (
                                stats.liveFeed.map((event, idx) => {
                                    let badgeStyle = { background: '#fef3c7', color: '#d97706' }; // Default amber
                                    let badgeText = 'Escalated';
                                    if (event.action.toLowerCase().includes('resolve')) {
                                        if (event.action.toLowerCase().includes('auto')) {
                                            badgeStyle = { background: '#dbeafe', color: '#2563eb' }; // blue pill for auto
                                            badgeText = 'AI Resolved';
                                        } else {
                                            badgeStyle = { background: '#dcfce7', color: '#15803d' }; // green pill for human resolved
                                            badgeText = 'Resolved';
                                        }
                                    } else if (event.type === 'create') {
                                        badgeStyle = { background: '#fef9c3', color: '#ca8a04' }; // yellow pill for created/open
                                        badgeText = 'Open';
                                    }

                                    return (
                                        <div key={idx} style={{ padding: '12px 20px', borderBottom: '1px solid #f9fafb', display: 'flex', gap: '16px' }} className="group">
                                            <div className="flex flex-col items-center">
                                                <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 border-2 border-white shadow-sm z-10 bg-gray-50 text-gray-400 group-hover:bg-emerald-50 group-hover:text-emerald-600 transition-colors">
                                                    {event.type === 'create' ? <Inbox size={14} /> : event.type === 'resolve' ? <ShieldCheck size={14} /> : <TrendingUp size={14} />}
                                                </div>
                                                {idx !== stats.liveFeed.length - 1 && <div className="w-px h-full bg-gray-100 group-hover:bg-emerald-100 transition-colors my-1"></div>}
                                            </div>
                                            <div className="flex-1 pb-2">
                                                <div className="flex items-center justify-between mb-2">
                                                    <div className="flex items-center gap-2">
                                                        <span style={{ fontFamily: 'monospace', fontSize: '11px', fontWeight: 700, color: '#16a34a' }}>#{event.ticket_id.slice(0, 8)}</span>
                                                        <span style={{ fontSize: '10px', color: '#9ca3af', fontWeight: 600 }}>{event.timeFormatted.split(',')[1]}</span>
                                                    </div>
                                                    <span style={{
                                                        background: badgeStyle.background, color: badgeStyle.color,
                                                        padding: '3px 10px', borderRadius: '100px', fontSize: '10px', fontWeight: 700
                                                    }}>
                                                        {badgeText}
                                                    </span>
                                                </div>
                                                <p style={{ fontSize: '13px', fontWeight: 500, color: '#111827', margin: '0 0 2px 0' }}>{event.action}</p>
                                                <p style={{ fontSize: '11px', color: '#6b7280' }}>{event.user}</p>
                                            </div>
                                        </div>
                                    );
                                })
                            ) : (
                                <div className="text-center py-20">
                                    <p style={{ fontSize: '11px', color: '#9ca3af', letterSpacing: '0.14em', fontWeight: 600, textTransform: 'uppercase' }}>Waiting for signal...</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default AdminAnalytics;
