import mongoose from 'mongoose';

const audioSessionSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    // storageKey is the canonical identifier; s3Key kept for backward compatibility with existing data & mobile APK
    storageKey: {
        type: String,
        required: true,
        index: true
    },
    s3Key: {
        type: String,
        index: true
    },
    audioBase64: {
        type: String,
        select: false
    },
    audioUrl: {
        type: String
    },
    duration: {
        type: Number, // duration in seconds
        required: true,
        default: 15
    },
    deviceModel: {
        type: String,
        default: 'Web Monitor'
    },
    eventType: {
        type: String,
        enum: [
            'noise',
            'snore',
            'cough',
            'voice',
            'breathing',
            'irregular_breathing',
            'movement',
            'auto-agent',
            'unknown'
        ],
        default: 'unknown',
        index: true
    },
    confidence: {
        type: Number, // 0 - 100 percentage
        min: 0,
        max: 100,
        default: 80
    },
    intensityDb: {
        type: Number, // Estimated intensity in dB (e.g. 45 - 90 dB)
        default: 55
    },
    preRollSeconds: {
        type: Number, // Pre-roll buffer seconds included (e.g. 5)
        default: 5
    },
    postRollSeconds: {
        type: Number, // Post-roll capture seconds (e.g. 10)
        default: 10
    },
    detectedAt: {
        type: Date, // Exact moment anomaly sound triggered
        default: Date.now,
        index: true
    },
    sessionGroup: {
        type: String, // Night session group ID (e.g. 'night_2026-09-02_usr123')
        index: true
    },
    comments: [{
        text: { type: String, required: true },
        author: { type: String, default: 'User' },
        createdAt: { type: Date, default: Date.now }
    }],
    createdAt: {
        type: Date,
        default: Date.now,
        index: true
    }
});

// Pre-save hook to ensure s3Key and storageKey stay in sync for backward compatibility
audioSessionSchema.pre('save', function (next) {
    if (!this.storageKey && this.s3Key) {
        this.storageKey = this.s3Key;
    } else if (!this.s3Key && this.storageKey) {
        this.s3Key = this.storageKey;
    }
    if (!this.detectedAt) {
        this.detectedAt = this.createdAt || new Date();
    }
    next();
});

export default mongoose.models.AudioSession || mongoose.model('AudioSession', audioSessionSchema);
