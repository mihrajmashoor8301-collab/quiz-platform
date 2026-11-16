type Listener = (data?: any) => void;

export class QuizSocket {
  id = "";
  private pin: string;
  private listeners = new Map<string, Set<Listener>>();
  private ws: WebSocket | null = null;
  private manuallyClosed = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private attempts = 0;

  constructor(pin: string) {
    this.pin = pin;
    this.open();
  }

  on(event: string, listener: Listener) {
    const listeners = this.listeners.get(event) || new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(event, listeners);
    return this;
  }

  emit(event: string, data?: unknown) {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify({ event, data }));
    return true;
  }

  disconnect() {
    this.manuallyClosed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.ws?.close(1000, "Client left the room");
  }

  private dispatch(event: string, data?: unknown) {
    for (const listener of this.listeners.get(event) || []) listener(data);
  }

  private open() {
    if (this.manuallyClosed || typeof window === "undefined") return;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${protocol}//${window.location.host}/api/rooms/${this.pin}/ws`);
    this.ws = socket;
    socket.addEventListener("open", () => {
      this.attempts = 0;
      this.dispatch("connect");
    });
    socket.addEventListener("message", (message) => {
      if (typeof message.data !== "string" || message.data.length > 64 * 1024) return;
      try {
        const packet = JSON.parse(message.data);
        if (packet?.event === "joined" && typeof packet.data?.participant?.id === "string") {
          this.id = packet.data.participant.id;
        }
        if (typeof packet?.event === "string") this.dispatch(packet.event, packet.data);
      } catch {
        this.dispatch("error", "The server sent an invalid message.");
      }
    });
    socket.addEventListener("error", () => this.dispatch("connect_error", "Could not connect to the live room."));
    socket.addEventListener("close", () => {
      this.dispatch("disconnect");
      if (this.manuallyClosed) return;
      const delay = Math.min(10_000, 500 * (2 ** Math.min(this.attempts, 5)));
      this.attempts += 1;
      this.reconnectTimer = setTimeout(() => this.open(), delay);
    });
  }
}

export function createQuizSocket(pin: string) {
  return new QuizSocket(pin);
}
