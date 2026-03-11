import 'dotenv/config';
import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

import apiRoutes from './routes/api.js';

const app = express();
const PORT = process.env.PORT || 5000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Serve static files from the public directory (for APK download etc.)
app.use('/public', express.static(path.join(__dirname, '../public')));

// Middleware to ensure DB connection on every API request for Vercel
app.use('/api', async (req, res, next) => {
  try {
    await connectDB();
    if (mongoose.connection.readyState !== 1) {
      throw new Error(`Database connection not ready. State: ${mongoose.connection.readyState}`);
    }
    next();
  } catch (err) {
    console.error('[DB GUARD ERROR]:', err.message);
    res.status(503).json({
      message: 'Database connection failed. Please check MongoDB Atlas IP access logs.',
      error: err.message
    });
  }
});

// Routes
app.use('/api', apiRoutes);

app.get('/', async (req, res) => {
  await connectDB();
  res.json({
    message: 'Einsdream Backend API is running',
    version: '1.1.0',
    dbStatus: mongoose.connection.readyState === 1 ? 'connected' : 'connecting/disconnected',
    dbError: lastDbError,
    timestamp: new Date().toISOString()
  });
});

let cachedPromise = null;
let lastDbError = null;

// Database connection
const connectDB = async () => {
  if (mongoose.connection.readyState >= 1) return;

  if (!cachedPromise) {
    if (!process.env.MONGODB_URI) {
      const msg = 'CRITICAL ERROR: MONGODB_URI is not defined in environment variables.';
      console.error(msg);
      lastDbError = msg;
      return;
    }

    console.log('Attempting to connect to MongoDB...');
    cachedPromise = mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 10000,
    }).catch(err => {
      cachedPromise = null;
      throw err;
    });
  }

  try {
    await cachedPromise;
    console.log('Connected to MongoDB successfully');
    lastDbError = null;
  } catch (error) {
    console.error('MongoDB connection error:', error.message);
    lastDbError = error.message;
    throw error;
  }
};

// For local development
if (process.env.VERCEL !== '1') {
  connectDB().then(() => {
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  });
}


// Global Error Handler
app.use((err, req, res, next) => {
  console.error('=== SERVER ERROR EXPLOSION ===');
  console.error(err.stack);
  res.status(500).json({
    message: 'Internal Server Error',
    error: err.message,
    stack: err.stack
  });
});

export default app;
