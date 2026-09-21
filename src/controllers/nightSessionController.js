import mongoose from 'mongoose';
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
        let {
            sessionId,
            sessionDate,
            startTime,
            endTime,
            totalDurationMs,
            pauseIntervals = [],
            soundEvents = [],
            summary = {},
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

        if (!startTime || !endTime) {
            return res.status(400).json({
                message: 'startTime y endTime son requeridos.'
            });
        }

        // Derive sessionDate YYYY-MM-DD from startTime if not supplied
        if (!sessionDate) {
            sessionDate = new Date(startTime).toISOString().split('T')[0];
        }

        const startTimestamp = new Date(startTime).getTime();
        const endTimestamp = new Date(endTime).getTime();
        if (!totalDurationMs) {
            totalDurationMs = Math.max(0, endTimestamp - startTimestamp);
        }

        // Process and enumerate EinsDream 3.0 soundEvents (#1, #2, #3...)
        let rawEvents = soundEvents.length > 0 ? [...soundEvents] : [...correlatedEvents];
        rawEvents.sort((a, b) => (a.offsetMs || 0) - (b.offsetMs || 0));

        const enumeratedEvents = rawEvents.map((evt, idx) => {
            const eventNumber = idx + 1;
            const offsetMs = evt.offsetMs !== undefined ? evt.offsetMs : (evt.relativeMs !== undefined ? evt.relativeMs : 0);
            const evtDate = evt.timestamp ? new Date(evt.timestamp) : new Date(startTimestamp + offsetMs);
            const timeLabel = evt.timeLabel || evtDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const eventType = evt.type || evt.eventType || 'noise';
            const intensityDb = evt.peakDb ? Math.round(Math.abs(evt.peakDb)) : (evt.intensityDb || 55);

            return {
                eventNumber,
                offsetMs,
                timeLabel,
                eventType,
                type: eventType,
                intensityDb,
                peakDb: evt.peakDb !== undefined ? evt.peakDb : -Math.abs(intensityDb),
                timestamp: evtDate,
                duration: evt.duration || 5
            };
        });

        // Correlate pauseIntervals into pauseSegments
        let processedPauseSegments = req.body.pauseSegments || [];
        if (pauseIntervals.length > 0 && processedPauseSegments.length === 0) {
            processedPauseSegments = pauseIntervals.map(p => ({
                pausedAt: new Date(startTimestamp + (p.startMs || 0)),
                resumedAt: new Date(startTimestamp + (p.endMs || 0)),
                durationMs: Math.max(0, (p.endMs || 0) - (p.startMs || 0))
            }));
        }

        // Calculate total paused minutes
        const totalPausedMinutes = summary.totalPausedMinutes !== undefined
            ? summary.totalPausedMinutes
            : Math.round(pauseIntervals.reduce((acc, p) => acc + (((p.endMs || 0) - (p.startMs || 0)) / 60000), 0));

        // Fetch user sleep baseline if exists
        const sleepProfile = await SleepProfile.findOne({ userId }).lean() || {};

        // Run Einsdream Evaluation Engine (3 Health Pillars & 6+ Dimensions)
        const evaluation = evaluateEinsdreamScore({
            startTime,
            endTime,
            sleepSummary,
            heartRateSeries,
            correlatedEvents: enumeratedEvents,
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

        calcSummary.totalAudioEvents = enumeratedEvents.length;
        calcSummary.totalSnoreEvents = summary.snoreCount !== undefined
            ? summary.snoreCount
            : enumeratedEvents.filter(e => e.eventType === 'snore').length;
        calcSummary.totalCoughEvents = summary.coughCount !== undefined
            ? summary.coughCount
            : enumeratedEvents.filter(e => e.eventType === 'cough').length;
        calcSummary.totalPausedMinutes = totalPausedMinutes;

        const consolidatedSummary = {
            snoreCount: calcSummary.totalSnoreEvents,
            coughCount: calcSummary.totalCoughEvents,
            totalPausedMinutes
        };

        // Find existing session for that date or create new
        const updatedSession = await NightSession.findOneAndUpdate(
            { userId, sessionDate },
            {
                userId,
                sessionId: sessionId || `night_${sessionDate.replace(/-/g, '_')}`,
                sessionDate,
                startTime: new Date(startTime),
                endTime: new Date(endTime),
                totalDurationMs,
                status: 'completed',
                healthSource,
                sleepSummary,
                heartRateSeries,
                respiratoryRateSeries,
                oxygenSaturationSeries,
                audioEvents: audioEventIds,
                correlatedEvents: enumeratedEvents,
                soundEvents: enumeratedEvents,
                pauseIntervals,
                pauseSegments: processedPauseSegments,
                summary: consolidatedSummary,
                nightSummary: calcSummary,
                einsdreamScore: finalScore,
                dimensions: finalDimensions,
                cardiovascular: finalCardio,
                snoreMetrics: finalSnore,
                syncedFromMobile: true,
                updatedAt: new Date()
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );

        res.status(200).json({
            success: true,
            message: 'Telemetría nocturna EinsDream 3.0 sincronizada correctamente (CERO bytes de audio en la nube).',
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
            .select('sessionId totalDurationMs sessionDate startTime endTime status healthSource sleepSummary nightSummary einsdreamScore dimensions snoreMetrics cardiovascular pauseSegments pauseIntervals soundEvents summary syncedFromMobile correlatedEvents createdAt')
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

/**
 * Delete Night Session (Supports owner or admin)
 */
export const deleteNightSession = async (req, res) => {
    try {
        const { id } = req.params;
        const query = mongoose.Types.ObjectId.isValid(id) ? { _id: id } : { sessionId: id };
        if (req.user.role !== 'admin') {
            query.userId = req.user.userId;
        }
        const deleted = await NightSession.findOneAndDelete(query);
        if (!deleted) {
            return res.status(404).json({ message: 'Sesión nocturna no encontrada' });
        }
        res.json({ success: true, message: 'Sesión nocturna eliminada correctamente' });
    } catch (error) {
        res.status(500).json({ message: 'Error al eliminar sesión nocturna', error: error.message });
    }
};
