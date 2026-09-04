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

// 1. Universal CORS middleware (must be first)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, X-Api-Version');
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  next();
});

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Origin', 'X-Requested-With', 'Content-Type', 'Accept', 'Authorization', 'X-Api-Version']
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Serve static files from the public directory
app.use('/public', express.static(path.join(__dirname, '../public')));

// Specific handler for versioned APK downloads
app.get(['/public/einsdream-mobile-v2.1.1.apk', '/public/einsdream-mobile-v2.1.0.apk'], (req, res) => {
  const apkPath = path.join(__dirname, '../public/einsdream-mobile.apk');
  res.download(apkPath, 'einsdream-mobile-v2.1.1.apk');
});

// Direct APK download endpoint with cache-busting and explicit versioned filename
app.get(['/download/apk', '/download/apk/:version'], (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Content-Type', 'application/vnd.android.package-archive');
  const apkPath = path.join(__dirname, '../public/einsdream-mobile.apk');
  const targetFilename = req.params.version ? `einsdream-mobile-v${req.params.version}.apk` : 'einsdream-mobile-v2.1.1.apk';
  res.download(apkPath, targetFilename, (err) => {
    if (err && !res.headersSent) {
      res.redirect('/public/einsdream-mobile.apk');
    }
  });
});

let lastDbError = null;

// Robust Database Connection Handler for Vercel Serverless
const connectDB = async () => {
  if (mongoose.connection.readyState >= 1) {
    return true;
  }

  if (!process.env.MONGODB_URI) {
    lastDbError = 'MONGODB_URI is not defined in environment variables.';
    console.error(lastDbError);
    return false;
  }

  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 15000,
      connectTimeoutMS: 15000,
      bufferCommands: true
    });
    console.log('[DB]: Connected to MongoDB Atlas successfully');
    lastDbError = null;
    return true;
  } catch (err) {
    console.error('[DB ERROR]:', err.message);
    lastDbError = err.message;
    return false;
  }
};

// Root Healthcheck
app.get('/', async (req, res) => {
  await connectDB();
  res.json({
    status: 'ONLINE',
    message: 'Einsdream Backend API is running',
    version: '2.0.0',
    dbStatus: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    dbError: lastDbError,
    timestamp: new Date().toISOString()
  });
});

// Middleware to ensure DB connection on /api requests
app.use('/api', async (req, res, next) => {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const isConnected = await connectDB();
  if (!isConnected && mongoose.connection.readyState !== 1) {
    return res.status(503).json({
      message: 'Base de datos no disponible temporalmente. Conexión a MongoDB Atlas en progreso.',
      error: lastDbError
    });
  }
  next();
});

// Routes
app.use('/api', apiRoutes);

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
  console.error('=== SERVER ERROR ===', err.message);
  res.status(500).json({
    message: 'Internal Server Error',
    error: err.message
  });
});

export default app;
