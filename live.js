(() => {
    const endpoint = document.querySelector('meta[name="amblock-live-endpoint"]').content;
    if (!endpoint || !window.WebSocket || !crypto.randomUUID) return;

    const controls = document.getElementById("live-controls");
    const visits = document.getElementById("live-visits");
    const online = document.getElementById("live-online");
    const chatButton = document.getElementById("live-chat-button");
    const chat = document.getElementById("live-chat");
    const input = document.getElementById("live-message");
    const announcement = document.getElementById("live-announcement");
    const layer = document.getElementById("live-cursors");
    const peers = new Map();
    const formatCount = new Intl.NumberFormat();
    const cursorInterval = 150;
    const chatInterval = 2600;
    let socket, ownId, pointer, chatPoint, cursorTimer, reconnectTimer;
    let retryDelay = 1000;
    let lastCursor = 0;
    let lastChat = -Infinity;
    let sharingCursor = false;
    let active = true;

    function getVisitor() {
        const key = "amblock-live-visitor";
        const fallback = crypto.randomUUID();
        try {
            const stored = localStorage.getItem(key);
            if (/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(stored ?? "")) {
                return stored;
            }
            localStorage.setItem(key, fallback);
        } catch {
            // Storage can be unavailable in private or restricted browsing sessions.
        }
        return fallback;
    }

    const url = new URL(endpoint);
    url.searchParams.set("visitor", getVisitor());
    controls.hidden = false;

    function page() {
        return document.querySelector("main .page.active")?.id ?? "home";
    }

    function point(x, y) {
        return {
            page: page(),
            x: Math.max(0, Math.min(1, x / innerWidth)),
            y: Math.max(0, Math.min(1, y / innerHeight))
        };
    }

    function send(message) {
        if (!ownId || socket?.readyState !== WebSocket.OPEN) return false;
        socket.send(JSON.stringify(message));
        return true;
    }

    function renderPeer(peer) {
        const section = page();
        const message = peer.message?.position.page === section ? peer.message : null;
        const cursor = peer.position?.page === section ? peer.position : null;
        const position = cursor ?? message?.position;
        peer.element.hidden = !position;
        if (!position) return;

        const x = position.x * innerWidth;
        const y = position.y * innerHeight;
        peer.element.style.transform = `translate(${x}px, ${y}px)`;
        peer.arrow.hidden = peer.id === ownId && !message;
        peer.bubble.hidden = !message;
        if (message) {
            peer.bubble.classList.toggle("flip-x", x + 16 + peer.bubble.offsetWidth > innerWidth);
            peer.bubble.classList.toggle("flip-y", y + 18 + peer.bubble.offsetHeight > innerHeight);
        }
    }

    function getPeer(id) {
        if (peers.has(id)) return peers.get(id);
        const element = document.createElement("div");
        const arrow = document.createElement("span");
        const bubble = document.createElement("span");
        element.className = "live-peer";
        arrow.className = "live-pointer";
        bubble.className = "live-bubble";
        element.append(arrow, bubble);
        layer.append(element);
        const peer = { id, element, arrow, bubble, position: null, message: null };
        peers.set(id, peer);
        return peer;
    }

    function removePeer(id) {
        const peer = peers.get(id);
        if (!peer) return;
        clearTimeout(peer.messageTimer);
        peer.element.remove();
        peers.delete(id);
    }

    function showCursor(data) {
        const peer = getPeer(data.id);
        peer.position = data;
        renderPeer(peer);
    }

    function receive(event) {
        const data = JSON.parse(event.data);
        switch (data.type) {
            case "welcome":
                ownId = data.id;
                retryDelay = 1000;
                chatButton.disabled = false;
                online.setAttribute("data-connected", "");
                data.cursors.forEach(showCursor);
                if (pointer && !document.hidden) queueCursor();
                break;
            case "counts":
                if (Number.isSafeInteger(data.visits)) visits.textContent = `${formatCount.format(data.visits)} ${data.visits === 1 ? "visitor" : "visitors"}`;
                online.textContent = `${formatCount.format(data.online)} online`;
                break;
            case "cursor":
                showCursor(data);
                break;
            case "hide": {
                const peer = peers.get(data.id);
                if (!peer) break;
                peer.position = null;
                if (peer.message) renderPeer(peer);
                else removePeer(data.id);
                break;
            }
            case "leave":
                removePeer(data.id);
                break;
            case "chat": {
                const peer = getPeer(data.id);
                peer.message = { position: data };
                peer.bubble.textContent = data.text;
                if (data.page === page() && data.id !== ownId) {
                    announcement.textContent = `Visitor says: ${data.text}`;
                }
                clearTimeout(peer.messageTimer);
                peer.messageTimer = setTimeout(() => {
                    peer.message = null;
                    if (peer.position) renderPeer(peer);
                    else removePeer(peer.id);
                }, 6500);
                renderPeer(peer);
                break;
            }
        }
    }

    function connect() {
        const connection = new WebSocket(url);
        socket = connection;
        connection.addEventListener("message", event => {
            if (connection === socket) receive(event);
        });
        connection.addEventListener("close", () => {
            if (connection !== socket) return;
            ownId = null;
            sharingCursor = false;
            peers.forEach(peer => removePeer(peer.id));
            chatButton.disabled = true;
            online.textContent = "— online";
            online.removeAttribute("data-connected");
            closeChat();
            if (active) {
                const delay = retryDelay + Math.random() * 500;
                reconnectTimer = setTimeout(connect, delay);
                retryDelay = Math.min(retryDelay * 2, 30000);
            }
        });
    }

    function queueCursor() {
        if (!pointer || cursorTimer) return;
        cursorTimer = setTimeout(() => {
            cursorTimer = null;
            if (pointer && send({ type: "cursor", ...pointer })) {
                sharingCursor = true;
                lastCursor = performance.now();
            }
        }, Math.max(0, cursorInterval - (performance.now() - lastCursor)));
    }

    function hideCursor() {
        clearTimeout(cursorTimer);
        cursorTimer = null;
        pointer = null;
        if (sharingCursor) send({ type: "hide", page: page() });
        sharingCursor = false;
    }

    function positionChat() {
        if (chat.hidden) return;
        const x = chatPoint.x * innerWidth;
        const y = chatPoint.y * innerHeight;
        chat.style.left = `${x}px`;
        chat.style.top = `${y}px`;
        chat.classList.toggle("flip-x", x + 18 + input.offsetWidth > innerWidth);
        chat.classList.toggle("flip-y", y + 20 + input.offsetHeight > innerHeight);
    }

    let chatOpener;
    function openChat() {
        if (!ownId || !chat.hidden) return;
        const bounds = chatButton.getBoundingClientRect();
        chatPoint = pointer ?? point(bounds.right, Math.max(0, bounds.bottom));
        chatOpener = document.activeElement;
        chat.hidden = false;
        chatButton.setAttribute("aria-expanded", "true");
        positionChat();
        input.focus({ preventScroll: true });
    }

    function closeChat(restoreFocus = false) {
        if (chat.hidden) return;
        chat.hidden = true;
        chatButton.setAttribute("aria-expanded", "false");
        if (restoreFocus) chatOpener?.focus({ preventScroll: true });
    }

    chatButton.addEventListener("click", () => chat.hidden ? openChat() : closeChat(true));
    chat.addEventListener("submit", event => {
        event.preventDefault();
        const text = input.value.trim();
        if (!text) {
            closeChat(true);
            return;
        }
        if (performance.now() - lastChat < chatInterval) {
            input.setCustomValidity("Wait a moment before sending another message.");
            input.reportValidity();
            setTimeout(() => input.setCustomValidity(""), chatInterval);
            return;
        }
        if (!send({ type: "chat", ...chatPoint, text })) return;
        input.value = "";
        input.size = 5;
        lastChat = performance.now();
        closeChat(true);
    });
    input.addEventListener("input", () => {
        input.setCustomValidity("");
        input.size = Math.max(5, Math.min(18, input.value.length + 1));
        positionChat();
    });
    document.addEventListener("keydown", event => {
        if (event.key === "Escape" && !chat.hidden) closeChat(true);
        if (event.key === "Enter" && !event.repeat && !event.isComposing && chat.hidden && ownId &&
            !event.target.closest?.("a, button, input, select, textarea, [contenteditable]")) {
            event.preventDefault();
            openChat();
        }
    });
    document.addEventListener("pointerdown", event => {
        if (!chat.hidden && !chat.contains(event.target) && event.target !== chatButton) closeChat();
    });
    document.addEventListener("pointermove", event => {
        if (event.pointerType === "touch" || !chat.hidden) return;
        pointer = point(event.clientX, event.clientY);
        queueCursor();
    }, { passive: true });
    document.documentElement.addEventListener("pointerleave", hideCursor);
    window.addEventListener("blur", hideCursor);
    document.addEventListener("visibilitychange", () => {
        if (document.hidden) hideCursor();
    });
    document.addEventListener("amblock:pagechange", () => {
        hideCursor();
        closeChat();
        peers.forEach(renderPeer);
    });
    window.addEventListener("resize", () => {
        peers.forEach(renderPeer);
        positionChat();
    });
    window.addEventListener("pagehide", () => {
        active = false;
        clearTimeout(reconnectTimer);
        socket?.close();
    });
    window.addEventListener("pageshow", event => {
        active = true;
        if (event.persisted && socket?.readyState !== WebSocket.OPEN) {
            clearTimeout(reconnectTimer);
            connect();
        }
    });
    connect();
})();
