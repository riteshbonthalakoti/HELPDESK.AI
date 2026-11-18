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

/**
 * Web Audio API synthesizer for playing real-time SLA breach alert tones.
 * Uses dual-tone sine wave beeps so no external audio asset files are needed.
 */
export const playSlaAlertSound = () => {
    if (typeof window === 'undefined') return;

    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();

        const playTone = (freq, startTime, duration) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();

            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, startTime);

            gain.gain.setValueAtTime(0.25, startTime);
            gain.gain.exponentialRampToValueAtTime(0.01, startTime + duration);

            osc.connect(gain);
            gain.connect(ctx.destination);

            osc.start(startTime);
            osc.stop(startTime + duration);
        };

        const now = ctx.currentTime;
        // Two quick urgent pulses: 880Hz (A5) -> 1046.5Hz (C6)
        playTone(880, now, 0.14);
        playTone(1046.5, now + 0.18, 0.22);
    } catch (e) {
        console.warn('SLA sound alert unavailable:', e);
    }
};

/**
 * Dispatches an OS desktop browser notification for a breached ticket.
 * @param {Object} ticket 
 */
export const triggerDesktopNotification = (ticket) => {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;

    try {
        const tid = formatTicketId(ticket?.ticket_id || ticket?.id || 'Unknown');
        const priority = (ticket?.priority || 'Critical').toUpperCase();
        const subject = ticket?.subject || ticket?.summary || 'Triage SLA breach requires immediate action';

        new Notification(`🚨 SLA BREACH: Ticket #${tid}`, {
            body: `[${priority}] ${subject}\nImmediate response required!`,
            icon: '/placeholder.svg',
            tag: `sla-breach-${tid}`,
        });
    } catch (e) {
        console.warn('SLA desktop notification failed:', e);
    }
};

/**
 * Zustand store for SLA urgency alerts, audio & desktop notification toggles,
 * and de-duplicated breach tracking.
 */
export const useSLAStore = create(
    persist(
        (set, get) => ({
            // Configuration & Toggles
            soundEnabled: true,
            desktopNotificationsEnabled: true,

            // Set of ticket IDs that have already alerted breach
            breachedTicketIds: [],

            // Toggle sound notifications
            toggleSound: () => set((state) => ({ soundEnabled: !state.soundEnabled })),
            setSoundEnabled: (enabled) => set({ soundEnabled: Boolean(enabled) }),

            // Toggle desktop browser notifications
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

            /**
             * Notifies user of an SLA breach for a ticket with sound and/or desktop notification.
             * De-duplicates so the same ticket doesn't spam alerts.
             */
            notifyBreach: (ticket) => {
                if (!ticket) return false;
                const ticketId = String(ticket.ticket_id || ticket.id || '');
                if (!ticketId) return false;

                const { breachedTicketIds, soundEnabled, desktopNotificationsEnabled } = get();

                if (breachedTicketIds.includes(ticketId)) {
                    return false; // Already alerted for this breach
                }

                // Register breached ticket
                set({ breachedTicketIds: [...breachedTicketIds, ticketId] });

                // Play sound if enabled
                if (soundEnabled) {
                    playSlaAlertSound();
                }

                // Desktop notification if enabled
                if (desktopNotificationsEnabled) {
                    triggerDesktopNotification(ticket);
                }

                return true;
            },

            /**
             * Resets a ticket from the breached list (e.g. if updated/re-opened/priority changed)
             */
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
