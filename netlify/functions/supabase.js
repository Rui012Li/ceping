const TARGET = "https://ojmepuxcdjuxeeptkzfq.supabase.co"

function corsHeaders(event) {
  const reqHeaders =
    event.headers["access-control-request-headers"] ||
    event.headers["Access-Control-Request-Headers"] ||
    "authorization,apikey,content-type,x-client-info,x-supabase-api-version,prefer,range,accept-profile,content-profile"
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": reqHeaders,
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "Access-Control-Max-Age": "86400",
  }
}

function resolvePath(event) {
  // /sb/rest/v1/... 经 redirect 后常见形态
  let path = event.path || "/"

  // /.netlify/functions/supabase/rest/v1/...
  path = path.replace(/^\/\.netlify\/functions\/supabase/, "")
  // /sb/rest/v1/...
  path = path.replace(/^\/sb/, "")

  if (!path.startsWith("/")) path = `/${path}`
  if (path === "/") path = "/"

  // 保留 query（去掉内部参数）
  const params = new URLSearchParams(event.rawQuery || "")
  params.delete("__path")
  const qs = params.toString()
  return path + (qs ? `?${qs}` : "")
}

exports.handler = async (event) => {
  const cors = corsHeaders(event)
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: cors, body: "" }
  }

  const suffix = resolvePath(event)
  const url = TARGET + suffix

  const headers = {}
  for (const [k, v] of Object.entries(event.headers || {})) {
    const key = k.toLowerCase()
    if (
      [
        "host",
        "connection",
        "content-length",
        "x-forwarded-for",
        "x-forwarded-proto",
        "x-forwarded-host",
        "client-ip",
        "via",
        "cdn-loop",
        "x-nf-client-connection-ip",
        "x-country",
        "x-language",
      ].includes(key)
    ) {
      continue
    }
    headers[k] = v
  }

  try {
    const resp = await fetch(url, {
      method: event.httpMethod,
      headers,
      body: ["GET", "HEAD"].includes(event.httpMethod) ? undefined : event.body,
    })
    const body = await resp.text()
    return {
      statusCode: resp.status,
      headers: {
        ...cors,
        "Content-Type": resp.headers.get("content-type") || "application/json",
      },
      body,
    }
  } catch (e) {
    return {
      statusCode: 502,
      headers: { ...cors, "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "proxy_upstream_failed",
        message: e instanceof Error ? e.message : String(e),
      }),
    }
  }
}
