const BUCKET = "shareboard";
const LOCAL_PUBLIC_PATH = "/api/share";
const LOCAL_STORAGE_DIR = ".shareboard-storage";

type R2ObjectBody = {
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
  httpMetadata?: { contentType?: string };
};

type R2BucketBinding = {
  put(
    key: string,
    body: BodyInit,
    options?: { httpMetadata?: { contentType?: string; cacheControl?: string } }
  ): Promise<unknown>;
  get(key: string): Promise<R2ObjectBody | null>;
  delete(key: string): Promise<void>;
};

type CloudflareEnv = {
  SHAREBOARD_R2?: R2BucketBinding;
  R2_PUBLIC_URL?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_API_TOKEN?: string;
};

let cloudflareEnvPromise: Promise<CloudflareEnv> | undefined;

function getCloudflareEnv(): Promise<CloudflareEnv> {
  cloudflareEnvPromise ??= (async () => {
    try {
      return (await import(/* @vite-ignore */ "cloudflare:workers")).env ?? {};
    } catch {
      return {};
    }
  })();
  return cloudflareEnvPromise;
}

async function env(name: "CLOUDFLARE_ACCOUNT_ID" | "CLOUDFLARE_API_TOKEN" | "R2_PUBLIC_URL") {
  const cfEnv = await getCloudflareEnv();
  const value = String(cfEnv[name] ?? process.env[name] ?? "").trim();
  if (!value) throw new Error("Sharing storage is not configured");
  return value;
}

function canUseLocalStorage() {
  return typeof process !== "undefined" && process.env.SHAREBOARD_LOCAL_STORAGE !== "0";
}

function localObjectUrl(key: string) {
  return `${LOCAL_PUBLIC_PATH}?key=${encodeURIComponent(key)}`;
}

function localKeyFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url, "http://local.shareboard");
    return parsed.pathname === LOCAL_PUBLIC_PATH ? parsed.searchParams.get("key") : null;
  } catch {
    return null;
  }
}

function assertSafeKey(key: string) {
  if (!key || key.includes("..") || key.startsWith("/") || key.includes("\\")) {
    throw new Error("Invalid storage key");
  }
}

async function localPath(key: string) {
  assertSafeKey(key);
  const path = await import("node:path");
  return path.join(process.cwd(), LOCAL_STORAGE_DIR, key);
}

async function localPut(key: string, body: BodyInit, contentType: string) {
  const fs = await import("node:fs/promises");
  const file = await localPath(key);
  await fs.mkdir((await import("node:path")).dirname(file), { recursive: true });
  const bytes =
    typeof body === "string"
      ? Buffer.from(body)
      : Buffer.from(await new Response(body).arrayBuffer());
  await fs.writeFile(file, bytes);
  await fs.writeFile(`${file}.meta.json`, JSON.stringify({ contentType }));
  return localObjectUrl(key);
}

async function localGet(key: string): Promise<{ bytes: Buffer; contentType: string } | null> {
  const fs = await import("node:fs/promises");
  const file = await localPath(key);
  try {
    const [bytes, metaRaw] = await Promise.all([
      fs.readFile(file),
      fs.readFile(`${file}.meta.json`, "utf8").catch(() => "{}"),
    ]);
    const meta = JSON.parse(metaRaw) as { contentType?: string };
    return { bytes, contentType: meta.contentType || "application/octet-stream" };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function localDelete(key: string) {
  const fs = await import("node:fs/promises");
  const file = await localPath(key);
  await Promise.all([
    fs.rm(file, { force: true }),
    fs.rm(`${file}.meta.json`, { force: true }),
  ]);
}

function publicUrl(baseUrl: string, key: string): string {
  const path = key.split("/").map(encodeURIComponent).join("/");
  return `${baseUrl.replace(/\/+$/, "")}/${path}`;
}

async function publicBaseUrl() {
  return (await env("R2_PUBLIC_URL")).replace(/\/+$/, "");
}

async function r2Url(key: string) {
  const accountId = await env("CLOUDFLARE_ACCOUNT_ID");
  return `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${BUCKET}/objects/${encodeURIComponent(key)}`;
}

async function bucket() {
  return (await getCloudflareEnv()).SHAREBOARD_R2;
}

export async function putObject(
  key: string,
  body: string,
  cacheControl?: string
): Promise<string> {
  return putBuffer(key, body, "application/json", cacheControl);
}

export async function putBuffer(
  key: string,
  body: BodyInit,
  contentType: string,
  cacheControl = "no-store"
): Promise<string> {
  const boundBucket = await bucket();
  if (boundBucket) {
    const baseUrl = await publicBaseUrl().catch(() => "");
    await boundBucket.put(key, body, {
      httpMetadata: {
        contentType,
        cacheControl,
      },
    });
    return baseUrl ? publicUrl(baseUrl, key) : localObjectUrl(key);
  }

  if (canUseLocalStorage()) {
    return localPut(key, body, contentType);
  }

  const res = await fetch(await r2Url(key), {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${await env("CLOUDFLARE_API_TOKEN")}`,
      "Content-Type": contentType,
      "Cache-Control": cacheControl,
    },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    console.error(`R2 upload failed (${res.status}): ${text}`);
    throw new Error("Sharing storage rejected the upload");
  }
  return getPublicUrl(key);
}

export async function getObjectText(key: string): Promise<string | null> {
  const boundBucket = await bucket();
  if (boundBucket) {
    const object = await boundBucket.get(key);
    return object ? object.text() : null;
  }

  if (canUseLocalStorage()) {
    const object = await localGet(key);
    return object ? object.bytes.toString("utf8") : null;
  }

  const res = await fetch(await r2Url(key), {
    headers: {
      Authorization: `Bearer ${await env("CLOUDFLARE_API_TOKEN")}`,
    },
    cache: "no-store",
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text();
    console.error(`R2 read failed (${res.status}): ${text}`);
    throw new Error("Sharing storage could not read the board");
  }
  return res.text();
}

export async function deleteObject(key: string) {
  const boundBucket = await bucket();
  if (boundBucket) {
    await boundBucket.delete(key);
    return;
  }

  if (canUseLocalStorage()) {
    await localDelete(key);
    return;
  }

  const res = await fetch(await r2Url(key), {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${await env("CLOUDFLARE_API_TOKEN")}`,
    },
  });
  if (res.status === 404) return;
  if (!res.ok) {
    const text = await res.text();
    console.error(`R2 delete failed (${res.status}): ${text}`);
    throw new Error("Sharing storage could not delete the board");
  }
}

export function getPublicUrl(key: string): string {
  const value = process.env.R2_PUBLIC_URL?.trim();
  if (!value && canUseLocalStorage()) return localObjectUrl(key);
  if (!value) throw new Error("Sharing storage is not configured");
  return publicUrl(value, key);
}

export async function getPublicUrlAsync(key: string): Promise<string> {
  if (canUseLocalStorage()) {
    const cfEnv = await getCloudflareEnv();
    const hasConfiguredStorage =
      !!cfEnv.R2_PUBLIC_URL ||
      !!process.env.R2_PUBLIC_URL ||
      (!!process.env.CLOUDFLARE_ACCOUNT_ID && !!process.env.CLOUDFLARE_API_TOKEN);
    if (!hasConfiguredStorage) return localObjectUrl(key);
  }
  return publicUrl(await publicBaseUrl(), key);
}

function objectKeyFromPublicUrl(url: string, baseUrl: string): string | null {
  const prefix = `${baseUrl.replace(/\/+$/, "")}/`;
  if (!url.startsWith(prefix)) return null;
  return url
    .slice(prefix.length)
    .split("/")
    .map((part) => decodeURIComponent(part))
    .join("/");
}

export function getObjectKeyFromPublicUrl(url: string): string | null {
  const localKey = localKeyFromUrl(url);
  if (localKey) return localKey;
  const value = process.env.R2_PUBLIC_URL?.trim();
  return value ? objectKeyFromPublicUrl(url, value) : null;
}

export async function getObjectKeyFromPublicUrlAsync(url: string): Promise<string | null> {
  const localKey = localKeyFromUrl(url);
  if (localKey) return localKey;
  try {
    return objectKeyFromPublicUrl(url, await publicBaseUrl());
  } catch {
    return getObjectKeyFromPublicUrl(url);
  }
}

export async function getObjectResponse(key: string): Promise<Response | null> {
  const boundBucket = await bucket();
  if (boundBucket) {
    const object = await boundBucket.get(key);
    if (!object) return null;
    return new Response(await object.arrayBuffer(), {
      headers: {
        "Content-Type": object.httpMetadata?.contentType || "application/octet-stream",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  }

  if (canUseLocalStorage()) {
    const object = await localGet(key);
    if (!object) return null;
    return new Response(object.bytes, {
      headers: {
        "Content-Type": object.contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  }

  return null;
}
