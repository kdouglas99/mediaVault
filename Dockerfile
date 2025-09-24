# Multi-stage build for React app
FROM node:22-alpine AS build

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install ALL dependencies (including dev dependencies needed for build)
RUN npm ci

# Copy source code
COPY . .

# Build the application using only Vite (no TypeScript checking)
RUN npm run build

# Production stage
FROM node:22-alpine

WORKDIR /app

# Install minimal runtime dependency for static server with /api/config endpoint
RUN npm install express

# Copy built application from build stage and the custom frontend server
COPY --from=build /app/dist ./dist
COPY ./frontend-server.js ./frontend-server.js

# Expose port
EXPOSE 3000

# Start the custom Node server to serve static files and /api/config
CMD ["node", "frontend-server.js"]