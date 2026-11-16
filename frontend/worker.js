import { handleApiRequest } from "./src/worker/api.js";
import { jsonResponse } from "./src/worker/supabase.js";

export { QuizRoom } from "./src/durable-objects/quiz-room.js";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
      try {
        return await handleApiRequest(request, env);
      } catch (error) {
        const status = Number(error?.status) || 500;
        if (status >= 500) console.error("Worker API request failed.", error?.message || "unknown");
        return jsonResponse({
          error: status >= 500 ? "The service is temporarily unavailable." : error.message,
        }, status);
      }
    }

    const oldRoomPath = /^\/room\/([0-9]{6})\/?$/.exec(url.pathname);
    if (oldRoomPath) {
      const destination = new URL("/room", url.origin);
      destination.search = url.search;
      destination.searchParams.set("pin", oldRoomPath[1]);
      return Response.redirect(destination.toString(), 308);
    }
    return env.ASSETS.fetch(request);
  },
};
