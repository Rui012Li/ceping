const TARGET = "https://ojmepuxcdjuxeeptkzfq.supabase.co"

exports.handler = async (event) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": event.headers["access-control-request-headers"] || "authorization,apikey,content-type,x-client-info,prefer",
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  }
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: cors, body: "" }
  }

  // /.netlify/functions/supabase/rest/v1/...  or path via rawQuery
  let path = event.path.replace(/^\/\.netlify\/functions\/supabase/, "") || "/"
  // also support ?path=
  if (event.queryStringParameters && event.queryStringParameters.__path) {
    path = event.queryStringParameters.__path
  }
  const qs = event.rawQuery ? `?${event.rawQuery.replace(/__path=[^&]*&?/, "").replace(/&$/, "")}` : ""
  const url = TARGET + path + (qs === "?" ? "" : qs)

  const headers = { ...event.headers }
  delete headers.host
  delete headers["content-length"]
  delete headers["x-forwarded-for"]
  delete headers["x-forwarded-proto"]
  delete headers["client-ip"]
  delete headers["via"]
  delete headers["cdn-loop"]

  const resp = await fetch(url, {
    method: event.httpMethod,
    headers,
    body: ["GET", "HEAD"].includes(event.httpMethod) ? undefined : event.body,
  })
  const body = await resp.text()
  const outHeaders = { ...cors, "Content-Type": resp.headers.get("content-type") || "application/json" }
  return { statusCode: resp.status, headers: outHeaders, body }
}
