const favicon = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="#1d4ed8"/>
  <path d="M14 18h36v8H36v24h-8V26H14z" fill="#fff"/>
  <circle cx="48" cy="46" r="6" fill="#93c5fd"/>
</svg>`.trim();

export function GET() {
  return new Response(favicon, {
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'public, max-age=86400',
    },
  });
}
