import mongoose from 'mongoose';

const loginLogSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    loginMethod: {
        type: String,
        enum: ['email', 'google'],
        required: true
    },
    ipAddress: {
        type: String
    },
    timestamp: {
        type: Date,
        default: Date.now
    }
});

export default mongoose.model('LoginLog', loginLogSchema);
