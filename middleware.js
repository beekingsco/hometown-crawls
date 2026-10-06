const SANDBOX_HOST = "sandbox.hometowncrawls.com";

export const config = {
  matcher: "/robots.txt"
};

export default function middleware(request) {
  const host = (request.headers.get("host") || "").split(":")[0].toLowerCase();
  if (host !== SANDBOX_HOST) {
    return new Response(null, { headers: { "x-middleware-next": "1" } });
  }
  const destination = new URL("/sandbox/robots.txt", request.url);
  return new Response(null, {
    headers: {
      "x-middleware-rewrite": destination.href,
      "x-robots-tag": "noindex, nofollow"
    }
  });
}
