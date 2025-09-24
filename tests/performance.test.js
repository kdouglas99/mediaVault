import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { Pool } from 'pg'
import request from 'supertest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Performance test configuration
const TEST_DB_CONFIG = {
  host: process.env.TEST_DB_HOST || 'localhost',
  port: process.env.TEST_DB_PORT || 5432,
  database: process.env.TEST_DB_NAME || 'media_vault_test',
  user: process.env.TEST_DB_USER || 'test_user',
  password: process.env.TEST_DB_PASSWORD || 'test_password'
}

describe('Performance Tests', () => {
  let pool
  let app
  let server

  beforeAll(async () => {
    // Set up test database connection
    pool = new Pool(TEST_DB_CONFIG)
    
    // Initialize test database schema
    const schemaPath = path.resolve(__dirname, '../server/schema.sql')
    const schema = fs.readFileSync(schemaPath, 'utf8')
    
    try {
      await pool.query(schema)
      console.log('Test database schema initialized')
    } catch (error) {
      console.warn('Schema initialization failed (may already exist):', error.message)
    }

    // Start test server
    const { createApp } = await import('../server/server.js')
    app = createApp()
    server = app.listen(3003)
  })

  afterAll(async () => {
    if (server) {
      server.close()
    }
    if (pool) {
      await pool.end()
    }
  })

  beforeEach(async () => {
    // Clean up test data before each test
    await pool.query('TRUNCATE TABLE media_items CASCADE')
    await pool.query('TRUNCATE TABLE media_items_staging CASCADE')
  })

  describe('Database Performance', () => {
    it('should handle large batch inserts efficiently', async () => {
      const batchSize = 1000
      const startTime = Date.now()

      // Prepare batch data
      const values = []
      const params = []
      let paramIndex = 1

      for (let i = 0; i < batchSize; i++) {
        values.push(`($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2})`)
        params.push(`perf-test-${i}`, `Performance Test ${i}`, 'movie')
        paramIndex += 3
      }

      const sql = `
        INSERT INTO media_items (external_id, title, content_type)
        VALUES ${values.join(', ')}
      `

      await pool.query(sql, params)
      const endTime = Date.now()
      const duration = endTime - startTime

      // Should complete within 5 seconds
      expect(duration).toBeLessThan(5000)

      // Verify all records were inserted
      const countResult = await pool.query(`
        SELECT COUNT(*) FROM media_items WHERE title LIKE 'Performance Test %'
      `)
      expect(parseInt(countResult.rows[0].count)).toBe(batchSize)
    })

    it('should handle large CSV imports efficiently', async () => {
      // Generate large CSV data
      const rows = []
      rows.push('id,title,content_type,availability_state,countries,premium_features')
      
      for (let i = 1; i <= 5000; i++) {
        rows.push(`perf-csv-${i},Performance CSV Test ${i},movie,available,"US,CA","hd,4k"`)
      }

      const csvData = rows.join('\n')
      const startTime = Date.now()

      const importResponse = await request(app)
        .post('/api/import/csv')
        .attach('csvFile', Buffer.from(csvData), 'performance.csv')
        .expect(200)

      const endTime = Date.now()
      const duration = endTime - startTime

      expect(importResponse.body.success).toBe(true)
      // Should complete within 30 seconds
      expect(duration).toBeLessThan(30000)

      // Verify all records were imported
      const itemsResponse = await request(app)
        .get('/api/items')
        .expect(200)

      expect(itemsResponse.body.data.length).toBeGreaterThanOrEqual(5000)
    })

    it('should handle complex queries efficiently', async () => {
      // Insert test data
      const insertPromises = []
      for (let i = 0; i < 1000; i++) {
        insertPromises.push(
          pool.query(`
            INSERT INTO media_items (external_id, title, series_title, content_type, availability_state, countries, premium_features)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
          `, [
            `complex-${i}`,
            `Complex Test ${i}`,
            `Series ${Math.floor(i / 10)}`,
            i % 2 === 0 ? 'movie' : 'series',
            i % 3 === 0 ? 'available' : 'unavailable',
            ['US', 'CA'],
            ['hd', '4k']
          ])
        )
      }

      await Promise.all(insertPromises)

      // Test complex query performance
      const startTime = Date.now()

      const result = await pool.query(`
        SELECT 
          content_type,
          availability_state,
          COUNT(*) as count,
          array_agg(DISTINCT series_title) as series_list
        FROM media_items 
        WHERE countries @> ARRAY['US'] 
          AND premium_features @> ARRAY['hd']
        GROUP BY content_type, availability_state
        ORDER BY count DESC
      `)

      const endTime = Date.now()
      const duration = endTime - startTime

      // Should complete within 1 second
      expect(duration).toBeLessThan(1000)
      expect(result.rows.length).toBeGreaterThan(0)
    })

    it('should handle concurrent database operations', async () => {
      const concurrentOperations = 50
      const startTime = Date.now()

      const operations = Array(concurrentOperations).fill().map(async (_, index) => {
        return pool.query(`
          INSERT INTO media_items (external_id, title, content_type)
          VALUES ($1, $2, $3)
        `, [`concurrent-${index}`, `Concurrent Test ${index}`, 'movie'])
      })

      await Promise.all(operations)
      const endTime = Date.now()
      const duration = endTime - startTime

      // Should complete within 10 seconds
      expect(duration).toBeLessThan(10000)

      // Verify all operations completed
      const countResult = await pool.query(`
        SELECT COUNT(*) FROM media_items WHERE title LIKE 'Concurrent Test %'
      `)
      expect(parseInt(countResult.rows[0].count)).toBe(concurrentOperations)
    })
  })

  describe('API Performance', () => {
    beforeEach(async () => {
      // Insert test data for API performance tests
      const insertPromises = []
      for (let i = 0; i < 1000; i++) {
        insertPromises.push(
          pool.query(`
            INSERT INTO media_items (external_id, title, series_title, content_type, availability_state)
            VALUES ($1, $2, $3, $4, $5)
          `, [
            `api-perf-${i}`,
            `API Performance Test ${i}`,
            `Series ${Math.floor(i / 100)}`,
            i % 2 === 0 ? 'movie' : 'series',
            'available'
          ])
        )
      }

      await Promise.all(insertPromises)
    })

    it('should handle large data retrieval efficiently', async () => {
      const startTime = Date.now()

      const response = await request(app)
        .get('/api/items')
        .expect(200)

      const endTime = Date.now()
      const duration = endTime - startTime

      expect(response.body.success).toBe(true)
      expect(response.body.data.length).toBeGreaterThanOrEqual(1000)
      // Should complete within 2 seconds
      expect(duration).toBeLessThan(2000)
    })

    it('should handle search queries efficiently', async () => {
      const startTime = Date.now()

      const response = await request(app)
        .get('/api/items?search=Performance')
        .expect(200)

      const endTime = Date.now()
      const duration = endTime - startTime

      expect(response.body.success).toBe(true)
      expect(response.body.data.length).toBeGreaterThan(0)
      // Should complete within 1 second
      expect(duration).toBeLessThan(1000)
    })

    it('should handle sorting efficiently', async () => {
      const startTime = Date.now()

      const response = await request(app)
        .get('/api/items?sortBy=title&sortOrder=DESC')
        .expect(200)

      const endTime = Date.now()
      const duration = endTime - startTime

      expect(response.body.success).toBe(true)
      expect(response.body.data.length).toBeGreaterThanOrEqual(1000)
      // Should complete within 2 seconds
      expect(duration).toBeLessThan(2000)

      // Verify sorting
      const titles = response.body.data.map(item => item.title)
      const sortedTitles = [...titles].sort().reverse()
      expect(titles).toEqual(sortedTitles)
    })

    it('should handle concurrent API requests', async () => {
      const concurrentRequests = 20
      const startTime = Date.now()

      const requests = Array(concurrentRequests).fill().map(() =>
        request(app).get('/api/items')
      )

      const responses = await Promise.all(requests)
      const endTime = Date.now()
      const duration = endTime - startTime

      // All requests should succeed
      responses.forEach(response => {
        expect(response.status).toBe(200)
        expect(response.body.success).toBe(true)
      })

      // Should complete within 5 seconds
      expect(duration).toBeLessThan(5000)
    })

    it('should handle statistics calculation efficiently', async () => {
      const startTime = Date.now()

      const response = await request(app)
        .get('/api/stats')
        .expect(200)

      const endTime = Date.now()
      const duration = endTime - startTime

      expect(response.body.success).toBe(true)
      expect(response.body.data.totalItems).toBeGreaterThanOrEqual(1000)
      // Should complete within 3 seconds
      expect(duration).toBeLessThan(3000)
    })
  })

  describe('Memory Performance', () => {
    it('should handle large JSONB data efficiently', async () => {
      const largeRatings = {}
      const largeContent = {}
      const largeThumbnails = []

      // Create large JSONB objects
      for (let i = 0; i < 100; i++) {
        largeRatings[`rating_${i}`] = Math.random() * 10
        largeContent[`field_${i}`] = `Content field ${i} with some data`
        largeThumbnails.push({
          url: `thumbnail_${i}.jpg`,
          width: 300 + i,
          height: 200 + i,
          alt: `Thumbnail ${i}`
        })
      }

      const startTime = Date.now()

      await pool.query(`
        INSERT INTO media_items (external_id, title, ratings, content, thumbnails)
        VALUES ($1, $2, $3, $4, $5)
      `, [
        'memory-test',
        'Memory Performance Test',
        JSON.stringify(largeRatings),
        JSON.stringify(largeContent),
        JSON.stringify(largeThumbnails)
      ])

      const endTime = Date.now()
      const duration = endTime - startTime

      // Should complete within 1 second
      expect(duration).toBeLessThan(1000)

      // Verify data was stored correctly
      const result = await pool.query('SELECT * FROM media_items WHERE external_id = $1', ['memory-test'])
      expect(result.rows[0].ratings).toEqual(largeRatings)
      expect(result.rows[0].content).toEqual(largeContent)
      expect(result.rows[0].thumbnails).toEqual(largeThumbnails)
    })

    it('should handle large array fields efficiently', async () => {
      const largeCountries = Array(50).fill().map((_, i) => `Country_${i}`)
      const largeFeatures = Array(100).fill().map((_, i) => `Feature_${i}`)

      const startTime = Date.now()

      await pool.query(`
        INSERT INTO media_items (external_id, title, countries, premium_features)
        VALUES ($1, $2, $3, $4)
      `, [
        'array-memory-test',
        'Array Memory Test',
        largeCountries,
        largeFeatures
      ])

      const endTime = Date.now()
      const duration = endTime - startTime

      // Should complete within 1 second
      expect(duration).toBeLessThan(1000)

      // Verify data was stored correctly
      const result = await pool.query('SELECT * FROM media_items WHERE external_id = $1', ['array-memory-test'])
      expect(result.rows[0].countries).toEqual(largeCountries)
      expect(result.rows[0].premium_features).toEqual(largeFeatures)
    })
  })

  describe('Connection Pool Performance', () => {
    it('should handle connection pool exhaustion gracefully', async () => {
      const maxConnections = 20
      const startTime = Date.now()

      // Create many concurrent connections
      const connections = Array(maxConnections).fill().map(async (_, index) => {
        return pool.query(`
          SELECT COUNT(*) FROM media_items WHERE external_id LIKE $1
        `, [`connection-test-${index}%`])
      })

      const results = await Promise.all(connections)
      const endTime = Date.now()
      const duration = endTime - startTime

      // Should complete within 10 seconds
      expect(duration).toBeLessThan(10000)
      expect(results.length).toBe(maxConnections)

      // All results should be valid
      results.forEach(result => {
        expect(result.rows).toHaveLength(1)
        expect(typeof result.rows[0].count).toBe('string')
      })
    })

    it('should handle connection timeout gracefully', async () => {
      // Test with a query that might timeout
      const startTime = Date.now()

      try {
        await pool.query(`
          SELECT pg_sleep(0.1), COUNT(*) FROM media_items
        `)
        const endTime = Date.now()
        const duration = endTime - startTime

        // Should complete within 2 seconds (including sleep)
        expect(duration).toBeLessThan(2000)
      } catch (error) {
        // If timeout occurs, it should be handled gracefully
        expect(error.message).toContain('timeout')
      }
    })
  })

  describe('Index Performance', () => {
    beforeEach(async () => {
      // Insert test data for index performance tests
      const insertPromises = []
      for (let i = 0; i < 5000; i++) {
        insertPromises.push(
          pool.query(`
            INSERT INTO media_items (external_id, title, series_title, content_type, availability_state)
            VALUES ($1, $2, $3, $4, $5)
          `, [
            `index-perf-${i}`,
            `Index Performance Test ${i}`,
            `Series ${Math.floor(i / 100)}`,
            i % 3 === 0 ? 'movie' : i % 3 === 1 ? 'series' : 'episode',
            i % 2 === 0 ? 'available' : 'unavailable'
          ])
        )
      }

      await Promise.all(insertPromises)
    })

    it('should use indexes for title searches', async () => {
      const startTime = Date.now()

      const result = await pool.query(`
        EXPLAIN (ANALYZE, BUFFERS) 
        SELECT * FROM media_items WHERE title = 'Index Performance Test 1000'
      `)

      const endTime = Date.now()
      const duration = endTime - startTime

      const explainText = result.rows.map(row => row['QUERY PLAN']).join('\n')
      
      // Should use index scan
      expect(explainText).toMatch(/Index Scan.*idx_media_items_title/)
      // Should complete quickly
      expect(duration).toBeLessThan(1000)
    })

    it('should use indexes for content type searches', async () => {
      const startTime = Date.now()

      const result = await pool.query(`
        EXPLAIN (ANALYZE, BUFFERS) 
        SELECT COUNT(*) FROM media_items WHERE content_type = 'movie'
      `)

      const endTime = Date.now()
      const duration = endTime - startTime

      const explainText = result.rows.map(row => row['QUERY PLAN']).join('\n')
      
      // Should use index scan
      expect(explainText).toMatch(/Index Scan.*idx_media_items_content_type/)
      // Should complete quickly
      expect(duration).toBeLessThan(1000)
    })

    it('should use indexes for availability state searches', async () => {
      const startTime = Date.now()

      const result = await pool.query(`
        EXPLAIN (ANALYZE, BUFFERS) 
        SELECT COUNT(*) FROM media_items WHERE availability_state = 'available'
      `)

      const endTime = Date.now()
      const duration = endTime - startTime

      const explainText = result.rows.map(row => row['QUERY PLAN']).join('\n')
      
      // Should use index scan
      expect(explainText).toMatch(/Index Scan.*idx_media_items_availability_state/)
      // Should complete quickly
      expect(duration).toBeLessThan(1000)
    })
  })
})
