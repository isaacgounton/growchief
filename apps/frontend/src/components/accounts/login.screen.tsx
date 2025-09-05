"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { FC, ReactNode } from "react";
import { io, Socket } from "socket.io-client";
import type { DefaultEventsMap } from "socket.io";
import { useToaster } from "@growchief/frontend/utils/use.toaster.tsx";
import BotLoginScreenshot from "@growchief/frontend/components/accounts/login-screenshot.tsx";

function arrayBufferToBase64(buffer: any) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;

  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }

  return btoa(binary);
}

interface BotLoginButtonProps {
  botId: string;
  onClose: () => void;
  source: string;
  platform: string;
  groupId: string;
  buttonType?: "outline" | "default";
  mutate: () => void;
  proxyId?: string;
}

const SocketContext = createContext<any>({});

const WebSockets = (params: {
  bot: string;
  source: string;
  children: ReactNode;
  onClose: () => void;
  platform: string;
  groupId: string;
  mutate: () => void;
  proxyId?: string;
}) => {
  const [eventSource, setEventSource] = useState<Socket<
    DefaultEventsMap,
    DefaultEventsMap
  > | null>();

  const { children, source, bot, mutate } = params;
  const [cookies] = [{ auth: "" }]; //useCookies(["auth"]);
  const [event, setEvent] = useState({});

  useEffect(() => {
    const currentDomain = new URL(window.location.href).origin
      .replace("http://", "ws://")
      .replace("https://", "wss://");
    const ioa = io(import.meta.env.VITE_PUBLIC_WS || currentDomain, {
      transports: ["websocket"],
      withCredentials: true,
    });

    setEventSource(ioa);
    start(ioa);

    ioa.on("disconnect", () => {
      params.onClose();
    });

    return () => {
      ioa.disconnect();
      ioa.offAny();
    };
  }, []);

  const start = async (es: Socket) => {
    await new Promise((resolve) => {
      es.on("connect", () => {
        resolve(true);
      });
    });
    es.on("data", (event: any) => {
      if (typeof event === "string" && event === "stop") {
        mutate();
        params.onClose();
        return;
      }

      setEvent(event);
    });
    es.emit("start", {
      source: source,
      bot,
      token: cookies.auth,
      platform: params.platform,
      groupId: params.groupId,
      proxyId: params.proxyId,
      timezone: -new Date().getTimezoneOffset() / 60,
    });
  };

  const emit = (identifier: string) => (data: any) => {
    // @ts-ignore
    eventSource?.emit("load", {
      id: identifier,
      body: data,
      platform: params.platform,
      groupId: params.groupId,
      proxyId: params.proxyId,
      timezone: -new Date().getTimezoneOffset() / 60,
    });
  };

  return (
    <SocketContext.Provider value={{ emit, data: event }}>
      {children}
    </SocketContext.Provider>
  );
};

export const BotLoginInsideButton: FC<BotLoginButtonProps> = ({
  botId,
  onClose,
  source,
  platform,
  groupId,
  mutate,
  proxyId,
}) => {
  return (
    <WebSockets
      mutate={mutate}
      groupId={groupId}
      bot={botId}
      source={source}
      onClose={onClose}
      platform={platform}
      proxyId={proxyId}
    >
      <BotLoginInsideInnerButton
        mutate={mutate}
        groupId={groupId}
        platform={platform}
        botId={botId}
        onClose={onClose}
        source={source}
        proxyId={proxyId}
      />
    </WebSockets>
  );
};

export const BotLoginInsideInnerButton: FC<BotLoginButtonProps> = ({
  source,
  onClose,
}) => {
  const toast = useToaster();
  const [_, setIsShowingScreenshot] = useState(false);
  const [screenshotData, setScreenshotData] = useState<string | null>(null);
  const [identifier, setIdentifier] = useState("");
  const event = useContext(SocketContext);

  useEffect(() => {
    if (
      typeof event.data === "string" &&
      event.data.indexOf("identifier") > -1
    ) {
      setIdentifier(JSON.parse(event.data).identifier);
      return;
    }

    if (typeof event.data === "string" && event.data === "logout") {
      toast.show("Invalid credentials. Please try again.", "warning");
    }

    // Update the screenshot data with the new base64 image
    if (typeof event.data !== "string" && event.data) {
      setIsShowingScreenshot(true);
      setScreenshotData(arrayBufferToBase64(event.data));
    }
  }, [event]);

  return (
    <BotLoginScreenshot
      emit={event.emit(identifier)}
      onClose={onClose}
      source={source}
      identifier={identifier}
      imageData={screenshotData!}
    />
  );
};
