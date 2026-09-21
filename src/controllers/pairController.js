import PairRoom from '../models/PairRoom.js';

// Generador de código de sala de 4 dígitos fácil para adultos mayores
function generateRoomCode() {
    return Math.floor(1000 + Math.random() * 9000).toString();
}

/**
 * POST /api/pair/create
 * Crea una nueva sala de emparejamiento para dos celulares
 */
export async function createRoom(req, res) {
    try {
        const { role = 'left', deviceId = '' } = req.body;
        const hostUserId = req.user ? req.user.userId : `host_${Date.now()}`;

        let roomCode = generateRoomCode();
        // Verificar unicidad en salas activas
        let existing = await PairRoom.findOne({ roomCode, status: { $in: ['waiting', 'paired', 'active'] } });
        let attempts = 0;
        while (existing && attempts < 5) {
            roomCode = generateRoomCode();
            existing = await PairRoom.findOne({ roomCode, status: { $in: ['waiting', 'paired', 'active'] } });
            attempts++;
        }

        const room = new PairRoom({
            roomCode,
            hostUserId,
            hostDeviceId: deviceId,
            hostRole: role === 'right' ? 'right' : 'left',
            status: 'waiting'
        });

        await room.save();

        res.status(201).json({
            success: true,
            roomId: room._id,
            roomCode: room.roomCode,
            role: room.hostRole,
            status: room.status
        });
    } catch (err) {
        console.error('Error creating pair room:', err);
        res.status(500).json({ success: false, error: 'Error al crear la sala de emparejamiento' });
    }
}

/**
 * POST /api/pair/join
 * Une el celular secundario a la sala usando el código de 4 dígitos
 */
export async function joinRoom(req, res) {
    try {
        const { roomCode, deviceId = '' } = req.body;
        if (!roomCode) {
            return res.status(400).json({ success: false, error: 'Código de sala requerido' });
        }

        const cleanCode = String(roomCode).trim();
        const room = await PairRoom.findOne({
            roomCode: cleanCode,
            status: { $in: ['waiting', 'paired'] }
        });

        if (!room) {
            return res.status(404).json({
                success: false,
                error: 'Sala no encontrada o el código expiró. Verifica los 4 dígitos.'
            });
        }

        const guestUserId = req.user ? req.user.userId : `guest_${Date.now()}`;
        // Auto-asignar el rol opuesto
        const guestRole = room.hostRole === 'left' ? 'right' : 'left';

        room.guestUserId = guestUserId;
        room.guestDeviceId = deviceId;
        room.guestRole = guestRole;
        room.status = 'paired';

        await room.save();

        res.json({
            success: true,
            roomId: room._id,
            roomCode: room.roomCode,
            role: guestRole,
            hostRole: room.hostRole,
            status: room.status
        });
    } catch (err) {
        console.error('Error joining pair room:', err);
        res.status(500).json({ success: false, error: 'Error al unirse a la sala' });
    }
}

/**
 * GET /api/pair/status/:roomId
 * Consulta el estado actual de la sala y del compañero
 */
export async function getRoomStatus(req, res) {
    try {
        const { roomId } = req.params;
        const room = await PairRoom.findById(roomId);

        if (!room) {
            return res.status(404).json({ success: false, error: 'Sala no encontrada' });
        }

        res.json({
            success: true,
            roomId: room._id,
            roomCode: room.roomCode,
            status: room.status,
            hostRole: room.hostRole,
            guestRole: room.guestRole,
            hasGuest: !!room.guestDeviceId || !!room.guestUserId,
            startedAt: room.startedAt,
            endedAt: room.endedAt
        });
    } catch (err) {
        console.error('Error getting pair room status:', err);
        res.status(500).json({ success: false, error: 'Error al consultar estado de sala' });
    }
}

/**
 * POST /api/pair/sync-clock
 * Medición NTP de offset de reloj entre dispositivos
 */
export async function syncClock(req, res) {
    try {
        const { t0 } = req.body;
        const t1 = Date.now();
        res.json({
            t0: Number(t0) || t1,
            t1,
            serverTime: t1
        });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Error en sincronización de reloj' });
    }
}

/**
 * POST /api/pair/start
 * Notifica que la sesión de noche ha comenzado en modo dual
 */
export async function startNight(req, res) {
    try {
        const { roomId } = req.body;
        const room = await PairRoom.findById(roomId);
        if (!room) {
            return res.status(404).json({ success: false, error: 'Sala no encontrada' });
        }

        room.status = 'active';
        room.startedAt = new Date();
        await room.save();

        res.json({ success: true, status: room.status, startedAt: room.startedAt });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Error al iniciar monitoreo dual' });
    }
}

/**
 * POST /api/pair/events
 * Envío de ráfagas periódicas de eventos acústicos locales (metadatos livianos)
 */
export async function pushEvents(req, res) {
    try {
        const { roomId, role, events = [] } = req.body;
        const room = await PairRoom.findById(roomId);
        if (!room) {
            return res.status(404).json({ success: false, error: 'Sala no encontrada' });
        }

        if (role === room.hostRole) {
            room.eventsHost.push(...events);
        } else {
            room.eventsGuest.push(...events);
        }

        await room.save();
        res.json({ success: true, count: events.length });
    } catch (err) {
        console.error('Error pushing events:', err);
        res.status(500).json({ success: false, error: 'Error al registrar eventos' });
    }
}

/**
 * POST /api/pair/reconcile
 * Algoritmo TDOA & Delta dB de triangulación acústica al despertar
 */
export async function reconcileRoom(req, res) {
    try {
        const { roomId, eventsHost = [], eventsGuest = [], clockOffsetMs = 0 } = req.body;
        const room = await PairRoom.findById(roomId);

        const allHost = (eventsHost.length > 0) ? eventsHost : (room ? room.eventsHost : []);
        const allGuest = (eventsGuest.length > 0) ? eventsGuest : (room ? room.eventsGuest : []);

        // Normalizar timestamps de Guest con el clockOffset
        const adjustedGuest = allGuest.map(ev => ({
            ...ev,
            t_start: Number(ev.t_start) + Number(clockOffsetMs)
        }));

        const reconciled = [];
        const matchedGuestIndices = new Set();

        let hostSnoreCount = 0;
        let guestSnoreCount = 0;
        let ambientCount = 0;
        let hostDisturbancesByGuest = 0;
        let guestDisturbancesByHost = 0;

        // Emparejamiento temporal (ventana de 600 ms para sonidos correlacionados)
        for (const evA of allHost) {
            const tA = Number(evA.t_start);
            const dbA = Number(evA.peak_db) || -40;

            let closestIdx = -1;
            let minDiff = 600; // ms

            for (let j = 0; j < adjustedGuest.length; j++) {
                if (matchedGuestIndices.has(j)) continue;
                const tB = Number(adjustedGuest[j].t_start);
                const diff = Math.abs(tA - tB);
                if (diff < minDiff) {
                    minDiff = diff;
                    closestIdx = j;
                }
            }

            if (closestIdx !== -1) {
                // Evento detectado por ambos teléfonos (Cálculo TDOA + Delta dB)
                matchedGuestIndices.add(closestIdx);
                const evB = adjustedGuest[closestIdx];
                const tB = Number(evB.t_start);
                const dbB = Number(evB.peak_db) || -40;

                const deltaDb = dbA - dbB;
                const deltaT = tA - tB; // Positivo si A llegó después que B

                let assignedTo = 'ambient';

                // Matriz de Asignación Acústica
                if (deltaDb > 4 && deltaT < 15) {
                    // Más fuerte en A y llegó primero o simultáneo a A -> Pertenece al Host (A)
                    assignedTo = room ? room.hostRole : 'left';
                    hostSnoreCount++;
                } else if (deltaDb < -4 && deltaT > -15) {
                    // Más fuerte en B y llegó primero o simultáneo a B -> Pertenece al Guest (B)
                    assignedTo = room ? room.guestRole : 'right';
                    guestSnoreCount++;
                } else if (Math.abs(deltaDb) <= 3 && Math.abs(deltaT) < 20) {
                    // Niveles y tiempos casi idénticos -> Ruido Ambiental (tráfico, mascota, puerta)
                    assignedTo = 'ambient';
                    ambientCount++;
                } else {
                    // Desempate por decibelios predominantes
                    if (dbA > dbB) {
                        assignedTo = room ? room.hostRole : 'left';
                        hostSnoreCount++;
                    } else {
                        assignedTo = room ? room.guestRole : 'right';
                        guestSnoreCount++;
                    }
                }

                reconciled.push({
                    t_start: Math.min(tA, tB),
                    duration_ms: Math.max(evA.duration_ms || 1500, evB.duration_ms || 1500),
                    peak_db: Math.max(dbA, dbB),
                    type: evA.type || 'snore',
                    label: evA.label || 'Evento Correlacionado',
                    assignedTo,
                    deltaDb: Math.round(deltaDb * 10) / 10,
                    deltaT: Math.round(deltaT),
                    confidence: 94
                });
            } else {
                // Evento registrado únicamente por Celular Host
                const assignedTo = room ? room.hostRole : 'left';
                if (evA.type === 'snore') hostSnoreCount++;
                reconciled.push({
                    t_start: tA,
                    duration_ms: evA.duration_ms || 1500,
                    peak_db: dbA,
                    type: evA.type || 'snore',
                    label: evA.label || 'Evento Local Host',
                    assignedTo,
                    deltaDb: 10,
                    deltaT: 0,
                    confidence: 88
                });
            }
        }

        // Procesar eventos restantes de Celular Guest no emparejados
        for (let j = 0; j < adjustedGuest.length; j++) {
            if (matchedGuestIndices.has(j)) continue;
            const evB = adjustedGuest[j];
            const assignedTo = room ? room.guestRole : 'right';
            if (evB.type === 'snore') guestSnoreCount++;
            reconciled.push({
                t_start: Number(evB.t_start),
                duration_ms: evB.duration_ms || 1500,
                peak_db: Number(evB.peak_db) || -40,
                type: evB.type || 'snore',
                label: evB.label || 'Evento Local Guest',
                assignedTo,
                deltaDb: -10,
                deltaT: 0,
                confidence: 88
            });
        }

        // Ordenar cronológicamente
        reconciled.sort((a, b) => a.t_start - b.t_start);

        // Correlación cruzada de microdespertares / perturbaciones
        // Si la Persona A roncó fuerte (peakDb > -28) y en los siguientes 5 a 20 s la Persona B registró movimiento
        for (let i = 0; i < reconciled.length; i++) {
            const ev = reconciled[i];
            if (ev.type === 'snore' && ev.peak_db > -30) {
                // Buscar eventos en los siguientes 20 segundos
                for (let k = i + 1; k < reconciled.length; k++) {
                    const nextEv = reconciled[k];
                    const gapSec = (nextEv.t_start - ev.t_start) / 1000;
                    if (gapSec > 25) break;
                    if (nextEv.type === 'movement' || nextEv.type === 'breathing') {
                        if (ev.assignedTo === 'left' && nextEv.assignedTo === 'right') {
                            guestDisturbancesByHost++;
                        } else if (ev.assignedTo === 'right' && nextEv.assignedTo === 'left') {
                            hostDisturbancesByGuest++;
                        }
                    }
                }
            }
        }

        const crossImpact = {
            hostDisturbancesByGuest,
            guestDisturbancesByHost,
            ambientNoiseEvents: ambientCount,
            totalHostEvents: hostSnoreCount,
            totalGuestEvents: guestSnoreCount
        };

        if (room) {
            room.reconciledEvents = reconciled;
            room.crossImpact = crossImpact;
            room.status = 'completed';
            room.endedAt = new Date();
            await room.save();
        }

        res.json({
            success: true,
            reconciledEvents: reconciled,
            crossImpact,
            summary: {
                hostRole: room ? room.hostRole : 'left',
                guestRole: room ? room.guestRole : 'right',
                hostSnores: hostSnoreCount,
                guestSnores: guestSnoreCount,
                ambientEvents: ambientCount,
                totalReconciled: reconciled.length
            }
        });
    } catch (err) {
        console.error('Error in pair reconcile:', err);
        res.status(500).json({ success: false, error: 'Error al reconciliar datos de pareja' });
    }
}
