import NightSession from '../models/NightSession.js';
import AudioSession from '../models/AudioSession.js';

/**
 * Sync / Create Night Session in batch (Called in the morning by mobile app)
 */
export const syncNightSession = async (req, res) => {
    try {
        const userId = req.user.userId;
        const {
            sessionDate,
            startTime,
            endTime,
            healthSource = 'health_connect',
            sleepSummary = {},
            heartRateSeries = [],
            respiratoryRateSeries = [],
            oxygenSaturationSeries = [],
            audioEventIds = [],
            correlatedEvents = [],
            nightSummary = {}
        } = req.body;

        if (!sessionDate || !startTime || !endTime) {
            return res.status(400).json({
                message: 'sessionDate (YYYY-MM-DD), startTime y endTime son requeridos.'
            });
        }

        // Calculate summary metrics if not provided
        let calcSummary = { ...nightSummary };
        if (heartRateSeries.length > 0) {
            const hrVals = heartRateSeries.map(h => h.bpm).filter(Boolean);
            if (hrVals.length > 0) {
                calcSummary.minHeartRate = Math.min(...hrVals);
                calcSummary.maxHeartRate = Math.max(...hrVals);
                calcSummary.avgHeartRate = Math.round(hrVals.reduce((a, b) => a + b, 0) / hrVals.length);
            }
        }

        if (respiratoryRateSeries.length > 0) {
            const respVals = respiratoryRateSeries.map(r => r.rpm).filter(Boolean);
            if (respVals.length > 0) {
                calcSummary.avgRespiratoryRate = Number((respVals.reduce((a, b) => a + b, 0) / respVals.length).toFixed(1));
            }
        }

        if (oxygenSaturationSeries.length > 0) {
            const spo2Vals = oxygenSaturationSeries.map(s => s.percentage).filter(Boolean);
            if (spo2Vals.length > 0) {
                calcSummary.avgOxygenSaturation = Number((spo2Vals.reduce((a, b) => a + b, 0) / spo2Vals.length).toFixed(1));
            }
        }

        calcSummary.totalAudioEvents = correlatedEvents.length || audioEventIds.length;
        calcSummary.totalSnoreEvents = correlatedEvents.filter(e => e.eventType === 'snore').length;
        calcSummary.totalCoughEvents = correlatedEvents.filter(e => e.eventType === 'cough').length;

        // Find existing session for that date or create new
        const updatedSession = await NightSession.findOneAndUpdate(
            { userId, sessionDate },
            {
                userId,
                sessionDate,
                startTime: new Date(startTime),
                endTime: new Date(endTime),
                status: 'completed',
                healthSource,
                sleepSummary,
                heartRateSeries,
                respiratoryRateSeries,
                oxygenSaturationSeries,
                audioEvents: audioEventIds,
                correlatedEvents,
                nightSummary: calcSummary,
                updatedAt: new Date()
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );

        res.status(200).json({
            success: true,
            message: 'Sesión nocturna sincronizada correctamente con Health Connect.',
            session: updatedSession
        });
    } catch (error) {
        console.error('Error syncing night session:', error);
        res.status(500).json({
            message: 'Error al sincronizar la sesión nocturna',
            error: error.message
        });
    }
};

/**
 * Get Night Session by Date (YYYY-MM-DD)
 */
export const getNightSessionByDate = async (req, res) => {
    try {
        const userId = req.user.userId;
        const { date } = req.params;

        let query = { sessionDate: date };
        // If not admin, restrict to requesting user
        if (req.user.role !== 'admin') {
            query.userId = userId;
        }

        const session = await NightSession.findOne(query)
            .populate('audioEvents', 'storageKey audioUrl duration eventType intensityDb timestamp')
            .lean();

        if (!session) {
            return res.status(404).json({
                message: `No se encontró sesión nocturna para la fecha ${date}`
            });
        }

        res.json({
            success: true,
            session
        });
    } catch (error) {
        console.error('Error fetching night session by date:', error);
        res.status(500).json({
            message: 'Error al obtener la sesión nocturna',
            error: error.message
        });
    }
};

/**
 * Get Night Sessions History (recent nights for trends)
 */
export const getNightSessionsHistory = async (req, res) => {
    try {
        const userId = req.user.userId;
        const limit = parseInt(req.query.limit) || 14;

        let query = {};
        if (req.user.role !== 'admin') {
            query.userId = userId;
        }

        const sessions = await NightSession.find(query)
            .sort({ sessionDate: -1 })
            .limit(limit)
            .select('sessionDate startTime endTime status healthSource sleepSummary nightSummary createdAt')
            .lean();

        res.json({
            success: true,
            count: sessions.length,
            sessions
        });
    } catch (error) {
        console.error('Error fetching sessions history:', error);
        res.status(500).json({
            message: 'Error al obtener el historial nocturno',
            error: error.message
        });
    }
};

/**
 * Get Night Session by ID
 */
export const getNightSessionById = async (req, res) => {
    try {
        const { id } = req.params;
        const session = await NightSession.findById(id)
            .populate('audioEvents')
            .lean();

        if (!session) {
            return res.status(404).json({ message: 'Sesión no encontrada' });
        }

        res.json({ success: true, session });
    } catch (error) {
        res.status(500).json({ message: 'Error al buscar sesión', error: error.message });
    }
};
