import { createProxy } from "../_shared/proxy.ts";

// Authenticated proxy to the WhatsApp API. Secret: WA_BEARER_TOKEN (falls back to
// SMS_BEARER_TOKEN when the provider issues one token for both). See ../_shared/proxy.ts.
Deno.serve(createProxy({
  name: "send-wa",
  tokenEnv: ["WA_BEARER_TOKEN", "SMS_BEARER_TOKEN"],
  routes: [
    { method: "POST", path: "/api/whatsapp/v2/text/single" },
    { method: "GET",  path: "/api/whatsapp/v1/reports" },
  ],
}));
