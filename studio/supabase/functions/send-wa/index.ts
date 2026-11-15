import { createProxy } from "../_shared/proxy.ts";

// Authenticated proxy to the WhatsApp API. Secret: WA_BEARER_TOKEN (falls back to
// SMS_BEARER_TOKEN when the provider issues one token for both). See ../_shared/proxy.ts.
// proxy v2: service role key used for auth check (supports sb_publishable_* anon key format)
Deno.serve(createProxy({
  name: "send-wa",
  module: "whatsapp",
  tokenEnv: ["WA_BEARER_TOKEN", "SMS_BEARER_TOKEN"],
  routes: [
    { method: "POST", path: "/api/whatsapp/v2/text/single" },
    // Delivery reports by messageId (channel=whatsapp) — the documented v2 route
    { method: "GET",  path: "/api/v2/reports" },
  ],
}));
