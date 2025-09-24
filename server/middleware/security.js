import helmet from 'helmet';
import cors from 'cors';

// Configure CORS with specific origins
export const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, curl, etc.)
    if (!origin) return callback(null, true);
    
    const allowedOrigins = process.env.CORS_ORIGIN 
      ? process.env.CORS_ORIGIN.split(',').map(o => o.trim())
      : ['http://localhost:3000', 'http://localhost:5173'];
    
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  maxAge: 86400 // 24 hours
};

// Helmet configuration for security headers
export const helmetConfig = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  }
});

// Rate limiting with improved security
export const createRateLimit = () => {
  const rateBuckets = new Map();
  const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
  const RATE_LIMIT_DEFAULT_MAX = 200;
  const UPLOAD_RATE_LIMIT_MAX = Number(process.env.UPLOAD_RATE_LIMIT_MAX || 3);
  const UPLOAD_RATE_LIMIT_WINDOW_MS = Number(process.env.UPLOAD_RATE_LIMIT_WINDOW_MS || (2 * 60 * 1000));

  // Return a factory that creates a middleware with optional scoping options
  return (maxRequests = RATE_LIMIT_DEFAULT_MAX, windowMs = RATE_LIMIT_WINDOW_MS, options = {}) => (req, res, next) => {
    if (req.method === 'OPTIONS') return next();

    const now = Date.now();

    // Generate a bucket key. By default, key by IP only to preserve previous behavior.
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    let key = ip;

    // Support custom key generator or per-path scoping to avoid cross-route interference
    if (typeof options.keyGenerator === 'function') {
      try {
        key = options.keyGenerator(req);
      } catch (_) {
        key = ip;
      }
    } else if (options.perPath) {
      // Use method + path without query string for stability
      const pathOnly = (req.baseUrl || '') + (req.path || (req.originalUrl || '').split('?')[0] || '');
      key = `${ip}|${req.method}|${pathOnly}`;
    }

    const bucket = rateBuckets.get(key) || [];
    const cutoff = now - windowMs;
    const pruned = bucket.filter((t) => t > cutoff);

    // Compute headers
    const oldest = pruned[0] ?? now;
    const resetAt = oldest + windowMs; // ms timestamp when window resets for this key
    const retryAfterSec = Math.max(0, Math.ceil((resetAt - now) / 1000));

    if (pruned.length >= maxRequests) {
      // Standard rate limit headers
      res.setHeader('Retry-After', retryAfterSec);
      res.setHeader('X-RateLimit-Limit', String(maxRequests));
      res.setHeader('X-RateLimit-Remaining', '0');
      res.setHeader('X-RateLimit-Reset', String(Math.ceil(resetAt / 1000))); // unix seconds

      return res.status(429).json({
        success: false,
        error: 'Too many requests from this IP, please try again later.',
        retryAfter: retryAfterSec
      });
    }

    // Allow request and update bucket
    pruned.push(now);
    rateBuckets.set(key, pruned);

    // Remaining after this allowed request
    const remaining = Math.max(0, maxRequests - pruned.length);
    res.setHeader('X-RateLimit-Limit', String(maxRequests));
    res.setHeader('X-RateLimit-Remaining', String(remaining));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(resetAt / 1000)));

    next();
  };
};

// File upload security validation
export const validateFileUpload = (req, res, next) => {
  if (!req.file) {
    return next();
  }

  const file = req.file;
  
  // Additional security checks
  const allowedMimeTypes = [
    'text/csv',
    'application/csv',
    'text/plain',
    'application/vnd.ms-excel'
  ];
  
  if (!allowedMimeTypes.includes(file.mimetype)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid file type. Only CSV files are allowed.'
    });
  }
  
  // Check for suspicious content patterns
  const suspiciousPatterns = [
    /<script/i,
    /javascript:/i,
    /vbscript:/i,
    /onload=/i,
    /onerror=/i
  ];
  
  // This is a basic check - in production, you'd want more sophisticated content scanning
  const filename = file.originalname.toLowerCase();
  for (const pattern of suspiciousPatterns) {
    if (pattern.test(filename)) {
      return res.status(400).json({
        success: false,
        error: 'Suspicious file content detected.'
      });
    }
  }
  
  next();
};

// Request logging middleware
export const requestLogger = (req, res, next) => {
  const start = Date.now();
  const originalSend = res.send;
  
  res.send = function(data) {
    const duration = Date.now() - start;
    console.log(`${new Date().toISOString()} [${req.method}] ${req.originalUrl} - ${res.statusCode} - ${duration}ms - ${req.ip}`);
    originalSend.call(this, data);
  };
  
  next();
};

// Error handling middleware
export const errorHandler = (err, req, res, next) => {
  console.error(`${new Date().toISOString()} [ERROR]`, err);
  
  // Don't leak error details in production
  const isDevelopment = process.env.NODE_ENV === 'development';
  
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: isDevelopment ? err.message : 'Invalid input data'
    });
  }
  
  if (err.name === 'UnauthorizedError') {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized access'
    });
  }
  
  if (err.message && err.message.includes('CORS')) {
    return res.status(403).json({
      success: false,
      error: 'CORS policy violation'
    });
  }
  
  res.status(500).json({
    success: false,
    error: isDevelopment ? err.message : 'Internal server error'
  });
};
