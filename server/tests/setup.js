// Convert to CommonJS Jest global usage to avoid ESM import in setup
/* eslint-disable no-undef */
const { jest: jestGlobal } = global;

// Mock console methods to reduce noise in tests
const originalConsoleError = console.error
const originalConsoleWarn = console.warn
const originalConsoleLog = console.log

beforeEach(() => {
  console.error = jest.fn()
  console.warn = jest.fn()
  console.log = jest.fn()
})

afterEach(() => {
  console.error = originalConsoleError
  console.warn = originalConsoleWarn
  console.log = originalConsoleLog
  jest.clearAllMocks()
})

// Set test environment variables
process.env.NODE_ENV = 'test'
process.env.DB_HOST = 'localhost'
process.env.DB_PORT = '5432'
process.env.DB_NAME = 'media_vault_test'
process.env.DB_USER = 'test_user'
process.env.DB_PASSWORD = 'test_password'
process.env.PORT = '3002'
process.env.CORS_ORIGIN = 'http://localhost:3000,http://localhost:5173'
