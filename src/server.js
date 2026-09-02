import 'dotenv/config';
import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

import apiRoutes from './routes/api.js';

const app = express();
const PORT = process.env.PORT || 5000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 1. Universal Preflight & CORS Middleware (MUST be first)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, X-Api-Version, X-CSRF-Token');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  next();
});

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Origin', 'X-Requested-With', 'Content-Type', 'Accept', 'Authorization', 'X-Api-Version', 'X-CSRF-Token']
}));

app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ limit: '15mb', extended: true }));

// Serve static files from the public directory (for APK download etc.)
const publicDir = path.join(__dirname, '../public');
app.use('/public', express.static(publicDir));

// Direct convenient APK download endpoint
app.get('/download/apk', (req, res) => {
  const apkPath = path.join(publicDir, 'einsdream-mobile.apk');
  if (fs.existsSync(apkPath)) {
    res.download(apkPath, 'einsdream-mobile.apk');
  } else {
    res.status(404).json({ message: 'APK file not found on server' });
  }
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

    console.log('Attempting to connect to MongoDB Atlas...');
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

// Middleware to ensure DB connection on every API request for Vercel
app.use('/api', async (req, res, next) => {
  // Always allow OPTIONS through immediately without blocking on DB
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    await connectDB();
    next();
  } catch (err) {
    console.error('[DB GUARD ERROR]:', err.message);
    res.status(503).json({
      message: 'Database connection failed. Please check MongoDB Atlas connection URI and IP Whitelist (0.0.0.0/0).',
      error: err.message
    });
  }
});

// Routes
app.use('/api', apiRoutes);

app.get('/', async (req, res) => {
  try {
    await connectDB();
  } catch {}
  res.json({
    message: 'Einsdream Backend API is running (Einsdream 2.0)',
    version: '2.0.0',
    dbStatus: mongoose.connection.readyState === 1 ? 'connected' : 'connecting/disconnected',
    dbError: lastDbError,
    apkAvailable: fs.existsSync(path.join(publicDir, 'einsdream-mobile.apk')),
    apkDownloadUrl: '/download/apk',
    timestamp: new Date().toISOString()
  });
});

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
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
});

export default app;
