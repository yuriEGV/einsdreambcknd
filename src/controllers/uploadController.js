import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Storage } from '@google-cloud/storage';
import fs from 'fs';
import AudioSession from '../models/AudioSession.js';

const provider = process.env.STORAGE_PROVIDER || 'local';

// AWS S3 Client Setup
const s3Client = provider === 's3' ? new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    }
}) : null;

// Google Cloud Storage Setup
const gcsClient = provider === 'gcs' ? new Storage({
    projectId: process.env.GCS_PROJECT_ID,
    keyFilename: process.env.GCS_KEYFILE_PATH,
}) : null;

export const initUpload = async (req, res) => {
    try {
        const { filename, contentType } = req.body;
        const userId = req.user.userId;

        const fileKey = `audio/${userId}/${Date.now()}_${filename}`;

        if (provider === 's3') {
            const command = new PutObjectCommand({
                Bucket: process.env.AWS_S3_BUCKET_NAME,
                Key: fileKey,
                ContentType: contentType,
            });

            const presignedUrl = await getSignedUrl(s3Client, command, { expiresIn: 300 });
            return res.json({ uploadMethod: 'PUT', url: presignedUrl, fileKey, provider: 's3' });

        } else if (provider === 'gcs') {
            const bucket = gcsClient.bucket(process.env.GCS_BUCKET_NAME);
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
            return res.json({ uploadMethod: 'POST', url: '/upload/local', fileKey, provider: 'local' });
        }

    } catch (error) {
        res.status(500).json({ message: 'Error initializing upload', error: error.message });
    }
};

export const handleLocalUpload = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: 'No file uploaded' });
        }

        // The mobile client just sends the file over Form Data.
        // On Vercel, we must convert this temporary file to base64 and return it
        // so the client can save it in the metadata request.
        const filePath = req.file.path;
        const fileBuffer = fs.readFileSync(filePath);
        const base64Data = `data:${req.file.mimetype};base64,${fileBuffer.toString('base64')}`;

        // Clean up temp file
        try { fs.unlinkSync(filePath); } catch (e) { console.error('Failed to delete temp file:', e); }

        const fileKey = req.file.filename;

        res.json({ message: 'File uploaded locally successfully', fileKey, fileData: base64Data });
    } catch (error) {
        res.status(500).json({ message: 'Local upload error', error: error.message });
    }
};

export const saveMetadata = async (req, res) => {
    try {
        const { s3Key, duration, deviceModel, eventType, audioBase64 } = req.body;

        const newSession = new AudioSession({
            userId: req.user.userId,
            s3Key, // Note: s3Key now actually means 'fileKey' globally for the MVP schema
            audioBase64,
            duration,
            deviceModel,
            eventType: eventType || 'unknown'
        });

        await newSession.save();

        res.status(201).json({ message: 'Metadata saved successfully', session: newSession });
    } catch (error) {
        res.status(500).json({ message: 'Error saving metadata', error: error.message });
    }
};

export const getMySessions = async (req, res) => {
    try {
        const sessions = await AudioSession.find({ userId: req.user.userId }).sort({ createdAt: -1 });
        res.json(sessions);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching sessions', error: error.message });
    }
};
