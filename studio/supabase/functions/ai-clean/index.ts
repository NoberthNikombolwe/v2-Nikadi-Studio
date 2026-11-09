import { createAiCleanHandler } from "../_shared/aiClean.ts";

// The Studio's "Clean data" chat → Gemini. Secrets: GEMINI_API_KEY, optional GEMINI_MODEL.
// Deploy with --no-verify-jwt (the sign-in check in aiClean.ts replaces it). See ../_shared/aiClean.ts.
Deno.serve(createAiCleanHandler());
