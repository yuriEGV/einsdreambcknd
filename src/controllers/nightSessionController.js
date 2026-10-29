import mongoose from 'mongoose';
import NightSession from '../models/NightSession.js';
import AudioSession from '../models/AudioSession.js';
import SleepProfile from '../models/SleepProfile.js';
import User from '../models/User.js';
import {
    evaluateEinsdreamScore,
    calculateTrendsBenchmark,
    predictOptimalBedtime
} from '../services/predictiveEngine.js';
import {
    buildSdrReport,
    buildSdrReportsBatch,
    VARIABLE_CATALOG,
    EVENT_CLASSES,
    PATTERN_LABELS,
    DEFAULT_CONFIG,
    STANDARD,
    SDR_ALGORITHM
} from '../services/sdrReport.js';

// Campos necesarios para calcular informes MN-SDR-001 (sin series pesadas de salud)
const REPORT_FIELDS = 'userId sessionId sessionDate startTime endTime totalDurationMs pauseSegments pauseIntervals correlatedEvents soundEvents tzOffsetMin subjective healthSource syncedFromMobile sdrSnapshot createdAt updatedAt';

/** Quita los eventos originales de un informe para listados livianos. */
const withoutEvents = (report) => {
    const { events, ...rest } = report;
    return rest;
};

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
            snoreMetrics: clientSnore,
            tzOffsetMin: clientTzOffset
        } = req.body;

        const startMs = new Date(startTime).getTime();
        const endMs = new Date(endTime).getTime();
        if (!startTime || !endTime || !Number.isFinite(startMs) || !Number.isFinite(endMs)) {
            return res.status(400).json({
                message: 'startTime y endTime son requeridos y deben ser fechas válidas.'
            });
        }
        if (endMs <= startMs) {
            return res.status(400).json({
                message: 'endTime debe ser posterior a startTime.'
            });
        }

        // Derive sessionDate YYYY-MM-DD from startTime if not supplied
        if (!sessionDate || !/^\d{4}-\d{2}-\d{2}$/.test(String(sessionDate))) {
            sessionDate = new Date(startTime).toISOString().split('T')[0];
        }

        const startTimestamp = startMs;
        const endTimestamp = endMs;
        if (!totalDurationMs) {
            totalDurationMs = Math.max(0, endTimestamp - startTimestamp);
        }

        // Process and enumerate EinsDream 3.0 soundEvents (#1, #2, #3...)
        // MN-SDR-001: se conservan los valores originales; nunca se inventan duraciones ni intensidades
        // y se descartan los eventos marcados como sintéticos (no medidos por el micrófono).
        let rawEvents = soundEvents.length > 0 ? [...soundEvents] : [...correlatedEvents];
        const discardedSynthetic = rawEvents.filter(e => e && (e.synthetic === true || e.source === 'synthetic')).length;
        rawEvents = rawEvents.filter(e => e && !(e.synthetic === true || e.source === 'synthetic'));
        rawEvents.sort((a, b) => (a.offsetMs || 0) - (b.offsetMs || 0));

        const enumeratedEvents = rawEvents.map((evt, idx) => {
            const eventNumber = idx + 1;
            const offsetMs = evt.offsetMs !== undefined ? evt.offsetMs : (evt.relativeMs !== undefined ? evt.relativeMs : 0);
            let evtDate = evt.timestamp ? new Date(evt.timestamp) : new Date(startTimestamp + offsetMs);
            if (Number.isNaN(evtDate.getTime())) evtDate = new Date(startTimestamp + offsetMs);
            const timeLabel = evt.timeLabel || evtDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const eventType = evt.type || evt.eventType || 'noise';
            const hasPeak = typeof evt.peakDb === 'number' && Number.isFinite(evt.peakDb);
            const hasIntensity = typeof evt.intensityDb === 'number' && Number.isFinite(evt.intensityDb);
            const intensityDb = hasPeak ? Math.round(Math.abs(evt.peakDb)) : (hasIntensity ? evt.intensityDb : undefined);
            const durationNum = Number(evt.duration);

            return {
                eventNumber,
                offsetMs,
                timeLabel,
                eventType,
                type: eventType,
                intensityDb,
                peakDb: hasPeak ? evt.peakDb : (hasIntensity ? -Math.abs(evt.intensityDb) : undefined),
                timestamp: evtDate,
                duration: Number.isFinite(durationNum) && durationNum > 0 ? durationNum : undefined,
                confidence: typeof evt.confidence === 'number' && Number.isFinite(evt.confidence) ? evt.confidence : undefined
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

        // Use evaluated metrics, ensuring complete normalization for web & mobile
        const evaluatedSnore = evaluation.snoreMetrics || {};
        const snoreCountComputed = enumeratedEvents.filter(e => e.type === 'snore' || e.eventType === 'snore').length;
        const maxDbComputed = Math.max(0, ...enumeratedEvents.map(e => e.intensityDb || Math.abs(e.peakDb || 0)));

        const finalSnore = {
            ...evaluatedSnore,
            ...(clientSnore || {}),
            totalSnoreEvents: clientSnore?.totalSnoreEvents ?? clientSnore?.snoreEventsCount ?? evaluatedSnore.totalSnoreEvents ?? snoreCountComputed,
            snoreEventsCount: clientSnore?.snoreEventsCount ?? clientSnore?.totalSnoreEvents ?? evaluatedSnore.snoreEventsCount ?? snoreCountComputed,
            snoreDurationMinutes: clientSnore?.snoreDurationMinutes ?? clientSnore?.totalSnoreMinutes ?? evaluatedSnore.snoreDurationMinutes ?? evaluatedSnore.totalSnoreMinutes ?? Math.round(snoreCountComputed * 2.5),
            totalSnoreMinutes: clientSnore?.totalSnoreMinutes ?? clientSnore?.snoreDurationMinutes ?? evaluatedSnore.totalSnoreMinutes ?? Math.round(snoreCountComputed * 2.5),
            peakSnoreDb: clientSnore?.peakSnoreDb ?? clientSnore?.maxDb ?? evaluatedSnore.peakSnoreDb ?? maxDbComputed,
            maxDb: clientSnore?.maxDb ?? clientSnore?.peakSnoreDb ?? evaluatedSnore.maxDb ?? maxDbComputed
        };

        const finalScore = {
            ...(evaluation.einsdreamScore || {}),
            ...(clientScore || {}),
            regularidadScore: clientScore?.regularidadScore ?? clientScore?.regularityScore ?? clientScore?.regularity ?? evaluation.einsdreamScore?.regularidadScore ?? 85,
            duracionScore: clientScore?.duracionScore ?? clientScore?.durationScore ?? clientScore?.duration ?? evaluation.einsdreamScore?.duracionScore ?? 90,
            calidadScore: clientScore?.calidadScore ?? clientScore?.qualityScore ?? clientScore?.quality ?? evaluation.einsdreamScore?.calidadScore ?? 85,
        };

        const finalDimensions = {
            ...(evaluation.dimensions || {}),
            ...(clientDimensions || {}),
            duration: typeof clientDimensions?.duration === 'number' ? clientDimensions.duration : (clientDimensions?.duration?.score ?? evaluation.dimensions?.duration ?? finalScore.duracionScore),
            regularity: typeof clientDimensions?.regularity === 'number' ? clientDimensions.regularity : (clientDimensions?.regularity?.score ?? evaluation.dimensions?.regularity ?? finalScore.regularidadScore),
            quality: typeof clientDimensions?.quality === 'number' ? clientDimensions.quality : (clientDimensions?.quality?.score ?? evaluation.dimensions?.quality ?? finalScore.calidadScore)
        };
        // Sin frecuencia cardíaca medida no se almacena ningún valor cardiovascular de relleno
        const finalCardio = clientCardio || (heartRateSeries.length > 0 ? evaluation.cardiovascular : undefined);

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
                ...(Number.isFinite(Number(clientTzOffset)) ? { tzOffsetMin: Number(clientTzOffset) } : {}),
                syncedFromMobile: true,
                updatedAt: new Date()
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );

        // MN-SDR-001: informe calculado desde los eventos originales + referencia individual (REF-USER)
        let report = null;
        try {
            const prior = await NightSession.find({ userId, sessionDate: { $lt: sessionDate } })
                .sort({ sessionDate: -1 })
                .limit(DEFAULT_CONFIG.refMaxNights + 5)
                .select(REPORT_FIELDS)
                .lean();
            report = buildSdrReport(updatedSession.toObject(), {
                priorSessions: prior,
                profile: sleepProfile,
                includeEvents: false
            });
            await NightSession.updateOne({ _id: updatedSession._id }, {
                $set: {
                    sdrSnapshot: {
                        standard_id: report.standard_id,
                        algorithm: report.algorithm,
                        computed_at: report.generated_at,
                        pattern: report.pattern.code || 'PENDING_REFERENCE',
                        reference: report.reference.type,
                        event_count: report.acoustic.event_count,
                        events_per_hour: report.acoustic.events_per_hour,
                        coverage_pct: report.monitoring.coverage_pct,
                        data_quality: report.quality.data_quality,
                        discarded_synthetic: discardedSynthetic
                    }
                }
            });
        } catch (reportErr) {
            // El informe nunca debe impedir que la sincronización quede guardada
            console.error('Error generating SDR report on sync:', reportErr);
        }

        res.status(200).json({
            success: true,
            message: 'Telemetría nocturna EinsDream 3.0 sincronizada correctamente (CERO bytes de audio en la nube).',
            session: updatedSession,
            report,
            sync: {
                sessionDate,
                eventsStored: enumeratedEvents.length,
                eventsDiscardedSynthetic: discardedSynthetic,
                serverTime: new Date().toISOString()
            }
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

        // MN-SDR-001: calcula informe completo para esta noche
        let sdrReport = null;
        try {
            const profile = await SleepProfile.findOne({ userId: session.userId }).lean() || {};
            const prior = await NightSession.find({ userId: session.userId, sessionDate: { $lt: date } })
                .sort({ sessionDate: -1 })
                .limit(DEFAULT_CONFIG.refMaxNights + 5)
                .select(REPORT_FIELDS)
                .lean();
            sdrReport = buildSdrReport(session, {
                priorSessions: prior,
                profile,
                includeEvents: true
            });
        } catch (e) {
            console.warn('Could not generate sdrReport for date:', date, e.message);
        }

        res.json({
            success: true,
            session,
            sdrReport
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
        const limit = parseInt(req.query.limit) || 30;

        let query = {};
        if (req.query.userId && req.user.role === 'admin') {
            query.userId = req.query.userId;
        } else if (req.user.role !== 'admin') {
            query.userId = userId;
        }

        const sessions = await NightSession.find(query)
            .sort({ sessionDate: -1 })
            .limit(limit)
            .select('sessionId totalDurationMs sessionDate startTime endTime status healthSource sleepSummary nightSummary einsdreamScore dimensions snoreMetrics cardiovascular pauseSegments pauseIntervals soundEvents summary syncedFromMobile correlatedEvents tzOffsetMin subjective sdrSnapshot createdAt')
            .lean();

        // Enriquecer con sdrSnapshot si no lo tiene
        const profile = await SleepProfile.findOne({ userId }).lean() || {};
        const enriched = sessions.map(s => {
            let sdr = s.sdrSnapshot;
            if (!sdr && (s.soundEvents?.length || s.correlatedEvents?.length || s.totalDurationMs)) {
                try {
                    const r = buildSdrReport(s, { priorSessions: sessions, profile, includeEvents: false });
                    sdr = {
                        standard_id: r.standard_id,
                        computed_at: r.generated_at,
                        pattern: r.pattern.code || 'PENDING_REFERENCE',
                        pattern_label: r.pattern.label,
                        reference: r.reference.type,
                        event_count: r.acoustic.event_count,
                        events_per_hour: r.acoustic.events_per_hour,
                        coverage_pct: r.monitoring.coverage_pct,
                        data_quality: r.quality.data_quality
                    };
                } catch (_) {}
            }
            return {
                ...s,
                sdrSnapshot: sdr
            };
        });

        res.json({
            success: true,
            count: enriched.length,
            sessions: enriched
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
 * Get Full MN-SDR-001 Report by session ID or date
 */
export const getSdrReport = async (req, res) => {
    try {
        const userId = req.user.userId;
        const { idOrDate } = req.params;

        let query = {};
        if (/^\d{4}-\d{2}-\d{2}$/.test(idOrDate)) {
            query.sessionDate = idOrDate;
        } else if (mongoose.Types.ObjectId.isValid(idOrDate)) {
            query._id = idOrDate;
        } else {
            query.sessionId = idOrDate;
        }

        if (req.user.role !== 'admin') {
            query.userId = userId;
        }

        const session = await NightSession.findOne(query).lean();
        if (!session) {
            return res.status(404).json({
                message: `No se encontró sesión nocturna para ${idOrDate}`
            });
        }

        const profile = await SleepProfile.findOne({ userId: session.userId }).lean() || {};
        const prior = await NightSession.find({ userId: session.userId, sessionDate: { $lt: session.sessionDate } })
            .sort({ sessionDate: -1 })
            .limit(DEFAULT_CONFIG.refMaxNights + 5)
            .select(REPORT_FIELDS)
            .lean();

        const report = buildSdrReport(session, {
            priorSessions: prior,
            profile,
            includeEvents: true
        });

        res.json({
            success: true,
            report
        });
    } catch (error) {
        console.error('Error generating SDR report:', error);
        res.status(500).json({ message: 'Error al generar informe SDR', error: error.message });
    }
};

/**
 * Get MN-SDR-001 Normative Catalog (Variables, Event Classes, Scale limits)
 */
export const getSdrCatalog = (req, res) => {
    res.json({
        standard: STANDARD,
        algorithm: SDR_ALGORITHM,
        defaultConfig: DEFAULT_CONFIG,
        variableCatalog: VARIABLE_CATALOG,
        eventClasses: EVENT_CLASSES,
        patternLabels: PATTERN_LABELS
    });
};

/**
 * Save Subjective Morning Evaluation (§7.3)
 */
export const saveSubjectiveEvaluation = async (req, res) => {
    try {
        const userId = req.user.userId;
        const { idOrDate } = req.params;
        const { restfulness, daytimeSleepiness, energy, perceivedInterruptions, notes } = req.body;

        let query = {};
        if (/^\d{4}-\d{2}-\d{2}$/.test(idOrDate)) {
            query.sessionDate = idOrDate;
        } else if (mongoose.Types.ObjectId.isValid(idOrDate)) {
            query._id = idOrDate;
        } else {
            query.sessionId = idOrDate;
        }
        if (req.user.role !== 'admin') {
            query.userId = userId;
        }

        const subjective = {
            restfulness: Number(restfulness) || undefined,
            daytimeSleepiness: Number(daytimeSleepiness) || undefined,
            energy: Number(energy) || undefined,
            perceivedInterruptions: Number(perceivedInterruptions) || undefined,
            notes: typeof notes === 'string' ? notes.slice(0, 500) : '',
            submittedAt: new Date()
        };

        const updated = await NightSession.findOneAndUpdate(
            query,
            { $set: { subjective, updatedAt: new Date() } },
            { new: true }
        ).lean();

        if (!updated) {
            return res.status(404).json({ message: 'Sesión nocturna no encontrada.' });
        }

        res.json({
            success: true,
            message: 'Valoración subjetiva guardada correctamente (§7.3, independiente de mediciones instrumentales).',
            subjective: updated.subjective
        });
    } catch (error) {
        res.status(500).json({ message: 'Error al guardar valoración subjetiva', error: error.message });
    }
};

/**
 * Seed Normative Sample Sessions (MN-SDR-001 Demonstration / Bootstrap)
 */
export const seedNormativeSample = async (req, res) => {
    try {
        const userId = req.user.userId;
        const today = new Date();
        const createdSessions = [];

        // Generar 4 noches de prueba conformes con MN-SDR-001 (§12, §13)
        for (let daysAgo = 3; daysAgo >= 0; daysAgo--) {
            const dateObj = new Date(today.getTime() - daysAgo * 86400000);
            const dateStr = dateObj.toISOString().slice(0, 10);
            const start = new Date(`${dateStr}T23:30:00.000Z`);
            const end = new Date(start.getTime() + (daysAgo === 0 ? 390 : 420) * 60000);
            const startMs = start.getTime();

            const numEvts = daysAgo === 0 ? 24 : (14 + daysAgo * 3);
            const soundEvents = [];
            for (let i = 0; i < numEvts; i++) {
                const offsetMin = 15 + (i * ((daysAgo === 0 ? 360 : 390) / numEvts)) + (Math.sin(i * 1.5) * 5);
                const offsetMs = Math.round(offsetMin * 60000);
                soundEvents.push({
                    eventNumber: i + 1,
                    offsetMs,
                    timeLabel: new Date(startMs + offsetMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                    eventType: (i % 3 === 0) ? 'snore' : (i % 5 === 0) ? 'cough' : 'noise',
                    type: (i % 3 === 0) ? 'snore' : (i % 5 === 0) ? 'cough' : 'noise',
                    intensityDb: 35 + Math.round(Math.abs(Math.sin(i)) * 25),
                    peakDb: -(35 + Math.round(Math.abs(Math.sin(i)) * 25)),
                    timestamp: new Date(startMs + offsetMs),
                    duration: 2 + (i % 3)
                });
            }

            const pauseIntervals = daysAgo === 0
                ? [{ startMs: 20 * 60000, endMs: 50 * 60000, durationMs: 30 * 60000 }]
                : [];
            const pauseSegments = pauseIntervals.map(p => ({
                pausedAt: new Date(startMs + p.startMs),
                resumedAt: new Date(startMs + p.endMs),
                durationMs: p.durationMs
            }));

            const session = await NightSession.findOneAndUpdate(
                { userId, sessionDate: dateStr },
                {
                    userId,
                    sessionId: `SES-${dateStr.replace(/-/g, '')}-01`,
                    sessionDate: dateStr,
                    startTime: start,
                    endTime: end,
                    totalDurationMs: end.getTime() - start.getTime(),
                    status: 'completed',
                    healthSource: 'standalone_acoustic',
                    soundEvents,
                    correlatedEvents: soundEvents,
                    pauseIntervals,
                    pauseSegments,
                    summary: {
                        snoreCount: soundEvents.filter(e => e.eventType === 'snore').length,
                        coughCount: soundEvents.filter(e => e.eventType === 'cough').length,
                        totalPausedMinutes: pauseIntervals.length ? 30 : 0
                    },
                    syncedFromMobile: true,
                    updatedAt: new Date()
                },
                { upsert: true, new: true, setDefaultsOnInsert: true }
            );
            createdSessions.push(session);
        }

        res.json({
            success: true,
            message: '4 noches de muestra conformes con MN-SDR-001 preparadas correctamente.',
            count: createdSessions.length
        });
    } catch (error) {
        console.error('Error seeding normative sample:', error);
        res.status(500).json({ message: 'Error generando noches de muestra', error: error.message });
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
