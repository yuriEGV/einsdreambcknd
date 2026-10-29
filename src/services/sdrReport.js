/**
 * sdrReport.js
 * Motor de medición e interpretación del sueño y descanso — Norma MN-SDR-001 v1.0
 *
 * Principios (norma §2, §10, §11):
 *  - Nivel 1 (datos originales) → Nivel 2 (indicadores derivados) → Nivel 3 (interpretación).
 *  - Todas las métricas se calculan desde los EVENTOS ORIGINALES. Nunca se aceptan agregados
 *    del cliente que contradigan el registro detallado.
 *  - Datos desconocidos = null, jamás 0. Sin eventos ⇒ medias nulas (no "0 segundos").
 *  - Los eventos se registran como AUD-EVT sin reconocimiento semántico: las etiquetas del
 *    detector (ronquido, tos, voz…) se conservan sólo como pistas NO verificadas.
 *  - No se declara sueño profundo/REM, apnea, insomnio ni diagnóstico alguno.
 *  - Los umbrales son parámetros internos provisionales, NO límites médicos.
 */

export const STANDARD = { id: 'MN-SDR-001', version: '1.0' };
export const SDR_ALGORITHM = { id: 'sdr-engine', version: '1.0.0' };

/** Parámetros configurables y documentados (norma §4.3, §5.6, §6.1, §9). */
export const DEFAULT_CONFIG = {
    clusterGapSec: 300,          // Dos eventos con separación ≤ este valor pertenecen a la misma agrupación
    coincidenceWindowSec: 30,    // Ventana de coincidencia entre fuentes (sólo si hay sensor de movimiento)
    duplicateToleranceMs: 1000,  // Eventos con igual inicio (±) y duración se consideran duplicados
    maxEventDurationSec: 3600,   // Duración superior ⇒ lectura anómala
    minCoveragePct: 70,          // Cobertura mínima para interpretar (P5 si es menor)
    minValidMinutes: 120,        // Tiempo válido mínimo para interpretar (P5 si es menor)
    minQualityScore: 50,         // Calidad mínima para entrar en la referencia individual
    refMinNights: 3,             // Noches mínimas para construir REF-USER
    refMaxNights: 28,            // Noches máximas consideradas en REF-USER
    fragClusterMin: 4,           // Agrupaciones mínimas para hablar de actividad agrupada (P4)
    fragRateProvisional: 1.0,    // Agrupaciones/h provisional para P4 sin referencia
    zElevated: 1.0,              // Desvíos sobre el historial para "elevada"
    zLow: -1.0,                  // Desvíos bajo el historial para "baja"
    bucketMinutes: 60,           // Ancho de los tramos para el histograma por hora
    defaultTargetMinutes: 480    // Objetivo de duración si el perfil no define otro
};

/** Catálogo oficial de variables (norma §3): código, nombre, unidad, fuente y regla de cálculo. */
export const VARIABLE_CATALOG = [
    // 3.1 Temporales
    { code: 'SDR_TIME_START', name: 'Inicio del período monitorizado', unit: 'Fecha y hora', source: 'Aplicación móvil (botón de inicio)', rule: 'Marca de tiempo original de inicio de la sesión.' },
    { code: 'SDR_TIME_END', name: 'Fin del período monitorizado', unit: 'Fecha y hora', source: 'Aplicación móvil (botón de término)', rule: 'Marca de tiempo original de fin de la sesión.' },
    { code: 'SDR_DUR_MON', name: 'Duración monitorizada', unit: 'Minutos', source: 'Derivada', rule: 'SDR_TIME_END − SDR_TIME_START. No equivale a sueño efectivo.' },
    { code: 'SDR_DUR_SLEEP_EST', name: 'Duración estimada del sueño', unit: 'Minutos', source: 'Método validado (no disponible)', rule: 'Nulo mientras no exista un método validado para estimar cuándo la persona duerme.' },
    { code: 'SDR_DUR_AWAKE_EST', name: 'Tiempo despierto estimado durante el período', unit: 'Minutos', source: 'Método validado (no disponible)', rule: 'Nulo mientras no exista un método validado.' },
    { code: 'SDR_DUR_LATENCY_EST', name: 'Latencia estimada hasta el sueño', unit: 'Minutos', source: 'Método validado (no disponible)', rule: 'Nulo mientras no exista un método validado.' },
    { code: 'SDR_DUR_GAP', name: 'Duración de intervalos sin datos', unit: 'Minutos', source: 'Derivada', rule: 'Unión de pausas de privacidad e intervalos sin información válida dentro del período.' },
    { code: 'SDR_COV', name: 'Cobertura de datos válidos', unit: '%', source: 'Derivada', rule: 'T_válido / T_programado × 100 (§5.5).' },
    // 3.2 Acústicas
    { code: 'SDR_AUD_EVT_N', name: 'Número total de eventos acústicos', unit: 'Eventos', source: 'Micrófono', rule: 'Eventos AUD-EVT válidos y sin duplicar dentro del tiempo válido.' },
    { code: 'SDR_AUD_EVT_RATE', name: 'Frecuencia de eventos acústicos', unit: 'Eventos/h', source: 'Derivada', rule: 'N × 60 / T_válido,min (§5.1).' },
    { code: 'SDR_AUD_EVT_DUR_SUM', name: 'Duración acumulada de eventos acústicos', unit: 'Segundos', source: 'Derivada', rule: 'Longitud de la unión de intervalos acústicos; los solapes no se cuentan dos veces (§5.3).' },
    { code: 'SDR_AUD_EVT_DUR_MEAN', name: 'Duración media por evento', unit: 'Segundos', source: 'Derivada', rule: 'ΣD_i / N con duración conocida; nulo si no hay eventos (§5.2).' },
    { code: 'SDR_AUD_EVT_DUR_MAX', name: 'Duración máxima de un evento', unit: 'Segundos', source: 'Derivada', rule: 'Máximo de D_i.' },
    { code: 'SDR_AUD_INT_MAX', name: 'Intensidad máxima registrada', unit: 'dBFS relativo (sin calibrar)', source: 'Micrófono', rule: 'Valor máximo de la lectura relativa del micrófono. No son decibelios acústicos calibrados.' },
    { code: 'SDR_AUD_INT_MEAN', name: 'Intensidad media registrada', unit: 'dBFS relativo (sin calibrar)', source: 'Derivada', rule: 'Media aritmética de las lecturas relativas.' },
    { code: 'SDR_AUD_EVT_CLUSTER_N', name: 'Número de agrupaciones de eventos', unit: 'Agrupaciones', source: 'Derivada', rule: 'Eventos separados por ≤ clusterGapSec forman una agrupación (§4.3).' },
    { code: 'SDR_AUD_EVT_GAP_MEAN', name: 'Intervalo medio entre eventos consecutivos', unit: 'Segundos', source: 'Derivada', rule: 'Media de (inicio_{i+1} − fin_i) acotada a ≥ 0; nulo con < 2 eventos.' },
    { code: 'SDR_AUD_COV', name: 'Cobertura acústica válida', unit: '%', source: 'Derivada', rule: 'Igual a SDR_COV mientras no exista un latido independiente del micrófono.' },
    // 3.3 Movimiento
    { code: 'SDR_MOV_EVT_N', name: 'Número de eventos de movimiento', unit: 'Eventos', source: 'Acelerómetro (no disponible)', rule: 'Nulo si no hay sensor de movimiento.' },
    { code: 'SDR_MOV_RATE', name: 'Frecuencia de movimientos detectados', unit: 'Eventos/h', source: 'Acelerómetro (no disponible)', rule: 'Nulo si no hay sensor de movimiento.' },
    { code: 'SDR_MOV_DUR_SUM', name: 'Duración acumulada de actividad de movimiento', unit: 'Segundos', source: 'Acelerómetro (no disponible)', rule: 'Nulo si no hay sensor de movimiento.' },
    { code: 'SDR_MOV_INT_MEAN', name: 'Intensidad media del movimiento', unit: 'Unidad del sensor', source: 'Acelerómetro (no disponible)', rule: 'Nulo si no hay sensor de movimiento.' },
    { code: 'SDR_MOV_INT_MAX', name: 'Intensidad máxima del movimiento', unit: 'Unidad del sensor', source: 'Acelerómetro (no disponible)', rule: 'Nulo si no hay sensor de movimiento.' },
    { code: 'SDR_MOV_CLUSTER_N', name: 'Número de episodios agrupados de movimiento', unit: 'Episodios', source: 'Acelerómetro (no disponible)', rule: 'Nulo si no hay sensor de movimiento.' },
    { code: 'SDR_MOV_CLUSTER_DUR_MAX', name: 'Duración máxima de una agrupación de movimiento', unit: 'Segundos', source: 'Acelerómetro (no disponible)', rule: 'Nulo si no hay sensor de movimiento.' },
    { code: 'SDR_MOV_VAR', name: 'Variabilidad de la señal de movimiento', unit: 'Unidad derivada documentada', source: 'Acelerómetro (no disponible)', rule: 'Nulo si no hay sensor de movimiento.' },
    // 3.4 Continuidad
    { code: 'SDR_FRAG_EVT_N', name: 'Número de episodios de fragmentación estimada', unit: 'Episodios', source: 'Derivada', rule: 'Número de agrupaciones de actividad separadas por períodos de baja actividad (estimación).' },
    { code: 'SDR_FRAG_RATE', name: 'Frecuencia de fragmentación estimada', unit: 'Episodios/h', source: 'Derivada', rule: 'SDR_FRAG_EVT_N × 60 / T_válido,min.' },
    { code: 'SDR_QUIET_MAX', name: 'Mayor período de baja actividad detectada', unit: 'Minutos', source: 'Derivada', rule: 'Mayor tramo válido sin eventos entre agrupaciones (incluye inicio y fin de la sesión).' },
    { code: 'SDR_QUIET_MEAN', name: 'Duración media de los períodos de baja actividad', unit: 'Minutos', source: 'Derivada', rule: 'Media de los tramos válidos sin eventos.' },
    { code: 'SDR_ACTIVITY_PCT', name: 'Porcentaje del tiempo válido con actividad detectada', unit: '%', source: 'Derivada', rule: 'T_aud,activo / T_válido × 100 (§5.3). Es actividad acústica, no movimiento corporal.' },
    { code: 'SDR_DATA_QUALITY', name: 'Calidad global de los datos de la sesión', unit: 'Escala 0–100', source: 'Derivada', rule: '0,5·cobertura + 0,2·integridad de eventos + 0,3·suficiencia de duración (180 min = 100).' },
    // 8 Subíndices internos
    { code: 'SDR_SCORE_DURATION', name: 'Subíndice de duración', unit: 'Índice interno 0–100', source: 'Derivada', rule: 'Tiempo monitorizado válido / objetivo × 100. Proxy: no equivale a sueño efectivo.' },
    { code: 'SDR_SCORE_CONTINUITY', name: 'Subíndice de continuidad', unit: 'Índice interno 0–100', source: 'Derivada', rule: 'Sólo con REF-USER: 70 − 20·z̄ (z̄ = media de z de frecuencia de eventos y de fragmentación). 70 ≈ habitual.' },
    { code: 'SDR_SCORE_REGULARITY', name: 'Subíndice de regularidad', unit: 'Índice interno 0–100', source: 'Derivada', rule: '100 − (desvío medio de hora de inicio y fin − 15 min)/105 × 100, contra REF-USER o el objetivo del perfil.' },
    { code: 'SDR_SCORE_CONFIDENCE', name: 'Confianza en los datos', unit: 'Índice interno 0–100', source: 'Derivada', rule: 'Igual a SDR_DATA_QUALITY.' }
];

export const EVENT_CLASSES = [
    { code: 'AUD-EVT', name: 'Evento acústico', meaning: 'Evento detectado por el sistema acústico' },
    { code: 'MOV-EVT', name: 'Evento de movimiento', meaning: 'Movimiento detectado por un sensor de movimiento' },
    { code: 'ACT-EVT', name: 'Evento de actividad', meaning: 'Actividad detectada a partir de una fuente documentada' },
    { code: 'MIX-EVT', name: 'Evento multimodal', meaning: 'Coincidencia temporal de eventos de distintas fuentes' },
    { code: 'UNK-EVT', name: 'Evento de origen indeterminado', meaning: 'Evento cuya fuente o naturaleza no puede establecerse' },
    { code: 'GAP-EVT', name: 'Intervalo sin datos', meaning: 'Período en que no existe información válida' }
];

export const PATTERN_LABELS = {
    P1: 'Actividad detectada baja',
    P2: 'Actividad detectada moderada',
    P3: 'Actividad detectada elevada',
    P4: 'Actividad agrupada o fragmentada',
    P5: 'Información insuficiente'
};

/* ───────────────────────────── utilidades ───────────────────────────── */

const toMs = (v) => {
    if (v === null || v === undefined || v === '') return null;
    const t = v instanceof Date ? v.getTime() : new Date(v).getTime();
    return Number.isFinite(t) ? t : null;
};
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const round = (v, d = 1) => (isNum(v) ? Number(v.toFixed(d)) : null);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const pad = (n, w) => String(n).padStart(w, '0');
const iso = (ms) => (isNum(ms) ? new Date(ms).toISOString() : null);

const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
const sampleSd = (arr) => {
    if (arr.length < 2) return null;
    const m = mean(arr);
    return Math.sqrt(arr.reduce((a, b) => a + (b - m) * (b - m), 0) / (arr.length - 1));
};

/** Une intervalos [ini, fin] solapados. */
function mergeIntervals(list) {
    const items = list.filter(([s, e]) => isNum(s) && isNum(e) && e >= s).sort((a, b) => a[0] - b[0]);
    const out = [];
    for (const [s, e] of items) {
        if (out.length && s <= out[out.length - 1][1]) {
            out[out.length - 1][1] = Math.max(out[out.length - 1][1], e);
        } else {
            out.push([s, e]);
        }
    }
    return out;
}
const unionLength = (merged) => merged.reduce((a, [s, e]) => a + (e - s), 0);
const overlapLength = (s, e, merged) => {
    let total = 0;
    for (const [ps, pe] of merged) {
        const lo = Math.max(s, ps);
        const hi = Math.min(e, pe);
        if (hi > lo) total += hi - lo;
    }
    return total;
};

const minuteOfDay = (ms, tzOffsetMin = 0) => {
    const local = new Date(ms + tzOffsetMin * 60000);
    return local.getUTCHours() * 60 + local.getUTCMinutes();
};
const circularDiff = (a, b) => {
    let d = a - b;
    if (d > 720) d -= 1440;
    if (d < -720) d += 1440;
    return d;
};
const circularMedian = (values) => {
    if (!values.length) return null;
    // Se desplaza el eje para que la mediana no se parta en medianoche.
    const ref = values[0];
    const shifted = values.map((v) => circularDiff(v, ref)).sort((a, b) => a - b);
    const mid = Math.floor(shifted.length / 2);
    const med = shifted.length % 2 ? shifted[mid] : (shifted[mid - 1] + shifted[mid]) / 2;
    return ((ref + med) % 1440 + 1440) % 1440;
};

const fmtNum = (n, d = 1) => (isNum(n) ? n.toFixed(d).replace('.', ',') : '—');
const fmtMinutes = (min) => {
    if (!isNum(min)) return '—';
    const h = Math.floor(min / 60);
    const m = Math.round(min % 60);
    return h > 0 ? `${h} h ${m} min` : `${m} min`;
};

/* ───────────────────── Nivel 1 + 2: análisis de una sesión ───────────────────── */

/**
 * Normaliza los eventos originales (§4.2) y calcula los indicadores derivados.
 * No usa ningún agregado enviado por el cliente.
 */
export function analyzeSession(session, config = {}) {
    const cfg = { ...DEFAULT_CONFIG, ...config };
    const startMs = toMs(session.startTime);
    const endMs = toMs(session.endTime);
    const sessionDate = session.sessionDate || (isNum(startMs) ? new Date(startMs).toISOString().slice(0, 10) : 'unknown');
    const sessionId = session.sessionId || `SES-${sessionDate.replace(/-/g, '')}-01`;

    const core = {
        sessionId,
        sessionDate,
        tzOffsetMin: isNum(session.tzOffsetMin) ? session.tzOffsetMin : null,
        startMs,
        endMs,
        windowOk: isNum(startMs) && isNum(endMs) && endMs > startMs,
        cfg,
        events: [],
        validEvents: [],
        clusters: [],
        pauses: [],
        discarded: { synthetic: 0, duplicate: 0, out_of_window: 0, in_pause: 0, invalid_time: 0 },
        anomalies: { anomalous_duration: 0, anomalous_intensity: 0 },
        metrics: null
    };

    if (!core.windowOk) {
        core.metrics = emptyMetrics();
        return core;
    }

    const programmedMs = endMs - startMs;

    // Pausas de privacidad → intervalos GAP-EVT
    const pauseRaw = [];
    for (const p of (session.pauseSegments || [])) {
        const s = toMs(p.pausedAt);
        const e = toMs(p.resumedAt);
        if (isNum(s) && isNum(e)) pauseRaw.push([Math.max(startMs, s), Math.min(endMs, e)]);
    }
    if (!pauseRaw.length) {
        for (const p of (session.pauseIntervals || [])) {
            if (isNum(p.startMs) && isNum(p.endMs)) {
                pauseRaw.push([Math.max(startMs, startMs + p.startMs), Math.min(endMs, startMs + p.endMs)]);
            }
        }
    }
    core.pauses = mergeIntervals(pauseRaw.filter(([s, e]) => e > s));
    const gapMs = unionLength(core.pauses);
    const validMs = Math.max(0, programmedMs - gapMs);

    // Eventos originales
    const rawEvents = (session.correlatedEvents && session.correlatedEvents.length)
        ? session.correlatedEvents
        : (session.soundEvents || []);

    const prepared = [];
    for (const e of rawEvents) {
        if (e.synthetic === true || e.source === 'synthetic') { core.discarded.synthetic++; continue; }

        let s = toMs(e.timestamp);
        const off = isNum(e.offsetMs) ? e.offsetMs : (isNum(e.relativeMs) ? e.relativeMs : null);
        if (s === null && off !== null) s = startMs + off;
        if (s === null) { core.discarded.invalid_time++; continue; }

        let durS = null;
        const d = Number(e.duration);
        if (Number.isFinite(d) && d > 0) {
            if (d > cfg.maxEventDurationSec) core.anomalies.anomalous_duration++;
            else durS = d;
        }

        let intensity = null;
        if (isNum(e.peakDb)) intensity = e.peakDb;
        else if (isNum(e.intensityDb)) intensity = -Math.abs(e.intensityDb);
        if (intensity !== null && (Math.abs(intensity) > 200)) {
            core.anomalies.anomalous_intensity++;
            intensity = null;
        }

        let confidence = null;
        if (isNum(e.confidence)) confidence = e.confidence > 1 ? e.confidence / 100 : e.confidence;

        prepared.push({
            startMs: s,
            durS,
            endMs: s + (durS ? durS * 1000 : 0),
            intensity,
            confidence: confidence !== null ? round(confidence, 2) : null,
            hint: e.eventType || e.type || null
        });
    }
    prepared.sort((a, b) => a.startMs - b.startMs);

    let counter = 0;
    let last = null;
    for (const ev of prepared) {
        let flag = 'valid';
        if (ev.startMs < startMs || ev.startMs > endMs) flag = 'out_of_window';
        else if (overlapLength(ev.startMs, ev.startMs + 1, core.pauses) > 0) flag = 'in_pause';
        else if (last
            && Math.abs(ev.startMs - last.startMs) <= cfg.duplicateToleranceMs
            && Math.abs((ev.durS || 0) - (last.durS || 0)) <= 0.5) {
            flag = 'duplicate';
        }
        if (flag !== 'valid') {
            core.discarded[flag]++;
            continue;
        }
        counter++;
        const full = {
            event_id: `EVT-${pad(counter, 6)}`,
            session_id: sessionId,
            event_type: 'AUD-EVT',
            start_ts: iso(ev.startMs),
            end_ts: iso(ev.endMs),
            duration_s: ev.durS,
            intensity_value: ev.intensity,
            intensity_unit: 'dBFS relativo (sin calibrar)',
            source: 'microphone',
            quality_flag: 'valid',
            confidence: ev.confidence,
            cluster_id: null,
            detector_hint: ev.hint,
            _s: ev.startMs,
            _e: ev.endMs
        };
        core.events.push(full);
        last = ev;
    }
    core.validEvents = core.events;

    // Agrupación temporal configurable (§4.3)
    const gapThreshold = cfg.clusterGapSec * 1000;
    let current = null;
    let clusterCounter = 0;
    for (const ev of core.validEvents) {
        if (!current || ev._s - current.endMs > gapThreshold) {
            clusterCounter++;
            current = {
                cluster_id: `CL-${pad(clusterCounter, 5)}`,
                events: [],
                startMs: ev._s,
                endMs: ev._e
            };
            core.clusters.push(current);
        }
        current.events.push(ev);
        current.endMs = Math.max(current.endMs, ev._e);
        ev.cluster_id = current.cluster_id;
    }
    for (const c of core.clusters) {
        const gaps = [];
        let maxEnd = c.events[0]._e;
        for (let i = 1; i < c.events.length; i++) {
            gaps.push(Math.max(0, (c.events[i]._s - maxEnd) / 1000));
            maxEnd = Math.max(maxEnd, c.events[i]._e);
        }
        const ints = c.events.map((e) => e.intensity_value).filter(isNum);
        c.summary = {
            cluster_id: c.cluster_id,
            event_count: c.events.length,
            start_ts: iso(c.startMs),
            end_ts: iso(c.endMs),
            span_s: round((c.endMs - c.startMs) / 1000, 1),   // duración de la agrupación
            active_s: round(unionLength(mergeIntervals(c.events.filter((e) => e.duration_s).map((e) => [e._s, e._e]))) / 1000, 1), // acústica acumulada
            intervals_s: gaps.map((g) => round(g, 1)),
            intensity_max: ints.length ? Math.max(...ints) : null,
            intensity_mean: ints.length ? round(mean(ints), 1) : null,
            sources: ['microphone']
        };
    }

    // Indicadores derivados (§5)
    const N = core.validEvents.length;
    const validMin = validMs / 60000;
    const durations = core.validEvents.map((e) => e.duration_s).filter(isNum);
    const merged = mergeIntervals(core.validEvents.filter((e) => e.duration_s).map((e) => [e._s, e._e]));
    const activeMs = unionLength(merged);
    const intensities = core.validEvents.map((e) => e.intensity_value).filter(isNum);

    const eventGaps = [];
    if (N > 1) {
        let maxEnd = core.validEvents[0]._e;
        for (let i = 1; i < N; i++) {
            eventGaps.push(Math.max(0, (core.validEvents[i]._s - maxEnd) / 1000));
            maxEnd = Math.max(maxEnd, core.validEvents[i]._e);
        }
    }

    // Períodos de baja actividad: tramos válidos entre agrupaciones (incluye inicio y fin)
    const quiet = [];
    const pushQuiet = (s, e, requireThreshold) => {
        if (e <= s) return;
        const validLen = (e - s) - overlapLength(s, e, core.pauses);
        if (validLen <= 0) return;
        if (requireThreshold && validLen < gapThreshold) return;
        quiet.push(validLen / 60000);
    };
    if (core.clusters.length === 0) {
        pushQuiet(startMs, endMs, false);
    } else {
        pushQuiet(startMs, core.clusters[0].startMs, true);
        for (let i = 1; i < core.clusters.length; i++) pushQuiet(core.clusters[i - 1].endMs, core.clusters[i].startMs, false);
        pushQuiet(core.clusters[core.clusters.length - 1].endMs, endMs, true);
    }

    const coveragePct = programmedMs > 0 ? (validMs / programmedMs) * 100 : null;
    const integrityDen = N + core.discarded.duplicate + core.discarded.out_of_window + core.discarded.in_pause
        + core.discarded.invalid_time + core.anomalies.anomalous_duration + core.anomalies.anomalous_intensity;
    const integrityPct = integrityDen > 0 ? (N - core.anomalies.anomalous_duration - core.anomalies.anomalous_intensity) / integrityDen * 100 : 100;
    const lengthFactor = clamp(validMin / 180, 0, 1);
    const quality = round(clamp(0.5 * (coveragePct || 0) + 0.2 * clamp(integrityPct, 0, 100) + 0.3 * lengthFactor * 100, 0, 100), 0);

    core.metrics = {
        programmed_min: round(programmedMs / 60000, 1),
        valid_min: round(validMin, 1),
        gap_min: round(gapMs / 60000, 1),
        coverage_pct: round(coveragePct, 2),
        event_count: N,
        events_per_hour: validMin > 0 ? round((N * 60) / validMin, 2) : null,
        active_duration_s: durations.length ? round(activeMs / 1000, 1) : null,
        mean_event_duration_s: durations.length ? round(mean(durations), 2) : null,
        max_event_duration_s: durations.length ? Math.max(...durations) : null,
        intensity_max: intensities.length ? Math.max(...intensities) : null,
        intensity_mean: intensities.length ? round(mean(intensities), 1) : null,
        cluster_count: core.clusters.length,
        event_gap_mean_s: eventGaps.length ? round(mean(eventGaps), 1) : null,
        activity_pct: validMin > 0 && durations.length ? round((activeMs / 60000 / validMin) * 100, 3) : null,
        frag_rate: validMin > 0 ? round((core.clusters.length * 60) / validMin, 2) : null,
        quiet_max_min: quiet.length ? round(Math.max(...quiet), 1) : null,
        quiet_mean_min: quiet.length ? round(mean(quiet), 1) : null,
        data_quality: quality,
        integrity_pct: round(integrityPct, 1)
    };
    return core;
}

function emptyMetrics() {
    return {
        programmed_min: null, valid_min: null, gap_min: null, coverage_pct: null, event_count: null,
        events_per_hour: null, active_duration_s: null, mean_event_duration_s: null, max_event_duration_s: null,
        intensity_max: null, intensity_mean: null, cluster_count: null, event_gap_mean_s: null, activity_pct: null,
        frag_rate: null, quiet_max_min: null, quiet_mean_min: null, data_quality: 0, integrity_pct: null
    };
}

/* ───────────────────────── Referencia individual (§9) ───────────────────────── */

export function isSufficient(core) {
    const m = core.metrics;
    return core.windowOk
        && isNum(m.coverage_pct) && m.coverage_pct >= core.cfg.minCoveragePct
        && isNum(m.valid_min) && m.valid_min >= core.cfg.minValidMinutes
        && isNum(m.data_quality) && m.data_quality >= core.cfg.minQualityScore;
}

/**
 * Construye REF-USER con noches anteriores de calidad suficiente.
 * @param {Array} priorCores resultados de analyzeSession de noches previas del mismo usuario
 */
export function buildReference(priorCores, cfg = DEFAULT_CONFIG) {
    const usable = priorCores.filter(isSufficient)
        .sort((a, b) => (a.sessionDate < b.sessionDate ? 1 : -1))
        .slice(0, cfg.refMaxNights);

    if (usable.length < cfg.refMinNights) {
        return {
            type: 'REF-NONE',
            nights_used: usable.length,
            nights_required: cfg.refMinNights,
            note: `Sin referencia individual suficiente: se requieren ${cfg.refMinNights} noches previas comparables y hay ${usable.length}.`
        };
    }

    const series = (key) => usable.map((c) => c.metrics[key]).filter(isNum);
    const stat = (key, floor) => {
        const vals = series(key);
        const m = mean(vals);
        if (m === null) return null;
        const sd = sampleSd(vals) ?? 0;
        return { mean: round(m, 3), sd: round(sd, 3), sd_adj: round(Math.max(sd, 0.2 * Math.abs(m), floor), 3), n: vals.length };
    };

    const beds = usable.filter((c) => isNum(c.startMs)).map((c) => minuteOfDay(c.startMs, c.tzOffsetMin || 0));
    const wakes = usable.filter((c) => isNum(c.endMs)).map((c) => minuteOfDay(c.endMs, c.tzOffsetMin || 0));

    return {
        type: 'REF-USER',
        nights_used: usable.length,
        from_date: usable[usable.length - 1].sessionDate,
        to_date: usable[0].sessionDate,
        method: `Media y desvío estándar (n-1) de noches previas con cobertura ≥ ${cfg.minCoveragePct}%, ≥ ${cfg.minValidMinutes} min válidos y calidad ≥ ${cfg.minQualityScore}; máx. ${cfg.refMaxNights} noches.`,
        events_per_hour: stat('events_per_hour', 0.5),
        activity_pct: stat('activity_pct', 0.05),
        frag_rate: stat('frag_rate', 0.2),
        valid_min: stat('valid_min', 30),
        bedtime_minute_median: round(circularMedian(beds), 0),
        waketime_minute_median: round(circularMedian(wakes), 0)
    };
}

const zScore = (value, st) => (isNum(value) && st && st.sd_adj > 0 ? (value - st.mean) / st.sd_adj : null);

/* ───────────────────────── Nivel 3: informe completo ───────────────────────── */

/**
 * @param {Object} session   sesión (lean)
 * @param {Object} opts
 * @param {Array}  opts.priorSessions   noches previas del MISMO usuario (cualquier orden)
 * @param {Array}  opts.priorCores      alternativamente, resultados ya analizados
 * @param {Object} opts.profile         SleepProfile del usuario
 * @param {Object} opts.config          sobreescritura de parámetros
 * @param {boolean} opts.includeEvents  incluir eventos originales normalizados
 */
export function buildSdrReport(session, opts = {}) {
    const { priorSessions = [], priorCores = null, profile = {}, config = {}, includeEvents = false } = opts;
    const core = analyzeSession(session, config);
    const cfg = core.cfg;
    const m = core.metrics;

    const priors = priorCores || priorSessions
        .filter((p) => p && p.sessionDate && p.sessionDate < core.sessionDate && String(p._id) !== String(session._id))
        .map((p) => analyzeSession(p, config));
    const reference = buildReference(priors, cfg);
    const sufficient = isSufficient(core);
    const tz = core.tzOffsetMin ?? 0;

    // ── Comparación con la referencia ──────────────────────────────────────
    const comparison = {};
    let zRate = null; let zPct = null; let zFrag = null;
    if (reference.type === 'REF-USER') {
        zRate = zScore(m.events_per_hour, reference.events_per_hour);
        zPct = zScore(m.activity_pct, reference.activity_pct);
        zFrag = zScore(m.frag_rate, reference.frag_rate);
        const delta = (v, st) => (isNum(v) && st && st.mean > 0 ? round(((v - st.mean) / st.mean) * 100, 1) : null);
        comparison.events_per_hour_delta_pct = delta(m.events_per_hour, reference.events_per_hour);
        comparison.activity_pct_delta_pct = delta(m.activity_pct, reference.activity_pct);
        comparison.frag_rate_delta_pct = delta(m.frag_rate, reference.frag_rate);
        comparison.z_events_per_hour = round(zRate, 2);
        comparison.z_activity_pct = round(zPct, 2);
        comparison.z_frag_rate = round(zFrag, 2);
    }

    // ── Patrón nocturno P1–P5 (§6.1) ─────────────────────────────────────
    const flags = [];
    let code = null;
    let state = 'PENDING_REFERENCE';
    let reason = '';
    if (!sufficient) {
        code = 'P5'; state = 'INSUFFICIENT_DATA';
        const why = [];
        if (!core.windowOk) why.push('la sesión no tiene un inicio y fin válidos');
        else {
            if (!isNum(m.coverage_pct) || m.coverage_pct < cfg.minCoveragePct) why.push(`cobertura ${fmtNum(m.coverage_pct, 1)}% (< ${cfg.minCoveragePct}%)`);
            if (!isNum(m.valid_min) || m.valid_min < cfg.minValidMinutes) why.push(`tiempo válido ${fmtMinutes(m.valid_min)} (< ${fmtMinutes(cfg.minValidMinutes)})`);
            if (isNum(m.data_quality) && m.data_quality < cfg.minQualityScore) why.push(`calidad de datos ${m.data_quality}/100`);
        }
        reason = `Cobertura, calidad o duración insuficientes: ${why.join('; ')}.`;
    } else {
        const clusters = m.cluster_count || 0;
        const p4 = reference.type === 'REF-USER'
            ? (isNum(zFrag) && zFrag >= cfg.zElevated && clusters >= 3)
            : (clusters >= cfg.fragClusterMin && isNum(m.frag_rate) && m.frag_rate >= cfg.fragRateProvisional);
        const p3 = reference.type === 'REF-USER' && ((isNum(zRate) && zRate >= cfg.zElevated) || (isNum(zPct) && zPct >= cfg.zElevated));
        const p1 = reference.type === 'REF-USER' && isNum(zRate) && zRate <= cfg.zLow && (zPct === null || zPct <= cfg.zLow);
        if (p4) flags.push('P4');
        if (p3) flags.push('P3');
        if (p4) { code = 'P4'; state = 'CLASSIFIED'; reason = `Las ${clusters} agrupaciones de eventos se alternan con períodos de baja actividad.`; }
        else if (p3) { code = 'P3'; state = 'CLASSIFIED'; reason = 'La frecuencia o la duración de eventos supera tu rango de referencia individual.'; }
        else if (p1) { code = 'P1'; state = 'CLASSIFIED'; reason = 'La frecuencia y la actividad acústica quedan bajo tu rango de referencia individual.'; }
        else if (reference.type === 'REF-USER') { code = 'P2'; state = 'CLASSIFIED'; reason = 'La frecuencia y la duración de eventos están dentro de tu rango de referencia individual.'; }
        else { code = null; state = 'PENDING_REFERENCE'; reason = reference.note; }
        if (p1 && !flags.includes('P1') && code === 'P1') flags.push('P1');
    }

    // ── Subíndices (§8): independientes, nunca se suman ──────────────────
    const targetMin = isNum(profile.targetSleepMinutes) && profile.targetSleepMinutes > 0 ? profile.targetSleepMinutes : cfg.defaultTargetMinutes;
    const targetSource = isNum(profile.targetSleepMinutes) && profile.targetSleepMinutes > 0 ? 'perfil del usuario' : 'valor por defecto (8 h)';
    const durationScore = isNum(m.valid_min) ? clamp(Math.round((m.valid_min / targetMin) * 100), 0, 100) : null;

    let continuityScore = null;
    if (sufficient && reference.type === 'REF-USER') {
        const zs = [zRate, zFrag].filter(isNum);
        if (zs.length) continuityScore = clamp(Math.round(70 - 20 * mean(zs)), 0, 100);
    }

    let regularityScore = null; let regularityRef = null; let regDev = null;
    if (core.windowOk) {
        const bedMin = minuteOfDay(core.startMs, tz);
        const wakeMin = minuteOfDay(core.endMs, tz);
        let refBed = null; let refWake = null;
        if (reference.type === 'REF-USER' && isNum(reference.bedtime_minute_median)) {
            refBed = reference.bedtime_minute_median; refWake = reference.waketime_minute_median; regularityRef = 'REF-USER';
        } else if (profile.baselineAssessmentCompleted && core.tzOffsetMin !== null && profile.targetBedtime && profile.targetWakeTime) {
            const parse = (s) => { const [h, mi] = String(s).split(':').map(Number); return h * 60 + mi; };
            refBed = parse(profile.targetBedtime); refWake = parse(profile.targetWakeTime); regularityRef = 'perfil (Sleep Test)';
        }
        if (refBed !== null && refWake !== null) {
            regDev = (Math.abs(circularDiff(bedMin, refBed)) + Math.abs(circularDiff(wakeMin, refWake))) / 2;
            regularityScore = clamp(Math.round(100 - (Math.max(0, regDev - 15) / 105) * 100), 0, 100);
        }
    }

    const subindices = {
        SDR_SCORE_DURATION: {
            value: durationScore,
            basis: 'monitored_time_proxy',
            note: `Tiempo monitorizado válido (${fmtMinutes(m.valid_min)}) frente al objetivo de ${fmtMinutes(targetMin)} (${targetSource}). No equivale a sueño efectivo.`
        },
        SDR_SCORE_CONTINUITY: {
            value: continuityScore,
            basis: reference.type,
            note: continuityScore === null
                ? 'No establecido: requiere cobertura suficiente y referencia individual (REF-USER).'
                : 'Escala interna relativa a tu historial: 70 ≈ habitual; menos = más actividad/fragmentación que lo habitual.'
        },
        SDR_SCORE_REGULARITY: {
            value: regularityScore,
            basis: regularityRef,
            deviation_min: round(regDev, 0),
            note: regularityScore === null
                ? 'No establecido: requiere noches previas o un perfil (Sleep Test) con huso horario.'
                : `Desvío medio de ${fmtNum(regDev, 0)} min en hora de inicio/fin respecto de ${regularityRef}. La hora de inicio de la monitorización se usa como proxy de la hora de acostarse.`
        },
        SDR_SCORE_CONFIDENCE: {
            value: isNum(m.data_quality) ? Math.round(m.data_quality) : null,
            basis: 'data_quality',
            note: 'Cuánto puede confiar el sistema en su propia evaluación (cobertura, integridad y duración).'
        },
        _disclaimer: 'Índices internos de seguimiento, no mediciones clínicas validadas. No se suman en una puntuación única (§8).'
    };

    // ── Interpretación (§10): observaciones / estimaciones / recomendaciones ──
    const observations = [];
    const estimations = [];
    const recommendations = [];
    const limitations = [
        'Los eventos son detecciones acústicas del micrófono; no se reconoce si corresponden a habla, tos, ronquidos, suspiros, golpes u otros sonidos.',
        'Un evento acústico no demuestra un despertar y un período silencioso no demuestra que la persona estuviera durmiendo.',
        'No se dispone de acelerómetro u otro sensor de movimiento: no se mide agitación corporal.',
        'No existe un método validado para estimar el sueño: la duración mostrada es tiempo monitorizado, no sueño efectivo.',
        'Los umbrales son parámetros internos provisionales y no límites médicos universales. Este informe no es un diagnóstico.'
    ];

    if (!core.windowOk) {
        observations.push('La sesión no cuenta con un inicio y un fin válidos; no es posible calcular indicadores.');
    } else {
        observations.push(`Período monitorizado: ${fmtMinutes(m.programmed_min)}; tiempo válido: ${fmtMinutes(m.valid_min)} (cobertura ${fmtNum(m.coverage_pct, 1)}%).`);
        if (m.gap_min > 0) observations.push(`Se registraron ${fmtMinutes(m.gap_min)} sin datos (pausas de privacidad o interrupciones), excluidos del cálculo.`);
        if (m.event_count === 0) {
            observations.push('No se detectaron eventos acústicos durante el tiempo válido. Esto no permite concluir que la noche fuera tranquila: la ausencia de eventos puede deberse a un micrófono desconectado, permisos o pérdida de datos.');
        } else {
            observations.push(`Durante el período válido de monitorización se detectaron ${m.event_count} eventos acústicos, con una frecuencia media de ${fmtNum(m.events_per_hour, 1)} eventos por hora.`);
            if (isNum(m.active_duration_s)) {
                observations.push(`Los eventos sumaron ${fmtNum(m.active_duration_s, 0)} segundos de actividad acústica (duración media ${fmtNum(m.mean_event_duration_s, 1)} s; máxima ${fmtNum(m.max_event_duration_s, 1)} s) y se distribuyeron en ${m.cluster_count} agrupaciones temporales (separación máxima entre eventos de una misma agrupación: ${fmtMinutes(cfg.clusterGapSec / 60)}).`);
            } else {
                observations.push(`Los eventos se distribuyeron en ${m.cluster_count} agrupaciones temporales; el dispositivo no entregó la duración de los eventos.`);
            }
        }
        if (m.quiet_max_min !== null) observations.push(`El mayor período de baja actividad detectada fue de ${fmtMinutes(m.quiet_max_min)}.`);
        const dropped = Object.entries(core.discarded).filter(([, v]) => v > 0);
        if (dropped.length) {
            const names = { synthetic: 'sintéticos', duplicate: 'duplicados', out_of_window: 'fuera del período', in_pause: 'dentro de una pausa', invalid_time: 'sin marca de tiempo válida' };
            observations.push(`Control de calidad: se excluyeron eventos ${dropped.map(([k, v]) => `${names[k]} (${v})`).join(', ')}.`);
        }

        estimations.push('Duración estimada del sueño: no establecida (sin método validado).');
        if (code && code !== 'P5') {
            estimations.push(`Patrón descriptivo: ${code} — ${PATTERN_LABELS[code]}. ${reason}`);
        } else if (code === 'P5') {
            estimations.push(`Patrón descriptivo: P5 — ${PATTERN_LABELS.P5}. ${reason}`);
        } else {
            estimations.push(`Patrón descriptivo: pendiente de referencia. ${reason}`);
        }
        if (reference.type === 'REF-USER') {
            const parts = [];
            if (isNum(comparison.events_per_hour_delta_pct)) parts.push(`frecuencia de eventos ${comparison.events_per_hour_delta_pct >= 0 ? '+' : ''}${fmtNum(comparison.events_per_hour_delta_pct, 0)}%`);
            if (isNum(comparison.frag_rate_delta_pct)) parts.push(`fragmentación estimada ${comparison.frag_rate_delta_pct >= 0 ? '+' : ''}${fmtNum(comparison.frag_rate_delta_pct, 0)}%`);
            if (parts.length) estimations.push(`Frente a tu referencia individual (REF-USER, ${reference.nights_used} noches): ${parts.join('; ')}. Es una comparación con tu historial, no una evaluación médica.`);
        }
        if (flags.length > 1) estimations.push(`Otros rasgos coincidentes: ${flags.filter((f) => f !== code).map((f) => PATTERN_LABELS[f]).join(', ')}.`);

        if (!sufficient) {
            recommendations.push('Revisa la posición del teléfono, la batería y los permisos del micrófono, y evita pausas prolongadas, para que la próxima sesión alcance una cobertura suficiente.');
        }
        if (reference.type !== 'REF-USER') {
            recommendations.push('Continúa registrando noches comparables (mismo dispositivo y ubicación) para construir tu referencia individual.');
        }
        if (code === 'P3' || code === 'P4') {
            recommendations.push('Observa si este patrón se repite en varias noches antes de sacar conclusiones. Si persisten molestias o somnolencia durante el día, consulta a un profesional de la salud; este informe no constituye un diagnóstico.');
        }
        if (!session.subjective || !session.subjective.submittedAt) {
            recommendations.push('Completa la valoración subjetiva al despertar (sensación de descanso, energía y somnolencia): el micrófono no puede medir la recuperación percibida.');
        }
        if (!recommendations.length) {
            recommendations.push('Mantén horarios regulares de acostarse y levantarse y sigue registrando para comparar tus noches.');
        }
    }

    const uncertainty = (!sufficient)
        ? { level: 'high', label: 'Alta', note: 'Datos insuficientes: la sesión no respalda una interpretación fiable.' }
        : (reference.type === 'REF-USER' && m.data_quality >= 75)
            ? { level: 'low', label: 'Baja-moderada', note: 'Datos suficientes y referencia individual disponible. Persisten las limitaciones del método acústico.' }
            : { level: 'medium', label: 'Media', note: 'Datos suficientes, pero sin referencia individual completa o con calidad limitada.' };

    const summaryText = !core.windowOk
        ? 'La sesión no tiene un período válido y no se pudo generar una interpretación.'
        : m.event_count === 0
            ? `Durante el período válido de monitorización (${fmtMinutes(m.valid_min)}) no se detectaron eventos acústicos. Con una cobertura de ${fmtNum(m.coverage_pct, 1)}%, este resultado no permite afirmar que la noche fuera tranquila sin verificar el funcionamiento del micrófono.`
            : `Durante el período válido de monitorización se detectaron ${m.event_count} eventos acústicos, con una frecuencia media de ${fmtNum(m.events_per_hour, 1)} eventos por hora.`
                + (isNum(m.active_duration_s) ? ` Los eventos sumaron ${fmtNum(m.active_duration_s, 0)} segundos de actividad` : '')
                + ` y se distribuyeron en ${m.cluster_count} ${m.cluster_count === 1 ? 'agrupación temporal' : 'agrupaciones temporales'}. `
                + 'Estos resultados describen la actividad acústica registrada, pero no permiten determinar por sí solos si la persona habló, tosió, roncó o despertó. '
                + 'La valoración de la continuidad del descanso requiere considerar otros indicadores y la calidad de los datos.';

    // ── Gráficos: tramos por hora y eventos compactos ───────────────────────
    const charts = { hourly: [], clusters: core.clusters.map((c) => c.summary) };
    if (core.windowOk) {
        const bucketMs = cfg.bucketMinutes * 60000;
        const total = Math.ceil((core.endMs - core.startMs) / bucketMs);
        for (let i = 0; i < total; i++) {
            const bs = core.startMs + i * bucketMs;
            const be = Math.min(core.endMs, bs + bucketMs);
            const validLen = (be - bs) - overlapLength(bs, be, core.pauses);
            const inBucket = core.validEvents.filter((e) => e._s >= bs && e._s < be || (i === total - 1 && e._s === be));
            const act = unionLength(mergeIntervals(inBucket.filter((e) => e.duration_s).map((e) => [e._s, e._e])));
            charts.hourly.push({
                index: i + 1,
                start_ts: iso(bs),
                end_ts: iso(be),
                valid_min: round(validLen / 60000, 1),
                events: inBucket.length,
                events_per_hour: validLen >= 10 * 60000 ? round((inBucket.length * 3600000) / validLen, 2) : null,
                active_s: round(act / 1000, 1),
                clusters: core.clusters.filter((c) => c.startMs >= bs && c.startMs < be).length
            });
        }
    }

    const events = includeEvents
        ? core.validEvents.map(({ _s, _e, ...rest }) => ({ ...rest, offset_min: round((_s - core.startMs) / 60000, 2) }))
        : undefined;

    const hintCounts = {};
    for (const e of core.validEvents) {
        const k = e.detector_hint || 'sin_etiqueta';
        hintCounts[k] = (hintCounts[k] || 0) + 1;
    }

    const variables = {
        SDR_TIME_START: { value: iso(core.startMs), unit: 'ISO 8601 (UTC)' },
        SDR_TIME_END: { value: iso(core.endMs), unit: 'ISO 8601 (UTC)' },
        SDR_DUR_MON: { value: m.programmed_min, unit: 'min' },
        SDR_DUR_SLEEP_EST: { value: null, unit: 'min' },
        SDR_DUR_AWAKE_EST: { value: null, unit: 'min' },
        SDR_DUR_LATENCY_EST: { value: null, unit: 'min' },
        SDR_DUR_GAP: { value: m.gap_min, unit: 'min' },
        SDR_COV: { value: m.coverage_pct, unit: '%' },
        SDR_AUD_EVT_N: { value: m.event_count, unit: 'eventos' },
        SDR_AUD_EVT_RATE: { value: m.events_per_hour, unit: 'eventos/h' },
        SDR_AUD_EVT_DUR_SUM: { value: m.active_duration_s, unit: 's' },
        SDR_AUD_EVT_DUR_MEAN: { value: m.mean_event_duration_s, unit: 's' },
        SDR_AUD_EVT_DUR_MAX: { value: m.max_event_duration_s, unit: 's' },
        SDR_AUD_INT_MAX: { value: m.intensity_max, unit: 'dBFS relativo (sin calibrar)' },
        SDR_AUD_INT_MEAN: { value: m.intensity_mean, unit: 'dBFS relativo (sin calibrar)' },
        SDR_AUD_EVT_CLUSTER_N: { value: m.cluster_count, unit: 'agrupaciones' },
        SDR_AUD_EVT_GAP_MEAN: { value: m.event_gap_mean_s, unit: 's' },
        SDR_AUD_COV: { value: m.coverage_pct, unit: '%' },
        SDR_MOV_EVT_N: { value: null, unit: 'eventos' },
        SDR_MOV_RATE: { value: null, unit: 'eventos/h' },
        SDR_FRAG_EVT_N: { value: m.cluster_count, unit: 'episodios' },
        SDR_FRAG_RATE: { value: m.frag_rate, unit: 'episodios/h' },
        SDR_QUIET_MAX: { value: m.quiet_max_min, unit: 'min' },
        SDR_QUIET_MEAN: { value: m.quiet_mean_min, unit: 'min' },
        SDR_ACTIVITY_PCT: { value: m.activity_pct, unit: '%' },
        SDR_DATA_QUALITY: { value: m.data_quality, unit: '0–100' }
    };

    return {
        standard_id: STANDARD.id,
        standard_version: STANDARD.version,
        algorithm: { ...SDR_ALGORITHM, params: { clusterGapSec: cfg.clusterGapSec, minCoveragePct: cfg.minCoveragePct, minValidMinutes: cfg.minValidMinutes, refMinNights: cfg.refMinNights } },
        generated_at: new Date().toISOString(),
        session_id: core.sessionId,
        session_date: core.sessionDate,
        time_start: iso(core.startMs),
        time_end: iso(core.endMs),
        tz_offset_min: core.tzOffsetMin,
        monitoring: {
            duration_min: m.programmed_min,
            valid_duration_min: m.valid_min,
            gap_min: m.gap_min,
            coverage_pct: m.coverage_pct,
            sleep_estimate_min: null,
            sleep_estimate_note: 'No establecida: no existe un método validado para estimar el sueño. Se informa tiempo monitorizado.',
            gaps: core.pauses.map(([s, e], i) => ({ event_type: 'GAP-EVT', id: `GAP-${pad(i + 1, 4)}`, start_ts: iso(s), end_ts: iso(e), duration_s: round((e - s) / 1000, 0), reason: 'privacy_pause' }))
        },
        acoustic: {
            event_count: m.event_count,
            events_per_hour: m.events_per_hour,
            active_duration_sec: m.active_duration_s,
            mean_event_duration_sec: m.mean_event_duration_s,
            max_event_duration_sec: m.max_event_duration_s,
            intensity_max: m.intensity_max,
            intensity_mean: m.intensity_mean,
            intensity_unit: 'dBFS relativo (sin calibrar)',
            event_cluster_count: m.cluster_count,
            event_gap_mean_sec: m.event_gap_mean_s,
            activity_pct: m.activity_pct,
            detector_hints: { note: 'Etiquetas del detector, NO verificadas. No se usan en ninguna conclusión.', counts: hintCounts }
        },
        movement: { sensor_available: false, event_count: null, events_per_hour: null, activity_pct: null, coincidence_pct: null },
        continuity: {
            fragmentation_episodes: m.cluster_count,
            fragmentation_rate: m.frag_rate,
            quiet_max_min: m.quiet_max_min,
            quiet_mean_min: m.quiet_mean_min,
            activity_pct: m.activity_pct
        },
        quality: {
            data_quality: m.data_quality,
            integrity_pct: m.integrity_pct,
            sufficient,
            discarded: core.discarded,
            anomalies: core.anomalies
        },
        reference: { ...reference, comparison },
        pattern: { code, label: code ? PATTERN_LABELS[code] : 'Pendiente de referencia', state, reason, flags },
        subindices,
        subjective: session.subjective && session.subjective.submittedAt ? session.subjective : null,
        interpretation: {
            activity_pattern: code || 'PENDING_REFERENCE',
            sleep_quality: 'NOT_ESTABLISHED',
            clinical_diagnosis: false,
            summary: summaryText,
            observations,
            estimations,
            recommendations,
            limitations,
            uncertainty
        },
        charts,
        clusters: charts.clusters,
        variables,
        ...(events ? { events } : {})
    };
}

/**
 * Genera informes para varias noches calculando la referencia POR USUARIO
 * con las noches previas de ese usuario (historyByUser: Map<userId, sesiones[]>).
 */
export function buildSdrReportsBatch(sessions, { historyByUser = new Map(), profilesByUser = new Map(), config = {}, includeEvents = false } = {}) {
    const coreCache = new Map();
    const coreOf = (s) => {
        const key = String(s._id || `${s.userId}_${s.sessionDate}`);
        if (!coreCache.has(key)) coreCache.set(key, analyzeSession(s, config));
        return coreCache.get(key);
    };
    return sessions.map((s) => {
        const uid = String(s.userId?._id || s.userId);
        const history = historyByUser.get(uid) || sessions.filter((x) => String(x.userId?._id || x.userId) === uid);
        const priorCores = history
            .filter((p) => p.sessionDate && p.sessionDate < s.sessionDate && String(p._id) !== String(s._id))
            .map(coreOf);
        return buildSdrReport(s, { priorCores, profile: profilesByUser.get(uid) || {}, config, includeEvents });
    });
}
