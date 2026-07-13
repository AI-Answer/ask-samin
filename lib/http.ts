export interface JsonRequestCheck {
  ok: boolean;
  status?: number;
  message?: string;
}

function requestPublicOrigin(request: Request): string {
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const url = new URL(request.url);
  const host = forwardedHost || request.headers.get("host") || url.host;
  const protocol = forwardedProtocol || url.protocol.replace(":", "");
  return `${protocol}://${host}`;
}

export function checkSameOriginJsonRequest(request: Request): JsonRequestCheck {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/json")) {
    return { ok: false, status: 415, message: "Content-Type must be application/json." };
  }

  const origin = request.headers.get("origin");
  if (origin) {
    try {
      if (new URL(origin).origin !== requestPublicOrigin(request)) {
        return { ok: false, status: 403, message: "Cross-origin requests are not allowed." };
      }
    } catch {
      return { ok: false, status: 403, message: "Invalid request origin." };
    }
  }

  return { ok: true };
}

export function getRequestIdentity(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    "anonymous"
  );
}

export function jsonResponse(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  return Response.json(data, { ...init, headers });
}
