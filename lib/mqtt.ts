import { Mqtt, MqttClient } from "@ymjacky/mqtt5";
import type { DataBus } from "./databus.ts";

const PORTAL_ID = "c0619ab55b92";
const KEEPALIVE_TOPIC = `R/${PORTAL_ID}/keepalive`;

interface MqttConfig {
  host: string;
  port: number;
}

export async function startMqtt(
  bus: DataBus,
  config: MqttConfig,
): Promise<MqttClient> {
  const client = new MqttClient({
    url: new URL(`mqtt://${config.host}:${config.port}`),
    clientId: `wendy-dashboard-${Date.now()}`,
    clean: true,
    keepAlive: 60,
  });

  await client.connect();
  console.log(`[mqtt] connected to ${config.host}:${config.port}`);

  // MQTT is used only for keepalive — battery voltage now comes from Modbus

  // Keepalive every 25s
  const empty = new Uint8Array(0);
  async function keepalive() {
    try {
      await client.publish(KEEPALIVE_TOPIC, empty, { qos: Mqtt.QoS.AT_MOST_ONCE });
    } catch (err) {
      console.error("[mqtt] keepalive failed:", err);
    }
  }

  const keepaliveTimer = setInterval(keepalive, 25_000);
  await keepalive();

  client.on("closed", () => {
    clearInterval(keepaliveTimer);
    console.log("[mqtt] disconnected");
  });

  return client;
}
