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

let lastDbError = null;

// Database connection
const connectDB = async () => {
  if (!process.env.MONGODB_URI) {
    const msg = 'CRITICAL ERROR: MONGODB_URI is not defined in environment variables.';
    console.error(msg);
    lastDbError = msg;
    return;
  }
  try {
    if (mongoose.connection.readyState >= 1) return;
    console.log('Attempting to connect to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 8000, // 8 seconds timeout
    });
    console.log('Connected to MongoDB successfully');
    lastDbError = null;
  } catch (error) {
    console.error('MongoDB connection error:', error.message);
    lastDbError = error.message;
  }
};

// For local development
if (process.env.VERCEL !== '1') {
  connectDB().then(() => {
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  });
} else {
  // In Vercel, we call it immediately. Mongoose will buffer queries until connected.
  connectDB();
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
