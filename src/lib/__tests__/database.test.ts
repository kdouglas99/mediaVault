import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { 
  testConnection, 
  getItems, 
  getStats, 
  importCSV, 
  initializeDatabase 
} from '../database'

// Mock fetch globally
const mockFetch = vi.fn()
global.fetch = mockFetch

describe('Database API Functions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  describe('testConnection', () => {
    it('should return success when connection is successful', async () => {
      const mockResponse = {
        success: true,
        time: '2024-01-01T00:00:00.000Z',
        message: 'Database connection successful'
      }

      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve(mockResponse)
      })

      const result = await testConnection()

      expect(result).toEqual(mockResponse)
      expect(mockFetch).toHaveBeenCalledWith('http://localhost:3001/api/test')
    })

    it('should return error when connection fails', async () => {
      const mockResponse = {
        success: false,
        error: 'Database connection failed'
      }

      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve(mockResponse)
      })

      const result = await testConnection()

      expect(result).toEqual(mockResponse)
    })

    it('should handle network errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      const result = await testConnection()

      expect(result).toEqual({
        success: false,
        error: 'Network error'
      })
    })

    it('should handle unknown errors', async () => {
      mockFetch.mockRejectedValueOnce('Unknown error')

      const result = await testConnection()

      expect(result).toEqual({
        success: false,
        error: 'Network error'
      })
    })
  })

  describe('getItems', () => {
    it('should return items when API call is successful', async () => {
      const mockItems = [
        { id: 1, title: 'Test Movie', content_type: 'movie' },
        { id: 2, title: 'Test Series', content_type: 'series' }
      ]

      const mockResponse = {
        success: true,
        data: mockItems,
        totalItems: 2
      }

      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve(mockResponse)
      })

      const result = await getItems()

      expect(result).toEqual(mockItems)
      expect(mockFetch).toHaveBeenCalledWith('http://localhost:3001/api/items?')
    })

    it('should pass query parameters correctly', async () => {
      const mockItems = [{ id: 1, title: 'Search Result' }]
      const mockResponse = { success: true, data: mockItems }

      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve(mockResponse)
      })

      const params = { search: 'test', sortBy: 'title', limit: 10 }
      await getItems(params)

      expect(mockFetch).toHaveBeenCalledWith('http://localhost:3001/api/items?search=test&sortBy=title&limit=10')
    })

    it('should return empty array when API call fails', async () => {
      mockFetch.mockRejectedValueOnce(new Error('API error'))

      const result = await getItems()

      expect(result).toEqual([])
    })

    it('should return empty array when API returns unsuccessful response', async () => {
      const mockResponse = {
        success: false,
        error: 'Failed to fetch items'
      }

      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve(mockResponse)
      })

      const result = await getItems()

      expect(result).toEqual([])
    })

    it('should handle malformed response', async () => {
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({}) // Missing success field
      })

      const result = await getItems()

      expect(result).toEqual([])
    })
  })

  describe('getStats', () => {
    it('should return stats when API call is successful', async () => {
      const mockStats = {
        totalItems: 100,
        totalSeries: 25,
        contentTypes: [{ content_type: 'movie', count: 60 }],
        availabilityStates: [{ availability_state: 'available', count: 80 }],
        premiumFeatures: [{ feature: 'hd', count: 50 }]
      }

      const mockResponse = {
        success: true,
        data: mockStats
      }

      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve(mockResponse)
      })

      const result = await getStats()

      expect(result).toEqual(mockStats)
      expect(mockFetch).toHaveBeenCalledWith('http://localhost:3001/api/stats')
    })

    it('should return null when API call fails', async () => {
      mockFetch.mockRejectedValueOnce(new Error('API error'))

      const result = await getStats()

      expect(result).toBeNull()
    })

    it('should return null when API returns unsuccessful response', async () => {
      const mockResponse = {
        success: false,
        error: 'Failed to fetch stats'
      }

      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve(mockResponse)
      })

      const result = await getStats()

      expect(result).toBeNull()
    })
  })

  describe('importCSV', () => {
    it('should import CSV file successfully', async () => {
      const mockFile = new File(['id,title\n1,Test'], 'test.csv', { type: 'text/csv' })
      const mockResponse = {
        success: true,
        message: 'CSV imported successfully'
      }

      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve(mockResponse)
      })

      const result = await importCSV(mockFile)

      expect(result).toEqual(mockResponse)
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3001/api/import/csv',
        expect.objectContaining({
          method: 'POST',
          body: expect.any(FormData)
        })
      )
    })

    it('should handle import failure', async () => {
      const mockFile = new File(['invalid,csv'], 'test.csv', { type: 'text/csv' })
      const mockResponse = {
        success: false,
        error: 'CSV import failed'
      }

      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve(mockResponse)
      })

      const result = await importCSV(mockFile)

      expect(result).toEqual(mockResponse)
    })

    it('should handle network errors during import', async () => {
      const mockFile = new File(['id,title\n1,Test'], 'test.csv', { type: 'text/csv' })
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      const result = await importCSV(mockFile)

      expect(result).toEqual({
        success: false,
        error: 'Network error'
      })
    })

    it('should handle unknown errors during import', async () => {
      const mockFile = new File(['id,title\n1,Test'], 'test.csv', { type: 'text/csv' })
      mockFetch.mockRejectedValueOnce('Unknown error')

      const result = await importCSV(mockFile)

      expect(result).toEqual({
        success: false,
        error: 'Import failed'
      })
    })

    it('should create FormData with correct file', async () => {
      const mockFile = new File(['id,title\n1,Test'], 'test.csv', { type: 'text/csv' })
      const mockResponse = { success: true, message: 'Success' }

      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve(mockResponse)
      })

      await importCSV(mockFile)

      const callArgs = mockFetch.mock.calls[0]
      const formData = callArgs[1].body as FormData

      expect(formData.get('csvFile')).toBe(mockFile)
    })
  })

  describe('initializeDatabase', () => {
    it('should initialize database successfully', async () => {
      const mockResponse = {
        success: true,
        message: 'Database initialized'
      }

      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve(mockResponse)
      })

      const result = await initializeDatabase()

      expect(result).toEqual(mockResponse)
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3001/api/init-db',
        expect.objectContaining({
          method: 'POST'
        })
      )
    })

    it('should handle initialization failure', async () => {
      const mockResponse = {
        success: false,
        error: 'Database initialization failed'
      }

      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve(mockResponse)
      })

      const result = await initializeDatabase()

      expect(result).toEqual(mockResponse)
    })

    it('should handle network errors during initialization', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      const result = await initializeDatabase()

      expect(result).toEqual({
        success: false,
        error: 'Network error'
      })
    })

    it('should handle unknown errors during initialization', async () => {
      mockFetch.mockRejectedValueOnce('Unknown error')

      const result = await initializeDatabase()

      expect(result).toEqual({
        success: false,
        error: 'Database initialization failed'
      })
    })
  })

  describe('API URL computation', () => {
    it('should use environment variable when available', async () => {
      // Mock environment variable
      const originalEnv = (import.meta as any)?.env
      ;(import.meta as any).env = {
        VITE_API_URL: 'https://api.example.com'
      }

      // Re-import to get new API URL
      const { testConnection: testConnectionWithEnv } = await import('../database')

      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ success: true })
      })

      await testConnectionWithEnv()

      expect(mockFetch).toHaveBeenCalledWith('https://api.example.com/api/test')

      // Restore original environment
      ;(import.meta as any).env = originalEnv
    })

    it('should fall back to localhost when environment variable is localhost', async () => {
      // Mock environment variable with localhost
      const originalEnv = (import.meta as any)?.env
      ;(import.meta as any).env = {
        VITE_API_URL: 'http://localhost:3000'
      }

      // Re-import to get new API URL
      const { testConnection: testConnectionWithLocalhost } = await import('../database')

      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ success: true })
      })

      await testConnectionWithLocalhost()

      expect(mockFetch).toHaveBeenCalledWith('http://localhost:3001/api/test')

      // Restore original environment
      ;(import.meta as any).env = originalEnv
    })

    it('should use window location when no environment variable', async () => {
      // Mock window location
      Object.defineProperty(window, 'location', {
        value: {
          protocol: 'https:',
          hostname: 'example.com',
          port: '8080'
        },
        writable: true
      })

      // Re-import to get new API URL
      const { testConnection: testConnectionWithLocation } = await import('../database')

      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ success: true })
      })

      await testConnectionWithLocation()

      expect(mockFetch).toHaveBeenCalledWith('https://example.com:3001/api/test')
    })
  })
})
