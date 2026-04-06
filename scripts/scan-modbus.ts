import ModbusRTUModule from "modbus-serial";
const ModbusRTU = (ModbusRTUModule as any).default ?? ModbusRTUModule;

const client = new ModbusRTU();
await client.connectTCP("192.168.47.6", { port: 502 });
client.setTimeout(3000);
console.log("Connected");

for (const uid of [100, 223, 224, 225, 227, 239, 277, 278]) {
  client.setID(uid);
  for (const [reg, desc] of [[259, "bat V"], [4200, "dcsrc V"], [840, "sys V"]]) {
    try {
      const r = await client.readHoldingRegisters(reg as number, 2);
      console.log(`  Unit ${uid} reg ${reg} (${desc}): ${r.data}`);
      break;
    } catch {
      // skip
    }
  }
}

client.close(() => console.log("Done"));
