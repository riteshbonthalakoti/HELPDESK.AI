import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
    ArrowLeft, Clock, Bot, UserCog,
    ShieldCheck, Calendar, Zap, Image as ImageIcon, MessageSquare,
    RotateCcw, Loader2, CheckCircle2, History
} from 'lucide-react';
import { formatFullTimestamp, formatRelativeTime } from '../../utils/dateUtils';
import { supabase } from "../../lib/supabaseClient";
import { Card } from "../../components/ui/card";
import TicketStatusBadge from "../components/TicketStatusBadge";
import TicketTimeline from "../components/TicketTimeline";
import TicketChat from "../../components/shared/TicketChat";
import { formatTicketId } from "../../utils/format";
import CSATModal from "../components/CSATModal";

const TicketDetail = () => {
    const { ticket_id } = useParams();
    const navigate = useNavigate();
    const [ticket, setTicket] = useState(null);
    const [loading, setLoading] = useState(true);
    const [isReopening, setIsReopening] = useState(false);
    const [showCsat, setShowCsat] = useState(false);
    const [csatHasBeenDismissed, setCsatHasBeenDismissed] = useState(false);

    useEffect(() => {
        window.scrollTo(0, 0);

        const fetchInitialTicket = async () => {
            setLoading(true);
            try {
                const { data, error } = await supabase
                    .from('tickets')
                    .select('*')
                    .eq('id', ticket_id)
                    .single();

                if (error) throw error;
                if (data) {
                    setTicket({
                        ...data,
                        ticket_id: data.id,
                        text: data.description,
                        summary: data.subject,
                    });
                }
            } catch (err) {
                console.error("Error fetching ticket:", err);
            } finally {
                setLoading(false);
            }
        };

        fetchInitialTicket();

        // 3. Subscribe to REAL-TIME updates for THIS ticket
        const channel = supabase
            .channel(`ticket_update_${ticket_id}`)
            .on(
                'postgres_changes',
                {
                    event: 'UPDATE',
                    schema: 'public',
                    table: 'tickets',
                    filter: `id=eq.${ticket_id}`
                },
                (payload) => {
                    console.log("Real-time ticket update received:", payload.new);
                    setTicket(prev => ({
                        ...prev,
                        ...payload.new,
                        ticket_id: payload.new.id,
                        text: payload.new.description,
                        summary: payload.new.subject,
                    }));
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [ticket_id]);

    // Show CSAT modal if ticket is resolved, not yet rated, and not dismissed in this session
    useEffect(() => {
        if (ticket?.status?.toLowerCase()?.includes('resolv') && !ticket.csat_rating && !csatHasBeenDismissed) {
            const timer = setTimeout(() => setShowCsat(true), 1200);
            return () => clearTimeout(timer);
        } else {
            setShowCsat(false);
        }
    }, [ticket?.status, ticket?.csat_rating, csatHasBeenDismissed]);

    if (loading) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center p-10 mt-20">
                <div className="h-12 w-12 animate-spin rounded-full border-4 border-emerald-600 border-t-transparent"></div>
                <p className="mt-4 text-gray-500 font-bold uppercase tracking-widest text-xs">Retrieving Ticket Data...</p>
            </div>
        );
    }

    if (!ticket) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center p-10 mt-20">
                <TicketStatusBadge status="Error" />
                <h2 className="text-2xl font-bold mt-4 text-gray-900">Ticket Not Found</h2>
                <p className="text-gray-500 mt-2 text-center max-w-md">We couldn't locate the ticket you're looking for. It may have been deleted or the ID is incorrect.</p>
                <button
                    onClick={() => navigate('/my-tickets')}
                    className="mt-6 px-6 py-2 bg-emerald-600 text-white rounded-xl font-bold hover:bg-emerald-700 transition"
                >
                    Back to My Tickets
                </button>
            </div>
        );
    }

    // Safely parse arrays and formats
    const entities = ticket.metadata?.entities || ticket.entities || [];
    const solutionSteps = Array.isArray(ticket.solution_steps) ? ticket.solution_steps : [];
    const isAutoResolved = ticket.auto_resolve === true;
    const confidenceScore = ticket.metadata?.confidence ?? ticket.routing_confidence ?? 0.92;


    const handleReopen = async () => {
        setIsReopening(true);
        try {
            const updates = {
                status: 'pending_human',
                metadata: {
                    ...(ticket.metadata || {}),
                    reopened_at: new Date().toISOString()
                }
            };

            const { error: upError } = await supabase
                .from('tickets')
                .update(updates)
                .eq('id', ticket.ticket_id);

            if (upError) throw upError;

            setTicket(prev => ({ ...prev, ...updates }));

        } catch (err) {
            console.error("Failed to reopen ticket:", err);
        } finally {
            setIsReopening(false);
        }
    };

    return (
        <main className="flex-1 max-w-[1200px] w-full mx-auto px-4 sm:px-6 py-8 flex flex-col gap-6">
            {/* Header */}
            <div className="flex flex-col gap-4">
                <button
                    onClick={() => navigate('/my-tickets')}
                    className="flex items-center gap-2 text-sm font-semibold text-gray-500 hover:text-emerald-600 w-fit transition-colors"
                >
                    <ArrowLeft size={16} /> Back to Tickets
                </button>
                <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                    <div className="flex-1">
                        <div className="flex flex-wrap items-center gap-3 mb-3">
                            <span className="bg-emerald-50 text-emerald-700 font-mono font-bold px-3 py-1 rounded-lg text-sm border border-emerald-100 shadow-sm">
                                #{formatTicketId(ticket.ticket_id)}
                            </span>
                            <TicketStatusBadge status={ticket.status} />
                            <span className="hidden sm:flex items-center gap-1.5 text-[10px] font-black text-gray-400 uppercase tracking-widest bg-gray-50 px-3 py-1 rounded-lg border border-gray-100">
                                <History size={12} className="text-gray-300" /> Unified Timeline Active
                            </span>
                        </div>
                        <h1 className="text-3xl sm:text-4xl font-black text-gray-900 tracking-tight leading-[1.15] max-w-3xl">
                            {ticket.summary || ticket.subject || (ticket.text?.length > 120 ? ticket.text.substring(0, 120) + "..." : (ticket.text || "No description provided"))}
                        </h1>
                    </div>
                </div>
            </div>

            {/* 2-Column Layout */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                {/* LEFT SIDE (Main Content) */}
                <div className="lg:col-span-2 flex flex-col gap-6">

                    {/* Card 1: Ticket Timeline */}
                    <Card className="p-6 sm:p-8 rounded-2xl border border-gray-100 shadow-sm bg-white">
                        <h2 className="text-lg font-bold text-gray-900 mb-6 flex items-center gap-2">
                            <Clock className="w-5 h-5 text-emerald-600" /> Ticket Timeline
                        </h2>
                        <TicketTimeline ticket={ticket} />
                    </Card>

                    {/* Card 2: Ticket Details */}
                    <Card className="p-6 sm:p-8 rounded-2xl border border-gray-100 shadow-sm bg-white">
                        <h2 className="text-lg font-bold text-gray-900 mb-6 flex items-center gap-2">
                            <ShieldCheck className="w-5 h-5 text-emerald-600" /> Ticket Details
                        </h2>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-6 gap-x-8">
                            <div>
                                <p className="text-xs uppercase font-bold text-gray-400 tracking-wider mb-1.5">Category</p>
                                <p className="text-sm font-semibold text-gray-900 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2">
                                    {ticket.category || 'N/A'}
                                </p>
                            </div>
                            <div>
                                <p className="text-xs uppercase font-bold text-gray-400 tracking-wider mb-1.5">Sub Category</p>
                                <p className="text-sm font-semibold text-gray-900 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2">
                                    {ticket.subcategory || 'N/A'}
                                </p>
                            </div>
                            <div>
                                <p className="text-xs uppercase font-bold text-gray-400 tracking-wider mb-1.5">Priority</p>
                                <p className="text-sm font-semibold text-gray-900 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2">
                                    {ticket.priority || 'N/A'}
                                </p>
                            </div>
                            <div>
                                <p className="text-xs uppercase font-bold text-gray-400 tracking-wider mb-1.5">Assigned Team</p>
                                <p className="text-sm font-semibold text-gray-900 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2">
                                    {ticket.assigned_team || 'General Support'}
                                </p>
                            </div>
                        </div>
                    </Card>

                    {/* NEW: Support Correspondence */}
                    <div className="h-[500px]">
                        <TicketChat
                            ticketId={ticket.ticket_id}
                            currentUserRole="user"
                        />
                    </div>

                </div>

                {/* RIGHT SIDE (Context Panel) */}
                <div className="flex flex-col gap-6">

                    {/* Card 3: AI Understanding */}
                    <Card className="p-6 rounded-2xl border border-gray-100 shadow-sm bg-[#f6f8f7]">
                        <h2 className="text-sm font-bold text-emerald-800 uppercase tracking-widest mb-5 flex items-center gap-2">
                            <Bot className="w-4 h-4" /> AI Context
                        </h2>

                        <div className="mb-5">
                            <div className="flex justify-between items-center mb-2">
                                <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Confidence Score</span>
                                <span className="font-mono text-xs font-black text-emerald-600 bg-emerald-100 px-2 py-0.5 rounded-md">
                                    {Math.round(confidenceScore * 100)}%
                                </span>
                            </div>
                            <div className="w-full bg-gray-200 rounded-full h-1.5">
                                <div className="bg-emerald-500 h-1.5 rounded-full" style={{ width: `${Math.round(confidenceScore * 100)}%` }}></div>
                            </div>
                        </div>

                        <div>
                            <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Extracted Entities</p>
                            {entities.length > 0 ? (
                                <div className="flex flex-wrap gap-2">
                                    {entities.map((entity, i) => (
                                        <span key={i} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-white border border-gray-200 text-gray-700 shadow-sm">
                                            {typeof entity === 'string' ? entity : entity.text || JSON.stringify(entity)}
                                        </span>
                                    ))}
                                </div>
                            ) : (
                                <p className="text-sm text-gray-500 italic">No specific entities detected.</p>
                            )}
                        </div>
                    </Card>

                    {/* Card 4: Screenshot */}
                        <div className="p-6 bg-emerald-900 rounded-2xl border border-emerald-800 text-center shadow-xl">
                            <p className="text-[10px] font-black text-emerald-400 uppercase tracking-[0.2em] mb-2">Registration Timestamp</p>
                            <p
                                className="text-sm font-bold text-white leading-relaxed"
                                title={formatFullTimestamp(ticket.created_at)}
                            >
                                {formatRelativeTime(ticket.created_at)}
                            </p>
                            <p className="text-[10px] text-emerald-500/70 font-medium mt-1">
                                {formatFullTimestamp(ticket.created_at)}
                            </p>
                        </div>
                    <Card className="p-6 rounded-2xl border border-gray-100 shadow-sm bg-white">
                        <h2 className="text-sm font-bold text-gray-900 uppercase tracking-widest mb-4 flex items-center gap-2">
                            <ImageIcon className="w-4 h-4 text-gray-400" /> Attached Media
                        </h2>
                        {(ticket.image_url || ticket.image || ticket.capturedFileBase64) ? (
                            <div
                                className="rounded-xl overflow-hidden border border-gray-100 bg-gray-50 cursor-pointer group relative"
                                onClick={() => window.open(ticket.image_url || ticket.image || ticket.capturedFileBase64, '_blank')}
                            >
                                <img
                                    src={ticket.image_url || ticket.image || ticket.capturedFileBase64}
                                    alt="User uploaded screenshot"
                                    className="w-full h-auto object-cover max-h-[200px] group-hover:opacity-90 transition-opacity"
                                />
                                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 bg-black/10 transition-opacity">
                                    <span className="bg-white/90 text-gray-800 text-xs font-bold px-3 py-1.5 rounded-lg shadow-sm">Click to view full image</span>
                                </div>
                            </div>
                        ) : (
                            <div className="flex flex-col items-center justify-center py-6 bg-gray-50 rounded-xl border border-dashed border-gray-200">
                                <ImageIcon className="w-8 h-8 text-gray-300 mb-2" />
                                <p className="text-xs font-medium text-gray-500">No screenshot provided</p>
                            </div>
                        )}
                    </Card>

                    {/* Card 5: Suggested Solution */}
                    <Card className="p-6 rounded-2xl border border-emerald-100 shadow-sm bg-gradient-to-br from-emerald-50/50 to-white relative overflow-hidden">
                        <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/5 rounded-full blur-3xl -mr-10 -mt-10"></div>
                        <h2 className="text-sm font-bold text-gray-900 uppercase tracking-widest mb-4 flex items-center gap-2 relative z-10">
                            <Zap className="w-4 h-4 text-emerald-500 fill-emerald-500" /> Resolution
                        </h2>

                        <div className="relative z-10">
                            {isAutoResolved ? (
                                <div>
                                    <p className="text-sm font-bold text-emerald-800 mb-3">Suggested Solution</p>
                                    <div className="space-y-3">
                                        {solutionSteps.length > 0 ? (
                                            solutionSteps.map((step, idx) => (
                                                <div key={idx} className="flex gap-3 text-sm">
                                                    <div className="mt-0.5 w-5 h-5 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center flex-shrink-0 font-bold text-xs">
                                                        {idx + 1}
                                                    </div>
                                                    <p className="text-gray-700 font-medium leading-relaxed">{step}</p>
                                                </div>
                                            ))
                                        ) : (
                                            <p className="text-sm text-gray-600">The AI provided an automated resolution to this issue.</p>
                                        )}
                                    </div>
                                    <button className="w-full mt-5 px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-lg text-sm font-bold hover:bg-gray-50 transition shadow-sm">
                                        Did this help?
                                    </button>
                                </div>
                            ) : ticket.status === 'resolved' ? (
                                <div className="flex flex-col gap-4">
                                    <div className="flex gap-3 text-sm">
                                        <div className="mt-0.5 w-5 h-5 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center flex-shrink-0 font-bold text-xs">
                                            <CheckCircle2 size={12} />
                                        </div>
                                        <p className="text-gray-700 font-medium leading-relaxed">
                                            This ticket was resolved by human support from the <span className="font-bold text-gray-900">{ticket.assigned_team || 'Support'}</span> team.
                                        </p>
                                    </div>

                                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mt-2">
                                        <p className="text-amber-800 text-sm font-bold mb-2">Issue not fully resolved?</p>
                                        <button
                                            onClick={handleReopen}
                                            disabled={isReopening}
                                            className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-white border border-amber-200 text-amber-700 rounded-lg text-sm font-bold hover:bg-amber-50 transition shadow-sm disabled:opacity-50"
                                        >
                                            {isReopening ? <Loader2 size={16} className="animate-spin" /> : <RotateCcw size={16} />}
                                            Reopen Ticket
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <div className="flex flex-col">
                                    <div className="flex gap-3 text-sm">
                                        <div className="mt-0.5 w-5 h-5 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center flex-shrink-0 font-bold text-xs">
                                            <UserCog size={12} />
                                        </div>
                                        <p className="text-gray-700 font-medium leading-relaxed">
                                            This ticket has been escalated to human support. The <span className="font-bold text-gray-900">{ticket.assigned_team || 'Support'}</span> team is currently reviewing it.
                                        </p>
                                    </div>
                                </div>
                            )}
                        </div>
                    </Card>

                </div>
            </div>

            {/* CSAT Modal */}
            {showCsat && (
                <CSATModal
                    ticketId={ticket.ticket_id}
                    onSubmit={(rating) => {
                        setShowCsat(false);
                        setCsatHasBeenDismissed(true);
                        setTicket(prev => ({ ...prev, csat_rating: rating }));
                    }}
                    onDismiss={() => {
                        setShowCsat(false);
                        setCsatHasBeenDismissed(true);
                    }}
                />
            )}
        </main>
    );
};

export default TicketDetail;
