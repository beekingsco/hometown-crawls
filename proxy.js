import { next, rewrite } from "@vercel/functions";

const SANDBOX_HOST = "sandbox.hometowncrawls.com";
const ROBOTS = "noindex, nofollow";

function hostName(request) {
  return (request.headers.get("host") || "").split(":")[0].toLowerCase();
}

function isAssetOrSandbox(pathname) {
  return pathname === "/sandbox" || pathname.startsWith("/sandbox/") || pathname === "/assets" || pathname.startsWith("/assets/");
}

export default function proxy(request) {
  if (hostName(request) !== SANDBOX_HOST) return next();

  const { pathname } = new URL(request.url);
  if (pathname === "/robots.txt") {
    return rewrite(new URL("/sandbox/robots.txt", request.url), {
      headers: { "X-Robots-Tag": ROBOTS }
    });
  }
  if (pathname !== "/" && isAssetOrSandbox(pathname)) return next();

  return new Response(null, {
    status: 307,
    headers: {
      Location: "/sandbox",
      "X-Robots-Tag": ROBOTS,
      "Cache-Control": "public, max-age=0, must-revalidate"
    }
  });
}
