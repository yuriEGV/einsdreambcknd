import mongoose from 'mongoose';

const audioSessionSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    s3Key: {
        type: String,
        required: true
    },
    audioBase64: {
        type: String,
        // Will be used when provider is 'local' on serverless environments
    },
    duration: {
        type: Number, // duration in seconds
        required: true
    },
    deviceModel: {
        type: String
    },
    eventType: {
        type: String,
        enum: ['noise', 'snore', 'cough', 'voice', 'auto-agent', 'unknown'],
        default: 'unknown'
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

export default mongoose.models.AudioSession || mongoose.model('AudioSession', audioSessionSchema);
