const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.FRONTEND_PORT || 3000;

// Serve static files from dist
const distPath = path.join(__dirname, 'dist');
app.use(express.static(distPath));

// Provide a simple config endpoint for integration checks and frontend consumption
app.get('/api/config', (req, res) => {
  // Prefer VITE_API_URL from environment; fall back to backend default
  const base = process.env.VITE_API_URL || 'http://localhost:3001';
  res.json({
    success: true,
    config: {
      API_BASE: base.endsWith('/') ? `${base}api` : `${base}/api`
    }
  });
});

app.listen(PORT, () => {
  console.log(`[frontend] Listening on http://localhost:${PORT}`);
});
