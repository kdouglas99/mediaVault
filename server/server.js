import express from 'express';
import dotenv from 'dotenv';
import pg from 'pg';
import multer from 'multer';
import csvParser from 'csv-parser';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import { corsOptions, helmetConfig, createRateLimit, validateFileUpload, requestLogger, errorHandler } from './middleware/security.js';
import { validateCSVImport, validateItemsQuery, validateDBInit, sanitizeInput, handleValidationErrors } from './middleware/validation.js';
import { body, query } from 'express-validator';

// Setup __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from .env. Prefer project root ../.env, then local .env, without overriding existing env (e.g., from Docker)
try {
    const envCandidates = [
        path.resolve(__dirname, '../.env'),
        path.resolve(__dirname, '.env'),
        path.resolve(process.cwd(), '.env')
    ];
    let loadedPath = null;
    for (const p of envCandidates) {
        if (fs.existsSync(p)) {
            dotenv.config({ path: p, override: false });
            loadedPath = p;
            break;
        }
    }
    if (loadedPath) {
        console.log(new Date().toISOString(), '[INFO]', 'Loaded environment variables from file', { path: loadedPath });
    } else {
        // Fallback to default behavior (search based on CWD)
        dotenv.config();
        console.warn(new Date().toISOString(), '[WARN]', 'No .env file found in expected locations; relying on process environment');
    }
} catch (e) {
    console.error(new Date().toISOString(), '[ERROR]', 'Failed to load .env file', { error: e.message });
}

// Basic console logger (non-blocking)
const logger = {
    info: (message, meta = {}) => console.log(new Date().toISOString(), '[INFO]', message, Object.keys(meta).length ? meta : ''),
    warn: (message, meta = {}) => console.warn(new Date().toISOString(), '[WARN]', message, Object.keys(meta).length ? meta : ''),
    error: (message, meta = {}) => console.error(new Date().toISOString(), '[ERROR]', message, Object.keys(meta).length ? meta : '')
};

// Validate environment variables
const validateEnvironmentVariables = () => {
    const required = ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD', 'DB_PORT'];
    const missing = required.filter((k) => !process.env[k]);
    if (missing.length) {
        logger.error('Missing required environment variables', { missing });
        process.exit(1);
    }
};
validateEnvironmentVariables();

const { Pool } = pg;

// Express app
const app = express();
const PORT = process.env.PORT || 3001;
app.set('trust proxy', 1); // so req.ip is correct behind proxies

// Database pool with improved configuration
const pool = new Pool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    max: Number(process.env.DB_POOL_MAX || 20),
    idleTimeoutMillis: Number(process.env.DB_POOL_IDLE_TIMEOUT || 30000),
    connectionTimeoutMillis: Number(process.env.DB_CONNECTION_TIMEOUT || 5000),
    maxUses: Number(process.env.DB_MAX_USES || 7500),
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

pool.on('error', (err) => {
    logger.error('Unexpected error on idle client', { error: err.message, stack: err.stack });
});

// Enhanced connection retry logic
const connectWithRetry = async (maxRetries = 5, delay = 1000) => {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const client = await pool.connect();
            await client.query('SELECT 1');
            client.release();
            logger.info('Database connection established successfully');
            return true;
        } catch (err) {
            logger.warn(`Database connection attempt ${attempt} failed`, { error: err.message });
            if (attempt === maxRetries) {
                logger.error('All database connection attempts failed');
                throw err;
            }
            await new Promise(resolve => setTimeout(resolve, delay * attempt));
        }
    }
};

// Initialize database schema from schema.sql (idempotent, with retries)
let dbInitialized = false;
const initDatabase = async () => {
    if (dbInitialized) return;

    const maxAttempts = Number(process.env.INIT_DB_MAX_ATTEMPTS || 10);
    const baseDelayMs = Number(process.env.INIT_DB_BASE_DELAY_MS || 1000);
    const schemaPath = path.resolve(__dirname, 'schema.sql');

    if (!fs.existsSync(schemaPath)) {
        logger.warn('Database schema file not found; skipping initialization', { schemaPath });
        dbInitialized = true;
        return;
    }

    let lastError;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        let client;
        try {
            client = await pool.connect();
            await client.query('BEGIN');
            const schemaSql = fs.readFileSync(schemaPath, 'utf8');
            await client.query(schemaSql);
            await client.query('COMMIT');
            dbInitialized = true;
            logger.info('Database initialized successfully', { schemaPath, attempt });
            return;
        } catch (err) {
            lastError = err;
            try { await client?.query('ROLLBACK'); } catch {}
            const delay = baseDelayMs * Math.min(8, 2 ** (attempt - 1));
            logger.warn('Database initialization attempt failed; will retry', { attempt, maxAttempts, delayMs: delay, error: err.message });
            if (attempt < maxAttempts) {
                await new Promise((r) => setTimeout(r, delay));
            }
        }
    }

    logger.error('Database initialization failed after all retry attempts', { error: lastError?.message });
    throw lastError || new Error('Database initialization failed');
};

// Security middleware
app.use(helmetConfig);
app.use(cors(corsOptions));
app.use(requestLogger);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Input sanitization
app.use(sanitizeInput);

// Rate limiting
const rateLimit = createRateLimit();
const RATE_LIMIT_UPLOAD_MAX = Number(process.env.UPLOAD_RATE_LIMIT_MAX || 3);
const UPLOAD_RATE_LIMIT_WINDOW_MS = Number(process.env.UPLOAD_RATE_LIMIT_WINDOW_MS || (2 * 60 * 1000));
// Higher limits for proxy and ingest flows used by the ingest tool
const PROXY_RATE_LIMIT_MAX = Number(process.env.PROXY_RATE_LIMIT_MAX || 120);
const PROXY_RATE_LIMIT_WINDOW_MS = Number(process.env.PROXY_RATE_LIMIT_WINDOW_MS || (60 * 1000));
const INGEST_RATE_LIMIT_MAX = Number(process.env.INGEST_RATE_LIMIT_MAX || 240);
const INGEST_RATE_LIMIT_WINDOW_MS = Number(process.env.INGEST_RATE_LIMIT_WINDOW_MS || (2 * 60 * 1000));

// Health check (used by Docker HEALTHCHECK)
app.get('/health', rateLimit(), async (req, res) => {
    let client;
    try {
        client = await pool.connect();
        await client.query('SELECT 1');
        return res.json({ success: true, status: 'OK', db: 'reachable', initialized: dbInitialized, timestamp: new Date().toISOString() });
    } catch (e) {
        logger.warn('Healthcheck DB failure', { error: e.message });
        return res.status(503).json({ success: false, status: 'DEGRADED', db: 'unreachable', initialized: dbInitialized, error: 'Database not reachable' });
    } finally {
        client?.release();
    }
});

// Add this new endpoint to serve frontend configuration
app.get('/api/config', rateLimit(), (req, res) => {
    res.json({
        success: true,
        config: {
            API_BASE: `${req.protocol}://${req.get('host')}/api`
        }
    });
});

// Database connection test
app.get('/api/test', rateLimit(), async (req, res) => {
    let client;
    try {
        client = await pool.connect();
        const result = await client.query('SELECT NOW() as time');
        res.json({ success: true, time: result.rows[0].time, message: 'Database connection successful' });
    } catch (error) {
        logger.error('Database connection error', { error: error.message, stack: error.stack });
        res.status(500).json({ success: false, error: 'Database connection failed', message: 'Failed to connect to database' });
    } finally {
        client?.release();
    }
});

// Lightweight proxy to fetch external JSON with optional headers
// Accepts either { url, method, headers, body } or { curl }
// Only allows http/https URLs and returns JSON body if possible
app.post(
    '/api/proxy/fetch',
    rateLimit(PROXY_RATE_LIMIT_MAX, PROXY_RATE_LIMIT_WINDOW_MS, { perPath: true }),
    [
        body('url').optional().isString().isLength({ min: 1, max: 20000 }),
        // Accept any string and normalize server-side to allow lowercase values
        body('method').optional().isString().isLength({ min: 1, max: 10 }),
        body('headers').optional().isObject(),
        body('body').optional(),
        // Allow large curl payloads
        body('curl').optional().isString().isLength({ min: 1, max: 200000 }),
        handleValidationErrors
    ],
    async (req, res) => {
        try {
            let targetUrl = req.body.url ? String(req.body.url) : '';
            let method = (req.body.method || 'GET').toString().toUpperCase();
            let headers = (req.body.headers && typeof req.body.headers === 'object') ? req.body.headers : {};
            let bodyPayload = req.body.body ?? null;

            // If cURL is provided, parse it to extract method, url, headers, and body
            if (!targetUrl && typeof req.body.curl === 'string' && req.body.curl.trim()) {
                const parsed = parseCurlCommand(req.body.curl);
                if (parsed) {
                    targetUrl = parsed.url || targetUrl;
                    method = parsed.method || method;
                    headers = { ...headers, ...parsed.headers };
                    if (parsed.body !== undefined) bodyPayload = parsed.body;
                }
            }

            if (!/^https?:\/\//i.test(targetUrl)) {
                return res.status(400).json({ success: false, error: 'Only http/https URLs are allowed' });
            }

            // Prevent SSRF to private networks if configured
            if (process.env.BLOCK_PRIVATE_NETWORKS === 'true') {
                try {
                    const u = new URL(targetUrl);
                    // crude blocklist for localhost/loopback/private names
                    if (/^(localhost|127\.0\.0\.1|::1)$/i.test(u.hostname)) {
                        return res.status(400).json({ success: false, error: 'Target host is not allowed' });
                    }
                } catch (_) {}
            }

            // Normalize headers: drop hop-by-hop and restricted headers
            const disallowedHeaderNames = new Set([
                'host','connection','content-length','accept-encoding','cf-connecting-ip','x-forwarded-for','x-real-ip'
            ]);
            const outHeaders = {};
            for (const [k, v] of Object.entries(headers)) {
                const name = String(k).toLowerCase();
                if (!disallowedHeaderNames.has(name)) {
                    outHeaders[name] = v;
                }
            }

            const controller = new AbortController();
            const timeoutMs = Number(process.env.PROXY_FETCH_TIMEOUT_MS || 15000);
            const t = setTimeout(() => controller.abort(), timeoutMs);

            let fetchBody = undefined;
            if (bodyPayload != null) {
                if (typeof bodyPayload === 'string' || bodyPayload instanceof Buffer) {
                    fetchBody = bodyPayload;
                } else {
                    fetchBody = JSON.stringify(bodyPayload);
                    if (!outHeaders['content-type']) outHeaders['content-type'] = 'application/json';
                }
            }

            const resp = await fetch(targetUrl, { method, headers: outHeaders, body: fetchBody, signal: controller.signal });
            clearTimeout(t);

            const contentType = resp.headers.get('content-type') || '';
            const status = resp.status;
            if (/application\/json/i.test(contentType)) {
                const data = await resp.json().catch(() => null);
                return res.status(resp.ok ? 200 : status).json({ success: true, status, headers: Object.fromEntries(resp.headers.entries()), data });
            } else {
                const text = await resp.text().catch(() => '');
                return res.status(resp.ok ? 200 : status).json({ success: true, status, headers: Object.fromEntries(resp.headers.entries()), text });
            }
        } catch (error) {
            const message = error?.name === 'AbortError' ? 'Upstream fetch timed out' : (error?.message || 'Proxy fetch failed');
            return res.status(502).json({ success: false, error: message });
        }
    }
);

// Basic cURL parser (best-effort; supports common flags: -X, -H, --header, --data, --data-raw)
function parseCurlCommand(curl) {
    try {
        // Collapse backslash continuations and normalize whitespace
        const normalized = curl
            .replace(/\\\n/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        const parts = [];
        let current = '';
        let inSingle = false;
        let inDouble = false;
        for (let i = 0; i < normalized.length; i++) {
            const ch = normalized[i];
            if (ch === "'" && !inDouble) { inSingle = !inSingle; current += ch; continue; }
            if (ch === '"' && !inSingle) { inDouble = !inDouble; current += ch; continue; }
            if (ch === ' ' && !inSingle && !inDouble) { if (current) { parts.push(current); current = ''; } continue; }
            current += ch;
        }
        if (current) parts.push(current);

        // Remove initial curl token
        const tokens = parts.filter(p => p.toLowerCase() !== 'curl');
        let url = '';
        let method = '';
        const headers = {};
        let body;
        for (let i = 0; i < tokens.length; i++) {
            const tok = tokens[i];
            if (tok === '-X' || tok === '--request') {
                method = (tokens[i + 1] || '').replace(/['"]/g, ''); i++; continue;
            }
            if (tok === '-H' || tok === '--header') {
                const hv = (tokens[i + 1] || '').replace(/^['"]|['"]$/g, '');
                const idx = hv.indexOf(':');
                if (idx > -1) {
                    const name = hv.slice(0, idx).trim();
                    const val = hv.slice(idx + 1).trim();
                    headers[name] = val;
                }
                i++; continue;
            }
            if (tok === '--data' || tok === '--data-raw' || tok === '--data-binary' || tok === '-d') {
                const dv = tokens[i + 1];
                if (typeof dv === 'string') {
                    const unquoted = dv.replace(/^['"]|['"]$/g, '');
                    try { body = JSON.parse(unquoted); } catch { body = unquoted; }
                }
                i++; continue;
            }
            if (!tok.startsWith('-') && !url) {
                url = tok.replace(/^['"]|['"]$/g, '');
                continue;
            }
        }
        return { url, method: method || 'GET', headers, body };
    } catch (_) {
        return null;
    }
}

// Simplified parseListParams - only handle basic search and sorting, no pagination on server
const parseListParams = (query) => {
    const search = (query.search ?? '').toString().trim();

    const validSortColumns = ['title', 'series_title', 'season_number', 'episode_number', 'created_at', 'updated_timestamp'];
    const validSortOrders = ['ASC', 'DESC'];
    const sortByRaw = (query.sortBy ?? 'title').toString();
    const sortOrderRaw = (query.sortOrder ?? 'ASC').toString().toUpperCase();
    const sortBy = validSortColumns.includes(sortByRaw) ? sortByRaw : 'title';
    const sortOrder = validSortOrders.includes(sortOrderRaw) ? sortOrderRaw : 'ASC';

    return { search, sortBy, sortOrder };
};

// Get all media items - server returns ALL data, frontend handles pagination and filtering
app.get('/api/items', rateLimit(), validateItemsQuery, async (req, res) => {
    let client;
    try {
        const { search, sortBy, sortOrder } = parseListParams(req.query);

        client = await pool.connect();

        // Build WHERE clause only for basic search
        const conditions = [];
        const params = [];
        let idx = 1;

        if (search) {
            conditions.push(`(title ILIKE $${idx} OR series_title ILIKE $${idx})`);
            params.push(`%${search}%`);
            idx++;
        }

        const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

        // Always return ALL data - let frontend handle pagination and filtering
        const dataSql = `
            SELECT
                id, external_id, guid, title, series_title, season_number, episode_number,
                content_type, availability_state, countries, premium_features,
                updated_timestamp, added_timestamp, created_at, updated_at,
                provider, description, available_date, expiration_date, ratings,
                youtube_video_ids, primary_category_name, primary_category_id,
                source_partner, video_id, pub_date, content, thumbnails
            FROM media_items
                     ${whereClause}
            ORDER BY ${sortBy} ${sortOrder}
        `;

        const { rows } = await client.query(dataSql, params);

        // Return all data with simple metadata
        res.json({
            success: true,
            data: rows,
            totalItems: rows.length
        });
    } catch (error) {
        logger.error('Error fetching items', { error: error.message, stack: error.stack, query: req.query });
        res.status(500).json({ success: false, error: 'Failed to fetch media items' });
    } finally {
        client?.release();
    }
});

// Stats endpoint
app.get('/api/stats', rateLimit(), async (req, res) => {
    let client;
    try {
        client = await pool.connect();
        const queries = [
            'SELECT COUNT(*)::int as total_items FROM media_items',
            `SELECT content_type, COUNT(*)::int as count FROM media_items WHERE content_type IS NOT NULL GROUP BY content_type ORDER BY count DESC`,
            `SELECT availability_state, COUNT(*)::int as count FROM media_items WHERE availability_state IS NOT NULL GROUP BY availability_state ORDER BY count DESC`,
            `SELECT feature, COUNT(*)::int as count
             FROM (
                 SELECT unnest(premium_features) as feature FROM media_items WHERE premium_features IS NOT NULL
                 ) t
             GROUP BY feature
             ORDER BY count DESC`,
            `SELECT COUNT(DISTINCT series_title)::int as series_count FROM media_items WHERE series_title IS NOT NULL`
        ];
        const [totalResult, contentTypeResult, availabilityResult, featuresResult, seriesResult] = await Promise.all(
            queries.map((q) => client.query(q))
        );
        res.json({
            success: true,
            data: {
                totalItems: totalResult.rows[0].total_items,
                totalSeries: seriesResult.rows[0].series_count,
                contentTypes: contentTypeResult.rows,
                availabilityStates: availabilityResult.rows,
                premiumFeatures: featuresResult.rows.slice(0, 10)
            }
        });
    } catch (error) {
        logger.error('Error fetching stats', { error: error.message, stack: error.stack });
        res.status(500).json({ success: false, error: 'Failed to fetch statistics' });
    } finally {
        client?.release();
    }
});

// Mux Performance Stats Endpoints
// Create or update mux performance stats
app.post(
    '/api/mux-stats',
    rateLimit(),
    [
        body('collected_at').optional().isISO8601().withMessage('collected_at must be ISO8601 datetime'),
        body('time_window').optional().isString().isLength({ min: 1, max: 16 }),
        body('comparison_window').optional().isString().isLength({ min: 1, max: 32 }),

        body('total_view_count').optional().isInt({ min: 0 }).toInt(),
        body('total_view_count_delta').optional().isFloat().toFloat(),
        body('total_playing_time_minutes').optional().isInt({ min: 0 }).toInt(),
        body('total_playing_time_delta').optional().isFloat().toFloat(),
        body('total_unique_viewers').optional().isInt({ min: 0 }).toInt(),
        body('total_unique_viewers_delta').optional().isFloat().toFloat(),

        body('overall_experience_avg').optional().isInt({ min: 0, max: 100 }).toInt(),
        body('overall_experience_delta').optional().isFloat().toFloat(),
        body('playback_success_avg').optional().isInt({ min: 0, max: 100 }).toInt(),
        body('playback_success_delta').optional().isFloat().toFloat(),
        body('startup_time_avg').optional().isInt({ min: 0, max: 100 }).toInt(),
        body('startup_time_delta').optional().isFloat().toFloat(),
        body('smoothness_avg').optional().isInt({ min: 0, max: 100 }).toInt(),
        body('smoothness_delta').optional().isFloat().toFloat(),
        body('video_quality_avg').optional().isInt({ min: 0, max: 100 }).toInt(),
        body('video_quality_delta').optional().isFloat().toFloat(),

        body('failure_percent').optional().isFloat({ min: 0 }).toFloat(),
        body('failure_percent_delta').optional().isFloat().toFloat(),
        body('rebuffer_percent').optional().isFloat({ min: 0 }).toFloat(),
        body('rebuffer_percent_delta').optional().isFloat().toFloat(),

        body('meta').optional().isObject(),
        handleValidationErrors
    ],
    async (req, res) => {
        let client;
        try {
            client = await pool.connect();
            const fields = [
                'collected_at','time_window','comparison_window',
                'total_view_count','total_view_count_delta','total_playing_time_minutes','total_playing_time_delta',
                'total_unique_viewers','total_unique_viewers_delta',
                'overall_experience_avg','overall_experience_delta',
                'playback_success_avg','playback_success_delta',
                'startup_time_avg','startup_time_delta',
                'smoothness_avg','smoothness_delta',
                'video_quality_avg','video_quality_delta',
                'failure_percent','failure_percent_delta',
                'rebuffer_percent','rebuffer_percent_delta',
                'meta'
            ];
            const values = fields.map(k => req.body[k] ?? null);
            const placeholders = fields.map((_, i) => `$${i + 1}`).join(',');
            const sql = `INSERT INTO mux_performance_stats(${fields.join(',')}) VALUES (${placeholders}) RETURNING id, collected_at`;
            const { rows } = await client.query(sql, values);
            return res.json({ success: true, id: rows[0]?.id, collected_at: rows[0]?.collected_at });
        } catch (error) {
            logger.error('Error inserting mux stats', { error: error.message, stack: error.stack });
            return res.status(500).json({ success: false, error: 'Failed to insert mux stats' });
        } finally {
            client?.release();
        }
    }
);

// Get mux performance stats (latest first)
app.get(
    '/api/mux-stats',
    rateLimit(),
    [
        query('limit').optional().isInt({ min: 1, max: 500 }).toInt(),
        query('time_window').optional().isString().isLength({ min: 1, max: 16 }),
        handleValidationErrors
    ],
    async (req, res) => {
        let client;
        try {
            client = await pool.connect();
            const limit = Number(req.query.limit || 1);
            const timeWindow = req.query.time_window ? String(req.query.time_window) : null;
            const params = [];
            let where = '';
            if (timeWindow) {
                params.push(timeWindow);
                where = 'WHERE time_window = $1';
            }
            params.push(limit);
            const sql = `SELECT * FROM mux_performance_stats ${where} ORDER BY collected_at DESC NULLS LAST, id DESC LIMIT $${params.length}`;
            const { rows } = await client.query(sql, params);
            return res.json({ success: true, data: rows });
        } catch (error) {
            logger.error('Error fetching mux stats', { error: error.message, stack: error.stack });
            return res.status(500).json({ success: false, error: 'Failed to fetch mux stats' });
        } finally {
            client?.release();
        }
    }
);

// Database initialization handler
const initDbHandler = async (req, res) => {
    let client;
    try {
        client = await pool.connect();

        await client.query(`
            CREATE TABLE IF NOT EXISTS media_items (
                                                       id SERIAL PRIMARY KEY,
                                                       external_id TEXT UNIQUE,
                                                       guid TEXT,
                                                       title TEXT,
                                                       series_title TEXT,
                                                       season_number INTEGER,
                                                       episode_number INTEGER,
                                                       content_type TEXT,
                                                       availability_state TEXT,
                                                       countries TEXT[],
                                                       premium_features TEXT[],
                                                       updated_timestamp BIGINT,
                                                       added_timestamp BIGINT,
                                                       created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                                                       updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                                                       provider TEXT,
                                                       description TEXT,
                                                       available_date TIMESTAMP NULL,
                                                       expiration_date TIMESTAMP NULL,
                                                       ratings JSONB,
                                                       youtube_video_ids TEXT[],
                                                       primary_category_name TEXT,
                                                       primary_category_id TEXT,
                                                       source_partner TEXT,
                                                       video_id TEXT,
                                                       pub_date TIMESTAMP NULL,
                                                       content JSONB,
                                                       thumbnails JSONB,
                                                       cbs JSONB,
                                                       ytcp JSONB,
                                                       yt JSONB,
                                                       msn JSONB,
                                                       pl2 JSONB
            );

            -- Ensure columns exist on existing installations
            ALTER TABLE media_items ADD COLUMN IF NOT EXISTS provider TEXT;
            ALTER TABLE media_items ADD COLUMN IF NOT EXISTS description TEXT;
            ALTER TABLE media_items ADD COLUMN IF NOT EXISTS available_date TIMESTAMP NULL;
            ALTER TABLE media_items ADD COLUMN IF NOT EXISTS expiration_date TIMESTAMP NULL;
            ALTER TABLE media_items ADD COLUMN IF NOT EXISTS ratings JSONB;
            ALTER TABLE media_items ADD COLUMN IF NOT EXISTS youtube_video_ids TEXT[];
            ALTER TABLE media_items ADD COLUMN IF NOT EXISTS primary_category_name TEXT;
            ALTER TABLE media_items ADD COLUMN IF NOT EXISTS primary_category_id TEXT;
            ALTER TABLE media_items ADD COLUMN IF NOT EXISTS source_partner TEXT;
            ALTER TABLE media_items ADD COLUMN IF NOT EXISTS video_id TEXT;
            ALTER TABLE media_items ADD COLUMN IF NOT EXISTS pub_date TIMESTAMP NULL;
            ALTER TABLE media_items ADD COLUMN IF NOT EXISTS content JSONB;
            ALTER TABLE media_items ADD COLUMN IF NOT EXISTS thumbnails JSONB;
            ALTER TABLE media_items ADD COLUMN IF NOT EXISTS cbs JSONB;
            ALTER TABLE media_items ADD COLUMN IF NOT EXISTS ytcp JSONB;
            ALTER TABLE media_items ADD COLUMN IF NOT EXISTS yt JSONB;
            ALTER TABLE media_items ADD COLUMN IF NOT EXISTS msn JSONB;
            ALTER TABLE media_items ADD COLUMN IF NOT EXISTS pl2 JSONB;

            CREATE TABLE IF NOT EXISTS media_items_staging (
                                                               id TEXT,
                                                               guid TEXT,
                                                               title TEXT,
                                                               series_title TEXT,
                                                               season_number TEXT,
                                                               episode_number TEXT,
                                                               content_type TEXT,
                                                               availabilityState TEXT,
                                                               countries TEXT,
                                                               premium_features TEXT,
                                                               updated TEXT,
                                                               added TEXT,
                                                               provider TEXT,
                                                               description TEXT,
                                                               availableDate TEXT,
                                                               expirationDate TEXT,
                                                               ratings TEXT,
                                                               pubDate TEXT,
                                                               primary_category_name TEXT,
                                                               primary_category_id TEXT,
                                                               source_partner TEXT,
                                                               video_id TEXT,
                                                               youtube_video_ids TEXT,
                                                               raw_row JSONB
            );

            CREATE INDEX IF NOT EXISTS idx_media_items_title ON media_items(title);
            CREATE INDEX IF NOT EXISTS idx_media_items_series_title ON media_items(series_title);
            CREATE INDEX IF NOT EXISTS idx_media_items_content_type ON media_items(content_type);
            CREATE INDEX IF NOT EXISTS idx_media_items_availability_state ON media_items(availability_state);
            CREATE INDEX IF NOT EXISTS idx_media_items_external_id ON media_items(external_id);
        `);

        // Ensure mux_performance_stats table exists (idempotent)
        await client.query(`
            CREATE TABLE IF NOT EXISTS mux_performance_stats (
                id SERIAL PRIMARY KEY,
                collected_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                time_window TEXT NOT NULL DEFAULT '1h',
                comparison_window TEXT,

                total_view_count BIGINT,
                total_view_count_delta NUMERIC,
                total_playing_time_minutes BIGINT,
                total_playing_time_delta NUMERIC,
                total_unique_viewers BIGINT,
                total_unique_viewers_delta NUMERIC,

                overall_experience_avg SMALLINT CHECK (overall_experience_avg BETWEEN 0 AND 100),
                overall_experience_delta NUMERIC,
                playback_success_avg SMALLINT CHECK (playback_success_avg BETWEEN 0 AND 100),
                playback_success_delta NUMERIC,
                startup_time_avg SMALLINT CHECK (startup_time_avg BETWEEN 0 AND 100),
                startup_time_delta NUMERIC,
                smoothness_avg SMALLINT CHECK (smoothness_avg BETWEEN 0 AND 100),
                smoothness_delta NUMERIC,
                video_quality_avg SMALLINT CHECK (video_quality_avg BETWEEN 0 AND 100),
                video_quality_delta NUMERIC,

                failure_percent NUMERIC,
                failure_percent_delta NUMERIC,
                rebuffer_percent NUMERIC,
                rebuffer_percent_delta NUMERIC,

                meta JSONB
            );
            CREATE INDEX IF NOT EXISTS idx_mux_stats_collected_at ON mux_performance_stats(collected_at DESC);
            CREATE INDEX IF NOT EXISTS idx_mux_stats_time_window ON mux_performance_stats(time_window);
        `);

        await client.query(`
      CREATE OR REPLACE FUNCTION import_media_csv()
      RETURNS INTEGER AS $$
      DECLARE
        inserted_count INTEGER := 0;
        rec RECORD;
        v_countries TEXT[];
        v_premium TEXT[];
        v_ratings JSONB;
        v_youtube_ids TEXT[];
        v_available TIMESTAMP;
        v_expiration TIMESTAMP;
        v_updated BIGINT;
        v_added BIGINT;
        v_pubdate TIMESTAMP;
        v_content JSONB;
        v_thumbs JSONB;
        v_cbs JSONB;
        v_ytcp JSONB;
        v_yt JSONB;
        v_msn JSONB;
        v_pl2 JSONB;
      BEGIN
        FOR rec IN SELECT * FROM media_items_staging LOOP
          -- Countries/premium features may come as JSON string arrays or comma strings
          BEGIN
            v_countries := CASE
              WHEN rec.countries ~ '^\\s*\\[' THEN (SELECT array_agg(elem::text) FROM jsonb_array_elements_text(rec.countries::jsonb) elem)
              WHEN rec.countries IS NULL OR rec.countries = '' THEN NULL
              ELSE string_to_array(rec.countries, ',')
            END;
          EXCEPTION WHEN others THEN v_countries := string_to_array(rec.countries, ',');
          END;

          BEGIN
            v_premium := CASE
              WHEN rec.premium_features ~ '^\\s*\\[' THEN (SELECT array_agg(elem::text) FROM jsonb_array_elements_text(rec.premium_features::jsonb) elem)
              WHEN rec.premium_features IS NULL OR rec.premium_features = '' THEN NULL
              ELSE string_to_array(rec.premium_features, ',')
            END;
          EXCEPTION WHEN others THEN v_premium := string_to_array(rec.premium_features, ',');
          END;

          BEGIN
            v_ratings := NULLIF(rec.ratings, '')::jsonb;
          EXCEPTION WHEN others THEN v_ratings := NULL;
          END;

          -- ytcp$youTubeVideoIds may be a map like {"9287":"abc"}; flatten to array of values
          BEGIN
            IF rec.youtube_video_ids IS NULL OR rec.youtube_video_ids = '' THEN
              v_youtube_ids := NULL;
            ELSIF rec.youtube_video_ids ~ '^\\s*\\{' THEN
              v_youtube_ids := ARRAY(
                SELECT value::text
                FROM jsonb_each_text(rec.youtube_video_ids::jsonb)
              );
            ELSIF rec.youtube_video_ids ~ '^\\s*\\[' THEN
              v_youtube_ids := (SELECT array_agg(elem::text) FROM jsonb_array_elements_text(rec.youtube_video_ids::jsonb) elem);
            ELSE
              v_youtube_ids := string_to_array(rec.youtube_video_ids, ',');
            END IF;
          EXCEPTION WHEN others THEN v_youtube_ids := string_to_array(rec.youtube_video_ids, ',');
          END;

          -- timestamps: try ISO8601 first, fallback NULL
          BEGIN v_available := NULLIF(rec.availableDate,'')::timestamp; EXCEPTION WHEN others THEN v_available := NULL; END;
          BEGIN v_expiration := NULLIF(rec.expirationDate,'')::timestamp; EXCEPTION WHEN others THEN v_expiration := NULL; END;
          BEGIN v_pubdate := NULLIF(rec.pubDate,'')::timestamp; EXCEPTION WHEN others THEN v_pubdate := NULL; END;

          -- numeric millis if provided
          BEGIN v_updated := CASE WHEN rec.updated ~ '^\\d+$' THEN rec.updated::bigint ELSE NULL END; EXCEPTION WHEN others THEN v_updated := NULL; END;
          BEGIN v_added := CASE WHEN rec.added ~ '^\\d+$' THEN rec.added::bigint ELSE NULL END; EXCEPTION WHEN others THEN v_added := NULL; END;

          -- Extract nested arrays/content/thumbnail blocks from raw_row by prefix grouping if present upstream
          v_content := COALESCE(rec.raw_row->'content', NULL);
          v_thumbs := COALESCE(rec.raw_row->'thumbnails', NULL);

          -- Buckets for vendor namespaces (keep everything)
          v_cbs := COALESCE(rec.raw_row->'cbs', NULL);
          v_ytcp := COALESCE(rec.raw_row->'ytcp', NULL);
          v_yt := COALESCE(rec.raw_row->'yt', NULL);
          v_msn := COALESCE(rec.raw_row->'msn', NULL);
          v_pl2 := COALESCE(rec.raw_row->'pl2', NULL);

          INSERT INTO media_items (
            external_id,
            guid,
            title,
            series_title,
            season_number,
            episode_number,
            content_type,
            availability_state,
            countries,
            premium_features,
            updated_timestamp,
            added_timestamp,
            provider,
            description,
            available_date,
            expiration_date,
            ratings,
            youtube_video_ids,
            primary_category_name,
            primary_category_id,
            source_partner,
            video_id,
            pub_date,
            content,
            thumbnails,
            cbs, ytcp, yt, msn, pl2
          ) VALUES (
            rec.id,
            rec.guid,
            rec.title,
            rec.series_title,
            CASE WHEN rec.season_number ~ '^\\d+(\\.\\d+)?$' THEN rec.season_number::NUMERIC::INTEGER ELSE NULL END,
            CASE WHEN rec.episode_number ~ '^\\d+(\\.\\d+)?$' THEN rec.episode_number::NUMERIC::INTEGER ELSE NULL END,
            rec.content_type,
            rec.availabilityState,
            v_countries,
            v_premium,
            v_updated,
            v_added,
            rec.provider,
            rec.description,
            v_available,
            v_expiration,
            v_ratings,
            v_youtube_ids,
            rec.primary_category_name,
            rec.primary_category_id,
            rec.source_partner,
            rec.video_id,
            v_pubdate,
            v_content,
            v_thumbs,
            v_cbs, v_ytcp, v_yt, v_msn, v_pl2
          )
          ON CONFLICT (external_id) DO UPDATE SET
            guid = EXCLUDED.guid,
            title = EXCLUDED.title,
            series_title = EXCLUDED.series_title,
            season_number = EXCLUDED.season_number,
            episode_number = EXCLUDED.episode_number,
            content_type = EXCLUDED.content_type,
            availability_state = EXCLUDED.availability_state,
            countries = EXCLUDED.countries,
            premium_features = EXCLUDED.premium_features,
            updated_timestamp = EXCLUDED.updated_timestamp,
            added_timestamp = EXCLUDED.added_timestamp,
            provider = EXCLUDED.provider,
            description = EXCLUDED.description,
            available_date = EXCLUDED.available_date,
            expiration_date = EXCLUDED.expiration_date,
            ratings = EXCLUDED.ratings,
            youtube_video_ids = EXCLUDED.youtube_video_ids,
            primary_category_name = EXCLUDED.primary_category_name,
            primary_category_id = EXCLUDED.primary_category_id,
            source_partner = EXCLUDED.source_partner,
            video_id = EXCLUDED.video_id,
            pub_date = EXCLUDED.pub_date,
            content = EXCLUDED.content,
            thumbnails = EXCLUDED.thumbnails,
            cbs = EXCLUDED.cbs,
            ytcp = EXCLUDED.ytcp,
            yt = EXCLUDED.yt,
            msn = EXCLUDED.msn,
            pl2 = EXCLUDED.pl2,
            updated_at = CURRENT_TIMESTAMP;

          inserted_count := inserted_count + 1;
        END LOOP;

        RETURN inserted_count;
      END;
      $$ LANGUAGE plpgsql;
    `);

        res.json({ success: true, message: 'Database initialized' });
    } catch (error) {
        logger.error('DB init error', { error: error.message, stack: error.stack });
        res.status(500).json({ success: false, error: 'Database initialization failed' });
    } finally {
        client?.release();
    }
};

app.post('/api/init-db', rateLimit(), validateDBInit, initDbHandler);
app.get('/api/init-db', rateLimit(), initDbHandler);

// CSV Import functionality
const uploadsDir = path.join(__dirname, 'uploads');
await fs.promises.mkdir(uploadsDir, { recursive: true }).catch(() => {});

const upload = multer({
    dest: uploadsDir,
    limits: { 
        fileSize: Number(process.env.MAX_FILE_SIZE || 50 * 1024 * 1024), 
        files: 1 
    },
    fileFilter: (req, file, cb) => {
        const allowedMimeTypes = [
            'text/csv',
            'application/csv',
            'text/plain',
            'application/vnd.ms-excel'
        ];
        
        const fileExtension = file.originalname.toLowerCase().substring(file.originalname.lastIndexOf('.'));
        const isCSV = fileExtension === '.csv';
        const isValidMimeType = allowedMimeTypes.includes(file.mimetype);
        
        if (isCSV && isValidMimeType) {
            cb(null, true);
        } else {
            cb(new Error('Only CSV files are allowed'));
        }
    }
});

const insertBatchIntoStaging = async (client, rows) => {
    if (!rows.length) return;

    const cols = [
        'id','guid','title','series_title','season_number','episode_number',
        'content_type','availabilityState','countries','premium_features',
        'updated','added','provider','description','availableDate','expirationDate',
        'ratings','pubDate','primary_category_name','primary_category_id',
        'source_partner','video_id','youtube_video_ids','raw_row'
    ];

    const safeJson = (v) => {
        if (v === undefined || v === null || v === '') return null;
        try { return JSON.parse(v); } catch { return null; }
    };

    const parseArrayish = (v) => {
        if (v == null) return null;
        let s = typeof v === 'string' ? v.trim() : String(v);
        if (!s) return null;

        // Try JSON array first
        try {
            const j = JSON.parse(s);
            if (Array.isArray(j)) {
                return j.map(x => String(x).trim()).filter(Boolean).join(',');
            }
        } catch {}

        // Handle artifacts like "] [" or "][" from concatenated arrays, strip wrapping brackets/quotes
        s = s
            .replace(/\]\s*\[/g, ',')           // "] [" or "]["
            .replace(/^[\[\(\{]+|[\]\)\}]+$/g, '') // outer brackets/braces
            .replace(/["']/g, '');                // remove quotes

        // Normalize common separators to comma
        s = s.replace(/[;|/]+/g, ',');
        // Normalize spaces around commas and collapse multiples
        s = s.replace(/\s*,\s*/g, ',').replace(/\s+/g, ' ');

        const parts = s.split(',').map(x => x.trim()).filter(Boolean);
        if (!parts.length) return null;
        return parts.join(',');
    };

    // Group raw columns by namespace and arrays for downstream JSONB convenience
    const mungeRaw = (r) => {
        const raw = {};
        const contentArr = [];
        const thumbsArr = [];
        const cbs = {};
        const ytcp = {};
        const yt = {};
        const msn = {};
        const pl2 = {};

        for (const [k, v] of Object.entries(r)) {
            if (k.startsWith('content[')) {
                const m = k.match(/^content\[(\d+)\]\.(.+)$/);
                if (m) {
                    const idx = Number(m[1]);
                    contentArr[idx] = contentArr[idx] || {};
                    contentArr[idx][m[2]] = v;
                }
                continue;
            }
            if (k.startsWith('thumbnails[')) {
                const m = k.match(/^thumbnails\[(\d+)\]\.(.+)$/);
                if (m) {
                    const idx = Number(m[1]);
                    thumbsArr[idx] = thumbsArr[idx] || {};
                    thumbsArr[idx][m[2]] = v;
                }
                continue;
            }
            if (k.startsWith('cbs$')) { cbs[k.slice(4)] = v; continue; }
            if (k.startsWith('ytcp$')) { ytcp[k.slice(5)] = v; continue; }
            if (k.startsWith('yt$')) { yt[k.slice(3)] = v; continue; }
            if (k.startsWith('msn$')) { msn[k.slice(4)] = v; continue; }
            if (k.startsWith('pl2$')) { pl2[k.slice(4)] = v; continue; }
            raw[k] = v;
        }
        if (contentArr.length) raw.content = contentArr;
        if (thumbsArr.length) raw.thumbnails = thumbsArr;
        if (Object.keys(cbs).length) raw.cbs = cbs;
        if (Object.keys(ytcp).length) raw.ytcp = ytcp;
        if (Object.keys(yt).length) raw.yt = yt;
        if (Object.keys(msn).length) raw.msn = msn;
        if (Object.keys(pl2).length) raw.pl2 = pl2;

        // Pass through pre-nested structures if present (for JSON imports)
        if (!raw.content && Array.isArray(r.content)) raw.content = r.content;
        if (!raw.thumbnails && Array.isArray(r.thumbnails)) raw.thumbnails = r.thumbnails;
        if (!raw.cbs && r.cbs && typeof r.cbs === 'object') raw.cbs = r.cbs;
        if (!raw.ytcp && r.ytcp && typeof r.ytcp === 'object') raw.ytcp = r.ytcp;
        if (!raw.yt && r.yt && typeof r.yt === 'object') raw.yt = r.yt;
        if (!raw.msn && r.msn && typeof r.msn === 'object') raw.msn = r.msn;
        if (!raw.pl2 && r.pl2 && typeof r.pl2 === 'object') raw.pl2 = r.pl2;

        return raw;
    };

    const values = [];
    const params = [];
    let p = 1;

    for (const r of rows) {
        const countries = parseArrayish(r.countries);
        const premium = parseArrayish(r['cbs$premiumFeatures'] ?? r.premium_features);
        const youtubeIdsRaw = r['ytcp$youTubeVideoIds'];

        const record = {
            id: r.id ?? null,
            guid: r.guid ?? null,
            title: r.title ?? null,
            series_title: r['cbs$SeriesTitle'] ?? r.series_title ?? null,
            season_number: r['cbs$SeasonNumber'] ?? r.season_number ?? null,
            episode_number: r['cbs$EpisodeNumber'] ?? r.episode_number ?? null,
            content_type: r['cbs$contentType'] ?? r.content_type ?? null,
            availabilityState: r.availabilityState ?? null,
            countries,
            premium_features: premium,
            updated: r.updated ?? null,
            added: r.added ?? null,
            provider: r.provider ?? null,
            description: r.description ?? null,
            availableDate: r.availableDate ?? null,
            expirationDate: r.expirationDate ?? null,
            ratings: r.ratings ?? null,
            pubDate: r.pubDate ?? null,
            primary_category_name: r['cbs$PrimaryCategoryName'] ?? null,
            primary_category_id: r['cbs$PrimaryCategory'] ?? null,
            source_partner: r['cbs$SourcePartner'] ?? null,
            video_id: r['cbs$VideoID'] ?? null,
            youtube_video_ids: youtubeIdsRaw ?? null,
            raw_row: JSON.stringify(mungeRaw(r))
        };

        values.push(`(${cols.map(() => `$${p++}`).join(',')})`);
        params.push(
            record.id, record.guid, record.title, record.series_title, record.season_number,
            record.episode_number, record.content_type, record.availabilityState, record.countries,
            record.premium_features, record.updated, record.added, record.provider, record.description,
            record.availableDate, record.expirationDate, record.ratings, record.pubDate,
            record.primary_category_name, record.primary_category_id, record.source_partner,
            record.video_id, record.youtube_video_ids, record.raw_row
        );
    }

    const sql = `INSERT INTO media_items_staging (${cols.join(',')}) VALUES ${values.join(',')}`;
    await client.query(sql, params);
};

app.post('/api/import/csv', rateLimit(INGEST_RATE_LIMIT_MAX, INGEST_RATE_LIMIT_WINDOW_MS, { perPath: true }), upload.single('csvFile'), validateFileUpload, validateCSVImport, async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ success: false, error: 'CSV file is required' });
    }

    const filePath = req.file.path;
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    let client;

    try {
        client = await pool.connect();
        await client.query('BEGIN');
        await client.query('TRUNCATE TABLE media_items_staging');

        const BATCH_SIZE = 500;
        let batch = [];
        const stream = fs.createReadStream(filePath).pipe(csvParser({
            mapHeaders: ({ header }) => header?.trim()
        }));

        await new Promise((resolve, reject) => {
            stream.on('data', async (row) => {
                batch.push(row);
                if (batch.length >= BATCH_SIZE) {
                    stream.pause();
                    insertBatchIntoStaging(client, batch)
                        .then(() => {
                            batch = [];
                            stream.resume();
                        })
                        .catch(reject);
                }
            });
            stream.on('end', async () => {
                try {
                    if (batch.length) {
                        await insertBatchIntoStaging(client, batch);
                        batch = [];
                    }
                    const { rows } = await client.query('SELECT import_media_csv() AS imported');
                    await client.query('COMMIT');
                    resolve(rows[0]);
                } catch (e) {
                    reject(e);
                }
            });
            stream.on('error', reject);
        });

        fs.unlink(filePath, () => {});

        res.json({ success: true, message: 'CSV imported successfully' });
    } catch (error) {
        logger.error('CSV import failed', { error: error.message, stack: error.stack });
        try {
            await client?.query('ROLLBACK');
        } catch {}
        res.status(500).json({ success: false, error: 'CSV import failed' });
    } finally {
        client?.release();
        fs.unlink(filePath, () => {});
    }
});

// JSON Import functionality (mirrors CSV import flow via staging + import function)
app.post('/api/import/json', rateLimit(INGEST_RATE_LIMIT_MAX, INGEST_RATE_LIMIT_WINDOW_MS, { perPath: true }), async (req, res) => {
    const items = Array.isArray(req.body?.items) ? req.body.items : null;
    if (!items || items.length === 0) {
        return res.status(400).json({ success: false, error: 'Request body must include a non-empty array "items"' });
    }

    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');
        await client.query('TRUNCATE TABLE media_items_staging');

        const BATCH_SIZE = 500;
        for (let i = 0; i < items.length; i += BATCH_SIZE) {
            const batch = items.slice(i, i + BATCH_SIZE);
            await insertBatchIntoStaging(client, batch);
        }

        const { rows } = await client.query('SELECT import_media_csv() AS imported');
        await client.query('COMMIT');
        res.json({ success: true, message: 'JSON imported successfully', imported: rows?.[0]?.imported ?? null });
    } catch (error) {
        logger.error('JSON import failed', { error: error.message, stack: error.stack });
        try { await client?.query('ROLLBACK'); } catch {}
        res.status(500).json({ success: false, error: 'JSON import failed' });
    } finally {
        client?.release();
    }
});

// Error handling middleware
app.use(errorHandler);

// Debug endpoint for development
if (process.env.NODE_ENV === 'development') {
    app.get('/api/debug/tables', rateLimit(), async (req, res) => {
        let client;
        try {
            client = await pool.connect();
            const result = await client.query(`
                SELECT table_name
                FROM information_schema.tables
                WHERE table_schema = 'public'
                ORDER BY table_name
            `);
            res.json({ success: true, tables: result.rows, environment: 'development' });
        } catch (error) {
            logger.error('Debug tables error', { error: error.message });
            res.status(500).json({ success: false, error: 'Failed to list tables' });
        } finally {
            client?.release();
        }
    });
}

// 404 handler
app.use((req, res) => {
    logger.warn('Route not found', { method: req.method, url: req.originalUrl });
    res.status(404).json({ success: false, error: 'Not found' });
});

// Start server after DB initialization
let server;
try {
    await connectWithRetry();
    await initDatabase();
    server = app.listen(PORT, '0.0.0.0', () => {
        logger.info(`Server listening on port ${PORT} and bound to 0.0.0.0`);
    });
} catch (e) {
    logger.error('Server failed to start due to database initialization error', { error: e.message });
    process.exit(1);
}

// Graceful shutdown
const shutdown = async () => {
    logger.info('Shutting down...');
    server?.close(async () => {
        try {
            await pool.end();
        } catch (e) {
            // ignore
        } finally {
            process.exit(0);
        }
    });
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);