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

const { API_URL, BASE_URL = 'https://einsdreambcknd.vercel.app' } = CONFIG;

export default function RecordingScreen({ token, onLogout }) {
    const [hasPermission, setHasPermission] = useState(false);
    const [isAutoAgentRunning, setIsAutoAgentRunning] = useState(false);
    const [isManualRecording, setIsManualRecording] = useState(false);
    const [manualSeconds, setManualSeconds] = useState(0);

    // For Auto-Agent
    const [isAutoRecording, setIsAutoRecording] = useState(false);
    const [meteringValue, setMeteringValue] = useState(-160);
    const [lastNoiseTime, setLastNoiseTime] = useState(Date.now());

    // Local Recordings Player State
    const [localRecordings, setLocalRecordings] = useState([]);
    const [isLoadingRecordings, setIsLoadingRecordings] = useState(false);
    const [soundObject, setSoundObject] = useState(null);
    const [playingUri, setPlayingUri] = useState(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [playbackMillis, setPlaybackMillis] = useState(0);
    const [durationMillis, setDurationMillis] = useState(0);

    const backgroundListenerRef = useRef(null);
    const autoRecordingRef = useRef(null);
    const manualRecordingRef = useRef(null);
    const manualTimerRef = useRef(null);

    const autoRecordingTimeoutRef = useRef(null);
    const autoStopTimeoutRef = useRef(null);

    // VAD Configuration for Cloud
    const NOISE_THRESHOLD = -35;
    const MAX_AUTO_DURATION = 10000;
    const SILENCE_TIMEOUT = 3000;

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
        if (isAutoAgentRunning) await stopAutoAgent();
        if (isManualRecording) await stopManualRecording();
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
                            dateStr = d.toLocaleDateString('es-CL', {
                                day: '2-digit',
                                month: 'short',
                                hour: '2-digit',
                                minute: '2-digit'
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
            `¿Seguro que deseas eliminar la grabación del ${rec.dateStr}?`,
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
        const mins = Math.floor(totalSecs / 60);
        const secs = totalSecs % 60;
        return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    };

    // ==========================================
    // 1. AUTO-AGENT CLOUD RECORDING
    // ==========================================
    const startAutoAgent = async () => {
        const p = await Audio.requestPermissionsAsync();
        if (p.status !== 'granted') return Alert.alert('Permiso Denegado', 'Se necesita acceso al micrófono para monitorear el sueño.');
        
        // Stop any manual recording first
        if (manualRecordingRef.current) {
            try { await manualRecordingRef.current.stopAndUnloadAsync(); } catch (e) {}
            manualRecordingRef.current = null;
        }
        setIsManualRecording(false);

        try {
            await Audio.setAudioModeAsync({
                allowsRecordingIOS: true,
                playsInSilentModeIOS: true,
                staysActiveInBackground: true,
                shouldDuckAndroid: true,
            });

            setIsAutoAgentRunning(true);
            const { recording } = await Audio.Recording.createAsync(
                Audio.RecordingOptionsPresets.LOW_QUALITY,
                (status) => {
                    if (status.metering !== undefined) {
                        setMeteringValue(Math.round(status.metering));
                        if (status.metering > NOISE_THRESHOLD) {
                            stopVADListener().then(() => startAutoChunkRecording());
                        }
                    }
                },
                500
            );
            backgroundListenerRef.current = recording;
        } catch (err) {
            console.error(err);
            setIsAutoAgentRunning(false);
            Alert.alert('Error', 'No se pudo iniciar el escucha de ruido automático.');
        }
    };

    const stopVADListener = async () => {
        if (!backgroundListenerRef.current) return;
        try {
            await backgroundListenerRef.current.stopAndUnloadAsync();
        } catch (e) {}
        backgroundListenerRef.current = null;
    };

    const stopAutoAgent = async () => {
        setIsAutoAgentRunning(false);
        setMeteringValue(-160);
        await stopVADListener();
        if (isAutoRecording) {
            await stopAutoChunkRecording(true);
        }
    };

    const startAutoChunkRecording = async () => {
        try {
            setLastNoiseTime(Date.now());
            setIsAutoRecording(true);
            const { recording } = await Audio.Recording.createAsync(
                Audio.RecordingOptionsPresets.LOW_QUALITY,
                (status) => {
                    if (status.metering !== undefined) {
                        setMeteringValue(Math.round(status.metering));
                        if (status.metering > NOISE_THRESHOLD) setLastNoiseTime(Date.now());
                    }
                },
                300
            );
            autoRecordingRef.current = recording;

            autoRecordingTimeoutRef.current = setTimeout(() => {
                stopAutoChunkRecording();
            }, MAX_AUTO_DURATION);

            autoStopTimeoutRef.current = setInterval(() => {
                if (Date.now() - lastNoiseTime > SILENCE_TIMEOUT) stopAutoChunkRecording();
            }, 500);

        } catch (err) {
            console.error(err);
            setIsAutoRecording(false);
        }
    };

    const stopAutoChunkRecording = async (isManualStop = false) => {
        if (!autoRecordingRef.current) return;
        try {
            setIsAutoRecording(false);
            if (autoRecordingTimeoutRef.current) clearTimeout(autoRecordingTimeoutRef.current);
            if (autoStopTimeoutRef.current) clearInterval(autoStopTimeoutRef.current);

            const recording = autoRecordingRef.current;
            autoRecordingRef.current = null;

            await recording.stopAndUnloadAsync();
            const uri = recording.getURI();

            if (uri) uploadAudio(uri);

            if (isAutoAgentRunning && !isManualStop) {
                setTimeout(() => {
                    startAutoAgent();
                }, 800);
            }
        } catch (err) {
            console.error('Failed to stop chunk or restart:', err);
            if (isAutoAgentRunning && !isManualStop) startAutoAgent();
        }
    };

    const uploadAudio = async (uri) => {
        try {
            const filename = uri.split('/').pop() || `event_${Date.now()}.m4a`;
            const contentType = Platform.OS === 'ios' ? 'audio/x-m4a' : 'audio/m4a';

            const initRes = await axios.post(`${API_URL}/upload/init`,
                { filename, contentType },
                { headers: { Authorization: `Bearer ${token}` } }
            );

            const { uploadMethod, url, fileKey, provider } = initRes.data;

            // Correct target URL: Avoid double /api/api
            const uploadEndpoint = url.startsWith('http')
                ? url
                : url.startsWith('/api')
                    ? `${BASE_URL}${url}`
                    : `${API_URL}/${url}`;

            if (provider === 'local') {
                const formData = new FormData();
                formData.append('audio', {
                    uri: Platform.OS === 'android' ? uri : uri.replace('file://', ''),
                    name: filename,
                    type: contentType,
                });
                const localRes = await axios.post(uploadEndpoint, formData, {
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'multipart/form-data',
                    },
                });
                await saveMetadata(localRes.data.fileKey || fileKey, localRes.data.fileData);
            } else {
                const audioData = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
                await fetch(uploadEndpoint, { method: uploadMethod || 'PUT', headers: { 'Content-Type': contentType }, body: Buffer.from(audioData, 'base64') });
                await saveMetadata(fileKey, null);
            }
            Alert.alert('Éxito', 'Grabación enviada correctamente al servidor.');
        } catch (error) {
            console.error('Upload error:', error);
            Alert.alert('Error de Subida', `No se pudo subir el audio: ${error.response?.data?.message || error.message}`);
        }
    };

    const saveMetadata = async (fileKey, audioBase64) => {
        try {
            await axios.post(`${API_URL}/upload/metadata`,
                { s3Key: fileKey, audioBase64, duration: 15, deviceModel: Platform.OS, eventType: 'auto-agent' },
                { headers: { Authorization: `Bearer ${token}` } }
            );
        } catch (error) {
            console.error('Metadata error:', error);
            throw new Error(`Error al guardar metadatos: ${error.response?.data?.message || error.message}`);
        }
    };

    // ==========================================
    // 2. MANUAL LOCAL RECORDING (TODA LA NOCHE)
    // ==========================================
    const startManualRecording = async () => {
        const p = await Audio.requestPermissionsAsync();
        if (p.status !== 'granted') {
            return Alert.alert('Permiso Denegado', 'Se necesita acceso al micrófono para grabar.');
        }

        // Stop Auto-Agent if running to free the microphone hardware
        if (isAutoAgentRunning) {
            await stopAutoAgent();
        }

        // Unload any old manual recording object
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

            console.log('Starting continuous manual recording...');
            const { recording } = await Audio.Recording.createAsync(
                Audio.RecordingOptionsPresets.HIGH_QUALITY
            );

            manualRecordingRef.current = recording;
            setIsManualRecording(true);
            setManualSeconds(0);

            // Timer
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
            console.log('Stopping continuous manual recording...');
            await recording.stopAndUnloadAsync();
            const uri = recording.getURI();

            if (uri) {
                const filename = `manual_record_${Date.now()}.m4a`;
                const newPath = FileSystem.documentDirectory + filename;
                await FileSystem.copyAsync({ from: uri, to: newPath });

                await loadLocalRecordings();

                Alert.alert(
                    '✅ Grabación Guardada',
                    'Tu grabación nocturna ha sido guardada en la memoria de tu teléfono.\n\nYa puedes escucharla abajo en "Mis Grabaciones".'
                );
            }
        } catch (err) {
            console.error('Failed to stop manual recording:', err);
            Alert.alert('Aviso', 'Se detuvo la grabación. Comprueba si aparece en la lista de abajo.');
            await loadLocalRecordings();
        }
    };

    // Test recording (5 seconds)
    const runQuickTestRecording = async () => {
        Alert.alert(
            'Grabar Audio de Prueba',
            'Se grabarán 5 segundos para probar el micrófono y el reproductor.',
            [
                { text: 'Cancelar', style: 'cancel' },
                {
                    text: 'Iniciar Prueba',
                    onPress: async () => {
                        await startManualRecording();
                        setTimeout(async () => {
                            await stopManualRecording();
                        }, 5000);
                    }
                }
            ]
        );
    };

    return (
        <ScrollView contentContainerStyle={styles.container}>
            <Text style={styles.title}>Einsdream Mobile</Text>

            <View style={styles.infoBox}>
                <Text style={{ fontWeight: 'bold', fontSize: 16, color: '#333' }}>☁️ Auto-Agent (Nube)</Text>
                <Text style={styles.infoText}>Detecta ruido automáticamente y sube clips precisos a la plataforma.</Text>
                <View style={{ height: 12 }} />
                <Text style={{ fontWeight: 'bold', fontSize: 16, color: '#333' }}>📱 Grabación Nocturna (Local)</Text>
                <Text style={styles.infoText}>Graba de forma continua durante toda la noche y se guarda en tu teléfono para escucharla cuando quieras.</Text>
            </View>

            {/* STATUS BOX */}
            <View style={[styles.statusBox, isManualRecording ? styles.statusBoxRecording : {}]}>
                <Text style={[styles.statusText, isManualRecording ? { color: '#dc2626' } : {}]}>
                    {isManualRecording ? `🔴 GRABANDO TODA LA NOCHE (${formatSeconds(manualSeconds)})` :
                        isAutoAgentRunning ? (isAutoRecording ? "🔴 CAPTURANDO RUIDO (NUBE)..." : "👂 ESCUCHANDO RUIDO...") :
                            "⚪ INACTIVO - LISTO PARA GRABAR"}
                </Text>
                {isManualRecording && (
                    <Text style={{ color: '#64748b', marginTop: 6, fontSize: 13 }}>
                        El teléfono está grabando tu noche continuamente. Presiona "DETENER" cuando despiertes.
                    </Text>
                )}
                {isAutoAgentRunning && (
                    <Text style={{ color: '#666', marginTop: 8 }}>Nivel de Ruido: {meteringValue} dB</Text>
                )}
            </View>

            {/* MAIN BUTTONS */}
            <View style={styles.buttonContainer}>
                {!isManualRecording && !isAutoAgentRunning && (
                    <>
                        <TouchableOpacity style={[styles.bigBtn, { backgroundColor: '#2563EB' }]} onPress={startManualRecording}>
                            <Text style={styles.bigBtnText}>🎙️ GRABAR TODA LA NOCHE (LOCAL)</Text>
                            <Text style={styles.bigBtnSub}>Guarda en tu teléfono para oírlo mañana</Text>
                        </TouchableOpacity>

                        <View style={{ height: 14 }} />

                        <TouchableOpacity style={[styles.bigBtn, { backgroundColor: '#10B981' }]} onPress={startAutoAgent}>
                            <Text style={styles.bigBtnText}>☁️ ACTIVAR AUTO-AGENT (NUBE)</Text>
                            <Text style={styles.bigBtnSub}>Graba solo cuando detecta ronquidos o ruidos</Text>
                        </TouchableOpacity>
                    </>
                )}

                {(isAutoAgentRunning || isManualRecording) && (
                    <TouchableOpacity style={[styles.bigBtn, { backgroundColor: '#DC2626' }]} onPress={stopAll}>
                        <Text style={styles.bigBtnText}>⏹️ DETENER Y GUARDAR GRABACIÓN</Text>
                        <Text style={styles.bigBtnSub}>Guarda el audio y lo deja listo para escuchar</Text>
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

                {isLoadingRecordings ? (
                    <ActivityIndicator size="small" color="#2563EB" style={{ marginVertical: 20 }} />
                ) : localRecordings.length === 0 ? (
                    <View style={{ alignItems: 'center', paddingVertical: 12 }}>
                        <Text style={styles.emptyText}>
                            Aún no tienes grabaciones guardadas en tu teléfono.
                        </Text>
                        <TouchableOpacity style={styles.testBtn} onPress={runQuickTestRecording}>
                            <Text style={styles.testBtnText}>🎵 Grabar 5 seg de prueba para oír el audio</Text>
                        </TouchableOpacity>
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
        marginBottom: 18,
        borderColor: '#bae6fd',
        borderWidth: 1,
    },
    infoText: {
        color: '#334155',
        fontSize: 14,
        marginTop: 4,
        lineHeight: 20
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
        fontSize: 17,
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
        fontSize: 17,
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
        backgroundColor: '#e0e7ff',
        paddingVertical: 12,
        paddingHorizontal: 18,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: '#c7d2fe'
    },
    testBtnText: {
        color: '#3730a3',
        fontWeight: '700',
        fontSize: 14
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
