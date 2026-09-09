/**
 * SleepCharts.js
 * High-performance, rich clinical visualizations for EinsDream:
 * - Circular Dials / Ring Gauges (Duration, Deep Sleep %, Irregularity, Efficiency, Acoustic Peace)
 * - Multi-dimensional Rest Balance Chart (6+ dimensions)
 * - Layered Hypnogram Stages (Awake, REM, Light, Deep)
 * - Actigraphy Nocturnal Activity Waveform
 * - Cardiovascular HR & HRV Recovery Graph with HRV Gain
 * - Star Rating Display (1-5 stars)
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

// ─── 1. Circular Progress Dial (Sleep as Android Style) ─────────────────────────
export function CircularDial({
    value = '0:00',
    subValue = '+0:00',
    subPositive = true,
    label = 'Duración',
    percentage = 80,
    color = '#10b981',
    size = 96,
    icon = '⏱️'
}) {
    // Percentage clamped to 0-100
    const pct = Math.max(0, Math.min(100, percentage));

    return (
        <View style={[styles.dialContainer, { width: size, height: size + 28 }]}>
            <View style={[styles.dialRingOuter, { width: size, height: size, borderColor: 'rgba(255,255,255,0.08)' }]}>
                {/* Arc Progress Indicator */}
                <View
                    style={[
                        styles.dialArcFill,
                        {
                            borderColor: color,
                            borderTopColor: color,
                            borderRightColor: pct > 35 ? color : 'transparent',
                            borderBottomColor: pct > 65 ? color : 'transparent',
                            borderLeftColor: pct > 85 ? color : 'transparent',
                        }
                    ]}
                />
                <View style={styles.dialContent}>
                    <Text style={styles.dialIcon}>{icon}</Text>
                    <Text style={[styles.dialValue, { color: '#ffffff' }]}>{value}</Text>
                    {subValue ? (
                        <Text style={[styles.dialSubValue, { color: subPositive ? '#34d399' : '#f87171' }]}>
                            {subValue}
                        </Text>
                    ) : null}
                </View>
            </View>
            <Text style={styles.dialLabel} numberOfLines={1}>{label}</Text>
        </View>
    );
}

// ─── 2. Estrellas de Calificación (1 a 5 Estrellas) ───────────────────────────
export function StarRating({ rating = 4, maxStars = 5, size = 20 }) {
    const stars = [];
    for (let i = 1; i <= maxStars; i++) {
        const isFilled = i <= rating;
        stars.push(
            <Text key={i} style={{ fontSize: size, color: isFilled ? '#fbbf24' : '#334155', marginHorizontal: 2 }}>
                {isFilled ? '★' : '☆'}
            </Text>
        );
    }
    return <View style={styles.starRow}>{stars}</View>;
}

// ─── 3. Multi-Dimension Rest Balance (6+ Dimensiones) ─────────────────────────
export function DimensionsBalanceChart({ dimensions = {} }) {
    const dims = [
        { key: 'duration', label: 'Duración', icon: '⏱️', val: dimensions.duration || 85, color: '#38bdf8' },
        { key: 'deepSleep', label: 'Sueño Profundo', icon: '🌙', val: dimensions.deepSleep || 78, color: '#818cf8' },
        { key: 'regularity', label: 'Regularidad', icon: '🔄', val: dimensions.regularity || 92, color: '#34d399' },
        { key: 'efficiency', label: 'Eficiencia', icon: '🎯', val: dimensions.efficiency || 90, color: '#a78bfa' },
        { key: 'cardioRecovery', label: 'Recuperación', icon: '🫀', val: dimensions.cardioRecovery || 84, color: '#f43f5e' },
        { key: 'acousticPeace', label: 'Paz Acústica', icon: '😴', val: dimensions.acousticPeace || 88, color: '#fbbf24' },
        { key: 'remSleep', label: 'Fase REM', icon: '🧠', val: dimensions.remSleep || 82, color: '#2dd4bf' }
    ];

    return (
        <View style={styles.dimCard}>
            <View style={styles.dimHeader}>
                <Text style={styles.dimTitle}>⚖️ Balance de las 7 Dimensiones del Descanso</Text>
                <Text style={styles.dimSubtitle}>Evaluación unificada del equilibrio corporal y circadiano</Text>
            </View>

            <View style={styles.dimList}>
                {dims.map((d) => (
                    <View key={d.key} style={styles.dimItem}>
                        <View style={styles.dimLabelRow}>
                            <Text style={styles.dimItemLabel}>
                                {d.icon} {d.label}
                            </Text>
                            <Text style={[styles.dimItemVal, { color: d.color }]}>{d.val}%</Text>
                        </View>
                        <View style={styles.dimBarBg}>
                            <View style={[styles.dimBarFill, { width: `${d.val}%`, backgroundColor: d.color }]} />
                        </View>
                    </View>
                ))}
            </View>
        </View>
    );
}

// ─── 4. Hypnogram Multi-fase (Awake, REM, Light, Deep) ────────────────────────
export function HypnogramChart({ sleepSummary = {}, sleepBreakdown = {} }) {
    const actual = sleepBreakdown.actualSleepMinutes || sleepSummary.durationMinutes || 460;
    const awake = sleepBreakdown.awakeMinutes || sleepSummary.awakeMinutes || 35;
    const deep = sleepBreakdown.deepSleepMinutes || sleepSummary.deepSleepMinutes || 105;
    const rem = sleepBreakdown.remSleepMinutes || sleepSummary.remSleepMinutes || 92;
    const light = sleepBreakdown.lightSleepMinutes || sleepSummary.lightSleepMinutes || (actual - deep - rem);

    const total = actual + awake;
    const awakePct = Math.round((awake / total) * 100);
    const remPct = Math.round((rem / total) * 100);
    const lightPct = Math.round((light / total) * 100);
    const deepPct = Math.round((deep / total) * 100);

    const fmtMin = (m) => `${Math.floor(m / 60)}h ${m % 60}m`;

    return (
        <View style={styles.hypnoCard}>
            <View style={styles.hypnoHeader}>
                <Text style={styles.hypnoTitle}>🌊 Fases del Sueño (Hypnogram)</Text>
                <Text style={styles.hypnoSub}>Desglose de ciclos ultradianos</Text>
            </View>

            {/* Visual Timeline Hypnogram Layer */}
            <View style={styles.timelineContainer}>
                {/* Visual Stage Bars */}
                <View style={styles.timelineBarStack}>
                    <View style={[styles.timelineSlice, { flex: 1.5, backgroundColor: '#38bdf8', height: '60%' }]} />
                    <View style={[styles.timelineSlice, { flex: 2.5, backgroundColor: '#10b981', height: '95%' }]} />
                    <View style={[styles.timelineSlice, { flex: 2.0, backgroundColor: '#c084fc', height: '75%' }]} />
                    <View style={[styles.timelineSlice, { flex: 2.5, backgroundColor: '#38bdf8', height: '60%' }]} />
                    <View style={[styles.timelineSlice, { flex: 1.5, backgroundColor: '#10b981', height: '95%' }]} />
                    <View style={[styles.timelineSlice, { flex: 2.0, backgroundColor: '#c084fc', height: '75%' }]} />
                    <View style={[styles.timelineSlice, { flex: 1.0, backgroundColor: '#fb923c', height: '30%' }]} />
                </View>
                <View style={styles.timelineStageLabels}>
                    <Text style={styles.stageAxisText}>Despierto</Text>
                    <Text style={styles.stageAxisText}>REM</Text>
                    <Text style={styles.stageAxisText}>Ligero</Text>
                    <Text style={styles.stageAxisText}>Profundo</Text>
                </View>
            </View>

            {/* Stages Percentage and Durations List */}
            <View style={styles.stagesList}>
                <View style={styles.stageRow}>
                    <View style={styles.stageBadgeCol}>
                        <View style={[styles.stageDot, { backgroundColor: '#fb923c' }]} />
                        <Text style={styles.stageName}>Despierto</Text>
                    </View>
                    <View style={styles.stageBarWrap}>
                        <View style={[styles.stageBar, { width: `${awakePct}%`, backgroundColor: '#fb923c' }]} />
                    </View>
                    <Text style={styles.stageMetric}>{awakePct}% ({fmtMin(awake)})</Text>
                </View>

                <View style={styles.stageRow}>
                    <View style={styles.stageBadgeCol}>
                        <View style={[styles.stageDot, { backgroundColor: '#c084fc' }]} />
                        <Text style={styles.stageName}>REM</Text>
                    </View>
                    <View style={styles.stageBarWrap}>
                        <View style={[styles.stageBar, { width: `${remPct}%`, backgroundColor: '#c084fc' }]} />
                    </View>
                    <Text style={styles.stageMetric}>{remPct}% ({fmtMin(rem)})</Text>
                </View>

                <View style={styles.stageRow}>
                    <View style={styles.stageBadgeCol}>
                        <View style={[styles.stageDot, { backgroundColor: '#38bdf8' }]} />
                        <Text style={styles.stageName}>Ligero</Text>
                    </View>
                    <View style={styles.stageBarWrap}>
                        <View style={[styles.stageBar, { width: `${lightPct}%`, backgroundColor: '#38bdf8' }]} />
                    </View>
                    <Text style={styles.stageMetric}>{lightPct}% ({fmtMin(light)})</Text>
                </View>

                <View style={styles.stageRow}>
                    <View style={styles.stageBadgeCol}>
                        <View style={[styles.stageDot, { backgroundColor: '#10b981' }]} />
                        <Text style={styles.stageName}>Profundo</Text>
                    </View>
                    <View style={styles.stageBarWrap}>
                        <View style={[styles.stageBar, { width: `${deepPct}%`, backgroundColor: '#10b981' }]} />
                    </View>
                    <Text style={styles.stageMetric}>{deepPct}% ({fmtMin(deep)})</Text>
                </View>
            </View>
        </View>
    );
}

// ─── 5. Actigrafía y Traza Acústica ───────────────────────────────────────────
export function ActigraphyChart({ snoreCount = 0, coughCount = 0 }) {
    // Generate mountain/peaks actigraphy pattern
    const peaks = [8, 14, 25, 42, 18, 12, 55, 68, 32, 19, 10, 14, 62, 85, 45, 20, 15, 30, 48, 22, 12];

    return (
        <View style={styles.actCard}>
            <View style={styles.actHeader}>
                <Text style={styles.actTitle}>📈 Actigrafía y Registro Acústico</Text>
                <Text style={styles.actSubtitle}>
                    {snoreCount} ronquidos · {coughCount} tos/sonidos
                </Text>
            </View>

            <View style={styles.waveContainer}>
                {peaks.map((h, i) => (
                    <View
                        key={i}
                        style={[
                            styles.waveBar,
                            {
                                height: `${h}%`,
                                backgroundColor: h > 60 ? '#f43f5e' : (h > 35 ? '#eab308' : '#10b981'),
                                opacity: 0.85
                            }
                        ]}
                    />
                ))}
            </View>
            <View style={styles.waveFooter}>
                <Text style={styles.waveTime}>0:00</Text>
                <Text style={styles.waveTime}>2:00</Text>
                <Text style={styles.waveTime}>4:00</Text>
                <Text style={styles.waveTime}>6:00</Text>
                <Text style={styles.waveTime}>Despertar</Text>
            </View>
        </View>
    );
}

// ─── 6. Monitoreo Cardiovascular (HR, HRV SDANN, HRV Gain) ────────────────────
export function CardioChart({ cardiovascular = {} }) {
    const avg = cardiovascular.avgHeartRate || 60;
    const min = cardiovascular.minHeartRate || 51;
    const max = cardiovascular.maxHeartRate || 76;
    const hrv = cardiovascular.hrvSdann || 68;
    const gain = cardiovascular.hrvGain !== undefined ? cardiovascular.hrvGain : 22;
    const recovery = cardiovascular.recoveryLevel || 'Excelente';

    // Mock points for line
    const points = [64, 61, 58, 54, 52, 51, 53, 56, 54, 52, 55, 59, 63];

    return (
        <View style={styles.cardioCard}>
            <View style={styles.cardioHeader}>
                <View>
                    <Text style={styles.cardioTitle}>🫀 Monitoreo Cardiovascular & HRV</Text>
                    <Text style={styles.cardioSubtitle}>Recuperación parasimpática y autónoma</Text>
                </View>
                <View style={[styles.recBadge, { backgroundColor: gain >= 15 ? '#064e3b' : '#78350f' }]}>
                    <Text style={[styles.recBadgeText, { color: gain >= 15 ? '#34d399' : '#fbbf24' }]}>
                        {recovery}
                    </Text>
                </View>
            </View>

            {/* Metrics Row */}
            <View style={styles.cardioMetricsRow}>
                <View style={styles.cardioMetricBox}>
                    <Text style={styles.cMetricVal}>{avg} <Text style={styles.cMetricUnit}>bpm</Text></Text>
                    <Text style={styles.cMetricLabel}>FC Media</Text>
                </View>
                <View style={styles.cardioMetricBox}>
                    <Text style={styles.cMetricVal}>{min} - {max} <Text style={styles.cMetricUnit}>bpm</Text></Text>
                    <Text style={styles.cMetricLabel}>Mín - Máx</Text>
                </View>
                <View style={styles.cardioMetricBox}>
                    <Text style={styles.cMetricVal}>{hrv} <Text style={styles.cMetricUnit}>ms</Text></Text>
                    <Text style={styles.cMetricLabel}>HRV (SDANN)</Text>
                </View>
                <View style={styles.cardioMetricBox}>
                    <Text style={[styles.cMetricVal, { color: gain >= 0 ? '#34d399' : '#f87171' }]}>
                        {gain >= 0 ? `+${gain}%` : `${gain}%`}
                    </Text>
                    <Text style={styles.cMetricLabel}>HRV Gain</Text>
                </View>
            </View>

            {/* Curve Simulation */}
            <View style={styles.hrCurveContainer}>
                {points.map((p, idx) => (
                    <View key={idx} style={styles.hrNodeCol}>
                        <View style={[styles.hrNodeDot, { bottom: (p - 48) * 3 }]} />
                        {idx % 3 === 0 && (
                            <Text style={[styles.hrNodeLabel, { bottom: (p - 48) * 3 + 12 }]}>{p}</Text>
                        )}
                    </View>
                ))}
            </View>
            <Text style={styles.cardioFootnote}>
                Ganancia de HRV al despertar (+{gain}%): indica transición autonómica favorable y recuperación física del sistema nervioso.
            </Text>
        </View>
    );
}

// ─── 7. Tarjeta Resumen de los 3 Pilares de Salud ──────────────────────────────
export function ThreePillarsCard({ scoreData = {} }) {
    const total = scoreData.totalScore || 85;
    const regularity = scoreData.regularityScore || 90;
    const duration = scoreData.durationScore || 82;
    const quality = scoreData.qualityScore || 84;
    const stars = scoreData.ratingStars || 4;

    return (
        <View style={styles.pillarsCard}>
            <View style={styles.scoreRow}>
                <View style={styles.scoreBadge}>
                    <Text style={styles.scoreBig}>{total}</Text>
                    <Text style={styles.scoreScale}>/100</Text>
                </View>
                <View style={{ flex: 1, marginLeft: 14 }}>
                    <Text style={styles.scoreTitle}>Einsdream Score</Text>
                    <Text style={styles.scoreSubtitle}>
                        {total >= 85 ? 'Óptima recuperación biológica' : 'Recuperación moderada'}
                    </Text>
                    <StarRating rating={stars} size={18} />
                </View>
            </View>

            {/* 3 Pillars Breakdown */}
            <View style={styles.pillarsContainer}>
                {/* Pilar 1: Regularidad */}
                <View style={styles.pillarBox}>
                    <View style={styles.pillarHead}>
                        <Text style={styles.pillarIcon}>🔄</Text>
                        <Text style={styles.pillarName}>Regularidad</Text>
                    </View>
                    <Text style={[styles.pillarScore, { color: '#34d399' }]}>{regularity}%</Text>
                    <Text style={styles.pillarWeight}>Ponderación 40% (Prioridad)</Text>
                </View>

                {/* Pilar 2: Duración */}
                <View style={styles.pillarBox}>
                    <View style={styles.pillarHead}>
                        <Text style={styles.pillarIcon}>⏱️</Text>
                        <Text style={styles.pillarName}>Duración</Text>
                    </View>
                    <Text style={[styles.pillarScore, { color: '#38bdf8' }]}>{duration}%</Text>
                    <Text style={styles.pillarWeight}>Ponderación 30%</Text>
                </View>

                {/* Pilar 3: Calidad */}
                <View style={styles.pillarBox}>
                    <View style={styles.pillarHead}>
                        <Text style={styles.pillarIcon}>⭐</Text>
                        <Text style={styles.pillarName}>Calidad</Text>
                    </View>
                    <Text style={[styles.pillarScore, { color: '#fbbf24' }]}>{quality}%</Text>
                    <Text style={styles.pillarWeight}>Ponderación 30%</Text>
                </View>
            </View>
        </View>
    );
}

// ─── Estilos de los Componentes ───────────────────────────────────────────────
const styles = StyleSheet.create({
    dialContainer: {
        alignItems: 'center',
        marginHorizontal: 4,
    },
    dialRingOuter: {
        borderRadius: 999,
        borderWidth: 4,
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
        backgroundColor: '#0f172a',
    },
    dialArcFill: {
        position: 'absolute',
        width: '100%',
        height: '100%',
        borderRadius: 999,
        borderWidth: 4,
    },
    dialContent: {
        alignItems: 'center',
        justifyContent: 'center',
    },
    dialIcon: {
        fontSize: 12,
        marginBottom: 1,
    },
    dialValue: {
        fontSize: 15,
        fontWeight: '900',
        letterSpacing: 0.3,
    },
    dialSubValue: {
        fontSize: 10,
        fontWeight: '700',
        marginTop: 1,
    },
    dialLabel: {
        fontSize: 11,
        fontWeight: '700',
        color: '#94a3b8',
        marginTop: 6,
        textAlign: 'center',
    },

    starRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 4,
    },

    dimCard: {
        backgroundColor: '#1e293b',
        borderRadius: 16,
        padding: 16,
        marginVertical: 10,
        borderWidth: 1,
        borderColor: '#334155',
    },
    dimHeader: {
        marginBottom: 12,
    },
    dimTitle: {
        fontSize: 15,
        fontWeight: '800',
        color: '#f8fafc',
    },
    dimSubtitle: {
        fontSize: 11,
        color: '#94a3b8',
        marginTop: 2,
    },
    dimList: {
        marginTop: 4,
    },
    dimItem: {
        marginBottom: 10,
    },
    dimLabelRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 4,
    },
    dimItemLabel: {
        fontSize: 12,
        fontWeight: '700',
        color: '#cbd5e1',
    },
    dimItemVal: {
        fontSize: 12,
        fontWeight: '800',
    },
    dimBarBg: {
        height: 6,
        backgroundColor: '#334155',
        borderRadius: 3,
        overflow: 'hidden',
    },
    dimBarFill: {
        height: '100%',
        borderRadius: 3,
    },

    hypnoCard: {
        backgroundColor: '#1e293b',
        borderRadius: 16,
        padding: 16,
        marginVertical: 10,
        borderWidth: 1,
        borderColor: '#334155',
    },
    hypnoHeader: {
        marginBottom: 14,
    },
    hypnoTitle: {
        fontSize: 15,
        fontWeight: '800',
        color: '#f8fafc',
    },
    hypnoSub: {
        fontSize: 11,
        color: '#94a3b8',
        marginTop: 2,
    },
    timelineContainer: {
        height: 75,
        backgroundColor: '#0f172a',
        borderRadius: 10,
        padding: 6,
        position: 'relative',
        marginBottom: 14,
        justifyContent: 'flex-end',
    },
    timelineBarStack: {
        flexDirection: 'row',
        alignItems: 'flex-end',
        height: '100%',
        width: '100%',
        gap: 3,
    },
    timelineSlice: {
        borderRadius: 3,
    },
    timelineStageLabels: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginTop: 4,
    },
    stageAxisText: {
        fontSize: 9,
        fontWeight: '700',
        color: '#64748b',
    },
    stagesList: {
        marginTop: 6,
    },
    stageRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 8,
    },
    stageBadgeCol: {
        flexDirection: 'row',
        alignItems: 'center',
        width: 80,
    },
    stageDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        marginRight: 6,
    },
    stageName: {
        fontSize: 11,
        color: '#cbd5e1',
        fontWeight: '700',
    },
    stageBarWrap: {
        flex: 1,
        height: 6,
        backgroundColor: '#334155',
        borderRadius: 3,
        marginHorizontal: 10,
        overflow: 'hidden',
    },
    stageBar: {
        height: '100%',
        borderRadius: 3,
    },
    stageMetric: {
        fontSize: 11,
        fontWeight: '700',
        color: '#94a3b8',
        width: 100,
        textAlign: 'right',
    },

    actCard: {
        backgroundColor: '#1e293b',
        borderRadius: 16,
        padding: 16,
        marginVertical: 10,
        borderWidth: 1,
        borderColor: '#334155',
    },
    actHeader: {
        marginBottom: 10,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    actTitle: {
        fontSize: 14,
        fontWeight: '800',
        color: '#f8fafc',
    },
    actSubtitle: {
        fontSize: 11,
        color: '#34d399',
        fontWeight: '700',
    },
    waveContainer: {
        height: 60,
        backgroundColor: '#0f172a',
        borderRadius: 10,
        flexDirection: 'row',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        paddingHorizontal: 10,
        paddingBottom: 4,
    },
    waveBar: {
        width: 6,
        borderRadius: 3,
    },
    waveFooter: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginTop: 6,
        paddingHorizontal: 4,
    },
    waveTime: {
        fontSize: 9,
        color: '#64748b',
    },

    cardioCard: {
        backgroundColor: '#1e293b',
        borderRadius: 16,
        padding: 16,
        marginVertical: 10,
        borderWidth: 1,
        borderColor: '#334155',
    },
    cardioHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: 12,
    },
    cardioTitle: {
        fontSize: 15,
        fontWeight: '800',
        color: '#f8fafc',
    },
    cardioSubtitle: {
        fontSize: 11,
        color: '#94a3b8',
        marginTop: 2,
    },
    recBadge: {
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 8,
    },
    recBadgeText: {
        fontSize: 11,
        fontWeight: '800',
    },
    cardioMetricsRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        backgroundColor: '#0f172a',
        borderRadius: 12,
        padding: 10,
        marginBottom: 12,
    },
    cardioMetricBox: {
        alignItems: 'center',
    },
    cMetricVal: {
        fontSize: 14,
        fontWeight: '900',
        color: '#ffffff',
    },
    cMetricUnit: {
        fontSize: 10,
        color: '#94a3b8',
        fontWeight: '500',
    },
    cMetricLabel: {
        fontSize: 10,
        color: '#64748b',
        marginTop: 2,
    },
    hrCurveContainer: {
        height: 60,
        backgroundColor: '#0f172a',
        borderRadius: 10,
        position: 'relative',
        flexDirection: 'row',
        justifyContent: 'space-between',
        paddingHorizontal: 8,
        marginBottom: 8,
    },
    hrNodeCol: {
        width: 12,
        height: '100%',
        position: 'relative',
        alignItems: 'center',
    },
    hrNodeDot: {
        position: 'absolute',
        width: 6,
        height: 6,
        borderRadius: 3,
        backgroundColor: '#f43f5e',
    },
    hrNodeLabel: {
        position: 'absolute',
        fontSize: 8,
        color: '#f87171',
        fontWeight: '700',
    },
    cardioFootnote: {
        fontSize: 10,
        color: '#94a3b8',
        lineHeight: 14,
        fontStyle: 'italic',
    },

    pillarsCard: {
        backgroundColor: '#0f172a',
        borderRadius: 16,
        padding: 16,
        marginBottom: 14,
        borderWidth: 1.5,
        borderColor: '#38bdf8',
    },
    scoreRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 14,
    },
    scoreBadge: {
        width: 72,
        height: 72,
        borderRadius: 20,
        backgroundColor: '#3b82f6',
        alignItems: 'center',
        justifyContent: 'center',
        elevation: 6,
    },
    scoreBig: {
        fontSize: 28,
        fontWeight: '900',
        color: '#ffffff',
        lineHeight: 32,
    },
    scoreScale: {
        fontSize: 10,
        fontWeight: '700',
        color: 'rgba(255,255,255,0.8)',
    },
    scoreTitle: {
        fontSize: 17,
        fontWeight: '900',
        color: '#ffffff',
    },
    scoreSubtitle: {
        fontSize: 12,
        color: '#94a3b8',
        marginTop: 1,
    },
    pillarsContainer: {
        flexDirection: 'row',
        gap: 8,
    },
    pillarBox: {
        flex: 1,
        backgroundColor: '#1e293b',
        borderRadius: 12,
        padding: 10,
        alignItems: 'center',
        borderWidth: 1,
        borderColor: '#334155',
    },
    pillarHead: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        marginBottom: 4,
    },
    pillarIcon: {
        fontSize: 12,
    },
    pillarName: {
        fontSize: 11,
        fontWeight: '700',
        color: '#cbd5e1',
    },
    pillarScore: {
        fontSize: 18,
        fontWeight: '900',
        marginVertical: 2,
    },
    pillarWeight: {
        fontSize: 8,
        color: '#64748b',
        textAlign: 'center',
    },
});
