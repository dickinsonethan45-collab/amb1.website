import { DurableObject } from "cloudflare:workers";

const origins = new Set([
    "https://amblock.online",
    "https://www.amblock.online",
    "https://dickinsonethan45-collab.github.io"
]);
const pages = new Set(["home", "work", "pricing", "compare"]);
const visitorPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const openSocketsLimit = 100;
const cursorInterval = 12;
const snapshotInterval = 160;
const chatInterval = 2500;
const typingInterval = 85;

function cursorText(value) {
    return typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 100) : "";
}

function fraction(value) {
    return Number.isFinite(value) && value >= 0 && value <= 1;
}

function cursorPosition(data) {
    const { x, y, page, spot, content } = data;
    if (!fraction(x) || !fraction(y)) return null;
    const position = { x, y, page };
    if (Array.isArray(spot) && spot.length === 3 && typeof spot[0] === "string" &&
        /^[a-z0-9.-]{1,64}$/.test(spot[0]) && fraction(spot[1]) && fraction(spot[2])) {
        position.spot = spot;
    }
    if (Array.isArray(content) && content.length === 2 &&
        Number.isFinite(content[0]) && Math.abs(content[0]) <= 100 &&
        Number.isFinite(content[1]) && Math.abs(content[1]) <= 50000) {
        position.content = content;
    }
    return position;
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
        this.cursorStates = new WeakMap();
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
        const hue = this.cursorHue(visitor, peers);
        this.ctx.acceptWebSocket(server);
        server.serializeAttachment({ id, visitor, hue, cursor: null, draft: "", lastCursor: 0, lastChat: 0 });
        this.send(server, JSON.stringify({
            type: "welcome",
            id,
            cursors: peers.map(peer => {
                const { id, hue, cursor, draft } = this.getCursorState(peer);
                return cursor ? { id, hue, ...cursor, draft } : null;
            }).filter(Boolean)
        }));
        this.broadcast({ type: "counts", visits, online: this.online() });
        return new Response(null, { status: 101, webSocket: client });
    }

    getCursorState(socket) {
        let state = this.cursorStates.get(socket);
        if (!state) {
            state = socket.deserializeAttachment();
            this.cursorStates.set(socket, state);
        }
        return state;
    }

    cursorHue(visitor, sockets) {
        const used = new Set();
        for (const socket of sockets) {
            const peer = this.getCursorState(socket);
            if (!Number.isInteger(peer?.hue)) continue;
            if (peer.visitor === visitor) return peer.hue;
            used.add(peer.hue);
        }
        let hue = 198;
        while (used.has(hue)) hue = (hue + 137) % 360;
        return hue;
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

        const state = this.getCursorState(socket);
        const now = Date.now();
        if (data.type === "hide" && state.cursor) {
            state.cursor = null;
            state.draft = "";
            socket.serializeAttachment(state);
            this.broadcast({ type: "hide", id: state.id });
            return;
        }

        const position = cursorPosition(data);
        if (!position) return;
        state.hue ??= this.cursorHue(state.visitor, this.ctx.getWebSockets());
        const update = { id: state.id, hue: state.hue, ...position };

        const sectionChanged = state.cursor?.page !== position.page;
        if ((data.type === "cursor" && now - state.lastCursor >= cursorInterval) ||
            (data.type === "section" && sectionChanged) ||
            (data.type === "settle" && now - state.lastCursor >= cursorInterval)) {
            state.lastCursor = now;
            state.cursor = position;
            if (sectionChanged) state.draft = "";
            if (sectionChanged || data.type !== "cursor" || now - (state.lastSnapshot ?? 0) >= snapshotInterval) {
                state.lastSnapshot = now;
                socket.serializeAttachment(state);
            }
            this.broadcast({ type: "cursor", ...update }, socket);
        }

        if (data.type === "typing" && now - (state.lastTyping ?? 0) >= typingInterval) {
            state.lastTyping = now;
            state.cursor = position;
            state.draft = cursorText(data.text);
            socket.serializeAttachment(state);
            this.broadcast({ type: "typing", ...update, text: state.draft }, socket);
        }

        if (data.type === "dismiss" && now - (state.lastDismiss ?? 0) >= typingInterval) {
            state.lastDismiss = now;
            state.draft = "";
            state.cursor = position;
            socket.serializeAttachment(state);
            const text = data.fade === true ? cursorText(data.text).trim() : "";
            this.broadcast({ type: "dismiss", ...update, text }, socket);
        }

        if (data.type === "chat" && now - state.lastChat >= chatInterval && typeof data.text === "string") {
            const text = cursorText(data.text).trim();
            if (!text) return;
            state.lastChat = now;
            socket.serializeAttachment(state);
            this.broadcast({ type: "chat", ...update, text });
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
