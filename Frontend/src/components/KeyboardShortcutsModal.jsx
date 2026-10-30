import React, { useEffect, useRef } from 'react';
import { X, Keyboard, ArrowLeft, MessageSquare, RotateCcw, CornerDownLeft } from 'lucide-react';

const SHORTCUT_ITEMS = [
    {
        category: "Navigation",
        shortcuts: [
            { keys: ["?"], label: "Toggle keyboard shortcuts guide" },
            { keys: ["b"], label: "Go back to My Tickets" },
            { keys: ["Esc"], label: "Close modal / dismiss popup" }
        ]
    },
    {
        category: "Ticket Actions",
        shortcuts: [
            { keys: ["c", "m"], label: "Focus message input box" },
            { keys: ["Ctrl", "Enter"], label: "Send message immediately" },
            { keys: ["r"], label: "Reopen ticket (when resolved)" }
        ]
    }
];

export function KeyboardShortcutsModal({ isOpen, onClose }) {
    const dialogRef = useRef(null);
    const closeBtnRef = useRef(null);

    useEffect(() => {
        if (!isOpen) return;

        // Focus close button on open
        closeBtnRef.current?.focus();

        const handleKeyDown = (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                onClose();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    return (
        <div 
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in duration-200"
            role="presentation"
            onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="shortcuts-dialog-title"
                aria-describedby="shortcuts-dialog-desc"
                className="bg-white rounded-2xl shadow-2xl border border-gray-100 max-w-md w-full overflow-hidden animate-in zoom-in-95 duration-200"
            >
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gray-50/50">
                    <div className="flex items-center gap-2 text-emerald-800">
                        <Keyboard className="w-5 h-5 text-emerald-600" aria-hidden="true" />
                        <h2 id="shortcuts-dialog-title" className="font-bold text-lg text-gray-900">
                            Keyboard Shortcuts
                        </h2>
                    </div>
                    <button
                        ref={closeBtnRef}
                        onClick={onClose}
                        aria-label="Close keyboard shortcuts dialog"
                        className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                    >
                        <X className="w-5 h-5" aria-hidden="true" />
                    </button>
                </div>

                {/* Description */}
                <p id="shortcuts-dialog-desc" className="px-6 pt-4 text-xs text-gray-500 font-medium">
                    Use these keyboard shortcuts for fast, accessible navigation across ticket details.
                </p>

                {/* Body */}
                <div className="p-6 space-y-6">
                    {SHORTCUT_ITEMS.map((section) => (
                        <div key={section.category} className="space-y-3">
                            <h3 className="text-xs font-black text-gray-400 uppercase tracking-wider">
                                {section.category}
                            </h3>
                            <ul className="space-y-2.5" role="list">
                                {section.shortcuts.map((item, idx) => (
                                    <li 
                                        key={idx} 
                                        className="flex items-center justify-between text-sm text-gray-700 py-1"
                                    >
                                        <span className="font-medium text-gray-800">{item.label}</span>
                                        <div className="flex items-center gap-1.5 shrink-0" aria-label={`Shortcut: ${item.keys.join(' or ')}`}>
                                            {item.keys.map((k, kIdx) => (
                                                <React.Fragment key={kIdx}>
                                                    {kIdx > 0 && <span className="text-xs text-gray-400 font-bold">+</span>}
                                                    <kbd className="px-2 py-1 min-w-[24px] text-center text-xs font-mono font-bold text-gray-700 bg-gray-100 border border-gray-300 rounded-md shadow-2xs">
                                                        {k}
                                                    </kbd>
                                                </React.Fragment>
                                            ))}
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ))}
                </div>

                {/* Footer */}
                <div className="px-6 py-3.5 bg-gray-50 border-t border-gray-100 flex items-center justify-between text-xs text-gray-500">
                    <span>Press <kbd className="font-mono font-bold text-gray-700 px-1 bg-gray-200 rounded">?</kbd> anywhere to open</span>
                    <button
                        onClick={onClose}
                        className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg transition-colors focus:ring-2 focus:ring-emerald-500 focus:outline-hidden"
                    >
                        Got it
                    </button>
                </div>
            </div>
        </div>
    );
}

export default KeyboardShortcutsModal;
