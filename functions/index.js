const fetch = require("node-fetch");
const https = require("node:https");
const crypto = require("node:crypto");
const shouldCompress = require("../util/shouldCompress");
const compress = require("../util/compress");
const { publicLookup, allowedUrl } = require("../util/networkPolicy");
const MAX_BYTES = 10 * 1024 * 1024;

exports.handler = async (event = {}) => {
  const query = event.queryStringParameters || {};
  if (!query.url) return { statusCode: 200, body: "Bandwidth Hero Data Compression Service" };
  const token = process.env.PROXY_TOKEN;
  const allowedHosts = new Set((process.env.ALLOWED_HOSTS || "").split(",").map(x => x.trim().toLowerCase()).filter(Boolean));
  const reply = (statusCode, body) => ({ statusCode, body, headers: { "cache-control": "no-store" } });
  if (!token || !allowedHosts.size) return reply(503, "Proxy requires PROXY_TOKEN and ALLOWED_HOSTS configuration");
  const headers = Object.fromEntries(Object.entries(event.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
  const digest = value => crypto.createHash("sha256").update(value).digest();
  if (!crypto.timingSafeEqual(digest(String(headers.authorization || "")), digest("Bearer " + token))) {
    return reply(401, "Unauthorized");
  }
  let target;
  try { target = allowedUrl(query.url, allowedHosts); }
  catch { return reply(400, "Destination not allowed"); }
  const useWebp = !query.jpeg;
  const grayscale = query.bw != 0;
  const quality = Math.max(1, Math.min(100, Number.parseInt(query.l, 10) || 40));
  const agent = new https.Agent({ lookup: publicLookup, keepAlive: false });
  try {
    const response = await fetch(target.href, {
      redirect: "manual", timeout: 10000, size: MAX_BYTES, agent,
      headers: { "user-agent": "Bandwidth-Hero Compressor", accept: "image/*" },
    });
    // No seguir redirecciones: el destino siguiente aún no está autorizado.
    if (!response.ok) {
      if (response.body && response.body.destroy) response.body.destroy();
      return reply(502, "Upstream request failed");
    }
    const type = response.headers.get("content-type") || "";
    if (!/^image\//i.test(type)) {
      if (response.body && response.body.destroy) response.body.destroy();
      return reply(415, "Upstream response is not an image");
    }
    const data = await response.buffer();
    if (!shouldCompress(type, data.length, useWebp)) {
      return { statusCode: 200, body: data.toString("base64"), isBase64Encoded: true,
        headers: { "content-type": type, "cache-control": "no-store" } };
    }
    const result = await compress(data, useWebp, grayscale, quality, data.length);
    if (result.err) return reply(502, "Image conversion failed");
    return { statusCode: 200, body: result.output.toString("base64"), isBase64Encoded: true,
      headers: { ...Object.fromEntries(Object.entries(result.headers).map(([k, v]) => [k, String(v)])), "cache-control": "no-store" } };
  } catch {
    return reply(502, "Upstream request or image processing failed");
  } finally {
    agent.destroy();
  }
};
