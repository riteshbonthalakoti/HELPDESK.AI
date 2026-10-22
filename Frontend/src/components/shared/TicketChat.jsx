import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Send, User, ShieldCheck, Bot, MessageSquare, Circle, Loader2 } from 'lucide-react';
import { supabase } from "../../lib/supabaseClient";
import useAuthStore from "../../store/authStore";
import { mergeChatMessages } from './chatMessages.mjs';

const TicketChat = ({ ticketId, currentUserRole = 'user' }) => {
    const [messages, setMessages] = useState([]);
    const [inputValue, setInputValue] = useState('');
    const [isTyping, setIsTyping] = useState(false);
    const [loading, setLoading] = useState(true);
    const [connectionStatus, setConnectionStatus] = useState('Connecting');
    const [sendError, setSendError] = useState('');
    const activeTicketRef = useRef(ticketId);
    const sendingRef = useRef(false);
    const typingTimerRef = useRef(null);
// eslint-disable-next-line no-unused-vars
    const [unreadCount, setUnreadCount] = useState(0);
    const [isAtBottom, setIsAtBottom] = useState(true);

    const [isInternal, setIsInternal] = useState(false);
    const [isStaff, setIsStaff] = useState(false);

    const { user, profile } = useAuthStore();
    const messagesEndRef = useRef(null);
    const scrollContainerRef = useRef(null);
    const inputRef = useRef(null);
    const channelRef = useRef(null);

    // ─── Fetch Messages ──────────────────────────────────────────────────
    const fetchMessages = async () => {
        if (!ticketId) return;
        const fetchingTicket = ticketId;
        try {
            // 1. Fetch Public Messages
            const { data: publicMsgs, error: pubErr } = await supabase
                .from('ticket_messages')
                .select('*')
                .eq('ticket_id', ticketId)
                .order('created_at', { ascending: true });

            if (pubErr) throw pubErr;

            // 2. Fetch Internal Notes if staff
            let internalMsgs = [];
            const userRole = profile?.role || 'user';
            const isStaffUser = ['admin', 'super_admin', 'agent', 'master_admin'].includes(userRole);
            setIsStaff(isStaffUser);

            if (isStaffUser) {
                const { data: privateMsgs, error: privErr } = await supabase
                    .from('internal_notes')
                    .select('*, profiles:agent_id(full_name)')
                    .eq('ticket_id', ticketId)
                    .order('created_at', { ascending: true });

                if (!privErr && privateMsgs) {
                    internalMsgs = privateMsgs.map(m => ({
                        ...m,
                        message: m.content,
                        sender_name: m.profiles?.full_name || 'Agent',
                        sender_role: 'admin',
                        is_internal: true
                    }));
                }
            }

            // 3. Combine and Sort
            const combined = [...(publicMsgs || []), ...internalMsgs].sort(
                (a, b) => new Date(a.created_at) - new Date(b.created_at)
            );

            if (activeTicketRef.current === fetchingTicket) {
                setMessages(previous => mergeChatMessages(previous, combined));
            }
        } catch (err) {
            console.error("Error fetching messages:", err);
        } finally {
            if (activeTicketRef.current === fetchingTicket) setLoading(false);
            setTimeout(() => scrollToBottom(false), 50);
        }
    };

    // ─── Realtime Subscription ───────────────────────────────────────────
    useEffect(() => {
        if (!ticketId || !user?.id) return;
        activeTicketRef.current = ticketId;
        setMessages([]);
        setLoading(true);
        setConnectionStatus('Connecting');
        fetchMessages();

        const channel = supabase.channel(`ticket_chat_${ticketId}`);
        channelRef.current = channel;

        // Subscribe to changes
        channel
            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'ticket_messages',
                    filter: `ticket_id=eq.${ticketId}`
                },
                (payload) => {
                    if (activeTicketRef.current !== ticketId) return;
                    const newMessage = payload.new;
                    setMessages((prev) => {
                        // Avoid duplicates if we already added it locally
                        if (prev.find(m => m.id === newMessage.id)) return prev;
                        // Remove optimistic duplicates based on content and time
                        const filtered = prev.filter(m => !(String(m.id).startsWith('temp-') && m.message === newMessage.message && m.sender_id === newMessage.sender_id));
                        return [...filtered, newMessage];
                    });

                    // Handle notification logic
                    if (newMessage.sender_id !== user?.id) {
                        if (!isAtBottom) {
                            setUnreadCount(prev => prev + 1);
                        } else {
                            setTimeout(() => scrollToBottom(), 50);
                        }
                    }
                }
            )
            .on(
                'broadcast',
                { event: 'typing' },
                (payload) => {
                    if (payload.payload.user_id !== user?.id) {
                        setIsTyping(true);
                        clearTimeout(typingTimerRef.current);
                        typingTimerRef.current = setTimeout(() => {
                            setIsTyping(false);
                        }, 3000);
                        setTimeout(() => scrollToBottom(), 50);
                    }
                }
            )
            .subscribe(status => {
                if (activeTicketRef.current !== ticketId) return;
                setConnectionStatus(status === 'SUBSCRIBED' ? 'Live' : 'Reconnecting');
                if (status === 'SUBSCRIBED') fetchMessages();
            });

        // The SDK reconnects its WebSocket; durable reads recover missed events.
        const recover = () => { if (document.visibilityState !== 'hidden') fetchMessages(); };
        const recoveryTimer = setInterval(recover, 30000);
        window.addEventListener('online', recover);
        document.addEventListener('visibilitychange', recover);

        return () => {
            activeTicketRef.current = null;
            clearInterval(recoveryTimer);
            clearTimeout(typingTimerRef.current);
            window.removeEventListener('online', recover);
            document.removeEventListener('visibilitychange', recover);
            channelRef.current = null;
            supabase.removeChannel(channel);
        };
     
 
    }, [ticketId, user?.id, profile?.role]);

    const handleInputChange = (e) => {
        setInputValue(e.target.value);
        if (channelRef.current && e.target.value.trim().length > 0) {
            channelRef.current.send({
                type: 'broadcast',
                event: 'typing',
                payload: { user_id: user?.id }
            }).catch(() => { });
        }
    };

    // ─── Auto-scroll ─────────────────────────────────────────────────────
    const scrollToBottom = useCallback((smooth = true) => {
        if (scrollContainerRef.current) {
            scrollContainerRef.current.scrollTo({
                top: scrollContainerRef.current.scrollHeight,
                behavior: smooth ? 'smooth' : 'instant'
            });
        }
    }, []);

    const handleScroll = () => {
        const el = scrollContainerRef.current;
        if (!el) return;
        const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        setIsAtBottom(atBottom);
        if (atBottom) setUnreadCount(0);
    };

    // ─── Send message ────────────────────────────────────────────────────
    const handleSend = async (e) => {
        e.preventDefault();
        if (!inputValue.trim() || !user || sendingRef.current) return;
        sendingRef.current = true;
        setSendError('');

        const content = inputValue.trim();
        const currentIsInternal = isInternal;

        // Optimistic UI update
        const tempMessage = {
            id: `temp-${Date.now()}`,
            ticket_id: ticketId,
            sender_id: user.id,
            sender_name: profile?.full_name || user.email,
            sender_role: profile?.role || 'user',
            message: content,
            is_internal: currentIsInternal,
            created_at: new Date().toISOString()
        };

        setMessages(prev => [...prev, tempMessage]);
        setInputValue('');
        setTimeout(() => scrollToBottom(), 50);

        try {
            if (currentIsInternal) {
                const { data, error } = await supabase
                    .from('internal_notes')
                    .insert([{
                        ticket_id: ticketId,
                        agent_id: user.id,
                        content: content
                    }]).select().single();
                if (error) throw error;
                if (data && activeTicketRef.current === ticketId) {
                    const saved = currentIsInternal ? { ...data, message: data.content, is_internal: true, sender_name: profile?.full_name || 'Agent', sender_role: 'admin' } : data;
                    setMessages(previous => mergeChatMessages(previous.filter(message => message.id !== tempMessage.id), [saved]));
                }
            } else {
                const { data, error } = await supabase
                    .from('ticket_messages')
                    .insert([{
                        ticket_id: ticketId,
                        sender_id: user.id,
                        sender_name: profile?.full_name || user.email,
                        sender_role: profile?.role || 'user',
                        message: content
                    }]).select().single();
                if (error) throw error;
                if (data && activeTicketRef.current === ticketId) {
                    const saved = currentIsInternal ? { ...data, message: data.content, is_internal: true, sender_name: profile?.full_name || 'Agent', sender_role: 'admin' } : data;
                    setMessages(previous => mergeChatMessages(previous.filter(message => message.id !== tempMessage.id), [saved]));
                }
            }
        } catch (err) {
            console.error("Error sending message:", err);
            setMessages(prev => prev.filter(m => m.id !== tempMessage.id));
            setInputValue(previous => previous || content);
            setSendError('Message was not sent. Your draft has been restored; please retry.');
        } finally {
            sendingRef.current = false;
        }
    };

    // ─── Helpers ─────────────────────────────────────────────────────────
    const formatTime = (iso) => {
        try {
            return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } catch { return ''; }
    };

    const formatDate = (iso) => {
        try {
            const d = new Date(iso);
            const today = new Date();
            if (d.toDateString() === today.toDateString()) return 'Today';
            const yesterday = new Date(today);
            yesterday.setDate(today.getDate() - 1);
            if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
            return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
        } catch { return ''; }
    };

    const grouped = [];
    let lastDate = null;
    messages.forEach((msg) => {
        const date = formatDate(msg.created_at);
        if (date !== lastDate) {
            grouped.push({ type: 'divider', label: date });
            lastDate = date;
        }
        grouped.push({ type: 'message', data: msg });
    });

    return (
        <div style={{ background: '#ffffff', borderRadius: '20px', border: '1px solid #f0fdf4', height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {/* Header */}
            <div style={{ padding: '12px 20px', borderBottom: '1px solid #f0fdf4', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <h2 style={{ fontSize: '11px', color: '#9ca3af', letterSpacing: '0.1em', fontWeight: 600, textTransform: 'uppercase', margin: 0 }}>
                        SUPPORT CHAT
                    </h2>
                </div>

                <div className="flex items-center gap-4">
                    {isStaff && (
                        <div style={{ display: 'flex', alignItems: 'center', background: 'transparent', gap: '4px' }}>
                            <button
                                onClick={() => setIsInternal(false)}
                                style={{ padding: '4px 12px', fontSize: '10px', fontWeight: 700, borderRadius: '8px', cursor: 'pointer', border: 'none', transition: 'all 0.2s', ...( !isInternal ? { background: '#0f1f12', color: '#ffffff' } : { background: 'transparent', color: '#6b7280' } ) }}
                            >
                                PUBLIC
                            </button>
                            <button
                                onClick={() => setIsInternal(true)}
                                style={{ padding: '4px 12px', fontSize: '10px', fontWeight: 700, borderRadius: '8px', cursor: 'pointer', border: 'none', transition: 'all 0.2s', ...( isInternal ? { background: '#0f1f12', color: '#ffffff' } : { background: 'transparent', color: '#6b7280' } ) }}
                            >
                                INTERNAL
                            </button>
                        </div>
                    )}
                </div>
            </div>

            <p role="status" aria-live="polite" style={{ padding: '0 20px', fontSize: '12px' }}>{connectionStatus}</p>
            {sendError && <p role="alert" style={{ padding: '0 20px' }}>{sendError}</p>}
            {/* Messages */}
            <div
                ref={scrollContainerRef}
                onScroll={handleScroll}
                className="flex-1 overflow-y-auto px-5 py-4 space-y-1 bg-white"
            >
                {loading ? (
                    <div className="h-full flex flex-col items-center justify-center">
                        <Loader2 className="w-6 h-6 text-emerald-500 animate-spin" />
                    </div>
                ) : grouped.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-center py-16">
                        <Bot className="w-10 h-10 text-slate-200 mb-3" />
                        <p className="text-sm font-medium text-slate-400 italic">No messages yet.</p>
                    </div>
                ) : (
                    grouped.map((item, i) => {
                        if (item.type === 'divider') {
                            return (
                                <div key={`div-${i}`} className="flex items-center gap-3 py-2">
                                    <div className="flex-1 h-px bg-slate-100" />
                                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{item.label}</span>
                                    <div className="flex-1 h-px bg-slate-100" />
                                </div>
                            );
                        }

                        const msg = item.data;
                        const isMe = msg.sender_id === user?.id;
                        const isAdmin = msg.sender_role === 'admin' || msg.sender_role === 'super_admin';

                        return (
                            <div key={msg.id || i} className={`flex gap-2.5 ${isMe ? 'justify-end' : 'justify-start'} group py-1`}>
                                {!isMe && (
                                    <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-auto mb-1 shadow-sm
                                        ${isAdmin ? 'bg-indigo-600' : 'bg-slate-200 border border-slate-300'}`}>
                                        {isAdmin ? <ShieldCheck size={13} className="text-white" /> : <User size={13} className="text-slate-500" />}
                                    </div>
                                )}

                                <div className={`max-w-[80%] flex flex-col gap-1 ${isMe ? 'items-end' : 'items-start'}`}>
                                    <div className={`flex items-center gap-2 px-1`}>
                                        <span className={`text-[9px] font-black uppercase tracking-widest ${msg.is_internal ? 'text-amber-600' : 'text-slate-400'}`}>
                                            {msg.is_internal ? '🔒 Internal Note' : (isMe ? 'You' : msg.sender_name || (isAdmin ? 'Support ' : 'User'))}
                                        </span>
                                        <span className="text-[8px] font-bold text-slate-300">
                                            {formatTime(msg.created_at)}
                                        </span>
                                    </div>

                                    <div style={{
                                        padding: '14px 18px', fontSize: '13px', lineHeight: 1.5,
                                        ...(!isMe && !msg.is_internal ? {
                                            background: '#f0fdf4', color: '#0f1f12', borderRadius: '14px', border: '1px solid #d1fae5'
                                        } : msg.is_internal ? {
                                            background: '#fef3c7', color: '#92400e', borderRadius: '14px', border: '1px solid #fde68a'
                                        } : {
                                            background: '#0f1f12', color: '#ffffff', borderRadius: '14px'
                                        })
                                    }}>
                                        {msg.message}
                                    </div>
                                </div>

                                {isMe && (
                                    <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-auto mb-1 shadow-sm
                                        ${isAdmin ? 'bg-indigo-600' : 'bg-emerald-100 border border-emerald-200'}`}>
                                        {isAdmin ? <ShieldCheck size={13} className="text-white" /> : <User size={13} className="text-emerald-700" />}
                                    </div>
                                )}
                            </div>
                        );
                    })
                )}
                {isTyping && (
                    <div className="flex items-center gap-2 text-slate-400 text-[10px] font-black uppercase tracking-widest italic py-1 px-2 animate-pulse">
                        <Loader2 className="w-3 h-3 animate-spin" /> Someone is typing...
                    </div>
                )}
                <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div style={{ padding: '16px 20px', borderTop: '1px solid #f0fdf4', background: '#ffffff' }}>
                <form onSubmit={handleSend} className="flex gap-3">
                    <input
                        ref={inputRef}
                        type="text"
                        value={inputValue}
                        onChange={handleInputChange}
                        placeholder="Type your message..."
                        style={{ flex: 1, background: '#f9fafb', border: '1.5px solid #e5e7eb', borderRadius: '12px', padding: '10px 16px', fontSize: '13px', outline: 'none' }}
                        className="focus:border-emerald-500 transition-colors"
                    />
                    <button
                        type="submit"
                        disabled={!inputValue.trim() || !user}
                        style={{ padding: '10px 20px', background: '#16a34a', color: '#ffffff', borderRadius: '10px', fontWeight: 600, fontSize: '12px', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}
                        className="active:scale-95 transition-transform disabled:opacity-50"
                    >
                        {isInternal ? <ShieldCheck size={14} /> : <Send size={14} />}
                        <span className="hidden sm:inline">{isInternal ? 'Note' : 'Send'}</span>
                    </button>
                </form>
            </div>
        </div>
    );
};

export default TicketChat;
