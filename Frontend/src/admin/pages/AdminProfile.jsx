import React, { useState, useRef, useEffect } from 'react';
import {
    User, Mail, Shield, Bell, Lock, Globe, Camera, ShieldCheck, Key,
    Smartphone, History, Activity, CheckCircle2, AlertCircle, Copy,
    LogOut, Eye, Save, X, Edit2, Download
} from 'lucide-react';
import useAuthStore from '../../store/authStore';
import useToastStore from '../../store/toastStore';
import { supabase } from "../../lib/supabaseClient";
import BugReportWidget from "../../components/shared/BugReportWidget";
import EmailChangeModal from "../../components/shared/EmailChangeModal";

const AdminProfile = () => {
    const { user, profile: adminProfile } = useAuthStore();
    const { showToast } = useToastStore();
    const [isEditingProfile, setIsEditingProfile] = useState(false);
    const [profileForm, setProfileForm] = useState({
        name: adminProfile?.full_name || '',
        email: adminProfile?.email || '',
        profile_picture: adminProfile?.profile_picture || null
    });

    useEffect(() => {
        if (adminProfile) {
            setProfileForm({
                name: adminProfile.full_name || '',
                email: adminProfile.email || '',
                profile_picture: adminProfile.profile_picture || null
            });
        }
    }, [adminProfile]);

    const [isAdmin2FAEnabled, setIsAdmin2FAEnabled] = useState(false);
    const [showPasswordModal, setShowPasswordModal] = useState(false);
    const [showEmailModal, setShowEmailModal] = useState(false);
    const [passwordForm, setPasswordForm] = useState({ newPassword: '', confirmPassword: '' });
    const [passwordLoading, setPasswordLoading] = useState(false);
    const fileInputRef = useRef(null);
    const [activityLog, setActivityLog] = useState([]);

    useEffect(() => {
        const fetchActivity = async () => {
            if (!adminProfile?.company) return;
            try {
                const { data, error } = await supabase
                    .from('tickets')
                    .select('id, subject, status, created_at')
                    .eq('company', adminProfile.company)
                    .order('created_at', { ascending: false })
                    .limit(5);
                if (error) throw error;
                const formatted = (data || []).map(t => ({
                    id: t.id,
                    action: `Ticket ${t.status?.toUpperCase() || 'UPDATED'}`,
                    target: `#TKT-${t.id.slice(0, 4)}`,
                    timestamp: new Date(t.created_at).toLocaleString(),
                    status: "Success"
                }));
                setActivityLog(formatted);
            } catch (err) {
                console.error("Failed to fetch activity log:", err);
            }
        };
        fetchActivity();
    }, [adminProfile?.company]);

    const handleImageUpload = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
            const userId = user?.id || adminProfile?.id;
            const fileExt = file.name.split('.').pop();
            const fileName = `${userId}/${Date.now()}.${fileExt}`;
            const { error: uploadError } = await supabase.storage
                .from('profile-pics').upload(fileName, file, { upsert: true, contentType: file.type || 'image/jpeg' });
            if (uploadError) throw uploadError;
            const { data } = supabase.storage.from('profile-pics').getPublicUrl(fileName);
            setProfileForm(prev => ({ ...prev, profile_picture: data?.publicUrl }));
            await supabase.from('profiles').update({ profile_picture: data?.publicUrl }).eq('id', userId);
            await useAuthStore.getState().getProfile(user);
            showToast("Profile picture updated.", "success");
        } catch (err) {
            showToast(`Upload failed: ${err.message}`, "error");
        }
    };

    const handleSaveProfile = async () => {
        try {
            const { error } = await supabase.from('profiles').update({
                full_name: profileForm.name,
                profile_picture: profileForm.profile_picture
            }).eq('id', adminProfile.id);
            if (error) throw error;
            setIsEditingProfile(false);
            await useAuthStore.getState().getProfile(useAuthStore.getState().user);
            showToast("Profile updated successfully.", "success");
        } catch (err) { showToast("Save failed: " + err.message, "error"); }
    };

    const handleDownloadArchive = () => {
        const data = { admin_id: adminProfile.id, email: adminProfile.email, role: adminProfile.role, activity_logs: activityLog };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url;
        a.download = `admin_archive_${adminProfile.id}.json`;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    const handleLogout = async () => {
        await useAuthStore.getState().logout();
    };

    const handlePasswordChange = async () => {
        if (!passwordForm.newPassword || passwordForm.newPassword.length < 6) {
            showToast("Password must be at least 6 characters.", "error"); return;
        }
        if (passwordForm.newPassword !== passwordForm.confirmPassword) {
            showToast("Passwords do not match", "error"); return;
        }
        setPasswordLoading(true);
        try {
            const { error } = await supabase.auth.updateUser({ password: passwordForm.newPassword });
            if (error) throw error;
            showToast("Password updated successfully", "success");
            setShowPasswordModal(false);
            setPasswordForm({ newPassword: '', confirmPassword: '' });
        } catch (err) { showToast("Failed: " + err.message, "error"); }
        finally { setPasswordLoading(false); }
    };

    const cs = { card: { background: '#fff', borderRadius: '24px', border: '1px solid #f0fdf4', boxShadow: '0 4px 24px rgba(0,0,0,0.06)', padding: '36px 40px' } };

    return (
        <div style={{ background: '#f8faf9', minHeight: '100vh', paddingBottom: '60px' }} className="max-w-6xl mx-auto py-6 space-y-10 -m-6 p-6 md:-m-10 md:p-10 animate-in fade-in duration-700">
            {/* 1. Profile Hero */}
            <div style={cs.card} className="flex flex-col md:flex-row items-center md:items-start gap-10 relative overflow-hidden">
                <div className="relative group shrink-0">
                    <div style={{ width: 140, height: 140, borderRadius: '50%', border: '3px solid #bbf7d0', boxShadow: '0 0 0 6px rgba(34,160,69,0.08)', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f0fdf4', fontSize: '48px', fontWeight: 800, color: '#16a34a' }}>
                        {isEditingProfile && profileForm.profile_picture ? (
                            <img src={profileForm.profile_picture} alt="Profile" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        ) : adminProfile?.profile_picture ? (
                            <img src={adminProfile.profile_picture} alt="Profile" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        ) : (
                            isEditingProfile ? (profileForm.name?.charAt(0) || '?') : (adminProfile?.full_name?.charAt(0) || '?')
                        )}
                    </div>
                    {isEditingProfile && (
                        <>
                            <input type="file" ref={fileInputRef} onChange={handleImageUpload} className="hidden" accept="image/*" />
                            <button onClick={() => fileInputRef.current?.click()} style={{ position: 'absolute', bottom: -4, right: -4, background: '#fff', border: '1.5px solid #d1fae5', borderRadius: '12px', padding: '8px', cursor: 'pointer', color: '#15803d', boxShadow: '0 2px 8px rgba(0,0,0,0.08)', zIndex: 20 }}>
                                <Camera size={18} />
                            </button>
                        </>
                    )}
                </div>

                <div className="space-y-6 flex-1 text-center md:text-left">
                    <div className="flex flex-col md:flex-row md:justify-between md:items-start gap-4">
                        <div className="flex-1">
                            {!isEditingProfile ? (
                                <>
                                    <h1 style={{ fontFamily: 'Syne, sans-serif', fontSize: '26px', fontWeight: 800, color: '#0f1f12', letterSpacing: '-0.02em', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px' }}>
                                        {adminProfile?.full_name || 'Admin Agent'}
                                        <span style={{ background: 'linear-gradient(135deg, #16a34a, #22c55e)', color: '#fff', borderRadius: '100px', fontSize: '11px', fontWeight: 700, letterSpacing: '0.08em', padding: '6px 16px', textTransform: 'uppercase' }}>
                                            {adminProfile?.role === 'master_admin' ? 'Master Admin' : 'Admin'}
                                        </span>
                                    </h1>
                                    <p style={{ color: '#9ca3af', fontSize: '11px', fontFamily: 'monospace', marginTop: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }} className="md:justify-start">
                                        <ShieldCheck size={14} color="#16a34a" /> User ID: {adminProfile?.id}
                                    </p>
                                </>
                            ) : (
                                <div className="space-y-4 max-w-sm mx-auto md:mx-0">
                                    <input type="text" value={profileForm.name} onChange={(e) => setProfileForm({ ...profileForm, name: e.target.value })} className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-lg font-bold focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all outline-none" placeholder="Admin Name" />
                                    <div className="flex items-center justify-between gap-3 bg-emerald-50/70 border border-emerald-200 rounded-xl px-4 py-2.5">
                                        <span className="text-xs font-mono text-slate-700 truncate">{adminProfile?.email}</span>
                                        <button type="button" onClick={() => setShowEmailModal(true)} className="text-xs font-bold text-emerald-700 hover:text-emerald-900 underline shrink-0 cursor-pointer">
                                            Change &amp; Verify
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                        <div className="flex flex-wrap shrink-0 justify-center gap-2.5">
                            {!isEditingProfile ? (
                                <>
                                    <button onClick={() => setShowEmailModal(true)}
                                        style={{ background: 'linear-gradient(135deg, #16a34a, #22c55e)', border: 'none', color: '#fff', borderRadius: '10px', fontWeight: 600, fontSize: '13px', padding: '10px 18px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', boxShadow: '0 4px 12px rgba(22,163,74,0.25)' }}>
                                        <Mail size={15} /> Change Email
                                    </button>
                                    <button onClick={() => { setProfileForm({ name: adminProfile?.full_name || '', email: adminProfile?.email || '', profile_picture: adminProfile?.profile_picture }); setIsEditingProfile(true); }}
                                        style={{ background: '#fff', border: '1.5px solid #d1fae5', color: '#15803d', borderRadius: '10px', fontWeight: 600, fontSize: '13px', padding: '10px 20px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', transition: 'all 0.2s' }}>
                                        <Edit2 size={15} /> Edit Profile
                                    </button>
                                </>
                            ) : (
                                <div className="flex items-center gap-3">
                                    <button onClick={() => setIsEditingProfile(false)} style={{ background: '#f3f4f6', color: '#6b7280', border: 'none', borderRadius: '10px', fontWeight: 600, fontSize: '13px', padding: '10px 20px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                        <X size={15} /> Cancel
                                    </button>
                                    <button onClick={handleSaveProfile} style={{ background: 'linear-gradient(135deg, #16a34a, #22c55e)', color: '#fff', border: 'none', borderRadius: '10px', fontWeight: 600, fontSize: '13px', padding: '10px 20px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', boxShadow: '0 4px 12px rgba(22,163,74,0.3)' }}>
                                        <Save size={15} /> Save Changes
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        {[
                            { label: 'Email Address', val: adminProfile?.email },
                            { label: 'Company', val: adminProfile?.company || 'Universal Hub' },
                            { label: 'Last Login', val: user?.last_sign_in_at ? new Date(user.last_sign_in_at).toLocaleString() : 'Just Now' }
                        ].map((m, i) => (
                            <div key={i} style={{ padding: '16px', background: '#f8faf9', border: '1px solid #f0fdf4', borderRadius: '14px' }}>
                                <label style={{ fontSize: '10px', letterSpacing: '0.12em', color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase', display: 'block', marginBottom: '4px' }}>{m.label}</label>
                                <span style={{ color: '#111827', fontWeight: 500, fontSize: '14px' }}>{m.val}</span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
                {/* 2. Security */}
                <div className="lg:col-span-5 space-y-10">
                    <div style={{ background: '#fff', borderRadius: '20px', border: '1px solid #f0fdf4', boxShadow: '0 2px 16px rgba(0,0,0,0.05)', overflow: 'hidden' }}>
                        <div style={{ background: '#0f1f12', padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <h3 style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, color: '#fff', fontSize: '15px', display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
                                <Lock size={16} color="#22c55e" /> SECURITY SETTINGS
                            </h3>
                            <Shield size={16} color="#22c55e" style={{ opacity: 0.5 }} />
                        </div>
                        <div style={{ padding: '32px' }} className="space-y-8">
                            {/* Verified Email Change */}
                            <div style={{ background: '#f8faf9', borderRadius: '14px', border: '1px solid #e5e7eb', padding: '20px' }} className="space-y-4">
                                <h4 style={{ fontSize: '11px', fontWeight: 700, color: '#111827', letterSpacing: '0.1em', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <Mail size={14} color="#16a34a" /> Verified Email / Gmail
                                </h4>
                                <p style={{ fontSize: '12px', color: '#6b7280' }}>Switch your company admin Gmail address with 6-digit OTP and link verification.</p>
                                <button onClick={() => setShowEmailModal(true)} style={{ width: '100%', padding: '12px', background: '#fff', border: '1.5px solid #d1fae5', color: '#15803d', borderRadius: '10px', fontWeight: 600, fontSize: '13px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', transition: 'all 0.2s' }}>
                                    <Mail size={14} /> Change &amp; Verify Email
                                </button>
                            </div>
                            {/* Password */}
                            <div style={{ background: '#f8faf9', borderRadius: '14px', border: '1px solid #e5e7eb', padding: '20px' }} className="space-y-4">
                                <h4 style={{ fontSize: '11px', fontWeight: 700, color: '#111827', letterSpacing: '0.1em', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <Key size={14} color="#16a34a" /> Password
                                </h4>
                                <p style={{ fontSize: '12px', color: '#6b7280' }}>Update your administrative password to keep your account secure.</p>
                                <button onClick={() => setShowPasswordModal(true)} style={{ width: '100%', padding: '12px', background: '#fff', border: '1.5px solid #d1fae5', color: '#15803d', borderRadius: '10px', fontWeight: 600, fontSize: '13px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', transition: 'all 0.2s' }}>
                                    <Edit2 size={14} /> Change Password
                                </button>
                            </div>
                            {/* 2FA */}
                            <div style={{ background: '#f8faf9', borderRadius: '14px', border: '1px solid #e5e7eb', padding: '20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px' }}>
                                <div className="space-y-1 flex-1">
                                    <h4 style={{ fontSize: '11px', fontWeight: 700, color: '#111827', letterSpacing: '0.1em', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        <Smartphone size={14} color="#16a34a" /> Two-Factor Authentication (2FA)
                                    </h4>
                                    <p style={{ fontSize: '11px', color: '#6b7280' }}>Enforce extra verification for secure admin actions.</p>
                                </div>
                                <button onClick={() => setIsAdmin2FAEnabled(!isAdmin2FAEnabled)} style={{ width: '52px', height: '28px', borderRadius: '100px', position: 'relative', transition: 'all 0.4s', background: isAdmin2FAEnabled ? '#22c55e' : '#d1d5db', border: 'none', cursor: 'pointer', flexShrink: 0 }}>
                                    <div style={{ position: 'absolute', top: '2px', width: '24px', height: '24px', background: '#fff', borderRadius: '50%', transition: 'all 0.4s', boxShadow: '0 1px 3px rgba(0,0,0,0.15)', left: isAdmin2FAEnabled ? '26px' : '2px' }}></div>
                                </button>
                            </div>
                            {/* Bug Report */}
                            <div style={{ border: '1px solid #fee2e2', background: '#fff5f5', borderRadius: '14px', padding: '20px' }} className="space-y-4">
                                <h4 style={{ fontSize: '11px', fontWeight: 700, color: '#991b1b', letterSpacing: '0.1em', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <AlertCircle size={14} color="#dc2626" /> Bug Report
                                </h4>
                                <p style={{ fontSize: '11px', color: '#6b7280' }}>Submit a detailed system bug report with attachments.</p>
                                <BugReportWidget advanced={true} customTrigger={
                                    <button style={{ width: '100%', padding: '12px', background: '#fff', border: '1.5px solid #fecaca', color: '#dc2626', borderRadius: '10px', fontWeight: 600, fontSize: '13px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                                        <AlertCircle size={14} /> Report Bug
                                    </button>
                                } />
                            </div>

                            <button onClick={handleLogout} style={{ width: '100%', padding: '14px', background: '#fff5f5', border: '1.5px solid #fecaca', color: '#dc2626', borderRadius: '12px', fontWeight: 600, fontSize: '13px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', transition: 'all 0.2s', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                                <LogOut size={16} /> Logout
                            </button>
                        </div>
                    </div>
                </div>

                {/* 3. Activity Audit */}
                <div className="lg:col-span-7">
                    <div style={{ background: '#fff', borderRadius: '20px', border: '1px solid #f0fdf4', boxShadow: '0 2px 16px rgba(0,0,0,0.05)', overflow: 'hidden', height: '100%', display: 'flex', flexDirection: 'column' }}>
                        <div style={{ padding: '20px 28px', borderBottom: '1px solid #f0fdf4', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <h3 style={{ fontFamily: 'Syne, sans-serif', fontSize: '15px', fontWeight: 700, color: '#0f1f12', display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
                                <History size={18} color="#16a34a" /> ACTIVITY LOG
                            </h3>
                            <button onClick={handleDownloadArchive} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 14px', background: '#fff', border: '1.5px solid #d1fae5', color: '#15803d', borderRadius: '10px', fontSize: '11px', fontWeight: 600, cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                                <Download size={13} /> Download Log
                            </button>
                        </div>
                        <div className="flex-1 overflow-x-auto">
                            <table className="w-full border-collapse">
                                <thead>
                                    <tr style={{ background: '#f8faf9' }}>
                                        {['Action', 'Target', 'Time', 'Status'].map((h, i) => (
                                            <th key={i} style={{ padding: '14px 24px', textAlign: i === 3 ? 'center' : 'left', fontSize: '10px', color: '#9ca3af', letterSpacing: '0.1em', fontWeight: 600, textTransform: 'uppercase' }}>{h}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {activityLog.map((log) => (
                                        <tr key={log.id} className="hover:bg-[#f0fdf4] transition-colors">
                                            <td style={{ padding: '16px 24px', fontSize: '13px', fontWeight: 600, color: '#111827' }}>{log.action}</td>
                                            <td style={{ padding: '16px 24px' }}>
                                                <span style={{ fontFamily: 'monospace', fontSize: '11px', fontWeight: 700, color: '#16a34a', background: '#f0fdf4', padding: '4px 8px', borderRadius: '6px' }}>{log.target}</span>
                                            </td>
                                            <td style={{ padding: '16px 24px', fontSize: '11px', color: '#6b7280' }}>{log.timestamp}</td>
                                            <td style={{ padding: '16px 24px', textAlign: 'center' }}>
                                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', background: '#dcfce7', color: '#15803d', borderRadius: '100px', padding: '4px 10px', fontSize: '10px', fontWeight: 700 }}>
                                                    <CheckCircle2 size={12} /> {log.status}
                                                </span>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <div style={{ padding: '24px', textAlign: 'center', background: '#f8faf9' }}>
                            <p style={{ fontSize: '10px', color: '#9ca3af', letterSpacing: '0.14em', fontWeight: 600 }}>End of Activity Log</p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Password Modal */}
            {showPasswordModal && (
                <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[100] flex items-center justify-center p-6 animate-in fade-in duration-300">
                    <div style={{ background: '#fff', borderRadius: '20px', boxShadow: '0 25px 50px rgba(0,0,0,0.15)', overflow: 'hidden', width: '100%', maxWidth: '400px' }} className="animate-in zoom-in-95 duration-300">
                        <div style={{ background: '#0f1f12', padding: '20px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <h3 style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, color: '#fff', fontSize: '16px', margin: 0 }}>Update Password</h3>
                            <button onClick={() => setShowPasswordModal(false)} style={{ color: '#9ca3af', background: 'none', border: 'none', cursor: 'pointer' }}><X size={20} /></button>
                        </div>
                        <div style={{ padding: '28px' }} className="space-y-5">
                            {[{ label: 'New Password', key: 'newPassword', ph: 'Enter new password' }, { label: 'Confirm Password', key: 'confirmPassword', ph: 'Confirm password' }].map((f, i) => (
                                <div key={i} className="space-y-1.5">
                                    <label style={{ fontSize: '10px', fontWeight: 600, color: '#9ca3af', letterSpacing: '0.1em', textTransform: 'uppercase' }}>{f.label}</label>
                                    <input type="password" placeholder={f.ph} className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all outline-none"
                                        value={passwordForm[f.key]} onChange={(e) => setPasswordForm({ ...passwordForm, [f.key]: e.target.value })} />
                                </div>
                            ))}
                            <button onClick={handlePasswordChange} disabled={passwordLoading}
                                style={{ width: '100%', padding: '14px', background: 'linear-gradient(135deg, #16a34a, #22c55e)', color: '#fff', border: 'none', borderRadius: '12px', fontWeight: 600, fontSize: '13px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', boxShadow: '0 4px 12px rgba(22,163,74,0.3)' }}>
                                {passwordLoading ? 'Updating...' : <><Save size={15} /> Update Password</>}
                            </button>
                        </div>
                    </div>
                </div>
            )}
            <EmailChangeModal
                isOpen={showEmailModal}
                onClose={() => setShowEmailModal(false)}
                currentEmail={adminProfile?.email}
            />
        </div>
    );
};

export default AdminProfile;
