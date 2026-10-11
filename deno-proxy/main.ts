const TARGET = "https://ojmepuxcdjuxeeptkzfq.supabase.co";

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
        "Access-Control-Allow-Headers": req.headers.get("Access-Control-Request-Headers") || "*",
      },
    });
  }
  const target = TARGET + url.pathname + url.search;
  const headers = new Headers(req.headers);
  headers.set("Host", "ojmepuxcdjuxeeptkzfq.supabase.co");
  const init: RequestInit = { method: req.method, headers };
  if (req.method !== "GET" && req.method !== "HEAD") init.body = await req.arrayBuffer();
  const upstream = await fetch(target, init);
  const out = new Headers(upstream.headers);
  out.set("Access-Control-Allow-Origin", "*");
  return new Response(upstream.body, { status: upstream.status, headers: out });
});
