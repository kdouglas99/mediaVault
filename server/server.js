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
const RATE_LIMIT_DEFAULT_MAX = 200;
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