# Resilient support chat

The existing ticket dashboard uses Supabase Realtime WebSocket channels and durable ticket_messages/internal_notes tables. The shared chat now reports Live/Reconnecting, reloads durable history after subscription, network recovery and returning to the page, and reconciles missed events every 30 seconds. Message IDs deduplicate history/live overlap. Successful sends are reconciled from the database acknowledgement even while the socket is disconnected; failed sends restore the draft and show an accessible error. Subscription and timer resources are removed on ticket changes and unmount.

Existing Supabase authentication and row-level security remain the authorization boundary. Enable Realtime publication for ticket_messages and enforce ticket/tenant membership policies before production use. Internal notes continue to load only for staff and require matching database RLS. No anonymous WebSocket server or service-role credential is introduced. Live multi-user and outage testing requires a configured Supabase project and remains pending.

Run `node --test Frontend/src/components/shared/chatMessages.test.mjs` for deterministic recovery/deduplication tests, and the existing frontend build for integration validation.
