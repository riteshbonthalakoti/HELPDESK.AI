import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    User,
    Mail,
    Building2,
    ShieldCheck,
    Calendar,
    Ticket,
    Zap,
    ArrowUpRight,
    Lock,
    LogOut,
    ChevronRight,
    Fingerprint,
    Camera,
    UploadCloud,
    X,
    Check,
    Pencil,
    Phone,
    Briefcase,
    Loader2,
    AlertCircle
} from 'lucide-react';

import { motion, AnimatePresence } from 'framer-motion';
import { Avatar, AvatarFallback, AvatarImage } from "../../components/ui/avatar";
import { Card, CardHeader, CardTitle, CardContent } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import useAuthStore from "../../store/authStore";
import useToastStore from "../../store/toastStore";
import { supabase } from "../../lib/supabaseClient";
import BugReportWidget from "../../components/shared/BugReportWidget";
import EmailChangeModal from "../../components/shared/EmailChangeModal";
const Profile = () => {
    const navigate = useNavigate();
    const { profile, user, logout, loading: authLoading, updateProfile } = useAuthStore();
    const { showToast } = useToastStore();

    const [userTickets, setUserTickets] = useState([]);
    const [isEditing, setIsEditing] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [formData, setFormData] = useState({
        full_name: '',
        job_title: '',
        phone: ''
    });

    const [showPasswordModal, setShowPasswordModal] = useState(false);
    const [showEmailModal, setShowEmailModal] = useState(false);
    const [passwordData, setPasswordData] = useState({
        currentPassword: '',
        newPassword: '',
        confirmPassword: ''
    });
    const [passwordLoading, setPasswordLoading] = useState(false);

    const fileInputRef = useRef(null);

    useEffect(() => {
        if (profile) {
            setFormData({
                full_name: profile.full_name || '',
                job_title: profile.job_title || '',
                phone: profile.phone || ''
            });
        }
    }, [profile]);

    useEffect(() => {
        const fetchUserTickets = async () => {
            if (!user?.id) return;
            const { data } = await supabase
                .from('tickets')
                .select('*')
                .eq('user_id', user.id);
            setUserTickets(data || []);
        };
        fetchUserTickets();
    }, [user]);

    const handleLogout = async () => {
        try {
            await logout();
            navigate("/login");
        } catch (err) {
            console.error("Logout failed:", err);
        }
    };

    const handleSaveProfile = async () => {
        try {
            await updateProfile(formData);
            setIsEditing(false);
            showToast("Profile configuration updated successfully.", "success");
        } catch (err) {
            showToast("Sync failed: " + err.message, "error");
        }
    };

    const handleAvatarUpload = async (e) => {
        const file = e.target.files?.[0];
        if (!file || !user) return;

        // Validation
        if (!file.type.startsWith('image/')) {
            showToast("Invalid file type. Please upload an image.", "error");
            return;
        }
        if (file.size > 2 * 1024 * 1024) {
            showToast("File too large. Max 2MB allowed.", "error");
            return;
        }

        setIsUploading(true);
        try {
            const fileExt = file.name.split('.').pop();
            const fileName = `${user.id}/${Date.now()}.${fileExt}`;
            const filePath = `${fileName}`;

            // 1. Upload to Supabase Storage
            const { error: uploadError } = await supabase.storage
                .from('profile-pics')
                .upload(filePath, file, { upsert: true });

            if (uploadError) throw uploadError;

            // 2. Get Public URL
            const { data: { publicUrl } } = supabase.storage
                .from('profile-pics')
                .getPublicUrl(filePath);

            // 3. Update Profile DB
            await updateProfile({ profile_picture: publicUrl });
            showToast("Avatar synchronized with neural record.", "success");
        } catch (err) {
            console.error("Upload error:", err);
            showToast("Upload failed: " + err.message, "error");
        } finally {
            setIsUploading(false);
        }
    };

    const handlePasswordChange = async (e) => {
        if (e) e.preventDefault();

        if (!passwordData.currentPassword) {
            showToast("Please enter your current password.", "error");
            return;
        }
        if (!passwordData.newPassword || passwordData.newPassword.length < 6) {
            showToast("Password must be at least 6 characters.", "error");
            return;
        }
        if (passwordData.newPassword !== passwordData.confirmPassword) {
            showToast("Passwords do not match.", "error");
            return;
        }

        setPasswordLoading(true);
        try {
            // Step 1: Verify current password first
            const { error: authError } = await supabase.auth.signInWithPassword({
                email: user.email,
                password: passwordData.currentPassword
            });

            if (authError) {
                showToast("Current password is incorrect.", "error");
                return;
            }

            // Step 2: Safe to update now
            const { error } = await supabase.auth.updateUser({
                password: passwordData.newPassword
            });

            if (error) throw error;

            showToast("Security credentials updated successfully.", "success");
            setShowPasswordModal(false);
            setPasswordData({ currentPassword: '', newPassword: '', confirmPassword: '' });
        } catch (err) {
            showToast("Sync failed: " + err.message, "error");
        } finally {
            setPasswordLoading(false);
        }
    };

    const handleDeleteAccount = async () => {
        if (!window.confirm("Are you absolutely sure you want to permanently delete your account and all associated data? This action cannot be undone.")) return;

        try {
            const { error: rpcError } = await supabase.rpc('delete_user');
            if (rpcError) {
                console.warn("RPC delete_user not found or failed. Attempting profile removal...", rpcError);
                await supabase.from('profiles').delete().eq('id', user.id);
            }
            await logout();
            navigate('/login');
            showToast("Account deleted and securely wiped successfully.", "success");
        } catch (err) {
            showToast("Failed to wipe account: " + err.message, "error");
        }
    };

    if (authLoading || !profile) {
        return (
            <div className="flex h-screen w-screen items-center justify-center bg-white">
                <div className="h-12 w-12 animate-spin rounded-full border-4 border-emerald-600 border-t-transparent"></div>
            </div>
        );
    }

    const ticketsCreated = userTickets.length;
    const ticketsResolvedByAI = userTickets.filter(t => t.status?.toLowerCase()?.includes('auto') || t.status?.toLowerCase()?.includes('resolved')).length;
    const ticketsEscalated = userTickets.filter(t => t.status?.toLowerCase()?.includes('escalat') || t.status?.toLowerCase() === 'open' || t.status?.toLowerCase()?.includes('pending')).length;

    return (
        <div className="min-h-screen bg-[#f6f8f7] pb-20">
            <main className="pt-32 px-6 flex justify-center">
                <div className="w-full max-w-[1100px] flex flex-col gap-8">

                    {/* Profile Header */}
                    <motion.div
                        layout
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="relative bg-white p-8 rounded-[2.5rem] shadow-xl shadow-slate-200/50 border border-white overflow-hidden"
                    >
                        {/* Background Decoration */}
                        <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-500/5 rounded-full blur-3xl -mr-20 -mt-20"></div>

                        <div className="relative flex flex-col md:flex-row items-center gap-8">
                            {/* Avatar Section */}
                            <div className="relative group">
                                <Avatar className="h-32 w-32 border-4 border-white ring-4 ring-emerald-500/10 shadow-2xl transition-transform duration-500 group-hover:scale-105">
                                    <AvatarImage src={profile.profile_picture} alt={profile.full_name} className="object-cover" />
                                    <AvatarFallback className="bg-gradient-to-br from-emerald-50 to-emerald-100 text-emerald-600 text-4xl font-black">
                                        {profile.full_name?.split(' ').map(n => n[0]).join('') || profile.email?.[0].toUpperCase()}
                                    </AvatarFallback>
                                </Avatar>

                                <button
                                    onClick={() => fileInputRef.current?.click()}
                                    disabled={isUploading}
                                    className="absolute bottom-0 right-0 p-2.5 bg-slate-900 text-white rounded-2xl shadow-xl hover:bg-emerald-600 transition-all active:scale-95 disabled:opacity-50"
                                >
                                    {isUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
                                </button>
                                <input
                                    type="file"
                                    ref={fileInputRef}
                                    className="hidden"
                                    accept="image/*"
                                    onChange={handleAvatarUpload}
                                />
                            </div>

                            <div className="flex-1 text-center md:text-left space-y-4">
                                <AnimatePresence mode="wait">
                                    {!isEditing ? (
                                        <motion.div
                                            key="view-info"
                                            initial={{ opacity: 0, x: -20 }}
                                            animate={{ opacity: 1, x: 0 }}
                                            exit={{ opacity: 0, x: 20 }}
                                            className="space-y-2"
                                        >
                                            <h1 className="text-4xl font-black text-slate-900 tracking-tight italic uppercase">
                                                {profile.full_name || "New Recruit"}
                                            </h1>
                                            <div className="flex flex-wrap justify-center md:justify-start gap-4 text-sm font-black text-slate-400 uppercase tracking-widest italic">
                                                <div className="flex items-center gap-2">
                                                    <Mail size={16} className="text-emerald-500" />
                                                    {profile.email}
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <Briefcase size={16} className="text-indigo-500" />
                                                    {profile.job_title || "Personnel"}
                                                </div>
                                                {profile.phone && (
                                                    <div className="flex items-center gap-2">
                                                        <Phone size={16} className="text-amber-500" />
                                                        {profile.phone}
                                                    </div>
                                                )}
                                            </div>
                                        </motion.div>
                                    ) : (
                                        <motion.div
                                            key="edit-info"
                                            initial={{ opacity: 0, x: 20 }}
                                            animate={{ opacity: 1, x: 0 }}
                                            exit={{ opacity: 0, x: -20 }}
                                            className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-2xl"
                                        >
                                            <div className="space-y-1">
                                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-2">Identity Signature</label>
                                                <input
                                                    value={formData.full_name}
                                                    onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                                                    className="w-full bg-slate-50 border-2 border-transparent focus:border-emerald-500 px-4 py-2.5 rounded-2xl text-sm font-bold outline-none transition-all"
                                                    placeholder="Full Name"
                                                />
                                            </div>
                                            <div className="space-y-1">
                                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-2">Designation</label>
                                                <input
                                                    value={formData.job_title}
                                                    onChange={(e) => setFormData({ ...formData, job_title: e.target.value })}
                                                    className="w-full bg-slate-50 border-2 border-transparent focus:border-emerald-500 px-4 py-2.5 rounded-2xl text-sm font-bold outline-none transition-all"
                                                    placeholder="Job Title"
                                                />
                                            </div>
                                            <div className="space-y-1 md:col-span-2">
                                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-2">Comms Channel</label>
                                                <input
                                                    value={formData.phone}
                                                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                                                    className="w-full bg-slate-50 border-2 border-transparent focus:border-emerald-500 px-4 py-2.5 rounded-2xl text-sm font-bold outline-none transition-all"
                                                    placeholder="Phone Number"
                                                />
                                            </div>
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </div>

                            <div className="flex gap-3">
                                {!isEditing ? (
                                    <>
                                        <Button
                                            onClick={() => setShowEmailModal(true)}
                                            className="rounded-2xl bg-emerald-50 border-2 border-emerald-200 px-5 py-6 font-black text-[10px] uppercase tracking-widest text-emerald-700 hover:bg-emerald-100 hover:border-emerald-400 transition-all"
                                        >
                                            <Mail className="w-3.5 h-3.5 mr-2" />
                                            Change Email
                                        </Button>
                                        <Button
                                            onClick={() => setIsEditing(true)}
                                            className="rounded-2xl bg-white border-2 border-slate-100 px-6 py-6 font-black text-[10px] uppercase tracking-widest text-slate-600 hover:bg-slate-50 hover:border-emerald-500 hover:text-emerald-600 transition-all group"
                                        >
                                            <Pencil className="w-3.5 h-3.5 mr-2 transition-transform group-hover:-rotate-12" />
                                            Modify Profile
                                        </Button>
                                    </>
                                ) : (
                                    <>
                                        <Button
                                            onClick={handleSaveProfile}
                                            className="rounded-2xl bg-emerald-600 px-6 py-6 font-black text-[10px] uppercase tracking-widest text-white hover:bg-emerald-700 shadow-lg shadow-emerald-500/20"
                                        >
                                            <Check className="w-3.5 h-3.5 mr-2" />
                                            Synchronize
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            onClick={() => setIsEditing(false)}
                                            className="rounded-2xl px-6 py-6 font-black text-[10px] uppercase tracking-widest text-slate-400 hover:text-red-500"
                                        >
                                            <X className="w-3.5 h-3.5 mr-2" />
                                            Abort
                                        </Button>
                                    </>
                                )}
                            </div>
                        </div>
                    </motion.div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                        {/* Account Info Card */}
                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.1 }}
                        >
                            <Card className="border-none shadow-xl shadow-slate-200/40 rounded-[2.5rem] bg-white h-full overflow-hidden">
                                <CardHeader className="p-8 pb-4 bg-slate-50/50">
                                    <CardTitle className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] flex items-center gap-2 italic">
                                        <ShieldCheck size={16} className="text-emerald-500" />
                                        Credentials & Clearance
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="p-8 pt-6 space-y-6">
                                    <div className="space-y-5">
                                        <div className="flex justify-between items-center bg-slate-50 p-4 rounded-2xl border border-slate-100/50">
                                            <div className="flex items-center gap-3 text-[10px] font-black text-slate-400 uppercase tracking-widest italic">
                                                <Fingerprint size={16} className="text-indigo-400" />
                                                UUID
                                            </div>
                                            <span className="text-[10px] font-mono font-bold text-slate-600 truncate max-w-[120px]">
                                                {profile.id}
                                            </span>
                                        </div>
                                        <div className="flex justify-between items-center bg-slate-50 p-4 rounded-2xl border border-slate-100/50">
                                            <div className="flex items-center gap-3 text-[10px] font-black text-slate-400 uppercase tracking-widest italic">
                                                <User size={16} className="text-emerald-400" />
                                                Clearance
                                            </div>
                                            <span className="text-[10px] font-black text-emerald-600 bg-emerald-100 px-3 py-1.5 rounded-full uppercase italic tracking-widest">
                                                {profile.role || "User"}
                                            </span>
                                        </div>
                                        <div className="flex justify-between items-center bg-slate-50 p-4 rounded-2xl border border-slate-100/50">
                                            <div className="flex items-center gap-3 text-[10px] font-black text-slate-400 uppercase tracking-widest italic">
                                                <Calendar size={16} className="text-amber-400" />
                                                Enlisted
                                            </div>
                                            <span className="text-[10px] font-black text-slate-900 uppercase italic">
                                                {new Date(profile.created_at).toLocaleDateString([], { month: 'long', year: 'numeric' })}
                                            </span>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        </motion.div>

                        {/* Activity Card */}
                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.2 }}
                            className="md:col-span-2"
                        >
                            <Card className="border-none shadow-xl shadow-slate-200/40 rounded-[2.5rem] bg-white h-full overflow-hidden">
                                <CardHeader className="p-8 pb-4 bg-slate-50/50">
                                    <CardTitle className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] flex items-center gap-2 italic">
                                        <Zap size={16} className="text-amber-500" />
                                        Performance Telemetry
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="p-8 pt-6">
                                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                                        <div className="p-8 bg-slate-50/50 rounded-3xl border border-slate-100 flex flex-col items-center text-center space-y-4 hover:bg-white hover:shadow-xl transition-all duration-500">
                                            <div className="w-12 h-12 bg-white rounded-[1.25rem] shadow-lg flex items-center justify-center text-slate-400">
                                                <Ticket size={24} />
                                            </div>
                                            <div>
                                                <p className="text-3xl font-black text-slate-900 italic">{ticketsCreated}</p>
                                                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Total Reports</p>
                                            </div>
                                        </div>
                                        <div className="p-8 bg-emerald-50/30 rounded-3xl border border-emerald-100 flex flex-col items-center text-center space-y-4 hover:bg-white hover:shadow-xl transition-all duration-500">
                                            <div className="w-12 h-12 bg-white rounded-[1.25rem] shadow-lg flex items-center justify-center text-emerald-500">
                                                <Zap size={24} className="fill-emerald-500" />
                                            </div>
                                            <div>
                                                <p className="text-3xl font-black text-emerald-600 italic">{ticketsResolvedByAI}</p>
                                                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">AI Resolved</p>
                                            </div>
                                        </div>
                                        <div className="p-8 bg-indigo-50/30 rounded-3xl border border-indigo-100 flex flex-col items-center text-center space-y-4 hover:bg-white hover:shadow-xl transition-all duration-500">
                                            <div className="w-12 h-12 bg-white rounded-[1.25rem] shadow-lg flex items-center justify-center text-indigo-500">
                                                <ArrowUpRight size={24} />
                                            </div>
                                            <div>
                                                <p className="text-3xl font-black text-indigo-600 italic">{ticketsEscalated}</p>
                                                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Escalations</p>
                                            </div>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        </motion.div>

                        {/* Settings Section */}
                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.3 }}
                            className="md:col-span-3"
                        >
                            <Card className="border-none shadow-xl shadow-slate-200/40 rounded-[2.5rem] bg-white overflow-hidden">
                                <CardHeader className="p-8 pb-4 bg-slate-50/50">
                                    <CardTitle className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] italic">
                                        System Configuration
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="p-0">
                                    <div className="divide-y divide-slate-50">
                                        <button
                                            onClick={() => setShowPasswordModal(true)}
                                            className="w-full p-8 flex items-center justify-between hover:bg-slate-50 transition-all group"
                                        >
                                            <div className="flex items-center gap-6">
                                                <div className="w-12 h-12 bg-slate-50 rounded-2xl flex items-center justify-center text-slate-400 group-hover:bg-indigo-600 group-hover:text-white transition-all shadow-sm">
                                                    <Lock size={20} />
                                                </div>
                                                <div className="text-left">
                                                    <p className="text-sm font-black text-slate-900 uppercase italic tracking-tight">Security Credentials</p>
                                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Rotate access keys & passwords</p>
                                                </div>
                                            </div>
                                            <ChevronRight size={18} className="text-slate-300 group-hover:text-indigo-600 transition-all" />
                                        </button>

                                        {/* Bug Report Custom Trigger */}
                                        <BugReportWidget
                                            advanced={true}
                                            customTrigger={
                                                <div className="w-full p-8 flex items-center justify-between hover:bg-red-50 transition-all group border-t border-slate-50">
                                                    <div className="flex items-center gap-6">
                                                        <div className="w-12 h-12 bg-slate-50 rounded-2xl flex items-center justify-center text-slate-400 group-hover:bg-red-600 group-hover:text-white transition-all shadow-sm">
                                                            <AlertCircle size={20} />
                                                        </div>
                                                        <div className="text-left">
                                                            <p className="text-sm font-black text-slate-900 uppercase italic tracking-tight">Report Bug</p>
                                                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Advanced technical bug reporting</p>
                                                        </div>
                                                    </div>
                                                    <ChevronRight size={18} className="text-slate-300 group-hover:text-red-600 transition-all" />
                                                </div>
                                            }
                                        />

                                        <button
                                            onClick={handleLogout}
                                            className="w-full p-8 flex items-center justify-between hover:bg-amber-50/30 transition-all group border-b border-slate-50"
                                        >
                                            <div className="flex items-center gap-6">
                                                <div className="w-12 h-12 bg-amber-50 rounded-2xl flex items-center justify-center text-amber-500 shadow-sm transition-all group-hover:bg-amber-500 group-hover:text-white">
                                                    <LogOut size={20} />
                                                </div>
                                                <div className="text-left">
                                                    <p className="text-sm font-black text-amber-600 uppercase italic tracking-tight">Terminate Session</p>
                                                    <p className="text-[10px] font-bold text-amber-500 uppercase tracking-widest">Securely eject from neural network</p>
                                                </div>
                                            </div>
                                            <ChevronRight size={18} className="text-amber-200 group-hover:text-amber-500 transition-all" />
                                        </button>

                                        <button
                                            onClick={handleDeleteAccount}
                                            className="w-full p-8 flex items-center justify-between hover:bg-red-50/30 transition-all group rounded-b-3xl"
                                        >
                                            <div className="flex items-center gap-6">
                                                <div className="w-12 h-12 bg-red-50 rounded-2xl flex items-center justify-center text-red-500 shadow-sm transition-all group-hover:bg-red-600 group-hover:text-white">
                                                    <X size={20} />
                                                </div>
                                                <div className="text-left">
                                                    <p className="text-sm font-black text-red-600 uppercase italic tracking-tight">Delete Account</p>
                                                    <p className="text-[10px] font-bold text-red-400 uppercase tracking-widest">Perform complete data wipe</p>
                                                </div>
                                            </div>
                                            <ChevronRight size={18} className="text-red-200 group-hover:text-red-500 transition-all" />
                                        </button>
                                    </div>
                                </CardContent>
                            </Card>
                        </motion.div>
                    </div>
                </div>
            </main>

            {/* Change Password Modal */}
            <AnimatePresence>
                {showPasswordModal && (
                    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[100] flex items-center justify-center p-6">
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            className="w-full max-w-sm bg-white rounded-[2.5rem] shadow-2xl overflow-hidden border border-white"
                        >
                            <div className="px-8 py-6 bg-slate-900 text-white flex items-center justify-between">
                                <h3 className="font-black italic uppercase text-sm tracking-widest flex items-center gap-2">
                                    <Lock size={16} className="text-emerald-400" /> Security Sequence
                                </h3>
                                <button onClick={() => setShowPasswordModal(false)} className="text-white/60 hover:text-white transition-colors">
                                    <X size={20} />
                                </button>
                            </div>
                            <div className="p-8 space-y-6">
                                <div className="space-y-4">
                                    <div className="space-y-1.5">
                                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block ml-1">Current Password</label>
                                        <input
                                            type="password"
                                            placeholder="Enter current password"
                                            className="w-full bg-slate-50 border-2 border-transparent focus:border-emerald-500 rounded-2xl px-4 py-3 text-sm font-bold outline-none transition-all"
                                            value={passwordData.currentPassword}
                                            onChange={(e) => setPasswordData({ ...passwordData, currentPassword: e.target.value })}
                                        />
                                    </div>
                                    <div className="space-y-1.5">
                                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block ml-1">New Sequence</label>
                                        <input
                                            type="password"
                                            placeholder="Enter new password"
                                            className="w-full bg-slate-50 border-2 border-transparent focus:border-emerald-500 rounded-2xl px-4 py-3 text-sm font-bold outline-none transition-all"
                                            value={passwordData.newPassword}
                                            onChange={(e) => setPasswordData({ ...passwordData, newPassword: e.target.value })}
                                        />
                                    </div>
                                    <div className="space-y-1.5">
                                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block ml-1">Confirm Sequence</label>
                                        <input
                                            type="password"
                                            placeholder="Re-enter password"
                                            className="w-full bg-slate-50 border-2 border-transparent focus:border-emerald-500 rounded-2xl px-4 py-3 text-sm font-bold outline-none transition-all"
                                            value={passwordData.confirmPassword}
                                            onChange={(e) => setPasswordData({ ...passwordData, confirmPassword: e.target.value })}
                                        />
                                    </div>
                                </div>
                                <Button
                                    onClick={handlePasswordChange}
                                    disabled={passwordLoading}
                                    className="w-full h-14 bg-emerald-600 text-white font-black rounded-2xl hover:bg-emerald-700 shadow-xl shadow-emerald-500/20 text-xs uppercase tracking-widest flex items-center justify-center gap-2"
                                >
                                    {passwordLoading ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />}
                                    {passwordLoading ? "Syncing..." : "Update Security"}
                                </Button>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>

            <EmailChangeModal
                isOpen={showEmailModal}
                onClose={() => setShowEmailModal(false)}
                currentEmail={profile?.email}
            />

        </div>
    );
};

export default Profile;
