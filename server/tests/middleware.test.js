import request from 'supertest'
import express from 'express'
import { corsOptions, helmetConfig, createRateLimit, validateFileUpload, sanitizeInput } from '../middleware/security.js'
import { validateCSVImport, validateItemsQuery, sanitizeInput as validationSanitizeInput } from '../middleware/validation.js'

describe('Security Middleware Tests', () => {
  let app

  beforeEach(() => {
    app = express()
    app.use(express.json())
    app.use(express.urlencoded({ extended: true }))
  })

  describe('CORS Configuration', () => {
    test('should allow requests from allowed origins', () => {
      const allowedOrigins = ['http://localhost:3000', 'http://localhost:5173']
      
      allowedOrigins.forEach(origin => {
        corsOptions.origin(origin, (err, allowed) => {
          expect(err).toBeNull()
          expect(allowed).toBe(true)
        })
      })
    })

    test('should reject requests from disallowed origins', () => {
      const disallowedOrigin = 'http://malicious-site.com'
      
      corsOptions.origin(disallowedOrigin, (err, allowed) => {
        expect(err).toBeInstanceOf(Error)
        expect(err.message).toBe('Not allowed by CORS')
        expect(allowed).toBeUndefined()
      })
    })

    test('should allow requests with no origin', () => {
      corsOptions.origin(undefined, (err, allowed) => {
        expect(err).toBeNull()
        expect(allowed).toBe(true)
      })
    })
  })

  describe('Rate Limiting', () => {
    test('should create rate limiter with default settings', () => {
      const rateLimit = createRateLimit()
      expect(typeof rateLimit).toBe('function')
    })

    test('should create rate limiter with custom settings', () => {
      const customRateLimit = createRateLimit(10, 60000) // 10 requests per minute
      expect(typeof customRateLimit).toBe('function')
    })

    test('should allow requests within rate limit', (done) => {
      const rateLimit = createRateLimit(5, 60000) // 5 requests per minute
      app.use('/test', rateLimit())
      app.get('/test', (req, res) => res.json({ success: true }))

      request(app)
        .get('/test')
        .expect(200, done)
    })

    test('should reject requests exceeding rate limit', (done) => {
      const rateLimit = createRateLimit(1, 60000) // 1 request per minute
      app.use('/test', rateLimit())
      app.get('/test', (req, res) => res.json({ success: true }))

      // First request should succeed
      request(app)
        .get('/test')
        .expect(200, () => {
          // Second request should be rate limited
          request(app)
            .get('/test')
            .expect(429, done)
        })
    })

    test('should skip rate limiting for OPTIONS requests', (done) => {
      const rateLimit = createRateLimit(1, 60000)
      app.use('/test', rateLimit())
      app.options('/test', (req, res) => res.json({ success: true }))

      request(app)
        .options('/test')
        .expect(200, done)
    })
  })

  describe('File Upload Validation', () => {
    test('should allow valid CSV files', (done) => {
      app.use('/upload', validateFileUpload)
      app.post('/upload', (req, res) => res.json({ success: true }))

      const csvContent = 'id,title\n1,Test'
      const csvBuffer = Buffer.from(csvContent, 'utf8')

      request(app)
        .post('/upload')
        .attach('csvFile', csvBuffer, 'test.csv')
        .expect(200, done)
    })

    test('should reject non-CSV files', (done) => {
      app.use('/upload', validateFileUpload)
      app.post('/upload', (req, res) => res.json({ success: true }))

      const textContent = 'This is not a CSV file'
      const textBuffer = Buffer.from(textContent, 'utf8')

      request(app)
        .post('/upload')
        .attach('csvFile', textBuffer, 'test.txt')
        .expect(400, done)
    })

    test('should reject files with suspicious names', (done) => {
      app.use('/upload', validateFileUpload)
      app.post('/upload', (req, res) => res.json({ success: true }))

      const csvContent = 'id,title\n1,Test'
      const csvBuffer = Buffer.from(csvContent, 'utf8')

      request(app)
        .post('/upload')
        .attach('csvFile', csvBuffer, 'test<script>alert("xss")</script>.csv')
        .expect(400, done)
    })

    test('should allow requests without files', (done) => {
      app.use('/upload', validateFileUpload)
      app.post('/upload', (req, res) => res.json({ success: true }))

      request(app)
        .post('/upload')
        .expect(200, done)
    })
  })

  describe('Input Sanitization', () => {
    test('should sanitize XSS attempts in query parameters', (done) => {
      app.use(sanitizeInput)
      app.get('/test', (req, res) => {
        expect(req.query.search).not.toContain('<script>')
        res.json({ success: true })
      })

      request(app)
        .get('/test?search=<script>alert("xss")</script>')
        .expect(200, done)
    })

    test('should sanitize XSS attempts in body parameters', (done) => {
      app.use(sanitizeInput)
      app.post('/test', (req, res) => {
        expect(req.body.title).not.toContain('<script>')
        res.json({ success: true })
      })

      request(app)
        .post('/test')
        .send({ title: '<script>alert("xss")</script>' })
        .expect(200, done)
    })

    test('should sanitize nested objects', (done) => {
      app.use(sanitizeInput)
      app.post('/test', (req, res) => {
        expect(req.body.data.title).not.toContain('<script>')
        res.json({ success: true })
      })

      request(app)
        .post('/test')
        .send({ 
          data: { 
            title: '<script>alert("xss")</script>',
            description: 'javascript:alert("xss")'
          } 
        })
        .expect(200, done)
    })

    test('should sanitize arrays', (done) => {
      app.use(sanitizeInput)
      app.post('/test', (req, res) => {
        expect(req.body.titles).toEqual(['Clean Title', 'Another Clean Title'])
        res.json({ success: true })
      })

      request(app)
        .post('/test')
        .send({ 
          titles: [
            '<script>alert("xss")</script>',
            'javascript:alert("xss")',
            'Clean Title',
            'Another Clean Title'
          ]
        })
        .expect(200, done)
    })
  })
})

describe('Validation Middleware Tests', () => {
  let app

  beforeEach(() => {
    app = express()
    app.use(express.json())
    app.use(express.urlencoded({ extended: true }))
  })

  describe('CSV Import Validation', () => {
    test('should validate CSV file upload', (done) => {
      app.use('/import', validateCSVImport)
      app.post('/import', (req, res) => res.json({ success: true }))

      const csvContent = 'id,title\n1,Test'
      const csvBuffer = Buffer.from(csvContent, 'utf8')

      request(app)
        .post('/import')
        .attach('csvFile', csvBuffer, 'test.csv')
        .expect(200, done)
    })

    test('should reject missing CSV file', (done) => {
      app.use('/import', validateCSVImport)
      app.post('/import', (req, res) => res.json({ success: true }))

      request(app)
        .post('/import')
        .expect(400, done)
    })

    test('should reject non-CSV file extension', (done) => {
      app.use('/import', validateCSVImport)
      app.post('/import', (req, res) => res.json({ success: true }))

      const csvContent = 'id,title\n1,Test'
      const csvBuffer = Buffer.from(csvContent, 'utf8')

      request(app)
        .post('/import')
        .attach('csvFile', csvBuffer, 'test.txt')
        .expect(400, done)
    })

    test('should reject oversized files', (done) => {
      app.use('/import', validateCSVImport)
      app.post('/import', (req, res) => res.json({ success: true }))

      // Create a large buffer (over 50MB)
      const largeContent = 'x'.repeat(51 * 1024 * 1024)
      const largeBuffer = Buffer.from(largeContent, 'utf8')

      request(app)
        .post('/import')
        .attach('csvFile', largeBuffer, 'large.csv')
        .expect(400, done)
    })
  })

  describe('Items Query Validation', () => {
    test('should validate valid search parameters', (done) => {
      app.use('/items', validateItemsQuery)
      app.get('/items', (req, res) => res.json({ success: true }))

      request(app)
        .get('/items?search=test&sortBy=title&sortOrder=ASC&limit=10&offset=0')
        .expect(200, done)
    })

    test('should reject invalid sort field', (done) => {
      app.use('/items', validateItemsQuery)
      app.get('/items', (req, res) => res.json({ success: true }))

      request(app)
        .get('/items?sortBy=invalid_field')
        .expect(400, done)
    })

    test('should reject invalid sort order', (done) => {
      app.use('/items', validateItemsQuery)
      app.get('/items', (req, res) => res.json({ success: true }))

      request(app)
        .get('/items?sortOrder=INVALID')
        .expect(400, done)
    })

    test('should reject search term that is too long', (done) => {
      app.use('/items', validateItemsQuery)
      app.get('/items', (req, res) => res.json({ success: true }))

      const longSearch = 'a'.repeat(101)
      request(app)
        .get(`/items?search=${encodeURIComponent(longSearch)}`)
        .expect(400, done)
    })

    test('should reject negative limit', (done) => {
      app.use('/items', validateItemsQuery)
      app.get('/items', (req, res) => res.json({ success: true }))

      request(app)
        .get('/items?limit=-1')
        .expect(400, done)
    })

    test('should reject limit exceeding maximum', (done) => {
      app.use('/items', validateItemsQuery)
      app.get('/items', (req, res) => res.json({ success: true }))

      request(app)
        .get('/items?limit=1001')
        .expect(400, done)
    })

    test('should reject negative offset', (done) => {
      app.use('/items', validateItemsQuery)
      app.get('/items', (req, res) => res.json({ success: true }))

      request(app)
        .get('/items?offset=-1')
        .expect(400, done)
    })
  })

  describe('Input Sanitization (Validation)', () => {
    test('should sanitize malicious input', (done) => {
      app.use(validationSanitizeInput)
      app.get('/test', (req, res) => {
        expect(req.query.search).not.toContain('<script>')
        expect(req.query.search).not.toContain('javascript:')
        res.json({ success: true })
      })

      request(app)
        .get('/test?search=<script>alert("xss")</script>')
        .expect(200, done)
    })

    test('should preserve valid input', (done) => {
      app.use(validationSanitizeInput)
      app.get('/test', (req, res) => {
        expect(req.query.search).toBe('Valid search term')
        res.json({ success: true })
      })

      request(app)
        .get('/test?search=Valid search term')
        .expect(200, done)
    })
  })
})

describe('Error Handling Tests', () => {
  let app

  beforeEach(() => {
    app = express()
    app.use(express.json())
  })

  test('should handle validation errors gracefully', (done) => {
    const { handleValidationErrors } = require('../middleware/validation.js')
    
    app.use('/test', handleValidationErrors)
    app.get('/test', (req, res) => res.json({ success: true }))

    // This would normally be set by express-validator
    request(app)
      .get('/test')
      .expect(200, done)
  })

  test('should handle CORS errors', (done) => {
    const { errorHandler } = require('../middleware/security.js')
    
    app.use('/test', errorHandler)
    app.get('/test', (req, res, next) => {
      const error = new Error('Not allowed by CORS')
      next(error)
    })

    request(app)
      .get('/test')
      .expect(500, done)
  })

  test('should handle validation errors', (done) => {
    const { errorHandler } = require('../middleware/security.js')
    
    app.use('/test', errorHandler)
    app.get('/test', (req, res, next) => {
      const error = new Error('Validation failed')
      error.name = 'ValidationError'
      next(error)
    })

    request(app)
      .get('/test')
      .expect(400, done)
  })

  test('should handle unauthorized errors', (done) => {
    const { errorHandler } = require('../middleware/security.js')
    
    app.use('/test', errorHandler)
    app.get('/test', (req, res, next) => {
      const error = new Error('Unauthorized')
      error.name = 'UnauthorizedError'
      next(error)
    })

    request(app)
      .get('/test')
      .expect(401, done)
  })
})
