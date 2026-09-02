import mongoose from 'mongoose';
import User from '../models/User.js';
import LoginLog from '../models/LoginLog.js';
import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const JWT_SECRET = process.env.JWT_SECRET || 'einsdream_super_secret_jwt_key_2026';

// Helper to auto-seed default admin if database is empty
const ensureDefaultAdmin = async (targetEmail) => {
    if (targetEmail.toLowerCase() === 'yuri@einsdream.cl') {
        let admin = await User.findOne({ email: 'yuri@einsdream.cl' });
        if (!admin) {
            console.log('[AUTH] Auto-creating default admin account for yuri@einsdream.cl...');
            admin = new User({
                email: 'yuri@einsdream.cl',
                password: '123456',
                phone: '+56912345678',
                role: 'admin',
                consentGiven: true
            });
            await admin.save();
        }
        return admin;
    }
    return null;
};

// Basic Email/Password Register
export const register = async (req, res) => {
    try {
        let { email, password, phone } = req.body;

        if (!email || !password) {
            return res.status(400).json({ message: 'Email and password are required' });
        }

        email = email.trim().toLowerCase();

        let user = await User.findOne({ email });
        if (user) {
            return res.status(400).json({ message: 'User already exists' });
        }

        const role = email === 'yuri@einsdream.cl' ? 'admin' : 'user';

        user = new User({
            email,
            password,
            phone: phone || '+56900000000',
            role,
            consentGiven: true
        });
        await user.save();

        const token = jwt.sign({ userId: user._id, role: user.role }, JWT_SECRET, { expiresIn: '30d' });

        // Record login log
        try {
            await LoginLog.create({
                userId: user._id,
                loginMethod: 'email',
                ipAddress: req.ip || 'unknown'
            });
        } catch {}

        res.status(201).json({
            token,
            user: {
                id: user._id,
                email: user.email,
                role: user.role,
                phone: user.phone,
                consentGiven: user.consentGiven
            }
        });
    } catch (error) {
        res.status(500).json({ message: 'Error registering user', error: error.message });
    }
};

// Basic Email/Password Login
export const login = async (req, res) => {
    console.log('[LOGIN] Auth process started for:', req.body?.email);
    try {
        let { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ message: 'Email y contraseña requeridos' });
        }

        email = email.trim().toLowerCase();

        // Check if admin needs auto-seeding
        await ensureDefaultAdmin(email);

        let user = await User.findOne({ email });

        if (!user) {
            console.log('[LOGIN] User not found:', email);
            return res.status(400).json({ message: 'Usuario no encontrado. Verifica tu correo.' });
        }

        // String compare (or bcrypt)
        if (user.password !== password) {
            console.log('[LOGIN] Failed: Password mismatch for:', email);
            return res.status(400).json({ message: 'Contraseña incorrecta' });
        }

        const token = jwt.sign(
            { userId: user._id, role: user.role },
            JWT_SECRET,
            { expiresIn: '30d' }
        );

        try {
            await LoginLog.create({
                userId: user._id,
                loginMethod: 'email',
                ipAddress: req.ip || req.headers['x-forwarded-for'] || 'unknown'
            });
        } catch (logErr) {
            console.warn('[LOGIN] Audit log non-critical warning:', logErr.message);
        }

        console.log('[LOGIN] Success for user:', email);
        res.json({
            token,
            user: {
                id: user._id,
                email: user.email,
                role: user.role,
                phone: user.phone,
                consentGiven: user.consentGiven
            }
        });
    } catch (error) {
        console.error('[LOGIN] EXCEPTION:', error.message);
        res.status(500).json({
            message: `Login error: ${error.message}`,
            error: error.message
        });
    }
};

// Google Auth Login/Registration
export const googleLogin = async (req, res) => {
    try {
        const { idToken, phone } = req.body;

        const ticket = await googleClient.verifyIdToken({
            idToken,
            audience: process.env.GOOGLE_CLIENT_ID,
        });
        const payload = ticket.getPayload();
        const email = payload.email.toLowerCase();
        const googleId = payload.sub;

        let user = await User.findOne({ email });

        if (!user) {
            user = new User({
                email,
                googleId,
                phone: phone || '+56900000000',
                consentGiven: true,
                role: email === 'yuri@einsdream.cl' ? 'admin' : 'user'
            });
            await user.save();
        } else if (!user.googleId) {
            user.googleId = googleId;
            if (!user.phone && phone) user.phone = phone;
            await user.save();
        }

        const token = jwt.sign({ userId: user._id, role: user.role }, JWT_SECRET, { expiresIn: '30d' });

        try {
            await LoginLog.create({
                userId: user._id,
                loginMethod: 'google',
                ipAddress: req.ip || 'unknown'
            });
        } catch {}

        res.json({
            token,
            user: {
                id: user._id,
                email: user.email,
                role: user.role,
                phone: user.phone,
                consentGiven: user.consentGiven
            }
        });
    } catch (error) {
        console.error('Google Auth Error:', error);
        res.status(500).json({ message: 'Error authenticating with Google', error: error.message });
    }
};

export const updateConsent = async (req, res) => {
    try {
        const { consentGiven } = req.body;
        const user = await User.findByIdAndUpdate(req.user.userId, { consentGiven }, { new: true });
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        res.json({ message: 'Consent updated successfully', consentGiven: user.consentGiven });
    } catch (error) {
        res.status(500).json({ message: 'Error updating consent', error: error.message });
    }
};
