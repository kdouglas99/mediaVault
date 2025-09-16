# Media Vault Dashboard

A modern web dashboard for managing and analyzing media content with advanced filtering, search, and export capabilities.

## Features

- 📊 **Interactive Dashboard** - View media statistics and analytics
- 🔍 **Advanced Search & Filtering** - Multi-select filters for series, content type, availability, and more
- 📄 **Flexible Pagination** - Choose from 50, 100, 500, 1000, or ALL items per page
- ✅ **Bulk Selection** - Select individual items or all filtered results
- 📤 **CSV Export** - Export selected or all filtered data
- 🎯 **Deep Linking** - Direct links to Video Robot for each GUID
- 🎨 **Modern UI** - Dark theme with responsive design
- 📱 **Mobile Friendly** - Works on desktop and mobile devices

## Tech Stack

- **Frontend**: Vanilla HTML/CSS/JavaScript
- **Backend**: Node.js with Express
- **Database**: PostgreSQL
- **Deployment**: Docker & Docker Compose

## Quick Start

### Prerequisites

- Node.js 18+ installed
- Docker and Docker Compose installed
- Git installed

### Development Setup

1. **Clone the repository**
   ```bash
   git clone <your-repo-url>
   cd media-vault-dashboard
   ```

2. **Install server dependencies**
   ```bash
   cd server
   npm install
   cd ..
   ```

3. **Install frontend dependencies**
   ```bash
   npm install
   ```

4. **Set up environment variables**
   ```bash
   cp .env.example .env
   ```
   
   Edit `.env` file with your database credentials:
   ```env
   # Database Configuration
   DB_HOST=localhost
   DB_PORT=5432
   DB_NAME=mediaVault
   DB_USER=username
   DB_PASSWORD=password
   
   # Server Configuration
   PORT=3001
   NODE_ENV=development
   ```

5. **Start the database and backend**
   ```bash
   docker compose up postgres backend --detach
   ```

6. **Start the frontend development server**
   ```bash
   npm run dev
   ```

7. **Open your browser**
   - Frontend: http://localhost:5173
   - Backend API: http://localhost:3001
   - Dashboard: Open `dashboard.html` directly or serve it locally

### Alternative: Run Everything with Docker

```bash
# Start all services
docker compose up -d

# View logs
docker compose logs -f

# Stop all services
docker compose down
```

```bash
docker compose up
```
```
