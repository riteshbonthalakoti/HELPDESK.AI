import { useEffect } from "react";
import { supabase } from "../lib/supabaseClient";
import useAuthStore from "../store/authStore";
import useTicketStore from "../store/ticketStore";

const useTicketsRealtime = () => {
  const { user, profile } = useAuthStore();
  const { addTicket, updateTicket, removeTicket } = useTicketStore();

  useEffect(() => {
    const companyId = profile?.company_id;
    const isAdmin = profile?.role === "admin" || profile?.role === "master_admin";

    if (!user || !profile || !companyId || !isAdmin) return;

    const channelName = `tickets-realtime-dashboard-${companyId}`;

    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "tickets",
          filter: `company_id=eq.${companyId}`,
        },
        (payload) => {
          const eventType = payload?.eventType;
          const newRecord = payload?.new;
          const oldRecord = payload?.old;

          if (eventType === "INSERT" && newRecord) {
            addTicket(newRecord);
          } else if (eventType === "UPDATE" && newRecord?.ticket_id) {
            updateTicket(newRecord.ticket_id, newRecord);
          } else if (eventType === "DELETE" && oldRecord?.ticket_id) {
            removeTicket(oldRecord.ticket_id);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, profile, addTicket, updateTicket, removeTicket]);
};

export default useTicketsRealtime;
