import { createProxy } from "../_shared/proxy.ts";

// Authenticated proxy to the SMS API. Secret: SMS_BEARER_TOKEN. See ../_shared/proxy.ts.
// Reports (by messageId, for "Check delivery now") and the account log are GET, so SMS view is enough.
Deno.serve(createProxy({
  name: "send-sms",
  module: "sms",
  tokenEnv: ["SMS_BEARER_TOKEN"],
  routes: [
    { method: "POST", path: "/api/sms/v2/text/single" },
    { method: "POST", path: "/api/sms/v2/text/multi" },
    { method: "GET",  path: "/api/v2/balance" },
    { method: "GET",  path: "/api/v2/reports" },
    { method: "GET",  path: "/api/v2/logs" },
  ],
}));
