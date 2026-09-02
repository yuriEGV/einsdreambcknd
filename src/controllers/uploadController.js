import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Storage } from '@google-cloud/storage';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import AudioSession from '../models/AudioSession.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isVercel = !!(process.env.VERCEL || process.env.VERCEL_ENV || process.env.NOW_REGION);
const uploadDir = isVercel
    ? path.join('/tmp', 'uploads')
    : path.join(__dirname, '../../uploads');

const provider = process.env.STORAGE_PROVIDER || 'local';

// Safe lazy S3 client getter
const getS3Client = () => {
    try {
        if (provider === 's3' && process.env.AWS_REGION && process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
            return new S3Client({
                region: process.env.AWS_REGION,
                credentials: {
                    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
                    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
                }
            });
        }
    } catch (e) {
        console.warn('S3 Client initialization skipped:', e.message);
    }
    return null;
};

// Safe lazy GCS client getter
const getGcsClient = () => {
    try {
        if (provider === 'gcs' && process.env.GCS_PROJECT_ID) {
            return new Storage({
                projectId: process.env.GCS_PROJECT_ID,
                keyFilename: process.env.GCS_KEYFILE_PATH,
            });
        }
    } catch (e) {
        console.warn('GCS Client initialization skipped:', e.message);
    }
    return null;
};

/**
 * Initialize an upload request (Generates presigned URL for S3/GCS or local endpoint)
 */
export const initUpload = async (req, res) => {
    try {
        const { filename, contentType = 'audio/m4a' } = req.body;
        const userId = req.user.userId;

        const cleanFilename = filename ? filename.replace(/[^a-zA-Z0-9._-]/g, '_') : 'audio.m4a';
        const fileKey = `audio/${userId}/${Date.now()}_${cleanFilename}`;

        const s3 = getS3Client();
        const gcs = getGcsClient();

        if (provider === 's3' && s3 && process.env.AWS_S3_BUCKET_NAME) {
            const command = new PutObjectCommand({
                Bucket: process.env.AWS_S3_BUCKET_NAME,
                Key: fileKey,
                ContentType: contentType,
            });

            const presignedUrl = await getSignedUrl(s3, command, { expiresIn: 300 });
            return res.json({ uploadMethod: 'PUT', url: presignedUrl, fileKey, provider: 's3' });

        } else if (provider === 'gcs' && gcs && process.env.GCS_BUCKET_NAME) {
            const bucket = gcs.bucket(process.env.GCS_BUCKET_NAME);
            const file = bucket.file(fileKey);

            const [presignedUrl] = await file.getSignedUrl({
                version: 'v4',
                action: 'write',
                expires: Date.now() + 5 * 60 * 1000, // 5 minutes
                contentType: contentType,
            });

            return res.json({ uploadMethod: 'PUT', url: presignedUrl, fileKey, provider: 'gcs' });

        } else {
            // Local Storage
            return res.json({ uploadMethod: 'POST', url: '/api/upload/local', fileKey, provider: 'local' });
        }

    } catch (error) {
        console.error('Error initializing upload:', error);
        res.status(500).json({ message: 'Error initializing upload', error: error.message });
    }
};

/**
 * Handle Local Upload (Multipart form-data via Multer)
 */
export const handleLocalUpload = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: 'No file uploaded' });
        }

        const filePath = req.file.path;
        const fileKey = req.file.filename;

        // If running in serverless environment (Vercel) without persistent disk, generate base64 data for fallback
        let base64Data = null;
        if (isVercel) {
            try {
                const fileBuffer = fs.readFileSync(filePath);
                base64Data = `data:${req.file.mimetype || 'audio/m4a'};base64,${fileBuffer.toString('base64')}`;
            } catch (e) {
                console.warn('Could not read file for base64 payload:', e.message);
            }
        }

        res.json({
            message: 'File uploaded locally successfully',
            fileKey,
            audioUrl: `/api/sessions/stream-file/${fileKey}`,
            fileData: base64Data
        });
    } catch (error) {
        console.error('Local upload error:', error);
        res.status(500).json({ message: 'Local upload error', error: error.message });
    }
};

/**
 * Save Audio Session Metadata (Supports Einsdream 2.0 and Legacy Mobile APK)
 */
export const saveMetadata = async (req, res) => {
    try {
        const {
            s3Key,
            storageKey,
            duration,
            deviceModel,
            eventType,
            confidence,
            intensityDb,
            preRollSeconds,
            postRollSeconds,
            detectedAt,
            sessionGroup,
            audioBase64,
            audioUrl
        } = req.body;

        const effectiveKey = storageKey || s3Key || `session_${Date.now()}`;
        const cleanEventType = eventType || 'unknown';

        const newSession = new AudioSession({
            userId: req.user.userId,
            storageKey: effectiveKey,
            s3Key: effectiveKey,
            duration: Number(duration) || 15,
            deviceModel: deviceModel || (req.headers['user-agent'] ? 'Mobile / Web' : 'Einsdream Client'),
            eventType: cleanEventType,
            confidence: typeof confidence === 'number' ? confidence : 85,
            intensityDb: typeof intensityDb === 'number' ? intensityDb : 58,
            preRollSeconds: typeof preRollSeconds === 'number' ? preRollSeconds : 5,
            postRollSeconds: typeof postRollSeconds === 'number' ? postRollSeconds : 10,
            detectedAt: detectedAt ? new Date(detectedAt) : new Date(),
            sessionGroup: sessionGroup || `night_${new Date().toISOString().slice(0, 10)}`,
            audioUrl: audioUrl || undefined,
            audioBase64: audioBase64 || undefined
        });

        await newSession.save();

        res.status(201).json({
            message: 'Metadata saved successfully',
            session: newSession
        });
    } catch (error) {
        console.error('Error saving metadata:', error);
        res.status(500).json({ message: 'Error saving metadata', error: error.message });
    }
};

/**
 * Bulk Upload for Offline Queue Sync
 */
export const bulkUploadMetadata = async (req, res) => {
    try {
        const { events } = req.body;
        if (!Array.isArray(events) || events.length === 0) {
            return res.status(400).json({ message: 'events array is required' });
        }

        const userId = req.user.userId;
        const insertedSessions = [];
        const errors = [];

        for (let i = 0; i < events.length; i++) {
            const ev = events[i];
            try {
                const effectiveKey = ev.storageKey || ev.s3Key || `bulk_${Date.now()}_${i}`;
                const newSession = new AudioSession({
                    userId,
                    storageKey: effectiveKey,
                    s3Key: effectiveKey,
                    duration: Number(ev.duration) || 15,
                    deviceModel: ev.deviceModel || 'Einsdream Offline Queue',
                    eventType: ev.eventType || 'unknown',
                    confidence: typeof ev.confidence === 'number' ? ev.confidence : 80,
                    intensityDb: typeof ev.intensityDb === 'number' ? ev.intensityDb : 55,
                    preRollSeconds: typeof ev.preRollSeconds === 'number' ? ev.preRollSeconds : 5,
                    postRollSeconds: typeof ev.postRollSeconds === 'number' ? ev.postRollSeconds : 10,
                    detectedAt: ev.detectedAt ? new Date(ev.detectedAt) : new Date(),
                    sessionGroup: ev.sessionGroup || `night_${new Date().toISOString().slice(0, 10)}`,
                    audioUrl: ev.audioUrl || undefined,
                    audioBase64: ev.audioBase64 || undefined
                });

                await newSession.save();
                insertedSessions.push(newSession);
            } catch (err) {
                errors.push({ index: i, error: err.message });
            }
        }

        res.status(201).json({
            message: `Successfully synced ${insertedSessions.length} offline events`,
            insertedCount: insertedSessions.length,
            sessions: insertedSessions,
            errors
        });
    } catch (error) {
        console.error('Error in bulkUploadMetadata:', error);
        res.status(500).json({ message: 'Error processing bulk upload', error: error.message });
    }
};

/**
 * Get Audio Session Audio (Presigned URL / Base64 / Local Stream)
 */
export const getAudioById = async (req, res) => {
    try {
        const session = await AudioSession.findById(req.params.id).select('+audioBase64');
        if (!session) {
            return res.status(404).json({ message: 'Session not found' });
        }

        let audioUrl = session.audioUrl || null;
        let presignedUrl = null;

        const s3 = getS3Client();
        const gcs = getGcsClient();

        // Generate S3 presigned GET url if provider is s3
        if (provider === 's3' && s3 && process.env.AWS_S3_BUCKET_NAME && session.storageKey) {
            try {
                const command = new GetObjectCommand({
                    Bucket: process.env.AWS_S3_BUCKET_NAME,
                    Key: session.storageKey,
                });
                presignedUrl = await getSignedUrl(s3, command, { expiresIn: 3600 });
                audioUrl = presignedUrl;
            } catch (s3Err) {
                console.warn('Could not generate S3 presigned URL:', s3Err.message);
            }
        } else if (provider === 'gcs' && gcs && process.env.GCS_BUCKET_NAME && session.storageKey) {
            try {
                const bucket = gcs.bucket(process.env.GCS_BUCKET_NAME);
                const file = bucket.file(session.storageKey);
                const [url] = await file.getSignedUrl({
                    version: 'v4',
                    action: 'read',
                    expires: Date.now() + 60 * 60 * 1000,
                });
                presignedUrl = url;
                audioUrl = presignedUrl;
            } catch (gcsErr) {
                console.warn('Could not generate GCS presigned URL:', gcsErr.message);
            }
        }

        if (!audioUrl && session.storageKey) {
            audioUrl = `/api/sessions/${session._id}/stream`;
        }

        res.json({
            audioUrl: audioUrl || presignedUrl,
            audioBase64: session.audioBase64 || null,
            streamUrl: `/api/sessions/${session._id}/stream`,
            storageKey: session.storageKey,
            eventType: session.eventType,
            duration: session.duration
        });
    } catch (error) {
        console.error('Error fetching audio data:', error);
        res.status(500).json({ message: 'Error fetching audio data', error: error.message });
    }
};

/**
 * Stream local audio file by Session ID
 */
export const streamAudioSession = async (req, res) => {
    try {
        const { id } = req.params;
        const session = await AudioSession.findById(id).select('+audioBase64');
        if (!session) {
            return res.status(404).json({ message: 'Session not found' });
        }

        const filename = session.storageKey || session.s3Key;
        const potentialPath = path.isAbsolute(filename) ? filename : path.join(uploadDir, path.basename(filename));

        if (fs.existsSync(potentialPath)) {
            const stat = fs.statSync(potentialPath);
            const fileSize = stat.size;
            const range = req.headers.range;

            if (range) {
                const parts = range.replace(/bytes=/, '').split('-');
                const start = parseInt(parts[0], 10);
                const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
                const chunksize = (end - start) + 1;
                const file = fs.createReadStream(potentialPath, { start, end });
                const head = {
                    'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                    'Accept-Ranges': 'bytes',
                    'Content-Length': chunksize,
                    'Content-Type': 'audio/m4a',
                };
                res.writeHead(206, head);
                file.pipe(res);
            } else {
                const head = {
                    'Content-Length': fileSize,
                    'Content-Type': 'audio/m4a',
                    'Accept-Ranges': 'bytes'
                };
                res.writeHead(200, head);
                fs.createReadStream(potentialPath).pipe(res);
            }
            return;
        }

        if (session.audioBase64) {
            const cleanBase64 = session.audioBase64.replace(/^data:audio\/[a-zA-Z0-9]+;base64,/, '');
            const buffer = Buffer.from(cleanBase64, 'base64');
            res.writeHead(200, {
                'Content-Type': 'audio/m4a',
                'Content-Length': buffer.length,
                'Accept-Ranges': 'bytes'
            });
            return res.end(buffer);
        }

        res.status(404).json({ message: 'Audio file not found on local storage' });
    } catch (error) {
        console.error('Error streaming audio session:', error);
        res.status(500).json({ message: 'Error streaming audio', error: error.message });
    }
};

/**
 * Get My Sessions with Filters
 */
export const getMySessions = async (req, res) => {
    try {
        const { eventType, sessionGroup, date, limit = 100, page = 1 } = req.query;
        const filter = { userId: req.user.userId };

        if (eventType && eventType !== 'all') {
            filter.eventType = eventType;
        }

        if (sessionGroup) {
            filter.sessionGroup = sessionGroup;
        }

        if (date) {
            const start = new Date(date);
            start.setHours(0, 0, 0, 0);
            const end = new Date(date);
            end.setHours(23, 59, 59, 999);
            filter.detectedAt = { $gte: start, $lte: end };
        }

        const skip = (Number(page) - 1) * Number(limit);

        const sessions = await AudioSession.find(filter)
            .sort({ detectedAt: -1, createdAt: -1 })
            .skip(skip)
            .limit(Number(limit))
            .lean();

        const total = await AudioSession.countDocuments(filter);

        res.json({
            sessions,
            total,
            page: Number(page),
            pages: Math.ceil(total / Number(limit))
        });
    } catch (error) {
        console.error('Error fetching sessions:', error);
        res.status(500).json({ message: 'Error fetching sessions', error: error.message });
    }
};

/**
 * Get Night Session Timeline Events
 */
export const getNightSession = async (req, res) => {
    try {
        const userId = req.user.userId;
        const targetDateStr = req.params.date || req.query.date || new Date().toISOString().slice(0, 10);

        const startDate = new Date(targetDateStr);
        startDate.setHours(20, 0, 0, 0);

        const endDate = new Date(targetDateStr);
        endDate.setDate(endDate.getDate() + 1);
        endDate.setHours(12, 0, 0, 0);

        const events = await AudioSession.find({
            userId,
            detectedAt: { $gte: startDate, $lte: endDate }
        })
            .sort({ detectedAt: 1 })
            .lean();

        const eventBreakdown = {
            snore: 0,
            cough: 0,
            breathing: 0,
            irregular_breathing: 0,
            voice: 0,
            noise: 0,
            movement: 0,
            unknown: 0
        };

        let totalDuration = 0;
        events.forEach(e => {
            const type = e.eventType || 'unknown';
            eventBreakdown[type] = (eventBreakdown[type] || 0) + 1;
            totalDuration += (e.duration || 15);
        });

        const firstEvent = events[0] ? events[0].detectedAt : null;
        const lastEvent = events.length > 0 ? events[events.length - 1].detectedAt : null;

        res.json({
            date: targetDateStr,
            range: { start: startDate, end: endDate },
            totalEvents: events.length,
            totalDurationSeconds: Math.round(totalDuration),
            firstEventAt: firstEvent,
            lastEventAt: lastEvent,
            eventBreakdown,
            events
        });
    } catch (error) {
        console.error('Error fetching night session:', error);
        res.status(500).json({ message: 'Error fetching night session', error: error.message });
    }
};

/**
 * Get Comprehensive User Sleep Statistics
 */
export const getSessionStats = async (req, res) => {
    try {
        const userId = req.user.userId;

        const allSessions = await AudioSession.find({ userId })
            .sort({ detectedAt: -1 })
            .lean();

        const totalEvents = allSessions.length;
        let totalDurationSeconds = 0;
        const typeCounts = {};
        const hourlyDistribution = Array.from({ length: 24 }, (_, i) => ({ hour: i, count: 0 }));
        const dailyDistribution = {};

        allSessions.forEach(s => {
            totalDurationSeconds += (s.duration || 15);

            const t = s.eventType || 'unknown';
            typeCounts[t] = (typeCounts[t] || 0) + 1;

            const d = new Date(s.detectedAt || s.createdAt);
            const hour = d.getHours();
            hourlyDistribution[hour].count += 1;

            const dayKey = d.toISOString().slice(0, 10);
            if (!dailyDistribution[dayKey]) {
                dailyDistribution[dayKey] = { date: dayKey, events: 0, duration: 0 };
            }
            dailyDistribution[dayKey].events += 1;
            dailyDistribution[dayKey].duration += (s.duration || 15);
        });

        const recentDays = Object.values(dailyDistribution)
            .sort((a, b) => b.date.localeCompare(a.date))
            .slice(0, 7)
            .reverse();

        const today = new Date();
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        const lastNightKey = yesterday.toISOString().slice(0, 10);
        const lastNightData = dailyDistribution[lastNightKey] || dailyDistribution[today.toISOString().slice(0, 10)] || { events: 0, duration: 0 };

        res.json({
            totalRecordings: totalEvents,
            totalDurationSeconds: Math.round(totalDurationSeconds),
            totalHours: +(totalDurationSeconds / 3600).toFixed(1),
            byType: typeCounts,
            hourlyDistribution,
            recentDaysTrend: recentDays,
            lastNight: {
                date: lastNightKey,
                eventsCount: lastNightData.events,
                durationMinutes: Math.round(lastNightData.duration / 60)
            },
            provider
        });
    } catch (error) {
        console.error('Error fetching statistics:', error);
        res.status(500).json({ message: 'Error calculating stats', error: error.message });
    }
};

/**
 * Add a comment or note to an audio session event
 */
export const addSessionComment = async (req, res) => {
    try {
        const { id } = req.params;
        const { text } = req.body;

        if (!text || !text.trim()) {
            return res.status(400).json({ message: 'Comment text is required' });
        }

        const session = await AudioSession.findById(id);
        if (!session) {
            return res.status(404).json({ message: 'Session not found' });
        }

        session.comments = session.comments || [];
        session.comments.push({
            text: text.trim(),
            author: req.user.email || 'User',
            createdAt: new Date()
        });

        await session.save();

        res.json({
            message: 'Comment added successfully',
            comments: session.comments
        });
    } catch (error) {
        console.error('Error adding comment:', error);
        res.status(500).json({ message: 'Error adding comment', error: error.message });
    }
};

/**
 * Diagnostics Status Endpoint
 */
export const getDiagnosticsStatus = async (req, res) => {
    try {
        const userId = req.user.userId;
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        const [todayEventsCount, latestEvent] = await Promise.all([
            AudioSession.countDocuments({ userId, detectedAt: { $gte: todayStart } }),
            AudioSession.findOne({ userId }).sort({ detectedAt: -1 }).lean()
        ]);

        res.json({
            status: 'ONLINE',
            timestamp: new Date().toISOString(),
            storage: {
                provider,
                configured: true,
                bucket: process.env.AWS_S3_BUCKET_NAME || process.env.GCS_BUCKET_NAME || 'local_disk'
            },
            database: {
                connected: true,
                model: 'AudioSession v2.0'
            },
            metrics: {
                todayEvents: todayEventsCount,
                latestEvent: latestEvent ? {
                    id: latestEvent._id,
                    eventType: latestEvent.eventType,
                    confidence: latestEvent.confidence,
                    detectedAt: latestEvent.detectedAt,
                    duration: latestEvent.duration
                } : null
            }
        });
    } catch (error) {
        console.error('Error getting diagnostics:', error);
        res.status(500).json({ message: 'Error getting diagnostics', error: error.message });
    }
};
