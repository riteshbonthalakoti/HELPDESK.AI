import React, { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
    CheckCircle2, User,
    ArrowLeft, Activity, ShieldCheck,
    FileText, Briefcase, RotateCcw, Send, MessageCircle,
    BrainCircuit, ImageIcon
} from 'lucide-react';
import useTicketStore from '../store/ticketStore';
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import SLACountdownTimer from "../components/shared/SLACountdownTimer";

function TicketDetailView() {
    const { ticket_id } = useParams();
    const { tickets, appendMessage, updateTicket } = useTicketStore();
    const navigate = useNavigate();
    const [ticket, setTicket] = useState(null);
    const [newMessage, setNewMessage] = useState('');
    const [isSending, setIsSending] = useState(false);
    const messagesEndRef = useRef(null);

    // Force refresh when window gains focus to ensure latest data from Admin updates
    useEffect(() => {
        const handleFocus = () => {
            useTicketStore.persist.rehydrate();
        };
        window.addEventListener('focus', handleFocus);
        return () => window.removeEventListener('focus', handleFocus);
    }, []);

    const viewedRef = useRef(null);

    useEffect(() => {
        const foundTicket = tickets.find(t => t.ticket_id.toString() === ticket_id);

        if (!foundTicket) {
            // Only navigate if we've already loaded tickets and still don't find it
            if (tickets.length > 0) {
                navigate('/my-tickets');
            }
            return;
        }

 
        setTicket(foundTicket);

        // Mark ticket as viewed — only once per ticket_id visit to avoid infinite loops
        if (viewedRef.current !== ticket_id) {
            updateTicket(foundTicket.ticket_id, {
                last_user_viewed_at: new Date().toISOString()
            });
            viewedRef.current = ticket_id;
        }
    }, [ticket_id, tickets, navigate, updateTicket]);

    // Auto-scroll to bottom when messages change
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [ticket?.messages]);

    if (!ticket) return null;

    const isResolved = ticket.status === 'Resolved by Human Support';
    const isReopened = ticket.reopened_at && !isResolved;
    const messages = ticket.messages || [];

    const handleReopenTicket = () => {
        updateTicket(ticket.ticket_id, {
            status: 'Pending Human Support',
            reopened_at: new Date().toISOString(),
            reopened_by: ticket.owner_id
        });
    };

    const handleSendMessage = (e) => {
        e.preventDefault();
        const text = newMessage.trim();
        if (!text || isSending) return;

        setIsSending(true);
        setNewMessage('');

        appendMessage(ticket.ticket_id, {
            sender: 'user',
            message: text,
            timestamp: new Date().toISOString()
        });

        setIsSending(false);
    };

    return (
        <main className="flex-1 w-full max-w-[1100px] mx-auto px-4 md:px-6 py-6 md:py-10 flex flex-col gap-6 md:gap-8">
            <div className="w-full">
                <button
                    onClick={() => navigate('/my-tickets')}
                    className="flex items-center gap-2 text-gray-500 hover:text-emerald-700 font-bold mb-6 transition-colors"
                >
                    <ArrowLeft size={18} /> Back to My Tickets
                </button>

                {/* Resolved Banner */}
                {isResolved && (
                    <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-6 mb-6 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-sm animate-in fade-in slide-in-from-top-4">
                        <div className="flex items-center gap-4">
                            <div className="w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center shrink-0">
                                <CheckCircle2 className="text-emerald-600 w-6 h-6" />
                            </div>
                            <div>
                                <h2 className="text-xl font-black text-emerald-900">Your issue has been resolved</h2>
                                <p className="text-emerald-700 font-medium">Closed on {new Date(ticket.resolved_at).toLocaleString()}</p>
                            </div>
                        </div>
                        <button
                            onClick={handleReopenTicket}
                            className="px-5 py-2.5 bg-white border border-emerald-200 text-emerald-700 font-bold rounded-xl hover:bg-emerald-50 hover:border-emerald-300 transition-all flex items-center gap-2 shadow-sm"
                        >
                            <RotateCcw size={16} /> Reopen Ticket
                        </button>
                    </div>
                )}

                {/* Reopened Banner */}
                {isReopened && (
                    <div className="bg-amber-50 border border-amber-100 rounded-2xl p-6 mb-6 flex items-center gap-4 shadow-sm animate-in fade-in slide-in-from-top-4">
                        <div className="w-12 h-12 bg-amber-100 rounded-full flex items-center justify-center shrink-0">
                            <RotateCcw className="text-amber-600 w-6 h-6" />
                        </div>
                        <div>
                            <h2 className="text-xl font-black text-amber-900">Ticket Reopened</h2>
                            <p className="text-amber-700 font-medium">Sent back to our support team. We'll respond shortly.</p>
                        </div>
                    </div>
                )}

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {/* LEFT: Ticket Info + Conversation */}
                    <div className="lg:col-span-2 space-y-6">

                        {/* Ticket Info Card */}
                        <Card className="p-0 overflow-hidden border-none shadow-xl shadow-gray-200/50">
                            <CardHeader className="bg-gray-50 px-8 py-5 border-b border-gray-100">
                                <CardTitle className="font-bold text-gray-800 flex items-center gap-2">
                                    <FileText size={18} /> Ticket Information
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="p-8 space-y-6">
                                <div>
                                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-1">Ticket ID</label>
                                    <p className="text-xl md:text-2xl font-mono font-black text-emerald-900 tracking-wider">#{ticket.ticket_id}</p>
                                </div>
                                <div>
                                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-1">Summary</label>
                                    <p className="text-xl font-medium text-gray-900 leading-relaxed bg-gray-50/50 p-4 rounded-xl border border-gray-100">
                                        {ticket.summary}
                                    </p>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                    <div className="p-4 bg-gray-50 rounded-xl border border-gray-100">
                                        <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-1">Assigned Team</label>
                                        <div className="flex items-center gap-2 font-bold text-gray-700">
                                            <Briefcase size={16} className="text-emerald-600" />
                                            {ticket.assigned_team}
                                        </div>
                                    </div>
                                    <div className="p-4 bg-gray-50 rounded-xl border border-gray-100">
                                        <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-1">Current Status</label>
                                        <div className={`flex items-center gap-2 font-black uppercase text-xs tracking-tight ${isResolved ? 'text-emerald-600' : 'text-amber-600'}`}>
                                            <div className={`w-2 h-2 rounded-full ${isResolved ? 'bg-emerald-600' : 'bg-amber-500 animate-pulse'}`}></div>
                                            {ticket.status}
                                        </div>
                                    </div>
                                    <div className="p-4 bg-gray-50 rounded-xl border border-gray-100">
                                        <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-1">SLA Countdown</label>
                                        <SLACountdownTimer ticket={ticket} showProgress />
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        {/* AI Analysis Card */}
                        {(ticket.reasoning || ticket.image_description) && (
                            <Card className="p-0 overflow-hidden border-none shadow-xl shadow-gray-200/50">
                                <CardHeader className="bg-emerald-900 px-8 py-5 border-b border-emerald-800">
                                    <CardTitle className="font-bold text-white flex items-center gap-2">
                                        <BrainCircuit size={18} className="text-emerald-400" /> AI Insights
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="p-8 space-y-6">
                                    {ticket.reasoning && (
                                        <div>
                                            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-1">AI Reasoning</label>
                                            <p className="text-gray-700 italic border-l-4 border-emerald-500 pl-4 py-2 bg-emerald-50/30 rounded-r-lg">
                                                {ticket.reasoning}
                                            </p>
                                        </div>
                                    )}
                                    {ticket.image_description && (
                                        <div>
                                            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-1">Visual Analysis</label>
                                            <div className="flex items-center gap-2 text-sm font-bold text-blue-900 uppercase tracking-widest mb-2">
                                                <ImageIcon size={14} className="text-blue-600" /> Image Description
                                            </div>
                                            <p className="text-gray-700 text-sm bg-blue-50/50 p-4 rounded-xl border border-blue-100 italic">
                                                "{ticket.image_description}"
                                            </p>
                                        </div>
                                    )}
                                </CardContent>
                            </Card>
                        )}

                        {/* Conversation Card */}
                        <Card className="p-0 overflow-hidden border-none shadow-xl shadow-gray-200/50">
                            <CardHeader className="bg-gray-50 px-8 py-5 border-b border-gray-100 flex items-center justify-between">
                                <CardTitle className="font-bold text-gray-800 flex items-center gap-2">
                                    <MessageCircle size={18} className="text-emerald-600" /> Conversation
                                </CardTitle>
                                <span className="text-xs font-bold text-gray-400 bg-gray-200 px-2 py-1 rounded-full">
                                    {messages.length} message{messages.length !== 1 ? 's' : ''}
                                </span>
                            </CardHeader>

                            <CardContent className="p-0">
                                {/* Message Thread */}
                                <div className="p-6 space-y-4 max-h-96 overflow-y-auto">
                                    {messages.length === 0 ? (
                                        <p className="text-center text-gray-400 text-sm py-8 italic">No messages yet.</p>
                                    ) : (
                                        messages.map((msg, i) => {
                                            const isUser = msg.sender === 'user';
                                            return (
                                                <div key={i} className={`flex gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}>
                                                    {!isUser && (
                                                        <div className="w-8 h-8 rounded-full bg-emerald-100 border-2 border-emerald-200 flex items-center justify-center shrink-0 mt-1">
                                                            <ShieldCheck size={14} className="text-emerald-600" />
                                                        </div>
                                                    )}
                                                    <div className={`max-w-[78%] flex flex-col gap-1 ${isUser ? 'items-end' : 'items-start'}`}>
                                                        <div className={`px-4 py-3 rounded-2xl text-sm font-medium leading-relaxed ${isUser
                                                            ? 'bg-emerald-600 text-white rounded-tr-sm'
                                                            : 'bg-gray-100 text-gray-800 rounded-tl-sm'
                                                            }`}>
                                                            {msg.message}
                                                        </div>
                                                        <p className={`text-[10px] font-medium text-gray-400 px-1 ${isUser ? 'text-right' : 'text-left'}`}>
                                                            {isUser ? 'You' : 'Support Agent'} · {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                        </p>
                                                    </div>
                                                    {isUser && (
                                                        <div className="w-8 h-8 rounded-full bg-emerald-600 flex items-center justify-center shrink-0 mt-1">
                                                            <User size={14} className="text-white" />
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })
                                    )}
                                    <div ref={messagesEndRef} />
                                </div>

                                {/* Message Input */}
                                <div className="px-6 pb-6 border-t border-gray-100 pt-4">
                                    <form onSubmit={handleSendMessage} className="flex gap-3">
                                        <input
                                            id="message-input"
                                            type="text"
                                            value={newMessage}
                                            onChange={(e) => setNewMessage(e.target.value)}
                                            placeholder="Add more details…"
                                            disabled={isSending}
                                            className="flex-1 px-4 py-3 rounded-xl border border-gray-200 bg-gray-50 text-sm font-medium text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all disabled:opacity-50"
                                        />
                                        <button
                                            id="send-message-btn"
                                            type="submit"
                                            disabled={!newMessage.trim() || isSending}
                                            className="px-5 py-3 bg-emerald-600 text-white rounded-xl font-bold hover:bg-emerald-700 active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2 shadow-sm"
                                        >
                                            <Send size={16} />
                                            Send
                                        </button>
                                    </form>
                                </div>
                            </CardContent>
                        </Card>
                    </div>

                    {/* RIGHT: Journey Timeline + Created At */}
                    <div className="space-y-6">
                        <Card className="p-0 overflow-hidden border-none shadow-xl shadow-gray-200/50">
                            <CardHeader className="bg-emerald-900 text-white px-6 py-4">
                                <CardTitle className="font-bold text-sm flex items-center gap-2 uppercase tracking-widest">
                                    <Activity size={16} className="text-emerald-400" /> Ticket Journey
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="p-6 relative">
                                <div className="absolute left-10 top-10 bottom-10 w-0.5 bg-gray-100"></div>
                                <div className="space-y-12">
                                    {/* Reported */}
                                    <div className="flex items-start gap-6 relative">
                                        <div className="w-8 h-8 rounded-full bg-emerald-100 border-2 border-emerald-500 flex items-center justify-center shrink-0 z-10 shadow-sm">
                                            <CheckCircle2 size={14} className="text-emerald-600" />
                                        </div>
                                        <div>
                                            <p className="font-black text-sm text-gray-900 uppercase tracking-tight">Reported</p>
                                            <p className="text-xs text-gray-400 font-medium">Issue Logged</p>
                                        </div>
                                    </div>
                                    {/* AI Processed */}
                                    <div className="flex items-start gap-6 relative">
                                        <div className="w-8 h-8 rounded-full bg-emerald-100 border-2 border-emerald-500 flex items-center justify-center shrink-0 z-10 shadow-sm">
                                            <ShieldCheck size={14} className="text-emerald-600" />
                                        </div>
                                        <div>
                                            <p className="font-black text-sm text-gray-900 uppercase tracking-tight">AI Processed</p>
                                            <p className="text-xs text-gray-400 font-medium">Triage Complete</p>
                                        </div>
                                    </div>
                                    {/* Escalated */}
                                    <div className="flex items-start gap-6 relative">
                                        <div className="w-8 h-8 rounded-full bg-emerald-100 border-2 border-emerald-500 flex items-center justify-center shrink-0 z-10 shadow-sm">
                                            <User size={14} className="text-emerald-600" />
                                        </div>
                                        <div>
                                            <p className="font-black text-sm text-gray-900 uppercase tracking-tight">Escalated</p>
                                            <p className="text-xs text-gray-400 font-medium">Human Support Notified</p>
                                        </div>
                                    </div>
                                    {/* Reopened */}
                                    {ticket.reopened_at && (
                                        <div className="flex items-start gap-6 relative animate-in fade-in duration-500">
                                            <div className="w-8 h-8 rounded-full bg-amber-100 border-2 border-amber-500 flex items-center justify-center shrink-0 z-10 shadow-sm">
                                                <RotateCcw size={14} className="text-amber-600" />
                                            </div>
                                            <div>
                                                <p className="font-black text-sm text-gray-900 uppercase tracking-tight">Reopened</p>
                                                <p className="text-xs text-gray-400 font-medium">Sent Back to Support</p>
                                            </div>
                                        </div>
                                    )}
                                    {/* Resolved */}
                                    {isResolved && (
                                        <div className="flex items-start gap-6 relative animate-in fade-in duration-500">
                                            <div className="w-8 h-8 rounded-full bg-emerald-900 border-2 border-emerald-700 flex items-center justify-center shrink-0 z-10 shadow-lg ring-4 ring-emerald-50">
                                                <CheckCircle2 size={14} className="text-emerald-400" />
                                            </div>
                                            <div>
                                                <p className="font-black text-sm text-emerald-900 uppercase tracking-tight">Resolved</p>
                                                <p className="text-xs text-emerald-600 font-bold uppercase tracking-widest">Closed</p>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </CardContent>
                        </Card>

                        <div className="p-4 bg-white rounded-2xl border border-gray-100 text-center shadow-sm">
                            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Created At</p>
                            <p className="text-sm font-bold text-gray-700">{new Date(ticket.created_at).toLocaleString()}</p>
                        </div>
                    </div>
                </div>
            </div>
        </main>
    );
}

export default TicketDetailView;
