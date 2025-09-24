import { Pool } from 'pg'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

describe('Database Tests', () => {
  let pool
  let testPool

  beforeAll(async () => {
    // Create test database connection
    testPool = new Pool({
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT),
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      max: 5
    })

    pool = testPool
  })

  afterAll(async () => {
    if (pool) {
      await pool.end()
    }
  })

  beforeEach(async () => {
    // Clean up test data before each test
    await pool.query('TRUNCATE TABLE media_items CASCADE')
    await pool.query('TRUNCATE TABLE media_items_staging CASCADE')
  })

  describe('Schema Tests', () => {
    test('should create media_items table with correct structure', async () => {
      const result = await pool.query(`
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_name = 'media_items'
        ORDER BY ordinal_position
      `)

      const expectedColumns = [
        'id', 'external_id', 'guid', 'title', 'series_title',
        'season_number', 'episode_number', 'content_type', 'availability_state',
        'countries', 'premium_features', 'updated_timestamp', 'added_timestamp',
        'created_at', 'updated_at', 'provider', 'description', 'available_date',
        'expiration_date', 'ratings', 'youtube_video_ids', 'primary_category_name',
        'primary_category_id', 'source_partner', 'video_id', 'pub_date',
        'content', 'thumbnails', 'cbs', 'ytcp', 'yt', 'msn', 'pl2'
      ]

      expect(result.rows).toHaveLength(expectedColumns.length)
      
      const columnNames = result.rows.map(row => row.column_name)
      expectedColumns.forEach(columnName => {
        expect(columnNames).toContain(columnName)
      })

      // Check specific column types
      const idColumn = result.rows.find(row => row.column_name === 'id')
      expect(idColumn.data_type).toBe('integer')
      expect(idColumn.is_nullable).toBe('NO')

      const externalIdColumn = result.rows.find(row => row.column_name === 'external_id')
      expect(externalIdColumn.data_type).toBe('text')
    })

    test('should create media_items_staging table with correct structure', async () => {
      const result = await pool.query(`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_name = 'media_items_staging'
        ORDER BY ordinal_position
      `)

      const expectedColumns = [
        'id', 'guid', 'title', 'series_title', 'season_number', 'episode_number',
        'content_type', 'availabilityState', 'countries', 'premium_features',
        'updated', 'added', 'provider', 'description', 'availableDate',
        'expirationDate', 'ratings', 'pubDate', 'primary_category_name',
        'primary_category_id', 'source_partner', 'video_id', 'youtube_video_ids',
        'raw_row'
      ]

      expect(result.rows).toHaveLength(expectedColumns.length)
      
      const columnNames = result.rows.map(row => row.column_name)
      expectedColumns.forEach(columnName => {
        expect(columnNames).toContain(columnName)
      })
    })

    test('should create required indexes', async () => {
      const result = await pool.query(`
        SELECT indexname, tablename
        FROM pg_indexes
        WHERE tablename IN ('media_items', 'media_items_staging')
        ORDER BY indexname
      `)

      const expectedIndexes = [
        'idx_media_items_title',
        'idx_media_items_series_title',
        'idx_media_items_content_type',
        'idx_media_items_availability_state',
        'idx_media_items_external_id'
      ]

      const indexNames = result.rows.map(row => row.indexname)
      expectedIndexes.forEach(indexName => {
        expect(indexNames).toContain(indexName)
      })
    })

    test('should create import_media_csv function', async () => {
      const result = await pool.query(`
        SELECT routine_name, routine_type, data_type
        FROM information_schema.routines
        WHERE routine_name = 'import_media_csv'
      `)

      expect(result.rows).toHaveLength(1)
      expect(result.rows[0].routine_type).toBe('FUNCTION')
      expect(result.rows[0].data_type).toBe('integer')
    })
  })

  describe('CRUD Operations', () => {
    test('should insert a new media item', async () => {
      const mediaItem = {
        external_id: 'test-123',
        guid: 'guid-123',
        title: 'Test Movie',
        series_title: 'Test Series',
        season_number: 1,
        episode_number: 1,
        content_type: 'movie',
        availability_state: 'available',
        countries: ['US', 'CA'],
        premium_features: ['hd', '4k']
      }

      const result = await pool.query(`
        INSERT INTO media_items (
          external_id, guid, title, series_title, season_number, episode_number,
          content_type, availability_state, countries, premium_features
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING *
      `, [
        mediaItem.external_id, mediaItem.guid, mediaItem.title, mediaItem.series_title,
        mediaItem.season_number, mediaItem.episode_number, mediaItem.content_type,
        mediaItem.availability_state, mediaItem.countries, mediaItem.premium_features
      ])

      expect(result.rows).toHaveLength(1)
      expect(result.rows[0].title).toBe(mediaItem.title)
      expect(result.rows[0].external_id).toBe(mediaItem.external_id)
      expect(result.rows[0].countries).toEqual(mediaItem.countries)
      expect(result.rows[0].premium_features).toEqual(mediaItem.premium_features)
    })

    test('should enforce unique constraint on external_id', async () => {
      const mediaItem = {
        external_id: 'duplicate-id',
        title: 'First Item'
      }

      // Insert first item
      await pool.query(`
        INSERT INTO media_items (external_id, title) VALUES ($1, $2)
      `, [mediaItem.external_id, mediaItem.title])

      // Try to insert duplicate external_id
      await expect(
        pool.query(`
          INSERT INTO media_items (external_id, title) VALUES ($1, $2)
        `, [mediaItem.external_id, 'Second Item'])
      ).rejects.toThrow()
    })

    test('should update existing media item', async () => {
      // Insert initial item
      const insertResult = await pool.query(`
        INSERT INTO media_items (external_id, title, content_type)
        VALUES ($1, $2, $3)
        RETURNING id
      `, ['update-test', 'Original Title', 'movie'])

      const id = insertResult.rows[0].id

      // Update the item
      const updateResult = await pool.query(`
        UPDATE media_items
        SET title = $1, content_type = $2, updated_at = CURRENT_TIMESTAMP
        WHERE id = $3
        RETURNING *
      `, ['Updated Title', 'series', id])

      expect(updateResult.rows).toHaveLength(1)
      expect(updateResult.rows[0].title).toBe('Updated Title')
      expect(updateResult.rows[0].content_type).toBe('series')
    })

    test('should delete media item', async () => {
      // Insert item
      const insertResult = await pool.query(`
        INSERT INTO media_items (external_id, title)
        VALUES ($1, $2)
        RETURNING id
      `, ['delete-test', 'To Be Deleted'])

      const id = insertResult.rows[0].id

      // Delete the item
      const deleteResult = await pool.query(`
        DELETE FROM media_items WHERE id = $1
      `, [id])

      expect(deleteResult.rowCount).toBe(1)

      // Verify deletion
      const verifyResult = await pool.query(`
        SELECT * FROM media_items WHERE id = $1
      `, [id])

      expect(verifyResult.rows).toHaveLength(0)
    })

    test('should handle JSONB fields correctly', async () => {
      const ratings = { imdb: 8.5, rotten_tomatoes: 85 }
      const content = { duration: 120, genre: 'action' }
      const thumbnails = [{ url: 'thumb1.jpg', width: 300, height: 200 }]

      const result = await pool.query(`
        INSERT INTO media_items (external_id, title, ratings, content, thumbnails)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *
      `, ['jsonb-test', 'JSONB Test', JSON.stringify(ratings), JSON.stringify(content), JSON.stringify(thumbnails)])

      expect(result.rows).toHaveLength(1)
      expect(result.rows[0].ratings).toEqual(ratings)
      expect(result.rows[0].content).toEqual(content)
      expect(result.rows[0].thumbnails).toEqual(thumbnails)
    })
  })

  describe('CSV Import Function', () => {
    test('should import data from staging table', async () => {
      // Insert test data into staging table
      await pool.query(`
        INSERT INTO media_items_staging (
          id, guid, title, series_title, season_number, episode_number,
          content_type, availabilityState, countries, premium_features,
          updated, added
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      `, [
        'import-test-1', 'guid-1', 'Import Test Movie', 'Test Series',
        '1', '1', 'movie', 'available', 'US,CA', 'hd,4k',
        '1640995200000', '1640995200000'
      ])

      // Call import function
      const result = await pool.query('SELECT import_media_csv() AS imported')
      const importedCount = result.rows[0].imported

      expect(importedCount).toBe(1)

      // Verify data was imported correctly
      const verifyResult = await pool.query(`
        SELECT * FROM media_items WHERE external_id = 'import-test-1'
      `)

      expect(verifyResult.rows).toHaveLength(1)
      expect(verifyResult.rows[0].title).toBe('Import Test Movie')
      expect(verifyResult.rows[0].season_number).toBe(1)
      expect(verifyResult.rows[0].episode_number).toBe(1)
      expect(verifyResult.rows[0].countries).toEqual(['US', 'CA'])
      expect(verifyResult.rows[0].premium_features).toEqual(['hd', '4k'])
    })

    test('should handle duplicate external_id in import', async () => {
      // Insert initial item
      await pool.query(`
        INSERT INTO media_items (external_id, title, content_type)
        VALUES ($1, $2, $3)
      `, ['duplicate-import', 'Original Title', 'movie'])

      // Insert duplicate in staging
      await pool.query(`
        INSERT INTO media_items_staging (
          id, title, content_type
        ) VALUES ($1, $2, $3)
      `, ['duplicate-import', 'Updated Title', 'series'])

      // Call import function
      const result = await pool.query('SELECT import_media_csv() AS imported')
      const importedCount = result.rows[0].imported

      expect(importedCount).toBe(1)

      // Verify update occurred
      const verifyResult = await pool.query(`
        SELECT * FROM media_items WHERE external_id = 'duplicate-import'
      `)

      expect(verifyResult.rows).toHaveLength(1)
      expect(verifyResult.rows[0].title).toBe('Updated Title')
      expect(verifyResult.rows[0].content_type).toBe('series')
    })

    test('should handle invalid numeric data gracefully', async () => {
      // Insert data with invalid numeric values
      await pool.query(`
        INSERT INTO media_items_staging (
          id, title, season_number, episode_number, updated, added
        ) VALUES ($1, $2, $3, $4, $5, $6)
      `, [
        'invalid-numeric', 'Invalid Numeric Test', 'not-a-number', 'also-not-a-number',
        'not-a-timestamp', 'also-not-a-timestamp'
      ])

      // Call import function - should not throw
      const result = await pool.query('SELECT import_media_csv() AS imported')
      const importedCount = result.rows[0].imported

      expect(importedCount).toBe(1)

      // Verify null values were set for invalid data
      const verifyResult = await pool.query(`
        SELECT season_number, episode_number, updated_timestamp, added_timestamp
        FROM media_items WHERE external_id = 'invalid-numeric'
      `)

      expect(verifyResult.rows[0].season_number).toBeNull()
      expect(verifyResult.rows[0].episode_number).toBeNull()
      expect(verifyResult.rows[0].updated_timestamp).toBeNull()
      expect(verifyResult.rows[0].added_timestamp).toBeNull()
    })
  })

  describe('Performance Tests', () => {
    test('should handle large batch inserts efficiently', async () => {
      const startTime = Date.now()
      const batchSize = 1000

      // Prepare batch data
      const values = []
      const params = []
      let paramIndex = 1

      for (let i = 0; i < batchSize; i++) {
        values.push(`($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2})`)
        params.push(`batch-test-${i}`, `Batch Test ${i}`, 'movie')
        paramIndex += 3
      }

      const sql = `
        INSERT INTO media_items (external_id, title, content_type)
        VALUES ${values.join(', ')}
      `

      await pool.query(sql, params)
      const endTime = Date.now()
      const duration = endTime - startTime

      // Should complete within reasonable time (adjust threshold as needed)
      expect(duration).toBeLessThan(5000) // 5 seconds

      // Verify all records were inserted
      const countResult = await pool.query(`
        SELECT COUNT(*) FROM media_items WHERE title LIKE 'Batch Test %'
      `)
      expect(parseInt(countResult.rows[0].count)).toBe(batchSize)
    })

    test('should use indexes for common queries', async () => {
      // Insert test data
      await pool.query(`
        INSERT INTO media_items (external_id, title, series_title, content_type, availability_state)
        VALUES 
          ($1, $2, $3, $4, $5),
          ($6, $7, $8, $9, $10),
          ($11, $12, $13, $14, $15)
      `, [
        'perf-1', 'Action Movie', 'Action Series', 'movie', 'available',
        'perf-2', 'Comedy Show', 'Comedy Series', 'series', 'available',
        'perf-3', 'Drama Film', 'Drama Series', 'movie', 'unavailable'
      ])

      // Test index usage with EXPLAIN
      const explainResult = await pool.query(`
        EXPLAIN (ANALYZE, BUFFERS) 
        SELECT * FROM media_items WHERE title = 'Action Movie'
      `)

      const explainText = explainResult.rows.map(row => row['QUERY PLAN']).join('\n')
      
      // Should use index scan
      expect(explainText).toMatch(/Index Scan.*idx_media_items_title/)
    })
  })

  describe('Data Integrity Tests', () => {
    test('should maintain referential integrity', async () => {
      // Test that we can't insert invalid data types
      await expect(
        pool.query(`
          INSERT INTO media_items (external_id, season_number, episode_number)
          VALUES ($1, $2, $3)
        `, ['invalid-types', 'not-a-number', 'also-not-a-number'])
      ).rejects.toThrow()
    })

    test('should handle null values correctly', async () => {
      const result = await pool.query(`
        INSERT INTO media_items (external_id, title)
        VALUES ($1, $2)
        RETURNING *
      `, ['null-test', 'Null Test'])

      expect(result.rows[0].series_title).toBeNull()
      expect(result.rows[0].season_number).toBeNull()
      expect(result.rows[0].episode_number).toBeNull()
      expect(result.rows[0].content_type).toBeNull()
      expect(result.rows[0].availability_state).toBeNull()
    })

    test('should handle array fields correctly', async () => {
      const countries = ['US', 'CA', 'MX']
      const premiumFeatures = ['hd', '4k', 'dolby']

      const result = await pool.query(`
        INSERT INTO media_items (external_id, title, countries, premium_features)
        VALUES ($1, $2, $3, $4)
        RETURNING *
      `, ['array-test', 'Array Test', countries, premiumFeatures])

      expect(result.rows[0].countries).toEqual(countries)
      expect(result.rows[0].premium_features).toEqual(premiumFeatures)
    })
  })
})
