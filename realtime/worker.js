import { DurableObject } from "cloudflare:workers";

const origins = new Set([
    "https://amblock.online",
    "https://www.amblock.online",
    "https://dickinsonethan45-collab.github.io"
]);
const pages = new Set(["home", "work", "pricing", "compare"]);
const visitorPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const openSocketsLimit = 100;
const cursorInterval = 125;
const chatInterval = 2500;
const typingInterval = 85;

function cursorText(value) {
    return typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 100) : "";
}

export default {
    fetch(request, env) {
        const url = new URL(request.url);
        const origin = request.headers.get("Origin");
        const local = ["localhost", "127.0.0.1"].includes(url.hostname) &&
            /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin ?? "");

        if (url.pathname !== "/live") return new Response(null, { status: 404 });
        if (!origins.has(origin) && !local) return new Response(null, { status: 403 });
        if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
            return new Response(null, { status: 426 });
        }
        if (!visitorPattern.test(url.searchParams.get("visitor") ?? "")) {
            return new Response(null, { status: 400 });
        }
        return env.LIVE_ROOM.getByName("amblock").fetch(request);
    }
};

export class LiveRoom extends DurableObject {
    constructor(ctx, env) {
        super(ctx, env);
        this.sql = ctx.storage.sql;
        this.sql.exec("CREATE TABLE IF NOT EXISTS visitor (id TEXT PRIMARY KEY)");
        this.sql.exec("CREATE TABLE IF NOT EXISTS visit_total (id INTEGER PRIMARY KEY, total INTEGER NOT NULL)");
        this.sql.exec("INSERT OR IGNORE INTO visit_total VALUES (1, 0)");
    }

    fetch(request) {
        const peers = this.ctx.getWebSockets();
        if (peers.length >= openSocketsLimit) return new Response(null, { status: 503 });

        const visitor = new URL(request.url).searchParams.get("visitor");
        const visits = this.ctx.storage.transactionSync(() => {
            const added = this.sql.exec("INSERT OR IGNORE INTO visitor VALUES (?) RETURNING id", visitor).toArray();
            if (added.length) this.sql.exec("UPDATE visit_total SET total = total + 1 WHERE id = 1");
            return this.sql.exec("SELECT total FROM visit_total WHERE id = 1").one().total;
        });
        const [client, server] = Object.values(new WebSocketPair());
        const id = crypto.randomUUID();
        this.ctx.acceptWebSocket(server);
        server.serializeAttachment({ id, visitor, cursor: null, draft: "", lastCursor: 0, lastChat: 0 });
        this.send(server, JSON.stringify({
            type: "welcome",
            id,
            cursors: peers.map(peer => {
                const { id, cursor, draft } = peer.deserializeAttachment();
                return cursor ? { id, ...cursor, draft } : null;
            }).filter(Boolean)
        }));
        this.broadcast({ type: "counts", visits, online: this.online() });
        return new Response(null, { status: 101, webSocket: client });
    }

    online() {
        const visitors = this.ctx.getWebSockets()
            .filter(socket => socket.readyState === WebSocket.OPEN)
            .map(socket => socket.deserializeAttachment().visitor);
        return new Set(visitors).size;
    }

    send(socket, message) {
        if (socket.readyState !== WebSocket.OPEN) return;
        try {
            socket.send(message);
        } catch {
            socket.close(1011, "Send failed");
        }
    }

    broadcast(payload, except) {
        const message = JSON.stringify(payload);
        for (const socket of this.ctx.getWebSockets()) {
            if (socket !== except) this.send(socket, message);
        }
    }

    webSocketMessage(socket, message) {
        if (typeof message !== "string" || message.length > 768) {
            socket.close(1009, "Message too large");
            return;
        }

        let data;
        try {
            data = JSON.parse(message);
        } catch {
            return;
        }
        if (!data || !pages.has(data.page)) return;

        const state = socket.deserializeAttachment();
        const now = Date.now();
        if (data.type === "hide" && state.cursor) {
            state.cursor = null;
            state.draft = "";
            socket.serializeAttachment(state);
            this.broadcast({ type: "hide", id: state.id });
            return;
        }

        const { x, y, page } = data;
        if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) return;
        const position = { x, y, page };

        if (data.type === "cursor" && now - state.lastCursor >= cursorInterval) {
            state.lastCursor = now;
            state.cursor = position;
            socket.serializeAttachment(state);
            this.broadcast({ type: "cursor", id: state.id, ...position }, socket);
        }

        if (data.type === "typing" && now - (state.lastTyping ?? 0) >= typingInterval) {
            state.lastTyping = now;
            state.cursor = position;
            state.draft = cursorText(data.text);
            socket.serializeAttachment(state);
            this.broadcast({ type: "typing", id: state.id, text: state.draft, ...position }, socket);
        }

        if (data.type === "dismiss" && now - (state.lastDismiss ?? 0) >= typingInterval) {
            state.lastDismiss = now;
            state.draft = "";
            state.cursor = position;
            socket.serializeAttachment(state);
            const text = data.fade === true ? cursorText(data.text).trim() : "";
            this.broadcast({ type: "dismiss", id: state.id, text, ...position }, socket);
        }

        if (data.type === "chat" && now - state.lastChat >= chatInterval && typeof data.text === "string") {
            const text = cursorText(data.text).trim();
            if (!text) return;
            state.lastChat = now;
            socket.serializeAttachment(state);
            this.broadcast({ type: "chat", id: state.id, text, ...position });
        }
    }

    webSocketClose(socket) {
        this.broadcast({ type: "leave", id: socket.deserializeAttachment().id }, socket);
        this.broadcast({ type: "counts", online: this.online() }, socket);
    }

    webSocketError(socket) {
        socket.close(1011, "Connection failed");
        this.webSocketClose(socket);
    }
}
