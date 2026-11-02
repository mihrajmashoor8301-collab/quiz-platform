// Room service: rooms, PINs, participants and the room state snapshot.
// It is the only place PIN lookup and participant bookkeeping live, so
// Socket.IO handlers delegate to it for membership checks.
import { PinGenerator } from "../utils/pin-generator.js";
import { JOIN_ERRORS } from "../constants.js";

const pinGenerator = new PinGenerator();

// Latest question per participant per room, used to reject stale reconnect
// answers and to resume a room after a leave.
class ParticipantTracker {
  constructor() {
    this.perRoom = new Map(); // rid -> Map(pid -> latest question id)
  }

  update(rid, pid, questionId) {
    let perPid = this.perRoom.get(rid);
    if (!perPid) perPid = new Map();
    perPid.set(pid, questionId);
    this.perRoom.set(rid, perPid);
  }

  latest(rid, pid) {
    return this.perRoom.get(rid)?.get(pid);
  }

  // Clears a participant's trace. Used on leave and when a room resets.
  forget(rid, pid) {
    this.perRoom.get(rid)?.delete(pid);
  }

  clear() {
    this.perRoom.clear();
  }
}

const tracker = new ParticipantTracker();

export default class RoomService {
  constructor(backend, httpServer) {
    this.backend = backend;
    this.pool = backend.pool ?? backend.db;
    this.httpServer = httpServer;
    this.room = null;
    this.participants = new Map(); // socketId -> {user, latestQuestion}
  }

  get state() {
    return {
      ...this.room,
      participants: this.participants,
    };
  }

  async init(socket) {
    const pin = this.backend.pin ?? this.room?.pin;
    const rows = await this.pool.query(
      `SELECT r.*,
              (SELECT COUNT(*) FROM users u WHERE u.room_id = r.id) AS current_participants
       FROM rooms r
       WHERE r.pin = $1 AND r.status IN ('queued', 'running', 'paused')`,
      [pin]
    );
    if (!rows.rowCount && !rows.rows?.length) throw new Error(JOIN_ERRORS.ROOM_NOT_FOUND);
    this.room = rows.rows[0];
    if (this.room.current_participants >= this.room.max_participants)
      throw new Error(JOIN_ERRORS.ROOM_FULL);

    const { rows: guests } = await this.pool.query(
      "SELECT id, nickname, role FROM users WHERE room_id = $1",
      [this.room.id]
    );
    for (const guest of guests) {
      if (socket.data?.pid !== guest.id) continue;
      this.join(guest.id, guest.nickname, guest.role);
    }
    return this.state;
  }

  join(userId, nickname, role = "participant") {
    this.participants.set(userId, { user: { id: userId, nickname, role }, latestQuestion: null });
    if (this.room) {
      this.room.currentParticipants = (this.room.currentParticipants ?? 0) + 1;
    }
    return this.state;
  }

  leave(userId) {
    const p = this.participants.get(userId);
    if (p) {
      if (this.room?.id) tracker.forget(this.room.id, userId);
      this.participants.delete(userId);
      if (this.room) {
        this.room.currentParticipants = Math.max(0, (this.room.currentParticipants ?? 1) - 1);
      }
    }
    return this.state;
  }

  recordLatest(userId, questionId) {
    if (this.room?.id) tracker.update(this.room.id, userId, questionId);
  }

  latestFor(userId) {
    return this.room?.id ? tracker.latest(this.room.id, userId) : undefined;
  }

  async create({ hostId, title, maxParticipants = 200 }) {
    const occupied = this.backend.pins ?? new Set();
    const pin = pinGenerator.generate(occupied);
    occupied.add(pin);
    const rows = await this.pool.query(
      `INSERT INTO rooms (pin, host_id, title, max_participants) VALUES ($1, $2, $3, $4) RETURNING id`,
      [pin, hostId, title, maxParticipants]
    );
    const id = rows.rows?.[0]?.id ?? 1;
    this.room = {
      id,
      pin,
      hostId,
      title,
      maxParticipants,
      currentParticipants: 0,
      status: "queued",
    };
    if (this.backend) {
      this.backend.pin = pin;
    }
    return this.state;
  }

  async start() {
    const pin = this.backend.pin ?? this.room?.pin;
    await this.pool.query(
      "UPDATE rooms SET status = 'running', started_at = now() WHERE pin = $1",
      [pin]
    );
    if (this.room) this.room.status = "running";
    return this.state;
  }

  async pause() {
    const pin = this.backend.pin ?? this.room?.pin;
    await this.pool.query(
      "UPDATE rooms SET status = 'paused' WHERE pin = $1",
      [pin]
    );
    if (this.room) this.room.status = "paused";
    return this.state;
  }

  async finish() {
    const pin = this.backend.pin ?? this.room?.pin;
    await this.pool.query(
      "UPDATE rooms SET status = 'finished', finished_at = now() WHERE pin = $1",
      [pin]
    );
    if (this.room) this.room.status = "finished";
    tracker.clear();
    return this.state;
  }

  async addParticipant() {
    const pin = this.backend.pin ?? this.room?.pin;
    await this.pool.query(
      "UPDATE rooms SET current_participants = current_participants + 1 WHERE pin = $1",
      [pin]
    );
    if (this.room) {
      this.room.currentParticipants = (this.room.currentParticipants ?? 0) + 1;
    }
    return this.state;
  }

  async removeParticipant(userId) {
    if (this.room?.id) {
      await this.pool.query("DELETE FROM users WHERE id = $1 AND room_id = $2", [
        userId,
        this.room.id,
      ]);
    }
    return this.leave(userId);
  }

  async removeParticipantRow(userId) {
    if (this.room?.id) {
      await this.pool.query("DELETE FROM users WHERE id = $1 AND room_id = $2", [
        userId,
        this.room.id,
      ]);
    }
    if (this.room) {
      this.room.currentParticipants = Math.max(0, (this.room.currentParticipants ?? 1) - 1);
    }
  }
}

export const getTracker = () => tracker;
