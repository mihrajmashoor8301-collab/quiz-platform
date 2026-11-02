// Socket.IO event names and join-error codes.
// Every event a participant can emit is listed here so the server can
// validate `eventNames()` against it instead of trusting the socket.
export const EVENT_NAMES = {
  CONNECT: "connect",
  DISCONNECT: "disconnect",
  JOIN_ROOM: "join-room",
  SUBMIT_ANSWER: "submit-answer",
  SUBMIT_POLL: "submit-poll",
  SUBMIT_WORD: "submit-word",
  LEAVE_ROOM: "leave-room",
  PING: "ping",
  ROOM_STATE: "room-state",
};

// Events that only the host may emit.
export const HOST_ONLY_EVENTS = ["start-quiz", "close-question", "finish-quiz"];

// Errors sent back to participants that are not in the room.
export const JOIN_ERRORS = {
  ROOM_NOT_FOUND: "room.notFound",
  ROOM_FULL: "room.full",
  ROOM_FINISHED: "room.finished",
  INVALID_PIN: "room.invalidPin",
  DUPLICATE_NICKNAME: "room.nicknameTaken",
};
