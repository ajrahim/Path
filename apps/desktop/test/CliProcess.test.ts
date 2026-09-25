import { expect, it } from "vitest";
import { CliRpc, runCli, stopCliProcesses } from "../src/ai/CliProcess";

it("passes prompts as stdin without interpreting shell characters", async () => {
  const input = 'literal $(command) `echo private` & | "quoted"';

  await expect(
    runCli(process.execPath, ["-e", "process.stdin.pipe(process.stdout)"], process.cwd(), input),
  ).resolves.toBe(input);
});

it("rejects a timed out child and releases the process", async () => {
  await expect(
    runCli(process.execPath, ["-e", "setInterval(()=>{},1000)"], process.cwd(), "", 100),
  ).rejects.toThrow("timed out");
});

it("handles server permission requests even when their ID matches an outgoing request", async () => {
  const script = `let buffer='';process.stdin.on('data',chunk=>{buffer+=chunk;let end;while((end=buffer.indexOf('\\n'))>=0){const value=JSON.parse(buffer.slice(0,end));buffer=buffer.slice(end+1);if(value.method==='test'){process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:value.id,method:'session/request_permission',params:{}})+'\\n');}else if(value.result){process.stdout.write(JSON.stringify({id:value.id,result:{denied:value.result.outcome.outcome==='cancelled'}})+'\\n');}}});`;
  const rpc = new CliRpc(process.execPath, ["-e", script], process.cwd());

  try {
    await expect(rpc.request("test", {})).resolves.toEqual({ denied: true });
  } finally {
    rpc.close();
  }
});

it("stops owned CLI processes during application shutdown", async () => {
  const rpc = new CliRpc(process.execPath, ["-e", "setInterval(()=>{},1000)"], process.cwd());
  const waiting = expect(rpc.request("test", {})).rejects.toThrow("closed");

  stopCliProcesses();
  await waiting;
});

it("preserves UTF-8 characters split across subprocess output chunks", async () => {
  const script =
    "const bytes=Buffer.from('café');process.stdout.write(bytes.subarray(0,4));setTimeout(()=>process.stdout.write(bytes.subarray(4)),20)";

  await expect(runCli(process.execPath, ["-e", script], process.cwd())).resolves.toBe("café");
});
