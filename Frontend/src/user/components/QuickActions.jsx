import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Network, Laptop, ShieldCheck, ChevronRight } from 'lucide-react';

const actions = [
    {
        title: "Network Issues",
        description: "Connectivity problems, VPN access, and slow internet.",
        category: "Network",
        icon: Network,
        iconBg: 'bg-emerald-50',
        iconColor: 'text-emerald-600',
        accentRing: 'group-hover:border-emerald-300',
    },
    {
        title: "Software Problems",
        description: "Application crashes, license issues, and installations.",
        category: "Software",
        icon: Laptop,
        iconBg: 'bg-indigo-50',
        iconColor: 'text-indigo-600',
        accentRing: 'group-hover:border-indigo-300',
    },
    {
        title: "Access Requests",
        description: "Permission changes, new account setup, and MFA.",
        category: "Access",
        icon: ShieldCheck,
        iconBg: 'bg-violet-50',
        iconColor: 'text-violet-600',
        accentRing: 'group-hover:border-violet-300',
    }
];

const QuickActions = () => {
    const navigate = useNavigate();

    const handleActionClick = (category) => {
        navigate('/create-ticket', { state: { prefilledCategory: category } });
    };

    return (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 sm:gap-4 md:gap-6">
            {actions.map((action, index) => (
                <button
                    type="button"
                    key={index}
                    onClick={() => handleActionClick(action.category)}
                    className={`group text-left bg-white rounded-2xl md:rounded-[20px] border border-emerald-950/[0.06] ${action.accentRing} shadow-xs hover:shadow-lg p-4 md:p-7 cursor-pointer transition-all duration-200 active:scale-[0.98] md:hover:-translate-y-1 flex md:flex-col items-center md:items-start gap-3.5 md:gap-0`}
                >
                    <div
                        className={`w-11 h-11 md:w-12 md:h-12 rounded-2xl ${action.iconBg} ${action.iconColor} flex items-center justify-center shrink-0 md:mb-4 transition-transform group-hover:scale-105`}
                    >
                        <action.icon size={22} />
                    </div>

                    <div className="flex-1 min-w-0">
                        <h3 className="text-[15px] md:text-[17px] font-bold text-slate-900 md:mb-2 truncate">
                            {action.title}
                        </h3>
                        <p className="text-xs md:text-sm text-slate-500 leading-snug md:leading-relaxed line-clamp-2 md:mb-5">
                            {action.description}
                        </p>
                    </div>

                    <div className="md:hidden w-8 h-8 rounded-full bg-slate-50 text-slate-400 group-hover:text-emerald-600 flex items-center justify-center shrink-0">
                        <ChevronRight size={16} />
                    </div>

                    <div className="hidden md:flex items-center gap-1.5 text-emerald-600 font-semibold text-[13px]">
                        Start Request →
                    </div>
                </button>
            ))}
        </div>
    );
};

export default QuickActions;
