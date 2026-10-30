'use strict';

/**
 * sequelize-cli database config. Reads the same DB_* variables as the API:
 * `.env.test` when NODE_ENV=test, `.env` otherwise, and no file when NODE_ENV=production
 * (real environment variables only). Variables already set in the environment win.
 */
const path = require('node:path');
const dotenv = require('dotenv');

const nodeEnv = process.env.NODE_ENV || 'development';
if (nodeEnv !== 'production') {
  dotenv.config({
    path: path.resolve(__dirname, '..', nodeEnv === 'test' ? '.env.test' : '.env'),
    quiet: true,
  });
}

function required(name) {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') {
    // Name only, never the value.
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

function fromEnv() {
  return {
    dialect: 'mysql',
    host: required('DB_HOST'),
    port: Number(required('DB_PORT')),
    database: required('DB_NAME'),
    username: required('DB_USER'),
    password: required('DB_PASSWORD'),
    timezone: '+00:00',
    define: { underscored: true },
    // Lowercase: MySQL table-name case sensitivity differs between Windows and Linux.
    migrationStorageTableName: 'sequelize_meta',
    // Record applied seeders too, so db:seed:all is not re-applied blindly.
    seederStorage: 'sequelize',
    seederStorageTableName: 'sequelize_data',
    logging: false,
  };
}

// Getters: only the environment sequelize-cli actually selects is evaluated.
module.exports = {
  get development() {
    return fromEnv();
  },
  get test() {
    const config = fromEnv();
    // Guard: test runs must never touch a dev/prod database (same rule as the API's validateEnv).
    if (!config.database.endsWith('_test')) {
      throw new Error(
        'Invalid environment configuration: DB_NAME must end in "_test" for the test environment',
      );
    }
    return config;
  },
  get production() {
    return fromEnv();
  },
};
