import User from '../models/User.js';
import LoginLog from '../models/LoginLog.js';
import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// Basic Email/Password Register
export const register = async (req, res) => {
    try {
        const { email, password, phone } = req.body;

        if (!phone) {
            return res.status(400).json({ message: 'Phone number is required' });
        }

        let user = await User.findOne({ email });
        if (user) {
            return res.status(400).json({ message: 'User already exists' });
        }

        user = new User({ email, password, phone });
        await user.save();

        const token = jwt.sign({ userId: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '7d' });

        // Record login log
        await LoginLog.create({
            userId: user._id,
            loginMethod: 'email',
            ipAddress: req.ip
        });

        res.status(201).json({ token, user: { id: user._id, email: user.email, role: user.role, phone: user.phone, consentGiven: user.consentGiven } });
    } catch (error) {
        res.status(500).json({ message: 'Error registering user', error: error.message });
    }
};

// Basic Email/Password Login
export const login = async (req, res) => {
    try {
        const { email, password } = req.body;

        const user = await User.findOne({ email });
        // MVP: plain string compare, use bcrypt in prod
        if (!user || user.password !== password) {
            return res.status(400).json({ message: 'Invalid credentials' });
        }

        const token = jwt.sign({ userId: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '7d' });

        // Record login log
        await LoginLog.create({
            userId: user._id,
            loginMethod: 'email',
            ipAddress: req.ip
        });

        res.json({ token, user: { id: user._id, email: user.email, role: user.role, phone: user.phone, consentGiven: user.consentGiven } });
    } catch (error) {
        res.status(500).json({ message: 'Error logging in', error: error.message });
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
        const { email, sub: googleId } = payload;

        // Check if user exists
        let user = await User.findOne({ email });

        if (!user) {
            if (!phone) {
                return res.status(400).json({ message: 'Phone number is required for new Google registrations', requirePhone: true });
            }
            // Create user if they don't exist
            user = new User({
                email,
                googleId,
                phone,
                consentGiven: false, // Default to false for new users
                role: email === 'yuri@einsdream.cl' ? 'admin' : 'user'
            });
            await user.save();
        } else if (!user.googleId) {
            // Associate google account to existing email
            user.googleId = googleId;
            // if for some reason existing user didn't have phone, update it
            if (!user.phone && phone) {
                user.phone = phone;
            }
            await user.save();
        }

        const token = jwt.sign({ userId: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '7d' });

        // Record login log
        await LoginLog.create({
            userId: user._id,
            loginMethod: 'google',
            ipAddress: req.ip
        });

        res.json({ token, user: { id: user._id, email: user.email, role: user.role, phone: user.phone, consentGiven: user.consentGiven } });
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
