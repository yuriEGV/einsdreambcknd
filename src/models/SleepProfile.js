import mongoose from 'mongoose';

const sleepProfileSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        unique: true,
        index: true
    },
    // Sleep Test & Baseline
    chronotype: {
        type: String,
        enum: ['early_bird', 'intermediate', 'night_owl'],
        default: 'intermediate'
    },
    targetBedtime: {
        type: String,
        default: '23:00' // HH:MM
    },
    targetWakeTime: {
        type: String,
        default: '07:00' // HH:MM
    },
    targetSleepMinutes: {
        type: Number,
        default: 480 // 8 hours baseline
    },
    // Subjective & Habit Factors from Sleep Test
    habits: {
        caffeineAfternoon: { type: Boolean, default: false },
        screenBeforeBed: { type: Boolean, default: true },
        exerciseRegular: { type: Boolean, default: false },
        stressLevel: {
            type: String,
            enum: ['low', 'medium', 'high'],
            default: 'medium'
        },
        noiseSensitivity: {
            type: String,
            enum: ['low', 'medium', 'high'],
            default: 'medium'
        }
    },
    baselineAssessmentCompleted: {
        type: Boolean,
        default: false
    },
    baselineScore: {
        type: Number,
        default: 75
    },
    notes: String,
    updatedAt: {
        type: Date,
        default: Date.now
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

export default mongoose.models.SleepProfile || mongoose.model('SleepProfile', sleepProfileSchema);
