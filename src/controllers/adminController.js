import User from '../models/User.js';
import LoginLog from '../models/LoginLog.js';
import AudioSession from '../models/AudioSession.js';

export const getUsers = async (req, res) => {
    try {
        const users = await User.find().select('-password').sort({ createdAt: -1 });
        res.json(users);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching users', error: error.message });
    }
};

export const getLoginLogs = async (req, res) => {
    try {
        const logs = await LoginLog.find().populate('userId', 'email role').sort({ timestamp: -1 });
        res.json(logs);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching login logs', error: error.message });
    }
};

export const getAudioSessions = async (req, res) => {
    try {
        const sessions = await AudioSession.find().populate('userId', 'email').sort({ createdAt: -1 });
        res.json(sessions);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching audio sessions', error: error.message });
    }
};

export const createUser = async (req, res) => {
    try {
        const { email, password, phone, role, services, sensors } = req.body;

        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ message: 'User already exists' });
        }

        const user = new User({
            email,
            password, // MVP: plain text, use bcrypt in production
            phone,
            role: role || 'user',
            services: services || [],
            sensors: sensors || []
        });

        await user.save();
        res.status(201).json({ message: 'User created successfully', user });
    } catch (error) {
        res.status(500).json({ message: 'Error creating user', error: error.message });
    }
};

export const updateUser = async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body;

        const user = await User.findByIdAndUpdate(id, updates, { new: true });
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        res.json({ message: 'User updated successfully', user });
    } catch (error) {
        res.status(500).json({ message: 'Error updating user', error: error.message });
    }
};
