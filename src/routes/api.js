import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

import * as authController from '../controllers/authController.js';
import * as uploadController from '../controllers/uploadController.js';
import * as adminController from '../controllers/adminController.js';
import authMiddleware from '../middleware/authMiddleware.js';
import adminMiddleware from '../middleware/adminMiddleware.js';

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Setup multer for local storage strategy
const isVercel = process.env.VERCEL === '1';
const uploadDir = isVercel
    ? path.join('/tmp', 'uploads')
    : path.join(__dirname, '../../uploads');

if (!fs.existsSync(uploadDir)) {
    try {
        fs.mkdirSync(uploadDir, { recursive: true });
    } catch (err) {
        console.error('Failed to create upload directory:', err);
    }
}

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadDir)
    },
    filename: function (req, file, cb) {
        const userId = req.user.userId;
        cb(null, `${userId}_${Date.now()}_${file.originalname}`)
    }
});
const uploadLocal = multer({ storage: storage });

// Auth endpoints
router.post('/auth/register', authController.register);
router.post('/auth/login', authController.login);
router.post('/auth/google', authController.googleLogin);
router.post('/auth/consent', authMiddleware, authController.updateConsent);

// Upload & Metadata endpoints
router.post('/upload/init', authMiddleware, uploadController.initUpload);

// This endpoint is only called by the mobile client if provider === 'local'
router.post('/upload/local', authMiddleware, uploadLocal.single('audio'), uploadController.handleLocalUpload);

router.post('/upload/metadata', authMiddleware, uploadController.saveMetadata);
router.get('/sessions/me', authMiddleware, uploadController.getMySessions);

// Admin endpoints
router.get('/admin/users', authMiddleware, adminMiddleware, adminController.getUsers);
router.post('/admin/users', authMiddleware, adminMiddleware, adminController.createUser);
router.put('/admin/users/:id', authMiddleware, adminMiddleware, adminController.updateUser);
router.get('/admin/logs', authMiddleware, adminMiddleware, adminController.getLoginLogs);
router.get('/admin/sessions', authMiddleware, adminMiddleware, adminController.getAudioSessions);

export default router;
