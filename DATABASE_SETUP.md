# Database Setup Guide

This guide will help you set up the PostgreSQL database for Media Vault with the provided schema.

## Prerequisites

- PostgreSQL 15+ installed and running
- Node.js 18+ installed
- Access to create databases (superuser or database creation privileges)

## Quick Setup

### 1. Configure Environment

First, copy the environment template and configure your database settings:

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
```

### 2. Run Database Setup

Choose one of the following methods:

#### Option A: Using npm scripts (Recommended)

```bash
# Setup database (creates if doesn't exist, applies schema)
npm run db:setup

# Or using the shell script
npm run db:init
```

#### Option B: Using shell scripts directly

```bash
# Make scripts executable (if not already)
chmod +x scripts/*.sh

# Setup database
./scripts/setup-database.sh

# Or reset database (drops and recreates)
./scripts/reset-database.sh
```

#### Option C: Using PowerShell (Windows)

```powershell
# Setup database
.\scripts\setup-database.ps1
```

#### Option D: Manual setup

```bash
# Create database
createdb -h localhost -U postgres media_vault

# Apply schema
psql -h localhost -U postgres -d media_vault -f server/schema.sql
```

## What Gets Created

The setup process creates:

### Tables
- `media_items` - Main table for storing media data
- `media_items_staging` - Temporary table for CSV imports

### Functions
- `import_media_csv()` - Function to import data from staging table

### Indexes
- `idx_media_items_title` - Index on title column
- `idx_media_items_series_title` - Index on series_title column
- `idx_media_items_content_type` - Index on content_type column
- `idx_media_items_availability_state` - Index on availability_state column
- `idx_media_items_external_id` - Index on external_id column

## Verification

After setup, verify the database is working:

```bash
# Test connection
psql -h localhost -U postgres -d media_vault -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public';"

# Should return: 2 (or more tables)
```

## Troubleshooting

### Common Issues

1. **Permission Denied**
   ```bash
   # Make scripts executable
   chmod +x scripts/*.sh
   ```

2. **PostgreSQL Not Running**
   ```bash
   # Start PostgreSQL (macOS with Homebrew)
   brew services start postgresql
   
   # Start PostgreSQL (Ubuntu/Debian)
   sudo systemctl start postgresql
   
   # Start PostgreSQL (Windows)
   # Use Services or pgAdmin
   ```

3. **Connection Refused**
   - Check if PostgreSQL is running: `pg_isready -h localhost -p 5432`
   - Verify credentials in `.env` file
   - Check PostgreSQL configuration (`postgresql.conf`, `pg_hba.conf`)

4. **Database Already Exists**
   ```bash
   # Use reset script to drop and recreate
   npm run db:reset
   ```

5. **Schema File Not Found**
   - Ensure you're running from the project root directory
   - Check that `server/schema.sql` exists

### Environment Variables

Required environment variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `DB_HOST` | PostgreSQL host | `localhost` |
| `DB_PORT` | PostgreSQL port | `5432` |
| `DB_NAME` | Database name | `media_vault` |
| `DB_USER` | Database user | `postgres` |
| `DB_PASSWORD` | Database password | Required |

### Manual Verification

```sql
-- Connect to database
psql -h localhost -U postgres -d media_vault

-- Check tables
\dt

-- Check functions
\df

-- Check indexes
\di

-- Test import function
SELECT import_media_csv();
```

## Next Steps

After successful database setup:

1. **Start the backend server:**
   ```bash
   cd server
   npm start
   ```

2. **Start the frontend:**
   ```bash
   npm run dev
   ```

3. **Or use Docker:**
   ```bash
   docker-compose up -d
   ```

4. **Access the application:**
   - Frontend: http://localhost:3000
   - Backend API: http://localhost:3001
   - Dashboard: http://localhost:3000/dashboard.html

## Production Setup

For production environments:

1. **Use environment variables:**
   ```bash
   export DB_HOST=your-production-host
   export DB_PORT=5432
   export DB_NAME=media_vault_prod
   export DB_USER=media_vault_user
   export DB_PASSWORD=secure_password
   ```

2. **Enable SSL:**
   ```bash
   export NODE_ENV=production
   ```

3. **Run setup:**
   ```bash
   npm run db:setup
   ```

## Support

If you encounter issues:

1. Check the troubleshooting section above
2. Verify PostgreSQL is running and accessible
3. Check the application logs for detailed error messages
4. Ensure all environment variables are set correctly
