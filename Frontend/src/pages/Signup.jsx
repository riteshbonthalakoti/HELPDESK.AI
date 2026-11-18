import { useState, useEffect, useRef } from "react";
import { useNavigate, Link } from "react-router-dom";
import useAuthStore from "../store/authStore";
import { supabase } from "../lib/supabaseClient";
import { Eye, EyeOff, BrainCircuit, ArrowRight, Loader2, CheckCircle2, ChevronDown, Search, Building2, ArrowLeft } from "lucide-react";

function Signup() {
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // Company Dropdown state
  const [companies, setCompanies] = useState([]);
  const [filteredCompanies, setFilteredCompanies] = useState([]);
  const [selectedCompany, setSelectedCompany] = useState(null);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [companySearch, setCompanySearch] = useState("");
  const [isLoadingCompanies, setIsLoadingCompanies] = useState(true);

  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const dropdownRef = useRef(null);
  const navigate = useNavigate();
  const { signup, user, profile } = useAuthStore();

  // Fetch and subscribe to companies
  useEffect(() => {
    const fetchCompanies = async () => {
      setIsLoadingCompanies(true);
      const { data, error } = await supabase
        .from('companies')
        .select('id, name')
        .eq('status', 'active')
        .eq('name', 'RITESH PVT LTD')
        .order('name');

      if (data) {
        setCompanies(data);
        setFilteredCompanies(data);
        if (data.length === 1) {
          setSelectedCompany(data[0]);
        }
      }
      if (error) console.error("Error fetching companies:", error);
      setIsLoadingCompanies(false);
    };

    fetchCompanies();

    // Realtime subscription for companies
    const channel = supabase
      .channel('public:companies')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'companies' },
        () => {
          fetchCompanies(); // Refetch on any change
        }
      )
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, []);

  // Handle clicks outside dropdown
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Filter companies
  useEffect(() => {
    if (companySearch.trim() === "") {
      setFilteredCompanies(companies);
    } else {
      const lowerSearch = companySearch.toLowerCase();
      setFilteredCompanies(
        companies.filter((c) => c.name.toLowerCase().includes(lowerSearch))
      );
    }
  }, [companySearch, companies]);

  // Redirect if already logged in and active
  useEffect(() => {
    if (user && profile) {
      if (profile.role === 'admin' || profile.role === 'super_admin') {
        navigate("/admin/dashboard");
      } else if (profile.status === "active") {
        navigate("/dashboard");
      } else if (profile.status === "pending_approval") {
        navigate("/user-lobby");
      }
    }
  }, [user, profile, navigate]);

  const handleSignup = async (e) => {
    e.preventDefault();
    setError("");

    // Password complexity validator — mirrors Supabase's policy
    const validatePassword = (pw) => {
      if (pw.length < 8) return 'Password must be at least 8 characters long.';
      if (!/[a-z]/.test(pw)) return 'Password must contain at least one lowercase letter (a-z).';
      if (!/[A-Z]/.test(pw)) return 'Password must contain at least one uppercase letter (A-Z).';
      if (!/[0-9]/.test(pw)) return 'Password must contain at least one number (0-9).';
      return null;
    };

    if (!email || !password || !confirmPassword || !fullName) {
      setError("All fields are required.");
      return;
    }

    if (!selectedCompany) {
      setError("Please select your company.");
      return;
    }

    const pwError = validatePassword(password);
    if (pwError) {
      setError(pwError);
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setIsSubmitting(true);

    try {
      // Step 1: Signup with Auth (triggers verification email)
      // We pass the company name as metadata so the profile trigger has some info, 
      // but we'll manually ensure the proper company_id is set or linked.
      // Wait, we need to pass company ID so the trigger can use it? 
      // Since auth.signUp metadata is flexible, let's pass company_id.

      const newUser = await signup(
        email,
        password,
        fullName,
        'user',
        selectedCompany.name,
        {
          company_id: selectedCompany.id
        },
        window.location.origin + '/login'
      );

      if (newUser) {
        // Check if email confirmation was skipped
        const updatedProfile = useAuthStore.getState().profile;
        if (updatedProfile?.status === 'pending_approval') {
          // Email was auto-verified, go straight to lobby
          navigate('/user-lobby');
        } else {
          // Show success screen in-place (no redirect)
          setSuccessMsg(`📧 Check your email! We sent a verification link to ${email}. After verifying your email, your request will be reviewed by your company admin.`);
        }
      }

    } catch (err) {
      console.error("Signup component error:", err);
      let errMsg = err.message || "Signup failed. Please try again.";
      if (errMsg.toLowerCase().includes("failed to fetch")) {
        errMsg = "Network Error: Failed to fetch. This usually happens if your browser's ad-blocker (like Brave Shields, uBlock Origin, etc.) is blocking Supabase requests. Please try disabling your ad-blocker for this site and refresh!";
      }
      setError(errMsg);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Render Success State
  if (successMsg) {
    return (
      <div
        className="min-h-screen flex items-center justify-center relative overflow-hidden p-6"
        style={{ fontFamily: "'Inter', sans-serif", background: 'linear-gradient(160deg, #f0fdf4 0%, #dcfce7 60%, #bbf7d0 100%)' }}
      >
        <div
          className="absolute top-0 left-0 w-[600px] h-[600px] rounded-full pointer-events-none"
          style={{ background: 'radial-gradient(circle, rgba(34,160,69,0.12) 0%, transparent 70%)' }}
        />
        <div className="w-full max-w-md bg-white rounded-3xl p-8 relative z-10 text-center" style={{ boxShadow: '0 8px 40px rgba(0,0,0,0.08)', border: '1px solid #f0fdf4' }}>
          <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6" style={{ background: '#f0fdf4', border: '1px solid #d1fae5' }}>
            <CheckCircle2 className="w-8 h-8" style={{ color: '#16a34a' }} />
          </div>
          <h2 style={{ fontFamily: "'Syne', sans-serif", fontSize: '24px', fontWeight: 800, color: '#0f1f12', marginBottom: '16px' }}>Registration Successful</h2>
          <p style={{ color: '#374151', fontSize: '14px', lineHeight: 1.7, marginBottom: '32px' }}>{successMsg}</p>
          <Link
            to="/login"
            className="inline-flex items-center justify-center w-full px-6 py-3.5 rounded-xl transition-all"
            style={{ background: 'linear-gradient(135deg, #16a34a, #22c55e)', color: '#ffffff', fontWeight: 600, fontSize: '15px', boxShadow: '0 4px 20px rgba(34,160,69,0.3)' }}
          >
            Return to Login
          </Link>
        </div>
      </div>
    );
  }

  const inputStyle = {
    width: '100%', background: '#f9fafb', border: '1.5px solid #e5e7eb', borderRadius: '12px',
    padding: '13px 16px', fontSize: '15px', color: '#111827', outline: 'none',
    transition: 'border-color 0.2s, box-shadow 0.2s',
  };
  const inputFocus = (e) => { e.target.style.borderColor = '#22c55e'; e.target.style.boxShadow = '0 0 0 3px rgba(34,160,69,0.1)'; };
  const inputBlur = (e) => { e.target.style.borderColor = '#e5e7eb'; e.target.style.boxShadow = 'none'; };
  const labelStyle = { fontSize: '12px', fontWeight: 600, color: '#374151', letterSpacing: '0.05em', textTransform: 'uppercase' };

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden p-6 py-12" style={{ fontFamily: "'Inter', sans-serif", background: 'linear-gradient(160deg, #f0fdf4 0%, #dcfce7 60%, #bbf7d0 100%)' }}>
      <div className="absolute top-0 left-0 w-[600px] h-[600px] rounded-full pointer-events-none" style={{ background: 'radial-gradient(circle, rgba(34,160,69,0.12) 0%, transparent 70%)' }} />

      {/* Back Button */}
      <Link
        to="/"
        className="absolute top-8 left-8 flex items-center gap-2 transition-all group"
        style={{ color: '#374151', fontWeight: 500, fontSize: '14px' }}
        onMouseEnter={(e) => e.currentTarget.style.color = '#16a34a'}
        onMouseLeave={(e) => e.currentTarget.style.color = '#374151'}
      >
        <div className="p-2 rounded-full transition-all" style={{ background: '#ffffff', border: '1px solid #e5e7eb' }}>
          <ArrowLeft className="w-4 h-4" />
        </div>
        <span>Back to Home</span>
      </Link>

      <div className="w-full max-w-md relative z-10">

        {/* Logo Header */}
        <div className="flex justify-center mb-8">
          <Link to="/" className="flex items-center gap-2 px-4 py-2 rounded-full transition" style={{ background: 'rgba(34,160,69,0.08)', border: '1px solid #d1fae5' }}>
            <BrainCircuit className="w-5 h-5" style={{ color: '#16a34a' }} />
            <span style={{ fontWeight: 800, fontSize: '18px', color: '#0f1f12' }}>HelpDesk.ai</span>
          </Link>
        </div>

        <div className="bg-white rounded-3xl p-6 sm:p-8" style={{ boxShadow: '0 8px 40px rgba(0,0,0,0.08)', border: '1px solid #f0fdf4' }}>
          <div className="text-center" style={{ marginBottom: '32px' }}>
            <h2 style={{ fontFamily: "'Syne', sans-serif", fontSize: '28px', fontWeight: 800, color: '#0f1f12', letterSpacing: '-0.02em', marginBottom: '8px' }}>Create Account</h2>
            <p style={{ color: '#6b7280', fontSize: '14px' }}>Start automating your IT support today</p>
          </div>

          {error && (
            <div className="mb-6 flex items-start gap-3" style={{ background: '#fef2f2', border: '1px solid #fee2e2', borderRadius: '12px', padding: '14px 16px' }}>
              <div className="rounded-full p-1 mt-0.5" style={{ background: '#fee2e2' }}><ArrowRight className="w-3 h-3 text-red-600 rotate-45" /></div>
              <p className="text-sm font-medium" style={{ color: '#b91c1c' }}>{error}</p>
            </div>
          )}

          <form onSubmit={handleSignup} className="space-y-5">
            {/* Company Dropdown */}
            <div className="relative" ref={dropdownRef}>
              <label className="block mb-2" style={labelStyle}>Company</label>
              <div onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                style={{ ...inputStyle, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderColor: isDropdownOpen ? '#22c55e' : '#e5e7eb', boxShadow: isDropdownOpen ? '0 0 0 3px rgba(34,160,69,0.1)' : 'none' }}>
                {selectedCompany ? (
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0" style={{ background: '#f0fdf4' }}><Building2 className="w-3.5 h-3.5" style={{ color: '#16a34a' }} /></div>
                    <span style={{ fontWeight: 600, color: '#111827' }}>{selectedCompany.name}</span>
                  </div>
                ) : (<span style={{ color: '#9ca3af', fontWeight: 500 }}>Select your company...</span>)}
                <ChevronDown className={`w-5 h-5 transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`} style={{ color: '#9ca3af' }} />
              </div>

              {isDropdownOpen && (
                <div className="absolute z-50 top-full left-0 right-0 mt-2 bg-white overflow-hidden" style={{ borderRadius: '12px', border: '1px solid #e5e7eb', boxShadow: '0 8px 30px rgba(0,0,0,0.1)' }}>
                  <div className="p-2 flex items-center gap-2" style={{ borderBottom: '1px solid #f3f4f6', background: '#f9fafb' }}>
                    <Search className="w-4 h-4 ml-2" style={{ color: '#9ca3af' }} />
                    <input type="text" placeholder="Search companies..." style={{ width: '100%', background: 'transparent', border: 'none', outline: 'none', fontSize: '14px', padding: '4px 0', color: '#111827' }}
                      value={companySearch} onChange={(e) => setCompanySearch(e.target.value)} onClick={(e) => e.stopPropagation()} />
                  </div>
                  <div className="max-h-60 overflow-y-auto p-1">
                    {isLoadingCompanies ? (
                      <div className="py-6 flex flex-col items-center justify-center gap-2 opacity-50">
                        <div className="w-5 h-5 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: '#22c55e', borderTopColor: 'transparent' }}></div>
                        <span style={{ fontSize: '12px', fontWeight: 600, color: '#9ca3af' }}>Loading companies...</span>
                      </div>
                    ) : filteredCompanies.length > 0 ? (
                      filteredCompanies.map((c) => (
                        <div key={c.id} onClick={() => { setSelectedCompany(c); setIsDropdownOpen(false); setCompanySearch(""); }}
                          className="px-3 py-2.5 rounded-lg cursor-pointer flex items-center gap-3 transition-colors hover:bg-green-50 group">
                          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ border: '1px solid #e5e7eb', background: '#fff' }}>
                            <Building2 className="w-4 h-4 transition-colors" style={{ color: '#9ca3af' }} />
                          </div>
                          <span style={{ fontWeight: 600, color: '#374151' }}>{c.name}</span>
                        </div>
                      ))
                    ) : (
                      <div className="px-4 py-6 text-center rounded-lg mx-1 my-1" style={{ fontSize: '14px', fontWeight: 500, color: '#6b7280', background: '#f9fafb', border: '1px dashed #e5e7eb' }}>
                        No companies found.<br />
                        <span style={{ fontSize: '12px', color: '#9ca3af', marginTop: '4px', display: 'block', fontWeight: 400 }}>Ask your IT Admin to register your company first.</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Full Name */}
            <div>
              <label className="block mb-2" style={labelStyle}>Full Name</label>
              <input type="text" placeholder="Enter your name" style={inputStyle} onFocus={inputFocus} onBlur={inputBlur}
                value={fullName} onChange={(e) => { setFullName(e.target.value); setError(""); }} />
            </div>

            {/* Email */}
            <div>
              <label className="block mb-2" style={labelStyle}>Email Address</label>
              <input type="email" placeholder="Enter your system email" style={inputStyle} onFocus={inputFocus} onBlur={inputBlur}
                value={email} onChange={(e) => { setEmail(e.target.value); setError(""); }} />
            </div>

            {/* Passwords */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="relative">
                <label className="block mb-2" style={labelStyle}>Password</label>
                <div className="relative">
                  <input type={showPassword ? "text" : "password"} placeholder="Min 8 chars" style={{ ...inputStyle, paddingRight: '44px' }} onFocus={inputFocus} onBlur={inputBlur}
                    value={password} onChange={(e) => { setPassword(e.target.value); setError(""); }} />
                  <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2" style={{ color: '#9ca3af', background: 'none', border: 'none', cursor: 'pointer' }}>
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {/* Live password requirement checklist */}
                {password && (
                  <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 mt-2">
                    {[
                      { label: '8+ characters', ok: password.length >= 8 },
                      { label: 'Uppercase (A-Z)', ok: /[A-Z]/.test(password) },
                      { label: 'Lowercase (a-z)', ok: /[a-z]/.test(password) },
                      { label: 'Number (0-9)', ok: /[0-9]/.test(password) },
                    ].map(({ label, ok }) => (
                      <span key={label} className={`text-[10px] font-semibold flex items-center gap-1 transition-colors ${
                        ok ? 'text-emerald-600' : 'text-red-400'
                      }`}>
                        <span>{ok ? '✓' : '○'}</span> {label}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className="relative">
                <label className="block mb-2" style={labelStyle}>Confirm</label>
                <div className="relative">
                  <input type={showConfirmPassword ? "text" : "password"} placeholder="Repeat" style={{ ...inputStyle, paddingRight: '44px' }} onFocus={inputFocus} onBlur={inputBlur}
                    value={confirmPassword} onChange={(e) => { setConfirmPassword(e.target.value); setError(""); }} />
                  <button type="button" onClick={() => setShowConfirmPassword(!showConfirmPassword)} className="absolute right-3 top-1/2 -translate-y-1/2" style={{ color: '#9ca3af', background: 'none', border: 'none', cursor: 'pointer' }}>
                    {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </div>

            {/* Submit */}
            <button type="submit" disabled={isSubmitting}
              className="w-full flex items-center justify-center gap-2 active:scale-[0.98] disabled:opacity-70 disabled:cursor-not-allowed"
              style={{ background: 'linear-gradient(135deg, #16a34a, #22c55e)', color: '#fff', borderRadius: '12px', padding: '14px', fontWeight: 600, fontSize: '15px', border: 'none', cursor: 'pointer', boxShadow: '0 4px 20px rgba(34,160,69,0.3)', transition: 'transform 0.2s, box-shadow 0.2s', marginTop: '8px' }}
              onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 6px 24px rgba(34,160,69,0.35)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 4px 20px rgba(34,160,69,0.3)'; }}>
              {isSubmitting ? <Loader2 className="w-5 h-5 animate-spin" /> : null}
              {isSubmitting ? "Creating Profile..." : "Submit Registration"}
            </button>

            <p className="text-center" style={{ fontSize: '14px', color: '#6b7280', marginTop: '24px' }}>
              Already have an account?{" "}
              <Link to="/login" className="hover:underline transition-all" style={{ color: '#16a34a', fontWeight: 600 }}>Login here</Link>
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}

export default Signup;
