# Database Setup Script for Media Vault (PowerShell)
# This script creates the database and runs the schema

param(
    [switch]$Force
)

# Function to print colored output
function Write-Status {
    param([string]$Message)
    Write-Host "[INFO] $Message" -ForegroundColor Blue
}

function Write-Success {
    param([string]$Message)
    Write-Host "[SUCCESS] $Message" -ForegroundColor Green
}

function Write-Warning {
    param([string]$Message)
    Write-Host "[WARNING] $Message" -ForegroundColor Yellow
}

function Write-Error {
    param([string]$Message)
    Write-Host "[ERROR] $Message" -ForegroundColor Red
}

# Check if .env file exists
if (-not (Test-Path ".env")) {
    Write-Error ".env file not found!"
    Write-Status "Please copy env.example to .env and configure your database settings:"
    Write-Host "  Copy-Item env.example .env"
    Write-Host "  # Edit .env with your database credentials"
    exit 1
}

# Load environment variables from .env file
$envContent = Get-Content ".env" | Where-Object { $_ -notmatch '^#' -and $_ -match '=' }
foreach ($line in $envContent) {
    $key, $value = $line -split '=', 2
    [Environment]::SetEnvironmentVariable($key, $value, "Process")
}

# Check required environment variables
$requiredVars = @("DB_HOST", "DB_PORT", "DB_NAME", "DB_USER", "DB_PASSWORD")
foreach ($var in $requiredVars) {
    if (-not [Environment]::GetEnvironmentVariable($var, "Process")) {
        Write-Error "Required environment variable $var is not set in .env file"
        exit 1
    }
}

$dbHost = [Environment]::GetEnvironmentVariable("DB_HOST", "Process")
$dbPort = [Environment]::GetEnvironmentVariable("DB_PORT", "Process")
$dbName = [Environment]::GetEnvironmentVariable("DB_NAME", "Process")
$dbUser = [Environment]::GetEnvironmentVariable("DB_USER", "Process")
$dbPassword = [Environment]::GetEnvironmentVariable("DB_PASSWORD", "Process")

Write-Status "Setting up database: $dbName on $dbHost`:$dbPort"

# Check if PostgreSQL is running
Write-Status "Checking PostgreSQL connection..."
try {
    $env:PGPASSWORD = $dbPassword
    $result = & pg_isready -h $dbHost -p $dbPort -U $dbUser 2>$null
    if ($LASTEXITCODE -ne 0) {
        throw "Connection failed"
    }
    Write-Success "PostgreSQL server is accessible"
} catch {
    Write-Error "Cannot connect to PostgreSQL server at $dbHost`:$dbPort"
    Write-Status "Please ensure PostgreSQL is running and accessible"
    exit 1
}

# Create database if it doesn't exist
Write-Status "Creating database '$dbName' if it doesn't exist..."
try {
    $env:PGPASSWORD = $dbPassword
    & createdb -h $dbHost -p $dbPort -U $dbUser $dbName 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Success "Database '$dbName' created successfully"
    } elseif ($LASTEXITCODE -eq 1) {
        Write-Warning "Database '$dbName' already exists"
    } else {
        throw "Failed to create database"
    }
} catch {
    Write-Error "Failed to create database '$dbName'"
    exit 1
}

# Run schema
Write-Status "Applying database schema..."
if (Test-Path "server/schema.sql") {
    try {
        $env:PGPASSWORD = $dbPassword
        & psql -h $dbHost -p $dbPort -U $dbUser -d $dbName -f "server/schema.sql"
        if ($LASTEXITCODE -eq 0) {
            Write-Success "Database schema applied successfully"
        } else {
            throw "Schema application failed"
        }
    } catch {
        Write-Error "Failed to apply database schema"
        exit 1
    }
} else {
    Write-Error "Schema file server/schema.sql not found"
    exit 1
}

# Verify tables were created
Write-Status "Verifying database setup..."
try {
    $env:PGPASSWORD = $dbPassword
    $tableCount = & psql -h $dbHost -p $dbPort -U $dbUser -d $dbName -t -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public';" | ForEach-Object { $_.Trim() }
    
    if ([int]$tableCount -ge 2) {
        Write-Success "Database setup completed successfully!"
        Write-Status "Created $tableCount tables in database '$dbName'"
        
        # Show created tables
        Write-Status "Created tables:"
        $env:PGPASSWORD = $dbPassword
        $tables = & psql -h $dbHost -p $dbPort -U $dbUser -d $dbName -c "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;" -t
        $tables | Where-Object { $_.Trim() -ne "" } | ForEach-Object { Write-Host "  - $($_.Trim())" }
        
    } else {
        Write-Error "Database setup verification failed. Expected at least 2 tables, found $tableCount"
        exit 1
    }
} catch {
    Write-Error "Failed to verify database setup"
    exit 1
}

Write-Success "🎉 Database setup complete! You can now start the application."
Write-Status "Next steps:"
Write-Host "  1. Start the backend: cd server && npm start"
Write-Host "  2. Start the frontend: npm run dev"
Write-Host "  3. Or use Docker: docker-compose up -d"
