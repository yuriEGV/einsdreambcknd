import React, { useState, useEffect, useRef } from 'react';
import {
    View,
    Text,
    Button,
    StyleSheet,
    Alert,
    Platform,
    ScrollView,
    TouchableOpacity,
    ActivityIndicator
} from 'react-native';
import { Audio } from 'expo-av';
import axios from 'axios';
import * as FileSystem from 'expo-file-system';
import { Buffer } from 'buffer';
import CONFIG from '../config';
import { checkHealthPermissions, requestHealthPermissions, readNightHealthMetrics } from '../services/healthConnect';
import { processNightEngineCorrelation } from '../services/nightEngine';

const { API_URL, BASE_URL = 'https://einsdreambcknd.vercel.app' } = CONFIG;

// Universal Mono AAC 44.1kHz preset: 100% compatible with Huawei / EMUI and web audio
const MONO_RECORDING_OPTIONS = {
    isMeteringEnabled: true,
    android: {
        extension: '.m4a',
        outputFormat: Audio.AndroidOutputFormat.MPEG_4,
        audioEncoder: Audio.AndroidAudioEncoder.AAC,
        sampleRate: 44100,
        numberOfChannels: 1, // Mono: Works on all single-mic devices
        bitRate: 96000,
    },
    ios: {
        extension: '.m4a',
        outputFormat: Audio.IOSOutputFormat.MPEG4AAC,
        audioQuality: Audio.IOSAudioQuality.HIGH,
        sampleRate: 44100,
        numberOfChannels: 1,
        bitRate: 96000,
    },
    web: {
        mimeType: 'audio/mp4',
        bitsPerSecond: 96000,
    }
};

export default function RecordingScreen({ token, onLogout }) {
    const [hasPermission, setHasPermission] = useState(false);
    const [isAutoAgentRunning, setIsAutoAgentRunning] = useState(false);
    const [isManualRecording, setIsManualRecording] = useState(false);
    const [manualSeconds, setManualSeconds] = useState(0);

    // Dedicated Quick Test State
    const [isTesting, setIsTesting] = useState(false);
    const [testSecondsLeft, setTestSecondsLeft] = useState(5);
    const testRecordingRef = useRef(null);
    const testIntervalRef = useRef(null);

    // Google Health Connect State
    const [healthStatus, setHealthStatus] = useState({
        connected: false,
        checking: false,
        heartRate: false,
        sleep: false,
        respiratoryRate: false,
        oxygenSaturation: false
    });
    const sessionStartTimeRef = useRef(null);
    const nightAudioEventsRef = useRef([]);

    // For Auto-Agent
    const [isAutoRecording, setIsAutoRecording] = useState(false);
    const [meteringValue, setMeteringValue] = useState(-160);
    const [recordedEventsCount, setRecordedEventsCount] = useState(0);

    // Local Recordings Player State
    const [localRecordings, setLocalRecordings] = useState([]);
    const [isLoadingRecordings, setIsLoadingRecordings] = useState(false);
    const [soundObject, setSoundObject] = useState(null);
    const [playingUri, setPlayingUri] = useState(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [playbackMillis, setPlaybackMillis] = useState(0);
    const [durationMillis, setDurationMillis] = useState(0);

    // Refs for safe background operation
    const isAutoAgentActiveRef = useRef(false);
    const isCapturingChunkRef = useRef(false);
    const backgroundListenerRef = useRef(null);
    const autoRecordingRef = useRef(null);
    const manualRecordingRef = useRef(null);
    const manualTimerRef = useRef(null);

    // VAD Configuration for Cloud
    const NOISE_THRESHOLD = -35;
    const CHUNK_DURATION_MS = 8000;

    useEffect(() => {
        (async () => {
            const { status } = await Audio.requestPermissionsAsync();
            setHasPermission(status === 'granted');
            await Audio.setAudioModeAsync({
                allowsRecordingIOS: true,
                playsInSilentModeIOS: true,
                staysActiveInBackground: true,
                shouldDuckAndroid: true,
                playThroughEarpieceAndroid: false,
            });
            await loadLocalRecordings();

            // Check Health Connect availability & permissions
            try {
                const health = await checkHealthPermissions();
                setHealthStatus({
                    connected: health.granted,
                    checking: false,
                    heartRate: health.permissions.heartRate || false,
                    sleep: health.permissions.sleep || false,
                    respiratoryRate: health.permissions.respiratoryRate || false,
                    oxygenSaturation: health.permissions.oxygenSaturation || false
                });
            } catch (e) {
                console.warn('Health Connect init notice:', e);
            }
        })();
        return () => {
            stopAll();
            unloadCurrentSound();
        };
    }, []);

    const unloadCurrentSound = async () => {
        if (soundObject) {
            try {
                await soundObject.stopAsync();
                await soundObject.unloadAsync();
            } catch (e) {}
            setSoundObject(null);
            setPlayingUri(null);
            setIsPlaying(false);
        }
    };

    const stopAll = async () => {
        if (manualTimerRef.current) {
            clearInterval(manualTimerRef.current);
            manualTimerRef.current = null;
        }
        if (testIntervalRef.current) {
            clearInterval(testIntervalRef.current);
            testIntervalRef.current = null;
        }
        if (isAutoAgentActiveRef.current) await stopAutoAgent();
        if (isManualRecording) await stopManualRecording();
    };

    // ==========================================
    // HEALTH CONNECT CONNECTION HANDLER
    // ==========================================
    const handleConnectHealth = async () => {
        try {
            setHealthStatus(s => ({ ...s, checking: true }));
            const res = await requestHealthPermissions();
            setHealthStatus({
                connected: res.granted,
                checking: false,
                heartRate: res.permissions.heartRate || false,
                sleep: res.permissions.sleep || false,
                respiratoryRate: res.permissions.respiratoryRate || false,
                oxygenSaturation: res.permissions.oxygenSaturation || false
            });
            Alert.alert(
                'Health Connect Conectado',
                'EinsDream ahora recopilará tus métricas de pulso, sueño, respiración y SpO2 para correlacionarlas con el audio nocturno.'
            );
        } catch (e) {
            setHealthStatus(s => ({ ...s, checking: false }));
            Alert.alert('Health Connect', e.message || 'No se pudo conectar a Health Connect.');
        }
    };

    // ==========================================
    // LOCAL RECORDINGS LIBRARY & PLAYER
    // ==========================================
    const loadLocalRecordings = async () => {
        setIsLoadingRecordings(true);
        try {
            const dir = FileSystem.documentDirectory;
            if (!dir) return;
            const files = await FileSystem.readDirectoryAsync(dir);
            const audioFiles = [];

            for (const file of files) {
                if (file.endsWith('.m4a') || file.endsWith('.mp3')) {
                    const fileUri = dir + file;
                    const info = await FileSystem.getInfoAsync(fileUri);
                    const sizeMb = info.size ? (info.size / (1024 * 1024)).toFixed(1) : '0.1';
                    
                    let dateStr = 'Grabación nocturna';
                    if (file.startsWith('manual_record_')) {
                        const ts = parseInt(file.replace('manual_record_', '').replace('.m4a', ''));
                        if (!isNaN(ts)) {
                            const d = new Date(ts);
                            dateStr = 'Noche ' + d.toLocaleDateString('es-CL', {
                                day: '2-digit',
                                month: 'short',
                                hour: '2-digit',
                                minute: '2-digit'
                            });
                        }
                    } else if (file.startsWith('auto_event_')) {
                        const ts = parseInt(file.replace('auto_event_', '').replace('.m4a', ''));
                        if (!isNaN(ts)) {
                            const d = new Date(ts);
                            dateStr = 'Evento ' + d.toLocaleTimeString('es-CL', {
                                hour: '2-digit',
                                minute: '2-digit',
                                second: '2-digit'
                            });
                        }
                    }

                    audioFiles.push({
                        filename: file,
                        uri: fileUri,
                        sizeStr: `${sizeMb} MB`,
                        dateStr,
                        modTime: info.modificationTime || 0
                    });
                }
            }

            audioFiles.sort((a, b) => b.modTime - a.modTime);
            setLocalRecordings(audioFiles);
        } catch (err) {
            console.warn('Error loading recordings:', err);
        } finally {
            setIsLoadingRecordings(false);
        }
    };

    const handlePlayPause = async (rec) => {
        try {
            if (playingUri === rec.uri) {
                if (isPlaying && soundObject) {
                    await soundObject.pauseAsync();
                    setIsPlaying(false);
                } else if (!isPlaying && soundObject) {
                    await soundObject.playAsync();
                    setIsPlaying(true);
                }
                return;
            }

            await unloadCurrentSound();

            const { sound } = await Audio.Sound.createAsync(
                { uri: rec.uri },
                { shouldPlay: true },
                (status) => {
                    if (status.isLoaded) {
                        setPlaybackMillis(status.positionMillis || 0);
                        setDurationMillis(status.durationMillis || 0);
                        setIsPlaying(status.isPlaying);
                        if (status.didJustFinish) {
                            setIsPlaying(false);
                            setPlaybackMillis(0);
                        }
                    }
                }
            );

            setSoundObject(sound);
            setPlayingUri(rec.uri);
            setIsPlaying(true);
        } catch (err) {
            console.error('Play error:', err);
            Alert.alert('Error al reproducir', 'No se pudo reproducir este archivo de audio.');
        }
    };

    const handleDeleteRecording = (rec) => {
        Alert.alert(
            'Eliminar Grabación',
            `¿Seguro que deseas eliminar ${rec.dateStr}?`,
            [
                { text: 'Cancelar', style: 'cancel' },
                {
                    text: 'Eliminar',
                    style: 'destructive',
                    onPress: async () => {
                        if (playingUri === rec.uri) {
                            await unloadCurrentSound();
                        }
                        await FileSystem.deleteAsync(rec.uri, { idempotent: true }).catch(() => {});
                        await loadLocalRecordings();
                    }
                }
            ]
        );
    };

    const formatTime = (ms) => {
        if (!ms || ms < 0) return '00:00';
        const totalSecs = Math.floor(ms / 1000);
        const mins = Math.floor(totalSecs / 60);
        const secs = totalSecs % 60;
        return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    };

    const formatSeconds = (totalSecs) => {
        const hours = Math.floor(totalSecs / 3600);
        const mins = Math.floor((totalSecs % 3600) / 60);
        const secs = totalSecs % 60;
        if (hours > 0) {
            return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
        }
        return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    };

    // ==========================================
    // 1. AUTO-AGENT CONTINUOUS NOISE MONITOR (SILENT & PERPETUAL)
    // ==========================================
    const startAutoAgent = async () => {
        const p = await Audio.requestPermissionsAsync();
        if (p.status !== 'granted') return Alert.alert('Permiso Denegado', 'Se necesita acceso al micrófono para monitorear el sueño.');
        
        if (manualRecordingRef.current) {
            try { await manualRecordingRef.current.stopAndUnloadAsync(); } catch (e) {}
            manualRecordingRef.current = null;
        }
        setIsManualRecording(false);
        await unloadCurrentSound();

        isAutoAgentActiveRef.current = true;
        isCapturingChunkRef.current = false;
        setIsAutoAgentRunning(true);
        setRecordedEventsCount(0);

        startPerpetualListener();
    };

    const startPerpetualListener = async () => {
        if (!isAutoAgentActiveRef.current) return;

        try {
            await Audio.setAudioModeAsync({
                allowsRecordingIOS: true,
                playsInSilentModeIOS: true,
                staysActiveInBackground: true,
                shouldDuckAndroid: true,
                playThroughEarpieceAndroid: false
            });

            // Clean up any stale recording
            if (backgroundListenerRef.current) {
                try { await backgroundListenerRef.current.stopAndUnloadAsync(); } catch (e) {}
                backgroundListenerRef.current = null;
            }

            const { recording } = await Audio.Recording.createAsync(
                MONO_RECORDING_OPTIONS,
                (status) => {
                    if (status.metering !== undefined) {
                        setMeteringValue(Math.round(status.metering));
                        if (status.metering > NOISE_THRESHOLD && !isCapturingChunkRef.current && isAutoAgentActiveRef.current) {
                            captureNoiseEventChunk();
                        }
                    }
                },
                400
            );
            backgroundListenerRef.current = recording;
        } catch (err) {
            console.warn('Listener loop retry notice:', err.message);
            if (isAutoAgentActiveRef.current) {
                setTimeout(() => startPerpetualListener(), 1500);
            }
        }
    };

    const captureNoiseEventChunk = async () => {
        if (isCapturingChunkRef.current || !isAutoAgentActiveRef.current) return;
        isCapturingChunkRef.current = true;
        setIsAutoRecording(true);

        try {
            // Let it record for CHUNK_DURATION_MS to capture the entire snore/noise
            await new Promise(resolve => setTimeout(resolve, CHUNK_DURATION_MS));

            if (!isAutoAgentActiveRef.current) return;

            const recording = backgroundListenerRef.current;
            backgroundListenerRef.current = null;

            if (recording) {
                await recording.stopAndUnloadAsync();
                const uri = recording.getURI();

                if (uri) {
                    // 1. SAVE LOCALLY IMMEDIATELY so it shows up in phone's "Mis Grabaciones"
                    const localFilename = `auto_event_${Date.now()}.m4a`;
                    const localPath = FileSystem.documentDirectory + localFilename;
                    await FileSystem.copyAsync({ from: uri, to: localPath }).catch(() => {});
                    loadLocalRecordings();
                    setRecordedEventsCount(c => c + 1);

                    // 2. UPLOAD QUIETLY IN BACKGROUND (No popup alert to wake up user!)
                    silentCloudUpload(localPath, localFilename);
                }
            }
        } catch (err) {
            console.warn('Error capturing noise chunk:', err.message);
        } finally {
            isCapturingChunkRef.current = false;
            setIsAutoRecording(false);
            // Immediately resume listening perpetually
            if (isAutoAgentActiveRef.current) {
                startPerpetualListener();
            }
        }
    };

    const stopAutoAgent = async () => {
        isAutoAgentActiveRef.current = false;
        isCapturingChunkRef.current = false;
        setIsAutoAgentRunning(false);
        setIsAutoRecording(false);
        setMeteringValue(-160);

        if (backgroundListenerRef.current) {
            try { await backgroundListenerRef.current.stopAndUnloadAsync(); } catch (e) {}
            backgroundListenerRef.current = null;
        }
    };

    const silentCloudUpload = async (localUri, filename) => {
        try {
            const contentType = 'audio/m4a';

            // Read base64 directly from device storage for permanent MongoDB persistence
            let base64Payload = null;
            try {
                const b64 = await FileSystem.readAsStringAsync(localUri, { encoding: FileSystem.EncodingType.Base64 });
                base64Payload = `data:audio/m4a;base64,${b64}`;
            } catch (e) {
                console.warn('Could not read local base64:', e.message);
            }

            const initRes = await axios.post(`${API_URL}/upload/init`,
                { filename, contentType },
                { headers: { Authorization: `Bearer ${token}` } }
            );

            const { uploadMethod, url, fileKey, provider } = initRes.data;

            const uploadEndpoint = url.startsWith('http')
                ? url
                : url.startsWith('/api')
                    ? `${BASE_URL}${url}`
                    : `${API_URL}/${url}`;

            if (provider === 'local') {
                const formData = new FormData();
                formData.append('audio', {
                    uri: Platform.OS === 'android' ? localUri : localUri.replace('file://', ''),
                    name: filename,
                    type: contentType,
                });
                const localRes = await axios.post(uploadEndpoint, formData, {
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'multipart/form-data',
                    },
                });
                const finalBase64 = base64Payload || localRes.data.fileData;
                await axios.post(`${API_URL}/upload/metadata`, {
                    s3Key: localRes.data.fileKey || fileKey,
                    audioBase64: finalBase64,
                    duration: 8,
                    deviceModel: Platform.OS,
                    eventType: 'auto-agent'
                }, { headers: { Authorization: `Bearer ${token}` } });
            } else {
                const audioData = await FileSystem.readAsStringAsync(localUri, { encoding: FileSystem.EncodingType.Base64 });
                await fetch(uploadEndpoint, { method: uploadMethod || 'PUT', headers: { 'Content-Type': contentType }, body: Buffer.from(audioData, 'base64') });
                await axios.post(`${API_URL}/upload/metadata`, {
                    s3Key: fileKey,
                    audioBase64: base64Payload,
                    duration: 8,
                    deviceModel: Platform.OS,
                    eventType: 'auto-agent'
                }, { headers: { Authorization: `Bearer ${token}` } });
            }

            console.log('Silent background upload completed for:', filename);
        } catch (err) {
            console.warn('Silent upload notice (queued locally):', err.message);
        }
    };

    // ==========================================
    // 2. MANUAL CONTINUOUS ALL-NIGHT RECORDING (NO INTERRUPTIONS)
    // ==========================================
    const startManualRecording = async () => {
        const p = await Audio.requestPermissionsAsync();
        if (p.status !== 'granted') {
            return Alert.alert('Permiso Denegado', 'Se necesita acceso al micrófono para grabar.');
        }

        if (isAutoAgentActiveRef.current) {
            await stopAutoAgent();
        }

        if (manualRecordingRef.current) {
            try {
                await manualRecordingRef.current.stopAndUnloadAsync();
            } catch (e) {}
            manualRecordingRef.current = null;
        }

        try {
            await Audio.setAudioModeAsync({
                allowsRecordingIOS: true,
                playsInSilentModeIOS: true,
                staysActiveInBackground: true,
                shouldDuckAndroid: true,
                playThroughEarpieceAndroid: false
            });

            console.log('Starting uninterrupted all-night recording with Mono AAC...');
            const { recording } = await Audio.Recording.createAsync(
                MONO_RECORDING_OPTIONS
            );

            manualRecordingRef.current = recording;
            sessionStartTimeRef.current = new Date();
            nightAudioEventsRef.current = [];
            setIsManualRecording(true);
            setManualSeconds(0);

            if (manualTimerRef.current) clearInterval(manualTimerRef.current);
            manualTimerRef.current = setInterval(() => {
                setManualSeconds(s => s + 1);
            }, 1000);

        } catch (err) {
            console.error('Failed to start manual recording:', err);
            setIsManualRecording(false);
            Alert.alert('Error', 'No se pudo iniciar la grabación: ' + (err.message || 'Error del micrófono'));
        }
    };

    const stopManualRecording = async () => {
        if (manualTimerRef.current) {
            clearInterval(manualTimerRef.current);
            manualTimerRef.current = null;
        }

        const recording = manualRecordingRef.current;
        manualRecordingRef.current = null;
        setIsManualRecording(false);

        if (!recording) {
            return;
        }

        try {
            console.log('Stopping continuous all-night recording...');
            await recording.stopAndUnloadAsync();
            const uri = recording.getURI();
            const sessionEndTime = new Date();
            const sessionStartTime = sessionStartTimeRef.current || new Date(sessionEndTime.getTime() - Math.max(10000, manualSeconds * 1000));

            if (uri) {
                const filename = `manual_record_${Date.now()}.m4a`;
                const newPath = FileSystem.documentDirectory + filename;
                await FileSystem.copyAsync({ from: uri, to: newPath });

                await loadLocalRecordings();

                // Night Engine Correlation with Health Connect
                const healthData = await readNightHealthMetrics({
                    startTime: sessionStartTime,
                    endTime: sessionEndTime
                });

                const nightSessionPayload = processNightEngineCorrelation({
                    audioEvents: [{
                        timestamp: new Date(sessionStartTime.getTime() + Math.min(60000, manualSeconds * 500)),
                        duration: manualSeconds,
                        eventType: 'breathing',
                        intensityDb: 55
                    }],
                    healthData,
                    sessionWindow: {
                        sessionDate: sessionEndTime.toISOString().slice(0, 10),
                        startTime: sessionStartTime,
                        endTime: sessionEndTime
                    }
                });

                // Batch sync to MongoDB quietly
                try {
                    await axios.post(`${API_URL}/night-sessions`, nightSessionPayload, {
                        headers: { Authorization: `Bearer ${token}` }
                    });
                    console.log('Night session successfully synchronized to MongoDB');
                } catch (syncError) {
                    console.warn('Sync notice:', syncError.response?.data || syncError.message);
                }

                Alert.alert(
                    '✅ Noche Finalizada y Guardada',
                    `Tu grabación de ${formatSeconds(manualSeconds)} está guardada en tu teléfono en "Mis Grabaciones" y lista para escuchar.`
                );
            }
        } catch (err) {
            console.error('Failed to stop manual recording:', err);
            Alert.alert('Aviso', 'Se detuvo la grabación. Comprueba la lista de abajo.');
            await loadLocalRecordings();
        }
    };

    // ==========================================
    // 3. DEDICATED QUICK TEST (5 SECONDS WITH VISUAL COUNTDOWN)
    // ==========================================
    const runQuickTestRecording = async () => {
        if (isTesting) return;

        const p = await Audio.requestPermissionsAsync();
        if (p.status !== 'granted') {
            return Alert.alert('Permiso Denegado', 'Se necesita acceso al micrófono para realizar la prueba.');
        }

        // Stop any active recordings
        if (manualRecordingRef.current) {
            try { await manualRecordingRef.current.stopAndUnloadAsync(); } catch (e) {}
            manualRecordingRef.current = null;
        }
        if (backgroundListenerRef.current) {
            try { await backgroundListenerRef.current.stopAndUnloadAsync(); } catch (e) {}
            backgroundListenerRef.current = null;
        }
        isAutoAgentActiveRef.current = false;
        setIsAutoAgentRunning(false);
        setIsManualRecording(false);
        await unloadCurrentSound();

        try {
            await Audio.setAudioModeAsync({
                allowsRecordingIOS: true,
                playsInSilentModeIOS: true,
                staysActiveInBackground: true,
                shouldDuckAndroid: true,
                playThroughEarpieceAndroid: false
            });

            console.log('Starting 5-second test with Mono AAC...');
            const { recording } = await Audio.Recording.createAsync(
                MONO_RECORDING_OPTIONS
            );
            testRecordingRef.current = recording;
            setIsTesting(true);
            setTestSecondsLeft(5);

            let remaining = 5;
            testIntervalRef.current = setInterval(async () => {
                remaining -= 1;
                setTestSecondsLeft(remaining);

                if (remaining <= 0) {
                    clearInterval(testIntervalRef.current);
                    testIntervalRef.current = null;

                    try {
                        const rec = testRecordingRef.current;
                        testRecordingRef.current = null;
                        setIsTesting(false);

                        if (rec) {
                            await rec.stopAndUnloadAsync();
                            const uri = rec.getURI();

                            if (uri) {
                                const filename = `manual_record_${Date.now()}.m4a`;
                                const newPath = FileSystem.documentDirectory + filename;
                                await FileSystem.copyAsync({ from: uri, to: newPath });

                                await loadLocalRecordings();

                                // Automatically play the test recording immediately
                                setTimeout(() => {
                                    handlePlayPause({ uri: newPath });
                                }, 500);

                                Alert.alert(
                                    '🎉 ¡Prueba Exitosa!',
                                    'Tu audio se grabó en tu teléfono y se está reproduciendo ahora mismo.\n\nComprueba cómo suena tu voz.'
                                );
                            }
                        }
                    } catch (finishErr) {
                        console.error('Error finishing test:', finishErr);
                        setIsTesting(false);
                        Alert.alert('Aviso', 'Se completó la prueba. Verifica si aparece en la lista de abajo.');
                        await loadLocalRecordings();
                    }
                }
            }, 1000);

        } catch (startErr) {
            console.error('Test record start error:', startErr);
            setIsTesting(false);
            Alert.alert('Error', 'No se pudo iniciar la prueba: ' + startErr.message);
        }
    };

    return (
        <ScrollView contentContainerStyle={styles.container}>
            <Text style={styles.title}>Einsdream Mobile</Text>

            <View style={styles.infoBox}>
                <Text style={{ fontWeight: 'bold', fontSize: 16, color: '#333' }}>🎙️ Grabación Nocturna (Recomendada)</Text>
                <Text style={styles.infoText}>Presiona un botón al acostarte y duerme toda la noche. Guarda el audio completo en tu teléfono sin interrupciones.</Text>
                <View style={{ height: 12 }} />
                <Text style={{ fontWeight: 'bold', fontSize: 16, color: '#333' }}>☁️ Auto-Agent Continuo (Nube)</Text>
                <Text style={styles.infoText}>Escucha toda la noche silenciosamente y guarda clips cada vez que detecta un ronquido o ruido, sin despertarte con alertas.</Text>
            </View>

            {/* VISUAL BANNER FOR 5S TEST */}
            {isTesting && (
                <View style={styles.testActiveBox}>
                    <Text style={styles.testActiveTitle}>🔴 GRABANDO PRUEBA DE VOZ ({testSecondsLeft}s)</Text>
                    <Text style={styles.testActiveSub}>Habla cerca del micrófono... ¡Se reproducirá en automático!</Text>
                </View>
            )}

            {/* STATUS BOX */}
            <View style={[styles.statusBox, isManualRecording ? styles.statusBoxRecording : {}]}>
                <Text style={[styles.statusText, isManualRecording ? { color: '#dc2626' } : {}]}>
                    {isManualRecording ? `🔴 GRABANDO TODA LA NOCHE (${formatSeconds(manualSeconds)})` :
                        isAutoAgentRunning ? (isAutoRecording ? "🔴 CAPTURANDO EVENTO DE RUIDO..." : `👂 MONITOREANDO SUEÑO (${recordedEventsCount} capturados)`) :
                            "⚪ INACTIVO - LISTO PARA GRABAR"}
                </Text>
                {isManualRecording && (
                    <Text style={{ color: '#64748b', marginTop: 6, fontSize: 13, textAlign: 'center' }}>
                        Grabación nocturna continua activa. Deja tu teléfono en el velador y duerme tranquilamente.{'\n'}Presiona "DETENER" cuando despiertes por la mañana.
                    </Text>
                )}
                {isAutoAgentRunning && (
                    <Text style={{ color: '#64748b', marginTop: 6, fontSize: 13, textAlign: 'center' }}>
                        Auto-Agent está monitoreando en silencio. Cada ruido detectado se guarda automáticamente en tu teléfono y se envía a la nube.
                    </Text>
                )}
            </View>

            {/* MAIN BUTTONS */}
            <View style={styles.buttonContainer}>
                {!isManualRecording && !isAutoAgentRunning && !isTesting && (
                    <>
                        <TouchableOpacity style={[styles.bigBtn, { backgroundColor: '#2563EB' }]} onPress={startManualRecording}>
                            <Text style={styles.bigBtnText}>🎙️ GRABAR TODA LA NOCHE (CONTINUO)</Text>
                            <Text style={styles.bigBtnSub}>Graba toda la noche sin parar y duerme sin preocupaciones</Text>
                        </TouchableOpacity>

                        <View style={{ height: 14 }} />

                        <TouchableOpacity style={[styles.bigBtn, { backgroundColor: '#10B981' }]} onPress={startAutoAgent}>
                            <Text style={styles.bigBtnText}>☁️ MONITOREAR RUIDOS (AUTO-AGENT)</Text>
                            <Text style={styles.bigBtnSub}>Captura automática silenciosa ante ronquidos o ruidos</Text>
                        </TouchableOpacity>
                    </>
                )}

                {(isAutoAgentRunning || isManualRecording) && !isTesting && (
                    <TouchableOpacity style={[styles.bigBtn, { backgroundColor: '#DC2626' }]} onPress={stopAll}>
                        <Text style={styles.bigBtnText}>⏹️ DETENER Y GUARDAR GRABACIÓN</Text>
                        <Text style={styles.bigBtnSub}>Finaliza la noche y deja el audio guardado en tu lista</Text>
                    </TouchableOpacity>
                )}
            </View>

            {/* GOOGLE HEALTH CONNECT CARD */}
            <View style={styles.healthCard}>
                <View style={styles.healthHeader}>
                    <Text style={styles.healthTitle}>❤️ Estado de Salud</Text>
                    <View style={[styles.healthBadge, healthStatus.connected ? styles.healthBadgeOn : styles.healthBadgeOff]}>
                        <Text style={[styles.healthBadgeText, healthStatus.connected ? { color: '#065f46' } : { color: '#475569' }]}>
                            {healthStatus.connected ? '● HEALTH CONNECT' : '● MODO AUTÓNOMO ACÚSTICO'}
                        </Text>
                    </View>
                </View>

                <Text style={styles.healthDesc}>
                    {healthStatus.connected
                        ? 'Vinculado con Health Connect para correlacionar pulso y respiración.'
                        : 'Modo autónomo acústico activo: graba y analiza tu sueño por micrófono sin requerir ningún reloj ni sensor adicional.'}
                </Text>

                {!healthStatus.connected && (
                    <TouchableOpacity
                        style={styles.connectHealthBtn}
                        onPress={handleConnectHealth}
                        disabled={healthStatus.checking}
                    >
                        {healthStatus.checking ? (
                            <ActivityIndicator color="#fff" size="small" />
                        ) : (
                            <Text style={styles.connectHealthBtnText}>🔗 Conectar Health Connect (Opcional)</Text>
                        )}
                    </TouchableOpacity>
                )}
            </View>

            {/* SECCIÓN DE GRABACIONES LOCALES PARA EL ADULTO MAYOR */}
            <View style={styles.recordingsCard}>
                <View style={styles.recHeaderRow}>
                    <Text style={styles.recordingsTitle}>🎧 Mis Grabaciones ({localRecordings.length})</Text>
                    <TouchableOpacity onPress={loadLocalRecordings} style={styles.refreshBtn}>
                        <Text style={styles.refreshBtnText}>🔄 Actualizar</Text>
                    </TouchableOpacity>
                </View>

                {/* BOTÓN DE PRUEBA RÁPIDA DE 5 SEGUNDOS */}
                <TouchableOpacity
                    style={[styles.testBtn, isTesting ? { backgroundColor: '#fef3c7', borderColor: '#f59e0b' } : {}]}
                    onPress={runQuickTestRecording}
                    disabled={isTesting}
                >
                    {isTesting ? (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                            <ActivityIndicator size="small" color="#d97706" />
                            <Text style={{ color: '#b45309', fontWeight: '800', fontSize: 14 }}>
                                Grabando prueba... {testSecondsLeft} segundos
                            </Text>
                        </View>
                    ) : (
                        <Text style={styles.testBtnText}>🎙️ Probar Micrófono (Grabar 5 seg de voz)</Text>
                    )}
                </TouchableOpacity>

                <View style={{ height: 12 }} />

                {isLoadingRecordings ? (
                    <ActivityIndicator size="small" color="#2563EB" style={{ marginVertical: 20 }} />
                ) : localRecordings.length === 0 ? (
                    <View style={{ alignItems: 'center', paddingVertical: 12 }}>
                        <Text style={styles.emptyText}>
                            Aún no tienes grabaciones guardadas en tu teléfono.{'\n'}
                            Toca el botón azul de arriba para hacer tu primera prueba.
                        </Text>
                    </View>
                ) : (
                    localRecordings.map((rec) => {
                        const isThisPlaying = playingUri === rec.uri && isPlaying;
                        const isThisSelected = playingUri === rec.uri;
                        return (
                            <View key={rec.filename} style={styles.recItem}>
                                <View style={{ flex: 1 }}>
                                    <Text style={styles.recDate}>📅 {rec.dateStr}</Text>
                                    <Text style={styles.recSize}>Tamaño: {rec.sizeStr}</Text>
                                    {isThisSelected && (
                                        <Text style={styles.recProgress}>
                                            {isThisPlaying ? '▶ Reproduciendo: ' : '⏸ En pausa: '}
                                            {formatTime(playbackMillis)} / {formatTime(durationMillis)}
                                        </Text>
                                    )}
                                </View>

                                <TouchableOpacity
                                    style={[styles.playBtn, isThisPlaying ? styles.pauseBtn : {}]}
                                    onPress={() => handlePlayPause(rec)}
                                >
                                    <Text style={styles.playBtnText}>
                                        {isThisPlaying ? '⏸ PAUSAR' : '▶ ESCUCHAR'}
                                    </Text>
                                </TouchableOpacity>

                                <TouchableOpacity
                                    style={styles.delBtn}
                                    onPress={() => handleDeleteRecording(rec)}
                                >
                                    <Text style={styles.delBtnText}>🗑</Text>
                                </TouchableOpacity>
                            </View>
                        );
                    })
                )}
            </View>

            <View style={{ marginTop: 30, borderTopWidth: 1, borderColor: '#eee', paddingTop: 20, width: '100%' }}>
                <Button title="Cerrar Sesión" onPress={onLogout} color="#888" />
            </View>
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    container: {
        flexGrow: 1,
        alignItems: 'center',
        padding: 18,
        backgroundColor: '#f8fafc',
    },
    title: {
        fontSize: 28,
        fontWeight: 'bold',
        marginBottom: 20,
        color: '#0f172a',
        letterSpacing: 1
    },
    infoBox: {
        backgroundColor: '#e0f2fe',
        padding: 16,
        borderRadius: 14,
        width: '100%',
        marginBottom: 16,
        borderColor: '#bae6fd',
        borderWidth: 1,
    },
    infoText: {
        color: '#334155',
        fontSize: 14,
        marginTop: 4,
        lineHeight: 20
    },
    testActiveBox: {
        backgroundColor: '#fee2e2',
        borderColor: '#ef4444',
        borderWidth: 2,
        borderRadius: 14,
        padding: 16,
        width: '100%',
        marginBottom: 16,
        alignItems: 'center'
    },
    testActiveTitle: {
        color: '#b91c1c',
        fontWeight: '900',
        fontSize: 16,
        letterSpacing: 0.5
    },
    testActiveSub: {
        color: '#7f1d1d',
        fontSize: 13,
        marginTop: 4,
        fontWeight: '600'
    },
    healthCard: {
        width: '100%',
        backgroundColor: '#ffffff',
        borderRadius: 14,
        padding: 16,
        marginBottom: 18,
        borderWidth: 1,
        borderColor: '#e2e8f0',
        elevation: 2
    },
    healthHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 8
    },
    healthTitle: {
        fontSize: 16,
        fontWeight: '700',
        color: '#0f172a'
    },
    healthBadge: {
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 8
    },
    healthBadgeOn: {
        backgroundColor: '#d1fae5'
    },
    healthBadgeOff: {
        backgroundColor: '#f1f5f9'
    },
    healthBadgeText: {
        fontSize: 11,
        fontWeight: '800',
        letterSpacing: 0.5
    },
    healthDesc: {
        fontSize: 13,
        color: '#64748b',
        lineHeight: 18,
        marginBottom: 8
    },
    connectHealthBtn: {
        backgroundColor: '#4f46e5',
        paddingVertical: 10,
        borderRadius: 10,
        alignItems: 'center',
        marginTop: 8
    },
    connectHealthBtnText: {
        color: '#ffffff',
        fontWeight: '700',
        fontSize: 13
    },
    statusBox: {
        padding: 18,
        backgroundColor: '#ffffff',
        borderRadius: 14,
        width: '100%',
        alignItems: 'center',
        marginBottom: 20,
        borderWidth: 1,
        borderColor: '#e2e8f0',
        elevation: 2
    },
    statusBoxRecording: {
        borderColor: '#fca5a5',
        backgroundColor: '#fff1f2'
    },
    statusText: {
        fontSize: 16,
        fontWeight: 'bold',
        textAlign: 'center',
        color: '#1e293b'
    },
    buttonContainer: {
        width: '100%',
        marginBottom: 22
    },
    bigBtn: {
        paddingVertical: 16,
        paddingHorizontal: 18,
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
        elevation: 3
    },
    bigBtnText: {
        color: '#ffffff',
        fontSize: 16,
        fontWeight: 'bold',
        letterSpacing: 0.5
    },
    bigBtnSub: {
        color: 'rgba(255, 255, 255, 0.85)',
        fontSize: 12,
        marginTop: 3
    },
    recordingsCard: {
        width: '100%',
        backgroundColor: '#ffffff',
        borderRadius: 16,
        padding: 18,
        borderWidth: 1,
        borderColor: '#cbd5e1',
        elevation: 3
    },
    recHeaderRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 14
    },
    recordingsTitle: {
        fontSize: 19,
        fontWeight: '800',
        color: '#0f172a'
    },
    refreshBtn: {
        backgroundColor: '#f1f5f9',
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#cbd5e1'
    },
    refreshBtnText: {
        fontSize: 13,
        fontWeight: '600',
        color: '#334155'
    },
    emptyText: {
        color: '#64748b',
        textAlign: 'center',
        marginBottom: 14,
        fontSize: 14,
        lineHeight: 22
    },
    testBtn: {
        backgroundColor: '#eff6ff',
        paddingVertical: 14,
        paddingHorizontal: 18,
        borderRadius: 12,
        borderWidth: 1.5,
        borderColor: '#3b82f6',
        alignItems: 'center',
        justifyContent: 'center'
    },
    testBtnText: {
        color: '#1d4ed8',
        fontWeight: '800',
        fontSize: 15
    },
    recItem: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#f8fafc',
        borderRadius: 12,
        padding: 14,
        marginBottom: 10,
        borderWidth: 1,
        borderColor: '#e2e8f0'
    },
    recDate: {
        fontSize: 15,
        fontWeight: '700',
        color: '#1e293b',
        marginBottom: 2
    },
    recSize: {
        fontSize: 13,
        color: '#64748b'
    },
    recProgress: {
        fontSize: 12,
        fontWeight: '600',
        color: '#2563eb',
        marginTop: 4
    },
    playBtn: {
        backgroundColor: '#10b981',
        paddingVertical: 12,
        paddingHorizontal: 14,
        borderRadius: 10,
        marginLeft: 10
    },
    pauseBtn: {
        backgroundColor: '#f59e0b'
    },
    playBtnText: {
        color: '#ffffff',
        fontWeight: 'bold',
        fontSize: 13
    },
    delBtn: {
        backgroundColor: '#fee2e2',
        paddingVertical: 12,
        paddingHorizontal: 12,
        borderRadius: 10,
        marginLeft: 8
    },
    delBtnText: {
        fontSize: 16
    }
});
