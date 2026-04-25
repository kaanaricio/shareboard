import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function isPrivateIp(address: string): boolean {
  if (address === "::1" || address === "0.0.0.0") return true;
  if (address.startsWith("fc") || address.startsWith("fd") || address.startsWith("fe80:")) return true;
  if (address.startsWith("::ffff:")) return isPrivateIp(address.slice("::ffff:".length));
  if (address.includes(":")) return false;

  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((part) => Number.isNaN(part))) return true;

  const [a, b] = octets;
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

async function assertPublicUrl(value: string): Promise<URL> {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Only http(s) URLs are allowed");
  if (url.username || url.password) throw new Error("Authenticated URLs are not allowed");
  if (["localhost", "localhost.localdomain"].includes(url.hostname) || url.hostname.endsWith(".local")) {
    throw new Error("Private hosts are not allowed");
  }

  const literal = isIP(url.hostname) ? url.hostname : null;
  if (literal && isPrivateIp(literal)) {
    throw new Error("Private hosts are not allowed");
  }

  if (literal) {
    return url;
  }

  const records = await lookup(url.hostname, { all: true });
  if (records.length === 0 || records.some((record) => isPrivateIp(record.address))) {
    throw new Error("Private hosts are not allowed");
  }

  return url;
}

type PublicFetchResult = {
  response: Response;
  url: string;
};

function requestPublicUrl(url: URL, init: RequestInit): Promise<Response> {
  if (init.body) {
    throw new Error("Public URL fetch does not support request bodies");
  }
  return fetch(url, {
    ...init,
    redirect: "manual",
  });
}

export async function fetchPublicUrl(
  value: string | URL,
  init: RequestInit = {},
  maxRedirects = 3
): Promise<PublicFetchResult> {
  let current = await assertPublicUrl(value.toString());

  for (let redirects = 0; ; redirects++) {
    const response = await requestPublicUrl(current, init);
    if (!REDIRECT_STATUSES.has(response.status)) {
      return { response, url: current.toString() };
    }

    if (redirects >= maxRedirects) throw new Error("Too many redirects");

    const location = response.headers.get("location");
    if (!location) throw new Error("Redirect missing location");
    current = await assertPublicUrl(new URL(location, current).toString());
  }
}
