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

// Direct APK download endpoint
app.get('/download/apk', (req, res) => {
  res.redirect('/public/einsdream-mobile.apk');
});

// Root Healthcheck (Always returns 200 immediately)
app.get('/', (req, res) => {
  res.json({
    status: 'ONLINE',
    message: 'Einsdream Backend API is running',
    version: '2.0.0',
    dbStatus: mongoose.connection.readyState === 1 ? 'connected' : mongoose.connection.readyState === 2 ? 'connecting' : 'disconnected',
    dbError: lastDbError,
    timestamp: new Date().toISOString()
  });
});

let cachedPromise = null;
let lastDbError = null;

// Safe Database Connection Helper
const connectDB = async () => {
  if (mongoose.connection.readyState === 1) return true;

  if (!process.env.MONGODB_URI) {
    lastDbError = 'MONGODB_URI is not defined in environment variables.';
    return false;
  }

  if (!cachedPromise) {
    cachedPromise = mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 3000,
      connectTimeoutMS: 4000,
    }).then(m => {
      lastDbError = null;
      return m;
    }).catch(err => {
      lastDbError = err.message;
      cachedPromise = null;
      return null;
    });
  }

  try {
    const conn = await cachedPromise;
    return !!conn && mongoose.connection.readyState === 1;
  } catch (e) {
    cachedPromise = null;
    lastDbError = e.message;
    return false;
  }
};

// Middleware to ensure DB connection on /api requests
app.use('/api', async (req, res, next) => {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const isConnected = await connectDB();
  if (!isConnected && mongoose.connection.readyState !== 1) {
    return res.status(503).json({
      message: 'Base de datos no disponible temporalmente. Verifica el IP Whitelist (0.0.0.0/0) en MongoDB Atlas.',
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
  res.status(500).json({
    message: 'Internal Server Error',
    error: err.message
  });
});

export default app;
