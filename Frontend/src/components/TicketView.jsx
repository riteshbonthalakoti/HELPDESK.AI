import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
    CheckCircle2, User, ArrowLeft, Activity, ShieldCheck,
    FileText, Briefcase, RotateCcw, Send, MessageCircle,
    BrainCircuit, ImageIcon, Keyboard, HelpCircle
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { KeyboardShortcutsModal } from './KeyboardShortcutsModal';

export function TicketView({ ticket, onBack, onReopen, onSendMessage, isSending = false }) {
    const [newMessage, setNewMessage] = useState('');
    const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);
    const messagesEndRef = useRef(null);
    const messageInputRef = useRef(null);

    // Auto-scroll when new messages arrive
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [ticket?.messages]);

    // Handle global keyboard shortcuts
    const handleGlobalKeyDown = useCallback((e) => {
        const target = e.target;
        const isInputField = target.tagName === 'INPUT' || 
                             target.tagName === 'TEXTAREA' || 
                             target.isContentEditable;

        // If inside message input, allow Ctrl+Enter or Cmd+Enter to send
        if (isInputField) {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                if (newMessage.trim() && !isSending) {
                    onSendMessage(newMessage.trim());
                    setNewMessage('');
                }
            }
            if (e.key === 'Escape') {
                target.blur();
            }
            return;
        }

        // Global shortcuts when not actively typing in an input
        if (e.key === '?' || (e.shiftKey && e.key === '/')) {
            e.preventDefault();
            setIsShortcutsOpen(prev => !prev);
        } else if (e.key === 'b' || e.key === 'B') {
            e.preventDefault();
            onBack();
        } else if (e.key === 'c' || e.key === 'C' || e.key === 'm' || e.key === 'M') {
            e.preventDefault();
            messageInputRef.current?.focus();
        } else if ((e.key === 'r' || e.key === 'R') && ticket?.status === 'Resolved by Human Support') {
            e.preventDefault();
            onReopen?.();
        }
    }, [newMessage, isSending, onSendMessage, onBack, onReopen, ticket?.status]);

    useEffect(() => {
        window.addEventListener('keydown', handleGlobalKeyDown);
        return () => window.removeEventListener('keydown', handleGlobalKeyDown);
    }, [handleGlobalKeyDown]);

    if (!ticket) return null;

    const isResolved = ticket.status === 'Resolved by Human Support';
    const isReopened = ticket.reopened_at && !isResolved;
    const messages = ticket.messages || [];

    const handleSubmit = (e) => {
        e.preventDefault();
        const text = newMessage.trim();
        if (!text || isSending) return;
        onSendMessage(text);
        setNewMessage('');
    };

    return (
        <section 
            className="flex-1 w-full max-w-[1100px] mx-auto px-4 md:px-6 py-6 md:py-10 flex flex-col gap-6 md:gap-8"
            role="region"
            aria-label="Ticket detail workspace"
        >
            {/* Top Navigation & Action Bar */}
            <div className="w-full flex items-center justify-between gap-4 mb-2">
                <button
                    onClick={onBack}
                    className="flex items-center gap-2 text-gray-500 hover:text-emerald-700 font-bold transition-colors focus:outline-hidden focus:ring-2 focus:ring-emerald-500 rounded-lg px-2 py-1"
                    aria-label="Navigate back to My Tickets list (Shortcut: b)"
                >
                    <ArrowLeft size={18} aria-hidden="true" /> 
                    <span>Back to My Tickets</span>
                    <kbd className="hidden sm:inline-block ml-1 px-1.5 py-0.5 text-[10px] font-mono font-bold bg-gray-100 border border-gray-300 rounded text-gray-500">
                        b
                    </kbd>
                </button>

                {/* Keyboard Shortcuts Trigger Button */}
                <button
                    onClick={() => setIsShortcutsOpen(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-gray-600 bg-white hover:bg-gray-50 border border-gray-200 rounded-xl shadow-2xs transition-all hover:border-gray-300 focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                    aria-label="Open keyboard shortcuts guide (Shortcut: ?)"
                    aria-haspopup="dialog"
                    aria-expanded={isShortcutsOpen}
                >
                    <Keyboard size={15} className="text-emerald-600" aria-hidden="true" />
                    <span className="hidden sm:inline">Shortcuts</span>
                    <kbd className="px-1.5 py-0.5 text-[10px] font-mono font-black bg-gray-100 border border-gray-300 rounded text-gray-600">
                        ?
                    </kbd>
                </button>
            </div>

            {/* Resolved Banner */}
            {isResolved && (
                <div 
                    role="alert"
                    aria-live="polite"
                    className="bg-emerald-50 border border-emerald-100 rounded-2xl p-6 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-xs animate-in fade-in slide-in-from-top-4"
                >
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center shrink-0" aria-hidden="true">
                            <CheckCircle2 className="text-emerald-600 w-6 h-6" />
                        </div>
                        <div>
                            <h2 className="text-xl font-black text-emerald-900">Your issue has been resolved</h2>
                            <p className="text-emerald-700 font-medium">Closed on {new Date(ticket.resolved_at).toLocaleString()}</p>
                        </div>
                    </div>
                    <button
                        onClick={onReopen}
                        className="px-5 py-2.5 bg-white border border-emerald-200 text-emerald-700 font-bold rounded-xl hover:bg-emerald-50 hover:border-emerald-300 transition-all flex items-center gap-2 shadow-2xs focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                        aria-label="Reopen this support ticket (Shortcut: r)"
                    >
                        <RotateCcw size={16} aria-hidden="true" /> 
                        <span>Reopen Ticket</span>
                        <kbd className="px-1.5 py-0.5 text-[10px] font-mono font-bold bg-gray-100 border border-emerald-200 rounded text-emerald-800">
                            r
                        </kbd>
                    </button>
                </div>
            )}

            {/* Main Workspace Layout */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Left 2 Cols: Ticket Details & Live Conversation */}
                <div className="lg:col-span-2 flex flex-col gap-6">
                    {/* Ticket Header & Issue Context Card */}
                    <Card className="rounded-2xl border-gray-100 shadow-sm overflow-hidden" tabIndex={0} aria-label="Ticket context card">
                        <CardHeader className="bg-white border-b border-gray-50 pb-4">
                            <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
                                <span 
                                    className="px-3 py-1 bg-emerald-50 text-emerald-700 font-black text-xs rounded-full uppercase tracking-wider"
                                    role="status"
                                    aria-label={`Category: ${ticket.category || 'General Support'}`}
                                >
                                    {ticket.category || 'General Support'}
                                </span>
                                <span 
                                    className={`px-3 py-1 font-bold text-xs rounded-full flex items-center gap-1.5 ${
                                        isResolved ? 'bg-emerald-100 text-emerald-800' :
                                        isReopened ? 'bg-amber-100 text-amber-800' :
                                        'bg-blue-50 text-blue-700'
                                    }`}
                                    role="status"
                                    aria-live="polite"
                                    aria-label={`Current Ticket Status: ${ticket.status}`}
                                >
                                    <span className="w-2 h-2 rounded-full bg-current" aria-hidden="true" />
                                    {ticket.status}
                                </span>
                            </div>
                            <h1 id="ticket-title" className="text-2xl font-black text-gray-900 leading-tight">
                                {ticket.subject}
                            </h1>
                            <p className="text-xs text-gray-400 font-mono mt-1">Ticket ID: #{ticket.ticket_id}</p>
                        </CardHeader>
                        <CardContent className="pt-5 flex flex-col gap-4">
                            <div className="text-gray-700 leading-relaxed font-medium whitespace-pre-wrap">
                                {ticket.description}
                            </div>
                            {ticket.attachment_url && (
                                <div className="mt-2 pt-4 border-t border-gray-100">
                                    <div className="flex items-center gap-2 text-xs font-black text-gray-400 uppercase tracking-wider mb-2">
                                        <ImageIcon size={14} aria-hidden="true" /> Attached Screenshot / Evidence
                                    </div>
                                    <img 
                                        src={ticket.attachment_url} 
                                        alt="Ticket attachment screenshot" 
                                        className="rounded-xl border border-gray-200 max-h-72 object-contain bg-gray-50 p-1"
                                    />
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    {/* Chat Conversation & Support Message Log */}
                    <Card className="rounded-2xl border-gray-100 shadow-sm flex flex-col flex-1 min-h-[420px]">
                        <CardHeader className="bg-gray-50/50 border-b border-gray-100 py-3.5 px-6 flex flex-row items-center justify-between">
                            <div className="flex items-center gap-2 font-black text-gray-800 text-sm">
                                <MessageCircle size={18} className="text-emerald-600" aria-hidden="true" />
                                <span>Support Conversation</span>
                            </div>
                            <span className="text-xs font-bold text-gray-400" aria-live="polite">
                                {messages.length} {messages.length === 1 ? 'Message' : 'Messages'}
                            </span>
                        </CardHeader>

                        {/* Message Feed Area */}
                        <CardContent className="flex-1 p-6 flex flex-col justify-between gap-6">
                            <div 
                                className="flex flex-col gap-4 overflow-y-auto max-h-[400px] pr-2 focus:outline-hidden"
                                role="log"
                                aria-label="Ticket message history"
                                aria-live="polite"
                                tabIndex={0}
                            >
                                {messages.length === 0 ? (
                                    <div className="text-center py-12 text-gray-400 flex flex-col items-center gap-2">
                                        <BrainCircuit size={32} className="text-gray-300" aria-hidden="true" />
                                        <p className="text-sm font-medium">No conversation messages yet.</p>
                                        <p className="text-xs text-gray-400">Type a message below to reach support.</p>
                                    </div>
                                ) : (
                                    messages.map((m, idx) => {
                                        const isUser = m.sender === 'user';
                                        return (
                                            <article
                                                key={idx}
                                                className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} gap-1`}
                                                aria-label={`Message from ${isUser ? 'You' : 'Support Specialist'} at ${new Date(m.timestamp).toLocaleTimeString()}`}
                                            >
                                                <div className="flex items-center gap-2 text-[11px] font-bold text-gray-400 px-1">
                                                    <span>{isUser ? 'You' : 'Support Specialist'}</span>
                                                    <span>•</span>
                                                    <time dateTime={m.timestamp}>{new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
                                                </div>
                                                <div className={`p-4 rounded-2xl max-w-[85%] text-sm font-medium leading-relaxed ${
                                                    isUser 
                                                        ? 'bg-emerald-700 text-white rounded-tr-xs shadow-xs' 
                                                        : 'bg-gray-100 text-gray-800 rounded-tl-xs'
                                                }`}>
                                                    {m.message}
                                                </div>
                                            </article>
                                        );
                                    })
                                )}
                                <div ref={messagesEndRef} tabIndex={-1} aria-hidden="true" />
                            </div>

                            {/* Message Composer Form */}
                            <form onSubmit={handleSubmit} className="relative mt-2" aria-label="Send reply to ticket">
                                <label htmlFor="ticket-reply-textarea" className="sr-only">
                                    Type your reply message (Press Ctrl+Enter to send)
                                </label>
                                <textarea
                                    id="ticket-reply-textarea"
                                    ref={messageInputRef}
                                    value={newMessage}
                                    onChange={(e) => setNewMessage(e.target.value)}
                                    placeholder="Type your reply message... (Press c or m to focus, Ctrl+Enter to send)"
                                    rows={3}
                                    disabled={isSending}
                                    className="w-full p-4 pr-14 border border-gray-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 focus:outline-hidden transition-all resize-none shadow-2xs"
                                    aria-label="Ticket reply message composer"
                                    aria-required="true"
                                />
                                <button
                                    type="submit"
                                    disabled={!newMessage.trim() || isSending}
                                    className="absolute bottom-4 right-3.5 p-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 disabled:hover:bg-emerald-600 text-white rounded-lg transition-colors shadow-2xs focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                                    aria-label="Send reply message"
                                >
                                    <Send size={16} aria-hidden="true" />
                                </button>
                            </form>
                        </CardContent>
                    </Card>
                </div>

                {/* Right Column: Workflow Timeline & Metadata Sidebar */}
                <div className="flex flex-col gap-6">
                    <Card className="rounded-2xl border-gray-100 shadow-sm" tabIndex={0} aria-label="Ticket resolution timeline">
                        <CardHeader className="bg-gray-50/50 border-b border-gray-100 py-3.5 px-6">
                            <h2 className="font-bold text-gray-800 text-sm flex items-center gap-2">
                                <Activity size={16} className="text-emerald-600" aria-hidden="true" />
                                <span>Resolution Timeline</span>
                            </h2>
                        </CardHeader>
                        <CardContent className="p-6">
                            <ol className="relative flex flex-col gap-6 pl-2" role="list" aria-label="Audit progress steps">
                                <li className="flex items-start gap-4 relative" role="listitem">
                                    <div className="w-8 h-8 rounded-full bg-emerald-100 border-2 border-emerald-500 flex items-center justify-center shrink-0 z-10 shadow-2xs">
                                        <CheckCircle2 size={14} className="text-emerald-600" aria-hidden="true" />
                                    </div>
                                    <div>
                                        <p className="font-black text-sm text-gray-900 uppercase tracking-tight">Reported</p>
                                        <p className="text-xs text-gray-400 font-medium">Issue Logged</p>
                                    </div>
                                </li>
                                <li className="flex items-start gap-4 relative" role="listitem">
                                    <div className="w-8 h-8 rounded-full bg-emerald-100 border-2 border-emerald-500 flex items-center justify-center shrink-0 z-10 shadow-2xs">
                                        <ShieldCheck size={14} className="text-emerald-600" aria-hidden="true" />
                                    </div>
                                    <div>
                                        <p className="font-black text-sm text-gray-900 uppercase tracking-tight">AI Processed</p>
                                        <p className="text-xs text-gray-400 font-medium">Triage Complete</p>
                                    </div>
                                </li>
                                <li className="flex items-start gap-4 relative" role="listitem">
                                    <div className="w-8 h-8 rounded-full bg-emerald-100 border-2 border-emerald-500 flex items-center justify-center shrink-0 z-10 shadow-2xs">
                                        <User size={14} className="text-emerald-600" aria-hidden="true" />
                                    </div>
                                    <div>
                                        <p className="font-black text-sm text-gray-900 uppercase tracking-tight">Escalated</p>
                                        <p className="text-xs text-gray-400 font-medium">Human Support Notified</p>
                                    </div>
                                </li>
                                {ticket.reopened_at && (
                                    <li className="flex items-start gap-4 relative animate-in fade-in duration-300" role="listitem">
                                        <div className="w-8 h-8 rounded-full bg-amber-100 border-2 border-amber-500 flex items-center justify-center shrink-0 z-10 shadow-2xs">
                                            <RotateCcw size={14} className="text-amber-600" aria-hidden="true" />
                                        </div>
                                        <div>
                                            <p className="font-black text-sm text-gray-900 uppercase tracking-tight">Reopened</p>
                                            <p className="text-xs text-gray-400 font-medium">Sent Back to Support</p>
                                        </div>
                                    </li>
                                )}
                                {isResolved && (
                                    <li className="flex items-start gap-4 relative animate-in fade-in duration-300" role="listitem">
                                        <div className="w-8 h-8 rounded-full bg-emerald-900 border-2 border-emerald-700 flex items-center justify-center shrink-0 z-10 shadow-md ring-4 ring-emerald-50">
                                            <CheckCircle2 size={14} className="text-emerald-400" aria-hidden="true" />
                                        </div>
                                        <div>
                                            <p className="font-black text-sm text-emerald-900 uppercase tracking-tight">Resolved</p>
                                            <p className="text-xs text-emerald-600 font-bold uppercase tracking-widest">Closed</p>
                                        </div>
                                    </li>
                                )}
                            </ol>
                        </CardContent>
                    </Card>

                    {/* Metadata Card */}
                    <div 
                        className="p-5 bg-white rounded-2xl border border-gray-100 text-center shadow-xs" 
                        tabIndex={0} 
                        aria-label="Ticket timestamps and metadata"
                    >
                        <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Created At</p>
                        <p className="text-sm font-bold text-gray-700">
                            <time dateTime={ticket.created_at}>{new Date(ticket.created_at).toLocaleString()}</time>
                        </p>
                    </div>
                </div>
            </div>

            {/* Accessible Keyboard Shortcuts Modal */}
            <KeyboardShortcutsModal 
                isOpen={isShortcutsOpen} 
                onClose={() => setIsShortcutsOpen(false)} 
            />
        </section>
    );
}

export default TicketView;
