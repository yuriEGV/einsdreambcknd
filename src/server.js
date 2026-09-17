import 'dotenv/config';
import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

import apiRoutes from './routes/api.js';

// ─── Critical Security: Strict JWT_SECRET Validation ─────────────────────────
if (!process.env.JWT_SECRET) {
  console.error('FATAL: JWT_SECRET environment variable is missing. Halting execution.');
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 5000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Hardened CORS Policy (Vercel Frontend, Localhost, and Mobile Apps) ──────
const allowedOrigins = [
  process.env.FRONTEND_URL,
  'https://einsdreamfrntnd.vercel.app',
  'http://localhost:5173',
  'http://localhost:3000',
  'http://localhost:5000'
].filter(Boolean);

const isOriginAllowed = (origin) => {
  if (!origin) return true; // Mobile native clients, curl, serverless internal
  if (allowedOrigins.includes(origin)) return true;
  if (origin.endsWith('.vercel.app')) return true; // Any Vercel preview or prod domain
  return false;
};

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (isOriginAllowed(origin)) {
    res.header('Access-Control-Allow-Origin', origin || '*');
  }
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, X-Api-Version');
  res.header('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  next();
});

app.use(cors({
  origin: (origin, callback) => {
    if (isOriginAllowed(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Acceso bloqueado por política de CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Origin', 'X-Requested-With', 'Content-Type', 'Accept', 'Authorization', 'X-Api-Version'],
  credentials: true
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Specific handler for versioned APK downloads (serves the latest v2.7.0 APK for all version queries)
app.get([
  '/public/einsdream-mobile-v2.7.0.apk',
  '/public/einsdream-mobile-v2.6.0.apk',
  '/public/einsdream-mobile-v2.5.0.apk',
  '/public/einsdream-mobile-v2.4.0.apk',
  '/public/einsdream-mobile-v2.3.2.apk',
  '/public/einsdream-mobile-v2.3.1.apk',
  '/public/einsdream-mobile-v2.3.0.apk',
  '/public/einsdream-mobile-v2.2.0.apk',
  '/public/einsdream-mobile-v2.1.1.apk',
  '/public/einsdream-mobile-v2.1.0.apk',
  '/public/einsdream-mobile.apk'
], (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Content-Type', 'application/vnd.android.package-archive');
  const apk270 = path.join(__dirname, '../public/einsdream-mobile-v2.7.0.apk');
  const apk260 = path.join(__dirname, '../public/einsdream-mobile-v2.6.0.apk');
  const apkBase = path.join(__dirname, '../public/einsdream-mobile.apk');
  const fileToServe = fs.existsSync(apk270) ? apk270 : (fs.existsSync(apk260) ? apk260 : apkBase);
  res.download(fileToServe, 'einsdream-mobile-v2.7.0.apk');
});

// Wildcard regex handler: any /public/einsdream-mobile*.apk request is served reliably with v2.7.0
app.get(/^\/public\/einsdream-mobile.*\.apk$/, (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Content-Type', 'application/vnd.android.package-archive');
  const apk270 = path.join(__dirname, '../public/einsdream-mobile-v2.7.0.apk');
  const apk260 = path.join(__dirname, '../public/einsdream-mobile-v2.6.0.apk');
  const apkBase = path.join(__dirname, '../public/einsdream-mobile.apk');
  const fileToServe = fs.existsSync(apk270) ? apk270 : (fs.existsSync(apk260) ? apk260 : apkBase);
  res.download(fileToServe, 'einsdream-mobile-v2.7.0.apk');
});

// Serve static files from the public directory
app.use('/public', express.static(path.join(__dirname, '../public')));

// Direct APK download endpoint with cache-busting and explicit versioned filename
app.get(['/download/apk', '/download/apk/:version'], (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Content-Type', 'application/vnd.android.package-archive');
  const apk270 = path.join(__dirname, '../public/einsdream-mobile-v2.7.0.apk');
  const apk260 = path.join(__dirname, '../public/einsdream-mobile-v2.6.0.apk');
  const apkBase = path.join(__dirname, '../public/einsdream-mobile.apk');
  const fileToServe = fs.existsSync(apk270) ? apk270 : (fs.existsSync(apk260) ? apk260 : apkBase);
  const targetFilename = req.params.version
    ? `einsdream-mobile-v${req.params.version}.apk`
    : 'einsdream-mobile-v2.7.0.apk';
  res.download(fileToServe, targetFilename, (err) => {
    if (err && !res.headersSent) {
      res.redirect('/public/einsdream-mobile-v2.7.0.apk');
    }
  });
});

// App version info endpoint — used by the admin panel and mobile app to show current APK version
app.get('/api/app-version', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.json({
    version: '2.7.0',
    versionCode: 12,
    apkUrl: '/download/apk',
    apkFilename: 'einsdream-mobile-v2.7.0.apk',
    releaseDate: '2026-09-17',
    architecture: 'EinsDream 3.0 (Local Audio Architecture)',
    changelog: [
      'EinsDream 3.0: Arquitectura de Audio 100% Local (CERO bytes de audio en la nube)',
      'Corrección de fecha Enero 1970 en Android y auto-reparación de metadatos históricos',
      'Pausa nocturna estabilizada con AudioFlinger y persistencia de monitoreo',
      'Detección acústica y de ronquidos calibrada (-48 dB) con metadatos de hora e intensidad en timeline',
      'Auto-cálculo e inyección de sesiones locales en Score de sueño y telemetría de sincronización',
      'Ajuste de margen inferior para visibilidad completa del botón Cerrar Sesión'
    ]
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
    message: 'Einsdream Backend API is running (EinsDream 3.0 Local Audio Architecture)',
    version: '2.7.0',
    apkVersion: '2.7.0',
    apkUrl: '/download/apk',
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
