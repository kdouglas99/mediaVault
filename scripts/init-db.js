#!/usr/bin/env node

/**
 * Database Initialization Script
 * This script can be run directly to initialize the database
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
const envPath = path.resolve(__dirname, '../.env');
if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
} else {
    console.warn('⚠️  .env file not found. Using default values.');
    // Set default values for testing
    process.env.DB_HOST = process.env.DB_HOST || 'localhost';
    process.env.DB_PORT = process.env.DB_PORT || '5432';
    process.env.DB_NAME = process.env.DB_NAME || 'media_vault';
    process.env.DB_USER = process.env.DB_USER || 'postgres';
    process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'password';
}

const { Pool } = pg;

// Database configuration
const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME || 'media_vault',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Colors for console output
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

function logError(message) {
    log(`❌ ${message}`, 'red');
}

function logSuccess(message) {
    log(`✅ ${message}`, 'green');
}

function logInfo(message) {
    log(`ℹ️  ${message}`, 'blue');
}

function logWarning(message) {
    log(`⚠️  ${message}`, 'yellow');
}

async function checkConnection() {
    try {
        const client = await pool.connect();
        await client.query('SELECT 1');
        client.release();
        logSuccess('Database connection successful');
        return true;
    } catch (error) {
        logError(`Database connection failed: ${error.message}`);
        return false;
    }
}

async function createDatabase() {
    const dbName = process.env.DB_NAME || 'media_vault';
    
    try {
        // Connect to postgres database to create our target database
        const adminPool = new Pool({
            host: process.env.DB_HOST || 'localhost',
            port: Number(process.env.DB_PORT) || 5432,
            database: 'postgres',
            user: process.env.DB_USER || 'postgres',
            password: process.env.DB_PASSWORD,
            ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
        });

        const client = await adminPool.connect();
        
        // Check if database exists
        const result = await client.query(
            'SELECT 1 FROM pg_database WHERE datname = $1',
            [dbName]
        );
        
        if (result.rows.length === 0) {
            logInfo(`Creating database '${dbName}'...`);
            await client.query(`CREATE DATABASE "${dbName}"`);
            logSuccess(`Database '${dbName}' created successfully`);
        } else {
            logWarning(`Database '${dbName}' already exists`);
        }
        
        client.release();
        await adminPool.end();
        return true;
    } catch (error) {
        logError(`Failed to create database: ${error.message}`);
        return false;
    }
}

async function applySchema() {
    const schemaPath = path.resolve(__dirname, '../server/schema.sql');
    
    if (!fs.existsSync(schemaPath)) {
        logError(`Schema file not found: ${schemaPath}`);
        return false;
    }
    
    try {
        logInfo('Reading schema file...');
        const schemaSQL = fs.readFileSync(schemaPath, 'utf8');
        
        logInfo('Applying database schema...');
        const client = await pool.connect();
        
        await client.query('BEGIN');
        await client.query(schemaSQL);
        await client.query('COMMIT');
        
        client.release();
        logSuccess('Database schema applied successfully');
        return true;
    } catch (error) {
        logError(`Failed to apply schema: ${error.message}`);
        return false;
    }
}

async function verifySetup() {
    try {
        const client = await pool.connect();
        
        // Check tables
        const tablesResult = await client.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            ORDER BY table_name
        `);
        
        const tableCount = tablesResult.rows.length;
        
        if (tableCount >= 2) {
            logSuccess(`Database setup verified! Found ${tableCount} tables:`);
            tablesResult.rows.forEach(row => {
                log(`  • ${row.table_name}`, 'cyan');
            });
            
            // Check if import function exists
            const functionResult = await client.query(`
                SELECT routine_name 
                FROM information_schema.routines 
                WHERE routine_schema = 'public' 
                AND routine_name = 'import_media_csv'
            `);
            
            if (functionResult.rows.length > 0) {
                logSuccess('Import function created successfully');
            } else {
                logWarning('Import function not found');
            }
            
            client.release();
            return true;
        } else {
            logError(`Database verification failed. Expected at least 2 tables, found ${tableCount}`);
            client.release();
            return false;
        }
    } catch (error) {
        logError(`Database verification failed: ${error.message}`);
        return false;
    }
}

async function main() {
    log('🚀 Starting Media Vault Database Setup', 'bright');
    log('=====================================', 'bright');
    
    // Check required environment variables
    const requiredVars = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'];
    const missingVars = requiredVars.filter(varName => !process.env[varName]);
    
    if (missingVars.length > 0) {
        logError(`Missing required environment variables: ${missingVars.join(', ')}`);
        logInfo('Please set these variables in your .env file or environment');
        process.exit(1);
    }
    
    logInfo(`Database: ${process.env.DB_NAME} on ${process.env.DB_HOST}:${process.env.DB_PORT}`);
    
    try {
        // Step 1: Create database
        if (!(await createDatabase())) {
            process.exit(1);
        }
        
        // Step 2: Apply schema
        if (!(await applySchema())) {
            process.exit(1);
        }
        
        // Step 3: Verify setup
        if (!(await verifySetup())) {
            process.exit(1);
        }
        
        logSuccess('🎉 Database setup completed successfully!');
        log('=====================================', 'bright');
        logInfo('Next steps:');
        log('  1. Start the backend: cd server && npm start', 'cyan');
        log('  2. Start the frontend: npm run dev', 'cyan');
        log('  3. Or use Docker: docker-compose up -d', 'cyan');
        
    } catch (error) {
        logError(`Setup failed: ${error.message}`);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

// Handle uncaught errors
process.on('uncaughtException', (error) => {
    logError(`Uncaught Exception: ${error.message}`);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    logError(`Unhandled Rejection at: ${promise}, reason: ${reason}`);
    process.exit(1);
});

// Run the setup
main().catch((error) => {
    logError(`Setup failed: ${error.message}`);
    process.exit(1);
});
