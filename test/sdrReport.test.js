import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSdrReport, buildSdrReportsBatch, analyzeSession } from '../src/services/sdrReport.js';

const T0 = Date.parse('2026-10-29T00:00:00Z');
const min = (n) => n * 60000;

/** Ejemplo ilustrativo de la norma: 24 eventos de 2 s en 5 agrupaciones, 390 min con 30 min de pausa. */
function exampleSession() {
    const starts = [
        // 5 agrupaciones separadas por > 5 min
        10, 10.5, 11, 11.5, 12,
        60, 60.5, 61, 61.5, 62,
        130, 130.5, 131, 131.5,
        200, 200.5, 201, 201.5, 202,
        300, 300.5, 301, 301.5
    ];
    starts.push(340); // 24 eventos
    return {
        sessionId: 'SES-20261029-01',
        sessionDate: '2026-10-29',
        startTime: new Date(T0).toISOString(),
        endTime: new Date(T0 + min(390)).toISOString(),
        pauseSegments: [{ pausedAt: new Date(T0 + min(20)).toISOString(), resumedAt: new Date(T0 + min(50)).toISOString() }],
        soundEvents: starts.map((m, i) => ({
            eventNumber: i + 1,
            timestamp: new Date(T0 + min(m < 20 ? m : m)).toISOString(),
            duration: 2,
            peakDb: -40 + (i % 5),
            eventType: 'snore'
        }))
    };
}

test('el ejemplo de la norma: 390 min, 30 min de pausa → 360 min válidos y 92,31% de cobertura', () => {
    const r = buildSdrReport(exampleSession());
    assert.equal(r.monitoring.duration_min, 390);
    assert.equal(r.monitoring.valid_duration_min, 360);
    assert.equal(r.monitoring.coverage_pct, 92.31);
    assert.equal(r.acoustic.event_count, 24);
    assert.equal(r.acoustic.events_per_hour, 4);
    assert.equal(r.acoustic.active_duration_sec, 48);
    assert.equal(r.acoustic.mean_event_duration_sec, 2);
    assert.equal(r.acoustic.max_event_duration_sec, 2);
});

test('la agrupación distingue duración de la agrupación y duración acústica acumulada', () => {
    const s = {
        sessionDate: '2026-10-29',
        startTime: new Date(T0).toISOString(),
        endTime: new Date(T0 + min(240)).toISOString(),
        soundEvents: [0, 4, 9].map((sec) => ({ timestamp: new Date(T0 + min(100) + sec * 1000).toISOString(), duration: 1, peakDb: -30 }))
    };
    const r = buildSdrReport(s);
    assert.equal(r.clusters.length, 1);
    assert.equal(r.clusters[0].span_s, 10);
    assert.equal(r.clusters[0].active_s, 3);
    assert.equal(r.acoustic.active_duration_sec, 3);
});

test('los eventos superpuestos no se cuentan dos veces en el tiempo activo', () => {
    const s = {
        sessionDate: '2026-10-29',
        startTime: new Date(T0).toISOString(),
        endTime: new Date(T0 + min(240)).toISOString(),
        soundEvents: [
            { timestamp: new Date(T0 + min(100)).toISOString(), duration: 10, peakDb: -30 },
            { timestamp: new Date(T0 + min(100) + 5000).toISOString(), duration: 10, peakDb: -31 }
        ]
    };
    assert.equal(buildSdrReport(s).acoustic.active_duration_sec, 15);
});

test('sin eventos: medias nulas (no 0) y sin afirmar noche tranquila', () => {
    const r = buildSdrReport({
        sessionDate: '2026-10-29',
        startTime: new Date(T0).toISOString(),
        endTime: new Date(T0 + min(360)).toISOString()
    });
    assert.equal(r.acoustic.event_count, 0);
    assert.equal(r.acoustic.mean_event_duration_sec, null);
    assert.equal(r.acoustic.max_event_duration_sec, null);
    assert.equal(r.acoustic.active_duration_sec, null);
    assert.match(r.interpretation.summary, /no permite afirmar/);
});

test('cobertura baja → P5 información insuficiente (no "noche excelente")', () => {
    const r = buildSdrReport({
        sessionDate: '2026-10-29',
        startTime: new Date(T0).toISOString(),
        endTime: new Date(T0 + min(360)).toISOString(),
        pauseSegments: [{ pausedAt: new Date(T0 + min(30)).toISOString(), resumedAt: new Date(T0 + min(330)).toISOString() }]
    });
    assert.equal(r.pattern.code, 'P5');
    assert.equal(r.interpretation.uncertainty.level, 'high');
});

test('sin referencia individual el patrón queda pendiente y los subíndices dependientes son nulos', () => {
    const r = buildSdrReport(exampleSession());
    assert.equal(r.interpretation.activity_pattern === 'PENDING_REFERENCE' || r.pattern.code === 'P4', true);
    assert.equal(r.reference.type, 'REF-NONE');
    assert.equal(r.subindices.SDR_SCORE_CONTINUITY.value, null);
    assert.equal(r.interpretation.sleep_quality, 'NOT_ESTABLISHED');
    assert.equal(r.interpretation.clinical_diagnosis, false);
    assert.equal(r.monitoring.sleep_estimate_min, null);
});

test('movimiento: sin sensor no se inventan mediciones', () => {
    const r = buildSdrReport(exampleSession());
    assert.deepEqual(r.movement, { sensor_available: false, event_count: null, events_per_hour: null, activity_pct: null, coincidence_pct: null });
});

test('se descartan eventos sintéticos, duplicados y fuera del período', () => {
    const base = exampleSession();
    base.soundEvents.push({ ...base.soundEvents[0] });                                        // duplicado
    base.soundEvents.push({ timestamp: new Date(T0 - min(30)).toISOString(), duration: 2 }); // fuera de ventana
    base.soundEvents.push({ timestamp: new Date(T0 + min(100)).toISOString(), duration: 2, synthetic: true });
    const core = analyzeSession(base);
    assert.equal(core.discarded.duplicate, 1);
    assert.equal(core.discarded.out_of_window, 1);
    assert.equal(core.discarded.synthetic, 1);
    assert.equal(core.metrics.event_count, 24);
});

test('REF-USER: con 3+ noches previas comparables se compara contra el historial propio', () => {
    const mkNight = (day, n) => ({
        _id: `n${day}`,
        userId: 'u1',
        sessionDate: `2026-10-${String(day).padStart(2, '0')}`,
        startTime: new Date(T0 + (day - 29) * 86400000).toISOString(),
        endTime: new Date(T0 + (day - 29) * 86400000 + min(420)).toISOString(),
        soundEvents: Array.from({ length: n }, (_, i) => ({
            timestamp: new Date(T0 + (day - 29) * 86400000 + min(20 + i * 12)).toISOString(), duration: 2, peakDb: -40
        }))
    });
    const nights = [mkNight(25, 10), mkNight(26, 12), mkNight(27, 11), mkNight(28, 10), mkNight(29, 40)];
    const reports = buildSdrReportsBatch(nights, {});
    const last = reports[4];
    assert.equal(last.reference.type, 'REF-USER');
    assert.equal(last.reference.nights_used, 4);
    assert.equal(last.pattern.code === 'P3' || last.pattern.code === 'P4', true);
    assert.equal(reports[0].reference.type, 'REF-NONE');
    assert.equal(typeof last.subindices.SDR_SCORE_CONTINUITY.value, 'number');
});

test('el texto automático no emite conclusiones clínicas prohibidas', () => {
    const r = buildSdrReport(exampleSession());
    const text = JSON.stringify(r.interpretation).toLowerCase();
    for (const banned of ['insomnio', 'apnea', 'sueño profundo confirmado', 'sueño rem', 'excelente']) {
        assert.equal(text.includes(banned), false, `no debe contener "${banned}"`);
    }
});
