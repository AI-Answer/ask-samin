// Supabase Edge Runtime provides the Deno and Supabase globals used below.
declare const Deno: { serve(handler: (request: Request) => Response | Promise<Response>): void };
declare const Supabase: {
  ai: {
    Session: new (model: "gte-small") => {
      run(
        input: string,
        options: { mean_pool: boolean; normalize: boolean }
      ): Promise<number[]>;
    };
  };
};

const model = new Supabase.ai.Session("gte-small");

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed." }, { status: 405 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const input = (payload as { input?: unknown } | null)?.input;
  if (typeof input !== "string" || input.trim().length < 1 || input.length > 8_000) {
    return Response.json({ error: "input must be a non-empty string of at most 8,000 characters." }, { status: 400 });
  }

  try {
    const embedding = await model.run(input.trim(), { mean_pool: true, normalize: true });
    if (!Array.isArray(embedding) || embedding.length !== 384) {
      return Response.json({ error: "Embedding model returned an invalid vector." }, { status: 502 });
    }
    return Response.json({ embedding }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Embedding generation failed." }, { status: 503 });
  }
});
