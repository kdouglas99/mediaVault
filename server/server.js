import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import pg from 'pg';
import multer from 'multer';
import csvParser from 'csv-parser';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Load environment variables
dotenv.config();

// Setup __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

// Database pool
const pool = new Pool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    maxUses: 7500
});

pool.on('error', (err) => {
    logger.error('Unexpected error on idle client', { error: err.message, stack: err.stack });
});

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Lightweight in-memory window rate limiter (per-process)
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT_DEFAULT_MAX = 100;
const RATE_LIMIT_UPLOAD_MAX = Number(process.env.UPLOAD_RATE_LIMIT_MAX || 3);
const UPLOAD_RATE_LIMIT_WINDOW_MS = Number(process.env.UPLOAD_RATE_LIMIT_WINDOW_MS || (2 * 60 * 1000));
const rateBuckets = new Map();

const rateLimit = (maxRequests = RATE_LIMIT_DEFAULT_MAX, windowMs = RATE_LIMIT_WINDOW_MS) => (req, res, next) => {
    if (req.method === 'OPTIONS') return next();
    const now = Date.now();
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    const bucket = rateBuckets.get(ip) || [];
    const cutoff = now - windowMs;
    const pruned = bucket.filter((t) => t > cutoff);
    if (pruned.length >= maxRequests) {
        return res.status(429).json({ success: false, error: 'Too many requests from this IP, please try again later.' });
    }
    pruned.push(now);
    rateBuckets.set(ip, pruned);
    next();
};

// Health check
app.get('/health', rateLimit(), (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
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
app.get('/api/items', rateLimit(), async (req, res) => {
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
                updated_timestamp, added_timestamp, created_at, updated_at
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
                                                       updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS media_items_staging (
                                                               id TEXT,
                                                               guid TEXT,
                                                               updated TEXT,
                                                               title TEXT,
                                                               added TEXT,
                                                               countries TEXT,
                                                               availabilityState TEXT,
                                                               episode_number TEXT,
                                                               omit TEXT,
                                                               primary_category_id TEXT,
                                                               primary_category_name TEXT,
                                                               season_number TEXT,
                                                               series_title TEXT,
                                                               content_type TEXT,
                                                               premium_features TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_media_items_title ON media_items(title);
            CREATE INDEX IF NOT EXISTS idx_media_items_series_title ON media_items(series_title);
            CREATE INDEX IF NOT EXISTS idx_media_items_content_type ON media_items(content_type);
            CREATE INDEX IF NOT EXISTS idx_media_items_availability_state ON media_items(availability_state);
            CREATE INDEX IF NOT EXISTS idx_media_items_external_id ON media_items(external_id);
        `);

        await client.query(`
      CREATE OR REPLACE FUNCTION import_media_csv()
      RETURNS INTEGER AS $$
      DECLARE
        inserted_count INTEGER := 0;
        rec RECORD;
      BEGIN
        FOR rec IN SELECT * FROM media_items_staging LOOP
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
            added_timestamp
          ) VALUES (
            rec.id,
            rec.guid,
            rec.title,
            rec.series_title,
            CASE WHEN rec.season_number ~ '^\\d+(\\.\\d+)?$' THEN rec.season_number::NUMERIC::INTEGER ELSE NULL END,
            CASE WHEN rec.episode_number ~ '^\\d+(\\.\\d+)?$' THEN rec.episode_number::NUMERIC::INTEGER ELSE NULL END,
            rec.content_type,
            rec.availabilityState,
            string_to_array(rec.countries, ','),
            string_to_array(rec.premium_features, ','),
            CASE WHEN rec.updated ~ '^\\d+$' THEN rec.updated::BIGINT ELSE NULL END,
            CASE WHEN rec.added ~ '^\\d+$' THEN rec.added::BIGINT ELSE NULL END
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

app.post('/api/init-db', rateLimit(), initDbHandler);
app.get('/api/init-db', rateLimit(), initDbHandler);

// CSV Import functionality
const uploadsDir = path.join(__dirname, 'uploads');
await fs.promises.mkdir(uploadsDir, { recursive: true }).catch(() => {});

const upload = multer({
    dest: uploadsDir,
    limits: { fileSize: 50 * 1024 * 1024, files: 1 },
    fileFilter: (req, file, cb) => {
        const ok =
            file.mimetype === 'text/csv' ||
            file.mimetype === 'application/vnd.ms-excel' ||
            file.originalname.toLowerCase().endsWith('.csv');
        if (ok) cb(null, true);
        else cb(new Error('Only CSV files are allowed'));
    }
});

const insertBatchIntoStaging = async (client, rows) => {
    if (!rows.length) return;
    const cols = [
        'id', 'guid', 'updated', 'title', 'added', 'countries', 'availabilityState',
        'episode_number', 'omit', 'primary_category_id', 'primary_category_name',
        'season_number', 'series_title', 'content_type', 'premium_features'
    ];

    const values = [];
    const params = [];
    let p = 1;
    for (const r of rows) {
        const rec = {
            id: r.id ?? null,
            guid: r.guid ?? null,
            updated: r.updated ?? null,
            title: r.title ?? null,
            added: r.added ?? null,
            countries: r.countries ?? null,
            availabilityState: r.availabilityState ?? null,
            episode_number: r['cbs$EpisodeNumber'] ?? r.episode_number ?? null,
            omit: r['cbs$Omit'] ?? r.omit ?? null,
            primary_category_id: r['cbs$PrimaryCategory'] ?? r.primary_category_id ?? null,
            primary_category_name: r['cbs$PrimaryCategoryName'] ?? r.primary_category_name ?? null,
            season_number: r['cbs$SeasonNumber'] ?? r.season_number ?? null,
            series_title: r['cbs$SeriesTitle'] ?? r.series_title ?? null,
            content_type: r['cbs$contentType'] ?? r.content_type ?? null,
            premium_features: r['cbs$premiumFeatures'] ?? r.premium_features ?? null
        };

        values.push(`(${cols.map(() => `$${p++}`).join(',')})`);
        params.push(
            rec.id, rec.guid, rec.updated, rec.title, rec.added, rec.countries,
            rec.availabilityState, rec.episode_number, rec.omit, rec.primary_category_id,
            rec.primary_category_name, rec.season_number, rec.series_title,
            rec.content_type, rec.premium_features
        );
    }

    const sql = `INSERT INTO media_items_staging (${cols.join(',')}) VALUES ${values.join(',')}`;
    await client.query(sql, params);
};

app.post('/api/import/csv', rateLimit(RATE_LIMIT_UPLOAD_MAX, UPLOAD_RATE_LIMIT_WINDOW_MS), upload.single('csvFile'), async (req, res) => {
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
        const stream = fs.createReadStream(filePath).pipe(csvParser());

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
        rateBuckets.delete(ip);

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

// Error handling
app.use((err, req, res, next) => {
    if (err instanceof Error && (err.message.includes('CSV') || err.message.includes('File too large'))) {
        return res.status(400).json({ success: false, error: err.message });
    }
    next(err);
});

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

// Start server
const server = app.listen(PORT, () => {
    logger.info(`Server listening on port ${PORT}`);
});

// Graceful shutdown
const shutdown = async () => {
    logger.info('Shutting down...');
    server.close(async () => {
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