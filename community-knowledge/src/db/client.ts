import { createClient } from "@supabase/supabase-js";

const SCHEMA = "community_knowledge";

function getSupabaseUrl(): string | undefined {
  return process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
}

export function isSupabaseReadConfigured(): boolean {
  return Boolean(getSupabaseUrl() && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim());
}

export function createServerSupabaseClient() {
  const url = getSupabaseUrl();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) return null;

  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
    db: { schema: SCHEMA },
    global: { headers: { "X-Client-Info": "community-knowledge-server" } }
  });
}

export function createReadSupabaseClient() {
  const url = getSupabaseUrl();
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !key) return null;

  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
    db: { schema: SCHEMA },
    global: { headers: { "X-Client-Info": "community-knowledge-read" } }
  });
}

/** Root client for edge functions (no schema override). */
export function createServiceRootClient() {
  const url = getSupabaseUrl();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) return null;

  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { "X-Client-Info": "community-knowledge-root" } }
  });
}

export function createPublicRpcClient() {
  const url = getSupabaseUrl();
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !key) return null;

  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
    db: { schema: "public" },
    global: { headers: { "X-Client-Info": "community-knowledge-rpc" } }
  });
}
