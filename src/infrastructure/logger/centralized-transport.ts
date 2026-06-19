import Transport from "winston-transport";
import { env } from "@/config/env";

/** Ships JSON log lines to a central collector (Loki, ELK, Datadog, etc.). */
export class CentralizedLogTransport extends Transport {
  constructor(opts?: Transport.TransportStreamOptions) {
    super({ ...opts, level: opts?.level ?? "info" });
  }

  log(info: Record<string, unknown>, callback: () => void): void {
    setImmediate(() => this.emit("logged", info));

    if (!env.LOG_CENTRAL_ENABLED || !env.LOG_CENTRAL_URL) {
      callback();
      return;
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (env.LOG_CENTRAL_API_KEY) {
      headers.Authorization = `Bearer ${env.LOG_CENTRAL_API_KEY}`;
    }

    void fetch(env.LOG_CENTRAL_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(info),
    }).catch(() => {
      // Never break app flows when central logging is unavailable
    });

    callback();
  }
}
