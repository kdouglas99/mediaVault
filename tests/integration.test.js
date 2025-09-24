import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { Pool } from 'pg'
import request from 'supertest'
import express from 'express'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Integration test configuration
const TEST_DB_CONFIG = {
  host: process.env.TEST_DB_HOST || 'localhost',
  port: process.env.TEST_DB_PORT || 5432,
  database: process.env.TEST_DB_NAME || 'media_vault_test',
  user: process.env.TEST_DB_USER || 'test_user',
  password: process.env.TEST_DB_PASSWORD || 'test_password'
}

describe('Integration Tests', () => {
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
    server = app.listen(3002)
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

  describe('Full Application Flow', () => {
    it('should complete full CSV import workflow', async () => {
      // Step 1: Check health endpoint
      const healthResponse = await request(app)
        .get('/health')
        .expect(200)

      expect(healthResponse.body.success).toBe(true)
      expect(healthResponse.body.status).toBe('OK')

      // Step 2: Initialize database
      const initResponse = await request(app)
        .post('/api/init-db')
        .expect(200)

      expect(initResponse.body.success).toBe(true)

      // Step 3: Create test CSV data
      const csvData = `id,guid,title,series_title,season_number,episode_number,content_type,availabilityState,countries,premium_features,updated,added
test-1,guid-1,Test Movie,Test Series,1,1,movie,available,"US,CA","hd,4k",1640995200000,1640995200000
test-2,guid-2,Another Movie,,,movie,available,"US","hd",1640995200000,1640995200000`

      // Step 4: Import CSV
      const importResponse = await request(app)
        .post('/api/import/csv')
        .attach('csvFile', Buffer.from(csvData), 'test.csv')
        .expect(200)

      expect(importResponse.body.success).toBe(true)

      // Step 5: Verify data was imported
      const itemsResponse = await request(app)
        .get('/api/items')
        .expect(200)

      expect(itemsResponse.body.success).toBe(true)
      expect(itemsResponse.body.data).toHaveLength(2)
      expect(itemsResponse.body.data[0].title).toBe('Test Movie')
      expect(itemsResponse.body.data[1].title).toBe('Another Movie')

      // Step 6: Check statistics
      const statsResponse = await request(app)
        .get('/api/stats')
        .expect(200)

      expect(statsResponse.body.success).toBe(true)
      expect(statsResponse.body.data.totalItems).toBe(2)
      expect(statsResponse.body.data.totalSeries).toBe(1)
    })

    it('should handle search and filtering', async () => {
      // Insert test data
      await pool.query(`
        INSERT INTO media_items (external_id, title, series_title, content_type, availability_state)
        VALUES 
          ($1, $2, $3, $4, $5),
          ($6, $7, $8, $9, $10),
          ($11, $12, $13, $14, $15)
      `, [
        'search-1', 'Action Movie', 'Action Series', 'movie', 'available',
        'search-2', 'Comedy Show', 'Comedy Series', 'series', 'available',
        'search-3', 'Drama Film', 'Drama Series', 'movie', 'unavailable'
      ])

      // Test search functionality
      const searchResponse = await request(app)
        .get('/api/items?search=Action')
        .expect(200)

      expect(searchResponse.body.success).toBe(true)
      expect(searchResponse.body.data).toHaveLength(1)
      expect(searchResponse.body.data[0].title).toBe('Action Movie')

      // Test sorting
      const sortResponse = await request(app)
        .get('/api/items?sortBy=title&sortOrder=DESC')
        .expect(200)

      expect(sortResponse.body.success).toBe(true)
      expect(sortResponse.body.data[0].title).toBe('Drama Film')
      expect(sortResponse.body.data[1].title).toBe('Comedy Show')
      expect(sortResponse.body.data[2].title).toBe('Action Movie')
    })

    it('should handle duplicate imports with updates', async () => {
      // First import
      const csvData1 = `id,title,content_type
duplicate-test,Original Title,movie`

      await request(app)
        .post('/api/import/csv')
        .attach('csvFile', Buffer.from(csvData1), 'test1.csv')
        .expect(200)

      // Verify first import
      let itemsResponse = await request(app)
        .get('/api/items')
        .expect(200)

      expect(itemsResponse.body.data).toHaveLength(1)
      expect(itemsResponse.body.data[0].title).toBe('Original Title')

      // Second import with same ID but different data
      const csvData2 = `id,title,content_type
duplicate-test,Updated Title,series`

      await request(app)
        .post('/api/import/csv')
        .attach('csvFile', Buffer.from(csvData2), 'test2.csv')
        .expect(200)

      // Verify update
      itemsResponse = await request(app)
        .get('/api/items')
        .expect(200)

      expect(itemsResponse.body.data).toHaveLength(1)
      expect(itemsResponse.body.data[0].title).toBe('Updated Title')
      expect(itemsResponse.body.data[0].content_type).toBe('series')
    })

    it('should handle large CSV imports', async () => {
      // Generate large CSV data
      const rows = []
      rows.push('id,title,content_type,availability_state')
      
      for (let i = 1; i <= 1000; i++) {
        rows.push(`large-${i},Large Test ${i},movie,available`)
      }

      const csvData = rows.join('\n')

      const startTime = Date.now()
      
      const importResponse = await request(app)
        .post('/api/import/csv')
        .attach('csvFile', Buffer.from(csvData), 'large.csv')
        .expect(200)

      const endTime = Date.now()
      const duration = endTime - startTime

      expect(importResponse.body.success).toBe(true)
      expect(duration).toBeLessThan(30000) // Should complete within 30 seconds

      // Verify all records were imported
      const itemsResponse = await request(app)
        .get('/api/items')
        .expect(200)

      expect(itemsResponse.body.data).toHaveLength(1000)
    })

    it('should handle malformed CSV gracefully', async () => {
      const malformedCsv = `id,title,content_type
1,Valid Movie,movie
2,Another Movie,movie
invalid-row-without-comma
3,Third Movie,movie`

      const importResponse = await request(app)
        .post('/api/import/csv')
        .attach('csvFile', Buffer.from(malformedCsv), 'malformed.csv')
        .expect(200)

      expect(importResponse.body.success).toBe(true)

      // Should still import valid rows
      const itemsResponse = await request(app)
        .get('/api/items')
        .expect(200)

      expect(itemsResponse.body.data.length).toBeGreaterThan(0)
    })
  })

  describe('Error Handling Integration', () => {
    it('should handle database connection failures gracefully', async () => {
      // Temporarily close the database connection
      await pool.end()

      const healthResponse = await request(app)
        .get('/health')
        .expect(503)

      expect(healthResponse.body.success).toBe(false)
      expect(healthResponse.body.status).toBe('DEGRADED')

      // Reconnect for cleanup
      pool = new Pool(TEST_DB_CONFIG)
    })

    it('should handle invalid file uploads', async () => {
      const invalidFile = Buffer.from('This is not a CSV file', 'utf8')

      const response = await request(app)
        .post('/api/import/csv')
        .attach('csvFile', invalidFile, 'not-a-csv.txt')
        .expect(400)

      expect(response.body.success).toBe(false)
      expect(response.body.error).toContain('Only CSV files are allowed')
    })

    it('should handle oversized files', async () => {
      // Create a large file (over 50MB)
      const largeContent = 'x'.repeat(51 * 1024 * 1024)
      const largeBuffer = Buffer.from(largeContent, 'utf8')

      const response = await request(app)
        .post('/api/import/csv')
        .attach('csvFile', largeBuffer, 'large.csv')
        .expect(400)

      expect(response.body.success).toBe(false)
      expect(response.body.error).toContain('File size exceeds')
    })
  })

  describe('Performance Integration', () => {
    it('should handle concurrent requests', async () => {
      // Insert test data
      await pool.query(`
        INSERT INTO media_items (external_id, title, content_type)
        VALUES ($1, $2, $3)
      `, ['concurrent-test', 'Concurrent Test', 'movie'])

      // Make multiple concurrent requests
      const requests = Array(10).fill().map(() => 
        request(app).get('/api/items')
      )

      const responses = await Promise.all(requests)

      // All requests should succeed
      responses.forEach(response => {
        expect(response.status).toBe(200)
        expect(response.body.success).toBe(true)
      })
    })

    it('should handle rapid database operations', async () => {
      const startTime = Date.now()

      // Perform multiple database operations
      const operations = []
      for (let i = 0; i < 100; i++) {
        operations.push(
          pool.query(`
            INSERT INTO media_items (external_id, title, content_type)
            VALUES ($1, $2, $3)
          `, [`rapid-${i}`, `Rapid Test ${i}`, 'movie'])
        )
      }

      await Promise.all(operations)
      const endTime = Date.now()
      const duration = endTime - startTime

      expect(duration).toBeLessThan(10000) // Should complete within 10 seconds

      // Verify all records were inserted
      const result = await pool.query('SELECT COUNT(*) FROM media_items WHERE title LIKE \'Rapid Test %\'')
      expect(parseInt(result.rows[0].count)).toBe(100)
    })
  })

  describe('Data Integrity Integration', () => {
    it('should maintain data consistency across operations', async () => {
      // Insert initial data
      await pool.query(`
        INSERT INTO media_items (external_id, title, content_type, countries, premium_features)
        VALUES ($1, $2, $3, $4, $5)
      `, ['integrity-test', 'Integrity Test', 'movie', ['US', 'CA'], ['hd', '4k']])

      // Verify initial state
      let result = await pool.query('SELECT * FROM media_items WHERE external_id = $1', ['integrity-test'])
      expect(result.rows[0].countries).toEqual(['US', 'CA'])
      expect(result.rows[0].premium_features).toEqual(['hd', '4k'])

      // Update data
      await pool.query(`
        UPDATE media_items 
        SET countries = $1, premium_features = $2, updated_at = CURRENT_TIMESTAMP
        WHERE external_id = $3
      `, [['US', 'CA', 'MX'], ['hd', '4k', 'dolby'], 'integrity-test'])

      // Verify update
      result = await pool.query('SELECT * FROM media_items WHERE external_id = $1', ['integrity-test'])
      expect(result.rows[0].countries).toEqual(['US', 'CA', 'MX'])
      expect(result.rows[0].premium_features).toEqual(['hd', '4k', 'dolby'])

      // Delete data
      await pool.query('DELETE FROM media_items WHERE external_id = $1', ['integrity-test'])

      // Verify deletion
      result = await pool.query('SELECT * FROM media_items WHERE external_id = $1', ['integrity-test'])
      expect(result.rows).toHaveLength(0)
    })

    it('should handle JSONB data correctly', async () => {
      const ratings = { imdb: 8.5, rotten_tomatoes: 85 }
      const content = { duration: 120, genre: 'action' }
      const thumbnails = [{ url: 'thumb1.jpg', width: 300, height: 200 }]

      await pool.query(`
        INSERT INTO media_items (external_id, title, ratings, content, thumbnails)
        VALUES ($1, $2, $3, $4, $5)
      `, ['jsonb-test', 'JSONB Test', JSON.stringify(ratings), JSON.stringify(content), JSON.stringify(thumbnails)])

      const result = await pool.query('SELECT * FROM media_items WHERE external_id = $1', ['jsonb-test'])
      
      expect(result.rows[0].ratings).toEqual(ratings)
      expect(result.rows[0].content).toEqual(content)
      expect(result.rows[0].thumbnails).toEqual(thumbnails)
    })
  })

  describe('Security Integration', () => {
    it('should handle SQL injection attempts', async () => {
      const maliciousSearch = "'; DROP TABLE media_items; --"
      
      const response = await request(app)
        .get(`/api/items?search=${encodeURIComponent(maliciousSearch)}`)
        .expect(200)

      expect(response.body.success).toBe(true)
      
      // Verify table still exists
      const result = await pool.query(`
        SELECT COUNT(*) FROM information_schema.tables 
        WHERE table_name = 'media_items'
      `)
      expect(parseInt(result.rows[0].count)).toBe(1)
    })

    it('should handle XSS attempts', async () => {
      const xssSearch = '<script>alert("xss")</script>'
      
      const response = await request(app)
        .get(`/api/items?search=${encodeURIComponent(xssSearch)}`)
        .expect(200)

      expect(response.body.success).toBe(true)
      expect(JSON.stringify(response.body)).not.toContain('<script>')
    })

    it('should validate file uploads properly', async () => {
      // Test with executable file
      const executableContent = Buffer.from('#!/bin/bash\necho "malicious script"', 'utf8')
      
      const response = await request(app)
        .post('/api/import/csv')
        .attach('csvFile', executableContent, 'malicious.sh')
        .expect(400)

      expect(response.body.success).toBe(false)
      expect(response.body.error).toContain('Only CSV files are allowed')
    })
  })
})
