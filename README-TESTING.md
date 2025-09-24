# Media Vault Testing Guide

This document provides comprehensive information about the testing setup and how to run tests for the Media Vault application.

## Test Structure

The Media Vault application has a comprehensive testing suite covering:

- **Frontend Tests**: React components, hooks, and user interactions
- **Backend Tests**: API endpoints, middleware, and business logic
- **Database Tests**: Schema validation, CRUD operations, and data integrity
- **Integration Tests**: End-to-end workflows and system integration
- **Performance Tests**: Load testing, concurrent operations, and optimization
- **Security Tests**: Input validation, SQL injection prevention, and XSS protection

## Test Frameworks

### Frontend Testing
- **Framework**: Vitest
- **Testing Library**: @testing-library/react, @testing-library/user-event
- **Environment**: jsdom
- **Coverage**: v8 provider

### Backend Testing
- **Framework**: Jest
- **HTTP Testing**: Supertest
- **Environment**: Node.js
- **Database**: PostgreSQL test instance

## Running Tests

### Prerequisites

1. **Node.js**: Version 18 or higher
2. **PostgreSQL**: Version 15 or higher
3. **Environment Variables**: Set up test database configuration

### Environment Setup

Create a `.env.test` file in the project root:

```bash
# Test Database Configuration
TEST_DB_HOST=localhost
TEST_DB_PORT=5432
TEST_DB_NAME=media_vault_test
TEST_DB_USER=test_user
TEST_DB_PASSWORD=test_password

# Test Server Configuration
NODE_ENV=test
PORT=3002
```

### Test Commands

#### Frontend Tests
```bash
# Run all frontend tests
npm run test

# Run tests in watch mode
npm run test:watch

# Run tests with UI
npm run test:ui

# Run tests with coverage
npm run test:coverage

# Run tests once (CI mode)
npm run test:run
```

#### Backend Tests
```bash
# Navigate to server directory
cd server

# Run all backend tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage

# Run tests in CI mode
npm run test:ci
```

#### Integration Tests
```bash
# Run integration tests
npm run test:integration

# Run performance tests
npm run test:performance
```

#### All Tests
```bash
# Run all tests (frontend + backend + integration)
npm run test:all

# Run tests in CI mode
npm run test:ci
```

## Test Categories

### 1. Frontend Tests (`src/`)

#### Component Tests
- **ErrorBoundary**: Error handling and recovery
- **App**: Main application component and user interactions
- **Database API**: API client functions and error handling

#### Test Files
- `src/components/__tests__/ErrorBoundary.test.tsx`
- `src/lib/__tests__/database.test.ts`
- `src/__tests__/App.test.tsx`

#### Coverage Areas
- Component rendering
- User interactions
- State management
- Error handling
- API integration

### 2. Backend Tests (`server/tests/`)

#### API Tests
- **Health Check**: Server status and database connectivity
- **Items Endpoint**: CRUD operations and data retrieval
- **Stats Endpoint**: Statistics calculation and aggregation
- **CSV Import**: File upload and data processing
- **Database Initialization**: Schema setup and migration

#### Middleware Tests
- **Security**: CORS, rate limiting, input sanitization
- **Validation**: Request validation and error handling
- **File Upload**: File type validation and security checks

#### Database Tests
- **Schema Validation**: Table structure and constraints
- **CRUD Operations**: Create, read, update, delete operations
- **CSV Import Function**: Data transformation and import logic
- **Performance**: Index usage and query optimization
- **Data Integrity**: Constraint enforcement and consistency

#### Test Files
- `server/tests/api.test.js`
- `server/tests/middleware.test.js`
- `server/tests/database.test.js`

### 3. Integration Tests (`tests/`)

#### End-to-End Workflows
- **Full CSV Import**: Complete import workflow from upload to data retrieval
- **Search and Filtering**: Data querying and result filtering
- **Duplicate Handling**: Update operations and conflict resolution
- **Large Data Sets**: Performance with large CSV files
- **Error Recovery**: Graceful handling of malformed data

#### System Integration
- **Database Connectivity**: Connection pooling and error handling
- **Concurrent Operations**: Multiple simultaneous requests
- **Security Validation**: SQL injection and XSS prevention
- **Performance Monitoring**: Response times and resource usage

#### Test Files
- `tests/integration.test.js`
- `tests/performance.test.js`

## Test Configuration

### Vitest Configuration (`vitest.config.ts`)
```typescript
export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'src/test/', '**/*.d.ts']
    }
  }
})
```

### Jest Configuration (`server/jest.config.js`)
```javascript
export default {
  preset: 'jest-environment-node',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/__tests__/**/*.js', '**/?(*.)+(spec|test).js'],
  collectCoverageFrom: ['**/*.js', '!**/node_modules/**', '!**/tests/**'],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
  testTimeout: 30000,
  verbose: true
}
```

## CI/CD Integration

### GitHub Actions Workflow (`.github/workflows/test.yml`)

The CI/CD pipeline includes:

1. **Frontend Tests**: Component and integration tests with coverage
2. **Backend Tests**: API and middleware tests with PostgreSQL service
3. **Database Tests**: Schema and CRUD operation tests
4. **Integration Tests**: End-to-end workflow tests
5. **Security Tests**: Vulnerability scanning and security validation
6. **Build Tests**: Application build verification
7. **Docker Tests**: Container image testing
8. **Performance Tests**: Load testing and performance validation

### Test Environments

#### Development
- Local PostgreSQL instance
- Hot reloading enabled
- Detailed error reporting
- Interactive test runner

#### CI/CD
- PostgreSQL service container
- Automated test execution
- Coverage reporting
- Performance monitoring
- Security scanning

## Test Data Management

### Database Setup
- Test database is created automatically
- Schema is initialized from `server/schema.sql`
- Test data is cleaned between tests
- Isolated test environment

### Mock Data
- CSV test files for import testing
- Mock API responses for frontend tests
- Simulated user interactions
- Performance test data sets

## Coverage Reports

### Frontend Coverage
- Component rendering coverage
- User interaction coverage
- API integration coverage
- Error handling coverage

### Backend Coverage
- API endpoint coverage
- Middleware coverage
- Database operation coverage
- Error handling coverage

### Coverage Thresholds
- **Statements**: 80%
- **Branches**: 75%
- **Functions**: 80%
- **Lines**: 80%

## Debugging Tests

### Frontend Test Debugging
```bash
# Run tests with detailed output
npm run test -- --reporter=verbose

# Run specific test file
npm run test -- src/__tests__/App.test.tsx

# Run tests with UI for debugging
npm run test:ui
```

### Backend Test Debugging
```bash
# Run tests with detailed output
cd server && npm test -- --verbose

# Run specific test file
cd server && npm test -- tests/api.test.js

# Run tests with coverage
cd server && npm run test:coverage
```

### Database Test Debugging
```bash
# Connect to test database
psql -h localhost -U test_user -d media_vault_test

# Check test data
SELECT COUNT(*) FROM media_items;
SELECT COUNT(*) FROM media_items_staging;
```

## Performance Testing

### Load Testing
- Concurrent request handling
- Large data set processing
- Database connection pooling
- Memory usage monitoring

### Benchmark Targets
- **API Response Time**: < 2 seconds for large datasets
- **CSV Import**: < 30 seconds for 5000 records
- **Database Operations**: < 1 second for complex queries
- **Concurrent Requests**: Handle 20+ simultaneous requests

## Security Testing

### Input Validation
- SQL injection prevention
- XSS attack prevention
- File upload security
- Input sanitization

### Authentication & Authorization
- CORS policy validation
- Rate limiting enforcement
- File type validation
- Request size limits

## Troubleshooting

### Common Issues

#### Database Connection Issues
```bash
# Check PostgreSQL status
sudo systemctl status postgresql

# Check test database exists
psql -h localhost -U test_user -l

# Reset test database
dropdb -h localhost -U test_user media_vault_test
createdb -h localhost -U test_user media_vault_test
```

#### Test Environment Issues
```bash
# Clear node modules and reinstall
rm -rf node_modules package-lock.json
npm install

# Clear test cache
npm run test -- --clearCache
```

#### Coverage Issues
```bash
# Generate fresh coverage report
npm run test:coverage -- --coverage

# Check coverage thresholds
npm run test:coverage -- --coverage --coverageThreshold
```

## Best Practices

### Writing Tests
1. **Test Isolation**: Each test should be independent
2. **Clear Naming**: Use descriptive test names
3. **Arrange-Act-Assert**: Structure tests clearly
4. **Mock External Dependencies**: Isolate units under test
5. **Test Edge Cases**: Include error conditions and boundary values

### Test Maintenance
1. **Regular Updates**: Keep tests current with code changes
2. **Performance Monitoring**: Track test execution times
3. **Coverage Tracking**: Maintain coverage thresholds
4. **Documentation**: Keep test documentation updated
5. **CI/CD Integration**: Ensure tests run on every commit

## Contributing

When adding new features:

1. **Write Tests First**: Follow TDD principles
2. **Update Test Documentation**: Document new test cases
3. **Maintain Coverage**: Ensure new code is tested
4. **Performance Considerations**: Test performance impact
5. **Security Validation**: Include security test cases

## Resources

- [Vitest Documentation](https://vitest.dev/)
- [Jest Documentation](https://jestjs.io/)
- [Testing Library Documentation](https://testing-library.com/)
- [Supertest Documentation](https://github.com/visionmedia/supertest)
- [PostgreSQL Testing Guide](https://www.postgresql.org/docs/current/testing.html)
