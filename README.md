# Media Vault

A comprehensive media management system with CSV import capabilities, built with React, Node.js, and PostgreSQL.

## Features

- 📊 **Dashboard**: Interactive media browsing with advanced filtering
- 📥 **CSV Import**: Bulk import media data from CSV files
- 🔍 **Search & Filter**: Advanced search and filtering capabilities
- 📈 **Statistics**: Real-time statistics and analytics
- 🛡️ **Security**: Comprehensive security measures and input validation
- 🐳 **Docker**: Containerized deployment with Docker Compose

## Prerequisites

- Node.js 18+ 
- PostgreSQL 15+
- Docker & Docker Compose (optional)

## Quick Start

### 1. Clone and Setup

```bash
git clone <repository-url>
cd mediaVault
```

### 2. Environment Configuration

Copy the example environment file and configure your settings:

```bash
cp env.example .env
```

Edit `.env` with your database credentials:

```env
# Database Configuration
DB_HOST=localhost
DB_PORT=5432
DB_NAME=media_vault
DB_USER=postgres
DB_PASSWORD=your_secure_password

# Server Configuration
PORT=3001
NODE_ENV=development

# Frontend Configuration
VITE_API_URL=http://localhost:3001

# Security
CORS_ORIGIN=http://localhost:3000,http://localhost:5173
```

### 3. Install Dependencies

```bash
# Install frontend dependencies
npm install

# Install backend dependencies
cd server
npm install
cd ..
```

### 4. Database Setup

Start PostgreSQL and create the database:

```sql
CREATE DATABASE media_vault;
```

### 5. Start the Application

#### Option A: Docker Compose (Recommended)

```bash
docker-compose up -d
```

#### Option B: Manual Start

Terminal 1 - Backend:
```bash
cd server
npm start
```

Terminal 2 - Frontend:
```bash
npm run dev
```

### 6. Access the Application

- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:3001
- **Dashboard**: http://localhost:3000/dashboard.html
- **History**: http://localhost:3000/history.html

## Development

### Available Scripts

```bash
# Frontend
npm run dev          # Start development server
npm run build        # Build for production
npm run preview      # Preview production build
npm run lint         # Run ESLint

# Backend
cd server
npm start           # Start production server
npm run dev         # Start with auto-reload
```

### Project Structure

```
mediaVault/
├── src/                    # Frontend React source
│   ├── components/         # React components
│   ├── lib/               # Utility libraries
│   └── ...
├── server/                 # Backend Node.js source
│   ├── middleware/         # Express middleware
│   ├── schema.sql         # Database schema
│   └── server.js          # Main server file
├── public/                 # Static assets
├── docker-compose.yml     # Docker configuration
└── package.json           # Frontend dependencies
```

## Security Features

- ✅ **CORS Protection**: Configurable cross-origin resource sharing
- ✅ **Rate Limiting**: Request rate limiting with configurable limits
- ✅ **Input Validation**: Comprehensive input validation and sanitization
- ✅ **File Upload Security**: Secure file upload with type validation
- ✅ **Security Headers**: Helmet.js security headers
- ✅ **Error Boundaries**: React error boundaries for graceful error handling
- ✅ **SQL Injection Protection**: Parameterized queries
- ✅ **XSS Protection**: Input sanitization and CSP headers

## API Endpoints

### Core Endpoints

- `GET /api/test` - Database connection test
- `GET /api/items` - Get media items with filtering
- `GET /api/stats` - Get statistics
- `POST /api/import/csv` - Import CSV data
- `POST /api/init-db` - Initialize database schema

### Health & Debug

- `GET /health` - Health check endpoint
- `GET /api/config` - Configuration endpoint
- `GET /api/debug/tables` - Debug tables (development only)

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DB_HOST` | Database host | `localhost` |
| `DB_PORT` | Database port | `5432` |
| `DB_NAME` | Database name | `media_vault` |
| `DB_USER` | Database user | `postgres` |
| `DB_PASSWORD` | Database password | Required |
| `PORT` | Server port | `3001` |
| `NODE_ENV` | Environment | `development` |
| `VITE_API_URL` | Frontend API URL | `http://localhost:3001` |
| `CORS_ORIGIN` | Allowed CORS origins | `http://localhost:3000,http://localhost:5173` |
| `UPLOAD_RATE_LIMIT_MAX` | Max uploads per window | `3` |
| `UPLOAD_RATE_LIMIT_WINDOW_MS` | Upload rate limit window | `120000` |

### Database Configuration

The application uses PostgreSQL with the following key tables:

- `media_items` - Main media data table
- `media_items_staging` - Temporary table for CSV imports

## Troubleshooting

### Common Issues

1. **Database Connection Failed**
   - Verify PostgreSQL is running
   - Check database credentials in `.env`
   - Ensure database exists

2. **CORS Errors**
   - Check `CORS_ORIGIN` environment variable
   - Verify frontend URL is in allowed origins

3. **File Upload Issues**
   - Check file size limits
   - Verify file type is CSV
   - Check upload directory permissions

4. **Port Conflicts**
   - Change `PORT` in `.env` for backend
   - Update `VITE_API_URL` accordingly

### Logs

- Backend logs: Check console output
- Docker logs: `docker-compose logs -f`
- Database logs: Check PostgreSQL logs

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

MIT License - see LICENSE file for details.

## Support

For issues and questions:
1. Check the troubleshooting section
2. Review existing GitHub issues
3. Create a new issue with detailed information