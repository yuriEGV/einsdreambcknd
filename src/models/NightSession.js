import mongoose from 'mongoose';

const correlatedEventSchema = new mongoose.Schema({
    timestamp: {
        type: Date,
        required: true
    },
    duration: {
        type: Number,
        default: 5
    },
    audioUrl: {
        type: String
    },
    audioSessionId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'AudioSession'
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
        default: 'unknown'
    },
    intensityDb: {
        type: Number,
        default: 55
    },
    // Contextual physiological variations around event window (+- 60s)
    hrBaseline: {
        type: Number
    },
    hrPeak: {
        type: Number
    },
    hrDelta: {
        type: Number
    },
    respBaseline: {
        type: Number
    },
    respPeak: {
        type: Number
    },
    oxygenSaturation: {
        type: Number
    },
    sleepStage: {
        type: String,
        enum: ['awake', 'light', 'deep', 'rem', 'unknown'],
        default: 'unknown'
    },
    correlationLabel: {
        type: String
    },
    notes: {
        type: String
    }
}, { _id: true });

const nightSessionSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    sessionDate: {
        type: String, // YYYY-MM-DD
        required: true,
        index: true
    },
    startTime: {
        type: Date,
        required: true
    },
    endTime: {
        type: Date,
        required: true
    },
    status: {
        type: String,
        enum: ['in_progress', 'completed'],
        default: 'completed'
    },
    healthSource: {
        type: String,
        enum: ['health_connect', 'apple_health', 'standalone_acoustic', 'manual', 'none'],
        default: 'standalone_acoustic'
    },
    // Sleep Stage intervals and metrics
    sleepSummary: {
        durationMinutes: { type: Number, default: 0 },
        deepSleepMinutes: { type: Number, default: 0 },
        lightSleepMinutes: { type: Number, default: 0 },
        remSleepMinutes: { type: Number, default: 0 },
        awakeMinutes: { type: Number, default: 0 },
        sleepEfficiency: { type: Number },
        stages: [{
            stage: { type: String, enum: ['awake', 'light', 'deep', 'rem', 'unknown'] },
            startTime: Date,
            endTime: Date
        }]
    },
    // Health metrics time series samples
    heartRateSeries: [{
        timestamp: { type: Date, required: true },
        bpm: { type: Number, required: true }
    }],
    respiratoryRateSeries: [{
        timestamp: { type: Date, required: true },
        rpm: { type: Number, required: true }
    }],
    oxygenSaturationSeries: [{
        timestamp: { type: Date, required: true },
        percentage: { type: Number, required: true }
    }],
    // Associated Audio Sessions (Clips)
    audioEvents: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'AudioSession'
    }],
    // Correlated Events produced by the Night Engine
    correlatedEvents: [correlatedEventSchema],
    // Overall Night Evaluation
    nightSummary: {
        avgHeartRate: Number,
        minHeartRate: Number,
        maxHeartRate: Number,
        avgRespiratoryRate: Number,
        avgOxygenSaturation: Number,
        totalAudioEvents: { type: Number, default: 0 },
        totalSnoreEvents: { type: Number, default: 0 },
        totalCoughEvents: { type: Number, default: 0 },
        evaluationNote: String
    },
    // Einsdream Score Engine (3 Health Pillars)
    einsdreamScore: {
        totalScore: { type: Number, default: 0 }, // 0 - 100
        regularityScore: { type: Number, default: 0 }, // 40% weighting
        durationScore: { type: Number, default: 0 }, // 30% weighting
        qualityScore: { type: Number, default: 0 }, // 30% weighting
        ratingStars: { type: Number, default: 3 }, // 1 - 5 stars
        deficitMinutes: { type: Number, default: 0 }, // +/- min vs target
        irregularityMinutes: { type: Number, default: 0 } // schedule deviation
    },
    // 6+ Rest Dimensions Balance (0 - 100)
    dimensions: {
        duration: { type: Number, default: 0 },
        deepSleep: { type: Number, default: 0 },
        regularity: { type: Number, default: 0 },
        efficiency: { type: Number, default: 0 },
        cardioRecovery: { type: Number, default: 0 },
        acousticPeace: { type: Number, default: 0 },
        remSleep: { type: Number, default: 0 }
    },
    // Advanced Cardiovascular Monitoring
    cardiovascular: {
        avgHeartRate: Number,
        minHeartRate: Number,
        maxHeartRate: Number,
        hrvSdann: Number, // Heart Rate Variability (ms)
        hrvGain: Number, // HRV gain at waking vs nadir (%)
        recoveryLevel: { type: String, enum: ['Excelente', 'Óptima', 'Moderada', 'Baja'], default: 'Óptima' }
    },
    // Snoring & Acoustic Peace Metrics
    snoreMetrics: {
        snorePercentage: { type: Number, default: 0 },
        totalSnoreMinutes: { type: Number, default: 0 },
        snoreEventsCount: { type: Number, default: 0 },
        irregularityIndex: { type: Number, default: 0 }
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
});

nightSessionSchema.index({ userId: 1, sessionDate: -1 });
// 5-Day Database Retention TTL: Automatically expire database records after 5 days (432,000 seconds)
nightSessionSchema.index({ createdAt: 1 }, { expireAfterSeconds: 432000 });

export default mongoose.model('NightSession', nightSessionSchema);
