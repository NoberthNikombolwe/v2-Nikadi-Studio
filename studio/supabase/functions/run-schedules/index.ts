import { createScheduler } from "../_shared/scheduler.ts";

// Sends scheduled SMS / WhatsApp messages that are due. Called every minute by pg_cron
// (only while a send is due) with the x-cron-secret header; see ../_shared/scheduler.ts.
// Deploy with --no-verify-jwt: the secret check in scheduler.ts replaces the JWT check.
Deno.serve(createScheduler());
