/**
 * Cloudflare Worker：把请求代理到 Supabase，缓解国内直连 *.supabase.co 失败。
 * 部署后把前端 VITE_SUPABASE_URL 改成 Worker 地址即可。
 */
const TARGET = "https://ojmepuxcdjuxeeptkzfq.supabase.co"

export default {
  async fetch(request) {
    const url = new URL(request.url)

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(request),
      })
    }

    const targetUrl = TARGET + url.pathname + url.search
    const headers = new Headers(request.headers)
    headers.set("Host", new URL(TARGET).host)
    headers.delete("cf-connecting-ip")
    headers.delete("cf-ipcountry")
    headers.delete("cf-ray")
    headers.delete("cf-visitor")
    headers.delete("x-forwarded-proto")
    headers.delete("x-real-ip")

    const init = {
      method: request.method,
      headers,
      redirect: "manual",
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      init.body = await request.arrayBuffer()
    }

    const upstream = await fetch(targetUrl, init)
    const respHeaders = new Headers(upstream.headers)
    const cors = corsHeaders(request)
    for (const [k, v] of Object.entries(cors)) respHeaders.set(k, v)
    // 避免把上游 CORS 弄乱
    respHeaders.delete("access-control-allow-origin")
    respHeaders.set("Access-Control-Allow-Origin", "*")
    respHeaders.set("Access-Control-Allow-Headers", cors["Access-Control-Allow-Headers"])
    respHeaders.set("Access-Control-Allow-Methods", cors["Access-Control-Allow-Methods"])

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: respHeaders,
    })
  },
}

function corsHeaders(request) {
  const reqHeaders = request.headers.get("Access-Control-Request-Headers") ||
    "authorization,apikey,content-type,x-client-info,x-supabase-api-version,prefer,range,accept-profile,content-profile"
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": reqHeaders,
    "Access-Control-Max-Age": "86400",
  }
}
