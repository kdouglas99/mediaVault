const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.FRONTEND_PORT || 3000;

// Serve static files from dist
const distPath = path.join(__dirname, 'dist');
app.use(express.static(distPath));

// Provide a simple config endpoint for integration checks and frontend consumption
app.get('/api/config', (req, res) => {
  // Prefer VITE_API_URL from environment; if it's localhost or unset, adapt to requester host
  const hostname = req.hostname || 'localhost';
  const protocol = req.protocol || 'http';
  const backendPort = process.env.BACKEND_PORT || process.env.PORT || 3001;
  let base = process.env.VITE_API_URL || '';

  // If base is set to localhost/127.0.0.1 or empty, build a base using the request host
  if (!base || /^(https?:\/\/)?(localhost|127\.0\.0\.1)/i.test(base)) {
    base = `${protocol}://${hostname}:${backendPort}`;
  }

  // Normalize and ensure /api suffix
  if (base.endsWith('/')) base = base.slice(0, -1);

  res.json({
    success: true,
    config: {
      API_BASE: `${base}/api`
    }
  });
});

app.listen(PORT, () => {
  console.log(`[frontend] Listening on http://localhost:${PORT}`);
});
