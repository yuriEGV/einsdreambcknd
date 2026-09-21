import mongoose from 'mongoose';

const pairEventSchema = new mongoose.Schema({
    t_start: { type: Number, required: true },
    duration_ms: { type: Number, default: 1500 },
    peak_db: { type: Number, default: -30 },
    type: { type: String, default: 'snore' },
    label: { type: String }
}, { _id: false });

const reconciledEventSchema = new mongoose.Schema({
    t_start: { type: Number, required: true },
    duration_ms: { type: Number, default: 1500 },
    peak_db: { type: Number, default: -30 },
    type: { type: String, default: 'snore' },
    label: { type: String },
    assignedTo: {
        type: String,
        enum: ['left', 'right', 'ambient'],
        required: true
    },
    deltaDb: { type: Number, default: 0 },
    deltaT: { type: Number, default: 0 },
    confidence: { type: Number, default: 90 }
}, { _id: false });

const pairRoomSchema = new mongoose.Schema({
    roomCode: {
        type: String,
        required: true,
        uppercase: true,
        index: true
    },
    hostUserId: {
        type: String,
        default: 'anonymous_host'
    },
    hostDeviceId: {
        type: String,
        default: ''
    },
    hostRole: {
        type: String,
        enum: ['left', 'right'],
        default: 'left'
    },
    guestUserId: {
        type: String,
        default: ''
    },
    guestDeviceId: {
        type: String,
        default: ''
    },
    guestRole: {
        type: String,
        enum: ['left', 'right'],
        default: 'right'
    },
    status: {
        type: String,
        enum: ['waiting', 'paired', 'active', 'completed'],
        default: 'waiting'
    },
    clockOffsetMs: {
        type: Number,
        default: 0
    },
    startedAt: {
        type: Date
    },
    endedAt: {
        type: Date
    },
    eventsHost: [pairEventSchema],
    eventsGuest: [pairEventSchema],
    reconciledEvents: [reconciledEventSchema],
    crossImpact: {
        hostDisturbancesByGuest: { type: Number, default: 0 },
        guestDisturbancesByHost: { type: Number, default: 0 },
        ambientNoiseEvents: { type: Number, default: 0 },
        totalHostEvents: { type: Number, default: 0 },
        totalGuestEvents: { type: Number, default: 0 }
    },
    createdAt: {
        type: Date,
        default: Date.now,
        expires: 86400 // TTL: auto-delete room after 24 hours
    }
}, {
    timestamps: true
});

const PairRoom = mongoose.models.PairRoom || mongoose.model('PairRoom', pairRoomSchema);
export default PairRoom;
