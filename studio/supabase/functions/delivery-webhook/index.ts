import { createDeliveryWebhook } from "../_shared/webhook.ts";

// Receives NextSMS delivery results and WhatsApp button replies (the account's Delivery
// Callback URL). Deploy with --no-verify-jwt: the Verify Token check in webhook.ts replaces
// the JWT check. See ../_shared/webhook.ts.
Deno.serve(createDeliveryWebhook());
