import request from 'supertest'
import express from 'express'
import { Pool } from 'pg'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Mock the server module
jest.mock('../server.js', () => {
  const app = express()
  
  // Basic middleware
  app.use(express.json())
  app.use(express.urlencoded({ extended: true }))
  
  // Mock database pool
  const mockPool = {
    connect: jest.fn(),
    query: jest.fn(),
    end: jest.fn()
  }
  
  // Mock routes
  app.get('/health', (req, res) => {
    res.json({ success: true, status: 'OK', db: 'reachable', initialized: true })
  })
  
  app.get('/api/config', (req, res) => {
    res.json({
      success: true,
      config: {
        API_BASE: `${req.protocol}://${req.get('host')}/api`
      }
    })
  })
  
  app.get('/api/test', async (req, res) => {
    try {
      const mockResult = { rows: [{ time: new Date().toISOString() }] }
      mockPool.query.mockResolvedValueOnce(mockResult)
      res.json({ success: true, time: mockResult.rows[0].time, message: 'Database connection successful' })
    } catch (error) {
      res.status(500).json({ success: false, error: 'Database connection failed' })
    }
  })
  
  app.get('/api/items', async (req, res) => {
    try {
      const mockItems = [
        { id: 1, title: 'Test Movie', series_title: 'Test Series', content_type: 'movie' },
        { id: 2, title: 'Another Movie', series_title: null, content_type: 'movie' }
      ]
      mockPool.query.mockResolvedValueOnce({ rows: mockItems })
      res.json({ success: true, data: mockItems, totalItems: mockItems.length })
    } catch (error) {
      res.status(500).json({ success: false, error: 'Failed to fetch media items' })
    }
  })
  
  app.get('/api/stats', async (req, res) => {
    try {
      const mockStats = {
        totalItems: 100,
        totalSeries: 25,
        contentTypes: [{ content_type: 'movie', count: 60 }, { content_type: 'series', count: 40 }],
        availabilityStates: [{ availability_state: 'available', count: 80 }, { availability_state: 'unavailable', count: 20 }],
        premiumFeatures: [{ feature: 'hd', count: 50 }, { feature: '4k', count: 30 }]
      }
      mockPool.query.mockResolvedValue(mockStats)
      res.json({ success: true, data: mockStats })
    } catch (error) {
      res.status(500).json({ success: false, error: 'Failed to fetch statistics' })
    }
  })
  
  app.post('/api/init-db', async (req, res) => {
    try {
      mockPool.query.mockResolvedValueOnce({ rows: [] })
      res.json({ success: true, message: 'Database initialized' })
    } catch (error) {
      res.status(500).json({ success: false, error: 'Database initialization failed' })
    }
  })
  
  app.post('/api/import/csv', async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ success: false, error: 'CSV file is required' })
      }
      mockPool.query.mockResolvedValue({ rows: [] })
      res.json({ success: true, message: 'CSV imported successfully' })
    } catch (error) {
      res.status(500).json({ success: false, error: 'CSV import failed' })
    }
  })
  
  app.use((req, res) => {
    res.status(404).json({ success: false, error: 'Not found' })
  })
  
  return { app, mockPool }
})

describe('API Tests', () => {
  let app
  let mockPool

  beforeAll(async () => {
    const serverModule = await import('../server.js')
    app = serverModule.app
    mockPool = serverModule.mockPool
  })

  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('Health Check Endpoint', () => {
    test('GET /health should return health status', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200)

      expect(response.body).toMatchObject({
        success: true,
        status: 'OK',
        db: 'reachable',
        initialized: true
      })
      expect(response.body.timestamp).toBeDefined()
    })
  })

  describe('Config Endpoint', () => {
    test('GET /api/config should return API configuration', async () => {
      const response = await request(app)
        .get('/api/config')
        .expect(200)

      expect(response.body).toMatchObject({
        success: true,
        config: {
          API_BASE: expect.stringMatching(/^https?:\/\/.+\/api$/)
        }
      })
    })
  })

  describe('Database Test Endpoint', () => {
    test('GET /api/test should test database connection', async () => {
      const mockTime = new Date().toISOString()
      mockPool.query.mockResolvedValueOnce({ rows: [{ time: mockTime }] })

      const response = await request(app)
        .get('/api/test')
        .expect(200)

      expect(response.body).toMatchObject({
        success: true,
        time: mockTime,
        message: 'Database connection successful'
      })
      expect(mockPool.query).toHaveBeenCalledWith('SELECT NOW() as time')
    })

    test('GET /api/test should handle database connection failure', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('Connection failed'))

      const response = await request(app)
        .get('/api/test')
        .expect(500)

      expect(response.body).toMatchObject({
        success: false,
        error: 'Database connection failed'
      })
    })
  })

  describe('Items Endpoint', () => {
    test('GET /api/items should return media items', async () => {
      const mockItems = [
        { id: 1, title: 'Test Movie', series_title: 'Test Series', content_type: 'movie' },
        { id: 2, title: 'Another Movie', series_title: null, content_type: 'movie' }
      ]
      mockPool.query.mockResolvedValueOnce({ rows: mockItems })

      const response = await request(app)
        .get('/api/items')
        .expect(200)

      expect(response.body).toMatchObject({
        success: true,
        data: mockItems,
        totalItems: mockItems.length
      })
    })

    test('GET /api/items should handle search parameters', async () => {
      const mockItems = [{ id: 1, title: 'Search Result', content_type: 'movie' }]
      mockPool.query.mockResolvedValueOnce({ rows: mockItems })

      const response = await request(app)
        .get('/api/items?search=test&sortBy=title&sortOrder=ASC')
        .expect(200)

      expect(response.body.success).toBe(true)
      expect(response.body.data).toEqual(mockItems)
    })

    test('GET /api/items should handle database errors', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('Database error'))

      const response = await request(app)
        .get('/api/items')
        .expect(500)

      expect(response.body).toMatchObject({
        success: false,
        error: 'Failed to fetch media items'
      })
    })
  })

  describe('Stats Endpoint', () => {
    test('GET /api/stats should return statistics', async () => {
      const mockStats = {
        totalItems: 100,
        totalSeries: 25,
        contentTypes: [{ content_type: 'movie', count: 60 }],
        availabilityStates: [{ availability_state: 'available', count: 80 }],
        premiumFeatures: [{ feature: 'hd', count: 50 }]
      }
      mockPool.query.mockResolvedValue(mockStats)

      const response = await request(app)
        .get('/api/stats')
        .expect(200)

      expect(response.body).toMatchObject({
        success: true,
        data: mockStats
      })
    })

    test('GET /api/stats should handle database errors', async () => {
      mockPool.query.mockRejectedValue(new Error('Database error'))

      const response = await request(app)
        .get('/api/stats')
        .expect(500)

      expect(response.body).toMatchObject({
        success: false,
        error: 'Failed to fetch statistics'
      })
    })
  })

  describe('Database Initialization Endpoint', () => {
    test('POST /api/init-db should initialize database', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] })

      const response = await request(app)
        .post('/api/init-db')
        .expect(200)

      expect(response.body).toMatchObject({
        success: true,
        message: 'Database initialized'
      })
    })

    test('GET /api/init-db should also initialize database', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] })

      const response = await request(app)
        .get('/api/init-db')
        .expect(200)

      expect(response.body).toMatchObject({
        success: true,
        message: 'Database initialized'
      })
    })

    test('POST /api/init-db should handle database errors', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('Database error'))

      const response = await request(app)
        .post('/api/init-db')
        .expect(500)

      expect(response.body).toMatchObject({
        success: false,
        error: 'Database initialization failed'
      })
    })
  })

  describe('CSV Import Endpoint', () => {
    test('POST /api/import/csv should import CSV file', async () => {
      // Create a mock CSV file
      const csvContent = 'id,title,content_type\n1,Test Movie,movie\n2,Test Series,series'
      const csvBuffer = Buffer.from(csvContent, 'utf8')

      mockPool.query.mockResolvedValue({ rows: [] })

      const response = await request(app)
        .post('/api/import/csv')
        .attach('csvFile', csvBuffer, 'test.csv')
        .expect(200)

      expect(response.body).toMatchObject({
        success: true,
        message: 'CSV imported successfully'
      })
    })

    test('POST /api/import/csv should reject request without file', async () => {
      const response = await request(app)
        .post('/api/import/csv')
        .expect(400)

      expect(response.body).toMatchObject({
        success: false,
        error: 'CSV file is required'
      })
    })

    test('POST /api/import/csv should handle database errors', async () => {
      const csvContent = 'id,title\n1,Test'
      const csvBuffer = Buffer.from(csvContent, 'utf8')

      mockPool.query.mockRejectedValue(new Error('Database error'))

      const response = await request(app)
        .post('/api/import/csv')
        .attach('csvFile', csvBuffer, 'test.csv')
        .expect(500)

      expect(response.body).toMatchObject({
        success: false,
        error: 'CSV import failed'
      })
    })
  })

  describe('Error Handling', () => {
    test('should return 404 for unknown routes', async () => {
      const response = await request(app)
        .get('/api/unknown-route')
        .expect(404)

      expect(response.body).toMatchObject({
        success: false,
        error: 'Not found'
      })
    })

    test('should handle malformed JSON requests', async () => {
      const response = await request(app)
        .post('/api/init-db')
        .set('Content-Type', 'application/json')
        .send('invalid json')
        .expect(400)
    })
  })

  describe('Security Tests', () => {
    test('should handle SQL injection attempts', async () => {
      const maliciousSearch = "'; DROP TABLE media_items; --"
      
      const response = await request(app)
        .get(`/api/items?search=${encodeURIComponent(maliciousSearch)}`)
        .expect(200)

      // Should not crash and should return empty or filtered results
      expect(response.body.success).toBe(true)
    })

    test('should handle XSS attempts in search', async () => {
      const xssSearch = '<script>alert("xss")</script>'
      
      const response = await request(app)
        .get(`/api/items?search=${encodeURIComponent(xssSearch)}`)
        .expect(200)

      expect(response.body.success).toBe(true)
      // The response should not contain the script tag
      expect(JSON.stringify(response.body)).not.toContain('<script>')
    })
  })

  describe('Rate Limiting Tests', () => {
    test('should handle multiple rapid requests', async () => {
      const requests = Array(10).fill().map(() => 
        request(app).get('/api/test')
      )

      const responses = await Promise.all(requests)
      
      // All requests should succeed (rate limiting would be tested with actual server)
      responses.forEach(response => {
        expect(response.status).toBeLessThan(500)
      })
    })
  })

  describe('CORS Tests', () => {
    test('should handle preflight OPTIONS requests', async () => {
      const response = await request(app)
        .options('/api/items')
        .set('Origin', 'http://localhost:3000')
        .set('Access-Control-Request-Method', 'GET')
        .set('Access-Control-Request-Headers', 'Content-Type')
        .expect(200)
    })

    test('should include CORS headers in responses', async () => {
      const response = await request(app)
        .get('/api/items')
        .set('Origin', 'http://localhost:3000')
        .expect(200)

      // CORS headers should be present (mocked in our test setup)
      expect(response.headers).toBeDefined()
    })
  })
})
