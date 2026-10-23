import { createProxy } from "../_shared/proxy.ts";

// Authenticated proxy to the SMS API. Secret: SMS_BEARER_TOKEN. See ../_shared/proxy.ts.
Deno.serve(createProxy({
  name: "send-sms",
  tokenEnv: ["SMS_BEARER_TOKEN"],
  routes: [
    { method: "POST", path: "/api/sms/v2/text/single" },
    { method: "POST", path: "/api/sms/v2/text/multi" },
    { method: "GET",  path: "/api/v2/balance" },
  ],
}));
