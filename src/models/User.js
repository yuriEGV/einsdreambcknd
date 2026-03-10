import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
    email: {
        type: String,
        required: true,
        unique: true
    },
    password: {
        type: String, // Not required anymore because of Google Auth
    },
    phone: {
        type: String
    },
    role: {
        type: String,
        enum: ['user', 'admin'],
        default: 'user'
    },
    googleId: {
        type: String, // Store Google subject ID if logged in via Google
    },
    consentGiven: {
        type: Boolean,
        default: false
    },
    services: [{
        name: String,
        status: { type: String, enum: ['active', 'inactive'], default: 'active' },
        startDate: Date
    }],
    sensors: [{
        type: { type: String }, // e.g., 'microphone', 'heart-rate'
        model: String,
        external: { type: Boolean, default: false }
    }],
    createdAt: {
        type: Date,
        default: Date.now
    }
});

export default mongoose.models.User || mongoose.model('User', userSchema);
