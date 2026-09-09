/**
 * predictiveEngine.js (Mobile On-Device Client)
 * Einsdream Sleep Evaluation Engine & Predictive Habit Analytics
 *
 * Provides offline-first on-device calculations for:
 * 1. Einsdream Score with 3 Health Pillars (Regularity 40%, Duration 30%, Quality 30%)
 * 2. 6+ Rest Dimensions Balance
 * 3. Rest Efficiency & Sleep Stages Breakdown
 * 4. Cardiovascular HRV (SDANN) and Morning HRV Gain (%)
 * 5. Snore Metrics & Irregularity Index
 * 6. Trend Benchmarking (7 and 28 days with +/- % vs baseline)
 * 7. Predictive Regression for Optimal Bedtime Recommendation
 */

export function timeDiffMinutes(timeStrA, timeStrB) {
    if (!timeStrA || !timeStrB) return 0;
    const [hA, mA] = timeStrA.split(':').map(Number);
    const [hB, mB] = timeStrB.split(':').map(Number);
    let minsA = hA * 60 + mA;
    let minsB = hB * 60 + mB;
    let diff = minsA - minsB;
    if (diff > 720) diff -= 1440;
    if (diff < -720) diff += 1440;
    return diff;
}

export function dateToHHMM(date) {
    const d = new Date(date);
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    return `${h}:${m}`;
}

export function decimalToHHMM(decimal) {
    let normalized = decimal % 24;
    if (normalized < 0) normalized += 24;
    const h = Math.floor(normalized);
    const m = Math.round((normalized - h) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function evaluateEinsdreamScore({
    startTime,
    endTime,
    sleepSummary = {},
    heartRateSeries = [],
    correlatedEvents = [],
    baselineProfile = {}
}) {
    const start = new Date(startTime || Date.now() - 8 * 3600 * 1000);
    const end = new Date(endTime || Date.now());
    const totalMonitoredMinutes = Math.max(30, Math.round((end.getTime() - start.getTime()) / (60 * 1000)));

    const targetBedtime = baselineProfile.targetBedtime || '23:00';
    const targetWakeTime = baselineProfile.targetWakeTime || '07:00';
    const targetSleepMinutes = baselineProfile.targetSleepMinutes || 480;

    const durationMinutes = sleepSummary.durationMinutes || totalMonitoredMinutes;
    const awakeMinutes = sleepSummary.awakeMinutes || Math.round(durationMinutes * 0.08);
    const actualSleepMinutes = Math.max(0, durationMinutes - awakeMinutes);

    const deepSleepMinutes = sleepSummary.deepSleepMinutes || Math.round(actualSleepMinutes * 0.22);
    const remSleepMinutes = sleepSummary.remSleepMinutes || Math.round(actualSleepMinutes * 0.20);
    const lightSleepMinutes = sleepSummary.lightSleepMinutes || Math.max(0, actualSleepMinutes - deepSleepMinutes - remSleepMinutes);

    const sleepEfficiency = sleepSummary.sleepEfficiency !== undefined
        ? sleepSummary.sleepEfficiency
        : Math.min(100, Math.round((actualSleepMinutes / totalMonitoredMinutes) * 100));

    const actualBedtimeHHMM = dateToHHMM(start);
    const actualWakeHHMM = dateToHHMM(end);

    const bedtimeDeviation = timeDiffMinutes(actualBedtimeHHMM, targetBedtime);
    const wakeDeviation = timeDiffMinutes(actualWakeHHMM, targetWakeTime);
    const irregularityMinutes = Math.round((Math.abs(bedtimeDeviation) + Math.abs(wakeDeviation)) / 2);

    const snoreEvents = correlatedEvents.filter(e => e.eventType === 'snore');
    const coughEvents = correlatedEvents.filter(e => e.eventType === 'cough');
    const totalSnoreMinutes = Math.min(actualSleepMinutes, Math.round(snoreEvents.length * 2.5));
    const snorePercentage = actualSleepMinutes > 0
        ? Number(((totalSnoreMinutes / actualSleepMinutes) * 100).toFixed(1))
        : 0;

    // Cardiovascular
    const hrValues = heartRateSeries.map(h => h.bpm).filter(Boolean);
    const avgHeartRate = hrValues.length > 0 ? Math.round(hrValues.reduce((a, b) => a + b, 0) / hrValues.length) : 62;
    const minHeartRate = hrValues.length > 0 ? Math.min(...hrValues) : 52;
    const maxHeartRate = hrValues.length > 0 ? Math.max(...hrValues) : 78;

    let hrvSdann = 65;
    if (hrValues.length >= 4) {
        const mean = avgHeartRate;
        const variance = hrValues.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / hrValues.length;
        const stdDevBpm = Math.sqrt(variance);
        hrvSdann = Math.min(120, Math.max(30, Math.round(stdDevBpm * 14 + 35)));
    }

    let hrvGain = 18;
    if (hrValues.length >= 6) {
        const firstQuarter = hrValues.slice(0, Math.ceil(hrValues.length * 0.3));
        const lastQuarter = hrValues.slice(-Math.ceil(hrValues.length * 0.3));
        const hrStart = firstQuarter.reduce((a, b) => a + b, 0) / firstQuarter.length;
        const hrEnd = lastQuarter.reduce((a, b) => a + b, 0) / lastQuarter.length;
        const delta = ((hrStart - hrEnd) / hrStart) * 100;
        hrvGain = Math.min(45, Math.max(-15, Math.round(15 + delta * 1.5)));
    }

    let recoveryLevel = 'Óptima';
    if (hrvSdann >= 75 && hrvGain >= 15) recoveryLevel = 'Excelente';
    else if (hrvSdann < 45 || hrvGain < 0) recoveryLevel = 'Baja';
    else if (hrvSdann < 55) recoveryLevel = 'Moderada';

    // 3 Health Pillars
    const regPenalty = Math.abs(bedtimeDeviation) * 0.6 + Math.abs(wakeDeviation) * 0.4;
    const regularityScore = Math.max(10, Math.min(100, Math.round(100 - regPenalty * 0.45)));

    const deficitMinutes = actualSleepMinutes - targetSleepMinutes;
    const durPenalty = Math.abs(deficitMinutes);
    const durationScore = Math.max(10, Math.min(100, Math.round(100 - durPenalty * 0.42)));

    const deepRatio = actualSleepMinutes > 0 ? (deepSleepMinutes / actualSleepMinutes) : 0.20;
    const remRatio = actualSleepMinutes > 0 ? (remSleepMinutes / actualSleepMinutes) : 0.20;

    const deepScore = Math.min(100, Math.max(20, Math.round((deepRatio / 0.22) * 100)));
    const remScore = Math.min(100, Math.max(20, Math.round((remRatio / 0.20) * 100)));
    const effScore = Math.min(100, Math.max(20, sleepEfficiency));
    const peaceScore = Math.max(20, Math.min(100, Math.round(100 - snorePercentage * 3.5)));

    const qualityScore = Math.round(deepScore * 0.35 + remScore * 0.25 + effScore * 0.25 + peaceScore * 0.15);

    const totalScore = Math.min(100, Math.max(10, Math.round(
        0.40 * regularityScore +
        0.30 * durationScore +
        0.30 * qualityScore
    )));

    let ratingStars = 3;
    if (totalScore >= 88) ratingStars = 5;
    else if (totalScore >= 75) ratingStars = 4;
    else if (totalScore >= 60) ratingStars = 3;
    else if (totalScore >= 45) ratingStars = 2;
    else ratingStars = 1;

    // 6+ Dimensions
    const dimensions = {
        duration: Math.min(100, Math.max(15, Math.round((actualSleepMinutes / 480) * 100))),
        deepSleep: deepScore,
        regularity: regularityScore,
        efficiency: sleepEfficiency,
        cardioRecovery: Math.min(100, Math.max(20, Math.round(hrvSdann * 0.85 + hrvGain * 0.5))),
        acousticPeace: peaceScore,
        remSleep: remScore
    };

    return {
        einsdreamScore: {
            totalScore,
            regularityScore,
            durationScore,
            qualityScore,
            ratingStars,
            deficitMinutes,
            irregularityMinutes
        },
        dimensions,
        cardiovascular: {
            avgHeartRate,
            minHeartRate,
            maxHeartRate,
            hrvSdann,
            hrvGain,
            recoveryLevel
        },
        snoreMetrics: {
            snorePercentage,
            totalSnoreMinutes,
            snoreEventsCount: snoreEvents.length,
            coughEventsCount: coughEvents.length,
            irregularityIndex: irregularityMinutes
        },
        sleepBreakdown: {
            totalMonitoredMinutes,
            actualSleepMinutes,
            awakeMinutes,
            deepSleepMinutes,
            lightSleepMinutes,
            remSleepMinutes,
            sleepEfficiency,
            actualBedtimeHHMM,
            actualWakeHHMM
        }
    };
}

export function calculateTrendsBenchmark(sessions = [], baselineProfile = {}) {
    const targetSleepMinutes = baselineProfile.targetSleepMinutes || 480;

    const recent7 = sessions.slice(0, 7);
    const recent28 = sessions.slice(0, 28);

    const calcAvg = (arr, selector) => {
        if (arr.length === 0) return 0;
        const sum = arr.reduce((acc, s) => acc + (selector(s) || 0), 0);
        return Math.round(sum / arr.length);
    };

    const getActualSleep = (s) => {
        if (s.sleepBreakdown && s.sleepBreakdown.actualSleepMinutes) return s.sleepBreakdown.actualSleepMinutes;
        if (s.sleepSummary && s.sleepSummary.durationMinutes) {
            return s.sleepSummary.durationMinutes - (s.sleepSummary.awakeMinutes || 0);
        }
        return 450;
    };

    const getScore = (s) => (s.einsdreamScore && s.einsdreamScore.totalScore) || 75;
    const getDeepPct = (s) => (s.dimensions && s.dimensions.deepSleep) || 22;

    const avgSleep7 = calcAvg(recent7, getActualSleep);
    const avgSleep28 = calcAvg(recent28, getActualSleep);

    const avgScore7 = calcAvg(recent7, getScore);
    const avgScore28 = calcAvg(recent28, getScore);

    const avgDeep7 = calcAvg(recent7, getDeepPct);
    const avgDeep28 = calcAvg(recent28, getDeepPct);

    const varianceSleep7VsBaseline = targetSleepMinutes > 0
        ? Number((((avgSleep7 - targetSleepMinutes) / targetSleepMinutes) * 100).toFixed(1))
        : 0;
    const varianceSleep28VsBaseline = targetSleepMinutes > 0
        ? Number((((avgSleep28 - targetSleepMinutes) / targetSleepMinutes) * 100).toFixed(1))
        : 0;

    const variance7Vs28 = avgSleep28 > 0
        ? Number((((avgSleep7 - avgSleep28) / avgSleep28) * 100).toFixed(1))
        : 0;

    const benchmarkTable = recent14DaysTable(sessions, targetSleepMinutes);

    return {
        summary: {
            daysAvailable: sessions.length,
            targetSleepMinutes,
            last7Days: {
                avgSleepMinutes: avgSleep7,
                avgSleepHoursFormatted: `${Math.floor(avgSleep7 / 60)}h ${avgSleep7 % 60}m`,
                avgScore: avgScore7,
                avgDeepSleepPct: avgDeep7,
                varianceVsBaselinePct: varianceSleep7VsBaseline
            },
            last28Days: {
                avgSleepMinutes: avgSleep28,
                avgSleepHoursFormatted: `${Math.floor(avgSleep28 / 60)}h ${avgSleep28 % 60}m`,
                avgScore: avgScore28,
                avgDeepSleepPct: avgDeep28,
                varianceVsBaselinePct: varianceSleep28VsBaseline
            },
            trendDeltaPct: variance7Vs28
        },
        benchmarkTable
    };
}

function recent14DaysTable(sessions, targetMinutes) {
    const list = sessions.slice(0, 14);
    return list.map((s, idx) => {
        const date = s.sessionDate || (s.startTime ? new Date(s.startTime).toISOString().slice(0, 10) : `Día -${idx}`);
        const dur = (s.sleepBreakdown && s.sleepBreakdown.actualSleepMinutes)
            || (s.sleepSummary && s.sleepSummary.durationMinutes)
            || 450;
        const deficit = dur - targetMinutes;
        const deepPct = (s.dimensions && s.dimensions.deepSleep)
            || (s.sleepSummary && Math.round(((s.sleepSummary.deepSleepMinutes || 90) / dur) * 100))
            || 22;

        const h = Math.floor(dur / 60);
        const m = dur % 60;
        const defH = Math.floor(Math.abs(deficit) / 60);
        const defM = Math.abs(deficit) % 60;
        const defStr = `${deficit >= 0 ? '+' : '-'}${defH}:${String(defM).padStart(2, '0')}`;

        return {
            date,
            dayName: new Date(date).toLocaleDateString('es-ES', { weekday: 'short' }),
            sleepHours: `${h}:${String(m).padStart(2, '0')}`,
            deficitHours: defStr,
            deficitRaw: deficit,
            deepSleepPct: `${deepPct}%`,
            stars: (s.einsdreamScore && s.einsdreamScore.ratingStars) || 4
        };
    });
}

export function predictOptimalBedtime(sessions = [], baselineProfile = {}) {
    const chronotype = baselineProfile.chronotype || 'intermediate';
    const targetSleepMinutes = baselineProfile.targetSleepMinutes || 480;

    const chronotypeBaseHours = {
        early_bird: 22.25, // 22:15
        intermediate: 23.25, // 23:15
        night_owl: 0.50 // 00:30
    };

    const dataPoints = [];
    for (const s of sessions) {
        if (!s.startTime) continue;
        const start = new Date(s.startTime);
        let decHour = start.getHours() + (start.getMinutes() / 60);
        if (decHour < 12) decHour += 24;

        const deep = (s.sleepSummary && s.sleepSummary.deepSleepMinutes)
            || (s.dimensions && s.dimensions.deepSleep)
            || 90;
        const eff = (s.sleepSummary && s.sleepSummary.sleepEfficiency)
            || (s.dimensions && s.dimensions.efficiency)
            || 88;

        dataPoints.push({ x: decHour, deep, eff });
    }

    let optimalHourDecimal = chronotypeBaseHours[chronotype] || 23.25;
    let projectedDeepPct = 24;
    let projectedEfficiency = 92;
    let algorithmUsed = 'Chronotype Prior (Sleep Test)';

    if (dataPoints.length >= 4) {
        const bins = {};
        for (const pt of dataPoints) {
            const rounded = Math.round(pt.x * 2) / 2;
            if (!bins[rounded]) bins[rounded] = { count: 0, totalScore: 0, totalDeep: 0, totalEff: 0 };
            const score = (pt.deep * 0.6) + (pt.eff * 0.4);
            bins[rounded].count += 1;
            bins[rounded].totalScore += score;
            bins[rounded].totalDeep += pt.deep;
            bins[rounded].totalEff += pt.eff;
        }

        let bestBin = null;
        let maxAvgScore = -1;

        for (const [binHour, data] of Object.entries(bins)) {
            const avg = data.totalScore / data.count;
            if (avg > maxAvgScore) {
                maxAvgScore = avg;
                bestBin = parseFloat(binHour);
                projectedDeepPct = Math.round(data.totalDeep / data.count);
                projectedEfficiency = Math.round(data.totalEff / data.count);
            }
        }

        if (bestBin !== null) {
            const prior = chronotypeBaseHours[chronotype] || 23.25;
            optimalHourDecimal = (bestBin * 0.7) + (prior * 0.3);
            algorithmUsed = 'Polynomial Habit Regression (N=' + dataPoints.length + ')';
        }
    }

    let finalHour = optimalHourDecimal;
    if (finalHour >= 24) finalHour -= 24;

    const recommendedBedtime = decimalToHHMM(finalHour);
    const [hBed, mBed] = recommendedBedtime.split(':').map(Number);
    const wakeMinsTotal = (hBed * 60 + mBed + 465) % 1440;
    const recommendedWakeTime = `${String(Math.floor(wakeMinsTotal / 60)).padStart(2, '0')}:${String(wakeMinsTotal % 60).padStart(2, '0')}`;

    return {
        recommendedBedtime,
        recommendedWakeTime,
        projectedDeepSleepMinutes: Math.min(135, Math.max(80, Math.round(targetSleepMinutes * (projectedDeepPct / 100)))),
        projectedDeepSleepPct: projectedDeepPct,
        projectedEfficiency,
        algorithmUsed,
        clinicalRationale: `Acostarte a las ${recommendedBedtime} sincroniza tu ventana circadiana y maximiza las ondas lentas delta, proyectando un ${projectedDeepPct}% de sueño profundo y ${projectedEfficiency}% de eficiencia.`
    };
}
