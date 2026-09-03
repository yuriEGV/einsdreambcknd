import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

import * as authController from '../controllers/authController.js';
import * as uploadController from '../controllers/uploadController.js';
import * as adminController from '../controllers/adminController.js';
import * as nightSessionController from '../controllers/nightSessionController.js';
import authMiddleware from '../middleware/authMiddleware.js';
import adminMiddleware from '../middleware/adminMiddleware.js';

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Setup multer for local storage strategy
const isVercel = !!(process.env.VERCEL || process.env.VERCEL_ENV || process.env.NOW_REGION);
const uploadDir = isVercel
    ? path.join('/tmp', 'uploads')
    : path.join(__dirname, '../../uploads');

// Only attempt to create directory if not on Vercel or if we're in /tmp
if (!fs.existsSync(uploadDir)) {
    try {
        fs.mkdirSync(uploadDir, { recursive: true });
        console.log(`Created upload directory at: ${uploadDir}`);
    } catch (err) {
        if (isVercel) {
            console.warn('Vercel: Could not create upload directory, but continuing...', err.message);
        } else {
            console.error('Failed to create upload directory:', err);
        }
    }
}

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        const userId = req.user ? req.user.userId : 'anonymous';
        const cleanName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
        cb(null, `${userId}_${Date.now()}_${cleanName}`);
    }
});
const uploadLocal = multer({ storage: storage });

// ==================== AUTH ENDPOINTS ====================
router.post('/auth/register', authController.register);
router.post('/auth/login', authController.login);
router.post('/auth/google', authController.googleLogin);
router.post('/auth/consent', authMiddleware, authController.updateConsent);

// ==================== UPLOAD & SESSIONS ENDPOINTS (Einsdream 2.0 & Legacy APK) ====================
// Upload initialization (Presigned URLs or local target)
router.post('/upload/init', authMiddleware, uploadController.initUpload);

// Local audio file upload endpoint
router.post('/upload/local', authMiddleware, uploadLocal.single('audio'), uploadController.handleLocalUpload);

// Save recording metadata (from Web and Mobile APK)
router.post('/upload/metadata', authMiddleware, uploadController.saveMetadata);

// Bulk sync endpoint for offline queued recordings
router.post('/sessions/bulk', authMiddleware, uploadController.bulkUploadMetadata);

// Query sessions & stats for current user
router.get('/sessions/me', authMiddleware, uploadController.getMySessions);
router.get('/sessions/stats', authMiddleware, uploadController.getSessionStats);
router.get('/sessions/night', authMiddleware, uploadController.getNightSession);
router.get('/sessions/night/:date', authMiddleware, uploadController.getNightSession);

// ==================== HEALTH CONNECT & NIGHT ENGINE SESSIONS ====================
router.post('/night-sessions', authMiddleware, nightSessionController.syncNightSession);
router.get('/night-sessions/history', authMiddleware, nightSessionController.getNightSessionsHistory);
router.get('/night-sessions/date/:date', authMiddleware, nightSessionController.getNightSessionByDate);
router.get('/night-sessions/:id', authMiddleware, nightSessionController.getNightSessionById);

// Audio playback & streaming
router.get('/sessions/:id/audio', authMiddleware, uploadController.getAudioById);
router.get('/sessions/:id/stream', authMiddleware, uploadController.streamAudioSession);

// Event comments & annotations
router.post('/sessions/:id/comments', authMiddleware, uploadController.addSessionComment);

// Diagnostics & System Health
router.get('/diagnostics/status', authMiddleware, uploadController.getDiagnosticsStatus);

// ==================== ADMIN ENDPOINTS ====================
router.get('/admin/stats', authMiddleware, adminMiddleware, adminController.getAdminStats);
router.get('/admin/users', authMiddleware, adminMiddleware, adminController.getUsers);
router.post('/admin/users', authMiddleware, adminMiddleware, adminController.createUser);
router.put('/admin/users/:id', authMiddleware, adminMiddleware, adminController.updateUser);
router.get('/admin/logs', authMiddleware, adminMiddleware, adminController.getLoginLogs);
router.get('/admin/sessions', authMiddleware, adminMiddleware, adminController.getAudioSessions);
router.delete('/admin/sessions/:id', authMiddleware, adminMiddleware, adminController.deleteAudioSession);

export default router;
