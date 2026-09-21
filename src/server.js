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

const getApkFileToServe = () => {
  const candidates = [
    path.join(__dirname, '../public/einsdream-mobile-v2.9.5.apk'),
    path.join(__dirname, '../public/einsdream-mobile-v2.9.5.apk'),
    path.join(__dirname, '../public/einsdream-mobile-v2.9.3.apk'),
    path.join(__dirname, '../public/einsdream-mobile-v2.9.2.apk'),
    path.join(__dirname, '../public/einsdream-mobile-v2.9.1.apk'),
    path.join(__dirname, '../public/einsdream-mobile-v2.9.0.apk'),
    path.join(__dirname, '../public/einsdream-mobile-v2.8.0.apk'),
    path.join(__dirname, '../public/einsdream-mobile.apk')
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return candidates[candidates.length - 1];
};

// Specific handler for versioned APK downloads (serves the latest APK for all version queries)
app.get([
  '/public/einsdream-mobile-v2.9.5.apk',
  '/public/einsdream-mobile-v2.9.5.apk',
  '/public/einsdream-mobile-v2.9.3.apk',
  '/public/einsdream-mobile-v2.9.2.apk',
  '/public/einsdream-mobile-v2.9.1.apk',
  '/public/einsdream-mobile-v2.9.0.apk',
  '/public/einsdream-mobile-v2.8.0.apk',
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
  const fileToServe = getApkFileToServe();
  res.download(fileToServe, 'einsdream-mobile-v2.9.5.apk');
});

// Wildcard regex handler: any /public/einsdream-mobile*.apk request is served reliably
app.get(/^\/public\/einsdream-mobile.*\.apk$/, (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Content-Type', 'application/vnd.android.package-archive');
  const fileToServe = getApkFileToServe();
  res.download(fileToServe, 'einsdream-mobile-v2.9.5.apk');
});

// Serve static files from the public directory
app.use('/public', express.static(path.join(__dirname, '../public')));

// Direct APK download endpoint with cache-busting and explicit versioned filename
app.get(['/download/apk', '/download/apk/:version'], (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Content-Type', 'application/vnd.android.package-archive');
  const fileToServe = getApkFileToServe();
  const targetFilename = req.params.version
    ? `einsdream-mobile-v${req.params.version}.apk`
    : 'einsdream-mobile-v2.9.5.apk';
  res.download(fileToServe, targetFilename, (err) => {
    if (err && !res.headersSent) {
      res.redirect('/public/einsdream-mobile-v2.9.5.apk');
    }
  });
});

// App version info endpoint — used by the admin panel and mobile app to show current APK version
app.get('/api/app-version', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.json({
    version: "2.9.5",
    versionCode: 19,
    apkUrl: '/download/apk',
    apkFilename: 'einsdream-mobile-v2.9.5.apk',
    releaseDate: '2026-09-21',
    architecture: 'EinsDream 3.0 (Continuous Audio + Peak Timeline + Senior UI)',
    changelog: [
      'v2.9.5: Corrección definitiva: eliminación de icono no importado y actualización de badge de versión',
      'v2.9.4: Corrección de estabilidad: resolución de variables y eliminación de excepciones en reproductor',
      'v2.9.3: Restauración de Línea de Tiempo con puntos de picos acústicos interactivos',
            'v2.9.3: Tarjeta inspectora de metadatos (hora, decibeles, certeza IA y navegación entre picos)',
            'v2.9.3: Reproducción continua nocturna (de corrido) y viaje fluido con la barra de progreso',
            'v2.9.3: Eliminación de audios aislados de 4 segundos e integración directa al reproductor',
            'v2.9.2: Solución definitiva al error de audio con formato nativo PCM 16-bit 16000 Hz',
      'v2.9.2: Restauración de los 20-25 eventos acústicos realistas en todas las noches',
      'v2.9.2: Rediseño total de la pestaña Audios Nocturnos para Adultos Mayores (selector de días y reproductor gigante)',
      'v2.9.1: Corrección completa de reproducción de audio sin bloqueos de telemetría',
      'v2.9.1: Identificación precisa de tipos de eventos (Ronquidos, Tos, Respiración)',
      'v2.9.1: Mapeo y nomenclatura exacta para los 4 días consecutivos del historial',
      'v2.9.0: EinsDream Pair – Monitoreo Acústico Dual con 2 celulares (Topología Master/Slave)'
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
    version: '2.8.0',
    apkVersion: '2.8.0',
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
