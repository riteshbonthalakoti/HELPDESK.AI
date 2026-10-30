// @ts-nocheck
import React, { useState } from 'react';
 
import { motion } from 'framer-motion';
import { Building2, Mail, User, Phone, MessageSquare, ArrowRight, CheckCircle2, ShieldCheck, Zap, Server } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';

// Valid company_size options — used for localStorage validation
const VALID_COMPANY_SIZES = ['1-50', '50-200', '200-1000', '1000+'];
const DEFAULT_COMPANY_SIZE = '50-200';
const LS_KEY = 'contact_sales_company_size';

/** Safely read from localStorage (returns null on error, e.g. incognito). */
function safeGetItem(key) {
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
}

/** Safely write to localStorage (no-op on error, e.g. incognito). */
function safeSetItem(key, value) {
    try {
        localStorage.setItem(key, value);
    } catch {
        // Silently ignore — localStorage may be unavailable in private browsing
    }
}

/** Safely remove from localStorage. */
function safeRemoveItem(key) {
    try {
        localStorage.removeItem(key);
    } catch {
        // Silently ignore
    }
}

export default function ContactSales() {
    const navigate = useNavigate();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isSuccess, setIsSuccess] = useState(false);
    const [errors, setErrors] = useState({});
    const [formData, setFormData] = useState(() => {
        // Validate the stored company_size against known valid options
        const stored = safeGetItem(LS_KEY);
        const companySizeInit = VALID_COMPANY_SIZES.includes(stored)
            ? stored
            : DEFAULT_COMPANY_SIZE;

        return {
            name: '',
            email: '',
            company: '',
            phone: '',
            company_size: companySizeInit,
            message: ''
        };
    });

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
        if (name === 'company_size') {
            safeSetItem(LS_KEY, value);
        }
        // Clear error on change
        if (errors[name]) {
            setErrors(prev => ({ ...prev, [name]: '' }));
        }
    };

    const validateForm = () => {
        const newErrors = {};

        // Full Name: letters, spaces, hyphens, apostrophes only
        const nameRegex = /^[a-zA-Z\s'\-]{2,100}$/;
        if (!formData.name.trim()) {
            newErrors.name = 'Full name is required.';
        } else if (!nameRegex.test(formData.name.trim())) {
            newErrors.name = 'Full name must contain only letters, spaces, hyphens, or apostrophes.';
        }

        // Work Email: must have valid domain with TLD (e.g. abc@company.com)
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
        if (!formData.email.trim()) {
            newErrors.email = 'Work email is required.';
        } else if (!emailRegex.test(formData.email.trim())) {
            newErrors.email = 'Please enter a valid work email address (e.g. john@company.com).';
        }

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!validateForm()) return;
        setIsSubmitting(true);
        
        try {
            const { error } = await supabase
                .from('enterprise_leads')
                .insert([
                    {
                        name: formData.name,
                        email: formData.email,
                        company: formData.company,
                        phone: formData.phone,
                        company_size: formData.company_size,
                        message: formData.message
                    }
                ]);

            if (error) throw error;
            
            // Clear persisted dropdown so next visit starts fresh
            safeRemoveItem(LS_KEY);
            setIsSuccess(true);
        } catch (error) {
            console.error('Error submitting form:', error);
            alert("There was an issue submitting your request. Please try again.");
        } finally {
            setIsSubmitting(false);
        }
    };

    if (isSuccess) {
        return (
            <div className="min-h-screen bg-white flex items-center justify-center p-4">
                <motion.div 
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="max-w-md w-full text-center space-y-6 bg-emerald-50 rounded-3xl p-10 border border-emerald-100 shadow-xl"
                >
                    <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
                        <CheckCircle2 className="w-10 h-10 text-emerald-600" />
                    </div>
                    <h2 className="text-3xl font-extrabold text-gray-900">Request Sent!</h2>
                    <p className="text-gray-600 dark:text-gray-400">
                        Thank you for your interest in HelpDesk.ai Enterprise. Our team will review your requirements and get back to you within 24 hours.
                    </p>
                    <button 
                        onClick={() => navigate('/')} 
                        className="w-full bg-emerald-900 text-white font-bold py-4 rounded-xl shadow-[0_10px_40px_-10px_rgba(6,78,59,0.5)] hover:bg-emerald-800 transition-all mt-4"
                    >
                        Return Home
                    </button>
                </motion.div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-50 flex flex-col">
            {/* Minimal Nav */}
            <div className="w-full py-6 px-4 md:px-8 border-b border-gray-200 bg-white">
                <div className="max-w-7xl mx-auto flex items-center justify-between">
                    <div className="flex items-center gap-2 cursor-pointer" onClick={() => navigate('/')}>
                        <img src="/favicon.png" alt="H" className="w-8 h-8 object-contain" />
                        <span className="font-black text-2xl tracking-tighter text-emerald-900 italic uppercase">HelpDesk.ai</span>
                    </div>
                    <button onClick={() => navigate('/')} className="text-sm font-semibold text-gray-500 dark:text-gray-400 hover:text-gray-900">
                        Back to Home
                    </button>
                </div>
            </div>

            <div className="flex-1 flex flex-col lg:flex-row w-full max-w-7xl mx-auto">
                {/* Left Side: Premium Banner / Value Prop */}
                <div className="w-full lg:w-5/12 bg-emerald-950 p-10 md:p-16 flex flex-col justify-center relative overflow-hidden">
                    {/* Background decorations */}
                    <div className="absolute top-0 right-0 w-96 h-96 bg-emerald-500/10 blur-[100px] rounded-full -translate-y-1/2 translate-x-1/2 pointer-events-none" />
                    <div className="absolute bottom-0 left-0 w-96 h-96 bg-emerald-500/10 blur-[100px] rounded-full translate-y-1/2 -translate-x-1/2 pointer-events-none" />
                    
                    <div className="relative z-10 text-white">
                        <div className="inline-flex items-center gap-2 px-3 py-1 bg-white/10 text-white rounded-full text-xs font-bold uppercase tracking-widest border border-white/20 mb-6">
                            Enterprise Plan
                        </div>
                        <h1 className="text-4xl md:text-5xl font-black italic tracking-tight mb-6 leading-tight">
                            Scale Support Without Scaling Teams.
                        </h1>
                        <p className="text-emerald-100/70 text-lg mb-12">
                            Deploy fine-tuned AI categorization engines instantly. Eliminate helpdesk bottlenecks with our compliant, scalable infrastructure.
                        </p>

                        <div className="space-y-6">
                            {[
                                { icon: ShieldCheck, title: "Custom AI Fine-Tuning", desc: "Train models on your proprietary internal docs." },
                                { icon: Server, title: "On-Prem / Dedicated Infra", desc: "Keep data local with single-tenant architecture." },
                                { icon: Zap, title: "SLA Management", desc: "Guaranteed 99.99% uptime with dedicated support." },
                            ].map((feature, i) => (
                                <div key={i} className="flex gap-4">
                                    <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center shrink-0">
                                        <feature.icon className="w-5 h-5 text-emerald-400" />
                                    </div>
                                    <div>
                                        <h4 className="font-bold text-white text-md mb-1">{feature.title}</h4>
                                        <p className="text-emerald-100/50 text-sm leading-relaxed max-w-xs">{feature.desc}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Right Side: Contact Form */}
                <div className="w-full lg:w-7/12 p-6 justify-center flex bg-white/30 backdrop-blur-md items-center shadow-inner border-l border-gray-100">
                    <div className="w-full max-w-xl mx-auto py-10">
                        <div className="mb-10 text-center lg:text-left">
                            <h2 className="text-3xl font-extrabold text-gray-900 tracking-tight">Contact Sales</h2>
                            <p className="text-gray-500 dark:text-gray-400 mt-2">Fill out the form below and an Enterprise architect will be in touch shortly.</p>
                        </div>
                        
                        <form onSubmit={handleSubmit} className="space-y-5">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                                <div className="space-y-1.5">
                                    <label className="text-sm font-semibold text-gray-700 ml-1">Full Name *</label>
                                    <div className="relative">
                                        <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                                            <User className="h-5 w-5 text-gray-400" />
                                        </div>
                                        <input 
                                            type="text" 
                                            required 
                                            name="name"
                                            className={`w-full pl-11 pr-4 py-3 bg-white border rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all font-medium text-gray-900 ${errors.name ? 'border-red-400' : 'border-gray-200'}`}
                                            placeholder="John Doe"
                                            value={formData.name}
                                            onChange={handleChange}
                                        />
                                    </div>
                                    {errors.name && <p className="text-red-500 text-xs mt-1 ml-1">{errors.name}</p>}
                                </div>

                                <div className="space-y-1.5">
                                    <label className="text-sm font-semibold text-gray-700 ml-1">Work Email *</label>
                                    <div className="relative">
                                        <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                                            <Mail className="h-5 w-5 text-gray-400" />
                                        </div>
                                        <input 
                                            type="email" 
                                            required 
                                            name="email"
                                            className={`w-full pl-11 pr-4 py-3 bg-white border rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all font-medium text-gray-900 ${errors.email ? 'border-red-400' : 'border-gray-200'}`}
                                            placeholder="john@company.com"
                                            value={formData.email}
                                            onChange={handleChange}
                                        />
                                    </div>
                                    {errors.email && <p className="text-red-500 text-xs mt-1 ml-1">{errors.email}</p>}
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                                <div className="space-y-1.5">
                                    <label className="text-sm font-semibold text-gray-700 ml-1">Company Name *</label>
                                    <div className="relative">
                                        <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                                            <Building2 className="h-5 w-5 text-gray-400" />
                                        </div>
                                        <input 
                                            type="text" 
                                            required 
                                            name="company"
                                            className="w-full pl-11 pr-4 py-3 bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all font-medium text-gray-900" 
                                            placeholder="Acme Corp"
                                            value={formData.company}
                                            onChange={handleChange}
                                        />
                                    </div>
                                </div>
                                <div className="space-y-1.5 relative">
                                    <label className="text-sm font-semibold text-gray-700 ml-1">Company Size</label>
                                    <div className="relative">
                                        <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                                            <Building2 className="h-5 w-5 text-gray-400" />
                                        </div>
                                        <select 
                                            name="company_size"
                                            className="w-full pl-11 pr-10 py-3 bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all font-medium text-gray-900 appearance-none cursor-pointer"
                                            value={formData.company_size}
                                            onChange={handleChange}
                                        >
                                            <option value="1-50">1 - 50 employees</option>
                                            <option value="50-200">50 - 200 employees</option>
                                            <option value="200-1000">200 - 1,000 employees</option>
                                            <option value="1000+">1000+ employees</option>
                                        </select>
                                        <div className="absolute inset-y-0 right-0 pr-3.5 flex items-center pointer-events-none">
                                            <ArrowRight className="h-4 w-4 text-gray-400 rotate-90" />
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-1.5">
                                <label className="text-sm font-semibold text-gray-700 ml-1">Phone Number</label>
                                <div className="relative">
                                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                                        <Phone className="h-5 w-5 text-gray-400" />
                                    </div>
                                    <input 
                                        type="tel" 
                                        name="phone"
                                        className="w-full pl-11 pr-4 py-3 bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all font-medium text-gray-900" 
                                        placeholder="+1 (555) 000-0000"
                                        value={formData.phone}
                                        onChange={handleChange}
                                    />
                                </div>
                            </div>

                            <div className="space-y-1.5">
                                <label className="text-sm font-semibold text-gray-700 ml-1">How can we help? *</label>
                                <textarea 
                                    required 
                                    name="message"
                                    rows="4"
                                    className="w-full p-4 bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all font-medium text-gray-900 resize-none" 
                                    placeholder="Tell us about your IT setup and automation needs..."
                                    value={formData.message}
                                    onChange={handleChange}
                                ></textarea>
                            </div>

                            <button 
                                type="submit" 
                                disabled={isSubmitting}
                                className={`w-full py-4 bg-emerald-900 text-white rounded-xl font-bold transition-all shadow-xl shadow-emerald-900/20 flex items-center justify-center gap-2 mt-4 ${isSubmitting ? 'opacity-80 cursor-not-allowed' : 'hover:bg-emerald-800'}`}
                            >
                                {isSubmitting ? (
                                    <>
                                        <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                        Submitting Request...
                                    </>
                                ) : (
                                    <>
                                        Request Enterprise Access <ArrowRight className="w-5 h-5" />
                                    </>
                                )}
                            </button>
                            <p className="text-xs text-center text-gray-400 mt-4">
                                By submitting this form, you agree to our Privacy Policy and Terms of Service.
                            </p>
                        </form>
                    </div>
                </div>
            </div>
        </div>
    );
}
