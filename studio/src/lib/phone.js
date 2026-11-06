// Phone helpers shared by every send path (WhatsApp, SMS, VCard, reports, scheduled sends).
// Numbers are normalised to E.164 without the "+" (e.g. 255712345678).
// The code lives in supabase/functions/_shared/messaging.js so the Edge Functions use the
// very same rules; it is re-exported here for the app.
export { normalisePhone, isValidPhone } from "../../supabase/functions/_shared/messaging.js";
