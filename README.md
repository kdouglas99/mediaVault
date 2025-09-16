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


## 📋 Overview

Media Vault is a full-stack application designed for managing media items. It features a React frontend that communicates with a PostgreSQL database through API endpoints, all containerized with Docker for easy deployment.

## 🛠 Tech Stack

- **Frontend**: React 19.1.1 + TypeScript 5.8.3
- **Build Tool**: Vite 7.1.2
- **Database**: PostgreSQL 15
- **Containerization**: Docker & Docker Compose
- **Linting**: ESLint 9.33.0
- **Package Manager**: npm

## 📁 Project Structure

```
media-vault/
├── src/
│   ├── lib/
│   │   └── database.ts      # API communication layer
│   ├── assets/              # Static assets
│   ├── App.tsx              # Main application component
│   ├── App.css              # Application styles
│   ├── main.tsx             # React entry point
│   ├── index.css            # Global styles
│   └── vite-env.d.ts        # Vite type definitions
├── public/                  # Public assets
├── docker-compose.yml       # Multi-service Docker configuration
├── Dockerfile              # Frontend container build
├── package.json            # Dependencies and scripts
├── vite.config.ts          # Vite configuration
├── tsconfig.json           # TypeScript configuration
├── eslint.config.js        # ESLint configuration
└── README.md
```


## 🔧 Features

- **Database Connection**: Real-time PostgreSQL connection testing
- **Media Management**: Display and manage media items
- **Containerized Deployment**: Full Docker setup with PostgreSQL
- **Modern React**: Built with React 19 and hooks
- **TypeScript**: Full type safety throughout the application
- **Responsive Design**: Clean, modern UI

## 🐳 Docker Setup

The application uses Docker Compose to orchestrate two main services:

### Services

1. **PostgreSQL Database** (`postgres`)
   - Image: `postgres:15-alpine`
   - Port: `5432`
   - Database: `mediaVault`
   - User: `username`
   - Password: `password`
   - Persistent storage with health checks

2. **React Frontend** (`frontend`)
   - Built from local Dockerfile
   - Port: `3000`
   - Serves the built React application
   - Depends on PostgreSQL service

### Environment Variables

The frontend container uses the following environment variables:

```
VITE_API_URL=http://localhost:3001
VITE_DB_HOST=postgres
VITE_DB_PORT=5432
VITE_DB_NAME=mediaVault
VITE_DB_USER=username
VITE_DB_PASSWORD=password
```


## 🚀 Development

### Prerequisites

- Node.js 18+
- npm
- Docker & Docker Compose

### Local Development

1. **Clone the repository**
```shell script
git clone <repository-url>
   cd media-vault
```


2. **Install dependencies**
```shell script
npm install 
```


3. **Start development server**
```shell script
npm run dev
```


4. **Start with Docker**
```shell script
docker compose up
```


### Available Scripts

```json
{
  "dev": "vite",
  "build": "vite build",
  "lint": "eslint . --ext ts,tsx --report-unused-disable-directives --max-warnings 0",
  "preview": "vite preview"
}
```


## 🗄️ Database

The application expects a PostgreSQL database with a `media_items` table. The React app includes:

- Database connection testing
- Media items retrieval and display
- Error handling for database operations

### API Endpoints

The frontend expects the following API endpoints to be available:

- `GET /api/test` - Database connection test
- `GET /api/items` - Retrieve media items

## 📦 Dependencies

### Main Dependencies
- **react**: ^19.1.1
- **react-dom**: ^19.1.1
- **pg**: ^8.16.3

### Development Dependencies
- **typescript**: ^5.8.3
- **vite**: ^7.1.2
- **@vitejs/plugin-react**: ^5.0.0
- **eslint**: ^9.33.0
- **@types/react**: ^19.1.10
- **@types/pg**: ^8.15.5

## 🔍 Code Quality

The project uses ESLint for code linting with TypeScript support. The configuration includes:

- React hooks rules
- React refresh rules
- TypeScript-specific rules
- Custom global configurations

### Expanding ESLint Configuration

For production applications, you can enable type-aware lint rules:

```textmate
export default tseslint.config([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      ...tseslint.configs.recommendedTypeChecked,
      // or for stricter rules:
      ...tseslint.configs.strictTypeChecked,
      // and optionally:
      ...tseslint.configs.stylisticTypeChecked,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
])
```


## 🚀 Deployment

1. **Build the application**
```shell script
npm run build
```


2. **Deploy with Docker**
```shell script
docker compose up -d
```


The application will be available at `http://localhost:3000`

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run linting and tests
5. Submit a pull request

## 📝 License

This project is licensed under the MIT License.
```
This comprehensive README provides:

1. **Quick start instructions** with the Docker command
2. **Complete project overview** and tech stack
3. **Detailed project structure** showing all important files
4. **Docker configuration explanation** with both services
5. **Development setup instructions** for local work
6. **Database and API information** based on the code
7. **Dependencies listing** from the tech stack provided
8. **Code quality information** including the ESLint configuration
9. **Deployment instructions** using Docker
10. **Contributing guidelines** for collaboration

The README is based on the actual codebase structure and includes all the relevant information from the files I analyzed, including the Docker setup, React components, database integration, and build configuration.
```
