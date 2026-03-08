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
    duration: {
        type: Number, // duration in seconds
        required: true
    },
    deviceModel: {
        type: String
    },
    eventType: {
        type: String,
        enum: ['noise', 'snore', 'cough', 'voice', 'unknown'],
        default: 'unknown'
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

export default mongoose.model('AudioSession', audioSessionSchema);
