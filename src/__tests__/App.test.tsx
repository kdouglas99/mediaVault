import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import App from '../App'
import * as database from '../lib/database'

// Mock the database module
vi.mock('../lib/database', () => ({
  testConnection: vi.fn(),
  getItems: vi.fn(),
  getStats: vi.fn(),
  importCSV: vi.fn(),
  initializeDatabase: vi.fn()
}))

describe('App Component', () => {
  const mockDatabase = vi.mocked(database)

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Initial Load', () => {
    it('should render the main heading', () => {
      mockDatabase.testConnection.mockResolvedValue({
        success: true,
        time: '2024-01-01T00:00:00.000Z'
      })
      mockDatabase.getItems.mockResolvedValue([])
      mockDatabase.getStats.mockResolvedValue(null)

      render(<App />)

      expect(screen.getByText('🎬 Media Vault')).toBeInTheDocument()
    })

    it('should check database connection on mount', async () => {
      mockDatabase.testConnection.mockResolvedValue({
        success: true,
        time: '2024-01-01T00:00:00.000Z'
      })
      mockDatabase.getItems.mockResolvedValue([])
      mockDatabase.getStats.mockResolvedValue(null)

      render(<App />)

      await waitFor(() => {
        expect(mockDatabase.testConnection).toHaveBeenCalled()
      })
    })

    it('should display database status when connection is successful', async () => {
      const mockTime = '2024-01-01T00:00:00.000Z'
      mockDatabase.testConnection.mockResolvedValue({
        success: true,
        time: mockTime
      })
      mockDatabase.getItems.mockResolvedValue([])
      mockDatabase.getStats.mockResolvedValue(null)

      render(<App />)

      await waitFor(() => {
        expect(screen.getByText(/Connected at/)).toBeInTheDocument()
      })
    })

    it('should display error when database connection fails', async () => {
      mockDatabase.testConnection.mockResolvedValue({
        success: false,
        error: 'Connection failed'
      })

      render(<App />)

      await waitFor(() => {
        expect(screen.getByText(/Error: Connection failed/)).toBeInTheDocument()
      })
    })
  })

  describe('Database Status Section', () => {
    it('should show loading state initially', () => {
      mockDatabase.testConnection.mockImplementation(() => new Promise(() => {})) // Never resolves

      render(<App />)

      expect(screen.getByText('Checking...')).toBeInTheDocument()
      expect(screen.getByText('⏳ Loading...')).toBeInTheDocument()
    })

    it('should hide loading state after connection check', async () => {
      mockDatabase.testConnection.mockResolvedValue({
        success: true,
        time: '2024-01-01T00:00:00.000Z'
      })
      mockDatabase.getItems.mockResolvedValue([])
      mockDatabase.getStats.mockResolvedValue(null)

      render(<App />)

      await waitFor(() => {
        expect(screen.queryByText('⏳ Loading...')).not.toBeInTheDocument()
      })
    })
  })

  describe('CSV Import Section', () => {
    it('should render CSV import section', () => {
      mockDatabase.testConnection.mockResolvedValue({
        success: true,
        time: '2024-01-01T00:00:00.000Z'
      })
      mockDatabase.getItems.mockResolvedValue([])
      mockDatabase.getStats.mockResolvedValue(null)

      render(<App />)

      expect(screen.getByText('📤 Import CSV Data')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: '🔧 Initialize Database' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: '🚀 Import CSV' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: '❌ Clear' })).toBeInTheDocument()
    })

    it('should handle file selection', async () => {
      const user = userEvent.setup()
      mockDatabase.testConnection.mockResolvedValue({
        success: true,
        time: '2024-01-01T00:00:00.000Z'
      })
      mockDatabase.getItems.mockResolvedValue([])
      mockDatabase.getStats.mockResolvedValue(null)

      render(<App />)

      const file = new File(['id,title\n1,Test'], 'test.csv', { type: 'text/csv' })
      const fileInput = screen.getByRole('textbox', { hidden: true }) // File input is hidden

      await user.upload(fileInput, file)

      await waitFor(() => {
        expect(screen.getByText(/Selected: test.csv/)).toBeInTheDocument()
      })
    })

    it('should initialize database when button is clicked', async () => {
      const user = userEvent.setup()
      mockDatabase.testConnection.mockResolvedValue({
        success: true,
        time: '2024-01-01T00:00:00.000Z'
      })
      mockDatabase.getItems.mockResolvedValue([])
      mockDatabase.getStats.mockResolvedValue(null)
      mockDatabase.initializeDatabase.mockResolvedValue({
        success: true,
        message: 'Database initialized'
      })

      render(<App />)

      const initButton = screen.getByRole('button', { name: '🔧 Initialize Database' })
      await user.click(initButton)

      await waitFor(() => {
        expect(mockDatabase.initializeDatabase).toHaveBeenCalled()
      })

      expect(screen.getByText(/Database schema initialized successfully/)).toBeInTheDocument()
    })

    it('should handle database initialization failure', async () => {
      const user = userEvent.setup()
      mockDatabase.testConnection.mockResolvedValue({
        success: true,
        time: '2024-01-01T00:00:00.000Z'
      })
      mockDatabase.getItems.mockResolvedValue([])
      mockDatabase.getStats.mockResolvedValue(null)
      mockDatabase.initializeDatabase.mockResolvedValue({
        success: false,
        error: 'Initialization failed'
      })

      render(<App />)

      const initButton = screen.getByRole('button', { name: '🔧 Initialize Database' })
      await user.click(initButton)

      await waitFor(() => {
        expect(screen.getByText(/Database initialization failed: Initialization failed/)).toBeInTheDocument()
      })
    })

    it('should import CSV when file is selected and import button is clicked', async () => {
      const user = userEvent.setup()
      mockDatabase.testConnection.mockResolvedValue({
        success: true,
        time: '2024-01-01T00:00:00.000Z'
      })
      mockDatabase.getItems.mockResolvedValue([])
      mockDatabase.getStats.mockResolvedValue(null)
      mockDatabase.importCSV.mockResolvedValue({
        success: true,
        message: 'CSV imported successfully'
      })

      render(<App />)

      // Select file
      const file = new File(['id,title\n1,Test'], 'test.csv', { type: 'text/csv' })
      const fileInput = screen.getByRole('textbox', { hidden: true })
      await user.upload(fileInput, file)

      // Wait for file to be selected
      await waitFor(() => {
        expect(screen.getByText(/Selected: test.csv/)).toBeInTheDocument()
      })

      // Click import button
      const importButton = screen.getByRole('button', { name: '🚀 Import CSV' })
      await user.click(importButton)

      await waitFor(() => {
        expect(mockDatabase.importCSV).toHaveBeenCalledWith(file)
      })

      expect(screen.getByText(/Success! CSV imported successfully/)).toBeInTheDocument()
    })

    it('should disable import button when no file is selected', () => {
      mockDatabase.testConnection.mockResolvedValue({
        success: true,
        time: '2024-01-01T00:00:00.000Z'
      })
      mockDatabase.getItems.mockResolvedValue([])
      mockDatabase.getStats.mockResolvedValue(null)

      render(<App />)

      const importButton = screen.getByRole('button', { name: '🚀 Import CSV' })
      expect(importButton).toBeDisabled()
    })

    it('should clear file selection when clear button is clicked', async () => {
      const user = userEvent.setup()
      mockDatabase.testConnection.mockResolvedValue({
        success: true,
        time: '2024-01-01T00:00:00.000Z'
      })
      mockDatabase.getItems.mockResolvedValue([])
      mockDatabase.getStats.mockResolvedValue(null)

      render(<App />)

      // Select file
      const file = new File(['id,title\n1,Test'], 'test.csv', { type: 'text/csv' })
      const fileInput = screen.getByRole('textbox', { hidden: true })
      await user.upload(fileInput, file)

      // Wait for file to be selected
      await waitFor(() => {
        expect(screen.getByText(/Selected: test.csv/)).toBeInTheDocument()
      })

      // Click clear button
      const clearButton = screen.getByRole('button', { name: '❌ Clear' })
      await user.click(clearButton)

      await waitFor(() => {
        expect(screen.queryByText(/Selected: test.csv/)).not.toBeInTheDocument()
      })
    })
  })

  describe('Statistics Section', () => {
    it('should display statistics when available', async () => {
      const mockStats = {
        totalItems: 100,
        totalSeries: 25
      }

      mockDatabase.testConnection.mockResolvedValue({
        success: true,
        time: '2024-01-01T00:00:00.000Z'
      })
      mockDatabase.getItems.mockResolvedValue([])
      mockDatabase.getStats.mockResolvedValue(mockStats)

      render(<App />)

      await waitFor(() => {
        expect(screen.getByText('📊 Statistics')).toBeInTheDocument()
        expect(screen.getByText('Total Items: 100')).toBeInTheDocument()
        expect(screen.getByText('Total Series: 25')).toBeInTheDocument()
      })
    })

    it('should not display statistics section when stats are null', async () => {
      mockDatabase.testConnection.mockResolvedValue({
        success: true,
        time: '2024-01-01T00:00:00.000Z'
      })
      mockDatabase.getItems.mockResolvedValue([])
      mockDatabase.getStats.mockResolvedValue(null)

      render(<App />)

      await waitFor(() => {
        expect(screen.queryByText('📊 Statistics')).not.toBeInTheDocument()
      })
    })
  })

  describe('Media Items Section', () => {
    it('should display media items when available', async () => {
      const mockItems = [
        { id: 1, title: 'Test Movie', series_title: 'Test Series', content_type: 'movie' },
        { id: 2, title: 'Another Movie', content_type: 'movie' }
      ]

      mockDatabase.testConnection.mockResolvedValue({
        success: true,
        time: '2024-01-01T00:00:00.000Z'
      })
      mockDatabase.getItems.mockResolvedValue(mockItems)
      mockDatabase.getStats.mockResolvedValue(null)

      render(<App />)

      await waitFor(() => {
        expect(screen.getByText('📺 Media Items (2)')).toBeInTheDocument()
        expect(screen.getByText('Test Movie')).toBeInTheDocument()
        expect(screen.getByText('Series: Test Series')).toBeInTheDocument()
        expect(screen.getByText('Type: movie')).toBeInTheDocument()
        expect(screen.getByText('Another Movie')).toBeInTheDocument()
      })
    })

    it('should display empty state when no items are available', async () => {
      mockDatabase.testConnection.mockResolvedValue({
        success: true,
        time: '2024-01-01T00:00:00.000Z'
      })
      mockDatabase.getItems.mockResolvedValue([])
      mockDatabase.getStats.mockResolvedValue(null)

      render(<App />)

      await waitFor(() => {
        expect(screen.getByText('📺 Media Items (0)')).toBeInTheDocument()
        expect(screen.getByText('No media items found. Upload a CSV file above to import your data.')).toBeInTheDocument()
      })
    })
  })

  describe('Error Handling', () => {
    it('should handle network errors gracefully', async () => {
      mockDatabase.testConnection.mockRejectedValue(new Error('Network error'))

      render(<App />)

      await waitFor(() => {
        expect(screen.getByText(/Error: Network error/)).toBeInTheDocument()
      })
    })

    it('should handle CSV import errors', async () => {
      const user = userEvent.setup()
      mockDatabase.testConnection.mockResolvedValue({
        success: true,
        time: '2024-01-01T00:00:00.000Z'
      })
      mockDatabase.getItems.mockResolvedValue([])
      mockDatabase.getStats.mockResolvedValue(null)
      mockDatabase.importCSV.mockResolvedValue({
        success: false,
        error: 'Import failed'
      })

      render(<App />)

      // Select file
      const file = new File(['invalid,csv'], 'test.csv', { type: 'text/csv' })
      const fileInput = screen.getByRole('textbox', { hidden: true })
      await user.upload(fileInput, file)

      // Wait for file to be selected
      await waitFor(() => {
        expect(screen.getByText(/Selected: test.csv/)).toBeInTheDocument()
      })

      // Click import button
      const importButton = screen.getByRole('button', { name: '🚀 Import CSV' })
      await user.click(importButton)

      await waitFor(() => {
        expect(screen.getByText(/Import failed: Import failed/)).toBeInTheDocument()
      })
    })

    it('should handle unknown errors during CSV import', async () => {
      const user = userEvent.setup()
      mockDatabase.testConnection.mockResolvedValue({
        success: true,
        time: '2024-01-01T00:00:00.000Z'
      })
      mockDatabase.getItems.mockResolvedValue([])
      mockDatabase.getStats.mockResolvedValue(null)
      mockDatabase.importCSV.mockRejectedValue('Unknown error')

      render(<App />)

      // Select file
      const file = new File(['id,title\n1,Test'], 'test.csv', { type: 'text/csv' })
      const fileInput = screen.getByRole('textbox', { hidden: true })
      await user.upload(fileInput, file)

      // Wait for file to be selected
      await waitFor(() => {
        expect(screen.getByText(/Selected: test.csv/)).toBeInTheDocument()
      })

      // Click import button
      const importButton = screen.getByRole('button', { name: '🚀 Import CSV' })
      await user.click(importButton)

      await waitFor(() => {
        expect(screen.getByText(/Import failed: Unknown error occurred/)).toBeInTheDocument()
      })
    })
  })

  describe('Loading States', () => {
    it('should show loading state during database initialization', async () => {
      const user = userEvent.setup()
      mockDatabase.testConnection.mockResolvedValue({
        success: true,
        time: '2024-01-01T00:00:00.000Z'
      })
      mockDatabase.getItems.mockResolvedValue([])
      mockDatabase.getStats.mockResolvedValue(null)
      mockDatabase.initializeDatabase.mockImplementation(() => new Promise(() => {})) // Never resolves

      render(<App />)

      const initButton = screen.getByRole('button', { name: '🔧 Initialize Database' })
      await user.click(initButton)

      expect(screen.getByText('⏳ Loading...')).toBeInTheDocument()
      expect(initButton).toBeDisabled()
    })

    it('should show loading state during CSV import', async () => {
      const user = userEvent.setup()
      mockDatabase.testConnection.mockResolvedValue({
        success: true,
        time: '2024-01-01T00:00:00.000Z'
      })
      mockDatabase.getItems.mockResolvedValue([])
      mockDatabase.getStats.mockResolvedValue(null)
      mockDatabase.importCSV.mockImplementation(() => new Promise(() => {})) // Never resolves

      render(<App />)

      // Select file
      const file = new File(['id,title\n1,Test'], 'test.csv', { type: 'text/csv' })
      const fileInput = screen.getByRole('textbox', { hidden: true })
      await user.upload(fileInput, file)

      // Wait for file to be selected
      await waitFor(() => {
        expect(screen.getByText(/Selected: test.csv/)).toBeInTheDocument()
      })

      // Click import button
      const importButton = screen.getByRole('button', { name: '🚀 Import CSV' })
      await user.click(importButton)

      expect(screen.getByText('⏳ Importing...')).toBeInTheDocument()
      expect(importButton).toBeDisabled()
    })
  })
})
