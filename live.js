(() => {
    const endpoint = document.querySelector('meta[name="amblock-live-endpoint"]').content;
    if (!endpoint || !window.WebSocket || !crypto.randomUUID) return;

    const controls = document.getElementById("live-controls");
    const visits = document.getElementById("live-visits");
    const online = document.getElementById("live-online");
    const chat = document.getElementById("live-chat");
    const input = document.getElementById("live-message");
    const announcement = document.getElementById("live-announcement");
    const layer = document.getElementById("live-cursors");
    const peers = new Map();
    const formatCount = new Intl.NumberFormat();
    const cursorInterval = 50;
    const typingInterval = 150;
    let socket, ownId, pointer, chatPoint, cursorTimer, typingTimer, reconnectTimer;
    let retryDelay = 1000;
    let lastCursor = 0;
    let lastTyping = 0;
    let draftShared = false;
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
        const bubble = [peer.draft, peer.message].find(entry => entry?.position.page === section);
        const position = peer.position ?? bubble?.position;
        peer.element.hidden = position?.page !== section;
        if (peer.element.hidden) return;

        const x = position.x * innerWidth;
        const y = position.y * innerHeight;
        peer.element.style.transform = `translate3d(${x}px, ${y}px, 0)`;
        peer.arrow.hidden = peer.id === ownId && !bubble;
        peer.bubble.hidden = !bubble;
        if (bubble) {
            if (peer.bubble.textContent !== bubble.text) {
                peer.bubble.textContent = bubble.text;
                peer.bubbleSize = null;
            }
            peer.bubbleSize ??= [peer.bubble.offsetWidth, peer.bubble.offsetHeight];
            peer.bubble.classList.toggle("flip-x", x + 16 + peer.bubbleSize[0] > innerWidth);
            peer.bubble.classList.toggle("flip-y", y + 18 + peer.bubbleSize[1] > innerHeight);
        }
    }

    function fadeText(position, text) {
        if (!text || position.page !== page()) return;
        const anchor = document.createElement("div");
        const bubble = document.createElement("span");
        const x = position.x * innerWidth;
        const y = position.y * innerHeight;
        anchor.className = "live-peer";
        anchor.style.transform = `translate(${x}px, ${y}px)`;
        bubble.className = "live-bubble fading";
        bubble.textContent = text;
        anchor.append(bubble);
        layer.append(anchor);
        bubble.classList.toggle("flip-x", x + 16 + bubble.offsetWidth > innerWidth);
        bubble.classList.toggle("flip-y", y + 18 + bubble.offsetHeight > innerHeight);
        bubble.addEventListener("animationend", () => anchor.remove(), { once: true });
        setTimeout(() => anchor.remove(), 500);
    }

    function getPeer({ id, hue }) {
        let peer = peers.get(id);
        if (!peer) {
            const element = document.createElement("div");
            const arrow = document.createElement("span");
            const bubble = document.createElement("span");
            element.className = "live-peer moving";
            arrow.className = "live-pointer";
            bubble.className = "live-bubble";
            element.append(arrow, bubble);
            layer.append(element);
            peer = { id, element, arrow, bubble, position: null, message: null };
            peers.set(id, peer);
        }
        if (Number.isInteger(hue) && peer.hue !== hue) {
            peer.hue = hue;
            peer.arrow.style.setProperty("--visitor-cursor-color", `hsl(${hue} 90% 70%)`);
        }
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
        const peer = getPeer(data);
        peer.position = data;
        if (peer.draft?.position.page !== data.page) peer.draft = null;
        if (data.draft) peer.draft = { text: data.draft, position: data };
        renderPeer(peer);
    }

    function receive(event) {
        const data = JSON.parse(event.data);
        switch (data.type) {
            case "welcome":
                ownId = data.id;
                retryDelay = 1000;
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
                peer.draft = null;
                if (peer.message) renderPeer(peer);
                else removePeer(data.id);
                break;
            }
            case "leave":
                removePeer(data.id);
                break;
            case "typing":
            case "dismiss": {
                const peer = getPeer(data);
                peer.position = data;
                peer.draft = data.type === "typing" && data.text ? { text: data.text, position: data } : null;
                if (data.type === "dismiss" && data.text && data.page === page()) {
                    fadeText(data, data.text);
                    announcement.textContent = `Visitor says: ${data.text}`;
                }
                renderPeer(peer);
                break;
            }
            case "chat": {
                const peer = getPeer(data);
                peer.message = { position: data, text: data.text };
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
        if (!pointer || cursorTimer || document.hidden) return;
        cursorTimer = setTimeout(() => {
            cursorTimer = null;
            sendCursor("cursor");
        }, Math.max(0, cursorInterval - (performance.now() - lastCursor)));
    }

    function sendCursor(type) {
        if (pointer && send({ type, ...pointer })) {
            sharingCursor = true;
            lastCursor = performance.now();
        }
    }

    function hideCursor() {
        clearTimeout(cursorTimer);
        cursorTimer = null;
        if (sharingCursor) send({ type: "hide", page: page() });
        sharingCursor = false;
        draftShared = false;
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
        chatPoint = pointer ?? point(innerWidth / 2, innerHeight / 2);
        chatOpener = document.activeElement;
        chat.hidden = false;
        positionChat();
        input.focus({ preventScroll: true });
    }

    function closeChat({ restoreFocus = false, fade = false } = {}) {
        if (chat.hidden) return;
        clearTimeout(typingTimer);
        typingTimer = null;
        const text = input.value.trim();
        if (draftShared || (fade && text)) {
            if (send({ type: "dismiss", ...chatPoint, fade, text })) sharingCursor = true;
        }
        if (fade) fadeText(chatPoint, text);
        draftShared = false;
        input.value = "";
        input.size = 5;
        chat.hidden = true;
        if (restoreFocus) chatOpener?.focus({ preventScroll: true });
    }

    function queueTyping() {
        if (typingTimer) return;
        typingTimer = setTimeout(() => {
            typingTimer = null;
            if (!chat.hidden && (input.value || draftShared) &&
                send({ type: "typing", ...chatPoint, text: input.value })) {
                draftShared = true;
                sharingCursor = true;
                lastTyping = performance.now();
            }
        }, Math.max(0, typingInterval - (performance.now() - lastTyping)));
    }

    function updateTyping() {
        input.size = Math.max(5, Math.min(18, input.value.length + 1));
        positionChat();
        queueTyping();
    }

    chat.addEventListener("submit", event => {
        event.preventDefault();
        closeChat({ restoreFocus: true, fade: true });
    });
    input.addEventListener("input", updateTyping);
    document.addEventListener("keydown", event => {
        if (!chat.hidden && !event.isComposing && (event.key === "Enter" || event.key === "Escape")) {
            event.preventDefault();
            closeChat({ restoreFocus: true, fade: event.key === "Enter" });
            return;
        }
        const printable = [...event.key].length === 1 && event.key.trim() && !event.isComposing &&
            !event.ctrlKey && !event.metaKey && !event.altKey;
        if (printable && chat.hidden && ownId && !event.defaultPrevented &&
            !event.target.closest?.("input, textarea, select, [contenteditable]")) {
            event.preventDefault();
            openChat();
            input.value = event.key;
            input.setSelectionRange(input.value.length, input.value.length);
            updateTyping();
        }
    });
    document.addEventListener("pointerdown", event => {
        if (!chat.hidden && !chat.contains(event.target)) closeChat();
    });
    document.addEventListener("pointerup", event => {
        if (event.pointerType === "touch" && event.target.matches("body, main, .page")) {
            pointer = point(event.clientX, event.clientY);
            openChat();
            queueCursor();
        }
    });
    document.addEventListener("pointermove", event => {
        if (event.pointerType === "touch") return;
        pointer = point(event.clientX, event.clientY);
        if (!chat.hidden) {
            chatPoint = pointer;
            positionChat();
        }
        queueCursor();
    }, { passive: true });
    window.addEventListener("blur", () => closeChat());
    document.addEventListener("visibilitychange", () => {
        if (document.hidden) {
            closeChat();
            hideCursor();
        } else {
            queueCursor();
        }
    });
    document.addEventListener("amblock:pagechange", () => {
        closeChat();
        if (pointer) {
            clearTimeout(cursorTimer);
            cursorTimer = null;
            pointer = { ...pointer, page: page() };
            if (!document.hidden) sendCursor("section");
        } else {
            hideCursor();
        }
        peers.forEach(renderPeer);
    });
    window.addEventListener("resize", () => {
        peers.forEach(peer => {
            peer.bubbleSize = null;
            renderPeer(peer);
        });
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
