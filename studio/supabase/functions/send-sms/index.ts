import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const BEARER = Deno.env.get("SMS_BEARER_TOKEN") ?? "";
const UPSTREAM = "https://messaging-service.co.tz";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }

  const url = new URL(req.url);
  // strip the function prefix: /functions/v1/send-sms/api/sms/v2/...
  const upstreamPath = url.pathname.replace(/^\/functions\/v1\/send-sms/, "");

  try {
    const body = await req.text();
    const upstream = await fetch(`${UPSTREAM}${upstreamPath}`, {
      method: req.method,
      headers: {
        Authorization: `Bearer ${BEARER}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body,
    });
    const data = await upstream.text();
    return new Response(data, {
      status: upstream.status,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
