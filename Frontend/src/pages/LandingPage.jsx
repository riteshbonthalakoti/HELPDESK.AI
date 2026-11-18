import React, { useRef, useEffect, useState } from 'react';
 
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import {
    Menu, X, Check, Activity,
    MapPin, AlertCircle, Folder, Zap, Bot, ArrowRight,
    Clock, CheckCircle,
    Star, Twitter, Linkedin, Github, Globe, MessageSquare,
    Mail, Search, Bell, Play, ChevronRight,
    Shield, Lock, Network, HardDrive, Cpu, Copy,
    Users, BarChart3, Inbox, Building2, BrainCircuit
} from 'lucide-react';
import useAuthStore from '../store/authStore';
import TeamSection from '../components/landing/TeamSection';

// ---- Count-up animation component ----
function AnimatedStat({ target, suffix = '', prefix = '', label, isWord = false }) {
    const [display, setDisplay] = useState(isWord ? target : '0');
    const [triggered, setTriggered] = useState(false);
    const ref = useRef(null);

    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const observer = new IntersectionObserver(
            ([entry]) => { if (entry.isIntersecting && !triggered) setTriggered(true); },
            { threshold: 0.5 }
        );
        observer.observe(el);
        return () => observer.disconnect();
    }, [triggered]);

    useEffect(() => {
        if (!triggered || isWord) return;
        const duration = 1500;
        const start = performance.now();
        const to = parseFloat(target);
        const step = (now) => {
            const progress = Math.min((now - start) / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 3);
            const current = Math.round((to) * eased);
            setDisplay(String(current));
            if (progress < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
    }, [triggered, target, isWord]);

    return (
        <div ref={ref} className="p-4">
            <div className="text-4xl font-extrabold mb-1 text-white tabular-nums">
                {prefix}{display}{suffix}
            </div>
            <div className="text-sm text-white font-medium tracking-wide opacity-75">{label}</div>
        </div>
    );
}

// ---- Demo Modal ----
function DemoModal({ onClose }) {
    const [isPlaying, setIsPlaying] = useState(false);
    const videoId = "Bj00LzeMylM";

    return (
        <div className="fixed inset-0 z-[999] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/80 backdrop-blur-md" onClick={onClose} />
            <div
                className="relative bg-gray-950 rounded-3xl border border-white/10 shadow-2xl w-full max-w-4xl overflow-hidden z-10 animate-in fade-in zoom-in duration-300"
                onClick={e => e.stopPropagation()}
            >
                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 text-gray-400 hover:text-white bg-white/10 rounded-full p-2 transition-colors z-30"
                >
                    <X className="w-5 h-5" />
                </button>

                {/* Video Container */}
                <div className="aspect-video w-full bg-black flex items-center justify-center relative group">
                    {!isPlaying ? (
                        <div
                            className="absolute inset-0 cursor-pointer overflow-hidden"
                            onClick={() => setIsPlaying(true)}
                        >
                            {/* YouTube Thumbnail Poster */}
                            <img
                                src={`https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`}
                                alt="Video Thumbnail"
                                className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                            />
                            {/* Overlay Gradient */}
                            <div className="absolute inset-0 bg-black/20 group-hover:bg-black/40 transition-colors duration-300" />

                            {/* Play Button Overlay */}
                            <div className="absolute inset-0 flex items-center justify-center">
                                <div className="w-20 h-20 bg-emerald-600 rounded-full flex items-center justify-center shadow-2xl shadow-emerald-600/50 transform group-hover:scale-110 transition-transform duration-300">
                                    <Play className="w-8 h-8 text-white fill-white ml-1" />
                                </div>
                            </div>

                            {/* Badge */}
                            <div className="absolute bottom-6 left-6 flex items-center gap-2 bg-black/60 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/10">
                                <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                                <span className="text-[10px] font-black text-white uppercase tracking-widest">Click to Watch</span>
                            </div>
                        </div>
                    ) : (
                        <iframe
                            className="w-full h-full"
                            src={`https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0&modestbranding=1`}
                            title="HelpDesk.ai Platform Demo"
                            frameBorder="0"
                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                            allowFullScreen
                        ></iframe>
                    )}
                </div>

                <div className="p-6 bg-gray-900 border-t border-white/5 flex flex-col md:flex-row items-center justify-between gap-4">
                    <div>
                        <h2 className="text-xl font-extrabold text-white italic uppercase tracking-tight">Full Platform Walkthrough</h2>
                        <p className="text-gray-400 text-xs font-medium">Experience the synergy of AI and human expertise.</p>
                    </div>
                    <div className="flex gap-3 w-full md:w-auto">
                        <button
                            onClick={() => { onClose(); window.location.href = '/admin-signup'; }}
                            className="flex-1 md:px-8 bg-emerald-600 hover:bg-emerald-500 text-white py-3 rounded-xl font-black italic uppercase tracking-wider transition-all flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20"
                        >
                            Start Free <ArrowRight className="w-4 h-4 ml-1" />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}


export default function LandingPage() {
    const navigate = useNavigate();
    const { user, profile, loading } = useAuthStore();
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [showDemo, setShowDemo] = useState(false);
    const [billingAnnual, setBillingAnnual] = useState(false);
    const [activeStep, setActiveStep] = useState(0);
    const [isRedirecting, setIsRedirecting] = useState(false);

    const steps = [
        {
            num: '01',
            title: 'Messy User Input',
            label: 'The Problem',
            desc: 'Users describe issues in natural language, often lacking critical details or context.',
            color: 'blue',
            icon: MessageSquare,
            visual: (
                <div className="space-y-4">
                    <div className="bg-white/5 border border-white/10 rounded-2xl p-4 max-w-[100%] float-left animate-in slide-in-from-left duration-500">
                        <p className="text-sm text-blue-200 italic font-medium">"Hey support, the wifi in downstream lab 3 is acting up again. Can't connect. Need fixed ASAP!"</p>
                    </div>
                </div>
            )
        },
        {
            num: '02',
            title: 'AI Analysis',
            label: 'The Brain',
            desc: 'AI parses intent, extracts entities (Lab 3), and detects urgency (ASAP) in milliseconds.',
            color: 'emerald',
            icon: Bot,
            visual: (
                <div className="relative flex flex-col items-center justify-center h-full gap-4">
                    <div className="w-24 h-24 bg-emerald-500/20 rounded-full border border-emerald-500/30 flex items-center justify-center animate-pulse">
                        <Zap className="w-10 h-10 text-emerald-400" />
                    </div>
                    <div className="grid grid-cols-2 gap-2 w-full">
                        <div className="bg-emerald-500/10 border border-emerald-500/20 p-2 rounded text-[10px] text-emerald-300 font-bold uppercase tracking-widest text-center">Category: Network</div>
                        <div className="bg-emerald-500/10 border border-emerald-500/20 p-2 rounded text-[10px] text-emerald-300 font-bold uppercase tracking-widest text-center">Priority: High</div>
                    </div>
                </div>
            )
        },
        {
            num: '03',
            title: 'Smart Resolution',
            label: 'The Solution',
            desc: 'AI either resolves the ticket using history or routes it with full context to the right human team.',
            color: 'purple',
            icon: CheckCircle,
            visual: (
                <div className="space-y-4">
                    <div className="bg-white rounded-2xl shadow-xl overflow-hidden border border-emerald-100">
                        <div className="bg-emerald-500 px-4 py-2 flex justify-between items-center">
                            <span className="text-[10px] font-black text-white uppercase tracking-widest">Ticket #4029</span>
                            <span className="text-[10px] font-bold text-white/80">RESOLVED</span>
                        </div>
                        <div className="p-4">
                            <div className="flex items-center gap-2 mb-2">
                                <div className="w-6 h-6 bg-emerald-100 rounded-full flex items-center justify-center">
                                    <Bot className="w-3.5 h-3.5 text-emerald-600" />
                                </div>
                                <span className="text-xs font-bold text-gray-800 italic">HelpDesk AI Assistant</span>
                            </div>
                            <p className="text-[11px] text-gray-600 leading-tight">"Remotely reset the Lab 3 router. Connectivity restored. Total downtime: 143ms."</p>
                        </div>
                    </div>
                    <div className="text-center text-xs text-white/40 font-medium">Auto-closed in 2 seconds</div>
                </div>
            )
        }
    ];

    useEffect(() => {
        if (!loading && user && profile) {
            if (profile.role === 'master_admin') navigate('/master-admin/dashboard');
            else if (profile.role === 'admin') navigate('/admin/dashboard');
            else navigate('/dashboard');
        }
    }, [user, profile, loading, navigate]);

    const pricingPlans = [
        {
            name: 'Starter',
            price: 0,
            period: '/mo',
            desc: 'Perfect for small teams exploring AI helpdesk.',
            cta: 'Get Started Free',
            ctaStyle: 'border border-gray-200 text-gray-700 hover:border-emerald-900 hover:text-emerald-800',
            features: ['Up to 50 tickets/mo', 'Basic AI Categorization', 'Email Support', '1 Team Member', 'Public API Access'],
            popular: false,
        },
        {
            name: 'Growth',
            price: billingAnnual ? 3199 : 3999,
            period: '/mo',
            desc: 'For growing IT teams needing full automation.',
            cta: 'Start Free Trial',
            ctaStyle: 'bg-emerald-900 text-white hover:bg-emerald-800 shadow-lg shadow-emerald-900/20',
            features: ['Up to 500 tickets/mo', 'Advanced AI Parsing', 'Priority Detection Engine', 'Duplicate Detection', '5 Team Members', 'Priority Email Support'],
            popular: true,
        },
        {
            name: 'Enterprise',
            priceLabel: 'Custom',
            period: '',
            desc: 'For large organizations with complex IT landscapes.',
            cta: 'Contact Sales',
            ctaStyle: 'border border-gray-200 text-gray-700 hover:border-emerald-900 hover:text-emerald-800',
            features: ['Unlimited tickets', 'Custom AI Fine-Tuning', 'SSO & Audit Logs', 'Dedicated SLA Manager', 'Unlimited Members', 'VAPT & Compliance Reports'],
            popular: false,
        },
    ];

    const handlePricingClick = (planName) => {
        if (planName === 'Growth') {
            setIsRedirecting(true);
            // Redirect to Stripe Payment Link
            const stripeUrl = import.meta.env.VITE_STRIPE_GROWTH_LINK;
            if (stripeUrl) {
                window.location.href = stripeUrl;
            } else {
                console.warn("Stripe link not configured in .env");
                setTimeout(() => {
                    setIsRedirecting(false);
                    navigate('/admin-signup');
                }, 1000);
            }
        } else if (planName === 'Enterprise') {
            navigate('/contact-sales');
        } else {
            navigate('/admin-signup');
        }
    };

    return (
        <div className="min-h-screen bg-white font-sans text-slate-800">
            {showDemo && <DemoModal onClose={() => setShowDemo(false)} />}

            {/* ==================== NAV ==================== */}
            <nav className="sticky top-0 z-50 bg-white/90 backdrop-blur-md border-b border-gray-100 shadow-sm">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex justify-between items-center h-16">
                        {/* Logo */}
                        <div className="flex items-center gap-2 cursor-pointer" onClick={() => navigate('/')}>
                            <img src="/favicon.png" alt="H" className="w-8 h-8 object-contain" />
                            <span className="font-black text-2xl tracking-tighter text-emerald-900 italic uppercase">HelpDesk.ai</span>
                        </div>

                        {/* Desktop Links */}
                        <div className="hidden md:flex items-center gap-8">
                            <a href="#features" className="text-sm font-semibold text-gray-600 hover:text-emerald-800 transition-colors">Features</a>
                            <a href="#how-it-works" className="text-sm font-semibold text-gray-600 hover:text-emerald-800 transition-colors">How It Works</a>
                            <a href="#pricing" className="text-sm font-semibold text-gray-600 hover:text-emerald-800 transition-colors">Pricing</a>
                        </div>

                        {/* CTA Buttons */}
                        <div className="hidden md:flex items-center gap-3">
                            <button
                                onClick={() => navigate('/login')}
                                className="text-sm font-semibold text-gray-700 hover:text-emerald-800 transition-colors px-4 py-2 rounded-lg hover:bg-gray-50"
                            >
                                Sign In
                            </button>
                            <button
                                onClick={() => setShowDemo(true)}
                                className="text-sm font-semibold text-emerald-800 border border-emerald-200 px-4 py-2 rounded-lg hover:bg-emerald-50 transition-all flex items-center gap-1.5"
                            >
                                <Play className="w-3.5 h-3.5 fill-emerald-700" /> Watch Demo
                            </button>
                            <button
                                onClick={() => navigate('/admin-signup')}
                                className="bg-emerald-900 hover:bg-emerald-800 text-white px-5 py-2.5 rounded-lg text-sm font-semibold transition-all shadow-lg shadow-emerald-900/20"
                            >
                                Get Started Free
                            </button>
                        </div>

                        {/* Mobile Menu Button */}
                        <div className="md:hidden">
                            <button onClick={() => setIsMenuOpen(!isMenuOpen)} className="text-gray-600 hover:text-emerald-800 p-2">
                                {isMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
                            </button>
                        </div>
                    </div>
                </div>

                {/* Mobile Menu */}
                {isMenuOpen && (
                    <div className="md:hidden bg-white border-t border-gray-100 absolute w-full shadow-xl z-50">
                        <div className="px-5 pt-3 pb-6 space-y-4">
                            <a href="#features" onClick={() => setIsMenuOpen(false)} className="block text-base font-semibold text-gray-700 hover:text-emerald-800 py-2">Features</a>
                            <a href="#how-it-works" onClick={() => setIsMenuOpen(false)} className="block text-base font-semibold text-gray-700 hover:text-emerald-800 py-2">How It Works</a>
                            <a href="#pricing" onClick={() => setIsMenuOpen(false)} className="block text-base font-semibold text-gray-700 hover:text-emerald-800 py-2">Pricing</a>
                            <div className="pt-4 flex flex-col gap-3 border-t border-gray-100">
                                <button onClick={() => { setIsMenuOpen(false); setShowDemo(true); }} className="w-full text-center py-2.5 text-emerald-800 font-semibold border border-emerald-200 rounded-lg flex items-center justify-center gap-2">
                                    <Play className="w-4 h-4 fill-emerald-700" /> Watch Demo
                                </button>
                                <button onClick={() => navigate('/login')} className="w-full text-center py-2.5 text-gray-700 font-semibold border border-gray-100 rounded-lg">
                                    Sign In
                                </button>
                                <button onClick={() => navigate('/admin-signup')} className="w-full bg-emerald-900 text-white py-3 rounded-lg font-semibold shadow">
                                    Get Started Free
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </nav>

            {/* ==================== HERO ==================== */}
            <section className="relative pt-8 sm:pt-14 md:pt-20 pb-14 sm:pb-20 md:pb-32 overflow-hidden">
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-[300px] md:h-[600px] bg-gradient-to-b from-green-50/80 to-transparent pointer-events-none -z-10" />

                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center relative z-10">
                    <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-50 border border-emerald-100 text-emerald-700 text-[11px] sm:text-xs font-bold uppercase tracking-wider mb-5 sm:mb-8">
                        <Activity className="w-3 h-3 shrink-0" />
                        <span>AI-Powered Helpdesk · Made in India 🇮🇳</span>
                    </div>

                    <h1 className="text-[34px] sm:text-5xl md:text-7xl font-extrabold text-gray-900 tracking-tight mb-4 sm:mb-6 leading-[1.08]">
                        Your IT Helpdesk,<br />
                        <span className="text-emerald-700">Fully Automated.</span>
                    </h1>

                    <p className="max-w-2xl mx-auto text-base sm:text-lg md:text-xl text-gray-500 mb-7 sm:mb-10 leading-relaxed px-1">
                        Turn messy user complaints into structured, categorized, and prioritized support tickets — instantly. No manual triage. No missed urgencies.
                    </p>

                    <div className="flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4 mb-10 sm:mb-12">
                        <button
                            onClick={() => navigate('/admin-signup')}
                            className="w-full sm:w-auto px-8 py-4 bg-emerald-900 text-white rounded-xl font-bold shadow-xl shadow-emerald-900/25 hover:bg-emerald-800 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-2 text-base"
                        >
                            Get Started Free <ArrowRight className="w-5 h-5" />
                        </button>
                        <button
                            onClick={() => setShowDemo(true)}
                            className="w-full sm:w-auto px-8 py-4 bg-white text-gray-700 border border-gray-200 rounded-xl font-semibold hover:border-emerald-500 hover:text-emerald-700 transition-all flex items-center justify-center gap-2 text-base"
                        >
                            <Play className="w-4 h-4 fill-gray-500" /> Watch a Demo
                        </button>
                    </div>

            
                    {/* BENTO VISUAL */}
                    <div className="relative max-w-6xl mx-auto">
                        <div className="absolute inset-0 bg-gradient-to-r from-emerald-100 via-teal-50 to-emerald-50 blur-3xl opacity-60 -z-10 rounded-full" />
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 md:gap-12 items-center">
                            {/* LEFT: Email */}
                            <div className="relative group perspective-1000">
                                <div className="absolute -inset-1 bg-gradient-to-r from-gray-200 to-gray-100 rounded-2xl blur opacity-75 group-hover:opacity-100 transition duration-1000" />
                                <div className="relative bg-white rounded-2xl shadow-xl border border-gray-200/60 overflow-hidden transform transition-transform group-hover:scale-[1.01]">
                                    <div className="bg-gray-50 border-b border-gray-200 px-4 py-3 flex items-center justify-between">
                                        <div className="flex gap-1.5">
                                            <div className="w-3 h-3 rounded-full bg-red-400" />
                                            <div className="w-3 h-3 rounded-full bg-yellow-400" />
                                            <div className="w-3 h-3 rounded-full bg-green-400" />
                                        </div>
                                        <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1">
                                            <Mail className="w-3 h-3" /> Incoming Request
                                        </div>
                                    </div>
                                    <div className="p-6">
                                        <div className="flex items-center justify-between mb-6">
                                            <div className="flex items-center gap-3">
                                                <div className="w-10 h-10 rounded-full bg-purple-100 text-purple-600 flex items-center justify-center font-bold text-sm">SC</div>
                                                <div>
                                                    <div className="font-semibold text-gray-900 text-sm">Sarah Connors</div>
                                                    <div className="text-xs text-gray-500">sarah@university.edu</div>
                                                </div>
                                            </div>
                                            <div className="text-xs text-gray-400">2 mins ago</div>
                                        </div>
                                        <div className="mb-4">
                                            <h3 className="text-sm font-bold text-gray-800 mb-1">Subject: Wifi down again in Lab 3??</h3>
                                            <p className="text-sm text-gray-600 leading-relaxed">
                                                Hey support, the wifi in <span className="bg-yellow-100 px-1 rounded">downstairs lab 3</span> is acting up again.
                                                Can't connect at all. Class starts in 20 mins, need this fixed ASAP!<br /><br />
                                                Thanks,<br />Sarah
                                            </p>
                                        </div>
                                    </div>
                                </div>
                                <div className="hidden md:flex absolute -right-8 top-1/2 -translate-y-1/2 z-20 text-emerald-300">
                                    <ArrowRight className="w-8 h-8 animate-pulse" />
                                </div>
                            </div>

                            {/* RIGHT: Processed Ticket */}
                            <div className="relative group">
                                <div className="absolute -inset-1 bg-gradient-to-r from-emerald-400 to-teal-400 rounded-2xl blur opacity-20 group-hover:opacity-40 transition duration-1000" />
                                <div className="relative bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden transform transition-all group-hover:-translate-y-1">
                                    <div className="bg-white border-b border-gray-100 px-5 py-3 flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <span className="font-mono text-xs font-bold text-gray-500">#T-4029</span>
                                            <span className="bg-green-100 text-green-700 text-[10px] font-bold px-2 py-0.5 rounded-full border border-green-200 uppercase tracking-wide">AI Processed</span>
                                        </div>
                                        <div className="flex gap-2 text-gray-400">
                                            <Search className="w-4 h-4" />
                                            <Bell className="w-4 h-4" />
                                            <div className="w-5 h-5 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-700 font-bold text-[10px]">AI</div>
                                        </div>
                                    </div>
                                    <div className="p-6 space-y-5">
                                        <div className="flex justify-between items-start">
                                            <div>
                                                <h3 className="font-bold text-gray-800 text-lg mb-1">WiFi Connectivity Issue</h3>
                                                <div className="flex items-center gap-2 text-xs text-gray-500">
                                                    <Clock className="w-3 h-3" /> Created 1m ago
                                                    <span>•</span> via Email
                                                </div>
                                            </div>
                                            <button className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition-colors shadow-sm shadow-emerald-200">
                                                Resolve
                                            </button>
                                        </div>
                                        <div className="grid grid-cols-2 gap-3">
                                            <div className="bg-gray-50 p-3 rounded-lg border border-gray-100">
                                                <div className="text-[10px] uppercase font-bold text-gray-400 mb-1 flex items-center gap-1">
                                                    <AlertCircle className="w-3 h-3" /> Priority
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                                                    <span className="text-sm font-bold text-gray-800">High</span>
                                                </div>
                                            </div>
                                            <div className="bg-gray-50 p-3 rounded-lg border border-gray-100">
                                                <div className="text-[10px] uppercase font-bold text-gray-400 mb-1 flex items-center gap-1">
                                                    <Folder className="w-3 h-3" /> Category
                                                </div>
                                                <div className="flex items-center gap-1">
                                                    <span className="text-sm font-bold text-gray-800">Network</span>
                                                </div>
                                            </div>
                                            <div className="bg-gray-50 p-3 rounded-lg border border-gray-100 col-span-2">
                                                <div className="text-[10px] uppercase font-bold text-gray-400 mb-1 flex items-center gap-1">
                                                    <MapPin className="w-3 h-3" /> Location
                                                </div>
                                                <div className="text-sm font-bold text-gray-800">Lab 3 (Downstairs)</div>
                                            </div>
                                        </div>
                                        <div className="border-t border-gray-100 pt-3 flex items-center justify-between">
                                            <div className="text-xs text-gray-500 flex items-center gap-1">
                                                Assigned to <span className="font-bold text-gray-700">NetOps Team</span>
                                            </div>
                                            <div className="flex -space-x-1">
                                                <div className="w-6 h-6 rounded-full bg-blue-100 border-2 border-white" />
                                                <div className="w-6 h-6 rounded-full bg-green-100 border-2 border-white flex items-center justify-center text-[8px] font-bold text-green-700">+3</div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* ==================== STATS BAR ==================== */}
            <section className="bg-emerald-900 py-12 text-white">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-8 text-center divide-y-2 sm:divide-y-0 sm:divide-x divide-white/10">
                        <AnimatedStat prefix="+" target="80" suffix="%" label="Faster Ticket Triage" />
                        <AnimatedStat target="99" suffix="%" label="Classification Accuracy" />
                        <AnimatedStat target="Zero" label="Manual Routing Needed" isWord={true} />
                        <AnimatedStat target="24" suffix="/7" label="AI Auto-Resolution" />
                    </div>
                </div>
            </section>

            {/* ==================== FEATURES GRID ==================== */}
            <section className="py-24 bg-white" id="features">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="text-center mb-16">
                        <span className="text-xs font-bold tracking-widest text-emerald-700 uppercase mb-3 block">Core Intelligence</span>
                        <h2 className="text-3xl md:text-5xl font-extrabold text-gray-900 tracking-tight">Work Smarter, Not Harder</h2>
                        <p className="text-gray-500 mt-4 text-lg max-w-xl mx-auto">Three AI capabilities that eliminate manual helpdesk work.</p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                        {/* Card 1: Auto-Categorization */}
                        <div className="group rounded-3xl bg-gray-50 border border-gray-100 overflow-hidden hover:shadow-xl hover:shadow-gray-200/50 transition-all duration-300 hover:-translate-y-1">
                            <div className="h-52 bg-gradient-to-br from-blue-50 to-gray-50 p-6 flex items-center justify-center relative overflow-hidden">
                                <div className="relative z-10 flex flex-col gap-3 items-center">
                                    <div className="bg-white px-4 py-2 rounded-lg shadow-sm border border-gray-200 text-xs font-bold text-gray-400 flex items-center gap-2 transform -translate-x-4 opacity-60">
                                        <div className="w-2 h-2 rounded-full bg-gray-300" /> Ticket #1024
                                    </div>
                                    <div className="bg-white px-5 py-3 rounded-xl shadow-lg border border-blue-100 flex items-center gap-3 transform scale-110">
                                        <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
                                            <Folder className="w-4 h-4 text-blue-600" />
                                        </div>
                                        <div>
                                            <div className="h-2 w-16 bg-gray-200 rounded mb-1.5" />
                                            <span className="bg-blue-50 text-blue-700 text-[10px] font-bold px-2 py-0.5 rounded border border-blue-100">Network</span>
                                        </div>
                                    </div>
                                    <div className="bg-white px-4 py-2 rounded-lg shadow-sm border border-gray-200 text-xs font-bold text-gray-400 flex items-center gap-2 transform translate-x-6 opacity-60">
                                        <div className="w-2 h-2 rounded-full bg-gray-300" /> Ticket #1025
                                    </div>
                                </div>
                            </div>
                            <div className="p-8">
                                <h3 className="text-xl font-bold text-gray-900 mb-3">Auto-Categorization</h3>
                                <p className="text-gray-500 leading-relaxed mb-6">
                                    Instantly detects if an issue is Network, Hardware, Software, or Access-related — no manual tagging.
                                </p>
                                <button
                                    onClick={() => navigate('/features/categorization')}
                                    className="inline-flex items-center text-sm font-semibold text-emerald-900 hover:text-emerald-700 gap-1 group-hover:gap-2 transition-all"
                                >
                                    Explore <ChevronRight className="w-4 h-4" />
                                </button>
                            </div>
                        </div>

                        {/* Card 2: Priority Detection */}
                        <div className="group rounded-3xl bg-gray-50 border border-gray-100 overflow-hidden hover:shadow-xl hover:shadow-gray-200/50 transition-all duration-300 hover:-translate-y-1">
                            <div className="h-52 bg-gradient-to-br from-red-50 to-orange-50 p-6 flex items-center justify-center relative overflow-hidden">
                                <div className="relative z-10 w-full max-w-[200px] space-y-2.5">
                                    <div className="bg-white p-2.5 rounded-lg border border-gray-200 shadow-sm flex items-center justify-between opacity-50 scale-95">
                                        <div className="flex items-center gap-2">
                                            <div className="w-2 h-2 rounded-full bg-green-400" />
                                            <div className="h-1.5 w-12 bg-gray-200 rounded" />
                                        </div>
                                        <span className="text-[10px] font-bold text-gray-400">Low</span>
                                    </div>
                                    <div className="bg-white p-3 rounded-xl border border-red-100 shadow-md flex items-center justify-between ring-2 ring-red-50">
                                        <div className="flex items-center gap-3">
                                            <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                                            <div className="h-2 w-20 bg-gray-800 rounded" />
                                        </div>
                                        <span className="text-[10px] bg-red-50 text-red-600 font-bold px-1.5 py-0.5 rounded border border-red-100">CRITICAL</span>
                                    </div>
                                    <div className="bg-white p-2.5 rounded-lg border border-gray-200 shadow-sm flex items-center justify-between opacity-50 scale-95">
                                        <div className="flex items-center gap-2">
                                            <div className="w-2 h-2 rounded-full bg-yellow-400" />
                                            <div className="h-1.5 w-16 bg-gray-200 rounded" />
                                        </div>
                                        <span className="text-[10px] font-bold text-gray-400">Medium</span>
                                    </div>
                                </div>
                            </div>
                            <div className="p-8">
                                <h3 className="text-xl font-bold text-gray-900 mb-3">Priority Detection</h3>
                                <p className="text-gray-500 leading-relaxed mb-6">
                                    Understands urgency signals in text and automatically flags issues from Low to Critical.
                                </p>
                                <button
                                    onClick={() => navigate('/features/priority')}
                                    className="inline-flex items-center text-sm font-semibold text-emerald-900 hover:text-emerald-700 gap-1 group-hover:gap-2 transition-all"
                                >
                                    Explore <ChevronRight className="w-4 h-4" />
                                </button>
                            </div>
                        </div>

                        {/* Card 3: Smart Resolution */}
                        <div className="group rounded-3xl bg-gray-50 border border-gray-100 overflow-hidden hover:shadow-xl hover:shadow-gray-200/50 transition-all duration-300 hover:-translate-y-1">
                            <div className="h-52 bg-gradient-to-br from-emerald-50 to-teal-50 p-6 flex items-center justify-center relative overflow-hidden">
                                <div className="relative z-10 w-full max-w-[200px] flex flex-col gap-3">
                                    <div className="self-end bg-emerald-600 text-white p-2.5 rounded-2xl rounded-tr-none shadow-sm text-[10px] max-w-[80%]">
                                        Reset password for user@company.com?
                                    </div>
                                    <div className="self-start flex items-end gap-2">
                                        <div className="w-6 h-6 rounded-full bg-emerald-100 border border-white shadow-sm flex items-center justify-center">
                                            <Bot className="w-3 h-3 text-emerald-600" />
                                        </div>
                                        <div className="bg-white p-2.5 rounded-2xl rounded-tl-none border border-gray-200 shadow-sm text-[10px] text-gray-600">
                                            <div className="flex items-center gap-1.5 mb-1">
                                                <CheckCircle className="w-3 h-3 text-emerald-500" />
                                                <span className="font-bold text-gray-800">Done</span>
                                            </div>
                                            Reset link sent successfully.
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div className="p-8">
                                <h3 className="text-xl font-bold text-gray-900 mb-3">Smart Resolution</h3>
                                <p className="text-gray-500 leading-relaxed mb-6">
                                    Checks historical data to auto-fix simple issues, or routes complex ones to the right human team.
                                </p>
                                <button
                                    onClick={() => navigate('/features/resolution')}
                                    className="inline-flex items-center text-sm font-semibold text-emerald-900 hover:text-emerald-700 gap-1 group-hover:gap-2 transition-all"
                                >
                                    Explore <ChevronRight className="w-4 h-4" />
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* ==================== HOW IT WORKS ==================== */}
            <section className="bg-emerald-950 py-16 md:py-32 text-white relative overflow-hidden" id="how-it-works">
                {/* Background Decorations */}
                <div className="absolute top-0 right-0 w-96 h-96 bg-emerald-500/5 blur-[120px] rounded-full -translate-y-1/2 translate-x-1/2 pointer-events-none" />
                <div className="absolute bottom-0 left-0 w-96 h-96 bg-emerald-500/5 blur-[120px] rounded-full translate-y-1/2 -translate-x-1/2 pointer-events-none" />

                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
                    <div className="flex flex-col md:flex-row gap-8 md:gap-16 md:items-center">
                        {/* Left: Content */}
                        <div className="w-full md:w-1/2">
                            <div className="inline-flex items-center gap-2 px-3 py-1 bg-emerald-500/10 text-emerald-400 rounded-full text-[10px] md:text-xs font-bold uppercase tracking-widest border border-emerald-500/20 mb-4 md:mb-6">
                                The Journey
                            </div>
                            <h2 className="text-3xl sm:text-4xl md:text-6xl font-black text-white tracking-tight leading-[0.9] mb-8 md:mb-12 italic uppercase">
                                From Chaos <br />
                                to <span className="text-emerald-500">Clarity.</span>
                            </h2>

                            <div className="space-y-4">
                                {steps.map((step, idx) => (
                                    <div
                                        key={idx}
                                        onMouseEnter={() => setActiveStep(idx)}
                                        onClick={() => setActiveStep(idx)}
                                        className={`group cursor-pointer p-6 rounded-3xl transition-all duration-500 border ${activeStep === idx
                                            ? 'bg-white/10 border-white/20 shadow-2xl shadow-black/20'
                                            : 'bg-transparent border-transparent hover:bg-white/5 opacity-40 hover:opacity-100'
                                            }`}
                                    >
                                        <div className="flex items-start gap-4 md:gap-6">
                                            <div className={`shrink-0 w-10 md:w-12 h-10 md:h-12 rounded-xl md:rounded-2xl flex items-center justify-center font-black text-lg md:text-xl italic transition-all duration-500 ${activeStep === idx ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/20 rotate-12 scale-110' : 'bg-white/10 text-white/40'}`}>
                                                {step.num}
                                            </div>
                                            <div>
                                                <h3 className={`text-xl font-black italic uppercase transition-colors duration-500 ${activeStep === idx ? 'text-white' : 'text-white/60'}`}>
                                                    {step.title}
                                                </h3>
                                                {activeStep === idx && (
                                                    <motion.p
                                                        initial={{ opacity: 0, height: 0 }}
                                                        animate={{ opacity: 1, height: 'auto' }}
                                                        className="text-white/60 text-sm mt-3 leading-relaxed max-w-sm"
                                                    >
                                                        {step.desc}
                                                    </motion.p>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Right: Visual Display */}
                        <div className="w-full md:w-1/2 h-[350px] md:h-[500px] relative">
                            <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/10 to-transparent rounded-[32px] md:rounded-[40px] border border-white/5 backdrop-blur-3xl overflow-hidden p-6 md:p-12 flex items-center justify-center">
                                <AnimatePresence mode="wait">
                                    <motion.div
                                        key={activeStep}
                                        initial={{ opacity: 0, scale: 0.9, y: 20 }}
                                        animate={{ opacity: 1, scale: 1, y: 0 }}
                                        exit={{ opacity: 0, scale: 1.1, y: -20 }}
                                        transition={{ type: 'spring', damping: 20, stiffness: 100 }}
                                        className="w-full h-full flex flex-col items-center justify-center"
                                    >
                                        <div className="mb-6 inline-flex items-center gap-2 px-4 py-1.5 bg-white/5 text-white/50 rounded-full text-[10px] font-black uppercase tracking-[0.2em]">
                                            <div className={`w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse`} />
                                            {steps[activeStep].label}
                                        </div>
                                        <div className="w-full max-w-sm">
                                            {steps[activeStep].visual}
                                        </div>
                                    </motion.div>
                                </AnimatePresence>
                            </div>

                            {/* Decorative Floating Elements */}
                            <div className="absolute -top-6 -right-6 w-24 h-24 bg-emerald-500/10 rounded-full blur-2xl animate-pulse" />
                            <div className="absolute -bottom-10 -left-10 w-32 h-32 bg-emerald-500/10 rounded-full blur-3xl animate-pulse delay-700" />
                        </div>
                    </div>
                </div>
            </section>

            {/* ==================== PRICING ==================== */}
            <section className="py-24 bg-gray-50" id="pricing">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="text-center mb-12">
                        <h2 className="text-3xl md:text-4xl font-extrabold text-gray-900 mb-4">Simple, Transparent Pricing</h2>
                        <p className="text-gray-500 mb-8">All plans in Indian Rupees (₹) · GST applicable</p>

                        {/* Billing Toggle */}
                        <div className="inline-flex items-center gap-3 bg-white border border-gray-200 rounded-full px-2 py-2 shadow-sm">
                            <button
                                onClick={() => setBillingAnnual(false)}
                                className={`px-5 py-2 rounded-full text-sm font-semibold transition-all ${!billingAnnual ? 'bg-emerald-900 text-white shadow' : 'text-gray-500 hover:text-gray-700'}`}
                            >
                                Monthly
                            </button>
                            <button
                                onClick={() => setBillingAnnual(true)}
                                className={`px-5 py-2 rounded-full text-sm font-semibold transition-all flex items-center gap-2 ${billingAnnual ? 'bg-emerald-900 text-white shadow' : 'text-gray-500 hover:text-gray-700'}`}
                            >
                                Annual <span className="bg-emerald-100 text-emerald-700 text-[10px] font-bold px-1.5 py-0.5 rounded-full">Save 20%</span>
                            </button>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-6xl mx-auto">
                        {pricingPlans.map(({ name, price, priceLabel, period, desc, cta, ctaStyle, features, popular }) => (
                            <div
                                key={name}
                                className={`p-8 rounded-2xl bg-white transition-all relative ${popular ? 'border-2 border-emerald-900 shadow-2xl shadow-emerald-900/10 scale-[1.02]' : 'border border-gray-200 hover:border-gray-300'}`}
                            >
                                {popular && (
                                    <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-emerald-900 text-white px-4 py-1.5 rounded-full text-xs font-bold tracking-wide whitespace-nowrap shadow-lg">
                                        ⭐ MOST POPULAR
                                    </div>
                                )}
                                <h3 className="text-lg font-bold text-gray-900 mb-2">{name}</h3>
                                <div className="text-4xl font-extrabold text-gray-900 mb-2">
                                    {priceLabel ? priceLabel : <>₹{price.toLocaleString('en-IN')}<span className="text-base font-normal text-gray-500">{period}</span></>}
                                </div>
                                <p className="text-sm text-gray-500 mb-6">{desc}</p>
                                <button
                                    onClick={() => handlePricingClick(name)}
                                    disabled={isRedirecting && name === 'Growth'}
                                    className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl font-semibold transition-all mb-8 text-sm ${ctaStyle} ${isRedirecting && name === 'Growth' ? 'opacity-80 cursor-not-allowed' : ''}`}
                                >
                                    {isRedirecting && name === 'Growth' ? (
                                        <>
                                            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                            Redirecting to Secure Checkout...
                                        </>
                                    ) : (
                                        cta
                                    )}
                                </button>
                                <ul className="space-y-3">
                                    {features.map(feat => (
                                        <li key={feat} className="flex items-start gap-3 text-sm text-gray-600">
                                            <CheckCircle className="w-5 h-5 text-emerald-700 shrink-0 mt-px" />
                                            {feat}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ))}
                    </div>


                </div>
            </section>

            {/* ==================== TEAM SECTION ==================== */}
            <TeamSection />

            {/* ==================== FOOTER ==================== */}
            <footer className="bg-emerald-950 text-white">
                {/* CTA Block */}
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-24 pb-16 text-center border-b border-white/10">
                    <h2 className="text-3xl md:text-5xl font-extrabold tracking-tight mb-6 max-w-3xl mx-auto leading-tight">
                        The Smartest IT Helpdesk for Indian Businesses
                    </h2>
                    <p className="text-white/70 text-lg mb-10 max-w-xl mx-auto">
                        Start automating ticket triage today. No credit card required.
                    </p>
                    <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                        <button
                            onClick={() => navigate('/admin-signup')}
                            className="w-full sm:w-auto px-8 py-4 bg-white text-emerald-900 font-bold rounded-xl hover:bg-green-50 transition-all shadow-xl"
                        >
                            Get Started Free
                        </button>
                        <button
                            onClick={() => setShowDemo(true)}
                            className="w-full sm:w-auto px-8 py-4 border border-white/30 text-white font-semibold rounded-xl hover:bg-white/10 transition-all flex items-center justify-center gap-2"
                        >
                            <Play className="w-4 h-4 fill-white" /> Watch Demo
                        </button>
                    </div>
                    <div className="mt-8">
                        <button
                            onClick={() => navigate('/login')}
                            className="text-white/50 hover:text-white text-sm font-medium transition-colors"
                        >
                            Already have an account? <span className="underline underline-offset-4 decoration-white/20">Sign in</span>
                        </button>
                    </div>
                </div>

                {/* Footer Links */}
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-10">
                        {/* Brand Column */}
                        <div className="col-span-2 md:col-span-1">
                            <div className="flex items-center gap-2 mb-4">
                                <img src="/favicon.png" alt="H" className="w-8 h-8 object-contain" />
                                <span className="font-black text-lg text-white italic uppercase">HelpDesk.ai</span>
                            </div>
                            <p className="text-white/50 text-sm leading-relaxed mb-4">
                                AI-powered IT helpdesk automation for modern Indian enterprises.
                            </p>
                            <p className="text-xs text-white/30 mb-5">Made with ❤️ in India 🇮🇳</p>
                            <div className="flex gap-3">
                                <a href="https://twitter.com" target="_blank" rel="noopener noreferrer" className="w-9 h-9 bg-white/10 hover:bg-white/20 rounded-lg flex items-center justify-center transition-colors">
                                    <Twitter className="w-4 h-4" />
                                </a>
                                <a href="https://linkedin.com" target="_blank" rel="noopener noreferrer" className="w-9 h-9 bg-white/10 hover:bg-white/20 rounded-lg flex items-center justify-center transition-colors">
                                    <Linkedin className="w-4 h-4" />
                                </a>
                                <a href="https://github.com/ritesh-1918/HELPDESK.AI" target="_blank" rel="noopener noreferrer" className="w-9 h-9 bg-white/10 hover:bg-white/20 rounded-lg flex items-center justify-center transition-colors">
                                    <Github className="w-4 h-4" />
                                </a>
                            </div>
                        </div>

                        {[
                            {
                                heading: 'Product',
                                links: [
                                    { label: 'Auto-Categorization', href: '/features/categorization' },
                                    { label: 'Priority Detection', href: '/features/priority' },
                                    { label: 'Smart Resolution', href: '/features/resolution' },
                                    { label: 'Analytics Dashboard', href: '/admin-signup' },
                                ]
                            },
                            {
                                heading: 'Resources',
                                links: [
                                    { label: 'Documentation', href: '/docs' },
                                    { label: 'API Reference', href: '/api-reference' },
                                    { label: 'Changelog', href: '/changelog' },
                                    { label: 'Status Page', href: '/status' },
                                ]
                            },
                            {
                                heading: 'Company',
                                links: [
                                    { label: 'About Us', href: '/about' },
                                    { label: 'Careers', href: '/careers' },
                                    { label: 'Privacy Policy', href: '/privacy' },
                                    { label: 'Terms of Service', href: '/terms' },
                                ]
                            },
                            {
                                heading: 'Legal & Security',
                                links: [
                                    { label: 'Security Overview', href: '/security' },
                                    { label: 'Privacy Policy', href: '/privacy' },
                                    { label: 'Terms of Service', href: '/terms' },
                                    { label: 'Cookie Policy', href: '/cookie-policy' },
                                ]
                            },
                        ].map(({ heading, links }) => (
                            <div key={heading}>
                                <h4 className="text-xs font-bold uppercase tracking-widest text-white/40 mb-5">{heading}</h4>
                                <ul className="space-y-3">
                                    {links.map(({ label, href }) => (
                                        <li key={label}>
                                            {href.startsWith('/') ? (
                                                <button
                                                    onClick={() => navigate(href)}
                                                    className="text-sm text-white/65 hover:text-white transition-colors text-left"
                                                >
                                                    {label}
                                                </button>
                                            ) : (
                                                <a href={href} className="text-sm text-white/65 hover:text-white transition-colors">{label}</a>
                                            )}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ))}
                    </div>

                    {/* Bottom bar */}
                    <div className="flex flex-col md:flex-row items-center justify-between gap-4 mt-16 pt-8 border-t border-white/10">
                        <p className="text-xs text-white/40">
                            © 2026 HelpDesk.ai. All rights reserved. · Registered in India
                        </p>
                        <div className="flex items-center gap-4">
                            <button onClick={() => navigate('/terms')} className="text-xs text-white/40 hover:text-white transition-colors">Terms</button>
                            <button onClick={() => navigate('/privacy')} className="text-xs text-white/40 hover:text-white transition-colors">Privacy</button>
                            <button onClick={() => navigate('/security')} className="text-xs text-white/40 hover:text-white transition-colors">Security</button>
                            <div className="flex items-center gap-2 text-xs text-white/40 border border-white/10 rounded-lg px-3 py-1.5 cursor-pointer hover:bg-white/10 transition-colors">
                                <Globe className="w-3.5 h-3.5" />
                                <span>English (IN)</span>
                            </div>
                        </div>
                    </div>
                </div>
            </footer>
        </div>
    );
}
// Nudge for redeploy
