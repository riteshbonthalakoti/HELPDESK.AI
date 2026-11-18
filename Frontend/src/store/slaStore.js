import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { formatTicketId } from '../utils/format';

const safeStorage = {
    getItem: (name) => {
        if (typeof window !== 'undefined' && window.localStorage) {
            try {
                return window.localStorage.getItem(name);
            } catch {
                return null;
            }
        }
        return null;
    },
    setItem: (name, value) => {
        if (typeof window !== 'undefined' && window.localStorage) {
            try {
                window.localStorage.setItem(name, value);
            } catch {
                // Ignore storage full/disabled
            }
        }
    },
    removeItem: (name) => {
        if (typeof window !== 'undefined' && window.localStorage) {
            try {
                window.localStorage.removeItem(name);
            } catch {
                // Ignore
            }
        }
    },
};

// Shared singleton AudioContext & user-gesture gate (prevents memory leaks & autoplay spam)
let sharedAudioCtx = null;
let hasUserInteracted = false;
let lastSoundPlayedAt = 0;
const SOUND_COOLDOWN_MS = 5000;

if (typeof window !== 'undefined') {
    const unlockAudio = () => {
        hasUserInteracted = true;
        if (sharedAudioCtx && sharedAudioCtx.state === 'suspended') {
            sharedAudioCtx.resume().catch(() => {});
        }
        window.removeEventListener('pointerdown', unlockAudio);
        window.removeEventListener('keydown', unlockAudio);
    };
    window.addEventListener('pointerdown', unlockAudio, { once: true, passive: true });
    window.addEventListener('keydown', unlockAudio, { once: true, passive: true });
}

/**
 * Web Audio API synthesizer for playing real-time SLA breach alert tones.
 * Reuses a single shared AudioContext and requires a prior user gesture + cooldown.
 */
export const playSlaAlertSound = () => {
    if (typeof window === 'undefined' || !hasUserInteracted) return;

    const nowMs = Date.now();
    if (nowMs - lastSoundPlayedAt < SOUND_COOLDOWN_MS) return;
    lastSoundPlayedAt = nowMs;

    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;

        if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') {
            sharedAudioCtx = new AudioCtx();
        }
        if (sharedAudioCtx.state === 'suspended') {
            sharedAudioCtx.resume().catch(() => {});
        }

        const ctx = sharedAudioCtx;
        const playTone = (freq, startTime, duration) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();

            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, startTime);

            gain.gain.setValueAtTime(0.2, startTime);
            gain.gain.exponentialRampToValueAtTime(0.01, startTime + duration);

            osc.connect(gain);
            gain.connect(ctx.destination);

            osc.start(startTime);
            osc.stop(startTime + duration);
            osc.onended = () => {
                try {
                    osc.disconnect();
                    gain.disconnect();
                } catch {}
            };
        };

        const now = ctx.currentTime;
        playTone(880, now, 0.14);
        playTone(1046.5, now + 0.18, 0.22);
    } catch {
        // Ignore unavailable audio environments
    }
};

/**
 * Dispatches an OS desktop browser notification for a newly breached ticket.
 */
export const triggerDesktopNotification = (ticket) => {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;

    try {
        const tid = formatTicketId(ticket?.ticket_id || ticket?.id || 'Unknown');
        const priority = (ticket?.priority || 'Critical').toUpperCase();
        const subject = ticket?.subject || ticket?.summary || 'Triage SLA breach requires immediate action';

        new Notification(`SLA BREACH: Ticket #${tid}`, {
            body: `[${priority}] ${subject}\nImmediate response required!`,
            icon: '/favicon.png',
            tag: `sla-breach-${tid}`,
        });
    } catch {
        // Ignore notification errors
    }
};

export const useSLAStore = create(
    persist(
        (set, get) => ({
            soundEnabled: true,
            desktopNotificationsEnabled: true,
            breachedTicketIds: [],

            toggleSound: () => set((state) => ({ soundEnabled: !state.soundEnabled })),
            setSoundEnabled: (enabled) => set({ soundEnabled: Boolean(enabled) }),

            toggleDesktopNotifications: async () => {
                const current = get().desktopNotificationsEnabled;
                if (!current) {
                    if (typeof window !== 'undefined' && 'Notification' in window) {
                        if (Notification.permission === 'default') {
                            const res = await Notification.requestPermission();
                            if (res !== 'granted') {
                                set({ desktopNotificationsEnabled: false });
                                return false;
                            }
                        } else if (Notification.permission === 'denied') {
                            set({ desktopNotificationsEnabled: false });
                            return false;
                        }
                    }
                    set({ desktopNotificationsEnabled: true });
                    return true;
                } else {
                    set({ desktopNotificationsEnabled: false });
                    return false;
                }
            },
            setDesktopNotificationsEnabled: (enabled) =>
                set({ desktopNotificationsEnabled: Boolean(enabled) }),

            notifyBreach: (ticket) => {
                if (!ticket) return false;
                const ticketId = String(ticket.ticket_id || ticket.id || '');
                if (!ticketId) return false;

                const { breachedTicketIds, soundEnabled, desktopNotificationsEnabled } = get();
                if (breachedTicketIds.includes(ticketId)) {
                    return false;
                }

                // Cap tracked list size to prevent unbounded memory growth
                const nextIds =
                    breachedTicketIds.length >= 250
                        ? [...breachedTicketIds.slice(-200), ticketId]
                        : [...breachedTicketIds, ticketId];
                set({ breachedTicketIds: nextIds });

                if (soundEnabled) {
                    playSlaAlertSound();
                }
                if (desktopNotificationsEnabled) {
                    triggerDesktopNotification(ticket);
                }

                return true;
            },

            resetBreachedTicket: (ticketId) => {
                if (!ticketId) return;
                const idStr = String(ticketId);
                set((state) => ({
                    breachedTicketIds: state.breachedTicketIds.filter((id) => id !== idStr),
                }));
            },

            clearBreachedTickets: () => set({ breachedTicketIds: [] }),
        }),
        {
            name: 'sla-alert-settings',
            storage: createJSONStorage(() => safeStorage),
            partialize: (state) => ({
                soundEnabled: state.soundEnabled,
                desktopNotificationsEnabled: state.desktopNotificationsEnabled,
            }),
        }
    )
);

export default useSLAStore;
