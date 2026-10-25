import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
    CheckCircle2, Clock, AlertCircle, User,
    Activity, ShieldCheck, Briefcase, Globe, BarChart3,
    ImageIcon, CornerUpLeft, CheckSquare, XCircle,
    Cpu, Eye, MessageSquare, MoveRight, Loader2, Star, Eraser
} from 'lucide-react';
import { supabase } from "../../lib/supabaseClient";
import useAuthStore from "../../store/authStore";
import useToastStore from "../../store/toastStore";
import { Card } from "../../components/ui/card";
import { Select } from "../../components/ui/select";
import TicketChat from "../../components/shared/TicketChat";
import { formatTicketId } from "../../utils/format";
import SLABadge from "../components/SLABadge";
import { formatFullTimestamp, formatRelativeTime } from "../../utils/dateUtils";
import TicketTimeline from "../../user/components/TicketTimeline";

const AdminTicketDetail = () => {
    const { ticket_id } = useParams();
    const navigate = useNavigate();
    const { user } = useAuthStore();
    const { showToast } = useToastStore();

    const [ticket, setTicket] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);
    const [isReassigning, setIsReassigning] = useState(false);
    const [isCorrecting, setIsCorrecting] = useState(false);
    const [selectedTeam, setSelectedTeam] = useState('');
    const [selectedAgent, setSelectedAgent] = useState('');
    const [agents, setAgents] = useState([]);
    const [imageUrl, setImageUrl] = useState(null);
    const [isUpdating, setIsUpdating] = useState(null);
    const [isLive, setIsLive] = useState(false);

    const [correctionForm, setCorrectionForm] = useState({
        category: '',
        subcategory: '',
        priority: ''
    });

    const fetchTicketDetail = async () => {
        setIsLoading(true);
        setError(null);
        try {
            const { data, error: sbError } = await supabase
                .from('tickets')
                .select(`
                    *,
                    creator:profiles!tickets_user_id_fkey(full_name, email, profile_picture),
                    assignee:profiles!tickets_assigned_agent_id_fkey(full_name, email, profile_picture)
                `)
                .eq('id', ticket_id)
                .single();

            if (sbError) throw sbError;
            if (!data) throw new Error("Incident record not found.");

            setTicket(data);
            setCorrectionForm({
                category: data.category || '',
                subcategory: data.subcategory || '',
                priority: data.priority || ''
            });

            if (data.image_url) {
                setImageUrl(data.image_url);
            } else if (data.metadata?.capturedFileBase64) {
                setImageUrl(data.metadata.capturedFileBase64);
            }
        } catch (err) {
            console.error("Fetch detail error:", err);
            setError(err.message);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        const fetchAgents = async () => {
            const { profile } = useAuthStore.getState();
            if (profile?.company) {
                const { data } = await supabase
                    .from('profiles')
                    .select('id, full_name')
                    .eq('company', profile.company)
                    .in('role', ['admin', 'super_admin', 'agent']);
                setAgents(data || []);
            }
        };

        fetchTicketDetail();
        fetchAgents();

        const channel = supabase
            .channel(`admin_sync_${ticket_id}`)
            .on(
                'postgres_changes',
                {
                    event: 'UPDATE',
                    schema: 'public',
                    table: 'tickets',
                    filter: `id=eq.${ticket_id}`
                },
                (payload) => {
                    setTicket(prev => ({ ...prev, ...payload.new }));
                }
            )
            .subscribe((status) => {
                if (status === 'SUBSCRIBED') setIsLive(true);
                else setIsLive(false);
            });

        return () => {
            supabase.removeChannel(channel);
        };
     
    }, [ticket_id]);

    const handleUpdate = async (updates, actionType) => {
        setIsUpdating(actionType);
        try {
            const { error: upError } = await supabase
                .from('tickets')
                .update(updates)
                .eq('id', ticket_id);

            if (upError) throw upError;
            setTicket(prev => ({ ...prev, ...updates }));
            showToast("System synchronization complete. Incident record updated.", "success");
        } catch (err) {
            showToast("Update failed: " + err.message, "error");
        } finally {
            setIsUpdating(null);
        }
    };

    const handleAccept = () => {
        handleUpdate({
            status: 'in progress',
            assigned_agent_id: user.id
        }, 'accept');
    };

    const handleReassign = () => {
        if (!selectedTeam && !selectedAgent) return;
        const updates = {};
        if (selectedTeam) updates.assigned_team = selectedTeam;
        if (selectedAgent) {
            updates.assigned_agent_id = selectedAgent;
            updates.status = 'in progress';
        }
        handleUpdate(updates, 'reassign');
        setIsReassigning(false);
    };

    const handleSaveCorrection = () => {
        handleUpdate({
            category: correctionForm.category,
            subcategory: correctionForm.subcategory,
            priority: correctionForm.priority,
            metadata: { ...ticket.metadata, corrected_at: new Date().toISOString() }
        }, 'correct');
        setIsCorrecting(false);
    };

    const handleClose = () => {
        handleUpdate({
            status: 'resolved',
            metadata: { ...ticket.metadata, resolved_at: new Date().toISOString() }
        }, 'resolve');
    };

    if (isLoading) return (
        <div className="flex flex-col items-center justify-center min-h-[400px]">
            <Loader2 className="w-10 h-10 text-emerald-600 animate-spin mb-4" />
            <p className="text-gray-400 font-black uppercase tracking-[0.2em] italic">Accessing Neural Records...</p>
        </div>
    );

    if (error) return (
        <div className="flex flex-col items-center justify-center min-h-[400px] text-center space-y-4">
            <AlertCircle className="w-16 h-16 text-red-500" />
            <h3 className="text-xl font-black text-slate-900 uppercase italic">Access Denied</h3>
            <p className="text-sm text-slate-500 max-w-xs">{error}</p>
            <button onClick={() => navigate('/admin/tickets')} className="px-6 py-2 bg-slate-900 text-white rounded-xl text-[10px] font-black uppercase tracking-widest">Return to Base</button>
        </div>
    );

    if (!ticket) return null;

    const confidence = ticket.metadata?.confidence || 0.85;
    const entities = ticket.metadata?.entities || ticket.entities || [];
    const displayStatus = ticket.status || 'Pending';
    const displayPriority = ticket.priority || 'Medium';
    const displaySummary = ticket.summary || ticket.subject || 'No Summary';
    const displayText = ticket.description || ticket.text || displaySummary;

    return (
        <div style={{ background: '#f8faf9', minHeight: '100vh', paddingBottom: '80px' }} className="-m-6 p-6 md:-m-10 md:p-10 space-y-6 animate-in fade-in duration-700">
            {/* Header */}
            <div style={{
                background: '#ffffff',
                borderBottom: '1px solid #f0fdf4',
                boxShadow: '0 1px 8px rgba(0,0,0,0.05)',
                padding: '14px 28px',
                position: 'sticky', top: 0, zIndex: 50,
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                flexWrap: 'wrap', gap: '16px', margin: '-24px -24px 24px -24px'
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <button
                        onClick={() => navigate('/admin/tickets')}
                        style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#6b7280', padding: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                        className="hover:bg-slate-50 rounded-xl transition-colors"
                    >
                        <CornerUpLeft size={20} />
                    </button>
                    <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <h2 style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, color: '#0f1f12', fontSize: '14px', margin: 0, textTransform: 'uppercase' }}>
                                INSPECTION // #{formatTicketId(ticket.id)}
                            </h2>
                            {isLive && (
                                <div style={{ background: '#dcfce7', color: '#15803d', borderRadius: '100px', fontSize: '10px', fontWeight: 700, padding: '2px 10px', display: 'flex', alignItems: 'center', gap: '6px', textTransform: 'uppercase' }}>
                                    <div style={{ width: '4px', height: '4px', borderRadius: '50%', background: '#22c55e' }} className="animate-pulse"></div>
                                    LIVE SYNC
                                </div>
                            )}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
                            <span style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', color: displayStatus?.includes('progress') ? '#2563eb' : displayStatus?.includes('resolv') ? '#16a34a' : '#d97706', background: displayStatus?.includes('progress') ? '#dbeafe' : displayStatus?.includes('resolv') ? '#dcfce7' : '#fef3c7', padding: '2px 8px', borderRadius: '100px' }}>
                                {displayStatus === 'pending' ? 'PENDING_HUMAN' : displayStatus}
                            </span>
                            <span style={{ fontSize: '10px', fontWeight: 700, color: '#475569', background: '#f1f5f9', padding: '2px 8px', borderRadius: '100px', textTransform: 'uppercase' }}>
                                {ticket.assignee?.full_name || 'UNASSIGNED'}
                            </span>
                            <SLABadge priority={displayPriority} createdAt={ticket.created_at} status={displayStatus} compact />
                        </div>
                    </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', maxWidth: 'max-content' }}>
                    {!ticket.status?.toLowerCase()?.includes('resolv') ? (
                        <>
                            {ticket.status?.toLowerCase() !== 'in progress' && (
                                <button
                                    onClick={handleAccept}
                                    disabled={!!isUpdating}
                                    style={{ background: 'linear-gradient(135deg,#16a34a,#22c55e)', color: '#ffffff', borderRadius: '10px', fontWeight: 600, fontSize: '11px', padding: '10px 20px', border: 'none', cursor: 'pointer', boxShadow: '0 4px 12px rgba(34,160,69,0.3)', display: 'flex', alignItems: 'center', gap: '8px', textTransform: 'uppercase' }}
                                    className="disabled:opacity-50"
                                >
                                    {isUpdating === 'accept' ? <Loader2 size={14} className="animate-spin" /> : <CheckSquare size={14} />}
                                    Accept
                                </button>
                            )}
                            <button
                                onClick={() => setIsReassigning(true)}
                                disabled={!!isUpdating}
                                style={{ background: '#ffffff', color: '#374151', border: '1.5px solid #e5e7eb', borderRadius: '10px', fontWeight: 600, fontSize: '11px', padding: '10px 20px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', textTransform: 'uppercase' }}
                                className="disabled:opacity-50"
                            >
                                {isUpdating === 'reassign' ? <Loader2 size={14} className="animate-spin" /> : <MoveRight size={14} color="#374151" />}
                                Divert
                            </button>
                            <button
                                onClick={() => setIsCorrecting(true)}
                                disabled={!!isUpdating}
                                style={{ background: '#ffffff', color: '#374151', border: '1.5px solid #e5e7eb', borderRadius: '10px', fontWeight: 600, fontSize: '11px', padding: '10px 20px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', textTransform: 'uppercase' }}
                                className="disabled:opacity-50"
                            >
                                {isUpdating === 'correct' ? <Loader2 size={14} className="animate-spin" /> : <Eraser size={14} color="#374151" />}
                                Correct
                            </button>
                            <button
                                onClick={handleClose}
                                disabled={!!isUpdating}
                                style={{ background: '#0f1f12', color: '#ffffff', borderRadius: '10px', fontWeight: 600, fontSize: '11px', padding: '10px 20px', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', textTransform: 'uppercase' }}
                                className="disabled:opacity-50"
                            >
                                {isUpdating === 'resolve' ? <Loader2 size={14} className="animate-spin" /> : <XCircle size={14} />}
                                Resolve
                            </button>
                        </>
                    ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 16px', background: '#f8faf9', border: '1px solid #e5e7eb', borderRadius: '10px' }}>
                            <CheckCircle2 size={16} color="#16a34a" />
                            <span style={{ fontSize: '10px', fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Protocol Finalized</span>
                        </div>
                    )}
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                {/* Primary Column */}
                <div className="lg:col-span-8 space-y-8">
                    {/* User Payload */}
                    <div style={{ background: '#ffffff', borderRadius: '20px', border: '1px solid #f0fdf4', boxShadow: '0 2px 16px rgba(0,0,0,0.05)', overflow: 'hidden' }}>
                        <div style={{ padding: '20px 28px', borderBottom: '1px solid #f0fdf4', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <h3 style={{ fontSize: '11px', letterSpacing: '0.12em', color: '#9ca3af', fontWeight: 700, textTransform: 'uppercase', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <MessageSquare size={14} color="#16a34a" /> USER INPUT PAYLOAD
                            </h3>
                            <span style={{ fontSize: '10px', color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase' }} title={formatFullTimestamp(ticket.created_at)}>{formatRelativeTime(ticket.created_at)}</span>
                        </div>
                        <div style={{ padding: '28px' }}>
                            <div style={{ background: 'linear-gradient(135deg, #0f1f12, #1a3320)', color: '#ffffff', borderRadius: '16px', padding: '24px 28px', fontSize: '15px', fontStyle: 'italic', lineHeight: 1.7 }}>
                                "{displayText}"
                            </div>

                            {imageUrl && (
                                <div style={{ marginTop: '24px' }}>
                                    <p style={{ fontSize: '10px', color: '#9ca3af', letterSpacing: '0.12em', fontWeight: 700, textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                                        <ImageIcon size={14} color="#16a34a" /> VISUAL EVIDENCE
                                    </p>
                                    <div style={{ borderRadius: '16px', overflow: 'hidden', border: '1px solid #f0fdf4', background: '#f8faf9', cursor: 'zoom-in' }} onClick={() => window.open(imageUrl, '_blank')}>
                                        <img src={imageUrl} alt="Telemetry Evidence" style={{ width: '100%', objectFit: 'contain', maxHeight: '500px' }} />
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Chat Hub */}
                    <div style={{ height: '500px', background: '#ffffff', borderRadius: '20px', border: '1px solid #f0fdf4', boxShadow: '0 2px 16px rgba(0,0,0,0.05)', overflow: 'hidden' }}>
                        <TicketChat ticketId={ticket.id} currentUserRole="admin" />
                    </div>

                    {/* Timeline */}
                    <div style={{ background: '#ffffff', borderRadius: '20px', border: '1px solid #f0fdf4', boxShadow: '0 2px 16px rgba(0,0,0,0.05)', padding: '28px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '24px' }}>
                            <Clock size={16} color="#16a34a" />
                            <h3 style={{ fontSize: '11px', letterSpacing: '0.12em', color: '#9ca3af', fontWeight: 700, textTransform: 'uppercase', margin: 0 }}>FULL LIFECYCLE JOURNEY</h3>
                        </div>
                        <TicketTimeline ticket={ticket} />
                    </div>
                </div>

                {/* AI Column */}
                <div className="lg:col-span-4 space-y-8">
                    {/* Neural Insights */}
                    <div style={{ background: '#ffffff', borderRadius: '20px', border: '1px solid #f0fdf4', boxShadow: '0 2px 16px rgba(0,0,0,0.05)', overflow: 'hidden', position: 'sticky', top: '100px' }}>
                        <div style={{ background: '#0f1f12', borderRadius: '20px 20px 0 0', color: '#ffffff', padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <h3 style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: '14px', margin: 0, display: 'flex', alignItems: 'center', gap: '8px', textTransform: 'uppercase' }}>
                                <Cpu size={16} color="#22c55e" /> AI INSIGHTS
                            </h3>
                            <div style={{ width: '6px', height: '6px', background: '#22c55e', borderRadius: '50%' }} className="animate-pulse"></div>
                        </div>
                        <div style={{ padding: '24px' }} className="space-y-6">
                            <div className="space-y-2">
                                <label style={{ fontSize: '10px', letterSpacing: '0.12em', color: '#9ca3af', fontWeight: 700, textTransform: 'uppercase' }}>SUMMARY BYTE</label>
                                <p style={{ fontSize: '13px', fontWeight: 500, color: '#111827', lineHeight: 1.5, margin: 0 }}>
                                    {displaySummary}
                                </p>
                            </div>

                            <div className="space-y-3">
                                <label style={{ fontSize: '10px', letterSpacing: '0.12em', color: '#9ca3af', fontWeight: 700, textTransform: 'uppercase' }}>SECTOR MAPPING</label>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <span style={{ fontSize: '11px', color: '#6b7280', fontWeight: 600 }}>CATEGORY</span>
                                        <span style={{ 
                                            background: ticket.category?.toLowerCase() === 'hardware' ? '#fff7ed' : ticket.category?.toLowerCase() === 'network' ? '#eff6ff' : ticket.category?.toLowerCase() === 'access' ? '#f5f3ff' : ticket.category?.toLowerCase() === 'software' ? '#f0fdf4' : '#f8fafc', 
                                            color: ticket.category?.toLowerCase() === 'hardware' ? '#ea580c' : ticket.category?.toLowerCase() === 'network' ? '#2563eb' : ticket.category?.toLowerCase() === 'access' ? '#7c3aed' : ticket.category?.toLowerCase() === 'software' ? '#16a34a' : '#475569', 
                                            border: `1px solid ${ticket.category?.toLowerCase() === 'hardware' ? '#fed7aa' : ticket.category?.toLowerCase() === 'network' ? '#bfdbfe' : ticket.category?.toLowerCase() === 'access' ? '#ddd6fe' : ticket.category?.toLowerCase() === 'software' ? '#bbf7d0' : '#e2e8f0'}`,
                                            padding: '2px 10px', borderRadius: '100px', fontSize: '10px', fontWeight: 700, textTransform: 'uppercase' 
                                        }}>
                                            {ticket.category || 'GENERAL'}
                                        </span>
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <span style={{ fontSize: '11px', color: '#6b7280', fontWeight: 600 }}>PRIORITY</span>
                                        <span style={{ 
                                            background: ticket.priority?.toLowerCase() === 'critical' ? '#fef2f2' : ticket.priority?.toLowerCase() === 'high' ? '#fff7ed' : ticket.priority?.toLowerCase() === 'medium' ? '#fefce8' : '#f0fdf4', 
                                            color: ticket.priority?.toLowerCase() === 'critical' ? '#dc2626' : ticket.priority?.toLowerCase() === 'high' ? '#ea580c' : ticket.priority?.toLowerCase() === 'medium' ? '#ca8a04' : '#16a34a', 
                                            border: `1px solid ${ticket.priority?.toLowerCase() === 'critical' ? '#fecaca' : ticket.priority?.toLowerCase() === 'high' ? '#fed7aa' : ticket.priority?.toLowerCase() === 'medium' ? '#fde68a' : '#bbf7d0'}`,
                                            padding: '2px 10px', borderRadius: '100px', fontSize: '10px', fontWeight: 700, textTransform: 'uppercase' 
                                        }}>
                                            {ticket.priority || 'NORMAL'}
                                        </span>
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-2">
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <label style={{ fontSize: '10px', letterSpacing: '0.12em', color: '#9ca3af', fontWeight: 700, textTransform: 'uppercase' }}>ROUTING CONFIDENCE</label>
                                    <span style={{ fontSize: '11px', fontWeight: 700, color: '#15803d' }}>{(confidence * 100).toFixed(0)}%</span>
                                </div>
                                <div style={{ width: '100%', height: '6px', background: '#f0fdf4', borderRadius: '100px', overflow: 'hidden' }}>
                                    <div style={{ width: `${confidence * 100}%`, height: '100%', background: '#22c55e', borderRadius: '100px' }}></div>
                                </div>
                            </div>

                            {entities && entities.length > 0 && (
                                <div className="space-y-3">
                                    <label style={{ fontSize: '10px', letterSpacing: '0.12em', color: '#9ca3af', fontWeight: 700, textTransform: 'uppercase' }}>EXTRACTED ENTITIES</label>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                                        {entities.map((e, idx) => (
                                            <span key={idx} style={{ background: '#f0fdf4', color: '#15803d', border: '1px solid #bbf7d0', padding: '4px 10px', borderRadius: '100px', fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                                {typeof e === 'object' ? e.text : String(e)}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <div style={{ borderTop: '1px solid #f0fdf4', paddingTop: '20px' }} className="space-y-3">
                                <label style={{ fontSize: '10px', letterSpacing: '0.12em', color: '#9ca3af', fontWeight: 700, textTransform: 'uppercase' }}>TECHNICAL ENV</label>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <span style={{ fontSize: '10px', color: '#6b7280', fontWeight: 600 }}>IP</span>
                                        <span style={{ fontFamily: 'monospace', fontSize: '11px', color: '#6b7280' }}>{ticket.metadata?.env_metadata?.ip || '127.0.0.1'}</span>
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                                        <span style={{ fontSize: '10px', color: '#6b7280', fontWeight: 600, marginBottom: '2px' }}>SIGNATURE</span>
                                        <span style={{ fontFamily: 'monospace', fontSize: '10px', color: '#6b7280', lineHeight: 1.4 }}>{ticket.metadata?.env_metadata?.user_agent || 'Neural Interface v1.0'}</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* CSAT */}
                    {ticket.csat_rating && (
                        <div style={{ background: '#ffffff', borderRadius: '20px', border: '1px solid #f0fdf4', boxShadow: '0 2px 16px rgba(0,0,0,0.05)', overflow: 'hidden' }}>
                            <div style={{ background: '#f8faf9', padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #f0fdf4' }}>
                                <h3 style={{ fontSize: '11px', letterSpacing: '0.12em', color: '#9ca3af', fontWeight: 700, textTransform: 'uppercase', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <Star size={14} color="#f59e0b" className="fill-amber-400" /> SATISFACTION
                                </h3>
                            </div>
                            <div style={{ padding: '24px' }} className="space-y-4">
                                <div className="flex gap-1">
                                    {[1, 2, 3, 4, 5].map(star => (
                                        <Star key={star} size={20} className={star <= ticket.csat_rating ? 'text-amber-400 fill-amber-400' : 'text-slate-200 fill-slate-200'} />
                                    ))}
                                </div>
                                <p style={{ fontSize: '11px', fontWeight: 700, color: '#374151', textTransform: 'uppercase' }}>
                                    {['', 'Very Dissatisfied', 'Dissatisfied', 'Neutral', 'Satisfied', 'Very Satisfied'][ticket.csat_rating]}
                                </p>
                                {ticket.csat_comment && (
                                    <p style={{ fontSize: '13px', color: '#475569', fontStyle: 'italic', background: '#f8faf9', padding: '16px', borderRadius: '12px' }}>
                                        "{ticket.csat_comment}"
                                    </p>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Modals */}
            {isReassigning && (
                <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[100] flex items-center justify-center p-6">
                    <Card className="w-full max-w-sm bg-white rounded-[2rem] border-none shadow-2xl p-8 space-y-6">
                        <div className="space-y-2">
                            <h3 style={{ fontFamily: 'Syne, sans-serif', fontSize: '18px', fontWeight: 700, color: '#0f1f12', textTransform: 'uppercase', margin: 0 }}>Divert Protocol</h3>
                            <p style={{ fontSize: '12px', color: '#6b7280' }}>Reassign incident to a specialized unit.</p>
                        </div>
                        <div className="space-y-4">
                            <div className="space-y-2">
                                <label style={{ fontSize: '10px', fontWeight: 700, color: '#9ca3af', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Target Unit (Team)</label>
                                <Select value={selectedTeam} onChange={(e) => setSelectedTeam(e.target.value)} buttonClassName="w-full bg-slate-50 border-2 border-transparent focus:border-emerald-500 rounded-xl px-4 py-3 text-xs font-bold transition-all outline-none" options={[{ value: "", label: "Select Team..." }, { value: "Network Ops", label: "Network Ops" }, { value: "Hardware Support", label: "Hardware Support" }, { value: "Software Team", label: "Software Team" }, { value: "Security Unit", label: "Security Unit" }]} />
                            </div>
                            <div className="space-y-2">
                                <label style={{ fontSize: '10px', fontWeight: 700, color: '#9ca3af', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Individual Agent</label>
                                <Select value={selectedAgent} onChange={(e) => setSelectedAgent(e.target.value)} buttonClassName="w-full bg-slate-50 border-2 border-transparent focus:border-emerald-500 rounded-xl px-4 py-3 text-xs font-bold transition-all outline-none" options={[{ value: "", label: "Select Agent..." }, ...agents.map(a => ({ value: a.id, label: a.full_name }))]} />
                            </div>
                        </div>
                        <div className="flex gap-3 pt-2">
                            <button onClick={handleReassign} style={{ flex: 1, padding: '12px', background: '#0f1f12', color: '#ffffff', borderRadius: '10px', fontWeight: 600, fontSize: '11px', textTransform: 'uppercase', border: 'none', cursor: 'pointer' }}>Execute</button>
                            <button onClick={() => setIsReassigning(false)} style={{ flex: 1, padding: '12px', background: '#f3f4f6', color: '#475569', borderRadius: '10px', fontWeight: 600, fontSize: '11px', textTransform: 'uppercase', border: 'none', cursor: 'pointer' }}>Abort</button>
                        </div>
                    </Card>
                </div>
            )}

            {isCorrecting && (
                <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[100] flex items-center justify-center p-6 text-slate-900">
                    <Card className="w-full max-w-sm bg-white rounded-[2rem] border-none shadow-2xl p-8 space-y-6 text-black">
                        <div className="space-y-2">
                            <h3 style={{ fontFamily: 'Syne, sans-serif', fontSize: '18px', fontWeight: 700, color: '#0f1f12', textTransform: 'uppercase', margin: 0 }}>Override Protocol</h3>
                            <p style={{ fontSize: '12px', color: '#6b7280' }}>Manually correct AI classification labels.</p>
                        </div>
                        <div className="space-y-4">
                            <div>
                                <label style={{ fontSize: '10px', fontWeight: 700, color: '#9ca3af', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '8px', display: 'block' }}>Refined Category</label>
                                <Select value={correctionForm.category} onChange={(e) => setCorrectionForm({ ...correctionForm, category: e.target.value })} buttonClassName="w-full bg-slate-50 border-2 border-transparent focus:border-emerald-500 rounded-xl px-4 py-3 text-xs font-bold transition-all outline-none" options={[{ value: "Network", label: "Network Ops" }, { value: "Hardware", label: "Hardware Systems" }, { value: "Software", label: "Cloud Applications" }, { value: "Access", label: "Security & Access" }]} />
                            </div>
                            <div>
                                <label style={{ fontSize: '10px', fontWeight: 700, color: '#9ca3af', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '8px', display: 'block' }}>Priority Assessment</label>
                                <Select value={correctionForm.priority} onChange={(e) => setCorrectionForm({ ...correctionForm, priority: e.target.value })} buttonClassName="w-full bg-slate-50 border-2 border-transparent focus:border-emerald-500 rounded-xl px-4 py-3 text-xs font-bold transition-all outline-none" options={[{ value: "Low", label: "Low Risk" }, { value: "Medium", label: "Medium Incident" }, { value: "High", label: "Critical Escalation" }]} />
                            </div>
                        </div>
                        <div className="flex gap-3 pt-2">
                            <button onClick={handleSaveCorrection} style={{ flex: 1, padding: '12px', background: '#0f1f12', color: '#ffffff', borderRadius: '10px', fontWeight: 600, fontSize: '11px', textTransform: 'uppercase', border: 'none', cursor: 'pointer' }}>Save</button>
                            <button onClick={() => setIsCorrecting(false)} style={{ flex: 1, padding: '12px', background: '#f3f4f6', color: '#475569', borderRadius: '10px', fontWeight: 600, fontSize: '11px', textTransform: 'uppercase', border: 'none', cursor: 'pointer' }}>Abort</button>
                        </div>
                    </Card>
                </div>
            )}
        </div>
    );
};

export default AdminTicketDetail;
