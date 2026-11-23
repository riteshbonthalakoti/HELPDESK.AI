
import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Activity,
    CheckCircle,
    AlertTriangle,
    ArrowLeft,
    RefreshCw,
    WifiOff,
    Clock3,
    CircleHelp
} from 'lucide-react';
import { Card } from '../components/ui/card';
import { API_CONFIG } from '../config';

const STATUS_CONFIG = {
    operational: {
        label: 'Operational',
        icon: CheckCircle,
        className: 'bg-emerald-50 border-emerald-100 text-emerald-700'
    },
    degraded: {
        label: 'Degraded',
        icon: AlertTriangle,
        className: 'bg-amber-50 border-amber-100 text-amber-700'
    },
    offline: {
        label: 'Offline',
        icon: WifiOff,
        className: 'bg-red-50 border-red-100 text-red-700'
    },
    unknown: {
        label: 'Not Monitored',
        icon: CircleHelp,
        className: 'bg-slate-50 border-slate-200 text-slate-500'
    }
};

export default function StatusPage() {
    const navigate = useNavigate();

    const [isRefreshing, setIsRefreshing] = React.useState(false);
    const [healthData, setHealthData] = React.useState(null);
    const [readinessData, setReadinessData] = React.useState(null);
    const [healthLatency, setHealthLatency] = React.useState(null);
    const [readinessLatency, setReadinessLatency] = React.useState(null);
    const [isOnline, setIsOnline] = React.useState(null);
    const [lastChecked, setLastChecked] = React.useState(null);
    const [error, setError] = React.useState('');

    const fetchEndpoint = async (endpoint) => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        const startTime = performance.now();

        try {
            const response = await fetch(
                `${API_CONFIG.BACKEND_URL}${endpoint}`,
                {
                    method: 'GET',
                    headers: {
                        Accept: 'application/json'
                    },
                    cache: 'no-store',
                    signal: controller.signal
                }
            );

            const latency = Math.round(performance.now() - startTime);

            // The readiness endpoint uses HTTP 503 to report
            // valid readiness data when the backend is not ready.
            if (
                !response.ok &&
                !(endpoint === '/ready' && response.status === 503)
            ) {
                throw new Error(`${endpoint} returned HTTP ${response.status}`);
            }

            const data = await response.json();

            return { data, latency };
        } finally {
            clearTimeout(timeoutId);
        }
    };

    const handleRefresh = async () => {
        setIsRefreshing(true);
        setError('');

        try {
            // Each probe is handled independently so that one failure
            // does not discard a successful response from the other.
            const [healthResult, readinessResult] = await Promise.allSettled([
                fetchEndpoint('/health'),
                fetchEndpoint('/ready')
            ]);

            const healthSucceeded = healthResult.status === 'fulfilled';
            const readinessSucceeded = readinessResult.status === 'fulfilled';

            // Retain health data only when the health probe succeeds.
            setHealthData(
                healthSucceeded ? healthResult.value.data : null
            );

            setHealthLatency(
                healthSucceeded ? healthResult.value.latency : null
            );

            // Retain readiness data even if the health probe fails.
            setReadinessData(
                readinessSucceeded ? readinessResult.value.data : null
            );

            setReadinessLatency(
                readinessSucceeded ? readinessResult.value.latency : null
            );

            // The backend is reachable if either probe responds.
            setIsOnline(healthSucceeded || readinessSucceeded);

            if (!healthSucceeded && !readinessSucceeded) {
                setError(
                    'Both health and readiness probes failed. The backend may be unavailable.'
                );
            } else if (!healthSucceeded) {
                setError(
                    'Health probe failed, but readiness data is available.'
                );
            } else if (!readinessSucceeded) {
                setError(
                    'Readiness probe failed, but health data is available.'
                );
            }

            setLastChecked(new Date());
        } catch (err) {
            // Handles unexpected errors outside the individual probes.
            console.error('Status check failed:', err);

            setIsOnline(false);
            setHealthData(null);
            setReadinessData(null);
            setHealthLatency(null);
            setReadinessLatency(null);

            setError(
                err.message || 'Unable to retrieve backend status.'
            );

            setLastChecked(new Date());
        } finally {
            setIsRefreshing(false);
        }
    };

    React.useEffect(() => {
        handleRefresh();
    }, []);

    const checks = readinessData?.checks || {};

    const hasSupabaseProbeResult = Object.prototype.hasOwnProperty.call(
        checks,
        'supabase_configured'
    );

    const classifierHealthy = healthData
    ? healthData.classifier_loaded === true
    : checks.classifier_loaded === true;

    const nerHealthy = healthData
    ? healthData.ner_loaded === true
    : checks.ner_loaded === true;

    // The backend determines readiness, including optional checks
    // when degraded startup is enabled.
    const readinessHealthy = readinessData?.status === 'ready';

    const services = [
        {
            name: 'AI Triage Engine (NER & Categorization)',
            status: isOnline === null
                ? 'unknown'
                : !isOnline
                    ? 'offline'
                    : classifierHealthy && nerHealthy
                        ? 'operational'
                        : 'degraded',
            desc: 'Live classifier and named entity recognition health.',
            latency: healthLatency
        },
        {
            name: 'Supabase Data Gateway',
            status: !hasSupabaseProbeResult
                ? 'unknown'
                : isOnline === false
                    ? 'offline'
                    : checks.supabase_configured
                        ? 'operational'
                        : 'degraded',
            desc: 'Database configuration and backend readiness.',
            latency: readinessLatency
        },
        {
            name: 'WebSocket Service',
            status: 'unknown',
            desc: 'No dedicated backend health probe is currently exposed.',
            latency: null
        },
        {
            name: 'Client-Side OCR Processor',
            status: 'unknown',
            desc: 'Browser-side OCR processing is not monitored by backend health endpoints.',
            latency: null
        }
    ];

    const operationalCount = services.filter(
        service => service.status === 'operational'
    ).length;

    const degradedCount = services.filter(
        service => service.status === 'degraded'
    ).length;

    const offlineCount = services.filter(
        service => service.status === 'offline'
    ).length;

    const monitoredCount = services.filter(
        service => service.status !== 'unknown'
    ).length;

    const isFullyOperational =
        isOnline === true &&
        readinessData !== null &&
        readinessHealthy &&
        degradedCount === 0 &&
        offlineCount === 0;

    const isDegraded = isOnline === true && !isFullyOperational;

    const heroStatus = isOnline === null
        ? 'Checking System Status'
        : !isOnline
            ? 'System Offline'
            : isDegraded
                ? 'System Degraded'
                : 'All Systems Operational';

    const heroDescription = isOnline === null
        ? 'Connecting to the backend and retrieving live status.'
        : !isOnline
            ? 'The backend cannot currently be reached. Check your connection and retry.'
            : isDegraded
                ? 'The backend is responding, but one or more subsystem checks are degraded or unavailable.'
                : 'All reported backend readiness checks are passing. Unmonitored services are excluded.';

    const HeroIcon = isOnline === false
        ? WifiOff
        : isDegraded
            ? AlertTriangle
            : isOnline === null
                ? Activity
                : CheckCircle;

    const errorHeading = isOnline === false
        ? 'Backend Unreachable'
        : error.startsWith('Health probe failed')
            ? 'Health Probe Unavailable'
            : 'Readiness Check Unavailable';

    return (
        <div className="min-h-screen bg-[#f6f8f7] pb-20">
            {/* Header */}
            <header className="w-full bg-white border-b border-gray-200 sticky top-0 z-50">
                <div className="max-w-[1100px] mx-auto px-4 md:px-6 h-16 flex items-center justify-between">
                    <div
                        className="flex items-center gap-3 cursor-pointer"
                        onClick={() => navigate('/')}
                    >
                        <img
                            src="/favicon.png"
                            alt="HELPDESK.AI Logo"
                            className="w-7 h-7 object-contain"
                        />

                        <div className="flex items-baseline gap-2">
                            <h1 className="text-xl font-black tracking-tighter text-gray-900 italic">
                                HELPDESK.AI
                            </h1>

                            <span className="px-2 py-0.5 text-[10px] font-black bg-emerald-100 text-emerald-800 rounded-md uppercase tracking-wider">
                                Status
                            </span>
                        </div>
                    </div>

                    <button
                        onClick={() => navigate('/')}
                        className="flex items-center gap-2 text-xs font-bold text-gray-600 hover:text-emerald-600 transition-colors bg-gray-50 hover:bg-emerald-50 px-3.5 py-2 rounded-xl border border-gray-200"
                    >
                        <ArrowLeft size={14} />
                        Back to Home
                    </button>
                </div>
            </header>

            <div className="max-w-[800px] mx-auto px-4 md:px-6 mt-12 space-y-10">
                {/* Hero Banner */}
                <div className={`${
                    isOnline === false
                        ? 'bg-red-950'
                        : isDegraded
                            ? 'bg-amber-950'
                            : 'bg-emerald-950'
                } text-white rounded-[2rem] p-8 md:p-10 shadow-2xl relative overflow-hidden flex flex-col md:flex-row md:items-center justify-between gap-6`}>
                    <div className="absolute -right-10 -top-10 w-44 h-44 bg-white/5 rounded-full blur-3xl" />

                    <div className="space-y-3 z-10">
                        <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full border ${
                            isOnline === false
                                ? 'bg-red-500/20 border-red-500/30 text-red-300'
                                : isDegraded
                                    ? 'bg-amber-500/20 border-amber-500/30 text-amber-300'
                                    : 'bg-emerald-500/20 border-emerald-500/30 text-emerald-300'
                        }`}>
                            <HeroIcon
                                size={13}
                                className={isRefreshing ? 'animate-spin' : ''}
                            />

                            <span className="text-[10px] font-black uppercase tracking-widest">
                                {isOnline === false
                                    ? 'Connection Lost'
                                    : isDegraded
                                        ? 'Degraded Performance'
                                        : isOnline === null
                                            ? 'Connecting'
                                            : 'Live Status Radar'}
                            </span>
                        </div>

                        <h2 className="text-3xl font-black italic tracking-tight">
                            {heroStatus}
                        </h2>

                        <p className="text-slate-300 text-xs font-semibold max-w-md">
                            {heroDescription}
                        </p>

                        <div className="flex flex-wrap items-center gap-4 pt-2 text-[11px] text-slate-400 font-semibold">
                            <span>{monitoredCount} monitored services</span>
                            <span>{operationalCount} operational</span>

                            {degradedCount > 0 && (
                                <span className="text-amber-300">
                                    {degradedCount} degraded
                                </span>
                            )}

                            {offlineCount > 0 && (
                                <span className="text-red-300">
                                    {offlineCount} offline
                                </span>
                            )}
                        </div>
                    </div>

                    <button
                        onClick={handleRefresh}
                        disabled={isRefreshing}
                        className="self-start md:self-auto px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 font-bold text-xs uppercase tracking-wider flex items-center gap-1.5 border border-white/15 transition-all active:scale-95 disabled:opacity-50"
                    >
                        <RefreshCw
                            size={14}
                            className={isRefreshing ? 'animate-spin' : ''}
                        />
                        {isRefreshing ? 'Checking...' : 'Refresh Status'}
                    </button>
                </div>

                {/* Error Notice */}
                {(isOnline === false || error) && (
                    <div className="rounded-2xl border border-red-200 bg-red-50 p-5 flex items-center justify-between gap-4">
                        <div className="flex items-start gap-3">
                            <WifiOff size={20} className="text-red-600 mt-0.5" />

                            <div>
                                <h3 className="text-sm font-black text-red-800">
                                    {errorHeading}
                                </h3>

                                <p className="text-xs mt-1 font-medium text-red-700">
                                    {error}
                                </p>
                            </div>
                        </div>

                        <button
                            onClick={handleRefresh}
                            disabled={isRefreshing}
                            className="shrink-0 px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider bg-red-600 hover:bg-red-700 text-white transition-all disabled:opacity-50"
                        >
                            Retry
                        </button>
                    </div>
                )}

                {/* Service Cards */}
                <div className="space-y-4">
                    <div className="flex items-center justify-between">
                        <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest">
                            Active Services
                        </h3>

                        {lastChecked && (
                            <span className="text-[10px] text-slate-400 font-semibold">
                                Last checked: {lastChecked.toLocaleTimeString()}
                            </span>
                        )}
                    </div>

                    <div className="space-y-3">
                        {services.map((service, idx) => {
                            const config = STATUS_CONFIG[service.status];
                            const StatusIcon = config.icon;

                            return (
                                <Card
                                    key={idx}
                                    className="p-6 rounded-[1.5rem] border border-slate-200/80 bg-white shadow-sm"
                                >
                                    <div className="flex items-center justify-between flex-wrap gap-4">
                                        <div className="space-y-1">
                                            <h4 className="font-extrabold text-slate-900 text-sm">
                                                {service.name}
                                            </h4>

                                            <p className="text-xs text-slate-400 font-semibold">
                                                {service.desc}
                                            </p>
                                        </div>

                                        <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-[10px] font-black uppercase tracking-widest ${config.className}`}>
                                            <StatusIcon size={10} />
                                            {config.label}
                                        </span>
                                    </div>

                                    <div className="flex items-center gap-1.5 mt-5 pt-4 border-t border-slate-100 text-xs">
                                        <Clock3 size={13} className="text-slate-400" />

                                        <span className="text-slate-400 font-semibold">
                                            Response:
                                        </span>

                                        <span className="text-slate-700 font-black">
                                            {service.latency !== null
                                                ? `${service.latency} ms`
                                                : 'N/A'}
                                        </span>
                                    </div>
                                </Card>
                            );
                        })}
                    </div>
                </div>

                {/* Backend Connection */}
                <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
                    <div className="flex items-center gap-2">
                        <Activity size={16} className="text-emerald-600" />

                        <h3 className="text-xs font-black text-slate-800 uppercase tracking-widest">
                            Backend Connection
                        </h3>
                    </div>

                    <div className="space-y-3 text-xs">
                        <div className="flex items-center justify-between gap-3">
                            <span className="text-slate-400 font-semibold">
                                API Endpoint
                            </span>

                            <span className="text-slate-700 font-bold break-all text-right">
                                {API_CONFIG.BACKEND_URL}
                            </span>
                        </div>

                        <div className="flex items-center justify-between">
                            <span className="text-slate-400 font-semibold">
                                Health Probe
                            </span>

                            <span className="text-slate-700 font-bold">
                                {healthLatency !== null
                                    ? `${healthLatency} ms`
                                    : 'N/A'}
                            </span>
                        </div>

                        <div className="flex items-center justify-between">
                            <span className="text-slate-400 font-semibold">
                                Readiness Probe
                            </span>

                            <span className="text-slate-700 font-bold">
                                {readinessLatency !== null
                                    ? `${readinessLatency} ms`
                                    : 'N/A'}
                            </span>
                        </div>

                        <div className="flex items-center justify-between">
                            <span className="text-slate-400 font-semibold">
                                Connection
                            </span>

                            <span className={`font-black ${
                                isOnline === true
                                    ? 'text-emerald-600'
                                    : isOnline === false
                                        ? 'text-red-600'
                                        : 'text-amber-600'
                            }`}>
                                {isOnline === true
                                    ? 'Connected'
                                    : isOnline === false
                                        ? 'Disconnected'
                                        : 'Checking'}
                            </span>
                        </div>
                    </div>

                    {readinessData?.checks && (
                        <div className="pt-3 border-t border-slate-100">
                            <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">
                                Backend Readiness Checks
                            </h4>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                {Object.entries(readinessData.checks).map(([name, healthy]) => (
                                    <div
                                        key={name}
                                        className="flex items-center justify-between gap-2 bg-slate-50 rounded-lg px-3 py-2"
                                    >
                                        <span className="text-xs font-semibold text-slate-600">
                                            {name.replace(/_/g, ' ')}
                                        </span>

                                        <span className={`text-[10px] font-black uppercase ${
                                            healthy ? 'text-emerald-600' : 'text-red-600'
                                        }`}>
                                            {healthy ? 'Passing' : 'Failing'}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                <div className="text-center space-y-2">
                    <p className="text-[10px] text-slate-400 font-semibold">
                        Status information is retrieved directly from the HELPDESK.AI backend.
                    </p>

                    <p className="text-[10px] text-slate-400">
                        Unmonitored services are not assumed to be operational.
                    </p>
                </div>
            </div>
        </div>
    );
}
