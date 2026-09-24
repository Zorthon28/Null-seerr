/**
 * Cloudflare Worker for Null-seerr (seerr.nullraccoon.com)
 * Intercepts 502, 521, 522, 530 and connection errors when the server is offline
 * and displays a modern, branded offline status page with auto-retry polling.
 */

export default {
  async fetch(request, env, ctx) {
    try {
      const response = await fetch(request);

      // Cloudflare / Tunnel offline status codes
      const offlineCodes = [502, 503, 504, 520, 521, 522, 523, 524, 530];

      if (offlineCodes.includes(response.status)) {
        return handleOffline(request, response.status);
      }

      return response;
    } catch (err) {
      return handleOffline(request, 502);
    }
  },
};

function handleOffline(request, statusCode) {
  const url = new URL(request.url);
  const acceptHeader = request.headers.get('accept') || '';
  const isHtmlRequest =
    acceptHeader.includes('text/html') ||
    request.headers.get('sec-fetch-dest') === 'document';

  // For API / JSON endpoints, return structured JSON so apps don't choke on HTML
  if (!isHtmlRequest || url.pathname.startsWith('/api/')) {
    return new Response(
      JSON.stringify(
        {
          error: 'Server Offline',
          message: 'The origin server / Null-seerr instance is currently powered off or unreachable.',
          statusCode: statusCode,
          timestamp: new Date().toISOString(),
        },
        null,
        2
      ),
      {
        status: 503,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Retry-After': '30',
        },
      }
    );
  }

  // Render high-end custom offline page
  return new Response(renderOfflineHtml(url.hostname, statusCode), {
    status: 503,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Retry-After': '30',
    },
  });
}

function renderOfflineHtml(hostname, statusCode) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Null-seerr | Server Offline</title>
  <link rel="icon" type="image/x-icon" href="/favicon.ico">
  <style>
    :root {
      --bg: #090d16;
      --card-bg: rgba(17, 24, 39, 0.75);
      --card-border: rgba(99, 102, 241, 0.2);
      --text: #f3f4f6;
      --text-muted: #9ca3af;
      --primary: #6366f1;
      --primary-hover: #4f46e5;
      --amber: #f59e0b;
      --red: #ef4444;
      --emerald: #10b981;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, "Open Sans", "Helvetica Neue", sans-serif;
    }

    body {
      min-height: 100vh;
      background: radial-gradient(circle at 50% 20%, #1e1b4b 0%, #090d16 65%, #05070c 100%);
      color: var(--text);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 1.5rem;
      overflow-x: hidden;
    }

    .container {
      max-width: 540px;
      width: 100%;
      background: var(--card-bg);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border: 1px solid var(--card-border);
      border-radius: 24px;
      padding: 2.5rem 2rem;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.6), 0 0 35px rgba(99, 102, 241, 0.12);
      text-align: center;
      position: relative;
    }

    /* Status glowing icon */
    .icon-wrapper {
      position: relative;
      width: 88px;
      height: 88px;
      margin: 0 auto 1.75rem auto;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .pulse-ring {
      position: absolute;
      inset: -6px;
      border-radius: 50%;
      background: radial-gradient(circle, rgba(245, 158, 11, 0.35) 0%, rgba(245, 158, 11, 0) 70%);
      animation: pulse 2.4s cubic-bezier(0.4, 0, 0.6, 1) infinite;
    }

    .icon-bg {
      position: relative;
      width: 80px;
      height: 80px;
      border-radius: 50%;
      background: linear-gradient(135deg, #1f2937, #111827);
      border: 1px solid rgba(245, 158, 11, 0.4);
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 8px 16px rgba(0, 0, 0, 0.4);
    }

    .icon-svg {
      width: 42px;
      height: 42px;
      color: var(--amber);
    }

    @keyframes pulse {
      0%, 100% {
        transform: scale(0.95);
        opacity: 0.5;
      }
      50% {
        transform: scale(1.25);
        opacity: 0.9;
      }
    }

    /* Badge */
    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 6px 14px;
      border-radius: 9999px;
      background: rgba(245, 158, 11, 0.12);
      border: 1px solid rgba(245, 158, 11, 0.3);
      color: #fbbf24;
      font-size: 0.8rem;
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      margin-bottom: 1.25rem;
    }

    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--amber);
      box-shadow: 0 0 10px var(--amber);
      animation: blink 1.6s infinite ease-in-out;
    }

    @keyframes blink {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.3; }
    }

    h1 {
      font-size: 1.75rem;
      font-weight: 800;
      letter-spacing: -0.025em;
      margin-bottom: 0.75rem;
      color: #ffffff;
    }

    p.description {
      font-size: 0.95rem;
      color: var(--text-muted);
      line-height: 1.6;
      margin-bottom: 1.75rem;
    }

    /* Diagnostics Card */
    .diagnostics {
      background: rgba(15, 23, 42, 0.6);
      border: 1px solid rgba(255, 255, 255, 0.07);
      border-radius: 14px;
      padding: 1rem 1.25rem;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0.75rem;
      font-size: 0.82rem;
      margin-bottom: 1.75rem;
      text-align: left;
    }

    .diag-item span.label {
      color: #64748b;
      display: block;
      margin-bottom: 2px;
      font-size: 0.72rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .diag-item span.val {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      color: #cbd5e1;
      font-weight: 600;
    }

    /* Actions & Retry */
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      width: 100%;
      padding: 0.85rem 1.5rem;
      border-radius: 12px;
      font-size: 0.95rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s ease;
      text-decoration: none;
      border: none;
    }

    .btn-primary {
      background: linear-gradient(135deg, var(--primary), var(--primary-hover));
      color: #ffffff;
      box-shadow: 0 4px 14px rgba(99, 102, 241, 0.35);
    }

    .btn-primary:hover {
      background: linear-gradient(135deg, #7073f3, #5a52ea);
      transform: translateY(-1px);
      box-shadow: 0 6px 20px rgba(99, 102, 241, 0.5);
    }

    .btn-primary:active {
      transform: translateY(0);
    }

    .btn-primary.checking {
      opacity: 0.8;
      pointer-events: none;
    }

    .countdown-text {
      margin-top: 1.2rem;
      font-size: 0.82rem;
      color: #64748b;
    }

    .countdown-number {
      color: #a5b4fc;
      font-weight: 700;
    }

    footer {
      margin-top: 2rem;
      font-size: 0.75rem;
      color: #475569;
      text-align: center;
    }

    /* Spinner */
    .spinner {
      display: none;
      width: 16px;
      height: 16px;
      border: 2px solid rgba(255, 255, 255, 0.3);
      border-radius: 50%;
      border-top-color: #ffffff;
      animation: spin 0.8s linear infinite;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }
  </style>
</head>
<body>
  <div class="container">
    <!-- Icon -->
    <div class="icon-wrapper">
      <div class="pulse-ring"></div>
      <div class="icon-bg">
        <svg class="icon-svg" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" d="M5.636 5.636a9 9 0 1 0 12.728 0M12 3v9" />
        </svg>
      </div>
    </div>

    <!-- Badge -->
    <div class="status-badge">
      <span class="status-dot"></span>
      Server Offline
    </div>

    <!-- Header -->
    <h1>Null-seerr is Currently Sleeping</h1>
    <p class="description">
      The home server is currently powered off or undergoing maintenance. 
      Once the server is booted up, this page will automatically reconnect.
    </p>

    <!-- Diagnostics -->
    <div class="diagnostics">
      <div class="diag-item">
        <span class="label">Target Host</span>
        <span class="val">${hostname}</span>
      </div>
      <div class="diag-item">
        <span class="label">Gateway Status</span>
        <span class="val">${statusCode} (Tunnel Offline)</span>
      </div>
    </div>

    <!-- Action Button -->
    <button id="retry-btn" class="btn btn-primary" onclick="manualCheck()">
      <span class="spinner" id="btn-spinner"></span>
      <span id="btn-text">Check Server Status</span>
    </button>

    <div class="countdown-text">
      Auto-retrying connection in <span id="countdown" class="countdown-number">15</span>s...
    </div>
  </div>

  <footer>
    Protected by Cloudflare Edge &bull; Null-seerr Media Stack
  </footer>

  <script>
    let secondsLeft = 15;
    const countdownEl = document.getElementById('countdown');
    const retryBtn = document.getElementById('retry-btn');
    const btnSpinner = document.getElementById('btn-spinner');
    const btnText = document.getElementById('btn-text');
    let isChecking = false;

    // Countdown loop
    const timer = setInterval(() => {
      if (isChecking) return;
      secondsLeft--;
      if (secondsLeft <= 0) {
        checkServer();
      } else {
        countdownEl.textContent = secondsLeft;
      }
    }, 1000);

    async function checkServer() {
      if (isChecking) return;
      isChecking = true;
      retryBtn.classList.add('checking');
      btnSpinner.style.display = 'inline-block';
      btnText.textContent = 'Checking connection...';

      try {
        const testUrl = '/favicon.ico?_ping=' + Date.now();
        const res = await fetch(testUrl, { method: 'HEAD', cache: 'no-store' });
        
        if (res.ok || (res.status >= 200 && res.status < 400)) {
          btnText.textContent = 'Online! Loading...';
          btnSpinner.style.borderTopColor = '#10b981';
          window.location.reload();
          return;
        }
      } catch (e) {
        // Still down
      }

      secondsLeft = 15;
      countdownEl.textContent = secondsLeft;
      isChecking = false;
      retryBtn.classList.remove('checking');
      btnSpinner.style.display = 'none';
      btnText.textContent = 'Check Server Status';
    }

    function manualCheck() {
      checkServer();
    }
  </script>
</body>
</html>`;
}
