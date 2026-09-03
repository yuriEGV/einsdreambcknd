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
        enum: ['health_connect', 'apple_health', 'manual', 'none'],
        default: 'health_connect'
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

export default mongoose.model('NightSession', nightSessionSchema);
