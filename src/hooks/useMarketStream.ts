import { useEffect, useMemo, useState } from "react";
import type { MarketSnapshot } from "../../shared/types";

type ConnectionState = "connecting" | "live" | "stale" | "offline";

interface StreamState {
  snapshot: MarketSnapshot | null;
  connectionState: ConnectionState;
  lastMessageAt: number | null;
}

const getSocketUrl = (): string => {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/live`;
};

export const useMarketStream = (): StreamState => {
  const [snapshot, setSnapshot] = useState<MarketSnapshot | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");
  const [lastMessageAt, setLastMessageAt] = useState<number | null>(null);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let staleTimer: number | null = null;
    let disposed = false;

    const connect = () => {
      setConnectionState("connecting");
      socket = new WebSocket(getSocketUrl());

      socket.addEventListener("open", () => {
        if (!disposed) {
          setConnectionState("live");
        }
      });

      socket.addEventListener("message", (event) => {
        const payload = JSON.parse(event.data) as {
          type: "snapshot";
          snapshot: MarketSnapshot;
        };

        if (payload.type === "snapshot") {
          setSnapshot(payload.snapshot);
          setLastMessageAt(Date.now());
          setConnectionState("live");
        }
      });

      socket.addEventListener("close", () => {
        if (disposed) {
          return;
        }

        setConnectionState("offline");
        reconnectTimer = window.setTimeout(connect, 1500);
      });

      socket.addEventListener("error", () => {
        socket?.close();
      });
    };

    connect();

    staleTimer = window.setInterval(() => {
      setLastMessageAt((current) => {
        if (current && Date.now() - current > 10_000) {
          setConnectionState("stale");
        }

        return current;
      });
    }, 2500);

    return () => {
      disposed = true;

      if (reconnectTimer) {
        window.clearTimeout(reconnectTimer);
      }

      if (staleTimer) {
        window.clearInterval(staleTimer);
      }

      socket?.close();
    };
  }, []);

  return useMemo(
    () => ({ snapshot, connectionState, lastMessageAt }),
    [connectionState, lastMessageAt, snapshot]
  );
};
