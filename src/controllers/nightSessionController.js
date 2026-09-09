import NightSession from '../models/NightSession.js';
import AudioSession from '../models/AudioSession.js';
import SleepProfile from '../models/SleepProfile.js';
import {
    evaluateEinsdreamScore,
    calculateTrendsBenchmark,
    predictOptimalBedtime
} from '../services/predictiveEngine.js';

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
            nightSummary = {},
            einsdreamScore: clientScore,
            dimensions: clientDimensions,
            cardiovascular: clientCardio,
            snoreMetrics: clientSnore
        } = req.body;

        if (!sessionDate || !startTime || !endTime) {
            return res.status(400).json({
                message: 'sessionDate (YYYY-MM-DD), startTime y endTime son requeridos.'
            });
        }

        // Fetch user sleep baseline if exists
        const sleepProfile = await SleepProfile.findOne({ userId }).lean() || {};

        // Run Einsdream Evaluation Engine (3 Health Pillars & 6+ Dimensions)
        const evaluation = evaluateEinsdreamScore({
            startTime,
            endTime,
            sleepSummary,
            heartRateSeries,
            correlatedEvents,
            baselineProfile: sleepProfile
        });

        // Use evaluated metrics, allowing client overrides if provided
        const finalScore = clientScore || evaluation.einsdreamScore;
        const finalDimensions = clientDimensions || evaluation.dimensions;
        const finalCardio = clientCardio || evaluation.cardiovascular;
        const finalSnore = clientSnore || evaluation.snoreMetrics;

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
                einsdreamScore: finalScore,
                dimensions: finalDimensions,
                cardiovascular: finalCardio,
                snoreMetrics: finalSnore,
                updatedAt: new Date()
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );

        res.status(200).json({
            success: true,
            message: 'Sesión nocturna sincronizada correctamente con Health Connect y Einsdream Score.',
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

/**
 * Save / Update Sleep Test (Evaluación Inicial de Salud del Sueño)
 */
export const saveSleepTest = async (req, res) => {
    try {
        const userId = req.user.userId;
        const {
            chronotype,
            targetBedtime,
            targetWakeTime,
            targetSleepMinutes,
            habits,
            notes
        } = req.body;

        const profile = await SleepProfile.findOneAndUpdate(
            { userId },
            {
                userId,
                chronotype: chronotype || 'intermediate',
                targetBedtime: targetBedtime || '23:00',
                targetWakeTime: targetWakeTime || '07:00',
                targetSleepMinutes: targetSleepMinutes || 480,
                habits: habits || {},
                notes: notes || '',
                baselineAssessmentCompleted: true,
                updatedAt: new Date()
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );

        res.status(200).json({
            success: true,
            message: 'Evaluación inicial (Sleep Test) guardada con éxito.',
            profile
        });
    } catch (error) {
        console.error('Error saving sleep test:', error);
        res.status(500).json({
            message: 'Error al guardar el Sleep Test',
            error: error.message
        });
    }
};

/**
 * Get Sleep Test / Baseline Profile
 */
export const getSleepTest = async (req, res) => {
    try {
        const userId = req.user.userId;
        let profile = await SleepProfile.findOne({ userId }).lean();

        if (!profile) {
            // Default profile if not completed yet
            profile = {
                userId,
                chronotype: 'intermediate',
                targetBedtime: '23:00',
                targetWakeTime: '07:00',
                targetSleepMinutes: 480,
                baselineAssessmentCompleted: false,
                habits: {
                    caffeineAfternoon: false,
                    screenBeforeBed: true,
                    exerciseRegular: false,
                    stressLevel: 'medium'
                }
            };
        }

        res.json({ success: true, profile });
    } catch (error) {
        console.error('Error fetching sleep test:', error);
        res.status(500).json({
            message: 'Error al obtener el Sleep Test',
            error: error.message
        });
    }
};

/**
 * Get Trends Benchmarking (7 y 28 días con +/- % vs baseline)
 */
export const getTrendsBenchmark = async (req, res) => {
    try {
        const userId = req.user.userId;
        const sessions = await NightSession.find({ userId })
            .sort({ sessionDate: -1 })
            .limit(30)
            .lean();

        const profile = await SleepProfile.findOne({ userId }).lean() || {};
        const benchmark = calculateTrendsBenchmark(sessions, profile);

        res.json({
            success: true,
            benchmark
        });
    } catch (error) {
        console.error('Error calculating trends benchmark:', error);
        res.status(500).json({
            message: 'Error al calcular el benchmarking de tendencias',
            error: error.message
        });
    }
};

/**
 * Get Predictive Optimal Bedtime Recommendation
 */
export const getOptimalBedtime = async (req, res) => {
    try {
        const userId = req.user.userId;
        const sessions = await NightSession.find({ userId })
            .sort({ sessionDate: -1 })
            .limit(30)
            .lean();

        const profile = await SleepProfile.findOne({ userId }).lean() || {};
        const recommendation = predictOptimalBedtime(sessions, profile);

        res.json({
            success: true,
            recommendation
        });
    } catch (error) {
        console.error('Error predicting optimal bedtime:', error);
        res.status(500).json({
            message: 'Error al calcular la recomendación de horario',
            error: error.message
        });
    }
};

/**
 * Get Latest Night Session Analysis (Score, 6 dimensions, hypnogram, cardio)
 */
export const getLatestAnalysis = async (req, res) => {
    try {
        const userId = req.user.userId;
        const latestSession = await NightSession.findOne({ userId })
            .sort({ sessionDate: -1 })
            .populate('audioEvents')
            .lean();

        if (!latestSession) {
            return res.status(404).json({
                message: 'No se encontraron sesiones previas para este usuario.'
            });
        }

        const profile = await SleepProfile.findOne({ userId }).lean() || {};

        // If not already scored, run evaluation on the fly
        if (!latestSession.einsdreamScore || !latestSession.einsdreamScore.totalScore) {
            const evalResult = evaluateEinsdreamScore({
                startTime: latestSession.startTime,
                endTime: latestSession.endTime,
                sleepSummary: latestSession.sleepSummary,
                heartRateSeries: latestSession.heartRateSeries,
                correlatedEvents: latestSession.correlatedEvents,
                baselineProfile: profile
            });
            latestSession.einsdreamScore = evalResult.einsdreamScore;
            latestSession.dimensions = evalResult.dimensions;
            latestSession.cardiovascular = evalResult.cardiovascular;
            latestSession.snoreMetrics = evalResult.snoreMetrics;
        }

        res.json({
            success: true,
            analysis: latestSession
        });
    } catch (error) {
        console.error('Error fetching latest analysis:', error);
        res.status(500).json({
            message: 'Error al obtener el análisis más reciente',
            error: error.message
        });
    }
};
